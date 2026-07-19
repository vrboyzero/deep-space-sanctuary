import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerRequestLifecycle } from "./memory-viewer-request-lifecycle.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("memory viewer request lifecycle", () => {
  it("keeps a disposed load pending until physical settlement without committing", async () => {
    const request = createDeferred();
    const invalidateRequestContext = vi.fn();
    const lifecycle = createMemoryViewerRequestLifecycle({ invalidateRequestContext });
    let currentAtSettlement = true;

    const load = lifecycle.run(async ({ isCurrent }) => {
      await request.promise;
      currentAtSettlement = isCurrent();
    });
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: false,
      pendingLoadRequestCount: 1,
    });

    lifecycle.dispose();
    expect(invalidateRequestContext).toHaveBeenCalledTimes(1);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingLoadRequestCount: 1,
    });

    request.resolve();
    await load;
    expect(currentAtSettlement).toBe(false);
    expect(lifecycle.getRuntimeSnapshot().pendingLoadRequestCount).toBe(0);

    await lifecycle.run(vi.fn());
    expect(lifecycle.getRuntimeSnapshot().pendingLoadRequestCount).toBe(0);
  });
});
