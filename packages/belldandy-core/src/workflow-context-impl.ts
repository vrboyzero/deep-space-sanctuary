/**
 * WorkflowContext 实现 — 动态工作流编排 API 核心逻辑
 *
 * 类型定义在 `@belldandy/agent` 的 `workflow-context.ts`，本文件提供工厂函数
 * `createWorkflowContext(deps)`，集成：
 * - SubAgentOrchestrator（子 Agent 编排）
 * - WorkflowJournal（事件溯源缓存）
 * - WorkflowBudgetGuard（预算熔断）
 * - computeWorkflowFingerprint（稳定指纹）
 *
 * agent() 流程：
 *   计算 callKey → 计算 fingerprint → journal.lookup()
 *     命中 → incrementCacheHit → 返回缓存（cacheHit=true）
 *     未命中 → reserveAgentCall() → orchestrator.spawn()
 *       成功 → reservation.settle() → journal.record() → 返回
 *       失败 → journal.recordError() → 返回结构化失败项
 *
 * parallel() / parallelMap()：
 *   信号量限制并发上限，全部完成后返回结构化结果数组
 *   单个失败不触发全局 reject，返回 { ok: false, error, ... }
 *
 * pipeline()：
 *   无屏障流水线，每个 item 独立流经所有 stage，处理快的 item 不必等待
 *   同批其他 item。某个 item 在某 stage 失败后跳过后续 stage，返回结构化失败项。
 */

import type {
  AgentCallOptions,
  AgentLaunchSpec,
  AgentLaunchSpecInput,
  WorkflowContext,
  WorkflowTaskResult,
} from "@belldandy/agent";
import {
  normalizeAgentLaunchSpecWithCatalog,
  type SubAgentOrchestrator,
  type SubAgentEvent,
  type SpawnOptions,
} from "@belldandy/agent";
import type { WorkflowJournal } from "./workflow-journal.js";
import type { WorkflowBudgetGuard } from "./workflow-budget-guard.js";
import { runWorkflowAgentCall } from "./workflow-agent-call-runner.js";
import {
  DEFAULT_WORKFLOW_BATCH_LIMITS,
  runWorkflowBatch,
  WORKFLOW_BATCH_ENTRY_METADATA_BYTES,
  type WorkflowBatchLimits,
} from "./workflow-batch-runner.js";
import {
  computeWorkflowFingerprint,
  computeStableHash,
  computeWorkflowToolPolicyHash,
} from "./workflow-fingerprint.js";
import type { AgentExecutionFingerprintInputResolver } from "./workflow-runtime.js";

const WORKFLOW_PENDING_LEASE_MS = 30_000;
const WORKFLOW_PENDING_RENEW_INTERVAL_MS = 10_000;

export class WorkflowPendingClaimConflictError extends Error {
  readonly code = "workflow_pending_claim_conflict";

  constructor(callKey: string) {
    super(`Workflow pending claim conflict [${callKey}].`);
    this.name = "WorkflowPendingClaimConflictError";
  }
}

export class WorkflowPendingClaimLostError extends Error {
  readonly code = "workflow_pending_claim_lost";

  constructor(callKey: string) {
    super(`Workflow pending claim lost [${callKey}].`);
    this.name = "WorkflowPendingClaimLostError";
  }
}

// ─── 依赖类型 ─────────────────────────────────────────────────────────────

export type WorkflowContextCallbacks = {
  onPhase?: (title: string) => void;
  onLog?: (msg: string) => void;
  onAgentEvent?: (event: SubAgentEvent) => void;
};

export type WorkflowContextDeps = {
  orchestrator: SubAgentOrchestrator;
  journal: WorkflowJournal;
  budgetGuard: WorkflowBudgetGuard;
  /** 父工作流的终止信号；会透传到每次 ctx.agent() 调用。 */
  abortSignal?: AbortSignal;
  /** 工作流启动参数（确定性锚点） */
  args: Record<string, unknown>;
  /** 脚本内容 hash */
  scriptHash: string;
  /** 工作流名称 */
  workflowName: string;
  /** 工作流版本（默认 "1.0.0"） */
  workflowVersion?: string;
  /** 父会话 ID */
  parentConversationId: string;
  /** 渠道 */
  channel: string;
  /** journal ID（用于断点续传） */
  journalId: string;
  /** 每次 WorkflowRuntime.run() 唯一的 Journal lease owner。 */
  leaseOwnerId: string;
  /** 并发上限（默认 6） */
  maxConcurrent?: number;
  /** runtime 启动期解析的 batch items/queue/output hard cap。 */
  batchLimits?: WorkflowBatchLimits;
  /** 回调 */
  callbacks?: WorkflowContextCallbacks;
  /**
   * 可选：WorkflowRuntime 引用，用于支持 workflow() 嵌套调用。
   * 未提供时调用 workflow() 会抛错。
   */
  runtime?: WorkflowRuntimeLike;
  /**
   * 当前嵌套深度。顶层工作流为 0，子工作流为 1。
   * workflow() 限制 1 层深度，depth >= 1 时禁止再次嵌套。
   */
  depth?: number;
  /**
   * 最大嵌套深度（默认 1）。子工作流构建 ctx 时传入 depth+1。
   */
  maxDepth?: number;
  /**
   * 可选：stateDir，子工作流 file 模式加载脚本时需要。
   */
  stateDir?: string;
  /**
   * 可选：把真实生效的 agent profile / prompt / tool policy 指纹输入
   * 注入到 workflow fingerprint，避免缓存命中与实际执行语义脱节。
   */
  resolveAgentExecutionFingerprintInputs?: AgentExecutionFingerprintInputResolver;
  /**
   * 可选：按与 orchestrator 一致的规则把 agent() 调用解析成真实 launchSpec。
   * runtime 会优先注入，避免依赖 orchestrator 实例上的额外方法。
   */
  resolveWorkflowAgentLaunchSpec?: (input: Pick<
    AgentLaunchSpecInput,
    | "instruction"
    | "parentConversationId"
    | "modelOverride"
    | "role"
    | "allowedToolFamilies"
    | "maxToolRiskLevel"
    | "timeoutMs"
    | "delegationProtocol"
  >) => AgentLaunchSpec;
};

/**
 * WorkflowRuntime 的最小接口约束，避免循环导入。
 * workflow-context-impl 只需要 run() 方法。
 *
 * source 类型故意用宽松的联合类型，使 WorkflowRuntime.run() 的
 * WorkflowScriptSource（含 inline）能兼容赋值给这个接口。
 */
export interface WorkflowRuntimeLike {
  run(opts: {
    source: { kind: string; name?: string; path?: string; code?: string };
    args?: Record<string, unknown>;
    parentConversationId: string;
    channel: string;
    resumeJournalId?: string;
    stateDir?: string;
    budget?: Record<string, unknown>;
    maxConcurrent?: number;
    sharedBudgetGuard?: WorkflowBudgetGuard;
    resolveAgentExecutionFingerprintInputs?: AgentExecutionFingerprintInputResolver;
    resolveWorkflowAgentLaunchSpec?: WorkflowContextDeps["resolveWorkflowAgentLaunchSpec"];
    abortSignal?: AbortSignal;
    depth?: number;
  }): Promise<WorkflowRunResultLike>;
}

export interface WorkflowRunResultLike {
  success: boolean;
  output: string;
  journalId: string;
  error?: string;
}

// ─── 工厂函数 ─────────────────────────────────────────────────────────────

export function createWorkflowContext(deps: WorkflowContextDeps): WorkflowContext {
  const {
    orchestrator,
    journal,
    budgetGuard,
    args,
    scriptHash,
    workflowName,
    workflowVersion = "1.0.0",
    parentConversationId,
    channel,
    journalId,
    leaseOwnerId,
    maxConcurrent = 6,
    batchLimits = DEFAULT_WORKFLOW_BATCH_LIMITS,
    callbacks,
    runtime,
    depth = 0,
    maxDepth = 1,
    stateDir,
    resolveAgentExecutionFingerprintInputs,
    resolveWorkflowAgentLaunchSpec,
    abortSignal,
  } = deps;

  let agentCallIndex = 0;
  let phaseId = "root";

  const ctx: WorkflowContext = {
    args,
    abortSignal,

    async agent(prompt, opts): Promise<string> {
      throwIfWorkflowAborted(abortSignal);
      const callKey = opts?.callKey ?? `${phaseId}/${agentCallIndex}`;
      agentCallIndex++;

      const resolvedLaunchSpec = resolveWorkflowAgentLaunchSpec
        ? resolveWorkflowAgentLaunchSpec({
          instruction: prompt,
          parentConversationId,
          modelOverride: opts?.model,
          role: opts?.role,
          allowedToolFamilies: opts?.allowedToolFamilies,
          maxToolRiskLevel: opts?.maxToolRiskLevel,
          timeoutMs: opts?.timeoutMs,
          delegationProtocol: opts?.delegationProtocol,
        })
        : typeof (orchestrator as unknown as { resolveLaunchSpec?: (...args: unknown[]) => unknown }).resolveLaunchSpec === "function"
          ? (orchestrator as unknown as {
            resolveLaunchSpec: (input: Parameters<NonNullable<WorkflowContextDeps["resolveWorkflowAgentLaunchSpec"]>>[0]) => ReturnType<NonNullable<WorkflowContextDeps["resolveWorkflowAgentLaunchSpec"]>>;
          }).resolveLaunchSpec({
            instruction: prompt,
            parentConversationId,
            modelOverride: opts?.model,
            role: opts?.role,
            allowedToolFamilies: opts?.allowedToolFamilies,
            maxToolRiskLevel: opts?.maxToolRiskLevel,
            timeoutMs: opts?.timeoutMs,
            delegationProtocol: opts?.delegationProtocol,
          })
          : normalizeAgentLaunchSpecWithCatalog({
        instruction: prompt,
        parentConversationId,
        agentId: "default",
        modelOverride: opts?.model,
        role: opts?.role,
        allowedToolFamilies: opts?.allowedToolFamilies,
        maxToolRiskLevel: opts?.maxToolRiskLevel,
        timeoutMs: opts?.timeoutMs,
        delegationProtocol: opts?.delegationProtocol,
      });
      const resolvedFingerprintInputs = resolveAgentExecutionFingerprintInputs?.({
        agentId: resolvedLaunchSpec.agentId,
        profileId: resolvedLaunchSpec.profileId,
        modelOverride: resolvedLaunchSpec.modelOverride,
        role: resolvedLaunchSpec.role,
        allowedToolFamilies: resolvedLaunchSpec.allowedToolFamilies,
        maxToolRiskLevel: resolvedLaunchSpec.maxToolRiskLevel,
        permissionMode: resolvedLaunchSpec.permissionMode,
        policySummary: resolvedLaunchSpec.policySummary,
      });
      const resolvedToolPolicyHash = resolvedFingerprintInputs?.toolPolicyHash
        ?? computeWorkflowToolPolicyHash({
          role: resolvedLaunchSpec.role,
          permissionMode: resolvedLaunchSpec.permissionMode,
          allowedToolFamilies: resolvedLaunchSpec.allowedToolFamilies,
          maxToolRiskLevel: resolvedLaunchSpec.maxToolRiskLevel,
          policySummary: resolvedLaunchSpec.policySummary,
        });
      const persistedOpts = {
        ...(opts ?? {}),
        model: resolvedLaunchSpec.modelOverride,
        agentProfileId: resolvedFingerprintInputs?.agentProfileId ?? resolvedLaunchSpec.profileId,
        systemPromptHash: resolvedFingerprintInputs?.systemPromptHash,
        toolPolicyHash: resolvedToolPolicyHash,
        role: resolvedLaunchSpec.role,
        permissionMode: resolvedLaunchSpec.permissionMode,
        allowedToolFamilies: resolvedLaunchSpec.allowedToolFamilies,
        maxToolRiskLevel: resolvedLaunchSpec.maxToolRiskLevel,
        policySummary: resolvedLaunchSpec.policySummary,
      };

      // 计算 fingerprint
      const fingerprint = computeWorkflowFingerprint({
        schemaVersion: 1,
        workflowName,
        workflowVersion,
        scriptHash,
        callKey,
        prompt,
        model: resolvedLaunchSpec.modelOverride,
        agentProfileId: resolvedFingerprintInputs?.agentProfileId ?? resolvedLaunchSpec.profileId,
        systemPromptHash: resolvedFingerprintInputs?.systemPromptHash,
        toolPolicyHash: resolvedToolPolicyHash,
        role: resolvedLaunchSpec.role,
        allowedToolFamilies: resolvedLaunchSpec.allowedToolFamilies,
        maxToolRiskLevel: resolvedLaunchSpec.maxToolRiskLevel,
        delegationHash: opts?.delegationProtocol
          ? computeStableHash(opts.delegationProtocol)
          : undefined,
        workflowArgs: args,
      });

      // 查 Journal 缓存
      const hit = journal.lookup(journalId, fingerprint);
      if (hit) {
        journal.incrementCacheHit(journalId, fingerprint);
        callbacks?.onLog?.(`[cache hit] ${callKey}`);
        return hit.result;
      }

      const pendingClaim = journal.claimPending({
        journalId,
        workflowName,
        scriptHash,
        callKey,
        fingerprint,
        prompt,
        optsJson: JSON.stringify(persistedOpts),
        ownerId: leaseOwnerId,
        leaseDurationMs: WORKFLOW_PENDING_LEASE_MS,
      });
      if (pendingClaim.outcome === "conflict") {
        throw new WorkflowPendingClaimConflictError(callKey);
      }

      // 调用 orchestrator。这里统一走 launchSpec，避免 legacy spawnOpts 丢失
      // role / timeout / tool 限制 / modelOverride 等字段。
      const spawnOpts: SpawnOptions = {
        launchSpec: {
          ...resolvedLaunchSpec,
          context: { _workflowJournalId: journalId, _workflowCallKey: callKey },
        },
        abortSignal,
        onSessionCreated: (sid, agentId) => {
          callbacks?.onAgentEvent?.({
            type: "started",
            sessionId: sid,
            agentId,
            instruction: prompt,
          });
        },
      };

      const claimIdentity = {
        journalId,
        fingerprint,
        ownerId: pendingClaim.ownerId,
        generation: pendingClaim.generation,
      };
      const renewal = startPendingClaimRenewal(journal, claimIdentity);
      try {
        let callResult;
        try {
          callResult = await runWorkflowAgentCall({
            requestedMaxRetries: opts?.maxRetries,
            budgetGuard,
            abortSignal,
            beforeFirstAttempt: () => {},
            spawn: async () => orchestrator.spawn(spawnOpts),
            // P2 再接入真实 tokenCounter；当前保持既有输出长度估算。
            estimateTokens: (output) => Math.ceil(output.length / 4),
          });
        } catch (error) {
          if (renewal.lost || !journal.settlePending({
            ...claimIdentity,
            status: "error",
            error: toErrorMessage(error),
          })) {
            throw new WorkflowPendingClaimLostError(callKey);
          }
          throw error;
        }

        const { result, tokenCount } = callResult;
        if (result.success) {
          if (renewal.lost || !journal.settlePending({
            ...claimIdentity,
            status: "done",
            result: result.output,
            tokenCount,
          })) {
            throw new WorkflowPendingClaimLostError(callKey);
          }
          callbacks?.onAgentEvent?.({
            type: "completed",
            sessionId: result.sessionId,
            success: true,
            output: result.output,
          });
          return result.output;
        }

        if (renewal.lost || !journal.settlePending({
          ...claimIdentity,
          status: "error",
          error: result.error ?? "unknown error",
        })) {
          throw new WorkflowPendingClaimLostError(callKey);
        }
        callbacks?.onAgentEvent?.({
          type: "completed",
          sessionId: result.sessionId,
          success: false,
          output: "",
          error: result.error,
        });
        throw new Error(`Workflow agent() failed [${callKey}]: ${result.error ?? "unknown error"}`);
      } finally {
        renewal.stop();
      }
    },

    async parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<WorkflowTaskResult<T>>> {
      return runWorkflowBatch({
        items: tasks,
        maxConcurrent,
        limits: batchLimits,
        taskIdPrefix: "task",
        abortSignal,
        measureQueuedBytes: () => WORKFLOW_BATCH_ENTRY_METADATA_BYTES,
        execute: async (task) => task(),
      });
    },

    async parallelMap<T, U>(
      items: T[],
      mapper: (item: T, index: number, ctx: WorkflowContext) => Promise<U>,
    ): Promise<Array<WorkflowTaskResult<U>>> {
      return runWorkflowBatch({
        items,
        maxConcurrent,
        limits: batchLimits,
        taskIdPrefix: "map",
        abortSignal,
        execute: async (item, index) => mapper(item, index, ctx),
      });
    },

    /**
     * 无屏障流水线：每个 item 独立流经所有 stage，处理快的 item 不必等待
     * 同批其他 item 即可进入下一 stage。某个 item 在某 stage 失败后，该
     * item 的后续 stage 跳过，最终在结果数组对应位置返回结构化失败项。
     *
     * 并发上限由 maxConcurrent 控制：同一时刻跨所有 stage 正在处理的 item
     * 总数不超过 maxConcurrent。每个 stage 调用前 acquire，完成后 release。
     *
     * callKey 生成规则：`pipeline/${itemIndex}/${stageIndex}`，供 agent()
     * 在 stage 内部调用时显式传入以稳定缓存命中。
     */
    async pipeline<T, U>(
      items: T[],
      ...stages: Array<(item: any, ctx: WorkflowContext) => Promise<any>>
    ): Promise<Array<WorkflowTaskResult<U>>> {
      return runWorkflowBatch({
        items,
        maxConcurrent,
        limits: batchLimits,
        taskIdPrefix: "pipe",
        abortSignal,
        execute: async (item) => {
          let current: any = item;
          for (const stage of stages) {
            throwIfWorkflowAborted(abortSignal);
            current = await stage(current, ctx);
          }
          return current as U;
        },
      });
    },

    /**
     * 嵌套调用另一个工作流。子工作流通过 WorkflowRuntime.run() 执行，
     * 继承父级的并发上限和代币预算（通过共享 budgetGuard 的 maxConcurrent
     * 和 budget 透传）。嵌套深度限制 1 层。
     */
    async workflow(nameOrRef, callArgs): Promise<string> {
      throwIfWorkflowAborted(abortSignal);
      if (!runtime) {
        throw new Error("workflow() is not available: no WorkflowRuntime reference in this context");
      }
      if (depth >= maxDepth) {
        throw new Error(`workflow() nesting depth exceeded: current depth=${depth}, maxDepth=${maxDepth}`);
      }

      // 解析 nameOrRef
      let source: { kind: string; name?: string; path?: string };
      let childArgs: Record<string, unknown> | undefined;
      if (typeof nameOrRef === "string") {
        // 简单字符串：默认按 builtin 查找
        source = { kind: "builtin", name: nameOrRef };
        childArgs = callArgs;
      } else {
        if (nameOrRef.kind === "file") {
          // file 模式需要 stateDir 解析路径，这里交给 runtime 处理
          // 但 WorkflowRuntimeLike.run 的 source 不支持 { kind: "file", name }，
          // 所以用 builtin 风格的 source，让 runtime 内部处理。
          // 实际上 runtime.run 只接受 { kind: "file", path } 或 { kind: "builtin", name }。
          // 这里用 name 形式，runtime 需要支持 file+name 解析。
          // 为了简化，workflow() 嵌套只支持 builtin 模式（最常见场景）。
          throw new Error("workflow() nesting only supports builtin workflows in this version");
        }
        source = { kind: "builtin", name: nameOrRef.name };
        childArgs = callArgs ?? nameOrRef.args;
      }

      callbacks?.onLog?.(`[workflow] nesting into ${typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name} (depth=${depth + 1})`);

      const result = await runtime.run({
        source,
        args: childArgs,
        parentConversationId,
        channel,
        stateDir,
        maxConcurrent,
        sharedBudgetGuard: budgetGuard,
        resolveAgentExecutionFingerprintInputs,
        abortSignal,
        // 子工作流深度 +1，runtime 会把它传给子 ctx，
        // 子 ctx 的 depth=1 >= maxDepth=1，禁止再次嵌套
        depth: depth + 1,
      });

      if (!result.success) {
        throw new Error(`Nested workflow failed: ${result.error ?? "unknown error"}`);
      }

      return result.output;
    },

    phase(title: string): void {
      if (abortSignal?.aborted) return;
      phaseId = title;
      callbacks?.onPhase?.(title);
    },

    log(msg: string): void {
      if (abortSignal?.aborted) return;
      callbacks?.onLog?.(msg);
    },
  };

  return ctx;
}

function startPendingClaimRenewal(
  journal: WorkflowJournal,
  identity: { journalId: string; fingerprint: string; ownerId: string; generation: number },
): { readonly lost: boolean; stop(): void } {
  let lost = false;
  const timer = setInterval(() => {
    try {
      if (!journal.renewPending({
        ...identity,
        leaseDurationMs: WORKFLOW_PENDING_LEASE_MS,
      })) {
        lost = true;
      }
    } catch {
      lost = true;
    }
  }, WORKFLOW_PENDING_RENEW_INTERVAL_MS);
  timer.unref?.();
  return {
    get lost() {
      return lost;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function throwIfWorkflowAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw createWorkflowAbortError(signal);
}

function createWorkflowAbortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  if (typeof signal?.reason === "string" && signal.reason.trim()) {
    return new Error(signal.reason.trim());
  }
  return new Error("Workflow stopped by user.");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
