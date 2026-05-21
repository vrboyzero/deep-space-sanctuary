import { expect, test } from "vitest";

import {
  buildMemorySourceInventoryDoctorReport,
  buildMemorySourceInventoryGovernanceSummary,
} from "./memory-source-inventory-governance.js";
import type { MemorySourceInventoryReport } from "./memory-source-inventory.js";

function createInventoryReportFixture(): MemorySourceInventoryReport {
  return {
    version: "p10-source-registry-family-v1",
    generatedAt: "2026-05-21T12:00:00.000Z",
    stateDir: "E:/state",
    totals: {
      sourceKinds: 3,
      presentSourceKinds: 3,
      declaredSourceKinds: 0,
      missingSourceKinds: 0,
      fileCount: 3,
      rowCount: 1,
      totalBytes: 2048,
      indexedFiles: 2,
      indexedChunks: 7,
      sourceFamilyCount: 2,
      multiMemberFamilyCount: 1,
      highRiskFamilyCount: 1,
      byClass: {
        raw: 1,
        derived: 1,
        curated: 1,
      },
      byScope: {
        private: 3,
        shared: 0,
        team: 0,
      },
      bySearchPolicy: {
        searchable: 2,
        "summary-input-only": 1,
        "inventory-only": 0,
      },
    },
    items: [],
    families: [
      {
        sourceFamilyKey: "session:e:/state/sessions/conv-1",
        memberCount: 2,
        presentMemberCount: 2,
        sourceKinds: ["session_messages", "session_digest"],
        sourceClasses: ["raw", "derived"],
        searchPolicies: ["searchable", "summary-input-only"],
        duplicateRisk: {
          level: "high",
          rationale: "Session digest overlaps with raw conversation chunks.",
        },
        members: [
          {
            id: "builtin:sessions:messages",
            label: "Session Messages",
            sourceKind: "session_messages",
            sourceClass: "raw",
            storage: "filesystem",
            status: "present",
            searchPolicy: "searchable",
          },
          {
            id: "builtin:sessions:digest",
            label: "Session Digest",
            sourceKind: "session_digest",
            sourceClass: "derived",
            storage: "filesystem",
            status: "present",
            searchPolicy: "summary-input-only",
          },
        ],
      },
      {
        sourceFamilyKey: "memory:e:/state/memory/core",
        memberCount: 1,
        presentMemberCount: 1,
        sourceKinds: ["memory_core_note"],
        sourceClasses: ["curated"],
        searchPolicies: ["searchable"],
        duplicateRisk: {
          level: "low",
          rationale: "Curated note stands alone.",
        },
        members: [
          {
            id: "builtin:memory:core-note",
            label: "Core MEMORY.md",
            sourceKind: "memory_core_note",
            sourceClass: "curated",
            storage: "filesystem",
            status: "present",
            searchPolicy: "searchable",
          },
        ],
      },
    ],
  };
}

test("buildMemorySourceInventoryGovernanceSummary highlights high risk families", () => {
  const summary = buildMemorySourceInventoryGovernanceSummary(createInventoryReportFixture());

  expect(summary).toMatchObject({
    sourceKinds: 3,
    presentSourceKinds: 3,
    sourceFamilyCount: 2,
    multiMemberFamilyCount: 1,
    highRiskFamilyCount: 1,
    suggestedReviewFamilyCount: 1,
    suggestedKeepFamilyCount: 0,
    suggestedArchiveFamilyCount: 0,
    sourceDuplicateFamilyCount: 0,
    derivedOverlapFamilyCount: 1,
    searchableItemCount: 2,
    summaryInputOnlyItemCount: 1,
    inventoryOnlyItemCount: 0,
  });
  expect(summary.searchPolicyExplanations).toEqual([
    expect.objectContaining({
      searchPolicy: "searchable",
      whyThisBucket: expect.any(String),
    }),
    expect.objectContaining({
      searchPolicy: "summary-input-only",
      whyThisBucket: expect.any(String),
    }),
    expect.objectContaining({
      searchPolicy: "inventory-only",
      whyThisBucket: expect.any(String),
    }),
  ]);
  expect(summary.topHighRiskFamilies).toEqual([
    expect.objectContaining({
      sourceFamilyKey: "session:e:/state/sessions/conv-1",
      memberCount: 2,
      presentMemberCount: 2,
      sourceClasses: ["raw", "derived"],
      searchPolicies: ["searchable", "summary-input-only"],
      duplicateRiskLevel: "high",
    }),
  ]);
  expect(summary.topSuggestedFamilies).toEqual([
    expect.objectContaining({
      sourceFamilyKey: "session:e:/state/sessions/conv-1",
      category: "derived_overlap",
      suggestedAction: "review",
      reviewRequired: true,
      searchableMemberCount: 1,
      summaryInputOnlyMemberCount: 1,
      signals: expect.arrayContaining(["mixed_source_classes", "summary_overlay"]),
    }),
  ]);
});

test("buildMemorySourceInventoryDoctorReport emits a governance check with top family detail", () => {
  const doctor = buildMemorySourceInventoryDoctorReport(createInventoryReportFixture());

  expect(doctor.headline).toContain("Memory source families need review");
  expect(doctor.checks).toEqual([
    expect.objectContaining({
      id: "memory_source_inventory",
      status: "warn",
      detail: expect.objectContaining({
        sourceFamilyCount: 2,
        highRiskFamilyCount: 1,
        suggestedReviewFamilyCount: 1,
        searchPolicyExplanations: expect.arrayContaining([
          expect.objectContaining({
            searchPolicy: "searchable",
          }),
        ]),
        topHighRiskFamilies: [
          expect.objectContaining({
            sourceFamilyKey: "session:e:/state/sessions/conv-1",
          }),
        ],
        topSuggestedFamilies: [
          expect.objectContaining({
            sourceFamilyKey: "session:e:/state/sessions/conv-1",
            suggestedAction: "review",
          }),
        ],
      }),
    }),
  ]);
});
