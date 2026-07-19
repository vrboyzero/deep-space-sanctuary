import { describe, expect, it, vi } from "vitest";

import { ToolAuditDispatcher } from "./tool-audit-dispatcher.js";
import type { ToolAuditLog } from "./types.js";

function createAuditLog(toolName: string): ToolAuditLog {
  return {
    timestamp: "2026-07-17T00:00:00.000Z",
    conversationId: "conv-audit",
    toolName,
    arguments: {},
    success: true,
    output: "ok",
    durationMs: 1,
  };
}

describe("ToolAuditDispatcher", () => {
  it("异步投递审计事件，不在 enqueue 调用栈执行 sink", async () => {
    let enqueueReturned = false;
    const sink = vi.fn(() => {
      expect(enqueueReturned).toBe(true);
    });
    const dispatcher = new ToolAuditDispatcher(sink);

    expect(dispatcher.enqueue(createAuditLog("echo"))).toBe(true);
    expect(sink).not.toHaveBeenCalled();
    enqueueReturned = true;

    await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(1));
    expect(dispatcher.getSnapshot()).toMatchObject({
      queuedCount: 0,
      dispatchedCount: 1,
      failedCount: 0,
      droppedCount: 0,
    });
  });

  it("挂起 sink 时保持有界队列并丢弃超额事件", async () => {
    let releaseFirst: (() => void) | undefined;
    let signalFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const sink = vi.fn(async (log: ToolAuditLog) => {
      if (log.toolName !== "first") return;
      signalFirstStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    const dispatcher = new ToolAuditDispatcher(sink, { maxQueueSize: 2 });

    expect(dispatcher.enqueue(createAuditLog("first"))).toBe(true);
    await firstStarted;
    expect(dispatcher.enqueue(createAuditLog("second"))).toBe(true);
    expect(dispatcher.enqueue(createAuditLog("third"))).toBe(true);
    expect(dispatcher.enqueue(createAuditLog("dropped"))).toBe(false);
    expect(dispatcher.getSnapshot()).toMatchObject({
      active: true,
      queuedCount: 2,
      maxQueueSize: 2,
      droppedCount: 1,
    });

    releaseFirst?.();
    await vi.waitFor(() => expect(dispatcher.getSnapshot().dispatchedCount).toBe(3));
    expect(sink.mock.calls.map(([log]) => (log as ToolAuditLog).toolName)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("sink 失败只计入诊断并继续投递后续事件", async () => {
    const sink = vi.fn(async (log: ToolAuditLog) => {
      if (log.toolName === "broken") {
        throw new Error("audit sink unavailable");
      }
    });
    const dispatcher = new ToolAuditDispatcher(sink);

    dispatcher.enqueue(createAuditLog("broken"));
    dispatcher.enqueue(createAuditLog("healthy"));

    await vi.waitFor(() => expect(dispatcher.getSnapshot().dispatchedCount).toBe(1));
    expect(dispatcher.getSnapshot()).toMatchObject({
      queuedCount: 0,
      failedCount: 1,
      dispatchedCount: 1,
    });
    expect(sink.mock.calls.map(([log]) => (log as ToolAuditLog).toolName)).toEqual([
      "broken",
      "healthy",
    ]);
  });
});
