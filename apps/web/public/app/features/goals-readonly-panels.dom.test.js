// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createGoalsReadonlyPanelsFeature } from "./goals-readonly-panels.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("goals readonly panel placeholders", () => {
  it("renders Goal progress top-level states without using the HTML parser", () => {
    document.body.innerHTML = `
      <section id="goalsDetail">
        <div id="goalProgressPanel"></div>
      </section>
    `;
    const panel = document.getElementById("goalProgressPanel");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(panel, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set() {
        throw new Error("Goal progress placeholders must not use innerHTML");
      },
    });
    const feature = createGoalsReadonlyPanelsFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      normalizeGoalBoardId: (value) => String(value ?? ""),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    expect(() => feature.renderGoalProgressPanelLoading()).not.toThrow();
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.firstElementChild.textContent).toBe("正在读取 progress.md …");

    expect(() => feature.renderGoalProgressPanel([])).not.toThrow();
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.firstElementChild.textContent).toBe("progress.md 中还没有时间线记录。");
  });

  it("renders Goal Handoff loading without using the HTML parser", () => {
    document.body.innerHTML = `
      <section id="goalsDetail">
        <div id="goalHandoffPanel"></div>
      </section>
    `;
    const panel = document.getElementById("goalHandoffPanel");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(panel, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set() {
        throw new Error("Goal Handoff loading must not use innerHTML");
      },
    });
    const feature = createGoalsReadonlyPanelsFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      normalizeGoalBoardId: (value) => String(value ?? ""),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    expect(() => feature.renderGoalHandoffPanelLoading()).not.toThrow();
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.firstElementChild.textContent).toBe("正在读取 goal handoff snapshot …");
  });
});
