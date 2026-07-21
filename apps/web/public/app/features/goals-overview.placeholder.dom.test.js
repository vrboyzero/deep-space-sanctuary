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
      if (value) throw new Error("Goals Overview placeholder must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createFeature(refs, goalsState) {
  return createGoalsOverviewFeature({
    refs,
    isConnected: () => true,
    sendReq: vi.fn(),
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
    getGoalById: () => null,
    renderGoalDetail: vi.fn(),
    renderCanvasGoalContext: vi.fn(),
    onResumeGoal: vi.fn(),
    onPauseGoal: vi.fn(),
    onArchiveGoal: vi.fn(),
    t: (key, _params, fallback) => `<b data-key="${key}">${fallback}</b>`,
  });
}

describe("Goals Overview placeholder DOM owner", () => {
  it("renders loading, empty, and filtered-empty branches as text while active", () => {
    document.body.innerHTML = `
      <section id="goals"></section>
      <div id="summary"></div>
      <div id="list"></div>
      <div id="detail"></div>
    `;
    const list = document.getElementById("list");
    const detail = document.getElementById("detail");
    blockNonEmptyInnerHtml(list);
    blockNonEmptyInnerHtml(detail);
    const goalsState = { items: [], selectedId: null, includeArchived: false, loadSeq: 0 };
    const feature = createFeature({
      goalsSection: document.getElementById("goals"),
      goalsSummaryEl: document.getElementById("summary"),
      goalsListEl: list,
      goalsDetailEl: detail,
    }, goalsState);
    const loadingMessage = '<img src=x onerror="alert(1)">loading';
    const emptyMessage = "<script>load failed</script>";

    expect(() => feature.renderGoalsLoading(loadingMessage)).not.toThrow();
    expect(list.firstElementChild.textContent).toBe(loadingMessage);
    expect(detail.firstElementChild.textContent).toContain("Select a long task");

    expect(() => feature.renderGoalsEmpty(emptyMessage)).not.toThrow();
    expect(list.firstElementChild.textContent).toBe(emptyMessage);
    expect(detail.firstElementChild.textContent).toContain("NORTHSTAR.md");

    expect(() => feature.renderGoalList([])).not.toThrow();
    expect(list.firstElementChild.textContent).toContain("Archived tasks are hidden");
    goalsState.includeArchived = true;
    expect(() => feature.renderGoalList([])).not.toThrow();
    expect(list.firstElementChild.textContent).toContain("There are no long tasks yet");
    expect(list.querySelector("img, script, b, [onerror]")).toBeNull();
    expect(detail.querySelector("img, script, b, [onerror]")).toBeNull();

    feature.dispose();
    expect(() => feature.renderGoalsLoading("late")).not.toThrow();
    expect(list.childElementCount).toBe(0);
    expect(detail.childElementCount).toBe(0);
  });

  it("treats missing list and detail panels as no-op", () => {
    const goalsState = { items: [], selectedId: null, includeArchived: false, loadSeq: 0 };
    const feature = createFeature({
      goalsSection: null,
      goalsSummaryEl: null,
      goalsListEl: null,
      goalsDetailEl: null,
    }, goalsState);

    expect(() => feature.renderGoalsLoading("loading")).not.toThrow();
    expect(() => feature.renderGoalsEmpty("empty")).not.toThrow();
    expect(() => feature.renderGoalList([])).not.toThrow();
  });
});
