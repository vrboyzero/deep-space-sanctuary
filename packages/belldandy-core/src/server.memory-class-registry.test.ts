import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";
import { MemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";

import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";
import { handleMemoryExperienceMethod } from "./server-methods/memory-experience.js";

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

test("system.doctor exposes memory class registry and classed signal coverage", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-class-doctor-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-class-doctor-workspace-"));
  await fs.promises.mkdir(path.join(stateDir, "team-memory"), { recursive: true });
  await fs.promises.mkdir(path.join(stateDir, "team-memory", "memory"), { recursive: true });
  await fs.promises.mkdir(path.join(stateDir, "dreams"), { recursive: true });
  await fs.promises.writeFile(path.join(stateDir, "USER.md"), "# USER\n**名字：** 小星\n偏好简洁状态表与短结论。\n", "utf-8");
  await fs.promises.writeFile(path.join(stateDir, "MEMORY.md"), "# MEMORY\n优先把大文件里的主体逻辑外移。\n", "utf-8");
  await fs.promises.writeFile(path.join(stateDir, "team-memory", "MEMORY.md"), "# Shared Memory\n团队约定：外发统一走 sessionKey / binding。\n", "utf-8");
  await fs.promises.mkdir(path.join(stateDir, "sessions"), { recursive: true });
  await fs.promises.writeFile(path.join(stateDir, "sessions", "conv-1.jsonl"), "{\"role\":\"user\",\"content\":\"hello\"}\n", "utf-8");

  const globalMemoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  registerGlobalMemoryManager(globalMemoryManager);

  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
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
  (defaultRecord?.manager as any)?.store.upsertChunk({
    id: "mind-private-1",
    sourcePath: "MEMORY.md",
    sourceType: "file",
    memoryType: "core",
    content: "优先把大文件里的主体逻辑外移，server.ts 只做装配。",
    agentId: "default",
    visibility: "private",
  });
  (defaultRecord?.manager as any)?.store.upsertChunk({
    id: "mind-shared-1",
    sourcePath: "team-memory/MEMORY.md",
    sourceType: "file",
    memoryType: "core",
    content: "团队约定：外发统一走 sessionKey / binding。",
    visibility: "shared",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    residentMemoryManagers,
    additionalWorkspaceRoots: [workspaceRoot],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    ws.send(JSON.stringify({
      type: "req",
      id: "doctor-memory-class-registry",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "doctor-memory-class-registry"));
    const response = frames.find((frame) => frame.type === "res" && frame.id === "doctor-memory-class-registry");
    expect(response?.ok).toBe(true);
    expect(response?.payload?.memoryClassCoverage).toMatchObject({
      availableCount: expect.any(Number),
      partialCount: expect.any(Number),
      missingCount: expect.any(Number),
      headline: expect.stringContaining("profile="),
    });
    expect(response?.payload?.memoryClassRegistry?.summary).toMatchObject({
      classCount: 5,
      bindingCount: expect.any(Number),
    });
    expect(response?.payload?.memoryClassSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "profile_semantic",
        status: "available",
      }),
      expect.objectContaining({
        memoryClass: "project_semantic",
        status: "partial",
      }),
      expect.objectContaining({
        memoryClass: "governance",
        status: "available",
      }),
    ]));
    expect(response?.payload?.learningReviewInput?.memoryClassSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "profile_semantic",
        status: "available",
      }),
      expect.objectContaining({
        memoryClass: "project_semantic",
        status: "missing",
      }),
    ]));
    expect(response?.payload?.learningReviewInput?.memoryFreshness).toMatchObject({
      summary: {
        available: true,
      },
    });
    expect(response?.payload?.memoryFreshness).toMatchObject({
      summary: {
        available: true,
        headline: expect.stringContaining("profile="),
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          memoryClass: "profile_semantic",
        }),
      ]),
    });
    expect(response?.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_class_registry",
        status: "pass",
      }),
      expect.objectContaining({
        id: "memory_freshness",
        name: "Memory Freshness",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    globalMemoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 15_000);

test("memory experience surfaces expose classed signals for task and governance views", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-class-rpc-"));
  const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-class-rpc-external-"));
  const workspaceRoot = path.join(stateDir, "sessions");
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    await fs.promises.mkdir(path.join(stateDir, "memory"), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceRoot, "conv-1.jsonl"), "{\"role\":\"user\",\"content\":\"hello\"}\n", "utf-8");
    await fs.promises.writeFile(path.join(stateDir, "MEMORY.md"), "# Core Memory\n", "utf-8");
    await fs.promises.writeFile(path.join(externalDir, "kb.md"), "# External KB\n", "utf-8");

    (memoryManager as any).store.createTask({
      id: "task-class-view-1",
      conversationId: "conv-1",
      sessionKey: "conv-1",
      source: "chat",
      status: "partial",
      title: "查看 classed task payload",
      summary: "需要验证 task/get 返回显式 classed signals。",
      workRecap: {
        taskId: "task-class-view-1",
        conversationId: "conv-1",
        sessionKey: "conv-1",
        headline: "任务已进入 classed signals 验证阶段",
        confirmedFacts: ["已补 contract 与 binding registry。"],
        derivedFromActivityIds: [],
        updatedAt: "2026-06-11T15:00:00.000Z",
      },
      resumeContext: {
        taskId: "task-class-view-1",
        conversationId: "conv-1",
        sessionKey: "conv-1",
        currentStopPoint: "等待验证 task/get 和 inventory.preview 输出。",
        nextStep: "检查 memoryClassSignals / memoryClassCoverage。",
        derivedFromActivityIds: [],
        updatedAt: "2026-06-11T15:01:00.000Z",
      },
      startedAt: "2026-06-11T15:00:00.000Z",
      finishedAt: "2026-06-11T15:05:00.000Z",
      createdAt: "2026-06-11T15:00:00.000Z",
      updatedAt: "2026-06-11T15:05:00.000Z",
    });
    const methodCandidate = memoryManager.promoteTaskToMethodCandidate("task-class-view-1");
    expect(methodCandidate?.candidate?.id).toBeTruthy();
    registerGlobalMemoryManager(memoryManager);

    const taskRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-task-class-view",
      method: "memory.task.get",
      params: {
        taskId: "task-class-view-1",
      },
    }, { stateDir });
    expect(taskRes).toBeTruthy();
    if (!taskRes || !taskRes.ok) {
      throw new Error("expected successful memory.task.get response");
    }
    const taskPayload = taskRes.payload as any;
    expect(taskPayload?.memoryClassCoverage).toMatchObject({
      availableCount: 1,
      headline: expect.stringContaining("task=available"),
    });
    expect(taskPayload?.memoryClassSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "episodic_task",
        status: "available",
      }),
    ]));
    expect(taskPayload?.memoryFreshness).toMatchObject({
      summary: {
        available: true,
        headline: expect.stringContaining("task="),
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          memoryClass: "episodic_task",
        }),
      ]),
    });

    const inventoryRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-inventory-class-view",
      method: "memory.inventory.preview",
      params: {
        configuredSources: [
          {
            label: "Obsidian Vault",
            sourceClass: "curated",
            rootPath: externalDir,
            recursive: true,
            fileExtensions: [".md"],
          },
        ],
      },
    }, { stateDir });
    expect(inventoryRes).toBeTruthy();
    if (!inventoryRes || !inventoryRes.ok) {
      throw new Error("expected successful memory.inventory.preview response");
    }
    const inventoryPayload = inventoryRes.payload as any;
    expect(inventoryPayload?.memoryClassCoverage).toMatchObject({
      availableCount: 1,
      partialCount: 1,
      headline: expect.stringContaining("governance=available"),
    });
    expect(inventoryPayload?.memoryClassSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "governance",
        status: "available",
      }),
      expect.objectContaining({
        memoryClass: "project_semantic",
        status: "partial",
      }),
    ]));
    expect(inventoryPayload?.memoryClassRegistry?.summary).toMatchObject({
      classCount: 2,
    });
    expect(inventoryPayload?.memoryFreshness).toMatchObject({
      summary: {
        available: true,
        headline: expect.stringContaining("project="),
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          memoryClass: "project_semantic",
        }),
        expect.objectContaining({
          memoryClass: "governance",
        }),
      ]),
    });

    const inventoryReportRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-inventory-report-freshness",
      method: "memory.tree.report.inventory.preview",
      params: {
        configuredSources: [
          {
            label: "Obsidian Vault",
            sourceClass: "curated",
            rootPath: externalDir,
            recursive: true,
            fileExtensions: [".md"],
          },
        ],
      },
    }, { stateDir });
    expect(inventoryReportRes).toBeTruthy();
    if (!inventoryReportRes || !inventoryReportRes.ok) {
      throw new Error("expected successful memory.tree.report.inventory.preview response");
    }
    const inventoryReportPayload = inventoryReportRes.payload as any;
    expect(inventoryReportPayload?.memoryFreshness).toMatchObject({
      summary: {
        available: true,
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          memoryClass: "governance",
          status: "review_required",
        }),
      ]),
    });

    const candidateRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-candidate-freshness",
      method: "experience.candidate.get",
      params: {
        candidateId: methodCandidate!.candidate.id,
      },
    }, { stateDir });
    expect(candidateRes).toBeTruthy();
    if (!candidateRes || !candidateRes.ok) {
      throw new Error("expected successful experience.candidate.get response");
    }
    const candidatePayload = candidateRes.payload as any;
    expect(candidatePayload?.memoryFreshness).toMatchObject({
      summary: {
        available: true,
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          memoryClass: "procedural_experience",
          status: "review_required",
        }),
      ]),
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(externalDir, { recursive: true, force: true }).catch(() => {});
  }
});
