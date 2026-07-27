import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { ManagedWorktreeRuntime } from "./managed-worktree.js";
import { UserWorktreeRuntime } from "./user-worktree-runtime.js";

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

async function createRegisteredUserWorktree(fixture: Awaited<ReturnType<typeof createGitFixture>>, id: string) {
  const managed = new ManagedWorktreeRuntime(fixture.stateDir);
  const worktree = await managed.prepare({ id, ownerKind: "user_session", cwd: fixture.nestedDir });
  const users = new UserWorktreeRuntime(fixture.stateDir);
  await users.register(worktree, { conversationId: "conversation-1", runId: "run-1" });
  return { worktree, users };
}

describe("UserWorktreeRuntime", () => {
  it("projects trusted user worktree ownership and clean Git state without mutating the worktree", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-status-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-status-1");

      await expect(users.listStatus()).resolves.toEqual([
        expect.objectContaining({
          worktreeId: "user-status-1",
          owner: { conversationId: "conversation-1", runId: "run-1" },
          worktreePath: worktree.worktreePath,
          repoRoot: fixture.repoDir,
          baseCommit: worktree.baseRef,
          currentCommit: worktree.baseRef,
          branch: worktree.branch,
          dirty: false,
          trackedChanges: 0,
          untrackedChanges: 0,
          conflictChanges: 0,
          extraCommitCount: 0,
          status: "ready",
          blockers: [],
          retention: expect.objectContaining({ status: "retained" }),
        }),
      ]);
      await expect(fs.readFile(path.join(worktree.resolvedCwd, "index.ts"), "utf-8"))
        .resolves.toSatisfy((content) => content.replace(/\r\n/g, "\n") === "export const demo = true;\n");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("stops the future apply/remove path on dirty changes and commits beyond the base", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-blocked-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-status-2");
      const filePath = path.join(worktree.resolvedCwd, "index.ts");
      await fs.writeFile(filePath, "export const demo = false;\n", "utf-8");
      await expect(users.getStatus(worktree.id)).resolves.toMatchObject({
        status: "blocked",
        dirty: true,
        blockers: ["uncommitted_changes"],
      });

      await runGit(["add", "packages/demo/index.ts"], worktree.worktreePath);
      await runGit(["commit", "-m", "worktree change"], worktree.worktreePath);
      await expect(users.getStatus(worktree.id)).resolves.toMatchObject({
        status: "blocked",
        dirty: false,
        extraCommitCount: 1,
        blockers: ["extra_commits"],
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("counts a Git rename once in its dirty state", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-rename-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-status-rename");
      await fs.rename(
        path.join(worktree.resolvedCwd, "index.ts"),
        path.join(worktree.resolvedCwd, "renamed.ts"),
      );
      await runGit(["add", "-A"], worktree.worktreePath);

      await expect(users.getStatus(worktree.id)).resolves.toMatchObject({
        status: "blocked",
        dirty: true,
        trackedChanges: 1,
        untrackedChanges: 0,
        conflictChanges: 0,
        blockers: ["uncommitted_changes"],
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("fails closed for invalid persisted state or branch drift", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-invalid-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-status-3");
      await runGit(["checkout", "--detach"], worktree.worktreePath);
      await expect(users.getStatus(worktree.id)).resolves.toMatchObject({
        status: "unavailable",
        blockers: ["worktree_unavailable"],
        error: expect.stringMatching(/branch drifted/i),
      });

      const recordDir = path.join(fixture.stateDir, "worktrees", "user-sessions");
      await fs.writeFile(path.join(recordDir, "invalid.json"), "not json", "utf-8");
      await expect(users.listStatus()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          worktreeId: "invalid",
          status: "unavailable",
          blockers: ["invalid_record"],
          error: "Persisted user worktree record is invalid.",
        }),
      ]));
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("reports unresolved merge conflicts as a blocked state", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-conflict-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-status-4");
      const filePath = path.join(worktree.resolvedCwd, "index.ts");
      await fs.writeFile(filePath, "export const demo = false;\n", "utf-8");
      await runGit(["add", "packages/demo/index.ts"], worktree.worktreePath);
      await runGit(["commit", "-m", "worktree change"], worktree.worktreePath);

      const sourceBranch = await runGit(["branch", "--show-current"], fixture.repoDir);
      await fs.writeFile(path.join(fixture.nestedDir, "index.ts"), "export const demo = \"source\";\n", "utf-8");
      await runGit(["add", "packages/demo/index.ts"], fixture.repoDir);
      await runGit(["commit", "-m", "source change"], fixture.repoDir);
      await expect(runGit(["merge", sourceBranch], worktree.worktreePath)).rejects.toThrow();

      await expect(users.getStatus(worktree.id)).resolves.toMatchObject({
        status: "blocked",
        dirty: true,
        conflictChanges: 1,
        blockers: expect.arrayContaining(["unresolved_conflicts", "extra_commits"]),
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("previews a tracked apply without touching the source and applies only after an explicit confirmation", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-apply-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-apply-1");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");

      const preview = await users.preview({ operation: "apply", worktreeId: worktree.id });
      expect(preview).toMatchObject({
        operation: "apply",
        worktreeId: worktree.id,
        canConfirm: true,
        target: { repoRoot: fixture.repoDir, head: worktree.baseRef },
        patch: { sha256: expect.any(String), byteLength: expect.any(Number) },
        receipt: { receiptId: expect.any(String), expiresAtMs: expect.any(Number) },
      });
      await expect(fs.readFile(path.join(fixture.nestedDir, "index.ts"), "utf-8"))
        .resolves.toBe("export const demo = true;\n");

      const result = await users.confirm({
        operation: "apply",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(result).toMatchObject({ operation: "apply", applied: true, canConfirm: true });
      await expect(fs.readFile(path.join(fixture.nestedDir, "index.ts"), "utf-8"))
        .resolves.toSatisfy((content) => content.replace(/\r\n/g, "\n") === "export const demo = false;\n");
      await expect(fs.access(worktree.worktreePath)).resolves.toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("consumes an apply receipt and fails closed when the source target changes before the final gate", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-apply-drift-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-apply-2");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      const preview = await users.preview({ operation: "apply", worktreeId: worktree.id });
      expect(preview.canConfirm).toBe(true);

      await fs.writeFile(path.join(fixture.nestedDir, "index.ts"), "export const demo = \"target drift\";\n", "utf-8");
      const result = await users.confirm({
        operation: "apply",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(result).toMatchObject({
        operation: "apply",
        applied: false,
        canConfirm: false,
        blockers: expect.arrayContaining(["target_dirty"]),
        evidence: { artifactId: expect.any(String) },
      });
      await expect(fs.access(worktree.worktreePath)).resolves.toBeUndefined();
      await expect(fs.readFile(path.join(fixture.nestedDir, "index.ts"), "utf-8"))
        .resolves.toBe("export const demo = \"target drift\";\n");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("refuses an expired operation receipt without touching the worktree or source", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-expired-receipt-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-receipt-expired");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      const preview = await users.preview({ operation: "apply", worktreeId: worktree.id });
      const receiptId = preview.receipt?.receiptId ?? "";
      const receiptPath = path.join(
        fixture.stateDir,
        "worktrees",
        "user-session-operations",
        "receipts",
        `${receiptId}.json`,
      );
      const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8")) as Record<string, unknown>;
      receipt.expiresAtMs = 0;
      await fs.writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf-8");

      await expect(users.confirm({ operation: "apply", worktreeId: worktree.id, receiptId, confirm: true }))
        .resolves.toMatchObject({
          applied: false,
          canConfirm: false,
          blockers: ["receipt_expired"],
        });
      await expect(fs.readFile(path.join(fixture.nestedDir, "index.ts"), "utf-8"))
        .resolves.toBe("export const demo = true;\n");
      await expect(fs.access(worktree.worktreePath)).resolves.toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("fails closed for a symlink boundary without requiring host symlink privileges", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-symlink-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-symlink-boundary");
      const blobId = await runGit(["hash-object", "-w", "README.md"], worktree.worktreePath);
      await runGit(
        ["update-index", "--add", "--cacheinfo", `120000,${blobId},virtual-link`],
        worktree.worktreePath,
      );

      await expect(users.preview({ operation: "apply", worktreeId: worktree.id })).resolves.toMatchObject({
        canConfirm: false,
        blockers: ["symlink_boundary"],
        evidence: { artifactId: expect.any(String) },
      });
      await expect(fs.readFile(path.join(fixture.nestedDir, "index.ts"), "utf-8"))
        .resolves.toBe("export const demo = true;\n");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("previews removal without deleting and rechecks dirty state before explicit removal", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-remove-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-remove-1");
      const preview = await users.preview({ operation: "remove", worktreeId: worktree.id });
      expect(preview).toMatchObject({
        operation: "remove",
        canConfirm: true,
        receipt: { receiptId: expect.any(String) },
      });
      await expect(fs.access(worktree.worktreePath)).resolves.toBeUndefined();

      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      const blocked = await users.confirm({
        operation: "remove",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(blocked).toMatchObject({
        operation: "remove",
        applied: false,
        canConfirm: false,
        blockers: expect.arrayContaining(["uncommitted_changes"]),
      });
      await expect(fs.access(worktree.worktreePath)).resolves.toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("removes only a clean, base-aligned worktree after explicit confirmation", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-remove-success-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-remove-2");
      const preview = await users.preview({ operation: "remove", worktreeId: worktree.id });
      const result = await users.confirm({
        operation: "remove",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });

      expect(result).toMatchObject({ operation: "remove", applied: true, canConfirm: true });
      await expect(fs.access(worktree.worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(runGit(["branch", "--list", worktree.branch], fixture.repoDir)).resolves.toBe("");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("previews staging without changing the index and stages only after a matching explicit receipt", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-stage-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-stage-1");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");

      const preview = await users.preview({ operation: "stage", worktreeId: worktree.id });
      expect(preview).toMatchObject({
        operation: "stage",
        canConfirm: true,
        patch: { sha256: expect.any(String), byteLength: expect.any(Number) },
        staged: { indexTree: expect.any(String), changedPathCount: 1 },
        receipt: { receiptId: expect.any(String) },
      });
      await expect(runGit(["diff", "--cached", "--name-only"], worktree.worktreePath)).resolves.toBe("");

      const result = await users.confirm({
        operation: "stage",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(result).toMatchObject({ operation: "stage", applied: true, canConfirm: true });
      await expect(runGit(["diff", "--cached", "--name-only"], worktree.worktreePath))
        .resolves.toBe("packages/demo/index.ts");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("fails closed when a stage receipt no longer matches the worktree patch", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-stage-drift-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-stage-2");
      const filePath = path.join(worktree.resolvedCwd, "index.ts");
      await fs.writeFile(filePath, "export const demo = false;\n", "utf-8");
      const preview = await users.preview({ operation: "stage", worktreeId: worktree.id });
      await fs.writeFile(filePath, "export const demo = \"drift\";\n", "utf-8");

      await expect(users.confirm({
        operation: "stage",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        applied: false,
        canConfirm: false,
        blockers: ["receipt_stale"],
      });
      await expect(runGit(["diff", "--cached", "--name-only"], worktree.worktreePath)).resolves.toBe("");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("commits only the previewed staged diff and records a local audit artifact", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-commit-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-commit-1");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      const stage = await users.preview({ operation: "stage", worktreeId: worktree.id });
      await users.confirm({ operation: "stage", worktreeId: worktree.id, receiptId: stage.receipt?.receiptId ?? "", confirm: true });

      const preview = await users.preview({
        operation: "commit",
        worktreeId: worktree.id,
        commitMessage: "feat: stage a managed worktree change",
      });
      expect(preview).toMatchObject({
        operation: "commit",
        canConfirm: true,
        patch: { sha256: expect.any(String) },
        staged: { indexTree: expect.any(String), changedPathCount: 1 },
        commit: {
          message: "feat: stage a managed worktree change",
          messageHash: expect.any(String),
        },
        receipt: { receiptId: expect.any(String) },
      });
      await expect(runGit(["rev-parse", "HEAD"], worktree.worktreePath)).resolves.toBe(worktree.baseRef);

      const result = await users.confirm({
        operation: "commit",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(result).toMatchObject({
        operation: "commit",
        applied: true,
        audit: { artifactId: expect.any(String), commit: expect.any(String) },
      });
      await expect(runGit(["log", "-1", "--format=%s"], worktree.worktreePath))
        .resolves.toBe("feat: stage a managed worktree change");
      await expect(runGit(["rev-parse", "HEAD^"], worktree.worktreePath)).resolves.toBe(worktree.baseRef);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("fails closed when a commit receipt no longer matches the staged diff", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-commit-drift-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-commit-2");
      const filePath = path.join(worktree.resolvedCwd, "index.ts");
      await fs.writeFile(filePath, "export const demo = false;\n", "utf-8");
      const stage = await users.preview({ operation: "stage", worktreeId: worktree.id });
      await users.confirm({ operation: "stage", worktreeId: worktree.id, receiptId: stage.receipt?.receiptId ?? "", confirm: true });
      const preview = await users.preview({ operation: "commit", worktreeId: worktree.id, commitMessage: "feat: first" });
      await fs.writeFile(filePath, "export const demo = \"different staged diff\";\n", "utf-8");
      await runGit(["add", "-u", "--"], worktree.worktreePath);

      await expect(users.confirm({
        operation: "commit",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        applied: false,
        canConfirm: false,
        blockers: ["receipt_stale"],
      });
      await expect(runGit(["rev-parse", "HEAD"], worktree.worktreePath)).resolves.toBe(worktree.baseRef);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("refuses controlled commits when a local hook could change the previewed result", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-commit-hook-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-commit-hook");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      const stage = await users.preview({ operation: "stage", worktreeId: worktree.id });
      await users.confirm({ operation: "stage", worktreeId: worktree.id, receiptId: stage.receipt?.receiptId ?? "", confirm: true });
      const rawHookPath = await runGit(["rev-parse", "--git-path", "hooks/pre-commit"], worktree.worktreePath);
      const hookPath = path.isAbsolute(rawHookPath) ? rawHookPath : path.resolve(worktree.worktreePath, rawHookPath);
      await fs.mkdir(path.dirname(hookPath), { recursive: true });
      await fs.writeFile(hookPath, "exit 0\n", "utf-8");

      await expect(users.preview({
        operation: "commit",
        worktreeId: worktree.id,
        commitMessage: "feat: blocked by hook",
      })).resolves.toMatchObject({
        canConfirm: false,
        blockers: ["commit_hooks_present"],
        evidence: { artifactId: expect.any(String) },
      });
      await expect(runGit(["rev-parse", "HEAD"], worktree.worktreePath)).resolves.toBe(worktree.baseRef);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("publishes a confirmed commit to a new local branch without renaming the managed branch", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-branch-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-branch-1");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      const stage = await users.preview({ operation: "stage", worktreeId: worktree.id });
      await users.confirm({ operation: "stage", worktreeId: worktree.id, receiptId: stage.receipt?.receiptId ?? "", confirm: true });
      const commit = await users.preview({ operation: "commit", worktreeId: worktree.id, commitMessage: "feat: branch publish" });
      const committed = await users.confirm({ operation: "commit", worktreeId: worktree.id, receiptId: commit.receipt?.receiptId ?? "", confirm: true });
      const commitHash = committed.audit?.commit ?? "";

      const preview = await users.preview({
        operation: "branch",
        worktreeId: worktree.id,
        branchName: "feature/managed-delivery",
      });
      expect(preview).toMatchObject({
        operation: "branch",
        canConfirm: true,
        publish: {
          sourceBranch: worktree.branch,
          targetBranch: "feature/managed-delivery",
          commit: commitHash,
        },
        receipt: { receiptId: expect.any(String) },
      });
      await expect(runGit(["branch", "--list", "feature/managed-delivery"], fixture.repoDir)).resolves.toBe("");

      const result = await users.confirm({
        operation: "branch",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(result).toMatchObject({
        operation: "branch",
        applied: true,
        audit: { artifactId: expect.any(String), commit: commitHash },
      });
      await expect(runGit(["rev-parse", "refs/heads/feature/managed-delivery"], fixture.repoDir)).resolves.toBe(commitHash);
      await expect(runGit(["branch", "--show-current"], worktree.worktreePath)).resolves.toBe(worktree.branch);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);

  it("rejects invalid or existing local branch names without updating a ref", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-branch-invalid-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-branch-2");
      await fs.writeFile(path.join(worktree.resolvedCwd, "index.ts"), "export const demo = false;\n", "utf-8");
      await runGit(["add", "-u", "--"], worktree.worktreePath);
      await runGit(["commit", "-m", "worktree commit"], worktree.worktreePath);
      await runGit(["branch", "feature/existing", worktree.baseRef], fixture.repoDir);

      await expect(users.preview({ operation: "branch", worktreeId: worktree.id, branchName: "../unsafe" }))
        .resolves.toMatchObject({ canConfirm: false, blockers: ["invalid_branch_name"] });
      await expect(users.preview({ operation: "branch", worktreeId: worktree.id, branchName: "feature/existing" }))
        .resolves.toMatchObject({ canConfirm: false, blockers: ["branch_exists"] });
      await expect(runGit(["rev-parse", "refs/heads/feature/existing"], fixture.repoDir)).resolves.toBe(worktree.baseRef);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("fails closed when the managed commit changes after branch preview", async () => {
    const fixture = await createGitFixture("belldandy-user-worktree-branch-drift-");
    try {
      const { worktree, users } = await createRegisteredUserWorktree(fixture, "user-branch-3");
      const filePath = path.join(worktree.resolvedCwd, "index.ts");
      await fs.writeFile(filePath, "export const demo = false;\n", "utf-8");
      await runGit(["add", "-u", "--"], worktree.worktreePath);
      await runGit(["commit", "-m", "first commit"], worktree.worktreePath);
      const preview = await users.preview({ operation: "branch", worktreeId: worktree.id, branchName: "feature/stale" });

      await fs.writeFile(filePath, "export const demo = \"second\";\n", "utf-8");
      await runGit(["add", "-u", "--"], worktree.worktreePath);
      await runGit(["commit", "-m", "second commit"], worktree.worktreePath);
      await expect(users.confirm({
        operation: "branch",
        worktreeId: worktree.id,
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({ applied: false, canConfirm: false, blockers: ["receipt_stale"] });
      await expect(runGit(["branch", "--list", "feature/stale"], fixture.repoDir)).resolves.toBe("");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 25_000);
});
