import type {
  GoalStatus,
  GoalTaskCheckpointStatus,
  GoalTaskNodeStatus,
} from "../goals/types.js";
import type { SubTaskKind, SubTaskStatus } from "../task-runtime.js";
import type { WorkflowJournalStatus } from "../workflow-journal.js";
import type { CodingContextBinding } from "./contracts.js";

export type CodingRunAdapterStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type GoalCodingRunView = {
  source: "goal";
  status: CodingRunAdapterStatus;
  recovery: { operation: "goal.resume" };
  binding: CodingContextBinding;
  evidence: {
    goalStatus: GoalStatus;
    nodeStatus?: GoalTaskNodeStatus;
    artifactCount?: number;
    checkpointRequired?: boolean;
    checkpointStatus?: GoalTaskCheckpointStatus;
  };
};

export type WorkflowJournalCodingRunView = {
  source: "workflow";
  status: CodingRunAdapterStatus;
  recovery: { operation: "workflow.resume" };
  binding: CodingContextBinding;
  evidence: {
    journalStatus: WorkflowJournalStatus;
    tokenCount: number | null;
    cacheHitCount: number;
    hasResult: boolean;
    hasResultJson: boolean;
    hasError: boolean;
    createdAtMs: number;
    completedAtMs: number | null;
  };
};

export type SubtaskCodingRunView = {
  source: "subtask";
  status: CodingRunAdapterStatus;
  recovery: { operation: "subtask.resume" };
  binding: CodingContextBinding;
  evidence: {
    taskStatus: SubTaskStatus;
    taskKind: SubTaskKind;
    role?: "default" | "commander" | "coder" | "researcher" | "verifier";
    progressPhase: SubTaskStatus;
    archived: boolean;
    hasOutputArtifact: boolean;
    hasScratchArtifact: boolean;
    hasReviewArtifact: boolean;
    hasManagedWorktree: boolean;
    bridgeSessionState?: "active" | "closed" | "runtime-lost" | "orphaned";
  };
};

export type CodingRunSourceView =
  | GoalCodingRunView
  | WorkflowJournalCodingRunView
  | SubtaskCodingRunView;

type GoalCodingRunViewInput = {
  goal: {
    id: string;
    status: GoalStatus;
    activeConversationId?: string;
    lastRunId?: string;
  };
  node?: {
    id: string;
    status: GoalTaskNodeStatus;
    artifacts: readonly unknown[];
    checkpointRequired: boolean;
    checkpointStatus: GoalTaskCheckpointStatus;
    lastRunId?: string;
  };
  runId?: string;
};

type WorkflowJournalCodingRunViewInput = {
  /** 由 WorkflowRuntime 为单次执行生成，不能使用可复用的 Journal record id 代替。 */
  workflowRunId: string;
  record: {
    id: string;
    journalId: string;
    status: WorkflowJournalStatus;
    tokenCount: number | null;
    cacheHitCount: number;
    leaseOwnerId: string | null;
    leaseExpiresAt: number | null;
    createdAt: number;
    completedAt: number | null;
    result: string | null;
    resultJson: string | null;
    error: string | null;
  };
};

type SubtaskCodingRunViewInput = {
  record: {
    id: string;
    sessionId?: string;
    parentConversationId: string;
    kind: SubTaskKind;
    status: SubTaskStatus;
    progress: { phase: SubTaskStatus };
    archivedAt?: number;
    outputPath?: string;
    scratchPath?: string;
    reviewPath?: string;
    bridgeSessionRuntime?: { state: "active" | "closed" | "runtime-lost" | "orphaned" };
    launchSpec: {
      role?: "default" | "commander" | "coder" | "researcher" | "verifier";
      worktreePath?: string;
    };
  };
};

/**
 * 将 Goal 的既有状态投影为编程运行视图；不会推进 Goal 或 node 状态。
 */
export function createGoalCodingRunView(input: GoalCodingRunViewInput): GoalCodingRunView {
  const goalId = requireIdentifier(input.goal.id, "Goal id");
  const nodeId = input.node ? requireIdentifier(input.node.id, "Goal node id") : undefined;
  const agentRunId = firstIdentifier(input.runId, input.node?.lastRunId, input.goal.lastRunId);
  if (!agentRunId) {
    throw new Error(`Goal "${goalId}" has no observed coding run id.`);
  }

  return {
    source: "goal",
    status: input.node ? mapGoalNodeStatus(input.node.status) : mapGoalStatus(input.goal.status),
    recovery: { operation: "goal.resume" },
    binding: {
      agentRunId,
      ...(firstIdentifier(input.goal.activeConversationId)
        ? { conversationId: firstIdentifier(input.goal.activeConversationId) }
        : {}),
      goal: {
        goalId,
        ...(nodeId ? { nodeId } : {}),
      },
    },
    evidence: {
      goalStatus: input.goal.status,
      ...(input.node
        ? {
            nodeStatus: input.node.status,
            artifactCount: input.node.artifacts.length,
            checkpointRequired: input.node.checkpointRequired,
            checkpointStatus: input.node.checkpointStatus,
          }
        : {}),
    },
  };
}

/**
 * Workflow Journal 只提供可诊断的状态摘要，不暴露 prompt、结果或错误正文。
 */
export function createWorkflowJournalCodingRunView(
  input: WorkflowJournalCodingRunViewInput,
): WorkflowJournalCodingRunView {
  const workflowRunId = requireIdentifier(input.workflowRunId, "Workflow runtime run id");
  const journalId = requireIdentifier(input.record.journalId, "Workflow Journal id");

  return {
    source: "workflow",
    status: mapWorkflowStatus(input.record.status, input.record.leaseOwnerId, input.record.leaseExpiresAt),
    recovery: { operation: "workflow.resume" },
    binding: {
      agentRunId: workflowRunId,
      workflow: {
        journalId,
        workflowRunId,
      },
    },
    evidence: {
      journalStatus: input.record.status,
      tokenCount: input.record.tokenCount,
      cacheHitCount: Math.max(0, Math.trunc(input.record.cacheHitCount)),
      hasResult: input.record.result !== null,
      hasResultJson: input.record.resultJson !== null,
      hasError: input.record.error !== null,
      createdAtMs: Math.max(0, Math.trunc(input.record.createdAt)),
      completedAtMs: input.record.completedAt === null
        ? null
        : Math.max(0, Math.trunc(input.record.completedAt)),
    },
  };
}

/**
 * Commander/Subtask 的运行视图保留 taskId 与 agentRunId 的独立含义，不输出路径或正文。
 */
export function createSubtaskCodingRunView(input: SubtaskCodingRunViewInput): SubtaskCodingRunView {
  const taskId = requireIdentifier(input.record.id, "Subtask id");
  const agentRunId = firstIdentifier(input.record.sessionId) ?? taskId;
  const conversationId = firstIdentifier(input.record.parentConversationId);
  const bridgeSessionState = input.record.bridgeSessionRuntime?.state;

  return {
    source: "subtask",
    status: mapSubtaskStatus(input.record.status, bridgeSessionState),
    recovery: { operation: "subtask.resume" },
    binding: {
      agentRunId,
      ...(conversationId ? { conversationId } : {}),
      subtask: { taskId },
    },
    evidence: {
      taskStatus: input.record.status,
      taskKind: input.record.kind,
      ...(input.record.launchSpec.role ? { role: input.record.launchSpec.role } : {}),
      progressPhase: input.record.progress.phase,
      archived: input.record.archivedAt !== undefined,
      hasOutputArtifact: Boolean(firstIdentifier(input.record.outputPath)),
      hasScratchArtifact: Boolean(firstIdentifier(input.record.scratchPath)),
      hasReviewArtifact: Boolean(firstIdentifier(input.record.reviewPath)),
      hasManagedWorktree: Boolean(firstIdentifier(input.record.launchSpec.worktreePath)),
      ...(bridgeSessionState ? { bridgeSessionState } : {}),
    },
  };
}

function mapGoalStatus(status: GoalStatus): CodingRunAdapterStatus {
  if (status === "executing") return "running";
  if (status === "pending_approval" || status === "reviewing") return "awaiting_review";
  if (status === "blocked") return "blocked";
  if (status === "completed") return "completed";
  if (status === "archived") return "cancelled";
  if (status === "paused") return "interrupted";
  return "queued";
}

function mapGoalNodeStatus(status: GoalTaskNodeStatus): CodingRunAdapterStatus {
  if (status === "in_progress") return "running";
  if (status === "pending_review" || status === "validating") return "awaiting_review";
  if (status === "blocked") return "blocked";
  if (status === "done") return "completed";
  if (status === "failed") return "failed";
  if (status === "skipped") return "cancelled";
  return "queued";
}

function mapWorkflowStatus(
  status: WorkflowJournalStatus,
  leaseOwnerId: string | null,
  leaseExpiresAt: number | null,
): CodingRunAdapterStatus {
  if (status === "done") return "completed";
  if (status === "error") return "failed";
  if (status === "skipped") return "cancelled";
  return firstIdentifier(leaseOwnerId) && typeof leaseExpiresAt === "number" && leaseExpiresAt > 0
    ? "running"
    : "queued";
}

function mapSubtaskStatus(
  status: SubTaskStatus,
  bridgeSessionState: "active" | "closed" | "runtime-lost" | "orphaned" | undefined,
): CodingRunAdapterStatus {
  if (bridgeSessionState === "runtime-lost" || bridgeSessionState === "orphaned") {
    return "interrupted";
  }
  if (status === "running") return "running";
  if (status === "done") return "completed";
  if (status === "error" || status === "timeout") return "failed";
  if (status === "stopped") return "cancelled";
  return "queued";
}

function firstIdentifier(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = firstIdentifier(value);
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return normalized;
}
