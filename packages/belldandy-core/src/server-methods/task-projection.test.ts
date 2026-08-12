import { describe, expect, it, vi } from "vitest";

import { TaskProjectionCollectionRuntime } from "../coding-run/task-projection-collection-runtime.js";
import { handleTaskProjectionMethod } from "./task-projection.js";

describe("task.projection.list", () => {
  it("returns a bounded read-only page and keeps owner failure out of the response", async () => {
    const response = await handleTaskProjectionMethod({
      type: "req",
      id: "projection-1",
      method: "task.projection.list",
      params: { limit: 10 },
    }, {
      collectionRuntime: new TaskProjectionCollectionRuntime({ epoch: "gateway-test" }),
      now: () => 100,
      goalManager: { listGoals: vi.fn(async () => []) },
    });

    expect(response).toMatchObject({
      type: "res",
      id: "projection-1",
      ok: true,
      payload: {
        epoch: "gateway-test",
        revision: 1,
        totalCount: 0,
        items: [],
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/prompt|toolArgs|private|Error/);
  });

  it("rejects malformed params and stale cursors without partial replay", async () => {
    const runtime = new TaskProjectionCollectionRuntime({ epoch: "gateway-test" });
    const context = { collectionRuntime: runtime, now: () => 100 };
    const malformed = await handleTaskProjectionMethod({
      type: "req", id: "bad", method: "task.projection.list", params: { prompt: "secret" },
    }, context);
    expect(malformed).toMatchObject({ ok: false, error: { code: "invalid_params" } });

    await handleTaskProjectionMethod({ type: "req", id: "seed", method: "task.projection.list", params: {} }, context);
    const stale = await handleTaskProjectionMethod({
      type: "req", id: "stale", method: "task.projection.list", params: { cursor: { epoch: "old", revision: 1, offset: 0 } },
    }, context);
    expect(stale).toMatchObject({ ok: false, error: { code: "cursor_stale" } });
  });

  it("rejects a cursor after a Gateway restart creates a new collection epoch", async () => {
    const firstRuntime = new TaskProjectionCollectionRuntime({ epoch: "gateway-before-restart" });
    const first = await handleTaskProjectionMethod({
      type: "req", id: "before", method: "task.projection.list", params: {},
    }, { collectionRuntime: firstRuntime, now: () => 100 });
    const payload = first.ok && first.type === "res" && first.payload && typeof first.payload === "object"
      ? first.payload as { epoch?: unknown; revision?: unknown; nextCursor?: unknown }
      : undefined;
    const oldCursor = {
      epoch: payload?.epoch,
      revision: payload?.revision,
      offset: 0,
    };

    const afterRestart = await handleTaskProjectionMethod({
      type: "req", id: "after", method: "task.projection.list", params: { cursor: oldCursor },
    }, { collectionRuntime: new TaskProjectionCollectionRuntime({ epoch: "gateway-after-restart" }), now: () => 200 });

    expect(afterRestart).toMatchObject({ ok: false, error: { code: "cursor_stale" } });
  });
});
