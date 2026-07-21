import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BackgroundRunCoordinator } from "../background-run-coordinator.js";
import type { CronJob } from "../cron/index.js";

const browserMocks = vi.hoisted(() => {
  const relay = {
    port: 28892,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
  return {
    relay,
    RelayServer: vi.fn(() => relay),
    resolveRelayCredential: vi.fn(async () => ({ token: "relay-token", source: "generated" })),
  };
});

vi.mock("@belldandy/browser", () => ({
  RelayServer: browserMocks.RelayServer,
  resolveRelayCredential: browserMocks.resolveRelayCredential,
}));

import {
  startBrowserRelayRuntime,
  startCronRuntime,
  startHeartbeatRuntime,
} from "./gateway-background-runtime.js";

function createLogger() {
  const childLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    child: vi.fn(() => childLogger),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("startBrowserRelayRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the started relay handle so Gateway shutdown can own it", async () => {
    const logger = createLogger();

    const handle = await startBrowserRelayRuntime({
      enabled: true,
      port: 28892,
      stateDir: "C:/state",
      logger,
    });

    expect(handle).toBe(browserMocks.relay);
    expect(browserMocks.relay.start).toHaveBeenCalledTimes(1);
  });

  it("returns no handle when disabled or startup fails", async () => {
    const logger = createLogger();

    await expect(startBrowserRelayRuntime({
      enabled: false,
      port: 28892,
      stateDir: "C:/state",
      logger,
    })).resolves.toBeUndefined();

    browserMocks.relay.start.mockRejectedValueOnce(new Error("bind failed"));
    await expect(startBrowserRelayRuntime({
      enabled: true,
      port: 28892,
      stateDir: "C:/state",
      logger,
    })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("startCronRuntime", () => {
  it("forwards the coordinator claim signal into the Cron agent", async () => {
    const now = Date.now();
    const job: CronJob = {
      id: "cron_gateway_signal",
      name: "gateway signal",
      enabled: true,
      createdAtMs: now - 60_000,
      updatedAtMs: now - 60_000,
      schedule: { kind: "every", everyMs: 60_000, anchorMs: now - 60_000 },
      payload: { kind: "systemEvent", text: "observe gateway signal" },
      sessionTarget: "main",
      delivery: { mode: "none" },
      state: { nextRunAtMs: now + 60_000 },
    };
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    let observedSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishAgent!: () => void;
    const agentGate = new Promise<void>((resolve) => {
      finishAgent = resolve;
    });
    const backgroundContinuationLedger = {
      startRun: vi.fn(async () => ({})),
      finishRun: vi.fn(async () => ({ status: "ran" })),
    };
    const scheduler = await startCronRuntime({
      enabled: true,
      createAgent: () => ({
        async *run(input) {
          observedSignal = input.abortSignal;
          markStarted();
          await agentGate;
          yield { type: "final" as const, text: "late result" };
        },
      }),
      cronStore: {
        list: vi.fn(async () => [job]),
        saveJobs: vi.fn(async () => {}),
      } as never,
      conversationStore: {} as never,
      broadcast: vi.fn(),
      deliverToLatestBoundExternalChannel: vi.fn(async () => false),
      backgroundContinuationLedger: backgroundContinuationLedger as never,
      goalManager: {} as never,
      runCoordinator: coordinator,
      isBusy: () => false,
      logger: createLogger(),
    });
    if (!scheduler) throw new Error("Cron runtime did not start.");
    const run = scheduler.runJobNow(job.id);
    await started;
    const drain = coordinator.stopAndDrain();

    try {
      expect(observedSignal).toBeInstanceOf(AbortSignal);
      expect(observedSignal?.aborted).toBe(true);
      finishAgent();
      await expect(run).resolves.toMatchObject({ status: "skipped" });
      await expect(drain).resolves.toBeUndefined();
      expect(backgroundContinuationLedger.finishRun).not.toHaveBeenCalled();
    } finally {
      finishAgent();
      await Promise.allSettled([run, drain]);
      scheduler.stop();
    }
  });
});

describe("startHeartbeatRuntime", () => {
  it("forwards the coordinator claim signal into the Heartbeat agent", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-gateway-heartbeat-"));
    await fs.writeFile(path.join(stateDir, "HEARTBEAT.md"), "observe gateway heartbeat signal");
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    let observedSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishAgent!: () => void;
    const agentGate = new Promise<void>((resolve) => {
      finishAgent = resolve;
    });
    const backgroundContinuationLedger = {
      startRun: vi.fn(async () => ({})),
      finishRun: vi.fn(async () => ({ status: "ran" })),
    };
    const runner = await startHeartbeatRuntime({
      enabled: true,
      createAgent: () => ({
        async *run(input) {
          observedSignal = input.abortSignal;
          markStarted();
          await agentGate;
          yield { type: "final" as const, text: "late heartbeat" };
        },
      }),
      heartbeatIntervalRaw: "30m",
      stateDir,
      conversationStore: {} as never,
      broadcast: vi.fn(),
      deliverToLatestBoundExternalChannel: vi.fn(async () => false),
      backgroundContinuationLedger: backgroundContinuationLedger as never,
      runCoordinator: coordinator,
      isBusy: () => false,
      logger: createLogger(),
    });
    if (!runner) throw new Error("Heartbeat runtime did not start.");
    const run = runner.runOnce();
    await started;
    const drain = coordinator.stopAndDrain();

    try {
      expect(observedSignal).toBeInstanceOf(AbortSignal);
      expect(observedSignal?.aborted).toBe(true);
      finishAgent();
      await expect(run).resolves.toEqual({
        status: "skipped",
        reason: "heartbeat-claim-not-active",
      });
      await expect(drain).resolves.toBeUndefined();
      expect(backgroundContinuationLedger.finishRun).not.toHaveBeenCalled();
    } finally {
      finishAgent();
      await Promise.allSettled([run, drain]);
      runner.stop();
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
