import type {
  GoalStatus,
  GoalTaskCheckpointStatus,
  GoalTaskNodeStatus,
} from "../goals/types.js";
import type { SubTaskKind, SubTaskStatus } from "../task-runtime.js";
import type { WorkflowJournalStatus } from "../workflow-journal.js";
import type { CodingContextBinding } from "./contracts.js";
import type { CodingRunReconciliation } from "./reconciliation-journal.js";

export type CodingRunAdapterStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ConversationCodingRunView = {
  source: "conversation";
  status: CodingRunAdapterStatus;
  recovery: { operation: "conversation.continue" };
  binding: CodingContextBinding & { conversationId: string };
  evidence: {
    registryState: "running" | "stop_requested" | "stopped";
    agentId?: string;
    startedAtMs: number;
    stopRequestedAtMs?: number;
    stoppedAtMs?: number;
    hasStopReason: boolean;
  };
};

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

export type WorkflowRuntimeCodingRunView = {
  source: "workflow";
  status: CodingRunAdapterStatus;
  recovery: { operation: "workflow.resume" };
  binding: CodingContextBinding;
  evidence: {
    runtimeStatus: "running" | "stopping" | "partial" | "done" | "error" | "budget_exceeded";
    stopRequested: boolean;
    total: number;
    pending: number;
    done: number;
    errors: number;
    skipped: number;
    totalTokens: number;
    cacheHits: number;
    hasError: boolean;
  };
};

export type RuntimeLostCodingRunView = {
  source: "conversation" | "workflow";
  status: "interrupted";
  recovery: { operation: "conversation.continue" | "workflow.resume" };
  binding: CodingContextBinding;
  evidence: {
    runtimeState: "lost";
    lastObservedState: "active";
    startedAtMs: number;
    lastObservedAtMs: number;
    reconciliation?: CodingRunReconciliation;
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
    runtimeState?: "lost";
    previousTaskStatus?: "pending" | "running";
    mutationReplay?: "forbidden";
  };
};

export type CodingRunSourceView =
  | ConversationCodingRunView
  | GoalCodingRunView
  | WorkflowJournalCodingRunView
  | WorkflowRuntimeCodingRunView
  | RuntimeLostCodingRunView
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

type ConversationCodingRunViewInput = {
  handle: {
    conversationId: string;
    runId: string;
    agentId?: string;
    startedAt: number;
    state: "running" | "stop_requested" | "stopped";
    stopRequestedAt?: number;
    stoppedAt?: number;
    stopReason?: string;
    stop: (reason?: string) => boolean | Promise<boolean>;
  };
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

type WorkflowRuntimeCodingRunViewInput = {
  status: {
    workflowRunId: string;
    journalId: string;
    status: "running" | "stopping" | "partial" | "done" | "error" | "budget_exceeded";
    stopRequested?: boolean;
    stats: {
      total: number;
      pending: number;
      done: number;
      errors: number;
      skipped: number;
      totalTokens: number;
      cacheHits: number;
    };
    error?: string;
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
    recovery?: {
      state: "runtime_lost";
      previousStatus: "pending" | "running";
      detectedAt: number;
      mutationReplay: "forbidden";
    };
    launchSpec: {
      role?: "default" | "commander" | "coder" | "researcher" | "verifier";
      worktreePath?: string;
    };
  };
};

/**
 * ConversationRunRegistry 是 active Conversation 的唯一 owner；投影不暴露 stop callback 或原因正文。
 */
export function createConversationCodingRunView(
  input: ConversationCodingRunViewInput,
): ConversationCodingRunView {
  const conversationId = requireIdentifier(input.handle.conversationId, "Conversation id");
  const agentRunId = requireIdentifier(input.handle.runId, "Conversation run id");
  return {
    source: "conversation",
    status: input.handle.state === "stopped" ? "cancelled" : "running",
    recovery: { operation: "conversation.continue" },
    binding: { agentRunId, conversationId },
    evidence: {
      registryState: input.handle.state,
      ...(firstIdentifier(input.handle.agentId) ? { agentId: firstIdentifier(input.handle.agentId) } : {}),
      startedAtMs: toTimestamp(input.handle.startedAt),
      ...(typeof input.handle.stopRequestedAt === "number"
        ? { stopRequestedAtMs: toTimestamp(input.handle.stopRequestedAt) }
        : {}),
      ...(typeof input.handle.stoppedAt === "number"
        ? { stoppedAtMs: toTimestamp(input.handle.stoppedAt) }
        : {}),
      hasStopReason: Boolean(firstIdentifier(input.handle.stopReason)),
    },
  };
}

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

/** Active Workflow runtime projection; the runtime remains the execution-state owner. */
export function createWorkflowRuntimeCodingRunView(
  input: WorkflowRuntimeCodingRunViewInput,
): WorkflowRuntimeCodingRunView {
  const workflowRunId = requireIdentifier(input.status.workflowRunId, "Workflow runtime run id");
  const journalId = requireIdentifier(input.status.journalId, "Workflow Journal id");
  return {
    source: "workflow",
    status: mapWorkflowRuntimeStatus(input.status.status),
    recovery: { operation: "workflow.resume" },
    binding: {
      agentRunId: workflowRunId,
      workflow: { journalId, workflowRunId },
    },
    evidence: {
      runtimeStatus: input.status.status,
      stopRequested: input.status.stopRequested === true,
      total: toCount(input.status.stats.total),
      pending: toCount(input.status.stats.pending),
      done: toCount(input.status.stats.done),
      errors: toCount(input.status.stats.errors),
      skipped: toCount(input.status.stats.skipped),
      totalTokens: toCount(input.status.stats.totalTokens),
      cacheHits: toCount(input.status.stats.cacheHits),
      hasError: Boolean(firstIdentifier(input.status.error)),
    },
  };
}

/** Persisted marker projection used only when the previous runtime owner is no longer alive. */
export function createRuntimeLostCodingRunView(input: {
  source: "conversation" | "workflow";
  binding: CodingContextBinding;
  startedAtMs: number;
  updatedAtMs: number;
  reconciliation?: CodingRunReconciliation;
}): RuntimeLostCodingRunView {
  const agentRunId = requireIdentifier(input.binding.agentRunId, "Agent run id");
  let binding: CodingContextBinding;
  if (input.source === "conversation") {
    binding = {
      agentRunId,
      conversationId: requireIdentifier(input.binding.conversationId ?? "", "Conversation id"),
    };
  } else {
    const journalId = requireIdentifier(input.binding.workflow?.journalId ?? "", "Workflow Journal id");
    const workflowRunId = requireIdentifier(input.binding.workflow?.workflowRunId ?? "", "Workflow runtime run id");
    if (agentRunId !== workflowRunId) {
      throw new Error("Workflow agent run id must match the runtime run id.");
    }
    binding = {
      agentRunId,
      workflow: { journalId, workflowRunId },
    };
  }
  return {
    source: input.source,
    status: "interrupted",
    recovery: { operation: input.source === "conversation" ? "conversation.continue" : "workflow.resume" },
    binding,
    evidence: {
      runtimeState: "lost",
      lastObservedState: "active",
      startedAtMs: toTimestamp(input.startedAtMs),
      lastObservedAtMs: toTimestamp(input.updatedAtMs),
      ...(input.reconciliation ? { reconciliation: input.reconciliation } : {}),
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
      ...(input.record.recovery?.state === "runtime_lost"
        ? {
          runtimeState: "lost" as const,
          previousTaskStatus: input.record.recovery.previousStatus,
          mutationReplay: input.record.recovery.mutationReplay,
        }
        : {}),
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

function mapWorkflowRuntimeStatus(
  status: WorkflowRuntimeCodingRunViewInput["status"]["status"],
): CodingRunAdapterStatus {
  if (status === "running" || status === "stopping") return "running";
  if (status === "done") return "completed";
  if (status === "partial") return "interrupted";
  return "failed";
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
  if (status === "interrupted") return "interrupted";
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

function toTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function toCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
