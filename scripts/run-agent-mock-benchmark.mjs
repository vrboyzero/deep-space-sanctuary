import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/b00-agent-mock.json";
const defaultHistorySizes = [10, 100, 1_000];
const defaultHistoryEntryBytes = 256;
const defaultToolDefinitionCounts = [0, 10, 100, 500];
const systemPrompt = "You are a deterministic local benchmark fixture. Return the fixed response without tools.";
const mockResponseText = "benchmark complete";
const mockEndpointPrefix = "http://benchmark.invalid/";

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

export function parseAgentMockBenchmarkArgs(argv) {
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

function normalizeFixtureCounts(value, label, { allowZero = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
  const normalized = value.map((entry, index) => parseCount(entry, `${label}[${index}]`, { allowZero }));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return normalized;
}

export function createAgentMockBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  const historyEntryBytes = parseCount(fixture?.historyEntryBytes, "fixture.historyEntryBytes");
  const historySizes = normalizeFixtureCounts(fixture?.historySizes, "fixture.historySizes");
  const systemPromptBytes = requireNonNegativeInteger(fixture?.systemPromptBytes, "fixture.systemPromptBytes");
  const toolDefinitionCounts = normalizeFixtureCounts(
    fixture?.toolDefinitionCounts,
    "fixture.toolDefinitionCounts",
    { allowZero: true },
  );
  const toolDefinitionBytesPerItem = requireNonNegativeInteger(
    fixture?.toolDefinitionBytesPerItem,
    "fixture.toolDefinitionBytesPerItem",
  );
  const mockResponseBytes = requireNonNegativeInteger(fixture?.mockResponseBytes, "fixture.mockResponseBytes");

  if (!Array.isArray(scenarios) || scenarios.length !== historySizes.length * toolDefinitionCounts.length) {
    throw new Error("Each fixed history and Tool catalog combination requires exactly one benchmark scenario.");
  }

  const expectedScenarioKeys = new Set(
    historySizes.flatMap((historyEntries) => toolDefinitionCounts.map(
      (toolDefinitionCount) => `${historyEntries}:${toolDefinitionCount}`,
    )),
  );
  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "tool-agent-mock-run",
      mode: "report_only",
      provider: "strict_local_mock",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      historyEntryBytes,
      historySizes,
      systemPromptBytes,
      toolDefinitionCounts,
      toolDefinitionBytesPerItem,
      mockResponseBytes,
    },
    scenarios: scenarios.map((scenario) => {
      if (typeof scenario?.id !== "string" || !scenario.id) {
        throw new Error("Each benchmark scenario requires an id.");
      }
      const historyEntries = parseCount(scenario.historyEntries, `${scenario.id}.historyEntries`);
      const toolDefinitionCount = parseCount(
        scenario.toolDefinitionCount,
        `${scenario.id}.toolDefinitionCount`,
        { allowZero: true },
      );
      const scenarioKey = `${historyEntries}:${toolDefinitionCount}`;
      if (!expectedScenarioKeys.delete(scenarioKey)) {
        throw new Error(`${scenario.id} does not map to a unique configured history and Tool catalog fixture.`);
      }
      if (scenario.operation !== "ToolEnabledAgent.run") {
        throw new Error(`${scenario.id} must identify the ToolEnabledAgent.run operation.`);
      }
      const toolDefinitionBytes = requireNonNegativeInteger(
        scenario.toolDefinitionBytes,
        `${scenario.id}.toolDefinitionBytes`,
      );
      const modelCallCount = parseCount(scenario.modelCallCount, `${scenario.id}.modelCallCount`);
      requireSamples(scenario.samplesMs, sampleRuns, scenario.id);
      return {
        id: scenario.id,
        historyEntries,
        operation: scenario.operation,
        toolDefinitionCount,
        toolDefinitionBytes,
        modelCallCount,
        samplesMs: scenario.samplesMs.map((sample) => round(sample)),
        summary: summarizeSamples(scenario.samplesMs),
      };
    }),
  };
}

function buildHistoryEntry(index, targetBytes) {
  const prefix = `history-entry-${index} `;
  return `${prefix}${"x".repeat(Math.max(0, targetBytes - Buffer.byteLength(prefix, "utf-8")))}`;
}

function buildHistory(size) {
  return Array.from({ length: size }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: buildHistoryEntry(index, defaultHistoryEntryBytes),
  }));
}

function buildToolDefinitions(count) {
  return Array.from({ length: count }, (_, index) => ({
    type: "function",
    function: {
      name: `benchmark_tool_${index}`,
      description: `Deterministic benchmark tool ${index}. ${"d".repeat(64)}`,
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
  }));
}

function createMockToolExecutor(toolDefinitions) {
  return {
    getDefinitions: () => toolDefinitions,
    getRegisteredToolContract: () => undefined,
    consumeLoadedDeferredToolsForNextTurn: async () => [],
    setTokenCounter: () => {},
    clearTokenCounter: () => {},
    execute: async () => {
      throw new Error("The Agent mock benchmark fixture does not expose tools.");
    },
  };
}

function createMockResponse() {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: mockResponseText,
      },
    }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function loadToolEnabledAgent() {
  const moduleUrl = pathToFileURL(
    path.join(workspaceRoot, "packages", "belldandy-agent", "src", "tool-agent.ts"),
  ).href;
  const module = await import(moduleUrl);
  if (typeof module.ToolEnabledAgent !== "function") {
    throw new Error("ToolEnabledAgent source module did not expose ToolEnabledAgent.");
  }
  return module.ToolEnabledAgent;
}

function createAgent(ToolEnabledAgent, toolDefinitions) {
  return new ToolEnabledAgent({
    baseUrl: `${mockEndpointPrefix}v1`,
    apiKey: "benchmark-mock-key",
    model: "benchmark-mock-model",
    systemPrompt,
    toolExecutor: createMockToolExecutor(toolDefinitions),
    maxRetries: 0,
  });
}

async function runAgentTurn(agent, historySize, runId) {
  const history = buildHistory(historySize);
  const originalFetch = globalThis.fetch;
  let modelCallCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(mockEndpointPrefix)) {
      throw new Error("Agent mock benchmark refused a non-local model request.");
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (!Array.isArray(body?.messages)) {
      throw new Error("Agent mock benchmark received an invalid model request body.");
    }
    modelCallCount += 1;
    return createMockResponse();
  };

  try {
    let finalText = "";
    let terminalStatus = "";
    const startedAt = performance.now();
    for await (const item of agent.run({
      conversationId: `benchmark-agent-${historySize}-${runId}`,
      text: "Return the deterministic benchmark response.",
      history,
    })) {
      if (item.type === "final") {
        finalText = item.text;
      } else if (item.type === "status") {
        terminalStatus = item.status;
      }
    }
    const durationMs = performance.now() - startedAt;
    if (finalText !== mockResponseText || terminalStatus !== "done") {
      throw new Error("Agent mock benchmark did not reach the expected terminal response.");
    }
    if (modelCallCount !== 1) {
      throw new Error(`Agent mock benchmark expected one model request, received ${modelCallCount}.`);
    }
    return {
      durationMs,
      modelCallCount,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runScenario(ToolEnabledAgent, historySize, toolDefinitionCount, warmupRuns, sampleRuns) {
  const toolDefinitions = buildToolDefinitions(toolDefinitionCount);
  const toolDefinitionBytes = Buffer.byteLength(JSON.stringify(toolDefinitions), "utf-8");
  const agent = createAgent(ToolEnabledAgent, toolDefinitions);
  let modelCallCount = null;
  let runIndex = 0;
  const runOnce = async () => {
    const result = await runAgentTurn(agent, historySize, runIndex);
    runIndex += 1;
    if (modelCallCount === null) {
      modelCallCount = result.modelCallCount;
    } else if (result.modelCallCount !== modelCallCount) {
      throw new Error(`history_${historySize}_tools_${toolDefinitionCount} used an unstable model request count.`);
    }
    return result.durationMs;
  };

  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:agent-mock] history_${historySize}_tools_${toolDefinitionCount} warm-up ${index + 1}/${warmupRuns}`);
    await runOnce();
  }

  const samplesMs = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:agent-mock] history_${historySize}_tools_${toolDefinitionCount} sample ${index + 1}/${sampleRuns}`);
    samplesMs.push(await runOnce());
  }

  return {
    id: `history_${historySize}_tools_${toolDefinitionCount}`,
    historyEntries: historySize,
    operation: "ToolEnabledAgent.run",
    toolDefinitionCount,
    toolDefinitionBytes,
    modelCallCount,
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
  const [rootPackage, agentPackage] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "packages", "belldandy-agent", "package.json"), "utf-8").then(JSON.parse),
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
      agentPackageVersion: agentPackage.version,
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
  console.log(`Usage: node --import tsx scripts/run-agent-mock-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up Agent runs per history/Tool fixture (default: 1)
  --sample-runs <n>     Measured Agent runs per history/Tool fixture (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parseAgentMockBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [ToolEnabledAgent, context] = await Promise.all([
    loadToolEnabledAgent(),
    collectReportContext(),
  ]);
  const scenarios = [];
  for (const historySize of defaultHistorySizes) {
    for (const toolDefinitionCount of defaultToolDefinitionCounts) {
      scenarios.push(await runScenario(
        ToolEnabledAgent,
        historySize,
        toolDefinitionCount,
        args.warmupRuns,
        args.sampleRuns,
      ));
    }
  }
  const representativeToolDefinition = buildToolDefinitions(1)[0];

  const report = createAgentMockBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      historyEntryBytes: defaultHistoryEntryBytes,
      historySizes: defaultHistorySizes,
      systemPromptBytes: Buffer.byteLength(systemPrompt, "utf-8"),
      toolDefinitionCounts: defaultToolDefinitionCounts,
      toolDefinitionBytesPerItem: Buffer.byteLength(JSON.stringify(representativeToolDefinition), "utf-8"),
      mockResponseBytes: Buffer.byteLength(mockResponseText, "utf-8"),
    },
    scenarios,
  });
  const outputPath = await writeReport(args.output, report);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:agent-mock] ${scenario.id}: median=${scenario.summary.median}ms p95=${scenario.summary.p95}ms samples=${scenario.summary.sampleCount}`,
    );
  }
  console.log(`[benchmark:agent-mock] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:agent-mock] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
