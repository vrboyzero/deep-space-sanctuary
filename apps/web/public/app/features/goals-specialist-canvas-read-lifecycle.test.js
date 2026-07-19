import { describe, expect, it } from "vitest";

import { createGoalsSpecialistCanvasReadLifecycle } from "./goals-specialist-canvas-read-lifecycle.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("goals specialist canvas read lifecycle", () => {
  it("keeps a disposed board-ref read pending until physical settlement without committing", async () => {
    const request = createDeferred();
    const lifecycle = createGoalsSpecialistCanvasReadLifecycle();
    let committed = false;
    const read = lifecycle.run(async ({ isCurrent }) => {
      await request.promise;
      if (isCurrent()) committed = true;
    });

    expect(lifecycle.getRuntimeSnapshot().pendingGoalCanvasReadCount).toBe(1);
    lifecycle.dispose();
    request.resolve();
    await read;

    expect(committed).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalCanvasReadCount: 0,
    });
  });

  it("allows only the latest Canvas read to commit", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const lifecycle = createGoalsSpecialistCanvasReadLifecycle();
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
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCanvasReadCount).toBe(0);
  });

  it("suppresses a rejected Canvas read after dispose", async () => {
    const request = createDeferred();
    const lifecycle = createGoalsSpecialistCanvasReadLifecycle();
    const read = lifecycle.run(() => request.promise);

    lifecycle.dispose();
    request.reject(new Error("late board-ref failure"));

    await expect(read).resolves.toBeUndefined();
    expect(lifecycle.getRuntimeSnapshot().pendingGoalCanvasReadCount).toBe(0);
  });
});
