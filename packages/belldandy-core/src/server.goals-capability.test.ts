import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

test("goal governance surfaces expose top-level memory freshness without drilling into learningReviewInput", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-governance-"));
  await fs.writeFile(path.join(stateDir, "USER.md"), "# User\n偏好简洁短结论。\n", "utf-8");

  const now = "2026-06-12T10:00:00.000Z";
  const reviewItem = {
    id: "review_1",
    goalId: "goal_governance_1",
    suggestionType: "method_candidate",
    suggestionId: "method_1",
    title: "Method Candidate A",
    summary: "Need review",
    sourcePath: "goals/method-a.md",
    status: "pending_review",
    evidenceRefs: [],
    createdAt: now,
    updatedAt: now,
  };
  const reviews = {
    version: 1,
    items: [reviewItem],
    syncedAt: now,
  };
  const governanceSummary = {
    goal: { id: "goal_governance_1", title: "Governance Goal" },
    generatedAt: now,
    reviews,
    reviewStatusCounts: {
      pending_review: 1,
      accepted: 1,
      rejected: 0,
      deferred: 0,
      needs_revision: 1,
    },
    workflowPendingCount: 1,
    workflowOverdueCount: 1,
    actionableReviews: [
      reviewItem,
      {
        ...reviewItem,
        id: "review_accepted_1",
        status: "accepted",
      },
    ],
    recommendations: ["优先处理待审阅 suggestion：Method Candidate A"],
  };
  const reviewMutationResult = {
    goal: { id: "goal_governance_1", title: "Governance Goal" },
    reviews,
    review: reviewItem,
  };
  const publishMutationResult = {
    goal: { id: "goal_governance_1", title: "Governance Goal" },
    review: {
      ...reviewItem,
      status: "accepted",
    },
    record: {
      id: "publish_1",
      goalId: "goal_governance_1",
      reviewId: "review_1",
      suggestionType: "method_candidate",
      suggestionId: "method_1",
      publishedAt: now,
    },
    records: {
      version: 1,
      items: [],
    },
  };
  const scanResult = {
    goal: { id: "goal_governance_1", title: "Governance Goal" },
    reviews,
    scannedAt: now,
    scannedCount: 1,
    overdueCount: 1,
    escalatedCount: 0,
    items: [],
    summary: "scan completed",
    recommendations: ["review scan completed"],
  };
  const getReviewGovernanceSummary = vi.fn(async () => governanceSummary);
  const ctx = {
    goalManager: {
      getReviewGovernanceSummary,
      configureSuggestionReviewWorkflow: vi.fn(async () => reviewMutationResult),
      decideSuggestionReview: vi.fn(async () => reviewMutationResult),
      escalateSuggestionReview: vi.fn(async () => reviewMutationResult),
      scanSuggestionReviewWorkflows: vi.fn(async () => scanResult),
      publishSuggestion: vi.fn(async () => publishMutationResult),
    },
    stateDir,
    residentMemoryManagers: [],
    readEnv: () => undefined,
    parseGoalTaskCheckpointStatus: () => undefined,
    parseGoalTaskCreateStatus: () => undefined,
  } as unknown as Parameters<typeof handleGoalMethod>[1];

  try {
    const cases = [
      {
        id: "goal-review-summary",
        method: "goal.review_governance.summary",
        params: { goalId: "goal_governance_1" },
      },
      {
        id: "goal-review-list",
        method: "goal.suggestion_review.list",
        params: { goalId: "goal_governance_1" },
      },
      {
        id: "goal-review-workflow",
        method: "goal.suggestion_review.workflow.set",
        params: {
          goalId: "goal_governance_1",
          reviewId: "review_1",
          mode: "single",
          reviewers: ["owner"],
        },
      },
      {
        id: "goal-review-decide",
        method: "goal.suggestion_review.decide",
        params: {
          goalId: "goal_governance_1",
          reviewId: "review_1",
          decision: "accepted",
        },
      },
      {
        id: "goal-review-escalate",
        method: "goal.suggestion_review.escalate",
        params: {
          goalId: "goal_governance_1",
          reviewId: "review_1",
        },
      },
      {
        id: "goal-review-scan",
        method: "goal.suggestion_review.scan",
        params: {
          goalId: "goal_governance_1",
        },
      },
      {
        id: "goal-review-publish",
        method: "goal.suggestion.publish",
        params: {
          goalId: "goal_governance_1",
          reviewId: "review_1",
        },
      },
    ] as const;

    for (const item of cases) {
      const response = await handleGoalMethod({
        type: "req",
        id: item.id,
        method: item.method,
        params: item.params,
      }, ctx);

      expect(response?.ok).toBe(true);
      const okResponse = response as Extract<NonNullable<typeof response>, { ok: true }>;
      expect(okResponse.payload?.memoryFreshness).toMatchObject({
        summary: {
          available: true,
          reviewRequiredCount: 1,
          headline: expect.stringContaining("review_required"),
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            memoryClass: "profile_semantic",
            status: "active",
          }),
          expect.objectContaining({
            memoryClass: "governance",
            status: "review_required",
          }),
        ]),
      });
    }

    const summaryResponse = await handleGoalMethod({
      type: "req",
      id: "goal-review-summary-repeat",
      method: "goal.review_governance.summary",
      params: { goalId: "goal_governance_1" },
    }, ctx);
    const summaryOkResponse = summaryResponse as Extract<NonNullable<typeof summaryResponse>, { ok: true }>;
    const summaryPayload = summaryOkResponse.payload as {
      summary?: {
        learningReviewInput?: {
          memoryFreshness?: unknown;
        };
      };
    } | undefined;
    expect(summaryPayload?.summary?.learningReviewInput?.memoryFreshness).toMatchObject({
      summary: {
        available: true,
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          memoryClass: "governance",
          status: "review_required",
        }),
      ]),
    });
    expect(getReviewGovernanceSummary).toHaveBeenCalled();
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("goal approval and checkpoint surfaces expose governance freshness without refetching full governance summary", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-checkpoint-governance-"));
  await fs.writeFile(path.join(stateDir, "USER.md"), "# User\n偏好短结论。\n", "utf-8");

  const now = "2026-06-12T11:00:00.000Z";
  const checkpointState = {
    version: 2,
    items: [{
      id: "checkpoint_1",
      goalId: "goal_checkpoint_1",
      nodeId: "node_1",
      status: "waiting_user",
      title: "Checkpoint A",
      summary: "Need approval",
      reviewer: "owner",
      slaAt: "2026-06-12T10:00:00.000Z",
      createdAt: "2026-06-12T09:00:00.000Z",
      updatedAt: now,
      history: [],
      workflow: {
        mode: "single",
        status: "pending_review",
        currentStageIndex: 0,
        configuredAt: "2026-06-12T09:00:00.000Z",
        updatedAt: now,
        stages: [{
          id: "stage_1",
          title: "Checkpoint Approval",
          mode: "single",
          reviewers: [{ reviewer: "owner" }],
          minApprovals: 1,
          status: "pending_review",
          votes: [],
          startedAt: "2026-06-12T09:00:00.000Z",
          slaAt: "2026-06-12T10:00:00.000Z",
          escalation: {
            mode: "manual",
            count: 0,
            history: [],
          },
        }],
      },
    }],
  };
  const approvalScanResult = {
    goal: { id: "goal_checkpoint_1", title: "Checkpoint Goal" },
    scannedAt: now,
    reviewResult: {
      goal: { id: "goal_checkpoint_1", title: "Checkpoint Goal" },
      reviews: { version: 1, items: [], syncedAt: now },
      scannedAt: now,
      scannedCount: 0,
      overdueCount: 0,
      escalatedCount: 0,
      items: [],
      summary: "reviews clean",
      recommendations: [],
    },
    checkpointItems: [{
      targetType: "checkpoint",
      targetId: "checkpoint_1",
      title: "Checkpoint A",
      nodeId: "node_1",
      stageId: "stage_1",
      stageTitle: "Checkpoint Approval",
      stageIndex: 0,
      reviewer: "owner",
      slaAt: "2026-06-12T10:00:00.000Z",
      overdue: true,
      overdueMinutes: 60,
      escalated: false,
      action: "overdue",
    }],
    notifications: [],
    dispatches: [],
    summary: "checkpoint_overdue=1",
    recommendations: ["存在超时审批项，建议优先处理 overdue stage。"],
  };
  const checkpointMutationResult = {
    goal: { id: "goal_checkpoint_1", title: "Checkpoint Goal" },
    graph: { nodes: [] },
    node: { id: "node_1", checkpointStatus: "waiting_user" },
    checkpoints: checkpointState,
    checkpoint: checkpointState.items[0],
  };
  const getReviewGovernanceSummary = vi.fn(async () => {
    throw new Error("checkpoint surfaces should not refetch governance summary");
  });
  const ctx = {
    goalManager: {
      getReviewGovernanceSummary,
      scanApprovalWorkflows: vi.fn(async () => approvalScanResult),
      listCheckpoints: vi.fn(async () => checkpointState),
      requestCheckpoint: vi.fn(async () => checkpointMutationResult),
      approveCheckpoint: vi.fn(async () => checkpointMutationResult),
      rejectCheckpoint: vi.fn(async () => checkpointMutationResult),
      expireCheckpoint: vi.fn(async () => checkpointMutationResult),
      reopenCheckpoint: vi.fn(async () => checkpointMutationResult),
      escalateCheckpoint: vi.fn(async () => checkpointMutationResult),
    },
    stateDir,
    residentMemoryManagers: [],
    readEnv: () => undefined,
    parseGoalTaskCheckpointStatus: () => undefined,
    parseGoalTaskCreateStatus: () => undefined,
  } as unknown as Parameters<typeof handleGoalMethod>[1];

  try {
    const cases = [
      {
        id: "goal-approval-scan",
        method: "goal.approval.scan",
        params: { goalId: "goal_checkpoint_1", now },
      },
      {
        id: "goal-checkpoint-list",
        method: "goal.checkpoint.list",
        params: { goalId: "goal_checkpoint_1", now },
      },
      {
        id: "goal-checkpoint-request",
        method: "goal.checkpoint.request",
        params: { goalId: "goal_checkpoint_1", nodeId: "node_1", now },
      },
      {
        id: "goal-checkpoint-approve",
        method: "goal.checkpoint.approve",
        params: { goalId: "goal_checkpoint_1", nodeId: "node_1", checkpointId: "checkpoint_1", now },
      },
      {
        id: "goal-checkpoint-reject",
        method: "goal.checkpoint.reject",
        params: { goalId: "goal_checkpoint_1", nodeId: "node_1", checkpointId: "checkpoint_1", now },
      },
      {
        id: "goal-checkpoint-expire",
        method: "goal.checkpoint.expire",
        params: { goalId: "goal_checkpoint_1", nodeId: "node_1", checkpointId: "checkpoint_1", now },
      },
      {
        id: "goal-checkpoint-reopen",
        method: "goal.checkpoint.reopen",
        params: { goalId: "goal_checkpoint_1", nodeId: "node_1", checkpointId: "checkpoint_1", now },
      },
      {
        id: "goal-checkpoint-escalate",
        method: "goal.checkpoint.escalate",
        params: { goalId: "goal_checkpoint_1", nodeId: "node_1", checkpointId: "checkpoint_1", now },
      },
    ] as const;

    for (const item of cases) {
      const response = await handleGoalMethod({
        type: "req",
        id: item.id,
        method: item.method,
        params: item.params,
      }, ctx);

      expect(response?.ok).toBe(true);
      const okResponse = response as Extract<NonNullable<typeof response>, { ok: true }>;
      expect(okResponse.payload?.memoryFreshness).toMatchObject({
        summary: {
          available: true,
          reviewRequiredCount: 1,
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            memoryClass: "profile_semantic",
            status: "active",
          }),
          expect.objectContaining({
            memoryClass: "governance",
            status: "review_required",
            freshnessSignals: expect.arrayContaining([
              expect.objectContaining({
                code: "governance_pending_checkpoint",
              }),
              expect.objectContaining({
                code: "governance_overdue_checkpoint",
              }),
            ]),
          }),
        ]),
      });
    }

    expect(getReviewGovernanceSummary).not.toHaveBeenCalled();
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("goal task graph read exposes checkpoint-backed governance freshness without refetching full governance summary", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-task-graph-governance-"));
  await fs.writeFile(path.join(stateDir, "USER.md"), "# User\n偏好短结论。\n", "utf-8");

  const now = "2026-06-12T12:00:00.000Z";
  const graph = {
    version: 1,
    nodes: [{
      id: "node_1",
      title: "Implement tracking consumer",
      status: "running",
      checkpointStatus: "waiting_user",
    }],
    edges: [],
  };
  const checkpoints = {
    version: 1,
    items: [{
      id: "checkpoint_task_graph_1",
      goalId: "goal_task_graph_1",
      nodeId: "node_1",
      status: "waiting_user",
      title: "Tracking approval",
      summary: "Need user approval",
      reviewer: "owner",
      slaAt: "2026-06-12T11:00:00.000Z",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: now,
      history: [],
      workflow: {
        mode: "single",
        status: "pending_review",
        currentStageIndex: 0,
        configuredAt: "2026-06-12T10:00:00.000Z",
        updatedAt: now,
        stages: [{
          id: "stage_1",
          title: "Approval",
          mode: "single",
          reviewers: [{ reviewer: "owner" }],
          minApprovals: 1,
          status: "pending_review",
          votes: [],
          startedAt: "2026-06-12T10:00:00.000Z",
          slaAt: "2026-06-12T11:00:00.000Z",
          escalation: {
            mode: "manual",
            count: 0,
            history: [],
          },
        }],
      },
    }],
  };
  const getReviewGovernanceSummary = vi.fn(async () => {
    throw new Error("goal.task_graph.read should not refetch governance summary");
  });
  const ctx = {
    goalManager: {
      getReviewGovernanceSummary,
      readTaskGraph: vi.fn(async () => graph),
      listCheckpoints: vi.fn(async () => checkpoints),
    },
    stateDir,
    residentMemoryManagers: [],
    readEnv: () => undefined,
    parseGoalTaskCheckpointStatus: () => undefined,
    parseGoalTaskCreateStatus: () => undefined,
  } as unknown as Parameters<typeof handleGoalMethod>[1];

  try {
    const response = await handleGoalMethod({
      type: "req",
      id: "goal-task-graph-read",
      method: "goal.task_graph.read",
      params: {
        goalId: "goal_task_graph_1",
        now,
      },
    }, ctx);

    expect(response?.ok).toBe(true);
    const okResponse = response as Extract<NonNullable<typeof response>, { ok: true }>;
    expect(okResponse.payload).toMatchObject({
      graph,
      checkpoints,
      memoryFreshness: {
        summary: {
          available: true,
          reviewRequiredCount: 1,
          headline: expect.stringContaining("review_required"),
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            memoryClass: "governance",
            status: "review_required",
            freshnessSignals: expect.arrayContaining([
              expect.objectContaining({
                code: "governance_pending_checkpoint",
              }),
              expect.objectContaining({
                code: "governance_overdue_checkpoint",
              }),
            ]),
          }),
        ]),
      },
    });
    expect(getReviewGovernanceSummary).not.toHaveBeenCalled();
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
