import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test, vi } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";
import { promoteResidentMemoryToShared } from "./resident-shared-memory.js";

import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import { startGatewayServer } from "./server.js";
import { approvePairingCode } from "./security/store.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function resolveWebRoot() {
  return path.join(process.cwd(), "apps", "web", "public");
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timeout");
}

async function pairWebSocketClient(ws: WebSocket, frames: any[], stateDir: string): Promise<void> {
  await waitFor(() => frames.some((frame) => frame.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
  await waitFor(() => frames.some((frame) => frame.type === "hello-ok"));
  ws.send(JSON.stringify({ type: "req", id: "pairing-init", method: "message.send", params: { text: "pairing-init" } }));
  await waitFor(() => frames.some((frame) => frame.type === "event" && frame.event === "pairing.required"));
  const pairingEvents = frames.filter((frame) => frame.type === "event" && frame.event === "pairing.required");
  const code = String(pairingEvents[pairingEvents.length - 1]?.payload?.code ?? "");
  expect(code.length).toBeGreaterThan(0);
  const approved = await approvePairingCode({ code, stateDir });
  expect(approved.ok).toBe(true);
}

test("system.doctor exposes resident memory policy summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-resident-doctor-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
    memoryMode: "hybrid",
    whenToUse: ["收口治理主线", "需要统筹多 agent"],
    methods: ["multi-agent-review.md"],
    skills: ["orchestrate-review", "resident-observability"],
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    workspaceDir: "coder",
    sessionNamespace: "coder-main",
    memoryMode: "shared",
    defaultRole: "coder",
    defaultPermissionMode: "confirm",
    methods: ["repo-debug.md"],
    skills: ["repo-map"],
    handoffStyle: "structured",
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
  const defaultSharedRecord = residentMemoryManagers.find((record) => record.memoryMode === "shared");
  expect(defaultRecord).toBeTruthy();
  expect(defaultSharedRecord).toBeTruthy();
  if (!defaultRecord || !defaultSharedRecord) {
    throw new Error("expected resident memory managers to be available");
  }
  (defaultRecord.manager as any).store.createTask({
    id: "doctor-task-1",
    conversationId: "agent:default:main",
    sessionKey: "default",
    agentId: "default",
    source: "chat",
    title: "收口 shared review 队列治理",
    objective: "收口 shared review 队列治理",
    status: "success",
    summary: "已完成 shared review reviewer workflow 的阶段收口。",
    startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    finishedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    toolCalls: [],
    artifactPaths: [],
  });
  defaultRecord.manager.upsertMemoryChunk({
    id: "doctor-pending-chunk",
    sourcePath: "memory/doctor-pending.md",
    sourceType: "manual",
    memoryType: "other",
    content: "doctor pending queue candidate",
    visibility: "private",
  });
  promoteResidentMemoryToShared({
    manager: defaultRecord.manager,
    sharedManager: defaultSharedRecord.manager,
    residentPolicy: defaultRecord.policy,
    agentId: "default",
    chunkId: "doctor-pending-chunk",
    reason: "doctor queue smoke",
  });
  defaultRecord.manager.recordMethodUsage("doctor-task-1", "governance-review-playbook.md", {
    usedVia: "tool",
  });
  defaultRecord.manager.recordSkillUsage("doctor-task-1", "shared-review-governance", {
    usedVia: "tool",
  });
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  const residentSubtask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "agent:default:main",
      agentId: "coder",
      background: false,
      instruction: "整理 resident 连续观测摘要卡",
    },
  });
  await subTaskRuntimeStore.attachSession(residentSubtask.id, "subtask-session-1", "coder");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    residentMemoryManagers,
    subTaskRuntimeStore,
  });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({ type: "req", id: "doctor-resident", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "doctor-resident"));

    const res = frames.find((frame) => frame.type === "res" && frame.id === "doctor-resident");
    expect(res.ok).toBe(true);
    expect(res.payload?.residentAgents?.summary).toMatchObject({
      totalCount: 2,
      runningCount: 0,
      idleCount: 2,
      digestIdleCount: 2,
      digestMissingCount: 0,
      memoryModeCounts: {
        shared: 1,
        hybrid: 1,
      },
      catalogAnnotatedCount: 2,
      structuredHandoffCount: 1,
      skillHintedCount: 2,
      sharedGovernanceCounts: {
        pendingCount: 1,
        claimedCount: 0,
      },
        recentTaskLinkedCount: 1,
        recentSubtaskLinkedCount: 1,
        experienceUsageLinkedCount: 1,
      });
    expect(res.payload?.residentAgents?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "default",
        conversationDigest: expect.objectContaining({
          status: "idle",
        }),
        recentTaskDigest: expect.objectContaining({
          recentCount: 1,
          latestStatus: "success",
        }),
        recentSubtaskDigest: expect.objectContaining({
          recentCount: 1,
          latestTaskId: residentSubtask.id,
          latestStatus: "running",
        }),
        experienceUsageDigest: expect.objectContaining({
          usageCount: 2,
          methodCount: 1,
          skillCount: 1,
          latestTaskId: "doctor-task-1",
        }),
        observabilityBadges: expect.arrayContaining([
          "mode:hybrid",
          "write:private",
          "handoff:summary",
          "methods:1",
          "skills:2",
          "digest:idle",
          "review:1",
          "task:1",
          "subtask:1",
          "usage:2",
        ]),
        catalog: expect.objectContaining({
          handoffStyle: "summary",
          methods: ["multi-agent-review.md"],
          skills: ["orchestrate-review", "resident-observability"],
          whenToUse: ["收口治理主线", "需要统筹多 agent"],
        }),
        launchExplainability: expect.objectContaining({
          catalogDefault: expect.objectContaining({
            role: "default",
            handoffStyle: "summary",
            methods: ["multi-agent-review.md"],
            skills: ["orchestrate-review", "resident-observability"],
            whenToUse: ["收口治理主线", "需要统筹多 agent"],
          }),
          effectiveLaunch: expect.objectContaining({
            source: "catalog_default",
            agentId: "default",
            profileId: "default",
            role: "default",
            handoffStyle: "summary",
          }),
        }),
        sharedGovernance: expect.objectContaining({
          pendingCount: 1,
        }),
      }),
      expect.objectContaining({
        id: "coder",
        sessionNamespace: "coder-main",
        memoryMode: "shared",
        catalog: expect.objectContaining({
          defaultRole: "coder",
          defaultPermissionMode: "confirm",
          methods: ["repo-debug.md"],
          skills: ["repo-map"],
          handoffStyle: "structured",
        }),
        launchExplainability: expect.objectContaining({
          catalogDefault: expect.objectContaining({
            role: "coder",
            permissionMode: "confirm",
            handoffStyle: "structured",
            methods: ["repo-debug.md"],
            skills: ["repo-map"],
          }),
          effectiveLaunch: expect.objectContaining({
            source: "catalog_default",
            agentId: "coder",
            profileId: "coder",
            role: "coder",
            permissionMode: "confirm",
            handoffStyle: "structured",
          }),
        }),
        conversationDigest: expect.objectContaining({
          status: "idle",
        }),
        memoryPolicy: expect.objectContaining({
          writeTarget: "shared",
          readTargets: ["shared"],
        }),
      }),
    ]));

    frames.length = 0;
    ws.send(JSON.stringify({ type: "req", id: "resident-roster", method: "agents.roster.get", params: {} }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "resident-roster"));
    const rosterRes = frames.find((frame) => frame.type === "res" && frame.id === "resident-roster");
    expect(rosterRes.ok).toBe(true);
    expect(rosterRes.payload?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "default",
        catalog: expect.objectContaining({
          handoffStyle: "summary",
          methods: ["multi-agent-review.md"],
          skills: ["orchestrate-review", "resident-observability"],
        }),
        recentSubtaskDigest: expect.objectContaining({
          latestTaskId: residentSubtask.id,
        }),
        experienceUsageDigest: expect.objectContaining({
          latestTaskId: "doctor-task-1",
          methodCount: 1,
          skillCount: 1,
        }),
      }),
      expect.objectContaining({
        id: "coder",
        catalog: expect.objectContaining({
          defaultRole: "coder",
          defaultPermissionMode: "confirm",
          handoffStyle: "structured",
          methods: ["repo-debug.md"],
          skills: ["repo-map"],
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

test("agents.prompt.inspect can surface resident profile and memory policy metadata", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-resident-inspect-"));
  const registry = new AgentRegistry(() => new MockAgent());
  const inspectAgentPrompt = vi.fn(async () => ({
    scope: "run" as const,
    agentId: "coder",
    conversationId: "agent:coder:main",
    runId: "run-1",
    createdAt: 123,
    displayName: "Coder",
    model: "primary",
    text: "system prompt body",
    truncated: false,
    totalChars: 18,
    finalChars: 18,
    sections: [],
    droppedSections: [],
    messages: [],
    metadata: {
      residentProfile: {
        memoryMode: "hybrid",
        workspaceBinding: "current",
        sessionNamespace: "coder-main",
      },
      memoryPolicy: {
        writeTarget: "private",
        readTargets: ["private", "shared"],
      },
    },
  }));
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
    sessionNamespace: "coder-main",
    memoryMode: "hybrid",
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
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "inspect-resident",
      method: "agents.prompt.inspect",
      params: { agentId: "coder", conversationId: "agent:coder:main", runId: "run-1" },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "inspect-resident"));

    const res = frames.find((frame) => frame.type === "res" && frame.id === "inspect-resident");
    expect(res.ok).toBe(true);
    expect(res.payload?.metadata).toMatchObject({
      residentProfile: {
        memoryMode: "hybrid",
        sessionNamespace: "coder-main",
      },
      memoryPolicy: {
        writeTarget: "private",
        readTargets: ["private", "shared"],
      },
      residentStateBinding: {
        agentId: "coder",
        workspaceBinding: "current",
        workspaceDir: "coder",
        scopeStateDir: stateDir,
        privateStateDir: path.join(stateDir, "agents", "coder"),
        sessionsDir: path.join(stateDir, "agents", "coder", "sessions"),
        sharedStateDir: path.join(stateDir, "team-memory"),
      },
      launchExplainability: expect.objectContaining({
        catalogDefault: expect.objectContaining({
          role: "default",
          handoffStyle: "summary",
        }),
        effectiveLaunch: expect.objectContaining({
          source: "catalog_default",
          agentId: "coder",
          role: "default",
          handoffStyle: "summary",
        }),
      }),
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
