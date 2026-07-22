import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, beforeAll, vi } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, type BelldandyAgent, ConversationStore, MockAgent } from "@belldandy/agent";
import { CompactionRuntimeTracker as SourceCompactionRuntimeTracker } from "../../belldandy-agent/src/compaction-runtime.js";
import { MemoryManager, MemoryStore, getGlobalMemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";
import { upsertKnownMarketplace } from "./extension-marketplace-state.js";
import { persistConversationPromptSnapshot } from "./conversation-prompt-snapshot.js";
import { recordConversationArtifactExport } from "./conversation-export-index.js";
import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import { resolveResidentSharedStateDir } from "./resident-memory-policy.js";
import { notifyConversationToolEvent } from "./query-runtime-side-effects.js";
import { startGatewayServer } from "./server.js";
import { RuntimeResilienceTracker } from "./runtime-resilience.js";
import { BELLDANDY_VERSION } from "./version.generated.js";
import { clearAutoTaskReportsForTest } from "./task-auto-report.js";
import {
  approveLatestPairingCode,
  cleanupGlobalMemoryManagersForTest,
  formatLocalDateForTest,
  pairWebSocketClient,
  resolveWebRoot,
  sleep,
  toSafeConversationFileIdForTest,
  waitFor,
  withEnv,
} from "./server-testkit.js";

// MemoryManager 内部会初始化 OpenAIEmbeddingProvider，需要 OPENAI_API_KEY
// 测试环境中设置一个占位值，避免构造函数抛错（不会实际调用 API）
beforeAll(() => {
  vi.setConfig({
    testTimeout: 15_000,
    hookTimeout: 15_000,
  });
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  clearAutoTaskReportsForTest();
});

test("gateway handshake and message.send streams chat", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];

  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString("utf-8")));
  });

  await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));

  await waitFor(() => frames.some((f) => f.type === "hello-ok"));
  const hello = frames.find((f) => f.type === "hello-ok");
  expect(hello?.version).toBe(BELLDANDY_VERSION);
  expect(hello?.methods).toContain("pairing.approve");
  expect(hello?.methods).toContain("conversation.run.stop");
  expect(hello?.methods).toContain("memory.tree.report.inventory.preview");
  expect(hello?.methods).toContain("memory.tree.report.shared_governance.preview");
  expect(hello?.methods).toContain("memory.tree.lifecycle.get");
  expect(hello?.methods).toContain("memory.tree.lifecycle.report");
  expect(hello?.methods).toContain("memory.tree.job.report");
  expect(hello?.methods).toContain("memory.tree.lifecycle.ensure");
  expect(hello?.methods).toContain("memory.tree.node.rebuild");

  await waitFor(() => frames.some((f) => f.type === "event" && f.event === "pairing.required"));
  const pairing = frames.find((f) => f.type === "event" && f.event === "pairing.required");
  const code = pairing?.payload?.code ? String(pairing.payload.code) : "";
  expect(code.length).toBeGreaterThan(0);

  const approveReqId = "req-pairing-approve";
  ws.send(JSON.stringify({
    type: "req",
    id: approveReqId,
    method: "pairing.approve",
    params: { code },
  }));

  await waitFor(() => frames.some((f) => f.type === "res" && f.id === approveReqId));
  const approved = frames.find((f) => f.type === "res" && f.id === approveReqId);
  expect(approved?.ok).toBe(true);
  expect(approved?.payload?.clientId).toBeTruthy();

  const reqId = "req-1";
  ws.send(JSON.stringify({ type: "req", id: reqId, method: "message.send", params: { text: "你好" } }));

  const reqId2 = "req-2";
  ws.send(JSON.stringify({ type: "req", id: reqId2, method: "message.send", params: { text: "你好" } }));

  await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId2 && f.ok === true));
  await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

  const sendRes = frames.find((f) => f.type === "res" && f.id === reqId2);
  expect(sendRes.payload.messageMeta).toMatchObject({
    isLatest: true,
  });
  const final = frames.find((f) => f.type === "event" && f.event === "chat.final");
  expect(final.payload.text).toContain("你好");
  expect(final.payload.messageMeta).toMatchObject({
    isLatest: true,
  });
  expect(typeof final.payload.messageMeta?.timestampMs).toBe("number");

  ws.close();
  await closeP;
  await server.close();
  // Windows: SQLite 文件可能仍被锁定，忽略清理错误（由 OS 最终回收）
  await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("message.send keeps budget exhaustion as a failed terminal state", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-budget-terminal-"));
  const agent: BelldandyAgent = {
    async *run() {
      yield { type: "status" as const, status: "running" };
      yield {
        type: "budget_exhausted" as const,
        budget: "tool_loop_iterations" as const,
        limit: 8,
        observed: 9,
      };
      yield { type: "final" as const, text: "工具调用迭代预算超限（最大 8 轮）" };
      yield { type: "status" as const, status: "error" };
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
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "message-send-budget-terminal",
      method: "message.send",
      params: {
        conversationId: "conv-budget-terminal",
        text: "continue forever",
      },
    }));

    await waitFor(() => frames.some((frame) => frame.type === "event" && frame.event === "chat.final"));
    const budgetEvent = frames.find((frame) => frame.type === "event" && frame.event === "agent.budget_exhausted");
    expect(budgetEvent?.payload).toMatchObject({
      conversationId: "conv-budget-terminal",
      budget: "tool_loop_iterations",
      limit: 8,
      observed: 9,
    });
    const statuses = frames
      .filter((frame) => frame.type === "event" && frame.event === "agent.status")
      .map((frame) => frame.payload?.status);
    expect(statuses).toContain("error");
    expect(statuses).not.toContain("done");

    ws.send(JSON.stringify({ type: "req", id: "budget-terminal-doctor", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "budget-terminal-doctor"));
    const doctor = frames.find((frame) => frame.type === "res" && frame.id === "budget-terminal-doctor");
    const trace = doctor?.payload?.queryRuntime?.traces?.find(
      (item: any) => item.traceId === "message-send-budget-terminal",
    );
    expect(trace).toMatchObject({
      method: "message.send",
      status: "failed",
      conversationId: "conv-budget-terminal",
    });
    expect(trace?.stages.map((item: any) => item.stage)).toContain("failed");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send preserves interrupted partial output without an overwriting chat.final", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-stream-interrupted-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const agent: BelldandyAgent = {
    async *run() {
      yield { type: "status" as const, status: "running" as const };
      yield { type: "delta" as const, delta: "partial answer" };
      yield {
        type: "interrupted",
        reason: "provider_stream_error",
        error: "stream reset",
        committed: true,
      };
      yield { type: "delta" as const, delta: " late delta" };
      yield { type: "final" as const, text: "late final" };
      yield { type: "status" as const, status: "error" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => agent,
  });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;
    ws.send(JSON.stringify({
      type: "req",
      id: "message-send-stream-interrupted",
      method: "message.send",
      params: { conversationId: "conv-stream-interrupted", text: "hello" },
    }));

    await waitFor(() => frames.some((frame) => (
      frame.type === "event" && frame.event === "conversation.run.interrupted"
    )));
    await sleep(50);

    expect(frames).toContainEqual(expect.objectContaining({
      type: "event",
      event: "chat.delta",
      payload: expect.objectContaining({ delta: "partial answer" }),
    }));
    expect(frames.find((frame) => frame.event === "conversation.run.interrupted")?.payload).toMatchObject({
      conversationId: "conv-stream-interrupted",
      reason: "provider_stream_error",
      error: "stream reset",
      hadPartialResponse: true,
    });
    expect(frames.some((frame) => frame.event === "chat.final")).toBe(false);
    expect(conversationStore.get("conv-stream-interrupted")?.messages.some((message) => (
      message.role === "assistant"
    ))).toBe(false);

    ws.send(JSON.stringify({
      type: "req",
      id: "stream-interrupted-doctor",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((frame) => (
      frame.type === "res" && frame.id === "stream-interrupted-doctor"
    )));
    const doctor = frames.find((frame) => frame.type === "res" && frame.id === "stream-interrupted-doctor");
    const trace = doctor?.payload?.queryRuntime?.traces?.find(
      (item: any) => item.traceId === "message-send-stream-interrupted",
    );
    expect(trace).toMatchObject({
      method: "message.send",
      status: "failed",
      conversationId: "conv-stream-interrupted",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("startup observability captures static page, bootstrap asset and websocket startup milestones", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-startup-observability-"));
  const firstStaticRequest = vi.fn();
  const firstBootstrapAssetRequest = vi.fn();
  const firstConnection = vi.fn();
  const firstAuthenticated = vi.fn();
  const invalidToken = vi.fn();
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    startupObservability: {
      onFirstStaticWebRequest: firstStaticRequest,
      onFirstBootstrapAssetRequest: firstBootstrapAssetRequest,
      onFirstWebSocketConnection: firstConnection,
      onFirstAuthenticatedWebSocket: firstAuthenticated,
      onInvalidTokenClose: invalidToken,
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString("utf-8")));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        "user-agent": "vitest-startup-observability",
      },
    });
    expect(response.status).toBe(200);

    const appJsResponse = await fetch(`http://127.0.0.1:${server.port}/app.js`, {
      headers: {
        "user-agent": "vitest-startup-observability",
        referer: `http://127.0.0.1:${server.port}/`,
      },
    });
    expect(appJsResponse.status).toBe(200);

    await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
    ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" }, clientId: "startup-observe-client" }));
    await waitFor(() => frames.some((f) => f.type === "hello-ok"));

    expect(firstStaticRequest).toHaveBeenCalledTimes(1);
    expect(firstStaticRequest.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      path: "/",
      userAgent: "vitest-startup-observability",
    });
    expect(firstBootstrapAssetRequest).toHaveBeenCalledTimes(1);
    expect(firstBootstrapAssetRequest.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      path: "/app.js",
      userAgent: "vitest-startup-observability",
    });
    expect(firstConnection).toHaveBeenCalledTimes(1);
    expect(firstAuthenticated).toHaveBeenCalledTimes(1);
    expect(invalidToken).not.toHaveBeenCalled();
    expect(firstAuthenticated.mock.calls[0]?.[0]).toMatchObject({
      clientId: "startup-observe-client",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("server.close force closes lingering raw sockets", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-close-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });
  const socket = net.connect(server.port, "127.0.0.1");
  const socketConnected = new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  const socketClosed = new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
  });

  try {
    await socketConnected;
    await expect(Promise.race([
      server.close().then(() => "closed"),
      sleep(2_000).then(() => "timeout"),
    ])).resolves.toBe("closed");
    await expect(Promise.race([
      socketClosed.then(() => "closed"),
      sleep(2_000).then(() => "timeout"),
    ])).resolves.toBe("closed");
  } finally {
    if (!socket.destroyed) {
      socket.destroy();
    }
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send persists accepted user transcript before assistant finalizes", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  let releaseAssistant!: () => void;
  const assistantGate = new Promise<void>((resolve) => {
    releaseAssistant = resolve;
  });
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        await assistantGate;
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "message-send-transcript-user-first",
      method: "message.send",
      params: {
        conversationId: "conv-transcript-user-first",
        text: "先记住我刚才说的话。",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-transcript-user-first" && f.ok === true));
    await conversationStore.waitForPendingPersistence("conv-transcript-user-first");
    const beforeAssistant = await conversationStore.getSessionTranscriptEvents("conv-transcript-user-first");

    expect(beforeAssistant).toHaveLength(1);
    expect(beforeAssistant[0]).toMatchObject({
      conversationId: "conv-transcript-user-first",
      type: "user_message_accepted",
      payload: {
        message: {
          role: "user",
          content: "先记住我刚才说的话。",
        },
      },
    });

    releaseAssistant();
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === "conv-transcript-user-first"));
    await conversationStore.waitForPendingPersistence("conv-transcript-user-first");
    const afterAssistant = await conversationStore.getSessionTranscriptEvents("conv-transcript-user-first");

    expect(afterAssistant).toHaveLength(2);
    expect(afterAssistant[1]).toMatchObject({
      conversationId: "conv-transcript-user-first",
      type: "assistant_message_finalized",
      payload: {
        message: {
          role: "assistant",
          content: "echo:先记住我刚才说的话。",
        },
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send forwards runtime tool events to websocket clients", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-tool-event-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        notifyConversationToolEvent(input.conversationId, {
          kind: "experience_draft_generated",
          candidateType: "method",
          candidateId: "exp-auto-1",
          title: "自动 Method Draft",
          taskId: "task-auto-1",
        });
        yield { type: "final" as const, text: "done" };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "message-send-tool-event",
      method: "message.send",
      params: {
        conversationId: "conv-tool-event",
        text: "trigger tool event",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-tool-event" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_event"));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    const toolEvent = frames.find((f) => f.type === "event" && f.event === "tool_event");
    expect(toolEvent?.payload).toMatchObject({
      conversationId: "conv-tool-event",
      kind: "experience_draft_generated",
      candidateType: "method",
      candidateId: "exp-auto-1",
      title: "自动 Method Draft",
      taskId: "task-auto-1",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.run.stop stops the active message.send run and allows the next run in the same conversation", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-stop-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        await sleep(120);
        if (input.abortSignal?.aborted) {
          yield { type: "status" as const, status: "stopped" };
          return;
        }
        yield { type: "delta" as const, delta: `partial:${input.text}` };
        await sleep(30);
        if (input.abortSignal?.aborted) {
          yield { type: "status" as const, status: "stopped" };
          return;
        }
        yield { type: "final" as const, text: `done:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "message-stop-run-1",
      method: "message.send",
      params: {
        conversationId: "conv-stop-main",
        text: "第一轮",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-stop-run-1" && f.ok === true));
    const sendRes = frames.find((f) => f.type === "res" && f.id === "message-stop-run-1");
    expect(sendRes?.payload?.runId).toBeTruthy();

    ws.send(JSON.stringify({
      type: "req",
      id: "message-stop-run-1-stop",
      method: "conversation.run.stop",
      params: {
        conversationId: "conv-stop-main",
        runId: sendRes.payload.runId,
        reason: "Stopped by user.",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-stop-run-1-stop" && f.ok === true));
    const stopRes = frames.find((f) => f.type === "res" && f.id === "message-stop-run-1-stop");
    expect(stopRes?.payload).toMatchObject({
      accepted: true,
      state: "stop_requested",
      runId: sendRes.payload.runId,
    });

    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "conversation.run.stopped"
      && f.payload?.conversationId === "conv-stop-main"
      && f.payload?.runId === sendRes.payload.runId
    ));

    expect(frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.runId === sendRes.payload.runId
    )).toBe(false);

    ws.send(JSON.stringify({
      type: "req",
      id: "message-stop-run-2",
      method: "message.send",
      params: {
        conversationId: "conv-stop-main",
        text: "第二轮",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-stop-run-2" && f.ok === true));
    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.conversationId === "conv-stop-main"
      && f.payload?.text === "done:第二轮"
    ));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send can auto stop the previous run in the same conversation", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-auto-stop-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        await sleep(150);
        if (input.abortSignal?.aborted) {
          yield { type: "status" as const, status: "stopped" };
          return;
        }
        yield { type: "final" as const, text: `done:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "message-auto-stop-run-1",
      method: "message.send",
      params: {
        conversationId: "conv-auto-stop-main",
        text: "第一轮",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-auto-stop-run-1" && f.ok === true));
    const firstSendRes = frames.find((f) => f.type === "res" && f.id === "message-auto-stop-run-1");
    expect(firstSendRes?.payload?.runId).toBeTruthy();

    ws.send(JSON.stringify({
      type: "req",
      id: "message-auto-stop-run-2",
      method: "message.send",
      params: {
        conversationId: "conv-auto-stop-main",
        text: "第二轮",
        autoStopPreviousRun: true,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-auto-stop-run-2" && f.ok === true));
    const secondSendRes = frames.find((f) => f.type === "res" && f.id === "message-auto-stop-run-2");
    expect(secondSendRes?.payload?.runId).toBeTruthy();
    expect(secondSendRes?.payload?.runId).not.toBe(firstSendRes?.payload?.runId);

    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "conversation.run.stopped"
      && f.payload?.conversationId === "conv-auto-stop-main"
      && f.payload?.runId === firstSendRes.payload.runId
    ));

    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.conversationId === "conv-auto-stop-main"
      && f.payload?.runId === secondSendRes.payload.runId
      && f.payload?.text === "done:第二轮"
    ));

    expect(frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.runId === firstSendRes.payload.runId
    )).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("/health includes version", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });

  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    const payload = await res.json() as { status?: string; version?: string };
    expect(res.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.version).toBe(BELLDANDY_VERSION);
  } finally {
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("/api/avatar/upload writes avatar file and updates USER.md in stateDir", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  await fs.promises.writeFile(
    path.join(stateDir, "USER.md"),
    "- **名字：** Test User\n- **头像：** 👤\n",
    "utf-8",
  );
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });

  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=",
    "base64",
  );

  try {
    const formData = new FormData();
    formData.append("role", "user");
    formData.append("file", new Blob([pngBuffer], { type: "image/png" }), "avatar.png");

    const res = await fetch(`http://127.0.0.1:${server.port}/api/avatar/upload`, {
      method: "POST",
      body: formData,
    });
    const payload = await res.json() as { ok?: boolean; role?: string; avatarPath?: string; mdPath?: string };

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.role).toBe("user");
    expect(payload.avatarPath).toMatch(/^\/avatar\/avatar-user-\d+-[0-9a-f]{8}\.png$/);
    expect(payload.mdPath).toBe(path.join(stateDir, "USER.md"));

    const userMd = await fs.promises.readFile(path.join(stateDir, "USER.md"), "utf-8");
    expect(userMd).toContain(`- **头像：** ${payload.avatarPath}`);

    const avatarFiles = await fs.promises.readdir(path.join(stateDir, "avatar"));
    expect(avatarFiles).toHaveLength(1);

    const assetRes = await fetch(`http://127.0.0.1:${server.port}${payload.avatarPath}`);
    expect(assetRes.status).toBe(200);
    expect(Buffer.from(await assetRes.arrayBuffer()).equals(pngBuffer)).toBe(true);
  } finally {
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("/api/avatar/upload writes avatar file into selected agent IDENTITY.md when agentId is provided", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    workspaceDir: "coder",
  });

  const agentDir = path.join(stateDir, "agents", "coder");
  await fs.promises.mkdir(agentDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(agentDir, "IDENTITY.md"),
    "- **名字：** 小码 (Coder)\n- **头像：** 👨‍💻\n",
    "utf-8",
  );

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
  });

  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=",
    "base64",
  );

  try {
    const formData = new FormData();
    formData.append("role", "agent");
    formData.append("agentId", "coder");
    formData.append("file", new Blob([pngBuffer], { type: "image/png" }), "coder-avatar.png");

    const res = await fetch(`http://127.0.0.1:${server.port}/api/avatar/upload`, {
      method: "POST",
      body: formData,
    });
    const payload = await res.json() as {
      ok?: boolean;
      role?: string;
      agentId?: string;
      avatarPath?: string;
      mdPath?: string;
    };

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.role).toBe("agent");
    expect(payload.agentId).toBe("coder");
    expect(payload.avatarPath).toMatch(/^\/avatar\/avatar-agent-\d+-[0-9a-f]{8}\.png$/);
    expect(payload.mdPath).toBe(path.join(agentDir, "IDENTITY.md"));

    const identityContent = await fs.promises.readFile(path.join(agentDir, "IDENTITY.md"), "utf-8");
    expect(identityContent).toContain(`- **头像：** ${payload.avatarPath}`);
  } finally {
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("agent.catalog.get exposes normalized catalog metadata and runtime defaults", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-catalog-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    kind: "resident",
    workspaceBinding: "current",
    workspaceDir: "coder",
    sessionNamespace: "coder-main",
    memoryMode: "isolated",
    whenToUse: ["需要改代码", "需要补测试"],
    defaultRole: "coder",
    methods: ["Review-Checklist.md", "Refactor-Plan.md"],
    skills: ["repo-map", "review-helper"],
  });
  registry.register({
    id: "verifier",
    displayName: "Verifier",
    model: "primary",
    kind: "worker",
    defaultRole: "verifier",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "agent-catalog-get", method: "agent.catalog.get", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "agent-catalog-get"));
    const res = frames.find((f) => f.type === "res" && f.id === "agent-catalog-get");

    expect(res.ok).toBe(true);
    expect(res.payload?.summary).toMatchObject({
      totalCount: 3,
      residentCount: 2,
      workerCount: 1,
    });
    expect(res.payload?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "coder",
        metadata: expect.objectContaining({
          kind: "resident",
          workspaceBinding: "current",
          workspaceDir: "coder",
          sessionNamespace: "coder-main",
          memoryMode: "isolated",
          catalog: expect.objectContaining({
            whenToUse: ["需要改代码", "需要补测试"],
            defaultRole: "coder",
            defaultPermissionMode: "confirm",
            defaultAllowedToolFamilies: ["workspace-read", "workspace-write", "patch", "command-exec", "memory", "goal-governance"],
            defaultMaxToolRiskLevel: "high",
            methods: ["Review-Checklist.md", "Refactor-Plan.md"],
            skills: ["repo-map", "review-helper"],
            handoffStyle: "summary",
          }),
        }),
        runtime: expect.objectContaining({
          status: "idle",
          mainConversationId: "agent:coder:main",
        }),
      }),
      expect.objectContaining({
        id: "verifier",
        metadata: expect.objectContaining({
          kind: "worker",
          catalog: expect.objectContaining({
            whenToUse: [],
            defaultRole: "verifier",
            defaultPermissionMode: "confirm",
            defaultAllowedToolFamilies: ["workspace-read", "command-exec", "browser", "memory", "goal-governance"],
            defaultMaxToolRiskLevel: "high",
            methods: [],
            skills: [],
            handoffStyle: "structured",
          }),
        }),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});


test("message.send without conversationId reuses resident agent main conversation", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    kind: "resident",
    memoryMode: "isolated",
    sessionNamespace: "coder-main",
    workspaceBinding: "current",
    workspaceDir: "coder",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-main-1",
      method: "message.send",
      params: {
        text: "你好 coder",
        agentId: "coder",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-main-1" && f.ok === true));
    const firstRes = frames.find((f) => f.type === "res" && f.id === "resident-main-1");
    expect(firstRes.payload?.conversationId).toBe("agent:coder:main");

    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === "agent:coder:main"));

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-main-2",
      method: "message.send",
      params: {
        text: "第二轮 coder",
        agentId: "coder",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-main-2" && f.ok === true));
    const secondRes = frames.find((f) => f.type === "res" && f.id === "resident-main-2");
    expect(secondRes.payload?.conversationId).toBe("agent:coder:main");

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-main-default",
      method: "message.send",
      params: {
        text: "你好 default",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-main-default" && f.ok === true));
    const defaultRes = frames.find((f) => f.type === "res" && f.id === "resident-main-default");
    expect(defaultRes.payload?.conversationId).toBe("agent:default:main");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("resident agent main conversation persists inside agent workspace sessions", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    kind: "resident",
    memoryMode: "isolated",
    sessionNamespace: "coder-main",
    workspaceBinding: "current",
    workspaceDir: "coder",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-storage-coder",
      method: "message.send",
      params: {
        text: "写到 coder 私有 sessions",
        agentId: "coder",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-storage-coder" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === "agent:coder:main"));

    const conversationId = "agent:coder:main";
    const safeConversationId = toSafeConversationFileIdForTest(conversationId);
    const residentFilePath = path.join(stateDir, "agents", "coder", "sessions", `${safeConversationId}.jsonl`);
    const globalFilePath = path.join(stateDir, "sessions", `${safeConversationId}.jsonl`);

    await waitFor(() => fs.existsSync(residentFilePath));
    expect(fs.existsSync(residentFilePath)).toBe(true);
    expect(fs.existsSync(globalFilePath)).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("default resident main conversation persists inside root sessions", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-storage-default-root",
      method: "message.send",
      params: {
        text: "写到 root sessions",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-storage-default-root" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === "agent:default:main"));

    const conversationId = "agent:default:main";
    const safeConversationId = toSafeConversationFileIdForTest(conversationId);
    const rootFilePath = path.join(stateDir, "sessions", `${safeConversationId}.jsonl`);
    const legacyResidentPath = path.join(stateDir, "agents", "default", "sessions", `${safeConversationId}.jsonl`);

    await waitFor(() => fs.existsSync(rootFilePath));
    expect(fs.existsSync(rootFilePath)).toBe(true);
    expect(fs.existsSync(legacyResidentPath)).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("custom workspaceBinding persists resident main conversation inside workspace-scoped sessions", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    kind: "resident",
    memoryMode: "hybrid",
    sessionNamespace: "coder-main",
    workspaceBinding: "custom",
    workspaceDir: "project-b",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-storage-coder-custom",
      method: "message.send",
      params: {
        text: "写到 custom workspace sessions",
        agentId: "coder",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-storage-coder-custom" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === "agent:coder:main"));

    const conversationId = "agent:coder:main";
    const safeConversationId = toSafeConversationFileIdForTest(conversationId);
    const residentFilePath = path.join(
      stateDir,
      "workspaces",
      "project-b",
      "agents",
      "coder",
      "sessions",
      `${safeConversationId}.jsonl`,
    );
    const legacyCurrentBindingPath = path.join(stateDir, "agents", "project-b", "sessions", `${safeConversationId}.jsonl`);

    await waitFor(() => fs.existsSync(residentFilePath));
    expect(fs.existsSync(residentFilePath)).toBe(true);
    expect(fs.existsSync(legacyCurrentBindingPath)).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("resident agent memory managers use isolated sqlite files", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    workspaceDir: "coder",
  });

  try {
    createScopedMemoryManagers({
      stateDir,
      agentRegistry: registry,
      modelsDir: path.join(stateDir, "models"),
      conversationStore: new ConversationStore({
        dataDir: path.join(stateDir, "sessions"),
      }),
      indexerOptions: {
        ignorePatterns: ["node_modules", ".git"],
        extensions: [".md", ".txt", ".jsonl"],
        watch: false,
      },
    });

    const defaultManager = getGlobalMemoryManager();
    const coderManager = getGlobalMemoryManager({ agentId: "coder" });
    const sharedManager = getGlobalMemoryManager({ workspaceRoot: resolveResidentSharedStateDir(stateDir) });

    expect(defaultManager).toBeTruthy();
    expect(coderManager).toBeTruthy();
    expect(sharedManager).toBeTruthy();
    expect(coderManager).not.toBe(defaultManager);
    expect(sharedManager).not.toBe(defaultManager);
    expect(sharedManager).not.toBe(coderManager);

    const defaultDbPath = path.join(stateDir, "memory.sqlite");
    const coderDbPath = path.join(stateDir, "agents", "coder", "memory.sqlite");
    await waitFor(() => fs.existsSync(defaultDbPath) && fs.existsSync(coderDbPath));
    expect(fs.existsSync(defaultDbPath)).toBe(true);
    expect(fs.existsSync(coderDbPath)).toBe(true);

    const defaultDb = new MemoryStore(defaultDbPath);
    const coderDb = new MemoryStore(coderDbPath);
    try {
      const readTables = (db: MemoryStore) => ((db as any).db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('memory_sources', 'memory_scores', 'memory_tree_nodes', 'memory_tree_edges', 'memory_clean_reports')
        ORDER BY name ASC
      `).all() as Array<{ name: string }>);
      expect(readTables(defaultDb).map((row) => row.name)).toEqual([
        "memory_clean_reports",
        "memory_scores",
        "memory_sources",
        "memory_tree_edges",
        "memory_tree_nodes",
      ]);
      expect(readTables(coderDb).map((row) => row.name)).toEqual([
        "memory_clean_reports",
        "memory_scores",
        "memory_sources",
        "memory_tree_edges",
        "memory_tree_nodes",
      ]);
    } finally {
      defaultDb.close();
      coderDb.close();
    }
  } finally {
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 15_000);

test("gateway can auto-run resident agent with a visible reminder", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    const started = await server.autoRunResidentAgent({
      text: "请处理新的 StarWeaver 唤醒信号",
      visibleReminder: "StarWeaver 提醒：检测到新的唤醒信号，正在主动处理。",
    });

    expect(started.conversationId).toBe("agent:default:main");
    expect(started.runId).toBeTruthy();

    const conversationId = "agent:default:main";
    const safeConversationId = toSafeConversationFileIdForTest(conversationId);
    const rootFilePath = path.join(stateDir, "sessions", `${safeConversationId}.jsonl`);
    await waitFor(() => fs.existsSync(rootFilePath));

    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.conversationId === conversationId
      && f.payload?.text === "StarWeaver 提醒：检测到新的唤醒信号，正在主动处理。",
    ));
    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.conversationId === conversationId
      && f.payload?.text === "echo:请处理新的 StarWeaver 唤醒信号",
    ));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("resident busy tracks actual resident runs instead of websocket activity", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  let releaseRun: (() => void) | undefined;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        await runGate;
        yield { type: "final" as const, text: `done:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    expect(server.isResidentAgentBusy("default")).toBe(false);

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-busy-run",
      method: "message.send",
      params: {
        text: "busy now",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-busy-run" && f.ok === true));
    await waitFor(() => server.isResidentAgentBusy("default"));

    releaseRun?.();

    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.conversationId === "agent:default:main"
      && f.payload?.text === "done:busy now",
    ));
    await waitFor(() => server.isResidentAgentBusy("default") === false);
  } finally {
    releaseRun?.();
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("gateway can broadcast visible reminder into resident conversation without starting a run", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    const started = await server.autoRunResidentAgent({
      text: "should not run",
      visibleReminder: "StarWeaver 提醒：仅广播提醒。",
      skipRun: true,
    });

    expect(started.conversationId).toBe("agent:default:main");
    expect(started.runId).toBe("");

    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.conversationId === "agent:default:main"
      && f.payload?.text === "StarWeaver 提醒：仅广播提醒。",
    ));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("resident agent durable memories write into agent workspace memory directory", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    workspaceDir: "coder",
  });

  try {
    createScopedMemoryManagers({
      stateDir,
      agentRegistry: registry,
      modelsDir: path.join(stateDir, "models"),
      conversationStore: new ConversationStore({
        dataDir: path.join(stateDir, "sessions"),
      }),
      indexerOptions: {
        ignorePatterns: ["node_modules", ".git"],
        extensions: [".md", ".txt", ".jsonl"],
        watch: false,
      },
    });

    const coderManager = getGlobalMemoryManager({ agentId: "coder" }) as any;
    expect(coderManager).toBeTruthy();
    coderManager.embeddingProvider = {
      modelName: "test-memory",
      embed: async () => [0.1],
      embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
      embedQuery: async () => [0.1],
    };
    await coderManager.startLazyIndexing();

    coderManager.evolutionEnabled = true;
    coderManager.evolutionMinMessages = 1;
    coderManager.callLLMForExtraction = vi.fn(async () => [
      {
        type: "fact",
        content: "Coder prefers precise patches",
        category: "preference",
      },
    ]);

    const result = await coderManager.extractMemoriesFromConversation("agent:coder:main", [
      { role: "user", content: "记住 coder 的长期偏好。" },
      { role: "assistant", content: "好的，我来提取长期记忆。" },
    ], {
      sourceConversationId: "agent:coder:main",
    });

    expect(result.count).toBe(1);
    const today = formatLocalDateForTest(new Date());
    const coderMemoryFile = path.join(stateDir, "agents", "coder", "memory", `${today}.md`);
    const rootMemoryFile = path.join(stateDir, "memory", `${today}.md`);

    await waitFor(() => fs.existsSync(coderMemoryFile));
    expect(fs.existsSync(coderMemoryFile)).toBe(true);
    expect(fs.existsSync(rootMemoryFile)).toBe(false);
    const content = await fs.promises.readFile(coderMemoryFile, "utf-8");
    expect(content).toContain("Coder prefers precise patches");
  } finally {
    await cleanupGlobalMemoryManagersForTest();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});


test("message.send forwards modelId to AgentRegistry.create as modelOverride", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const capturedOverrides: Array<string | undefined> = [];
  const registry = new AgentRegistry((_profile, opts): BelldandyAgent => {
    capturedOverrides.push(opts?.modelOverride);
    return new MockAgent();
  });
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const reqId = "model-override";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "message.send",
      params: {
        text: "hello",
        modelId: "kimi-k2.5",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
    expect(capturedOverrides).toContain("kimi-k2.5");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => { });
  }
}, 15_000);

test("message.send resolves deepseek:auto to flash when warmup verdict is not promotable", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const capturedOverrides: Array<string | undefined> = [];
  const registry = new AgentRegistry((_profile, opts): BelldandyAgent => {
    capturedOverrides.push(opts?.modelOverride);
    return new MockAgent();
  });
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  await persistConversationPromptSnapshot({
    stateDir,
    snapshot: {
      agentId: "default",
      conversationId: "agent:default:main",
      runId: "run-prev-flash",
      createdAt: Date.now() - 2_000,
      systemPrompt: "system",
      messages: [],
      inputMeta: {
        structureSignature: "sig-stable",
        orderingGuard: { status: "risk", reasons: ["tool_contract_list_changed"] },
        warmupCoordination: {
          eligible: true,
          status: "warm_candidate",
          recommendation: "proceed",
          reason: "test_previous_snapshot",
        },
        cacheFamilyAffinity: {
          status: "aligned",
          familyKey: "family-a",
          previousFamilyKey: "family-a",
          reason: "same_cache_family_as_previous",
        },
      },
    },
    retention: { defaultMaxRunsPerConversation: 4, heartbeatMaxRuns: 2, emailThreadMaxRuns: 2, maxAgeDays: 7 },
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    modelFallbacks: [
      {
        id: "deepseek-flash-main",
        displayName: "DeepSeek Flash",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-flash",
        model: "deepseek-v4-flash",
      },
      {
        id: "deepseek-pro-main",
        displayName: "DeepSeek Pro",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-pro",
        model: "deepseek-v4-pro",
      },
    ],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const reqId = "deepseek-auto-flash";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "message.send",
      params: {
        conversationId: "agent:default:main",
        text: "hello",
        modelId: "deepseek:auto",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
    expect(capturedOverrides).toContain("deepseek-flash-main");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => { });
  }
});

test("message.send resolves deepseek:auto to pro when warmup verdict is promotable", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const capturedOverrides: Array<string | undefined> = [];
  const registry = new AgentRegistry((_profile, opts): BelldandyAgent => {
    capturedOverrides.push(opts?.modelOverride);
    return new MockAgent();
  });
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  await persistConversationPromptSnapshot({
    stateDir,
    snapshot: {
      agentId: "default",
      conversationId: "agent:default:main",
      runId: "run-prev-pro",
      createdAt: Date.now() - 2_000,
      systemPrompt: "system",
      messages: [],
      inputMeta: {
        structureSignature: "sig-stable",
        orderingGuard: { status: "stable", reasons: [] },
        warmupCoordination: {
          eligible: true,
          status: "warm_candidate",
          recommendation: "proceed",
          reason: "test_previous_snapshot",
        },
        cacheFamilyAffinity: {
          status: "aligned",
          familyKey: "family-a",
          previousFamilyKey: "family-a",
          reason: "same_cache_family_as_previous",
        },
      },
    },
    retention: { defaultMaxRunsPerConversation: 4, heartbeatMaxRuns: 2, emailThreadMaxRuns: 2, maxAgeDays: 7 },
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    modelFallbacks: [
      {
        id: "deepseek-flash-main",
        displayName: "DeepSeek Flash",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-flash",
        model: "deepseek-v4-flash",
      },
      {
        id: "deepseek-pro-main",
        displayName: "DeepSeek Pro",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-pro",
        model: "deepseek-v4-pro",
      },
    ],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const reqId = "deepseek-auto-pro";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "message.send",
      params: {
        conversationId: "agent:default:main",
        text: "hello",
        modelId: "deepseek:auto",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
    expect(capturedOverrides).toContain("deepseek-pro-main");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => { });
  }
});

test("message.send token.usage includes deepseek route verdict for auto tier routing", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const agent: BelldandyAgent = {
    async *run() {
      yield {
        type: "usage" as const,
        systemPromptTokens: 3,
        contextTokens: 4,
        inputTokens: 10,
        outputTokens: 6,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 10,
        modelCalls: 1,
        cacheSupport: "supported" as const,
        usageCalibration: {
          estimatedPromptTokens: 7,
          actualInputTokens: 10,
          modelCalls: 1,
          averageInputTokensPerCall: 10,
          deltaTokens: 3,
          deltaRatio: 0.4286,
          status: "under_estimated" as const,
        },
        providerRawUsage: {
          promptTokens: 10,
          completionTokens: 6,
          totalTokens: 16,
        },
        requestShape: {
          messageCount: 23,
          systemMessageCount: 7,
          toolSchemaCount: 66,
        },
        localPromptEstimate: {
          systemPromptTokens: 41651,
          contextTokens: 1902,
          totalPromptTokens: 43553,
        },
      };
      yield { type: "final" as const, text: "ok" };
      yield { type: "status" as const, status: "done" };
    },
  };

  await persistConversationPromptSnapshot({
    stateDir,
    snapshot: {
      agentId: "default",
      conversationId: "agent:default:main",
      runId: "run-prev-token-route",
      createdAt: Date.now() - 2_000,
      systemPrompt: "system",
      messages: [],
      inputMeta: {
        deepseekRoute: {
          selectedTier: "pro",
        },
        structureSignature: "sig-stable",
        orderingGuard: { status: "stable", reasons: [] },
        warmupCoordination: {
          eligible: true,
          status: "warming",
          recommendation: "proceed_with_caution",
          reason: "test_previous_snapshot",
        },
        cacheFamilyAffinity: {
          status: "aligned",
          familyKey: "family-a",
          previousFamilyKey: "family-a",
          reason: "same_cache_family_as_previous",
        },
      },
    },
    retention: { defaultMaxRunsPerConversation: 4, heartbeatMaxRuns: 2, emailThreadMaxRuns: 2, maxAgeDays: 7 },
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
    modelFallbacks: [
      {
        id: "deepseek-flash-main",
        displayName: "DeepSeek Flash",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-flash",
        model: "deepseek-v4-flash",
      },
      {
        id: "deepseek-pro-main",
        displayName: "DeepSeek Pro",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-pro",
        model: "deepseek-v4-pro",
      },
    ],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const reqId = "deepseek-auto-token-usage";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "message.send",
      params: {
        conversationId: "agent:default:main",
        text: "hello",
        modelId: "deepseek:auto",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "token.usage"));
    const usageEvent = frames.find((f) => f.type === "event" && f.event === "token.usage");
    expect(usageEvent?.payload?.deepseekRoute).toMatchObject({
      requestedRoute: "deepseek:auto",
      effectiveModelId: "deepseek-pro-main",
      selectedTier: "pro",
      routeMode: "deepseek_virtual",
      degraded: false,
      reason: "auto_pinned_to_pro",
      tierPinning: {
        pinned: true,
        previousTier: "pro",
        reason: "no_downgrade_signal",
      },
    });
    expect(usageEvent?.payload?.usageCalibration).toMatchObject({
      estimatedPromptTokens: 7,
      averageInputTokensPerCall: 10,
      status: "under_estimated",
    });
    expect(usageEvent?.payload?.providerRawUsage).toMatchObject({
      promptTokens: 10,
      completionTokens: 6,
      totalTokens: 16,
    });
    expect(usageEvent?.payload?.requestShape).toMatchObject({
      messageCount: 23,
      systemMessageCount: 7,
      toolSchemaCount: 66,
    });
    expect(usageEvent?.payload?.localPromptEstimate).toMatchObject({
      systemPromptTokens: 41651,
      contextTokens: 1902,
      totalPromptTokens: 43553,
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => { });
  }
});

test("message.send falls back to primary when deepseek:auto cannot resolve a concrete candidate", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const capturedOverrides: Array<string | undefined> = [];
  const registry = new AgentRegistry((_profile, opts): BelldandyAgent => {
    capturedOverrides.push(opts?.modelOverride);
    return {
      async *run() {
        yield {
          type: "usage" as const,
          systemPromptTokens: 2,
          contextTokens: 3,
          inputTokens: 8,
          outputTokens: 5,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheHitTokens: 0,
          cacheMissTokens: 8,
          modelCalls: 1,
          cacheSupport: "unknown" as const,
        };
        yield { type: "final" as const, text: "ok" };
        yield { type: "status" as const, status: "done" };
      },
    };
  });
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    primaryModelConfig: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-primary",
      model: "gpt-4.1-mini",
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    const reqId = "deepseek-auto-primary-fallback";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "message.send",
      params: {
        conversationId: "agent:default:main",
        text: "hello",
        modelId: "deepseek:auto",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "token.usage"));
    const usageEvent = frames.find((f) => f.type === "event" && f.event === "token.usage");

    expect(capturedOverrides).toContain("primary");
    expect(capturedOverrides).not.toContain("deepseek:auto");
    expect(usageEvent?.payload?.deepseekRoute).toMatchObject({
      requestedRoute: "deepseek:auto",
      effectiveModelId: "primary",
      routeMode: "deepseek_virtual",
      degraded: true,
      reason: "deepseek_tier_candidates_incomplete",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => { });
  }
});

test("message.send keeps deepseek:auto as passthrough when DeepSeek route policy is disabled", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const capturedOverrides: Array<string | undefined> = [];
  const registry = new AgentRegistry((_profile, opts): BelldandyAgent => {
    capturedOverrides.push(opts?.modelOverride);
    return new MockAgent();
  });
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    modelFallbacks: [
      {
        id: "deepseek-flash-main",
        displayName: "DeepSeek Flash",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-flash",
        model: "deepseek-v4-flash",
      },
      {
        id: "deepseek-pro-main",
        displayName: "DeepSeek Pro",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-pro",
        model: "deepseek-v4-pro",
      },
    ],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await withEnv({ BELLDANDY_DEEPSEEK_ROUTE_POLICY_ENABLED: "false" }, async () => {
      await pairWebSocketClient(ws, frames, stateDir);

      const reqId = "deepseek-auto-policy-disabled";
      ws.send(JSON.stringify({
        type: "req",
        id: reqId,
        method: "message.send",
        params: {
          conversationId: "agent:default:main",
          text: "hello",
          modelId: "deepseek:auto",
        },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
      expect(capturedOverrides).not.toContain("deepseek-flash-main");
      expect(capturedOverrides).not.toContain("deepseek-pro-main");
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => { });
  }
});

test("message.send reuses conversation snapshot to avoid one extra conversationStore.get on hot path", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const conversationId = "conv-hot-path";
  conversationStore.addMessage(conversationId, "assistant", "previous", {
    agentId: "default",
  });

  const getSpy = vi.spyOn(conversationStore, "get");
  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "final" as const, text: `reply:${input.text}` };
      yield { type: "status", status: "done" as const };
    },
  };

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => agent,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "message-send-hot-path",
      method: "message.send",
      params: {
        conversationId,
        text: "hello",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-hot-path" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));
    // The request path should reuse the loaded conversation snapshot; a post-final digest refresh may add one async read.
    expect(getSpy.mock.calls.length).toBeLessThanOrEqual(3);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => { });
  }
});

test("message.send emits auto run token result and conversation.meta returns persisted records", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "status", status: "running" as const };
      yield {
        type: "usage" as const,
        systemPromptTokens: 3,
        contextTokens: 7,
        inputTokens: 12,
        outputTokens: 8,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        modelCalls: 1,
        inputCostUsd: 0.0012,
        outputCostUsd: 0.0024,
        totalCostUsd: 0.0036,
      };
      yield { type: "final" as const, text: `echo:${input.text}` };
      yield { type: "status" as const, status: "done" };
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
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    const conversationId = "conv-token-auto";
    const reqId = "token-auto";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "message.send",
      params: { text: "统计一下", conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "token.counter.result"));

    const taskEvent = frames.find((f) => f.type === "event" && f.event === "token.counter.result");
    expect(taskEvent.payload).toMatchObject({
      conversationId,
      name: "run",
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      inputCostUsd: 0.0012,
      outputCostUsd: 0.0024,
      totalCostUsd: 0.0036,
      auto: true,
    });

    const metaReqId = "conversation-meta";
    ws.send(JSON.stringify({
      type: "req",
      id: metaReqId,
      method: "conversation.meta",
      params: { conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === metaReqId && f.ok === true));
    const metaRes = frames.find((f) => f.type === "res" && f.id === metaReqId);
    expect(metaRes.payload.taskTokenResults).toHaveLength(1);
    expect(metaRes.payload.taskTokenResults[0]).toMatchObject({
      name: "run",
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      inputCostUsd: 0.0012,
      outputCostUsd: 0.0024,
      totalCostUsd: 0.0036,
      auto: true,
    });
    expect(metaRes.payload.continuationState).toMatchObject({
      version: 1,
      scope: "conversation",
      targetId: conversationId,
      recommendedTargetId: conversationId,
      targetType: "conversation",
    });
    expect(metaRes.payload.messages).toHaveLength(2);
    expect(metaRes.payload.messages[0]).toMatchObject({
      role: "user",
      content: "统计一下",
    });
    expect(metaRes.payload.messages[1]).toMatchObject({
      role: "assistant",
      content: "echo:统计一下",
      isLatest: true,
    });
    expect(typeof metaRes.payload.messages[0].timestampMs).toBe("number");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send appends auto task report summary when enabled", async () => {
  await withEnv({
    BELLDANDY_AUTO_TASK_TIME_ENABLED: "true",
    BELLDANDY_AUTO_TASK_TOKEN_ENABLED: "true",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" as const };
        yield {
          type: "usage" as const,
          systemPromptTokens: 1,
          contextTokens: 2,
          inputTokens: 12,
          outputTokens: 8,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 1,
        };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
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
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;

      const conversationId = "conv-auto-task-report";
      ws.send(JSON.stringify({
        type: "req",
        id: "auto-task-report",
        method: "message.send",
        params: { text: "自动统计", conversationId },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "auto-task-report" && f.ok === true));
      await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

      const finalFrame = frames.find((f) => f.type === "event" && f.event === "chat.final");
      expect(String(finalFrame?.payload?.text ?? "")).toContain("执行统计");
      expect(String(finalFrame?.payload?.text ?? "")).toContain("- 耗时：");
      expect(String(finalFrame?.payload?.text ?? "")).toContain("- Token：IN 12 / OUT 8 / TOTAL 20");

      ws.send(JSON.stringify({
        type: "req",
        id: "auto-task-report-meta",
        method: "conversation.meta",
        params: { conversationId },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "auto-task-report-meta" && f.ok === true));
      const metaRes = frames.find((f) => f.type === "res" && f.id === "auto-task-report-meta");
      expect(String(metaRes?.payload?.messages?.[1]?.content ?? "")).toContain("执行统计");
      expect(String(metaRes?.payload?.messages?.[1]?.content ?? "")).toContain("- Token：IN 12 / OUT 8 / TOTAL 20");
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send keeps only one auto task report block when final text already contains one", async () => {
  await withEnv({
    BELLDANDY_AUTO_TASK_TIME_ENABLED: "true",
    BELLDANDY_AUTO_TASK_TOKEN_ENABLED: "true",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" as const };
        yield {
          type: "usage" as const,
          systemPromptTokens: 1,
          contextTokens: 2,
          inputTokens: 12,
          outputTokens: 8,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 1,
        };
        yield {
          type: "final" as const,
          text: `echo:${input.text}\n\n执行统计\n- 耗时: 1.23s\n- Token: IN 1 / OUT 1 / TOTAL 2`,
        };
        yield { type: "status" as const, status: "done" };
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
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;

      const conversationId = "conv-auto-task-report-dedup";
      ws.send(JSON.stringify({
        type: "req",
        id: "auto-task-report-dedup",
        method: "message.send",
        params: { text: "自动统计去重", conversationId },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "auto-task-report-dedup" && f.ok === true));
      await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

      const finalFrame = frames.find((f) => f.type === "event" && f.event === "chat.final");
      const finalText = String(finalFrame?.payload?.text ?? "");
      expect(finalText.match(/执行统计/g)?.length ?? 0).toBe(1);
      expect(finalText).not.toContain("- 耗时：1.23s");
      expect(finalText).toContain("- Token：IN 12 / OUT 8 / TOTAL 20");

      ws.send(JSON.stringify({
        type: "req",
        id: "auto-task-report-dedup-meta",
        method: "conversation.meta",
        params: { conversationId },
      }));

      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "auto-task-report-dedup-meta" && f.ok === true));
      const metaRes = frames.find((f) => f.type === "res" && f.id === "auto-task-report-dedup-meta");
      const persistedText = String(metaRes?.payload?.messages?.[1]?.content ?? "");
      expect(persistedText.match(/执行统计/g)?.length ?? 0).toBe(1);
      expect(persistedText).not.toContain("- 耗时：1.23s");
      expect(persistedText).toContain("- Token：IN 12 / OUT 8 / TOTAL 20");
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send strips think blocks from final output and persisted assistant message", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "status", status: "running" as const };
      yield { type: "final" as const, text: `<think>secret:${input.text}</think>\n\necho:${input.text}` };
      yield { type: "status" as const, status: "done" };
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
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    const conversationId = "conv-strip-think";
    ws.send(JSON.stringify({
      type: "req",
      id: "strip-think",
      method: "message.send",
      params: { text: "隐藏推理", conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "strip-think" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    const finalFrame = frames.find((f) => f.type === "event" && f.event === "chat.final");
    const finalText = String(finalFrame?.payload?.text ?? "");
    expect(finalText).not.toContain("<think>");
    expect(finalText).not.toContain("secret:隐藏推理");
    expect(finalText).toContain("echo:隐藏推理");

    ws.send(JSON.stringify({
      type: "req",
      id: "strip-think-meta",
      method: "conversation.meta",
      params: { conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "strip-think-meta" && f.ok === true));
    const metaRes = frames.find((f) => f.type === "res" && f.id === "strip-think-meta");
    const persistedText = String(metaRes?.payload?.messages?.[1]?.content ?? "");
    expect(persistedText).not.toContain("<think>");
    expect(persistedText).not.toContain("secret:隐藏推理");
    expect(persistedText).toContain("echo:隐藏推理");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});


test("gateway durable extraction scheduler reuses canonical extraction view instead of direct memory evolution extraction", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-evolution-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-evolution",
  });
  const conversationId = "conv-durable-evolution";
  conversationStore.addMessage(conversationId, "user", "A".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));
  await conversationStore.forceCompact(conversationId);
  await fs.promises.rm(path.join(stateDir, "sessions", `${conversationId}.meta.json`), { force: true }).catch(() => {});

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    evolutionEnabled: true,
    evolutionModel: "test-evolution-model",
    evolutionBaseUrl: "https://example.invalid/v1",
    evolutionApiKey: "test-evolution-key",
    evolutionMinMessages: 3,
  });
  (memoryManager as any).embeddingProvider = {
    modelName: "test-memory-evolution",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  const extractSpy = vi.spyOn(memoryManager, "extractMemoriesFromConversation");
  const llmSpy = vi.spyOn(memoryManager as any, "callLLMForExtraction").mockResolvedValue([
    {
      type: "事实",
      category: "fact",
      content: "统一调度已接管 memory evolution。",
    },
  ]);
  registerGlobalMemoryManager(memoryManager);

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
  });

  try {
    await server.requestDurableExtractionFromDigest({
      conversationId,
      source: "memory_evolution",
      threshold: 2,
      force: true,
    });

    await waitFor(() => extractSpy.mock.calls.length === 1);

    const extractionMessages = extractSpy.mock.calls[0]?.[1];
    expect(extractionMessages).toEqual([
      { role: "user", content: "A".repeat(80) },
      { role: "assistant", content: "B".repeat(80) },
      { role: "user", content: "C".repeat(80) },
      { role: "assistant", content: "D".repeat(80) },
    ]);
    expect(llmSpy).toHaveBeenCalled();
    expect(String(llmSpy.mock.calls[0]?.[0] ?? "")).not.toContain("Understood. I have the context from our previous conversation.");
    expect(String(llmSpy.mock.calls[0]?.[0] ?? "")).not.toContain("rolling-summary-evolution");
    const extractionRun = extractSpy.mock.results[0]?.value;
    if (extractionRun && typeof (extractionRun as Promise<unknown>).then === "function") {
      await extractionRun;
    }
  } finally {
    extractSpy.mockRestore();
    llmSpy.mockRestore();
    await server.close();
    await memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.digest.refresh records usage accounting and enforces session digest budget", async () => {
  await withEnv({
    BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "1",
    BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS: "60000",
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS: undefined,
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS: undefined,
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-digest-budget-"));
    const conversationStore = new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
      compaction: {
        enabled: true,
        tokenThreshold: 10,
        keepRecentCount: 1,
      },
      summarizer: async () => "rolling-summary-budget",
    });
    const conversationId = "conv-digest-budget";
    conversationStore.addMessage(conversationId, "user", "A".repeat(80));
    conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
    conversationStore.addMessage(conversationId, "user", "C".repeat(80));

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;

      ws.send(JSON.stringify({
        type: "req",
        id: "digest-budget-first",
        method: "conversation.digest.refresh",
        params: { conversationId, threshold: 2 },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "digest-budget-first"));
      const firstRes = frames.find((f) => f.type === "res" && f.id === "digest-budget-first");
      expect(firstRes.ok).toBe(true);

      ws.send(JSON.stringify({
        type: "req",
        id: "digest-budget-second",
        method: "conversation.digest.refresh",
        params: { conversationId, threshold: 2, force: true },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "digest-budget-second"));
      const secondRes = frames.find((f) => f.type === "res" && f.id === "digest-budget-second");
      expect(secondRes.ok).toBe(false);
      expect(secondRes.error).toMatchObject({
        code: "session_digest_refresh_budget_exceeded",
      });

      const usageRaw = await fs.promises.readFile(path.join(stateDir, "memory-runtime", "usage-accounting.json"), "utf-8");
      const usageState = JSON.parse(usageRaw) as { events?: Array<{ consumer?: string; outcome?: string; metadata?: Record<string, unknown> }> };
      const digestEvents = (usageState.events ?? []).filter((item) => item.consumer === "session_digest_refresh");
      expect(digestEvents).toHaveLength(2);
      expect(digestEvents[0]).toMatchObject({
        consumer: "session_digest_refresh",
        outcome: "completed",
      });
      expect(digestEvents[1]).toMatchObject({
        consumer: "session_digest_refresh",
        outcome: "blocked",
        metadata: {
          reasonCode: "session_digest_refresh_budget_exceeded",
        },
      });
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("requestDurableExtractionFromDigest reuses current digest when session digest budget is exceeded", async () => {
  await withEnv({
    BELLDANDY_MEMORY_EVOLUTION_ENABLED: "true",
    BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "1",
    BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS: "60000",
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS: undefined,
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS: undefined,
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-from-digest-budget-"));
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-from-digest-workspace-"));
    const conversationStore = new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
      compaction: {
        enabled: true,
        tokenThreshold: 10,
        keepRecentCount: 1,
      },
      summarizer: async () => "rolling-summary-durable-from-digest",
    });
    const conversationId = "conv-durable-from-digest-budget";
    conversationStore.addMessage(conversationId, "user", "A".repeat(80));
    conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
    conversationStore.addMessage(conversationId, "user", "C".repeat(80));
    conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));

    const memoryManager = new MemoryManager({
      workspaceRoot,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-budget-fallback",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 3,
    });
    (memoryManager as any).embeddingProvider = {
      modelName: "test-evolution-budget-fallback",
      embed: async () => [0.1],
      embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
      embedQuery: async () => [0.1],
    };
    const extractSpy = vi.spyOn(memoryManager, "extractMemoriesFromConversation");
    const llmSpy = vi.spyOn(memoryManager as any, "callLLMForExtraction").mockResolvedValue([
      {
        type: "事实",
        category: "fact",
        content: "fallback digest snapshot still allows durable extraction scheduling",
      },
    ]);
    registerGlobalMemoryManager(memoryManager);

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
    });

    try {
      await conversationStore.refreshSessionDigest(conversationId, { threshold: 2 });

      await server.requestDurableExtractionFromDigest({
        conversationId,
        source: "memory_evolution",
        threshold: 2,
      });

      await waitFor(() => extractSpy.mock.calls.length === 1);
      await extractSpy.mock.results[0]?.value;
      expect(extractSpy).toHaveBeenCalledTimes(1);
      expect(llmSpy).toHaveBeenCalled();
    } finally {
      extractSpy.mockRestore();
      llmSpy.mockRestore();
      await server.close();
      await memoryManager.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("durable extraction request limiter records blocked request usage and keeps prior extraction state", async () => {
  await withEnv({
    BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: undefined,
    BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS: undefined,
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS: "1",
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS: "60000",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-budget-"));
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-durable-budget-workspace-"));
    const conversationStore = new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
      compaction: {
        enabled: true,
        tokenThreshold: 10,
        keepRecentCount: 1,
      },
      summarizer: async () => "rolling-summary-durable-budget",
    });
    const conversationId = "conv-durable-budget";
    conversationStore.addMessage(conversationId, "user", "A".repeat(80));
    conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
    conversationStore.addMessage(conversationId, "user", "C".repeat(80));

    const memoryManager = new MemoryManager({
      workspaceRoot,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 3,
    });
    (memoryManager as any).embeddingProvider = {
      modelName: "test-durable-budget",
      embed: async () => [0.1],
      embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
      embedQuery: async () => [0.1],
    };
    const extractionSpy = vi.spyOn(memoryManager as any, "callLLMForExtraction").mockResolvedValue([
      {
        type: "事实",
        category: "fact",
        content: "Week 9 已经给 durable extraction 接入 budget guard。",
      },
    ]);
    registerGlobalMemoryManager(memoryManager);

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;

      ws.send(JSON.stringify({
        type: "req",
        id: "durable-budget-first",
        method: "conversation.digest.refresh",
        params: { conversationId, threshold: 2 },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-budget-first" && f.ok === true));
      await waitFor(() => frames.some((f) => f.type === "event" && f.event === "conversation.memory.extraction.updated" && f.payload?.conversationId === conversationId && f.payload?.extraction?.status === "completed"));
      expect(extractionSpy).toHaveBeenCalledTimes(1);

      conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));
      frames.length = 0;

      ws.send(JSON.stringify({
        type: "req",
        id: "durable-budget-second",
        method: "conversation.digest.refresh",
        params: { conversationId, threshold: 2 },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-budget-second" && f.ok === true));
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(extractionSpy).toHaveBeenCalledTimes(1);

      ws.send(JSON.stringify({
        type: "req",
        id: "durable-budget-get",
        method: "conversation.memory.extraction.get",
        params: { conversationId, threshold: 2 },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-budget-get" && f.ok === true));
      const getRes = frames.find((f) => f.type === "res" && f.id === "durable-budget-get");
      expect(getRes.payload.extraction).toMatchObject({
        conversationId,
        status: "completed",
        runCount: 1,
      });

      const usageRaw = await fs.promises.readFile(path.join(stateDir, "memory-runtime", "usage-accounting.json"), "utf-8");
      const usageState = JSON.parse(usageRaw) as { events?: Array<{ consumer?: string; outcome?: string; metadata?: Record<string, unknown> }> };
      const requestEvents = (usageState.events ?? []).filter((item) => item.consumer === "durable_extraction_request");
      const runEvents = (usageState.events ?? []).filter((item) => item.consumer === "durable_extraction_run");

      expect(requestEvents.map((item) => item.outcome)).toEqual(["queued"]);
      expect(runEvents.some((item) => item.outcome === "blocked")).toBe(false);
    } finally {
      ws.close();
      await closeP;
      extractionSpy.mockRestore();
      await server.close();
      await memoryManager.close();
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("message.send userUuid overrides handshake userUuid for agent input and token upload", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seenUserUuids: Array<string | undefined> = [];
  const receivedUploads: Array<{ method: string; url: string; authorization: string; body: string }> = [];
  const uploadServer = http.createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      receivedUploads.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      response.writeHead(204);
      response.end();
    })();
  });
  await new Promise<void>((resolve, reject) => {
    uploadServer.once("error", reject);
    uploadServer.listen(0, "127.0.0.1", resolve);
  });
  const uploadAddress = uploadServer.address();
  if (!uploadAddress || typeof uploadAddress === "string") {
    throw new Error("Token usage upload test server address unavailable.");
  }
  const uploadUrl = `http://127.0.0.1:${uploadAddress.port}/api/internal/token-usage`;
  const agent: BelldandyAgent = {
    async *run(input) {
      seenUserUuids.push(input.userUuid);
      yield {
        type: "usage" as const,
        systemPromptTokens: 0,
        contextTokens: 0,
        inputTokens: 5,
        outputTokens: 4,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        modelCalls: 1,
      };
      yield { type: "final" as const, text: "ok" };
    },
  };

  try {
    await withEnv({
      BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED: "true",
      BELLDANDY_TOKEN_USAGE_UPLOAD_URL: uploadUrl,
      BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY: "gro_test_upload_key",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TRUSTED_PRIVATE_ENDPOINT: "true",
    }, async () => {
      const server = await startGatewayServer({
        port: 0,
        auth: { mode: "none" },
        webRoot: resolveWebRoot(),
        stateDir,
        agentFactory: () => agent,
      });

      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
      const frames: any[] = [];
      const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
      ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

      try {
        await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
        ws.send(JSON.stringify({
          type: "connect",
          role: "web",
          auth: { mode: "none" },
          userUuid: "connect-uuid",
        }));
        await waitFor(() => frames.some((f) => f.type === "hello-ok"));

        ws.send(JSON.stringify({
          type: "req",
          id: "pairing-message-uuid",
          method: "message.send",
          params: { text: "pairing-init" },
        }));
        await waitFor(() => frames.some((f) => f.type === "event" && f.event === "pairing.required"));
        await approveLatestPairingCode(frames, stateDir);

        const reqId = "message-uuid-override";
        ws.send(JSON.stringify({
          type: "req",
          id: reqId,
          method: "message.send",
          params: {
            text: "覆盖 uuid",
            userUuid: "message-uuid",
          },
        }));

        await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
        await waitFor(() => receivedUploads.length > 0);

        expect(seenUserUuids).toEqual(["message-uuid"]);
        expect(receivedUploads[0]?.method).toBe("POST");
        expect(receivedUploads[0]?.url).toBe("/api/internal/token-usage");
        expect(receivedUploads[0]?.authorization).toBe("Bearer gro_test_upload_key");
        expect(JSON.parse(receivedUploads[0]?.body ?? "{}")).toMatchObject({
          userUuid: "message-uuid",
          deltaTokens: 9,
        });
      } finally {
        ws.close();
        await closeP;
        await server.close();
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      uploadServer.close((error) => error ? reject(error) : resolve());
    });
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});



test("conversation.memory.extraction.get exposes runtime surfaces and rate-limit state", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-runtime-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-runtime",
  });
  const conversationId = "conv-memory-runtime";
  conversationStore.addMessage(conversationId, "user", "A".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    evolutionEnabled: true,
    evolutionModel: "test-evolution-model",
    evolutionBaseUrl: "https://example.invalid/v1",
    evolutionApiKey: "test-evolution-key",
    evolutionMinMessages: 3,
  });
  registerGlobalMemoryManager(memoryManager);

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    ws.send(JSON.stringify({
      type: "req",
      id: "memory-runtime-get",
      method: "conversation.memory.extraction.get",
      params: { conversationId, threshold: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-runtime-get"));
    const response = frames.find((f) => f.type === "res" && f.id === "memory-runtime-get");
    expect(response.ok).toBe(true);
    expect(response.payload?.runtime?.mainThreadToolSurface?.mode).toBe("tool-executor");
    expect(response.payload?.runtime?.durableExtraction?.permissionSurface?.mode).toBe("internal-restricted");
    expect(response.payload?.runtime?.durableExtraction?.availability).toMatchObject({
      available: true,
      enabled: true,
      model: "test-evolution-model",
      hasBaseUrl: true,
      hasApiKey: true,
    });
    expect(response.payload?.runtime?.durableExtraction?.guidance).toMatchObject({
      policyVersion: "week9-v1",
      acceptedCandidateTypes: ["user", "feedback", "project", "reference"],
    });
    expect(response.payload?.runtime?.durableExtraction?.rateLimit?.request?.status).toBe("unlimited");
    expect(response.payload?.runtime?.durableExtraction?.rateLimit?.run?.status).toBe("unlimited");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});



