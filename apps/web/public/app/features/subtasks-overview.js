import { buildLaunchExplainabilityLines } from "./agent-launch-explainability.js";
import {
  buildContinuationAction,
  decodeContinuationAction,
  encodeContinuationAction,
  formatContinuationTargetLabel,
} from "./continuation-targets.js";
import { createSubtasksDetailView } from "./subtasks-detail-view.js";
import { createSubtasksOverviewListView } from "./subtasks-overview-list-view.js";
import { createSubtasksOverviewSummaryView } from "./subtasks-overview-summary-view.js";

function formatSubtaskStatus(status) {
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
    case "interrupted":
      return "运行已中断";
    default:
      return "等待中";
  }
}

function getStatusToneClass(status) {
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
    case "interrupted":
      return "is-timeout";
    default:
      return "is-pending";
  }
}

function renderDetailCard(label, value, escapeHtml) {
  return `
    <div class="memory-detail-card">
      <span class="memory-detail-label">${escapeHtml(label)}</span>
      <div class="memory-detail-text">${escapeHtml(value || "-")}</div>
    </div>
  `;
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
      content: typeof contents.scratchContent === "string" ? contents.scratchContent : "",
      emptyMessage: t("subtasks.noScratch", {}, "No scratch memory yet."),
    },
    {
      kind: "review",
      label: t("subtasks.detailReview", {}, "Commander Review"),
      path: item?.reviewPath || "",
      content: typeof contents.reviewContent === "string" ? contents.reviewContent : "",
      emptyMessage: t("subtasks.noReview", {}, "No review record yet."),
    },
    {
      kind: "lesson",
      label: t("subtasks.detailLesson", {}, "Lessons Learned"),
      path: item?.lessonPath || "",
      content: typeof contents.lessonContent === "string" ? contents.lessonContent : "",
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

function renderExplainabilityNote(lines, escapeHtml) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  return `
    <div class="tool-settings-policy-note">
      ${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
    </div>
  `;
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

function renderBridgeGovernanceSection(item, escapeHtml, summarizeSourcePath, t) {
  const bridgeSubtaskView = item?.bridgeSubtaskView && typeof item.bridgeSubtaskView === "object"
    ? item.bridgeSubtaskView
    : null;
  const bridgeSessionView = item?.bridgeSessionView && typeof item.bridgeSessionView === "object"
    ? item.bridgeSessionView
    : null;
  if (!bridgeSubtaskView && !bridgeSessionView) {
    return "";
  }

  const summaryLines = buildBridgeGovernanceSummaryLines(item, t);
  const actions = [];
  if (bridgeSessionView?.artifactPath) {
    actions.push(`
      <button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(bridgeSessionView.artifactPath)}">
        ${escapeHtml(t("subtasks.openBridgeArtifact", {}, "Open bridge artifact"))}
      </button>
    `);
  }
  if (bridgeSessionView?.transcriptPath) {
    actions.push(`
      <button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(bridgeSessionView.transcriptPath)}">
        ${escapeHtml(t("subtasks.openBridgeTranscript", {}, "Open bridge transcript"))}
      </button>
    `);
  }

  return `
    <section class="memory-detail-card">
      <span class="memory-detail-label">${escapeHtml(t("subtasks.detailBridgeGovernance", {}, "Bridge Governance"))}</span>
      <div class="memory-detail-grid">
        ${bridgeSubtaskView ? renderDetailCard(t("subtasks.detailBridgeKind", {}, "Bridge Semantic"), bridgeSubtaskView.label || "-", escapeHtml) : ""}
        ${bridgeSessionView ? renderDetailCard(t("subtasks.detailBridgeTarget", {}, "Bridge Target"), bridgeSessionView.targetRef || "-", escapeHtml) : ""}
        ${bridgeSessionView ? renderDetailCard(t("subtasks.detailBridgeState", {}, "Runtime State"), formatBridgeRuntimeState(bridgeSessionView.runtimeState, t), escapeHtml) : ""}
        ${bridgeSessionView ? renderDetailCard(t("subtasks.detailBridgeCloseReason", {}, "Close Reason"), formatBridgeCloseReason(bridgeSessionView.closeReason, t), escapeHtml) : ""}
        ${bridgeSessionView ? renderDetailCard(t("subtasks.detailBridgeCwd", {}, "Bridge CWD"), bridgeSessionView.cwd || "-", escapeHtml) : ""}
        ${bridgeSessionView ? renderDetailCard(t("subtasks.detailBridgeCommand", {}, "Command Preview"), bridgeSessionView.commandPreview || "-", escapeHtml) : ""}
      </div>
      ${summaryLines.length ? renderExplainabilityNote(summaryLines, escapeHtml) : ""}
      ${bridgeSessionView?.artifactPath ? `<div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailBridgeArtifact", {}, "Bridge Artifact"))}</span><span>${escapeHtml(summarizeSourcePath(bridgeSessionView.artifactPath))}</span></div>` : ""}
      ${bridgeSessionView?.transcriptPath ? `<div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailBridgeTranscript", {}, "Bridge Transcript"))}</span><span>${escapeHtml(summarizeSourcePath(bridgeSessionView.transcriptPath))}</span></div>` : ""}
      ${actions.length ? `<div class="subtask-detail-actions">${actions.join("")}</div>` : ""}
    </section>
  `;
}

function renderTeamSharedStateSection(teamSharedState, escapeHtml, t) {
  if (!teamSharedState || typeof teamSharedState !== "object") {
    return "";
  }
  const roster = Array.isArray(teamSharedState.roster) ? teamSharedState.roster : [];
  const completionGate = teamSharedState.completionGate && typeof teamSharedState.completionGate === "object"
    ? teamSharedState.completionGate
    : null;
  return `
    <section class="memory-detail-card">
      <span class="memory-detail-label">${escapeHtml(t("subtasks.detailTeamSharedState", {}, "Team Shared State"))}</span>
      <div class="memory-detail-grid">
        ${renderDetailCard(t("subtasks.detailTeamId", {}, "Team ID"), teamSharedState.teamId || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamMode", {}, "Team Mode"), teamSharedState.mode || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamSharedGoal", {}, "Shared Goal"), teamSharedState.sharedGoal || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamManager", {}, "Manager Agent"), teamSharedState.managerAgentId || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamManagerIdentity", {}, "Manager Identity"), teamSharedState.managerIdentityLabel || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamCurrentLane", {}, "Current Lane"), teamSharedState.currentLaneId || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamFanInVerdict", {}, "Fan-In Verdict"), completionGate?.finalFanInVerdict || "-", escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamCompletionStatus", {}, "Completion Gate"), formatTeamCompletionGateStatus(completionGate?.status, t), escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamAcceptedLanes", {}, "Accepted Lanes"), formatJoinedValues(completionGate?.acceptedLaneIds), escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamRetryLanes", {}, "Retry Lanes"), formatJoinedValues(completionGate?.retryLaneIds), escapeHtml)}
        ${renderDetailCard(t("subtasks.detailTeamBlockerLanes", {}, "Blocker Lanes"), formatJoinedValues(completionGate?.blockerLaneIds), escapeHtml)}
      </div>
      <div class="memory-detail-text">${escapeHtml(teamSharedState.fanInSummary || completionGate?.summary || "-")}</div>
      ${Array.isArray(completionGate?.overlappingWriteScopes) && completionGate.overlappingWriteScopes.length ? `
        <div class="memory-detail-text"><strong>${escapeHtml(t("subtasks.detailTeamOverlap", {}, "Overlapping Write Scope"))}</strong></div>
        <div class="tool-settings-policy-note">
          ${completionGate.overlappingWriteScopes.map((entry) => `<div>${escapeHtml(`${entry.path}: ${formatJoinedValues(entry.laneIds)}`)}</div>`).join("")}
        </div>
      ` : ""}
      ${roster.length ? `
        <div class="memory-detail-text"><strong>${escapeHtml(t("subtasks.detailTeamRoster", {}, "Lane Roster"))}</strong></div>
        <div class="subtask-notification-list">
          ${roster.map((lane) => `
            <div class="subtask-notification-item">
              <div class="subtask-notification-head">
                <span class="memory-badge">${escapeHtml(`${lane.laneId} · ${formatTeamLaneState(lane.laneState, t)}`)}</span>
                ${lane.taskId ? `<button class="button-link" data-open-task-id="${escapeHtml(lane.taskId)}">${escapeHtml(t("subtasks.openLaneTask", {}, "Open lane task"))}</button>` : ""}
              </div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailAgentId", {}, "Agent"))}</span><span>${escapeHtml(lane.agentId || "-")}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailLaunchRole", {}, "Launch Role"))}</span><span>${escapeHtml(lane.role || "-")}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailTeamIdentityLabel", {}, "Identity Label"))}</span><span>${escapeHtml(lane.identityLabel || "-")}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailTeamAuthorityRelation", {}, "Authority Relation"))}</span><span>${escapeHtml(lane.authorityRelationToManager || "-")}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailTeamReportsTo", {}, "Reports To"))}</span><span>${escapeHtml(formatJoinedValues(lane.reportsTo))}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailTeamMayDirect", {}, "May Direct"))}</span><span>${escapeHtml(formatJoinedValues(lane.mayDirect))}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailLaunchStatus", {}, "Status"))}</span><span>${escapeHtml(lane.status || "-")}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailDelegationOwnedScope", {}, "Owned Scope"))}</span><span>${escapeHtml(lane.scopeSummary || "-")}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailTeamDependsOn", {}, "Depends On"))}</span><span>${escapeHtml(formatJoinedValues(lane.dependsOn))}</span></div>
              <div class="memory-list-item-meta"><span>${escapeHtml(t("subtasks.detailTeamHandoffTo", {}, "Handoff To"))}</span><span>${escapeHtml(formatJoinedValues(lane.handoffTo))}</span></div>
              ${lane.acceptanceGateSummary ? `<div class="memory-detail-text">${escapeHtml(lane.acceptanceGateSummary)}</div>` : ""}
              ${lane.summary ? `<div class="memory-detail-text">${escapeHtml(lane.summary)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
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

export function findSubtaskBySessionId(items, sessionId) {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId || !Array.isArray(items)) return null;
  return items.find((item) => typeof item?.sessionId === "string" && item.sessionId.trim() === normalizedSessionId) || null;
}

function renderSubtasksEmptyState(target, message) {
  if (!target) return;
  const ownerDocument = target.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = message;
  target.replaceChildren(empty);
}

export function createSubtasksOverviewFeature({
  refs,
  isConnected,
  isViewActive,
  sendReq,
  makeId,
  getSubtasksState,
  getActiveConversationId,
  escapeHtml,
  formatDateTime,
  summarizeSourcePath,
  onOpenSourcePath,
  onOpenTask,
  onOpenGoal,
  onOpenContinuationAction,
  getSelectedAgentId,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    subtasksSection,
    subtasksSummaryEl,
    subtasksListEl,
    subtasksDetailEl,
  } = refs;
  const summaryView = createSubtasksOverviewSummaryView({
    refs: { subtasksSummaryEl },
    t,
  });
  const listView = createSubtasksOverviewListView({
    refs: { subtasksListEl },
    formatStatus: formatSubtaskStatus,
    getStatusToneClass,
    formatDateTime,
    summarizeSourcePath,
    t,
  });
  const subtasksDetailView = createSubtasksDetailView({
    refs: { subtasksDetailEl },
    formatDateTime,
    summarizeSourcePath,
    t,
  });
  let liveUpdateDisposed = false;

  function getEmptyStateMessage(subtasksState) {
    if (subtasksState?.includeArchived === true) {
      return t("subtasks.emptyNoTasks", {}, "No subtasks to display.");
    }
    return t("subtasks.emptyNoVisibleTasks", {}, "No subtasks to display. Archived tasks are hidden by default.");
  }

  function renderSubtasksSummary(items) {
    summaryView.render(items);
  }

  function renderSubtasksListEmpty(message) {
    renderSubtasksEmptyState(subtasksListEl, message);
  }

  function renderSubtasksDetailEmpty(message) {
    renderSubtasksEmptyState(subtasksDetailEl, message);
  }

  function renderSubtasksLoading(message) {
    renderSubtasksSummary([]);
    renderSubtasksListEmpty(message);
    renderSubtasksDetailEmpty(t("subtasks.detailSelect", {}, "Select a subtask on the left to view details."));
  }

  function renderSubtasksEmpty(message) {
    renderSubtasksSummary([]);
    renderSubtasksListEmpty(message);
    renderSubtasksDetailEmpty(t("subtasks.detailSelect", {}, "Select a subtask on the left to view details."));
  }

  function bindListActions() {
    if (!subtasksListEl) return;
    subtasksListEl.querySelectorAll("[data-subtask-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-subtask-id");
        if (!taskId) return;
        const subtasksState = getSubtasksState();
        subtasksState.selectedId = taskId;
        renderSubtaskList(subtasksState.items);
        void loadSubtaskDetail(taskId);
      });
    });
  }

  function bindDetailActions() {
    if (!subtasksDetailEl) return;
    subtasksDetailEl.querySelectorAll("[data-open-output-path]").forEach((node) => {
      node.addEventListener("click", () => {
        const outputPath = node.getAttribute("data-open-output-path");
        if (!outputPath) return;
        void onOpenSourcePath(outputPath);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-open-source]").forEach((node) => {
      node.addEventListener("click", () => {
        const sourcePath = node.getAttribute("data-open-source");
        if (!sourcePath) return;
        void onOpenSourcePath(sourcePath);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-open-task-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-open-task-id");
        if (!taskId) return;
        void onOpenTask?.(taskId);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-open-goal-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-open-goal-id");
        if (!goalId) return;
        void onOpenGoal?.(goalId);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-continuation-action]").forEach((node) => {
      node.addEventListener("click", () => {
        if (typeof onOpenContinuationAction !== "function") return;
        const action = decodeContinuationAction(node.getAttribute("data-continuation-action") || "");
        if (!action) return;
        void onOpenContinuationAction(action);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-stop]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-subtask-stop");
        if (!taskId) return;
        void performSubtaskAction("subtask.stop", taskId);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-archive]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-subtask-archive");
        if (!taskId) return;
        const confirmed = window.confirm(t("subtasks.archiveConfirm", {}, "Archive this subtask?"));
        if (!confirmed) return;
        void performSubtaskAction("subtask.archive", taskId);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-steering-send]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-subtask-steering-send");
        if (!taskId) return;
        const input = subtasksDetailEl.querySelector(`[data-subtask-steering-input="${taskId}"]`);
        const message = typeof input?.value === "string" ? input.value.trim() : "";
        if (!message) return;
        void performSubtaskSteering(taskId, message);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-steering-input]").forEach((node) => {
      node.addEventListener("input", () => {
        const taskId = node.getAttribute("data-subtask-steering-input");
        if (!taskId) return;
        const subtasksState = getSubtasksState();
        if (!subtasksState.steeringDrafts || typeof subtasksState.steeringDrafts !== "object") {
          subtasksState.steeringDrafts = {};
        }
        subtasksState.steeringDrafts[taskId] = node.value;
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-resume-send]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-subtask-resume-send");
        if (!taskId) return;
        const input = subtasksDetailEl.querySelector(`[data-subtask-resume-input="${taskId}"]`);
        const message = typeof input?.value === "string" ? input.value.trim() : "";
        void performSubtaskResume(taskId, message);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-resume-input]").forEach((node) => {
      node.addEventListener("input", () => {
        const taskId = node.getAttribute("data-subtask-resume-input");
        if (!taskId) return;
        const subtasksState = getSubtasksState();
        if (!subtasksState.resumeDrafts || typeof subtasksState.resumeDrafts !== "object") {
          subtasksState.resumeDrafts = {};
        }
        subtasksState.resumeDrafts[taskId] = node.value;
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-takeover-send]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-subtask-takeover-send");
        if (!taskId) return;
        const agentInput = subtasksDetailEl.querySelector(`[data-subtask-takeover-agent-input="${taskId}"]`);
        const takeoverInput = subtasksDetailEl.querySelector(`[data-subtask-takeover-input="${taskId}"]`);
        const agentId = typeof agentInput?.value === "string" ? agentInput.value.trim() : "";
        const message = typeof takeoverInput?.value === "string" ? takeoverInput.value.trim() : "";
        void performSubtaskTakeover(taskId, agentId, message);
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-takeover-agent-input]").forEach((node) => {
      node.addEventListener("input", () => {
        const taskId = node.getAttribute("data-subtask-takeover-agent-input");
        if (!taskId) return;
        const subtasksState = getSubtasksState();
        if (!subtasksState.takeoverAgentDrafts || typeof subtasksState.takeoverAgentDrafts !== "object") {
          subtasksState.takeoverAgentDrafts = {};
        }
        subtasksState.takeoverAgentDrafts[taskId] = node.value;
      });
    });
    subtasksDetailEl.querySelectorAll("[data-subtask-takeover-input]").forEach((node) => {
      node.addEventListener("input", () => {
        const taskId = node.getAttribute("data-subtask-takeover-input");
        if (!taskId) return;
        const subtasksState = getSubtasksState();
        if (!subtasksState.takeoverDrafts || typeof subtasksState.takeoverDrafts !== "object") {
          subtasksState.takeoverDrafts = {};
        }
        subtasksState.takeoverDrafts[taskId] = node.value;
      });
    });
  }

  function renderSubtaskList(items) {
    if (!subtasksListEl) return;
    const safeItems = Array.isArray(items) ? items : [];
    if (!safeItems.length) {
      renderSubtasksListEmpty(getEmptyStateMessage(getSubtasksState()));
      return;
    }

    const subtasksState = getSubtasksState();
    const activeConversationId = getActiveConversationId();
    const isFilteredToConversation = Boolean(subtasksState.conversationId);
    const continuationFocusSessionId = typeof subtasksState.continuationFocusSessionId === "string"
      ? subtasksState.continuationFocusSessionId.trim()
      : "";

    listView.render({
      items: safeItems,
      selectedId: subtasksState.selectedId,
      activeConversationId,
      conversationId: isFilteredToConversation ? subtasksState.conversationId : "",
      continuationFocusSessionId,
    });

    bindListActions();
  }

  function renderSubtaskDetail(item, outputContent = "") {
    if (!subtasksDetailEl) return;
    if (!item) {
      renderSubtasksDetailEmpty(t("subtasks.detailSelect", {}, "Select a subtask on the left to view details."));
      return;
    }

    const subtasksState = getSubtasksState();
    const selectedAgentId = typeof getSelectedAgentId === "function"
      ? String(getSelectedAgentId() || "").trim()
      : "";
    const takeoverAgentDraft = typeof subtasksState.takeoverAgentDrafts?.[item.id] === "string"
      ? subtasksState.takeoverAgentDrafts[item.id]
      : selectedAgentId && selectedAgentId !== item.agentId
        ? selectedAgentId
        : "";

    subtasksDetailView.render({
      item,
      outputContent,
      pendingActionKind: subtasksState.pendingActionTaskId === item.id ? subtasksState.pendingActionKind : null,
      resultEnvelope: subtasksState.selectedResultEnvelope?.taskId === item.id
        ? subtasksState.selectedResultEnvelope
        : null,
      launchExplainability: subtasksState.selectedLaunchExplainability?.taskId === item.id
        ? subtasksState.selectedLaunchExplainability.value
        : null,
      promptSnapshotView: subtasksState.selectedPromptSnapshot?.taskId === item.id
        ? subtasksState.selectedPromptSnapshot.value
        : null,
      scratchText: typeof subtasksState.selectedScratchContent === "string" ? subtasksState.selectedScratchContent : "",
      reviewText: typeof subtasksState.selectedReviewContent === "string" ? subtasksState.selectedReviewContent : "",
      lessonText: typeof subtasksState.selectedLessonContent === "string" ? subtasksState.selectedLessonContent : "",
      acceptanceGate: subtasksState.selectedAcceptanceGate?.taskId === item.id
        ? subtasksState.selectedAcceptanceGate.value
        : null,
      teamSharedState: subtasksState.selectedTeamSharedState?.taskId === item.id
        ? subtasksState.selectedTeamSharedState.value
        : null,
      continuationState: subtasksState.selectedContinuationState?.taskId === item.id
        ? subtasksState.selectedContinuationState.value
        : null,
      steeringDraft: typeof subtasksState.steeringDrafts?.[item.id] === "string" ? subtasksState.steeringDrafts[item.id] : "",
      resumeDraft: typeof subtasksState.resumeDrafts?.[item.id] === "string" ? subtasksState.resumeDrafts[item.id] : "",
      takeoverDraft: typeof subtasksState.takeoverDrafts?.[item.id] === "string" ? subtasksState.takeoverDrafts[item.id] : "",
      takeoverAgentDraft,
      continuationFocusSessionId: typeof subtasksState.continuationFocusSessionId === "string"
        ? subtasksState.continuationFocusSessionId.trim()
        : "",
    });

    bindDetailActions();
  }

  async function loadSubtaskDetail(taskId, options = {}) {
    if (!taskId) return;
    const subtasksState = getSubtasksState();
    const seq = subtasksState.detailSeq + 1;
    subtasksState.detailSeq = seq;
    subtasksState.detailLoading = true;
    renderSubtaskList(subtasksState.items);
    if (!options.quiet) {
      renderSubtasksDetailEmpty(t("subtasks.detailLoading", {}, "Loading subtask details..."));
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "subtask.get",
      params: { taskId },
    });

    if (seq !== subtasksState.detailSeq) return;
    subtasksState.detailLoading = false;

    if (!res || !res.ok || !res.payload?.item) {
      subtasksState.selectedItem = null;
      subtasksState.selectedOutputContent = "";
      subtasksState.selectedScratchContent = "";
      subtasksState.selectedReviewContent = "";
      subtasksState.selectedLessonContent = "";
      subtasksState.selectedContinuationState = null;
      subtasksState.selectedAcceptanceGate = null;
      subtasksState.selectedTeamSharedState = null;
      subtasksState.selectedResultEnvelope = null;
      subtasksState.selectedLaunchExplainability = null;
      subtasksState.selectedPromptSnapshot = null;
      renderSubtasksDetailEmpty(res?.error?.message || t("subtasks.detailLoadFailed", {}, "Failed to load subtask details."));
      return;
    }

    const item = res.payload.item;
    subtasksState.selectedId = item.id;
    subtasksState.selectedItem = item;
    subtasksState.selectedOutputContent = typeof res.payload.outputContent === "string" ? res.payload.outputContent : "";
    subtasksState.selectedScratchContent = typeof res.payload.scratchContent === "string" ? res.payload.scratchContent : "";
    subtasksState.selectedReviewContent = typeof res.payload.reviewContent === "string" ? res.payload.reviewContent : "";
    subtasksState.selectedLessonContent = typeof res.payload.lessonContent === "string" ? res.payload.lessonContent : "";
    subtasksState.selectedContinuationState = res.payload?.continuationState && typeof res.payload.continuationState === "object"
      ? { taskId: item.id, value: res.payload.continuationState }
      : null;
    subtasksState.selectedAcceptanceGate = res.payload?.acceptanceGate && typeof res.payload.acceptanceGate === "object"
      ? { taskId: item.id, value: res.payload.acceptanceGate }
      : null;
    subtasksState.selectedTeamSharedState = res.payload?.teamSharedState && typeof res.payload.teamSharedState === "object"
      ? { taskId: item.id, value: res.payload.teamSharedState }
      : null;
    subtasksState.selectedResultEnvelope = res.payload?.resultEnvelope && typeof res.payload.resultEnvelope === "object"
      ? res.payload.resultEnvelope
      : null;
    subtasksState.selectedLaunchExplainability = res.payload?.launchExplainability && typeof res.payload.launchExplainability === "object"
      ? { taskId: item.id, value: res.payload.launchExplainability }
      : null;
    subtasksState.selectedPromptSnapshot = res.payload?.promptSnapshotView && typeof res.payload.promptSnapshotView === "object"
      ? { taskId: item.id, value: res.payload.promptSnapshotView }
      : null;
    subtasksState.items = subtasksState.items.map((current) => current?.id === item.id ? item : current);
    renderSubtasksSummary(subtasksState.items);
    renderSubtaskList(subtasksState.items);
    renderSubtaskDetail(item, subtasksState.selectedOutputContent);
  }

  async function performSubtaskAction(method, taskId) {
    const subtasksState = getSubtasksState();
    const item = Array.isArray(subtasksState.items)
      ? subtasksState.items.find((current) => current?.id === taskId) || subtasksState.selectedItem
      : subtasksState.selectedItem;
    if (!item) return;

    subtasksState.pendingActionTaskId = taskId;
    subtasksState.pendingActionKind = method === "subtask.stop" ? "stop" : "archive";
    if (subtasksState.selectedItem?.id === taskId) {
      renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
    } else {
      renderSubtaskList(subtasksState.items);
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method,
      params: { taskId },
    });

    subtasksState.pendingActionTaskId = null;
    subtasksState.pendingActionKind = null;

    if (!res || !res.ok || !res.payload?.item) {
      if (subtasksState.selectedItem?.id === taskId) {
        renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
      } else {
        renderSubtaskList(subtasksState.items);
      }
      showNotice?.(
        method === "subtask.stop"
          ? t("subtasks.stopFailedTitle", {}, "Stop failed")
          : t("subtasks.archiveFailedTitle", {}, "Archive failed"),
        res?.error?.message || (method === "subtask.stop"
          ? t("subtasks.stopFailed", {}, "Failed to stop subtask.")
          : t("subtasks.archiveFailed", {}, "Failed to archive subtask.")),
        "error",
      );
      return;
    }

    handleSubtaskUpdate({
      kind: method === "subtask.stop" ? "stopped" : "archived",
      item: res.payload.item,
    });
    showNotice?.(
      method === "subtask.stop"
        ? t("subtasks.stopSuccessTitle", {}, "Subtask stopped")
        : t("subtasks.archiveSuccessTitle", {}, "Subtask archived"),
      method === "subtask.stop"
        ? t("subtasks.stopSuccess", {}, "The subtask has been stopped.")
        : t("subtasks.archiveSuccess", {}, "The subtask has been archived."),
      "info",
    );
  }

  async function performSubtaskSteering(taskId, message) {
    const subtasksState = getSubtasksState();
    subtasksState.pendingActionTaskId = taskId;
    subtasksState.pendingActionKind = "steering";
    if (subtasksState.selectedItem?.id === taskId) {
      renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "subtask.update",
      params: { taskId, message },
    });

    subtasksState.pendingActionTaskId = null;
    subtasksState.pendingActionKind = null;

    if (!res || !res.ok || !res.payload?.item) {
      if (subtasksState.selectedItem?.id === taskId) {
        renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
      }
      showNotice?.(
        t("subtasks.steeringFailedTitle", {}, "Steering failed"),
        res?.error?.message || t("subtasks.steeringFailedMessage", {}, "Failed to send steering to the running subtask."),
        "error",
      );
      return;
    }

    if (!subtasksState.steeringDrafts || typeof subtasksState.steeringDrafts !== "object") {
      subtasksState.steeringDrafts = {};
    }
    subtasksState.steeringDrafts[taskId] = "";
    handleSubtaskUpdate({
      kind: "updated",
      item: res.payload.item,
    });
    showNotice?.(
      t("subtasks.steeringSuccessTitle", {}, "Steering accepted"),
      t("subtasks.steeringSuccessMessage", {}, "The running subtask accepted the steering request and is relaunching with the new guidance."),
      "info",
    );
  }

  async function performSubtaskResume(taskId, message) {
    const subtasksState = getSubtasksState();
    subtasksState.pendingActionTaskId = taskId;
    subtasksState.pendingActionKind = "resume";
    if (subtasksState.selectedItem?.id === taskId) {
      renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "subtask.resume",
      params: { taskId, ...(message ? { message } : {}) },
    });

    subtasksState.pendingActionTaskId = null;
    subtasksState.pendingActionKind = null;

    if (!res || !res.ok || !res.payload?.item) {
      if (subtasksState.selectedItem?.id === taskId) {
        renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
      }
      showNotice?.(
        t("subtasks.resumeFailedTitle", {}, "Resume failed"),
        res?.error?.message || t("subtasks.resumeFailedMessage", {}, "Failed to resume the finished subtask."),
        "error",
      );
      return;
    }

    if (!subtasksState.resumeDrafts || typeof subtasksState.resumeDrafts !== "object") {
      subtasksState.resumeDrafts = {};
    }
    subtasksState.resumeDrafts[taskId] = "";
    handleSubtaskUpdate({
      kind: "updated",
      item: res.payload.item,
    });
    showNotice?.(
      t("subtasks.resumeSuccessTitle", {}, "Resume accepted"),
      t("subtasks.resumeSuccessMessage", {}, "The finished subtask accepted the resume request and is relaunching from its last recorded state."),
      "info",
    );
  }

  async function performSubtaskTakeover(taskId, agentId, message) {
    const normalizedAgentId = typeof agentId === "string" ? agentId.trim() : "";
    if (!normalizedAgentId) {
      showNotice?.(
        t("subtasks.takeoverFailedTitle", {}, "Takeover failed"),
        t("subtasks.takeoverMissingAgentMessage", {}, "Agent ID is required for takeover."),
        "error",
      );
      return;
    }

    const subtasksState = getSubtasksState();
    subtasksState.pendingActionTaskId = taskId;
    subtasksState.pendingActionKind = "takeover";
    if (subtasksState.selectedItem?.id === taskId) {
      renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "subtask.takeover",
      params: { taskId, agentId: normalizedAgentId, ...(message ? { message } : {}) },
    });

    subtasksState.pendingActionTaskId = null;
    subtasksState.pendingActionKind = null;

    if (!res || !res.ok || !res.payload?.item) {
      if (subtasksState.selectedItem?.id === taskId) {
        renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
      }
      showNotice?.(
        t("subtasks.takeoverFailedTitle", {}, "Takeover failed"),
        res?.error?.message || t("subtasks.takeoverFailedMessage", {}, "Failed to take over the finished subtask."),
        "error",
      );
      return;
    }

    if (!subtasksState.takeoverAgentDrafts || typeof subtasksState.takeoverAgentDrafts !== "object") {
      subtasksState.takeoverAgentDrafts = {};
    }
    subtasksState.takeoverAgentDrafts[taskId] = normalizedAgentId;
    if (!subtasksState.takeoverDrafts || typeof subtasksState.takeoverDrafts !== "object") {
      subtasksState.takeoverDrafts = {};
    }
    subtasksState.takeoverDrafts[taskId] = "";
    handleSubtaskUpdate({
      kind: "updated",
      item: res.payload.item,
    });
    const takeoverMode = Array.isArray(res.payload.item?.takeover) && res.payload.item.takeover.length
      ? res.payload.item.takeover[res.payload.item.takeover.length - 1]?.mode
      : null;
    showNotice?.(
      t("subtasks.takeoverSuccessTitle", {}, "Takeover accepted"),
      takeoverMode === "safe_point"
        ? t("subtasks.takeoverSafePointSuccessMessage", { agentId: normalizedAgentId }, "The running subtask accepted safe-point takeover and is relaunching under {agentId}.")
        : t("subtasks.takeoverSuccessMessage", { agentId: normalizedAgentId }, "The finished subtask is relaunching under {agentId}."),
      "info",
    );
  }

  async function loadSubtasks(forceSelectFirst = false) {
    if (!subtasksSection) return;
    if (!isConnected()) {
      const subtasksState = getSubtasksState();
      subtasksState.loading = false;
      subtasksState.detailLoading = false;
      renderSubtasksLoading(t("subtasks.loadingDisconnected", {}, "Disconnected"));
      return;
    }

    const subtasksState = getSubtasksState();
    subtasksState.loading = true;
    subtasksState.detailLoading = false;
    const seq = subtasksState.loadSeq + 1;
    subtasksState.loadSeq = seq;
    renderSubtasksLoading(t("subtasks.loading", {}, "Loading..."));

    const activeConversationId = getActiveConversationId();
    const linkedSessionContext = subtasksState.linkedSessionContext && typeof subtasksState.linkedSessionContext === "object"
      ? subtasksState.linkedSessionContext
      : null;
    const effectiveConversationId = activeConversationId
      && linkedSessionContext?.sessionId === activeConversationId
      && linkedSessionContext.parentConversationId
      ? linkedSessionContext.parentConversationId
      : activeConversationId;
    const params = {
      ...(effectiveConversationId ? { conversationId: effectiveConversationId } : {}),
      includeArchived: subtasksState.includeArchived === true,
    };
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "subtask.list",
      params,
    });

    if (seq !== subtasksState.loadSeq) return;
    subtasksState.loading = false;

    if (!res || !res.ok || !Array.isArray(res.payload?.items)) {
      subtasksState.items = [];
      subtasksState.selectedId = null;
      subtasksState.selectedItem = null;
      subtasksState.selectedOutputContent = "";
      subtasksState.selectedScratchContent = "";
      subtasksState.selectedReviewContent = "";
      subtasksState.selectedLessonContent = "";
      subtasksState.selectedContinuationState = null;
      subtasksState.selectedAcceptanceGate = null;
      subtasksState.selectedTeamSharedState = null;
      subtasksState.selectedResultEnvelope = null;
      subtasksState.selectedLaunchExplainability = null;
      subtasksState.selectedPromptSnapshot = null;
      renderSubtasksEmpty(res?.error?.message || t("subtasks.listLoadFailed", {}, "Failed to load subtask list."));
      return;
    }

    const items = res.payload.items;
    subtasksState.items = items;
    subtasksState.conversationId = res.payload?.conversationId || null;
    renderSubtasksSummary(items);

    if (!items.length) {
      subtasksState.selectedId = null;
      subtasksState.selectedItem = null;
      subtasksState.selectedOutputContent = "";
      subtasksState.selectedScratchContent = "";
      subtasksState.selectedReviewContent = "";
      subtasksState.selectedLessonContent = "";
      subtasksState.selectedContinuationState = null;
      subtasksState.selectedAcceptanceGate = null;
      subtasksState.selectedTeamSharedState = null;
      subtasksState.selectedResultEnvelope = null;
      subtasksState.selectedLaunchExplainability = null;
      subtasksState.selectedPromptSnapshot = null;
      renderSubtasksEmpty(getEmptyStateMessage(subtasksState));
      return;
    }

    const linkedSessionId = linkedSessionContext?.sessionId || "";
    const linkedTaskId = linkedSessionContext?.taskId || "";
    const linkedItem = linkedSessionId ? findSubtaskBySessionId(items, linkedSessionId) : null;
    const selectedExists = items.some((item) => item?.id === subtasksState.selectedId);
    if (forceSelectFirst || !selectedExists) {
      subtasksState.selectedId = linkedItem?.id || linkedTaskId || items[0].id;
    }

    renderSubtaskList(items);
    await loadSubtaskDetail(subtasksState.selectedId);
  }

  function refreshLocale() {
    if (!subtasksSection) return;
    const subtasksState = getSubtasksState();
    if (!isConnected()) {
      renderSubtasksLoading(t("subtasks.loadingDisconnected", {}, "Disconnected"));
      return;
    }
    if (subtasksState.loading) {
      renderSubtasksLoading(t("subtasks.loading", {}, "Loading..."));
      return;
    }
    renderSubtasksSummary(subtasksState.items);
    renderSubtaskList(subtasksState.items);
    if (subtasksState.detailLoading) {
      renderSubtasksDetailEmpty(t("subtasks.detailLoading", {}, "Loading subtask details..."));
      return;
    }
    if (subtasksState.selectedItem && subtasksState.selectedItem.id === subtasksState.selectedId) {
      renderSubtaskDetail(subtasksState.selectedItem, subtasksState.selectedOutputContent);
      return;
    }
    if (Array.isArray(subtasksState.items) && subtasksState.items.length === 0 && subtasksState.loadSeq > 0) {
      renderSubtasksDetailEmpty(t("subtasks.detailSelect", {}, "Select a subtask on the left to view details."));
      return;
    }
    renderSubtasksDetailEmpty(t("subtasks.detailSelect", {}, "Select a subtask on the left to view details."));
  }

  function flushSubtaskUpdate(taskId) {
    if (liveUpdateDisposed) return;
    const subtasksState = getSubtasksState();
    if (subtasksState.liveUpdateTimers?.[taskId]) {
      clearTimeout(subtasksState.liveUpdateTimers[taskId]);
      delete subtasksState.liveUpdateTimers[taskId];
    }
    const pending = subtasksState.liveUpdatePending?.[taskId];
    if (!pending?.item) return;
    delete subtasksState.liveUpdatePending[taskId];

    const item = pending.item;
    const includeArchived = subtasksState.includeArchived === true;
    const matchesConversation = !subtasksState.conversationId || item.parentConversationId === subtasksState.conversationId;
    const nextItems = Array.isArray(subtasksState.items) ? [...subtasksState.items] : [];
    const existingIndex = nextItems.findIndex((current) => current?.id === item.id);

    if (!matchesConversation || (!includeArchived && item.archivedAt)) {
      if (existingIndex >= 0) {
        nextItems.splice(existingIndex, 1);
      }
      if (subtasksState.selectedId === item.id && item.archivedAt && !includeArchived) {
        subtasksState.selectedItem = item;
        subtasksState.selectedOutputContent = "";
        subtasksState.selectedScratchContent = "";
        subtasksState.selectedReviewContent = "";
        subtasksState.selectedLessonContent = "";
      }
    } else if (existingIndex >= 0) {
      nextItems.splice(existingIndex, 1, item);
    } else {
      nextItems.unshift(item);
    }

    subtasksState.items = nextItems.sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
    if (subtasksState.selectedId === item.id) {
      subtasksState.selectedItem = item;
    }

    if (Array.isArray(subtasksState.items) && subtasksState.items.length === 0) {
      subtasksState.selectedId = null;
      subtasksState.selectedItem = null;
      subtasksState.selectedOutputContent = "";
      subtasksState.selectedScratchContent = "";
      subtasksState.selectedReviewContent = "";
      subtasksState.selectedLessonContent = "";
      subtasksState.selectedContinuationState = null;
      subtasksState.selectedAcceptanceGate = null;
      subtasksState.selectedTeamSharedState = null;
      subtasksState.selectedResultEnvelope = null;
      subtasksState.selectedLaunchExplainability = null;
      subtasksState.selectedPromptSnapshot = null;
      if (isViewActive?.()) {
        renderSubtasksEmpty(getEmptyStateMessage(subtasksState));
      }
      return;
    }

    if (!subtasksState.selectedId && subtasksState.items[0]?.id) {
      subtasksState.selectedId = subtasksState.items[0].id;
    }

    if (!isViewActive?.()) {
      return;
    }

    renderSubtasksSummary(subtasksState.items);
    renderSubtaskList(subtasksState.items);
    if (subtasksState.selectedId === item.id) {
      if (item.archivedAt && !includeArchived) {
        renderSubtaskDetail(item, subtasksState.selectedOutputContent);
      } else {
        void loadSubtaskDetail(item.id, { quiet: true });
      }
    }
  }

  function handleSubtaskUpdate(payload) {
    if (liveUpdateDisposed) return;
    const item = payload && payload.item && typeof payload.item === "object" ? payload.item : null;
    const taskId = typeof item?.id === "string" ? item.id : "";
    if (!taskId) return;
    const subtasksState = getSubtasksState();
    if (!subtasksState.liveUpdatePending || typeof subtasksState.liveUpdatePending !== "object") {
      subtasksState.liveUpdatePending = {};
    }
    if (!subtasksState.liveUpdateTimers || typeof subtasksState.liveUpdateTimers !== "object") {
      subtasksState.liveUpdateTimers = {};
    }
    subtasksState.liveUpdatePending[taskId] = { item, kind: payload?.kind || "updated" };
    if (subtasksState.liveUpdateTimers[taskId]) {
      clearTimeout(subtasksState.liveUpdateTimers[taskId]);
    }
    subtasksState.liveUpdateTimers[taskId] = setTimeout(() => {
      flushSubtaskUpdate(taskId);
    }, subtasksState.liveUpdateDelayMs || 120);
  }

  function clearLiveUpdates() {
    const subtasksState = getSubtasksState();
    for (const timer of Object.values(subtasksState.liveUpdateTimers || {})) {
      clearTimeout(timer);
    }
    // pending item 带有完整输出元数据，必须与其 debounce timer 在同一 owner 内释放。
    subtasksState.liveUpdateTimers = {};
    subtasksState.liveUpdatePending = {};
  }

  function dispose() {
    if (liveUpdateDisposed) return;
    liveUpdateDisposed = true;
    clearLiveUpdates();
  }

  function getRuntimeSnapshot() {
    const subtasksState = getSubtasksState();
    return {
      pendingUpdateCount: Object.keys(subtasksState.liveUpdatePending || {}).length,
      activeTimerCount: Object.keys(subtasksState.liveUpdateTimers || {}).length,
      disposed: liveUpdateDisposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    loadSubtasks,
    loadSubtaskDetail,
    refreshLocale,
    handleSubtaskUpdate,
    renderSubtasksSummary,
    renderSubtaskList,
    renderSubtaskDetail,
  };
}
