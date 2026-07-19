import type { BelldandyAgent, ConversationStore } from "@belldandy/agent";
import type { ChannelConversationLifecycle } from "@belldandy/channels";

import type { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

export function createChannelConversationLifecycle(input: {
  lifecycle: TopLevelConversationLifecycle;
  conversationStore: ConversationStore;
}): ChannelConversationLifecycle {
  return {
    async acquire({ conversationId, agent }) {
      const lease = await input.lifecycle.acquire({
        conversationId,
        owners: [{
          key: input.conversationStore,
          priority: 100,
          release: () => input.conversationStore.releaseConversation(conversationId),
        }],
      });
      addAgentOwner(lease, agent, conversationId);
      return {
        release: () => lease.release(),
      };
    },
  };
}

function addAgentOwner(
  lease: Awaited<ReturnType<TopLevelConversationLifecycle["acquire"]>>,
  agent: BelldandyAgent,
  conversationId: string,
): void {
  if (typeof agent.releaseConversation !== "function") return;
  lease.addOwner({
    // Routed Channel Agent 可能逐消息创建，实例 key 可同时避免同一 adapter 重复登记。
    key: agent,
    priority: 0,
    release: () => agent.releaseConversation?.(conversationId),
  });
}
