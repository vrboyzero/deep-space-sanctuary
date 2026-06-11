import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test, vi } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, type BelldandyAgent, ConversationStore, MockAgent } from "@belldandy/agent";
import { MemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";

import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";

// MemoryManager 内部会初始化 OpenAIEmbeddingProvider，需要 OPENAI_API_KEY
// 测试环境中设置一个占位值，避免构造函数抛错（不会实际调用 API）
beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(() => {
  cleanupGlobalMemoryManagersForTest();
});

test("conversation.prompt_snapshot.get returns persisted snapshot artifact", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
    kind: "resident",
    workspaceBinding: "current",
    defaultRole: "default",
  });
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    getConversationPromptSnapshot: async ({ conversationId, runId }) => ({
      schemaVersion: 1,
      manifest: {
        conversationId,
        runId: runId ?? "run-1",
        agentId: "default",
        createdAt: 123,
        persistedAt: 456,
        source: "runtime.prompt_snapshot",
      },
      summary: {
        messageCount: 2,
        systemPromptChars: 18,
        includesHookSystemPrompt: true,
        hasPrependContext: false,
        deltaCount: 0,
        deltaChars: 0,
        systemPromptEstimatedTokens: 5,
        deltaEstimatedTokens: 0,
        providerNativeSystemBlockCount: 0,
        providerNativeSystemBlockChars: 0,
        providerNativeSystemBlockEstimatedTokens: 0,
        tokenBreakdown: {
          systemPromptEstimatedChars: 18,
          systemPromptEstimatedTokens: 5,
          sectionEstimatedChars: 0,
          sectionEstimatedTokens: 0,
          droppedSectionEstimatedChars: 0,
          droppedSectionEstimatedTokens: 0,
          deltaEstimatedChars: 0,
          deltaEstimatedTokens: 0,
          providerNativeSystemBlockEstimatedChars: 0,
          providerNativeSystemBlockEstimatedTokens: 0,
        },
      },
      snapshot: {
        systemPrompt: "system prompt body",
        messages: [
          { role: "system", content: "system prompt body" },
          { role: "user", content: "hello" },
        ],
        hookSystemPromptUsed: true,
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
      id: "conversation-prompt-snapshot-get",
      method: "conversation.prompt_snapshot.get",
      params: { conversationId: "conv-1", runId: "run-1" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-prompt-snapshot-get"));

    const res = frames.find((f) => f.type === "res" && f.id === "conversation-prompt-snapshot-get");
    expect(res.ok).toBe(true);
    expect(res.payload?.snapshot).toMatchObject({
      manifest: {
        conversationId: "conv-1",
        runId: "run-1",
        agentId: "default",
      },
      summary: {
        messageCount: 2,
        includesHookSystemPrompt: true,
      },
      snapshot: {
        systemPrompt: "system prompt body",
      },
    });
    expect(res.payload?.launchExplainability).toMatchObject({
      effectiveLaunch: {
        source: "catalog_default",
        agentId: "default",
        role: "default",
      },
    });
    expect(res.payload?.residentStateBinding).toMatchObject({
      agentId: "default",
    });

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-prompt-snapshot", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-prompt-snapshot" && f.ok === true));

    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-prompt-snapshot");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const trace = traces.find((item: any) => item.method === "conversation.prompt_snapshot.get" && item.conversationId === "conv-1");

    expect(trace).toMatchObject({
      method: "conversation.prompt_snapshot.get",
      status: "completed",
      conversationId: "conv-1",
    });
    expect(trace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "request_validated",
      "prompt_snapshot_loaded",
      "completed",
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.meta keeps time metadata on every message and marks only the newest message as latest", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const agent: BelldandyAgent = {
    async *run(input) {
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

    const conversationId = "conv-meta-latest";

    ws.send(JSON.stringify({
      type: "req",
      id: "message-meta-1",
      method: "message.send",
      params: { text: "第一轮", conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-meta-1" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.text === "echo:第一轮"));

    const firstSendRes = frames.find((f) => f.type === "res" && f.id === "message-meta-1");
    const firstFinal = frames.find((f) => f.type === "event" && f.event === "chat.final" && f.payload?.text === "echo:第一轮");
    expect(firstSendRes.payload.messageMeta).toMatchObject({
      isLatest: true,
    });
    expect(firstFinal.payload.messageMeta).toMatchObject({
      isLatest: true,
    });
    expect(typeof firstSendRes.payload.messageMeta?.timestampMs).toBe("number");
    expect(typeof firstFinal.payload.messageMeta?.timestampMs).toBe("number");
    expect(String(firstSendRes.payload.messageMeta?.displayTimeText ?? "").length).toBeGreaterThan(0);
    expect(String(firstFinal.payload.messageMeta?.displayTimeText ?? "").length).toBeGreaterThan(0);

    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "message-meta-2",
      method: "message.send",
      params: { text: "第二轮", conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-meta-2" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.text === "echo:第二轮"));

    const metaReqId = "conversation-meta-latest";
    ws.send(JSON.stringify({
      type: "req",
      id: metaReqId,
      method: "conversation.meta",
      params: { conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === metaReqId && f.ok === true));
    const metaRes = frames.find((f) => f.type === "res" && f.id === metaReqId);
    const messages = metaRes.payload.messages;

    expect(messages).toHaveLength(4);
    for (const message of messages) {
      expect(typeof message.timestampMs).toBe("number");
      expect(String(message.displayTimeText ?? "").length).toBeGreaterThan(0);
    }

    expect(messages).toMatchObject([
      { role: "user", content: "第一轮", isLatest: false },
      { role: "assistant", content: "echo:第一轮", isLatest: false },
      { role: "user", content: "第二轮", isLatest: false },
      { role: "assistant", content: "echo:第二轮", isLatest: true },
    ]);
    expect(messages.filter((message: { isLatest: boolean }) => message.isLatest)).toHaveLength(1);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.restore returns transcript-based restore view after meta is missing", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-restore",
  });
  const conversationId = "conv-restore-rpc";
  conversationStore.addMessage(conversationId, "user", "A".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));
  await conversationStore.forceCompact(conversationId);
  await fs.promises.rm(path.join(stateDir, "sessions", `${conversationId}.meta.json`), { force: true }).catch(() => {});

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
      id: "conversation-restore",
      method: "conversation.restore",
      params: { conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-restore" && f.ok === true));
    const restoreRes = frames.find((f) => f.type === "res" && f.id === "conversation-restore");

    expect(restoreRes.payload.restore).toMatchObject({
      conversationId,
      diagnostics: {
        source: "transcript",
        transcriptUsed: true,
        relinkApplied: true,
      },
      canonicalExtractionView: [
        { role: "user", content: "A".repeat(80) },
        { role: "assistant", content: "B".repeat(80) },
        { role: "user", content: "C".repeat(80) },
        { role: "assistant", content: "D".repeat(80) },
      ],
    });
    expect(restoreRes.payload.restore.compactedView[0].content).toContain("rolling-summary-restore");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.transcript.export returns redacted transcript bundle after meta is missing", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-export",
  });
  const conversationId = "conv-transcript-export-rpc";
  conversationStore.addMessage(conversationId, "user", "A".repeat(80), {
    agentId: "belldandy",
    channel: "webchat",
    clientContext: {
      sentAtMs: 1712000000002,
      locale: "zh-CN",
    },
  });
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80), {
    agentId: "belldandy",
  });
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));
  await conversationStore.forceCompact(conversationId);
  await fs.promises.rm(path.join(stateDir, "sessions", `${conversationId}.meta.json`), { force: true }).catch(() => {});

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
      id: "conversation-transcript-export",
      method: "conversation.transcript.export",
      params: { conversationId, mode: "shareable" },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-transcript-export" && f.ok === true));
    const exportRes = frames.find((f) => f.type === "res" && f.id === "conversation-transcript-export");

    expect(exportRes.payload.export).toMatchObject({
      manifest: {
        conversationId,
        source: "conversation.transcript.export",
        redactionMode: "shareable",
      },
      summary: {
        eventCount: 5,
        messageEventCount: 4,
        compactBoundaryCount: 1,
        partialCompactionViewCount: 0,
        restore: {
          source: "transcript",
          relinkApplied: true,
          fallbackToRaw: false,
        },
      },
      redaction: {
        mode: "shareable",
        contentRedacted: true,
      },
    });
    expect(exportRes.payload.export.restore.canonicalExtractionView).toEqual([
      {
        role: "user",
        contentPreview: "A".repeat(80),
        contentLength: 80,
        contentTruncated: false,
      },
      {
        role: "assistant",
        contentPreview: "B".repeat(80),
        contentLength: 80,
        contentTruncated: false,
      },
      {
        role: "user",
        contentPreview: "C".repeat(80),
        contentLength: 80,
        contentTruncated: false,
      },
      {
        role: "assistant",
        contentPreview: "D".repeat(80),
        contentLength: 80,
        contentTruncated: false,
      },
    ]);
    expect(exportRes.payload.export.restore.compactedView[0].contentPreview).toContain("rolling-summary-export");
    expect(exportRes.payload.export.events[0].payload.message.clientContext).toBeUndefined();
    expect(exportRes.payload.export.events[0].payload.conversation).toBeUndefined();

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-transcript-export", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-transcript-export" && f.ok === true));
    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-transcript-export");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const exportTrace = traces.find((item: any) => item.method === "conversation.transcript.export" && item.conversationId === conversationId);

    expect(exportTrace).toMatchObject({
      method: "conversation.transcript.export",
      status: "completed",
      conversationId,
    });
    expect(exportTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "request_validated",
      "transcript_export_built",
      "completed",
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.timeline.get returns readable projection for transcript partial compaction", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "timeline-summary-partial",
  });
  const conversationId = "conv-timeline-rpc";
  conversationStore.addMessage(conversationId, "user", "A".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));
  conversationStore.addMessage(conversationId, "user", "E".repeat(80));
  const messageIds = conversationStore.get(conversationId)?.messages.map((message) => message.id) ?? [];
  await conversationStore.forcePartialCompact(conversationId, {
    direction: "from",
    pivotMessageId: messageIds[1],
  });
  await fs.promises.rm(path.join(stateDir, "sessions", `${conversationId}.meta.json`), { force: true }).catch(() => {});

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
      id: "conversation-timeline-get",
      method: "conversation.timeline.get",
      params: { conversationId, previewChars: 48 },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-timeline-get" && f.ok === true));
    const timelineRes = frames.find((f) => f.type === "res" && f.id === "conversation-timeline-get");

    expect(timelineRes.payload.timeline).toMatchObject({
      manifest: {
        conversationId,
        source: "conversation.timeline.get",
      },
      summary: {
        eventCount: 7,
        itemCount: 8,
        messageCount: 5,
        compactBoundaryCount: 1,
        partialCompactionCount: 1,
        restore: {
          source: "transcript",
          relinkApplied: true,
          fallbackToRaw: false,
        },
      },
      warnings: [],
    });
    expect(timelineRes.payload.timeline.items.some((item: any) => item.kind === "partial_compaction" && item.direction === "from")).toBe(true);
    expect(timelineRes.payload.timeline.items.some((item: any) => item.kind === "compact_boundary" && item.trigger === "partial_from")).toBe(true);
    expect(timelineRes.payload.timeline.items[timelineRes.payload.timeline.items.length - 1]).toMatchObject({
      kind: "restore_result",
      source: "transcript",
      relinkApplied: true,
      partialViewId: expect.any(String),
    });

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-timeline", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-timeline" && f.ok === true));
    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-timeline");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const timelineTrace = traces.find((item: any) => item.method === "conversation.timeline.get" && item.conversationId === conversationId);

    expect(timelineTrace).toMatchObject({
      method: "conversation.timeline.get",
      status: "completed",
      conversationId,
    });
    expect(timelineTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "request_validated",
      "timeline_built",
      "completed",
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("context.compact returns boundary metadata and conversation.meta exposes persisted compact boundaries", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-v1",
  });
  const conversationId = "conv-meta-boundary";
  conversationStore.addMessage(conversationId, "user", "A".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));

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
      id: "context-compact-boundary",
      method: "context.compact",
      params: { conversationId },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "context-compact-boundary" && f.ok === true));
    const compactRes = frames.find((f) => f.type === "res" && f.id === "context-compact-boundary");

    expect(compactRes.payload).toMatchObject({
      compacted: true,
      tier: "rolling",
      boundary: {
        trigger: "manual",
        summaryStateVersion: 1,
        compactedMessageCount: 3,
        preservedSegment: {
          preservedMessageCount: 1,
        },
      },
    });
    expect(typeof compactRes.payload?.boundary?.preservedSegment?.anchorId).toBe("string");
    expect(typeof compactRes.payload?.boundary?.preservedSegment?.headMessageId).toBe("string");
    expect(typeof compactRes.payload?.boundary?.preservedSegment?.tailMessageId).toBe("string");

    ws.send(JSON.stringify({
      type: "req",
      id: "conversation-meta-boundary",
      method: "conversation.meta",
      params: { conversationId },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-meta-boundary" && f.ok === true));
    const metaRes = frames.find((f) => f.type === "res" && f.id === "conversation-meta-boundary");

    expect(metaRes.payload?.messages).toHaveLength(4);
    expect(metaRes.payload?.messages.every((message: { id?: string }) => typeof message.id === "string" && message.id.length > 0)).toBe(true);
    expect(metaRes.payload?.compactBoundaries?.[0]).toMatchObject({
      id: compactRes.payload?.boundary?.id,
      trigger: "manual",
      compactedMessageCount: 3,
      preservedSegment: {
        anchorId: compactRes.payload?.boundary?.preservedSegment?.anchorId,
        headMessageId: compactRes.payload?.boundary?.preservedSegment?.headMessageId,
        tailMessageId: compactRes.payload?.boundary?.preservedSegment?.tailMessageId,
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("context.compact.partial persists partial from boundary metadata", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "partial-from-summary",
  });
  const conversationId = "conv-meta-partial-boundary";

  conversationStore.addMessage(conversationId, "user", "A".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "D".repeat(80));
  conversationStore.addMessage(conversationId, "user", "E".repeat(80));
  const messageIds = conversationStore.get(conversationId)?.messages.map((message) => message.id) ?? [];

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
      id: "context-compact-partial-boundary",
      method: "context.compact.partial",
      params: {
        conversationId,
        direction: "from",
        pivotMessageId: messageIds[1],
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "context-compact-partial-boundary"));
    const compactRes = frames.find((f) => f.type === "res" && f.id === "context-compact-partial-boundary");

    expect(compactRes?.ok).toBe(true);
    expect(compactRes.payload).toMatchObject({
      compacted: true,
      direction: "from",
      tier: "rolling",
      boundary: {
        trigger: "partial_from",
        compactedMessageCount: 3,
        preservedSegment: {
          anchorId: messageIds[1],
          headMessageId: messageIds[0],
          tailMessageId: messageIds[1],
          preservedMessageCount: 2,
        },
      },
    });
    expect(conversationStore.getPartialCompactionView(conversationId)).toMatchObject({
      direction: "from",
      pivotMessageId: messageIds[1],
      compactedMessageCount: 5,
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "conversation-meta-partial-boundary",
      method: "conversation.meta",
      params: { conversationId },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-meta-partial-boundary" && f.ok === true));
    const metaRes = frames.find((f) => f.type === "res" && f.id === "conversation-meta-partial-boundary");

    expect(metaRes.payload?.messages).toHaveLength(5);
    expect(metaRes.payload?.compactBoundaries?.[0]).toMatchObject({
      id: compactRes.payload?.boundary?.id,
      trigger: "partial_from",
      compactedMessageCount: 3,
      preservedSegment: {
        anchorId: messageIds[1],
        headMessageId: messageIds[0],
        tailMessageId: messageIds[1],
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.digest.get and conversation.digest.refresh expose session digest runtime", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-v1",
  });
  const conversationId = "conv-session-digest";

  conversationStore.addMessage(conversationId, "user", "A".repeat(80));
  conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
  conversationStore.addMessage(conversationId, "user", "C".repeat(80));

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => ({
      async *run(input) {
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

    const getReqId = "conversation-digest-get";
    ws.send(JSON.stringify({
      type: "req",
      id: getReqId,
      method: "conversation.digest.get",
      params: { conversationId, threshold: 2 },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === getReqId && f.ok === true));
    const getRes = frames.find((f) => f.type === "res" && f.id === getReqId);
    expect(getRes.payload.digest).toMatchObject({
      conversationId,
      status: "updated",
      messageCount: 3,
      digestedMessageCount: 0,
      pendingMessageCount: 3,
      threshold: 2,
      rollingSummary: "",
      archivalSummary: "",
      lastDigestAt: 0,
    });

    const refreshReqId = "conversation-digest-refresh";
    ws.send(JSON.stringify({
      type: "req",
      id: refreshReqId,
      method: "conversation.digest.refresh",
      params: { conversationId, threshold: 2 },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === refreshReqId && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "conversation.digest.updated" && f.payload?.conversationId === conversationId));
    const refreshRes = frames.find((f) => f.type === "res" && f.id === refreshReqId);
    const refreshEvent = frames.find((f) => f.type === "event" && f.event === "conversation.digest.updated" && f.payload?.conversationId === conversationId);
    expect(refreshRes.payload).toMatchObject({
      updated: true,
      compacted: false,
      digest: {
        conversationId,
        status: "ready",
        messageCount: 3,
        digestedMessageCount: 3,
        pendingMessageCount: 0,
        threshold: 2,
        rollingSummary: "rolling-summary-v1",
        archivalSummary: "",
      },
    });
    expect(typeof refreshRes.payload.digest.lastDigestAt).toBe("number");
    expect(refreshRes.payload.digest.lastDigestAt).toBeGreaterThan(0);
    expect(refreshEvent.payload).toMatchObject({
      source: "manual",
      updated: true,
      compacted: false,
      digest: {
        conversationId,
        status: "ready",
        threshold: 2,
      },
    });

    frames.length = 0;
    const sendReqId = "conversation-digest-auto";
    ws.send(JSON.stringify({
      type: "req",
      id: sendReqId,
      method: "message.send",
      params: { text: "继续", conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === sendReqId && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === conversationId));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "conversation.digest.updated" && f.payload?.conversationId === conversationId));

    const autoDigestEvent = frames.find((f) => f.type === "event" && f.event === "conversation.digest.updated" && f.payload?.conversationId === conversationId);
    expect(autoDigestEvent.payload).toMatchObject({
      source: "message.send",
      digest: {
        conversationId,
        threshold: 2,
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.meta stays aligned with digest and resume_context across multi-round continuation", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-multi-round-workspace-"));
  const conversationId = "conv-multi-round-resume";
  const taskId = "task-multi-round-resume";
  const round1StopPoint = "已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。";
  const round2StopPoint = "已确认 prompt artifact 与请求体都带上续做注入，待继续核对多轮一致性。";
  const sharedNextStep = "先验证最近变更或产物，再继续后续动作。";
  let refreshCount = 0;

  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => {
      refreshCount += 1;
      if (refreshCount === 1) {
        return JSON.stringify({
          summary: round1StopPoint,
          currentGoal: "继续修 memory viewer 来源解释入口",
          keyResults: ["已补来源解释卡片初版"],
          currentWork: round1StopPoint,
          nextStep: sharedNextStep,
        });
      }
      return JSON.stringify({
        summary: round2StopPoint,
        currentGoal: "继续核对多轮续做一致性",
        keyResults: ["已确认 prompt artifact 与请求体都带上续做注入"],
        currentWork: round2StopPoint,
        nextStep: sharedNextStep,
      });
    },
  });

  conversationStore.addMessage(conversationId, "user", "先补来源解释入口。");
  conversationStore.addMessage(conversationId, "assistant", "我先把 explain_sources 与 viewer 详情接起来。");

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
    openaiApiKey: "test-memory-key",
  });
  registerGlobalMemoryManager(memoryManager);

  const store = (memoryManager as any).store as {
    createTask(task: any): void;
    createTaskActivity(activity: any): void;
    updateTask(taskId: string, patch: Record<string, unknown>): void;
  };

  const createActivity = (input: {
    id: string;
    sequence: number;
    kind: string;
    title: string;
    happenedAt: string;
    files?: string[];
  }) => ({
    id: input.id,
    taskId,
    conversationId,
    sessionKey: conversationId,
    source: "chat",
    kind: input.kind,
    state: "completed",
    sequence: input.sequence,
    happenedAt: input.happenedAt,
    recordedAt: input.happenedAt,
    title: input.title,
    files: input.files,
  });

  store.createTask({
    id: taskId,
    conversationId,
    sessionKey: conversationId,
    source: "chat",
    status: "partial",
    objective: "继续修 memory viewer 来源解释入口",
    summary: round1StopPoint,
    startedAt: "2026-04-17T14:10:00.000Z",
    createdAt: "2026-04-17T14:10:00.000Z",
    updatedAt: "2026-04-17T14:10:00.000Z",
    workRecap: {
      taskId,
      conversationId,
      sessionKey: conversationId,
      headline: `已确认 1 条执行事实；当前停在：${round1StopPoint}`,
      confirmedFacts: ["已补来源解释卡片初版"],
      pendingActions: [sharedNextStep],
      derivedFromActivityIds: ["activity-round-1"],
      updatedAt: "2026-04-17T14:10:00.000Z",
    },
    resumeContext: {
      taskId,
      conversationId,
      sessionKey: conversationId,
      currentStopPoint: round1StopPoint,
      nextStep: sharedNextStep,
      derivedFromActivityIds: ["activity-round-1"],
      updatedAt: "2026-04-17T14:10:00.000Z",
    },
  });
  store.createTaskActivity(createActivity({
    id: "activity-round-1",
    sequence: 0,
    kind: "file_changed",
    title: "已补来源解释卡片初版",
    happenedAt: "2026-04-17T14:10:00.000Z",
    files: ["apps/web/public/app/features/memory-detail-render.js"],
  }));

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => ({
      async *run(input) {
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
      id: "digest-refresh-round-1",
      method: "conversation.digest.refresh",
      params: { conversationId, force: true, threshold: 1 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "digest-refresh-round-1" && f.ok === true));

    conversationStore.addMessage(conversationId, "user", "现在继续核对多轮续做一致性。");
    conversationStore.addMessage(conversationId, "assistant", "收到，我继续。");
    store.createTaskActivity(createActivity({
      id: "activity-round-2",
      sequence: 1,
      kind: "file_changed",
      title: "已确认 prompt artifact 与请求体都带上续做注入",
      happenedAt: "2026-04-17T14:20:00.000Z",
      files: ["packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts"],
    }));
    store.updateTask(taskId, {
      summary: round2StopPoint,
      updatedAt: "2026-04-17T14:20:00.000Z",
    });

    frames.length = 0;
    ws.send(JSON.stringify({
      type: "req",
      id: "digest-refresh-round-2",
      method: "conversation.digest.refresh",
      params: { conversationId, force: true, threshold: 1 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "digest-refresh-round-2" && f.ok === true));

    frames.length = 0;
    ws.send(JSON.stringify({
      type: "req",
      id: "conversation-digest-get-multi",
      method: "conversation.digest.get",
      params: { conversationId, threshold: 1 },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "conversation-meta-multi",
      method: "conversation.meta",
      params: { conversationId },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "resume-context-multi",
      method: "memory.resume_context",
      params: { conversationId },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-digest-get-multi"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-meta-multi"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resume-context-multi"));

    const digestRes = frames.find((f) => f.type === "res" && f.id === "conversation-digest-get-multi");
    const metaRes = frames.find((f) => f.type === "res" && f.id === "conversation-meta-multi");
    const resumeRes = frames.find((f) => f.type === "res" && f.id === "resume-context-multi");

    expect(digestRes.ok).toBe(true);
    expect(digestRes.payload.digest).toMatchObject({
      conversationId,
      status: "ready",
      rollingSummary: round2StopPoint,
    });

    expect(resumeRes.ok).toBe(true);
    expect(resumeRes.payload.item.resumeContext).toMatchObject({
      currentStopPoint: round2StopPoint,
      nextStep: sharedNextStep,
    });

    expect(metaRes.ok).toBe(true);
    expect(metaRes.payload.continuationState).toMatchObject({
      targetId: conversationId,
      recommendedTargetId: conversationId,
      targetType: "conversation",
      summary: round2StopPoint,
      nextAction: sharedNextStep,
      progress: {
        current: round2StopPoint,
      },
    });
    expect(metaRes.payload.continuationState.summary).not.toBe("收到，我继续。");
    expect(metaRes.payload.continuationState.summary).toBe(resumeRes.payload.item.resumeContext.currentStopPoint);
    expect(metaRes.payload.continuationState.nextAction).toBe(resumeRes.payload.item.resumeContext.nextStep);
    expect(metaRes.payload.continuationState.summary).toContain(digestRes.payload.digest.rollingSummary);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.memory.extraction.get and conversation.memory.extract expose durable extraction runtime", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-extraction-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-v2",
  });
  const conversationId = "conv-durable-extraction";
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
    modelName: "test-durable-extraction",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  const extractionSpy = vi.spyOn(memoryManager as any, "callLLMForExtraction").mockResolvedValue([
    {
      type: "事实",
      category: "preference",
      content: "Week 8 durable extraction 已经进入独立运行时。",
      candidateType: "user",
      profilePath: "preferences.response_style",
      profileValue: "先给稳定结论，再展开说明",
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
      id: "durable-extraction-get-idle",
      method: "conversation.memory.extraction.get",
      params: { conversationId, threshold: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-extraction-get-idle"));
    const idleRes = frames.find((f) => f.type === "res" && f.id === "durable-extraction-get-idle");
    expect(idleRes.ok).toBe(true);
    expect(idleRes.payload.extraction).toMatchObject({
      conversationId,
      status: "idle",
      runCount: 0,
      pending: false,
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "durable-extraction-refresh",
      method: "conversation.digest.refresh",
      params: { conversationId, threshold: 2 },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-extraction-refresh" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "conversation.memory.extraction.updated" && f.payload?.conversationId === conversationId && f.payload?.extraction?.status === "completed"));

    const completedEvent = frames.find((f) => f.type === "event" && f.event === "conversation.memory.extraction.updated" && f.payload?.conversationId === conversationId && f.payload?.extraction?.status === "completed");
    expect(completedEvent.payload.extraction).toMatchObject({
      conversationId,
      status: "completed",
      runCount: 1,
      lastExtractedMemoryCount: 1,
    });
    expect(extractionSpy).toHaveBeenCalledTimes(1);
    expect(memoryManager.getProfileStateEntry("preferences.response_style", {
      scope: "user",
    })).toMatchObject({
      value: "先给稳定结论，再展开说明",
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "durable-extraction-get-completed",
      method: "conversation.memory.extraction.get",
      params: { conversationId, threshold: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-extraction-get-completed"));
    const completedRes = frames.find((f) => f.type === "res" && f.id === "durable-extraction-get-completed");
    expect(completedRes.ok).toBe(true);
    expect(completedRes.payload.extraction).toMatchObject({
      conversationId,
      status: "completed",
      runCount: 1,
      lastExtractedMemoryCount: 1,
      lastRunSource: "manual",
    });
    expect(completedRes.payload.extraction.lastExtractedDigestAt).toBeGreaterThan(0);

    ws.send(JSON.stringify({
      type: "req",
      id: "durable-extraction-manual",
      method: "conversation.memory.extract",
      params: { conversationId, threshold: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-extraction-manual"));
    const manualRes = frames.find((f) => f.type === "res" && f.id === "durable-extraction-manual");
    expect(manualRes.ok).toBe(true);
    expect(manualRes.payload.extraction).toMatchObject({
      conversationId,
      status: "completed",
      lastSkipReason: "up_to_date",
      runCount: 1,
    });
    expect(extractionSpy).toHaveBeenCalledTimes(1);
  } finally {
    ws.close();
    await closeP;
    extractionSpy.mockRestore();
    await server.close();
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("conversation.memory.extract uses canonical extraction view from transcript restore when meta is missing", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-extraction-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
    compaction: {
      enabled: true,
      tokenThreshold: 10,
      keepRecentCount: 1,
    },
    summarizer: async () => "rolling-summary-canonical",
  });
  const conversationId = "conv-durable-canonical";
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
    modelName: "test-durable-extraction",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  const extractSpy = vi.spyOn(memoryManager, "extractMemoriesFromConversation");
  const llmSpy = vi.spyOn(memoryManager as any, "callLLMForExtraction").mockResolvedValue([
    {
      type: "事实",
      category: "fact",
      content: "恢复视图已经成为 durable extraction 的输入。",
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
      id: "durable-canonical-extract",
      method: "conversation.memory.extract",
      params: { conversationId, threshold: 2, refreshDigest: true },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "durable-canonical-extract" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "conversation.memory.extraction.updated" && f.payload?.conversationId === conversationId && f.payload?.extraction?.status === "completed"));

    expect(extractSpy).toHaveBeenCalled();
    const extractionMessages = extractSpy.mock.calls[0]?.[1];
    expect(extractionMessages).toEqual([
      { role: "user", content: "A".repeat(80) },
      { role: "assistant", content: "B".repeat(80) },
      { role: "user", content: "C".repeat(80) },
      { role: "assistant", content: "D".repeat(80) },
    ]);
    expect(llmSpy).toHaveBeenCalled();
    expect(String(llmSpy.mock.calls[0]?.[0] ?? "")).not.toContain("Understood. I have the context from our previous conversation.");
    expect(String(llmSpy.mock.calls[0]?.[0] ?? "")).not.toContain("rolling-summary-canonical");
  } finally {
    ws.close();
    await closeP;
    extractSpy.mockRestore();
    llmSpy.mockRestore();
    await server.close();
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("workspace methods keep list/read/write behavior after async fs refactor", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  await fs.promises.mkdir(path.join(stateDir, "docs"), { recursive: true });
  await fs.promises.writeFile(path.join(stateDir, "docs", "note.md"), "# hello", "utf-8");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "workspace-list-ok", method: "workspace.list", params: { path: "docs" } }));
    ws.send(JSON.stringify({ type: "req", id: "workspace-read-ok", method: "workspace.read", params: { path: "docs/note.md" } }));
    ws.send(JSON.stringify({ type: "req", id: "workspace-write-ok", method: "workspace.write", params: { path: "docs/generated.md", content: "generated" } }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-list-ok"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-read-ok"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-write-ok"));

    const listRes = frames.find((f) => f.type === "res" && f.id === "workspace-list-ok");
    const readRes = frames.find((f) => f.type === "res" && f.id === "workspace-read-ok");
    const writeRes = frames.find((f) => f.type === "res" && f.id === "workspace-write-ok");

    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "note.md", type: "file", path: "docs/note.md" }),
    ]));
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.content).toBe("# hello");
    expect(writeRes.ok).toBe(true);
    await expect(fs.promises.readFile(path.join(stateDir, "docs", "generated.md"), "utf-8")).resolves.toBe("generated");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("workspace.write blocks secret-like content under team shared memory paths", async () => {
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
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "workspace-write-team-memory-secret",
      method: "workspace.write",
      params: {
        path: "team-memory/MEMORY.md",
        content: "共享记忆里不要存 token: ghp_123456789012345678901234567890123456",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-write-team-memory-secret"));
    const response = frames.find((f) => f.type === "res" && f.id === "workspace-write-team-memory-secret");

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("secret_detected");
    expect(response.error?.message).toContain("GitHub PAT");
    await expect(fs.promises.readFile(path.join(stateDir, "team-memory", "MEMORY.md"), "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("workspace.write blocks direct edits into protected resident state scopes", async () => {
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
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "workspace-write-sessions-blocked",
      method: "workspace.write",
      params: {
        path: "sessions/agent-default-main.md",
        content: "should not write into sessions",
      },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "workspace-write-custom-shared-blocked",
      method: "workspace.write",
      params: {
        path: "workspaces/project-b/team-memory/MEMORY.md",
        content: "should not write into custom shared memory",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-write-sessions-blocked"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-write-custom-shared-blocked"));

    const sessionsResponse = frames.find((f) => f.type === "res" && f.id === "workspace-write-sessions-blocked");
    const customSharedResponse = frames.find((f) => f.type === "res" && f.id === "workspace-write-custom-shared-blocked");

    expect(sessionsResponse.ok).toBe(false);
    expect(sessionsResponse.error?.code).toBe("protected_state_scope");
    expect(sessionsResponse.error?.message).toContain("resident sessions");

    expect(customSharedResponse.ok).toBe(false);
    expect(customSharedResponse.error?.code).toBe("protected_state_scope");
    expect(customSharedResponse.error?.message).toContain("custom workspace (project-b) shared memory scope");

    await expect(fs.promises.readFile(path.join(stateDir, "sessions", "agent-default-main.md"), "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.promises.readFile(path.join(stateDir, "workspaces", "project-b", "team-memory", "MEMORY.md"), "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("workspace.write blocks internal state file overwrites", async () => {
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
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    const originalPairing = await fs.promises.readFile(path.join(stateDir, "pairing.json"), "utf-8");

    ws.send(JSON.stringify({
      type: "req",
      id: "workspace-write-pairing-json-blocked",
      method: "workspace.write",
      params: {
        path: "pairing.json",
        content: "{\"enabled\":false}",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-write-pairing-json-blocked"));
    const response = frames.find((f) => f.type === "res" && f.id === "workspace-write-pairing-json-blocked");

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("forbidden");
    expect(response.error?.message).toContain("内部状态文件");
    await expect(fs.promises.readFile(path.join(stateDir, "pairing.json"), "utf-8")).resolves.toBe(originalPairing);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
