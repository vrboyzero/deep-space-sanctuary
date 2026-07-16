import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const DEFAULT_SAMPLE_INTERVAL_MS = 15_000;
const DEFAULT_MAX_SAMPLES = 24;
const DEFAULT_EVENT_LOOP_DELAY_RESOLUTION_MS = 20;
const MAX_QUEUE_PROVIDERS = 16;
const MAX_QUEUE_SNAPSHOTS_PER_PROVIDER = 16;
const MAX_QUEUE_SNAPSHOTS = 32;
const MAX_QUEUE_ID_LENGTH = 64;
const MAX_VALID_DELAY_NS = 24 * 60 * 60 * 1_000_000_000;

export type RuntimeResourceQueueSnapshot = {
  id: string;
  activeCount: number;
  queuedCount: number;
  capacity?: number;
  oldestWaitMs?: number;
  rejectedCount?: number;
  /** 仅展示的父级汇总快照，不参与 queueTotals 的加总。 */
  aggregate?: boolean;
};

export type RuntimeResourceQueueProvider = () => readonly RuntimeResourceQueueSnapshot[] | undefined;

export type RuntimeResourceEventLoopUtilization = {
  idle: number;
  active: number;
  utilization: number;
};

export type RuntimeResourceEventLoopPerformance = {
  eventLoopUtilization: (
    previous?: RuntimeResourceEventLoopUtilization,
  ) => RuntimeResourceEventLoopUtilization;
};

export type RuntimeResourceDelayHistogram = {
  max: number;
  percentile: (percentile: number) => number;
  enable: () => void;
  disable: () => void;
  reset: () => void;
};

export type RuntimeResourceMemoryUsage = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers?: number;
};

export type RuntimeResourceSample = {
  capturedAt: number;
  eventLoop: {
    utilization: number;
    activeMs: number;
    idleMs: number;
    delay: {
      p50Ms?: number;
      p95Ms?: number;
      maxMs?: number;
    };
  };
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  queues: RuntimeResourceQueueSnapshot[];
};

export type RuntimeResourceObservabilitySummary = {
  available: boolean;
  sampling: {
    running: boolean;
    intervalMs: number;
    maxSamples: number;
    sampleCount: number;
  };
  queueTotals: {
    queueCount: number;
    activeCount: number;
    queuedCount: number;
    oldestWaitMs: number;
    rejectedCount: number;
  };
  headline: string;
  latest?: RuntimeResourceSample;
  samples: RuntimeResourceSample[];
};

type IntervalHandle = ReturnType<typeof setInterval>;

export type RuntimeResourceObservabilityOptions = {
  enabled?: boolean;
  sampleIntervalMs?: number;
  maxSamples?: number;
  eventLoopDelayResolutionMs?: number;
  queueProviders?: RuntimeResourceQueueProvider[];
  now?: () => number;
  memoryUsage?: () => RuntimeResourceMemoryUsage;
  eventLoopPerformance?: RuntimeResourceEventLoopPerformance;
  createEventLoopDelayHistogram?: () => RuntimeResourceDelayHistogram;
  setIntervalFn?: (callback: () => void, delayMs: number) => IntervalHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
};

/**
 * Gateway 资源观测只保留短窗口聚合数值，不将请求内容、会话或连接身份扩散到 Doctor。
 * 队列仅使用受控的类别标签，供定位资源水位而非追踪具体请求。
 */
export class RuntimeResourceObservability {
  private readonly enabled: boolean;
  private readonly sampleIntervalMs: number;
  private readonly maxSamples: number;
  private readonly queueProviders: RuntimeResourceQueueProvider[];
  private readonly now: () => number;
  private readonly memoryUsage: () => RuntimeResourceMemoryUsage;
  private readonly eventLoopPerformance: RuntimeResourceEventLoopPerformance;
  private readonly createEventLoopDelayHistogram: () => RuntimeResourceDelayHistogram;
  private readonly setIntervalFn: (callback: () => void, delayMs: number) => IntervalHandle;
  private readonly clearIntervalFn: (handle: IntervalHandle) => void;
  private readonly samples: RuntimeResourceSample[] = [];
  private delayHistogram?: RuntimeResourceDelayHistogram;
  private previousEventLoopUtilization?: RuntimeResourceEventLoopUtilization;
  private timer?: IntervalHandle;
  private running = false;

  constructor(options: RuntimeResourceObservabilityOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.sampleIntervalMs = normalizePositiveInt(options.sampleIntervalMs, DEFAULT_SAMPLE_INTERVAL_MS);
    this.maxSamples = normalizePositiveInt(options.maxSamples, DEFAULT_MAX_SAMPLES);
    const eventLoopDelayResolutionMs = normalizePositiveInt(
      options.eventLoopDelayResolutionMs,
      DEFAULT_EVENT_LOOP_DELAY_RESOLUTION_MS,
    );
    this.queueProviders = options.queueProviders ?? [];
    this.now = options.now ?? Date.now;
    this.memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
    this.eventLoopPerformance = options.eventLoopPerformance ?? performance;
    this.createEventLoopDelayHistogram = options.createEventLoopDelayHistogram
      ?? (() => monitorEventLoopDelay({ resolution: eventLoopDelayResolutionMs }));
    this.setIntervalFn = options.setIntervalFn ?? ((callback, delayMs) => setInterval(callback, delayMs));
    this.clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle));
  }

  start(): void {
    if (!this.enabled || this.running) {
      return;
    }

    try {
      this.delayHistogram = this.createEventLoopDelayHistogram();
      this.delayHistogram.enable();
    } catch {
      this.delayHistogram = undefined;
    }
    try {
      this.previousEventLoopUtilization = this.eventLoopPerformance.eventLoopUtilization();
    } catch {
      this.previousEventLoopUtilization = undefined;
    }
    this.running = true;
    this.sampleNow();
    this.timer = this.setIntervalFn(() => {
      this.sampleNow();
    }, this.sampleIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = undefined;
    }
    if (this.running) {
      this.delayHistogram?.disable();
    }
    this.running = false;
  }

  sampleNow(): RuntimeResourceSample | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const sample: RuntimeResourceSample = {
      capturedAt: this.now(),
      eventLoop: this.captureEventLoop(),
      memory: this.captureMemoryUsage(),
      queues: this.captureQueueSnapshots(),
    };
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
    return cloneSample(sample);
  }

  getSummary(): RuntimeResourceObservabilitySummary {
    const latest = this.samples.at(-1);
    const queueTotals = summarizeQueues(latest?.queues ?? []);
    return {
      available: this.enabled,
      sampling: {
        running: this.running,
        intervalMs: this.sampleIntervalMs,
        maxSamples: this.maxSamples,
        sampleCount: this.samples.length,
      },
      queueTotals,
      headline: buildRuntimeResourceHeadline(latest, queueTotals, this.enabled),
      ...(latest ? { latest: cloneSample(latest) } : {}),
      samples: this.samples.map((sample) => cloneSample(sample)),
    };
  }

  private captureEventLoop(): RuntimeResourceSample["eventLoop"] {
    let current: RuntimeResourceEventLoopUtilization | undefined;
    let delta: RuntimeResourceEventLoopUtilization | undefined;
    try {
      current = this.eventLoopPerformance.eventLoopUtilization();
      delta = this.previousEventLoopUtilization
        ? this.eventLoopPerformance.eventLoopUtilization(this.previousEventLoopUtilization)
        : current;
      this.previousEventLoopUtilization = current;
    } catch {
      // Perf hooks 不可用时保留零值，避免观测本身干扰主请求路径。
    }

    const histogram = this.delayHistogram;
    const delay = histogram
      ? {
        p50Ms: normalizeNanosecondsToMilliseconds(histogram.percentile(50)),
        p95Ms: normalizeNanosecondsToMilliseconds(histogram.percentile(95)),
        maxMs: normalizeNanosecondsToMilliseconds(histogram.max),
      }
      : {};
    try {
      histogram?.reset();
    } catch {
      // Histogram reset 失败不应影响诊断或业务运行。
    }

    return {
      utilization: clampFraction(delta?.utilization),
      activeMs: normalizeNonNegativeNumber(delta?.active),
      idleMs: normalizeNonNegativeNumber(delta?.idle),
      delay: removeUndefinedDelayValues(delay),
    };
  }

  private captureMemoryUsage(): RuntimeResourceSample["memory"] {
    let usage: RuntimeResourceMemoryUsage | undefined;
    try {
      usage = this.memoryUsage();
    } catch {
      usage = undefined;
    }
    return {
      rssBytes: normalizeNonNegativeNumber(usage?.rss),
      heapTotalBytes: normalizeNonNegativeNumber(usage?.heapTotal),
      heapUsedBytes: normalizeNonNegativeNumber(usage?.heapUsed),
      externalBytes: normalizeNonNegativeNumber(usage?.external),
      arrayBuffersBytes: normalizeNonNegativeNumber(usage?.arrayBuffers),
    };
  }

  private captureQueueSnapshots(): RuntimeResourceQueueSnapshot[] {
    const snapshots = new Map<string, RuntimeResourceQueueSnapshot>();
    for (const provider of this.queueProviders.slice(0, MAX_QUEUE_PROVIDERS)) {
      let values: readonly RuntimeResourceQueueSnapshot[] | undefined;
      try {
        values = provider();
      } catch {
        continue;
      }
      // Provider 可能来自 Gateway 装配层；双重上限避免诊断输入反向放大内存或 Doctor payload。
      for (const value of (values ?? []).slice(0, MAX_QUEUE_SNAPSHOTS_PER_PROVIDER)) {
        const normalized = normalizeQueueSnapshot(value);
        if (!normalized) {
          continue;
        }
        const existing = snapshots.get(normalized.id);
        if (!existing && snapshots.size >= MAX_QUEUE_SNAPSHOTS) {
          continue;
        }
        snapshots.set(normalized.id, existing ? mergeQueueSnapshots(existing, normalized) : normalized);
      }
    }
    return [...snapshots.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback;
}

function normalizeNonNegativeNumber(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function clampFraction(value: unknown): number {
  return Math.min(1, normalizeNonNegativeNumber(value));
}

function normalizeNanosecondsToMilliseconds(value: unknown): number | undefined {
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > MAX_VALID_DELAY_NS) {
    return undefined;
  }
  return Math.round((Number(value) / 1_000_000) * 100) / 100;
}

function removeUndefinedDelayValues(value: {
  p50Ms?: number;
  p95Ms?: number;
  maxMs?: number;
}): RuntimeResourceSample["eventLoop"]["delay"] {
  return {
    ...(value.p50Ms !== undefined ? { p50Ms: value.p50Ms } : {}),
    ...(value.p95Ms !== undefined ? { p95Ms: value.p95Ms } : {}),
    ...(value.maxMs !== undefined ? { maxMs: value.maxMs } : {}),
  };
}

function normalizeQueueSnapshot(value: unknown): RuntimeResourceQueueSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Partial<RuntimeResourceQueueSnapshot>;
  const id = typeof input.id === "string" ? input.id.trim().slice(0, MAX_QUEUE_ID_LENGTH) : "";
  if (!id) {
    return undefined;
  }
  const capacity = Number.isFinite(input.capacity) && Number(input.capacity) > 0
    ? Math.floor(Number(input.capacity))
    : undefined;
  const oldestWaitMs = Number.isFinite(input.oldestWaitMs)
    ? Math.floor(normalizeNonNegativeNumber(input.oldestWaitMs))
    : undefined;
  const rejectedCount = Number.isFinite(input.rejectedCount)
    ? Math.floor(normalizeNonNegativeNumber(input.rejectedCount))
    : undefined;
  const aggregate = input.aggregate === true;
  return {
    id,
    activeCount: Math.floor(normalizeNonNegativeNumber(input.activeCount)),
    queuedCount: Math.floor(normalizeNonNegativeNumber(input.queuedCount)),
    ...(capacity !== undefined ? { capacity } : {}),
    ...(oldestWaitMs !== undefined ? { oldestWaitMs } : {}),
    ...(rejectedCount !== undefined ? { rejectedCount } : {}),
    ...(aggregate ? { aggregate: true } : {}),
  };
}

function mergeQueueSnapshots(
  left: RuntimeResourceQueueSnapshot,
  right: RuntimeResourceQueueSnapshot,
): RuntimeResourceQueueSnapshot {
  const capacity = [left.capacity, right.capacity]
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0);
  const oldestWaitMs = [left.oldestWaitMs, right.oldestWaitMs]
    .filter((value): value is number => typeof value === "number")
    .reduce((max, value) => Math.max(max, value), 0);
  const rejectedCount = [left.rejectedCount, right.rejectedCount]
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0);
  return {
    id: left.id,
    activeCount: left.activeCount + right.activeCount,
    queuedCount: left.queuedCount + right.queuedCount,
    ...(capacity > 0 ? { capacity } : {}),
    ...(oldestWaitMs > 0 ? { oldestWaitMs } : {}),
    ...(rejectedCount > 0 ? { rejectedCount } : {}),
    ...(left.aggregate === true && right.aggregate === true ? { aggregate: true } : {}),
  };
}

function summarizeQueues(queues: RuntimeResourceQueueSnapshot[]): RuntimeResourceObservabilitySummary["queueTotals"] {
  const summableQueues = queues.filter((queue) => !queue.aggregate);
  return {
    queueCount: summableQueues.length,
    activeCount: summableQueues.reduce((total, queue) => total + queue.activeCount, 0),
    queuedCount: summableQueues.reduce((total, queue) => total + queue.queuedCount, 0),
    oldestWaitMs: summableQueues.reduce((max, queue) => Math.max(max, queue.oldestWaitMs ?? 0), 0),
    rejectedCount: summableQueues.reduce((total, queue) => total + (queue.rejectedCount ?? 0), 0),
  };
}

function buildRuntimeResourceHeadline(
  latest: RuntimeResourceSample | undefined,
  queueTotals: RuntimeResourceObservabilitySummary["queueTotals"],
  enabled = true,
): string {
  if (!enabled) {
    return "Runtime resource sampling is disabled.";
  }
  if (!latest) {
    return "Runtime resource sampling is waiting for its first sample.";
  }
  return [
    `elu=${Math.round(latest.eventLoop.utilization * 100)}%`,
    `lagP95=${latest.eventLoop.delay.p95Ms ?? "-"}ms`,
    `rss=${latest.memory.rssBytes}`,
    `active=${queueTotals.activeCount}`,
    `queued=${queueTotals.queuedCount}`,
    `oldestWait=${queueTotals.oldestWaitMs}ms`,
    `rejected=${queueTotals.rejectedCount}`,
  ].join(", ");
}

function cloneSample(sample: RuntimeResourceSample): RuntimeResourceSample {
  return {
    capturedAt: sample.capturedAt,
    eventLoop: {
      utilization: sample.eventLoop.utilization,
      activeMs: sample.eventLoop.activeMs,
      idleMs: sample.eventLoop.idleMs,
      delay: { ...sample.eventLoop.delay },
    },
    memory: { ...sample.memory },
    queues: sample.queues.map((queue) => ({ ...queue })),
  };
}
