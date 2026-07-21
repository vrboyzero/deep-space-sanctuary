import { buildGoalCheckpointExplainabilityEntry } from "./goal-launch-explainability.js";
import {
  buildBridgeGovernanceSummaryLines,
  formatBridgeCloseReason,
  formatBridgeRuntimeState,
} from "./subtasks-overview.js";
import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

function renderGoalTrackingEmptyState(panel, message) {
  if (!panel) return;
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = message;
  panel.replaceChildren(empty);
}

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

function createGoalTrackingElement(ownerDocument, tagName, className = "", text) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text ?? "");
  return element;
}

function createGoalTrackingButton(ownerDocument, className, label, attributes = {}) {
  const button = createGoalTrackingElement(ownerDocument, "button", className, label);
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, String(value ?? ""));
  }
  return button;
}

function renderGoalTrackingNodeBridgeGovernance(ownerDocument, node, summarizeSourcePath, t) {
  const bridgeSubtaskView = node?.bridgeSubtaskView && typeof node.bridgeSubtaskView === "object"
    ? node.bridgeSubtaskView
    : null;
  const bridgeSessionView = node?.bridgeSessionView && typeof node.bridgeSessionView === "object"
    ? node.bridgeSessionView
    : null;
  if (!bridgeSubtaskView && !bridgeSessionView) return null;

  const summaryLines = buildBridgeGovernanceSummaryLines(node, t);
  const fragment = ownerDocument.createDocumentFragment();
  const badges = createGoalTrackingElement(ownerDocument, "div", "goal-checkpoint-meta");
  badges.append(createGoalTrackingElement(
    ownerDocument,
    "span",
    "memory-badge",
    t("goals.trackingBridgeGovernance", {}, "Bridge Governance"),
  ));
  if (bridgeSessionView?.runtimeState) {
    badges.append(createGoalTrackingElement(
      ownerDocument,
      "span",
      "memory-badge",
      formatBridgeRuntimeState(bridgeSessionView.runtimeState, t),
    ));
  }
  if (bridgeSessionView?.closeReason) {
    badges.append(createGoalTrackingElement(
      ownerDocument,
      "span",
      "memory-badge",
      formatBridgeCloseReason(bridgeSessionView.closeReason, t),
    ));
  }
  fragment.append(badges);
  if (summaryLines.length) {
    const note = createGoalTrackingElement(ownerDocument, "div", "tool-settings-policy-note");
    note.append(...summaryLines.map((line) => createGoalTrackingElement(ownerDocument, "div", "", line)));
    fragment.append(note);
  }
  if (bridgeSessionView?.artifactPath) {
    const meta = createGoalTrackingElement(ownerDocument, "div", "memory-list-item-meta");
    meta.append(
      createGoalTrackingElement(ownerDocument, "span", "", t("goals.trackingBridgeArtifact", {}, "Bridge Artifact")),
      createGoalTrackingElement(ownerDocument, "span", "", summarizeSourcePath(bridgeSessionView.artifactPath)),
    );
    fragment.append(meta);
  }
  if (bridgeSessionView?.transcriptPath) {
    const meta = createGoalTrackingElement(ownerDocument, "div", "memory-list-item-meta");
    meta.append(
      createGoalTrackingElement(ownerDocument, "span", "", t("goals.trackingBridgeTranscript", {}, "Bridge Transcript")),
      createGoalTrackingElement(ownerDocument, "span", "", summarizeSourcePath(bridgeSessionView.transcriptPath)),
    );
    fragment.append(meta);
  }
  return fragment;
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

function renderGoalTrackingFreshnessSummary(ownerDocument, memoryFreshness) {
  const summary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
    ? memoryFreshness.summary
    : null;
  if (!summary?.available || !summary.headline) {
    return null;
  }
  const note = createGoalTrackingElement(ownerDocument, "div", "tool-settings-policy-note");
  note.append(
    createGoalTrackingElement(ownerDocument, "strong", "", "治理 freshness："),
    createGoalTrackingElement(ownerDocument, "span", "", summary.headline),
  );
  return note;
}

function createGoalTrackingSlaBadge(ownerDocument, checkpoint, formatDateTime) {
  if (!checkpoint?.slaAt) return null;
  const deadline = new Date(checkpoint.slaAt);
  if (Number.isNaN(deadline.getTime())) {
    return createGoalTrackingElement(ownerDocument, "span", "memory-badge", `SLA ${checkpoint.slaAt}`);
  }
  const overdue = deadline.getTime() < Date.now();
  return createGoalTrackingElement(
    ownerDocument,
    "span",
    `memory-badge${overdue ? " is-overdue" : ""}`,
    `${overdue ? "SLA 已超时" : "SLA"} ${formatDateTime(checkpoint.slaAt)}`,
  );
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
    renderGoalTrackingEmptyState(panel, "正在读取 tasks.json / checkpoints.json …");
  }

  function renderGoalTrackingPanel(goal, payload) {
    const panel = goalsDetailEl?.querySelector("#goalTrackingPanel");
    if (!panel) return;
    const ownerDocument = panel.ownerDocument ?? document;
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
    const fragment = ownerDocument.createDocumentFragment();
    const freshnessSummary = renderGoalTrackingFreshnessSummary(ownerDocument, payload?.memoryFreshness);
    if (freshnessSummary) fragment.append(freshnessSummary);

    const stats = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-stats");
    const statItems = [
      ["节点总数", nodes.length],
      ["已完成", completedNodeCount],
      ["进行中", runningNodeCount],
      ["阻塞", blockedNodeCount],
      ["Checkpoint", checkpoints.length],
      ["待处理", waitingCheckpointCount],
      ["已批准", approvedCheckpointCount],
      ["已拒绝", rejectedCheckpointCount],
    ];
    for (const [label, value] of statItems) {
      const item = createGoalTrackingElement(ownerDocument, "div", "goal-summary-item");
      item.append(
        createGoalTrackingElement(ownerDocument, "span", "goal-summary-label", label),
        createGoalTrackingElement(ownerDocument, "strong", "goal-summary-value", value),
      );
      stats.append(item);
    }
    fragment.append(stats);

    const columns = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-columns");
    const nodeColumn = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-column");
    nodeColumn.append(createGoalTrackingElement(ownerDocument, "div", "goal-summary-title", "最近节点"));
    if (recentNodes.length) {
      const nodeList = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-list");
      for (const node of recentNodes) {
        const nodeItem = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-item");
        nodeItem.setAttribute("data-goal-continuation-focus", "node");
        nodeItem.setAttribute("data-goal-node-id", String(node.id || ""));
        const head = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-item-head");
        head.append(
          createGoalTrackingElement(ownerDocument, "span", "goal-tracking-item-title", node.title),
          createGoalTrackingElement(
            ownerDocument,
            "span",
            `memory-badge${node.status === "completed" ? " memory-badge-shared" : ""}`,
            formatNodeStatus(node.status),
          ),
        );
        nodeItem.append(head);
        if (node.summary) nodeItem.append(createGoalTrackingElement(ownerDocument, "div", "memory-list-item-snippet", node.summary));
        const meta = createGoalTrackingElement(ownerDocument, "div", "memory-list-item-meta");
        meta.append(createGoalTrackingElement(ownerDocument, "span", "", node.id));
        if (node.phase) meta.append(createGoalTrackingElement(ownerDocument, "span", "", node.phase));
        if (node.owner) meta.append(createGoalTrackingElement(ownerDocument, "span", "", node.owner));
        nodeItem.append(meta);
        if (!compactGovernanceDetailMode) {
          const bridge = renderGoalTrackingNodeBridgeGovernance(ownerDocument, node, summarizeSourcePath, t);
          if (bridge) nodeItem.append(bridge);
        }
        const targets = getGoalTrackingNodeActionTargets(node);
        if (!(compactGovernanceDetailMode && !targets.taskId)
          && (targets.taskId || targets.artifactPaths.length || targets.bridgeArtifactPath || targets.bridgeTranscriptPath)) {
          const actions = createGoalTrackingElement(ownerDocument, "div", "goal-detail-actions goal-checkpoint-actions");
          if (targets.taskId) actions.append(createGoalTrackingButton(
            ownerDocument,
            "button goal-inline-action-secondary",
            "打开运行任务",
            { "data-open-task-id": targets.taskId },
          ));
          if (!compactGovernanceDetailMode) {
            actions.append(...targets.artifactPaths.map((artifactPath) => createGoalTrackingButton(
              ownerDocument,
              "button goal-inline-action-secondary",
              summarizeSourcePath(artifactPath),
              { "data-open-source": artifactPath },
            )));
            if (targets.bridgeArtifactPath) actions.append(createGoalTrackingButton(
              ownerDocument,
              "button goal-inline-action-secondary",
              t("goals.trackingOpenBridgeArtifact", {}, "Open bridge artifact"),
              { "data-open-source": targets.bridgeArtifactPath },
            ));
            if (targets.bridgeTranscriptPath) actions.append(createGoalTrackingButton(
              ownerDocument,
              "button goal-inline-action-secondary",
              t("goals.trackingOpenBridgeTranscript", {}, "Open bridge transcript"),
              { "data-open-source": targets.bridgeTranscriptPath },
            ));
          }
          nodeItem.append(actions);
        }
        nodeList.append(nodeItem);
      }
      nodeColumn.append(nodeList);
    } else {
      nodeColumn.append(createGoalTrackingElement(ownerDocument, "div", "memory-viewer-empty", "tasks.json 中还没有节点。"));
    }
    columns.append(nodeColumn);

    const checkpointColumn = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-column");
    checkpointColumn.append(createGoalTrackingElement(
      ownerDocument,
      "div",
      "goal-summary-title",
      focusNodeId ? `关联 Checkpoint · ${focusNodeId}` : "最近 Checkpoint",
    ));
    if (focusNodeId) checkpointColumn.append(createGoalTrackingElement(
      ownerDocument,
      "div",
      "goal-summary-text",
      "当前 node focus 已收窄到该节点关联的 checkpoint。",
    ));
    if (visibleCheckpoints.length) {
      const checkpointList = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-list");
      for (const item of visibleCheckpoints) {
        const checkpointItem = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-item");
        checkpointItem.setAttribute("data-goal-continuation-focus", "node");
        checkpointItem.setAttribute("data-goal-node-id", String(item.nodeId || ""));
        const head = createGoalTrackingElement(ownerDocument, "div", "goal-tracking-item-head");
        head.append(
          createGoalTrackingElement(ownerDocument, "span", "goal-tracking-item-title", item.title),
          createGoalTrackingElement(
            ownerDocument,
            "span",
            `memory-badge${item.status === "approved" ? " memory-badge-shared" : ""}`,
            formatCheckpointStatus(item.status),
          ),
        );
        checkpointItem.append(
          head,
          createGoalTrackingElement(ownerDocument, "div", "memory-list-item-snippet", item.summary || item.note || "暂无摘要"),
        );
        const meta = createGoalTrackingElement(ownerDocument, "div", "memory-list-item-meta");
        meta.append(createGoalTrackingElement(ownerDocument, "span", "", item.id));
        if (item.nodeId) meta.append(createGoalTrackingElement(ownerDocument, "span", "", item.nodeId));
        meta.append(createGoalTrackingElement(ownerDocument, "span", "", formatDateTime(item.updatedAt)));
        checkpointItem.append(meta);
        const checkpointMeta = createGoalTrackingElement(ownerDocument, "div", "goal-checkpoint-meta");
        if (item.reviewer) checkpointMeta.append(createGoalTrackingElement(ownerDocument, "span", "memory-badge", `评审人 ${item.reviewer}`));
        if (item.reviewerRole) checkpointMeta.append(createGoalTrackingElement(ownerDocument, "span", "memory-badge", item.reviewerRole));
        if (item.requestedBy) checkpointMeta.append(createGoalTrackingElement(ownerDocument, "span", "memory-badge", `发起 ${item.requestedBy}`));
        if (!compactGovernanceDetailMode && item.decidedBy) checkpointMeta.append(createGoalTrackingElement(ownerDocument, "span", "memory-badge", `审批 ${item.decidedBy}`));
        const slaBadge = createGoalTrackingSlaBadge(ownerDocument, item, formatDateTime);
        if (slaBadge) checkpointMeta.append(slaBadge);
        checkpointItem.append(checkpointMeta);
        if (!compactGovernanceDetailMode) {
          const explainabilityLines = getGoalTrackingCheckpointExplainabilityLines(item, capabilityPlansByNodeId, t);
          if (explainabilityLines.length) {
            const note = createGoalTrackingElement(ownerDocument, "div", "tool-settings-policy-note");
            note.append(...explainabilityLines.map((line) => createGoalTrackingElement(ownerDocument, "div", "", line)));
            checkpointItem.append(note);
          }
        }
        const actions = createGoalTrackingElement(ownerDocument, "div", "goal-detail-actions goal-checkpoint-actions");
        if (item.runId) actions.append(createGoalTrackingButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          "打开运行任务",
          { "data-open-task-id": item.runId },
        ));
        const actionAttributes = {
          "data-goal-checkpoint-goal-id": goal?.id || "",
          "data-goal-checkpoint-node-id": item.nodeId || "",
          "data-goal-checkpoint-id": item.id || "",
        };
        if (["waiting_user", "required"].includes(item.status)) {
          actions.append(
            createGoalTrackingButton(ownerDocument, "button goal-inline-action", "批准", { ...actionAttributes, "data-goal-checkpoint-action": "approve" }),
            createGoalTrackingButton(ownerDocument, "button goal-inline-action-secondary", "拒绝", { ...actionAttributes, "data-goal-checkpoint-action": "reject" }),
            createGoalTrackingButton(ownerDocument, "button goal-inline-action-secondary", "过期", { ...actionAttributes, "data-goal-checkpoint-action": "expire" }),
          );
        }
        if (["rejected", "expired"].includes(item.status)) {
          actions.append(createGoalTrackingButton(ownerDocument, "button goal-inline-action", "重新打开", { ...actionAttributes, "data-goal-checkpoint-action": "reopen" }));
        }
        checkpointItem.append(actions);
        const itemHistory = Array.isArray(item.history) ? item.history : [];
        if (!compactGovernanceDetailMode && itemHistory.length) {
          const historyEl = createGoalTrackingElement(ownerDocument, "div", "goal-checkpoint-history");
          historyEl.append(...itemHistory.slice().reverse().slice(0, 4).map((history) => {
            const historyItem = createGoalTrackingElement(ownerDocument, "div", "goal-checkpoint-history-item");
            historyItem.append(
              createGoalTrackingElement(ownerDocument, "span", "memory-badge", formatCheckpointHistoryAction(history.action)),
              createGoalTrackingElement(ownerDocument, "span", "", formatDateTime(history.at)),
            );
            if (history.actor) historyItem.append(createGoalTrackingElement(ownerDocument, "span", "", history.actor));
            if (history.note) historyItem.append(createGoalTrackingElement(ownerDocument, "span", "", history.note));
            return historyItem;
          }));
          checkpointItem.append(historyEl);
        }
        checkpointList.append(checkpointItem);
      }
      checkpointColumn.append(checkpointList);
    } else {
      checkpointColumn.append(createGoalTrackingElement(
        ownerDocument,
        "div",
        "memory-viewer-empty",
        focusNodeId ? "当前 node 还没有关联 checkpoint。" : "checkpoints.json 中还没有 checkpoint。",
      ));
    }
    columns.append(checkpointColumn);
    fragment.append(columns);
    panel.replaceChildren(fragment);
  }

  function renderGoalTrackingPanelError(message) {
    const panel = goalsDetailEl?.querySelector("#goalTrackingPanel");
    renderGoalTrackingEmptyState(panel, message);
  }

  return {
    getGoalTrackingNodeActionTargets,
    filterGoalTrackingCheckpointsByNode,
    renderGoalTrackingPanel,
    renderGoalTrackingPanelError,
    renderGoalTrackingPanelLoading,
  };
}
