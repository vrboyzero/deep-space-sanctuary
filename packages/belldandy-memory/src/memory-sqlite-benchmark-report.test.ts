import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("B00 Memory SQLite benchmark reports fixture scale and reproducible statistics without thresholds", async () => {
  // 通过公开 runner 的报告构造器固定 benchmark 契约，避免把性能数值变成脆弱的测试阈值。
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-memory-sqlite-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createMemorySqliteBenchmarkReport({
    generatedAt: "2026-07-18T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "test-release",
      nodeVersion: "v22.12.0",
      packageManager: "pnpm@10.23.0",
      cpuModel: "fixture-cpu",
      logicalCpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
      betterSqlite3Version: "11.9.1",
      ci: false,
    },
    source: {
      commit: "fixture-commit",
      workspaceDirty: true,
      lockfileSha256: "fixture-lock-hash",
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      chunkCount: 2_000,
      chunkContentBytes: 512,
      generatedContentBytes: 1_024_000,
      vectorDimensions: 16,
      vectorBatchSize: 64,
      vectorIndexedCount: 2_000,
      embeddingCacheEntryCount: 2_000,
      seedDurationMs: 42.5,
      storage: {
        databaseBytes: 1_500_000,
        walBytes: 0,
        shmBytes: 0,
        totalBytes: 1_500_000,
        pageCount: 366,
        freelistCount: 0,
      },
    },
    scenarios: [
      {
        id: "keyword_search_common",
        operation: "MemoryStore.searchKeyword",
        resultCount: 10,
        samplesMs: [10, 11, 12, 13, 14],
      },
      {
        id: "keyword_search_filtered",
        operation: "MemoryStore.searchKeyword",
        resultCount: 10,
        samplesMs: [5, 6, 7, 8, 9],
      },
      {
        id: "vector_batch_write",
        operation: "MemoryStore.upsertChunkVectorsBatch",
        resultCount: 64,
        samplesMs: [20, 21, 22, 23, 24],
      },
      {
        id: "vector_batch_read_900",
        operation: "MemoryStore.getChunkVectors",
        resultCount: 900,
        samplesMs: [30, 31, 32, 33, 34],
        queryDiagnostics: {
          candidateCount: 900,
          logicalStatementCount: 1,
          queryPlan: ["SEARCH c USING INDEX sqlite_autoindex_chunks_1 (id=?)"],
        },
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "memory-sqlite-store-operations",
      mode: "report_only",
      executionMode: "warm_in_process",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      chunkCount: 2_000,
      chunkContentBytes: 512,
      generatedContentBytes: 1_024_000,
      vectorDimensions: 16,
      vectorBatchSize: 64,
      vectorIndexedCount: 2_000,
      embeddingCacheEntryCount: 2_000,
      storage: {
        totalBytes: 1_500_000,
      },
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios[0].summary).toEqual({
    unit: "milliseconds",
    sampleCount: 5,
    min: 10,
    max: 14,
    mean: 12,
    median: 12,
    p95: 14,
    variance: 2,
    standardDeviation: 1.414,
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  });
  expect(report.scenarios[1].summary).toMatchObject({
    sampleCount: 5,
    median: 7,
    p95: 9,
  });
  expect(report.scenarios[2]).toMatchObject({
    operation: "MemoryStore.upsertChunkVectorsBatch",
    resultCount: 64,
  });
  expect(report.scenarios[3]).toMatchObject({
    operation: "MemoryStore.getChunkVectors",
    resultCount: 900,
    queryDiagnostics: {
      candidateCount: 900,
      logicalStatementCount: 1,
      queryPlan: ["SEARCH c USING INDEX sqlite_autoindex_chunks_1 (id=?)"],
    },
  });
});

test("root exposes a tsx-backed Memory SQLite benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:memory-sqlite"])
    .toBe("node --import tsx scripts/run-memory-sqlite-benchmark.mjs");
});

test("Memory SQLite benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-memory-sqlite-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseMemorySqliteBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
    "--chunk-count",
    "64",
  ])).toMatchObject({
    sampleRuns: 2,
    chunkCount: 64,
  });
});
