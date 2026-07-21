import { describe, expect, it, vi } from "vitest";

import { ConversationRunRegistry } from "./conversation-run-registry.js";

describe("ConversationRunRegistry runtime snapshot", () => {
  it("counts running and stop-requested handles without returning run identities", () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    });
    registry.register({
      conversationId: "conversation-b",
      runId: "run-b",
      startedAt: 2,
      state: "stop_requested",
      stop: vi.fn(() => true),
    });
    registry.register({
      conversationId: "conversation-c",
      runId: "run-c",
      startedAt: 3,
      state: "stopped",
      stop: vi.fn(() => true),
    });

    expect(registry.getRuntimeSnapshot()).toEqual({
      activeCount: 2,
      stopRequestedCount: 1,
    });

    registry.clear("conversation-a", "run-a");
    registry.clear("conversation-b", "run-b");
    expect(registry.getRuntimeSnapshot()).toEqual({
      activeCount: 0,
      stopRequestedCount: 0,
    });
  });

  it("stops accepting late runs and requests every active run to stop", async () => {
    const registry = new ConversationRunRegistry();
    const firstStop = vi.fn(async () => true);
    const secondStop = vi.fn(async () => {
      throw new Error("stop failed");
    });
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: firstStop,
    });
    registry.register({
      conversationId: "conversation-b",
      runId: "run-b",
      startedAt: 2,
      state: "running",
      stop: secondStop,
    });

    registry.stopAccepting();

    await expect(registry.requestStopAll("gateway_shutdown")).rejects.toThrow(
      "Failed to stop 1 of 2 active conversation runs.",
    );
    expect(firstStop).toHaveBeenCalledWith("gateway_shutdown");
    expect(secondStop).toHaveBeenCalledWith("gateway_shutdown");
    expect(registry.getRuntimeSnapshot()).toEqual({
      activeCount: 2,
      stopRequestedCount: 2,
    });
    expect(() => registry.register({
      conversationId: "conversation-c",
      runId: "run-c",
      startedAt: 3,
      state: "running",
      stop: vi.fn(() => true),
    })).toThrow("Conversation run registry is not accepting new runs.");
  });

  it("waits for active runs to settle and supports bounded drain cancellation", async () => {
    const registry = new ConversationRunRegistry();
    registry.register({
      conversationId: "conversation-a",
      runId: "run-a",
      startedAt: 1,
      state: "running",
      stop: vi.fn(() => true),
    });
    let settled = false;
    const drain = registry.waitForIdle().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    registry.markStopped("conversation-a", "run-a", "gateway_shutdown");
    await drain;
    expect(settled).toBe(true);

    const blockedRegistry = new ConversationRunRegistry();
    blockedRegistry.register({
      conversationId: "conversation-b",
      runId: "run-b",
      startedAt: 2,
      state: "running",
      stop: vi.fn(() => true),
    });
    const controller = new AbortController();
    const blockedDrain = blockedRegistry.waitForIdle(controller.signal);
    controller.abort(new Error("deadline"));
    await expect(blockedDrain).rejects.toThrow("deadline");
  });
});
