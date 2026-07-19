import { describe, expect, it } from "vitest";

import { createMemoryRuntimeReadLifecycle } from "./memory-runtime-read-lifecycle.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("memory runtime read lifecycle", () => {
  it("keeps a disposed task read pending until physical settlement without committing", async () => {
    const request = createDeferred();
    const lifecycle = createMemoryRuntimeReadLifecycle();
    let committed = false;
    const read = lifecycle.run("task", async ({ isCurrent }) => {
      await request.promise;
      if (isCurrent()) committed = true;
    });
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      pendingMemoryRuntimeReadCount: 1,
      pendingMemoryRuntimeTaskReadCount: 1,
    });

    lifecycle.dispose();
    request.resolve();
    await read;

    expect(committed).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemoryRuntimeReadCount: 0,
      pendingMemoryRuntimeTaskReadCount: 0,
    });
  });

  it("allows only the latest read of the same kind to commit", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const lifecycle = createMemoryRuntimeReadLifecycle();
    const commits = [];
    const firstRead = lifecycle.run("memory", async ({ isCurrent }) => {
      await firstRequest.promise;
      if (isCurrent()) commits.push("first");
    });
    const secondRead = lifecycle.run("memory", async ({ isCurrent }) => {
      await secondRequest.promise;
      if (isCurrent()) commits.push("second");
    });

    firstRequest.resolve();
    await firstRead;
    secondRequest.resolve();
    await secondRead;

    expect(commits).toEqual(["second"]);
    expect(lifecycle.getRuntimeSnapshot().pendingMemoryRuntimeReadCount).toBe(0);
  });

  it("suppresses a disposed read rejection after physical settlement", async () => {
    const request = createDeferred();
    const lifecycle = createMemoryRuntimeReadLifecycle();
    const read = lifecycle.run("candidate", () => request.promise);

    lifecycle.dispose();
    request.reject(new Error("late failure"));

    await expect(read).resolves.toBeUndefined();
    expect(lifecycle.getRuntimeSnapshot().pendingMemoryRuntimeReadCount).toBe(0);
  });
});
