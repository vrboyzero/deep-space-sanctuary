import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CodeIntel,
  GoplsCodeIntelProvider,
  LspProcessHost,
  createGoplsProcessProfile,
  probeGoplsToolchain,
} from "../packages/belldandy-skills/dist/code-intel/index.js";

export const CODE_INTEL_GO_TRUTH_SET_REPORT_VERSION = "code-intel-go-truth-set-report/v1";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/go-truth-set.json");
const runtimeContractPaths = [
  "packages/belldandy-skills/src/code-intel/types.ts",
  "packages/belldandy-skills/src/code-intel/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/lsp-process-host.ts",
  "packages/belldandy-skills/src/code-intel/gopls-profile.ts",
  "packages/belldandy-skills/src/code-intel/gopls-provider.ts",
  "packages/belldandy-skills/dist/code-intel/code-intel.js",
  "packages/belldandy-skills/dist/code-intel/lsp-process-host.js",
  "packages/belldandy-skills/dist/code-intel/gopls-profile.js",
  "packages/belldandy-skills/dist/code-intel/gopls-provider.js",
];

export async function buildCodeIntelGoTruthSetReport(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const manifestPath = path.resolve(input?.manifestPath ?? defaultManifestPath);
  const goplsCommand = requireAbsolutePath(input?.goplsCommand, "goplsCommand");
  const goCommand = requireAbsolutePath(input?.goCommand, "goCommand");
  const manifestText = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestText);
  validateGoTruthSetManifest(manifest);
  const manifestDirectory = path.dirname(manifestPath);
  const fixtureRoot = path.resolve(manifestDirectory, manifest.workspace.root);
  const sourceFiles = await verifySourceFiles(fixtureRoot, manifest.workspace.sourceFiles);
  const manifestSha256 = sha256(manifestText);
  const runtimeFiles = await Promise.all(runtimeContractPaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: await hashFile(path.join(workspaceRoot, relativePath)),
  })));
  const startedAt = Date.now();
  const runtimeFactory = input?.runtimeFactory ?? createGoplsRuntime;
  const runtime = await runtimeFactory({
    platform,
    fixtureRoot,
    manifest,
    goplsCommand,
    goCommand,
  });
  const caseResults = [];
  let lifecycleDiagnostics = [];
  let stateRootCleaned = false;

  try {
    for (const testCase of manifest.cases) {
      caseResults.push(await runCase({
        codeIntel: runtime.codeIntel,
        fixtureRoot,
        revision: manifest.workspace.revision,
        testCase,
      }));
    }
  } finally {
    await runtime.codeIntel.disposeAsync();
    lifecycleDiagnostics = runtime.getLifecycleDiagnostics();
    await runtime.cleanup();
    stateRootCleaned = true;
  }

  const sourceFilesAfter = await verifySourceFiles(fixtureRoot, manifest.workspace.sourceFiles);
  if (JSON.stringify(sourceFilesAfter) !== JSON.stringify(sourceFiles)) {
    throw new Error("Go CodeIntel truth set fixture changed during execution.");
  }
  const metrics = summarizeCaseMetrics(caseResults, manifest.thresholds);
  const lifecycle = summarizeLifecycle(lifecycleDiagnostics);
  const gatePassed = metrics.passed && lifecycle.passed && stateRootCleaned;
  return {
    schemaVersion: CODE_INTEL_GO_TRUTH_SET_REPORT_VERSION,
    generatedAt,
    platform,
    truthSet: {
      id: manifest.id,
      manifestPath: toReportPath(manifestPath),
      manifestSha256,
      contractVersion: manifest.contractVersion,
      workspaceRevision: manifest.workspace.revision,
    },
    sourceIdentity: {
      aggregateSha256: sha256(JSON.stringify(sourceFiles)),
      files: sourceFiles,
      runtimeFiles,
    },
    provider: {
      id: runtime.provider.id,
      version: runtime.provider.version,
      capability: "semantic-live",
      buildTags: [...manifest.provider.buildTags],
      toolchain: { ...runtime.toolchain },
    },
    governance: { ...runtime.governance },
    metrics,
    cases: caseResults,
    lifecycle,
    gate: {
      passed: gatePassed,
      failures: [
        ...(metrics.passed ? [] : ["accuracy_gate_failed"]),
        ...(lifecycle.passed ? [] : ["lifecycle_gate_failed"]),
        ...(stateRootCleaned ? [] : ["state_cleanup_failed"]),
      ],
    },
    execution: {
      durationMs: Date.now() - startedAt,
      probeCommands: runtime.execution.probeCommands,
      lspProcesses: lifecycle.hostCount,
      gatewayCalls: 0,
      modelCalls: 0,
      providerNetworkCalls: "not_observable",
      networkPolicy: runtime.governance.networkPolicy,
      osNetworkIsolationVerified: false,
      processMemory: {
        hardLimitBytes: runtime.resourceLimits.processMemoryHardLimitBytes,
        peakBytes: "not_observable",
        status: runtime.resourceLimits.processMemoryStatus,
      },
      credentialsRead: false,
      workspaceMutations: 0,
      stateRootCleaned,
    },
  };
}

export async function runCodeIntelGoTruthSet(input) {
  const outputPath = path.resolve(requireText(input?.outputPath, "outputPath"));
  if (await pathExists(outputPath)) {
    throw new Error(`Go CodeIntel truth set output already exists: ${outputPath}`);
  }
  const report = await buildCodeIntelGoTruthSetReport(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
  return report;
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function parseCodeIntelGoTruthSetCliArguments(argv) {
  let platform;
  let manifestPath;
  let outputPath;
  let goplsCommand;
  let goCommand;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (["--platform", "--manifest", "--output", "--gopls-command", "--go-command"].includes(argument)) {
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === "--platform") platform = value;
      if (argument === "--manifest") manifestPath = path.resolve(value);
      if (argument === "--output") outputPath = path.resolve(value);
      if (argument === "--gopls-command") goplsCommand = path.resolve(value);
      if (argument === "--go-command") goCommand = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    platform: requirePlatform(platform),
    manifestPath: manifestPath ?? defaultManifestPath,
    outputPath: path.resolve(requireText(outputPath, "outputPath")),
    goplsCommand: requireAbsolutePath(goplsCommand, "goplsCommand"),
    goCommand: requireAbsolutePath(goCommand, "goCommand"),
  };
}

export function validateGoTruthSetManifest(manifest) {
  if (manifest?.schemaVersion !== "code-intel-go-truth-set/v1"
    || manifest.contractVersion !== "code-intel/v1"
    || typeof manifest.id !== "string"
    || manifest.provider?.id !== "gopls"
    || typeof manifest.provider.version !== "string"
    || typeof manifest.provider.goVersion !== "string"
    || !Array.isArray(manifest.provider.buildTags)
    || manifest.provider.buildTags.length === 0
    || !manifest.workspace
    || !Array.isArray(manifest.workspace.folders)
    || manifest.workspace.folders.length === 0
    || !Array.isArray(manifest.workspace.sourceFiles)
    || !Array.isArray(manifest.cases)
    || typeof manifest.thresholds?.precision !== "number"
    || typeof manifest.thresholds?.recall !== "number"
    || manifest.thresholds.precision < 0.95
    || manifest.thresholds.recall < 0.95) {
    throw new Error("Invalid Go CodeIntel truth set manifest.");
  }
  if (manifest.provider.buildTags.some((tag) => typeof tag !== "string" || !/^[A-Za-z0-9_.]+$/u.test(tag))) {
    throw new Error("Invalid Go CodeIntel truth set build tag.");
  }
  const caseIds = new Set();
  for (const testCase of manifest.cases) {
    if (!testCase?.id
      || caseIds.has(testCase.id)
      || !["symbols", "definition", "references", "implementation"].includes(testCase.operation)) {
      throw new Error("Invalid or duplicate Go CodeIntel truth set case.");
    }
    caseIds.add(testCase.id);
    if ((testCase.query === undefined) === (testCase.location === undefined)) {
      throw new Error(`Go truth set case must have exactly one query/location: ${testCase.id}`);
    }
  }
}

async function createGoplsRuntime({ fixtureRoot, manifest, goplsCommand, goCommand }) {
  const platformEnvironment = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
  };
  const probe = await probeGoplsToolchain({
    goplsCommand,
    goCommand,
    environment: Object.fromEntries(
      Object.entries(platformEnvironment).filter((entry) => entry[1] !== undefined),
    ),
  });
  if (probe.status !== "available"
    || probe.gopls.version !== manifest.provider.version
    || probe.go.version !== manifest.provider.goVersion
    || !probe.go.platform) {
    throw new Error("Pinned Go CodeIntel truth set toolchain is unavailable or incompatible.");
  }

  const stateParent = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-code-intel-truth-"));
  try {
    const profile = createGoplsProcessProfile({
      probe,
      workspaceRoot: fixtureRoot,
      workspaceFolders: manifest.workspace.folders.map((folder) => path.resolve(fixtureRoot, folder)),
      stateRoot: path.join(stateParent, "state"),
      buildTags: manifest.provider.buildTags,
      platformEnvironment,
    });
    const hosts = [];
    const provider = new GoplsCodeIntelProvider({
      profile,
      hostFactory(options) {
        const host = new LspProcessHost(options);
        hosts.push(host);
        return host;
      },
    });
    return {
      codeIntel: new CodeIntel({ providers: [provider] }),
      provider: provider.profile,
      toolchain: {
        goVersion: profile.toolchain.goVersion,
        platform: profile.toolchain.platform,
      },
      governance: profile.governance,
      resourceLimits: profile.resourceLimits,
      execution: { probeCommands: 2 },
      getLifecycleDiagnostics: () => hosts.map((host) => host.getDiagnostics()),
      cleanup: async () => fs.rm(stateParent, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(stateParent, { recursive: true, force: true });
    throw error;
  }
}

async function runCase({ codeIntel, fixtureRoot, revision, testCase }) {
  const expectedLocations = new Set(testCase.expected.map((item) => expectedLocationKey(fixtureRoot, item)));
  const requestAnchor = testCase.location === undefined
    ? undefined
    : resolveAnchor(await readFixtureFile(fixtureRoot, testCase.location.path), testCase.location.anchor);
  const outcome = await codeIntel.query({
    workspace: { rootPath: fixtureRoot, revision },
    operation: testCase.operation,
    requiredCapability: "semantic-live",
    deadlineAtMs: Date.now() + 30_000,
    ...(testCase.query === undefined ? {} : { query: testCase.query }),
    ...(testCase.location === undefined ? {} : {
      location: {
        path: testCase.location.path,
        line: requestAnchor.line,
        column: requestAnchor.column,
      },
    }),
  });
  if (!outcome.ok) {
    return {
      id: testCase.id,
      operation: testCase.operation,
      status: "query_error",
      expected: expectedLocations.size,
      returned: 0,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: expectedLocations.size,
      precision: 0,
      recall: 0,
      errorCode: outcome.error.code,
      items: [],
    };
  }
  const actualLocations = new Set(outcome.result.items.map((item) => actualLocationKey(item)));
  const metrics = calculateLocationMetrics(expectedLocations, actualLocations);
  return {
    id: testCase.id,
    operation: testCase.operation,
    status: metrics.falsePositive === 0 && metrics.falseNegative === 0 ? "passed" : "failed",
    ...metrics,
    errorCode: null,
    items: outcome.result.items.map((item) => ({
      location: item.location,
      symbolKind: item.symbolKind,
      documentRevision: item.documentRevision,
      matched: expectedLocations.has(actualLocationKey(item)),
    })),
  };
}

function calculateLocationMetrics(expected, returned) {
  const truePositive = [...returned].filter((key) => expected.has(key)).length;
  const falsePositive = returned.size - truePositive;
  const falseNegative = expected.size - truePositive;
  return {
    expected: expected.size,
    returned: returned.size,
    truePositive,
    falsePositive,
    falseNegative,
    precision: returned.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositive / returned.size,
    recall: expected.size === 0 ? 1 : truePositive / expected.size,
  };
}

async function verifySourceFiles(fixtureRoot, sourceFiles) {
  const entries = [];
  for (const sourceFile of sourceFiles) {
    const filePath = path.resolve(fixtureRoot, sourceFile.path);
    if (!isPathInside(fixtureRoot, filePath)) {
      throw new Error(`Go truth set source path escapes fixture root: ${sourceFile.path}`);
    }
    const actual = await hashFile(filePath);
    if (actual !== sourceFile.sha256) {
      throw new Error(`Go truth set source hash mismatch: ${sourceFile.path}`);
    }
    entries.push({ path: sourceFile.path.replaceAll("\\", "/"), sha256: actual });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function expectedLocationKey(fixtureRoot, expected) {
  const filePath = path.resolve(fixtureRoot, expected.path);
  return locationKey(
    expected.scope,
    toPortableRelativePath(fixtureRoot, filePath),
    resolveAnchor(readFileSync(filePath, "utf-8"), expected.anchor),
  );
}

function actualLocationKey(item) {
  const range = item.location.range;
  return locationKey(item.location.scope, item.location.path, {
    line: range.start.line,
    column: range.start.column,
    endLine: range.end.line,
    endColumn: range.end.column,
  });
}

function locationKey(scope, filePath, position) {
  return JSON.stringify([scope, filePath.replaceAll("\\", "/"), position]);
}

function resolveAnchor(source, anchor) {
  const offsets = [];
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(anchor.text)}(?![A-Za-z0-9_$])`, "gu");
  for (const match of source.matchAll(pattern)) offsets.push(match.index);
  const offset = offsets[anchor.occurrence - 1];
  if (offset === undefined) {
    throw new Error(`Go truth set anchor not found: ${anchor.text} #${anchor.occurrence}`);
  }
  const start = offsetToPosition(source, offset);
  const end = offsetToPosition(source, offset + anchor.text.length);
  return { ...start, endLine: end.line, endColumn: end.column };
}

function summarizeCaseMetrics(caseResults, thresholds) {
  const totals = caseResults.reduce((sum, entry) => ({
    expected: sum.expected + entry.expected,
    returned: sum.returned + entry.returned,
    truePositive: sum.truePositive + entry.truePositive,
    falsePositive: sum.falsePositive + entry.falsePositive,
    falseNegative: sum.falseNegative + entry.falseNegative,
  }), { expected: 0, returned: 0, truePositive: 0, falsePositive: 0, falseNegative: 0 });
  const precision = totals.returned === 0 ? 0 : totals.truePositive / totals.returned;
  const recall = totals.expected === 0 ? 1 : totals.truePositive / totals.expected;
  return {
    ...totals,
    precision,
    recall,
    precisionThreshold: thresholds.precision,
    recallThreshold: thresholds.recall,
    passed: precision >= thresholds.precision
      && recall >= thresholds.recall
      && caseResults.every((entry) => entry.status === "passed"),
  };
}

function summarizeLifecycle(diagnostics) {
  const forcedTerminationCount = diagnostics.reduce(
    (sum, item) => sum + item.forcedTerminationCount,
    0,
  );
  const failureCount = diagnostics.filter((item) => item.lastFailure !== undefined).length;
  const responseGate = {
    maxBytes: diagnostics.length === 0
      ? 0
      : Math.max(...diagnostics.map((item) => item.responses.maxBytes)),
    peakBytes: diagnostics.length === 0
      ? 0
      : Math.max(...diagnostics.map((item) => item.responses.peakBytes)),
    rejectedCount: diagnostics.reduce((sum, item) => sum + item.responses.rejectedCount, 0),
    passed: diagnostics.length > 0 && diagnostics.every((item) => (
      item.responses.peakBytes <= item.responses.maxBytes
      && item.responses.rejectedCount === 0
    )),
  };
  const concurrencyGate = {
    maxRequestsPerHost: diagnostics.length === 0
      ? 0
      : Math.max(...diagnostics.map((item) => item.concurrency.maxRequests)),
    peakActiveRequests: diagnostics.length === 0
      ? 0
      : Math.max(...diagnostics.map((item) => item.concurrency.peakActiveRequests)),
    rejectedCount: diagnostics.reduce((sum, item) => sum + item.concurrency.rejectedCount, 0),
    passed: diagnostics.length > 0 && diagnostics.every((item) => (
      item.concurrency.peakActiveRequests <= item.concurrency.maxRequests
      && item.concurrency.rejectedCount === 0
    )),
  };
  return {
    hostCount: diagnostics.length,
    stoppedHostCount: diagnostics.filter((item) => item.state === "stopped").length,
    processStartCount: diagnostics.reduce((sum, item) => sum + item.processStartCount, 0),
    unexpectedExitCount: diagnostics.reduce((sum, item) => sum + item.unexpectedExitCount, 0),
    requestCount: diagnostics.reduce((sum, item) => sum + item.requestCount, 0),
    forcedTerminationCount,
    failureCount,
    responses: responseGate,
    concurrency: concurrencyGate,
    serverRequests: {
      handledCount: diagnostics.reduce((sum, item) => sum + item.serverRequests.handledCount, 0),
      rejectedCount: diagnostics.reduce((sum, item) => sum + item.serverRequests.rejectedCount, 0),
      registeredCapabilityMethods: [...new Set(diagnostics.flatMap(
        (item) => item.serverRequests.registeredCapabilityMethods,
      ))].sort(),
    },
    passed: diagnostics.length > 0
      && diagnostics.every((item) => item.state === "stopped")
      && diagnostics.every((item) => item.processStartCount === 1)
      && diagnostics.every((item) => item.unexpectedExitCount === 0)
      && forcedTerminationCount === 0
      && failureCount === 0
      && responseGate.passed
      && concurrencyGate.passed,
  };
}

function toReportPath(filePath) {
  return isPathInside(workspaceRoot, filePath)
    ? path.relative(workspaceRoot, filePath).split(path.sep).join("/")
    : filePath;
}

async function readFixtureFile(root, relativePath) {
  return fs.readFile(path.resolve(root, relativePath), "utf-8");
}

function offsetToPosition(source, offset) {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, column: lines.at(-1)?.length ?? 0 };
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toPortableRelativePath(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("Go CodeIntel truth set generatedAt must be an ISO timestamp.");
  }
  return value;
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireAbsolutePath(value, name) {
  const required = requireText(value, name);
  if (!path.isAbsolute(required)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return path.resolve(required);
}

function requirePlatform(value) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("Go CodeIntel truth set platform must be windows-native or wsl2-linux.");
  }
  const actual = process.platform === "win32" ? "windows-native" : "wsl2-linux";
  if (value !== actual) {
    throw new Error(`Go CodeIntel truth set platform mismatch: expected ${actual}, received ${value}.`);
  }
  return value;
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseCodeIntelGoTruthSetCliArguments(process.argv.slice(2));
    const report = await runCodeIntelGoTruthSet(args);
    process.stdout.write(`${JSON.stringify({
      outputPath: args.outputPath,
      metrics: report.metrics,
      lifecycle: report.lifecycle,
      gate: report.gate,
    })}\n`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
