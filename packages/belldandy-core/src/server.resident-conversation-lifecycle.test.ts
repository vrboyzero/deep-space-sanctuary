import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import { type BelldandyAgent, ConversationStore } from "@belldandy/agent";
import { startGatewayServer } from "./server.js";
import { resolveWebRoot, waitFor, withEnv } from "./server-testkit.js";
import { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

test("resident auto-run shares active conversation leases with HTTP", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "resident-lifecycle-token",
  }, async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-resident-lifecycle-"));
    const conversationId = "agent:default:main";
    const order: string[] = [];
    const started = new Set<string>();
    const gates = new Map<string, () => void>();
    const lifecycle = new TopLevelConversationLifecycle({
      idleTtlMs: 60_000,
      maxIdleConversations: 0,
      startTimer: false,
    });
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
    const writeLeaseCounts: number[] = [];
    const addMessageOriginal = conversationStore.addMessage.bind(conversationStore);
    vi.spyOn(conversationStore, "addMessage").mockImplementation((...args) => {
      writeLeaseCounts.push(lifecycle.getRuntimeSnapshot().activeLeaseCount);
      return addMessageOriginal(...args);
    });
    const releaseStoreOriginal = conversationStore.releaseConversation.bind(conversationStore);
    const releaseStore = vi.spyOn(conversationStore, "releaseConversation").mockImplementation(async (id) => {
      order.push("store");
      await releaseStoreOriginal(id);
    });
    const agentFactory = () => agent;
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
      agentFactory,
      topLevelConversationLifecycle: lifecycle,
    });

    try {
      const residentRunPending = server.autoRunResidentAgent({
        conversationId,
        text: "resident-pending",
        visibleReminder: "resident-reminder",
      });
      await waitFor(() => started.has("resident-pending"));
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 1,
        activeLeaseCount: 1,
        retainedConversationCount: 1,
      });
      expect(writeLeaseCounts.length).toBeGreaterThan(0);
      expect(writeLeaseCounts.every((count) => count >= 1)).toBe(true);

      const communityResponsePending = fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer resident-lifecycle-token",
        },
        body: JSON.stringify({
          text: "community-pending",
          conversationId,
        }),
      });
      await waitFor(() => started.has("community-pending"));
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 1,
        activeLeaseCount: 2,
        retainedConversationCount: 1,
      });

      gates.get("resident-pending")?.();
      await residentRunPending;
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 1,
        activeLeaseCount: 1,
        retainedConversationCount: 1,
      });
      expect(agent.releaseConversation).not.toHaveBeenCalled();
      expect(releaseStore).not.toHaveBeenCalled();

      gates.get("community-pending")?.();
      const communityResponse = await communityResponsePending;
      expect(communityResponse.status).toBe(200);
      await waitFor(() => releaseStore.mock.calls.length === 1);

      expect(agent.releaseConversation).toHaveBeenCalledWith(conversationId);
      expect(releaseStore).toHaveBeenCalledWith(conversationId);
      expect(order).toEqual(["agent", "store"]);
      expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
        activeConversationCount: 0,
        activeLeaseCount: 0,
        retainedConversationCount: 0,
        pendingReleaseCount: 0,
        evictedCount: 1,
        releaseFailureCount: 0,
      });
    } finally {
      gates.get("resident-pending")?.();
      gates.get("community-pending")?.();
      await server.close();
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("resident reminder-only runs hold a Store lease without creating an Agent owner", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-resident-reminder-lifecycle-"));
  const conversationId = "agent:default:main";
  const lifecycle = new TopLevelConversationLifecycle({
    idleTtlMs: 60_000,
    maxIdleConversations: 0,
    startTimer: false,
  });
  const agent: BelldandyAgent = {
    run: vi.fn(async function* () {
      yield { type: "final" as const, text: "unexpected" };
    }),
    releaseConversation: vi.fn(),
  };
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const writeLeaseCounts: number[] = [];
  const addMessageOriginal = conversationStore.addMessage.bind(conversationStore);
  vi.spyOn(conversationStore, "addMessage").mockImplementation((...args) => {
    writeLeaseCounts.push(lifecycle.getRuntimeSnapshot().activeLeaseCount);
    return addMessageOriginal(...args);
  });
  const releaseStoreOriginal = conversationStore.releaseConversation.bind(conversationStore);
  const releaseStore = vi.spyOn(conversationStore, "releaseConversation").mockImplementation(async (id) => {
    await releaseStoreOriginal(id);
  });
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => agent,
    topLevelConversationLifecycle: lifecycle,
  });

  try {
    const result = await server.autoRunResidentAgent({
      conversationId,
      text: "should-not-run",
      visibleReminder: "reminder-only",
      skipRun: true,
    });

    expect(result).toEqual({ conversationId, runId: "" });
    expect(agent.run).not.toHaveBeenCalled();
    expect(agent.releaseConversation).not.toHaveBeenCalled();
    expect(writeLeaseCounts).toEqual([1]);
    expect(releaseStore).toHaveBeenCalledWith(conversationId);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      activeLeaseCount: 0,
      retainedConversationCount: 0,
      pendingReleaseCount: 0,
      evictedCount: 1,
    });
  } finally {
    await server.close();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
