import { describe, expect, it, vi } from "vitest";

import { createGoalsSpecialistCapabilityCacheReadLifecycle } from "./goals-specialist-capability-cache-read-lifecycle.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("goals specialist capability cache read lifecycle", () => {
  it("keeps the public pending signal until a disposed read settles without commit", async () => {
    const request = createDeferred();
    const pendingState = {};
    const commit = vi.fn();
    const lifecycle = createGoalsSpecialistCapabilityCacheReadLifecycle();
    const read = lifecycle.run({
      goalId: "goal-alpha",
      pendingState,
      read: () => request.promise,
      commit,
    });

    expect(pendingState["goal-alpha"]).toBe(read);
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCapabilityCacheReadCount).toBe(1);
    lifecycle.dispose();
    request.resolve({ plans: [] });

    await expect(read).resolves.toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
    expect(pendingState).toEqual({});
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      activeGoalCapabilityCacheGenerationCount: 0,
      disposed: true,
      pendingGoalCapabilityCacheReadCount: 0,
    });
  });

  it("does not let an old forceReload settlement delete the replacement pending signal", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const pendingState = {};
    const commits = [];
    const lifecycle = createGoalsSpecialistCapabilityCacheReadLifecycle();
    const firstRead = lifecycle.run({
      goalId: "goal-alpha",
      pendingState,
      read: () => firstRequest.promise,
      commit: (value) => commits.push(value),
    });
    const secondRead = lifecycle.run({
      goalId: "goal-alpha",
      forceReload: true,
      pendingState,
      read: () => secondRequest.promise,
      commit: (value) => commits.push(value),
    });

    expect(pendingState["goal-alpha"]).toBe(secondRead);
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCapabilityCacheReadCount).toBe(2);
    firstRequest.resolve("stale");
    await expect(firstRead).resolves.toBeUndefined();
    expect(pendingState["goal-alpha"]).toBe(secondRead);

    secondRequest.resolve("fresh");
    await expect(secondRead).resolves.toBe("fresh");
    expect(commits).toEqual(["fresh"]);
    expect(pendingState).toEqual({});
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCapabilityCacheReadCount).toBe(0);
  });

  it("deduplicates an active read when forceReload is false", async () => {
    const request = createDeferred();
    const pendingState = {};
    const readEntry = vi.fn(() => request.promise);
    const lifecycle = createGoalsSpecialistCapabilityCacheReadLifecycle();
    const firstRead = lifecycle.run({ goalId: "goal-alpha", pendingState, read: readEntry });
    const secondRead = lifecycle.run({ goalId: "goal-alpha", pendingState, read: readEntry });

    expect(secondRead).toBe(firstRead);
    expect(readEntry).toHaveBeenCalledOnce();
    request.resolve("entry");
    await expect(secondRead).resolves.toBe("entry");
  });

  it("suppresses a rejected capability read after dispose", async () => {
    const request = createDeferred();
    const pendingState = {};
    const lifecycle = createGoalsSpecialistCapabilityCacheReadLifecycle();
    const read = lifecycle.run({
      goalId: "goal-alpha",
      pendingState,
      read: () => request.promise,
    });

    lifecycle.dispose();
    request.reject(new Error("late capability failure"));

    await expect(read).resolves.toBeUndefined();
    expect(pendingState).toEqual({});
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCapabilityCacheReadCount).toBe(0);
  });
});
