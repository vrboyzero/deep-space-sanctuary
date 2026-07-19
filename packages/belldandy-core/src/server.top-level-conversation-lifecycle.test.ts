import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";
import WebSocket from "ws";

import { type BelldandyAgent, ConversationStore } from "@belldandy/agent";
import { startGatewayServer } from "./server.js";
import { pairWebSocketClient, resolveWebRoot, waitFor } from "./server-testkit.js";
import { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

test("message.send holds the top-level lease through background finalization before releasing runtime state", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-top-level-lifecycle-"));
  const conversationId = "conversation-top-level-lifecycle";
  const order: string[] = [];
  let finishRun: (() => void) | undefined;
  const runPending = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  const releaseAgent = vi.fn(async () => {
    order.push("agent");
  });
  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "status", status: "running" };
      await runPending;
      yield { type: "final", text: `echo:${input.text}` };
      yield { type: "status", status: "done" };
    },
    releaseConversation: releaseAgent,
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
  });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closePending = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;
    ws.send(JSON.stringify({
      type: "req",
      id: "message-send-top-level-lifecycle",
      method: "message.send",
      params: {
        conversationId,
        text: "keep active until final",
      },
    }));

    await waitFor(() => frames.some((frame) => (
      frame.type === "res"
      && frame.id === "message-send-top-level-lifecycle"
      && frame.ok === true
    )));
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      activeConversationCount: 1,
      activeLeaseCount: 1,
      retainedConversationCount: 1,
      evictedCount: 0,
    });
    expect(releaseAgent).not.toHaveBeenCalled();
    expect(releaseStore).not.toHaveBeenCalled();

    finishRun?.();
    await waitFor(() => frames.some((frame) => (
      frame.type === "event"
      && frame.event === "chat.final"
      && frame.payload?.conversationId === conversationId
    )));
    await waitFor(() => releaseStore.mock.calls.length === 1);

    expect(releaseAgent).toHaveBeenCalledWith(conversationId);
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

    const restored = await conversationStore.getConversationHistoryCompacted(conversationId);
    expect(restored.history).toEqual([
      { role: "user", content: "keep active until final" },
      { role: "assistant", content: "echo:keep active until final" },
    ]);
  } finally {
    finishRun?.();
    ws.close();
    await closePending;
    await server.close();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
