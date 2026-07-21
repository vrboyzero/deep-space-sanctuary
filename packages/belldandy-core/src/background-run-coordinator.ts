export type BackgroundRunKind = "cron" | "heartbeat" | "memory" | "dream";
export type BackgroundRunPriority = "high" | "normal" | "low";

export type BackgroundRunClaimInput = {
  kind: BackgroundRunKind;
  key: string;
  singleflightKey?: string;
  priority?: BackgroundRunPriority;
  signal?: AbortSignal;
};

export type BackgroundRunClaim = {
  generation: number;
  signal: AbortSignal;
  complete: <T>(commit: () => T | Promise<T>) => Promise<
    | { applied: true; value: T }
    | { applied: false }
  >;
  release: () => void;
};

export type BackgroundRunClaimResult = BackgroundRunClaim | {
  reason: string;
};

export type BackgroundRunClaimCoordinator = {
  tryClaim(input: BackgroundRunClaimInput): BackgroundRunClaimResult;
  acquire?: (input: BackgroundRunClaimInput) => Promise<BackgroundRunClaimResult>;
};

export type BackgroundRunRuntimeSnapshot = {
  activeCount: number;
  queuedCount: number;
  capacity: number;
  queueCapacity: number;
  availableSlots: number;
  oldestWaitMs: number;
  rejectedCount: number;
  foregroundActiveCount: number;
  activeByKind: Record<BackgroundRunKind, number>;
  queuedByKind: Record<BackgroundRunKind, number>;
};

export type BackgroundRunCoordinatorOptions = {
  maxConcurrentRuns?: number;
  maxConcurrentByKind?: Partial<Record<BackgroundRunKind, number>>;
  maxQueuedRuns?: number;
  getForegroundActiveCount?: () => number;
  now?: () => number;
};

const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_MAX_QUEUED_RUNS = 100;
const PRIORITY_BYPASS: Record<BackgroundRunPriority, number> = {
  high: 2,
  normal: 1,
  low: 0,
};
const DEFAULT_MAX_CONCURRENT_BY_KIND: Record<BackgroundRunKind, number> = {
  cron: 3,
  heartbeat: 1,
  memory: 1,
  dream: 1,
};
const MAX_CLAIM_KEY_LENGTH = 160;

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 0
    ? Math.floor(Number(value))
    : fallback;
}

function normalizeClaimKey(value: string): string | undefined {
  const key = String(value ?? "").trim();
  return key && key.length <= MAX_CLAIM_KEY_LENGTH ? key : undefined;
}

function resolveClaimIdentity(kind: BackgroundRunKind, key: string, singleflightKey?: string): string {
  const sharedKey = singleflightKey ? normalizeClaimKey(singleflightKey) : undefined;
  return sharedKey ? `shared:${sharedKey}` : `${kind}:${key}`;
}

function normalizePriority(value: unknown): BackgroundRunPriority {
  return value === "high" || value === "low" ? value : "normal";
}

/**
 * 单进程后台运行预算 owner。仅维护受控的 kind/count，不保留 job、prompt 或会话内容。
 */
export class BackgroundRunCoordinator implements BackgroundRunClaimCoordinator {
  private readonly maxConcurrentRuns: number;
  private readonly maxConcurrentByKind: Record<BackgroundRunKind, number>;
  private readonly maxQueuedRuns: number;
  private readonly getForegroundActiveCount: () => number;
  private readonly now: () => number;
  private readonly activeKeys = new Set<string>();
  private readonly activeByKind: Record<BackgroundRunKind, number> = {
    cron: 0,
    heartbeat: 0,
    memory: 0,
    dream: 0,
  };
  private readonly activeGenerations = new Map<string, number>();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly queuedKeys = new Set<string>();
  private readonly queue: Array<{
    input: BackgroundRunClaimInput;
    identity: string;
    enqueuedAt: number;
    sequence: number;
    admissionTicket: number;
    resolve: (result: BackgroundRunClaimResult) => void;
    abort?: () => void;
  }> = [];
  private readonly idleWaiters = new Set<() => void>();
  private nextGeneration = 0;
  private nextQueueSequence = 0;
  private rejectedCount = 0;
  private accepting = true;
  private drainPromise: Promise<void> | undefined;

  constructor(options: BackgroundRunCoordinatorOptions = {}) {
    this.maxConcurrentRuns = normalizePositiveInteger(
      options.maxConcurrentRuns,
      DEFAULT_MAX_CONCURRENT_RUNS,
    );
    this.maxConcurrentByKind = {
      cron: normalizePositiveInteger(options.maxConcurrentByKind?.cron, DEFAULT_MAX_CONCURRENT_BY_KIND.cron),
      heartbeat: normalizePositiveInteger(options.maxConcurrentByKind?.heartbeat, DEFAULT_MAX_CONCURRENT_BY_KIND.heartbeat),
      memory: normalizePositiveInteger(options.maxConcurrentByKind?.memory, DEFAULT_MAX_CONCURRENT_BY_KIND.memory),
      dream: normalizePositiveInteger(options.maxConcurrentByKind?.dream, DEFAULT_MAX_CONCURRENT_BY_KIND.dream),
    };
    this.maxQueuedRuns = normalizeNonNegativeInteger(options.maxQueuedRuns, DEFAULT_MAX_QUEUED_RUNS);
    this.getForegroundActiveCount = options.getForegroundActiveCount ?? (() => 0);
    this.now = options.now ?? Date.now;
  }

  tryClaim(input: BackgroundRunClaimInput): BackgroundRunClaimResult {
    if (!this.accepting) {
      return { reason: "Background run coordinator is stopped." };
    }
    if (input.signal?.aborted) {
      return { reason: "Background run request was aborted." };
    }
    const key = normalizeClaimKey(input.key);
    if (!key) {
      return { reason: "Background run key is required." };
    }
    const identity = resolveClaimIdentity(input.kind, key, input.singleflightKey);
    if (this.activeKeys.has(identity)) {
      return {
        reason: input.singleflightKey
          ? `Background ${input.kind} run ${key} is already running for its singleflight key.`
          : `Background ${input.kind} run ${key} is already running.`,
      };
    }
    if (this.activeByKind[input.kind] >= this.maxConcurrentByKind[input.kind]) {
      return { reason: `Background ${input.kind} run capacity has been reached.` };
    }
    if (this.getActiveCount() >= this.maxConcurrentRuns) {
      return { reason: "Background run coordinator has reached its concurrent run limit." };
    }

    this.nextGeneration++;
    const generation = this.nextGeneration;
    const controller = new AbortController();
    const abortFromParent = () => {
      if (!controller.signal.aborted) {
        controller.abort(input.signal?.reason);
      }
    };
    input.signal?.addEventListener("abort", abortFromParent, { once: true });
    this.activeKeys.add(identity);
    this.activeGenerations.set(identity, generation);
    this.activeControllers.set(identity, controller);
    this.activeByKind[input.kind]++;
    let released = false;
    let completing = false;
    const finalizeRelease = () => {
      if (released) return;
      released = true;
      if (this.activeGenerations.get(identity) !== generation) return;
      this.activeKeys.delete(identity);
      this.activeGenerations.delete(identity);
      this.activeControllers.delete(identity);
      input.signal?.removeEventListener("abort", abortFromParent);
      this.activeByKind[input.kind] = Math.max(0, this.activeByKind[input.kind] - 1);
      this.dispatchQueued();
      this.resolveIdleWaiters();
    };
    const release = () => {
      if (completing) return;
      finalizeRelease();
    };
    return {
      generation,
      signal: controller.signal,
      complete: async <T>(commit: () => T | Promise<T>) => {
        if (
          released
          || completing
          || this.activeGenerations.get(identity) !== generation
        ) {
          return { applied: false };
        }
        if (controller.signal.aborted) {
          finalizeRelease();
          return { applied: false };
        }
        completing = true;
        try {
          return {
            applied: true,
            value: await commit(),
          };
        } finally {
          finalizeRelease();
        }
      },
      release,
    };
  }

  acquire(input: BackgroundRunClaimInput): Promise<BackgroundRunClaimResult> {
    const immediate = this.tryClaim(input);
    if (!("reason" in immediate)) {
      return Promise.resolve(immediate);
    }
    if (!isCapacityReason(immediate.reason)) {
      return Promise.resolve(immediate);
    }
    const key = normalizeClaimKey(input.key);
    if (!key) {
      return Promise.resolve({ reason: "Background run key is required." });
    }
    const identity = resolveClaimIdentity(input.kind, key, input.singleflightKey);
    if (this.queuedKeys.has(identity)) {
      return Promise.resolve({ reason: `Background ${input.kind} run ${key} is already queued.` });
    }
    if (this.queue.length >= this.maxQueuedRuns) {
      this.rejectedCount++;
      return Promise.resolve({ reason: "Background run queue capacity has been reached." });
    }
    return new Promise<BackgroundRunClaimResult>((resolve) => {
      this.queuedKeys.add(identity);
      const priority = normalizePriority(input.priority);
      this.nextQueueSequence++;
      const sequence = this.nextQueueSequence;
      const queued = {
        input: {
          kind: input.kind,
          key,
          singleflightKey: input.singleflightKey,
          priority,
          signal: input.signal,
        },
        identity,
        enqueuedAt: this.now(),
        sequence,
        admissionTicket: sequence - PRIORITY_BYPASS[priority],
        resolve,
        abort: undefined as (() => void) | undefined,
      };
      if (input.signal) {
        queued.abort = () => {
          const index = this.queue.indexOf(queued);
          if (index < 0) return;
          this.queue.splice(index, 1);
          this.queuedKeys.delete(identity);
          input.signal?.removeEventListener("abort", queued.abort!);
          resolve({ reason: "Background run request was aborted." });
        };
        input.signal.addEventListener("abort", queued.abort, { once: true });
      }
      this.queue.push(queued);
    });
  }

  stopAndDrain(): Promise<void> {
    if (this.drainPromise) {
      return this.drainPromise;
    }
    this.accepting = false;
    for (const queued of this.queue.splice(0)) {
      this.queuedKeys.delete(queued.identity);
      queued.input.signal?.removeEventListener("abort", queued.abort!);
      queued.resolve({ reason: "Background run coordinator is stopped." });
    }
    const reason = new Error("Background run coordinator is stopping.");
    for (const controller of this.activeControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    }
    this.drainPromise = this.getActiveCount() === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        this.idleWaiters.add(resolve);
      });
    return this.drainPromise;
  }

  isForegroundBusy(): boolean {
    return this.readForegroundActiveCount() > 0;
  }

  getRuntimeSnapshot(): BackgroundRunRuntimeSnapshot {
    const activeCount = this.getActiveCount();
    const queuedByKind: Record<BackgroundRunKind, number> = {
      cron: 0,
      heartbeat: 0,
      memory: 0,
      dream: 0,
    };
    let oldestEnqueuedAt = Number.POSITIVE_INFINITY;
    for (const queued of this.queue) {
      queuedByKind[queued.input.kind]++;
      oldestEnqueuedAt = Math.min(oldestEnqueuedAt, queued.enqueuedAt);
    }
    return {
      activeCount,
      queuedCount: this.queue.length,
      capacity: this.maxConcurrentRuns,
      queueCapacity: this.maxQueuedRuns,
      availableSlots: Math.max(0, this.maxConcurrentRuns - activeCount),
      oldestWaitMs: Number.isFinite(oldestEnqueuedAt)
        ? Math.max(0, this.now() - oldestEnqueuedAt)
        : 0,
      rejectedCount: this.rejectedCount,
      foregroundActiveCount: this.readForegroundActiveCount(),
      activeByKind: { ...this.activeByKind },
      queuedByKind,
    };
  }

  private getActiveCount(): number {
    return Object.values(this.activeByKind).reduce((total, count) => total + count, 0);
  }

  private readForegroundActiveCount(): number {
    try {
      const count = this.getForegroundActiveCount();
      return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    } catch {
      return 0;
    }
  }

  private resolveIdleWaiters(): void {
    if (this.getActiveCount() > 0) return;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  private dispatchQueued(): void {
    if (!this.accepting || this.queue.length === 0) return;
    while (this.getActiveCount() < this.maxConcurrentRuns) {
      const index = this.selectNextQueuedIndex();
      if (index < 0) return;
      const [queued] = this.queue.splice(index, 1);
      this.queuedKeys.delete(queued.identity);
      queued.input.signal?.removeEventListener("abort", queued.abort!);
      const claim = this.tryClaim(queued.input);
      queued.resolve(claim);
      if ("reason" in claim && isCapacityReason(claim.reason)) {
        return;
      }
    }
  }

  private selectNextQueuedIndex(): number {
    let selectedIndex = -1;
    for (let index = 0; index < this.queue.length; index++) {
      const candidate = this.queue[index];
      if (this.activeByKind[candidate.input.kind] >= this.maxConcurrentByKind[candidate.input.kind]) {
        continue;
      }
      if (selectedIndex < 0) {
        selectedIndex = index;
        continue;
      }
      const selected = this.queue[selectedIndex];
      if (
        candidate.admissionTicket < selected.admissionTicket
        || (
          candidate.admissionTicket === selected.admissionTicket
          && candidate.sequence < selected.sequence
        )
      ) {
        selectedIndex = index;
      }
    }
    return selectedIndex;
  }
}

function isCapacityReason(reason: string): boolean {
  return reason === "Background run coordinator has reached its concurrent run limit."
    || reason.endsWith("run capacity has been reached.");
}
