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
  const listenerEntries = [];
  let disposed = false;

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  function reloadWhen(...tabs) {
    if (disposed || !tabs.includes(getActiveTab?.())) return;
    loadMemoryViewer?.(true);
  }

  addOwnedListener(memoryTaskGoalFilterClearBtn, "click", () => {
    if (disposed) return;
    void clearMemoryTaskGoalFilter?.();
  });
  addOwnedListener(memorySearchInputEl, "keydown", (event) => {
    if (disposed || event.key !== "Enter") return;
    event.preventDefault();
    loadMemoryViewer?.(true);
  });
  addOwnedListener(memoryTaskStatusFilterEl, "change", () => reloadWhen("tasks"));
  addOwnedListener(memoryTaskSourceFilterEl, "change", () => reloadWhen("tasks"));
  addOwnedListener(memoryChunkTypeFilterEl, "change", () => reloadWhen("memories"));
  addOwnedListener(memoryChunkVisibilityFilterEl, "change", () => reloadWhen("memories"));
  addOwnedListener(memoryChunkGovernanceFilterEl, "change", () => reloadWhen("memories", "sharedReview"));
  addOwnedListener(memoryChunkCategoryFilterEl, "change", () => reloadWhen("memories"));

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
