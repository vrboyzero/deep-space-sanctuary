import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/b00-browser-relay.json";
const defaultOperationCounts = [100, 1_000];
const defaultPayloadBytes = 256;
const controllerOperations = [
  "RelayConnectionController.lifecycle",
  "RelayConnectionController.message",
  "RelayConnectionController.send",
  "RelayConnectionController.staleEvent",
  "RelayConnectionController.reconnect",
];
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

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

export function parseBrowserRelayBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
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

function expectedCounters(operation, operationCount) {
  if (operation === "RelayConnectionController.lifecycle") {
    return {
      socketCount: operationCount,
      deliveredMessageCount: 0,
      sentMessageCount: 0,
      listenerAttachCount: operationCount,
      listenerDetachCount: operationCount,
    };
  }
  if (operation === "RelayConnectionController.message") {
    return {
      socketCount: 1,
      deliveredMessageCount: operationCount,
      sentMessageCount: 0,
      listenerAttachCount: 1,
      listenerDetachCount: 1,
    };
  }
  if (operation === "RelayConnectionController.send") {
    return {
      socketCount: 1,
      deliveredMessageCount: 0,
      sentMessageCount: operationCount,
      listenerAttachCount: 1,
      listenerDetachCount: 1,
    };
  }
  if (operation === "RelayConnectionController.staleEvent") {
    return {
      socketCount: 2,
      deliveredMessageCount: 0,
      sentMessageCount: 0,
      listenerAttachCount: 1,
      listenerDetachCount: 1,
    };
  }
  return {
    socketCount: operationCount + 1,
    deliveredMessageCount: 0,
    sentMessageCount: 0,
    listenerAttachCount: 1,
    listenerDetachCount: 1,
  };
}

export function createBrowserRelayBenchmarkReport({
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
  const operationCounts = normalizeFixtureCounts(fixture?.operationCounts, "fixture.operationCounts");
  const payloadBytes = parseCount(fixture?.payloadBytes, "fixture.payloadBytes", { maximum: 1_048_576 });
  if (!Array.isArray(scenarios) || scenarios.length !== operationCounts.length * controllerOperations.length) {
    throw new Error("Each operation count requires every Relay controller operation exactly once.");
  }

  const expectedScenarioKeys = new Set(
    operationCounts.flatMap((operationCount) => controllerOperations.map(
      (operation) => `${operationCount}:${operation}`,
    )),
  );
  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "browser-relay-connection-controller",
      mode: "report_only",
      adapter: "in_memory_fake_websocket",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      operationCounts,
      payloadBytes,
    },
    scenarios: scenarios.map((scenario) => {
      if (typeof scenario?.id !== "string" || !scenario.id) {
        throw new Error("Each benchmark scenario requires an id.");
      }
      if (!controllerOperations.includes(scenario.operation)) {
        throw new Error(`${scenario.id} has an unsupported Relay controller operation.`);
      }
      const operationCount = parseCount(scenario.operationCount, `${scenario.id}.operationCount`);
      const scenarioKey = `${operationCount}:${scenario.operation}`;
      if (!expectedScenarioKeys.delete(scenarioKey)) {
        throw new Error(`${scenario.id} does not map to a unique configured Relay operation.`);
      }
      const resultCount = parseCount(scenario.resultCount, `${scenario.id}.resultCount`);
      if (resultCount !== operationCount) {
        throw new Error(`${scenario.id}.resultCount must equal operationCount.`);
      }
      const expected = expectedCounters(scenario.operation, operationCount);
      for (const [key, expectedValue] of Object.entries(expected)) {
        const actual = parseCount(scenario[key], `${scenario.id}.${key}`, { allowZero: true });
        if (actual !== expectedValue) {
          throw new Error(`${scenario.id}.${key} must equal ${expectedValue}.`);
        }
      }
      const pendingTimerCount = parseCount(
        scenario.pendingTimerCount,
        `${scenario.id}.pendingTimerCount`,
        { allowZero: true },
      );
      if (pendingTimerCount !== 0) {
        throw new Error(`${scenario.id} retained a fake timer after disposal.`);
      }
      requireSamples(scenario.samplesMs, sampleRuns, scenario.id);
      return {
        id: scenario.id,
        operation: scenario.operation,
        operationCount,
        resultCount,
        ...expected,
        pendingTimerCount,
        samplesMs: scenario.samplesMs.map((sample) => round(sample)),
        summary: summarizeSamples(scenario.samplesMs),
      };
    }),
  };
}

class FakeTimerScheduler {
  #nextId = 1;
  #timers = new Map();

  setTimeout = (callback, delayMs) => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#timers.set(id, { callback, delayMs });
    return id;
  };

  clearTimeout = (id) => {
    this.#timers.delete(id);
  };

  get pendingCount() {
    return this.#timers.size;
  }

  runNext() {
    const next = this.#timers.entries().next();
    if (next.done) {
      throw new Error("Relay fake timer scheduler has no pending timer.");
    }
    const [id, timer] = next.value;
    this.#timers.delete(id);
    timer.callback();
  }
}

class FakeSocket {
  readyState = SOCKET_CONNECTING;
  onclose = null;
  onerror = null;
  onmessage = null;
  onopen = null;
  sentCount = 0;
  sentBytes = 0;

  close() {
    if (this.readyState === SOCKET_CLOSED) {
      return;
    }
    this.readyState = SOCKET_CLOSED;
    this.onclose?.({ code: 1000 });
  }

  send(payload) {
    if (this.readyState !== SOCKET_OPEN || typeof payload !== "string") {
      throw new Error("Relay fake socket received an invalid send.");
    }
    this.sentCount += 1;
    this.sentBytes += Buffer.byteLength(payload, "utf-8");
  }

  open() {
    this.readyState = SOCKET_OPEN;
    this.onopen?.();
  }

  emitClose() {
    this.readyState = SOCKET_CLOSED;
    this.onclose?.({ code: 1006 });
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }
}

async function loadRelayConnectionController() {
  const moduleUrl = pathToFileURL(path.join(
    workspaceRoot,
    "apps",
    "browser-extension",
    "relay-connection-controller.js",
  )).href;
  const module = await import(moduleUrl);
  if (typeof module.RelayConnectionController !== "function") {
    throw new Error("Browser extension did not expose RelayConnectionController.");
  }
  return module.RelayConnectionController;
}

function buildPayload(targetBytes) {
  const prefix = "benchmark-browser-relay-payload ";
  const prefixBytes = Buffer.byteLength(prefix, "utf-8");
  if (prefixBytes > targetBytes) {
    throw new Error(`Payload prefix exceeds the ${targetBytes}-byte fixture budget.`);
  }
  return `${prefix}${"x".repeat(targetBytes - prefixBytes)}`;
}

function createControllerFixture(RelayConnectionController, payload) {
  const scheduler = new FakeTimerScheduler();
  const sockets = [];
  const states = [];
  let deliveredMessageCount = 0;
  let invalidMessageCount = 0;
  let listenerAttachCount = 0;
  let listenerDetachCount = 0;
  const controller = new RelayConnectionController({
    getConfig: async () => ({ port: 28_892, token: "a".repeat(43) }),
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    attachDebuggerListeners: () => {
      listenerAttachCount += 1;
    },
    detachDebuggerListeners: () => {
      listenerDetachCount += 1;
    },
    onMessage: (data) => {
      if (data === payload) {
        deliveredMessageCount += 1;
      } else {
        invalidMessageCount += 1;
      }
    },
    onStateChange: (state) => states.push(state),
    connectTimeoutMs: 5_000,
    reconnectBaseDelayMs: 1,
    reconnectMaxDelayMs: 1,
    reconnectJitterRatio: 0,
    maxReconnectAttempts: Number.POSITIVE_INFINITY,
    setTimeoutFn: scheduler.setTimeout,
    clearTimeoutFn: scheduler.clearTimeout,
    random: () => 0.5,
  });
  return {
    controller,
    getSnapshot: () => ({
      deliveredMessageCount,
      invalidMessageCount,
      listenerAttachCount,
      listenerDetachCount,
      pendingTimerCount: scheduler.pendingCount,
      sentMessageCount: sockets.reduce((total, socket) => total + socket.sentCount, 0),
      socketCount: sockets.length,
      states: [...states],
    }),
    scheduler,
    sockets,
  };
}

async function waitForSocket(sockets, expectedCount) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (sockets.length >= expectedCount) {
      return sockets[expectedCount - 1];
    }
    await Promise.resolve();
  }
  throw new Error(`Expected ${expectedCount} fake Relay sockets, received ${sockets.length}.`);
}

async function connectFixture(fixture) {
  const connect = fixture.controller.start();
  const socket = await waitForSocket(fixture.sockets, 1);
  socket.open();
  await connect;
  return socket;
}

function validateDisposedSnapshot(snapshot) {
  if (
    snapshot.pendingTimerCount !== 0
    || snapshot.invalidMessageCount !== 0
    || snapshot.listenerAttachCount !== snapshot.listenerDetachCount
  ) {
    throw new Error("Relay controller fixture did not release listeners and fake timers cleanly.");
  }
}

async function runLifecycleOperations(RelayConnectionController, payload, operationCount) {
  let socketCount = 0;
  let listenerAttachCount = 0;
  let listenerDetachCount = 0;
  const startedAt = performance.now();
  for (let index = 0; index < operationCount; index += 1) {
    const fixture = createControllerFixture(RelayConnectionController, payload);
    await connectFixture(fixture);
    fixture.controller.dispose();
    const snapshot = fixture.getSnapshot();
    validateDisposedSnapshot(snapshot);
    socketCount += snapshot.socketCount;
    listenerAttachCount += snapshot.listenerAttachCount;
    listenerDetachCount += snapshot.listenerDetachCount;
  }
  return {
    durationMs: (performance.now() - startedAt) / operationCount,
    resultCount: operationCount,
    socketCount,
    deliveredMessageCount: 0,
    sentMessageCount: 0,
    listenerAttachCount,
    listenerDetachCount,
    pendingTimerCount: 0,
  };
}

async function runMessageOperations(RelayConnectionController, payload, operationCount) {
  const fixture = createControllerFixture(RelayConnectionController, payload);
  const socket = await connectFixture(fixture);
  const startedAt = performance.now();
  for (let index = 0; index < operationCount; index += 1) {
    socket.emitMessage(payload);
  }
  const durationMs = (performance.now() - startedAt) / operationCount;
  fixture.controller.dispose();
  const snapshot = fixture.getSnapshot();
  validateDisposedSnapshot(snapshot);
  return { durationMs, resultCount: operationCount, ...snapshot };
}

async function runSendOperations(RelayConnectionController, payload, operationCount) {
  const fixture = createControllerFixture(RelayConnectionController, payload);
  await connectFixture(fixture);
  const startedAt = performance.now();
  for (let index = 0; index < operationCount; index += 1) {
    if (!fixture.controller.send({ type: "benchmark", payload })) {
      throw new Error("Relay controller rejected a fixed outbound fake-WebSocket message.");
    }
  }
  const durationMs = (performance.now() - startedAt) / operationCount;
  fixture.controller.dispose();
  const snapshot = fixture.getSnapshot();
  validateDisposedSnapshot(snapshot);
  return { durationMs, resultCount: operationCount, ...snapshot };
}

async function runStaleEventOperations(RelayConnectionController, payload, operationCount) {
  const fixture = createControllerFixture(RelayConnectionController, payload);
  const staleSocket = await connectFixture(fixture);
  const reconnect = fixture.controller.forceReconnect();
  const currentSocket = await waitForSocket(fixture.sockets, 2);
  currentSocket.open();
  await reconnect;

  const startedAt = performance.now();
  for (let index = 0; index < operationCount; index += 1) {
    staleSocket.emitMessage(payload);
    staleSocket.emitClose();
  }
  const durationMs = (performance.now() - startedAt) / operationCount;
  fixture.controller.dispose();
  const snapshot = fixture.getSnapshot();
  validateDisposedSnapshot(snapshot);
  return { durationMs, resultCount: operationCount, ...snapshot };
}

async function runReconnectOperations(RelayConnectionController, payload, operationCount) {
  const fixture = createControllerFixture(RelayConnectionController, payload);
  let socket = await connectFixture(fixture);
  const startedAt = performance.now();
  for (let index = 0; index < operationCount; index += 1) {
    socket.emitClose();
    if (fixture.scheduler.pendingCount !== 1) {
      throw new Error("Relay controller did not retain exactly one reconnect timer.");
    }
    fixture.scheduler.runNext();
    socket = await waitForSocket(fixture.sockets, index + 2);
    socket.open();
    await Promise.resolve();
  }
  const durationMs = (performance.now() - startedAt) / operationCount;
  fixture.controller.dispose();
  const snapshot = fixture.getSnapshot();
  validateDisposedSnapshot(snapshot);
  return { durationMs, resultCount: operationCount, ...snapshot };
}

async function runOperationSample(RelayConnectionController, payload, operation, operationCount) {
  if (operation === "RelayConnectionController.lifecycle") {
    return runLifecycleOperations(RelayConnectionController, payload, operationCount);
  }
  if (operation === "RelayConnectionController.message") {
    return runMessageOperations(RelayConnectionController, payload, operationCount);
  }
  if (operation === "RelayConnectionController.send") {
    return runSendOperations(RelayConnectionController, payload, operationCount);
  }
  if (operation === "RelayConnectionController.staleEvent") {
    return runStaleEventOperations(RelayConnectionController, payload, operationCount);
  }
  return runReconnectOperations(RelayConnectionController, payload, operationCount);
}

async function runScenario(
  RelayConnectionController,
  payload,
  operation,
  operationCount,
  warmupRuns,
  sampleRuns,
) {
  const id = `${operation.split(".").at(-1)}_${operationCount}`;
  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:browser-relay] ${id} warm-up ${index + 1}/${warmupRuns}`);
    await runOperationSample(RelayConnectionController, payload, operation, operationCount);
  }

  const samplesMs = [];
  let counters = null;
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:browser-relay] ${id} sample ${index + 1}/${sampleRuns}`);
    const sample = await runOperationSample(RelayConnectionController, payload, operation, operationCount);
    const currentCounters = {
      resultCount: sample.resultCount,
      socketCount: sample.socketCount,
      deliveredMessageCount: sample.deliveredMessageCount,
      sentMessageCount: sample.sentMessageCount,
      listenerAttachCount: sample.listenerAttachCount,
      listenerDetachCount: sample.listenerDetachCount,
      pendingTimerCount: sample.pendingTimerCount,
    };
    if (counters === null) {
      counters = currentCounters;
    } else if (JSON.stringify(currentCounters) !== JSON.stringify(counters)) {
      throw new Error(`${id} returned unstable lifecycle counters.`);
    }
    samplesMs.push(sample.durationMs);
  }

  return {
    id,
    operation,
    operationCount,
    ...counters,
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
  const [rootPackage, browserPackage] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(workspaceRoot, "packages", "belldandy-browser", "package.json"), "utf-8").then(JSON.parse),
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
      browserPackageVersion: browserPackage.version,
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
  console.log(`Usage: node scripts/run-browser-relay-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per operation/count fixture (default: 1)
  --sample-runs <n>     Measured runs per operation/count fixture (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parseBrowserRelayBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [RelayConnectionController, context] = await Promise.all([
    loadRelayConnectionController(),
    collectReportContext(),
  ]);
  const payload = buildPayload(defaultPayloadBytes);
  const scenarios = [];
  for (const operationCount of defaultOperationCounts) {
    for (const operation of controllerOperations) {
      scenarios.push(await runScenario(
        RelayConnectionController,
        payload,
        operation,
        operationCount,
        args.warmupRuns,
        args.sampleRuns,
      ));
    }
  }
  const report = createBrowserRelayBenchmarkReport({
    generatedAt: new Date().toISOString(),
    environment: context.environment,
    source: context.source,
    fixture: {
      warmupRuns: args.warmupRuns,
      sampleRuns: args.sampleRuns,
      operationCounts: defaultOperationCounts,
      payloadBytes: Buffer.byteLength(payload, "utf-8"),
    },
    scenarios,
  });
  const outputPath = await writeReport(args.output, report);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:browser-relay] ${scenario.id}: median=${scenario.summary.median}ms/op p95=${scenario.summary.p95}ms/op samples=${scenario.summary.sampleCount}`,
    );
  }
  console.log(`[benchmark:browser-relay] report-only: ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:browser-relay] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
