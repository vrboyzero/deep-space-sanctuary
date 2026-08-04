import { execFile as execFileCallback, fork, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CommandJobManager, CommandJobStateStore } from "./command-job.js";
import { cleanupPersistedOciSandboxLease } from "./command-sandbox-lease.js";

const execFile = promisify(execFileCallback);
const REAL_OCI_IMAGE = "node@sha256:62f550497561d6285e10abd952730db89c905be990237eaf8744137929c72844";
const describeRealOci = process.env.BELLDANDY_REAL_OCI_TESTS === "1" ? describe : describe.skip;
const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();
const containers = new Set<string>();

afterEach(async () => {
  await Promise.all([...children].map((child) => forceTerminate(child)));
  await Promise.all([...containers].map(async (containerName) => {
    await runDocker(["rm", "--force", containerName]).catch(() => undefined);
    containers.delete(containerName);
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describeRealOci("command job real OCI process crash recovery", () => {
  it("recovers a live pipe job as non-reattachable and removes its container", async () => {
    await assertRealOciPreflight();
    const fixture = await createFixture("pipe");
    const child = startCrashChild(fixture);

    const running = await waitForPhase(child, "running");
    expect(running).toMatchObject({
      mode: "pipe",
      jobId: fixture.jobId,
      containerName: fixture.containerName,
      output: expect.stringContaining("ECHO:probe"),
      processPid: expect.any(Number),
    });
    await forceTerminate(child);
    await waitForContainer(fixture.containerName, true);
    await waitForProcessExit(Number(running.processPid));

    let cleanupCalls = 0;
    const restarted = new CommandJobManager({
      store: new CommandJobStateStore(fixture.stateDir),
      recoverLostJob: async (job) => {
        cleanupCalls += 1;
        expect(job.persistedSandbox).toEqual({
          runtime: "docker",
          containerName: fixture.containerName,
        });
        const cleaned = await cleanupPersistedOciSandboxLease({ lease: job.persistedSandbox! });
        if (!cleaned) throw new Error("Unable to remove persisted OCI test container.");
      },
    });
    await restarted.initialize();

    expect(cleanupCalls).toBe(1);
    expect(restarted.get(fixture.jobId)).toMatchObject({
      jobId: fixture.jobId,
      status: "lost",
      stdinMode: "pipe",
      recovery: {
        lifecycle: "lost",
        process: "not_reattachable",
        output: "unavailable",
        stdin: "unavailable",
        mutationReplay: "forbidden",
      },
    });
    expect(restarted.read(fixture.jobId, { cursor: 0, maxBytes: 64 })).toMatchObject({
      output: "",
      nextCursor: 0,
      recovery: { output: "unavailable" },
    });
    expect(() => restarted.write(fixture.jobId, "second\n")).toThrow("is not running");
    expect(() => restarted.resize(fixture.jobId, 120, 36)).toThrow("is not running");
    await waitForContainer(fixture.containerName, false);
  }, 30_000);

  it("recovers a live PTY job without reconnecting stdin, resize, or output", async () => {
    await assertRealOciPreflight();
    const fixture = await createFixture("pty");
    const child = startCrashChild(fixture);

    const running = await waitForPhase(child, "running");
    expect(running).toMatchObject({
      mode: "pty",
      jobId: fixture.jobId,
      containerName: fixture.containerName,
      output: expect.stringContaining("ECHO:probe"),
      processPid: expect.any(Number),
    });
    await forceTerminate(child);
    await waitForContainer(fixture.containerName, true);
    await waitForProcessExit(Number(running.processPid));

    let cleanupCalls = 0;
    const restarted = new CommandJobManager({
      store: new CommandJobStateStore(fixture.stateDir),
      recoverLostJob: async (job) => {
        cleanupCalls += 1;
        const cleaned = await cleanupPersistedOciSandboxLease({ lease: job.persistedSandbox! });
        if (!cleaned) throw new Error("Unable to remove persisted OCI test container.");
      },
    });
    await restarted.initialize();

    expect(cleanupCalls).toBe(1);
    expect(restarted.get(fixture.jobId)).toMatchObject({
      jobId: fixture.jobId,
      status: "lost",
      stdinMode: "pty",
      supportsResize: true,
      recovery: {
        lifecycle: "lost",
        process: "not_reattachable",
        output: "unavailable",
        stdin: "unavailable",
        mutationReplay: "forbidden",
      },
    });
    expect(restarted.read(fixture.jobId, { cursor: 0, maxBytes: 64 })).toMatchObject({
      output: "",
      nextCursor: 0,
      recovery: { output: "unavailable" },
    });
    expect(() => restarted.write(fixture.jobId, "second\n")).toThrow("is not running");
    expect(() => restarted.resize(fixture.jobId, 140, 40)).toThrow("is not running");
    await waitForContainer(fixture.containerName, false);
  }, 30_000);
});

type StdinMode = "pipe" | "pty";

type Fixture = {
  rootDir: string;
  stateDir: string;
  jobId: string;
  containerName: string;
  mode: StdinMode;
};

type ChildPhase = {
  type?: string;
  message?: string;
  mode?: StdinMode;
  jobId?: string;
  containerName?: string;
  output?: string;
  processPid?: number;
};

async function createFixture(mode: StdinMode): Promise<Fixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-command-job-process-crash-"));
  const jobId = randomUUID();
  const fixture = {
    rootDir,
    stateDir: path.join(rootDir, "state"),
    jobId,
    containerName: `belldandy-command-${jobId.replaceAll("-", "")}`,
    mode,
  };
  temporaryDirectories.push(rootDir);
  containers.add(fixture.containerName);
  return fixture;
}

function startCrashChild(fixture: Fixture): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/command-job-crash-child.mjs", import.meta.url)),
    [fixture.stateDir, fixture.jobId, fixture.containerName, fixture.mode, REAL_OCI_IMAGE],
    {
      detached: process.platform !== "win32",
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function waitForPhase(child: ChildProcess, phase: string): Promise<ChildPhase> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Command job crash child timed out waiting for ${phase}.\n${stderr}`));
    }, 15_000);
    timer.unref?.();

    const onMessage = (message: ChildPhase) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Command job crash child failed: ${message.message ?? "unknown error"}\n${stderr}`));
        return;
      }
      if (message?.type !== phase) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Command job crash child exited before ${phase} with code ${String(code)}.\n${stderr}`));
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
  } else if (typeof child.pid === "number") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  await exited;
}

async function assertRealOciPreflight(): Promise<void> {
  await runDocker(["version", "--format", "{{.Server.Version}}"]);
  await runDocker(["image", "inspect", REAL_OCI_IMAGE]);
}

async function runDocker(args: string[]): Promise<string> {
  const result = await execFile("docker", args, {
    cwd: process.cwd(),
    windowsHide: true,
    timeout: 10_000,
  });
  return result.stdout;
}

async function waitForContainer(containerName: string, expected: boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const exists = await runDocker(["inspect", containerName]).then(() => true, () => false);
    if (exists === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Container ${containerName} did not reach expected existence=${String(expected)}.`);
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Process ${pid} remained alive after the owner process was terminated.`);
}
