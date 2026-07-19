import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function createStartupScenario(cacheMode) {
  return {
    id: `startup_${cacheMode}`,
    kind: "startup",
    target: "full_shell",
    cacheMode,
    operationCount: 1,
    samples: [1, 2, 3, 4, 5].map((durationMs) => ({
      durationMs,
      resourceCount: 25,
      transferSizeBytes: cacheMode === "cold" ? 10_000 : 0,
      decodedBodySizeBytes: 20_000,
      startupMarkCount: 8,
      domNodeCount: 2_500,
      assetGlobalCount: 3,
      appBootstrapReady: true,
      appShellPresent: true,
      pageErrorCount: 0,
    })),
  };
}

function createRenderScenario(messageCount) {
  return {
    id: `render_${messageCount}`,
    kind: "render",
    messageCount,
    resultCount: messageCount,
    wrapperCount: messageCount,
    assistantBodyCount: Math.floor(messageCount / 2),
    samples: [1, 2, 3, 4, 5].map((durationMs) => ({
      durationMs,
      syncDurationMs: durationMs / 2,
      heapDeltaBytes: durationMs * 1_000,
      domNodeCount: messageCount * 10,
    })),
  };
}

function createInputScenarios() {
  return [
    createStartupScenario("cold"),
    createStartupScenario("hot"),
    createRenderScenario(100),
    createRenderScenario(1_000),
  ];
}

test("B00 WebChat benchmark reports a complete cold/hot and fixed-render fixture", async () => {
  // 报告只保留规模、资源和耗时数字，不记录消息正文、URL 或页面内容。
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-webchat-fixed-fixture-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createWebchatFixedFixtureBenchmarkReport({
    generatedAt: "2026-07-18T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      nodeVersion: "v22.12.0",
      packageManager: "pnpm@10.23.0",
      browserVersion: "Chrome/fixture",
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
      messageCounts: [100, 1_000],
      messageBytes: 256,
      viewport: { width: 1_280, height: 720 },
      startupTarget: "full_webchat_shell",
      minimumStartupResourceCount: 10,
      renderModuleResourceCount: 3,
    },
    scenarios: createInputScenarios(),
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "webchat-fixed-fixture",
      mode: "report_only",
      adapter: "headless_chromium_loopback_fixture",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      messageCounts: [100, 1_000],
      messageBytes: 256,
      startupTarget: "full_webchat_shell",
      minimumStartupResourceCount: 10,
      renderModuleResourceCount: 3,
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios).toHaveLength(4);
  expect(report.scenarios[0].summary).toEqual({
    unit: "milliseconds_per_fixture",
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
  expect(report.scenarios[3]).toMatchObject({
    id: "render_1000",
    kind: "render",
    messageCount: 1_000,
    resultCount: 1_000,
    wrapperCount: 1_000,
    assistantBodyCount: 500,
  });
});

test("WebChat benchmark rejects an incomplete startup/render matrix", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-webchat-fixed-fixture-benchmark.mjs")).href,
  );

  expect(() => benchmarkModule.createWebchatFixedFixtureBenchmarkReport({
    generatedAt: "2026-07-18T00:00:00.000Z",
    environment: {},
    source: {},
    fixture: {
      warmupRuns: 0,
      sampleRuns: 5,
      messageCounts: [100, 1_000],
      messageBytes: 256,
      viewport: { width: 1_280, height: 720 },
      startupTarget: "full_webchat_shell",
      minimumStartupResourceCount: 10,
      renderModuleResourceCount: 3,
    },
    scenarios: createInputScenarios().slice(0, 3),
  })).toThrow("WebChat fixture requires cold/hot startup and every configured render scale exactly once.");
});

test("WebChat benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-webchat-fixed-fixture-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseWebchatFixedFixtureBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("root exposes a WebChat fixed-fixture benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8"));

  expect(packageJson.scripts?.["benchmark:webchat-fixture"])
    .toBe("node scripts/run-webchat-fixed-fixture-benchmark.mjs");
});
