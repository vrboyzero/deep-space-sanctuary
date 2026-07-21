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
    formatDateTime: (value) => `<time>${value ?? "-"}</time>`,
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
      if (value) throw new Error("Full Goal Handoff panel must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Goal Handoff full panel DOM rendering", () => {
  it("renders nested handoff, bridge, continuation, and action state as text and properties", () => {
    document.body.innerHTML = '<section id="goalsDetail"><div id="goalHandoffPanel"></div></section>';
    const panel = document.getElementById("goalHandoffPanel");
    blockNonEmptyInnerHtml(panel);
    const onBind = vi.fn();
    const feature = createHandoffFeature(onBind);
    const goal = {
      id: '<goal id="handoff">',
      activeConversationId: '<conversation>',
      handoffPath: '<handoff path>',
    };
    const handoff = {
      generatedAt: "<generated at>",
      resumeMode: "checkpoint",
      recommendedNodeId: '<recommended node>',
      lastRunId: '<last run>',
      summary: '<img src=x onerror="alert(1)">summary',
      nextAction: "<next action>",
      tracking: {
        totalNodes: 4,
        completedNodes: 1,
        inProgressNodes: 1,
        blockedNodes: 1,
        openCheckpointCount: 2,
      },
      focusCapability: {
        planId: "<focus plan>",
        nodeId: "<focus node>",
        executionMode: "commander",
        riskLevel: "high",
        alignment: "<focus alignment>",
        summary: "<focus summary>",
      },
      blockers: [{ id: "<blocker id>", nodeId: "<blocker node>", title: "<blocker title>", reason: "<blocker reason>" }],
      openCheckpoints: [{ id: "<checkpoint id>", nodeId: "<checkpoint node>", title: "<checkpoint title>", note: "<checkpoint note>" }],
      recentProgress: [{
        at: "<timeline at>",
        event: "node_blocked",
        nodeId: "<timeline node>",
        checkpointId: "<timeline checkpoint>",
        summary: "<timeline summary>",
        note: "<timeline note>",
      }],
      bridgeGovernance: {
        bridgeNodeCount: 1,
        runtimeLostCount: 1,
        orphanedCount: 1,
        blockedCount: 1,
        items: [{
          title: "<bridge title>",
          runtimeState: "runtime-lost",
          nodeId: "<bridge node>",
          summaryLines: ["<bridge summary>"],
          blockReason: "<bridge block reason>",
          artifactPath: "<bridge artifact>",
          transcriptPath: "<bridge transcript>",
        }],
      },
      checkpointReplay: {
        checkpointId: "<replay checkpoint>",
        nodeId: "<replay node>",
        runId: "<replay run>",
        title: "<replay title>",
        summary: "<replay summary>",
      },
    };
    const continuationState = {
      scope: "goal",
      targetId: goal.id,
      recommendedTargetId: "<continuation target>",
      targetType: "node",
      resumeMode: "checkpoint",
      summary: "<continuation summary>",
      nextAction: "<continuation next action>",
      checkpoints: { openCount: 2, blockerCount: 1 },
      replay: {
        kind: "goal_checkpoint",
        checkpointId: "<replay checkpoint>",
        nodeId: "<replay node>",
        summary: "<replay summary>",
      },
      progress: {
        current: "<continuation phase>",
        recent: ["<recent one>", "<recent two>", "<recent three>", "<recent four>"],
      },
    };

    expect(() => feature.renderGoalHandoffPanel(goal, handoff, continuationState)).not.toThrow();
    expect(panel.querySelectorAll(":scope > .goal-summary-header, :scope > .goal-summary-grid, :scope > .goal-tracking-columns, :scope > .goal-detail-actions")).toHaveLength(4);
    expect(panel.querySelectorAll(":scope > .goal-summary-grid > .goal-summary-item")).toHaveLength(6);
    expect(panel.textContent).toContain(handoff.summary);
    expect(panel.textContent).toContain(handoff.nextAction);
    expect(panel.textContent).toContain("<focus plan>");
    expect(panel.textContent).toContain("<blocker reason>");
    expect(panel.textContent).toContain("<checkpoint note>");
    expect(panel.textContent).toContain("<timeline summary>");
    expect(panel.textContent).toContain("<bridge summary>");
    expect(panel.textContent).toContain("<bridge artifact>");
    expect(panel.textContent).toContain("<continuation summary>");
    expect(panel.querySelector("[data-continuation-action]")?.getAttribute("data-continuation-action")).toContain("goalReplay");
    expect(panel.querySelector("button[data-goal-generate-handoff]")?.getAttribute("data-goal-generate-handoff")).toBe(goal.id);
    expect(panel.querySelector("button[data-open-source]")?.getAttribute("data-open-source")).toBe(goal.handoffPath);
    expect(panel.querySelectorAll(".goal-tracking-column")).toHaveLength(2);
    expect(panel.querySelector("img, svg, script, style, iframe, time, [onerror]")).toBeNull();
    expect(onBind).toHaveBeenCalledWith(goal);
  });
});
