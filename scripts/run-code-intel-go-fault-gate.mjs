import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LspProcessHost,
  createGoplsProcessProfile,
  prepareGoplsStateRoot,
  probeGoplsToolchain,
} from "../packages/belldandy-skills/dist/code-intel/index.js";
import { validateGoTruthSetManifest } from "./run-code-intel-go-truth-set.mjs";
import { hashCanonicalText } from "./coding-agent-benchmark-contract.mjs";

export const CODE_INTEL_GO_FAULT_GATE_REPORT_VERSION = "code-intel-go-fault-gate-report/v1";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/go-truth-set.json");
const SOAK_CYCLES = 5;
const SOAK_QUERIES = ["TaggedFeature", "BuildMessage", "Speaker"];
const REQUEST_TIMEOUT_MS = 10_000;
const STATE_WAIT_TIMEOUT_MS = 3_000;
const runtimeContractPaths = [
  "packages/belldandy-skills/src/code-intel/lsp-process-host.ts",
  "packages/belldandy-skills/src/code-intel/gopls-profile.ts",
  "packages/belldandy-skills/dist/code-intel/lsp-process-host.js",
  "packages/belldandy-skills/dist/code-intel/gopls-profile.js",
  "scripts/run-code-intel-go-fault-gate.mjs",
];

export async function buildCodeIntelGoFaultGateReport(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const manifestPath = path.resolve(input?.manifestPath ?? defaultManifestPath);
  const goplsCommand = requireAbsolutePath(input?.goplsCommand, "goplsCommand");
  const goCommand = requireAbsolutePath(input?.goCommand, "goCommand");
  const manifestText = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestText);
  validateGoTruthSetManifest(manifest);
  const fixtureRoot = path.resolve(path.dirname(manifestPath), manifest.workspace.root);
  const sourceFiles = await verifySourceFiles(fixtureRoot, manifest.workspace.sourceFiles);
  const runtimeFiles = await Promise.all(runtimeContractPaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: await hashTextFile(path.join(workspaceRoot, relativePath)),
  })));
  const startedAt = Date.now();
  const runtimeFactory = input?.runtimeFactory ?? runRealFaultRuntime;
  const runtime = await runtimeFactory({
    fixtureRoot,
    manifest,
    goplsCommand,
    goCommand,
  });
  const sourceFilesAfter = await verifySourceFiles(fixtureRoot, manifest.workspace.sourceFiles);
  if (JSON.stringify(sourceFilesAfter) !== JSON.stringify(sourceFiles)) {
    throw new Error("Go CodeIntel fault Gate fixture changed during execution.");
  }

  const failures = [
    ...(runtime.scenarios.crashRestart.passed ? [] : ["crash_restart_gate_failed"]),
    ...(runtime.scenarios.cancellation.passed ? [] : ["cancellation_gate_failed"]),
    ...(runtime.scenarios.soak.passed ? [] : ["soak_gate_failed"]),
    ...(runtime.stateRootCleaned ? [] : ["state_cleanup_failed"]),
  ];
  return {
    schemaVersion: CODE_INTEL_GO_FAULT_GATE_REPORT_VERSION,
    generatedAt,
    platform,
    truthSet: {
      id: manifest.id,
      manifestPath: toReportPath(manifestPath),
      manifestSha256: hashCanonicalText(manifestText),
      workspaceRevision: manifest.workspace.revision,
    },
    sourceIdentity: {
      aggregateSha256: sha256(JSON.stringify(sourceFiles)),
      files: sourceFiles,
      runtimeFiles,
    },
    provider: { ...runtime.provider },
    resourceLimits: { ...runtime.resourceLimits },
    scenarios: structuredClone(runtime.scenarios),
    gate: {
      passed: failures.length === 0,
      failures,
    },
    execution: {
      durationMs: Date.now() - startedAt,
      probeCommands: input?.runtimeFactory ? 0 : 2,
      lspProcesses: runtime.lspProcesses,
      gatewayCalls: 0,
      modelCalls: 0,
      providerNetworkCalls: "not_observable",
      networkPolicy: "environment-deny",
      osNetworkIsolationVerified: false,
      processMemory: {
        hardLimitBytes: runtime.resourceLimits.processMemoryHardLimitBytes,
        peakBytes: "not_observable",
        status: runtime.resourceLimits.processMemoryStatus,
      },
      credentialsRead: false,
      workspaceMutations: 0,
      stateRootCleaned: runtime.stateRootCleaned,
    },
  };
}

export async function runCodeIntelGoFaultGate(input) {
  const outputPath = path.resolve(requireText(input?.outputPath, "outputPath"));
  if (await pathExists(outputPath)) {
    throw new Error(`Go CodeIntel fault Gate output already exists: ${outputPath}`);
  }
  const report = await buildCodeIntelGoFaultGateReport(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
  return report;
}

export function parseCodeIntelGoFaultGateCliArguments(argv) {
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

async function runRealFaultRuntime({ fixtureRoot, manifest, goplsCommand, goCommand }) {
  const platformEnvironment = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
  };
  const environment = Object.fromEntries(
    Object.entries(platformEnvironment).filter((entry) => entry[1] !== undefined),
  );
  const probe = await probeGoplsToolchain({ goplsCommand, goCommand, environment });
  if (probe.status !== "available"
    || probe.gopls.version !== manifest.provider.version
    || probe.go.version !== manifest.provider.goVersion
    || !probe.go.platform) {
    throw new Error("Pinned Go CodeIntel fault Gate toolchain is unavailable or incompatible.");
  }

  const stateParent = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-code-intel-fault-"));
  let resourceLimits;
  let stateRootCleaned = false;
  const createHost = async (id) => {
    const profile = createGoplsProcessProfile({
      probe,
      workspaceRoot: fixtureRoot,
      workspaceFolders: manifest.workspace.folders.map((folder) => path.resolve(fixtureRoot, folder)),
      stateRoot: path.join(stateParent, id),
      buildTags: manifest.provider.buildTags,
      platformEnvironment,
    });
    resourceLimits ??= profile.resourceLimits;
    await prepareGoplsStateRoot(profile);
    return new LspProcessHost({
      profile: profile.profile,
      workspaceRoot: fixtureRoot,
      responseMaxBytes: profile.resourceLimits.decodedResponseMaxBytes,
      shutdownTimeoutMs: 5_000,
    });
  };

  let scenarios;
  try {
    const crashRestart = await runCrashRestartScenario(createHost);
    const cancellation = await runCancellationScenario(createHost);
    const soak = await runSoakScenario(createHost);
    scenarios = { crashRestart, cancellation, soak };
  } finally {
    try {
      await fs.rm(stateParent, { recursive: true, force: true });
      stateRootCleaned = !(await pathExists(stateParent));
    } catch {
      stateRootCleaned = false;
    }
  }

  return {
    provider: {
      id: "gopls",
      version: probe.gopls.version,
      goVersion: probe.go.version,
      platform: probe.go.platform,
    },
    resourceLimits,
    scenarios,
    lspProcesses: scenarios.crashRestart.processStartCount
      + scenarios.cancellation.processStartCount
      + scenarios.soak.processStartCount,
    stateRootCleaned,
  };
}

async function runCrashRestartScenario(createHost) {
  const host = await createHost("crash-restart");
  const processIds = [];
  let recoveryQuerySucceeded = false;
  try {
    await queryWorkspaceSymbol(host, "BuildMessage");
    const firstProcessId = requireProcessId(host);
    processIds.push(firstProcessId);
    process.kill(firstProcessId, "SIGKILL");
    await waitFor(() => host.getDiagnostics().state === "failed");
    await queryWorkspaceSymbol(host, "BuildMessage");
    recoveryQuerySucceeded = true;
    processIds.push(requireProcessId(host));
  } catch {
    recoveryQuerySucceeded = false;
  } finally {
    await host.dispose().catch(() => undefined);
  }
  const diagnostics = host.getDiagnostics();
  const result = scenarioDiagnostics(diagnostics, processIds);
  return {
    passed: recoveryQuerySucceeded
      && result.processStartCount === 2
      && result.unexpectedExitCount === 1
      && result.forcedTerminationCount === 0
      && result.responseRejectedCount === 0
      && result.concurrencyRejectedCount === 0
      && result.residualProcessCount === 0
      && diagnostics.state === "stopped",
    recoveryQuerySucceeded,
    ...result,
  };
}

async function runCancellationScenario(createHost) {
  const host = await createHost("cancellation");
  const processIds = [];
  let cancellationCode = "not_cancelled";
  let recoveryQuerySucceeded = false;
  try {
    await queryWorkspaceSymbol(host, "TaggedFeature");
    processIds.push(requireProcessId(host));
    const controller = new AbortController();
    const pending = queryWorkspaceSymbol(host, "TaggedFeature", controller.signal);
    controller.abort();
    try {
      await pending;
    } catch (error) {
      cancellationCode = typeof error?.code === "string" ? error.code : "request_failed";
    }
    await queryWorkspaceSymbol(host, "TaggedFeature");
    recoveryQuerySucceeded = true;
    processIds.push(requireProcessId(host));
  } catch {
    recoveryQuerySucceeded = false;
  } finally {
    await host.dispose().catch(() => undefined);
  }
  const diagnostics = host.getDiagnostics();
  const result = scenarioDiagnostics(diagnostics, processIds);
  return {
    passed: cancellationCode === "cancelled"
      && recoveryQuerySucceeded
      && result.processStartCount === 2
      && result.unexpectedExitCount === 0
      && result.forcedTerminationCount === 1
      && result.responseRejectedCount === 0
      && result.concurrencyRejectedCount === 0
      && result.residualProcessCount === 0
      && diagnostics.state === "stopped",
    cancellationCode,
    recoveryQuerySucceeded,
    ...result,
  };
}

async function runSoakScenario(createHost) {
  const diagnostics = [];
  const processIds = [];
  let queryCount = 0;
  for (let cycle = 0; cycle < SOAK_CYCLES; cycle += 1) {
    const host = await createHost(`soak-${cycle}`);
    try {
      for (const query of SOAK_QUERIES) {
        await queryWorkspaceSymbol(host, query);
        queryCount += 1;
      }
      processIds.push(requireProcessId(host));
    } catch {
      // The final Gate uses the completed query count and Host diagnostics.
    } finally {
      await host.dispose().catch(() => undefined);
      diagnostics.push(host.getDiagnostics());
    }
  }
  const summary = {
    cycles: SOAK_CYCLES,
    queryCount,
    hostCount: diagnostics.length,
    stoppedHostCount: diagnostics.filter((item) => item.state === "stopped").length,
    processStartCount: diagnostics.reduce((sum, item) => sum + item.processStartCount, 0),
    unexpectedExitCount: diagnostics.reduce((sum, item) => sum + item.unexpectedExitCount, 0),
    forcedTerminationCount: diagnostics.reduce((sum, item) => sum + item.forcedTerminationCount, 0),
    failureCount: diagnostics.filter((item) => item.lastFailure !== undefined).length,
    responsePeakBytes: Math.max(0, ...diagnostics.map((item) => item.responses.peakBytes)),
    responseRejectedCount: diagnostics.reduce((sum, item) => sum + item.responses.rejectedCount, 0),
    concurrencyRejectedCount: diagnostics.reduce((sum, item) => sum + item.concurrency.rejectedCount, 0),
    residualProcessCount: processIds.filter(isProcessAlive).length,
  };
  return {
    passed: summary.queryCount === SOAK_CYCLES * SOAK_QUERIES.length
      && summary.hostCount === SOAK_CYCLES
      && summary.stoppedHostCount === SOAK_CYCLES
      && summary.processStartCount === SOAK_CYCLES
      && summary.unexpectedExitCount === 0
      && summary.forcedTerminationCount === 0
      && summary.failureCount === 0
      && summary.responseRejectedCount === 0
      && summary.concurrencyRejectedCount === 0
      && summary.residualProcessCount === 0,
    ...summary,
  };
}

function scenarioDiagnostics(diagnostics, processIds) {
  return {
    processStartCount: diagnostics.processStartCount,
    unexpectedExitCount: diagnostics.unexpectedExitCount,
    forcedTerminationCount: diagnostics.forcedTerminationCount,
    responseRejectedCount: diagnostics.responses.rejectedCount,
    concurrencyRejectedCount: diagnostics.concurrency.rejectedCount,
    residualProcessCount: processIds.filter(isProcessAlive).length,
  };
}

function queryWorkspaceSymbol(host, query, signal) {
  return host.request({
    method: "workspace/symbol",
    params: { query },
    deadlineAtMs: Date.now() + REQUEST_TIMEOUT_MS,
    signal,
  });
}

function requireProcessId(host) {
  const processId = host.getDiagnostics().processId;
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw new Error("gopls process ID is unavailable.");
  }
  return processId;
}

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate) {
  const deadlineAtMs = Date.now() + STATE_WAIT_TIMEOUT_MS;
  while (Date.now() < deadlineAtMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the gopls fault state.");
}

async function verifySourceFiles(root, expectedFiles) {
  const files = [];
  for (const expected of expectedFiles) {
    const filePath = path.resolve(root, expected.path);
    if (!isPathInside(root, filePath)) {
      throw new Error("Go CodeIntel fault Gate source escaped the fixture root.");
    }
    const actualSha256 = await hashTextFile(filePath);
    if (actualSha256 !== expected.sha256) {
      throw new Error(`Go CodeIntel fault Gate source hash mismatch: ${expected.path}`);
    }
    files.push({ path: expected.path, sha256: actualSha256 });
  }
  return files;
}

async function hashTextFile(filePath) {
  return hashCanonicalText(await fs.readFile(filePath, "utf-8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function toReportPath(filePath) {
  return isPathInside(workspaceRoot, filePath)
    ? path.relative(workspaceRoot, filePath).split(path.sep).join("/")
    : filePath;
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("Go CodeIntel fault Gate generatedAt must be an ISO timestamp.");
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
    throw new Error("Go CodeIntel fault Gate platform must be windows-native or wsl2-linux.");
  }
  const actual = process.platform === "win32" ? "windows-native" : "wsl2-linux";
  if (value !== actual) {
    throw new Error(`Go CodeIntel fault Gate platform mismatch: expected ${actual}, received ${value}.`);
  }
  return value;
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseCodeIntelGoFaultGateCliArguments(process.argv.slice(2));
    const report = await runCodeIntelGoFaultGate(args);
    process.stdout.write(`${JSON.stringify({
      outputPath: args.outputPath,
      scenarios: report.scenarios,
      gate: report.gate,
    })}\n`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
