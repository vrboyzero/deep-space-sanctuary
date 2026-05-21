import { expect, test } from "vitest";

import { buildMemoryTreeJobReport } from "./memory-tree-job-report.js";

test("buildMemoryTreeJobReport maps lifecycle states into unified job statuses", () => {
  const report = buildMemoryTreeJobReport({
    checkedAt: "2026-05-21T13:00:00.000Z",
    source: {
      kind: "source",
      dirty: true,
      reasons: ["memory_changed"],
      sourcePresent: true,
      currentMemorySeq: 6,
      lastMemorySeq: 4,
      lastRebuiltAt: "2026-05-21T12:00:00.000Z",
      governance: {
        failureCount: 0,
        cooldownActive: false,
      },
    },
    nodes: [
      {
        kind: "topic",
        dirty: false,
        reasons: [],
        nodePresent: true,
        currentMemorySeq: 6,
        currentTaskSeq: 3,
        lastMemorySeq: 6,
        lastTaskSeq: 3,
        lastRebuiltAt: "2026-05-21T12:10:00.000Z",
        governance: {
          failureCount: 0,
          cooldownActive: false,
        },
      },
      {
        kind: "profile",
        dirty: true,
        reasons: ["last_error", "cooldown_active"],
        nodePresent: true,
        currentMemorySeq: 6,
        currentTaskSeq: 3,
        lastMemorySeq: 5,
        lastTaskSeq: 2,
        lastRebuiltAt: "2026-05-21T11:00:00.000Z",
        governance: {
          failureCount: 2,
          lastFailureAt: "2026-05-21T12:30:00.000Z",
          lastError: "profile rebuild failed",
          cooldownUntil: "2026-05-21T13:10:00.000Z",
          cooldownActive: true,
        },
      },
      {
        kind: "global",
        dirty: true,
        reasons: ["last_error"],
        nodePresent: true,
        currentMemorySeq: 6,
        currentTaskSeq: 3,
        lastMemorySeq: 5,
        lastTaskSeq: 2,
        governance: {
          failureCount: 1,
          lastFailureAt: "2026-05-21T12:20:00.000Z",
          lastError: "global rebuild failed",
          cooldownActive: false,
        },
      },
    ],
    scoreLastRebuiltAt: undefined,
    latestDedupPreviewReport: null,
  });

  expect(report.summary).toMatchObject({
    visibleJobCount: 5,
    queuedCount: 2,
    completedCount: 1,
    failedCount: 1,
    cooldownCount: 1,
  });
  expect(report.jobs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      jobType: "source_rebuild",
      status: "queued",
    }),
    expect.objectContaining({
      jobType: "node_rebuild",
      targetKey: "topic",
      status: "completed",
    }),
    expect.objectContaining({
      jobType: "node_rebuild",
      targetKey: "profile",
      status: "cooldown",
    }),
    expect.objectContaining({
      jobType: "node_rebuild",
      targetKey: "global",
      status: "failed",
    }),
    expect.objectContaining({
      jobType: "score_rebuild",
      status: "queued",
    }),
  ]));
  expect(report.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "memory_tree_jobs",
      status: "warn",
      detail: expect.objectContaining({
        nextRetryJobKey: "node_rebuild:profile",
        nextRetryAt: "2026-05-21T13:10:00.000Z",
        nextRetryAfterMs: 600000,
      }),
    }),
  ]));
});

test("buildMemoryTreeJobReport merges persisted job ledger fields into the view", () => {
  const report = buildMemoryTreeJobReport({
    checkedAt: "2026-05-21T14:00:00.000Z",
    source: {
      kind: "source",
      dirty: false,
      reasons: [],
      sourcePresent: true,
      currentMemorySeq: 8,
      lastMemorySeq: 8,
      lastRebuiltAt: "2026-05-21T13:30:00.000Z",
      governance: {
        failureCount: 0,
        cooldownActive: false,
      },
    },
    nodes: [
      {
        kind: "profile",
        dirty: true,
        reasons: ["last_error", "cooldown_active"],
        nodePresent: true,
        currentMemorySeq: 8,
        currentTaskSeq: 4,
        lastMemorySeq: 7,
        lastTaskSeq: 3,
        lastRebuiltAt: "2026-05-21T13:59:00.000Z",
        governance: {
          failureCount: 1,
          lastFailureAt: "2026-05-21T13:59:30.000Z",
          lastError: "profile lifecycle failed",
          cooldownUntil: "2026-05-21T14:00:30.000Z",
          cooldownActive: true,
        },
      },
    ],
    scoreLastRebuiltAt: "2026-05-21T13:50:00.000Z",
    latestDedupPreviewReport: null,
    jobLedger: [
      {
        jobType: "source_rebuild",
        targetKey: "source",
        jobKey: "source_rebuild:source",
        status: "completed",
        lastRequestedAt: "2026-05-21T13:29:00.000Z",
        lastStartedAt: "2026-05-21T13:29:00.000Z",
        lastCompletedAt: "2026-05-21T13:30:00.000Z",
        lastSuccessAt: "2026-05-21T13:30:00.000Z",
        failureCount: 0,
        skipCount: 0,
        lastUpdatedAt: "2026-05-21T13:30:00.000Z",
        triggerSource: "memory.tree.source.rebuild",
      },
      {
        jobType: "score_rebuild",
        targetKey: "chunk_scores",
        jobKey: "score_rebuild:chunk_scores",
        status: "completed",
        lastRequestedAt: "2026-05-21T13:49:00.000Z",
        lastStartedAt: "2026-05-21T13:49:00.000Z",
        lastCompletedAt: "2026-05-21T13:50:00.000Z",
        lastSuccessAt: "2026-05-21T13:50:00.000Z",
        failureCount: 0,
        skipCount: 0,
        lastUpdatedAt: "2026-05-21T13:50:00.000Z",
        triggerSource: "memory.tree.score.rebuild",
      },
      {
        jobType: "node_rebuild",
        targetKey: "profile",
        jobKey: "node_rebuild:profile",
        status: "failed",
        lastRequestedAt: "2026-05-21T13:39:00.000Z",
        lastStartedAt: "2026-05-21T13:39:00.000Z",
        lastFailureAt: "2026-05-21T13:59:30.000Z",
        lastFailureError: "profile rebuild failed",
        failureCount: 1,
        skipCount: 2,
        lastSkippedAt: "2026-05-21T14:00:15.000Z",
        lastSkipReason: "cooldown_active",
        lastSkippedTriggerSource: "memory.tree.lifecycle.ensure",
        nextEligibleAt: "2026-05-21T14:00:30.000Z",
        retryAfterMs: 60000,
        lastUpdatedAt: "2026-05-21T14:00:15.000Z",
        triggerSource: "memory.tree.node.rebuild",
      },
    ],
  });

  expect(report.summary).toMatchObject({
    visibleJobCount: 3,
    queuedCount: 0,
    runningCount: 0,
    completedCount: 2,
    failedCount: 0,
    cooldownCount: 1,
    skippedCount: 2,
  });
  expect(report.headline).toContain("next retry in");
  expect(report.headline).toContain("node_rebuild:profile");
  expect(report.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "memory_tree_jobs",
      status: "warn",
      detail: expect.objectContaining({
        nextRetryJobKey: "node_rebuild:profile",
        nextRetryAt: "2026-05-21T14:00:30.000Z",
        nextRetryAfterMs: 30000,
      }),
    }),
  ]));
  expect(report.jobs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      jobKey: "source_rebuild:source",
      lastSuccessAt: "2026-05-21T13:30:00.000Z",
      lastRequestedAt: "2026-05-21T13:29:00.000Z",
      status: "completed",
    }),
    expect.objectContaining({
      jobKey: "score_rebuild:chunk_scores",
      lastSuccessAt: "2026-05-21T13:50:00.000Z",
      status: "completed",
    }),
      expect.objectContaining({
        jobKey: "node_rebuild:profile",
        status: "cooldown",
        lastFailureAt: "2026-05-21T13:59:30.000Z",
        lastFailureError: "profile rebuild failed",
        lastSkippedAt: "2026-05-21T14:00:15.000Z",
        lastSkipReason: "cooldown_active",
        nextEligibleAt: "2026-05-21T14:00:30.000Z",
        retryAfterMs: 60000,
        skipCount: 2,
      }),
  ]));
});

test("buildMemoryTreeJobReport surfaces dedup governance metadata for the latest preview report", () => {
  const report = buildMemoryTreeJobReport({
    checkedAt: "2026-05-21T15:00:00.000Z",
    source: {
      kind: "source",
      dirty: false,
      reasons: [],
      sourcePresent: true,
      currentMemorySeq: 9,
      lastMemorySeq: 9,
      lastRebuiltAt: "2026-05-21T14:30:00.000Z",
      governance: {
        failureCount: 0,
        cooldownActive: false,
      },
    },
    nodes: [],
    scoreLastRebuiltAt: "2026-05-21T14:45:00.000Z",
    latestDedupPreviewReport: {
      id: "report-dedup-preview",
      reportType: "dedup_preview",
      scope: "private",
      status: "ready",
      summary: {
        governance: {
          headline: "Memory dedup suggestions need review: review=1, keep=0, archive=2, groups=3.",
          groupCount: 3,
          suggestedReviewGroupCount: 1,
          suggestedKeepGroupCount: 0,
          suggestedArchiveGroupCount: 2,
          taskLinkedGroupCount: 1,
          mixedSourceGroupCount: 1,
          nonReindexableOnlyGroupCount: 0,
          topSuggestedGroups: [],
        },
      },
      details: {},
      createdAt: "2026-05-21T14:50:00.000Z",
      updatedAt: "2026-05-21T14:51:00.000Z",
    },
  });

  expect(report.jobs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      jobType: "dedup_preview",
      metadata: expect.objectContaining({
        governance: expect.objectContaining({
          suggestedReviewGroupCount: 1,
          suggestedArchiveGroupCount: 2,
        }),
      }),
    }),
  ]));
});
