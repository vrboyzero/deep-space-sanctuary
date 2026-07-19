/**
 * SubAgentOrchestrator — 子 Agent 编排核心
 *
 * 管理子 Agent 会话的生命周期：spawn → run → collect result → cleanup
 * 设计决策：
 * - Batch 模式：子 Agent 完成后返回聚合结果给父 Agent，不污染 ReAct 上下文
 * - Event Hook：通过 onEvent 回调将子 Agent 状态实时推送到前端
 * - 独立 conversationId：子 Agent 运行在隔离的会话中
 * - 嵌套深度限制：通过 context._orchestratorDepth 防止无限递归
 */

import { randomUUID } from "node:crypto";
import type { DelegationProtocol } from "@belldandy/skills";
import type { AgentRegistry } from "./agent-registry.js";
import type { ConversationStore } from "./conversation.js";
import type { AgentStreamItem, BelldandyAgent } from "./index.js";
import {
  buildLaneSummary,
  getOrCreateSharedCompressedContextStore,
  injectSharedCompressedContext,
} from "./shared-compressed-context.js";
import {
  DEFAULT_AGENT_LAUNCH_TIMEOUT_MS,
  normalizeAgentLaunchSpecWithCatalog,
  type AgentLaunchSpec,
  type AgentLaunchSpecInput,
} from "./launch-spec.js";

// ─── Types ───────────────────────────────────────────────────────────────

export type SubAgentSessionStatus = "pending" | "running" | "done" | "error" | "timeout" | "stopped";

export type SubAgentSession = {
  id: string;
  parentConversationId: string;
  agentId: string;
  status: SubAgentSessionStatus;
  instruction: string;
  launchSpec: AgentLaunchSpec;
  createdAt: number;
  resumedFromSessionId?: string;
  finishedAt?: number;
  result?: string;
  error?: string;
};

export type SubAgentEvent =
  | { type: "started"; sessionId: string; agentId: string; instruction: string }
  | { type: "queued"; sessionId: string; position: number }
  | { type: "thought_delta"; sessionId: string; delta: string }
  | { type: "completed"; sessionId: string; success: boolean; output: string; error?: string };

type SpawnCallbacks = {
  /** 父级运行的取消信号；编排器会转发到独立的 session controller。 */
  abortSignal?: AbortSignal;
  shouldAbortBeforeStart?: () => boolean | Promise<boolean>;
  /** 排队时立即提供真实 sessionId，便于上层在启动前停止。 */
  onQueued?: (position: number, sessionId?: string, agentId?: string) => void;
  onSessionCreated?: (sessionId: string, agentId: string) => void;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  resumedFromSessionId?: string;
};

type SpawnOptionsLegacy = {
  parentConversationId: string;
  agentId?: string;
  instruction: string;
  context?: Record<string, unknown>;
  delegationProtocol?: DelegationProtocol;
};

type SpawnOptionsWithSpec = {
  launchSpec: AgentLaunchSpecInput;
};

export type SpawnOptions = (SpawnOptionsLegacy | SpawnOptionsWithSpec) & SpawnCallbacks;

export type SpawnResult = {
  success: boolean;
  output: string;
  error?: string;
  sessionId: string;
};

type PendingSpawn = {
  sessionId: string;
  opts: SpawnOptions;
  resolve: (result: SpawnResult) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
};

type SessionControl = {
  controller: AbortController;
  clearParentAbortListener?: () => void;
  queueTimeout?: ReturnType<typeof setTimeout>;
};

type SessionCompletionBarrier = {
  sessionEndHook: Promise<void>;
  streamFinalizer: Promise<void>;
};

export type SubAgentOrchestratorRuntimeSnapshot = {
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
  maxQueueSize: number;
  retainedTerminalCount: number;
  maxRetainedTerminalCount: number;
  evictedTerminalCount: number;
  oldestRetainedTerminalAgeMs: number;
};

export type OrchestratorLogger = {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
};

export type OrchestratorOptions = {
  agentRegistry: AgentRegistry;
  conversationStore: ConversationStore;
  maxConcurrent?: number;
  maxQueueSize?: number;
  sessionTimeoutMs?: number;
  maxDepth?: number;
  terminalSessionMaxEntries?: number;
  terminalSessionRetentionMs?: number;
  logger?: OrchestratorLogger;
  onEvent?: (event: SubAgentEvent) => void;
  hookRunner?: OrchestratorHookRunner;
};

/**
 * 可选的钩子运行器接口，用于触发 session_start / session_end 钩子。
 * 由 gateway 层注入实际的 HookRunner 实例。
 */
export type OrchestratorHookRunner = {
  runSessionStart: (event: { sessionId: string; resumedFrom?: string }, ctx: { agentId?: string; sessionId: string; abortSignal?: AbortSignal }) => Promise<void>;
  runSessionEnd: (event: { sessionId: string; messageCount: number; durationMs?: number }, ctx: { agentId?: string; sessionId: string; abortSignal?: AbortSignal }) => Promise<void>;
};

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_QUEUE_SIZE = 10;
const DEFAULT_SESSION_TIMEOUT_MS = DEFAULT_AGENT_LAUNCH_TIMEOUT_MS;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_TERMINAL_SESSION_MAX_ENTRIES = 256;
const DEFAULT_TERMINAL_SESSION_RETENTION_MS = 600_000;

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (value !== undefined && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function toLaunchSpecInput(opts: SpawnOptions): AgentLaunchSpecInput {
  if ("launchSpec" in opts) {
    return opts.launchSpec;
  }
  return {
    instruction: opts.instruction,
    parentConversationId: opts.parentConversationId,
    agentId: opts.agentId,
    context: opts.context,
    modelOverride: undefined,
    delegationProtocol: opts.delegationProtocol,
  };
}

function resolveLaunchSpec(
  agentRegistry: AgentRegistry,
  opts: SpawnOptions,
  sessionTimeoutMs: number,
): AgentLaunchSpec {
  return normalizeAgentLaunchSpecWithCatalog(toLaunchSpecInput(opts), {
    agentRegistry,
    defaults: {
      timeoutMs: sessionTimeoutMs,
    },
  });
}

// ─── SubAgentOrchestrator ────────────────────────────────────────────────

export class SubAgentOrchestrator {
  private sessions = new Map<string, SubAgentSession>();
  private terminalSessions = new Map<string, number>();
  private sessionStopHandlers = new Map<string, (reason?: string) => Promise<SpawnResult>>();
  private sessionControls = new Map<string, SessionControl>();
  private runningCount = 0;
  private pendingQueue: PendingSpawn[] = [];
  private evictedTerminalCount = 0;

  private readonly agentRegistry: AgentRegistry;
  private readonly conversationStore: ConversationStore;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly sessionTimeoutMs: number;
  private readonly maxDepth: number;
  private readonly terminalSessionMaxEntries: number;
  private readonly terminalSessionRetentionMs: number;
  private readonly logger?: OrchestratorLogger;
  private readonly onEvent?: (event: SubAgentEvent) => void;
  private readonly hookRunner?: OrchestratorHookRunner;

  constructor(options: OrchestratorOptions) {
    this.agentRegistry = options.agentRegistry;
    this.conversationStore = options.conversationStore;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.terminalSessionMaxEntries = resolvePositiveInteger(
      options.terminalSessionMaxEntries,
      DEFAULT_TERMINAL_SESSION_MAX_ENTRIES,
    );
    this.terminalSessionRetentionMs = resolvePositiveInteger(
      options.terminalSessionRetentionMs,
      DEFAULT_TERMINAL_SESSION_RETENTION_MS,
    );
    this.logger = options.logger;
    this.onEvent = options.onEvent;
    this.hookRunner = options.hookRunner;
  }

  resolveLaunchSpec(input: AgentLaunchSpecInput): AgentLaunchSpec {
    return normalizeAgentLaunchSpecWithCatalog(input, {
      agentRegistry: this.agentRegistry,
      defaults: {
        timeoutMs: this.sessionTimeoutMs,
      },
    });
  }

  private emitEvent(event: SubAgentEvent): void {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch (err) {
      this.logger?.warn(`Sub-agent event handler error: ${err}`);
    }
  }

  /** 创建可在排队阶段就被取消的真实 session。 */
  private createPendingSession(launchSpec: AgentLaunchSpec, opts: SpawnOptions): SubAgentSession {
    const session: SubAgentSession = {
      id: `sub_${randomUUID().slice(0, 8)}`,
      parentConversationId: launchSpec.parentConversationId,
      agentId: launchSpec.agentId,
      status: "pending",
      instruction: launchSpec.instruction,
      launchSpec,
      createdAt: Date.now(),
      resumedFromSessionId: opts.resumedFromSessionId,
    };
    const control: SessionControl = {
      controller: new AbortController(),
    };

    this.sessions.set(session.id, session);
    this.sessionControls.set(session.id, control);
    this.sessionStopHandlers.set(session.id, (reason) => Promise.resolve(
      this.finishPendingSession(session, "stopped", reason ?? "Sub-agent stopped by user."),
    ));

    const parentSignal = opts.abortSignal;
    if (parentSignal) {
      const stopFromParent = () => {
        void this.stopSession(
          session.id,
          readAbortReason(parentSignal, "Sub-agent stopped by parent workflow."),
        );
      };
      if (parentSignal.aborted) {
        stopFromParent();
      } else {
        parentSignal.addEventListener("abort", stopFromParent, { once: true });
        control.clearParentAbortListener = () => {
          parentSignal.removeEventListener("abort", stopFromParent);
        };
      }
    }

    return session;
  }

  /** 排队 timeout 与父级 listener 都必须在终态后释放，避免 session 常驻引用。 */
  private releaseSessionControl(sessionId: string): void {
    const control = this.sessionControls.get(sessionId);
    if (!control) return;
    if (control.queueTimeout) {
      clearTimeout(control.queueTimeout);
    }
    control.clearParentAbortListener?.();
    this.sessionControls.delete(sessionId);
  }

  private clearQueueTimeout(sessionId: string): void {
    const control = this.sessionControls.get(sessionId);
    if (!control?.queueTimeout) return;
    clearTimeout(control.queueTimeout);
    control.queueTimeout = undefined;
  }

  private abortSession(sessionId: string, reason: string): void {
    const controller = this.sessionControls.get(sessionId)?.controller;
    if (controller && !controller.signal.aborted) {
      controller.abort(reason);
    }
  }

  private toTerminalResult(session: SubAgentSession, fallback: string): SpawnResult {
    return {
      success: false,
      output: "",
      error: session.error ?? fallback,
      sessionId: session.id,
    };
  }

  private finishPendingSession(
    session: SubAgentSession,
    status: Extract<SubAgentSessionStatus, "error" | "timeout" | "stopped">,
    error: string,
  ): SpawnResult {
    if (session.status !== "pending") {
      return this.toTerminalResult(session, error);
    }

    // 先提交 terminal latch，再触发取消；迟到的 queued/drain 回调不得重新启动 session。
    session.status = status;
    session.finishedAt = Date.now();
    session.error = error;
    this.abortSession(session.id, error);
    this.clearQueueTimeout(session.id);
    this.sessionStopHandlers.delete(session.id);

    const queueIndex = this.pendingQueue.findIndex((item) => item.sessionId === session.id);
    const queued = queueIndex >= 0 ? this.pendingQueue.splice(queueIndex, 1)[0] : undefined;
    this.emitEvent({
      type: "completed",
      sessionId: session.id,
      success: false,
      output: "",
      error,
    });
    this.releaseSessionControl(session.id);
    this.retainTerminalSession(session);

    const result = this.toTerminalResult(session, error);
    queued?.resolve(result);
    return result;
  }

  private armQueueTimeout(session: SubAgentSession): void {
    const timeoutMs = session.launchSpec.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    const control = this.sessionControls.get(session.id);
    if (!control) return;
    control.queueTimeout = setTimeout(() => {
      const waitMs = Date.now() - session.createdAt;
      this.finishPendingSession(
        session,
        "timeout",
        `Sub-agent timed out while waiting in queue (${waitMs}ms).`,
      );
    }, timeoutMs);
  }

  /**
   * Spawn a sub-agent, run it to completion, and return the aggregated result.
   * If concurrency limit is reached, the request is queued (up to maxQueueSize).
   */
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const launchSpec = resolveLaunchSpec(this.agentRegistry, opts, this.sessionTimeoutMs);
    const normalizedOpts: SpawnOptions = {
      ...opts,
      launchSpec,
    };
    const agentId = launchSpec.agentId;

    // ── Depth check ──
    const depth = (launchSpec.context?._orchestratorDepth as number) ?? 0;
    if (depth >= this.maxDepth) {
      return {
        success: false,
        output: "",
        error: `Max sub-agent nesting depth (${this.maxDepth}) exceeded. Current depth: ${depth}.`,
        sessionId: `sub_rejected`,
      };
    }

    // ── Concurrency check → queue if full ──
    const shouldQueue = this.runningCount >= this.maxConcurrent;
    if (shouldQueue && this.pendingQueue.length >= this.maxQueueSize) {
      return {
        success: false,
        output: "",
        error: `Sub-agent queue full (max ${this.maxQueueSize}). Try again later.`,
        sessionId: `sub_rejected`,
      };
    }

    const session = this.createPendingSession(launchSpec, normalizedOpts);
    if (session.status !== "pending") {
      return this.toTerminalResult(session, "Sub-agent stopped before execution.");
    }

    if (!shouldQueue) {
      return this.executeSpawn(normalizedOpts, session.id);
    }

    this.logger?.info(`Sub-agent queued (position=${this.pendingQueue.length + 1}, agent=${agentId})`);
    return new Promise<SpawnResult>((resolve, reject) => {
      const position = this.pendingQueue.length + 1;
      this.pendingQueue.push({
        sessionId: session.id,
        opts: normalizedOpts,
        resolve,
        reject,
        enqueuedAt: session.createdAt,
      });
      this.armQueueTimeout(session);
      try {
        normalizedOpts.onQueued?.(position, session.id, agentId);
      } catch (err) {
        this.logger?.warn(`Sub-agent queue callback error: ${err}`);
      }

      if (session.status === "pending") {
        this.emitEvent({
          type: "queued",
          sessionId: session.id,
          position,
        });
      }
    });
  }

  /**
   * Internal: actually execute a spawn (assumes concurrency slot is available).
   */
  private async executeSpawn(opts: SpawnOptions, sessionId: string): Promise<SpawnResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        output: "",
        error: "Sub-agent session was not found before execution.",
        sessionId,
      };
    }
    const launchSpec = session.launchSpec;
    const agentId = session.agentId;

    const shouldAbort = opts.shouldAbortBeforeStart
      ? await opts.shouldAbortBeforeStart()
      : false;
    const abortSignal = this.sessionControls.get(session.id)?.controller.signal;
    if (session.status !== "pending" || shouldAbort || abortSignal?.aborted) {
      if (session.status === "pending") {
        this.logger?.info(`Sub-agent skipped before start due to pending stop request: ${agentId}`);
        return this.finishPendingSession(
          session,
          "stopped",
          readAbortReason(abortSignal, "Sub-agent stopped before execution."),
        );
      }
      return this.toTerminalResult(session, "Sub-agent stopped before execution.");
    }

    // ── Resolve agent ──
    let agent: BelldandyAgent;
    try {
      agent = this.agentRegistry.create(agentId, launchSpec.modelOverride ? { modelOverride: launchSpec.modelOverride } : undefined);
    } catch (err) {
      return this.finishPendingSession(
        session,
        "error",
        `Failed to create agent "${agentId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (session.status !== "pending" || abortSignal?.aborted) {
      if (session.status === "pending") {
        return this.finishPendingSession(
          session,
          "stopped",
          readAbortReason(abortSignal, "Sub-agent stopped before execution."),
        );
      }
      return this.toTerminalResult(session, "Sub-agent stopped before execution.");
    }

    // ── Start the accepted session ──
    session.status = "running";
    this.clearQueueTimeout(session.id);
    this.runningCount++;
    const completionBarrier: SessionCompletionBarrier = {
      sessionEndHook: Promise.resolve(),
      streamFinalizer: Promise.resolve(),
    };
    const run = this.runWithTimeout(agent, session, opts, completionBarrier);
    try {
      opts.onSessionCreated?.(sessionId, agentId);
    } catch (err) {
      this.logger?.warn(`Sub-agent session callback error: ${err}`);
    }

    if (session.status === "running") {
      this.logger?.info(`Sub-agent spawned: ${sessionId} (agent=${agentId})`, {
        parentConversationId: launchSpec.parentConversationId,
        instruction: launchSpec.instruction.slice(0, 200),
        launchSpec: {
          profileId: launchSpec.profileId,
          modelOverride: launchSpec.modelOverride,
          channel: launchSpec.channel,
          background: launchSpec.background,
          timeoutMs: launchSpec.timeoutMs,
          role: launchSpec.role,
          allowedToolFamilies: launchSpec.allowedToolFamilies,
          maxToolRiskLevel: launchSpec.maxToolRiskLevel,
          policySummary: launchSpec.policySummary,
        },
        resumedFromSessionId: opts.resumedFromSessionId,
      });

      this.emitEvent({
        type: "started",
        sessionId,
        agentId,
        instruction: launchSpec.instruction,
      });

      // ── Hook: session_start ──
      this.hookRunner?.runSessionStart(
        { sessionId },
        { agentId, sessionId, abortSignal },
      ).catch((err) => this.logger?.warn(`session_start hook error: ${err}`));
    }

    // ── Run with timeout ──
    try {
      return await run;
    } finally {
      const agentRelease = this.releaseAgentConversation(agent, session.id);
      this.releaseConversationStoreAfterCompletion(session.id, [
        completionBarrier.sessionEndHook,
        completionBarrier.streamFinalizer,
        agentRelease,
      ]);
      this.runningCount--;
      this.drainQueue();
    }
  }

  /**
   * Drain the pending queue: execute the next queued spawn if a slot is available.
   */
  private drainQueue(): void {
    while (this.pendingQueue.length > 0 && this.runningCount < this.maxConcurrent) {
      const next = this.pendingQueue.shift()!;
      const session = this.sessions.get(next.sessionId);
      if (!session || session.status !== "pending") {
        continue;
      }
      this.clearQueueTimeout(session.id);

      // Check if the queued request has been waiting too long
      const waitMs = Date.now() - next.enqueuedAt;
      if (waitMs > session.launchSpec.timeoutMs) {
        const result = this.finishPendingSession(
          session,
          "timeout",
          `Sub-agent timed out while waiting in queue (${waitMs}ms).`,
        );
        next.resolve(result);
        continue;
      }

      this.executeSpawn(next.opts, session.id).then(next.resolve, next.reject);
    }
  }

  /**
   * Current pending queue size.
   */
  get queueSize(): number {
    return this.pendingQueue.length;
  }

  /** 仅暴露并发、排队与终态保留水位，供上层资源观测使用。 */
  getRuntimeSnapshot(): SubAgentOrchestratorRuntimeSnapshot {
    const now = Date.now();
    this.pruneTerminalSessions(now, this.terminalSessionRetentionMs, true);
    const oldestFinishedAt = this.terminalSessions.values().next().value as number | undefined;
    return {
      activeCount: this.runningCount,
      queuedCount: this.pendingQueue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
      retainedTerminalCount: this.terminalSessions.size,
      maxRetainedTerminalCount: this.terminalSessionMaxEntries,
      evictedTerminalCount: this.evictedTerminalCount,
      oldestRetainedTerminalAgeMs: oldestFinishedAt === undefined
        ? 0
        : Math.max(0, now - oldestFinishedAt),
    };
  }

  /**
   * Spawn multiple sub-agents in parallel (limited by maxConcurrent).
   */
  async spawnParallel(tasks: SpawnOptions[]): Promise<SpawnResult[]> {
    return Promise.all(tasks.map((task) => this.spawn(task)));
  }

  /**
   * List sessions, optionally filtered by parent conversation ID.
   */
  listSessions(parentConversationId?: string): Array<{
    id: string;
    parentId?: string;
    agentId?: string;
    status: SubAgentSession["status"];
    createdAt: number;
    finishedAt?: number;
    summary?: string;
  }> {
    this.pruneTerminalSessions(Date.now(), this.terminalSessionRetentionMs, true);
    const all = [...this.sessions.values()];
    const filtered = parentConversationId
      ? all.filter((s) => s.parentConversationId === parentConversationId)
      : all;

    return filtered.map((s) => ({
      id: s.id,
      parentId: s.parentConversationId,
      agentId: s.agentId,
      status: s.status,
      createdAt: s.createdAt,
      finishedAt: s.finishedAt,
      summary: s.result?.slice(0, 200),
    }));
  }

  /**
   * Get a specific session by ID.
   */
  getSession(sessionId: string): SubAgentSession | undefined {
    this.pruneTerminalSessions(Date.now(), this.terminalSessionRetentionMs, true);
    return this.sessions.get(sessionId);
  }

  async stopSession(sessionId: string, reason = "Sub-agent stopped by user."): Promise<boolean> {
    const stopHandler = this.sessionStopHandlers.get(sessionId);
    if (!stopHandler) return false;
    await stopHandler(reason);
    return true;
  }

  /**
   * Clean up completed sessions older than maxAgeMs.
   * Returns the number of sessions cleaned.
   */
  cleanup(maxAgeMs: number = this.terminalSessionRetentionMs): number {
    const cleaned = this.pruneTerminalSessions(Date.now(), Math.max(0, maxAgeMs), false);
    if (cleaned > 0) {
      this.logger?.debug(`Cleaned up ${cleaned} sub-agent sessions`);
    }
    return cleaned;
  }

  private retainTerminalSession(session: SubAgentSession): void {
    if (session.status === "running" || session.status === "pending") return;

    const finishedAt = session.finishedAt ?? Date.now();
    // Map 顺序即完成顺序；重复终态提交先删除再写入，避免旧位置破坏最老优先淘汰。
    this.terminalSessions.delete(session.id);
    this.terminalSessions.set(session.id, finishedAt);
    this.pruneTerminalSessions(Date.now(), this.terminalSessionRetentionMs, true);
  }

  private pruneTerminalSessions(now: number, maxAgeMs: number, enforceCapacity: boolean): number {
    let cleaned = 0;
    for (const [id, recordedFinishedAt] of this.terminalSessions) {
      const session = this.sessions.get(id);
      if (!session || session.status === "running" || session.status === "pending") {
        this.terminalSessions.delete(id);
        continue;
      }
      const finishedAt = session.finishedAt ?? recordedFinishedAt;
      if (now - finishedAt >= maxAgeMs && this.evictTerminalSession(id)) {
        cleaned++;
      }
    }

    if (enforceCapacity) {
      while (this.terminalSessions.size > this.terminalSessionMaxEntries) {
        const oldestId = this.terminalSessions.keys().next().value as string | undefined;
        if (!oldestId) break;
        if (this.evictTerminalSession(oldestId)) {
          cleaned++;
        }
      }
    }
    return cleaned;
  }

  private evictTerminalSession(sessionId: string): boolean {
    this.terminalSessions.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "running" || session.status === "pending") {
      return false;
    }
    this.sessions.delete(sessionId);
    this.evictedTerminalCount++;
    return true;
  }

  private async releaseAgentConversation(agent: BelldandyAgent, conversationId: string): Promise<void> {
    try {
      await agent.releaseConversation?.(conversationId);
    } catch (error) {
      this.logger?.warn(`Sub-agent conversation release failed: ${conversationId}`, { error });
    }
  }

  private releaseConversationStoreAfterCompletion(
    conversationId: string,
    barriers: Promise<void>[],
  ): void {
    void Promise.all(barriers)
      .then(() => this.conversationStore.releaseConversation(conversationId))
      .catch((error) => {
        this.logger?.warn(`Sub-agent ConversationStore release failed: ${conversationId}`, { error });
      });
  }

  private runSessionEndHook(
    event: { sessionId: string; messageCount: number; durationMs?: number },
    ctx: { agentId?: string; sessionId: string; abortSignal?: AbortSignal },
  ): Promise<void> {
    if (!this.hookRunner) return Promise.resolve();
    try {
      return this.hookRunner.runSessionEnd(event, ctx).catch((err) => {
        this.logger?.warn(`session_end hook error: ${err}`);
      });
    } catch (err) {
      this.logger?.warn(`session_end hook error: ${err}`);
      return Promise.resolve();
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private runWithTimeout(
    agent: BelldandyAgent,
    session: SubAgentSession,
    opts: SpawnOptions,
    completionBarrier: SessionCompletionBarrier,
  ): Promise<SpawnResult> {
    const conversationId = session.id; // sub-agent uses its own session ID as conversationId
    const timeoutMs = session.launchSpec.timeoutMs;
    const providedHistory = Array.isArray(opts.history) ? opts.history : [];

    if (providedHistory.length > 0) {
      for (const item of providedHistory) {
        this.conversationStore.addMessage(conversationId, item.role, item.content, {
          agentId: session.agentId,
        });
      }
    }
    this.conversationStore.addMessage(conversationId, "user", session.launchSpec.instruction, {
      agentId: session.agentId,
    });

    const history = providedHistory.length > 0
      ? providedHistory.map((item) => ({ ...item }))
      : this.conversationStore.getHistory(conversationId);
    injectSharedCompressedContextForTeamRun(history, session.launchSpec);

    const abortSignal = this.sessionControls.get(session.id)?.controller.signal;
    if (!abortSignal) {
      return Promise.resolve(this.toTerminalResult(session, "Sub-agent session control was released."));
    }

    return new Promise<SpawnResult>((resolve) => {
      let terminal = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const acquireTerminal = (): boolean => {
        if (terminal) return false;
        terminal = true;
        if (timer) {
          clearTimeout(timer);
        }
        this.sessionStopHandlers.delete(session.id);
        return true;
      };

      const stream = this.createAgentStream(agent, opts, conversationId, history, abortSignal);
      const iterator = stream[Symbol.asyncIterator]();

      const finishFailure = (
        status: Extract<SubAgentSessionStatus, "error" | "timeout" | "stopped">,
        error: string,
        shouldAbort: boolean,
      ): SpawnResult => {
        if (!acquireTerminal()) {
          return this.toTerminalResult(session, error);
        }

        // 必须在关闭 generator 前 abort，使模型、工具和支持 signal 的 Hook 立刻收到停止请求。
        if (shouldAbort) {
          this.abortSession(session.id, error);
        }
        session.status = status;
        session.finishedAt = Date.now();
        session.error = error;

        if (status === "timeout") {
          this.logger?.warn(`Sub-agent timeout: ${session.id}`);
        } else if (status === "stopped") {
          this.logger?.info(`Sub-agent stopped: ${session.id}`, {
            agentId: session.agentId,
            reason: error,
            durationMs: session.finishedAt - session.createdAt,
          });
        } else {
          this.logger?.error(`Sub-agent error: ${session.id}`, { error });
        }

        this.emitEvent({
          type: "completed",
          sessionId: session.id,
          success: false,
          output: "",
          error,
        });
        completionBarrier.sessionEndHook = this.runSessionEndHook(
          { sessionId: session.id, messageCount: 0, durationMs: session.finishedAt - session.createdAt },
          { agentId: session.agentId, sessionId: session.id, abortSignal },
        );

        if (shouldAbort) {
          // 不等待 return()：挂起的 provider/tool 必须由 signal 取消，不能阻塞 stop RPC。
          completionBarrier.streamFinalizer = this.closeIterator(iterator, session.id);
        }
        this.releaseSessionControl(session.id);
        this.retainTerminalSession(session);
        const result = this.toTerminalResult(session, error);
        resolve(result);
        return result;
      };

      timer = setTimeout(() => {
        finishFailure(
          "timeout",
          `Sub-agent timed out after ${timeoutMs}ms`,
          true,
        );
      }, timeoutMs);

      this.sessionStopHandlers.set(session.id, (reason = "Sub-agent stopped by user.") => Promise.resolve(
        finishFailure("stopped", reason, true),
      ));

      this.consumeStream(iterator, session, () => terminal)
        .then((finalText) => {
          if (!acquireTerminal()) return;

          session.status = "done";
          session.finishedAt = Date.now();
          session.result = finalText;

          this.conversationStore.addMessage(conversationId, "assistant", finalText, {
            agentId: session.agentId,
          });
          persistSharedCompressedContextForTeamRun(session, finalText);

          this.logger?.info(`Sub-agent completed: ${session.id}`, {
            agentId: session.agentId,
            outputLength: finalText.length,
            durationMs: session.finishedAt - session.createdAt,
          });
          this.emitEvent({
            type: "completed",
            sessionId: session.id,
            success: true,
            output: finalText,
          });
          completionBarrier.sessionEndHook = this.runSessionEndHook(
            { sessionId: session.id, messageCount: 2, durationMs: session.finishedAt - session.createdAt },
            { agentId: session.agentId, sessionId: session.id, abortSignal },
          );

          this.releaseSessionControl(session.id);
          this.retainTerminalSession(session);
          resolve({
            success: true,
            output: finalText,
            sessionId: session.id,
          });
        })
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          finishFailure("error", errorMsg, false);
        });
    });
  }

  private createAgentStream(
    agent: BelldandyAgent,
    opts: SpawnOptions,
    conversationId: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    abortSignal: AbortSignal,
  ): AsyncIterable<AgentStreamItem> {
    const launchSpec = resolveLaunchSpec(this.agentRegistry, opts, this.sessionTimeoutMs);
    const depth = ((launchSpec.context?._orchestratorDepth as number) ?? 0) + 1;
    return agent.run({
      conversationId,
      text: launchSpec.instruction,
      history,
      abortSignal,
      meta: {
        ...launchSpec.context,
        _orchestratorDepth: depth,
        _parentConversationId: launchSpec.parentConversationId,
          _agentLaunchSpec: {
            profileId: launchSpec.profileId,
            modelOverride: launchSpec.modelOverride,
            channel: launchSpec.channel,
            background: launchSpec.background,
            timeoutMs: launchSpec.timeoutMs,
          role: launchSpec.role,
          cwd: launchSpec.cwd,
          toolSet: launchSpec.toolSet,
          allowedToolFamilies: launchSpec.allowedToolFamilies,
          maxToolRiskLevel: launchSpec.maxToolRiskLevel,
            policySummary: launchSpec.policySummary,
            permissionMode: launchSpec.permissionMode,
            isolationMode: launchSpec.isolationMode,
            parentTaskId: launchSpec.parentTaskId,
            delegationProtocol: launchSpec.delegationProtocol,
            bridgeSubtask: launchSpec.bridgeSubtask,
          },
        },
      });
  }

  private async closeIterator(
    iterator: AsyncIterator<AgentStreamItem>,
    sessionId: string,
  ): Promise<void> {
    if (typeof iterator.return !== "function") return;
    try {
      await iterator.return(undefined);
    } catch (err) {
      this.logger?.warn(`Sub-agent iterator close error: ${sessionId} ${err}`);
    }
  }

  private async consumeStream(
    iterator: AsyncIterator<AgentStreamItem>,
    session: SubAgentSession,
    isTerminal: () => boolean,
  ): Promise<string> {
    let finalText = "";
    let lastDelta = "";

    while (true) {
      const { value: item, done } = await iterator.next();
      if (done) break;

      if (isTerminal()) {
        return finalText;
      }

      switch (item.type) {
        case "delta":
          lastDelta += item.delta;
          // Batch deltas to avoid flooding the event bus
          if (lastDelta.length >= 50) {
            this.emitEvent({
              type: "thought_delta",
              sessionId: session.id,
              delta: lastDelta,
            });
            lastDelta = "";
          }
          break;

        case "final":
          finalText = item.text;
          break;

        // tool_call / tool_result / status / usage — ignored for parent context
      }
    }

    if (isTerminal()) {
      return finalText;
    }

    // Flush remaining delta
    if (lastDelta.length > 0) {
      this.emitEvent({
        type: "thought_delta",
        sessionId: session.id,
        delta: lastDelta,
      });
    }
    return finalText;
  }
}

function injectSharedCompressedContextForTeamRun(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  launchSpec: AgentLaunchSpec,
): void {
  const team = launchSpec.delegationProtocol?.team;
  if (!team?.id || !team.currentLaneId) {
    return;
  }
  const store = getOrCreateSharedCompressedContextStore(team.id);
  const contextText = store.buildFanInContextText();
  if (!contextText) {
    return;
  }
  injectSharedCompressedContext(history, contextText);
}

function persistSharedCompressedContextForTeamRun(
  session: SubAgentSession,
  output: string,
): void {
  const team = session.launchSpec.delegationProtocol?.team;
  if (!team?.id || !team.currentLaneId) {
    return;
  }
  const store = getOrCreateSharedCompressedContextStore(team.id);
  const summary = buildLaneSummary(output);
  store.upsert({
    laneId: team.currentLaneId,
    agentId: session.agentId,
    rawSummary: summary,
  });
}

function readAbortReason(signal: AbortSignal | undefined, fallback: string): string {
  const reason = signal?.reason;
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }
  return fallback;
}
