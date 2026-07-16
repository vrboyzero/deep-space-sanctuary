import type {
  QueryRuntimeMethod,
  QueryRuntimeObserver,
  QueryRuntimeStage,
  QueryRuntimeStageEvent,
} from "./query-runtime.js";

export type QueryRuntimeTraceStatus = "running" | "completed" | "failed";

export type QueryRuntimeTraceStageSnapshot = {
  stage: QueryRuntimeStage;
  timestamp: number;
  detail?: Record<string, unknown>;
};

export type QueryRuntimeTraceRecord = {
  traceId: string;
  method: QueryRuntimeMethod;
  status: QueryRuntimeTraceStatus;
  conversationId?: string;
  startedAt: number;
  updatedAt: number;
  latestStage: QueryRuntimeStage;
  stageCount: number;
  stages: QueryRuntimeTraceStageSnapshot[];
};

export type QueryRuntimeStageDurationAggregate = {
  method: QueryRuntimeMethod;
  previousStage: QueryRuntimeStage;
  stage: QueryRuntimeStage;
  outcome: QueryRuntimeTraceStatus;
  count: number;
  sumMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  buckets: Array<{
    upperBoundMs?: number;
    count: number;
  }>;
};

export type QueryRuntimeStageDurationSummary = {
  available: boolean;
  maxAggregates: number;
  maxSamplesPerAggregate: number;
  aggregateCount: number;
  aggregates: QueryRuntimeStageDurationAggregate[];
  slowest: QueryRuntimeStageDurationAggregate[];
};

export type QueryRuntimeTraceSummary = {
  observerEnabled: true;
  totalObservedEvents: number;
  activeTraceCount: number;
  stageDurations: QueryRuntimeStageDurationSummary;
  stopDiagnostics: QueryRuntimeStopDiagnosticsSummary;
  traces: QueryRuntimeTraceRecord[];
};

export type QueryRuntimeStopOutcome =
  | "stop_requested"
  | "stopped"
  | "running_after_stop"
  | "completed_after_stop"
  | "failed_after_stop"
  | "not_found"
  | "run_mismatch";

export type QueryRuntimeStopDiagnosticRecord = {
  stopTraceId: string;
  stopStatus: QueryRuntimeTraceStatus;
  conversationId?: string;
  runId?: string;
  requestedAt: number;
  updatedAt: number;
  accepted: boolean;
  requestState?: string;
  reason?: string;
  outcome: QueryRuntimeStopOutcome;
  messageTraceId?: string;
  messageStatus?: QueryRuntimeTraceStatus;
  messageLatestStage?: QueryRuntimeStage;
  messageUpdatedAt?: number;
  messageResponse?: string;
  hadPartialResponse?: boolean;
};

export type QueryRuntimeStopDiagnosticsSummary = {
  available: boolean;
  totalRequests: number;
  acceptedRequests: number;
  stoppedRuns: number;
  runningAfterStopCount: number;
  completedAfterStopCount: number;
  failedAfterStopCount: number;
  notFoundCount: number;
  runMismatchCount: number;
  recent: QueryRuntimeStopDiagnosticRecord[];
};

type TerminalStage = Extract<QueryRuntimeStage, "completed" | "failed">;

type QueryRuntimeTraceInternalRecord = {
  traceId: string;
  method: QueryRuntimeMethod;
  conversationId?: string;
  startedAt: number;
  updatedAt: number;
  latestStage: QueryRuntimeStage;
  stageCount: number;
  stages: QueryRuntimeTraceStageSnapshot[];
  terminalStage?: TerminalStage;
};

type QueryRuntimeStageDurationInternalAggregate = {
  key: string;
  method: QueryRuntimeMethod;
  previousStage: QueryRuntimeStage;
  stage: QueryRuntimeStage;
  outcome: QueryRuntimeTraceStatus;
  samplesMs: number[];
  bucketCounts: number[];
  sumMs: number;
  maxMs: number;
  updatedAt: number;
};

const STAGE_DURATION_BUCKET_UPPER_BOUNDS_MS = [
  1,
  5,
  10,
  25,
  50,
  100,
  250,
  500,
  1_000,
  2_500,
  5_000,
  10_000,
  30_000,
] as const;
const MAX_SLOW_STAGE_RANKINGS = 6;

export class QueryRuntimeTraceStore {
  private readonly maxTraces: number;
  private readonly maxStagesPerTrace: number;
  private readonly stageDurationAggregationEnabled: boolean;
  private readonly maxDurationAggregates: number;
  private readonly maxDurationSamplesPerAggregate: number;
  private readonly traces = new Map<string, QueryRuntimeTraceInternalRecord>();
  private readonly durationAggregates = new Map<string, QueryRuntimeStageDurationInternalAggregate>();
  private totalObservedEvents = 0;

  constructor(options: {
    maxTraces?: number;
    maxStagesPerTrace?: number;
    enableStageDurationAggregation?: boolean;
    maxDurationAggregates?: number;
    maxDurationSamplesPerAggregate?: number;
  } = {}) {
    this.maxTraces = Math.max(1, Math.floor(options.maxTraces ?? 24));
    this.maxStagesPerTrace = Math.max(1, Math.floor(options.maxStagesPerTrace ?? 16));
    this.stageDurationAggregationEnabled = options.enableStageDurationAggregation ?? true;
    this.maxDurationAggregates = Math.max(1, Math.floor(options.maxDurationAggregates ?? 48));
    this.maxDurationSamplesPerAggregate = Math.max(1, Math.floor(options.maxDurationSamplesPerAggregate ?? 64));
  }

  createObserver<TMethod extends QueryRuntimeMethod>(): QueryRuntimeObserver<TMethod> {
    return (event) => {
      this.observe(event);
    };
  }

  observe<TMethod extends QueryRuntimeMethod>(event: QueryRuntimeStageEvent<TMethod>): void {
    this.totalObservedEvents += 1;
    const current = this.traces.get(event.traceId);
    const stageSnapshot: QueryRuntimeTraceStageSnapshot = {
      stage: event.stage,
      timestamp: event.timestamp,
      detail: cloneDetail(event.detail),
    };

    if (!current) {
      this.traces.set(event.traceId, {
        traceId: event.traceId,
        method: event.method,
        conversationId: event.conversationId,
        startedAt: event.timestamp,
        updatedAt: event.timestamp,
        latestStage: event.stage,
        stageCount: 1,
        stages: [stageSnapshot],
        terminalStage: toTerminalStage(event.stage),
      });
      this.trimToLimit();
      return;
    }

    if (this.stageDurationAggregationEnabled) {
      this.observeStageDuration({
        method: event.method,
        previousStage: current.latestStage,
        stage: event.stage,
        outcome: toStatus(toTerminalStage(event.stage)),
        durationMs: normalizeDurationMs(event.timestamp - current.updatedAt),
        updatedAt: event.timestamp,
      });
    }
    current.conversationId = event.conversationId ?? current.conversationId;
    current.updatedAt = event.timestamp;
    current.latestStage = event.stage;
    current.stageCount += 1;
    current.stages.push(stageSnapshot);
    if (current.stages.length > this.maxStagesPerTrace) {
      current.stages.splice(0, current.stages.length - this.maxStagesPerTrace);
    }
    current.terminalStage = toTerminalStage(event.stage) ?? current.terminalStage;
    this.trimToLimit();
  }

  getSummary(): QueryRuntimeTraceSummary {
    const traces = [...this.traces.values()]
      .sort((left, right) => {
        if (right.updatedAt !== left.updatedAt) {
          return right.updatedAt - left.updatedAt;
        }
        return right.startedAt - left.startedAt;
      })
      .map<QueryRuntimeTraceRecord>((trace) => ({
        traceId: trace.traceId,
        method: trace.method,
        status: toStatus(trace.terminalStage),
        conversationId: trace.conversationId,
        startedAt: trace.startedAt,
        updatedAt: trace.updatedAt,
        latestStage: trace.latestStage,
        stageCount: trace.stageCount,
        stages: trace.stages.map((stage) => ({
          stage: stage.stage,
          timestamp: stage.timestamp,
          detail: cloneDetail(stage.detail),
        })),
      }));
    const stopDiagnostics = buildStopDiagnosticsSummary(traces);

    return {
      observerEnabled: true,
      totalObservedEvents: this.totalObservedEvents,
      activeTraceCount: traces.filter((trace) => trace.status === "running").length,
      stageDurations: this.getStageDurationSummary(),
      stopDiagnostics,
      traces,
    };
  }

  private observeStageDuration(input: {
    method: QueryRuntimeMethod;
    previousStage: QueryRuntimeStage;
    stage: QueryRuntimeStage;
    outcome: QueryRuntimeTraceStatus;
    durationMs: number;
    updatedAt: number;
  }): void {
    const key = `${input.method}\u0000${input.previousStage}\u0000${input.stage}\u0000${input.outcome}`;
    let aggregate = this.durationAggregates.get(key);
    if (!aggregate) {
      this.trimDurationAggregatesToLimit();
      aggregate = {
        key,
        method: input.method,
        previousStage: input.previousStage,
        stage: input.stage,
        outcome: input.outcome,
        samplesMs: [],
        bucketCounts: Array.from({ length: STAGE_DURATION_BUCKET_UPPER_BOUNDS_MS.length + 1 }, () => 0),
        sumMs: 0,
        maxMs: 0,
        updatedAt: input.updatedAt,
      };
      this.durationAggregates.set(key, aggregate);
    }

    aggregate.samplesMs.push(input.durationMs);
    aggregate.sumMs += input.durationMs;
    aggregate.bucketCounts[findStageDurationBucketIndex(input.durationMs)] += 1;
    aggregate.maxMs = Math.max(aggregate.maxMs, input.durationMs);
    aggregate.updatedAt = input.updatedAt;

    if (aggregate.samplesMs.length > this.maxDurationSamplesPerAggregate) {
      const evictedDuration = aggregate.samplesMs.shift();
      if (typeof evictedDuration === "number") {
        aggregate.sumMs -= evictedDuration;
        aggregate.bucketCounts[findStageDurationBucketIndex(evictedDuration)] -= 1;
        if (evictedDuration === aggregate.maxMs) {
          aggregate.maxMs = Math.max(0, ...aggregate.samplesMs);
        }
      }
    }
  }

  private getStageDurationSummary(): QueryRuntimeStageDurationSummary {
    if (!this.stageDurationAggregationEnabled) {
      return {
        available: false,
        maxAggregates: this.maxDurationAggregates,
        maxSamplesPerAggregate: this.maxDurationSamplesPerAggregate,
        aggregateCount: 0,
        aggregates: [],
        slowest: [],
      };
    }

    const aggregates = [...this.durationAggregates.values()]
      .map((aggregate) => toStageDurationAggregateSnapshot(aggregate))
      .sort(compareStageDurationAggregate);
    const slowest = [...aggregates]
      .sort(compareSlowStageDurationAggregate)
      .slice(0, MAX_SLOW_STAGE_RANKINGS);
    return {
      available: true,
      maxAggregates: this.maxDurationAggregates,
      maxSamplesPerAggregate: this.maxDurationSamplesPerAggregate,
      aggregateCount: aggregates.length,
      aggregates,
      slowest,
    };
  }

  private trimDurationAggregatesToLimit(): void {
    if (this.durationAggregates.size < this.maxDurationAggregates) {
      return;
    }

    const oldest = [...this.durationAggregates.values()]
      .sort((left, right) => left.updatedAt - right.updatedAt || left.key.localeCompare(right.key))[0];
    if (oldest) {
      this.durationAggregates.delete(oldest.key);
    }
  }

  private trimToLimit(): void {
    if (this.traces.size <= this.maxTraces) {
      return;
    }

    const traceIds = [...this.traces.values()]
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
          return left.updatedAt - right.updatedAt;
        }
        return left.startedAt - right.startedAt;
      })
      .slice(0, this.traces.size - this.maxTraces)
      .map((trace) => trace.traceId);

    for (const traceId of traceIds) {
      this.traces.delete(traceId);
    }
  }
}

function normalizeDurationMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function findStageDurationBucketIndex(durationMs: number): number {
  const index = STAGE_DURATION_BUCKET_UPPER_BOUNDS_MS.findIndex((upperBoundMs) => durationMs <= upperBoundMs);
  return index === -1 ? STAGE_DURATION_BUCKET_UPPER_BOUNDS_MS.length : index;
}

function approximateStageDurationQuantile(
  aggregate: QueryRuntimeStageDurationInternalAggregate,
  quantile: number,
): number {
  const sampleCount = aggregate.samplesMs.length;
  if (sampleCount <= 0) {
    return 0;
  }

  const targetCount = Math.max(1, Math.ceil(sampleCount * quantile));
  let cumulativeCount = 0;
  for (let index = 0; index < aggregate.bucketCounts.length; index += 1) {
    cumulativeCount += aggregate.bucketCounts[index] ?? 0;
    if (cumulativeCount >= targetCount) {
      return STAGE_DURATION_BUCKET_UPPER_BOUNDS_MS[index] ?? aggregate.maxMs;
    }
  }
  return aggregate.maxMs;
}

function toStageDurationAggregateSnapshot(
  aggregate: QueryRuntimeStageDurationInternalAggregate,
): QueryRuntimeStageDurationAggregate {
  return {
    method: aggregate.method,
    previousStage: aggregate.previousStage,
    stage: aggregate.stage,
    outcome: aggregate.outcome,
    count: aggregate.samplesMs.length,
    sumMs: aggregate.sumMs,
    maxMs: aggregate.maxMs,
    p50Ms: approximateStageDurationQuantile(aggregate, 0.5),
    p95Ms: approximateStageDurationQuantile(aggregate, 0.95),
    buckets: aggregate.bucketCounts.map((count, index) => ({
      ...(STAGE_DURATION_BUCKET_UPPER_BOUNDS_MS[index] !== undefined
        ? { upperBoundMs: STAGE_DURATION_BUCKET_UPPER_BOUNDS_MS[index] }
        : {}),
      count,
    })),
  };
}

function compareStageDurationAggregate(
  left: QueryRuntimeStageDurationAggregate,
  right: QueryRuntimeStageDurationAggregate,
): number {
  return left.method.localeCompare(right.method)
    || left.previousStage.localeCompare(right.previousStage)
    || left.stage.localeCompare(right.stage)
    || left.outcome.localeCompare(right.outcome);
}

function compareSlowStageDurationAggregate(
  left: QueryRuntimeStageDurationAggregate,
  right: QueryRuntimeStageDurationAggregate,
): number {
  return right.p95Ms - left.p95Ms
    || right.maxMs - left.maxMs
    || right.sumMs - left.sumMs
    || right.count - left.count
    || compareStageDurationAggregate(left, right);
}

function toTerminalStage(stage: QueryRuntimeStage): TerminalStage | undefined {
  return stage === "completed" || stage === "failed" ? stage : undefined;
}

function toStatus(terminalStage?: TerminalStage): QueryRuntimeTraceStatus {
  if (terminalStage === "failed") {
    return "failed";
  }
  if (terminalStage === "completed") {
    return "completed";
  }
  return "running";
}

function cloneDetail(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  return detail ? { ...detail } : undefined;
}

function buildStopDiagnosticsSummary(traces: QueryRuntimeTraceRecord[]): QueryRuntimeStopDiagnosticsSummary {
  const stopTraces = traces.filter((trace) => trace.method === "conversation.run.stop");
  const diagnostics = stopTraces.map((trace) => toStopDiagnosticRecord(trace, traces));

  return {
    available: diagnostics.length > 0,
    totalRequests: diagnostics.length,
    acceptedRequests: diagnostics.filter((item) => item.accepted).length,
    stoppedRuns: diagnostics.filter((item) => item.outcome === "stopped").length,
    runningAfterStopCount: diagnostics.filter((item) => item.outcome === "running_after_stop").length,
    completedAfterStopCount: diagnostics.filter((item) => item.outcome === "completed_after_stop").length,
    failedAfterStopCount: diagnostics.filter((item) => item.outcome === "failed_after_stop").length,
    notFoundCount: diagnostics.filter((item) => item.outcome === "not_found").length,
    runMismatchCount: diagnostics.filter((item) => item.outcome === "run_mismatch").length,
    recent: diagnostics.slice(0, 6),
  };
}

function toStopDiagnosticRecord(
  stopTrace: QueryRuntimeTraceRecord,
  traces: QueryRuntimeTraceRecord[],
): QueryRuntimeStopDiagnosticRecord {
  const requestState = readTraceStringDetail(stopTrace, "state");
  const accepted = readTraceBooleanDetail(stopTrace, "accepted") ?? requestState === "stop_requested";
  const runId = readTraceStringDetail(stopTrace, "runId");
  const conversationId = stopTrace.conversationId;
  const reason = readTraceStringDetail(stopTrace, "reason");
  const messageTrace = findMatchingMessageTrace(traces, conversationId, runId);
  const messageResponse = messageTrace ? readCompletedResponse(messageTrace) : undefined;
  const messageStopped = messageTrace ? isMessageTraceStopped(messageTrace) : false;

  let outcome: QueryRuntimeStopOutcome;
  if (!accepted) {
    outcome = requestState === "run_mismatch" ? "run_mismatch" : "not_found";
  } else if (messageStopped) {
    outcome = "stopped";
  } else if (messageTrace?.status === "running") {
    outcome = "running_after_stop";
  } else if (messageTrace?.status === "failed") {
    outcome = "failed_after_stop";
  } else if (messageTrace?.status === "completed") {
    outcome = "completed_after_stop";
  } else {
    outcome = "stop_requested";
  }

  return {
    stopTraceId: stopTrace.traceId,
    stopStatus: stopTrace.status,
    conversationId,
    runId,
    requestedAt: stopTrace.startedAt,
    updatedAt: stopTrace.updatedAt,
    accepted,
    requestState,
    reason,
    outcome,
    ...(messageTrace
      ? {
        messageTraceId: messageTrace.traceId,
        messageStatus: messageTrace.status,
        messageLatestStage: messageTrace.latestStage,
        messageUpdatedAt: messageTrace.updatedAt,
        ...(messageResponse ? { messageResponse } : {}),
        ...(readTraceBooleanDetail(messageTrace, "hadPartialResponse") !== undefined
          ? { hadPartialResponse: readTraceBooleanDetail(messageTrace, "hadPartialResponse") }
          : {}),
      }
      : {}),
  };
}

function findMatchingMessageTrace(
  traces: QueryRuntimeTraceRecord[],
  conversationId?: string,
  runId?: string,
): QueryRuntimeTraceRecord | undefined {
  const candidates = traces
    .filter((trace) => trace.method === "message.send")
    .filter((trace) => {
      if (conversationId && trace.conversationId !== conversationId) {
        return false;
      }
      if (runId) {
        return readTraceStringDetail(trace, "runId") === runId;
      }
      return true;
    })
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      return right.startedAt - left.startedAt;
    });
  return candidates[0];
}

function isMessageTraceStopped(trace: QueryRuntimeTraceRecord): boolean {
  return trace.stages.some((stage) => stage.stage === "task_stopped")
    || readCompletedResponse(trace) === "stopped";
}

function readCompletedResponse(trace: QueryRuntimeTraceRecord): string | undefined {
  const completedStage = [...trace.stages]
    .reverse()
    .find((stage) => stage.stage === "completed");
  const response = completedStage?.detail?.response;
  return typeof response === "string" && response.trim() ? response.trim() : undefined;
}

function readTraceStringDetail(trace: QueryRuntimeTraceRecord, key: string): string | undefined {
  for (let index = trace.stages.length - 1; index >= 0; index -= 1) {
    const value = trace.stages[index]?.detail?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readTraceBooleanDetail(trace: QueryRuntimeTraceRecord, key: string): boolean | undefined {
  for (let index = trace.stages.length - 1; index >= 0; index -= 1) {
    const value = trace.stages[index]?.detail?.[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}
