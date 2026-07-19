import { describe, expect, it } from "vitest";

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
      availableSlots: 0,
      foregroundActiveCount: 0,
      activeByKind: {
        cron: 1,
        heartbeat: 1,
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
      },
    });
  });
});
