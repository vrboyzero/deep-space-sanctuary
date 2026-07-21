// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsCapabilityPanelFeature } from "./goals-capability-panel.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Goal capability no-plan instruction DOM rendering", () => {
  it("renders the instruction and code tokens without using the HTML parser", () => {
    document.body.innerHTML = `
      <section id="goalsDetail">
        <div id="goalCapabilityPanel"></div>
      </section>
    `;
    const panel = document.getElementById("goalCapabilityPanel");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(panel, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Goal capability no-plan instruction must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const feature = createGoalsCapabilityPanelFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      onOpenSourcePath: vi.fn(async () => {}),
      onOpenSubtask: vi.fn(async () => {}),
      onSaveGovernanceSettings: vi.fn(async () => {}),
      onCommanderDecision: vi.fn(async () => {}),
      t: (_key, _params, fallback) => fallback ?? "",
    });

    feature.renderGoalCapabilityPanelLoading();
    expect(panel.firstElementChild.textContent).toBe("正在读取 capability-plans.json …");

    expect(() => feature.renderGoalCapabilityPanel({ id: "goal-empty" }, {
      nodeMap: {},
      plans: [],
    })).not.toThrow();

    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(Array.from(panel.querySelectorAll("code"), (node) => node.textContent)).toEqual([
      "goal_capability_plan",
      "goal_orchestrate",
    ]);
    expect(panel.textContent.replace(/\s+/g, " ").trim()).toBe(
      "capability-plans.json 中还没有计划记录。可先在长期任务通道中执行 goal_capability_plan / goal_orchestrate。",
    );
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeGroupCount: 0,
      activeListenerCount: 0,
      disposed: false,
    });
    feature.dispose();
  });
});
