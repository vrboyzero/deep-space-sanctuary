import { createPanelTaskScope } from "./panel-task-scope.js";
import { createGoalsOverviewEmptyStateFeature } from "./goals-overview-empty-state.js";
import { createGoalsOverviewListView } from "./goals-overview-list-view.js";
import { createGoalsOverviewSummaryView } from "./goals-overview-summary-view.js";

export function createGoalsOverviewFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getGoalsState,
  getActiveConversationId,
  isConversationForGoal,
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
  const emptyStateFeature = createGoalsOverviewEmptyStateFeature({
    refs: { goalsListEl, goalsDetailEl },
  });
  const summaryView = createGoalsOverviewSummaryView({
    refs: { goalsSummaryEl },
    t,
  });
  const listView = createGoalsOverviewListView({
    refs: { goalsListEl },
    isConversationForGoal,
    formatGoalStatus,
    formatDateTime,
    summarizeSourcePath,
    formatGoalPathSource,
    t,
  });
  const taskScope = createPanelTaskScope();
  taskScope.activate();
  taskScope.addEventListener(goalsListEl, "click", handleGoalListClick);

  function renderGoalsLoading(message) {
    if (!taskScope.isActive()) return;
    emptyStateFeature.renderListEmpty(message);
    emptyStateFeature.renderDetailEmpty(t("goals.detailSelect", {}, "Select a long task on the left to view details."));
  }

  function renderGoalsSummary(items) {
    if (!taskScope.isActive()) return;
    summaryView.render(items);
  }

  function renderGoalsEmpty(message) {
    if (!taskScope.isActive()) return;
    renderGoalsSummary([]);
    emptyStateFeature.renderListEmpty(message);
    emptyStateFeature.renderDetailEmpty(t("goals.emptyCreateFirst", {}, "After you create a long task, NORTHSTAR.md, paths, and execution status will appear here."));
  }

  function renderGoalList(items) {
    if (!taskScope.isActive()) return;
    if (!goalsListEl) return;
    if (!Array.isArray(items) || items.length === 0) {
      const emptyMessage = getGoalsState()?.includeArchived === true
        ? t("goals.emptyNoGoals", {}, "There are no long tasks yet.")
        : t("goals.emptyNoVisibleGoals", {}, "No long tasks to display. Archived tasks are hidden by default.");
      emptyStateFeature.renderListEmpty(emptyMessage);
      return;
    }

    const goalsState = getGoalsState();
    const activeConversationId = getActiveConversationId();
    listView.render({
      items,
      selectedId: goalsState.selectedId,
      activeConversationId,
    });
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
