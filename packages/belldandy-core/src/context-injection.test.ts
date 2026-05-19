import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildContextInjectionPrelude, type ContextInjectionMemoryProvider } from "./context-injection.js";
import { MemoryManager } from "../../belldandy-memory/src/manager.js";
import { buildTaskRecapArtifacts } from "../../belldandy-memory/src/task-recap.js";
import { createTaskWorkSurface } from "../../belldandy-memory/src/task-work-surface.js";
import type { TaskActivityRecord, TaskRecord } from "../../belldandy-memory/src/task-types.js";

describe("buildContextInjectionPrelude", () => {
  it("keeps distinct memories across recent-memory and auto-recall while removing duplicates already present in history", async () => {
    const duplicateFromHistory = "Release memory marker: gateway retry window 20 minutes; avoid duplicate webhook execution.";
    const recentDistinct = "Release memory marker: gateway retry window 20 minutes; rotate tool transcript snapshots daily.";
    const autoRecallDistinct = "Release memory marker: gateway retry window 45 minutes; rotate tool transcript snapshots weekly.";

    const memoryManager: ContextInjectionMemoryProvider = {
      getContextInjectionMemories: () => [
        {
          id: "mem-history-dup",
          sourcePath: "memory/release-policy.md",
          summary: duplicateFromHistory,
          snippet: duplicateFromHistory,
          importance: "high",
          category: "decision",
          memoryType: "other",
          updatedAt: "2026-03-22T10:00:00.000Z",
        },
        {
          id: "mem-recent-distinct",
          sourcePath: "memory/release-policy.md",
          summary: recentDistinct,
          snippet: recentDistinct,
          importance: "high",
          category: "decision",
          memoryType: "other",
          updatedAt: "2026-03-22T10:05:00.000Z",
        },
      ],
      getRecentTaskSummaries: () => [],
      getRecentWork: () => [],
      getResumeContext: () => null,
      findSimilarPastWork: () => [],
      search: async () => [
        {
          id: "mem-history-dup",
          sourcePath: "memory/release-policy.md",
          snippet: duplicateFromHistory,
          score: 0.98,
          updatedAt: "2026-03-22T10:00:00.000Z",
        },
        {
          id: "mem-auto-distinct",
          sourcePath: "memory/release-policy.md",
          snippet: autoRecallDistinct,
          score: 0.91,
          updatedAt: "2026-03-22T10:06:00.000Z",
        },
      ],
    };

    const result = await buildContextInjectionPrelude(
      memoryManager,
      {
        prompt: "继续优化网关重试和 transcript 策略",
        userInput: "继续优化网关重试和 transcript 策略",
        meta: {
          currentMessageTime: {
            timestampMs: Date.parse("2026-03-22T10:07:00.000Z"),
            displayTimeText: "2026-03-22 10:07:00 GMT+0",
            isLatest: true,
            role: "user",
          },
        },
        messages: [
          {
            role: "assistant",
            content: duplicateFromHistory,
          },
        ],
      },
      {
        agentId: "default",
        sessionKey: "conv-context-injection",
      },
      {
        contextInjectionEnabled: true,
        contextInjectionLimit: 5,
        contextInjectionIncludeSession: false,
        contextInjectionTaskLimit: 0,
        contextInjectionAllowedCategories: ["decision", "fact"],
        autoRecallEnabled: true,
        autoRecallLimit: 5,
        autoRecallMinScore: 0.3,
        autoRecallTimeoutMs: 50,
      },
    );

    expect(result?.prependContext).toContain("<recent-memory");
    expect(result?.prependContext).toContain("<auto-recall");
    expect(result?.prependContext).toContain("<current-turn");
    expect(result?.prependContext).toContain("latest | user");
    expect(result?.prependContext).toContain(recentDistinct);
    expect(result?.prependContext).toContain(autoRecallDistinct);
    expect(result?.prependContext).not.toContain(duplicateFromHistory);
    expect(result?.deltas?.map((delta) => delta.id)).toEqual(expect.arrayContaining([
      "current-turn",
      "recent-memory",
      "auto-recall",
    ]));
    expect(result?.deltas?.every((delta) => delta.deltaType === "user-prelude")).toBe(true);
  });

  it("injects work overview as first-level summary", async () => {
    const memoryManager: ContextInjectionMemoryProvider = {
      getContextInjectionMemories: () => [],
      getRecentTaskSummaries: () => [],
      getRecentWork: () => [
        {
          taskId: "task-recent-1",
          conversationId: "conv-recent-1",
          title: "补 Step 2 的 resume 快照",
          status: "partial",
          source: "chat",
          startedAt: "2026-04-17T09:00:00.000Z",
          updatedAt: "2026-04-17T09:15:00.000Z",
          toolNames: ["apply_patch"],
          artifactPaths: ["packages/belldandy-memory/src/task-recap.ts"],
          recentActivityTitles: ["已变更文件：packages/belldandy-memory/src/task-recap.ts"],
          workRecap: {
            taskId: "task-recent-1",
            conversationId: "conv-recent-1",
            sessionKey: "conv-context-injection-task",
            headline: "已确认 4 条执行事实；当前停在：已完成 work recap 落库，正在补 resume 注入链路。",
            confirmedFacts: ["已完成 work recap 落库"],
            derivedFromActivityIds: ["act-recent-1"],
            updatedAt: "2026-04-17T09:15:00.000Z",
          },
        },
      ],
      getResumeContext: () => ({
        taskId: "task-recent-1",
        conversationId: "conv-recent-1",
        title: "补 Step 2 的 resume 快照",
        status: "partial",
        source: "chat",
        startedAt: "2026-04-17T09:00:00.000Z",
        updatedAt: "2026-04-17T09:15:00.000Z",
        toolNames: ["apply_patch"],
        artifactPaths: ["packages/belldandy-memory/src/task-recap.ts"],
        recentActivityTitles: ["已变更文件：packages/belldandy-memory/src/task-recap.ts"],
        workRecap: {
          taskId: "task-recent-1",
          conversationId: "conv-recent-1",
          sessionKey: "conv-context-injection-task",
          headline: "已确认 4 条执行事实；当前停在：已完成 work recap 落库，正在补 resume 注入链路。",
          confirmedFacts: ["已完成 work recap 落库"],
          derivedFromActivityIds: ["act-recent-1"],
          updatedAt: "2026-04-17T09:15:00.000Z",
        },
        resumeContext: {
          taskId: "task-recent-1",
          conversationId: "conv-recent-1",
          sessionKey: "conv-context-injection-task",
          currentStopPoint: "已完成 work recap 落库，正在补 resume 注入链路。",
          nextStep: "继续补 recent_work / resume_context 的读取与展示。",
          derivedFromActivityIds: ["act-recent-1"],
          updatedAt: "2026-04-17T09:15:00.000Z",
        },
      }),
      findSimilarPastWork: () => [],
      search: async () => [],
    };

    const result = await buildContextInjectionPrelude(
      memoryManager,
      {
        prompt: "继续推进 Step 2",
        userInput: "继续推进 Step 2",
        messages: [],
      },
      {
        agentId: "default",
        sessionKey: "conv-context-injection-task",
      },
      {
        contextInjectionEnabled: true,
        contextInjectionLimit: 5,
        contextInjectionIncludeSession: false,
        contextInjectionTaskLimit: 3,
        contextInjectionAllowedCategories: ["decision", "fact"],
        autoRecallEnabled: false,
        autoRecallLimit: 5,
        autoRecallMinScore: 0.3,
        autoRecallTimeoutMs: 50,
      },
    );

    expect(result?.prependContext).toContain("<work-overview");
    expect(result?.prependContext).toContain("recent-work");
    expect(result?.prependContext).toContain("recap=已确认 4 条执行事实；当前停在：已完成 work recap 落库，正在补 resume 注入链路。");
    expect(result?.prependContext).toContain("| resume] task=补 Step 2 的 resume 快照;");
    expect(result?.prependContext).not.toContain("<recent-tasks");
    expect(result?.deltas?.map((delta) => delta.id)).toContain("work-overview");
  });

  it("adds second-level resume details only in resume mode", async () => {
    const memoryManager: ContextInjectionMemoryProvider = {
      getContextInjectionMemories: () => [],
      getRecentTaskSummaries: () => [],
      getRecentWork: () => [
        {
          taskId: "task-step-3",
          conversationId: "conv-step-3",
          title: "推进 Step 3 的检索短路径",
          status: "partial",
          source: "chat",
          startedAt: "2026-04-17T10:00:00.000Z",
          updatedAt: "2026-04-17T10:20:00.000Z",
          toolNames: ["apply_patch"],
          artifactPaths: ["packages/belldandy-core/src/context-injection.ts"],
          recentActivityTitles: ["已变更文件：packages/belldandy-core/src/context-injection.ts"],
          workRecap: {
            taskId: "task-step-3",
            conversationId: "conv-step-3",
            sessionKey: "conv-context-injection-resume",
            headline: "已确认 5 条执行事实；当前停在：已接好 manager 与 skill，待补 context injection。",
            confirmedFacts: ["已接好 manager 与 skill"],
            derivedFromActivityIds: ["act-step3-1"],
            updatedAt: "2026-04-17T10:20:00.000Z",
          },
        },
      ],
      getResumeContext: () => ({
        taskId: "task-step-3",
        conversationId: "conv-step-3",
        title: "推进 Step 3 的检索短路径",
        status: "partial",
        source: "chat",
        startedAt: "2026-04-17T10:00:00.000Z",
        updatedAt: "2026-04-17T10:20:00.000Z",
        toolNames: ["apply_patch"],
        artifactPaths: ["packages/belldandy-core/src/context-injection.ts"],
        workRecap: {
          taskId: "task-step-3",
          conversationId: "conv-step-3",
          sessionKey: "conv-context-injection-resume",
          headline: "已确认 5 条执行事实；当前停在：已接好 manager 与 skill，待补 context injection。",
          confirmedFacts: ["已新增 recent_work", "已新增 resume_context"],
          derivedFromActivityIds: ["act-step3-1", "act-step3-2"],
          updatedAt: "2026-04-17T10:20:00.000Z",
        },
        resumeContext: {
          taskId: "task-step-3",
          conversationId: "conv-step-3",
          sessionKey: "conv-context-injection-resume",
          currentStopPoint: "已接好 manager 与 skill，待补 context injection。",
          nextStep: "继续补默认注入摘要与展开层级。",
          derivedFromActivityIds: ["act-step3-1", "act-step3-2"],
          updatedAt: "2026-04-17T10:20:00.000Z",
        },
        recentActivityTitles: ["已执行工具 apply_patch", "已变更文件：packages/belldandy-core/src/context-injection.ts"],
      }),
      findSimilarPastWork: () => [
        {
          taskId: "task-step-2",
          conversationId: "conv-step-2",
          title: "补 Step 2 的 resume 快照",
          status: "partial",
          source: "chat",
          startedAt: "2026-04-17T08:30:00.000Z",
          updatedAt: "2026-04-17T09:00:00.000Z",
          toolNames: ["apply_patch"],
          artifactPaths: ["packages/belldandy-memory/src/task-recap.ts"],
          recentActivityTitles: ["已变更文件：packages/belldandy-memory/src/task-recap.ts"],
          workRecap: {
            taskId: "task-step-2",
            conversationId: "conv-step-2",
            sessionKey: "conv-context-injection-resume",
            headline: "已确认 4 条执行事实；当前停在：已完成 work recap 落库。",
            confirmedFacts: ["已完成 work recap 落库"],
            derivedFromActivityIds: ["act-step2-1"],
            updatedAt: "2026-04-17T09:00:00.000Z",
          },
          matchReasons: ["标题/目标", "当前停点"],
        },
      ],
      search: async () => [],
    };

    const result = await buildContextInjectionPrelude(
      memoryManager,
      {
        prompt: "继续处理 Step 3，上次做到哪了？",
        userInput: "继续处理 Step 3，上次做到哪了？",
        messages: [],
      },
      {
        agentId: "default",
        sessionKey: "conv-context-injection-resume",
      },
      {
        contextInjectionEnabled: true,
        contextInjectionLimit: 5,
        contextInjectionIncludeSession: false,
        contextInjectionTaskLimit: 3,
        contextInjectionAllowedCategories: ["decision", "fact"],
        autoRecallEnabled: false,
        autoRecallLimit: 5,
        autoRecallMinScore: 0.3,
        autoRecallTimeoutMs: 50,
      },
    );

    expect(result?.prependContext).toContain("<work-overview");
    expect(result?.prependContext).toContain("<resume-details");
    expect(result?.prependContext).toContain("resume-fact");
    expect(result?.prependContext).toContain("resume-activity");
    expect(result?.prependContext).toContain("similar-work");
    expect(result?.prependContext).toContain("matched=标题/目标, 当前停点");
    expect(result?.deltas?.map((delta) => delta.id)).toEqual(expect.arrayContaining([
      "work-overview",
      "resume-details",
    ]));
  });

  it("builds real resume context from stored task facts instead of mocked provider data", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-context-injection-real-"));
    const stateDir = path.join(rootDir, "state");
    const workspaceRoot = path.join(rootDir, "workspace");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(workspaceRoot, { recursive: true });

    const memoryManager = createRealMemoryManager({
      workspaceRoot,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      const store = (memoryManager as any).store;
      seedTaskForContext(store, {
        taskId: "task-real-resume-current",
        conversationId: "conv-real-resume-current",
        agentId: "default",
        status: "partial",
        objective: "继续修 memory viewer 来源解释入口",
        summary: "已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。",
        updatedAt: "2026-04-17T13:20:00.000Z",
        activities: [
          createContextActivity({
            id: "activity-real-current-1",
            taskId: "task-real-resume-current",
            conversationId: "conv-real-resume-current",
            sequence: 0,
            kind: "tool_called",
            state: "completed",
            happenedAt: "2026-04-17T13:05:00.000Z",
            title: "已执行工具 apply_patch",
          }),
          createContextActivity({
            id: "activity-real-current-2",
            taskId: "task-real-resume-current",
            conversationId: "conv-real-resume-current",
            sequence: 1,
            kind: "file_changed",
            state: "completed",
            happenedAt: "2026-04-17T13:10:00.000Z",
            title: "已变更文件：apps/web/public/app/features/memory-detail-render.js",
            files: ["apps/web/public/app/features/memory-detail-render.js"],
          }),
        ],
      });
      seedTaskForContext(store, {
        taskId: "task-real-resume-similar",
        conversationId: "conv-real-resume-similar",
        agentId: "default",
        status: "success",
        objective: "修复 memory viewer 来源解释渲染",
        summary: "已补 viewer 中 explain_sources 来源说明与任务详情展示。",
        updatedAt: "2026-04-16T17:00:00.000Z",
        activities: [
          createContextActivity({
            id: "activity-real-similar-1",
            taskId: "task-real-resume-similar",
            conversationId: "conv-real-resume-similar",
            sequence: 0,
            kind: "file_changed",
            state: "completed",
            happenedAt: "2026-04-16T16:55:00.000Z",
            title: "已变更文件：apps/web/public/app/features/memory-detail-render.js",
            files: ["apps/web/public/app/features/memory-detail-render.js"],
          }),
        ],
      });

      const recentWork = memoryManager.getRecentWork({
        query: "memory viewer 来源解释",
        limit: 3,
        filter: { agentId: "default" },
      });
      const resumeItem = memoryManager.getResumeContext({
        query: "继续修 memory viewer 来源解释入口，上次做到哪了？",
        filter: { agentId: "default" },
      });
      const similarItems = memoryManager.findSimilarPastWork({
        query: "memory viewer 来源解释",
        limit: 3,
        filter: { agentId: "default" },
      });

      expect(recentWork[0]?.taskId).toBe("task-real-resume-current");
      expect(recentWork[0]?.status).toBe("partial");
      expect(resumeItem?.taskId).toBe("task-real-resume-current");
      expect(resumeItem?.resumeContext?.currentStopPoint).toBe("已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。");
      expect(similarItems.some((item) => item.taskId === "task-real-resume-similar")).toBe(true);

      const result = await buildContextInjectionPrelude(
        memoryManager,
        {
          prompt: "继续修 memory viewer 来源解释入口，上次做到哪了？",
          userInput: "继续修 memory viewer 来源解释入口，上次做到哪了？",
          messages: [],
        },
        {
          agentId: "default",
          sessionKey: "conv-real-resume-current",
        },
        {
          contextInjectionEnabled: true,
          contextInjectionLimit: 5,
          contextInjectionIncludeSession: false,
          contextInjectionTaskLimit: 3,
          contextInjectionAllowedCategories: ["decision", "fact"],
          autoRecallEnabled: false,
          autoRecallLimit: 5,
          autoRecallMinScore: 0.3,
          autoRecallTimeoutMs: 50,
        },
      );

      expect(result?.prependContext).toContain("<work-overview");
      expect(result?.prependContext).toContain("<resume-details");
      expect(result?.prependContext).toContain("继续修 memory viewer 来源解释入口");
      expect(result?.prependContext).toContain("stop=已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。");
      expect(result?.prependContext).toContain("next=先验证最近变更或产物，再继续后续动作。");
      expect(result?.prependContext).toContain("resume-activity");
      expect(result?.prependContext).toContain("修复 memory viewer 来源解释渲染");
      expect(result?.prependContext).not.toContain("similar-work");
      expect(result?.prependContext).not.toContain("<recent-tasks");

      const explanation = createTaskWorkSurface(memoryManager).explainSources({
        taskId: "task-real-resume-current",
      });

      expect(explanation?.sourceRefs.map((item) => item.kind)).toEqual([
        "task_summary",
        "work_recap",
        "resume_context",
        "activity_worklog",
      ]);
      expect(explanation?.sourceRefs[1]?.previews[0]).toContain("当前停在");
      expect(explanation?.sourceRefs[2]?.previews).toContain("已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。");
      expect(explanation?.sourceRefs[3]?.previews).toEqual(expect.arrayContaining([
        "已变更文件：apps/web/public/app/features/memory-detail-render.js",
        "已执行工具 apply_patch",
      ]));
    } finally {
      memoryManager.close();
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("uses real score-aware memory search ordering for auto-recall injection", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-context-auto-recall-"));
    const stateDir = path.join(rootDir, "state");
    const workspaceRoot = path.join(rootDir, "workspace");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(workspaceRoot, { recursive: true });

    const memoryManager = createRealMemoryManager({
      workspaceRoot,
      stateDir,
    });

    try {
      memoryManager.upsertMemoryChunk({
        id: "auto-recall-derived",
        sourcePath: "memory/derived-summary.md",
        sourceType: "manual",
        memoryType: "other",
        content: "auto recall smoke marker derived summary for gateway retry rollout",
      });
      memoryManager.upsertMemoryChunk({
        id: "auto-recall-curated",
        sourcePath: "MEMORY.md",
        sourceType: "manual",
        memoryType: "other",
        content: "auto recall smoke marker curated memory for gateway retry rollout",
      });
      (memoryManager as any).store.upsertMemoryScores([
        {
          id: "score:v1_rule_only:chunk:auto-recall-derived",
          targetType: "chunk",
          targetId: "auto-recall-derived",
          sourceId: "memory:derived",
          scoreTotal: 0,
          scoreVersion: "v1_rule_only",
          rationale: { sourceClass: "derived" },
        },
        {
          id: "score:v1_rule_only:chunk:auto-recall-curated",
          targetType: "chunk",
          targetId: "auto-recall-curated",
          sourceId: "memory:curated",
          scoreTotal: 1,
          scoreVersion: "v1_rule_only",
          rationale: { sourceClass: "curated" },
        },
      ]);

      const searchResults = await memoryManager.search("auto recall smoke marker gateway retry rollout", {
        limit: 5,
        retrievalMode: "explicit",
        filter: { agentId: null },
      });

      expect(searchResults[0]?.id).toBe("auto-recall-curated");
      expect(searchResults[0]?.metadata?.memoryTree).toMatchObject({
        scoreVersion: "v1_rule_only",
        sourceClass: "curated",
      });
      expect(searchResults.some((item) => item.id === "auto-recall-derived")).toBe(true);

      const result = await buildContextInjectionPrelude(
        memoryManager,
        {
          prompt: "auto recall smoke marker gateway retry rollout",
          userInput: "auto recall smoke marker gateway retry rollout",
          messages: [],
        },
        {
          agentId: "default",
          sessionKey: "conv-auto-recall-smoke",
        },
        {
          contextInjectionEnabled: false,
          contextInjectionLimit: 0,
          contextInjectionIncludeSession: false,
          contextInjectionTaskLimit: 0,
          contextInjectionAllowedCategories: ["decision", "fact"],
          autoRecallEnabled: true,
          autoRecallLimit: 5,
          autoRecallMinScore: 0.05,
          autoRecallTimeoutMs: 50,
        },
      );

      expect(result).toBeTruthy();
      expect(result?.prependContext).toContain("<auto-recall");
      expect(result?.prependContext).toContain("auto recall smoke marker curated memory");
      expect(result?.prependContext).toContain("auto recall smoke marker derived summary");
      expect(result?.deltas?.map((delta) => delta.id)).toContain("auto-recall");
      const autoRecallDelta = result?.deltas?.find((delta) => delta.id === "auto-recall");
      expect(autoRecallDelta?.metadata).toMatchObject({
        blockTag: "auto-recall",
        observability: {
          candidateCount: 2,
          keptCount: 2,
          filteredOutCount: 0,
          minScore: 0.05,
          sourceClassMix: {
            curated: 1,
            derived: 1,
          },
          topHitIds: ["auto-recall-curated", "auto-recall-derived"],
          searchDiagnostics: {
            scoreSignalAppliedCount: 2,
            stages: {
              returned: {
                count: 2,
              },
            },
          },
        },
      });
      expect(result?.prependContext?.indexOf("auto recall smoke marker curated memory")).toBeLessThan(
        result?.prependContext?.indexOf("auto recall smoke marker derived summary") ?? Number.POSITIVE_INFINITY,
      );
    } finally {
      memoryManager.close();
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

function createRealMemoryManager(options: ConstructorParameters<typeof MemoryManager>[0]): MemoryManager {
  const manager = new MemoryManager(options);
  (manager as any).embeddingProvider = {
    modelName: "test-memory-manager",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  return manager;
}

function seedTaskForContext(store: any, input: {
  taskId: string;
  conversationId: string;
  agentId?: string;
  status: TaskRecord["status"];
  objective?: string;
  summary?: string;
  updatedAt: string;
  activities: TaskActivityRecord[];
}): void {
  const task: TaskRecord = {
    id: input.taskId,
    conversationId: input.conversationId,
    sessionKey: input.conversationId,
    agentId: input.agentId,
    source: "chat",
    status: input.status,
    objective: input.objective,
    summary: input.summary,
    startedAt: input.updatedAt,
    finishedAt: input.status === "success" ? input.updatedAt : undefined,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
  };
  const recap = buildTaskRecapArtifacts({
    task,
    activities: input.activities,
    updatedAt: input.updatedAt,
  });
  store.createTask({
    ...task,
    workRecap: recap.workRecap,
    resumeContext: recap.resumeContext,
  });
  for (const activity of input.activities) {
    store.createTaskActivity(activity);
  }
}

function createContextActivity(input: {
  id: string;
  taskId: string;
  conversationId: string;
  sequence: number;
  kind: TaskActivityRecord["kind"];
  state: TaskActivityRecord["state"];
  happenedAt: string;
  title: string;
  files?: string[];
}): TaskActivityRecord {
  return {
    id: input.id,
    taskId: input.taskId,
    conversationId: input.conversationId,
    sessionKey: input.conversationId,
    source: "chat",
    kind: input.kind,
    state: input.state,
    sequence: input.sequence,
    happenedAt: input.happenedAt,
    recordedAt: input.happenedAt,
    title: input.title,
    files: input.files,
  };
}
