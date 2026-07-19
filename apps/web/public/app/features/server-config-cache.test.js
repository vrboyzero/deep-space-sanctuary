import { describe, expect, it, vi } from "vitest";

import { createServerConfigCache } from "./server-config-cache.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

describe("server config cache", () => {
  it("shares an in-flight load and reuses the value within its ttl", async () => {
    let now = 1_000;
    const deferred = createDeferred();
    const loader = vi.fn(() => deferred.promise);
    const cache = createServerConfigCache({ ttlMs: 2_000, now: () => now });

    const first = cache.load(loader);
    const second = cache.load(loader);
    expect(loader).toHaveBeenCalledTimes(1);

    deferred.resolve({ BELLDANDY_PORT: "28889" });
    await expect(first).resolves.toEqual({ BELLDANDY_PORT: "28889" });
    await expect(second).resolves.toEqual({ BELLDANDY_PORT: "28889" });

    now = 2_500;
    await expect(cache.load(loader)).resolves.toEqual({ BELLDANDY_PORT: "28889" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      cachedEntryCount: 1,
      pendingRequestCount: 0,
      cacheHitCount: 1,
      singleflightHitCount: 1,
      loadStartCount: 1,
    });
  });

  it("transforms a shared response once after its generation is confirmed", async () => {
    const deferred = createDeferred();
    const loader = vi.fn(() => deferred.promise);
    const transform = vi.fn((response) => response.payload.config);
    const cache = createServerConfigCache();

    const first = cache.load(loader, { transform });
    const second = cache.load(loader, { transform });
    deferred.resolve({ ok: true, payload: { config: { BELLDANDY_HOST: "127.0.0.1" } } });

    await expect(first).resolves.toEqual({ BELLDANDY_HOST: "127.0.0.1" });
    await expect(second).resolves.toEqual({ BELLDANDY_HOST: "127.0.0.1" });
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("rejects stale deferred commits after generation clear", async () => {
    const stale = createDeferred();
    const current = createDeferred();
    const loader = vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => current.promise);
    const cache = createServerConfigCache();

    const staleLoad = cache.load(loader);
    cache.clearGeneration();
    const currentLoad = cache.load(loader);
    current.resolve({ generation: "current" });
    await expect(currentLoad).resolves.toEqual({ generation: "current" });

    stale.resolve({ generation: "stale" });
    await expect(staleLoad).resolves.toBeNull();
    await expect(cache.load(loader)).resolves.toEqual({ generation: "current" });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      cachedEntryCount: 1,
      staleResultCount: 1,
      generationClearCount: 1,
    });
  });

  it("lets a forced load supersede an older request in the same generation", async () => {
    const stale = createDeferred();
    const current = createDeferred();
    const loader = vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => current.promise);
    const cache = createServerConfigCache();

    const staleLoad = cache.load(loader);
    const currentLoad = cache.load(loader, { force: true });
    current.resolve({ revision: 2 });
    await expect(currentLoad).resolves.toEqual({ revision: 2 });
    stale.resolve({ revision: 1 });
    await expect(staleLoad).resolves.toBeNull();
    await expect(cache.load(loader)).resolves.toEqual({ revision: 2 });
  });

  it("does not cache rejected values and stops loading after dispose", async () => {
    const cache = createServerConfigCache();
    const loader = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const shouldCache = (value) => value?.ok === true;

    await expect(cache.load(loader, { shouldCache })).resolves.toEqual({ ok: false });
    await expect(cache.load(loader, { shouldCache })).resolves.toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(2);

    cache.dispose();
    await expect(cache.load(loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      cachedEntryCount: 0,
      pendingRequestCount: 0,
      disposed: true,
    });
  });
});
