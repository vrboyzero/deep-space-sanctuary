import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  CodeIntel,
  TypeScriptLanguageServiceProvider,
} from "../packages/belldandy-skills/dist/code-intel/index.js";

export const CODE_INTEL_RESOURCE_SOAK_REPORT_VERSION = "code-intel-resource-soak-report/v1";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/resource-soak.json");

export async function buildCodeIntelResourceSoakReport(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const configPath = path.resolve(input?.configPath ?? defaultConfigPath);
  const configText = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configText);
  validateConfig(config);
  const sourceFiles = await verifySourceIdentity(config.sourceIdentity.files);
  const forceGc = input?.forceGc ?? globalThis.gc;
  const memoryUsage = input?.memoryUsage ?? readMemoryUsage;
  if (typeof forceGc !== "function") {
    throw new Error("CodeIntel resource soak requires node --expose-gc.");
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-code-intel-soak-"));
  const lifecycleEvents = [];
  const queryMetrics = {
    attempts: 0,
    successful: 0,
    expectedRejected: 0,
    providerFailures: 0,
    maxDurationMs: 0,
  };
  let codeIntel;
  let disposed = false;
  let baselineMemory;
  let peakMemory;
  let rawPeakMemory;
  let afterDisposeMemory;
  let staleCursorRejected = false;
  let staleCursorErrorCode = null;
  let beforeDocumentRevision = null;
  let afterDocumentRevision = null;
  let workloadDurationMs = 0;
  let providerVersion = null;

  try {
    const fixtures = [];
    for (let index = 0; index < config.workload.workspaceCount; index += 1) {
      fixtures.push(await createWorkspaceFixture(temporaryRoot, index));
    }

    forceGc();
    baselineMemory = memoryUsage();
    peakMemory = { ...baselineMemory };
    rawPeakMemory = { ...baselineMemory };
    const provider = new TypeScriptLanguageServiceProvider({
      maxWorkspaceSessions: config.workload.maxWorkspaceSessions,
      onResourceEvent: (event) => lifecycleEvents.push({ ...event }),
    });
    providerVersion = provider.profile.version;
    codeIntel = new CodeIntel({ providers: [provider] });
    const workloadStartedAt = performance.now();

    const runQuery = async (request) => {
      queryMetrics.attempts += 1;
      const startedAt = performance.now();
      const outcome = await codeIntel.query(request);
      const durationMs = Math.ceil(performance.now() - startedAt);
      queryMetrics.maxDurationMs = Math.max(queryMetrics.maxDurationMs, durationMs);
      rawPeakMemory = maxMemoryUsage(rawPeakMemory, memoryUsage());
      forceGc();
      peakMemory = maxMemoryUsage(peakMemory, memoryUsage());
      if (outcome.ok) {
        queryMetrics.successful += 1;
      } else {
        queryMetrics.providerFailures += 1;
      }
      return outcome;
    };

    let staleCursor;
    const finalWorkspaceIndex = fixtures.length - 1;
    for (const [index, fixture] of fixtures.entries()) {
      const outcome = await runQuery(symbolRequest(
        fixture.root,
        revisionFor(index, 1),
        config.workload.queryLimit,
        config.limits.maxQueryDurationMs,
      ));
      const result = requireSuccessfulEvidence(outcome, `initial workspace ${index}`);
      if (index === finalWorkspaceIndex) {
        staleCursor = result.page.nextCursor;
        beforeDocumentRevision = result.items[0]?.documentRevision ?? null;
      }
    }
    if (!staleCursor || !beforeDocumentRevision) {
      throw new Error("CodeIntel resource soak fixture did not produce paginated revision evidence.");
    }

    requireSuccessfulEvidence(await runQuery(symbolRequest(
      fixtures[finalWorkspaceIndex].root,
      revisionFor(finalWorkspaceIndex, 1),
      config.workload.queryLimit,
      config.limits.maxQueryDurationMs,
      staleCursor,
    )), "session reuse");

    await fs.writeFile(
      fixtures[finalWorkspaceIndex].sourcePath,
      `// revision 2\n${fixtures[finalWorkspaceIndex].source}`,
      "utf-8",
    );
    queryMetrics.attempts += 1;
    const staleStartedAt = performance.now();
    const staleOutcome = await codeIntel.query(symbolRequest(
      fixtures[finalWorkspaceIndex].root,
      revisionFor(finalWorkspaceIndex, 2),
      config.workload.queryLimit,
      config.limits.maxQueryDurationMs,
      staleCursor,
    ));
    queryMetrics.maxDurationMs = Math.max(
      queryMetrics.maxDurationMs,
      Math.ceil(performance.now() - staleStartedAt),
    );
    rawPeakMemory = maxMemoryUsage(rawPeakMemory, memoryUsage());
    forceGc();
    peakMemory = maxMemoryUsage(peakMemory, memoryUsage());
    if (!staleOutcome.ok && staleOutcome.error.code === "invalid_request") {
      staleCursorRejected = true;
      staleCursorErrorCode = staleOutcome.error.code;
      queryMetrics.expectedRejected += 1;
    } else if (staleOutcome.ok) {
      queryMetrics.successful += 1;
    } else {
      queryMetrics.providerFailures += 1;
    }

    const reloaded = requireSuccessfulEvidence(await runQuery(symbolRequest(
      fixtures[finalWorkspaceIndex].root,
      revisionFor(finalWorkspaceIndex, 2),
      config.workload.queryLimit,
      config.limits.maxQueryDurationMs,
    )), "revision reload");
    afterDocumentRevision = reloaded.items[0]?.documentRevision ?? null;

    for (let round = 0; round < config.workload.rounds; round += 1) {
      for (const [index, fixture] of fixtures.entries()) {
        requireSuccessfulEvidence(await runQuery(symbolRequest(
          fixture.root,
          revisionFor(index, index === finalWorkspaceIndex ? 2 : 1),
          config.workload.queryLimit,
          config.limits.maxQueryDurationMs,
        )), `soak round ${round + 1}, workspace ${index}`);
      }
    }
    workloadDurationMs = Math.ceil(performance.now() - workloadStartedAt);
    codeIntel.dispose();
    disposed = true;
  } finally {
    if (codeIntel && !disposed) {
      codeIntel.dispose();
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  forceGc();
  afterDisposeMemory = memoryUsage();
  const temporaryRootRemoved = !(await pathExists(temporaryRoot));
  const lifecycle = summarizeLifecycle(lifecycleEvents);
  const expectedSuccessfulQueries = config.workload.workspaceCount
    + 2
    + (config.workload.workspaceCount * config.workload.rounds);
  const memory = {
    baselineHeapUsedBytes: baselineMemory.heapUsed,
    peakHeapUsedBytes: peakMemory.heapUsed,
    rawPeakHeapUsedBytes: rawPeakMemory.heapUsed,
    afterDisposeHeapUsedBytes: afterDisposeMemory.heapUsed,
    peakHeapIncreaseBytes: Math.max(0, peakMemory.heapUsed - baselineMemory.heapUsed),
    retainedHeapIncreaseBytes: Math.max(0, afterDisposeMemory.heapUsed - baselineMemory.heapUsed),
    baselineRssBytes: baselineMemory.rss,
    peakRssBytes: peakMemory.rss,
    rawPeakRssBytes: rawPeakMemory.rss,
    afterDisposeRssBytes: afterDisposeMemory.rss,
  };
  const revision = {
    staleCursorRejected,
    staleCursorErrorCode,
    beforeDocumentRevision,
    afterDocumentRevision,
    documentRevisionChanged: beforeDocumentRevision !== null
      && afterDocumentRevision !== null
      && beforeDocumentRevision !== afterDocumentRevision,
  };
  const cleanup = {
    temporaryRootRemoved,
    residualPaths: temporaryRootRemoved ? 0 : 1,
  };
  const failures = evaluateGates({
    config,
    lifecycle,
    queryMetrics,
    expectedSuccessfulQueries,
    workloadDurationMs,
    memory,
    revision,
    cleanup,
  });

  return {
    schemaVersion: CODE_INTEL_RESOURCE_SOAK_REPORT_VERSION,
    generatedAt,
    platform,
    contractVersion: config.contractVersion,
    soak: {
      id: config.id,
      configPath: toReportPath(configPath),
      configSha256: sha256(configText),
    },
    sourceIdentity: { files: sourceFiles },
    provider: {
      id: "typescript-language-service",
      version: providerVersion,
      capability: "semantic-live",
    },
    workload: { ...config.workload },
    limits: { ...config.limits },
    queries: {
      ...queryMetrics,
      expectedSuccessful: expectedSuccessfulQueries,
    },
    lifecycle,
    revision,
    timing: {
      durationMs: workloadDurationMs,
      maxQueryDurationMs: queryMetrics.maxDurationMs,
    },
    memory,
    cleanup,
    execution: {
      gatewayCalls: 0,
      modelCalls: 0,
      paidProviderCalls: 0,
      providerNetworkCalls: 0,
      hostCommands: 0,
      credentialsRead: false,
      productionWorkspaceMutations: 0,
      temporaryWorkspaceWrites: (config.workload.workspaceCount * 2) + 1,
    },
    gates: {
      passed: failures.length === 0,
      failures,
    },
  };
}

export async function writeCodeIntelResourceSoakReport(report, outputPathValue) {
  const outputPath = path.resolve(requireText(outputPathValue, "outputPath"));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(outputPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`CodeIntel resource soak artifact already exists: ${outputPath}`);
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
}

export async function runCodeIntelResourceSoak(input) {
  const report = await buildCodeIntelResourceSoakReport(input);
  await writeCodeIntelResourceSoakReport(report, input?.outputPath);
  return report;
}

export function compareCodeIntelResourceSoakReports(left, right) {
  const failures = [];
  const platforms = new Set([left?.platform, right?.platform]);
  if (platforms.size !== 2 || !platforms.has("windows-native") || !platforms.has("wsl2-linux")) {
    failures.push("platform_pair_mismatch");
  }
  const invariantFields = [
    "schemaVersion",
    "contractVersion",
    "soak",
    "sourceIdentity",
    "provider",
    "workload",
    "limits",
    "queries.attempts",
    "queries.successful",
    "queries.expectedRejected",
    "queries.providerFailures",
    "queries.expectedSuccessful",
    "lifecycle.createdSessions",
    "lifecycle.reusedSessions",
    "lifecycle.lruEvictions",
    "lifecycle.revisionReloads",
    "lifecycle.providerDisposeSessions",
    "lifecycle.maxActiveSessions",
    "lifecycle.activeSessionsAfterDispose",
    "lifecycle.eventCount",
    "lifecycle.eventSequenceSha256",
    "revision",
    "cleanup",
    "execution",
  ];
  for (const field of invariantFields) {
    if (JSON.stringify(readField(left, field)) !== JSON.stringify(readField(right, field))) {
      failures.push(`identity_mismatch:${field}`);
    }
  }
  if (left?.gates?.passed !== true || right?.gates?.passed !== true) {
    failures.push("platform_gate_failed");
  }
  return { passed: failures.length === 0, failures };
}

export function parseCodeIntelResourceSoakCliArguments(argv) {
  let platform;
  let configPath;
  let outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--platform" || argument === "--config" || argument === "--output") {
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === "--platform") platform = value;
      if (argument === "--config") configPath = path.resolve(value);
      if (argument === "--output") outputPath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    platform: requirePlatform(platform),
    configPath: configPath ?? defaultConfigPath,
    outputPath: path.resolve(requireText(outputPath, "outputPath")),
  };
}

async function createWorkspaceFixture(temporaryRoot, index) {
  const root = path.join(temporaryRoot, `workspace-${index}`);
  const sourceDirectory = path.join(root, "src");
  const sourcePath = path.join(sourceDirectory, "index.ts");
  const source = [
    `export interface SoakContract${index} { value(): number; }`,
    `export class SoakImplementation${index} implements SoakContract${index} {`,
    `  value(): number { return ${index}; }`,
    "}",
    `export function createSoak${index}(): SoakContract${index} {`,
    `  return new SoakImplementation${index}();`,
    "}",
    `export const soakValue${index} = createSoak${index}().value();`,
    "",
  ].join("\n");
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      target: "ES2022",
    },
    include: ["src/**/*.ts"],
  }), "utf-8");
  await fs.writeFile(sourcePath, source, "utf-8");
  return { root, sourcePath, source };
}

function symbolRequest(rootPath, revision, limit, timeoutMs, cursor) {
  return {
    workspace: { rootPath, revision },
    operation: "symbols",
    query: "Soak",
    requiredCapability: "semantic-live",
    deadlineAtMs: Date.now() + timeoutMs,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function revisionFor(index, revision) {
  return `soak-workspace-${index}-revision-${revision}`;
}

function requireSuccessfulEvidence(outcome, label) {
  if (!outcome.ok) {
    throw new Error(`CodeIntel resource soak ${label} failed: ${outcome.error.code}`);
  }
  if (outcome.result.provenance.capability !== "semantic-live" || outcome.result.items.length === 0) {
    throw new Error(`CodeIntel resource soak ${label} returned no live semantic evidence.`);
  }
  return outcome.result;
}

function summarizeLifecycle(events) {
  const disposed = events.filter((event) => event.type === "session-disposed");
  return {
    createdSessions: events.filter((event) => event.type === "session-created").length,
    reusedSessions: events.filter((event) => event.type === "session-reused").length,
    lruEvictions: disposed.filter((event) => event.reason === "lru-eviction").length,
    revisionReloads: disposed.filter((event) => event.reason === "revision-reload").length,
    providerDisposeSessions: disposed.filter((event) => event.reason === "provider-dispose").length,
    maxActiveSessions: events.reduce((maximum, event) => Math.max(maximum, event.activeSessions), 0),
    activeSessionsAfterDispose: events.at(-1)?.activeSessions ?? 0,
    eventCount: events.length,
    eventSequenceSha256: sha256(JSON.stringify(events)),
  };
}

function evaluateGates(input) {
  const failures = [];
  const check = (condition, code) => {
    if (!condition) failures.push(code);
  };
  check(input.lifecycle.maxActiveSessions === input.config.workload.maxWorkspaceSessions, "session_limit_not_exercised");
  check(input.lifecycle.lruEvictions >= input.config.expectations.minimumLruEvictions, "insufficient_lru_evictions");
  check(input.lifecycle.reusedSessions >= input.config.expectations.minimumSessionReuses, "insufficient_session_reuse");
  check(input.lifecycle.revisionReloads === input.config.expectations.revisionReloads, "revision_reload_mismatch");
  check(input.lifecycle.activeSessionsAfterDispose === 0, "sessions_remain_after_dispose");
  check(input.queryMetrics.successful === input.expectedSuccessfulQueries, "successful_query_count_mismatch");
  check(input.queryMetrics.expectedRejected === 1, "stale_cursor_was_not_rejected");
  check(input.queryMetrics.providerFailures === 0, "provider_failure_observed");
  check(input.revision.staleCursorRejected, "stale_cursor_not_fail_closed");
  check(input.revision.documentRevisionChanged, "document_revision_did_not_change");
  check(input.workloadDurationMs <= input.config.limits.maxDurationMs, "duration_limit_exceeded");
  check(input.queryMetrics.maxDurationMs <= input.config.limits.maxQueryDurationMs, "query_duration_limit_exceeded");
  check(input.memory.peakHeapIncreaseBytes <= input.config.limits.maxPeakHeapIncreaseBytes, "peak_heap_limit_exceeded");
  check(input.memory.retainedHeapIncreaseBytes <= input.config.limits.maxRetainedHeapIncreaseBytes, "retained_heap_limit_exceeded");
  check(input.cleanup.temporaryRootRemoved && input.cleanup.residualPaths === 0, "temporary_workspace_residue");
  return failures;
}

async function verifySourceIdentity(entries) {
  const files = [];
  for (const entry of entries) {
    const sourcePath = resolveWorkspacePath(entry.path);
    const runtimePath = resolveWorkspacePath(entry.runtimePath);
    const [sourceSha256, runtimeSha256] = await Promise.all([
      hashFile(sourcePath),
      hashFile(runtimePath),
    ]);
    if (sourceSha256 !== entry.sha256) {
      throw new Error(`CodeIntel resource soak source hash mismatch: ${entry.path}`);
    }
    files.push({
      path: entry.path,
      sha256: sourceSha256,
      runtimePath: entry.runtimePath,
      runtimeSha256,
    });
  }
  return files;
}

function validateConfig(config) {
  if (config?.schemaVersion !== "code-intel-resource-soak/v1"
    || config.contractVersion !== "code-intel/v1"
    || typeof config.id !== "string"
    || !Number.isInteger(config.workload?.workspaceCount)
    || !Number.isInteger(config.workload?.maxWorkspaceSessions)
    || config.workload.workspaceCount <= config.workload.maxWorkspaceSessions
    || !Number.isInteger(config.workload?.rounds)
    || !Number.isInteger(config.workload?.queryLimit)
    || !Number.isInteger(config.limits?.maxDurationMs)
    || !Number.isInteger(config.limits?.maxQueryDurationMs)
    || !Number.isInteger(config.limits?.maxPeakHeapIncreaseBytes)
    || !Number.isInteger(config.limits?.maxRetainedHeapIncreaseBytes)
    || !Number.isInteger(config.expectations?.minimumLruEvictions)
    || !Number.isInteger(config.expectations?.minimumSessionReuses)
    || config.expectations?.revisionReloads !== 1
    || !Array.isArray(config.sourceIdentity?.files)
    || config.sourceIdentity.files.length === 0) {
    throw new Error("Invalid CodeIntel resource soak config.");
  }
  for (const entry of config.sourceIdentity.files) {
    if (typeof entry?.path !== "string"
      || typeof entry?.runtimePath !== "string"
      || !/^[a-f0-9]{64}$/u.test(entry?.sha256 ?? "")) {
      throw new Error("Invalid CodeIntel resource soak source identity.");
    }
    resolveWorkspacePath(entry.path);
    resolveWorkspacePath(entry.runtimePath);
  }
}

function resolveWorkspacePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error("CodeIntel resource soak identity paths must be workspace-relative.");
  }
  const resolved = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("CodeIntel resource soak identity path escapes the workspace.");
  }
  return resolved;
}

function readMemoryUsage() {
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, rss: usage.rss };
}

function maxMemoryUsage(left, right) {
  return {
    heapUsed: Math.max(left.heapUsed, right.heapUsed),
    rss: Math.max(left.rss, right.rss),
  };
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toReportPath(filePath) {
  const relative = path.relative(workspaceRoot, filePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    ? relative.split(path.sep).join("/")
    : path.resolve(filePath);
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("CodeIntel resource soak generatedAt must be an ISO timestamp.");
  }
  return value;
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requirePlatform(value) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("CodeIntel resource soak platform must be windows-native or wsl2-linux.");
  }
  const actual = process.platform === "win32" ? "windows-native" : "wsl2-linux";
  if (value !== actual) {
    throw new Error(`CodeIntel resource soak platform mismatch: expected ${actual}, received ${value}.`);
  }
  return value;
}

function readField(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseCodeIntelResourceSoakCliArguments(process.argv.slice(2));
    const report = await runCodeIntelResourceSoak(args);
    process.stdout.write(`${JSON.stringify({ outputPath: args.outputPath, gates: report.gates })}\n`);
    if (!report.gates.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
