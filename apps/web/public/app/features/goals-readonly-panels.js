import {
  buildContinuationAction,
  encodeContinuationAction,
  formatContinuationTargetLabel,
} from "./continuation-targets.js";

function renderReadonlyPanelEmptyState(panel, message) {
  if (!panel) return;
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = message;
  panel.replaceChildren(empty);
}

function createReadonlyElement(ownerDocument, tagName, className = "", text) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text ?? "");
  return element;
}

function appendReadonlyMeta(ownerDocument, parent, values) {
  const meta = createReadonlyElement(ownerDocument, "div", "memory-list-item-meta");
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== "") {
      meta.append(createReadonlyElement(ownerDocument, "span", "", value));
    }
  }
  parent.append(meta);
  return meta;
}

function appendReadonlySummaryItem(ownerDocument, parent, label, value) {
  const item = createReadonlyElement(ownerDocument, "div", "goal-summary-item");
  item.append(
    createReadonlyElement(ownerDocument, "span", "goal-summary-label", label),
    createReadonlyElement(ownerDocument, "strong", "goal-summary-value", value),
  );
  parent.append(item);
  return item;
}

function appendReadonlySnippet(ownerDocument, parent, value) {
  parent.append(createReadonlyElement(ownerDocument, "div", "memory-list-item-snippet", value));
}

function appendReadonlyTrackingItem(ownerDocument, parent, value) {
  const item = createReadonlyElement(ownerDocument, "div", "goal-tracking-item");
  appendReadonlySnippet(ownerDocument, item, value);
  parent.append(item);
  return item;
}

export function createGoalsReadonlyPanelsFeature({
  refs,
  escapeHtml,
  formatDateTime,
  normalizeGoalBoardId,
  goalRuntimeFilePath,
  onBindHandoffPanelActions,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsDetailEl } = refs;

  function appendGoalContinuationSection(ownerDocument, parent, continuationState) {
    if (!continuationState || typeof continuationState !== "object") return;
    const checkpoints = continuationState.checkpoints && typeof continuationState.checkpoints === "object"
      ? continuationState.checkpoints
      : {};
    const progress = continuationState.progress && typeof continuationState.progress === "object"
      ? continuationState.progress
      : {};
    const recent = Array.isArray(progress.recent)
      ? progress.recent.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
      : [];
    const replay = continuationState.replay && typeof continuationState.replay === "object"
      ? continuationState.replay
      : null;

    const targetText = formatContinuationTargetLabel(continuationState);
    const targetAction = buildContinuationAction(continuationState);
    const encodedTargetAction = encodeContinuationAction(targetAction);
    const targetLabel = targetAction?.kind === "goalReplay"
      ? t("goals.detailReplayCheckpointButton", {}, "Replay Checkpoint")
      : targetText;
    const replayText = replay?.kind === "goal_checkpoint"
      ? `${replay.checkpointId || "-"} -> ${replay.nodeId || "-"}`
      : "";
    const replayReason = replay?.kind === "goal_checkpoint"
      ? replay.summary || replay.reason || ""
      : "";

    parent.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", t("goals.detailContinuationTitle", {}, "Continuation State")));
    const summaryGrid = createReadonlyElement(ownerDocument, "div", "goal-summary-grid");
    appendReadonlySummaryItem(ownerDocument, summaryGrid, t("goals.detailContinuationMode", {}, "Resume Mode"), continuationState.resumeMode || "-");
    const targetItem = createReadonlyElement(ownerDocument, "div", "goal-summary-item");
    targetItem.append(createReadonlyElement(ownerDocument, "span", "goal-summary-label", t("goals.detailContinuationTarget", {}, "Recommended Target")));
    if (continuationState.recommendedTargetId && encodedTargetAction) {
      const targetButton = createReadonlyElement(ownerDocument, "button", "button goal-inline-action-secondary goal-continuation-target-btn", targetLabel);
      targetButton.type = "button";
      targetButton.setAttribute("data-continuation-action", encodedTargetAction);
      targetButton.title = targetLabel;
      targetItem.append(targetButton);
    } else {
      targetItem.append(createReadonlyElement(ownerDocument, "strong", "goal-summary-value", targetLabel || targetText));
    }
    summaryGrid.append(targetItem);
    if (replayText) appendReadonlySummaryItem(ownerDocument, summaryGrid, t("goals.detailContinuationReplay", {}, "Replay Target"), replayText);
    appendReadonlySummaryItem(ownerDocument, summaryGrid, t("goals.detailContinuationCheckpoints", {}, "Open Checkpoints"), String(Number(checkpoints.openCount || 0)));
    appendReadonlySummaryItem(ownerDocument, summaryGrid, t("goals.detailContinuationBlockers", {}, "Blockers"), String(Number(checkpoints.blockerCount || 0)));
    parent.append(summaryGrid);
    appendReadonlySnippet(ownerDocument, parent, continuationState.summary || "-");
    appendReadonlySnippet(ownerDocument, parent, continuationState.nextAction || "-");
    if (replayReason) appendReadonlySnippet(ownerDocument, parent, replayReason);
    if (progress.current) appendReadonlyMeta(ownerDocument, parent, [t("goals.detailContinuationProgress", {}, "Current Progress"), progress.current]);
    if (recent.length) {
      const recentList = createReadonlyElement(ownerDocument, "div", "goal-tracking-list");
      for (const item of recent) appendReadonlyTrackingItem(ownerDocument, recentList, item);
      parent.append(recentList);
    }
  }

  function deriveContinuationStateFromHandoff(goal, handoff) {
    if (!goal || !handoff || !handoff.generatedAt) return null;
    const openCheckpointCount = Number(
      handoff.tracking?.openCheckpointCount
      ?? handoff.tracking?.openCheckpoints
      ?? (Array.isArray(handoff.openCheckpoints) ? handoff.openCheckpoints.length : 0),
    );
    const blockerCount = Array.isArray(handoff.blockers) ? handoff.blockers.length : 0;
    const recentTimeline = Array.isArray(handoff.recentProgress)
      ? handoff.recentProgress.map((entry) => formatTimelineEntry(entry)).filter(Boolean).slice(0, 3)
      : Array.isArray(handoff.recentTimeline)
        ? handoff.recentTimeline.slice(0, 3)
        : [];
    const recommendedTargetId = handoff.recommendedNodeId
      || handoff.resumeNode
      || handoff.activeConversationId
      || goal.activeConversationId
      || goal.id;
    const targetType = handoff.recommendedNodeId || handoff.resumeNode
      ? "node"
      : handoff.activeConversationId || goal.activeConversationId
        ? "conversation"
        : "goal";

    return {
      scope: "goal",
      targetId: goal.id,
      recommendedTargetId,
      targetType,
      resumeMode: handoff.resumeMode || "goal_channel",
      summary: handoff.summary || "",
      nextAction: handoff.nextAction || "",
      replay: handoff.checkpointReplay && typeof handoff.checkpointReplay === "object"
        ? {
          kind: "goal_checkpoint",
          checkpointId: handoff.checkpointReplay.checkpointId || "",
          nodeId: handoff.checkpointReplay.nodeId || "",
          runId: handoff.checkpointReplay.runId || "",
          title: handoff.checkpointReplay.title || "",
          summary: handoff.checkpointReplay.summary || "",
          reason: handoff.checkpointReplay.reason || "",
        }
        : undefined,
      checkpoints: {
        openCount: openCheckpointCount,
        blockerCount,
      },
      progress: {
        current: handoff.currentPhase || goal.currentPhase || "",
        recent: recentTimeline,
      },
    };
  }

  function formatStructuredListItem(item, kind = "") {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const label = typeof item.id === "string" && item.id.trim()
      ? `[${kind || item.kind || item.status || "-"}] ${item.id}`
      : typeof item.title === "string"
        ? item.title
        : "";
    const nodeId = typeof item.nodeId === "string" && item.nodeId.trim() ? `node=${item.nodeId}` : "";
    const title = typeof item.title === "string" ? item.title : "";
    const detail = typeof item.reason === "string"
      ? item.reason
      : typeof item.summary === "string"
        ? item.summary
        : typeof item.note === "string"
          ? item.note
          : "";
    return [label, nodeId, title && title !== label ? title : "", detail].filter(Boolean).join(" | ");
  }

  function appendHandoffBridgeGovernanceSection(ownerDocument, parent, handoff) {
    const bridgeGovernance = handoff?.bridgeGovernance && typeof handoff.bridgeGovernance === "object"
      ? handoff.bridgeGovernance
      : null;
    const items = Array.isArray(bridgeGovernance?.items) ? bridgeGovernance.items : [];
    if (!bridgeGovernance || !items.length) return;
    parent.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", "Bridge 引用摘要"));
    appendReadonlyMeta(ownerDocument, parent, [
      `Bridge 节点 ${String(bridgeGovernance.bridgeNodeCount || 0)}`,
      `运行态丢失 ${String(bridgeGovernance.runtimeLostCount || 0)}`,
      `孤儿清理 ${String(bridgeGovernance.orphanedCount || 0)}`,
      `阻塞归因 ${String(bridgeGovernance.blockedCount || 0)}`,
    ]);
    const list = createReadonlyElement(ownerDocument, "div", "goal-tracking-list");
    for (const item of items) {
      const summaryLines = Array.isArray(item?.summaryLines)
        ? item.summaryLines.filter((line) => typeof line === "string" && line.trim())
        : [];
      const itemElement = createReadonlyElement(ownerDocument, "div", "goal-tracking-item");
      appendReadonlySnippet(ownerDocument, itemElement, [
        item?.title || item?.nodeId || "bridge",
        item?.runtimeState ? `[${item.runtimeState}]` : "",
        item?.nodeId ? `node=${item.nodeId}` : "",
      ].filter(Boolean).join(" | "));
      for (const line of summaryLines) appendReadonlySnippet(ownerDocument, itemElement, line);
      if (item?.blockReason) appendReadonlySnippet(ownerDocument, itemElement, `阻塞归因: ${item.blockReason}`);
      if (item?.artifactPath) appendReadonlyMeta(ownerDocument, itemElement, ["Bridge 产物", item.artifactPath]);
      if (item?.transcriptPath) appendReadonlyMeta(ownerDocument, itemElement, ["Bridge Transcript", item.transcriptPath]);
      list.append(itemElement);
    }
    parent.append(list);
  }

  function formatTimelineEntry(entry) {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return "";
    return [
      typeof entry.at === "string" ? entry.at : "",
      typeof entry.event === "string" ? entry.event : "",
      typeof entry.nodeId === "string" && entry.nodeId ? `node=${entry.nodeId}` : "",
      typeof entry.checkpointId === "string" && entry.checkpointId ? `checkpoint=${entry.checkpointId}` : "",
      typeof entry.summary === "string" ? entry.summary : "",
      typeof entry.note === "string" ? entry.note : "",
    ].filter(Boolean).join(" | ");
  }

  function formatProgressEvent(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!normalized) return "-";
    if (normalized === "timeline") return "时间线";
    if (normalized === "checkpoint_replay_started") return "Checkpoint Replay 已开始";
    if (normalized === "checkpoint_approved") return "Checkpoint 已批准";
    if (normalized === "checkpoint_rejected") return "Checkpoint 已拒绝";
    if (normalized === "checkpoint_expired") return "Checkpoint 已过期";
    if (normalized === "checkpoint_reopened") return "Checkpoint 已重新打开";
    if (normalized === "node_started") return "节点开始";
    if (normalized === "node_completed") return "节点完成";
    if (normalized === "node_blocked") return "节点阻塞";
    return value;
  }

  function formatProgressStatus(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!normalized) return "";
    if (normalized === "running" || normalized === "in_progress") return "运行中";
    if (normalized === "completed" || normalized === "done") return "已完成";
    if (normalized === "blocked") return "阻塞";
    if (normalized === "approved") return "已批准";
    if (normalized === "rejected") return "已拒绝";
    if (normalized === "expired") return "已过期";
    return value;
  }

  function renderGoalCanvasPanelLoading() {
    const panel = goalsDetailEl?.querySelector("#goalCanvasPanel");
    renderReadonlyPanelEmptyState(panel, t("goals.canvasPanelLoading", {}, "Loading board-ref.json ..."));
  }

  function renderGoalCanvasPanel(goal, payload) {
    const panel = goalsDetailEl?.querySelector("#goalCanvasPanel");
    if (!panel || !goal) return;

    const registryBoardId = normalizeGoalBoardId(goal.boardId);
    const runtimeBoardId = normalizeGoalBoardId(payload?.runtimeBoardId);
    const effectiveBoardId = runtimeBoardId || registryBoardId;
    const hasMismatch = Boolean(runtimeBoardId && registryBoardId && runtimeBoardId !== registryBoardId);
    const linkedAt = payload?.linkedAt || payload?.updatedAt || "";
    const boardRefPath = goalRuntimeFilePath(goal, "board-ref.json");
    const source = runtimeBoardId ? "运行态 board-ref" : registryBoardId ? "任务注册表" : "-";

    let statusLabel = t("goals.canvasStatusUnbound", {}, "Unbound");
    let statusClass = "memory-badge";
    let hint = t("goals.canvasHintUnbound", {}, "No Canvas main-board binding is detected yet. You can open the board list or create one first.");

    if (effectiveBoardId && hasMismatch) {
      statusLabel = t("goals.canvasStatusMismatch", {}, "Binding Mismatch");
      statusClass = "memory-badge";
      hint = t("goals.canvasHintMismatch", { runtimeBoardId, registryBoardId }, `Runtime board-ref (${runtimeBoardId}) differs from registry default board (${registryBoardId}). The runtime binding is used first.`);
    } else if (effectiveBoardId && runtimeBoardId) {
      statusLabel = t("goals.canvasStatusBound", {}, "Bound");
      statusClass = "memory-badge memory-badge-shared";
      hint = t("goals.canvasHintBoundRuntime", {}, "A runtime Canvas binding is detected. You can jump directly to the linked board from long task details.");
    } else if (effectiveBoardId) {
      statusLabel = t("goals.canvasStatusPending", {}, "Pending");
      statusClass = "memory-badge";
      hint = t("goals.canvasHintRegistryOnly", {}, "Only the default board declared in the registry is detected. If opening fails, open the board list to create or fix the binding first.");
    } else if (payload?.readError) {
      hint = t("goals.canvasHintReadError", {}, "Unable to read board-ref.json. If you use a custom path, confirm it has been added to the workspace roots.");
    }

    const ownerDocument = panel.ownerDocument ?? document;
    const header = createReadonlyElement(ownerDocument, "div", "goal-summary-header");
    const headerCopy = createReadonlyElement(ownerDocument, "div");
    headerCopy.append(
      createReadonlyElement(ownerDocument, "div", "goal-summary-title", t("goals.canvasPanelTitle", {}, "Canvas Link")),
      createReadonlyElement(ownerDocument, "div", "goal-summary-text", hint),
    );
    header.append(headerCopy, createReadonlyElement(ownerDocument, "span", statusClass, statusLabel));

    const summaryGrid = createReadonlyElement(ownerDocument, "div", "goal-summary-grid");
    const summaryItems = [
      [t("goals.canvasCurrentBoard", {}, "Current Board"), effectiveBoardId || "-"],
      [t("goals.canvasSource", {}, "Source"), source],
      [t("goals.canvasRuntimeBoardRef", {}, "Runtime board-ref"), runtimeBoardId || "-"],
      [t("goals.canvasRegistryBoardId", {}, "Registry boardId"), registryBoardId || "-"],
      [t("goals.canvasLinkedAt", {}, "Linked At"), formatDateTime(linkedAt)],
      [t("goals.canvasBoardRefPath", {}, "board-ref Path"), boardRefPath || "-"],
    ];
    for (const [label, value] of summaryItems) {
      const item = createReadonlyElement(ownerDocument, "div", "goal-summary-item");
      item.append(
        createReadonlyElement(ownerDocument, "span", "goal-summary-label", label),
        createReadonlyElement(ownerDocument, "strong", "goal-summary-value", value),
      );
      summaryGrid.append(item);
    }

    const actions = createReadonlyElement(ownerDocument, "div", "goal-detail-actions");
    const openLinkedBoard = createReadonlyElement(ownerDocument, "button", "button", t("goals.canvasOpenLinkedBoard", {}, "Open Linked Canvas"));
    openLinkedBoard.setAttribute("data-open-goal-board", effectiveBoardId || "");
    openLinkedBoard.disabled = !effectiveBoardId;
    const openBoardList = createReadonlyElement(ownerDocument, "button", "button goal-inline-action-secondary", t("goals.canvasOpenBoardList", {}, "Open Canvas List"));
    openBoardList.setAttribute("data-open-goal-board-list", goal.id ?? "");
    const openBoardRef = createReadonlyElement(ownerDocument, "button", "button goal-inline-action-secondary", t("goals.canvasOpenBoardRef", {}, "Open board-ref.json"));
    openBoardRef.setAttribute("data-open-source", boardRefPath || "");
    actions.append(openLinkedBoard, openBoardList, openBoardRef);
    panel.replaceChildren(header, summaryGrid, actions);
  }

  function renderGoalProgressPanelLoading() {
    const panel = goalsDetailEl?.querySelector("#goalProgressPanel");
    renderReadonlyPanelEmptyState(panel, "正在读取 progress.md …");
  }

  function renderGoalProgressPanel(entries) {
    const panel = goalsDetailEl?.querySelector("#goalProgressPanel");
    if (!panel) return;
    const recentEntries = Array.isArray(entries) ? entries.slice().reverse().slice(0, 18) : [];
    if (!recentEntries.length) {
      renderReadonlyPanelEmptyState(panel, "progress.md 中还没有时间线记录。");
      return;
    }
    const ownerDocument = panel.ownerDocument ?? document;
    const timeline = createReadonlyElement(ownerDocument, "div", "goal-progress-timeline");
    for (const entry of recentEntries) {
      const item = createReadonlyElement(ownerDocument, "div", "goal-progress-item");
      const head = createReadonlyElement(ownerDocument, "div", "goal-progress-item-head");
      head.append(
        createReadonlyElement(ownerDocument, "span", "goal-tracking-item-title", entry.title || formatProgressEvent(entry.event) || "时间线"),
        createReadonlyElement(ownerDocument, "span", "memory-badge", formatProgressEvent(entry.event)),
      );
      item.append(head);
      appendReadonlyMeta(ownerDocument, item, [
        formatDateTime(entry.at),
        entry.nodeId,
        entry.status ? formatProgressStatus(entry.status) : "",
        entry.checkpointId,
      ]);
      if (entry.summary) item.append(createReadonlyElement(ownerDocument, "div", "memory-list-item-snippet", entry.summary));
      if (entry.note) item.append(createReadonlyElement(ownerDocument, "div", "memory-list-item-snippet", entry.note));
      timeline.append(item);
    }
    panel.replaceChildren(timeline);
  }

  function renderGoalHandoffPanelLoading() {
    const panel = goalsDetailEl?.querySelector("#goalHandoffPanel");
    renderReadonlyPanelEmptyState(panel, "正在读取 goal handoff snapshot …");
  }

  function renderGoalHandoffPanelPlaceholder(panel, goal, message) {
    const ownerDocument = panel.ownerDocument ?? document;
    const empty = createReadonlyElement(ownerDocument, "div", "memory-viewer-empty", message);
    const actions = createReadonlyElement(ownerDocument, "div", "goal-detail-actions");
    const generate = createReadonlyElement(ownerDocument, "button", "button", "生成 handoff");
    generate.setAttribute("data-goal-generate-handoff", goal.id ?? "");
    const openSource = createReadonlyElement(ownerDocument, "button", "button goal-inline-action-secondary", "打开 handoff");
    openSource.setAttribute("data-open-source", goal.handoffPath ?? "");
    actions.append(generate, openSource);
    panel.replaceChildren(empty, actions);
    onBindHandoffPanelActions?.(goal);
  }

  function renderGoalHandoffPanelError(goal, message) {
    const panel = goalsDetailEl?.querySelector("#goalHandoffPanel");
    if (!panel) return;
    renderGoalHandoffPanelPlaceholder(panel, goal, message);
  }

  function renderGoalHandoffPanel(goal, handoff, continuationState = null) {
    const panel = goalsDetailEl?.querySelector("#goalHandoffPanel");
    if (!panel || !goal) return;
    const effectiveContinuationState = continuationState || deriveContinuationStateFromHandoff(goal, handoff);
    const blockers = Array.isArray(handoff?.blockers) ? handoff.blockers.map((item) => formatStructuredListItem(item, item?.kind || "blocker")).filter(Boolean) : [];
    const openCheckpoints = Array.isArray(handoff?.openCheckpoints) ? handoff.openCheckpoints.map((item) => formatStructuredListItem(item, "checkpoint")).filter(Boolean) : [];
    const recentTimeline = Array.isArray(handoff?.recentProgress)
      ? handoff.recentProgress.map((item) => formatTimelineEntry(item)).filter(Boolean)
      : Array.isArray(handoff?.recentTimeline)
        ? handoff.recentTimeline.filter((item) => typeof item === "string" && item.trim())
        : [];
    const focusPlan = handoff?.focusCapability
      ? [
        handoff.focusCapability.planId,
        handoff.focusCapability.nodeId ? `node=${handoff.focusCapability.nodeId}` : "",
        handoff.focusCapability.executionMode || "",
        handoff.focusCapability.riskLevel ? `risk=${handoff.focusCapability.riskLevel}` : "",
        handoff.focusCapability.alignment ? `alignment=${handoff.focusCapability.alignment}` : "",
      ].filter(Boolean).join(" | ")
      : handoff?.focusPlan || "";
    const focusSummary = handoff?.focusCapability?.summary || handoff?.focusSummary || "";
    const openCheckpointCount = Number(
      handoff?.tracking?.openCheckpointCount
      ?? handoff?.tracking?.openCheckpoints
      ?? openCheckpoints.length,
    );

    if (!handoff || !handoff.generatedAt) {
      renderGoalHandoffPanelPlaceholder(
        panel,
        goal,
        "当前还没有正式 handoff。可在节点切换、暂停前或需要交接时手动生成。",
      );
      return;
    }

    const ownerDocument = panel.ownerDocument ?? document;
    const header = createReadonlyElement(ownerDocument, "div", "goal-summary-header");
    const headerCopy = createReadonlyElement(ownerDocument, "div");
    headerCopy.append(
      createReadonlyElement(ownerDocument, "div", "goal-summary-title", "交接摘要 / 恢复交接"),
      createReadonlyElement(ownerDocument, "div", "goal-summary-text", "从 goal runtime 重建当前长期任务的恢复建议、阻塞点与最近交接摘要。"),
    );
    header.append(headerCopy, createReadonlyElement(ownerDocument, "span", "memory-badge memory-badge-shared", "当前快照"));

    const summaryGrid = createReadonlyElement(ownerDocument, "div", "goal-summary-grid");
    appendReadonlySummaryItem(ownerDocument, summaryGrid, "生成时间", formatDateTime(handoff.generatedAt));
    appendReadonlySummaryItem(ownerDocument, summaryGrid, "恢复模式", handoff.resumeMode || "-");
    appendReadonlySummaryItem(ownerDocument, summaryGrid, "建议节点", handoff.recommendedNodeId || handoff.resumeNode || "-");
    appendReadonlySummaryItem(ownerDocument, summaryGrid, "待处理 Checkpoint", String(openCheckpointCount));
    appendReadonlySummaryItem(ownerDocument, summaryGrid, "阻塞项", String(blockers.length));
    appendReadonlySummaryItem(ownerDocument, summaryGrid, "上次运行", handoff.lastRunId || handoff.lastRun || "-");

    const columns = createReadonlyElement(ownerDocument, "div", "goal-tracking-columns");
    const summaryColumn = createReadonlyElement(ownerDocument, "div", "goal-tracking-column");
    summaryColumn.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", "交接摘要"));
    appendReadonlySnippet(ownerDocument, summaryColumn, handoff.summary || "暂无摘要");
    summaryColumn.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", "下一步建议"));
    appendReadonlySnippet(ownerDocument, summaryColumn, handoff.nextAction || "暂无建议");
    summaryColumn.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", "跟踪快照"));
    appendReadonlyMeta(ownerDocument, summaryColumn, [
      `节点 ${String(handoff.tracking.totalNodes || "0")}`,
      `完成 ${String(handoff.tracking.completedNodes || "0")}`,
      `进行中 ${String(handoff.tracking.inProgressNodes || "0")}`,
      `阻塞 ${String(handoff.tracking.blockedNodes || "0")}`,
      `Checkpoint ${String(openCheckpointCount)}`,
    ]);
    if (focusPlan) {
      summaryColumn.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", "当前关注能力"));
      appendReadonlySnippet(ownerDocument, summaryColumn, focusPlan);
      if (focusSummary) appendReadonlySnippet(ownerDocument, summaryColumn, focusSummary);
    }
    appendHandoffBridgeGovernanceSection(ownerDocument, summaryColumn, handoff);
    appendGoalContinuationSection(ownerDocument, summaryColumn, effectiveContinuationState);

    const detailColumn = createReadonlyElement(ownerDocument, "div", "goal-tracking-column");
    detailColumn.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", "阻塞 / 待处理"));
    if (blockers.length || openCheckpoints.length) {
      const blockerList = createReadonlyElement(ownerDocument, "div", "goal-tracking-list");
      for (const item of blockers) appendReadonlyTrackingItem(ownerDocument, blockerList, item);
      for (const item of openCheckpoints) appendReadonlyTrackingItem(ownerDocument, blockerList, item);
      detailColumn.append(blockerList);
    } else {
      detailColumn.append(createReadonlyElement(ownerDocument, "div", "memory-viewer-empty", "当前 handoff 中没有阻塞或待审批项。"));
    }
    detailColumn.append(createReadonlyElement(ownerDocument, "div", "goal-summary-title", "最近时间线"));
    if (recentTimeline.length) {
      const timelineList = createReadonlyElement(ownerDocument, "div", "goal-tracking-list");
      for (const item of recentTimeline) appendReadonlyTrackingItem(ownerDocument, timelineList, item);
      detailColumn.append(timelineList);
    } else {
      detailColumn.append(createReadonlyElement(ownerDocument, "div", "memory-viewer-empty", "handoff 中还没有最近时间线摘要。"));
    }
    columns.append(summaryColumn, detailColumn);

    const actions = createReadonlyElement(ownerDocument, "div", "goal-detail-actions");
    const refresh = createReadonlyElement(ownerDocument, "button", "button", "刷新交接摘要");
    refresh.setAttribute("data-goal-generate-handoff", goal.id ?? "");
    const openSource = createReadonlyElement(ownerDocument, "button", "button goal-inline-action-secondary", "打开 handoff.md");
    openSource.setAttribute("data-open-source", goal.handoffPath ?? "");
    actions.append(refresh, openSource);
    panel.replaceChildren(header, summaryGrid, columns, actions);
    onBindHandoffPanelActions?.(goal);
  }

  return {
    renderGoalCanvasPanel,
    renderGoalCanvasPanelLoading,
    renderGoalHandoffPanel,
    renderGoalHandoffPanelError,
    renderGoalHandoffPanelLoading,
    renderGoalProgressPanel,
    renderGoalProgressPanelLoading,
  };
}
