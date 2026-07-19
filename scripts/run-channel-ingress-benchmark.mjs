import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/b00-channel-ingress.json";
const defaultPayloadBytes = 256;
const defaultChannelCount = 4;
const defaultMaxConcurrent = 4;
const defaultMaxConcurrentPerChannel = 2;
const defaultScenarios = [
  { id: "burst_100", messageCount: 100, sessionCount: 10 },
  { id: "burst_1000", messageCount: 1_000, sessionCount: 100 },
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

export function parseChannelIngressBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    // pnpm run <script> -- <args> 会将分隔符传给脚本，兼容该标准调用形式。
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

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

export function createChannelIngressBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  const payloadBytes = parseCount(fixture?.payloadBytes, "fixture.payloadBytes", { allowZero: true });
  const channelCount = parseCount(fixture?.channelCount, "fixture.channelCount");
  const maxConcurrent = parseCount(fixture?.maxConcurrent, "fixture.maxConcurrent");
  const maxConcurrentPerChannel = parseCount(
    fixture?.maxConcurrentPerChannel,
    "fixture.maxConcurrentPerChannel",
  );

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("At least one benchmark scenario is required.");
  }

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "channel-ingress-fake-adapter",
      mode: "report_only",
      adapter: "in_memory_fake",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      payloadBytes,
      channelCount,
      maxConcurrent,
      maxConcurrentPerChannel,
    },
    scenarios: scenarios.map((scenario) => {
      if (typeof scenario?.id !== "string" || !scenario.id) {
        throw new Error("Each benchmark scenario requires an id.");
      }
      if (scenario.operation !== "ChannelIngressScheduler.enqueue") {
        throw new Error(`${scenario.id} must identify the ChannelIngressScheduler.enqueue operation.`);
      }
      const messageCount = parseCount(scenario.messageCount, `${scenario.id}.messageCount`);
      const sessionCount = parseCount(scenario.sessionCount, `${scenario.id}.sessionCount`);
      const completedCount = requireNonNegativeInteger(
        scenario.completedCount,
        `${scenario.id}.completedCount`,
      );
      if (completedCount !== messageCount) {
        throw new Error(`${scenario.id}.completedCount must equal messageCount.`);
      }
      requireSamples(scenario.samplesMs, sampleRuns, scenario.id);
      return {
        id: scenario.id,
        operation: scenario.operation,
        messageCount,
        sessionCount,
        completedCount,
        samplesMs: scenario.samplesMs.map((sample) => round(sample)),
        summary: summarizeSamples(scenario.samplesMs),
      };
    }),
  };
}

async function loadChannelIngressScheduler() {
  const moduleUrl = pathToFileURL(
    path.join(workspaceRoot, "packages", "belldandy-channels", "src", "channel-ingress-scheduler.ts"),
  ).href;
  const module = await import(moduleUrl);
  if (typeof module.ChannelIngressScheduler !== "function") {
    throw new Error("ChannelIngressScheduler source module did not expose ChannelIngressScheduler.");
  }
  return module.ChannelIngressScheduler;
}

async function runBurst(ChannelIngressScheduler, scenario) {
  const scheduler = new ChannelIngressScheduler({
    maxConcurrent: defaultMaxConcurrent,
    maxConcurrentPerChannel: defaultMaxConcurrentPerChannel,
    maxPendingPerSession: Math.ceil(scenario.messageCount / scenario.sessionCount) + 1,
    maxQueued: scenario.messageCount,
    maxPayloadBytes: defaultPayloadBytes,
    maxQueuedPayloadBytes: scenario.messageCount * defaultPayloadBytes,
    maxWaitMs: 30_000,
  });
  try {
    const completions = [];
    let completedCount = 0;
    const startedAt = performance.now();
    for (let index = 0; index < scenario.messageCount; index += 1) {
      const result = scheduler.enqueue({
        channel: `benchmark-channel-${index % defaultChannelCount}`,
        sessionKey: `benchmark-session-${index % scenario.sessionCount}`,
        payloadBytes: defaultPayloadBytes,
        run: () => {
          completedCount += 1;
        },
      });
      if (!result.accepted || result.coalesced) {
        throw new Error(`${scenario.id} rejected or coalesced a fixed fake-adapter task.`);
      }
      completions.push(result.completion);
    }
    const completionResults = await Promise.all(completions);
    const durationMs = performance.now() - startedAt;
    if (completedCount !== scenario.messageCount) {
      throw new Error(`${scenario.id} completed ${completedCount} fake tasks instead of ${scenario.messageCount}.`);
    }
    if (!completionResults.every((result) => result.status === "completed")) {
      throw new Error(`${scenario.id} did not settle every fake-adapter task as completed.`);
    }
    const globalSnapshot = scheduler.getRuntimeSnapshots().find((snapshot) => snapshot.id === "channel_ingress");
    if (!globalSnapshot || globalSnapshot.activeCount !== 0 || globalSnapshot.queuedCount !== 0) {
      throw new Error(`${scenario.id} did not fully drain the Channel ingress scheduler.`);
    }
    return {
      durationMs,
      completedCount,
    };
  } finally {
    scheduler.close();
  }
}

async function runScenario(ChannelIngressScheduler, scenario, warmupRuns, sampleRuns) {
  let completedCount = null;
  const runOnce = async () => {
    const result = await runBurst(ChannelIngressScheduler, scenario);
    if (completedCount === null) {
      completedCount = result.completedCount;
    } else if (result.completedCount !== completedCount) {
      throw new Error(`${scenario.id} completed an unstable fake-adapter task count.`);
    }
    return result.durationMs;
  };

  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:channel-ingress] ${scenario.id} warm-up ${index + 1}/${warmupRuns}`);
    await runOnce();
  }

  const samplesMs = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:channel-ingress] ${scenario.id} sample ${index + 1}/${sampleRuns}`);
    samplesMs.push(await runOnce());
  }

  return {
    id: scenario.id,
    operation: "ChannelIngressScheduler.enqueue",
    messageCount: scenario.messageCount,
    sessionCount: scenario.sessionCount,
    completedCount,
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
  const [rootPackage, channelsPackage] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "packages", "belldandy-channels", "package.json"), "utf-8").then(JSON.parse),
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
      channelsPackageVersion: channelsPackage.version,
      ci: process.env.CI === "true" || process.env.CI === "1" || Boolean(process.env.GITHUB_ACTIONS),
    },
    source: {
      commit: readGit(["rev-parse", "HEAD"]),
      workspaceDirty: status === null ? null : status.length > 0,
      lockfileSha256: await sha256File(path.join(workspaceRoot, "pnpm-lock.yaml")),
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
  console.log(`Usage: node --import tsx scripts/run-channel-ingress-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up fake-adapter bursts per scenario (default: 1)
  --sample-runs <n>     Measured fake-adapter bursts per scenario (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parseChannelIngressBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [ChannelIngressScheduler, context] = await Promise.all([
    loadChannelIngressScheduler(),
    collectReportContext(),
  ]);
  const scenarios = [];
  for (const scenario of defaultScenarios) {
    scenarios.push(await runScenario(
      ChannelIngressScheduler,
      scenario,
      args.warmupRuns,
      args.sampleRuns,
    ));
  }

  const report = createChannelIngressBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      payloadBytes: defaultPayloadBytes,
      channelCount: defaultChannelCount,
      maxConcurrent: defaultMaxConcurrent,
      maxConcurrentPerChannel: defaultMaxConcurrentPerChannel,
    },
    scenarios,
  });
  const outputPath = await writeReport(args.output, report);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:channel-ingress] ${scenario.id}: median=${scenario.summary.median}ms p95=${scenario.summary.p95}ms samples=${scenario.summary.sampleCount}`,
    );
  }
  console.log(`[benchmark:channel-ingress] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:channel-ingress] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
