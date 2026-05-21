import { expect, test } from "vitest";

import {
  buildExternalMemoryIngestGovernanceSummary,
  type ExternalMemoryIngestGovernanceIndexedSource,
} from "./external-memory-ingest-governance.js";
import type { ExternalMemoryIngestPreview } from "./external-memory-ingest.js";

function createPreviewFixture(): ExternalMemoryIngestPreview {
  return {
    adapter: "obsidian_markdown_directory_v1",
    generatedAt: "2026-05-21T12:00:00.000Z",
    source: {
      id: "configured:obsidian-vault:1",
      label: "Obsidian Vault",
      sourceClass: "curated",
      scope: "private",
      rootPath: "E:/vault",
      fileExtensions: [".md"],
    },
    sourceId: "configured:obsidian-vault:1",
    sourceLabel: "Obsidian Vault",
    sourceClass: "curated",
    scope: "private",
    storage: "external",
    rootPath: "E:/vault",
    totalFiles: 2,
    eligibleFiles: 2,
    skippedFiles: 0,
    estimatedChunks: 5,
    estimatedBytes: 4096,
    fileManifest: [
      {
        path: "E:/vault/Projects/viewer-audit.md",
        relativePath: "Projects/viewer-audit.md",
        size: 1024,
        mtime: "2026-05-21T11:58:00.000Z",
        estimatedChunks: 3,
        contentHash: "hash-a",
        sourceType: "file",
        memoryType: "other",
        status: "eligible",
      },
      {
        path: "E:/vault/Reference/checklist.md",
        relativePath: "Reference/checklist.md",
        size: 768,
        mtime: "2026-05-21T11:59:00.000Z",
        estimatedChunks: 2,
        contentHash: "hash-b",
        sourceType: "file",
        memoryType: "other",
        status: "eligible",
      },
    ],
    skipReasons: [],
    rescan: {
      mode: "rescan",
      previousFileCount: 1,
      newFileCount: 1,
      changedFileCount: 1,
      unchangedFileCount: 0,
      staleFileCount: 0,
      staleFiles: [],
    },
  };
}

test("buildExternalMemoryIngestGovernanceSummary flags exact path conflicts and root overlap for review", () => {
  const indexedSources: ExternalMemoryIngestGovernanceIndexedSource[] = [
    {
      sourcePath: "E:/vault/Projects/viewer-audit.md",
      sourceKind: "workspace_file",
      sourceClass: "raw",
      scope: "shared",
      searchPolicy: "searchable",
    },
    {
      sourcePath: "E:/vault/Existing/legacy-note.md",
      sourceKind: "manual_memory",
      sourceClass: "raw",
      scope: "private",
      searchPolicy: "searchable",
    },
  ];

  const summary = buildExternalMemoryIngestGovernanceSummary(createPreviewFixture(), {
    indexedSources,
  });

  expect(summary).toMatchObject({
    reviewSuggestionCount: 2,
    keepSuggestionCount: 0,
    archiveSuggestionCount: 0,
    duplicateFileCount: 1,
    rootOverlapFileCount: 2,
  });
  expect(summary.topSuggestions).toEqual(expect.arrayContaining([
    expect.objectContaining({
      category: "external_import_duplicate",
      suggestedAction: "review",
      riskLevel: "high",
      fileCount: 1,
      signals: expect.arrayContaining(["exact_path_conflict", "searchable_conflict", "shared_scope_conflict"]),
    }),
    expect.objectContaining({
      category: "external_import_root_overlap",
      suggestedAction: "review",
      fileCount: 2,
      samplePaths: expect.arrayContaining(["E:/vault/Projects/viewer-audit.md"]),
    }),
  ]));
});

test("buildExternalMemoryIngestGovernanceSummary keeps same-source rescans as lineage refresh", () => {
  const indexedSources: ExternalMemoryIngestGovernanceIndexedSource[] = [
    {
      sourcePath: "E:/vault/Projects/viewer-audit.md",
      sourceKind: "configured_external",
      sourceClass: "curated",
      scope: "private",
      searchPolicy: "inventory-only",
      externalSourceId: "configured:obsidian-vault:1",
    },
  ];

  const summary = buildExternalMemoryIngestGovernanceSummary(createPreviewFixture(), {
    indexedSources,
  });

  expect(summary).toMatchObject({
    reviewSuggestionCount: 0,
    keepSuggestionCount: 1,
    archiveSuggestionCount: 0,
    duplicateFileCount: 0,
    sameSourceRescanFileCount: 1,
  });
  expect(summary.topSuggestions).toEqual([
    expect.objectContaining({
      category: "external_rescan_replace",
      suggestedAction: "keep",
      reviewRequired: false,
      signals: ["same_source_rescan"],
      fileCount: 1,
    }),
  ]);
});
