import crypto from "node:crypto";
import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  createPowerShellGatewayPreflightRunner,
  preflightGatewayCleanup,
} from "../packages/star-sanctuary-distribution/src/gateway-preflight.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/p2-d04-s001-real-process.json";
const fixturePort = 29999;
const childReadyTimeoutMs = 5_000;
const childExitTimeoutMs = 5_000;
const execFileAsync = promisify(execFile);
const scenarioDefinitions = [
  { id: "preflight_real_powershell", operation: "preflightGatewayCleanup", usesChild: false },
  { id: "child_real_launch_cleanup", operation: "spawn node benchmark child", usesChild: true },
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

export function parseGatewayStartupRealBenchmarkArgs(argv) {
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
    throw new Error("Scenario does not match the fixed real-process D04 definition.");
  }
  for (const field of ["samplesMs", "invocationCounts", "cleanupStatuses"]) {
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
    const isValid = expected.usesChild ? count === 1 : count === 0 || count === 1;
    if (!Number.isInteger(count) || !isValid) {
      throw new Error(`${scenario.id} contains an invalid real invocation count.`);
    }
  }
  if (expected.usesChild) {
    if (!Array.isArray(scenario.childPids) || scenario.childPids.length !== sampleRuns
      || !scenario.childPids.every((pid) => Number.isInteger(pid) && pid > 0)) {
      throw new Error("child_real_launch_cleanup must record one child pid per sample.");
    }
    if (!Array.isArray(scenario.childExitCodes) || scenario.childExitCodes.length !== sampleRuns
      || !scenario.childExitCodes.every((code) => code === 0)) {
      throw new Error("child_real_launch_cleanup must record clean zero exits.");
    }
    if (!scenario.cleanupStatuses.every((status) => status === "cleaned")) {
      throw new Error("child_real_launch_cleanup must clean every child.");
    }
  } else if (!scenario.cleanupStatuses.every((status) => status === "not_required")) {
    throw new Error("preflight_real_powershell must not claim child cleanup.");
  }
}

export function createGatewayStartupRealBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  if (fixture?.port !== fixturePort) {
    throw new Error(`fixture.port must be ${fixturePort}.`);
  }
  if (fixture?.usesRealPowerShell !== true || fixture?.usesRealChildProcess !== true) {
    throw new Error("D04 real-process reports require real PowerShell and child-process fixtures.");
  }
  if (fixture?.startsGateway !== false || fixture?.opensListeningPort !== false) {
    throw new Error("D04 real-process reports must not start a gateway or listening port.");
  }
  if (!Array.isArray(scenarios) || scenarios.length !== scenarioDefinitions.length) {
    throw new Error("D04 real-process reports require exactly two fixed scenarios.");
  }
  const seen = new Set();
  const normalizedScenarios = scenarios.map((scenario) => {
    validateScenario(scenario, sampleRuns);
    if (seen.has(scenario.id)) {
      throw new Error(`${scenario.id} must occur only once.`);
    }
    seen.add(scenario.id);
    const samplesMs = scenario.samplesMs.map((sample) => round(sample));
    const normalized = {
      id: scenario.id,
      operation: scenario.operation,
      samplesMs,
      invocationCounts: [...scenario.invocationCounts],
      cleanupStatuses: [...scenario.cleanupStatuses],
      summary: summarizeSamples(samplesMs, "milliseconds"),
      invocationSummary: summarizeSamples(scenario.invocationCounts, "count"),
    };
    if (scenario.childPids) normalized.childPids = [...scenario.childPids];
    if (scenario.childExitCodes) normalized.childExitCodes = [...scenario.childExitCodes];
    return normalized;
  });
  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "distribution-gateway-startup-real-process",
      mode: "report_only",
      executionMode: "isolated_real_process",
      thresholdApplied: false,
      usesRealPowerShell: true,
      usesRealChildProcess: true,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      port: fixturePort,
      usesRealPowerShell: true,
      usesRealChildProcess: true,
      startsGateway: false,
      opensListeningPort: false,
    },
    scenarios: normalizedScenarios,
  };
}

async function assertRealProcessPrerequisites() {
  if (process.platform !== "win32") {
    throw new Error("D04 real-process benchmark requires Windows and powershell.exe.");
  }
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$PSVersionTable.PSVersion.ToString()",
  ], { windowsHide: true });
  const powerShellVersion = String(stdout).trim();
  if (!powerShellVersion) {
    throw new Error("D04 real-process benchmark could not determine the PowerShell version.");
  }
  return { powerShellPath: "powershell.exe", powerShellVersion };
}

async function createFixture() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "star-sanctuary-d04-real-"));
  await fs.writeFile(path.join(stateDir, ".env"), `BELLDANDY_PORT=${fixturePort}\n`, "utf-8");
  await fs.writeFile(path.join(stateDir, ".env.local"), "# D04 isolated real-process fixture\n", "utf-8");
  return { stateDir, port: fixturePort };
}

async function runRealPreflight(fixture) {
  const sourceRunner = createPowerShellGatewayPreflightRunner();
  let invocationCount = 0;
  const runner = {
    ...sourceRunner,
    async findPortOwner(port) {
      invocationCount += 1;
      return await sourceRunner.findPortOwner(port);
    },
  };
  const startedAt = performance.now();
  const result = await preflightGatewayCleanup({
    label: "D04 real benchmark",
    stateDir: fixture.stateDir,
    env: { BELLDANDY_PORT: String(fixture.port) },
    port: fixture.port,
    ownershipTokens: [`d04-real-benchmark-never-owned-${process.pid}`],
    logger: { log() {}, warn() {} },
    runner,
  });
  const durationMs = performance.now() - startedAt;
  if (result.port !== fixture.port || result.cleanedPids.length !== 0) {
    throw new Error("D04 real preflight fixture observed a port owner or attempted cleanup.");
  }
  return { durationMs, invocationCount, cleanupStatus: "not_required" };
}

function waitForChildReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => finish(new Error("D04 benchmark child did not become ready.")), childReadyTimeoutMs);
    const finish = (error) => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error); else resolve();
    };
    const onData = (chunk) => {
      stdout += String(chunk);
      if (stdout.includes("ready\n")) finish();
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => finish(new Error(`D04 benchmark child exited before ready (${code ?? signal ?? "unknown"}).`));
    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("D04 benchmark child did not exit during cleanup.")), childExitTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function stopBenchmarkChild(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.stdin?.end("stop\n");
  }
  try {
    return await waitForChildExit(child);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill();
    }
    const terminal = await waitForChildExit(child);
    if (terminal.code !== 0 || terminal.signal) {
      throw new Error(`D04 benchmark child cleanup failed after fallback: ${error instanceof Error ? error.message : String(error)}`);
    }
    return terminal;
  }
}

async function runRealChild() {
  const startedAt = performance.now();
  const child = spawn(process.execPath, ["-e", [
    "process.stdin.setEncoding('utf8');",
    "process.stdout.write('ready\\n');",
    "process.stdin.on('data', (value) => { if (value.includes('stop')) process.exit(0); });",
    "setInterval(() => {}, 1000);",
  ].join("")], {
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let cleaned = false;
  try {
    await waitForChildReady(child);
    const terminal = await stopBenchmarkChild(child);
    cleaned = true;
    if (!Number.isInteger(child.pid) || !child.pid || terminal.code !== 0 || terminal.signal) {
      throw new Error("D04 benchmark child did not exit cleanly.");
    }
    return {
      durationMs: performance.now() - startedAt,
      invocationCount: 1,
      cleanupStatus: "cleaned",
      childPid: child.pid,
      childExitCode: terminal.code,
    };
  } finally {
    if (!cleaned && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await waitForChildExit(child);
    }
  }
}

async function runScenario(definition, fixture, warmupRuns, sampleRuns) {
  const runOnce = definition.usesChild
    ? () => runRealChild()
    : () => runRealPreflight(fixture);
  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:gateway-startup-real] ${definition.id} warm-up ${index + 1}/${warmupRuns}`);
    await runOnce();
  }
  const samplesMs = [];
  const invocationCounts = [];
  const cleanupStatuses = [];
  const childPids = [];
  const childExitCodes = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:gateway-startup-real] ${definition.id} sample ${index + 1}/${sampleRuns}`);
    const result = await runOnce();
    samplesMs.push(result.durationMs);
    invocationCounts.push(result.invocationCount);
    cleanupStatuses.push(result.cleanupStatus);
    if (definition.usesChild) {
      childPids.push(result.childPid);
      childExitCodes.push(result.childExitCode);
    }
  }
  return {
    id: definition.id,
    operation: definition.operation,
    samplesMs,
    invocationCounts,
    cleanupStatuses,
    ...(definition.usesChild ? { childPids, childExitCodes } : {}),
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readGit(args) {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf-8", shell: false, windowsHide: true });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

async function collectReportContext(powerShell) {
  const lockfile = await fs.readFile(path.join(workspaceRoot, "pnpm-lock.yaml"));
  const status = readGit(["status", "--porcelain"]);
  return {
    environment: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      powerShellPath: powerShell.powerShellPath,
      powerShellVersion: powerShell.powerShellVersion,
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
  console.log(`Usage: node --import tsx scripts/run-gateway-startup-real-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per phase (default: 1)
  --sample-runs <n>     Measured runs per phase (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parseGatewayStartupRealBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const powerShell = await assertRealProcessPrerequisites();
  const [fixture, context] = await Promise.all([createFixture(), collectReportContext(powerShell)]);
  try {
    const scenarios = [];
    for (const definition of scenarioDefinitions) {
      scenarios.push(await runScenario(definition, fixture, args.warmupRuns, args.sampleRuns));
    }
    const report = createGatewayStartupRealBenchmarkReport({
      generatedAt: new Date().toISOString(),
      environment: context.environment,
      source: context.source,
      fixture: {
        warmupRuns: args.warmupRuns,
        sampleRuns: args.sampleRuns,
        port: fixture.port,
        usesRealPowerShell: true,
        usesRealChildProcess: true,
        startsGateway: false,
        opensListeningPort: false,
      },
      scenarios,
    });
    const outputPath = await writeReport(args.output, report);
    for (const scenario of report.scenarios) {
      console.log(`[benchmark:gateway-startup-real] ${scenario.id}: median=${scenario.summary.median}ms p95=${scenario.summary.p95}ms calls=${scenario.invocationSummary.p95}`);
    }
    console.log(`[benchmark:gateway-startup-real] report-only: ${outputPath}`);
  } finally {
    await fs.rm(fixture.stateDir, { recursive: true, force: true });
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:gateway-startup-real] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
