import { describe, expect, it, vi } from "vitest";

import {
  BackgroundRunCoordinator,
  type BackgroundRunClaimResult,
} from "./background-run-coordinator.js";
import type { MemoryBackgroundJobClaim } from "./memory-background-job-scheduler.js";
import { startMemoryIdleSummaryRuntime } from "./memory-idle-summary-runtime.js";

function requireClaim(result: BackgroundRunClaimResult) {
  if ("reason" in result) {
    throw new Error(`Expected claim to be accepted: ${result.reason}`);
  }
  return result;
}

describe("memory idle summary runtime", () => {
  it("uses the Memory scheduler agent key and passes its claim signal to the manager", async () => {
    const controller = new AbortController();
    const complete = vi.fn();
    const claim: MemoryBackgroundJobClaim = {
      generation: 1,
      signal: controller.signal,
      complete: async <T>(commit: () => T | Promise<T>) => {
        complete();
        return { applied: true, value: await commit() };
      },
      release: vi.fn(async () => undefined),
    };
    const jobScheduler = {
      acquire: vi.fn(async () => claim),
    };
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async (_options?: { signal?: AbortSignal }) => 1),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager],
      resolveAgentId: () => "coder",
      jobScheduler,
    });

    await runtime.runOnce();

    expect(jobScheduler.acquire).toHaveBeenCalledWith({
      family: "idle_summary",
      agentId: "coder",
      priority: "low",
      estimatedTokenUnits: expect.any(Number),
      signal: expect.any(AbortSignal),
    });
    expect(manager.runIdleSummaries).toHaveBeenCalledWith({
      signal: controller.signal,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    await runtime.stopAndDrain();
  });

  it("cancels queued summary admission when the runtime stops", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const blockingClaim = requireClaim(coordinator.tryClaim({ kind: "cron", key: "blocking" }));
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async () => 1),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager],
      runCoordinator: coordinator,
    });

    const run = runtime.runOnce();
    await vi.waitFor(() => {
      expect(coordinator.getRuntimeSnapshot().queuedByKind.memory).toBe(1);
    });

    runtime.stop();
    await expect(run).resolves.toBeUndefined();
    await expect(runtime.stopAndDrain()).resolves.toBeUndefined();

    expect(manager.runIdleSummaries).not.toHaveBeenCalled();
    expect(coordinator.getRuntimeSnapshot().queuedByKind.memory).toBe(0);
    blockingClaim.release();
  });

  it("replaces the previous timer owner and starts no work after stop", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new BackgroundRunCoordinator();
      const manager = {
        isPaused: false,
        pause: vi.fn(),
        resume: vi.fn(),
        runIdleSummaries: vi.fn(async () => 0),
      };
      startMemoryIdleSummaryRuntime({
        summaryEnabled: true,
        intervalMs: 1_000,
        listManagers: () => [manager],
        runCoordinator: coordinator,
      });
      const current = startMemoryIdleSummaryRuntime({
        summaryEnabled: true,
        intervalMs: 1_000,
        listManagers: () => [manager],
        runCoordinator: coordinator,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(manager.runIdleSummaries).toHaveBeenCalledTimes(1);

      current.stop();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(manager.runIdleSummaries).toHaveBeenCalledTimes(1);
      await current.stopAndDrain();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs a shared manager only once per idle summary cycle", async () => {
    const coordinator = new BackgroundRunCoordinator();
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async () => 0),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager, manager],
      runCoordinator: coordinator,
    });

    await runtime.runOnce();

    expect(manager.runIdleSummaries).toHaveBeenCalledTimes(1);
    runtime.stop();
    await runtime.stopAndDrain();
  });

  it("pauses managers while agents are active and resumes after the idle delay", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new BackgroundRunCoordinator();
      const manager = {
        isPaused: false,
        pause: vi.fn(),
        resume: vi.fn(),
        runIdleSummaries: vi.fn(async () => 0),
      };
      const runtime = startMemoryIdleSummaryRuntime({
        summaryEnabled: false,
        intervalMs: 60_000,
        resumeDelayMs: 3_000,
        listManagers: () => [manager],
        runCoordinator: coordinator,
      });

      runtime.onAgentStart();
      expect(manager.pause).toHaveBeenCalledTimes(1);

      runtime.onAgentEnd();
      await vi.advanceTimersByTimeAsync(2_999);
      expect(manager.resume).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(manager.resume).toHaveBeenCalledTimes(1);

      runtime.stop();
      await runtime.stopAndDrain();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts no summary work while an agent is active", async () => {
    const coordinator = new BackgroundRunCoordinator();
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async () => 0),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager],
      runCoordinator: coordinator,
    });

    runtime.onAgentStart();
    await runtime.runOnce();

    expect(manager.runIdleSummaries).not.toHaveBeenCalled();
    expect(coordinator.getRuntimeSnapshot().activeByKind.memory).toBe(0);
    runtime.stop();
    await runtime.stopAndDrain();
  });

  it("logs only the aggregate count after a current summary claim completes", async () => {
    const coordinator = new BackgroundRunCoordinator();
    const info = vi.fn();
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async () => 2),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager],
      runCoordinator: coordinator,
      logger: { info },
    });

    await runtime.runOnce();

    expect(info).toHaveBeenCalledWith("Idle summary run: generated 2 summaries");
    runtime.stop();
    await runtime.stopAndDrain();
  });

  it("reports a manager failure and releases its admission", async () => {
    const coordinator = new BackgroundRunCoordinator();
    const error = vi.fn();
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async () => {
        throw new Error("summary failed");
      }),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager],
      runCoordinator: coordinator,
      logger: { error },
    });

    await runtime.runOnce();

    expect(error).toHaveBeenCalledWith("Idle summary failed: summary failed");
    expect(coordinator.getRuntimeSnapshot().activeByKind.memory).toBe(0);
    runtime.stop();
    await runtime.stopAndDrain();
  });

  it("reports manager discovery failures without rejecting scheduled work", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new BackgroundRunCoordinator();
      const error = vi.fn();
      const runtime = startMemoryIdleSummaryRuntime({
        summaryEnabled: true,
        intervalMs: 1_000,
        listManagers: () => {
          throw new Error("manager discovery failed");
        },
        runCoordinator: coordinator,
        logger: { error },
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(error).toHaveBeenCalledWith("Idle summary failed: manager discovery failed");
      runtime.stop();
      await runtime.stopAndDrain();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports admission failures and remains drainable", async () => {
    const error = vi.fn();
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async () => 0),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager],
      runCoordinator: {
        tryClaim: () => ({ reason: "unavailable" }),
        acquire: async () => {
          throw new Error("admission failed");
        },
      },
      logger: { error },
    });

    await expect(runtime.runOnce()).resolves.toBeUndefined();
    await expect(runtime.stopAndDrain()).resolves.toBeUndefined();

    expect(manager.runIdleSummaries).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Idle summary failed: admission failed");
  });

  it("drains accepted work without committing its late success after stop", async () => {
    const coordinator = new BackgroundRunCoordinator();
    const info = vi.fn();
    let finishSummary!: () => void;
    const summaryGate = new Promise<void>((resolve) => {
      finishSummary = resolve;
    });
    const manager = {
      isPaused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      runIdleSummaries: vi.fn(async () => {
        await summaryGate;
        return 1;
      }),
    };
    const runtime = startMemoryIdleSummaryRuntime({
      summaryEnabled: true,
      intervalMs: 60_000,
      listManagers: () => [manager],
      runCoordinator: coordinator,
      logger: { info },
    });

    const run = runtime.runOnce();
    await vi.waitFor(() => {
      expect(manager.runIdleSummaries).toHaveBeenCalledTimes(1);
    });
    let drained = false;
    const drain = runtime.stopAndDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    finishSummary();
    await run;
    await drain;

    expect(info).not.toHaveBeenCalled();
    expect(coordinator.getRuntimeSnapshot().activeByKind.memory).toBe(0);
  });
});
