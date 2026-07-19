import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerShareClaimAction } from "./memory-viewer-share-claim-action.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("memory viewer shared claim action", () => {
  it("settles a disposed claim without notice or reload", async () => {
    const request = createDeferred();
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn();
    const loadMemoryDetail = vi.fn();
    const action = createMemoryViewerShareClaimAction({
      getState: () => ({ selectedId: "chunk-1" }),
      sendRequest: vi.fn(() => request.promise),
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });

    const claim = action.claim({ id: "chunk-1" }, "claim", "chunk");
    expect(action.getRuntimeSnapshot().pendingMemoryShareClaimActionCount).toBe(1);

    action.dispose();
    request.resolve({ ok: true, payload: { claimedCount: 1 } });
    await claim;

    expect(showNotice).not.toHaveBeenCalled();
    expect(loadMemoryViewer).not.toHaveBeenCalled();
    expect(loadMemoryDetail).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemoryShareClaimActionCount: 0,
    });
  });

  it("preserves the active claim notice and reload contract", async () => {
    const sendRequest = vi.fn(async () => ({
      ok: true,
      payload: { claimedCount: 1, mode: "source" },
    }));
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn(async () => {});
    const loadMemoryDetail = vi.fn(async () => {});
    const action = createMemoryViewerShareClaimAction({
      getState: () => ({ selectedId: "chunk-1" }),
      sendRequest,
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });
    const item = { id: "chunk-1" };

    await expect(action.claim(item, "release", "source")).resolves.toEqual({
      claimedCount: 1,
      mode: "source",
    });

    expect(sendRequest).toHaveBeenCalledWith(item, "release", "source");
    expect(showNotice).toHaveBeenCalledWith(
      "Shared Claim Updated",
      "Shared review claim has been updated.",
      "success",
      2600,
    );
    expect(loadMemoryViewer).toHaveBeenCalledWith(false);
    expect(loadMemoryDetail).toHaveBeenCalledWith("chunk-1");
    expect(action.getRuntimeSnapshot().pendingMemoryShareClaimActionCount).toBe(0);
  });

  it("suppresses a disposed claim rejection after physical settlement", async () => {
    const request = createDeferred();
    const action = createMemoryViewerShareClaimAction({
      getState: () => ({ selectedId: "chunk-1" }),
      sendRequest: vi.fn(() => request.promise),
      showNotice: vi.fn(),
      loadMemoryViewer: vi.fn(),
      loadMemoryDetail: vi.fn(),
      t: (_key, _params, fallback) => fallback || "",
    });

    const claim = action.claim({ id: "chunk-1" }, "claim");
    action.dispose();
    request.reject(new Error("late failure"));

    await expect(claim).resolves.toBeNull();
    expect(action.getRuntimeSnapshot().pendingMemoryShareClaimActionCount).toBe(0);
  });
});
