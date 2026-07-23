import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const fixture = {
  warmupRuns: 2,
  sampleRuns: 5,
  sessionArtifactCount: 24,
  sessionArtifactFileCount: 48,
  sessionArtifactBytes: 2048,
  taskCount: 64,
  experienceCount: 250,
  experienceBodyBytes: 10240,
  seedDurationMs: 42.5,
  chainBudgets: {
    session: {
      candidateLimit: 24,
      detailLimit: 48,
      readConcurrency: 4,
      perFileReadByteLimit: 65536,
      readByteLimit: 262144,
      resultLimit: 4,
    },
    task: {
      recentCandidateQueryLimit: 36,
      searchCandidateQueryLimit: 25,
      candidateLimit: 61,
      detailLimit: 61,
      readByteLimit: 0,
      resultLimit: 3,
    },
    experience: {
      candidateLimit: 24,
      detailLimit: 12,
      perDetailReadByteLimit: 8192,
      readByteLimit: 98304,
      resultLimit: 2,
    },
  },
};

function sample(durationMs: number, eventLoopDelayMs: number, sqliteStatementCount: number) {
  return { durationMs, eventLoopDelayMs, sqliteStatementCount };
}

test("derived retrieval benchmark report records warm latency, statement and budget evidence without thresholds", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-memory-derived-retrieval-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createMemoryDerivedRetrievalBenchmarkReport({
    generatedAt: "2026-07-23T00:00:00.000Z",
    environment: { platform: "win32", nodeVersion: "v22.12.0" },
    source: { commit: "fixture-commit", workspaceDirty: true, lockfileSha256: "fixture-lock-hash" },
    fixture,
    scenarios: [
      {
        id: "session_artifact_provider_and_file_reads",
        chain: "session",
        operation: "collectDerivedSessionSearchResults",
        observed: { candidateCount: 24, detailCount: 48, readByteCount: 98304, resultCount: 4 },
        samples: [
          sample(10, 1, 0),
          sample(11, 2, 0),
          sample(12, 1, 0),
          sample(13, 2, 0),
          sample(14, 1, 0),
        ],
      },
      {
        id: "task_recent_search_and_detail_projection",
        chain: "task",
        operation: "MemoryManager.collectDerivedTaskSearchResults",
        observed: { candidateCount: 61, detailCount: 61, readByteCount: 0, resultCount: 3 },
        samples: [
          sample(20, 3, 4),
          sample(21, 3, 4),
          sample(22, 4, 4),
          sample(23, 3, 4),
          sample(24, 4, 4),
        ],
      },
      {
        id: "experience_fts_and_detail_projection",
        chain: "experience",
        operation: "MemoryManager.collectDerivedExperienceSearchResults",
        observed: { candidateCount: 24, detailCount: 12, readByteCount: 24576, resultCount: 2 },
        samples: [
          sample(30, 2, 2),
          sample(31, 2, 2),
          sample(32, 3, 2),
          sample(33, 2, 2),
          sample(34, 3, 2),
        ],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "memory-derived-retrieval",
      mode: "report_only",
      executionMode: "warm_in_process",
      thresholdApplied: false,
    },
    fixture: {
      sessionArtifactCount: 24,
      taskCount: 64,
      experienceCount: 250,
      chainBudgets: fixture.chainBudgets,
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios[0]).toMatchObject({
    observed: { candidateCount: 24, detailCount: 48, resultCount: 4 },
    warmLatencyMs: { p50: 12, p95: 14 },
    eventLoopDelayMs: { p50: 1, p95: 2 },
    sqliteStatementCount: { unit: "statements", p50: 0, p95: 0 },
  });
  expect(report.scenarios[1]?.sqliteStatementCount).toMatchObject({ p50: 4, p95: 4 });
  expect(report.scenarios[2]?.sqliteStatementCount).toMatchObject({ p50: 2, p95: 2 });
});

test("root exposes the tsx-backed derived retrieval benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:memory-derived-retrieval"])
    .toBe("node --import tsx scripts/run-memory-derived-retrieval-benchmark.mjs");
});

test("derived retrieval benchmark accepts pnpm argument separators", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-memory-derived-retrieval-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseMemoryDerivedRetrievalBenchmarkArgs([
    "--",
    "--sample-runs",
    "3",
    "--warmup-runs",
    "0",
  ])).toMatchObject({
    sampleRuns: 3,
    warmupRuns: 0,
  });
});
