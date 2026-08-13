import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { expect, test } from "vitest";

import { normalizeAgentLaunchSpec } from "@belldandy/agent";
import { SubTaskWorktreeRuntime } from "./worktree-runtime.js";

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

test("worktree runtime creates an isolated git worktree and rewrites cwd to the matching subdirectory", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-worktree-runtime-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const nestedDir = path.join(repoDir, "packages", "demo");
  await fs.mkdir(nestedDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "README.md"), "demo repo\n", "utf-8");
  await fs.writeFile(path.join(nestedDir, "index.ts"), "export const demo = true;\n", "utf-8");

  try {
    await runGit(["init"], repoDir);
    await runGit(["config", "user.name", "Belldandy Test"], repoDir);
    await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
    await runGit(["add", "."], repoDir);
    await runGit(["commit", "-m", "init"], repoDir);

    const runtime = new SubTaskWorktreeRuntime(stateDir);
    const prepared = await runtime.prepareTaskLaunch("task_abcd1234", normalizeAgentLaunchSpec({
      instruction: "Implement in worktree",
      parentConversationId: "conv-worktree",
      agentId: "coder",
      cwd: nestedDir,
      isolationMode: "worktree",
    }));

    expect(prepared.summary.worktreeStatus).toBe("created");
    expect(path.resolve(String(prepared.summary.worktreeRepoRoot))).toBe(path.resolve(repoDir));
    expect(prepared.summary.worktreeBaseRef).toBe(await runGit(["rev-parse", "HEAD"], repoDir));
    expect(String(prepared.summary.resolvedCwd)).toContain(path.join("task_abcd1234", "packages", "demo"));
    expect(prepared.launchSpec.cwd).toBe(prepared.summary.resolvedCwd);
    expect(await runGit(["rev-parse", "--is-inside-work-tree"], String(prepared.launchSpec.cwd))).toBe("true");
    await fs.access(path.join(String(prepared.launchSpec.cwd), "index.ts"));
    await fs.access(path.join(String(prepared.summary.worktreePath), "README.md"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  }
}, 15_000);

test("worktree runtime reuses a bound fan-in artifact and rejects worktree drift after capture", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-worktree-fan-in-artifact-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  await fs.mkdir(repoDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");

  try {
    await runGit(["init"], repoDir);
    await runGit(["config", "user.name", "Belldandy Test"], repoDir);
    await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
    await runGit(["add", "."], repoDir);
    await runGit(["commit", "-m", "init"], repoDir);

    const runtime = new SubTaskWorktreeRuntime(stateDir);
    const prepared = await runtime.prepareTaskLaunch("task_fanin1", normalizeAgentLaunchSpec({
      instruction: "Implement fan-in lane",
      parentConversationId: "conv-fan-in",
      agentId: "coder",
      cwd: repoDir,
      isolationMode: "worktree",
    }));
    await fs.writeFile(path.join(String(prepared.summary.worktreePath), "README.md"), "lane result\n", "utf-8");
    const record = {
      id: "task_fanin1",
      launchSpec: {
        isolationMode: "worktree",
        worktreePath: prepared.summary.worktreePath,
        worktreeRepoRoot: prepared.summary.worktreeRepoRoot,
        worktreeBranch: prepared.summary.worktreeBranch,
        worktreeBaseRef: prepared.summary.worktreeBaseRef,
        worktreeStatus: prepared.summary.worktreeStatus,
      },
    };

    const first = await runtime.collectFanInArtifact(record);
    const retry = await runtime.collectFanInArtifact(record);
    expect(first).toMatchObject({
      schemaVersion: "subtask-worktree-fan-in-artifact/v1",
      taskId: "task_fanin1",
      status: "complete",
      baseRef: prepared.summary.worktreeBaseRef,
      changedPaths: ["README.md"],
      patch: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/), byteLength: expect.any(Number) },
      manifest: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(retry).toEqual(first);

    await fs.writeFile(path.join(String(prepared.summary.worktreePath), "README.md"), "drifted after capture\n", "utf-8");
    await expect(runtime.collectFanInArtifact(record)).rejects.toThrow(/drifted after fan-in artifact capture/i);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  }
}, 15_000);

test("worktree runtime removes managed worktrees and deletes the task branch", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-worktree-cleanup-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const nestedDir = path.join(repoDir, "packages", "demo");
  await fs.mkdir(nestedDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "README.md"), "demo repo\n", "utf-8");
  await fs.writeFile(path.join(nestedDir, "index.ts"), "export const demo = true;\n", "utf-8");

  try {
    await runGit(["init"], repoDir);
    await runGit(["config", "user.name", "Belldandy Test"], repoDir);
    await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
    await runGit(["add", "."], repoDir);
    await runGit(["commit", "-m", "init"], repoDir);

    const runtime = new SubTaskWorktreeRuntime(stateDir);
    const prepared = await runtime.prepareTaskLaunch("task_cleanup1", normalizeAgentLaunchSpec({
      instruction: "Implement in worktree",
      parentConversationId: "conv-worktree",
      agentId: "coder",
      cwd: nestedDir,
      isolationMode: "worktree",
    }));

    const cleaned = await runtime.cleanupTaskRuntime("task_cleanup1", {
      cwd: nestedDir,
      resolvedCwd: prepared.summary.resolvedCwd,
      isolationMode: "worktree",
      worktreePath: prepared.summary.worktreePath,
      worktreeRepoRoot: prepared.summary.worktreeRepoRoot,
      worktreeBranch: prepared.summary.worktreeBranch,
    });

    expect(cleaned.worktreeStatus).toBe("removed");
    expect(await fs.access(String(prepared.summary.worktreePath)).then(() => true).catch(() => false)).toBe(false);
    expect(await runGit(["branch", "--list", String(prepared.summary.worktreeBranch)], repoDir)).toBe("");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  }
}, 15_000);
