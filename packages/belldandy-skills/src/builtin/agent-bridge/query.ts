import { PtyManager } from "../system/pty.js";
import { BridgeSessionStore } from "./sessions.js";
import type { BridgeSessionRecord, BridgeSessionTranscriptEvent } from "./types.js";

const DEFAULT_TRANSCRIPT_LIMIT = 60;
const MAX_TRANSCRIPT_LIMIT = 200;
const MAX_LIVE_OUTPUT_CHARS = 16_000;
const PREVIEW_CHAR_LIMIT = 280;

function normalizePositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    return fallback;
  }
  return Math.min(normalized, max);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}…`;
}

function pickLatestOutputPreview(
  transcript: BridgeSessionTranscriptEvent[],
  liveOutput: string,
): string {
  const normalizedLiveOutput = typeof liveOutput === "string" ? liveOutput.trim() : "";
  if (normalizedLiveOutput) {
    return truncateText(normalizedLiveOutput.replace(/\s+/g, " "), PREVIEW_CHAR_LIMIT);
  }
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = transcript[index];
    if (!event || (event.direction !== "output" && event.direction !== "system")) {
      continue;
    }
    const normalized = event.content.trim();
    if (!normalized) {
      continue;
    }
    return truncateText(normalized.replace(/\s+/g, " "), PREVIEW_CHAR_LIMIT);
  }
  return "";
}

function toRuntimeView(
  record: BridgeSessionRecord,
  transcript: BridgeSessionTranscriptEvent[],
  liveOutput: string,
): BridgeSessionRuntimeView {
  const latestEvent = transcript.length > 0 ? transcript[transcript.length - 1] : undefined;
  const latestOutputPreview = pickLatestOutputPreview(transcript, liveOutput);
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
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.closedAt ? { closedAt: record.closedAt } : {}),
    ...(record.closeReason ? { closeReason: record.closeReason } : {}),
    ...(record.firstTurnStrategy ? { firstTurnStrategy: record.firstTurnStrategy } : {}),
    ...(record.firstTurnHint ? { firstTurnHint: record.firstTurnHint } : {}),
    ...(record.recommendedReadWaitMs ? { recommendedReadWaitMs: record.recommendedReadWaitMs } : {}),
    ...(record.firstTurnPromptProvided !== undefined ? { firstTurnPromptProvided: record.firstTurnPromptProvided } : {}),
    ...(record.firstTurnWriteObservedAt ? { firstTurnWriteObservedAt: record.firstTurnWriteObservedAt } : {}),
    ...(record.idleTimeoutMs ? { idleTimeoutMs: record.idleTimeoutMs } : {}),
    ...(record.idleDeadlineAt ? { idleDeadlineAt: record.idleDeadlineAt } : {}),
    ...(record.artifactPath ? { artifactPath: record.artifactPath } : {}),
    ...(record.transcriptPath ? { transcriptPath: record.transcriptPath } : {}),
    transcriptEventCount: transcript.length,
    ...(latestEvent ? { latestEventAt: latestEvent.timestamp } : {}),
    ...(latestOutputPreview ? { latestOutputPreview } : {}),
    hasBufferedOutput: Boolean(liveOutput),
    bufferedOutputChars: liveOutput.length,
  };
}

export type BridgeSessionRuntimeView = {
  sessionId: string;
  taskId?: string;
  targetId: string;
  action: string;
  transport: "pty";
  cwd: string;
  commandPreview: string;
  cols: number;
  rows: number;
  status: "active" | "closed";
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
  firstTurnStrategy?: "start-args-prompt" | "write";
  firstTurnHint?: string;
  recommendedReadWaitMs?: number;
  firstTurnPromptProvided?: boolean;
  firstTurnWriteObservedAt?: number;
  idleTimeoutMs?: number;
  idleDeadlineAt?: number;
  artifactPath?: string;
  transcriptPath?: string;
  transcriptEventCount: number;
  latestEventAt?: number;
  latestOutputPreview?: string;
  hasBufferedOutput: boolean;
  bufferedOutputChars: number;
};

export type BridgeSessionPeekView = {
  session: BridgeSessionRuntimeView;
  liveOutput: string;
  transcriptTail: BridgeSessionTranscriptEvent[];
  transcriptEventCount: number;
};

export async function listBridgeSessionRuntimeViews(
  workspaceRoot: string,
): Promise<{
  sessions: BridgeSessionRuntimeView[];
  activeCount: number;
  closedCount: number;
}> {
  const store = BridgeSessionStore.getInstance();
  await store.ensureLoaded(workspaceRoot);
  const manager = PtyManager.getInstance();
  const sessions = store.list().map((record) => {
    const transcript = store.getTranscript(record.id);
    const liveOutput = record.status === "active"
      ? truncateText(manager.peek(record.runtimeSessionId), MAX_LIVE_OUTPUT_CHARS)
      : "";
    return toRuntimeView(record, transcript, liveOutput);
  }).sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "active" ? -1 : 1;
    }
    return right.updatedAt - left.updatedAt;
  });
  return {
    sessions,
    activeCount: sessions.filter((item) => item.status === "active").length,
    closedCount: sessions.filter((item) => item.status === "closed").length,
  };
}

export async function peekBridgeSessionRuntimeView(
  workspaceRoot: string,
  sessionId: string,
  options: {
    transcriptLimit?: number;
  } = {},
): Promise<BridgeSessionPeekView | undefined> {
  const store = BridgeSessionStore.getInstance();
  await store.ensureLoaded(workspaceRoot);
  const record = store.get(sessionId);
  if (!record) {
    return undefined;
  }
  const manager = PtyManager.getInstance();
  const transcript = store.getTranscript(sessionId);
  const transcriptLimit = normalizePositiveInt(
    options.transcriptLimit,
    DEFAULT_TRANSCRIPT_LIMIT,
    MAX_TRANSCRIPT_LIMIT,
  );
  const transcriptTail = transcript.slice(-transcriptLimit);
  const liveOutput = record.status === "active"
    ? truncateText(manager.peek(record.runtimeSessionId), MAX_LIVE_OUTPUT_CHARS)
    : "";
  return {
    session: toRuntimeView(record, transcript, liveOutput),
    liveOutput,
    transcriptTail,
    transcriptEventCount: transcript.length,
  };
}
