import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../types.js";

const manager = {
  search: vi.fn(),
  indexWorkspace: vi.fn(),
  getStatus: vi.fn(),
  linkTaskMemories: vi.fn(),
  linkTaskMemoriesFromSource: vi.fn(),
  assignMemorySourceAgent: vi.fn(),
  promoteMemoryChunk: vi.fn(),
  promoteMemorySource: vi.fn(),
  searchTasks: vi.fn(),
  getRecentTasks: vi.fn(),
  getTaskDetail: vi.fn(),
  getTaskByConversation: vi.fn(),
  getRecentWork: vi.fn(),
  getResumeContext: vi.fn(),
  findSimilarPastWork: vi.fn(),
  promoteTaskToMethodCandidate: vi.fn(),
  promoteTaskToSkillCandidate: vi.fn(),
  listExperienceCandidates: vi.fn(),
  getExperienceCandidate: vi.fn(),
  acceptExperienceCandidate: vi.fn(),
  rejectExperienceCandidate: vi.fn(),
  recordExperienceUsage: vi.fn(),
  getExperienceUsage: vi.fn(),
  listExperienceUsages: vi.fn(),
  revokeExperienceUsage: vi.fn(),
};

const readMemoryFile = vi.fn();
const writeMemoryFile = vi.fn();
const appendToTodayMemory = vi.fn();
const publishSkillCandidate = vi.fn();
const getGlobalSkillRegistry = vi.fn(() => null);

vi.mock("@belldandy/memory", () => ({
  MemoryManager: vi.fn(),
  getGlobalMemoryManager: () => manager,
  createTaskWorkSurface: (delegate: any) => ({
    recentWork: (input: any) => delegate.getRecentWork?.(input) ?? [],
    resumeContext: (input: any) => delegate.getResumeContext?.(input) ?? null,
    findSimilarWork: (input: any) => delegate.findSimilarPastWork?.(input) ?? [],
    explainSources: (input: any) => delegate.getTaskDetail?.(input?.taskId) ?? null,
  }),
  appendToTodayMemory,
  readMemoryFile,
  writeMemoryFile,
}));

vi.mock("../skill-publisher.js", () => ({
  publishSkillCandidate,
}));

vi.mock("../skill-registry.js", () => ({
  getGlobalSkillRegistry,
}));

const mod = await import("./memory.js");

const baseContext: ToolContext = {
  conversationId: "conv-1",
  workspaceRoot: "E:/project/star-sanctuary/.star_sanctuary",
  policy: {
    allowedPaths: [],
    deniedPaths: [],
    allowedDomains: [],
    deniedDomains: [],
    maxTimeoutMs: 30_000,
    maxResponseBytes: 512_000,
  },
};

const agentContext: ToolContext = {
  ...baseContext,
  agentId: "agent-belldandy",
};

describe("memory tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager.getStatus.mockReturnValue({
      files: 2,
      chunks: 10,
      vectorIndexed: 5,
      vectorCached: 3,
      summarized: 4,
      summaryPending: 1,
    });
  });

  it("memory_search should link used memories", async () => {
    manager.search.mockResolvedValue([
      {
        id: "chunk-1",
        sourcePath: "memory/2026-03-15.md",
        sourceType: "file",
        snippet: "记忆片段一",
        summary: "摘要一",
        score: 0.9,
        startLine: 12,
      },
    ]);

    const result = await mod.memorySearchTool.execute({
      query: "测试检索",
      limit: 3,
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("摘要一");
    expect(manager.linkTaskMemories).toHaveBeenCalledWith("conv-1", ["chunk-1"], "used");
  });

  it("memory_search should render full content when detail_level=full", async () => {
    manager.search.mockResolvedValue([
      {
        id: "chunk-full",
        sourcePath: "memory/full.md",
        sourceType: "file",
        snippet: "被截断的片段",
        content: "完整内容第一行\n完整内容第二行",
        score: 0.92,
        startLine: 5,
      },
    ]);

    const result = await mod.memorySearchTool.execute({
      query: "完整内容",
      detail_level: "full",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("完整内容第一行");
    expect(result.output).toContain("完整内容第二行");
    expect(result.output).not.toContain("被截断的片段");
  });

  it("memory_search should pass explicit shared scope with agent context", async () => {
    manager.search.mockResolvedValue([
      {
        id: "chunk-shared",
        sourcePath: "memory/shared.md",
        sourceType: "file",
        snippet: "共享记忆片段",
        summary: "共享摘要",
        score: 0.88,
        startLine: 8,
        visibility: "shared",
      },
    ]);

    const result = await mod.memorySearchTool.execute({
      query: "共享经验",
      limit: 2,
      scope: "shared",
    }, agentContext);

    expect(result.success).toBe(true);
    expect(manager.search).toHaveBeenCalledWith("共享经验", {
      limit: 2,
      filter: {
        scope: "shared",
        agentId: "agent-belldandy",
      },
    });
    expect(result.output).toContain("[shared]");
  });

  it("memory_search should pass category filter and render category tag", async () => {
    manager.search.mockResolvedValue([
      {
        id: "chunk-decision",
        sourcePath: "memory/decision.md",
        sourceType: "file",
        snippet: "确定采用第四阶段最小闭环。",
        summary: "第四阶段决策摘要",
        score: 0.91,
        startLine: 3,
        category: "decision",
      },
    ]);

    const result = await mod.memorySearchTool.execute({
      query: "第四阶段",
      category: "decision",
      limit: 2,
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.search).toHaveBeenCalledWith("第四阶段", {
      limit: 2,
      filter: {
        category: "decision",
      },
    });
    expect(result.output).toContain("[decision]");
  });

  it("memory_search should pass topic filter", async () => {
    manager.search.mockResolvedValue([
      {
        id: "chunk-topic",
        sourcePath: "memory/topic.md",
        sourceType: "file",
        snippet: "Topic filtered memory",
        summary: "Topic summary",
        score: 0.87,
        startLine: 2,
      },
    ]);

    const result = await mod.memorySearchTool.execute({
      query: "viewer topic",
      topic: "viewer-audit",
      limit: 2,
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.search).toHaveBeenCalledWith("viewer topic", {
      limit: 2,
      filter: {
        topic: "viewer-audit",
      },
    });
  });

  it("memory_search should support dream memory filters and render dream labels", async () => {
    manager.search.mockResolvedValue([
      {
        id: "chunk-dream-note",
        sourcePath: "dreams/2026-05-20-first-contact.md",
        sourceType: "file",
        memoryType: "dream_note",
        snippet: "她每一次醒来都是新生。",
        summary: "梦境记录摘要",
        score: 0.89,
        startLine: 4,
      },
      {
        id: "chunk-dream-index",
        sourcePath: "DREAM.md",
        sourceType: "file",
        memoryType: "dream_index",
        snippet: "梦境总览",
        summary: "梦境索引摘要",
        score: 0.72,
        startLine: 1,
      },
    ]);

    const result = await mod.memorySearchTool.execute({
      query: "新生 梦境",
      memory_type: "dream_note,dream_index",
      limit: 5,
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.search).toHaveBeenCalledWith("新生 梦境", {
      limit: 5,
      filter: {
        memoryType: ["dream_note", "dream_index"],
      },
    });
    expect(result.output).toContain("[Dream Note]");
    expect(result.output).toContain("[Dream Index]");
  });

  it("memory_read should render file content", async () => {
    readMemoryFile.mockResolvedValue({
      path: "memory/2026-03-15.md",
      totalLines: 3,
      text: "# 2026-03-15\n\n- 一条记忆",
    });

    const result = await mod.memoryReadTool.execute({
      path: "memory/2026-03-15.md",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Total Lines: 3");
    expect(result.output).toContain("- 一条记忆");
    expect(manager.linkTaskMemoriesFromSource).toHaveBeenCalledWith(
      "conv-1",
      "memory/2026-03-15.md",
      "used",
    );
  });

  it("memory_write should append to today file and link generated memory", async () => {
    appendToTodayMemory.mockResolvedValue("E:/project/star-sanctuary/.star_sanctuary/memory/2026-03-15.md");

    const result = await mod.memoryWriteTool.execute({
      content: "- 新记忆",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(appendToTodayMemory).toHaveBeenCalled();
    expect(manager.linkTaskMemoriesFromSource).toHaveBeenCalledWith(
      "conv-1",
      "E:/project/star-sanctuary/.star_sanctuary/memory/2026-03-15.md",
      "generated",
    );
  });

  it("memory_write should register source owner when agent context exists", async () => {
    appendToTodayMemory.mockResolvedValue("E:/project/star-sanctuary/.star_sanctuary/memory/2026-03-15.md");

    const result = await mod.memoryWriteTool.execute({
      content: "- Agent 记忆",
    }, agentContext);

    expect(result.success).toBe(true);
    expect(manager.assignMemorySourceAgent).toHaveBeenCalledWith(
      "E:/project/star-sanctuary/.star_sanctuary/memory/2026-03-15.md",
      "agent-belldandy",
    );
  });

  it("memory_share_promote should promote a single chunk", async () => {
    manager.promoteMemoryChunk.mockReturnValue({
      id: "chunk-1",
      sourcePath: "memory/2026-03-15.md",
      visibility: "shared",
    });

    const result = await mod.memorySharePromoteTool.execute({
      chunk_id: "chunk-1",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.promoteMemoryChunk).toHaveBeenCalledWith("chunk-1");
    expect(manager.linkTaskMemories).toHaveBeenCalledWith("conv-1", ["chunk-1"], "referenced");
    expect(result.output).toContain("Promoted 1 chunk to shared.");
    expect(result.output).toContain("Visibility: shared");
  });

  it("memory_share_promote should promote all chunks by source path", async () => {
    manager.promoteMemorySource.mockReturnValue({
      count: 2,
      chunks: [
        { id: "chunk-a" },
        { id: "chunk-b" },
      ],
    });

    const result = await mod.memorySharePromoteTool.execute({
      source_path: "memory/shared.md",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.promoteMemorySource).toHaveBeenCalledWith("memory/shared.md");
    expect(manager.linkTaskMemoriesFromSource).toHaveBeenCalledWith(
      "conv-1",
      "memory/shared.md",
      "referenced",
    );
    expect(result.output).toContain("Promoted 2 chunks to shared.");
    expect(result.output).toContain("chunk-a, chunk-b");
  });

  it("task_recent should render task list", async () => {
    manager.getRecentTasks.mockReturnValue([
      {
        id: "task_1",
        status: "success",
        source: "chat",
        startedAt: "2026-03-15T00:00:00.000Z",
        finishedAt: "2026-03-15T00:01:00.000Z",
        title: "修复任务",
        summary: "完成修复。",
      },
    ]);

    const result = await mod.taskRecentTool.execute({}, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("修复任务");
    expect(result.output).toContain("task_1");
  });

  it("recent_work should render specialized recent work shortcuts", async () => {
    manager.getRecentWork.mockReturnValue([
      {
        taskId: "task_recent_work_1",
        conversationId: "conv-recent-work-1",
        status: "partial",
        source: "chat",
        startedAt: "2026-04-17T09:00:00.000Z",
        updatedAt: "2026-04-17T09:10:00.000Z",
        title: "补 Step 3 检索短路径",
        workRecap: {
          headline: "已确认 4 条执行事实；当前停在：正在补 recent_work 与 resume_context 的 manager 接口。",
        },
        resumeContext: {
          currentStopPoint: "正在补 recent_work 与 resume_context 的 manager 接口。",
          nextStep: "继续接 skill 与 Gateway RPC。",
        },
        recentActivityTitles: ["已执行工具 apply_patch", "已变更文件：packages/belldandy-memory/src/manager.ts"],
        matchReasons: ["标题/目标", "当前停点"],
        toolNames: ["apply_patch"],
        artifactPaths: ["packages/belldandy-memory/src/manager.ts"],
      },
    ]);

    const result = await mod.recentWorkTool.execute({
      query: "Step 3",
      limit: 3,
    }, agentContext);

    expect(result.success).toBe(true);
    expect(manager.getRecentWork).toHaveBeenCalledWith({
      query: "Step 3",
      limit: 3,
      filter: {
        agentId: "agent-belldandy",
      },
    });
    expect(result.output).toContain("补 Step 3 检索短路径");
    expect(result.output).toContain("Recap:");
    expect(result.output).not.toContain("Matched By:");
    expect(result.output).not.toContain("Recent Activity:");
  });

  it("resume_context should render stop point and next step", async () => {
    manager.getResumeContext.mockReturnValue({
      taskId: "task_resume_1",
      conversationId: "conv-resume-1",
      status: "partial",
      source: "chat",
      startedAt: "2026-04-17T08:00:00.000Z",
      updatedAt: "2026-04-17T08:30:00.000Z",
      title: "继续整理 Step 3",
      workRecap: {
        headline: "已确认 3 条执行事实；当前停在：已经落完 manager 接口，待补 RPC。",
        confirmedFacts: ["已新增 recent_work manager 方法"],
      },
      resumeContext: {
        currentStopPoint: "已经落完 manager 接口，待补 RPC。",
        nextStep: "继续补 Gateway RPC 与定向测试。",
        blockers: ["尚未接线到 WebSocket 方法表。"],
      },
      recentActivityTitles: ["已变更文件：packages/belldandy-memory/src/manager.ts"],
      toolNames: ["apply_patch"],
      artifactPaths: ["packages/belldandy-memory/src/manager.ts"],
    });

    const result = await mod.resumeContextTool.execute({
      query: "Step 3",
    }, agentContext);

    expect(result.success).toBe(true);
    expect(manager.getResumeContext).toHaveBeenCalledWith({
      taskId: undefined,
      conversationId: undefined,
      query: "Step 3",
      filter: {
        agentId: "agent-belldandy",
      },
    });
    expect(result.output).toContain("Stop: 已经落完 manager 接口，待补 RPC。");
    expect(result.output).toContain("Next: 继续补 Gateway RPC 与定向测试。");
    expect(result.output).not.toContain("Blockers:");
  });

  it("similar_past_work should query specialized similar task path", async () => {
    manager.findSimilarPastWork.mockReturnValue([
      {
        taskId: "task_similar_1",
        conversationId: "conv-similar-1",
        status: "success",
        source: "chat",
        startedAt: "2026-04-16T10:00:00.000Z",
        finishedAt: "2026-04-16T10:05:00.000Z",
        updatedAt: "2026-04-16T10:05:00.000Z",
        title: "修复 memory viewer task detail 渲染",
        summary: "已补 task detail 的 work recap 展示。",
        workRecap: {
          headline: "任务已完成；已确认 5 条执行事实。",
        },
        resumeContext: {
          currentStopPoint: "任务已完成。",
        },
        recentActivityTitles: ["已变更文件：apps/web/public/app/features/memory-detail-render.js"],
        matchReasons: ["标题/目标", "摘要/复盘", "工具/产物"],
        toolNames: ["apply_patch"],
        artifactPaths: ["apps/web/public/app/features/memory-detail-render.js"],
      },
    ]);

    const result = await mod.similarPastWorkTool.execute({
      query: "memory viewer task detail",
      limit: 2,
    }, agentContext);

    expect(result.success).toBe(true);
    expect(manager.findSimilarPastWork).toHaveBeenCalledWith({
      query: "memory viewer task detail",
      limit: 2,
      filter: {
        agentId: "agent-belldandy",
      },
    });
    expect(result.output).toContain("修复 memory viewer task detail 渲染");
    expect(result.output).not.toContain("Matched By:");
  });

  it("recent_work and resume_context should support full detail expansion", async () => {
    manager.getRecentWork.mockReturnValue([
      {
        taskId: "task_recent_work_expand_1",
        conversationId: "conv-recent-work-expand-1",
        status: "partial",
        source: "chat",
        startedAt: "2026-04-17T09:00:00.000Z",
        updatedAt: "2026-04-17T09:10:00.000Z",
        title: "展开 recent_work 摘要",
        workRecap: {
          headline: "已确认 3 条执行事实；当前停在：待补 full detail 输出。",
        },
        resumeContext: {
          currentStopPoint: "待补 full detail 输出。",
          nextStep: "继续补 detail_level=full。",
        },
        recentActivityTitles: ["已执行工具 apply_patch"],
        matchReasons: ["标题/目标", "当前停点"],
        toolNames: ["apply_patch"],
        artifactPaths: ["packages/belldandy-skills/src/builtin/memory.ts"],
      },
    ]);
    manager.getResumeContext.mockReturnValue({
      taskId: "task_resume_expand_1",
      conversationId: "conv-resume-expand-1",
      status: "partial",
      source: "chat",
      startedAt: "2026-04-17T08:00:00.000Z",
      updatedAt: "2026-04-17T08:30:00.000Z",
      title: "展开 resume_context 摘要",
      workRecap: {
        headline: "已确认 2 条执行事实；当前停在：待补 full detail。",
        confirmedFacts: ["已新增 detail_level 参数"],
      },
      resumeContext: {
        currentStopPoint: "待补 full detail。",
        nextStep: "继续补 tests。",
        blockers: ["还没覆盖 expanded output。"],
      },
      recentActivityTitles: ["已变更文件：packages/belldandy-skills/src/builtin/memory.ts"],
      toolNames: ["apply_patch"],
      artifactPaths: ["packages/belldandy-skills/src/builtin/memory.ts"],
    });

    const recentWorkRes = await mod.recentWorkTool.execute({
      query: "detail",
      detail_level: "full",
    }, agentContext);
    const resumeContextRes = await mod.resumeContextTool.execute({
      query: "detail",
      detail_level: "full",
    }, agentContext);

    expect(recentWorkRes.success).toBe(true);
    expect(recentWorkRes.output).toContain("Matched By: 标题/目标, 当前停点");
    expect(recentWorkRes.output).toContain("Recent Activity:");
    expect(resumeContextRes.success).toBe(true);
    expect(resumeContextRes.output).toContain("Confirmed Facts:");
    expect(resumeContextRes.output).toContain("Blockers:");
    expect(resumeContextRes.output).toContain("Recent Activity:");
  });

  it("task_search should reject unsupported scope parameter", async () => {
    const result = await mod.taskSearchTool.execute({
      query: "viewer",
      scope: "shared",
    }, agentContext);

    expect(result.success).toBe(false);
    expect(manager.searchTasks).not.toHaveBeenCalled();
    expect(result.error).toContain("does not support scope");
  });

  it("task_get should render readable detail with memory links", async () => {
    manager.getTaskDetail.mockReturnValue({
      id: "task_1",
      conversationId: "conv-1",
      status: "success",
      source: "chat",
      startedAt: "2026-03-15T00:00:00.000Z",
      finishedAt: "2026-03-15T00:01:00.000Z",
      title: "修复任务",
      objective: "修复记忆问题",
      summary: "已经修复。",
      reflection: "以后先查 task_recent。",
      toolCalls: [{ toolName: "memory_search", success: true, durationMs: 120 }],
      memoryLinks: [
        {
          chunkId: "chunk-1",
          relation: "used",
          sourcePath: "memory/2026-03-15.md",
          memoryType: "daily",
          snippet: "记忆片段一",
        },
      ],
      usedMethods: [
        {
          usageId: "usage-method-1",
          taskId: "task_1",
          assetType: "method",
          assetKey: "web-browser-automation.md",
          usedVia: "tool",
          createdAt: "2026-03-16T00:00:00.000Z",
          usageCount: 2,
          lastUsedAt: "2026-03-16T00:00:00.000Z",
          lastUsedTaskId: "task_1",
          sourceCandidateId: "exp-method-1",
          sourceCandidateTitle: "网页自动化方法候选",
          sourceCandidateStatus: "accepted",
          sourceCandidateTaskId: "task_source_method_1",
          sourceCandidatePublishedPath: "E:/project/star-sanctuary/.star_sanctuary/methods/web-browser-automation.md",
        },
      ],
      usedSkills: [
        {
          usageId: "usage-skill-1",
          taskId: "task_1",
          assetType: "skill",
          assetKey: "网页自动化技能草稿",
          usedVia: "search",
          createdAt: "2026-03-16T00:00:00.000Z",
          usageCount: 1,
          lastUsedAt: "2026-03-16T00:00:00.000Z",
          lastUsedTaskId: "task_1",
          sourceCandidateId: "exp-skill-1",
          sourceCandidateTitle: "网页自动化技能候选",
          sourceCandidateStatus: "accepted",
          sourceCandidateTaskId: "task_source_skill_1",
          sourceCandidatePublishedPath: "E:/project/star-sanctuary/.star_sanctuary/skills/web-auto/SKILL.md",
        },
      ],
    });

    const result = await mod.taskGetTool.execute({ task_id: "task_1" }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Task: 修复任务");
    expect(result.output).toContain("Memory Links:");
    expect(result.output).toContain("memory/2026-03-15.md");
    expect(result.output).toContain("记忆片段一");
    expect(result.output).toContain("Used Methods:");
    expect(result.output).toContain("web-browser-automation.md");
    expect(result.output).toContain("usage-method-1");
    expect(result.output).toContain("candidate_task: task_source_method_1");
    expect(result.output).toContain("published_path: E:/project/star-sanctuary/.star_sanctuary/methods/web-browser-automation.md");
    expect(result.output).toContain("Used Skills:");
    expect(result.output).toContain("网页自动化技能草稿");
  });

  it("task_promote_method should render created candidate draft", async () => {
    manager.promoteTaskToMethodCandidate.mockReturnValue({
      reusedExisting: false,
      dedupDecision: "similar_existing",
      similarMatches: [
        {
          source: "method_asset",
          key: "method-fix-task.md",
          title: "修复任务实施",
          score: 0.91,
        },
      ],
      candidate: {
        id: "exp-1",
        taskId: "task_1",
        type: "method",
        status: "draft",
        title: "修复任务",
        slug: "method-fix-task",
        content: "# 修复任务\n\n## 0. 元信息\n| 属性 | 内容 |",
        summary: "从修复任务提炼的方法候选",
        qualityScore: 85,
        createdAt: "2026-03-15T00:00:00.000Z",
      },
    });

    const result = await mod.taskPromoteMethodTool.execute({ task_id: "task_1" }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.promoteTaskToMethodCandidate).toHaveBeenCalledWith("task_1");
    expect(result.output).toContain("Created method candidate draft.");
    expect(result.output).toContain("Candidate ID: exp-1");
    expect(result.output).toContain("Quality Score: 85");
    expect(result.output).toContain("Dedup Decision: similar_existing");
    expect(result.output).toContain("Similar Existing:");
  });

  it("experience_candidate_list should pass filter and render items", async () => {
    manager.listExperienceCandidates.mockReturnValue([
      {
        id: "exp-1",
        taskId: "task_1",
        type: "skill",
        status: "draft",
        title: "技能草稿",
        slug: "skill-task-1",
        content: "技能草稿正文",
        summary: "技能摘要",
        qualityScore: 72,
        createdAt: "2026-03-15T00:00:00.000Z",
      },
    ]);

    const result = await mod.experienceCandidateListTool.execute({
      limit: 5,
      type: "skill",
      status: "draft",
    }, agentContext);

    expect(result.success).toBe(true);
    expect(manager.listExperienceCandidates).toHaveBeenCalledWith(5, {
      type: "skill",
      status: "draft",
      agentId: "agent-belldandy",
    });
    expect(result.output).toContain("技能草稿");
    expect(result.output).toContain("Quality: 72");
  });

  it("experience_candidate_get should render candidate audit detail", async () => {
    manager.getExperienceCandidate.mockReturnValue({
      id: "exp-1",
      taskId: "task_1",
      type: "method",
      status: "accepted",
      title: "技能草稿",
      slug: "skill-task-1",
      content: "技能草稿正文",
      summary: "技能摘要",
      qualityScore: 72,
      publishedPath: "E:/project/star-sanctuary/.star_sanctuary/methods/skill-task-1.md",
      createdAt: "2026-03-15T00:00:00.000Z",
      sourceTaskSnapshot: {
        taskId: "task_1",
        conversationId: "conv-1",
        status: "success",
        source: "chat",
        objective: "沉淀经验",
      },
    });

    const result = await mod.experienceCandidateGetTool.execute({
      candidate_id: "exp-1",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Candidate ID: exp-1");
    expect(result.output).toContain("Published Path: E:/project/star-sanctuary/.star_sanctuary/methods/skill-task-1.md");
    expect(result.output).toContain("Source Task Snapshot:");
  });

  it("experience_candidate_accept should render accepted status", async () => {
    manager.getExperienceCandidate.mockReturnValue({
      id: "exp-1",
      taskId: "task_1",
      type: "method",
      status: "draft",
      content: "# method",
    });
    manager.acceptExperienceCandidate.mockReturnValue({
      id: "exp-1",
      taskId: "task_1",
      type: "method",
      status: "accepted",
    });

    const result = await mod.experienceCandidateAcceptTool.execute({
      candidate_id: "exp-1",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.acceptExperienceCandidate).toHaveBeenCalledWith("exp-1", {});
    expect(result.output).toContain("Candidate accepted.");
    expect(result.output).toContain("Status: accepted");
  });

  it("experience_candidate_accept should publish skill candidates before accepting", async () => {
    manager.getExperienceCandidate.mockReturnValue({
      id: "exp-skill-1",
      taskId: "task_2",
      type: "skill",
      status: "draft",
      content: "---\nname: test\n---\nbody",
    });
    publishSkillCandidate.mockResolvedValue("E:/project/star-sanctuary/.star_sanctuary/skills/skill-task-2/SKILL.md");
    manager.acceptExperienceCandidate.mockReturnValue({
      id: "exp-skill-1",
      taskId: "task_2",
      type: "skill",
      status: "accepted",
      publishedPath: "E:/project/star-sanctuary/.star_sanctuary/skills/skill-task-2/SKILL.md",
    });

    const result = await mod.experienceCandidateAcceptTool.execute({
      candidate_id: "exp-skill-1",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(publishSkillCandidate).toHaveBeenCalled();
    expect(manager.acceptExperienceCandidate).toHaveBeenCalledWith("exp-skill-1", {
      publishedPath: "E:/project/star-sanctuary/.star_sanctuary/skills/skill-task-2/SKILL.md",
    });
    expect(result.output).toContain("Published Path:");
  });

  it("experience_candidate_accept should refuse non-draft candidates before publishing", async () => {
    manager.getExperienceCandidate.mockReturnValue({
      id: "exp-skill-2",
      taskId: "task_3",
      type: "skill",
      status: "accepted",
      content: "---\nname: test\n---\nbody",
    });

    const result = await mod.experienceCandidateAcceptTool.execute({
      candidate_id: "exp-skill-2",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Current status: accepted");
    expect(publishSkillCandidate).not.toHaveBeenCalled();
    expect(manager.acceptExperienceCandidate).not.toHaveBeenCalled();
  });

  it("experience_usage_record should record adopted skill usage on current task", async () => {
    manager.getTaskByConversation.mockReturnValue({
      id: "task_1",
      conversationId: "conv-1",
      status: "success",
      source: "chat",
      startedAt: "2026-03-16T00:00:00.000Z",
    });
    manager.recordExperienceUsage.mockReturnValue({
      reusedExisting: false,
      usage: {
        id: "usage-1",
        taskId: "task_1",
        assetType: "skill",
        assetKey: "网页自动化技能草稿",
        usedVia: "search",
        sourceCandidateId: "exp-skill-1",
      },
    });

    const result = await mod.experienceUsageRecordTool.execute({
      asset_type: "skill",
      asset_key: "网页自动化技能草稿",
      used_via: "search",
      source_candidate_id: "exp-skill-1",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.getTaskByConversation).toHaveBeenCalledWith("conv-1");
    expect(manager.recordExperienceUsage).toHaveBeenCalledWith({
      taskId: "task_1",
      assetType: "skill",
      assetKey: "网页自动化技能草稿",
      sourceCandidateId: "exp-skill-1",
      usedVia: "search",
    });
    expect(result.output).toContain("Recorded experience usage.");
    expect(result.output).toContain("Asset: 网页自动化技能草稿");
  });

  it("experience_usage_record should report missing task gracefully", async () => {
    manager.getTaskByConversation.mockReturnValue(null);

    const result = await mod.experienceUsageRecordTool.execute({
      asset_type: "skill",
      asset_key: "网页自动化技能草稿",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.recordExperienceUsage).not.toHaveBeenCalled();
    expect(result.output).toContain("No task found");
  });

  it("experience_usage_get should render candidate-backed audit detail", async () => {
    manager.getExperienceUsage.mockReturnValue({
      id: "usage-1",
      taskId: "task_1",
      assetType: "skill",
      assetKey: "网页自动化技能草稿",
      usedVia: "search",
      sourceCandidateId: "exp-skill-1",
      createdAt: "2026-03-16T00:00:00.000Z",
    });
    manager.getExperienceCandidate.mockReturnValue({
      id: "exp-skill-1",
      taskId: "task_source_skill_1",
      type: "skill",
      status: "accepted",
      title: "网页自动化技能候选",
      slug: "web-auto-skill",
      content: "正文",
      createdAt: "2026-03-15T00:00:00.000Z",
      publishedPath: "E:/project/star-sanctuary/.star_sanctuary/skills/web-auto/SKILL.md",
      sourceTaskSnapshot: {
        taskId: "task_source_skill_1",
        conversationId: "conv-source-1",
        status: "success",
        source: "chat",
      },
    });

    const result = await mod.experienceUsageGetTool.execute({
      usage_id: "usage-1",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Usage ID: usage-1");
    expect(result.output).toContain("Source Candidate: exp-skill-1");
    expect(result.output).toContain("Candidate Task: task_source_skill_1");
    expect(result.output).toContain("Published Path: E:/project/star-sanctuary/.star_sanctuary/skills/web-auto/SKILL.md");
  });

  it("experience_usage_list should pass filters and render usage ids", async () => {
    manager.listExperienceUsages.mockReturnValue([
      {
        id: "usage-1",
        taskId: "task_1",
        assetType: "method",
        assetKey: "web-browser-automation.md",
        usedVia: "tool",
        sourceCandidateId: "exp-method-1",
        createdAt: "2026-03-16T00:00:00.000Z",
      },
    ]);
    manager.getExperienceCandidate.mockReturnValue({
      id: "exp-method-1",
      taskId: "task_source_method_1",
      type: "method",
      status: "accepted",
      title: "网页自动化方法候选",
      slug: "web-browser-automation",
      content: "正文",
      createdAt: "2026-03-15T00:00:00.000Z",
      publishedPath: "E:/project/star-sanctuary/.star_sanctuary/methods/web-browser-automation.md",
      sourceTaskSnapshot: {
        taskId: "task_source_method_1",
        conversationId: "conv-source-method-1",
        status: "success",
        source: "chat",
      },
    });

    const result = await mod.experienceUsageListTool.execute({
      limit: 5,
      task_id: "task_1",
      asset_type: "method",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.listExperienceUsages).toHaveBeenCalledWith(5, {
      taskId: "task_1",
      assetType: "method",
    });
    expect(result.output).toContain("Usage ID: usage-1");
    expect(result.output).toContain("Candidate Title: 网页自动化方法候选");
  });

  it("experience_usage_revoke should revoke current task usage by asset", async () => {
    manager.getTaskByConversation.mockReturnValue({
      id: "task_1",
      conversationId: "conv-1",
      status: "success",
      source: "chat",
      startedAt: "2026-03-16T00:00:00.000Z",
    });
    manager.revokeExperienceUsage.mockReturnValue({
      id: "usage-1",
      taskId: "task_1",
      assetType: "skill",
      assetKey: "网页自动化技能草稿",
      usedVia: "tool",
      sourceCandidateId: "exp-skill-1",
      createdAt: "2026-03-16T00:00:00.000Z",
    });

    const result = await mod.experienceUsageRevokeTool.execute({
      asset_type: "skill",
      asset_key: "网页自动化技能草稿",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(manager.revokeExperienceUsage).toHaveBeenCalledWith({
      taskId: "task_1",
      assetType: "skill",
      assetKey: "网页自动化技能草稿",
    });
    expect(result.output).toContain("Revoked experience usage.");
    expect(result.output).toContain("Asset: 网页自动化技能草稿");
  });

  it("experience_usage_revoke should only allow usage_id from current task", async () => {
    manager.getTaskByConversation.mockReturnValue({
      id: "task_1",
      conversationId: "conv-1",
      status: "success",
      source: "chat",
      startedAt: "2026-03-16T00:00:00.000Z",
    });
    manager.getExperienceUsage.mockReturnValue({
      id: "usage-9",
      taskId: "task_2",
      assetType: "method",
      assetKey: "viewer-method.md",
      usedVia: "tool",
      createdAt: "2026-03-16T00:00:00.000Z",
    });

    const result = await mod.experienceUsageRevokeTool.execute({
      usage_id: "usage-9",
    }, baseContext);

    expect(result.success).toBe(false);
    expect(manager.revokeExperienceUsage).not.toHaveBeenCalled();
    expect(result.error).toContain("does not belong to the current task");
  });

  it("memory_index should report index status", async () => {
    manager.indexWorkspace.mockResolvedValue(undefined);

    const result = await mod.memoryIndexTool.execute({}, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Files: 2");
    expect(result.output).toContain("Chunks: 10");
  });
});
