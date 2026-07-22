import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createGatewayLaunchConfig } from "../packages/star-sanctuary-distribution/src/gateway-launch-config.ts";
import { preflightGatewayCleanup } from "../packages/star-sanctuary-distribution/src/gateway-preflight.ts";
import { createGatewaySupervisorLifecycle } from "../packages/star-sanctuary-distribution/src/gateway-supervisor-lifecycle.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/p2-d04-gateway-startup.json";
const fixturePort = 29999;
const scenarioDefinitions = [
  { id: "launch_config", operation: "createGatewayLaunchConfig" },
  { id: "preflight_fake_runner", operation: "preflightGatewayCleanup" },
  { id: "lifecycle_fake_launch", operation: "createGatewaySupervisorLifecycle.start" },
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

export function parseGatewayStartupBenchmarkArgs(argv) {
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

function validateScenario(scenario, sampleRuns) {
  const expected = scenarioDefinitions.find((definition) => definition.id === scenario?.id);
  if (!expected || scenario.operation !== expected.operation) {
    throw new Error("Scenario does not match the fixed D04 definition.");
  }
  for (const field of ["samplesMs", "invocationCounts"]) {
    if (!Array.isArray(scenario[field]) || scenario[field].length !== sampleRuns) {
      throw new Error(`${scenario.id}.${field} must contain exactly ${sampleRuns} samples.`);
    }
  }
  for (const sample of scenario.samplesMs) {
    if (!Number.isFinite(sample) || sample < 0) {
      throw new Error(`${scenario.id} contains an invalid duration sample.`);
    }
  }
  for (const count of scenario.invocationCounts) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`${scenario.id} contains an invalid invocation count.`);
    }
  }
}

export function createGatewayStartupBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  if (fixture?.envFilesPreexisting !== 2) {
    throw new Error("fixture.envFilesPreexisting must be 2.");
  }
  if (fixture?.port !== fixturePort) {
    throw new Error(`fixture.port must be ${fixturePort}.`);
  }
  if (fixture?.usesRealPowerShell !== false || fixture?.usesRealChildProcess !== false) {
    throw new Error("D04 only supports fake PowerShell and child-process fixtures.");
  }
  if (!Array.isArray(scenarios) || scenarios.length !== scenarioDefinitions.length) {
    throw new Error("D04 requires exactly the fixed startup scenarios.");
  }

  const seen = new Set();
  const normalizedScenarios = scenarios.map((scenario) => {
    validateScenario(scenario, sampleRuns);
    if (seen.has(scenario.id)) {
      throw new Error(`${scenario.id} must occur only once.`);
    }
    seen.add(scenario.id);
    const samplesMs = scenario.samplesMs.map((sample) => round(sample));
    return {
      id: scenario.id,
      operation: scenario.operation,
      samplesMs,
      invocationCounts: [...scenario.invocationCounts],
      summary: summarizeSamples(samplesMs, "milliseconds"),
      invocationSummary: summarizeSamples(scenario.invocationCounts, "count"),
    };
  });

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "distribution-gateway-startup-orchestration",
      mode: "report_only",
      thresholdApplied: false,
      usesRealPowerShell: false,
      usesRealChildProcess: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      envFilesPreexisting: 2,
      port: fixturePort,
      usesRealPowerShell: false,
      usesRealChildProcess: false,
    },
    scenarios: normalizedScenarios,
  };
}

async function createFixture() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "star-sanctuary-d04-startup-"));
  await fs.writeFile(path.join(stateDir, ".env"), `BELLDANDY_PORT=${fixturePort}\nAUTO_OPEN_BROWSER=false\n`, "utf-8");
  await fs.writeFile(path.join(stateDir, ".env.local"), "# fixed D04 benchmark fixture\n", "utf-8");
  return { stateDir };
}

function runLaunchConfig(fixture) {
  const startedAt = performance.now();
  const launchConfig = createGatewayLaunchConfig({}, fixture.stateDir);
  const durationMs = performance.now() - startedAt;
  if (launchConfig.port !== fixturePort || launchConfig.env.AUTO_OPEN_BROWSER !== "false") {
    throw new Error("D04 launch config fixture was not loaded from the fixed temporary env files.");
  }
  return { durationMs, invocationCount: 0 };
}

async function runPreflight(fixture) {
  let invocationCount = 0;
  const runner = {
    inspectProcess: async () => {
      invocationCount += 1;
      return null;
    },
    findPortOwner: async () => {
      invocationCount += 1;
      return null;
    },
    forceKill: async () => {
      invocationCount += 1;
    },
  };
  const startedAt = performance.now();
  const result = await preflightGatewayCleanup({
    label: "D04 benchmark",
    stateDir: fixture.stateDir,
    env: { BELLDANDY_PORT: String(fixturePort) },
    ownershipTokens: ["star-sanctuary-benchmark"],
    runner,
    logger: { log: () => {}, warn: () => {} },
  });
  const durationMs = performance.now() - startedAt;
  if (result.port !== fixturePort || result.cleanedPids.length !== 0 || invocationCount !== 1) {
    throw new Error("D04 preflight fixture unexpectedly observed residual process state.");
  }
  return { durationMs, invocationCount };
}

async function runLifecycle() {
  let launchCount = 0;
  let removedForegroundPidCount = 0;
  const listeners = new Map();
  const childListeners = new Map();
  const child = {
    pid: 42424,
    killed: false,
    kill: () => {
      child.killed = true;
      return true;
    },
    once: (event, listener) => {
      childListeners.set(event, listener);
    },
  };
  const lifecycle = createGatewaySupervisorLifecycle({
    label: "D04 benchmark",
    launch: async () => {
      launchCount += 1;
      return child;
    },
    removeForegroundPid: () => {
      removedForegroundPidCount += 1;
    },
    onExit: () => {},
    signalTarget: {
      on: (signal, listener) => listeners.set(signal, listener),
      off: (signal) => listeners.delete(signal),
    },
    logger: { log: () => {}, error: () => {} },
  });
  const startedAt = performance.now();
  await lifecycle.start();
  const durationMs = performance.now() - startedAt;
  if (
    launchCount !== 1
    || removedForegroundPidCount !== 0
    || listeners.size !== 2
    || childListeners.size !== 2
    || child.killed
  ) {
    throw new Error("D04 lifecycle fixture did not remain an inert fake-child start.");
  }
  return { durationMs, invocationCount: launchCount };
}

async function runScenario(definition, fixture, warmupRuns, sampleRuns) {
  const runOnce = definition.id === "launch_config"
    ? () => runLaunchConfig(fixture)
    : definition.id === "preflight_fake_runner"
      ? () => runPreflight(fixture)
      : () => runLifecycle();

  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:gateway-startup] ${definition.id} warm-up ${index + 1}/${warmupRuns}`);
    await runOnce();
  }

  const samplesMs = [];
  const invocationCounts = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:gateway-startup] ${definition.id} sample ${index + 1}/${sampleRuns}`);
    const result = await runOnce();
    samplesMs.push(result.durationMs);
    invocationCounts.push(result.invocationCount);
  }
  return { id: definition.id, operation: definition.operation, samplesMs, invocationCounts };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
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
  console.log(`Usage: node --import tsx scripts/run-gateway-startup-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per phase (default: 1)
  --sample-runs <n>     Measured runs per phase (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parseGatewayStartupBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [fixture, context] = await Promise.all([createFixture(), collectReportContext()]);
  try {
    const scenarios = [];
    for (const definition of scenarioDefinitions) {
      scenarios.push(await runScenario(definition, fixture, args.warmupRuns, args.sampleRuns));
    }
    const report = createGatewayStartupBenchmarkReport({
      generatedAt: new Date().toISOString(),
      environment: context.environment,
      source: context.source,
      fixture: {
        warmupRuns: args.warmupRuns,
        sampleRuns: args.sampleRuns,
        envFilesPreexisting: 2,
        port: fixturePort,
        usesRealPowerShell: false,
        usesRealChildProcess: false,
      },
      scenarios,
    });
    const outputPath = await writeReport(args.output, report);
    for (const scenario of report.scenarios) {
      console.log(
        `[benchmark:gateway-startup] ${scenario.id}: median=${scenario.summary.median}ms p95=${scenario.summary.p95}ms calls=${scenario.invocationSummary.p95}`,
      );
    }
    console.log(`[benchmark:gateway-startup] report-only: ${outputPath}`);
  } finally {
    await fs.rm(fixture.stateDir, { recursive: true, force: true });
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:gateway-startup] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
