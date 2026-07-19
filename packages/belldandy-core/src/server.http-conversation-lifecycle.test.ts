import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import { type BelldandyAgent, ConversationStore } from "@belldandy/agent";
import { startGatewayServer } from "./server.js";
import { resolveWebRoot, waitFor, withEnv } from "./server-testkit.js";
import { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

test("community and webhook requests share the top-level conversation lifecycle", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-lifecycle-token",
  }, async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-http-lifecycle-"));
    const conversationId = "conversation-http-lifecycle";
    const order: string[] = [];
    const started = new Set<string>();
    const gates = new Map<string, () => void>();
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
      releaseConversation: vi.fn(async () => {
        order.push("agent");
      }),
    };
    const conversationStore = new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
    });
    const releaseStoreOriginal = conversationStore.releaseConversation.bind(conversationStore);
    const releaseStore = vi.spyOn(conversationStore, "releaseConversation").mockImplementation(async (id) => {
      order.push("store");
      await releaseStoreOriginal(id);
    });
    const lifecycle = new TopLevelConversationLifecycle({
      idleTtlMs: 60_000,
      maxIdleConversations: 0,
      startTimer: false,
    });
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
      agentFactory: () => agent,
      topLevelConversationLifecycle: lifecycle,
      webhookConfig: {
        version: 1,
        webhooks: [{
          id: "lifecycle",
          enabled: true,
          token: "webhook-lifecycle-token",
        }],
      },
    });

    try {
      const communityResponsePending = fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-lifecycle-token",
        },
        body: JSON.stringify({
          text: "community-pending",
          conversationId,
        }),
      });
      await waitFor(() => started.has("community-pending"));
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 1,
        activeLeaseCount: 1,
        retainedConversationCount: 1,
      });

      const webhookResponsePending = fetch(`http://127.0.0.1:${server.port}/api/webhook/lifecycle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer webhook-lifecycle-token",
        },
        body: JSON.stringify({
          text: "webhook-pending",
          conversationId,
        }),
      });
      await waitFor(() => started.has("webhook-pending"));
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 1,
        activeLeaseCount: 2,
        retainedConversationCount: 1,
      });

      gates.get("community-pending")?.();
      const communityResponse = await communityResponsePending;
      expect(communityResponse.status).toBe(200);
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 1,
        activeLeaseCount: 1,
        retainedConversationCount: 1,
      });
      expect(agent.releaseConversation).not.toHaveBeenCalled();
      expect(releaseStore).not.toHaveBeenCalled();

      gates.get("webhook-pending")?.();
      const webhookResponse = await webhookResponsePending;
      expect(webhookResponse.status).toBe(200);
      await waitFor(() => releaseStore.mock.calls.length === 1);

      expect(agent.releaseConversation).toHaveBeenCalledWith(conversationId);
      expect(releaseStore).toHaveBeenCalledWith(conversationId);
      expect(order).toEqual(["agent", "store"]);
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 0,
        activeLeaseCount: 0,
        idleConversationCount: 0,
        retainedConversationCount: 0,
        pendingReleaseCount: 0,
        evictedCount: 1,
        releaseFailureCount: 0,
      });
    } finally {
      gates.get("community-pending")?.();
      gates.get("webhook-pending")?.();
      await server.close();
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
