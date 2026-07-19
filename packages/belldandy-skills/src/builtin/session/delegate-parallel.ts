import type { SpawnSubAgentOptions, SubAgentResult, Tool, ToolCallResult } from "../../types.js";
import crypto from "node:crypto";
import { withToolContract } from "../../tool-contract.js";
import { buildSubAgentLaunchSpec } from "../../subagent-launch.js";
import { buildFailureToolCallResult } from "../../failure-kind.js";
import { isAbortError, readAbortReason, throwIfAborted } from "../../abort-utils.js";
import {
    buildDelegationResultFollowUpStrategy,
    DELEGATION_CONTRACT_PARAMETER_PROPERTIES,
    buildDelegationResultToolMetadata,
    evaluateDelegationResultGate,
    renderDelegationResultGateReport,
    readStructuredDelegationContractArgs,
} from "./delegation-contract.js";
import type { DelegationTeamMetadata, DelegationTeamMode } from "../../delegation-protocol.js";

export const DEFAULT_DELEGATE_PARALLEL_MAX_TASKS = 8;
export const DEFAULT_DELEGATE_PARALLEL_MAX_CONCURRENT = 4;
export const DEFAULT_DELEGATE_PARALLEL_MAX_AGGREGATE_BYTES = 128 * 1024;

/**
 * delegate_parallel — 并行委托多个任务给子 Agent
 *
 * 接受 tasks 数组，每个 task 独立运行在子 Agent 中，全部完成后返回聚合结果。
 * 利用 Orchestrator 的排队机制，超出并发上限的任务会自动排队。
 */
export const delegateParallelTool: Tool = withToolContract({
    definition: {
        name: "delegate_parallel",
        description:
            "Delegate multiple tasks to sub-agents in parallel. Each task runs independently and results are aggregated. " +
            "Use this when you need several specialized agents to work on different parts of a complex task simultaneously.",
        parameters: {
            type: "object",
            properties: {
                tasks: {
                    type: "array",
                    description:
                        "Array of task objects. Each task has: instruction (required), agent_id (optional), context (optional).",
                    items: {
                        type: "object",
                        properties: {
                            instruction: {
                                type: "string",
                                description: "Detailed instruction for this delegated subtask.",
                            },
                            agent_id: {
                                type: "string",
                                description: "Optional target agent profile ID for this subtask.",
                            },
                            context: {
                                type: "object",
                                description: "Optional structured context for this subtask.",
                            },
                            ...DELEGATION_CONTRACT_PARAMETER_PROPERTIES,
                        },
                    },
                },
            },
            required: ["tasks"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        const id = crypto.randomUUID();
        const name = "delegate_parallel";
        const makeError = (
            error: string,
            output: string = "",
            failureKind?: ToolCallResult["failureKind"],
        ): ToolCallResult => buildFailureToolCallResult({
            id,
            name,
            start,
            error,
            output,
            ...(failureKind ? { failureKind } : {}),
        });

        if (context.abortSignal?.aborted) {
            return makeError(readAbortReason(context.abortSignal), "", "environment_error");
        }

        if (!context.agentCapabilities?.spawnParallel) {
            return makeError(
                "Error: Parallel sub-agent orchestration is not available (capability missing).",
                "Error: Parallel sub-agent orchestration is not available (capability missing).",
                "environment_error",
            );
        }

        const tasks = args.tasks as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return makeError(
                "Error: tasks must be a non-empty array.",
                "Error: tasks must be a non-empty array.",
                "input_error",
            );
        }
        if (tasks.length > DEFAULT_DELEGATE_PARALLEL_MAX_TASKS) {
            return makeError(
                `Error: delegate_parallel accepts at most ${DEFAULT_DELEGATE_PARALLEL_MAX_TASKS} tasks per call (received ${tasks.length}).`,
                "",
                "permission_or_policy",
            );
        }

        const preparedTasks = tasks.map((t, i) => {
            const instruction = typeof t.instruction === "string" ? t.instruction.trim() : "";
            if (!instruction) {
                throw new Error(`Task[${i}]: instruction is required and cannot be empty.`);
            }
            const delegationContract = readStructuredDelegationContractArgs(t);
            return {
                laneId: `lane_${i + 1}`,
                instruction,
                agentId: typeof t.agent_id === "string" ? t.agent_id : undefined,
                context: (typeof t.context === "object" && t.context !== null ? t.context : undefined) as Record<string, unknown> | undefined,
                delegationContract,
            };
        });

        const sharedTeamMetadata = buildParallelTeamMetadata({
            managerAgentId: context.agentId ?? context.launchSpec?.agentId,
            tasks: preparedTasks,
        });

        // Validate and normalize tasks
        const normalized = preparedTasks.map((prepared) => {
            return buildSubAgentLaunchSpec(context, {
                instruction: prepared.instruction,
                agentId: prepared.agentId,
                context: prepared.context,
                channel: "subtask",
                delegationSource: "delegate_parallel",
                aggregationMode: "parallel_collect",
                ownership: prepared.delegationContract.ownership,
                acceptance: prepared.delegationContract.acceptance,
                deliverableContract: prepared.delegationContract.deliverableContract,
                team: {
                    ...sharedTeamMetadata,
                    currentLaneId: prepared.laneId,
                },
            });
        });

        try {
            const results = await spawnParallelInBatches(
                context.agentCapabilities.spawnParallel,
                normalized,
                DEFAULT_DELEGATE_PARALLEL_MAX_CONCURRENT,
                context.abortSignal,
            );
            const reviewed = results.map((result, index) => {
                const gate = result.success
                    ? evaluateDelegationResultGate({
                        output: result.output,
                        contract: normalized[index]?.delegationProtocol,
                    })
                    : undefined;
                const accepted = result.success && (!gate || !gate.enforced || gate.accepted);
                const gateReport = gate ? renderDelegationResultGateReport(gate) : undefined;
                const gateError = gate?.enforced && !gate.accepted
                    ? `Delegation acceptance gate rejected the sub-agent result. ${gate.summary}`
                    : undefined;
                return {
                    result,
                    gate,
                    accepted,
                    gateReport,
                    gateError,
                };
            });

            const workerSuccessCount = reviewed.filter(({ result }) => result.success).length;
            const acceptedCount = reviewed.filter(({ accepted }) => accepted).length;
            const gateRejectedCount = reviewed.filter(({ result, gate }) => result.success && gate?.enforced && !gate.accepted).length;
            const allSuccess = reviewed.every(({ accepted }) => accepted);
            const delegationResults = reviewed.map(({ result, accepted, gate }, index) => ({
                label: `Task ${index + 1} / ${normalized[index]?.agentId ?? "default"}`,
                laneId: preparedTasks[index]?.laneId,
                scopeSummary: preparedTasks[index]?.delegationContract.ownership?.scopeSummary
                    ?? sharedTeamMetadata.memberRoster.find((member) => member.laneId === preparedTasks[index]?.laneId)?.scopeSummary,
                dependsOn: sharedTeamMetadata.memberRoster.find((member) => member.laneId === preparedTasks[index]?.laneId)?.dependsOn,
                handoffTo: sharedTeamMetadata.memberRoster.find((member) => member.laneId === preparedTasks[index]?.laneId)?.handoffTo,
                workerSuccess: result.success,
                accepted,
                error: result.error,
                taskId: result.taskId,
                sessionId: result.sessionId,
                outputPath: result.outputPath,
                acceptanceGate: gate,
            }));
            const maxAggregateBytes = resolveMaxAggregateBytes(context.policy.maxResponseBytes);
            const outputBuilder = new BoundedUtf8TextBuilder(maxAggregateBytes);
            outputBuilder.append(
                `[delegate_parallel] ${results.length} tasks completed (${workerSuccessCount} worker succeeded, ${acceptedCount} accepted, ${gateRejectedCount} rejected by acceptance gate).`,
            );
            reviewed.forEach(({ result, accepted, gateReport, gateError }, index) => {
                const taskLabel = normalized[index]?.agentId ?? "default";
                const status = accepted ? "ACCEPTED" : gateError ? "REJECTED" : "FAILED";
                outputBuilder.append("\n\n---\n\n");
                outputBuilder.append(`[Task ${index + 1} / ${taskLabel}] ${status}\n`);
                if (accepted) {
                    outputBuilder.append(result.output);
                } else if (gateError) {
                    outputBuilder.append(result.output);
                    outputBuilder.append("\n\n");
                    outputBuilder.append(gateError);
                } else {
                    outputBuilder.append(result.error ?? "unknown error");
                }
                const meta = [
                    gateReport ?? "",
                    result.taskId ? `Task ID: ${result.taskId}` : "",
                    result.sessionId ? `Session ID: ${result.sessionId}` : "",
                    result.outputPath ? `Output Path: ${result.outputPath}` : "",
                ].filter(Boolean).join("\n");
                if (meta) {
                    outputBuilder.append("\n");
                    outputBuilder.append(meta);
                }
            });
            const output = outputBuilder.finish(
                `\n\n[delegate_parallel output truncated at ${maxAggregateBytes} bytes; use Task ID, Session ID, or Output Path metadata to inspect full results.]`,
            );
            const delegationMetadata = buildDelegationResultToolMetadata({
                delegationResults,
                acceptedCount,
                gateRejectedCount,
                workerSuccessCount,
                followUpStrategy: buildDelegationResultFollowUpStrategy({
                    toolName: "delegate_parallel",
                    requestArguments: args as Record<string, unknown>,
                    delegationResults,
                }),
                team: sharedTeamMetadata,
            });

            return {
                id,
                name,
                success: allSuccess,
                output,
                ...(!allSuccess
                    ? { failureKind: gateRejectedCount > 0 ? "business_logic_error" : "environment_error" }
                    : {}),
                durationMs: Date.now() - start,
                metadata: {
                    ...delegationMetadata,
                    delegationBudget: {
                        maxTasks: DEFAULT_DELEGATE_PARALLEL_MAX_TASKS,
                        maxConcurrent: DEFAULT_DELEGATE_PARALLEL_MAX_CONCURRENT,
                        maxAggregateBytes,
                        taskCount: tasks.length,
                        outputBytesObserved: outputBuilder.observedBytes,
                        outputBytesReturned: Buffer.byteLength(output, "utf-8"),
                        truncated: outputBuilder.wasTruncated,
                    },
                },
            };
        } catch (err) {
            const cancelled = isAbortError(err) || context.abortSignal?.aborted;
            return makeError(
                cancelled ? readAbortReason(context.abortSignal) : (err instanceof Error ? err.message : String(err)),
                "",
                "environment_error",
            );
        }
    },
}, {
    family: "session-orchestration",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: false,
    riskLevel: "medium",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Delegate multiple tasks to sub-agents in parallel",
    resultSchema: {
        kind: "text",
        description: "Aggregated parallel delegation status and outputs.",
    },
    outputPersistencePolicy: "conversation",
});

async function spawnParallelInBatches(
    spawnParallel: (tasks: SpawnSubAgentOptions[]) => Promise<SubAgentResult[]>,
    tasks: SpawnSubAgentOptions[],
    maxConcurrent: number,
    signal?: AbortSignal,
): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    for (let start = 0; start < tasks.length; start += maxConcurrent) {
        throwIfAborted(signal);
        const batch = tasks.slice(start, start + maxConcurrent);
        results.push(...await spawnParallel(batch));
    }
    return results;
}

class BoundedUtf8TextBuilder {
    private readonly chunks: string[] = [];
    private returnedBytes = 0;
    private truncated = false;
    observedBytes = 0;

    constructor(private readonly maxBytes: number) {}

    get wasTruncated(): boolean {
        return this.truncated;
    }

    append(value: string): void {
        const bytes = Buffer.byteLength(value, "utf-8");
        this.observedBytes += bytes;
        const remaining = this.maxBytes - this.returnedBytes;
        if (remaining <= 0) {
            this.truncated = this.truncated || bytes > 0;
            return;
        }
        if (bytes <= remaining) {
            this.chunks.push(value);
            this.returnedBytes += bytes;
            return;
        }
        const prefix = takeUtf8Prefix(value, remaining);
        this.chunks.push(prefix);
        this.returnedBytes += Buffer.byteLength(prefix, "utf-8");
        this.truncated = true;
    }

    finish(truncationMarker: string): string {
        const output = this.chunks.join("");
        if (!this.truncated) return output;
        const markerBytes = Buffer.byteLength(truncationMarker, "utf-8");
        if (markerBytes >= this.maxBytes) {
            return takeUtf8Prefix(truncationMarker, this.maxBytes);
        }
        return `${takeUtf8Prefix(output, this.maxBytes - markerBytes)}${truncationMarker}`;
    }
}

function resolveMaxAggregateBytes(policyLimit: number): number {
    const normalizedPolicyLimit = Number.isFinite(policyLimit) && policyLimit > 0
        ? Math.floor(policyLimit)
        : DEFAULT_DELEGATE_PARALLEL_MAX_AGGREGATE_BYTES;
    return Math.min(DEFAULT_DELEGATE_PARALLEL_MAX_AGGREGATE_BYTES, normalizedPolicyLimit);
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
    if (maxBytes <= 0) return "";
    const buffer = Buffer.from(value, "utf-8");
    if (buffer.length <= maxBytes) return value;
    let end = maxBytes;
    while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
        end -= 1;
    }
    return buffer.subarray(0, end).toString("utf-8");
}

function buildParallelTeamMetadata(input: {
    managerAgentId?: string;
    tasks: Array<{
        laneId: string;
        instruction: string;
        agentId?: string;
        delegationContract: ReturnType<typeof readStructuredDelegationContractArgs>;
    }>;
}): DelegationTeamMetadata {
    const mode = inferParallelTeamMode(input.tasks);
    const sharedGoal = inferParallelSharedGoal(input.tasks);
    const verifierLaneIds = input.tasks
        .filter((task) => inferLaneRole(task) === "verifier")
        .map((task) => task.laneId);
    const implementationLaneIds = input.tasks
        .filter((task) => inferLaneRole(task) !== "verifier")
        .map((task) => task.laneId);
    return {
        id: `team_${crypto.randomUUID().slice(0, 8)}`,
        mode,
        sharedGoal,
        ...(input.managerAgentId ? { managerAgentId: input.managerAgentId } : {}),
        memberRoster: input.tasks.map((task) => ({
            laneId: task.laneId,
            ...(task.agentId ? { agentId: task.agentId } : {}),
            ...(inferLaneRole(task) ? { role: inferLaneRole(task) } : {}),
            ...(task.delegationContract.ownership?.scopeSummary
                ? { scopeSummary: task.delegationContract.ownership.scopeSummary }
                : { scopeSummary: summarizeInstruction(task.instruction) }),
            ...(inferLaneRole(task) === "verifier" && implementationLaneIds.length > 0
                ? { dependsOn: implementationLaneIds }
                : {}),
            ...(inferLaneRole(task) !== "verifier" && verifierLaneIds.length > 0
                ? { handoffTo: verifierLaneIds }
                : {}),
        })),
    };
}

function inferParallelTeamMode(input: Array<{ agentId?: string; instruction: string }>): DelegationTeamMode {
    const agentIds = input
        .map((task) => task.agentId?.trim().toLowerCase())
        .filter(Boolean) as string[];

    if (agentIds.length > 0 && agentIds.every((id) => id.includes("verifier"))) {
        return "verify_swarm";
    }
    if (agentIds.length > 0 && agentIds.every((id) => id.includes("research"))) {
        return "research_grid";
    }
    if (agentIds.length > 0 && agentIds.every((id) => id.includes("coder"))) {
        return "parallel_patch";
    }
    return "parallel_subtasks";
}

function inferParallelSharedGoal(
    input: Array<{ instruction: string }>,
): string {
    if (input.length === 1) {
        return summarizeInstruction(input[0]?.instruction ?? "");
    }
    const first = summarizeInstruction(input[0]?.instruction ?? "");
    return `Coordinate ${input.length} delegated lanes and fan the results back into the manager. First lane: ${first}`;
}

function summarizeInstruction(instruction: string): string {
    const normalized = instruction.trim().replace(/\s+/g, " ");
    if (!normalized) {
        return "Execute delegated work.";
    }
    return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function inferLaneRole(task: {
    agentId?: string;
    delegationContract: ReturnType<typeof readStructuredDelegationContractArgs>;
}): "coder" | "researcher" | "verifier" | undefined {
    const agentId = task.agentId?.trim().toLowerCase();
    if (agentId?.includes("verifier")) {
        return "verifier";
    }
    if (agentId?.includes("research")) {
        return "researcher";
    }
    if (agentId?.includes("coder")) {
        return "coder";
    }
    if (task.delegationContract.deliverableContract?.format === "verification_report") {
        return "verifier";
    }
    return undefined;
}
