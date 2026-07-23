import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryManager } from "./manager.js";

describe("derived task retrieval integration", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("returns resume/work recap derived results in searchWithDiagnostics", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-task-search-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      const store = (manager as any).store as {
        createTask: (task: Record<string, unknown>) => void;
      };
      store.createTask({
        id: "task-derived-search-1",
        conversationId: "conv-derived-search-1",
        sessionKey: "conv-derived-search-1",
        source: "chat",
        status: "partial",
        title: "整理 viewer explain_sources",
        summary: "当前停在续做检索接线前。",
        startedAt: "2026-05-21T10:00:00.000Z",
        updatedAt: "2026-05-21T10:10:00.000Z",
        createdAt: "2026-05-21T10:00:00.000Z",
        workRecap: {
          taskId: "task-derived-search-1",
          conversationId: "conv-derived-search-1",
          sessionKey: "conv-derived-search-1",
          headline: "已补来源解释卡片初版。",
          confirmedFacts: ["已补 explain_sources 卡片"],
          pendingActions: ["继续接 viewer 懒加载"],
          derivedFromActivityIds: ["activity-1"],
          updatedAt: "2026-05-21T10:10:00.000Z",
        },
        resumeContext: {
          taskId: "task-derived-search-1",
          conversationId: "conv-derived-search-1",
          sessionKey: "conv-derived-search-1",
          currentStopPoint: "已停在 explain_sources 接线前。",
          nextStep: "继续接 viewer 懒加载并补回归验证。",
          blockers: ["等待统一检索入口接入"],
          derivedFromActivityIds: ["activity-1"],
          updatedAt: "2026-05-21T10:10:00.000Z",
        },
      });

      const instrumentedStore = (manager as unknown as {
        store: {
          getTaskDetails: (...taskIds: [string[]]) => unknown;
          getTaskDerivedDetails: (...taskIds: [string[]]) => unknown;
        };
      }).store;
      const originalGetTaskDetails = instrumentedStore.getTaskDetails.bind(instrumentedStore);
      const originalGetTaskDerivedDetails = instrumentedStore.getTaskDerivedDetails.bind(instrumentedStore);
      let fullDetailCalls = 0;
      let derivedDetailCalls = 0;
      instrumentedStore.getTaskDetails = (...taskIds) => {
        fullDetailCalls += 1;
        return originalGetTaskDetails(...taskIds);
      };
      instrumentedStore.getTaskDerivedDetails = (...taskIds) => {
        derivedDetailCalls += 1;
        return originalGetTaskDerivedDetails(...taskIds);
      };

      const execution = await manager.searchWithDiagnostics("继续接 viewer 懒加载", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      expect(execution.items[0]).toMatchObject({
        id: "derived-task:task-derived-search-1:task_resume_context",
        sourceType: "task_derived",
        metadata: {
          derivedRetrieval: {
            taskId: "task-derived-search-1",
            kind: "task_resume_context",
          },
          memoryTree: {
            sourceClass: "derived",
            sourceKind: "task_resume_context",
          },
        },
      });
      expect(execution.diagnostics.stages.raw.topHits[0]).toMatchObject({
        id: "derived-task:task-derived-search-1:task_resume_context",
        sourceClass: "derived",
      });
      expect(derivedDetailCalls).toBe(1);
      expect(fullDetailCalls).toBe(0);
      expect(execution.diagnostics.derived?.task).toMatchObject({
        admitted: true,
        candidateCount: 1,
        detailCount: 1,
        readByteCount: 0,
        resultCount: 1,
        skipped: false,
        deadline: {
          exceededBeforeStart: false,
          exceededAfterCompletion: false,
        },
      });
    } finally {
      manager.close();
    }
  });

  it("does not inject private derived task results for shared-only searches", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-task-search-shared-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      const store = (manager as any).store as {
        createTask: (task: Record<string, unknown>) => void;
      };
      store.createTask({
        id: "task-derived-search-shared-1",
        conversationId: "conv-derived-search-shared-1",
        sessionKey: "conv-derived-search-shared-1",
        source: "chat",
        status: "partial",
        title: "共享检索隔离验证",
        startedAt: "2026-05-21T10:00:00.000Z",
        updatedAt: "2026-05-21T10:10:00.000Z",
        createdAt: "2026-05-21T10:00:00.000Z",
        resumeContext: {
          taskId: "task-derived-search-shared-1",
          conversationId: "conv-derived-search-shared-1",
          sessionKey: "conv-derived-search-shared-1",
          currentStopPoint: "这是私有续做信息。",
          nextStep: "不应在 shared only 检索中注入。",
          derivedFromActivityIds: ["activity-1"],
          updatedAt: "2026-05-21T10:10:00.000Z",
        },
      });

      const execution = await manager.searchWithDiagnostics("shared only 检索", {
        limit: 3,
        routingPolicy: "chunk_only",
        filter: { scope: "shared" },
      });

      expect(execution.items).toEqual([]);
      expect(execution.diagnostics.stages.raw.count).toBe(0);
    } finally {
      manager.close();
    }
  });
});
