import { expect, test, vi } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { ConversationStore } from "@belldandy/agent";
import { FeishuChannel } from "./feishu.js";

test("Feishu messages hold shared chat leases through persistence and reply settlement", async () => {
  const started = new Set<string>();
  const gates = new Map<string, () => void>();
  let activeLeaseCount = 0;
  const waitForGate = (text: string) => new Promise<void>((resolve) => {
    gates.set(text, resolve);
  });
  const agent: BelldandyAgent = {
    async *run(input) {
      const runPending = waitForGate(input.text);
      started.add(input.text);
      yield { type: "status", status: "running" };
      await runPending;
      yield { type: "final", text: `echo:${input.text}` };
      yield { type: "status", status: "done" };
    },
  };
  const conversationLifecycle = {
    acquire: vi.fn(async () => {
      activeLeaseCount += 1;
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          activeLeaseCount -= 1;
        },
      };
    }),
  };
  const conversationStore = new ConversationStore();
  const writeLeaseCounts: number[] = [];
  const addMessageOriginal = conversationStore.addMessage.bind(conversationStore);
  vi.spyOn(conversationStore, "addMessage").mockImplementation((...args) => {
    writeLeaseCounts.push(activeLeaseCount);
    return addMessageOriginal(...args);
  });
  const channel = new FeishuChannel({
    appId: "app-id",
    appSecret: "app-secret",
    agent,
    conversationStore,
    conversationLifecycle,
  } as any);
  vi.spyOn(channel as any, "reply").mockResolvedValue(true);

  const firstPending = (channel as any).handleMessage(createEvent("feishu-lifecycle-1", "first-pending"));
  await waitFor(() => started.has("first-pending"));
  expect(activeLeaseCount).toBe(1);

  const secondPending = (channel as any).handleMessage(createEvent("feishu-lifecycle-2", "second-pending"));
  await waitFor(() => started.has("second-pending"));
  expect(activeLeaseCount).toBe(2);

  gates.get("first-pending")?.();
  await firstPending;
  expect(activeLeaseCount).toBe(1);

  gates.get("second-pending")?.();
  await secondPending;
  expect(activeLeaseCount).toBe(0);
  expect(writeLeaseCounts).toHaveLength(4);
  expect(writeLeaseCounts.every((count) => count >= 1)).toBe(true);
  expect(conversationLifecycle.acquire).toHaveBeenCalledTimes(2);
  expect(conversationLifecycle.acquire).toHaveBeenNthCalledWith(1, {
    conversationId: "chat-lifecycle",
    agent,
  });
});

function createEvent(messageId: string, text: string) {
  return {
    message: {
      chat_id: "chat-lifecycle",
      message_id: messageId,
      message_type: "text",
      chat_type: "p2p",
      content: JSON.stringify({ text }),
    },
    sender: {
      sender_id: {
        open_id: "user-open-lifecycle",
        user_id: "user-lifecycle",
      },
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Feishu lifecycle fixture");
}
