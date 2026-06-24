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
 *     未命中 → budgetGuard.check() → orchestrator.spawn()
 *       成功 → budgetGuard.consume() → journal.record() → 返回
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

import { randomUUID } from "node:crypto";
import type {
  AgentCallOptions,
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
import {
  computeWorkflowFingerprint,
  computeStableHash,
  computeWorkflowToolPolicyHash,
} from "./workflow-fingerprint.js";
import type { AgentExecutionFingerprintInputResolver } from "./workflow-runtime.js";

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
  /** 并发上限（默认 6） */
  maxConcurrent?: number;
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
  resolveWorkflowAgentLaunchSpec?: (input: {
    instruction: string;
    parentConversationId: string;
    modelOverride?: string;
    role?: string;
    allowedToolFamilies?: string[];
    maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
    timeoutMs?: number;
    delegationProtocol?: AgentCallOptions["delegationProtocol"];
  }) => {
    instruction: string;
    parentConversationId: string;
    agentId: string;
    profileId: string;
    modelOverride?: string;
    background: boolean;
    timeoutMs: number;
    channel: string;
    context?: Record<string, unknown>;
    permissionMode?: string;
    role?: string;
    allowedToolFamilies?: string[];
    maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
    policySummary?: string;
    delegationProtocol?: AgentCallOptions["delegationProtocol"];
  };
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
    depth?: number;
  }): Promise<WorkflowRunResultLike>;
}

export interface WorkflowRunResultLike {
  success: boolean;
  output: string;
  journalId: string;
  error?: string;
}

// ─── 信号量 ───────────────────────────────────────────────────────────────

class Semaphore {
  private current = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    // 等待槽位：release 时若有 waiter 会直接转交槽位（current 不变），
    // 因此被唤醒后不需要再 current++
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // 槽位直接转交给下一个 waiter，current 保持不变
      next();
    } else {
      this.current--;
    }
  }
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
    maxConcurrent = 6,
    callbacks,
    runtime,
    depth = 0,
    maxDepth = 1,
    stateDir,
    resolveAgentExecutionFingerprintInputs,
    resolveWorkflowAgentLaunchSpec,
  } = deps;

  let agentCallIndex = 0;
  let phaseId = "root";

  const ctx: WorkflowContext = {
    args,

    async agent(prompt, opts): Promise<string> {
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

      // 预算检查
      budgetGuard.check();

      // 写 pending 记录
      journal.recordPending({
        journalId,
        workflowName,
        scriptHash,
        callKey,
        fingerprint,
        prompt,
        optsJson: JSON.stringify(persistedOpts),
      });

      // 调用 orchestrator。这里统一走 launchSpec，避免 legacy spawnOpts 丢失
      // role / timeout / tool 限制 / modelOverride 等字段。
      const spawnOpts: SpawnOptions = {
        launchSpec: {
          ...resolvedLaunchSpec,
          context: { _workflowJournalId: journalId, _workflowCallKey: callKey },
        },
        onSessionCreated: (sid, agentId) => {
          callbacks?.onAgentEvent?.({
            type: "started",
            sessionId: sid,
            agentId,
            instruction: prompt,
          });
        },
      };

      const startMs = Date.now();
      const result = await orchestrator.spawn(spawnOpts);
      const durationMs = Date.now() - startMs;

      if (result.success) {
        // 估算 token（简化：用 output 长度 / 4 粗估；P2 会接入真实 tokenCounter）
        const estimatedTokens = Math.ceil(result.output.length / 4);
        budgetGuard.consume(estimatedTokens, 1);
        journal.record({
          journalId,
          fingerprint,
          result: result.output,
          tokenCount: estimatedTokens,
        });
        callbacks?.onAgentEvent?.({
          type: "completed",
          sessionId: result.sessionId,
          success: true,
          output: result.output,
        });
        return result.output;
      }

      // 失败：记录 error
      journal.recordError(journalId, fingerprint, result.error ?? "unknown error");
      callbacks?.onAgentEvent?.({
        type: "completed",
        sessionId: result.sessionId,
        success: false,
        output: "",
        error: result.error,
      });
      throw new Error(`Workflow agent() failed [${callKey}]: ${result.error ?? "unknown error"}`);
    },

    async parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<WorkflowTaskResult<T>>> {
      const semaphore = new Semaphore(maxConcurrent);
      const results = await Promise.all(
        tasks.map(async (task, index) => {
          const taskId = `task_${index}_${randomUUID().slice(0, 8)}`;
          const startMs = Date.now();
          await semaphore.acquire();
          try {
            const value = await task();
            return {
              ok: true as const,
              value,
              taskId,
              cacheHit: false,
              durationMs: Date.now() - startMs,
            };
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return {
              ok: false as const,
              error,
              taskId,
              durationMs: Date.now() - startMs,
            };
          } finally {
            semaphore.release();
          }
        }),
      );
      return results;
    },

    async parallelMap<T, U>(
      items: T[],
      mapper: (item: T, index: number, ctx: WorkflowContext) => Promise<U>,
    ): Promise<Array<WorkflowTaskResult<U>>> {
      const semaphore = new Semaphore(maxConcurrent);
      const results = await Promise.all(
        items.map(async (item, index) => {
          const taskId = `map_${index}_${randomUUID().slice(0, 8)}`;
          const startMs = Date.now();
          await semaphore.acquire();
          try {
            const value = await mapper(item, index, ctx);
            return {
              ok: true as const,
              value,
              taskId,
              cacheHit: false,
              durationMs: Date.now() - startMs,
            };
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return {
              ok: false as const,
              error,
              taskId,
              durationMs: Date.now() - startMs,
            };
          } finally {
            semaphore.release();
          }
        }),
      );
      return results;
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
      if (stages.length === 0) {
        // 无 stage：直接返回所有 item 作为成功结果
        return items.map((item, index) => ({
          ok: true as const,
          value: item as unknown as U,
          taskId: `pipe_${index}_${randomUUID().slice(0, 8)}`,
          cacheHit: false,
          durationMs: 0,
        }));
      }

      const semaphore = new Semaphore(maxConcurrent);

      // 每个 item 独立流经所有 stage
      const itemResults = await Promise.all(
        items.map(async (item, index) => {
          const taskId = `pipe_${index}_${randomUUID().slice(0, 8)}`;
          const startMs = Date.now();
          let current: any = item;
          try {
            for (let s = 0; s < stages.length; s++) {
              await semaphore.acquire();
              try {
                current = await stages[s](current, ctx);
              } finally {
                semaphore.release();
              }
            }
            return {
              ok: true as const,
              value: current as U,
              taskId,
              cacheHit: false,
              durationMs: Date.now() - startMs,
            };
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return {
              ok: false as const,
              error,
              taskId,
              durationMs: Date.now() - startMs,
            };
          }
        }),
      );
      return itemResults;
    },

    /**
     * 嵌套调用另一个工作流。子工作流通过 WorkflowRuntime.run() 执行，
     * 继承父级的并发上限和代币预算（通过共享 budgetGuard 的 maxConcurrent
     * 和 budget 透传）。嵌套深度限制 1 层。
     */
    async workflow(nameOrRef, callArgs): Promise<string> {
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
      phaseId = title;
      callbacks?.onPhase?.(title);
    },

    log(msg: string): void {
      callbacks?.onLog?.(msg);
    },
  };

  return ctx;
}
