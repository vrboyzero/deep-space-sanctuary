// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createGoalsReadonlyPanelsFeature } from "./goals-readonly-panels.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("goals readonly panels", () => {
  it("renders long continuation targets with an in-card wrapping button class", () => {
    document.body.innerHTML = '<section id="goalsDetail"><div id="goalHandoffPanel"></div></section>';
    const panel = document.getElementById("goalHandoffPanel");
    const feature = createGoalsReadonlyPanelsFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      normalizeGoalBoardId: (value) => String(value ?? ""),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    feature.renderGoalHandoffPanel({
      id: "goal_resume",
      handoffPath: "runtime/handoff.md",
    }, {
      generatedAt: "2026-04-21T09:00:00.000Z",
      summary: "继续当前长期任务。",
      nextAction: "从建议节点继续。",
      tracking: {
        totalNodes: 4,
        completedNodes: 1,
        inProgressNodes: 1,
        blockedNodes: 0,
      },
      recentProgress: [],
    }, {
      version: 1,
      scope: "goal",
      targetId: "goal_resume",
      recommendedTargetId: "node_d1c48b7e_with_a_very_long_suffix_to_stress_the_layout",
      targetType: "node",
      resumeMode: "current_node",
      summary: "继续当前长期任务。",
      nextAction: "从建议节点继续。",
      checkpoints: {
        openCount: 0,
        blockerCount: 0,
      },
      progress: {
        current: "aligning",
        recent: [],
      },
    });

    expect(panel.querySelector(".goal-continuation-target-btn")).not.toBeNull();
    expect(panel.querySelector(".goal-continuation-target-btn")?.getAttribute("title")).toBe("node:node_d1c48b7e_with_a_very_long_suffix_to_stress_the_layout");
  });

  it("renders bridge governance reference summary inside the handoff panel", () => {
    document.body.innerHTML = '<section id="goalsDetail"><div id="goalHandoffPanel"></div></section>';
    const panel = document.getElementById("goalHandoffPanel");
    const feature = createGoalsReadonlyPanelsFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      normalizeGoalBoardId: (value) => String(value ?? ""),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    feature.renderGoalHandoffPanel({
      id: "goal_bridge",
      handoffPath: "runtime/handoff.md",
    }, {
      generatedAt: "2026-04-16T12:00:00.000Z",
      resumeMode: "checkpoint",
      recommendedNodeId: "node_bridge_review",
      lastRunId: "task_bridge",
      summary: "Checkpoint is waiting and the linked bridge runtime must be recovered first.",
      nextAction: "Inspect the bridge artifact / transcript, recover the bridge runtime, then continue the checkpoint flow.",
      tracking: {
        totalNodes: 3,
        completedNodes: 1,
        inProgressNodes: 1,
        blockedNodes: 1,
        openCheckpointCount: 1,
      },
      openCheckpoints: [],
      blockers: [],
      bridgeGovernance: {
        bridgeNodeCount: 1,
        activeCount: 0,
        runtimeLostCount: 1,
        orphanedCount: 0,
        blockedCount: 1,
        artifactCount: 1,
        transcriptCount: 1,
        items: [
          {
            nodeId: "node_bridge_review",
            title: "Review bridge recovery",
            taskId: "task_bridge",
            runtimeState: "runtime-lost",
            closeReason: "runtime-lost",
            blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
            summaryLines: ["Bridge session runtime-lost via codex_session.interactive: recover the review runtime."],
            artifactPath: "artifacts/bridge.md",
            transcriptPath: "logs/bridge.jsonl",
          },
        ],
      },
      recentProgress: [],
    }, {
      version: 1,
      scope: "goal",
      targetId: "goal_bridge",
      recommendedTargetId: "node_bridge_review",
      targetType: "node",
      resumeMode: "checkpoint",
      summary: "Checkpoint is waiting and the linked bridge runtime must be recovered first.",
      nextAction: "Inspect the bridge artifact / transcript, recover the bridge runtime, then continue the checkpoint flow.",
      checkpoints: {
        openCount: 1,
        blockerCount: 1,
        labels: ["Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue."],
      },
      progress: {
        current: "implementation",
        recent: [],
      },
    });

    expect(panel.textContent).toContain("Bridge 引用摘要");
    expect(panel.textContent).toContain("运行态丢失 1");
    expect(panel.textContent).toContain("Bridge session runtime-lost via codex_session.interactive");
    expect(panel.textContent).toContain("artifacts/bridge.md");
    expect(panel.textContent).toContain("logs/bridge.jsonl");
  });
});
