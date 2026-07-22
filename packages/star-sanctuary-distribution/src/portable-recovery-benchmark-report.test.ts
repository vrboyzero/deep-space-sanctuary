import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function createSample(index: number, maxRssIncreaseBytes: number) {
  const rssBeforeBytes = 50_000_000 + index;
  const rssAfterBytes = 51_000_000 + index;
  const maxRssBeforeBytes = 80_000_000;
  const externalBeforeBytes = 2_000_000;
  const externalAfterBytes = 2_500_000 + index;
  const arrayBuffersBeforeBytes = 1_000_000;
  const arrayBuffersAfterBytes = 1_250_000 + index;
  return {
    durationMs: 10 + index,
    rssBeforeBytes,
    rssAfterBytes,
    rssDeltaBytes: rssAfterBytes - rssBeforeBytes,
    maxRssBeforeBytes,
    maxRssAfterBytes: maxRssBeforeBytes + maxRssIncreaseBytes,
    maxRssIncreaseBytes,
    externalBeforeBytes,
    externalAfterBytes,
    externalDeltaBytes: externalAfterBytes - externalBeforeBytes,
    arrayBuffersBeforeBytes,
    arrayBuffersAfterBytes,
    arrayBuffersDeltaBytes: arrayBuffersAfterBytes - arrayBuffersBeforeBytes,
    recovered: true,
    postValidation: "validated",
  };
}

test("D03 portable recovery benchmark reports fixed peak-memory and integrity evidence", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-portable-recovery-benchmark.mjs")).href,
  );
  const scenarioDefinitions = [
    { id: "many_small", fileCount: 128, totalBytes: 8_388_608, largestFileBytes: 65_536 },
    { id: "large_asset", fileCount: 4, totalBytes: 67_108_864, largestFileBytes: 16_777_216 },
  ];
  const report = benchmarkModule.createPortableRecoveryBenchmarkReport({
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
      scenarios: scenarioDefinitions,
    },
    scenarios: scenarioDefinitions.map((definition) => ({
      ...definition,
      samples: Array.from({ length: 5 }, (_, index) => createSample(
        index,
        definition.largestFileBytes + (index * 1_048_576),
      )),
    })),
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "distribution-portable-recovery",
      mode: "report_only",
      thresholdApplied: false,
      recoveryOwner: "ensurePortableRuntime",
      seaEvidence: {
        status: "not_measured",
        constraint: "getRawAsset_returns_whole_array_buffer",
      },
    },
    fixture: {
      warmupRuns: 1,
      sampleRuns: 5,
      workerIsolation: "fresh_process_per_sample",
      scenarios: scenarioDefinitions,
    },
  });
  expect(report.scenarios[0]).toMatchObject({
    id: "many_small",
    summary: {
      durationMs: { unit: "milliseconds", median: 12, p95: 14, sampleCount: 5 },
      maxRssIncreaseBytes: { unit: "bytes", sampleCount: 5 },
      maxRssToLargestFileRatio: { unit: "ratio", sampleCount: 5 },
      throughputBytesPerSecond: { unit: "bytes_per_second", sampleCount: 5 },
      externalDeltaBytes: { unit: "bytes", sampleCount: 5 },
      arrayBuffersDeltaBytes: { unit: "bytes", sampleCount: 5 },
    },
    integrityEvidence: "validated_after_recovery",
  });
  expect(report.scenarios[1].summary.maxRssToLargestFileRatio.p95).toBe(1.25);
});

test("D03 portable recovery benchmark accepts pnpm's argument separator", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-portable-recovery-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parsePortableRecoveryBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });
});

test("root exposes a GC-enabled D03 portable recovery benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:portable-recovery"])
    .toBe("node --expose-gc --import tsx scripts/run-portable-recovery-benchmark.mjs");
});
