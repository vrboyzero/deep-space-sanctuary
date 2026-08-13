import { execFile as execFileCallback, fork, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { SubTaskSupervisorFanInResolutionRuntime } from "./subtask-supervisor-fan-in-resolution-runtime.js";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => forceTerminate(child)));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("SubTaskSupervisorFanInResolutionRuntime process recovery", () => {
  it("cleans the resolution worktree after a crash between completed receipt persistence and cleanup", async () => {
    const fixture = await createFixture();
    const runtime = new SubTaskSupervisorFanInResolutionRuntime({ stateDir: fixture.stateDir });
    const preview = await runtime.preview(fixture.input);
    const inputPath = path.join(fixture.root, "confirm-input.json");
    await fs.writeFile(inputPath, `${JSON.stringify(fixture.input)}\n`, "utf-8");
    const child = startCrashChild(fixture.stateDir, inputPath, preview.receipt.id);

    await waitForPhase(child, "completed_before_cleanup");
    await forceTerminate(child);
    await expect(readText(path.join(fixture.repoRoot, "first.txt"))).resolves.toBe("first-lane\n");
    expect(await worktreeCount(fixture.repoRoot)).toBe(2);

    const restarted = new SubTaskSupervisorFanInResolutionRuntime({ stateDir: fixture.stateDir });
    await expect(restarted.confirm({
      ...fixture.input,
      receiptId: preview.receipt.id,
      confirm: true,
    })).resolves.toMatchObject({
      status: "completed",
      applied: true,
      duplicateSideEffect: false,
      blockers: [],
    });
    await expect(readText(path.join(fixture.repoRoot, "first.txt"))).resolves.toBe("first-lane\n");
    expect(await worktreeCount(fixture.repoRoot)).toBe(1);
    expect(await runGit(["branch", "--list", "belldandy-user-*"], fixture.repoRoot)).toBe("");
  }, 20_000);
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-fan-in-crash-"));
  temporaryDirectories.push(root);
  const repoRoot = path.join(root, "repo");
  const stateDir = path.join(root, "state");
  const artifactDir = path.join(root, "artifacts");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(repoRoot, "first.txt"), "first-base\n", "utf-8");
  await runGit(["init"], repoRoot);
  await runGit(["config", "user.name", "Belldandy Test"], repoRoot);
  await runGit(["config", "user.email", "belldandy@example.com"], repoRoot);
  await runGit(["add", "."], repoRoot);
  await runGit(["commit", "-m", "init"], repoRoot);
  const baseRef = await runGit(["rev-parse", "HEAD"], repoRoot);
  await fs.writeFile(path.join(repoRoot, "first.txt"), "first-lane\n", "utf-8");
  const patchText = await runGit(["diff", "--binary", "--no-ext-diff", "HEAD", "--"], repoRoot);
  const patchPath = path.join(artifactDir, "lane.patch");
  await fs.writeFile(patchPath, `${patchText}\n`, "utf-8");
  await runGit(["restore", "--source", "HEAD", "--staged", "--worktree", "--", "."], repoRoot);
  const patch = await fs.readFile(patchPath);
  const input = {
    managerConversationId: "conversation-manager",
    managerAgentRunId: "run-manager",
    teamId: "team-parallel",
    lanes: [{
      binding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-parallel",
        laneId: "lane_1",
        taskId: "task-lane-1",
        sessionId: "session-lane-1",
      },
      revision: 0,
      sourceRepoRoot: repoRoot,
      artifact: {
        schemaVersion: "subtask-worktree-fan-in-artifact/v1" as const,
        taskId: "task-lane-1",
        status: "complete" as const,
        baseRef,
        patch: {
          path: patchPath,
          sha256: createHash("sha256").update(patch).digest("hex"),
          byteLength: patch.byteLength,
        },
        manifest: { path: `${patchPath}.json`, sha256: "1".repeat(64) },
        changedPaths: ["first.txt"],
      },
      testEvidence: {
        schemaVersion: "subtask-supervisor-test-evidence/v1" as const,
        taskId: "task-lane-1",
        sessionId: "session-lane-1",
        revision: 0,
        status: "passed" as const,
        artifact: { id: "test-lane-1", sha256: "3".repeat(64) },
      },
    }],
    reviewerEvidence: {
      schemaVersion: "subtask-supervisor-review-evidence/v1" as const,
      mode: "read_only" as const,
      verdict: "approved" as const,
      artifact: { id: "review-team", sha256: "f".repeat(64) },
    },
  };
  return { root, repoRoot, stateDir, input };
}

function startCrashChild(stateDir: string, inputPath: string, receiptId: string): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/subtask-supervisor-fan-in-crash-child.mjs", import.meta.url)),
    [stateDir, inputPath, receiptId],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  children.add(child);
  return child;
}

function waitForPhase(child: ChildProcess, phase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Fan-in crash child timed out waiting for ${phase}.\n${stderr}`));
    }, 10_000);
    timer.unref?.();
    const onMessage = (message: { type?: string; message?: string }) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Fan-in crash child failed: ${message.message ?? "unknown error"}\n${stderr}`));
      } else if (message?.type === phase) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Fan-in crash child exited before ${phase} with code ${String(code)}.\n${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
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

async function worktreeCount(repoRoot: string): Promise<number> {
  return (await runGit(["worktree", "list", "--porcelain"], repoRoot))
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .length;
}

async function readText(filePath: string): Promise<string> {
  return (await fs.readFile(filePath, "utf-8")).replace(/\r\n/g, "\n");
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}
