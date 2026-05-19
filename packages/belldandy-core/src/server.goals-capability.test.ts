import { expect, test, vi } from "vitest";

import { handleGoalMethod } from "./server-methods/goals.js";

test("goal capability update and commander decide use goal manager governance methods", async () => {
  const existingPlan = {
    id: "plan_1",
    goalId: "goal_1",
    nodeId: "node_1",
    runId: "run_1",
    status: "orchestrated",
    executionMode: "multi_agent",
    governanceMode: "commander",
    commanderAgentId: "commander-main",
    preferredAgents: ["coder"],
    riskLevel: "medium",
    objective: "Ship feature",
    summary: "Commander plan",
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
      escalationMode: "none",
    },
    actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
    analysis: { status: "aligned", summary: "", deviations: [], recommendations: [], updatedAt: "" },
    generatedAt: "2026-05-17T10:00:00.000Z",
    updatedAt: "2026-05-17T10:10:00.000Z",
    orchestratedAt: "2026-05-17T10:12:00.000Z",
    orchestration: {
      finalApprovalMode: "user_required",
      reworkRevisionCount: 1,
      acceptanceGate: {
        status: "accepted",
        summary: "Fan-in accepted",
        reasons: [],
      },
      delegationResults: [
        { agentId: "coder", status: "success", summary: "ok" },
        { agentId: "reviewer", status: "failed", summary: "needs fix" },
      ],
      notes: [],
    },
  };
  const saveCapabilityPlan = vi.fn(async (_goalId, _nodeId, input) => ({
    ...input,
    id: "plan_1",
    goalId: "goal_1",
    nodeId: "node_1",
    updatedAt: "2026-05-17T11:00:00.000Z",
  }));
  const claimTaskNode = vi.fn(async () => ({ node: { id: "node_1", status: "in_progress" } }));
  const markTaskNodeValidating = vi.fn(async () => ({ node: { id: "node_1", status: "validating" } }));
  const completeTaskNode = vi.fn(async () => ({ node: { id: "node_1", status: "done" } }));
  const blockTaskNode = vi.fn(async () => ({ node: { id: "node_1", status: "blocked" } }));
  const ctx = {
    goalManager: {
      getCapabilityPlan: vi.fn(async () => existingPlan),
      saveCapabilityPlan,
      claimTaskNode,
      markTaskNodeValidating,
      completeTaskNode,
      blockTaskNode,
    },
    stateDir: "state",
    residentMemoryManagers: [],
    readEnv: (name: string) => name === "BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED" ? "true" : undefined,
    parseGoalTaskCheckpointStatus: () => undefined,
    parseGoalTaskCreateStatus: () => undefined,
  } as unknown as Parameters<typeof handleGoalMethod>[1];

  const updateRes = await handleGoalMethod({
    type: "req",
    id: "req-update",
    method: "goal.capability.update",
    params: {
      goalId: "goal_1",
      nodeId: "node_1",
      commanderAgentId: "commander-2",
      preferredAgents: ["coder", "qa"],
      finalApprovalMode: "agent_auto_complete",
    },
  }, ctx);

  expect(updateRes?.ok).toBe(true);
  expect(saveCapabilityPlan).toHaveBeenCalledWith("goal_1", "node_1", expect.objectContaining({
    commanderAgentId: "commander-2",
    preferredAgents: ["coder", "qa"],
    orchestration: expect.objectContaining({
      finalApprovalMode: "agent_auto_complete",
    }),
  }));

  const decideRes = await handleGoalMethod({
    type: "req",
    id: "req-decide",
    method: "goal.capability.commander_decide",
    params: {
      goalId: "goal_1",
      nodeId: "node_1",
      decision: "escalate",
      requireUserApproval: false,
      summary: "Auto close",
    },
  }, ctx);

  expect(decideRes?.ok).toBe(true);
  expect(completeTaskNode).toHaveBeenCalledWith("goal_1", "node_1", expect.objectContaining({
    summary: "Auto close",
  }));

  const reworkRes = await handleGoalMethod({
    type: "req",
    id: "req-rework",
    method: "goal.capability.commander_decide",
    params: {
      goalId: "goal_1",
      nodeId: "node_1",
      decision: "rework",
      summary: "Need stronger regression evidence",
    },
  }, ctx);

  expect(reworkRes?.ok).toBe(true);
  const reworkOkRes = reworkRes as Extract<NonNullable<typeof reworkRes>, { ok: true }>;
  expect(reworkOkRes.payload).toBeTruthy();
  const reworkPayload = reworkOkRes.payload as NonNullable<typeof reworkOkRes.payload>;
  expect(reworkPayload.reworkContext).toMatchObject({
    quickSummary: "Need stronger regression evidence",
  });
  expect(reworkPayload.reworkTargetAgentIds).toEqual(["reviewer"]);
  expect(reworkPayload.autoReworkEnabled).toBe(true);
  expect(saveCapabilityPlan).toHaveBeenCalledWith("goal_1", "node_1", expect.objectContaining({
    orchestration: expect.objectContaining({
      reworkRevisionCount: 2,
      lastReworkReason: expect.stringContaining("Rework Revision 2"),
      reworkTargetAgentIds: ["reviewer"],
    }),
  }));
  expect(claimTaskNode).toHaveBeenCalledWith("goal_1", "node_1", expect.objectContaining({
    summary: "Need stronger regression evidence",
  }));
  expect(blockTaskNode).not.toHaveBeenCalled();
});

test("goal capability commander decide falls back to blocked rework when auto rework switch is disabled", async () => {
  const existingPlan = {
    id: "plan_2",
    goalId: "goal_2",
    nodeId: "node_2",
    runId: "run_2",
    status: "orchestrated",
    executionMode: "multi_agent_parallel",
    governanceMode: "commander",
    commanderAgentId: "commander-main",
    preferredAgents: ["coder"],
    riskLevel: "medium",
    objective: "Ship feature",
    summary: "Commander plan",
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
      escalationMode: "none",
    },
    actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
    analysis: { status: "aligned", summary: "", deviations: [], recommendations: [], updatedAt: "" },
    generatedAt: "2026-05-17T10:00:00.000Z",
    updatedAt: "2026-05-17T10:10:00.000Z",
    orchestratedAt: "2026-05-17T10:12:00.000Z",
    orchestration: {
      finalApprovalMode: "user_required",
      reworkRevisionCount: 0,
      acceptanceGate: {
        status: "rejected",
        summary: "Fan-in rejected",
        reasons: ["missing regression coverage"],
        managerActionHint: "Issue a rework order.",
      },
      delegationResults: [
        { agentId: "coder", status: "failed", summary: "needs fix" },
      ],
      notes: [],
    },
  };
  const saveCapabilityPlan = vi.fn(async (_goalId, _nodeId, input) => ({
    ...input,
    id: "plan_2",
    goalId: "goal_2",
    nodeId: "node_2",
    updatedAt: "2026-05-17T11:00:00.000Z",
  }));
  const claimTaskNode = vi.fn(async () => ({ node: { id: "node_2", status: "in_progress" } }));
  const markTaskNodeValidating = vi.fn(async () => ({ node: { id: "node_2", status: "validating" } }));
  const completeTaskNode = vi.fn(async () => ({ node: { id: "node_2", status: "done" } }));
  const blockTaskNode = vi.fn(async () => ({ node: { id: "node_2", status: "blocked" } }));
  const ctx = {
    goalManager: {
      getCapabilityPlan: vi.fn(async () => existingPlan),
      saveCapabilityPlan,
      claimTaskNode,
      markTaskNodeValidating,
      completeTaskNode,
      blockTaskNode,
    },
    stateDir: "state",
    residentMemoryManagers: [],
    readEnv: () => undefined,
    parseGoalTaskCheckpointStatus: () => undefined,
    parseGoalTaskCreateStatus: () => undefined,
  } as unknown as Parameters<typeof handleGoalMethod>[1];

  const reworkRes = await handleGoalMethod({
    type: "req",
    id: "req-rework-blocked",
    method: "goal.capability.commander_decide",
    params: {
      goalId: "goal_2",
      nodeId: "node_2",
      decision: "rework",
      note: "Fix the failed lane before next attempt",
    },
  }, ctx);

  expect(reworkRes?.ok).toBe(true);
  const reworkOkRes = reworkRes as Extract<NonNullable<typeof reworkRes>, { ok: true }>;
  expect(reworkOkRes.payload).toBeTruthy();
  const reworkPayload = reworkOkRes.payload as NonNullable<typeof reworkOkRes.payload>;
  expect(reworkPayload.autoReworkEnabled).toBe(false);
  expect(reworkPayload.reworkTargetAgentIds).toEqual(["coder"]);
  expect(blockTaskNode).toHaveBeenCalledWith("goal_2", "node_2", expect.objectContaining({
    summary: "Fan-in rejected",
    blockReason: expect.stringContaining("Rework Revision 1"),
  }));
  expect(claimTaskNode).not.toHaveBeenCalled();
});
