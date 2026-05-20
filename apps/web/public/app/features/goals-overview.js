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

  function renderGoalsLoading(message) {
    if (goalsListEl) {
      goalsListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
    if (goalsDetailEl) {
      goalsDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("goals.detailSelect", {}, "Select a long task on the left to view details."))}</div>`;
    }
  }

  function renderGoalsSummary(items) {
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
    renderGoalsSummary([]);
    if (goalsListEl) {
      goalsListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
    if (goalsDetailEl) {
      goalsDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("goals.emptyCreateFirst", {}, "After you create a long task, NORTHSTAR.md, paths, and execution status will appear here."))}</div>`;
    }
  }

  function renderGoalList(items) {
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

    goalsListEl.querySelectorAll("[data-goal-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const goalId = node.getAttribute("data-goal-id");
        if (!goalId) return;
        goalsState.selectedId = goalId;
        renderGoalList(goalsState.items);
        renderGoalDetail(getGoalById(goalId));
      });
    });

    goalsListEl.querySelectorAll("[data-goal-resume]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        const goalId = node.getAttribute("data-goal-resume");
        if (!goalId) return;
        void onResumeGoal(goalId);
      });
    });

    goalsListEl.querySelectorAll("[data-goal-pause]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        const goalId = node.getAttribute("data-goal-pause");
        if (!goalId) return;
        void onPauseGoal(goalId);
      });
    });

    goalsListEl.querySelectorAll("[data-goal-archive]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        const goalId = node.getAttribute("data-goal-archive");
        if (!goalId) return;
        void onArchiveGoal(goalId);
      });
    });
  }

  async function loadGoals(forceReload = false, preferredGoalId) {
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
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "goal.list",
      params: {
        includeArchived: goalsState.includeArchived === true,
      },
    });
    if (seq !== goalsState.loadSeq) return;

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

  return {
    loadGoals,
    renderGoalList,
    renderGoalsEmpty,
    renderGoalsLoading,
    renderGoalsSummary,
  };
}
