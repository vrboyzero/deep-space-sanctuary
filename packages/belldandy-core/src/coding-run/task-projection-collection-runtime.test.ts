import { describe, expect, it } from "vitest";

import { TaskProjectionCollectionRuntime } from "./task-projection-collection-runtime.js";
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

function source(status: "ready" | "completed" = "ready") {
  return {
    taskId: "goal-1",
    view: createGoalCodingRunView({ goal: { id: "goal-1", status, lastRunId: "run-1" } }),
    observedAtMs: 100,
    capabilityClosure: closure,
  };
}

describe("TaskProjectionCollectionRuntime", () => {
  it("keeps revision stable for identical owner evidence and increments only on change", () => {
    const runtime = new TaskProjectionCollectionRuntime({ epoch: "gateway-a" });
    const first = runtime.refresh({ observedAtMs: 100, sources: [source()] });
    const same = runtime.refresh({ observedAtMs: 200, sources: [source()] });
    const changed = runtime.refresh({ observedAtMs: 300, sources: [source("completed")] });

    expect(first.revision).toBe(1);
    expect(same).toBe(first);
    expect(changed.revision).toBe(2);
  });

  it("ignores supporting evidence observation time but revisions a real evidence state change", () => {
    const runtime = new TaskProjectionCollectionRuntime({ epoch: "gateway-a" });
    const withJournal = (status: "pending" | "uncertain", observedAtMs: number) => ({
      ...source(),
      supportingEvidence: { journal: { status, observedAtMs } },
    });

    const first = runtime.refresh({ observedAtMs: 100, sources: [withJournal("pending", 100)] });
    const same = runtime.refresh({ observedAtMs: 200, sources: [withJournal("pending", 200)] });
    const changed = runtime.refresh({ observedAtMs: 300, sources: [withJournal("uncertain", 300)] });

    expect(same).toBe(first);
    expect(changed.revision).toBe(2);
  });

  it("revisions worktree lifecycle decisions while ignoring their observation time", () => {
    const runtime = new TaskProjectionCollectionRuntime({ epoch: "gateway-worktree" });
    const withWorktree = (
      lifecycle: "kept" | "discard_pending" | "discarded",
      observedAtMs: number,
    ) => ({
      ...source(),
      supportingEvidence: {
        worktree: {
          status: lifecycle === "kept" ? "ready" as const : lifecycle === "discarded" ? "missing" as const : "uncertain" as const,
          lifecycle,
          observedAtMs,
        },
      },
    });

    const kept = runtime.refresh({ observedAtMs: 100, sources: [withWorktree("kept", 100)] });
    const same = runtime.refresh({ observedAtMs: 200, sources: [withWorktree("kept", 200)] });
    const pending = runtime.refresh({ observedAtMs: 300, sources: [withWorktree("discard_pending", 300)] });
    const discarded = runtime.refresh({ observedAtMs: 400, sources: [withWorktree("discarded", 400)] });

    expect(same).toBe(kept);
    expect(pending.revision).toBe(2);
    expect(discarded.revision).toBe(3);
  });

  it("rejects a cursor from another Gateway epoch", () => {
    const runtime = new TaskProjectionCollectionRuntime({ epoch: "gateway-b" });
    runtime.refresh({ observedAtMs: 100, sources: [source()] });
    expect(runtime.read({ cursor: { epoch: "gateway-a", revision: 1, offset: 0 } })).toEqual({
      ok: false,
      code: "cursor_stale",
    });
  });
});
