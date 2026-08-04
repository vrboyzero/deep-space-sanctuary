import type { GoalCheckpointReplayDescriptor, GoalHandoffSnapshot } from "./goals/types.js";
import { getSubTaskBridgeProjection } from "./subtask-bridge-view.js";
import type { SubTaskRecord } from "./task-runtime.js";

export type ContinuationTargetType = "conversation" | "session" | "node" | "goal";

export type ContinuationReplaySnapshot = {
  kind: "goal_checkpoint";
  checkpointId: string;
  nodeId: string;
  runId?: string;
  title: string;
  summary?: string;
  reason: string;
};

export type ContinuationStateSnapshot = {
  version: 1;
  scope: "subtask" | "goal" | "conversation" | "resident" | "background";
  targetId: string;
  recommendedTargetId?: string;
  targetType?: ContinuationTargetType;
  resumeMode: string;
  summary: string;
  nextAction: string;
  replay?: ContinuationReplaySnapshot;
  checkpoints: {
    openCount: number;
    blockerCount: number;
    labels: string[];
  };
  progress: {
    current?: string;
    recent: string[];
  };
};

function buildGoalCheckpointReplay(
  replay: GoalCheckpointReplayDescriptor | undefined,
): ContinuationReplaySnapshot | undefined {
  if (!replay?.checkpointId || !replay?.nodeId) return undefined;
  return {
    kind: "goal_checkpoint",
    checkpointId: replay.checkpointId,
    nodeId: replay.nodeId,
    runId: replay.runId,
    title: replay.title,
    summary: replay.summary,
    reason: replay.reason,
  };
}

export type ConversationContinuationStateInput = {
  conversationId: string;
  messages: Array<{
    role?: string;
    content?: string;
    timestampMs?: number;
  }>;
  loadedDeferredTools?: string[];
  compactBoundaries?: Array<{
    at?: number;
    createdAt?: number;
  }>;
  taskTokenResults?: Array<{
    name?: string;
    totalTokens?: number;
    createdAt?: number | string;
  }>;
  sessionDigest?: {
    status?: string;
    rollingSummary?: string;
  };
  sessionMemory?: {
    summary?: string;
    currentWork?: string;
    nextStep?: string;
    pendingTasks?: string[];
  };
  resumeContext?: {
    currentStopPoint?: string;
    nextStep?: string;
    blockers?: string[];
  };
};

export type ResidentContinuationStateInput = {
  agentId: string;
  status?: string;
  mainConversationId?: string;
  lastConversationId?: string;
  lastActiveAt?: number;
  sharedGovernance?: {
    pendingCount?: number;
    claimedCount?: number;
  };
  recentTaskDigest?: {
    recentCount?: number;
    latestTaskId?: string;
    latestTitle?: string;
    latestStatus?: string;
    latestFinishedAt?: string;
    headline?: string;
  };
  recentSubtaskDigest?: {
    recentCount?: number;
    latestTaskId?: string;
    latestSummary?: string;
    latestStatus?: string;
    latestUpdatedAt?: number;
    headline?: string;
  };
  experienceUsageDigest?: {
    usageCount?: number;
    latestAssetKey?: string;
    latestUsedAt?: string;
    headline?: string;
  };
};

export type BackgroundContinuationStateInput = {
  scope: "cron" | "heartbeat";
  targetId: string;
  targetLabel?: string;
  status: "running" | "ran" | "skipped" | "failed";
  summary?: string;
  reason?: string;
  conversationId?: string;
  sessionTarget?: "main" | "isolated";
  nextRunAtMs?: number;
  startedAt?: number;
  finishedAt?: number;
};

function toTimestamp(value: number | string | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function compactStrings(values: Array<string | undefined>, max = 4): string[] {
  return values
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function summarizeText(value: string | undefined, max = 140): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function getLatestTakeoverRecord(record: SubTaskRecord) {
  if (!Array.isArray(record.takeover) || record.takeover.length === 0) return null;
  return record.takeover[record.takeover.length - 1] ?? null;
}

function buildSubTaskNextAction(record: SubTaskRecord): string {
  const latestTakeover = getLatestTakeoverRecord(record);
  if (record.archivedAt) {
    return "Inspect the archived output before deciding whether to relaunch this task.";
  }
  switch (record.status) {
    case "running":
      if (latestTakeover && latestTakeover.mode === "safe_point") {
        return "Observe the safe-point takeover relaunch and inspect the new agent session before sending more steering.";
      }
      return "Observe the current run or send steering if the task needs correction.";
    case "done":
      if (latestTakeover) {
        return "Inspect the latest takeover result and relaunch again only if more follow-up work is still needed.";
      }
      return "Resume this task if follow-up work is still needed.";
    case "error":
    case "timeout":
    case "stopped":
    case "interrupted":
      if (latestTakeover) {
        return "Inspect the latest takeover failure details before deciding whether to relaunch this task again.";
      }
      return "Resume this task from the last recorded state or inspect the failure details first.";
    default:
      return "Wait for the task to start or relaunch it with updated guidance.";
  }
}

function resolveSubTaskResumeMode(record: SubTaskRecord): string {
  if (record.archivedAt) return "archived";
  const latestTakeover = getLatestTakeoverRecord(record);
  if (record.status === "running" && latestTakeover?.mode === "safe_point") return "safe_point_takeover";
  if (record.status === "running") return "live";
  if (latestTakeover) return latestTakeover.mode === "safe_point" ? "safe_point_takeover" : "agent_takeover";
  if (Array.isArray(record.resume) && record.resume.length > 0) return "same_task_relaunch";
  if (record.status === "done") return "rerun";
  return "recovery";
}

export function buildSubTaskContinuationState(record: SubTaskRecord): ContinuationStateSnapshot {
  const bridgeProjection = getSubTaskBridgeProjection(record);
  const bridgeSummary = bridgeProjection.bridgeSubtaskView?.summaryLine || bridgeProjection.bridgeSessionView?.summaryLine;
  const recent = compactStrings(
    (record.notifications ?? [])
      .slice(-3)
      .reverse()
      .map((item) => item.message),
    3,
  );
  const blockerLabels = record.status === "error" || record.status === "timeout"
    || record.status === "stopped" || record.status === "interrupted"
    ? compactStrings([
        record.bridgeSessionRuntime?.blockReason,
        record.error,
        record.stopReason,
        record.progress?.message,
      ], 2)
    : [];

  return {
    version: 1,
    scope: "subtask",
    targetId: record.id,
    recommendedTargetId: record.sessionId || record.parentConversationId || undefined,
    targetType: record.sessionId ? "session" : record.parentConversationId ? "conversation" : undefined,
    resumeMode: resolveSubTaskResumeMode(record),
    summary: String(record.summary || bridgeSummary || record.outputPreview || record.error || record.instruction || "").trim(),
    nextAction: buildSubTaskNextAction(record),
    checkpoints: {
      openCount: 0,
      blockerCount: blockerLabels.length,
      labels: blockerLabels,
    },
    progress: {
      current: record.progress?.message || bridgeSummary,
      recent,
    },
  };
}

export function buildGoalContinuationState(handoff: GoalHandoffSnapshot): ContinuationStateSnapshot {
  const recommendedTargetId = handoff.recommendedNodeId || handoff.activeConversationId || handoff.goalId;
  const targetType = handoff.recommendedNodeId
    ? "node"
    : handoff.activeConversationId
      ? "conversation"
      : "goal";
  const bridgeLabels = compactStrings(
    (handoff.bridgeGovernance?.items ?? []).flatMap((item) => [
      item.blockReason,
      item.summaryLines?.[0],
    ]),
    2,
  );
  return {
    version: 1,
    scope: "goal",
    targetId: handoff.goalId,
    recommendedTargetId,
    targetType,
    resumeMode: handoff.resumeMode,
    summary: handoff.summary,
    nextAction: handoff.nextAction,
    replay: buildGoalCheckpointReplay(handoff.checkpointReplay),
    checkpoints: {
      openCount: handoff.tracking.openCheckpointCount,
      blockerCount: handoff.blockers.length,
      labels: compactStrings([
        ...handoff.openCheckpoints.map((item) => item.title),
        ...handoff.blockers.map((item) => item.title),
        ...bridgeLabels,
      ]),
    },
    progress: {
      current: handoff.currentPhase || bridgeLabels[0],
      recent: compactStrings(
        [
          ...handoff.recentProgress.map((entry) => entry.summary || entry.note || entry.title),
          ...bridgeLabels,
        ],
        3,
      ),
    },
  };
}

export function buildConversationContinuationState(input: ConversationContinuationStateInput): ContinuationStateSnapshot {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const latestMessage = messages
    .slice()
    .sort((left, right) => Number(right.timestampMs || 0) - Number(left.timestampMs || 0))[0];
  const loadedDeferredTools = compactStrings(input.loadedDeferredTools ?? [], 4);
  const compactBoundaries = Array.isArray(input.compactBoundaries) ? input.compactBoundaries : [];
  const taskTokenResults = Array.isArray(input.taskTokenResults) ? input.taskTokenResults : [];
  const lastTaskToken = taskTokenResults
    .slice()
    .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt))[0];
  const sessionSummary = summarizeText(input.sessionMemory?.summary || input.sessionDigest?.rollingSummary, 180);
  const resumeStopPoint = summarizeText(input.resumeContext?.currentStopPoint, 180);
  const sessionCurrentWork = summarizeText(input.sessionMemory?.currentWork, 180);
  const currentWork = resumeStopPoint || sessionCurrentWork;
  const resumeNextStep = summarizeText(input.resumeContext?.nextStep, 180);
  const sessionNextStep = summarizeText(input.sessionMemory?.nextStep, 180);
  const blockerLabels = compactStrings(input.resumeContext?.blockers ?? [], 2);
  const recentMessages = messages
    .slice(-3)
    .reverse()
    .map((item) => {
      const role = String(item.role || "message").trim();
      const content = summarizeText(item.content, 96);
      return content ? `${role}: ${content}` : "";
    });
  const summary = currentWork
    || sessionSummary
    || summarizeText(latestMessage?.content, 180)
    || (messages.length > 0 ? `Conversation has ${messages.length} persisted message(s).` : "No persisted messages yet.");
  const nextAction = resumeNextStep
    || sessionNextStep
    || (loadedDeferredTools.length > 0
      ? "Continue in this conversation and only reuse already loaded tools if they are still relevant."
      : "Continue in this conversation or refresh the digest before resuming a longer thread.");

  return {
    version: 1,
    scope: "conversation",
    targetId: input.conversationId,
    recommendedTargetId: input.conversationId,
    targetType: "conversation",
    resumeMode: loadedDeferredTools.length > 0 ? "conversation_context" : "conversation_thread",
    summary,
    nextAction,
    checkpoints: {
      openCount: compactBoundaries.length,
      blockerCount: blockerLabels.length,
      labels: compactStrings([
        ...loadedDeferredTools.map((item) => `tool:${item}`),
        compactBoundaries.length > 0 ? `compact:${compactBoundaries.length}` : "",
        lastTaskToken?.name ? `task:${lastTaskToken.name}` : "",
        ...blockerLabels,
      ], 4),
    },
    progress: {
      current: currentWork || (messages.length > 0 ? `${messages.length} messages` : "No active transcript yet"),
      recent: compactStrings(recentMessages, 3),
    },
  };
}

export function buildResidentContinuationState(input: ResidentContinuationStateInput): ContinuationStateSnapshot {
  const pendingReviewCount = Number(input.sharedGovernance?.pendingCount || 0);
  const recentTaskHeadline = summarizeText(input.recentTaskDigest?.headline || input.recentTaskDigest?.latestTitle, 96);
  const recentSubtaskHeadline = summarizeText(input.recentSubtaskDigest?.headline || input.recentSubtaskDigest?.latestSummary, 96);
  const usageHeadline = summarizeText(input.experienceUsageDigest?.headline || input.experienceUsageDigest?.latestAssetKey, 96);
  const recommendedConversationId = input.mainConversationId || input.lastConversationId;

  let resumeMode = "resident_idle";
  let summary = "Resident agent is ready for the next main-conversation turn.";
  let nextAction = "Open the resident main conversation and continue from the latest scoped context.";
  if (pendingReviewCount > 0) {
    resumeMode = "resident_review";
    summary = `Resident agent has ${pendingReviewCount} pending shared-review item(s) that may need attention first.`;
    nextAction = "Inspect the resident review queue first, then return to the main conversation if needed.";
  } else if (input.status === "running" || input.status === "background") {
    resumeMode = "resident_main";
    summary = recentSubtaskHeadline || recentTaskHeadline || "Resident agent is already active on its main conversation context.";
    nextAction = "Return to the resident conversation and continue from the current active context.";
  } else if (recentSubtaskHeadline) {
    resumeMode = "resident_followup";
    summary = recentSubtaskHeadline;
    nextAction = "Inspect the latest resident-linked subtask result, then continue in the main conversation.";
  } else if (recentTaskHeadline) {
    resumeMode = "resident_task_followup";
    summary = recentTaskHeadline;
    nextAction = "Reopen the latest resident-linked long task or continue in the main conversation.";
  }

  return {
    version: 1,
    scope: "resident",
    targetId: input.agentId,
    recommendedTargetId: recommendedConversationId,
    targetType: recommendedConversationId ? "conversation" : undefined,
    resumeMode,
    summary,
    nextAction,
    checkpoints: {
      openCount: pendingReviewCount,
      blockerCount: input.status === "error" ? 1 : 0,
      labels: compactStrings([
        pendingReviewCount > 0 ? `review:${pendingReviewCount}` : "",
        recentTaskHeadline,
        recentSubtaskHeadline,
        usageHeadline,
      ], 4),
    },
    progress: {
      current: input.status || "idle",
      recent: compactStrings([
        recentTaskHeadline,
        recentSubtaskHeadline,
        usageHeadline,
      ], 3),
    },
  };
}

export function buildBackgroundContinuationState(input: BackgroundContinuationStateInput): ContinuationStateSnapshot {
  const label = summarizeText(input.targetLabel || input.targetId, 72) || input.scope;
  const summary = summarizeText(input.summary, 180)
    || summarizeText(input.reason, 180)
    || `${label} background run is ${input.status}.`;
  const recent = compactStrings([
    input.summary,
    input.reason,
    typeof input.nextRunAtMs === "number" ? `next:${new Date(input.nextRunAtMs).toISOString()}` : undefined,
  ], 3);

  let resumeMode = `${input.scope}_runtime`;
  let nextAction = "Inspect the background runtime summary before deciding whether to rerun it.";
  if (input.status === "running") {
    resumeMode = `${input.scope}_live`;
    nextAction = input.conversationId
      ? "Open the linked conversation to observe the active background run."
      : "Wait for the active background run to finish or inspect the runtime summary.";
  } else if (input.conversationId) {
    resumeMode = input.sessionTarget === "main" ? `${input.scope}_main_conversation` : `${input.scope}_conversation`;
    nextAction = "Open the linked conversation or prompt snapshot to continue from the latest background result.";
  } else if (input.status === "failed") {
    resumeMode = `${input.scope}_recovery`;
    nextAction = "Inspect the failure reason, then retry from the runtime summary or schedule surface.";
  }

  const blockerLabels = input.status === "failed"
    ? compactStrings([input.reason || summary], 1)
    : [];

  return {
    version: 1,
    scope: "background",
    targetId: input.targetId,
    recommendedTargetId: input.conversationId,
    targetType: input.conversationId ? "conversation" : undefined,
    resumeMode,
    summary,
    nextAction,
    checkpoints: {
      openCount: input.status === "running" ? 1 : 0,
      blockerCount: blockerLabels.length,
      labels: compactStrings([
        `scope:${input.scope}`,
        input.sessionTarget ? `session:${input.sessionTarget}` : undefined,
        ...blockerLabels,
      ], 3),
    },
    progress: {
      current: `${input.scope}:${input.status}`,
      recent,
    },
  };
}
