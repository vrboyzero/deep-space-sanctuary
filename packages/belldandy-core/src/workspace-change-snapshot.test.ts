import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  runWorkspaceSnapshotGitCommand,
  WorkspaceChangeSnapshotRuntime,
} from "./workspace-change-snapshot.js";

const temporaryDirectories: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

async function createFixture(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(rootDir);
  const workspaceRoot = path.join(rootDir, "workspace");
  const stateDir = path.join(rootDir, "state");
  await fs.mkdir(workspaceRoot, { recursive: true });
  return { rootDir, workspaceRoot, stateDir };
}

describe("WorkspaceChangeSnapshotRuntime", () => {
  it("retries one ENOTCONN Git pipe read without losing stdout", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-enotconn-");
    let attempts = 0;
    const execFileProcess = (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
    ) => {
      attempts += 1;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdout,
        stderr,
        kill: () => true,
      }) as unknown as ChildProcess;
      queueMicrotask(() => {
        if (attempts === 1) {
          stdout.emit("error", Object.assign(new Error("read ENOTCONN"), {
            code: "ENOTCONN",
            syscall: "read",
          }));
          return;
        }
        callback(null, Buffer.from("fixture-root\n"), Buffer.alloc(0));
      });
      return child;
    };

    await expect(runWorkspaceSnapshotGitCommand({
      args: ["rev-parse", "--show-toplevel"],
      cwd: fixture.workspaceRoot,
      maxBuffer: 64 * 1024,
    }, execFileProcess)).resolves.toBe("fixture-root\n");
    expect(attempts).toBe(2);
  });

  it("fails closed when the retried Git pipe also reports ENOTCONN", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-enotconn-repeat-");
    let attempts = 0;
    const execFileProcess = () => {
      attempts += 1;
      const stdout = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdout,
        stderr: new PassThrough(),
        kill: () => true,
      }) as unknown as ChildProcess;
      queueMicrotask(() => {
        stdout.emit("error", Object.assign(new Error("read ENOTCONN"), {
          code: "ENOTCONN",
          syscall: "read",
        }));
      });
      return child;
    };

    await expect(runWorkspaceSnapshotGitCommand({
      args: ["rev-parse", "--show-toplevel"],
      cwd: fixture.workspaceRoot,
      maxBuffer: 64 * 1024,
    }, execFileProcess)).rejects.toMatchObject({ code: "ENOTCONN", syscall: "read" });
    expect(attempts).toBe(2);
  });

  it("creates a hash-bound run-start snapshot and durable artifacts for a non-Git workspace", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-filesystem-");
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "before\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });

    const baseline = await runtime.captureBaseline({
      baselineId: "run-filesystem-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "after\n", "utf-8");
    const snapshot = await runtime.createSnapshot({
      baselineId: baseline.baselineId,
      revisionId: "run-filesystem-1",
    });
    const page = await runtime.readSnapshotPage({ snapshotId: snapshot.snapshotId });
    const persisted = await runtime.readSnapshot({ snapshotId: snapshot.snapshotId });

    expect(baseline).toMatchObject({
      baselineId: "run-filesystem-1",
      source: "run_start",
      repository: "filesystem",
      coverage: { complete: true, fileCount: 1 },
    });
    expect(snapshot).toMatchObject({
      baseline: { baselineId: baseline.baselineId, hash: baseline.hash },
      files: [{ path: "note.txt", status: "modified", binary: false, diffAvailable: true }],
      truncated: false,
    });
    expect(snapshot.currentHash).not.toBe(baseline.hash);
    expect(snapshot.diffHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(snapshot.recovery).toEqual({ recoveryGuarantee: "detect_only", reason: "checkpoint_missing" });
    expect(snapshot.revisionId).toBe("run-filesystem-1");
    expect(persisted.revisionId).toBe("run-filesystem-1");
    expect(page).toMatchObject({
      snapshotId: snapshot.snapshotId,
      diffHash: snapshot.diffHash,
    });
    expect(page).not.toHaveProperty("nextCursor");
    expect(page.hunks).toHaveLength(1);
    expect(page.hunks[0]?.patch).toContain("-before");
    expect(page.hunks[0]?.patch).toContain("+after");
    await expect(fs.readFile(snapshot.artifacts.summaryPath, "utf-8")).resolves.toContain(snapshot.diffHash);
    await expect(fs.readFile(snapshot.artifacts.patchPath, "utf-8")).resolves.toContain("diff --git a/note.txt b/note.txt");
  });

  it("projects a unique bounded text near-rename with its similarity and content hunk", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-near-rename-");
    const previousPath = path.join(fixture.workspaceRoot, "docs", "guide.txt");
    const nextPath = path.join(fixture.workspaceRoot, "docs", "guide-v2.txt");
    await fs.mkdir(path.dirname(previousPath), { recursive: true });
    await fs.writeFile(previousPath, "alpha\nbeta\ngamma\ndelta\nepsilon\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "near-rename-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.rm(previousPath);
    await fs.writeFile(nextPath, "alpha\nbeta\ngamma\ndelta\nzeta\n", "utf-8");

    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });
    const page = await runtime.readSnapshotPage({ snapshotId: snapshot.snapshotId });

    expect(snapshot.files).toEqual([expect.objectContaining({
      path: "docs/guide-v2.txt",
      previousPath: "docs/guide.txt",
      status: "renamed",
      renameSimilarity: 0.8,
      diffAvailable: true,
    })]);
    expect(page.hunks).toEqual([expect.objectContaining({
      path: "docs/guide-v2.txt",
      previousPath: "docs/guide.txt",
      patch: expect.stringContaining("-epsilon"),
    })]);
    expect(page.hunks[0]?.patch).toContain("+zeta");
  });

  it("keeps low-similarity text moves as separate deletion and addition", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-low-similarity-rename-");
    const previousPath = path.join(fixture.workspaceRoot, "docs", "guide.txt");
    const nextPath = path.join(fixture.workspaceRoot, "docs", "guide-v2.txt");
    await fs.mkdir(path.dirname(previousPath), { recursive: true });
    await fs.writeFile(previousPath, "alpha\nbeta\ngamma\ndelta\nepsilon\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "low-similarity-rename-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.rm(previousPath);
    await fs.writeFile(nextPath, "alpha\nbeta\nzeta\neta\ntheta\n", "utf-8");

    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });

    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "docs/guide.txt", status: "deleted" }),
      expect.objectContaining({ path: "docs/guide-v2.txt", status: "added" }),
    ]));
    expect(snapshot.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "renamed" }),
    ]));
  });

  it("keeps an ambiguous near-rename as separate additions and deletions", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-ambiguous-rename-");
    const firstPath = path.join(fixture.workspaceRoot, "docs", "first.txt");
    const secondPath = path.join(fixture.workspaceRoot, "docs", "second.txt");
    const nextPath = path.join(fixture.workspaceRoot, "docs", "guide-v2.txt");
    const source = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
    await fs.mkdir(path.dirname(firstPath), { recursive: true });
    await Promise.all([fs.writeFile(firstPath, source, "utf-8"), fs.writeFile(secondPath, source, "utf-8")]);
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "ambiguous-rename-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await Promise.all([fs.rm(firstPath), fs.rm(secondPath)]);
    await fs.writeFile(nextPath, "alpha\nbeta\ngamma\ndelta\nzeta\n", "utf-8");

    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });

    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "docs/first.txt", status: "deleted" }),
      expect.objectContaining({ path: "docs/second.txt", status: "deleted" }),
      expect.objectContaining({ path: "docs/guide-v2.txt", status: "added" }),
    ]));
    expect(snapshot.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "renamed" }),
    ]));
  });

  it("does not use binary content for a near-rename", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-binary-rename-");
    const previousPath = path.join(fixture.workspaceRoot, "data", "before.bin");
    const nextPath = path.join(fixture.workspaceRoot, "data", "after.bin");
    await fs.mkdir(path.dirname(previousPath), { recursive: true });
    await fs.writeFile(previousPath, Buffer.from([0, 1, 2, 3, 4, 5]));
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "binary-rename-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.rm(previousPath);
    await fs.writeFile(nextPath, Buffer.from([0, 1, 2, 3, 4, 6]));

    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });

    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "data/before.bin", status: "deleted", binary: true }),
      expect.objectContaining({ path: "data/after.bin", status: "added", binary: true }),
    ]));
    expect(snapshot.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "renamed" }),
    ]));
  });

  it("persists an exact checkpoint recovery only when the supplied checkpoint covers the snapshot", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-recovery-");
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "before\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "run-recovery-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "after\n", "utf-8");

    const snapshot = await runtime.createSnapshot({
      baselineId: baseline.baselineId,
      recovery: { checkpoint: { checkpointId: "checkpoint-1", changedPaths: ["note.txt"] } },
    });
    const persisted = JSON.parse(await fs.readFile(snapshot.artifacts.summaryPath, "utf-8")) as { recovery?: unknown };

    expect(snapshot.recovery).toEqual({ recoveryGuarantee: "exact", checkpointId: "checkpoint-1" });
    expect(persisted.recovery).toEqual(snapshot.recovery);
  });

  it("loads a legacy snapshot without recovery metadata as detect-only", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-legacy-recovery-");
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "before\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "run-legacy-recovery-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "after\n", "utf-8");
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });
    const persisted = JSON.parse(await fs.readFile(snapshot.artifacts.summaryPath, "utf-8")) as Record<string, unknown>;
    delete persisted.recovery;
    await fs.writeFile(snapshot.artifacts.summaryPath, `${JSON.stringify(persisted)}\n`, "utf-8");

    await expect(runtime.readSnapshot({ snapshotId: snapshot.snapshotId })).resolves.toMatchObject({
      recovery: { recoveryGuarantee: "detect_only", reason: "checkpoint_missing" },
    });
  });

  it("keeps revision linkage optional for old artifacts and rejects an invalid persisted linkage", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-legacy-linkage-");
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "before\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "run-legacy-linkage-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "after\n", "utf-8");
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });
    const persisted = JSON.parse(await fs.readFile(snapshot.artifacts.summaryPath, "utf-8")) as Record<string, unknown>;

    await expect(runtime.readSnapshot({ snapshotId: snapshot.snapshotId })).resolves.not.toHaveProperty("revisionId");
    persisted.revisionId = "../untrusted";
    await fs.writeFile(snapshot.artifacts.summaryPath, `${JSON.stringify(persisted)}\n`, "utf-8");
    await expect(runtime.readSnapshot({ snapshotId: snapshot.snapshotId })).rejects.toThrow("revisionId is invalid");
  });

  it("compares a Git run-start baseline without reclassifying pre-existing dirty state", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-git-");
    await execFile("git", ["init"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.email", "snapshot@example.com"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.name", "Snapshot Test"], { cwd: fixture.workspaceRoot });
    await fs.writeFile(path.join(fixture.workspaceRoot, "tracked.txt"), "committed\n", "utf-8");
    await fs.writeFile(path.join(fixture.workspaceRoot, "user-dirty.txt"), "user\n", "utf-8");
    await fs.writeFile(path.join(fixture.workspaceRoot, "during.txt"), "before run\n", "utf-8");
    await execFile("git", ["add", "tracked.txt", "user-dirty.txt", "during.txt"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["commit", "-m", "initial"], { cwd: fixture.workspaceRoot });
    await fs.writeFile(path.join(fixture.workspaceRoot, "user-dirty.txt"), "user changed before run\n", "utf-8");

    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "run-git-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(path.join(fixture.workspaceRoot, "during.txt"), "changed during run\n", "utf-8");
    await fs.rm(path.join(fixture.workspaceRoot, "tracked.txt"));
    await fs.rename(path.join(fixture.workspaceRoot, "user-dirty.txt"), path.join(fixture.workspaceRoot, "renamed.txt"));
    await fs.writeFile(path.join(fixture.workspaceRoot, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });
    const files = new Map(snapshot.files.map((file) => [file.path, file]));

    expect(baseline.repository).toBe("git");
    expect(files.get("tracked.txt")).toMatchObject({ status: "deleted" });
    expect(files.get("during.txt")).toMatchObject({ status: "modified" });
    expect(files.get("renamed.txt")).toMatchObject({ status: "renamed", previousPath: "user-dirty.txt" });
    expect(files.get("binary.bin")).toMatchObject({ status: "added", binary: true });
    expect(files.has("user-dirty.txt")).toBe(false);
    expect(snapshot.truncated).toBe(false);
    await expect(execFile("git", ["diff", "--cached", "--quiet"], { cwd: fixture.workspaceRoot })).resolves.toBeDefined();
  });

  it("uses a requested Git revision as an immutable diff baseline without changing Git state", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-git-revision-");
    await execFile("git", ["init"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.email", "snapshot@example.com"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.name", "Snapshot Test"], { cwd: fixture.workspaceRoot });
    const tracked = path.join(fixture.workspaceRoot, "tracked.txt");
    await fs.writeFile(tracked, "first revision\n", "utf-8");
    await execFile("git", ["add", "tracked.txt"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["commit", "-m", "first"], { cwd: fixture.workspaceRoot });
    const { stdout: firstRevisionOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: fixture.workspaceRoot });
    const firstRevision = String(firstRevisionOutput).trim();
    await fs.writeFile(tracked, "second revision\n", "utf-8");
    await execFile("git", ["commit", "-am", "second"], { cwd: fixture.workspaceRoot });
    await fs.writeFile(tracked, "working tree change\n", "utf-8");
    await fs.writeFile(path.join(fixture.workspaceRoot, "untracked.txt"), "untracked\n", "utf-8");
    const { stdout: statusBefore } = await execFile("git", ["status", "--porcelain=v1"], { cwd: fixture.workspaceRoot });

    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "git-revision-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "git_revision",
      revision: firstRevision,
    });
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });
    const page = await runtime.readSnapshotPage({ snapshotId: snapshot.snapshotId });
    const { stdout: statusAfter } = await execFile("git", ["status", "--porcelain=v1"], { cwd: fixture.workspaceRoot });

    expect(baseline).toMatchObject({
      source: "git_revision",
      revision: firstRevision,
      repository: "git",
    });
    expect(snapshot).toMatchObject({
      baseline: { source: "git_revision", revision: firstRevision },
      files: expect.arrayContaining([
        expect.objectContaining({ path: "tracked.txt", status: "modified" }),
        expect.objectContaining({ path: "untracked.txt", status: "added" }),
      ]),
    });
    expect(page.hunks.find((hunk) => hunk.path === "tracked.txt")?.patch).toContain("-first revision");
    expect(page.hunks.find((hunk) => hunk.path === "tracked.txt")?.patch).toContain("+working tree change");
    expect(statusAfter).toBe(statusBefore);
    await expect(execFile("git", ["diff", "--cached", "--quiet"], { cwd: fixture.workspaceRoot })).resolves.toBeDefined();
  });

  it("materializes Git HEAD and an explicit worktree base as separate immutable baselines", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-git-baseline-kinds-");
    await execFile("git", ["init"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.email", "snapshot@example.com"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.name", "Snapshot Test"], { cwd: fixture.workspaceRoot });
    const tracked = path.join(fixture.workspaceRoot, "tracked.txt");
    await fs.writeFile(tracked, "worktree base\n", "utf-8");
    await execFile("git", ["add", "tracked.txt"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["commit", "-m", "base"], { cwd: fixture.workspaceRoot });
    const { stdout: baseRevisionOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: fixture.workspaceRoot });
    const baseRevision = String(baseRevisionOutput).trim();
    await fs.writeFile(tracked, "head revision\n", "utf-8");
    await execFile("git", ["commit", "-am", "head"], { cwd: fixture.workspaceRoot });
    const { stdout: headRevisionOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: fixture.workspaceRoot });
    const headRevision = String(headRevisionOutput).trim();
    await fs.writeFile(tracked, "working tree change\n", "utf-8");

    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const headBaseline = await runtime.captureBaseline({
      baselineId: "git-head-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "git_head",
    });
    const worktreeBaseline = await runtime.captureBaseline({
      baselineId: "worktree-base-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "worktree_base",
      revision: baseRevision,
    });
    const headSnapshot = await runtime.createSnapshot({ baselineId: headBaseline.baselineId });
    const worktreeSnapshot = await runtime.createSnapshot({ baselineId: worktreeBaseline.baselineId });
    const headPage = await runtime.readSnapshotPage({ snapshotId: headSnapshot.snapshotId });
    const worktreePage = await runtime.readSnapshotPage({ snapshotId: worktreeSnapshot.snapshotId });
    const rereadWorktreeBaseline = await runtime.readBaseline({ baselineId: worktreeBaseline.baselineId });

    expect(headBaseline).toMatchObject({ source: "git_head", revision: headRevision });
    expect(worktreeBaseline).toMatchObject({ source: "worktree_base", revision: baseRevision });
    expect(rereadWorktreeBaseline).toMatchObject({
      baselineId: worktreeBaseline.baselineId,
      source: "worktree_base",
      revision: baseRevision,
    });
    expect(headPage.hunks.find((hunk) => hunk.path === "tracked.txt")?.patch).toContain("-head revision");
    expect(worktreePage.hunks.find((hunk) => hunk.path === "tracked.txt")?.patch).toContain("-worktree base");
    expect(headSnapshot.diffHash).not.toBe(worktreeSnapshot.diffHash);
  });

  it("limits a Git revision baseline to the requested nested workspace", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-git-nested-");
    await execFile("git", ["init"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.email", "snapshot@example.com"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.name", "Snapshot Test"], { cwd: fixture.workspaceRoot });
    const nestedWorkspace = path.join(fixture.workspaceRoot, "packages", "demo");
    await fs.mkdir(nestedWorkspace, { recursive: true });
    await fs.writeFile(path.join(fixture.workspaceRoot, "root.txt"), "root baseline\n", "utf-8");
    await fs.writeFile(path.join(nestedWorkspace, "index.ts"), "export const value = 1;\n", "utf-8");
    await execFile("git", ["add", "."], { cwd: fixture.workspaceRoot });
    await execFile("git", ["commit", "-m", "initial"], { cwd: fixture.workspaceRoot });
    const { stdout: revisionOutput } = await execFile("git", ["rev-parse", "HEAD"], { cwd: fixture.workspaceRoot });
    await fs.writeFile(path.join(fixture.workspaceRoot, "root.txt"), "root changed outside cwd\n", "utf-8");
    await fs.writeFile(path.join(nestedWorkspace, "index.ts"), "export const value = 2;\n", "utf-8");

    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "git-nested-1",
      workspaceRoot: nestedWorkspace,
      source: "git_revision",
      revision: String(revisionOutput).trim(),
    });
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });

    expect(snapshot.files).toEqual([expect.objectContaining({ path: "index.ts", status: "modified" })]);
  });

  it("does not report a content change when Git HEAD matches the current workspace", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-git-clean-head-");
    await execFile("git", ["init"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.email", "snapshot@example.com"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["config", "user.name", "Snapshot Test"], { cwd: fixture.workspaceRoot });
    await fs.writeFile(path.join(fixture.workspaceRoot, "tracked.txt"), "clean\n", "utf-8");
    await execFile("git", ["add", "tracked.txt"], { cwd: fixture.workspaceRoot });
    await execFile("git", ["commit", "-m", "initial"], { cwd: fixture.workspaceRoot });

    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir });
    const baseline = await runtime.captureBaseline({
      baselineId: "git-clean-head-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "git_head",
    });
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });

    expect(snapshot.files).toEqual([]);
    expect(snapshot.currentHash).toBe(baseline.hash);
  });

  it("serves a stable hunk cursor and rejects a cursor from another snapshot", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-pagination-");
    await fs.writeFile(path.join(fixture.workspaceRoot, "one.txt"), "one before\n", "utf-8");
    await fs.writeFile(path.join(fixture.workspaceRoot, "two.txt"), "two before\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir, maxHunksPerPage: 1 });
    const baseline = await runtime.captureBaseline({
      baselineId: "run-pagination-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(path.join(fixture.workspaceRoot, "one.txt"), "one after\n", "utf-8");
    await fs.writeFile(path.join(fixture.workspaceRoot, "two.txt"), "two after\n", "utf-8");
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });
    const first = await runtime.readSnapshotPage({ snapshotId: snapshot.snapshotId });
    const second = await runtime.readSnapshotPage({ snapshotId: snapshot.snapshotId, cursor: first.nextCursor });

    expect(first.hunks).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.hunks).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(second.diffHash).toBe(first.diffHash);
    await expect(runtime.readSnapshotPage({ snapshotId: snapshot.snapshotId, cursor: "not-a-cursor" }))
      .rejects.toThrow("cursor is invalid");
  });

  it("keeps an oversized file change visible without fabricating a truncated hunk", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-large-");
    await fs.writeFile(path.join(fixture.workspaceRoot, "large.txt"), "before large", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.stateDir, maxFileBytes: 4 });
    const baseline = await runtime.captureBaseline({
      baselineId: "run-large-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    await fs.writeFile(path.join(fixture.workspaceRoot, "large.txt"), "after large", "utf-8");
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });
    const page = await runtime.readSnapshotPage({ snapshotId: snapshot.snapshotId });

    expect(baseline.coverage).toMatchObject({ complete: false, omittedFileCount: 1 });
    expect(snapshot.files).toEqual([expect.objectContaining({
      path: "large.txt",
      status: "modified",
      diffAvailable: false,
      reason: "file_too_large",
    })]);
    expect(snapshot).toMatchObject({ truncated: true, truncationReasons: expect.arrayContaining(["file_too_large"]) });
    expect(page.hunks).toEqual([]);
  });

  it("excludes its own artifact storage when the state directory is inside the workspace", async () => {
    const fixture = await createFixture("belldandy-change-snapshot-self-storage-");
    await fs.writeFile(path.join(fixture.workspaceRoot, "note.txt"), "stable\n", "utf-8");
    const runtime = new WorkspaceChangeSnapshotRuntime({ stateDir: fixture.workspaceRoot });
    const baseline = await runtime.captureBaseline({
      baselineId: "run-self-storage-1",
      workspaceRoot: fixture.workspaceRoot,
      source: "run_start",
    });
    const snapshot = await runtime.createSnapshot({ baselineId: baseline.baselineId });

    expect(snapshot.files).toEqual([]);
    expect(snapshot.currentHash).toBe(baseline.hash);
  });
});
