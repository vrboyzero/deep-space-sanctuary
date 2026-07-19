// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemorySharedReviewFilterControlsFeature } from "./memory-shared-review-filter-controls.js";

describe("memory shared review filter controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("preserves shared review filter transitions until dispose", () => {
    document.body.innerHTML = `
      <select id="focus"><option value="mine">Mine</option></select>
      <select id="target"><option value="agent-2">Agent 2</option></select>
      <select id="claimed"><option value="agent-3">Agent 3</option></select>
      <button id="clear"></button>
    `;
    const state = {
      tab: "sharedReview",
      sharedReviewFilters: {
        focus: "actionable",
        targetAgentId: "agent-1",
        claimedByAgentId: "agent-old",
        preserved: "yes",
      },
    };
    const createDefaultSharedReviewFilters = () => ({
      focus: "",
      targetAgentId: "",
      claimedByAgentId: "",
      defaulted: true,
    });
    const loadMemoryViewer = vi.fn();
    const memoryViewer = { syncSharedReviewFilterUi: vi.fn() };
    const feature = createMemorySharedReviewFilterControlsFeature({
      refs: {
        memorySharedReviewFocusFilterEl: document.getElementById("focus"),
        memorySharedReviewTargetFilterEl: document.getElementById("target"),
        memorySharedReviewClaimedByFilterEl: document.getElementById("claimed"),
        memorySharedReviewClearFiltersBtn: document.getElementById("clear"),
      },
      state,
      createDefaultSharedReviewFilters,
      getMemoryViewerFeature: () => memoryViewer,
      loadMemoryViewer,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 4, disposed: false });
    document.getElementById("focus").dispatchEvent(new Event("change"));
    expect(state.sharedReviewFilters).toMatchObject({
      focus: "mine",
      targetAgentId: "agent-1",
      claimedByAgentId: "",
      preserved: "yes",
      defaulted: true,
    });
    document.getElementById("target").dispatchEvent(new Event("change"));
    expect(state.sharedReviewFilters.targetAgentId).toBe("agent-2");
    document.getElementById("claimed").dispatchEvent(new Event("change"));
    expect(state.sharedReviewFilters).toMatchObject({
      focus: "",
      targetAgentId: "agent-2",
      claimedByAgentId: "agent-3",
    });
    document.getElementById("clear").click();
    expect(state.sharedReviewFilters).toEqual(createDefaultSharedReviewFilters());
    expect(memoryViewer.syncSharedReviewFilterUi).toHaveBeenCalledTimes(3);
    expect(loadMemoryViewer).toHaveBeenCalledTimes(4);
    expect(loadMemoryViewer).toHaveBeenCalledWith(true);

    state.tab = "memories";
    document.getElementById("target").dispatchEvent(new Event("change"));
    expect(state.sharedReviewFilters.targetAgentId).toBe("agent-2");
    expect(loadMemoryViewer).toHaveBeenCalledTimes(4);

    feature.dispose();
    feature.dispose();
    const retainedState = { ...state.sharedReviewFilters };
    document.getElementById("focus").dispatchEvent(new Event("change"));
    document.getElementById("clear").click();
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(state.sharedReviewFilters).toEqual(retainedState);
    expect(memoryViewer.syncSharedReviewFilterUi).toHaveBeenCalledTimes(3);
    expect(loadMemoryViewer).toHaveBeenCalledTimes(4);
  });
});
