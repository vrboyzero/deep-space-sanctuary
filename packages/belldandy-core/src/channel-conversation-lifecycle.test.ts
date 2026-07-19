import { expect, test, vi } from "vitest";

import { type BelldandyAgent, ConversationStore } from "@belldandy/agent";
import { createChannelConversationLifecycle } from "./channel-conversation-lifecycle.js";
import { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

test("Channel lifecycle bridge releases Agent before ConversationStore", async () => {
  const conversationId = "channel-community-lifecycle";
  const order: string[] = [];
  const lifecycle = new TopLevelConversationLifecycle({
    idleTtlMs: 60_000,
    maxIdleConversations: 0,
    startTimer: false,
  });
  const agent: BelldandyAgent = {
    async *run() {},
    releaseConversation: vi.fn(async () => {
      order.push("agent");
    }),
  };
  const conversationStore = new ConversationStore();
  const releaseStore = vi.spyOn(conversationStore, "releaseConversation").mockImplementation(async () => {
    order.push("store");
  });
  const bridge = createChannelConversationLifecycle({ lifecycle, conversationStore });

  const lease = await bridge.acquire({ conversationId, agent });
  expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeConversationCount: 1,
    activeLeaseCount: 1,
    retainedConversationCount: 1,
  });

  await lease.release();

  expect(agent.releaseConversation).toHaveBeenCalledWith(conversationId);
  expect(releaseStore).toHaveBeenCalledWith(conversationId);
  expect(order).toEqual(["agent", "store"]);
  expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeLeaseCount: 0,
    retainedConversationCount: 0,
    pendingReleaseCount: 0,
    evictedCount: 1,
    releaseFailureCount: 0,
  });
});
