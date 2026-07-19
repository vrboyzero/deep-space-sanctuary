import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerDedupActions } from "./memory-viewer-dedup-actions.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createFixture(sendReq) {
  const state = {
    open: false,
    loading: false,
    applying: false,
    error: "",
    report: null,
    result: null,
  };
  const render = vi.fn();
  const showNotice = vi.fn();
  const loadMemoryViewer = vi.fn(async () => {});
  const actions = createMemoryViewerDedupActions({
    getModalState: () => state,
    isConnected: () => true,
    sendReq,
    makeId: () => "req-1",
    getActiveAgentId: () => "default",
    buildFilter: () => ({ memoryType: "daily" }),
    render,
    showNotice,
    loadMemoryViewer,
    t: (_key, _params, fallback) => fallback || "",
  });
  return { actions, loadMemoryViewer, render, showNotice, state };
}

describe("memory viewer dedup actions", () => {
  it("settles stale preview without restoring report state", async () => {
    const request = createDeferred();
    const fixture = createFixture(vi.fn(() => request.promise));
    const preview = fixture.actions.openPreview();
    expect(fixture.actions.getRuntimeSnapshot().pendingDedupActionCount).toBe(1);

    fixture.actions.dispose();
    expect(fixture.state.loading).toBe(false);
    request.resolve({ ok: true, payload: { report: { groups: [{ id: "late" }] } } });
    await preview;

    expect(fixture.state.report).toBeNull();
    expect(fixture.actions.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingDedupActionCount: 0,
    });
  });

  it("settles stale apply without notice or reload", async () => {
    const request = createDeferred();
    const fixture = createFixture(vi.fn(() => request.promise));
    fixture.state.report = { groups: [{ id: "group-1" }] };
    const apply = fixture.actions.apply();
    expect(fixture.actions.getRuntimeSnapshot().pendingDedupActionCount).toBe(1);

    fixture.actions.dispose();
    request.resolve({ ok: true, payload: { result: { backupPath: "private-path" } } });
    await apply;

    expect(fixture.state.result).toBeNull();
    expect(fixture.showNotice).not.toHaveBeenCalled();
    expect(fixture.loadMemoryViewer).not.toHaveBeenCalled();
    expect(fixture.actions.getRuntimeSnapshot().pendingDedupActionCount).toBe(0);
  });
});
