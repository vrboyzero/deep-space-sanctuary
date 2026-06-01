import type {
  BackgroundContinuationRuntimeDoctorReport,
  BackgroundContinuationRuntimeEntry,
} from "./background-continuation-runtime.js";
import type { CronRuntimeDoctorReport } from "./cron/observability.js";
import type { AssistantModeGoalRuntimeSummary } from "./assistant-mode-goals.js";
import type { ExternalOutboundDoctorReport } from "./external-outbound-doctor.js";
import type { ExternalOutboundChannel } from "./external-outbound-sender-registry.js";
import type { ResidentAgentDoctorReport } from "./resident-agent-observability.js";
import type { DelegationObservabilitySnapshot } from "./subtask-result-envelope.js";

export const DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE = [
  "feishu",
  "qq",
  "community",
  "discord",
] satisfies ExternalOutboundChannel[];

const ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE_SET = new Set<ExternalOutboundChannel>(
  DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
);

export function parseAssistantExternalDeliveryPreference(value: unknown): ExternalOutboundChannel[] {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => typeof item === "string" ? item.trim().toLowerCase() : "")
      .filter((item): item is ExternalOutboundChannel => ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE_SET.has(item as ExternalOutboundChannel));
    return Array.from(new Set(normalized));
  }
  if (typeof value !== "string") {
    return [...DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE];
  }
  const normalized = value
    .split(/[>,]/g)
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ExternalOutboundChannel => ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE_SET.has(item as ExternalOutboundChannel));
  return normalized.length > 0
    ? Array.from(new Set(normalized))
    : [...DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE];
}

export function formatAssistantExternalDeliveryPreference(channels: ExternalOutboundChannel[] | undefined): string {
  const normalized = parseAssistantExternalDeliveryPreference(channels ?? DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE);
  return normalized.join(",");
}

export type AssistantModeRuntimeStatus = "disabled" | "idle" | "running" | "attention";

export type AssistantModeRecentAction = {
  kind: "heartbeat" | "cron";
  sourceId: string;
  label: string;
  status: "running" | "ran" | "skipped" | "failed";
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  reason?: string;
  conversationId?: string;
  sessionTarget?: "main" | "isolated";
  recommendedTargetId?: string;
  targetType?: "conversation" | "session" | "node" | "goal";
  nextRunAtMs?: number;
  latestRecoveryOutcome?: "succeeded" | "failed" | "throttled" | "skipped_not_eligible";
};

export type AssistantModeNextAction = {
  summary: string;
  targetId?: string;
  targetType?: "conversation" | "session" | "node" | "goal";
  nextRunAtMs?: number;
};

export type AssistantModeAttentionItem = {
  kind: "failed_action" | "cron_invalid_next_run" | "mismatch" | "pending_confirmation" | "long_task_attention" | "goal_attention";
  summary: string;
  targetId?: string;
  targetType?: "conversation" | "session" | "node" | "goal";
};

export type AssistantModeLongTaskSummary = {
  totalCount: number;
  activeCount: number;
  protocolBackedCount: number;
  headline: string;
  primary?: {
    taskId: string;
    agentId: string;
    status: string;
    source?: string;
    aggregationMode?: string;
    intentSummary?: string;
    expectedDeliverableSummary?: string;
  };
};

export type AssistantModeRuntimeReport = {
  available: boolean;
  enabled: boolean;
  status: AssistantModeRuntimeStatus;
  controls: {
    assistantModeEnabled: boolean;
    assistantModeSource: "explicit" | "derived";
    assistantModeMismatch: boolean;
    heartbeatEnabled: boolean;
    heartbeatInterval: string;
    activeHours?: string;
    cronEnabled: boolean;
    starweaverActiveNotifyEnabled: boolean;
    starweaverActiveNotifyPollIntervalMs: number;
  };
  sources: {
    heartbeat: {
      enabled: boolean;
      interval: string;
      activeHours?: string;
      lastStatus?: AssistantModeRecentAction["status"];
      lastSummary?: string;
    };
    cron: {
      enabled: boolean;
      schedulerRunning: boolean;
      activeRuns: number;
      totalJobs: number;
      enabledJobs: number;
      userDeliveryJobs: number;
      lastStatus?: string;
    };
  };
  delivery: {
    residentChannel: true;
    externalDeliveryPreference: ExternalOutboundChannel[];
    confirmationRequired: boolean;
  };
  starweaver?: {
    activeNotifyEnabled: boolean;
    pollIntervalMs: number;
  };
  resident?: {
    totalCount: number;
    activeCount: number;
    runningCount: number;
    idleCount: number;
    errorCount: number;
    headline: string;
    primary?: {
      id: string;
      displayName: string;
      status?: string;
      digestStatus?: string;
      pendingMessageCount?: number;
      observabilityHeadline?: string;
      recommendedTargetId?: string;
      targetType?: "conversation" | "session" | "node" | "goal";
      nextAction?: string;
    };
  };
  longTasks?: AssistantModeLongTaskSummary;
  goals?: AssistantModeGoalRuntimeSummary;
  explanation: {
    nextAction?: AssistantModeNextAction;
    blockedReason?: string;
    attentionReason?: string;
  };
  focus?: {
    summary: string;
    targetId?: string;
    targetType?: "conversation" | "session" | "node" | "goal";
  };
  attentionItems: AssistantModeAttentionItem[];
  recentActions: AssistantModeRecentAction[];
  headline: string;
};

type AssistantModeAttentionCandidate = AssistantModeAttentionItem & {
  priority: number;
};

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function selectPrimaryLongTask(snapshot?: DelegationObservabilitySnapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const rank = (status: string | undefined) => {
    if (status === "running") return 0;
    if (status === "pending") return 1;
    if (status === "error") return 2;
    if (status === "timeout") return 3;
    if (status === "stopped") return 4;
    if (status === "done") return 5;
    return 6;
  };
  return [...items].sort((left, right) => rank(left.status) - rank(right.status))[0];
}

function resolveAssistantModeLongTasks(
  snapshot?: DelegationObservabilitySnapshot,
): AssistantModeLongTaskSummary | undefined {
  if (!snapshot?.summary) {
    return undefined;
  }
  const primary = selectPrimaryLongTask(snapshot);
  return {
    totalCount: snapshot.summary.totalCount,
    activeCount: snapshot.summary.activeCount,
    protocolBackedCount: snapshot.summary.protocolBackedCount,
    headline: snapshot.summary.headline,
    ...(primary
      ? {
        primary: {
          taskId: primary.taskId,
          agentId: primary.agentId,
          status: primary.status,
          ...(normalizeString(primary.source) ? { source: normalizeString(primary.source) } : {}),
          ...(normalizeString(primary.aggregationMode) ? { aggregationMode: normalizeString(primary.aggregationMode) } : {}),
          ...(normalizeString(primary.intentSummary) ? { intentSummary: normalizeString(primary.intentSummary) } : {}),
          ...(normalizeString(primary.expectedDeliverableSummary)
            ? { expectedDeliverableSummary: normalizeString(primary.expectedDeliverableSummary) }
            : {}),
        },
      }
      : {}),
  };
}

function toRecentAction(entry: BackgroundContinuationRuntimeEntry): AssistantModeRecentAction | undefined {
  if (entry.kind !== "heartbeat" && entry.kind !== "cron") {
    return undefined;
  }
  return {
    kind: entry.kind,
    sourceId: entry.sourceId,
    label: entry.label,
    status: entry.status,
    startedAt: entry.startedAt,
    ...(typeof entry.finishedAt === "number" ? { finishedAt: entry.finishedAt } : {}),
    ...(normalizeString(entry.summary) ? { summary: normalizeString(entry.summary) } : {}),
    ...(normalizeString(entry.reason) ? { reason: normalizeString(entry.reason) } : {}),
    ...(normalizeString(entry.conversationId) ? { conversationId: normalizeString(entry.conversationId) } : {}),
    ...(entry.sessionTarget ? { sessionTarget: entry.sessionTarget } : {}),
    ...(normalizeString(entry.continuationState?.recommendedTargetId)
      ? { recommendedTargetId: normalizeString(entry.continuationState?.recommendedTargetId) }
      : {}),
    ...(entry.continuationState?.targetType ? { targetType: entry.continuationState.targetType } : {}),
    ...(typeof entry.nextRunAtMs === "number" ? { nextRunAtMs: entry.nextRunAtMs } : {}),
    ...(entry.latestRecoveryOutcome ? { latestRecoveryOutcome: entry.latestRecoveryOutcome } : {}),
  };
}

function resolveAssistantModeStatus(input: {
  enabled: boolean;
  proactiveActions: AssistantModeRecentAction[];
  cronRuntime?: CronRuntimeDoctorReport;
  longTasks?: AssistantModeLongTaskSummary;
  goals?: AssistantModeGoalRuntimeSummary;
}): AssistantModeRuntimeStatus {
  if (!input.enabled) {
    return "disabled";
  }
  const hasRunningAction = input.proactiveActions.some((item) => item.status === "running");
  if (hasRunningAction || (input.cronRuntime?.scheduler.activeRuns ?? 0) > 0) {
    return "running";
  }
  const hasAttentionSignal = input.proactiveActions.some((item) => item.status === "failed")
    || (input.cronRuntime?.totals.invalidNextRunJobs ?? 0) > 0
    || input.longTasks?.primary?.status === "error"
    || input.longTasks?.primary?.status === "timeout"
    || input.goals?.primary?.status === "blocked"
    || input.goals?.primary?.status === "pending_approval";
  if (hasAttentionSignal) {
    return "attention";
  }
  return "idle";
}

function selectPrimaryResident(report?: ResidentAgentDoctorReport) {
  const agents = Array.isArray(report?.agents) ? report.agents : [];
  const byPriority = (left: any, right: any) => {
    const rank = (item: any) => {
      const status = typeof item?.status === "string" ? item.status.trim() : "";
      if (status === "running") return 0;
      if (status === "background") return 1;
      if (status === "idle") return 2;
      if (status === "error") return 3;
      return 4;
    };
    return rank(left) - rank(right);
  };
  return [...agents].sort(byPriority)[0];
}

function resolveAssistantModeNextAction(input: {
  enabled: boolean;
  heartbeatEnabled: boolean;
  heartbeatInterval: string;
  cronEnabled: boolean;
  proactiveActions: AssistantModeRecentAction[];
  cronRuntime?: CronRuntimeDoctorReport;
}): AssistantModeNextAction | undefined {
  if (!input.enabled) {
    return undefined;
  }
  const runningAction = input.proactiveActions.find((item) => item.status === "running");
  if (runningAction) {
    return {
      summary: `Continue ${runningAction.label || runningAction.sourceId}`,
      ...(runningAction.recommendedTargetId ? { targetId: runningAction.recommendedTargetId } : {}),
      ...(runningAction.targetType ? { targetType: runningAction.targetType } : {}),
    };
  }

  const nextScheduledAction = input.proactiveActions
    .filter((item) => typeof item.nextRunAtMs === "number")
    .sort((a, b) => (a.nextRunAtMs ?? 0) - (b.nextRunAtMs ?? 0))[0];
  if (nextScheduledAction) {
    return {
      summary: `Resume ${nextScheduledAction.label || nextScheduledAction.sourceId}`,
      ...(nextScheduledAction.recommendedTargetId ? { targetId: nextScheduledAction.recommendedTargetId } : {}),
      ...(nextScheduledAction.targetType ? { targetType: nextScheduledAction.targetType } : {}),
      ...(typeof nextScheduledAction.nextRunAtMs === "number" ? { nextRunAtMs: nextScheduledAction.nextRunAtMs } : {}),
    };
  }

  if (input.cronEnabled && (input.cronRuntime?.totals.enabledJobs ?? 0) > 0) {
    return {
      summary: "Wait for the next eligible cron job",
    };
  }
  if (input.heartbeatEnabled) {
    return {
      summary: `Wait for the next heartbeat window (${input.heartbeatInterval})`,
    };
  }
  return undefined;
}

function resolveAssistantModeBlockedReason(input: {
  assistantModeEnabled: boolean;
  assistantModeSource: "explicit" | "derived";
  enabled: boolean;
  status: AssistantModeRuntimeStatus;
  proactiveActions: AssistantModeRecentAction[];
  cronEnabled: boolean;
  cronRuntime?: CronRuntimeDoctorReport;
}): string | undefined {
  if (!input.assistantModeEnabled && input.assistantModeSource === "explicit") {
    return "assistant mode master toggle is off";
  }
  if (input.assistantModeEnabled && !input.enabled) {
    return "assistant mode is enabled, but heartbeat and cron are both off";
  }
  const skippedAction = input.proactiveActions.find((item) => item.status === "skipped" && normalizeString(item.reason));
  if (skippedAction?.reason) {
    return skippedAction.reason;
  }
  if (input.status === "idle" && input.cronEnabled && input.cronRuntime?.scheduler.enabled && !input.cronRuntime?.scheduler.running) {
    return "cron scheduler is enabled but not currently running";
  }
  if (input.status === "idle") {
    return "waiting for the next eligible heartbeat or cron run";
  }
  return undefined;
}

function resolveAssistantModeAttentionReason(input: {
  assistantModeMismatch: boolean;
  proactiveActions: AssistantModeRecentAction[];
  cronRuntime?: CronRuntimeDoctorReport;
  longTasks?: AssistantModeLongTaskSummary;
  goals?: AssistantModeGoalRuntimeSummary;
}): string | undefined {
  const failedAction = input.proactiveActions.find((item) => item.status === "failed");
  if (failedAction?.reason) {
    return `${failedAction.label || failedAction.sourceId}: ${failedAction.reason}`;
  }
  if (failedAction?.summary) {
    return `${failedAction.label || failedAction.sourceId}: ${failedAction.summary}`;
  }
  const invalidNextRunJobs = input.cronRuntime?.totals.invalidNextRunJobs ?? 0;
  if (invalidNextRunJobs > 0) {
    return `${invalidNextRunJobs} enabled cron job(s) currently have no nextRunAtMs`;
  }
  if (input.assistantModeMismatch) {
    return "assistant mode master toggle and heartbeat/cron drivers are mismatched";
  }
  const longTask = input.longTasks?.primary;
  if (longTask && (longTask.status === "error" || longTask.status === "timeout")) {
    return `${longTask.intentSummary || longTask.taskId}: ${longTask.status}`;
  }
  const goal = input.goals?.primary;
  if (goal && goal.status === "blocked") {
    return `${goal.title}: ${goal.blockerSummary || "blocked"}`;
  }
  if (goal && goal.status === "pending_approval") {
    return `${goal.title}: ${goal.checkpointSummary || "waiting for approval"}`;
  }
  return undefined;
}

function resolveAssistantModeFocus(input: {
  nextAction?: AssistantModeNextAction;
  resident?: ResidentAgentDoctorReport;
  proactiveActions: AssistantModeRecentAction[];
  longTasks?: AssistantModeLongTaskSummary;
  goals?: AssistantModeGoalRuntimeSummary;
}): AssistantModeRuntimeReport["focus"] | undefined {
  const runningAction = input.proactiveActions.find((item) => item.status === "running");
  if (runningAction) {
    return {
      summary: runningAction.summary || runningAction.label || runningAction.sourceId,
      ...(normalizeString(runningAction.recommendedTargetId)
        ? { targetId: normalizeString(runningAction.recommendedTargetId) }
        : {}),
      ...(runningAction.targetType ? { targetType: runningAction.targetType } : {}),
    };
  }
  if (input.longTasks?.primary && (input.longTasks.primary.status === "error" || input.longTasks.primary.status === "timeout")) {
    const primary = input.longTasks.primary;
    const parts = [
      primary.intentSummary || `Subtask ${primary.taskId}`,
      primary.status ? `status=${primary.status}` : "",
      primary.expectedDeliverableSummary ? `deliverable=${primary.expectedDeliverableSummary}` : "",
    ].filter(Boolean);
    return {
      summary: parts.join(", "),
    };
  }
  if (input.goals?.primary && (input.goals.primary.status === "blocked" || input.goals.primary.status === "pending_approval")) {
    const primary = input.goals.primary;
    const parts = [
      primary.nextAction || primary.blockerSummary || primary.checkpointSummary || primary.summary || primary.title,
      primary.status ? `status=${primary.status}` : "",
    ].filter(Boolean);
    return {
      summary: parts.join(", "),
      ...(primary.targetId ? { targetId: primary.targetId } : {}),
      ...(primary.targetType ? { targetType: primary.targetType } : {}),
    };
  }
  const primaryResident = selectPrimaryResident(input.resident);
  if (primaryResident) {
    const summary = normalizeString(primaryResident.continuationState?.nextAction)
      || normalizeString(primaryResident.observabilityHeadline)
      || `Follow ${primaryResident.displayName}`;
    if (summary) {
      return {
        summary,
        ...(normalizeString(primaryResident.continuationState?.recommendedTargetId)
          ? { targetId: normalizeString(primaryResident.continuationState?.recommendedTargetId) }
          : {}),
        ...(primaryResident.continuationState?.targetType
          ? { targetType: primaryResident.continuationState.targetType }
          : {}),
      };
    }
  }
  const targetAction = input.proactiveActions.find((item) => normalizeString(item.recommendedTargetId));
  if (targetAction) {
    return {
      summary: targetAction.summary || targetAction.label || targetAction.sourceId,
      ...(normalizeString(targetAction.recommendedTargetId)
        ? { targetId: normalizeString(targetAction.recommendedTargetId) }
        : {}),
      ...(targetAction.targetType ? { targetType: targetAction.targetType } : {}),
    };
  }
  if (input.nextAction?.summary) {
    return {
      summary: input.nextAction.summary,
      ...(input.nextAction.targetId ? { targetId: input.nextAction.targetId } : {}),
      ...(input.nextAction.targetType ? { targetType: input.nextAction.targetType } : {}),
    };
  }
  if (input.longTasks?.primary) {
    const primary = input.longTasks.primary;
    const parts = [
      primary.intentSummary || `Subtask ${primary.taskId}`,
      primary.status ? `status=${primary.status}` : "",
      primary.expectedDeliverableSummary ? `deliverable=${primary.expectedDeliverableSummary}` : "",
    ].filter(Boolean);
    return {
      summary: parts.join(", "),
    };
  }
  if (input.goals?.primary) {
    const primary = input.goals.primary;
    const parts = [
      primary.nextAction || primary.summary || primary.title,
      primary.status ? `status=${primary.status}` : "",
    ].filter(Boolean);
    return {
      summary: parts.join(", "),
      ...(primary.targetId ? { targetId: primary.targetId } : {}),
      ...(primary.targetType ? { targetType: primary.targetType } : {}),
    };
  }
  return undefined;
}

function resolveAssistantModeAttentionItems(input: {
  assistantModeMismatch: boolean;
  proactiveActions: AssistantModeRecentAction[];
  cronRuntime?: CronRuntimeDoctorReport;
  externalOutboundRuntime?: ExternalOutboundDoctorReport;
  longTasks?: AssistantModeLongTaskSummary;
  goals?: AssistantModeGoalRuntimeSummary;
}): AssistantModeAttentionItem[] {
  const candidates: AssistantModeAttentionCandidate[] = [];
  const failedAction = input.proactiveActions.find((item) => item.status === "failed");
  if (failedAction) {
    candidates.push({
      priority: 30,
      kind: "failed_action",
      summary: `${failedAction.label || failedAction.sourceId}: ${failedAction.reason || failedAction.summary || "failed"}`,
      ...(normalizeString(failedAction.recommendedTargetId)
        ? { targetId: normalizeString(failedAction.recommendedTargetId) }
        : {}),
      ...(failedAction.targetType ? { targetType: failedAction.targetType } : {}),
    });
  }
  const invalidNextRunJobs = input.cronRuntime?.totals.invalidNextRunJobs ?? 0;
  if (invalidNextRunJobs > 0) {
    candidates.push({
      priority: 40,
      kind: "cron_invalid_next_run",
      summary: `${invalidNextRunJobs} enabled cron job(s) currently have no nextRunAtMs`,
    });
  }
  const pendingConfirmationCount = input.externalOutboundRuntime?.totals.pendingConfirmationCount ?? 0;
  if (pendingConfirmationCount > 0) {
    const pending = input.externalOutboundRuntime?.recentPending?.[0];
    const summary = pending
      ? `${pendingConfirmationCount} outbound confirmation(s) pending; latest ${pending.targetChannel} request ${pending.requestId}`
      : `${pendingConfirmationCount} outbound confirmation(s) pending`;
    candidates.push({
      priority: 10,
      kind: "pending_confirmation",
      summary,
      ...(normalizeString(pending?.conversationId) ? { targetId: normalizeString(pending?.conversationId) } : {}),
      ...(normalizeString(pending?.conversationId) ? { targetType: "conversation" as const } : {}),
    });
  }
  const longTask = input.longTasks?.primary;
  if (longTask && (longTask.status === "error" || longTask.status === "timeout")) {
    candidates.push({
      priority: 20,
      kind: "long_task_attention",
      summary: `${longTask.intentSummary || longTask.taskId}: ${longTask.status}${longTask.expectedDeliverableSummary ? `, deliverable=${longTask.expectedDeliverableSummary}` : ""}`,
    });
  }
  const goal = input.goals?.primary;
  if (goal && goal.status === "blocked") {
    candidates.push({
      priority: 15,
      kind: "goal_attention",
      summary: `${goal.title}: ${goal.blockerSummary || "blocked"}`,
      ...(goal.targetId ? { targetId: goal.targetId } : {}),
      ...(goal.targetType ? { targetType: goal.targetType } : {}),
    });
  } else if (goal && goal.status === "pending_approval") {
    candidates.push({
      priority: 15,
      kind: "goal_attention",
      summary: `${goal.title}: ${goal.checkpointSummary || "waiting for approval"}`,
      ...(goal.targetId ? { targetId: goal.targetId } : {}),
      ...(goal.targetType ? { targetType: goal.targetType } : {}),
    });
  }
  const deduped = new Map<string, AssistantModeAttentionCandidate>();
  for (const item of candidates.sort((left, right) => left.priority - right.priority)) {
    const key = [
      item.kind,
      item.summary,
      item.targetType || "",
      item.targetId || "",
    ].join("|");
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }
  return Array.from(deduped.values()).slice(0, 4).map(({ priority: _priority, ...item }) => item);
}

export function buildAssistantModeRuntimeReport(input: {
  assistantModeEnabled?: boolean;
  assistantModeConfigured?: boolean;
  heartbeatEnabled: boolean;
  heartbeatInterval?: string;
  heartbeatActiveHours?: string;
  cronEnabled: boolean;
  cronRuntime?: CronRuntimeDoctorReport;
  backgroundContinuationRuntime?: BackgroundContinuationRuntimeDoctorReport;
  externalOutboundRuntime?: ExternalOutboundDoctorReport;
  residentAgents?: ResidentAgentDoctorReport;
  delegationObservability?: DelegationObservabilitySnapshot;
  goals?: AssistantModeGoalRuntimeSummary;
  externalOutboundRequireConfirmation: boolean;
  externalDeliveryPreference?: ExternalOutboundChannel[];
  recentActionLimit?: number;
  starweaverActiveNotifyEnabled?: boolean;
  starweaverActiveNotifyPollIntervalMs?: number;
}): AssistantModeRuntimeReport {
  const heartbeatInterval = normalizeString(input.heartbeatInterval) ?? "30m";
  const activeHours = normalizeString(input.heartbeatActiveHours);
  const proactiveActions = (input.backgroundContinuationRuntime?.recentEntries ?? [])
    .map((entry) => toRecentAction(entry))
    .filter((item): item is AssistantModeRecentAction => Boolean(item));
  const recentActions = proactiveActions.slice(0, Math.max(1, input.recentActionLimit ?? 6));
  const heartbeatLastAction = proactiveActions.find((item) => item.kind === "heartbeat");
  const cronLastAction = proactiveActions.find((item) => item.kind === "cron");
  const enabled = input.heartbeatEnabled || input.cronEnabled;
  const assistantModeSource = input.assistantModeConfigured === true ? "explicit" : "derived";
  const assistantModeEnabled = assistantModeSource === "explicit"
    ? input.assistantModeEnabled === true
    : enabled;
  const assistantModeMismatch = assistantModeSource === "explicit" && assistantModeEnabled !== enabled;
  const confirmationRequired = input.externalOutboundRuntime?.requireConfirmation ?? input.externalOutboundRequireConfirmation;
  const starweaverActiveNotifyEnabled = input.starweaverActiveNotifyEnabled === true;
  const starweaverActiveNotifyPollIntervalMs =
    Number.isFinite(input.starweaverActiveNotifyPollIntervalMs)
      ? Math.max(1000, Number(input.starweaverActiveNotifyPollIntervalMs))
      : 5000;
  const externalDeliveryPreference = parseAssistantExternalDeliveryPreference(
    input.externalDeliveryPreference ?? DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
  );
  const longTasks = resolveAssistantModeLongTasks(input.delegationObservability);
  const status = resolveAssistantModeStatus({
    enabled,
    proactiveActions,
    cronRuntime: input.cronRuntime,
    longTasks,
    goals: input.goals,
  });

  const headline = [
    `mode=${assistantModeEnabled ? "on" : "off"}(${assistantModeSource}${assistantModeMismatch ? ",mismatch" : ""})`,
    enabled ? "enabled" : "disabled",
    `status=${status}`,
    `heartbeat=${input.heartbeatEnabled ? "on" : "off"}`,
    input.heartbeatEnabled ? `interval=${heartbeatInterval}` : "",
    `activeHours=${activeHours ?? "all"}`,
    `cron=${input.cronEnabled ? "on" : "off"}`,
    `jobs=${input.cronRuntime?.totals.enabledJobs ?? 0}/${input.cronRuntime?.totals.totalJobs ?? 0}`,
    `recent=${recentActions.length}`,
    `notify=resident+${externalDeliveryPreference.join(">")}`,
    `confirm=${confirmationRequired ? "required" : "disabled"}`,
  ].filter(Boolean).join("; ");
  const nextAction = resolveAssistantModeNextAction({
    enabled,
    heartbeatEnabled: input.heartbeatEnabled,
    heartbeatInterval,
    cronEnabled: input.cronEnabled,
    proactiveActions,
    cronRuntime: input.cronRuntime,
  });
  const blockedReason = resolveAssistantModeBlockedReason({
    assistantModeEnabled,
    assistantModeSource,
    enabled,
    status,
    proactiveActions,
    cronEnabled: input.cronEnabled,
    cronRuntime: input.cronRuntime,
  });
  const attentionReason = resolveAssistantModeAttentionReason({
    assistantModeMismatch,
    proactiveActions,
    cronRuntime: input.cronRuntime,
    longTasks,
    goals: input.goals,
  });
  const focus = resolveAssistantModeFocus({
    nextAction,
    resident: input.residentAgents,
    proactiveActions,
    longTasks,
    goals: input.goals,
  });
  const attentionItems = resolveAssistantModeAttentionItems({
    assistantModeMismatch,
    proactiveActions,
    cronRuntime: input.cronRuntime,
    externalOutboundRuntime: input.externalOutboundRuntime,
    longTasks,
    goals: input.goals,
  });
  const primaryResident = selectPrimaryResident(input.residentAgents);

  return {
    available: true,
    enabled,
    status,
    controls: {
      assistantModeEnabled,
      assistantModeSource,
      assistantModeMismatch,
      heartbeatEnabled: input.heartbeatEnabled,
      heartbeatInterval,
      ...(activeHours ? { activeHours } : {}),
      cronEnabled: input.cronEnabled,
      starweaverActiveNotifyEnabled,
      starweaverActiveNotifyPollIntervalMs,
    },
    sources: {
      heartbeat: {
        enabled: input.heartbeatEnabled,
        interval: heartbeatInterval,
        ...(activeHours ? { activeHours } : {}),
        ...(heartbeatLastAction?.status ? { lastStatus: heartbeatLastAction.status } : {}),
        ...(heartbeatLastAction?.summary ? { lastSummary: heartbeatLastAction.summary } : {}),
      },
      cron: {
        enabled: input.cronEnabled,
        schedulerRunning: input.cronRuntime?.scheduler.running === true,
        activeRuns: input.cronRuntime?.scheduler.activeRuns ?? 0,
        totalJobs: input.cronRuntime?.totals.totalJobs ?? 0,
        enabledJobs: input.cronRuntime?.totals.enabledJobs ?? 0,
        userDeliveryJobs: input.cronRuntime?.deliveryModeCounts.user ?? 0,
        ...(cronLastAction?.status
          ? { lastStatus: cronLastAction.status }
          : normalizeString(input.cronRuntime?.recentJobs[0]?.lastStatus)
            ? { lastStatus: normalizeString(input.cronRuntime?.recentJobs[0]?.lastStatus) }
            : {}),
      },
    },
    delivery: {
      residentChannel: true,
      externalDeliveryPreference,
      confirmationRequired,
    },
    starweaver: {
      activeNotifyEnabled: starweaverActiveNotifyEnabled,
      pollIntervalMs: starweaverActiveNotifyPollIntervalMs,
    },
    ...(input.residentAgents?.summary
      ? {
        resident: {
          totalCount: input.residentAgents.summary.totalCount,
          activeCount: input.residentAgents.summary.activeCount,
          runningCount: input.residentAgents.summary.runningCount,
          idleCount: input.residentAgents.summary.idleCount,
          errorCount: input.residentAgents.summary.errorCount,
          headline: input.residentAgents.summary.headline,
          ...(primaryResident
            ? {
              primary: {
                id: primaryResident.id,
                displayName: primaryResident.displayName,
                ...(normalizeString(primaryResident.status) ? { status: normalizeString(primaryResident.status) } : {}),
                ...(normalizeString(primaryResident.conversationDigest?.status)
                  ? { digestStatus: normalizeString(primaryResident.conversationDigest?.status) }
                  : {}),
                ...(typeof primaryResident.conversationDigest?.pendingMessageCount === "number"
                  ? { pendingMessageCount: primaryResident.conversationDigest.pendingMessageCount }
                  : {}),
                ...(normalizeString(primaryResident.observabilityHeadline)
                  ? { observabilityHeadline: normalizeString(primaryResident.observabilityHeadline) }
                  : {}),
                ...(normalizeString(primaryResident.continuationState?.recommendedTargetId)
                  ? { recommendedTargetId: normalizeString(primaryResident.continuationState?.recommendedTargetId) }
                  : {}),
                ...(primaryResident.continuationState?.targetType
                  ? { targetType: primaryResident.continuationState.targetType }
                  : {}),
                ...(normalizeString(primaryResident.continuationState?.nextAction)
                  ? { nextAction: normalizeString(primaryResident.continuationState?.nextAction) }
                  : {}),
              },
            }
            : {}),
        },
      }
      : {}),
    ...(longTasks ? { longTasks } : {}),
    ...(input.goals ? { goals: input.goals } : {}),
    explanation: {
      ...(nextAction ? { nextAction } : {}),
      ...(blockedReason ? { blockedReason } : {}),
      ...(attentionReason ? { attentionReason } : {}),
    },
    ...(focus ? { focus } : {}),
    attentionItems,
    recentActions,
    headline,
  };
}
