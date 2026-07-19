import { expect, test, vi } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { ConversationStore } from "@belldandy/agent";
import { CommunityChannel } from "./community.js";

test("Community messages hold shared room leases until each Agent run settles", async () => {
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
  const channel = new CommunityChannel({
    endpoint: "https://office.goddess.ai",
    agents: [],
    agent,
    conversationStore: new ConversationStore(),
    conversationLifecycle,
  } as any);
  const state = {
    ws: { send: vi.fn() },
    agentConfig: { name: "belldandy", apiKey: "gro_test_key" },
    roomId: "room-lifecycle",
    reconnectAttempts: 0,
    members: [],
  };

  const firstPending = (channel as any).handleChatMessage({
    id: "community-lifecycle-1",
    content: "first-pending",
    sender: { type: "user", id: "user-1", uid: "user-1", name: "Alice" },
  }, state);
  await waitFor(() => started.has("first-pending"));
  expect(activeLeaseCount).toBe(1);

  const secondPending = (channel as any).handleChatMessage({
    id: "community-lifecycle-2",
    content: "second-pending",
    sender: { type: "user", id: "user-2", uid: "user-2", name: "Bob" },
  }, state);
  await waitFor(() => started.has("second-pending"));
  expect(activeLeaseCount).toBe(2);

  gates.get("first-pending")?.();
  await firstPending;
  expect(activeLeaseCount).toBe(1);

  gates.get("second-pending")?.();
  await secondPending;
  expect(activeLeaseCount).toBe(0);
  expect(conversationLifecycle.acquire).toHaveBeenCalledTimes(2);
  expect(conversationLifecycle.acquire).toHaveBeenNthCalledWith(1, {
    conversationId: "community:room-lifecycle",
    agent,
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Community lifecycle fixture");
}
