import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { ManagedWorktreeRuntime } from "./managed-worktree.js";

const execFile = promisify(execFileCallback);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
    },
  });
  return String(stdout ?? "").trim();
}

async function createGitFixture(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const repoDir = path.join(rootDir, "repo");
  const nestedDir = path.join(repoDir, "packages", "demo");
  const stateDir = path.join(rootDir, "state");
  await fs.mkdir(nestedDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "README.md"), "demo repo\n", "utf-8");
  await fs.writeFile(path.join(nestedDir, "index.ts"), "export const demo = true;\n", "utf-8");
  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "Belldandy Test"], repoDir);
  await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", "init"], repoDir);
  return { rootDir, repoDir, nestedDir, stateDir };
}

describe("ManagedWorktreeRuntime", () => {
  it("creates a workflow worktree for a clean source, exports tracked and untracked artifacts, then cleans it", async () => {
    const fixture = await createGitFixture("belldandy-managed-worktree-");
    try {
      const runtime = new ManagedWorktreeRuntime(fixture.stateDir);
      const prepared = await runtime.prepare({
        id: "workflow-call-1",
        ownerKind: "workflow_call",
        cwd: fixture.nestedDir,
      });

      expect(prepared.status).toBe("created");
      expect(prepared.resolvedCwd).toContain(path.join("workflow-call-1", "packages", "demo"));
      expect(path.resolve(await runGit(["rev-parse", "--show-toplevel"], String(prepared.resolvedCwd))))
        .toBe(path.resolve(String(prepared.worktreePath)));

      await fs.writeFile(path.join(String(prepared.resolvedCwd), "index.ts"), "export const demo = false;\n", "utf-8");
      await fs.writeFile(path.join(String(prepared.resolvedCwd), "generated.txt"), "generated artifact\n", "utf-8");

      const artifact = await runtime.collectArtifact(prepared);
      expect(artifact.status).toBe("complete");
      expect(artifact.patchPath).toBeDefined();
      expect(await fs.readFile(String(artifact.patchPath), "utf-8")).toContain("demo = false");
      expect(artifact.trackedChanges).toEqual(["packages/demo/index.ts"]);
      expect(artifact.untrackedFiles).toEqual([
        expect.objectContaining({ path: "packages/demo/generated.txt", status: "backed_up" }),
      ]);
      await expect(fs.readFile(path.join(String(artifact.backupRoot), "packages", "demo", "generated.txt"), "utf-8"))
        .resolves.toBe("generated artifact\n");
      await expect(fs.readFile(path.join(fixture.nestedDir, "index.ts"), "utf-8")).resolves.toBe("export const demo = true;\n");

      const cleaned = await runtime.cleanup(prepared, artifact);
      expect(cleaned.status).toBe("removed");
      await expect(fs.access(String(prepared.worktreePath))).rejects.toThrow();
      expect(await runGit(["branch", "--list", String(prepared.branch)], fixture.repoDir)).toBe("");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("rejects dirty source repositories before creating a worktree", async () => {
    const fixture = await createGitFixture("belldandy-managed-worktree-dirty-");
    try {
      await fs.writeFile(path.join(fixture.repoDir, "README.md"), "dirty\n", "utf-8");
      const runtime = new ManagedWorktreeRuntime(fixture.stateDir);

      await expect(runtime.prepare({
        id: "workflow-dirty",
        ownerKind: "workflow_call",
        cwd: fixture.nestedDir,
      })).rejects.toThrow(/clean source repository/i);
      await expect(fs.access(path.join(fixture.stateDir, "subtasks", "worktrees", "workflow-dirty"))).rejects.toThrow();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("keeps user worktrees and workflow worktrees with incomplete artifacts", async () => {
    const fixture = await createGitFixture("belldandy-managed-worktree-retention-");
    try {
      const runtime = new ManagedWorktreeRuntime(fixture.stateDir);
      const userWorktree = await runtime.prepare({
        id: "user-session-1",
        ownerKind: "user_session",
        cwd: fixture.nestedDir,
      });
      const userArtifact = await runtime.collectArtifact(userWorktree);
      const userCleanup = await runtime.cleanup(userWorktree, userArtifact);
      expect(userCleanup).toMatchObject({ status: "retained", reason: expect.stringMatching(/user_session/i) });
      await expect(fs.access(String(userWorktree.worktreePath))).resolves.toBeUndefined();

      const workflowWorktree = await runtime.prepare({
        id: "workflow-incomplete",
        ownerKind: "workflow_call",
        cwd: fixture.nestedDir,
      });
      const workflowCleanup = await runtime.cleanup(workflowWorktree, {
        status: "incomplete",
        worktreeId: workflowWorktree.id,
        ownerKind: workflowWorktree.ownerKind,
        artifactRoot: path.join(fixture.stateDir, "unused-artifact"),
        trackedChanges: [],
        untrackedFiles: [],
        error: "backup failed",
      });
      expect(workflowCleanup).toMatchObject({ status: "retained", reason: expect.stringMatching(/artifact/i) });
      await expect(fs.access(String(workflowWorktree.worktreePath))).resolves.toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("only discards a clean, unchanged worktree after an ownership persistence failure", async () => {
    const fixture = await createGitFixture("belldandy-managed-worktree-abort-");
    try {
      const runtime = new ManagedWorktreeRuntime(fixture.stateDir);
      const clean = await runtime.prepare({
        id: "user-clean-abort",
        ownerKind: "user_session",
        cwd: fixture.nestedDir,
      });
      await expect(runtime.abortPreparedWorktree(clean)).resolves.toMatchObject({ status: "removed" });
      await expect(fs.access(clean.worktreePath)).rejects.toThrow();

      const changed = await runtime.prepare({
        id: "user-changed-abort",
        ownerKind: "user_session",
        cwd: fixture.nestedDir,
      });
      await fs.writeFile(path.join(changed.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      await expect(runtime.abortPreparedWorktree(changed)).resolves.toMatchObject({
        status: "retained",
        reason: expect.stringMatching(/changed before ownership/i),
      });
      await expect(fs.access(changed.worktreePath)).resolves.toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("retains workflow worktrees when their checked-out branch drifts or enters a merge conflict", async () => {
    const fixture = await createGitFixture("belldandy-managed-worktree-conflict-");
    try {
      const runtime = new ManagedWorktreeRuntime(fixture.stateDir);
      const drifted = await runtime.prepare({
        id: "workflow-drifted",
        ownerKind: "workflow_call",
        cwd: fixture.nestedDir,
      });
      await runGit(["checkout", "--detach"], String(drifted.worktreePath));
      expect(await runtime.reconcile(drifted)).toMatchObject({ status: "failed", error: expect.stringMatching(/branch drifted/i) });
      const driftArtifact = await runtime.collectArtifact(drifted);
      expect(await runtime.cleanup(drifted, driftArtifact))
        .toMatchObject({ status: "retained", reason: expect.stringMatching(/branch drift/i) });
      await expect(fs.access(String(drifted.worktreePath))).resolves.toBeUndefined();

      const conflicted = await runtime.prepare({
        id: "workflow-conflicted",
        ownerKind: "workflow_call",
        cwd: fixture.nestedDir,
      });
      await fs.writeFile(path.join(String(conflicted.worktreePath), "README.md"), "worktree change\n", "utf-8");
      await runGit(["add", "README.md"], String(conflicted.worktreePath));
      await runGit(["commit", "-m", "worktree change"], String(conflicted.worktreePath));
      const sourceBranch = await runGit(["branch", "--show-current"], fixture.repoDir);
      await fs.writeFile(path.join(fixture.repoDir, "README.md"), "source change\n", "utf-8");
      await runGit(["add", "README.md"], fixture.repoDir);
      await runGit(["commit", "-m", "source change"], fixture.repoDir);
      await expect(runGit(["merge", sourceBranch], String(conflicted.worktreePath))).rejects.toThrow();

      const conflictArtifact = await runtime.collectArtifact(conflicted);
      expect(await runtime.cleanup(conflicted, conflictArtifact))
        .toMatchObject({ status: "retained", reason: expect.stringMatching(/unresolved merge conflicts/i) });
      await expect(fs.access(String(conflicted.worktreePath))).resolves.toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);
});
