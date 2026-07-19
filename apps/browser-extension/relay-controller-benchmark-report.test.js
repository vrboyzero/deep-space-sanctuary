import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const operations = [
  "RelayConnectionController.lifecycle",
  "RelayConnectionController.message",
  "RelayConnectionController.send",
  "RelayConnectionController.staleEvent",
  "RelayConnectionController.reconnect",
];

function expectedCounters(operation, operationCount) {
  if (operation === "RelayConnectionController.lifecycle") {
    return {
      socketCount: operationCount,
      deliveredMessageCount: 0,
      sentMessageCount: 0,
      listenerAttachCount: operationCount,
      listenerDetachCount: operationCount,
    };
  }
  if (operation === "RelayConnectionController.message") {
    return {
      socketCount: 1,
      deliveredMessageCount: operationCount,
      sentMessageCount: 0,
      listenerAttachCount: 1,
      listenerDetachCount: 1,
    };
  }
  if (operation === "RelayConnectionController.send") {
    return {
      socketCount: 1,
      deliveredMessageCount: 0,
      sentMessageCount: operationCount,
      listenerAttachCount: 1,
      listenerDetachCount: 1,
    };
  }
  if (operation === "RelayConnectionController.staleEvent") {
    return {
      socketCount: 2,
      deliveredMessageCount: 0,
      sentMessageCount: 0,
      listenerAttachCount: 1,
      listenerDetachCount: 1,
    };
  }
  return {
    socketCount: operationCount + 1,
    deliveredMessageCount: 0,
    sentMessageCount: 0,
    listenerAttachCount: 1,
    listenerDetachCount: 1,
  };
}

function createScenarios(operationCount = 10) {
  return operations.map((operation, index) => ({
    id: `relay_${index}_${operationCount}`,
    operation,
    operationCount,
    resultCount: operationCount,
    ...expectedCounters(operation, operationCount),
    pendingTimerCount: 0,
    samplesMs: [index + 1, index + 2, index + 3, index + 4, index + 5],
  }));
}

test("B00 Browser Relay benchmark reports complete fake-WebSocket controller statistics", async () => {
  // 报告契约固定生命周期计数和零残留，不对本机耗时设置脆弱阈值。
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-browser-relay-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createBrowserRelayBenchmarkReport({
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
      browserPackageVersion: "0.0.0",
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
      operationCounts: [10],
      payloadBytes: 256,
    },
    scenarios: createScenarios(),
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "browser-relay-connection-controller",
      mode: "report_only",
      adapter: "in_memory_fake_websocket",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      operationCounts: [10],
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
  expect(report.scenarios[4]).toMatchObject({
    operation: "RelayConnectionController.reconnect",
    operationCount: 10,
    resultCount: 10,
    socketCount: 11,
    listenerAttachCount: 1,
    listenerDetachCount: 1,
    pendingTimerCount: 0,
  });
});

test("Browser Relay benchmark rejects an incomplete controller matrix", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-browser-relay-benchmark.mjs")).href,
  );

  expect(() => benchmarkModule.createBrowserRelayBenchmarkReport({
    generatedAt: "2026-07-18T00:00:00.000Z",
    environment: {},
    source: {},
    fixture: {
      warmupRuns: 0,
      sampleRuns: 5,
      operationCounts: [10],
      payloadBytes: 256,
    },
    scenarios: createScenarios().slice(0, 4),
  })).toThrow("Each operation count requires every Relay controller operation exactly once.");
});

test("Browser Relay benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-browser-relay-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseBrowserRelayBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("root exposes a Browser Relay controller benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8"));

  expect(packageJson.scripts?.["benchmark:browser-relay"])
    .toBe("node scripts/run-browser-relay-benchmark.mjs");
});
