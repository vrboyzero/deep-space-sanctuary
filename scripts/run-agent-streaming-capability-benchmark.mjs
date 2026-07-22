import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { OutboundRequestPolicy } from "../packages/belldandy-protocol/dist/index.js";

import { ToolEnabledAgent } from "../packages/belldandy-agent/src/tool-agent.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/p2-a07-streaming-product-gate.json";
const normalResponseText = "streaming product gate complete";
const scenarioIds = [
  "normalCompletion",
  "callerCancel",
  "preCommitFailure",
  "postCommitFailure",
];

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseCount(value, label, { allowZero = false, maximum = 100 } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseAgentStreamingCapabilityArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
    firstContentDelayMs: 10,
    completionDelayMs: 30,
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
      args.warmupRuns = parseCount(value, argument, { allowZero: true, maximum: 20 });
    } else if (argument === "--sample-runs") {
      args.sampleRuns = parseCount(value, argument, { maximum: 20 });
    } else if (argument === "--first-content-delay-ms") {
      args.firstContentDelayMs = parseCount(value, argument, { allowZero: true, maximum: 5_000 });
    } else if (argument === "--completion-delay-ms") {
      args.completionDelayMs = parseCount(value, argument, { maximum: 5_000 });
    } else {
      throw new Error(`Unsupported argument ${argument}.`);
    }
  }
  return args;
}

function requireDuration(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative duration${nullable ? " or null" : ""}.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requireReleasedResources(resourceState, label) {
  const normalized = {
    responseBodyCount: requireNonNegativeInteger(resourceState?.responseBodyCount, `${label}.responseBodyCount`),
    lockedResponseBodyCount: requireNonNegativeInteger(resourceState?.lockedResponseBodyCount, `${label}.lockedResponseBodyCount`),
    activeRequestCount: requireNonNegativeInteger(resourceState?.activeRequestCount, `${label}.activeRequestCount`),
    activeResponseCount: requireNonNegativeInteger(resourceState?.activeResponseCount, `${label}.activeResponseCount`),
    openSocketCount: requireNonNegativeInteger(resourceState?.openSocketCount, `${label}.openSocketCount`),
  };
  if (normalized.responseBodyCount < 1) {
    throw new Error(`${label} must observe at least one product Response body.`);
  }
  if (
    normalized.lockedResponseBodyCount !== 0
    || normalized.activeRequestCount !== 0
    || normalized.activeResponseCount !== 0
    || normalized.openSocketCount !== 0
  ) {
    throw new Error(`${label} did not release its reader, response, or socket resources.`);
  }
  return normalized;
}

function normalizeSample(sample, scenarioId, sampleIndex) {
  const label = `${scenarioId}[${sampleIndex}]`;
  const requestCount = requireNonNegativeInteger(sample?.requestCount, `${label}.requestCount`);
  if (requestCount !== 1) {
    throw new Error(`${label} must make exactly one Provider request.`);
  }
  if (
    !Array.isArray(sample?.requestStreamValues)
    || sample.requestStreamValues.length !== requestCount
    || sample.requestStreamValues.some((value) => value !== true)
  ) {
    throw new Error(`${label} must prove the product path requests stream=true.`);
  }
  if (!Array.isArray(sample?.itemTypes) || sample.itemTypes.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must contain the observed Agent item sequence.`);
  }
  const normalized = {
    requestCount,
    requestStreamValues: [...sample.requestStreamValues],
    itemTypes: [...sample.itemTypes],
    deltaCount: requireNonNegativeInteger(sample.deltaCount, `${label}.deltaCount`),
    finalCount: requireNonNegativeInteger(sample.finalCount, `${label}.finalCount`),
    interruptedCount: requireNonNegativeInteger(sample.interruptedCount, `${label}.interruptedCount`),
    toolCallCount: requireNonNegativeInteger(sample.toolCallCount, `${label}.toolCallCount`),
    toolResultCount: requireNonNegativeInteger(sample.toolResultCount, `${label}.toolResultCount`),
    terminalStatus: sample.terminalStatus,
    successfulCompletion: sample.successfulCompletion === true,
    providerTtftMs: requireDuration(sample.providerTtftMs, `${label}.providerTtftMs`, { nullable: true }),
    firstAgentDeltaMs: requireDuration(sample.firstAgentDeltaMs, `${label}.firstAgentDeltaMs`, { nullable: true }),
    completionMs: requireDuration(sample.completionMs, `${label}.completionMs`),
    resourceState: requireReleasedResources(sample.resourceState, `${label}.resourceState`),
  };
  const observedDeltaCount = normalized.itemTypes.filter((type) => type === "delta").length;
  const observedFinalCount = normalized.itemTypes.filter((type) => type === "final").length;
  const observedInterruptedCount = normalized.itemTypes.filter((type) => type === "interrupted").length;
  const observedToolCallCount = normalized.itemTypes.filter((type) => type === "tool_call").length;
  if (
    normalized.deltaCount !== observedDeltaCount
    || normalized.finalCount !== observedFinalCount
    || normalized.interruptedCount !== observedInterruptedCount
    || normalized.toolCallCount !== observedToolCallCount
  ) {
    throw new Error(`${label} item counts do not match its Agent item sequence.`);
  }
  return {
    ...normalized,
    providerTtftMs: normalized.providerTtftMs === null ? null : round(normalized.providerTtftMs),
    firstAgentDeltaMs: normalized.firstAgentDeltaMs === null ? null : round(normalized.firstAgentDeltaMs),
    completionMs: round(normalized.completionMs),
  };
}

function requireTimingBeforeCompletion(sample, scenarioId) {
  if (sample.providerTtftMs === null || sample.firstAgentDeltaMs === null) {
    throw new Error(`${scenarioId} must observe Provider TTFT and first Agent delta.`);
  }
  if (sample.providerTtftMs > sample.firstAgentDeltaMs) {
    throw new Error(`${scenarioId} observed an Agent delta before the Provider emitted content.`);
  }
  if (sample.providerTtftMs >= sample.completionMs || sample.firstAgentDeltaMs >= sample.completionMs) {
    throw new Error(`${scenarioId} must deliver Provider content and the first Agent delta before completion.`);
  }
}

function validateScenarioSample(sample, scenarioId) {
  if (sample.toolCallCount !== 0 || sample.toolResultCount !== 0) {
    throw new Error(`${scenarioId} must not expose or execute tools.`);
  }
  if (scenarioId === "normalCompletion") {
    requireTimingBeforeCompletion(sample, scenarioId);
    if (
      sample.deltaCount < 1
      || sample.finalCount !== 1
      || sample.interruptedCount !== 0
      || sample.terminalStatus !== "done"
      || !sample.successfulCompletion
    ) {
      throw new Error("normalCompletion did not produce one successful final after early deltas.");
    }
    return;
  }
  if (scenarioId === "callerCancel") {
    requireTimingBeforeCompletion(sample, scenarioId);
    if (
      sample.deltaCount < 1
      || sample.finalCount !== 0
      || sample.interruptedCount !== 0
      || sample.terminalStatus !== "stopped"
      || sample.successfulCompletion
    ) {
      throw new Error("callerCancel must stop after the first delta without final or interrupted.");
    }
    return;
  }
  if (scenarioId === "preCommitFailure") {
    if (
      sample.providerTtftMs !== null
      || sample.firstAgentDeltaMs !== null
      || sample.deltaCount !== 0
      || sample.interruptedCount !== 0
      || sample.terminalStatus !== "error"
      || sample.successfulCompletion
    ) {
      throw new Error("preCommitFailure must fail without visible delta, Tool, or successful completion.");
    }
    return;
  }
  if (scenarioId === "postCommitFailure") {
    requireTimingBeforeCompletion(sample, scenarioId);
    if (
      sample.deltaCount < 1
      || sample.finalCount !== 0
      || sample.interruptedCount !== 1
      || sample.terminalStatus !== "error"
      || sample.successfulCompletion
      || sample.requestCount !== 1
    ) {
      throw new Error("postCommitFailure must preserve partial and emit one interrupted without retry or final.");
    }
  }
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)];
  return {
    unit: "milliseconds",
    sampleCount: sorted.length,
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    median: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    percentileMethod: "nearest-rank",
  };
}

function scenarioLatency(scenarioId, samples) {
  const latency = { completionMs: summarizeSamples(samples.map((sample) => sample.completionMs)) };
  if (scenarioId !== "preCommitFailure") {
    latency.providerTtftMs = summarizeSamples(samples.map((sample) => sample.providerTtftMs));
    latency.firstAgentDeltaMs = summarizeSamples(samples.map((sample) => sample.firstAgentDeltaMs));
  }
  return latency;
}

export function createAgentStreamingCapabilityReport({ generatedAt, environment, source, probe }) {
  if (probe?.provider !== "strict_local_mock" || probe?.executionMode !== "strict_local_sequential") {
    throw new Error("A07 product Gate requires the strict local sequential Provider fixture.");
  }
  const warmupRuns = parseCount(probe.warmupRuns, "probe.warmupRuns", { allowZero: true, maximum: 20 });
  const sampleRuns = parseCount(probe.sampleRuns, "probe.sampleRuns", { maximum: 20 });
  const firstContentDelayMs = parseCount(probe.firstContentDelayMs, "probe.firstContentDelayMs", { allowZero: true, maximum: 5_000 });
  const completionDelayMs = parseCount(probe.completionDelayMs, "probe.completionDelayMs", { maximum: 5_000 });
  const result = {};
  for (const scenarioId of scenarioIds) {
    const rawSamples = probe.scenarios?.[scenarioId];
    if (!Array.isArray(rawSamples) || rawSamples.length !== sampleRuns) {
      throw new Error(`${scenarioId} must contain exactly ${sampleRuns} measured samples.`);
    }
    const samples = rawSamples.map((sample, index) => normalizeSample(sample, scenarioId, index));
    for (const sample of samples) validateScenarioSample(sample, scenarioId);
    result[scenarioId] = {
      samples,
      latency: scenarioLatency(scenarioId, samples),
    };
  }
  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "agent-provider-streaming-product-gate",
      mode: "report_only",
      executionMode: "strict_local_sequential",
      thresholdApplied: true,
      provider: "strict_local_mock",
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      firstContentDelayMs,
      completionDelayMs,
      scenarios: [...scenarioIds],
      network: "127.0.0.1_only",
    },
    result: {
      streamingSupported: true,
      allGatesPassed: true,
      ...result,
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSse(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createMockToolExecutor() {
  let executeCount = 0;
  return {
    executor: {
      getDefinitions: () => [],
      getRegisteredToolContract: () => undefined,
      consumeLoadedDeferredToolsForNextTurn: async () => [],
      setTokenCounter: () => {},
      clearTokenCounter: () => {},
      releaseConversation: () => {},
      execute: async () => {
        executeCount += 1;
        throw new Error("The A07 product Gate does not expose tools.");
      },
    },
    getExecuteCount: () => executeCount,
  };
}

function createQuietLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

async function waitForReleasedResources(readSnapshot, timeoutMs = 2_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const snapshot = readSnapshot();
    if (
      snapshot.activeRequestCount === 0
      && snapshot.activeResponseCount === 0
      && snapshot.openSocketCount === 0
    ) {
      return snapshot;
    }
    await delay(5);
  }
  return readSnapshot();
}

async function createStrictLocalProvider({ scenarioId, firstContentDelayMs, completionDelayMs }) {
  const requestStreamValues = [];
  const sockets = new Set();
  let requestCount = 0;
  let activeRequestCount = 0;
  let activeResponseCount = 0;
  let scenarioStartedAt = null;
  let providerTtftMs = null;

  const markFirstContent = () => {
    if (providerTtftMs === null && scenarioStartedAt !== null) {
      providerTtftMs = performance.now() - scenarioStartedAt;
    }
  };
  const server = http.createServer((request, response) => {
    activeRequestCount += 1;
    activeResponseCount += 1;
    response.once("close", () => {
      activeResponseCount -= 1;
    });
    void (async () => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        requestCount += 1;
        requestStreamValues.push(body.stream);
        if (requestCount > 1) {
          response.writeHead(500, { "content-type": "text/plain" });
          response.end("unexpected retry or fallback");
          return;
        }
        await delay(firstContentDelayMs);
        if (scenarioId === "preCommitFailure") {
          response.writeHead(503, { "content-type": "text/plain" });
          response.end("strict local pre-commit failure");
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        markFirstContent();
        if (scenarioId === "normalCompletion") {
          writeSse(response, { choices: [{ delta: { content: "streaming product " } }] });
          await delay(completionDelayMs);
          writeSse(response, {
            choices: [{ delta: { content: "gate complete" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          });
          response.end("data: [DONE]\n\n");
          return;
        }
        if (scenarioId === "callerCancel") {
          writeSse(response, { choices: [{ delta: { content: "cancel partial" } }] });
          await new Promise((resolve) => response.once("close", resolve));
          return;
        }
        writeSse(response, { choices: [{ delta: { content: "interrupted partial" } }] });
        await delay(Math.max(5, Math.min(completionDelayMs, 20)));
        response.destroy();
      } catch (error) {
        if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
        if (!response.destroyed) response.end(error instanceof Error ? error.message : String(error));
      } finally {
        activeRequestCount -= 1;
      }
    })();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("A07 product Gate could not resolve its local Provider address.");
  }
  const snapshot = () => ({
    requestCount,
    requestStreamValues: [...requestStreamValues],
    providerTtftMs,
    activeRequestCount,
    activeResponseCount,
    openSocketCount: sockets.size,
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    start: (startedAt) => {
      scenarioStartedAt = startedAt;
    },
    snapshot,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return waitForReleasedResources(snapshot);
    },
  };
}

async function runScenario({ scenarioId, firstContentDelayMs, completionDelayMs }) {
  const provider = await createStrictLocalProvider({ scenarioId, firstContentDelayMs, completionDelayMs });
  const toolExecutor = createMockToolExecutor();
  const abortController = new AbortController();
  const responseBodies = [];
  const originalPolicyRequest = OutboundRequestPolicy.prototype.request;
  OutboundRequestPolicy.prototype.request = async function instrumentedPolicyRequest(input) {
    const result = await originalPolicyRequest.call(this, input);
    if (result.response.body) responseBodies.push(result.response.body);
    return result;
  };
  const items = [];
  let firstAgentDeltaMs = null;
  const startedAt = performance.now();
  provider.start(startedAt);
  try {
    const agent = new ToolEnabledAgent({
      baseUrl: provider.baseUrl,
      apiKey: "a07-local-mock-key",
      model: "a07-local-mock-model",
      systemPrompt: "Return the fixed local response without tools.",
      toolExecutor: toolExecutor.executor,
      logger: createQuietLogger(),
      streamingEnabled: true,
      timeoutMs: 5_000,
      maxRunWallTimeMs: 5_000,
      maxRetries: scenarioId === "postCommitFailure" ? 2 : 0,
    });
    for await (const item of agent.run({
      conversationId: `a07-${scenarioId}-${crypto.randomUUID()}`,
      text: "Run the strict local streaming product Gate.",
      history: [],
      abortSignal: abortController.signal,
    })) {
      items.push(item);
      if (item.type === "delta" && firstAgentDeltaMs === null) {
        firstAgentDeltaMs = performance.now() - startedAt;
        if (scenarioId === "callerCancel") abortController.abort("benchmark_cancel_after_first_delta");
      }
    }
  } finally {
    OutboundRequestPolicy.prototype.request = originalPolicyRequest;
  }
  const completionMs = performance.now() - startedAt;
  const providerSnapshot = await provider.close();
  const finalItems = items.filter((item) => item.type === "final");
  const statusItems = items.filter((item) => item.type === "status");
  return {
    requestCount: providerSnapshot.requestCount,
    requestStreamValues: providerSnapshot.requestStreamValues,
    itemTypes: items.map((item) => item.type),
    deltaCount: items.filter((item) => item.type === "delta").length,
    finalCount: finalItems.length,
    interruptedCount: items.filter((item) => item.type === "interrupted").length,
    toolCallCount: items.filter((item) => item.type === "tool_call").length,
    toolResultCount: items.filter((item) => item.type === "tool_result").length + toolExecutor.getExecuteCount(),
    terminalStatus: statusItems.at(-1)?.status ?? null,
    successfulCompletion: finalItems.some((item) => item.text === normalResponseText)
      && statusItems.at(-1)?.status === "done",
    providerTtftMs: providerSnapshot.providerTtftMs,
    firstAgentDeltaMs,
    completionMs,
    resourceState: {
      responseBodyCount: responseBodies.length,
      lockedResponseBodyCount: responseBodies.filter((body) => body.locked).length,
      activeRequestCount: providerSnapshot.activeRequestCount,
      activeResponseCount: providerSnapshot.activeResponseCount,
      openSocketCount: providerSnapshot.openSocketCount,
    },
  };
}

export async function probeToolAgentStreamingCapability(options = {}) {
  const warmupRuns = parseCount(options.warmupRuns ?? 1, "warmupRuns", { allowZero: true, maximum: 20 });
  const sampleRuns = parseCount(options.sampleRuns ?? 5, "sampleRuns", { maximum: 20 });
  const firstContentDelayMs = parseCount(options.firstContentDelayMs ?? 10, "firstContentDelayMs", { allowZero: true, maximum: 5_000 });
  const completionDelayMs = parseCount(options.completionDelayMs ?? 30, "completionDelayMs", { maximum: 5_000 });
  const scenarios = Object.fromEntries(scenarioIds.map((scenarioId) => [scenarioId, []]));
  for (let runIndex = 0; runIndex < warmupRuns + sampleRuns; runIndex += 1) {
    const measured = runIndex >= warmupRuns;
    for (const scenarioId of scenarioIds) {
      const sample = await runScenario({ scenarioId, firstContentDelayMs, completionDelayMs });
      validateScenarioSample(normalizeSample(sample, scenarioId, runIndex), scenarioId);
      if (measured) scenarios[scenarioId].push(sample);
    }
  }
  return {
    provider: "strict_local_mock",
    executionMode: "strict_local_sequential",
    warmupRuns,
    sampleRuns,
    firstContentDelayMs,
    completionDelayMs,
    scenarios,
  };
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
  if (!result.error && result.status === 0) return result.stdout.trim();
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
  console.log(`Usage: node --import tsx scripts/run-agent-streaming-capability-benchmark.mjs [options]

Options:
  --output <path>                    JSON report path (default: ${defaultOutput})
  --warmup-runs <count>              Warm-up runs per scenario (default: 1)
  --sample-runs <count>              Measured runs per scenario (default: 5)
  --first-content-delay-ms <ms>      Local Provider first-content delay (default: 10)
  --completion-delay-ms <ms>         Local Provider completion delay (default: 30)
  --help                             Show this help message`);
}

async function main() {
  const args = parseAgentStreamingCapabilityArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const probe = await probeToolAgentStreamingCapability(args);
  const context = await collectReportContext();
  const report = createAgentStreamingCapabilityReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    probe,
  });
  const outputPath = await writeReport(args.output, report);
  const normal = report.result.normalCompletion.latency;
  console.log(
    `[benchmark:agent-streaming-capability] stream=true provider-ttft-p95=${normal.providerTtftMs.p95}ms agent-delta-p95=${normal.firstAgentDeltaMs.p95}ms completion-p95=${normal.completionMs.p95}ms`,
  );
  console.log(`[benchmark:agent-streaming-capability] all-gates-passed: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:agent-streaming-capability] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
