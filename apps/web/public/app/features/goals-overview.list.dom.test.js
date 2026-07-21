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
      if (value) throw new Error("Goals Overview list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createFeature(goalsListEl, goalsState) {
  const renderGoalDetail = vi.fn();
  const onResumeGoal = vi.fn();
  const onPauseGoal = vi.fn();
  const onArchiveGoal = vi.fn();
  const feature = createGoalsOverviewFeature({
    refs: {
      goalsSection: null,
      goalsSummaryEl: null,
      goalsListEl,
      goalsDetailEl: null,
    },
    isConnected: () => true,
    sendReq: vi.fn(),
    makeId: () => "request-1",
    getGoalsState: () => goalsState,
    getActiveConversationId: () => "conversation-current",
    isConversationForGoal: (conversationId, goalId) => conversationId === "conversation-current" && goalId === goalsState.items[0]?.id,
    escapeHtml: (value) => String(value ?? ""),
    formatGoalStatus: (value) => `<b>${String(value ?? "")}</b>`,
    formatDateTime: (value) => `<time>${String(value ?? "")}</time>`,
    summarizeSourcePath: (value) => `<img src=x onerror=alert(1)>${String(value ?? "")}`,
    formatGoalPathSource: (value) => `<i>${String(value ?? "")}</i>`,
    sortGoals: (items) => [...items],
    getGoalById: (goalId) => goalsState.items.find((goal) => goal.id === goalId) ?? null,
    renderGoalDetail,
    renderCanvasGoalContext: vi.fn(),
    onResumeGoal,
    onPauseGoal,
    onArchiveGoal,
    t: (key, _params, fallback) => `<mark data-key="${key}">${fallback}</mark>`,
  });
  return { feature, onArchiveGoal, onPauseGoal, onResumeGoal, renderGoalDetail };
}

describe("Goals Overview full list DOM owner", () => {
  it("renders goal fields, states, attributes, and actions without an HTML parser", () => {
    const list = document.createElement("div");
    document.body.append(list);
    blockNonEmptyInnerHtml(list);
    const activeGoalId = 'goal"><img src=x onerror=alert(1)>';
    const goalsState = {
      items: [
        {
          id: activeGoalId,
          title: "<script>Active title</script>",
          objective: "<svg onload=alert(1)>Objective</svg>",
          status: "executing",
          currentPhase: "<b>phase</b>",
          updatedAt: "2026-07-20T00:00:00Z",
          goalRoot: 'C:\\goals\"><img>',
          pathSource: "user-configured",
        },
        {
          id: "goal-archived",
          title: "",
          objective: "",
          status: "archived",
          currentPhase: "",
          createdAt: "2026-07-19T00:00:00Z",
          goalRoot: "",
          pathSource: "managed",
        },
      ],
      selectedId: activeGoalId,
      includeArchived: true,
      loadSeq: 0,
    };
    const {
      feature,
      onArchiveGoal,
      onPauseGoal,
      onResumeGoal,
      renderGoalDetail,
    } = createFeature(list, goalsState);

    expect(() => feature.renderGoalList(goalsState.items)).not.toThrow();
    const items = [...list.querySelectorAll(".goal-list-item")];
    expect(items).toHaveLength(2);
    expect(items[0].className).toBe("memory-list-item goal-list-item active");
    expect(items[0].getAttribute("data-goal-id")).toBe(activeGoalId);
    expect(items[0].querySelector(".memory-list-item-title")?.textContent).toBe("<script>Active title</script>");
    expect(items[0].querySelector(".memory-badge-shared")?.textContent).toBe("当前");
    expect([...items[0].querySelectorAll(".memory-list-item-meta, .goal-list-item-meta")]).toHaveLength(2);
    expect(items[0].querySelector(".memory-list-item-snippet")?.textContent).toBe("<svg onload=alert(1)>Objective</svg>");
    expect(items[0].querySelectorAll(".goal-inline-action")).toHaveLength(3);
    expect(items[0].querySelector("[data-goal-resume]")?.getAttribute("data-goal-resume")).toBe(activeGoalId);
    expect(items[0].querySelector("[data-goal-pause]")?.getAttribute("data-goal-pause")).toBe(activeGoalId);
    expect(items[0].querySelector("[data-goal-archive]")?.getAttribute("data-goal-archive")).toBe(activeGoalId);

    expect(items[1].className).toBe("memory-list-item goal-list-item");
    expect(items[1].querySelector(".memory-list-item-title")?.textContent).toBe("goal-archived");
    expect(items[1].querySelector(".memory-list-item-snippet")?.textContent).toContain("No objective yet");
    expect(items[1].querySelector(".memory-badge")?.textContent).toContain("archived");
    expect(items[1].querySelectorAll(".goal-inline-action")).toHaveLength(0);
    expect(list.querySelector("script, svg, img, b, i, mark, time, [onerror], [onload]")).toBeNull();

    items[0].querySelector("[data-goal-resume]").click();
    items[0].querySelector("[data-goal-pause]").click();
    items[0].querySelector("[data-goal-archive]").click();
    expect(onResumeGoal).toHaveBeenCalledWith(activeGoalId);
    expect(onPauseGoal).toHaveBeenCalledWith(activeGoalId);
    expect(onArchiveGoal).toHaveBeenCalledWith(activeGoalId);

    items[1].click();
    expect(goalsState.selectedId).toBe("goal-archived");
    expect(renderGoalDetail).toHaveBeenCalledWith(goalsState.items[1]);

    expect(() => feature.renderGoalList([goalsState.items[1]])).not.toThrow();
    expect(list.querySelectorAll(".goal-list-item")).toHaveLength(1);
    expect(list.querySelector("[data-goal-id]")?.getAttribute("data-goal-id")).toBe("goal-archived");

    feature.dispose();
    expect(() => feature.renderGoalList(goalsState.items)).not.toThrow();
    expect(list.childElementCount).toBe(0);
  });

  it("treats a missing list panel as a no-op", () => {
    const goalsState = { items: [], selectedId: null, includeArchived: false, loadSeq: 0 };
    const { feature } = createFeature(null, goalsState);

    expect(() => feature.renderGoalList([{ id: "goal-1", status: "executing" }])).not.toThrow();
  });
});
