export function createGoalsStateRuntimeFeature({
  refs,
  getGoalsState,
  getGoalsOverviewFeature,
  getGoalsDetailFeature,
  renderCanvasGoalContext,
  loadGoalTrackingData,
  loadGoalProgressData,
  loadGoalHandoffData,
  loadGoalCapabilityData,
  loadGoalReviewGovernanceData,
  loadGoalCanvasData,
}) {
  const { goalsSection } = refs;
  let disposed = false;

  function getGoalById(goalId) {
    const goalsState = getGoalsState?.();
    return Array.isArray(goalsState?.items)
      ? goalsState.items.find((goal) => goal && goal.id === goalId) || null
      : null;
  }

  function sortGoals(items) {
    return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
      const aActive = a?.status === "executing" ? 1 : 0;
      const bActive = b?.status === "executing" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aUpdated = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const bUpdated = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      if (aUpdated !== bUpdated) return bUpdated - aUpdated;
      return String(a?.title || "").localeCompare(String(b?.title || ""));
    });
  }

  function upsertGoalStateItem(goal) {
    if (!goal || !goal.id) return null;
    const goalsState = getGoalsState?.();
    const current = Array.isArray(goalsState?.items) ? goalsState.items : [];
    goalsState.items = sortGoals([...current.filter((item) => item && item.id !== goal.id), goal]);
    return getGoalById(goal.id);
  }

  function getGoalDisplayName(goalId) {
    if (!goalId) return "-";
    const goal = getGoalById(goalId);
    return goal?.title || goalId;
  }

  function isGoalsViewActive() {
    return Boolean(goalsSection && !goalsSection.classList.contains("hidden"));
  }

  function needsGoalDetailRerender(previousGoal, nextGoal) {
    if (!previousGoal) return true;
    const fields = [
      "title",
      "objective",
      "status",
      "currentPhase",
      "pathSource",
      "activeConversationId",
      "activeNodeId",
      "lastNodeId",
      "lastRunId",
      "pausedAt",
      "goalRoot",
      "docRoot",
      "runtimeRoot",
      "northstarPath",
      "tasksPath",
      "progressPath",
      "handoffPath",
      "boardId",
    ];
    return fields.some((field) => String(previousGoal?.[field] || "") !== String(nextGoal?.[field] || ""));
  }

  function refreshGoalDetailAreas(goal, areas) {
    const goalsState = getGoalsState?.();
    if (!goal || !Array.isArray(areas) || !isGoalsViewActive() || goalsState?.selectedId !== goal.id) return;
    const areaSet = new Set(areas);
    if (areaSet.has("tracking")) void loadGoalTrackingData?.(goal);
    if (areaSet.has("progress")) void loadGoalProgressData?.(goal);
    if (areaSet.has("handoff")) void loadGoalHandoffData?.(goal);
    if (areaSet.has("capability")) void loadGoalCapabilityData?.(goal);
    if (areaSet.has("goal") || areaSet.has("tracking") || areaSet.has("capability")) {
      void loadGoalReviewGovernanceData?.(goal);
    }
    if (areaSet.has("goal") && areaSet.has("tracking")) void loadGoalCanvasData?.(goal);
  }

  function flushGoalUpdate(goalId) {
    if (disposed || !goalId) return;
    const goalsState = getGoalsState?.();
    if (!goalsState) return;
    if (goalsState.liveUpdateTimers?.[goalId]) {
      clearTimeout(goalsState.liveUpdateTimers[goalId]);
      delete goalsState.liveUpdateTimers[goalId];
    }
    const pending = goalsState.liveUpdatePending?.[goalId];
    if (!pending?.goal) return;
    delete goalsState.liveUpdatePending[goalId];

    const previousGoal = getGoalById(goalId);
    const mergedGoal = upsertGoalStateItem(pending.goal) || pending.goal;
    if (isGoalsViewActive()) {
      getGoalsOverviewFeature?.()?.renderGoalsSummary(goalsState.items);
      getGoalsOverviewFeature?.()?.renderGoalList(goalsState.items);
    }
    if (goalsState.selectedId === goalId && isGoalsViewActive()) {
      if (needsGoalDetailRerender(previousGoal, mergedGoal)) {
        getGoalsDetailFeature?.()?.renderGoalDetail(mergedGoal);
      } else {
        refreshGoalDetailAreas(mergedGoal, pending.areas);
      }
    }
    renderCanvasGoalContext?.();
  }

  function queueGoalUpdateEvent(payload) {
    if (disposed) return;
    const goal = payload && payload.goal && typeof payload.goal === "object" ? payload.goal : null;
    const goalId = typeof goal?.id === "string" ? goal.id : "";
    if (!goalId) return;
    const goalsState = getGoalsState?.();
    if (!goalsState) return;
    if (!goalsState.liveUpdatePending || typeof goalsState.liveUpdatePending !== "object") {
      goalsState.liveUpdatePending = {};
    }
    if (!goalsState.liveUpdateTimers || typeof goalsState.liveUpdateTimers !== "object") {
      goalsState.liveUpdateTimers = {};
    }
    const areas = Array.isArray(payload?.areas)
      ? payload.areas.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const pending = goalsState.liveUpdatePending?.[goalId];
    goalsState.liveUpdatePending[goalId] = {
      goal,
      areas: pending?.areas
        ? [...new Set([...pending.areas, ...areas])]
        : [...new Set(areas)],
      reason: payload?.reason || pending?.reason || "",
      at: payload?.at || pending?.at || "",
    };
    if (goalsState.liveUpdateTimers?.[goalId]) {
      clearTimeout(goalsState.liveUpdateTimers[goalId]);
    }
    goalsState.liveUpdateTimers[goalId] = setTimeout(() => {
      flushGoalUpdate(goalId);
    }, goalsState.liveUpdateDelayMs || 120);
  }

  function clearLiveUpdates() {
    const goalsState = getGoalsState?.();
    if (!goalsState) return;
    for (const timer of Object.values(goalsState.liveUpdateTimers || {})) {
      clearTimeout(timer);
    }
    // pending goal payload 可能包含完整 objective，只在其 owner 内随 timer 一起释放。
    goalsState.liveUpdateTimers = {};
    goalsState.liveUpdatePending = {};
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearLiveUpdates();
  }

  function getRuntimeSnapshot() {
    const goalsState = getGoalsState?.();
    return {
      pendingUpdateCount: Object.keys(goalsState?.liveUpdatePending || {}).length,
      activeTimerCount: Object.keys(goalsState?.liveUpdateTimers || {}).length,
      disposed,
    };
  }

  return {
    dispose,
    getGoalById,
    sortGoals,
    getGoalDisplayName,
    getRuntimeSnapshot,
    queueGoalUpdateEvent,
  };
}
