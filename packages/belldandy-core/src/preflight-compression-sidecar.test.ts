import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cleanupPreflightCompressionSidecars,
  readPreflightCompressionSidecar,
  writePreflightCompressionSidecar,
} from "./preflight-compression-sidecar.js";

describe("preflight compression sidecar", () => {
  it("writes and reads original text by conversation, run, and sourceRef", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-pfc-sidecar-"));
    try {
      const sidecar = await writePreflightCompressionSidecar({
        stateDir,
        conversationId: "conv:sidecar",
        runId: "run-1",
        sourceRef: "pfc_test_ref_001",
        sourceKind: "attachment_text",
        sourceName: "long.txt",
        fingerprint: "fp-1",
        originalText: "原始附件全文",
        compressedText: "附件摘要",
        strategy: "plain_text_extract",
        now: 123,
      });

      const result = await readPreflightCompressionSidecar({
        stateDir,
        conversationId: "conv:sidecar",
        runId: "run-1",
        sourceRef: sidecar.sourceRef,
      });

      expect(result.originalText).toBe("原始附件全文");
      expect(result.sidecar).toMatchObject({
        conversationId: "conv:sidecar",
        runId: "run-1",
        sourceRef: "pfc_test_ref_001",
        sourceKind: "attachment_text",
        sourceName: "long.txt",
        fingerprint: "fp-1",
        originalChars: 6,
        compressedChars: 4,
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects path-like sourceRef values before reading files", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-pfc-sidecar-"));
    try {
      await expect(readPreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-1",
        runId: "run-1",
        sourceRef: "../secrets",
      })).rejects.toThrow("invalid_source_ref");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("cleans expired and over-limit sidecars without exposing original text", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-pfc-sidecar-cleanup-"));
    try {
      const old = await writePreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-clean",
        runId: "run-clean",
        sourceRef: "pfc_cleanup_old",
        sourceKind: "attachment_text",
        originalText: "old original",
        compressedText: "old",
        strategy: "test",
        now: 100,
      });
      const recent = await writePreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-clean",
        runId: "run-clean",
        sourceRef: "pfc_cleanup_recent",
        sourceKind: "attachment_text",
        originalText: "recent original",
        compressedText: "recent",
        strategy: "test",
        now: 200,
      });

      const dryRun = await cleanupPreflightCompressionSidecars({
        stateDir,
        retentionMs: 50,
        maxEntries: 10,
        now: 201,
        dryRun: true,
      });
      expect(dryRun.expiredCount).toBe(1);
      expect(dryRun.removedCount).toBe(0);

      const removed = await cleanupPreflightCompressionSidecars({
        stateDir,
        retentionMs: 50,
        maxEntries: 10,
        now: 201,
      });
      expect(removed.removedCount).toBe(1);
      await expect(readPreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-clean",
        runId: "run-clean",
        sourceRef: old.sourceRef,
      })).rejects.toThrow();
      await expect(readPreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-clean",
        runId: "run-clean",
        sourceRef: recent.sourceRef,
      })).resolves.toMatchObject({
        originalText: "recent original",
      });

      const newest = await writePreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-clean",
        runId: "run-clean",
        sourceRef: "pfc_cleanup_newest",
        sourceKind: "attachment_text",
        originalText: "newest original",
        compressedText: "newest",
        strategy: "test",
        now: 300,
      });
      const overLimit = await cleanupPreflightCompressionSidecars({
        stateDir,
        retentionMs: 10_000,
        maxEntries: 1,
        now: 301,
      });
      expect(overLimit.overLimitCount).toBe(1);
      await expect(readPreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-clean",
        runId: "run-clean",
        sourceRef: recent.sourceRef,
      })).rejects.toThrow();
      await expect(readPreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-clean",
        runId: "run-clean",
        sourceRef: newest.sourceRef,
      })).resolves.toMatchObject({
        originalText: "newest original",
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
