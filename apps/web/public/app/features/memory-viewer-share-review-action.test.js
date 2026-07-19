import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerShareReviewAction } from "./memory-viewer-share-review-action.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("memory viewer shared review action", () => {
  it("settles a disposed review without notice or reload", async () => {
    const request = createDeferred();
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn();
    const loadMemoryDetail = vi.fn();
    const action = createMemoryViewerShareReviewAction({
      getState: () => ({ selectedId: "chunk-1" }),
      sendRequest: vi.fn(() => request.promise),
      promptAction: vi.fn(() => "review note"),
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });

    const review = action.review({ id: "chunk-1" }, "approved", "chunk");
    expect(action.getRuntimeSnapshot().pendingMemoryShareReviewActionCount).toBe(1);

    action.dispose();
    request.resolve({ ok: true, payload: { reviewedCount: 1 } });
    await review;

    expect(showNotice).not.toHaveBeenCalled();
    expect(loadMemoryViewer).not.toHaveBeenCalled();
    expect(loadMemoryDetail).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemoryShareReviewActionCount: 0,
    });
  });

  it("preserves the active review prompt, notice, and reload contract", async () => {
    const sendRequest = vi.fn(async () => ({
      ok: true,
      payload: { reviewedCount: 1, mode: "source" },
    }));
    const promptAction = vi.fn(() => "review note");
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn(async () => {});
    const loadMemoryDetail = vi.fn(async () => {});
    const action = createMemoryViewerShareReviewAction({
      getState: () => ({ selectedId: "chunk-1" }),
      sendRequest,
      promptAction,
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });
    const item = { id: "chunk-1" };

    await expect(action.review(item, "rejected", "source")).resolves.toEqual({
      reviewedCount: 1,
      mode: "source",
    });

    expect(promptAction).toHaveBeenCalledWith("Optional note", "");
    expect(sendRequest).toHaveBeenCalledWith(item, "rejected", "review note", "source");
    expect(showNotice).toHaveBeenCalledWith(
      "Shared Review Updated",
      "Shared status has been updated.",
      "success",
      2600,
    );
    expect(loadMemoryViewer).toHaveBeenCalledWith(false);
    expect(loadMemoryDetail).toHaveBeenCalledWith("chunk-1");
    expect(action.getRuntimeSnapshot().pendingMemoryShareReviewActionCount).toBe(0);
  });

  it("suppresses a disposed review rejection after physical settlement", async () => {
    const request = createDeferred();
    const action = createMemoryViewerShareReviewAction({
      getState: () => ({ selectedId: "chunk-1" }),
      sendRequest: vi.fn(() => request.promise),
      promptAction: vi.fn(() => "review note"),
      showNotice: vi.fn(),
      loadMemoryViewer: vi.fn(),
      loadMemoryDetail: vi.fn(),
      t: (_key, _params, fallback) => fallback || "",
    });

    const review = action.review({ id: "chunk-1" }, "approved");
    action.dispose();
    request.reject(new Error("late failure"));

    await expect(review).resolves.toBeNull();
    expect(action.getRuntimeSnapshot().pendingMemoryShareReviewActionCount).toBe(0);
  });
});
