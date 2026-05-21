import { expect, test } from "vitest";

import {
  decorateMemoryExactDedupReportWithGovernance,
} from "./memory-dedup-governance.js";
import type {
  MemoryExactDedupPreviewReport,
} from "./memory-dedup.js";

function createGovernanceFixture(): MemoryExactDedupPreviewReport {
  return {
    mode: "dry_run",
    strategy: "hash_only_exact",
    normalization: "trimmed_lf",
    totals: {
      scannedChunks: 6,
      uniqueNormalizedHashes: 3,
      duplicateGroups: 3,
      duplicateChunks: 6,
      removableChunks: 3,
      affectedSourcePaths: 6,
      affectedTaskLinkCount: 1,
    },
    groupLimit: 10,
    truncated: false,
    groups: [
      {
        normalizedHash: "review-hash",
        normalizedChars: 24,
        groupSize: 2,
        keep: {
          id: "review-keep",
          sourcePath: "memory/review-keep.md",
          sourceType: "manual",
          visibility: "shared",
          taskLinkCount: 1,
          normalizedHash: "review-hash",
          normalizedChars: 24,
          preview: "review group",
        },
        remove: [
          {
            id: "review-remove",
            sourcePath: "external/review-remove.md",
            sourceType: "manual",
            visibility: "private",
            taskLinkCount: 0,
            normalizedHash: "review-hash",
            normalizedChars: 24,
            preview: "review group",
          },
        ],
        affectedSourcePaths: ["memory/review-keep.md", "external/review-remove.md"],
        affectedTaskLinkCount: 1,
        preview: "review group",
        sourceIndexing: {
          reindexableSourcePathCount: 1,
          nonReindexableSourcePathCount: 1,
          allAffectedSourcePathsReindexable: false,
          anyAffectedSourcePathReindexable: true,
          scopes: ["state_memory_root", "external"],
        },
      },
      {
        normalizedHash: "archive-hash",
        normalizedChars: 24,
        groupSize: 2,
        keep: {
          id: "archive-keep",
          sourcePath: "memory/archive-keep.md",
          sourceType: "manual",
          visibility: "private",
          taskLinkCount: 0,
          normalizedHash: "archive-hash",
          normalizedChars: 24,
          preview: "archive group",
        },
        remove: [
          {
            id: "archive-remove",
            sourcePath: "memory/archive-remove.md",
            sourceType: "manual",
            visibility: "private",
            taskLinkCount: 0,
            normalizedHash: "archive-hash",
            normalizedChars: 24,
            preview: "archive group",
          },
        ],
        affectedSourcePaths: ["memory/archive-keep.md", "memory/archive-remove.md"],
        affectedTaskLinkCount: 0,
        preview: "archive group",
        sourceIndexing: {
          reindexableSourcePathCount: 2,
          nonReindexableSourcePathCount: 0,
          allAffectedSourcePathsReindexable: true,
          anyAffectedSourcePathReindexable: true,
          scopes: ["state_memory_root"],
        },
      },
      {
        normalizedHash: "keep-hash",
        normalizedChars: 24,
        groupSize: 2,
        keep: {
          id: "keep-keep",
          sourcePath: "external/keep-keep.md",
          sourceType: "manual",
          visibility: "private",
          taskLinkCount: 0,
          normalizedHash: "keep-hash",
          normalizedChars: 24,
          preview: "keep group",
        },
        remove: [
          {
            id: "keep-remove",
            sourcePath: "external/keep-remove.md",
            sourceType: "manual",
            visibility: "private",
            taskLinkCount: 0,
            normalizedHash: "keep-hash",
            normalizedChars: 24,
            preview: "keep group",
          },
        ],
        affectedSourcePaths: ["external/keep-keep.md", "external/keep-remove.md"],
        affectedTaskLinkCount: 0,
        preview: "keep group",
        sourceIndexing: {
          reindexableSourcePathCount: 0,
          nonReindexableSourcePathCount: 2,
          allAffectedSourcePathsReindexable: false,
          anyAffectedSourcePathReindexable: false,
          scopes: ["external"],
        },
      },
    ],
  };
}

test("decorateMemoryExactDedupReportWithGovernance classifies duplicate groups into review keep and archive", () => {
  const report = decorateMemoryExactDedupReportWithGovernance(createGovernanceFixture(), {
    topGroupLimit: 3,
  });

  expect(report.governance).toMatchObject({
    groupCount: 3,
    suggestedReviewGroupCount: 1,
    suggestedKeepGroupCount: 1,
    suggestedArchiveGroupCount: 1,
  });
  expect(report.governance?.headline).toContain("review=1");
  expect(report.groups[0]?.governance).toMatchObject({
    suggestedAction: "review",
    riskLevel: "high",
    reviewRequired: true,
  });
  expect(report.groups[1]?.governance).toMatchObject({
    suggestedAction: "archive",
    riskLevel: "low",
    reviewRequired: false,
  });
  expect(report.groups[2]?.governance).toMatchObject({
    suggestedAction: "keep",
    riskLevel: "low",
    reviewRequired: false,
  });
  expect(report.governance?.topSuggestedGroups.map((group) => group.normalizedHash)).toEqual([
    "review-hash",
    "keep-hash",
    "archive-hash",
  ]);
});
