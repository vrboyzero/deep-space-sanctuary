import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PersistentCompressionReferenceStore } from "@belldandy/agent";
import { describe, expect, it } from "vitest";

import { buildPreflightCompressionGovernanceReport } from "./preflight-compression-governance.js";
import { writePreflightCompressionSidecar } from "./preflight-compression-sidecar.js";

describe("preflight compression governance", () => {
  it("reports config and cleanup diagnostics without deleting originals", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-pfc-governance-"));
    try {
      await writePreflightCompressionSidecar({
        stateDir,
        conversationId: "conv-governance",
        runId: "run-governance",
        sourceRef: "pfc_governance_old",
        sourceKind: "attachment_text",
        originalText: "old sidecar original",
        compressedText: "old",
        strategy: "test",
        now: 100,
      });
      const store = new PersistentCompressionReferenceStore({ stateDir });
      store.store("tool reference original", { conversationId: "conv-governance" });

      const report = await buildPreflightCompressionGovernanceReport({
        stateDir,
        now: 1_000,
        env: {
          BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED: "true",
          BELLDANDY_PREFLIGHT_COMPRESSION_MODE: "attachments",
          BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS: "2000",
          BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE: "sidecar",
          BELLDANDY_PREFLIGHT_SIDECAR_RETENTION_MS: "10",
          BELLDANDY_PREFLIGHT_SIDECAR_MAX_ENTRIES: "512",
          BELLDANDY_COMPRESSION_REFERENCE_STORE: "true",
          BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_STORE: "true",
          BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_TTL_MS: "86400000",
          BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_MAX_ENTRIES: "128",
        } as NodeJS.ProcessEnv,
      });

      expect(report.config).toMatchObject({
        enabled: true,
        mode: "attachments",
        attachmentThresholdChars: 2_000,
        attachmentReference: "sidecar",
        persistentReferenceStoreEnabled: true,
      });
      expect(report.storage.sidecars.totalSidecars).toBe(1);
      expect(report.storage.sidecars.expiredCount).toBe(1);
      expect(report.storage.sidecars.removedCount).toBe(0);
      expect(report.storage.persistentReferences.totalReferences).toBe(1);
      expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
        "preflight_compression_config",
        "preflight_sidecar_storage",
        "compression_reference_storage",
      ]));
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
