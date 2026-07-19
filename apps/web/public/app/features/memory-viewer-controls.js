export function createMemoryViewerControlsFeature({
  refs = {},
  loadMemoryViewer,
  switchMemoryViewerTab,
  getMemoryViewerFeature,
} = {}) {
  const {
    memoryViewerRefreshBtn,
    memoryTabTasksBtn,
    memoryTabMemoriesBtn,
    memoryTabSharedReviewBtn,
    memoryTabOutboundAuditBtn,
    memoryOutboundAuditFocusAllBtn,
    memoryOutboundAuditFocusThreadsBtn,
    memorySearchBtn,
    memoryDedupPreviewBtn,
  } = refs;
  const listenerEntries = [];
  let disposed = false;

  function addOwnedCommand(target, command) {
    if (!target) return;
    const handler = () => {
      if (disposed) return;
      command();
    };
    target.addEventListener("click", handler);
    listenerEntries.push({ target, handler });
  }

  addOwnedCommand(memoryViewerRefreshBtn, () => loadMemoryViewer?.(true));
  addOwnedCommand(memoryTabTasksBtn, () => switchMemoryViewerTab?.("tasks"));
  addOwnedCommand(memoryTabMemoriesBtn, () => switchMemoryViewerTab?.("memories"));
  addOwnedCommand(memoryTabSharedReviewBtn, () => switchMemoryViewerTab?.("sharedReview"));
  addOwnedCommand(memoryTabOutboundAuditBtn, () => switchMemoryViewerTab?.("outboundAudit"));
  addOwnedCommand(memoryOutboundAuditFocusAllBtn, () => {
    getMemoryViewerFeature?.()?.switchOutboundAuditFocus?.("all");
  });
  addOwnedCommand(memoryOutboundAuditFocusThreadsBtn, () => {
    getMemoryViewerFeature?.()?.switchOutboundAuditFocus?.("threads");
  });
  addOwnedCommand(memorySearchBtn, () => loadMemoryViewer?.(true));
  addOwnedCommand(memoryDedupPreviewBtn, () => {
    void getMemoryViewerFeature?.()?.openDedupModal?.();
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, handler } of listenerEntries) {
      target.removeEventListener("click", handler);
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
