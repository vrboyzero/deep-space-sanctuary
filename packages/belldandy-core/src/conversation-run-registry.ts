import type {
  CodingRunRecoveryLookup,
  CodingRunRecoveryMarkerStore,
} from "./coding-run/recovery-marker-store.js";
import {
  ConversationFollowUpQueue,
  type ConversationFollowUpClaim,
  type ConversationFollowUpEnqueueResult,
  type ConversationFollowUpView,
  type ConversationRunBinding,
} from "./coding-run/conversation-follow-up-queue.js";
import {
  ConversationSteerMailbox,
  type ConversationSteerEnqueueResult,
  type ConversationSteerView,
} from "./coding-run/conversation-steer-mailbox.js";

export type ConversationRunStopState = "running" | "stop_requested" | "stopped";

export type ConversationRunHandle = {
  conversationId: string;
  runId: string;
  agentId?: string;
  startedAt: number;
  state: ConversationRunStopState;
  stopRequestedAt?: number;
  stoppedAt?: number;
  stopReason?: string;
  stop: (reason?: string) => boolean | Promise<boolean>;
};

export type ConversationRunStopRequest = {
  conversationId: string;
  runId?: string;
  reason?: string;
};

export type ConversationRunStopResult = {
  accepted: boolean;
  runId?: string;
  state: "stop_requested" | "not_found" | "run_mismatch";
};

export type ConversationRunRuntimeSnapshot = {
  activeCount: number;
  stopRequestedCount: number;
};

export type ConversationRunListItem = {
  conversationId: string;
  runId: string;
  agentId?: string;
  startedAt: number;
  state: "running" | "stop_requested";
  stopRequestedAt?: number;
};

type ConversationRunRecoveryStore = Pick<
  CodingRunRecoveryMarkerStore,
  "markActive" | "markSettled" | "lookup"
>;

export type ConversationFollowUpRegistryResult = ConversationFollowUpEnqueueResult | {
  ok: false;
  code: "not_found" | "run_mismatch" | "not_active";
  message: string;
};

export type ConversationSteerRegistryResult = ConversationSteerEnqueueResult | {
  ok: false;
  code: "not_found" | "run_mismatch" | "not_active" | "not_available";
  message: string;
};

type ConversationRunRegistrationOptions = {
  followUp?: ConversationFollowUpClaim;
  steering?: ConversationSteerMailbox;
};

export type ConversationReplacementResult =
  | {
    ok: true;
    replayed: boolean;
    stopRequested: boolean;
    item: ConversationFollowUpView;
  }
  | {
    ok: false;
    code: "invalid_request" | "idempotency_conflict" | "queue_full"
      | "queue_conflict" | "not_found" | "run_mismatch" | "not_active";
    message: string;
  };

export class ConversationRunRegistry {
  private readonly handles = new Map<string, Map<string, ConversationRunHandle>>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly recoveryStore?: ConversationRunRecoveryStore;
  private readonly followUpQueue: ConversationFollowUpQueue;
  private readonly steeringMailboxes = new Map<string, ConversationSteerMailbox>();
  private accepting = true;

  constructor(options: {
    recoveryStore?: ConversationRunRecoveryStore;
    followUpQueue?: ConversationFollowUpQueue;
  } = {}) {
    this.recoveryStore = options.recoveryStore;
    this.followUpQueue = options.followUpQueue ?? new ConversationFollowUpQueue();
  }

  /** Marker 写入成功后才公开 handle，确保已启动的 run 具备 crash 识别证据。 */
  async registerDurable(
    handle: ConversationRunHandle,
    options: ConversationRunRegistrationOptions = {},
  ): Promise<void> {
    this.assertRegistrationAllowed(handle, options.followUp?.commandId, options.steering);
    await this.recoveryStore?.markActive({
      source: "conversation",
      binding: { conversationId: handle.conversationId, agentRunId: handle.runId },
      startedAtMs: handle.startedAt,
    });
    if (options.followUp && !this.followUpQueue.markDelivered({
      queueBinding: options.followUp.queueBinding,
      commandId: options.followUp.commandId,
      nextBinding: { conversationId: handle.conversationId, agentRunId: handle.runId },
    })) {
      await this.recoveryStore?.markSettled({
        source: "conversation",
        binding: { conversationId: handle.conversationId, agentRunId: handle.runId },
      }).catch(() => undefined);
      throw new Error("Conversation follow-up reservation no longer matches the claimed command.");
    }
    this.registerHandle(handle, options.steering);
  }

  async settleRecoveryMarker(conversationId: string, runId: string): Promise<boolean> {
    if (!this.recoveryStore) return false;
    return this.recoveryStore.markSettled({
      source: "conversation",
      binding: { conversationId, agentRunId: runId },
    });
  }

  async getRecoveryStatus(conversationId: string, runId: string): Promise<CodingRunRecoveryLookup> {
    if (!this.recoveryStore) return { state: "not_found" };
    return this.recoveryStore.lookup({
      source: "conversation",
      binding: { conversationId, agentRunId: runId },
    });
  }

  enqueueFollowUp(input: {
    binding: ConversationRunBinding;
    prompt: string;
    idempotencyKey: string;
  }): ConversationFollowUpRegistryResult {
    const scoped = this.handles.get(input.binding.conversationId);
    const exact = scoped?.get(input.binding.agentRunId);
    const latest = this.selectLatestHandle(scoped);
    if (!exact) {
      return latest
        ? { ok: false, code: "run_mismatch", message: "Conversation binding no longer matches the active run." }
        : { ok: false, code: "not_found", message: "Conversation run was not found." };
    }
    if (latest?.runId !== exact.runId) {
      return { ok: false, code: "run_mismatch", message: "Conversation binding no longer matches the latest run." };
    }
    const active = [...(scoped?.values() ?? [])].filter((handle) =>
      handle.state === "running" || handle.state === "stop_requested"
    );
    if (exact.state !== "running" || active.length !== 1) {
      return { ok: false, code: "not_active", message: "Conversation run is not the sole active owner." };
    }
    return this.followUpQueue.enqueue(input);
  }

  enqueueSteer(input: {
    binding: ConversationRunBinding;
    prompt: string;
    idempotencyKey: string;
  }): ConversationSteerRegistryResult {
    if (!this.accepting) {
      return { ok: false, code: "not_active", message: "Conversation run registry is stopping." };
    }
    const scoped = this.handles.get(input.binding.conversationId);
    const exact = scoped?.get(input.binding.agentRunId);
    const latest = this.selectLatestHandle(scoped);
    if (!exact) {
      return latest
        ? { ok: false, code: "run_mismatch", message: "Conversation binding no longer matches the active run." }
        : { ok: false, code: "not_found", message: "Conversation run was not found." };
    }
    if (latest?.runId !== exact.runId) {
      return { ok: false, code: "run_mismatch", message: "Conversation binding no longer matches the latest run." };
    }
    const active = [...(scoped?.values() ?? [])].filter((handle) =>
      handle.state === "running" || handle.state === "stop_requested"
    );
    if (exact.state !== "running" || active.length !== 1) {
      return { ok: false, code: "not_active", message: "Conversation run is not the sole active owner." };
    }
    const mailbox = this.steeringMailboxes.get(input.binding.agentRunId);
    if (!mailbox || !matchesSteeringBinding(mailbox, input.binding)) {
      return {
        ok: false,
        code: "not_available",
        message: "Active Agent does not support steer input at a safe model boundary.",
      };
    }
    return mailbox.enqueue({ prompt: input.prompt, idempotencyKey: input.idempotencyKey });
  }

  getSteerStatus(
    binding: ConversationRunBinding,
    commandId: string,
  ): ConversationSteerView | undefined {
    const mailbox = this.steeringMailboxes.get(binding.agentRunId);
    if (!mailbox || !matchesSteeringBinding(mailbox, binding)) return undefined;
    return mailbox.getStatus(commandId);
  }

  async replaceActiveRun(input: {
    binding: ConversationRunBinding;
    prompt: string;
    idempotencyKey: string;
  }): Promise<ConversationReplacementResult> {
    const scoped = this.handles.get(input.binding.conversationId);
    const exact = scoped?.get(input.binding.agentRunId);
    const latest = this.selectLatestHandle(scoped);
    if (!exact) {
      return latest
        ? { ok: false, code: "run_mismatch", message: "Conversation binding no longer matches the active run." }
        : { ok: false, code: "not_found", message: "Conversation run was not found." };
    }
    if (latest?.runId !== exact.runId) {
      return { ok: false, code: "run_mismatch", message: "Conversation binding no longer matches the latest run." };
    }
    const active = [...(scoped?.values() ?? [])].filter((handle) =>
      handle.state === "running" || handle.state === "stop_requested"
    );
    if (active.length !== 1) {
      return { ok: false, code: "not_active", message: "Conversation run is not the sole active owner." };
    }

    const commandInput = { ...input, intent: "replace" as const };
    if (exact.state === "stop_requested") {
      const replay = this.followUpQueue.replay(commandInput);
      if (!replay) {
        return { ok: false, code: "not_active", message: "Conversation run is already stopping." };
      }
      if (!replay.ok) return replay;
      return {
        ...replay,
        stopRequested: replay.item.status !== "failed",
      };
    }
    if (exact.state !== "running") {
      return { ok: false, code: "not_active", message: "Conversation run is not active." };
    }
    const steeringMailbox = this.steeringMailboxes.get(input.binding.agentRunId);
    if (this.followUpQueue.hasPending(input.binding)
      || (steeringMailbox && matchesSteeringBinding(steeringMailbox, input.binding) && steeringMailbox.hasPending())) {
      return {
        ok: false,
        code: "queue_conflict",
        message: "Conversation already has a pending input command.",
      };
    }

    const queued = this.followUpQueue.enqueue(commandInput);
    if (!queued.ok) return queued;
    let stopRequested = false;
    try {
      const stopped = await this.requestStop({
        conversationId: input.binding.conversationId,
        runId: input.binding.agentRunId,
        reason: "Replaced by queued Conversation input.",
      });
      stopRequested = stopped.accepted && stopped.runId === input.binding.agentRunId;
    } catch {
      stopRequested = false;
    }
    if (!stopRequested) {
      this.followUpQueue.markFailed({
        queueBinding: input.binding,
        commandId: queued.item.commandId,
        error: "Conversation run could not accept the replacement stop request.",
      });
    }
    return {
      ok: true,
      replayed: queued.replayed,
      stopRequested,
      item: this.followUpQueue.getStatus(input.binding, queued.item.commandId) ?? queued.item,
    };
  }

  getFollowUpStatus(
    binding: ConversationRunBinding,
    commandId: string,
  ): ConversationFollowUpView | undefined {
    return this.followUpQueue.getStatus(binding, commandId);
  }

  claimNextFollowUp(binding: ConversationRunBinding): ConversationFollowUpClaim | undefined {
    const scoped = this.handles.get(binding.conversationId);
    const active = [...(scoped?.values() ?? [])].filter((handle) =>
      handle.state === "running" || handle.state === "stop_requested"
    );
    return this.followUpQueue.claimNext({ binding, conversationAvailable: active.length === 0 });
  }

  markFollowUpFailed(claim: ConversationFollowUpClaim, error: string): boolean {
    return this.followUpQueue.markFailed({
      queueBinding: claim.queueBinding,
      commandId: claim.commandId,
      error,
    });
  }

  failRemainingFollowUps(binding: ConversationRunBinding, error: string): number {
    return this.followUpQueue.failRemaining(binding, error);
  }

  isConversationStartAllowed(conversationId: string, followUpCommandId?: string): boolean {
    return this.accepting
      && this.followUpQueue.isRegistrationAllowed(conversationId, followUpCommandId);
  }

  register(handle: ConversationRunHandle, options: ConversationRunRegistrationOptions = {}): void {
    this.assertRegistrationAllowed(handle, undefined, options.steering);
    this.registerHandle(handle, options.steering);
  }

  private registerHandle(handle: ConversationRunHandle, steering?: ConversationSteerMailbox): void {
    const scoped = this.handles.get(handle.conversationId) ?? new Map<string, ConversationRunHandle>();
    scoped.set(handle.runId, { ...handle });
    this.handles.set(handle.conversationId, scoped);
    if (steering) this.steeringMailboxes.set(handle.runId, steering);
  }

  private assertRegistrationAllowed(
    handle: ConversationRunHandle,
    followUpCommandId?: string,
    steering?: ConversationSteerMailbox,
  ): void {
    if (!this.accepting) {
      throw new Error("Conversation run registry is not accepting new runs.");
    }
    if (!this.followUpQueue.isRegistrationAllowed(handle.conversationId, followUpCommandId)) {
      throw new Error("Conversation is reserved for a claimed follow-up command.");
    }
    if (steering && !matchesSteeringBinding(steering, {
      conversationId: handle.conversationId,
      agentRunId: handle.runId,
    })) {
      throw new Error("Conversation steer mailbox does not match the registered run.");
    }
  }

  get(conversationId: string): ConversationRunHandle | undefined {
    const scoped = this.handles.get(conversationId);
    const handle = this.selectLatestHandle(scoped);
    return handle ? { ...handle } : undefined;
  }

  getRun(conversationId: string, runId: string): ConversationRunHandle | undefined {
    const handle = this.handles.get(conversationId)?.get(runId);
    return handle ? { ...handle } : undefined;
  }

  async requestStop(input: ConversationRunStopRequest): Promise<ConversationRunStopResult> {
    const scoped = this.handles.get(input.conversationId);
    const latest = this.selectLatestHandle(scoped);
    if (!scoped || !latest) {
      return { accepted: false, state: "not_found" };
    }

    const current = input.runId
      ? scoped.get(input.runId)
      : this.selectLatestStoppableHandle(scoped);
    if (!current) {
      return {
        accepted: false,
        state: input.runId ? "run_mismatch" : "not_found",
        runId: latest.runId,
      };
    }

    if (current.state === "running") {
      const next: ConversationRunHandle = {
        ...current,
        state: "stop_requested",
        stopRequestedAt: Date.now(),
      };
      if (typeof input.reason === "string" && input.reason.trim()) {
        next.stopReason = input.reason.trim();
      }
      scoped.set(current.runId, next);
      this.handles.set(input.conversationId, scoped);
    }

    await Promise.resolve(current.stop(input.reason));
    return {
      accepted: true,
      runId: current.runId,
      state: "stop_requested",
    };
  }

  markStopped(conversationId: string, runId: string, reason?: string): void {
    const scoped = this.handles.get(conversationId);
    const current = scoped?.get(runId);
    if (!scoped || !current) {
      return;
    }
    const next: ConversationRunHandle = {
      ...current,
      state: "stopped",
      stoppedAt: Date.now(),
    };
    if (typeof reason === "string" && reason.trim()) {
      next.stopReason = reason.trim();
    }
    scoped.set(runId, next);
    this.handles.set(conversationId, scoped);
    this.resolveIdleWaiters();
  }

  clear(conversationId: string, runId?: string): void {
    const scoped = this.handles.get(conversationId);
    if (!scoped) {
      return;
    }
    if (!runId) {
      for (const handle of scoped.values()) this.closeSteeringMailbox(handle.runId);
      this.handles.delete(conversationId);
      this.resolveIdleWaiters();
      return;
    }
    this.closeSteeringMailbox(runId);
    scoped.delete(runId);
    if (scoped.size <= 0) {
      this.handles.delete(conversationId);
      this.resolveIdleWaiters();
      return;
    }
    this.handles.set(conversationId, scoped);
    this.resolveIdleWaiters();
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  /** 先冻结全部活跃 handle 的状态，再并发发送 stop，避免单个失败阻断其他 run。 */
  async requestStopAll(reason?: string): Promise<void> {
    const activeHandles: ConversationRunHandle[] = [];
    for (const scoped of this.handles.values()) {
      for (const handle of scoped.values()) {
        if (handle.state === "running" || handle.state === "stop_requested") {
          activeHandles.push(handle);
        }
      }
    }

    for (const handle of activeHandles) {
      const scoped = this.handles.get(handle.conversationId);
      const current = scoped?.get(handle.runId);
      if (!scoped || !current) continue;
      scoped.set(handle.runId, {
        ...current,
        state: "stop_requested",
        stopRequestedAt: current.stopRequestedAt ?? Date.now(),
        ...(typeof reason === "string" && reason.trim() ? { stopReason: reason.trim() } : {}),
      });
    }

    const results = await Promise.allSettled(activeHandles.map((handle) => Promise.resolve().then(() => handle.stop(reason))));
    const failureCount = results.filter((result) => result.status === "rejected").length;
    if (failureCount > 0) {
      throw new Error(`Failed to stop ${failureCount} of ${activeHandles.length} active conversation runs.`);
    }
  }

  /** drain 只等待 registry 可观察的活跃 run；阶段 deadline 通过 AbortSignal 终止等待。 */
  waitForIdle(signal?: AbortSignal): Promise<void> {
    if (this.getRuntimeSnapshot().activeCount === 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(toAbortError(signal.reason));

    return new Promise<void>((resolve, reject) => {
      const complete = (): void => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = (): void => {
        this.idleWaiters.delete(complete);
        reject(toAbortError(signal?.reason));
      };
      this.idleWaiters.add(complete);
      signal?.addEventListener("abort", abort, { once: true });
      this.resolveIdleWaiters();
    });
  }

  /** 仅返回运行态总数，供后台调度避让前台 Agent 工作。 */
  getRuntimeSnapshot(): ConversationRunRuntimeSnapshot {
    let activeCount = 0;
    let stopRequestedCount = 0;
    for (const scoped of this.handles.values()) {
      for (const handle of scoped.values()) {
        if (handle.state !== "running" && handle.state !== "stop_requested") {
          continue;
        }
        activeCount++;
        if (handle.state === "stop_requested") {
          stopRequestedCount++;
        }
      }
    }
    return { activeCount, stopRequestedCount };
  }

  /** 仅返回活跃 run 的无回调安全视图，供只读跨 owner 投影使用。 */
  listActiveRuns(): ConversationRunListItem[] {
    const items: ConversationRunListItem[] = [];
    for (const scoped of this.handles.values()) {
      for (const handle of scoped.values()) {
        if (handle.state !== "running" && handle.state !== "stop_requested") continue;
        items.push({
          conversationId: handle.conversationId,
          runId: handle.runId,
          ...(handle.agentId ? { agentId: handle.agentId } : {}),
          startedAt: handle.startedAt,
          state: handle.state,
          ...(handle.stopRequestedAt !== undefined ? { stopRequestedAt: handle.stopRequestedAt } : {}),
        });
      }
    }
    return items.sort((left, right) =>
      left.startedAt - right.startedAt
      || left.conversationId.localeCompare(right.conversationId)
      || left.runId.localeCompare(right.runId),
    );
  }

  private selectLatestHandle(
    scoped?: Map<string, ConversationRunHandle>,
  ): ConversationRunHandle | undefined {
    if (!scoped || scoped.size <= 0) {
      return undefined;
    }
    return [...scoped.values()].sort((left, right) => right.startedAt - left.startedAt)[0];
  }

  private selectLatestStoppableHandle(
    scoped?: Map<string, ConversationRunHandle>,
  ): ConversationRunHandle | undefined {
    if (!scoped || scoped.size <= 0) {
      return undefined;
    }
    return [...scoped.values()]
      .filter((handle) => handle.state === "running" || handle.state === "stop_requested")
      .sort((left, right) => right.startedAt - left.startedAt)[0];
  }

  private resolveIdleWaiters(): void {
    if (this.getRuntimeSnapshot().activeCount > 0) return;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  private closeSteeringMailbox(runId: string): void {
    const mailbox = this.steeringMailboxes.get(runId);
    if (!mailbox) return;
    mailbox.close("Conversation run ended before queued steer input reached a model boundary.");
    const terminal = [...this.steeringMailboxes.entries()]
      .filter(([, item]) => item.isClosed())
      .sort((left, right) => (left[1].getClosedAtMs() ?? 0) - (right[1].getClosedAtMs() ?? 0));
    while (terminal.length > 64) {
      const expired = terminal.shift();
      if (expired) this.steeringMailboxes.delete(expired[0]);
    }
  }
}

function matchesSteeringBinding(
  mailbox: ConversationSteerMailbox,
  binding: ConversationRunBinding,
): boolean {
  return mailbox.binding.conversationId === binding.conversationId
    && mailbox.binding.agentRunId === binding.agentRunId;
}

function toAbortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Conversation run drain aborted.");
}
