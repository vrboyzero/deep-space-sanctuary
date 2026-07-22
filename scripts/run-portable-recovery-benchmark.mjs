import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import { ensurePortableRuntime } from "../packages/star-sanctuary-distribution/src/portable-runtime.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const defaultOutput = "artifacts/benchmarks/p2-d03-portable-recovery.json";
const workerResultPrefix = "D03_PORTABLE_RECOVERY_WORKER_RESULT ";
export const portableRecoveryScenarioDefinitions = [
  { id: "many_small", fileCount: 128, totalBytes: 8_388_608, largestFileBytes: 65_536 },
  { id: "large_asset", fileCount: 4, totalBytes: 67_108_864, largestFileBytes: 16_777_216 },
];
const scenarioDefinitions = portableRecoveryScenarioDefinitions;

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

export function parsePortableRecoveryBenchmarkArgs(argv) {
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

function summarizeSamples(samples, unit) {
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
    min: round(sorted[0]),
    max: round(sorted[sampleCount - 1]),
    mean: round(mean),
    median: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    variance: round(variance),
    standardDeviation: round(Math.sqrt(variance)),
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  };
}

function requireFiniteNumber(value, label, { allowNegative = false, allowZero = true } = {}) {
  if (!Number.isFinite(value) || (!allowNegative && value < 0) || (!allowZero && value === 0)) {
    throw new Error(`${label} must be a finite ${allowNegative ? "" : "non-negative "}number.`);
  }
}

function requireScenarioDefinition(scenario, sampleRuns) {
  if (!scenario || typeof scenario !== "object" || typeof scenario.id !== "string" || !scenario.id) {
    throw new Error("Each recovery scenario requires an id.");
  }
  for (const field of ["fileCount", "totalBytes", "largestFileBytes"]) {
    if (!Number.isInteger(scenario[field]) || scenario[field] <= 0) {
      throw new Error(`${scenario.id} has an invalid ${field}.`);
    }
  }
  if (scenario.largestFileBytes > scenario.totalBytes) {
    throw new Error(`${scenario.id} largestFileBytes exceeds totalBytes.`);
  }
  if (!Array.isArray(scenario.samples) || scenario.samples.length !== sampleRuns) {
    throw new Error(`${scenario.id} must contain exactly ${sampleRuns} samples.`);
  }

  for (const [index, sample] of scenario.samples.entries()) {
    const label = `${scenario.id}.samples[${index}]`;
    requireFiniteNumber(sample?.durationMs, `${label}.durationMs`, { allowZero: false });
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
    if (sample.rssDeltaBytes !== sample.rssAfterBytes - sample.rssBeforeBytes
      || sample.maxRssIncreaseBytes !== Math.max(0, sample.maxRssAfterBytes - sample.maxRssBeforeBytes)
      || sample.externalDeltaBytes !== sample.externalAfterBytes - sample.externalBeforeBytes
      || sample.arrayBuffersDeltaBytes !== sample.arrayBuffersAfterBytes - sample.arrayBuffersBeforeBytes) {
      throw new Error(`${label} contains inconsistent memory deltas.`);
    }
    if (sample.recovered !== true || sample.postValidation !== "validated") {
      throw new Error(`${label} must prove validated recovery.`);
    }
  }
}

export function createPortableRecoveryBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  if (!Array.isArray(fixture?.scenarios) || fixture.scenarios.length === 0) {
    throw new Error("fixture.scenarios must contain at least one scenario.");
  }
  if (!Array.isArray(scenarios) || scenarios.length !== fixture.scenarios.length) {
    throw new Error("scenarios must match fixture.scenarios.");
  }

  const expectedScenarios = new Map(fixture.scenarios.map((scenario) => [scenario.id, scenario]));
  const normalizedScenarios = scenarios.map((scenario) => {
    requireScenarioDefinition(scenario, sampleRuns);
    const expected = expectedScenarios.get(scenario.id);
    if (!expected || ["fileCount", "totalBytes", "largestFileBytes"]
      .some((field) => expected[field] !== scenario[field])) {
      throw new Error(`${scenario.id} does not match the fixed recovery fixture definition.`);
    }

    const samples = scenario.samples.map((sample) => ({
      durationMs: round(sample.durationMs),
      throughputBytesPerSecond: round(scenario.totalBytes / (sample.durationMs / 1000)),
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
      recovered: true,
      postValidation: "validated",
    }));
    const summaryFields = [
      ["durationMs", "milliseconds"],
      ["throughputBytesPerSecond", "bytes_per_second"],
      ["rssDeltaBytes", "bytes"],
      ["maxRssIncreaseBytes", "bytes"],
      ["maxRssToLargestFileRatio", "ratio"],
      ["externalDeltaBytes", "bytes"],
      ["arrayBuffersDeltaBytes", "bytes"],
    ];
    return {
      id: scenario.id,
      fileCount: scenario.fileCount,
      totalBytes: scenario.totalBytes,
      largestFileBytes: scenario.largestFileBytes,
      samples,
      summary: Object.fromEntries(summaryFields.map(([field, unit]) => [
        field,
        summarizeSamples(samples.map((sample) => sample[field]), unit),
      ])),
      integrityEvidence: "validated_after_recovery",
    };
  });

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
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
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      workerIsolation: "fresh_process_per_sample",
      scenarios: fixture.scenarios.map((scenario) => ({
        id: scenario.id,
        fileCount: scenario.fileCount,
        totalBytes: scenario.totalBytes,
        largestFileBytes: scenario.largestFileBytes,
      })),
    },
    scenarios: normalizedScenarios,
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function writePayloadFile(payloadRoot, relativePath, content) {
  const compressedPath = path.join(payloadRoot, "runtime-files", ...relativePath.split("/")) + ".gz";
  await fs.mkdir(path.dirname(compressedPath), { recursive: true });
  await fs.writeFile(compressedPath, gzipSync(content));
}

export async function createPortableRecoveryFixture(definition) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), `star-sanctuary-d03-recovery-${definition.id}-`));
  const payloadRoot = path.join(fixtureRoot, "payload");
  await fs.mkdir(payloadRoot, { recursive: true });
  const sizePerFile = Math.floor(definition.totalBytes / definition.fileCount);
  let remainingBytes = definition.totalBytes;
  const manifestEntries = [];

  for (let index = 0; index < definition.fileCount; index += 1) {
    const size = index === definition.fileCount - 1 ? remainingBytes : sizePerFile;
    remainingBytes -= size;
    const relativePath = [
      "packages/belldandy-core/dist/bin/gateway.js",
      "apps/web/public/index.html",
      "templates/AGENTS.md",
    ][index] ?? `data/payload-${String(index).padStart(3, "0")}.bin`;
    const content = Buffer.alloc(size, (index + 17) % 251);
    await writePayloadFile(payloadRoot, relativePath, content);
    manifestEntries.push({
      path: relativePath,
      type: "file",
      size,
      sha256: sha256(content),
    });
  }

  const runtimeManifest = {
    productName: "star-sanctuary-benchmark",
    version: "0.0.0-benchmark",
    distributionMode: "slim",
    platform: process.platform,
    arch: process.arch,
    builtAt: "2026-07-22T00:00:00.000Z",
    includeOptionalNative: false,
    runtimeDir: "runtime",
    summary: {
      fileCount: manifestEntries.length,
      totalSize: definition.totalBytes,
    },
    files: manifestEntries,
  };
  const manifestText = `${JSON.stringify(runtimeManifest, null, 2)}\n`;
  await fs.writeFile(path.join(payloadRoot, "runtime-manifest.json"), manifestText, "utf-8");
  const versionFile = {
    productName: runtimeManifest.productName,
    version: runtimeManifest.version,
    distributionMode: runtimeManifest.distributionMode,
    platform: runtimeManifest.platform,
    arch: runtimeManifest.arch,
    builtAt: runtimeManifest.builtAt,
    includeOptionalNative: false,
    runtimeDir: runtimeManifest.runtimeDir,
    entryScript: "runtime/packages/belldandy-core/dist/bin/gateway.js",
    runtimeSummary: runtimeManifest.summary,
    files: {
      runtimeManifest: {
        path: "runtime-manifest.json",
        size: Buffer.byteLength(manifestText),
        sha256: sha256(manifestText),
      },
    },
  };
  await fs.writeFile(path.join(payloadRoot, "version.json"), `${JSON.stringify(versionFile, null, 2)}\n`, "utf-8");
  return { fixtureRoot, payloadRoot };
}

function parseWorkerArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  const portableRoot = values.get("--portable-root");
  const payloadRoot = values.get("--payload-root");
  if (!portableRoot || !payloadRoot) {
    throw new Error("Recovery worker requires portable and payload roots.");
  }
  return { portableRoot, payloadRoot };
}

async function runWorker(argv) {
  const { portableRoot, payloadRoot } = parseWorkerArgs(argv);
  await fs.mkdir(portableRoot, { recursive: true });
  global.gc?.();
  const memoryBefore = process.memoryUsage();
  const resourceBefore = process.resourceUsage();
  const startedAt = performance.now();
  const result = ensurePortableRuntime({ portableRoot, payloadRoot });
  const durationMs = performance.now() - startedAt;
  const memoryAfter = process.memoryUsage();
  const resourceAfter = process.resourceUsage();
  const maxRssBeforeBytes = resourceBefore.maxRSS * 1024;
  const maxRssAfterBytes = resourceAfter.maxRSS * 1024;
  const sample = {
    durationMs,
    rssBeforeBytes: memoryBefore.rss,
    rssAfterBytes: memoryAfter.rss,
    rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
    maxRssBeforeBytes,
    maxRssAfterBytes,
    maxRssIncreaseBytes: Math.max(0, maxRssAfterBytes - maxRssBeforeBytes),
    externalBeforeBytes: memoryBefore.external,
    externalAfterBytes: memoryAfter.external,
    externalDeltaBytes: memoryAfter.external - memoryBefore.external,
    arrayBuffersBeforeBytes: memoryBefore.arrayBuffers,
    arrayBuffersAfterBytes: memoryAfter.arrayBuffers,
    arrayBuffersDeltaBytes: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    recovered: result.recovered === true,
    postValidation: result.recovered === true ? "validated" : "not_recovered",
  };
  console.log(`${workerResultPrefix}${JSON.stringify(sample)}`);
}

async function collectWorkerSample(fixture, definition, runIndex) {
  const portableRoot = path.join(fixture.fixtureRoot, `portable-${process.pid}-${runIndex}-${Date.now()}`);
  const child = spawnSync(process.execPath, [
    "--expose-gc",
    "--import",
    "tsx",
    scriptPath,
    "--worker",
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
      throw child.error ?? new Error(`Recovery worker failed with exit code ${child.status}: ${child.stderr}`);
    }
    const resultLine = child.stdout
      .split(/\r?\n/u)
      .findLast((line) => line.startsWith(workerResultPrefix));
    if (!resultLine) {
      throw new Error(`Recovery worker did not return a result: ${child.stdout}`);
    }
    const sample = JSON.parse(resultLine.slice(workerResultPrefix.length));
    requireScenarioDefinition({ ...definition, samples: [sample] }, 1);
    return sample;
  } finally {
    await fs.rm(portableRoot, { recursive: true, force: true });
  }
}

async function runScenario(definition, warmupRuns, sampleRuns) {
  const fixture = await createPortableRecoveryFixture(definition);
  try {
    let runIndex = 0;
    for (let index = 0; index < warmupRuns; index += 1) {
      console.log(`[benchmark:portable-recovery] ${definition.id} warm-up ${index + 1}/${warmupRuns}`);
      await collectWorkerSample(fixture, definition, runIndex++);
    }
    const samples = [];
    for (let index = 0; index < sampleRuns; index += 1) {
      console.log(`[benchmark:portable-recovery] ${definition.id} sample ${index + 1}/${sampleRuns}`);
      samples.push(await collectWorkerSample(fixture, definition, runIndex++));
    }
    return { ...definition, samples };
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
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
      lockfileSha256: sha256(lockfile),
    },
  };
}

async function writeReport(outputPath, report) {
  const resolvedOutput = path.resolve(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return resolvedOutput;
}

function printHelp() {
  console.log(`Usage: node --expose-gc --import tsx scripts/run-portable-recovery-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per scenario (default: 1)
  --sample-runs <n>     Measured runs per scenario (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parsePortableRecoveryBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const context = await collectReportContext();
  const scenarios = [];
  for (const definition of scenarioDefinitions) {
    scenarios.push(await runScenario(definition, args.warmupRuns, args.sampleRuns));
  }
  const report = createPortableRecoveryBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      scenarios: scenarioDefinitions,
    },
    scenarios,
  });
  const outputPath = await writeReport(args.output, report);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:portable-recovery] ${scenario.id}: p50=${scenario.summary.durationMs.median}ms p95=${scenario.summary.durationMs.p95}ms max-rss-increase-p95=${scenario.summary.maxRssIncreaseBytes.p95}B ratio=${scenario.summary.maxRssToLargestFileRatio.p95}`,
    );
  }
  console.log(`[benchmark:portable-recovery] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  const argv = process.argv.slice(2);
  const workerIndex = argv.indexOf("--worker");
  const task = workerIndex >= 0 ? runWorker(argv.slice(workerIndex + 1)) : main();
  task.catch((error) => {
    console.error(`[benchmark:portable-recovery] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
