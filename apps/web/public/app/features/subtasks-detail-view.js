import { buildLaunchExplainabilityLines } from "./agent-launch-explainability.js";
import {
  buildContinuationAction,
  encodeContinuationAction,
  formatContinuationTargetLabel,
} from "./continuation-targets.js";
import { createPromptSnapshotDetailView } from "./prompt-snapshot-detail.js";

function text(value) {
  return String(value ?? "");
}

function createElement(ownerDocument, tagName, className = "", value) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = text(value);
  return element;
}

function createDetailCard(ownerDocument, label, value, className = "") {
  const card = createElement(ownerDocument, "div", `memory-detail-card${className ? ` ${className}` : ""}`);
  card.append(
    createElement(ownerDocument, "span", "memory-detail-label", label),
    createElement(ownerDocument, "div", "memory-detail-text", value || "-"),
  );
  return card;
}

function createPreCard(ownerDocument, label, value) {
  const card = createElement(ownerDocument, "section", "memory-detail-card");
  card.append(
    createElement(ownerDocument, "span", "memory-detail-label", label),
    createElement(ownerDocument, "pre", "memory-detail-pre", value || "-"),
  );
  return card;
}

function createMeta(ownerDocument, values) {
  const meta = createElement(ownerDocument, "div", "memory-list-item-meta");
  meta.append(...values.map((value) => createElement(ownerDocument, "span", "", value)));
  return meta;
}

function createExplainabilityNote(ownerDocument, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const note = createElement(ownerDocument, "div", "tool-settings-policy-note");
  note.append(...lines.map((line) => createElement(ownerDocument, "div", "", line)));
  return note;
}

function createButton(ownerDocument, className, label, attributeName, attributeValue, disabled = false) {
  const button = createElement(ownerDocument, "button", className, label);
  button.type = "button";
  if (attributeName) button.setAttribute(attributeName, text(attributeValue));
  button.disabled = disabled;
  return button;
}

function appendDetailGrid(ownerDocument, section, cards) {
  const grid = createElement(ownerDocument, "div", "memory-detail-grid");
  grid.append(...cards);
  section.append(grid);
  return grid;
}

export function formatSubtaskStatus(status) {
  switch (status) {
    case "running":
      return "运行中";
    case "done":
      return "已完成";
    case "error":
      return "失败";
    case "timeout":
      return "超时";
    case "stopped":
      return "已停止";
    default:
      return "等待中";
  }
}

export function getStatusToneClass(status) {
  switch (status) {
    case "running":
      return "is-running";
    case "done":
      return "is-done";
    case "error":
      return "is-error";
    case "timeout":
      return "is-timeout";
    case "stopped":
      return "is-stopped";
    default:
      return "is-pending";
  }
}

function formatLaunchTimeout(timeoutMs) {
  const value = Number(timeoutMs);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value % 1000 === 0) {
    return `${Math.round(value / 1000)}s`;
  }
  return `${value}ms`;
}

function formatWorktreeRuntimeStatus(status, t) {
  switch (status) {
    case "created":
      return t("subtasks.worktreeStatusCreated", {}, "created");
    case "missing":
      return t("subtasks.worktreeStatusMissing", {}, "missing");
    case "removed":
      return t("subtasks.worktreeStatusRemoved", {}, "removed");
    case "remove_failed":
      return t("subtasks.worktreeStatusRemoveFailed", {}, "remove_failed");
    case "failed":
      return t("subtasks.worktreeStatusFailed", {}, "failed");
    case "not_requested":
      return t("subtasks.worktreeStatusNotRequested", {}, "not_requested");
    default:
      return status || "-";
  }
}

function describeWorktreeRuntimeStatus(status, t) {
  switch (status) {
    case "created":
      return t("subtasks.worktreeStatusDescCreated", {}, "The isolated worktree is present and can still be inspected.");
    case "missing":
      return t("subtasks.worktreeStatusDescMissing", {}, "A persisted worktree record exists, but the directory is missing on disk.");
    case "removed":
      return t("subtasks.worktreeStatusDescRemoved", {}, "The worktree has been cleaned up and removed after archive or recovery cleanup.");
    case "remove_failed":
      return t("subtasks.worktreeStatusDescRemoveFailed", {}, "Cleanup was attempted, but removing the worktree failed. Check the worktree error for details.");
    case "failed":
      return t("subtasks.worktreeStatusDescFailed", {}, "The worktree runtime failed before or during preparation.");
    case "not_requested":
      return t("subtasks.worktreeStatusDescNotRequested", {}, "This subtask did not request worktree isolation.");
    default:
      return t("subtasks.worktreeStatusDescUnknown", {}, "No additional worktree runtime note is available.");
  }
}

function formatSteeringStatus(status, t) {
  switch (status) {
    case "delivered":
      return t("subtasks.steeringDelivered", {}, "Delivered");
    case "failed":
      return t("subtasks.steeringFailed", {}, "Failed");
    default:
      return t("subtasks.steeringAccepted", {}, "Accepted");
  }
}

function formatResumeStatus(status, t) {
  switch (status) {
    case "delivered":
      return t("subtasks.resumeDelivered", {}, "Delivered");
    case "failed":
      return t("subtasks.resumeFailed", {}, "Failed");
    default:
      return t("subtasks.resumeAccepted", {}, "Accepted");
  }
}

function formatTakeoverStatus(status, t) {
  switch (status) {
    case "delivered":
      return t("subtasks.takeoverDelivered", {}, "Delivered");
    case "failed":
      return t("subtasks.takeoverFailed", {}, "Failed");
    default:
      return t("subtasks.takeoverAccepted", {}, "Accepted");
  }
}

function formatJoinedValues(values) {
  if (!Array.isArray(values) || values.length === 0) return "-";
  const normalized = values
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
  return normalized.length ? normalized.join(", ") : "-";
}

export function buildSubtaskArtifactEntries(
  item,
  contents = {},
  t = (_key, _params, fallback) => fallback ?? "",
) {
  const definitions = [
    {
      kind: "scratch",
      label: t("subtasks.detailScratch", {}, "Scratch Memory"),
      path: item?.scratchPath || "",
      content: typeof contents.scratchText === "string"
        ? contents.scratchText
        : typeof contents.scratchContent === "string" ? contents.scratchContent : "",
      emptyMessage: t("subtasks.noScratch", {}, "No scratch memory yet."),
    },
    {
      kind: "review",
      label: t("subtasks.detailReview", {}, "Commander Review"),
      path: item?.reviewPath || "",
      content: typeof contents.reviewText === "string"
        ? contents.reviewText
        : typeof contents.reviewContent === "string" ? contents.reviewContent : "",
      emptyMessage: t("subtasks.noReview", {}, "No review record yet."),
    },
    {
      kind: "lesson",
      label: t("subtasks.detailLesson", {}, "Lessons Learned"),
      path: item?.lessonPath || "",
      content: typeof contents.lessonText === "string"
        ? contents.lessonText
        : typeof contents.lessonContent === "string" ? contents.lessonContent : "",
      emptyMessage: t("subtasks.noLesson", {}, "No lessons learned yet."),
    },
  ];
  return definitions.filter((entry) => entry.path || entry.content);
}

export function formatTeamLaneState(laneState, t = (_key, _params, fallback) => fallback ?? "") {
  switch (laneState) {
    case "accepted":
      return t("subtasks.teamLaneAccepted", {}, "accepted");
    case "pending":
      return t("subtasks.teamLanePending", {}, "pending");
    case "retry":
      return t("subtasks.teamLaneRetry", {}, "retry");
    case "blocker":
      return t("subtasks.teamLaneBlocker", {}, "blocker");
    case "missing":
      return t("subtasks.teamLaneMissing", {}, "missing");
    default:
      return laneState || "-";
  }
}

export function formatTeamCompletionGateStatus(status, t = (_key, _params, fallback) => fallback ?? "") {
  switch (status) {
    case "accepted":
      return t("subtasks.teamCompletionAccepted", {}, "accepted");
    case "pending":
      return t("subtasks.teamCompletionPending", {}, "pending");
    case "rejected":
      return t("subtasks.teamCompletionRejected", {}, "rejected");
    default:
      return status || "-";
  }
}

export function buildTeamSharedStateSummaryLines(teamSharedState, t = (_key, _params, fallback) => fallback ?? "") {
  if (!teamSharedState || typeof teamSharedState !== "object") {
    return [];
  }
  const completionGate = teamSharedState.completionGate && typeof teamSharedState.completionGate === "object"
    ? teamSharedState.completionGate
    : null;
  const lines = [];
  if (teamSharedState.teamId || teamSharedState.mode) {
    lines.push([
      teamSharedState.teamId ? `team=${teamSharedState.teamId}` : "",
      teamSharedState.mode ? `mode=${teamSharedState.mode}` : "",
    ].filter(Boolean).join(", "));
  }
  if (completionGate?.summary) {
    lines.push(`completion gate: ${completionGate.summary}`);
  } else if (completionGate?.status) {
    lines.push(`completion gate: ${formatTeamCompletionGateStatus(completionGate.status, t)}`);
  }
  if (Array.isArray(completionGate?.acceptedLaneIds) && completionGate.acceptedLaneIds.length) {
    lines.push(`accepted lanes: ${completionGate.acceptedLaneIds.join(", ")}`);
  }
  if (Array.isArray(completionGate?.retryLaneIds) && completionGate.retryLaneIds.length) {
    lines.push(`retry lanes: ${completionGate.retryLaneIds.join(", ")}`);
  }
  if (Array.isArray(completionGate?.blockerLaneIds) && completionGate.blockerLaneIds.length) {
    lines.push(`blocker lanes: ${completionGate.blockerLaneIds.join(", ")}`);
  }
  return lines;
}

function formatNotificationKindLabel(kind, t) {
  switch (kind) {
    case "failed":
      return t("subtasks.steeringFailed", {}, "Failed");
    case "completed":
      return t("subtasks.notificationCompleted", {}, "Completed");
    case "started":
      return t("subtasks.notificationStarted", {}, "Started");
    case "progress":
      return t("subtasks.notificationProgress", {}, "Progress");
    case "steering_requested":
      return t("subtasks.steeringAccepted", {}, "Accepted");
    case "steering_delivered":
      return t("subtasks.steeringDelivered", {}, "Delivered");
    case "steering_failed":
      return t("subtasks.steeringFailed", {}, "Failed");
    case "resume_requested":
      return t("subtasks.resumeAccepted", {}, "Accepted");
    case "resume_delivered":
      return t("subtasks.resumeDelivered", {}, "Delivered");
    case "resume_failed":
      return t("subtasks.resumeFailed", {}, "Failed");
    case "takeover_requested":
      return t("subtasks.takeoverAccepted", {}, "Accepted");
    case "takeover_delivered":
      return t("subtasks.takeoverDelivered", {}, "Delivered");
    case "takeover_failed":
      return t("subtasks.takeoverFailed", {}, "Failed");
    default:
      return kind || t("subtasks.notificationProgress", {}, "Progress");
  }
}

export function formatBridgeRuntimeState(runtimeState, t = (_key, _params, fallback) => fallback ?? "") {
  switch (runtimeState) {
    case "active":
      return t("subtasks.bridgeRuntimeActive", {}, "active");
    case "runtime-lost":
      return t("subtasks.bridgeRuntimeRuntimeLost", {}, "runtime-lost");
    case "orphaned":
      return t("subtasks.bridgeRuntimeOrphaned", {}, "orphaned");
    case "closed":
      return t("subtasks.bridgeRuntimeClosed", {}, "closed");
    default:
      return runtimeState || "-";
  }
}

export function formatBridgeCloseReason(closeReason, t = (_key, _params, fallback) => fallback ?? "") {
  switch (closeReason) {
    case "manual":
      return t("subtasks.bridgeCloseReasonManual", {}, "manual");
    case "idle-timeout":
      return t("subtasks.bridgeCloseReasonIdleTimeout", {}, "idle-timeout");
    case "runtime-lost":
      return t("subtasks.bridgeCloseReasonRuntimeLost", {}, "runtime-lost");
    case "orphan":
      return t("subtasks.bridgeCloseReasonOrphan", {}, "orphan");
    default:
      return closeReason || "-";
  }
}

export function buildBridgeGovernanceSummaryLines(item, t = (_key, _params, fallback) => fallback ?? "") {
  const bridgeSubtaskView = item?.bridgeSubtaskView && typeof item.bridgeSubtaskView === "object"
    ? item.bridgeSubtaskView
    : null;
  const bridgeSessionView = item?.bridgeSessionView && typeof item.bridgeSessionView === "object"
    ? item.bridgeSessionView
    : null;
  const lines = [];
  if (bridgeSubtaskView?.summaryLine) {
    lines.push(bridgeSubtaskView.summaryLine);
  }
  if (bridgeSessionView?.summaryLine && bridgeSessionView.summaryLine !== bridgeSubtaskView?.summaryLine) {
    lines.push(bridgeSessionView.summaryLine);
  }
  if (bridgeSessionView?.blockReason) {
    lines.push(`${t("subtasks.detailBridgeBlockReason", {}, "Block Reason")}: ${bridgeSessionView.blockReason}`);
  }
  return lines;
}

export function buildSubtaskExecutionExplainabilityLines({
  launchExplainability,
  resultEnvelope,
  promptSnapshotView,
  sessionId = "",
  summarizeSourcePath = (value) => value,
  formatDateTime = (value) => String(value ?? "-"),
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const lines = buildLaunchExplainabilityLines(launchExplainability, t);

  if (resultEnvelope && typeof resultEnvelope === "object") {
    const resultParts = [
      resultEnvelope.status ? `status=${resultEnvelope.status}` : "",
      resultEnvelope.agentId ? `agent=${resultEnvelope.agentId}` : "",
      resultEnvelope.finishedAt ? `finished=${formatDateTime(resultEnvelope.finishedAt)}` : "",
      resultEnvelope.outputPath ? `output=${summarizeSourcePath(resultEnvelope.outputPath)}` : "",
    ].filter(Boolean);
    if (resultParts.length) {
      lines.push(`${t("subtasks.detailExecutionResultEnvelope", {}, "result envelope")}: ${resultParts.join(", ")}`);
    }
  }

  const snapshot = promptSnapshotView?.snapshot;
  if (snapshot && typeof snapshot === "object") {
    const summary = snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};
    const manifest = snapshot.manifest && typeof snapshot.manifest === "object" ? snapshot.manifest : {};
    const snapshotParts = [
      manifest.conversationId || sessionId ? `conversation=${manifest.conversationId || sessionId}` : "",
      Number.isFinite(summary.messageCount) ? `messages=${summary.messageCount}` : "",
      Number.isFinite(summary.tokenBreakdown?.systemPromptEstimatedTokens)
        ? `tokens=${summary.tokenBreakdown.systemPromptEstimatedTokens}`
        : "",
      manifest.createdAt ? `captured=${formatDateTime(manifest.createdAt)}` : "",
    ].filter(Boolean);
    if (snapshotParts.length) {
      lines.push(`${t("subtasks.detailExecutionPromptSnapshot", {}, "prompt snapshot")}: ${snapshotParts.join(", ")}`);
    }
  } else if (sessionId) {
    lines.push(`${t("subtasks.detailExecutionPromptSnapshot", {}, "prompt snapshot")}: missing for session=${sessionId}`);
  }

  return lines;
}

export function parseGoalSessionReference(conversationId) {
  const value = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!value) return null;
  const goalNodeMatch = /^goal:([^:]+):node:([^:]+):run:([^:]+)$/.exec(value);
  if (goalNodeMatch) {
    return {
      kind: "goal_node",
      goalId: goalNodeMatch[1],
      nodeId: goalNodeMatch[2],
      runId: goalNodeMatch[3],
    };
  }
  const goalMatch = /^goal:([^:]+)$/.exec(value);
  if (goalMatch) {
    return {
      kind: "goal",
      goalId: goalMatch[1],
    };
  }
  return null;
}

function notificationTone(kind) {
  if (["failed", "steering_failed", "resume_failed", "takeover_failed"].includes(kind)) return "error";
  if (["completed", "steering_delivered", "resume_delivered", "takeover_delivered"].includes(kind)) return "done";
  if (["started", "progress", "steering_requested", "resume_requested", "takeover_requested"].includes(kind)) return "running";
  return "pending";
}

function createNotificationRecords(ownerDocument, items, options) {
  const {
    emptyMessage,
    status,
    formatStatus,
    formatDate,
    includeResumeSource = false,
    includeTakeoverMeta = false,
    t,
  } = options;
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) {
    return createElement(ownerDocument, "div", "memory-detail-text", emptyMessage);
  }

  const list = createElement(ownerDocument, "div", "subtask-notification-list");
  list.append(...safeItems.map((item) => {
    const record = createElement(ownerDocument, "div", "subtask-notification-item");
    const head = createElement(ownerDocument, "div", "subtask-notification-head");
    const tone = status ? status(item) : notificationTone(item?.kind);
    head.append(
      createElement(ownerDocument, "span", `memory-badge subtask-status-badge ${getStatusToneClass(tone)}`, formatStatus(item)),
      createElement(ownerDocument, "span", "subtask-notification-meta", formatDate(item)),
    );
    record.append(head);

    if (includeTakeoverMeta) {
      record.append(
        createElement(ownerDocument, "div", "memory-detail-text", item?.message || t("subtasks.takeoverDefaultMessage", { agentId: item?.agentId || "-" }, "Relaunch this subtask under {agentId}.")),
        createMeta(ownerDocument, [t("subtasks.detailTakeoverAgent", {}, "Takeover Agent"), item?.agentId || "-"]),
        createMeta(ownerDocument, [
          t("subtasks.detailTakeoverMode", {}, "Mode"),
          item?.mode === "safe_point"
            ? t("subtasks.takeoverModeSafePoint", {}, "safe-point relaunch")
            : t("subtasks.takeoverModeResumeRelaunch", {}, "finished-task relaunch"),
        ]),
      );
    } else if (status === undefined) {
      record.append(createElement(ownerDocument, "div", "memory-detail-text", item?.message || "-"));
    } else {
      const defaultMessage = includeResumeSource
        ? t("subtasks.resumeDefaultMessage", {}, "Continue from the last recorded state.")
        : "-";
      record.append(createElement(ownerDocument, "div", "memory-detail-text", item?.message || defaultMessage));
    }

    if (includeResumeSource && item?.resumedFromSessionId) {
      record.append(createMeta(ownerDocument, [t("subtasks.detailResumeSourceSession", {}, "Resumed From"), item.resumedFromSessionId]));
    }
    if (item?.error) {
      record.append(createElement(ownerDocument, "div", "memory-detail-text", item.error));
    }
    return record;
  }));
  return list;
}

function createBridgeGovernanceSection(ownerDocument, item, summarizeSourcePath, t) {
  const bridgeSubtaskView = item?.bridgeSubtaskView && typeof item.bridgeSubtaskView === "object"
    ? item.bridgeSubtaskView
    : null;
  const bridgeSessionView = item?.bridgeSessionView && typeof item.bridgeSessionView === "object"
    ? item.bridgeSessionView
    : null;
  if (!bridgeSubtaskView && !bridgeSessionView) return null;

  const section = createElement(ownerDocument, "section", "memory-detail-card");
  section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailBridgeGovernance", {}, "Bridge Governance")));
  const cards = [];
  if (bridgeSubtaskView) cards.push(createDetailCard(ownerDocument, t("subtasks.detailBridgeKind", {}, "Bridge Semantic"), bridgeSubtaskView.label || "-"));
  if (bridgeSessionView) {
    cards.push(
      createDetailCard(ownerDocument, t("subtasks.detailBridgeTarget", {}, "Bridge Target"), bridgeSessionView.targetRef || "-"),
      createDetailCard(ownerDocument, t("subtasks.detailBridgeState", {}, "Runtime State"), formatBridgeRuntimeState(bridgeSessionView.runtimeState, t)),
      createDetailCard(ownerDocument, t("subtasks.detailBridgeCloseReason", {}, "Close Reason"), formatBridgeCloseReason(bridgeSessionView.closeReason, t)),
      createDetailCard(ownerDocument, t("subtasks.detailBridgeCwd", {}, "Bridge CWD"), bridgeSessionView.cwd || "-"),
      createDetailCard(ownerDocument, t("subtasks.detailBridgeCommand", {}, "Command Preview"), bridgeSessionView.commandPreview || "-"),
    );
  }
  appendDetailGrid(ownerDocument, section, cards);
  const summary = createExplainabilityNote(ownerDocument, buildBridgeGovernanceSummaryLines(item, t));
  if (summary) section.append(summary);
  if (bridgeSessionView?.artifactPath) {
    section.append(createMeta(ownerDocument, [
      t("subtasks.detailBridgeArtifact", {}, "Bridge Artifact"),
      summarizeSourcePath(bridgeSessionView.artifactPath),
    ]));
  }
  if (bridgeSessionView?.transcriptPath) {
    section.append(createMeta(ownerDocument, [
      t("subtasks.detailBridgeTranscript", {}, "Bridge Transcript"),
      summarizeSourcePath(bridgeSessionView.transcriptPath),
    ]));
  }
  const actions = [];
  if (bridgeSessionView?.artifactPath) {
    actions.push(createButton(ownerDocument, "button goal-inline-action-secondary", t("subtasks.openBridgeArtifact", {}, "Open bridge artifact"), "data-open-source", bridgeSessionView.artifactPath));
  }
  if (bridgeSessionView?.transcriptPath) {
    actions.push(createButton(ownerDocument, "button goal-inline-action-secondary", t("subtasks.openBridgeTranscript", {}, "Open bridge transcript"), "data-open-source", bridgeSessionView.transcriptPath));
  }
  if (actions.length) {
    const actionRow = createElement(ownerDocument, "div", "subtask-detail-actions");
    actionRow.append(...actions);
    section.append(actionRow);
  }
  return section;
}

function createTeamSharedStateSection(ownerDocument, teamSharedState, t) {
  if (!teamSharedState || typeof teamSharedState !== "object") return null;
  const roster = Array.isArray(teamSharedState.roster) ? teamSharedState.roster : [];
  const completionGate = teamSharedState.completionGate && typeof teamSharedState.completionGate === "object"
    ? teamSharedState.completionGate
    : null;
  const section = createElement(ownerDocument, "section", "memory-detail-card");
  section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailTeamSharedState", {}, "Team Shared State")));
  appendDetailGrid(ownerDocument, section, [
    createDetailCard(ownerDocument, t("subtasks.detailTeamId", {}, "Team ID"), teamSharedState.teamId || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailTeamMode", {}, "Team Mode"), teamSharedState.mode || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailTeamSharedGoal", {}, "Shared Goal"), teamSharedState.sharedGoal || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailTeamManager", {}, "Manager Agent"), teamSharedState.managerAgentId || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailTeamManagerIdentity", {}, "Manager Identity"), teamSharedState.managerIdentityLabel || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailTeamCurrentLane", {}, "Current Lane"), teamSharedState.currentLaneId || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailTeamFanInVerdict", {}, "Fan-In Verdict"), completionGate?.finalFanInVerdict || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailTeamCompletionStatus", {}, "Completion Gate"), formatTeamCompletionGateStatus(completionGate?.status, t)),
    createDetailCard(ownerDocument, t("subtasks.detailTeamAcceptedLanes", {}, "Accepted Lanes"), formatJoinedValues(completionGate?.acceptedLaneIds)),
    createDetailCard(ownerDocument, t("subtasks.detailTeamRetryLanes", {}, "Retry Lanes"), formatJoinedValues(completionGate?.retryLaneIds)),
    createDetailCard(ownerDocument, t("subtasks.detailTeamBlockerLanes", {}, "Blocker Lanes"), formatJoinedValues(completionGate?.blockerLaneIds)),
  ]);
  section.append(createElement(ownerDocument, "div", "memory-detail-text", teamSharedState.fanInSummary || completionGate?.summary || "-"));
  if (Array.isArray(completionGate?.overlappingWriteScopes) && completionGate.overlappingWriteScopes.length) {
    const title = createElement(ownerDocument, "div", "memory-detail-text");
    title.append(createElement(ownerDocument, "strong", "", t("subtasks.detailTeamOverlap", {}, "Overlapping Write Scope")));
    const note = createElement(ownerDocument, "div", "tool-settings-policy-note");
    note.append(...completionGate.overlappingWriteScopes.map((entry) => createElement(ownerDocument, "div", "", `${entry.path}: ${formatJoinedValues(entry.laneIds)}`)));
    section.append(title, note);
  }
  if (roster.length) {
    const rosterTitle = createElement(ownerDocument, "div", "memory-detail-text");
    rosterTitle.append(createElement(ownerDocument, "strong", "", t("subtasks.detailTeamRoster", {}, "Lane Roster")));
    const rosterList = createElement(ownerDocument, "div", "subtask-notification-list");
    rosterList.append(...roster.map((lane) => {
      const row = createElement(ownerDocument, "div", "subtask-notification-item");
      const head = createElement(ownerDocument, "div", "subtask-notification-head");
      head.append(createElement(ownerDocument, "span", "memory-badge", `${lane.laneId} · ${formatTeamLaneState(lane.laneState, t)}`));
      if (lane.taskId) {
        head.append(createButton(ownerDocument, "button-link", t("subtasks.openLaneTask", {}, "Open lane task"), "data-open-task-id", lane.taskId));
      }
      row.append(
        head,
        createMeta(ownerDocument, [t("subtasks.detailAgentId", {}, "Agent"), lane.agentId || "-"]),
        createMeta(ownerDocument, [t("subtasks.detailLaunchRole", {}, "Launch Role"), lane.role || "-"]),
        createMeta(ownerDocument, [t("subtasks.detailTeamIdentityLabel", {}, "Identity Label"), lane.identityLabel || "-"]),
        createMeta(ownerDocument, [t("subtasks.detailTeamAuthorityRelation", {}, "Authority Relation"), lane.authorityRelationToManager || "-"]),
        createMeta(ownerDocument, [t("subtasks.detailTeamReportsTo", {}, "Reports To"), formatJoinedValues(lane.reportsTo)]),
        createMeta(ownerDocument, [t("subtasks.detailTeamMayDirect", {}, "May Direct"), formatJoinedValues(lane.mayDirect)]),
        createMeta(ownerDocument, [t("subtasks.detailLaunchStatus", {}, "Status"), lane.status || "-"]),
        createMeta(ownerDocument, [t("subtasks.detailDelegationOwnedScope", {}, "Owned Scope"), lane.scopeSummary || "-"]),
        createMeta(ownerDocument, [t("subtasks.detailTeamDependsOn", {}, "Depends On"), formatJoinedValues(lane.dependsOn)]),
        createMeta(ownerDocument, [t("subtasks.detailTeamHandoffTo", {}, "Handoff To"), formatJoinedValues(lane.handoffTo)]),
      );
      if (lane.acceptanceGateSummary) row.append(createElement(ownerDocument, "div", "memory-detail-text", lane.acceptanceGateSummary));
      if (lane.summary) row.append(createElement(ownerDocument, "div", "memory-detail-text", lane.summary));
      return row;
    }));
    section.append(rosterTitle, rosterList);
  }
  return section;
}

function createContinuationStateSection(ownerDocument, state, t) {
  if (!state || typeof state !== "object") return null;
  const checkpoints = state.checkpoints && typeof state.checkpoints === "object" ? state.checkpoints : {};
  const progress = state.progress && typeof state.progress === "object" ? state.progress : {};
  const recent = Array.isArray(progress.recent)
    ? progress.recent.filter((item) => typeof item === "string" && item.trim())
    : [];
  const labels = Array.isArray(checkpoints.labels)
    ? checkpoints.labels.filter((item) => typeof item === "string" && item.trim())
    : [];
  const section = createElement(ownerDocument, "section", "memory-detail-card");
  section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailContinuation", {}, "Continuation State")));
  const targetCard = createDetailCard(ownerDocument, t("subtasks.detailContinuationTarget", {}, "Recommended Target"), "");
  const targetText = targetCard.querySelector(".memory-detail-text");
  const targetAction = encodeContinuationAction(buildContinuationAction(state));
  if (state.recommendedTargetId && targetAction) {
    targetText.replaceChildren(createButton(ownerDocument, "button goal-inline-action-secondary", formatContinuationTargetLabel(state), "data-continuation-action", targetAction));
  } else {
    targetText.textContent = formatContinuationTargetLabel(state);
  }
  appendDetailGrid(ownerDocument, section, [
    createDetailCard(ownerDocument, t("subtasks.detailContinuationMode", {}, "Resume Mode"), state.resumeMode || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailContinuationNextAction", {}, "Next Action"), state.nextAction || "-"),
    createDetailCard(ownerDocument, t("subtasks.detailContinuationCheckpoints", {}, "Open Checkpoints"), String(Number(checkpoints.openCount || 0))),
    createDetailCard(ownerDocument, t("subtasks.detailContinuationBlockers", {}, "Blockers"), String(Number(checkpoints.blockerCount || 0))),
    createDetailCard(ownerDocument, t("subtasks.detailContinuationProgress", {}, "Current Progress"), progress.current || "-"),
    targetCard,
  ]);
  section.append(createElement(ownerDocument, "div", "memory-detail-text", state.summary || "-"));
  if (labels.length) section.append(createMeta(ownerDocument, [labels.join(" | ")]));
  if (recent.length) {
    const recentList = createElement(ownerDocument, "div", "subtask-notification-list");
    recentList.append(...recent.map((entry) => {
      const row = createElement(ownerDocument, "div", "subtask-notification-item");
      row.append(createElement(ownerDocument, "div", "memory-detail-text", entry));
      return row;
    }));
    section.append(recentList);
  } else {
    section.append(createElement(ownerDocument, "div", "memory-detail-text", t("subtasks.detailContinuationRecentEmpty", {}, "No recent continuation events.")));
  }
  return section;
}

function createActionButtons(ownerDocument, {
  item,
  pendingActionKind,
  canStop,
  canArchive,
  goalSession,
  parentTaskId,
  worktreePath,
  t,
}) {
  const buttons = [];
  if (canStop) {
    buttons.push(createButton(
      ownerDocument,
      "button",
      pendingActionKind === "stop" ? t("subtasks.actionStopping", {}, "Stopping...") : t("subtasks.actionStop", {}, "Stop"),
      "data-subtask-stop",
      item.id,
      Boolean(pendingActionKind),
    ));
  }
  if (canArchive) {
    buttons.push(createButton(
      ownerDocument,
      "button",
      pendingActionKind === "archive" ? t("subtasks.actionArchiving", {}, "Archiving...") : t("subtasks.actionArchive", {}, "Archive"),
      "data-subtask-archive",
      item.id,
      Boolean(pendingActionKind),
    ));
  }
  if (goalSession?.goalId) {
    buttons.push(createButton(ownerDocument, "button goal-inline-action-secondary", t("subtasks.openGoal", {}, "Open long task"), "data-open-goal-id", goalSession.goalId));
  }
  if (parentTaskId) {
    buttons.push(createButton(ownerDocument, "button goal-inline-action-secondary", t("subtasks.openParentTask", {}, "Open parent task"), "data-open-task-id", parentTaskId));
  }
  if (worktreePath) {
    buttons.push(createButton(ownerDocument, "button goal-inline-action-secondary", t("subtasks.openWorktree", {}, "Open worktree"), "data-open-source", worktreePath));
  }
  return buttons;
}

function createSteeringSection(ownerDocument, { item, pendingActionKind, steeringDraft, formatDateTime, t }) {
  const section = createElement(ownerDocument, "section", "memory-detail-card");
  section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailSteering", {}, "Steering")));
  if (item.status === "running") {
    const panel = createElement(ownerDocument, "div", "subtask-steering-panel");
    const input = createElement(ownerDocument, "textarea", "editor-textarea subtask-steering-input");
    input.rows = 4;
    input.setAttribute("data-subtask-steering-input", text(item.id));
    input.placeholder = t("subtasks.steeringPlaceholder", {}, "Describe how this running subtask should adjust its next attempt.");
    input.value = text(steeringDraft);
    input.disabled = pendingActionKind === "steering";
    const actions = createElement(ownerDocument, "div", "subtask-detail-actions");
    actions.append(createButton(
      ownerDocument,
      "button",
      pendingActionKind === "steering" ? t("subtasks.actionSteering", {}, "Sending...") : t("subtasks.actionSteer", {}, "Send steering"),
      "data-subtask-steering-send",
      item.id,
      pendingActionKind === "steering",
    ));
    panel.append(input, actions);
    section.append(panel);
  }
  section.append(createNotificationRecords(ownerDocument, item.steering, {
    emptyMessage: t("subtasks.noSteering", {}, "No steering requests yet."),
    status: (record) => record?.status === "failed" ? "error" : record?.status === "delivered" ? "done" : "running",
    formatStatus: (record) => formatSteeringStatus(record?.status, t),
    formatDate: (record) => formatDateTime(record?.deliveredAt || record?.requestedAt),
    t,
  }));
  return section;
}

function createResumeSection(ownerDocument, { item, pendingActionKind, canResume, resumeDraft, formatDateTime, t }) {
  const section = createElement(ownerDocument, "section", "memory-detail-card");
  section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailResume", {}, "Resume")));
  if (canResume) {
    const panel = createElement(ownerDocument, "div", "subtask-steering-panel");
    const input = createElement(ownerDocument, "textarea", "editor-textarea subtask-steering-input");
    input.rows = 4;
    input.setAttribute("data-subtask-resume-input", text(item.id));
    input.placeholder = t("subtasks.resumePlaceholder", {}, "Optionally describe how this finished subtask should continue from its last recorded state.");
    input.value = text(resumeDraft);
    input.disabled = pendingActionKind === "resume";
    const actions = createElement(ownerDocument, "div", "subtask-detail-actions");
    actions.append(createButton(
      ownerDocument,
      "button",
      pendingActionKind === "resume" ? t("subtasks.actionResuming", {}, "Resuming...") : t("subtasks.actionResume", {}, "Resume"),
      "data-subtask-resume-send",
      item.id,
      pendingActionKind === "resume",
    ));
    panel.append(input, actions);
    section.append(panel);
  }
  section.append(createNotificationRecords(ownerDocument, item.resume, {
    emptyMessage: t("subtasks.noResume", {}, "No resume requests yet."),
    status: (record) => record?.status === "failed" ? "error" : record?.status === "delivered" ? "done" : "running",
    formatStatus: (record) => formatResumeStatus(record?.status, t),
    formatDate: (record) => formatDateTime(record?.deliveredAt || record?.requestedAt),
    includeResumeSource: true,
    t,
  }));
  return section;
}

function createTakeoverSection(ownerDocument, {
  item,
  pendingActionKind,
  canTakeover,
  takeoverDraft,
  takeoverAgentDraft,
  formatDateTime,
  t,
}) {
  const section = createElement(ownerDocument, "section", "memory-detail-card");
  section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailTakeover", {}, "Takeover / Handoff")));
  if (canTakeover) {
    const panel = createElement(ownerDocument, "div", "subtask-steering-panel");
    const messageInput = createElement(ownerDocument, "textarea", "editor-textarea subtask-steering-input");
    messageInput.rows = 4;
    messageInput.setAttribute("data-subtask-takeover-input", text(item.id));
    messageInput.placeholder = item.status === "running"
      ? t("subtasks.takeoverSafePointPlaceholder", {}, "Optionally describe how the new agent should continue after the current run stops at a safe point.")
      : t("subtasks.takeoverPlaceholder", {}, "Optionally describe how the new agent should continue from the last recorded state.");
    messageInput.value = text(takeoverDraft);
    messageInput.disabled = pendingActionKind === "takeover";
    const actions = createElement(ownerDocument, "div", "subtask-detail-actions");
    const agentInput = createElement(ownerDocument, "input", "editor-textarea");
    agentInput.type = "text";
    agentInput.setAttribute("data-subtask-takeover-agent-input", text(item.id));
    agentInput.value = text(takeoverAgentDraft);
    agentInput.placeholder = item.status === "running"
      ? t("subtasks.takeoverSafePointAgentPlaceholder", {}, "Enter the agentId that should take over this running subtask at a safe point.")
      : t("subtasks.takeoverAgentPlaceholder", {}, "Enter the agentId that should take over this finished subtask.");
    agentInput.disabled = pendingActionKind === "takeover";
    actions.append(
      agentInput,
      createButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        pendingActionKind === "takeover" ? t("subtasks.actionTakingOver", {}, "Taking over...") : t("subtasks.actionTakeover", {}, "Take over"),
        "data-subtask-takeover-send",
        item.id,
        pendingActionKind === "takeover",
      ),
    );
    panel.append(
      messageInput,
      actions,
      createMeta(ownerDocument, [item.status === "running"
        ? t("subtasks.takeoverSafePointNote", {}, "Takeover will stop the current run and relaunch the same subtask under the new agent.")
        : t("subtasks.takeoverResumeNote", {}, "Takeover will relaunch the same finished subtask under the new agent.")]),
    );
    section.append(panel);
  }
  section.append(createNotificationRecords(ownerDocument, item.takeover, {
    emptyMessage: t("subtasks.noTakeover", {}, "No takeover requests yet."),
    status: (record) => record?.status === "failed" ? "error" : record?.status === "delivered" ? "done" : "running",
    formatStatus: (record) => formatTakeoverStatus(record?.status, t),
    formatDate: (record) => formatDateTime(record?.deliveredAt || record?.requestedAt),
    includeResumeSource: true,
    includeTakeoverMeta: true,
    t,
  }));
  return section;
}

export function createSubtasksDetailView({
  refs,
  formatDateTime = (value) => String(value ?? ""),
  summarizeSourcePath = (value) => String(value ?? ""),
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { subtasksDetailEl } = refs;

  return {
    render({
      item,
      outputContent = "",
      pendingActionKind = null,
      resultEnvelope = null,
      launchExplainability = null,
      promptSnapshotView = null,
      scratchText = "",
      reviewText = "",
      lessonText = "",
      acceptanceGate = null,
      teamSharedState = null,
      continuationState = null,
      steeringDraft = "",
      resumeDraft = "",
      takeoverDraft = "",
      takeoverAgentDraft = "",
      continuationFocusSessionId = "",
    }) {
      if (!subtasksDetailEl || !item) return null;
      const ownerDocument = subtasksDetailEl.ownerDocument ?? document;
      const canStop = item.status === "pending" || item.status === "running";
      const canArchive = !item.archivedAt && ["done", "error", "timeout", "stopped"].includes(item.status);
      const canResume = !item.archivedAt && ["done", "error", "timeout", "stopped"].includes(item.status);
      const canTakeover = !item.archivedAt && ["running", "done", "error", "timeout", "stopped"].includes(item.status);
      const outputText = typeof outputContent === "string" && outputContent.trim()
        ? outputContent
        : item?.outputPreview || "";
      const launchExplainabilityLines = buildLaunchExplainabilityLines(launchExplainability, t);
      const executionExplainabilityLines = buildSubtaskExecutionExplainabilityLines({
        launchExplainability,
        resultEnvelope,
        promptSnapshotView,
        sessionId: item?.sessionId || "",
        summarizeSourcePath,
        formatDateTime,
        t,
      });
      const delegation = item?.launchSpec?.delegation && typeof item.launchSpec.delegation === "object"
        ? item.launchSpec.delegation
        : null;
      const artifactEntries = buildSubtaskArtifactEntries(item, { scratchText, reviewText, lessonText }, t);
      const worktreeStatus = item?.launchSpec?.worktreeStatus || "";
      const worktreeStatusLabel = formatWorktreeRuntimeStatus(worktreeStatus, t);
      const worktreeStatusDescription = describeWorktreeRuntimeStatus(worktreeStatus, t);
      const parentTaskId = typeof item?.launchSpec?.parentTaskId === "string" ? item.launchSpec.parentTaskId.trim() : "";
      const worktreePath = typeof item?.launchSpec?.worktreePath === "string" ? item.launchSpec.worktreePath.trim() : "";
      const goalSession = parseGoalSessionReference(item.parentConversationId);
      const normalizedContinuationFocus = typeof continuationFocusSessionId === "string"
        ? continuationFocusSessionId.trim()
        : "";
      const isContinuationFocus = normalizedContinuationFocus
        && typeof item?.sessionId === "string"
        && item.sessionId.trim() === normalizedContinuationFocus;

      const shell = createElement(ownerDocument, "div", `memory-detail-shell${isContinuationFocus ? " is-continuation-focus" : ""}`);
      shell.setAttribute("data-subtask-session-focus", text(item?.sessionId || ""));
      const header = createElement(ownerDocument, "div", "memory-detail-header");
      const headerContent = createElement(ownerDocument, "div");
      const headerMetaValues = [item.agentId || "-"];
      if (item?.sessionId) headerMetaValues.push(item.sessionId);
      headerMetaValues.push(formatDateTime(item.updatedAt || item.createdAt));
      headerContent.append(
        createElement(ownerDocument, "div", "memory-detail-title", item.id || "-"),
        createMeta(ownerDocument, headerMetaValues),
      );
      const badges = createElement(ownerDocument, "div", "memory-detail-badges");
      badges.append(
        createElement(ownerDocument, "span", "memory-badge", item.kind || "sub_agent"),
        createElement(ownerDocument, "span", `memory-badge subtask-status-badge ${getStatusToneClass(item.status)}`, formatSubtaskStatus(item.status)),
      );
      if (item.archivedAt) badges.append(createElement(ownerDocument, "span", "memory-badge", t("subtasks.archivedBadge", {}, "archived")));
      header.append(headerContent, badges);
      shell.append(header);

      const actionButtons = createActionButtons(ownerDocument, {
        item,
        pendingActionKind,
        canStop,
        canArchive,
        goalSession,
        parentTaskId,
        worktreePath,
        t,
      });
      if (actionButtons.length) {
        const actionRow = createElement(ownerDocument, "div", "subtask-detail-actions");
        actionRow.append(...actionButtons);
        shell.append(actionRow);
      }

      const overviewGrid = createElement(ownerDocument, "div", "memory-detail-grid");
      overviewGrid.append(
        createDetailCard(ownerDocument, t("subtasks.detailParentConversation", {}, "Parent Conversation"), item.parentConversationId),
        createDetailCard(ownerDocument, t("subtasks.detailSessionId", {}, "Session ID"), item.sessionId || "-", isContinuationFocus ? "is-continuation-focus" : ""),
        createDetailCard(ownerDocument, t("subtasks.detailAgentId", {}, "Agent"), item.agentId || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchProfile", {}, "Launch Profile"), item?.launchSpec?.profileId || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchChannel", {}, "Launch Channel"), item?.launchSpec?.channel || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchTimeout", {}, "Launch Timeout"), formatLaunchTimeout(item?.launchSpec?.timeoutMs)),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchBackground", {}, "Background"), item?.launchSpec?.background === true ? t("subtasks.boolYes", {}, "Yes") : item?.launchSpec?.background === false ? t("subtasks.boolNo", {}, "No") : "-"),
        createDetailCard(ownerDocument, t("subtasks.detailCreatedAt", {}, "Created At"), formatDateTime(item.createdAt)),
        createDetailCard(ownerDocument, t("subtasks.detailUpdatedAt", {}, "Updated At"), formatDateTime(item.updatedAt)),
        createDetailCard(ownerDocument, t("subtasks.detailFinishedAt", {}, "Finished At"), formatDateTime(item.finishedAt)),
        createDetailCard(ownerDocument, t("subtasks.detailArchivedAt", {}, "Archived At"), formatDateTime(item.archivedAt)),
      );
      shell.append(overviewGrid);

      const sections = createElement(ownerDocument, "div", "subtask-detail-sections");
      sections.append(
        createPreCard(ownerDocument, t("subtasks.detailInstruction", {}, "Instruction"), item.instruction || "-"),
        (() => {
          const section = createElement(ownerDocument, "section", "memory-detail-card");
          section.append(
            createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailSummary", {}, "Summary")),
            createElement(ownerDocument, "div", "memory-detail-text", item.summary || t("subtasks.noSummary", {}, "No summary yet.")),
          );
          return section;
        })(),
        (() => {
          const section = createElement(ownerDocument, "section", "memory-detail-card");
          section.append(
            createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailProgress", {}, "Progress")),
            createElement(ownerDocument, "div", "memory-detail-text", item?.progress?.message || "-"),
          );
          return section;
        })(),
      );

      const bridgeSection = createBridgeGovernanceSection(ownerDocument, item, summarizeSourcePath, t);
      if (bridgeSection) sections.append(bridgeSection);
      const continuationSection = createContinuationStateSection(ownerDocument, continuationState, t);
      if (continuationSection) sections.append(continuationSection);
      sections.append(
        createSteeringSection(ownerDocument, { item, pendingActionKind, steeringDraft, formatDateTime, t }),
        createResumeSection(ownerDocument, { item, pendingActionKind, canResume, resumeDraft, formatDateTime, t }),
        createTakeoverSection(ownerDocument, {
          item,
          pendingActionKind,
          canTakeover,
          takeoverDraft,
          takeoverAgentDraft,
          formatDateTime,
          t,
        }),
      );

      if (executionExplainabilityLines.length) {
        const section = createElement(ownerDocument, "section", "memory-detail-card");
        section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailExecutionExplainability", {}, "Execution Explainability")), createExplainabilityNote(ownerDocument, executionExplainabilityLines));
        sections.append(section);
      }
      if (launchExplainabilityLines.length) {
        const section = createElement(ownerDocument, "section", "memory-detail-card");
        section.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailLaunchExplainability", {}, "Launch Explainability")), createExplainabilityNote(ownerDocument, launchExplainabilityLines));
        sections.append(section);
      }
      if (item?.sessionId) {
        const promptSnapshot = createPromptSnapshotDetailView({ ownerDocument, formatDateTime, t }).render(promptSnapshotView, item.sessionId);
        if (promptSnapshot) sections.append(promptSnapshot);
      }

      const launchSpecSection = createElement(ownerDocument, "section", "memory-detail-card");
      launchSpecSection.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailLaunchSpec", {}, "Launch Spec")));
      appendDetailGrid(ownerDocument, launchSpecSection, [
        createDetailCard(ownerDocument, t("subtasks.detailLaunchPermission", {}, "Permission Mode"), item?.launchSpec?.permissionMode || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchIsolation", {}, "Isolation"), item?.launchSpec?.isolationMode || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchRole", {}, "Launch Role"), item?.launchSpec?.role || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchRolePolicy", {}, "Role Policy"), item?.launchSpec?.policySummary || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchParentTask", {}, "Parent Task"), item?.launchSpec?.parentTaskId || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchCwd", {}, "Launch CWD"), item?.launchSpec?.cwd || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchResolvedCwd", {}, "Resolved CWD"), item?.launchSpec?.resolvedCwd || item?.launchSpec?.cwd || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchWorktreeStatus", {}, "Worktree Runtime"), worktreeStatusLabel),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchWorktreePath", {}, "Worktree Path"), item?.launchSpec?.worktreePath || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchWorktreeRepo", {}, "Worktree Repo"), item?.launchSpec?.worktreeRepoRoot || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchWorktreeBranch", {}, "Worktree Branch"), item?.launchSpec?.worktreeBranch || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchToolSet", {}, "Tool Set"), Array.isArray(item?.launchSpec?.toolSet) && item.launchSpec.toolSet.length ? item.launchSpec.toolSet.join(", ") : "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchAllowedFamilies", {}, "Allowed Families"), Array.isArray(item?.launchSpec?.allowedToolFamilies) && item.launchSpec.allowedToolFamilies.length ? item.launchSpec.allowedToolFamilies.join(", ") : "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchMaxRisk", {}, "Max Risk"), item?.launchSpec?.maxToolRiskLevel || "-"),
        createDetailCard(ownerDocument, t("subtasks.detailLaunchContextKeys", {}, "Context Keys"), Array.isArray(item?.launchSpec?.contextKeys) && item.launchSpec.contextKeys.length ? item.launchSpec.contextKeys.join(", ") : "-"),
      ]);
      sections.append(launchSpecSection);

      if (delegation) {
        const delegationSection = createElement(ownerDocument, "section", "memory-detail-card");
        delegationSection.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailDelegationProtocol", {}, "Delegation Protocol")));
        appendDetailGrid(ownerDocument, delegationSection, [
          createDetailCard(ownerDocument, t("subtasks.detailDelegationSource", {}, "Delegation Source"), delegation.source || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationIntentKind", {}, "Intent Kind"), delegation.intentKind || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationIntent", {}, "Intent"), delegation.intentSummary || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationDeliverable", {}, "Deliverable"), delegation.expectedDeliverableFormat || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationDeliverableSummary", {}, "Deliverable Summary"), delegation.expectedDeliverableSummary || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationAggregation", {}, "Aggregation"), delegation.aggregationMode || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationSourceAgents", {}, "Source Agents"), formatJoinedValues(delegation.sourceAgentIds)),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationContextKeys", {}, "Delegation Context Keys"), formatJoinedValues(delegation.contextKeys)),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationOwnedScope", {}, "Owned Scope"), delegation.ownership?.scopeSummary || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationOutOfScope", {}, "Out of Scope"), formatJoinedValues(delegation.ownership?.outOfScope)),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationWriteScope", {}, "Write Scope"), formatJoinedValues(delegation.ownership?.writeScope)),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationDoneDefinition", {}, "Done Definition"), delegation.acceptance?.doneDefinition || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationVerificationHints", {}, "Verification Hints"), formatJoinedValues(delegation.acceptance?.verificationHints)),
          createDetailCard(ownerDocument, t("subtasks.detailDelegationRequiredSections", {}, "Required Sections"), formatJoinedValues(delegation.deliverableContract?.requiredSections)),
        ]);
        sections.append(delegationSection);
      }

      const teamSection = createTeamSharedStateSection(ownerDocument, teamSharedState, t);
      if (teamSection) sections.append(teamSection);
      if (resultEnvelope) {
        const resultSection = createElement(ownerDocument, "section", "memory-detail-card");
        resultSection.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailResultEnvelope", {}, "Result Envelope")));
        appendDetailGrid(ownerDocument, resultSection, [
          createDetailCard(ownerDocument, t("subtasks.detailResultEnvelopeStatus", {}, "Envelope Status"), resultEnvelope.status || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailResultEnvelopeAgent", {}, "Envelope Agent"), resultEnvelope.agentId || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailResultEnvelopeFinishedAt", {}, "Envelope Finished At"), formatDateTime(resultEnvelope.finishedAt)),
          createDetailCard(ownerDocument, t("subtasks.detailResultEnvelopeOutputPath", {}, "Envelope Output Path"), resultEnvelope.outputPath || "-"),
        ]);
        resultSection.append(createElement(ownerDocument, "div", "memory-detail-text", resultEnvelope.summary || "-"));
        sections.append(resultSection);
      }
      if (acceptanceGate) {
        const acceptanceSection = createElement(ownerDocument, "section", "memory-detail-card");
        acceptanceSection.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailAcceptanceGate", {}, "Acceptance Gate")));
        appendDetailGrid(ownerDocument, acceptanceSection, [
          createDetailCard(ownerDocument, t("subtasks.detailAcceptanceGateStatus", {}, "Gate Status"), acceptanceGate.status || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailAcceptanceGateDoneCheck", {}, "Done Definition Check"), acceptanceGate.doneDefinitionCheck || "-"),
          createDetailCard(ownerDocument, t("subtasks.detailAcceptanceGateRequiredSections", {}, "Required Sections"), formatJoinedValues(acceptanceGate.requiredSections)),
          createDetailCard(ownerDocument, t("subtasks.detailAcceptanceGateMissingSections", {}, "Missing Sections"), formatJoinedValues(acceptanceGate.missingRequiredSections)),
        ]);
        acceptanceSection.append(createElement(ownerDocument, "div", "memory-detail-text", acceptanceGate.summary || "-"));
        if (Array.isArray(acceptanceGate.reasons) && acceptanceGate.reasons.length) {
          acceptanceSection.append(createMeta(ownerDocument, [acceptanceGate.reasons.join(" | ")]));
        }
        sections.append(acceptanceSection);
      }
      for (const artifact of artifactEntries) {
        const artifactSection = createElement(ownerDocument, "section", "memory-detail-card");
        const artifactHeader = createElement(ownerDocument, "div", "subtask-output-header");
        artifactHeader.append(createElement(ownerDocument, "span", "memory-detail-label", artifact.label));
        if (artifact.path) {
          artifactHeader.append(createButton(ownerDocument, "memory-path-link", t("subtasks.openArtifactPath", {}, "Open path"), "data-open-source", artifact.path));
        }
        artifactSection.append(artifactHeader);
        if (artifact.path) artifactSection.append(createMeta(ownerDocument, [t("subtasks.detailArtifactPath", {}, "Artifact Path"), artifact.path]));
        artifactSection.append(artifact.content
          ? createElement(ownerDocument, "pre", "memory-detail-pre", artifact.content)
          : createElement(ownerDocument, "div", "memory-detail-text", artifact.emptyMessage));
        sections.append(artifactSection);
      }
      if (worktreeStatus) {
        const worktreeNote = createElement(ownerDocument, "section", "memory-detail-card");
        worktreeNote.append(
          createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailLaunchWorktreeStatusNote", {}, "Worktree Status Note")),
          createElement(ownerDocument, "div", "memory-detail-text", worktreeStatusDescription),
        );
        sections.append(worktreeNote);
      }
      if (item?.launchSpec?.worktreeError) sections.append(createPreCard(ownerDocument, t("subtasks.detailLaunchWorktreeError", {}, "Worktree Error"), item.launchSpec.worktreeError));
      if (item?.error) sections.append(createPreCard(ownerDocument, t("subtasks.detailError", {}, "Error"), item.error));
      if (item?.archiveReason) {
        const archiveSection = createElement(ownerDocument, "section", "memory-detail-card");
        archiveSection.append(
          createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailArchiveReason", {}, "Archive Reason")),
          createElement(ownerDocument, "div", "memory-detail-text", item.archiveReason),
        );
        sections.append(archiveSection);
      }
      const notificationsSection = createElement(ownerDocument, "section", "memory-detail-card");
      notificationsSection.append(
        createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailNotifications", {}, "Notifications")),
        createNotificationRecords(ownerDocument, item.notifications, {
          emptyMessage: t("subtasks.noNotifications", {}, "No notifications yet."),
          formatStatus: (record) => formatNotificationKindLabel(record?.kind, t),
          formatDate: (record) => formatDateTime(record?.createdAt),
          t,
        }),
      );
      sections.append(notificationsSection);
      const outputSection = createElement(ownerDocument, "section", "memory-detail-card");
      const outputHeader = createElement(ownerDocument, "div", "subtask-output-header");
      outputHeader.append(createElement(ownerDocument, "span", "memory-detail-label", t("subtasks.detailOutput", {}, "Output")));
      if (item?.outputPath) outputHeader.append(createButton(ownerDocument, "memory-path-link", t("subtasks.openOutputPath", {}, "Open output path"), "data-open-output-path", item.outputPath));
      outputSection.append(outputHeader);
      if (item?.outputPath) outputSection.append(createMeta(ownerDocument, [t("subtasks.detailOutputPath", {}, "Output Path"), item.outputPath]));
      outputSection.append(outputText
        ? createElement(ownerDocument, "pre", "memory-detail-pre", outputText)
        : createElement(ownerDocument, "div", "memory-detail-text", t("subtasks.noOutput", {}, "No output yet.")));
      sections.append(outputSection);

      shell.append(sections);
      subtasksDetailEl.replaceChildren(shell);
      return shell;
    },
  };
}
