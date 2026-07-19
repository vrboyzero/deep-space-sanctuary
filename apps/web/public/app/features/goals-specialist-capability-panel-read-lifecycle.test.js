import { describe, expect, it } from "vitest";

import { createGoalsSpecialistCapabilityPanelReadLifecycle } from "./goals-specialist-capability-panel-read-lifecycle.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("goals specialist capability panel read lifecycle", () => {
  it("keeps a disposed render chain pending until physical settlement without committing", async () => {
    const request = createDeferred();
    const lifecycle = createGoalsSpecialistCapabilityPanelReadLifecycle();
    let committed = false;
    const read = lifecycle.run(async ({ isCurrent }) => {
      await request.promise;
      if (isCurrent()) committed = true;
    });

    expect(lifecycle.getRuntimeSnapshot().pendingGoalCapabilityPanelReadCount).toBe(1);
    lifecycle.dispose();
    request.resolve();
    await read;

    expect(committed).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalCapabilityPanelReadCount: 0,
    });
  });

  it("allows only the latest capability panel chain to commit", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const lifecycle = createGoalsSpecialistCapabilityPanelReadLifecycle();
    const commits = [];
    const firstRead = lifecycle.run(async ({ isCurrent }) => {
      await firstRequest.promise;
      if (isCurrent()) commits.push("first");
    });
    const secondRead = lifecycle.run(async ({ isCurrent }) => {
      await secondRequest.promise;
      if (isCurrent()) commits.push("second");
    });

    firstRequest.resolve();
    await firstRead;
    secondRequest.resolve();
    await secondRead;

    expect(commits).toEqual(["second"]);
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCapabilityPanelReadCount).toBe(0);
  });

  it("suppresses a rejected capability panel chain after dispose", async () => {
    const request = createDeferred();
    const lifecycle = createGoalsSpecialistCapabilityPanelReadLifecycle();
    const read = lifecycle.run(() => request.promise);

    lifecycle.dispose();
    request.reject(new Error("late capability panel failure"));

    await expect(read).resolves.toBeUndefined();
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCapabilityPanelReadCount).toBe(0);
  });
});
