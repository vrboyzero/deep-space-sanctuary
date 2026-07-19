import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("B00 Agent mock benchmark reports history and Tool catalog scale without thresholds", async () => {
  // 通过公开 runner 的报告构造器固定 benchmark 契约，避免把本机耗时变成脆弱的测试阈值。
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-agent-mock-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createAgentMockBenchmarkReport({
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
      agentPackageVersion: "0.0.0",
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
      historyEntryBytes: 256,
      historySizes: [10, 100, 1_000],
      systemPromptBytes: 64,
      toolDefinitionCounts: [0],
      toolDefinitionBytesPerItem: 128,
      mockResponseBytes: 32,
    },
    scenarios: [
      {
        id: "history_10",
        historyEntries: 10,
        operation: "ToolEnabledAgent.run",
        toolDefinitionCount: 0,
        toolDefinitionBytes: 0,
        modelCallCount: 1,
        samplesMs: [10, 11, 12, 13, 14],
      },
      {
        id: "history_100",
        historyEntries: 100,
        operation: "ToolEnabledAgent.run",
        toolDefinitionCount: 0,
        toolDefinitionBytes: 0,
        modelCallCount: 1,
        samplesMs: [20, 21, 22, 23, 24],
      },
      {
        id: "history_1000",
        historyEntries: 1_000,
        operation: "ToolEnabledAgent.run",
        toolDefinitionCount: 0,
        toolDefinitionBytes: 0,
        modelCallCount: 1,
        samplesMs: [30, 31, 32, 33, 34],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "tool-agent-mock-run",
      mode: "report_only",
      provider: "strict_local_mock",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      historyEntryBytes: 256,
      historySizes: [10, 100, 1_000],
      toolDefinitionCounts: [0],
      toolDefinitionBytesPerItem: 128,
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
  expect(report.scenarios[2]).toMatchObject({
    historyEntries: 1_000,
    toolDefinitionCount: 0,
    modelCallCount: 1,
  });
});

test("Agent mock benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-agent-mock-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseAgentMockBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("Agent mock benchmark requires every configured history and Tool catalog combination", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-agent-mock-benchmark.mjs")).href,
  );

  expect(() => benchmarkModule.createAgentMockBenchmarkReport({
    generatedAt: "2026-07-18T00:00:00.000Z",
    environment: {},
    source: {},
    fixture: {
      warmupRuns: 0,
      sampleRuns: 1,
      historyEntryBytes: 256,
      historySizes: [10],
      systemPromptBytes: 64,
      toolDefinitionCounts: [0, 10],
      toolDefinitionBytesPerItem: 128,
      mockResponseBytes: 32,
    },
    scenarios: [
      {
        id: "history_10_tools_0",
        historyEntries: 10,
        operation: "ToolEnabledAgent.run",
        toolDefinitionCount: 0,
        toolDefinitionBytes: 2,
        modelCallCount: 1,
        samplesMs: [1],
      },
    ],
  })).toThrow("Each fixed history and Tool catalog combination requires exactly one benchmark scenario.");
});

test("root exposes a tsx-backed Agent mock benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:agent-mock"])
    .toBe("node --import tsx scripts/run-agent-mock-benchmark.mjs");
});
