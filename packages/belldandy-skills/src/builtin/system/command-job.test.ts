import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CommandJobProcess, CommandJobProcessExit } from "../../command-job.js";
import type { ProcessTerminationResult } from "./process-lease.js";
import { getToolContract } from "../../tool-contract.js";

const mocks = vi.hoisted(() => ({
  buildInvocation: vi.fn(),
  createEnvironmentFile: vi.fn(),
  createLease: vi.fn(),
  createProcess: vi.fn(),
  evaluateAdmission: vi.fn(),
}));

vi.mock("../../command-sandbox.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../command-sandbox.js")>();
  return {
    ...actual,
    buildOciSandboxInvocation: mocks.buildInvocation,
    buildSandboxRuntimeEnvironment: () => process.env,
    createOciSandboxEnvironmentFile: mocks.createEnvironmentFile,
    evaluateCommandSandboxAdmission: mocks.evaluateAdmission,
  };
});

vi.mock("../../command-sandbox-lease.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../command-sandbox-lease.js")>();
  return {
    ...actual,
    createOciSandboxLease: mocks.createLease,
  };
});

vi.mock("../../command-job-runtime.js", () => ({
  createCommandJobProcess: mocks.createProcess,
}));

import { commandJobTool, getCommandJobRuntime, shutdownCommandJobs } from "./command-job.js";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const sandbox = {
  backend: "oci" as const,
  runtime: "docker" as const,
  image: "ghcr.io/example/command-sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

class FakeProcess implements CommandJobProcess {
  readonly pid = 3456;
  readonly supportsResize = true;
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  terminateCalls = 0;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: CommandJobProcessExit) => void>();

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
    return { method: "process_group", hardKillUsed: true, closeObserved: true };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
}

describe("command_job", () => {
  const directories: string[] = [];
  let jobProcess: FakeProcess;
  let stateDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    jobProcess = new FakeProcess();
    stateDir = await mkdtemp(path.join(os.tmpdir(), "belldandy-command-job-tool-"));
    directories.push(stateDir);
    mocks.evaluateAdmission.mockResolvedValue({ allowed: true, sandbox });
    mocks.createEnvironmentFile.mockResolvedValue({ cleanup: vi.fn().mockResolvedValue(undefined) });
    mocks.buildInvocation.mockReturnValue({ executable: "docker", args: ["run"], cwd: process.cwd() });
    mocks.createProcess.mockResolvedValue(jobProcess);
    mocks.createLease.mockResolvedValue({
      binding: {
        leaseId: JOB_ID,
        containerName: "belldandy-command-11111111111141118111111111111111",
        cidFile: path.join(stateDir, "container.cid"),
      },
      markRuntimeStarted: vi.fn(),
      release: vi.fn().mockResolvedValue({ status: "removed" }),
      cleanupArtifacts: vi.fn().mockResolvedValue(undefined),
      metadata: vi.fn(() => ({
        commandSandboxLeaseId: JOB_ID,
        commandSandboxContainerName: "belldandy-command-11111111111141118111111111111111",
        commandSandboxLeaseCleanupStatus: "removed",
      })),
    });
  });

  afterEach(async () => {
    await shutdownCommandJobs();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  function context() {
    return {
      conversationId: "command-job-test",
      workspaceRoot: process.cwd(),
      stateDir,
      launchSpec: { commandSandbox: "required" as const },
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 4_096,
      },
    };
  }

  const plan = {
    executable: "node",
    argv: ["--version"],
    network: "none",
    writeScope: "workspace-readonly",
    stdinMode: "pty",
    timeoutMs: 9_000,
  };

  it("is available to governed CLI coding runs", () => {
    expect(getToolContract(commandJobTool)?.channels).toEqual(expect.arrayContaining(["gateway", "web", "cli"]));
  });

  it("shares one live manager with stateDir consumers", async () => {
    const started = await commandJobTool.execute({ action: "start", commandPlan: plan }, context());
    expect(started.success).toBe(true);

    const runtime = await getCommandJobRuntime(stateDir);

    expect(runtime.list()).toEqual([
      expect.objectContaining({ jobId: JOB_ID, status: "running" }),
    ]);
  });

  it("owns sandbox job stdin, cursor reads, resize, and cancellation without exposing stdin in output", async () => {
    const started = await commandJobTool.execute({ action: "start", commandPlan: plan }, context());

    expect(started.success).toBe(true);
    expect(JSON.parse(started.output)).toMatchObject({
      jobId: JOB_ID,
      status: "running",
      supportsResize: true,
      timeoutMs: 5_000,
    });
    expect(mocks.createLease).toHaveBeenCalledOnce();
    expect(mocks.createProcess).toHaveBeenCalledWith(expect.objectContaining({ stdinMode: "pty" }));

    jobProcess.emitData("prompt> ");
    const write = await commandJobTool.execute({ action: "write", jobId: JOB_ID, data: "secret\\n" }, context());
    const resize = await commandJobTool.execute({ action: "resize", jobId: JOB_ID, cols: 120, rows: 36 }, context());
    const read = await commandJobTool.execute({ action: "read", jobId: JOB_ID, cursor: 0, maxBytes: 64 }, context());
    const cancelled = await commandJobTool.execute({ action: "cancel", jobId: JOB_ID }, context());

    expect(write.success).toBe(true);
    expect(write.output).not.toContain("secret");
    expect(jobProcess.writes).toEqual(["secret\\n"]);
    expect(resize.success).toBe(true);
    expect(jobProcess.resizes).toEqual([{ cols: 120, rows: 36 }]);
    expect(JSON.parse(read.output)).toMatchObject({ output: "prompt> ", nextCursor: 8 });
    expect(JSON.parse(cancelled.output)).toMatchObject({ status: "cancelled", processCloseObserved: true });
    expect(jobProcess.terminateCalls).toBe(1);
  });

  it("rejects a job start outside a sandbox-required coding run", async () => {
    const result = await commandJobTool.execute({ action: "start", commandPlan: plan }, {
      ...context(),
      launchSpec: undefined,
    });

    expect(result).toMatchObject({
      success: false,
      failureKind: "permission_or_policy",
      error: expect.stringContaining("sandbox-required coding runs"),
    });
    expect(mocks.createProcess).not.toHaveBeenCalled();
  });
});
