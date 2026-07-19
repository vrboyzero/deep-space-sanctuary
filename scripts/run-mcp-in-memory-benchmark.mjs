import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/b00-mcp-in-memory.json";
const defaultCatalogSizes = [1, 100, 500];
const defaultPayloadBytes = 256;
const defaultCallOperationsPerSample = 10;
const lifecycleOperations = [
  "MCPClient.connect+discover",
  "MCPClient.callTool",
  "MCPClient.readResource",
  "MCPClient.disconnect",
];

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

export function parseMcpInMemoryBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
    callOperationsPerSample: defaultCallOperationsPerSample,
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
    } else if (argument === "--call-operations-per-sample") {
      args.callOperationsPerSample = parseCount(value, argument, { maximum: 1_000 });
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

export function createMcpInMemoryBenchmarkReport({
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
  const callOperationsPerSample = parseCount(
    fixture?.callOperationsPerSample,
    "fixture.callOperationsPerSample",
    { maximum: 1_000 },
  );
  const catalogSizes = normalizeFixtureCounts(fixture?.catalogSizes, "fixture.catalogSizes");
  const payloadBytes = parseCount(fixture?.payloadBytes, "fixture.payloadBytes", { maximum: 1_048_576 });
  if (!Array.isArray(scenarios) || scenarios.length !== catalogSizes.length * lifecycleOperations.length) {
    throw new Error("Each catalog size requires every MCP lifecycle operation exactly once.");
  }

  const expectedScenarioKeys = new Set(
    catalogSizes.flatMap((catalogSize) => lifecycleOperations.map(
      (operation) => `${catalogSize}:${operation}`,
    )),
  );
  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "mcp-client-in-memory-lifecycle",
      mode: "report_only",
      adapter: "sdk_in_memory_linked_pair",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      callOperationsPerSample,
      catalogSizes,
      payloadBytes,
    },
    scenarios: scenarios.map((scenario) => {
      if (typeof scenario?.id !== "string" || !scenario.id) {
        throw new Error("Each benchmark scenario requires an id.");
      }
      if (!lifecycleOperations.includes(scenario.operation)) {
        throw new Error(`${scenario.id} has an unsupported MCP lifecycle operation.`);
      }
      const catalogSize = parseCount(scenario.catalogSize, `${scenario.id}.catalogSize`);
      const scenarioKey = `${catalogSize}:${scenario.operation}`;
      if (!expectedScenarioKeys.delete(scenarioKey)) {
        throw new Error(`${scenario.id} does not map to a unique configured MCP lifecycle operation.`);
      }
      const toolCount = parseCount(scenario.toolCount, `${scenario.id}.toolCount`);
      const resourceCount = parseCount(scenario.resourceCount, `${scenario.id}.resourceCount`);
      if (toolCount !== catalogSize || resourceCount !== catalogSize) {
        throw new Error(`${scenario.id} must preserve the configured Tool and Resource counts.`);
      }
      const operationsPerSample = parseCount(
        scenario.operationsPerSample,
        `${scenario.id}.operationsPerSample`,
      );
      const expectedOperations = scenario.operation === "MCPClient.callTool"
        || scenario.operation === "MCPClient.readResource"
        ? callOperationsPerSample
        : 1;
      if (operationsPerSample !== expectedOperations) {
        throw new Error(`${scenario.id} has an invalid operations-per-sample count.`);
      }
      requireSamples(scenario.samplesMs, sampleRuns, scenario.id);
      return {
        id: scenario.id,
        operation: scenario.operation,
        catalogSize,
        toolCount,
        resourceCount,
        operationsPerSample,
        samplesMs: scenario.samplesMs.map((sample) => round(sample)),
        summary: summarizeSamples(scenario.samplesMs),
      };
    }),
  };
}

function buildPayload(prefix, targetBytes) {
  const prefixBytes = Buffer.byteLength(prefix, "utf-8");
  if (prefixBytes > targetBytes) {
    throw new Error(`Payload prefix exceeds the ${targetBytes}-byte fixture budget.`);
  }
  return `${prefix}${"x".repeat(targetBytes - prefixBytes)}`;
}

async function loadBenchmarkModules() {
  const [clientModule, loggerModule, transportModule, serverModule] = await Promise.all([
    import(pathToFileURL(path.join(
      workspaceRoot,
      "packages",
      "belldandy-mcp",
      "src",
      "client.ts",
    )).href),
    import(pathToFileURL(path.join(
      workspaceRoot,
      "packages",
      "belldandy-mcp",
      "src",
      "logger-adapter.ts",
    )).href),
    import("@modelcontextprotocol/sdk/inMemory.js"),
    import("@modelcontextprotocol/sdk/server/mcp.js"),
  ]);
  if (
    typeof clientModule.MCPClient !== "function"
    || typeof loggerModule.setMCPLogger !== "function"
    || typeof transportModule.InMemoryTransport?.createLinkedPair !== "function"
    || typeof serverModule.McpServer !== "function"
  ) {
    throw new Error("MCP benchmark modules did not expose the required in-memory interfaces.");
  }
  return {
    MCPClient: clientModule.MCPClient,
    setMCPLogger: loggerModule.setMCPLogger,
    InMemoryTransport: transportModule.InMemoryTransport,
    McpServer: serverModule.McpServer,
  };
}

async function createLifecycleFixture(modules, catalogSize, payload) {
  const server = new modules.McpServer({
    name: "star-sanctuary-benchmark-server",
    version: "1.0.0",
  });
  for (let index = 0; index < catalogSize; index += 1) {
    server.registerTool(
      `benchmark_tool_${index}`,
      { description: `Deterministic in-memory benchmark Tool ${index}.` },
      async () => ({ content: [{ type: "text", text: payload }] }),
    );
    server.registerResource(
      `benchmark_resource_${index}`,
      `benchmark://resource/${index}`,
      {
        description: `Deterministic in-memory benchmark Resource ${index}.`,
        mimeType: "text/plain",
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/plain", text: payload }],
      }),
    );
  }

  const [clientTransport, serverTransport] = modules.InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new modules.MCPClient({
    id: `benchmark-server-${catalogSize}`,
    name: "Benchmark In-memory Server",
    timeout: 5_000,
    transport: {
      type: "stdio",
      command: "benchmark.invalid",
    },
  });
  let transportCreateCount = 0;
  // 覆盖私有 transport seam，只允许 SDK linked pair；若覆盖失效，childProcess 断言会阻止报告。
  client.createTransport = async () => {
    transportCreateCount += 1;
    if (transportCreateCount > 1) {
      throw new Error("MCP in-memory fixture attempted to create more than one client transport.");
    }
    return clientTransport;
  };

  return {
    client,
    getTransportCreateCount: () => transportCreateCount,
    server,
  };
}

function hasExpectedTextContent(items, payload) {
  return Array.isArray(items) && items.some((item) => item?.type === "text" && item.text === payload);
}

async function runLifecycleSample(modules, catalogSize, payload, callOperationsPerSample) {
  const fixture = await createLifecycleFixture(modules, catalogSize, payload);
  let disconnected = false;
  try {
    const connectStartedAt = performance.now();
    await fixture.client.connect({ failureLogLevel: "none" });
    const connectDiscoverMs = performance.now() - connectStartedAt;
    const state = fixture.client.getState();
    if (
      state.status !== "connected"
      || state.tools.length !== catalogSize
      || state.resources.length !== catalogSize
      || fixture.getTransportCreateCount() !== 1
      || fixture.client.childProcess !== null
    ) {
      throw new Error("MCP in-memory fixture did not connect and discover the exact fixed catalog.");
    }

    const toolCallStartedAt = performance.now();
    for (let index = 0; index < callOperationsPerSample; index += 1) {
      const result = await fixture.client.callTool("benchmark_tool_0", {});
      if (!result.success || !hasExpectedTextContent(result.content, payload)) {
        throw new Error("MCP in-memory Tool call returned an unexpected result.");
      }
    }
    const toolCallMs = (performance.now() - toolCallStartedAt) / callOperationsPerSample;

    const resourceReadStartedAt = performance.now();
    for (let index = 0; index < callOperationsPerSample; index += 1) {
      const result = await fixture.client.readResource("benchmark://resource/0");
      if (!Array.isArray(result.contents) || result.contents[0]?.text !== payload) {
        throw new Error("MCP in-memory Resource read returned an unexpected result.");
      }
    }
    const resourceReadMs = (performance.now() - resourceReadStartedAt) / callOperationsPerSample;

    const disconnectStartedAt = performance.now();
    await fixture.client.disconnect();
    const disconnectMs = performance.now() - disconnectStartedAt;
    disconnected = true;
    if (fixture.client.getState().status !== "disconnected" || fixture.client.childProcess !== null) {
      throw new Error("MCP in-memory fixture did not fully disconnect.");
    }

    return {
      connectDiscoverMs,
      toolCallMs,
      resourceReadMs,
      disconnectMs,
      toolCount: state.tools.length,
      resourceCount: state.resources.length,
    };
  } finally {
    if (!disconnected) {
      await fixture.client.disconnect().catch(() => {});
    }
    await fixture.server.close().catch(() => {});
  }
}

function buildLifecycleScenarios(catalogSize, samples, callOperationsPerSample) {
  const shared = {
    catalogSize,
    toolCount: catalogSize,
    resourceCount: catalogSize,
  };
  return [
    {
      id: `mcp_connect_discover_catalog_${catalogSize}`,
      operation: "MCPClient.connect+discover",
      ...shared,
      operationsPerSample: 1,
      samplesMs: samples.map((sample) => sample.connectDiscoverMs),
    },
    {
      id: `mcp_tool_call_catalog_${catalogSize}`,
      operation: "MCPClient.callTool",
      ...shared,
      operationsPerSample: callOperationsPerSample,
      samplesMs: samples.map((sample) => sample.toolCallMs),
    },
    {
      id: `mcp_resource_read_catalog_${catalogSize}`,
      operation: "MCPClient.readResource",
      ...shared,
      operationsPerSample: callOperationsPerSample,
      samplesMs: samples.map((sample) => sample.resourceReadMs),
    },
    {
      id: `mcp_disconnect_catalog_${catalogSize}`,
      operation: "MCPClient.disconnect",
      ...shared,
      operationsPerSample: 1,
      samplesMs: samples.map((sample) => sample.disconnectMs),
    },
  ];
}

async function runCatalogScenario(
  modules,
  catalogSize,
  payload,
  warmupRuns,
  sampleRuns,
  callOperationsPerSample,
) {
  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:mcp-in-memory] catalog_${catalogSize} warm-up ${index + 1}/${warmupRuns}`);
    await runLifecycleSample(modules, catalogSize, payload, callOperationsPerSample);
  }

  const samples = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:mcp-in-memory] catalog_${catalogSize} sample ${index + 1}/${sampleRuns}`);
    const sample = await runLifecycleSample(modules, catalogSize, payload, callOperationsPerSample);
    if (sample.toolCount !== catalogSize || sample.resourceCount !== catalogSize) {
      throw new Error(`MCP catalog_${catalogSize} returned unstable discovery counts.`);
    }
    samples.push(sample);
  }
  return buildLifecycleScenarios(catalogSize, samples, callOperationsPerSample);
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
  const [rootPackage, mcpPackage, mcpSdkPackage] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "packages", "belldandy-mcp", "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(
      workspaceRoot,
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
      "package.json",
    ), "utf-8").then(JSON.parse),
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
      mcpPackageVersion: mcpPackage.version,
      mcpSdkVersion: mcpSdkPackage.version,
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
  console.log(`Usage: node --import tsx scripts/run-mcp-in-memory-benchmark.mjs [options]

Options:
  --output <path>                       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>                     Warm-up lifecycles per catalog size (default: 1)
  --sample-runs <n>                     Measured lifecycles per catalog size (default: 5)
  --call-operations-per-sample <n>      Tool calls and Resource reads per lifecycle (default: ${defaultCallOperationsPerSample})
  --help                                Show this help message`);
}

async function main() {
  const args = parseMcpInMemoryBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [modules, context] = await Promise.all([
    loadBenchmarkModules(),
    collectReportContext(),
  ]);
  modules.setMCPLogger({
    debug() {},
    info() {},
    warn() {},
    error() {},
  });
  const payload = buildPayload("benchmark-mcp-payload ", defaultPayloadBytes);
  const scenarios = [];
  for (const catalogSize of defaultCatalogSizes) {
    scenarios.push(...await runCatalogScenario(
      modules,
      catalogSize,
      payload,
      args.warmupRuns,
      args.sampleRuns,
      args.callOperationsPerSample,
    ));
  }
  const report = createMcpInMemoryBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      callOperationsPerSample: args.callOperationsPerSample,
      catalogSizes: defaultCatalogSizes,
      payloadBytes: Buffer.byteLength(payload, "utf-8"),
    },
    scenarios,
  });
  const outputPath = await writeReport(args.output, report);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:mcp-in-memory] ${scenario.id}: median=${scenario.summary.median}ms/op p95=${scenario.summary.p95}ms/op samples=${scenario.summary.sampleCount}`,
    );
  }
  console.log(`[benchmark:mcp-in-memory] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:mcp-in-memory] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
