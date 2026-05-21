import { expect, test } from "vitest";

import {
  readMemoryTreeJobLedgerRecord,
  recordMemoryTreeJobLedgerFailure,
  recordMemoryTreeJobLedgerSkip,
  recordMemoryTreeJobLedgerStart,
  recordMemoryTreeJobLedgerSuccess,
} from "./memory-tree-job-ledger.js";

test("memory tree job ledger writes success and failure timestamps", () => {
  const store = createLedgerStore();

  const started = recordMemoryTreeJobLedgerStart(store, {
    jobType: "node_rebuild",
    targetKey: "profile",
    startedAt: "2026-05-21T13:00:00.000Z",
    triggerSource: "memory.tree.node.rebuild",
  });
  expect(started).toMatchObject({
    jobKey: "node_rebuild:profile",
    status: "running",
    lastRequestedAt: "2026-05-21T13:00:00.000Z",
    lastStartedAt: "2026-05-21T13:00:00.000Z",
  });

  const failed = recordMemoryTreeJobLedgerFailure(store, {
    jobType: "node_rebuild",
    targetKey: "profile",
    failedAt: "2026-05-21T13:00:30.000Z",
    error: new Error("profile ledger boom"),
    triggerSource: "memory.tree.node.rebuild",
  });
  expect(failed).toMatchObject({
    jobKey: "node_rebuild:profile",
    status: "failed",
    lastFailureAt: "2026-05-21T13:00:30.000Z",
    lastFailureError: "profile ledger boom",
    failureCount: 1,
    nextEligibleAt: expect.any(String),
    retryAfterMs: 60000,
  });

  const rereadFailed = readMemoryTreeJobLedgerRecord(store, "node_rebuild", "profile");
  expect(rereadFailed).toMatchObject({
    status: "failed",
    lastFailureAt: "2026-05-21T13:00:30.000Z",
    lastFailureError: "profile ledger boom",
  });

  const skipped = recordMemoryTreeJobLedgerSkip(store, {
    jobType: "node_rebuild",
    targetKey: "profile",
    skippedAt: "2026-05-21T13:00:45.000Z",
    reason: "reentry_blocked",
    triggerSource: "memory.tree.node.rebuild",
  });
  expect(skipped).toMatchObject({
    jobKey: "node_rebuild:profile",
    status: "running",
    skipCount: 1,
    lastSkippedAt: "2026-05-21T13:00:45.000Z",
    lastSkipReason: "reentry_blocked",
    lastSkippedTriggerSource: "memory.tree.node.rebuild",
  });

  const success = recordMemoryTreeJobLedgerSuccess(store, {
    jobType: "node_rebuild",
    targetKey: "profile",
    completedAt: "2026-05-21T13:01:00.000Z",
    triggerSource: "memory.tree.node.rebuild",
  });
  expect(success).toMatchObject({
    jobKey: "node_rebuild:profile",
    status: "completed",
    lastSuccessAt: "2026-05-21T13:01:00.000Z",
    failureCount: 0,
    skipCount: 1,
  });
  expect(readMemoryTreeJobLedgerRecord(store, "node_rebuild", "profile")).toMatchObject({
    status: "completed",
    lastSuccessAt: "2026-05-21T13:01:00.000Z",
    skipCount: 1,
  });
});

function createLedgerStore() {
  const meta = new Map<string, string>();
  return {
    getMeta(key: string) {
      return meta.get(key) ?? null;
    },
    setMeta(key: string, value: string) {
      meta.set(key, value);
    },
  };
}
