import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";
import { MemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";
import { SkillRegistry } from "@belldandy/skills";

import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import { startGatewayServer } from "./server.js";
import {
  handleMemoryExperienceMethod,
  selectExperienceSynthesisPreviewItems,
} from "./server-methods/memory-experience.js";
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

async function writeExperienceSynthesisTestTemplate(stateDir: string, type: "method" | "skill"): Promise<void> {
  const templatesDir = path.join(stateDir, "experience-templates");
  await fs.promises.mkdir(templatesDir, { recursive: true });
  const fileName = type === "skill" ? "skill-synthesis.md" : "method-synthesis.md";
  const content = type === "skill"
    ? "# Skill Synthesis Template"
    : "# Method Synthesis Template";
  await fs.promises.writeFile(path.join(templatesDir, fileName), content, "utf-8");
}

function buildValidSynthesizedMethodContent(title: string, summary: string): string {
  return [
    `# ${title}`,
    "",
    `> ${summary}`,
    "",
    "## 0. 元信息",
    "- 方法定位：测试合成方法",
    "- 适用对象：测试环境",
    "- 维护建议：按需更新",
    "",
    "## 1. 触发条件",
    "- 需要把多个近似 method draft 合并为一个更完整的候选。",
    "",
    "## 2. 适用场景",
    "- 同类型草稿大量重复且信息分散时。",
    "",
    "## 3. 执行步骤",
    "1. 汇总相似草稿。",
    "2. 抽取稳定共性。",
    "3. 输出结构化新草稿。",
    "",
    "## 4. 工具选择",
    "- 首选工具：主模型",
    "- 替代工具：人工整理",
    "- 选择依据：需要更强的综合归纳能力。",
    "",
    "## 5. 失败经验",
    "- 常见误区：直接拼贴原文。",
    "- 失败信号：结构混乱、重复过多。",
    "- 规避方式：按统一模板重写。",
    "",
    "## 6. 成功案例",
    "- 案例背景：同类草稿堆积。",
    "- 做法摘要：归纳后输出新 draft。",
    "- 结果与启示：审批体验更顺畅。",
    "",
    "## 7. 相关资源",
    "- 相关技能：draft synthesis",
    "- 相关方法：candidate merge",
    "- 相关文档 / 路径：docs/experience-templates/method-synthesis.md",
    "",
    "## 8. 更新记录",
    "- 2026-05-02：测试生成初版。",
  ].join("\n");
}

function buildValidSynthesizedSkillContent(title: string, name: string, description: string): string {
  return [
    "---",
    `name: \"${name}\"`,
    `description: \"${description}\"`,
    "---",
    "",
    `# ${title}`,
    "",
    "## 快速开始",
    "- 使用前先确认目标任务与输入边界。",
    "",
    "## 决策路由",
    "- 需要复用已发布 skill 时优先从已发布资产开始再合成。",
    "",
    "## 输入",
    "- 输入目标、上下文与现有 skill 线索。",
    "",
    "## 输出",
    "- 输出新的 skill draft，不直接覆盖已发布文件。",
    "",
    "## 参考指引",
    "- 参考已发布 skill、相关 task 复盘与模板约束。",
    "",
    "## NEVER",
    "- 不要直接拼贴旧 skill 内容。",
  ].join("\n");
}

test("memory.share.queue supports centralized claim and review across resident agents", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-shared-review-queue-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
    memoryMode: "hybrid",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    workspaceDir: "coder",
    sessionNamespace: "coder-main",
    memoryMode: "isolated",
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
  if (!defaultRecord) {
    throw new Error("default resident memory manager is required");
  }
  defaultRecord.manager.upsertMemoryChunk({
    id: "shared-review-chunk",
    sourcePath: "memory/shared-review.md",
    sourceType: "manual",
    memoryType: "other",
    content: "shared review queue smoke",
    visibility: "private",
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
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "share-promote",
      method: "memory.share.promote",
      params: {
        agentId: "default",
        chunkId: "shared-review-chunk",
        reason: "queue smoke",
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-promote"));

    const promoteRes = frames.find((frame) => frame.type === "res" && frame.id === "share-promote");
    expect(promoteRes.ok).toBe(true);

    ws.send(JSON.stringify({
      type: "req",
      id: "share-queue-pending",
      method: "memory.share.queue",
      params: {
        reviewerAgentId: "coder",
        filter: { sharedPromotionStatus: "pending" },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-queue-pending"));

    const queueRes = frames.find((frame) => frame.type === "res" && frame.id === "share-queue-pending");
    expect(queueRes.ok).toBe(true);
    expect(queueRes.payload?.summary).toMatchObject({
      pendingCount: 1,
      reviewerAgentId: "coder",
      reviewerActionableCount: 1,
    });
    expect(queueRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "shared-review-chunk",
        targetAgentId: "default",
        reviewStatus: "pending",
        actionableByReviewer: true,
      }),
    ]));

    ws.send(JSON.stringify({
      type: "req",
      id: "share-claim",
      method: "memory.share.claim",
      params: {
        reviewerAgentId: "coder",
        targetAgentId: "default",
        chunkId: "shared-review-chunk",
        action: "claim",
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-claim"));
    const claimRes = frames.find((frame) => frame.type === "res" && frame.id === "share-claim");
    expect(claimRes.ok).toBe(true);
    expect(claimRes.payload).toMatchObject({
      reviewerAgentId: "coder",
      targetAgentId: "default",
      claimedCount: 1,
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "share-queue-claimed",
      method: "memory.share.queue",
      params: {
        reviewerAgentId: "coder",
        filter: { sharedPromotionStatus: "pending" },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-queue-claimed"));
    const claimedQueueRes = frames.find((frame) => frame.type === "res" && frame.id === "share-queue-claimed");
    expect(claimedQueueRes.ok).toBe(true);
    expect(claimedQueueRes.payload?.summary).toMatchObject({
      pendingCount: 1,
      claimedCount: 1,
      reviewerClaimedCount: 1,
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "share-approve",
      method: "memory.share.review",
      params: {
        reviewerAgentId: "coder",
        targetAgentId: "default",
        chunkId: "shared-review-chunk",
        decision: "approved",
        note: "queue approved",
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-approve"));
    const approveRes = frames.find((frame) => frame.type === "res" && frame.id === "share-approve");
    expect(approveRes.ok).toBe(true);
    expect(approveRes.payload).toMatchObject({
      reviewerAgentId: "coder",
      targetAgentId: "default",
      reviewedCount: 1,
      decision: "approved",
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "share-queue-approved",
      method: "memory.share.queue",
      params: {
        reviewerAgentId: "coder",
        filter: { sharedPromotionStatus: "approved" },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-queue-approved"));
    const approvedQueueRes = frames.find((frame) => frame.type === "res" && frame.id === "share-queue-approved");
    expect(approvedQueueRes.ok).toBe(true);
    expect(approvedQueueRes.payload?.summary).toMatchObject({
      approvedCount: 1,
    });
    expect(approvedQueueRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "shared-review-chunk",
        targetAgentId: "default",
        reviewStatus: "approved",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.generate creates candidates and respects confirmation env", async () => {
  const previousMethodConfirm = process.env.BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED;
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-generate-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-generate-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-generate-1",
    conversationId: "conv-generate-1",
    sessionKey: "session-generate-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "生成经验候选",
    objective: "验证生成 RPC",
    summary: "任务包含足够的经验沉淀信号。",
    reflection: "先验证确认门禁，再验证生成与复用。",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 80 }],
    artifactPaths: ["docs/demo.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  registerGlobalMemoryManager(memoryManager);

  try {
    process.env.BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED = "true";
    const blockedRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-generate-blocked",
      method: "experience.candidate.generate",
      params: { taskId: "task-generate-1", candidateType: "method", agentId: "default" },
    }, { stateDir });
    expect(blockedRes).toBeTruthy();
    if (!blockedRes || blockedRes.ok) {
      throw new Error("expected confirmation_required response");
    }
    expect(blockedRes.ok).toBe(false);
    expect(blockedRes.error.code).toBe("confirmation_required");

    process.env.BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED = "false";
    const createdRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-generate-created",
      method: "experience.candidate.generate",
      params: { taskId: "task-generate-1", candidateType: "method", agentId: "default" },
    }, { stateDir });
    expect(createdRes).toBeTruthy();
    if (!createdRes || !createdRes.ok) {
      throw new Error("expected successful candidate generation response");
    }
    const createdCandidate = (createdRes.payload?.candidate ?? {}) as Record<string, any>;
    expect(createdRes.ok).toBe(true);
    expect(createdRes.payload?.created).toBe(true);
    expect(createdCandidate.type).toBe("method");
    expect(createdCandidate.status).toBe("draft");

    const reusedRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-generate-reused",
      method: "experience.candidate.generate",
      params: { taskId: "task-generate-1", candidateType: "method", agentId: "default" },
    }, { stateDir });
    expect(reusedRes).toBeTruthy();
    if (!reusedRes || !reusedRes.ok) {
      throw new Error("expected reused candidate generation response");
    }
    const reusedCandidate = (reusedRes.payload?.candidate ?? {}) as Record<string, any>;
    expect(reusedRes.ok).toBe(true);
    expect(reusedRes.payload?.reusedExisting).toBe(true);
    expect(reusedCandidate.id).toBe(createdCandidate.id);
  } finally {
    if (previousMethodConfirm === undefined) {
      delete process.env.BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED;
    } else {
      process.env.BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED = previousMethodConfirm;
    }
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.accept allows explicit confirmed flag when publish confirmation is enabled", async () => {
  const previousMethodPublishConfirm = process.env.BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED;
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-accept-confirm-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-accept-confirm-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-accept-confirm-1",
    conversationId: "conv-accept-confirm-1",
    sessionKey: "session-accept-confirm-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "确认发布 method 候选",
    objective: "验证 accept confirmed 参数",
    summary: "需要在确认门禁开启时仍能完成手动确认发布。",
    reflection: "WebChat 按钮本身就是一次明确的人类确认动作。",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 40 }],
    artifactPaths: [],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const promoted = memoryManager.promoteTaskToMethodCandidate("task-accept-confirm-1");
  expect(promoted?.candidate.id).toBeTruthy();
  registerGlobalMemoryManager(memoryManager);

  try {
    process.env.BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED = "true";

    const blockedRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-accept-blocked",
      method: "experience.candidate.accept",
      params: {
        candidateId: promoted!.candidate.id,
        agentId: "default",
      },
    }, { stateDir });
    expect(blockedRes).toBeTruthy();
    if (!blockedRes || blockedRes.ok) {
      throw new Error("expected confirmation_required response");
    }
    expect(blockedRes.error.code).toBe("confirmation_required");

    const confirmedRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-accept-confirmed",
      method: "experience.candidate.accept",
      params: {
        candidateId: promoted!.candidate.id,
        agentId: "default",
        confirmed: true,
      },
    }, { stateDir });
    expect(confirmedRes).toBeTruthy();
    if (!confirmedRes || !confirmedRes.ok) {
      throw new Error("expected successful confirmed accept response");
    }
    const confirmedCandidate = (confirmedRes.payload?.candidate ?? {}) as Record<string, unknown>;
    expect(confirmedCandidate.status).toBe("accepted");
  } finally {
    if (previousMethodPublishConfirm === undefined) {
      delete process.env.BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED;
    } else {
      process.env.BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED = previousMethodPublishConfirm;
    }
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.reject_bulk rejects all draft candidates for a type and refreshes stats", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-reject-bulk-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-reject-bulk-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const createTask = (taskId: string, title: string) => {
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title,
      objective: `${title} objective`,
      summary: `${title} summary`,
      reflection: `${title} reflection`,
      toolCalls: [{ toolName: "memory_search", success: true, durationMs: 30 }],
      artifactPaths: [],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };

  createTask("task-reject-bulk-method-1", "Method Draft One");
  createTask("task-reject-bulk-method-2", "Method Draft Two");
  createTask("task-reject-bulk-skill-1", "Skill Draft One");
  const methodOne = memoryManager.promoteTaskToMethodCandidate("task-reject-bulk-method-1");
  const methodTwo = memoryManager.promoteTaskToMethodCandidate("task-reject-bulk-method-2");
  const skillOne = memoryManager.promoteTaskToSkillCandidate("task-reject-bulk-skill-1");
  expect(methodOne?.candidate.id).toBeTruthy();
  expect(methodTwo?.candidate.id).toBeTruthy();
  expect(skillOne?.candidate.id).toBeTruthy();
  registerGlobalMemoryManager(memoryManager);

  try {
    const rejectBulkRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-reject-bulk",
      method: "experience.candidate.reject_bulk",
      params: {
        agentId: "default",
        filter: {
          type: "method",
        },
      },
    }, { stateDir });
    expect(rejectBulkRes).toBeTruthy();
    if (!rejectBulkRes || !rejectBulkRes.ok) {
      throw new Error("expected successful reject_bulk response");
    }
    expect(rejectBulkRes.payload?.count).toBe(2);

    const statsRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-stats",
      method: "experience.candidate.stats",
      params: {
        agentId: "default",
      },
    }, { stateDir });
    expect(statsRes).toBeTruthy();
    if (!statsRes || !statsRes.ok) {
      throw new Error("expected successful stats response");
    }
    expect(statsRes.payload?.stats).toMatchObject({
      total: 3,
      methods: 2,
      skills: 1,
      draft: 1,
      accepted: 0,
      rejected: 2,
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.asset.list returns published method and skill assets", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-asset-list-"));
  const methodsDir = path.join(stateDir, "methods");
  const skillDir = path.join(stateDir, "skills", "published-skill");
  await fs.promises.mkdir(methodsDir, { recursive: true });
  await fs.promises.mkdir(skillDir, { recursive: true });
  await fs.promises.writeFile(path.join(methodsDir, "published-method.md"), [
    "---",
    "summary: \"Published method summary\"",
    "---",
    "",
    "# Published Method",
    "",
    "Method body",
  ].join("\n"), "utf-8");
  await fs.promises.writeFile(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: \"published-skill\"",
    "description: \"Published skill summary\"",
    "---",
    "",
    "# Published Skill",
    "",
    "Skill body",
  ].join("\n"), "utf-8");

  try {
    const listRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "experience-asset-list",
      method: "experience.asset.list",
      params: {
        agentId: "default",
        limit: 10,
      },
    }, { stateDir });

    expect(listRes).toBeTruthy();
    if (!listRes || !listRes.ok) {
      throw new Error("expected successful asset list response");
    }

    expect(listRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "method_asset",
        type: "method",
        key: "published-method.md",
        title: "Published Method",
        summary: "Published method summary",
        publishedPath: path.join(methodsDir, "published-method.md"),
      }),
      expect.objectContaining({
        source: "skill_asset",
        type: "skill",
        key: "published-skill",
        title: "Published Skill",
        summary: "Published skill summary",
        publishedPath: path.join(skillDir, "SKILL.md"),
        metadata: expect.objectContaining({
          name: "published-skill",
          description: "Published skill summary",
        }),
      }),
    ]));
  } finally {
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.cleanup_consumed deletes only consumed draft candidates", async () => {
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "star-sanctuary-exp-cleanup-"));
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "star-sanctuary-exp-cleanup-state-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  const now = new Date().toISOString();
  const createTask = (taskId: string, title: string) => {
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      title,
      source: "chat",
      status: "success",
      objective: `${title} objective`,
      summary: `${title} summary`,
      reflection: `${title} reflection`,
      toolCalls: [{ toolName: "memory_search", success: true, durationMs: 30 }],
      artifactPaths: [],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };
  const debugLogs: Array<{ message: string; data?: unknown }> = [];

  createTask("task-cleanup-consumed-1", "Consumed Draft");
  createTask("task-cleanup-active-1", "Active Draft");
  createTask("task-cleanup-accepted-1", "Accepted Draft");
  const consumedDraft = memoryManager.promoteTaskToMethodCandidate("task-cleanup-consumed-1")?.candidate;
  const activeDraft = memoryManager.promoteTaskToMethodCandidate("task-cleanup-active-1")?.candidate;
  const acceptedDraft = memoryManager.promoteTaskToMethodCandidate("task-cleanup-accepted-1")?.candidate;
  expect(consumedDraft?.id).toBeTruthy();
  expect(activeDraft?.id).toBeTruthy();
  expect(acceptedDraft?.id).toBeTruthy();
  if (!consumedDraft?.id || !activeDraft?.id || !acceptedDraft?.id) {
    throw new Error("expected cleanup candidates to be created");
  }

  memoryManager.markExperienceCandidatesSynthesisConsumed({
    candidateIds: [String(consumedDraft.id)],
    consumedByCandidateId: "exp_synth_demo",
    consumedAt: now,
    consumedRunId: "cleanup-demo",
  });
  memoryManager.acceptExperienceCandidate(String(acceptedDraft.id));
  registerGlobalMemoryManager(memoryManager);

  try {
    const cleanupRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-cleanup-consumed",
      method: "experience.candidate.cleanup_consumed",
      params: {
        agentId: "default",
      },
    }, {
      stateDir,
      logger: {
        debug: (message, data) => {
          debugLogs.push({ message, data });
        },
      },
    });
    expect(cleanupRes).toBeTruthy();
    if (!cleanupRes || !cleanupRes.ok) {
      throw new Error("expected successful cleanup_consumed response");
    }
    expect(cleanupRes.payload?.count).toBe(1);
    expect(debugLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Experience consumed draft cleanup completed",
        data: expect.objectContaining({
          count: 1,
          filter: expect.objectContaining({
            status: "draft",
            synthesisConsumed: true,
          }),
        }),
      }),
    ]));

    const listRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-list-after-cleanup",
      method: "experience.candidate.list",
      params: {
        agentId: "default",
        limit: 10,
      },
    }, { stateDir });
    expect(listRes).toBeTruthy();
    if (!listRes || !listRes.ok) {
      throw new Error("expected successful list response after cleanup");
    }
    const remainingIds = Array.isArray(listRes.payload?.items)
      ? listRes.payload.items.map((item: any) => String(item?.id || ""))
      : [];
    expect(remainingIds).not.toContain(String(consumedDraft.id));
    expect(remainingIds).toContain(String(activeDraft.id));
    expect(remainingIds).toContain(String(acceptedDraft.id));
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience synthesis selection prioritizes same_family and backfills similar", () => {
  const selection = selectExperienceSynthesisPreviewItems([
    {
      candidateId: "similar-a",
      type: "method",
      status: "draft",
      title: "Similar A",
      slug: "similar-a",
      taskId: "task-similar-a",
      score: 0.7,
      relation: "similar",
    },
    {
      candidateId: "same-b",
      type: "method",
      status: "draft",
      title: "Same B",
      slug: "same-b",
      taskId: "task-same-b",
      score: 0.91,
      relation: "same_family",
    },
    {
      candidateId: "similar-c",
      type: "method",
      status: "draft",
      title: "Similar C",
      slug: "similar-c",
      taskId: "task-similar-c",
      score: 0.69,
      relation: "similar",
    },
    {
      candidateId: "same-d",
      type: "method",
      status: "draft",
      title: "Same D",
      slug: "same-d",
      taskId: "task-same-d",
      score: 0.88,
      relation: "same_family",
    },
    {
      candidateId: "similar-e",
      type: "method",
      status: "draft",
      title: "Similar E",
      slug: "similar-e",
      taskId: "task-similar-e",
      score: 0.65,
      relation: "similar",
    },
  ], 4);

  expect(selection.sameFamilyCount).toBe(2);
  expect(selection.similarCount).toBe(3);
  expect(selection.selectedSameFamilyCount).toBe(2);
  expect(selection.selectedSimilarCount).toBe(2);
  expect(selection.selectedItems.map((item) => item.candidateId)).toEqual([
    "same-b",
    "same-d",
    "similar-a",
    "similar-c",
  ]);
});

test("experience synthesis preview and create log warn details for early invalid requests", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-log-invalid-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-log-invalid-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  registerGlobalMemoryManager(memoryManager);
  const warnLogs: Array<{ message: string; data?: unknown }> = [];

  try {
    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-preview-missing-id",
      method: "experience.candidate.synthesize.preview",
      params: {
        agentId: "default",
      },
    }, {
      stateDir,
      logger: {
        warn: (message, data) => {
          warnLogs.push({ message, data });
        },
      },
    });

    expect(previewRes?.ok).toBe(false);
    if (!previewRes || previewRes.ok) {
      throw new Error("expected preview request to fail");
    }
    expect(previewRes.error?.code).toBe("invalid_params");

    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-create-missing-id",
      method: "experience.candidate.synthesize.create",
      params: {
        agentId: "default",
      },
    }, {
      stateDir,
      logger: {
        warn: (message, data) => {
          warnLogs.push({ message, data });
        },
      },
    });

    expect(createRes?.ok).toBe(false);
    if (!createRes || createRes.ok) {
      throw new Error("expected create request to fail");
    }
    expect(createRes.error?.code).toBe("invalid_params");
    expect(warnLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Experience synthesis preview rejected because candidateId is missing",
      }),
      expect.objectContaining({
        message: "Experience synthesis create rejected because candidateId is missing",
      }),
    ]));
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience synthesis preview rejects methods/skills directory assetPath with a clear message", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-asset-dir-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-asset-dir-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  registerGlobalMemoryManager(memoryManager);

  try {
    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-preview-asset-dir",
      method: "experience.candidate.synthesize.preview",
      params: {
        assetPath: path.join(stateDir, "methods"),
        agentId: "default",
      },
    }, { stateDir });
    expect(previewRes?.ok).toBe(false);
    if (!previewRes || previewRes.ok) {
      throw new Error("expected preview request to fail");
    }
    expect(previewRes.error?.message).toContain("assetPath must point to a published method .md file");
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.preview returns similar draft summary for the seed candidate", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-preview-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-preview-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const createTask = (taskId: string, title: string, summary: string) => {
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title,
      objective: `${title} objective`,
      summary,
      reflection: `${title} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 50 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };

  createTask("task-synthesize-preview-1", "Tool Call Method Draft One", "整理工具调用信息形成 method。");
  createTask("task-synthesize-preview-2", "Tool Call Method Draft Two", "继续补充工具调用 method 的边界。");
  const candidateOne = memoryManager.promoteTaskToMethodCandidate("task-synthesize-preview-1");
  const candidateTwo = memoryManager.promoteTaskToMethodCandidate("task-synthesize-preview-2");
  expect(candidateOne?.candidate.id).toBeTruthy();
  expect(candidateTwo?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  try {
    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-preview",
      method: "experience.candidate.synthesize.preview",
      params: {
        candidateId: candidateOne!.candidate.id,
        agentId: "default",
      },
    }, { stateDir });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful synthesize preview response");
    }

    expect(previewRes.payload?.candidateType).toBe("method");
    expect(previewRes.payload?.totalCount).toBe(2);
    expect(previewRes.payload?.taskCount).toBe(2);
    expect(previewRes.payload?.sourceCandidateIds).toEqual([
      candidateOne!.candidate.id,
      candidateTwo!.candidate.id,
    ]);
    expect(previewRes.payload?.selectedSourceCount).toBe(2);
    expect(previewRes.payload?.sameFamilyCount).toBe(1);
    expect(previewRes.payload?.similarCount).toBe(0);
    expect(previewRes.payload?.selectedSameFamilyCount).toBe(1);
    expect(previewRes.payload?.selectedSimilarCount).toBe(0);
    expect(previewRes.payload?.maxSimilarSourceCount).toBe(5);
    expect(previewRes.payload?.templateInfo).toMatchObject({
      id: "method-synthesis",
    });
    expect(previewRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateId: candidateTwo!.candidate.id,
        type: "method",
        status: "draft",
      }),
    ]));
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.preview supports published asset virtual candidates", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-published-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-published-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-21T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-published-method-1",
    conversationId: "conv-task-published-method-1",
    sessionKey: "session-task-published-method-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Published Method Follow-up",
    objective: "Reuse published method asset for resynthesis preview",
    summary: "把已发布方法和近似 draft 一起纳入预览。",
    reflection: "published reflection",
    toolCalls: [{ toolName: "web_search", success: true, durationMs: 50 }],
    artifactPaths: ["docs/example.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const draftCandidate = memoryManager.promoteTaskToMethodCandidate("task-published-method-1");
  expect(draftCandidate?.candidate.id).toBeTruthy();
  const acceptedDraft = memoryManager.acceptExperienceCandidate(draftCandidate!.candidate.id);
  expect(acceptedDraft?.publishedPath).toBeTruthy();

  (memoryManager as any).store.createTask({
    id: "task-published-method-2",
    conversationId: "conv-task-published-method-2",
    sessionKey: "session-task-published-method-2",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Published Method Similar Draft",
    objective: "Find similar draft for published preview",
    summary: "补充同类方法草稿的边界与异常处理。",
    reflection: "similar reflection",
    toolCalls: [{ toolName: "web_search", success: true, durationMs: 50 }],
    artifactPaths: ["docs/example.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const similarDraft = memoryManager.promoteTaskToMethodCandidate("task-published-method-2");
  expect(similarDraft?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  try {
    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-preview-published",
      method: "experience.candidate.synthesize.preview",
      params: {
        assetPath: acceptedDraft!.publishedPath,
        agentId: "default",
      },
    }, { stateDir });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful synthesize preview response");
    }

    expect(previewRes.payload?.candidateType).toBe("method");
    expect(previewRes.payload?.seedCandidate).toMatchObject({
      status: "published",
      type: "method",
      publishedPath: acceptedDraft!.publishedPath,
      metadata: expect.objectContaining({
        draftOrigin: { kind: "published" },
      }),
    });
    expect(previewRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateId: similarDraft!.candidate.id,
        status: "draft",
        type: "method",
      }),
    ]));
    expect(
      Array.isArray(previewRes.payload?.sourceCandidateIds)
      && previewRes.payload.sourceCandidateIds.some((item: string) => item.startsWith("virtual:method:")),
    ).toBe(true);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.create supports published skill asset virtual seeds", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-published-skill-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-published-skill-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-21T08:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-published-skill-1",
    conversationId: "conv-task-published-skill-1",
    sessionKey: "session-task-published-skill-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Published Skill Follow-up",
    objective: "Reuse published skill asset for resynthesis create",
    summary: "把已发布 skill 作为 virtual seed 再生成新的 draft。",
    reflection: "published skill reflection",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 30 }],
    artifactPaths: ["docs/skill.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const draftSkill = memoryManager.promoteTaskToSkillCandidate("task-published-skill-1");
  expect(draftSkill?.candidate.id).toBeTruthy();
  const skillRegistry = new SkillRegistry();
  (memoryManager as any).store.createTask({
    id: "task-published-skill-2",
    conversationId: "conv-task-published-skill-2",
    sessionKey: "session-task-published-skill-2",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Published Skill Similar Draft",
    objective: "Reuse published skill asset for resynthesis create",
    summary: "补充 skill 决策路由、输入输出与边界约束。",
    reflection: "similar skill reflection",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 30 }],
    artifactPaths: ["docs/skill.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const similarSkillDraft = memoryManager.promoteTaskToSkillCandidate("task-published-skill-2");
  expect(similarSkillDraft?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "skill");
  registerGlobalMemoryManager(memoryManager);

  try {
    const acceptRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-accept-published-skill-seed",
      method: "experience.candidate.accept",
      params: {
        candidateId: draftSkill!.candidate.id,
        agentId: "default",
      },
    }, {
      stateDir,
      skillRegistry,
    });
    expect(acceptRes).toBeTruthy();
    if (!acceptRes || !acceptRes.ok) {
      throw new Error("expected successful skill accept response");
    }

    const acceptedSkill = memoryManager.getExperienceCandidate(draftSkill!.candidate.id);
    expect(acceptedSkill?.publishedPath).toBeTruthy();

    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-create-published-skill",
      method: "experience.candidate.synthesize.create",
      params: {
        assetPath: acceptedSkill!.publishedPath,
        sourceCandidateIds: [similarSkillDraft!.candidate.id],
        markSourcesConsumed: true,
        agentId: "default",
      },
    }, {
      stateDir,
      callPrimaryModel: async () => JSON.stringify({
        title: "Published Skill Unified",
        summary: "从已发布 skill 继续再合成并产出新的 draft。",
        content: buildValidSynthesizedSkillContent(
          "Published Skill Unified",
          "published-skill-unified",
          "从已发布 skill 继续再合成并产出新的 draft。",
        ),
      }),
    });
    expect(createRes).toBeTruthy();
    if (!createRes || !createRes.ok) {
      throw new Error("expected successful synthesize create response");
    }

    expect(createRes.payload?.candidate).toMatchObject({
      type: "skill",
      status: "draft",
      metadata: expect.objectContaining({
        draftOrigin: { kind: "synthesized" },
        synthesis: expect.objectContaining({
          seedCandidateId: expect.stringMatching(/^virtual:skill:/),
        }),
      }),
    });
    expect(createRes.payload?.sourceCount).toBe(2);
    expect(createRes.payload?.sourceCandidateIds).toEqual(expect.arrayContaining([
      similarSkillDraft!.candidate.id,
      expect.stringMatching(/^virtual:skill:/),
    ]));
    expect(createRes.payload?.consumedSourceCount).toBe(1);
    expect(createRes.payload?.consumedSourceCandidateIds).toEqual([similarSkillDraft!.candidate.id]);

    const consumedDraft = memoryManager.getExperienceCandidate(similarSkillDraft!.candidate.id);
    expect(consumedDraft?.metadata?.synthesisConsumed?.consumed).toBe(true);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.preview and create cap similar sources to five per run", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-limit-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-limit-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const candidateIds: string[] = [];
  const repeatedDraftDetail = Array.from({ length: 220 }, (_, lineIndex) => (
    `第 ${lineIndex + 1} 行：工具调用型方法草稿需要覆盖参数校验、分页拉取、异常恢复、结果归并与输出约束。`
  )).join("\n");
  for (let index = 1; index <= 14; index += 1) {
    const taskId = `task-synthesize-limit-${index}`;
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title: `Method Limit Draft ${index}`,
      objective: `Method Limit Draft ${index} objective`,
      summary: `整理第 ${index} 份 method 草稿并保留边界 ${index}。`,
      reflection: `Method Limit Draft ${index} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const candidateId = `exp_synthesize_limit_${index}`;
    memoryManager.createExperienceCandidate({
      id: candidateId,
      taskId,
      type: "method",
      status: "draft",
      title: `Tool Call Consolidation Method Draft ${index}`,
      slug: `tool-call-consolidation-method-draft-${index}`,
      summary: `汇总工具调用型经验草稿，第 ${index} 份补充不同边界与异常处理。`,
      content: [
        `# Tool Call Consolidation Method Draft ${index}`,
        "",
        "## Context",
        "该方法用于把大量工具调用型经验草稿合并整理为更稳定的方法草稿。",
        `第 ${index} 份草稿补充了分页查询、失败重试、参数校验和输出整理等细节。`,
        "",
        "## Shared Signals",
        "tool call draft synthesis merge preview statistics summarize normalize deduplicate",
        "web search browser fetch extraction tool pipeline structured result confidence",
        "",
        "## Long Notes",
        repeatedDraftDetail,
        "",
        "## Notes",
        `保留第 ${index} 份草稿特有的边界说明与示例。`,
      ].join("\n"),
      sourceTaskSnapshot: {
        taskId,
        conversationId: `conv-${taskId}`,
        agentId: "default",
        source: "chat",
        status: "success",
        title: `Tool Call Consolidation Task ${index}`,
        objective: "整理工具调用型方法草稿",
        summary: `工具调用型经验草稿整理样本 ${index}`,
        reflection: `记录第 ${index} 份草稿的相同主线与差异点`,
        toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
        artifactPaths: ["docs/example.md"],
        startedAt: now,
        finishedAt: now,
      },
      createdAt: now,
      metadata: {
        draftOrigin: {
          kind: "generated",
        },
      },
    });
    candidateIds.push(candidateId);
  }
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  try {
    let capturedUserPromptLength = 0;
    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-limit-preview",
      method: "experience.candidate.synthesize.preview",
      params: {
        candidateId: candidateIds[0],
        agentId: "default",
      },
    }, { stateDir });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful synthesize preview response");
    }

    expect(previewRes.payload?.totalCount).toBeGreaterThan(10);
    expect(Array.isArray(previewRes.payload?.sourceCandidateIds)).toBe(true);
    expect(previewRes.payload?.sourceCandidateIds).toHaveLength(6);
    expect(previewRes.payload?.selectedSourceCount).toBe(6);
    expect(previewRes.payload?.sameFamilyCount).toBeGreaterThanOrEqual(5);
    expect(previewRes.payload?.selectedSameFamilyCount).toBe(5);
    expect(previewRes.payload?.selectedSimilarCount).toBe(0);
    expect(previewRes.payload?.maxSimilarSourceCount).toBe(5);

    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-limit-create",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidateIds[0],
        sourceCandidateIds: candidateIds,
        agentId: "default",
      },
    }, {
      stateDir,
      callPrimaryModel: async (input) => {
        capturedUserPromptLength = String(input.user || "").length;
        return JSON.stringify({
          title: "Method Limit Unified",
          summary: "按每轮最多五个相似草稿进行合成。",
          content: buildValidSynthesizedMethodContent(
            "Method Limit Unified",
            "按每轮最多五个相似草稿进行合成。",
          ),
        });
      },
    });
    expect(createRes).toBeTruthy();
    if (!createRes || !createRes.ok) {
      throw new Error("expected successful synthesize create response");
    }

    expect(createRes.payload?.sourceCount).toBeLessThanOrEqual(6);
    expect(Array.isArray(createRes.payload?.sourceCandidateIds)).toBe(true);
    expect(createRes.payload?.sourceCandidateIds).toHaveLength(6);
    expect(capturedUserPromptLength).toBeGreaterThan(0);
    expect(capturedUserPromptLength).toBeLessThan(28_000);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience synthesis limits can be overridden via environment variables", async () => {
  const previousMaxSimilarSources = process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES;
  const previousMaxSourceContentChars = process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS;
  const previousTotalSourceContentBudget = process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET;
  process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES = "3";
  process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS = "240";
  process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET = "1200";

  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-env-limit-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-env-limit-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const candidateIds: string[] = [];
  const repeatedDraftDetail = Array.from({ length: 220 }, (_, lineIndex) => (
    `第 ${lineIndex + 1} 行：工具调用型方法草稿需要覆盖参数校验、分页拉取、异常恢复、结果归并与输出约束。`
  )).join("\n");
  for (let index = 1; index <= 8; index += 1) {
    const taskId = `task-synthesize-env-limit-${index}`;
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title: `Method Env Limit Draft ${index}`,
      objective: `Method Env Limit Draft ${index} objective`,
      summary: `整理第 ${index} 份 method 草稿并保留边界 ${index}。`,
      reflection: `Method Env Limit Draft ${index} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const candidateId = `exp_synthesize_env_limit_${index}`;
    memoryManager.createExperienceCandidate({
      id: candidateId,
      taskId,
      type: "method",
      status: "draft",
      title: `Tool Call Env Limit Method Draft ${index}`,
      slug: `tool-call-env-limit-method-draft-${index}`,
      summary: `汇总工具调用型经验草稿，第 ${index} 份补充不同边界与异常处理。`,
      content: [
        `# Tool Call Env Limit Method Draft ${index}`,
        "",
        "## Context",
        "该方法用于把大量工具调用型经验草稿合并整理为更稳定的方法草稿。",
        "",
        "## Long Notes",
        repeatedDraftDetail,
      ].join("\n"),
      sourceTaskSnapshot: {
        taskId,
        conversationId: `conv-${taskId}`,
        agentId: "default",
        source: "chat",
        status: "success",
        title: `Tool Call Env Limit Task ${index}`,
        objective: "整理工具调用型方法草稿",
        summary: `工具调用型经验草稿整理样本 ${index}`,
        reflection: `记录第 ${index} 份草稿的相同主线与差异点`,
        toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
        artifactPaths: ["docs/example.md"],
        startedAt: now,
        finishedAt: now,
      },
      createdAt: now,
      metadata: {
        draftOrigin: {
          kind: "generated",
        },
      },
    });
    candidateIds.push(candidateId);
  }
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  try {
    let capturedUserPrompt = "";
    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-env-limit-preview",
      method: "experience.candidate.synthesize.preview",
      params: {
        candidateId: candidateIds[0],
        agentId: "default",
      },
    }, { stateDir });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful synthesize preview response");
    }

    expect(previewRes.payload?.sourceCandidateIds).toHaveLength(4);
    expect(previewRes.payload?.selectedSourceCount).toBe(4);
    expect(previewRes.payload?.selectedSameFamilyCount).toBe(3);
    expect(previewRes.payload?.maxSimilarSourceCount).toBe(3);

    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-env-limit-create",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidateIds[0],
        sourceCandidateIds: candidateIds,
        agentId: "default",
      },
    }, {
      stateDir,
      callPrimaryModel: async (input) => {
        capturedUserPrompt = String(input.user || "");
        return JSON.stringify({
          title: "Method Env Limit Unified",
          summary: "按环境变量限制合成来源数量与正文预算。",
          content: buildValidSynthesizedMethodContent(
            "Method Env Limit Unified",
            "按环境变量限制合成来源数量与正文预算。",
          ),
        });
      },
    });
    expect(createRes).toBeTruthy();
    if (!createRes || !createRes.ok) {
      throw new Error("expected successful synthesize create response");
    }

    expect(createRes.payload?.sourceCount).toBeLessThanOrEqual(4);
    expect(createRes.payload?.sourceCandidateIds).toHaveLength(4);
    expect(capturedUserPrompt).toContain("sourceContentBudget: 1200");
    const usedCharsMatch = capturedUserPrompt.match(/sourceContentCharsUsed:\s*(\d+)/);
    expect(usedCharsMatch).toBeTruthy();
    expect(Number(usedCharsMatch?.[1] || "0")).toBeLessThanOrEqual(960);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    if (previousMaxSimilarSources === undefined) {
      delete process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES;
    } else {
      process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES = previousMaxSimilarSources;
    }
    if (previousMaxSourceContentChars === undefined) {
      delete process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS;
    } else {
      process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS = previousMaxSourceContentChars;
    }
    if (previousTotalSourceContentBudget === undefined) {
      delete process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET;
    } else {
      process.env.BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET = previousTotalSourceContentBudget;
    }
  }
});

test("experience.candidate.synthesize.create creates a synthesized draft candidate with metadata", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-create-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-create-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const createTask = (taskId: string, title: string, summary: string) => {
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title,
      objective: `${title} objective`,
      summary,
      reflection: `${title} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };

  createTask("task-synthesize-create-1", "Tool Call Method Draft One", "整理工具调用信息形成 method。");
  createTask("task-synthesize-create-2", "Tool Call Method Draft Two", "继续补充工具调用 method 的边界。");
  const candidateOne = memoryManager.promoteTaskToMethodCandidate("task-synthesize-create-1");
  const candidateTwo = memoryManager.promoteTaskToMethodCandidate("task-synthesize-create-2");
  expect(candidateOne?.candidate.id).toBeTruthy();
  expect(candidateTwo?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  try {
    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-create",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidateOne!.candidate.id,
        sourceCandidateIds: [candidateOne!.candidate.id, candidateTwo!.candidate.id],
        agentId: "default",
        markSourcesConsumed: true,
      },
    }, {
      stateDir,
      callPrimaryModel: async () => JSON.stringify({
        title: "Tool Call Method Unified",
        summary: "把多个工具调用 method 草稿合成为更稳定的候选。",
        content: buildValidSynthesizedMethodContent(
          "Tool Call Method Unified",
          "把多个工具调用 method 草稿合成为更稳定的候选。",
        ),
      }),
    });
    expect(createRes).toBeTruthy();
    if (!createRes || !createRes.ok) {
      throw new Error("expected successful synthesize create response");
    }

    const createdCandidate = (createRes.payload?.candidate ?? {}) as Record<string, any>;
    expect(createRes.payload?.created).toBe(true);
    expect(createRes.payload?.sourceCount).toBe(2);
    expect(createdCandidate.status).toBe("draft");
    expect(createdCandidate.type).toBe("method");
    expect(createdCandidate.title).toBe("Tool Call Method Unified");
    expect(createdCandidate.metadata?.draftOrigin?.kind).toBe("synthesized");
    expect(createdCandidate.metadata?.synthesis?.seedCandidateId).toBe(candidateOne!.candidate.id);
    expect(createdCandidate.metadata?.synthesis?.sourceCandidateIds).toEqual([
      candidateOne!.candidate.id,
      candidateTwo!.candidate.id,
    ]);
    expect(createdCandidate.metadata?.synthesis?.templateId).toBe("method-synthesis");
    expect(String(createdCandidate.taskId || "")).toContain("::synth::");
    expect(createRes.payload?.consumedSourceCount).toBe(2);
    expect(createRes.payload?.markSourcesConsumed).toBe(true);

    const storedCandidate = memoryManager.getExperienceCandidate(String(createdCandidate.id || ""));
    expect(storedCandidate?.metadata?.draftOrigin?.kind).toBe("synthesized");
    expect(storedCandidate?.metadata?.synthesis?.sourceCount).toBe(2);
    const consumedSourceOne = memoryManager.getExperienceCandidate(candidateOne!.candidate.id);
    const consumedSourceTwo = memoryManager.getExperienceCandidate(candidateTwo!.candidate.id);
    expect(consumedSourceOne?.metadata?.synthesisConsumed?.consumed).toBe(true);
    expect(consumedSourceTwo?.metadata?.synthesisConsumed?.consumed).toBe(true);
    expect(consumedSourceOne?.metadata?.synthesisConsumed?.consumedByCandidateId).toBe(String(createdCandidate.id || ""));
    expect(consumedSourceTwo?.metadata?.synthesisConsumed?.consumedByCandidateId).toBe(String(createdCandidate.id || ""));
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.create logs error details when model output is invalid", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-create-log-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-create-log-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const createTask = (taskId: string, title: string, summary: string) => {
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title,
      objective: `${title} objective`,
      summary,
      reflection: `${title} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };

  createTask("task-synthesize-create-log-1", "Tool Call Method Draft One", "整理工具调用信息形成 method。");
  createTask("task-synthesize-create-log-2", "Tool Call Method Draft Two", "继续补充工具调用 method 的边界。");
  const candidateOne = memoryManager.promoteTaskToMethodCandidate("task-synthesize-create-log-1");
  const candidateTwo = memoryManager.promoteTaskToMethodCandidate("task-synthesize-create-log-2");
  expect(candidateOne?.candidate.id).toBeTruthy();
  expect(candidateTwo?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  const errorLogs: Array<{ message: string; data?: unknown }> = [];

  try {
    await expect(handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-create-invalid-json",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidateOne!.candidate.id,
        sourceCandidateIds: [candidateOne!.candidate.id, candidateTwo!.candidate.id],
        agentId: "default",
      },
    }, {
      stateDir,
      callPrimaryModel: async () => "not a json payload",
      logger: {
        error: (message, data) => {
          errorLogs.push({ message, data });
        },
      },
    })).rejects.toThrow("Model did not return a valid JSON object");

    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.message).toBe("Experience synthesis create failed");
    expect(errorLogs[0]?.data).toEqual(expect.objectContaining({
      candidateId: candidateOne!.candidate.id,
      candidateType: "method",
      sourceCount: 2,
      error: expect.objectContaining({
        message: expect.stringContaining("Model did not return a valid JSON object"),
      }),
    }));
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.create retries once with reduced reasoning after output budget exhaustion", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-length-retry-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-length-retry-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-synthesize-length-retry-1",
    conversationId: "conv-task-synthesize-length-retry-1",
    sessionKey: "session-task-synthesize-length-retry-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Length Retry Draft",
    objective: "Length Retry Draft objective",
    summary: "Length Retry Draft summary",
    reflection: "Length Retry Draft reflection",
    toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
    artifactPaths: ["docs/example.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const candidate = memoryManager.promoteTaskToMethodCandidate("task-synthesize-length-retry-1");
  expect(candidate?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  const callInputs: Array<{ reasoningEffort?: string; thinking?: Record<string, unknown> }> = [];
  const warnLogs: Array<{ message: string; data?: unknown }> = [];

  try {
    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-create-length-retry",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidate!.candidate.id,
        agentId: "default",
      },
    }, {
      stateDir,
      primaryModelConfig: {
        baseUrl: "https://example.invalid/v1",
        apiKey: "test-key",
        model: "reasoning-model",
        thinking: { type: "enabled", budget_tokens: 4096 },
        reasoningEffort: "high",
      },
      callPrimaryModel: async (input) => {
        callInputs.push({
          reasoningEffort: input.reasoningEffort,
          thinking: input.thinking,
        });
        if (callInputs.length === 1) {
          throw new Error("Experience synthesis model returned empty content. finish_reason=length, reasoning_content=present(1234).");
        }
        return JSON.stringify({
          title: "Length Retry Unified",
          summary: "首次长度耗尽后自动降推理重试成功。",
          content: buildValidSynthesizedMethodContent(
            "Length Retry Unified",
            "首次长度耗尽后自动降推理重试成功。",
          ),
        });
      },
      logger: {
        warn: (message, data) => {
          warnLogs.push({ message, data });
        },
      },
    });
    expect(createRes?.ok).toBe(true);
    if (!createRes || !createRes.ok) {
      throw new Error("expected synthesize create request to succeed after retry");
    }
    expect(callInputs).toHaveLength(2);
    expect(callInputs[0]).toMatchObject({
      reasoningEffort: "high",
      thinking: { type: "enabled", budget_tokens: 4096 },
    });
    expect(callInputs[1]?.reasoningEffort).toBe("medium");
    expect(callInputs[1]?.thinking).toBeUndefined();
    expect(warnLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Experience synthesis model exhausted output budget; retrying with reduced reasoning",
        data: expect.objectContaining({
          initialReasoningEffort: "high",
          retryReasoningEffort: "medium",
          clearedThinking: true,
        }),
      }),
    ]));
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.create returns a recoverable error when the model exhausts output budget", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-length-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-length-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-synthesize-length-1",
    conversationId: "conv-task-synthesize-length-1",
    sessionKey: "session-task-synthesize-length-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Length Exhausted Draft",
    objective: "Length Exhausted Draft objective",
    summary: "Length Exhausted Draft summary",
    reflection: "Length Exhausted Draft reflection",
    toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
    artifactPaths: ["docs/example.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const candidate = memoryManager.promoteTaskToMethodCandidate("task-synthesize-length-1");
  expect(candidate?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);
  const callInputs: Array<{ reasoningEffort?: string; thinking?: Record<string, unknown> }> = [];

  try {
    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-create-length",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidate!.candidate.id,
        agentId: "default",
      },
    }, {
      stateDir,
      primaryModelConfig: {
        baseUrl: "https://example.invalid/v1",
        apiKey: "test-key",
        model: "reasoning-model",
        thinking: { type: "enabled", budget_tokens: 4096 },
        reasoningEffort: "high",
      },
      callPrimaryModel: async (input) => {
        callInputs.push({
          reasoningEffort: input.reasoningEffort,
          thinking: input.thinking,
        });
        throw new Error("Experience synthesis model returned empty content. finish_reason=length, reasoning_content=present(1234).");
      },
    });
    expect(createRes?.ok).toBe(false);
    if (!createRes || createRes.ok) {
      throw new Error("expected synthesize create request to fail");
    }
    expect(callInputs).toHaveLength(2);
    expect(callInputs[0]?.reasoningEffort).toBe("high");
    expect(callInputs[0]?.thinking).toMatchObject({ type: "enabled", budget_tokens: 4096 });
    expect(callInputs[1]?.reasoningEffort).toBe("medium");
    expect(callInputs[1]?.thinking).toBeUndefined();
    expect(createRes.error?.message).toContain("exhausted its output budget");
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.create accepts chat completion content arrays from reasoning models", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-content-array-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-content-array-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const createTask = (taskId: string, title: string, summary: string) => {
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title,
      objective: `${title} objective`,
      summary,
      reflection: `${title} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };

  createTask("task-synthesize-content-array-1", "Tool Call Method Draft One", "整理工具调用信息形成 method。");
  createTask("task-synthesize-content-array-2", "Tool Call Method Draft Two", "继续补充工具调用 method 的边界。");
  const candidateOne = memoryManager.promoteTaskToMethodCandidate("task-synthesize-content-array-1");
  const candidateTwo = memoryManager.promoteTaskToMethodCandidate("task-synthesize-content-array-2");
  expect(candidateOne?.candidate.id).toBeTruthy();
  expect(candidateTwo?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: [{
                type: "text",
                text: JSON.stringify({
                  title: "Tool Call Method Array Unified",
                  summary: "把 content array 形式的推理模型输出解析为合成 draft。",
                  content: buildValidSynthesizedMethodContent(
                    "Tool Call Method Array Unified",
                    "把 content array 形式的推理模型输出解析为合成 draft。",
                  ),
                }),
              }],
            },
            finish_reason: "stop",
          },
        ],
      }),
      text: async () => "",
    })) as unknown as typeof fetch;

    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-content-array",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidateOne!.candidate.id,
        sourceCandidateIds: [candidateOne!.candidate.id, candidateTwo!.candidate.id],
        agentId: "default",
      },
    }, {
      stateDir,
      primaryModelConfig: {
        baseUrl: "https://example.test/v1",
        apiKey: "test-api-key",
        model: "reasoning-model",
      },
    });

    expect(createRes).toBeTruthy();
    expect(createRes?.ok).toBe(true);
    if (!createRes || !createRes.ok) {
      throw new Error("expected successful synthesize create response");
    }
    const createdCandidate = (createRes.payload?.candidate ?? {}) as Record<string, any>;
    expect(createdCandidate.title).toBe("Tool Call Method Array Unified");
  } finally {
    globalThis.fetch = originalFetch;
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.create repairs truncated json object when the tail is incomplete", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-truncated-json-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-truncated-json-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const createTask = (taskId: string, title: string, summary: string) => {
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title,
      objective: `${title} objective`,
      summary,
      reflection: `${title} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };

  createTask("task-synthesize-truncated-json-1", "Tool Call Method Draft One", "整理工具调用信息形成 method。");
  createTask("task-synthesize-truncated-json-2", "Tool Call Method Draft Two", "继续补充工具调用 method 的边界。");
  const candidateOne = memoryManager.promoteTaskToMethodCandidate("task-synthesize-truncated-json-1");
  const candidateTwo = memoryManager.promoteTaskToMethodCandidate("task-synthesize-truncated-json-2");
  expect(candidateOne?.candidate.id).toBeTruthy();
  expect(candidateTwo?.candidate.id).toBeTruthy();
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  const validPayload = JSON.stringify({
    title: "Tool Call Method Truncated Repaired",
    summary: "当模型输出 JSON 尾部缺失时，服务端会尝试补全闭合后继续解析。",
    content: buildValidSynthesizedMethodContent(
      "Tool Call Method Truncated Repaired",
      "当模型输出 JSON 尾部缺失时，服务端会尝试补全闭合后继续解析。",
    ),
  });
  const truncatedPayload = validPayload.slice(0, -1);

  try {
    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-truncated-json",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidateOne!.candidate.id,
        sourceCandidateIds: [candidateOne!.candidate.id, candidateTwo!.candidate.id],
        agentId: "default",
      },
    }, {
      stateDir,
      callPrimaryModel: async () => truncatedPayload,
    });

    expect(createRes).toBeTruthy();
    expect(createRes?.ok).toBe(true);
    if (!createRes || !createRes.ok) {
      throw new Error("expected successful synthesize create response");
    }
    const createdCandidate = (createRes.payload?.candidate ?? {}) as Record<string, any>;
    expect(createdCandidate.title).toBe("Tool Call Method Truncated Repaired");
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.synthesize.create warns when source draft set is oversized", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-create-warn-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-synthesize-create-warn-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const candidateIds: string[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const taskId = `task-synthesize-create-warn-${index}`;
    (memoryManager as any).store.createTask({
      id: taskId,
      conversationId: `conv-${taskId}`,
      sessionKey: `session-${taskId}`,
      agentId: "default",
      source: "chat",
      status: "success",
      title: `Tool Call Method Draft ${index}`,
      objective: `Tool Call Method Draft ${index} objective`,
      summary: `整理第 ${index} 份工具调用 method 草稿。`,
      reflection: `Tool Call Method Draft ${index} reflection`,
      toolCalls: [{ toolName: "web_search", success: true, durationMs: 40 }],
      artifactPaths: ["docs/example.md"],
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const candidate = memoryManager.promoteTaskToMethodCandidate(taskId);
    expect(candidate?.candidate.id).toBeTruthy();
    candidateIds.push(String(candidate?.candidate.id || ""));
  }
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
  registerGlobalMemoryManager(memoryManager);

  const warnLogs: Array<{ message: string; data?: unknown }> = [];

  try {
    const createRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-synthesize-create-warn",
      method: "experience.candidate.synthesize.create",
      params: {
        candidateId: candidateIds[0],
        sourceCandidateIds: candidateIds,
        agentId: "default",
      },
    }, {
      stateDir,
      callPrimaryModel: async () => JSON.stringify({
        title: "Large Tool Call Method Unified",
        summary: "把大量工具调用 method 草稿合成为更稳定的候选。",
        content: buildValidSynthesizedMethodContent(
          "Large Tool Call Method Unified",
          "把大量工具调用 method 草稿合成为更稳定的候选。",
        ),
      }),
      logger: {
        warn: (message, data) => {
          warnLogs.push({ message, data });
        },
      },
    });

    expect(createRes).toBeTruthy();
    expect(createRes?.ok).toBe(true);
    expect(warnLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Experience synthesis source set is large; model call may become unstable",
        data: expect.objectContaining({
          requestedSourceCount: 12,
          reason: expect.stringContaining("requestedSourceCount>="),
        }),
      }),
    ]));
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.check_duplicate previews dedup result before generation", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-dedup-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-dedup-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-dedup-1",
    conversationId: "conv-dedup-1",
    sessionKey: "session-dedup-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "生成经验候选",
    objective: "验证生成前去重预检",
    summary: "任务包含足够的经验沉淀信号。",
    reflection: "已有同类方法时，先做预检再决定是否继续生成。",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 80 }],
    artifactPaths: ["docs/demo.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await fs.promises.mkdir(path.join(stateDir, "methods"), { recursive: true });
  await fs.promises.writeFile(
    path.join(stateDir, "methods", "method-生成经验候选.md"),
    [
      "---",
      'summary: "任务包含足够的经验沉淀信号。"',
      "---",
      "",
      "# 生成经验候选",
    ].join("\n"),
    "utf-8",
  );
  registerGlobalMemoryManager(memoryManager);

  try {
    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-dedup-preview",
      method: "experience.candidate.check_duplicate",
      params: { taskId: "task-dedup-1", candidateType: "method", agentId: "default" },
    }, { stateDir });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful candidate duplicate preview response");
    }

    expect(previewRes.payload?.type).toBe("method");
    expect(previewRes.payload?.decision).toBe("similar_existing");
    const similarMatches = Array.isArray(previewRes.payload?.similarMatches)
      ? (previewRes.payload.similarMatches as Array<Record<string, unknown>>)
      : [];
    expect(Array.isArray(previewRes.payload?.similarMatches)).toBe(true);
    expect(similarMatches.some((item) => item.source === "method_asset")).toBe(true);
    expect(memoryManager.listExperienceCandidates(10, { taskId: "task-dedup-1", type: "method" })).toHaveLength(0);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.dedup.preview reports exact duplicate groups without mutating chunk count", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-dedup-preview-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-dedup-preview-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "dup-a",
      sourcePath: "memory/dup-a.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "  duplicated memory line\r\nsecond line  ",
      visibility: "private",
    });
    memoryManager.upsertMemoryChunk({
      id: "dup-b",
      sourcePath: "memory/dup-b.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "duplicated memory line\nsecond line",
      visibility: "shared",
    });
    memoryManager.upsertMemoryChunk({
      id: "unique-c",
      sourcePath: "memory/unique-c.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "same topic but not exact duplicate",
      visibility: "private",
    });
    registerGlobalMemoryManager(memoryManager);

    const beforeCount = memoryManager.countChunks();
    const response = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-dedup-preview",
      method: "memory.dedup.preview",
      params: {
        filter: { memoryType: "daily" },
        maxGroups: 20,
      },
    }, { stateDir });

    expect(response).toBeTruthy();
    if (!response || !response.ok) {
      throw new Error("expected successful memory.dedup.preview response");
    }

    const report = response.payload?.report as Record<string, any> | undefined;
    expect(report?.mode).toBe("dry_run");
    expect(report?.strategy).toBe("hash_only_exact");
    expect(report?.totals?.scannedChunks).toBe(3);
    expect(report?.totals?.duplicateGroups).toBe(1);
    expect(report?.totals?.removableChunks).toBe(1);
    expect(Array.isArray(report?.groups)).toBe(true);
    expect(report?.groups?.[0]?.keep?.id).toBe("dup-a");
    expect(report?.groups?.[0]?.remove?.map((item: Record<string, unknown>) => item.id)).toEqual(["dup-b"]);
    expect(memoryManager.countChunks()).toBe(beforeCount);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.dedup.apply backs up the db, removes duplicate chunks, and relinks task memory links", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-dedup-apply-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-dedup-apply-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "apply-dup-a",
      sourcePath: "memory/apply-a.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "exact duplicated memory\r\nline two",
      visibility: "private",
    });
    memoryManager.upsertMemoryChunk({
      id: "apply-dup-b",
      sourcePath: "memory/apply-b.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "exact duplicated memory\nline two",
      visibility: "shared",
    });
    memoryManager.upsertMemoryChunk({
      id: "apply-unique-c",
      sourcePath: "memory/apply-c.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "unique memory payload",
      visibility: "private",
    });
    (memoryManager as any).store.createTask({
      id: "task-dedup-apply-1",
      conversationId: "conv-dedup-apply-1",
      sessionKey: "session-dedup-apply-1",
      agentId: "default",
      source: "chat",
      status: "success",
      title: "dedup apply test",
      objective: "验证 dedup apply 会迁移 task_memory_links",
      summary: "duplicate cleanup",
      reflection: "keep links",
      toolCalls: [],
      artifactPaths: [],
      startedAt: "2026-05-17T00:00:00.000Z",
      finishedAt: "2026-05-17T00:00:00.000Z",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });
    (memoryManager as any).store.createTask({
      id: "task-dedup-apply-2",
      conversationId: "conv-dedup-apply-2",
      sessionKey: "session-dedup-apply-2",
      agentId: "default",
      source: "chat",
      status: "success",
      title: "dedup apply test keeper",
      objective: "让 keeper 与 remove 的 task link 数持平，按 keeper 规则稳定选中 apply-dup-a",
      summary: "duplicate cleanup keeper",
      reflection: "prefer source path order after task link tie",
      toolCalls: [],
      artifactPaths: [],
      startedAt: "2026-05-17T00:00:00.000Z",
      finishedAt: "2026-05-17T00:00:00.000Z",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });
    (memoryManager as any).store.linkTaskMemory("task-dedup-apply-2", "apply-dup-a", "used");
    (memoryManager as any).store.linkTaskMemory("task-dedup-apply-1", "apply-dup-b", "used");
    registerGlobalMemoryManager(memoryManager);

    const beforeCount = memoryManager.countChunks();
    const beforeLinks = memoryManager.getTaskDetail("task-dedup-apply-1")?.memoryLinks ?? [];
    expect(beforeLinks.some((item) => item.chunkId === "apply-dup-b")).toBe(true);

    const response = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-dedup-apply",
      method: "memory.dedup.apply",
      params: {
        confirmed: true,
        filter: { memoryType: "daily" },
        runId: "dedup-apply-test",
      },
    }, { stateDir });

    expect(response).toBeTruthy();
    if (!response || !response.ok) {
      throw new Error("expected successful memory.dedup.apply response");
    }

    const result = response.payload?.result as Record<string, any> | undefined;
    expect(result?.mode).toBe("apply");
    expect(result?.backupPath).toContain("memory-dedup-backups");
    expect(result?.totals?.removedChunks).toBe(1);
    expect(result?.totals?.relinkedTaskMemoryLinks).toBe(1);
    expect(await fs.promises.stat(String(result?.backupPath))).toBeTruthy();
    expect(memoryManager.countChunks()).toBe(beforeCount - 1);
    expect(memoryManager.getMemory("apply-dup-b")).toBeNull();
    expect(memoryManager.getMemory("apply-dup-a")?.content).toContain("exact duplicated memory");
    const afterLinks = memoryManager.getTaskDetail("task-dedup-apply-1")?.memoryLinks ?? [];
    expect(afterLinks.some((item) => item.chunkId === "apply-dup-a")).toBe(true);
    expect(afterLinks.some((item) => item.chunkId === "apply-dup-b")).toBe(false);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.dedup methods are reachable through gateway websocket dispatch", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-dedup-ws-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-dedup-ws-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "ws-dup-a",
      sourcePath: "memory/ws-dup-a.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "websocket dedup preview line\r\nnext line",
      visibility: "private",
    });
    memoryManager.upsertMemoryChunk({
      id: "ws-dup-b",
      sourcePath: "memory/ws-dup-b.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "websocket dedup preview line\nnext line",
      visibility: "shared",
    });
    registerGlobalMemoryManager(memoryManager);

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
      frames.length = 0;

      ws.send(JSON.stringify({
        type: "req",
        id: "memory-dedup-preview-ws",
        method: "memory.dedup.preview",
        params: {
          agentId: "default",
          filter: { memoryType: "daily" },
        },
      }));
      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "memory-dedup-preview-ws"));

      const previewRes = frames.find((frame) => frame.type === "res" && frame.id === "memory-dedup-preview-ws");
      expect(previewRes?.ok).toBe(true);
      expect(previewRes?.error?.message).not.toBe("Unknown method.");
      expect(previewRes?.payload?.report?.totals?.duplicateGroups).toBe(1);
      expect(previewRes?.payload?.report?.groups?.[0]?.remove?.map((item: Record<string, unknown>) => item.id)).toEqual(["ws-dup-b"]);

      ws.send(JSON.stringify({
        type: "req",
        id: "memory-dedup-apply-ws",
        method: "memory.dedup.apply",
        params: {
          agentId: "default",
          confirmed: true,
          filter: { memoryType: "daily" },
          runId: "memory-dedup-ws",
        },
      }));
      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "memory-dedup-apply-ws"));

      const applyRes = frames.find((frame) => frame.type === "res" && frame.id === "memory-dedup-apply-ws");
      expect(applyRes?.ok).toBe(true);
      expect(applyRes?.error?.message).not.toBe("Unknown method.");
      expect(applyRes?.payload?.result?.totals?.removedChunks).toBe(1);
      expect(applyRes?.payload?.result?.backupPath).toContain("memory-dedup-backups");
    } finally {
      ws.close();
      await closeP;
      await server.close();
    }
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.share.queue treats timed-out claims as overdue and actionable again", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-shared-review-timeout-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
    memoryMode: "hybrid",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    workspaceDir: "coder",
    sessionNamespace: "coder-main",
    memoryMode: "isolated",
  });
  registry.register({
    id: "reviewer",
    displayName: "Reviewer",
    model: "primary",
    workspaceDir: "reviewer",
    sessionNamespace: "reviewer-main",
    memoryMode: "isolated",
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
  if (!defaultRecord) {
    throw new Error("default resident memory manager is required");
  }

  defaultRecord.manager.upsertMemoryChunk({
    id: "shared-review-timeout-chunk",
    sourcePath: "memory/shared-review-timeout.md",
    sourceType: "manual",
    memoryType: "other",
    content: "shared review timeout smoke",
    visibility: "private",
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
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "share-timeout-promote",
      method: "memory.share.promote",
      params: {
        agentId: "default",
        chunkId: "shared-review-timeout-chunk",
        reason: "timeout smoke",
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-timeout-promote"));

    ws.send(JSON.stringify({
      type: "req",
      id: "share-timeout-claim",
      method: "memory.share.claim",
      params: {
        reviewerAgentId: "coder",
        targetAgentId: "default",
        chunkId: "shared-review-timeout-chunk",
        action: "claim",
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-timeout-claim"));
    const claimRes = frames.find((frame) => frame.type === "res" && frame.id === "share-timeout-claim");
    expect(claimRes?.ok).toBe(true);

    const claimedItem = defaultRecord.manager.getMemory("shared-review-timeout-chunk");
    expect(claimedItem?.metadata?.sharedPromotion?.claimedByAgentId).toBe("coder");
    expect(claimedItem?.metadata?.sharedPromotion?.claimedAt).toEqual(expect.any(String));
    const claimedSourceType = claimedItem?.sourceType;
    defaultRecord.manager.upsertMemoryChunk({
      id: claimedItem?.id ?? "shared-review-timeout-chunk",
      sourcePath: claimedItem?.sourcePath ?? "memory/shared-review-timeout.md",
      sourceType: claimedSourceType === "session" || claimedSourceType === "manual" ? claimedSourceType : "manual",
      memoryType: claimedItem?.memoryType ?? "other",
      content: claimedItem?.content ?? claimedItem?.snippet ?? "shared review timeout smoke",
      startLine: claimedItem?.startLine,
      endLine: claimedItem?.endLine,
      category: claimedItem?.category,
      visibility: claimedItem?.visibility ?? "private",
      metadata: {
        ...(claimedItem?.metadata ?? {}),
        sharedPromotion: {
          ...(claimedItem?.metadata?.sharedPromotion ?? {}),
          claimedAt: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
        },
      },
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "share-timeout-queue",
      method: "memory.share.queue",
      params: {
        reviewerAgentId: "reviewer",
        filter: { sharedPromotionStatus: "pending" },
      },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "share-timeout-queue"));
    const queueRes = frames.find((frame) => frame.type === "res" && frame.id === "share-timeout-queue");
    expect(queueRes?.ok).toBe(true);
    expect(queueRes?.payload?.summary).toMatchObject({
      pendingCount: 1,
      claimedCount: 0,
      overdueCount: 1,
      blockedCount: 0,
      reviewerActionableCount: 1,
    });
    expect(queueRes?.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "shared-review-timeout-chunk",
        claimOwner: "coder",
        claimTimedOut: true,
        actionableByReviewer: true,
        blockedByOtherReviewer: false,
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory viewer rpc returns task and memory data", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  (memoryManager as any).embeddingProvider = {
    modelName: "test-memory-viewer",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };

  await fs.promises.writeFile(path.join(workspaceRoot, "MEMORY.md"), "# Belldandy\nMemory viewer test content.\n", "utf-8");
  await memoryManager.indexWorkspace();
  (memoryManager as any).store.upsertChunk({
    id: "chunk-category-decision",
    sourcePath: "memory/category-decision.md",
    sourceType: "manual",
    memoryType: "other",
    content: "phase4decision marker: complete category minimum loop first.",
    category: "decision",
  });
  (memoryManager as any).store.upsertChunk({
    id: "chunk-topic-viewer",
    sourcePath: "memory/topic-viewer.md",
    sourceType: "manual",
    memoryType: "other",
    content: "viewer topic marker: topic filtered memory for rpc viewer.",
    topic: "viewer-audit",
    visibility: "shared",
  });
  registerGlobalMemoryManager(memoryManager);

  const recentChunk = memoryManager.getRecent(5).find((item) => item.sourcePath.endsWith("MEMORY.md")) ?? memoryManager.getRecent(1)[0];
  expect(recentChunk?.id).toBeTruthy();

  const startedTaskId = memoryManager.startTaskCapture({
    conversationId: "conv-memory-viewer",
    sessionKey: "session-memory-viewer",
    source: "chat",
    objective: "Implement memory viewer",
    metadata: {
      goalId: "goal_memory_viewer",
      goalSession: true,
    },
  });
  expect(startedTaskId).toBeTruthy();
  if (recentChunk?.id) {
    memoryManager.linkTaskMemories("conv-memory-viewer", [recentChunk.id, "chunk-topic-viewer"], "used");
  }
  memoryManager.recordTaskToolCall("conv-memory-viewer", {
    toolName: "memory_search",
    success: true,
    durationMs: 120,
  });
  const completedTaskId = memoryManager.completeTaskCapture({
    conversationId: "conv-memory-viewer",
    success: true,
    durationMs: 1200,
    messages: [{ type: "usage", inputTokens: 12, outputTokens: 8 }],
  });
  expect(completedTaskId).toBeTruthy();
  const methodCandidate = memoryManager.promoteTaskToMethodCandidate(completedTaskId!);
  expect(methodCandidate?.candidate.id).toBeTruthy();
  const acceptedMethodCandidate = memoryManager.acceptExperienceCandidate(methodCandidate!.candidate.id);
  expect(acceptedMethodCandidate?.publishedPath).toBeTruthy();
  (memoryManager as any).store.createTask({
    id: "task-non-goal-viewer",
    conversationId: "conv-memory-viewer-other",
    sessionKey: "session-memory-viewer-other",
    source: "manual",
    status: "success",
    title: "Unrelated maintenance task",
    objective: "should not appear in goal-filtered task list",
    startedAt: "2026-03-16T00:05:00.000Z",
    finishedAt: "2026-03-16T00:05:10.000Z",
    createdAt: "2026-03-16T00:05:00.000Z",
    updatedAt: "2026-03-16T00:05:10.000Z",
  });
  (memoryManager as any).store.createExperienceUsage({
    id: "usage-viewer-method",
    taskId: completedTaskId!,
    assetType: "method",
    assetKey: path.basename(acceptedMethodCandidate!.publishedPath!),
    sourceCandidateId: methodCandidate!.candidate.id,
    usedVia: "tool",
    createdAt: "2026-03-16T00:00:01.000Z",
  });
  (memoryManager as any).store.createExperienceUsage({
    id: "usage-viewer-skill",
    taskId: completedTaskId!,
    assetType: "skill",
    assetKey: "Viewer Skill",
    usedVia: "search",
    createdAt: "2026-03-16T00:00:02.000Z",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    additionalWorkspaceRoots: [workspaceRoot],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "memory-stats", method: "memory.stats" }));
    ws.send(JSON.stringify({ type: "req", id: "memory-stats-with-recent", method: "memory.stats", params: { includeRecentTasks: true } }));
    ws.send(JSON.stringify({ type: "req", id: "task-list", method: "memory.task.list", params: { limit: 5, summaryOnly: true } }));
    ws.send(JSON.stringify({ type: "req", id: "task-list-goal", method: "memory.task.list", params: { limit: 5, summaryOnly: true, filter: { goalId: "goal_memory_viewer" } } }));
    ws.send(JSON.stringify({ type: "req", id: "memory-recent", method: "memory.recent", params: { limit: 5, includeContent: false } }));
    ws.send(JSON.stringify({ type: "req", id: "memory-recent-uncategorized", method: "memory.recent", params: { limit: 5, includeContent: false, filter: { uncategorized: true } } }));
    ws.send(JSON.stringify({ type: "req", id: "memory-search", method: "memory.search", params: { query: "viewer", limit: 5, includeContent: false } }));
    ws.send(JSON.stringify({ type: "req", id: "memory-search-topic", method: "memory.search", params: { query: "viewer topic", limit: 5, includeContent: false, filter: { topic: "viewer-audit" } } }));
    ws.send(JSON.stringify({ type: "req", id: "memory-recent-category", method: "memory.recent", params: { limit: 5, includeContent: false, filter: { category: "decision" } } }));
    ws.send(JSON.stringify({ type: "req", id: "usage-list", method: "experience.usage.list", params: { limit: 10, filter: { taskId: completedTaskId } } }));
    ws.send(JSON.stringify({ type: "req", id: "usage-stats", method: "experience.usage.stats", params: { limit: 10, filter: { assetType: "method" } } }));
    ws.send(JSON.stringify({ type: "req", id: "usage-get", method: "experience.usage.get", params: { usageId: "usage-viewer-method" } }));
    ws.send(JSON.stringify({ type: "req", id: "candidate-get", method: "experience.candidate.get", params: { candidateId: methodCandidate!.candidate.id } }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-stats"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-stats-with-recent"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "task-list"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "task-list-goal"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-recent"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-recent-uncategorized"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-search"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-search-topic"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-recent-category"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-list"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-stats"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-get"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-get"));

    const taskListRes = frames.find((f) => f.type === "res" && f.id === "task-list");
    const taskListGoalRes = frames.find((f) => f.type === "res" && f.id === "task-list-goal");
    const memoryRecentRes = frames.find((f) => f.type === "res" && f.id === "memory-recent");
    const memoryRecentUncategorizedRes = frames.find((f) => f.type === "res" && f.id === "memory-recent-uncategorized");
    const memorySearchRes = frames.find((f) => f.type === "res" && f.id === "memory-search");
    const memorySearchTopicRes = frames.find((f) => f.type === "res" && f.id === "memory-search-topic");
    const memoryRecentCategoryRes = frames.find((f) => f.type === "res" && f.id === "memory-recent-category");
    const statsRes = frames.find((f) => f.type === "res" && f.id === "memory-stats");
    const statsWithRecentRes = frames.find((f) => f.type === "res" && f.id === "memory-stats-with-recent");
    const usageListRes = frames.find((f) => f.type === "res" && f.id === "usage-list");
    const usageStatsRes = frames.find((f) => f.type === "res" && f.id === "usage-stats");
    const usageGetRes = frames.find((f) => f.type === "res" && f.id === "usage-get");
    const candidateGetRes = frames.find((f) => f.type === "res" && f.id === "candidate-get");

    expect(statsRes.ok).toBe(true);
    expect(statsRes.payload.status.chunks).toBeGreaterThan(0);
    expect(statsRes.payload.status.categorized).toBeGreaterThan(0);
    expect(statsRes.payload.status.uncategorized).toBeGreaterThan(0);
    expect(statsRes.payload.status.categoryBuckets.decision).toBeGreaterThan(0);
    expect(statsRes.payload.recentTasks).toBeUndefined();
    expect(statsRes.payload.queryView.scope).toBe("private");
    expect(statsWithRecentRes.ok).toBe(true);
    expect(Array.isArray(statsWithRecentRes.payload.recentTasks)).toBe(true);
    expect(statsWithRecentRes.payload.recentTasks.length).toBeGreaterThan(0);
    expect(taskListRes.ok).toBe(true);
    expect(taskListRes.payload.items.length).toBeGreaterThan(0);
    expect(taskListRes.payload.items[0].toolCalls).toBeUndefined();
    expect(taskListRes.payload.items[0].artifactPaths).toBeUndefined();
    expect(taskListGoalRes.ok).toBe(true);
    expect(taskListGoalRes.payload.items.length).toBeGreaterThan(0);
    expect(taskListGoalRes.payload.items.every((item: any) => item?.metadata?.goalId === "goal_memory_viewer")).toBe(true);
    expect(taskListGoalRes.payload.items.some((item: any) => item?.id === "task-non-goal-viewer")).toBe(false);
    expect(memoryRecentRes.ok).toBe(true);
    expect(memoryRecentRes.payload.items.length).toBeGreaterThan(0);
    expect(memoryRecentRes.payload.items[0].content).toBeUndefined();
    expect(memoryRecentRes.payload.items[0].sourceView.scope).toBeTruthy();
    expect(memoryRecentUncategorizedRes.ok).toBe(true);
    expect(memoryRecentUncategorizedRes.payload.items.length).toBeGreaterThan(0);
    expect(memoryRecentUncategorizedRes.payload.items[0].category).toBeUndefined();
    expect(memoryRecentUncategorizedRes.payload.items[0].content).toBeUndefined();
    expect(memorySearchRes.ok).toBe(true);
    expect(Array.isArray(memorySearchRes.payload.items)).toBe(true);
    expect(memorySearchRes.payload.items.every((item: any) => item.content === undefined)).toBe(true);
    expect(memorySearchTopicRes.ok).toBe(true);
    expect(memorySearchTopicRes.payload.items.length).toBeGreaterThan(0);
    expect(memorySearchTopicRes.payload.items.every((item: any) => item.sourcePath === "memory/topic-viewer.md")).toBe(true);
    expect(memorySearchTopicRes.payload.items[0].content).toBeUndefined();
    expect(memorySearchTopicRes.payload.items[0].sourceView.scope).toBe("shared");
    expect(memoryRecentCategoryRes.ok).toBe(true);
    expect(memoryRecentCategoryRes.payload.items.length).toBeGreaterThan(0);
    expect(memoryRecentCategoryRes.payload.items[0].category).toBe("decision");
    expect(memoryRecentCategoryRes.payload.items[0].content).toBeUndefined();
    expect(memoryRecentCategoryRes.payload.items[0].sourceView.scope).toBe("private");
    expect(usageListRes.ok).toBe(true);
    expect(usageListRes.payload.items.length).toBe(2);
    const methodUsageItem = usageListRes.payload.items.find((item: any) => item.sourceCandidateId === methodCandidate!.candidate.id);
    expect(methodUsageItem?.sourceView.scope).toBe("hybrid");
    expect(usageStatsRes.ok).toBe(true);
    expect(usageStatsRes.payload.items[0].assetKey).toBe(path.basename(acceptedMethodCandidate!.publishedPath!));
    expect(usageStatsRes.payload.items[0].usageCount).toBeGreaterThan(0);
    expect(usageStatsRes.payload.items[0].sourceCandidateId).toBe(methodCandidate!.candidate.id);
    expect(usageStatsRes.payload.items[0].sourceCandidatePublishedPath).toBe(acceptedMethodCandidate!.publishedPath);
    expect(usageStatsRes.payload.items[0].sourceView.scope).toBe("hybrid");
    expect(usageGetRes.ok).toBe(true);
    expect(usageGetRes.payload.usage.id).toBe("usage-viewer-method");
    expect(usageGetRes.payload.usage.sourceCandidateId).toBe(methodCandidate!.candidate.id);
    expect(usageGetRes.payload.usage.sourceView.scope).toBe("hybrid");
    expect(candidateGetRes.ok).toBe(true);
    expect(candidateGetRes.payload.candidate.id).toBe(methodCandidate!.candidate.id);
    expect(candidateGetRes.payload.candidate.publishedPath).toBe(acceptedMethodCandidate!.publishedPath);
    expect(candidateGetRes.payload.candidate.sourceView.scope).toBe("hybrid");
    expect(candidateGetRes.payload.candidate.sourceTaskSnapshot.memoryLinks.some((item: any) => item.sourceView.scope === "shared")).toBe(true);
    expect(candidateGetRes.payload.candidate.learningReviewInput.summary.available).toBe(true);
    expect(candidateGetRes.payload.candidate.learningReviewInput.summaryLines.some((item: string) => item.includes("method candidate"))).toBe(true);

    const usageIdToRevoke = usageListRes.payload.items[0].id;
    ws.send(JSON.stringify({ type: "req", id: "usage-revoke", method: "experience.usage.revoke", params: { usageId: usageIdToRevoke } }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-revoke"));
    const usageRevokeRes = frames.find((f) => f.type === "res" && f.id === "usage-revoke");
    ws.send(JSON.stringify({ type: "req", id: "usage-list-after-revoke", method: "experience.usage.list", params: { limit: 10, filter: { taskId: completedTaskId } } }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-list-after-revoke"));
    const usageListAfterRevokeRes = frames.find((f) => f.type === "res" && f.id === "usage-list-after-revoke");
    expect(usageRevokeRes.ok).toBe(true);
    expect(usageRevokeRes.payload.revoked).toBe(true);
    expect(usageRevokeRes.payload.usage.id).toBe(usageIdToRevoke);
    expect(usageListAfterRevokeRes.ok).toBe(true);
    expect(usageListAfterRevokeRes.payload.items.length).toBe(1);
    const revokedAssetType = usageRevokeRes.payload.usage.assetType;

    const taskId = completedTaskId!;
    const chunkId = memoryRecentCategoryRes.payload.items[0].id;

    ws.send(JSON.stringify({ type: "req", id: "task-get", method: "memory.task.get", params: { taskId } }));
    ws.send(JSON.stringify({ type: "req", id: "recent-work", method: "memory.recent_work", params: { limit: 3, query: "viewer" } }));
    ws.send(JSON.stringify({ type: "req", id: "resume-context", method: "memory.resume_context", params: { query: "viewer" } }));
    ws.send(JSON.stringify({ type: "req", id: "similar-past-work", method: "memory.similar_past_work", params: { query: "viewer", limit: 3 } }));
    ws.send(JSON.stringify({ type: "req", id: "explain-sources", method: "memory.explain_sources", params: { taskId } }));
    ws.send(JSON.stringify({ type: "req", id: "memory-get", method: "memory.get", params: { chunkId } }));
    ws.send(JSON.stringify({ type: "req", id: "source-read", method: "workspace.readSource", params: { path: recentChunk.sourcePath } }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "task-get"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "recent-work"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "resume-context"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "similar-past-work"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "explain-sources"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "memory-get"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "source-read"));

    const taskGetRes = frames.find((f) => f.type === "res" && f.id === "task-get");
    const recentWorkRes = frames.find((f) => f.type === "res" && f.id === "recent-work");
    const resumeContextRes = frames.find((f) => f.type === "res" && f.id === "resume-context");
    const similarPastWorkRes = frames.find((f) => f.type === "res" && f.id === "similar-past-work");
    const explainSourcesRes = frames.find((f) => f.type === "res" && f.id === "explain-sources");
    const memoryGetRes = frames.find((f) => f.type === "res" && f.id === "memory-get");
    const sourceReadRes = frames.find((f) => f.type === "res" && f.id === "source-read");

    expect(taskGetRes.ok).toBe(true);
    expect(Array.isArray(taskGetRes.payload.task.activities)).toBe(true);
    expect(taskGetRes.payload.task.activities.some((item: any) => item.kind === "task_started")).toBe(true);
    expect(taskGetRes.payload.task.activities.some((item: any) => item.kind === "memory_recalled")).toBe(true);
    expect(taskGetRes.payload.task.activities.every((item: any) => !Object.prototype.hasOwnProperty.call(item, "nextStep"))).toBe(true);
    expect(taskGetRes.payload.task.workRecap?.headline).toContain("任务已完成");
    expect(taskGetRes.payload.task.resumeContext?.currentStopPoint).toBe("任务已完成。");
    expect(taskGetRes.payload.task.memoryLinks.length).toBeGreaterThan(0);
    expect(taskGetRes.payload.task.memoryLinks.some((item: any) => item.sourceView.scope === "shared")).toBe(true);
    expect(taskGetRes.payload.task.usedMethods.length + taskGetRes.payload.task.usedSkills.length).toBe(1);
    if (revokedAssetType === "method") {
      expect(taskGetRes.payload.task.usedMethods.length).toBe(0);
      expect(taskGetRes.payload.task.usedSkills.length).toBe(1);
      expect(taskGetRes.payload.task.usedSkills[0].assetKey).toBe("Viewer Skill");
    } else {
      expect(taskGetRes.payload.task.usedMethods.length).toBe(1);
      expect(taskGetRes.payload.task.usedMethods[0].assetKey).toBe(path.basename(acceptedMethodCandidate!.publishedPath!));
      expect(taskGetRes.payload.task.usedMethods[0].sourceCandidateId).toBe(methodCandidate!.candidate.id);
      expect(taskGetRes.payload.task.usedMethods[0].sourceCandidatePublishedPath).toBe(acceptedMethodCandidate!.publishedPath);
      expect(taskGetRes.payload.task.usedSkills.length).toBe(0);
    }
    expect(recentWorkRes.ok).toBe(true);
    expect(Array.isArray(recentWorkRes.payload.items)).toBe(true);
    expect(recentWorkRes.payload.items[0].taskId).toBe(taskId);
    expect(recentWorkRes.payload.items[0].workRecap?.headline).toContain("任务已完成");
    expect(resumeContextRes.ok).toBe(true);
    expect(resumeContextRes.payload.item.taskId).toBe(taskId);
    expect(resumeContextRes.payload.item.resumeContext?.currentStopPoint).toBe("任务已完成。");
    expect(similarPastWorkRes.ok).toBe(true);
    expect(similarPastWorkRes.payload.items.some((item: any) => item.taskId === taskId)).toBe(true);
    expect(similarPastWorkRes.payload.items[0].matchReasons?.length).toBeGreaterThan(0);
    expect(explainSourcesRes.ok).toBe(true);
    expect(explainSourcesRes.payload.explanation.taskId).toBe(taskId);
    expect(explainSourcesRes.payload.explanation.sourceRefs.some((item: any) => item.kind === "work_recap")).toBe(true);
    expect(explainSourcesRes.payload.explanation.sourceRefs.some((item: any) => item.kind === "resume_context")).toBe(true);
    expect(explainSourcesRes.payload.explanation.sourceRefs.some((item: any) => item.kind === "activity_worklog")).toBe(true);
    expect(memoryGetRes.ok).toBe(true);
    expect(memoryGetRes.payload.item.category).toBe("decision");
    expect(memoryGetRes.payload.item.content).toContain("phase4decision");
    expect(memoryGetRes.payload.item.sourceView.scope).toBe("private");
    expect(sourceReadRes.ok).toBe(true);
    expect(sourceReadRes.payload.readOnly).toBe(true);
    expect(sourceReadRes.payload.content).toContain("Memory viewer test content");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience candidate rpc lists and updates candidate status", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-workspace-"));
  const skillRegistry = new SkillRegistry();
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-03-15T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-experience-1",
    conversationId: "conv-experience-1",
    sessionKey: "session-experience-1",
    source: "chat",
    status: "success",
    title: "收敛第五阶段方案",
    objective: "为第五阶段生成候选层闭环",
    summary: "已经梳理出候选层数据结构与接口边界。",
    reflection: "先做候选层，再做发布链路，能避免污染正式资产。",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 90 }],
    artifactPaths: ["MemOS对比分析.md"],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const methodCandidate = memoryManager.promoteTaskToMethodCandidate("task-experience-1");
  const skillCandidate = memoryManager.promoteTaskToSkillCandidate("task-experience-1");
  expect(methodCandidate?.candidate.id).toBeTruthy();
  expect(skillCandidate?.candidate.id).toBeTruthy();

  registerGlobalMemoryManager(memoryManager);

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    additionalWorkspaceRoots: [workspaceRoot],
    skillRegistry,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-list",
      method: "experience.candidate.list",
      params: { limit: 10, filter: { status: "draft" } },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-list"));

    const listRes = frames.find((f) => f.type === "res" && f.id === "candidate-list");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload.items.length).toBe(2);

    const consumedUpdate = memoryManager.markExperienceCandidatesSynthesisConsumed({
      candidateIds: [methodCandidate!.candidate.id],
      consumedByCandidateId: "exp_synth_demo",
      consumedAt: now,
      consumedRunId: "synth_demo_run",
    });
    expect(consumedUpdate).toHaveLength(1);

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-list-offset",
      method: "experience.candidate.list",
      params: { limit: 1, offset: 1, filter: { status: "draft" } },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-list-offset"));
    const offsetListRes = frames.find((f) => f.type === "res" && f.id === "candidate-list-offset");
    expect(offsetListRes.ok).toBe(true);
    expect(offsetListRes.payload.items.length).toBe(1);
    expect(offsetListRes.payload.offset).toBe(1);

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-list-unconsumed",
      method: "experience.candidate.list",
      params: { limit: 10, filter: { status: "draft", synthesisConsumed: false } },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-list-unconsumed"));
    const unconsumedRes = frames.find((f) => f.type === "res" && f.id === "candidate-list-unconsumed");
    expect(unconsumedRes.ok).toBe(true);
    expect(unconsumedRes.payload.items).toHaveLength(1);
    expect(unconsumedRes.payload.items[0]?.id).toBe(skillCandidate!.candidate.id);

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-list-consumed",
      method: "experience.candidate.list",
      params: { limit: 10, filter: { synthesisConsumed: true, consumedByCandidateId: "exp_synth_demo" } },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-list-consumed"));
    const consumedRes = frames.find((f) => f.type === "res" && f.id === "candidate-list-consumed");
    expect(consumedRes.ok).toBe(true);
    expect(consumedRes.payload.items).toHaveLength(1);
    expect(consumedRes.payload.items[0]?.id).toBe(methodCandidate!.candidate.id);

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-stats",
      method: "experience.candidate.stats",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-stats"));
    const statsRes = frames.find((f) => f.type === "res" && f.id === "candidate-stats");
    expect(statsRes.ok).toBe(true);
    expect(statsRes.payload.stats).toMatchObject({
      total: 2,
      methods: 1,
      skills: 1,
      draft: 2,
      accepted: 0,
      rejected: 0,
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-accept",
      method: "experience.candidate.accept",
      params: { candidateId: methodCandidate!.candidate.id },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-skill-accept",
      method: "experience.candidate.accept",
      params: { candidateId: skillCandidate!.candidate.id },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-accept"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-skill-accept"));

    const acceptRes = frames.find((f) => f.type === "res" && f.id === "candidate-accept");
    const skillAcceptRes = frames.find((f) => f.type === "res" && f.id === "candidate-skill-accept");
    expect(acceptRes.ok).toBe(true);
    expect(acceptRes.payload.candidate.status).toBe("accepted");
    const acceptedCandidate = memoryManager.getExperienceCandidate(methodCandidate!.candidate.id);
    expect(acceptedCandidate?.publishedPath).toContain(path.join(stateDir, "methods"));
    const publishedContent = await fs.promises.readFile(acceptedCandidate!.publishedPath!, "utf-8");
    expect(publishedContent).toContain("# 收敛第五阶段方案");
    expect(publishedContent).toContain("## 0. 元信息");

    expect(skillAcceptRes.ok).toBe(true);
    expect(skillAcceptRes.payload.candidate.status).toBe("accepted");
    const acceptedSkillCandidate = memoryManager.getExperienceCandidate(skillCandidate!.candidate.id);
    expect(acceptedSkillCandidate?.publishedPath).toContain(path.join(stateDir, "skills"));
    const publishedSkillContent = await fs.promises.readFile(acceptedSkillCandidate!.publishedPath!, "utf-8");
    expect(publishedSkillContent).toContain("name:");
    const publishedSkillName = /(?:^|\n)name:\s*"([^"\n]+)"/.exec(publishedSkillContent)?.[1];
    expect(publishedSkillName).toBeTruthy();
    expect(skillRegistry.getSkill(publishedSkillName!)).toBeTruthy();

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-accept-again",
      method: "experience.candidate.accept",
      params: { candidateId: methodCandidate!.candidate.id },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-accept-again"));

    const invalidAcceptRes = frames.find((f) => f.type === "res" && f.id === "candidate-accept-again");
    expect(invalidAcceptRes.ok).toBe(false);
    expect(invalidAcceptRes.error.code).toBe("invalid_state");
    expect(invalidAcceptRes.error.message).toContain("Current status: accepted");

    ws.send(JSON.stringify({
      type: "req",
      id: "candidate-stats-after-accept",
      method: "experience.candidate.stats",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-stats-after-accept"));
    const statsAfterAcceptRes = frames.find((f) => f.type === "res" && f.id === "candidate-stats-after-accept");
    expect(statsAfterAcceptRes.ok).toBe(true);
    expect(statsAfterAcceptRes.payload.stats).toMatchObject({
      total: 2,
      methods: 1,
      skills: 1,
      draft: 0,
      accepted: 2,
      rejected: 0,
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
