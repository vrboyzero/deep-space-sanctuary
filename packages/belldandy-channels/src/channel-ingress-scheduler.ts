const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_CONCURRENT_PER_CHANNEL = 2;
const DEFAULT_MAX_PENDING_PER_SESSION = 16;
const DEFAULT_MAX_QUEUED = 128;
const DEFAULT_MAX_WAIT_MS = 120_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 128 * 1024;
const DEFAULT_MAX_QUEUED_PAYLOAD_BYTES = 2 * 1024 * 1024;

export type ChannelIngressRejectionReason =
  | "invalid_task"
  | "scheduler_closed"
  | "payload_too_large"
  | "queued_payload_limit"
  | "queue_full"
  | "session_queue_full";

export type ChannelIngressCompletion =
  | { status: "completed" }
  | { status: "cancelled"; reason: "channel_stopped" | "scheduler_closed" }
  | { status: "expired"; waitedMs: number };

export type ChannelIngressTaskContext = {
  /** 为未来支持可取消 Adapter 预留；当前 stop 只清理尚未开始的任务。 */
  signal: AbortSignal;
};

export type ChannelIngressTask = {
  channel: string;
  sessionKey: string;
  /** 同一渠道内的事件去重键；仅在任务 active/pending 期间保留。 */
  dedupeKey?: string;
  /** 调度容量使用的输入大小估算，不进入诊断输出。 */
  payloadBytes?: number;
  run: (context: ChannelIngressTaskContext) => void | Promise<void>;
};

export type ChannelIngressEnqueueResult =
  | {
    accepted: true;
    coalesced: boolean;
    completion: Promise<ChannelIngressCompletion>;
  }
  | {
    accepted: false;
    reason: ChannelIngressRejectionReason;
  };

export type ChannelIngressRuntimeSnapshot = {
  id: string;
  activeCount: number;
  queuedCount: number;
  capacity: number;
  oldestWaitMs: number;
  rejectedCount: number;
  /** 总览快照只供展示；Core 汇总时使用其分渠道明细避免重复计数。 */
  aggregate?: boolean;
};

export type ChannelIngressSchedulerOptions = {
  maxConcurrent?: number;
  maxConcurrentPerChannel?: number;
  maxPendingPerSession?: number;
  maxQueued?: number;
  maxWaitMs?: number;
  maxPayloadBytes?: number;
  maxQueuedPayloadBytes?: number;
  now?: () => number;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type QueuedTask = {
  channel: string;
  sessionMapKey: string;
  dedupeMapKey?: string;
  enqueuedAt: number;
  payloadBytes: number;
  run: ChannelIngressTask["run"];
  controller: AbortController;
  completion: Deferred<ChannelIngressCompletion>;
  settled: boolean;
};

type SessionQueue = {
  channel: string;
  pending: QueuedTask[];
  active: boolean;
  ready: boolean;
};

/**
 * 渠道入站消息的公平、有界调度器。
 *
 * 诊断只公开受控的 channel 标签和数值；session key、去重键及任务输入只在任务存活期间保留。
 */
export class ChannelIngressScheduler {
  private readonly maxConcurrent: number;
  private readonly maxConcurrentPerChannel: number;
  private readonly maxPendingPerSession: number;
  private readonly maxQueued: number;
  private readonly maxWaitMs: number;
  private readonly maxPayloadBytes: number;
  private readonly maxQueuedPayloadBytes: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, SessionQueue>();
  private readonly dedupeTasks = new Map<string, QueuedTask>();
  private readonly activeByChannel = new Map<string, number>();
  private readonly rejectedByChannel = new Map<string, number>();
  private readySessionKeys: string[] = [];
  private activeCount = 0;
  private queuedCount = 0;
  private queuedPayloadBytes = 0;
  private rejectedCount = 0;
  private draining = false;
  private closed = false;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor(options: ChannelIngressSchedulerOptions = {}) {
    this.maxConcurrent = normalizePositiveInt(options.maxConcurrent, DEFAULT_MAX_CONCURRENT);
    this.maxConcurrentPerChannel = normalizePositiveInt(
      options.maxConcurrentPerChannel,
      Math.min(DEFAULT_MAX_CONCURRENT_PER_CHANNEL, this.maxConcurrent),
    );
    this.maxPendingPerSession = normalizePositiveInt(options.maxPendingPerSession, DEFAULT_MAX_PENDING_PER_SESSION);
    this.maxQueued = normalizePositiveInt(options.maxQueued, DEFAULT_MAX_QUEUED);
    this.maxWaitMs = normalizePositiveInt(options.maxWaitMs, DEFAULT_MAX_WAIT_MS);
    this.maxPayloadBytes = normalizePositiveInt(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES);
    this.maxQueuedPayloadBytes = normalizePositiveInt(
      options.maxQueuedPayloadBytes,
      DEFAULT_MAX_QUEUED_PAYLOAD_BYTES,
    );
    this.now = options.now ?? Date.now;
  }

  enqueue(input: ChannelIngressTask): ChannelIngressEnqueueResult {
    const channel = normalizeIdentifier(input.channel);
    const sessionKey = normalizeIdentifier(input.sessionKey);
    if (!channel || !sessionKey || typeof input.run !== "function") {
      return this.reject(channel || "unknown", "invalid_task");
    }

    const dedupeKey = normalizeIdentifier(input.dedupeKey);
    const dedupeMapKey = dedupeKey ? `${channel}\u0000${dedupeKey}` : undefined;
    const duplicate = dedupeMapKey ? this.dedupeTasks.get(dedupeMapKey) : undefined;
    if (duplicate) {
      return {
        accepted: true,
        coalesced: true,
        completion: duplicate.completion.promise,
      };
    }

    if (this.closed) {
      return this.reject(channel, "scheduler_closed");
    }

    const payloadBytes = normalizePayloadBytes(input.payloadBytes);
    if (payloadBytes > this.maxPayloadBytes) {
      return this.reject(channel, "payload_too_large");
    }
    if (this.queuedCount >= this.maxQueued) {
      return this.reject(channel, "queue_full");
    }
    if (this.queuedPayloadBytes + payloadBytes > this.maxQueuedPayloadBytes) {
      return this.reject(channel, "queued_payload_limit");
    }

    const sessionMapKey = `${channel}\u0000${sessionKey}`;
    const session = this.sessions.get(sessionMapKey) ?? {
      channel,
      pending: [],
      active: false,
      ready: false,
    };
    if (session.pending.length >= this.maxPendingPerSession) {
      return this.reject(channel, "session_queue_full");
    }

    const task: QueuedTask = {
      channel,
      sessionMapKey,
      ...(dedupeMapKey ? { dedupeMapKey } : {}),
      enqueuedAt: this.now(),
      payloadBytes,
      run: input.run,
      controller: new AbortController(),
      completion: createDeferred<ChannelIngressCompletion>(),
      settled: false,
    };
    // Channel adapters may intentionally observe a rejected completion later; this prevents an early throw
    // from becoming an unhandled-rejection process failure before that observer attaches.
    void task.completion.promise.catch(() => undefined);

    session.pending.push(task);
    this.sessions.set(sessionMapKey, session);
    this.queuedCount += 1;
    this.queuedPayloadBytes += payloadBytes;
    if (dedupeMapKey) {
      this.dedupeTasks.set(dedupeMapKey, task);
    }
    this.markSessionReady(sessionMapKey, session);
    this.drain();

    return {
      accepted: true,
      coalesced: false,
      completion: task.completion.promise,
    };
  }

  /** 清除尚未启动的某渠道任务；已启动任务维持现有行为，真正 abort 属于后续 Agent 合约。 */
  cancelChannel(channelInput: string): number {
    const channel = normalizeIdentifier(channelInput);
    if (!channel) return 0;
    return this.cancelQueuedTasks((task) => task.channel === channel, "channel_stopped");
  }

  /** Gateway 关闭时拒绝新任务并清空所有尚未启动的任务。 */
  close(): number {
    if (this.closed) return 0;
    this.closed = true;
    this.clearExpiryTimer();
    return this.cancelQueuedTasks(() => true, "scheduler_closed");
  }

  /** 可直接交给 Core RuntimeResourceObservability 的不含会话身份快照。 */
  getRuntimeSnapshots(): ChannelIngressRuntimeSnapshot[] {
    const channels = new Set<string>([
      ...this.activeByChannel.keys(),
      ...this.rejectedByChannel.keys(),
      ...[...this.sessions.values()].map((session) => session.channel),
    ]);
    const globalSnapshot: ChannelIngressRuntimeSnapshot = {
      id: "channel_ingress",
      activeCount: this.activeCount,
      queuedCount: this.queuedCount,
      capacity: this.maxConcurrent,
      oldestWaitMs: this.getOldestWaitMs(),
      rejectedCount: this.rejectedCount,
      aggregate: true,
    };
    const perChannel = [...channels]
      .sort((left, right) => left.localeCompare(right))
      .map((channel) => ({
        id: `channel_ingress:${channel}`,
        activeCount: this.activeByChannel.get(channel) ?? 0,
        queuedCount: this.getQueuedCount(channel),
        capacity: this.maxConcurrentPerChannel,
        oldestWaitMs: this.getOldestWaitMs(channel),
        rejectedCount: this.rejectedByChannel.get(channel) ?? 0,
      }));
    return [globalSnapshot, ...perChannel];
  }

  private reject(channel: string, reason: ChannelIngressRejectionReason): ChannelIngressEnqueueResult {
    this.rejectedCount += 1;
    this.rejectedByChannel.set(channel, (this.rejectedByChannel.get(channel) ?? 0) + 1);
    return { accepted: false, reason };
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      // Expiry is independent of available execution slots: a hung active task must not retain pending closures.
      this.expireWaitingTasks();
      while (this.activeCount < this.maxConcurrent) {
        const task = this.takeNextRunnableTask();
        if (!task) break;
        this.startTask(task);
      }
    } finally {
      this.draining = false;
      this.scheduleExpiryWakeup();
    }
  }

  private expireWaitingTasks(): void {
    const now = this.now();
    for (const [sessionMapKey, session] of this.sessions) {
      for (const task of [...session.pending]) {
        const waitedMs = Math.max(0, now - task.enqueuedAt);
        if (waitedMs <= this.maxWaitMs) continue;
        this.removePendingTask(sessionMapKey, session, task);
        this.rejectedCount += 1;
        this.rejectedByChannel.set(task.channel, (this.rejectedByChannel.get(task.channel) ?? 0) + 1);
        this.resolveTask(task, { status: "expired", waitedMs });
      }
      this.markSessionReady(sessionMapKey, session);
      this.cleanupIdleSession(sessionMapKey, session);
    }
  }

  private takeNextRunnableTask(): QueuedTask | undefined {
    let remainingSessions = this.readySessionKeys.length;
    while (remainingSessions > 0) {
      remainingSessions -= 1;
      const sessionMapKey = this.readySessionKeys.shift();
      if (!sessionMapKey) break;
      const session = this.sessions.get(sessionMapKey);
      if (!session) continue;
      session.ready = false;
      if (session.active || session.pending.length === 0) {
        this.cleanupIdleSession(sessionMapKey, session);
        continue;
      }

      const task = session.pending[0];
      if (!task) {
        this.cleanupIdleSession(sessionMapKey, session);
        continue;
      }
      const waitedMs = Math.max(0, this.now() - task.enqueuedAt);
      if (waitedMs > this.maxWaitMs) {
        this.removePendingTask(sessionMapKey, session, task);
        this.rejectedCount += 1;
        this.rejectedByChannel.set(task.channel, (this.rejectedByChannel.get(task.channel) ?? 0) + 1);
        this.resolveTask(task, { status: "expired", waitedMs });
        this.markSessionReady(sessionMapKey, session);
        this.cleanupIdleSession(sessionMapKey, session);
        continue;
      }
      if ((this.activeByChannel.get(task.channel) ?? 0) >= this.maxConcurrentPerChannel) {
        this.markSessionReady(sessionMapKey, session);
        continue;
      }

      session.pending.shift();
      this.queuedCount -= 1;
      this.queuedPayloadBytes -= task.payloadBytes;
      session.active = true;
      return task;
    }
    return undefined;
  }

  private startTask(task: QueuedTask): void {
    this.activeCount += 1;
    this.activeByChannel.set(task.channel, (this.activeByChannel.get(task.channel) ?? 0) + 1);
    void this.executeTask(task);
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    try {
      await task.run({ signal: task.controller.signal });
      this.resolveTask(task, { status: "completed" });
    } catch (error) {
      this.rejectTask(task, error);
    } finally {
      this.activeCount -= 1;
      const nextActiveCount = (this.activeByChannel.get(task.channel) ?? 1) - 1;
      if (nextActiveCount > 0) {
        this.activeByChannel.set(task.channel, nextActiveCount);
      } else {
        this.activeByChannel.delete(task.channel);
      }
      const session = this.sessions.get(task.sessionMapKey);
      if (session) {
        session.active = false;
        this.markSessionReady(task.sessionMapKey, session);
        this.cleanupIdleSession(task.sessionMapKey, session);
      }
      this.drain();
    }
  }

  private cancelQueuedTasks(
    shouldCancel: (task: QueuedTask) => boolean,
    reason: "channel_stopped" | "scheduler_closed",
  ): number {
    let cancelledCount = 0;
    for (const [sessionMapKey, session] of this.sessions) {
      for (const task of [...session.pending]) {
        if (!shouldCancel(task)) continue;
        this.removePendingTask(sessionMapKey, session, task);
        this.resolveTask(task, { status: "cancelled", reason });
        cancelledCount += 1;
      }
      this.markSessionReady(sessionMapKey, session);
      this.cleanupIdleSession(sessionMapKey, session);
    }
    this.drain();
    return cancelledCount;
  }

  private removePendingTask(sessionMapKey: string, session: SessionQueue, task: QueuedTask): void {
    const index = session.pending.indexOf(task);
    if (index < 0) return;
    session.pending.splice(index, 1);
    this.queuedCount -= 1;
    this.queuedPayloadBytes -= task.payloadBytes;
    if (this.queuedCount < 0) this.queuedCount = 0;
    if (this.queuedPayloadBytes < 0) this.queuedPayloadBytes = 0;
    this.removeDedupeTask(task);
    if (session.pending.length === 0 && !session.active) {
      this.removeReadySession(sessionMapKey, session);
    }
  }

  private markSessionReady(sessionMapKey: string, session: SessionQueue): void {
    if (session.active || session.pending.length === 0 || session.ready) return;
    session.ready = true;
    this.readySessionKeys.push(sessionMapKey);
  }

  private removeReadySession(sessionMapKey: string, session: SessionQueue): void {
    if (!session.ready) return;
    session.ready = false;
    this.readySessionKeys = this.readySessionKeys.filter((key) => key !== sessionMapKey);
  }

  private cleanupIdleSession(sessionMapKey: string, session: SessionQueue): void {
    if (session.active || session.pending.length > 0) return;
    this.removeReadySession(sessionMapKey, session);
    this.sessions.delete(sessionMapKey);
  }

  private resolveTask(task: QueuedTask, value: ChannelIngressCompletion): void {
    if (task.settled) return;
    task.settled = true;
    this.removeDedupeTask(task);
    task.completion.resolve(value);
  }

  private rejectTask(task: QueuedTask, error: unknown): void {
    if (task.settled) return;
    task.settled = true;
    this.removeDedupeTask(task);
    task.completion.reject(error);
  }

  private removeDedupeTask(task: QueuedTask): void {
    if (task.dedupeMapKey && this.dedupeTasks.get(task.dedupeMapKey) === task) {
      this.dedupeTasks.delete(task.dedupeMapKey);
    }
  }

  private getQueuedCount(channel: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.channel === channel) {
        count += session.pending.length;
      }
    }
    return count;
  }

  private getOldestWaitMs(channel?: string): number {
    const now = this.now();
    let oldestWaitMs = 0;
    for (const session of this.sessions.values()) {
      if (channel && session.channel !== channel) continue;
      for (const task of session.pending) {
        oldestWaitMs = Math.max(oldestWaitMs, Math.max(0, now - task.enqueuedAt));
      }
    }
    return oldestWaitMs;
  }

  private scheduleExpiryWakeup(): void {
    this.clearExpiryTimer();
    if (this.closed || this.queuedCount === 0) return;

    let earliestDeadline: number | undefined;
    for (const session of this.sessions.values()) {
      for (const task of session.pending) {
        const deadline = task.enqueuedAt + this.maxWaitMs;
        earliestDeadline = earliestDeadline === undefined ? deadline : Math.min(earliestDeadline, deadline);
      }
    }
    if (earliestDeadline === undefined) return;
    const delayMs = Math.max(1, earliestDeadline - this.now() + 1);
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined;
      this.drain();
    }, delayMs);
    this.expiryTimer.unref?.();
  }

  private clearExpiryTimer(): void {
    if (!this.expiryTimer) return;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function normalizeIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePayloadBytes(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(Number(value))) : 0;
}
