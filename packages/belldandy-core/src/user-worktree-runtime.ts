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
  decision?: UserWorktreeLifecycleDecision;
  decidedAtMs?: number;
};

export type UserWorktreeLifecycleDecision = "keep" | "discard";

export type UserWorktreeLifecycle = {
  decision: UserWorktreeLifecycleDecision;
  decidedAtMs: number;
  receiptId: string;
};

export type UserWorktreeLifecycleEvidence = {
  lifecycle: "kept" | "discard_pending" | "discarded" | "uncertain";
  observedAtMs: number;
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

export type UserWorktreeOperation = "keep" | "apply" | "discard" | "remove" | "stage" | "commit" | "branch";

export type UserWorktreeSweepItem = {
  worktreeId: string;
  decision?: UserWorktreeLifecycleDecision;
  outcome: "discarded" | "retained" | "locked" | "uncertain";
  blockers: string[];
};

export type UserWorktreeSweepResult = {
  owner: UserWorktreeOwner;
  inspected: number;
  discarded: number;
  retained: number;
  locked: number;
  uncertain: number;
  results: UserWorktreeSweepItem[];
};

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
  status: "started" | "succeeded" | "uncertain";
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
  outcome: "succeeded" | "failed" | "uncertain";
  applied: boolean;
  audit?: UserWorktreeOperationAudit;
};

export type UserWorktreeConfirmedApplyCleanupResult = {
  worktreeId: string;
  removed: boolean;
  blockers: string[];
};

type UserWorktreeRecord = {
  version: number;
  registeredAt: string;
  owner: UserWorktreeOwner;
  worktree: ManagedWorktree;
  lifecycle?: UserWorktreeLifecycle;
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

type UserWorktreeOperationAuditRecord = UserWorktreeOperationAudit & {
  version: 1;
  receiptId: string;
  operation: UserWorktreeOperation;
  worktreeId: string;
  ownerBindingHash?: string;
};

type UserWorktreeOwnerLockRecord = {
  version: 1;
  worktreeId: string;
  owner: UserWorktreeOwner;
  token: string;
  acquiredAtMs: number;
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
  let lifecycle: UserWorktreeLifecycle | undefined;
  if (candidate.lifecycle !== undefined) {
    if (!candidate.lifecycle || typeof candidate.lifecycle !== "object" || Array.isArray(candidate.lifecycle)) return undefined;
    const storedLifecycle = candidate.lifecycle as Record<string, unknown>;
    if ((storedLifecycle.decision !== "keep" && storedLifecycle.decision !== "discard")
      || typeof storedLifecycle.decidedAtMs !== "number"
      || !Number.isSafeInteger(storedLifecycle.decidedAtMs)
      || storedLifecycle.decidedAtMs < 0
      || typeof storedLifecycle.receiptId !== "string"
      || !SAFE_ID_PATTERN.test(storedLifecycle.receiptId)) return undefined;
    lifecycle = {
      decision: storedLifecycle.decision,
      decidedAtMs: storedLifecycle.decidedAtMs,
      receiptId: storedLifecycle.receiptId,
    };
  }
  return {
    version: RECORD_VERSION,
    registeredAt: candidate.registeredAt,
    owner: { conversationId: owner.conversationId, runId: owner.runId },
    worktree: candidate.worktree,
    ...(lifecycle ? { lifecycle } : {}),
  };
}

function isUserWorktreeOperation(value: unknown): value is UserWorktreeOperation {
  return value === "keep" || value === "apply" || value === "discard" || value === "remove"
    || value === "stage" || value === "commit" || value === "branch";
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

function readOperationAudit(value: unknown): UserWorktreeOperationAuditRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1
    || typeof candidate.artifactId !== "string" || !SAFE_ID_PATTERN.test(candidate.artifactId)
    || typeof candidate.capturedAtMs !== "number" || !Number.isSafeInteger(candidate.capturedAtMs)
    || (candidate.status !== "started" && candidate.status !== "succeeded" && candidate.status !== "uncertain")
    || typeof candidate.receiptId !== "string" || !SAFE_ID_PATTERN.test(candidate.receiptId)
    || !isUserWorktreeOperation(candidate.operation)
    || typeof candidate.worktreeId !== "string" || !SAFE_ID_PATTERN.test(candidate.worktreeId)
    || (candidate.ownerBindingHash !== undefined
      && (typeof candidate.ownerBindingHash !== "string" || !/^[a-f0-9]{64}$/.test(candidate.ownerBindingHash)))
    || (candidate.commit !== undefined && typeof candidate.commit !== "string")
    || (candidate.publishedBranch !== undefined && typeof candidate.publishedBranch !== "string")) {
    return undefined;
  }
  return {
    version: 1,
    artifactId: candidate.artifactId,
    capturedAtMs: candidate.capturedAtMs,
    status: candidate.status,
    receiptId: candidate.receiptId,
    operation: candidate.operation,
    worktreeId: candidate.worktreeId,
    ...(typeof candidate.ownerBindingHash === "string" ? { ownerBindingHash: candidate.ownerBindingHash } : {}),
    ...(typeof candidate.commit === "string" ? { commit: candidate.commit } : {}),
    ...(typeof candidate.publishedBranch === "string" ? { publishedBranch: candidate.publishedBranch } : {}),
  };
}

function redactAuditOwnerBinding(audit: UserWorktreeOperationAuditRecord): UserWorktreeOperationAuditRecord {
  const { ownerBindingHash: _ownerBindingHash, ...publicAudit } = audit;
  return publicAudit;
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

function retention(lifecycle?: UserWorktreeLifecycle): UserWorktreeRetention {
  return {
    status: "retained",
    reason: lifecycle?.decision === "keep"
      ? "The exact owner explicitly kept this user_session worktree."
      : lifecycle?.decision === "discard"
        ? "The exact owner requested discard; explicit owner sweep may retry the final removal gate."
        : "user_session worktrees require an explicit user action before removal.",
    ...(lifecycle ? { decision: lifecycle.decision, decidedAtMs: lifecycle.decidedAtMs } : {}),
  };
}

function buildUserWorktreeId(owner: UserWorktreeOwner): string {
  return `user-${createHash("sha256").update(`${owner.conversationId}\0${owner.runId}`).digest("hex").slice(0, 24)}`;
}

function buildOwnerBindingHash(owner: UserWorktreeOwner): string {
  return createHash("sha256")
    .update(`user-worktree-owner\0${owner.conversationId}\0${owner.runId}`)
    .digest("hex");
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
  private readonly ownerLocksDir: string;
  private readonly managedWorktrees: ManagedWorktreeRuntime;
  private readonly changeSnapshots: WorkspaceChangeSnapshotRuntime;
  private lifecycleAuditCache?: Promise<UserWorktreeOperationAuditRecord[]>;

  constructor(stateDir: string) {
    const resolvedStateDir = path.resolve(stateDir);
    this.recordsDir = path.join(resolvedStateDir, "worktrees", "user-sessions");
    const operationStateDir = path.join(resolvedStateDir, "worktrees", "user-session-operations");
    this.operationReceiptsDir = path.join(operationStateDir, "receipts");
    this.operationEvidenceDir = path.join(operationStateDir, "evidence");
    this.operationAuditDir = path.join(operationStateDir, "audit");
    this.operationChecksDir = path.join(operationStateDir, "checks");
    this.ownerLocksDir = path.join(resolvedStateDir, "worktrees", "user-session-locks");
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
    return Promise.all((await this.listRecordIds()).map((worktreeId) => this.readStatus(worktreeId)));
  }

  /** 只读解析 exact owner 的 keep/discard 生命周期；旧 audit 缺 owner hash 时不猜测绑定。 */
  async readLifecycleEvidence(owner: UserWorktreeOwner): Promise<UserWorktreeLifecycleEvidence | undefined> {
    if (!isSafeOwnerId(owner.conversationId) || !isSafeOwnerId(owner.runId)) {
      throw new Error("User worktree lifecycle evidence requires an exact conversationId and runId owner.");
    }
    const exactRecords = (await Promise.all((await this.listRecordIds()).map((worktreeId) => this.loadRecord(worktreeId))))
      .filter((record): record is UserWorktreeRecord => record !== undefined
        && record.owner.conversationId === owner.conversationId
        && record.owner.runId === owner.runId);
    if (exactRecords.length > 1) {
      return {
        lifecycle: "uncertain",
        observedAtMs: Math.max(0, ...exactRecords.map((record) => record.lifecycle?.decidedAtMs ?? 0)),
      };
    }
    const record = exactRecords[0];
    if (record?.lifecycle?.decision === "keep") {
      return { lifecycle: "kept", observedAtMs: record.lifecycle.decidedAtMs };
    }
    if (record?.lifecycle?.decision === "discard") {
      const audit = await this.loadOperationAudit(record.lifecycle.receiptId);
      const ownerBindingHash = buildOwnerBindingHash(owner);
      if (!audit
        || audit.operation !== "discard"
        || audit.worktreeId !== record.worktree.id
        || audit.ownerBindingHash !== ownerBindingHash
        || audit.status === "succeeded") {
        return { lifecycle: "uncertain", observedAtMs: record.lifecycle.decidedAtMs };
      }
      return {
        lifecycle: "discard_pending",
        observedAtMs: Math.max(record.lifecycle.decidedAtMs, audit.capturedAtMs),
      };
    }
    if (record) return undefined;

    const ownerBindingHash = buildOwnerBindingHash(owner);
    const audits = (await this.listLifecycleAudits())
      .filter((audit) => audit.operation === "discard"
        && audit.ownerBindingHash === ownerBindingHash)
      .sort((left, right) => right.capturedAtMs - left.capturedAtMs);
    const latest = audits[0];
    if (!latest) return undefined;
    return {
      lifecycle: latest.status === "succeeded" ? "discarded" : "uncertain",
      observedAtMs: latest.capturedAtMs,
    };
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

  async sweepOwner(owner: UserWorktreeOwner): Promise<UserWorktreeSweepResult> {
    if (!isSafeOwnerId(owner.conversationId) || !isSafeOwnerId(owner.runId)) {
      throw new Error("User worktree sweep requires an exact conversationId and runId owner.");
    }
    const ownedIds: string[] = [];
    for (const worktreeId of await this.listRecordIds()) {
      const record = await this.loadRecord(worktreeId);
      if (record
        && record.owner.conversationId === owner.conversationId
        && record.owner.runId === owner.runId) {
        ownedIds.push(worktreeId);
      }
    }
    const owned = await Promise.all(ownedIds.map((worktreeId) => this.readStatus(worktreeId)));
    const results: UserWorktreeSweepItem[] = [];
    for (const status of owned) {
      const record = await this.loadRecord(status.worktreeId);
      if (!record || !hasSameOwner(status, owner)) {
        results.push({ worktreeId: status.worktreeId, outcome: "retained", blockers: ["owner_mismatch"] });
        continue;
      }
      if (record.lifecycle?.decision !== "discard") {
        results.push({
          worktreeId: status.worktreeId,
          ...(record.lifecycle ? { decision: record.lifecycle.decision } : {}),
          outcome: "retained",
          blockers: [record.lifecycle?.decision === "keep" ? "keep_requested" : "discard_not_requested"],
        });
        continue;
      }
      const releaseOwnerLock = await this.acquireOwnerLock(status.worktreeId, owner);
      if (!releaseOwnerLock) {
        results.push({
          worktreeId: status.worktreeId,
          decision: "discard",
          outcome: "locked",
          blockers: ["owner_lock_busy"],
        });
        continue;
      }
      try {
        const currentRecord = await this.loadRecord(status.worktreeId);
        const current = await this.getStatus(status.worktreeId);
        if (!currentRecord
          || currentRecord.lifecycle?.decision !== "discard"
          || currentRecord.owner.conversationId !== owner.conversationId
          || currentRecord.owner.runId !== owner.runId) {
          results.push({
            worktreeId: status.worktreeId,
            decision: "discard",
            outcome: "retained",
            blockers: ["owner_or_decision_changed"],
          });
          continue;
        }
        const receipt = await this.loadOperationReceipt(currentRecord.lifecycle.receiptId);
        const audit = await this.loadOperationAudit(currentRecord.lifecycle.receiptId);
        if (!receipt
          || receipt.operation !== "discard"
          || receipt.worktreeId !== status.worktreeId
          || !audit
          || audit.operation !== "discard"
          || audit.worktreeId !== status.worktreeId) {
          results.push({
            worktreeId: status.worktreeId,
            decision: "discard",
            outcome: "retained",
            blockers: ["discard_evidence_unavailable"],
          });
          continue;
        }
        if (current && (current.status !== "ready"
          || current.currentCommit !== current.baseCommit
          || current.dirty
          || current.extraCommitCount !== 0)) {
          results.push({
            worktreeId: status.worktreeId,
            decision: "discard",
            outcome: "retained",
            blockers: current.blockers.length > 0 ? current.blockers : ["discard_gate_failed"],
          });
          continue;
        }
        await this.removeWorktree(status.worktreeId, true);
        const completedAudit = await this.finishOperationAudit(receipt, audit, "succeeded", {});
        results.push(completedAudit
          ? { worktreeId: status.worktreeId, decision: "discard", outcome: "discarded", blockers: [] }
          : {
            worktreeId: status.worktreeId,
            decision: "discard",
            outcome: "uncertain",
            blockers: ["audit_persistence_failed"],
          });
      } catch {
        results.push({
          worktreeId: status.worktreeId,
          decision: "discard",
          outcome: "uncertain",
          blockers: ["discard_status_uncertain"],
        });
      } finally {
        await releaseOwnerLock();
      }
    }
    return {
      owner: { conversationId: owner.conversationId, runId: owner.runId },
      inspected: owned.length,
      discarded: results.filter((item) => item.outcome === "discarded").length,
      retained: results.filter((item) => item.outcome === "retained").length,
      locked: results.filter((item) => item.outcome === "locked").length,
      uncertain: results.filter((item) => item.outcome === "uncertain").length,
      results,
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
    const receipt = await this.loadOperationReceipt(input.receiptId);
    if (!receipt) {
      return this.operationFailure(input.operation, input.worktreeId, ["receipt_unavailable"]);
    }
    if (receipt.operation !== input.operation || receipt.worktreeId !== input.worktreeId) {
      return this.operationFailure(input.operation, input.worktreeId, ["receipt_mismatch"]);
    }
    let releaseOwnerLock: (() => Promise<void>) | undefined;
    if (!await this.hasOperationReceiptLock(receipt.receiptId)) {
      const record = await this.loadRecord(input.worktreeId);
      if (!record) return this.operationFailure(input.operation, input.worktreeId, ["worktree_not_found"]);
      releaseOwnerLock = await this.acquireOwnerLock(input.worktreeId, record.owner);
      if (!releaseOwnerLock) {
        return this.operationFailure(input.operation, input.worktreeId, ["owner_lock_busy"]);
      }
    }
    try {
      if (!await this.consumeOperationReceipt(input)) {
        return this.recoverConsumedOperation(input, receipt);
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
        if (!inspection.receiptBinding) return { ...inspection.preview, outcome: "failed", applied: false };
        return this.operationFailure(input.operation, input.worktreeId, ["receipt_stale"]);
      }

      const startedAudit = await this.beginOperationAudit(receipt);
      if (!startedAudit) {
        return this.operationFailure(input.operation, input.worktreeId, ["audit_unavailable"]);
      }
      try {
        let outcome: { indexTree?: string; commit?: string } = {};
        if (input.operation === "keep") {
          await this.writeLifecycleDecision(input.worktreeId, "keep", receipt.receiptId);
        } else if (input.operation === "apply") {
          await this.applyPatch(inspection.receiptBinding.targetRepoRoot, inspection.patch ?? "");
        } else if (input.operation === "discard") {
          await this.writeLifecycleDecision(input.worktreeId, "discard", receipt.receiptId);
          await this.removeWorktree(input.worktreeId, true);
        } else if (input.operation === "remove") {
          await this.removeWorktree(input.worktreeId);
        } else if (input.operation === "stage") {
          const indexTree = await this.stageWorktree(input.worktreeId, receipt);
          outcome = { indexTree };
        } else if (input.operation === "commit") {
          const commit = await this.commitWorktree(input.worktreeId, receipt);
          outcome = { commit };
        } else {
          const commit = await this.publishBranch(input.worktreeId, receipt);
          outcome = { commit };
        }
        const audit = await this.finishOperationAudit(receipt, startedAudit, "succeeded", outcome);
        if (!audit) {
          return {
            ...inspection.preview,
            canConfirm: false,
            blockers: ["audit_persistence_failed"],
            outcome: "uncertain",
            applied: true,
            audit: redactAuditOwnerBinding(startedAudit),
          };
        }
        return {
          ...inspection.preview,
          outcome: "succeeded",
          applied: true,
          audit: redactAuditOwnerBinding(audit),
        };
      } catch {
        const audit = await this.finishOperationAudit(receipt, startedAudit, "uncertain", {});
        return {
          ...inspection.preview,
          canConfirm: false,
          blockers: ["operation_status_uncertain"],
          outcome: "uncertain",
          applied: false,
          audit: redactAuditOwnerBinding(audit ?? startedAudit),
        };
      }
    } finally {
      if (releaseOwnerLock) await releaseOwnerLock();
    }
  }

  async cleanupConfirmedApply(input: {
    worktreeId: string;
    receiptId: string;
  }): Promise<UserWorktreeConfirmedApplyCleanupResult> {
    if (!SAFE_ID_PATTERN.test(input.worktreeId) || !SAFE_ID_PATTERN.test(input.receiptId)) {
      return { worktreeId: input.worktreeId, removed: false, blockers: ["invalid_operation_request"] };
    }
    const [record, receipt, audit] = await Promise.all([
      this.loadRecord(input.worktreeId),
      this.loadOperationReceipt(input.receiptId),
      this.loadOperationAudit(input.receiptId),
    ]);
    if (!record
      || !receipt
      || receipt.operation !== "apply"
      || receipt.worktreeId !== input.worktreeId
      || !audit
      || audit.operation !== "apply"
      || audit.worktreeId !== input.worktreeId
      || audit.status !== "succeeded") {
      return { worktreeId: input.worktreeId, removed: false, blockers: ["confirmed_apply_evidence_unavailable"] };
    }
    const releaseOwnerLock = await this.acquireOwnerLock(input.worktreeId, record.owner);
    if (!releaseOwnerLock) {
      return { worktreeId: input.worktreeId, removed: false, blockers: ["owner_lock_busy"] };
    }
    try {
      const current = await this.getStatus(input.worktreeId);
      if (!current
        || current.status !== "ready"
        || current.currentCommit !== current.baseCommit
        || current.dirty
        || current.extraCommitCount !== 0) {
        return {
          worktreeId: input.worktreeId,
          removed: false,
          blockers: current?.blockers.length ? [...current.blockers] : ["cleanup_gate_failed"],
        };
      }
      await this.removeWorktree(input.worktreeId, true);
      return { worktreeId: input.worktreeId, removed: true, blockers: [] };
    } catch {
      return { worktreeId: input.worktreeId, removed: false, blockers: ["cleanup_status_uncertain"] };
    } finally {
      await releaseOwnerLock();
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
    if (input.operation === "keep") {
      const currentCommit = worktree.currentCommit ?? record.worktree.baseRef;
      return {
        preview: {
          operation: "keep",
          worktreeId: input.worktreeId,
          canConfirm: true,
          blockers: [],
        },
        receiptBinding: {
          operation: "keep",
          worktreeId: input.worktreeId,
          baseCommit: record.worktree.baseRef,
          currentCommit,
          branch: record.worktree.branch,
          targetRepoRoot: record.worktree.repoRoot,
          targetHead: currentCommit,
        },
      };
    }
    if (worktree.status === "unavailable" || !worktree.currentCommit) {
      return { preview: await this.operationPreviewFailure(input.operation, input.worktreeId, ["worktree_unavailable"]) };
    }

    const blockers: string[] = [];
    if (worktree.conflictChanges && worktree.conflictChanges > 0) blockers.push("unresolved_conflicts");
    if (input.operation !== "branch" && worktree.extraCommitCount && worktree.extraCommitCount > 0) blockers.push("extra_commits");
    if (worktree.untrackedChanges && worktree.untrackedChanges > 0) blockers.push("untracked_changes");
    if ((input.operation === "remove" || input.operation === "discard") && worktree.dirty) {
      blockers.push("uncommitted_changes");
    }
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

  private async loadOperationReceipt(receiptId: string): Promise<UserWorktreeOperationReceiptRecord | undefined> {
    if (!SAFE_ID_PATTERN.test(receiptId)) return undefined;
    try {
      return readOperationReceipt(JSON.parse(await fs.readFile(this.operationReceiptPath(receiptId), "utf-8")));
    } catch {
      return undefined;
    }
  }

  private async hasOperationReceiptLock(receiptId: string): Promise<boolean> {
    try {
      await fs.access(this.operationReceiptLockPath(receiptId));
      return true;
    } catch {
      return false;
    }
  }

  private async recoverConsumedOperation(
    input: UserWorktreeOperationConfirmInput,
    receipt: UserWorktreeOperationReceiptRecord,
  ): Promise<UserWorktreeOperationResult> {
    const recovered = await this.loadOperationAudit(receipt.receiptId);
    if (recovered
      && recovered.operation === input.operation
      && recovered.worktreeId === input.worktreeId) {
      if (recovered.status === "started" && receipt.operation === "stage") {
        const indexTree = await this.reconcileStartedStageOperation(receipt);
        if (indexTree) {
          const audit = await this.finishOperationAudit(receipt, recovered, "succeeded", { indexTree });
          if (audit) {
            return {
              operation: input.operation,
              worktreeId: input.worktreeId,
              canConfirm: false,
              blockers: [],
              outcome: "succeeded",
              applied: true,
              audit: redactAuditOwnerBinding(audit),
            };
          }
          return {
            operation: input.operation,
            worktreeId: input.worktreeId,
            canConfirm: false,
            blockers: ["audit_persistence_failed"],
            outcome: "uncertain",
            applied: true,
            audit: redactAuditOwnerBinding(recovered),
          };
        }
      }
      if (recovered.status !== "succeeded") {
        return {
          operation: input.operation,
          worktreeId: input.worktreeId,
          canConfirm: false,
          blockers: ["operation_status_uncertain"],
          outcome: "uncertain",
          applied: false,
          audit: redactAuditOwnerBinding(recovered),
        };
      }
      return {
        operation: input.operation,
        worktreeId: input.worktreeId,
        canConfirm: false,
        blockers: [],
        outcome: "succeeded",
        applied: true,
        audit: redactAuditOwnerBinding(recovered),
      };
    }
    if (await this.hasOperationReceiptLock(receipt.receiptId)) {
      return {
        operation: input.operation,
        worktreeId: input.worktreeId,
        canConfirm: false,
        blockers: ["operation_status_uncertain"],
        outcome: "uncertain",
        applied: false,
      };
    }
    return this.operationFailure(input.operation, input.worktreeId, ["receipt_unavailable"]);
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

  private async reconcileStartedStageOperation(
    receipt: UserWorktreeOperationReceiptRecord,
  ): Promise<string | undefined> {
    if (receipt.operation !== "stage"
      || !receipt.patchHash
      || !/^[a-f0-9]{64}$/.test(receipt.patchHash)
      || !receipt.indexTree) {
      return undefined;
    }
    try {
      const record = await this.loadRecord(receipt.worktreeId);
      if (!record) return undefined;
      const reconciled = await this.managedWorktrees.reconcile(record.worktree);
      if (reconciled.status !== "created"
        || reconciled.baseRef !== receipt.baseCommit
        || reconciled.branch !== receipt.branch
        || path.resolve(reconciled.worktreePath) !== path.resolve(receipt.targetRepoRoot)) {
        return undefined;
      }
      const [head, branch, unstagedPaths, stagedPaths, stagedChangeModes, patch, indexTree] = await Promise.all([
        runGit(["rev-parse", "HEAD"], reconciled.worktreePath),
        runGit(["branch", "--show-current"], reconciled.worktreePath),
        runGitOutput(["diff", "--name-only", "-z", "--"], reconciled.worktreePath),
        runGitOutput(["diff", "--cached", "--name-only", "-z", receipt.baseCommit, "--"], reconciled.worktreePath),
        runGitOutput(["diff", "--cached", "--raw", "-z", "--no-renames", receipt.baseCommit, "--"], reconciled.worktreePath),
        runGitOutput(
          ["diff", "--cached", "--binary", "--no-ext-diff", receipt.baseCommit, "--"],
          reconciled.worktreePath,
          MAX_OPERATION_PATCH_BYTES,
        ),
        runGit(["write-tree"], reconciled.worktreePath),
      ]);
      if (head !== receipt.currentCommit
        || branch !== receipt.branch
        || unstagedPaths
        || !stagedPaths
        || parseUnsafeGitModes(stagedChangeModes).length > 0
        || createHash("sha256").update(patch).digest("hex") !== receipt.patchHash
        || !indexTree
        || indexTree === receipt.indexTree) {
        return undefined;
      }
      return indexTree;
    } catch {
      return undefined;
    }
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

  private async beginOperationAudit(
    receipt: UserWorktreeOperationReceiptRecord,
  ): Promise<UserWorktreeOperationAuditRecord | undefined> {
    const record = await this.loadRecord(receipt.worktreeId);
    if (!record) return undefined;
    const capturedAtMs = Date.now();
    const artifactId = `worktree-operation-${randomUUID()}`;
    const audit: UserWorktreeOperationAuditRecord = {
      version: 1,
      artifactId,
      capturedAtMs,
      status: "started",
      receiptId: receipt.receiptId,
      operation: receipt.operation,
      worktreeId: receipt.worktreeId,
      ownerBindingHash: buildOwnerBindingHash(record.owner),
    };
    try {
      await fs.mkdir(this.operationAuditDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        this.operationAuditPath(receipt.receiptId),
        `${JSON.stringify({
          ...audit,
          baseCommit: receipt.baseCommit,
          branch: receipt.branch,
          patchHash: receipt.patchHash,
          indexTree: receipt.indexTree,
          commitMessageHash: receipt.commitMessageHash,
          authorIdentityHash: receipt.authorIdentityHash,
          committerIdentityHash: receipt.committerIdentityHash,
          publishedBranch: receipt.publishedBranch,
          publishedBranchHash: receipt.publishedBranchHash,
        }, null, 2)}\n`,
        { encoding: "utf-8", mode: 0o600, flag: "wx" },
      );
      this.lifecycleAuditCache = undefined;
      return audit;
    } catch {
      return undefined;
    }
  }

  private async finishOperationAudit(
    receipt: UserWorktreeOperationReceiptRecord,
    started: UserWorktreeOperationAuditRecord,
    status: "succeeded" | "uncertain",
    outcome: { indexTree?: string; commit?: string },
  ): Promise<UserWorktreeOperationAuditRecord | undefined> {
    const completed: UserWorktreeOperationAuditRecord = {
      ...started,
      status,
      ...(outcome.commit ? { commit: outcome.commit } : {}),
      ...(receipt.publishedBranch ? { publishedBranch: receipt.publishedBranch } : {}),
    };
    const targetPath = this.operationAuditPath(receipt.receiptId);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify({
        ...completed,
        baseCommit: receipt.baseCommit,
        branch: receipt.branch,
        patchHash: receipt.patchHash,
        indexTree: outcome.indexTree ?? receipt.indexTree,
        commitMessageHash: receipt.commitMessageHash,
        authorIdentityHash: receipt.authorIdentityHash,
        committerIdentityHash: receipt.committerIdentityHash,
        publishedBranchHash: receipt.publishedBranchHash,
      }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      await fs.rename(temporaryPath, targetPath);
      await this.cleanupOperationAuditTemps(receipt.receiptId);
      this.lifecycleAuditCache = undefined;
      return completed;
    } catch {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      return undefined;
    }
  }

  private async writeLifecycleDecision(
    worktreeId: string,
    decision: UserWorktreeLifecycleDecision,
    receiptId: string,
  ): Promise<void> {
    const record = await this.loadRecord(worktreeId);
    if (!record || !SAFE_ID_PATTERN.test(receiptId)) {
      throw new Error("Managed user worktree lifecycle record is unavailable.");
    }
    const targetPath = this.recordPath(worktreeId);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify({
        ...record,
        lifecycle: {
          decision,
          decidedAtMs: Date.now(),
          receiptId,
        },
      }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      await fs.rename(temporaryPath, targetPath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  private async acquireOwnerLock(
    worktreeId: string,
    owner: UserWorktreeOwner,
  ): Promise<(() => Promise<void>) | undefined> {
    if (!SAFE_ID_PATTERN.test(worktreeId)
      || !isSafeOwnerId(owner.conversationId)
      || !isSafeOwnerId(owner.runId)) return undefined;
    const token = randomUUID();
    const lock: UserWorktreeOwnerLockRecord = {
      version: 1,
      worktreeId,
      owner: { conversationId: owner.conversationId, runId: owner.runId },
      token,
      acquiredAtMs: Date.now(),
    };
    const lockPath = this.ownerLockPath(worktreeId);
    try {
      await fs.mkdir(this.ownerLocksDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
    } catch {
      return undefined;
    }
    return async () => {
      try {
        const current = JSON.parse(await fs.readFile(lockPath, "utf-8")) as Partial<UserWorktreeOwnerLockRecord>;
        if (current.version === 1
          && current.worktreeId === worktreeId
          && current.token === token
          && current.owner?.conversationId === owner.conversationId
          && current.owner?.runId === owner.runId) {
          await fs.rm(lockPath, { force: true });
        }
      } catch {
        // A missing or replaced lock is not owned by this release callback.
      }
    };
  }

  private async removeWorktree(worktreeId: string, forgetRecord = false): Promise<void> {
    const record = await this.loadRecord(worktreeId);
    if (!record) throw new Error("Managed user worktree record is unavailable.");
    const reconciled = await this.managedWorktrees.reconcile(record.worktree);
    if (reconciled.status === "missing") {
      const branch = await runGit(["branch", "--list", record.worktree.branch], record.worktree.repoRoot);
      if (branch) throw new Error("Managed user worktree is missing while its branch still exists.");
      if (forgetRecord) await fs.rm(this.recordPath(worktreeId), { force: true });
      return;
    }
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
    if (forgetRecord) await fs.rm(this.recordPath(worktreeId));
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
    return { ...await this.operationPreviewFailure(operation, worktreeId, blockers), outcome: "failed", applied: false };
  }

  private async loadOperationAudit(receiptId: string): Promise<UserWorktreeOperationAuditRecord | undefined> {
    try {
      return readOperationAudit(JSON.parse(await fs.readFile(this.operationAuditPath(receiptId), "utf-8")));
    } catch {
      return undefined;
    }
  }

  private async listLifecycleAudits(): Promise<UserWorktreeOperationAuditRecord[]> {
    this.lifecycleAuditCache ??= (async () => {
      const entries = await fs.readdir(this.operationAuditDir, { withFileTypes: true }).catch((error) => {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
        throw error;
      });
      const audits: UserWorktreeOperationAuditRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const audit = readOperationAudit(JSON.parse(await fs.readFile(path.join(this.operationAuditDir, entry.name), "utf-8")));
          if (audit) audits.push(audit);
        } catch {
          // Invalid or concurrently replaced audit files do not establish lifecycle evidence.
        }
      }
      return audits;
    })();
    return this.lifecycleAuditCache;
  }

  private async cleanupOperationAuditTemps(receiptId: string): Promise<void> {
    if (!SAFE_ID_PATTERN.test(receiptId)) return;
    const prefix = `${receiptId}.json.`;
    const entries = await fs.readdir(this.operationAuditDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".tmp"))
      .map((entry) => fs.rm(path.join(this.operationAuditDir, entry.name), { force: true }).catch(() => {})));
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

  private async listRecordIds(): Promise<string[]> {
    try {
      return (await fs.readdir(this.recordsDir))
        .filter((entry) => entry.endsWith(".json") && SAFE_ID_PATTERN.test(entry.slice(0, -5)))
        .map((entry) => entry.slice(0, -5))
        .sort();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
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

  private operationAuditPath(receiptId: string): string {
    if (!SAFE_ID_PATTERN.test(receiptId)) throw new Error("User worktree operation receipt id is invalid.");
    return path.join(this.operationAuditDir, `${receiptId}.json`);
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
      retention: retention(record.lifecycle),
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

  private ownerLockPath(worktreeId: string): string {
    if (!SAFE_ID_PATTERN.test(worktreeId)) throw new Error("User worktree owner lock id is invalid.");
    return path.join(this.ownerLocksDir, `${worktreeId}.lock`);
  }
}
