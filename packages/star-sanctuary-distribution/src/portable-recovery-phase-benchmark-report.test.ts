import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const largestFileBytes = 16_777_216;
const totalBytes = 67_108_864;

type PhaseDefinition = {
  id: string;
  kind: "control" | "isolated" | "combined";
  integrityEvidence: string;
};

function createSample(
  index: number,
  maxRssIncreaseBytes: number,
  integrityEvidence: string,
  streamBoundaryIncreaseBytes?: number,
) {
  const rssBeforeBytes = 50_000_000 + index;
  const rssAfterBytes = 51_000_000 + index;
  const maxRssBeforeBytes = 80_000_000;
  const externalBeforeBytes = 2_000_000;
  const externalAfterBytes = 2_500_000 + index;
  const arrayBuffersBeforeBytes = 1_000_000;
  const arrayBuffersAfterBytes = 1_250_000 + index;
  return {
    durationMs: 10 + index,
    processedBytes: totalBytes,
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
    integrityEvidence,
    ...(streamBoundaryIncreaseBytes === undefined
      ? {}
      : {
          boundaries: {
            afterStream: {
              maxRssAfterBytes: maxRssBeforeBytes + streamBoundaryIncreaseBytes,
              maxRssIncreaseBytes: streamBoundaryIncreaseBytes,
              externalAfterBytes: externalBeforeBytes + 100_000,
              arrayBuffersAfterBytes: arrayBuffersBeforeBytes + 50_000,
            },
            afterPostValidation: {
              maxRssAfterBytes: maxRssBeforeBytes + maxRssIncreaseBytes,
              maxRssIncreaseBytes,
              externalAfterBytes,
              arrayBuffersAfterBytes,
            },
          },
        }),
  };
}

test("D03-S002 phase report fixes fresh-process boundaries and cross-phase attribution", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-portable-recovery-phase-benchmark.mjs")).href,
  );
  const phaseDefinitions = benchmarkModule.portableRecoveryPhaseDefinitions as PhaseDefinition[];
  expect(phaseDefinitions.map((phase) => phase.id)).toEqual([
    "full_recovery_control",
    "metadata_initial_validation",
    "stream_decompress_only",
    "stream_decompress_with_hash",
    "post_validation_fresh",
    "stream_hash_then_post_validation",
  ]);

  const maxRssByPhase: Record<string, number> = {
    full_recovery_control: 32 * 1024 * 1024,
    metadata_initial_validation: 1 * 1024 * 1024,
    stream_decompress_only: 8 * 1024 * 1024,
    stream_decompress_with_hash: 12 * 1024 * 1024,
    post_validation_fresh: 2 * 1024 * 1024,
    stream_hash_then_post_validation: 30 * 1024 * 1024,
  };
  const report = benchmarkModule.createPortableRecoveryPhaseBenchmarkReport({
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
      scenario: {
        id: "large_asset",
        fileCount: 4,
        totalBytes,
        largestFileBytes,
      },
    },
    phases: phaseDefinitions.map((phase) => ({
      ...phase,
      samples: Array.from({ length: 5 }, (_, index) => createSample(
        index,
        maxRssByPhase[phase.id] + (index * 1024),
        phase.integrityEvidence,
        phase.kind === "combined" ? (10 * 1024 * 1024) + (index * 1024) : undefined,
      )),
    })),
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "distribution-portable-recovery-phases",
      mode: "report_only",
      thresholdApplied: false,
      productionPathModified: false,
    },
    fixture: {
      workerIsolation: "fresh_process_per_phase_sample",
      fullControlMinRatio: 1.5,
      ownerShareThreshold: 0.8,
    },
    attribution: {
      reproductionGatePassed: true,
      classification: "cross_phase_or_native_retention",
      primaryPhaseId: "stream_hash_then_post_validation",
    },
  });
  expect(report.phases[0].summary.maxRssToLargestFileRatio.p95).toBeCloseTo(2.000244, 6);
  expect(report.phases[5].summary.maxRssToFullControlRatio.p95).toBeCloseTo(0.937508, 6);
  expect(report.phases[5].summary.boundaries.postValidationAdditionalMaxRssBytes.p95)
    .toBe(20 * 1024 * 1024);
});

test("D03-S002 phase report rejects missing phases and inconsistent combined boundaries", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-portable-recovery-phase-benchmark.mjs")).href,
  );
  const phaseDefinitions = benchmarkModule.portableRecoveryPhaseDefinitions as PhaseDefinition[];
  const commonInput = {
    generatedAt: "2026-07-22T00:00:00.000Z",
    environment: {},
    source: {},
    fixture: {
      warmupRuns: 0,
      sampleRuns: 1,
      scenario: { id: "large_asset", fileCount: 4, totalBytes, largestFileBytes },
    },
  };

  expect(() => benchmarkModule.createPortableRecoveryPhaseBenchmarkReport({
    ...commonInput,
    phases: [],
  })).toThrow(/phases must match/i);

  expect(() => benchmarkModule.createPortableRecoveryPhaseBenchmarkReport({
    ...commonInput,
    phases: phaseDefinitions.map((phase) => ({
      ...phase,
      samples: [createSample(
        0,
        phase.kind === "combined" ? 10 : largestFileBytes * 2,
        phase.integrityEvidence,
        phase.kind === "combined" ? 20 : undefined,
      )],
    })),
  })).toThrow(/boundary/i);
});

test("D03-S002 phase benchmark accepts pnpm separator and has a root command", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-portable-recovery-phase-benchmark.mjs")).href,
  );
  expect(benchmarkModule.parsePortableRecoveryPhaseBenchmarkArgs([
    "--",
    "--sample-runs",
    "2",
  ])).toMatchObject({
    sampleRuns: 2,
  });

  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };
  expect(packageJson.scripts?.["benchmark:portable-recovery-phases"])
    .toBe("node --expose-gc --import tsx scripts/run-portable-recovery-phase-benchmark.mjs");
});
