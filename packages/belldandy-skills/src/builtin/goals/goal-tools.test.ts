import { describe, expect, it, vi } from "vitest";
import { goalInitTool } from "./goal-init.js";
import { goalGetTool } from "./goal-get.js";
import { goalListTool } from "./goal-list.js";
import { goalResumeTool } from "./goal-resume.js";
import { goalCheckpointApproveTool } from "./goal-checkpoint-approve.js";
import { goalCheckpointExpireTool } from "./goal-checkpoint-expire.js";
import { goalCheckpointListTool } from "./goal-checkpoint-list.js";
import { goalCheckpointReopenTool } from "./goal-checkpoint-reopen.js";
import { goalCheckpointRejectTool } from "./goal-checkpoint-reject.js";
import { goalCheckpointRequestTool } from "./goal-checkpoint-request.js";
import { goalCapabilityPlanTool } from "./goal-capability-plan.js";
import { goalHandoffGenerateTool } from "./goal-handoff-generate.js";
import { goalExperienceSuggestTool } from "./goal-experience-suggest.js";
import { goalMethodCandidatesGenerateTool } from "./goal-method-candidates-generate.js";
import { goalRetrospectGenerateTool } from "./goal-retrospect-generate.js";
import { goalSkillCandidatesGenerateTool } from "./goal-skill-candidates-generate.js";
import { goalFlowPatternsGenerateTool } from "./goal-flow-patterns-generate.js";
import { goalCrossGoalFlowPatternsTool } from "./goal-cross-goal-flow-patterns.js";
import { goalReviewGovernanceSummaryTool } from "./goal-review-governance-summary.js";
import { goalSuggestionReviewListTool } from "./goal-suggestion-review-list.js";
import { goalSuggestionReviewWorkflowSetTool } from "./goal-suggestion-review-workflow-set.js";
import { goalSuggestionReviewDecideTool } from "./goal-suggestion-review-decide.js";
import { goalSuggestionReviewEscalateTool } from "./goal-suggestion-review-escalate.js";
import { goalSuggestionReviewScanTool } from "./goal-suggestion-review-scan.js";
import { goalSuggestionPublishTool } from "./goal-suggestion-publish.js";
import { goalOrchestrateTool } from "./goal-orchestrate.js";
import { goalCommanderDecideTool } from "./goal-commander-decide.js";
import { taskGraphClaimTool } from "./task-graph-claim.js";
import { taskGraphCreateTool } from "./task-graph-create.js";
import { taskGraphFailTool } from "./task-graph-fail.js";
import { taskGraphPendingReviewTool } from "./task-graph-pending-review.js";
import { taskGraphReadTool } from "./task-graph-read.js";
import { taskGraphSkipTool } from "./task-graph-skip.js";
import { taskGraphValidatingTool } from "./task-graph-validating.js";
import type { ToolContext } from "../../types.js";

const baseContext: ToolContext = {
  conversationId: "conv-1",
  workspaceRoot: "E:/project/star-sanctuary",
  policy: {
    allowedPaths: [],
    deniedPaths: [],
    allowedDomains: [],
    deniedDomains: [],
    maxTimeoutMs: 30_000,
    maxResponseBytes: 512_000,
  },
  agentCapabilities: {
    spawnParallel: vi.fn(async (tasks) => tasks.map(() => ({
      success: true,
      output: "delegated",
      sessionId: "session_1",
    }))),
  },
  goalCapabilities: {
    getGoal: vi.fn(async () => ({
      id: "goal_alpha",
      slug: "alpha",
      title: "Alpha Goal",
      status: "executing",
      goalRoot: "E:/goals/goal_alpha",
      runtimeRoot: "E:/goals/goal_alpha",
      docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
      northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
      tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
      progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
      handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
      registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
      pathSource: "default",
      currentPhase: "implementation",
      activeConversationId: "goal:goal_alpha",
      activeNodeId: "node_root",
      lastNodeId: "node_root",
      lastRunId: "run_123",
      objective: "Ship Alpha Goal",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    })),
    createGoal: vi.fn(async (input) => ({
      id: "goal_alpha",
      slug: "alpha",
      title: input.title,
      status: "planning",
      goalRoot: "E:/goals/goal_alpha",
      runtimeRoot: "E:/goals/goal_alpha",
      docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
      northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
      tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
      progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
      registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
      pathSource: "default",
      objective: input.objective,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    })),
    listGoals: vi.fn(async () => [
      {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "planning",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ]),
    resumeGoal: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      conversationId: "goal:goal_alpha",
      runId: undefined,
    })),
    readTaskGraph: vi.fn(async () => ({
      version: 2 as const,
      goalId: "goal_alpha",
      updatedAt: "2026-03-20T00:00:00.000Z",
      nodes: [
        {
          id: "node_root",
          title: "Root Node",
          status: "ready" as const,
          dependsOn: [],
          acceptance: [],
          artifacts: [],
          checkpointRequired: false,
          checkpointStatus: "not_required" as const,
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      ],
      edges: [],
    })),
    createTaskNode: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "planning",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: {
        version: 2 as const,
        goalId: "goal_alpha",
        updatedAt: "2026-03-20T00:00:00.000Z",
        nodes: [
          {
            id: "node_root",
            title: "Root Node",
            status: "ready" as const,
            dependsOn: [],
            acceptance: [],
            artifacts: [],
            checkpointRequired: false,
            checkpointStatus: "not_required" as const,
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          },
        ],
        edges: [],
      },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "ready" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    claimTaskNode: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: {
        version: 2 as const,
        goalId: "goal_alpha",
        updatedAt: "2026-03-20T00:00:00.000Z",
        nodes: [
          {
            id: "node_root",
            title: "Root Node",
            status: "in_progress" as const,
            dependsOn: [],
            acceptance: [],
            artifacts: [],
            checkpointRequired: false,
            checkpointStatus: "not_required" as const,
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          },
        ],
        edges: [],
      },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "in_progress" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    markTaskNodePendingReview: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "reviewing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "pending_review" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    markTaskNodeValidating: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "reviewing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "validating" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    completeTaskNode: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "completed",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "done" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    blockTaskNode: vi.fn(async (_goalId, _nodeId, input) => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "blocked",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "blocked" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        summary: input?.summary,
        blockReason: input?.blockReason,
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    listCheckpoints: vi.fn(async () => ({
      version: 2 as const,
      items: [
        {
          id: "checkpoint_1",
          goalId: "goal_alpha",
          nodeId: "node_root",
          runId: "run_1",
          status: "waiting_user" as const,
          title: "Root checkpoint",
          summary: "Need approval",
          note: "Please review",
          reviewer: "producer",
          reviewerRole: "产品验收",
          requestedBy: "main-agent",
          slaAt: "2026-03-21T12:00:00.000Z",
          requestedAt: "2026-03-20T00:00:00.000Z",
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
          history: [
            {
              action: "requested" as const,
              status: "waiting_user" as const,
              at: "2026-03-20T00:00:00.000Z",
              summary: "Need approval",
              note: "Please review",
              actor: "main-agent",
              runId: "run_1",
            },
          ],
        },
      ],
    })),
    requestCheckpoint: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "pending_approval",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: {
        version: 2 as const,
        goalId: "goal_alpha",
        updatedAt: "2026-03-20T00:00:00.000Z",
        nodes: [],
        edges: [],
      },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "pending_review" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: true,
        checkpointStatus: "waiting_user" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      checkpoints: {
        version: 2 as const,
        items: [],
      },
      checkpoint: {
        id: "checkpoint_1",
        goalId: "goal_alpha",
        nodeId: "node_root",
        runId: "run_1",
        status: "waiting_user" as const,
        title: "Root checkpoint",
        summary: "Need approval",
        note: "Please review",
        reviewer: "producer",
        reviewerRole: "产品验收",
        requestedBy: "main-agent",
        slaAt: "2026-03-21T12:00:00.000Z",
        requestedAt: "2026-03-20T00:00:00.000Z",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        history: [
          {
            action: "requested" as const,
            status: "waiting_user" as const,
            at: "2026-03-20T00:00:00.000Z",
            summary: "Need approval",
            note: "Please review",
            actor: "main-agent",
            runId: "run_1",
          },
        ],
      },
    })),
    approveCheckpoint: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "reviewing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: {
        version: 2 as const,
        goalId: "goal_alpha",
        updatedAt: "2026-03-20T00:00:00.000Z",
        nodes: [],
        edges: [],
      },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "validating" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: true,
        checkpointStatus: "approved" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      checkpoints: {
        version: 2 as const,
        items: [],
      },
      checkpoint: {
        id: "checkpoint_1",
        goalId: "goal_alpha",
        nodeId: "node_root",
        runId: "run_1",
        status: "approved" as const,
        title: "Root checkpoint",
        summary: "Approved",
        note: "Looks good",
        requestedAt: "2026-03-20T00:00:00.000Z",
        decidedAt: "2026-03-20T01:00:00.000Z",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T01:00:00.000Z",
        history: [
          { action: "requested" as const, status: "waiting_user" as const, at: "2026-03-20T00:00:00.000Z" },
          { action: "approved" as const, status: "approved" as const, at: "2026-03-20T01:00:00.000Z" },
        ],
      },
    })),
    rejectCheckpoint: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "blocked",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: {
        version: 2 as const,
        goalId: "goal_alpha",
        updatedAt: "2026-03-20T00:00:00.000Z",
        nodes: [],
        edges: [],
      },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "blocked" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: true,
        checkpointStatus: "rejected" as const,
        blockReason: "Need changes",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      checkpoints: {
        version: 2 as const,
        items: [],
      },
      checkpoint: {
        id: "checkpoint_1",
        goalId: "goal_alpha",
        nodeId: "node_root",
        runId: "run_1",
        status: "rejected" as const,
        title: "Root checkpoint",
        summary: "Rejected",
        note: "Need changes",
        requestedAt: "2026-03-20T00:00:00.000Z",
        decidedAt: "2026-03-20T01:00:00.000Z",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T01:00:00.000Z",
        history: [
          { action: "requested" as const, status: "waiting_user" as const, at: "2026-03-20T00:00:00.000Z" },
          { action: "rejected" as const, status: "rejected" as const, at: "2026-03-20T01:00:00.000Z" },
        ],
      },
    })),
    expireCheckpoint: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "blocked",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "blocked" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: true,
        checkpointStatus: "expired" as const,
        blockReason: "Timeout",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      checkpoints: { version: 2 as const, items: [] },
      checkpoint: {
        id: "checkpoint_1",
        goalId: "goal_alpha",
        nodeId: "node_root",
        runId: "run_1",
        status: "expired" as const,
        title: "Root checkpoint",
        summary: "Expired",
        note: "Timeout",
        requestedAt: "2026-03-20T00:00:00.000Z",
        decidedAt: "2026-03-20T01:00:00.000Z",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T01:00:00.000Z",
        history: [
          { action: "requested" as const, status: "waiting_user" as const, at: "2026-03-20T00:00:00.000Z" },
          { action: "expired" as const, status: "expired" as const, at: "2026-03-20T01:00:00.000Z", note: "Timeout" },
        ],
      },
    })),
    reopenCheckpoint: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "pending_approval",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "pending_review" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: true,
        checkpointStatus: "waiting_user" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      checkpoints: { version: 2 as const, items: [] },
      checkpoint: {
        id: "checkpoint_1",
        goalId: "goal_alpha",
        nodeId: "node_root",
        runId: "run_2",
        status: "waiting_user" as const,
        title: "Root checkpoint",
        summary: "Reopened",
        note: "Retry",
        requestedAt: "2026-03-20T02:00:00.000Z",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T02:00:00.000Z",
        history: [
          { action: "requested" as const, status: "waiting_user" as const, at: "2026-03-20T00:00:00.000Z" },
          { action: "expired" as const, status: "expired" as const, at: "2026-03-20T01:00:00.000Z" },
          { action: "reopened" as const, status: "waiting_user" as const, at: "2026-03-20T02:00:00.000Z" },
        ],
      },
    })),
    failTaskNode: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "blocked",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "failed" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        blockReason: "Failure reason",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    skipTaskNode: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      graph: { version: 2 as const, goalId: "goal_alpha", updatedAt: "2026-03-20T00:00:00.000Z", nodes: [], edges: [] },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "skipped" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    listCapabilityPlans: vi.fn(async () => ({
      version: 1 as const,
      items: [],
    })),
    getCapabilityPlan: vi.fn(async () => ({
      id: "plan_1",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "planned" as const,
      executionMode: "multi_agent" as const,
      governanceMode: "direct" as const,
      preferredAgents: [],
      riskLevel: "low" as const,
      objective: "Plan Root Node",
      summary: "Need methods and delegation",
      queryHints: ["Root Node", "Alpha Goal"],
      reasoning: ["Need explicit planning before execute"],
      methods: [{ file: "Refactor-Plan.md", title: "Refactor Plan", score: 20 }],
      skills: [{ name: "find-skills", score: 10 }],
      mcpServers: [{ serverId: "docs", status: "connected" as const, toolCount: 3 }],
      subAgents: [{ agentId: "coder", objective: "Implement Root Node" }],
      gaps: ["Need more skill coverage"],
      checkpoint: {
        required: false,
        reasons: [],
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    })),
    saveCapabilityPlan: vi.fn(async (_goalId, _nodeId, input) => {
      const fanInStrategy = input.orchestration?.coordinationPlan?.rolePolicy?.fanInStrategy;
      const delegationResults = input.orchestration?.delegationResults ?? [];
      const acceptanceGate = input.orchestration?.acceptanceGate ?? (
        fanInStrategy === "commander_review"
          ? delegationResults.some((item) => item.status === "failed")
            ? {
              status: "rejected" as const,
              summary: "Commander review rejected this capability plan.",
              reasons: ["failed delegation"],
              rejectionConfidence: "high" as const,
              managerActionHint: "Issue a rework order.",
            }
            : delegationResults.length > 0 && delegationResults.every((item) => item.status === "success")
              ? {
                status: "accepted" as const,
                summary: "Commander review fan-in is complete.",
                reasons: [],
                managerActionHint: "Commander review is complete enough to approve.",
              }
              : {
                status: "pending" as const,
                summary: "Commander review is still pending.",
                reasons: ["pending delegation"],
                managerActionHint: "Wait for delegated lanes.",
              }
          : fanInStrategy === "verifier_handoff"
            ? input.orchestration?.verifierResult?.status === "completed"
              ? {
                status: "accepted" as const,
                summary: "Verifier fan-in gate passed.",
                reasons: [],
                managerActionHint: "Verifier result can be used as acceptance signal.",
              }
              : input.orchestration?.verifierResult?.status === "failed"
                ? {
                  status: "rejected" as const,
                  summary: "Verifier fan-in gate rejected this capability plan.",
                  reasons: ["verifier failed"],
                  rejectionConfidence: "high" as const,
                  managerActionHint: "Repair verifier path before closing.",
                }
                : {
                  status: "pending" as const,
                  summary: "Verifier fan-in gate is still pending.",
                  reasons: ["verifier pending"],
                  managerActionHint: "Wait for verifier completion.",
                }
            : undefined
      );
      return {
      id: "plan_1",
      goalId: "goal_alpha",
      nodeId: "node_root",
      runId: input.runId,
      status: input.status ?? "planned",
      executionMode: input.executionMode,
      governanceMode: input.governanceMode ?? "direct",
      commanderAgentId: input.commanderAgentId,
      preferredAgents: input.preferredAgents ?? [],
      riskLevel: input.riskLevel ?? "low",
      objective: input.objective,
      summary: input.summary,
      queryHints: input.queryHints ?? [],
      reasoning: input.reasoning ?? [],
      methods: input.methods ?? [],
      skills: input.skills ?? [],
      mcpServers: input.mcpServers ?? [],
      subAgents: input.subAgents ?? [],
      gaps: input.gaps ?? [],
      checkpoint: input.checkpoint ?? {
        required: false,
        reasons: [],
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: input.actualUsage ?? { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      orchestratedAt: input.orchestratedAt,
      orchestration: input.orchestration
        ? {
          ...input.orchestration,
          ...(acceptanceGate ? { acceptanceGate } : {}),
        }
        : undefined,
      };
    }),
    generateCapabilityPlan: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      node: {
        id: "node_root",
        title: "Root Node",
        status: "ready" as const,
        dependsOn: [],
        acceptance: [],
        artifacts: [],
        checkpointRequired: false,
        checkpointStatus: "not_required" as const,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      plan: {
        id: "plan_1",
        goalId: "goal_alpha",
        nodeId: "node_root",
        status: "planned" as const,
        executionMode: "multi_agent" as const,
        governanceMode: "direct" as const,
        preferredAgents: [],
        riskLevel: "low" as const,
        objective: "Plan Root Node",
        summary: "Need methods and delegation",
        queryHints: ["Root Node", "Alpha Goal"],
        reasoning: ["Need explicit planning before execute"],
        methods: [{ file: "Refactor-Plan.md", title: "Refactor Plan", score: 20 }],
        skills: [{ name: "find-skills", score: 10 }],
        mcpServers: [{ serverId: "docs", status: "connected" as const, toolCount: 3 }],
        subAgents: [{ agentId: "coder", objective: "Implement Root Node" }],
        gaps: ["Need more skill coverage"],
        checkpoint: {
          required: false,
          reasons: [],
          approvalMode: "none" as const,
          requiredRequestFields: [],
          requiredDecisionFields: [],
          escalationMode: "none" as const,
        },
        actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
        analysis: {
          status: "pending" as const,
          summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
          deviations: [],
          recommendations: [],
        },
        generatedAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    })),
    generateHandoff: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      handoff: {
        version: 1 as const,
        goalId: "goal_alpha",
        generatedAt: "2026-03-20T10:00:00.000Z",
        goalStatus: "executing",
        currentPhase: "implementation",
        activeConversationId: "goal:goal_alpha:node:node_root:run:run_1",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        resumeMode: "current_node" as const,
        recommendedNodeId: "node_root",
        summary: "Resume current node.",
        nextAction: "Continue node_root.",
        tracking: {
          totalNodes: 1,
          completedNodes: 0,
          inProgressNodes: 1,
          blockedNodes: 0,
          pendingReviewNodes: 0,
          validatingNodes: 0,
          failedNodes: 0,
          skippedNodes: 0,
          openCheckpointCount: 0,
        },
        openCheckpoints: [],
        blockers: [],
        focusCapability: {
          planId: "plan_1",
          nodeId: "node_root",
          status: "planned" as const,
          executionMode: "single_agent" as const,
          riskLevel: "low" as const,
          alignment: "pending" as const,
          summary: "Plan summary",
        },
        recentProgress: [],
      },
      content: "# handoff",
    })),
    generateRetrospective: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      retrospective: {
        version: 1 as const,
        goalId: "goal_alpha",
        generatedAt: "2026-03-20T11:00:00.000Z",
        goalStatus: "executing",
        currentPhase: "implementation",
        objective: "Build it",
        outcome: "in_progress" as const,
        summary: "Goal 当前仍在推进，已具备最小 retrospective。",
        nextFocus: "Continue node_root.",
        handoffSummary: "Resume current node.",
        taskSummary: {
          totalNodes: 1,
          completedNodes: 0,
          inProgressNodes: 1,
          blockedNodes: 0,
          pendingReviewNodes: 0,
          validatingNodes: 0,
          failedNodes: 0,
          skippedNodes: 0,
          openCheckpointCount: 0,
        },
        checkpointSummary: {
          total: 1,
          waitingUserCount: 0,
          approvedCount: 1,
          rejectedCount: 0,
          expiredCount: 0,
        },
        capabilitySummary: {
          totalPlans: 1,
          orchestratedPlans: 1,
          highRiskPlans: 0,
          divergedPlans: 0,
          uniqueMethods: ["Refactor-Plan.md"],
          uniqueSkills: ["find-skills"],
          uniqueMcpServers: ["docs"],
          topGaps: ["Need more skill coverage (1)"],
        },
        achievements: ["已形成一版 capability 计划。"],
        blockers: [],
        recommendations: ["Continue node_root."],
        highlightedNodes: [
          {
            id: "node_root",
            title: "Root Node",
            status: "in_progress" as const,
            checkpointStatus: "not_required" as const,
            artifacts: [],
            updatedAt: "2026-03-20T11:00:00.000Z",
          },
        ],
        recentProgress: [],
        markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md",
        jsonPath: "E:/goals/goal_alpha/retrospective.json",
      },
      content: "# 06-retrospective",
    })),
    generateExperienceSuggestions: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      generatedAt: "2026-03-20T13:30:00.000Z",
      retrospective: {
        version: 1 as const,
        goalId: "goal_alpha",
        generatedAt: "2026-03-20T11:00:00.000Z",
        goalStatus: "executing",
        currentPhase: "delivery",
        objective: "Ship alpha",
        outcome: "in_progress" as const,
        summary: "Alpha is progressing with one active root node.",
        nextFocus: "Continue node_root",
        handoffSummary: "Resume node_root",
        taskSummary: {
          totalNodes: 1,
          completedNodes: 0,
          inProgressNodes: 1,
          blockedNodes: 0,
          openCheckpointCount: 0,
        },
        checkpointSummary: {
          total: 0,
          waitingUserCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
          expiredCount: 0,
        },
        capabilitySummary: {
          totalPlans: 1,
          orchestratedPlans: 1,
          highRiskPlans: 0,
          divergedPlans: 0,
          uniqueMethods: ["Refactor-Plan.md"],
          uniqueSkills: ["find-skills"],
          uniqueMcpServers: ["docs"],
          topGaps: ["Need more skill coverage (1)"],
        },
        achievements: ["已形成一版 capability 计划。"],
        blockers: [],
        recommendations: ["Continue node_root."],
        highlightedNodes: [
          {
            id: "node_root",
            title: "Root Node",
            status: "in_progress" as const,
            checkpointStatus: "not_required" as const,
            artifacts: [],
            updatedAt: "2026-03-20T11:00:00.000Z",
          },
        ],
        recentProgress: [],
        markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md",
        jsonPath: "E:/goals/goal_alpha/retrospective.json",
      },
      methodCandidates: {
        count: 1,
        items: [
          {
            id: "method_candidate_node_root",
            goalId: "goal_alpha",
            nodeId: "node_root",
            runId: "run_1",
            title: "Root Node 方法候选",
            slug: "alpha-node-root-root-node",
            status: "suggested" as const,
            summary: "Root node execution summary",
            rationale: ["节点已完成，具备较高的流程稳定性。"],
            qualityScore: 82,
            evidence: {
              nodeId: "node_root",
              runId: "run_1",
              nodeStatus: "done" as const,
              checkpointStatus: "approved" as const,
              artifacts: ["artifacts/root.txt"],
              acceptance: ["Regression passes"],
              methodsUsed: ["Refactor-Plan.md"],
              skillsUsed: ["find-skills"],
              mcpServersUsed: ["docs"],
              progressEvents: ["task_node_claimed", "task_node_completed"],
              references: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
            },
            draftContent: "# Root Node 方法候选",
            createdAt: "2026-03-20T12:00:00.000Z",
          },
        ],
        markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/07-method-candidates.md",
        jsonPath: "E:/goals/goal_alpha/method-candidates.json",
      },
      skillCandidates: {
        count: 1,
        items: [
          {
            id: "skill_candidate_node_root",
            goalId: "goal_alpha",
            nodeId: "node_root",
            runId: "run_1",
            title: "node_root skill 候选",
            slug: "alpha-node-root-skill",
            status: "suggested" as const,
            summary: "Node root shows repeated capability gaps.",
            rationale: ["存在能力缺口：Need automation wrapper。"],
            qualityScore: 78,
            evidence: {
              nodeId: "node_root",
              runId: "run_1",
              executionMode: "multi_agent" as const,
              riskLevel: "medium" as const,
              planStatus: "orchestrated" as const,
              objective: "Implement root flow",
              summary: "Need automation wrapper",
              gaps: ["Need automation wrapper"],
              methodsUsed: ["Refactor-Plan.md"],
              skillsUsed: ["find-skills"],
              mcpServersUsed: ["docs"],
              toolNamesUsed: ["file_read", "apply_patch"],
              deviations: ["[tooling] unplanned tool chain"],
              references: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
            },
            draftContent: "# node_root skill draft",
            createdAt: "2026-03-20T12:30:00.000Z",
          },
        ],
        markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/08-skill-candidates.md",
        jsonPath: "E:/goals/goal_alpha/skill-candidates.json",
      },
      flowPatterns: {
        count: 1,
        items: [
          {
            id: "flow_pattern_1",
            goalId: "goal_alpha",
            signature: "events=task_node_claimed>task_node_completed|mode=single_agent|checkpoint=none|risk=low|tools=file_read|mcp=",
            summary: "Pattern summary",
            count: 2,
            action: "promote_method" as const,
            confidence: 72,
            eventSequence: ["task_node_claimed", "task_node_completed"],
            executionMode: "single_agent" as const,
            riskLevel: "low" as const,
            checkpointMode: "none" as const,
            toolNames: ["file_read"],
            mcpServers: [],
            methods: ["Refactor-Plan.md"],
            skills: [],
            gaps: [],
            nodeRefs: [
              { nodeId: "node_root", status: "done" as const, checkpointStatus: "not_required" as const },
              { nodeId: "node_child", status: "done" as const, checkpointStatus: "not_required" as const },
            ],
            recommendations: ["该流程已具备重复执行特征，建议优先沉淀为 method。"],
          },
        ],
        markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/09-flow-patterns.md",
        jsonPath: "E:/goals/goal_alpha/flow-patterns.json",
      },
      summary: "Alpha is progressing with one active root node. | method=1 | skill=1 | flow=1",
      recommendations: [
        "Continue node_root.",
        "优先审阅 method candidate：Root Node 方法候选",
      ],
    })),
    generateMethodCandidates: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      candidates: [
        {
          id: "method_candidate_node_root",
          goalId: "goal_alpha",
          nodeId: "node_root",
          runId: "run_1",
          title: "Root Node 方法候选",
          slug: "alpha-node-root-root-node",
          status: "suggested" as const,
          summary: "Root node execution summary",
          rationale: ["节点已完成，具备较高的流程稳定性。"],
          qualityScore: 82,
          evidence: {
            nodeId: "node_root",
            runId: "run_1",
            nodeStatus: "done" as const,
            checkpointStatus: "approved" as const,
            artifacts: ["artifacts/root.txt"],
            acceptance: ["Regression passes"],
            methodsUsed: ["Refactor-Plan.md"],
            skillsUsed: ["find-skills"],
            mcpServersUsed: ["docs"],
            progressEvents: ["task_node_claimed", "task_node_completed"],
            references: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
          },
          draftContent: "# Root Node 方法候选",
          createdAt: "2026-03-20T12:00:00.000Z",
        },
      ],
      markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/07-method-candidates.md",
      jsonPath: "E:/goals/goal_alpha/method-candidates.json",
      content: "# 07-method-candidates",
    })),
    generateSkillCandidates: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      candidates: [
        {
          id: "skill_candidate_node_root",
          goalId: "goal_alpha",
          nodeId: "node_root",
          runId: "run_1",
          title: "node_root skill 候选",
          slug: "alpha-node-root-skill",
          status: "suggested" as const,
          summary: "Node root shows repeated capability gaps.",
          rationale: ["存在能力缺口：Need automation wrapper。"],
          qualityScore: 78,
          evidence: {
            nodeId: "node_root",
            runId: "run_1",
            executionMode: "multi_agent" as const,
            riskLevel: "medium" as const,
            planStatus: "orchestrated" as const,
            objective: "Implement root flow",
            summary: "Need automation wrapper",
            gaps: ["Need automation wrapper"],
            methodsUsed: ["Refactor-Plan.md"],
            skillsUsed: ["find-skills"],
            mcpServersUsed: ["docs"],
            toolNamesUsed: ["file_read", "apply_patch"],
            deviations: ["[tooling] unplanned tool chain"],
            references: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
          },
          draftContent: "# node_root skill draft",
          createdAt: "2026-03-20T12:30:00.000Z",
        },
      ],
      markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/08-skill-candidates.md",
      jsonPath: "E:/goals/goal_alpha/skill-candidates.json",
      content: "# 08-skill-candidates",
    })),
    generateFlowPatterns: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      patterns: [
        {
          id: "flow_pattern_1",
          goalId: "goal_alpha",
          signature: "events=task_node_claimed>task_node_completed|mode=single_agent|checkpoint=none|risk=low|tools=file_read|mcp=",
          summary: "Pattern summary",
          count: 2,
          action: "promote_method" as const,
          confidence: 72,
          eventSequence: ["task_node_claimed", "task_node_completed"],
          executionMode: "single_agent" as const,
          riskLevel: "low" as const,
          checkpointMode: "none" as const,
          toolNames: ["file_read"],
          mcpServers: [],
          methods: ["Refactor-Plan.md"],
          skills: [],
          gaps: [],
          nodeRefs: [
            { nodeId: "node_root", status: "done" as const, checkpointStatus: "not_required" as const },
            { nodeId: "node_child", status: "done" as const, checkpointStatus: "not_required" as const },
          ],
          recommendations: ["该流程已具备重复执行特征，建议优先沉淀为 method。"],
        },
      ],
      markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/09-flow-patterns.md",
      jsonPath: "E:/goals/goal_alpha/flow-patterns.json",
      content: "# 09-flow-patterns",
    })),
    generateCrossGoalFlowPatterns: vi.fn(async () => ({
      generatedAt: "2026-03-20T15:00:00.000Z",
      goalsScanned: 2,
      patterns: [
        {
          id: "cross_goal_flow_1",
          signature: "events=task_node_claimed>task_node_completed|mode=single_agent|checkpoint=none|risk=low|tools=file_read|mcp=",
          summary: "该流程在 2 个 goal 中共出现 4 次，主要特征为 task_node_claimed -> task_node_completed。",
          goalCount: 2,
          occurrenceCount: 4,
          recommendedAction: "promote_method" as const,
          confidence: 82,
          eventSequence: ["task_node_claimed", "task_node_completed"],
          executionMode: "single_agent" as const,
          riskLevel: "low" as const,
          checkpointMode: "none" as const,
          toolNames: ["file_read"],
          mcpServers: [],
          methods: ["Refactor-Plan.md"],
          skills: [],
          gaps: [],
          goalRefs: [
            {
              goalId: "goal_alpha",
              goalTitle: "Alpha Goal",
              patternId: "flow_pattern_1",
              count: 2,
              confidence: 72,
              nodeRefs: [{ nodeId: "node_root", status: "done" as const, checkpointStatus: "not_required" as const }],
            },
            {
              goalId: "goal_beta",
              goalTitle: "Beta Goal",
              patternId: "flow_pattern_2",
              count: 2,
              confidence: 74,
              nodeRefs: [{ nodeId: "node_beta", status: "done" as const, checkpointStatus: "not_required" as const }],
            },
          ],
          recommendations: ["该模式已跨 2 个 goal 重复出现，可进入更高优先级治理。"],
        },
      ],
      markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/cross-goal-flow-patterns.md",
      jsonPath: "C:/Users/admin/.star_sanctuary/goals/cross-goal-flow-patterns.json",
      content: "# 12-cross-goal-flow-patterns",
    })),
    getReviewGovernanceSummary: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      generatedAt: "2026-03-20T15:10:00.000Z",
      governanceConfig: {
        version: 1 as const,
        reviewers: [
          {
            id: "producer",
            name: "Producer",
            reviewerRole: "approver",
            channels: ["reviewer_inbox", "im_dm"] as const,
            active: true,
          },
        ],
        templates: [
          {
            id: "tpl_default_review",
            title: "Default Review",
            target: "suggestion_review" as const,
            enabled: true,
            mode: "single" as const,
          },
        ],
        defaults: {
          reminderMinutes: [60, 15],
          notificationChannels: ["goal_detail", "reviewer_inbox"] as const,
          notificationRoutes: {
            im_dm: "im://review/{recipient}",
          },
        },
        updatedAt: "2026-03-20T15:10:00.000Z",
      },
      governanceConfigPath: "C:/Users/admin/.star_sanctuary/governance/review-governance.json",
      reviews: {
        version: 1 as const,
        syncedAt: "2026-03-20T15:10:00.000Z",
        items: [
          {
            id: "review_method_candidate_node_root",
            goalId: "goal_alpha",
            suggestionType: "method_candidate" as const,
            suggestionId: "method_candidate_node_root",
            title: "Root Node 方法候选",
            summary: "Root node execution summary",
            sourcePath: "E:/goals/goal_alpha/method-candidates.json",
            nodeId: "node_root",
            runId: "run_1",
            status: "accepted" as const,
            reviewer: "producer",
            decidedBy: "producer",
            evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
            createdAt: "2026-03-20T14:00:00.000Z",
            updatedAt: "2026-03-20T15:00:00.000Z",
          },
        ],
      },
      publishRecords: {
        version: 1 as const,
        items: [
          {
            id: "publish_review_method_candidate_node_root",
            goalId: "goal_alpha",
            reviewId: "review_method_candidate_node_root",
            suggestionType: "method_candidate" as const,
            suggestionId: "method_candidate_node_root",
            assetType: "method" as const,
            title: "Root Node 方法候选",
            publishedPath: "C:/Users/admin/.star_sanctuary/methods/method-root-node.md",
            assetKey: "method-root-node.md",
            experienceCandidateId: "goal_exp_goal_alpha_method_candidate_node_root_method",
            reviewer: "producer",
            decidedBy: "producer",
            nodeId: "node_root",
            runId: "run_1",
            sourcePath: "E:/goals/goal_alpha/method-candidates.json",
            publishedAt: "2026-03-20T15:05:00.000Z",
          },
        ],
      },
      notifications: {
        version: 1 as const,
        items: [
          {
            id: "review_notification_goal_alpha_method_overdue",
            goalId: "goal_alpha",
            targetType: "suggestion_review" as const,
            targetId: "review_method_candidate_node_root",
            recipient: "producer",
            kind: "sla_overdue" as const,
            message: "Root Node 方法候选 / Stage 1 已超过 SLA",
            dedupeKey: "suggestion_review:review_method_candidate_node_root:stage_1:overdue",
            createdAt: "2026-03-20T15:10:00.000Z",
          },
        ],
      },
      notificationsPath: "E:/goals/goal_alpha/review-notifications.json",
      notificationDispatches: {
        version: 1 as const,
        items: [
          {
            id: "review_dispatch_goal_alpha_1",
            notificationId: "review_notification_goal_alpha_method_overdue",
            goalId: "goal_alpha",
            targetType: "suggestion_review" as const,
            targetId: "review_method_candidate_node_root",
            kind: "sla_overdue" as const,
            channel: "goal_detail" as const,
            recipient: "producer",
            routeKey: "goal:goal_alpha:detail",
            message: "Root Node 方法候选 / Stage 1 已超过 SLA",
            dedupeKey: "suggestion_review:review_method_candidate_node_root:stage_1:overdue:dispatch:goal_detail:goal:goal_alpha:detail",
            status: "materialized" as const,
            createdAt: "2026-03-20T15:10:00.000Z",
            updatedAt: "2026-03-20T15:10:00.000Z",
          },
          {
            id: "review_dispatch_goal_alpha_2",
            notificationId: "review_notification_goal_alpha_method_overdue",
            goalId: "goal_alpha",
            targetType: "suggestion_review" as const,
            targetId: "review_method_candidate_node_root",
            kind: "sla_overdue" as const,
            channel: "im_dm" as const,
            recipient: "producer",
            routeKey: "im://review/producer",
            message: "Root Node 方法候选 / Stage 1 已超过 SLA",
            dedupeKey: "suggestion_review:review_method_candidate_node_root:stage_1:overdue:dispatch:im_dm:im://review/producer",
            status: "pending" as const,
            createdAt: "2026-03-20T15:10:00.000Z",
            updatedAt: "2026-03-20T15:10:00.000Z",
          },
        ],
      },
      notificationDispatchesPath: "E:/goals/goal_alpha/review-notification-dispatches.json",
      notificationDispatchCounts: {
        total: 2,
        byChannel: {
          goal_detail: 1,
          im_dm: 1,
        },
        byStatus: {
          materialized: 1,
          pending: 1,
        },
      },
      crossGoal: {
        goalsScanned: 2,
        markdownPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/cross-goal-flow-patterns.md",
        jsonPath: "C:/Users/admin/.star_sanctuary/goals/cross-goal-flow-patterns.json",
        items: [
          {
            id: "cross_goal_flow_1",
            signature: "events=task_node_claimed>task_node_completed|mode=single_agent|checkpoint=none|risk=low|tools=file_read|mcp=",
            summary: "该流程在 2 个 goal 中共出现 4 次，主要特征为 task_node_claimed -> task_node_completed。",
            goalCount: 2,
            occurrenceCount: 4,
            recommendedAction: "promote_method" as const,
            confidence: 82,
            eventSequence: ["task_node_claimed", "task_node_completed"],
            executionMode: "single_agent" as const,
            riskLevel: "low" as const,
            checkpointMode: "none" as const,
            toolNames: ["file_read"],
            mcpServers: [],
            methods: ["Refactor-Plan.md"],
            skills: [],
            gaps: [],
            goalRefs: [
              {
                goalId: "goal_alpha",
                goalTitle: "Alpha Goal",
                patternId: "flow_pattern_1",
                count: 2,
                confidence: 72,
                nodeRefs: [{ nodeId: "node_root", status: "done" as const, checkpointStatus: "not_required" as const }],
              },
            ],
            recommendations: ["该模式已跨 2 个 goal 重复出现，可进入更高优先级治理。"],
          },
        ],
      },
      reviewStatusCounts: {
        pending_review: 0,
        accepted: 1,
        rejected: 0,
        deferred: 0,
        needs_revision: 0,
      },
      reviewTypeCounts: {
        method_candidate: 1,
        skill_candidate: 0,
        flow_pattern: 0,
      },
      workflowPendingCount: 1,
      workflowOverdueCount: 1,
      actionableReviews: [],
      actionableCheckpoints: [],
      checkpointWorkflowPendingCount: 0,
      checkpointWorkflowOverdueCount: 0,
      overdueReviews: [
        {
          id: "review_method_candidate_node_root",
          goalId: "goal_alpha",
          suggestionType: "method_candidate" as const,
          suggestionId: "method_candidate_node_root",
          title: "Root Node 方法候选",
          summary: "Root node execution summary",
          sourcePath: "E:/goals/goal_alpha/method-candidates.json",
          nodeId: "node_root",
          runId: "run_1",
          status: "pending_review" as const,
          reviewer: "producer",
          evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
          createdAt: "2026-03-20T14:00:00.000Z",
          updatedAt: "2026-03-20T14:00:00.000Z",
        },
      ],
      summary: "reviews=1 | pending=0 | accepted_unpublished=0 | published=1 | cross_goal_matches=1",
      recommendations: ["当前 goal 已命中跨 goal 高频流程：cross_goal_flow_1，可作为 method/skill 治理优先级依据"],
    })),
    listSuggestionReviews: vi.fn(async () => ({
      version: 1 as const,
      syncedAt: "2026-03-20T14:00:00.000Z",
      items: [
        {
          id: "review_method_candidate_node_root",
          goalId: "goal_alpha",
          suggestionType: "method_candidate" as const,
          suggestionId: "method_candidate_node_root",
          title: "Root Node 方法候选",
          summary: "Root node execution summary",
          sourcePath: "E:/goals/goal_alpha/method-candidates.json",
          nodeId: "node_root",
          runId: "run_1",
          status: "pending_review" as const,
          reviewer: "producer",
          evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
          createdAt: "2026-03-20T14:00:00.000Z",
          updatedAt: "2026-03-20T14:00:00.000Z",
        },
      ],
    })),
    configureSuggestionReviewWorkflow: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      reviews: {
        version: 1 as const,
        syncedAt: "2026-03-20T14:03:00.000Z",
        items: [],
      },
      review: {
        id: "review_method_candidate_node_root",
        goalId: "goal_alpha",
        suggestionType: "method_candidate" as const,
        suggestionId: "method_candidate_node_root",
        title: "Root Node 方法候选",
        summary: "Root node execution summary",
        sourcePath: "E:/goals/goal_alpha/method-candidates.json",
        nodeId: "node_root",
        runId: "run_1",
        status: "pending_review" as const,
        reviewer: "tech-lead",
        evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
        workflow: {
          mode: "chain" as const,
          status: "pending_review" as const,
          currentStageIndex: 0,
          configuredAt: "2026-03-20T14:03:00.000Z",
          updatedAt: "2026-03-20T14:03:00.000Z",
          stages: [
            {
              id: "stage_1",
              title: "Chain Stage 1",
              mode: "single" as const,
              reviewers: [{ reviewer: "tech-lead" }],
              minApprovals: 1,
              status: "pending_review" as const,
              votes: [],
              startedAt: "2026-03-20T14:03:00.000Z",
              escalation: { mode: "manual" as const, count: 0, history: [] },
            },
            {
              id: "stage_2",
              title: "Chain Stage 2",
              mode: "single" as const,
              reviewers: [{ reviewer: "producer" }],
              minApprovals: 1,
              status: "pending_review" as const,
              votes: [],
              startedAt: "2026-03-20T14:03:00.000Z",
              escalation: { mode: "manual" as const, count: 0, history: [] },
            },
          ],
        },
        createdAt: "2026-03-20T14:00:00.000Z",
        updatedAt: "2026-03-20T14:03:00.000Z",
      },
    })),
    decideSuggestionReview: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      reviews: {
        version: 1 as const,
        syncedAt: "2026-03-20T14:05:00.000Z",
        items: [
          {
            id: "review_method_candidate_node_root",
            goalId: "goal_alpha",
            suggestionType: "method_candidate" as const,
            suggestionId: "method_candidate_node_root",
            title: "Root Node 方法候选",
            summary: "Root node execution summary",
            sourcePath: "E:/goals/goal_alpha/method-candidates.json",
            nodeId: "node_root",
            runId: "run_1",
            status: "accepted" as const,
            reviewer: "producer",
            decidedBy: "producer",
            note: "Looks reusable",
            decidedAt: "2026-03-20T14:05:00.000Z",
            evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
            createdAt: "2026-03-20T14:00:00.000Z",
            updatedAt: "2026-03-20T14:05:00.000Z",
          },
        ],
      },
      review: {
        id: "review_method_candidate_node_root",
        goalId: "goal_alpha",
        suggestionType: "method_candidate" as const,
        suggestionId: "method_candidate_node_root",
        title: "Root Node 方法候选",
        summary: "Root node execution summary",
        sourcePath: "E:/goals/goal_alpha/method-candidates.json",
        nodeId: "node_root",
        runId: "run_1",
        status: "accepted" as const,
        reviewer: "producer",
        decidedBy: "producer",
        note: "Looks reusable",
        decidedAt: "2026-03-20T14:05:00.000Z",
        evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
        workflow: {
          mode: "chain" as const,
          status: "accepted" as const,
          currentStageIndex: 1,
          configuredAt: "2026-03-20T14:03:00.000Z",
          updatedAt: "2026-03-20T14:05:00.000Z",
          stages: [
            {
              id: "stage_1",
              title: "Chain Stage 1",
              mode: "single" as const,
              reviewers: [{ reviewer: "tech-lead" }],
              minApprovals: 1,
              status: "accepted" as const,
              votes: [{ reviewer: "tech-lead", decision: "accepted" as const, decidedBy: "tech-lead", decidedAt: "2026-03-20T14:04:00.000Z" }],
              startedAt: "2026-03-20T14:03:00.000Z",
              decidedAt: "2026-03-20T14:04:00.000Z",
              escalation: { mode: "manual" as const, count: 0, history: [] },
            },
            {
              id: "stage_2",
              title: "Chain Stage 2",
              mode: "single" as const,
              reviewers: [{ reviewer: "producer" }],
              minApprovals: 1,
              status: "accepted" as const,
              votes: [{ reviewer: "producer", decision: "accepted" as const, decidedBy: "producer", decidedAt: "2026-03-20T14:05:00.000Z" }],
              startedAt: "2026-03-20T14:03:00.000Z",
              decidedAt: "2026-03-20T14:05:00.000Z",
              escalation: { mode: "manual" as const, count: 0, history: [] },
            },
          ],
        },
        createdAt: "2026-03-20T14:00:00.000Z",
        updatedAt: "2026-03-20T14:05:00.000Z",
      },
    })),
    escalateSuggestionReview: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      reviews: {
        version: 1 as const,
        syncedAt: "2026-03-20T14:06:00.000Z",
        items: [],
      },
      review: {
        id: "review_method_candidate_node_root",
        goalId: "goal_alpha",
        suggestionType: "method_candidate" as const,
        suggestionId: "method_candidate_node_root",
        title: "Root Node 方法候选",
        summary: "Root node execution summary",
        sourcePath: "E:/goals/goal_alpha/method-candidates.json",
        nodeId: "node_root",
        runId: "run_1",
        status: "pending_review" as const,
        reviewer: "owner",
        evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
        workflow: {
          mode: "chain" as const,
          status: "pending_review" as const,
          currentStageIndex: 0,
          configuredAt: "2026-03-20T14:03:00.000Z",
          updatedAt: "2026-03-20T14:06:00.000Z",
          stages: [
            {
              id: "stage_1",
              title: "Chain Stage 1",
              mode: "single" as const,
              reviewers: [{ reviewer: "tech-lead" }, { reviewer: "owner" }],
              minApprovals: 1,
              status: "pending_review" as const,
              votes: [],
              startedAt: "2026-03-20T14:03:00.000Z",
              escalation: {
                mode: "manual" as const,
                count: 1,
                lastEscalatedAt: "2026-03-20T14:06:00.000Z",
                escalatedTo: "owner",
                escalatedBy: "producer",
                reason: "SLA timeout",
                history: [{ at: "2026-03-20T14:06:00.000Z", by: "producer", to: "owner", reason: "SLA timeout" }],
              },
            },
          ],
        },
        createdAt: "2026-03-20T14:00:00.000Z",
        updatedAt: "2026-03-20T14:06:00.000Z",
      },
    })),
    scanSuggestionReviewWorkflows: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      reviews: {
        version: 1 as const,
        syncedAt: "2026-03-20T14:08:00.000Z",
        items: [],
      },
      scannedAt: "2026-03-20T14:08:00.000Z",
      scannedCount: 1,
      overdueCount: 1,
      escalatedCount: 1,
      items: [
        {
          goalId: "goal_alpha",
          reviewId: "review_method_candidate_node_root",
          suggestionType: "method_candidate" as const,
          suggestionId: "method_candidate_node_root",
          title: "Root Node 方法候选",
          nodeId: "node_root",
          runId: "run_1",
          workflowMode: "chain" as const,
          stageId: "stage_1",
          stageTitle: "Chain Stage 1",
          stageIndex: 0,
          status: "pending_review" as const,
          reviewer: "owner",
          slaAt: "2026-03-20T13:00:00.000Z",
          overdue: true,
          overdueMinutes: 68,
          escalated: true,
          action: "auto_escalated" as const,
          escalatedTo: "owner",
          scannedAt: "2026-03-20T14:08:00.000Z",
        },
      ],
      summary: "scanned=1 | overdue=1 | escalated=1",
      recommendations: ["已自动升级 1 个 suggestion review，建议尽快由升级 reviewer 处理。"],
    })),
    publishSuggestion: vi.fn(async () => ({
      goal: {
        id: "goal_alpha",
        slug: "alpha",
        title: "Alpha Goal",
        status: "executing",
        goalRoot: "E:/goals/goal_alpha",
        runtimeRoot: "E:/goals/goal_alpha",
        docRoot: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha",
        northstarPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/NORTHSTAR.md",
        tasksPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/tasks.json",
        progressPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/progress.md",
        handoffPath: "C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/handoff.md",
        registryPath: "C:/Users/admin/.star_sanctuary/goals/index.json",
        pathSource: "default",
        activeNodeId: "node_root",
        lastNodeId: "node_root",
        lastRunId: "run_1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      review: {
        id: "review_method_candidate_node_root",
        goalId: "goal_alpha",
        suggestionType: "method_candidate" as const,
        suggestionId: "method_candidate_node_root",
        title: "Root Node 方法候选",
        summary: "Root node execution summary",
        sourcePath: "E:/goals/goal_alpha/method-candidates.json",
        nodeId: "node_root",
        runId: "run_1",
        status: "accepted" as const,
        reviewer: "producer",
        decidedBy: "producer",
        note: "Looks reusable",
        decidedAt: "2026-03-20T14:05:00.000Z",
        evidenceRefs: ["C:/Users/admin/.star_sanctuary/docs/long-tasks/alpha/06-retrospective.md"],
        createdAt: "2026-03-20T14:00:00.000Z",
        updatedAt: "2026-03-20T14:05:00.000Z",
      },
      record: {
        id: "publish_review_method_candidate_node_root",
        goalId: "goal_alpha",
        reviewId: "review_method_candidate_node_root",
        suggestionType: "method_candidate" as const,
        suggestionId: "method_candidate_node_root",
        assetType: "method" as const,
        title: "Root Node 方法候选",
        publishedPath: "C:/Users/admin/.star_sanctuary/methods/method-root-node.md",
        assetKey: "method-root-node.md",
        experienceCandidateId: "goal_exp_goal_alpha_method_candidate_node_root_method",
        reviewer: "producer",
        decidedBy: "producer",
        note: "Looks reusable",
        nodeId: "node_root",
        runId: "run_1",
        sourcePath: "E:/goals/goal_alpha/method-candidates.json",
        publishedAt: "2026-03-20T14:10:00.000Z",
      },
      records: {
        version: 1 as const,
        items: [],
      },
    })),
  },
};

const goalContext: ToolContext = {
  ...baseContext,
  conversationId: "goal:goal_alpha",
};

describe("goal tools", () => {
  it("goal_init should create a goal", async () => {
    const result = await goalInitTool.execute({ title: "Alpha Goal", objective: "Build it" }, baseContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("超长期任务已创建");
    expect(result.output).toContain("Alpha Goal");
  });

  it("goal_list should render goals", async () => {
    const result = await goalListTool.execute({}, baseContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("goal_alpha");
  });

  it("goal_get should infer current goal in goal sessions", async () => {
    const result = await goalGetTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Goal ID: goal_alpha");
    expect(result.output).toContain("Active Conversation:");
  });

  it("goal_resume should resume a goal", async () => {
    const result = await goalResumeTool.execute({ goal_id: "goal_alpha" }, baseContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已恢复超长期任务");
    expect(result.output).toContain("goal:goal_alpha");
  });

  it("goal_handoff_generate should generate a handoff", async () => {
    const result = await goalHandoffGenerateTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 handoff");
    expect(result.output).toContain("Resume Mode: current_node");
  });

  it("goal_retrospect_generate should generate a retrospective", async () => {
    const result = await goalRetrospectGenerateTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 retrospective");
    expect(result.output).toContain("Outcome: in_progress");
    expect(result.output).toContain("06-retrospective.md");
  });

  it("goal_experience_suggest should aggregate experience suggestions", async () => {
    const result = await goalExperienceSuggestTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 goal experience suggestions");
    expect(result.output).toContain("Method Candidates: 1");
    expect(result.output).toContain("Flow Patterns: 1");
  });

  it("goal_method_candidates_generate should generate method candidates", async () => {
    const result = await goalMethodCandidatesGenerateTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 method candidates");
    expect(result.output).toContain("method_candidate_node_root");
    expect(result.output).toContain("07-method-candidates.md");
  });

  it("goal_skill_candidates_generate should generate skill candidates", async () => {
    const result = await goalSkillCandidatesGenerateTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 skill candidates");
    expect(result.output).toContain("skill_candidate_node_root");
    expect(result.output).toContain("08-skill-candidates.md");
  });

  it("goal_flow_patterns_generate should generate flow patterns", async () => {
    const result = await goalFlowPatternsGenerateTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 flow patterns");
    expect(result.output).toContain("flow_pattern_1");
    expect(result.output).toContain("09-flow-patterns.md");
  });

  it("goal_cross_goal_flow_patterns should render aggregated cross-goal patterns", async () => {
    const result = await goalCrossGoalFlowPatternsTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成跨 goal flow patterns");
    expect(result.output).toContain("Goals Scanned: 2");
    expect(result.output).toContain("cross_goal_flow_1");
  });

  it("goal_review_governance_summary should render governance summary", async () => {
    const result = await goalReviewGovernanceSummaryTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 goal review governance 摘要");
    expect(result.output).toContain("Publish Count: 1");
    expect(result.output).toContain("Dispatch Count: total=2");
    expect(result.output).toContain("cross_goal_flow_1");
  });

  it("goal_suggestion_review_list should render suggestion reviews", async () => {
    const result = await goalSuggestionReviewListTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("review_method_candidate_node_root");
    expect(result.output).toContain("method_candidate");
  });

  it("goal_suggestion_review_workflow_set should configure review workflow", async () => {
    const result = await goalSuggestionReviewWorkflowSetTool.execute({
      review_id: "review_method_candidate_node_root",
      mode: "chain",
      reviewers: ["tech-lead", "producer"],
      escalation_mode: "manual",
    }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已配置 suggestion review workflow");
    expect(result.output).toContain("Mode: chain");
    expect(result.output).toContain("Stage: 1/2");
  });

  it("goal_suggestion_review_decide should update suggestion review status", async () => {
    const result = await goalSuggestionReviewDecideTool.execute({
      review_id: "review_method_candidate_node_root",
      decision: "accepted",
      reviewer: "producer",
      decided_by: "producer",
      note: "Looks reusable",
    }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已更新 suggestion review");
    expect(result.output).toContain("Status: accepted");
  });

  it("goal_suggestion_review_escalate should escalate current workflow stage", async () => {
    const result = await goalSuggestionReviewEscalateTool.execute({
      review_id: "review_method_candidate_node_root",
      escalated_by: "producer",
      escalated_to: "owner",
      reason: "SLA timeout",
      force: true,
    }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已执行 suggestion review escalation");
    expect(result.output).toContain("Escalation Count: 1");
    expect(result.output).toContain("Reviewer: owner");
  });

  it("goal_suggestion_review_scan should scan overdue workflows", async () => {
    const result = await goalSuggestionReviewScanTool.execute({
      auto_escalate: true,
    }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已执行 suggestion review workflow SLA scan");
    expect(result.output).toContain("overdue=1");
    expect(result.output).toContain("escalated=1");
  });

  it("goal_suggestion_publish should publish accepted suggestion", async () => {
    const result = await goalSuggestionPublishTool.execute({
      review_id: "review_method_candidate_node_root",
      reviewer: "producer",
      decided_by: "producer",
      note: "Looks reusable",
    }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已发布 suggestion");
    expect(result.output).toContain("Asset Type: method");
    expect(result.output).toContain("method-root-node.md");
  });

  it("task_graph_read should infer current goal and render graph", async () => {
    const result = await taskGraphReadTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Goal ID: goal_alpha");
    expect(result.output).toContain("node_root");
  });

  it("task_graph_create should create a node", async () => {
    const result = await taskGraphCreateTool.execute({ title: "Root Node" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已创建 task graph 节点");
    expect(result.output).toContain("Node ID: node_root");
  });

  it("task_graph_claim should claim a node", async () => {
    const result = await taskGraphClaimTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已认领并启动节点");
    expect(result.output).toContain("Status: in_progress");
  });

  it("goal_checkpoint_list should render checkpoints", async () => {
    const result = await goalCheckpointListTool.execute({}, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("checkpoint_1");
  });

  it("goal_checkpoint_request should request checkpoint", async () => {
    const result = await goalCheckpointRequestTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已发起 checkpoint 请求");
    expect(result.output).toContain("Status: waiting_user");
    expect(result.output).toContain("Reviewer: producer");
  });

  it("goal_checkpoint_approve should approve checkpoint", async () => {
    const result = await goalCheckpointApproveTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已批准 checkpoint");
    expect(result.output).toContain("Status: approved");
  });

  it("goal_checkpoint_reject should reject checkpoint", async () => {
    const result = await goalCheckpointRejectTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已拒绝 checkpoint");
    expect(result.output).toContain("Status: rejected");
  });

  it("goal_checkpoint_expire should expire checkpoint", async () => {
    const result = await goalCheckpointExpireTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已标记 checkpoint 过期");
    expect(result.output).toContain("Status: expired");
  });

  it("goal_checkpoint_reopen should reopen checkpoint", async () => {
    const result = await goalCheckpointReopenTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已重新打开 checkpoint");
    expect(result.output).toContain("Status: waiting_user");
  });

  it("goal_capability_plan should generate a capability plan", async () => {
    const result = await goalCapabilityPlanTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已生成 capabilityPlan");
    expect(result.output).toContain("Execution Mode: multi_agent");
    expect(result.output).toContain("Refactor-Plan.md");
  });

  it("goal_orchestrate should claim node and delegate sub agents", async () => {
    const spawnParallel = vi.fn(async (tasks) => tasks.map(() => ({
      success: true,
      output: "delegated",
      sessionId: "session_1",
    })));
    const context: ToolContext = {
      ...goalContext,
      defaultCwd: "E:/project/star-sanctuary/packages/belldandy-core",
      launchSpec: {
        cwd: "E:/project/star-sanctuary/packages/belldandy-core",
        toolSet: ["file_read", "run_command"],
        permissionMode: "confirm",
        isolationMode: "workspace",
        parentTaskId: "task_goal_parent",
      },
      agentCapabilities: {
        ...goalContext.agentCapabilities,
        spawnParallel,
      },
    };

    const result = await goalOrchestrateTool.execute({ node_id: "node_root", auto_delegate: true }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("节点已 claim 并进入执行态");
    expect(result.output).toContain("coder: success");
    expect(result.output).toContain("Coordinator Plan:");
    expect(result.output).toContain("Coordinator Results:");
    expect(result.output).toContain("Execution Mode: multi_agent");
    expect(result.output).toContain("Status: orchestrated");
    expect(spawnParallel).toHaveBeenCalledWith([
      expect.objectContaining({
        parentConversationId: "goal:goal_alpha",
        channel: "goal",
        cwd: "E:/project/star-sanctuary/packages/belldandy-core",
        toolSet: ["file_read", "run_command"],
        permissionMode: "confirm",
        isolationMode: "workspace",
        parentTaskId: "task_goal_parent",
      }),
    ]);
  });

  it("goal_orchestrate should launch verifier runtime after source delegations are completed", async () => {
    const spawnParallel = vi.fn(async (tasks) => tasks.map(() => ({
      success: true,
      output: "delegated",
      sessionId: "session_src_1",
      taskId: "task_src_1",
      outputPath: "E:/project/star-sanctuary/.tmp/task_src_1/result.md",
    })));
    const spawnSubAgent = vi.fn(async () => ({
      success: true,
      output: "verifier completed",
      sessionId: "session_verify_1",
      taskId: "task_verify_1",
      outputPath: "E:/project/star-sanctuary/.tmp/task_verify_1/result.md",
    }));
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_verify",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "planned" as const,
      executionMode: "multi_agent" as const,
      riskLevel: "medium" as const,
      objective: "Implement and verify Root Node",
      summary: "Need coder execution plus verifier fan-in",
      queryHints: ["verify", "Root Node"],
      reasoning: ["Need explicit verifier handoff after delegation"],
      methods: [{ file: "Refactor-Plan.md", title: "Refactor Plan", score: 20 }],
      skills: [{ name: "find-skills", score: 10 }],
      mcpServers: [{ serverId: "docs", status: "connected" as const, toolCount: 3 }],
      subAgents: [
        {
          agentId: "coder",
          role: "coder" as const,
          objective: "Implement Root Node",
          handoffToVerifier: true,
          catalogDefault: {
            permissionMode: "confirm" as const,
            allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
            maxToolRiskLevel: "high" as const,
            handoffStyle: "summary" as const,
          },
        },
        {
          agentId: "qa",
          role: "verifier" as const,
          objective: "Verify Root Node",
          catalogDefault: {
            permissionMode: "confirm" as const,
            allowedToolFamilies: ["workspace-read", "command-exec", "browser"],
            maxToolRiskLevel: "high" as const,
            handoffStyle: "structured" as const,
          },
        },
      ],
      gaps: [],
      checkpoint: {
        required: false,
        reasons: [],
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    }));

    const context: ToolContext = {
      ...goalContext,
      defaultCwd: "E:/project/star-sanctuary/packages/belldandy-core",
      launchSpec: {
        cwd: "E:/project/star-sanctuary/packages/belldandy-core",
        toolSet: ["file_read", "run_command"],
        permissionMode: "confirm",
        isolationMode: "workspace",
        parentTaskId: "task_goal_parent",
      },
      agentCapabilities: {
        spawnParallel,
        spawnSubAgent,
      },
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
      },
    };

    const result = await goalOrchestrateTool.execute({ node_id: "node_root", auto_delegate: true }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("coder: success");
    expect(result.output).toContain("verifier: success");
    expect(result.output).toContain("Verifier Handoff: completed");
    expect(result.output).toContain("Verifier Result: completed");
    expect(result.output).toContain("recommendation=unknown");
    expect(spawnParallel).toHaveBeenCalledTimes(1);
    expect(spawnParallel).toHaveBeenCalledWith([
      expect.objectContaining({
        agentId: "coder",
        role: "coder",
        allowedToolFamilies: ["workspace-read", "workspace-write", "patch", "command-exec", "memory", "goal-governance"],
        policySummary: expect.stringContaining("permission=confirm"),
      }),
    ]);
    expect(spawnSubAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "qa",
      role: "verifier",
      policySummary: expect.stringContaining("handoff=structured"),
      permissionMode: "confirm",
    }));
    expect(context.goalCapabilities?.saveCapabilityPlan).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      orchestration: expect.objectContaining({
        notes: expect.arrayContaining([
          expect.stringContaining("catalog default -> coder"),
          expect.stringContaining("catalog default -> qa"),
          expect.stringContaining("suggested launch -> coder"),
          expect.stringContaining("suggested launch -> qa"),
        ]),
        verifierResult: expect.objectContaining({
          status: "completed",
          outputPath: "E:/project/star-sanctuary/.tmp/task_verify_1/result.md",
        }),
      }),
    }));
  });

  it("goal_orchestrate should persist failed verifier result asset when verifier runtime fails", async () => {
    const spawnParallel = vi.fn(async (tasks) => tasks.map(() => ({
      success: true,
      output: "delegated",
      sessionId: "session_src_1",
      taskId: "task_src_1",
      outputPath: "E:/project/star-sanctuary/.tmp/task_src_1/result.md",
    })));
    const spawnSubAgent = vi.fn(async () => ({
      success: false,
      output: "Blocked\n- failed verification\n- warning: missing regression",
      error: "verifier crashed",
      sessionId: "session_verify_1",
      taskId: "task_verify_1",
      outputPath: "E:/project/star-sanctuary/.tmp/task_verify_1/result.md",
    }));
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_verify_fail",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "planned" as const,
      executionMode: "multi_agent" as const,
      riskLevel: "medium" as const,
      objective: "Implement and verify Root Node",
      summary: "Need coder execution plus verifier fan-in",
      queryHints: ["verify", "Root Node"],
      reasoning: ["Need explicit verifier handoff after delegation"],
      methods: [{ file: "Refactor-Plan.md", title: "Refactor Plan", score: 20 }],
      skills: [{ name: "find-skills", score: 10 }],
      mcpServers: [{ serverId: "docs", status: "connected" as const, toolCount: 3 }],
      subAgents: [
        { agentId: "coder", role: "coder" as const, objective: "Implement Root Node", handoffToVerifier: true },
        { agentId: "qa", role: "verifier" as const, objective: "Verify Root Node" },
      ],
      gaps: [],
      checkpoint: {
        required: false,
        reasons: [],
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    }));

    const context: ToolContext = {
      ...goalContext,
      defaultCwd: "E:/project/star-sanctuary/packages/belldandy-core",
      launchSpec: {
        cwd: "E:/project/star-sanctuary/packages/belldandy-core",
        toolSet: ["file_read", "run_command"],
        permissionMode: "confirm",
        isolationMode: "workspace",
        parentTaskId: "task_goal_parent",
      },
      agentCapabilities: {
        spawnParallel,
        spawnSubAgent,
      },
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
      },
    };

    const result = await goalOrchestrateTool.execute({ node_id: "node_root", auto_delegate: true }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("verifier: failed");
    expect(result.output).toContain("Verifier Result: failed");
    expect(result.output).toContain("recommendation=blocked");
    expect(context.goalCapabilities?.saveCapabilityPlan).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      orchestration: expect.objectContaining({
        verifierHandoff: expect.objectContaining({
          verifierTaskId: "task_verify_1",
          verifierSessionId: "session_verify_1",
        }),
        verifierResult: expect.objectContaining({
          status: "failed",
          recommendation: "blocked",
          evidenceTaskIds: expect.arrayContaining(["task_verify_1"]),
          findings: expect.arrayContaining([
            expect.objectContaining({
              severity: "high",
            }),
          ]),
        }),
      }),
    }));
  });

  it("goal_orchestrate should auto request checkpoint for high-risk node and skip delegation", async () => {
    const spawnParallel = vi.fn(async (tasks) => tasks.map(() => ({
      success: true,
      output: "delegated",
      sessionId: "session_1",
    })));
    const requestCheckpoint = vi.fn(baseContext.goalCapabilities?.requestCheckpoint);
    const updateTaskNode = vi.fn(baseContext.goalCapabilities?.updateTaskNode);
    const listCheckpoints = vi.fn(async () => ({
      version: 2 as const,
      items: [],
    }));
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_high_risk",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "planned" as const,
      executionMode: "multi_agent" as const,
      riskLevel: "high" as const,
      objective: "Deploy Root Node",
      summary: "Need gated execution",
      queryHints: ["deploy", "Root Node"],
      reasoning: ["Deployment requires approval before execution"],
      methods: [{ file: "Deploy-Checklist.md", title: "Deploy Checklist", score: 30 }],
      skills: [{ name: "find-skills", score: 10 }],
      mcpServers: [{ serverId: "docs", status: "connected" as const, toolCount: 3 }],
      subAgents: [{
        agentId: "coder",
        role: "coder" as const,
        objective: "Implement Root Node",
        catalogDefault: {
          permissionMode: "confirm" as const,
          allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
          maxToolRiskLevel: "high" as const,
          handoffStyle: "summary" as const,
        },
      }],
      gaps: [],
      checkpoint: {
        required: true,
        reasons: ["涉及部署/上线/发布。", "涉及外部系统调用或对外写入。"],
        approvalMode: "strict" as const,
        requiredRequestFields: ["reviewerRole", "slaAt", "note"],
        requiredDecisionFields: ["summary", "note", "decidedBy"],
        suggestedTitle: "High-risk execution checkpoint",
        suggestedNote: "先审批影响范围、回滚方案与验证方式。",
        suggestedReviewerRole: "producer",
        suggestedSlaHours: 12,
        escalationMode: "manual" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    }));

    const context: ToolContext = {
      ...goalContext,
      agentCapabilities: {
        spawnParallel,
      },
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
        listCheckpoints,
        requestCheckpoint,
        updateTaskNode,
      },
    };

    const result = await goalOrchestrateTool.execute({ node_id: "node_root", auto_delegate: true }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已自动发起高风险 checkpoint");
    expect(result.output).toContain("已进入 checkpoint 审批阶段，暂不触发子代理委托");
    expect(result.output).toContain("Verifier Handoff: pending");
    expect(requestCheckpoint).toHaveBeenCalledTimes(1);
    expect(requestCheckpoint).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      reviewerRole: "producer",
      requestedBy: "main-agent",
      note: expect.stringContaining("先审批影响范围、回滚方案与验证方式。"),
    }));
    expect(requestCheckpoint.mock.calls[0]?.[2]?.note).toContain("catalog default");
    expect(updateTaskNode).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      checkpointRequired: true,
      checkpointStatus: "required",
    }));
    expect(spawnParallel).not.toHaveBeenCalled();
  });

  it("goal_orchestrate should persist commander review acceptance gate for commander fan-in", async () => {
    const spawnParallel = vi.fn(async (tasks) => tasks.map((task, index) => ({
      success: true,
      output: `delegated-${index}`,
      sessionId: `session_${index}`,
      taskId: `task_${index}`,
      outputPath: `E:/project/star-sanctuary/.tmp/task_${index}/result.md`,
    })));
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_commander",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "planned" as const,
      executionMode: "multi_agent_parallel" as const,
      governanceMode: "commander" as const,
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      riskLevel: "medium" as const,
      objective: "Implement and fan-in Root Node",
      summary: "Need commander review after delegation",
      queryHints: ["fan-in", "Root Node"],
      reasoning: ["Need explicit commander review after delegation"],
      methods: [],
      skills: [],
      mcpServers: [],
      subAgents: [
        {
          agentId: "coder",
          role: "coder" as const,
          objective: "Implement Root Node",
        },
      ],
      gaps: [],
      checkpoint: {
        required: false,
        reasons: [],
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    }));

    const context: ToolContext = {
      ...goalContext,
      agentCapabilities: {
        spawnParallel,
      },
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
      },
    };

    const result = await goalOrchestrateTool.execute({ node_id: "node_root", auto_delegate: true }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Acceptance Gate: accepted");
    const saveCalls = (context.goalCapabilities?.saveCapabilityPlan as ReturnType<typeof vi.fn>).mock.calls;
    expect(saveCalls.some((call) => call[0] === "goal_alpha"
      && call[1] === "node_root"
      && call[2]?.governanceMode === "commander"
      && call[2]?.executionMode === "multi_agent_parallel"
      && call[2]?.orchestration?.coordinationPlan?.rolePolicy?.fanInStrategy === "commander_review")).toBe(true);
  });

  it("goal_commander_decide should move accepted commander gate into validating", async () => {
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_commander_accept",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "orchestrated" as const,
      executionMode: "multi_agent_parallel" as const,
      governanceMode: "commander" as const,
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      riskLevel: "medium" as const,
      objective: "Implement and fan-in Root Node",
      summary: "Need commander review after delegation",
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
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "pending",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      orchestration: {
        finalApprovalMode: "user_required" as const,
        acceptanceGate: {
          status: "accepted" as const,
          summary: "Commander review fan-in is complete.",
          reasons: [],
          managerActionHint: "Commander review is complete enough to approve.",
        },
      },
    }));
    const markTaskNodeValidating = vi.fn(baseContext.goalCapabilities?.markTaskNodeValidating);
    const saveCapabilityPlan = vi.fn(baseContext.goalCapabilities?.saveCapabilityPlan);
    const context: ToolContext = {
      ...goalContext,
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
        saveCapabilityPlan,
        markTaskNodeValidating,
      },
    };

    const result = await goalCommanderDecideTool.execute({ node_id: "node_root", decision: "accept", summary: "fan-in accepted" }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Decision: accept -> validating");
    expect(result.output).toContain("Acceptance Gate: accepted");
    expect(markTaskNodeValidating).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      summary: "fan-in accepted",
    }));
    expect(saveCapabilityPlan).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      orchestration: expect.objectContaining({
        notes: expect.arrayContaining([
          expect.stringContaining("commander decision=accept"),
        ]),
      }),
    }));
  });

  it("goal_commander_decide should keep commander lane active on rework when auto rework is enabled", async () => {
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_commander_rework",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "orchestrated" as const,
      executionMode: "multi_agent_parallel" as const,
      governanceMode: "commander" as const,
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      riskLevel: "medium" as const,
      objective: "Implement and fan-in Root Node",
      summary: "Need commander review after delegation",
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
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "pending",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      orchestration: {
        finalApprovalMode: "user_required" as const,
        reworkRevisionCount: 0,
        acceptanceGate: {
          status: "rejected" as const,
          summary: "Commander review rejected this capability plan.",
          reasons: ["failed delegation"],
          rejectionConfidence: "high" as const,
          managerActionHint: "Issue a rework order.",
        },
        delegationResults: [
          {
            agentId: "coder",
            status: "failed" as const,
            summary: "needs fix",
          },
        ],
      },
    }));
    const claimTaskNode = vi.fn(baseContext.goalCapabilities?.claimTaskNode);
    const saveCapabilityPlan = vi.fn(baseContext.goalCapabilities?.saveCapabilityPlan);
    const context: ToolContext = {
      ...goalContext,
      readEnv: (name) => name === "BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED" ? "true" : undefined,
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
        claimTaskNode,
        saveCapabilityPlan,
      },
    };

    const result = await goalCommanderDecideTool.execute({ node_id: "node_root", decision: "rework", note: "fix failed lane" }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Decision: rework -> in_progress");
    expect(result.output).toContain("Auto Rework: enabled");
    expect(result.output).toContain("Rework Revision: 1");
    expect(result.output).toContain("Rework Targets: coder");
    expect(claimTaskNode).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      summary: "Commander review rejected this capability plan.",
    }));
    expect(saveCapabilityPlan).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      orchestration: expect.objectContaining({
        reworkTargetAgentIds: ["coder"],
        reworkContext: expect.objectContaining({
          quickSummary: "fix failed lane",
        }),
      }),
    }));
  });

  it("goal_commander_decide should fall back to blocked rework when auto rework is disabled", async () => {
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_commander_rework_blocked",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "orchestrated" as const,
      executionMode: "multi_agent_parallel" as const,
      governanceMode: "commander" as const,
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      riskLevel: "medium" as const,
      objective: "Implement and fan-in Root Node",
      summary: "Need commander review after delegation",
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
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "pending",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      orchestration: {
        finalApprovalMode: "user_required" as const,
        reworkRevisionCount: 0,
        acceptanceGate: {
          status: "rejected" as const,
          summary: "Commander review rejected this capability plan.",
          reasons: ["failed delegation"],
          rejectionConfidence: "high" as const,
          managerActionHint: "Issue a rework order.",
        },
        delegationResults: [
          {
            agentId: "coder",
            status: "failed" as const,
            summary: "needs fix",
          },
        ],
      },
    }));
    const blockTaskNode = vi.fn(baseContext.goalCapabilities?.blockTaskNode);
    const claimTaskNode = vi.fn(baseContext.goalCapabilities?.claimTaskNode);
    const context: ToolContext = {
      ...goalContext,
      readEnv: () => undefined,
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
        blockTaskNode,
        claimTaskNode,
      },
    };

    const result = await goalCommanderDecideTool.execute({ node_id: "node_root", decision: "rework", note: "fix failed lane" }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Decision: rework -> blocked");
    expect(result.output).toContain("Auto Rework: disabled");
    expect(result.output).toContain("Rework Targets: coder");
    expect(blockTaskNode).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      blockReason: expect.stringContaining("Rework Revision 1"),
    }));
    expect(claimTaskNode).not.toHaveBeenCalled();
  });

  it("goal_commander_decide should escalate into validating when user final approval is required", async () => {
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_commander_escalate",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "orchestrated" as const,
      executionMode: "multi_agent_parallel" as const,
      governanceMode: "commander" as const,
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      riskLevel: "medium" as const,
      objective: "Implement and fan-in Root Node",
      summary: "Need commander review after delegation",
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
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "pending",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      orchestration: {
        finalApprovalMode: "user_required" as const,
        acceptanceGate: {
          status: "accepted" as const,
          summary: "Commander review fan-in is complete.",
          reasons: [],
          managerActionHint: "Commander review is complete enough to approve.",
        },
      },
    }));
    const markTaskNodeValidating = vi.fn(baseContext.goalCapabilities?.markTaskNodeValidating);
    const completeTaskNode = vi.fn(baseContext.goalCapabilities?.completeTaskNode);
    const context: ToolContext = {
      ...goalContext,
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
        markTaskNodeValidating,
        completeTaskNode,
      },
    };

    const result = await goalCommanderDecideTool.execute({ node_id: "node_root", decision: "escalate", summary: "need user sign-off" }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Decision: escalate -> validating");
    expect(result.output).toContain("Final Approval: user_required");
    expect(markTaskNodeValidating).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      summary: "need user sign-off",
    }));
    expect(completeTaskNode).not.toHaveBeenCalled();
  });

  it("goal_commander_decide should auto complete escalate when plan default disables user final approval", async () => {
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_commander_escalate_auto",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "orchestrated" as const,
      executionMode: "multi_agent_parallel" as const,
      governanceMode: "commander" as const,
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      riskLevel: "medium" as const,
      objective: "Implement and fan-in Root Node",
      summary: "Need commander review after delegation",
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
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "pending",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      orchestration: {
        finalApprovalMode: "agent_auto_complete" as const,
        acceptanceGate: {
          status: "accepted" as const,
          summary: "Commander review fan-in is complete.",
          reasons: [],
          managerActionHint: "Commander review is complete enough to approve.",
        },
      },
    }));
    const markTaskNodeValidating = vi.fn(baseContext.goalCapabilities?.markTaskNodeValidating);
    const completeTaskNode = vi.fn(baseContext.goalCapabilities?.completeTaskNode);
    const context: ToolContext = {
      ...goalContext,
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
        markTaskNodeValidating,
        completeTaskNode,
      },
    };

    const result = await goalCommanderDecideTool.execute({
      node_id: "node_root",
      decision: "escalate",
      summary: "auto close this run",
    }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Decision: escalate -> done");
    expect(result.output).toContain("Final Approval: agent_auto_complete");
    expect(completeTaskNode).toHaveBeenCalledWith("goal_alpha", "node_root", expect.objectContaining({
      summary: "auto close this run",
    }));
    expect(markTaskNodeValidating).not.toHaveBeenCalled();
  });

  it("goal_commander_decide should let explicit require_user_approval override the plan default", async () => {
    const getCapabilityPlan = vi.fn(async () => ({
      id: "plan_commander_escalate_override",
      goalId: "goal_alpha",
      nodeId: "node_root",
      status: "orchestrated" as const,
      executionMode: "multi_agent_parallel" as const,
      governanceMode: "commander" as const,
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      riskLevel: "medium" as const,
      objective: "Implement and fan-in Root Node",
      summary: "Need commander review after delegation",
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
        approvalMode: "none" as const,
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none" as const,
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending" as const,
        summary: "pending",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      orchestration: {
        finalApprovalMode: "agent_auto_complete" as const,
        acceptanceGate: {
          status: "accepted" as const,
          summary: "Commander review fan-in is complete.",
          reasons: [],
          managerActionHint: "Commander review is complete enough to approve.",
        },
      },
    }));
    const markTaskNodeValidating = vi.fn(baseContext.goalCapabilities?.markTaskNodeValidating);
    const completeTaskNode = vi.fn(baseContext.goalCapabilities?.completeTaskNode);
    const context: ToolContext = {
      ...goalContext,
      goalCapabilities: {
        ...goalContext.goalCapabilities,
        getCapabilityPlan,
        markTaskNodeValidating,
        completeTaskNode,
      },
    };

    const result = await goalCommanderDecideTool.execute({
      node_id: "node_root",
      decision: "escalate",
      summary: "override to user approval",
      require_user_approval: true,
    }, context);
    expect(result.success).toBe(true);
    expect(result.output).toContain("Decision: escalate -> validating");
    expect(markTaskNodeValidating).toHaveBeenCalled();
    expect(completeTaskNode).not.toHaveBeenCalled();
  });

  it("task_graph_pending_review should move node into pending_review", async () => {
    const result = await taskGraphPendingReviewTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("pending_review");
  });

  it("task_graph_validating should move node into validating", async () => {
    const result = await taskGraphValidatingTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("validating");
  });

  it("task_graph_fail should mark node failed", async () => {
    const result = await taskGraphFailTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("failed");
  });

  it("task_graph_skip should mark node skipped", async () => {
    const result = await taskGraphSkipTool.execute({ node_id: "node_root" }, goalContext);
    expect(result.success).toBe(true);
    expect(result.output).toContain("skipped");
  });
});
