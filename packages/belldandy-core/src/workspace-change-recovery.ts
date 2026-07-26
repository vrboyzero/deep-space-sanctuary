import { WorkspaceRevisionRuntime } from "./workspace-revision.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type WorkspaceChangeRecovery =
  | { recoveryGuarantee: "exact"; checkpointId: string }
  | { recoveryGuarantee: "managed_worktree"; worktreeId: string }
  | { recoveryGuarantee: "detect_only"; reason: "no_changes" | "checkpoint_missing" | "checkpoint_partial" };

export type WorkspaceChangeRecoveryFile = {
  path: string;
  previousPath?: string;
};

export type WorkspaceChangeRecoveryCandidate = {
  checkpoint?: {
    checkpointId: string;
    changedPaths: readonly string[];
  };
  managedWorktreeId?: string;
};

export function parseWorkspaceChangeRecovery(value: unknown): WorkspaceChangeRecovery | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.recoveryGuarantee === "exact" && typeof candidate.checkpointId === "string" && ID_PATTERN.test(candidate.checkpointId)) {
    return { recoveryGuarantee: "exact", checkpointId: candidate.checkpointId };
  }
  if (candidate.recoveryGuarantee === "managed_worktree" && typeof candidate.worktreeId === "string" && ID_PATTERN.test(candidate.worktreeId)) {
    return { recoveryGuarantee: "managed_worktree", worktreeId: candidate.worktreeId };
  }
  if (candidate.recoveryGuarantee === "detect_only"
    && (candidate.reason === "no_changes" || candidate.reason === "checkpoint_missing" || candidate.reason === "checkpoint_partial")) {
    return { recoveryGuarantee: "detect_only", reason: candidate.reason };
  }
  return undefined;
}

export function resolveWorkspaceChangeRecovery(input: {
  files: readonly WorkspaceChangeRecoveryFile[];
  candidate?: WorkspaceChangeRecoveryCandidate;
}): WorkspaceChangeRecovery {
  if (input.candidate?.managedWorktreeId !== undefined) {
    if (!ID_PATTERN.test(input.candidate.managedWorktreeId)) throw new Error("Workspace change recovery worktree id is invalid.");
    return { recoveryGuarantee: "managed_worktree", worktreeId: input.candidate.managedWorktreeId };
  }
  const changedPaths = new Set<string>();
  for (const file of input.files) {
    if (typeof file.path === "string" && file.path) changedPaths.add(file.path);
    if (typeof file.previousPath === "string" && file.previousPath) changedPaths.add(file.previousPath);
  }
  if (changedPaths.size === 0) return { recoveryGuarantee: "detect_only", reason: "no_changes" };
  const checkpoint = input.candidate?.checkpoint;
  if (!checkpoint) return { recoveryGuarantee: "detect_only", reason: "checkpoint_missing" };
  if (!ID_PATTERN.test(checkpoint.checkpointId)) throw new Error("Workspace change recovery checkpoint id is invalid.");
  const coveredPaths = new Set(checkpoint.changedPaths);
  if ([...changedPaths].every((changedPath) => coveredPaths.has(changedPath))) {
    return { recoveryGuarantee: "exact", checkpointId: checkpoint.checkpointId };
  }
  return { recoveryGuarantee: "detect_only", reason: "checkpoint_partial" };
}

export class WorkspaceChangeRecoveryRuntime {
  private readonly revisions: WorkspaceRevisionRuntime;

  constructor(options: { stateDir: string }) {
    this.revisions = new WorkspaceRevisionRuntime({ stateDir: options.stateDir });
  }

  async evaluate(input: {
    revisionId: string;
    workspaceRoot: string;
    files: readonly WorkspaceChangeRecoveryFile[];
    managedWorktreeId?: string;
  }): Promise<WorkspaceChangeRecovery> {
    const candidate = await this.getCandidate(input);
    return resolveWorkspaceChangeRecovery({ files: input.files, candidate });
  }

  async getCandidate(input: {
    revisionId: string;
    workspaceRoot: string;
    managedWorktreeId?: string;
  }): Promise<WorkspaceChangeRecoveryCandidate> {
    if (input.managedWorktreeId !== undefined) {
      if (!ID_PATTERN.test(input.managedWorktreeId)) throw new Error("Workspace change recovery worktree id is invalid.");
      return { managedWorktreeId: input.managedWorktreeId };
    }
    if (!ID_PATTERN.test(input.revisionId)) throw new Error("Workspace change recovery revision id is invalid.");
    try {
      const coverage = await this.revisions.getChangeCoverage({
        revisionId: input.revisionId,
        workspaceRoot: input.workspaceRoot,
      });
      return { checkpoint: { checkpointId: coverage.revisionId, changedPaths: coverage.changedPaths } };
    } catch {
      return {};
    }
  }
}
