import crypto from "node:crypto";

import type {
  BridgeSessionRecord,
  BridgeSessionGovernanceCapabilities,
  BridgeSessionLaunchSemantics,
  ToolExecutionRuntimeContext,
  ToolExecutor,
  ToolRuntimeLaunchSpec,
} from "@belldandy/skills";
import { loadRecoveredBridgeSessions } from "@belldandy/skills";

import type {
  SubTaskBridgeSessionLaunch,
  SubTaskRecord,
  SubTaskRuntimeStore,
} from "./task-runtime.js";

const BRIDGE_SESSION_START_TOOL = "bridge_session_start";
const BRIDGE_SESSION_WRITE_TOOL = "bridge_session_write";
const BRIDGE_SESSION_CLOSE_TOOL = "bridge_session_close";
const DEFAULT_BRIDGE_WRITE_WAIT_MS = 1_000;

type RuntimeLogger = {
  warn?: (message: string, data?: unknown) => void;
};

type ToolExecutorLike = Pick<ToolExecutor, "execute">;

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
    : normalized;
}

function isTerminalStatus(status: string): boolean {
  return status === "done" || status === "error" || status === "timeout" || status === "stopped";
}

export function isBridgeSessionSubTask(
  record: Pick<SubTaskRecord, "kind" | "launchSpec"> | undefined | null,
): record is Pick<SubTaskRecord, "kind" | "launchSpec"> & {
  kind: "bridge_session";
  launchSpec: { bridgeSession: SubTaskBridgeSessionLaunch };
} {
  if (!record) return false;
  return record.kind === "bridge_session" && Boolean(record.launchSpec?.bridgeSession);
}

function buildBridgeSessionSummary(session: BridgeSessionLaunchSemantics): string {
  const targetRef = `${session.targetId}.${session.action}`;
  if (normalizeOptionalString(session.summary)) {
    return String(session.summary).trim();
  }
  if (session.bridgeSubtask?.summary) {
    return session.bridgeSubtask.summary.trim();
  }
  if (session.bridgeSubtask?.kind) {
    return `Bridge ${session.bridgeSubtask.kind} via ${targetRef}`;
  }
  return `Bridge session via ${targetRef}`;
}

function buildBridgeSessionInstruction(
  session: BridgeSessionLaunchSemantics,
  explicitInstruction?: string,
): string {
  const normalizedInstruction = normalizeOptionalString(explicitInstruction);
  if (normalizedInstruction) {
    return normalizedInstruction;
  }
  return buildBridgeSessionSummary(session);
}

function buildBridgeResumeInstruction(record: SubTaskRecord, message?: string): string {
  const targetRef = record.launchSpec.bridgeSession
    ? `${record.launchSpec.bridgeSession.targetId}.${record.launchSpec.bridgeSession.action}`
    : "bridge session";
  return [
    `Resume the existing ${targetRef} task in the same project context.`,
    "",
    `Original instruction: ${record.instruction}`,
    `Latest recorded summary: ${truncateText(record.outputPreview || record.error || record.summary || record.progress.message || record.instruction, 240) || "-"}`,
    "",
    normalizeOptionalString(message) || "Continue from the last recorded state and produce the next useful result.",
  ].join("\n").trim();
}

function buildBridgeTakeoverInstruction(
  record: SubTaskRecord,
  agentId: string,
  message?: string,
): string {
  const targetRef = record.launchSpec.bridgeSession
    ? `${record.launchSpec.bridgeSession.targetId}.${record.launchSpec.bridgeSession.action}`
    : "bridge session";
  return [
    `Take over the ${targetRef} task as agent ${agentId}.`,
    "",
    `Original instruction: ${record.instruction}`,
    `Latest recorded summary: ${truncateText(record.outputPreview || record.error || record.summary || record.progress.message || record.instruction, 240) || "-"}`,
    `Previous agent: ${record.agentId || record.launchSpec.agentId || "-"}`,
    "",
    normalizeOptionalString(message) || "Continue from the last recorded state and produce the next useful result.",
  ].join("\n").trim();
}

function buildResumeRequestMessage(record: SubTaskRecord, message?: string, takeoverAgentId?: string): string {
  const normalizedMessage = normalizeOptionalString(message) || "Continue from the last recorded state.";
  if (!takeoverAgentId) {
    return normalizedMessage;
  }
  return [`Take over this bridge subtask as agent ${takeoverAgentId}.`, normalizedMessage].join("\n\n");
}

function buildRuntimeLaunchSpec(
  record: SubTaskRecord,
  instruction: string,
  agentId?: string,
  profileId?: string,
): ToolRuntimeLaunchSpec {
  const launchSpec = record.launchSpec;
  const resolvedAgentId = normalizeOptionalString(agentId) || launchSpec.agentId || record.agentId;
  const resolvedProfileId = normalizeOptionalString(profileId) || launchSpec.profileId || resolvedAgentId;
  return {
    agentId: resolvedAgentId,
    profileId: resolvedProfileId,
    instruction,
    background: true,
    timeoutMs: launchSpec.timeoutMs ?? 120_000,
    cwd: launchSpec.bridgeSession?.cwd || launchSpec.cwd,
    toolSet: launchSpec.toolSet ? [...launchSpec.toolSet] : undefined,
    permissionMode: launchSpec.permissionMode,
    isolationMode: launchSpec.isolationMode,
    parentTaskId: launchSpec.parentTaskId,
    bridgeSubtask: launchSpec.bridgeSubtask ? { ...launchSpec.bridgeSubtask } : undefined,
  };
}

function buildRuntimeContext(
  record: SubTaskRecord,
  instruction: string,
  agentId?: string,
  profileId?: string,
): ToolExecutionRuntimeContext {
  return {
    launchSpec: buildRuntimeLaunchSpec(record, instruction, agentId, profileId),
    channel: "gateway",
    bridgeGovernanceTaskId: record.id,
    agentWhitelistMode: "governed_bridge_internal",
  };
}

function buildRuntimeLostOutput(record: BridgeSessionRecord): string | undefined {
  if (!record.artifactPath) {
    return undefined;
  }
  return `Bridge session closed (runtime-lost). Audit artifact: ${record.artifactPath}`;
}

function buildBridgeSessionCleanupOutput(record: BridgeSessionRecord): string | undefined {
  if (record.closeReason !== "orphan") {
    return buildRuntimeLostOutput(record);
  }
  if (!record.artifactPath) {
    return "Bridge session closed (orphan).";
  }
  return `Bridge session closed (orphan). Audit artifact: ${record.artifactPath}`;
}

function buildBridgeSessionBlockReason(
  closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan",
): string | undefined {
  if (closeReason === "runtime-lost") {
    return "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.";
  }
  if (closeReason === "orphan") {
    return "Bridge session lost its governed subtask binding and was cleaned up as an orphan session.";
  }
  if (closeReason === "idle-timeout") {
    return "Bridge session hit the configured idle timeout and must be resumed or relaunched before work can continue.";
  }
  return undefined;
}

function buildBridgeSessionRuntimeState(
  input: {
    closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
    artifactPath?: string;
    transcriptPath?: string;
  },
): {
  state: "closed" | "runtime-lost" | "orphaned";
  closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
  artifactPath?: string;
  transcriptPath?: string;
  blockReason?: string;
} {
  return {
    state: input.closeReason === "orphan"
      ? "orphaned"
      : input.closeReason === "runtime-lost"
        ? "runtime-lost"
        : "closed",
    ...(input.closeReason ? { closeReason: input.closeReason } : {}),
    ...(input.artifactPath ? { artifactPath: input.artifactPath } : {}),
    ...(input.transcriptPath ? { transcriptPath: input.transcriptPath } : {}),
    ...(buildBridgeSessionBlockReason(input.closeReason)
      ? { blockReason: buildBridgeSessionBlockReason(input.closeReason) }
      : {}),
  };
}

function extractSessionIdFromResult(output: string): string | undefined {
  if (!output) return undefined;
  try {
    const parsed = JSON.parse(output) as { sessionId?: unknown };
    return normalizeOptionalString(parsed?.sessionId);
  } catch {
    return undefined;
  }
}

async function executeBridgeTool(
  toolExecutor: ToolExecutorLike,
  record: SubTaskRecord,
  request: {
    name: string;
    arguments: Record<string, unknown>;
  },
  runtimeContext: ToolExecutionRuntimeContext,
  agentId?: string,
): Promise<Awaited<ReturnType<ToolExecutorLike["execute"]>>> {
  return toolExecutor.execute(
    {
      id: crypto.randomUUID(),
      name: request.name,
      arguments: request.arguments,
    },
    record.parentConversationId,
    agentId || record.agentId || record.launchSpec.agentId,
    undefined,
    undefined,
    undefined,
    runtimeContext,
  );
}

async function tryCloseBridgeSession(
  toolExecutor: ToolExecutorLike,
  record: SubTaskRecord,
  sessionId: string,
  runtimeContext: ToolExecutionRuntimeContext,
  agentId?: string,
): Promise<void> {
  await executeBridgeTool(toolExecutor, record, {
    name: BRIDGE_SESSION_CLOSE_TOOL,
    arguments: { sessionId },
  }, runtimeContext, agentId);
}

async function relaunchBridgeSession(
  input: {
    runtimeStore: Pick<SubTaskRuntimeStore, "getTask">;
    toolExecutor: ToolExecutorLike;
    record: SubTaskRecord;
    instruction: string;
    agentId?: string;
    profileId?: string;
  },
): Promise<{ sessionId: string }> {
  const launch = input.record.launchSpec.bridgeSession;
  if (!launch) {
    throw new Error(`Bridge session launch metadata is missing for subtask: ${input.record.id}`);
  }

  const runtimeContext = buildRuntimeContext(
    input.record,
    input.instruction,
    input.agentId,
    input.profileId,
  );

  const startArgs: Record<string, unknown> = {
    targetId: launch.targetId,
    action: launch.action,
    cwd: launch.cwd,
  };
  if (normalizeOptionalString(input.instruction) && launch.firstTurnStrategy !== "write") {
    startArgs.prompt = input.instruction;
  }

  const startResult = await executeBridgeTool(input.toolExecutor, input.record, {
    name: BRIDGE_SESSION_START_TOOL,
    arguments: startArgs,
  }, runtimeContext, input.agentId);
  if (!startResult.success) {
    throw new Error(startResult.error || `Failed to start bridge session for ${launch.targetId}.${launch.action}.`);
  }

  let sessionId = extractSessionIdFromResult(startResult.output);
  const refreshedAfterStart = await input.runtimeStore.getTask(input.record.id);
  sessionId = sessionId || refreshedAfterStart?.sessionId;
  if (!sessionId) {
    throw new Error(`Bridge session start did not return a sessionId for ${launch.targetId}.${launch.action}.`);
  }

  if (launch.firstTurnStrategy === "write" && normalizeOptionalString(input.instruction)) {
    const writeResult = await executeBridgeTool(input.toolExecutor, input.record, {
      name: BRIDGE_SESSION_WRITE_TOOL,
      arguments: {
        sessionId,
        data: input.instruction.endsWith("\n") ? input.instruction : `${input.instruction}\n`,
        waitMs: launch.recommendedReadWaitMs ?? DEFAULT_BRIDGE_WRITE_WAIT_MS,
      },
    }, runtimeContext, input.agentId);
    if (!writeResult.success) {
      await tryCloseBridgeSession(input.toolExecutor, input.record, sessionId, runtimeContext, input.agentId)
        .catch(() => {});
      throw new Error(writeResult.error || `Failed to deliver the first turn to bridge session ${sessionId}.`);
    }
  }

  return { sessionId };
}

export function createBridgeSessionGovernanceCapabilities(input: {
  runtimeStore: Pick<
    SubTaskRuntimeStore,
    | "createBridgeSessionTask"
    | "updateBridgeSessionTask"
    | "attachSession"
    | "recordThoughtDeltaBySession"
    | "getTask"
    | "getTaskBySession"
    | "completeTask"
  >;
}): BridgeSessionGovernanceCapabilities {
  return {
    ensureSessionTask: async ({ conversationId, agentId, launchSpec, taskId, session }) => {
      const resolvedAgentId = normalizeOptionalString(agentId)
        || normalizeOptionalString(launchSpec?.agentId)
        || "default";
      const resolvedProfileId = normalizeOptionalString(launchSpec?.profileId) || resolvedAgentId;
      const instruction = buildBridgeSessionInstruction(session, launchSpec?.instruction);
      const summary = buildBridgeSessionSummary(session);
      const bridgeSession: SubTaskBridgeSessionLaunch = {
        targetId: session.targetId,
        action: session.action,
        transport: "pty",
        cwd: session.cwd,
        commandPreview: session.commandPreview,
        ...(session.firstTurnStrategy ? { firstTurnStrategy: session.firstTurnStrategy } : {}),
        ...(session.firstTurnHint ? { firstTurnHint: session.firstTurnHint } : {}),
        ...(typeof session.recommendedReadWaitMs === "number"
          ? { recommendedReadWaitMs: session.recommendedReadWaitMs }
          : {}),
        ...(summary ? { summary } : {}),
      };
      const bridgeSubtask = session.bridgeSubtask ?? launchSpec?.bridgeSubtask;

      if (taskId) {
        const updated = await input.runtimeStore.updateBridgeSessionTask(taskId, {
          agentId: resolvedAgentId,
          profileId: resolvedProfileId,
          instruction,
          summary,
          bridgeSubtask,
          bridgeSession,
        });
        if (!updated) {
          throw new Error(`Bridge governance task not found: ${taskId}`);
        }
        return { taskId: updated.id };
      }

      const created = await input.runtimeStore.createBridgeSessionTask({
        parentConversationId: conversationId,
        agentId: resolvedAgentId,
        profileId: resolvedProfileId,
        instruction,
        summary,
        parentTaskId: launchSpec?.parentTaskId,
        bridgeSubtask,
        bridgeSession,
      });
      return { taskId: created.id };
    },

    attachSession: async ({ taskId, sessionId, agentId }) => {
      await input.runtimeStore.attachSession(taskId, sessionId, agentId);
    },

    recordOutput: async ({ sessionId, output }) => {
      await input.runtimeStore.recordThoughtDeltaBySession(sessionId, output);
    },

    completeSession: async ({ taskId, sessionId, status, output, error, closeReason, artifactPath, transcriptPath }) => {
      let task = taskId ? await input.runtimeStore.getTask(taskId) : undefined;
      if (!task && sessionId) {
        task = await input.runtimeStore.getTaskBySession(sessionId);
      }
      if (!task) {
        return;
      }
      const bridgeSessionRuntime = sessionId || closeReason || artifactPath || transcriptPath
        ? buildBridgeSessionRuntimeState({
            closeReason,
            artifactPath,
            transcriptPath,
          })
        : undefined;
      await input.runtimeStore.completeTask(task.id, {
        status,
        sessionId,
        output,
        error,
        ...(bridgeSessionRuntime ? { bridgeSessionRuntime } : {}),
      });
    },
  };
}

export async function reconcileRuntimeLostBridgeSubtasks(input: {
  workspaceRoot: string;
  runtimeStore: Pick<SubTaskRuntimeStore, "getTask" | "completeTask">;
  logger?: RuntimeLogger;
}): Promise<{ reconciledTaskIds: string[]; sessionIds: string[]; orphanSessionIds: string[] }> {
  const records = await loadRecoveredBridgeSessions(input.workspaceRoot);
  const reconciledTaskIds: string[] = [];
  const sessionIds: string[] = [];
  const orphanSessionIds: string[] = [];

  for (const record of records) {
    const taskId = normalizeOptionalString(record.taskId);
    if (!taskId) {
      orphanSessionIds.push(record.id);
      continue;
    }
    const current = await input.runtimeStore.getTask(taskId);
    if (!isBridgeSessionSubTask(current)) {
      orphanSessionIds.push(record.id);
      continue;
    }
    if (current.sessionId && current.sessionId !== record.id) {
      orphanSessionIds.push(record.id);
      continue;
    }
    const closeReason = record.closeReason === "orphan" ? "orphan" : "runtime-lost";
    if (
      current.status === "error"
      && current.sessionId === record.id
      && current.bridgeSessionRuntime?.closeReason === closeReason
    ) {
      continue;
    }
    await input.runtimeStore.completeTask(taskId, {
      status: "error",
      sessionId: record.id,
      output: buildBridgeSessionCleanupOutput(record),
      error: closeReason === "orphan"
        ? "Bridge session lost its governed subtask binding and was cleaned up as an orphan session."
        : "Bridge session runtime lost before the session could be resumed.",
      bridgeSessionRuntime: buildBridgeSessionRuntimeState({
        closeReason,
        artifactPath: record.artifactPath,
        transcriptPath: record.transcriptPath,
      }),
    });
    reconciledTaskIds.push(taskId);
    sessionIds.push(record.id);
  }

  if (reconciledTaskIds.length > 0) {
    input.logger?.warn?.("Reconciled recovered bridge sessions into subtask runtime.", {
      reconciledTaskIds,
      sessionIds,
    });
  }

  if (orphanSessionIds.length > 0) {
    input.logger?.warn?.("Cleaned recovered orphan bridge sessions without a governed subtask binding.", {
      orphanSessionIds,
    });
  }

  return { reconciledTaskIds, sessionIds, orphanSessionIds };
}

export function createBridgeSessionResumeController(input: {
  runtimeStore: Pick<
    SubTaskRuntimeStore,
    | "getTask"
    | "requestResume"
    | "markResumeDelivered"
    | "markResumeFailed"
  >;
  bridgeRuntimeStore: Pick<SubTaskRuntimeStore, "getTask">;
  toolExecutor: ToolExecutorLike;
}) {
  return async (
    taskId: string,
    message = "",
    options?: {
      takeoverAgentId?: string;
    },
  ): Promise<SubTaskRecord | undefined> => {
    const current = await input.runtimeStore.getTask(taskId);
    if (!current) return undefined;
    if (!isBridgeSessionSubTask(current)) {
      throw new Error(`Subtask is not a governed bridge session: ${taskId}`);
    }
    if (current.archivedAt) {
      throw new Error("Archived subtasks cannot be resumed.");
    }
    if (!isTerminalStatus(current.status)) {
      throw new Error(`Subtask resume only supports finished tasks. Current status: ${current.status}`);
    }

    const takeoverAgentId = normalizeOptionalString(options?.takeoverAgentId);
    const resumeMessage = buildResumeRequestMessage(current, message, takeoverAgentId);
    const accepted = await input.runtimeStore.requestResume(taskId, resumeMessage, {
      sessionId: current.sessionId,
    });
    if (!accepted) {
      throw new Error(`Failed to record bridge subtask resume: ${taskId}`);
    }

    const resumeId = accepted.resume.id;
    const instruction = takeoverAgentId
      ? buildBridgeTakeoverInstruction(current, takeoverAgentId, message)
      : buildBridgeResumeInstruction(current, message);

    try {
      const relaunched = await relaunchBridgeSession({
        runtimeStore: input.bridgeRuntimeStore,
        toolExecutor: input.toolExecutor,
        record: current,
        instruction,
        agentId: takeoverAgentId || current.agentId || current.launchSpec.agentId,
        profileId: takeoverAgentId || current.launchSpec.profileId || current.agentId,
      });
      await input.runtimeStore.markResumeDelivered(taskId, resumeId, {
        sessionId: relaunched.sessionId,
        resumedFromSessionId: current.sessionId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await input.runtimeStore.markResumeFailed(taskId, resumeId, errorMessage);
      throw error;
    }

    return input.runtimeStore.getTask(taskId);
  };
}

export function createBridgeSessionTakeoverController(input: {
  runtimeStore: Pick<
    SubTaskRuntimeStore,
    | "getTask"
    | "requestTakeover"
    | "markTakeoverDelivered"
    | "markTakeoverFailed"
  >;
  bridgeRuntimeStore: Pick<SubTaskRuntimeStore, "getTask">;
  toolExecutor: ToolExecutorLike;
  logger?: RuntimeLogger;
}) {
  return async (
    taskId: string,
    agentId: string,
    message = "",
  ): Promise<SubTaskRecord | undefined> => {
    const normalizedAgentId = normalizeOptionalString(agentId);
    if (!normalizedAgentId) {
      throw new Error("Takeover agentId is required.");
    }

    const current = await input.runtimeStore.getTask(taskId);
    if (!current) return undefined;
    if (!isBridgeSessionSubTask(current)) {
      throw new Error(`Subtask is not a governed bridge session: ${taskId}`);
    }
    if (current.archivedAt) {
      throw new Error("Archived subtasks cannot be taken over.");
    }

    const runningTakeover = current.status === "running" && Boolean(current.sessionId);
    if (!runningTakeover && !isTerminalStatus(current.status)) {
      throw new Error(`Subtask takeover only supports running or finished tasks. Current status: ${current.status}`);
    }

    const accepted = await input.runtimeStore.requestTakeover(taskId, normalizedAgentId, normalizeOptionalString(message) || "", {
      sessionId: current.sessionId,
      mode: runningTakeover ? "safe_point" : "resume_relaunch",
    });
    if (!accepted) {
      throw new Error(`Failed to record bridge subtask takeover: ${taskId}`);
    }

    const takeoverId = accepted.takeover.id;
    const instruction = buildBridgeTakeoverInstruction(current, normalizedAgentId, message);
    const runtimeContext = buildRuntimeContext(
      current,
      instruction,
      normalizedAgentId,
      normalizedAgentId,
    );

    try {
      if (runningTakeover && current.sessionId) {
        const closeResult = await executeBridgeTool(input.toolExecutor, current, {
          name: BRIDGE_SESSION_CLOSE_TOOL,
          arguments: { sessionId: current.sessionId },
        }, runtimeContext, current.agentId || current.launchSpec.agentId);
        if (!closeResult.success) {
          throw new Error(closeResult.error || `Failed to close bridge session ${current.sessionId} before takeover.`);
        }
      }

      const relaunched = await relaunchBridgeSession({
        runtimeStore: input.bridgeRuntimeStore,
        toolExecutor: input.toolExecutor,
        record: current,
        instruction,
        agentId: normalizedAgentId,
        profileId: normalizedAgentId,
      });
      await input.runtimeStore.markTakeoverDelivered(taskId, takeoverId, {
        sessionId: relaunched.sessionId,
        resumedFromSessionId: current.sessionId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await input.runtimeStore.markTakeoverFailed(taskId, takeoverId, errorMessage);
      input.logger?.warn?.("Bridge subtask takeover failed.", {
        taskId,
        agentId: normalizedAgentId,
        error: errorMessage,
      });
      throw error;
    }

    return input.runtimeStore.getTask(taskId);
  };
}

export function createGatewaySubTaskResumeDispatcher(input: {
  runtimeStore: Pick<SubTaskRuntimeStore, "getTask">;
  resumeBridgeSessionSubTask: (taskId: string, message?: string) => Promise<SubTaskRecord | undefined>;
  resumeAgentSubTask: (taskId: string, message?: string) => Promise<SubTaskRecord | undefined>;
}) {
  return async (taskId: string, message?: string): Promise<SubTaskRecord | undefined> => {
    const current = await input.runtimeStore.getTask(taskId);
    if (!current) return undefined;
    if (isBridgeSessionSubTask(current)) {
      return input.resumeBridgeSessionSubTask(taskId, message);
    }
    return input.resumeAgentSubTask(taskId, message);
  };
}

export function createGatewaySubTaskTakeoverDispatcher(input: {
  runtimeStore: Pick<SubTaskRuntimeStore, "getTask">;
  takeoverBridgeSessionSubTask: (taskId: string, agentId: string, message?: string) => Promise<SubTaskRecord | undefined>;
  takeoverAgentSubTask: (taskId: string, agentId: string, message?: string) => Promise<SubTaskRecord | undefined>;
}) {
  return async (taskId: string, agentId: string, message?: string): Promise<SubTaskRecord | undefined> => {
    const current = await input.runtimeStore.getTask(taskId);
    if (!current) return undefined;
    if (isBridgeSessionSubTask(current)) {
      return input.takeoverBridgeSessionSubTask(taskId, agentId, message);
    }
    return input.takeoverAgentSubTask(taskId, agentId, message);
  };
}

export function createBridgeAwareStopSubTaskHandler(input: {
  subTaskRuntimeStore: Pick<
    SubTaskRuntimeStore,
    | "getTask"
    | "markStopped"
    | "requestStop"
  > | undefined;
  subAgentOrchestrator?: {
    stopSession: (sessionId: string, reason?: string) => Promise<boolean>;
  };
  toolExecutor?: ToolExecutorLike;
  logger?: RuntimeLogger;
}) {
  return async (taskId: string, reason?: string): Promise<SubTaskRecord | undefined> => {
    const runtimeStore = input.subTaskRuntimeStore;
    if (!runtimeStore) return undefined;

    const current = await runtimeStore.getTask(taskId);
    if (!current) return undefined;

    const normalizedReason = normalizeOptionalString(reason) || "Task stopped by user.";

    if (current.status === "pending" && !current.sessionId) {
      return runtimeStore.markStopped(taskId, { reason: normalizedReason });
    }

    if (isBridgeSessionSubTask(current) && current.sessionId && input.toolExecutor) {
      const requested = await runtimeStore.requestStop(taskId, normalizedReason);
      try {
        const runtimeContext = buildRuntimeContext(current, current.instruction, current.agentId, current.launchSpec.profileId);
        const result = await executeBridgeTool(input.toolExecutor, current, {
          name: BRIDGE_SESSION_CLOSE_TOOL,
          arguments: { sessionId: current.sessionId },
        }, runtimeContext, current.agentId || current.launchSpec.agentId);
        if (result.success) {
          return runtimeStore.getTask(taskId);
        }
        input.logger?.warn?.("Bridge subtask stop fell back to stop_requested after close failure.", {
          taskId,
          sessionId: current.sessionId,
          error: result.error,
        });
      } catch (error) {
        input.logger?.warn?.("Bridge subtask stop failed while closing bridge session.", {
          taskId,
          sessionId: current.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return requested;
    }

    const requested = await runtimeStore.requestStop(taskId, normalizedReason);
    if (current.sessionId && input.subAgentOrchestrator) {
      const stopped = await input.subAgentOrchestrator.stopSession(current.sessionId, normalizedReason);
      if (stopped) {
        return runtimeStore.getTask(taskId);
      }
    }
    return requested;
  };
}
