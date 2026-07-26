import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";

import type { PersistedConversationSummary } from "@belldandy/agent";

import {
  CODING_RUN_PROTOCOL_VERSION,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingRunSubscription,
  type RunControl,
} from "../coding-run/contracts.js";
import { runCodingRunStdio } from "../coding-run/stdio-process.js";
import {
  CodingRunNdjsonClient,
  type CodingRunControlResponse,
  type CodingRunConversationRequest,
  type CodingRunConversationResponse,
  type CodingRunSubscriptionResponse,
} from "../coding-run/stdio.js";
import { buildConsoleSnapshot } from "../cli/commands/console.js";
import {
  createConversationStoreForCLI,
  listConversationCLIExportables,
} from "../cli/commands/conversation/_shared.js";
import {
  invokeGatewayMethod,
  type GatewayMethodResult,
} from "../cli/shared/gateway-rpc.js";
import type {
  WorkspaceRevisionRestoreConflictArtifact,
  WorkspaceRevisionRestorePreview,
  WorkspaceRevisionRestoreResult,
  WorkspaceRevisionSummary,
} from "../workspace-revision.js";
import {
  WorkspaceChangeRecoveryRuntime,
} from "../workspace-change-recovery.js";
import {
  WorkspaceChangeSnapshotRuntime,
} from "../workspace-change-snapshot.js";
import type {
  TuiChatEntry,
  TuiChangeSnapshotResult,
  TuiConversationBinding,
  TuiPermissionRequest,
  TuiRuntimeSnapshot,
  TuiWorkspaceChangeSummary,
} from "./state.js";

const execFile = promisify(execFileCallback);
const DEFAULT_TUI_REQUEST_TIMEOUT_MS = 15_000;
const MAX_CHANGED_PATHS = 100;
const MAX_DIFF_STAT_LINES = 40;

export type TuiCodingRunClient = {
  conversation: (conversation: CodingRunConversationRequest) => Promise<CodingRunConversationResponse>;
  subscribe: (subscription: CodingRunSubscription) => Promise<CodingRunSubscriptionResponse>;
  control: (control: RunControl) => Promise<CodingRunControlResponse>;
  close: (reason?: string) => void | Promise<void>;
};

type InvokeGateway = (input: {
  stateDir: string;
  method: string;
  params?: Record<string, unknown>;
  requestIdPrefix: string;
  timeoutMs?: number;
  clientName?: string;
  parsePayload: (payload: Record<string, unknown>) => unknown;
}) => Promise<GatewayMethodResult<unknown>>;

export type CodingTuiRuntimeOptions = {
  stateDir: string;
  cwd: string;
  client: TuiCodingRunClient;
  requestTimeoutMs?: number;
  invokeGateway?: InvokeGateway;
};

type PendingTuiChangeSnapshot = {
  baselineId: string;
};

export class CodingTuiRuntime {
  readonly stateDir: string;
  readonly cwd: string;
  private readonly client: TuiCodingRunClient;
  private readonly requestTimeoutMs: number;
  private readonly invokeGateway: InvokeGateway;
  private readonly changeSnapshotRuntime: WorkspaceChangeSnapshotRuntime;
  private readonly changeRecoveryRuntime: WorkspaceChangeRecoveryRuntime;
  private readonly pendingChangeSnapshots = new Map<string, PendingTuiChangeSnapshot | TuiChangeSnapshotResult>();
  private readonly completedChangeSnapshots = new Map<string, TuiChangeSnapshotResult>();

  constructor(options: CodingTuiRuntimeOptions) {
    this.stateDir = path.resolve(options.stateDir);
    this.cwd = path.resolve(options.cwd);
    this.client = options.client;
    this.requestTimeoutMs = normalizePositiveInteger(options.requestTimeoutMs, DEFAULT_TUI_REQUEST_TIMEOUT_MS);
    this.invokeGateway = options.invokeGateway ?? ((request) => invokeGatewayMethod(request));
    this.changeSnapshotRuntime = new WorkspaceChangeSnapshotRuntime({ stateDir: this.stateDir });
    this.changeRecoveryRuntime = new WorkspaceChangeRecoveryRuntime({ stateDir: this.stateDir });
  }

  async requestConversation(prompt: string, conversationId?: string): Promise<TuiConversationBinding> {
    const text = prompt.trim();
    if (!text) throw new Error("A non-empty prompt is required.");
    const changeSnapshot = await this.captureChangeSnapshot();
    const response = await withTimeout(
      this.client.conversation({
        version: CODING_RUN_PROTOCOL_VERSION,
        text,
        cwd: this.cwd,
        ...(conversationId?.trim() ? { conversationId: conversationId.trim() } : {}),
      }),
      this.requestTimeoutMs,
      "Conversation request timed out.",
    );
    if (!response.ok) throw new Error(response.error.message);
    const binding = readConversationBinding(response.result);
    if (!binding) throw new Error("Gateway returned an incomplete Conversation binding.");
    this.pendingChangeSnapshots.set(binding.agentRunId, changeSnapshot);

    const subscription = await withTimeout(
      this.client.subscribe({
        version: CODING_RUN_PROTOCOL_VERSION,
        binding,
        cursor: 0,
      }),
      this.requestTimeoutMs,
      "Conversation subscription timed out.",
    );
    if (!subscription.ok) throw new Error(subscription.error.message);
    return binding;
  }

  async completeChangeSnapshot(agentRunId: string): Promise<TuiChangeSnapshotResult | undefined> {
    const completed = this.completedChangeSnapshots.get(agentRunId);
    if (completed) return completed;
    const pending = this.pendingChangeSnapshots.get(agentRunId);
    if (!pending) return undefined;
    this.pendingChangeSnapshots.delete(agentRunId);
    if ("status" in pending) {
      this.completedChangeSnapshots.set(agentRunId, pending);
      return pending;
    }
    try {
      const recovery = await this.changeRecoveryRuntime.getCandidate({
        revisionId: agentRunId,
        workspaceRoot: this.cwd,
      });
      const snapshot = await this.changeSnapshotRuntime.createSnapshot({
        baselineId: pending.baselineId,
        revisionId: agentRunId,
        recovery,
      });
      const page = await this.changeSnapshotRuntime.readSnapshotPage({ snapshotId: snapshot.snapshotId });
      const result: TuiChangeSnapshotResult = { status: "available", snapshot, page };
      this.completedChangeSnapshots.set(agentRunId, result);
      return result;
    } catch (error) {
      const result: TuiChangeSnapshotResult = {
        status: "unavailable",
        error: toSafeCodingRunErrorMessage(error),
      };
      this.completedChangeSnapshots.set(agentRunId, result);
      return result;
    }
  }

  async recomputeChangeSnapshot(agentRunId: string): Promise<TuiChangeSnapshotResult | undefined> {
    const previous = this.completedChangeSnapshots.get(agentRunId);
    if (previous?.status !== "available" || !previous.snapshot) return undefined;
    try {
      const recovery = await this.changeRecoveryRuntime.getCandidate({
        revisionId: agentRunId,
        workspaceRoot: this.cwd,
      });
      const snapshot = await this.changeSnapshotRuntime.createSnapshot({
        baselineId: previous.snapshot.baseline.baselineId,
        revisionId: agentRunId,
        recovery,
      });
      const page = await this.changeSnapshotRuntime.readSnapshotPage({ snapshotId: snapshot.snapshotId });
      const result: TuiChangeSnapshotResult = { status: "available", snapshot, page };
      this.completedChangeSnapshots.set(agentRunId, result);
      return result;
    } catch (error) {
      return { status: "unavailable", error: toSafeCodingRunErrorMessage(error) };
    }
  }

  async respondPermission(request: TuiPermissionRequest, decision: "allow" | "deny"): Promise<void> {
    const response = await withTimeout(this.client.control({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "permission.respond",
      binding: {
        agentRunId: request.agentRunId,
        ...(request.worktreeId ? { worktreeId: request.worktreeId } : {}),
      },
      toolCallId: request.toolCallId,
      decision,
    }), this.requestTimeoutMs, "Tool permission response timed out.");
    if (!response.ok) throw new Error(response.error.message);
  }

  async cancel(binding: TuiConversationBinding): Promise<void> {
    const response = await withTimeout(this.client.control({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "cancel",
      binding,
      reason: "Cancelled from TUI.",
    }), this.requestTimeoutMs, "Conversation cancellation timed out.");
    if (!response.ok) throw new Error(response.error.message);
  }

  async listConversations(): Promise<PersistedConversationSummary[]> {
    return listConversationCLIExportables({ stateDir: this.stateDir, limit: 100 });
  }

  async loadConversationChat(conversationId: string): Promise<TuiChatEntry[]> {
    const store = createConversationStoreForCLI(this.stateDir);
    const restore = await store.buildConversationRestoreView(conversationId);
    return restore.rawMessages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, text: message.content }))
      .slice(-40);
  }

  async inspectWorkspace(): Promise<TuiWorkspaceChangeSummary> {
    return inspectWorkspaceChanges(this.cwd);
  }

  async listRevisions(): Promise<WorkspaceRevisionSummary[]> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.revision.list",
      params: {},
      requestIdPrefix: "bdd-tui-revision-list",
      clientName: "bdd tui",
      parsePayload: parseRevisionList,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as WorkspaceRevisionSummary[];
  }

  async previewRevision(revisionId: string, workspaceId?: string): Promise<WorkspaceRevisionRestorePreview> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.revision.preview",
      params: { revisionId, ...(workspaceId ? { workspaceId } : {}) },
      requestIdPrefix: "bdd-tui-revision-preview",
      clientName: "bdd tui",
      parsePayload: parseRevisionPreview,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as WorkspaceRevisionRestorePreview;
  }

  async restoreRevision(revisionId: string, workspaceId?: string): Promise<WorkspaceRevisionRestoreResult> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.revision.restore",
      params: { revisionId, ...(workspaceId ? { workspaceId } : {}), apply: true },
      requestIdPrefix: "bdd-tui-revision-restore",
      clientName: "bdd tui",
      parsePayload: parseRevisionResult,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as WorkspaceRevisionRestoreResult;
  }

  async loadRuntimeSnapshot(): Promise<TuiRuntimeSnapshot> {
    const snapshot = await buildConsoleSnapshot(this.stateDir);
    return {
      generatedAt: snapshot.generatedAt,
      gatewayConnected: snapshot.gateway.connected,
      gatewayPaired: snapshot.gateway.paired,
      checks: { ...snapshot.checkSummary },
      agents: {
        total: snapshot.agentSummary.total,
        running: snapshot.agentSummary.running + snapshot.agentSummary.background,
        error: snapshot.agentSummary.error,
      },
      subtasks: {
        total: snapshot.subtaskSummary.total,
        active: snapshot.subtaskSummary.active,
        failed: snapshot.subtaskSummary.failed,
      },
      hints: snapshot.hints.slice(0, 6),
    };
  }

  private async captureChangeSnapshot(): Promise<PendingTuiChangeSnapshot | TuiChangeSnapshotResult> {
    const baselineId = `tui-run-${randomUUID()}`;
    try {
      await this.changeSnapshotRuntime.captureBaseline({
        baselineId,
        workspaceRoot: this.cwd,
        source: "run_start",
      });
      return { baselineId };
    } catch (error) {
      return { status: "unavailable", error: toSafeCodingRunErrorMessage(error) };
    }
  }

  async close(): Promise<void> {
    await this.client.close("Star Sanctuary TUI closed.");
  }
}

export function createCodingTuiRuntime(input: {
  stateDir: string;
  cwd: string;
  onEvent: (event: AgentRunEvent) => void;
  onSubscriptionError?: (error: { code: string; message: string }) => void;
  onProtocolError?: (error: { code: string; message: string }) => void;
  onBridgeError?: (message: string) => void;
}): CodingTuiRuntime {
  const client = createInProcessCodingRunClient(input);
  return new CodingTuiRuntime({ stateDir: input.stateDir, cwd: input.cwd, client });
}

function createInProcessCodingRunClient(input: {
  stateDir: string;
  onEvent: (event: AgentRunEvent) => void;
  onSubscriptionError?: (error: { code: string; message: string }) => void;
  onProtocolError?: (error: { code: string; message: string }) => void;
  onBridgeError?: (message: string) => void;
}): TuiCodingRunClient {
  const bridgeInput = new PassThrough();
  let completion: Promise<number>;
  const client = new CodingRunNdjsonClient({
    write: (line) => writeStream(bridgeInput, line),
    onEvent: input.onEvent,
    onSubscriptionError: input.onSubscriptionError,
    onProtocolError: input.onProtocolError,
  });
  completion = runCodingRunStdio({
    stateDir: input.stateDir,
    conversationFrom: "tui",
    input: bridgeInput,
    writeStdout: (line) => client.consume(line),
    writeStderr: (line) => input.onBridgeError?.(toSafeCodingRunErrorMessage(line)),
  }).catch((error) => {
    input.onBridgeError?.(toSafeCodingRunErrorMessage(error));
    return 4;
  });
  return {
    conversation: (conversation) => client.conversation(conversation),
    subscribe: (subscription) => client.subscribe(subscription),
    control: (control) => client.control(control),
    close: async (reason) => {
      bridgeInput.end();
      client.close(reason);
      await completion;
    },
  };
}

export async function inspectWorkspaceChanges(cwd: string): Promise<TuiWorkspaceChangeSummary & { diffStat?: string[] }> {
  const resolvedCwd = path.resolve(cwd);
  try {
    const repoRoot = path.resolve(await runGit(["rev-parse", "--show-toplevel"], resolvedCwd));
    const branch = await runGit(["branch", "--show-current"], resolvedCwd);
    const gitDir = resolveGitPath(await runGit(["rev-parse", "--git-dir"], resolvedCwd), resolvedCwd);
    const commonDir = resolveGitPath(await runGit(["rev-parse", "--git-common-dir"], resolvedCwd), resolvedCwd);
    const status = await runGit(["status", "--porcelain=v1", "-z"], resolvedCwd, true);
    const parsed = parsePorcelainStatus(status);
    const unstaged = await runGit(["diff", "--stat", "--no-ext-diff", "--"], resolvedCwd);
    const staged = await runGit(["diff", "--cached", "--stat", "--no-ext-diff", "--"], resolvedCwd);
    const diffStat = [...splitLines(staged), ...splitLines(unstaged)].slice(0, MAX_DIFF_STAT_LINES);
    return {
      cwd: resolvedCwd,
      repoRoot,
      branch: branch || "detached",
      worktree: normalizePathForCompare(gitDir) !== normalizePathForCompare(commonDir),
      ...parsed,
      ...(diffStat.length > 0 ? { diffStat } : {}),
    };
  } catch (error) {
    return {
      cwd: resolvedCwd,
      trackedChanges: 0,
      untrackedChanges: 0,
      conflictChanges: 0,
      changedPaths: [],
      error: toSafeCodingRunErrorMessage(error),
    };
  }
}

function parsePorcelainStatus(value: string): Pick<
  TuiWorkspaceChangeSummary,
  "trackedChanges" | "untrackedChanges" | "conflictChanges" | "changedPaths"
> {
  const records = value.split("\0").filter(Boolean);
  let trackedChanges = 0;
  let untrackedChanges = 0;
  let conflictChanges = 0;
  const changedPaths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const code = record.slice(0, 2);
    const filePath = record.length > 3 ? record.slice(3) : "";
    if (filePath && changedPaths.length < MAX_CHANGED_PATHS) changedPaths.push(filePath);
    if (code === "??") {
      untrackedChanges += 1;
      continue;
    }
    if (isConflictCode(code)) {
      conflictChanges += 1;
      continue;
    }
    trackedChanges += 1;
    if ((code.includes("R") || code.includes("C")) && records[index + 1]) {
      index += 1;
      if (changedPaths.length < MAX_CHANGED_PATHS) changedPaths.push(records[index]);
    }
  }
  return { trackedChanges, untrackedChanges, conflictChanges, changedPaths };
}

function parseRevisionList(payload: Record<string, unknown>): WorkspaceRevisionSummary[] {
  const checkpoints = Array.isArray(payload.checkpoints) ? payload.checkpoints : [];
  return checkpoints.flatMap((item) => {
    const summary = parseRevisionSummary(item);
    return summary ? [summary] : [];
  });
}

function parseRevisionPreview(payload: Record<string, unknown>): WorkspaceRevisionRestorePreview {
  const summary = parseRevisionSummary(payload);
  if (!summary || typeof payload.canRestore !== "boolean" || !Array.isArray(payload.changes)) {
    throw new Error("Gateway returned an invalid workspace revision preview.");
  }
  const conflictArtifact = parseRevisionConflictArtifact(payload.conflictArtifact);
  return {
    ...summary,
    canRestore: payload.canRestore,
    changes: parseRevisionChanges(payload.changes),
    ...(conflictArtifact ? { conflictArtifact } : {}),
  };
}

function parseRevisionResult(payload: Record<string, unknown>): WorkspaceRevisionRestoreResult {
  const preview = parseRevisionPreview(payload);
  if (typeof payload.applied !== "boolean") {
    throw new Error("Gateway returned an invalid workspace revision restore result.");
  }
  return { ...preview, applied: payload.applied };
}

function parseRevisionSummary(value: unknown): WorkspaceRevisionSummary | undefined {
  if (!isRecord(value)) return undefined;
  const revisionId = readString(value.revisionId);
  const workspaceId = readString(value.workspaceId);
  const workspaceRoot = readString(value.workspaceRoot);
  if (!revisionId || !workspaceId || !workspaceRoot
    || !isFiniteNumber(value.createdAtMs)
    || !isFiniteNumber(value.updatedAtMs)
    || !isFiniteNumber(value.changedFileCount)
    || value.recoveryGuarantee !== "exact") {
    return undefined;
  }
  return {
    revisionId,
    workspaceId,
    workspaceRoot,
    createdAtMs: value.createdAtMs,
    updatedAtMs: value.updatedAtMs,
    changedFileCount: Math.max(0, Math.trunc(value.changedFileCount)),
    recoveryGuarantee: "exact",
  };
}

function parseRevisionChanges(value: unknown[]): WorkspaceRevisionRestorePreview["changes"] {
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const relativePath = readString(item.relativePath);
    const action = item.action;
    if (!relativePath || (action !== "restore" && action !== "delete" && action !== "unchanged" && action !== "conflict")) {
      return [];
    }
    const reason = readString(item.reason);
    const recordedAfterHash = readSha256(item.recordedAfterHash);
    const currentHash = readSha256(item.currentHash);
    return [{
      relativePath,
      action,
      ...(reason ? { reason } : {}),
      ...(recordedAfterHash ? { recordedAfterHash } : {}),
      ...(currentHash ? { currentHash } : {}),
    }];
  });
}

function parseRevisionConflictArtifact(value: unknown): WorkspaceRevisionRestoreConflictArtifact | undefined {
  if (!isRecord(value)) return undefined;
  const artifactPath = readString(value.artifactPath);
  const capturedAtMs = isFiniteNumber(value.capturedAtMs) ? value.capturedAtMs : undefined;
  const conflictCount = typeof value.conflictCount === "number" && Number.isSafeInteger(value.conflictCount)
    ? value.conflictCount
    : undefined;
  if (!artifactPath || capturedAtMs === undefined || conflictCount === undefined || conflictCount < 1) return undefined;
  return { artifactPath, capturedAtMs, conflictCount };
}

function readSha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function readConversationBinding(value: unknown): TuiConversationBinding | undefined {
  if (!isRecord(value) || !isRecord(value.binding)) return undefined;
  const conversationId = readString(value.binding.conversationId);
  const agentRunId = readString(value.binding.agentRunId);
  return conversationId && agentRunId ? { conversationId, agentRunId } : undefined;
}

function runGit(args: string[], cwd: string, preserveWhitespace = false): Promise<string> {
  return execFile("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  }).then(({ stdout }) => {
    const value = String(stdout ?? "");
    return preserveWhitespace ? value : value.trim();
  });
}

function resolveGitPath(value: string, cwd: string): string {
  return path.resolve(cwd, value);
}

function normalizePathForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

function isConflictCode(code: string): boolean {
  return code === "DD" || code === "AU" || code === "UD" || code === "UA"
    || code === "DU" || code === "AA" || code === "UU";
}

function writeStream(stream: PassThrough, line: string): Promise<void> {
  if (stream.write(line)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
