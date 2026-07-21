import { describe, expect, it } from "vitest";

import type { BackgroundRunRuntimeSnapshot } from "./background-run-coordinator.js";
import { evaluateBackgroundRunBusy } from "./background-run-busy-policy.js";

function createSnapshot(
  overrides: Partial<BackgroundRunRuntimeSnapshot> = {},
): BackgroundRunRuntimeSnapshot {
  return {
    activeCount: 0,
    queuedCount: 0,
    capacity: 4,
    queueCapacity: 100,
    availableSlots: 4,
    oldestWaitMs: 0,
    rejectedCount: 0,
    foregroundActiveCount: 0,
    activeByKind: { cron: 0, heartbeat: 0, memory: 0, dream: 0 },
    queuedByKind: { cron: 0, heartbeat: 0, memory: 0, dream: 0 },
    ...overrides,
  };
}

describe("background run busy policy", () => {
  it("reports foreground activity through an aggregate-only snapshot", () => {
    const result = evaluateBackgroundRunBusy(createSnapshot({
      foregroundActiveCount: 1,
    }));

    expect(result).toEqual({
      busy: true,
      foregroundActiveCount: 1,
      backgroundActiveCount: 0,
      queuedCount: 0,
      availableSlots: 4,
    });
    expect(JSON.stringify(result)).not.toContain("key");
    expect(JSON.stringify(result)).not.toContain("conversation");
  });

  it("reports active background work as busy", () => {
    const result = evaluateBackgroundRunBusy(createSnapshot({
      activeCount: 1,
      availableSlots: 3,
      activeByKind: { cron: 1, heartbeat: 0, memory: 0, dream: 0 },
    }));

    expect(result).toMatchObject({
      busy: true,
      backgroundActiveCount: 1,
      availableSlots: 3,
    });
  });

  it("reports queued background work as busy", () => {
    const result = evaluateBackgroundRunBusy(createSnapshot({
      queuedCount: 1,
      queuedByKind: { cron: 0, heartbeat: 1, memory: 0, dream: 0 },
    }));

    expect(result).toMatchObject({
      busy: true,
      backgroundActiveCount: 0,
      queuedCount: 1,
    });
  });

  it("excludes the caller's own active claim from activity and slot pressure", () => {
    const result = evaluateBackgroundRunBusy(createSnapshot({
      activeCount: 1,
      capacity: 1,
      availableSlots: 0,
      activeByKind: { cron: 0, heartbeat: 0, memory: 0, dream: 1 },
    }), {
      ownClaimKind: "dream",
    });

    expect(result).toEqual({
      busy: false,
      foregroundActiveCount: 0,
      backgroundActiveCount: 0,
      queuedCount: 0,
      availableSlots: 1,
    });
  });

  it("reports exhausted available slots as resource pressure", () => {
    const result = evaluateBackgroundRunBusy(createSnapshot({
      availableSlots: 0,
    }));

    expect(result).toMatchObject({
      busy: true,
      backgroundActiveCount: 0,
      queuedCount: 0,
      availableSlots: 0,
    });
  });
});
