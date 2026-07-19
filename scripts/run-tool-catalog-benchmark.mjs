import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/b00-tool-catalog.json";
const defaultToolDefinitionCounts = [10, 100, 500, 1_000];
const defaultOperationsPerSample = 25;
const benchmarkAgentId = "benchmark-agent";
const benchmarkConversationId = "benchmark-conversation";

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseCount(value, label, { allowZero = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseToolCatalogBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
    operationsPerSample: defaultOperationsPerSample,
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
      args.warmupRuns = parseCount(value, argument, { allowZero: true, maximum: 100 });
    } else if (argument === "--sample-runs") {
      args.sampleRuns = parseCount(value, argument, { maximum: 100 });
    } else if (argument === "--operations-per-sample") {
      args.operationsPerSample = parseCount(value, argument, { maximum: 10_000 });
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
    unit: "milliseconds_per_operation",
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

function normalizeFixtureCounts(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
  const normalized = value.map((entry, index) => parseCount(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return normalized;
}

export function createToolCatalogBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", {
    allowZero: true,
    maximum: 100,
  });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns", { maximum: 100 });
  const operationsPerSample = parseCount(
    fixture?.operationsPerSample,
    "fixture.operationsPerSample",
    { maximum: 10_000 },
  );
  const toolDefinitionCounts = normalizeFixtureCounts(
    fixture?.toolDefinitionCounts,
    "fixture.toolDefinitionCounts",
  );
  if (!Array.isArray(scenarios) || scenarios.length !== toolDefinitionCounts.length) {
    throw new Error("Each fixed Tool catalog size requires exactly one benchmark scenario.");
  }

  const expectedCounts = new Set(toolDefinitionCounts);
  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "tool-executor-catalog-scan",
      mode: "report_only",
      executor: "real_tool_executor",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      operationsPerSample,
      toolDefinitionCounts,
    },
    scenarios: scenarios.map((scenario) => {
      if (typeof scenario?.id !== "string" || !scenario.id) {
        throw new Error("Each benchmark scenario requires an id.");
      }
      if (scenario.operation !== "ToolExecutor.getDefinitions") {
        throw new Error(`${scenario.id} must identify the ToolExecutor.getDefinitions operation.`);
      }
      const toolDefinitionCount = parseCount(
        scenario.toolDefinitionCount,
        `${scenario.id}.toolDefinitionCount`,
      );
      if (!expectedCounts.delete(toolDefinitionCount)) {
        throw new Error(`${scenario.id} does not map to a unique configured Tool catalog size.`);
      }
      const toolDefinitionBytes = parseCount(
        scenario.toolDefinitionBytes,
        `${scenario.id}.toolDefinitionBytes`,
      );
      const catalogGeneration = parseCount(
        scenario.catalogGeneration,
        `${scenario.id}.catalogGeneration`,
      );
      const resultCount = parseCount(scenario.resultCount, `${scenario.id}.resultCount`);
      if (catalogGeneration !== toolDefinitionCount || resultCount !== toolDefinitionCount) {
        throw new Error(`${scenario.id} must preserve catalog generation and definition count.`);
      }
      requireSamples(scenario.samplesMs, sampleRuns, scenario.id);
      return {
        id: scenario.id,
        operation: scenario.operation,
        toolDefinitionCount,
        toolDefinitionBytes,
        catalogGeneration,
        resultCount,
        samplesMs: scenario.samplesMs.map((sample) => round(sample)),
        summary: summarizeSamples(scenario.samplesMs),
      };
    }),
  };
}

function buildSyntheticTools(count) {
  return Array.from({ length: count }, (_, index) => ({
    definition: {
      name: `benchmark_tool_${index}`,
      description: `Deterministic catalog benchmark Tool ${index}. ${"d".repeat(64)}`,
      shortDescription: `Catalog Tool ${index}`,
      keywords: ["benchmark", `group-${index % 8}`],
      tags: ["synthetic"],
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Fixed synthetic benchmark input.",
          },
        },
        required: ["input"],
        additionalProperties: false,
      },
    },
    async execute() {
      throw new Error("The Tool catalog benchmark must not execute synthetic tools.");
    },
  }));
}

async function loadToolExecutor() {
  const moduleUrl = pathToFileURL(
    path.join(workspaceRoot, "packages", "belldandy-skills", "src", "executor.ts"),
  ).href;
  const module = await import(moduleUrl);
  if (typeof module.ToolExecutor !== "function") {
    throw new Error("Skills source module did not expose ToolExecutor.");
  }
  return module.ToolExecutor;
}

function createExecutor(ToolExecutor, toolDefinitionCount) {
  return new ToolExecutor({
    workspaceRoot,
    tools: buildSyntheticTools(toolDefinitionCount),
    isToolDisabled: () => false,
    isToolAllowedForAgent: () => true,
    isToolAllowedInConversation: () => true,
  });
}

function runCatalogBatch(executor, toolDefinitionCount, operationsPerSample) {
  let resultCount = null;
  const startedAt = performance.now();
  for (let index = 0; index < operationsPerSample; index += 1) {
    const definitions = executor.getDefinitions(benchmarkAgentId, benchmarkConversationId);
    if (definitions.length !== toolDefinitionCount) {
      throw new Error(`Tool catalog returned ${definitions.length} definitions instead of ${toolDefinitionCount}.`);
    }
    if (
      definitions[0]?.function.name !== "benchmark_tool_0"
      || definitions.at(-1)?.function.name !== `benchmark_tool_${toolDefinitionCount - 1}`
    ) {
      throw new Error("Tool catalog order or identity changed during the benchmark.");
    }
    resultCount = definitions.length;
  }
  return {
    durationMs: (performance.now() - startedAt) / operationsPerSample,
    resultCount,
  };
}

function runScenario(ToolExecutor, toolDefinitionCount, warmupRuns, sampleRuns, operationsPerSample) {
  const executor = createExecutor(ToolExecutor, toolDefinitionCount);
  const initialDefinitions = executor.getDefinitions(benchmarkAgentId, benchmarkConversationId);
  const toolDefinitionBytes = Buffer.byteLength(JSON.stringify(initialDefinitions), "utf-8");
  const catalogGeneration = executor.getRegistryInventory().catalogGeneration;
  let resultCount = null;
  const runOnce = () => {
    const result = runCatalogBatch(executor, toolDefinitionCount, operationsPerSample);
    if (resultCount === null) {
      resultCount = result.resultCount;
    } else if (result.resultCount !== resultCount) {
      throw new Error(`tool_catalog_${toolDefinitionCount} returned an unstable definition count.`);
    }
    return result.durationMs;
  };

  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:tool-catalog] tool_catalog_${toolDefinitionCount} warm-up ${index + 1}/${warmupRuns}`);
    runOnce();
  }

  const samplesMs = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:tool-catalog] tool_catalog_${toolDefinitionCount} sample ${index + 1}/${sampleRuns}`);
    samplesMs.push(runOnce());
  }

  return {
    id: `tool_catalog_${toolDefinitionCount}`,
    operation: "ToolExecutor.getDefinitions",
    toolDefinitionCount,
    toolDefinitionBytes,
    catalogGeneration,
    resultCount,
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
  const [rootPackage, skillsPackage] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "packages", "belldandy-skills", "package.json"), "utf-8").then(JSON.parse),
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
      skillsPackageVersion: skillsPackage.version,
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
  console.log(`Usage: node --import tsx scripts/run-tool-catalog-benchmark.mjs [options]

Options:
  --output <path>                    JSON report path (default: ${defaultOutput})
  --warmup-runs <n>                  Warm-up batches per Tool catalog size (default: 1)
  --sample-runs <n>                  Measured batches per Tool catalog size (default: 5)
  --operations-per-sample <n>        getDefinitions calls per normalized sample (default: ${defaultOperationsPerSample})
  --help                             Show this help message`);
}

async function main() {
  const args = parseToolCatalogBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [ToolExecutor, context] = await Promise.all([
    loadToolExecutor(),
    collectReportContext(),
  ]);
  const scenarios = defaultToolDefinitionCounts.map((toolDefinitionCount) => runScenario(
    ToolExecutor,
    toolDefinitionCount,
    args.warmupRuns,
    args.sampleRuns,
    args.operationsPerSample,
  ));
  const report = createToolCatalogBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      operationsPerSample: args.operationsPerSample,
      toolDefinitionCounts: defaultToolDefinitionCounts,
    },
    scenarios,
  });
  const outputPath = await writeReport(args.output, report);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:tool-catalog] ${scenario.id}: median=${scenario.summary.median}ms/op p95=${scenario.summary.p95}ms/op samples=${scenario.summary.sampleCount}`,
    );
  }
  console.log(`[benchmark:tool-catalog] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:tool-catalog] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
