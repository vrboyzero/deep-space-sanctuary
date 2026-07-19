import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerDreamRunAction } from "./memory-viewer-dream-run-action.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("memory viewer Dream run action", () => {
  it("settles a disposed run without restoring runtime, notice, refresh, or busy rendering", async () => {
    const request = createDeferred();
    const state = {
      dreamBusy: false,
      dreamHistoryOpen: true,
      dreamRuntime: null,
      requestToken: 3,
    };
    const render = vi.fn();
    const showNotice = vi.fn();
    const loadDreamHistory = vi.fn();
    const loadDreamRuntimeStatus = vi.fn();
    const action = createMemoryViewerDreamRunAction({
      getState: () => state,
      isConnected: () => true,
      sendReq: vi.fn(() => request.promise),
      makeId: () => "req-1",
      getActiveAgentId: () => "default",
      normalizeRuntime: (payload) => payload,
      render,
      showNotice,
      loadDreamHistory,
      loadDreamRuntimeStatus,
      t: (_key, _params, fallback) => fallback || "",
    });

    const run = action.run();
    expect(state.dreamBusy).toBe(true);
    expect(action.getRuntimeSnapshot().pendingDreamRunActionCount).toBe(1);

    action.dispose();
    request.resolve({ ok: true, payload: { record: { summary: "late Dream" } } });
    await run;

    expect(state.dreamBusy).toBe(false);
    expect(state.dreamRuntime).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadDreamHistory).not.toHaveBeenCalled();
    expect(loadDreamRuntimeStatus).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingDreamRunActionCount: 0,
    });
  });

  it("preserves the active success contract and refresh ordering", async () => {
    const state = {
      dreamBusy: false,
      dreamHistoryOpen: true,
      dreamRuntime: { requested: { defaultConversationId: "conversation-1" } },
      requestToken: 4,
    };
    const render = vi.fn();
    const showNotice = vi.fn();
    const loadDreamHistory = vi.fn();
    const loadDreamRuntimeStatus = vi.fn();
    const payload = { record: { status: "completed", summary: "fresh Dream" } };
    const action = createMemoryViewerDreamRunAction({
      getState: () => state,
      isConnected: () => true,
      sendReq: vi.fn(async () => ({ ok: true, payload })),
      makeId: () => "req-2",
      getActiveAgentId: () => "default",
      normalizeRuntime: (value, agentId) => ({ ...value, requested: { agentId } }),
      render,
      showNotice,
      loadDreamHistory,
      loadDreamRuntimeStatus,
      t: (_key, _params, fallback) => fallback || "",
    });

    await expect(action.run()).resolves.toBe(payload);

    expect(state.dreamBusy).toBe(false);
    expect(state.dreamRuntime.requested).toEqual({
      agentId: "default",
      defaultConversationId: "conversation-1",
    });
    expect(showNotice).toHaveBeenCalledWith("Dream 已运行", "fresh Dream", "success", 2600);
    expect(loadDreamHistory).toHaveBeenCalledWith(true, "default");
    expect(loadDreamRuntimeStatus).toHaveBeenCalledWith({ requestToken: 4, agentId: "default" });
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("suppresses a disposed request rejection after physical settlement", async () => {
    const request = createDeferred();
    const state = { dreamBusy: false };
    const render = vi.fn();
    const action = createMemoryViewerDreamRunAction({
      getState: () => state,
      isConnected: () => true,
      sendReq: vi.fn(() => request.promise),
      makeId: () => "req-3",
      getActiveAgentId: () => "default",
      normalizeRuntime: vi.fn(),
      render,
      showNotice: vi.fn(),
      loadDreamHistory: vi.fn(),
      loadDreamRuntimeStatus: vi.fn(),
      t: (_key, _params, fallback) => fallback || "",
    });

    const run = action.run();
    action.dispose();
    request.reject(new Error("late failure"));

    await expect(run).resolves.toBeNull();
    expect(state.dreamBusy).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot().pendingDreamRunActionCount).toBe(0);
  });
});
