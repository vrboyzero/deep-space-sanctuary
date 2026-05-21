import { expect, test } from "vitest";

import { buildMemoryTreeLifecycleReport } from "./memory-tree-lifecycle-report.js";

test("buildMemoryTreeLifecycleReport summarizes dirty targets and cooldown states", () => {
  const report = buildMemoryTreeLifecycleReport({
    checkedAt: "2026-05-21T12:00:00.000Z",
    source: {
      kind: "source",
      dirty: true,
      reasons: ["memory_changed"],
      sourcePresent: false,
      currentMemorySeq: 4,
      lastMemorySeq: 0,
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
        currentMemorySeq: 4,
        currentTaskSeq: 3,
        lastMemorySeq: 4,
        lastTaskSeq: 3,
        lastRebuiltAt: "2026-05-21T11:50:00.000Z",
        governance: {
          failureCount: 0,
          cooldownActive: false,
        },
      },
      {
        kind: "profile",
        dirty: true,
        reasons: ["task_changed", "cooldown_active"],
        nodePresent: true,
        currentMemorySeq: 4,
        currentTaskSeq: 3,
        lastMemorySeq: 4,
        lastTaskSeq: 1,
        lastRebuiltAt: "2026-05-21T11:00:00.000Z",
        governance: {
          failureCount: 2,
          lastFailureAt: "2026-05-21T11:30:00.000Z",
          lastError: "profile rebuild failed",
          cooldownUntil: "2026-05-21T12:05:00.000Z",
          cooldownActive: true,
        },
      },
      {
        kind: "global",
        dirty: false,
        reasons: [],
        nodePresent: true,
        currentMemorySeq: 4,
        currentTaskSeq: 3,
        lastMemorySeq: 4,
        lastTaskSeq: 3,
        lastRebuiltAt: "2026-05-21T11:55:00.000Z",
        governance: {
          failureCount: 0,
          cooldownActive: false,
        },
      },
    ],
  });

  expect(report.summary).toMatchObject({
    targetCount: 4,
    dirtyTargetCount: 2,
    cleanTargetCount: 2,
    cooldownTargetCount: 1,
    failureCount: 2,
    sourceDirty: true,
    nodeDirtyCount: 1,
    latestFailureAt: "2026-05-21T11:30:00.000Z",
  });
  expect(report.headline).toContain("source");
  expect(report.headline).toContain("profile");
  expect(report.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "memory_tree_lifecycle",
      status: "warn",
    }),
    expect.objectContaining({
      id: "memory_tree_lifecycle_topic",
      status: "pass",
    }),
    expect.objectContaining({
      id: "memory_tree_lifecycle_profile",
      status: "warn",
      message: expect.stringContaining("cooldown until 2026-05-21T12:05:00.000Z"),
    }),
  ]));
});
