// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsReadonlyPanelsFeature } from "./goals-readonly-panels.js";

afterEach(() => {
  document.body.replaceChildren();
});

function createHandoffFeature(onBindHandoffPanelActions) {
  return createGoalsReadonlyPanelsFeature({
    refs: { goalsDetailEl: document.getElementById("goalsDetail") },
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: (value) => String(value ?? "-"),
    normalizeGoalBoardId: (value) => String(value ?? ""),
    goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    onBindHandoffPanelActions,
  });
}

function blockNonEmptyInnerHtml(panel) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(panel, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Goal Handoff placeholders must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Goal Handoff error and no-data DOM rendering", () => {
  it("renders read errors and action attributes without using the HTML parser", () => {
    document.body.innerHTML = '<section id="goalsDetail"><div id="goalHandoffPanel"></div></section>';
    const panel = document.getElementById("goalHandoffPanel");
    blockNonEmptyInnerHtml(panel);
    const onBind = vi.fn();
    const feature = createHandoffFeature(onBind);
    const goal = {
      id: '<goal id="error">',
      handoffPath: '<handoff path="error">',
    };
    const message = '<img src=x onerror="alert(1)">read failed';

    expect(() => feature.renderGoalHandoffPanelError(goal, message)).not.toThrow();
    expect(panel.querySelector(".memory-viewer-empty")?.textContent).toBe(message);
    expect(panel.querySelector("button[data-goal-generate-handoff]")?.getAttribute("data-goal-generate-handoff")).toBe(goal.id);
    expect(panel.querySelector("button[data-open-source]")?.getAttribute("data-open-source")).toBe(goal.handoffPath);
    expect(panel.querySelectorAll("button")).toHaveLength(2);
    expect(panel.querySelector("img, svg, script, style, iframe, [onerror]")).toBeNull();
    expect(onBind).toHaveBeenCalledWith(goal);
  });

  it("renders missing handoff state and rebinds actions without using the HTML parser", () => {
    document.body.innerHTML = '<section id="goalsDetail"><div id="goalHandoffPanel"></div></section>';
    const panel = document.getElementById("goalHandoffPanel");
    blockNonEmptyInnerHtml(panel);
    const onBind = vi.fn();
    const feature = createHandoffFeature(onBind);
    const goal = {
      id: '<goal id="missing">',
      handoffPath: '<handoff path="missing">',
    };

    expect(() => feature.renderGoalHandoffPanel(goal, null)).not.toThrow();
    expect(panel.querySelector(".memory-viewer-empty")?.textContent).toBe("当前还没有正式 handoff。可在节点切换、暂停前或需要交接时手动生成。");
    expect(panel.querySelector("button[data-goal-generate-handoff]")?.getAttribute("data-goal-generate-handoff")).toBe(goal.id);
    expect(panel.querySelector("button[data-open-source]")?.getAttribute("data-open-source")).toBe(goal.handoffPath);
    expect(panel.querySelectorAll("button")).toHaveLength(2);
    expect(onBind).toHaveBeenCalledWith(goal);
  });
});
