import { buildGoalCheckpointExplainabilityEntry } from "./goal-launch-explainability.js";
import {
  buildBridgeGovernanceSummaryLines,
  formatBridgeCloseReason,
  formatBridgeRuntimeState,
} from "./subtasks-overview.js";
import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

export function getGoalTrackingNodeActionTargets(node) {
  const taskId = typeof node?.lastRunId === "string" && node.lastRunId.trim()
    ? node.lastRunId.trim()
    : "";
  const artifactPaths = Array.isArray(node?.artifacts)
    ? node.artifacts
      .map((item) => typeof item === "string" ? item.trim() : "")
      .filter(Boolean)
      .slice(0, 2)
    : [];
  const bridgeSessionView = node?.bridgeSessionView && typeof node.bridgeSessionView === "object"
    ? node.bridgeSessionView
    : null;
  const artifactPathSet = new Set(artifactPaths);
  const bridgeArtifactPath = typeof bridgeSessionView?.artifactPath === "string" && bridgeSessionView.artifactPath.trim()
    && !artifactPathSet.has(bridgeSessionView.artifactPath.trim())
    ? bridgeSessionView.artifactPath.trim()
    : "";
  if (bridgeArtifactPath) {
    artifactPathSet.add(bridgeArtifactPath);
  }
  const bridgeTranscriptPath = typeof bridgeSessionView?.transcriptPath === "string" && bridgeSessionView.transcriptPath.trim()
    && !artifactPathSet.has(bridgeSessionView.transcriptPath.trim())
    ? bridgeSessionView.transcriptPath.trim()
    : "";
  return {
    taskId,
    artifactPaths,
    bridgeArtifactPath,
    bridgeTranscriptPath,
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function renderGoalTrackingNodeBridgeGovernance(node, escapeHtml, summarizeSourcePath, t) {
  const bridgeSubtaskView = node?.bridgeSubtaskView && typeof node.bridgeSubtaskView === "object"
    ? node.bridgeSubtaskView
    : null;
  const bridgeSessionView = node?.bridgeSessionView && typeof node.bridgeSessionView === "object"
    ? node.bridgeSessionView
    : null;
  if (!bridgeSubtaskView && !bridgeSessionView) return "";

  const summaryLines = buildBridgeGovernanceSummaryLines(node, t);
  return `
    <div class="goal-checkpoint-meta">
      <span class="memory-badge">${escapeHtml(t("goals.trackingBridgeGovernance", {}, "Bridge Governance"))}</span>
      ${bridgeSessionView?.runtimeState ? `<span class="memory-badge">${escapeHtml(formatBridgeRuntimeState(bridgeSessionView.runtimeState, t))}</span>` : ""}
      ${bridgeSessionView?.closeReason ? `<span class="memory-badge">${escapeHtml(formatBridgeCloseReason(bridgeSessionView.closeReason, t))}</span>` : ""}
    </div>
    ${summaryLines.length ? `
      <div class="tool-settings-policy-note">
        ${summaryLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
      </div>
    ` : ""}
    ${bridgeSessionView?.artifactPath ? `
      <div class="memory-list-item-meta">
        <span>${escapeHtml(t("goals.trackingBridgeArtifact", {}, "Bridge Artifact"))}</span>
        <span>${escapeHtml(summarizeSourcePath(bridgeSessionView.artifactPath))}</span>
      </div>
    ` : ""}
    ${bridgeSessionView?.transcriptPath ? `
      <div class="memory-list-item-meta">
        <span>${escapeHtml(t("goals.trackingBridgeTranscript", {}, "Bridge Transcript"))}</span>
        <span>${escapeHtml(summarizeSourcePath(bridgeSessionView.transcriptPath))}</span>
      </div>
    ` : ""}
  `;
}

function getGoalTrackingPlanUpdatedAt(plan) {
  const rawValue = normalizeString(plan?.updatedAt) || normalizeString(plan?.generatedAt);
  const timestamp = rawValue ? new Date(rawValue).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildGoalTrackingCapabilityPlanIndex(plans) {
  return (Array.isArray(plans) ? plans : []).reduce((index, plan) => {
    const nodeId = normalizeString(plan?.nodeId);
    if (!nodeId) return index;
    const current = index[nodeId];
    if (!current || getGoalTrackingPlanUpdatedAt(plan) >= getGoalTrackingPlanUpdatedAt(current)) {
      index[nodeId] = plan;
    }
    return index;
  }, {});
}

export function getGoalTrackingCheckpointExplainabilityLines(checkpoint, capabilityPlansByNodeId, t) {
  const nodeId = normalizeString(checkpoint?.nodeId);
  if (!nodeId || !capabilityPlansByNodeId || typeof capabilityPlansByNodeId !== "object") return [];
  const plan = capabilityPlansByNodeId[nodeId];
  const entry = buildGoalCheckpointExplainabilityEntry(plan, t);
  return Array.isArray(entry?.lines) ? entry.lines.slice(0, 2) : [];
}

export function filterGoalTrackingCheckpointsByNode(checkpoints, nodeId) {
  const normalizedNodeId = normalizeString(nodeId);
  if (!normalizedNodeId) return Array.isArray(checkpoints) ? checkpoints : [];
  return (Array.isArray(checkpoints) ? checkpoints : []).filter((item) => normalizeString(item?.nodeId) === normalizedNodeId);
}

function renderGoalTrackingFreshnessSummary(memoryFreshness, escapeHtml) {
  const summary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
    ? memoryFreshness.summary
    : null;
  if (!summary?.available || !summary.headline) {
    return "";
  }
  return `
    <div class="tool-settings-policy-note">
      <strong>治理 freshness：</strong>${escapeHtml(summary.headline)}
    </div>
  `;
}

export function createGoalsTrackingPanelFeature({
  refs,
  escapeHtml,
  formatDateTime,
  getGoalCheckpointSlaBadge,
  summarizeSourcePath = (value) => value,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsDetailEl } = refs;

  function formatNodeStatus(status) {
    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "completed" || normalized === "done") return "已完成";
    if (normalized === "running" || normalized === "executing" || normalized === "in_progress") return "运行中";
    if (normalized === "blocked") return "阻塞";
    if (normalized === "ready") return "就绪";
    if (normalized === "pending") return "待处理";
    return status;
  }

  function formatCheckpointStatus(status) {
    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "waiting_user" || normalized === "required") return "待处理";
    if (normalized === "approved") return "已批准";
    if (normalized === "rejected") return "已拒绝";
    if (normalized === "expired") return "已过期";
    if (normalized === "reopened") return "已重新打开";
    return status;
  }

  function formatCheckpointHistoryAction(action) {
    const normalized = typeof action === "string" ? action.trim().toLowerCase() : "";
    if (!normalized) return "记录";
    if (normalized === "approve" || normalized === "approved") return "批准";
    if (normalized === "reject" || normalized === "rejected") return "拒绝";
    if (normalized === "expire" || normalized === "expired") return "标记过期";
    if (normalized === "reopen" || normalized === "reopened") return "重新打开";
    if (normalized === "request" || normalized === "requested") return "发起";
    return action;
  }

  function renderGoalTrackingPanelLoading() {
    const panel = goalsDetailEl?.querySelector("#goalTrackingPanel");
    if (!panel) return;
    panel.innerHTML = '<div class="memory-viewer-empty">正在读取 tasks.json / checkpoints.json …</div>';
  }

  function renderGoalTrackingPanel(goal, payload) {
    const panel = goalsDetailEl?.querySelector("#goalTrackingPanel");
    if (!panel) return;
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();
    const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
    const checkpoints = Array.isArray(payload?.checkpoints) ? payload.checkpoints : [];
    const capabilityPlansByNodeId = buildGoalTrackingCapabilityPlanIndex(payload?.capabilityPlans);
    const completedNodeCount = nodes.filter((node) => node.status === "completed").length;
    const runningNodeCount = nodes.filter((node) => node.status === "running").length;
    const blockedNodeCount = nodes.filter((node) => node.status === "blocked").length;
    const waitingCheckpointCount = checkpoints.filter((item) => item.status === "waiting_user" || item.status === "required").length;
    const approvedCheckpointCount = checkpoints.filter((item) => item.status === "approved").length;
    const rejectedCheckpointCount = checkpoints.filter((item) => item.status === "rejected").length;
    const recentNodes = nodes.slice(0, 6);
    const recentCheckpoints = checkpoints
      .slice()
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 6);
    const focusNodeId = normalizeString(payload?.focusNodeId);
    const focusedCheckpoints = filterGoalTrackingCheckpointsByNode(recentCheckpoints, focusNodeId);
    const visibleCheckpoints = focusNodeId ? focusedCheckpoints : recentCheckpoints;
    const freshnessSummaryHtml = renderGoalTrackingFreshnessSummary(payload?.memoryFreshness, escapeHtml);

    panel.innerHTML = `
      ${freshnessSummaryHtml}
      <div class="goal-tracking-stats">
        <div class="goal-summary-item">
          <span class="goal-summary-label">节点总数</span>
          <strong class="goal-summary-value">${escapeHtml(String(nodes.length))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">已完成</span>
          <strong class="goal-summary-value">${escapeHtml(String(completedNodeCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">进行中</span>
          <strong class="goal-summary-value">${escapeHtml(String(runningNodeCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">阻塞</span>
          <strong class="goal-summary-value">${escapeHtml(String(blockedNodeCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">Checkpoint</span>
          <strong class="goal-summary-value">${escapeHtml(String(checkpoints.length))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">待处理</span>
          <strong class="goal-summary-value">${escapeHtml(String(waitingCheckpointCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">已批准</span>
          <strong class="goal-summary-value">${escapeHtml(String(approvedCheckpointCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">已拒绝</span>
          <strong class="goal-summary-value">${escapeHtml(String(rejectedCheckpointCount))}</strong>
        </div>
      </div>

      <div class="goal-tracking-columns">
        <div class="goal-tracking-column">
          <div class="goal-summary-title">最近节点</div>
          ${recentNodes.length ? `
            <div class="goal-tracking-list">
              ${recentNodes.map((node) => `
                <div class="goal-tracking-item" data-goal-continuation-focus="node" data-goal-node-id="${escapeHtml(node.id || "")}">
                  <div class="goal-tracking-item-head">
                    <span class="goal-tracking-item-title">${escapeHtml(node.title)}</span>
                    <span class="memory-badge ${node.status === "completed" ? "memory-badge-shared" : ""}">${escapeHtml(formatNodeStatus(node.status))}</span>
                  </div>
                  ${node.summary ? `<div class="memory-list-item-snippet">${escapeHtml(node.summary)}</div>` : ""}
                  <div class="memory-list-item-meta">
                    <span>${escapeHtml(node.id)}</span>
                    ${node.phase ? `<span>${escapeHtml(node.phase)}</span>` : ""}
                    ${node.owner ? `<span>${escapeHtml(node.owner)}</span>` : ""}
                  </div>
                  ${compactGovernanceDetailMode ? "" : renderGoalTrackingNodeBridgeGovernance(node, escapeHtml, summarizeSourcePath, t)}
                  ${(() => {
                    const targets = getGoalTrackingNodeActionTargets(node);
                    if (compactGovernanceDetailMode && !targets.taskId) return "";
                    if (!targets.taskId && !targets.artifactPaths.length && !targets.bridgeArtifactPath && !targets.bridgeTranscriptPath) return "";
                    return `
                      <div class="goal-detail-actions goal-checkpoint-actions">
                        ${targets.taskId ? `<button class="button goal-inline-action-secondary" data-open-task-id="${escapeHtml(targets.taskId)}">打开运行任务</button>` : ""}
                        ${compactGovernanceDetailMode ? "" : targets.artifactPaths.map((artifactPath) => `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(artifactPath)}">${escapeHtml(summarizeSourcePath(artifactPath))}</button>`).join("")}
                        ${compactGovernanceDetailMode ? "" : targets.bridgeArtifactPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(targets.bridgeArtifactPath)}">${escapeHtml(t("goals.trackingOpenBridgeArtifact", {}, "Open bridge artifact"))}</button>` : ""}
                        ${compactGovernanceDetailMode ? "" : targets.bridgeTranscriptPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(targets.bridgeTranscriptPath)}">${escapeHtml(t("goals.trackingOpenBridgeTranscript", {}, "Open bridge transcript"))}</button>` : ""}
                      </div>
                    `;
                  })()}
                </div>
              `).join("")}
            </div>
          ` : '<div class="memory-viewer-empty">tasks.json 中还没有节点。</div>'}
        </div>
        <div class="goal-tracking-column">
          <div class="goal-summary-title">${escapeHtml(focusNodeId ? `关联 Checkpoint · ${focusNodeId}` : "最近 Checkpoint")}</div>
          ${focusNodeId ? `<div class="goal-summary-text">当前 node focus 已收窄到该节点关联的 checkpoint。</div>` : ""}
          ${visibleCheckpoints.length ? `
            <div class="goal-tracking-list">
              ${visibleCheckpoints.map((item) => `
                <div class="goal-tracking-item" data-goal-continuation-focus="node" data-goal-node-id="${escapeHtml(item.nodeId || "")}">
                  <div class="goal-tracking-item-head">
                    <span class="goal-tracking-item-title">${escapeHtml(item.title)}</span>
                    <span class="memory-badge ${item.status === "approved" ? "memory-badge-shared" : ""}">${escapeHtml(formatCheckpointStatus(item.status))}</span>
                  </div>
                  <div class="memory-list-item-snippet">${escapeHtml(item.summary || item.note || "暂无摘要")}</div>
                  <div class="memory-list-item-meta">
                    <span>${escapeHtml(item.id)}</span>
                    ${item.nodeId ? `<span>${escapeHtml(item.nodeId)}</span>` : ""}
                    <span>${escapeHtml(formatDateTime(item.updatedAt))}</span>
                  </div>
                  <div class="goal-checkpoint-meta">
                    ${item.reviewer ? `<span class="memory-badge">评审人 ${escapeHtml(item.reviewer)}</span>` : ""}
                    ${item.reviewerRole ? `<span class="memory-badge">${escapeHtml(item.reviewerRole)}</span>` : ""}
                    ${item.requestedBy ? `<span class="memory-badge">发起 ${escapeHtml(item.requestedBy)}</span>` : ""}
                    ${compactGovernanceDetailMode ? "" : item.decidedBy ? `<span class="memory-badge">审批 ${escapeHtml(item.decidedBy)}</span>` : ""}
                    ${getGoalCheckpointSlaBadge(item)}
                  </div>
                  ${(() => {
                    if (compactGovernanceDetailMode) return "";
                    const explainabilityLines = getGoalTrackingCheckpointExplainabilityLines(item, capabilityPlansByNodeId, t);
                    if (!explainabilityLines.length) return "";
                    return `
                      <div class="tool-settings-policy-note">
                        ${explainabilityLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
                      </div>
                    `;
                  })()}
                  <div class="goal-detail-actions goal-checkpoint-actions">
                    ${item.runId ? `<button class="button goal-inline-action-secondary" data-open-task-id="${escapeHtml(item.runId)}">打开运行任务</button>` : ""}
                    ${["waiting_user", "required"].includes(item.status) ? `
                      <button class="button goal-inline-action" data-goal-checkpoint-action="approve" data-goal-checkpoint-goal-id="${escapeHtml(goal.id)}" data-goal-checkpoint-node-id="${escapeHtml(item.nodeId || "")}" data-goal-checkpoint-id="${escapeHtml(item.id)}">批准</button>
                      <button class="button goal-inline-action-secondary" data-goal-checkpoint-action="reject" data-goal-checkpoint-goal-id="${escapeHtml(goal.id)}" data-goal-checkpoint-node-id="${escapeHtml(item.nodeId || "")}" data-goal-checkpoint-id="${escapeHtml(item.id)}">拒绝</button>
                      <button class="button goal-inline-action-secondary" data-goal-checkpoint-action="expire" data-goal-checkpoint-goal-id="${escapeHtml(goal.id)}" data-goal-checkpoint-node-id="${escapeHtml(item.nodeId || "")}" data-goal-checkpoint-id="${escapeHtml(item.id)}">过期</button>
                    ` : ""}
                    ${["rejected", "expired"].includes(item.status) ? `
                      <button class="button goal-inline-action" data-goal-checkpoint-action="reopen" data-goal-checkpoint-goal-id="${escapeHtml(goal.id)}" data-goal-checkpoint-node-id="${escapeHtml(item.nodeId || "")}" data-goal-checkpoint-id="${escapeHtml(item.id)}">重新打开</button>
                    ` : ""}
                  </div>
                  ${!compactGovernanceDetailMode && item.history.length ? `
                    <div class="goal-checkpoint-history">
                      ${item.history.slice().reverse().slice(0, 4).map((history) => `
                        <div class="goal-checkpoint-history-item">
                          <span class="memory-badge">${escapeHtml(formatCheckpointHistoryAction(history.action))}</span>
                          <span>${escapeHtml(formatDateTime(history.at))}</span>
                          ${history.actor ? `<span>${escapeHtml(history.actor)}</span>` : ""}
                          ${history.note ? `<span>${escapeHtml(history.note)}</span>` : ""}
                        </div>
                      `).join("")}
                    </div>
                  ` : ""}
                </div>
              `).join("")}
            </div>
          ` : focusNodeId
            ? '<div class="memory-viewer-empty">当前 node 还没有关联 checkpoint。</div>'
            : '<div class="memory-viewer-empty">checkpoints.json 中还没有 checkpoint。</div>'}
        </div>
      </div>
    `;
  }

  function renderGoalTrackingPanelError(message) {
    const panel = goalsDetailEl?.querySelector("#goalTrackingPanel");
    if (!panel) return;
    panel.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  return {
    getGoalTrackingNodeActionTargets,
    filterGoalTrackingCheckpointsByNode,
    renderGoalTrackingPanel,
    renderGoalTrackingPanelError,
    renderGoalTrackingPanelLoading,
  };
}
