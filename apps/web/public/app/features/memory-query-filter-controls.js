import { createPanelTaskScope } from "./panel-task-scope.js";

export function createMemoryQueryFilterControlsFeature({
  refs = {},
  getActiveTab,
  loadMemoryViewer,
  clearMemoryTaskGoalFilter,
} = {}) {
  const {
    memoryTaskGoalFilterClearBtn,
    memorySearchInputEl,
    memoryTaskStatusFilterEl,
    memoryTaskSourceFilterEl,
    memoryChunkTypeFilterEl,
    memoryChunkVisibilityFilterEl,
    memoryChunkGovernanceFilterEl,
    memoryChunkCategoryFilterEl,
  } = refs;
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    taskScope.addEventListener(target, type, handler);
  }

  function reloadWhen(...tabs) {
    if (!tabs.includes(getActiveTab?.())) return;
    loadMemoryViewer?.(true);
  }

  function activate() {
    if (!taskScope.activate()) return false;
    addOwnedListener(memoryTaskGoalFilterClearBtn, "click", () => {
      void clearMemoryTaskGoalFilter?.();
    });
    addOwnedListener(memorySearchInputEl, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      loadMemoryViewer?.(true);
    });
    addOwnedListener(memoryTaskStatusFilterEl, "change", () => reloadWhen("tasks"));
    addOwnedListener(memoryTaskSourceFilterEl, "change", () => reloadWhen("tasks"));
    addOwnedListener(memoryChunkTypeFilterEl, "change", () => reloadWhen("memories"));
    addOwnedListener(memoryChunkVisibilityFilterEl, "change", () => reloadWhen("memories"));
    addOwnedListener(memoryChunkGovernanceFilterEl, "change", () => reloadWhen("memories", "sharedReview"));
    addOwnedListener(memoryChunkCategoryFilterEl, "change", () => reloadWhen("memories"));
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
