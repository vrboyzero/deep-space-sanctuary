import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cleanupPersistentCompressionReferences,
  PersistentCompressionReferenceStore,
  readPersistentCompressionReference,
} from "./persistent-compression-reference-store.js";
import { createCompressionPipeline } from "./context-compression/index.js";

describe("persistent compression reference store", () => {
  it("stores compressed tool result originals on disk and retrieves them by refId", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tcr-"));
    try {
      const store = new PersistentCompressionReferenceStore({ stateDir });
      const pipeline = createCompressionPipeline({
        allowReferenceStore: true,
        sourceOverrides: {
          tool_result: { enabled: true, allowLossy: true, allowReferenceStore: true },
        },
      }, { referenceStore: store });
      const content = Array.from({ length: 100 }, (_, index) => `2026-07-07 INFO line ${index}`).join("\n");

      const result = await pipeline.compress({
        sourceKind: "tool_result",
        sourceName: "run_command",
        content,
        conversationId: "conv-ref",
        runId: "run-ref",
      });

      expect(result.reference?.refId).toMatch(/^tcr_/);
      const retrieved = readPersistentCompressionReference({
        stateDir,
        conversationId: "conv-ref",
        runId: "run-ref",
        refId: result.reference!.refId,
      });
      expect(retrieved.content).toBe(content);
      expect(retrieved.record.metadata).toMatchObject({
        conversationId: "conv-ref",
        runId: "run-ref",
        sourceName: "run_command",
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects invalid refs and mismatched conversation ownership", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tcr-"));
    try {
      const store = new PersistentCompressionReferenceStore({ stateDir });
      const stored = store.store("secret-ish output", {
        conversationId: "conv-a",
        runId: "run-a",
      });

      expect(() => readPersistentCompressionReference({
        stateDir,
        conversationId: "conv-a",
        refId: "../escape",
      })).toThrow("invalid_ref_id");
      expect(() => readPersistentCompressionReference({
        stateDir,
        conversationId: "conv-b",
        refId: stored.refId,
      })).toThrow("reference_conversation_mismatch");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("marks expired references as expired and omits content", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tcr-"));
    try {
      const store = new PersistentCompressionReferenceStore({ stateDir, ttlMs: 10_000 });
      const stored = store.store("old output", {
        conversationId: "conv-expire",
      });

      const retrieved = readPersistentCompressionReference({
        stateDir,
        conversationId: "conv-expire",
        refId: stored.refId,
        ttlMs: 1,
        now: stored.createdAt + 2,
      });
      expect(retrieved.record.status).toBe("expired");
      expect(retrieved.content).toBe("");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("cleans expired and over-limit persistent references", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tcr-cleanup-"));
    try {
      const store = new PersistentCompressionReferenceStore({ stateDir, ttlMs: 10_000, maxEntries: 10 });
      const old = store.store("old output", { conversationId: "conv-clean" });

      const dryRun = cleanupPersistentCompressionReferences({
        stateDir,
        ttlMs: 1,
        maxEntries: 10,
        now: old.createdAt + 2,
        dryRun: true,
      });
      expect(dryRun.expiredCount).toBeGreaterThanOrEqual(1);
      expect(dryRun.removedCount).toBe(0);

      const removedExpired = cleanupPersistentCompressionReferences({
        stateDir,
        ttlMs: 1,
        maxEntries: 10,
        now: old.createdAt + 2,
      });
      expect(removedExpired.removedCount).toBeGreaterThanOrEqual(1);
      expect(() => readPersistentCompressionReference({
        stateDir,
        refId: old.refId,
      })).toThrow();

      store.clear();
      const overflowStore = new PersistentCompressionReferenceStore({ stateDir, ttlMs: 10_000, maxEntries: 10 });
      const oldest = overflowStore.store("oldest output", { conversationId: "conv-clean" });
      await new Promise((resolve) => setTimeout(resolve, 2));
      const newest = store.store("newest output", { conversationId: "conv-clean" });
      const removedOverLimit = cleanupPersistentCompressionReferences({
        stateDir,
        ttlMs: 10_000,
        maxEntries: 1,
        now: newest.createdAt,
      });
      expect(removedOverLimit.overLimitCount).toBe(1);
      expect(() => readPersistentCompressionReference({
        stateDir,
        refId: oldest.refId,
      })).toThrow();
      expect(readPersistentCompressionReference({
        stateDir,
        refId: newest.refId,
      }).content).toBe("newest output");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
