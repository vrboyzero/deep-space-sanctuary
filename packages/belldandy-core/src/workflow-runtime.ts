/**
 * WorkflowRuntime — 动态工作流执行引擎
 *
 * 职责：
 * - 加载脚本（file/builtin/inline，inline 默认关闭）
 * - 计算 scriptHash
 * - 创建或恢复 WorkflowJournal（resumeJournalId 复用）
 * - 创建 WorkflowBudgetGuard（从环境变量 + opts.budget 合并）
 * - 创建独立 SubAgentOrchestrator 实例（不复用主 Agent 的）
 * - 构建 WorkflowContext（createWorkflowContext）
 * - 执行脚本 default export(ctx)
 * - 返回 WorkflowRunResult（含 journalId 供后续 resume）
 *
 * 生命周期状态：running / stopping / partial / done / error / budget_exceeded
 */

import { randomUUID } from "node:crypto";

import type { WorkflowContext, SubAgentEvent } from "@belldandy/agent";
import { SubAgentOrchestrator, type AgentRegistry, type ConversationStore } from "@belldandy/agent";
import type { SqliteDatabase } from "@belldandy/memory";

import { WorkflowJournal, type WorkflowJournalStats } from "./workflow-journal.js";
import {
  WorkflowBudgetGuard,
  WorkflowBudgetExceededError,
  resolveWorkflowBudgetFromEnv,
  type WorkflowBudget,
  type WorkflowBudgetUsage,
} from "./workflow-budget-guard.js";
import { createWorkflowContext, type WorkflowContextCallbacks } from "./workflow-context-impl.js";
import {
  createWorkflowRunController,
  resolveWorkflowRunBudget,
  type WorkflowRunController,
} from "./workflow-run-controller.js";
import { resolveWorkflowBatchLimits } from "./workflow-batch-runner.js";
import { computeMigrationFingerprint } from "./workflow-fingerprint.js";
import { ManagedWorktreeRuntime } from "./managed-worktree.js";
import {
  loadWorkflowScript,
  type WorkflowScriptSource,
  type LoadedWorkflowScript,
  WorkflowScriptLoadError,
} from "./workflow-script-loader.js";
import type { WorkflowExecutionPolicy } from "./workflow-execution-policy.js";

const DEFAULT_WORKFLOW_MAX_QUEUE_SIZE = 20;

// ─── Types ────────────────────────────────────────────────────────────────

export type WorkflowRunOptions = {
  source: WorkflowScriptSource;
  args?: Record<string, unknown>;
  /** 父工作流的取消信号；嵌套 workflow 用它与父级终止保持一致。 */
  abortSignal?: AbortSignal;
  budget?: WorkflowBudget;
  maxConcurrent?: number;
  parentConversationId: string;
  channel: string;
  resumeJournalId?: string;
  stateDir?: string;
  callbacks?: WorkflowContextCallbacks;
  /**
   * 复用父工作流的预算守卫。用于 workflow() 嵌套时共享 token/call/retry/wall-clock 预算。
   */
  sharedBudgetGuard?: WorkflowBudgetGuard;
  /**
   * 顶层 runtime 可注入的 agent profile / prompt / tool policy 解析器，
   * 用于让 ctx.agent() 的 fingerprint 绑定到真实生效的执行语义。
   */
  resolveAgentExecutionFingerprintInputs?: AgentExecutionFingerprintInputResolver;
  resolveWorkflowAgentLaunchSpec?: Parameters<typeof createWorkflowContext>[0]["resolveWorkflowAgentLaunchSpec"];
  /**
   * 嵌套深度。顶层工作流为 0，子工作流为 1。
   * 由 workflow() 嵌套调用时自动设置，外部调用方通常不需要指定。
   */
  depth?: number;
};

export type WorkflowRunResult = {
  success: boolean;
  output: string;
  /** 单次 runtime 执行实例标识；不随 resumeJournalId 复用。 */
  workflowRunId: string;
  journalId: string;
  scriptHash: string;
  workflowName: string;
  workflowVersion: string;
  stats: {
    agentCalls: number;
    cacheHits: number;
    totalTokens: number;
    durationMs: number;
  };
  error?: string;
};

export type WorkflowRuntimeStatus =
  | "running"
  | "stopping"
  | "partial"
  | "done"
  | "error"
  | "budget_exceeded";

export type WorkflowRuntimeStatusInfo = {
  status: WorkflowRuntimeStatus;
  /** 仅表示该精确运行实例已接受过显式 stop；用于安全地确认断连重试。 */
  stopRequested?: boolean;
  workflowRunId: string;
  journalId: string;
  workflowName?: string;
  scriptHash?: string;
  stats: WorkflowJournalStats;
  budgetUsage?: {
    tokens: number;
    calls: number;
    retries: number;
    durationMs: number;
    exceeded: boolean;
    exceededReason?: string;
  };
  error?: string;
};

// ─── WorkflowRuntime ──────────────────────────────────────────────────────

export type WorkflowRuntimeDeps = {
  /** SQLite db 句柄（来自 MemoryStore.getDbHandleForSharedSchema()） */
  db: SqliteDatabase;
  /** Agent 注册表 */
  agentRegistry: AgentRegistry;
  /** 会话存储 */
  conversationStore: ConversationStore;
  /** 环境变量读取 */
  readEnv?: (name: string) => string | undefined;
  /** 只在 Gateway 启动时解析一次的 source trust policy。 */
  workflowExecutionPolicy?: WorkflowExecutionPolicy;
  /** 日志 */
  logger?: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    debug(message: string, data?: unknown): void;
  };
  resolveAgentExecutionFingerprintInputs?: AgentExecutionFingerprintInputResolver;
  resolveWorkflowAgentLaunchSpec?: Parameters<typeof createWorkflowContext>[0]["resolveWorkflowAgentLaunchSpec"];
};

export type AgentExecutionFingerprintInputResolver = (input: {
  agentId: string;
  profileId: string;
  modelOverride?: string;
  role?: string;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  permissionMode?: string;
  policySummary?: string;
}) => {
  agentProfileId?: string;
  systemPromptHash?: string;
  toolPolicyHash?: string;
};

type ActiveRun = {
  workflowRunId: string;
  journalId: string;
  status: WorkflowRuntimeStatus;
  scriptHash: string;
  workflowName: string;
  workflowVersion: string;
  budgetGuard: WorkflowBudgetGuard;
  journal: WorkflowJournal;
  orchestrator: SubAgentOrchestrator;
  runController: WorkflowRunController;
  budgetBaseline: WorkflowBudgetUsage;
  stopRequested?: boolean;
  error?: string;
  startedAt: number;
};

function readWorkflowAbortReason(signal: AbortSignal): string {
  const reason = signal.reason;
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }
  return "Workflow stopped by user";
}

export class WorkflowRuntime {
  private readonly db: SqliteDatabase;
  private readonly agentRegistry: AgentRegistry;
  private readonly conversationStore: ConversationStore;
  private readonly readEnv: (name: string) => string | undefined;
  private readonly workflowExecutionPolicy?: WorkflowExecutionPolicy;
  private readonly logger?: WorkflowRuntimeDeps["logger"];
  private readonly resolveAgentExecutionFingerprintInputs?: AgentExecutionFingerprintInputResolver;
  private readonly resolveWorkflowAgentLaunchSpec?: Parameters<typeof createWorkflowContext>[0]["resolveWorkflowAgentLaunchSpec"];
  /** 以不可复用的 runtime instance id 索引，避免 resume journal 混淆控制目标。 */
  private readonly activeRuns = new Map<string, ActiveRun>();
  /** 兼容既有 journalId 查询接口，始终指向该 Journal 最近一次运行。 */
  private readonly activeRunIdsByJournal = new Map<string, string>();

  constructor(deps: WorkflowRuntimeDeps) {
    this.db = deps.db;
    this.agentRegistry = deps.agentRegistry;
    this.conversationStore = deps.conversationStore;
    this.readEnv = deps.readEnv ?? ((name: string) => process.env[name]);
    this.workflowExecutionPolicy = deps.workflowExecutionPolicy;
    this.logger = deps.logger;
    this.resolveAgentExecutionFingerprintInputs = deps.resolveAgentExecutionFingerprintInputs;
    this.resolveWorkflowAgentLaunchSpec = deps.resolveWorkflowAgentLaunchSpec;
  }

  async run(opts: WorkflowRunOptions): Promise<WorkflowRunResult> {
    const startedAt = Date.now();
    const workflowRunId = `wfr_${randomUUID()}`;

    // 1. 加载脚本
    let script: LoadedWorkflowScript;
    try {
      script = await loadWorkflowScript(opts.source, {
        stateDir: opts.stateDir,
        policy: this.workflowExecutionPolicy,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger?.error("workflow:script_load_failed", { error });
      return {
        success: false,
        output: "",
        workflowRunId,
        journalId: "",
        scriptHash: "",
        workflowName: "",
        workflowVersion: "",
        stats: { agentCalls: 0, cacheHits: 0, totalTokens: 0, durationMs: Date.now() - startedAt },
        error: `Script load failed: ${error}`,
      };
    }

    // 2. 创建或恢复 Journal
    const journalId = opts.resumeJournalId ?? `wf_${randomUUID()}`;
    const journal = new WorkflowJournal(this.db);
    const leaseOwnerId = `wf_run_${randomUUID()}`;

    // 2.5 跨版本 migration：resume 时如果 scriptHash 变化，尝试迁移旧记录
    if (opts.resumeJournalId) {
      const workflowArgs = opts.args ?? {};
      const workflowVersion = script.workflowVersion;
      await this.migrateJournalRecords(
        journal, journalId, script.scriptHash, script.workflowName, workflowVersion, workflowArgs,
      );
    }

    // 3. 环境预算是硬上限；单次请求只能收紧，不能放宽。
    const envBudget = resolveWorkflowBudgetFromEnv(this.readEnv);
    const budget = resolveWorkflowRunBudget(envBudget, opts.budget);
    const budgetGuard = opts.sharedBudgetGuard ?? new WorkflowBudgetGuard(budget);
    const budgetStartedAt = Date.now();
    // 4. 创建独立 orchestrator 实例
    const maxConcurrent = Math.min(
      opts.maxConcurrent ?? budget.maxConcurrent ?? envBudget.maxConcurrent ?? 6,
      budget.maxConcurrent ?? envBudget.maxConcurrent ?? 6,
    );
    const orchestrator = new SubAgentOrchestrator({
      agentRegistry: this.agentRegistry,
      conversationStore: this.conversationStore,
      maxConcurrent,
      // 既有公开配置必须实际成为该 Workflow 专用 orchestrator 的队列上限。
      maxQueueSize: readPositiveEnvInteger(
        this.readEnv,
        "BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE",
        DEFAULT_WORKFLOW_MAX_QUEUE_SIZE,
      ),
      sessionTimeoutMs: parseInt(this.readEnv("BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS") ?? "300000", 10),
      maxDepth: parseInt(this.readEnv("BELLDANDY_WORKFLOW_MAX_DEPTH") ?? "2", 10),
      logger: this.logger ? {
        info: (m, d) => this.logger!.info(`workflow:orchestrator:${m}`, d),
        warn: (m, d) => this.logger!.warn(`workflow:orchestrator:${m}`, d),
        error: (m, d) => this.logger!.error(`workflow:orchestrator:${m}`, d),
        debug: (m, d) => this.logger!.debug(`workflow:orchestrator:${m}`, d),
      } : undefined,
      onEvent: (event) => opts.callbacks?.onAgentEvent?.(event),
    });
    const runController = createWorkflowRunController({
      parentSignal: opts.abortSignal,
      deadlineMs: budget.maxWallClockMs,
      onDeadline: () => budgetGuard.markExceeded(
        `wall clock budget exceeded (${Date.now() - budgetStartedAt}ms/${budget.maxWallClockMs}ms)`,
      ),
    });

    // 5. 注册 active run
    const activeRun: ActiveRun = {
      workflowRunId,
      journalId,
      status: "running",
      scriptHash: script.scriptHash,
      workflowName: script.workflowName,
      workflowVersion: script.workflowVersion,
      budgetGuard,
      journal,
      orchestrator,
      runController,
      budgetBaseline: budgetGuard.getUsage(),
      startedAt,
    };
    this.activeRuns.set(workflowRunId, activeRun);
    this.activeRunIdsByJournal.set(journalId, workflowRunId);

    // 6. 构建 WorkflowContext 并执行脚本。
    let output = "";
    let success = true;
    let error: string | undefined;
    let finalStatus: WorkflowRuntimeStatus = "done";

    try {
      const ctx: WorkflowContext = createWorkflowContext({
        orchestrator,
        journal,
        budgetGuard,
        args: opts.args ?? {},
        scriptHash: script.scriptHash,
        workflowName: script.workflowName,
        workflowVersion: script.workflowVersion,
        parentConversationId: opts.parentConversationId,
        channel: opts.channel,
        journalId,
        leaseOwnerId,
        maxConcurrent,
        batchLimits: resolveWorkflowBatchLimits(this.readEnv),
        abortSignal: runController.signal,
        callbacks: opts.callbacks ? {
          ...opts.callbacks,
          // started/completed/thought_delta 已由 orchestrator.onEvent 统一推送。
          // 这里避免 ctx.agent() 再次重复发事件。
          onAgentEvent: undefined,
        } : undefined,
        resolveAgentExecutionFingerprintInputs: opts.resolveAgentExecutionFingerprintInputs
          ?? this.resolveAgentExecutionFingerprintInputs,
        resolveWorkflowAgentLaunchSpec: opts.resolveWorkflowAgentLaunchSpec
          ?? this.resolveWorkflowAgentLaunchSpec,
        // workflow() 嵌套支持：传入 runtime 引用和深度
        runtime: this,
        depth: opts.depth ?? 0,
        maxDepth: 1,
        stateDir: opts.stateDir,
        managedWorktreeRuntime: opts.stateDir
          ? new ManagedWorktreeRuntime(opts.stateDir, this.logger)
          : undefined,
      });
      if (runController.signal.aborted) {
        throw new Error(readWorkflowAbortReason(runController.signal));
      }
      budgetGuard.check(); // 启动前检查
      output = await runController.race(Promise.resolve().then(() => script.default(ctx)));
      if (runController.signal.aborted) {
        success = false;
        if (runController.signal.reason instanceof WorkflowBudgetExceededError) {
          finalStatus = "budget_exceeded";
          error = runController.signal.reason.reason;
        } else {
          finalStatus = "partial";
          error = readWorkflowAbortReason(runController.signal);
        }
      } else {
        finalStatus = "done";
      }
    } catch (err) {
      success = false;
      if (err instanceof WorkflowBudgetExceededError) {
        finalStatus = "budget_exceeded";
        error = err.reason;
      } else if (runController.signal.aborted) {
        finalStatus = "partial";
        error = readWorkflowAbortReason(runController.signal);
      } else {
        finalStatus = "error";
        error = err instanceof Error ? err.message : String(err);
      }
      this.logger?.error("workflow:execution_failed", { journalId, error, finalStatus });
    } finally {
      runController.dispose();
    }

    // 8. 收集统计
    const journalStats = journal.getStats(journalId);
    const budgetUsage = diffBudgetUsage(budgetGuard.getUsage(), activeRun.budgetBaseline);
    activeRun.status = finalStatus;
    activeRun.error = error;

    // 9. 清理 active run（保留一段时间供 getStatus 查询）
    // 这里不立即删除，让 getStatus 可以查询；由 cleanup() 定期清理
    // 但如果已完成，可以移到历史记录
    if (finalStatus === "done" || finalStatus === "error" || finalStatus === "budget_exceeded") {
      // 保留 activeRun 供查询，但标记为非 running
    }

    const result = {
      success,
      output,
      workflowRunId,
      journalId,
      scriptHash: script.scriptHash,
      workflowName: script.workflowName,
      workflowVersion: script.workflowVersion,
      stats: {
        agentCalls: budgetUsage.calls,
        cacheHits: journalStats.cacheHits,
        totalTokens: budgetUsage.tokens,
        durationMs: Date.now() - startedAt,
      },
      error,
    };
    return result;
  }

  /**
   * 中止运行中的工作流。
   */
  async stop(journalId: string, reason = "Stopped by user"): Promise<boolean> {
    const run = this.getRunByJournal(journalId);
    return run ? this.stopActiveRun(run, reason) : false;
  }

  /**
   * 仅停止同时匹配 Journal 和 runtime instance 的工作流。
   * 外部控制面必须使用此接口，不能把可复用的 journalId 当作运行身份。
   */
  async stopRun(journalId: string, workflowRunId: string, reason = "Stopped by user"): Promise<boolean> {
    const run = this.activeRuns.get(workflowRunId);
    if (!run || run.journalId !== journalId) return false;
    return this.stopActiveRun(run, reason);
  }

  /**
   * 查询运行状态与 Journal 统计。
   */
  getStatus(journalId: string): WorkflowRuntimeStatusInfo | null {
    const run = this.getRunByJournal(journalId);
    if (!run) return null;

    return this.toStatusInfo(run);
  }

  /** 按精确 runtime instance 查询状态，供需核验 binding 的外部 adapter 使用。 */
  getStatusByRunId(workflowRunId: string): WorkflowRuntimeStatusInfo | null {
    const run = this.activeRuns.get(workflowRunId);
    if (!run) return null;

    return this.toStatusInfo(run);
  }

  private toStatusInfo(run: ActiveRun): WorkflowRuntimeStatusInfo {
    const { journalId } = run;

    const stats = run.journal.getStats(journalId);
    const budgetUsage = diffBudgetUsage(run.budgetGuard.getUsage(), run.budgetBaseline);

    return {
      status: run.status,
      ...(run.stopRequested ? { stopRequested: true } : {}),
      workflowRunId: run.workflowRunId,
      journalId,
      workflowName: run.workflowName,
      scriptHash: run.scriptHash,
      stats,
      budgetUsage: {
        tokens: budgetUsage.tokens,
        calls: budgetUsage.calls,
        retries: budgetUsage.retries,
        durationMs: budgetUsage.durationMs,
        exceeded: budgetUsage.exceeded,
        exceededReason: budgetUsage.exceededReason,
      },
      error: run.error,
    };
  }

  /**
   * 列出所有 active runs。
   */
  listActiveRuns(): Array<{
    workflowRunId: string;
    journalId: string;
    status: WorkflowRuntimeStatus;
    workflowName: string;
    startedAt: number;
  }> {
    // 机会式清理已结束且超过默认保留期的记录，避免 doctor 视角持续膨胀。
    this.cleanup();
    return [...this.activeRuns.values()]
      .filter((run) => run.status === "running" || run.status === "stopping")
      .map((run) => ({
      workflowRunId: run.workflowRunId,
      journalId: run.journalId,
      status: run.status,
      workflowName: run.workflowName,
      startedAt: run.startedAt,
      }));
  }

  /** 汇总 workflow 内部子代理的资源水位，不暴露 journal 或会话标识。 */
  getRuntimeSnapshot(): {
    activeRunCount: number;
    activeAgentCount: number;
    queuedAgentCount: number;
    maxConcurrentAgentCount: number;
    maxQueuedAgentCount: number;
  } {
    const activeRuns = [...this.activeRuns.values()]
      .filter((run) => run.status === "running" || run.status === "stopping");
    return activeRuns.reduce((summary, run) => {
      const snapshot = run.orchestrator.getRuntimeSnapshot();
      summary.activeAgentCount += snapshot.activeCount;
      summary.queuedAgentCount += snapshot.queuedCount;
      summary.maxConcurrentAgentCount += snapshot.maxConcurrent;
      summary.maxQueuedAgentCount += snapshot.maxQueueSize;
      return summary;
    }, {
      activeRunCount: activeRuns.length,
      activeAgentCount: 0,
      queuedAgentCount: 0,
      maxConcurrentAgentCount: 0,
      maxQueuedAgentCount: 0,
    });
  }

  /**
   * 清理已完成的 active runs。
   */
  cleanup(maxAgeMs: number = 3_600_000): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [workflowRunId, run] of this.activeRuns) {
      if (run.status !== "running" && run.status !== "stopping" && now - run.startedAt >= maxAgeMs) {
        this.activeRuns.delete(workflowRunId);
        if (this.activeRunIdsByJournal.get(run.journalId) === workflowRunId) {
          this.activeRunIdsByJournal.delete(run.journalId);
        }
        cleaned++;
      }
    }
    return cleaned;
  }

  private getRunByJournal(journalId: string): ActiveRun | undefined {
    const workflowRunId = this.activeRunIdsByJournal.get(journalId);
    return workflowRunId ? this.activeRuns.get(workflowRunId) : undefined;
  }

  private async stopActiveRun(run: ActiveRun, reason: string): Promise<boolean> {
    if (run.stopRequested) return true;
    if (run.status !== "running") return false;

    run.stopRequested = true;
    run.status = "stopping";
    run.runController.abort(reason);

    // orchestrator.stopSession 需要 sessionId，这里停止该 workflow 的运行中/排队 session。
    const sessions = run.orchestrator.listSessions();
    for (const session of sessions) {
      if (session.status === "running" || session.status === "pending") {
        await run.orchestrator.stopSession(session.id, reason);
      }
    }

    return true;
  }

  // ─── 跨版本 migration ────────────────────────────────────────────────────
  //
  // 当 resume 时脚本版本已更新（scriptHash 变化），逐条检查 journal 中的旧记录：
  //   - 旧记录 status=done 且 callKey + prompt 与新脚本预期一致 → 可迁移
  //   - 用新 scriptHash 重新计算 fingerprint，把旧 result 复制到新 fingerprint 下
  //   - 后续 ctx.agent() 的 lookup() 会命中新 fingerprint，跳过实际执行
  //
  // 不可迁移的情况：
  //   - workflowVersion 变化（语义可能不兼容）
  //   - 旧记录 status != done（pending/error/skipped 不复用）
  //   - 新 fingerprint 已存在记录（避免覆盖）

  private async migrateJournalRecords(
    journal: WorkflowJournal,
    journalId: string,
    newScriptHash: string,
    workflowName: string,
    workflowVersion: string,
    workflowArgs: Record<string, unknown>,
  ): Promise<number> {
    const existingRows = journal.listByJournal(journalId);
    if (existingRows.length === 0) return 0;

    // 如果所有记录的 script_hash 都已等于 newScriptHash，无需迁移
    const oldRows = existingRows.filter(
      (r) => r.scriptHash !== newScriptHash && r.status === "done",
    );
    if (oldRows.length === 0) return 0;

    let migrated = 0;
    for (const oldRow of oldRows) {
      // 用新 scriptHash + 旧 callKey/prompt/optsJson + 当前 workflowVersion/args
      // 重新计算 fingerprint，使预填充记录能被 agent() 实际执行时命中。
      const newFingerprint = computeMigrationFingerprint(
        newScriptHash,
        oldRow.callKey,
        oldRow.prompt,
        oldRow.optsJson,
        workflowName,
        workflowVersion,
        workflowArgs,
      );

      // 如果新 fingerprint 已有 done 记录，跳过（避免重复迁移）
      const existing = journal.lookup(journalId, newFingerprint);
      if (existing && existing.status === "done") continue;

      journal.insertMigratedRecord({
        journalId,
        workflowName,
        scriptHash: newScriptHash,
        callKey: oldRow.callKey,
        fingerprint: newFingerprint,
        prompt: oldRow.prompt,
        optsJson: oldRow.optsJson,
        result: oldRow.result ?? "",
        resultJson: oldRow.resultJson,
        tokenCount: oldRow.tokenCount,
        completedAt: oldRow.completedAt ?? Date.now(),
      });
      migrated++;
    }

    if (migrated > 0) {
      this.logger?.info("workflow:migration", { journalId, migrated, newScriptHash });
    }
    return migrated;
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

function diffBudgetUsage(current: WorkflowBudgetUsage, baseline: WorkflowBudgetUsage): WorkflowBudgetUsage {
  return {
    tokens: Math.max(0, current.tokens - baseline.tokens),
    calls: Math.max(0, current.calls - baseline.calls),
    retries: Math.max(0, current.retries - baseline.retries),
    durationMs: Math.max(0, current.durationMs - baseline.durationMs),
    exceeded: current.exceeded,
    exceededReason: current.exceededReason,
  };
}

function readPositiveEnvInteger(
  readEnv: (name: string) => string | undefined,
  name: string,
  fallback: number,
): number {
  const raw = readEnv(name)?.trim() ?? "";
  // 拒绝 parseInt() 可接受的 "1junk"，避免配置拼写错误意外收紧队列。
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
