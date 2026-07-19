import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundRunCoordinator } from "../background-run-coordinator.js";
import { startCronScheduler } from "./scheduler.js";
import { computeNextRunForJob } from "./store.js";
import type { CronJob } from "./types.js";

function createCronJob(partial: Omit<CronJob, "sessionTarget" | "delivery"> & Partial<Pick<CronJob, "sessionTarget" | "delivery" | "failureDestination">>): CronJob {
  return {
    sessionTarget: partial.sessionTarget ?? "main",
    delivery: partial.delivery ?? { mode: "user" },
    ...partial,
  };
}

describe("startCronScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("executes goalApprovalScan payloads without requiring an agent prompt", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-21T08:00:00.000Z");
    vi.setSystemTime(now);
    const job: CronJob = createCronJob({
      id: "cron_approval_scan",
      name: "approval scan",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now.getTime() - 60_000,
      },
      payload: {
        kind: "goalApprovalScan",
        allGoals: true,
        autoEscalate: true,
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    const runGoalApprovalScan = vi.fn(async () => ({
      summary: "approval_scan goals=2 ok=2 failed=0 review_overdue=1 review_escalated=1 checkpoint_overdue=0 checkpoint_escalated=0 notifications=2",
      notifyMessage: "审批扫描完成：存在 1 条超时审批",
    }));
    const deliverToUser = vi.fn(async () => {});

    const scheduler = startCronScheduler({
      store: store as never,
      runGoalApprovalScan,
      deliverToUser,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();

    expect(runGoalApprovalScan).toHaveBeenCalledWith({
      kind: "goalApprovalScan",
      allGoals: true,
      autoEscalate: true,
    });
    expect(deliverToUser).toHaveBeenCalledWith(expect.stringContaining("审批扫描完成"));
    expect(store.saveJobs).toHaveBeenCalledTimes(1);
    expect(job.state.lastStatus).toBe("ok");
    expect(job.state.lastError).toBeUndefined();
    expect(job.state.lastDurationMs).toBeTypeOf("number");
    expect(job.state.nextRunAtMs).toBeGreaterThan(now.getTime());
  });

  it("marks systemEvent job as error when no agent executor is available", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-21T08:10:00.000Z");
    vi.setSystemTime(now);
    const job: CronJob = createCronJob({
      id: "cron_system_event",
      name: "system event",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "at",
        at: new Date(now.getTime() - 1_000).toISOString(),
      },
      payload: {
        kind: "systemEvent",
        text: "ping",
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };

    const scheduler = startCronScheduler({
      store: store as never,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();

    expect(job.state.lastStatus).toBe("error");
    expect(job.state.lastError).toContain("Cron systemEvent executor is not available");
    expect(job.enabled).toBe(false);
    expect(job.state.nextRunAtMs).toBeUndefined();
  });

  it("does not overlap scheduler ticks while a previous job is still running", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-21T08:20:00.000Z");
    vi.setSystemTime(now);
    const job: CronJob = createCronJob({
      id: "cron_overlap_guard",
      name: "slow system event",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now.getTime() - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "slow run",
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };

    let releaseRun: (() => void) | undefined;
    const sendMessage = vi.fn().mockImplementation(() => new Promise<string>((resolve) => {
      releaseRun = () => resolve("done");
    }));

    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    releaseRun?.();
    await vi.runOnlyPendingTimersAsync();
    scheduler.stop();
  });

  it("does not replay a tick-owned job through runJobNow", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-03T10:01:00.000Z");
    vi.setSystemTime(now);
    const job = createCronJob({
      id: "cron_tick_manual_claim",
      name: "tick manual claim",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now.getTime() - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "hold the scheduled run",
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    const releaseRuns: Array<() => void> = [];
    let markTickStarted: (() => void) | undefined;
    let markManualStarted: (() => void) | undefined;
    const tickStarted = new Promise<void>((resolve) => {
      markTickStarted = resolve;
    });
    const manualStarted = new Promise<void>((resolve) => {
      markManualStarted = resolve;
    });
    const sendMessage = vi.fn(() => new Promise<string>((resolve) => {
      releaseRuns.push(() => resolve("scheduled run complete"));
      if (releaseRuns.length === 1) {
        markTickStarted?.();
      } else {
        markManualStarted?.();
      }
    }));
    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    let manualRun: ReturnType<typeof scheduler.runJobNow> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      await tickStarted;

      manualRun = scheduler.runJobNow(job.id);
      const outcome = await Promise.race([
        manualRun.then((result) => ({ kind: "result" as const, result })),
        manualStarted.then(() => ({ kind: "started" as const })),
      ]);

      expect(outcome).toEqual({
        kind: "result",
        result: {
          status: "skipped",
          reason: "Cron job cron_tick_manual_claim is already running.",
        },
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      scheduler.stop();
      for (const releaseRun of releaseRuns) {
        releaseRun();
      }
      await Promise.allSettled([manualRun ?? Promise.resolve()]);
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it("keeps runJobNow within the global concurrent run limit", async () => {
    const now = Date.now();
    const jobs = ["one", "two", "three", "four"].map((suffix) => createCronJob({
      id: `cron_manual_limit_${suffix}`,
      name: `manual limit ${suffix}`,
      enabled: true,
      createdAtMs: now - 60_000,
      updatedAtMs: now - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: `manual ${suffix}`,
      },
      state: {
        nextRunAtMs: now + 60_000,
      },
    }));
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    const startWaiters = new Map<string, () => void>();
    const starts = new Map<string, Promise<void>>();
    for (const job of jobs) {
      starts.set(job.id, new Promise<void>((resolve) => {
        startWaiters.set(job.id, resolve);
      }));
    }
    const releaseRuns = new Map<string, () => void>();
    const sendMessage = vi.fn((job: CronJob) => new Promise<string>((resolve) => {
      releaseRuns.set(job.id, () => resolve(`done:${job.id}`));
      startWaiters.get(job.id)?.();
    }));
    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    const firstRun = scheduler.runJobNow(jobs[0].id);
    const secondRun = scheduler.runJobNow(jobs[1].id);
    const thirdRun = scheduler.runJobNow(jobs[2].id);
    let fourthRun: ReturnType<typeof scheduler.runJobNow> | undefined;
    try {
      await Promise.all([starts.get(jobs[0].id), starts.get(jobs[1].id), starts.get(jobs[2].id)]);

      fourthRun = scheduler.runJobNow(jobs[3].id);
      const outcome = await Promise.race([
        fourthRun.then((result) => ({ kind: "result" as const, result })),
        starts.get(jobs[3].id)!.then(() => ({ kind: "started" as const })),
      ]);

      expect(outcome).toEqual({
        kind: "result",
        result: {
          status: "skipped",
          reason: "Cron scheduler has reached its concurrent run limit.",
        },
      });
      expect(sendMessage).toHaveBeenCalledTimes(3);
    } finally {
      scheduler.stop();
      for (const releaseRun of releaseRuns.values()) {
        releaseRun();
      }
      await Promise.allSettled([firstRun, secondRun, thirdRun, fourthRun ?? Promise.resolve()]);
    }
  });

  it("honors shared BackgroundRunCoordinator capacity for manual Cron runs", async () => {
    const now = Date.now();
    const job = createCronJob({
      id: "cron_shared_background_budget",
      name: "shared background budget",
      enabled: true,
      createdAtMs: now - 60_000,
      updatedAtMs: now - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "shared coordinator",
      },
      state: {
        nextRunAtMs: now + 60_000,
      },
    });
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const heldHeartbeatClaim = coordinator.tryClaim({ kind: "heartbeat", key: "heartbeat" });
    if ("reason" in heldHeartbeatClaim) {
      throw new Error(heldHeartbeatClaim.reason);
    }
    const sendMessage = vi.fn(async () => "completed");
    const scheduler = startCronScheduler({
      store: {
        list: vi.fn(async () => [job]),
        saveJobs: vi.fn(async () => {}),
      } as never,
      sendMessage,
      runCoordinator: coordinator,
      log: () => {},
    });

    try {
      await expect(scheduler.runJobNow(job.id)).resolves.toEqual({
        status: "skipped",
        reason: "Background run coordinator has reached its concurrent run limit.",
      });
      expect(sendMessage).not.toHaveBeenCalled();

      heldHeartbeatClaim.release();
      await expect(scheduler.runJobNow(job.id)).resolves.toMatchObject({ status: "ok" });
      expect(sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      scheduler.stop();
      heldHeartbeatClaim.release();
    }
  });

  it("stopAndDrain closes new Cron runs and waits for all accepted jobs", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-03T10:11:00.000Z");
    vi.setSystemTime(now);
    const jobs = ["one", "two"].map((suffix) => createCronJob({
      id: `cron_drain_${suffix}`,
      name: `drain ${suffix}`,
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now.getTime() - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: `hold ${suffix}`,
      },
      state: {
        nextRunAtMs: now.getTime() + 60_000,
      },
    }));
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    const startWaiters = new Map<string, () => void>();
    const starts = new Map<string, Promise<void>>();
    const releaseRuns = new Map<string, () => void>();
    for (const job of jobs) {
      starts.set(job.id, new Promise<void>((resolve) => {
        startWaiters.set(job.id, resolve);
      }));
    }
    const sendMessage = vi.fn((job: CronJob) => new Promise<string>((resolve) => {
      releaseRuns.set(job.id, () => resolve(`done:${job.id}`));
      startWaiters.get(job.id)?.();
    }));
    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    const firstRun = scheduler.runJobNow(jobs[0].id);
    const secondRun = scheduler.runJobNow(jobs[1].id);
    try {
      await Promise.all([starts.get(jobs[0].id), starts.get(jobs[1].id)]);

      expect(scheduler.stopAndDrain).toBeTypeOf("function");
      const firstDrain = scheduler.stopAndDrain();
      expect(scheduler.stopAndDrain()).toBe(firstDrain);
      await expect(scheduler.runJobNow(jobs[0].id)).resolves.toEqual({
        status: "skipped",
        reason: "Cron scheduler is stopped.",
      });

      let drained = false;
      void firstDrain.then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);

      releaseRuns.get(jobs[0].id)?.();
      await firstRun;
      await Promise.resolve();
      expect(drained).toBe(false);

      releaseRuns.get(jobs[1].id)?.();
      await secondRun;
      await firstDrain;
      expect(drained).toBe(true);
      expect(scheduler.status().activeRuns).toBe(0);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(sendMessage).toHaveBeenCalledTimes(2);
    } finally {
      scheduler.stop();
      for (const releaseRun of releaseRuns.values()) {
        releaseRun();
      }
      await Promise.allSettled([firstRun, secondRun]);
    }
  });

  it("stopAndDrain waits for a tick-owned Cron job", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-03T10:21:00.000Z");
    vi.setSystemTime(now);
    const job = createCronJob({
      id: "cron_tick_drain",
      name: "tick drain",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now.getTime() - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "hold tick drain",
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    let releaseRun: (() => void) | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const sendMessage = vi.fn(() => new Promise<string>((resolve) => {
      releaseRun = () => resolve("tick drained");
      markStarted();
    }));
    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await started;
    try {
      const drain = scheduler.stopAndDrain();
      let drained = false;
      void drain.then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);

      releaseRun?.();
      await drain;
      expect(drained).toBe(true);
      expect(scheduler.status().activeRuns).toBe(0);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      scheduler.stop();
      releaseRun?.();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it("includes a manually claimed job when its started event stops the scheduler", async () => {
    const now = Date.now();
    const job = createCronJob({
      id: "cron_reentrant_drain",
      name: "reentrant drain",
      enabled: true,
      createdAtMs: now - 60_000,
      updatedAtMs: now - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "stop from started event",
      },
      state: {
        nextRunAtMs: now + 60_000,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    let releaseRun: (() => void) | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let scheduler!: ReturnType<typeof startCronScheduler>;
    let drain: Promise<void> | undefined;
    scheduler = startCronScheduler({
      store: store as never,
      sendMessage: vi.fn(() => new Promise<string>((resolve) => {
        releaseRun = () => resolve("reentrant drain complete");
        markStarted();
      })),
      onExecutionEvent: (event) => {
        if (event.phase === "started") {
          drain = scheduler.stopAndDrain();
        }
      },
      log: () => {},
    });

    const run = scheduler.runJobNow(job.id);
    await started;
    try {
      expect(drain).toBeDefined();
      let drained = false;
      void drain!.then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);

      releaseRun?.();
      await run;
      await drain;
      expect(drained).toBe(true);
    } finally {
      scheduler.stop();
      releaseRun?.();
      await Promise.allSettled([run, drain ?? Promise.resolve()]);
    }
  });

  it("settles stopAndDrain when an accepted manual Cron run fails", async () => {
    const now = Date.now();
    const job = createCronJob({
      id: "cron_drain_save_failure",
      name: "drain save failure",
      enabled: true,
      createdAtMs: now - 60_000,
      updatedAtMs: now - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "save failure",
      },
      state: {
        nextRunAtMs: now + 60_000,
      },
    });
    const store = {
      list: vi.fn(async () => [job]),
      saveJobs: vi.fn(async () => {
        throw new Error("Cron state save failed.");
      }),
    };
    let releaseRun: (() => void) | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage: vi.fn(() => new Promise<string>((resolve) => {
        releaseRun = () => resolve("save failed after execution");
        markStarted();
      })),
      log: () => {},
    });

    const run = scheduler.runJobNow(job.id);
    await started;
    const drain = scheduler.stopAndDrain();
    try {
      releaseRun?.();
      await expect(run).rejects.toThrow("Cron state save failed.");
      await expect(drain).resolves.toBeUndefined();
      expect(scheduler.status().activeRuns).toBe(0);
    } finally {
      scheduler.stop();
      releaseRun?.();
      await Promise.allSettled([run, drain]);
    }
  });

  it("executes dailyAt jobs and advances to the next day", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-30T09:01:00.000Z");
    vi.setSystemTime(now);
    const job: CronJob = createCronJob({
      id: "cron_daily_at",
      name: "daily sync",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "dailyAt",
        time: "09:00",
        timezone: "UTC",
      },
      payload: {
        kind: "systemEvent",
        text: "daily check",
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    const sendMessage = vi.fn(async () => "done");

    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(job.state.lastStatus).toBe("ok");
    expect(job.state.nextRunAtMs).toBe(Date.parse("2026-03-31T09:00:00.000Z"));
  });

  it("executes weeklyAt jobs and advances to the next matching weekday", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-03T10:31:00.000Z"); // Friday
    vi.setSystemTime(now);
    const job: CronJob = createCronJob({
      id: "cron_weekly_at",
      name: "weekly sync",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "weeklyAt",
        weekdays: [1, 3, 5],
        time: "10:30",
        timezone: "UTC",
      },
      payload: {
        kind: "systemEvent",
        text: "weekly check",
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    const sendMessage = vi.fn(async () => "done");

    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(job.state.lastStatus).toBe("ok");
    expect(job.state.nextRunAtMs).toBe(Date.parse("2026-04-06T10:30:00.000Z"));
  });

  it("passes a stable conversation to main jobs and a new one to isolated jobs", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-03T10:31:00.000Z");
    vi.setSystemTime(now);
    const mainJob = createCronJob({
      id: "cron_main_job",
      name: "main sync",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      sessionTarget: "main",
      schedule: { kind: "at", at: new Date(now.getTime() - 1_000).toISOString() },
      payload: { kind: "systemEvent", text: "main check" },
      state: { nextRunAtMs: now.getTime() - 1 },
    });
    const isolatedJob = createCronJob({
      id: "cron_isolated_job",
      name: "isolated sync",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      sessionTarget: "isolated",
      schedule: { kind: "at", at: new Date(now.getTime() - 1_000).toISOString() },
      payload: { kind: "systemEvent", text: "isolated check" },
      state: { nextRunAtMs: now.getTime() - 1 },
    });
    const jobs = [mainJob, isolatedJob];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async () => {}),
    };
    const sendMessage = vi.fn(async (job: CronJob) => `done:${job.id}`);

    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "cron_main_job", sessionTarget: "main" }), "main check");
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "cron_isolated_job", sessionTarget: "isolated" }), "isolated check");
  });

  it("suppresses success delivery when delivery.mode is none and sends failure notices when configured", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-03T10:31:00.000Z");
    vi.setSystemTime(now);
    const silentJob = createCronJob({
      id: "cron_silent_job",
      name: "silent sync",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      delivery: { mode: "none" },
      schedule: { kind: "at", at: new Date(now.getTime() - 1_000).toISOString() },
      payload: { kind: "systemEvent", text: "silent check" },
      state: { nextRunAtMs: now.getTime() - 1 },
    });
    const failingJob = createCronJob({
      id: "cron_failure_job",
      name: "failing sync",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      failureDestination: { mode: "user" },
      schedule: { kind: "at", at: new Date(now.getTime() - 1_000).toISOString() },
      payload: { kind: "systemEvent", text: "failing check" },
      state: { nextRunAtMs: now.getTime() - 1 },
    });
    const jobs = [silentJob, failingJob];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async () => {}),
    };
    const sendMessage = vi.fn()
      .mockResolvedValueOnce("silent done")
      .mockRejectedValueOnce(new Error("boom"));
    const deliverToUser = vi.fn(async () => {});

    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      deliverToUser,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();

    expect(deliverToUser).toHaveBeenCalledTimes(1);
    expect(deliverToUser).toHaveBeenCalledWith(expect.stringContaining("执行失败"));
  });

  it("keeps staggered schedules on subsequent nextRun recalculation", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-03T10:31:00.000Z");
    vi.setSystemTime(now);
    const job = createCronJob({
      id: "cron_staggered_job",
      name: "staggered sync",
      enabled: true,
      createdAtMs: now.getTime() - 60_000,
      updatedAtMs: now.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: now.getTime() - 60_000,
        staggerMs: 15_000,
      },
      payload: {
        kind: "systemEvent",
        text: "staggered check",
      },
      state: {
        nextRunAtMs: now.getTime() - 1,
      },
    });
    const jobs = [job];
    const store = {
      list: vi.fn(async () => jobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        jobs.splice(0, jobs.length, ...nextJobs);
      }),
    };
    const sendMessage = vi.fn(async () => "done");

    const scheduler = startCronScheduler({
      store: store as never,
      sendMessage,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.stop();

    const expectedNextRunAtMs = computeNextRunForJob(job, Date.now());
    expect(job.state.lastStatus).toBe("ok");
    expect(job.state.nextRunAtMs).toBe(expectedNextRunAtMs);
    expect(job.state.nextRunAtMs).toBeGreaterThan(Date.now());
  });

  it("marks due jobs as skipped when scheduler is blocked by active hours or busy state", async () => {
    vi.useFakeTimers();
    const outsideHoursNow = new Date("2026-04-03T03:31:00.000Z");
    vi.setSystemTime(outsideHoursNow);
    const outsideHoursJob = createCronJob({
      id: "cron_outside_hours",
      name: "outside hours sync",
      enabled: true,
      createdAtMs: outsideHoursNow.getTime() - 60_000,
      updatedAtMs: outsideHoursNow.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: outsideHoursNow.getTime() - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "should wait for active window",
      },
      state: {
        nextRunAtMs: outsideHoursNow.getTime() - 1,
      },
    });
    const activeHoursJobs = [outsideHoursJob];
    const activeHoursStore = {
      list: vi.fn(async () => activeHoursJobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        activeHoursJobs.splice(0, activeHoursJobs.length, ...nextJobs);
      }),
    };
    const activeHoursScheduler = startCronScheduler({
      store: activeHoursStore as never,
      sendMessage: vi.fn(async () => "done"),
      activeHours: { start: "08:00", end: "23:00" },
      timezone: "UTC",
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    activeHoursScheduler.stop();

    expect(outsideHoursJob.state.lastStatus).toBe("skipped");
    expect(outsideHoursJob.state.lastError).toBe("Skipped: outside active hours.");
    expect(outsideHoursJob.state.lastDurationMs).toBe(0);
    expect(outsideHoursJob.state.nextRunAtMs).toBe(outsideHoursNow.getTime() - 1);
    expect(activeHoursStore.saveJobs).toHaveBeenCalledTimes(1);

    const busyNow = new Date("2026-04-03T10:31:00.000Z");
    vi.setSystemTime(busyNow);
    const busyJob = createCronJob({
      id: "cron_busy",
      name: "busy sync",
      enabled: true,
      createdAtMs: busyNow.getTime() - 60_000,
      updatedAtMs: busyNow.getTime() - 60_000,
      schedule: {
        kind: "every",
        everyMs: 60_000,
        anchorMs: busyNow.getTime() - 60_000,
      },
      payload: {
        kind: "systemEvent",
        text: "should wait for idle state",
      },
      state: {
        nextRunAtMs: busyNow.getTime() - 1,
      },
    });
    const busyJobs = [busyJob];
    const busyStore = {
      list: vi.fn(async () => busyJobs),
      saveJobs: vi.fn(async (nextJobs: CronJob[]) => {
        busyJobs.splice(0, busyJobs.length, ...nextJobs);
      }),
    };
    const sendMessage = vi.fn(async () => "done");
    const busyScheduler = startCronScheduler({
      store: busyStore as never,
      sendMessage,
      isBusy: () => true,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(30_000);
    busyScheduler.stop();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(busyJob.state.lastStatus).toBe("skipped");
    expect(busyJob.state.lastError).toBe("Skipped: scheduler is busy.");
    expect(busyJob.state.lastDurationMs).toBe(0);
    expect(busyJob.state.nextRunAtMs).toBe(busyNow.getTime() - 1);
    expect(busyStore.saveJobs).toHaveBeenCalledTimes(1);
  });
});
