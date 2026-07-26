import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CommandJobManager,
  CommandJobStateStore,
  type CommandJobProcess,
  type CommandJobProcessExit,
} from "./command-job.js";
import type { ProcessTerminationResult } from "./builtin/system/process-lease.js";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

class FakeJobProcess implements CommandJobProcess {
  readonly pid = 8123;
  readonly supportsResize: boolean;
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  readonly termination: ProcessTerminationResult;
  terminateCalls = 0;

  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: CommandJobProcessExit) => void>();

  constructor(input: {
    supportsResize?: boolean;
    termination?: ProcessTerminationResult;
  } = {}) {
    this.supportsResize = input.supportsResize ?? true;
    this.termination = input.termination ?? {
      method: "process_group",
      hardKillUsed: true,
      closeObserved: true,
    };
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.add(listener);
  }

  onExit(listener: (event: CommandJobProcessExit) => void): void {
    this.exitListeners.add(listener);
  }

  async terminate(): Promise<ProcessTerminationResult> {
    this.terminateCalls += 1;
    return this.termination;
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(event: CommandJobProcessExit = { exitCode: 0 }): void {
    for (const listener of this.exitListeners) listener(event);
  }
}

class ImmediateExitJobProcess extends FakeJobProcess {
  override onExit(listener: (event: CommandJobProcessExit) => void): void {
    super.onExit(listener);
    listener({ exitCode: 0 });
  }
}

function createManager(input: {
  maxOutputBytes?: number;
  store?: CommandJobStateStore;
  recoverLostJob?: (job: { jobId: string }) => Promise<void>;
} = {}) {
  return new CommandJobManager({
    maxOutputBytes: input.maxOutputBytes,
    store: input.store,
    recoverLostJob: input.recoverLostJob,
  });
}

describe("CommandJobManager", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("keeps output readable from stable cursors while routing stdin and resize to one job", async () => {
    const process = new FakeJobProcess();
    const manager = createManager();
    await manager.initialize();
    const started = await manager.start({
      jobId: JOB_ID,
      stdinMode: "pty",
      process,
    });

    expect(started).toMatchObject({
      jobId: JOB_ID,
      status: "running",
      pid: process.pid,
      supportsResize: true,
      nextCursor: 0,
    });

    process.emitData("abcdef");
    manager.write(JOB_ID, "answer\\n");
    manager.resize(JOB_ID, 132, 40);

    expect(manager.read(JOB_ID, { cursor: 0, maxBytes: 3 })).toMatchObject({
      output: "abc",
      nextCursor: 3,
      hasMore: true,
      cursorExpired: false,
    });
    expect(manager.read(JOB_ID, { cursor: 3, maxBytes: 3 })).toMatchObject({
      output: "def",
      nextCursor: 6,
      hasMore: false,
      cursorExpired: false,
    });
    expect(manager.read(JOB_ID, { cursor: 0, maxBytes: 6 }).output).toBe("abcdef");
    expect(process.writes).toEqual(["answer\\n"]);
    expect(process.resizes).toEqual([{ cols: 132, rows: 40 }]);
  });

  it("marks an expired cursor without returning malformed retained UTF-8", async () => {
    const process = new FakeJobProcess();
    const manager = createManager({ maxOutputBytes: 6 });
    await manager.initialize();
    await manager.start({ jobId: JOB_ID, stdinMode: "pipe", process });

    process.emitData("ab中文");
    const read = manager.read(JOB_ID, { cursor: 0, maxBytes: 32 });

    expect(read).toMatchObject({
      cursorExpired: true,
      output: "中文",
      oldestCursor: 2,
      nextCursor: 8,
    });
  });

  it("cancels through the process tree owner before it resolves the terminal state", async () => {
    const process = new FakeJobProcess({
      termination: {
        method: "taskkill",
        hardKillUsed: true,
        closeObserved: true,
      },
    });
    const cleanup = async () => ({ commandSandboxLeaseCleanupStatus: "removed" });
    const manager = createManager();
    await manager.initialize();
    await manager.start({
      jobId: JOB_ID,
      stdinMode: "pipe",
      process,
      cleanup,
    });

    const terminal = await manager.cancel(JOB_ID);

    expect(terminal).toMatchObject({
      status: "cancelled",
      processTerminationMethod: "taskkill",
      processCloseObserved: true,
      cleanup: { commandSandboxLeaseCleanupStatus: "removed" },
    });
  });

  it("waits for terminal cleanup when a runtime exits during listener registration", async () => {
    const manager = createManager();
    await manager.initialize();
    const cleanup = vi.fn(async () => ({ commandSandboxLeaseCleanupStatus: "removed" }));

    const terminal = await manager.start({
      jobId: JOB_ID,
      stdinMode: "closed",
      process: new ImmediateExitJobProcess(),
      cleanup,
    });

    expect(terminal).toMatchObject({
      status: "completed",
      cleanup: { commandSandboxLeaseCleanupStatus: "removed" },
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("fails a job after its bounded timeout and records the process-tree cleanup", async () => {
    const process = new FakeJobProcess({
      termination: {
        method: "taskkill",
        hardKillUsed: true,
        closeObserved: true,
      },
    });
    const manager = createManager();
    await manager.initialize();
    const started = await manager.start({
      jobId: JOB_ID,
      stdinMode: "pipe",
      timeoutMs: 10,
      process,
    });

    expect(started).toMatchObject({ timeoutMs: 10 });
    await vi.waitFor(() => expect(process.terminateCalls).toBe(1));
    expect(manager.get(JOB_ID)).toMatchObject({
      status: "failed",
      error: "Command job timed out after 10ms.",
      processTerminationMethod: "taskkill",
      processCloseObserved: true,
    });
  });

  it("bounds a stalled runtime startup and terminates a process that appears after the deadline", async () => {
    const lateProcess = new FakeJobProcess();
    let resolveProcess!: (value: CommandJobProcess) => void;
    const processReady = new Promise<CommandJobProcess>((resolve) => {
      resolveProcess = resolve;
    });
    const cleanup = vi.fn(async () => ({ commandSandboxLeaseCleanupStatus: "removed" }));
    const manager = createManager();
    await manager.initialize();

    const terminal = await manager.start({
      jobId: JOB_ID,
      stdinMode: "pty",
      timeoutMs: 10,
      startProcess: async () => await processReady,
      cleanup,
    });

    expect(terminal).toMatchObject({
      status: "failed",
      error: "Command job start failed: Command job startup timed out after 10ms.",
      cleanup: { commandSandboxLeaseCleanupStatus: "removed" },
    });
    resolveProcess(lateProcess);
    await vi.waitFor(() => expect(lateProcess.terminateCalls).toBe(1));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cancels a job that is still waiting for its runtime process without leaking it", async () => {
    const process = new FakeJobProcess();
    let resolveProcess!: (value: CommandJobProcess) => void;
    const processReady = new Promise<CommandJobProcess>((resolve) => {
      resolveProcess = resolve;
    });
    const manager = createManager();
    await manager.initialize();
    const start = manager.start({
      jobId: JOB_ID,
      stdinMode: "pipe",
      startProcess: async () => await processReady,
    });

    await vi.waitFor(() => expect(() => manager.get(JOB_ID)).not.toThrow());
    const cancel = manager.cancel(JOB_ID);
    resolveProcess(process);

    const [started, cancelled] = await Promise.all([start, cancel]);
    expect(started).toMatchObject({ status: "cancelled" });
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(process.terminateCalls).toBe(1);
  });

  it("recovers an unfinished persisted job as lost without persisting terminal output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "belldandy-command-job-test-"));
    directories.push(directory);
    const store = new CommandJobStateStore(directory);
    const first = createManager({ store });
    await first.initialize();
    await first.start({
      jobId: JOB_ID,
      stdinMode: "pipe",
      process: new FakeJobProcess(),
      persistedSandbox: {
        runtime: "docker",
        containerName: "belldandy-command-11111111111141118111111111111111",
      },
    });

    const recovered: string[] = [];
    const second = createManager({
      store: new CommandJobStateStore(directory),
      recoverLostJob: async (job) => {
        recovered.push(job.jobId);
      },
    });
    await second.initialize();

    expect(recovered).toEqual([JOB_ID]);
    expect(second.get(JOB_ID)).toMatchObject({
      jobId: JOB_ID,
      status: "lost",
      error: expect.stringContaining("Gateway restarted"),
    });
    expect(second.read(JOB_ID, { cursor: 0, maxBytes: 64 })).toMatchObject({ output: "", nextCursor: 0 });
  });
});
