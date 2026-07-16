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
  shouldAbortBeforeStart?: () => boolean | Promise<boolean>;
  onQueued?: (position: number) => void;
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

export type SubAgentOrchestratorRuntimeSnapshot = {
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
  maxQueueSize: number;
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
  logger?: OrchestratorLogger;
  onEvent?: (event: SubAgentEvent) => void;
  hookRunner?: OrchestratorHookRunner;
};

/**
 * 可选的钩子运行器接口，用于触发 session_start / session_end 钩子。
 * 由 gateway 层注入实际的 HookRunner 实例。
 */
export type OrchestratorHookRunner = {
  runSessionStart: (event: { sessionId: string; resumedFrom?: string }, ctx: { agentId?: string; sessionId: string }) => Promise<void>;
  runSessionEnd: (event: { sessionId: string; messageCount: number; durationMs?: number }, ctx: { agentId?: string; sessionId: string }) => Promise<void>;
};

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_QUEUE_SIZE = 10;
const DEFAULT_SESSION_TIMEOUT_MS = DEFAULT_AGENT_LAUNCH_TIMEOUT_MS;
const DEFAULT_MAX_DEPTH = 2;

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
  private sessionStopHandlers = new Map<string, (reason?: string) => Promise<SpawnResult>>();
  private runningCount = 0;
  private pendingQueue: Array<{
    opts: SpawnOptions;
    resolve: (result: SpawnResult) => void;
    reject: (err: Error) => void;
    enqueuedAt: number;
  }> = [];

  private readonly agentRegistry: AgentRegistry;
  private readonly conversationStore: ConversationStore;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly sessionTimeoutMs: number;
  private readonly maxDepth: number;
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
    if (this.runningCount >= this.maxConcurrent) {
      if (this.pendingQueue.length >= this.maxQueueSize) {
        return {
          success: false,
          output: "",
          error: `Sub-agent queue full (max ${this.maxQueueSize}). Try again later.`,
          sessionId: `sub_rejected`,
        };
      }

      this.logger?.info(`Sub-agent queued (position=${this.pendingQueue.length + 1}, agent=${agentId})`);

      return new Promise<SpawnResult>((resolve, reject) => {
        const position = this.pendingQueue.length + 1;
        this.pendingQueue.push({ opts: normalizedOpts, resolve, reject, enqueuedAt: Date.now() });
        try {
          normalizedOpts.onQueued?.(position);
        } catch (err) {
          this.logger?.warn(`Sub-agent queue callback error: ${err}`);
        }

        this.emitEvent({
          type: "queued",
          sessionId: `sub_queued_${agentId}`,
          position,
        });
      });
    }

    return this.executeSpawn(normalizedOpts);
  }

  /**
   * Internal: actually execute a spawn (assumes concurrency slot is available).
   */
  private async executeSpawn(opts: SpawnOptions): Promise<SpawnResult> {
    const launchSpec = resolveLaunchSpec(this.agentRegistry, opts, this.sessionTimeoutMs);
    const agentId = launchSpec.agentId;
    const sessionId = `sub_${randomUUID().slice(0, 8)}`;

    const shouldAbort = opts.shouldAbortBeforeStart
      ? await opts.shouldAbortBeforeStart()
      : false;
    if (shouldAbort) {
      this.logger?.info(`Sub-agent skipped before start due to pending stop request: ${agentId}`);
      return {
        success: false,
        output: "",
        error: "Sub-agent stopped before execution.",
        sessionId,
      };
    }

    // ── Resolve agent ──
    let agent: BelldandyAgent;
    try {
      agent = this.agentRegistry.create(agentId, launchSpec.modelOverride ? { modelOverride: launchSpec.modelOverride } : undefined);
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `Failed to create agent "${agentId}": ${err instanceof Error ? err.message : String(err)}`,
        sessionId,
      };
    }

    // ── Create session ──
    const session: SubAgentSession = {
      id: sessionId,
      parentConversationId: launchSpec.parentConversationId,
      agentId,
      status: "running",
      instruction: launchSpec.instruction,
      launchSpec,
      createdAt: Date.now(),
      resumedFromSessionId: opts.resumedFromSessionId,
    };
    this.sessions.set(sessionId, session);
    this.runningCount++;
    try {
      opts.onSessionCreated?.(sessionId, agentId);
    } catch (err) {
      this.logger?.warn(`Sub-agent session callback error: ${err}`);
    }

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
      { agentId, sessionId },
    ).catch((err) => this.logger?.warn(`session_start hook error: ${err}`));

    // ── Run with timeout ──
    try {
      const result = await this.runWithTimeout(agent, session, opts);
      return result;
    } finally {
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
      const launchSpec = resolveLaunchSpec(this.agentRegistry, next.opts, this.sessionTimeoutMs);

      // Check if the queued request has been waiting too long
      const waitMs = Date.now() - next.enqueuedAt;
      if (waitMs > launchSpec.timeoutMs) {
        next.resolve({
          success: false,
          output: "",
          error: `Sub-agent timed out while waiting in queue (${waitMs}ms).`,
          sessionId: `sub_queue_timeout`,
        });
        continue;
      }

      this.executeSpawn(next.opts).then(next.resolve, next.reject);
    }
  }

  /**
   * Current pending queue size.
   */
  get queueSize(): number {
    return this.pendingQueue.length;
  }

  /** 仅暴露并发和排队水位，供上层资源观测使用。 */
  getRuntimeSnapshot(): SubAgentOrchestratorRuntimeSnapshot {
    return {
      activeCount: this.runningCount,
      queuedCount: this.pendingQueue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
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
  cleanup(maxAgeMs: number = 600_000): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (
        session.status !== "running" &&
        session.status !== "pending" &&
        now - session.createdAt >= maxAgeMs
      ) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger?.debug(`Cleaned up ${cleaned} sub-agent sessions`);
    }
    return cleaned;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private async runWithTimeout(
    agent: BelldandyAgent,
    session: SubAgentSession,
    opts: SpawnOptions,
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

    return new Promise<SpawnResult>((resolve) => {
      let settled = false;
      let timedOut = false;
      const finish = (result: SpawnResult): boolean => {
        if (settled) return false;
        settled = true;
        this.sessionStopHandlers.delete(session.id);
        resolve(result);
        return true;
      };

      const stream = this.createAgentStream(agent, opts, conversationId, history);
      const iterator = stream[Symbol.asyncIterator]();

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        session.status = "timeout";
        session.finishedAt = Date.now();
        session.error = `Sub-agent timed out after ${timeoutMs}ms`;

        this.logger?.warn(`Sub-agent timeout: ${session.id}`);
        this.emitEvent({
          type: "completed",
          sessionId: session.id,
          success: false,
          output: "",
          error: session.error,
        });

        // Hook: session_end (timeout)
        this.hookRunner?.runSessionEnd(
          { sessionId: session.id, messageCount: 0, durationMs: session.finishedAt - session.createdAt },
          { agentId: session.agentId, sessionId: session.id },
        ).catch((err) => this.logger?.warn(`session_end hook error: ${err}`));

        void this.closeIterator(iterator, session.id);

        finish({
          success: false,
          output: "",
          error: session.error,
          sessionId: session.id,
        });
      }, timeoutMs);

      this.sessionStopHandlers.set(session.id, async (reason = "Sub-agent stopped by user.") => {
        if (settled) {
          return {
            success: false,
            output: "",
            error: session.error ?? reason,
            sessionId: session.id,
          };
        }
        clearTimeout(timer);
        session.status = "stopped";
        session.finishedAt = Date.now();
        session.error = reason;

        this.logger?.info(`Sub-agent stopped: ${session.id}`, {
          agentId: session.agentId,
          reason,
          durationMs: session.finishedAt - session.createdAt,
        });
        this.emitEvent({
          type: "completed",
          sessionId: session.id,
          success: false,
          output: "",
          error: reason,
        });
        this.hookRunner?.runSessionEnd(
          { sessionId: session.id, messageCount: 0, durationMs: session.finishedAt - session.createdAt },
          { agentId: session.agentId, sessionId: session.id },
        ).catch((err) => this.logger?.warn(`session_end hook error: ${err}`));

        await this.closeIterator(iterator, session.id);
        const result = {
          success: false,
          output: "",
          error: reason,
          sessionId: session.id,
        };
        finish(result);
        return result;
      });

      this.consumeStream(iterator, session, conversationId, () => timedOut)
        .then((result) => {
          clearTimeout(timer);
          finish(result);
        })
        .catch((err) => {
          if (settled) return;
          clearTimeout(timer);

          const errorMsg = err instanceof Error ? err.message : String(err);
          session.status = "error";
          session.finishedAt = Date.now();
          session.error = errorMsg;

          this.logger?.error(`Sub-agent error: ${session.id}`, { error: errorMsg });
          this.emitEvent({
            type: "completed",
            sessionId: session.id,
            success: false,
            output: "",
            error: errorMsg,
          });

          // Hook: session_end (error)
          this.hookRunner?.runSessionEnd(
            { sessionId: session.id, messageCount: 0, durationMs: session.finishedAt - session.createdAt },
            { agentId: session.agentId, sessionId: session.id },
          ).catch((e) => this.logger?.warn(`session_end hook error: ${e}`));

          finish({
            success: false,
            output: "",
            error: errorMsg,
            sessionId: session.id,
          });
        });
    });
  }

  private createAgentStream(
    agent: BelldandyAgent,
    opts: SpawnOptions,
    conversationId: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ): AsyncIterable<AgentStreamItem> {
    const launchSpec = resolveLaunchSpec(this.agentRegistry, opts, this.sessionTimeoutMs);
    const depth = ((launchSpec.context?._orchestratorDepth as number) ?? 0) + 1;
    return agent.run({
      conversationId,
      text: launchSpec.instruction,
      history,
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
    conversationId: string,
    isTimedOut: () => boolean,
  ): Promise<SpawnResult> {
    let finalText = "";
    let lastDelta = "";

    while (true) {
      const { value: item, done } = await iterator.next();
      if (done) break;

      if (isTimedOut()) {
        break;
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

    if (isTimedOut() || session.status === "timeout" || session.status === "stopped") {
      return {
        success: false,
        output: "",
        error: session.error ?? (session.status === "stopped"
          ? "Sub-agent stopped by user."
          : `Sub-agent timed out after ${session.launchSpec.timeoutMs}ms`),
        sessionId: session.id,
      };
    }

    // Flush remaining delta
    if (lastDelta.length > 0) {
      this.emitEvent({
        type: "thought_delta",
        sessionId: session.id,
        delta: lastDelta,
      });
    }

    // Update session
    session.status = "done";
    session.finishedAt = Date.now();
    session.result = finalText;

    // Persist assistant response
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

    // Hook: session_end (success)
    this.hookRunner?.runSessionEnd(
      { sessionId: session.id, messageCount: 2, durationMs: (session.finishedAt ?? Date.now()) - session.createdAt },
      { agentId: session.agentId, sessionId: session.id },
    ).catch((err) => this.logger?.warn(`session_end hook error: ${err}`));

    return {
      success: true,
      output: finalText,
      sessionId: session.id,
    };
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
