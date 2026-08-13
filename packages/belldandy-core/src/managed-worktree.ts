import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const MAX_UNTRACKED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_UNTRACKED_BACKUP_BYTES = 64 * 1024 * 1024;

export type ManagedWorktreeOwnerKind = "subtask" | "workflow_call" | "user_session";

export type ManagedWorktreeStatus = "created" | "failed" | "missing" | "removed" | "remove_failed" | "retained";

export type ManagedWorktree = {
  id: string;
  ownerKind: ManagedWorktreeOwnerKind;
  requestedCwd: string;
  resolvedCwd: string;
  worktreePath: string;
  repoRoot: string;
  branch: string;
  baseRef: string;
  status: ManagedWorktreeStatus;
  error?: string;
};

export type ManagedWorktreeUntrackedFile = {
  path: string;
  status: "backed_up" | "rejected";
  sizeBytes?: number;
  sha256?: string;
  reason?: string;
};

export type ManagedWorktreeArtifact = {
  status: "complete" | "no_changes" | "incomplete";
  worktreeId: string;
  ownerKind: ManagedWorktreeOwnerKind;
  artifactRoot: string;
  patchPath?: string;
  manifestPath?: string;
  backupRoot?: string;
  trackedChanges: string[];
  untrackedFiles: ManagedWorktreeUntrackedFile[];
  error?: string;
};

export type ManagedWorktreeCleanupResult = {
  status: "removed" | "retained" | "remove_failed";
  worktreePath: string;
  branch: string;
  reason?: string;
};

export type ManagedWorktreePrepareInput = {
  id: string;
  ownerKind: ManagedWorktreeOwnerKind;
  cwd: string;
};

type RuntimeLogger = {
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
  debug?: (message: string, data?: unknown) => void;
};

function normalizeId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
  if (!normalized) {
    throw new Error("Managed worktree id must contain at least one safe path character.");
  }
  return normalized;
}

function buildBranchName(id: string): string {
  return (`belldandy-${id}`).slice(0, 120);
}

function buildGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
  };
}

async function runGit(args: string[], cwd: string, maxBuffer = 2 * 1024 * 1024): Promise<string> {
  return (await runGitOutput(args, cwd, maxBuffer)).trim();
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

function isInside(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSafeRelativePath(relativePath: string): boolean {
  return Boolean(relativePath)
    && !path.isAbsolute(relativePath)
    && !relativePath.split(/[\\/]+/).some((segment) => segment === ".." || segment.length === 0);
}

function parseNullDelimited(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function parseChangedPaths(value: string): string[] {
  const entries = parseNullDelimited(value);
  const paths: string[] = [];
  for (let index = 0; index < entries.length;) {
    const status = entries[index++];
    if (!status) continue;
    const oldPath = entries[index++];
    if (oldPath) paths.push(oldPath);
    if (status.startsWith("R") || status.startsWith("C")) {
      const newPath = entries[index++];
      if (newPath) paths.push(newPath);
    }
  }
  return paths;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared Git worktree owner. It never applies an artifact to the source repository.
 * Cleanup policy is deliberately evaluated here so callers cannot inherit subtask force
 * cleanup by accident.
 */
export class ManagedWorktreeRuntime {
  private readonly worktreesDir: string;
  private readonly artifactsDir: string;
  private readonly logger?: RuntimeLogger;

  constructor(stateDir: string, logger?: RuntimeLogger) {
    const resolvedStateDir = path.resolve(stateDir);
    this.worktreesDir = path.join(resolvedStateDir, "subtasks", "worktrees");
    this.artifactsDir = path.join(resolvedStateDir, "subtasks", "worktree-artifacts");
    this.logger = logger;
  }

  async prepare(input: ManagedWorktreePrepareInput): Promise<ManagedWorktree> {
    const id = normalizeId(input.id);
    const requestedCwd = path.resolve(input.cwd);
    const repoRoot = await this.resolveRepositoryRoot(requestedCwd);
    const sourceStatus = await runGit(["status", "--porcelain=v1", "-z"], repoRoot);
    if (sourceStatus) {
      throw new Error("Managed worktree requires a clean source repository; tracked, untracked, or unmerged changes were detected.");
    }

    const relativeCwd = path.relative(repoRoot, requestedCwd);
    if (relativeCwd.startsWith("..") || path.isAbsolute(relativeCwd)) {
      throw new Error(`Managed worktree cwd is outside the resolved repository root: ${requestedCwd}`);
    }

    const baseRef = await runGit(["rev-parse", "HEAD"], repoRoot);
    if (!baseRef) {
      throw new Error("Managed worktree requires a source repository with a resolved HEAD commit.");
    }

    const worktreePath = path.join(this.worktreesDir, id);
    const branch = buildBranchName(id);
    await fs.mkdir(this.worktreesDir, { recursive: true });
    if (await pathExists(worktreePath)) {
      throw new Error(`Managed worktree path already exists: ${worktreePath}`);
    }

    this.logger?.info?.("Creating managed worktree.", {
      id,
      ownerKind: input.ownerKind,
      repoRoot,
      requestedCwd,
      worktreePath,
      branch,
      baseRef,
    });

    try {
      await runGit(["worktree", "add", "-b", branch, worktreePath, baseRef], repoRoot);
    } catch (error) {
      throw new Error(`Failed to create managed worktree: ${toErrorMessage(error)}`);
    }

    const candidateCwd = relativeCwd && relativeCwd !== "."
      ? path.join(worktreePath, relativeCwd)
      : worktreePath;
    const resolvedCwd = await pathExists(candidateCwd) ? candidateCwd : worktreePath;
    return {
      id,
      ownerKind: input.ownerKind,
      requestedCwd,
      resolvedCwd,
      worktreePath,
      repoRoot,
      branch,
      baseRef,
      status: "created",
    };
  }

  /**
   * Deletes only a newly-created, unchanged worktree after its caller failed to
   * persist ownership. Any drift is retained for manual recovery.
   */
  async abortPreparedWorktree(worktree: ManagedWorktree): Promise<ManagedWorktreeCleanupResult> {
    this.assertManagedWorktree(worktree);
    const reconciled = await this.reconcile(worktree);
    if (reconciled.status !== "created") {
      return {
        status: "remove_failed",
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
        reason: reconciled.error ?? "Prepared worktree is unavailable.",
      };
    }
    try {
      const [status, branchHead] = await Promise.all([
        runGit(["status", "--porcelain=v1", "-z"], reconciled.worktreePath),
        runGit(["rev-parse", "--verify", reconciled.branch], reconciled.repoRoot),
      ]);
      if (status) return this.retained(reconciled, "Prepared worktree changed before ownership was persisted; preserving it for recovery.");
      if (branchHead !== reconciled.baseRef) {
        return this.retained(reconciled, "Prepared worktree branch changed before ownership was persisted; preserving it for recovery.");
      }
      await runGit(["worktree", "remove", reconciled.worktreePath], reconciled.repoRoot);
      const branchListing = await runGit(["branch", "--list", reconciled.branch], reconciled.repoRoot);
      if (branchListing) await runGit(["branch", "-d", reconciled.branch], reconciled.repoRoot);
      await runGit(["worktree", "prune"], reconciled.repoRoot).catch(() => "");
      return { status: "removed", worktreePath: reconciled.worktreePath, branch: reconciled.branch };
    } catch (error) {
      return {
        status: "remove_failed",
        worktreePath: reconciled.worktreePath,
        branch: reconciled.branch,
        reason: toErrorMessage(error),
      };
    }
  }

  async reconcile(worktree: ManagedWorktree): Promise<ManagedWorktree> {
    if (!this.isManagedWorktreePath(worktree.worktreePath)) {
      return { ...worktree, status: "failed", error: `Worktree path is outside the managed root: ${worktree.worktreePath}` };
    }
    if (!(await pathExists(worktree.worktreePath))) {
      return { ...worktree, status: "missing", error: `Managed worktree path is missing: ${worktree.worktreePath}` };
    }

    try {
      const resolvedRoot = path.resolve(await runGit(["rev-parse", "--show-toplevel"], worktree.worktreePath));
      const branch = await runGit(["branch", "--show-current"], worktree.worktreePath);
      if (resolvedRoot !== path.resolve(worktree.worktreePath)) {
        return { ...worktree, status: "failed", error: "Managed worktree root no longer matches its persisted path." };
      }
      if (branch !== worktree.branch) {
        return { ...worktree, status: "failed", error: `Managed worktree branch drifted from ${worktree.branch} to ${branch || "detached HEAD"}.` };
      }
    } catch (error) {
      return { ...worktree, status: "failed", error: `Failed to reconcile managed worktree: ${toErrorMessage(error)}` };
    }

    const relativeCwd = path.relative(worktree.repoRoot, worktree.requestedCwd);
    const candidateCwd = relativeCwd && relativeCwd !== "." && !relativeCwd.startsWith("..") && !path.isAbsolute(relativeCwd)
      ? path.join(worktree.worktreePath, relativeCwd)
      : worktree.worktreePath;
    return {
      ...worktree,
      resolvedCwd: await pathExists(candidateCwd) ? candidateCwd : worktree.worktreePath,
      status: "created",
      error: undefined,
    };
  }

  async collectArtifact(worktree: ManagedWorktree): Promise<ManagedWorktreeArtifact> {
    this.assertManagedWorktree(worktree);
    const artifactRoot = path.join(this.artifactsDir, worktree.ownerKind, worktree.id);
    const backupRoot = path.join(artifactRoot, "untracked");
    const patchPath = path.join(artifactRoot, "changes.patch");
    const manifestPath = path.join(artifactRoot, "manifest.json");
    const untrackedFiles: ManagedWorktreeUntrackedFile[] = [];
    let trackedChanges: string[] = [];

    if (await pathExists(artifactRoot)) {
      return {
        status: "incomplete",
        worktreeId: worktree.id,
        ownerKind: worktree.ownerKind,
        artifactRoot,
        trackedChanges,
        untrackedFiles,
        error: `Managed worktree artifact path already exists: ${artifactRoot}`,
      };
    }

    try {
      await fs.mkdir(backupRoot, { recursive: true });
      const patch = await runGitOutput(
        ["diff", "--binary", "--no-ext-diff", worktree.baseRef, "--"],
        worktree.worktreePath,
        MAX_UNTRACKED_BACKUP_BYTES + 2 * 1024 * 1024,
      );
      const changedPaths = await runGit(["diff", "--name-status", "-z", worktree.baseRef, "--"], worktree.worktreePath);
      trackedChanges = parseChangedPaths(changedPaths);
      await fs.writeFile(patchPath, patch, "utf-8");

      const untrackedPaths = parseNullDelimited(
        await runGit(["ls-files", "--others", "--exclude-standard", "-z"], worktree.worktreePath),
      );
      let totalBytes = 0;
      for (const relativePath of untrackedPaths) {
        if (!isSafeRelativePath(relativePath)) {
          throw new Error(`Untracked artifact path is unsafe: ${relativePath}`);
        }
        const sourcePath = path.resolve(worktree.worktreePath, relativePath);
        if (!isInside(worktree.worktreePath, sourcePath)) {
          throw new Error(`Untracked artifact path escapes the worktree: ${relativePath}`);
        }
        const stat = await fs.lstat(sourcePath);
        if (!stat.isFile()) {
          untrackedFiles.push({ path: relativePath, status: "rejected", reason: "Only regular untracked files can be backed up." });
          throw new Error(`Untracked artifact is not a regular file: ${relativePath}`);
        }
        if (stat.size > MAX_UNTRACKED_FILE_BYTES || totalBytes + stat.size > MAX_UNTRACKED_BACKUP_BYTES) {
          untrackedFiles.push({ path: relativePath, status: "rejected", sizeBytes: stat.size, reason: "Untracked backup size limit exceeded." });
          throw new Error(`Untracked artifact exceeds the backup size limit: ${relativePath}`);
        }

        const content = await fs.readFile(sourcePath);
        const destinationPath = path.resolve(backupRoot, relativePath);
        if (!isInside(backupRoot, destinationPath)) {
          throw new Error(`Untracked backup path escapes the artifact root: ${relativePath}`);
        }
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
        totalBytes += stat.size;
        untrackedFiles.push({
          path: relativePath,
          status: "backed_up",
          sizeBytes: stat.size,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }

      const status = patch || untrackedFiles.length > 0 ? "complete" : "no_changes";
      const artifact: ManagedWorktreeArtifact = {
        status,
        worktreeId: worktree.id,
        ownerKind: worktree.ownerKind,
        artifactRoot,
        patchPath,
        manifestPath,
        backupRoot,
        trackedChanges,
        untrackedFiles,
      };
      await this.writeArtifactManifest(artifact, worktree);
      return artifact;
    } catch (error) {
      const artifact: ManagedWorktreeArtifact = {
        status: "incomplete",
        worktreeId: worktree.id,
        ownerKind: worktree.ownerKind,
        artifactRoot,
        patchPath: await pathExists(patchPath) ? patchPath : undefined,
        manifestPath,
        backupRoot: await pathExists(backupRoot) ? backupRoot : undefined,
        trackedChanges,
        untrackedFiles,
        error: toErrorMessage(error),
      };
      await this.writeArtifactManifest(artifact, worktree).catch(() => {});
      return artifact;
    }
  }

  async collectOrReadArtifact(worktree: ManagedWorktree): Promise<ManagedWorktreeArtifact> {
    this.assertManagedWorktree(worktree);
    const artifactRoot = path.join(this.artifactsDir, worktree.ownerKind, worktree.id);
    if (!(await pathExists(artifactRoot))) return this.collectArtifact(worktree);

    const artifact = await this.readArtifactManifest(worktree);
    await this.assertArtifactFresh(worktree, artifact);
    return artifact;
  }

  async cleanup(
    worktree: ManagedWorktree,
    artifact: ManagedWorktreeArtifact | undefined,
  ): Promise<ManagedWorktreeCleanupResult> {
    this.assertManagedWorktree(worktree);

    if (worktree.ownerKind === "user_session") {
      return this.retained(worktree, "user_session worktrees require an explicit user action before removal.");
    }
    if (worktree.ownerKind === "workflow_call" && (!artifact || (artifact.status !== "complete" && artifact.status !== "no_changes"))) {
      return this.retained(worktree, "workflow_call worktree artifact is incomplete; preserving the worktree.");
    }
    if (!(await pathExists(worktree.repoRoot))) {
      return { status: "remove_failed", worktreePath: worktree.worktreePath, branch: worktree.branch, reason: "Source repository root is missing." };
    }

    try {
      if (worktree.ownerKind === "workflow_call") {
        const currentBranch = await runGit(["branch", "--show-current"], worktree.worktreePath);
        if (currentBranch !== worktree.branch) {
          return this.retained(worktree, "workflow_call worktree checked-out branch drifted; preserving it for review.");
        }
        const unmergedEntries = await runGit(["ls-files", "--unmerged", "-z"], worktree.worktreePath);
        if (unmergedEntries) {
          return this.retained(worktree, "workflow_call worktree contains unresolved merge conflicts; preserving it for review.");
        }
        const branchHead = await runGit(["rev-parse", "--verify", worktree.branch], worktree.repoRoot);
        if (branchHead !== worktree.baseRef) {
          return this.retained(worktree, "workflow_call worktree branch contains commits beyond its recorded base; preserving it for review.");
        }
      }

      if (await pathExists(worktree.worktreePath)) {
        await runGit(["worktree", "remove", "--force", worktree.worktreePath], worktree.repoRoot);
      }
      await runGit(["worktree", "prune"], worktree.repoRoot).catch(() => "");
      const deleteArgs = worktree.ownerKind === "subtask"
        ? ["branch", "-D", worktree.branch]
        : ["branch", "-d", worktree.branch];
      const branchListing = await runGit(["branch", "--list", worktree.branch], worktree.repoRoot);
      if (branchListing) {
        await runGit(deleteArgs, worktree.repoRoot);
      }
      await runGit(["worktree", "prune"], worktree.repoRoot).catch(() => "");
      return { status: "removed", worktreePath: worktree.worktreePath, branch: worktree.branch };
    } catch (error) {
      return {
        status: "remove_failed",
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
        reason: toErrorMessage(error),
      };
    }
  }

  async resolveRepositoryRoot(cwd: string): Promise<string> {
    try {
      const repoRoot = await runGit(["rev-parse", "--show-toplevel"], cwd);
      if (!repoRoot) throw new Error("Git returned an empty repository root.");
      return path.resolve(repoRoot);
    } catch (error) {
      throw new Error(`Failed to resolve git repository for managed worktree: ${toErrorMessage(error)}`);
    }
  }

  private isManagedWorktreePath(targetPath: string): boolean {
    return isInside(this.worktreesDir, targetPath);
  }

  private assertManagedWorktree(worktree: ManagedWorktree): void {
    if (!this.isManagedWorktreePath(worktree.worktreePath)) {
      throw new Error(`Refusing to operate on worktree outside the managed root: ${worktree.worktreePath}`);
    }
  }

  private retained(worktree: ManagedWorktree, reason: string): ManagedWorktreeCleanupResult {
    this.logger?.info?.("Retaining managed worktree.", { id: worktree.id, ownerKind: worktree.ownerKind, reason });
    return { status: "retained", worktreePath: worktree.worktreePath, branch: worktree.branch, reason };
  }

  private async writeArtifactManifest(artifact: ManagedWorktreeArtifact, worktree: ManagedWorktree): Promise<void> {
    if (!artifact.manifestPath) return;
    await fs.writeFile(artifact.manifestPath, `${JSON.stringify({
      version: 1,
      worktree: {
        id: worktree.id,
        ownerKind: worktree.ownerKind,
        requestedCwd: worktree.requestedCwd,
        resolvedCwd: worktree.resolvedCwd,
        worktreePath: worktree.worktreePath,
        repoRoot: worktree.repoRoot,
        branch: worktree.branch,
        baseRef: worktree.baseRef,
      },
      artifact,
    }, null, 2)}\n`, "utf-8");
  }

  private async readArtifactManifest(worktree: ManagedWorktree): Promise<ManagedWorktreeArtifact> {
    const artifactRoot = path.join(this.artifactsDir, worktree.ownerKind, worktree.id);
    const manifestPath = path.join(artifactRoot, "manifest.json");
    let value: unknown;
    try {
      value = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    } catch {
      throw new Error("Managed worktree artifact manifest is unavailable.");
    }
    const candidate = value as {
      version?: unknown;
      worktree?: Partial<ManagedWorktree>;
      artifact?: Partial<ManagedWorktreeArtifact>;
    };
    const persisted = candidate.worktree;
    const artifact = candidate.artifact;
    if (candidate.version !== 1
      || persisted?.id !== worktree.id
      || persisted.ownerKind !== worktree.ownerKind
      || path.resolve(String(persisted.worktreePath ?? "")) !== path.resolve(worktree.worktreePath)
      || path.resolve(String(persisted.repoRoot ?? "")) !== path.resolve(worktree.repoRoot)
      || persisted.branch !== worktree.branch
      || persisted.baseRef !== worktree.baseRef
      || (artifact?.status !== "complete" && artifact?.status !== "no_changes")
      || artifact.worktreeId !== worktree.id
      || artifact.ownerKind !== worktree.ownerKind
      || path.resolve(String(artifact.artifactRoot ?? "")) !== path.resolve(artifactRoot)
      || path.resolve(String(artifact.manifestPath ?? "")) !== path.resolve(manifestPath)
      || !Array.isArray(artifact.trackedChanges)
      || !Array.isArray(artifact.untrackedFiles)) {
      throw new Error("Managed worktree artifact manifest does not match its authoritative worktree binding.");
    }
    return {
      status: artifact.status,
      worktreeId: artifact.worktreeId,
      ownerKind: artifact.ownerKind,
      artifactRoot,
      patchPath: typeof artifact.patchPath === "string" ? artifact.patchPath : undefined,
      manifestPath,
      backupRoot: typeof artifact.backupRoot === "string" ? artifact.backupRoot : undefined,
      trackedChanges: artifact.trackedChanges.filter((item): item is string => typeof item === "string"),
      untrackedFiles: artifact.untrackedFiles.filter((item): item is ManagedWorktreeUntrackedFile => {
        return Boolean(item && typeof item === "object" && typeof item.path === "string"
          && (item.status === "backed_up" || item.status === "rejected"));
      }),
    };
  }

  private async assertArtifactFresh(worktree: ManagedWorktree, artifact: ManagedWorktreeArtifact): Promise<void> {
    const currentPatch = await runGitOutput(
      ["diff", "--binary", "--no-ext-diff", worktree.baseRef, "--"],
      worktree.worktreePath,
      MAX_UNTRACKED_BACKUP_BYTES + 2 * 1024 * 1024,
    );
    const persistedPatch = artifact.patchPath ? await fs.readFile(artifact.patchPath, "utf-8") : "";
    const currentTrackedChanges = parseChangedPaths(
      await runGit(["diff", "--name-status", "-z", worktree.baseRef, "--"], worktree.worktreePath),
    );
    if (currentPatch !== persistedPatch
      || JSON.stringify(currentTrackedChanges) !== JSON.stringify(artifact.trackedChanges)) {
      throw new Error("Managed worktree drifted after fan-in artifact capture.");
    }

    const currentUntracked = parseNullDelimited(
      await runGit(["ls-files", "--others", "--exclude-standard", "-z"], worktree.worktreePath),
    );
    const persistedUntracked = artifact.untrackedFiles.map((item) => item.path);
    if (JSON.stringify(currentUntracked) !== JSON.stringify(persistedUntracked)) {
      throw new Error("Managed worktree drifted after fan-in artifact capture.");
    }
    for (const item of artifact.untrackedFiles) {
      if (item.status !== "backed_up" || !item.sha256) {
        throw new Error("Managed worktree fan-in artifact contains an unusable untracked file.");
      }
      const sourcePath = path.resolve(worktree.worktreePath, item.path);
      if (!isInside(worktree.worktreePath, sourcePath)) {
        throw new Error("Managed worktree fan-in artifact contains an unsafe untracked path.");
      }
      const sha256 = createHash("sha256").update(await fs.readFile(sourcePath)).digest("hex");
      if (sha256 !== item.sha256) {
        throw new Error("Managed worktree drifted after fan-in artifact capture.");
      }
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
