export function createGoalSubtaskListControlsFeature({
  refs = {},
  goalsState,
  subtasksState,
  loadGoals,
  loadSubtasks,
} = {}) {
  const {
    goalsRefreshBtn,
    goalsShowArchivedEl,
    subtasksRefreshBtn,
    subtasksShowArchivedEl,
  } = refs;
  const listenerEntries = [];
  let disposed = false;

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  addOwnedListener(goalsRefreshBtn, "click", () => {
    if (disposed) return;
    void loadGoals?.(true);
  });
  if (goalsShowArchivedEl) {
    // 初始化仅投影既有运行态，避免 DOM 默认值反向覆盖筛选状态。
    goalsShowArchivedEl.checked = goalsState?.includeArchived === true;
    addOwnedListener(goalsShowArchivedEl, "change", () => {
      if (disposed) return;
      goalsState.includeArchived = goalsShowArchivedEl.checked === true;
      void loadGoals?.(true);
    });
  }
  addOwnedListener(subtasksRefreshBtn, "click", () => {
    if (disposed) return;
    void loadSubtasks?.(true);
  });
  if (subtasksShowArchivedEl) {
    subtasksShowArchivedEl.checked = subtasksState?.includeArchived === true;
    addOwnedListener(subtasksShowArchivedEl, "change", () => {
      if (disposed) return;
      subtasksState.includeArchived = subtasksShowArchivedEl.checked === true;
      void loadSubtasks?.(true);
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, type, handler } of listenerEntries) {
      target.removeEventListener(type, handler);
    }
    listenerEntries.length = 0;
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerEntries.length,
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
  };
}
