import { describe, expect, it } from "vitest";

import { QueryEmbeddingCache } from "./query-embedding-cache.js";

describe("QueryEmbeddingCache", () => {
  it("reuses a successful vector before its TTL and refetches after expiry", async () => {
    let now = 1_000;
    const cache = new QueryEmbeddingCache({
      ttlMs: 100,
      maxEntries: 2,
      maxBytes: 1_024,
      now: () => now,
    });
    let calls = 0;
    const load = async () => {
      calls += 1;
      return [calls];
    };

    await expect(cache.resolve("query-a", { load })).resolves.toEqual([1]);
    await expect(cache.resolve("query-a", { load })).resolves.toEqual([1]);
    expect(calls).toBe(1);

    now += 101;
    await expect(cache.resolve("query-a", { load })).resolves.toEqual([2]);
    expect(calls).toBe(2);
  });

  it("evicts the least recently used vector when entry or byte budgets are exceeded", async () => {
    const cache = new QueryEmbeddingCache({
      ttlMs: 1_000,
      maxEntries: 2,
      maxBytes: 16,
    });
    const loads = new Map<string, number>();
    const load = (key: string, vector: number[]) => async () => {
      loads.set(key, (loads.get(key) ?? 0) + 1);
      return vector;
    };

    await cache.resolve("a", { load: load("a", [1]) });
    await cache.resolve("b", { load: load("b", [2]) });
    await cache.resolve("a", { load: load("a", [9]) });
    await cache.resolve("c", { load: load("c", [3]) });
    await cache.resolve("b", { load: load("b", [8]) });

    expect(loads).toEqual(new Map([
      ["a", 1],
      ["b", 2],
      ["c", 1],
    ]));
  });

  it("shares one in-flight load, but does not retain a failed or abandoned load", async () => {
    const cache = new QueryEmbeddingCache({ ttlMs: 1_000, maxEntries: 2, maxBytes: 1_024 });
    let resolveFirst!: (vector: number[]) => void;
    let calls = 0;
    const firstLoad = async ({ signal }: { signal: AbortSignal }) => {
      calls += 1;
      return await new Promise<number[]>((resolve, reject) => {
        resolveFirst = resolve;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };

    const first = cache.resolve("shared", { load: firstLoad });
    const second = cache.resolve("shared", { load: firstLoad });
    expect(calls).toBe(1);
    resolveFirst([0.25]);
    await expect(Promise.all([first, second])).resolves.toEqual([[0.25], [0.25]]);
    expect(calls).toBe(1);

    await expect(cache.resolve("failure", {
      load: async () => {
        throw new Error("provider failed");
      },
    })).rejects.toThrow("provider failed");
    await expect(cache.resolve("failure", { load: async () => [0.5] })).resolves.toEqual([0.5]);

    const controller = new AbortController();
    const abandoned = cache.resolve("abandoned", {
      signal: controller.signal,
      load: async ({ signal }) => await new Promise<number[]>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });
    controller.abort(new DOMException("caller cancelled", "AbortError"));
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    await expect(cache.resolve("abandoned", { load: async () => [0.75] })).resolves.toEqual([0.75]);
  });
});
