// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsOverviewFeature } from "./goals-overview.js";

afterEach(() => {
  document.body.replaceChildren();
});

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Goals Overview summary must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createFeature(goalsSummaryEl) {
  return createGoalsOverviewFeature({
    refs: {
      goalsSection: null,
      goalsSummaryEl,
      goalsListEl: null,
      goalsDetailEl: null,
    },
    isConnected: () => true,
    sendReq: vi.fn(),
    makeId: () => "request-1",
    getGoalsState: () => ({ items: [], selectedId: null, includeArchived: false, loadSeq: 0 }),
    getActiveConversationId: () => "",
    isConversationForGoal: () => false,
    escapeHtml: (value) => String(value ?? ""),
    formatGoalStatus: (value) => String(value ?? ""),
    formatDateTime: (value) => String(value ?? ""),
    summarizeSourcePath: (value) => String(value ?? ""),
    formatGoalPathSource: (value) => String(value ?? ""),
    sortGoals: (items) => [...items],
    getGoalById: () => null,
    renderGoalDetail: vi.fn(),
    renderCanvasGoalContext: vi.fn(),
    onResumeGoal: vi.fn(),
    onPauseGoal: vi.fn(),
    onArchiveGoal: vi.fn(),
    t: (key, _params, fallback) => `<b data-key="${key}">${fallback}</b>`,
  });
}

describe("Goals Overview summary DOM owner", () => {
  it("renders fixed summary cards, labels, and counts without an HTML parser", () => {
    const summary = document.createElement("div");
    document.body.append(summary);
    blockNonEmptyInnerHtml(summary);
    const feature = createFeature(summary);

    expect(() => feature.renderGoalsSummary([
      { status: "executing", pathSource: "user-configured" },
      { status: "executing", pathSource: "managed" },
      { status: "paused", pathSource: "user-configured" },
      { status: "archived", pathSource: "managed" },
    ])).not.toThrow();

    const cards = [...summary.children];
    expect(cards).toHaveLength(4);
    expect(cards.every((card) => card.className === "memory-stat-card")).toBe(true);
    expect(cards.map((card) => card.querySelector(".memory-stat-label")?.textContent)).toEqual([
      "<b data-key=\"goals.statGoals\">Long Tasks</b>",
      "<b data-key=\"goals.statExecuting\">Executing</b>",
      "<b data-key=\"goals.statPaused\">Paused</b>",
      "<b data-key=\"goals.statCustomRoot\">Custom Root</b>",
    ]);
    expect(cards.map((card) => card.querySelector(".memory-stat-value")?.textContent)).toEqual(["4", "2", "1", "2"]);
    expect(summary.querySelector("b, img, script, [onerror]")).toBeNull();

    expect(() => feature.renderGoalsSummary(null)).not.toThrow();
    expect([...summary.querySelectorAll(".memory-stat-value")].map((node) => node.textContent)).toEqual(["0", "0", "0", "0"]);
    expect(summary.children).toHaveLength(4);

    feature.dispose();
    expect(() => feature.renderGoalsSummary([{ status: "executing" }])).not.toThrow();
    expect(summary.childElementCount).toBe(0);
  });

  it("treats a missing summary panel as a no-op", () => {
    const feature = createFeature(null);

    expect(() => feature.renderGoalsSummary([{ status: "executing", pathSource: "user-configured" }])).not.toThrow();
    expect(() => feature.renderGoalsSummary("not-an-array")).not.toThrow();
  });
});
