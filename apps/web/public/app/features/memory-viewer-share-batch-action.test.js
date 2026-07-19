import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerShareBatchAction } from "./memory-viewer-share-batch-action.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("memory viewer shared review batch action", () => {
  it("settles a disposed batch request without notice or reload", async () => {
    const request = createDeferred();
    const item = { id: "chunk-1" };
    const secondItem = { id: "chunk-2" };
    const state = { items: [item, secondItem], selectedSharedReviewIds: ["chunk-1", "chunk-2"], sharedReviewBatchBusy: false };
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn();
    const loadMemoryDetail = vi.fn();
    const render = vi.fn();
    const sendClaimRequest = vi.fn(() => request.promise);
    const action = createMemoryViewerShareBatchAction({
      getState: () => state,
      getSelectedIds: () => state.selectedSharedReviewIds,
      getActiveAgentId: () => "default",
      buildBatchState: () => ({ selectedCount: 2, actions: { claim: [item, secondItem] } }),
      promptAction: vi.fn(),
      sendClaimRequest,
      sendReviewRequest: vi.fn(),
      render,
      formatActionLabel: (value) => value,
      formatCount: (value) => String(value),
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });

    const run = action.run("claim");
    expect(state.sharedReviewBatchBusy).toBe(true);
    expect(action.getRuntimeSnapshot().pendingMemoryShareBatchActionCount).toBe(1);

    action.dispose();
    request.resolve({ ok: true });
    await run;

    expect(state.sharedReviewBatchBusy).toBe(false);
    expect(showNotice).not.toHaveBeenCalled();
    expect(loadMemoryViewer).not.toHaveBeenCalled();
    expect(loadMemoryDetail).not.toHaveBeenCalled();
    expect(sendClaimRequest).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemoryShareBatchActionCount: 0,
    });
  });

  it("preserves partial success notice and reload behavior", async () => {
    const firstItem = { id: "chunk-1" };
    const secondItem = { id: "chunk-2" };
    const state = {
      items: [firstItem, secondItem],
      selectedId: "chunk-1",
      selectedSharedReviewIds: ["chunk-1", "chunk-2"],
      sharedReviewBatchBusy: false,
    };
    const sendClaimRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: { message: "claim failed" } });
    const showNotice = vi.fn();
    const loadMemoryViewer = vi.fn(async () => {});
    const loadMemoryDetail = vi.fn(async () => {});
    const render = vi.fn();
    const action = createMemoryViewerShareBatchAction({
      getState: () => state,
      getSelectedIds: () => state.selectedSharedReviewIds,
      getActiveAgentId: () => "default",
      buildBatchState: () => ({ selectedCount: 2, actions: { claim: [firstItem, secondItem] } }),
      promptAction: vi.fn(),
      sendClaimRequest,
      sendReviewRequest: vi.fn(),
      render,
      formatActionLabel: (value) => value,
      formatCount: (value) => String(value),
      showNotice,
      loadMemoryViewer,
      loadMemoryDetail,
      t: (_key, _params, fallback) => fallback || "",
    });

    await expect(action.run("claim")).resolves.toEqual({ successCount: 1, errorCount: 1 });

    expect(state.sharedReviewBatchBusy).toBe(false);
    expect(sendClaimRequest).toHaveBeenCalledTimes(2);
    expect(showNotice).toHaveBeenCalledWith(
      "Shared Claim Updated",
      "claim applied to 1 selected item(s).",
      "info",
      3200,
    );
    expect(loadMemoryViewer).toHaveBeenCalledWith(false);
    expect(loadMemoryDetail).toHaveBeenCalledWith("chunk-1");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("suppresses a disposed batch rejection after physical settlement", async () => {
    const request = createDeferred();
    const item = { id: "chunk-1" };
    const state = { items: [item], selectedSharedReviewIds: ["chunk-1"], sharedReviewBatchBusy: false };
    const action = createMemoryViewerShareBatchAction({
      getState: () => state,
      getSelectedIds: () => state.selectedSharedReviewIds,
      getActiveAgentId: () => "default",
      buildBatchState: () => ({ selectedCount: 1, actions: { claim: [item] } }),
      promptAction: vi.fn(),
      sendClaimRequest: vi.fn(() => request.promise),
      sendReviewRequest: vi.fn(),
      render: vi.fn(),
      formatActionLabel: (value) => value,
      formatCount: (value) => String(value),
      showNotice: vi.fn(),
      loadMemoryViewer: vi.fn(),
      loadMemoryDetail: vi.fn(),
      t: (_key, _params, fallback) => fallback || "",
    });

    const run = action.run("claim");
    action.dispose();
    request.reject(new Error("late failure"));

    await expect(run).resolves.toBeNull();
    expect(state.sharedReviewBatchBusy).toBe(false);
    expect(action.getRuntimeSnapshot().pendingMemoryShareBatchActionCount).toBe(0);
  });

  it("releases active busy state when a batch request rejects", async () => {
    const item = { id: "chunk-1" };
    const state = { items: [item], selectedSharedReviewIds: ["chunk-1"], sharedReviewBatchBusy: false };
    const render = vi.fn();
    const action = createMemoryViewerShareBatchAction({
      getState: () => state,
      getSelectedIds: () => state.selectedSharedReviewIds,
      getActiveAgentId: () => "default",
      buildBatchState: () => ({ selectedCount: 1, actions: { claim: [item] } }),
      promptAction: vi.fn(),
      sendClaimRequest: vi.fn(async () => { throw new Error("request failed"); }),
      sendReviewRequest: vi.fn(),
      render,
      formatActionLabel: (value) => value,
      formatCount: (value) => String(value),
      showNotice: vi.fn(),
      loadMemoryViewer: vi.fn(),
      loadMemoryDetail: vi.fn(),
      t: (_key, _params, fallback) => fallback || "",
    });

    await expect(action.run("claim")).rejects.toThrow("request failed");
    expect(state.sharedReviewBatchBusy).toBe(false);
    expect(render).toHaveBeenCalledTimes(2);
    expect(action.getRuntimeSnapshot().pendingMemoryShareBatchActionCount).toBe(0);
  });
});
