import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveWorkspaceChangeRecovery, WorkspaceChangeRecoveryRuntime } from "./workspace-change-recovery.js";
import { WorkspaceChangeSnapshotRuntime } from "./workspace-change-snapshot.js";
import {
  normalizeWorkspaceRevisionIdentityPath,
  WorkspaceRevisionRuntime,
} from "./workspace-revision.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function createFixture(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(rootDir);
  const workspaceRoot = path.join(rootDir, "workspace");
  const stateDir = path.join(rootDir, "state");
  await fs.mkdir(workspaceRoot, { recursive: true });
  return { workspaceRoot, stateDir };
}

describe("WorkspaceChangeRecoveryRuntime", () => {
  it("finds a checkpoint whose absolute workspace path uses foreign host semantics", async () => {
    const fixture = await createFixture("belldandy-change-recovery-foreign-path-");
    const revisionId = "run-recovery-foreign-path";
    const manifestWorkspaceRoot = process.platform === "win32"
      ? "/home/User/workspace"
      : "E:\\Project\\Workspace";
    const requestedWorkspaceRoot = process.platform === "win32"
      ? "/home/User/parent/../workspace"
      : "e:/project/workspace";
    const workspaceId = crypto.createHash("sha256")
      .update(normalizeWorkspaceRevisionIdentityPath(manifestWorkspaceRoot))
      .digest("hex");
    const checkpointDirectory = path.join(
      fixture.stateDir,
      "workspace-revisions",
      workspaceId,
      revisionId,
    );
    await fs.mkdir(checkpointDirectory, { recursive: true });
    await fs.writeFile(path.join(checkpointDirectory, "manifest.json"), `${JSON.stringify({
      version: 1,
      revisionId,
      workspaceId,
      workspaceRoot: manifestWorkspaceRoot,
      createdAtMs: 1,
      updatedAtMs: 1,
      files: [{ relativePath: "src/api.ts", after: { exists: false } }],
      operations: [],
    })}\n`, "utf-8");

    await expect(new WorkspaceChangeRecoveryRuntime({ stateDir: fixture.stateDir }).evaluate({
      revisionId,
      workspaceRoot: requestedWorkspaceRoot,
      files: [{ path: "src/api.ts" }],
    })).resolves.toEqual({ recoveryGuarantee: "exact", checkpointId: revisionId });
  });

  it("reports exact recovery only when one checkpoint covers every changed snapshot path", async () => {
    const fixture = await createFixture("belldandy-change-recovery-exact-");
    const file = path.join(fixture.workspaceRoot, "note.txt");
    await fs.writeFile(file, "before\n", "utf-8");
    const snapshots = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await snapshots.captureBaseline({
      baselineId: "recovery-exact-baseline",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    const revisions = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
    const revisionId = "run-recovery-exact";
    const targets = [{ absolutePath: file, relativePath: "note.txt" }];
    await revisions.prepareMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "file_write", targets });
    await fs.writeFile(file, "agent change\n", "utf-8");
    await revisions.commitMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "file_write", targets });
    const snapshot = await snapshots.createSnapshot({ baselineId: baseline.baselineId });

    const recovery = await new WorkspaceChangeRecoveryRuntime({ stateDir: fixture.stateDir }).evaluate({
      revisionId,
      workspaceRoot: fixture.workspaceRoot,
      files: snapshot.files,
    });

    expect(recovery).toEqual({ recoveryGuarantee: "exact", checkpointId: revisionId });
  });

  it("downgrades mixed or unknown changes to detect-only and never infers a managed worktree", async () => {
    const fixture = await createFixture("belldandy-change-recovery-detect-only-");
    const file = path.join(fixture.workspaceRoot, "note.txt");
    await fs.writeFile(file, "before\n", "utf-8");
    const snapshots = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await snapshots.captureBaseline({
      baselineId: "recovery-detect-baseline",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    const revisions = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
    const revisionId = "run-recovery-detect";
    const targets = [{ absolutePath: file, relativePath: "note.txt" }];
    await revisions.prepareMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "file_write", targets });
    await fs.writeFile(file, "agent change\n", "utf-8");
    await revisions.commitMutations({ revisionId, workspaceRoot: fixture.workspaceRoot, toolName: "file_write", targets });
    await fs.writeFile(path.join(fixture.workspaceRoot, "shell-output.txt"), "external change\n", "utf-8");
    const snapshot = await snapshots.createSnapshot({ baselineId: baseline.baselineId });
    const runtime = new WorkspaceChangeRecoveryRuntime({ stateDir: fixture.stateDir });

    await expect(runtime.evaluate({
      revisionId,
      workspaceRoot: fixture.workspaceRoot,
      files: snapshot.files,
    })).resolves.toEqual({ recoveryGuarantee: "detect_only", reason: "checkpoint_partial" });
    await expect(runtime.evaluate({
      revisionId: "run-without-checkpoint",
      workspaceRoot: fixture.workspaceRoot,
      files: snapshot.files,
    })).resolves.toEqual({ recoveryGuarantee: "detect_only", reason: "checkpoint_missing" });
    const otherWorkspace = path.join(path.dirname(fixture.workspaceRoot), "other-workspace");
    await fs.mkdir(otherWorkspace, { recursive: true });
    await expect(runtime.evaluate({
      revisionId,
      workspaceRoot: otherWorkspace,
      files: snapshot.files,
    })).resolves.toEqual({ recoveryGuarantee: "detect_only", reason: "checkpoint_missing" });
    await expect(runtime.evaluate({
      revisionId,
      workspaceRoot: fixture.workspaceRoot,
      files: snapshot.files,
      managedWorktreeId: "managed-worktree-1",
    })).resolves.toEqual({ recoveryGuarantee: "managed_worktree", worktreeId: "managed-worktree-1" });
  });

  it("requires a checkpoint to cover both sides of a rename before reporting exact recovery", () => {
    expect(resolveWorkspaceChangeRecovery({
      files: [{ path: "renamed.txt", previousPath: "note.txt" }],
      candidate: { checkpoint: { checkpointId: "rename-checkpoint-1", changedPaths: ["renamed.txt"] } },
    })).toEqual({ recoveryGuarantee: "detect_only", reason: "checkpoint_partial" });
  });
});
