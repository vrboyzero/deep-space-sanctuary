import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("D04 startup orchestration benchmark records fixed phase statistics and fake invocation counts", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-gateway-startup-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createGatewayStartupBenchmarkReport({
    generatedAt: "2026-07-22T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "test-release",
      nodeVersion: "v22.12.0",
      cpuModel: "fixture-cpu",
      logicalCpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
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
      envFilesPreexisting: 2,
      port: 29999,
      usesRealPowerShell: false,
      usesRealChildProcess: false,
    },
    scenarios: [
      {
        id: "launch_config",
        operation: "createGatewayLaunchConfig",
        samplesMs: [1, 2, 3, 4, 5],
        invocationCounts: [0, 0, 0, 0, 0],
      },
      {
        id: "preflight_fake_runner",
        operation: "preflightGatewayCleanup",
        samplesMs: [10, 11, 12, 13, 14],
        invocationCounts: [1, 1, 1, 1, 1],
      },
      {
        id: "lifecycle_fake_launch",
        operation: "createGatewaySupervisorLifecycle.start",
        samplesMs: [20, 21, 22, 23, 24],
        invocationCounts: [1, 1, 1, 1, 1],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "distribution-gateway-startup-orchestration",
      mode: "report_only",
      thresholdApplied: false,
      usesRealPowerShell: false,
      usesRealChildProcess: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      envFilesPreexisting: 2,
      port: 29999,
    },
  });
  expect(report.scenarios[1]).toMatchObject({
    id: "preflight_fake_runner",
    invocationCounts: [1, 1, 1, 1, 1],
    invocationSummary: { unit: "count", median: 1, p95: 1, sampleCount: 5 },
    summary: { unit: "milliseconds", median: 12, p95: 14, sampleCount: 5 },
  });
});

test("D04 startup orchestration benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-gateway-startup-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseGatewayStartupBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("root exposes the fake-only D04 startup orchestration benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:gateway-startup"])
    .toBe("node --import tsx scripts/run-gateway-startup-benchmark.mjs");
});
