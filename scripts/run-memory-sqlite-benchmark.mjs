import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CHUNK_VECTOR_READ_BIND_PARAMETER_BATCH_SIZE,
  buildChunkVectorBatchReadQuery,
} from "../packages/belldandy-memory/src/chunk-vector-batch.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/b00-memory-sqlite.json";
const defaultChunkCount = 2_000;
const defaultChunkContentBytes = 512;
const defaultVectorDimensions = 16;
const defaultVectorBatchSize = 64;
const maxFixtureBytes = 64 * 1024 * 1024;
const maxChunkCount = 100_000;
const minimumChunkContentBytes = 128;

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

export function parseMemorySqliteBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
    chunkCount: defaultChunkCount,
    chunkContentBytes: defaultChunkContentBytes,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    // pnpm run <script> -- <args> 会将分隔符传给脚本，忽略它以兼容两种调用形式。
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
    } else if (argument === "--chunk-count") {
      args.chunkCount = parseCount(value, argument, { maximum: maxChunkCount });
    } else if (argument === "--chunk-content-bytes") {
      args.chunkContentBytes = parseCount(value, argument, {
        maximum: maxFixtureBytes,
      });
    } else {
      throw new Error(`Unsupported argument ${argument}.`);
    }
  }

  if (args.chunkContentBytes < minimumChunkContentBytes) {
    throw new Error(`--chunk-content-bytes must be at least ${minimumChunkContentBytes}.`);
  }
  if (args.chunkCount * args.chunkContentBytes > maxFixtureBytes) {
    throw new Error(`Fixture content must not exceed ${maxFixtureBytes} bytes.`);
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

function requireNonNegativeDuration(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative duration.`);
  }
  return value;
}

function normalizeStorage(storage) {
  const normalized = {
    databaseBytes: requireNonNegativeInteger(storage?.databaseBytes, "fixture.storage.databaseBytes"),
    walBytes: requireNonNegativeInteger(storage?.walBytes, "fixture.storage.walBytes"),
    shmBytes: requireNonNegativeInteger(storage?.shmBytes, "fixture.storage.shmBytes"),
    totalBytes: requireNonNegativeInteger(storage?.totalBytes, "fixture.storage.totalBytes"),
    pageCount: requireNonNegativeInteger(storage?.pageCount, "fixture.storage.pageCount"),
    freelistCount: requireNonNegativeInteger(storage?.freelistCount, "fixture.storage.freelistCount"),
  };
  if (normalized.totalBytes !== normalized.databaseBytes + normalized.walBytes + normalized.shmBytes) {
    throw new Error("fixture.storage.totalBytes must equal databaseBytes + walBytes + shmBytes.");
  }
  return normalized;
}

function normalizeQueryDiagnostics(value, scenarioId) {
  if (value === undefined) return undefined;
  const candidateCount = parseCount(value?.candidateCount, `${scenarioId}.queryDiagnostics.candidateCount`);
  const logicalStatementCount = parseCount(
    value?.logicalStatementCount,
    `${scenarioId}.queryDiagnostics.logicalStatementCount`,
  );
  if (logicalStatementCount !== Math.ceil(candidateCount / CHUNK_VECTOR_READ_BIND_PARAMETER_BATCH_SIZE)) {
    throw new Error(`${scenarioId}.queryDiagnostics.logicalStatementCount does not match the canonical batch limit.`);
  }
  if (!Array.isArray(value?.queryPlan) || value.queryPlan.length === 0 || value.queryPlan.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${scenarioId}.queryDiagnostics.queryPlan must contain plan detail strings.`);
  }
  return {
    candidateCount,
    logicalStatementCount,
    queryPlan: [...value.queryPlan],
  };
}

export function createMemorySqliteBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", { allowZero: true });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns");
  const chunkCount = parseCount(fixture?.chunkCount, "fixture.chunkCount", { maximum: maxChunkCount });
  const chunkContentBytes = parseCount(fixture?.chunkContentBytes, "fixture.chunkContentBytes", {
    maximum: maxFixtureBytes,
  });
  const generatedContentBytes = requireNonNegativeInteger(
    fixture?.generatedContentBytes,
    "fixture.generatedContentBytes",
  );
  const vectorDimensions = parseCount(fixture?.vectorDimensions, "fixture.vectorDimensions", { maximum: 4_096 });
  const vectorBatchSize = parseCount(fixture?.vectorBatchSize, "fixture.vectorBatchSize", { maximum: 900 });
  const vectorIndexedCount = requireNonNegativeInteger(
    fixture?.vectorIndexedCount,
    "fixture.vectorIndexedCount",
  );
  const embeddingCacheEntryCount = requireNonNegativeInteger(
    fixture?.embeddingCacheEntryCount,
    "fixture.embeddingCacheEntryCount",
  );
  const seedDurationMs = requireNonNegativeDuration(fixture?.seedDurationMs, "fixture.seedDurationMs");
  const storage = normalizeStorage(fixture?.storage);

  if (chunkContentBytes < minimumChunkContentBytes) {
    throw new Error(`fixture.chunkContentBytes must be at least ${minimumChunkContentBytes}.`);
  }
  if (chunkCount * chunkContentBytes > maxFixtureBytes) {
    throw new Error(`fixture content must not exceed ${maxFixtureBytes} bytes.`);
  }
  if (generatedContentBytes !== chunkCount * chunkContentBytes) {
    throw new Error("fixture.generatedContentBytes must equal chunkCount * chunkContentBytes.");
  }
  if (vectorBatchSize > chunkCount) {
    throw new Error("fixture.vectorBatchSize must not exceed fixture.chunkCount.");
  }
  if (vectorIndexedCount !== chunkCount || embeddingCacheEntryCount !== chunkCount) {
    throw new Error("fixture must contain one vector and cache entry per chunk.");
  }
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("At least one benchmark scenario is required.");
  }

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "memory-sqlite-store-operations",
      mode: "report_only",
      executionMode: "warm_in_process",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      chunkCount,
      chunkContentBytes,
      generatedContentBytes,
      vectorDimensions,
      vectorBatchSize,
      vectorIndexedCount,
      embeddingCacheEntryCount,
      seedDurationMs: round(seedDurationMs),
      storage,
    },
    scenarios: scenarios.map((scenario) => {
      if (typeof scenario?.id !== "string" || !scenario.id) {
        throw new Error("Each benchmark scenario requires an id.");
      }
      if (typeof scenario.operation !== "string" || !scenario.operation.startsWith("MemoryStore.")) {
        throw new Error(`${scenario.id} must identify a MemoryStore operation.`);
      }
      const resultCount = parseCount(scenario.resultCount, `${scenario.id}.resultCount`);
      requireSamples(scenario.samplesMs, sampleRuns, scenario.id);
      const queryDiagnostics = normalizeQueryDiagnostics(scenario.queryDiagnostics, scenario.id);
      return {
        id: scenario.id,
        operation: scenario.operation,
        resultCount,
        samplesMs: scenario.samplesMs.map((sample) => round(sample)),
        summary: summarizeSamples(scenario.samplesMs),
        ...(queryDiagnostics ? { queryDiagnostics } : {}),
      };
    }),
  };
}

function buildFixtureContent(index, targetBytes) {
  const prefix = `benchmark corpus sharedtoken topic${index % 8} agent${index % 4} uniquechunk${index} `;
  const padding = "abcdefghijklmnopqrstuvwxyz0123456789 ";
  let content = prefix;
  let paddingOffset = 0;
  while (Buffer.byteLength(content, "utf-8") < targetBytes) {
    const remaining = targetBytes - Buffer.byteLength(content, "utf-8");
    const segment = `${padding.slice(paddingOffset)}${padding}`.slice(0, remaining);
    content += segment;
    paddingOffset = (paddingOffset + segment.length) % padding.length;
  }
  return content;
}

function buildFixtureEmbedding(index, dimensions) {
  return Array.from({ length: dimensions }, (_, dimension) => (
    ((index + dimension + 1) % 97) / 97
  ));
}

function buildFixtureVectorWrites(chunkCount, dimensions) {
  return Array.from({ length: chunkCount }, (_, index) => ({
    chunkId: `benchmark-chunk-${index}`,
    embedding: buildFixtureEmbedding(index, dimensions),
    cacheHash: `benchmark-cache-${index}`,
  }));
}

function splitIntoBatches(items, batchSize) {
  const batches = [];
  for (let start = 0; start < items.length; start += batchSize) {
    batches.push(items.slice(start, start + batchSize));
  }
  return batches;
}

async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function getStorageStats(dbPath, pageStats) {
  const [databaseBytes, walBytes, shmBytes] = await Promise.all([
    getFileSize(dbPath),
    getFileSize(`${dbPath}-wal`),
    getFileSize(`${dbPath}-shm`),
  ]);
  return {
    databaseBytes,
    walBytes,
    shmBytes,
    totalBytes: databaseBytes + walBytes + shmBytes,
    pageCount: pageStats.pageCount,
    freelistCount: pageStats.freelistCount,
  };
}

async function loadMemoryStore() {
  const storeUrl = pathToFileURL(
    path.join(workspaceRoot, "packages", "belldandy-memory", "src", "store.ts"),
  ).href;
  const module = await import(storeUrl);
  if (typeof module.MemoryStore !== "function") {
    throw new Error("MemoryStore source module did not expose MemoryStore.");
  }
  return module.MemoryStore;
}

async function createFixture(MemoryStore, { chunkCount, chunkContentBytes }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "star-sanctuary-memory-benchmark-"));
  const dbPath = path.join(directory, "memory.db");
  let store;
  try {
    store = new MemoryStore(dbPath);
    const startedAt = performance.now();
    for (let index = 0; index < chunkCount; index += 1) {
      store.upsertChunk({
        id: `benchmark-chunk-${index}`,
        sourcePath: `/benchmark/fixture-${Math.floor(index / 100)}.md`,
        sourceType: "manual",
        memoryType: index % 2 === 0 ? "core" : "daily",
        content: buildFixtureContent(index, chunkContentBytes),
        topic: `topic${index % 8}`,
        agentId: `agent${index % 4}`,
        category: "fact",
      });
    }
    const vectorWrites = buildFixtureVectorWrites(chunkCount, defaultVectorDimensions);
    for (const vectorWriteBatch of splitIntoBatches(vectorWrites, defaultVectorBatchSize)) {
      const writtenChunkIds = store.upsertChunkVectorsBatch(vectorWriteBatch, "benchmark-model");
      if (writtenChunkIds.length !== vectorWriteBatch.length) {
        throw new Error("Fixture vector batch did not write every seeded chunk.");
      }
    }
    const vectorStatus = store.getVectorStatus();
    if (vectorStatus.indexed !== chunkCount || vectorStatus.cached !== chunkCount) {
      throw new Error("Fixture vector/cache population did not match the seeded chunk count.");
    }
    const seedDurationMs = performance.now() - startedAt;
    const pageStats = store.getDatabasePageStats();
    store.close();
    store = undefined;

    const storage = await getStorageStats(dbPath, pageStats);
    const searchStore = new MemoryStore(dbPath);
    return {
      directory,
      store: searchStore,
      fixture: {
        chunkCount,
        chunkContentBytes,
        generatedContentBytes: chunkCount * chunkContentBytes,
        vectorDimensions: defaultVectorDimensions,
        vectorBatchSize: Math.min(defaultVectorBatchSize, chunkCount),
        vectorIndexedCount: vectorStatus.indexed,
        embeddingCacheEntryCount: vectorStatus.cached,
        seedDurationMs,
        storage,
      },
    };
  } catch (error) {
    store?.close();
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function runScenario({ id, operation, execute, expectedMinimumResults, queryDiagnostics }, warmupRuns, sampleRuns) {
  let resultCount = null;
  const runOnce = () => {
    const startedAt = performance.now();
    const currentResultCount = execute();
    const durationMs = performance.now() - startedAt;
    if (!Number.isInteger(currentResultCount) || currentResultCount < expectedMinimumResults) {
      throw new Error(`${id} returned fewer than ${expectedMinimumResults} expected results.`);
    }
    if (resultCount === null) {
      resultCount = currentResultCount;
    } else if (currentResultCount !== resultCount) {
      throw new Error(`${id} returned an unstable result count across samples.`);
    }
    return durationMs;
  };

  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:memory-sqlite] ${id} warm-up ${index + 1}/${warmupRuns}`);
    runOnce();
  }

  const samplesMs = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:memory-sqlite] ${id} sample ${index + 1}/${sampleRuns}`);
    samplesMs.push(runOnce());
  }

  return {
    id,
    operation,
    resultCount,
    samplesMs,
    ...(queryDiagnostics ? { queryDiagnostics: queryDiagnostics() } : {}),
  };
}

function collectVectorBatchReadDiagnostics(store, chunkIds) {
  const uniqueChunkIds = [...new Set(chunkIds)];
  const batches = splitIntoBatches(uniqueChunkIds, CHUNK_VECTOR_READ_BIND_PARAMETER_BATCH_SIZE);
  const database = store.db;
  if (!database || typeof database.prepare !== "function") {
    throw new Error("MemoryStore did not expose the SQLite owner required for benchmark diagnostics.");
  }
  const queryPlan = [];
  for (const batch of batches) {
    const planRows = database.prepare(`EXPLAIN QUERY PLAN ${buildChunkVectorBatchReadQuery(batch.length)}`)
      .all(...batch);
    for (const row of planRows) {
      const detail = typeof row?.detail === "string" ? row.detail : null;
      if (!detail) {
        throw new Error("SQLite query plan did not expose a detail string.");
      }
      queryPlan.push(detail);
    }
  }
  return {
    candidateCount: uniqueChunkIds.length,
    logicalStatementCount: batches.length,
    queryPlan,
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
  console.log(`Usage: node --import tsx scripts/run-memory-sqlite-benchmark.mjs [options]

Options:
  --output <path>               JSON report path (default: ${defaultOutput})
  --warmup-runs <n>             Warm-up searches per scenario (default: 1)
  --sample-runs <n>             Measured operations per scenario (default: 5)
  --chunk-count <n>             Deterministic fixture chunk count (default: ${defaultChunkCount})
  --chunk-content-bytes <n>     Exact UTF-8 bytes per fixture chunk (default: ${defaultChunkContentBytes})
  --help                        Show this help message`);
}

async function main() {
  const args = parseMemorySqliteBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [MemoryStore, context] = await Promise.all([
    loadMemoryStore(),
    collectReportContext(),
  ]);
  let fixture;
  try {
    fixture = await createFixture(MemoryStore, args);
    const allVectorWrites = buildFixtureVectorWrites(
      fixture.fixture.chunkCount,
      fixture.fixture.vectorDimensions,
    );
    const vectorWrites = allVectorWrites.slice(0, fixture.fixture.vectorBatchSize);
    const vectorReadCandidateCounts = [...new Set([
      Math.min(CHUNK_VECTOR_READ_BIND_PARAMETER_BATCH_SIZE, allVectorWrites.length),
      Math.min(CHUNK_VECTOR_READ_BIND_PARAMETER_BATCH_SIZE * 2, allVectorWrites.length),
    ])].filter((candidateCount) => candidateCount > vectorWrites.length);
    const scenarioDefinitions = [
      {
        id: "keyword_search_common",
        operation: "MemoryStore.searchKeyword",
        expectedMinimumResults: 1,
        execute: () => fixture.store.searchKeyword("benchmark corpus sharedtoken", 10).length,
      },
      {
        id: "keyword_search_filtered",
        operation: "MemoryStore.searchKeyword",
        expectedMinimumResults: 1,
        execute: () => fixture.store.searchKeyword("benchmark corpus", 10, {
          agentId: "agent0",
          memoryType: "core",
          topic: "topic0",
        }).length,
      },
      {
        id: "vector_batch_write",
        operation: "MemoryStore.upsertChunkVectorsBatch",
        expectedMinimumResults: vectorWrites.length,
        execute: () => fixture.store.upsertChunkVectorsBatch(vectorWrites, "benchmark-model").length,
      },
      {
        id: "vector_batch_read",
        operation: "MemoryStore.getChunkVectors",
        expectedMinimumResults: vectorWrites.length,
        execute: () => [...fixture.store.getChunkVectors(
          vectorWrites.map((write) => write.chunkId),
        ).values()].filter((embedding) => embedding !== null).length,
        queryDiagnostics: () => collectVectorBatchReadDiagnostics(
          fixture.store,
          vectorWrites.map((write) => write.chunkId),
        ),
      },
      ...vectorReadCandidateCounts.map((candidateCount) => {
        const candidateIds = allVectorWrites.slice(0, candidateCount).map((write) => write.chunkId);
        return {
          id: `vector_batch_read_${candidateCount}`,
          operation: "MemoryStore.getChunkVectors",
          expectedMinimumResults: candidateCount,
          execute: () => [...fixture.store.getChunkVectors(candidateIds).values()]
            .filter((embedding) => embedding !== null).length,
          queryDiagnostics: () => collectVectorBatchReadDiagnostics(fixture.store, candidateIds),
        };
      }),
      {
        id: "embedding_cache_lookup",
        operation: "MemoryStore.getCachedEmbedding",
        expectedMinimumResults: 1,
        execute: () => fixture.store.getCachedEmbedding(vectorWrites[0].cacheHash) === null ? 0 : 1,
      },
    ];
    const scenarios = scenarioDefinitions.map((scenario) => (
      runScenario(scenario, args.warmupRuns, args.sampleRuns)
    ));
    const report = createMemorySqliteBenchmarkReport({
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
        `[benchmark:memory-sqlite] ${scenario.id}: median=${scenario.summary.median}ms p95=${scenario.summary.p95}ms samples=${scenario.summary.sampleCount}`,
      );
    }
    console.log(`[benchmark:memory-sqlite] report-only: ${outputPath}`);
  } finally {
    fixture?.store.close();
    if (fixture?.directory) {
      await fs.rm(fixture.directory, { recursive: true, force: true });
    }
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:memory-sqlite] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
