import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const operations = [
  "MCPClient.connect+discover",
  "MCPClient.callTool",
  "MCPClient.readResource",
  "MCPClient.disconnect",
];

function createScenarios() {
  return operations.map((operation, index) => ({
    id: `mcp_${index}_catalog_2`,
    operation,
    catalogSize: 2,
    toolCount: 2,
    resourceCount: 2,
    operationsPerSample: operation === "MCPClient.callTool" || operation === "MCPClient.readResource" ? 10 : 1,
    samplesMs: [index + 1, index + 2, index + 3, index + 4, index + 5],
  }));
}

test("B00 MCP benchmark reports complete in-memory lifecycle statistics without thresholds", async () => {
  // 报告测试只固定规模、阶段和结果计数，实际耗时由独立 runner 在本机采集。
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-mcp-in-memory-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createMcpInMemoryBenchmarkReport({
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
      mcpPackageVersion: "0.0.0",
      mcpSdkVersion: "1.29.0",
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
      callOperationsPerSample: 10,
      catalogSizes: [2],
      payloadBytes: 256,
    },
    scenarios: createScenarios(),
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "mcp-client-in-memory-lifecycle",
      mode: "report_only",
      adapter: "sdk_in_memory_linked_pair",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      callOperationsPerSample: 10,
      catalogSizes: [2],
      payloadBytes: 256,
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios[0].summary).toEqual({
    unit: "milliseconds_per_operation",
    sampleCount: 5,
    min: 1,
    max: 5,
    mean: 3,
    median: 3,
    p95: 5,
    variance: 2,
    standardDeviation: 1.414,
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  });
  expect(report.scenarios[2]).toMatchObject({
    operation: "MCPClient.readResource",
    catalogSize: 2,
    toolCount: 2,
    resourceCount: 2,
    operationsPerSample: 10,
  });
});

test("MCP benchmark rejects an incomplete lifecycle matrix", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-mcp-in-memory-benchmark.mjs")).href,
  );

  expect(() => benchmarkModule.createMcpInMemoryBenchmarkReport({
    generatedAt: "2026-07-18T00:00:00.000Z",
    environment: {},
    source: {},
    fixture: {
      warmupRuns: 0,
      sampleRuns: 5,
      callOperationsPerSample: 10,
      catalogSizes: [2],
      payloadBytes: 256,
    },
    scenarios: createScenarios().slice(0, 3),
  })).toThrow("Each catalog size requires every MCP lifecycle operation exactly once.");
});

test("MCP benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-mcp-in-memory-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseMcpInMemoryBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
    "--call-operations-per-sample",
    "4",
  ])).toMatchObject({
    sampleRuns: 2,
    callOperationsPerSample: 4,
  });
});

test("root exposes a tsx-backed MCP in-memory benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:mcp-in-memory"])
    .toBe("node --import tsx scripts/run-mcp-in-memory-benchmark.mjs");
});
