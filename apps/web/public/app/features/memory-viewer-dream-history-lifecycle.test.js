import { describe, expect, it } from "vitest";

import { createMemoryViewerDreamHistoryLifecycle } from "./memory-viewer-dream-history-lifecycle.js";

describe("memory viewer Dream history lifecycle", () => {
  it("tracks list and detail requests through stale physical settlement", async () => {
    let resolveList;
    let resolveDetail;
    const listPromise = new Promise((resolve) => { resolveList = resolve; });
    const detailPromise = new Promise((resolve) => { resolveDetail = resolve; });
    const lifecycle = createMemoryViewerDreamHistoryLifecycle();
    const list = lifecycle.run("list", () => listPromise);
    const detail = lifecycle.run("detail", () => detailPromise);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      pendingDreamHistoryRequestCount: 2,
      pendingDreamHistoryListRequestCount: 1,
      pendingDreamHistoryDetailRequestCount: 1,
    });

    lifecycle.dispose();
    resolveList();
    resolveDetail();
    await Promise.all([list, detail]);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingDreamHistoryRequestCount: 0,
    });
  });
});
