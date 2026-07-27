import { describe, expect, it } from "vitest";

import {
  createConversationCodingRunView,
  createGoalCodingRunView,
  createRuntimeLostCodingRunView,
  createSubtaskCodingRunView,
  createWorkflowJournalCodingRunView,
  createWorkflowRuntimeCodingRunView,
} from "./source-adapters.js";

describe("coding-run source adapters", () => {
  it("projects an active Conversation handle without exposing its stop callback", () => {
    const view = createConversationCodingRunView({
      handle: {
        conversationId: "conversation-1",
        runId: "run-1",
        agentId: "default",
        startedAt: 1_700_000_000_000,
        state: "stop_requested",
        stopRequestedAt: 1_700_000_000_100,
        stopReason: "user requested",
        stop: () => true,
      },
    });

    expect(view).toEqual({
      source: "conversation",
      status: "running",
      recovery: { operation: "conversation.continue" },
      binding: { agentRunId: "run-1", conversationId: "conversation-1" },
      evidence: {
        registryState: "stop_requested",
        agentId: "default",
        startedAtMs: 1_700_000_000_000,
        stopRequestedAtMs: 1_700_000_000_100,
        hasStopReason: true,
      },
    });
    expect(JSON.stringify(view)).not.toContain("user requested");
    expect(JSON.stringify(view)).not.toContain("stop\"");
  });

  it("projects Goal evidence without advancing Goal or node state", () => {
    const goal = {
      id: "goal-release",
      status: "reviewing" as const,
      activeConversationId: "goal-conversation",
      lastRunId: "goal-run-1",
    };
    const node = {
      id: "node-implementation",
      status: "pending_review" as const,
      artifacts: ["artifact-a", "artifact-b"],
      checkpointRequired: true,
      checkpointStatus: "waiting_user" as const,
      lastRunId: "goal-run-1",
    };

    const view = createGoalCodingRunView({ goal, node });

    expect(view).toEqual({
      source: "goal",
      status: "awaiting_review",
      recovery: { operation: "goal.resume" },
      binding: {
        agentRunId: "goal-run-1",
        conversationId: "goal-conversation",
        goal: { goalId: "goal-release", nodeId: "node-implementation" },
      },
      evidence: {
        goalStatus: "reviewing",
        nodeStatus: "pending_review",
        artifactCount: 2,
        checkpointRequired: true,
        checkpointStatus: "waiting_user",
      },
    });
    expect(goal.status).toBe("reviewing");
    expect(node.status).toBe("pending_review");
  });

  it("requires an observed Goal run id instead of inventing one", () => {
    expect(() => createGoalCodingRunView({
      goal: { id: "goal-missing-run", status: "ready" },
    })).toThrow('Goal "goal-missing-run" has no observed coding run id.');
  });

  it("projects Workflow Journal status without exposing prompt, result, or error content", () => {
    const view = createWorkflowJournalCodingRunView({
      workflowRunId: "workflow-run-1",
      record: {
        id: "journal-entry-1",
        journalId: "journal-1",
        status: "pending",
        tokenCount: null,
        cacheHitCount: 2,
        leaseOwnerId: "worker-1",
        leaseExpiresAt: 1_700_000_100_000,
        createdAt: 1_700_000_000_000,
        completedAt: null,
        result: "secret result",
        resultJson: '{"token":"secret"}',
        error: "secret error",
      },
    });

    expect(view).toEqual({
      source: "workflow",
      status: "running",
      recovery: { operation: "workflow.resume" },
      binding: {
        agentRunId: "workflow-run-1",
        workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
      },
      evidence: {
        journalStatus: "pending",
        tokenCount: null,
        cacheHitCount: 2,
        hasResult: true,
        hasResultJson: true,
        hasError: true,
        createdAtMs: 1_700_000_000_000,
        completedAtMs: null,
      },
    });
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(JSON.stringify(view)).not.toContain("worker-1");
  });

  it("projects the exact active Workflow runtime without exposing error content", () => {
    const view = createWorkflowRuntimeCodingRunView({
      status: {
        workflowRunId: "workflow-run-1",
        journalId: "journal-1",
        status: "stopping",
        stopRequested: true,
        stats: { total: 3, pending: 1, done: 1, errors: 1, skipped: 0, totalTokens: 120, cacheHits: 2 },
        error: "private workflow error",
      },
    });

    expect(view).toEqual({
      source: "workflow",
      status: "running",
      recovery: { operation: "workflow.resume" },
      binding: {
        agentRunId: "workflow-run-1",
        workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
      },
      evidence: {
        runtimeStatus: "stopping",
        stopRequested: true,
        total: 3,
        pending: 1,
        done: 1,
        errors: 1,
        skipped: 0,
        totalTokens: 120,
        cacheHits: 2,
        hasError: true,
      },
    });
    expect(JSON.stringify(view)).not.toContain("private workflow error");
  });

  it("projects a runtime-lost marker without exposing owner process identity", () => {
    const conversation = createRuntimeLostCodingRunView({
      source: "conversation",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      startedAtMs: 100,
      updatedAtMs: 200,
    });
    const workflow = createRuntimeLostCodingRunView({
      source: "workflow",
      binding: {
        agentRunId: "workflow-run-1",
        workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
      },
      startedAtMs: 300,
      updatedAtMs: 400,
    });

    expect(conversation).toEqual({
      source: "conversation",
      status: "interrupted",
      recovery: { operation: "conversation.continue" },
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      evidence: {
        runtimeState: "lost",
        lastObservedState: "active",
        startedAtMs: 100,
        lastObservedAtMs: 200,
      },
    });
    expect(workflow).toMatchObject({
      source: "workflow",
      status: "interrupted",
      recovery: { operation: "workflow.resume" },
      evidence: { runtimeState: "lost", lastObservedState: "active" },
    });
    expect(JSON.stringify([conversation, workflow])).not.toMatch(/owner|process|pid/i);
  });

  it("keeps Commander/Subtask task and agent run identifiers distinct in a safe status view", () => {
    const view = createSubtaskCodingRunView({
      record: {
        id: "task-1",
        sessionId: "agent-session-1",
        parentConversationId: "conversation-1",
        kind: "sub_agent",
        status: "running",
        progress: { phase: "running" },
        archivedAt: undefined,
        outputPath: "/private/result.md",
        scratchPath: undefined,
        reviewPath: "/private/review.md",
        bridgeSessionRuntime: { state: "active" },
        launchSpec: { role: "coder", worktreePath: "/private/worktree" },
      },
    });

    expect(view).toEqual({
      source: "subtask",
      status: "running",
      recovery: { operation: "subtask.resume" },
      binding: {
        agentRunId: "agent-session-1",
        conversationId: "conversation-1",
        subtask: { taskId: "task-1" },
      },
      evidence: {
        taskStatus: "running",
        taskKind: "sub_agent",
        role: "coder",
        progressPhase: "running",
        archived: false,
        hasOutputArtifact: true,
        hasScratchArtifact: false,
        hasReviewArtifact: true,
        hasManagedWorktree: true,
        bridgeSessionState: "active",
      },
    });
    expect(JSON.stringify(view)).not.toContain("/private");
  });
});
