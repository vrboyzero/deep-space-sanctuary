// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDreamControlsFeature } from "./memory-dream-controls.js";

describe("memory dream controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards dream commands until dispose", () => {
    document.body.innerHTML = `
      <button id="refresh"></button>
      <button id="run"></button>
      <button id="history-toggle"></button>
      <button id="history-refresh"></button>
    `;
    const memoryViewer = {
      loadDreamRuntimeStatus: vi.fn(),
      loadDreamCommonsStatus: vi.fn(),
      runDream: vi.fn(),
      toggleDreamHistory: vi.fn(),
      loadDreamHistory: vi.fn(),
    };
    const feature = createMemoryDreamControlsFeature({
      refs: {
        memoryDreamRefreshBtn: document.getElementById("refresh"),
        memoryDreamRunBtn: document.getElementById("run"),
        memoryDreamHistoryToggleBtn: document.getElementById("history-toggle"),
        memoryDreamHistoryRefreshBtn: document.getElementById("history-refresh"),
      },
      getMemoryViewerFeature: () => memoryViewer,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 4, disposed: false });
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    expect(memoryViewer.loadDreamRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(memoryViewer.loadDreamCommonsStatus).toHaveBeenCalledTimes(1);
    expect(memoryViewer.runDream).toHaveBeenCalledTimes(1);
    expect(memoryViewer.toggleDreamHistory).toHaveBeenCalledTimes(1);
    expect(memoryViewer.loadDreamHistory).toHaveBeenCalledWith(false);

    feature.dispose();
    feature.dispose();
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(memoryViewer.loadDreamRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(memoryViewer.loadDreamCommonsStatus).toHaveBeenCalledTimes(1);
    expect(memoryViewer.runDream).toHaveBeenCalledTimes(1);
    expect(memoryViewer.toggleDreamHistory).toHaveBeenCalledTimes(1);
    expect(memoryViewer.loadDreamHistory).toHaveBeenCalledTimes(1);
  });
});
