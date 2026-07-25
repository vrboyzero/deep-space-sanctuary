import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import {
  isRunControlV1,
  toSafeCodingRunErrorMessage,
  type CodingContextBinding,
  type RunControl,
} from "../coding-run/contracts.js";
import type {
  PendingToolPermissionResponse,
  PendingToolPermissionResponseResult,
} from "../coding-run/pending-tool-permission-runtime.js";

type GoalControlRecord = {
  id: string;
  lastRunId?: string;
  activeNodeId?: string;
};

type SubtaskControlRecord = {
  id: string;
  sessionId?: string;
};

type ConversationRunControlResult = {
  accepted: boolean;
  runId?: string;
  state: "stop_requested" | "not_found" | "run_mismatch";
};

type WorkflowRunControlStatus = {
  workflowRunId: string;
  journalId: string;
  status: string;
  stopRequested?: boolean;
};

type CodingRunMethodContext = {
  conversationRunRegistry?: {
    get: (conversationId: string) => { runId: string } | undefined;
    requestStop: (input: {
      conversationId: string;
      runId: string;
      reason?: string;
    }) => Promise<ConversationRunControlResult>;
  };
  goalManager?: {
    getGoal: (goalId: string) => Promise<GoalControlRecord | null>;
    resumeGoal: (
      goalId: string,
      nodeId?: string,
      replay?: { checkpointId?: string },
    ) => Promise<{ conversationId: string; runId?: string }>;
    pauseGoal: (goalId: string) => Promise<unknown>;
  };
  subTaskRuntimeStore?: {
    getTask: (taskId: string) => Promise<SubtaskControlRecord | undefined>;
  };
  resumeSubTask?: (
    taskId: string,
    message?: string,
    options?: { idempotencyKey?: string },
  ) => Promise<SubtaskControlRecord | undefined>;
  stopSubTask?: (
    taskId: string,
    reason?: string,
    options?: { idempotencyKey?: string },
  ) => Promise<SubtaskControlRecord | undefined>;
  workflowRuntime?: {
    getStatusByRunId?: (workflowRunId: string) => WorkflowRunControlStatus | null;
    stopRun?: (journalId: string, workflowRunId: string, reason?: string) => Promise<boolean>;
  };
  pendingToolPermissionRuntime?: {
    respond: (input: PendingToolPermissionResponse) => PendingToolPermissionResponseResult;
  };
};

/**
 * 只把已验证的来源控制映射到既有领域 runtime；未具备同等绑定验证的控制一律 fail closed。
 */
export async function handleCodingRunMethod(
  req: GatewayReqFrame,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  const control = readRunControl(req.params);
  if (!control) {
    return failure(req.id, "invalid_request", "control must be a valid RunControl v1 object.");
  }

  try {
    switch (control.operation) {
      case "cancel":
        return await cancelConversation(req.id, control, ctx);
      case "goal.resume":
        return await resumeGoal(req.id, control, ctx);
      case "goal.pause":
        return await pauseGoal(req.id, control, ctx);
      case "subtask.resume":
        return await resumeSubtask(req.id, control, ctx);
      case "subtask.cancel":
        return await cancelSubtask(req.id, control, ctx);
      case "workflow.cancel":
        return await cancelWorkflow(req.id, control, ctx);
      case "permission.respond":
        return respondToToolPermission(req.id, control, ctx);
      default:
        return failure(
          req.id,
          "not_available",
          `Control operation "${control.operation}" has no Gateway source verifier yet.`,
        );
    }
  } catch (error) {
    return failure(req.id, "control_failed", toSafeCodingRunErrorMessage(error));
  }
}

function respondToToolPermission(
  requestId: string,
  control: Extract<RunControl, { operation: "permission.respond" }>,
  ctx: CodingRunMethodContext,
): GatewayResFrame {
  if (!ctx.pendingToolPermissionRuntime) {
    return failure(requestId, "not_available", "Pending tool permission runtime is unavailable.");
  }
  const result = ctx.pendingToolPermissionRuntime.respond({
    agentRunId: control.binding.agentRunId,
    ...(control.binding.worktreeId ? { worktreeId: control.binding.worktreeId } : {}),
    toolCallId: control.toolCallId,
    decision: control.decision,
  });
  if (!result.ok) {
    return failure(requestId, result.code, "Tool permission request no longer matches the active worker.");
  }
  return success(requestId, {
    accepted: true,
    ...(result.alreadyResolved ? { alreadyResolved: true } : {}),
    operation: control.operation,
    binding: {
      agentRunId: control.binding.agentRunId,
      ...(control.binding.worktreeId ? { worktreeId: control.binding.worktreeId } : {}),
    },
  });
}

async function cancelConversation(
  requestId: string,
  control: Extract<RunControl, { operation: "cancel" }>,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.conversationRunRegistry) {
    return failure(requestId, "not_available", "Conversation run registry is unavailable.");
  }
  const current = ctx.conversationRunRegistry.get(control.binding.conversationId);
  if (!current || current.runId !== control.binding.agentRunId) {
    return failure(requestId, "run_mismatch", "Conversation run binding no longer matches the active Conversation run.");
  }
  const result = await ctx.conversationRunRegistry.requestStop({
    conversationId: control.binding.conversationId,
    runId: control.binding.agentRunId,
    ...(control.reason ? { reason: control.reason } : {}),
  });
  if (!result.accepted || result.runId !== control.binding.agentRunId) {
    return failure(requestId, result.state === "run_mismatch" ? "run_mismatch" : "not_found", "Conversation run is no longer stoppable.");
  }
  return success(requestId, {
    accepted: true,
    operation: control.operation,
    binding: { ...control.binding },
  });
}

async function resumeGoal(
  requestId: string,
  control: Extract<RunControl, { operation: "goal.resume" }>,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.goalManager) return failure(requestId, "not_available", "Goal manager is unavailable.");
  const current = await ctx.goalManager.getGoal(control.binding.goal.goalId);
  const mismatch = getGoalBindingMismatch(current, control.binding);
  if (mismatch) return failure(requestId, "run_mismatch", mismatch);

  const result = await ctx.goalManager.resumeGoal(
    control.binding.goal.goalId,
    control.binding.goal.nodeId,
    control.checkpointId ? { checkpointId: control.checkpointId } : undefined,
  );
  return success(requestId, {
    accepted: true,
    operation: control.operation,
    binding: {
      agentRunId: result.runId ?? control.binding.agentRunId,
      conversationId: result.conversationId,
      goal: { ...control.binding.goal },
    },
  });
}

async function pauseGoal(
  requestId: string,
  control: Extract<RunControl, { operation: "goal.pause" }>,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.goalManager) return failure(requestId, "not_available", "Goal manager is unavailable.");
  const current = await ctx.goalManager.getGoal(control.binding.goal.goalId);
  const mismatch = getGoalBindingMismatch(current, control.binding);
  if (mismatch) return failure(requestId, "run_mismatch", mismatch);

  await ctx.goalManager.pauseGoal(control.binding.goal.goalId);
  return success(requestId, {
    accepted: true,
    operation: control.operation,
    binding: cloneGoalBinding(control.binding),
  });
}

async function resumeSubtask(
  requestId: string,
  control: Extract<RunControl, { operation: "subtask.resume" }>,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.subTaskRuntimeStore || !ctx.resumeSubTask) {
    return failure(requestId, "not_available", "Subtask resume controller is unavailable.");
  }
  const current = await ctx.subTaskRuntimeStore.getTask(control.binding.subtask.taskId);
  const mismatch = getSubtaskBindingMismatch(current, control.binding);
  if (mismatch) return failure(requestId, "run_mismatch", mismatch);

  const record = await ctx.resumeSubTask(
    control.binding.subtask.taskId,
    control.message,
    { idempotencyKey: `coding-run:${control.operation}:${control.binding.agentRunId}` },
  );
  if (!record) return failure(requestId, "not_found", "Subtask was not found while resuming.");
  return success(requestId, {
    accepted: true,
    operation: control.operation,
    binding: createSubtaskBinding(record, control.binding.subtask.taskId),
  });
}

async function cancelSubtask(
  requestId: string,
  control: Extract<RunControl, { operation: "subtask.cancel" }>,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.subTaskRuntimeStore || !ctx.stopSubTask) {
    return failure(requestId, "not_available", "Subtask stop controller is unavailable.");
  }
  const current = await ctx.subTaskRuntimeStore.getTask(control.binding.subtask.taskId);
  const mismatch = getSubtaskBindingMismatch(current, control.binding);
  if (mismatch) return failure(requestId, "run_mismatch", mismatch);

  const record = await ctx.stopSubTask(
    control.binding.subtask.taskId,
    control.reason,
    { idempotencyKey: `coding-run:${control.operation}:${control.binding.agentRunId}` },
  );
  if (!record) return failure(requestId, "not_found", "Subtask was not found while stopping.");
  return success(requestId, {
    accepted: true,
    operation: control.operation,
    binding: createSubtaskBinding(record, control.binding.subtask.taskId),
  });
}

async function cancelWorkflow(
  requestId: string,
  control: Extract<RunControl, { operation: "workflow.cancel" }>,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.workflowRuntime?.getStatusByRunId || !ctx.workflowRuntime.stopRun) {
    return failure(requestId, "not_available", "Workflow runtime control is unavailable.");
  }

  const workflowRunId = control.binding.workflow.workflowRunId;
  if (!workflowRunId || workflowRunId !== control.binding.agentRunId) {
    return failure(requestId, "run_mismatch", "Workflow control requires a matching runtime run binding.");
  }

  const current = ctx.workflowRuntime.getStatusByRunId(workflowRunId);
  if (!current
    || current.workflowRunId !== workflowRunId
    || current.journalId !== control.binding.workflow.journalId
    || (current.status !== "running"
      && current.status !== "stopping"
      && !(current.status === "partial" && current.stopRequested === true))) {
    return failure(requestId, "run_mismatch", "Workflow run binding no longer matches an active Workflow run.");
  }

  const stopped = await ctx.workflowRuntime.stopRun(
    current.journalId,
    current.workflowRunId,
    control.reason,
  );
  if (!stopped) {
    return failure(requestId, "not_found", "Workflow run is no longer stoppable.");
  }
  return success(requestId, {
    accepted: true,
    operation: control.operation,
    binding: {
      agentRunId: workflowRunId,
      workflow: {
        journalId: current.journalId,
        workflowRunId: current.workflowRunId,
      },
    },
  });
}

function getGoalBindingMismatch(
  current: GoalControlRecord | null,
  binding: Extract<CodingContextBinding, { goal?: unknown }> & { agentRunId: string; goal: { goalId: string; nodeId?: string } },
): string | undefined {
  if (!current) return "Goal was not found.";
  if (current.id !== binding.goal.goalId || current.lastRunId !== binding.agentRunId) {
    return "Goal run binding no longer matches the current Goal run.";
  }
  if (binding.goal.nodeId && current.activeNodeId !== binding.goal.nodeId) {
    return "Goal node binding no longer matches the active Goal node.";
  }
  return undefined;
}

function getSubtaskBindingMismatch(
  current: SubtaskControlRecord | undefined,
  binding: Extract<CodingContextBinding, { subtask?: unknown }> & { agentRunId: string; subtask: { taskId: string } },
): string | undefined {
  if (!current) return "Subtask was not found.";
  const agentRunId = current.sessionId?.trim() || current.id;
  if (current.id !== binding.subtask.taskId || agentRunId !== binding.agentRunId) {
    return "Subtask run binding no longer matches the current Subtask run.";
  }
  return undefined;
}

function createSubtaskBinding(record: SubtaskControlRecord, taskId: string): CodingContextBinding {
  return {
    agentRunId: record.sessionId?.trim() || record.id,
    subtask: { taskId },
  };
}

function cloneGoalBinding(binding: { agentRunId: string; goal: { goalId: string; nodeId?: string } }): CodingContextBinding {
  return {
    agentRunId: binding.agentRunId,
    goal: { ...binding.goal },
  };
}

function readRunControl(params: unknown): RunControl | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const record = params as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, "control")) return undefined;
  return isRunControlV1(record.control) ? record.control : undefined;
}

function success(requestId: string, payload: Record<string, unknown>): GatewayResFrame {
  return { type: "res", id: requestId, ok: true, payload };
}

function failure(requestId: string, code: string, message: string): GatewayResFrame {
  return {
    type: "res",
    id: requestId,
    ok: false,
    error: { code, message: toSafeCodingRunErrorMessage(message) },
  };
}
