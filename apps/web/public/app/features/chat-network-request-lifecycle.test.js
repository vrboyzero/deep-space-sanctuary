import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChatNetworkRequestLifecycle } from "./chat-network-request-lifecycle.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function createAbortSignalHarness() {
  let aborted = false;
  const listeners = new Set();
  return {
    signal: {
      get aborted() {
        return aborted;
      },
      addEventListener(type, listener) {
        if (type === "abort") listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "abort") listeners.delete(listener);
      },
    },
    abort() {
      if (aborted) return;
      aborted = true;
      for (const listener of [...listeners]) listener();
    },
    getListenerCount: () => listeners.size,
  };
}

describe("chat network request lifecycle", () => {
  it("refuses a request whose signal is already aborted", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    const abortController = new AbortController();
    abortController.abort();

    await expect(lifecycle.trackRequest({
      generation: 1,
      requestId: "request-pre-aborted",
      timeoutMs: 30_000,
      signal: abortController.signal,
    })).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: false,
      pendingChatNetworkGenerationCount: 0,
      pendingChatNetworkRequestCount: 0,
    });
  });

  it("settles an inflight request and releases its abort listener", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    const abortSignal = createAbortSignalHarness();
    const request = lifecycle.trackRequest({
      generation: 2,
      requestId: "request-inflight-abort",
      timeoutMs: 30_000,
      signal: abortSignal.signal,
    });

    expect(abortSignal.getListenerCount()).toBe(1);
    abortSignal.abort();

    await expect(request).resolves.toBeNull();
    expect(abortSignal.getListenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(lifecycle.resolveResponse(2, {
      type: "res",
      id: "request-inflight-abort",
      ok: true,
    })).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: false,
      pendingChatNetworkGenerationCount: 0,
      pendingChatNetworkRequestCount: 0,
    });
  });

  it("resolves a response and clears its deadline", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    const abortSignal = createAbortSignalHarness();
    const request = lifecycle.trackRequest({
      generation: 1,
      requestId: "request-1",
      timeoutMs: 30_000,
      signal: abortSignal.signal,
    });
    const response = { type: "res", id: "request-1", ok: true };

    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      pendingChatNetworkGenerationCount: 1,
      pendingChatNetworkRequestCount: 1,
    });
    expect(lifecycle.resolveResponse(1, response)).toBe(true);

    await expect(request).resolves.toEqual(response);
    expect(abortSignal.getListenerCount()).toBe(0);
    abortSignal.abort();
    expect(vi.getTimerCount()).toBe(0);
    expect(lifecycle.getRuntimeSnapshot().pendingChatNetworkRequestCount).toBe(0);
  });

  it("settles only the selected connection generation and ignores its late response", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    const oldAbortSignal = createAbortSignalHarness();
    const oldRequest = lifecycle.trackRequest({
      generation: 1,
      requestId: "shared-1",
      timeoutMs: 30_000,
      signal: oldAbortSignal.signal,
    });
    const currentRequest = lifecycle.trackRequest({
      generation: 2,
      requestId: "shared-1",
      timeoutMs: 30_000,
    });

    lifecycle.settleGeneration(1);

    await expect(oldRequest).resolves.toBeNull();
    expect(oldAbortSignal.getListenerCount()).toBe(0);
    oldAbortSignal.abort();
    expect(lifecycle.resolveResponse(1, { type: "res", id: "shared-1", ok: true })).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      pendingChatNetworkGenerationCount: 1,
      pendingChatNetworkRequestCount: 1,
    });

    const response = { type: "res", id: "shared-1", ok: true, payload: { current: true } };
    expect(lifecycle.resolveResponse(2, response)).toBe(true);
    await expect(currentRequest).resolves.toEqual(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves timed out requests as null and prunes their generation", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    const abortSignal = createAbortSignalHarness();
    const request = lifecycle.trackRequest({
      generation: 7,
      requestId: "request-timeout",
      timeoutMs: 25,
      signal: abortSignal.signal,
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(request).resolves.toBeNull();
    expect(abortSignal.getListenerCount()).toBe(0);
    abortSignal.abort();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: false,
      pendingChatNetworkGenerationCount: 0,
      pendingChatNetworkRequestCount: 0,
    });
  });

  it("uses the 30 second default deadline when no timeout is provided", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    let result = "pending";
    void lifecycle.trackRequest({
      generation: 8,
      requestId: "request-default-timeout",
    }).then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
    expect(lifecycle.getRuntimeSnapshot().pendingChatNetworkRequestCount).toBe(0);
  });

  it("settles a duplicate request id before tracking its replacement", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    const replaced = lifecycle.trackRequest({
      generation: 4,
      requestId: "duplicate-1",
      timeoutMs: 30_000,
    });
    const replacement = lifecycle.trackRequest({
      generation: 4,
      requestId: "duplicate-1",
      timeoutMs: 30_000,
    });

    await expect(replaced).resolves.toBeNull();
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      pendingChatNetworkGenerationCount: 1,
      pendingChatNetworkRequestCount: 1,
    });

    const response = { type: "res", id: "duplicate-1", ok: true };
    expect(lifecycle.resolveResponse(4, response)).toBe(true);
    await expect(replacement).resolves.toEqual(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles every physical request on dispose and refuses new tracking", async () => {
    const lifecycle = createChatNetworkRequestLifecycle();
    const abortSignal = createAbortSignalHarness();
    const first = lifecycle.trackRequest({
      generation: 1,
      requestId: "request-1",
      timeoutMs: 30_000,
      signal: abortSignal.signal,
    });
    const second = lifecycle.trackRequest({ generation: 2, requestId: "request-2", timeoutMs: 30_000 });

    lifecycle.dispose();

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(abortSignal.getListenerCount()).toBe(0);
    abortSignal.abort();
    await expect(lifecycle.trackRequest({
      generation: 3,
      requestId: "request-3",
      timeoutMs: 30_000,
    })).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: true,
      pendingChatNetworkGenerationCount: 0,
      pendingChatNetworkRequestCount: 0,
    });
  });
});
