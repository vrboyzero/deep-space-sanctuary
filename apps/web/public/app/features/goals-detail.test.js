// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createGoalsDetailFeature } from "./goals-detail.js";

describe("goals detail empty state", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the empty message as DOM text without an HTML escaper", () => {
    const maliciousMessage = '<img src=x onerror="alert(1)">Select a long task';
    document.body.innerHTML = '<div id="detail"></div>';
    const detail = createGoalsDetailFeature({
      refs: { goalsDetailEl: document.getElementById("detail") },
      getActiveConversationId: () => "",
      isConversationForGoal: () => false,
      escapeHtml: () => {
        throw new Error("goal detail empty state must not require an HTML escaper");
      },
      formatGoalStatus: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      formatGoalPathSource: (value) => String(value || ""),
      goalDocFilePath: () => "",
      goalRuntimeFilePath: () => "",
      goalBaseConversationId: () => "",
      t: (key, _params, fallback) => key === "goals.detailSelect" ? maliciousMessage : fallback ?? "",
    });

    expect(() => detail.renderGoalDetail(null)).not.toThrow();

    const root = document.getElementById("detail");
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild.className).toBe("memory-viewer-empty");
    expect(root.firstElementChild.textContent).toBe(maliciousMessage);
    expect(root.querySelector("img, [onerror]")).toBeNull();
  });
});
