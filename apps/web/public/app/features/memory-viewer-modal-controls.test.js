// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerModalControls } from "./memory-viewer-modal-controls.js";

describe("memory viewer modal controls", () => {
  it("routes dedup, Dream, and document listeners only while active", () => {
    document.body.innerHTML = `
      <div id="dedup"><button id="dedup-close"></button><button id="dedup-cancel"></button><button id="dedup-submit"></button></div>
      <div id="dream-modal"></div><button id="dream-trigger"></button><button id="dream-close"></button>
      <div id="dream-list"><button data-dream-history-id="dream-1"></button></div>
      <div id="dream-detail">
        <button data-dream-consolidation-action="approve"></button>
        <button data-dream-consolidation-action="reject"></button>
        <button data-dream-consolidation-action="apply"></button>
      </div>
    `;
    const closeDedupModal = vi.fn();
    const applyDedupFromModal = vi.fn();
    const loadDreamHistoryDetail = vi.fn();
    const reviewDreamConsolidation = vi.fn();
    const applyDreamConsolidation = vi.fn();
    const openDreamModal = vi.fn();
    const closeDreamModal = vi.fn();
    const controls = createMemoryViewerModalControls({
      refs: {
        memoryDedupModalEl: document.getElementById("dedup"),
        memoryDedupModalCloseBtn: document.getElementById("dedup-close"),
        memoryDedupModalCancelBtn: document.getElementById("dedup-cancel"),
        memoryDedupModalSubmitBtn: document.getElementById("dedup-submit"),
        memoryDreamHistoryListEl: document.getElementById("dream-list"),
        memoryDreamHistoryDetailEl: document.getElementById("dream-detail"),
        memoryDreamModalTriggerBtn: document.getElementById("dream-trigger"),
        memoryDreamModalCloseBtn: document.getElementById("dream-close"),
        memoryDreamModalEl: document.getElementById("dream-modal"),
      },
      documentTarget: document,
      getDreamModalOpen: () => true,
      closeDedupModal,
      applyDedupFromModal,
      loadDreamHistoryDetail,
      reviewDreamConsolidation,
      applyDreamConsolidation,
      openDreamModal,
      closeDreamModal,
    });

    function dispatchAllControls() {
      document.getElementById("dedup-close").click();
      document.getElementById("dedup-cancel").click();
      document.getElementById("dedup-submit").click();
      document.getElementById("dedup").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector("[data-dream-history-id]").click();
      document.querySelector('[data-dream-consolidation-action="approve"]').click();
      document.querySelector('[data-dream-consolidation-action="reject"]').click();
      document.querySelector('[data-dream-consolidation-action="apply"]').click();
      document.getElementById("dream-trigger").click();
      document.getElementById("dream-close").click();
      document.getElementById("dream-modal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }

    expect(controls.getRuntimeSnapshot()).toMatchObject({ disposed: false, ownedModalListenerCount: 10 });
    dispatchAllControls();

    expect(closeDedupModal).toHaveBeenCalledTimes(3);
    expect(applyDedupFromModal).toHaveBeenCalledTimes(1);
    expect(loadDreamHistoryDetail).toHaveBeenCalledWith("dream-1");
    expect(reviewDreamConsolidation.mock.calls).toEqual([["approved"], ["rejected"]]);
    expect(applyDreamConsolidation).toHaveBeenCalledTimes(1);
    expect(openDreamModal).toHaveBeenCalledTimes(1);
    expect(closeDreamModal).toHaveBeenCalledTimes(3);

    expect(controls.deactivate()).toBe(true);
    dispatchAllControls();
    expect(controls.getRuntimeSnapshot()).toMatchObject({ disposed: false, ownedModalListenerCount: 0 });
    expect(closeDedupModal).toHaveBeenCalledTimes(3);
    expect(applyDedupFromModal).toHaveBeenCalledTimes(1);
    expect(loadDreamHistoryDetail).toHaveBeenCalledTimes(1);
    expect(reviewDreamConsolidation).toHaveBeenCalledTimes(2);
    expect(applyDreamConsolidation).toHaveBeenCalledTimes(1);
    expect(openDreamModal).toHaveBeenCalledTimes(1);
    expect(closeDreamModal).toHaveBeenCalledTimes(3);

    expect(controls.activate()).toBe(true);
    expect(controls.getRuntimeSnapshot()).toMatchObject({ disposed: false, ownedModalListenerCount: 10 });
    dispatchAllControls();
    expect(closeDedupModal).toHaveBeenCalledTimes(6);
    expect(applyDedupFromModal).toHaveBeenCalledTimes(2);
    expect(loadDreamHistoryDetail).toHaveBeenCalledTimes(2);
    expect(reviewDreamConsolidation.mock.calls).toEqual([
      ["approved"],
      ["rejected"],
      ["approved"],
      ["rejected"],
    ]);
    expect(applyDreamConsolidation).toHaveBeenCalledTimes(2);
    expect(openDreamModal).toHaveBeenCalledTimes(2);
    expect(closeDreamModal).toHaveBeenCalledTimes(6);

    controls.dispose();
    controls.dispose();
    expect(controls.activate()).toBe(false);
    dispatchAllControls();
    expect(controls.getRuntimeSnapshot()).toMatchObject({ disposed: true, ownedModalListenerCount: 0 });
    expect(closeDedupModal).toHaveBeenCalledTimes(6);
    expect(applyDedupFromModal).toHaveBeenCalledTimes(2);
    expect(loadDreamHistoryDetail).toHaveBeenCalledTimes(2);
    expect(reviewDreamConsolidation).toHaveBeenCalledTimes(4);
    expect(applyDreamConsolidation).toHaveBeenCalledTimes(2);
    expect(openDreamModal).toHaveBeenCalledTimes(2);
    expect(closeDreamModal).toHaveBeenCalledTimes(6);
  });
});
