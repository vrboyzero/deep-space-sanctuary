// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCanvasContextFeature } from "./canvas-context.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFixture() {
  const capabilityRequest = createDeferred();
  const canvasContextBarEl = document.createElement("section");
  canvasContextBarEl.className = "hidden";
  document.body.append(canvasContextBarEl);
  const goal = {
    id: "goal-1",
    title: "Lifecycle goal",
    boardId: "board-1",
    activeNodeId: "node-1",
  };
  const goalsState = {
    items: [goal],
    capabilityPending: {},
  };
  let capabilityEntry = null;
  const canvasApp = {
    currentBoardId: "board-1",
    setGoalContext: vi.fn(),
  };
  const ensureGoalCapabilityCache = vi.fn(() => {
    goalsState.capabilityPending[goal.id] = true;
    return capabilityRequest.promise;
  });
  const feature = createCanvasContextFeature({
    refs: { canvasContextBarEl },
    getCanvasApp: () => canvasApp,
    getGoalsState: () => goalsState,
    getActiveConversationId: () => "",
    getGoalById: () => goal,
    normalizeGoalBoardId: (value) => String(value || "").trim(),
    getCachedGoalCapabilityEntry: () => capabilityEntry,
    goalRuntimeFilePath: () => "",
    escapeHtml: (value) => String(value || ""),
    ensureGoalCapabilityCache,
    switchMode: vi.fn(),
    loadGoals: vi.fn(),
    openGoalTaskViewer: vi.fn(),
    openConversationSession: vi.fn(),
    openSourcePath: vi.fn(),
    showNotice: vi.fn(),
    getGoalDisplayName: () => goal.title,
  });

  function settleCapabilityRequest() {
    capabilityEntry = {
      plans: [{
        id: "plan-1",
        nodeId: "node-1",
        executionMode: "serial",
        riskLevel: "low",
        status: "ready",
        analysis: { status: "aligned" },
      }],
    };
    delete goalsState.capabilityPending[goal.id];
    capabilityRequest.resolve();
  }

  return {
    canvasApp,
    canvasContextBarEl,
    feature,
    settleCapabilityRequest,
  };
}

describe("canvas context lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("refreshes the current context after the capability request settles", async () => {
    const fixture = createFixture();

    fixture.feature.renderCanvasGoalContext();
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      disposed: false,
      pendingCapabilityRequestCount: 1,
    });

    fixture.settleCapabilityRequest();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.canvasApp.setGoalContext).toHaveBeenCalledTimes(2);
    expect(fixture.canvasContextBarEl.innerHTML).toContain("serial");
    expect(fixture.feature.getRuntimeSnapshot().pendingCapabilityRequestCount).toBe(0);
  });

  it("keeps physical settlement observable without rendering after dispose", async () => {
    const fixture = createFixture();

    fixture.feature.renderCanvasGoalContext();
    fixture.feature.dispose();
    const contextWriteCountAfterDispose = fixture.canvasApp.setGoalContext.mock.calls.length;

    expect(fixture.canvasContextBarEl.innerHTML).toBe("");
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingCapabilityRequestCount: 1,
    });

    fixture.settleCapabilityRequest();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.canvasContextBarEl.innerHTML).toBe("");
    expect(fixture.canvasApp.setGoalContext).toHaveBeenCalledTimes(contextWriteCountAfterDispose);
    expect(fixture.feature.getRuntimeSnapshot().pendingCapabilityRequestCount).toBe(0);

    fixture.feature.renderCanvasGoalContext();
    expect(fixture.canvasContextBarEl.innerHTML).toBe("");
  });
});
