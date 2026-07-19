import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerSharePromoteAction } from "./memory-viewer-share-promote-action.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("memory viewer shared promotion action", () => {
  it("settles a disposed promotion without notice or reload", async () => {
    const request = createDeferred();
    const state = { selectedId: "chunk-1" };
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn();
    const loadMemoryDetail = vi.fn();
    const action = createMemoryViewerSharePromoteAction({
      getState: () => state,
      sendReq: vi.fn(() => request.promise),
      makeId: () => "req-1",
      getActiveAgentId: () => "default",
      promptAction: vi.fn(() => "manual promotion"),
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });

    const promote = action.promote({ id: "chunk-1" });
    expect(action.getRuntimeSnapshot().pendingMemorySharePromoteActionCount).toBe(1);

    action.dispose();
    request.resolve({ ok: true, payload: { promotedCount: 1 } });
    await promote;

    expect(showNotice).not.toHaveBeenCalled();
    expect(loadMemoryViewer).not.toHaveBeenCalled();
    expect(loadMemoryDetail).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemorySharePromoteActionCount: 0,
    });
  });

  it("preserves the active promotion request, notice, and reload contract", async () => {
    const state = { selectedId: "chunk-1" };
    const sendReq = vi.fn(async () => ({ ok: true, payload: { promotedCount: 1 } }));
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn(async () => {});
    const loadMemoryDetail = vi.fn(async () => {});
    const action = createMemoryViewerSharePromoteAction({
      getState: () => state,
      sendReq,
      makeId: () => "req-2",
      getActiveAgentId: () => "agent-1",
      promptAction: vi.fn(() => "  governance review  "),
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });

    await expect(action.promote({ id: "chunk-1" })).resolves.toEqual({ promotedCount: 1 });

    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "req-2",
      method: "memory.share.promote",
      params: {
        chunkId: "chunk-1",
        reason: "governance review",
        agentId: "agent-1",
      },
    });
    expect(showNotice).toHaveBeenCalledWith(
      "Shared Promotion Complete",
      "The shared copy has been written and the private copy is kept.",
      "success",
      2600,
    );
    expect(loadMemoryViewer).toHaveBeenCalledWith(false);
    expect(loadMemoryDetail).toHaveBeenCalledWith("chunk-1");
    expect(action.getRuntimeSnapshot().pendingMemorySharePromoteActionCount).toBe(0);
  });

  it("suppresses a disposed promotion rejection after physical settlement", async () => {
    const request = createDeferred();
    const action = createMemoryViewerSharePromoteAction({
      getState: () => ({ selectedId: "chunk-1" }),
      sendReq: vi.fn(() => request.promise),
      makeId: () => "req-3",
      getActiveAgentId: () => "default",
      promptAction: vi.fn(() => "manual promotion"),
      showNotice: vi.fn(),
      loadMemoryViewer: vi.fn(),
      loadMemoryDetail: vi.fn(),
      t: (_key, _params, fallback) => fallback || "",
    });

    const promote = action.promote({ id: "chunk-1" });
    action.dispose();
    request.reject(new Error("late failure"));

    await expect(promote).resolves.toBeNull();
    expect(action.getRuntimeSnapshot().pendingMemorySharePromoteActionCount).toBe(0);
  });
});
