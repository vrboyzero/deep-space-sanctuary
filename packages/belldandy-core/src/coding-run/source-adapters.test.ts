import { describe, expect, it } from "vitest";

import {
  createGoalCodingRunView,
  createSubtaskCodingRunView,
  createWorkflowJournalCodingRunView,
} from "./source-adapters.js";

describe("coding-run source adapters", () => {
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
