import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeSubTaskRetentionPolicy,
  resolveOwnedSubTaskOutputDirectory,
  selectSubTaskRetentionCandidates,
} from "./subtask-runtime-retention.js";

describe("selectSubTaskRetentionCandidates", () => {
  it("only selects ordinary terminal records without claims or handoffs", () => {
    const selection = selectSubTaskRetentionCandidates([
      { id: "task_plain", status: "done", createdAt: 100, finishedAt: 200 },
      { id: "task_active", status: "running", createdAt: 100 },
      {
        id: "task_claimed",
        status: "error",
        createdAt: 100,
        finishedAt: 200,
        activeCommandClaim: { kind: "stop" },
      },
      {
        id: "task_handoff",
        status: "stopped",
        createdAt: 100,
        finishedAt: 200,
        takeover: [{ status: "accepted" }],
      },
      {
        id: "task_goal",
        status: "timeout",
        createdAt: 100,
        finishedAt: 200,
        launchSpec: { delegation: { goalId: "goal-main" } },
      },
      { id: "task_external_goal", status: "done", createdAt: 100, finishedAt: 200 },
    ], {
      maxTerminalRecords: 0,
      minTerminalAgeMs: 0,
    }, 1_000, {
      goalBoundTaskIds: new Set(["task_external_goal"]),
    });

    expect(selection.eligibleTaskIds).toEqual(["task_plain"]);
    expect(selection.protectedCount).toBe(5);
  });

  it("keeps the newest terminal records and applies a minimum age", () => {
    const selection = selectSubTaskRetentionCandidates([
      { id: "task_newest", status: "done", createdAt: 100, finishedAt: 900 },
      { id: "task_too_young", status: "error", createdAt: 100, finishedAt: 700 },
      { id: "task_old", status: "stopped", createdAt: 100, finishedAt: 100 },
    ], {
      maxTerminalRecords: 1,
      minTerminalAgeMs: 500,
    }, 1_000);

    expect(selection.eligibleTaskIds).toEqual(["task_old"]);
    expect(selection.protectedCount).toBe(2);
  });
});

describe("subtask retention policy and cleanup path", () => {
  it("defaults to manual compaction with bounded retention", () => {
    expect(normalizeSubTaskRetentionPolicy()).toEqual({
      autoCompact: false,
      maxTerminalRecords: 500,
      minTerminalAgeMs: 30 * 24 * 60 * 60 * 1_000,
    });
  });

  it("only resolves safe task ids directly below the owned outputs directory", () => {
    const outputsDir = path.join("state", "subtasks", "outputs");
    expect(resolveOwnedSubTaskOutputDirectory(outputsDir, "task_abcd-1234"))
      .toBe(path.resolve(outputsDir, "task_abcd-1234"));
    expect(() => resolveOwnedSubTaskOutputDirectory(outputsDir, "../workspace"))
      .toThrow("task id is not safe for output cleanup");
    expect(() => resolveOwnedSubTaskOutputDirectory(outputsDir, "goal_1234"))
      .toThrow("task id is not safe for output cleanup");
  });
});
