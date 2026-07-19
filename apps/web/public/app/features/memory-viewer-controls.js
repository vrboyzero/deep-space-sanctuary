import { createPanelTaskScope } from "./panel-task-scope.js";

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
  const taskScope = createPanelTaskScope();

  function addOwnedCommand(target, command) {
    if (!target) return;
    taskScope.addEventListener(target, "click", () => {
      command();
    });
  }

  function activate() {
    if (!taskScope.activate()) return false;
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
