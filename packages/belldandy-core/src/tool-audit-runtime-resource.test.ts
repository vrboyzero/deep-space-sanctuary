import { expect, test } from "vitest";

import { getToolAuditRuntimeResourceQueueSnapshots } from "./tool-audit-runtime-resource.js";

test("projects tool audit backlog into generic runtime resource counters", () => {
  const snapshots = getToolAuditRuntimeResourceQueueSnapshots({
    getAuditRuntimeSnapshot: () => ({
      active: true,
      queuedCount: 3,
      maxQueueSize: 8,
      dispatchedCount: 17,
      failedCount: 5,
      droppedCount: 2,
      disposed: false,
    }),
  });

  // sink failure 不是队列接收拒绝，两个计数都不携带审计内容。
  expect(snapshots).toEqual([
    {
      id: "tool_audit",
      activeCount: 1,
      queuedCount: 3,
      capacity: 8,
      rejectedCount: 2,
    },
  ]);
});

test("omits disabled or disposed tool audit dispatchers from resource snapshots", () => {
  expect(getToolAuditRuntimeResourceQueueSnapshots()).toEqual([]);
  expect(getToolAuditRuntimeResourceQueueSnapshots({
    getAuditRuntimeSnapshot: () => ({
      active: false,
      queuedCount: 0,
      maxQueueSize: 128,
      dispatchedCount: 0,
      failedCount: 0,
      droppedCount: 0,
      disposed: true,
    }),
  })).toEqual([]);
});
