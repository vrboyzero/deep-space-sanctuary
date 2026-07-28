import crypto from "node:crypto";
import path from "node:path";

import {
  CommandJobCleanupError,
  CommandJobManager,
  CommandJobStateStore,
  DEFAULT_COMMAND_JOB_TIMEOUT_MS,
  type CommandJobSnapshot,
} from "../../command-job.js";
import { createCommandJobProcess } from "../../command-job-runtime.js";
import { parseCommandPlan, summarizeCommandPlanForAudit } from "../../command-plan.js";
import {
  buildOciSandboxInvocation,
  buildSandboxRuntimeEnvironment,
  createOciSandboxEnvironmentFile,
  evaluateCommandSandboxAdmission,
} from "../../command-sandbox.js";
import { resolveSandboxWorkspace } from "../../command-sandbox-workspace.js";
import {
  cleanupPersistedOciSandboxLease,
  createOciSandboxLease,
  type OciSandboxLeaseRelease,
} from "../../command-sandbox-lease.js";
import { buildFailureToolCallResult } from "../../failure-kind.js";
import { resolveRuntimeFilesystemScope } from "../../runtime-policy.js";
import { withToolContract } from "../../tool-contract.js";
import type { JsonObject, Tool, ToolCallResult, ToolContext } from "../../types.js";
import { throwIfAborted } from "../../abort-utils.js";

const commandJobManagers = new Map<string, Promise<CommandJobManager>>();
const MAX_COMMAND_JOB_READ_BYTES = 512 * 1024;

export type CommandJobRuntime = Pick<CommandJobManager, "list" | "read" | "cancel">;

function normalizePolicyTimeout(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? value as number
    : DEFAULT_COMMAND_JOB_TIMEOUT_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serializeSnapshot(snapshot: CommandJobSnapshot | ReturnType<CommandJobManager["list"]>): string {
  return JSON.stringify(snapshot);
}

function normalizeReadBytes(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  return Math.min(value as number, MAX_COMMAND_JOB_READ_BYTES);
}

function normalizeCursor(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("cursor must be a non-negative safe integer.");
  }
  return value as number;
}

async function getOrCreateCommandJobManager(stateDirInput: string): Promise<CommandJobManager> {
  const stateDir = path.resolve(stateDirInput);
  let manager = commandJobManagers.get(stateDir);
  if (!manager) {
    manager = (async () => {
      const created = new CommandJobManager({
        store: new CommandJobStateStore(stateDir),
        recoverLostJob: async (job) => {
          if (!job.persistedSandbox) return;
          const cleaned = await cleanupPersistedOciSandboxLease({ lease: job.persistedSandbox });
          if (!cleaned) {
            throw new Error("Unable to reconcile persisted OCI sandbox lease.");
          }
        },
      });
      await created.initialize();
      return created;
    })();
    commandJobManagers.set(stateDir, manager);
  }
  return await manager;
}

/** Returns the same live owner used by the command_job Tool without exposing its state directory. */
export async function getCommandJobRuntime(stateDir: string): Promise<CommandJobRuntime> {
  if (typeof stateDir !== "string" || !stateDir.trim()) {
    throw new Error("Command jobs require a configured Gateway state directory for restart-safe lifecycle ownership.");
  }
  return await getOrCreateCommandJobManager(stateDir);
}

async function getCommandJobManager(context: ToolContext): Promise<CommandJobManager> {
  if (!context.stateDir) {
    throw new Error("Command jobs require a configured Gateway state directory for restart-safe lifecycle ownership.");
  }
  return await getOrCreateCommandJobManager(context.stateDir);
}

/** Called by Gateway shutdown before its process exits so active sandbox containers are reconciled. */
export async function shutdownCommandJobs(): Promise<number> {
  const managers = Array.from(commandJobManagers.values());
  commandJobManagers.clear();
  const stopped = await Promise.all(managers.map(async (manager) => (await manager).shutdown()));
  return stopped.reduce((sum, count) => sum + count, 0);
}

function resultMetadata(snapshot: CommandJobSnapshot, base: JsonObject = {}): JsonObject {
  return {
    ...base,
    commandJobId: snapshot.jobId,
    commandJobStatus: snapshot.status,
    commandJobCursor: snapshot.nextCursor,
    ...(snapshot.pid !== undefined ? { commandJobPid: snapshot.pid } : {}),
    ...(snapshot.processTerminationMethod ? { processTerminationMethod: snapshot.processTerminationMethod } : {}),
    ...(snapshot.processCloseObserved !== undefined ? { processCloseObserved: snapshot.processCloseObserved } : {}),
    ...(snapshot.cleanup ?? {}),
  };
}

async function startCommandJob(args: JsonObject, context: ToolContext): Promise<{ snapshot: CommandJobSnapshot; metadata: JsonObject }> {
  if (context.launchSpec?.commandSandbox !== "required") {
    throw new Error("Command jobs are available only to sandbox-required coding runs.");
  }
  throwIfAborted(context.abortSignal);
  const admission = await evaluateCommandSandboxAdmission({
    family: "command-exec",
    launchSpec: context.launchSpec,
    readEnv: context.readEnv,
  });
  if (!admission.allowed) {
    const error = new Error(admission.message);
    Object.assign(error, { commandJobFailureMetadata: admission.metadata });
    throw error;
  }
  if (!admission.sandbox) {
    throw new Error("Sandbox backend admission returned no executable backend.");
  }
  const parsed = parseCommandPlan(args.commandPlan);
  if (!parsed.ok) {
    const error = new Error(parsed.message);
    Object.assign(error, { commandPlanErrorCode: parsed.code });
    throw error;
  }

  const scope = resolveRuntimeFilesystemScope(context);
  const workspace = await resolveSandboxWorkspace({
    cwd: parsed.plan.cwd ?? context.defaultCwd,
    workspaceRoot: scope.workspaceRoot,
    extraWorkspaceRoots: scope.extraWorkspaceRoots,
  });
  if (!workspace.ok) {
    throw new Error(`Security Error: ${workspace.reason}`);
  }
  const manager = await getCommandJobManager(context);
  const lease = await createOciSandboxLease({ config: admission.sandbox });
  let environmentFile: Awaited<ReturnType<typeof createOciSandboxEnvironmentFile>> | undefined;
  const commandPlan = summarizeCommandPlanForAudit(parsed.plan);
  const baseMetadata: JsonObject = {
    commandSandboxBackend: admission.sandbox.backend,
    commandSandboxRuntime: admission.sandbox.runtime,
    commandSandboxImage: admission.sandbox.image,
    commandSandboxNetwork: parsed.plan.network,
    commandSandboxWriteScope: parsed.plan.writeScope,
    commandPlan,
  };
  const cleanup = async (): Promise<JsonObject> => {
    const metadata: JsonObject = {};
    let cleanupError: string | undefined;
    let release: OciSandboxLeaseRelease;
    try {
      release = await lease.release();
    } catch {
      release = { status: "cleanup_failed" };
    }
    Object.assign(metadata, lease.metadata(release));
    if (release.status === "cleanup_failed") {
      cleanupError = "Sandbox container cleanup failed; investigate the reported lease before another command is run.";
    }
    try {
      await lease.cleanupArtifacts();
    } catch {
      metadata.commandSandboxLeaseArtifactCleanupFailed = true;
      cleanupError ??= "Sandbox lease artifact cleanup failed after command execution.";
    }
    try {
      await environmentFile?.cleanup();
    } catch {
      metadata.commandSandboxEnvironmentCleanupFailed = true;
      cleanupError ??= "Sandbox environment cleanup failed after command execution.";
    }
    if (cleanupError) {
      throw new CommandJobCleanupError(cleanupError, metadata);
    }
    return metadata;
  };

  let managerOwnsCleanup = false;
  try {
    const timeoutMs = Math.min(
      parsed.plan.timeoutMs ?? normalizePolicyTimeout(context.policy.maxTimeoutMs),
      normalizePolicyTimeout(context.policy.maxTimeoutMs),
    );
    const snapshot = await manager.start({
      jobId: lease.binding.leaseId,
      stdinMode: parsed.plan.stdinMode,
      timeoutMs,
      persistedSandbox: {
        runtime: admission.sandbox.runtime,
        containerName: lease.binding.containerName,
      },
      cleanup,
      startProcess: async () => {
        environmentFile = await createOciSandboxEnvironmentFile(parsed.plan.env);
        const invocation = buildOciSandboxInvocation({
          config: admission.sandbox!,
          workspaceRoot: workspace.workspaceRoot,
          cwd: workspace.cwd,
          plan: parsed.plan,
          lease: lease.binding,
          ...(environmentFile.path ? { environmentFile: environmentFile.path } : {}),
        });
        const process = await createCommandJobProcess({
          ...invocation,
          env: buildSandboxRuntimeEnvironment(),
          stdinMode: parsed.plan.stdinMode,
          startupTimeoutMs: timeoutMs,
        });
        lease.markRuntimeStarted();
        return process;
      },
    });
    managerOwnsCleanup = true;
    if (snapshot.status === "failed") {
      const error = new Error(snapshot.error ?? "Sandbox command job failed to start.");
      Object.assign(error, { commandJobFailureMetadata: resultMetadata(snapshot, baseMetadata) });
      throw error;
    }
    return { snapshot, metadata: resultMetadata(snapshot, baseMetadata) };
  } catch (error) {
    // A store failure can occur before CommandJobManager owns the cleanup callback.
    if (!managerOwnsCleanup) {
      await cleanup().catch(() => undefined);
    }
    throw error;
  }
}

export const commandJobTool: Tool = withToolContract({
  definition: {
    name: "command_job",
    description: "管理受 sandbox 约束的后台命令 job。支持启动、cursor 读取、stdin、PTY resize、状态和取消。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "read", "write", "resize", "cancel", "status", "list"],
          description: "要执行的 command job 生命周期动作。",
        },
        commandPlan: {
          type: "object",
          description: "仅 start 使用：结构化 executable、argv、cwd、env、network、writeScope、stdinMode 与 timeoutMs。",
        },
        jobId: { type: "string", description: "start 返回的稳定 command job ID。" },
        data: { type: "string", description: "仅 write 使用；不会回显或写入审计事件。" },
        cursor: { type: "number", description: "仅 read 使用的 UTF-8 字节 cursor。" },
        maxBytes: { type: "number", description: "仅 read 使用的最大输出字节数。" },
        cols: { type: "number", description: "仅 resize 使用的终端列数。" },
        rows: { type: "number", description: "仅 resize 使用的终端行数。" },
      },
      required: ["action"],
    },
  },
  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "command_job";
    const action = args.action;
    const makeFailure = (error: string, failureKind: ToolCallResult["failureKind"] = "input_error", metadata?: JsonObject) =>
      buildFailureToolCallResult({ id, name, start, output: "", error, failureKind, ...(metadata ? { metadata } : {}) });

    try {
      if (typeof action !== "string") {
        return makeFailure("action is required.");
      }
      if (action === "start") {
        const started = await startCommandJob(args, context);
        return {
          id,
          name,
          success: true,
          output: serializeSnapshot(started.snapshot),
          durationMs: Date.now() - start,
          metadata: started.metadata,
        };
      }

      const manager = await getCommandJobManager(context);
      if (action === "list") {
        return {
          id,
          name,
          success: true,
          output: serializeSnapshot(manager.list()),
          durationMs: Date.now() - start,
        };
      }
      if (typeof args.jobId !== "string" || !args.jobId) {
        return makeFailure(`jobId is required for action '${action}'.`);
      }
      if (action === "read") {
        const snapshot = manager.read(args.jobId, {
          ...(normalizeCursor(args.cursor) !== undefined ? { cursor: normalizeCursor(args.cursor) } : {}),
          ...(normalizeReadBytes(args.maxBytes) !== undefined ? { maxBytes: normalizeReadBytes(args.maxBytes) } : {}),
        });
        return {
          id,
          name,
          success: true,
          output: serializeSnapshot(snapshot),
          durationMs: Date.now() - start,
          metadata: resultMetadata(snapshot),
        };
      }
      if (action === "write") {
        if (typeof args.data !== "string") return makeFailure("data is required for action 'write'.");
        const snapshot = manager.write(args.jobId, args.data);
        return {
          id,
          name,
          success: true,
          output: serializeSnapshot(snapshot),
          durationMs: Date.now() - start,
          metadata: resultMetadata(snapshot),
        };
      }
      if (action === "resize") {
        if (!Number.isSafeInteger(args.cols) || !Number.isSafeInteger(args.rows)) {
          return makeFailure("cols and rows are required positive integers for action 'resize'.");
        }
        const snapshot = manager.resize(args.jobId, args.cols as number, args.rows as number);
        return {
          id,
          name,
          success: true,
          output: serializeSnapshot(snapshot),
          durationMs: Date.now() - start,
          metadata: resultMetadata(snapshot),
        };
      }
      if (action === "cancel") {
        const snapshot = await manager.cancel(args.jobId);
        return {
          id,
          name,
          success: true,
          output: serializeSnapshot(snapshot),
          durationMs: Date.now() - start,
          metadata: resultMetadata(snapshot),
        };
      }
      if (action === "status") {
        const snapshot = manager.get(args.jobId);
        return {
          id,
          name,
          success: true,
          output: serializeSnapshot(snapshot),
          durationMs: Date.now() - start,
          metadata: resultMetadata(snapshot),
        };
      }
      return makeFailure(`Unknown command_job action: ${action}.`);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const metadata = isRecord(error) && isRecord(error.commandJobFailureMetadata)
        ? error.commandJobFailureMetadata as JsonObject
        : isRecord(error) && typeof error.commandPlanErrorCode === "string"
          ? { commandPlanErrorCode: error.commandPlanErrorCode }
          : undefined;
      const failureKind = metadata && "commandSandboxStatus" in metadata
        ? "permission_or_policy"
        : details.includes("sandbox-required coding runs")
          ? "permission_or_policy"
        : details.startsWith("Security Error:")
          ? "permission_or_policy"
          : details.includes("sandbox") || details.includes("Sandbox") || details.includes("node-pty") || details.includes("Command job")
            ? "environment_error"
            : "input_error";
      return makeFailure(details, failureKind, metadata);
    }
  },
}, {
  family: "command-exec",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "critical",
  channels: ["gateway", "web", "cli"],
  safeScopes: ["privileged"],
  activityDescription: "Manage sandboxed command jobs",
  resultSchema: {
    kind: "text",
    description: "JSON command job lifecycle snapshot or paged terminal output.",
  },
  outputPersistencePolicy: "conversation",
});
