import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EmbeddingFailureLedger } from "./embedding-failure-ledger.js";
import { MemoryStore } from "./store.js";

describe("EmbeddingFailureLedger", () => {
  let rootDir: string;
  let store: MemoryStore;
  let ledger: EmbeddingFailureLedger;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-embedding-failure-ledger-"));
    store = new MemoryStore(path.join(rootDir, "memory.sqlite"));
    ledger = new EmbeddingFailureLedger(store.getDbHandleForSharedSchema());
  });

  afterEach(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("persists a bounded exponential retry window and clears it after success", () => {
    const scope = "model=test|passagePrefix=";

    const [first] = ledger.recordFailures({
      scope,
      chunkIds: ["chunk-a"],
      reason: "invalid_response",
      failedAtMs: 1_000,
    });

    expect(first).toMatchObject({
      chunkId: "chunk-a",
      scope,
      failureCount: 1,
      nextRetryAt: 61_000,
      lastFailureReason: "invalid_response",
    });
    expect(ledger.getBackoffChunkIds(scope, ["chunk-a", "chunk-b"], 60_999))
      .toEqual(new Set(["chunk-a"]));
    expect(ledger.getBackoffChunkIds(scope, ["chunk-a"], 61_000)).toEqual(new Set());

    const [second] = ledger.recordFailures({
      scope,
      chunkIds: ["chunk-a"],
      reason: "request_failed",
      failedAtMs: 70_000,
    });
    expect(second).toMatchObject({
      failureCount: 2,
      nextRetryAt: 190_000,
      lastFailureReason: "request_failed",
    });

    ledger.clearFailures(scope, ["chunk-a"]);
    expect(ledger.getRecord(scope, "chunk-a")).toBeUndefined();
  });

  it("installs the additive schema idempotently without changing existing store tables", () => {
    expect(() => new EmbeddingFailureLedger(store.getDbHandleForSharedSchema())).not.toThrow();
    expect(store.getVectorStatus()).toEqual({ indexed: 0, cached: 0, model: undefined });
  });

  it("keeps storage failures in a fixed safe classification", () => {
    const [record] = ledger.recordFailures({
      scope: "model=test|passagePrefix=",
      chunkIds: ["chunk-storage"],
      reason: "storage_failed",
      failedAtMs: 5_000,
    });

    expect(record).toMatchObject({
      lastFailureReason: "storage_failed",
      failureCount: 1,
      nextRetryAt: 65_000,
    });
    expect(ledger.getRecord("model=test|passagePrefix=", "chunk-storage")).toMatchObject({
      lastFailureReason: "storage_failed",
    });
  });
});
