import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "vitest";

import { SubTaskSupervisorWorktreeDisposalRuntime } from "./subtask-supervisor-worktree-disposal-runtime.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";
import { SubTaskWorktreeRuntime } from "./worktree-runtime.js";

const execFile = promisify(execFileCallback);

test("explicitly discards only an exact interrupted dirty lane and recovers duplicate confirm", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-dispose-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const worktreeRuntime = new SubTaskWorktreeRuntime(stateDir);

  try {
    await initializeRepository(repoDir);
    const originalHead = await runGit(["rev-parse", "HEAD"], repoDir);
    const originalStore = new SubTaskRuntimeStore(stateDir);
    await originalStore.load();
    const task = await originalStore.createTask({
      launchSpec: {
        instruction: "Change the isolated lane.",
        parentConversationId: "conversation-manager",
        agentId: "coder",
        profileId: "coder",
        background: true,
        timeoutMs: 30_000,
        channel: "subtask",
        cwd: repoDir,
        isolationMode: "worktree",
        role: "coder",
      },
      supervisorBinding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-parallel",
        laneId: "lane_1",
        mode: "write",
      },
});

    const prepared = await worktreeRuntime.prepareTaskLaunch(task.id, {
      instruction: task.instruction,
      parentConversationId: "conversation-manager",
      agentId: "coder",
      profileId: "coder",
      background: true,
      timeoutMs: 30_000,
      channel: "subtask",
      cwd: repoDir,
      isolationMode: "worktree",
      role: "coder",
    });
    await originalStore.updateTaskLaunchSpec(task.id, {
      launchSpec: prepared.launchSpec,
      runtimeSummary: prepared.summary,
    });
    await originalStore.attachSession(task.id, "session-before-crash", "coder", "coder");
    await fs.writeFile(path.join(String(prepared.summary.worktreePath), "README.md"), "dirty lane\n", "utf-8");
    await originalStore.flushAndClose();

    const recoveredStore = new SubTaskRuntimeStore(stateDir);
    await recoveredStore.load();
    await expect(recoveredStore.getTask(task.id)).resolves.toMatchObject({
      status: "interrupted",
      recovery: { state: "runtime_lost" },
      commandGeneration: 0,
    });
    const runtime = new SubTaskSupervisorWorktreeDisposalRuntime({
      stateDir,
      runtimeStore: recoveredStore,
      worktreeRuntime,
    });
    const input = {
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-parallel",
      laneId: "lane_1",
      taskId: task.id,
      sessionId: "session-before-crash",
      expectedRevision: 0,
    };

    await expect(runtime.preview({ ...input, managerAgentRunId: "run-other" }))
      .rejects.toMatchObject({ code: "binding_conflict" });
    await expect(runtime.preview({ ...input, expectedRevision: 1 }))
      .rejects.toMatchObject({ code: "binding_conflict" });

    const stalePreview = await runtime.preview(input);
    expect(stalePreview).toMatchObject({
      schemaVersion: "subtask-supervisor-worktree-disposal/v1",
      contentMode: "none",
      status: "ready",
      applied: false,
      blockers: [],
      receipt: { id: expect.any(String), expiresAtMs: expect.any(Number) },
    });
    await fs.access(String(prepared.summary.worktreePath));
    await fs.writeFile(path.join(String(prepared.summary.worktreePath), "README.md"), "drift after preview\n", "utf-8");
    await expect(runtime.confirm({
      ...input,
      receiptId: stalePreview.receipt.id,
      confirm: true,
    })).resolves.toMatchObject({ status: "failed", applied: false, blockers: ["receipt_stale"] });
    await fs.access(String(prepared.summary.worktreePath));

    const preview = await runtime.preview(input);
    await expect(runtime.confirm({
      ...input,
      sessionId: "session-other",
      receiptId: preview.receipt.id,
      confirm: true,
    })).resolves.toMatchObject({ status: "failed", applied: false, blockers: ["receipt_mismatch"] });

    const confirmInput = { ...input, receiptId: preview.receipt.id, confirm: true as const };
    const runtime2 = new SubTaskSupervisorWorktreeDisposalRuntime({
      stateDir,
      runtimeStore: recoveredStore,
      worktreeRuntime,
    });
    const [completed, completed2] = await Promise.all([
      runtime.confirm(confirmInput),
      runtime2.confirm(confirmInput),
    ]);
    expect(completed).toEqual({
      schemaVersion: "subtask-supervisor-worktree-disposal/v1",
      contentMode: "none",
      status: "completed",
      applied: true,
      duplicateSideEffect: false,
      blockers: [],
    });
    expect(completed2).toEqual(completed);
    await expect(runtime.confirm(confirmInput)).resolves.toEqual(completed);

    await expect(fs.access(String(prepared.summary.worktreePath))).rejects.toThrow();
    expect(await runGit(["branch", "--list", String(prepared.summary.worktreeBranch)], repoDir)).toBe("");
    await expect(recoveredStore.getTask(task.id)).resolves.toMatchObject({
      status: "interrupted",
      launchSpec: { worktreeStatus: "removed" },
    });
    expect(await runGit(["rev-parse", "HEAD"], repoDir)).toBe(originalHead);
    expect(await runGit(["status", "--porcelain"], repoDir)).toBe("");
    await expect(fs.readFile(path.join(repoDir, "README.md"), "utf-8")).resolves.toBe("initial\n");
    await recoveredStore.flushAndClose();
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 20_000);

test("rejects ignored-file drift and archived lanes instead of deleting by stale evidence", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-dispose-ignored-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const worktreeRuntime = new SubTaskWorktreeRuntime(stateDir);
  try {
    await initializeRepository(repoDir, "*.secret\n");
    const store = new SubTaskRuntimeStore(stateDir);
    await store.load();
    const task = await store.createTask({
      launchSpec: {
        instruction: "Dispose ignored drift lane.",
        parentConversationId: "conversation-manager",
        agentId: "coder",
        profileId: "coder",
        background: true,
        timeoutMs: 30_000,
        channel: "subtask",
        cwd: repoDir,
        isolationMode: "worktree",
        role: "coder",
      },
      supervisorBinding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-parallel",
        laneId: "lane_ignored",
        mode: "write",
      },
    });
    const prepared = await worktreeRuntime.prepareTaskLaunch(task.id, {
      instruction: task.instruction,
      parentConversationId: "conversation-manager",
      agentId: "coder",
      profileId: "coder",
      background: true,
      timeoutMs: 30_000,
      channel: "subtask",
      cwd: repoDir,
      isolationMode: "worktree",
      role: "coder",
    });
    await store.updateTaskLaunchSpec(task.id, { launchSpec: prepared.launchSpec, runtimeSummary: prepared.summary });
    await store.attachSession(task.id, "session-ignored", "coder", "coder");
    await fs.writeFile(path.join(String(prepared.summary.worktreePath), "README.md"), "dirty lane\n", "utf-8");
    await fs.writeFile(path.join(String(prepared.summary.worktreePath), "secret.secret"), "first\n", "utf-8");
    await store.flushAndClose();

    const recoveredStore = new SubTaskRuntimeStore(stateDir);
    await recoveredStore.load();
    const runtime = new SubTaskSupervisorWorktreeDisposalRuntime({ stateDir, runtimeStore: recoveredStore, worktreeRuntime });
    const binding = {
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-parallel",
      laneId: "lane_ignored",
      taskId: task.id,
      sessionId: "session-ignored",
      expectedRevision: 0,
    };
    const preview = await runtime.preview(binding);
    await fs.writeFile(path.join(String(prepared.summary.worktreePath), "secret.secret"), "drifted\n", "utf-8");
    await expect(runtime.confirm({ ...binding, receiptId: preview.receipt.id, confirm: true })).resolves.toMatchObject({
      status: "failed",
      blockers: ["receipt_stale"],
    });
    await fs.access(String(prepared.summary.worktreePath));
    const archived = await recoveredStore.archiveTask(task.id, "archive before disposal");
    expect(archived?.archivedAt).toEqual(expect.any(Number));
    await expect(runtime.preview(binding)).rejects.toMatchObject({ code: "binding_conflict" });
    await recoveredStore.flushAndClose();
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 20_000);

async function initializeRepository(repoDir: string, gitignore = ""): Promise<void> {
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");
  if (gitignore) await fs.writeFile(path.join(repoDir, ".gitignore"), gitignore, "utf-8");
  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "Belldandy Test"], repoDir);
  await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", "init"], repoDir);
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}
