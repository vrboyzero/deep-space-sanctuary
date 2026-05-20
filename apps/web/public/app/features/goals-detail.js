import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

export function createGoalsDetailFeature({
  refs,
  getActiveConversationId,
  isConversationForGoal,
  escapeHtml,
  formatGoalStatus,
  formatDateTime,
  formatGoalPathSource,
  goalDocFilePath,
  goalRuntimeFilePath,
  goalBaseConversationId,
  onBindDetailActions,
  onLoadGoalCanvasData,
  onLoadGoalTrackingData,
  onLoadGoalCapabilityData,
  onLoadGoalProgressData,
  onLoadGoalHandoffData,
  onLoadGoalReviewGovernanceData,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsDetailEl } = refs;

  function buildGoalRuntimeSummaryCard(goal, options) {
    const {
      activeNodeId,
      lastNodeId,
      lastRunId,
      isCurrentConversation,
    } = options;
    const currentChannel = goal.activeConversationId || goalBaseConversationId(goal.id);
    return `
      <div class="memory-detail-card goal-summary-card">
        <div class="goal-summary-header">
          <div>
            <div class="goal-summary-title">${escapeHtml(t("goals.summaryTitle", {}, "Runtime Summary"))}</div>
            <div class="goal-summary-text">${escapeHtml(t("goals.summaryText", {}, "Overview of the current goal channel, recent nodes, and execution records."))}</div>
          </div>
          ${isCurrentConversation
            ? `<span class="memory-badge memory-badge-shared">${escapeHtml(t("goals.currentChannelBadge", {}, "current channel"))}</span>`
            : `<span class="memory-badge">${escapeHtml(t("goals.resumableBadge", {}, "resumable"))}</span>`}
        </div>
        <div class="goal-summary-grid">
          <div class="goal-summary-item">
            <span class="goal-summary-label">${escapeHtml(t("goals.summaryStatus", {}, "Status"))}</span>
            <strong class="goal-summary-value">${escapeHtml(formatGoalStatus(goal.status))}</strong>
          </div>
          <div class="goal-summary-item">
            <span class="goal-summary-label">${escapeHtml(t("goals.summaryCurrentNode", {}, "Current Node"))}</span>
            <strong class="goal-summary-value">${escapeHtml(activeNodeId || "-")}</strong>
          </div>
          <div class="goal-summary-item">
            <span class="goal-summary-label">${escapeHtml(t("goals.summaryLastNode", {}, "Last Node"))}</span>
            <strong class="goal-summary-value">${escapeHtml(lastNodeId || "-")}</strong>
          </div>
          <div class="goal-summary-item">
            <span class="goal-summary-label">${escapeHtml(t("goals.summaryLastRun", {}, "Last Run"))}</span>
            <strong class="goal-summary-value">${escapeHtml(lastRunId || "-")}</strong>
          </div>
        </div>
        <div class="memory-detail-pre">${escapeHtml(currentChannel)}</div>
      </div>
    `;
  }

  function buildGoalRecoveryCard(goal, options) {
    const {
      activeNodeId,
      lastNodeId,
      isCurrentConversation,
    } = options;
    let title = t("goals.detailRecoveryTitle", {}, "Recovery Suggestion");
    let text = t("goals.detailRecoveryBase", {}, "You can directly enter the base goal channel for this long task.");
    let actions = `
      <button class="button" data-goal-resume-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailEnterBase", {}, "Enter Base Channel"))}</button>
    `;

    if (goal.status === "executing" && isCurrentConversation) {
      title = t("goals.detailContinueCurrentTitle", {}, "Continue Current Channel");
      text = t("goals.detailContinueCurrentText", {}, "You are already in this long task channel. Continue the current context first to avoid duplicate recovery.");
      actions = `
        <button class="button" data-goal-resume-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailRefreshCurrent", {}, "Refresh and Continue"))}</button>
        <button class="button" data-open-goal-tasks="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailOpenTasks", {}, "View Related Tasks"))}</button>
      `;
    } else if (goal.status === "executing" && activeNodeId) {
      title = t("goals.detailResumeActiveNodeTitle", {}, "Resume Current Node");
      text = t(
        "goals.detailResumeActiveNodeText",
        { nodeId: activeNodeId },
        `The current recorded active node is ${activeNodeId}. If handoff shows an open checkpoint, replay should resume this node first.`,
      );
      actions = `
        <button class="button" data-goal-resume-last-node="${escapeHtml(goal.id)}" data-goal-last-node-id="${escapeHtml(activeNodeId)}">${escapeHtml(t("goals.detailResumeCurrentNode", {}, "Resume Current Node"))}</button>
        <button class="button" data-goal-resume-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailEnterBase", {}, "Enter Base Channel"))}</button>
      `;
    } else if (lastNodeId) {
      title = t("goals.detailResumeLastNodeTitle", {}, "Resume Last Node");
      text = t("goals.detailResumeLastNodeText", { nodeId: lastNodeId }, `Detected the last active node ${lastNodeId}. Resuming from it is more continuous than going back to the base channel.`);
      actions = `
        <button class="button" data-goal-resume-last-node="${escapeHtml(goal.id)}" data-goal-last-node-id="${escapeHtml(lastNodeId)}">${escapeHtml(t("goals.detailResumeLastNode", {}, "Resume Last Node"))}</button>
        <button class="button" data-goal-resume-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailEnterBase", {}, "Enter Base Channel"))}</button>
      `;
    } else if (goal.status === "planning" || goal.status === "aligning" || goal.status === "ready") {
      title = t("goals.detailEnterBaseFirstTitle", {}, "Enter Base Channel First");
      text = t("goals.detailEnterBaseFirstText", {}, "There is no node history to resume yet. Enter the base goal channel first to continue breaking down the plan and tasks.");
      actions = `
        <button class="button" data-goal-resume-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailEnterBase", {}, "Enter Base Channel"))}</button>
        <button class="button" data-open-source="${escapeHtml(goal.northstarPath)}">${escapeHtml(t("goals.detailOpenNorthstar", {}, "Open NORTHSTAR.md"))}</button>
      `;
    }

    return `
      <div class="memory-detail-card goal-recovery-card">
        <div class="goal-summary-header">
          <div>
            <div class="goal-summary-title">${escapeHtml(title)}</div>
            <div class="goal-summary-text">${escapeHtml(text)}</div>
          </div>
        </div>
        <div class="goal-detail-actions">
          ${actions}
        </div>
      </div>
    `;
  }

  function renderGoalDetail(goal) {
    if (!goalsDetailEl) return;
    if (!goal) {
      goalsDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("goals.detailSelect", {}, "Select a long task on the left to view details."))}</div>`;
      return;
    }

    const activeConversationId = getActiveConversationId();
    const isCurrentConversation = isConversationForGoal(activeConversationId, goal.id);
    const objective = goal.objective ? String(goal.objective).trim() : "";
    const lastNodeId = typeof goal.lastNodeId === "string" && goal.lastNodeId.trim() ? goal.lastNodeId.trim() : "";
    const lastRunId = typeof goal.lastRunId === "string" && goal.lastRunId.trim() ? goal.lastRunId.trim() : "";
    const activeNodeId = typeof goal.activeNodeId === "string" && goal.activeNodeId.trim() ? goal.activeNodeId.trim() : "";
    const archived = goal.status === "archived";
    const runtimeSummaryCard = buildGoalRuntimeSummaryCard(goal, {
      activeNodeId,
      lastNodeId,
      lastRunId,
      isCurrentConversation,
    });
    const recoveryCard = buildGoalRecoveryCard(goal, {
      activeNodeId,
      lastNodeId,
      isCurrentConversation,
    });
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();

    goalsDetailEl.innerHTML = `
      <div class="memory-detail-shell">
        <div class="memory-detail-header">
          <div>
            <div class="memory-detail-title">${escapeHtml(goal.title || goal.id)}</div>
            <div class="memory-list-item-snippet">${escapeHtml(objective || t("goals.detailNoObjective", {}, "No objective yet. Open NORTHSTAR.md or 00-goal.md to continue improving it."))}</div>
          </div>
          <div class="memory-detail-badges">
            <span class="memory-badge memory-badge-shared">${escapeHtml(formatGoalStatus(goal.status))}</span>
            <span class="memory-badge">${escapeHtml(goal.currentPhase || "-")}</span>
            ${isCurrentConversation ? `<span class="memory-badge memory-badge-shared">${escapeHtml(t("goals.currentChannelBadge", {}, "current channel"))}</span>` : ""}
            ${archived ? `<span class="memory-badge">${escapeHtml(t("goals.archivedBadge", {}, "archived"))}</span>` : ""}
          </div>
        </div>

        ${runtimeSummaryCard}
        ${recoveryCard}

        ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card goal-handoff-card">
          <div id="goalHandoffPanel">
            <div class="memory-viewer-empty">${escapeHtml(t("goals.detailHandoffLoading", {}, "Loading handoff.md ..."))}</div>
          </div>
        </div>`}

        <div class="memory-detail-card goal-governance-card">
          <div id="goalGovernancePanel">
            <div class="memory-viewer-empty">${escapeHtml(t("goals.detailGovernanceLoading", {}, "Summarizing review governance / approval workflow ..."))}</div>
          </div>
        </div>

        <div class="memory-detail-grid">
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailUpdatedAt", {}, "Updated At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(goal.updatedAt || goal.createdAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailCreatedAt", {}, "Created At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(goal.createdAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailPathSource", {}, "Path Source"))}</span><div class="memory-detail-text">${escapeHtml(formatGoalPathSource(goal.pathSource))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailActiveNode", {}, "Current Active Node"))}</span><div class="memory-detail-text">${escapeHtml(activeNodeId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailLastNode", {}, "Last Active Node"))}</span><div class="memory-detail-text">${escapeHtml(lastNodeId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailLastActiveAt", {}, "Last Active At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(goal.lastActiveAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailLastPausedAt", {}, "Last Paused At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(goal.pausedAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailArchivedAt", {}, "Archived At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(goal.archivedAt))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailArchiveReason", {}, "Archive Reason"))}</span><div class="memory-detail-text">${escapeHtml(goal.archiveReason || "-")}</div></div>
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">长期任务 ID</span><div class="memory-detail-text">${escapeHtml(goal.id)}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("goals.detailLastRunId", {}, "Last Run ID"))}</span><div class="memory-detail-text">${lastRunId ? `<button class="memory-path-link" data-open-task-id="${escapeHtml(lastRunId)}">${escapeHtml(lastRunId)}</button>` : "-"}</div></div>`}
        </div>

        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("goals.detailChannel", {}, "Execution Channel"))}</span>
          <div class="memory-detail-pre">${escapeHtml(goal.activeConversationId || goalBaseConversationId(goal.id))}</div>
        </div>

        ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("goals.detailKeyPaths", {}, "Key Paths"))}</span>
          <div class="goal-path-list">
            <button class="button goal-path-button" data-open-source="${escapeHtml(goalDocFilePath(goal, "00-goal.md"))}">${escapeHtml(t("goals.detailOpenGoalDoc", {}, "Open 00-goal"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goal.northstarPath)}">${escapeHtml(t("goals.detailOpenNorthstar", {}, "Open NORTHSTAR.md"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goal.tasksPath)}">${escapeHtml(t("goals.detailOpenTasksGraph", {}, "Open Tasks Graph"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goalRuntimeFilePath(goal, "capability-plans.json"))}">${escapeHtml(t("goals.detailOpenCapabilityPlans", {}, "Open capability-plans.json"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goalRuntimeFilePath(goal, "checkpoints.json"))}">${escapeHtml(t("goals.detailOpenCheckpoints", {}, "Open checkpoints.json"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goal.progressPath)}">${escapeHtml(t("goals.detailOpenProgress", {}, "Open progress"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goal.handoffPath)}">${escapeHtml(t("goals.detailOpenHandoff", {}, "Open handoff"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goalRuntimeFilePath(goal, "state.json"))}">${escapeHtml(t("goals.detailOpenState", {}, "Open state.json"))}</button>
            <button class="button goal-path-button" data-open-source="${escapeHtml(goalRuntimeFilePath(goal, "runtime.json"))}">${escapeHtml(t("goals.detailOpenRuntime", {}, "Open runtime.json"))}</button>
          </div>
        </div>`}

        ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-grid">
          <div class="memory-detail-card"><span class="memory-detail-label">任务根目录</span><div class="memory-detail-pre">${escapeHtml(goal.goalRoot || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">文档根目录</span><div class="memory-detail-pre">${escapeHtml(goal.docRoot || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">运行态根目录</span><div class="memory-detail-pre">${escapeHtml(goal.runtimeRoot || "-")}</div></div>
        </div>`}

        <div class="goal-detail-actions">
          <button class="button" data-open-goal-tasks="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailOpenTasks", {}, "View Related Tasks"))}</button>
          ${archived ? `<button class="button goal-inline-action-secondary" data-goal-delete-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.delete", {}, "Delete"))}</button>` : ""}
          ${archived ? "" : `<button class="button" data-goal-resume-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.detailResumeAndEnter", {}, "Resume and Enter"))}</button>`}
          ${archived ? "" : (lastNodeId ? `<button class="button" data-goal-resume-last-node="${escapeHtml(goal.id)}" data-goal-last-node-id="${escapeHtml(lastNodeId)}">${escapeHtml(t("goals.detailResumeLastNode", {}, "Resume Last Node"))}</button>` : "")}
          ${archived ? "" : `<button class="button goal-inline-action-secondary" data-goal-pause-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.pause", {}, "Pause"))}</button>`}
          ${archived ? "" : `<button class="button goal-inline-action-secondary" data-goal-archive-detail="${escapeHtml(goal.id)}">${escapeHtml(t("goals.archive", {}, "Archive"))}</button>`}
        </div>

        ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card goal-canvas-card">
          <div id="goalCanvasPanel">
            <div class="memory-viewer-empty">${escapeHtml(t("goals.detailBoardLoading", {}, "Loading board-ref.json ..."))}</div>
          </div>
        </div>`}

        <div class="memory-detail-card goal-tracking-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("goals.detailTrackingTitle", {}, "Checkpoint / Node Tracking"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("goals.detailTrackingText", {}, "Reads structured execution progress for the current long task from tasks.json and checkpoints.json."))}</div>
            </div>
          </div>
          <div id="goalTrackingPanel">
            <div class="memory-viewer-empty">${escapeHtml(t("goals.detailTrackingLoading", {}, "Loading tasks.json / checkpoints.json ..."))}</div>
          </div>
        </div>

        ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card goal-capability-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("goals.detailCapabilityTitle", {}, "Capability Plan"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("goals.detailCapabilityText", {}, "Reads pre-execution plans and post-run actual usage from capability-plans.json."))}</div>
            </div>
          </div>
          <div id="goalCapabilityPanel">
            <div class="memory-viewer-empty">${escapeHtml(t("goals.detailCapabilityLoading", {}, "Loading capability-plans.json ..."))}</div>
          </div>
        </div>`}

        ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card goal-progress-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("goals.detailProgressTitle", {}, "Execution Timeline"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("goals.detailProgressText", {}, "Reads node transitions and checkpoint approval timeline from progress.md."))}</div>
            </div>
          </div>
          <div id="goalProgressPanel">
            <div class="memory-viewer-empty">${escapeHtml(t("goals.detailProgressLoading", {}, "Loading progress.md ..."))}</div>
          </div>
        </div>`}
      </div>
    `;

    onBindDetailActions?.(goal);
    onLoadGoalCanvasData?.(goal);
    onLoadGoalTrackingData?.(goal);
    onLoadGoalCapabilityData?.(goal);
    onLoadGoalProgressData?.(goal);
    onLoadGoalHandoffData?.(goal);
    onLoadGoalReviewGovernanceData?.(goal);
  }

  return {
    renderGoalDetail,
  };
}
