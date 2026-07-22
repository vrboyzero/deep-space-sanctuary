import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("D02 runtime integrity benchmark reports fixed validation statistics and tamper evidence", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-distribution-integrity-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createDistributionIntegrityBenchmarkReport({
    generatedAt: "2026-07-22T00:00:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      release: "test-release",
      nodeVersion: "v22.12.0",
      cpuModel: "fixture-cpu",
      logicalCpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
      gcExposed: true,
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
      scenarios: [
        { id: "small", fileCount: 8, totalBytes: 1_048_576 },
        { id: "medium", fileCount: 24, totalBytes: 12_582_912 },
        { id: "large", fileCount: 48, totalBytes: 50_331_648 },
      ],
    },
    scenarios: [
      {
        id: "small",
        fileCount: 8,
        totalBytes: 1_048_576,
        samples: [
          { durationMs: 10, rssBeforeBytes: 100, rssAfterBytes: 90, rssDeltaBytes: -10, rssSampledPeakBytes: 100 },
          { durationMs: 11, rssBeforeBytes: 101, rssAfterBytes: 112, rssDeltaBytes: 11, rssSampledPeakBytes: 112 },
          { durationMs: 12, rssBeforeBytes: 102, rssAfterBytes: 114, rssDeltaBytes: 12, rssSampledPeakBytes: 114 },
          { durationMs: 13, rssBeforeBytes: 103, rssAfterBytes: 116, rssDeltaBytes: 13, rssSampledPeakBytes: 116 },
          { durationMs: 14, rssBeforeBytes: 104, rssAfterBytes: 118, rssDeltaBytes: 14, rssSampledPeakBytes: 118 },
        ],
        tamperDetection: "sha256_mismatch",
      },
      {
        id: "medium",
        fileCount: 24,
        totalBytes: 12_582_912,
        samples: [
          { durationMs: 20, rssBeforeBytes: 120, rssAfterBytes: 130, rssDeltaBytes: 10, rssSampledPeakBytes: 130 },
          { durationMs: 21, rssBeforeBytes: 121, rssAfterBytes: 132, rssDeltaBytes: 11, rssSampledPeakBytes: 132 },
          { durationMs: 22, rssBeforeBytes: 122, rssAfterBytes: 134, rssDeltaBytes: 12, rssSampledPeakBytes: 134 },
          { durationMs: 23, rssBeforeBytes: 123, rssAfterBytes: 136, rssDeltaBytes: 13, rssSampledPeakBytes: 136 },
          { durationMs: 24, rssBeforeBytes: 124, rssAfterBytes: 138, rssDeltaBytes: 14, rssSampledPeakBytes: 138 },
        ],
        tamperDetection: "sha256_mismatch",
      },
      {
        id: "large",
        fileCount: 48,
        totalBytes: 50_331_648,
        samples: [
          { durationMs: 30, rssBeforeBytes: 140, rssAfterBytes: 150, rssDeltaBytes: 10, rssSampledPeakBytes: 150 },
          { durationMs: 31, rssBeforeBytes: 141, rssAfterBytes: 152, rssDeltaBytes: 11, rssSampledPeakBytes: 152 },
          { durationMs: 32, rssBeforeBytes: 142, rssAfterBytes: 154, rssDeltaBytes: 12, rssSampledPeakBytes: 154 },
          { durationMs: 33, rssBeforeBytes: 143, rssAfterBytes: 156, rssDeltaBytes: 13, rssSampledPeakBytes: 156 },
          { durationMs: 34, rssBeforeBytes: 144, rssAfterBytes: 158, rssDeltaBytes: 14, rssSampledPeakBytes: 158 },
        ],
        tamperDetection: "sha256_mismatch",
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "distribution-runtime-integrity",
      mode: "report_only",
      thresholdApplied: false,
      validationOwner: "validateInstalledRuntimeVersion",
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      scenarios: [
        { id: "small", fileCount: 8, totalBytes: 1_048_576 },
        { id: "medium", fileCount: 24, totalBytes: 12_582_912 },
        { id: "large", fileCount: 48, totalBytes: 50_331_648 },
      ],
    },
  });
  expect(report.scenarios[0]).toMatchObject({
    id: "small",
    tamperDetection: "sha256_mismatch",
    summary: {
      durationMs: { unit: "milliseconds", median: 12, p95: 14, sampleCount: 5 },
      rssBeforeBytes: { unit: "bytes", median: 102, p95: 104, sampleCount: 5 },
      rssAfterBytes: { unit: "bytes", median: 114, p95: 118, sampleCount: 5 },
      rssDeltaBytes: { unit: "bytes", median: 12, p95: 14, sampleCount: 5 },
      rssSampledPeakBytes: { unit: "bytes", median: 114, p95: 118, sampleCount: 5 },
    },
  });
});

test("D02 runtime integrity benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-distribution-integrity-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseDistributionIntegrityBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("root exposes a GC-enabled D02 runtime integrity benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:distribution-integrity"])
    .toBe("node --expose-gc --import tsx scripts/run-distribution-integrity-benchmark.mjs");
});
