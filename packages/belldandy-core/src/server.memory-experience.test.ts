import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";
import { MemoryManager, buildDreamConversationArtifactPath, registerGlobalMemoryManager } from "@belldandy/memory";
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
    ? [
      "# Skill Synthesis Template",
      "",
      "```md",
      "---",
      'name: "<skill-name>"',
      'description: "<one-line description>"',
      "---",
      "",
      "# <Skill Title>",
      "",
      "## 快速开始",
      "- 这个技能适合：",
      "- 使用前提：",
      "- 典型收益：",
      "",
      "## 决策路由",
      "- 应该使用：",
      "- 不该使用：",
      "- 遇到冲突时优先：",
      "",
      "## 输入",
      "- 必要输入：",
      "- 可选输入：",
      "- 输入质量要求：",
      "",
      "## 输出",
      "- 直接产物：",
      "- 副产物：",
      "- 质量门槛：",
      "",
      "## 参考指引",
      "- 推荐流程：",
      "- 常见变体：",
      "- 关联文件 / 模板 / 文档：",
      "",
      "## NEVER",
      "- 不要：",
      "- 禁止：",
      "- 高风险边界：",
      "```",
      "",
    ].join("\n")
    : [
      "# Method Synthesis Template",
      "",
      "```md",
      "# <Method Title>",
      "",
      "> <One-line summary>",
      "",
      "## 0. 元信息",
      "- 方法定位：",
      "- 适用对象：",
      "- 维护建议：",
      "",
      "## 1. 触发条件",
      "- ",
      "",
      "## 2. 适用场景",
      "- ",
      "",
      "## 3. 执行步骤",
      "1. ",
      "2. ",
      "3. ",
      "",
      "## 4. 工具选择",
      "- 首选工具：",
      "- 替代工具：",
      "- 选择依据：",
      "",
      "## 5. 失败经验",
      "- 常见误区：",
      "- 失败信号：",
      "- 规避方式：",
      "",
      "## 6. 成功案例",
      "- 案例背景：",
      "- 做法摘要：",
      "- 结果与启示：",
      "",
      "## 7. 相关资源",
      "- 相关技能：",
      "- 相关方法：",
      "- 相关文档 / 路径：",
      "",
      "## 8. 更新记录",
      "- YYYY-MM-DD：初版合成草稿。",
      "```",
      "",
    ].join("\n");
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
  await writeExperienceSynthesisTestTemplate(stateDir, "method");
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
    expect(createdCandidate.content).toContain("## 0. 元信息");
    expect(createdCandidate.content).toContain("## 3. 执行步骤");
    expect(createdCandidate.content).toContain("method-synthesis.md");

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

test("experience.asset.read returns published asset detail with content", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-asset-read-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-asset-read-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  (memoryManager as any).store.createTask({
    id: "task-asset-read-1",
    conversationId: "conv-asset-read-1",
    sessionKey: "session-asset-read-1",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "读取已发布 method 资产",
    objective: "验证 published asset read 能返回正文",
    summary: "method 已发布后应能读取资产详情与 content。",
    reflection: "asset read 用于 overwrite compare。",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 40 }],
    artifactPaths: [],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const promoted = memoryManager.promoteTaskToMethodCandidate("task-asset-read-1");
  expect(promoted?.candidate.id).toBeTruthy();
  const accepted = memoryManager.acceptExperienceCandidate(promoted!.candidate.id);
  expect(accepted?.publishedPath).toBeTruthy();
  registerGlobalMemoryManager(memoryManager);

  try {
    const res = await handleMemoryExperienceMethod({
      type: "req",
      id: "asset-read",
      method: "experience.asset.read",
      params: {
        assetPath: accepted!.publishedPath,
        agentId: "default",
      },
    }, { stateDir });
    expect(res).toBeTruthy();
    if (!res || !res.ok) {
      throw new Error("expected successful experience.asset.read response");
    }
    expect(res.payload?.asset).toMatchObject({
      type: "method",
      publishedPath: accepted!.publishedPath,
      content: expect.stringContaining("# "),
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.accept supports method overwrite publishTargetPath", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-method-overwrite-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-method-overwrite-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  const now = "2026-04-20T00:00:00.000Z";
  const seedTask = {
    agentId: "default",
    source: "chat",
    status: "success",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 40 }],
    artifactPaths: [],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  (memoryManager as any).store.createTask({
    id: "task-method-overwrite-seed",
    conversationId: "conv-method-overwrite-seed",
    sessionKey: "session-method-overwrite-seed",
    title: "Method 原始资产",
    objective: "生成初始 method",
    summary: "先发布一个 method，后续再覆盖。",
    reflection: "seed",
    ...seedTask,
  });
  const seedCandidate = memoryManager.promoteTaskToMethodCandidate("task-method-overwrite-seed");
  const acceptedSeed = memoryManager.acceptExperienceCandidate(seedCandidate!.candidate.id);
  expect(acceptedSeed?.publishedPath).toBeTruthy();

  const overwriteCandidate = memoryManager.createExperienceCandidate({
    id: "exp_method_overwrite_manual",
    taskId: "task-method-overwrite-next",
    type: "method",
    status: "draft",
    title: "Method 覆盖稿",
    slug: "method-overwrite-manual",
    content: buildValidSynthesizedMethodContent("Method 覆盖稿", "覆盖后的新 method 应写回原路径。"),
    summary: "覆盖后的新 method 应写回原路径。",
    sourceTaskSnapshot: {
      taskId: "task-method-overwrite-next",
      conversationId: "conv-method-overwrite-next",
      agentId: "default",
      source: "chat",
      status: "success",
      title: "Method 覆盖稿",
      objective: "生成覆盖 method",
      summary: "覆盖后的新 method 应写回原路径。",
      reflection: "overwrite",
      toolCalls: [{ toolName: "memory_search", success: true, durationMs: 40 }],
      startedAt: now,
      finishedAt: now,
    },
    createdAt: now,
  });
  registerGlobalMemoryManager(memoryManager);

  try {
    const res = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-accept-method-overwrite",
      method: "experience.candidate.accept",
      params: {
        candidateId: overwriteCandidate.id,
        agentId: "default",
        confirmed: true,
        publishTargetPath: acceptedSeed!.publishedPath,
      },
    }, { stateDir });
    expect(res).toBeTruthy();
    if (!res || !res.ok) {
      throw new Error("expected successful overwrite accept response");
    }
    expect(res.payload?.candidate).toMatchObject({
      status: "accepted",
      publishedPath: acceptedSeed!.publishedPath,
    });
    const publishedContent = await fs.promises.readFile(acceptedSeed!.publishedPath!, "utf-8");
    expect(publishedContent).toContain(overwriteCandidate.title);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("experience.candidate.accept supports skill overwrite publishTargetPath", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-skill-overwrite-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-skill-overwrite-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  const skillRegistry = new SkillRegistry();
  const previousSkillPublishConfirm = process.env.BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED;
  delete process.env.BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED;

  const now = "2026-04-20T00:00:00.000Z";
  const seedTask = {
    agentId: "default",
    source: "chat",
    status: "success",
    toolCalls: [{ toolName: "memory_search", success: true, durationMs: 40 }],
    artifactPaths: [],
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  (memoryManager as any).store.createTask({
    id: "task-skill-overwrite-seed",
    conversationId: "conv-skill-overwrite-seed",
    sessionKey: "session-skill-overwrite-seed",
    title: "Skill 原始资产",
    objective: "生成初始 skill",
    summary: "先发布一个 skill，后续再覆盖。",
    reflection: "seed",
    ...seedTask,
  });
  const seedCandidate = memoryManager.promoteTaskToSkillCandidate("task-skill-overwrite-seed");
  registerGlobalMemoryManager(memoryManager);
  const acceptSeedRes = await handleMemoryExperienceMethod({
    type: "req",
    id: "candidate-accept-skill-seed",
    method: "experience.candidate.accept",
    params: {
      candidateId: seedCandidate!.candidate.id,
      agentId: "default",
    },
  }, {
    stateDir,
    skillRegistry,
  });
  if (!acceptSeedRes || !acceptSeedRes.ok) {
    throw new Error(`expected successful skill seed accept response: ${JSON.stringify(acceptSeedRes)}`);
  }
  const acceptedSeed = memoryManager.getExperienceCandidate(seedCandidate!.candidate.id);
  expect(acceptedSeed?.publishedPath).toBeTruthy();

  const overwriteCandidate = memoryManager.createExperienceCandidate({
    id: "exp_skill_overwrite_manual",
    taskId: "task-skill-overwrite-next",
    type: "skill",
    status: "draft",
    title: "Skill 覆盖稿",
    slug: "skill-overwrite-manual",
    content: buildValidSynthesizedSkillContent(
      "Skill 覆盖稿",
      "accepted-skill",
      "覆盖后的新 skill 应写回原路径并保持可加载。",
    ),
    summary: "覆盖后的新 skill 应写回原路径并保持可加载。",
    sourceTaskSnapshot: {
      taskId: "task-skill-overwrite-next",
      conversationId: "conv-skill-overwrite-next",
      agentId: "default",
      source: "chat",
      status: "success",
      title: "Skill 覆盖稿",
      objective: "生成覆盖 skill",
      summary: "覆盖后的新 skill 应写回原路径并保持可加载。",
      reflection: "overwrite",
      toolCalls: [{ toolName: "memory_search", success: true, durationMs: 40 }],
      startedAt: now,
      finishedAt: now,
    },
    createdAt: now,
  });
  registerGlobalMemoryManager(memoryManager);

  try {
    const res = await handleMemoryExperienceMethod({
      type: "req",
      id: "candidate-accept-skill-overwrite",
      method: "experience.candidate.accept",
      params: {
        candidateId: overwriteCandidate.id,
        agentId: "default",
        confirmed: true,
        publishTargetPath: acceptedSeed!.publishedPath,
      },
    }, {
      stateDir,
      skillRegistry,
    });
    expect(res).toBeTruthy();
    if (!res || !res.ok) {
      throw new Error("expected successful skill overwrite accept response");
    }
    expect(res.payload?.candidate).toMatchObject({
      status: "accepted",
      publishedPath: acceptedSeed!.publishedPath,
    });
    const publishedContent = await fs.promises.readFile(acceptedSeed!.publishedPath!, "utf-8");
    expect(publishedContent).toContain("name:");
    const publishedSkillName = /(?:^|\n)name:\s*"([^"\n]+)"/.exec(publishedContent)?.[1];
    expect(publishedSkillName).toBeTruthy();
    expect(skillRegistry.getSkill(publishedSkillName!)).toBeTruthy();
  } finally {
    if (previousSkillPublishConfirm === undefined) {
      delete process.env.BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED;
    } else {
      process.env.BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED = previousSkillPublishConfirm;
    }
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
      sourcePath: "artifacts/dup-b.md",
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
    expect(report?.observability).toMatchObject({
      beforeChunkCount: 3,
      estimatedAfterChunkCount: 2,
    });
    expect(typeof report?.observability?.pageCount).toBe("number");
    expect(typeof report?.observability?.freelistCount).toBe("number");
    expect(report?.sourceIndexingSummary).toMatchObject({
      reindexableSourcePathCount: 1,
      nonReindexableSourcePathCount: 1,
      duplicateGroupsWithReindexableSources: 1,
      duplicateGroupsWithOnlyNonReindexableSources: 0,
    });
    expect(report?.governance).toMatchObject({
      suggestedReviewGroupCount: 1,
      suggestedKeepGroupCount: 0,
      suggestedArchiveGroupCount: 0,
    });
    expect(Array.isArray(report?.groups)).toBe(true);
    expect(report?.groups?.[0]?.keep?.id).toBe("dup-a");
    expect(report?.groups?.[0]?.remove?.map((item: Record<string, unknown>) => item.id)).toEqual(["dup-b"]);
    expect(report?.groups?.[0]?.keep?.sourceIndexing).toMatchObject({
      reindexable: true,
      scope: "state_memory_root",
    });
    expect(report?.groups?.[0]?.governance).toMatchObject({
      suggestedAction: "review",
      reviewRequired: true,
    });
    expect(report?.groups?.[0]?.remove?.[0]?.sourceIndexing).toMatchObject({
      reindexable: false,
      scope: "external",
    });
    expect(report?.groups?.[0]?.sourceIndexing).toMatchObject({
      reindexableSourcePathCount: 1,
      nonReindexableSourcePathCount: 1,
      anyAffectedSourcePathReindexable: true,
      allAffectedSourcePathsReindexable: false,
    });
    expect(memoryManager.countChunks()).toBe(beforeCount);
  } finally {
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.inventory.preview returns readonly builtin and configured source inventory", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-inventory-preview-"));
  const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-inventory-preview-external-"));
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
    await fs.promises.writeFile(path.join(workspaceRoot, "conv-1.digest.json"), "{\"digestGeneration\":1}\n", "utf-8");
    await fs.promises.writeFile(path.join(stateDir, "MEMORY.md"), "# Core Memory\n", "utf-8");
    await fs.promises.writeFile(path.join(externalDir, "kb.md"), "# External KB\n", "utf-8");

    (memoryManager as any).store.createTask({
      id: "task-inventory-preview-1",
      conversationId: "conv-1",
      sessionKey: "conv-1",
      source: "chat",
      status: "success",
      title: "预览 source inventory",
      startedAt: "2026-05-19T11:00:00.000Z",
      finishedAt: "2026-05-19T11:05:00.000Z",
      createdAt: "2026-05-19T11:00:00.000Z",
      updatedAt: "2026-05-19T11:05:00.000Z",
    });
    registerGlobalMemoryManager(memoryManager);

    const response = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-inventory-preview",
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

    expect(response).toBeTruthy();
    if (!response || !response.ok) {
      throw new Error("expected successful memory.inventory.preview response");
    }

    const report = response.payload?.report as Record<string, any> | undefined;
    const governance = response.payload?.governance as Record<string, any> | undefined;
    expect(report?.version).toBe("p10-source-registry-family-v1");
    expect(report?.totals?.sourceKinds).toBeGreaterThanOrEqual(10);
    expect(governance).toMatchObject({
      headline: expect.stringContaining("Memory source"),
      suggestedReviewFamilyCount: expect.any(Number),
      topSuggestedFamilies: expect.any(Array),
    });
    expect(report?.items?.some((item: Record<string, unknown>) =>
      item.id === "builtin:sessions:messages"
      && item.status === "present"
      && item.sourceClass === "raw")).toBe(true);
    expect(report?.items?.some((item: Record<string, unknown>) =>
      item.id === "builtin:db:tasks"
      && item.storage === "database"
      && item.stats
      && typeof item.stats === "object"
      && (item.stats as Record<string, unknown>).rowCount === 1)).toBe(true);
    expect(report?.items?.some((item: Record<string, unknown>) =>
      item.label === "Obsidian Vault"
      && item.sourceKind === "configured_external"
      && item.status === "present")).toBe(true);
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(externalDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.configured_sources.update persists sources and inventory preview reuses them by default", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-configured-sources-"));
  const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-configured-sources-external-"));
  const workspaceRoot = path.join(stateDir, "sessions");
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    await fs.promises.writeFile(path.join(externalDir, "kb.md"), "# External KB\n", "utf-8");
    registerGlobalMemoryManager(memoryManager);

    const updateRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-configured-sources-update",
      method: "memory.configured_sources.update",
      params: {
        configuredSources: [
          {
            label: "Obsidian Vault",
            sourceClass: "curated",
            scope: "private",
            rootPath: externalDir,
            fileExtensions: [".md"],
            note: "persisted source",
          },
        ],
      },
    }, { stateDir });

    expect(updateRes).toBeTruthy();
    if (!updateRes || !updateRes.ok) {
      throw new Error("expected successful memory.configured_sources.update response");
    }
    expect(updateRes.payload).toMatchObject({
      version: 1,
      configuredSources: [
        expect.objectContaining({
          id: "configured:obsidian-vault:1",
          label: "Obsidian Vault",
          rootPath: externalDir,
        }),
      ],
    });

    const getRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-configured-sources-get",
      method: "memory.configured_sources.get",
      params: {},
    }, { stateDir });

    expect(getRes).toBeTruthy();
    if (!getRes || !getRes.ok) {
      throw new Error("expected successful memory.configured_sources.get response");
    }
    expect(getRes.payload).toMatchObject({
      configuredSources: [
        expect.objectContaining({
          id: "configured:obsidian-vault:1",
          label: "Obsidian Vault",
          sourceClass: "curated",
        }),
      ],
    });

    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-inventory-preview-from-config",
      method: "memory.inventory.preview",
      params: {},
    }, { stateDir });

    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful memory.inventory.preview response from persisted config");
    }
    const report = previewRes.payload?.report as Record<string, any> | undefined;
    expect(report?.items?.some((item: Record<string, unknown>) =>
      item.id === "configured:obsidian-vault:1"
      && item.label === "Obsidian Vault"
      && item.sourceKind === "configured_external")).toBe(true);
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(externalDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.report.external_ingest.preview can select persisted configured source by configuredSourceId", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-external-ingest-config-"));
  const externalDirA = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-external-ingest-vault-a-"));
  const externalDirB = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-external-ingest-vault-b-"));
  const workspaceRoot = path.join(stateDir, "sessions");
  const notePath = path.join(externalDirB, "Projects", "viewer-audit.md");
  await fs.promises.mkdir(path.dirname(notePath), { recursive: true });
  await fs.promises.writeFile(path.join(externalDirA, "ignore.md"), "# Ignore\n", "utf-8");
  await fs.promises.writeFile(notePath, "# Viewer Audit\n\nExternal ingest searchable marker.\n", "utf-8");

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    registerGlobalMemoryManager(memoryManager);

    const updateRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-configured-sources-update-for-ingest",
      method: "memory.configured_sources.update",
      params: {
        configuredSources: [
          {
            id: "configured:ignore-vault:1",
            label: "Ignore Vault",
            sourceClass: "raw",
            scope: "private",
            rootPath: externalDirA,
            fileExtensions: [".md"],
          },
          {
            id: "configured:obsidian-vault:2",
            label: "Obsidian Vault",
            sourceClass: "curated",
            scope: "private",
            rootPath: externalDirB,
            fileExtensions: [".md"],
          },
        ],
      },
    }, { stateDir });
    expect(updateRes && updateRes.ok).toBe(true);

    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-preview-from-config",
      method: "memory.tree.report.external_ingest.preview",
      params: {
        configuredSourceId: "configured:obsidian-vault:2",
      },
    }, { stateDir });

    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful memory.tree.report.external_ingest.preview response from persisted config");
    }
    expect(previewRes.payload?.report).toMatchObject({
      sourceId: "configured:obsidian-vault:2",
      totalFiles: 1,
      eligibleFiles: 1,
      rootPath: externalDirB,
    });
    expect(previewRes.payload?.governance).toMatchObject({
      headline: expect.stringContaining("External ingest governance"),
      reviewSuggestionCount: expect.any(Number),
      topSuggestions: expect.any(Array),
    });
    expect(previewRes.payload?.record).toMatchObject({
      reportType: "external_ingest_preview",
      status: "ready",
      summary: expect.objectContaining({
        governance: expect.objectContaining({
          headline: expect.stringContaining("External ingest governance"),
        }),
      }),
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(externalDirA, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(externalDirB, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.report.external_ingest.preview supports single-file markdown configured sources", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-external-file-config-"));
  const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-external-file-source-"));
  const workspaceRoot = path.join(stateDir, "sessions");
  const filePath = path.join(externalDir, "playbook.md");
  await fs.promises.writeFile(filePath, "# Playbook\n\nSingle file external ingest marker.\n", "utf-8");

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    registerGlobalMemoryManager(memoryManager);

    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-file-preview",
      method: "memory.tree.report.external_ingest.preview",
      params: {
        configuredSources: [
          {
            id: "configured:playbook-file:1",
            label: "Playbook File",
            sourceClass: "curated",
            scope: "private",
            filePath,
          },
        ],
      },
    }, { stateDir });

    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error(`expected successful single-file external ingest preview response: ${JSON.stringify(previewRes)}`);
    }
    expect(previewRes.payload?.report).toMatchObject({
      adapter: "markdown_file_v1",
      sourceId: "configured:playbook-file:1",
      totalFiles: 1,
      eligibleFiles: 1,
      rootPath: externalDir,
      rescan: {
        mode: "initial",
      },
    });
    expect(previewRes.payload?.governance).toMatchObject({
      headline: expect.stringContaining("External ingest governance"),
      topSuggestions: expect.any(Array),
    });
    expect(previewRes.payload?.record).toMatchObject({
      reportType: "external_ingest_preview",
      status: "ready",
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(externalDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.report.external_ingest.preview drives approved apply and searchable chunks", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-external-ingest-"));
  const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-external-ingest-vault-"));
  const workspaceRoot = path.join(stateDir, "sessions");
  const notePath = path.join(externalDir, "Projects", "viewer-audit.md");
  const stalePath = path.join(externalDir, "Archive", "retired.md");
  await fs.promises.mkdir(path.dirname(notePath), { recursive: true });
  await fs.promises.mkdir(path.dirname(stalePath), { recursive: true });
  await fs.promises.writeFile(notePath, "# Viewer Audit\n\nExternal ingest searchable marker.\n", "utf-8");
  await fs.promises.writeFile(stalePath, "# Retired\n\nThis note should disappear after rescan.\n", "utf-8");

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    await fs.promises.mkdir(workspaceRoot, { recursive: true });
    registerGlobalMemoryManager(memoryManager);

    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-preview",
      method: "memory.tree.report.external_ingest.preview",
      params: {
        configuredSources: [
          {
            label: "Obsidian Vault",
            sourceClass: "curated",
            scope: "private",
            rootPath: externalDir,
            fileExtensions: [".md"],
          },
        ],
      },
    }, { stateDir });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful memory.tree.report.external_ingest.preview response");
    }
    expect(previewRes.payload?.report).toMatchObject({
      adapter: "obsidian_markdown_directory_v1",
      sourceId: "configured:obsidian-vault:1",
      totalFiles: 2,
      eligibleFiles: 2,
      rescan: {
        mode: "initial",
      },
    });
    expect(previewRes.payload?.record).toMatchObject({
      reportType: "external_ingest_preview",
      status: "ready",
    });

    const reportId = String((previewRes.payload?.record as Record<string, unknown>)?.id || "");
    expect(reportId).toBeTruthy();

    const reviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-review",
      method: "memory.tree.report.review",
      params: {
        reportId,
        decision: "approved",
      },
    }, { stateDir });
    expect(reviewRes).toBeTruthy();
    if (!reviewRes || !reviewRes.ok) {
      throw new Error("expected successful memory.tree.report.review response");
    }
    expect(reviewRes.payload?.report).toMatchObject({
      id: reportId,
      status: "approved",
    });

    const applyRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-apply",
      method: "memory.tree.report.apply",
      params: {
        reportId,
        confirmed: true,
      },
    }, { stateDir });
    expect(applyRes).toBeTruthy();
    if (!applyRes || !applyRes.ok) {
      throw new Error("expected successful memory.tree.report.apply response");
    }
    expect(applyRes.payload?.report).toMatchObject({
      id: reportId,
      status: "applied",
    });
    expect(applyRes.payload?.result).toMatchObject({
      updatedChunkCount: expect.any(Number),
    });

    const searchRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-search",
      method: "memory.search",
      params: {
        query: "searchable marker",
        includeContent: true,
      },
    }, { stateDir });
    expect(searchRes).toBeTruthy();
    if (!searchRes || !searchRes.ok) {
      throw new Error("expected successful memory.search response after external ingest");
    }
    expect(searchRes.payload?.diagnostics).toMatchObject({
      scopeMode: "unified",
      returnedCount: expect.any(Number),
      branches: [
        expect.objectContaining({
          surface: "private",
          diagnostics: expect.objectContaining({
            scoreSignalAppliedCount: expect.any(Number),
            stages: expect.objectContaining({
              returned: expect.objectContaining({
                count: expect.any(Number),
              }),
            }),
          }),
        }),
      ],
    });
    expect(searchRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: notePath,
        metadata: expect.objectContaining({
          memoryTree: expect.objectContaining({
            externalSourceId: "configured:obsidian-vault:1",
          }),
        }),
      }),
    ]));

    const sourceListRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-source-list",
      method: "memory.tree.source.list",
      params: {
        limit: 20,
        filter: {
          ids: ["configured:obsidian-vault:1"],
        },
      },
    }, { stateDir });
    expect(sourceListRes).toBeTruthy();
    if (!sourceListRes || !sourceListRes.ok) {
      throw new Error("expected successful memory.tree.source.list response after external ingest");
    }
    expect(sourceListRes.payload?.items).toEqual([
      expect.objectContaining({
        id: "configured:obsidian-vault:1",
        sourcePath: externalDir,
      }),
    ]);

    await fs.promises.writeFile(notePath, "# Viewer Audit\n\nUpdated searchable marker after rescan.\n", "utf-8");
    await fs.promises.rm(stalePath, { force: true });

    const rescanPreviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-preview-rescan",
      method: "memory.tree.report.external_ingest.preview",
      params: {
        configuredSources: [
          {
            label: "Obsidian Vault",
            sourceClass: "curated",
            scope: "private",
            rootPath: externalDir,
            fileExtensions: [".md"],
          },
        ],
      },
    }, { stateDir });
    expect(rescanPreviewRes).toBeTruthy();
    if (!rescanPreviewRes || !rescanPreviewRes.ok) {
      throw new Error(`expected successful rescan external ingest preview response: ${JSON.stringify(rescanPreviewRes)}`);
    }
    expect(rescanPreviewRes.payload?.report).toMatchObject({
      adapter: "obsidian_markdown_directory_v1",
      sourceId: "configured:obsidian-vault:1",
      totalFiles: 1,
      eligibleFiles: 1,
      rescan: {
        mode: "rescan",
        previousFileCount: 2,
        changedFileCount: 1,
        staleFileCount: 1,
      },
    });
    expect((rescanPreviewRes.payload?.report as Record<string, any>)?.rescan?.staleFiles).toEqual([
      expect.objectContaining({
        path: stalePath,
        reason: "missing_from_preview",
      }),
    ]);

    const rescanReportId = String((rescanPreviewRes.payload?.record as Record<string, unknown>)?.id || "");
    expect(rescanReportId).toBeTruthy();

    const rescanReviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-review-rescan",
      method: "memory.tree.report.review",
      params: {
        reportId: rescanReportId,
        decision: "approved",
      },
    }, { stateDir });
    expect(rescanReviewRes && rescanReviewRes.ok).toBe(true);

    const rescanApplyRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-apply-rescan",
      method: "memory.tree.report.apply",
      params: {
        reportId: rescanReportId,
        confirmed: true,
      },
    }, { stateDir });
    expect(rescanApplyRes).toBeTruthy();
    if (!rescanApplyRes || !rescanApplyRes.ok) {
      throw new Error(`expected successful rescan memory.tree.report.apply response: ${JSON.stringify(rescanApplyRes)}`);
    }
    expect(rescanApplyRes.payload?.result).toMatchObject({
      actions: expect.arrayContaining([
        expect.objectContaining({
          kind: "external_ingest",
          sourcePath: stalePath,
          stale: true,
        }),
      ]),
    });

    const updatedSearchRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-search-updated",
      method: "memory.search",
      params: {
        query: "Updated searchable marker after rescan",
        includeContent: true,
      },
    }, { stateDir });
    if (!updatedSearchRes || !updatedSearchRes.ok) {
      throw new Error(`expected successful updated memory.search response: ${JSON.stringify(updatedSearchRes)}`);
    }
    expect(updatedSearchRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: notePath,
      }),
    ]));

    const staleSearchRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-external-ingest-search-stale",
      method: "memory.search",
      params: {
        query: "This note should disappear after rescan",
        includeContent: true,
      },
    }, { stateDir });
    if (!staleSearchRes || !staleSearchRes.ok) {
      throw new Error(`expected successful stale memory.search response: ${JSON.stringify(staleSearchRes)}`);
    }
    expect((staleSearchRes.payload?.items as Array<Record<string, unknown>> | undefined)?.some((item) => item.sourcePath === stalePath)).toBe(false);
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(externalDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree source and score rebuild methods persist phase-1 registry data", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-phase1-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-phase1-workspace-"));
  const memoryDir = path.join(stateDir, "memory");
  const externalPath = path.join(workspaceRoot, "external.md");
  await fs.promises.mkdir(memoryDir, { recursive: true });
  await fs.promises.writeFile(path.join(memoryDir, "2026-05-19.md"), "# Daily Memory\nphase1 source\n", "utf-8");
  await fs.promises.writeFile(externalPath, "# External\nphase1 score\n", "utf-8");

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "tree-phase1-daily",
      sourcePath: path.join(memoryDir, "2026-05-19.md"),
      sourceType: "file",
      memoryType: "daily",
      content: "daily memory mentions docs/path.md and task tool prompt",
      visibility: "shared",
    });
    memoryManager.upsertMemoryChunk({
      id: "tree-phase1-external",
      sourcePath: externalPath,
      sourceType: "file",
      memoryType: "other",
      content: "external plan for agent tool execution",
    });

    (memoryManager as any).store.createTask({
      id: "task-tree-phase1-1",
      conversationId: "conv-tree-phase1-1",
      sessionKey: "conv-tree-phase1-1",
      source: "chat",
      status: "success",
      title: "重建 P9 tree source registry",
      startedAt: "2026-05-19T13:00:00.000Z",
      finishedAt: "2026-05-19T13:05:00.000Z",
      createdAt: "2026-05-19T13:00:00.000Z",
      updatedAt: "2026-05-19T13:05:00.000Z",
    });
    (memoryManager as any).store.linkTaskMemory("task-tree-phase1-1", "tree-phase1-daily", "used");
    registerGlobalMemoryManager(memoryManager);

    const rebuildSourceRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-source-rebuild",
      method: "memory.tree.source.rebuild",
      params: {},
    }, { stateDir });
    expect(rebuildSourceRes).toBeTruthy();
    if (!rebuildSourceRes || !rebuildSourceRes.ok) {
      throw new Error("expected successful memory.tree.source.rebuild response");
    }
    expect(rebuildSourceRes.payload?.result).toMatchObject({
      inventorySources: expect.any(Number),
      dynamicSources: 1,
    });

    const listSourceRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-source-list",
      method: "memory.tree.source.list",
      params: {
        limit: 50,
      },
    }, { stateDir });
    expect(listSourceRes).toBeTruthy();
    if (!listSourceRes || !listSourceRes.ok) {
      throw new Error("expected successful memory.tree.source.list response");
    }
    expect(listSourceRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "builtin:memory:daily-notes",
        sourceKind: "memory_notes",
      }),
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: externalPath,
      }),
    ]));

    const rebuildScoreRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-score-rebuild",
      method: "memory.tree.score.rebuild",
      params: {},
    }, { stateDir });
    expect(rebuildScoreRes).toBeTruthy();
    if (!rebuildScoreRes || !rebuildScoreRes.ok) {
      throw new Error("expected successful memory.tree.score.rebuild response");
    }
    expect(rebuildScoreRes.payload?.result).toMatchObject({
      scoreVersion: "v1_rule_only",
      totalScores: 2,
    });

    const listScoreRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-score-list",
      method: "memory.tree.score.list",
      params: {
        limit: 10,
        filter: {
          targetType: "chunk",
        },
      },
    }, { stateDir });
    expect(listScoreRes).toBeTruthy();
    if (!listScoreRes || !listScoreRes.ok) {
      throw new Error("expected successful memory.tree.score.list response");
    }
    expect(listScoreRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: "tree-phase1-daily",
        sourceId: "builtin:memory:daily-notes",
        scoreVersion: "v1_rule_only",
      }),
      expect.objectContaining({
        targetId: "tree-phase1-external",
        scoreVersion: "v1_rule_only",
      }),
    ]));
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree report and node methods persist reports, export markdown, and expose task nodes", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-phase2-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-phase2-workspace-"));
  const memoryDir = path.join(stateDir, "memory");
  await fs.promises.mkdir(memoryDir, { recursive: true });
  await fs.promises.writeFile(path.join(memoryDir, "2026-05-20.md"), "# Daily Memory\nphase2 report\n", "utf-8");

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "tree-phase2-a",
      sourcePath: path.join(memoryDir, "2026-05-20.md"),
      sourceType: "file",
      memoryType: "daily",
      content: "phase2 duplicate report line\nnext line",
      visibility: "shared",
    });
    memoryManager.upsertMemoryChunk({
      id: "tree-phase2-b",
      sourcePath: path.join(workspaceRoot, "duplicate.md"),
      sourceType: "file",
      memoryType: "other",
      content: "phase2 duplicate report line\r\nnext line",
    });

    (memoryManager as any).store.createTask({
      id: "task-tree-phase2-1",
      conversationId: "conv-tree-phase2-1",
      sessionKey: "conv-tree-phase2-1",
      source: "chat",
      status: "partial",
      title: "重建 P10 task node",
      summary: "当前停在 report export 与 node get。",
      startedAt: "2026-05-19T15:00:00.000Z",
      finishedAt: "2026-05-19T15:05:00.000Z",
      createdAt: "2026-05-19T15:00:00.000Z",
      updatedAt: "2026-05-19T15:05:00.000Z",
    });
    (memoryManager as any).store.linkTaskMemory("task-tree-phase2-1", "tree-phase2-a", "used");
    registerGlobalMemoryManager(memoryManager);

    const inventoryPreviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-inventory-preview",
      method: "memory.tree.report.inventory.preview",
      params: {},
    }, { stateDir });
    expect(inventoryPreviewRes).toBeTruthy();
    if (!inventoryPreviewRes || !inventoryPreviewRes.ok) {
      throw new Error("expected successful memory.tree.report.inventory.preview response");
    }
    expect(inventoryPreviewRes.payload?.record).toMatchObject({
      reportType: "inventory",
      status: "ready",
    });
    expect(inventoryPreviewRes.payload?.governance).toMatchObject({
      headline: expect.stringContaining("Memory source"),
      topSuggestedFamilies: expect.any(Array),
    });

    const dedupPreviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-dedup-preview",
      method: "memory.tree.report.dedup.preview",
      params: {
        maxGroups: 10,
      },
    }, { stateDir });
    expect(dedupPreviewRes).toBeTruthy();
    if (!dedupPreviewRes || !dedupPreviewRes.ok) {
      throw new Error("expected successful memory.tree.report.dedup.preview response");
    }
    const dedupRecord = dedupPreviewRes.payload?.record as Record<string, any> | undefined;
    expect(dedupRecord).toMatchObject({
      reportType: "dedup_preview",
      status: "ready",
      summary: expect.objectContaining({
        governance: expect.objectContaining({
          headline: expect.stringContaining("Memory dedup"),
        }),
      }),
      details: expect.objectContaining({
        governance: expect.objectContaining({
          groupCount: expect.any(Number),
          topSuggestedGroups: expect.any(Array),
        }),
      }),
    });
    const dedupReportId = String(dedupRecord?.id ?? "");
    expect(dedupReportId.length).toBeGreaterThan(0);

    const reportListRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-list",
      method: "memory.tree.report.list",
      params: {
        limit: 10,
      },
    }, { stateDir });
    expect(reportListRes).toBeTruthy();
    if (!reportListRes || !reportListRes.ok) {
      throw new Error("expected successful memory.tree.report.list response");
    }
    expect(reportListRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ reportType: "inventory" }),
      expect.objectContaining({ reportType: "dedup_preview" }),
    ]));

    const reportGetRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-get",
      method: "memory.tree.report.get",
      params: {
        reportId: dedupReportId,
      },
    }, { stateDir });
    expect(reportGetRes).toBeTruthy();
    if (!reportGetRes || !reportGetRes.ok) {
      throw new Error("expected successful memory.tree.report.get response");
    }
    expect(reportGetRes.payload?.report).toMatchObject({
      id: dedupReportId,
      reportType: "dedup_preview",
    });

    const exportRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-export",
      method: "memory.tree.report.export_markdown",
      params: {
        reportId: dedupReportId,
      },
    }, { stateDir });
    expect(exportRes).toBeTruthy();
    if (!exportRes || !exportRes.ok) {
      throw new Error("expected successful memory.tree.report.export_markdown response");
    }
    expect(exportRes.payload?.markdownPath).toContain(path.join("reports", "memory-tree"));
    expect(path.basename(String(exportRes.payload?.markdownPath ?? ""))).not.toContain(":");
    const exportedContent = await fs.promises.readFile(String(exportRes.payload?.markdownPath ?? ""), "utf-8");
    expect(exportedContent).toContain("# Memory Tree Report");

    const nodeRebuildRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-node-rebuild",
      method: "memory.tree.node.rebuild",
      params: {
        limit: 20,
      },
    }, { stateDir });
    expect(nodeRebuildRes).toBeTruthy();
    if (!nodeRebuildRes || !nodeRebuildRes.ok) {
      throw new Error("expected successful memory.tree.node.rebuild response");
    }
    expect(nodeRebuildRes.payload?.result).toMatchObject({
      kind: "task",
      totalNodes: 1,
      totalEdges: 1,
    });

    const nodeListRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-node-list",
      method: "memory.tree.node.list",
      params: {
        limit: 10,
        filter: {
          kind: "task",
        },
      },
    }, { stateDir });
    expect(nodeListRes).toBeTruthy();
    if (!nodeListRes || !nodeListRes.ok) {
      throw new Error("expected successful memory.tree.node.list response");
    }
    expect(nodeListRes.payload?.items).toEqual([
      expect.objectContaining({
        id: "task:task-tree-phase2-1",
        kind: "task",
      }),
    ]);

    const nodeGetRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-node-get",
      method: "memory.tree.node.get",
      params: {
        nodeId: "task:task-tree-phase2-1",
      },
    }, { stateDir });
    expect(nodeGetRes).toBeTruthy();
    if (!nodeGetRes || !nodeGetRes.ok) {
      throw new Error("expected successful memory.tree.node.get response");
    }
    expect(nodeGetRes.payload?.node).toMatchObject({
      id: "task:task-tree-phase2-1",
      summaryVersion: "p10-task-node-v1",
    });
    expect(nodeGetRes.payload?.edges).toEqual([
      expect.objectContaining({
        childId: "tree-phase2-a",
        relation: "contains",
      }),
    ]);
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.node.search returns P13 topic nodes with chunk provenance", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-topic-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-topic-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "topic-node-low",
      sourcePath: path.join(workspaceRoot, "viewer-audit-outline.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer-audit",
      content: "viewer audit baseline notes",
    });
    memoryManager.upsertMemoryChunk({
      id: "topic-node-high",
      sourcePath: path.join(workspaceRoot, "viewer-audit-summary.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer-audit",
      content: "viewer audit final checklist",
    });
    memoryManager.upsertMemoryChunk({
      id: "topic-node-other",
      sourcePath: path.join(workspaceRoot, "release-gate.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "release-gate",
      content: "release gate notes",
    });

    (memoryManager as any).store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:topic-node-low",
        targetType: "chunk",
        targetId: "topic-node-low",
        scoreTotal: 0.2,
        sourceWeightScore: 0.1,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
        createdAt: "2026-05-19T16:00:00.000Z",
        updatedAt: "2026-05-19T16:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:topic-node-high",
        targetType: "chunk",
        targetId: "topic-node-high",
        scoreTotal: 0.9,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
        createdAt: "2026-05-19T16:00:00.000Z",
        updatedAt: "2026-05-19T16:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:topic-node-other",
        targetType: "chunk",
        targetId: "topic-node-other",
        scoreTotal: 0.4,
        sourceWeightScore: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
        createdAt: "2026-05-19T16:00:00.000Z",
        updatedAt: "2026-05-19T16:00:00.000Z",
      },
    ]);
    registerGlobalMemoryManager(memoryManager);

    const rebuildRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-topic-node-rebuild",
      method: "memory.tree.node.rebuild",
      params: {
        limit: 20,
        kind: "topic",
      },
    }, { stateDir });
    expect(rebuildRes).toBeTruthy();
    if (!rebuildRes || !rebuildRes.ok) {
      throw new Error("expected successful memory.tree.node.rebuild topic response");
    }
    expect(rebuildRes.payload?.result).toMatchObject({
      kind: "topic",
      totalNodes: 2,
      totalEdges: 6,
    });

    const searchRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-topic-node-search",
      method: "memory.tree.node.search",
      params: {
        query: "viewer audit",
        limit: 5,
        chunkLimitPerNode: 5,
        filter: {
          kind: "topic",
        },
      },
    }, { stateDir });
    expect(searchRes).toBeTruthy();
    if (!searchRes || !searchRes.ok) {
      throw new Error("expected successful memory.tree.node.search response");
    }
    const searchPayload = (searchRes.payload ?? {}) as Record<string, any>;
    const searchItems = Array.isArray(searchPayload.items) ? searchPayload.items : [];
    expect(searchItems).toHaveLength(1);
    expect(searchItems[0]).toMatchObject({
      node: expect.objectContaining({
        kind: "topic",
        summaryVersion: "p20-topic-node-v1",
        topicKey: "viewer-audit",
        metadata: expect.objectContaining({
          topic: "viewer-audit",
          totalChunkCount: 2,
        }),
      }),
      matchReasons: expect.arrayContaining(["标题", "topic"]),
    });
    const searchChunks = Array.isArray(searchItems[0]?.chunks) ? searchItems[0].chunks : [];
    expect(searchChunks.map((item: Record<string, unknown>) => item.id)).toEqual([
      "topic-node-high",
      "topic-node-low",
    ]);
    const searchSources = Array.isArray(searchItems[0]?.sources) ? searchItems[0].sources : [];
    expect(searchSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("viewer-audit-outline.md"),
      }),
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("viewer-audit-summary.md"),
      }),
    ]));

    const topicNodeId = String(searchItems[0]?.node?.id ?? "");
    expect(topicNodeId.length).toBeGreaterThan(0);

    const getRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-topic-node-get",
      method: "memory.tree.node.get",
      params: {
        nodeId: topicNodeId,
        chunkLimit: 5,
      },
    }, { stateDir });
    expect(getRes).toBeTruthy();
    if (!getRes || !getRes.ok) {
      throw new Error("expected successful memory.tree.node.get topic response");
    }
    const getPayload = (getRes.payload ?? {}) as Record<string, any>;
    expect(getPayload.node).toMatchObject({
      id: topicNodeId,
      summaryVersion: "p20-topic-node-v1",
    });
    const getEdges = Array.isArray(getPayload.edges) ? getPayload.edges : [];
    expect(getEdges
      .filter((item: Record<string, unknown>) => item.childType === "chunk")
      .map((item: Record<string, unknown>) => item.childId)).toEqual([
      "topic-node-high",
      "topic-node-low",
    ]);
    const getChunks = Array.isArray(getPayload.chunks) ? getPayload.chunks : [];
    expect(getChunks.map((item: Record<string, unknown>) => item.id)).toEqual([
      "topic-node-high",
      "topic-node-low",
    ]);
    const getSources = Array.isArray(getPayload.sources) ? getPayload.sources : [];
    expect(getSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("viewer-audit-outline.md"),
      }),
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("viewer-audit-summary.md"),
      }),
    ]));
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.node.rebuild/search/get supports R1 project nodes with chunk provenance", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-project-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-project-workspace-"));
  const scopedAgentId = "project-r1";
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "project-node-low",
      sourcePath: path.join(workspaceRoot, "goal-alpha-outline.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal alpha outline and baseline notes",
    });
    memoryManager.upsertMemoryChunk({
      id: "project-node-high",
      sourcePath: path.join(workspaceRoot, "goal-alpha-summary.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal alpha final summary and completion checklist",
    });
    memoryManager.upsertMemoryChunk({
      id: "project-node-other",
      sourcePath: path.join(workspaceRoot, "goal-beta-review.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal beta review notes",
    });

    const store = (memoryManager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:project-node-low",
        targetType: "chunk",
        targetId: "project-node-low",
        scoreTotal: 0.2,
        sourceWeightScore: 0.1,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
        createdAt: "2026-05-20T09:00:00.000Z",
        updatedAt: "2026-05-20T09:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:project-node-high",
        targetType: "chunk",
        targetId: "project-node-high",
        scoreTotal: 0.9,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
        createdAt: "2026-05-20T10:00:00.000Z",
        updatedAt: "2026-05-20T10:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:project-node-other",
        targetType: "chunk",
        targetId: "project-node-other",
        scoreTotal: 0.5,
        sourceWeightScore: 0.3,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
        createdAt: "2026-05-21T11:00:00.000Z",
        updatedAt: "2026-05-21T11:00:00.000Z",
      },
    ]);
    store.createTask({
      id: "project-node-task-1",
      conversationId: "goal:alpha:conv",
      sessionKey: "goal:alpha:conv",
      agentId: "coder",
      source: "chat",
      status: "partial",
      title: "Investigate goal alpha",
      summary: "Outline the current goal alpha state.",
      metadata: { goalId: "goal-alpha", goalSession: true },
      startedAt: "2026-05-20T09:00:00.000Z",
      finishedAt: "2026-05-20T09:10:00.000Z",
      createdAt: "2026-05-20T09:00:00.000Z",
      updatedAt: "2026-05-20T09:10:00.000Z",
    });
    store.createTask({
      id: "project-node-task-2",
      conversationId: "goal:alpha:conv",
      sessionKey: "goal:alpha:conv",
      agentId: "coder",
      source: "chat",
      status: "success",
      title: "Finish goal alpha",
      summary: "Deliver the goal alpha final summary.",
      metadata: { goalId: "goal-alpha", goalSession: true },
      startedAt: "2026-05-20T10:00:00.000Z",
      finishedAt: "2026-05-20T10:30:00.000Z",
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:30:00.000Z",
    });
    store.createTask({
      id: "project-node-task-3",
      conversationId: "goal:beta:conv",
      sessionKey: "goal:beta:conv",
      agentId: "reviewer",
      source: "chat",
      status: "partial",
      title: "Review goal beta",
      summary: "Check goal beta regression risk.",
      metadata: { goalId: "goal-beta" },
      startedAt: "2026-05-21T11:00:00.000Z",
      finishedAt: "2026-05-21T11:20:00.000Z",
      createdAt: "2026-05-21T11:00:00.000Z",
      updatedAt: "2026-05-21T11:20:00.000Z",
    });
    store.linkTaskMemory("project-node-task-1", "project-node-low", "used");
    store.linkTaskMemory("project-node-task-2", "project-node-high", "generated");
    store.linkTaskMemory("project-node-task-3", "project-node-other", "used");
    registerGlobalMemoryManager(memoryManager, { agentId: scopedAgentId });

    const rebuildRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-project-node-rebuild",
      method: "memory.tree.node.rebuild",
      params: {
        agentId: scopedAgentId,
        limit: 20,
        kind: "project",
      },
    }, { stateDir });
    expect(rebuildRes).toBeTruthy();
    if (!rebuildRes || !rebuildRes.ok) {
      throw new Error("expected successful memory.tree.node.rebuild project response");
    }
    expect(rebuildRes.payload?.result).toMatchObject({
      kind: "project",
      totalNodes: 2,
      totalEdges: 3,
    });

    const searchRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-project-node-search",
      method: "memory.tree.node.search",
      params: {
        agentId: scopedAgentId,
        query: "goal-alpha",
        limit: 5,
        chunkLimitPerNode: 5,
        filter: {
          kind: "project",
        },
      },
    }, { stateDir });
    expect(searchRes).toBeTruthy();
    if (!searchRes || !searchRes.ok) {
      throw new Error("expected successful memory.tree.node.search project response");
    }
    const searchPayload = (searchRes.payload ?? {}) as Record<string, any>;
    const searchItems = Array.isArray(searchPayload.items) ? searchPayload.items : [];
    const goalAlphaProject = searchItems.find((item: Record<string, any>) => item?.node?.topicKey === "goal-alpha");
    expect(goalAlphaProject).toBeTruthy();
    expect(goalAlphaProject).toMatchObject({
      node: expect.objectContaining({
        kind: "project",
        summaryVersion: "p17-project-node-v1",
        topicKey: "goal-alpha",
        metadata: expect.objectContaining({
          goalId: "goal-alpha",
          taskCount: 2,
        }),
      }),
    });
    expect(goalAlphaProject?.chunks.map((item: Record<string, unknown>) => item.id)).toEqual([
      "project-node-high",
      "project-node-low",
    ]);

    const projectNodeId = String(goalAlphaProject?.node?.id ?? "");
    expect(projectNodeId.length).toBeGreaterThan(0);

    const getRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-project-node-get",
      method: "memory.tree.node.get",
      params: {
        agentId: scopedAgentId,
        nodeId: projectNodeId,
        chunkLimit: 5,
      },
    }, { stateDir });
    expect(getRes).toBeTruthy();
    if (!getRes || !getRes.ok) {
      throw new Error("expected successful memory.tree.node.get project response");
    }
    const getPayload = (getRes.payload ?? {}) as Record<string, any>;
    expect(getPayload.node).toMatchObject({
      id: projectNodeId,
      summaryVersion: "p17-project-node-v1",
    });
    const getChunks = Array.isArray(getPayload.chunks) ? getPayload.chunks : [];
    expect(getChunks.map((item: Record<string, unknown>) => item.id)).toEqual([
      "project-node-high",
      "project-node-low",
    ]);
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.search exposes R2 node-assisted diagnostics through resident memory branches", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-search-r2-"));
  const residentMemoryManagers = createScopedMemoryManagers({
    taskMemoryEnabled: true,
    nodeAssistedRetrievalEnabled: true,
    stateDir,
    modelsDir: path.join(stateDir, "models"),
    conversationStore: new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
    }),
    indexerOptions: {
      watch: false,
    },
  });
  const defaultRecord = residentMemoryManagers.records.find((record) => record.agentId === "default");
  if (!defaultRecord) {
    throw new Error("default resident memory manager is required for R2 memory.search test");
  }
  const memoryManager = defaultRecord.manager;
  const workspaceRoot = defaultRecord.stateDir;

  try {
    memoryManager.upsertMemoryChunk({
      id: "r2-project-high",
      sourcePath: path.join(workspaceRoot, "goal-alpha-summary.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal alpha final summary and completion checklist",
    });
    memoryManager.upsertMemoryChunk({
      id: "r2-raw-fallback",
      sourcePath: path.join(workspaceRoot, "fallback-notes.md"),
      sourceType: "file",
      memoryType: "other",
      content: "fallback raw notes for goal alpha search",
    });

    const store = (memoryManager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
      searchHybrid: (...args: any[]) => Array<Record<string, unknown>>;
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:r2-project-high",
        targetType: "chunk",
        targetId: "r2-project-high",
        scoreTotal: 0.95,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
      {
        id: "score:v1_rule_only:chunk:r2-raw-fallback",
        targetType: "chunk",
        targetId: "r2-raw-fallback",
        scoreTotal: 0.35,
        sourceWeightScore: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
      },
    ]);
    store.createTask({
      id: "r2-memory-search-task",
      conversationId: "goal:alpha:conv",
      sessionKey: "goal:alpha:conv",
      agentId: "coder",
      source: "chat",
      status: "success",
      title: "Finish goal alpha",
      summary: "Deliver the goal alpha final summary.",
      metadata: { goalId: "goal-alpha", goalSession: true },
      startedAt: "2026-05-20T10:00:00.000Z",
      finishedAt: "2026-05-20T10:30:00.000Z",
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:30:00.000Z",
    });
    store.linkTaskMemory("r2-memory-search-task", "r2-project-high", "generated");
    memoryManager.rebuildMemoryTreeNodes({ limit: 10, kind: "project" });

    const originalSearchHybrid = store.searchHybrid.bind(store);
    store.searchHybrid = () => [
      {
        id: "r2-raw-fallback",
        sourcePath: path.join(workspaceRoot, "fallback-notes.md"),
        sourceType: "file",
        memoryType: "other",
        snippet: "fallback raw notes for goal alpha search",
        summary: "fallback raw summary",
        score: 0.74,
        metadata: {},
        updatedAt: "2026-05-20T09:00:00.000Z",
      },
    ] as any;

    try {
      const searchRes = await handleMemoryExperienceMethod({
        type: "req",
        id: "memory-search-r2-node-assisted",
        method: "memory.search",
        params: {
          agentId: "default",
          query: "goal-alpha",
          limit: 2,
          includeContent: false,
        },
      }, { stateDir, residentMemoryManagers: residentMemoryManagers.records });
      expect(searchRes).toBeTruthy();
      if (!searchRes || !searchRes.ok) {
        throw new Error("expected successful memory.search response for R2 node-assisted routing");
      }
      const searchPayload = (searchRes.payload ?? {}) as Record<string, any>;
      expect(searchPayload.items?.map((item: Record<string, unknown>) => item.id)).toEqual([
        "r2-project-high",
        "r2-raw-fallback",
      ]);
      expect(searchPayload.items?.[0]?.metadata?.memoryTree).toMatchObject({
        nodeHit: {
          kind: "project",
        },
      });
      expect(searchPayload.diagnostics).toMatchObject({
        scopeMode: "merged_all",
        sharedManagerUsed: true,
        returnedCount: 2,
      });
      const privateBranch = searchPayload.diagnostics?.branches?.find(
        (branch: Record<string, unknown>) => branch.surface === "private",
      );
      expect(privateBranch).toBeTruthy();
      expect(privateBranch).toMatchObject({
        surface: "private",
        diagnostics: expect.objectContaining({
          routingPolicy: "node_assisted",
          nodeAssisted: expect.objectContaining({
            enabled: true,
            injectedChunkCount: 1,
            fallbackApplied: true,
            returnedMix: {
              nodeBacked: 1,
              chunkOnly: 1,
            },
          }),
        }),
      });
      expect(privateBranch?.diagnostics?.nodeAssisted?.nodeHitCount ?? 0).toBeGreaterThanOrEqual(1);
      expect(privateBranch?.diagnostics?.nodeAssisted?.selectedNodeIds).toEqual(
        expect.arrayContaining([expect.stringMatching(/^project:/)]),
      );
      expect(privateBranch?.diagnostics?.nodeAssisted?.topNodeHits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "project",
            chunkCount: 1,
          }),
        ]),
      );
    } finally {
      store.searchHybrid = originalSearchHybrid;
    }
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.search returns session-derived resume results through the RPC surface", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-search-session-derived-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-search-session-derived-workspace-"));
  const sessionsDir = path.join(stateDir, "sessions");
  await fs.promises.mkdir(sessionsDir, { recursive: true });

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  registerGlobalMemoryManager(memoryManager);

  try {
    const conversationId = "agent:coder:main";
    const sessionMemoryPath = buildDreamConversationArtifactPath({
      sessionsDir,
      conversationId,
      suffix: ".session-memory.json",
    });
    await fs.promises.writeFile(
      sessionMemoryPath,
      JSON.stringify({
        summary: "Working on the unified retrieval rollout.",
        currentGoal: "Bring continuation context into memory.search.",
        currentWork: "Task-derived results are already wired.",
        nextStep: "Continue viewer lazy loading and add regression validation.",
        pendingTasks: ["Wire session digest and session memory into retrieval"],
        updatedAt: Date.parse("2026-05-21T11:20:00.000Z"),
      }),
      "utf-8",
    );
    const safeConversationId = path.basename(sessionMemoryPath, ".session-memory.json");
    await fs.promises.writeFile(
      path.join(sessionsDir, `${safeConversationId}.meta.json`),
      JSON.stringify({ conversationId }),
      "utf-8",
    );

    const searchRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-search-session-derived",
      method: "memory.search",
      params: {
        query: "viewer lazy loading",
        includeContent: false,
      },
    }, { stateDir });
    expect(searchRes).toBeTruthy();
    if (!searchRes || !searchRes.ok) {
      throw new Error("expected successful memory.search response for session-derived retrieval");
    }
    expect(searchRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "session_derived",
        metadata: expect.objectContaining({
          derivedRetrieval: expect.objectContaining({
            conversationId,
            kind: "session_memory_resume",
            sourceKind: "session_memory",
          }),
          memoryTree: expect.objectContaining({
            sourceClass: "derived",
            sourceKind: "session_memory",
          }),
        }),
      }),
    ]));
    expect(searchRes.payload?.diagnostics).toMatchObject({
      branches: expect.arrayContaining([
        expect.objectContaining({
          surface: "private",
          diagnostics: expect.objectContaining({
            stages: expect.objectContaining({
              raw: expect.objectContaining({
                count: expect.any(Number),
                topHits: expect.arrayContaining([
                  expect.objectContaining({
                    sourceClass: "derived",
                  }),
                ]),
              }),
            }),
          }),
        }),
      ]),
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.search returns accepted experience-derived results through the RPC surface", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-search-experience-derived-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-search-experience-derived-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  registerGlobalMemoryManager(memoryManager);

  try {
    memoryManager.createExperienceCandidate({
      id: "exp_rpc_viewer_rollout",
      taskId: "task-rpc-viewer-rollout",
      type: "method",
      status: "accepted",
      title: "Viewer Lazy Loading Rollout",
      slug: "viewer-lazy-loading-rollout",
      summary: "Use staged rollout plus regression validation for viewer lazy loading.",
      content: [
        "# Viewer Lazy Loading Rollout",
        "",
        "## Trigger",
        "- viewer lazy loading blocks resume flow",
        "",
        "## Steps",
        "1. continue viewer lazy loading wiring",
        "2. add regression validation",
      ].join("\n"),
      qualityScore: 91,
      sourceTaskSnapshot: {
        taskId: "task-rpc-viewer-rollout",
        conversationId: "conv-rpc-viewer-rollout",
        source: "chat",
        status: "success",
        title: "viewer rollout",
        summary: "完成 viewer lazy loading rollout。",
        outcome: "viewer lazy loading ready",
        startedAt: "2026-05-21T09:00:00.000Z",
        finishedAt: "2026-05-21T10:00:00.000Z",
      },
      publishedPath: path.join(stateDir, "methods", "Viewer Lazy Loading Rollout.md"),
      createdAt: "2026-05-21T10:00:00.000Z",
      reviewedAt: "2026-05-21T10:10:00.000Z",
      acceptedAt: "2026-05-21T10:12:00.000Z",
    });

    const searchRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-search-experience-derived",
      method: "memory.search",
      params: {
        query: "viewer lazy loading",
        includeContent: false,
      },
    }, { stateDir });
    expect(searchRes).toBeTruthy();
    if (!searchRes || !searchRes.ok) {
      throw new Error("expected successful memory.search response for experience-derived retrieval");
    }
    expect(searchRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "derived-experience:exp_rpc_viewer_rollout",
        sourceType: "experience_derived",
        metadata: expect.objectContaining({
          derivedRetrieval: expect.objectContaining({
            candidateId: "exp_rpc_viewer_rollout",
            candidateType: "method",
            candidateStatus: "accepted",
          }),
          memoryTree: expect.objectContaining({
            sourceClass: "curated",
            sourceKind: "experience_candidates",
          }),
        }),
      }),
    ]));
    expect(searchRes.payload?.diagnostics).toMatchObject({
      branches: expect.arrayContaining([
        expect.objectContaining({
          surface: "private",
          diagnostics: expect.objectContaining({
            stages: expect.objectContaining({
              raw: expect.objectContaining({
                topHits: expect.arrayContaining([
                  expect.objectContaining({
                    sourceClass: "curated",
                  }),
                ]),
              }),
            }),
          }),
        }),
      ]),
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.report.review and apply close the P14 dedup governance loop", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-report-apply-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-report-apply-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "p14-core-keep",
      sourcePath: path.join(stateDir, "memory", "2026-05-19.md"),
      sourceType: "manual",
      memoryType: "daily",
      content: "governance duplicate payload\nline two",
      visibility: "shared",
    });
    memoryManager.upsertMemoryChunk({
      id: "p14-core-remove",
      sourcePath: path.join(workspaceRoot, "duplicate.md"),
      sourceType: "manual",
      memoryType: "daily",
      content: "governance duplicate payload\r\nline two",
      visibility: "private",
    });

    (memoryManager as any).store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p14-core-keep",
        targetType: "chunk",
        targetId: "p14-core-keep",
        scoreTotal: 0.85,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
        createdAt: "2026-05-19T17:00:00.000Z",
        updatedAt: "2026-05-19T17:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:p14-core-remove",
        targetType: "chunk",
        targetId: "p14-core-remove",
        scoreTotal: 0.8,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
        createdAt: "2026-05-19T17:00:00.000Z",
        updatedAt: "2026-05-19T17:00:00.000Z",
      },
    ]);
    registerGlobalMemoryManager(memoryManager);

    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-dedup-preview-p14",
      method: "memory.tree.report.dedup.preview",
      params: {
        filter: { memoryType: "daily" },
        maxGroups: 10,
      },
    }, { stateDir });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error("expected successful memory.tree.report.dedup.preview response");
    }
    const previewPayload = (previewRes.payload ?? {}) as Record<string, any>;
    const previewRecord = (previewPayload.record ?? {}) as Record<string, any>;
    const reportId = String(previewRecord.id ?? "");
    expect(reportId.length).toBeGreaterThan(0);
    expect(previewRecord.summary).toMatchObject({
      governance: expect.objectContaining({
        suggestedArchiveGroupCount: 1,
        suggestedReviewGroupCount: 0,
      }),
    });

    const reviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-review-p14",
      method: "memory.tree.report.review",
      params: {
        reportId,
        decision: "approved",
        reviewedBy: "tester",
        note: "approve metadata-only governance apply",
      },
    }, { stateDir });
    expect(reviewRes).toBeTruthy();
    if (!reviewRes || !reviewRes.ok) {
      throw new Error(`expected successful memory.tree.report.review response: ${JSON.stringify(reviewRes)}`);
    }
    const reviewPayload = (reviewRes.payload ?? {}) as Record<string, any>;
    expect(reviewPayload.report).toMatchObject({
      id: reportId,
      status: "approved",
    });

    const blockedApplyRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-apply-blocked-p14",
      method: "memory.tree.report.apply",
      params: {
        reportId,
      },
    }, { stateDir });
    expect(blockedApplyRes).toBeTruthy();
    if (!blockedApplyRes || blockedApplyRes.ok) {
      throw new Error("expected confirmation_required memory.tree.report.apply response");
    }
    expect(blockedApplyRes.error.code).toBe("confirmation_required");

    const applyRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-report-apply-p14",
      method: "memory.tree.report.apply",
      params: {
        reportId,
        confirmed: true,
        appliedBy: "tester",
        note: "apply metadata and score only",
      },
    }, { stateDir });
    expect(applyRes).toBeTruthy();
    if (!applyRes || !applyRes.ok) {
      throw new Error(`expected successful memory.tree.report.apply response: ${JSON.stringify(applyRes)}`);
    }
    const applyPayload = (applyRes.payload ?? {}) as Record<string, any>;
    expect(applyPayload.report).toMatchObject({
      id: reportId,
      status: "applied",
    });
    expect(applyPayload.result).toMatchObject({
      updatedChunkCount: 1,
      updatedScoreCount: 1,
      skippedChunkIds: [],
    });

    const removedChunk = memoryManager.getMemory("p14-core-remove");
    expect(removedChunk?.metadata).toMatchObject({
      memoryTree: {
        governance: {
          archived: true,
          archivedByReportId: reportId,
          keepChunkId: "p14-core-keep",
        },
      },
    });
    const scores = memoryManager.listMemoryTreeScores(10, {
      targetType: "chunk",
    });
    expect(scores.find((item) => item.targetId === "p14-core-remove")?.scoreTotal).toBe(0.05);
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.report.apply supports R3 report-only governance baselines for inventory and tree build previews", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-r3-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-r3-workspace-"));
  const memoryDir = path.join(stateDir, "memory");
  await fs.promises.mkdir(memoryDir, { recursive: true });
  await fs.promises.writeFile(path.join(memoryDir, "2026-05-21.md"), "# Daily Memory\nr3 report baseline\n", "utf-8");

  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    memoryManager.upsertMemoryChunk({
      id: "r3-core-report-a",
      sourcePath: path.join(memoryDir, "2026-05-21.md"),
      sourceType: "file",
      memoryType: "daily",
      content: "r3 report baseline chunk",
      visibility: "shared",
    });
    (memoryManager as any).store.createTask({
      id: "task-tree-r3-1",
      conversationId: "conv-tree-r3-1",
      sessionKey: "conv-tree-r3-1",
      source: "chat",
      status: "success",
      title: "确认 R3 governance baseline",
      summary: "inventory 与 tree build report apply 只写 report 状态。",
      startedAt: "2026-05-21T11:00:00.000Z",
      finishedAt: "2026-05-21T11:05:00.000Z",
      createdAt: "2026-05-21T11:00:00.000Z",
      updatedAt: "2026-05-21T11:05:00.000Z",
    });
    (memoryManager as any).store.linkTaskMemory("task-tree-r3-1", "r3-core-report-a", "used");
    registerGlobalMemoryManager(memoryManager);

    const inventoryPreviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-r3-inventory-preview",
      method: "memory.tree.report.inventory.preview",
      params: {},
    }, { stateDir });
    expect(inventoryPreviewRes).toBeTruthy();
    if (!inventoryPreviewRes || !inventoryPreviewRes.ok) {
      throw new Error("expected successful memory.tree.report.inventory.preview response for R3");
    }
    const inventoryReportId = String((inventoryPreviewRes.payload?.record as Record<string, unknown> | undefined)?.id ?? "");
    expect(inventoryReportId.length).toBeGreaterThan(0);

    const inventoryReviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-r3-inventory-review",
      method: "memory.tree.report.review",
      params: {
        reportId: inventoryReportId,
        decision: "approved",
        reviewedBy: "tester",
      },
    }, { stateDir });
    expect(inventoryReviewRes).toBeTruthy();
    if (!inventoryReviewRes || !inventoryReviewRes.ok) {
      throw new Error(`expected successful memory.tree.report.review inventory response: ${JSON.stringify(inventoryReviewRes)}`);
    }

    const inventoryApplyRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-r3-inventory-apply",
      method: "memory.tree.report.apply",
      params: {
        reportId: inventoryReportId,
        confirmed: true,
        appliedBy: "tester",
        note: "confirm inventory baseline",
      },
    }, { stateDir });
    expect(inventoryApplyRes).toBeTruthy();
    if (!inventoryApplyRes || !inventoryApplyRes.ok) {
      throw new Error(`expected successful inventory memory.tree.report.apply response: ${JSON.stringify(inventoryApplyRes)}`);
    }
    expect(inventoryApplyRes.payload?.report).toMatchObject({
      id: inventoryReportId,
      reportType: "inventory",
      status: "applied",
      summary: expect.objectContaining({
        applyMode: "report_state_only",
        governanceState: "inventory_baseline_confirmed",
      }),
    });
    expect(inventoryApplyRes.payload?.result).toMatchObject({
      updatedChunkCount: 0,
      updatedScoreCount: 0,
      skippedChunkIds: [],
      actions: [
        expect.objectContaining({
          kind: "report_governance_ack",
          reportType: "inventory",
          governanceState: "inventory_baseline_confirmed",
        }),
      ],
    });

    const treeBuildRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-r3-tree-build-preview",
      method: "memory.tree.node.rebuild",
      params: {
        limit: 10,
      },
    }, { stateDir });
    expect(treeBuildRes).toBeTruthy();
    if (!treeBuildRes || !treeBuildRes.ok) {
      throw new Error(`expected successful memory.tree.node.rebuild response for R3: ${JSON.stringify(treeBuildRes)}`);
    }

    const treeBuildReportListRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-r3-report-list",
      method: "memory.tree.report.list",
      params: {
        limit: 20,
        filter: {
          reportType: "tree_build_preview",
        },
      },
    }, { stateDir });
    expect(treeBuildReportListRes).toBeTruthy();
    if (!treeBuildReportListRes || !treeBuildReportListRes.ok) {
      throw new Error(`expected successful memory.tree.report.list response for R3: ${JSON.stringify(treeBuildReportListRes)}`);
    }
    const treeBuildReportId = String((treeBuildReportListRes.payload?.items as Array<Record<string, unknown>> | undefined)?.[0]?.id ?? "");
    expect(treeBuildReportId.length).toBeGreaterThan(0);

    const treeBuildReviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-r3-tree-build-review",
      method: "memory.tree.report.review",
      params: {
        reportId: treeBuildReportId,
        decision: "approved",
        reviewedBy: "tester",
      },
    }, { stateDir });
    expect(treeBuildReviewRes).toBeTruthy();
    if (!treeBuildReviewRes || !treeBuildReviewRes.ok) {
      throw new Error(`expected successful tree_build memory.tree.report.review response: ${JSON.stringify(treeBuildReviewRes)}`);
    }

    const treeBuildApplyRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-r3-tree-build-apply",
      method: "memory.tree.report.apply",
      params: {
        reportId: treeBuildReportId,
        confirmed: true,
        appliedBy: "tester",
        note: "confirm tree build baseline",
      },
    }, { stateDir });
    expect(treeBuildApplyRes).toBeTruthy();
    if (!treeBuildApplyRes || !treeBuildApplyRes.ok) {
      throw new Error(`expected successful tree_build memory.tree.report.apply response: ${JSON.stringify(treeBuildApplyRes)}`);
    }
    expect(treeBuildApplyRes.payload?.report).toMatchObject({
      id: treeBuildReportId,
      reportType: "tree_build_preview",
      status: "applied",
      summary: expect.objectContaining({
        applyMode: "report_state_only",
        governanceState: "tree_build_baseline_confirmed",
      }),
    });
    expect(treeBuildApplyRes.payload?.result).toMatchObject({
      updatedChunkCount: 0,
      updatedScoreCount: 0,
      skippedChunkIds: [],
      actions: [
        expect.objectContaining({
          kind: "report_governance_ack",
          reportType: "tree_build_preview",
          governanceState: "tree_build_baseline_confirmed",
        }),
      ],
    });
  } finally {
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.report.shared_governance.preview consolidates boundary, queue, and coverage into the report ledger", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-shared-governance-report-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
    memoryMode: "hybrid",
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

  const memoryDir = path.join(defaultRecord.stateDir, "memory");
  const sessionsDir = path.join(defaultRecord.stateDir, "sessions");
  await fs.promises.mkdir(memoryDir, { recursive: true });
  await fs.promises.mkdir(sessionsDir, { recursive: true });
  await fs.promises.writeFile(path.join(memoryDir, "2026-05-21.md"), "# Shared Governance\ncoverage marker\n", "utf-8");
  await fs.promises.writeFile(path.join(sessionsDir, "shared-governance.session-memory.json"), JSON.stringify({
    summary: "续做记忆 marker",
  }, null, 2), "utf-8");
  await fs.promises.writeFile(path.join(defaultRecord.stateDir, "dream-runtime.json"), JSON.stringify({
    status: "idle",
  }, null, 2), "utf-8");

  defaultRecord.manager.upsertMemoryChunk({
    id: "shared-governance-chunk",
    sourcePath: path.join(memoryDir, "2026-05-21.md"),
    sourceType: "file",
    memoryType: "daily",
    content: "shared governance preview chunk",
    visibility: "private",
  });

  try {
    const promoteRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "shared-governance-promote",
      method: "memory.share.promote",
      params: {
        agentId: "default",
        chunkId: "shared-governance-chunk",
        reason: "phase4 shared governance preview",
      },
    }, {
      stateDir,
      residentMemoryManagers,
      agentRegistry: registry,
      teamSharedMemoryEnabled: true,
    });
    expect(promoteRes).toBeTruthy();
    if (!promoteRes || !promoteRes.ok) {
      throw new Error(`expected successful memory.share.promote response: ${JSON.stringify(promoteRes)}`);
    }

    const previewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "shared-governance-preview",
      method: "memory.tree.report.shared_governance.preview",
      params: {
        agentId: "default",
        reviewerAgentId: "reviewer",
      },
    }, {
      stateDir,
      residentMemoryManagers,
      agentRegistry: registry,
      teamSharedMemoryEnabled: true,
    });
    expect(previewRes).toBeTruthy();
    if (!previewRes || !previewRes.ok) {
      throw new Error(`expected successful memory.tree.report.shared_governance.preview response: ${JSON.stringify(previewRes)}`);
    }
    const previewPayload = previewRes.payload as Record<string, any> | undefined;

    expect(previewPayload?.report).toMatchObject({
      boundary: {
        agentId: "default",
        reviewerAgentId: "reviewer",
        memoryMode: "hybrid",
        writeTarget: "private",
      },
      promoteReview: {
        promoteUnits: ["chunk", "source"],
        reviewUnits: ["chunk", "source"],
        nodeReviewSupported: false,
      },
      sharedQueue: {
        summary: expect.objectContaining({
          pendingCount: 1,
          reviewerActionableCount: 1,
        }),
      },
      teamSharedMemory: expect.objectContaining({
        enabled: true,
      }),
      reviewSurfaceAssessment: expect.objectContaining({
        mode: "report_ledger_first",
      }),
    });
    expect(previewPayload?.report?.coverage).toMatchObject({
      searchableCount: expect.any(Number),
      summaryInputOnlyCount: expect.any(Number),
      inventoryOnlyCount: expect.any(Number),
      explanations: expect.arrayContaining([
        expect.objectContaining({ searchPolicy: "searchable" }),
        expect.objectContaining({ searchPolicy: "summary-input-only" }),
        expect.objectContaining({ searchPolicy: "inventory-only" }),
      ]),
    });
    expect(previewPayload?.report?.coverage?.summaryInputOnlyCount).toBeGreaterThan(0);
    expect(previewPayload?.report?.coverage?.inventoryOnlyCount).toBeGreaterThan(0);
    expect(previewPayload?.record).toMatchObject({
      reportType: "shared_governance_preview",
      scope: "private",
      agentId: "default",
    });
    expect(previewPayload?.governance?.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "shared_review_queue",
        action: "review",
      }),
      expect.objectContaining({
        category: "review_surface",
        action: "keep",
      }),
    ]));

    const reportId = String((previewPayload?.record as Record<string, unknown> | undefined)?.id ?? "");
    expect(reportId.length).toBeGreaterThan(0);

    const reviewRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "shared-governance-review",
      method: "memory.tree.report.review",
      params: {
        reportId,
        decision: "approved",
        reviewedBy: "tester",
      },
    }, {
      stateDir,
      residentMemoryManagers,
      agentRegistry: registry,
      teamSharedMemoryEnabled: true,
    });
    expect(reviewRes).toBeTruthy();
    if (!reviewRes || !reviewRes.ok) {
      throw new Error(`expected successful memory.tree.report.review response: ${JSON.stringify(reviewRes)}`);
    }

    const applyRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "shared-governance-apply",
      method: "memory.tree.report.apply",
      params: {
        reportId,
        confirmed: true,
        appliedBy: "tester",
      },
    }, {
      stateDir,
      residentMemoryManagers,
      agentRegistry: registry,
      teamSharedMemoryEnabled: true,
    });
    expect(applyRes).toBeTruthy();
    if (!applyRes || !applyRes.ok) {
      throw new Error(`expected successful memory.tree.report.apply response: ${JSON.stringify(applyRes)}`);
    }
    expect(applyRes.payload?.report).toMatchObject({
      id: reportId,
      reportType: "shared_governance_preview",
      status: "applied",
      summary: expect.objectContaining({
        applyMode: "report_state_only",
        governanceState: "shared_governance_preview_confirmed",
      }),
    });
    expect(applyRes.payload?.result).toMatchObject({
      updatedChunkCount: 0,
      updatedScoreCount: 0,
      skippedChunkIds: [],
      actions: [
        expect.objectContaining({
          kind: "report_governance_ack",
          reportType: "shared_governance_preview",
          governanceState: "shared_governance_preview_confirmed",
        }),
      ],
    });
  } finally {
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
    expect(result?.observability).toMatchObject({
      beforeChunkCount: 3,
      afterChunkCount: 2,
    });
    expect(typeof result?.observability?.beforePageCount).toBe("number");
    expect(typeof result?.observability?.afterPageCount).toBe("number");
    expect(typeof result?.observability?.beforeFreelistCount).toBe("number");
    expect(typeof result?.observability?.afterFreelistCount).toBe("number");
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

test("memory.vacuum preview/apply exposes safe sqlite shrink workflow through memory methods", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-vacuum-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-vacuum-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });

  try {
    for (let index = 0; index < 24; index += 1) {
      memoryManager.upsertMemoryChunk({
        id: `vacuum-${index}`,
        sourcePath: path.join(workspaceRoot, `vacuum-${index}.md`),
        sourceType: "file",
        memoryType: "other",
        content: `vacuum payload ${index}\n${"x".repeat(16384)}`,
        visibility: "private",
      });
    }
    const store = (memoryManager as any).store as {
      deleteBySource: (sourcePath: string) => number;
    };
    for (let index = 0; index < 12; index += 1) {
      store.deleteBySource(path.join(workspaceRoot, `vacuum-${index}.md`));
    }
    registerGlobalMemoryManager(memoryManager);

    const previewResponse = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-vacuum-preview",
      method: "memory.vacuum.preview",
      params: {
        agentId: "default",
      },
    }, { stateDir });

    expect(previewResponse).toBeTruthy();
    if (!previewResponse || !previewResponse.ok) {
      throw new Error("expected successful memory.vacuum.preview response");
    }

    const preview = previewResponse.payload?.report as Record<string, any> | undefined;
    expect(preview?.mode).toBe("dry_run");
    expect(preview?.requiresConfirmed).toBe(true);
    expect(preview?.recommended).toBe(true);
    expect(preview?.observability?.chunkCount).toBe(12);
    expect(preview?.observability?.freelistCount).toBeGreaterThan(0);
    expect(preview?.observability?.estimatedReclaimableBytes).toBeGreaterThan(0);

    const notConfirmed = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-vacuum-apply-no-confirm",
      method: "memory.vacuum.apply",
      params: {
        agentId: "default",
      },
    }, { stateDir });
    if (!notConfirmed || notConfirmed.ok) {
      throw new Error("expected memory.vacuum.apply without confirmation to fail");
    }
    expect(notConfirmed.error.message).toContain("confirmed=true");

    const applyResponse = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-vacuum-apply",
      method: "memory.vacuum.apply",
      params: {
        agentId: "default",
        confirmed: true,
        runId: "memory-vacuum-test",
      },
    }, { stateDir });

    expect(applyResponse).toBeTruthy();
    if (!applyResponse || !applyResponse.ok) {
      throw new Error("expected successful memory.vacuum.apply response");
    }

    const result = applyResponse.payload?.result as Record<string, any> | undefined;
    expect(result?.mode).toBe("apply");
    expect(result?.backupPath).toContain("memory-vacuum-backups");
    expect(await fs.promises.stat(String(result?.backupPath))).toBeTruthy();
    expect(result?.before?.freelistCount).toBeGreaterThan(0);
    expect(result?.after?.freelistCount).toBe(0);
    expect(result?.after?.pageCount).toBeLessThanOrEqual(result?.before?.pageCount ?? Number.MAX_SAFE_INTEGER);
    expect(result?.after?.totalFileBytes).toBeLessThanOrEqual(result?.before?.totalFileBytes ?? Number.MAX_SAFE_INTEGER);
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
  await memoryManager.rebuildMemoryTreeSources();
  memoryManager.rebuildMemoryTreeScores();
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
    expect(memorySearchRes.payload.items.some((item: any) => item?.metadata?.memoryTree?.scoreVersion === "v1_rule_only")).toBe(true);
    expect(memorySearchTopicRes.ok).toBe(true);
    expect(memorySearchTopicRes.payload.items.length).toBeGreaterThan(0);
    const topicSearchItem = memorySearchTopicRes.payload.items.find((item: any) => item.sourcePath === "memory/topic-viewer.md");
    expect(topicSearchItem).toBeTruthy();
    expect(topicSearchItem.content).toBeUndefined();
    expect(topicSearchItem.sourceView.scope).toBe("shared");
    expect(topicSearchItem.metadata?.memoryTree).toMatchObject({
      scoreVersion: "v1_rule_only",
      scoreTotal: expect.any(Number),
    });
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
