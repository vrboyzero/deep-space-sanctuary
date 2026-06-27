import fs from "node:fs/promises";
import type { ToolCallResult, ToolContext } from "../../types.js";
import { PtyManager } from "../system/pty.js";
import {
  buildBridgeCommandTokens,
  resolveBridgeWorkingDirectory,
} from "./policy.js";
import { BridgeSessionStore } from "./sessions.js";
import { resolveBridgeSubtaskSemantics } from "./governance.js";
import type { BridgeActionConfig, BridgeSessionRecord, BridgeTargetConfig } from "./types.js";
import {
  isAbortError,
  readAbortReason,
  sleepWithAbort,
  throwIfAborted,
} from "../../abort-utils.js";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_IO_WAIT_MS = 100;
const MAX_IO_WAIT_MS = 10_000;

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeWaitMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_IO_WAIT_MS;
  const normalized = Math.trunc(value);
  if (normalized <= 0) return 0;
  return Math.min(normalized, MAX_IO_WAIT_MS);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return sleepWithAbort(ms, signal);
}

async function ensureExistingWorkingDirectory(cwd: string): Promise<void> {
  try {
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`Bridge cwd 不是目录: ${cwd}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(`Bridge cwd 不存在: ${cwd}`);
    }
    throw error;
  }
}

async function runStartupSequence(
  sessionId: string,
  action: BridgeActionConfig,
  store: BridgeSessionStore,
  ptyManager: PtyManager,
  signal?: AbortSignal,
): Promise<void> {
  for (const step of action.startupSequence ?? []) {
    throwIfAborted(signal);
    if (step.waitMs) {
      await delay(step.waitMs, signal);
    }
    const record = store.get(sessionId);
    if (!record || record.status !== "active") {
      break;
    }
    ptyManager.write(record.runtimeSessionId, step.data);
    store.appendTranscript(sessionId, "input", step.data);
    store.touch(sessionId);
    await store.persistSessionState(sessionId, {
      includeRegistry: false,
      includeTranscript: true,
    });
  }
}

async function captureStartupOutput(
  sessionId: string,
  action: BridgeActionConfig,
  store: BridgeSessionStore,
  ptyManager: PtyManager,
  signal?: AbortSignal,
): Promise<string> {
  const waitMs = action.startupReadWaitMs;
  if (!waitMs) return "";
  await delay(waitMs, signal);
  const record = store.get(sessionId);
  if (!record || record.status !== "active") {
    return "";
  }
  const output = ptyManager.read(record.runtimeSessionId);
  if (!output) {
    return "";
  }
  store.appendTranscript(sessionId, "output", output);
  store.touch(sessionId);
  await store.persistSessionState(sessionId, {
    includeRegistry: false,
    includeTranscript: true,
  });
  return output;
}

function toSessionPayload(record: BridgeSessionRecord): Record<string, unknown> {
  return {
    sessionId: record.id,
    ...(record.taskId ? { taskId: record.taskId } : {}),
    targetId: record.targetId,
    action: record.action,
    transport: record.transport,
    cwd: record.cwd,
    commandPreview: record.commandPreview,
    cols: record.cols,
    rows: record.rows,
    ...(record.firstTurnStrategy ? { firstTurnStrategy: record.firstTurnStrategy } : {}),
    ...(record.firstTurnHint ? { firstTurnHint: record.firstTurnHint } : {}),
    ...(record.recommendedReadWaitMs ? { recommendedReadWaitMs: record.recommendedReadWaitMs } : {}),
    ...(record.firstTurnPromptProvided !== undefined ? { firstTurnPromptProvided: record.firstTurnPromptProvided } : {}),
    ...(buildSessionFirstTurnNextStep(record) ? { recommendedNextStep: buildSessionFirstTurnNextStep(record) } : {}),
    ...(record.idleTimeoutMs ? { idleTimeoutMs: record.idleTimeoutMs } : {}),
    ...(record.idleDeadlineAt ? { idleDeadlineAt: record.idleDeadlineAt } : {}),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.closedAt ? { closedAt: record.closedAt } : {}),
    ...(record.closeReason ? { closeReason: record.closeReason } : {}),
    ...(record.artifactPath ? { artifactPath: record.artifactPath } : {}),
    ...(record.transcriptPath ? { transcriptPath: record.transcriptPath } : {}),
  };
}

function mapCloseReasonToTaskStatus(
  reason: BridgeSessionRecord["closeReason"] | undefined,
): "stopped" | "timeout" | "error" {
  if (reason === "idle-timeout") return "timeout";
  if (reason === "runtime-lost" || reason === "orphan") return "error";
  return "stopped";
}

async function ensureGovernedBridgeSessionTask(
  context: ToolContext,
  input: {
    targetId: string;
    action: string;
    cwd: string;
    commandPreview: string;
    firstTurnStrategy?: "start-args-prompt" | "write";
    firstTurnHint?: string;
    recommendedReadWaitMs?: number;
    summary?: string;
  },
): Promise<string | undefined> {
  if (!context.bridgeSessionGovernance) {
    return undefined;
  }
  const bridgeSubtask = resolveBridgeSubtaskSemantics(context, input.targetId, input.action);
  const registered = await context.bridgeSessionGovernance.ensureSessionTask({
    conversationId: context.conversationId,
    agentId: context.agentId,
    launchSpec: context.launchSpec,
    taskId: context.bridgeGovernanceTaskId,
    session: {
      targetId: input.targetId,
      action: input.action,
      transport: "pty",
      cwd: input.cwd,
      commandPreview: input.commandPreview,
      ...(input.firstTurnStrategy ? { firstTurnStrategy: input.firstTurnStrategy } : {}),
      ...(input.firstTurnHint ? { firstTurnHint: input.firstTurnHint } : {}),
      ...(typeof input.recommendedReadWaitMs === "number"
        ? { recommendedReadWaitMs: input.recommendedReadWaitMs }
        : {}),
      ...(bridgeSubtask ? { bridgeSubtask } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
    },
  });
  return registered?.taskId;
}

async function recordBridgeSessionOutput(
  context: Pick<ToolContext, "bridgeSessionGovernance">,
  sessionId: string,
  output: string,
): Promise<void> {
  if (!context.bridgeSessionGovernance || !output.trim()) {
    return;
  }
  await context.bridgeSessionGovernance.recordOutput({
    sessionId,
    output,
  });
}

async function completeGovernedBridgeSession(
  context: Pick<ToolContext, "bridgeSessionGovernance">,
  record: BridgeSessionRecord,
): Promise<void> {
  if (!context.bridgeSessionGovernance) {
    return;
  }
  await context.bridgeSessionGovernance.completeSession({
    ...(record.taskId ? { taskId: record.taskId } : {}),
    sessionId: record.id,
    status: mapCloseReasonToTaskStatus(record.closeReason),
    ...(record.closeReason ? { closeReason: record.closeReason } : {}),
    ...(record.artifactPath ? { artifactPath: record.artifactPath } : {}),
    ...(record.transcriptPath ? { transcriptPath: record.transcriptPath } : {}),
    ...(record.closeReason === "runtime-lost"
      ? { error: "Bridge session runtime lost before the session could be resumed." }
      : {}),
    ...(record.artifactPath
      ? {
          output: `Bridge session closed (${record.closeReason ?? "manual"}). Audit artifact: ${record.artifactPath}`,
        }
      : {}),
  });
}

function buildSessionFirstTurnNextStep(record: Pick<
  BridgeSessionRecord,
  "firstTurnStrategy" | "firstTurnPromptProvided" | "firstTurnWriteObservedAt"
>): string | undefined {
  if (record.firstTurnStrategy !== "start-args-prompt") {
    return undefined;
  }
  if (record.firstTurnPromptProvided) {
    return "首回合 prompt 已随 bridge_session_start.prompt 或 args.prompt 提交；建议先 bridge_session_read 再进入后续 write/read。";
  }
  if (!record.firstTurnWriteObservedAt) {
    return "该 target 首回合更稳的做法是把第一条任务指令放进 bridge_session_start.prompt（或 args.prompt），而不是 start 后立刻 write。";
  }
  return "该 session 首回合已走 write 路径；如果首条任务没有真正发出，建议重新 start 并用 bridge_session_start.prompt（或 args.prompt）提交。";
}

function buildFirstTurnGuidance(
  record: Pick<
    BridgeSessionRecord,
    "firstTurnStrategy" | "firstTurnHint" | "recommendedReadWaitMs" | "firstTurnPromptProvided" | "firstTurnWriteObservedAt"
  >,
): Record<string, unknown> | undefined {
  if (!record.firstTurnStrategy) {
    return undefined;
  }
  return {
    firstTurnStrategy: record.firstTurnStrategy,
    ...(record.firstTurnHint ? { firstTurnHint: record.firstTurnHint } : {}),
    ...(record.recommendedReadWaitMs ? { recommendedReadWaitMs: record.recommendedReadWaitMs } : {}),
    ...(record.firstTurnStrategy === "start-args-prompt"
      ? {
          firstTurnPromptProvided: record.firstTurnPromptProvided ?? false,
          ...(buildSessionFirstTurnNextStep(record)
            ? { recommendedNextStep: buildSessionFirstTurnNextStep(record) }
            : {}),
        }
      : {}),
  };
}

export async function startBridgeSession(
  target: BridgeTargetConfig,
  actionName: string,
  args: unknown,
  cwd: unknown,
  cols: unknown,
  rows: unknown,
  context: ToolContext,
): Promise<ToolCallResult> {
  const start = Date.now();
  const name = "bridge_session_start";
  let governanceTaskId: string | undefined;
  let createdSessionId: string | undefined;
  let createdRuntimeSessionId: string | undefined;

  try {
    throwIfAborted(context.abortSignal);
    if (!target.enabled) {
      throw new Error(`Bridge target "${target.id}" 未启用。`);
    }
    if (target.transport !== "pty") {
      throw new Error(`Bridge target "${target.id}" 不是 pty transport，当前为 ${target.transport}。`);
    }
    await BridgeSessionStore.getInstance().ensureLoaded(context.workspaceRoot);

    const { action, tokens, commandPreview } = buildBridgeCommandTokens({
      ...target,
      transport: "exec",
    }, actionName, args);
    const [cmd, ...cmdArgs] = tokens;
    if (!cmd) {
      throw new Error(`Bridge target "${target.id}" 缺少可执行 binary。`);
    }

    const resolvedCwd = resolveBridgeWorkingDirectory(target, cwd, context)
      ?? context.defaultCwd
      ?? context.workspaceRoot;
    const resolvedCols = normalizePositiveInt(cols, DEFAULT_COLS);
    const resolvedRows = normalizePositiveInt(rows, DEFAULT_ROWS);
    const firstTurnPrompt = args && typeof args === "object" && !Array.isArray(args)
      ? (args as { prompt?: unknown }).prompt
      : undefined;
    const firstTurnPromptProvided = typeof firstTurnPrompt === "string" && firstTurnPrompt.trim().length > 0;
    governanceTaskId = await ensureGovernedBridgeSessionTask(context, {
      targetId: target.id,
      action: actionName,
      cwd: resolvedCwd,
      commandPreview,
      firstTurnStrategy: action.firstTurnStrategy,
      firstTurnHint: action.firstTurnHint,
      recommendedReadWaitMs: action.recommendedReadWaitMs,
      summary: typeof firstTurnPrompt === "string" && firstTurnPrompt.trim()
        ? firstTurnPrompt.trim()
        : undefined,
    });
    await ensureExistingWorkingDirectory(resolvedCwd);
    const ptyManager = PtyManager.getInstance();
    const runtimeSessionId = await ptyManager.createSession(cmd, cmdArgs, {
      cwd: resolvedCwd,
      env: target.entry.env,
      cols: resolvedCols,
      rows: resolvedRows,
    });
    createdRuntimeSessionId = runtimeSessionId;
    const backend = await ptyManager.inspectBackend();
    const store = BridgeSessionStore.getInstance();
    const record = store.create({
      runtimeSessionId,
      targetId: target.id,
      action: actionName,
      transport: "pty",
      ...(governanceTaskId ? { taskId: governanceTaskId } : {}),
      workspaceRoot: context.workspaceRoot,
      cwd: resolvedCwd,
      commandPreview,
      cols: resolvedCols,
      rows: resolvedRows,
      firstTurnStrategy: action.firstTurnStrategy,
      firstTurnHint: action.firstTurnHint,
      recommendedReadWaitMs: action.recommendedReadWaitMs,
      firstTurnPromptProvided,
      idleTimeoutMs: target.idleTimeoutMs,
    });
    createdSessionId = record.id;
    if (governanceTaskId && context.bridgeSessionGovernance) {
      await context.bridgeSessionGovernance.attachSession({
        taskId: governanceTaskId,
        sessionId: record.id,
        agentId: context.agentId,
      });
    }
    await store.persistSessionState(record.id);
    await runStartupSequence(record.id, action, store, ptyManager, context.abortSignal);
    const startupOutput = await captureStartupOutput(record.id, action, store, ptyManager, context.abortSignal);
    const hydratedRecord = store.get(record.id) ?? record;
    const firstTurnGuidance = buildFirstTurnGuidance(hydratedRecord);

    return {
      id: record.id,
      name,
      success: true,
      output: JSON.stringify({
        ...toSessionPayload(hydratedRecord),
        backend,
        ...(startupOutput ? { startupOutput } : {}),
        ...(firstTurnGuidance ? firstTurnGuidance : {}),
      }, null, 2),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    if (isAbortError(error)) {
      if (createdRuntimeSessionId) {
        try {
          PtyManager.getInstance().kill(createdRuntimeSessionId);
        } catch {
          // ignore cleanup race
        }
      }
      if (createdSessionId) {
        try {
          const closed = await BridgeSessionStore.getInstance().close(createdSessionId, "manual");
          await completeGovernedBridgeSession(context, closed);
          governanceTaskId = undefined;
        } catch {
          // ignore cleanup race
        }
      }
    }
    if (governanceTaskId && context.bridgeSessionGovernance) {
      await context.bridgeSessionGovernance.completeSession({
        taskId: governanceTaskId,
        status: isAbortError(error) ? "stopped" : "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      id: `bridge-session-start-${Date.now()}`,
      name,
      success: false,
      output: "",
      error: isAbortError(error)
        ? readAbortReason(context.abortSignal)
        : (error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - start,
    };
  }
}

export async function writeBridgeSession(
  sessionId: string,
  data: unknown,
  submitLine: unknown,
  waitMs: unknown,
  context: Pick<ToolContext, "workspaceRoot" | "bridgeSessionGovernance" | "abortSignal">,
): Promise<ToolCallResult> {
  const start = Date.now();
  const name = "bridge_session_write";

  try {
    throwIfAborted(context.abortSignal);
    const hasData = typeof data === "string";
    const shouldSubmitLine = submitLine === true;
    if (!hasData && !shouldSubmitLine) {
      throw new Error("bridge_session_write 需要提供 data 字符串，或把 submitLine 设为 true。");
    }
    if (data !== undefined && typeof data !== "string") {
      throw new Error("bridge_session_write.data 必须是字符串。");
    }

    const store = BridgeSessionStore.getInstance();
    await store.ensureLoaded(context.workspaceRoot);
    const record = store.get(sessionId);
    if (!record) {
      throw new Error(`Bridge session 不存在: ${sessionId}`);
    }
    if (record.status !== "active") {
      throw new Error(`Bridge session 已关闭: ${sessionId}`);
    }

    const ptyManager = PtyManager.getInstance();
    let writtenInput = "";
    if (hasData) {
      writtenInput += data;
    }
    if (shouldSubmitLine) {
      writtenInput += "\n";
    }
    ptyManager.write(record.runtimeSessionId, writtenInput);
    store.appendTranscript(sessionId, "input", writtenInput);
    const resolvedWaitMs = normalizeWaitMs(waitMs);
    await delay(resolvedWaitMs, context.abortSignal);
    const output = ptyManager.read(record.runtimeSessionId);
    store.appendTranscript(sessionId, "output", output);
    await recordBridgeSessionOutput(context, sessionId, output);
    const firstTurnWriteWarning = record.firstTurnStrategy === "start-args-prompt"
      && !record.firstTurnPromptProvided
      && !record.firstTurnWriteObservedAt
      ? "该 target 的首回合更稳做法是把第一条任务指令放进 bridge_session_start.prompt（或 args.prompt）；当前这次 write 仍已发送，但稳定性可能较弱。"
      : undefined;
    const updated = store.touch(sessionId, {
      ...(record.firstTurnStrategy === "start-args-prompt" && !record.firstTurnWriteObservedAt
        ? { firstTurnWriteObservedAt: Date.now() }
        : {}),
    });
    await store.persistSessionState(sessionId, {
      includeRegistry: updated.firstTurnWriteObservedAt !== record.firstTurnWriteObservedAt,
      includeTranscript: true,
    });
    const firstTurnGuidance = buildFirstTurnGuidance(updated);

    return {
      id: sessionId,
      name,
      success: true,
      output: JSON.stringify({
        ...toSessionPayload(updated),
        waitMs: resolvedWaitMs,
        ...(shouldSubmitLine ? { submitLine: true } : {}),
        output,
        ...(firstTurnWriteWarning ? { firstTurnWarning: firstTurnWriteWarning } : {}),
        ...(firstTurnGuidance ? firstTurnGuidance : {}),
      }, null, 2),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      id: sessionId,
      name,
      success: false,
      output: "",
      error: isAbortError(error)
        ? readAbortReason(context.abortSignal)
        : (error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - start,
    };
  }
}

export async function readBridgeSession(
  sessionId: string,
  waitMs: unknown,
  context: Pick<ToolContext, "workspaceRoot" | "bridgeSessionGovernance" | "abortSignal">,
): Promise<ToolCallResult> {
  const start = Date.now();
  const name = "bridge_session_read";

  try {
    throwIfAborted(context.abortSignal);
    const store = BridgeSessionStore.getInstance();
    await store.ensureLoaded(context.workspaceRoot);
    const record = store.get(sessionId);
    if (!record) {
      throw new Error(`Bridge session 不存在: ${sessionId}`);
    }
    if (record.status !== "active") {
      throw new Error(`Bridge session 已关闭: ${sessionId}`);
    }

    const resolvedWaitMs = normalizeWaitMs(waitMs);
    await delay(resolvedWaitMs, context.abortSignal);
    const ptyManager = PtyManager.getInstance();
    const output = ptyManager.read(record.runtimeSessionId);
    const updated = store.touch(sessionId);
    if (output) {
      store.appendTranscript(sessionId, "output", output);
      await recordBridgeSessionOutput(context, sessionId, output);
      await store.persistSessionState(sessionId, {
        includeRegistry: false,
        includeTranscript: true,
      });
    }

    return {
      id: sessionId,
      name,
      success: true,
      output: JSON.stringify({
        ...toSessionPayload(updated),
        waitMs: resolvedWaitMs,
        output,
      }, null, 2),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      id: sessionId,
      name,
      success: false,
      output: "",
      error: isAbortError(error)
        ? readAbortReason(context.abortSignal)
        : (error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - start,
    };
  }
}

export async function getBridgeSessionStatus(
  sessionId: string,
  context: Pick<ToolContext, "workspaceRoot">,
): Promise<ToolCallResult> {
  const start = Date.now();
  const name = "bridge_session_status";

  try {
    const store = BridgeSessionStore.getInstance();
    await store.ensureLoaded(context.workspaceRoot);
    const record = store.get(sessionId);
    if (!record) {
      throw new Error(`Bridge session 不存在: ${sessionId}`);
    }
    return {
      id: sessionId,
      name,
      success: true,
      output: JSON.stringify(toSessionPayload(record), null, 2),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      id: sessionId,
      name,
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    };
  }
}

export async function closeBridgeSession(
  sessionId: string,
  context: Pick<ToolContext, "workspaceRoot" | "bridgeSessionGovernance">,
): Promise<ToolCallResult> {
  const start = Date.now();
  const name = "bridge_session_close";

  try {
    const store = BridgeSessionStore.getInstance();
    await store.ensureLoaded(context.workspaceRoot);
    const record = store.get(sessionId);
    if (!record) {
      throw new Error(`Bridge session 不存在: ${sessionId}`);
    }
    if (record.status === "active") {
      PtyManager.getInstance().kill(record.runtimeSessionId);
    }
    const closed = await store.close(sessionId, "manual");
    await completeGovernedBridgeSession(context, closed);

    return {
      id: sessionId,
      name,
      success: true,
      output: JSON.stringify(toSessionPayload(closed), null, 2),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      id: sessionId,
      name,
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    };
  }
}

export async function listBridgeSessions(
  context: Pick<ToolContext, "workspaceRoot">,
): Promise<ToolCallResult> {
  const start = Date.now();
  const name = "bridge_session_list";
  const store = BridgeSessionStore.getInstance();
  await store.ensureLoaded(context.workspaceRoot);
  const sessions = store.list().map((record) => toSessionPayload(record));
  return {
    id: `bridge-session-list-${Date.now()}`,
    name,
    success: true,
    output: JSON.stringify({ sessions }, null, 2),
    durationMs: Date.now() - start,
  };
}
