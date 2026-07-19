import { describe, expect, it } from "vitest";

import { createGoalsSpecialistProgressReadLifecycle } from "./goals-specialist-progress-read-lifecycle.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("goals specialist progress read lifecycle", () => {
  it("keeps a disposed file read pending until physical settlement without committing", async () => {
    const request = createDeferred();
    const lifecycle = createGoalsSpecialistProgressReadLifecycle();
    let committed = false;
    const read = lifecycle.run(async ({ isCurrent }) => {
      await request.promise;
      if (isCurrent()) committed = true;
    });

    expect(lifecycle.getRuntimeSnapshot().pendingGoalProgressReadCount).toBe(1);
    lifecycle.dispose();
    request.resolve();
    await read;

    expect(committed).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalProgressReadCount: 0,
    });
  });

  it("allows only the latest progress read to commit", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const lifecycle = createGoalsSpecialistProgressReadLifecycle();
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
    expect(lifecycle.getRuntimeSnapshot().pendingGoalProgressReadCount).toBe(0);
  });

  it("suppresses a rejected progress read after dispose", async () => {
    const request = createDeferred();
    const lifecycle = createGoalsSpecialistProgressReadLifecycle();
    const read = lifecycle.run(() => request.promise);

    lifecycle.dispose();
    request.reject(new Error("late progress failure"));

    await expect(read).resolves.toBeUndefined();
    expect(lifecycle.getRuntimeSnapshot().pendingGoalProgressReadCount).toBe(0);
  });
});
