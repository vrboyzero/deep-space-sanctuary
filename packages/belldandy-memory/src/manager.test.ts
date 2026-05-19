import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { MemoryManager } from "./manager.js";
import { buildTaskRecapArtifacts } from "./task-recap.js";
import type { TaskActivityRecord, TaskRecord } from "./task-types.js";

describe("MemoryManager guardrails", () => {
  let rootDir: string;
  let stateDir: string;
  let sessionsDir: string;
  let docsDir: string;
  let manager: MemoryManager | null;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-manager-"));
    stateDir = path.join(rootDir, "state");
    sessionsDir = path.join(stateDir, "sessions");
    docsDir = path.join(rootDir, "docs");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.mkdir(docsDir, { recursive: true });
    manager = null;
  });

  afterEach(async () => {
    manager?.close();
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => { });
  });

  it("indexes explicit MEMORY.md files and additional workspace roots", async () => {
    const stateMemoryPath = path.join(stateDir, "MEMORY.md");
    const extraDocPath = path.join(docsDir, "guide.md");
    await fs.writeFile(stateMemoryPath, "# Main Memory\nmarkerstateroot\n", "utf-8");
    await fs.writeFile(extraDocPath, "# Guide\nmarkerextraroot\n", "utf-8");

    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
      additionalRoots: [docsDir],
      additionalFiles: [stateMemoryPath],
    });

    await manager.indexWorkspace();

    const recent = manager.getRecent(10);

    expect(recent.some((item) => item.sourcePath === stateMemoryPath)).toBe(true);
    expect(recent.some((item) => item.sourcePath === extraDocPath)).toBe(true);
  });

  it("resolves relative memory source paths against stateDir roots for task linking", async () => {
    const stateMemoryPath = path.join(stateDir, "MEMORY.md");
    const dailyMemoryPath = path.join(stateDir, "memory", "2026-03-17.md");
    await fs.mkdir(path.dirname(dailyMemoryPath), { recursive: true });
    await fs.writeFile(stateMemoryPath, "# Main Memory\nstate root memory\n", "utf-8");
    await fs.writeFile(dailyMemoryPath, "# 2026-03-17\ndaily memory\n", "utf-8");

    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
      additionalRoots: [path.join(stateDir, "memory")],
      additionalFiles: [stateMemoryPath],
      taskMemoryEnabled: true,
    });

    await manager.indexWorkspace();

    expect(await manager.linkTaskMemoriesFromSource("conv-state-link", "MEMORY.md", "used")).toBeGreaterThan(0);
    expect(await manager.linkTaskMemoriesFromSource("conv-state-link", "memory/2026-03-17.md", "used")).toBeGreaterThan(0);
  });

  it("annotates exact dedup preview with observability and reindexable source hints", async () => {
    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
      additionalRoots: [path.join(stateDir, "memory")],
      additionalFiles: [path.join(stateDir, "MEMORY.md")],
    });

    manager.upsertMemoryChunk({
      id: "dedup-indexable",
      sourcePath: "memory/2026-05-19.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "same memory chunk\nsecond line",
    });
    manager.upsertMemoryChunk({
      id: "dedup-external",
      sourcePath: "artifacts/export.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "same memory chunk\r\nsecond line",
    });

    const report = manager.previewExactDedup({ memoryType: "daily" }, { maxGroups: 10 });

    expect(report.observability).toMatchObject({
      beforeChunkCount: 2,
      estimatedAfterChunkCount: 1,
    });
    expect(typeof report.observability?.pageCount).toBe("number");
    expect(typeof report.observability?.freelistCount).toBe("number");
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.keep.sourceIndexing?.reindexable).toBe(true);
    expect(report.groups[0]?.keep.sourceIndexing?.scope).toBe("state_memory_root");
    expect(report.groups[0]?.remove[0]?.sourceIndexing).toMatchObject({
      reindexable: false,
      scope: "external",
    });
    expect(report.groups[0]?.sourceIndexing).toMatchObject({
      reindexableSourcePathCount: 1,
      nonReindexableSourcePathCount: 1,
      anyAffectedSourcePathReindexable: true,
      allAffectedSourcePathsReindexable: false,
    });
    expect(report.sourceIndexingSummary).toMatchObject({
      reindexableSourcePathCount: 1,
      nonReindexableSourcePathCount: 1,
      duplicateGroupsWithReindexableSources: 1,
      duplicateGroupsWithOnlyNonReindexableSources: 0,
    });
  });

  it("rebuilds memory tree sources and chunk scores within memory.sqlite", async () => {
    const stateMemoryDir = path.join(stateDir, "memory");
    const stateMemoryPath = path.join(stateMemoryDir, "2026-05-19.md");
    const externalDocPath = path.join(docsDir, "external-plan.md");
    await fs.mkdir(stateMemoryDir, { recursive: true });
    await fs.writeFile(stateMemoryPath, "# Daily Memory\nmemory tree source registry\n", "utf-8");
    await fs.writeFile(externalDocPath, "# External Plan\nchunk score input\n", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      additionalRoots: [stateMemoryDir],
    });

    manager.upsertMemoryChunk({
      id: "tree-source-daily-1",
      sourcePath: stateMemoryPath,
      sourceType: "file",
      memoryType: "daily",
      content: "daily memory mentions task prompt and memory path docs/guide.md",
      visibility: "shared",
    });
    manager.upsertMemoryChunk({
      id: "tree-source-external-1",
      sourcePath: externalDocPath,
      sourceType: "file",
      memoryType: "other",
      content: "external workspace plan with agent task tool references",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
    };
    store.createTask({
      id: "task-tree-score-1",
      conversationId: "conv-tree-score-1",
      sessionKey: "conv-tree-score-1",
      source: "chat",
      status: "success",
      title: "整理 P9 source registry",
      startedAt: "2026-05-19T12:00:00.000Z",
      finishedAt: "2026-05-19T12:05:00.000Z",
      createdAt: "2026-05-19T12:00:00.000Z",
      updatedAt: "2026-05-19T12:05:00.000Z",
    });
    store.linkTaskMemory("task-tree-score-1", "tree-source-daily-1", "used");

    const sourceResult = await manager.rebuildMemoryTreeSources();
    expect(sourceResult).toMatchObject({
      inventorySources: expect.any(Number),
      dynamicSources: 1,
    });

    const sources = manager.listMemoryTreeSources(50);
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "builtin:memory:daily-notes",
        sourceKind: "memory_notes",
      }),
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: externalDocPath,
      }),
    ]));

    const scoreResult = manager.rebuildMemoryTreeScores();
    expect(scoreResult).toMatchObject({
      scoreVersion: "v1_rule_only",
      totalScores: 2,
    });

    const scores = manager.listMemoryTreeScores(10, { targetType: "chunk" });
    expect(scores).toHaveLength(2);
    expect(scores.find((item) => item.targetId === "tree-source-daily-1")).toMatchObject({
      sourceId: "builtin:memory:daily-notes",
      taskOutcomeScore: 1,
      interactionScore: expect.any(Number),
      rationale: expect.objectContaining({
        sourceKind: "memory_notes",
        sourceClassWeight: expect.any(Number),
      }),
    });
  });

  it("applies persisted memory tree scores before reranking", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
    });

    const store = (manager as any).store as {
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    const rawResults = [
      {
        id: "p12-low-score",
        sourcePath: path.join(docsDir, "low-score.md"),
        sourceType: "file",
        memoryType: "other",
        snippet: "memory tree rollout plan",
        summary: "lower governance score",
        score: 0.82,
        metadata: {},
        updatedAt: "2026-05-19T09:00:00.000Z",
      },
      {
        id: "p12-high-score",
        sourcePath: path.join(stateDir, "MEMORY.md"),
        sourceType: "file",
        memoryType: "other",
        snippet: "memory tree rollout plan",
        summary: "higher governance score",
        score: 0.79,
        metadata: {},
        updatedAt: "2026-05-19T09:00:00.000Z",
      },
    ];

    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p12-low-score",
        targetType: "chunk",
        targetId: "p12-low-score",
        sourceId: "workspace:low-score",
        scoreTotal: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
      },
      {
        id: "score:v1_rule_only:chunk:p12-high-score",
        targetType: "chunk",
        targetId: "p12-high-score",
        sourceId: "builtin:memory:core",
        scoreTotal: 0.95,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
    ]);

    const adjusted = (manager as any).applyMemoryTreeScoreSignals(rawResults);
    const reranked = (manager as any).reranker.rerank(adjusted);

    expect(reranked.map((item: { id: string }) => item.id)).toEqual(["p12-high-score", "p12-low-score"]);
    expect(reranked[0]?.metadata).toMatchObject({
      memoryTree: {
        scoreTotal: 0.95,
        sourceClass: "curated",
        scoreVersion: "v1_rule_only",
      },
    });
  });

  it("captures P16-A search diagnostics across raw score-aware rerank and final stages", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
    });

    const store = (manager as any).store as {
      searchHybrid: (...args: any[]) => Array<Record<string, unknown>>;
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    const reranker = (manager as any).reranker as {
      rerank: (items: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
    };

    const rawResults = [
      {
        id: "p16-low-score",
        sourcePath: path.join(docsDir, "low-score.md"),
        sourceType: "file",
        memoryType: "other",
        snippet: "memory tree rollout plan",
        summary: "lower governance score",
        score: 0.82,
        metadata: {},
        updatedAt: "2026-05-19T09:00:00.000Z",
      },
      {
        id: "p16-high-score",
        sourcePath: path.join(stateDir, "MEMORY.md"),
        sourceType: "file",
        memoryType: "other",
        snippet: "memory tree rollout plan",
        summary: "higher governance score",
        score: 0.79,
        metadata: {},
        updatedAt: "2026-05-19T09:00:00.000Z",
      },
    ];
    const originalSearchHybrid = store.searchHybrid.bind(store);
    const originalRerank = reranker.rerank.bind(reranker);
    store.searchHybrid = () => rawResults as any;
    reranker.rerank = (items) => [items[1], items[0]];

    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p16-low-score",
        targetType: "chunk",
        targetId: "p16-low-score",
        sourceId: "workspace:low-score",
        scoreTotal: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
      },
      {
        id: "score:v1_rule_only:chunk:p16-high-score",
        targetType: "chunk",
        targetId: "p16-high-score",
        sourceId: "builtin:memory:core",
        scoreTotal: 0.95,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
    ]);

    try {
      const execution = await manager.searchWithDiagnostics("memory tree rollout plan", {
        limit: 1,
        includeContent: false,
      });

      expect(execution.items.map((item) => item.id)).toEqual(["p16-high-score"]);
      expect(execution.diagnostics).toMatchObject({
        retrievalMode: "explicit",
        limit: 1,
        skipped: false,
        scoreSignalAppliedCount: 2,
        sourceClassMix: {
          curated: 1,
        },
        stages: {
          raw: {
            count: 2,
            topHits: [
              expect.objectContaining({ id: "p16-low-score", sourceClass: "unknown" }),
              expect.objectContaining({ id: "p16-high-score", sourceClass: "unknown" }),
            ],
          },
          scoreAware: {
            count: 2,
            topHits: [
              expect.objectContaining({ id: "p16-low-score", sourceClass: "derived" }),
              expect.objectContaining({ id: "p16-high-score", sourceClass: "curated" }),
            ],
          },
          reranked: {
            count: 2,
            topHits: [
              expect.objectContaining({ id: "p16-high-score", sourceClass: "curated" }),
              expect.objectContaining({ id: "p16-low-score", sourceClass: "derived" }),
            ],
          },
          returned: {
            count: 1,
            topHits: [
              expect.objectContaining({ id: "p16-high-score", sourceClass: "curated" }),
            ],
          },
        },
      });
    } finally {
      store.searchHybrid = originalSearchHybrid;
      reranker.rerank = originalRerank;
    }
  });

  it("uses source class signal as a tie-breaker when memory tree scores are equal", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
    });

    const store = (manager as any).store as {
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    const rawResults = [
      {
        id: "p12-derived",
        sourcePath: path.join(docsDir, "derived.md"),
        sourceType: "file",
        memoryType: "other",
        snippet: "topic memory summary",
        summary: "derived summary",
        score: 0.75,
        metadata: {},
        updatedAt: "2026-05-19T09:00:00.000Z",
      },
      {
        id: "p12-curated",
        sourcePath: path.join(stateDir, "MEMORY.md"),
        sourceType: "file",
        memoryType: "other",
        snippet: "topic memory summary",
        summary: "curated summary",
        score: 0.75,
        metadata: {},
        updatedAt: "2026-05-19T09:00:00.000Z",
      },
    ];

    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p12-derived",
        targetType: "chunk",
        targetId: "p12-derived",
        sourceId: "workspace:derived",
        scoreTotal: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
      },
      {
        id: "score:v1_rule_only:chunk:p12-curated",
        targetType: "chunk",
        targetId: "p12-curated",
        sourceId: "builtin:memory:core",
        scoreTotal: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
    ]);

    const adjusted = (manager as any).applyMemoryTreeScoreSignals(rawResults);
    const results = (manager as any).reranker.rerank(adjusted);

    expect(results.map((item: { id: string }) => item.id)).toEqual(["p12-curated", "p12-derived"]);
    expect(results[0]?.metadata).toMatchObject({
      memoryTree: {
        sourceClass: "curated",
      },
    });
  });

  it("persists P10 reports and rebuilds L1 task nodes with chunk edges", async () => {
    const stateMemoryDir = path.join(stateDir, "memory");
    const stateMemoryPath = path.join(stateMemoryDir, "2026-05-20.md");
    await fs.mkdir(stateMemoryDir, { recursive: true });
    await fs.writeFile(stateMemoryPath, "# Daily Memory\np10 report\n", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      additionalRoots: [stateMemoryDir],
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "p10-report-a",
      sourcePath: stateMemoryPath,
      sourceType: "file",
      memoryType: "daily",
      content: "duplicate content for p10 report\nline two",
      visibility: "shared",
    });
    manager.upsertMemoryChunk({
      id: "p10-report-b",
      sourcePath: path.join(docsDir, "report-duplicate.md"),
      sourceType: "file",
      memoryType: "other",
      content: "duplicate content for p10 report\r\nline two",
    });

    const inventoryPreview = await manager.previewSourceInventory();
    const inventoryRecord = manager.persistMemoryTreeInventoryReport(inventoryPreview, {
      createdBy: "test",
    });
    expect(inventoryRecord.reportType).toBe("inventory");

    const dedupPreview = manager.previewExactDedup(undefined, { maxGroups: 10 });
    const dedupRecord = manager.persistMemoryTreeDedupPreviewReport(dedupPreview, {
      maxGroups: 10,
      createdBy: "test",
    });
    expect(dedupRecord.reportType).toBe("dedup_preview");

    const exported = await manager.exportMemoryTreeReportMarkdown(dedupRecord.id);
    expect(exported.markdownPath.endsWith(".md")).toBe(true);
    expect(path.basename(exported.markdownPath)).not.toContain(":");
    const exportedContent = await fs.readFile(exported.markdownPath, "utf-8");
    expect(exportedContent).toContain("# Memory Tree Report");

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
    };
    store.createTask({
      id: "task-tree-node-1",
      conversationId: "conv-tree-node-1",
      sessionKey: "conv-tree-node-1",
      source: "chat",
      status: "partial",
      title: "整理 P10 task node",
      summary: "当前停在 report export 与 node edge 回链。",
      startedAt: "2026-05-19T14:00:00.000Z",
      finishedAt: "2026-05-19T14:10:00.000Z",
      createdAt: "2026-05-19T14:00:00.000Z",
      updatedAt: "2026-05-19T14:10:00.000Z",
    });
    store.linkTaskMemory("task-tree-node-1", "p10-report-a", "used");

    const nodeResult = manager.rebuildMemoryTreeNodes({ limit: 20 });
    expect(nodeResult).toMatchObject({
      kind: "task",
      totalNodes: 1,
      totalEdges: 1,
    });

    const reports = manager.listMemoryTreeReports(10);
    expect(reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ reportType: "inventory" }),
      expect.objectContaining({ reportType: "dedup_preview" }),
      expect.objectContaining({ reportType: "tree_build_preview" }),
    ]));

    const nodes = manager.listMemoryTreeNodes(10, { kind: "task" });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "task:task-tree-node-1",
      summaryVersion: "p10-task-node-v1",
      metadata: expect.objectContaining({
        taskId: "task-tree-node-1",
        linkedChunkCount: 1,
      }),
    });

    const edges = manager.listMemoryTreeEdges({ parentNodeId: "task:task-tree-node-1" });
    expect(edges).toEqual([
      expect.objectContaining({
        childId: "p10-report-a",
        relation: "contains",
      }),
    ]);
  });

  it("rebuilds P13 topic nodes and returns chunk provenance for node search", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "p13-topic-low",
      sourcePath: path.join(docsDir, "viewer-audit-outline.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer-audit",
      content: "viewer audit baseline notes",
      metadata: {
        summary: "baseline viewer audit notes",
      },
    });
    manager.upsertMemoryChunk({
      id: "p13-topic-high",
      sourcePath: path.join(docsDir, "viewer-audit-summary.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer-audit",
      content: "viewer audit final checklist",
      metadata: {
        summary: "final viewer audit checklist",
      },
    });
    manager.upsertMemoryChunk({
      id: "p13-topic-other",
      sourcePath: path.join(docsDir, "release-gate.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "release-gate",
      content: "release gate notes",
    });

    const store = (manager as any).store as {
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p13-topic-low",
        targetType: "chunk",
        targetId: "p13-topic-low",
        scoreTotal: 0.2,
        sourceWeightScore: 0.1,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
        createdAt: "2026-05-19T16:00:00.000Z",
        updatedAt: "2026-05-19T16:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:p13-topic-high",
        targetType: "chunk",
        targetId: "p13-topic-high",
        scoreTotal: 0.9,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
        createdAt: "2026-05-19T16:00:00.000Z",
        updatedAt: "2026-05-19T16:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:p13-topic-other",
        targetType: "chunk",
        targetId: "p13-topic-other",
        scoreTotal: 0.4,
        sourceWeightScore: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
        createdAt: "2026-05-19T16:00:00.000Z",
        updatedAt: "2026-05-19T16:00:00.000Z",
      },
    ]);

    const rebuild = manager.rebuildMemoryTreeNodes({ limit: 20, kind: "topic" });
    expect(rebuild).toMatchObject({
      kind: "topic",
      totalNodes: 2,
      totalEdges: 3,
    });

    const searchResults = manager.searchMemoryTreeNodes("viewer audit", {
      limit: 5,
      chunkLimitPerNode: 5,
      filter: {
        kind: "topic",
      },
    });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      node: expect.objectContaining({
        kind: "topic",
        summaryVersion: "p13-topic-node-v1",
        topicKey: "viewer-audit",
        metadata: expect.objectContaining({
          topic: "viewer-audit",
          totalChunkCount: 2,
        }),
      }),
      matchReasons: expect.arrayContaining(["标题", "topic"]),
    });
    expect(searchResults[0]?.chunks.map((item) => item.id)).toEqual([
      "p13-topic-high",
      "p13-topic-low",
    ]);
    expect(searchResults[0]?.edges.map((item) => item.childId)).toEqual([
      "p13-topic-high",
      "p13-topic-low",
    ]);

    const detail = manager.getMemoryTreeNodeDetail(searchResults[0]!.node.id, { chunkLimit: 5 });
    expect(detail).toBeTruthy();
    expect(detail?.chunks.map((item) => item.id)).toEqual([
      "p13-topic-high",
      "p13-topic-low",
    ]);
  });

  it("reviews and applies P14 dedup reports by archiving duplicate chunks and lowering their scores", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "p14-keep",
      sourcePath: path.join(stateDir, "memory", "2026-05-19.md"),
      sourceType: "manual",
      memoryType: "daily",
      content: "same duplicate payload\nline two",
      visibility: "shared",
    });
    manager.upsertMemoryChunk({
      id: "p14-remove",
      sourcePath: path.join(docsDir, "duplicate-note.md"),
      sourceType: "manual",
      memoryType: "daily",
      content: "same duplicate payload\r\nline two",
      visibility: "private",
    });

    const store = (manager as any).store as {
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p14-keep",
        targetType: "chunk",
        targetId: "p14-keep",
        scoreTotal: 0.85,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
        createdAt: "2026-05-19T17:00:00.000Z",
        updatedAt: "2026-05-19T17:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:p14-remove",
        targetType: "chunk",
        targetId: "p14-remove",
        scoreTotal: 0.8,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
        createdAt: "2026-05-19T17:00:00.000Z",
        updatedAt: "2026-05-19T17:00:00.000Z",
      },
    ]);

    const preview = manager.previewExactDedup({ memoryType: "daily" }, { maxGroups: 10 });
    const report = manager.persistMemoryTreeDedupPreviewReport(preview, {
      filter: { memoryType: "daily" },
      maxGroups: 10,
      createdBy: "test",
    });
    expect(report.status).toBe("ready");

    const reviewed = manager.reviewMemoryTreeReport(report.id, "approved", {
      reviewedBy: "tester",
      note: "ready to archive duplicate leaves",
    });
    expect(reviewed.previousStatus).toBe("ready");
    expect(reviewed.report.status).toBe("approved");

    const applied = await manager.applyMemoryTreeReport(report.id, {
      appliedBy: "tester",
      note: "metadata and score only",
    });
    expect(applied.report.status).toBe("applied");
    expect(applied.updatedChunkCount).toBe(1);
    expect(applied.updatedScoreCount).toBe(1);
    expect(applied.skippedChunkIds).toEqual([]);
    expect(applied.actions).toEqual([
      expect.objectContaining({
        chunkId: "p14-remove",
        keepChunkId: "p14-keep",
        archived: true,
      }),
    ]);

    const removedChunk = manager.getMemory("p14-remove");
    expect(removedChunk?.metadata).toMatchObject({
      memoryTree: {
        governance: {
          archived: true,
          archivedByReportId: report.id,
          archiveReason: "dedup_preview_remove",
          keepChunkId: "p14-keep",
        },
      },
    });

    const scores = manager.listMemoryTreeScores(10, {
      targetType: "chunk",
    });
    const removedScore = scores.find((item) => item.targetId === "p14-remove");
    const keeperScore = scores.find((item) => item.targetId === "p14-keep");
    expect(removedScore?.scoreTotal).toBe(0.05);
    expect(removedScore?.rationale).toMatchObject({
      governance: expect.objectContaining({
        archivedByReportId: report.id,
        keepChunkId: "p14-keep",
        nextScoreTotal: 0.05,
      }),
    });
    expect(keeperScore?.scoreTotal).toBe(0.85);
  });

  it("previews and applies P15 external Obsidian ingest through report review/apply", async () => {
    const obsidianDir = path.join(rootDir, "obsidian-vault");
    const notePath = path.join(obsidianDir, "Projects", "viewer-audit.md");
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, "# Viewer Audit\n\nObsidian ingest should become searchable memory.\n", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const preview = await manager.previewConfiguredExternalIngest({
      configuredSources: [
        {
          label: "Obsidian Vault",
          sourceClass: "curated",
          scope: "private",
          rootPath: obsidianDir,
          fileExtensions: [".md"],
        },
      ],
    });
    expect(preview).toMatchObject({
      adapter: "obsidian_markdown_directory_v1",
      sourceId: "configured:obsidian-vault:1",
      totalFiles: 1,
      eligibleFiles: 1,
      skippedFiles: 0,
    });

    const report = manager.persistMemoryTreeExternalIngestReport(preview, {
      createdBy: "test",
    });
    expect(report.reportType).toBe("external_ingest_preview");
    expect(report.summary).toMatchObject({
      sourceId: "configured:obsidian-vault:1",
      estimatedChunks: expect.any(Number),
    });

    const reviewed = manager.reviewMemoryTreeReport(report.id, "approved", {
      reviewedBy: "tester",
      note: "ready to ingest obsidian markdown",
    });
    expect(reviewed.report.status).toBe("approved");

    const applied = await manager.applyMemoryTreeReport(report.id, {
      appliedBy: "tester",
      note: "import obsidian markdown",
    });
    expect(applied.report.status).toBe("applied");
    expect(applied.updatedChunkCount).toBeGreaterThan(0);
    expect(applied.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "external_ingest",
        sourcePath: notePath,
        skipped: false,
      }),
    ]));

    const importedChunks = manager.getMemoriesBySource(notePath, 20);
    expect(importedChunks.length).toBeGreaterThan(0);
    expect(importedChunks[0]?.metadata).toMatchObject({
      memoryTree: {
        externalSourceId: "configured:obsidian-vault:1",
        externalSourceLabel: "Obsidian Vault",
        ingestedByReportId: report.id,
      },
    });

    const sources = manager.listMemoryTreeSources(20, {
      ids: ["configured:obsidian-vault:1"],
    });
    expect(sources).toEqual([
      expect.objectContaining({
        id: "configured:obsidian-vault:1",
        sourceKind: "configured_external",
        sourcePath: obsidianDir,
      }),
    ]);

    const scores = manager.listMemoryTreeScores(20, {
      sourceId: "configured:obsidian-vault:1",
    });
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every((item) => item.sourceId === "configured:obsidian-vault:1")).toBe(true);
  });

  it("keeps explicit search available while implicit recall still skips greetings", async () => {
    const filePath = path.join(docsDir, "hello.md");
    await fs.writeFile(filePath, "# Greeting\nhello memory marker\n", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
    });

    await manager.indexWorkspace();

    const explicit = await manager.search("hello", { limit: 5 });
    const implicit = await manager.search("hello", { limit: 5, retrievalMode: "implicit" });

    expect(explicit.some((item) => item.sourcePath === filePath)).toBe(true);
    expect(implicit).toHaveLength(0);
  });

  it("uses null embedding provider when embedding is explicitly disabled", async () => {
    manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      embeddingEnabled: false,
      openaiApiKey: "test-openai-key",
      openaiModel: "text-embedding-3-small",
      provider: "openai",
    });

    expect((manager as any).embeddingProvider.modelName).toBe("none");

    await expect(
      manager.search("disabled embedding fallback", { limit: 1, retrievalMode: "explicit" }),
    ).resolves.toEqual([]);
  });

  it("preserves chunk and source visibility after reindex", async () => {
    const chunkFilePath = path.join(docsDir, "chunk-visibility.md");
    const sourceFilePath = path.join(docsDir, "source-visibility.md");
    const longChunkContent = [
      "# Chunk Visibility",
      "chunkvisibilitymarkera ".repeat(8),
      "chunkvisibilitymarkerb ".repeat(8),
      "chunkvisibilitymarkerc ".repeat(8),
    ].join("\n\n");
    await fs.writeFile(chunkFilePath, longChunkContent, "utf-8");
    await fs.writeFile(sourceFilePath, "# Source Visibility\nsourcevisibilitymarker\n", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      indexerOptions: {
        chunkOptions: { maxLength: 80, overlap: 0 },
      },
    });

    await manager.indexWorkspace();

    const initialChunkRecords = (manager as any).store.getChunksBySource(chunkFilePath, 10);
    expect(initialChunkRecords.length).toBeGreaterThan(1);
    const chunk = initialChunkRecords[0];
    expect(chunk?.id).toBeTruthy();
    expect(manager.promoteMemoryChunk(chunk.id)?.visibility).toBe("shared");

    const sourcePromotion = manager.promoteMemorySource(sourceFilePath);
    expect(sourcePromotion.count).toBeGreaterThan(0);

    await manager.indexWorkspace();

    const reindexedChunk = manager.getMemory(chunk.id);
    const reindexedSource = (manager as any).store.getChunksBySource(sourceFilePath, 10);

    expect(reindexedChunk?.visibility).toBe("shared");
    expect(reindexedSource.every((item: { visibility?: string }) => item.visibility === "shared")).toBe(true);
  });

  it("ignores configured directories by path segment instead of substring", async () => {
    const ignoredDir = path.join(docsDir, "node_modules");
    const safeDir = path.join(docsDir, "project-node_modules-copy");
    const ignoredFile = path.join(ignoredDir, "ignore.md");
    const safeFile = path.join(safeDir, "keep.md");
    await fs.mkdir(ignoredDir, { recursive: true });
    await fs.mkdir(safeDir, { recursive: true });
    await fs.writeFile(ignoredFile, "ignored-marker", "utf-8");
    await fs.writeFile(safeFile, "keep-marker", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      indexerOptions: {
        ignorePatterns: ["node_modules"],
      },
    });

    await manager.indexWorkspace();

    const recent = manager.getRecent(20);

    expect(recent.some((item) => item.sourcePath === safeFile)).toBe(true);
    expect(recent.some((item) => item.sourcePath === ignoredFile)).toBe(false);
  });

  it("limits idle summary generation to one batch per cycle", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      summaryEnabled: true,
      summaryApiKey: "test-summary-key",
      summaryModel: "test-summary-model",
      summaryBatchSize: 2,
      summaryMinContentLength: 1,
    });

    const store = (manager as any).store;
    for (let index = 0; index < 5; index += 1) {
      store.upsertChunk({
        id: `summary-chunk-${index}`,
        sourcePath: path.join(docsDir, `summary-${index}.md`),
        sourceType: "file",
        memoryType: "other",
        content: `summary-source-${index}`,
      });
    }

    const summarySpy = vi.spyOn(manager as any, "callLLMForSummary").mockImplementation(async (...args: unknown[]) => {
      return `summary:${String(args[0] ?? "")}`;
    });

    vi.useFakeTimers();
    try {
      const runPromise = manager.runIdleSummaries();
      await vi.runAllTimersAsync();
      const generated = await runPromise;

      expect(generated).toBe(2);
      expect(summarySpy).toHaveBeenCalledTimes(2);
      expect(store.getChunksNeedingSummary(1, 10)).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs idle summary batches with bounded concurrency", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      summaryEnabled: true,
      summaryApiKey: "test-summary-key",
      summaryModel: "test-summary-model",
      summaryBatchSize: 4,
      summaryMinContentLength: 1,
    });

    const store = (manager as any).store;
    for (let index = 0; index < 4; index += 1) {
      store.upsertChunk({
        id: `summary-concurrency-${index}`,
        sourcePath: path.join(docsDir, `summary-concurrency-${index}.md`),
        sourceType: "file",
        memoryType: "other",
        content: `summary-concurrency-source-${index}`,
      });
    }

    const blockers: Array<{ promise: Promise<void>; resolve: () => void }> = [];
    for (let index = 0; index < 2; index += 1) {
      let resolve!: () => void;
      const promise = new Promise<void>((innerResolve) => {
        resolve = innerResolve;
      });
      blockers.push({ promise, resolve });
    }

    let activeCalls = 0;
    let maxActiveCalls = 0;
    let blockerIndex = 0;
    const summarySpy = vi.spyOn(manager as any, "callLLMForSummary").mockImplementation(async (...args: unknown[]) => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      try {
        const blocker = blockers[blockerIndex++];
        if (blocker) {
          await blocker.promise;
        }
        return `summary:${String(args[0] ?? "")}`;
      } finally {
        activeCalls -= 1;
      }
    });

    const runPromise = manager.runIdleSummaries();
    await vi.waitFor(() => {
      expect(summarySpy).toHaveBeenCalledTimes(2);
    });
    expect(maxActiveCalls).toBe(2);

    for (const blocker of blockers) {
      blocker.resolve();
    }

    const generated = await runPromise;
    expect(generated).toBe(4);
    expect(store.getChunksNeedingSummary(1, 10)).toHaveLength(0);
  });

  it("excludes session memories from context injection by default", async () => {
    const stateMemoryPath = path.join(stateDir, "MEMORY.md");
    const sessionFilePath = path.join(sessionsDir, "session-001.md");

    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
    });

    const store = (manager as any).store;
    store.upsertChunk({
      id: "core-memory-1",
      sourcePath: stateMemoryPath,
      sourceType: "file",
      memoryType: "core",
      content: "Project decision marker",
    });
    store.upsertChunk({
      id: "session-memory-1",
      sourcePath: sessionFilePath,
      sourceType: "session",
      memoryType: "session",
      content: "Just finished restarting service",
    });

    const injected = manager.getContextInjectionMemories({ limit: 10 });
    const injectedWithSession = manager.getContextInjectionMemories({ limit: 10, includeSession: true });

    expect(injected.some((item) => item.sourcePath === stateMemoryPath)).toBe(true);
    expect(injected.some((item) => item.sourcePath === sessionFilePath)).toBe(false);
    expect(injectedWithSession.some((item) => item.sourcePath === sessionFilePath)).toBe(true);
  });

  it("detects recent duplicate tool actions from successful tasks", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const conversationId = "conv-dedup-1";
    manager.startTaskCapture({
      conversationId,
      sessionKey: conversationId,
      source: "chat",
      objective: "restart gateway after config change",
    });
    manager.recordTaskToolCall(conversationId, {
      toolName: "service_restart",
      success: true,
      actionKey: "service_restart:gateway",
    });
    manager.completeTaskCapture({
      conversationId,
      success: true,
      durationMs: 1200,
      messages: [],
    });

    const duplicated = manager.findRecentDuplicateToolAction({
      toolName: "service_restart",
      actionKey: "service_restart:gateway",
      withinMinutes: 20,
    });

    const different = manager.findRecentDuplicateToolAction({
      toolName: "service_restart",
      actionKey: "service_restart:other",
      withinMinutes: 20,
    });

    expect(duplicated?.conversationId).toBe(conversationId);
    expect(different).toBeNull();
  });

  it("builds recent task summaries without requiring full task hydration", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const store = (manager as any).store;
    store.createTask({
      id: "task-summary-1",
      conversationId: "conv-summary-1",
      sessionKey: "session-summary-1",
      source: "chat",
      status: "success",
      title: "Refresh memory usage dashboard",
      objective: "verify recent task summary projection",
      summary: "dashboard refreshed with memory usage overview",
      reflection: "heavy reflection body should not matter for summary reads",
      outcome: "done",
      toolCalls: [
        { toolName: "memory_search", success: true, durationMs: 80 },
        { toolName: "experience_usage_stats", success: true, durationMs: 40 },
      ],
      artifactPaths: ["reports/memory-usage.md"],
      startedAt: "2026-03-21T10:00:00.000Z",
      finishedAt: "2026-03-21T10:00:30.000Z",
      createdAt: "2026-03-21T10:00:00.000Z",
      updatedAt: "2026-03-21T10:00:30.000Z",
    });

    const summaries = manager.getRecentTaskSummaries(5);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      taskId: "task-summary-1",
      title: "Refresh memory usage dashboard",
      summary: "dashboard refreshed with memory usage overview",
      status: "success",
      source: "chat",
      toolNames: ["memory_search", "experience_usage_stats"],
      artifactPaths: ["reports/memory-usage.md"],
    });
  });

  it("returns task activity facts in task detail", () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const taskId = manager.startTaskCapture({
      conversationId: "conv-activity-1",
      sessionKey: "session-activity-1",
      source: "chat",
      objective: "record factual execution activity",
    });
    expect(taskId).toBeTruthy();

    manager.linkTaskMemories("conv-activity-1", ["chunk-activity-1"], "used");
    manager.recordTaskToolCall("conv-activity-1", {
      toolName: "apply_patch",
      success: true,
      durationMs: 90,
      artifactPaths: ["packages/belldandy-memory/src/task-processor.ts"],
    });
    manager.completeTaskCapture({
      conversationId: "conv-activity-1",
      success: true,
      durationMs: 1800,
    });

    const detail = manager.getTaskDetail(taskId!);

    expect(detail?.activities.map((item) => item.kind)).toEqual([
      "task_started",
      "memory_recalled",
      "tool_called",
      "file_changed",
      "task_completed",
    ]);
    expect(detail?.workRecap?.headline).toContain("任务已完成");
    expect(detail?.workRecap?.confirmedFacts).toEqual(expect.arrayContaining([
      "已关联 1 条召回记忆",
      "已变更文件：packages/belldandy-memory/src/task-processor.ts",
    ]));
    expect(detail?.resumeContext?.currentStopPoint).toBe("任务已完成。");
    expect(detail?.resumeContext?.nextStep).toBeUndefined();
    expect(detail?.activities.every((item) => !("nextStep" in item))).toBe(true);
    expect(detail?.activities.find((item) => item.kind === "file_changed")?.files).toEqual([
      "packages/belldandy-memory/src/task-processor.ts",
    ]);
  });

  it("builds recent_work shortcuts with recap and recent activity", () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const store = (manager as any).store;
    seedTaskShortcut(store, {
      taskId: "task-shortcut-recent-1",
      conversationId: "conv-shortcut-recent-1",
      status: "partial",
      objective: "补 recent_work 检索短路径",
      summary: "已开始补 recent_work 与 resume_context 的 manager 检索接口。",
      updatedAt: "2026-04-17T09:10:00.000Z",
      activities: [
        createShortcutActivity({
          id: "activity-shortcut-recent-1",
          taskId: "task-shortcut-recent-1",
          conversationId: "conv-shortcut-recent-1",
          sequence: 0,
          kind: "tool_called",
          state: "completed",
          happenedAt: "2026-04-17T09:05:00.000Z",
          title: "已执行工具 apply_patch",
        }),
        createShortcutActivity({
          id: "activity-shortcut-recent-2",
          taskId: "task-shortcut-recent-1",
          conversationId: "conv-shortcut-recent-1",
          sequence: 1,
          kind: "file_changed",
          state: "completed",
          happenedAt: "2026-04-17T09:06:00.000Z",
          title: "已变更文件：packages/belldandy-memory/src/manager.ts",
          files: ["packages/belldandy-memory/src/manager.ts"],
        }),
      ],
    });

    const items = manager.getRecentWork({ limit: 3, query: "recent_work" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      taskId: "task-shortcut-recent-1",
      status: "partial",
    });
    expect(items[0].workRecap?.headline).toContain("当前停在");
    expect(items[0].recentActivityTitles).toEqual(expect.arrayContaining([
      "已变更文件：packages/belldandy-memory/src/manager.ts",
      "已执行工具 apply_patch",
    ]));
    expect(items[0].matchReasons).toEqual(expect.arrayContaining(["标题/目标", "摘要/复盘"]));
  });

  it("prefers resumable partial task when reading resume_context", () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const store = (manager as any).store;
    seedTaskShortcut(store, {
      taskId: "task-resume-old-success",
      conversationId: "conv-resume-old-success",
      status: "success",
      objective: "完成旧的 viewer task 详情优化",
      summary: "旧任务已完成。",
      updatedAt: "2026-04-16T08:00:00.000Z",
      activities: [
        createShortcutActivity({
          id: "activity-resume-old-success",
          taskId: "task-resume-old-success",
          conversationId: "conv-resume-old-success",
          sequence: 0,
          kind: "task_completed",
          state: "completed",
          happenedAt: "2026-04-16T08:00:00.000Z",
          title: "任务已完成。",
        }),
      ],
    });
    seedTaskShortcut(store, {
      taskId: "task-resume-current",
      conversationId: "conv-resume-current",
      status: "partial",
      objective: "继续补 recent_work / resume_context RPC",
      summary: "已停在 RPC 接线前，待继续补 memory.recent_work 与 memory.resume_context。",
      updatedAt: "2026-04-17T10:00:00.000Z",
      activities: [
        createShortcutActivity({
          id: "activity-resume-current-1",
          taskId: "task-resume-current",
          conversationId: "conv-resume-current",
          sequence: 0,
          kind: "tool_called",
          state: "completed",
          happenedAt: "2026-04-17T09:55:00.000Z",
          title: "已执行工具 apply_patch",
        }),
      ],
    });

    const item = manager.getResumeContext({ query: "resume_context RPC" });

    expect(item?.taskId).toBe("task-resume-current");
    expect(item?.resumeContext?.currentStopPoint).toContain("已停在 RPC 接线前");
    expect(item?.resumeContext?.nextStep).toBeTruthy();
  });

  it("finds similar past work from task recap and activity fields", () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const store = (manager as any).store;
    seedTaskShortcut(store, {
      taskId: "task-similar-viewer-1",
      conversationId: "conv-similar-viewer-1",
      status: "success",
      objective: "修复 memory viewer task detail 渲染",
      summary: "已补 task detail 的 Work Recap 与 Resume Context 展示。",
      updatedAt: "2026-04-16T11:00:00.000Z",
      activities: [
        createShortcutActivity({
          id: "activity-similar-viewer-1",
          taskId: "task-similar-viewer-1",
          conversationId: "conv-similar-viewer-1",
          sequence: 0,
          kind: "file_changed",
          state: "completed",
          happenedAt: "2026-04-16T10:58:00.000Z",
          title: "已变更文件：apps/web/public/app/features/memory-detail-render.js",
          files: ["apps/web/public/app/features/memory-detail-render.js"],
        }),
      ],
    });
    seedTaskShortcut(store, {
      taskId: "task-similar-other-1",
      conversationId: "conv-similar-other-1",
      status: "success",
      objective: "重启邮件服务",
      summary: "与 viewer 无关。",
      updatedAt: "2026-04-16T09:00:00.000Z",
      activities: [],
    });

    const items = manager.findSimilarPastWork({
      query: "memory viewer task detail",
      limit: 3,
    });

    expect(items).toHaveLength(1);
    expect(items[0].taskId).toBe("task-similar-viewer-1");
    expect(items[0].matchReasons).toEqual(expect.arrayContaining(["标题/目标", "摘要/复盘", "最近活动"]));
  });

  it("returns durable memory guidance with accepted and rejected policy summary", () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
    });

    const guidance = manager.getDurableMemoryGuidance();

    expect(guidance).toMatchObject({
      policyVersion: "week9-v1",
      acceptedCandidateTypes: ["user", "feedback", "project", "reference"],
    });
    expect(guidance.rejectedContentTypes.map((item) => item.code)).toEqual(expect.arrayContaining([
      "code_pattern",
      "file_path",
      "git_history",
      "debug_recipe",
      "policy_rule",
    ]));
  });

  it("filters code-like and path-like extraction candidates before writing durable memory", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
    });

    const extractionSpy = vi.spyOn(manager as any, "callLLMForExtraction").mockResolvedValue([
      {
        type: "事实",
        category: "fact",
        candidateType: "project",
        content: "当前项目的主目标是在本周收口 memory runtime 的 doctor 与 budget。",
      },
      {
        type: "经验",
        category: "experience",
        candidateType: "feedback",
        content: "执行 `pnpm test` 后如果失败就继续重跑。",
      },
      {
        type: "事实",
        category: "fact",
        candidateType: "project",
        content: "packages/belldandy-core/src/server.ts 需要继续拆分。",
      },
    ]);

    const result = await manager.extractMemoriesFromConversation("conv-memory-policy", [
      { role: "user", content: "请沉淀这轮对话里长期有效的信息。" },
      { role: "assistant", content: "本周要把 memory runtime 的 doctor 与 budget 收口。" },
    ]);

    expect(result).toMatchObject({
      count: 1,
      acceptedCandidateTypes: ["project"],
      rejectedCount: 2,
    });
    expect(result.rejectedReasons).toEqual(expect.arrayContaining(["code_pattern", "file_path"]));
    expect(result.summary).toContain("accepted=1");
    expect(result.summary).toContain("rejected=2");

    extractionSpy.mockRestore();
  });

  it("returns policy_filtered skip reason when all durable candidates are rejected by policy", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
    });

    const extractionSpy = vi.spyOn(manager as any, "callLLMForExtraction").mockResolvedValue([
      {
        type: "经验",
        category: "experience",
        candidateType: "feedback",
        content: "执行 `pnpm test` 失败后继续重跑。",
      },
      {
        type: "事实",
        category: "fact",
        candidateType: "project",
        content: "packages/belldandy-core/src/server.ts 仍需继续拆分。",
      },
    ]);

    const result = await manager.extractMemoriesFromConversation("conv-memory-policy-filtered", [
      { role: "user", content: "请只保留长期有效的事实。" },
      { role: "assistant", content: "短期命令和文件路径不应该进入 durable memory。" },
    ]);

    expect(result).toMatchObject({
      count: 0,
      rejectedCount: 2,
      skipReason: "policy_filtered",
    });
    expect(result.rejectedReasons).toEqual(expect.arrayContaining(["code_pattern", "file_path"]));

    extractionSpy.mockRestore();
  });

  it("parses durable extraction JSON wrapped by a leading think block", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: `<think>
先判断哪些内容适合 durable memory。
</think>
[{"type":"偏好","category":"preference","candidateType":"user","content":"用户默认希望使用简体中文交流。","reason":"长期沟通偏好"}]`,
            },
          },
        ],
      }),
    } as Response);

    const result = await (manager as any).callLLMForExtraction([
      { role: "user", content: "请沉淀这轮对话中的长期偏好。" },
      { role: "assistant", content: "用户默认希望使用简体中文交流。" },
    ]);

    expect(result).toEqual([
      {
        type: "偏好",
        category: "preference",
        candidateType: "user",
        content: "用户默认希望使用简体中文交流。",
        reason: "长期沟通偏好",
      },
    ]);

    fetchSpy.mockRestore();
  });

  it("adds reasoning_split for MiniMax evolution requests", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "MiniMax-M2.5",
      evolutionBaseUrl: "https://api.minimaxi.com/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "[]",
            },
          },
        ],
      }),
    } as Response);

    await (manager as any).callLLMForExtraction("请沉淀这轮对话中的长期信息。");

    const firstCall = fetchSpy.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    const request = firstCall?.[1];
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<string, unknown>;
    expect(body.reasoning_split).toBe(true);

    fetchSpy.mockRestore();
  });

  it("keeps generic OpenAI-compatible evolution requests unchanged for non-MiniMax providers", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "gpt-4o-mini",
      evolutionBaseUrl: "https://api.openai.com/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "[]",
            },
          },
        ],
      }),
    } as Response);

    await (manager as any).callLLMForExtraction("请沉淀这轮对话中的长期信息。");

    const firstCall = fetchSpy.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    const request = firstCall?.[1];
    const body = JSON.parse(String(request?.body ?? "{}")) as Record<string, unknown>;
    expect(body).not.toHaveProperty("reasoning_split");

    fetchSpy.mockRestore();
  });

  it("aggregates embedding cache and API logs into a single summary per sync run", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      embeddingBatchSize: 2,
    });

    const store = (manager as any).store;
    const signature = (manager as any).computeEmbeddingSignature(1);
    (manager as any).store.prepareVectorStore(1);
    (manager as any).ensureEmbeddingSignature(signature);

    const contents = [
      "cached memory chunk one",
      "cached memory chunk two",
      "uncached memory chunk three",
    ];

    contents.forEach((content, index) => {
      store.upsertChunk({
        id: `chunk-log-${index + 1}`,
        sourcePath: path.join(docsDir, `chunk-${index + 1}.md`),
        sourceType: "file",
        memoryType: "working",
        content,
      });
    });

    const cachedContents = contents.slice(0, 2);
    for (const content of cachedContents) {
      const normalized = content.replace(/\n+/g, " ").slice(0, 8000);
      const hash = createHash("sha256").update(signature).update("\n").update(normalized).digest("hex");
      store.cacheEmbedding(hash, [0.1], "test-memory-manager");
    }

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await (manager as any).processPendingEmbeddings();

    const summaryLogs = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("Embedding sync processed"));
    const legacyLogs = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("Embedding cache:") || line.includes("chunks via API"));

    expect(summaryLogs).toHaveLength(1);
    expect(summaryLogs[0]).toContain("cacheHits=2");
    expect(summaryLogs[0]).toContain("cacheMisses=1");
    expect(summaryLogs[0]).toContain("apiRequests=1");
    expect(summaryLogs[0]).toContain("apiChunks=1");
    expect(legacyLogs).toHaveLength(0);
  });
});

function seedTaskShortcut(store: any, input: {
  taskId: string;
  conversationId: string;
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

function createShortcutActivity(input: {
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

function createManager(options: ConstructorParameters<typeof MemoryManager>[0]): MemoryManager {
  const manager = new MemoryManager(options);
  (manager as any).embeddingProvider = {
    modelName: "test-memory-manager",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  return manager;
}
