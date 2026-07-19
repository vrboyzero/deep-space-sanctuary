import { describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchCleanupFeature } from "./experience-workbench-cleanup.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFixture(options = {}) {
  let pendingActionKey = "";
  let generation = 0;
  let ownerCurrent = true;
  const events = [];
  const requestCleanup = vi.fn(options.requestCleanup || (() => Promise.resolve({ ok: true, payload: { count: 2 } })));
  const loadExperienceWorkbench = vi.fn(async () => {
    events.push("load");
  });
  const syncExperienceWorkbenchUi = vi.fn(async () => {
    events.push("sync");
  });
  const notifyDisconnected = vi.fn();
  const notifyFailure = vi.fn((message) => {
    events.push(`failure:${message}`);
  });
  const notifySuccess = vi.fn((count) => {
    events.push(`success:${count}`);
  });
  const syncPendingUi = vi.fn(() => {
    events.push(`pending:${pendingActionKey || "none"}`);
  });
  const feature = createExperienceWorkbenchCleanupFeature({
    confirmCleanup: () => true,
    getConsumedDraftCount: () => 2,
    getGeneration: () => generation,
    getPendingActionKey: () => pendingActionKey,
    isConnected: () => true,
    isOwnerCurrent: (expectedGeneration) => ownerCurrent && expectedGeneration === generation,
    loadExperienceWorkbench,
    notifyDisconnected,
    notifyFailure,
    notifySuccess,
    requestCleanup,
    setPendingActionKey: (nextKey) => {
      pendingActionKey = nextKey || "";
    },
    syncExperienceWorkbenchUi,
    syncPendingUi,
  });

  return {
    events,
    feature,
    loadExperienceWorkbench,
    notifyDisconnected,
    notifyFailure,
    notifySuccess,
    requestCleanup,
    setOwnerCurrent: (next) => {
      ownerCurrent = next;
    },
    syncExperienceWorkbenchUi,
    syncPendingUi,
  };
}

describe("experience workbench cleanup lifecycle", () => {
  it("reports an active cleanup failure and releases the UI pending key", async () => {
    const fixture = createFixture({
      requestCleanup: () => Promise.resolve({ ok: false, error: { message: "Cleanup unavailable" } }),
    });

    await fixture.feature.cleanupConsumedExperienceCandidates();

    expect(fixture.feature.getPendingCount()).toBe(0);
    expect(fixture.notifyFailure).toHaveBeenCalledWith("Cleanup unavailable");
    expect(fixture.loadExperienceWorkbench).not.toHaveBeenCalled();
    expect(fixture.syncExperienceWorkbenchUi).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      "pending:cleanup-consumed",
      "failure:Cleanup unavailable",
      "pending:none",
    ]);
  });

  it("applies an active cleanup only after its loader and UI sync settle", async () => {
    const fixture = createFixture();

    await fixture.feature.cleanupConsumedExperienceCandidates();

    expect(fixture.feature.getPendingCount()).toBe(0);
    expect(fixture.requestCleanup).toHaveBeenCalledTimes(1);
    expect(fixture.events).toEqual([
      "pending:cleanup-consumed",
      "load",
      "sync",
      "success:2",
      "pending:none",
    ]);
  });

  it("keeps the physical token until a stale cleanup response settles", async () => {
    const deferred = createDeferred();
    const fixture = createFixture({ requestCleanup: () => deferred.promise });

    const cleanup = fixture.feature.cleanupConsumedExperienceCandidates();
    expect(fixture.feature.getPendingCount()).toBe(1);
    fixture.setOwnerCurrent(false);
    deferred.resolve({ ok: true, payload: { count: 2 } });
    await cleanup;

    expect(fixture.feature.getPendingCount()).toBe(0);
    expect(fixture.loadExperienceWorkbench).not.toHaveBeenCalled();
    expect(fixture.syncExperienceWorkbenchUi).not.toHaveBeenCalled();
    expect(fixture.notifySuccess).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(["pending:cleanup-consumed"]);
  });
});
