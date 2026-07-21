// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createGoalsGovernancePanelFeature } from "./goals-governance-panel.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("goals governance panel placeholders", () => {
  it("renders top-level states as text without parsing HTML", () => {
    const maliciousError = '<img src=x onerror="alert(1)">governance failed';
    document.body.innerHTML = `
      <section id="goalsDetail">
        <div id="goalGovernancePanel"></div>
      </section>
    `;
    const panel = document.querySelector("#goalGovernancePanel");
    const feature = createGoalsGovernancePanelFeature({
      refs: {
        goalsDetailEl: document.querySelector("#goalsDetail"),
      },
      escapeHtml(value) {
        if (value === maliciousError) {
          throw new Error("Governance error placeholders must not require an HTML escaper");
        }
        return String(value ?? "");
      },
      formatDateTime: (value) => String(value ?? "-"),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    feature.renderGoalReviewGovernancePanelLoading();
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.firstElementChild.textContent).toBe("正在汇总 review governance / approval workflow …");

    expect(() => feature.renderGoalReviewGovernancePanelError(maliciousError)).not.toThrow();
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.firstElementChild.textContent).toBe(maliciousError);
    expect(panel.querySelector("img, [onerror]")).toBeNull();

    feature.renderGoalReviewGovernancePanel({ id: "goal-empty" }, null);
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
    expect(panel.firstElementChild.textContent).toBe("当前还没有评审治理汇总。");
  });
});
