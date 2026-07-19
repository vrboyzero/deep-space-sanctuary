// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsStateRuntimeFeature } from "./goals-state-runtime.js";

function createHarness(stateOverrides = {}) {
  document.body.innerHTML = '<section id="goals"></section>';
  const goalsState = {
    items: [],
    selectedId: null,
    liveUpdatePending: {},
    liveUpdateTimers: {},
    liveUpdateDelayMs: 120,
    ...stateOverrides,
  };
  const overview = {
    renderGoalsSummary: vi.fn(),
    renderGoalList: vi.fn(),
  };
  const detail = { renderGoalDetail: vi.fn() };
  const renderCanvasGoalContext = vi.fn();
  const feature = createGoalsStateRuntimeFeature({
    refs: { goalsSection: document.getElementById("goals") },
    getGoalsState: () => goalsState,
    getGoalsOverviewFeature: () => overview,
    getGoalsDetailFeature: () => detail,
    renderCanvasGoalContext,
  });
  return { goalsState, overview, detail, renderCanvasGoalContext, feature };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("goals state live-update lifecycle", () => {
  it("coalesces updates and releases settled timer entries", async () => {
    vi.useFakeTimers();
    const { goalsState, overview, detail, feature } = createHarness({
      items: [{ id: "goal-1", title: "Old", status: "executing" }],
      selectedId: "goal-1",
    });

    feature.queueGoalUpdateEvent({
      goal: { id: "goal-1", title: "First", status: "executing" },
      areas: ["progress"],
    });
    feature.queueGoalUpdateEvent({
      goal: { id: "goal-1", title: "Latest", status: "executing" },
      areas: ["tracking"],
    });
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 1,
      activeTimerCount: 1,
      disposed: false,
    });

    await vi.advanceTimersByTimeAsync(120);
    expect(goalsState.items[0].title).toBe("Latest");
    expect(overview.renderGoalList).toHaveBeenCalledTimes(1);
    expect(detail.renderGoalDetail).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
    });
  });

  it("clears pending payloads and timers on dispose", async () => {
    vi.useFakeTimers();
    const { goalsState, overview, feature } = createHarness();

    feature.queueGoalUpdateEvent({ goal: { id: "goal-1", title: "One" } });
    feature.queueGoalUpdateEvent({ goal: { id: "goal-2", title: "Two" } });
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
    feature.queueGoalUpdateEvent({ goal: { id: "goal-3", title: "Late" } });
    expect(goalsState.items).toHaveLength(0);
    expect(overview.renderGoalList).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingUpdateCount: 0,
      activeTimerCount: 0,
    });
  });
});
