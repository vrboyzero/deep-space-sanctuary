// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsOverviewFeature } from "./goals-overview.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFixture({ sendReq = vi.fn() } = {}) {
  document.body.innerHTML = `
    <section id="goals"></section>
    <div id="summary">retained summary</div>
    <div id="list">retained list</div>
    <div id="detail">retained detail</div>
  `;
  const goalsState = {
    items: [{ id: "goal-retained", objective: "retained objective" }],
    selectedId: "goal-retained",
    includeArchived: false,
    loadSeq: 0,
  };
  const renderGoalDetail = vi.fn();
  const renderCanvasGoalContext = vi.fn();
  const onResumeGoal = vi.fn();
  const onPauseGoal = vi.fn();
  const onArchiveGoal = vi.fn();
  const feature = createGoalsOverviewFeature({
    refs: {
      goalsSection: document.getElementById("goals"),
      goalsSummaryEl: document.getElementById("summary"),
      goalsListEl: document.getElementById("list"),
      goalsDetailEl: document.getElementById("detail"),
    },
    isConnected: () => true,
    sendReq,
    makeId: () => "request-1",
    getGoalsState: () => goalsState,
    getActiveConversationId: () => "",
    isConversationForGoal: () => false,
    escapeHtml: (value) => String(value ?? ""),
    formatGoalStatus: (value) => String(value ?? ""),
    formatDateTime: (value) => String(value ?? ""),
    summarizeSourcePath: (value) => String(value ?? ""),
    formatGoalPathSource: (value) => String(value ?? ""),
    sortGoals: (items) => [...items],
    getGoalById: (goalId) => goalsState.items.find((goal) => goal.id === goalId) || null,
    renderGoalDetail,
    renderCanvasGoalContext,
    onResumeGoal,
    onPauseGoal,
    onArchiveGoal,
    t: (_key, _params, fallback) => fallback || "",
  });
  return {
    feature,
    goalsState,
    refs: {
      summary: document.getElementById("summary"),
      list: document.getElementById("list"),
      detail: document.getElementById("detail"),
    },
    renderCanvasGoalContext,
    renderGoalDetail,
    onArchiveGoal,
    onPauseGoal,
    onResumeGoal,
    sendReq,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("goals overview lifecycle", () => {
  it("settles a disposed goal list read without restoring state or retained DOM", async () => {
    const request = createDeferred();
    const sendReq = vi.fn(() => request.promise);
    const {
      feature,
      goalsState,
      refs,
      renderCanvasGoalContext,
      renderGoalDetail,
    } = createFixture({ sendReq });

    const load = feature.loadGoals(true);
    expect(feature.getRuntimeSnapshot().pendingGoalListReadCount).toBe(1);

    feature.dispose();
    expect(refs.summary.innerHTML).toBe("");
    expect(refs.list.innerHTML).toBe("");
    expect(refs.detail.innerHTML).toBe("");
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalListReadCount: 1,
    });

    request.resolve({
      ok: true,
      payload: { goals: [{ id: "goal-late", title: "Late goal" }] },
    });
    await load;

    feature.renderGoalsSummary([{ id: "goal-after-dispose" }]);
    feature.renderGoalList([{ id: "goal-after-dispose" }]);
    await feature.loadGoals(true);
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(goalsState.items).toEqual([]);
    expect(goalsState.selectedId).toBeNull();
    expect(refs.summary.innerHTML).toBe("");
    expect(refs.list.innerHTML).toBe("");
    expect(refs.detail.innerHTML).toBe("");
    expect(renderGoalDetail).not.toHaveBeenCalled();
    expect(renderCanvasGoalContext).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot().pendingGoalListReadCount).toBe(0);
  });

  it("settles a disposed rejected goal list read without restoring content", async () => {
    const request = createDeferred();
    const { feature, refs } = createFixture({
      sendReq: vi.fn(() => request.promise),
    });

    const load = feature.loadGoals(true);
    feature.dispose();
    request.reject(new Error("late goal list failure"));

    await expect(load).resolves.toBeUndefined();
    expect(refs.summary.innerHTML).toBe("");
    expect(refs.list.innerHTML).toBe("");
    expect(refs.detail.innerHTML).toBe("");
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalListReadCount: 0,
    });
  });

  it("allows only the latest goal list read to commit state and views", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const sendReq = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    const {
      feature,
      goalsState,
      renderCanvasGoalContext,
      renderGoalDetail,
    } = createFixture({ sendReq });

    const firstLoad = feature.loadGoals(true);
    const secondLoad = feature.loadGoals(true);
    expect(feature.getRuntimeSnapshot().pendingGoalListReadCount).toBe(2);

    firstRequest.resolve({
      ok: true,
      payload: { goals: [{ id: "goal-stale", title: "Stale goal" }] },
    });
    await firstLoad;
    expect(goalsState.items).toEqual([
      expect.objectContaining({ id: "goal-retained" }),
    ]);
    expect(feature.getRuntimeSnapshot().pendingGoalListReadCount).toBe(1);

    secondRequest.resolve({
      ok: true,
      payload: { goals: [{ id: "goal-fresh", title: "Fresh goal", status: "executing" }] },
    });
    await secondLoad;
    expect(goalsState.items).toEqual([
      expect.objectContaining({ id: "goal-fresh", title: "Fresh goal" }),
    ]);
    expect(goalsState.selectedId).toBe("goal-fresh");
    expect(renderGoalDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "goal-fresh" }),
    );
    expect(renderCanvasGoalContext).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: false,
      goalListGeneration: 2,
      pendingGoalListReadCount: 0,
    });
  });

  it("preserves active goal actions and releases their dynamic listeners on dispose", async () => {
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { goals: [{ id: "goal-active", title: "Active goal", status: "executing" }] },
    });
    const {
      feature,
      refs,
      onArchiveGoal,
      onPauseGoal,
      onResumeGoal,
    } = createFixture({ sendReq });

    await feature.loadGoals(true);
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "goal.list",
      params: { includeArchived: false },
    }));
    expect(feature.getRuntimeSnapshot().retainedGoalListListenerCount).toBe(4);

    const resumeButton = refs.list.querySelector("[data-goal-resume]");
    const pauseButton = refs.list.querySelector("[data-goal-pause]");
    const archiveButton = refs.list.querySelector("[data-goal-archive]");
    resumeButton.click();
    pauseButton.click();
    archiveButton.click();
    expect(onResumeGoal).toHaveBeenCalledWith("goal-active");
    expect(onPauseGoal).toHaveBeenCalledWith("goal-active");
    expect(onArchiveGoal).toHaveBeenCalledWith("goal-active");

    feature.dispose();
    resumeButton.click();
    expect(onResumeGoal).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      retainedGoalListListenerCount: 0,
    });
    expect(refs.list.childElementCount).toBe(0);
  });
});
