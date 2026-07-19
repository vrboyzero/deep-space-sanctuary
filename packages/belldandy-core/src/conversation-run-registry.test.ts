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
});
