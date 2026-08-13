import {
  isCodingRunUsageCompletenessV1,
  type CodingRunUsageCompleteness,
} from "./contracts.js";
import { isTaskProjectionV1, type TaskProjection } from "./task-projection.js";
import type { CodingRunTraceEvent } from "./trace.js";

export const TASK_EFFICIENCY_METRICS_SCHEMA_VERSION = "task-efficiency-metrics/v1" as const;

export type TaskEfficiencyMetricName =
  | "completionLatencyMs"
  | "blockedDurationMs"
  | "needsInputDurationMs"
  | "humanInterventionCount"
  | "contextCallCount"
  | "toolCallCount"
  | "validationDurationMs"
  | "usageCompleteness";

export type TaskProjectionTimeline = {
  coverage: "complete";
  items: TaskProjection[];
};

export type TaskStatusObservation = {
  status: "running" | "needs_input" | "blocked" | "verifying"
    | "completed" | "failed" | "cancelled" | "interrupted";
  observedAtMs: number;
};

export type TaskStatusObservationTimeline = {
  source: "gateway_event_broker";
  coverage: "complete";
  binding: {
    agentRunId: string;
    conversationId?: string;
  };
  statusCoverage: Array<"blocked" | "needs_input" | "verifying">;
  items: TaskStatusObservation[];
};

export type HumanInterventionEvidence = {
  source: "human_response";
  coverage: "complete";
  binding: {
    agentRunId: string;
    conversationId?: string;
  };
  count: number;
};

export type TaskEfficiencyEvidence =
  | {
    status: "complete";
    projectionTimeline: TaskStatusObservationTimeline;
    humanInterventionEvidence?: HumanInterventionEvidence;
  }
  | {
    status: "incomplete";
    reason: "not_found" | "run_mismatch" | "run_not_terminal" | "lifecycle_not_retained";
  };

export type TaskEfficiencyMetrics = {
  schemaVersion: typeof TASK_EFFICIENCY_METRICS_SCHEMA_VERSION;
  contentMode: "none";
  status: "complete" | "incomplete";
  completionLatencyMs: number;
  blockedDurationMs?: number;
  needsInputDurationMs?: number;
  humanInterventionCount?: number;
  contextCallCount?: number;
  toolCallCount: number;
  validationDurationMs?: number;
  usageCompleteness: CodingRunUsageCompleteness;
  missingMetrics: TaskEfficiencyMetricName[];
};

export function summarizeTaskEfficiencyMetrics(input: {
  trace: CodingRunTraceEvent[];
  projectionTimeline?: TaskProjectionTimeline | TaskStatusObservationTimeline;
  humanInterventionEvidence?: HumanInterventionEvidence;
}): TaskEfficiencyMetrics {
  const first = input.trace[0];
  let terminal: CodingRunTraceEvent | undefined;
  for (let index = input.trace.length - 1; index >= 0; index -= 1) {
    const candidate = input.trace[index];
    if (candidate?.domain === "run" && [
      "run.completed", "run.failed", "run.cancelled", "run.interrupted",
    ].includes(candidate.event)) {
      terminal = candidate;
      break;
    }
  }
  if (!first || !terminal) {
    throw new Error("Task efficiency metrics require a validated terminal trace.");
  }

  const usageCompleteness = readUsageCompleteness(terminal);
  const contextCallCount = usageCompleteness.modelCalls;
  const humanInterventionCount = readHumanInterventionCount(input.humanInterventionEvidence, first);
  const durations = input.projectionTimeline
    ? summarizeProjectionDurations(input.projectionTimeline, first, terminal)
    : undefined;
  const missingMetrics: TaskEfficiencyMetricName[] = [];
  if (durations?.blockedDurationMs === undefined) missingMetrics.push("blockedDurationMs");
  if (durations?.needsInputDurationMs === undefined) missingMetrics.push("needsInputDurationMs");
  if (humanInterventionCount === undefined) {
    missingMetrics.push("humanInterventionCount");
  }
  if (contextCallCount === undefined) {
    missingMetrics.push("contextCallCount");
  }
  if (durations?.validationDurationMs === undefined) missingMetrics.push("validationDurationMs");
  if (usageCompleteness.status !== "complete") {
    missingMetrics.push("usageCompleteness");
  }

  return {
    schemaVersion: TASK_EFFICIENCY_METRICS_SCHEMA_VERSION,
    contentMode: "none",
    status: missingMetrics.length === 0 && usageCompleteness.status === "complete" ? "complete" : "incomplete",
    completionLatencyMs: terminal.timestampMs - first.timestampMs,
    ...(durations?.blockedDurationMs === undefined ? {} : { blockedDurationMs: durations.blockedDurationMs }),
    ...(durations?.needsInputDurationMs === undefined ? {} : { needsInputDurationMs: durations.needsInputDurationMs }),
    ...(humanInterventionCount === undefined ? {} : { humanInterventionCount }),
    ...(contextCallCount === undefined ? {} : { contextCallCount }),
    toolCallCount: input.trace.filter((event) => event.event === "tool.started").length,
    ...(durations?.validationDurationMs === undefined ? {} : { validationDurationMs: durations.validationDurationMs }),
    usageCompleteness,
    missingMetrics,
  };
}

export function parseTaskEfficiencyEvidence(
  value: unknown,
  expectedBinding?: { agentRunId: string; conversationId?: string },
): TaskEfficiencyEvidence | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "reason", "projectionTimeline", "humanInterventionEvidence"])) {
    return undefined;
  }
  if (value.status === "incomplete") {
    return hasOnlyKeys(value, ["status", "reason"])
      && ["not_found", "run_mismatch", "run_not_terminal", "lifecycle_not_retained"].includes(String(value.reason))
      ? value as TaskEfficiencyEvidence
      : undefined;
  }
  if (value.status !== "complete" || !hasOnlyKeys(value, ["status", "projectionTimeline", "humanInterventionEvidence"])) {
    return undefined;
  }
  const timeline = parseTaskStatusObservationTimeline(value.projectionTimeline, expectedBinding);
  if (!timeline) return undefined;
  const human = value.humanInterventionEvidence === undefined
    ? undefined
    : parseHumanInterventionEvidence(value.humanInterventionEvidence, timeline.binding);
  if (value.humanInterventionEvidence !== undefined && !human) return undefined;
  return {
    status: "complete",
    projectionTimeline: timeline,
    ...(human ? { humanInterventionEvidence: human } : {}),
  };
}

function readHumanInterventionCount(
  evidence: HumanInterventionEvidence | undefined,
  first: CodingRunTraceEvent,
): number | undefined {
  if (!evidence) return undefined;
  if (Object.keys(evidence).some((key) => !["source", "coverage", "binding", "count"].includes(key))
    || evidence.source !== "human_response"
    || evidence.coverage !== "complete"
    || !evidence.binding
    || Object.keys(evidence.binding).some((key) => !["agentRunId", "conversationId"].includes(key))
    || evidence.binding.agentRunId !== first.correlation.agentRunId
    || evidence.binding.conversationId !== first.correlation.conversationId
    || !Number.isSafeInteger(evidence.count)
    || evidence.count < 0) {
    throw new Error("Task efficiency human intervention evidence is invalid.");
  }
  return evidence.count;
}

function summarizeProjectionDurations(
  timeline: TaskProjectionTimeline | TaskStatusObservationTimeline,
  first: CodingRunTraceEvent,
  terminal: CodingRunTraceEvent,
): {
  blockedDurationMs?: number;
  needsInputDurationMs?: number;
  validationDurationMs?: number;
} {
  if (timeline.coverage !== "complete" || !Array.isArray(timeline.items) || timeline.items.length < 2) {
    throw new Error("Task efficiency projection timeline is invalid.");
  }
  if (isStatusObservationTimeline(timeline)) {
    return summarizeStatusObservationDurations(timeline, first, terminal);
  }
  const taskId = timeline.items[0]?.taskId;
  let previousTimestamp = -1;
  for (const item of timeline.items) {
    if (!isTaskProjectionV1(item)
      || item.taskId !== taskId
      || item.owner.binding.agentRunId !== first.correlation.agentRunId
      || item.owner.binding.conversationId !== first.correlation.conversationId
      || item.evidence.observedAtMs <= previousTimestamp) {
      throw new Error("Task efficiency projection timeline binding or order is invalid.");
    }
    previousTimestamp = item.evidence.observedAtMs;
  }
  if (timeline.items[0]!.evidence.observedAtMs > first.timestampMs
    || timeline.items.at(-1)!.evidence.observedAtMs < terminal.timestampMs) {
    throw new Error("Task efficiency projection timeline does not cover the trace lifecycle.");
  }

  const durations = {
    blockedDurationMs: 0,
    needsInputDurationMs: 0,
    validationDurationMs: 0,
  };
  for (let index = 0; index < timeline.items.length - 1; index += 1) {
    const current = timeline.items[index]!;
    const next = timeline.items[index + 1]!;
    const intervalStart = Math.max(first.timestampMs, current.evidence.observedAtMs);
    const intervalEnd = Math.min(terminal.timestampMs, next.evidence.observedAtMs);
    const durationMs = Math.max(0, intervalEnd - intervalStart);
    if (current.status === "blocked") durations.blockedDurationMs += durationMs;
    if (current.status === "needs_input") durations.needsInputDurationMs += durationMs;
    if (current.status === "verifying") durations.validationDurationMs += durationMs;
  }
  return durations;
}

function summarizeStatusObservationDurations(
  timeline: TaskStatusObservationTimeline,
  first: CodingRunTraceEvent,
  terminal: CodingRunTraceEvent,
): {
  blockedDurationMs?: number;
  needsInputDurationMs?: number;
  validationDurationMs?: number;
} {
  const covered = new Set(timeline.statusCoverage);
  if (timeline.source !== "gateway_event_broker"
    || timeline.binding.agentRunId !== first.correlation.agentRunId
    || timeline.binding.conversationId !== first.correlation.conversationId
    || covered.size !== timeline.statusCoverage.length
    || [...covered].some((status) => !["blocked", "needs_input", "verifying"].includes(status))) {
    throw new Error("Task efficiency status observation timeline is invalid.");
  }
  let previousTimestamp = -1;
  for (const item of timeline.items) {
    if (!isTaskStatusObservation(item) || item.observedAtMs < previousTimestamp) {
      throw new Error("Task efficiency status observation timeline is invalid.");
    }
    previousTimestamp = item.observedAtMs;
  }
  if (timeline.items[0]!.observedAtMs > first.timestampMs
    || timeline.items.at(-1)!.observedAtMs < terminal.timestampMs) {
    throw new Error("Task efficiency status observation timeline does not cover the trace lifecycle.");
  }

  const durations: Record<"blocked" | "needs_input" | "verifying", number> = {
    blocked: 0,
    needs_input: 0,
    verifying: 0,
  };
  for (let index = 0; index < timeline.items.length - 1; index += 1) {
    const current = timeline.items[index]!;
    const next = timeline.items[index + 1]!;
    if (!covered.has(current.status as "blocked" | "needs_input" | "verifying")) continue;
    const intervalStart = Math.max(first.timestampMs, current.observedAtMs);
    const intervalEnd = Math.min(terminal.timestampMs, next.observedAtMs);
    durations[current.status as "blocked" | "needs_input" | "verifying"] += Math.max(0, intervalEnd - intervalStart);
  }
  return {
    ...(covered.has("blocked") ? { blockedDurationMs: durations.blocked } : {}),
    ...(covered.has("needs_input") ? { needsInputDurationMs: durations.needs_input } : {}),
    ...(covered.has("verifying") ? { validationDurationMs: durations.verifying } : {}),
  };
}

function isStatusObservationTimeline(
  timeline: TaskProjectionTimeline | TaskStatusObservationTimeline,
): timeline is TaskStatusObservationTimeline {
  return "source" in timeline;
}

function isTaskStatusObservation(value: unknown): value is TaskStatusObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).every((key) => key === "status" || key === "observedAtMs")
    && ["running", "needs_input", "blocked", "verifying", "completed", "failed", "cancelled", "interrupted"]
      .includes(String(item.status))
    && Number.isSafeInteger(item.observedAtMs)
    && (item.observedAtMs as number) >= 0;
}

function parseTaskStatusObservationTimeline(
  value: unknown,
  expectedBinding?: { agentRunId: string; conversationId?: string },
): TaskStatusObservationTimeline | undefined {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["source", "coverage", "binding", "statusCoverage", "items"])
    || value.source !== "gateway_event_broker"
    || value.coverage !== "complete"
    || !isRecord(value.binding)
    || !hasOnlyKeys(value.binding, ["agentRunId", "conversationId"])
    || !isNonEmptyString(value.binding.agentRunId)
    || (value.binding.conversationId !== undefined && !isNonEmptyString(value.binding.conversationId))
    || !Array.isArray(value.statusCoverage)
    || !Array.isArray(value.items)
    || value.items.length < 2) {
    return undefined;
  }
  const binding = {
    agentRunId: value.binding.agentRunId.trim(),
    ...(typeof value.binding.conversationId === "string"
      ? { conversationId: value.binding.conversationId.trim() }
      : {}),
  };
  if (expectedBinding && (binding.agentRunId !== expectedBinding.agentRunId
    || binding.conversationId !== expectedBinding.conversationId)) return undefined;
  const statusCoverage = value.statusCoverage.filter((status): status is "blocked" | "needs_input" | "verifying" => (
    status === "blocked" || status === "needs_input" || status === "verifying"
  ));
  if (statusCoverage.length !== value.statusCoverage.length
    || new Set(statusCoverage).size !== statusCoverage.length
    || !value.items.every(isTaskStatusObservation)) return undefined;
  let previousTimestamp = -1;
  for (const item of value.items) {
    if (item.observedAtMs < previousTimestamp) return undefined;
    previousTimestamp = item.observedAtMs;
  }
  return {
    source: "gateway_event_broker",
    coverage: "complete",
    binding,
    statusCoverage: [...statusCoverage],
    items: value.items.map((item) => ({ ...item })),
  };
}

function parseHumanInterventionEvidence(
  value: unknown,
  expectedBinding: { agentRunId: string; conversationId?: string },
): HumanInterventionEvidence | undefined {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["source", "coverage", "binding", "count"])
    || value.source !== "human_response"
    || value.coverage !== "complete"
    || !isRecord(value.binding)
    || !hasOnlyKeys(value.binding, ["agentRunId", "conversationId"])
    || value.binding.agentRunId !== expectedBinding.agentRunId
    || value.binding.conversationId !== expectedBinding.conversationId
    || !Number.isSafeInteger(value.count)
    || (value.count as number) < 0) return undefined;
  return {
    source: "human_response",
    coverage: "complete",
    binding: { ...expectedBinding },
    count: value.count as number,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readUsageCompleteness(event: CodingRunTraceEvent): CodingRunUsageCompleteness {
  const attributes = event.attributes;
  if (attributes?.usageStatus && attributes.usageReason) {
    const candidate: CodingRunUsageCompleteness = {
      status: attributes.usageStatus,
      reason: attributes.usageReason,
      ...(attributes.modelCalls === undefined ? {} : { modelCalls: attributes.modelCalls }),
      ...(attributes.providerReportedModelCalls === undefined
        ? {}
        : { providerReportedModelCalls: attributes.providerReportedModelCalls }),
    };
    if (isCodingRunUsageCompletenessV1(candidate)) return candidate;
  }
  return { status: "incomplete", reason: "usage_not_reported" };
}
