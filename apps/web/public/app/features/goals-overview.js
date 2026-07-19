import { createPanelTaskScope } from "./panel-task-scope.js";

export function createGoalsOverviewFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getGoalsState,
  getActiveConversationId,
  isConversationForGoal,
  escapeHtml,
  formatGoalStatus,
  formatDateTime,
  summarizeSourcePath,
  formatGoalPathSource,
  sortGoals,
  getGoalById,
  renderGoalDetail,
  renderCanvasGoalContext,
  onResumeGoal,
  onPauseGoal,
  onArchiveGoal,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    goalsSection,
    goalsSummaryEl,
    goalsListEl,
    goalsDetailEl,
  } = refs;
  const taskScope = createPanelTaskScope();
  taskScope.activate();
  taskScope.addEventListener(goalsListEl, "click", handleGoalListClick);

  function renderGoalsLoading(message) {
    if (!taskScope.isActive()) return;
    if (goalsListEl) {
      goalsListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
    if (goalsDetailEl) {
      goalsDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("goals.detailSelect", {}, "Select a long task on the left to view details."))}</div>`;
    }
  }

  function renderGoalsSummary(items) {
    if (!taskScope.isActive()) return;
    if (!goalsSummaryEl) return;
    const goals = Array.isArray(items) ? items : [];
    const executingCount = goals.filter((goal) => goal?.status === "executing").length;
    const pausedCount = goals.filter((goal) => goal?.status === "paused").length;
    const customRootCount = goals.filter((goal) => goal?.pathSource === "user-configured").length;

    goalsSummaryEl.innerHTML = `
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("goals.statGoals", {}, "Long Tasks"))}</span><strong class="memory-stat-value">${escapeHtml(String(goals.length))}</strong></div>
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("goals.statExecuting", {}, "Executing"))}</span><strong class="memory-stat-value">${escapeHtml(String(executingCount))}</strong></div>
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("goals.statPaused", {}, "Paused"))}</span><strong class="memory-stat-value">${escapeHtml(String(pausedCount))}</strong></div>
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("goals.statCustomRoot", {}, "Custom Root"))}</span><strong class="memory-stat-value">${escapeHtml(String(customRootCount))}</strong></div>
    `;
  }

  function renderGoalsEmpty(message) {
    if (!taskScope.isActive()) return;
    renderGoalsSummary([]);
    if (goalsListEl) {
      goalsListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
    if (goalsDetailEl) {
      goalsDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("goals.emptyCreateFirst", {}, "After you create a long task, NORTHSTAR.md, paths, and execution status will appear here."))}</div>`;
    }
  }

  function renderGoalList(items) {
    if (!taskScope.isActive()) return;
    if (!goalsListEl) return;
    if (!Array.isArray(items) || items.length === 0) {
      const emptyMessage = getGoalsState()?.includeArchived === true
        ? t("goals.emptyNoGoals", {}, "There are no long tasks yet.")
        : t("goals.emptyNoVisibleGoals", {}, "No long tasks to display. Archived tasks are hidden by default.");
      goalsListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(emptyMessage)}</div>`;
      return;
    }

    const goalsState = getGoalsState();
    const activeConversationId = getActiveConversationId();

    goalsListEl.innerHTML = items.map((goal) => {
      const isActive = goal.id === goalsState.selectedId;
      const isCurrentConversation = isConversationForGoal(activeConversationId, goal.id);
      const objective = goal.objective ? String(goal.objective).trim() : "";
      const archived = goal.status === "archived";
      return `
        <div class="memory-list-item goal-list-item${isActive ? " active" : ""}" data-goal-id="${escapeHtml(goal.id)}">
          <div class="goal-list-item-head">
            <div class="memory-list-item-title">${escapeHtml(goal.title || goal.id)}</div>
            ${isCurrentConversation ? '<span class="memory-badge memory-badge-shared">当前</span>' : ""}
            ${archived ? `<span class="memory-badge">${escapeHtml(t("goals.archivedBadge", {}, "archived"))}</span>` : ""}
          </div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(formatGoalStatus(goal.status))}</span>
            <span>${escapeHtml(goal.currentPhase || "-")}</span>
            <span>${escapeHtml(formatDateTime(goal.updatedAt || goal.createdAt))}</span>
          </div>
          <div class="memory-list-item-snippet">${escapeHtml(objective || t("goals.noObjective", {}, "No objective yet. Open NORTHSTAR.md to add the goal description."))}</div>
          <div class="goal-list-item-meta">
            <span>${escapeHtml(summarizeSourcePath(goal.goalRoot || "-"))}</span>
            <span>${escapeHtml(formatGoalPathSource(goal.pathSource))}</span>
          </div>
          <div class="goal-list-item-actions">
            ${archived
              ? ""
              : `<button class="button goal-inline-action" data-goal-resume="${escapeHtml(goal.id)}">${escapeHtml(t("goals.resume", {}, "Resume"))}</button>
            <button class="button goal-inline-action goal-inline-action-secondary" data-goal-pause="${escapeHtml(goal.id)}">${escapeHtml(t("goals.pause", {}, "Pause"))}</button>
            <button class="button goal-inline-action goal-inline-action-secondary" data-goal-archive="${escapeHtml(goal.id)}">${escapeHtml(t("goals.archive", {}, "Archive"))}</button>`}
          </div>
        </div>
      `;
    }).join("");
  }

  function handleGoalListClick(event) {
    if (!taskScope.isActive() || !goalsListEl || !(event.target instanceof Element)) return;
    // 单一根 listener 避免每轮列表渲染继续积累 detached button 与闭包。
    const actionNode = event.target.closest(
      "[data-goal-resume], [data-goal-pause], [data-goal-archive], [data-goal-id]",
    );
    if (!actionNode || !goalsListEl.contains(actionNode)) return;

    for (const [attribute, handler] of [
      ["data-goal-resume", onResumeGoal],
      ["data-goal-pause", onPauseGoal],
      ["data-goal-archive", onArchiveGoal],
    ]) {
      if (!actionNode.hasAttribute(attribute)) continue;
      event.stopPropagation();
      const goalId = actionNode.getAttribute(attribute);
      if (goalId) void handler(goalId);
      return;
    }

    const goalId = actionNode.getAttribute("data-goal-id");
    if (!goalId) return;
    const goalsState = getGoalsState();
    goalsState.selectedId = goalId;
    renderGoalList(goalsState.items);
    renderGoalDetail(getGoalById(goalId));
  }

  async function loadGoals(forceReload = false, preferredGoalId) {
    if (!taskScope.isActive()) return;
    if (!goalsSection) return;
    if (!isConnected()) {
      renderGoalsLoading(t("goals.loadingDisconnected", {}, "Disconnected"));
      return;
    }

    const goalsState = getGoalsState();
    if (forceReload || goalsState.items.length === 0) {
      renderGoalsLoading(t("goals.loading", {}, "Loading..."));
    }

    goalsState.loadSeq += 1;
    const requestTask = taskScope.beginTask();
    if (!requestTask) return;
    let res;
    try {
      res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.list",
        params: {
          includeArchived: goalsState.includeArchived === true,
        },
      }, {
        signal: requestTask.signal,
      });
    } catch (error) {
      if (!requestTask.isCurrent()) return;
      throw error;
    } finally {
      requestTask.settle();
    }
    if (!requestTask.isCurrent()) return;

    if (!res || !res.ok || !Array.isArray(res.payload?.goals)) {
      renderGoalsEmpty(t("goals.listLoadFailed", {}, "Failed to load long task list."));
      return;
    }

    const items = sortGoals(res.payload.goals);
    goalsState.items = items;
    renderGoalsSummary(items);

    if (items.length === 0) {
      goalsState.selectedId = null;
      renderGoalsEmpty(goalsState.includeArchived === true
        ? t("goals.emptyNoGoals", {}, "There are no long tasks yet.")
        : t("goals.emptyNoVisibleGoals", {}, "No long tasks to display. Archived tasks are hidden by default."));
      return;
    }

    const selectedExists = items.some((goal) => goal.id === goalsState.selectedId);
    goalsState.selectedId = preferredGoalId && items.some((goal) => goal.id === preferredGoalId)
      ? preferredGoalId
      : selectedExists
        ? goalsState.selectedId
        : items[0].id;

    renderGoalList(items);
    renderGoalDetail(getGoalById(goalsState.selectedId));
    renderCanvasGoalContext();
  }

  function dispose() {
    if (taskScope.getRuntimeSnapshot().disposed) return;
    taskScope.dispose();
    const goalsState = getGoalsState?.();
    if (goalsState) {
      // 列表响应含完整 objective，随其 owner 一起释放，避免 pagehide 后继续保留正文。
      goalsState.items = [];
      goalsState.selectedId = null;
      goalsState.loadSeq = Number(goalsState.loadSeq || 0) + 1;
    }
    if (goalsSummaryEl) goalsSummaryEl.innerHTML = "";
    if (goalsListEl) goalsListEl.innerHTML = "";
    if (goalsDetailEl) goalsDetailEl.innerHTML = "";
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      active: snapshot.active,
      disposed: snapshot.disposed,
      listenerCount: snapshot.listenerCount,
      pendingTaskCount: snapshot.pendingTaskCount,
      pendingGoalListReadCount: snapshot.pendingTaskCount,
      retainedGoalListListenerCount: snapshot.listenerCount,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    loadGoals,
    renderGoalList,
    renderGoalsEmpty,
    renderGoalsLoading,
    renderGoalsSummary,
  };
}
