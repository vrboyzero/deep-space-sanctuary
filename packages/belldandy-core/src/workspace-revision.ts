import crypto from "node:crypto";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";

import type {
  WorkspaceMutationObserver,
  WorkspaceMutationOperation,
  WorkspaceMutationTarget,
} from "@belldandy/skills";

const MANIFEST_VERSION = 1;
const RESTORE_RECEIPT_VERSION = 1;
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REVISION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OPERATION_ID_PATTERN = /^op_[a-f0-9]{64}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

type FileState =
  | { exists: false }
  | { exists: true; sha256: string; size: number; mode: number };

type BeforeFileState = FileState & { blobPath?: string };

type RevisionFileEntry = {
  relativePath: string;
  before: BeforeFileState;
  after?: FileState;
  toolNames: string[];
  preparedAtMs: number;
  committedAtMs?: number;
};

type RevisionOperationTarget = {
  relativePath: string;
  before: FileState;
  after?: FileState;
};

type RevisionOperationEntry = {
  operationId: string;
  toolName: string;
  targets: RevisionOperationTarget[];
  preparedAtMs: number;
  committedAtMs?: number;
};

type RevisionManifest = {
  version: typeof MANIFEST_VERSION;
  revisionId: string;
  workspaceId: string;
  workspaceRoot: string;
  createdAtMs: number;
  updatedAtMs: number;
  files: RevisionFileEntry[];
  operations: RevisionOperationEntry[];
};

export type WorkspaceRevisionSummary = {
  revisionId: string;
  workspaceId: string;
  workspaceRoot: string;
  createdAtMs: number;
  updatedAtMs: number;
  changedFileCount: number;
  recoveryGuarantee: "exact";
};

export type WorkspaceRevisionChangeCoverage = WorkspaceRevisionSummary & {
  changedPaths: string[];
};

export type WorkspaceRevisionRestoreChange = {
  relativePath: string;
  action: "restore" | "delete" | "unchanged" | "conflict";
  reason?: string;
  recordedAfterHash?: string;
  currentHash?: string;
};

export type WorkspaceRevisionRestoreConflictArtifact = {
  artifactPath: string;
  capturedAtMs: number;
  conflictCount: number;
};

export type WorkspaceRevisionRestorePreview = WorkspaceRevisionSummary & {
  canRestore: boolean;
  changes: WorkspaceRevisionRestoreChange[];
  conflictArtifact?: WorkspaceRevisionRestoreConflictArtifact;
};

export type WorkspaceRevisionRestoreResult = WorkspaceRevisionRestorePreview & {
  applied: boolean;
  receipt?: WorkspaceRevisionRestoreReceipt;
};

export type WorkspaceRevisionRestoreReceipt = {
  version: typeof RESTORE_RECEIPT_VERSION;
  receiptId: string;
  revisionId: string;
  workspaceId: string;
  restoredAtMs: number;
};

export type WorkspaceRevisionRuntimeOptions = {
  stateDir: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  retentionMs?: number;
};

export type WorkspaceMutationOperationEvidence = {
  operationId: string;
  state: "prepared" | "committed" | "missing" | "conflict";
  workspaceCount: number;
  targetCount: number;
  committedTargetCount: number;
};

type RevisionMutationInput = {
  revisionId?: string;
  workspaceRevisionId?: string;
  workspaceRoot: string;
  toolName: string;
  targets: readonly WorkspaceMutationTarget[];
  operation?: WorkspaceMutationOperation;
};

type LoadedManifest = {
  manifest: RevisionManifest;
  directory: string;
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeRevisionId(input: RevisionMutationInput | { revisionId: string }): string {
  const value = "workspaceRevisionId" in input && typeof input.workspaceRevisionId === "string"
    ? input.workspaceRevisionId
    : input.revisionId;
  if (typeof value !== "string" || !REVISION_ID_PATTERN.test(value)) {
    throw new Error("Workspace revision id is invalid.");
  }
  return value;
}

function toCanonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function calculateDirectoryBytes(directory: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await calculateDirectoryBytes(entryPath);
    } else if (entry.isFile()) {
      total += (await fs.stat(entryPath)).size;
    }
  }
  return total;
}

async function writeFileAtomic(filePath: string, contents: string | Buffer, mode: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, contents, { mode });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function isFileStateEqual(left: FileState, right: FileState): boolean {
  if (left.exists !== right.exists) return false;
  return !left.exists || left.sha256 === (right as Extract<FileState, { exists: true }>).sha256;
}

function getStateHash(state: FileState | undefined): string | undefined {
  return state?.exists ? state.sha256 : undefined;
}

function toOperationFileState(state: BeforeFileState): FileState {
  return state.exists
    ? { exists: true, sha256: state.sha256, size: state.size, mode: state.mode }
    : { exists: false };
}

function createWorkspaceOperationId(operation: WorkspaceMutationOperation, revisionId: string): string {
  const conversationId = operation.conversationId?.trim();
  const agentRunId = operation.agentRunId?.trim();
  const toolCallId = operation.toolCallId?.trim();
  if (!conversationId || !agentRunId || !toolCallId || agentRunId !== revisionId) {
    throw new Error("Workspace mutation operation binding is invalid.");
  }
  return `op_${crypto.createHash("sha256")
    .update(`conversation\0${conversationId}\0${agentRunId}\0${toolCallId}`)
    .digest("hex")}`;
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFileState(value: unknown): value is FileState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.exists === false) return Object.keys(candidate).length === 1;
  return candidate.exists === true
    && typeof candidate.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(candidate.sha256)
    && typeof candidate.size === "number"
    && Number.isSafeInteger(candidate.size)
    && candidate.size >= 0
    && typeof candidate.mode === "number"
    && Number.isSafeInteger(candidate.mode)
    && candidate.mode >= 0
    && Object.keys(candidate).length === 4;
}

function parseOperationEntry(value: unknown): RevisionOperationEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<RevisionOperationEntry>;
  if (!OPERATION_ID_PATTERN.test(String(candidate.operationId))
    || !TOOL_NAME_PATTERN.test(String(candidate.toolName))
    || !Array.isArray(candidate.targets)
    || candidate.targets.length === 0
    || !isSafeTimestamp(candidate.preparedAtMs)
    || (candidate.committedAtMs !== undefined && !isSafeTimestamp(candidate.committedAtMs))) {
    return undefined;
  }
  const targets: RevisionOperationTarget[] = [];
  for (const valueTarget of candidate.targets) {
    if (!valueTarget || typeof valueTarget !== "object" || Array.isArray(valueTarget)) return undefined;
    const target = valueTarget as Partial<RevisionOperationTarget>;
    if (typeof target.relativePath !== "string"
      || !target.relativePath
      || path.isAbsolute(target.relativePath)
      || target.relativePath.startsWith("../")
      || !isFileState(target.before)
      || (target.after !== undefined && !isFileState(target.after))) {
      return undefined;
    }
    const expectedKeys = target.after === undefined
      ? ["relativePath", "before"]
      : ["relativePath", "before", "after"];
    if (Object.keys(target).length !== expectedKeys.length
      || !expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(target, key))) {
      return undefined;
    }
    targets.push(target as RevisionOperationTarget);
  }
  const allCommitted = targets.every((target) => target.after !== undefined);
  if (allCommitted !== (candidate.committedAtMs !== undefined)) return undefined;
  const expectedKeys = candidate.committedAtMs === undefined
    ? ["operationId", "toolName", "targets", "preparedAtMs"]
    : ["operationId", "toolName", "targets", "preparedAtMs", "committedAtMs"];
  if (Object.keys(candidate).length !== expectedKeys.length
    || !expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(candidate, key))) {
    return undefined;
  }
  return { ...candidate, targets } as RevisionOperationEntry;
}

function toSummary(manifest: RevisionManifest): WorkspaceRevisionSummary {
  return {
    revisionId: manifest.revisionId,
    workspaceId: manifest.workspaceId,
    workspaceRoot: manifest.workspaceRoot,
    createdAtMs: manifest.createdAtMs,
    updatedAtMs: manifest.updatedAtMs,
    changedFileCount: manifest.files.filter((entry) => entry.after !== undefined).length,
    recoveryGuarantee: "exact",
  };
}

function parseManifest(value: unknown): RevisionManifest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<RevisionManifest>;
  if (
    candidate.version !== MANIFEST_VERSION
    || typeof candidate.revisionId !== "string"
    || !REVISION_ID_PATTERN.test(candidate.revisionId)
    || typeof candidate.workspaceId !== "string"
    || typeof candidate.workspaceRoot !== "string"
    || typeof candidate.createdAtMs !== "number"
    || typeof candidate.updatedAtMs !== "number"
    || !Array.isArray(candidate.files)
    || (candidate.operations !== undefined && !Array.isArray(candidate.operations))
  ) {
    return undefined;
  }
  return {
    ...(candidate as Omit<RevisionManifest, "operations">),
    operations: Array.isArray(candidate.operations) ? candidate.operations : [],
  };
}

function parseRestoreReceipt(value: unknown): WorkspaceRevisionRestoreReceipt | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<WorkspaceRevisionRestoreReceipt>;
  if (
    candidate.version !== RESTORE_RECEIPT_VERSION
    || typeof candidate.receiptId !== "string"
    || !REVISION_ID_PATTERN.test(candidate.receiptId)
    || typeof candidate.revisionId !== "string"
    || !REVISION_ID_PATTERN.test(candidate.revisionId)
    || typeof candidate.workspaceId !== "string"
    || !/^[a-f0-9]{64}$/.test(candidate.workspaceId)
    || typeof candidate.restoredAtMs !== "number"
    || !Number.isSafeInteger(candidate.restoredAtMs)
    || candidate.restoredAtMs < 0
  ) {
    return undefined;
  }
  return candidate as WorkspaceRevisionRestoreReceipt;
}

/**
 * 受控文件工具的首次修改前快照。它不观察 shell、MCP 或用户手工写入，恢复前必须
 * 验证当前内容仍是工具最后记录的结果，避免覆盖后续修改。
 */
export class WorkspaceRevisionRuntime implements WorkspaceMutationObserver {
  private readonly storageRoot: string;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly retentionMs: number;

  constructor(options: WorkspaceRevisionRuntimeOptions) {
    this.storageRoot = path.resolve(options.stateDir, "workspace-revisions");
    this.maxFileBytes = normalizePositiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
    this.maxTotalBytes = normalizePositiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES);
    this.retentionMs = normalizePositiveInteger(options.retentionMs, DEFAULT_RETENTION_MS);
  }

  async prepareMutations(input: RevisionMutationInput): Promise<void> {
    const revisionId = normalizeRevisionId(input);
    const normalizedTargets = await this.normalizeTargets(input.workspaceRoot, input.targets);
    if (normalizedTargets.length === 0) return;

    const loaded = await this.loadOrCreateManifest(revisionId, input.workspaceRoot);
    const operationId = input.operation
      ? createWorkspaceOperationId(input.operation, revisionId)
      : undefined;
    if (operationId) {
      const existingOperations = loaded.manifest.operations.filter((entry) => entry.operationId === operationId);
      if (existingOperations.length > 1
        || (existingOperations.length === 1
          && !this.matchesPreparedOperation(existingOperations[0]!, input.toolName, normalizedTargets))) {
        throw new Error("Workspace mutation operation binding conflicts with its prepared targets.");
      }
      if (existingOperations.length === 1) {
        throw new Error("Workspace mutation operation is already prepared; automatic replay is forbidden.");
      }
    }

    const existingPaths = new Set(loaded.manifest.files.map((entry) => entry.relativePath));
    const capturedByPath = new Map<string, { state: BeforeFileState; content?: Buffer }>();
    const pending = [] as Array<{ target: WorkspaceMutationTarget; state: BeforeFileState; content?: Buffer }>;
    for (const target of normalizedTargets) {
      if (existingPaths.has(target.relativePath)) {
        if (operationId) {
          capturedByPath.set(target.relativePath, { state: await this.readFileState(target.absolutePath) });
        }
        continue;
      }
      const captured = await this.captureBeforeState(target.absolutePath);
      capturedByPath.set(target.relativePath, captured);
      pending.push({ target, ...captured });
    }

    const additionalBytes = pending.reduce((sum, entry) => sum + (entry.content?.length ?? 0), 0);
    const usage = await calculateDirectoryBytes(this.storageRoot);
    if (usage + additionalBytes > this.maxTotalBytes) {
      throw new Error("Workspace revision checkpoint storage capacity exceeded.");
    }

    for (const entry of pending) {
      const blobPath = entry.content
        ? path.posix.join("preimages", `${hashText(entry.target.relativePath)}.bin`)
        : undefined;
      if (entry.content && blobPath) {
        await writeFileAtomic(path.join(loaded.directory, ...blobPath.split("/")), entry.content, 0o600);
      }
      loaded.manifest.files.push({
        relativePath: entry.target.relativePath,
        before: entry.state.exists ? { ...entry.state, blobPath } : entry.state,
        toolNames: [input.toolName],
        preparedAtMs: Date.now(),
      });
    }
    const now = Date.now();
    if (operationId) {
      loaded.manifest.operations.push({
        operationId,
        toolName: input.toolName,
        targets: normalizedTargets.map((target) => ({
          relativePath: target.relativePath,
          before: toOperationFileState(capturedByPath.get(target.relativePath)!.state),
        })),
        preparedAtMs: now,
      });
    }
    if (pending.length === 0 && !operationId) return;
    loaded.manifest.updatedAtMs = now;
    await this.saveManifest(loaded);
  }

  async commitMutations(input: RevisionMutationInput): Promise<void> {
    const revisionId = normalizeRevisionId(input);
    const normalizedTargets = await this.normalizeTargets(input.workspaceRoot, input.targets);
    if (normalizedTargets.length === 0) return;
    const loaded = await this.loadManifestForWorkspace(revisionId, input.workspaceRoot);
    const byPath = new Map(loaded.manifest.files.map((entry) => [entry.relativePath, entry]));
    const operationId = input.operation
      ? createWorkspaceOperationId(input.operation, revisionId)
      : undefined;
    const matchingOperations = operationId
      ? loaded.manifest.operations.filter((entry) => entry.operationId === operationId)
      : [];
    const operation = matchingOperations.length === 1 ? matchingOperations[0] : undefined;
    if (operationId && (!operation || operation.toolName !== input.toolName)) {
      throw new Error("Workspace mutation operation is missing or conflicts with its prepared binding.");
    }
    const operationTargets = operation
      ? new Map(operation.targets.map((target) => [target.relativePath, target]))
      : undefined;
    if (operationTargets && normalizedTargets.some((target) => !operationTargets.has(target.relativePath))) {
      throw new Error("Workspace mutation commit contains an unprepared operation target.");
    }
    const committedAtMs = Date.now();
    for (const target of normalizedTargets) {
      const entry = byPath.get(target.relativePath);
      if (!entry) {
        throw new Error(`Workspace revision checkpoint is missing prepared path: ${target.relativePath}`);
      }
      const after = await this.readFileState(target.absolutePath);
      entry.after = after;
      if (!entry.toolNames.includes(input.toolName)) entry.toolNames.push(input.toolName);
      entry.committedAtMs = committedAtMs;
      const operationTarget = operationTargets?.get(target.relativePath);
      if (operationTarget) operationTarget.after = after;
    }
    if (operation) {
      if (operation.targets.every((target) => target.after !== undefined)) {
        operation.committedAtMs ??= committedAtMs;
      } else {
        delete operation.committedAtMs;
      }
    }
    loaded.manifest.updatedAtMs = committedAtMs;
    await this.saveManifest(loaded);
  }

  async getOperationEvidence(input: {
    revisionId: string;
    operationId: string;
  }): Promise<WorkspaceMutationOperationEvidence> {
    const revisionId = normalizeRevisionId(input);
    if (!OPERATION_ID_PATTERN.test(input.operationId)) {
      throw new Error("Workspace mutation operation id is invalid.");
    }
    const { manifests, invalid } = await this.loadManifestsForEvidence(revisionId);
    const matching: RevisionOperationEntry[] = [];
    let conflict = invalid;
    for (const manifest of manifests) {
      const entries = manifest.operations.filter((entry) => entry.operationId === input.operationId);
      if (entries.length > 1) conflict = true;
      matching.push(...entries);
    }
    if (matching.length === 0) {
      return {
        operationId: input.operationId,
        state: conflict ? "conflict" : "missing",
        workspaceCount: 0,
        targetCount: 0,
        committedTargetCount: 0,
      };
    }

    const parsed = matching.map(parseOperationEntry);
    if (parsed.some((entry) => !entry)) conflict = true;
    const valid = parsed.filter((entry): entry is RevisionOperationEntry => Boolean(entry));
    if (new Set(valid.map((entry) => entry.toolName)).size !== 1) conflict = true;
    let targetCount = 0;
    let committedTargetCount = 0;
    for (const entry of valid) {
      const relativePaths = entry.targets.map((target) => target.relativePath);
      if (new Set(relativePaths).size !== relativePaths.length) conflict = true;
      targetCount += entry.targets.length;
      committedTargetCount += entry.targets.filter((target) => target.after !== undefined).length;
    }
    if (valid.length !== matching.length || targetCount === 0) conflict = true;
    return {
      operationId: input.operationId,
      state: conflict
        ? "conflict"
        : committedTargetCount === targetCount
          ? "committed"
          : "prepared",
      workspaceCount: valid.length,
      targetCount,
      committedTargetCount,
    };
  }

  async list(): Promise<WorkspaceRevisionSummary[]> {
    const manifests = await this.loadAllManifests();
    return manifests
      .map(({ manifest }) => toSummary(manifest))
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.revisionId.localeCompare(right.revisionId));
  }

  async getChangeCoverage(input: { revisionId: string; workspaceRoot: string }): Promise<WorkspaceRevisionChangeCoverage> {
    const revisionId = normalizeRevisionId(input);
    const loaded = await this.loadManifestForWorkspace(revisionId, input.workspaceRoot);
    return {
      ...toSummary(loaded.manifest),
      changedPaths: [...new Set(loaded.manifest.files
        .filter((entry) => entry.after !== undefined)
        .map((entry) => entry.relativePath))]
        .sort((left, right) => left.localeCompare(right)),
    };
  }

  async readRestoreReceipt(input: {
    receiptId: string;
    revisionId: string;
    workspaceRoot: string;
  }): Promise<WorkspaceRevisionRestoreReceipt> {
    if (!REVISION_ID_PATTERN.test(input.receiptId)) throw new Error("Workspace revision restore receipt id is invalid.");
    const revisionId = normalizeRevisionId(input);
    const loaded = await this.loadManifestForWorkspace(revisionId, input.workspaceRoot);
    const receiptPath = path.join(loaded.directory, "restore-receipts", `${input.receiptId}.json`);
    let parsed: WorkspaceRevisionRestoreReceipt | undefined;
    try {
      parsed = parseRestoreReceipt(JSON.parse(await fs.readFile(receiptPath, "utf-8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Workspace revision restore receipt was not found.");
      }
      throw new Error("Workspace revision restore receipt is invalid.");
    }
    if (
      !parsed
      || parsed.receiptId !== input.receiptId
      || parsed.revisionId !== loaded.manifest.revisionId
      || parsed.workspaceId !== loaded.manifest.workspaceId
    ) {
      throw new Error("Workspace revision restore receipt is invalid.");
    }
    return parsed;
  }

  async previewRestore(input: { revisionId: string; workspaceId?: string }): Promise<WorkspaceRevisionRestorePreview> {
    const loaded = await this.findManifest(input);
    const changes: WorkspaceRevisionRestoreChange[] = [];
    for (const entry of loaded.manifest.files) {
      if (!entry.after) continue;
      const targetPath = path.resolve(loaded.manifest.workspaceRoot, entry.relativePath);
      try {
        await this.assertTargetPath(loaded.manifest.workspaceRoot, targetPath);
        const current = await this.readFileState(targetPath);
        if (isFileStateEqual(current, entry.after)) {
          changes.push({
            relativePath: entry.relativePath,
            action: entry.before.exists ? "restore" : "delete",
          });
        } else if (isFileStateEqual(current, entry.before)) {
          changes.push({ relativePath: entry.relativePath, action: "unchanged" });
        } else {
          const recordedAfterHash = getStateHash(entry.after);
          const currentHash = getStateHash(current);
          changes.push({
            relativePath: entry.relativePath,
            action: "conflict",
            reason: "current file hash differs from the recorded tool result",
            ...(recordedAfterHash ? { recordedAfterHash } : {}),
            ...(currentHash ? { currentHash } : {}),
          });
        }
      } catch (error) {
        changes.push({
          relativePath: entry.relativePath,
          action: "conflict",
          reason: "unable to verify the current file state safely",
        });
      }
    }
    const conflicts = changes.filter((change) => change.action === "conflict");
    const conflictArtifact = conflicts.length > 0
      ? await this.writeRestoreConflictArtifact(loaded, conflicts)
      : undefined;
    return {
      ...toSummary(loaded.manifest),
      canRestore: changes.every((change) => change.action !== "conflict"),
      changes,
      ...(conflictArtifact ? { conflictArtifact } : {}),
    };
  }

  async restore(input: { revisionId: string; workspaceId?: string; apply?: boolean }): Promise<WorkspaceRevisionRestoreResult> {
    const preview = await this.previewRestore(input);
    if (input.apply !== true || !preview.canRestore) {
      return { ...preview, applied: false };
    }
    const loaded = await this.findManifest(input);
    const finalPreview = await this.previewRestore(input);
    if (!finalPreview.canRestore) return { ...finalPreview, applied: false };
    const changesByPath = new Map(finalPreview.changes.map((change) => [change.relativePath, change]));
    const entries = loaded.manifest.files.filter((entry) => {
      const action = changesByPath.get(entry.relativePath)?.action;
      return action === "restore" || action === "delete";
    });

    // 先读取并校验所有备份，随后把每个目标的状态检查尽量贴近实际写入。
    const restoreContents = new Map<string, Buffer>();
    for (const entry of entries) {
      const targetPath = path.resolve(loaded.manifest.workspaceRoot, entry.relativePath);
      await this.assertTargetPath(loaded.manifest.workspaceRoot, targetPath);
      if (entry.before.exists) {
        if (!entry.before.blobPath) throw new Error(`Workspace revision preimage is missing: ${entry.relativePath}`);
        const blobPath = this.resolveBlobPath(loaded.directory, entry.before.blobPath);
        if (!await pathExists(blobPath)) throw new Error(`Workspace revision preimage is unavailable: ${entry.relativePath}`);
        const contents = await fs.readFile(blobPath);
        if (hashBuffer(contents) !== entry.before.sha256) {
          throw new Error(`Workspace revision preimage integrity check failed: ${entry.relativePath}`);
        }
        restoreContents.set(entry.relativePath, contents);
      }
    }

    // 外部进程仍可能在 final gate 后修改文件；每次写入前复核当前目标，避免覆盖已观察到的用户修改。
    for (const entry of entries) {
      const targetPath = path.resolve(loaded.manifest.workspaceRoot, entry.relativePath);
      let current: FileState;
      try {
        await this.assertTargetPath(loaded.manifest.workspaceRoot, targetPath);
        current = await this.readFileState(targetPath);
      } catch {
        return this.stopRestoreAfterFinalGate({
          loaded,
          preview: finalPreview,
          entry,
          reason: "unable to verify the current file state safely before restore write",
        });
      }
      if (isFileStateEqual(current, entry.before)) continue;
      if (!entry.after || !isFileStateEqual(current, entry.after)) {
        return this.stopRestoreAfterFinalGate({ loaded, preview: finalPreview, entry, current });
      }
      if (!entry.before.exists) {
        await fs.unlink(targetPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        continue;
      }
      const contents = restoreContents.get(entry.relativePath);
      if (!contents) throw new Error(`Workspace revision preimage is unavailable: ${entry.relativePath}`);
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      await writeFileAtomic(targetPath, contents, entry.before.mode);
      await fs.chmod(targetPath, entry.before.mode).catch(() => {});
    }
    const receipt = await this.writeRestoreReceipt(loaded);
    return { ...finalPreview, applied: true, receipt };
  }

  /** 仅删除已超过保留期的整组恢复点；不会作为 prepare/restore 的隐式副作用执行。 */
  async pruneExpired(now = Date.now()): Promise<number> {
    const manifests = await this.loadAllManifests();
    let removed = 0;
    for (const loaded of manifests) {
      if (loaded.manifest.updatedAtMs > now - this.retentionMs) continue;
      await fs.rm(loaded.directory, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  private matchesPreparedOperation(
    operation: RevisionOperationEntry,
    toolName: string,
    targets: readonly WorkspaceMutationTarget[],
  ): boolean {
    if (operation.toolName !== toolName || !parseOperationEntry(operation)) return false;
    const expected = operation.targets.map((target) => target.relativePath).sort((left, right) => left.localeCompare(right));
    const actual = targets.map((target) => target.relativePath).sort((left, right) => left.localeCompare(right));
    return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
  }

  private async loadManifestsForEvidence(revisionId: string): Promise<{
    manifests: RevisionManifest[];
    invalid: boolean;
  }> {
    const workspaceEntries = await fs.readdir(this.storageRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const manifests: RevisionManifest[] = [];
    let invalid = false;
    for (const workspaceEntry of workspaceEntries) {
      if (!workspaceEntry.isDirectory()) continue;
      const revisionDirectory = path.join(this.storageRoot, workspaceEntry.name, revisionId);
      const revisionStat = await fs.stat(revisionDirectory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!revisionStat) continue;
      if (!revisionStat.isDirectory()) {
        invalid = true;
        continue;
      }
      const raw = await fs.readFile(path.join(revisionDirectory, "manifest.json"), "utf-8");
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        invalid = true;
        continue;
      }
      const manifest = parseManifest(decoded);
      if (!manifest
        || manifest.revisionId !== revisionId
        || manifest.workspaceId !== workspaceEntry.name
        || manifest.operations.some((operation) => !parseOperationEntry(operation))) {
        invalid = true;
        continue;
      }
      manifests.push(manifest);
    }
    return { manifests, invalid };
  }

  private async captureBeforeState(filePath: string): Promise<{ state: BeforeFileState; content?: Buffer }> {
    const stat = await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) return { state: { exists: false } };
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Workspace revision only supports regular files.");
    }
    if (stat.size > this.maxFileBytes) {
      throw new Error(`Workspace revision preimage is too large (>${this.maxFileBytes} bytes).`);
    }
    const content = await fs.readFile(filePath);
    return {
      state: {
        exists: true,
        sha256: hashBuffer(content),
        size: stat.size,
        mode: stat.mode & 0o777,
      },
      content,
    };
  }

  private async readFileState(filePath: string): Promise<FileState> {
    const stat = await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) return { exists: false };
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Workspace revision only supports regular files.");
    }
    return {
      exists: true,
      sha256: await hashFile(filePath),
      size: stat.size,
      mode: stat.mode & 0o777,
    };
  }

  private async normalizeTargets(workspaceRoot: string, targets: readonly WorkspaceMutationTarget[]): Promise<WorkspaceMutationTarget[]> {
    const resolvedRoot = path.resolve(workspaceRoot);
    const deduplicated = new Map<string, WorkspaceMutationTarget>();
    for (const target of targets) {
      if (!target || typeof target.absolutePath !== "string" || typeof target.relativePath !== "string") {
        throw new Error("Workspace revision mutation target is invalid.");
      }
      const absolutePath = path.resolve(target.absolutePath);
      await this.assertTargetPath(resolvedRoot, absolutePath);
      const relativePath = path.relative(resolvedRoot, absolutePath).replace(/\\/g, "/");
      if (!relativePath || relativePath !== target.relativePath.replace(/\\/g, "/")) {
        throw new Error("Workspace revision mutation target is not canonical.");
      }
      deduplicated.set(relativePath, { absolutePath, relativePath });
    }
    return [...deduplicated.values()];
  }

  private async assertTargetPath(workspaceRoot: string, targetPath: string): Promise<void> {
    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedTarget = path.resolve(targetPath);
    if (!isPathInside(resolvedRoot, resolvedTarget)) {
      throw new Error("Workspace revision target escapes the workspace root.");
    }
    const canonicalStorageRoot = toCanonicalPath(this.storageRoot);
    const canonicalTarget = toCanonicalPath(resolvedTarget);
    if (canonicalTarget === canonicalStorageRoot || isPathInside(canonicalStorageRoot, canonicalTarget)) {
      throw new Error("Workspace revision cannot modify checkpoint storage.");
    }
    const rootStat = await fs.lstat(resolvedRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error("Workspace revision root does not exist.");
      throw error;
    });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Workspace revision root must be a real directory.");
    }
    let current = resolvedRoot;
    const relative = path.relative(resolvedRoot, resolvedTarget);
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!stat) break;
      if (stat.isSymbolicLink()) throw new Error("Workspace revision does not follow symbolic links.");
      if (current !== resolvedTarget && !stat.isDirectory()) {
        throw new Error("Workspace revision target has a non-directory parent.");
      }
    }
  }

  private async loadOrCreateManifest(revisionId: string, workspaceRoot: string): Promise<LoadedManifest> {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const workspaceId = hashText(toCanonicalPath(resolvedWorkspaceRoot));
    const directory = path.join(this.storageRoot, workspaceId, revisionId);
    const manifestPath = path.join(directory, "manifest.json");
    if (await pathExists(manifestPath)) {
      const loaded = await this.loadManifestAt(directory);
      if (loaded.manifest.workspaceRoot !== resolvedWorkspaceRoot) {
        throw new Error("Workspace revision id is already bound to another workspace.");
      }
      return loaded;
    }
    const manifest: RevisionManifest = {
      version: MANIFEST_VERSION,
      revisionId,
      workspaceId,
      workspaceRoot: resolvedWorkspaceRoot,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      files: [],
      operations: [],
    };
    const loaded = { manifest, directory };
    await this.saveManifest(loaded);
    return loaded;
  }

  private async writeRestoreConflictArtifact(
    loaded: LoadedManifest,
    conflicts: WorkspaceRevisionRestoreChange[],
  ): Promise<WorkspaceRevisionRestoreConflictArtifact> {
    const capturedAtMs = Date.now();
    const artifactPath = path.join(
      loaded.directory,
      "restore-conflicts",
      `${capturedAtMs}-${crypto.randomUUID()}.json`,
    );
    await writeFileAtomic(artifactPath, `${JSON.stringify({
      version: 1,
      revisionId: loaded.manifest.revisionId,
      workspaceId: loaded.manifest.workspaceId,
      capturedAtMs,
      conflicts,
    }, null, 2)}\n`, 0o600);
    return { artifactPath, capturedAtMs, conflictCount: conflicts.length };
  }

  private async stopRestoreAfterFinalGate(input: {
    loaded: LoadedManifest;
    preview: WorkspaceRevisionRestorePreview;
    entry: RevisionFileEntry;
    current?: FileState;
    reason?: string;
  }): Promise<WorkspaceRevisionRestoreResult> {
    const conflict: WorkspaceRevisionRestoreChange = {
      relativePath: input.entry.relativePath,
      action: "conflict",
      reason: input.reason ?? "current file hash differs from the recorded tool result",
      ...(getStateHash(input.entry.after) ? { recordedAfterHash: getStateHash(input.entry.after) } : {}),
      ...(getStateHash(input.current) ? { currentHash: getStateHash(input.current) } : {}),
    };
    const conflictArtifact = await this.writeRestoreConflictArtifact(input.loaded, [conflict]);
    return {
      ...input.preview,
      canRestore: false,
      changes: input.preview.changes.map((change) => (
        change.relativePath === input.entry.relativePath ? conflict : change
      )),
      conflictArtifact,
      applied: false,
    };
  }

  private async writeRestoreReceipt(loaded: LoadedManifest): Promise<WorkspaceRevisionRestoreReceipt> {
    const receipt: WorkspaceRevisionRestoreReceipt = {
      version: RESTORE_RECEIPT_VERSION,
      receiptId: `restore-${crypto.randomUUID()}`,
      revisionId: loaded.manifest.revisionId,
      workspaceId: loaded.manifest.workspaceId,
      restoredAtMs: Date.now(),
    };
    await writeFileAtomic(
      path.join(loaded.directory, "restore-receipts", `${receipt.receiptId}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
      0o600,
    );
    return receipt;
  }

  private async loadManifestForWorkspace(revisionId: string, workspaceRoot: string): Promise<LoadedManifest> {
    const workspaceId = hashText(toCanonicalPath(path.resolve(workspaceRoot)));
    const directory = path.join(this.storageRoot, workspaceId, revisionId);
    const loaded = await this.loadManifestAt(directory);
    if (loaded.manifest.workspaceRoot !== path.resolve(workspaceRoot)) {
      throw new Error("Workspace revision checkpoint workspace mismatch.");
    }
    return loaded;
  }

  private async findManifest(input: { revisionId: string; workspaceId?: string }): Promise<LoadedManifest> {
    if (!REVISION_ID_PATTERN.test(input.revisionId)) throw new Error("Workspace revision id is invalid.");
    const matches = (await this.loadAllManifests()).filter(({ manifest }) => (
      manifest.revisionId === input.revisionId && (!input.workspaceId || manifest.workspaceId === input.workspaceId)
    ));
    if (matches.length === 0) throw new Error("Workspace revision checkpoint was not found.");
    if (matches.length > 1) throw new Error("Workspace revision checkpoint is ambiguous; specify workspaceId.");
    return matches[0];
  }

  private async loadAllManifests(): Promise<LoadedManifest[]> {
    const workspaceEntries = await fs.readdir(this.storageRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const manifests: LoadedManifest[] = [];
    for (const workspaceEntry of workspaceEntries) {
      if (!workspaceEntry.isDirectory()) continue;
      const workspaceDirectory = path.join(this.storageRoot, workspaceEntry.name);
      const revisionEntries = await fs.readdir(workspaceDirectory, { withFileTypes: true });
      for (const revisionEntry of revisionEntries) {
        if (!revisionEntry.isDirectory() || !REVISION_ID_PATTERN.test(revisionEntry.name)) continue;
        try {
          manifests.push(await this.loadManifestAt(path.join(workspaceDirectory, revisionEntry.name)));
        } catch {
          // 保留损坏 artifact 供人工诊断，但不将其伪装成可恢复 checkpoint。
        }
      }
    }
    return manifests;
  }

  private async loadManifestAt(directory: string): Promise<LoadedManifest> {
    const manifestPath = path.join(directory, "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = parseManifest(JSON.parse(raw));
    if (!manifest) throw new Error("Workspace revision manifest is invalid.");
    return { manifest, directory };
  }

  private async saveManifest(loaded: LoadedManifest): Promise<void> {
    await writeFileAtomic(
      path.join(loaded.directory, "manifest.json"),
      `${JSON.stringify(loaded.manifest, null, 2)}\n`,
      0o600,
    );
  }

  private resolveBlobPath(directory: string, blobPath: string): string {
    const resolved = path.resolve(directory, blobPath);
    if (!isPathInside(directory, resolved)) throw new Error("Workspace revision preimage path is invalid.");
    return resolved;
  }
}
