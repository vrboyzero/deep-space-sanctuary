import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  SubTaskSupervisorWorktreeDisposalCapabilityInput,
  SubTaskSupervisorWorktreeDisposalCapabilityResult,
} from "@belldandy/skills";

import { withFileMutationLock } from "./file-mutation-lock.js";
import { SubTaskSupervisorAdmissionError } from "./subtask-supervisor-runtime.js";
import type { SubTaskRecord } from "./task-runtime.js";
import type {
  PersistedSubTaskWorktreeRuntime,
  SubTaskWorktreeDisposalInspection,
  SubTaskWorktreeRuntime,
  SubTaskWorktreeRuntimeSummary,
} from "./worktree-runtime.js";

export const SUBTASK_SUPERVISOR_WORKTREE_DISPOSAL_SCHEMA_VERSION = "subtask-supervisor-worktree-disposal/v1" as const;

type DisposalBinding = Omit<SubTaskSupervisorWorktreeDisposalCapabilityInput, "action" | "receiptId" | "confirm">;

type DisposalReceipt = {
  version: 1;
  receiptId: string;
  requestHash: string;
  runtimeHash: string;
  contentSha256: string;
  expiresAtMs: number;
  result?: SubTaskSupervisorWorktreeDisposalCapabilityResult;
};

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_TTL_MS = 5 * 60 * 1000;

export class SubTaskSupervisorWorktreeDisposalRuntime {
  private readonly receiptsDir: string;
  private readonly locksDir: string;
  private readonly now: () => number;

  constructor(private readonly input: {
    stateDir: string;
    runtimeStore: Pick<SubTaskRuntimeStoreLike, "getTask" | "updateTaskWorktreeRuntime">;
    worktreeRuntime: Pick<SubTaskWorktreeRuntime, "inspectTaskDisposal" | "cleanupTaskRuntime">;
    now?: () => number;
  }) {
    const root = path.join(path.resolve(input.stateDir), "subtasks", "supervisor-worktree-disposal");
    this.receiptsDir = path.join(root, "receipts");
    this.locksDir = path.join(root, "locks");
    this.now = input.now ?? Date.now;
  }

  async preview(binding: DisposalBinding): Promise<SubTaskSupervisorWorktreeDisposalCapabilityResult & {
    status: "ready";
    receipt: { id: string; expiresAtMs: number };
  }> {
    validateBinding(binding);
    const record = await this.readExactInterruptedLane(binding);
    const inspection = await this.input.worktreeRuntime.inspectTaskDisposal(record.id, record.launchSpec);
    if (!inspection.dirty) {
      throw new Error("Subtask worktree disposal requires a dirty interrupted lane.");
    }
    const receipt: DisposalReceipt = {
      version: 1,
      receiptId: `dispose-${randomUUID()}`,
      requestHash: hashBinding(binding),
      runtimeHash: hashRuntime(record),
      contentSha256: inspection.sha256,
      expiresAtMs: this.now() + RECEIPT_TTL_MS,
    };
    await this.writeReceipt(receipt);
    return {
      schemaVersion: SUBTASK_SUPERVISOR_WORKTREE_DISPOSAL_SCHEMA_VERSION,
      contentMode: "none",
      status: "ready",
      applied: false,
      duplicateSideEffect: false,
      blockers: [],
      receipt: { id: receipt.receiptId, expiresAtMs: receipt.expiresAtMs },
    };
  }

  async confirm(input: DisposalBinding & { receiptId: string; confirm: true }): Promise<SubTaskSupervisorWorktreeDisposalCapabilityResult> {
    if (input.confirm !== true || !SAFE_ID_PATTERN.test(input.receiptId)) return failed("confirmation_required");
    const receipt = await this.readReceipt(input.receiptId);
    if (!receipt || receipt.requestHash !== hashBinding(input)) return failed("receipt_mismatch");
    return withFileMutationLock(this.lockPath(input.taskId), async () => this.confirmOnce(input, receipt));
  }

  private async confirmOnce(
    input: DisposalBinding & { receiptId: string; confirm: true },
    initialReceipt: DisposalReceipt,
  ): Promise<SubTaskSupervisorWorktreeDisposalCapabilityResult> {
    const receipt = await this.readReceipt(initialReceipt.receiptId);
    if (!receipt || receipt.requestHash !== initialReceipt.requestHash) return failed("receipt_mismatch");
    if (receipt.result) return receipt.result;
    if (receipt.expiresAtMs < this.now()) return this.finish(receipt, failed("receipt_expired"));

    let record: SubTaskRecord;
    try {
      record = await this.readExactInterruptedLane(input);
    } catch (error) {
      if (error instanceof SubTaskSupervisorAdmissionError && error.code === "binding_conflict") {
        return this.finish(receipt, failed("binding_stale"));
      }
      throw error;
    }
    if (hashRuntime(record) !== receipt.runtimeHash) return this.finish(receipt, failed("receipt_stale"));
    if (record.launchSpec.worktreeStatus !== "removed") {
      let inspection: SubTaskWorktreeDisposalInspection;
      try {
        inspection = await this.input.worktreeRuntime.inspectTaskDisposal(record.id, record.launchSpec);
      } catch {
        return this.finish(receipt, uncertain("worktree_cleanup_state_unknown"));
      }
      if (inspection.sha256 !== receipt.contentSha256) return this.finish(receipt, failed("receipt_stale"));

      const runtimeSummary = await this.input.worktreeRuntime.cleanupTaskRuntime(record.id, record.launchSpec);
      if (runtimeSummary.worktreeStatus !== "removed") {
        await this.input.runtimeStore.updateTaskWorktreeRuntime(record.id, { runtimeSummary });
        return this.finish(receipt, uncertain(runtimeSummary.worktreeError ?? "worktree_cleanup_failed"));
      }
      await this.input.runtimeStore.updateTaskWorktreeRuntime(record.id, { runtimeSummary });
    }
    return this.finish(receipt, completed());
  }

  private async readExactInterruptedLane(binding: DisposalBinding): Promise<SubTaskRecord> {
    const record = await this.input.runtimeStore.getTask(binding.taskId);
    const supervisor = record?.supervisorBinding;
    if (!record || !supervisor
      || supervisor.managerConversationId !== binding.managerConversationId
      || supervisor.managerAgentRunId !== binding.managerAgentRunId
      || supervisor.teamId !== binding.teamId
      || supervisor.laneId !== binding.laneId
      || supervisor.mode !== "write"
      || record.sessionId !== binding.sessionId
      || (record.commandGeneration ?? 0) !== binding.expectedRevision
      || record.archivedAt !== undefined
      || record.status !== "interrupted"
      || record.recovery?.state !== "runtime_lost"
      || record.launchSpec.isolationMode !== "worktree"
      || (record.launchSpec.worktreeStatus !== "created" && record.launchSpec.worktreeStatus !== "removed")) {
      throw new SubTaskSupervisorAdmissionError(
        "binding_conflict",
        "Subtask worktree disposal requires the exact interrupted write lane binding and revision.",
      );
    }
    return record;
  }

  private async finish(
    receipt: DisposalReceipt,
    result: SubTaskSupervisorWorktreeDisposalCapabilityResult,
  ): Promise<SubTaskSupervisorWorktreeDisposalCapabilityResult> {
    await this.updateReceipt({ ...receipt, result });
    return result;
  }

  private async readReceipt(receiptId: string): Promise<DisposalReceipt | undefined> {
    if (!SAFE_ID_PATTERN.test(receiptId)) return undefined;
    try {
      return normalizeReceipt(JSON.parse(await fs.readFile(this.receiptPath(receiptId), "utf-8")));
    } catch {
      return undefined;
    }
  }

  private async writeReceipt(receipt: DisposalReceipt): Promise<void> {
    await fs.mkdir(this.receiptsDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.receiptPath(receipt.receiptId), `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
  }

  private async updateReceipt(receipt: DisposalReceipt): Promise<void> {
    const receiptPath = this.receiptPath(receipt.receiptId);
    const temporaryPath = `${receiptPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(temporaryPath, receiptPath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private receiptPath(receiptId: string): string {
    if (!SAFE_ID_PATTERN.test(receiptId)) throw new Error("Subtask disposal receipt id is invalid.");
    return path.join(this.receiptsDir, `${receiptId}.json`);
  }

  private lockPath(taskId: string): string {
    if (!SAFE_ID_PATTERN.test(taskId)) throw new Error("Subtask disposal task id is invalid.");
    return path.join(this.locksDir, `${taskId}.json`);
  }
}

type SubTaskRuntimeStoreLike = {
  getTask(taskId: string): Promise<SubTaskRecord | undefined>;
  updateTaskWorktreeRuntime(taskId: string, input: {
    runtimeSummary: Partial<SubTaskWorktreeRuntimeSummary>;
  }): Promise<SubTaskRecord | undefined>;
};

function validateBinding(binding: DisposalBinding): void {
  if (!SAFE_ID_PATTERN.test(binding.managerConversationId)
    || !SAFE_ID_PATTERN.test(binding.managerAgentRunId)
    || !SAFE_ID_PATTERN.test(binding.teamId)
    || !SAFE_ID_PATTERN.test(binding.laneId)
    || !SAFE_ID_PATTERN.test(binding.taskId)
    || !SAFE_ID_PATTERN.test(binding.sessionId)
    || !Number.isSafeInteger(binding.expectedRevision)
    || binding.expectedRevision < 0) {
    throw new Error("Subtask worktree disposal binding is invalid.");
  }
}

function hashBinding(binding: DisposalBinding): string {
  return createHash("sha256").update(JSON.stringify({
    managerConversationId: binding.managerConversationId,
    managerAgentRunId: binding.managerAgentRunId,
    teamId: binding.teamId,
    laneId: binding.laneId,
    taskId: binding.taskId,
    sessionId: binding.sessionId,
    expectedRevision: binding.expectedRevision,
  })).digest("hex");
}

function hashRuntime(record: SubTaskRecord): string {
  const runtime = record.launchSpec as PersistedSubTaskWorktreeRuntime;
  return createHash("sha256").update(JSON.stringify({
    taskId: record.id,
    isolationMode: runtime.isolationMode,
    cwd: resolveOptionalPath(runtime.cwd),
    resolvedCwd: resolveOptionalPath(runtime.resolvedCwd),
    worktreePath: resolveOptionalPath(runtime.worktreePath),
    worktreeRepoRoot: resolveOptionalPath(runtime.worktreeRepoRoot),
    worktreeBranch: runtime.worktreeBranch,
    worktreeBaseRef: runtime.worktreeBaseRef,
  })).digest("hex");
}

function resolveOptionalPath(value: string | undefined): string | undefined {
  return value ? path.resolve(value) : undefined;
}

function completed(): SubTaskSupervisorWorktreeDisposalCapabilityResult {
  return {
    schemaVersion: SUBTASK_SUPERVISOR_WORKTREE_DISPOSAL_SCHEMA_VERSION,
    contentMode: "none",
    status: "completed",
    applied: true,
    duplicateSideEffect: false,
    blockers: [],
  };
}

function failed(blocker: string): SubTaskSupervisorWorktreeDisposalCapabilityResult {
  return {
    schemaVersion: SUBTASK_SUPERVISOR_WORKTREE_DISPOSAL_SCHEMA_VERSION,
    contentMode: "none",
    status: "failed",
    applied: false,
    duplicateSideEffect: false,
    blockers: [blocker],
  };
}

function uncertain(blocker: string): SubTaskSupervisorWorktreeDisposalCapabilityResult {
  return {
    schemaVersion: SUBTASK_SUPERVISOR_WORKTREE_DISPOSAL_SCHEMA_VERSION,
    contentMode: "none",
    status: "uncertain",
    applied: false,
    duplicateSideEffect: false,
    blockers: [blocker],
  };
}

function normalizeReceipt(value: unknown): DisposalReceipt | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const receipt = value as DisposalReceipt;
  if (receipt.version !== 1
    || !SAFE_ID_PATTERN.test(receipt.receiptId)
    || !SHA256_PATTERN.test(receipt.requestHash)
    || !SHA256_PATTERN.test(receipt.runtimeHash)
    || !SHA256_PATTERN.test(receipt.contentSha256)
    || !Number.isSafeInteger(receipt.expiresAtMs)) return undefined;
  return receipt;
}
