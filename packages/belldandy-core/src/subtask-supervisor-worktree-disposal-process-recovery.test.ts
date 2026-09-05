import { ChildProcess, fork, spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test, vi } from "vitest";

import { SubTaskSupervisorWorktreeDisposalRuntime } from "./subtask-supervisor-worktree-disposal-runtime.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";
import { SubTaskWorktreeRuntime } from "./worktree-runtime.js";

const execFile = promisify(execFileCallback);
const children = new Set<ChildProcess>();

afterEach(() => vi.restoreAllMocks());

test.each(["uncontended", "transient", "persistent"] as const)("recovers a cleanup interruption without duplicate disposal: %s receipt replacement", async (replacement) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-dispose-crash-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const inputPath = path.join(rootDir, "dispose-input.json");
  const worktreeRuntime = new SubTaskWorktreeRuntime(stateDir);
  let taskId: string | undefined;
  let worktreePath: string | undefined;
  let branch: string | undefined;
  try {
    await initializeRepository(repoDir);
    const store = new SubTaskRuntimeStore(stateDir);
    await store.load();
    const task = await store.createTask({
      launchSpec: {
        instruction: "Dispose after runtime loss.",
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
    taskId = task.id;
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
    worktreePath = String(prepared.summary.worktreePath);
    branch = String(prepared.summary.worktreeBranch);
    await store.updateTaskLaunchSpec(task.id, { launchSpec: prepared.launchSpec, runtimeSummary: prepared.summary });
    await store.attachSession(task.id, "session-before-crash", "coder", "coder");
    await fs.writeFile(path.join(worktreePath, "README.md"), "dirty lane\n", "utf-8");
    await store.flushAndClose();

    const recoveredStore = new SubTaskRuntimeStore(stateDir);
    await recoveredStore.load();
    const runtime = new SubTaskSupervisorWorktreeDisposalRuntime({
      stateDir,
      runtimeStore: recoveredStore,
      worktreeRuntime,
    });
    const binding = {
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-parallel",
      laneId: "lane_1",
      taskId: task.id,
      sessionId: "session-before-crash",
      expectedRevision: 0,
    };
    const preview = await runtime.preview(binding);
    await fs.writeFile(inputPath, `${JSON.stringify({ ...binding, receiptId: preview.receipt.id, confirm: true })}\n`, "utf-8");

    const child = fork(
      fileURLToPath(new URL("./fixtures/subtask-supervisor-worktree-dispose-crash-child.mjs", import.meta.url)),
      [stateDir, inputPath],
      { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    children.add(child);
    await waitForPhase(child, "cleanup_applied");
    await forceTerminate(child);

    const restartedStore = new SubTaskRuntimeStore(stateDir);
    await restartedStore.load();
    const restarted = new SubTaskSupervisorWorktreeDisposalRuntime({
      stateDir,
      runtimeStore: restartedStore,
      worktreeRuntime,
    });
    const cleanup = vi.spyOn(worktreeRuntime, "cleanupTaskRuntime");
    const receiptPath = path.join(stateDir, "subtasks", "supervisor-worktree-disposal", "receipts", `${preview.receipt.id}.json`);
    const originalReceipt = await fs.readFile(receiptPath, "utf-8");
    const originalRename = fs.rename.bind(fs);
    const busy = Object.assign(new Error("Injected receipt replacement EPERM"), { code: "EPERM" });
    let attempts = 0;
    const rename = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (String(target) === receiptPath) {
        attempts += 1;
        if (replacement === "persistent" || (replacement === "transient" && attempts === 1)) throw busy;
      }
      return originalRename(source, target);
    });
    if (replacement === "persistent") {
      await expect(restarted.confirm({ ...binding, receiptId: preview.receipt.id, confirm: true })).rejects.toBe(busy);
      expect(attempts).toBe(3);
      await expect(fs.readFile(receiptPath, "utf-8")).resolves.toBe(originalReceipt);
      expect(await fs.readdir(path.dirname(receiptPath))).toEqual([`${preview.receipt.id}.json`]);
      rename.mockRestore();
    }
    await expect(restarted.confirm({ ...binding, receiptId: preview.receipt.id, confirm: true })).resolves.toMatchObject({
      status: "uncertain",
      applied: false,
      duplicateSideEffect: false,
      blockers: ["worktree_cleanup_state_unknown"],
    });
    if (replacement !== "persistent") expect(attempts).toBe(replacement === "transient" ? 2 : 1);
    await expect(restarted.confirm({ ...binding, receiptId: preview.receipt.id, confirm: true })).resolves.toMatchObject({
      status: "uncertain",
      blockers: ["worktree_cleanup_state_unknown"],
    });
    expect(cleanup).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(receiptPath, "utf-8")).result.status).toBe("uncertain");
    await expect(fs.access(worktreePath)).rejects.toThrow();
    expect(await runGit(["branch", "--list", branch], repoDir)).toBe("");
    await restartedStore.flushAndClose();
  } finally {
    await Promise.all([...children].map((child) => forceTerminate(child)));
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 30_000);

async function initializeRepository(repoDir: string): Promise<void> {
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");
  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "Belldandy Test"], repoDir);
  await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", "init"], repoDir);
}

async function waitForPhase(child: ChildProcess, phase: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => reject(new Error(`disposal child timed out waiting for ${phase}: ${stderr}`)), 15_000);
    const onMessage = (message: { type?: string; message?: string }) => {
      if (message.type === phase) { clearTimeout(timer); cleanup(); resolve(); }
      if (message.type === "error") { clearTimeout(timer); cleanup(); reject(new Error(message.message ?? "disposal child failed")); }
    };
    const onExit = (code: number | null) => { clearTimeout(timer); cleanup(); reject(new Error(`disposal child exited with ${String(code)}: ${stderr}`)); };
    const cleanup = () => { child.off("message", onMessage); child.off("exit", onExit); };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

async function forceTerminate(child: ChildProcess): Promise<void> {
  if (!children.delete(child) || child.exitCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32" && typeof child.pid === "number") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    await once(killer, "exit");
  } else {
    child.kill("SIGKILL");
  }
  await exited;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}
