import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateInstalledRuntimeVersion } from "../packages/star-sanctuary-distribution/src/runtime-manifest.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/p2-d02-runtime-integrity.json";
const fixedRuntimeFiles = [
  { path: "packages/belldandy-core/dist/bin/gateway.js", content: "export {};\n" },
  { path: "apps/web/public/index.html", content: "<!doctype html><title>fixture</title>\n" },
  { path: "templates/AGENTS.md", content: "# fixture\n" },
];
const scenarioDefinitions = [
  { id: "small", fileCount: 8, totalBytes: 1_048_576 },
  { id: "medium", fileCount: 24, totalBytes: 12_582_912 },
  { id: "large", fileCount: 48, totalBytes: 50_331_648 },
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

export function parseDistributionIntegrityBenchmarkArgs(argv) {
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

function requireScenarioDefinition(scenario, sampleRuns) {
  if (!scenario || typeof scenario !== "object" || typeof scenario.id !== "string" || scenario.id.length === 0) {
    throw new Error("Each scenario requires an id.");
  }
  for (const field of ["fileCount", "totalBytes"]) {
    if (!Number.isInteger(scenario[field]) || scenario[field] <= 0) {
      throw new Error(`${scenario.id} has an invalid ${field}.`);
    }
  }
  if (!Array.isArray(scenario.samples) || scenario.samples.length !== sampleRuns) {
    throw new Error(`${scenario.id} must contain exactly ${sampleRuns} samples.`);
  }
  if (scenario.tamperDetection !== "sha256_mismatch") {
    throw new Error(`${scenario.id} must prove same-size tampering through sha256_mismatch.`);
  }
  for (const sample of scenario.samples) {
    for (const field of ["durationMs", "rssBeforeBytes", "rssAfterBytes", "rssSampledPeakBytes"]) {
      if (!Number.isFinite(sample?.[field]) || sample[field] < 0) {
        throw new Error(`${scenario.id} contains an invalid ${field} sample.`);
      }
    }
    if (!Number.isFinite(sample?.rssDeltaBytes)) {
      throw new Error(`${scenario.id} contains an invalid rssDeltaBytes sample.`);
    }
    if (sample.rssDeltaBytes !== sample.rssAfterBytes - sample.rssBeforeBytes) {
      throw new Error(`${scenario.id} contains an inconsistent RSS delta.`);
    }
    if (sample.rssSampledPeakBytes !== Math.max(sample.rssBeforeBytes, sample.rssAfterBytes)) {
      throw new Error(`${scenario.id} contains an inconsistent sampled RSS peak.`);
    }
  }
}

export function createDistributionIntegrityBenchmarkReport({
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
    if (!expected || expected.fileCount !== scenario.fileCount || expected.totalBytes !== scenario.totalBytes) {
      throw new Error(`${scenario.id} does not match the fixed fixture definition.`);
    }

    const samples = scenario.samples.map((sample) => ({
      durationMs: round(sample.durationMs),
      rssBeforeBytes: sample.rssBeforeBytes,
      rssAfterBytes: sample.rssAfterBytes,
      rssDeltaBytes: sample.rssDeltaBytes,
      rssSampledPeakBytes: sample.rssSampledPeakBytes,
    }));
    return {
      id: scenario.id,
      fileCount: scenario.fileCount,
      totalBytes: scenario.totalBytes,
      samples,
      summary: {
        durationMs: summarizeSamples(samples.map((sample) => sample.durationMs), "milliseconds"),
        rssBeforeBytes: summarizeSamples(samples.map((sample) => sample.rssBeforeBytes), "bytes"),
        rssAfterBytes: summarizeSamples(samples.map((sample) => sample.rssAfterBytes), "bytes"),
        rssDeltaBytes: summarizeSamples(samples.map((sample) => sample.rssDeltaBytes), "bytes"),
        rssSampledPeakBytes: summarizeSamples(samples.map((sample) => sample.rssSampledPeakBytes), "bytes"),
      },
      tamperDetection: scenario.tamperDetection,
    };
  });

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "distribution-runtime-integrity",
      mode: "report_only",
      thresholdApplied: false,
      validationOwner: "validateInstalledRuntimeVersion",
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      scenarios: fixture.scenarios.map((scenario) => ({
        id: scenario.id,
        fileCount: scenario.fileCount,
        totalBytes: scenario.totalBytes,
      })),
    },
    scenarios: normalizedScenarios,
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function writeFixtureFile(root, relativePath, content) {
  const targetPath = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content);
  return targetPath;
}

function buildPayloadEntries(definition) {
  const fixedBytes = fixedRuntimeFiles.reduce(
    (total, entry) => total + Buffer.byteLength(entry.content),
    0,
  );
  const payloadFileCount = definition.fileCount - fixedRuntimeFiles.length;
  const payloadBytes = definition.totalBytes - fixedBytes;
  if (payloadFileCount <= 0 || payloadBytes < payloadFileCount) {
    throw new Error(`${definition.id} cannot allocate its fixed runtime fixture.`);
  }

  const entries = fixedRuntimeFiles.map((entry) => ({
    path: entry.path,
    content: Buffer.from(entry.content, "utf-8"),
  }));
  const baseSize = Math.floor(payloadBytes / payloadFileCount);
  let remainingBytes = payloadBytes;
  for (let index = 0; index < payloadFileCount; index += 1) {
    const size = index === payloadFileCount - 1 ? remainingBytes : baseSize;
    remainingBytes -= size;
    entries.push({
      path: `data/payload-${String(index).padStart(3, "0")}.bin`,
      content: Buffer.alloc(size, (index + 17) % 256),
    });
  }
  return entries;
}

async function createRuntimeFixture(definition) {
  const versionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "star-sanctuary-d02-integrity-"));
  const runtimeDir = "runtime";
  const payloadEntries = buildPayloadEntries(definition);
  const manifestEntries = [];
  for (const entry of payloadEntries) {
    await writeFixtureFile(path.join(versionRoot, runtimeDir), entry.path, entry.content);
    manifestEntries.push({
      path: entry.path,
      type: "file",
      size: entry.content.byteLength,
      sha256: sha256(entry.content),
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
    runtimeDir,
    summary: {
      fileCount: manifestEntries.length,
      totalSize: manifestEntries.reduce((total, entry) => total + entry.size, 0),
    },
    files: manifestEntries,
  };
  const runtimeManifestText = `${JSON.stringify(runtimeManifest, null, 2)}\n`;
  await fs.writeFile(path.join(versionRoot, "runtime-manifest.json"), runtimeManifestText, "utf-8");

  const sourceVersionFile = {
    productName: runtimeManifest.productName,
    version: runtimeManifest.version,
    distributionMode: runtimeManifest.distributionMode,
    platform: runtimeManifest.platform,
    arch: runtimeManifest.arch,
    builtAt: runtimeManifest.builtAt,
    includeOptionalNative: false,
    runtimeDir,
    entryScript: "runtime/packages/belldandy-core/dist/bin/gateway.js",
    runtimeSummary: runtimeManifest.summary,
    files: {
      runtimeManifest: {
        path: "runtime-manifest.json",
        size: Buffer.byteLength(runtimeManifestText),
        sha256: sha256(runtimeManifestText),
      },
    },
  };
  await fs.writeFile(path.join(versionRoot, "version.json"), `${JSON.stringify(sourceVersionFile, null, 2)}\n`, "utf-8");

  return {
    versionRoot,
    sourceVersionFile,
    sourceRuntimeManifest: runtimeManifest,
    tamperPath: path.join(versionRoot, runtimeDir, ...manifestEntries.at(-1).path.split("/")),
    tamperSize: manifestEntries.at(-1).size,
  };
}

function validateFixture(fixture) {
  const result = validateInstalledRuntimeVersion({
    versionRoot: fixture.versionRoot,
    sourceVersionFile: fixture.sourceVersionFile,
    sourceRuntimeManifest: fixture.sourceRuntimeManifest,
  });
  if (!result.ok) {
    throw new Error(`Runtime integrity fixture validation failed: ${result.reason}.`);
  }
}

function collectSample(fixture) {
  global.gc?.();
  const rssBeforeBytes = process.memoryUsage().rss;
  const startedAt = performance.now();
  validateFixture(fixture);
  const durationMs = performance.now() - startedAt;
  const rssAfterBytes = process.memoryUsage().rss;
  return {
    durationMs,
    rssBeforeBytes,
    rssAfterBytes,
    rssDeltaBytes: rssAfterBytes - rssBeforeBytes,
    rssSampledPeakBytes: Math.max(rssBeforeBytes, rssAfterBytes),
  };
}

async function assertSameSizeTamperDetection(fixture) {
  const tamperedContent = Buffer.alloc(fixture.tamperSize, 0xff);
  await fs.writeFile(fixture.tamperPath, tamperedContent);
  const result = validateInstalledRuntimeVersion({
    versionRoot: fixture.versionRoot,
    sourceVersionFile: fixture.sourceVersionFile,
    sourceRuntimeManifest: fixture.sourceRuntimeManifest,
  });
  const hasShaMismatch = !result.ok
    && result.reason === "runtime_manifest_entry_mismatch"
    && result.invalidPaths?.some((entry) => entry.reason === "sha256_mismatch");
  if (!hasShaMismatch) {
    throw new Error("Same-size tampering was not rejected through sha256_mismatch.");
  }
  return "sha256_mismatch";
}

async function runScenario(definition, warmupRuns, sampleRuns) {
  const fixture = await createRuntimeFixture(definition);
  try {
    for (let index = 0; index < warmupRuns; index += 1) {
      console.log(`[benchmark:distribution-integrity] ${definition.id} warm-up ${index + 1}/${warmupRuns}`);
      validateFixture(fixture);
    }

    const samples = [];
    for (let index = 0; index < sampleRuns; index += 1) {
      console.log(`[benchmark:distribution-integrity] ${definition.id} sample ${index + 1}/${sampleRuns}`);
      samples.push(collectSample(fixture));
    }
    return {
      id: definition.id,
      fileCount: definition.fileCount,
      totalBytes: definition.totalBytes,
      samples,
      tamperDetection: await assertSameSizeTamperDetection(fixture),
    };
  } finally {
    await fs.rm(fixture.versionRoot, { recursive: true, force: true });
  }
}

function readGit(args) {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf-8",
    shell: false,
    windowsHide: true,
  });
  if (!result.error && result.status === 0) {
    return result.stdout.trim();
  }
  return null;
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
  console.log(`Usage: node --expose-gc --import tsx scripts/run-distribution-integrity-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per scenario (default: 1)
  --sample-runs <n>     Measured runs per scenario (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parseDistributionIntegrityBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const context = await collectReportContext();
  const scenarios = [];
  for (const definition of scenarioDefinitions) {
    scenarios.push(await runScenario(definition, args.warmupRuns, args.sampleRuns));
  }
  const report = createDistributionIntegrityBenchmarkReport({
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
      `[benchmark:distribution-integrity] ${scenario.id}: p50=${scenario.summary.durationMs.median}ms p95=${scenario.summary.durationMs.p95}ms rss-delta-p95=${scenario.summary.rssDeltaBytes.p95}B`,
    );
  }
  console.log(`[benchmark:distribution-integrity] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:distribution-integrity] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
