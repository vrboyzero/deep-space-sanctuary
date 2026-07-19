import { afterEach, describe, expect, it, vi } from "vitest";

import { createSubtasksOverviewFeature } from "./subtasks-overview.js";

function createHarness(stateOverrides = {}) {
  const subtasksState = {
    items: [],
    selectedId: null,
    selectedItem: null,
    includeArchived: false,
    conversationId: "",
    liveUpdatePending: {},
    liveUpdateTimers: {},
    liveUpdateDelayMs: 120,
    ...stateOverrides,
  };
  const feature = createSubtasksOverviewFeature({
    refs: {},
    isConnected: () => true,
    isViewActive: () => false,
    sendReq: vi.fn(),
    makeId: () => "request-1",
    getSubtasksState: () => subtasksState,
    getActiveConversationId: () => "",
    escapeHtml: (value) => String(value),
    formatDateTime: (value) => String(value),
    summarizeSourcePath: (value) => String(value),
  });
  return { subtasksState, feature };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("subtasks overview live-update lifecycle", () => {
  it("coalesces updates and releases settled timer entries", async () => {
    vi.useFakeTimers();
    const { subtasksState, feature } = createHarness({
      items: [{ id: "task-1", name: "Old", createdAt: 1 }],
      selectedId: "task-1",
    });

    feature.handleSubtaskUpdate({ item: { id: "task-1", name: "First", createdAt: 1 } });
    feature.handleSubtaskUpdate({ item: { id: "task-1", name: "Latest", createdAt: 1 } });
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 1,
      activeTimerCount: 1,
      disposed: false,
    });

    await vi.advanceTimersByTimeAsync(120);
    expect(subtasksState.items).toEqual([
      expect.objectContaining({ id: "task-1", name: "Latest" }),
    ]);
    expect(subtasksState.selectedItem).toEqual(
      expect.objectContaining({ id: "task-1", name: "Latest" }),
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
    });
  });

  it("clears pending payloads and timers on dispose", async () => {
    vi.useFakeTimers();
    const { subtasksState, feature } = createHarness();

    feature.handleSubtaskUpdate({ item: { id: "task-1", name: "One", createdAt: 1 } });
    feature.handleSubtaskUpdate({ item: { id: "task-2", name: "Two", createdAt: 2 } });
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 2,
      activeTimerCount: 2,
    });

    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(500);
    feature.handleSubtaskUpdate({ item: { id: "task-3", name: "Late", createdAt: 3 } });
    expect(subtasksState.items).toHaveLength(0);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
    });
  });
});
