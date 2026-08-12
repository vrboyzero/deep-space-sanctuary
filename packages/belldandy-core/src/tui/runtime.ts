import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";

import type { PersistedConversationSummary } from "@belldandy/agent";
import {
  sanitizeCommandPermissionPreview,
  type CommandJobReadResult,
  type CommandJobSnapshot,
} from "@belldandy/skills";

import {
  CODING_RUN_PROTOCOL_VERSION,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingRunSubscription,
  type RunControl,
} from "../coding-run/contracts.js";
import type { TaskProjectionCollectionCursor, TaskProjectionCollectionPage } from "../coding-run/task-projection-collection.js";
import { parseTaskProjectionCollectionPage } from "../coding-run/task-projection-consumer.js";
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
  RemoteDeliveryPreview,
  RemoteDeliveryResult,
  RemoteDeliveryTarget,
} from "../remote-delivery-runtime.js";
import type {
  TuiChatEntry,
  TuiChangeSnapshotResult,
  TuiConversationBinding,
  TuiPermissionRequest,
  TuiRuntimeSnapshot,
  TuiWorkspaceTarget,
  TuiWorkspaceChangeSummary,
} from "./state.js";

const execFile = promisify(execFileCallback);
const DEFAULT_TUI_REQUEST_TIMEOUT_MS = 15_000;
const MAX_CHANGED_PATHS = 100;
const MAX_DIFF_STAT_LINES = 40;
const MAX_TUI_COMMAND_JOB_READ_BYTES = 16 * 1024;
const MAX_TUI_WORKSPACE_TARGETS = 100;

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
  workspaceRoot: string;
};

export class CodingTuiRuntime {
  readonly stateDir: string;
  private readonly launchCwd: string;
  private currentCwd: string;
  private currentWorktreeId?: string;
  private readonly client: TuiCodingRunClient;
  private readonly requestTimeoutMs: number;
  private readonly invokeGateway: InvokeGateway;
  private readonly changeSnapshotRuntime: WorkspaceChangeSnapshotRuntime;
  private readonly changeRecoveryRuntime: WorkspaceChangeRecoveryRuntime;
  private readonly pendingChangeSnapshots = new Map<string, PendingTuiChangeSnapshot | TuiChangeSnapshotResult>();
  private readonly completedChangeSnapshots = new Map<string, TuiChangeSnapshotResult>();
  private readonly changeSnapshotWorkspaceRoots = new Map<string, string>();

  constructor(options: CodingTuiRuntimeOptions) {
    this.stateDir = path.resolve(options.stateDir);
    this.launchCwd = path.resolve(options.cwd);
    this.currentCwd = this.launchCwd;
    this.client = options.client;
    this.requestTimeoutMs = normalizePositiveInteger(options.requestTimeoutMs, DEFAULT_TUI_REQUEST_TIMEOUT_MS);
    this.invokeGateway = options.invokeGateway ?? ((request) => invokeGatewayMethod(request));
    this.changeSnapshotRuntime = new WorkspaceChangeSnapshotRuntime({ stateDir: this.stateDir });
    this.changeRecoveryRuntime = new WorkspaceChangeRecoveryRuntime({ stateDir: this.stateDir });
  }

  get cwd(): string {
    return this.currentCwd;
  }

  async requestConversation(prompt: string, conversationId?: string): Promise<TuiConversationBinding> {
    const text = prompt.trim();
    if (!text) throw new Error("A non-empty prompt is required.");
    const workspaceRoot = this.cwd;
    const changeSnapshot = await this.captureChangeSnapshot(workspaceRoot);
    const response = await withTimeout(
      this.client.conversation({
        version: CODING_RUN_PROTOCOL_VERSION,
        text,
        cwd: workspaceRoot,
        ...(conversationId?.trim() ? { conversationId: conversationId.trim() } : {}),
      }),
      this.requestTimeoutMs,
      "Conversation request timed out.",
    );
    if (!response.ok) throw new Error(response.error.message);
    const binding = readConversationBinding(response.result);
    if (!binding) throw new Error("Gateway returned an incomplete Conversation binding.");
    this.pendingChangeSnapshots.set(binding.agentRunId, changeSnapshot);
    this.changeSnapshotWorkspaceRoots.set(binding.agentRunId, workspaceRoot);

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
        workspaceRoot: pending.workspaceRoot,
      });
      const snapshot = await this.changeSnapshotRuntime.createSnapshot({
        baselineId: pending.baselineId,
        revisionId: agentRunId,
        recovery,
      });
      const page = await this.readChangeSnapshotPage(snapshot.snapshotId);
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
    const workspaceRoot = this.changeSnapshotWorkspaceRoots.get(agentRunId);
    if (previous?.status !== "available" || !previous.snapshot || !workspaceRoot) return undefined;
    try {
      const recovery = await this.changeRecoveryRuntime.getCandidate({
        revisionId: agentRunId,
        workspaceRoot,
      });
      const snapshot = await this.changeSnapshotRuntime.createSnapshot({
        baselineId: previous.snapshot.baseline.baselineId,
        revisionId: agentRunId,
        recovery,
      });
      const page = await this.readChangeSnapshotPage(snapshot.snapshotId);
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

  async listPendingPermissions(): Promise<TuiPermissionRequest[]> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "coding.run.permission.list",
      params: {},
      requestIdPrefix: "bdd-tui-permission-list",
      clientName: "bdd tui",
      parsePayload: parsePendingPermissionList,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as TuiPermissionRequest[];
  }

  async listTaskProjections(input: {
    limit?: number;
    cursor?: TaskProjectionCollectionCursor;
  } = {}): Promise<TaskProjectionCollectionPage> {
    const params = {
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    };
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "task.projection.list",
      params,
      requestIdPrefix: "bdd-tui-task-projection-list",
      clientName: "bdd tui",
      parsePayload: parseTaskProjectionCollectionPage,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as TaskProjectionCollectionPage;
  }

  async readChangeSnapshotPage(snapshotId: string, cursor?: string) {
    return this.changeSnapshotRuntime.readSnapshotPage({
      snapshotId,
      ...(cursor ? { cursor } : {}),
      maxHunks: 1,
    });
  }

  async steer(binding: TuiConversationBinding, prompt: string): Promise<void> {
    const text = prompt.trim();
    if (!text) throw new Error("A non-empty steer prompt is required.");
    const response = await withTimeout(this.client.control({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.steer",
      binding,
      prompt: text,
      idempotencyKey: `tui-steer-${randomUUID()}`,
    }), this.requestTimeoutMs, "Conversation steer timed out.");
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

  async listWorkspaceTargets(): Promise<TuiWorkspaceTarget[]> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.worktree.status",
      params: {},
      requestIdPrefix: "bdd-tui-worktree-list",
      clientName: "bdd tui",
      parsePayload: parseWorkspaceTargetList,
    });
    if (!result.ok) throw new Error(result.error);
    const managed = (result.payload as TuiWorkspaceTarget[])
      .filter((target) => !samePath(target.cwd, this.launchCwd));
    return [createLaunchWorkspaceTarget(this.launchCwd), ...managed].slice(0, MAX_TUI_WORKSPACE_TARGETS);
  }

  async listRemoteDeliveryTargets(): Promise<RemoteDeliveryTarget[]> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.remote_delivery.targets",
      params: {
        cwd: this.cwd,
        ...(this.currentWorktreeId ? { worktreeId: this.currentWorktreeId } : {}),
      },
      requestIdPrefix: "bdd-tui-remote-targets",
      clientName: "bdd tui",
      parsePayload: parseRemoteDeliveryTargets,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as RemoteDeliveryTarget[];
  }

  async previewRemotePush(remote: string, targetBranch: string): Promise<RemoteDeliveryPreview> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.remote_delivery.push.preview",
      params: {
        cwd: this.cwd,
        ...(this.currentWorktreeId ? { worktreeId: this.currentWorktreeId } : {}),
        remote,
        targetBranch,
      },
      requestIdPrefix: "bdd-tui-remote-push-preview",
      clientName: "bdd tui",
      parsePayload: parseRemoteDeliveryPreview,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as RemoteDeliveryPreview;
  }

  async confirmRemotePush(receiptId: string): Promise<RemoteDeliveryResult> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.remote_delivery.push.confirm",
      params: { receiptId, confirm: true },
      requestIdPrefix: "bdd-tui-remote-push-confirm",
      clientName: "bdd tui",
      parsePayload: parseRemoteDeliveryResult,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as RemoteDeliveryResult;
  }

  async switchWorkspace(targetKey: string): Promise<TuiWorkspaceTarget> {
    if (targetKey === "launch") {
      const cwd = await resolveExistingDirectory(this.launchCwd);
      const target = createLaunchWorkspaceTarget(cwd);
      this.currentCwd = cwd;
      this.currentWorktreeId = undefined;
      return target;
    }
    const worktreeId = targetKey.startsWith("worktree:")
      ? readSafeWorktreeId(targetKey.slice("worktree:".length))
      : undefined;
    if (!worktreeId) throw new Error("Workspace switch requires an exact managed worktree target.");
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.worktree.status",
      params: { worktreeId },
      requestIdPrefix: "bdd-tui-worktree-status",
      clientName: "bdd tui",
      parsePayload: parseWorkspaceTargetList,
    });
    if (!result.ok) throw new Error(result.error);
    const targets = result.payload as TuiWorkspaceTarget[];
    const target = targets.length === 1 && targets[0]?.worktreeId === worktreeId
      ? targets[0]
      : undefined;
    if (!target || target.targetKey !== targetKey || target.status === "unavailable") {
      throw new Error("Gateway did not return the exact available managed worktree target.");
    }
    const cwd = await resolveExistingDirectory(target.cwd);
    const resolved = { ...target, cwd };
    this.currentCwd = cwd;
    this.currentWorktreeId = worktreeId;
    return resolved;
  }

  async listRevisions(): Promise<WorkspaceRevisionSummary[]> {
    const workspaceRoot = this.cwd;
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "workspace.revision.list",
      params: {},
      requestIdPrefix: "bdd-tui-revision-list",
      clientName: "bdd tui",
      parsePayload: parseRevisionList,
    });
    if (!result.ok) throw new Error(result.error);
    return (result.payload as WorkspaceRevisionSummary[])
      .filter((revision) => samePath(revision.workspaceRoot, workspaceRoot));
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

  async listCommandJobs(): Promise<CommandJobSnapshot[]> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "command.job.list",
      params: {},
      requestIdPrefix: "bdd-tui-command-job-list",
      clientName: "bdd tui",
      parsePayload: parseCommandJobList,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as CommandJobSnapshot[];
  }

  async readCommandJob(jobId: string, cursor?: number): Promise<CommandJobReadResult> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "command.job.read",
      params: {
        jobId,
        ...(cursor !== undefined ? { cursor } : {}),
        maxBytes: MAX_TUI_COMMAND_JOB_READ_BYTES,
      },
      requestIdPrefix: "bdd-tui-command-job-read",
      clientName: "bdd tui",
      parsePayload: parseCommandJobReadResult,
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as CommandJobReadResult;
  }

  async cancelCommandJob(jobId: string): Promise<CommandJobSnapshot> {
    const result = await this.invokeGateway({
      stateDir: this.stateDir,
      method: "command.job.cancel",
      params: { jobId },
      requestIdPrefix: "bdd-tui-command-job-cancel",
      clientName: "bdd tui",
      parsePayload: (payload) => {
        const snapshot = parseCommandJobSnapshot(payload);
        if (!snapshot || snapshot.jobId !== jobId) {
          throw new Error("Gateway returned an invalid command job cancellation result.");
        }
        return snapshot;
      },
    });
    if (!result.ok) throw new Error(result.error);
    return result.payload as CommandJobSnapshot;
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

  private async captureChangeSnapshot(workspaceRoot: string): Promise<PendingTuiChangeSnapshot | TuiChangeSnapshotResult> {
    const baselineId = `tui-run-${randomUUID()}`;
    try {
      await this.changeSnapshotRuntime.captureBaseline({
        baselineId,
        workspaceRoot,
        source: "run_start",
      });
      return { baselineId, workspaceRoot };
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

function parseWorkspaceTargetList(payload: Record<string, unknown>): TuiWorkspaceTarget[] {
  const worktrees = Array.isArray(payload.worktrees)
    ? payload.worktrees.slice(0, MAX_TUI_WORKSPACE_TARGETS)
    : [];
  return worktrees.flatMap((value) => {
    if (!isRecord(value)) return [];
    const worktreeId = readSafeWorktreeId(value.worktreeId);
    const cwd = readAbsolutePath(value.worktreePath);
    const branch = readTuiIdentifier(value.branch);
    const status = value.status;
    if (!worktreeId || !cwd || !branch
      || (status !== "ready" && status !== "blocked" && status !== "unavailable")) {
      return [];
    }
    const target: TuiWorkspaceTarget = {
      targetKey: `worktree:${worktreeId}`,
      kind: "managed",
      worktreeId,
      cwd,
      branch,
      status,
    };
    if (typeof value.dirty === "boolean") target.dirty = value.dirty;
    for (const field of ["trackedChanges", "untrackedChanges", "conflictChanges", "extraCommitCount"] as const) {
      const count = readNonNegativeSafeInteger(value[field]);
      if (count !== undefined) target[field] = count;
    }
    return [target];
  });
}

function parseRemoteDeliveryTargets(payload: Record<string, unknown>): RemoteDeliveryTarget[] {
  const targets = Array.isArray(payload.targets) ? payload.targets.slice(0, 50) : [];
  return targets.flatMap((value) => {
    if (!isRecord(value)) return [];
    const remote = readSafeWorktreeId(value.remote);
    const url = readBoundedText(value.url, 2048);
    const pushBranches = readStringList(value.pushBranches, 100);
    const pullRequestBases = value.pullRequestBases === undefined
      ? undefined
      : readStringList(value.pullRequestBases, 100);
    const repository = value.repository === undefined ? undefined : readTuiIdentifier(value.repository);
    if (!remote || !url || !pushBranches || pushBranches.length === 0
      || (value.pullRequestBases !== undefined && !pullRequestBases)
      || (value.repository !== undefined && !repository)) return [];
    return [{
      remote,
      url,
      pushBranches,
      ...(pullRequestBases ? { pullRequestBases } : {}),
      ...(repository ? { repository } : {}),
    }];
  });
}

function parseRemoteDeliveryPreview(payload: Record<string, unknown>): RemoteDeliveryPreview {
  if (payload.operation !== "push" || typeof payload.canConfirm !== "boolean") {
    throw new Error("Gateway returned an invalid remote push preview.");
  }
  const blockers = readStringList(payload.blockers, 100);
  if (!blockers) throw new Error("Gateway returned invalid remote push blockers.");
  const preview: RemoteDeliveryPreview = { operation: "push", canConfirm: payload.canConfirm, blockers };
  if (isRecord(payload.approval)) {
    if (payload.approval.mode !== "user_interaction"
      || payload.approval.delegable !== false
      || payload.approval.rememberable !== false) {
      throw new Error("Gateway returned an invalid remote push approval contract.");
    }
    preview.approval = { mode: "user_interaction", delegable: false, rememberable: false };
  }
  if (isRecord(payload.source)) {
    const repoRoot = readAbsolutePath(payload.source.repoRoot);
    const branch = readTuiIdentifier(payload.source.branch);
    const commit = readGitOid(payload.source.commit);
    const upstream = payload.source.upstream === null ? null : readTuiIdentifier(payload.source.upstream);
    if (!repoRoot || !branch || !commit || upstream === undefined) {
      throw new Error("Gateway returned an invalid remote push source.");
    }
    preview.source = { repoRoot, branch, commit, upstream };
  }
  if (isRecord(payload.target)) {
    const remote = readSafeWorktreeId(payload.target.remote);
    const url = readBoundedText(payload.target.url, 2048);
    const branch = readTuiIdentifier(payload.target.branch);
    const expectedOid = payload.target.expectedOid === null ? null : readGitOid(payload.target.expectedOid);
    if (!remote || !url || !branch || expectedOid === undefined) {
      throw new Error("Gateway returned an invalid remote push target.");
    }
    preview.target = { remote, url, branch, expectedOid };
  }
  if (isRecord(payload.diff)) {
    const baseBranch = payload.diff.baseBranch === undefined ? undefined : readTuiIdentifier(payload.diff.baseBranch);
    const baseOid = readGitOid(payload.diff.baseOid);
    const diffHash = readSha256(payload.diff.sha256);
    const byteLength = readNonNegativeSafeInteger(payload.diff.byteLength);
    if (!baseOid || !diffHash || byteLength === undefined
      || (payload.diff.baseBranch !== undefined && !baseBranch)) {
      throw new Error("Gateway returned an invalid remote push diff.");
    }
    preview.diff = { ...(baseBranch ? { baseBranch } : {}), baseOid, sha256: diffHash, byteLength };
  }
  if (isRecord(payload.receipt)) {
    const receiptId = readTuiIdentifier(payload.receipt.receiptId);
    const expiresAtMs = readNonNegativeSafeInteger(payload.receipt.expiresAtMs);
    if (!receiptId || expiresAtMs === undefined) throw new Error("Gateway returned an invalid remote push receipt.");
    preview.receipt = { receiptId, expiresAtMs };
  }
  if (preview.canConfirm
    && (!preview.approval || !preview.source || !preview.target || !preview.diff || !preview.receipt || blockers.length > 0)) {
    throw new Error("Gateway returned an incomplete confirmable remote push preview.");
  }
  return preview;
}

function parseRemoteDeliveryResult(payload: Record<string, unknown>): RemoteDeliveryResult {
  if (payload.operation !== "push"
    || (payload.outcome !== "succeeded" && payload.outcome !== "failed" && payload.outcome !== "uncertain")
    || typeof payload.applied !== "boolean") {
    throw new Error("Gateway returned an invalid remote push result.");
  }
  const blockers = readStringList(payload.blockers, 100);
  if (!blockers) throw new Error("Gateway returned invalid remote push blockers.");
  const result: RemoteDeliveryResult = {
    operation: "push",
    outcome: payload.outcome,
    applied: payload.applied,
    blockers,
  };
  if (isRecord(payload.postcondition)) {
    const remoteOid = readGitOid(payload.postcondition.remoteOid);
    if (!remoteOid) throw new Error("Gateway returned an invalid remote push postcondition.");
    result.postcondition = { remoteOid };
  }
  if ((result.outcome === "succeeded"
      && (!result.applied || !result.postcondition || blockers.length > 0))
    || (result.outcome === "uncertain"
      && (!result.applied || !result.postcondition || blockers.length === 0))
    || (result.outcome === "failed" && (result.applied || blockers.length === 0))) {
    throw new Error("Gateway returned an inconsistent remote push outcome.");
  }
  return result;
}

function parseCommandJobList(payload: Record<string, unknown>): CommandJobSnapshot[] {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  return jobs.flatMap((item) => {
    const snapshot = parseCommandJobSnapshot(item);
    return snapshot ? [snapshot] : [];
  });
}

function parsePendingPermissionList(payload: Record<string, unknown>): TuiPermissionRequest[] {
  const permissions = Array.isArray(payload.permissions) ? payload.permissions.slice(0, 100) : [];
  return permissions.flatMap((value) => {
    if (!isRecord(value)) return [];
    const conversationId = readTuiIdentifier(value.conversationId);
    const agentRunId = readTuiIdentifier(value.agentRunId);
    const worktreeId = readTuiIdentifier(value.worktreeId);
    const toolCallId = readTuiIdentifier(value.toolCallId);
    const toolName = readTuiIdentifier(value.toolName);
    if (!conversationId || !agentRunId || !toolCallId || !toolName) return [];
    const commandPreview = (toolName === "run_command" || toolName === "command_job") && isRecord(value.commandPreview)
      ? sanitizeCommandPermissionPreview({ ...value.commandPreview, kind: "command" })
      : undefined;
    return [{
      agentRunId,
      ...(worktreeId ? { worktreeId } : {}),
      toolCallId,
      toolName,
      ...(commandPreview ? { commandPreview } : {}),
    }];
  });
}

function parseCommandJobSnapshot(value: unknown): CommandJobSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const jobId = readString(value.jobId);
  const status = value.status;
  const stdinMode = value.stdinMode;
  const createdAt = readNonNegativeSafeInteger(value.createdAt);
  const updatedAt = readNonNegativeSafeInteger(value.updatedAt);
  const oldestCursor = readNonNegativeSafeInteger(value.oldestCursor);
  const nextCursor = readNonNegativeSafeInteger(value.nextCursor);
  const recovery = parseCommandJobRecovery(value.recovery, status, stdinMode);
  if (!jobId
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(jobId)
    || (status !== "running" && status !== "completed" && status !== "cancelled" && status !== "failed" && status !== "lost")
    || (stdinMode !== "closed" && stdinMode !== "pipe" && stdinMode !== "pty")
    || createdAt === undefined
    || updatedAt === undefined
    || oldestCursor === undefined
    || nextCursor === undefined
    || oldestCursor > nextCursor
    || typeof value.supportsResize !== "boolean"
    || !recovery) {
    return undefined;
  }
  const snapshot: CommandJobSnapshot = {
    jobId,
    status,
    stdinMode,
    createdAt,
    updatedAt,
    supportsResize: value.supportsResize,
    oldestCursor,
    nextCursor,
    recovery,
  };
  const endedAt = readNonNegativeSafeInteger(value.endedAt);
  const pid = readNonNegativeSafeInteger(value.pid);
  const timeoutMs = readNonNegativeSafeInteger(value.timeoutMs);
  const deadlineAt = readNonNegativeSafeInteger(value.deadlineAt);
  const terminationReason = value.terminationReason === "cancelled" || value.terminationReason === "timed_out"
    ? value.terminationReason
    : undefined;
  const exitCode = typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) ? value.exitCode : undefined;
  const signal = typeof value.signal === "string" || typeof value.signal === "number" ? value.signal : undefined;
  const error = readString(value.error);
  return {
    ...snapshot,
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    ...(terminationReason ? { terminationReason } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(error ? { error } : {}),
  };
}

function parseCommandJobRecovery(
  value: unknown,
  status: unknown,
  stdinMode: unknown,
): CommandJobSnapshot["recovery"] | undefined {
  if (!isRecord(value)
    || Object.keys(value).length !== 5
    || !["lifecycle", "process", "output", "stdin", "mutationReplay"]
      .every((key) => Object.prototype.hasOwnProperty.call(value, key))
    || value.mutationReplay !== "forbidden") {
    return undefined;
  }
  const recovery = value as CommandJobSnapshot["recovery"];
  if ((recovery.lifecycle === "starting"
      && status === "running"
      && recovery.process === "starting"
      && recovery.output === "memory_only"
      && recovery.stdin === (stdinMode === "closed" ? "closed" : "unavailable"))
    || (recovery.lifecycle === "active"
      && status === "running"
      && recovery.process === "attached"
      && recovery.output === "memory_only"
      && recovery.stdin === (stdinMode === "closed" ? "closed" : "live_only"))
    || (recovery.lifecycle === "settled"
      && status !== "running"
      && status !== "lost"
      && recovery.process === "not_applicable"
      && (recovery.output === "memory_only" || recovery.output === "unavailable")
      && recovery.stdin === "closed")
    || (recovery.lifecycle === "lost"
      && status === "lost"
      && recovery.process === "not_reattachable"
      && recovery.output === "unavailable"
      && recovery.stdin === (stdinMode === "closed" ? "closed" : "unavailable"))) {
    return recovery;
  }
  return undefined;
}

function parseCommandJobReadResult(payload: Record<string, unknown>): CommandJobReadResult {
  const snapshot = parseCommandJobSnapshot(payload);
  const startCursor = readNonNegativeSafeInteger(payload.startCursor);
  if (!snapshot
    || typeof payload.output !== "string"
    || startCursor === undefined
    || startCursor < snapshot.oldestCursor
    || startCursor > snapshot.nextCursor
    || typeof payload.hasMore !== "boolean"
    || typeof payload.cursorExpired !== "boolean"
    || typeof payload.cursorAdjusted !== "boolean") {
    throw new Error("Gateway returned an invalid command job output page.");
  }
  return {
    ...snapshot,
    output: payload.output,
    startCursor,
    hasMore: payload.hasMore,
    cursorExpired: payload.cursorExpired,
    cursorAdjusted: payload.cursorAdjusted,
  };
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

function readBoundedText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

function readStringList(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const strings = value.map((item) => readTuiIdentifier(item));
  return strings.every((item): item is string => Boolean(item)) ? strings : undefined;
}

function readGitOid(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function readTuiIdentifier(value: unknown): string | undefined {
  const normalized = readString(value);
  return normalized && normalized.length <= 256 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function readSafeWorktreeId(value: unknown): string | undefined {
  const normalized = readTuiIdentifier(value);
  return normalized && /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : undefined;
}

function readAbsolutePath(value: unknown): string | undefined {
  const normalized = readString(value);
  return normalized
    && normalized.length <= 4096
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    && path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : undefined;
}

function createLaunchWorkspaceTarget(cwd: string): TuiWorkspaceTarget {
  return { targetKey: "launch", kind: "launch", cwd, status: "ready" };
}

async function resolveExistingDirectory(cwd: string): Promise<string> {
  const resolved = await fs.realpath(cwd);
  const stats = await fs.stat(resolved);
  if (!stats.isDirectory()) throw new Error("Workspace target is not an accessible directory.");
  return path.resolve(resolved);
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
