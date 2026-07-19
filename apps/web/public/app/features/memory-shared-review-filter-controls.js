import { createPanelTaskScope } from "./panel-task-scope.js";

export function createMemorySharedReviewFilterControlsFeature({
  refs = {},
  state,
  createDefaultSharedReviewFilters,
  getMemoryViewerFeature,
  loadMemoryViewer,
} = {}) {
  const {
    memorySharedReviewFocusFilterEl,
    memorySharedReviewTargetFilterEl,
    memorySharedReviewClaimedByFilterEl,
    memorySharedReviewClearFiltersBtn,
  } = refs;
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    taskScope.addEventListener(target, type, handler);
  }

  function mergeCurrentFilters(updates) {
    state.sharedReviewFilters = {
      ...createDefaultSharedReviewFilters(),
      ...state.sharedReviewFilters,
      ...updates,
    };
  }

  function reloadIfActive() {
    if (state.tab === "sharedReview") {
      loadMemoryViewer?.(true);
    }
  }

  function activate() {
    if (!taskScope.activate()) return false;
    addOwnedListener(memorySharedReviewFocusFilterEl, "change", () => {
      const next = String(memorySharedReviewFocusFilterEl.value || "").trim();
      mergeCurrentFilters({
        focus: next === "actionable" || next === "mine" ? next : "",
        claimedByAgentId: "",
      });
      getMemoryViewerFeature?.()?.syncSharedReviewFilterUi?.();
      reloadIfActive();
    });
    addOwnedListener(memorySharedReviewTargetFilterEl, "change", () => {
      mergeCurrentFilters({
        targetAgentId: String(memorySharedReviewTargetFilterEl.value || "").trim(),
      });
      reloadIfActive();
    });
    addOwnedListener(memorySharedReviewClaimedByFilterEl, "change", () => {
      mergeCurrentFilters({
        focus: "",
        claimedByAgentId: String(memorySharedReviewClaimedByFilterEl.value || "").trim(),
      });
      getMemoryViewerFeature?.()?.syncSharedReviewFilterUi?.();
      reloadIfActive();
    });
    addOwnedListener(memorySharedReviewClearFiltersBtn, "click", () => {
      state.sharedReviewFilters = createDefaultSharedReviewFilters();
      getMemoryViewerFeature?.()?.syncSharedReviewFilterUi?.();
      reloadIfActive();
    });
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
