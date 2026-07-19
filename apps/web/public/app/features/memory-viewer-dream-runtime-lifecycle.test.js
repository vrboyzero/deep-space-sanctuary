import { describe, expect, it } from "vitest";

import { createMemoryViewerDreamRuntimeLifecycle } from "./memory-viewer-dream-runtime-lifecycle.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("memory viewer Dream runtime lifecycle", () => {
  it("keeps a disposed status request pending until physical settlement without committing", async () => {
    const request = createDeferred();
    const lifecycle = createMemoryViewerDreamRuntimeLifecycle();
    let committed = false;
    const load = lifecycle.run("status", async ({ isCurrent }) => {
      await request.promise;
      if (isCurrent()) committed = true;
    });
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      pendingDreamRuntimeRequestCount: 1,
      pendingDreamRuntimeStatusRequestCount: 1,
    });

    lifecycle.dispose();
    request.resolve();
    await load;

    expect(committed).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingDreamRuntimeRequestCount: 0,
      pendingDreamRuntimeStatusRequestCount: 0,
    });
  });

  it("allows only the latest status request to commit", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const lifecycle = createMemoryViewerDreamRuntimeLifecycle();
    const commits = [];
    const firstLoad = lifecycle.run("status", async ({ isCurrent }) => {
      await firstRequest.promise;
      if (isCurrent()) commits.push("first");
    });
    const secondLoad = lifecycle.run("status", async ({ isCurrent }) => {
      await secondRequest.promise;
      if (isCurrent()) commits.push("second");
    });

    firstRequest.resolve();
    await firstLoad;
    secondRequest.resolve();
    await secondLoad;

    expect(commits).toEqual(["second"]);
    expect(lifecycle.getRuntimeSnapshot().pendingDreamRuntimeRequestCount).toBe(0);
  });
});
