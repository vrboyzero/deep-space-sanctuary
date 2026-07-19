const CONTENT_REF_NAMES = [
  "memoryViewerTitleEl",
  "memoryViewerStatsEl",
  "memoryViewerListEl",
  "memoryViewerDetailEl",
  "memorySharedReviewBatchBarEl",
  "memoryDreamModalTitleEl",
  "memoryDreamBarEl",
  "memoryDreamStatusEl",
  "memoryDreamMetaEl",
  "memoryDreamObsidianEl",
  "memoryDreamSummaryEl",
  "memoryDreamHistoryStatusEl",
  "memoryDreamHistoryListEl",
  "memoryDreamHistoryDetailEl",
  "memoryDedupModalTitleEl",
  "memoryDedupModalSummaryEl",
  "memoryDedupModalStatusEl",
  "memoryDedupModalWarningEl",
  "memoryDedupModalListEl",
];

const MODAL_REF_NAMES = [
  "memoryDreamModalEl",
  "memoryDedupModalEl",
];

export function createMemoryViewerRetainedStateLifecycle({
  getState,
  refs = {},
} = {}) {
  let disposed = false;

  function getRuntimeSnapshot() {
    const state = getState?.() || {};
    return {
      disposed,
      populatedDomCount: CONTENT_REF_NAMES.filter((name) => String(refs[name]?.textContent || "").length > 0).length,
      retainedDreamHistoryItemCount: Array.isArray(state.dreamHistoryItems) ? state.dreamHistoryItems.length : 0,
      retainedItemCount: Array.isArray(state.items) ? state.items.length : 0,
      retainedSharedReviewSelectionCount: Array.isArray(state.selectedSharedReviewIds)
        ? state.selectedSharedReviewIds.length
        : 0,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const state = getState?.();
    if (state && typeof state === "object") {
      state.listPageByTab = {};
      state.stats = null;
      state.items = [];
      state.selectedId = null;
      state.selectedTask = null;
      state.selectedCandidate = null;
      state.goalIdFilter = null;
      state.pendingUsageRevokeId = null;
      state.pendingExperienceActionKey = null;
      state.usageOverview = { loading: false, methods: [], skills: [] };
      state.usageOverviewSeq = Number(state.usageOverviewSeq || 0) + 1;
      state.memoryQueryView = null;
      state.experienceQueryView = null;
      state.sharedGovernance = null;
      state.memoryEvaluation = null;
      state.sharedReviewSummary = null;
      state.sharedReviewFilters = { focus: "", targetAgentId: "", claimedByAgentId: "" };
      state.selectedSharedReviewIds = [];
      state.sharedReviewBatchBusy = false;
      state.dreamRuntime = null;
      state.dreamCommons = null;
      state.dreamBusy = false;
      state.dreamHistoryOpen = false;
      state.dreamHistoryLoading = false;
      state.dreamHistoryError = "";
      state.dreamHistoryItems = [];
      state.selectedDreamHistoryId = null;
      state.selectedDreamHistoryItem = null;
      state.selectedDreamHistoryContent = "";
      state.dreamHistoryDetailLoading = false;
      state.dreamHistoryDetailError = "";
      state.dreamHistorySeq = Number(state.dreamHistorySeq || 0) + 1;
      state.dreamHistoryDetailSeq = Number(state.dreamHistoryDetailSeq || 0) + 1;
      state.dedupModal = {
        open: false,
        loading: false,
        applying: false,
        error: "",
        report: null,
        result: null,
      };
      state.agentViewStates = {};
    }

    for (const name of CONTENT_REF_NAMES) {
      if (refs[name]) refs[name].textContent = "";
    }
    for (const name of MODAL_REF_NAMES) {
      refs[name]?.classList?.add("hidden");
    }
  }

  return {
    dispose,
    getRuntimeSnapshot,
  };
}
