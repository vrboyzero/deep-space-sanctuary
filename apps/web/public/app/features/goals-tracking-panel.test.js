// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  buildGoalTrackingCapabilityPlanIndex,
  createGoalsTrackingPanelFeature,
  filterGoalTrackingCheckpointsByNode,
  getGoalTrackingCheckpointExplainabilityLines,
  getGoalTrackingNodeActionTargets,
} from "./goals-tracking-panel.js";

describe("goal tracking linkage helpers", () => {
  it("extracts task id and artifact paths for node jump actions", () => {
    expect(getGoalTrackingNodeActionTargets({
      lastRunId: "run_goal_1",
      artifacts: [" docs/goal.md ", "", "artifacts/out.md"],
      bridgeSessionView: {
        artifactPath: "artifacts/out.md",
        transcriptPath: "logs/bridge.jsonl",
      },
    })).toEqual({
      taskId: "run_goal_1",
      artifactPaths: ["docs/goal.md", "artifacts/out.md"],
      bridgeArtifactPath: "",
      bridgeTranscriptPath: "logs/bridge.jsonl",
    });
  });

  it("returns empty targets when node has no linkage metadata", () => {
    expect(getGoalTrackingNodeActionTargets({})).toEqual({
      taskId: "",
      artifactPaths: [],
      bridgeArtifactPath: "",
      bridgeTranscriptPath: "",
    });
  });

  it("builds checkpoint explainability lines from the latest capability plan for the node", () => {
    const capabilityPlansByNodeId = buildGoalTrackingCapabilityPlanIndex([
      {
        nodeId: "node_impl",
        updatedAt: "2026-04-01T08:00:00.000Z",
        checkpoint: {
          required: true,
          approvalMode: "strict",
          suggestedReviewer: "legacy-reviewer",
          suggestedTitle: "Legacy checkpoint",
          suggestedNote: "Legacy approval note",
        },
      },
      {
        nodeId: "node_impl",
        updatedAt: "2026-04-02T08:00:00.000Z",
        riskLevel: "high",
        checkpoint: {
          required: true,
          approvalMode: "strict",
          suggestedReviewer: "reviewer",
          suggestedReviewerRole: "verifier",
          suggestedTitle: "High-risk checkpoint",
          suggestedNote: "Need approval before execution",
          requiredRequestFields: ["impact"],
          requiredDecisionFields: ["decision"],
        },
      },
    ]);

    const lines = getGoalTrackingCheckpointExplainabilityLines({
      id: "cp_1",
      nodeId: "node_impl",
    }, capabilityPlansByNodeId);

    expect(lines.join("\n")).toContain("suggested launch: source=goal_checkpoint, agent=reviewer");
    expect(lines.join("\n")).toContain("delegation reason: source=goal_checkpoint");
    expect(lines.join("\n")).not.toContain("legacy-reviewer");
  });

  it("filters checkpoints down to the focused node", () => {
    expect(filterGoalTrackingCheckpointsByNode([
      { id: "cp_1", nodeId: "node_impl" },
      { id: "cp_2", nodeId: "node_review" },
      { id: "cp_3", nodeId: "node_impl" },
    ], " node_impl ")).toEqual([
      { id: "cp_1", nodeId: "node_impl" },
      { id: "cp_3", nodeId: "node_impl" },
    ]);
  });

  it("renders governance freshness headline when tracking payload includes memory freshness", () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalTrackingPanel"></div></div>';
    const feature = createGoalsTrackingPanelFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      escapeHtml: (value) => String(value),
      formatDateTime: (value) => value || "",
      getGoalCheckpointSlaBadge: () => "",
    });

    feature.renderGoalTrackingPanel({ id: "goal_1" }, {
      nodes: [],
      checkpoints: [],
      memoryFreshness: {
        summary: {
          available: true,
          headline: "当前治理队列存在待收口项",
        },
      },
    });

    expect(document.getElementById("goalTrackingPanel")?.textContent || "").toContain("治理 freshness：当前治理队列存在待收口项");
  });
});
