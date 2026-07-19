import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerRetainedStateLifecycle } from "./memory-viewer-retained-state.js";

function createContentRef(value = "body") {
  return {
    textContent: value,
    classList: { add: vi.fn() },
  };
}

describe("memory viewer retained state lifecycle", () => {
  it("clears retained state and DOM bodies without exposing their contents", () => {
    const state = {
      listPageByTab: { tasks: 2 },
      stats: { total: 1 },
      items: [{ id: "private-item", content: "private body" }],
      selectedId: "private-item",
      selectedTask: { summary: "private task" },
      selectedCandidate: { summary: "private candidate" },
      goalIdFilter: "private-goal",
      pendingUsageRevokeId: "private-usage",
      pendingExperienceActionKey: "private-action",
      usageOverview: { loading: true, methods: [{ body: "private" }], skills: [{ body: "private" }] },
      usageOverviewSeq: 3,
      memoryQueryView: { query: "private query" },
      experienceQueryView: { query: "private query" },
      sharedGovernance: { body: "private" },
      memoryEvaluation: { body: "private" },
      sharedReviewSummary: { body: "private" },
      sharedReviewFilters: { focus: "mine", targetAgentId: "private-agent", claimedByAgentId: "private-agent" },
      selectedSharedReviewIds: ["private-item"],
      sharedReviewBatchBusy: true,
      dreamRuntime: { body: "private" },
      dreamCommons: { body: "private" },
      dreamBusy: true,
      dreamHistoryOpen: true,
      dreamHistoryLoading: true,
      dreamHistoryError: "private error",
      dreamHistoryItems: [{ id: "private-dream" }],
      selectedDreamHistoryId: "private-dream",
      selectedDreamHistoryItem: { body: "private" },
      selectedDreamHistoryContent: "private dream body",
      dreamHistoryDetailLoading: true,
      dreamHistoryDetailError: "private error",
      dreamHistorySeq: 4,
      dreamHistoryDetailSeq: 5,
      dedupModal: {
        open: true,
        loading: true,
        applying: true,
        error: "private error",
        report: { body: "private" },
        result: { body: "private" },
      },
      agentViewStates: { "private-agent": { query: "private" } },
      requestToken: 9,
    };
    const refs = {
      memoryViewerListEl: createContentRef(),
      memoryViewerDetailEl: createContentRef(),
      memoryDreamHistoryDetailEl: createContentRef(),
      memoryDedupModalListEl: createContentRef(),
      memoryDreamModalEl: createContentRef(),
      memoryDedupModalEl: createContentRef(),
    };
    const lifecycle = createMemoryViewerRetainedStateLifecycle({
      getState: () => state,
      refs,
    });

    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      retainedItemCount: 1,
      retainedDreamHistoryItemCount: 1,
      retainedSharedReviewSelectionCount: 1,
      populatedDomCount: 4,
      disposed: false,
    });

    lifecycle.dispose();
    lifecycle.dispose();

    expect(state).toMatchObject({
      items: [],
      selectedId: null,
      selectedTask: null,
      selectedCandidate: null,
      selectedDreamHistoryContent: "",
      selectedSharedReviewIds: [],
      dreamHistoryItems: [],
      sharedReviewBatchBusy: false,
      dreamBusy: false,
      requestToken: 9,
    });
    expect(state.usageOverviewSeq).toBe(4);
    expect(state.dreamHistorySeq).toBe(5);
    expect(state.dreamHistoryDetailSeq).toBe(6);
    expect(state.dedupModal).toMatchObject({
      open: false,
      loading: false,
      applying: false,
      error: "",
      report: null,
      result: null,
    });
    expect(refs.memoryViewerListEl.textContent).toBe("");
    expect(refs.memoryViewerDetailEl.textContent).toBe("");
    expect(refs.memoryDreamHistoryDetailEl.textContent).toBe("");
    expect(refs.memoryDedupModalListEl.textContent).toBe("");
    expect(refs.memoryDreamModalEl.classList.add).toHaveBeenCalledWith("hidden");
    expect(refs.memoryDedupModalEl.classList.add).toHaveBeenCalledWith("hidden");
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      retainedItemCount: 0,
      retainedDreamHistoryItemCount: 0,
      retainedSharedReviewSelectionCount: 0,
      populatedDomCount: 0,
      disposed: true,
    });
  });
});
