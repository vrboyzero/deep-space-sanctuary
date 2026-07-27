import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";
import WebSocket from "ws";

import { type BelldandyAgent, ConversationStore } from "@belldandy/agent";
import { CODING_RUN_PROTOCOL_VERSION } from "./coding-run/contracts.js";
import { ConversationRunRegistry } from "./conversation-run-registry.js";
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

test("Conversation follow-up starts a new run only after the bound run settles", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-follow-up-handoff-"));
  const conversationId = "conversation-follow-up-handoff";
  const prompts: string[] = [];
  let activeRuns = 0;
  let maxActiveRuns = 0;
  let finishFirstRun: (() => void) | undefined;
  const firstRunPending = new Promise<void>((resolve) => {
    finishFirstRun = resolve;
  });
  const agent: BelldandyAgent = {
    async *run(input) {
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      prompts.push(input.text);
      try {
        yield { type: "status", status: "running" };
        if (prompts.length === 1) await firstRunPending;
        yield { type: "final", text: `echo:${input.text}` };
        yield { type: "status", status: "done" };
      } finally {
        activeRuns -= 1;
      }
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
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
      id: "follow-up-source",
      method: "message.send",
      params: { conversationId, text: "first turn" },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "follow-up-source" && frame.ok));
    const source = frames.find((frame) => frame.type === "res" && frame.id === "follow-up-source");

    ws.send(JSON.stringify({
      type: "req",
      id: "follow-up-enqueue",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "conversation.follow_up",
          binding: { conversationId, agentRunId: source.payload.runId },
          prompt: "second turn",
          idempotencyKey: "handoff-request-1",
        },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "follow-up-enqueue"));
    const queued = frames.find((frame) => frame.type === "res" && frame.id === "follow-up-enqueue");
    expect(queued).toMatchObject({ ok: true, payload: { command: { status: "queued" } } });
    ws.send(JSON.stringify({
      type: "req",
      id: "follow-up-enqueue-second",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "conversation.follow_up",
          binding: { conversationId, agentRunId: source.payload.runId },
          prompt: "third turn",
          idempotencyKey: "handoff-request-2",
        },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "follow-up-enqueue-second"));
    const queuedSecond = frames.find((frame) => frame.type === "res" && frame.id === "follow-up-enqueue-second");
    expect(queuedSecond).toMatchObject({ ok: true, payload: { command: { status: "queued" } } });
    expect(prompts).toEqual(["first turn"]);

    finishFirstRun?.();
    await waitFor(() => prompts.length === 3);
    await waitFor(() => frames.filter((frame) => frame.type === "event" && frame.event === "chat.final").length === 3);

    ws.send(JSON.stringify({
      type: "req",
      id: "follow-up-status",
      method: "coding.run.follow_up.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          binding: { conversationId, agentRunId: source.payload.runId },
          commandId: queued.payload.command.commandId,
        },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "follow-up-status"));
    const status = frames.find((frame) => frame.type === "res" && frame.id === "follow-up-status");

    ws.send(JSON.stringify({
      type: "req",
      id: "follow-up-status-second",
      method: "coding.run.follow_up.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          binding: { conversationId, agentRunId: source.payload.runId },
          commandId: queuedSecond.payload.command.commandId,
        },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "follow-up-status-second"));
    const statusSecond = frames.find((frame) => frame.type === "res" && frame.id === "follow-up-status-second");

    expect(prompts).toEqual(["first turn", "second turn", "third turn"]);
    expect(maxActiveRuns).toBe(1);
    expect(status).toMatchObject({
      ok: true,
      payload: {
        status: "delivered",
        sourceBinding: { conversationId, agentRunId: source.payload.runId },
        nextBinding: { conversationId },
      },
    });
    expect(status.payload.nextBinding.agentRunId).not.toBe(source.payload.runId);
    expect(statusSecond).toMatchObject({
      ok: true,
      payload: {
        status: "delivered",
        sourceBinding: { conversationId, agentRunId: source.payload.runId },
        nextBinding: { conversationId },
      },
    });
    expect(statusSecond.payload.nextBinding.agentRunId).not.toBe(status.payload.nextBinding.agentRunId);
    expect(JSON.stringify(status)).not.toContain("second turn");
    expect(JSON.stringify(status)).not.toContain("handoff-request-1");
  } finally {
    finishFirstRun?.();
    ws.close();
    await closePending;
    await server.close();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("Conversation follow-up fails the remaining queue when the next run cannot start", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-follow-up-failure-"));
  const conversationId = "conversation-follow-up-failure";
  const registry = new ConversationRunRegistry();
  let finishRun: (() => void) | undefined;
  const runPending = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  const agent: BelldandyAgent = {
    async *run() {
      yield { type: "status", status: "running" };
      await runPending;
      yield { type: "final", text: "first complete" };
      yield { type: "status", status: "done" };
    },
  };
  let factoryCalls = 0;
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationRunRegistry: registry,
    agentFactory: () => {
      factoryCalls += 1;
      if (factoryCalls > 1) throw new Error("follow-up agent unavailable");
      return agent;
    },
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
      id: "follow-up-failure-source",
      method: "message.send",
      params: { conversationId, text: "first turn" },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "follow-up-failure-source" && frame.ok));
    const source = frames.find((frame) => frame.type === "res" && frame.id === "follow-up-failure-source");
    const binding = { conversationId, agentRunId: source.payload.runId };

    for (const index of [1, 2]) {
      ws.send(JSON.stringify({
        type: "req",
        id: `follow-up-failure-enqueue-${index}`,
        method: "coding.run.control",
        params: {
          control: {
            version: CODING_RUN_PROTOCOL_VERSION,
            operation: "conversation.follow_up",
            binding,
            prompt: `follow-up ${index}`,
            idempotencyKey: `failure-request-${index}`,
          },
        },
      }));
      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === `follow-up-failure-enqueue-${index}`));
    }
    const queued = [1, 2].map((index) => frames.find(
      (frame) => frame.type === "res" && frame.id === `follow-up-failure-enqueue-${index}`,
    ));
    expect(queued.every((frame) => frame.ok === true)).toBe(true);

    finishRun?.();
    await waitFor(() => queued.every((frame) => (
      registry.getFollowUpStatus(binding, frame.payload.command.commandId)?.status === "failed"
    )));

    expect(factoryCalls).toBe(2);
    for (const frame of queued) {
      expect(registry.getFollowUpStatus(binding, frame.payload.command.commandId)).toMatchObject({
        status: "failed",
        sourceBinding: binding,
        hasError: true,
      });
    }
  } finally {
    finishRun?.();
    ws.close();
    await closePending;
    await server.close();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("Conversation replacement stops the bound run before starting its replacement", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-replacement-handoff-"));
  const conversationId = "conversation-replacement-handoff";
  const prompts: string[] = [];
  let activeRuns = 0;
  let maxActiveRuns = 0;
  const agent: BelldandyAgent = {
    async *run(input) {
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      prompts.push(input.text);
      try {
        yield { type: "status", status: "running" };
        if (prompts.length === 1) {
          await new Promise<void>((resolve) => {
            if (input.abortSignal?.aborted) {
              resolve();
              return;
            }
            input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "status", status: "stopped" };
          return;
        }
        yield { type: "final", text: `done:${input.text}` };
        yield { type: "status", status: "done" };
      } finally {
        activeRuns -= 1;
      }
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
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
      id: "replacement-source",
      method: "message.send",
      params: { conversationId, text: "obsolete turn" },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "replacement-source" && frame.ok));
    const source = frames.find((frame) => frame.type === "res" && frame.id === "replacement-source");

    ws.send(JSON.stringify({
      type: "req",
      id: "replacement-control",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "conversation.replace",
          binding: { conversationId, agentRunId: source.payload.runId },
          prompt: "replacement turn",
          idempotencyKey: "replacement-request-1",
        },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "replacement-control"));
    const replacement = frames.find((frame) => frame.type === "res" && frame.id === "replacement-control");
    expect(replacement).toMatchObject({
      ok: true,
      payload: {
        accepted: true,
        stopRequested: true,
        command: { intent: "replace", status: "queued" },
      },
    });

    await waitFor(() => frames.some((frame) => (
      frame.type === "event"
      && frame.event === "conversation.run.stopped"
      && frame.payload?.runId === source.payload.runId
    )));
    await waitFor(() => frames.some((frame) => (
      frame.type === "event"
      && frame.event === "chat.final"
      && frame.payload?.text === "done:replacement turn"
    )));

    ws.send(JSON.stringify({
      type: "req",
      id: "replacement-status",
      method: "coding.run.follow_up.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          binding: { conversationId, agentRunId: source.payload.runId },
          commandId: replacement.payload.command.commandId,
        },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "replacement-status"));
    const status = frames.find((frame) => frame.type === "res" && frame.id === "replacement-status");

    expect(prompts).toEqual(["obsolete turn", "replacement turn"]);
    expect(maxActiveRuns).toBe(1);
    expect(frames.some((frame) => (
      frame.type === "event"
      && frame.event === "chat.final"
      && frame.payload?.runId === source.payload.runId
    ))).toBe(false);
    expect(status).toMatchObject({
      ok: true,
      payload: {
        intent: "replace",
        status: "delivered",
        sourceBinding: { conversationId, agentRunId: source.payload.runId },
        nextBinding: { conversationId },
      },
    });
    expect(status.payload.nextBinding.agentRunId).not.toBe(source.payload.runId);
  } finally {
    ws.close();
    await closePending;
    await server.close();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
