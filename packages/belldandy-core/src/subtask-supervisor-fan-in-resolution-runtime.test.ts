import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { SubTaskSupervisorFanInResolutionRuntime } from "./subtask-supervisor-fan-in-resolution-runtime.js";

const execFile = promisify(execFileCallback);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}

async function readText(filePath: string): Promise<string> {
  return (await fs.readFile(filePath, "utf-8")).replace(/\r\n/g, "\n");
}

async function createFixture(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const repoRoot = path.join(root, "repo");
  const stateDir = path.join(root, "state");
  const artifactDir = path.join(root, "artifacts");
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(repoRoot, "first.txt"), "first-base\n", "utf-8");
  await fs.writeFile(path.join(repoRoot, "second.txt"), "second-base\n", "utf-8");
  await runGit(["init"], repoRoot);
  await runGit(["config", "user.name", "Belldandy Test"], repoRoot);
  await runGit(["config", "user.email", "belldandy@example.com"], repoRoot);
  await runGit(["add", "."], repoRoot);
  await runGit(["commit", "-m", "init"], repoRoot);
  return { root, repoRoot, stateDir, artifactDir, baseRef: await runGit(["rev-parse", "HEAD"], repoRoot) };
}

async function createPatch(repoRoot: string, artifactDir: string, name: string, changes: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(changes)) {
    await fs.writeFile(path.join(repoRoot, relativePath), content, "utf-8");
  }
  const { stdout } = await execFile("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const patch = String(stdout ?? "");
  const patchPath = path.join(artifactDir, `${name}.patch`);
  await fs.writeFile(patchPath, patch, "utf-8");
  await runGit(["restore", "--source", "HEAD", "--staged", "--worktree", "--", "."], repoRoot);
  return {
    path: patchPath,
    sha256: createHash("sha256").update(patch).digest("hex"),
    byteLength: Buffer.byteLength(patch),
  };
}

function previewInput(
  repoRoot: string,
  baseRef: string,
  patches: Array<{ path: string; sha256: string; byteLength: number }>,
) {
  return {
    managerConversationId: "conversation-manager",
    managerAgentRunId: "run-manager",
    teamId: "team-parallel",
    lanes: patches.map((patch, index) => ({
      binding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-parallel",
        laneId: `lane_${index + 1}`,
        taskId: `task-lane-${index + 1}`,
        sessionId: `session-lane-${index + 1}`,
      },
      revision: 0,
      sourceRepoRoot: repoRoot,
      artifact: {
        schemaVersion: "subtask-worktree-fan-in-artifact/v1" as const,
        taskId: `task-lane-${index + 1}`,
        status: "complete" as const,
        baseRef,
        patch,
        manifest: { path: `${patch.path}.json`, sha256: String(index + 1).repeat(64) },
        changedPaths: index === 0 ? ["first.txt"] : ["second.txt"],
      },
      testEvidence: {
        schemaVersion: "subtask-supervisor-test-evidence/v1" as const,
        taskId: `task-lane-${index + 1}`,
        sessionId: `session-lane-${index + 1}`,
        revision: 0,
        status: "passed" as const,
        artifact: { id: `test-lane-${index + 1}`, sha256: String(index + 3).repeat(64) },
      },
    })),
    reviewerEvidence: {
      schemaVersion: "subtask-supervisor-review-evidence/v1" as const,
      mode: "read_only" as const,
      verdict: "approved" as const,
      artifact: { id: "review-team", sha256: "f".repeat(64) },
    },
  };
}

describe("SubTaskSupervisorFanInResolutionRuntime", () => {
  it("combines non-conflicting lane patches but mutates the source only after an idempotent confirm", async () => {
    const fixture = await createFixture("belldandy-supervisor-fan-in-resolution-");
    try {
      const first = await createPatch(fixture.repoRoot, fixture.artifactDir, "lane-1", { "first.txt": "first-lane\n" });
      const second = await createPatch(fixture.repoRoot, fixture.artifactDir, "lane-2", { "second.txt": "second-lane\n" });
      const runtime = new SubTaskSupervisorFanInResolutionRuntime({ stateDir: fixture.stateDir });
      const input = previewInput(fixture.repoRoot, fixture.baseRef, [first, second]);

      const preview = await runtime.preview(input);
      expect(preview).toMatchObject({
        status: "ready",
        laneCount: 2,
        conflictPaths: [],
        receipt: { id: expect.stringMatching(/^fanin-/) },
      });
      await expect(readText(path.join(fixture.repoRoot, "first.txt"))).resolves.toBe("first-base\n");
      await expect(readText(path.join(fixture.repoRoot, "second.txt"))).resolves.toBe("second-base\n");

      const confirmInput = { ...input, receiptId: preview.receipt.id, confirm: true as const };
      await expect(runtime.confirm(confirmInput)).resolves.toMatchObject({
        status: "completed",
        applied: true,
        duplicateSideEffect: false,
        blockers: [],
      });
      await expect(runtime.confirm(confirmInput)).resolves.toMatchObject({
        status: "completed",
        applied: true,
        duplicateSideEffect: false,
        blockers: [],
      });
      await expect(readText(path.join(fixture.repoRoot, "first.txt"))).resolves.toBe("first-lane\n");
      await expect(readText(path.join(fixture.repoRoot, "second.txt"))).resolves.toBe("second-lane\n");
      expect((await runGit(["worktree", "list", "--porcelain"], fixture.repoRoot)).split(/\r?\n/).filter((line) => line.startsWith("worktree "))).toHaveLength(1);
      expect(await runGit(["branch", "--list", "belldandy-user-*"], fixture.repoRoot)).toBe("");
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("returns a non-confirmable conflict preview without mutating the source", async () => {
    const fixture = await createFixture("belldandy-supervisor-fan-in-conflict-");
    try {
      const first = await createPatch(fixture.repoRoot, fixture.artifactDir, "lane-1", { "first.txt": "lane-one\n" });
      const second = await createPatch(fixture.repoRoot, fixture.artifactDir, "lane-2", { "first.txt": "lane-two\n" });
      const runtime = new SubTaskSupervisorFanInResolutionRuntime({ stateDir: fixture.stateDir });
      const input = previewInput(fixture.repoRoot, fixture.baseRef, [first, second]);
      input.lanes[1]!.artifact.changedPaths = ["first.txt"];

      const preview = await runtime.preview(input);
      expect(preview).toMatchObject({ status: "conflict", laneCount: 2, conflictPaths: ["first.txt"] });
      await expect(runtime.confirm({ ...input, receiptId: preview.receipt.id, confirm: true })).resolves.toMatchObject({
        status: "conflict",
        applied: false,
        duplicateSideEffect: false,
        blockers: ["conflict_resolution_required"],
      });
      await expect(readText(path.join(fixture.repoRoot, "first.txt"))).resolves.toBe("first-base\n");
      expect(await runGit(["status", "--porcelain=v1"], fixture.repoRoot)).toBe("");
      expect((await runGit(["worktree", "list", "--porcelain"], fixture.repoRoot)).split(/\r?\n/).filter((line) => line.startsWith("worktree "))).toHaveLength(1);
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);
});
