// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalsCapabilityPanelFeature } from "./goals-capability-panel.js";

afterEach(() => {
  document.body.replaceChildren();
});

function createCapabilityPlan(overrides = {}) {
  return {
    id: "plan:<&",
    goalId: "goal:<&",
    nodeId: "node:<&",
    runId: "run:<&",
    status: "orchestrated",
    executionMode: "multi_agent_parallel",
    governanceMode: "commander",
    commanderAgentId: "<img src=x>commander",
    preferredAgents: ["<svg>coder</svg>", "reviewer"],
    riskLevel: "high",
    objective: "<script>objective</script>",
    summary: "<style>summary</style>",
    queryHints: ["<iframe>query</iframe>"],
    reasoning: ["<b>reasoning</b>"],
    methods: [{ title: "<img src=x>method", file: "method.md" }],
    skills: [{ name: "<svg>skill</svg>" }],
    mcpServers: [{ serverId: "<script>mcp</script>" }],
    subAgents: [{
      agentId: "<style>sub-agent</style>",
      role: "coder",
      objective: "<iframe>sub objective</iframe>",
      deliverable: "<b>deliverable</b>",
      reason: "<i>sub reason</i>",
      handoffToVerifier: true,
      catalogDefault: {
        permissionMode: "read-only",
        allowedToolFamilies: ["filesystem"],
        maxToolRiskLevel: "medium",
        handoffStyle: "summary",
      },
    }],
    gaps: ["<template>gap</template>"],
    checkpoint: {
      required: true,
      reasons: ["<img src=x>checkpoint reason"],
      approvalMode: "user_required",
      requiredRequestFields: ["<svg>request</svg>"],
      requiredDecisionFields: ["<script>decision</script>"],
      suggestedTitle: "<style>checkpoint title</style>",
      suggestedNote: "<iframe>checkpoint note</iframe>",
      suggestedReviewer: "<b>checkpoint reviewer</b>",
      suggestedReviewerRole: "verifier",
      suggestedSlaHours: 8,
      escalationMode: "commander",
    },
    actualUsage: {
      methods: ["<img src=x>used method"],
      skills: ["<svg>used skill</svg>"],
      mcpServers: ["<script>used mcp</script>"],
      toolNames: ["<style>tool</style>"],
      updatedAt: "actual-time",
    },
    analysis: {
      status: "diverged",
      summary: "<iframe>analysis summary</iframe>",
      deviations: [{ area: "<b>area</b>", summary: "<i>deviation</i>" }],
      recommendations: ["<template>recommendation</template>"],
      updatedAt: "analysis-time",
    },
    generatedAt: "generated-time",
    updatedAt: "updated-time",
    orchestratedAt: "orchestrated-time",
    orchestration: {
      claimed: true,
      delegated: true,
      delegationCount: 1,
      finalApprovalMode: "user_required",
      reworkRevisionCount: 2,
      lastReworkReason: "<img src=x>last rework",
      lastReworkAt: "rework-time",
      reworkTargetAgentIds: ["<svg>rework target</svg>"],
      coordinationPlan: {
        summary: "<script>coordination summary</script>",
        managerAgentId: "manager:<&",
        plannedDelegationCount: 1,
        rolePolicy: {
          selectedRoles: ["coder"],
          selectionReasons: ["<style>selection reason</style>"],
          verifierRole: "verifier",
          fanInStrategy: "commander_review",
        },
      },
      delegationResults: [{
        agentId: "<style>sub-agent</style>",
        role: "coder",
        status: "success",
        summary: "<iframe>delegation summary</iframe>",
        error: "<b>delegation error</b>",
        taskId: "subtask:<&",
        sessionId: "session:<&",
        outputPath: "output:<&",
      }],
      verifierHandoff: {
        status: "completed",
        verifierAgentId: "verifier:<&",
        verifierTaskId: "verifier-task:<&",
        verifierSessionId: "verifier-session:<&",
        sourceAgentIds: ["<style>sub-agent</style>"],
        sourceTaskIds: ["subtask:<&"],
        summary: "<template>handoff summary</template>",
        outputPath: "handoff-output:<&",
      },
      verifierResult: {
        status: "completed",
        recommendation: "revise",
        generatedAt: "verifier-time",
        summary: "<script>verifier summary</script>",
        outputPath: "verifier-output:<&",
        findings: [{ severity: "high", summary: "<img src=x>finding" }],
      },
      acceptanceGate: {
        status: "needs_revision",
        summary: "<svg>gate summary</svg>",
        reasons: ["<script>gate reason</script>"],
        managerActionHint: "<style>gate hint</style>",
      },
      notes: ["<iframe>orchestration note</iframe>"],
    },
    ...overrides,
  };
}

describe("Goal Capability full panel DOM rendering", () => {
  it("renders forms, explainability, actions, focus, and replacement without using the HTML parser", () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalCapabilityPanel"></div></div>';
    const panel = document.getElementById("goalCapabilityPanel");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(panel, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Goal Capability panel must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
    const feature = createGoalsCapabilityPanelFeature({
      refs: { goalsDetailEl: document.getElementById("goalsDetail") },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => `<time>${value ?? "-"}</time>`,
      onOpenSourcePath: vi.fn(async () => {}),
      onOpenSubtask: vi.fn(async () => {}),
      onSaveGovernanceSettings: vi.fn(async () => {}),
      onCommanderDecision: vi.fn(async () => {}),
      t: (_key, _params, fallback) => fallback ?? "",
    });
    const focusPlan = createCapabilityPlan();
    const recentPlans = [focusPlan, ...Array.from({ length: 6 }, (_, index) => createCapabilityPlan({
      id: `plan-${index + 2}`,
      nodeId: `node-${index + 2}`,
      runId: "",
      summary: `recent-${index + 2}`,
      methods: [],
      skills: [],
      mcpServers: [],
      subAgents: [],
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [], updatedAt: "" },
    }))];
    const payload = {
      nodeMap: { [focusPlan.nodeId]: "<img src=x>Focused node" },
      memoryFreshness: {
        summary: {
          available: true,
          headline: "<svg>freshness</svg>",
          reviewRequiredCount: 1,
          staleCount: 2,
          supersededCount: 3,
        },
      },
      plans: recentPlans,
    };
    const goal = { id: 'goal:"<&', activeNodeId: focusPlan.nodeId };

    expect(() => feature.renderGoalCapabilityPanel(goal, payload)).not.toThrow();
    expect(panel.querySelectorAll(":scope > .goal-capability-stats > .goal-summary-item")).toHaveLength(7);
    expect(panel.querySelector(".goal-capability-focus")?.getAttribute("data-goal-node-id")).toBe(focusPlan.nodeId);
    expect(panel.querySelectorAll(":scope > .goal-tracking-column > .goal-tracking-list > .goal-tracking-item")).toHaveLength(6);
    expect(panel.textContent).not.toContain("recent-7");
    expect(panel.textContent).toContain(focusPlan.objective);
    expect(panel.textContent).toContain(focusPlan.analysis.summary);
    expect(panel.textContent).toContain(focusPlan.orchestration.verifierResult.summary);
    expect(panel.textContent).toContain(focusPlan.orchestration.delegationResults[0].summary);
    expect(panel.querySelector('[data-goal-capability-field="executionMode"]')?.value).toBe("multi_agent_parallel");
    expect(panel.querySelector('[data-goal-capability-field="governanceMode"]')?.value).toBe("commander");
    expect(panel.querySelector('[data-goal-capability-field="commanderAgentId"]')?.value).toBe(focusPlan.commanderAgentId);
    expect(panel.querySelector('[data-goal-capability-field="preferredAgents"]')?.value).toBe(focusPlan.preferredAgents.join(", "));
    expect(panel.querySelector('[data-goal-capability-field="decisionNote"]')?.value).toContain("上一轮返工次数：2");
    expect(panel.querySelector('[data-goal-capability-save]')?.getAttribute("data-goal-id")).toBe(goal.id);
    expect(panel.querySelector('[data-goal-commander-prefill="history"]')?.getAttribute("data-prefill-history-note")).toContain("上一轮返工次数：2");
    expect([...panel.querySelectorAll("[data-open-subtask-id]")].some((item) => item.getAttribute("data-open-subtask-id") === "subtask:<&")).toBe(true);
    expect([...panel.querySelectorAll("[data-open-source]")].some((item) => item.getAttribute("data-open-source") === "verifier-output:<&")).toBe(true);
    expect(panel.querySelector("img, svg, script, style, iframe, b, i, template, time, [onerror], [onload]")).toBeNull();

    const directPlan = createCapabilityPlan({
      governanceMode: "direct",
      executionMode: "single_agent",
      commanderAgentId: "",
      preferredAgents: [],
    });
    feature.renderGoalCapabilityPanel(goal, { nodeMap: {}, plans: [directPlan] });
    expect(panel.querySelector('[data-goal-capability-field="executionMode"]')?.value).toBe("single_agent");
    expect([...panel.querySelectorAll("[data-goal-commander-decision]")].every((item) => item.disabled)).toBe(true);
    expect(panel.textContent).toContain("Commander 快捷操作不可用");

    feature.renderGoalCapabilityPanelError('<img src=x>capability error');
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.textContent).toBe('<img src=x>capability error');
    feature.dispose();
  });
});
