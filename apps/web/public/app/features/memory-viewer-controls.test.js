// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryViewerControlsFeature } from "./memory-viewer-controls.js";

describe("memory viewer controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("preserves root control mappings until dispose", () => {
    document.body.innerHTML = `
      <button id="refresh"></button>
      <button id="tasks"></button>
      <button id="memories"></button>
      <button id="shared"></button>
      <button id="audit"></button>
      <button id="focus-all"></button>
      <button id="focus-threads"></button>
      <button id="search"></button>
      <button id="dedup"></button>
    `;
    const loadMemoryViewer = vi.fn();
    const switchMemoryViewerTab = vi.fn();
    const memoryViewer = {
      switchOutboundAuditFocus: vi.fn(),
      openDedupModal: vi.fn(),
    };
    const feature = createMemoryViewerControlsFeature({
      refs: {
        memoryViewerRefreshBtn: document.getElementById("refresh"),
        memoryTabTasksBtn: document.getElementById("tasks"),
        memoryTabMemoriesBtn: document.getElementById("memories"),
        memoryTabSharedReviewBtn: document.getElementById("shared"),
        memoryTabOutboundAuditBtn: document.getElementById("audit"),
        memoryOutboundAuditFocusAllBtn: document.getElementById("focus-all"),
        memoryOutboundAuditFocusThreadsBtn: document.getElementById("focus-threads"),
        memorySearchBtn: document.getElementById("search"),
        memoryDedupPreviewBtn: document.getElementById("dedup"),
      },
      loadMemoryViewer,
      switchMemoryViewerTab,
      getMemoryViewerFeature: () => memoryViewer,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 9, disposed: false });
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    expect(loadMemoryViewer.mock.calls).toEqual([[true], [true]]);
    expect(switchMemoryViewerTab.mock.calls).toEqual([
      ["tasks"],
      ["memories"],
      ["sharedReview"],
      ["outboundAudit"],
    ]);
    expect(memoryViewer.switchOutboundAuditFocus.mock.calls).toEqual([["all"], ["threads"]]);
    expect(memoryViewer.openDedupModal).toHaveBeenCalledTimes(1);

    feature.dispose();
    feature.dispose();
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(loadMemoryViewer).toHaveBeenCalledTimes(2);
    expect(switchMemoryViewerTab).toHaveBeenCalledTimes(4);
    expect(memoryViewer.switchOutboundAuditFocus).toHaveBeenCalledTimes(2);
    expect(memoryViewer.openDedupModal).toHaveBeenCalledTimes(1);
  });
});
