import { createPanelTaskScope } from "./panel-task-scope.js";

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
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    taskScope.addEventListener(target, type, handler);
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

  function activate() {
    if (!taskScope.activate()) return false;
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
      disposed: snapshot.disposed,
      ownedModalListenerCount: snapshot.listenerCount,
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
