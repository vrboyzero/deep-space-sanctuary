import { describe, expect, it } from "vitest";

import { evaluateGoalCapabilityPlanAcceptanceGate } from "./capability-acceptance-gate.js";

describe("evaluateGoalCapabilityPlanAcceptanceGate", () => {
  it("returns pending when verifier handoff is required but not finished yet", () => {
    const gate = evaluateGoalCapabilityPlanAcceptanceGate({
      status: "planned",
      executionMode: "single_agent",
      subAgents: [],
      orchestration: {
        coordinationPlan: {
          summary: "Need verifier handoff before close.",
          plannedDelegationCount: 0,
          rolePolicy: {
            selectedRoles: ["default"],
            selectionReasons: ["high-risk node"],
            verifierRole: "verifier",
            fanInStrategy: "verifier_handoff",
          },
        },
      },
    });

    expect(gate).toMatchObject({
      status: "pending",
    });
    expect(gate?.summary).toContain("pending");
    expect(gate?.managerActionHint).toContain("verifier");
  });

  it("rejects inconsistent verifier fan-in evidence", () => {
    const gate = evaluateGoalCapabilityPlanAcceptanceGate({
      status: "orchestrated",
      executionMode: "multi_agent",
      subAgents: [
        { agentId: "coder", role: "coder", objective: "Implement patch", handoffToVerifier: true },
      ],
      orchestration: {
        coordinationPlan: {
          summary: "Fan in through verifier.",
          plannedDelegationCount: 1,
          rolePolicy: {
            selectedRoles: ["coder", "verifier"],
            selectionReasons: ["need implementation and verification"],
            verifierRole: "verifier",
            fanInStrategy: "verifier_handoff",
          },
        },
        delegated: true,
        delegationCount: 1,
        delegationResults: [{
          agentId: "coder",
          role: "coder",
          status: "success",
          summary: "Patch delivered",
          taskId: "task_coder",
        }],
        verifierHandoff: {
          status: "completed",
          verifierRole: "verifier",
          verifierAgentId: "verifier",
          verifierTaskId: "task_verifier",
          summary: "Verifier reviewed coder output.",
          sourceAgentIds: ["coder"],
          sourceTaskIds: [],
        },
        verifierResult: {
          status: "completed",
          summary: "Looks good overall.",
          findings: [{
            severity: "high",
            summary: "Critical regression path still fails.",
          }],
          recommendation: "approve",
          evidenceTaskIds: [],
          generatedAt: "2026-04-18T10:00:00.000Z",
        },
      },
    });

    expect(gate).toMatchObject({
      status: "rejected",
      rejectionConfidence: "high",
      missingSourceTaskIds: ["task_coder"],
      missingEvidenceTaskIds: ["task_coder"],
    });
    expect(gate?.summary).toContain("rejected");
    expect(gate?.contractSpecificChecks?.some((item) => item.id === "verifier_approval_severity" && item.status === "failed")).toBe(true);
  });

  it("accepts a completed verifier result when source tasks and evidence are aligned", () => {
    const gate = evaluateGoalCapabilityPlanAcceptanceGate({
      status: "orchestrated",
      executionMode: "multi_agent",
      subAgents: [
        { agentId: "coder", role: "coder", objective: "Implement patch", handoffToVerifier: true },
      ],
      orchestration: {
        coordinationPlan: {
          summary: "Fan in through verifier.",
          plannedDelegationCount: 1,
          rolePolicy: {
            selectedRoles: ["coder", "verifier"],
            selectionReasons: ["need implementation and verification"],
            verifierRole: "verifier",
            fanInStrategy: "verifier_handoff",
          },
        },
        delegated: true,
        delegationCount: 1,
        delegationResults: [{
          agentId: "coder",
          role: "coder",
          status: "success",
          summary: "Patch delivered",
          taskId: "task_coder",
        }],
        verifierHandoff: {
          status: "completed",
          verifierRole: "verifier",
          verifierAgentId: "verifier",
          verifierTaskId: "task_verifier",
          summary: "Verifier reviewed coder output.",
          sourceAgentIds: ["coder"],
          sourceTaskIds: ["task_coder"],
        },
        verifierResult: {
          status: "completed",
          summary: "Verifier checks passed.",
          findings: [],
          recommendation: "approve",
          evidenceTaskIds: ["task_coder"],
          generatedAt: "2026-04-18T10:00:00.000Z",
        },
      },
    });

    expect(gate).toMatchObject({
      status: "accepted",
      requiredSourceTaskIds: ["task_coder"],
      requiredEvidenceTaskIds: ["task_coder"],
    });
    expect(gate?.contractSpecificChecks?.every((item) => item.status === "passed")).toBe(true);
  });

  it("accepts commander review when delegated lanes are complete without failures", () => {
    const gate = evaluateGoalCapabilityPlanAcceptanceGate({
      status: "orchestrated",
      executionMode: "multi_agent_parallel",
      subAgents: [
        { agentId: "coder", role: "coder", objective: "Implement patch" },
        { agentId: "researcher", role: "researcher", objective: "Collect context" },
      ],
      orchestration: {
        coordinationPlan: {
          summary: "Commander fan-in.",
          plannedDelegationCount: 2,
          managerAgentId: "commander",
          rolePolicy: {
            selectedRoles: ["coder", "researcher"],
            selectionReasons: ["need fan-in"],
            fanInStrategy: "commander_review",
          },
        },
        delegated: true,
        delegationCount: 2,
        delegationResults: [
          { agentId: "coder", role: "coder", status: "success", summary: "Patch delivered", taskId: "task_coder" },
          { agentId: "researcher", role: "researcher", status: "success", summary: "Context collected", taskId: "task_research" },
        ],
      },
    });

    expect(gate).toMatchObject({
      status: "accepted",
      requiredSourceAgentIds: ["coder", "researcher"],
    });
    expect(gate?.summary).toContain("Commander review");
  });

  it("rejects commander review when a delegated lane failed", () => {
    const gate = evaluateGoalCapabilityPlanAcceptanceGate({
      status: "orchestrated",
      executionMode: "multi_agent_parallel",
      subAgents: [
        { agentId: "coder", role: "coder", objective: "Implement patch" },
      ],
      orchestration: {
        coordinationPlan: {
          summary: "Commander fan-in.",
          plannedDelegationCount: 1,
          managerAgentId: "commander",
          rolePolicy: {
            selectedRoles: ["coder"],
            selectionReasons: ["need fan-in"],
            fanInStrategy: "commander_review",
          },
        },
        delegated: true,
        delegationCount: 1,
        delegationResults: [
          { agentId: "coder", role: "coder", status: "failed", summary: "Patch failed", taskId: "task_coder" },
        ],
      },
    });

    expect(gate).toMatchObject({
      status: "rejected",
      rejectionConfidence: "high",
    });
    expect(gate?.managerActionHint).toContain("rework");
  });
});
