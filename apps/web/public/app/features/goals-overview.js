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
  // generation 负责截止逻辑提交，Set 单独保留底层 Promise 的真实未结算数量。
  const pendingGoalListReads = new Set();
  const goalListListenerDisposers = new Set();
  let goalListGeneration = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && goalListGeneration === expectedGeneration;
  }

  function clearGoalListListeners() {
    for (const disposeListener of goalListListenerDisposers) disposeListener();
    goalListListenerDisposers.clear();
  }

  function addGoalListListener(node, listener) {
    node.addEventListener("click", listener);
    goalListListenerDisposers.add(() => node.removeEventListener("click", listener));
  }

  function renderGoalsLoading(message) {
    if (disposed) return;
    clearGoalListListeners();
    if (goalsListEl) {
      goalsListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
    if (goalsDetailEl) {
      goalsDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("goals.detailSelect", {}, "Select a long task on the left to view details."))}</div>`;
    }
  }

  function renderGoalsSummary(items) {
    if (disposed) return;
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
    if (disposed) return;
    clearGoalListListeners();
    renderGoalsSummary([]);
    if (goalsListEl) {
      goalsListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
    if (goalsDetailEl) {
      goalsDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("goals.emptyCreateFirst", {}, "After you create a long task, NORTHSTAR.md, paths, and execution status will appear here."))}</div>`;
    }
  }

  function renderGoalList(items) {
    if (disposed) return;
    if (!goalsListEl) return;
    clearGoalListListeners();
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

    goalsListEl.querySelectorAll("[data-goal-id]").forEach((node) => {
      addGoalListListener(node, () => {
        if (disposed) return;
        const goalId = node.getAttribute("data-goal-id");
        if (!goalId) return;
        goalsState.selectedId = goalId;
        renderGoalList(goalsState.items);
        renderGoalDetail(getGoalById(goalId));
      });
    });

    goalsListEl.querySelectorAll("[data-goal-resume]").forEach((node) => {
      addGoalListListener(node, (event) => {
        if (disposed) return;
        event.stopPropagation();
        const goalId = node.getAttribute("data-goal-resume");
        if (!goalId) return;
        void onResumeGoal(goalId);
      });
    });

    goalsListEl.querySelectorAll("[data-goal-pause]").forEach((node) => {
      addGoalListListener(node, (event) => {
        if (disposed) return;
        event.stopPropagation();
        const goalId = node.getAttribute("data-goal-pause");
        if (!goalId) return;
        void onPauseGoal(goalId);
      });
    });

    goalsListEl.querySelectorAll("[data-goal-archive]").forEach((node) => {
      addGoalListListener(node, (event) => {
        if (disposed) return;
        event.stopPropagation();
        const goalId = node.getAttribute("data-goal-archive");
        if (!goalId) return;
        void onArchiveGoal(goalId);
      });
    });
  }

  async function loadGoals(forceReload = false, preferredGoalId) {
    if (disposed) return;
    if (!goalsSection) return;
    if (!isConnected()) {
      renderGoalsLoading(t("goals.loadingDisconnected", {}, "Disconnected"));
      return;
    }

    const goalsState = getGoalsState();
    if (forceReload || goalsState.items.length === 0) {
      renderGoalsLoading(t("goals.loading", {}, "Loading..."));
    }

    const seq = goalsState.loadSeq + 1;
    goalsState.loadSeq = seq;
    const expectedGeneration = ++goalListGeneration;
    const pendingToken = Symbol("goal-list-read");
    pendingGoalListReads.add(pendingToken);
    let res;
    try {
      res = await sendReq({
        type: "req",
        id: makeId(),
        method: "goal.list",
        params: {
          includeArchived: goalsState.includeArchived === true,
        },
      });
    } catch (error) {
      if (!isCurrent(expectedGeneration)) return;
      throw error;
    } finally {
      pendingGoalListReads.delete(pendingToken);
    }
    if (!isCurrent(expectedGeneration) || seq !== goalsState.loadSeq) return;

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
    if (disposed) return;
    disposed = true;
    goalListGeneration += 1;
    clearGoalListListeners();
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
    return {
      disposed,
      goalListGeneration,
      pendingGoalListReadCount: pendingGoalListReads.size,
      retainedGoalListListenerCount: goalListListenerDisposers.size,
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
