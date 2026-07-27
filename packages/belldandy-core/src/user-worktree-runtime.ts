import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  ManagedWorktreeRuntime,
  type ManagedWorktree,
} from "./managed-worktree.js";
import {
  WorkspaceChangeSnapshotRuntime,
  type WorkspaceChangeBaseline,
  type WorkspaceChangeSnapshot,
  type WorkspaceChangeSnapshotPage,
} from "./workspace-change-snapshot.js";

const execFile = promisify(execFileCallback);
const RECORD_VERSION = 1;
const OPERATION_RECEIPT_VERSION = 1;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,96}$/;
const MAX_OWNER_ID_LENGTH = 256;
const OPERATION_RECEIPT_TTL_MS = 5 * 60 * 1000;
const MAX_OPERATION_PATCH_BYTES = 8 * 1024 * 1024;

export type UserWorktreeOwner = {
  conversationId: string;
  runId: string;
};

export type UserWorktreeCreateInput = {
  cwd: string;
  owner: UserWorktreeOwner;
};

export type UserWorktreeRetention = {
  status: "retained";
  reason: string;
};

export type UserWorktreeStatus = {
  worktreeId: string;
  owner: UserWorktreeOwner;
  worktreePath: string;
  repoRoot: string;
  baseCommit: string;
  currentCommit?: string;
  branch: string;
  dirty?: boolean;
  trackedChanges?: number;
  untrackedChanges?: number;
  conflictChanges?: number;
  extraCommitCount?: number;
  status: "ready" | "blocked" | "unavailable";
  blockers: string[];
  retention: UserWorktreeRetention;
  error?: string;
};

export type UserWorktreeDiff = {
  worktree: UserWorktreeStatus;
  snapshot: WorkspaceChangeSnapshot;
  page: WorkspaceChangeSnapshotPage;
};

export type UserWorktreeOperation = "apply" | "remove" | "stage" | "commit" | "branch";

export type UserWorktreeOperationReceipt = {
  receiptId: string;
  expiresAtMs: number;
};

export type UserWorktreeOperationEvidence = {
  artifactId: string;
  capturedAtMs: number;
  reasonCodes: string[];
};

export type UserWorktreeOperationAudit = {
  artifactId: string;
  capturedAtMs: number;
  commit?: string;
  publishedBranch?: string;
};

export type UserWorktreeOperationPreview = {
  operation: UserWorktreeOperation;
  worktreeId: string;
  canConfirm: boolean;
  blockers: string[];
  target?: {
    repoRoot: string;
    head: string;
  };
  patch?: {
    sha256: string;
    byteLength: number;
  };
  staged?: {
    indexTree: string;
    changedPathCount: number;
  };
  commit?: {
    message: string;
    messageHash: string;
    author: string;
    committer: string;
  };
  publish?: {
    sourceBranch: string;
    targetBranch: string;
    commit: string;
  };
  receipt?: UserWorktreeOperationReceipt;
  evidence?: UserWorktreeOperationEvidence;
};

export type UserWorktreeOperationPreviewInput = {
  operation: UserWorktreeOperation;
  worktreeId: string;
  commitMessage?: string;
  branchName?: string;
};

export type UserWorktreeOperationConfirmInput = {
  operation: UserWorktreeOperation;
  worktreeId: string;
  receiptId: string;
  confirm: boolean;
};

export type UserWorktreeOperationResult = UserWorktreeOperationPreview & {
  applied: boolean;
  audit?: UserWorktreeOperationAudit;
};

type UserWorktreeRecord = {
  version: number;
  registeredAt: string;
  owner: UserWorktreeOwner;
  worktree: ManagedWorktree;
};

type UserWorktreeOperationReceiptRecord = {
  version: number;
  receiptId: string;
  operation: UserWorktreeOperation;
  worktreeId: string;
  createdAtMs: number;
  expiresAtMs: number;
  baseCommit: string;
  currentCommit: string;
  branch: string;
  targetRepoRoot: string;
  targetHead: string;
  patchHash?: string;
  indexTree?: string;
  commitMessage?: string;
  commitMessageHash?: string;
  authorIdentityHash?: string;
  committerIdentityHash?: string;
  publishedBranch?: string;
  publishedBranchHash?: string;
};

type UserWorktreeOperationInspection = {
  preview: UserWorktreeOperationPreview;
  receiptBinding?: Omit<UserWorktreeOperationReceiptRecord, "version" | "receiptId" | "createdAtMs" | "expiresAtMs">;
  patch?: string;
};

function buildGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
  };
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return (await runGitOutput(args, cwd)).trim();
}

async function runGitOutput(args: string[], cwd: string, maxBuffer = 2 * 1024 * 1024): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer,
    env: buildGitEnv(),
  });
  return String(stdout ?? "");
}

async function runGitOptional(args: string[], cwd: string): Promise<string | undefined> {
  try {
    return await runGit(args, cwd);
  } catch {
    return undefined;
  }
}

function isSafeOwnerId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_OWNER_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isManagedWorktree(value: unknown): value is ManagedWorktree {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && SAFE_ID_PATTERN.test(candidate.id)
    && candidate.ownerKind === "user_session"
    && typeof candidate.requestedCwd === "string"
    && typeof candidate.resolvedCwd === "string"
    && typeof candidate.worktreePath === "string"
    && typeof candidate.repoRoot === "string"
    && typeof candidate.branch === "string"
    && typeof candidate.baseRef === "string"
    && (candidate.status === "created" || candidate.status === "failed" || candidate.status === "missing"
      || candidate.status === "removed" || candidate.status === "remove_failed" || candidate.status === "retained");
}

function readRecord(value: unknown): UserWorktreeRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== RECORD_VERSION || typeof candidate.registeredAt !== "string") return undefined;
  if (!candidate.owner || typeof candidate.owner !== "object" || Array.isArray(candidate.owner)) return undefined;
  const owner = candidate.owner as Record<string, unknown>;
  if (!isSafeOwnerId(owner.conversationId) || !isSafeOwnerId(owner.runId) || !isManagedWorktree(candidate.worktree)) return undefined;
  return {
    version: RECORD_VERSION,
    registeredAt: candidate.registeredAt,
    owner: { conversationId: owner.conversationId, runId: owner.runId },
    worktree: candidate.worktree,
  };
}

function isUserWorktreeOperation(value: unknown): value is UserWorktreeOperation {
  return value === "apply" || value === "remove" || value === "stage" || value === "commit" || value === "branch";
}

function readOperationReceipt(value: unknown): UserWorktreeOperationReceiptRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const receiptId = candidate.receiptId;
  const operation = candidate.operation;
  const worktreeId = candidate.worktreeId;
  const createdAtMs = candidate.createdAtMs;
  const expiresAtMs = candidate.expiresAtMs;
  if (candidate.version !== OPERATION_RECEIPT_VERSION
    || typeof receiptId !== "string" || !SAFE_ID_PATTERN.test(receiptId)
    || !isUserWorktreeOperation(operation)
    || typeof worktreeId !== "string" || !SAFE_ID_PATTERN.test(worktreeId)
    || typeof createdAtMs !== "number" || !Number.isSafeInteger(createdAtMs)
    || typeof expiresAtMs !== "number" || !Number.isSafeInteger(expiresAtMs)
    || typeof candidate.baseCommit !== "string"
    || typeof candidate.currentCommit !== "string"
    || typeof candidate.branch !== "string"
    || typeof candidate.targetRepoRoot !== "string"
    || typeof candidate.targetHead !== "string"
    || (candidate.patchHash !== undefined && typeof candidate.patchHash !== "string")
    || (candidate.indexTree !== undefined && typeof candidate.indexTree !== "string")
    || (candidate.commitMessage !== undefined && typeof candidate.commitMessage !== "string")
    || (candidate.commitMessageHash !== undefined && typeof candidate.commitMessageHash !== "string")
    || (candidate.authorIdentityHash !== undefined && typeof candidate.authorIdentityHash !== "string")
    || (candidate.committerIdentityHash !== undefined && typeof candidate.committerIdentityHash !== "string")
    || (candidate.publishedBranch !== undefined && typeof candidate.publishedBranch !== "string")
    || (candidate.publishedBranchHash !== undefined && typeof candidate.publishedBranchHash !== "string")) {
    return undefined;
  }
  return {
    version: OPERATION_RECEIPT_VERSION,
    receiptId,
    operation,
    worktreeId,
    createdAtMs,
    expiresAtMs,
    baseCommit: candidate.baseCommit,
    currentCommit: candidate.currentCommit,
    branch: candidate.branch,
    targetRepoRoot: candidate.targetRepoRoot,
    targetHead: candidate.targetHead,
    ...(typeof candidate.patchHash === "string" ? { patchHash: candidate.patchHash } : {}),
    ...(typeof candidate.indexTree === "string" ? { indexTree: candidate.indexTree } : {}),
    ...(typeof candidate.commitMessage === "string" ? { commitMessage: candidate.commitMessage } : {}),
    ...(typeof candidate.commitMessageHash === "string" ? { commitMessageHash: candidate.commitMessageHash } : {}),
    ...(typeof candidate.authorIdentityHash === "string" ? { authorIdentityHash: candidate.authorIdentityHash } : {}),
    ...(typeof candidate.committerIdentityHash === "string" ? { committerIdentityHash: candidate.committerIdentityHash } : {}),
    ...(typeof candidate.publishedBranch === "string" ? { publishedBranch: candidate.publishedBranch } : {}),
    ...(typeof candidate.publishedBranchHash === "string" ? { publishedBranchHash: candidate.publishedBranchHash } : {}),
  };
}

function normalizeCommitMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.replace(/\r\n/g, "\n").trim();
  if (!message || message.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) return undefined;
  return message;
}

function normalizeBranchName(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim()) return undefined;
  if (!value || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function normalizeGitIdentity(value: string): string | undefined {
  const match = /^(.*) \d+ [+-]\d{4}$/.exec(value.trim());
  const identity = match?.[1]?.trim();
  return identity && !/[\u0000-\u001f\u007f]/.test(identity) ? identity : undefined;
}

function parseUnsafeGitModes(value: string): string[] {
  const blockers: string[] = [];
  for (const entry of value.split("\0")) {
    if (!entry.startsWith(":")) continue;
    const match = /^:(\d{6}) (\d{6}) /.exec(entry);
    if (!match) {
      blockers.push("patch_metadata_unavailable");
      continue;
    }
    if (match[1] === "160000" || match[2] === "160000") blockers.push("submodule_boundary");
    if (match[1] === "120000" || match[2] === "120000") blockers.push("symlink_boundary");
  }
  return [...new Set(blockers)];
}

function parsePorcelainStatus(value: string): {
  trackedChanges: number;
  untrackedChanges: number;
  conflictChanges: number;
} {
  let trackedChanges = 0;
  let untrackedChanges = 0;
  let conflictChanges = 0;
  const records = value.split("\0").filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const code = record.slice(0, 2);
    if (code === "??") {
      untrackedChanges += 1;
    } else if (code.includes("U") || code === "AA" || code === "DD") {
      conflictChanges += 1;
    } else {
      trackedChanges += 1;
    }
    if (code.startsWith("R") || code.startsWith("C")) index += 1;
  }
  return { trackedChanges, untrackedChanges, conflictChanges };
}

function retention(): UserWorktreeRetention {
  return {
    status: "retained",
    reason: "user_session worktrees require an explicit user action before removal.",
  };
}

function buildUserWorktreeId(owner: UserWorktreeOwner): string {
  return `user-${createHash("sha256").update(`${owner.conversationId}\0${owner.runId}`).digest("hex").slice(0, 24)}`;
}

function hasSameOwner(status: UserWorktreeStatus, owner: UserWorktreeOwner): boolean {
  return status.owner.conversationId === owner.conversationId && status.owner.runId === owner.runId;
}

/**
 * Persisted registry and controlled local-delivery owner for user-facing managed worktrees.
 * All mutations require a short-lived receipt and a repeated final inspection.
 */
export class UserWorktreeRuntime {
  private readonly recordsDir: string;
  private readonly operationReceiptsDir: string;
  private readonly operationEvidenceDir: string;
  private readonly operationAuditDir: string;
  private readonly operationChecksDir: string;
  private readonly managedWorktrees: ManagedWorktreeRuntime;
  private readonly changeSnapshots: WorkspaceChangeSnapshotRuntime;

  constructor(stateDir: string) {
    const resolvedStateDir = path.resolve(stateDir);
    this.recordsDir = path.join(resolvedStateDir, "worktrees", "user-sessions");
    const operationStateDir = path.join(resolvedStateDir, "worktrees", "user-session-operations");
    this.operationReceiptsDir = path.join(operationStateDir, "receipts");
    this.operationEvidenceDir = path.join(operationStateDir, "evidence");
    this.operationAuditDir = path.join(operationStateDir, "audit");
    this.operationChecksDir = path.join(operationStateDir, "checks");
    this.managedWorktrees = new ManagedWorktreeRuntime(resolvedStateDir);
    this.changeSnapshots = new WorkspaceChangeSnapshotRuntime({ stateDir: resolvedStateDir });
  }

  async resolveSourceRepository(cwd: string): Promise<string> {
    return this.managedWorktrees.resolveRepositoryRoot(path.resolve(cwd));
  }

  async create(input: UserWorktreeCreateInput): Promise<UserWorktreeStatus> {
    if (!isSafeOwnerId(input.owner.conversationId) || !isSafeOwnerId(input.owner.runId)) {
      throw new Error("User worktree owner requires non-empty conversationId and runId.");
    }
    const id = buildUserWorktreeId(input.owner);
    const existing = await this.getStatus(id);
    if (existing) {
      if (hasSameOwner(existing, input.owner)) return existing;
      throw new Error("User worktree id is already bound to another owner.");
    }

    let worktree: ManagedWorktree;
    try {
      worktree = await this.managedWorktrees.prepare({
        id,
        ownerKind: "user_session",
        cwd: path.resolve(input.cwd),
      });
    } catch (error) {
      const concurrent = await this.getStatus(id);
      if (concurrent && hasSameOwner(concurrent, input.owner)) return concurrent;
      throw error;
    }
    try {
      await this.register(worktree, input.owner);
    } catch (error) {
      const cleanup = await this.managedWorktrees.abortPreparedWorktree(worktree);
      if (cleanup.status === "removed") {
        throw new Error("Failed to persist user worktree ownership; the unchanged prepared worktree was removed.");
      }
      throw new Error(`Failed to persist user worktree ownership; preserving the prepared worktree for recovery: ${cleanup.reason ?? cleanup.status}`);
    }
    const created = await this.getStatus(worktree.id);
    if (!created || !hasSameOwner(created, input.owner)) {
      throw new Error("Created user worktree record could not be read back; preserving it for recovery.");
    }
    return created;
  }

  async register(worktree: ManagedWorktree, owner: UserWorktreeOwner): Promise<void> {
    if (worktree.ownerKind !== "user_session") {
      throw new Error("Only user_session worktrees can be registered for user status.");
    }
    if (!isSafeOwnerId(owner.conversationId) || !isSafeOwnerId(owner.runId)) {
      throw new Error("User worktree owner requires non-empty conversationId and runId.");
    }
    const reconciled = await this.managedWorktrees.reconcile(worktree);
    if (reconciled.status !== "created") {
      throw new Error(`User worktree cannot be registered: ${reconciled.error ?? reconciled.status}`);
    }

    const recordPath = this.recordPath(reconciled.id);
    await fs.mkdir(this.recordsDir, { recursive: true });
    const record: UserWorktreeRecord = {
      version: RECORD_VERSION,
      registeredAt: new Date().toISOString(),
      owner: { conversationId: owner.conversationId, runId: owner.runId },
      worktree: reconciled,
    };
    const temporaryPath = `${recordPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
      await fs.link(temporaryPath, recordPath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        throw new Error(`User worktree is already registered: ${reconciled.id}`);
      }
      throw error;
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  async listStatus(): Promise<UserWorktreeStatus[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.recordsDir);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const recordNames = entries.filter((entry) => entry.endsWith(".json") && SAFE_ID_PATTERN.test(entry.slice(0, -5))).sort();
    return Promise.all(recordNames.map((entry) => this.readStatus(entry.slice(0, -5))));
  }

  async getStatus(worktreeId: string): Promise<UserWorktreeStatus | undefined> {
    if (!SAFE_ID_PATTERN.test(worktreeId)) return undefined;
    try {
      await fs.access(this.recordPath(worktreeId));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    return this.readStatus(worktreeId);
  }

  async diff(worktreeId: string): Promise<UserWorktreeDiff> {
    const worktree = await this.getStatus(worktreeId);
    if (!worktree) throw new Error("Managed user worktree was not found.");
    if (worktree.status === "unavailable") throw new Error("Managed user worktree is unavailable for diff.");
    const baseline = await this.ensureDiffBaseline(worktree);
    const snapshot = await this.changeSnapshots.createSnapshot({
      baselineId: baseline.baselineId,
      recovery: { managedWorktreeId: worktree.worktreeId },
    });
    return {
      worktree,
      snapshot,
      page: await this.changeSnapshots.readSnapshotPage({ snapshotId: snapshot.snapshotId }),
    };
  }

  async preview(input: UserWorktreeOperationPreviewInput): Promise<UserWorktreeOperationPreview> {
    const inspection = await this.inspectOperation(input);
    if (!inspection.receiptBinding) return inspection.preview;
    const receipt = await this.issueOperationReceipt(inspection.receiptBinding);
    return { ...inspection.preview, receipt };
  }

  async confirm(input: UserWorktreeOperationConfirmInput): Promise<UserWorktreeOperationResult> {
    if (input.confirm !== true) {
      return this.operationFailure(input.operation, input.worktreeId, ["confirmation_required"]);
    }
    const receipt = await this.consumeOperationReceipt(input);
    if (!receipt) {
      return this.operationFailure(input.operation, input.worktreeId, ["receipt_unavailable"]);
    }
    if (receipt.operation !== input.operation || receipt.worktreeId !== input.worktreeId) {
      return this.operationFailure(input.operation, input.worktreeId, ["receipt_mismatch"]);
    }
    if (receipt.expiresAtMs < Date.now()) {
      return this.operationFailure(input.operation, input.worktreeId, ["receipt_expired"]);
    }

    const inspection = await this.inspectOperation({
      operation: input.operation,
      worktreeId: input.worktreeId,
      ...(input.operation === "commit" && receipt.commitMessage ? { commitMessage: receipt.commitMessage } : {}),
      ...(input.operation === "branch" && receipt.publishedBranch ? { branchName: receipt.publishedBranch } : {}),
    });
    if (!inspection.receiptBinding || !this.matchesReceipt(inspection.receiptBinding, receipt)) {
      if (!inspection.receiptBinding) return { ...inspection.preview, applied: false };
      return this.operationFailure(input.operation, input.worktreeId, ["receipt_stale"]);
    }

    try {
      let audit: UserWorktreeOperationAudit | undefined;
      if (input.operation === "apply") {
        await this.applyPatch(inspection.receiptBinding.targetRepoRoot, inspection.patch ?? "");
      } else if (input.operation === "remove") {
        await this.removeWorktree(input.worktreeId);
      } else if (input.operation === "stage") {
        const indexTree = await this.stageWorktree(input.worktreeId, receipt);
        audit = await this.writeOperationAudit(receipt, { indexTree });
      } else if (input.operation === "commit") {
        const commit = await this.commitWorktree(input.worktreeId, receipt);
        audit = await this.writeOperationAudit(receipt, { commit });
      } else {
        const commit = await this.publishBranch(input.worktreeId, receipt);
        audit = await this.writeOperationAudit(receipt, { commit });
      }
      return { ...inspection.preview, applied: true, ...(audit ? { audit } : {}) };
    } catch {
      return this.operationFailure(input.operation, input.worktreeId, ["operation_failed"]);
    }
  }

  private async inspectOperation(input: UserWorktreeOperationPreviewInput): Promise<UserWorktreeOperationInspection> {
    if (!isUserWorktreeOperation(input.operation) || !SAFE_ID_PATTERN.test(input.worktreeId)) {
      return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, ["invalid_operation_request"]) };
    }
    const record = await this.loadRecord(input.worktreeId);
    const worktree = await this.getStatus(input.worktreeId);
    if (!record || !worktree) {
      return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, ["worktree_not_found"]) };
    }
    if (worktree.status === "unavailable" || !worktree.currentCommit) {
      return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, ["worktree_unavailable"]) };
    }

    const blockers: string[] = [];
    if (worktree.conflictChanges && worktree.conflictChanges > 0) blockers.push("unresolved_conflicts");
    if (input.operation !== "branch" && worktree.extraCommitCount && worktree.extraCommitCount > 0) blockers.push("extra_commits");
    if (worktree.untrackedChanges && worktree.untrackedChanges > 0) blockers.push("untracked_changes");
    if (input.operation === "remove" && worktree.dirty) blockers.push("uncommitted_changes");
    if (input.operation === "apply" && !worktree.trackedChanges) blockers.push("empty_patch");
    if (blockers.length > 0) {
      return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, blockers) };
    }
    if (input.operation === "stage") {
      return this.inspectStageOperation(worktree, input.worktreeId);
    }
    if (input.operation === "commit") {
      return this.inspectCommitOperation(worktree, input.worktreeId, input.commitMessage);
    }
    if (input.operation === "branch") {
      return this.inspectBranchOperation(record.worktree, worktree, input.worktreeId, input.branchName);
    }

    try {
      const [workingChangeModes, stagedChangeModes, stagedPaths] = await Promise.all([
        runGitOutput(
          ["diff", "--raw", "-z", "--no-renames", worktree.baseCommit, "--"],
          worktree.worktreePath,
        ),
        runGitOutput(
          ["diff", "--cached", "--raw", "-z", "--no-renames", worktree.baseCommit, "--"],
          worktree.worktreePath,
        ),
        runGitOutput(
          ["diff", "--cached", "--name-only", "-z", worktree.baseCommit, "--"],
          worktree.worktreePath,
        ),
      ]);
      const boundaryBlockers = parseUnsafeGitModes(`${workingChangeModes}${stagedChangeModes}`);
      if (boundaryBlockers.length > 0) {
        return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, boundaryBlockers) };
      }
      if (input.operation === "apply" && stagedPaths) {
        return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, ["staged_changes"]) };
      }

      const target = await this.inspectTarget(record.worktree, worktree.baseCommit);
      if (target.blockers.length > 0 || !target.repoRoot || !target.head) {
        return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, target.blockers) };
      }

      let patch: string | undefined;
      let patchHash: string | undefined;
      if (input.operation === "apply") {
        patch = await runGitOutput(
          ["diff", "--binary", "--no-ext-diff", worktree.baseCommit, "--"],
          worktree.worktreePath,
          MAX_OPERATION_PATCH_BYTES,
        );
        if (!patch.trim()) {
          return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, ["empty_patch"]) };
        }
        patchHash = createHash("sha256").update(patch).digest("hex");
        await this.checkPatch(target.repoRoot, patch);
      }

      const receiptBinding = {
        operation: input.operation,
        worktreeId: input.worktreeId,
        baseCommit: worktree.baseCommit,
        currentCommit: worktree.currentCommit,
        branch: worktree.branch,
        targetRepoRoot: target.repoRoot,
        targetHead: target.head,
        ...(patchHash ? { patchHash } : {}),
      };
      return {
        preview: {
          operation: input.operation,
          worktreeId: input.worktreeId,
          canConfirm: true,
          blockers: [],
          target: { repoRoot: target.repoRoot, head: target.head },
          ...(patchHash ? { patch: { sha256: patchHash, byteLength: Buffer.byteLength(patch ?? "") } } : {}),
        },
        receiptBinding,
        patch,
      };
    } catch {
      return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, ["inspection_failed"]) };
    }
  }

  private async inspectStageOperation(
    worktree: UserWorktreeStatus,
    worktreeId: string,
  ): Promise<UserWorktreeOperationInspection> {
    try {
      const [stagedPaths, workingChangeModes, patch, indexTree] = await Promise.all([
        runGitOutput(["diff", "--cached", "--name-only", "-z", worktree.baseCommit, "--"], worktree.worktreePath),
        runGitOutput(["diff", "--raw", "-z", "--no-renames", "--"], worktree.worktreePath),
        runGitOutput(["diff", "--binary", "--no-ext-diff", "--"], worktree.worktreePath, MAX_OPERATION_PATCH_BYTES),
        runGit(["write-tree"], worktree.worktreePath),
      ]);
      if (stagedPaths) {
        return { preview: await this.operationPreviewFailure("stage", worktreeId, ["staged_changes"]) };
      }
      const boundaryBlockers = parseUnsafeGitModes(workingChangeModes);
      if (boundaryBlockers.length > 0) {
        return { preview: await this.operationPreviewFailure("stage", worktreeId, boundaryBlockers) };
      }
      if (!patch.trim()) {
        return { preview: await this.operationPreviewFailure("stage", worktreeId, ["empty_patch"]) };
      }
      const patchHash = createHash("sha256").update(patch).digest("hex");
      const changedPathCount = patch.split("\n").filter((line) => line.startsWith("diff --git ")).length;
      if (changedPathCount < 1 || !indexTree) {
        return { preview: await this.operationPreviewFailure("stage", worktreeId, ["index_state_unavailable"]) };
      }
      const receiptBinding = {
        operation: "stage" as const,
        worktreeId,
        baseCommit: worktree.baseCommit,
        currentCommit: worktree.currentCommit ?? "",
        branch: worktree.branch,
        targetRepoRoot: worktree.worktreePath,
        targetHead: worktree.currentCommit ?? "",
        patchHash,
        indexTree,
      };
      return {
        preview: {
          operation: "stage",
          worktreeId,
          canConfirm: true,
          blockers: [],
          patch: { sha256: patchHash, byteLength: Buffer.byteLength(patch) },
          staged: { indexTree, changedPathCount },
        },
        receiptBinding,
        patch,
      };
    } catch {
      return { preview: await this.operationPreviewFailure("stage", worktreeId, ["inspection_failed"]) };
    }
  }

  private async inspectCommitOperation(
    worktree: UserWorktreeStatus,
    worktreeId: string,
    inputMessage: unknown,
  ): Promise<UserWorktreeOperationInspection> {
    const message = normalizeCommitMessage(inputMessage);
    if (!message) {
      return { preview: await this.operationPreviewFailure("commit", worktreeId, ["invalid_commit_message"]) };
    }
    try {
      const [unstagedPaths, stagedPaths, stagedChangeModes, patch, indexTree] = await Promise.all([
        runGitOutput(["diff", "--name-only", "-z", "--"], worktree.worktreePath),
        runGitOutput(["diff", "--cached", "--name-only", "-z", worktree.baseCommit, "--"], worktree.worktreePath),
        runGitOutput(["diff", "--cached", "--raw", "-z", "--no-renames", worktree.baseCommit, "--"], worktree.worktreePath),
        runGitOutput(["diff", "--cached", "--binary", "--no-ext-diff", worktree.baseCommit, "--"], worktree.worktreePath, MAX_OPERATION_PATCH_BYTES),
        runGit(["write-tree"], worktree.worktreePath),
      ]);
      if (unstagedPaths) {
        return { preview: await this.operationPreviewFailure("commit", worktreeId, ["unstaged_changes"]) };
      }
      if (!stagedPaths || !patch.trim()) {
        return { preview: await this.operationPreviewFailure("commit", worktreeId, ["empty_staged_diff"]) };
      }
      const boundaryBlockers = parseUnsafeGitModes(stagedChangeModes);
      if (boundaryBlockers.length > 0) {
        return { preview: await this.operationPreviewFailure("commit", worktreeId, boundaryBlockers) };
      }
      if (await this.hasCommitHooks(worktree.worktreePath)) {
        return { preview: await this.operationPreviewFailure("commit", worktreeId, ["commit_hooks_present"]) };
      }
      const [rawAuthor, rawCommitter] = await Promise.all([
        runGit(["var", "GIT_AUTHOR_IDENT"], worktree.worktreePath),
        runGit(["var", "GIT_COMMITTER_IDENT"], worktree.worktreePath),
      ]);
      const author = normalizeGitIdentity(rawAuthor);
      const committer = normalizeGitIdentity(rawCommitter);
      if (!author || !committer) {
        return { preview: await this.operationPreviewFailure("commit", worktreeId, ["commit_identity_unavailable"]) };
      }
      if (!indexTree) {
        return { preview: await this.operationPreviewFailure("commit", worktreeId, ["index_state_unavailable"]) };
      }
      const patchHash = createHash("sha256").update(patch).digest("hex");
      const messageHash = createHash("sha256").update(message).digest("hex");
      const authorIdentityHash = createHash("sha256").update(author).digest("hex");
      const committerIdentityHash = createHash("sha256").update(committer).digest("hex");
      const changedPathCount = stagedPaths.split("\0").filter(Boolean).length;
      const receiptBinding = {
        operation: "commit" as const,
        worktreeId,
        baseCommit: worktree.baseCommit,
        currentCommit: worktree.currentCommit ?? "",
        branch: worktree.branch,
        targetRepoRoot: worktree.worktreePath,
        targetHead: worktree.currentCommit ?? "",
        patchHash,
        indexTree,
        commitMessage: message,
        commitMessageHash: messageHash,
        authorIdentityHash,
        committerIdentityHash,
      };
      return {
        preview: {
          operation: "commit",
          worktreeId,
          canConfirm: true,
          blockers: [],
          patch: { sha256: patchHash, byteLength: Buffer.byteLength(patch) },
          staged: { indexTree, changedPathCount },
          commit: { message, messageHash, author, committer },
        },
        receiptBinding,
        patch,
      };
    } catch {
      return { preview: await this.operationPreviewFailure("commit", worktreeId, ["commit_identity_unavailable"]) };
    }
  }

  private async inspectBranchOperation(
    managedWorktree: ManagedWorktree,
    worktree: UserWorktreeStatus,
    worktreeId: string,
    inputBranchName: unknown,
  ): Promise<UserWorktreeOperationInspection> {
    const branchName = normalizeBranchName(inputBranchName);
    if (!branchName) {
      return { preview: await this.operationPreviewFailure("branch", worktreeId, ["invalid_branch_name"]) };
    }
    const checkedBranchName = await runGitOptional(["check-ref-format", "--branch", branchName], worktree.worktreePath);
    if (checkedBranchName !== branchName) {
      return { preview: await this.operationPreviewFailure("branch", worktreeId, ["invalid_branch_name"]) };
    }
    if (worktree.dirty || worktree.trackedChanges || worktree.untrackedChanges || worktree.conflictChanges) {
      return { preview: await this.operationPreviewFailure("branch", worktreeId, ["uncommitted_changes"]) };
    }
    if (!worktree.currentCommit
      || worktree.currentCommit === worktree.baseCommit
      || !worktree.extraCommitCount
      || worktree.extraCommitCount < 1) {
      return { preview: await this.operationPreviewFailure("branch", worktreeId, ["commit_required"]) };
    }

    try {
      const reconciled = await this.managedWorktrees.reconcile(managedWorktree);
      if (reconciled.status !== "created"
        || reconciled.branch !== worktree.branch
        || reconciled.baseRef !== worktree.baseCommit) {
        return { preview: await this.operationPreviewFailure("branch", worktreeId, ["worktree_unavailable"]) };
      }
      const resolvedRepoRoot = await runGit(["rev-parse", "--show-toplevel"], reconciled.repoRoot);
      if (path.resolve(resolvedRepoRoot) !== path.resolve(reconciled.repoRoot)) {
        return { preview: await this.operationPreviewFailure("branch", worktreeId, ["target_unavailable"]) };
      }
      await runGit(["cat-file", "-e", `${worktree.currentCommit}^{commit}`], reconciled.worktreePath);
      await runGit(["merge-base", "--is-ancestor", worktree.baseCommit, worktree.currentCommit], reconciled.worktreePath);
      const existingBranch = await runGitOptional(
        ["show-ref", "--verify", "--hash", `refs/heads/${branchName}`],
        reconciled.repoRoot,
      );
      if (existingBranch) {
        return { preview: await this.operationPreviewFailure("branch", worktreeId, ["branch_exists"]) };
      }

      const publishedBranchHash = createHash("sha256").update(branchName).digest("hex");
      const receiptBinding = {
        operation: "branch" as const,
        worktreeId,
        baseCommit: worktree.baseCommit,
        currentCommit: worktree.currentCommit,
        branch: worktree.branch,
        targetRepoRoot: reconciled.repoRoot,
        targetHead: worktree.currentCommit,
        publishedBranch: branchName,
        publishedBranchHash,
      };
      return {
        preview: {
          operation: "branch",
          worktreeId,
          canConfirm: true,
          blockers: [],
          publish: {
            sourceBranch: worktree.branch,
            targetBranch: branchName,
            commit: worktree.currentCommit,
          },
        },
        receiptBinding,
      };
    } catch {
      return { preview: await this.operationPreviewFailure("branch", worktreeId, ["inspection_failed"]) };
    }
  }

  private async hasCommitHooks(worktreePath: string): Promise<boolean> {
    const [commonDir, configuredHooksPath] = await Promise.all([
      runGit(["rev-parse", "--git-common-dir"], worktreePath),
      runGitOptional(["config", "--path", "--get", "core.hooksPath"], worktreePath),
    ]);
    const hookRoots = [path.join(path.resolve(worktreePath, commonDir), "hooks")];
    if (configuredHooksPath) {
      hookRoots.push(path.isAbsolute(configuredHooksPath)
        ? configuredHooksPath
        : path.resolve(worktreePath, configuredHooksPath));
    }
    const hookPaths = hookRoots.flatMap((root) => [
      path.join(root, "pre-commit"),
      path.join(root, "prepare-commit-msg"),
      path.join(root, "commit-msg"),
    ]);
    const found = await Promise.all(hookPaths.map(async (hookPath) => {
      try {
        await fs.lstat(hookPath);
        return true;
      } catch {
        return false;
      }
    }));
    return found.some(Boolean);
  }

  private async inspectTarget(worktree: ManagedWorktree, baseCommit: string): Promise<{
    blockers: string[];
    repoRoot?: string;
    head?: string;
  }> {
    try {
      const [resolvedRoot, porcelain, head] = await Promise.all([
        runGit(["rev-parse", "--show-toplevel"], worktree.repoRoot),
        runGit(["status", "--porcelain=v1", "-z"], worktree.repoRoot),
        runGit(["rev-parse", "HEAD"], worktree.repoRoot),
      ]);
      if (path.resolve(resolvedRoot) !== path.resolve(worktree.repoRoot)) return { blockers: ["target_unavailable"] };
      const blockers: string[] = [];
      if (porcelain) blockers.push("target_dirty");
      if (!head || head !== baseCommit) blockers.push("target_head_drift");
      return { blockers, repoRoot: worktree.repoRoot, head };
    } catch {
      return { blockers: ["target_unavailable"] };
    }
  }

  private async issueOperationReceipt(
    binding: Omit<UserWorktreeOperationReceiptRecord, "version" | "receiptId" | "createdAtMs" | "expiresAtMs">,
  ): Promise<UserWorktreeOperationReceipt> {
    const createdAtMs = Date.now();
    const receipt: UserWorktreeOperationReceiptRecord = {
      version: OPERATION_RECEIPT_VERSION,
      receiptId: `worktree-operation-${randomUUID()}`,
      createdAtMs,
      expiresAtMs: createdAtMs + OPERATION_RECEIPT_TTL_MS,
      ...binding,
    };
    await fs.mkdir(this.operationReceiptsDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      this.operationReceiptPath(receipt.receiptId),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { encoding: "utf-8", mode: 0o600, flag: "wx" },
    );
    return { receiptId: receipt.receiptId, expiresAtMs: receipt.expiresAtMs };
  }

  private async consumeOperationReceipt(input: UserWorktreeOperationConfirmInput): Promise<UserWorktreeOperationReceiptRecord | undefined> {
    if (!SAFE_ID_PATTERN.test(input.receiptId) || !SAFE_ID_PATTERN.test(input.worktreeId)) return undefined;
    const receiptPath = this.operationReceiptPath(input.receiptId);
    try {
      const receipt = readOperationReceipt(JSON.parse(await fs.readFile(receiptPath, "utf-8")));
      if (!receipt) return undefined;
      await fs.link(receiptPath, this.operationReceiptLockPath(input.receiptId));
      return receipt;
    } catch {
      return undefined;
    }
  }

  private matchesReceipt(
    binding: Omit<UserWorktreeOperationReceiptRecord, "version" | "receiptId" | "createdAtMs" | "expiresAtMs">,
    receipt: UserWorktreeOperationReceiptRecord,
  ): boolean {
    return binding.operation === receipt.operation
      && binding.worktreeId === receipt.worktreeId
      && binding.baseCommit === receipt.baseCommit
      && binding.currentCommit === receipt.currentCommit
      && binding.branch === receipt.branch
      && path.resolve(binding.targetRepoRoot) === path.resolve(receipt.targetRepoRoot)
      && binding.targetHead === receipt.targetHead
      && binding.patchHash === receipt.patchHash
      && binding.indexTree === receipt.indexTree
      && binding.commitMessage === receipt.commitMessage
      && binding.commitMessageHash === receipt.commitMessageHash
      && binding.authorIdentityHash === receipt.authorIdentityHash
      && binding.committerIdentityHash === receipt.committerIdentityHash
      && binding.publishedBranch === receipt.publishedBranch
      && binding.publishedBranchHash === receipt.publishedBranchHash;
  }

  private async checkPatch(repoRoot: string, patch: string): Promise<void> {
    const patchPath = await this.writeOperationPatch("check", patch);
    try {
      await runGit(["apply", "--check", "--binary", patchPath], repoRoot);
    } finally {
      await fs.rm(path.dirname(patchPath), { recursive: true, force: true }).catch(() => {});
    }
  }

  private async applyPatch(repoRoot: string, patch: string): Promise<void> {
    const patchPath = await this.writeOperationPatch("apply", patch);
    try {
      // A second Git-native check narrows the window between final inspection and write.
      await runGit(["apply", "--check", "--binary", patchPath], repoRoot);
      await runGit(["apply", "--binary", patchPath], repoRoot);
    } finally {
      await fs.rm(path.dirname(patchPath), { recursive: true, force: true }).catch(() => {});
    }
  }

  private async stageWorktree(worktreeId: string, receipt: UserWorktreeOperationReceiptRecord): Promise<string> {
    const inspection = await this.inspectOperation({ operation: "stage", worktreeId });
    if (!inspection.receiptBinding || !this.matchesReceipt(inspection.receiptBinding, receipt)) {
      throw new Error("Managed user worktree changed before staging.");
    }
    const record = await this.loadRecord(worktreeId);
    if (!record) throw new Error("Managed user worktree record is unavailable.");
    const reconciled = await this.managedWorktrees.reconcile(record.worktree);
    if (reconciled.status !== "created") throw new Error("Managed user worktree is unavailable for staging.");
    await runGit(["add", "-u", "--"], reconciled.worktreePath);
    const [indexTree, stagedPaths] = await Promise.all([
      runGit(["write-tree"], reconciled.worktreePath),
      runGitOutput(["diff", "--cached", "--name-only", "-z", reconciled.baseRef, "--"], reconciled.worktreePath),
    ]);
    if (!indexTree || !stagedPaths) throw new Error("Managed user worktree staging did not produce a staged diff.");
    return indexTree;
  }

  private async commitWorktree(worktreeId: string, receipt: UserWorktreeOperationReceiptRecord): Promise<string> {
    const message = normalizeCommitMessage(receipt.commitMessage);
    if (!message) throw new Error("Managed user worktree commit receipt is missing its message.");
    const inspection = await this.inspectOperation({ operation: "commit", worktreeId, commitMessage: message });
    if (!inspection.receiptBinding || !this.matchesReceipt(inspection.receiptBinding, receipt)) {
      throw new Error("Managed user worktree changed before commit.");
    }
    const record = await this.loadRecord(worktreeId);
    if (!record) throw new Error("Managed user worktree record is unavailable.");
    const reconciled = await this.managedWorktrees.reconcile(record.worktree);
    if (reconciled.status !== "created") throw new Error("Managed user worktree is unavailable for commit.");
    await runGit(["commit", "-m", message], reconciled.worktreePath);
    const commit = await runGit(["rev-parse", "HEAD"], reconciled.worktreePath);
    if (!commit || commit === reconciled.baseRef) throw new Error("Managed user worktree commit did not advance HEAD.");
    const [parent, tree, actualMessage, author, committer] = await Promise.all([
      runGit(["rev-parse", `${commit}^`], reconciled.worktreePath),
      runGit(["show", "-s", "--format=%T", commit], reconciled.worktreePath),
      runGit(["show", "-s", "--format=%B", commit], reconciled.worktreePath),
      runGit(["show", "-s", "--format=%an <%ae>", commit], reconciled.worktreePath),
      runGit(["show", "-s", "--format=%cn <%ce>", commit], reconciled.worktreePath),
    ]);
    if (parent !== receipt.currentCommit
      || tree !== receipt.indexTree
      || normalizeCommitMessage(actualMessage) !== message
      || createHash("sha256").update(author).digest("hex") !== receipt.authorIdentityHash
      || createHash("sha256").update(committer).digest("hex") !== receipt.committerIdentityHash) {
      throw new Error("Managed user worktree commit does not match its confirmed receipt.");
    }
    return commit;
  }

  private async publishBranch(worktreeId: string, receipt: UserWorktreeOperationReceiptRecord): Promise<string> {
    const branchName = normalizeBranchName(receipt.publishedBranch);
    if (!branchName
      || createHash("sha256").update(branchName).digest("hex") !== receipt.publishedBranchHash) {
      throw new Error("Managed user worktree branch receipt is invalid.");
    }
    const inspection = await this.inspectOperation({ operation: "branch", worktreeId, branchName });
    if (!inspection.receiptBinding || !this.matchesReceipt(inspection.receiptBinding, receipt)) {
      throw new Error("Managed user worktree changed before branch publication.");
    }
    await runGit(["branch", "--", branchName, receipt.currentCommit], receipt.targetRepoRoot);
    const publishedCommit = await runGit(
      ["rev-parse", "--verify", `refs/heads/${branchName}^{commit}`],
      receipt.targetRepoRoot,
    );
    if (publishedCommit !== receipt.currentCommit) {
      throw new Error("Published local branch does not match its confirmed commit.");
    }
    return publishedCommit;
  }

  private async writeOperationPatch(prefix: string, patch: string): Promise<string> {
    await fs.mkdir(this.operationChecksDir, { recursive: true, mode: 0o700 });
    const directory = await fs.mkdtemp(path.join(this.operationChecksDir, `${prefix}-`));
    const patchPath = path.join(directory, "change.patch");
    await fs.writeFile(patchPath, patch, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    return patchPath;
  }

  private async writeOperationAudit(
    receipt: UserWorktreeOperationReceiptRecord,
    outcome: { indexTree?: string; commit?: string },
  ): Promise<UserWorktreeOperationAudit | undefined> {
    const capturedAtMs = Date.now();
    const artifactId = `worktree-operation-${randomUUID()}`;
    try {
      await fs.mkdir(this.operationAuditDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(this.operationAuditDir, `${artifactId}.json`),
        `${JSON.stringify({
          version: 1,
          artifactId,
          capturedAtMs,
          receiptId: receipt.receiptId,
          operation: receipt.operation,
          worktreeId: receipt.worktreeId,
          baseCommit: receipt.baseCommit,
          branch: receipt.branch,
          patchHash: receipt.patchHash,
          indexTree: outcome.indexTree ?? receipt.indexTree,
          commitMessageHash: receipt.commitMessageHash,
          authorIdentityHash: receipt.authorIdentityHash,
          committerIdentityHash: receipt.committerIdentityHash,
          publishedBranch: receipt.publishedBranch,
          publishedBranchHash: receipt.publishedBranchHash,
          commit: outcome.commit,
        }, null, 2)}\n`,
        { encoding: "utf-8", mode: 0o600, flag: "wx" },
      );
      return {
        artifactId,
        capturedAtMs,
        ...(outcome.commit ? { commit: outcome.commit } : {}),
        ...(receipt.publishedBranch ? { publishedBranch: receipt.publishedBranch } : {}),
      };
    } catch {
      return undefined;
    }
  }

  private async removeWorktree(worktreeId: string): Promise<void> {
    const record = await this.loadRecord(worktreeId);
    if (!record) throw new Error("Managed user worktree record is unavailable.");
    const reconciled = await this.managedWorktrees.reconcile(record.worktree);
    if (reconciled.status !== "created") throw new Error("Managed user worktree is unavailable for removal.");
    const current = await this.getStatus(worktreeId);
    if (!current
      || current.status !== "ready"
      || current.currentCommit !== reconciled.baseRef
      || current.branch !== reconciled.branch
      || current.dirty
      || current.extraCommitCount !== 0) {
      throw new Error("Managed user worktree changed before removal.");
    }
    await runGit(["worktree", "remove", reconciled.worktreePath], reconciled.repoRoot);
    const branch = await runGit(["branch", "--list", reconciled.branch], reconciled.repoRoot);
    if (branch) await runGit(["branch", "-d", reconciled.branch], reconciled.repoRoot);
    await runGit(["worktree", "prune"], reconciled.repoRoot).catch(() => "");
  }

  private async operationPreviewFailure(
    operation: UserWorktreeOperation,
    worktreeId: string,
    blockers: string[],
  ): Promise<UserWorktreeOperationPreview> {
    return {
      operation,
      worktreeId,
      canConfirm: false,
      blockers: [...new Set(blockers)],
      evidence: await this.writeOperationEvidence(operation, worktreeId, blockers),
    };
  }

  private async operationFailure(
    operation: UserWorktreeOperation,
    worktreeId: string,
    blockers: string[],
  ): Promise<UserWorktreeOperationResult> {
    return { ...await this.operationPreviewFailure(operation, worktreeId, blockers), applied: false };
  }

  private async writeOperationEvidence(
    operation: UserWorktreeOperation,
    worktreeId: string,
    blockers: string[],
  ): Promise<UserWorktreeOperationEvidence | undefined> {
    const capturedAtMs = Date.now();
    const artifactId = `worktree-operation-${randomUUID()}`;
    try {
      await fs.mkdir(this.operationEvidenceDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(this.operationEvidenceDir, `${artifactId}.json`),
        `${JSON.stringify({
          version: 1,
          artifactId,
          capturedAtMs,
          operation,
          worktreeId,
          reasonCodes: [...new Set(blockers)],
        }, null, 2)}\n`,
        { encoding: "utf-8", mode: 0o600, flag: "wx" },
      );
      return { artifactId, capturedAtMs, reasonCodes: [...new Set(blockers)] };
    } catch {
      return undefined;
    }
  }

  private async loadRecord(worktreeId: string): Promise<UserWorktreeRecord | undefined> {
    if (!SAFE_ID_PATTERN.test(worktreeId)) return undefined;
    try {
      return readRecord(JSON.parse(await fs.readFile(this.recordPath(worktreeId), "utf-8")));
    } catch {
      return undefined;
    }
  }

  private operationReceiptPath(receiptId: string): string {
    if (!SAFE_ID_PATTERN.test(receiptId)) throw new Error("User worktree operation receipt id is invalid.");
    return path.join(this.operationReceiptsDir, `${receiptId}.json`);
  }

  private operationReceiptLockPath(receiptId: string): string {
    if (!SAFE_ID_PATTERN.test(receiptId)) throw new Error("User worktree operation receipt id is invalid.");
    return path.join(this.operationReceiptsDir, `${receiptId}.lock`);
  }

  private async ensureDiffBaseline(worktree: UserWorktreeStatus): Promise<WorkspaceChangeBaseline> {
    const baselineId = `user-worktree-${worktree.worktreeId}-base`;
    let baseline: WorkspaceChangeBaseline;
    try {
      baseline = await this.changeSnapshots.readBaseline({ baselineId });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Workspace snapshot baseline was not found.") throw error;
      try {
        baseline = await this.changeSnapshots.captureBaseline({
          baselineId,
          workspaceRoot: worktree.worktreePath,
          source: "worktree_base",
          revision: worktree.baseCommit,
        });
      } catch (captureError) {
        if (!(captureError instanceof Error) || captureError.message !== "Workspace snapshot baseline already exists.") throw captureError;
        baseline = await this.changeSnapshots.readBaseline({ baselineId });
      }
    }
    if (baseline.source !== "worktree_base"
      || baseline.revision !== worktree.baseCommit
      || path.resolve(baseline.workspaceRoot) !== path.resolve(worktree.worktreePath)) {
      throw new Error("Managed user worktree diff baseline does not match its recorded base.");
    }
    return baseline;
  }

  private async readStatus(worktreeId: string): Promise<UserWorktreeStatus> {
    const invalid = (): UserWorktreeStatus => ({
      worktreeId,
      owner: { conversationId: "unavailable", runId: "unavailable" },
      worktreePath: "",
      repoRoot: "",
      baseCommit: "",
      branch: "",
      status: "unavailable",
      blockers: ["invalid_record"],
      retention: retention(),
      error: "Persisted user worktree record is invalid.",
    });
    let record: UserWorktreeRecord | undefined;
    try {
      record = readRecord(JSON.parse(await fs.readFile(this.recordPath(worktreeId), "utf-8")));
    } catch {
      return invalid();
    }
    if (!record) return invalid();

    const reconciled = await this.managedWorktrees.reconcile(record.worktree);
    const status: UserWorktreeStatus = {
      worktreeId,
      owner: record.owner,
      worktreePath: record.worktree.worktreePath,
      repoRoot: record.worktree.repoRoot,
      baseCommit: record.worktree.baseRef,
      branch: record.worktree.branch,
      status: "unavailable",
      blockers: [],
      retention: retention(),
    };
    if (reconciled.status !== "created") {
      return {
        ...status,
        blockers: ["worktree_unavailable"],
        error: reconciled.error ?? "Managed worktree is unavailable.",
      };
    }

    try {
      const [currentCommit, actualBranch, porcelain, extraCommitText] = await Promise.all([
        runGit(["rev-parse", "HEAD"], reconciled.worktreePath),
        runGit(["branch", "--show-current"], reconciled.worktreePath),
        runGit(["status", "--porcelain=v1", "-z"], reconciled.worktreePath),
        runGit(["rev-list", "--count", `${reconciled.baseRef}..HEAD`], reconciled.worktreePath),
      ]);
      const changes = parsePorcelainStatus(porcelain);
      const extraCommitCount = Number.parseInt(extraCommitText, 10);
      if (!currentCommit || actualBranch !== reconciled.branch || !Number.isSafeInteger(extraCommitCount) || extraCommitCount < 0) {
        return {
          ...status,
          currentCommit: currentCommit || undefined,
          blockers: ["git_state_unavailable"],
          error: "Managed worktree Git state is inconsistent.",
        };
      }
      const blockers: string[] = [];
      if (changes.conflictChanges > 0) blockers.push("unresolved_conflicts");
      if (changes.trackedChanges > 0 || changes.untrackedChanges > 0) blockers.push("uncommitted_changes");
      if (extraCommitCount > 0) blockers.push("extra_commits");
      return {
        ...status,
        currentCommit,
        dirty: porcelain.length > 0,
        ...changes,
        extraCommitCount,
        status: blockers.length > 0 ? "blocked" : "ready",
        blockers,
      };
    } catch {
      return {
        ...status,
        blockers: ["git_state_unavailable"],
        error: "Failed to inspect managed worktree Git state.",
      };
    }
  }

  private recordPath(worktreeId: string): string {
    if (!SAFE_ID_PATTERN.test(worktreeId)) throw new Error("User worktree id is invalid.");
    return path.join(this.recordsDir, `${worktreeId}.json`);
  }
}
