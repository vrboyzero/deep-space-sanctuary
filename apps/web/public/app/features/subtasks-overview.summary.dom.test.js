// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSubtasksOverviewFeature } from "./subtasks-overview.js";

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
      if (value) throw new Error("SubTasks summary must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createFeature(subtasksSummaryEl) {
  return createSubtasksOverviewFeature({
    refs: {
      subtasksSection: null,
      subtasksSummaryEl,
      subtasksListEl: null,
      subtasksDetailEl: null,
    },
    isConnected: () => true,
    isViewActive: () => true,
    sendReq: vi.fn(),
    makeId: () => "request-1",
    getSubtasksState: () => ({ items: [], selectedId: null, includeArchived: false }),
    getActiveConversationId: () => "",
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: (value) => String(value ?? ""),
    summarizeSourcePath: (value) => String(value ?? ""),
    onOpenSourcePath: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenGoal: vi.fn(),
    onOpenContinuationAction: vi.fn(),
    getSelectedAgentId: () => "",
    showNotice: vi.fn(),
    t: (key, _params, fallback) => `<img src=x onerror=alert(1)>${fallback || key}`,
  });
}

describe("SubTasks summary DOM owner", () => {
  it("renders fixed summary cards and failed status counts without an HTML parser", () => {
    const summary = document.createElement("div");
    document.body.append(summary);
    blockNonEmptyInnerHtml(summary);
    const feature = createFeature(summary);

    expect(() => feature.renderSubtasksSummary([
      { status: "running" },
      { status: "done" },
      { status: "error" },
      { status: "timeout" },
      { status: "stopped" },
      { status: "pending" },
    ])).not.toThrow();

    const cards = [...summary.children];
    expect(cards).toHaveLength(4);
    expect(cards.every((card) => card.className === "memory-stat-card")).toBe(true);
    expect(cards.map((card) => card.querySelector(".memory-stat-label")?.textContent)).toEqual([
      "<img src=x onerror=alert(1)>Subtasks",
      "<img src=x onerror=alert(1)>Running",
      "<img src=x onerror=alert(1)>Done",
      "<img src=x onerror=alert(1)>Failed",
    ]);
    expect(cards.map((card) => card.querySelector(".memory-stat-value")?.textContent)).toEqual(["6", "1", "1", "3"]);
    expect(summary.querySelector("img, script, [onerror]")).toBeNull();

    expect(() => feature.renderSubtasksSummary(null)).not.toThrow();
    expect([...summary.querySelectorAll(".memory-stat-value")].map((node) => node.textContent)).toEqual(["0", "0", "0", "0"]);
    expect(summary.children).toHaveLength(4);
  });

  it("treats a missing summary panel as a no-op", () => {
    const feature = createFeature(null);

    expect(() => feature.renderSubtasksSummary([{ status: "running" }])).not.toThrow();
    expect(() => feature.renderSubtasksSummary("not-an-array")).not.toThrow();
  });
});
