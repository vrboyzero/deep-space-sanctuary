// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createGoalsReadonlyPanelsFeature } from "./goals-readonly-panels.js";

afterEach(() => {
  document.body.replaceChildren();
});

function createCanvasFeature() {
  const goalsDetail = document.getElementById("goalsDetail");
  return createGoalsReadonlyPanelsFeature({
    refs: { goalsDetailEl: goalsDetail },
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: (value) => `<time>${value ?? "-"}</time>`,
    normalizeGoalBoardId: (value) => String(value ?? ""),
    goalRuntimeFilePath: (_goal, fileName) => `<path>${fileName}</path>`,
    t: (key, _params, fallback) => key === "goals.canvasPanelTitle"
      ? '<img src=x onerror="alert(1)">Canvas'
      : fallback ?? "",
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
      if (value) throw new Error("Goal Canvas panel must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Goal Canvas full panel DOM rendering", () => {
  it("renders loading and mismatch binding states without using the HTML parser", () => {
    document.body.innerHTML = '<section id="goalsDetail"><div id="goalCanvasPanel"></div></section>';
    const panel = document.getElementById("goalCanvasPanel");
    blockNonEmptyInnerHtml(panel);
    const feature = createCanvasFeature();

    expect(() => feature.renderGoalCanvasPanelLoading()).not.toThrow();
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.textContent).toContain("Loading board-ref.json ...");
    expect(panel.querySelector("img, svg, script, style, iframe, time")).toBeNull();

    expect(() => feature.renderGoalCanvasPanel({
      id: '<goal id="x">',
      boardId: '<registry board="x">',
    }, {
      runtimeBoardId: '<runtime board="x">',
      linkedAt: '<linked at>',
    })).not.toThrow();

    expect(panel.querySelectorAll(":scope > .goal-summary-header, :scope > .goal-summary-grid, :scope > .goal-detail-actions")).toHaveLength(3);
    expect(panel.querySelectorAll(":scope > .goal-summary-grid > .goal-summary-item")).toHaveLength(6);
    expect(panel.querySelector(".goal-summary-title")?.textContent).toBe('<img src=x onerror="alert(1)">Canvas');
    expect(panel.querySelector(".goal-summary-text")?.textContent).toContain("<runtime board=\"x\">");
    expect(panel.querySelector(".goal-summary-text")?.textContent).toContain("<registry board=\"x\">");
    expect(panel.querySelector(".memory-badge")?.textContent).toBe("Binding Mismatch");
    expect(panel.querySelectorAll(".goal-summary-value")[0]?.textContent).toBe('<runtime board="x">');
    expect(panel.querySelectorAll(".goal-summary-value")[4]?.textContent).toBe("<time><linked at></time>");
    expect(panel.querySelectorAll(".goal-summary-value")[5]?.textContent).toBe("<path>board-ref.json</path>");
    expect(panel.querySelector("button[data-open-goal-board]")?.getAttribute("data-open-goal-board")).toBe('<runtime board="x">');
    expect(panel.querySelector("button[data-open-goal-board]")?.hasAttribute("disabled")).toBe(false);
    expect(panel.querySelector("button[data-open-goal-board-list]")?.getAttribute("data-open-goal-board-list")).toBe('<goal id="x">');
    expect(panel.querySelector("button[data-open-source]")?.getAttribute("data-open-source")).toBe("<path>board-ref.json</path>");
    expect(panel.querySelector("img, svg, script, style, iframe, time, [onerror]")).toBeNull();
  });

  it("keeps unbound linked-board action disabled and surfaces read errors as text", () => {
    document.body.innerHTML = '<section id="goalsDetail"><div id="goalCanvasPanel"></div></section>';
    const panel = document.getElementById("goalCanvasPanel");
    blockNonEmptyInnerHtml(panel);
    const feature = createCanvasFeature();

    expect(() => feature.renderGoalCanvasPanel({ id: "goal-unbound" }, { readError: true })).not.toThrow();
    expect(panel.querySelector(".memory-badge")?.textContent).toBe("Unbound");
    expect(panel.textContent).toContain("Unable to read board-ref.json.");
    expect(panel.querySelector("button[data-open-goal-board]")?.disabled).toBe(true);
    expect(panel.querySelector("button[data-open-goal-board]")?.getAttribute("data-open-goal-board")).toBe("");
  });
});
