import { describe, expect, it, vi } from "vitest";

import {
  BackgroundRunCoordinator,
  type BackgroundRunClaimResult,
} from "./background-run-coordinator.js";

function requireClaim(result: BackgroundRunClaimResult) {
  if ("reason" in result) {
    throw new Error(`Expected claim to be accepted: ${result.reason}`);
  }
  return result;
}

describe("BackgroundRunCoordinator", () => {
  it("applies completion only for the current run generation", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const first = requireClaim(coordinator.tryClaim({ kind: "memory", key: "idle-summary" }));
    const committed: string[] = [];

    expect(first.generation).toBe(1);
    first.release();

    const second = requireClaim(coordinator.tryClaim({ kind: "memory", key: "idle-summary" }));
    expect(second.generation).toBe(2);
    await expect(first.complete(async () => {
      committed.push("stale");
      return "stale";
    })).resolves.toEqual({ applied: false });
    await expect(second.complete(async () => {
      committed.push("current");
      return "current";
    })).resolves.toEqual({ applied: true, value: "current" });

    expect(committed).toEqual(["current"]);
    expect(coordinator.getRuntimeSnapshot().activeCount).toBe(0);
  });

  it("stops intake, aborts active claims, and drains after aborted completion settles", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const claim = requireClaim(coordinator.tryClaim({ kind: "dream", key: "auto" }));
    const committed: string[] = [];
    let drained = false;

    const drain = coordinator.stopAndDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();

    expect(claim.signal.aborted).toBe(true);
    expect(drained).toBe(false);
    expect(coordinator.tryClaim({ kind: "memory", key: "idle-summary" })).toEqual({
      reason: "Background run coordinator is stopped.",
    });
    await expect(claim.complete(async () => {
      committed.push("late");
    })).resolves.toEqual({ applied: false });
    await expect(drain).resolves.toBeUndefined();

    expect(committed).toEqual([]);
    expect(drained).toBe(true);
    expect(coordinator.getRuntimeSnapshot().activeCount).toBe(0);
  });

  it("keeps the generation claim until an asynchronous completion commit settles", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const claim = requireClaim(coordinator.tryClaim({ kind: "cron", key: "daily" }));
    let finishCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      finishCommit = resolve;
    });
    const completion = claim.complete(async () => {
      await commitGate;
      return "stored";
    });

    claim.release();
    expect(coordinator.tryClaim({ kind: "cron", key: "daily" })).toEqual({
      reason: "Background cron run daily is already running.",
    });

    finishCommit();
    await expect(completion).resolves.toEqual({ applied: true, value: "stored" });
    const next = requireClaim(coordinator.tryClaim({ kind: "cron", key: "daily" }));
    expect(next.generation).toBe(2);
    next.release();
  });

  it("queues an asynchronous admission until shared capacity is released", async () => {
    const coordinator = new BackgroundRunCoordinator({
      maxConcurrentRuns: 1,
      maxQueuedRuns: 2,
    });
    const active = requireClaim(coordinator.tryClaim({ kind: "cron", key: "daily" }));
    let admitted = false;
    const pending = coordinator.acquire({ kind: "heartbeat", key: "heartbeat" }).then((result) => {
      admitted = true;
      return result;
    });
    await Promise.resolve();

    expect(admitted).toBe(false);
    expect(coordinator.getRuntimeSnapshot().queuedCount).toBe(1);

    active.release();
    const heartbeat = requireClaim(await pending);
    expect(heartbeat.generation).toBe(2);
    expect(coordinator.getRuntimeSnapshot()).toMatchObject({
      activeCount: 1,
      queuedCount: 0,
    });
    heartbeat.release();
  });

  it("removes an aborted asynchronous admission before it can start", async () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const active = requireClaim(coordinator.tryClaim({ kind: "cron", key: "daily" }));
    const controller = new AbortController();
    const pending = coordinator.acquire({
      kind: "memory",
      key: "idle-summary",
      signal: controller.signal,
    });

    controller.abort(new Error("test cancellation"));
    const result = await Promise.race([
      pending,
      Promise.resolve({ reason: "Background run request did not settle after abort." }),
    ]);

    expect(result).toEqual({ reason: "Background run request was aborted." });
    expect(coordinator.getRuntimeSnapshot().queuedCount).toBe(0);
    active.release();
    expect(coordinator.getRuntimeSnapshot().activeCount).toBe(0);
  });

  it("bounds the queue and reports aggregate wait and rejection watermarks", async () => {
    let now = 1_000;
    const coordinator = new BackgroundRunCoordinator({
      maxConcurrentRuns: 1,
      maxQueuedRuns: 1,
      now: () => now,
    });
    const active = requireClaim(coordinator.tryClaim({ kind: "cron", key: "daily-sensitive-key" }));
    const queued = coordinator.acquire({ kind: "memory", key: "private-summary-key" });
    now = 1_025;

    await expect(coordinator.acquire({ kind: "dream", key: "private-dream-key" })).resolves.toEqual({
      reason: "Background run queue capacity has been reached.",
    });
    const snapshot = coordinator.getRuntimeSnapshot();
    expect(snapshot).toMatchObject({
      queuedCount: 1,
      queueCapacity: 1,
      oldestWaitMs: 25,
      rejectedCount: 1,
      queuedByKind: {
        cron: 0,
        heartbeat: 0,
        memory: 1,
        dream: 0,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-summary-key");

    active.release();
    const memory = requireClaim(await queued);
    memory.release();
  });

  it("allows bounded priority bypass without starving an older queued run", async () => {
    const coordinator = new BackgroundRunCoordinator({
      maxConcurrentRuns: 1,
      maxQueuedRuns: 4,
    });
    const active = requireClaim(coordinator.tryClaim({ kind: "heartbeat", key: "heartbeat" }));
    const order: string[] = [];
    const admitted = new Map<string, BackgroundRunClaimResult>();
    const enqueue = (label: string, input: Parameters<typeof coordinator.acquire>[0]) => {
      void coordinator.acquire(input).then((result) => {
        admitted.set(label, result);
        order.push(label);
      });
    };

    enqueue("older-low", { kind: "memory", key: "summary", priority: "low" });
    enqueue("first-high", { kind: "dream", key: "dream", priority: "high" });
    enqueue("second-high", { kind: "cron", key: "cron", priority: "high" });

    active.release();
    await vi.waitFor(() => expect(order).toHaveLength(1));
    expect(order).toEqual(["first-high"]);
    requireClaim(admitted.get("first-high")!).release();

    await vi.waitFor(() => expect(order).toHaveLength(2));
    expect(order).toEqual(["first-high", "older-low"]);
    requireClaim(admitted.get("older-low")!).release();

    await vi.waitFor(() => expect(order).toHaveLength(3));
    expect(order).toEqual(["first-high", "older-low", "second-high"]);
    requireClaim(admitted.get("second-high")!).release();
  });

  it("enforces duplicate, kind, and global claim limits before releasing capacity", () => {
    const coordinator = new BackgroundRunCoordinator({
      maxConcurrentRuns: 2,
      maxConcurrentByKind: {
        cron: 2,
        heartbeat: 1,
      },
    });
    const cronClaim = requireClaim(coordinator.tryClaim({ kind: "cron", key: "daily" }));

    expect(coordinator.tryClaim({ kind: "cron", key: "daily" })).toEqual({
      reason: "Background cron run daily is already running.",
    });

    const heartbeatClaim = requireClaim(coordinator.tryClaim({ kind: "heartbeat", key: "heartbeat" }));
    expect(coordinator.tryClaim({ kind: "cron", key: "weekly" })).toEqual({
      reason: "Background run coordinator has reached its concurrent run limit.",
    });

    cronClaim.release();
    const weeklyClaim = requireClaim(coordinator.tryClaim({ kind: "cron", key: "weekly" }));
    expect(coordinator.getRuntimeSnapshot()).toEqual({
      activeCount: 2,
      queuedCount: 0,
      capacity: 2,
      queueCapacity: 100,
      availableSlots: 0,
      oldestWaitMs: 0,
      rejectedCount: 0,
      foregroundActiveCount: 0,
      activeByKind: {
        cron: 1,
        heartbeat: 1,
        memory: 0,
        dream: 0,
      },
      queuedByKind: {
        cron: 0,
        heartbeat: 0,
        memory: 0,
        dream: 0,
      },
    });

    weeklyClaim.release();
    heartbeatClaim.release();

    const kindLimited = new BackgroundRunCoordinator({
      maxConcurrentRuns: 3,
      maxConcurrentByKind: { cron: 1 },
    });
    const limitedClaim = requireClaim(kindLimited.tryClaim({ kind: "cron", key: "first" }));
    expect(kindLimited.tryClaim({ kind: "cron", key: "second" })).toEqual({
      reason: "Background cron run capacity has been reached.",
    });
    limitedClaim.release();
  });

  it("enforces a shared singleflight key across memory and dream job kinds", () => {
    const coordinator = new BackgroundRunCoordinator({ maxConcurrentRuns: 4 });
    const summary = requireClaim(coordinator.tryClaim({
      kind: "memory",
      key: "idle-summary",
      singleflightKey: "memory-agent:default",
    }));

    expect(coordinator.tryClaim({
      kind: "dream",
      key: "manual-dream",
      singleflightKey: "memory-agent:default",
    })).toEqual({
      reason: "Background dream run manual-dream is already running for its singleflight key.",
    });

    const otherAgent = requireClaim(coordinator.tryClaim({
      kind: "dream",
      key: "manual-dream",
      singleflightKey: "memory-agent:coder",
    }));
    expect(coordinator.getRuntimeSnapshot()).toMatchObject({
      activeCount: 2,
      activeByKind: {
        memory: 1,
        dream: 1,
      },
    });

    summary.release();
    otherAgent.release();
  });

  it("reports only aggregate foreground and background activity", () => {
    let foregroundActiveCount = 0;
    const coordinator = new BackgroundRunCoordinator({
      getForegroundActiveCount: () => foregroundActiveCount,
    });

    expect(coordinator.isForegroundBusy()).toBe(false);
    foregroundActiveCount = 2;
    expect(coordinator.isForegroundBusy()).toBe(true);
    expect(coordinator.getRuntimeSnapshot()).toMatchObject({
      activeCount: 0,
      queuedCount: 0,
      capacity: 4,
      foregroundActiveCount: 2,
      activeByKind: {
        cron: 0,
        heartbeat: 0,
        memory: 0,
        dream: 0,
      },
    });
  });
});
