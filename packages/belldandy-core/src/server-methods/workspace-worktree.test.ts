import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { ConversationRunRegistry } from "../conversation-run-registry.js";
import { ManagedWorktreeRuntime } from "../managed-worktree.js";
import { UserWorktreeRuntime } from "../user-worktree-runtime.js";
import { handleWorkspaceWorktreeMethod } from "./workspace-worktree.js";

const execFile = promisify(execFileCallback);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}

describe("workspace worktree Gateway methods", () => {
  it("lists only registered user worktrees and rejects untrusted lookup fields", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-worktree-method-"));
    try {
      const repoDir = path.join(rootDir, "repo");
      const stateDir = path.join(rootDir, "state");
      await fs.mkdir(repoDir, { recursive: true });
      await fs.writeFile(path.join(repoDir, "README.md"), "demo\n", "utf-8");
      await runGit(["init"], repoDir);
      await runGit(["config", "user.name", "Belldandy Test"], repoDir);
      await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
      await runGit(["add", "."], repoDir);
      await runGit(["commit", "-m", "init"], repoDir);

      const managed = new ManagedWorktreeRuntime(stateDir);
      const worktree = await managed.prepare({ id: "gateway-user-worktree", ownerKind: "user_session", cwd: repoDir });
      const runtime = new UserWorktreeRuntime(stateDir);
      await runtime.register(worktree, { conversationId: "conversation-1", runId: "run-1" });

      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "status", method: "workspace.worktree.status" },
        { runtime },
      )).resolves.toMatchObject({
        ok: true,
        payload: { worktrees: [expect.objectContaining({ worktreeId: worktree.id, status: "ready" })] },
      });
      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "status-one", method: "workspace.worktree.status", params: { worktreeId: worktree.id } },
        { runtime },
      )).resolves.toMatchObject({ ok: true, payload: { worktrees: [expect.objectContaining({ worktreeId: worktree.id })] } });
      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "forged-path", method: "workspace.worktree.status", params: { worktreePath: repoDir } },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "missing", method: "workspace.worktree.status", params: { worktreeId: "missing" } },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "not_found" } });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("creates only under an allowed root with an active exact conversation/run binding", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-worktree-create-"));
    try {
      const repoDir = path.join(rootDir, "repo");
      const stateDir = path.join(rootDir, "state");
      await fs.mkdir(repoDir, { recursive: true });
      await fs.writeFile(path.join(repoDir, "README.md"), "demo\n", "utf-8");
      await runGit(["init"], repoDir);
      await runGit(["config", "user.name", "Belldandy Test"], repoDir);
      await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
      await runGit(["add", "."], repoDir);
      await runGit(["commit", "-m", "init"], repoDir);

      const runtime = new UserWorktreeRuntime(stateDir);
      const runs = new ConversationRunRegistry();
      runs.register({
        conversationId: "conversation-create",
        runId: "run-create",
        startedAt: Date.now(),
        state: "running",
        stop: () => true,
      });
      const context = {
        runtime,
        conversationRunRegistry: runs,
        additionalWorkspaceRoots: [repoDir],
      };
      const created = await handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "create",
          method: "workspace.worktree.create",
          params: { cwd: repoDir, conversationId: "conversation-create", runId: "run-create" },
        },
        context,
      );
      expect(created).toMatchObject({
        ok: true,
        payload: {
          worktree: expect.objectContaining({
            owner: { conversationId: "conversation-create", runId: "run-create" },
            status: "ready",
            branch: expect.stringMatching(/^belldandy-user-/),
          }),
        },
      });
      if (!created.ok || !created.payload) throw new Error("expected user worktree create to succeed");
      const createdWorktree = created.payload.worktree as { worktreePath: string; worktreeId: string };
      await expect(fs.access(createdWorktree.worktreePath)).resolves.toBeUndefined();
      await expect(runtime.getStatus(createdWorktree.worktreeId)).resolves.toMatchObject({ status: "ready" });
      await expect(runGit(["status", "--porcelain=v1"], repoDir)).resolves.toBe("");

      const repeated = await handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "create-repeat",
          method: "workspace.worktree.create",
          params: { cwd: repoDir, conversationId: "conversation-create", runId: "run-create" },
        },
        context,
      );
      expect(repeated).toMatchObject({
        ok: true,
        payload: { worktree: expect.objectContaining({ worktreeId: createdWorktree.worktreeId }) },
      });
      await expect(runtime.listStatus()).resolves.toHaveLength(1);

      await fs.writeFile(path.join(createdWorktree.worktreePath, "README.md"), "worktree change\n", "utf-8");
      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "diff",
          method: "workspace.worktree.diff",
          params: { worktreeId: createdWorktree.worktreeId },
        },
        context,
      )).resolves.toMatchObject({
        ok: true,
        payload: {
          worktree: expect.objectContaining({ worktreeId: createdWorktree.worktreeId, status: "blocked" }),
          snapshot: expect.objectContaining({
            baseline: expect.objectContaining({ source: "worktree_base" }),
            recovery: { recoveryGuarantee: "managed_worktree", worktreeId: createdWorktree.worktreeId },
          }),
          page: expect.objectContaining({ hunks: [expect.objectContaining({ path: "README.md", patch: expect.stringContaining("+worktree change") })] }),
        },
      });
      await expect(runGit(["status", "--porcelain=v1"], repoDir)).resolves.toBe("");

      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "wrong-run",
          method: "workspace.worktree.create",
          params: { cwd: repoDir, conversationId: "conversation-create", runId: "run-other" },
        },
        context,
      )).resolves.toMatchObject({ ok: false, error: { code: "owner_not_active" } });
      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "outside-root",
          method: "workspace.worktree.create",
          params: { cwd: rootDir, conversationId: "conversation-create", runId: "run-create" },
        },
        context,
      )).resolves.toMatchObject({ ok: false, error: { code: "workspace_not_allowed" } });

      await fs.writeFile(path.join(repoDir, "README.md"), "dirty\n", "utf-8");
      runs.register({
        conversationId: "conversation-create",
        runId: "run-dirty-source",
        startedAt: Date.now() + 1,
        state: "running",
        stop: () => true,
      });
      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "dirty-source",
          method: "workspace.worktree.create",
          params: { cwd: repoDir, conversationId: "conversation-create", runId: "run-dirty-source" },
        },
        context,
      )).resolves.toMatchObject({ ok: false, error: { code: "create_failed" } });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("exposes worktree operation previews but requires a receipt and explicit confirmation for writes", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-worktree-operation-method-"));
    try {
      const repoDir = path.join(rootDir, "repo");
      const stateDir = path.join(rootDir, "state");
      await fs.mkdir(repoDir, { recursive: true });
      await fs.writeFile(path.join(repoDir, "README.md"), "demo\n", "utf-8");
      await runGit(["init"], repoDir);
      await runGit(["config", "user.name", "Belldandy Test"], repoDir);
      await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
      await runGit(["add", "."], repoDir);
      await runGit(["commit", "-m", "init"], repoDir);

      const managed = new ManagedWorktreeRuntime(stateDir);
      const worktree = await managed.prepare({ id: "gateway-user-worktree-operation", ownerKind: "user_session", cwd: repoDir });
      const runtime = new UserWorktreeRuntime(stateDir);
      await runtime.register(worktree, { conversationId: "conversation-1", runId: "run-1" });
      await fs.writeFile(path.join(worktree.worktreePath, "README.md"), "worktree change\n", "utf-8");

      const preview = await handleWorkspaceWorktreeMethod(
        { type: "req", id: "apply-preview", method: "workspace.worktree.apply.preview", params: { worktreeId: worktree.id } },
        { runtime },
      );
      expect(preview).toMatchObject({
        ok: true,
        payload: { operation: "apply", canConfirm: true, receipt: { receiptId: expect.any(String) } },
      });
      await expect(fs.readFile(path.join(repoDir, "README.md"), "utf-8")).resolves.toBe("demo\n");

      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "forged-preview", method: "workspace.worktree.apply.preview", params: { worktreeId: worktree.id, targetPath: repoDir } },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "missing-confirm", method: "workspace.worktree.apply.confirm", params: { worktreeId: worktree.id, confirm: true } },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "not-confirmed", method: "workspace.worktree.apply.confirm", params: { worktreeId: worktree.id, receiptId: "receipt", confirm: false } },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        { type: "req", id: "stage-forged-path", method: "workspace.worktree.stage.preview", params: { worktreeId: worktree.id, path: "README.md" } },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "commit-forged-author",
          method: "workspace.worktree.commit.preview",
          params: { worktreeId: worktree.id, message: "feat: test", author: "forged" },
        },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "commit-confirm-message",
          method: "workspace.worktree.commit.confirm",
          params: { worktreeId: worktree.id, receiptId: "receipt", message: "forged", confirm: true },
        },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "branch-forged-remote",
          method: "workspace.worktree.branch.preview",
          params: { worktreeId: worktree.id, branch: "feature/local", remote: "origin" },
        },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
      await expect(handleWorkspaceWorktreeMethod(
        {
          type: "req",
          id: "branch-confirm-name",
          method: "workspace.worktree.branch.confirm",
          params: { worktreeId: worktree.id, receiptId: "receipt", branch: "forged", confirm: true },
        },
        { runtime },
      )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);
});
