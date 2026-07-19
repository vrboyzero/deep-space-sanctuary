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
  const listenerEntries = [];
  let disposed = false;

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
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

  addOwnedListener(memorySharedReviewFocusFilterEl, "change", () => {
    if (disposed) return;
    const next = String(memorySharedReviewFocusFilterEl.value || "").trim();
    mergeCurrentFilters({
      focus: next === "actionable" || next === "mine" ? next : "",
      claimedByAgentId: "",
    });
    getMemoryViewerFeature?.()?.syncSharedReviewFilterUi?.();
    reloadIfActive();
  });
  addOwnedListener(memorySharedReviewTargetFilterEl, "change", () => {
    if (disposed) return;
    mergeCurrentFilters({
      targetAgentId: String(memorySharedReviewTargetFilterEl.value || "").trim(),
    });
    reloadIfActive();
  });
  addOwnedListener(memorySharedReviewClaimedByFilterEl, "change", () => {
    if (disposed) return;
    mergeCurrentFilters({
      focus: "",
      claimedByAgentId: String(memorySharedReviewClaimedByFilterEl.value || "").trim(),
    });
    getMemoryViewerFeature?.()?.syncSharedReviewFilterUi?.();
    reloadIfActive();
  });
  addOwnedListener(memorySharedReviewClearFiltersBtn, "click", () => {
    if (disposed) return;
    state.sharedReviewFilters = createDefaultSharedReviewFilters();
    getMemoryViewerFeature?.()?.syncSharedReviewFilterUi?.();
    reloadIfActive();
  });

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
