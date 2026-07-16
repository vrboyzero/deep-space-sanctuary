import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("B00 build benchmark reports reproducible statistics without enforcing performance thresholds", async () => {
  // Import the public script module dynamically so the test exercises the same report builder as the CLI.
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-build-benchmark.mjs")).href
  );
  const report = benchmarkModule.createBuildBenchmarkReport({
    generatedAt: "2026-07-15T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "test-release",
      nodeVersion: "v22.12.0",
      typescriptVersion: "5.9.3",
      packageManager: "pnpm@10.23.0",
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
      projectCount: 12,
    },
    scenarios: [
      {
        id: "forced_rebuild",
        command: ["node", "node_modules/typescript/bin/tsc", "-b", "--force"],
        samplesMs: [100, 110, 120, 130, 140],
      },
      {
        id: "incremental_noop",
        command: ["node", "node_modules/typescript/bin/tsc", "-b"],
        samplesMs: [5, 6, 7, 8, 9],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "workspace-typescript-build",
      mode: "report_only",
      thresholdApplied: false,
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      projectCount: 12,
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios[0].summary).toEqual({
    unit: "milliseconds",
    sampleCount: 5,
    min: 100,
    max: 140,
    mean: 120,
    median: 120,
    p95: 140,
    variance: 200,
    standardDeviation: 14.142,
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  });
  expect(report.scenarios[1].summary).toMatchObject({
    sampleCount: 5,
    median: 7,
    p95: 9,
  });
});
