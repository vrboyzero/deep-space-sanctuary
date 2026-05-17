import type { JsonObject, Tool, ToolContext } from "../../types.js";
import { buildCapabilityPlanSaveInput, collectCapabilityPlanActualUsage } from "./capability-plan-utils.js";
import { fail, formatCapabilityPlan, formatTaskNode, inferGoalId, ok } from "./shared.js";

type CommanderDecision = "accept" | "rework" | "escalate";
type FinalApprovalMode = "user_required" | "agent_auto_complete";

function parseDecision(value: unknown): CommanderDecision | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "accept":
    case "rework":
    case "escalate":
      return normalized;
    default:
      return undefined;
  }
}

function buildDecisionNote(
  decision: CommanderDecision,
  summary?: string,
  note?: string,
  gateSummary?: string,
  approvalMode?: string,
  revision?: number,
): string {
  const parts = [
    `commander decision=${decision}`,
    summary ? `summary=${summary}` : "",
    note ? `note=${note}` : "",
    gateSummary ? `gate=${gateSummary}` : "",
    approvalMode ? `approval=${approvalMode}` : "",
    typeof revision === "number" ? `revision=${revision}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

function readFinalApprovalMode(
  explicitValue: unknown,
  fallback: FinalApprovalMode | undefined,
): FinalApprovalMode {
  if (explicitValue === false) return "agent_auto_complete";
  if (explicitValue === true) return "user_required";
  return fallback ?? "user_required";
}

function readRuntimeEnv(context: ToolContext, name: string): string | undefined {
  const value = context.readEnv?.(name);
  if (typeof value === "string") {
    return value;
  }
  const fallback = process.env[name];
  return fallback && fallback.trim() ? fallback.trim() : undefined;
}

function resolveAutoReworkEnabled(context: ToolContext): boolean {
  return readRuntimeEnv(context, "BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED") === "true";
}

function buildReworkContext(input: {
  summary?: string;
  note?: string;
  gateSummary?: string;
  gateManagerActionHint?: string;
  gateReasons?: string[];
  previousReason?: string;
  previousRevisionCount?: number;
  nextRevisionCount: number;
}) {
  const lines = [
    input.summary?.trim() || "",
    input.note?.trim() || "",
    input.gateManagerActionHint?.trim() || "",
    input.gateSummary?.trim() || "",
    ...(Array.isArray(input.gateReasons)
      ? input.gateReasons.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
      : []),
  ].filter(Boolean);
  const uniqueLines = [...new Set(lines)];
  const quickSummary = uniqueLines[0] || "Commander rework requested.";
  const historyParts = [
    `Rework Revision ${input.nextRevisionCount}`,
    typeof input.previousRevisionCount === "number" && input.previousRevisionCount > 0
      ? `previous=${input.previousRevisionCount}`
      : "",
    input.previousReason?.trim() ? `last=${input.previousReason.trim()}` : "",
    uniqueLines.length > 0 ? `current=${uniqueLines.join(" | ")}` : "",
  ].filter(Boolean);
  return {
    persistedReason: historyParts.join(" || "),
    quickSummary,
    historySummary: historyParts.join(" | "),
  };
}

function resolveReworkTargetAgentIds(plan: {
  subAgents?: Array<{ agentId?: string }>;
  orchestration?: {
    delegationResults?: Array<{ agentId?: string; status?: string }>;
    reworkTargetAgentIds?: string[];
  };
}): string[] {
  const failedAgentIds = (plan.orchestration?.delegationResults ?? [])
    .filter((item) => item?.status === "failed" && typeof item.agentId === "string" && item.agentId.trim())
    .map((item) => item.agentId!.trim());
  if (failedAgentIds.length > 0) {
    return [...new Set(failedAgentIds)];
  }
  if (Array.isArray(plan.orchestration?.reworkTargetAgentIds) && plan.orchestration.reworkTargetAgentIds.length > 0) {
    return [...new Set(plan.orchestration.reworkTargetAgentIds.filter(Boolean))];
  }
  return (plan.subAgents ?? [])
    .map((item) => typeof item.agentId === "string" ? item.agentId.trim() : "")
    .filter(Boolean);
}

export const goalCommanderDecideTool: Tool = {
  definition: {
    name: "goal_commander_decide",
    description: "对 commander 治理节点执行显式决策，并映射到 validating / rework / done 状态；支持升级到用户最终审批或自动收口。",
    parameters: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "可选，目标 ID；默认从当前 goal 会话推断。" },
        node_id: { type: "string", description: "节点 ID。" },
        decision: {
          type: "string",
          description: "Commander 决策。",
          enum: ["accept", "rework", "escalate"],
        },
        summary: { type: "string", description: "可选，决策摘要。" },
        note: { type: "string", description: "可选，补充备注。" },
        require_user_approval: {
          type: "boolean",
          description: "可选，仅对 decision=escalate 生效。未传时跟随 capability plan 的默认审批策略；true 表示进入 validating 等待用户最终审批，false 表示由 Agent 自动收口为 done。",
        },
        run_id: { type: "string", description: "可选，绑定 runId。" },
      },
      required: ["node_id", "decision"],
    },
  },
  async execute(args: JsonObject, context: ToolContext) {
    const name = "goal_commander_decide";
    if (!context.goalCapabilities?.getCapabilityPlan || !context.goalCapabilities?.saveCapabilityPlan) {
      return fail(name, "Goal capability plan governance is not available in the current runtime.");
    }
    const goalId = inferGoalId(args.goal_id, context.conversationId);
    if (!goalId) return fail(name, "缺少参数: goal_id，且当前会话无法推断所属 goal。");
    const nodeId = String(args.node_id ?? "").trim();
    if (!nodeId) return fail(name, "缺少参数: node_id");
    const decision = parseDecision(args.decision);
    if (!decision) return fail(name, "缺少参数: decision，且必须是 accept / rework / escalate。");

    const summary = String(args.summary ?? "").trim() || undefined;
    const note = String(args.note ?? "").trim() || undefined;
    const runId = String(args.run_id ?? "").trim() || undefined;

    try {
      const plan = await context.goalCapabilities.getCapabilityPlan(goalId, nodeId);
      if (!plan) {
        return fail(name, `未找到节点 ${nodeId} 的 capability plan。`);
      }
      if (plan.governanceMode !== "commander") {
        return fail(name, `节点 ${nodeId} 当前不是 commander 治理模式，无法使用该工具。`);
      }

      const gate = plan.orchestration?.acceptanceGate;
      if (!gate) {
        return fail(name, `节点 ${nodeId} 尚未生成 acceptance gate，无法执行 commander 决策。`);
      }
      if (decision === "accept" && gate.status !== "accepted") {
        return fail(name, `当前 acceptance gate 状态为 ${gate.status}，不能执行 accept。`);
      }

      const resolvedFinalApprovalMode = readFinalApprovalMode(
        args.require_user_approval,
        plan.orchestration?.finalApprovalMode,
      );
      const nextReworkRevisionCount = decision === "rework"
        ? (plan.orchestration?.reworkRevisionCount ?? 0) + 1
        : (plan.orchestration?.reworkRevisionCount ?? 0);
      const reworkTargetAgentIds = decision === "rework"
        ? resolveReworkTargetAgentIds(plan)
        : (plan.orchestration?.reworkTargetAgentIds ?? []);
      const reworkContext = decision === "rework"
        ? buildReworkContext({
          summary,
          note,
          gateSummary: gate.summary,
          gateManagerActionHint: gate.managerActionHint,
          gateReasons: gate.reasons,
          previousReason: plan.orchestration?.lastReworkReason,
          previousRevisionCount: plan.orchestration?.reworkRevisionCount,
          nextRevisionCount: nextReworkRevisionCount,
        })
        : null;
      const autoReworkEnabled = resolveAutoReworkEnabled(context);
      const now = new Date().toISOString();
      const decisionNote = buildDecisionNote(
        decision,
        summary,
        decision === "rework" ? reworkContext?.persistedReason : note,
        gate.summary,
        decision === "escalate"
          ? resolvedFinalApprovalMode
          : undefined,
        decision === "rework" ? nextReworkRevisionCount : undefined,
      );
      const orchestration = {
        ...plan.orchestration,
        finalApprovalMode: resolvedFinalApprovalMode,
        reworkRevisionCount: nextReworkRevisionCount > 0 ? nextReworkRevisionCount : plan.orchestration?.reworkRevisionCount,
        lastReworkReason: decision === "rework"
          ? (reworkContext?.persistedReason ?? note ?? summary ?? gate.managerActionHint ?? gate.summary)
          : plan.orchestration?.lastReworkReason,
        lastReworkAt: decision === "rework" ? now : plan.orchestration?.lastReworkAt,
        reworkTargetAgentIds: decision === "rework" ? reworkTargetAgentIds : plan.orchestration?.reworkTargetAgentIds,
        reworkContext: decision === "rework"
          ? {
            quickSummary: reworkContext?.quickSummary,
            historySummary: reworkContext?.historySummary,
            persistedReason: reworkContext?.persistedReason,
          }
          : plan.orchestration?.reworkContext,
        notes: [...(plan.orchestration?.notes ?? []), decisionNote],
      };
      const actualUsage = collectCapabilityPlanActualUsage(context);
      const savedPlan = await context.goalCapabilities.saveCapabilityPlan(
        goalId,
        nodeId,
        buildCapabilityPlanSaveInput(plan, {
          runId,
          orchestration,
          actualUsage,
        }),
      );

      const transitionSummary = summary ?? gate.summary;
      if (decision === "accept") {
        if (!context.goalCapabilities.markTaskNodeValidating) {
          return fail(name, "Goal capability is missing markTaskNodeValidating.");
        }
        const result = await context.goalCapabilities.markTaskNodeValidating(goalId, nodeId, {
          summary: transitionSummary,
          runId,
        });
        return ok(
          name,
          `Commander 已接受该节点，状态已映射到 validating。\n\nDecision: accept -> validating\nAcceptance Gate: ${gate.status} | ${gate.summary}\n\n${formatTaskNode(result.node)}\n\n${formatCapabilityPlan(savedPlan)}`,
        );
      }

      if (decision === "rework") {
        if (autoReworkEnabled) {
          if (!context.goalCapabilities.claimTaskNode) {
            return fail(name, "Goal capability is missing claimTaskNode.");
          }
          const result = await context.goalCapabilities.claimTaskNode(goalId, nodeId, {
            summary: transitionSummary,
            runId,
          });
          return ok(
            name,
            `Commander 已下发返工，并保持节点留在 commander 治理执行链路中。\n\nDecision: rework -> in_progress\nAuto Rework: enabled\nRework Revision: ${nextReworkRevisionCount}\nRework Targets: ${reworkTargetAgentIds.length > 0 ? reworkTargetAgentIds.join(", ") : "(none)"}\nAcceptance Gate: ${gate.status} | ${gate.summary}\n\n${formatTaskNode(result.node)}\n\n${formatCapabilityPlan(savedPlan)}`,
          );
        }
        if (!context.goalCapabilities.blockTaskNode) {
          return fail(name, "Goal capability is missing blockTaskNode.");
        }
        const blockReason = reworkContext?.persistedReason ?? note ?? summary ?? gate.managerActionHint ?? gate.summary;
        const result = await context.goalCapabilities.blockTaskNode(goalId, nodeId, {
          summary: transitionSummary,
          blockReason,
          runId,
        });
        return ok(
          name,
          `Commander 已下发返工，状态已映射到 blocked。\n\nDecision: rework -> blocked\nAuto Rework: disabled\nRework Revision: ${nextReworkRevisionCount}\nRework Targets: ${reworkTargetAgentIds.length > 0 ? reworkTargetAgentIds.join(", ") : "(none)"}\nAcceptance Gate: ${gate.status} | ${gate.summary}\n\n${formatTaskNode(result.node)}\n\n${formatCapabilityPlan(savedPlan)}`,
        );
      }

      if (resolvedFinalApprovalMode === "user_required") {
        if (!context.goalCapabilities.markTaskNodeValidating) {
          return fail(name, "Goal capability is missing markTaskNodeValidating.");
        }
        const result = await context.goalCapabilities.markTaskNodeValidating(goalId, nodeId, {
          summary: transitionSummary,
          runId,
        });
        return ok(
          name,
          `Commander 已升级到用户最终决策，状态已映射到 validating。\n\nDecision: escalate -> validating\nFinal Approval: user_required\nAcceptance Gate: ${gate.status} | ${gate.summary}\n\n${formatTaskNode(result.node)}\n\n${formatCapabilityPlan(savedPlan)}`,
        );
      }

      if (!context.goalCapabilities.completeTaskNode) {
        return fail(name, "Goal capability is missing completeTaskNode.");
      }
      const result = await context.goalCapabilities.completeTaskNode(goalId, nodeId, {
        summary: transitionSummary,
        runId,
      });
      return ok(
        name,
        `Commander 已按自动审批模式收口该节点，状态已映射到 done。\n\nDecision: escalate -> done\nFinal Approval: agent_auto_complete\nAcceptance Gate: ${gate.status} | ${gate.summary}\n\n${formatTaskNode(result.node)}\n\n${formatCapabilityPlan(savedPlan)}`,
      );
    } catch (err) {
      return fail(name, `执行 commander 决策失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
