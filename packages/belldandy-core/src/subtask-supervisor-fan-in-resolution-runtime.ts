import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  SubTaskSupervisorFanInArtifact,
  SubTaskSupervisorReviewEvidence,
  SubTaskSupervisorTestEvidence,
} from "./subtask-supervisor-fan-in-runtime.js";
import { replaceFileWithRetry } from "./atomic-file-replace.js";
import { withFileMutationLock } from "./file-mutation-lock.js";
import type { SubTaskSupervisorExactBinding } from "./subtask-supervisor-runtime.js";
import { UserWorktreeRuntime } from "./user-worktree-runtime.js";

const execFile = promisify(execFileCallback);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;

export type SubTaskSupervisorFanInResolutionLane = {
  binding: Required<SubTaskSupervisorExactBinding>;
  revision: number;
  sourceRepoRoot: string;
  artifact: SubTaskSupervisorFanInArtifact;
  testEvidence: SubTaskSupervisorTestEvidence;
};

export type SubTaskSupervisorFanInResolutionInput = {
  managerConversationId: string;
  managerAgentRunId: string;
  teamId: string;
  lanes: SubTaskSupervisorFanInResolutionLane[];
  reviewerEvidence: SubTaskSupervisorReviewEvidence;
};

export type SubTaskSupervisorFanInResolutionPreview = {
  status: "ready" | "conflict";
  receipt: { id: string; expiresAtMs: number };
  laneCount: number;
  conflictPaths: string[];
};

export type SubTaskSupervisorFanInResolutionConfirmInput = SubTaskSupervisorFanInResolutionInput & {
  receiptId: string;
  confirm: true;
};

export type SubTaskSupervisorFanInResolutionResult = {
  status: "completed" | "failed" | "uncertain" | "conflict";
  applied: boolean;
  duplicateSideEffect: false;
  blockers: string[];
  auditArtifactId?: string;
};

type FanInReceiptRecord = {
  version: 1;
  receiptId: string;
  requestHash: string;
  status: "ready" | "conflict";
  laneCount: number;
  conflictPaths: string[];
  expiresAtMs: number;
  resolutionWorktreeId?: string;
  applyReceiptId?: string;
  result?: SubTaskSupervisorFanInResolutionResult;
};

export class SubTaskSupervisorFanInResolutionRuntime {
  private readonly receiptsDir: string;
  private readonly userWorktrees: UserWorktreeRuntime;
  private readonly pendingConfirms = new Map<string, Promise<SubTaskSupervisorFanInResolutionResult>>();

  constructor(input: { stateDir: string }) {
    const stateDir = path.resolve(input.stateDir);
    this.receiptsDir = path.join(stateDir, "subtasks", "supervisor-fan-in", "receipts");
    this.userWorktrees = new UserWorktreeRuntime(stateDir);
  }

  async preview(input: SubTaskSupervisorFanInResolutionInput): Promise<SubTaskSupervisorFanInResolutionPreview> {
    validateResolutionInput(input);
    const requestHash = hashResolutionInput(input);
    const receiptId = `fanin-${requestHash.slice(0, 32)}`;
    const existing = await this.readReceipt(receiptId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error("Fan-in receipt binding conflict.");
      return toPreview(existing);
    }

    const repoRoot = path.resolve(input.lanes[0]!.sourceRepoRoot);
    await assertCleanBoundSource(repoRoot, input.lanes[0]!.artifact.baseRef);
    const owner = {
      conversationId: `fanin-${createHash("sha256").update(input.managerConversationId).digest("hex").slice(0, 24)}`,
      runId: `fanin-${requestHash.slice(0, 24)}`,
    };
    const resolution = await this.userWorktrees.create({ cwd: repoRoot, owner });
    if (resolution.status !== "ready" || resolution.baseCommit !== input.lanes[0]!.artifact.baseRef) {
      throw new Error("Fan-in resolution worktree is unavailable.");
    }

    const conflictPaths: string[] = [];
    try {
      for (const lane of input.lanes) {
        if (!lane.artifact.patch) continue;
        const patch = await readBoundPatch(lane.artifact.patch);
        const check = await checkPatch(patch, resolution.worktreePath);
        if (!check.ok) {
          conflictPaths.push(...inferConflictPaths(lane.artifact.changedPaths, input.lanes, lane.binding.laneId));
          break;
        }
        await applyPatch(patch, resolution.worktreePath);
      }

      if (conflictPaths.length > 0) {
        const expiresAtMs = Date.now() + 5 * 60 * 1000;
        const record: FanInReceiptRecord = {
          version: 1,
          receiptId,
          requestHash,
          status: "conflict",
          laneCount: input.lanes.length,
          conflictPaths: [...new Set(conflictPaths)].sort(),
          expiresAtMs,
        };
        await this.writeReceipt(record);
        await this.cleanupResolutionWorktree(resolution.worktreeId, resolution.worktreePath);
        return toPreview(record);
      }

      const applyPreview = await this.userWorktrees.preview({
        operation: "apply",
        worktreeId: resolution.worktreeId,
      });
      if (!applyPreview.canConfirm || !applyPreview.receipt?.receiptId) {
        throw new Error(`Fan-in apply preview is unavailable: ${applyPreview.blockers.join(",")}`);
      }
      const record: FanInReceiptRecord = {
        version: 1,
        receiptId,
        requestHash,
        status: "ready",
        laneCount: input.lanes.length,
        conflictPaths: [],
        expiresAtMs: applyPreview.receipt.expiresAtMs,
        resolutionWorktreeId: resolution.worktreeId,
        applyReceiptId: applyPreview.receipt.receiptId,
      };
      await this.writeReceipt(record);
      return toPreview(record);
    } catch (error) {
      await this.cleanupResolutionWorktree(resolution.worktreeId, resolution.worktreePath).catch(() => {});
      throw error;
    }
  }

  async confirm(input: SubTaskSupervisorFanInResolutionConfirmInput): Promise<SubTaskSupervisorFanInResolutionResult> {
    if (input.confirm !== true || !SAFE_ID_PATTERN.test(input.receiptId)) {
      return failed("confirmation_required");
    }
    validateResolutionInput(input);
    const requestHash = hashResolutionInput(input);
    const pendingKey = `${input.receiptId}\0${requestHash}`;
    const existing = this.pendingConfirms.get(pendingKey);
    if (existing) return existing;
    const pending = this.confirmOnce(input, requestHash);
    this.pendingConfirms.set(pendingKey, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingConfirms.get(pendingKey) === pending) {
        this.pendingConfirms.delete(pendingKey);
      }
    }
  }

  private async confirmOnce(
    input: SubTaskSupervisorFanInResolutionConfirmInput,
    requestHash: string,
  ): Promise<SubTaskSupervisorFanInResolutionResult> {
    return withFileMutationLock(this.receiptPath(input.receiptId), async () => {
      const receipt = await this.readReceipt(input.receiptId);
      if (!receipt || receipt.requestHash !== requestHash) return failed("receipt_mismatch");
      if (receipt.result) {
        return receipt.result.status === "completed"
          ? this.cleanupCompletedReceipt(receipt, receipt.result)
          : receipt.result;
      }
      if (receipt.status === "conflict") {
        const result: SubTaskSupervisorFanInResolutionResult = {
          status: "conflict",
          applied: false,
          duplicateSideEffect: false,
          blockers: ["conflict_resolution_required"],
        };
        await this.updateReceipt({ ...receipt, result });
        return result;
      }
      if (!receipt.resolutionWorktreeId || !receipt.applyReceiptId) return failed("receipt_incomplete");

      const applied = await this.userWorktrees.confirm({
        operation: "apply",
        worktreeId: receipt.resolutionWorktreeId,
        receiptId: receipt.applyReceiptId,
        confirm: true,
      });
      const result: SubTaskSupervisorFanInResolutionResult = applied.outcome === "succeeded" && applied.applied
        ? {
            status: "completed",
            applied: true,
            duplicateSideEffect: false,
            blockers: [],
            ...(applied.audit?.artifactId ? { auditArtifactId: applied.audit.artifactId } : {}),
          }
        : {
            status: applied.outcome === "uncertain" ? "uncertain" : "failed",
            applied: applied.applied,
            duplicateSideEffect: false,
            blockers: [...applied.blockers],
            ...(applied.audit?.artifactId ? { auditArtifactId: applied.audit.artifactId } : {}),
          };
      await this.updateReceipt({ ...receipt, result });
      if (result.status === "completed") {
        return this.cleanupCompletedReceipt(receipt, result);
      }
      return result;
    });
  }

  private async cleanupCompletedReceipt(
    receipt: FanInReceiptRecord,
    result: SubTaskSupervisorFanInResolutionResult,
  ): Promise<SubTaskSupervisorFanInResolutionResult> {
    if (!receipt.resolutionWorktreeId || !receipt.applyReceiptId) {
      const uncertain = { ...result, status: "uncertain" as const, blockers: ["receipt_incomplete"] };
      await this.updateReceipt({ ...receipt, result: uncertain });
      return uncertain;
    }
    const status = await this.userWorktrees.getStatus(receipt.resolutionWorktreeId);
    if (!status) return result;
    await runGit(["restore", "--source", "HEAD", "--staged", "--worktree", "--", "."], status.worktreePath);
    const cleanup = await this.userWorktrees.cleanupConfirmedApply({
      worktreeId: receipt.resolutionWorktreeId,
      receiptId: receipt.applyReceiptId,
    });
    if (cleanup.removed) return result;
    const uncertain = {
      ...result,
      status: "uncertain" as const,
      blockers: cleanup.blockers.length > 0 ? cleanup.blockers : ["resolution_cleanup_failed"],
    };
    await this.updateReceipt({ ...receipt, result: uncertain });
    return uncertain;
  }

  private async cleanupResolutionWorktree(worktreeId: string, worktreePath: string): Promise<void> {
    await runGit(["restore", "--source", "HEAD", "--staged", "--worktree", "--", "."], worktreePath);
    const preview = await this.userWorktrees.preview({ operation: "discard", worktreeId });
    if (!preview.canConfirm || !preview.receipt?.receiptId) {
      throw new Error(`Fan-in resolution cleanup is blocked: ${preview.blockers.join(",")}`);
    }
    const result = await this.userWorktrees.confirm({
      operation: "discard",
      worktreeId,
      receiptId: preview.receipt.receiptId,
      confirm: true,
    });
    if (result.outcome !== "succeeded" || !result.applied) {
      throw new Error(`Fan-in resolution cleanup failed: ${result.blockers.join(",")}`);
    }
  }

  private async readReceipt(receiptId: string): Promise<FanInReceiptRecord | undefined> {
    if (!SAFE_ID_PATTERN.test(receiptId)) return undefined;
    try {
      return normalizeReceipt(JSON.parse(await fs.readFile(this.receiptPath(receiptId), "utf-8")));
    } catch {
      return undefined;
    }
  }

  private async writeReceipt(record: FanInReceiptRecord): Promise<void> {
    await fs.mkdir(this.receiptsDir, { recursive: true, mode: 0o700 });
    const receiptPath = this.receiptPath(record.receiptId);
    const temporaryPath = `${receiptPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      await fs.link(temporaryPath, receiptPath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      const existing = await this.readReceipt(record.receiptId);
      if (!existing || existing.requestHash !== record.requestHash) throw new Error("Fan-in receipt publication conflict.");
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  private async updateReceipt(record: FanInReceiptRecord): Promise<void> {
    const receiptPath = this.receiptPath(record.receiptId);
    const temporaryPath = `${receiptPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      await replaceFileWithRetry(temporaryPath, receiptPath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  private receiptPath(receiptId: string): string {
    if (!SAFE_ID_PATTERN.test(receiptId)) throw new Error("Fan-in receipt id is invalid.");
    return path.join(this.receiptsDir, `${receiptId}.json`);
  }
}

function validateResolutionInput(input: SubTaskSupervisorFanInResolutionInput): void {
  if (!input || !SAFE_ID_PATTERN.test(input.teamId) || !input.managerConversationId || !input.managerAgentRunId
    || input.reviewerEvidence?.mode !== "read_only" || input.reviewerEvidence.verdict !== "approved"
    || !SHA256_PATTERN.test(input.reviewerEvidence.artifact?.sha256)
    || !Array.isArray(input.lanes) || input.lanes.length === 0 || input.lanes.length > 4) {
    throw new Error("Fan-in resolution input is invalid.");
  }
  const baseRef = input.lanes[0]!.artifact.baseRef;
  const repoRoot = path.resolve(input.lanes[0]!.sourceRepoRoot);
  for (const lane of input.lanes) {
    if (lane.binding.managerConversationId !== input.managerConversationId
      || lane.binding.managerAgentRunId !== input.managerAgentRunId
      || lane.binding.teamId !== input.teamId
      || lane.artifact.taskId !== lane.binding.taskId
      || lane.artifact.baseRef !== baseRef
      || path.resolve(lane.sourceRepoRoot) !== repoRoot
      || lane.testEvidence.status !== "passed"
      || lane.testEvidence.taskId !== lane.binding.taskId
      || lane.testEvidence.sessionId !== lane.binding.sessionId
      || lane.testEvidence.revision !== lane.revision
      || !SHA256_PATTERN.test(lane.testEvidence.artifact.sha256)) {
      throw new Error("Fan-in resolution lane binding is invalid.");
    }
  }
}

function hashResolutionInput(input: SubTaskSupervisorFanInResolutionInput): string {
  return createHash("sha256").update(JSON.stringify({
    managerConversationId: input.managerConversationId,
    managerAgentRunId: input.managerAgentRunId,
    teamId: input.teamId,
    lanes: input.lanes.map((lane) => ({
      binding: lane.binding,
      revision: lane.revision,
      sourceRepoRoot: path.resolve(lane.sourceRepoRoot),
      baseRef: lane.artifact.baseRef,
      patchSha256: lane.artifact.patch?.sha256,
      manifestSha256: lane.artifact.manifest.sha256,
      changedPaths: lane.artifact.changedPaths,
      testSha256: lane.testEvidence.artifact.sha256,
    })),
    reviewSha256: input.reviewerEvidence.artifact.sha256,
  })).digest("hex");
}

async function assertCleanBoundSource(repoRoot: string, baseRef: string): Promise<void> {
  const [resolvedRoot, head, status] = await Promise.all([
    runGit(["rev-parse", "--show-toplevel"], repoRoot),
    runGit(["rev-parse", "HEAD"], repoRoot),
    runGit(["status", "--porcelain=v1", "-z"], repoRoot),
  ]);
  if (path.resolve(resolvedRoot) !== repoRoot || head !== baseRef || status) {
    throw new Error("Fan-in source repository baseline is dirty or stale.");
  }
}

async function readBoundPatch(reference: { path: string; sha256: string; byteLength: number }): Promise<Buffer> {
  const content = await fs.readFile(reference.path);
  if (content.byteLength !== reference.byteLength
    || createHash("sha256").update(content).digest("hex") !== reference.sha256) {
    throw new Error("Fan-in patch artifact digest is stale.");
  }
  return content;
}

async function checkPatch(patch: Buffer, cwd: string): Promise<{ ok: boolean }> {
  const patchPath = await writePatchCheck(patch, cwd);
  try {
    await runGit(["apply", "--check", "--binary", patchPath], cwd);
    return { ok: true };
  } catch {
    return { ok: false };
  } finally {
    await fs.rm(patchPath, { force: true }).catch(() => {});
  }
}

async function applyPatch(patch: Buffer, cwd: string): Promise<void> {
  const patchPath = await writePatchCheck(patch, cwd);
  try {
    await runGit(["apply", "--binary", patchPath], cwd);
  } finally {
    await fs.rm(patchPath, { force: true }).catch(() => {});
  }
}

async function writePatchCheck(patch: Buffer, cwd: string): Promise<string> {
  const patchPath = path.join(cwd, `.belldandy-fan-in-${randomUUID()}.patch`);
  await fs.writeFile(patchPath, patch, { mode: 0o600, flag: "wx" });
  return patchPath;
}

function inferConflictPaths(
  changedPaths: string[],
  lanes: SubTaskSupervisorFanInResolutionLane[],
  currentLaneId: string,
): string[] {
  const previous = new Set(lanes
    .filter((lane) => lane.binding.laneId !== currentLaneId)
    .flatMap((lane) => lane.artifact.changedPaths));
  const overlaps = changedPaths.filter((item) => previous.has(item));
  return overlaps.length > 0 ? overlaps : changedPaths;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}

function toPreview(record: FanInReceiptRecord): SubTaskSupervisorFanInResolutionPreview {
  return {
    status: record.status,
    receipt: { id: record.receiptId, expiresAtMs: record.expiresAtMs },
    laneCount: record.laneCount,
    conflictPaths: [...record.conflictPaths],
  };
}

function failed(blocker: string): SubTaskSupervisorFanInResolutionResult {
  return { status: "failed", applied: false, duplicateSideEffect: false, blockers: [blocker] };
}

function normalizeReceipt(value: unknown): FanInReceiptRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as FanInReceiptRecord;
  if (record.version !== 1 || !SAFE_ID_PATTERN.test(record.receiptId)
    || !SHA256_PATTERN.test(record.requestHash)
    || (record.status !== "ready" && record.status !== "conflict")
    || !Number.isSafeInteger(record.laneCount) || record.laneCount < 1
    || !Array.isArray(record.conflictPaths)
    || !Number.isSafeInteger(record.expiresAtMs)) return undefined;
  return record;
}
