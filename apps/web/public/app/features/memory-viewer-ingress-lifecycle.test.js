import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerIngressLifecycle } from "./memory-viewer-ingress-lifecycle.js";

describe("memory viewer public ingress lifecycle", () => {
  it("blocks guarded sync and async commands after dispose", async () => {
    const lifecycle = createMemoryViewerIngressLifecycle();
    const syncCommand = vi.fn((value) => `sync:${value}`);
    const asyncCommand = vi.fn(async (value) => `async:${value}`);
    const guardedSync = lifecycle.guard(syncCommand, "sync:disposed");
    const guardedAsync = lifecycle.guardAsync(asyncCommand, null);

    expect(guardedSync("active")).toBe("sync:active");
    await expect(guardedAsync("active")).resolves.toBe("async:active");

    lifecycle.dispose();
    expect(guardedSync("late")).toBe("sync:disposed");
    await expect(guardedAsync("late")).resolves.toBeNull();
    expect(syncCommand).toHaveBeenCalledTimes(1);
    expect(asyncCommand).toHaveBeenCalledTimes(1);
    expect(lifecycle.getRuntimeSnapshot()).toEqual({ memoryViewerIngressDisposed: true });
  });
});
