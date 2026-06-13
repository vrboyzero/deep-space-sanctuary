import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test, vi } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";

import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  toSafeConversationFileIdForTest,
  waitFor,
} from "./server-testkit.js";

// MemoryManager 内部会初始化 OpenAIEmbeddingProvider，需要 OPENAI_API_KEY
// 测试环境中设置一个占位值，避免构造函数抛错（不会实际调用 API）
beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

test("agents.list exposes agent name and avatar from per-agent IDENTITY.md", async () => {
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
    "- **名字：** 小码 (Coder)\n- **头像：** /avatar/coder_avatar.png\n",
    "utf-8",
  );

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
    await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
    ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
    await waitFor(() => frames.some((f) => f.type === "hello-ok"));

    ws.send(JSON.stringify({ type: "req", id: "agents-list", method: "agents.list" }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "agents-list"));

    const agentsRes = frames.find((f) => f.type === "res" && f.id === "agents-list");
    expect(agentsRes.ok).toBe(true);
    expect(agentsRes.payload?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "coder",
        displayName: "Coder",
        name: "小码 (Coder)",
        avatar: "/avatar/coder_avatar.png",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("agents.roster.get exposes resident runtime status and main conversation ids", async () => {
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
  registry.register({
    id: "verifier",
    displayName: "Verifier",
    model: "primary",
    kind: "worker",
    workspaceDir: "verifier",
  });
  const residentMemoryManagers = createScopedMemoryManagers({
    stateDir,
    agentRegistry: registry,
    modelsDir: path.join(stateDir, "models"),
    conversationStore: new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
    }),
    indexerOptions: {
      watch: false,
    },
  }).records;
  const defaultRecord = residentMemoryManagers.find((record) => record.agentId === "default");
  expect(defaultRecord).toBeTruthy();
  (defaultRecord?.manager as any)?.store.createTask({
    id: "roster-task-1",
    conversationId: "agent:default:main",
    sessionKey: "default",
    agentId: "default",
    source: "chat",
    title: "整理 resident roster 观测摘要",
    objective: "整理 resident roster 观测摘要",
    status: "success",
    summary: "已补齐 roster 所需的 resident 观测字段。",
    startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    finishedAt: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
    toolCalls: [],
    artifactPaths: [],
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    residentMemoryManagers,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
    ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
    await waitFor(() => frames.some((f) => f.type === "hello-ok"));

    ws.send(JSON.stringify({ type: "req", id: "agents-roster", method: "agents.roster.get" }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "agents-roster"));

    const rosterRes = frames.find((f) => f.type === "res" && f.id === "agents-roster");
    expect(rosterRes.ok).toBe(true);
    expect(rosterRes.payload?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "default",
        kind: "resident",
        workspaceBinding: "current",
        sessionNamespace: "default",
        memoryMode: "hybrid",
        status: "idle",
        mainConversationId: "agent:default:main",
        lastConversationId: "agent:default:main",
        memoryPolicy: expect.objectContaining({
          writeTarget: "private",
          readTargets: ["private", "shared"],
        }),
        conversationDigest: expect.objectContaining({
          status: "idle",
        }),
        recentTaskDigest: expect.objectContaining({
          recentCount: 1,
          latestStatus: "success",
        }),
        continuationState: expect.objectContaining({
          version: 1,
          scope: "resident",
          targetId: "default",
          recommendedTargetId: "agent:default:main",
          targetType: "conversation",
        }),
        observabilityBadges: expect.arrayContaining([
          "mode:hybrid",
          "write:private",
          "digest:idle",
          "task:1",
        ]),
      }),
      expect.objectContaining({
        id: "coder",
        kind: "resident",
        workspaceBinding: "current",
        sessionNamespace: "coder-main",
        memoryMode: "isolated",
        status: "idle",
        mainConversationId: "agent:coder:main",
        lastConversationId: "agent:coder:main",
        memoryPolicy: expect.objectContaining({
          writeTarget: "private",
          readTargets: ["private"],
        }),
        conversationDigest: expect.objectContaining({
          status: "idle",
        }),
      }),
    ]));
    expect(rosterRes.payload?.agents.some((item: { id?: string }) => item.id === "verifier")).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("resident agent session migrates legacy global session files into agent workspace sessions", async () => {
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

  const conversationId = "agent:coder:main";
  const safeConversationId = toSafeConversationFileIdForTest(conversationId);
  const legacyStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  legacyStore.addMessage(conversationId, "user", "legacy coder history", {
    agentId: "coder",
    channel: "webchat",
  });
  await legacyStore.waitForPendingPersistence(conversationId);

  const globalFilePath = path.join(stateDir, "sessions", `${safeConversationId}.jsonl`);
  expect(fs.existsSync(globalFilePath)).toBe(true);

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
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "resident-session-ensure-migration",
      method: "agent.session.ensure",
      params: {
        agentId: "coder",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resident-session-ensure-migration" && f.ok === true));
    const ensureRes = frames.find((f) => f.type === "res" && f.id === "resident-session-ensure-migration");
    expect(ensureRes.payload).toMatchObject({
      agentId: "coder",
      kind: "resident",
      workspaceBinding: "current",
      sessionNamespace: "coder-main",
      memoryMode: "isolated",
      conversationId,
      exists: true,
    });

    const residentFilePath = path.join(stateDir, "agents", "coder", "sessions", `${safeConversationId}.jsonl`);
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

test("agents.prompt.inspect returns prompt text and section metadata", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  const inspectAgentPrompt = vi.fn(async ({ agentId, conversationId, runId }: {
    agentId?: string;
    conversationId?: string;
    runId?: string;
  }) => ({
    scope: "run" as const,
    agentId: agentId ?? "default",
    conversationId,
    runId,
    createdAt: 123,
    displayName: "Belldandy",
    model: "primary",
    text: "system prompt body",
    truncated: false,
    totalChars: 18,
    finalChars: 18,
    sections: [
      {
        id: "core",
        label: "core",
        source: "core" as const,
        priority: 0,
        text: "system prompt body",
        charLength: 18,
        estimatedChars: 18,
        estimatedTokens: 5,
      },
    ],
    droppedSections: [],
    messages: [
      {
        role: "system",
        content: "system prompt body",
      },
    ],
    metadata: {
      includesHookSystemPrompt: true,
    },
  }));
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
    inspectAgentPrompt,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
    ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
    await waitFor(() => frames.some((f) => f.type === "hello-ok"));
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "agents-prompt-inspect",
      method: "agents.prompt.inspect",
      params: { agentId: "default", conversationId: "conv-1", runId: "run-1" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "agents-prompt-inspect"));

    const res = frames.find((f) => f.type === "res" && f.id === "agents-prompt-inspect");
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      scope: "run",
      agentId: "default",
      conversationId: "conv-1",
      runId: "run-1",
      text: "system prompt body",
      truncated: false,
      sections: [
        expect.objectContaining({
          id: "core",
          source: "core",
          charLength: 18,
          estimatedChars: 18,
          estimatedTokens: 5,
        }),
      ],
      droppedSections: [],
      messages: [
        expect.objectContaining({
          role: "system",
          content: "system prompt body",
        }),
      ],
      metadata: {
        includesHookSystemPrompt: true,
        residentStateBinding: expect.objectContaining({
          agentId: "default",
          workspaceBinding: "current",
        }),
        launchExplainability: expect.objectContaining({
          catalogDefault: expect.objectContaining({
            role: "default",
            handoffStyle: "summary",
          }),
          effectiveLaunch: expect.objectContaining({
            source: "catalog_default",
            agentId: "default",
            role: "default",
            handoffStyle: "summary",
          }),
          delegationReason: null,
        }),
      },
    });
    expect(inspectAgentPrompt).toHaveBeenCalledWith({
      agentId: "default",
      conversationId: "conv-1",
      runId: "run-1",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
