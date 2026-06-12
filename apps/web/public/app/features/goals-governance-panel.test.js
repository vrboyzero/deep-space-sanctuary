import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGoalsGovernancePanelFeature } from "./goals-governance-panel.js";

describe("goals governance panel", () => {
  let previousWebConfig;

  beforeEach(() => {
    previousWebConfig = globalThis.BELLDANDY_WEB_CONFIG;
    globalThis.BELLDANDY_WEB_CONFIG = {
      ...(previousWebConfig && typeof previousWebConfig === "object" ? previousWebConfig : {}),
      governanceDetailMode: "full",
    };
  });

  afterEach(() => {
    if (previousWebConfig && typeof previousWebConfig === "object") {
      globalThis.BELLDANDY_WEB_CONFIG = previousWebConfig;
      return;
    }
    delete globalThis.BELLDANDY_WEB_CONFIG;
  });

  it("renders bridge governance summary in the governance panel", () => {
    const panel = { innerHTML: "" };
    const feature = createGoalsGovernancePanelFeature({
      refs: {
        goalsDetailEl: {
          querySelector(selector) {
            return selector === "#goalGovernancePanel" ? panel : null;
          },
        },
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    feature.renderGoalReviewGovernancePanel({
      id: "goal_bridge",
    }, {
      workflowPendingCount: 1,
      workflowOverdueCount: 0,
      checkpointWorkflowPendingCount: 0,
      checkpointWorkflowOverdueCount: 0,
      reviewers: [],
      templates: [],
      notifications: [],
      notificationDispatches: [],
      notificationDispatchCounts: { total: 0, byChannel: {}, byStatus: {} },
      actionableReviews: [],
      actionableCheckpoints: [],
      bridgeGovernanceSummary: {
        bridgeNodeCount: 2,
        activeCount: 0,
        runtimeLostCount: 1,
        orphanedCount: 1,
        blockedCount: 2,
        artifactCount: 1,
        transcriptCount: 1,
        items: [
          {
            nodeId: "node_review",
            title: "Review recovery",
            taskId: "run_review",
            runtimeState: "runtime-lost",
            closeReason: "runtime-lost",
            blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
            summaryLines: ["Bridge review via codex_session.interactive: validate the recovery path."],
            artifactPath: "artifacts/review.md",
            transcriptPath: "logs/review.jsonl",
          },
        ],
      },
    });

    expect(panel.innerHTML).toContain("Bridge 治理摘要");
    expect(panel.innerHTML).toContain("运行态丢失");
    expect(panel.innerHTML).toContain("data-open-task-id=\"run_review\"");
    expect(panel.innerHTML).toContain("data-open-source=\"artifacts/review.md\"");
    expect(panel.innerHTML).toContain("data-open-source=\"logs/review.jsonl\"");
  });

  it("renders top-level governance freshness summary without relying on learningReviewInput", () => {
    const panel = { innerHTML: "" };
    const feature = createGoalsGovernancePanelFeature({
      refs: {
        goalsDetailEl: {
          querySelector(selector) {
            return selector === "#goalGovernancePanel" ? panel : null;
          },
        },
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    feature.renderGoalReviewGovernancePanel({
      id: "goal_freshness",
    }, {
      workflowPendingCount: 1,
      workflowOverdueCount: 1,
      checkpointWorkflowPendingCount: 2,
      checkpointWorkflowOverdueCount: 1,
      reviewers: [],
      templates: [],
      notifications: [],
      notificationDispatches: [],
      notificationDispatchCounts: { total: 0, byChannel: {}, byStatus: {} },
      actionableReviews: [],
      actionableCheckpoints: [],
      bridgeGovernanceSummary: null,
      commanderFocus: null,
      memoryFreshness: {
        summary: {
          available: true,
          headline: "Governance memory has 2 review-required queues and 1 stale checkpoint.",
          reviewRequiredCount: 2,
          staleCount: 1,
          supersededCount: 0,
        },
      },
    });

    expect(panel.innerHTML).toContain("治理 freshness：");
    expect(panel.innerHTML).toContain("Governance memory has 2 review-required queues and 1 stale checkpoint.");
    expect(panel.innerHTML).toContain("review_required=2 / stale=1 / superseded=0");
  });

  it("renders experience workbench jump for method and skill suggestion reviews", () => {
    const panel = { innerHTML: "" };
    const feature = createGoalsGovernancePanelFeature({
      refs: {
        goalsDetailEl: {
          querySelector(selector) {
            return selector === "#goalGovernancePanel" ? panel : null;
          },
        },
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
      t: (_key, _params, fallback) => fallback ?? "",
    });

    feature.renderGoalReviewGovernancePanel({
      id: "goal_experience",
    }, {
      workflowPendingCount: 2,
      workflowOverdueCount: 0,
      checkpointWorkflowPendingCount: 0,
      checkpointWorkflowOverdueCount: 0,
      reviewers: [],
      templates: [],
      notifications: [],
      notificationDispatches: [],
      notificationDispatchCounts: { total: 0, byChannel: {}, byStatus: {} },
      actionableCheckpoints: [],
      bridgeGovernanceSummary: null,
      actionableReviews: [
        {
          id: "review-method-1",
          title: "Method candidate from goal",
          suggestionType: "method_candidate",
          suggestionId: "method_candidate_node_root",
          experienceType: "method",
          experienceCandidateId: "goal_exp_method_1",
          status: "pending_review",
        },
        {
          id: "review-skill-1",
          title: "Skill candidate from goal",
          suggestionType: "skill_candidate",
          suggestionId: "skill_candidate_node_root",
          experienceType: "skill",
          experienceCandidateId: "",
          status: "needs_revision",
        },
      ],
    });

    expect(panel.innerHTML).toContain("data-goal-open-experience=\"true\"");
    expect(panel.innerHTML).toContain("data-goal-open-experience-candidate-id=\"goal_exp_method_1\"");
    expect(panel.innerHTML).toContain("data-goal-open-experience-type=\"method\"");
    expect(panel.innerHTML).toContain("data-goal-open-experience-type=\"skill\"");
    expect(panel.innerHTML).toContain("在经验能力中打开");
  });

  it("renders commander review and fan-in focus section", () => {
    const panel = { innerHTML: "" };
    const feature = createGoalsGovernancePanelFeature({
      refs: {
        goalsDetailEl: {
          querySelector(selector) {
            return selector === "#goalGovernancePanel" ? panel : null;
          },
        },
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
    });

    feature.renderGoalReviewGovernancePanel({
      id: "goal_commander",
    }, {
      workflowPendingCount: 0,
      workflowOverdueCount: 0,
      checkpointWorkflowPendingCount: 0,
      checkpointWorkflowOverdueCount: 0,
      reviewers: [],
      templates: [],
      notifications: [],
      notificationDispatches: [],
      notificationDispatchCounts: { total: 0, byChannel: {}, byStatus: {} },
      actionableReviews: [],
      actionableCheckpoints: [],
      bridgeGovernanceSummary: null,
      commanderFocus: {
        goalId: "goal_commander",
        nodeId: "node_govern",
        runId: "run_govern_1",
        planId: "plan_govern_1",
        nodeTitle: "Govern Node",
        governanceMode: "commander",
        executionMode: "multi_agent_parallel",
        commanderAgentId: "commander-main",
        reviewStatus: "accepted",
        finalApprovalMode: "user_required",
        reworkRevisionCount: 1,
        lastReworkReason: "Need final regression confirmation before close",
        lastReworkAt: "2026-03-20T18:05:00.000Z",
        reworkContext: {
          quickSummary: "Need final regression confirmation before close",
          historySummary: "Rework Revision 1 | current=Need final regression confirmation before close",
          persistedReason: "Rework Revision 1 || current=Need final regression confirmation before close",
        },
        reworkTargetAgentIds: ["reviewer", "qa"],
        fanInSummary: "Commander review fan-in is complete and ready for user approval.",
        managerActionHint: "进入 validating，并等待用户最终审批验收后再收口。",
        reasons: ["两路 delegation 已成功返回。", "关键验收证据已汇总。"],
        checkLines: ["1. [passed] Regression passes | runtime/runs/run_govern_1/review-results/review-node-govern.md"],
        nextAction: "应进入 validating，并等待用户最终审批验收后再收口。",
        reviewPath: "runtime/runs/run_govern_1/review-results/review-node-govern.md",
        commanderPlanPath: "runtime/runs/run_govern_1/commander-plan.md",
        workOrderPaths: [
          "runtime/runs/run_govern_1/work-order/coder.md",
          "runtime/runs/run_govern_1/work-order/reviewer.md",
        ],
        delegationResults: [
          {
            agentId: "coder",
            role: "coder",
            status: "success",
            summary: "Patch delivered with runtime artifact.",
            taskId: "run_lane_coder",
            outputPath: "runtime/runs/run_govern_1/work-order/coder.md",
          },
          {
            agentId: "reviewer",
            role: "reviewer",
            status: "success",
            summary: "Regression review completed.",
            taskId: "run_lane_reviewer",
            outputPath: "runtime/runs/run_govern_1/work-order/reviewer.md",
          },
        ],
      },
    });

    expect(panel.innerHTML).toContain("Commander Review / Fan-in");
    expect(panel.innerHTML).toContain("Govern Node");
    expect(panel.innerHTML).toContain("进入 validating，并等待用户最终审批验收后再收口。");
    expect(panel.innerHTML).toContain("Need final regression confirmation before close");
    expect(panel.innerHTML).toContain("Rework Context");
    expect(panel.innerHTML).toContain("Rework Revision 1");
    expect(panel.innerHTML).toContain("Rework Targets");
    expect(panel.innerHTML).toContain("reviewer");
    expect(panel.innerHTML).toContain("打开 review");
    expect(panel.innerHTML).toContain("打开 commander plan");
    expect(panel.innerHTML).toContain("打开 work-order");
    expect(panel.innerHTML).toContain("data-open-task-id=\"run_lane_coder\"");
    expect(panel.innerHTML).toContain("data-open-source=\"runtime/runs/run_govern_1/review-results/review-node-govern.md\"");
    expect(panel.innerHTML).toContain("data-open-source=\"runtime/runs/run_govern_1/work-order/reviewer.md\"");
  });
});
