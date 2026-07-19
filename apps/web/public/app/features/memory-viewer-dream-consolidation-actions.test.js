import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerDreamConsolidationActions } from "./memory-viewer-dream-consolidation-actions.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createFixture(sendReq) {
  const state = {
    selectedDreamHistoryId: "dream-1",
    selectedDreamHistoryItem: {
      consolidation: { profilePatchCandidates: [{ profilePath: "profile.md" }] },
    },
    requestToken: 3,
  };
  const showNotice = vi.fn();
  const loadDreamHistory = vi.fn(async () => {});
  const loadDreamHistoryDetail = vi.fn(async () => {});
  const loadDreamRuntimeStatus = vi.fn(async () => {});
  const actions = createMemoryViewerDreamConsolidationActions({
    getState: () => state,
    sendReq,
    makeId: () => "req-1",
    getActiveAgentId: () => "default",
    promptAction: vi.fn(() => "note"),
    confirmAction: vi.fn(() => true),
    showNotice,
    loadDreamHistory,
    loadDreamHistoryDetail,
    loadDreamRuntimeStatus,
    t: (_key, _params, fallback) => fallback || "",
  });
  return { actions, loadDreamHistory, loadDreamHistoryDetail, loadDreamRuntimeStatus, showNotice };
}

describe("memory viewer Dream consolidation actions", () => {
  it.each([
    ["review", (actions) => actions.review("approved")],
    ["apply", (actions) => actions.apply()],
  ])("settles stale %s without notice or reload", async (_kind, start) => {
    const request = createDeferred();
    const fixture = createFixture(vi.fn(() => request.promise));
    const action = start(fixture.actions);
    expect(fixture.actions.getRuntimeSnapshot().pendingDreamConsolidationActionCount).toBe(1);

    fixture.actions.dispose();
    request.resolve({ ok: true, payload: { appliedPatchCount: 1 } });
    await action;

    expect(fixture.showNotice).not.toHaveBeenCalled();
    expect(fixture.loadDreamHistory).not.toHaveBeenCalled();
    expect(fixture.loadDreamHistoryDetail).not.toHaveBeenCalled();
    expect(fixture.loadDreamRuntimeStatus).not.toHaveBeenCalled();
    expect(fixture.actions.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingDreamConsolidationActionCount: 0,
    });
  });
});
