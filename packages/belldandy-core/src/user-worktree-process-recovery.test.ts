import { execFile as execFileCallback, fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { ManagedWorktreeRuntime } from "./managed-worktree.js";
import { UserWorktreeRuntime } from "./user-worktree-runtime.js";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => forceTerminate(child)));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("user worktree stage process crash recovery", () => {
  it("reopens a started stage as uncertain when the process dies before the Git mutation", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture, "started");

    await waitForPhase(child, "started");
    await forceTerminate(child);

    await expect(runGit(["diff", "--cached", "--name-only"], fixture.worktreePath)).resolves.toBe("");
    const restarted = new UserWorktreeRuntime(fixture.stateDir);
    await expect(restarted.confirm(confirmInput(fixture))).resolves.toMatchObject({
      operation: "stage",
      outcome: "uncertain",
      applied: false,
      blockers: ["operation_status_uncertain"],
      audit: { status: "started" },
    });
    await expect(runGit(["diff", "--name-only"], fixture.worktreePath)).resolves.toBe("packages/demo/index.ts");
  }, 20_000);

  it("reconciles an exact staged index without replaying when completion audit was lost", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture, "staged");

    await waitForPhase(child, "staged");
    await forceTerminate(child);

    const indexTreeBeforeRecovery = await runGit(["write-tree"], fixture.worktreePath);
    const stagedPatchBeforeRecovery = await runGit(
      ["diff", "--cached", "--binary", "--no-ext-diff", fixture.baseCommit, "--"],
      fixture.worktreePath,
    );
    const restarted = new UserWorktreeRuntime(fixture.stateDir);
    await expect(restarted.confirm(confirmInput(fixture))).resolves.toMatchObject({
      operation: "stage",
      outcome: "succeeded",
      applied: true,
      blockers: [],
      audit: { status: "succeeded" },
    });
    await expect(restarted.confirm(confirmInput(fixture))).resolves.toMatchObject({
      outcome: "succeeded",
      applied: true,
      audit: { status: "succeeded" },
    });
    await expect(runGit(["write-tree"], fixture.worktreePath)).resolves.toBe(indexTreeBeforeRecovery);
    await expect(runGit(
      ["diff", "--cached", "--binary", "--no-ext-diff", fixture.baseCommit, "--"],
      fixture.worktreePath,
    )).resolves.toBe(stagedPatchBeforeRecovery);
    await expect(runGit(["diff", "--name-only"], fixture.worktreePath)).resolves.toBe("");
    const auditEntries = await fs.readdir(path.join(
      fixture.stateDir,
      "worktrees",
      "user-session-operations",
      "audit",
    ));
    expect(auditEntries.filter((entry) => entry.startsWith(fixture.receiptId))).toEqual([
      `${fixture.receiptId}.json`,
    ]);
  }, 20_000);

  it("keeps a staged operation uncertain when the worktree drifts before recovery", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture, "staged");

    await waitForPhase(child, "staged");
    await forceTerminate(child);
    await fs.writeFile(
      path.join(fixture.worktreePath, "packages", "demo", "index.ts"),
      "export const demo = \"drifted\";\n",
      "utf-8",
    );

    const restarted = new UserWorktreeRuntime(fixture.stateDir);
    await expect(restarted.confirm(confirmInput(fixture))).resolves.toMatchObject({
      operation: "stage",
      outcome: "uncertain",
      applied: false,
      blockers: ["operation_status_uncertain"],
      audit: { status: "started" },
    });
    await expect(runGit(["diff", "--cached", "--name-only"], fixture.worktreePath))
      .resolves.toBe("packages/demo/index.ts");
    await expect(runGit(["diff", "--name-only"], fixture.worktreePath))
      .resolves.toBe("packages/demo/index.ts");
  }, 20_000);
});

type CrashPhase = "started" | "staged";

type Fixture = {
  rootDir: string;
  stateDir: string;
  worktreeId: string;
  worktreePath: string;
  receiptId: string;
  baseCommit: string;
};

async function createFixture(): Promise<Fixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-worktree-stage-crash-"));
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

  const managed = new ManagedWorktreeRuntime(stateDir);
  const worktreeId = "user-stage-process-crash";
  const worktree = await managed.prepare({ id: worktreeId, ownerKind: "user_session", cwd: nestedDir });
  const users = new UserWorktreeRuntime(stateDir);
  await users.register(worktree, { conversationId: "conversation-stage-crash", runId: "run-stage-crash" });
  await fs.writeFile(
    path.join(worktree.resolvedCwd, "index.ts"),
    "export const demo = false;\n",
    "utf-8",
  );
  const preview = await users.preview({ operation: "stage", worktreeId });
  if (!preview.receipt) throw new Error(`Stage preview failed: ${preview.blockers.join(",")}`);
  temporaryDirectories.push(rootDir);
  return {
    rootDir,
    stateDir,
    worktreeId,
    worktreePath: worktree.worktreePath,
    receiptId: preview.receipt.receiptId,
    baseCommit: worktree.baseRef,
  };
}

function confirmInput(fixture: Fixture) {
  return {
    operation: "stage" as const,
    worktreeId: fixture.worktreeId,
    receiptId: fixture.receiptId,
    confirm: true as const,
  };
}

function startCrashChild(fixture: Fixture, phase: CrashPhase): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/user-worktree-stage-crash-child.mjs", import.meta.url)),
    [fixture.stateDir, fixture.worktreeId, fixture.receiptId, phase],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function waitForPhase(child: ChildProcess, phase: CrashPhase): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Worktree stage crash child timed out waiting for ${phase}.\n${stderr}`));
    }, 10_000);
    timer.unref?.();

    const onMessage = (message: { type?: string; message?: string }) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Worktree stage crash child failed: ${message.message ?? "unknown error"}\n${stderr}`));
        return;
      }
      if (message?.type !== phase) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Worktree stage crash child exited before ${phase} with code ${String(code)}.\n${stderr}`));
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
  return String(stdout ?? "").replace(/\r\n/g, "\n").trim();
}
