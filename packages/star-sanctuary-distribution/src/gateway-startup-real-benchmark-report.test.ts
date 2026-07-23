import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("D04 real-process benchmark records isolated PowerShell and child cleanup evidence", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-gateway-startup-real-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createGatewayStartupRealBenchmarkReport({
    generatedAt: "2026-07-23T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "test-release",
      nodeVersion: "v22.14.0",
      powerShellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      powerShellVersion: "5.1.0",
    },
    source: {
      commit: "fixture-commit",
      workspaceDirty: true,
      lockfileSha256: "fixture-lock-hash",
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 3,
      port: 29999,
      usesRealPowerShell: true,
      usesRealChildProcess: true,
      startsGateway: false,
      opensListeningPort: false,
    },
    scenarios: [
      {
        id: "preflight_real_powershell",
        operation: "preflightGatewayCleanup",
        samplesMs: [10, 11, 12],
        invocationCounts: [1, 1, 1],
        cleanupStatuses: ["not_required", "not_required", "not_required"],
      },
      {
        id: "child_real_launch_cleanup",
        operation: "spawn node benchmark child",
        samplesMs: [20, 21, 22],
        invocationCounts: [1, 1, 1],
        cleanupStatuses: ["cleaned", "cleaned", "cleaned"],
        childPids: [101, 102, 103],
        childExitCodes: [0, 0, 0],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "distribution-gateway-startup-real-process",
      mode: "report_only",
      executionMode: "isolated_real_process",
      thresholdApplied: false,
    },
    fixture: {
      usesRealPowerShell: true,
      usesRealChildProcess: true,
      startsGateway: false,
      opensListeningPort: false,
    },
  });
  expect(report.scenarios[0]).toMatchObject({
    id: "preflight_real_powershell",
    invocationSummary: { unit: "count", median: 1, p95: 1, sampleCount: 3 },
    cleanupStatuses: ["not_required", "not_required", "not_required"],
  });
  expect(report.scenarios[1]).toMatchObject({
    id: "child_real_launch_cleanup",
    summary: { unit: "milliseconds", median: 21, p95: 22, sampleCount: 3 },
    cleanupStatuses: ["cleaned", "cleaned", "cleaned"],
    childPids: [101, 102, 103],
    childExitCodes: [0, 0, 0],
  });
});

test("D04 real-process benchmark accepts pnpm argument separators", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-gateway-startup-real-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseGatewayStartupRealBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("D04 real-process benchmark records a verified zero PowerShell invocation after an availability bypass", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-gateway-startup-real-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createGatewayStartupRealBenchmarkReport({
    generatedAt: "2026-07-23T00:00:00.000Z",
    environment: { platform: "win32" },
    source: { commit: "fixture-commit", lockfileSha256: "fixture-lock-hash" },
    fixture: {
      warmupRuns: 0,
      sampleRuns: 1,
      port: 29999,
      usesRealPowerShell: true,
      usesRealChildProcess: true,
      startsGateway: false,
      opensListeningPort: false,
    },
    scenarios: [
      {
        id: "preflight_real_powershell",
        operation: "preflightGatewayCleanup",
        samplesMs: [1],
        invocationCounts: [0],
        cleanupStatuses: ["not_required"],
      },
      {
        id: "child_real_launch_cleanup",
        operation: "spawn node benchmark child",
        samplesMs: [2],
        invocationCounts: [1],
        cleanupStatuses: ["cleaned"],
        childPids: [101],
        childExitCodes: [0],
      },
    ],
  });

  expect(report.scenarios[0]).toMatchObject({
    invocationCounts: [0],
    invocationSummary: { median: 0, p95: 0 },
  });
});

test("root exposes the real-only D04 startup benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:gateway-startup-real"])
    .toBe("node --import tsx scripts/run-gateway-startup-real-benchmark.mjs");
});
