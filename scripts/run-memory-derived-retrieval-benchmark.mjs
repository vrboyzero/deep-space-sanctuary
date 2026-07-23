import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/m02-derived-retrieval.json";
const sessionArtifactCount = 24;
const sessionArtifactBytes = 2 * 1024;
const taskCount = 64;
const experienceCount = 250;
const experienceBodyBytes = 10 * 1024;

const SESSION_QUERY = "derived session benchmark marker";
const TASK_QUERY = "derived task benchmark marker";
const EXPERIENCE_QUERY = "derived experience benchmark marker";

const chainBudgets = {
  session: {
    candidateLimit: 24,
    detailLimit: 48,
    readConcurrency: 4,
    perFileReadByteLimit: 64 * 1024,
    readByteLimit: 256 * 1024,
    resultLimit: 4,
  },
  task: {
    recentCandidateQueryLimit: 36,
    searchCandidateQueryLimit: 25,
    candidateLimit: 61,
    detailLimit: 61,
    readByteLimit: 0,
    resultLimit: 3,
  },
  experience: {
    candidateLimit: 24,
    detailLimit: 12,
    perDetailReadByteLimit: 8 * 1024,
    readByteLimit: 96 * 1024,
    resultLimit: 2,
  },
};

const expectedScenarios = {
  session_artifact_provider_and_file_reads: {
    chain: "session",
    operation: "collectDerivedSessionSearchResults",
  },
  task_recent_search_and_detail_projection: {
    chain: "task",
    operation: "MemoryManager.collectDerivedTaskSearchResults",
  },
  experience_fts_and_detail_projection: {
    chain: "experience",
    operation: "MemoryManager.collectDerivedExperienceSearchResults",
  },
};

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

function requireNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("Benchmark summaries require at least one sample.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sampleCount;
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sampleCount) - 1)];

  return {
    unit: "milliseconds",
    sampleCount,
    min: round(sorted[0]),
    max: round(sorted[sampleCount - 1]),
    mean: round(mean),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    percentileMethod: "nearest-rank",
  };
}

function summarizeStatementCounts(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("SQLite statement summaries require at least one sample.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sampleCount;
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sampleCount) - 1)];

  return {
    unit: "statements",
    sampleCount,
    min: sorted[0],
    max: sorted[sampleCount - 1],
    mean: round(mean),
    p50: percentile(0.5),
    p95: percentile(0.95),
    percentileMethod: "nearest-rank",
  };
}

function normalizeBudget(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const result = {};
  for (const [key, rawValue] of Object.entries(value)) {
    result[key] = requireNonNegativeInteger(rawValue, `${label}.${key}`);
  }
  return result;
}

function normalizeObserved(value, label) {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object.`);
  }
  return {
    candidateCount: requireNonNegativeInteger(value.candidateCount, `${label}.candidateCount`),
    detailCount: requireNonNegativeInteger(value.detailCount, `${label}.detailCount`),
    readByteCount: requireNonNegativeInteger(value.readByteCount, `${label}.readByteCount`),
    resultCount: requireNonNegativeInteger(value.resultCount, `${label}.resultCount`),
  };
}

export function parseMemoryDerivedRetrievalBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 2,
    sampleRuns: 7,
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

export function createMemoryDerivedRetrievalBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  const normalizedFixture = {
    warmupRuns,
    sampleRuns,
    sessionArtifactCount: parseCount(fixture?.sessionArtifactCount, "fixture.sessionArtifactCount"),
    sessionArtifactFileCount: parseCount(fixture?.sessionArtifactFileCount, "fixture.sessionArtifactFileCount"),
    sessionArtifactBytes: parseCount(fixture?.sessionArtifactBytes, "fixture.sessionArtifactBytes"),
    taskCount: parseCount(fixture?.taskCount, "fixture.taskCount"),
    experienceCount: parseCount(fixture?.experienceCount, "fixture.experienceCount"),
    experienceBodyBytes: parseCount(fixture?.experienceBodyBytes, "fixture.experienceBodyBytes"),
    seedDurationMs: round(requireNonNegativeNumber(fixture?.seedDurationMs, "fixture.seedDurationMs")),
    chainBudgets: {
      session: normalizeBudget(fixture?.chainBudgets?.session, "fixture.chainBudgets.session"),
      task: normalizeBudget(fixture?.chainBudgets?.task, "fixture.chainBudgets.task"),
      experience: normalizeBudget(fixture?.chainBudgets?.experience, "fixture.chainBudgets.experience"),
    },
  };

  if (!Array.isArray(scenarios) || scenarios.length !== Object.keys(expectedScenarios).length) {
    throw new Error("The derived retrieval benchmark requires exactly three chain scenarios.");
  }
  const seenScenarioIds = new Set();
  const normalizedScenarios = scenarios.map((scenario) => {
    const expected = expectedScenarios[scenario?.id];
    if (!expected || seenScenarioIds.has(scenario.id)) {
      throw new Error("Each derived retrieval benchmark scenario must have a unique known id.");
    }
    seenScenarioIds.add(scenario.id);
    if (scenario.chain !== expected.chain || scenario.operation !== expected.operation) {
      throw new Error(`${scenario.id} does not match its chain operation contract.`);
    }
    const observed = normalizeObserved(scenario.observed, `${scenario.id}.observed`);
    if (!Array.isArray(scenario.samples) || scenario.samples.length !== sampleRuns) {
      throw new Error(`${scenario.id} must contain exactly ${sampleRuns} measured samples.`);
    }
    const samples = scenario.samples.map((sample, index) => ({
      durationMs: round(requireNonNegativeNumber(sample?.durationMs, `${scenario.id}.samples[${index}].durationMs`)),
      eventLoopDelayMs: round(requireNonNegativeNumber(sample?.eventLoopDelayMs, `${scenario.id}.samples[${index}].eventLoopDelayMs`)),
      sqliteStatementCount: requireNonNegativeInteger(
        sample?.sqliteStatementCount,
        `${scenario.id}.samples[${index}].sqliteStatementCount`,
      ),
    }));
    return {
      id: scenario.id,
      chain: scenario.chain,
      operation: scenario.operation,
      observed,
      warmLatencyMs: summarizeSamples(samples.map((sample) => sample.durationMs)),
      eventLoopDelayMs: summarizeSamples(samples.map((sample) => sample.eventLoopDelayMs)),
      sqliteStatementCount: summarizeStatementCounts(samples.map((sample) => sample.sqliteStatementCount)),
      samples,
    };
  });

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "memory-derived-retrieval",
      mode: "report_only",
      executionMode: "warm_in_process",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: normalizedFixture,
    scenarios: normalizedScenarios,
  };
}

function buildSizedText(prefix, targetBytes) {
  const prefixBytes = Buffer.byteLength(prefix, "utf-8");
  if (prefixBytes > targetBytes) {
    throw new Error("Fixture prefix exceeded its fixed byte budget.");
  }
  return `${prefix}${"x".repeat(targetBytes - prefixBytes)}`;
}

function stringifyPaddedJson(value, targetBytes) {
  const withEmptyPadding = { ...value, padding: "" };
  const baseBytes = Buffer.byteLength(JSON.stringify(withEmptyPadding), "utf-8");
  if (baseBytes > targetBytes) {
    throw new Error("Session artifact fixture exceeded its fixed byte budget.");
  }
  return JSON.stringify({
    ...value,
    padding: "x".repeat(targetBytes - baseBytes),
  });
}

function buildTaskRecord(index) {
  const timestamp = new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString();
  const taskId = `benchmark-task-${index}`;
  const conversationId = `benchmark-conversation-${index}`;
  return {
    id: taskId,
    conversationId,
    sessionKey: conversationId,
    source: "chat",
    status: "partial",
    title: `Derived task benchmark ${index}`,
    objective: "derived task benchmark marker objective",
    summary: "derived task benchmark marker summary",
    reflection: "derived task benchmark marker reflection",
    startedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    workRecap: {
      taskId,
      conversationId,
      sessionKey: conversationId,
      headline: "derived task benchmark marker work recap",
      confirmedFacts: ["derived task benchmark marker confirmed"],
      pendingActions: ["derived task benchmark marker next action"],
      derivedFromActivityIds: [`${taskId}-activity`],
      updatedAt: timestamp,
    },
    resumeContext: {
      taskId,
      conversationId,
      sessionKey: conversationId,
      currentStopPoint: "derived task benchmark marker stop point",
      nextStep: "derived task benchmark marker next step",
      blockers: [],
      derivedFromActivityIds: [`${taskId}-activity`],
      updatedAt: timestamp,
    },
  };
}

function buildExperienceCandidate(index) {
  const taskId = `benchmark-experience-source-task-${index}`;
  const timestamp = new Date(Date.UTC(2026, 6, 2, 0, 0, index % 60)).toISOString();
  return {
    id: `benchmark-experience-${index}`,
    taskId,
    type: "method",
    status: "accepted",
    title: `Derived experience benchmark ${index}`,
    slug: `derived-experience-benchmark-${index}`,
    summary: "derived experience benchmark marker summary",
    content: buildSizedText("derived experience benchmark marker ", experienceBodyBytes),
    qualityScore: 80,
    sourceTaskSnapshot: {
      taskId,
      conversationId: `benchmark-experience-source-conversation-${index}`,
      source: "chat",
      status: "success",
      title: "Derived benchmark source task",
      summary: "derived experience benchmark marker source summary",
      startedAt: timestamp,
      finishedAt: timestamp,
    },
    createdAt: timestamp,
    reviewedAt: timestamp,
    acceptedAt: timestamp,
  };
}

async function createSessionArtifacts(directory) {
  const sessionsDir = path.join(directory, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const items = [];
  const writes = [];

  for (let index = 0; index < sessionArtifactCount; index += 1) {
    const safeConversationId = `benchmark-session-${index}`;
    const conversationId = `agent:benchmark:${index}`;
    const timestamp = Date.UTC(2026, 6, 3, 0, 0, index);
    const sessionMemoryPath = path.join(sessionsDir, `${safeConversationId}.session-memory.json`);
    const digestPath = path.join(sessionsDir, `${safeConversationId}.digest.json`);
    writes.push(fs.writeFile(sessionMemoryPath, stringifyPaddedJson({
      summary: "derived session benchmark marker summary",
      currentGoal: "derived session benchmark marker goal",
      currentWork: "derived session benchmark marker work",
      nextStep: "derived session benchmark marker next step",
      pendingTasks: ["derived session benchmark marker pending"],
      updatedAt: timestamp,
    }, sessionArtifactBytes), "utf-8"));
    writes.push(fs.writeFile(digestPath, stringifyPaddedJson({
      conversationId,
      rollingSummary: "derived session benchmark marker rolling summary",
      archivalSummary: "derived session benchmark marker archival summary",
      lastDigestAt: timestamp,
      pendingMessageCount: index,
    }, sessionArtifactBytes), "utf-8"));
    items.push({
      safeConversationId,
      conversationId,
      newestFileMs: timestamp,
      sessionMemoryPath,
      digestPath,
    });
  }

  await Promise.all(writes);
  return {
    items,
    provider: {
      async listPage(options) {
        return {
          status: "ready",
          items: items.slice(0, options?.limit),
        };
      },
    },
  };
}

async function loadBenchmarkOwners() {
  const managerUrl = pathToFileURL(
    path.join(workspaceRoot, "packages", "belldandy-memory", "src", "manager.ts"),
  ).href;
  const sessionUrl = pathToFileURL(
    path.join(workspaceRoot, "packages", "belldandy-memory", "src", "derived-session-retrieval.ts"),
  ).href;
  const [managerModule, sessionModule] = await Promise.all([
    import(managerUrl),
    import(sessionUrl),
  ]);
  if (typeof managerModule.MemoryManager !== "function") {
    throw new Error("MemoryManager source module did not expose MemoryManager.");
  }
  if (typeof sessionModule.collectDerivedSessionSearchResults !== "function") {
    throw new Error("Session derived retrieval source module did not expose its collector.");
  }
  return {
    MemoryManager: managerModule.MemoryManager,
    collectDerivedSessionSearchResults: sessionModule.collectDerivedSessionSearchResults,
  };
}

async function createFixture(owners) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "star-sanctuary-derived-retrieval-benchmark-"));
  const docsDir = path.join(directory, "docs");
  let manager;
  try {
    await fs.mkdir(docsDir, { recursive: true });
    const startedAt = performance.now();
    const sessionArtifacts = await createSessionArtifacts(directory);
    manager = new owners.MemoryManager({
      workspaceRoot: docsDir,
      stateDir: directory,
      embeddingEnabled: false,
      taskMemoryEnabled: false,
      sessionArtifactInventory: sessionArtifacts.provider,
    });
    const store = manager.store;
    if (!store || typeof store.createTask !== "function") {
      throw new Error("MemoryManager did not expose the benchmark SQLite owner.");
    }
    for (let index = 0; index < taskCount; index += 1) {
      store.createTask(buildTaskRecord(index));
    }
    for (let index = 0; index < experienceCount; index += 1) {
      manager.createExperienceCandidate(buildExperienceCandidate(index));
    }
    return {
      directory,
      manager,
      store,
      sessionArtifactInventory: sessionArtifacts.provider,
      fixture: {
        sessionArtifactCount,
        sessionArtifactFileCount: sessionArtifactCount * 2,
        sessionArtifactBytes,
        taskCount,
        experienceCount,
        experienceBodyBytes,
        seedDurationMs: performance.now() - startedAt,
        chainBudgets,
      },
    };
  } catch (error) {
    await Promise.resolve(manager?.close()).catch(() => {});
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function waitForImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function countSqliteStatements(store, operation) {
  const database = store?.db;
  if (!database || typeof database.prepare !== "function") {
    throw new Error("MemoryStore did not expose the SQLite owner required for statement diagnostics.");
  }
  const originalPrepare = database.prepare;
  let statementCount = 0;
  database.prepare = function wrappedPrepare(...args) {
    statementCount += 1;
    return Reflect.apply(originalPrepare, this, args);
  };
  try {
    return {
      execution: await operation(),
      statementCount,
    };
  } finally {
    database.prepare = originalPrepare;
  }
}

async function measureSample(store, operation) {
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  await waitForImmediate();
  const startedAt = performance.now();
  try {
    const measured = await countSqliteStatements(store, operation);
    const durationMs = performance.now() - startedAt;
    await waitForImmediate();
    const delayNs = delay.percentile(95);
    return {
      execution: measured.execution,
      sample: {
        durationMs,
        eventLoopDelayMs: Number.isFinite(delayNs) && delayNs > 0 ? delayNs / 1_000_000 : 0,
        sqliteStatementCount: measured.statementCount,
      },
    };
  } finally {
    delay.disable();
  }
}

function normalizeExecution(execution, scenarioId) {
  const report = execution?.report;
  if (!report || !Array.isArray(execution.items)) {
    throw new Error(`${scenarioId} did not return a derived retrieval execution.`);
  }
  const observed = normalizeObserved(report, `${scenarioId}.report`);
  if (observed.resultCount !== execution.items.length) {
    throw new Error(`${scenarioId} report resultCount did not match its returned items.`);
  }
  return observed;
}

async function runScenario(definition, { warmupRuns, sampleRuns, store }) {
  let observed;
  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:memory-derived-retrieval] ${definition.id} warm-up ${index + 1}/${warmupRuns}`);
    const warmup = await countSqliteStatements(store, definition.execute);
    normalizeExecution(warmup.execution, definition.id);
  }

  const samples = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:memory-derived-retrieval] ${definition.id} sample ${index + 1}/${sampleRuns}`);
    const measured = await measureSample(store, definition.execute);
    const currentObserved = normalizeExecution(measured.execution, definition.id);
    if (observed && JSON.stringify(observed) !== JSON.stringify(currentObserved)) {
      throw new Error(`${definition.id} returned unstable derived report counts across samples.`);
    }
    observed = currentObserved;
    samples.push(measured.sample);
  }

  if (!observed || observed.resultCount !== definition.expectedResultCount) {
    throw new Error(`${definition.id} did not return its fixed expected result count.`);
  }
  return {
    id: definition.id,
    chain: definition.chain,
    operation: definition.operation,
    observed,
    samples,
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
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

async function readPackageVersion(packagePath) {
  try {
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf-8"));
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

async function collectReportContext() {
  const [rootPackage, betterSqlite3Version] = await Promise.all([
    fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8").then(JSON.parse),
    readPackageVersion(path.join(
      workspaceRoot,
      "packages",
      "belldandy-memory",
      "node_modules",
      "better-sqlite3",
      "package.json",
    )),
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
      betterSqlite3Version,
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
  console.log(`Usage: node --import tsx scripts/run-memory-derived-retrieval-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per chain (default: 2)
  --sample-runs <n>     Measured runs per chain (default: 7)
  --help                Show this help message`);
}

async function main() {
  const args = parseMemoryDerivedRetrievalBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [owners, context] = await Promise.all([
    loadBenchmarkOwners(),
    collectReportContext(),
  ]);
  let fixture;
  try {
    fixture = await createFixture(owners);
    const manager = fixture.manager;
    if (typeof manager.collectDerivedTaskSearchResults !== "function"
      || typeof manager.collectDerivedExperienceSearchResults !== "function") {
      throw new Error("MemoryManager did not expose the derived retrieval owners required by this benchmark.");
    }
    const scenarios = [];
    scenarios.push(await runScenario({
      id: "session_artifact_provider_and_file_reads",
      chain: "session",
      operation: "collectDerivedSessionSearchResults",
      expectedResultCount: 4,
      execute: () => owners.collectDerivedSessionSearchResults({
        sessionArtifactInventory: fixture.sessionArtifactInventory,
        query: SESSION_QUERY,
        limit: 4,
        includeContent: true,
      }),
    }, { ...args, store: fixture.store }));
    scenarios.push(await runScenario({
      id: "task_recent_search_and_detail_projection",
      chain: "task",
      operation: "MemoryManager.collectDerivedTaskSearchResults",
      expectedResultCount: 3,
      execute: () => manager.collectDerivedTaskSearchResults(TASK_QUERY, {
        limit: 5,
        includeContent: true,
      }),
    }, { ...args, store: fixture.store }));
    scenarios.push(await runScenario({
      id: "experience_fts_and_detail_projection",
      chain: "experience",
      operation: "MemoryManager.collectDerivedExperienceSearchResults",
      expectedResultCount: 2,
      execute: () => manager.collectDerivedExperienceSearchResults(EXPERIENCE_QUERY, {
        limit: 5,
        includeContent: true,
      }),
    }, { ...args, store: fixture.store }));

    const report = createMemoryDerivedRetrievalBenchmarkReport({
      generatedAt: new Date().toISOString(),
      environment: context.environment,
      source: context.source,
      fixture: {
        warmupRuns: args.warmupRuns,
        sampleRuns: args.sampleRuns,
        ...fixture.fixture,
      },
      scenarios,
    });
    const outputPath = await writeReport(args.output, report);
    for (const scenario of report.scenarios) {
      console.log(
        `[benchmark:memory-derived-retrieval] ${scenario.id}: p50=${scenario.warmLatencyMs.p50}ms p95=${scenario.warmLatencyMs.p95}ms statements=${scenario.sqliteStatementCount.p50} event-loop-p95=${scenario.eventLoopDelayMs.p95}ms`,
      );
    }
    console.log(`[benchmark:memory-derived-retrieval] report-only: ${outputPath}`);
  } finally {
    await Promise.resolve(fixture?.manager?.close()).catch(() => {});
    if (fixture?.directory) {
      await fs.rm(fixture.directory, { recursive: true, force: true });
    }
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:memory-derived-retrieval] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
