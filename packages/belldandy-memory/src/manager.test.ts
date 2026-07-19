import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { MemoryManager } from "./manager.js";
import { clearMemoryTreeJobInflightForTest } from "./memory-tree-job-control.js";
import {
  recordMemoryTreeJobLedgerFailure,
  recordMemoryTreeJobLedgerStart,
} from "./memory-tree-job-ledger.js";
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
    await manager?.close();
    clearMemoryTreeJobInflightForTest();
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

  it("shares one full scan between lazy and manual indexing callers", async () => {
    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
    });

    let releaseScan!: () => void;
    const scanGate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    const indexSpy = vi.spyOn((manager as any).indexer, "indexDirectory")
      .mockImplementation(async () => await scanGate);
    const first = manager.startLazyIndexing();
    const second = manager.indexWorkspace();
    const third = manager.startLazyIndexing();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(indexSpy).toHaveBeenCalledTimes(1);

    releaseScan();
    await Promise.all([first, second, third]);

    await manager.indexWorkspace();
    expect(indexSpy).toHaveBeenCalledTimes(2);
  });

  it("continues a byte-limited full scan from the deferred file on later generations", async () => {
    const files = ["a.md", "b.md", "c.md"].map((name) => path.join(docsDir, name));
    for (const [index, sourcePath] of files.entries()) {
      await fs.writeFile(sourcePath, `# ${index}\n${String(index).repeat(40)}`, "utf-8");
    }
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      indexerOptions: {
        maxFileBytes: 128,
        maxRunBytes: 70,
      },
    });

    const indexedCount = () => files.filter((sourcePath) => (
      (manager as any).store.getChunksBySource(sourcePath, 10).length > 0
    )).length;

    await manager.indexWorkspace();
    expect(indexedCount()).toBe(1);

    await manager.indexWorkspace();
    expect(indexedCount()).toBe(2);

    await manager.indexWorkspace();
    expect(indexedCount()).toBe(3);
  });

  it("allows fire-and-forget close to drain in-flight lazy indexing before closing the store", async () => {
    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
    });

    vi.spyOn((manager as any).indexer, "indexDirectory").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      manager!.upsertMemoryChunk({
        id: "close-lazy-indexing",
        sourcePath: path.join(sessionsDir, "close-lazy-indexing.md"),
        sourceType: "file",
        memoryType: "other",
        content: "close drains lazy indexing before store shutdown",
      });
    });

    const lazy = manager.startLazyIndexing();
    void manager.close();

    await expect(lazy).resolves.toBeUndefined();
  });

  it("releases every paused background waiter on resume", async () => {
    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
    });
    manager.pause();

    const first = (manager as any).waitIfPaused() as Promise<void>;
    const second = (manager as any).waitIfPaused() as Promise<void>;
    const settled: string[] = [];
    void first.then(() => settled.push("first"));
    void second.then(() => settled.push("second"));

    manager.resume();
    await Promise.all([first, second]);

    expect(settled.sort()).toEqual(["first", "second"]);
  });

  it("releases every paused background waiter while closing", async () => {
    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
    });
    manager.pause();

    const first = (manager as any).waitIfPaused() as Promise<void>;
    const second = (manager as any).waitIfPaused() as Promise<void>;

    await Promise.all([first, second, manager.close()]);
  });

  it("skips missing optional additional roots without warning noise", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      manager = createManager({
        workspaceRoot: sessionsDir,
        stateDir,
        additionalRoots: [path.join(stateDir, "dreams"), path.join(stateDir, "team-memory", "memory")],
      });

      await manager.indexWorkspace();

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("falls back to keyword-only embedding without stderr warning when api key is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      manager = createManager({
        workspaceRoot: sessionsDir,
        stateDir,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
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

  it("previews and applies safe memory vacuum with backup and page/file observability", async () => {
    manager = createManager({
      workspaceRoot: sessionsDir,
      stateDir,
    });

    for (let index = 0; index < 24; index += 1) {
      manager.upsertMemoryChunk({
        id: `vacuum-${index}`,
        sourcePath: path.join(docsDir, `vacuum-${index}.md`),
        sourceType: "file",
        memoryType: "other",
        content: `vacuum payload ${index}\n${"x".repeat(16384)}`,
      });
    }

    const store = (manager as any).store as {
      deleteBySource: (sourcePath: string) => number;
      getDbPath: () => string;
    };
    for (let index = 0; index < 12; index += 1) {
      store.deleteBySource(path.join(docsDir, `vacuum-${index}.md`));
    }

    const preview = manager.previewMemoryVacuum();
    expect(preview).toMatchObject({
      mode: "dry_run",
      requiresConfirmed: true,
      recommended: true,
      observability: expect.objectContaining({
        chunkCount: 12,
      }),
    });
    expect(preview.observability.freelistCount).toBeGreaterThan(0);
    expect(preview.observability.pageSize).toBeGreaterThan(0);
    expect(preview.observability.dbFileBytes).toBeGreaterThan(0);
    expect(preview.observability.estimatedReclaimableBytes).toBeGreaterThan(0);

    const backupRootDir = path.join(stateDir, "artifacts", "memory-vacuum-backups");
    await fs.mkdir(backupRootDir, { recursive: true });
    const result = manager.applyMemoryVacuum({
      backupRootDir,
      runId: "vacuum-test",
    });

    expect(result.mode).toBe("apply");
    expect(result.backupPath).toContain("memory-vacuum-backups");
    expect(await fs.stat(result.backupPath)).toBeTruthy();
    expect(result.before.freelistCount).toBeGreaterThan(0);
    expect(result.after.freelistCount).toBe(0);
    expect(result.after.pageCount).toBeLessThanOrEqual(result.before.pageCount);
    expect(result.after.totalFileBytes).toBeLessThanOrEqual(result.before.totalFileBytes);
    expect(result.changed).toBe(true);
    expect(store.getDbPath()).toContain("memory.sqlite");
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

    const jobReport = manager.getMemoryTreeJobReport({
      kinds: ["topic", "profile", "global"],
    });
    expect(jobReport.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "source_rebuild:source",
        status: "completed",
        lastSuccessAt: expect.any(String),
        triggerSource: "memory.tree.source.rebuild",
      }),
      expect.objectContaining({
        jobKey: "score_rebuild:chunk_scores",
        status: "completed",
        lastSuccessAt: expect.any(String),
        triggerSource: "memory.tree.score.rebuild",
      }),
    ]));
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
              expect.objectContaining({ id: "p16-low-score", sourceClass: "raw" }),
              expect.objectContaining({ id: "p16-high-score", sourceClass: "curated" }),
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
    expect(dedupRecord.summary).toMatchObject({
      governance: expect.objectContaining({
        headline: expect.stringContaining("Memory dedup"),
      }),
    });
    expect(dedupRecord.details).toMatchObject({
      governance: expect.objectContaining({
        groupCount: expect.any(Number),
        topSuggestedGroups: expect.any(Array),
      }),
    });

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
      totalEdges: 6,
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
        summaryVersion: "p20-topic-node-v1",
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
    expect(searchResults[0]?.edges.filter((item) => item.childType === "chunk").map((item) => item.childId)).toEqual([
      "p13-topic-high",
      "p13-topic-low",
    ]);
    expect(searchResults[0]?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("viewer-audit-outline.md"),
      }),
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("viewer-audit-summary.md"),
      }),
    ]));

    const detail = manager.getMemoryTreeNodeDetail(searchResults[0]!.node.id, { chunkLimit: 5 });
    expect(detail).toBeTruthy();
    expect(detail?.chunks.map((item) => item.id)).toEqual([
      "p13-topic-high",
      "p13-topic-low",
    ]);
    expect(detail?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKind: "workspace_file",
      }),
    ]));
  });

  it("stabilizes topic nodes from source stems when explicit topic is missing", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "p20-topic-low",
      sourcePath: path.join(docsDir, "viewer-audit-outline.md"),
      sourceType: "file",
      memoryType: "other",
      content: "viewer audit baseline notes",
    });
    manager.upsertMemoryChunk({
      id: "p20-topic-high",
      sourcePath: path.join(docsDir, "viewer-audit-summary.md"),
      sourceType: "file",
      memoryType: "other",
      content: "viewer audit final checklist",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p20-topic-low",
        targetType: "chunk",
        targetId: "p20-topic-low",
        scoreTotal: 0.2,
        sourceWeightScore: 0.1,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
      },
      {
        id: "score:v1_rule_only:chunk:p20-topic-high",
        targetType: "chunk",
        targetId: "p20-topic-high",
        scoreTotal: 0.9,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
    ]);
    store.createTask({
      id: "p20-topic-task",
      conversationId: "viewer-audit-conv",
      sessionKey: "viewer-audit-conv",
      agentId: "coder",
      source: "chat",
      status: "success",
      title: "Finalize viewer audit rollout",
      summary: "Deliver the viewer audit checklist.",
      startedAt: "2026-05-20T16:00:00.000Z",
      finishedAt: "2026-05-20T16:20:00.000Z",
      createdAt: "2026-05-20T16:00:00.000Z",
      updatedAt: "2026-05-20T16:20:00.000Z",
    });
    store.linkTaskMemory("p20-topic-task", "p20-topic-low", "used");
    store.linkTaskMemory("p20-topic-task", "p20-topic-high", "generated");

    expect(manager.rebuildMemoryTreeNodes({ limit: 20, kind: "topic" })).toMatchObject({
      kind: "topic",
      totalNodes: 1,
      totalEdges: 4,
    });

    const searchResults = manager.searchMemoryTreeNodes("viewer audit", {
      limit: 5,
      chunkLimitPerNode: 5,
      filter: { kind: "topic" },
    });
    expect(searchResults[0]).toMatchObject({
      node: expect.objectContaining({
        kind: "topic",
        topicKey: "viewer-audit",
        summaryVersion: "p20-topic-node-v1",
        metadata: expect.objectContaining({
          topic: "viewer-audit",
          reasons: expect.arrayContaining(["source_stem"]),
          treePipeline: expect.objectContaining({
            pipelineVersion: "p21-tree-canonical-v1",
            canonical: expect.objectContaining({
              canonicalNodeKey: "tree:topic:private:coder:viewer-audit",
              nodeFamilyKey: "tree:topic:private:-:viewer-audit",
            }),
            ingest: expect.objectContaining({
              stage: "ingested",
              evidenceChunkCount: 2,
            }),
            lifecycle: expect.objectContaining({
              state: "buffered",
              stable: false,
            }),
          }),
        }),
      }),
    });
    expect(searchResults[0]?.chunks.map((item) => item.id)).toEqual([
      "p20-topic-high",
      "p20-topic-low",
    ]);
    expect(searchResults[0]?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: expect.stringContaining("viewer-audit-outline.md"),
      }),
      expect.objectContaining({
        sourcePath: expect.stringContaining("viewer-audit-summary.md"),
      }),
    ]));
  });

  it("merges topic alias variants into one canonical topic node", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "p20-alias-high",
      sourcePath: path.join(docsDir, "viewer-audit-master.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer audit",
      content: "viewer audit canonical summary",
    });
    manager.upsertMemoryChunk({
      id: "p20-alias-mid",
      sourcePath: path.join(docsDir, "viewer-audit-detail.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer_audit",
      content: "viewer audit detail notes",
    });
    manager.upsertMemoryChunk({
      id: "p20-alias-low",
      sourcePath: path.join(docsDir, "viewer-audit-checklist.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer-audit-checklist",
      content: "viewer audit checklist draft",
    });

    const store = (manager as any).store as {
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:p20-alias-high",
        targetType: "chunk",
        targetId: "p20-alias-high",
        scoreTotal: 0.92,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
      {
        id: "score:v1_rule_only:chunk:p20-alias-mid",
        targetType: "chunk",
        targetId: "p20-alias-mid",
        scoreTotal: 0.65,
        sourceWeightScore: 0.45,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
      },
      {
        id: "score:v1_rule_only:chunk:p20-alias-low",
        targetType: "chunk",
        targetId: "p20-alias-low",
        scoreTotal: 0.33,
        sourceWeightScore: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
      },
    ]);

    expect(manager.rebuildMemoryTreeNodes({ limit: 20, kind: "topic" })).toMatchObject({
      kind: "topic",
      totalNodes: 1,
      totalEdges: 6,
    });

    const searchResults = manager.searchMemoryTreeNodes("viewer audit", {
      limit: 5,
      chunkLimitPerNode: 5,
      filter: { kind: "topic" },
    });
    expect(searchResults[0]).toMatchObject({
      node: expect.objectContaining({
        kind: "topic",
        topicKey: "viewer-audit",
        metadata: expect.objectContaining({
          topic: "viewer-audit-checklist",
          aliasKeys: expect.arrayContaining(["viewer-audit", "viewer-audit-checklist"]),
          mergedSourceKeys: expect.arrayContaining(["viewer-audit", "viewer-audit-checklist"]),
          treePipeline: expect.objectContaining({
            pipelineVersion: "p21-tree-canonical-v1",
            canonical: expect.objectContaining({
              canonicalNodeKey: "tree:topic:private:-:viewer-audit",
              nodeFamilyKey: "tree:topic:private:-:viewer-audit",
              sourceCanonicalKeys: expect.arrayContaining([
                expect.stringContaining("viewer-audit-master.md"),
                expect.stringContaining("viewer-audit-detail.md"),
                expect.stringContaining("viewer-audit-checklist.md"),
              ]),
              sourceFamilyKeys: expect.arrayContaining([
                expect.stringContaining("viewer-audit-master.md"),
                expect.stringContaining("viewer-audit-detail.md"),
                expect.stringContaining("viewer-audit-checklist.md"),
              ]),
            }),
            ingest: expect.objectContaining({
              stage: "ingested",
              evidenceChunkCount: 3,
              sourceCanonicalCount: 3,
            }),
            lifecycle: expect.objectContaining({
              state: "sealed",
              stable: true,
            }),
          }),
        }),
      }),
    });
    expect(searchResults[0]?.chunks.map((item) => item.id)).toEqual([
      "p20-alias-high",
      "p20-alias-mid",
      "p20-alias-low",
    ]);
    expect(searchResults[0]?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: expect.stringContaining("viewer-audit-master.md"),
      }),
      expect.objectContaining({
        sourcePath: expect.stringContaining("viewer-audit-detail.md"),
      }),
      expect.objectContaining({
        sourcePath: expect.stringContaining("viewer-audit-checklist.md"),
      }),
    ]));
  });

  it("rebuilds R1 conversation/day/project/agent nodes with chunk provenance", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "r1-conv-low",
      sourcePath: path.join(docsDir, "goal-alpha-outline.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal alpha outline and baseline notes",
    });
    manager.upsertMemoryChunk({
      id: "r1-conv-high",
      sourcePath: path.join(docsDir, "goal-alpha-summary.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal alpha final summary and completion checklist",
    });
    manager.upsertMemoryChunk({
      id: "r1-other",
      sourcePath: path.join(docsDir, "goal-beta-review.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal beta review notes",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:r1-conv-low",
        targetType: "chunk",
        targetId: "r1-conv-low",
        scoreTotal: 0.2,
        sourceWeightScore: 0.1,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
        createdAt: "2026-05-20T09:00:00.000Z",
        updatedAt: "2026-05-20T09:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:r1-conv-high",
        targetType: "chunk",
        targetId: "r1-conv-high",
        scoreTotal: 0.9,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
        createdAt: "2026-05-20T10:00:00.000Z",
        updatedAt: "2026-05-20T10:00:00.000Z",
      },
      {
        id: "score:v1_rule_only:chunk:r1-other",
        targetType: "chunk",
        targetId: "r1-other",
        scoreTotal: 0.5,
        sourceWeightScore: 0.3,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
        createdAt: "2026-05-21T11:00:00.000Z",
        updatedAt: "2026-05-21T11:00:00.000Z",
      },
    ]);

    store.createTask({
      id: "r1-task-1",
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
      id: "r1-task-2",
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
      id: "r1-task-3",
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
    store.linkTaskMemory("r1-task-1", "r1-conv-low", "used");
    store.linkTaskMemory("r1-task-2", "r1-conv-high", "generated");
    store.linkTaskMemory("r1-task-3", "r1-other", "used");

    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "conversation" })).toMatchObject({
      kind: "conversation",
      totalNodes: 2,
      totalEdges: 3,
    });
    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "day" })).toMatchObject({
      kind: "day",
      totalNodes: 2,
      totalEdges: 3,
    });
    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "project" })).toMatchObject({
      kind: "project",
      totalNodes: 2,
      totalEdges: 3,
    });
    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "agent" })).toMatchObject({
      kind: "agent",
      totalNodes: 2,
      totalEdges: 3,
    });

    const conversationNode = manager.listMemoryTreeNodes(10, { kind: "conversation" })
      .find((item) => item.topicKey === "goal:alpha:conv");
    expect(conversationNode).toMatchObject({
      kind: "conversation",
      summaryVersion: "p17-conversation-node-v1",
      metadata: expect.objectContaining({
        conversationId: "goal:alpha:conv",
        taskCount: 2,
        linkedChunkCount: 2,
      }),
    });
    const conversationDetail = manager.getMemoryTreeNodeDetail(conversationNode!.id, { chunkLimit: 5 });
    expect(conversationDetail?.chunks.map((item) => item.id)).toEqual([
      "r1-conv-high",
      "r1-conv-low",
    ]);

    const projectResults = manager.searchMemoryTreeNodes("goal-alpha", {
      limit: 5,
      chunkLimitPerNode: 5,
      filter: { kind: "project" },
    });
    const goalAlphaProject = projectResults.find((item) => item.node.topicKey === "goal-alpha");
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
    expect(goalAlphaProject?.chunks.map((item) => item.id)).toEqual([
      "r1-conv-high",
      "r1-conv-low",
    ]);

    const agentResults = manager.searchMemoryTreeNodes("coder", {
      limit: 5,
      chunkLimitPerNode: 5,
      filter: { kind: "agent" },
    });
    expect(agentResults).toHaveLength(1);
    expect(agentResults[0]).toMatchObject({
      node: expect.objectContaining({
        kind: "agent",
        summaryVersion: "p17-agent-node-v1",
        topicKey: "coder",
        metadata: expect.objectContaining({
          agentId: "coder",
          taskCount: 2,
        }),
      }),
    });

    const dayNode = manager.listMemoryTreeNodes(10, { kind: "day" })
      .find((item) => item.topicKey === "2026-05-20");
    expect(dayNode).toMatchObject({
      kind: "day",
      summaryVersion: "p17-day-node-v1",
      metadata: expect.objectContaining({
        day: "2026-05-20",
        taskCount: 2,
        conversationCount: 1,
      }),
    });
  });

  it("uses one task detail batch for each memory tree build branch", () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const store = (manager as any).store;
    store.upsertChunk({
      id: "tree-batch-chunk-a",
      sourcePath: path.join(docsDir, "tree-batch-a.md"),
      sourceType: "file",
      memoryType: "other",
      content: "task memory tree batch projection A",
    });
    store.upsertChunk({
      id: "tree-batch-chunk-b",
      sourcePath: path.join(docsDir, "tree-batch-b.md"),
      sourceType: "file",
      memoryType: "other",
      content: "task memory tree batch projection B",
    });
    for (const [id, conversationId, startedAt] of [
      ["tree-batch-task-a", "tree-batch-conversation", "2026-05-22T09:00:00.000Z"],
      ["tree-batch-task-b", "tree-batch-conversation", "2026-05-22T10:00:00.000Z"],
    ] as const) {
      store.createTask({
        id,
        conversationId,
        sessionKey: conversationId,
        source: "chat",
        status: "partial",
        title: `Task ${id}`,
        summary: `Summary ${id}`,
        startedAt,
        createdAt: startedAt,
        updatedAt: startedAt,
      });
      store.linkTaskMemory(id, id.endsWith("a") ? "tree-batch-chunk-a" : "tree-batch-chunk-b", "used");
    }

    const batchSpy = vi.spyOn(store, "getTaskDetails");

    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "task" }).totalNodes).toBe(2);
    expect(batchSpy).toHaveBeenCalledTimes(1);

    batchSpy.mockClear();
    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "conversation" }).totalNodes).toBe(1);
    expect(batchSpy).toHaveBeenCalledTimes(1);

    batchSpy.mockClear();
    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "profile" }).totalNodes).toBeGreaterThan(0);
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds real profile/global nodes instead of falling back to task nodes", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "p18-profile-core",
      sourcePath: path.join(stateDir, "MEMORY.md"),
      sourceType: "file",
      memoryType: "other",
      category: "decision",
      content: "Always keep diffs minimal and verify rollback steps before risky changes.",
    });
    manager.upsertMemoryChunk({
      id: "p18-profile-derived",
      sourcePath: path.join(stateDir, "sessions", "conv-18.session-memory.json"),
      sourceType: "file",
      memoryType: "session",
      category: "experience",
      content: "goal alpha final summary and reuse checklist for future resumable work.",
    });
    manager.upsertMemoryChunk({
      id: "p18-global-focus",
      sourcePath: path.join(docsDir, "roadmap.md"),
      sourceType: "file",
      memoryType: "other",
      category: "fact",
      content: "workspace focus is goal alpha rollout and goal beta regression guard.",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
    };
    store.createTask({
      id: "p18-task-1",
      conversationId: "goal:alpha:conv",
      sessionKey: "goal:alpha:conv",
      agentId: "coder",
      source: "chat",
      status: "success",
      title: "Ship goal alpha rollout",
      summary: "Finalize goal alpha rollout checklist.",
      metadata: { goalId: "goal-alpha", goalSession: true },
      startedAt: "2026-05-21T09:00:00.000Z",
      finishedAt: "2026-05-21T09:20:00.000Z",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:20:00.000Z",
    });
    store.createTask({
      id: "p18-task-2",
      conversationId: "goal:beta:conv",
      sessionKey: "goal:beta:conv",
      agentId: "reviewer",
      source: "chat",
      status: "partial",
      title: "Review goal beta regression guard",
      summary: "Check goal beta regression guard before release.",
      metadata: { goalId: "goal-beta" },
      startedAt: "2026-05-21T10:00:00.000Z",
      finishedAt: "2026-05-21T10:10:00.000Z",
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:10:00.000Z",
    });
    store.linkTaskMemory("p18-task-1", "p18-profile-core", "used");
    store.linkTaskMemory("p18-task-1", "p18-profile-derived", "generated");
    store.linkTaskMemory("p18-task-2", "p18-global-focus", "used");

    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "profile" })).toMatchObject({
      kind: "profile",
      totalNodes: 2,
      totalEdges: 6,
    });
    expect(manager.listMemoryTreeSources(20)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "builtin:memory:core-note",
        sourceKind: "memory_core_note",
      }),
      expect.objectContaining({
        id: "builtin:sessions:session-memory",
        sourceKind: "session_memory",
      }),
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("roadmap.md"),
      }),
    ]));
    const profileNodes = manager.listMemoryTreeNodes(10, { kind: "profile" });
    expect(profileNodes.map((item) => item.id)).toEqual(["profile:reviewer", "profile:coder"]);
    const reviewerNode = profileNodes.find((item) => item.id === "profile:reviewer");
    const coderNode = profileNodes.find((item) => item.id === "profile:coder");
    expect(coderNode).toMatchObject({
      kind: "profile",
      agentId: "coder",
      summaryVersion: "p18-profile-node-v1",
      metadata: expect.objectContaining({
        treePipeline: expect.objectContaining({
          pipelineVersion: "p21-tree-canonical-v1",
          canonical: expect.objectContaining({
            canonicalNodeKey: "tree:profile:private:coder:coder",
            nodeFamilyKey: "tree:profile:private:-:coder",
          }),
          ingest: expect.objectContaining({
            stage: "ingested",
            evidenceChunkCount: 2,
          }),
          lifecycle: expect.objectContaining({
            state: "buffered",
            stable: false,
          }),
        }),
      }),
    });
    expect(reviewerNode).toMatchObject({
      metadata: expect.objectContaining({
        treePipeline: expect.objectContaining({
          lifecycle: expect.objectContaining({
            state: "admitted",
            stable: false,
          }),
        }),
      }),
    });
    expect(coderNode?.summary).toContain("goal-alpha");
    const coderDetail = manager.getMemoryTreeNodeDetail("profile:coder", { chunkLimit: 5 });
    expect(coderDetail?.chunks.map((item) => item.id)).toEqual([
      "p18-profile-core",
      "p18-profile-derived",
    ]);
    expect(coderDetail?.sources).toEqual([
      expect.objectContaining({
        id: "builtin:memory:core-note",
        sourceKind: "memory_core_note",
      }),
      expect.objectContaining({
        id: "builtin:sessions:session-memory",
        sourceKind: "session_memory",
      }),
    ]);
    expect(coderDetail?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        childId: "p18-profile-core",
        metadata: expect.objectContaining({
          canonicalSourceKey: expect.any(String),
          sourceFamilyKey: expect.any(String),
          sourceKind: "memory_core_note",
          taskIds: expect.arrayContaining(["p18-task-1"]),
          linkRelations: expect.arrayContaining(["used"]),
        }),
      }),
      expect.objectContaining({
        childId: "p18-profile-derived",
        metadata: expect.objectContaining({
          canonicalSourceKey: expect.any(String),
          sourceFamilyKey: expect.any(String),
          sourceKind: "session_memory",
          taskIds: expect.arrayContaining(["p18-task-1"]),
          linkRelations: expect.arrayContaining(["generated"]),
        }),
      }),
      expect.objectContaining({
        childType: "source",
        childId: "builtin:memory:core-note",
        metadata: expect.objectContaining({
          sourceKind: "memory_core_note",
          evidenceChunkCount: 1,
        }),
      }),
      expect.objectContaining({
        childType: "source",
        childId: "builtin:sessions:session-memory",
        metadata: expect.objectContaining({
          sourceKind: "session_memory",
          evidenceChunkCount: 1,
        }),
      }),
    ]));

    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "global" })).toMatchObject({
      kind: "global",
      totalNodes: 1,
      totalEdges: 6,
    });
    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "project" })).toMatchObject({
      kind: "project",
      totalNodes: 2,
      totalEdges: 3,
    });
    expect(manager.rebuildMemoryTreeNodes({ limit: 10, kind: "agent" })).toMatchObject({
      kind: "agent",
      totalNodes: 2,
      totalEdges: 3,
    });
    const globalNode = manager.listMemoryTreeNodes(10, { kind: "global" })[0];
    expect(globalNode).toMatchObject({
      id: "global:workspace",
      kind: "global",
      summaryVersion: "p18-global-node-v1",
      metadata: expect.objectContaining({
        treePipeline: expect.objectContaining({
          pipelineVersion: "p21-tree-canonical-v1",
          canonical: expect.objectContaining({
            canonicalNodeKey: "tree:global:private:-:workspace",
            nodeFamilyKey: "tree:global:private:-:workspace",
          }),
          ingest: expect.objectContaining({
            stage: "ingested",
            evidenceChunkCount: 3,
          }),
          lifecycle: expect.objectContaining({
            state: "sealed",
            stable: true,
          }),
        }),
      }),
    });
    expect(globalNode?.summary).toContain("goal-alpha");
    expect(globalNode?.summary).toContain("goal-beta");
    const globalSearch = manager.searchMemoryTreeNodes("goal beta regression guard", {
      limit: 2,
      filter: { kind: "global" },
      chunkLimitPerNode: 5,
    });
    expect(globalSearch[0]?.node.id).toBe("global:workspace");
    expect(globalSearch[0]?.chunks.map((item) => item.id)).toEqual([
      "p18-profile-core",
      "p18-profile-derived",
      "p18-global-focus",
    ]);
    expect(globalSearch[0]?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKind: "memory_core_note",
      }),
      expect.objectContaining({
        sourceKind: "session_memory",
      }),
      expect.objectContaining({
        sourceKind: "workspace_file",
        sourcePath: expect.stringContaining("roadmap.md"),
      }),
    ]));
    const highLevelGlobalSearch = manager.searchMemoryTreeNodes("global focus goal-alpha", {
      limit: 3,
      chunkLimitPerNode: 5,
    });
    expect(highLevelGlobalSearch[0]).toMatchObject({
      node: expect.objectContaining({
        kind: "global",
        id: "global:workspace",
      }),
      matchReasons: expect.arrayContaining(["intent:global"]),
    });
    const highLevelProfileSearch = manager.searchMemoryTreeNodes("coder profile reuse checklist", {
      limit: 3,
      chunkLimitPerNode: 5,
    });
    expect(highLevelProfileSearch[0]).toMatchObject({
      node: expect.objectContaining({
        kind: "profile",
        id: "profile:coder",
      }),
      matchReasons: expect.arrayContaining(["intent:profile"]),
    });
  });

  it("refreshes managed tree lifecycle when memory and task sequences advance", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "lifecycle-core",
      sourcePath: path.join(stateDir, "MEMORY.md"),
      sourceType: "file",
      memoryType: "other",
      category: "decision",
      content: "keep rollout notes aligned with current delivery goals.",
    });
    manager.upsertMemoryChunk({
      id: "lifecycle-global",
      sourcePath: path.join(docsDir, "roadmap.md"),
      sourceType: "file",
      memoryType: "other",
      category: "fact",
      content: "workspace focus starts from goal alpha rollout.",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
    };
    store.createTask({
      id: "lifecycle-task-1",
      conversationId: "goal:alpha:conv",
      sessionKey: "goal:alpha:conv",
      agentId: "coder",
      source: "chat",
      status: "success",
      title: "Ship goal alpha rollout",
      summary: "Finalize goal alpha rollout checklist.",
      metadata: { goalId: "goal-alpha", goalSession: true },
      startedAt: "2026-05-21T09:00:00.000Z",
      finishedAt: "2026-05-21T09:20:00.000Z",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:20:00.000Z",
    });
    store.createTask({
      id: "lifecycle-task-2",
      conversationId: "goal:beta:conv",
      sessionKey: "goal:beta:conv",
      agentId: "reviewer",
      source: "chat",
      status: "partial",
      title: "Review goal beta guard",
      summary: "Check goal beta regression guard before release.",
      metadata: { goalId: "goal-beta" },
      startedAt: "2026-05-21T10:00:00.000Z",
      finishedAt: "2026-05-21T10:10:00.000Z",
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:10:00.000Z",
    });
    store.linkTaskMemory("lifecycle-task-1", "lifecycle-core", "used");
    store.linkTaskMemory("lifecycle-task-2", "lifecycle-global", "used");

    const initial = await manager.ensureManagedMemoryTreeFresh({
      kinds: ["profile", "global"],
      nodeLimit: 10,
      rebuildSources: false,
    });
    expect(initial.rebuiltKinds).toEqual(["profile", "global"]);
    expect(initial.after.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "profile",
        dirty: false,
      }),
      expect.objectContaining({
        kind: "global",
        dirty: false,
      }),
    ]));

    const clean = await manager.ensureManagedMemoryTreeFresh({
      kinds: ["profile", "global"],
      nodeLimit: 10,
      rebuildSources: false,
    });
    expect(clean.rebuiltKinds).toEqual([]);

    manager.upsertMemoryChunk({
      id: "lifecycle-new",
      sourcePath: path.join(docsDir, "goal-gamma-plan.md"),
      sourceType: "file",
      memoryType: "other",
      category: "fact",
      content: "goal gamma rollout now joins the workspace focus.",
    });
    store.createTask({
      id: "lifecycle-task-3",
      conversationId: "goal:gamma:conv",
      sessionKey: "goal:gamma:conv",
      agentId: "coder",
      source: "chat",
      status: "success",
      title: "Plan goal gamma rollout",
      summary: "Prepare the first goal gamma rollout plan.",
      metadata: { goalId: "goal-gamma" },
      startedAt: "2026-05-21T11:00:00.000Z",
      finishedAt: "2026-05-21T11:15:00.000Z",
      createdAt: "2026-05-21T11:00:00.000Z",
      updatedAt: "2026-05-21T11:15:00.000Z",
    });
    store.linkTaskMemory("lifecycle-task-3", "lifecycle-new", "generated");

    const refreshed = await manager.ensureManagedMemoryTreeFresh({
      kinds: ["profile", "global"],
      nodeLimit: 10,
      rebuildSources: false,
    });
    expect(refreshed.rebuiltKinds).toEqual(["profile", "global"]);
    expect(refreshed.before.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "profile",
        dirty: true,
        reasons: expect.arrayContaining(["memory_changed", "task_changed"]),
      }),
      expect.objectContaining({
        kind: "global",
        dirty: true,
        reasons: expect.arrayContaining(["memory_changed", "task_changed"]),
      }),
    ]));

    const coderNode = manager.listMemoryTreeNodes(10, { kind: "profile" }).find((item) => item.id === "profile:coder");
    const globalNode = manager.listMemoryTreeNodes(10, { kind: "global" })[0];
    expect(coderNode?.summary).toContain("goal-gamma");
    expect(globalNode?.summary).toContain("goal-gamma");
    expect(globalNode?.metadata).toMatchObject({
      rolledUpSourceCount: 3,
    });
  });

  it("skips a second source rebuild while the first one is still running", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "source-single-flight",
      sourcePath: path.join(docsDir, "single-flight.md"),
      sourceType: "file",
      memoryType: "other",
      content: "single flight source rebuild guard",
    });

    const originalPreviewSourceInventory = manager.previewSourceInventory.bind(manager);
    const previewReport = await originalPreviewSourceInventory();
    let resolvePreviewGate!: (report: typeof previewReport) => void;
    const previewGate = new Promise<typeof previewReport>((resolve) => {
      resolvePreviewGate = resolve;
    });
    manager.previewSourceInventory = vi.fn(() => previewGate) as unknown as typeof manager.previewSourceInventory;

    const firstRunPromise = manager.rebuildMemoryTreeSources({
      triggerSource: "memory.tree.source.rebuild",
    });
    const secondRun = await manager.rebuildMemoryTreeSources({
      triggerSource: "memory.tree.source.rebuild",
    });

    expect(secondRun).toMatchObject({
      skipped: true,
      skipReason: "reentry_blocked",
      totalSources: 0,
      inventorySources: 0,
      dynamicSources: 0,
    });

    resolvePreviewGate(previewReport);
    const firstRun = await firstRunPromise;
    expect(firstRun.skipped).toBeUndefined();

    const jobReport = manager.getMemoryTreeJobReport();
    expect(jobReport.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "source_rebuild:source",
        status: "completed",
        skipCount: 1,
        lastSkipReason: "reentry_blocked",
      }),
    ]));
  });

  it("skips a profile node rebuild while the node job is already running", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const store = (manager as any).store as {
      getMeta: (key: string) => string | null;
      setMeta: (key: string, value: string) => void;
    };
    recordMemoryTreeJobLedgerStart(store, {
      jobType: "node_rebuild",
      targetKey: "profile",
      startedAt: "2026-05-21T12:00:00.000Z",
      triggerSource: "memory.tree.node.rebuild",
    });

    const skipped = manager.rebuildMemoryTreeNodes({
      kind: "profile",
      triggerSource: "memory.tree.node.rebuild",
    });

    expect(skipped).toMatchObject({
      skipped: true,
      skipReason: "reentry_blocked",
      kind: "profile",
      totalNodes: 0,
      totalEdges: 0,
    });

    const jobReport = manager.getMemoryTreeJobReport({
      kinds: ["profile"],
    });
    expect(jobReport.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "node_rebuild:profile",
        skipCount: 1,
        lastSkipReason: "reentry_blocked",
        lastSkippedTriggerSource: "memory.tree.node.rebuild",
      }),
    ]));
  });

  it("skips score rebuild during cooldown and records a retry window", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
    });

    const store = (manager as any).store as {
      getMeta: (key: string) => string | null;
      setMeta: (key: string, value: string) => void;
    };
    const failedAt = new Date(Date.now() - 1_000).toISOString();
    recordMemoryTreeJobLedgerFailure(store, {
      jobType: "score_rebuild",
      targetKey: "chunk_scores",
      failedAt,
      error: new Error("score rebuild failed"),
      triggerSource: "memory.tree.score.rebuild",
    });

    const skipped = manager.rebuildMemoryTreeScores({
      triggerSource: "memory.tree.score.rebuild",
    });

    expect(skipped).toMatchObject({
      skipped: true,
      skipReason: "cooldown_active",
      scoreVersion: "v1_rule_only",
      totalScores: 0,
    });

    const jobReport = manager.getMemoryTreeJobReport();
    expect(jobReport.headline).toContain("next retry");
    expect(jobReport.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "score_rebuild:chunk_scores",
        status: "cooldown",
        skipCount: 1,
        lastSkipReason: "cooldown_active",
        lastFailureError: "score rebuild failed",
        retryAfterMs: expect.any(Number),
      }),
    ]));
  });

  it("uses R2 node-assisted routing before chunk fallback and exposes diagnostics", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
      nodeAssistedRetrievalEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "r2-node-high",
      sourcePath: path.join(docsDir, "goal-alpha-summary.md"),
      sourceType: "file",
      memoryType: "other",
      content: "goal alpha final summary and completion checklist",
    });
    manager.upsertMemoryChunk({
      id: "r2-fallback-raw",
      sourcePath: path.join(docsDir, "fallback-notes.md"),
      sourceType: "file",
      memoryType: "other",
      content: "fallback raw notes for goal alpha search",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
      searchHybrid: (...args: any[]) => Array<Record<string, unknown>>;
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:r2-node-high",
        targetType: "chunk",
        targetId: "r2-node-high",
        scoreTotal: 0.95,
        sourceWeightScore: 0.7,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
      {
        id: "score:v1_rule_only:chunk:r2-fallback-raw",
        targetType: "chunk",
        targetId: "r2-fallback-raw",
        scoreTotal: 0.35,
        sourceWeightScore: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
      },
    ]);
    store.createTask({
      id: "r2-project-task",
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
    store.linkTaskMemory("r2-project-task", "r2-node-high", "generated");

    manager.rebuildMemoryTreeNodes({ limit: 10, kind: "project" });

    const originalSearchHybrid = store.searchHybrid.bind(store);
    store.searchHybrid = () => [
      {
        id: "r2-fallback-raw",
        sourcePath: path.join(docsDir, "fallback-notes.md"),
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
      const execution = await manager.searchWithDiagnostics("goal-alpha", {
        limit: 2,
        includeContent: false,
        routingPolicy: "node_assisted",
      });

      expect(execution.items.map((item) => item.id)).toEqual([
        "r2-node-high",
        "r2-fallback-raw",
      ]);
      expect(execution.items[0]?.metadata?.memoryTree).toMatchObject({
        nodeHit: {
          kind: "project",
        },
        sourceClass: "curated",
      });
      expect(execution.diagnostics).toMatchObject({
        routingPolicy: "node_assisted",
        nodeAssisted: {
          enabled: true,
          policy: "node_assisted",
          routeClass: "project_status",
          routeReasons: expect.arrayContaining(["term:project"]),
          routedKinds: expect.arrayContaining(["global", "project", "topic"]),
          preferHighLevel: true,
          chunkLimitPerNode: 3,
          answerSufficient: true,
          evidenceExpanded: false,
          evidenceChunkCount: 0,
          highLevelOnly: true,
          injectedChunkCount: 1,
          fallbackApplied: true,
          returnedMix: {
            nodeBacked: 1,
            chunkOnly: 1,
          },
          nodeBackedShare: 0.5,
          chunkOnlyShare: 0.5,
        },
        stages: {
          raw: {
            count: 1,
            topHits: [
              expect.objectContaining({ id: "r2-fallback-raw" }),
            ],
          },
          returned: {
            count: 2,
            topHits: [
              expect.objectContaining({ id: "r2-node-high" }),
              expect.objectContaining({ id: "r2-fallback-raw" }),
            ],
          },
        },
      });
      expect(execution.diagnostics.nodeAssisted?.selectedNodeIds).toEqual(
        expect.arrayContaining([expect.stringMatching(/^project:/)]),
      );
      expect(execution.diagnostics.nodeAssisted?.nodeHitCount ?? 0).toBeGreaterThanOrEqual(1);
      expect(execution.diagnostics.nodeAssisted?.topNodeHits).toEqual(
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
  });

  it("returns last-known-good node-assisted results before a dirty managed tree refresh runs", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      nodeAssistedRetrievalEnabled: true,
    });

    const store = (manager as any).store;
    store.upsertChunk({
      id: "node-refresh-tree-chunk",
      sourcePath: path.join(docsDir, "node-refresh-tree.md"),
      sourceType: "file",
      memoryType: "other",
      content: "profile overview last known good memory",
    });
    store.upsertMemoryTreeNodes([{
      id: "profile:node-refresh",
      level: 1,
      kind: "profile",
      scope: "private",
      title: "Profile overview",
      summary: "Profile overview last known good snapshot",
      createdAt: "2026-05-22T09:00:00.000Z",
      updatedAt: "2026-05-22T09:00:00.000Z",
    }]);
    store.upsertMemoryTreeEdges([{
      id: "edge:profile:node-refresh:chunk:node-refresh-tree-chunk",
      parentNodeId: "profile:node-refresh",
      childType: "chunk",
      childId: "node-refresh-tree-chunk",
      relation: "contains",
      position: 0,
      weight: 1,
      createdAt: "2026-05-22T09:00:00.000Z",
    }]);
    const rebuildSpy = vi.spyOn(manager, "rebuildMemoryTreeNodes");
    const result = await (manager as any).applyNodeAssistedRetrieval("profile overview", {
      limit: 2,
      rawResults: [
        {
          id: "node-refresh-raw",
          sourcePath: path.join(docsDir, "node-refresh.md"),
          sourceType: "file",
          memoryType: "other",
          snippet: "fallback profile memory",
          summary: "fallback profile memory",
          score: 0.8,
          metadata: {},
          updatedAt: "2026-05-22T10:00:00.000Z",
        },
      ],
    });

    expect(rebuildSpy).not.toHaveBeenCalled();
    expect(result.results.map((item: { id: string }) => item.id)).toEqual([
      "node-refresh-tree-chunk",
      "node-refresh-raw",
    ]);
    expect(result.diagnostics.treeFreshness).toMatchObject({
      stale: true,
      refreshScheduled: true,
      dirtyKinds: expect.arrayContaining(["profile"]),
    });
    expect(result.diagnostics.nodeHitCount).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.id).toBe("node-refresh-tree-chunk");

    await vi.waitFor(() => expect(rebuildSpy).toHaveBeenCalledTimes(2));
  });

  it("drops a scheduled node-assisted refresh when the manager closes", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      nodeAssistedRetrievalEnabled: true,
    });

    const rebuildSpy = vi.spyOn(manager, "rebuildMemoryTreeNodes");
    await (manager as any).applyNodeAssistedRetrieval("profile overview", {
      limit: 2,
      rawResults: [],
    });
    await manager.close();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(rebuildSpy).not.toHaveBeenCalled();
  });

  it("expands topic evidence chunks when high-level topic routing is not enough", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      nodeAssistedRetrievalEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "r2-topic-high",
      sourcePath: path.join(docsDir, "viewer-audit-summary.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer audit",
      content: "viewer audit final summary and rollout status",
    });
    manager.upsertMemoryChunk({
      id: "r2-topic-mid",
      sourcePath: path.join(docsDir, "viewer-audit-notes.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer_audit",
      content: "viewer audit detail notes and evidence trail",
    });
    manager.upsertMemoryChunk({
      id: "r2-topic-low",
      sourcePath: path.join(docsDir, "viewer-audit-checklist.md"),
      sourceType: "file",
      memoryType: "other",
      topic: "viewer-audit-checklist",
      content: "viewer audit checklist evidence",
    });

    const store = (manager as any).store as {
      upsertMemoryScores: (records: Array<Record<string, unknown>>) => void;
    };
    store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:r2-topic-high",
        targetType: "chunk",
        targetId: "r2-topic-high",
        scoreTotal: 0.94,
        sourceWeightScore: 0.72,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
      {
        id: "score:v1_rule_only:chunk:r2-topic-mid",
        targetType: "chunk",
        targetId: "r2-topic-mid",
        scoreTotal: 0.61,
        sourceWeightScore: 0.4,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
      },
      {
        id: "score:v1_rule_only:chunk:r2-topic-low",
        targetType: "chunk",
        targetId: "r2-topic-low",
        scoreTotal: 0.31,
        sourceWeightScore: 0.18,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "raw" },
      },
    ]);

    manager.rebuildMemoryTreeNodes({ limit: 20, kind: "topic" });

    const execution = await manager.searchWithDiagnostics("viewer audit details", {
      limit: 2,
      includeContent: false,
      filter: { topic: "viewer-audit" },
      routingPolicy: "node_assisted",
    });

    expect(execution.items.map((item) => item.id)).toEqual([
      "r2-topic-high",
      "r2-topic-mid",
    ]);
    expect(execution.items.map((item) => item.metadata?.memoryTree?.answerStage)).toEqual([
      "high_level",
      "evidence",
    ]);
    expect(execution.diagnostics).toMatchObject({
      routingPolicy: "node_assisted",
      nodeAssisted: {
        enabled: true,
        policy: "node_assisted",
        routeClass: "topic_lookup",
        routeReasons: expect.arrayContaining(["filter:topic"]),
        routedKinds: expect.arrayContaining(["topic"]),
        preferHighLevel: false,
        chunkLimitPerNode: 3,
        answerSufficient: false,
        evidenceExpanded: true,
        evidenceChunkCount: 2,
        highLevelOnly: false,
        selectedNodeIds: expect.arrayContaining([expect.any(String)]),
        nodeHitCount: 1,
        injectedChunkCount: 3,
        fallbackApplied: false,
      },
      stages: {
        raw: {
          count: 0,
          topHits: [],
        },
        returned: {
          count: 2,
          topHits: [
            expect.objectContaining({ id: "r2-topic-high" }),
            expect.objectContaining({ id: "r2-topic-mid" }),
          ],
        },
      },
    });
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

  it("applies only archive-suggested dedup groups and skips keep/review groups", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "archive-keep",
      sourcePath: "memory/archive-keep.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "archive-ready duplicate",
      visibility: "private",
    });
    manager.upsertMemoryChunk({
      id: "archive-remove",
      sourcePath: "memory/archive-remove.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "archive-ready duplicate",
      visibility: "private",
    });
    manager.upsertMemoryChunk({
      id: "keep-keep",
      sourcePath: "external/keep-keep.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "keep this duplicate pair",
      visibility: "private",
    });
    manager.upsertMemoryChunk({
      id: "keep-remove",
      sourcePath: "external/keep-remove.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "keep this duplicate pair",
      visibility: "private",
    });
    manager.upsertMemoryChunk({
      id: "review-keep",
      sourcePath: "memory/review-keep.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "review this duplicate pair",
      visibility: "shared",
    });
    manager.upsertMemoryChunk({
      id: "review-remove",
      sourcePath: "external/review-remove.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "review this duplicate pair",
      visibility: "private",
    });

    const preview = manager.previewExactDedup({ memoryType: "daily" }, { maxGroups: 10 });
    expect(preview.governance).toMatchObject({
      suggestedArchiveGroupCount: 1,
      suggestedKeepGroupCount: 1,
      suggestedReviewGroupCount: 1,
    });

    const report = manager.persistMemoryTreeDedupPreviewReport(preview, {
      filter: { memoryType: "daily" },
      maxGroups: 10,
      createdBy: "test",
    });
    manager.reviewMemoryTreeReport(report.id, "approved", {
      reviewedBy: "tester",
      note: "apply only archive candidates",
    });

    const applied = await manager.applyMemoryTreeReport(report.id, {
      appliedBy: "tester",
      note: "respect dedup governance suggestions",
    });
    expect(applied.updatedChunkCount).toBe(1);
    expect(applied.updatedScoreCount).toBe(1);
    expect(applied.skippedChunkIds).toEqual(expect.arrayContaining([
      "keep-remove",
      "review-remove",
    ]));
    expect(applied.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "dedup_archive",
        chunkId: "archive-remove",
      }),
      expect.objectContaining({
        kind: "dedup_skip",
        chunkId: "keep-remove",
        reason: "governance_keep",
        skipped: true,
      }),
      expect.objectContaining({
        kind: "dedup_skip",
        chunkId: "review-remove",
        reason: "governance_review",
        skipped: true,
      }),
    ]));

    expect(manager.getMemory("archive-remove")?.metadata).toMatchObject({
      memoryTree: {
        governance: {
          archived: true,
          archiveReason: "dedup_preview_remove",
        },
      },
    });
    expect(manager.getMemory("keep-remove")?.metadata?.memoryTree).toBeUndefined();
    expect(manager.getMemory("review-remove")?.metadata?.memoryTree).toBeUndefined();
  });

  it("previews and applies P15 external Obsidian ingest through report review/apply", async () => {
    const obsidianDir = path.join(rootDir, "obsidian-vault");
    const notePath = path.join(obsidianDir, "Projects", "viewer-audit.md");
    const stalePath = path.join(obsidianDir, "Archive", "retired-note.md");
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.mkdir(path.dirname(stalePath), { recursive: true });
    await fs.writeFile(notePath, "# Viewer Audit\n\nObsidian ingest should become searchable memory.\n", "utf-8");
    await fs.writeFile(stalePath, "# Retired\n\nThis note should be cleaned on rescan.\n", "utf-8");

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
      totalFiles: 2,
      eligibleFiles: 2,
      skippedFiles: 0,
      rescan: {
        mode: "initial",
        previousFileCount: 0,
      },
    });

    const report = manager.persistMemoryTreeExternalIngestReport(preview, {
      createdBy: "test",
    });
    expect(report.reportType).toBe("external_ingest_preview");
    expect(report.summary).toMatchObject({
      sourceId: "configured:obsidian-vault:1",
      estimatedChunks: expect.any(Number),
      governance: expect.objectContaining({
        headline: expect.stringContaining("External ingest governance"),
        reviewSuggestionCount: 0,
      }),
    });
    expect(report.details).toMatchObject({
      governance: expect.objectContaining({
        topSuggestions: expect.any(Array),
      }),
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

    const appliedJobReport = manager.getMemoryTreeJobReport({
      kinds: ["topic", "profile", "global"],
    });
    expect(appliedJobReport.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "source_rebuild:source",
        triggerSource: "external ingest apply",
      }),
      expect.objectContaining({
        jobKey: "score_rebuild:chunk_scores",
        triggerSource: "external ingest apply",
      }),
    ]));

    await fs.writeFile(notePath, "# Viewer Audit\n\nRescanned content should replace the original memory.\n", "utf-8");
    await fs.rm(stalePath, { force: true });

    const rescanPreview = await manager.previewConfiguredExternalIngest({
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
    expect(rescanPreview).toMatchObject({
      adapter: "obsidian_markdown_directory_v1",
      totalFiles: 1,
      eligibleFiles: 1,
      rescan: {
        mode: "rescan",
        previousFileCount: 2,
        changedFileCount: 1,
        unchangedFileCount: 0,
        staleFileCount: 1,
      },
    });
    expect(rescanPreview.rescan.staleFiles).toEqual([
      expect.objectContaining({
        path: stalePath,
        reason: "missing_from_preview",
      }),
    ]);

    const rescanReport = manager.persistMemoryTreeExternalIngestReport(rescanPreview, {
      createdBy: "test",
    });
    expect(rescanReport.summary).toMatchObject({
      governance: expect.objectContaining({
        keepSuggestionCount: 1,
        sameSourceRescanFileCount: 1,
      }),
    });
    expect(rescanReport.details).toMatchObject({
      governance: expect.objectContaining({
        topSuggestions: [
          expect.objectContaining({
            category: "external_rescan_replace",
            suggestedAction: "keep",
          }),
        ],
      }),
    });
    manager.reviewMemoryTreeReport(rescanReport.id, "approved", {
      reviewedBy: "tester",
      note: "rescan external markdown after stale removal",
    });

    const rescanned = await manager.applyMemoryTreeReport(rescanReport.id, {
      appliedBy: "tester",
      note: "replace changed file and remove stale source chunks",
    });
    expect(rescanned.report.status).toBe("applied");
    expect(rescanned.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "external_ingest",
        sourcePath: stalePath,
        stale: true,
        removedChunkCount: expect.any(Number),
      }),
    ]));

    const rescannedChunks = manager.getMemoriesBySource(notePath, 20);
    expect(rescannedChunks.length).toBeGreaterThan(0);
    expect(rescannedChunks[0]?.content).toContain("Rescanned content should replace the original memory.");
    expect(manager.getMemoriesBySource(stalePath, 20)).toEqual([]);
  });

  it("previews and applies R4 single-file markdown external ingest", async () => {
    const externalFile = path.join(rootDir, "external-playbook.md");
    await fs.writeFile(externalFile, "# Playbook\n\nSingle file external ingest marker.\n", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const preview = await manager.previewConfiguredExternalIngest({
      configuredSources: [
        {
          id: "configured:playbook-file:1",
          label: "Playbook File",
          sourceClass: "curated",
          scope: "private",
          filePath: externalFile,
        },
      ],
    });
    expect(preview).toMatchObject({
      adapter: "markdown_file_v1",
      sourceId: "configured:playbook-file:1",
      totalFiles: 1,
      eligibleFiles: 1,
      rootPath: path.dirname(externalFile),
      rescan: {
        mode: "initial",
      },
    });

    const report = manager.persistMemoryTreeExternalIngestReport(preview, {
      createdBy: "test",
    });
    manager.reviewMemoryTreeReport(report.id, "approved", {
      reviewedBy: "tester",
      note: "approve single-file markdown ingest",
    });

    const applied = await manager.applyMemoryTreeReport(report.id, {
      appliedBy: "tester",
      note: "import single markdown file",
    });
    expect(applied.report.status).toBe("applied");
    expect(applied.updatedChunkCount).toBeGreaterThan(0);

    const importedChunks = manager.getMemoriesBySource(externalFile, 20);
    expect(importedChunks.length).toBeGreaterThan(0);
    expect(importedChunks[0]?.metadata).toMatchObject({
      memoryTree: {
        externalSourceId: "configured:playbook-file:1",
        externalSourceType: "external_markdown_file",
      },
    });
  });

  it("applies inventory and tree build reports as report-only governance state changes", async () => {
    const stateMemoryDir = path.join(stateDir, "memory");
    const stateMemoryPath = path.join(stateMemoryDir, "2026-05-21.md");
    await fs.mkdir(stateMemoryDir, { recursive: true });
    await fs.writeFile(stateMemoryPath, "# Daily Memory\nr3 governance baseline\n", "utf-8");

    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      additionalRoots: [stateMemoryDir],
      taskMemoryEnabled: true,
    });

    manager.upsertMemoryChunk({
      id: "r3-tree-report-a",
      sourcePath: stateMemoryPath,
      sourceType: "file",
      memoryType: "daily",
      content: "inventory and tree build baseline chunk",
      visibility: "shared",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
    };
    store.createTask({
      id: "task-r3-report-1",
      conversationId: "conv-r3-report-1",
      sessionKey: "conv-r3-report-1",
      source: "chat",
      status: "success",
      title: "确认 R3 report baseline",
      summary: "验证 inventory 与 tree_build_preview apply 只写 report 状态。",
      startedAt: "2026-05-21T10:00:00.000Z",
      finishedAt: "2026-05-21T10:05:00.000Z",
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:05:00.000Z",
    });
    store.linkTaskMemory("task-r3-report-1", "r3-tree-report-a", "used");

    const inventoryPreview = await manager.previewSourceInventory();
    const inventoryReport = manager.persistMemoryTreeInventoryReport(inventoryPreview, {
      createdBy: "test",
    });
    manager.reviewMemoryTreeReport(inventoryReport.id, "approved", {
      reviewedBy: "tester",
      note: "approve inventory governance baseline",
    });

    const appliedInventory = await manager.applyMemoryTreeReport(inventoryReport.id, {
      appliedBy: "tester",
      note: "confirm inventory baseline",
    });
    expect(appliedInventory.report.status).toBe("applied");
    expect(appliedInventory.updatedChunkCount).toBe(0);
    expect(appliedInventory.updatedScoreCount).toBe(0);
    expect(appliedInventory.actions).toEqual([
      expect.objectContaining({
        kind: "report_governance_ack",
        reportType: "inventory",
        governanceState: "inventory_baseline_confirmed",
      }),
    ]);
    expect(appliedInventory.report.summary).toMatchObject({
      applyMode: "report_state_only",
      governanceState: "inventory_baseline_confirmed",
    });
    expect(appliedInventory.report.details).toMatchObject({
      lastApply: expect.objectContaining({
        updatedChunkCount: 0,
        updatedScoreCount: 0,
      }),
    });

    const treeBuildResult = manager.rebuildMemoryTreeNodes({ limit: 10 });
    expect(treeBuildResult.totalNodes).toBe(1);
    const treeBuildReport = manager.listMemoryTreeReports(20, {
      reportType: "tree_build_preview",
    })[0];
    expect(treeBuildReport?.reportType).toBe("tree_build_preview");
    manager.reviewMemoryTreeReport(String(treeBuildReport?.id ?? ""), "approved", {
      reviewedBy: "tester",
      note: "approve tree build governance baseline",
    });

    const appliedTreeBuild = await manager.applyMemoryTreeReport(String(treeBuildReport?.id ?? ""), {
      appliedBy: "tester",
      note: "confirm tree build baseline",
    });
    expect(appliedTreeBuild.report.status).toBe("applied");
    expect(appliedTreeBuild.updatedChunkCount).toBe(0);
    expect(appliedTreeBuild.updatedScoreCount).toBe(0);
    expect(appliedTreeBuild.actions).toEqual([
      expect.objectContaining({
        kind: "report_governance_ack",
        reportType: "tree_build_preview",
        governanceState: "tree_build_baseline_confirmed",
      }),
    ]);
    expect(appliedTreeBuild.report.summary).toMatchObject({
      applyMode: "report_state_only",
      governanceState: "tree_build_baseline_confirmed",
    });
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

  it("returns completed keyword results at the retrieval deadline and aborts embedding", async () => {
    const filePath = path.join(docsDir, "deadline-fallback.md");
    await fs.writeFile(filePath, "# Deadline\ndeadline keyword fallback marker\n", "utf-8");
    manager = createManager({ workspaceRoot: docsDir, stateDir });
    await manager.indexWorkspace();

    let observedSignal: AbortSignal | undefined;
    let observedDeadlineMs: number | undefined;
    (manager as any).embeddingProvider = {
      modelName: "never-settling-embedding",
      embed: async () => await new Promise<number[]>(() => {}),
      embedBatch: async () => [],
      embedQuery: async (_query: string, context?: { signal?: AbortSignal; deadlineMs?: number }) => {
        observedSignal = context?.signal;
        observedDeadlineMs = context?.deadlineMs;
        return await new Promise<number[]>(() => {});
      },
    };

    const startedAt = Date.now();
    const deadlineMs = startedAt + 25;
    const execution = await manager.searchWithDiagnostics("deadline keyword fallback marker", {
      limit: 3,
      routingPolicy: "chunk_only",
      deadlineMs,
    });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(observedSignal?.aborted).toBe(true);
    expect(observedDeadlineMs).toBe(deadlineMs);
    expect(execution.items.some((item) => item.sourcePath === filePath)).toBe(true);
    expect(execution.diagnostics).toMatchObject({
      deadlineExceeded: true,
      embeddingFallbackReason: "deadline",
    });
  });

  it("does not start embedding when the absolute retrieval deadline already passed", async () => {
    const filePath = path.join(docsDir, "expired-deadline.md");
    await fs.writeFile(filePath, "# Expired\nexpired deadline keyword marker\n", "utf-8");
    manager = createManager({ workspaceRoot: docsDir, stateDir });
    await manager.indexWorkspace();
    const embedQuery = vi.fn(async () => [0.1]);
    (manager as any).embeddingProvider = {
      modelName: "expired-deadline-embedding",
      embed: async () => [0.1],
      embedBatch: async () => [],
      embedQuery,
    };

    const execution = await manager.searchWithDiagnostics("expired deadline keyword marker", {
      limit: 3,
      routingPolicy: "chunk_only",
      deadlineMs: Date.now() - 1,
    });

    expect(embedQuery).not.toHaveBeenCalled();
    expect(execution.items.some((item) => item.sourcePath === filePath)).toBe(true);
    expect(execution.diagnostics).toMatchObject({
      deadlineExceeded: true,
      embeddingFallbackReason: "deadline",
    });
  });

  it("rejects caller cancellation and ignores a late embedding result", async () => {
    const filePath = path.join(docsDir, "cancelled-retrieval.md");
    await fs.writeFile(filePath, "# Cancelled\ncancelled retrieval marker\n", "utf-8");
    manager = createManager({ workspaceRoot: docsDir, stateDir });
    await manager.indexWorkspace();

    let resolveEmbedding!: (vector: number[]) => void;
    let observedSignal: AbortSignal | undefined;
    (manager as any).embeddingProvider = {
      modelName: "late-embedding",
      embed: async () => [0.1],
      embedBatch: async () => [],
      embedQuery: async (_query: string, context?: { signal?: AbortSignal }) => {
        observedSignal = context?.signal;
        return await new Promise<number[]>((resolve) => {
          resolveEmbedding = resolve;
        });
      },
    };
    const keywordSpy = vi.spyOn((manager as any).store, "searchKeyword");
    const hybridSpy = vi.spyOn((manager as any).store, "searchHybrid");
    const controller = new AbortController();
    const search = manager.search("cancelled retrieval marker", {
      limit: 3,
      routingPolicy: "chunk_only",
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    controller.abort(new Error("caller stopped"));
    await expect(search).rejects.toMatchObject({ name: "AbortError" });
    resolveEmbedding([0.9]);
    await Promise.resolve();

    expect(observedSignal?.aborted).toBe(true);
    expect(keywordSpy).toHaveBeenCalledTimes(1);
    expect(hybridSpy).not.toHaveBeenCalled();
  });

  it("does not log query or provider error content when embedding falls back", async () => {
    manager = createManager({ workspaceRoot: docsDir, stateDir });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (manager as any).embeddingProvider = {
      modelName: "failing-embedding",
      embed: async () => { throw new Error("provider included secret query marker"); },
      embedBatch: async () => [],
      embedQuery: async () => { throw new Error("provider included secret query marker"); },
    };

    await manager.search("secret query marker", { limit: 1, routingPolicy: "chunk_only" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe("Embedding failed; using keyword-only memory retrieval.");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret query marker");
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

  it("hydrates shortcut candidates through batch projection instead of per-task detail reads", () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    const store = (manager as any).store;
    seedTaskShortcut(store, {
      taskId: "task-shortcut-batch-1",
      conversationId: "conv-shortcut-batch-1",
      status: "success",
      objective: "完成 task batch projection 接线",
      summary: "已批量读取 task detail，等待 shortcut 回归验证。",
      updatedAt: "2026-04-18T10:00:00.000Z",
      activities: [
        createShortcutActivity({
          id: "activity-shortcut-batch-1",
          taskId: "task-shortcut-batch-1",
          conversationId: "conv-shortcut-batch-1",
          sequence: 0,
          kind: "file_changed",
          state: "completed",
          happenedAt: "2026-04-18T09:58:00.000Z",
          title: "已新增 task-detail-batch.ts",
        }),
      ],
    });
    seedTaskShortcut(store, {
      taskId: "task-shortcut-batch-2",
      conversationId: "conv-shortcut-batch-2",
      status: "partial",
      objective: "继续 task batch projection 回归",
      summary: "继续验证 task detail 的批量投影字段。",
      updatedAt: "2026-04-18T11:00:00.000Z",
      activities: [
        createShortcutActivity({
          id: "activity-shortcut-batch-2",
          taskId: "task-shortcut-batch-2",
          conversationId: "conv-shortcut-batch-2",
          sequence: 0,
          kind: "tool_called",
          state: "completed",
          happenedAt: "2026-04-18T10:58:00.000Z",
          title: "已执行 task detail regression",
        }),
      ],
    });

    const batchSpy = vi.spyOn(store, "getTaskDetails");
    const getTaskSpy = vi.spyOn(store, "getTask");
    const activitySpy = vi.spyOn(store, "listTaskActivities");
    const memoryLinkSpy = vi.spyOn(store, "listTaskMemoryLinks");
    const usageSpy = vi.spyOn(store, "listExperienceUsages");
    const usageStatsSpy = vi.spyOn(store, "getExperienceUsageStats");

    const items = manager.findSimilarPastWork({
      query: "task batch projection",
      limit: 3,
    });

    expect(items.map((item) => item.taskId)).toEqual(expect.arrayContaining([
      "task-shortcut-batch-1",
      "task-shortcut-batch-2",
    ]));
    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect(getTaskSpy).not.toHaveBeenCalled();
    expect(activitySpy).not.toHaveBeenCalled();
    expect(memoryLinkSpy).not.toHaveBeenCalled();
    expect(usageSpy).not.toHaveBeenCalled();
    expect(usageStatsSpy).not.toHaveBeenCalled();
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

  it("aborts an evolution request when its deadline expires", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
      evolutionTimeoutMs: 25,
    });
    let requestSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      });
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await manager.extractMemoriesFromConversation("evolution-timeout", [
        { role: "user", content: "remember this preference" },
        { role: "assistant", content: "acknowledged" },
      ]);

      expect(requestSignal?.aborted).toBe(true);
      expect(result.summary).toContain("timed out after 25ms");
      expect(manager.isSessionMemoryExtracted("evolution-timeout")).toBe(false);
    } finally {
      errorSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("aborts an evolution request during close even when fetch ignores the signal", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
      evolutionTimeoutMs: 60_000,
    });
    let requestSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return await new Promise<Response>(() => {});
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const extraction = manager.extractMemoriesFromConversation("evolution-close", [
        { role: "user", content: "remember this preference" },
        { role: "assistant", content: "acknowledged" },
      ]);
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      const close = manager.close();
      const [result] = await Promise.all([extraction, close]);

      expect(requestSignal?.aborted).toBe(true);
      expect(result.summary).toContain("Memory manager is closing");
    } finally {
      errorSpy.mockRestore();
      fetchSpy.mockRestore();
    }
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

  it("writes low-risk profile state fields from durable extraction when structured profile hints are present", async () => {
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
        candidateType: "user",
        content: "用户明确说明自己叫小星。",
        reason: "显式自我介绍",
        profilePath: "identity.name",
        profileValue: "小星",
      },
      {
        type: "偏好",
        category: "preference",
        candidateType: "user",
        content: "用户默认希望先给结论，再展开证据。",
        reason: "稳定输出偏好",
        profilePath: "preferences.response_style",
        profileValue: "先给结论，再展开证据",
      },
      {
        type: "偏好",
        category: "preference",
        candidateType: "feedback",
        content: "用户习惯先列计划，再推进实现。",
        reason: "稳定工作方式",
        profilePath: "workstyle.planning_preference",
        profileValue: "先列计划，再推进实现",
      },
    ]);

    const result = await manager.extractMemoriesFromConversation("conv-profile-state-write", [
      { role: "user", content: "请沉淀我稳定的名字、输出风格和协作方式。" },
      { role: "assistant", content: "我会提取长期有效的低风险画像字段。" },
    ]);

    expect(result).toMatchObject({
      count: 3,
      acceptedCandidateTypes: ["user", "feedback"],
    });
    expect(result.summary).toContain("profileUpdates=3");
    expect(manager.getProfileStateEntry("identity.name", { scope: "user" })).toMatchObject({
      value: "小星",
    });
    expect(manager.getProfileStateEntry("preferences.response_style", { scope: "user" })).toMatchObject({
      value: "先给结论，再展开证据",
    });
    expect(manager.getProfileStateEntry("workstyle.planning_preference", { scope: "user" })).toMatchObject({
      value: "先列计划，再推进实现",
    });

    extractionSpy.mockRestore();
  });

  it("does not overwrite an existing profile state value when durable extraction produces a conflicting patch", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      evolutionEnabled: true,
      evolutionModel: "test-evolution-model",
      evolutionBaseUrl: "https://example.invalid/v1",
      evolutionApiKey: "test-evolution-key",
      evolutionMinMessages: 2,
    });
    manager.upsertProfileStateEntry({
      scope: "user",
      path: "preferences.response_style",
      value: "先给结论，再展开证据",
      createdBy: "seed",
    });

    const extractionSpy = vi.spyOn(manager as any, "callLLMForExtraction").mockResolvedValue([
      {
        type: "偏好",
        category: "preference",
        candidateType: "user",
        content: "用户希望解释越详细越好。",
        reason: "与现有画像冲突",
        profilePath: "preferences.response_style",
        profileValue: "先完整展开细节，再给结论",
      },
    ]);

    const result = await manager.extractMemoriesFromConversation("conv-profile-state-conflict", [
      { role: "user", content: "请记住我的偏好。" },
      { role: "assistant", content: "我会尝试更新 durable profile state。" },
    ]);

    expect(result.count).toBe(1);
    expect(result.summary).toContain("profileConflicts=1");
    expect(manager.getProfileStateEntry("preferences.response_style", { scope: "user" })).toMatchObject({
      value: "先给结论，再展开证据",
    });

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
[{"type":"偏好","category":"preference","candidateType":"user","content":"用户默认希望使用简体中文交流。","reason":"长期沟通偏好","profilePath":"preferences.communication_style","profileValue":"默认使用简体中文交流"}]`,
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
        profilePath: "preferences.communication_style",
        profileValue: "默认使用简体中文交流",
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

  it("records invalid embedding results and advances healthy chunks without retrying the failed prefix", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      embeddingBatchSize: 2,
    });

    const store = (manager as any).store;
    const embed = vi.fn(async () => [0.1, 0.2]);
    const embedBatch = vi.fn(async (texts: string[]) => texts.map((text) => (
      text.includes("poison embedding") ? [Number.NaN, 0.2] : [0.1, 0.2]
    )));
    (manager as any).embeddingProvider = {
      modelName: "response-validation-test",
      dimension: 2,
      embed,
      embedBatch,
    };

    for (const [id, content] of [
      ["embedding-poison", "poison embedding"],
      ["embedding-healthy-one", "healthy embedding one"],
      ["embedding-healthy-two", "healthy embedding two"],
    ]) {
      store.upsertChunk({
        id,
        sourcePath: path.join(docsDir, `${id}.md`),
        sourceType: "file",
        memoryType: "working",
        content,
      });
    }

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await (manager as any).processPendingEmbeddings();

      expect(embed).not.toHaveBeenCalled();
      expect(embedBatch).toHaveBeenCalledTimes(2);
      expect(store.getChunkVector("embedding-poison")).toBeNull();
      expect(store.getChunkVector("embedding-healthy-one")).toEqual([
        expect.closeTo(0.1, 5),
        expect.closeTo(0.2, 5),
      ]);
      expect(store.getChunkVector("embedding-healthy-two")).toEqual([
        expect.closeTo(0.1, 5),
        expect.closeTo(0.2, 5),
      ]);
      expect(store.getVectorStatus().cached).toBe(2);
      const failureScope = (manager as any).computeEmbeddingFailureScope();
      const ledger = (manager as any).embeddingFailureLedger;
      expect(ledger.getRecord(failureScope, "embedding-poison")).toMatchObject({
        failureCount: 1,
        lastFailureReason: "invalid_response",
        nextRetryAt: expect.any(Number),
      });
      const warningOutput = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(warningOutput).not.toContain("zero-progress batch");
      expect(warningOutput).not.toContain("poison embedding");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("derives an undeclared provider dimension from the first real passage batch", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
    });

    const store = (manager as any).store;
    store.upsertChunk({
      id: "embedding-derived-dimension",
      sourcePath: path.join(docsDir, "embedding-derived-dimension.md"),
      sourceType: "file",
      memoryType: "working",
      content: "derive dimensions from passage",
    });
    const embed = vi.fn(async () => [0.1, 0.2]);
    const embedBatch = vi.fn(async () => [[0.1, 0.2]]);
    (manager as any).embeddingProvider = {
      modelName: "undeclared-dimension-test",
      embed,
      embedBatch,
    };

    await (manager as any).processPendingEmbeddings();

    expect(embed).not.toHaveBeenCalled();
    expect(embedBatch).toHaveBeenCalledWith(
      ["derive dimensions from passage"],
      { signal: undefined },
    );
    expect(store.getChunkVector("embedding-derived-dimension")).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
    ]);
  });

  it("stops failed embedding requests without logging provider errors or passage content", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
    });

    const store = (manager as any).store;
    store.upsertChunk({
      id: "embedding-failed-request",
      sourcePath: path.join(docsDir, "embedding-failed-request.md"),
      sourceType: "file",
      memoryType: "working",
      content: "private passage marker",
    });
    (manager as any).embeddingProvider = {
      modelName: "failed-request-test",
      dimension: 2,
      embed: async () => [0.1, 0.2],
      embedBatch: async () => {
        throw new Error("provider error marker");
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await (manager as any).processPendingEmbeddings();

      expect(store.getChunkVector("embedding-failed-request")).toBeNull();
      expect(store.getVectorStatus().cached).toBe(0);
      const warningOutput = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(warningOutput).toContain("Embedding batch request failed");
      expect(warningOutput).not.toContain("private passage marker");
      expect(warningOutput).not.toContain("provider error marker");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not write a partial embedding response to vec0 or cache", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      embeddingBatchSize: 2,
    });

    const store = (manager as any).store;
    for (const id of ["embedding-partial-one", "embedding-partial-two"]) {
      store.upsertChunk({
        id,
        sourcePath: path.join(docsDir, `${id}.md`),
        sourceType: "file",
        memoryType: "working",
        content: id,
      });
    }
    const embedBatch = vi.fn(async () => [[0.1, 0.2]]);
    (manager as any).embeddingProvider = {
      modelName: "partial-response-test",
      dimension: 2,
      embed: async () => [0.1, 0.2],
      embedBatch,
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await (manager as any).processPendingEmbeddings();

      expect(embedBatch).toHaveBeenCalledTimes(1);
      expect(store.getChunkVector("embedding-partial-one")).toBeNull();
      expect(store.getChunkVector("embedding-partial-two")).toBeNull();
      expect(store.getVectorStatus().cached).toBe(0);
      const warningOutput = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(warningOutput).toContain("expected=2, received=1, failed=2");
      expect(warningOutput).toContain("zero-progress batch");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("persists a failed chunk backoff across restart without blocking later chunks", async () => {
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      embeddingBatchSize: 1,
    });

    const firstStore = (manager as any).store;
    firstStore.upsertChunk({
      id: "embedding-backoff-poison",
      sourcePath: path.join(docsDir, "embedding-backoff-poison.md"),
      sourceType: "file",
      memoryType: "working",
      content: "poison before restart",
    });
    const firstEmbedBatch = vi.fn(async () => [[Number.NaN, 0.2]]);
    (manager as any).embeddingProvider = {
      modelName: "persistent-backoff-test",
      dimension: 2,
      embed: async () => [0.1, 0.2],
      embedBatch: firstEmbedBatch,
    };

    await (manager as any).processPendingEmbeddings();
    expect(firstEmbedBatch).toHaveBeenCalledTimes(1);
    expect(firstStore.getChunkVector("embedding-backoff-poison")).toBeNull();

    await manager.close();
    manager = createManager({
      workspaceRoot: docsDir,
      stateDir,
      embeddingBatchSize: 1,
    });
    const secondStore = (manager as any).store;
    secondStore.upsertChunk({
      id: "embedding-backoff-healthy",
      sourcePath: path.join(docsDir, "embedding-backoff-healthy.md"),
      sourceType: "file",
      memoryType: "working",
      content: "healthy after restart",
    });
    const secondEmbedBatch = vi.fn(async () => [[0.1, 0.2]]);
    (manager as any).embeddingProvider = {
      modelName: "persistent-backoff-test",
      dimension: 2,
      embed: async () => [0.1, 0.2],
      embedBatch: secondEmbedBatch,
    };

    await (manager as any).processPendingEmbeddings();

    expect(secondEmbedBatch).toHaveBeenCalledTimes(1);
    expect(secondEmbedBatch).toHaveBeenCalledWith(["healthy after restart"], { signal: undefined });
    expect(secondStore.getChunkVector("embedding-backoff-poison")).toBeNull();
    expect(secondStore.getChunkVector("embedding-backoff-healthy")).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
    ]);
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
