import path from "node:path";

import type { AgentLaunchSpec } from "@belldandy/agent";

import {
  ManagedWorktreeRuntime,
  type ManagedWorktree,
  type ManagedWorktreeStatus,
} from "./managed-worktree.js";

export type WorktreeRuntimeStatus =
  | "not_requested"
  | "pending"
  | "created"
  | "failed"
  | "missing"
  | "removed"
  | "remove_failed";

export type SubTaskWorktreeRuntimeSummary = {
  requestedCwd?: string;
  resolvedCwd?: string;
  worktreePath?: string;
  worktreeRepoRoot?: string;
  worktreeBranch?: string;
  worktreeStatus?: WorktreeRuntimeStatus;
  worktreeError?: string;
};

export type PreparedSubTaskLaunchSpec = {
  launchSpec: AgentLaunchSpec;
  summary: SubTaskWorktreeRuntimeSummary;
};

export type PersistedSubTaskWorktreeRuntime = {
  cwd?: string;
  resolvedCwd?: string;
  isolationMode?: string;
  worktreePath?: string;
  worktreeRepoRoot?: string;
  worktreeBranch?: string;
};

type RuntimeLogger = {
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
  debug?: (message: string, data?: unknown) => void;
};

/**
 * Backward-compatible subtask adapter. Owner-specific force cleanup remains here,
 * while path validation, Git creation, reconciliation and cleanup live in the shared layer.
 */
export class SubTaskWorktreeRuntime {
  private readonly managedWorktrees: ManagedWorktreeRuntime;

  constructor(stateDir: string, logger?: RuntimeLogger) {
    this.managedWorktrees = new ManagedWorktreeRuntime(stateDir, logger);
  }

  async prepareTaskLaunch(taskId: string, launchSpec: AgentLaunchSpec): Promise<PreparedSubTaskLaunchSpec> {
    const requestedCwd = launchSpec.cwd ? path.resolve(launchSpec.cwd) : undefined;
    if (launchSpec.isolationMode !== "worktree") {
      return {
        launchSpec,
        summary: {
          requestedCwd,
          resolvedCwd: requestedCwd,
          worktreeStatus: "not_requested",
        },
      };
    }
    if (!requestedCwd) {
      throw new Error("isolationMode=worktree requires launchSpec.cwd.");
    }

    const worktree = await this.managedWorktrees.prepare({
      id: taskId,
      ownerKind: "subtask",
      cwd: requestedCwd,
    });
    return {
      launchSpec: { ...launchSpec, cwd: worktree.resolvedCwd },
      summary: this.toSummary(worktree),
    };
  }

  async reconcileTaskRuntime(
    taskId: string,
    runtime: PersistedSubTaskWorktreeRuntime,
  ): Promise<SubTaskWorktreeRuntimeSummary> {
    const requestedCwd = runtime.cwd ? path.resolve(runtime.cwd) : undefined;
    const previousResolvedCwd = runtime.resolvedCwd ? path.resolve(runtime.resolvedCwd) : undefined;
    if (runtime.isolationMode !== "worktree") {
      return {
        requestedCwd,
        resolvedCwd: requestedCwd ?? previousResolvedCwd,
        worktreeStatus: "not_requested",
      };
    }

    const worktree = this.fromPersisted(taskId, runtime);
    if (!worktree) {
      return {
        requestedCwd,
        resolvedCwd: previousResolvedCwd ?? requestedCwd,
        worktreeRepoRoot: runtime.worktreeRepoRoot ? path.resolve(runtime.worktreeRepoRoot) : undefined,
        worktreeBranch: runtime.worktreeBranch,
        worktreeStatus: "failed",
        worktreeError: "Missing persisted worktree path for worktree-isolated task.",
      };
    }
    const reconciled = await this.managedWorktrees.reconcile(worktree);
    return this.toSummary(reconciled, previousResolvedCwd);
  }

  async cleanupTaskRuntime(
    taskId: string,
    runtime: PersistedSubTaskWorktreeRuntime,
  ): Promise<SubTaskWorktreeRuntimeSummary> {
    const requestedCwd = runtime.cwd ? path.resolve(runtime.cwd) : undefined;
    const previousResolvedCwd = runtime.resolvedCwd ? path.resolve(runtime.resolvedCwd) : undefined;
    if (runtime.isolationMode !== "worktree") {
      return {
        requestedCwd,
        resolvedCwd: requestedCwd ?? previousResolvedCwd,
        worktreeStatus: "not_requested",
      };
    }

    const worktree = this.fromPersisted(taskId, runtime);
    if (!worktree) {
      return {
        requestedCwd,
        resolvedCwd: previousResolvedCwd ?? requestedCwd,
        worktreeStatus: "remove_failed",
        worktreeError: "Missing persisted worktree path for worktree-isolated task.",
      };
    }
    try {
      const cleaned = await this.managedWorktrees.cleanup(worktree, undefined);
      return {
        ...this.toSummary(worktree, previousResolvedCwd),
        worktreeStatus: cleaned.status === "removed" ? "removed" : "remove_failed",
        worktreeError: cleaned.reason,
      };
    } catch (error) {
      return {
        ...this.toSummary(worktree, previousResolvedCwd),
        worktreeStatus: "remove_failed",
        worktreeError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private fromPersisted(taskId: string, runtime: PersistedSubTaskWorktreeRuntime): ManagedWorktree | undefined {
    const worktreePath = runtime.worktreePath ? path.resolve(runtime.worktreePath) : undefined;
    if (!worktreePath) return undefined;
    const requestedCwd = runtime.cwd ? path.resolve(runtime.cwd) : runtime.resolvedCwd ? path.resolve(runtime.resolvedCwd) : worktreePath;
    return {
      id: taskId,
      ownerKind: "subtask",
      requestedCwd,
      resolvedCwd: runtime.resolvedCwd ? path.resolve(runtime.resolvedCwd) : worktreePath,
      worktreePath,
      repoRoot: runtime.worktreeRepoRoot ? path.resolve(runtime.worktreeRepoRoot) : worktreePath,
      branch: runtime.worktreeBranch?.trim() || `belldandy-${taskId}`,
      // Legacy subtask records predate baseRef. It is not used by subtask cleanup.
      baseRef: "",
      status: "created",
    };
  }

  private toSummary(worktree: ManagedWorktree, fallbackResolvedCwd?: string): SubTaskWorktreeRuntimeSummary {
    return {
      requestedCwd: worktree.requestedCwd,
      resolvedCwd: worktree.resolvedCwd || fallbackResolvedCwd,
      worktreePath: worktree.worktreePath,
      worktreeRepoRoot: worktree.repoRoot,
      worktreeBranch: worktree.branch,
      worktreeStatus: toRuntimeStatus(worktree.status),
      worktreeError: worktree.error,
    };
  }
}

function toRuntimeStatus(status: ManagedWorktreeStatus): WorktreeRuntimeStatus {
  switch (status) {
    case "created":
    case "failed":
    case "missing":
    case "removed":
    case "remove_failed":
      return status;
    case "retained":
      return "remove_failed";
  }
}
