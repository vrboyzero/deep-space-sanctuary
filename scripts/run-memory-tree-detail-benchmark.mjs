import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MemoryManager } from "../packages/belldandy-memory/src/manager.ts";
import { MemoryStore } from "../packages/belldandy-memory/src/store.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/p2-m03-s001.json";
const totalNodeCount = 50;
const chunksPerNode = 20;
const sourcesPerNode = 1;
const chunkContentBytes = 512;
const scenarioNodeCounts = [1, 10, 50];
const expectedScenarios = new Map(scenarioNodeCounts.map((nodeCount) => [
  `tree_detail_${nodeCount}_${nodeCount === 1 ? "node" : "nodes"}`,
  nodeCount,
]));

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

function summarizeSamples(samples, unit) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`Benchmark summaries require at least one ${unit} sample.`);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sampleCount;
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sampleCount) - 1)];
  return {
    unit,
    sampleCount,
    min: round(sorted[0]),
    max: round(sorted[sampleCount - 1]),
    mean: round(mean),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    percentileMethod: "nearest-rank",
  };
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one query-plan detail.`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
}

function normalizeObserved(value, label) {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object.`);
  }
  if (typeof value.behaviorDigest !== "string" || !value.behaviorDigest.trim()) {
    throw new Error(`${label}.behaviorDigest must be a non-empty stable digest.`);
  }
  return {
    nodeCount: requireNonNegativeInteger(value.nodeCount, `${label}.nodeCount`),
    edgeCount: requireNonNegativeInteger(value.edgeCount, `${label}.edgeCount`),
    chunkCount: requireNonNegativeInteger(value.chunkCount, `${label}.chunkCount`),
    sourceCount: requireNonNegativeInteger(value.sourceCount, `${label}.sourceCount`),
    behaviorDigest: value.behaviorDigest,
  };
}

export function parseMemoryTreeDetailBenchmarkArgs(argv) {
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
      args.warmupRuns = parseCount(value, argument, { allowZero: true, maximum: 100 });
    } else if (argument === "--sample-runs") {
      args.sampleRuns = parseCount(value, argument, { maximum: 100 });
    } else {
      throw new Error(`Unsupported argument ${argument}.`);
    }
  }
  return args;
}

export function createMemoryTreeDetailBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  queryPlans,
  scenarios,
}) {
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  const normalizedFixture = {
    warmupRuns: parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true }),
    sampleRuns,
    totalNodeCount: parseCount(fixture?.totalNodeCount, "fixture.totalNodeCount"),
    chunksPerNode: parseCount(fixture?.chunksPerNode, "fixture.chunksPerNode"),
    sourcesPerNode: parseCount(fixture?.sourcesPerNode, "fixture.sourcesPerNode"),
    chunkContentBytes: parseCount(fixture?.chunkContentBytes, "fixture.chunkContentBytes"),
    scenarios: Array.isArray(fixture?.scenarios)
      ? fixture.scenarios.map((value, index) => parseCount(value, `fixture.scenarios[${index}]`))
      : [],
    ...(fixture?.seedDurationMs === undefined
      ? {}
      : { seedDurationMs: round(requireNonNegativeNumber(fixture.seedDurationMs, "fixture.seedDurationMs")) }),
  };
  if (JSON.stringify(normalizedFixture.scenarios) !== JSON.stringify(scenarioNodeCounts)) {
    throw new Error(`fixture.scenarios must equal ${scenarioNodeCounts.join(",")}.`);
  }
  const normalizedPlans = {
    nodeById: normalizeStringArray(queryPlans?.nodeById, "queryPlans.nodeById"),
    edgesByParent: normalizeStringArray(queryPlans?.edgesByParent, "queryPlans.edgesByParent"),
    chunkById: normalizeStringArray(queryPlans?.chunkById, "queryPlans.chunkById"),
    sourcesByIds: normalizeStringArray(queryPlans?.sourcesByIds, "queryPlans.sourcesByIds"),
  };
  if (!Array.isArray(scenarios) || scenarios.length !== expectedScenarios.size) {
    throw new Error("The memory tree detail benchmark requires exactly three scenarios.");
  }
  const seen = new Set();
  const normalizedScenarios = scenarios.map((scenario) => {
    const expectedNodeCount = expectedScenarios.get(scenario?.id);
    if (!expectedNodeCount || seen.has(scenario.id)) {
      throw new Error("Each memory tree detail benchmark scenario must have a unique known id.");
    }
    seen.add(scenario.id);
    if (scenario.operation !== "MemoryManager.getMemoryTreeNodeDetails") {
      throw new Error(`${scenario.id} does not match the current detail owner.`);
    }
    const observed = normalizeObserved(scenario.observed, `${scenario.id}.observed`);
    if (observed.nodeCount !== expectedNodeCount) {
      throw new Error(`${scenario.id} returned an unexpected node count.`);
    }
    if (!Array.isArray(scenario.samples) || scenario.samples.length !== sampleRuns) {
      throw new Error(`${scenario.id} must contain exactly ${sampleRuns} measured samples.`);
    }
    const samples = scenario.samples.map((sample, index) => ({
      durationMs: round(requireNonNegativeNumber(
        sample?.durationMs,
        `${scenario.id}.samples[${index}].durationMs`,
      )),
      sqliteStatementCount: requireNonNegativeInteger(
        sample?.sqliteStatementCount,
        `${scenario.id}.samples[${index}].sqliteStatementCount`,
      ),
    }));
    return {
      id: scenario.id,
      operation: scenario.operation,
      observed,
      warmLatencyMs: summarizeSamples(samples.map((sample) => sample.durationMs), "milliseconds"),
      sqliteStatementCount: summarizeSamples(
        samples.map((sample) => sample.sqliteStatementCount),
        "statements",
      ),
      samples,
    };
  });
  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "memory-tree-detail",
      mode: "report_only",
      executionMode: "warm_in_process",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: normalizedFixture,
    queryPlans: normalizedPlans,
    scenarios: normalizedScenarios,
  };
}

function buildFixedContent(nodeIndex, chunkIndex) {
  const prefix = `tree-detail node=${nodeIndex} chunk=${chunkIndex} `;
  const remainingBytes = chunkContentBytes - Buffer.byteLength(prefix, "utf-8");
  if (remainingBytes < 0) {
    throw new Error("Memory tree detail fixture prefix exceeded the chunk byte budget.");
  }
  return `${prefix}${"x".repeat(remainingBytes)}`;
}

function buildFixtureRecords() {
  const nodes = [];
  const edges = [];
  const chunks = [];
  const sources = [];
  const nodeIds = [];
  const now = "2026-07-23T00:00:00.000Z";
  for (let nodeIndex = 0; nodeIndex < totalNodeCount; nodeIndex += 1) {
    const ordinal = String(nodeIndex).padStart(3, "0");
    const nodeId = `benchmark:tree-node-${ordinal}`;
    const sourceId = `benchmark:tree-source-${ordinal}`;
    nodeIds.push(nodeId);
    nodes.push({
      id: nodeId,
      level: 2,
      kind: "topic",
      scope: "private",
      topicKey: `benchmark-topic-${ordinal}`,
      title: `Tree detail benchmark ${ordinal}`,
      summary: `tree detail benchmark marker ${ordinal}`,
      summaryVersion: "m03-s001-v1",
      createdAt: now,
      updatedAt: now,
    });
    sources.push({
      id: sourceId,
      sourceKind: "workspace_file",
      sourceClass: "raw",
      scope: "private",
      sourcePath: `benchmark/source-${ordinal}.md`,
      itemCount: chunksPerNode,
      createdAt: now,
      updatedAt: now,
    });
    for (let chunkIndex = 0; chunkIndex < chunksPerNode; chunkIndex += 1) {
      const chunkOrdinal = String(chunkIndex).padStart(2, "0");
      const chunkId = `benchmark:tree-chunk-${ordinal}-${chunkOrdinal}`;
      chunks.push({
        id: chunkId,
        sourcePath: `benchmark/source-${ordinal}.md`,
        sourceType: "file",
        memoryType: "other",
        content: buildFixedContent(nodeIndex, chunkIndex),
        topic: `benchmark-topic-${ordinal}`,
        metadata: { sourceId, fixture: "m03-s001" },
      });
      edges.push({
        id: `benchmark:tree-edge-${ordinal}-chunk-${chunkOrdinal}`,
        parentNodeId: nodeId,
        childType: "chunk",
        childId: chunkId,
        relation: "contains",
        position: chunkIndex,
        weight: 1 - (chunkIndex / 100),
        createdAt: now,
      });
    }
    edges.push({
      id: `benchmark:tree-edge-${ordinal}-source`,
      parentNodeId: nodeId,
      childType: "source",
      childId: sourceId,
      relation: "derived_from",
      position: chunksPerNode,
      weight: 1,
      createdAt: now,
    });
  }
  return { nodes, edges, chunks, sources, nodeIds };
}

async function seedFixture(databasePath) {
  const store = new MemoryStore(databasePath);
  const fixture = buildFixtureRecords();
  const startedAt = performance.now();
  try {
    for (const chunk of fixture.chunks) {
      store.upsertChunk(chunk);
    }
    store.upsertMemorySources(fixture.sources);
    store.upsertMemoryTreeNodes(fixture.nodes);
    store.upsertMemoryTreeEdges(fixture.edges);
  } finally {
    store.close();
  }
  return {
    nodeIds: fixture.nodeIds,
    seedDurationMs: round(performance.now() - startedAt),
  };
}

function installSqliteStatementCounter(manager) {
  const database = manager.getDbHandleForSharedSchema();
  const originalPrepare = database.prepare;
  let count = 0;
  database.prepare = function countedPrepare(sql) {
    const statement = originalPrepare.call(this, sql);
    return new Proxy(statement, {
      get(target, property) {
        if (property === "all" || property === "get" || property === "run" || property === "iterate") {
          return (...args) => {
            count += 1;
            return target[property](...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return {
    reset() {
      count = 0;
    },
    read() {
      return count;
    },
    restore() {
      database.prepare = originalPrepare;
    },
  };
}

function buildBehaviorProjection(details) {
  return details.map((detail) => ({
    nodeId: detail.node.id,
    edges: detail.edges.map((edge) => [edge.id, edge.childType, edge.childId, edge.position ?? null]),
    chunks: detail.chunks.map((chunk) => [chunk.id, Buffer.byteLength(chunk.content ?? "", "utf-8")]),
    sources: detail.sources.map((source) => source.id),
  }));
}

function executeCurrentDetails(manager, counter, nodeIds) {
  counter.reset();
  const startedAt = performance.now();
  const detailsById = manager.getMemoryTreeNodeDetails(nodeIds, { chunkLimit: chunksPerNode });
  const details = nodeIds.map((nodeId) => detailsById.get(nodeId));
  const durationMs = performance.now() - startedAt;
  const sqliteStatementCount = counter.read();
  if (details.some((detail) => !detail)) {
    throw new Error("The current detail owner failed to resolve a fixed-corpus node.");
  }
  const resolved = details;
  const projection = buildBehaviorProjection(resolved);
  return {
    durationMs,
    sqliteStatementCount,
    observed: {
      nodeCount: resolved.length,
      edgeCount: resolved.reduce((total, detail) => total + detail.edges.length, 0),
      chunkCount: resolved.reduce((total, detail) => total + detail.chunks.length, 0),
      sourceCount: resolved.reduce((total, detail) => total + detail.sources.length, 0),
      behaviorDigest: crypto.createHash("sha256").update(JSON.stringify(projection)).digest("hex"),
    },
  };
}

function runScenario(manager, counter, nodeIds, warmupRuns, sampleRuns) {
  let expectedObserved;
  const runOnce = () => {
    const result = executeCurrentDetails(manager, counter, nodeIds);
    if (!expectedObserved) {
      expectedObserved = result.observed;
    } else if (JSON.stringify(result.observed) !== JSON.stringify(expectedObserved)) {
      throw new Error("Memory tree detail behavior changed across benchmark samples.");
    }
    return result;
  };
  for (let index = 0; index < warmupRuns; index += 1) {
    runOnce();
  }
  const samples = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    const result = runOnce();
    samples.push({
      durationMs: result.durationMs,
      sqliteStatementCount: result.sqliteStatementCount,
    });
  }
  return { observed: expectedObserved, samples };
}

function explainQuery(database, sql, params) {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
  const details = rows.map((row) => typeof row?.detail === "string" ? row.detail.trim() : "").filter(Boolean);
  if (details.length === 0) {
    throw new Error("SQLite EXPLAIN QUERY PLAN returned no detail rows.");
  }
  return details;
}

function collectQueryPlans(database, nodeId) {
  return {
    nodeById: explainQuery(database, `
      SELECT * FROM memory_tree_nodes WHERE id IN (?, ?)
    `, [nodeId, "benchmark:tree-node-001"]),
    edgesByParent: explainQuery(database, `
      SELECT * FROM memory_tree_edges
      WHERE parent_node_id IN (?, ?)
      ORDER BY parent_node_id ASC, COALESCE(position, 999999) ASC, child_id ASC
    `, [nodeId, "benchmark:tree-node-001"]),
    chunkById: explainQuery(database, `
      SELECT id, source_path, source_type, memory_type, visibility, content, metadata,
             topic, start_line, end_line, summary, category, updated_at
      FROM chunks WHERE id IN (?, ?)
    `, ["benchmark:tree-chunk-000-00", "benchmark:tree-chunk-000-01"]),
    sourcesByIds: explainQuery(database, `
      SELECT * FROM memory_sources WHERE id IN (?, ?)
    `, ["benchmark:tree-source-000", "benchmark:tree-source-001"]),
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
  return result.error || result.status !== 0 ? null : result.stdout.trim();
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
  const rootPackage = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8"));
  const betterSqlite3Version = await readPackageVersion(path.join(
    workspaceRoot,
    "packages",
    "belldandy-memory",
    "node_modules",
    "better-sqlite3",
    "package.json",
  ));
  const status = readGit(["status", "--porcelain"]);
  const cpus = os.cpus();
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
      runnerSha256: await sha256File(fileURLToPath(import.meta.url)),
    },
  };
}

export async function runMemoryTreeDetailBenchmark(options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-detail-"));
  const databasePath = path.join(directory, "memory.sqlite");
  let manager;
  try {
    const seeded = await seedFixture(databasePath);
    manager = new MemoryManager({
      workspaceRoot: directory,
      stateDir: directory,
      storePath: databasePath,
      embeddingEnabled: false,
    });
    const counter = installSqliteStatementCounter(manager);
    try {
      const scenarios = scenarioNodeCounts.map((nodeCount) => {
        const result = runScenario(
          manager,
          counter,
          seeded.nodeIds.slice(0, nodeCount),
          options.warmupRuns,
          options.sampleRuns,
        );
        return {
          id: `tree_detail_${nodeCount}_${nodeCount === 1 ? "node" : "nodes"}`,
          operation: "MemoryManager.getMemoryTreeNodeDetails",
          ...result,
        };
      });
      const context = await collectReportContext();
      return createMemoryTreeDetailBenchmarkReport({
        generatedAt: new Date().toISOString(),
        ...context,
        fixture: {
          warmupRuns: options.warmupRuns,
          sampleRuns: options.sampleRuns,
          totalNodeCount,
          chunksPerNode,
          sourcesPerNode,
          chunkContentBytes,
          scenarios: scenarioNodeCounts,
          seedDurationMs: seeded.seedDurationMs,
        },
        queryPlans: collectQueryPlans(manager.getDbHandleForSharedSchema(), seeded.nodeIds[0]),
        scenarios,
      });
    } finally {
      counter.restore();
    }
  } finally {
    await manager?.close();
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeReport(outputPath, report) {
  const resolved = path.resolve(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return resolved;
}

function printHelp() {
  console.log(`Usage: node --import tsx scripts/run-memory-tree-detail-benchmark.mjs [options]

Options:
  --output <path>       Report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per scenario (default: 2)
  --sample-runs <n>     Measured runs per scenario (default: 7)
  --help, -h            Show this help`);
}

async function main() {
  const options = parseMemoryTreeDetailBenchmarkArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await runMemoryTreeDetailBenchmark(options);
  const outputPath = await writeReport(options.output, report);
  console.log(`[benchmark:memory-tree-detail] wrote ${outputPath}`);
  for (const scenario of report.scenarios) {
    console.log(
      `[benchmark:memory-tree-detail] ${scenario.id}: p50=${scenario.warmLatencyMs.p50} ms, `
      + `p95=${scenario.warmLatencyMs.p95} ms, statements=${scenario.sqliteStatementCount.p95}`,
    );
  }
}

const isMain = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
