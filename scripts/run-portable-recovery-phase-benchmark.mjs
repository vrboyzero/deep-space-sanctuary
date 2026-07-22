import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { ensurePortableRuntime } from "../packages/star-sanctuary-distribution/src/portable-runtime.ts";
import {
  readPortableVersionFile,
  readRuntimeManifest,
  validateInstalledRuntimeVersion,
} from "../packages/star-sanctuary-distribution/src/runtime-manifest.ts";
import {
  createPortableRecoveryFixture,
  portableRecoveryScenarioDefinitions,
} from "./run-portable-recovery-benchmark.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const defaultOutput = "artifacts/benchmarks/p2-d03-portable-recovery-phases.json";
const workerResultPrefix = "D03_PORTABLE_RECOVERY_PHASE_WORKER_RESULT ";
const fullControlMinRatio = 1.5;
const ownerShareThreshold = 0.8;

const largeAssetScenario = portableRecoveryScenarioDefinitions.find(
  (definition) => definition.id === "large_asset",
);
if (!largeAssetScenario) {
  throw new Error("The portable recovery benchmark is missing the large_asset scenario.");
}

export const portableRecoveryPhaseDefinitions = [
  {
    id: "full_recovery_control",
    kind: "control",
    integrityEvidence: "validated_after_recovery",
  },
  {
    id: "metadata_initial_validation",
    kind: "isolated",
    integrityEvidence: "missing_runtime_detected_from_valid_metadata",
  },
  {
    id: "stream_decompress_only",
    kind: "isolated",
    integrityEvidence: "decompressed_sizes_match_manifest",
  },
  {
    id: "stream_decompress_with_hash",
    kind: "isolated",
    integrityEvidence: "decompressed_hashes_match_manifest",
  },
  {
    id: "post_validation_fresh",
    kind: "isolated",
    integrityEvidence: "prepared_runtime_validated",
  },
  {
    id: "stream_hash_then_post_validation",
    kind: "combined",
    integrityEvidence: "stream_hash_and_post_validation_validated",
  },
];

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseCount(value, label, { allowZero = false } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

export function parsePortableRecoveryPhaseBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === "--output") {
      args.output = value;
    } else if (argument === "--warmup-runs") {
      args.warmupRuns = parseCount(value, argument, { allowZero: true });
    } else if (argument === "--sample-runs") {
      args.sampleRuns = parseCount(value, argument);
    } else {
      throw new Error(`Unsupported argument ${argument}.`);
    }
  }
  return args;
}

function summarizeSamples(samples, unit, digits = 3) {
  const sorted = [...samples].sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sampleCount;
  const variance = sorted.reduce(
    (total, sample) => total + ((sample - mean) ** 2),
    0,
  ) / sampleCount;
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sampleCount) - 1)];
  return {
    unit,
    sampleCount,
    min: round(sorted[0], digits),
    max: round(sorted[sampleCount - 1], digits),
    mean: round(mean, digits),
    median: round(percentile(0.5), digits),
    p95: round(percentile(0.95), digits),
    variance: round(variance, digits),
    standardDeviation: round(Math.sqrt(variance), digits),
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  };
}

function requireFiniteNumber(value, label, { allowNegative = false, allowZero = true } = {}) {
  if (!Number.isFinite(value) || (!allowNegative && value < 0) || (!allowZero && value === 0)) {
    throw new Error(`${label} must be a finite ${allowNegative ? "" : "non-negative "}number.`);
  }
}

function requireMemoryBoundary(boundary, sample, label, expectedFinal) {
  for (const field of [
    "maxRssAfterBytes",
    "maxRssIncreaseBytes",
    "externalAfterBytes",
    "arrayBuffersAfterBytes",
  ]) {
    requireFiniteNumber(boundary?.[field], `${label}.${field}`);
  }
  if (boundary.maxRssIncreaseBytes !== Math.max(0, boundary.maxRssAfterBytes - sample.maxRssBeforeBytes)) {
    throw new Error(`${label} contains an inconsistent maxRSS boundary.`);
  }
  if (expectedFinal && (
    boundary.maxRssAfterBytes !== sample.maxRssAfterBytes
    || boundary.maxRssIncreaseBytes !== sample.maxRssIncreaseBytes
    || boundary.externalAfterBytes !== sample.externalAfterBytes
    || boundary.arrayBuffersAfterBytes !== sample.arrayBuffersAfterBytes
  )) {
    throw new Error(`${label} must match the final sample boundary.`);
  }
}

function requirePhaseSample(sample, phase, scenario, sampleIndex) {
  const label = `${phase.id}.samples[${sampleIndex}]`;
  requireFiniteNumber(sample?.durationMs, `${label}.durationMs`, { allowZero: false });
  if (sample?.processedBytes !== scenario.totalBytes) {
    throw new Error(`${label}.processedBytes must match the fixed fixture total.`);
  }
  for (const field of [
    "rssBeforeBytes",
    "rssAfterBytes",
    "maxRssBeforeBytes",
    "maxRssAfterBytes",
    "maxRssIncreaseBytes",
    "externalBeforeBytes",
    "externalAfterBytes",
    "arrayBuffersBeforeBytes",
    "arrayBuffersAfterBytes",
  ]) {
    requireFiniteNumber(sample?.[field], `${label}.${field}`);
  }
  for (const field of ["rssDeltaBytes", "externalDeltaBytes", "arrayBuffersDeltaBytes"]) {
    requireFiniteNumber(sample?.[field], `${label}.${field}`, { allowNegative: true });
  }
  if (
    sample.rssDeltaBytes !== sample.rssAfterBytes - sample.rssBeforeBytes
    || sample.maxRssIncreaseBytes !== Math.max(0, sample.maxRssAfterBytes - sample.maxRssBeforeBytes)
    || sample.externalDeltaBytes !== sample.externalAfterBytes - sample.externalBeforeBytes
    || sample.arrayBuffersDeltaBytes !== sample.arrayBuffersAfterBytes - sample.arrayBuffersBeforeBytes
  ) {
    throw new Error(`${label} contains inconsistent memory deltas.`);
  }
  if (sample.integrityEvidence !== phase.integrityEvidence) {
    throw new Error(`${label} does not contain the required integrity evidence.`);
  }

  if (phase.kind !== "combined") {
    if (sample.boundaries !== undefined) {
      throw new Error(`${label} must not contain combined phase boundaries.`);
    }
    return;
  }

  requireMemoryBoundary(sample.boundaries?.afterStream, sample, `${label}.boundaries.afterStream`, false);
  requireMemoryBoundary(
    sample.boundaries?.afterPostValidation,
    sample,
    `${label}.boundaries.afterPostValidation`,
    true,
  );
  if (
    sample.boundaries.afterPostValidation.maxRssAfterBytes
      < sample.boundaries.afterStream.maxRssAfterBytes
  ) {
    throw new Error(`${label} has a non-monotonic maxRSS boundary.`);
  }
}

function normalizePhaseSamples(phase, scenario, sampleRuns) {
  if (!Array.isArray(phase.samples) || phase.samples.length !== sampleRuns) {
    throw new Error(`${phase.id} must contain exactly ${sampleRuns} samples.`);
  }
  return phase.samples.map((sample, index) => {
    requirePhaseSample(sample, phase, scenario, index);
    return {
      durationMs: round(sample.durationMs),
      processedBytes: sample.processedBytes,
      throughputBytesPerSecond: round(sample.processedBytes / (sample.durationMs / 1000)),
      rssBeforeBytes: sample.rssBeforeBytes,
      rssAfterBytes: sample.rssAfterBytes,
      rssDeltaBytes: sample.rssDeltaBytes,
      maxRssBeforeBytes: sample.maxRssBeforeBytes,
      maxRssAfterBytes: sample.maxRssAfterBytes,
      maxRssIncreaseBytes: sample.maxRssIncreaseBytes,
      maxRssToLargestFileRatio: round(sample.maxRssIncreaseBytes / scenario.largestFileBytes, 6),
      externalBeforeBytes: sample.externalBeforeBytes,
      externalAfterBytes: sample.externalAfterBytes,
      externalDeltaBytes: sample.externalDeltaBytes,
      arrayBuffersBeforeBytes: sample.arrayBuffersBeforeBytes,
      arrayBuffersAfterBytes: sample.arrayBuffersAfterBytes,
      arrayBuffersDeltaBytes: sample.arrayBuffersDeltaBytes,
      integrityEvidence: sample.integrityEvidence,
      ...(sample.boundaries ? { boundaries: sample.boundaries } : {}),
    };
  });
}

function summarizePhaseSamples(samples) {
  const summaryFields = [
    ["durationMs", "milliseconds", 3],
    ["processedBytes", "bytes", 3],
    ["throughputBytesPerSecond", "bytes_per_second", 3],
    ["rssDeltaBytes", "bytes", 3],
    ["maxRssIncreaseBytes", "bytes", 3],
    ["maxRssToLargestFileRatio", "ratio", 6],
    ["maxRssToFullControlRatio", "ratio", 6],
    ["externalDeltaBytes", "bytes", 3],
    ["arrayBuffersDeltaBytes", "bytes", 3],
  ];
  const summary = Object.fromEntries(summaryFields.map(([field, unit, digits]) => [
    field,
    summarizeSamples(samples.map((sample) => sample[field]), unit, digits),
  ]));
  if (samples[0]?.boundaries) {
    summary.boundaries = {
      afterStreamMaxRssIncreaseBytes: summarizeSamples(
        samples.map((sample) => sample.boundaries.afterStream.maxRssIncreaseBytes),
        "bytes",
      ),
      afterPostValidationMaxRssIncreaseBytes: summarizeSamples(
        samples.map((sample) => sample.boundaries.afterPostValidation.maxRssIncreaseBytes),
        "bytes",
      ),
      postValidationAdditionalMaxRssBytes: summarizeSamples(
        samples.map((sample) => (
          sample.boundaries.afterPostValidation.maxRssIncreaseBytes
          - sample.boundaries.afterStream.maxRssIncreaseBytes
        )),
        "bytes",
      ),
    };
  }
  return summary;
}

function selectHighestShare(phases) {
  return [...phases].sort(
    (left, right) => right.summary.maxRssToFullControlRatio.p95
      - left.summary.maxRssToFullControlRatio.p95,
  )[0];
}

export function createPortableRecoveryPhaseBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  phases,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  const scenario = fixture?.scenario;
  if (!scenario || ["id", "fileCount", "totalBytes", "largestFileBytes"].some(
    (field) => scenario[field] !== largeAssetScenario[field],
  )) {
    throw new Error("fixture.scenario must match the fixed large_asset recovery fixture.");
  }
  if (!Array.isArray(phases) || phases.length !== portableRecoveryPhaseDefinitions.length) {
    throw new Error("phases must match the fixed portable recovery phase definitions.");
  }

  const normalizedPhases = phases.map((phase, index) => {
    const expected = portableRecoveryPhaseDefinitions[index];
    if (
      phase?.id !== expected.id
      || phase.kind !== expected.kind
      || phase.integrityEvidence !== expected.integrityEvidence
    ) {
      throw new Error("phases must match the fixed portable recovery phase definitions.");
    }
    return {
      id: expected.id,
      kind: expected.kind,
      integrityEvidence: expected.integrityEvidence,
      samples: normalizePhaseSamples(phase, scenario, sampleRuns),
    };
  });

  const fullControl = normalizedPhases[0];
  const fullControlMaxRssP95 = summarizeSamples(
    fullControl.samples.map((sample) => sample.maxRssIncreaseBytes),
    "bytes",
  ).p95;
  for (const phase of normalizedPhases) {
    phase.samples = phase.samples.map((sample) => ({
      ...sample,
      maxRssToFullControlRatio: fullControlMaxRssP95 === 0
        ? 0
        : round(sample.maxRssIncreaseBytes / fullControlMaxRssP95, 6),
    }));
    phase.summary = summarizePhaseSamples(phase.samples);
  }

  const reproductionGatePassed = fullControl.summary.maxRssToLargestFileRatio.p95
    >= fullControlMinRatio;
  const isolatedCandidates = normalizedPhases.filter(
    (phase) => phase.kind === "isolated"
      && phase.summary.maxRssToFullControlRatio.p95 >= ownerShareThreshold,
  );
  const combinedCandidates = normalizedPhases.filter(
    (phase) => phase.kind === "combined"
      && phase.summary.maxRssToFullControlRatio.p95 >= ownerShareThreshold,
  );
  const primaryCandidate = reproductionGatePassed
    ? selectHighestShare(isolatedCandidates.length > 0 ? isolatedCandidates : combinedCandidates)
    : undefined;
  const classification = !reproductionGatePassed
    ? "reproduction_gate_failed"
    : isolatedCandidates.length > 0
      ? "isolated_phase_owner"
      : combinedCandidates.length > 0
        ? "cross_phase_or_native_retention"
        : "insufficient_evidence";

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "distribution-portable-recovery-phases",
      mode: "report_only",
      thresholdApplied: false,
      productionPathModified: false,
      recoveryControlOwner: "ensurePortableRuntime",
      validationOwner: "validateInstalledRuntimeVersion",
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      workerIsolation: "fresh_process_per_phase_sample",
      temporaryDirectoryCleanup: "completed",
      fullControlMinRatio,
      ownerShareThreshold,
      scenario: {
        id: scenario.id,
        fileCount: scenario.fileCount,
        totalBytes: scenario.totalBytes,
        largestFileBytes: scenario.largestFileBytes,
      },
    },
    attribution: {
      reproductionGatePassed,
      classification,
      primaryPhaseId: primaryCandidate?.id ?? null,
      fullControlMaxRssIncreaseP95: fullControl.summary.maxRssIncreaseBytes.p95,
      primaryPhaseShareP95: primaryCandidate?.summary.maxRssToFullControlRatio.p95 ?? null,
      scope: "single_report_candidate_requires_three_report_consistency",
    },
    phases: normalizedPhases,
  };
}

function captureMemoryState() {
  return {
    memory: process.memoryUsage(),
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

function createMemoryBoundary(state, maxRssBeforeBytes) {
  return {
    maxRssAfterBytes: state.maxRssBytes,
    maxRssIncreaseBytes: Math.max(0, state.maxRssBytes - maxRssBeforeBytes),
    externalAfterBytes: state.memory.external,
    arrayBuffersAfterBytes: state.memory.arrayBuffers,
  };
}

function createMemorySample(before, after) {
  return {
    rssBeforeBytes: before.memory.rss,
    rssAfterBytes: after.memory.rss,
    rssDeltaBytes: after.memory.rss - before.memory.rss,
    maxRssBeforeBytes: before.maxRssBytes,
    maxRssAfterBytes: after.maxRssBytes,
    maxRssIncreaseBytes: Math.max(0, after.maxRssBytes - before.maxRssBytes),
    externalBeforeBytes: before.memory.external,
    externalAfterBytes: after.memory.external,
    externalDeltaBytes: after.memory.external - before.memory.external,
    arrayBuffersBeforeBytes: before.memory.arrayBuffers,
    arrayBuffersAfterBytes: after.memory.arrayBuffers,
    arrayBuffersDeltaBytes: after.memory.arrayBuffers - before.memory.arrayBuffers,
  };
}

async function copyRuntimeMetadata(payloadRoot, portableRoot) {
  await fs.mkdir(portableRoot, { recursive: true });
  await Promise.all([
    fs.copyFile(path.join(payloadRoot, "version.json"), path.join(portableRoot, "version.json")),
    fs.copyFile(
      path.join(payloadRoot, "runtime-manifest.json"),
      path.join(portableRoot, "runtime-manifest.json"),
    ),
  ]);
}

async function streamDecompressRuntime({ payloadRoot, portableRoot, withHash }) {
  const runtimeManifest = readRuntimeManifest(payloadRoot);
  let processedBytes = 0;
  for (const entry of runtimeManifest.files) {
    if (entry.type !== "file") {
      throw new Error(`The fixed phase fixture does not support ${entry.type} entries.`);
    }
    const sourcePath = path.join(
      payloadRoot,
      "runtime-files",
      ...entry.path.split("/"),
    ) + ".gz";
    const destinationPath = path.join(
      portableRoot,
      runtimeManifest.runtimeDir,
      ...entry.path.split("/"),
    );
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    const hash = withHash ? crypto.createHash("sha256") : undefined;
    const streams = [createReadStream(sourcePath), createGunzip()];
    if (hash) {
      streams.push(new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      }));
    }
    streams.push(createWriteStream(destinationPath));
    await pipeline(streams);

    const stat = await fs.stat(destinationPath);
    if (stat.size !== entry.size) {
      throw new Error(`Decompressed size mismatch for ${entry.path}.`);
    }
    if (hash && hash.digest("hex") !== entry.sha256) {
      throw new Error(`Decompressed hash mismatch for ${entry.path}.`);
    }
    processedBytes += stat.size;
  }
  return { processedBytes, runtimeManifest };
}

function requireSuccessfulValidation(validation, label) {
  if (!validation.ok) {
    throw new Error(`${label} failed with ${validation.reason ?? "unknown_reason"}.`);
  }
}

async function executePhase(phase, portableRoot, payloadRoot) {
  if (phase.id === "full_recovery_control") {
    const runtimeManifest = readRuntimeManifest(payloadRoot);
    const result = ensurePortableRuntime({ portableRoot, payloadRoot });
    if (!result.recovered) {
      throw new Error("The full recovery control did not recover the fixed fixture.");
    }
    return { processedBytes: runtimeManifest.summary.totalSize };
  }

  const versionFile = readPortableVersionFile(payloadRoot);
  const runtimeManifest = readRuntimeManifest(payloadRoot);
  if (phase.id === "metadata_initial_validation") {
    const validation = validateInstalledRuntimeVersion({
      versionRoot: portableRoot,
      sourceVersionFile: versionFile,
      sourceRuntimeManifest: runtimeManifest,
    });
    if (validation.ok || validation.reason !== "missing_version_metadata") {
      throw new Error("Initial validation did not detect the intentionally missing runtime.");
    }
    return { processedBytes: runtimeManifest.summary.totalSize };
  }

  if (phase.id === "stream_decompress_only" || phase.id === "stream_decompress_with_hash") {
    return streamDecompressRuntime({
      payloadRoot,
      portableRoot,
      withHash: phase.id === "stream_decompress_with_hash",
    });
  }

  if (phase.id === "post_validation_fresh") {
    const validation = validateInstalledRuntimeVersion({
      versionRoot: portableRoot,
      sourceVersionFile: versionFile,
      sourceRuntimeManifest: runtimeManifest,
    });
    requireSuccessfulValidation(validation, "Fresh post-validation");
    return { processedBytes: runtimeManifest.summary.totalSize };
  }

  if (phase.id === "stream_hash_then_post_validation") {
    await copyRuntimeMetadata(payloadRoot, portableRoot);
    const streamResult = await streamDecompressRuntime({
      payloadRoot,
      portableRoot,
      withHash: true,
    });
    const afterStream = captureMemoryState();
    const validation = validateInstalledRuntimeVersion({
      versionRoot: portableRoot,
      sourceVersionFile: versionFile,
      sourceRuntimeManifest: runtimeManifest,
    });
    requireSuccessfulValidation(validation, "Combined post-validation");
    return { processedBytes: streamResult.processedBytes, afterStream };
  }

  throw new Error(`Unsupported phase ${phase.id}.`);
}

function parseWorkerArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  const phaseId = values.get("--phase");
  const portableRoot = values.get("--portable-root");
  const payloadRoot = values.get("--payload-root");
  const phase = portableRecoveryPhaseDefinitions.find((definition) => definition.id === phaseId);
  if (!phase || !portableRoot || !payloadRoot) {
    throw new Error("Phase worker requires a known phase, portable root, and payload root.");
  }
  return { phase, portableRoot, payloadRoot };
}

async function runWorker(argv) {
  const { phase, portableRoot, payloadRoot } = parseWorkerArgs(argv);
  await fs.mkdir(portableRoot, { recursive: true });
  global.gc?.();
  const before = captureMemoryState();
  const startedAt = performance.now();
  const result = await executePhase(phase, portableRoot, payloadRoot);
  const durationMs = performance.now() - startedAt;
  const after = captureMemoryState();
  const sample = {
    durationMs,
    processedBytes: result.processedBytes,
    ...createMemorySample(before, after),
    integrityEvidence: phase.integrityEvidence,
    ...(result.afterStream
      ? {
          boundaries: {
            afterStream: createMemoryBoundary(result.afterStream, before.maxRssBytes),
            afterPostValidation: createMemoryBoundary(after, before.maxRssBytes),
          },
        }
      : {}),
  };
  console.log(`${workerResultPrefix}${JSON.stringify(sample)}`);
}

async function preparePostValidationRuntime(fixture) {
  const portableRoot = path.join(fixture.fixtureRoot, "prepared-post-validation");
  await fs.mkdir(portableRoot, { recursive: true });
  const result = ensurePortableRuntime({ portableRoot, payloadRoot: fixture.payloadRoot });
  if (!result.recovered) {
    throw new Error("Unable to prepare the fresh post-validation runtime.");
  }
  return portableRoot;
}

async function collectWorkerSample({ fixture, phase, portableRoot, cleanupPortableRoot }) {
  const child = spawnSync(process.execPath, [
    "--expose-gc",
    "--import",
    "tsx",
    scriptPath,
    "--worker",
    "--phase",
    phase.id,
    "--portable-root",
    portableRoot,
    "--payload-root",
    fixture.payloadRoot,
  ], {
    cwd: workspaceRoot,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
  try {
    if (child.error || child.status !== 0) {
      throw child.error ?? new Error(
        `Phase worker ${phase.id} failed with exit code ${child.status}: ${child.stderr}`,
      );
    }
    const resultLine = child.stdout
      .split(/\r?\n/u)
      .findLast((line) => line.startsWith(workerResultPrefix));
    if (!resultLine) {
      throw new Error(`Phase worker ${phase.id} did not return a result: ${child.stdout}`);
    }
    return JSON.parse(resultLine.slice(workerResultPrefix.length));
  } finally {
    if (cleanupPortableRoot) {
      await fs.rm(portableRoot, { recursive: true, force: true });
    }
  }
}

async function runPhase(fixture, phase, warmupRuns, sampleRuns) {
  const preparedRoot = phase.id === "post_validation_fresh"
    ? await preparePostValidationRuntime(fixture)
    : undefined;
  let runIndex = 0;
  const collect = async () => {
    const portableRoot = preparedRoot ?? path.join(
      fixture.fixtureRoot,
      `portable-${phase.id}-${process.pid}-${runIndex}-${Date.now()}`,
    );
    runIndex += 1;
    return collectWorkerSample({
      fixture,
      phase,
      portableRoot,
      cleanupPortableRoot: preparedRoot === undefined,
    });
  };

  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:portable-recovery-phases] ${phase.id} warm-up ${index + 1}/${warmupRuns}`);
    await collect();
  }
  const samples = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:portable-recovery-phases] ${phase.id} sample ${index + 1}/${sampleRuns}`);
    samples.push(await collect());
  }
  return { ...phase, samples };
}

function readGit(args) {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf-8",
    shell: false,
    windowsHide: true,
  });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

async function collectReportContext() {
  const [rootPackage, lockfile] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "pnpm-lock.yaml")),
  ]);
  const cpus = os.cpus();
  const status = readGit(["status", "--porcelain"]);
  return {
    environment: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      packageManager: rootPackage.packageManager,
      cpuModel: cpus[0]?.model ?? "unknown",
      logicalCpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
      gcExposed: typeof global.gc === "function",
      maxRssSource: "process.resourceUsage.maxRSS_kibibytes",
      ci: process.env.CI === "true" || process.env.CI === "1" || Boolean(process.env.GITHUB_ACTIONS),
    },
    source: {
      commit: readGit(["rev-parse", "HEAD"]),
      workspaceDirty: status === null ? null : status.length > 0,
      lockfileSha256: crypto.createHash("sha256").update(lockfile).digest("hex"),
    },
  };
}

async function runBenchmark(warmupRuns, sampleRuns) {
  const fixture = await createPortableRecoveryFixture(largeAssetScenario);
  const phases = [];
  try {
    for (const phase of portableRecoveryPhaseDefinitions) {
      phases.push(await runPhase(fixture, phase, warmupRuns, sampleRuns));
    }
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
  return phases;
}

async function writeReport(outputPath, report) {
  const resolvedOutput = path.resolve(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return resolvedOutput;
}

function printHelp() {
  console.log(`Usage: node --expose-gc --import tsx scripts/run-portable-recovery-phase-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per phase (default: 1)
  --sample-runs <n>     Measured runs per phase (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parsePortableRecoveryPhaseBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const context = await collectReportContext();
  const phases = await runBenchmark(args.warmupRuns, args.sampleRuns);
  const report = createPortableRecoveryPhaseBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      scenario: largeAssetScenario,
    },
    phases,
  });
  const outputPath = await writeReport(args.output, report);
  for (const phase of report.phases) {
    console.log(
      `[benchmark:portable-recovery-phases] ${phase.id}: p95=${phase.summary.durationMs.p95}ms max-rss-increase-p95=${phase.summary.maxRssIncreaseBytes.p95}B control-share=${phase.summary.maxRssToFullControlRatio.p95}`,
    );
  }
  console.log(
    `[benchmark:portable-recovery-phases] attribution=${report.attribution.classification} primary=${report.attribution.primaryPhaseId ?? "none"}`,
  );
  console.log(`[benchmark:portable-recovery-phases] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  const argv = process.argv.slice(2);
  const workerIndex = argv.indexOf("--worker");
  const task = workerIndex >= 0 ? runWorker(argv.slice(workerIndex + 1)) : main();
  task.catch((error) => {
    console.error(`[benchmark:portable-recovery-phases] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
