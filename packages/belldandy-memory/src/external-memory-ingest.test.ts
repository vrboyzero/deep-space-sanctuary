import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  annotateExternalIngestPreviewRescan,
  materializeObsidianMarkdownChunks,
  previewObsidianMarkdownDirectoryIngest,
} from "./external-memory-ingest.js";

describe("external memory ingest boundaries", () => {
  let rootDir: string;
  let vaultDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-external-ingest-"));
    vaultDir = path.join(rootDir, "vault");
    outsideDir = path.join(rootDir, "outside");
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  function createSource() {
    return {
      id: "configured:external-test:1",
      label: "External Test Vault",
      sourceClass: "curated" as const,
      scope: "private" as const,
      rootPath: vaultDir,
      fileExtensions: [".md"],
    };
  }

  it("marks a max-files scan as incomplete and never makes unscanned paths stale", async () => {
    const firstPath = path.join(vaultDir, "a-first.md");
    const unscannedPath = path.join(vaultDir, "b-unscanned.md");
    await fs.writeFile(firstPath, "# First\n\nfirst note", "utf-8");
    await fs.writeFile(unscannedPath, "# Second\n\nsecond note", "utf-8");

    const preview = await previewObsidianMarkdownDirectoryIngest(createSource(), {
      limits: { maxFiles: 1 },
    });
    const rescanned = annotateExternalIngestPreviewRescan(preview, [
      {
        path: unscannedPath,
        relativePath: "b-unscanned.md",
        contentHash: "previous-hash",
        chunkCount: 2,
      },
    ]);

    expect(preview).toMatchObject({
      rootRealPath: expect.any(String),
      scan: {
        complete: false,
        truncationReasons: ["max_files_exceeded"],
      },
    });
    expect(rescanned.rescan.staleFiles).toEqual([]);
  });

  it("reports depth, per-file, total-byte, and chunk budget rejections without reading past limits", async () => {
    await fs.writeFile(path.join(vaultDir, "a-small.md"), "a".repeat(40), "utf-8");
    await fs.writeFile(path.join(vaultDir, "b-total.md"), "b".repeat(40), "utf-8");
    await fs.writeFile(path.join(vaultDir, "c-large.md"), "c".repeat(65), "utf-8");
    await fs.mkdir(path.join(vaultDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, "nested", "too-deep.md"), "nested note", "utf-8");

    const bytePreview = await previewObsidianMarkdownDirectoryIngest(createSource(), {
      limits: {
        maxDepth: 1,
        maxFileBytes: 64,
        maxTotalBytes: 60,
      },
    });
    expect(bytePreview.fileManifest).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: path.join(vaultDir, "a-small.md"), status: "eligible" }),
      expect.objectContaining({ path: path.join(vaultDir, "b-total.md"), skipReason: "max_total_bytes_exceeded" }),
      expect.objectContaining({ path: path.join(vaultDir, "c-large.md"), skipReason: "max_file_bytes_exceeded" }),
    ]));
    expect(bytePreview.scan).toMatchObject({
      complete: false,
      truncationReasons: expect.arrayContaining(["max_depth_exceeded"]),
    });

    const fileBudgetPreview = await previewObsidianMarkdownDirectoryIngest(createSource(), {
      limits: { maxDepth: 8, maxFileBytes: 32, maxTotalBytes: 1_000 },
    });
    const fileBudgetRescan = annotateExternalIngestPreviewRescan(fileBudgetPreview, [
      {
        path: path.join(vaultDir, "a-small.md"),
        relativePath: "a-small.md",
        contentHash: "previous-small-hash",
        chunkCount: 1,
      },
    ]);
    expect(fileBudgetPreview.scan).toMatchObject({ complete: true });
    expect(fileBudgetRescan.rescan.staleFiles).toEqual([]);

    const chunkPreview = await previewObsidianMarkdownDirectoryIngest(createSource(), {
      limits: { maxDepth: 8, maxChunks: 1 },
    });
    expect(chunkPreview.fileManifest).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: path.join(vaultDir, "a-small.md"), status: "eligible" }),
      expect.objectContaining({ path: path.join(vaultDir, "b-total.md"), skipReason: "max_chunks_exceeded" }),
    ]));
  });

  it("rechecks file identity before materializing a reviewed preview", async () => {
    const notePath = path.join(vaultDir, "note.md");
    const outsidePath = path.join(outsideDir, "outside.md");
    await fs.writeFile(notePath, "# Safe\n\npreviewed note", "utf-8");
    await fs.writeFile(outsidePath, "# Outside\n\nmust not be imported", "utf-8");

    const preview = await previewObsidianMarkdownDirectoryIngest(createSource());
    await fs.rm(notePath);
    try {
      await fs.symlink(outsidePath, notePath, process.platform === "win32" ? "file" : "file");
    } catch {
      // 某些 Windows 测试环境禁止创建 symlink；其余预算与 canonical-path 测试仍可执行。
      return;
    }

    const materialized = await materializeObsidianMarkdownChunks(preview, {
      appliedAt: "2026-07-17T00:00:00.000Z",
      reportId: "report-external-boundary",
    });

    expect(materialized.chunksBySourcePath).toEqual([]);
    expect(materialized.skippedFiles).toEqual([
      expect.objectContaining({ path: notePath, reason: "symlink_not_allowed" }),
    ]);
  });

  it("rejects the entire materialization when the configured root identity changes", async () => {
    const notePath = path.join(vaultDir, "note.md");
    await fs.writeFile(notePath, "# Safe\n\npreviewed note", "utf-8");
    const preview = await previewObsidianMarkdownDirectoryIngest(createSource());

    const replacedVaultDir = path.join(rootDir, "vault-before-replacement");
    await fs.rename(vaultDir, replacedVaultDir);
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.writeFile(notePath, "# Replacement\n\nnew root content", "utf-8");

    await expect(materializeObsidianMarkdownChunks(preview, {
      appliedAt: "2026-07-17T00:00:00.000Z",
      reportId: "report-external-root-replaced",
    })).rejects.toThrow("external ingest root changed since preview");
  });
});
