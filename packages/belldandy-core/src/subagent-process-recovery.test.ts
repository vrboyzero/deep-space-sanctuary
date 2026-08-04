import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSubTaskAgentCapabilities, SubTaskRuntimeStore } from "./task-runtime.js";

const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => forceTerminate(child)));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("subagent process crash recovery", () => {
  it("reopens a durably attached subagent as interrupted without spawning it again", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture);

    await waitForPhase(child, "session_attached");
    await forceTerminate(child);
    expect(await readSpawnCount(fixture)).toBe(1);

    const restarted = new SubTaskRuntimeStore(fixture.stateDir);
    await restarted.load();
    const tasks = await restarted.listTasks("conversation-process-crash");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      kind: "sub_agent",
      parentConversationId: "conversation-process-crash",
      parentOperationId: expect.stringMatching(/^op_[a-f0-9]{64}$/),
      sessionId: "sub-process-crash-1",
      status: "interrupted",
      recovery: {
        state: "runtime_lost",
        previousStatus: "running",
        mutationReplay: "forbidden",
      },
    });
    expect(JSON.stringify(tasks[0])).not.toContain("run-process-crash");
    expect(JSON.stringify(tasks[0])).not.toContain("tool-process-crash");
    expect(await readSpawnCount(fixture)).toBe(1);

    const reloadedAgain = new SubTaskRuntimeStore(fixture.stateDir);
    await reloadedAgain.load();
    await expect(reloadedAgain.getTask(tasks[0]!.id)).resolves.toMatchObject({
      status: "interrupted",
      recovery: {
        state: "runtime_lost",
        detectedAt: tasks[0]!.recovery?.detectedAt,
        mutationReplay: "forbidden",
      },
    });
    expect(await readSpawnCount(fixture)).toBe(1);
  }, 20_000);

  it("records a deterministic error when the live orchestrator crashes after session attachment", async () => {
    const fixture = await createFixture();
    const store = new SubTaskRuntimeStore(fixture.stateDir);
    await store.load();
    const spawn = vi.fn(async (options: {
      onSessionCreated?: (sessionId: string, agentId: string) => void;
    }) => {
      options.onSessionCreated?.("sub-live-crash-1", "coder");
      await waitForTask(store, (task) => task?.sessionId === "sub-live-crash-1" && task.status === "running");
      throw new Error("subagent runtime crashed");
    });
    const capabilities = createSubTaskAgentCapabilities({
      orchestrator: { spawn, listSessions: () => [] } as never,
      runtimeStore: store,
    });

    await expect(capabilities.spawnSubAgent?.({
      parentConversationId: "conversation-live-crash",
      parentOperation: {
        agentRunId: "run-live-crash",
        toolCallId: "tool-live-crash",
      },
      agentId: "coder",
      instruction: "Hold until the subagent runtime crashes.",
    })).resolves.toMatchObject({
      success: false,
      error: "subagent runtime crashed",
      sessionId: "sub-live-crash-1",
      taskId: expect.any(String),
    });
    expect(spawn).toHaveBeenCalledTimes(1);

    const tasks = await store.listTasks("conversation-live-crash");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: "error",
      sessionId: "sub-live-crash-1",
      error: "subagent runtime crashed",
      recovery: undefined,
    });

    const restarted = new SubTaskRuntimeStore(fixture.stateDir);
    await restarted.load();
    await expect(restarted.getTask(tasks[0]!.id)).resolves.toMatchObject({
      status: "error",
      sessionId: "sub-live-crash-1",
      recovery: undefined,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
  }, 20_000);
});

type Fixture = {
  rootDir: string;
  stateDir: string;
  spawnLogPath: string;
};

async function createFixture(): Promise<Fixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subagent-process-crash-"));
  const fixture = {
    rootDir,
    stateDir: path.join(rootDir, "state"),
    spawnLogPath: path.join(rootDir, "spawn.log"),
  };
  temporaryDirectories.push(rootDir);
  return fixture;
}

function startCrashChild(fixture: Fixture): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/subagent-crash-child.mjs", import.meta.url)),
    [fixture.stateDir, fixture.spawnLogPath],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function waitForPhase(child: ChildProcess, phase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Subagent crash child timed out waiting for ${phase}.\n${stderr}`));
    }, 10_000);
    timer.unref?.();

    const onMessage = (message: { type?: string; message?: string }) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Subagent crash child failed: ${message.message ?? "unknown error"}\n${stderr}`));
        return;
      }
      if (message?.type !== phase) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Subagent crash child exited before ${phase} with code ${String(code)}.\n${stderr}`));
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

async function readSpawnCount(fixture: Fixture): Promise<number> {
  try {
    return (await fs.readFile(fixture.spawnLogPath, "utf-8")).split("\n").filter(Boolean).length;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

async function waitForTask(
  store: SubTaskRuntimeStore,
  predicate: (task: Awaited<ReturnType<SubTaskRuntimeStore["getTask"]>>) => boolean,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const tasks = await store.listTasks();
    if (tasks.some((task) => predicate(task))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for subtask persistence.");
}
