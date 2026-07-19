// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryQueryFilterControlsFeature } from "./memory-query-filter-controls.js";

describe("memory query filter controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reloads only for active controls and filters owned by the active tab", () => {
    document.body.innerHTML = `
      <button id="goal-clear"></button>
      <input id="search" />
      <select id="task-status"></select>
      <select id="task-source"></select>
      <select id="chunk-type"></select>
      <select id="chunk-visibility"></select>
      <select id="chunk-governance"></select>
      <select id="chunk-category"></select>
    `;
    let activeTab = "tasks";
    const loadMemoryViewer = vi.fn();
    const clearMemoryTaskGoalFilter = vi.fn();
    const feature = createMemoryQueryFilterControlsFeature({
      refs: {
        memoryTaskGoalFilterClearBtn: document.getElementById("goal-clear"),
        memorySearchInputEl: document.getElementById("search"),
        memoryTaskStatusFilterEl: document.getElementById("task-status"),
        memoryTaskSourceFilterEl: document.getElementById("task-source"),
        memoryChunkTypeFilterEl: document.getElementById("chunk-type"),
        memoryChunkVisibilityFilterEl: document.getElementById("chunk-visibility"),
        memoryChunkGovernanceFilterEl: document.getElementById("chunk-governance"),
        memoryChunkCategoryFilterEl: document.getElementById("chunk-category"),
      },
      getActiveTab: () => activeTab,
      loadMemoryViewer,
      clearMemoryTaskGoalFilter,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 8, disposed: false });
    document.getElementById("goal-clear").click();
    expect(clearMemoryTaskGoalFilter).toHaveBeenCalledTimes(1);
    const ignoredKey = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    document.getElementById("search").dispatchEvent(ignoredKey);
    const enterKey = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    document.getElementById("search").dispatchEvent(enterKey);
    expect(enterKey.defaultPrevented).toBe(true);
    document.getElementById("task-status").dispatchEvent(new Event("change"));
    document.getElementById("task-source").dispatchEvent(new Event("change"));
    document.getElementById("chunk-type").dispatchEvent(new Event("change"));

    activeTab = "memories";
    document.getElementById("task-status").dispatchEvent(new Event("change"));
    document.getElementById("chunk-type").dispatchEvent(new Event("change"));
    document.getElementById("chunk-visibility").dispatchEvent(new Event("change"));
    document.getElementById("chunk-governance").dispatchEvent(new Event("change"));
    document.getElementById("chunk-category").dispatchEvent(new Event("change"));

    activeTab = "sharedReview";
    document.getElementById("chunk-governance").dispatchEvent(new Event("change"));
    document.getElementById("chunk-category").dispatchEvent(new Event("change"));
    expect(loadMemoryViewer).toHaveBeenCalledTimes(8);
    expect(loadMemoryViewer).toHaveBeenCalledWith(true);

    expect(feature.deactivate()).toBe(true);
    document.getElementById("goal-clear").click();
    const inactiveEnterKey = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    document.getElementById("search").dispatchEvent(inactiveEnterKey);
    document.getElementById("chunk-governance").dispatchEvent(new Event("change"));
    expect(inactiveEnterKey.defaultPrevented).toBe(false);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: false });
    expect(clearMemoryTaskGoalFilter).toHaveBeenCalledTimes(1);
    expect(loadMemoryViewer).toHaveBeenCalledTimes(8);

    expect(feature.activate()).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 8, disposed: false });
    activeTab = "tasks";
    document.getElementById("goal-clear").click();
    const reactivatedEnterKey = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    document.getElementById("search").dispatchEvent(reactivatedEnterKey);
    document.getElementById("task-status").dispatchEvent(new Event("change"));
    document.getElementById("chunk-type").dispatchEvent(new Event("change"));
    expect(reactivatedEnterKey.defaultPrevented).toBe(true);
    expect(clearMemoryTaskGoalFilter).toHaveBeenCalledTimes(2);
    expect(loadMemoryViewer).toHaveBeenCalledTimes(10);

    feature.dispose();
    feature.dispose();
    expect(feature.activate()).toBe(false);
    document.getElementById("goal-clear").click();
    document.getElementById("search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    document.getElementById("task-status").dispatchEvent(new Event("change"));
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(clearMemoryTaskGoalFilter).toHaveBeenCalledTimes(2);
    expect(loadMemoryViewer).toHaveBeenCalledTimes(10);
  });
});
