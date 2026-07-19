import { createPanelTaskScope } from "./panel-task-scope.js";

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
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    taskScope.addEventListener(target, type, handler);
  }

  function activate() {
    if (!taskScope.activate()) return false;
    // 初始化仅投影既有运行态，避免 DOM 默认值反向覆盖筛选状态。
    if (goalsShowArchivedEl) goalsShowArchivedEl.checked = goalsState?.includeArchived === true;
    if (subtasksShowArchivedEl) subtasksShowArchivedEl.checked = subtasksState?.includeArchived === true;

    addOwnedListener(goalsRefreshBtn, "click", () => {
      void loadGoals?.(true);
    });
    if (goalsShowArchivedEl) {
      addOwnedListener(goalsShowArchivedEl, "change", () => {
        goalsState.includeArchived = goalsShowArchivedEl.checked === true;
        void loadGoals?.(true);
      });
    }
    addOwnedListener(subtasksRefreshBtn, "click", () => {
      void loadSubtasks?.(true);
    });
    if (subtasksShowArchivedEl) {
      addOwnedListener(subtasksShowArchivedEl, "change", () => {
        subtasksState.includeArchived = subtasksShowArchivedEl.checked === true;
        void loadSubtasks?.(true);
      });
    }
    return true;
  }

  function deactivate() {
    return taskScope.deactivate();
  }

  function dispose() {
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      active: snapshot.active,
      listenerCount: snapshot.listenerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
  };
}
