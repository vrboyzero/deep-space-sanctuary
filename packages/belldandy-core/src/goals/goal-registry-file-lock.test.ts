import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { withGoalRegistryFileLock } from "./goal-registry-file-lock.js";
import { getGoalsRegistryPath } from "./paths.js";

const stateDirs: string[] = [];

afterEach(async () => {
  await Promise.all(stateDirs.splice(0).map((stateDir) => fs.rm(stateDir, { recursive: true, force: true })));
});

describe("Goal registry cross-process mutation lock", () => {
  it("allows only one process to enter the same registry critical section", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-registry-lock-"));
    stateDirs.push(stateDir);
    const first = startLockChild(stateDir);
    const second = startLockChild(stateDir);
    const firstReady = waitForChildMessage(first, "ready");
    const secondReady = waitForChildMessage(second, "ready");
    const firstEntered = waitForChildMessage(first, "entered");
    const secondEntered = waitForChildMessage(second, "entered");
    const firstDone = waitForChildMessage(first, "done");
    const secondDone = waitForChildMessage(second, "done");
    const firstExit = once(first, "exit");
    const secondExit = once(second, "exit");

    await Promise.all([firstReady, secondReady]);
    first.send("start");
    second.send("start");

    const leadingChild = await Promise.race([
      firstEntered.then(() => first),
      secondEntered.then(() => second),
    ]);
    const trailingChild = leadingChild === first ? second : first;
    const trailingEntered = leadingChild === first ? secondEntered : firstEntered;
    const leadingDone = leadingChild === first ? firstDone : secondDone;
    const trailingDone = leadingChild === first ? secondDone : firstDone;
    const enteredBeforeRelease = await Promise.race([
      trailingEntered.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);

    leadingChild.send("release");
    await leadingDone;
    await trailingEntered;
    trailingChild.send("release");
    await Promise.all([trailingDone, firstExit, secondExit]);

    expect(enteredBeforeRelease).toBe(false);
  });

  it("returns a Goal registry timeout without removing a live owner lock", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-registry-lock-"));
    stateDirs.push(stateDir);
    const lockPath = `${getGoalsRegistryPath(stateDir)}.lock`;
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({
      token: "active-goal-owner",
      pid: process.pid,
      createdAtMs: Date.now(),
    }), "utf-8");

    await expect(withGoalRegistryFileLock(
      stateDir,
      async () => "unexpected",
      { timeoutMs: 50, retryDelayMs: 10, staleAfterMs: 60_000 },
    )).rejects.toMatchObject({
      name: "GoalRegistryLockTimeoutError",
      code: "goal_registry_lock_timeout",
      message: "Timed out waiting for the Goal registry mutation lock.",
    });
    await expect(fs.readFile(lockPath, "utf-8")).resolves.toContain("active-goal-owner");
  });
});

type ChildFixtureMessage = {
  type: "ready" | "entered" | "done" | "error";
  message?: string;
};

function startLockChild(stateDir: string): ChildProcess {
  return fork(
    fileURLToPath(new URL("./fixtures/goal-registry-lock-child.mjs", import.meta.url)),
    [stateDir],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
}

function waitForChildMessage(
  child: ChildProcess,
  expectedType: ChildFixtureMessage["type"],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Goal registry child timed out waiting for ${expectedType}.`));
    }, 10_000);
    timer.unref?.();

    const onMessage = (message: ChildFixtureMessage) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Goal registry child failed: ${message.message ?? "unknown error"}`));
        return;
      }
      if (message?.type !== expectedType) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Goal registry child exited before ${expectedType} with code ${code}.`));
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
