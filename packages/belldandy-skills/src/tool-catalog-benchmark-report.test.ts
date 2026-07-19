import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("B00 Tool catalog benchmark reports real executor scan scale without thresholds", async () => {
  // 通过 runner 的报告构造器固定 catalog 规模与结果计数，不把本机耗时写成测试阈值。
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-tool-catalog-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createToolCatalogBenchmarkReport({
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
      skillsPackageVersion: "0.0.0",
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
      operationsPerSample: 25,
      toolDefinitionCounts: [10, 100],
    },
    scenarios: [
      {
        id: "tool_catalog_10",
        operation: "ToolExecutor.getDefinitions",
        toolDefinitionCount: 10,
        toolDefinitionBytes: 1_000,
        catalogGeneration: 10,
        resultCount: 10,
        samplesMs: [0.1, 0.2, 0.3, 0.4, 0.5],
      },
      {
        id: "tool_catalog_100",
        operation: "ToolExecutor.getDefinitions",
        toolDefinitionCount: 100,
        toolDefinitionBytes: 10_000,
        catalogGeneration: 100,
        resultCount: 100,
        samplesMs: [1, 2, 3, 4, 5],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "tool-executor-catalog-scan",
      mode: "report_only",
      executor: "real_tool_executor",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      operationsPerSample: 25,
      toolDefinitionCounts: [10, 100],
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios[0].summary).toEqual({
    unit: "milliseconds_per_operation",
    sampleCount: 5,
    min: 0.1,
    max: 0.5,
    mean: 0.3,
    median: 0.3,
    p95: 0.5,
    variance: 0.02,
    standardDeviation: 0.141,
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  });
  expect(report.scenarios[1]).toMatchObject({
    toolDefinitionCount: 100,
    toolDefinitionBytes: 10_000,
    catalogGeneration: 100,
    resultCount: 100,
  });
});

test("Tool catalog benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-tool-catalog-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseToolCatalogBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
    "--operations-per-sample",
    "10",
  ])).toMatchObject({
    sampleRuns: 2,
    operationsPerSample: 10,
  });
});

test("root exposes a tsx-backed Tool catalog benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:tool-catalog"])
    .toBe("node --import tsx scripts/run-tool-catalog-benchmark.mjs");
});
