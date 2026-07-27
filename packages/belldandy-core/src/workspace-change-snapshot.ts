import crypto from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  parseWorkspaceChangeRecovery,
  resolveWorkspaceChangeRecovery,
  type WorkspaceChangeRecovery,
  type WorkspaceChangeRecoveryCandidate,
} from "./workspace-change-recovery.js";

const execFile = promisify(execFileCallback);

const SNAPSHOT_VERSION = 1 as const;
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10_000;
const DEFAULT_MAX_DIFF_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_HUNKS_PER_PAGE = 32;
const MAX_SIMILARITY_RENAME_CANDIDATES = 64;
const MAX_SIMILARITY_RENAME_FILE_BYTES = 128 * 1024;
const MAX_SIMILARITY_RENAME_TOKENS = 256;
const MIN_SIMILARITY_RENAME_TOKENS = 3;
const MIN_SIMILARITY_RENAME_SCORE = 0.8;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type WorkspaceChangeBaselineSource = "run_start" | "git_head" | "git_revision" | "worktree_base";

export type WorkspaceChangeCoverage = {
  complete: boolean;
  fileCount: number;
  storedFileCount: number;
  storedBytes: number;
  omittedFileCount: number;
  reasons: string[];
};

export type WorkspaceChangeBaseline = {
  version: typeof SNAPSHOT_VERSION;
  baselineId: string;
  source: WorkspaceChangeBaselineSource;
  workspaceRoot: string;
  repository: "git" | "filesystem";
  revision?: string;
  hash: string;
  capturedAtMs: number;
  coverage: WorkspaceChangeCoverage;
};

export type WorkspaceChangeFileStatus = "added" | "deleted" | "modified" | "renamed";

export type WorkspaceChangeFile = {
  path: string;
  status: WorkspaceChangeFileStatus;
  previousPath?: string;
  renameSimilarity?: number;
  binary: boolean;
  diffAvailable: boolean;
  reason?: "file_too_large" | "unsupported_entry" | "unstable_read" | "diff_limit";
};

export type WorkspaceChangeHunk = {
  path: string;
  previousPath?: string;
  binary: boolean;
  patch: string;
};

export type WorkspaceChangeSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  snapshotId: string;
  revisionId?: string;
  baseline: Pick<WorkspaceChangeBaseline, "baselineId" | "source" | "revision" | "hash">;
  workspaceRoot: string;
  currentHash: string;
  diffHash: string;
  capturedAtMs: number;
  files: WorkspaceChangeFile[];
  hunkCount: number;
  truncated: boolean;
  truncationReasons: string[];
  coverage: WorkspaceChangeCoverage;
  recovery: WorkspaceChangeRecovery;
  artifacts: {
    summaryPath: string;
    patchPath: string;
  };
};

export type WorkspaceChangeSnapshotPage = {
  snapshotId: string;
  diffHash: string;
  hunks: WorkspaceChangeHunk[];
  nextCursor?: string;
};

export type WorkspaceChangeSnapshotRuntimeOptions = {
  stateDir: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
  maxDiffBytes?: number;
  maxHunksPerPage?: number;
};

type RepositoryInfo = {
  kind: "git" | "filesystem";
  repoRoot?: string;
};

type EntryKind = "file" | "symlink" | "other";

type SnapshotEntry = {
  path: string;
  kind: EntryKind;
  hash: string;
  size: number;
  mode: number;
  binary: boolean;
  stored: boolean;
  reason?: WorkspaceChangeFile["reason"];
};

type SnapshotManifest = {
  version: typeof SNAPSHOT_VERSION;
  baselineId: string;
  source: WorkspaceChangeBaselineSource;
  workspaceRoot: string;
  repository: RepositoryInfo["kind"];
  repoRoot?: string;
  revision?: string;
  hash: string;
  capturedAtMs: number;
  coverage: WorkspaceChangeCoverage;
  entries: SnapshotEntry[];
  storageDirectory: string;
};

type SnapshotRecord = WorkspaceChangeSnapshot & {
  baselineDirectory: string;
  currentDirectory: string;
  hunksPath: string;
};

type DiffAlias = {
  alias: string;
  change: WorkspaceChangeFile;
  baseline?: SnapshotEntry;
  current?: SnapshotEntry;
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashText(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function hashBuffer(value: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function hashFile(filePath: string, keepContents: boolean): Promise<{
  hash: string;
  binary: boolean;
  contents?: Buffer;
}> {
  if (keepContents) {
    const contents = await fs.readFile(filePath);
    return { hash: hashBuffer(contents), binary: contents.includes(0), contents };
  }
  const hash = crypto.createHash("sha256");
  let binary = false;
  const chunks: Buffer[] = [];
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    hash.update(buffer);
    binary ||= buffer.includes(0);
    if (chunks.length < 1 && buffer.byteLength <= 8192) chunks.push(buffer);
  }
  return {
    hash: `sha256:${hash.digest("hex")}`,
    binary: binary || (chunks[0]?.includes(0) ?? false),
  };
}

function canonicalEntries(entries: SnapshotEntry[]): string {
  return JSON.stringify(entries
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      hash: entry.hash,
      size: entry.size,
      binary: entry.binary,
    })));
}

function emptyCoverage(): WorkspaceChangeCoverage {
  return {
    complete: true,
    fileCount: 0,
    storedFileCount: 0,
    storedBytes: 0,
    omittedFileCount: 0,
    reasons: [],
  };
}

function addCoverageReason(coverage: WorkspaceChangeCoverage, reason: string): void {
  if (!coverage.reasons.includes(reason)) coverage.reasons.push(reason);
  coverage.complete = false;
}

function parseNulList(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function runGit(args: string[], cwd: string, maxBuffer = DEFAULT_MAX_DIFF_BYTES + 256 * 1024): Promise<string> {
  try {
    const result = await execFile("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
    });
    return String(result.stdout ?? "");
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stdout?: string | Buffer; code?: string | number };
    if (String(candidate.code) === "1" && candidate.stdout !== undefined) return String(candidate.stdout);
    throw error;
  }
}

async function resolveRepository(workspaceRoot: string): Promise<RepositoryInfo> {
  try {
    const repoRoot = path.resolve((await runGit(["rev-parse", "--show-toplevel"], workspaceRoot, 64 * 1024)).trim());
    if (repoRoot && isPathInside(repoRoot, workspaceRoot)) return { kind: "git", repoRoot };
  } catch {
    // Non-Git workspaces are a supported baseline, not an error path.
  }
  return { kind: "filesystem" };
}

function normalizeBaselineSource(value: WorkspaceChangeBaselineSource): WorkspaceChangeBaselineSource {
  if (value === "run_start" || value === "git_head" || value === "git_revision" || value === "worktree_base") return value;
  throw new Error("Workspace snapshot baseline source is invalid.");
}

async function resolveGitBaselineRevision(input: {
  source: WorkspaceChangeBaselineSource;
  revision?: string;
  repository: RepositoryInfo;
}): Promise<string | undefined> {
  if (input.source === "run_start") {
    if (input.revision !== undefined) throw new Error("Workspace run-start baseline must not specify a Git revision.");
    return undefined;
  }
  if (input.repository.kind !== "git" || !input.repository.repoRoot) {
    throw new Error("Workspace snapshot Git baseline requires a Git workspace.");
  }
  if (input.source === "git_head") {
    if (input.revision !== undefined) throw new Error("Workspace snapshot Git HEAD baseline must not specify a revision.");
  } else if (typeof input.revision !== "string" || !input.revision.trim()) {
    throw new Error(`Workspace snapshot ${input.source} baseline requires a revision.`);
  }
  const requestedRevision = input.source === "git_head" ? "HEAD" : input.revision as string;
  try {
    const revision = (await runGit([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${requestedRevision}^{commit}`,
    ], input.repository.repoRoot, 64 * 1024)).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(revision)) throw new Error("Git returned an invalid revision.");
    return revision;
  } catch {
    throw new Error("Workspace snapshot Git revision is invalid.");
  }
}

async function listWorkspaceFiles(
  workspaceRoot: string,
  repository: RepositoryInfo,
  excludedRoot?: string,
): Promise<string[]> {
  if (repository.kind === "git" && repository.repoRoot) {
    const scope = normalizeRelativePath(path.relative(repository.repoRoot, workspaceRoot));
    const output = await runGit([
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--full-name",
      "-z",
      "--",
      scope || ".",
    ], repository.repoRoot, 2 * 1024 * 1024);
    return [...new Set(parseNulList(output).map((item) => {
      const absolute = path.resolve(repository.repoRoot as string, item);
      return normalizeRelativePath(path.relative(workspaceRoot, absolute));
    }).filter((item) => {
      if (!item || item.startsWith("../") || item === "..") return false;
      return !excludedRoot || !isPathInside(excludedRoot, path.resolve(workspaceRoot, item));
    }))].sort();
  }

  const files: string[] = [];
  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(path.join(relativeDirectory, entry.name));
      const absolutePath = path.join(workspaceRoot, relativePath);
      if ((excludedRoot && isPathInside(excludedRoot, absolutePath)) || entry.name === ".git") continue;
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }
  await visit(workspaceRoot, "");
  return files;
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function captureEntries(input: {
  workspaceRoot: string;
  files: string[];
  storageDirectory: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
}): Promise<{ entries: SnapshotEntry[]; coverage: WorkspaceChangeCoverage }> {
  const coverage = emptyCoverage();
  const entries: SnapshotEntry[] = [];
  let storedBytes = 0;
  const selectedFiles = input.files.slice(0, input.maxFiles);
  if (input.files.length > selectedFiles.length) {
    addCoverageReason(coverage, "max_files");
  }

  for (const relativePath of selectedFiles) {
    const absolutePath = path.resolve(input.workspaceRoot, relativePath);
    const stat = await fs.lstat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) continue;
    coverage.fileCount += 1;
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(absolutePath);
      const entry: SnapshotEntry = {
        path: relativePath,
        kind: "symlink",
        hash: hashText(target),
        size: Buffer.byteLength(target),
        mode: stat.mode & 0o777,
        binary: false,
        stored: false,
        reason: "unsupported_entry",
      };
      entries.push(entry);
      coverage.omittedFileCount += 1;
      addCoverageReason(coverage, "unsupported_entry");
      continue;
    }
    if (!stat.isFile()) {
      entries.push({
        path: relativePath,
        kind: "other",
        hash: hashText(`${stat.mode}:${stat.size}`),
        size: stat.size,
        mode: stat.mode & 0o777,
        binary: false,
        stored: false,
        reason: "unsupported_entry",
      });
      coverage.omittedFileCount += 1;
      addCoverageReason(coverage, "unsupported_entry");
      continue;
    }

    const canStore = stat.size <= input.maxFileBytes && storedBytes + stat.size <= input.maxTotalBytes;
    const hashed = await hashFile(absolutePath, canStore);
    const after = await fs.lstat(absolutePath);
    const stable = after.isFile() && after.size === stat.size && after.mtimeMs === stat.mtimeMs;
    const stored = canStore && stable && hashed.contents !== undefined;
    const entry: SnapshotEntry = {
      path: relativePath,
      kind: "file",
      hash: hashed.hash,
      size: stat.size,
      mode: stat.mode & 0o777,
      binary: hashed.binary,
      stored,
      ...(stored ? {} : {
        reason: stable ? (stat.size > input.maxFileBytes ? "file_too_large" : "unstable_read") : "unstable_read",
      }),
    };
    entries.push(entry);
    if (stored && hashed.contents) {
      const targetPath = path.join(input.storageDirectory, ...relativePath.split("/"));
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(targetPath, hashed.contents);
      await fs.chmod(targetPath, stat.mode & 0o777).catch(() => {});
      storedBytes += stat.size;
      coverage.storedFileCount += 1;
      coverage.storedBytes += stat.size;
    } else {
      coverage.omittedFileCount += 1;
      addCoverageReason(coverage, entry.reason ?? "content_unavailable");
      if (stat.size <= input.maxFileBytes && storedBytes + stat.size > input.maxTotalBytes) {
        addCoverageReason(coverage, "max_total_bytes");
      }
    }
  }
  coverage.complete = coverage.omittedFileCount === 0 && !coverage.reasons.length;
  return { entries, coverage };
}

type GitTreeEntry = {
  path: string;
  mode: string;
  objectId: string;
  type: string;
};

function parseGitTreeEntries(value: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of parseNulList(value)) {
    const separator = record.indexOf("\t");
    if (separator < 0) continue;
    const fields = record.slice(0, separator).split(" ");
    const [mode, type, objectId] = fields;
    const entryPath = normalizeRelativePath(record.slice(separator + 1));
    if (!mode || !type || !objectId || !/^[a-f0-9]{40,64}$/i.test(objectId) || !entryPath) continue;
    entries.push({ path: entryPath, mode, objectId, type });
  }
  return entries;
}

async function readGitBlob(input: {
  repoRoot: string;
  objectId: string;
  keepContents: boolean;
}): Promise<{ hash: string; binary: boolean; contents?: Buffer }> {
  const child = spawn("git", ["cat-file", "blob", input.objectId], {
    cwd: input.repoRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  const errors: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => errors.push(Buffer.from(chunk)));
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const hash = crypto.createHash("sha256");
  const chunks: Buffer[] = [];
  let binary = false;
  try {
    for await (const chunk of child.stdout) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      binary ||= buffer.includes(0);
      if (input.keepContents) chunks.push(buffer);
    }
    const result = await completed;
    if (result.code !== 0) {
      const detail = Buffer.concat(errors).toString("utf-8").trim();
      throw new Error(detail || `git cat-file exited with ${result.signal ?? result.code ?? "an unknown status"}.`);
    }
  } catch (error) {
    child.kill();
    await completed.catch(() => {});
    throw error;
  }
  return {
    hash: `sha256:${hash.digest("hex")}`,
    binary,
    ...(input.keepContents ? { contents: Buffer.concat(chunks) } : {}),
  };
}

async function captureGitRevisionEntries(input: {
  workspaceRoot: string;
  repository: RepositoryInfo;
  revision: string;
  storageDirectory: string;
  excludedRoot?: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
}): Promise<{ entries: SnapshotEntry[]; coverage: WorkspaceChangeCoverage }> {
  if (!input.repository.repoRoot) throw new Error("Workspace snapshot Git baseline requires a repository root.");
  const scope = normalizeRelativePath(path.relative(input.repository.repoRoot, input.workspaceRoot));
  if (scope === ".." || scope.startsWith("../") || path.isAbsolute(scope)) {
    throw new Error("Workspace snapshot root is outside its Git repository.");
  }
  const treeOutput = await runGit([
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    input.revision,
    "--",
    scope || ".",
  ], input.repository.repoRoot, 8 * 1024 * 1024);
  const candidates = parseGitTreeEntries(treeOutput).filter((entry) => {
    const absolutePath = path.resolve(input.repository.repoRoot as string, entry.path);
    return isPathInside(input.workspaceRoot, absolutePath)
      && (!input.excludedRoot || !isPathInside(input.excludedRoot, absolutePath));
  });
  const coverage = emptyCoverage();
  const entries: SnapshotEntry[] = [];
  let storedBytes = 0;
  const selectedEntries = candidates.slice(0, input.maxFiles);
  if (candidates.length > selectedEntries.length) addCoverageReason(coverage, "max_files");

  for (const candidate of selectedEntries) {
    const relativePath = normalizeRelativePath(path.relative(input.workspaceRoot, path.resolve(input.repository.repoRoot, candidate.path)));
    if (!relativePath || relativePath.startsWith("../") || relativePath === "..") continue;
    coverage.fileCount += 1;
    const mode = Number.parseInt(candidate.mode, 8) & 0o777;
    if (candidate.mode === "120000") {
      const target = (await readGitBlob({
        repoRoot: input.repository.repoRoot,
        objectId: candidate.objectId,
        keepContents: true,
      })).contents?.toString("utf-8") ?? "";
      entries.push({
        path: relativePath,
        kind: "symlink",
        hash: hashText(target),
        size: Buffer.byteLength(target),
        mode,
        binary: false,
        stored: false,
        reason: "unsupported_entry",
      });
      coverage.omittedFileCount += 1;
      addCoverageReason(coverage, "unsupported_entry");
      continue;
    }
    if (candidate.type !== "blob" || !candidate.mode.startsWith("100")) {
      entries.push({
        path: relativePath,
        kind: "other",
        hash: hashText(`${candidate.mode}:${candidate.type}:${candidate.objectId}`),
        size: 0,
        mode,
        binary: false,
        stored: false,
        reason: "unsupported_entry",
      });
      coverage.omittedFileCount += 1;
      addCoverageReason(coverage, "unsupported_entry");
      continue;
    }
    const sizeText = await runGit(["cat-file", "-s", candidate.objectId], input.repository.repoRoot, 64 * 1024);
    const size = Number(sizeText.trim());
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Git returned an invalid blob size.");
    const canStore = size <= input.maxFileBytes && storedBytes + size <= input.maxTotalBytes;
    const hashed = await readGitBlob({
      repoRoot: input.repository.repoRoot,
      objectId: candidate.objectId,
      keepContents: canStore,
    });
    const stored = canStore && hashed.contents !== undefined;
    const entry: SnapshotEntry = {
      path: relativePath,
      kind: "file",
      hash: hashed.hash,
      size,
      mode,
      binary: hashed.binary,
      stored,
      ...(stored ? {} : { reason: size > input.maxFileBytes ? "file_too_large" : "unstable_read" }),
    };
    entries.push(entry);
    if (stored && hashed.contents) {
      const targetPath = path.join(input.storageDirectory, ...relativePath.split("/"));
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(targetPath, hashed.contents);
      await fs.chmod(targetPath, mode).catch(() => {});
      storedBytes += size;
      coverage.storedFileCount += 1;
      coverage.storedBytes += size;
    } else {
      coverage.omittedFileCount += 1;
      addCoverageReason(coverage, entry.reason ?? "content_unavailable");
      if (size <= input.maxFileBytes && storedBytes + size > input.maxTotalBytes) {
        addCoverageReason(coverage, "max_total_bytes");
      }
    }
  }
  coverage.complete = coverage.omittedFileCount === 0 && !coverage.reasons.length;
  return { entries, coverage };
}

function toBaseline(manifest: SnapshotManifest): WorkspaceChangeBaseline {
  return {
    version: SNAPSHOT_VERSION,
    baselineId: manifest.baselineId,
    source: manifest.source,
    workspaceRoot: manifest.workspaceRoot,
    repository: manifest.repository,
    ...(manifest.revision ? { revision: manifest.revision } : {}),
    hash: manifest.hash,
    capturedAtMs: manifest.capturedAtMs,
    coverage: manifest.coverage,
  };
}

function entryEqual(left: SnapshotEntry | undefined, right: SnapshotEntry | undefined): boolean {
  return Boolean(left && right && left.kind === right.kind && left.hash === right.hash && left.size === right.size);
}

type SimilarityRenamePair = {
  previous: SnapshotEntry;
  replacement: SnapshotEntry;
  similarity: number;
};

function isSimilarityRenameCandidate(entry: SnapshotEntry): boolean {
  return entry.kind === "file"
    && entry.stored
    && !entry.binary
    && entry.size > 0
    && entry.size <= MAX_SIMILARITY_RENAME_FILE_BYTES;
}

async function readSimilarityRenameTokens(storageDirectory: string, entry: SnapshotEntry): Promise<Set<string> | undefined> {
  try {
    const contents = await fs.readFile(path.join(storageDirectory, ...entry.path.split("/")));
    if (contents.includes(0)) return undefined;
    const tokens = new Set<string>();
    for (const line of contents.toString("utf-8").replace(/\r\n?/g, "\n").split("\n")) {
      const normalized = line.trim();
      if (!normalized) continue;
      tokens.add(hashText(normalized));
      if (tokens.size > MAX_SIMILARITY_RENAME_TOKENS) return undefined;
    }
    return tokens.size >= MIN_SIMILARITY_RENAME_TOKENS ? tokens : undefined;
  } catch {
    // 近似匹配只是归因提示；artifact 异常时保留更保守的 delete/add。
    return undefined;
  }
}

function calculateSimilarityRenameScore(left: Set<string>, right: Set<string>): number {
  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  return common / Math.max(left.size, right.size);
}

function selectUniqueBest<T extends { score: number }>(candidates: T[]): T | undefined {
  let best: T | undefined;
  let tied = false;
  for (const candidate of candidates) {
    if (!best || candidate.score > best.score) {
      best = candidate;
      tied = false;
    } else if (candidate.score === best.score) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

async function findSimilarityRenamePairs(input: {
  deleted: SnapshotEntry[];
  added: SnapshotEntry[];
  beforeDirectory: string;
  afterDirectory: string;
}): Promise<SimilarityRenamePair[]> {
  const deleted = input.deleted.filter(isSimilarityRenameCandidate).sort((left, right) => left.path.localeCompare(right.path));
  const added = input.added.filter(isSimilarityRenameCandidate).sort((left, right) => left.path.localeCompare(right.path));
  if (
    deleted.length === 0
    || added.length === 0
    || deleted.length > MAX_SIMILARITY_RENAME_CANDIDATES
    || added.length > MAX_SIMILARITY_RENAME_CANDIDATES
  ) {
    return [];
  }
  const beforeTokens = new Map<string, Set<string>>();
  const afterTokens = new Map<string, Set<string>>();
  for (const entry of deleted) {
    const tokens = await readSimilarityRenameTokens(input.beforeDirectory, entry);
    if (tokens) beforeTokens.set(entry.path, tokens);
  }
  for (const entry of added) {
    const tokens = await readSimilarityRenameTokens(input.afterDirectory, entry);
    if (tokens) afterTokens.set(entry.path, tokens);
  }

  type ScoredPair = SimilarityRenamePair & { score: number };
  const scores: ScoredPair[] = [];
  for (const previous of deleted) {
    const previousTokens = beforeTokens.get(previous.path);
    if (!previousTokens) continue;
    for (const replacement of added) {
      const replacementTokens = afterTokens.get(replacement.path);
      if (!replacementTokens) continue;
      const score = calculateSimilarityRenameScore(previousTokens, replacementTokens);
      if (score < MIN_SIMILARITY_RENAME_SCORE) continue;
      scores.push({
        previous,
        replacement,
        score,
        similarity: Math.round(score * 100) / 100,
      });
    }
  }

  const bestByPrevious = new Map<string, ScoredPair>();
  const bestByReplacement = new Map<string, ScoredPair>();
  for (const previous of deleted) {
    const best = selectUniqueBest(scores.filter((pair) => pair.previous.path === previous.path));
    if (best) bestByPrevious.set(previous.path, best);
  }
  for (const replacement of added) {
    const best = selectUniqueBest(scores.filter((pair) => pair.replacement.path === replacement.path));
    if (best) bestByReplacement.set(replacement.path, best);
  }
  return [...bestByPrevious.values()]
    .filter((pair) => bestByReplacement.get(pair.replacement.path) === pair)
    .map(({ previous, replacement, similarity }) => ({ previous, replacement, similarity }))
    .sort((left, right) => left.replacement.path.localeCompare(right.replacement.path));
}

async function buildChanges(input: {
  before: SnapshotEntry[];
  after: SnapshotEntry[];
  beforeDirectory: string;
  afterDirectory: string;
}): Promise<WorkspaceChangeFile[]> {
  const { before, after } = input;
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.map((entry) => [entry.path, entry]));
  const added = after.filter((entry) => !beforeByPath.has(entry.path));
  const deleted = before.filter((entry) => !afterByPath.has(entry.path));
  const changes: WorkspaceChangeFile[] = [];
  const pairedAdded = new Set<string>();
  const pairedDeleted = new Set<string>();

  for (const oldEntry of deleted) {
    const replacement = added.find((entry) => !pairedAdded.has(entry.path) && entryEqual(oldEntry, entry));
    if (!replacement) continue;
    pairedAdded.add(replacement.path);
    pairedDeleted.add(oldEntry.path);
    changes.push({
      path: replacement.path,
      previousPath: oldEntry.path,
      status: "renamed",
      binary: oldEntry.binary || replacement.binary,
      diffAvailable: oldEntry.stored && replacement.stored,
      ...(oldEntry.stored && replacement.stored ? {} : { reason: oldEntry.reason ?? replacement.reason ?? "file_too_large" }),
    });
  }

  const similarityPairs = await findSimilarityRenamePairs({
    deleted: deleted.filter((entry) => !pairedDeleted.has(entry.path)),
    added: added.filter((entry) => !pairedAdded.has(entry.path)),
    beforeDirectory: input.beforeDirectory,
    afterDirectory: input.afterDirectory,
  });
  for (const pair of similarityPairs) {
    pairedAdded.add(pair.replacement.path);
    pairedDeleted.add(pair.previous.path);
    changes.push({
      path: pair.replacement.path,
      previousPath: pair.previous.path,
      status: "renamed",
      renameSimilarity: pair.similarity,
      binary: false,
      diffAvailable: true,
    });
  }

  for (const entry of before) {
    const current = afterByPath.get(entry.path);
    if (!current) {
      if (!pairedDeleted.has(entry.path)) changes.push(toChange(entry.path, "deleted", entry, undefined));
      continue;
    }
    if (entryEqual(entry, current)) continue;
    changes.push(toChange(entry.path, "modified", entry, current));
  }
  for (const entry of after) {
    if (!beforeByPath.has(entry.path) && !pairedAdded.has(entry.path)) {
      changes.push(toChange(entry.path, "added", undefined, entry));
    }
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function toChange(
  relativePath: string,
  status: Exclude<WorkspaceChangeFileStatus, "renamed">,
  before: SnapshotEntry | undefined,
  after: SnapshotEntry | undefined,
): WorkspaceChangeFile {
  const diffAvailable = before?.stored === true || after?.stored === true
    ? (before?.kind ?? after?.kind) === "file" && (before?.stored ?? true) && (after?.stored ?? true)
    : false;
  const reason = before?.reason ?? after?.reason;
  return {
    path: relativePath,
    status,
    binary: Boolean(before?.binary || after?.binary),
    diffAvailable,
    ...(diffAvailable ? {} : { reason: reason ?? "file_too_large" }),
  };
}

function quoteGitPath(value: string): string {
  if (/^[A-Za-z0-9._+/@=-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

function normalizeDiffBlock(block: string, alias: DiffAlias): string {
  const oldName = alias.change.status === "added" ? "/dev/null" : `a/${quoteGitPath(alias.change.previousPath ?? alias.change.path)}`;
  const newName = alias.change.status === "deleted" ? "/dev/null" : `b/${quoteGitPath(alias.change.path)}`;
  const oldAlias = `a/diff-base/${alias.alias}`;
  const newAlias = `b/diff-current/${alias.alias}`;
  return block
    .replace(`a/diff-base/${alias.alias}`, oldName === "/dev/null" ? `a/${alias.change.path}` : oldName)
    .replace(`b/diff-current/${alias.alias}`, newName === "/dev/null" ? `b/${alias.change.path}` : newName)
    .replace(`--- ${oldAlias}`, `--- ${oldName}`)
    .replace(`+++ ${newAlias}`, `+++ ${newName}`)
    .replace(`Binary files ${oldAlias} and ${newAlias} differ`, `Binary files ${oldName} and ${newName} differ`);
}

function splitHunks(patch: string, alias: DiffAlias): WorkspaceChangeHunk[] {
  const lines = patch.split("\n");
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunkIndex < 0) {
    return [{
      path: alias.change.path,
      ...(alias.change.previousPath ? { previousPath: alias.change.previousPath } : {}),
      binary: alias.change.binary,
      patch: patch.trimEnd(),
    }];
  }
  const header = lines.slice(0, firstHunkIndex).join("\n");
  const hunks: WorkspaceChangeHunk[] = [];
  let start = firstHunkIndex;
  for (let index = firstHunkIndex + 1; index <= lines.length; index += 1) {
    if (index < lines.length && !lines[index].startsWith("@@ ")) continue;
    const body = lines.slice(start, index).join("\n");
    hunks.push({
      path: alias.change.path,
      ...(alias.change.previousPath ? { previousPath: alias.change.previousPath } : {}),
      binary: alias.change.binary,
      patch: `${header}\n${body}`.trimEnd(),
    });
    start = index;
  }
  return hunks;
}

function encodeCursor(snapshotId: string, index: number): string {
  return Buffer.from(JSON.stringify({ version: SNAPSHOT_VERSION, snapshotId, index }), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string, snapshotId: string): number {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as Record<string, unknown>;
    if (value.version !== SNAPSHOT_VERSION || value.snapshotId !== snapshotId || !Number.isSafeInteger(value.index) || Number(value.index) < 0) {
      throw new Error("invalid cursor");
    }
    return Number(value.index);
  } catch {
    throw new Error("Workspace change snapshot cursor is invalid.");
  }
}

export class WorkspaceChangeSnapshotRuntime {
  private readonly storageRoot: string;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxFiles: number;
  private readonly maxDiffBytes: number;
  private readonly maxHunksPerPage: number;

  constructor(options: WorkspaceChangeSnapshotRuntimeOptions) {
    this.storageRoot = path.resolve(options.stateDir, "artifacts", "workspace-change-snapshots");
    this.maxFileBytes = normalizePositiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
    this.maxTotalBytes = normalizePositiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES);
    this.maxFiles = normalizePositiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
    this.maxDiffBytes = normalizePositiveInteger(options.maxDiffBytes, DEFAULT_MAX_DIFF_BYTES);
    this.maxHunksPerPage = normalizePositiveInteger(options.maxHunksPerPage, DEFAULT_MAX_HUNKS_PER_PAGE);
  }

  async captureBaseline(input: {
    baselineId: string;
    workspaceRoot: string;
    source: WorkspaceChangeBaselineSource;
    revision?: string;
  }): Promise<WorkspaceChangeBaseline> {
    const baselineId = normalizeId(input.baselineId, "baselineId");
    const source = normalizeBaselineSource(input.source);
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const rootStat = await fs.lstat(workspaceRoot).catch(() => undefined);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Workspace snapshot root must be a real directory.");
    const baselineDirectory = path.join(this.storageRoot, baselineId);
    if (await pathExists(baselineDirectory)) throw new Error("Workspace snapshot baseline already exists.");
    const repository = await resolveRepository(workspaceRoot);
    const revision = await resolveGitBaselineRevision({ source, revision: input.revision, repository });
    const temporaryDirectory = path.join(this.storageRoot, `.${baselineId}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.mkdir(path.join(temporaryDirectory, "files"), { recursive: true, mode: 0o700 });
      const captured = revision
        ? await captureGitRevisionEntries({
          workspaceRoot,
          repository,
          revision,
          storageDirectory: path.join(temporaryDirectory, "files"),
          excludedRoot: this.storageRoot,
          maxFileBytes: this.maxFileBytes,
          maxTotalBytes: this.maxTotalBytes,
          maxFiles: this.maxFiles,
        })
        : await captureEntries({
          workspaceRoot,
          files: await listWorkspaceFiles(workspaceRoot, repository, this.storageRoot),
          storageDirectory: path.join(temporaryDirectory, "files"),
          maxFileBytes: this.maxFileBytes,
          maxTotalBytes: this.maxTotalBytes,
          maxFiles: this.maxFiles,
        });
      const manifest: SnapshotManifest = {
        version: SNAPSHOT_VERSION,
        baselineId,
        source,
        workspaceRoot,
        repository: repository.kind,
        ...(repository.repoRoot ? { repoRoot: repository.repoRoot } : {}),
        ...(revision ? { revision } : {}),
        hash: hashText(canonicalEntries(captured.entries)),
        capturedAtMs: Date.now(),
        coverage: captured.coverage,
        entries: captured.entries,
        storageDirectory: path.join(baselineDirectory, "files"),
      };
      await writeJson(path.join(temporaryDirectory, "manifest.json"), manifest);
      await fs.mkdir(path.dirname(baselineDirectory), { recursive: true, mode: 0o700 });
      await fs.rename(temporaryDirectory, baselineDirectory);
      return toBaseline(manifest);
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async createSnapshot(input: {
    baselineId: string;
    revisionId?: string;
    recovery?: WorkspaceChangeRecoveryCandidate;
  }): Promise<WorkspaceChangeSnapshot> {
    const baseline = await this.loadBaseline(input.baselineId);
    const revisionId = input.revisionId === undefined ? undefined : normalizeId(input.revisionId, "revisionId");
    const snapshotId = makeId("snapshot");
    const snapshotDirectory = path.join(this.storageRoot, baseline.baselineId, "snapshots", snapshotId);
    const temporaryDirectory = path.join(this.storageRoot, baseline.baselineId, "snapshots", `.${snapshotId}.tmp`);
    try {
      await fs.mkdir(path.join(temporaryDirectory, "current"), { recursive: true, mode: 0o700 });
      const repository: RepositoryInfo = {
        kind: baseline.repository,
        ...(baseline.repoRoot ? { repoRoot: baseline.repoRoot } : {}),
      };
      const files = await listWorkspaceFiles(baseline.workspaceRoot, repository, this.storageRoot);
      const captured = await captureEntries({
        workspaceRoot: baseline.workspaceRoot,
        files,
        storageDirectory: path.join(temporaryDirectory, "current"),
        maxFileBytes: this.maxFileBytes,
        maxTotalBytes: this.maxTotalBytes,
        maxFiles: this.maxFiles,
      });
      const currentHash = hashText(canonicalEntries(captured.entries));
      const changes = await buildChanges({
        before: baseline.entries,
        after: captured.entries,
        beforeDirectory: baseline.storageDirectory,
        afterDirectory: path.join(temporaryDirectory, "current"),
      });
      const diffAliases: DiffAlias[] = [];
      for (const [index, change] of changes.entries()) {
        if (!change.diffAvailable || (change.status === "renamed" && change.renameSimilarity === undefined)) continue;
        const before = baseline.entries.find((entry) => entry.path === (change.previousPath ?? change.path));
        const current = captured.entries.find((entry) => entry.path === change.path);
        diffAliases.push({ alias: String(index + 1).padStart(6, "0"), change, baseline: before, current });
      }
      const diffDirectory = path.join(temporaryDirectory, "diff");
      await fs.mkdir(path.join(diffDirectory, "diff-base"), { recursive: true, mode: 0o700 });
      await fs.mkdir(path.join(diffDirectory, "diff-current"), { recursive: true, mode: 0o700 });
      for (const alias of diffAliases) {
        if (alias.baseline?.stored) {
          await fs.copyFile(path.join(baseline.storageDirectory, ...alias.baseline.path.split("/")), path.join(diffDirectory, "diff-base", alias.alias));
          await fs.chmod(path.join(diffDirectory, "diff-base", alias.alias), alias.baseline.mode).catch(() => {});
        }
        if (alias.current?.stored) {
          await fs.copyFile(path.join(temporaryDirectory, "current", ...alias.current.path.split("/")), path.join(diffDirectory, "diff-current", alias.alias));
          await fs.chmod(path.join(diffDirectory, "diff-current", alias.alias), alias.current.mode).catch(() => {});
        }
      }

      let rawPatch = "";
      let diffLimited = false;
      if (diffAliases.length > 0) {
        try {
          rawPatch = await runGit([
            "diff",
            "--no-index",
            "--binary",
            "--find-renames",
            "--no-ext-diff",
            "--no-color",
            "--unified=3",
            "--",
            "diff-base",
            "diff-current",
          ], diffDirectory, this.maxDiffBytes + 256 * 1024);
        } catch (error) {
          if (String((error as NodeJS.ErrnoException).code) === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            diffLimited = true;
          } else {
            throw error;
          }
        }
      }
      const hunks: WorkspaceChangeHunk[] = [];
      if (!diffLimited && rawPatch) {
        const blocks = rawPatch.split(/(?=^diff --git )/m).filter((block) => block.startsWith("diff --git "));
        for (const block of blocks) {
          const aliasMatch = block.match(/^diff --git a\/diff-base\/(\d{6}) b\/diff-current\/\1/m);
          const alias = aliasMatch ? diffAliases.find((item) => item.alias === aliasMatch[1]) : undefined;
          if (alias) hunks.push(...splitHunks(normalizeDiffBlock(block, alias), alias));
        }
      }
      for (const change of changes.filter((item) => item.status === "renamed" && item.renameSimilarity === undefined && item.diffAvailable)) {
        hunks.push({
          path: change.path,
          ...(change.previousPath ? { previousPath: change.previousPath } : {}),
          binary: change.binary,
          patch: [
            `diff --git a/${quoteGitPath(change.previousPath ?? change.path)} b/${quoteGitPath(change.path)}`,
            "similarity index 100%",
            `rename from ${quoteGitPath(change.previousPath ?? change.path)}`,
            `rename to ${quoteGitPath(change.path)}`,
          ].join("\n"),
        });
      }
      if (diffLimited) {
        for (const change of changes) {
          if (change.diffAvailable && !change.reason) change.reason = "diff_limit";
        }
      }
      hunks.sort((left, right) => left.path.localeCompare(right.path) || (left.previousPath ?? "").localeCompare(right.previousPath ?? ""));
      const diffHash = hashText(JSON.stringify({ baseline: baseline.hash, current: currentHash, files: changes, hunks }));
      const recovery = resolveWorkspaceChangeRecovery({ files: changes, candidate: input.recovery });
      const summary: WorkspaceChangeSnapshot = {
        version: SNAPSHOT_VERSION,
        snapshotId,
        ...(revisionId ? { revisionId } : {}),
        baseline: {
          baselineId: baseline.baselineId,
          source: baseline.source,
          ...(baseline.revision ? { revision: baseline.revision } : {}),
          hash: baseline.hash,
        },
        workspaceRoot: baseline.workspaceRoot,
        currentHash,
        diffHash,
        capturedAtMs: Date.now(),
        files: changes,
        hunkCount: hunks.length,
        truncated: diffLimited || changes.some((change) => !change.diffAvailable),
        truncationReasons: [
          ...(diffLimited ? ["diff_limit"] : []),
          ...new Set(changes.flatMap((change) => change.reason ? [change.reason] : [])),
        ],
        coverage: captured.coverage,
        recovery,
        artifacts: {
          summaryPath: path.join(snapshotDirectory, "summary.json"),
          patchPath: path.join(snapshotDirectory, "changes.patch"),
        },
      };
      await fs.mkdir(path.join(temporaryDirectory), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(temporaryDirectory, "changes.patch"), `${hunks.map((hunk) => hunk.patch).join("\n")}${hunks.length ? "\n" : ""}`, "utf-8");
      await writeJson(path.join(temporaryDirectory, "hunks.json"), hunks);
      await writeJson(path.join(temporaryDirectory, "summary.json"), summary);
      await fs.mkdir(path.dirname(snapshotDirectory), { recursive: true, mode: 0o700 });
      await fs.rename(temporaryDirectory, snapshotDirectory);
      return summary;
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async readSnapshotPage(input: {
    snapshotId: string;
    cursor?: string;
    maxHunks?: number;
  }): Promise<WorkspaceChangeSnapshotPage> {
    const snapshot = await this.loadSnapshot(input.snapshotId);
    const hunks = JSON.parse(await fs.readFile(snapshot.hunksPath, "utf-8")) as WorkspaceChangeHunk[];
    const start = input.cursor ? decodeCursor(input.cursor, snapshot.snapshotId) : 0;
    const maxHunks = Math.min(this.maxHunksPerPage, normalizePositiveInteger(input.maxHunks, this.maxHunksPerPage));
    const page = hunks.slice(start, start + maxHunks);
    return {
      snapshotId: snapshot.snapshotId,
      diffHash: snapshot.diffHash,
      hunks: page,
      ...(start + page.length < hunks.length ? { nextCursor: encodeCursor(snapshot.snapshotId, start + page.length) } : {}),
    };
  }

  async readSnapshot(input: { snapshotId: string }): Promise<WorkspaceChangeSnapshot> {
    const snapshot = await this.loadSnapshot(input.snapshotId);
    return {
      version: snapshot.version,
      snapshotId: snapshot.snapshotId,
      ...(snapshot.revisionId ? { revisionId: snapshot.revisionId } : {}),
      baseline: { ...snapshot.baseline },
      workspaceRoot: snapshot.workspaceRoot,
      currentHash: snapshot.currentHash,
      diffHash: snapshot.diffHash,
      capturedAtMs: snapshot.capturedAtMs,
      files: snapshot.files.map((file) => ({ ...file })),
      hunkCount: snapshot.hunkCount,
      truncated: snapshot.truncated,
      truncationReasons: [...snapshot.truncationReasons],
      coverage: {
        ...snapshot.coverage,
        reasons: [...snapshot.coverage.reasons],
      },
      recovery: { ...snapshot.recovery },
      artifacts: { ...snapshot.artifacts },
    };
  }

  async readBaseline(input: { baselineId: string }): Promise<WorkspaceChangeBaseline> {
    return toBaseline(await this.loadBaseline(input.baselineId));
  }

  private async loadBaseline(baselineIdInput: string): Promise<SnapshotManifest> {
    const baselineId = normalizeId(baselineIdInput, "baselineId");
    const manifestPath = path.join(this.storageRoot, baselineId, "manifest.json");
    if (!await pathExists(manifestPath)) throw new Error("Workspace snapshot baseline was not found.");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as SnapshotManifest;
    if (manifest.version !== SNAPSHOT_VERSION || manifest.baselineId !== baselineId || !Array.isArray(manifest.entries)) {
      throw new Error("Workspace snapshot baseline manifest is invalid.");
    }
    return manifest;
  }

  private async loadSnapshot(snapshotIdInput: string): Promise<SnapshotRecord> {
    const snapshotId = normalizeId(snapshotIdInput, "snapshotId");
    const matches = await findSnapshotDirectory(this.storageRoot, snapshotId);
    if (!matches) throw new Error("Workspace change snapshot was not found.");
    const summary = JSON.parse(await fs.readFile(path.join(matches, "summary.json"), "utf-8")) as WorkspaceChangeSnapshot;
    if (summary.version !== SNAPSHOT_VERSION || summary.snapshotId !== snapshotId) throw new Error("Workspace change snapshot manifest is invalid.");
    const revisionId = summary.revisionId === undefined ? undefined : normalizeId(summary.revisionId, "revisionId");
    const recovery = parseWorkspaceChangeRecovery(summary.recovery)
      ?? resolveWorkspaceChangeRecovery({ files: summary.files });
    return {
      ...summary,
      ...(revisionId ? { revisionId } : {}),
      recovery,
      baselineDirectory: path.dirname(path.dirname(matches)),
      currentDirectory: path.join(matches, "current"),
      hunksPath: path.join(matches, "hunks.json"),
    };
  }
}

async function findSnapshotDirectory(storageRoot: string, snapshotId: string): Promise<string | undefined> {
  const baselines = await fs.readdir(storageRoot, { withFileTypes: true }).catch(() => []);
  for (const baseline of baselines) {
    if (!baseline.isDirectory() || baseline.name.startsWith(".")) continue;
    const candidate = path.join(storageRoot, baseline.name, "snapshots", snapshotId);
    if (await pathExists(path.join(candidate, "summary.json"))) return candidate;
  }
  return undefined;
}
