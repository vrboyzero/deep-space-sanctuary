// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createGoalsCapabilityPanelFeature } from "./goals-capability-panel.js";

describe("goals capability panel", () => {
  it("renders governance controls and routes save / commander actions", async () => {
    document.body.innerHTML = `
      <div id="goalsDetail">
        <div id="goalCapabilityPanel"></div>
      </div>
    `;
    const onSaveGovernanceSettings = vi.fn(async () => {});
    const onCommanderDecision = vi.fn(async () => {});
    const feature = createGoalsCapabilityPanelFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => String(value ?? "-"),
      onOpenSourcePath: vi.fn(async () => {}),
      onOpenSubtask: vi.fn(async () => {}),
      onSaveGovernanceSettings,
      onCommanderDecision,
      t: (_key, _params, fallback) => fallback ?? "",
    });

    feature.renderGoalCapabilityPanel({
      id: "goal_alpha",
      activeNodeId: "node_impl",
    }, {
      nodeMap: {
        node_impl: "实现节点",
      },
      plans: [{
        id: "plan_impl",
        goalId: "goal_alpha",
        nodeId: "node_impl",
        runId: "run_impl",
        status: "orchestrated",
        executionMode: "multi_agent",
        governanceMode: "commander",
        commanderAgentId: "commander-main",
        preferredAgents: ["coder", "reviewer"],
        riskLevel: "medium",
        objective: "Ship implementation",
        summary: "Commander review lane is active.",
        queryHints: [],
        reasoning: [],
        methods: [],
        skills: [],
        mcpServers: [],
        subAgents: [],
        gaps: [],
        checkpoint: {
          required: false,
          reasons: [],
          approvalMode: "none",
          requiredRequestFields: [],
          requiredDecisionFields: [],
          suggestedTitle: "",
          suggestedNote: "",
          suggestedReviewer: "",
          suggestedReviewerRole: "",
          suggestedSlaHours: null,
          escalationMode: "none",
        },
        actualUsage: {
          methods: [],
          skills: [],
          mcpServers: [],
          toolNames: [],
          updatedAt: "",
        },
        analysis: {
          status: "aligned",
          summary: "",
          deviations: [],
          recommendations: [],
          updatedAt: "",
        },
        generatedAt: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:10:00.000Z",
        orchestratedAt: "2026-05-17T10:12:00.000Z",
        orchestration: {
          claimed: true,
          delegated: true,
          delegationCount: 1,
          finalApprovalMode: "user_required",
          reworkRevisionCount: 2,
          lastReworkReason: "Need regression evidence",
          lastReworkAt: "2026-05-17T10:09:00.000Z",
          reworkTargetAgentIds: ["reviewer", "qa"],
          coordinationPlan: {
            summary: "Commander fan-in",
            managerAgentId: "commander-main",
            plannedDelegationCount: 1,
            rolePolicy: {
              selectedRoles: [],
              selectionReasons: [],
              verifierRole: "",
              fanInStrategy: "commander_review",
            },
          },
          delegationResults: [],
          verifierHandoff: null,
          verifierResult: null,
          acceptanceGate: {
            status: "accepted",
            summary: "Fan-in accepted.",
            reasons: ["all lanes done"],
            managerActionHint: "Close after final approval",
            doneDefinitionCheck: "pass",
            rejectionConfidence: "low",
            missingRequiredSections: [],
            requiredSections: ["summary"],
          },
          notes: [],
        },
      }],
    });

    const saveButton = document.querySelector("[data-goal-capability-save]");
    const acceptButton = document.querySelector("[data-goal-commander-decision='accept']");
    const historyPrefillButton = document.querySelector("[data-goal-commander-prefill='history']");
    const gatePrefillButton = document.querySelector("[data-goal-commander-prefill='gate']");
    expect(saveButton).toBeTruthy();
    expect(acceptButton).toBeTruthy();
    expect(historyPrefillButton).toBeTruthy();
    expect(gatePrefillButton).toBeTruthy();
    expect(document.body.innerHTML).toContain("Rework Targets");
    expect(document.body.innerHTML).toContain("reviewer");
    document.querySelector("[data-goal-capability-field='commanderAgentId']").value = "commander-2";
    document.querySelector("[data-goal-capability-field='preferredAgents']").value = "coder, qa";
    document.querySelector("[data-goal-capability-field='decisionSummary']").value = "Temp summary";
    document.querySelector("[data-goal-capability-field='decisionNote']").value = "Temp note";

    historyPrefillButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("[data-goal-capability-field='decisionSummary']").value).toContain("Close after final approval");
    expect(document.querySelector("[data-goal-capability-field='decisionNote']").value).toContain("上一轮返工次数：2");

    gatePrefillButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("[data-goal-capability-field='decisionSummary']").value).toBe("Close after final approval");

    document.querySelector("[data-goal-capability-field='decisionSummary']").value = "Ready to close";
    document.querySelector("[data-goal-capability-field='decisionNote']").value = "Reviewed in WebChat";

    saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    acceptButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(onSaveGovernanceSettings).toHaveBeenCalledWith("goal_alpha", "node_impl", expect.objectContaining({
      commanderAgentId: "commander-2",
      preferredAgents: ["coder", "qa"],
    }));
    expect(onCommanderDecision).toHaveBeenCalledWith("goal_alpha", "node_impl", expect.objectContaining({
      decision: "accept",
      summary: "Ready to close",
      note: "Reviewed in WebChat",
    }));

    document.getElementById("goalCapabilityPanel").remove();
    feature.renderGoalCapabilityPanelLoading();
    saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(onSaveGovernanceSettings).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeGroupCount: 0,
      activeListenerCount: 0,
      disposed: false,
    });

    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toEqual({
      activeGroupCount: 0,
      activeListenerCount: 0,
      disposed: true,
    });
  });

  it("renders governance freshness summary when capability payload includes memory freshness", () => {
    document.body.innerHTML = `
      <div id="goalsDetail">
        <div id="goalCapabilityPanel"></div>
      </div>
    `;
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

    feature.renderGoalCapabilityPanel({
      id: "goal_alpha",
      activeNodeId: "node_impl",
    }, {
      nodeMap: {
        node_impl: "实现节点",
      },
      memoryFreshness: {
        summary: {
          available: true,
          headline: "当前治理队列存在待收口项",
          reviewRequiredCount: 1,
          staleCount: 0,
          supersededCount: 0,
        },
      },
      plans: [{
        id: "plan_impl",
        goalId: "goal_alpha",
        nodeId: "node_impl",
        runId: "run_impl",
        status: "planned",
        executionMode: "single_agent",
        governanceMode: "direct",
        commanderAgentId: "",
        preferredAgents: [],
        riskLevel: "low",
        objective: "Ship implementation",
        summary: "Plan summary",
        queryHints: [],
        reasoning: [],
        methods: [],
        skills: [],
        mcpServers: [],
        subAgents: [],
        gaps: [],
        checkpoint: {
          required: false,
          reasons: [],
          approvalMode: "none",
          requiredRequestFields: [],
          requiredDecisionFields: [],
          suggestedTitle: "",
          suggestedNote: "",
          suggestedReviewer: "",
          suggestedReviewerRole: "",
          suggestedSlaHours: null,
          escalationMode: "none",
        },
        actualUsage: {
          methods: [],
          skills: [],
          mcpServers: [],
          toolNames: [],
          updatedAt: "",
        },
        analysis: {
          status: "aligned",
          summary: "",
          deviations: [],
          recommendations: [],
          updatedAt: "",
        },
        generatedAt: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:10:00.000Z",
        orchestratedAt: "",
        orchestration: {
          finalApprovalMode: "user_required",
          notes: [],
        },
      }],
    });

    expect(document.getElementById("goalCapabilityPanel")?.textContent || "").toContain("治理 freshness：当前治理队列存在待收口项");
  });
});
