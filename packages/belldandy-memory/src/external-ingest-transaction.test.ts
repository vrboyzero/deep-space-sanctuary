import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExternalIngestBatchInput } from "./external-ingest-transaction.js";
import { MemoryStore } from "./store.js";
import type { MemoryChunk } from "./types.js";

describe("external ingest transaction", () => {
  const sourceId = "configured:external-transaction:1";
  let rootDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-external-ingest-transaction-"));
    store = new MemoryStore(path.join(rootDir, "memory.db"));
  });

  afterEach(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it("rolls back every replacement and stale deletion when one source write fails", () => {
    const firstPath = "/tmp/external-first.md";
    const secondPath = "/tmp/external-second.md";
    const stalePath = "/tmp/external-stale.md";
    store.upsertChunk(createExternalChunk("old-first", firstPath, "old-first-hash", "old first"));
    store.upsertChunk(createExternalChunk("old-second", secondPath, "old-second-hash", "old second"));
    store.upsertChunk(createExternalChunk("old-stale", stalePath, "old-stale-hash", "old stale"));
    const changeSequenceBeforeApply = store.getMemoryChangeSeq();

    const circularMetadata: { memoryTree: { externalSourceId: string }; self?: unknown } = {
      memoryTree: { externalSourceId: sourceId },
    };
    circularMetadata.self = circularMetadata;
    const brokenReplacement = {
      ...createExternalChunk("new-second", secondPath, "new-second-hash", "new second"),
      metadata: circularMetadata,
    } satisfies MemoryChunk;

    expect(() => applyExternalIngestBatch(store, {
      sourceId,
      replacements: [
        {
          sourcePath: firstPath,
          expectedPreviousContentHash: "old-first-hash",
          chunks: [createExternalChunk("new-first", firstPath, "new-first-hash", "new first")],
        },
        {
          sourcePath: secondPath,
          expectedPreviousContentHash: "old-second-hash",
          chunks: [brokenReplacement],
        },
      ],
      staleSources: [{
        sourcePath: stalePath,
        expectedPreviousContentHash: "old-stale-hash",
      }],
    })).toThrow(/circular|cyclic/i);

    expect(store.getChunksBySource(firstPath, 10).map((chunk) => chunk.id)).toEqual(["old-first"]);
    expect(store.getChunksBySource(secondPath, 10).map((chunk) => chunk.id)).toEqual(["old-second"]);
    expect(store.getChunksBySource(stalePath, 10).map((chunk) => chunk.id)).toEqual(["old-stale"]);
    expect(store.getMemoryChangeSeq()).toBe(changeSequenceBeforeApply);
  });

  it("retains stale paths when their lineage or content revision changed after preview", () => {
    const newerPath = "/tmp/external-newer.md";
    const foreignPath = "/tmp/external-foreign.md";
    const removablePath = "/tmp/external-removable.md";
    store.upsertChunk(createExternalChunk("newer", newerPath, "newer-hash", "newer content"));
    store.upsertChunk(createExternalChunk("foreign", foreignPath, "foreign-hash", "foreign content", "configured:other:1"));
    store.upsertChunk(createExternalChunk("removable", removablePath, "old-removable-hash", "old removable content"));
    const changeSequenceBeforeApply = store.getMemoryChangeSeq();

    const result = applyExternalIngestBatch(store, {
      sourceId,
      replacements: [],
      staleSources: [
        { sourcePath: newerPath, expectedPreviousContentHash: "old-hash" },
        { sourcePath: foreignPath, expectedPreviousContentHash: "foreign-hash" },
        { sourcePath: removablePath, expectedPreviousContentHash: "old-removable-hash" },
      ],
    });

    expect(result.staleDeletions).toEqual([
      expect.objectContaining({ sourcePath: newerPath, deletedChunkCount: 0, skippedReason: "revision_changed" }),
      expect.objectContaining({ sourcePath: foreignPath, deletedChunkCount: 0, skippedReason: "lineage_mismatch" }),
      expect.objectContaining({ sourcePath: removablePath, deletedChunkCount: 1 }),
    ]);
    expect(store.getChunksBySource(newerPath, 10)).toHaveLength(1);
    expect(store.getChunksBySource(foreignPath, 10)).toHaveLength(1);
    expect(store.getChunksBySource(removablePath, 10)).toHaveLength(0);
    expect(store.getMemoryChangeSeq()).toBe(changeSequenceBeforeApply + 1);
  });

  it("rejects a replacement that would overwrite another external lineage", () => {
    const sourcePath = "/tmp/external-conflict.md";
    store.upsertChunk(createExternalChunk("foreign", sourcePath, "foreign-hash", "foreign content", "configured:other:1"));

    expect(() => applyExternalIngestBatch(store, {
      sourceId,
      replacements: [{
        sourcePath,
        expectedPreviousContentHash: "foreign-hash",
        chunks: [createExternalChunk("ours", sourcePath, "ours-hash", "our content")],
      }],
      staleSources: [],
    })).toThrow("external ingest lineage conflict");
    expect(store.getChunksBySource(sourcePath, 10).map((chunk) => chunk.id)).toEqual(["foreign"]);
  });

  it("rejects a newly previewed path that was populated before apply", () => {
    const sourcePath = "/tmp/external-raced-new.md";
    store.upsertChunk(createExternalChunk("raced", sourcePath, "raced-hash", "raced content"));

    expect(() => applyExternalIngestBatch(store, {
      sourceId,
      replacements: [{
        sourcePath,
        expectedExistingState: "missing",
        chunks: [createExternalChunk("ours", sourcePath, "ours-hash", "our content")],
      }],
      staleSources: [],
    })).toThrow("external ingest source revision changed");
    expect(store.getChunksBySource(sourcePath, 10).map((chunk) => chunk.id)).toEqual(["raced"]);
  });

  it("rejects a replacement chunk id already owned by another source path", () => {
    const foreignPath = "/tmp/external-id-foreign.md";
    const replacementPath = "/tmp/external-id-replacement.md";
    store.upsertChunk(createExternalChunk("shared-id", foreignPath, "foreign-hash", "foreign content"));

    expect(() => applyExternalIngestBatch(store, {
      sourceId,
      replacements: [{
        sourcePath: replacementPath,
        expectedExistingState: "missing",
        chunks: [createExternalChunk("shared-id", replacementPath, "replacement-hash", "replacement content")],
      }],
      staleSources: [],
    })).toThrow("external ingest chunk id conflict");
    expect(store.getChunksBySource(foreignPath, 10).map((chunk) => chunk.id)).toEqual(["shared-id"]);
    expect(store.getChunksBySource(replacementPath, 10)).toEqual([]);
  });

  it("removes vec0 rows together with replaced external chunks", () => {
    const sourcePath = "/tmp/external-vector.md";
    store.upsertChunk(createExternalChunk("old-vector", sourcePath, "old-hash", "old content"));
    store.prepareVectorStore(2);
    store.upsertChunkVector("old-vector", [0.1, 0.2], "test-model");

    applyExternalIngestBatch(store, {
      sourceId,
      replacements: [{
        sourcePath,
        expectedPreviousContentHash: "old-hash",
        expectedExistingState: "present",
        chunks: [createExternalChunk("new-vector", sourcePath, "new-hash", "new content")],
      }],
      staleSources: [],
    });

    expect(store.getChunkVector("new-vector")).toBeNull();
  });
});

function createExternalChunk(
  id: string,
  sourcePath: string,
  contentHash: string,
  content: string,
  externalSourceId = "configured:external-transaction:1",
): MemoryChunk {
  return {
    id,
    sourcePath,
    sourceType: "file",
    memoryType: "other",
    content,
    metadata: {
      file_hash: contentHash,
      memoryTree: {
        externalSourceId,
      },
    },
  };
}

function applyExternalIngestBatch(store: MemoryStore, input: ExternalIngestBatchInput) {
  return store.applyExternalIngestBatch(input);
}
