import { describe, expect, it } from "vitest";

import {
  createTaskProjectionCollectionSnapshot,
  readTaskProjectionCollectionSnapshot,
  type TaskProjectionCollectionSource,
} from "./task-projection-collection.js";
import type { TaskCapabilityClosure } from "./task-projection.js";
import { createGoalCodingRunView } from "./source-adapters.js";

const closure: TaskCapabilityClosure = {
  schemaVersion: "task-capability-closure/v1",
  evaluatedAtMs: 100,
  status: "satisfied",
  capabilities: Object.fromEntries([
    "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal", "trace", "verifier", "mcp", "plugin", "skill",
  ].map((name) => [name, { required: false, state: "degraded", reasonCode: "not_requested" }])) as TaskCapabilityClosure["capabilities"],
};

function source(taskId: string, sourceRevision: number): TaskProjectionCollectionSource {
  return {
    taskId,
    sourceRevision,
    view: createGoalCodingRunView({
      goal: { id: taskId, status: "ready", lastRunId: `${taskId}-run` },
    }),
    observedAtMs: 100,
    capabilityClosure: closure,
  };
}

describe("task projection collection", () => {
  it("creates a deterministic revision-bound snapshot and applies bounded reads", () => {
    const snapshot = createTaskProjectionCollectionSnapshot({
      epoch: "gateway-a",
      revision: 7,
      observedAtMs: 200,
      sources: [source("task-b", 7), source("task-a", 7)],
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "task-projection-collection/v1",
      epoch: "gateway-a",
      revision: 7,
      observedAtMs: 200,
      totalCount: 2,
    });
    expect(snapshot.items.map((item) => item.taskId)).toEqual(["task-a", "task-b"]);
    expect(readTaskProjectionCollectionSnapshot(snapshot, { limit: 1 })).toEqual({
      epoch: "gateway-a",
      revision: 7,
      totalCount: 2,
      items: [snapshot.items[0]],
      nextCursor: { epoch: "gateway-a", revision: 7, offset: 1 },
    });
  });

  it("rejects stale/future cursors and invalid limits without returning partial data", () => {
    const snapshot = createTaskProjectionCollectionSnapshot({
      epoch: "gateway-a",
      revision: 3,
      observedAtMs: 200,
      sources: [source("task-a", 3)],
    });

    expect(readTaskProjectionCollectionSnapshot(snapshot, { cursor: { epoch: "gateway-a", revision: 2, offset: 0 }, limit: 10 })).toEqual({
      ok: false,
      code: "cursor_stale",
    });
    expect(readTaskProjectionCollectionSnapshot(snapshot, { cursor: { epoch: "gateway-a", revision: 4, offset: 0 }, limit: 10 })).toEqual({
      ok: false,
      code: "cursor_future",
    });
    expect(readTaskProjectionCollectionSnapshot(snapshot, { cursor: { epoch: "gateway-a", revision: 3, offset: 2 }, limit: 10 })).toEqual({
      ok: false,
      code: "cursor_out_of_range",
    });
    expect(readTaskProjectionCollectionSnapshot(snapshot, { limit: 0 })).toEqual({
      ok: false,
      code: "invalid_limit",
    });
    expect(readTaskProjectionCollectionSnapshot(snapshot, { cursor: { epoch: "old-gateway", revision: 3, offset: 0 } })).toEqual({
      ok: false,
      code: "cursor_stale",
    });
  });

  it("fails closed when source evidence is older than the collection floor or ahead of its revision", () => {
    expect(() => createTaskProjectionCollectionSnapshot({
      epoch: "gateway-a",
      revision: 8,
      minimumSourceRevision: 8,
      observedAtMs: 200,
      sources: [source("task-stale", 7)],
    })).toThrow("stale source evidence");
    expect(() => createTaskProjectionCollectionSnapshot({
      epoch: "gateway-a",
      revision: 8,
      observedAtMs: 200,
      sources: [source("task-future", 9)],
    })).toThrow("future source evidence");
  });
});
