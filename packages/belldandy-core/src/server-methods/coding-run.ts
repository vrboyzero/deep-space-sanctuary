import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import {
  isConversationFollowUpStatusQueryV1,
  isCodingRunStatusQueryV1,
  isRunControlV1,
  toSafeCodingRunErrorMessage,
  type CodingContextBinding,
  type RunControl,
} from "../coding-run/contracts.js";
import {
  createConversationCodingRunView,
  createRuntimeLostCodingRunView,
} from "../coding-run/source-adapters.js";
import {
  createGoalCodingRunView,
  createSubtaskCodingRunView,
  createWorkflowRuntimeCodingRunView,
} from "../coding-run/source-adapters.js";
import type { GoalStatus, GoalTaskGraph } from "../goals/types.js";
import type { SubTaskKind, SubTaskStatus } from "../task-runtime.js";
import type { CodingRunRecoveryLookup } from "../coding-run/recovery-marker-store.js";
import {
  createUnavailableCodingRunReconciliation,
  type CodingRunReconciliationJournal,
} from "../coding-run/reconciliation-journal.js";
import type {
  ConversationFollowUpEnqueueResult,
  ConversationFollowUpView,
  ConversationRunBinding,
} from "../coding-run/conversation-follow-up-queue.js";
import type { ConversationReplacementResult } from "../conversation-run-registry.js";
import type {
  ConversationSteerEnqueueResult,
  ConversationSteerView,
} from "../coding-run/conversation-steer-mailbox.js";
import type {
  PendingToolPermissionSnapshot,
  PendingToolPermissionResponse,
  PendingToolPermissionResponseResult,
} from "../coding-run/pending-tool-permission-runtime.js";

type GoalControlRecord = {
  id: string;
  status?: GoalStatus;
  activeConversationId?: string;
  lastRunId?: string;
  activeNodeId?: string;
};

type SubtaskControlRecord = {
  id: string;
  sessionId?: string;
  parentConversationId?: string;
  kind?: SubTaskKind;
  status?: SubTaskStatus;
  progress?: { phase: SubTaskStatus };
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
  launchSpec?: {
    role?: "default" | "commander" | "coder" | "researcher" | "verifier";
    worktreePath?: string;
  };
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
  stats?: {
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

type CodingRunMethodContext = {
  codingRunReconciliationJournal?: Pick<CodingRunReconciliationJournal, "reconcile">;
  conversationRunRegistry?: {
    get: (conversationId: string) => { runId: string } | undefined;
    getRun?: (conversationId: string, runId: string) => {
      conversationId: string;
      runId: string;
      agentId?: string;
      startedAt: number;
      state: "running" | "stop_requested" | "stopped";
      stopRequestedAt?: number;
      stoppedAt?: number;
      stopReason?: string;
      stop: (reason?: string) => boolean | Promise<boolean>;
    } | undefined;
    getRecoveryStatus?: (conversationId: string, runId: string) => Promise<CodingRunRecoveryLookup>;
    requestStop: (input: {
      conversationId: string;
      runId: string;
      reason?: string;
    }) => Promise<ConversationRunControlResult>;
    enqueueFollowUp?: (input: {
      binding: ConversationRunBinding;
      prompt: string;
      idempotencyKey: string;
    }) => ConversationFollowUpEnqueueResult | {
      ok: false;
      code: "not_found" | "run_mismatch" | "not_active";
      message: string;
    };
    getFollowUpStatus?: (
      binding: ConversationRunBinding,
      commandId: string,
    ) => ConversationFollowUpView | undefined;
    enqueueSteer?: (input: {
      binding: ConversationRunBinding;
      prompt: string;
      idempotencyKey: string;
    }) => ConversationSteerEnqueueResult | {
      ok: false;
      code: "not_found" | "run_mismatch" | "not_active" | "not_available";
      message: string;
    };
    getSteerStatus?: (
      binding: ConversationRunBinding,
      commandId: string,
    ) => ConversationSteerView | undefined;
    replaceActiveRun?: (input: {
      binding: ConversationRunBinding;
      prompt: string;
      idempotencyKey: string;
    }) => Promise<ConversationReplacementResult>;
  };
  goalManager?: {
    getGoal: (goalId: string) => Promise<GoalControlRecord | null>;
    readTaskGraph?: (goalId: string) => Promise<GoalTaskGraph>;
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
    getStatus?: (journalId: string) => WorkflowRunControlStatus | null;
    getStatusByRunId?: (workflowRunId: string) => WorkflowRunControlStatus | null;
    getRecoveryStatusByRunId?: (
      journalId: string,
      workflowRunId: string,
    ) => Promise<CodingRunRecoveryLookup>;
    stopRun?: (journalId: string, workflowRunId: string, reason?: string) => Promise<boolean>;
  };
  pendingToolPermissionRuntime?: {
    list?: () => PendingToolPermissionSnapshot[];
    respond?: (input: PendingToolPermissionResponse) => PendingToolPermissionResponseResult;
  };
};

/**
 * 只把已验证的来源控制映射到既有领域 runtime；未具备同等绑定验证的控制一律 fail closed。
 */
export async function handleCodingRunMethod(
  req: GatewayReqFrame,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (req.method === "coding.run.status") {
    return statusCodingRun(req, ctx);
  }
  if (req.method === "coding.run.follow_up.status") {
    return statusConversationFollowUp(req, ctx);
  }
  if (req.method === "coding.run.steer.status") {
    return statusConversationSteer(req, ctx);
  }
  if (req.method === "coding.run.permission.list") {
    return listPendingToolPermissions(req, ctx);
  }
  const control = readRunControl(req.params);
  if (!control) {
    return failure(req.id, "invalid_request", "control must be a valid RunControl v1 object.");
  }

  try {
    switch (control.operation) {
      case "cancel":
        return await cancelConversation(req.id, control, ctx);
      case "conversation.follow_up":
        return enqueueConversationFollowUp(req.id, control, ctx);
      case "conversation.replace":
        return await replaceConversationRun(req.id, control, ctx);
      case "conversation.steer":
        return enqueueConversationSteer(req.id, control, ctx);
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

function listPendingToolPermissions(
  req: GatewayReqFrame,
  ctx: CodingRunMethodContext,
): GatewayResFrame {
  if (req.params !== undefined
    && (!isParamsRecord(req.params) || Object.keys(req.params).length > 0)) {
    return failure(req.id, "invalid_request", "params must be an empty object.");
  }
  if (!ctx.pendingToolPermissionRuntime?.list) {
    return failure(req.id, "not_available", "Pending tool permission runtime is unavailable.");
  }
  return success(req.id, { permissions: ctx.pendingToolPermissionRuntime.list() });
}

function statusConversationFollowUp(
  req: GatewayReqFrame,
  ctx: CodingRunMethodContext,
): GatewayResFrame {
  const query = readFollowUpStatusQuery(req.params);
  if (!query) {
    return failure(req.id, "invalid_request", "query must be a valid Conversation follow-up status query v1 object.");
  }
  if (!ctx.conversationRunRegistry?.getFollowUpStatus) {
    return failure(req.id, "not_available", "Conversation follow-up status is unavailable.");
  }
  const status = ctx.conversationRunRegistry.getFollowUpStatus(query.binding, query.commandId);
  return status
    ? success(req.id, status)
    : failure(req.id, "not_found", "Conversation follow-up command was not found for this binding.");
}

function enqueueConversationFollowUp(
  requestId: string,
  control: Extract<RunControl, { operation: "conversation.follow_up" }>,
  ctx: CodingRunMethodContext,
): GatewayResFrame {
  if (!ctx.conversationRunRegistry?.enqueueFollowUp) {
    return failure(requestId, "not_available", "Conversation follow-up queue is unavailable.");
  }
  const result = ctx.conversationRunRegistry.enqueueFollowUp({
    binding: { ...control.binding },
    prompt: control.prompt,
    idempotencyKey: control.idempotencyKey,
  });
  if (!result.ok) return failure(requestId, result.code, result.message);
  return success(requestId, {
    accepted: true,
    replayed: result.replayed,
    operation: control.operation,
    command: result.item,
  });
}

function statusConversationSteer(
  req: GatewayReqFrame,
  ctx: CodingRunMethodContext,
): GatewayResFrame {
  const query = readFollowUpStatusQuery(req.params);
  if (!query) {
    return failure(req.id, "invalid_request", "query must be a valid Conversation steer status query v1 object.");
  }
  if (!ctx.conversationRunRegistry?.getSteerStatus) {
    return failure(req.id, "not_available", "Conversation steer status is unavailable.");
  }
  const status = ctx.conversationRunRegistry.getSteerStatus(query.binding, query.commandId);
  return status
    ? success(req.id, status)
    : failure(req.id, "not_found", "Conversation steer command was not found for this binding.");
}

function enqueueConversationSteer(
  requestId: string,
  control: Extract<RunControl, { operation: "conversation.steer" }>,
  ctx: CodingRunMethodContext,
): GatewayResFrame {
  if (!ctx.conversationRunRegistry?.enqueueSteer) {
    return failure(requestId, "not_available", "Conversation steer control is unavailable.");
  }
  const result = ctx.conversationRunRegistry.enqueueSteer({
    binding: { ...control.binding },
    prompt: control.prompt,
    idempotencyKey: control.idempotencyKey,
  });
  if (!result.ok) return failure(requestId, result.code, result.message);
  return success(requestId, {
    accepted: true,
    replayed: result.replayed,
    operation: control.operation,
    command: result.item,
  });
}

async function replaceConversationRun(
  requestId: string,
  control: Extract<RunControl, { operation: "conversation.replace" }>,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.conversationRunRegistry?.replaceActiveRun) {
    return failure(requestId, "not_available", "Conversation replacement control is unavailable.");
  }
  const result = await ctx.conversationRunRegistry.replaceActiveRun({
    binding: { ...control.binding },
    prompt: control.prompt,
    idempotencyKey: control.idempotencyKey,
  });
  if (!result.ok) return failure(requestId, result.code, result.message);
  return success(requestId, {
    accepted: result.stopRequested,
    stopRequested: result.stopRequested,
    replayed: result.replayed,
    operation: control.operation,
    command: result.item,
  });
}

async function statusCodingRun(req: GatewayReqFrame, ctx: CodingRunMethodContext): Promise<GatewayResFrame> {
  const query = readStatusQuery(req.params);
  if (!query) {
    return failure(req.id, "invalid_request", "query must be a valid coding run status query v1 object.");
  }
  if (query.source === "goal") return statusGoalRun(req.id, query.binding, ctx);
  if (query.source === "workflow") return statusWorkflowRun(req.id, query.binding, ctx);
  if (query.source === "subtask") return statusSubtaskRun(req.id, query.binding, ctx);
  if (!ctx.conversationRunRegistry?.getRun || !query.binding.conversationId) {
    return failure(req.id, "not_available", "Conversation run registry is unavailable.");
  }
  const current = ctx.conversationRunRegistry.getRun(
    query.binding.conversationId,
    query.binding.agentRunId,
  );
  if (!current
    || current.conversationId !== query.binding.conversationId
    || current.runId !== query.binding.agentRunId) {
    const latest = ctx.conversationRunRegistry.get(query.binding.conversationId);
    if (latest) {
      return failure(req.id, "run_mismatch", "Conversation run binding no longer matches the current active run.");
    }
    const recovered = await ctx.conversationRunRegistry.getRecoveryStatus?.(
      query.binding.conversationId,
      query.binding.agentRunId,
    );
    if (recovered?.state === "lost") {
      const reconciliation = ctx.codingRunReconciliationJournal
        ? await ctx.codingRunReconciliationJournal.reconcile({
            conversationId: query.binding.conversationId,
            agentRunId: query.binding.agentRunId,
          }).catch(() => createUnavailableCodingRunReconciliation())
        : createUnavailableCodingRunReconciliation();
      return success(req.id, createRuntimeLostCodingRunView({
        source: "conversation",
        binding: recovered.marker.binding,
        startedAtMs: recovered.marker.startedAtMs,
        updatedAtMs: recovered.marker.updatedAtMs,
        reconciliation,
      }));
    }
    if (recovered?.state === "unavailable" || recovered?.state === "current_owner" || recovered?.state === "live_owner") {
      return failure(req.id, "not_available", "Conversation recovery evidence is not safely available.");
    }
    return failure(req.id, "not_found", "Conversation run is not active in this Gateway process.");
  }
  return success(req.id, createConversationCodingRunView({ handle: current }));
}

async function statusGoalRun(
  requestId: string,
  binding: CodingContextBinding,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.goalManager || !binding.goal) {
    return failure(requestId, "not_available", "Goal manager is unavailable.");
  }
  const goal = await ctx.goalManager.getGoal(binding.goal.goalId);
  if (!goal) return failure(requestId, "not_found", "Goal was not found.");
  if (goal.id !== binding.goal.goalId
    || goal.lastRunId !== binding.agentRunId
    || (binding.conversationId !== undefined && binding.conversationId !== goal.activeConversationId)) {
    return failure(requestId, "run_mismatch", "Goal run binding no longer matches the current Goal run.");
  }
  if (!goal.status) return failure(requestId, "not_available", "Goal status is unavailable.");

  let node;
  if (binding.goal.nodeId) {
    if (!ctx.goalManager.readTaskGraph) {
      return failure(requestId, "not_available", "Goal task graph reader is unavailable.");
    }
    const graph = await ctx.goalManager.readTaskGraph(goal.id);
    node = graph.nodes.find((item) => item.id === binding.goal?.nodeId);
    if (!node) return failure(requestId, "not_found", "Goal task node was not found.");
    if (goal.activeNodeId !== node.id || node.lastRunId !== binding.agentRunId) {
      return failure(requestId, "run_mismatch", "Goal node binding no longer matches the active Goal node.");
    }
  }
  return success(requestId, createGoalCodingRunView({ goal: {
    id: goal.id,
    status: goal.status,
    activeConversationId: goal.activeConversationId,
    lastRunId: goal.lastRunId,
  }, ...(node ? { node } : {}), runId: binding.agentRunId }));
}

async function statusWorkflowRun(
  requestId: string,
  binding: CodingContextBinding,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  const workflowRunId = binding.workflow?.workflowRunId;
  if (!ctx.workflowRuntime?.getStatusByRunId || !binding.workflow || !workflowRunId) {
    return failure(requestId, "not_available", "Workflow runtime status reader is unavailable.");
  }
  const current = ctx.workflowRuntime.getStatusByRunId(workflowRunId);
  if (!current) {
    const latest = ctx.workflowRuntime.getStatus?.(binding.workflow.journalId);
    if (latest && latest.workflowRunId !== workflowRunId) {
      return failure(requestId, "run_mismatch", "Workflow binding no longer matches the active runtime instance.");
    }
    const recovered = await ctx.workflowRuntime.getRecoveryStatusByRunId?.(
      binding.workflow.journalId,
      workflowRunId,
    );
    if (recovered?.state === "lost") {
      return success(requestId, createRuntimeLostCodingRunView({
        source: "workflow",
        binding: recovered.marker.binding,
        startedAtMs: recovered.marker.startedAtMs,
        updatedAtMs: recovered.marker.updatedAtMs,
      }));
    }
    if (recovered?.state === "unavailable" || recovered?.state === "current_owner" || recovered?.state === "live_owner") {
      return failure(requestId, "not_available", "Workflow recovery evidence is not safely available.");
    }
    return failure(requestId, "not_found", "Workflow run is not active in this Gateway process.");
  }
  if (binding.agentRunId !== workflowRunId
    || current.workflowRunId !== workflowRunId
    || current.journalId !== binding.workflow.journalId) {
    return failure(requestId, "run_mismatch", "Workflow binding no longer matches the active runtime instance.");
  }
  if (!isWorkflowRuntimeStatus(current.status) || !current.stats) {
    return failure(requestId, "not_available", "Workflow runtime status evidence is unavailable.");
  }
  return success(requestId, createWorkflowRuntimeCodingRunView({
    status: {
      workflowRunId: current.workflowRunId,
      journalId: current.journalId,
      status: current.status,
      ...(current.stopRequested ? { stopRequested: true } : {}),
      stats: current.stats,
      ...(current.error ? { error: current.error } : {}),
    },
  }));
}

async function statusSubtaskRun(
  requestId: string,
  binding: CodingContextBinding,
  ctx: CodingRunMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.subTaskRuntimeStore || !binding.subtask) {
    return failure(requestId, "not_available", "Subtask runtime store is unavailable.");
  }
  const current = await ctx.subTaskRuntimeStore.getTask(binding.subtask.taskId);
  if (!current) return failure(requestId, "not_found", "Subtask was not found.");
  const agentRunId = current.sessionId?.trim() || current.id;
  if (current.id !== binding.subtask.taskId
    || agentRunId !== binding.agentRunId
    || (binding.conversationId !== undefined && binding.conversationId !== current.parentConversationId)) {
    return failure(requestId, "run_mismatch", "Subtask binding no longer matches the current Subtask run.");
  }
  if (!isSubtaskStatusRecord(current)) {
    return failure(requestId, "not_available", "Subtask status evidence is unavailable.");
  }
  return success(requestId, createSubtaskCodingRunView({ record: current }));
}

function isWorkflowRuntimeStatus(value: string): value is "running" | "stopping" | "partial" | "done" | "error" | "budget_exceeded" {
  return value === "running" || value === "stopping" || value === "partial"
    || value === "done" || value === "error" || value === "budget_exceeded";
}

function isSubtaskStatusRecord(record: SubtaskControlRecord): record is SubtaskControlRecord & {
  parentConversationId: string;
  kind: SubTaskKind;
  status: SubTaskStatus;
  progress: { phase: SubTaskStatus };
  launchSpec: NonNullable<SubtaskControlRecord["launchSpec"]>;
} {
  return typeof record.parentConversationId === "string" && Boolean(record.parentConversationId.trim())
    && (record.kind === "sub_agent" || record.kind === "bridge_session")
    && typeof record.status === "string"
    && typeof record.progress?.phase === "string"
    && Boolean(record.launchSpec);
}

function isParamsRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function respondToToolPermission(
  requestId: string,
  control: Extract<RunControl, { operation: "permission.respond" }>,
  ctx: CodingRunMethodContext,
): GatewayResFrame {
  if (!ctx.pendingToolPermissionRuntime?.respond) {
    return failure(requestId, "not_available", "Pending tool permission runtime is unavailable.");
  }
  const result = ctx.pendingToolPermissionRuntime.respond({
    agentRunId: control.binding.agentRunId,
    ...(control.binding.worktreeId ? { worktreeId: control.binding.worktreeId } : {}),
    toolCallId: control.toolCallId,
    decision: control.decision,
    responderKind: "unknown",
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

function readStatusQuery(params: unknown) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const record = params as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, "query")) return undefined;
  return isCodingRunStatusQueryV1(record.query) ? record.query : undefined;
}

function readFollowUpStatusQuery(params: unknown) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const record = params as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, "query")) return undefined;
  return isConversationFollowUpStatusQueryV1(record.query) ? record.query : undefined;
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
