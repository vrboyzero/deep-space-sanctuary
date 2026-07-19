import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/b00-build.json";

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

export function parseBuildBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 3,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }
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

function requireSamples(samples, expectedCount, scenarioId) {
  if (!Array.isArray(samples) || samples.length !== expectedCount) {
    throw new Error(`${scenarioId} must contain exactly ${expectedCount} samples.`);
  }
  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < 0) {
      throw new Error(`${scenarioId} contains an invalid duration sample.`);
    }
  }
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sampleCount;
  const variance = sorted.reduce(
    (total, sample) => total + ((sample - mean) ** 2),
    0,
  ) / sampleCount;
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sampleCount) - 1)];

  return {
    unit: "milliseconds",
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

export function createBuildBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const projectCount = parseCount(fixture?.projectCount, "fixture.projectCount");
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("At least one benchmark scenario is required.");
  }

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "workspace-typescript-build",
      mode: "report_only",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      projectCount,
    },
    scenarios: scenarios.map((scenario) => {
      requireSamples(scenario.samplesMs, sampleRuns, scenario.id);
      return {
        id: scenario.id,
        command: [...scenario.command],
        samplesMs: scenario.samplesMs.map((sample) => round(sample)),
        summary: summarizeSamples(scenario.samplesMs),
      };
    }),
  };
}

function runCommand(executable, args, label) {
  const startedAt = performance.now();
  const result = spawnSync(executable, args, {
    cwd: workspaceRoot,
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  const durationMs = performance.now() - startedAt;

  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited with code ${String(result.status)}.`);
  }
  return durationMs;
}

function runScenario(scenario, warmupRuns, sampleRuns) {
  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:build] ${scenario.id} warm-up ${index + 1}/${warmupRuns}`);
    runCommand(process.execPath, scenario.args, `${scenario.id} warm-up`);
  }

  const samplesMs = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:build] ${scenario.id} sample ${index + 1}/${sampleRuns}`);
    samplesMs.push(runCommand(process.execPath, scenario.args, `${scenario.id} sample`));
  }

  return {
    id: scenario.id,
    command: scenario.command,
    samplesMs,
  };
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function readGit(args) {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf-8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

async function collectReportContext() {
  const [rootPackage, typescriptPackage, rootTsconfig] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "node_modules", "typescript", "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "tsconfig.json"), "utf-8").then(JSON.parse),
  ]);
  const cpus = os.cpus();
  const status = readGit(["status", "--porcelain"]);

  return {
    environment: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      typescriptVersion: typescriptPackage.version,
      packageManager: rootPackage.packageManager,
      cpuModel: cpus[0]?.model ?? "unknown",
      logicalCpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
      ci: process.env.CI === "true" || process.env.CI === "1" || Boolean(process.env.GITHUB_ACTIONS),
    },
    source: {
      commit: readGit(["rev-parse", "HEAD"]),
      workspaceDirty: status === null ? null : status.length > 0,
      lockfileSha256: await sha256File(path.join(workspaceRoot, "pnpm-lock.yaml")),
    },
    projectCount: Array.isArray(rootTsconfig.references) ? rootTsconfig.references.length : 0,
  };
}

async function writeReport(outputPath, report) {
  const resolvedOutput = path.resolve(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return resolvedOutput;
}

function printHelp() {
  console.log(`Usage: node scripts/run-build-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per scenario (default: 1)
  --sample-runs <n>     Measured runs per scenario (default: 3)
  --help                Show this help message`);
}

async function main() {
  const args = parseBuildBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const tscPath = path.join(workspaceRoot, "node_modules", "typescript", "bin", "tsc");
  const tscDisplayPath = "node_modules/typescript/bin/tsc";
  // --force exercises the full project graph without deleting generated output; the second scenario is a no-change incremental build.
  const scenarioDefinitions = [
    {
      id: "forced_rebuild",
      args: [tscPath, "-b", "--force"],
      command: ["node", tscDisplayPath, "-b", "--force"],
    },
    {
      id: "incremental_noop",
      args: [tscPath, "-b"],
      command: ["node", tscDisplayPath, "-b"],
    },
  ];
  const context = await collectReportContext();
  const scenarios = scenarioDefinitions.map((scenario) => (
    runScenario(scenario, args.warmupRuns, args.sampleRuns)
  ));
  runCommand(
    process.execPath,
    [path.join(workspaceRoot, "scripts", "verify-workspace-build.mjs")],
    "workspace build verification",
  );

  const report = createBuildBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      projectCount: context.projectCount,
    },
    scenarios,
  });
  const outputPath = await writeReport(args.output, report);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:build] ${scenario.id}: median=${scenario.summary.median}ms p95=${scenario.summary.p95}ms samples=${scenario.summary.sampleCount}`,
    );
  }
  console.log(`[benchmark:build] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:build] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
