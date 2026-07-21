// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCanvasContextFeature } from "./canvas-context.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("canvas context DOM rendering", () => {
  it("renders context metadata and actions without using the HTML parser", async () => {
    const maliciousGoalName = '<img src=x onerror="alert(1)">Lifecycle goal';
    const maliciousSummary = '<button onclick="alert(2)">aligned</button>';
    const canvasContextBarEl = document.createElement("section");
    canvasContextBarEl.className = "hidden";
    document.body.append(canvasContextBarEl);
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(canvasContextBarEl, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Canvas context must not use innerHTML for structured content");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    const goal = {
      id: "goal-1",
      title: maliciousGoalName,
      boardId: "board-1",
      activeNodeId: "node-1",
      runtimeRoot: "runtime/goal-1",
    };
    const capabilityPlan = {
      id: "plan-1",
      nodeId: "node-1",
      executionMode: "serial",
      riskLevel: "low",
      status: "ready",
      summary: maliciousSummary,
      analysis: { status: "aligned" },
    };
    const switchMode = vi.fn();
    const loadGoals = vi.fn(async () => {});
    const openGoalTaskViewer = vi.fn(async () => {});
    const openConversationSession = vi.fn();
    const openSourcePath = vi.fn();
    const canvasApp = {
      currentBoardId: "board-1",
      setGoalContext: vi.fn(),
    };
    const feature = createCanvasContextFeature({
      refs: { canvasContextBarEl },
      getCanvasApp: () => canvasApp,
      getGoalsState: () => ({ items: [goal], capabilityPending: {} }),
      getActiveConversationId: () => "goal:goal-1:node:node-1:run:run-1",
      getGoalById: () => goal,
      normalizeGoalBoardId: (value) => String(value || "").trim(),
      getCachedGoalCapabilityEntry: () => ({ plans: [capabilityPlan] }),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/goal-1/${fileName}`,
      escapeHtml: (value) => String(value ?? ""),
      ensureGoalCapabilityCache: vi.fn(),
      switchMode,
      loadGoals,
      openGoalTaskViewer,
      openConversationSession,
      openSourcePath,
      showNotice: vi.fn(),
      getGoalDisplayName: () => maliciousGoalName,
    });

    expect(() => feature.renderCanvasGoalContext()).not.toThrow();
    expect(canvasContextBarEl.classList.contains("hidden")).toBe(false);
    expect(canvasContextBarEl.querySelectorAll(".canvas-context-item")).toHaveLength(8);
    expect(canvasContextBarEl.querySelectorAll(".canvas-context-note")).toHaveLength(2);
    expect(canvasContextBarEl.textContent).toContain(maliciousGoalName);
    expect(canvasContextBarEl.textContent).toContain(maliciousSummary);
    expect(canvasContextBarEl.querySelector("img, [onerror], [onclick]")).toBeNull();

    const actionButtons = canvasContextBarEl.querySelectorAll(".canvas-context-actions .canvas-tb-btn");
    expect(actionButtons).toHaveLength(4);
    actionButtons[0].click();
    actionButtons[1].click();
    actionButtons[2].click();
    actionButtons[3].click();
    await Promise.resolve();

    expect(switchMode).toHaveBeenCalledWith("goals");
    expect(loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(openGoalTaskViewer).toHaveBeenCalledWith("goal-1");
    expect(openConversationSession).toHaveBeenCalledWith(
      "goal:goal-1:node:node-1:run:run-1",
      `返回节点通道：${maliciousGoalName} / node-1`,
    );
    expect(openSourcePath).toHaveBeenCalledWith("runtime/goal-1/capability-plans.json");
    expect(canvasApp.setGoalContext).toHaveBeenCalledWith(expect.objectContaining({
      boardId: "board-1",
      capabilityPlanId: "plan-1",
      conversationId: "goal:goal-1:node:node-1:run:run-1",
      goalId: "goal-1",
      nodeId: "node-1",
      runId: "run-1",
    }));
  });
});
