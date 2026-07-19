export function createMemoryViewerModalControls({
  refs = {},
  documentTarget = globalThis.document,
  getDreamModalOpen,
  closeDedupModal,
  applyDedupFromModal,
  loadDreamHistoryDetail,
  reviewDreamConsolidation,
  applyDreamConsolidation,
  openDreamModal,
  closeDreamModal,
} = {}) {
  const listenerEntries = [];
  let disposed = false;

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  const {
    memoryDedupModalEl,
    memoryDedupModalCloseBtn,
    memoryDedupModalCancelBtn,
    memoryDedupModalSubmitBtn,
    memoryDreamHistoryListEl,
    memoryDreamHistoryDetailEl,
    memoryDreamModalTriggerBtn,
    memoryDreamModalCloseBtn,
    memoryDreamModalEl,
  } = refs;

  addOwnedListener(memoryDedupModalCloseBtn, "click", () => closeDedupModal?.());
  addOwnedListener(memoryDedupModalCancelBtn, "click", () => closeDedupModal?.());
  addOwnedListener(memoryDedupModalSubmitBtn, "click", () => {
    void applyDedupFromModal?.();
  });
  addOwnedListener(memoryDedupModalEl, "click", (event) => {
    if (event.target === memoryDedupModalEl) closeDedupModal?.();
  });
  addOwnedListener(memoryDreamHistoryListEl, "click", (event) => {
    const target = typeof event.target?.closest === "function"
      ? event.target.closest("[data-dream-history-id]")
      : null;
    const dreamId = target?.getAttribute("data-dream-history-id");
    if (dreamId) void loadDreamHistoryDetail?.(dreamId);
  });
  addOwnedListener(memoryDreamHistoryDetailEl, "click", (event) => {
    const target = typeof event.target?.closest === "function"
      ? event.target.closest("[data-dream-consolidation-action]")
      : null;
    const action = target?.getAttribute("data-dream-consolidation-action");
    if (action === "approve") {
      void reviewDreamConsolidation?.("approved");
    } else if (action === "reject") {
      void reviewDreamConsolidation?.("rejected");
    } else if (action === "apply") {
      void applyDreamConsolidation?.();
    }
  });
  addOwnedListener(memoryDreamModalTriggerBtn, "click", () => openDreamModal?.());
  addOwnedListener(memoryDreamModalCloseBtn, "click", () => closeDreamModal?.());
  addOwnedListener(memoryDreamModalEl, "click", (event) => {
    if (event.target === memoryDreamModalEl) closeDreamModal?.();
  });
  addOwnedListener(documentTarget, "keydown", (event) => {
    if (event.key === "Escape" && getDreamModalOpen?.()) closeDreamModal?.();
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
      disposed,
      ownedModalListenerCount: listenerEntries.length,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
  };
}
