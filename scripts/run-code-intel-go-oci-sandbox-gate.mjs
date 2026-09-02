import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOciSandboxInvocation,
  buildSandboxRuntimeEnvironment,
  probeOciCommandSandboxRuntime,
  resolveOciCommandSandboxConfig,
} from "../packages/belldandy-skills/src/command-sandbox.ts";
import { createOciSandboxLease } from "../packages/belldandy-skills/src/command-sandbox-lease.ts";
import { hashCanonicalText } from "./coding-agent-benchmark-contract.mjs";

export const CODE_INTEL_GO_OCI_SANDBOX_GATE_REPORT_VERSION =
  "code-intel-go-oci-sandbox-gate-report/v1";
export const GO_OCI_SANDBOX_RESOURCE_LIMITS = Object.freeze({
  memoryBytes: 128 * 1024 * 1024,
  cpus: 1,
  pidsLimit: 64,
  tmpfsBytes: 16 * 1024 * 1024,
});

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const EXECUTION_TIMEOUT_MS = 15_000;
const NETWORK_TIMEOUT_MS = 1_500;
const MAX_OUTPUT_CHARS = 64 * 1024;
const BLOCKED_NETWORK_CODES = new Set(["ENETDOWN", "ENETUNREACH", "EHOSTUNREACH"]);
const READ_ONLY_CODES = new Set(["EACCES", "EROFS"]);
const runtimeContractPaths = [
  "packages/belldandy-skills/src/command-sandbox.ts",
  "packages/belldandy-skills/src/command-sandbox-lease.ts",
  "scripts/run-code-intel-go-oci-sandbox-gate.mjs",
];

export async function buildCodeIntelGoOciSandboxGateReport(input = {}) {
  const platform = requirePlatform(input.platform);
  const generatedAt = requireIsoTimestamp(input.generatedAt ?? new Date().toISOString());
  const startedAt = Date.now();
  const runtimeFiles = await Promise.all(runtimeContractPaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: await hashTextFile(path.join(workspaceRoot, relativePath)),
  })));
  const runtime = input.runtimeFactory
    ? await input.runtimeFactory()
    : await runRealOciSandboxRuntime({
      config: requireOciConfig(input),
      probeOciRuntime: input.probeOciRuntime,
    });
  const failures = collectGateFailures(runtime);

  return {
    schemaVersion: CODE_INTEL_GO_OCI_SANDBOX_GATE_REPORT_VERSION,
    generatedAt,
    platform,
    sourceIdentity: {
      aggregateSha256: sha256(JSON.stringify(runtimeFiles)),
      files: runtimeFiles,
    },
    sandbox: structuredClone(runtime.sandbox),
    resourceLimits: { ...runtime.resourceLimits },
    probes: structuredClone(runtime.probes),
    gate: {
      passed: failures.length === 0,
      failures,
    },
    promotion: {
      goToolchainArtifactStatus: "unavailable",
      goCanaryEligible: false,
      productionEligible: false,
    },
    execution: {
      durationMs: Date.now() - startedAt,
      containerStarts: 2,
      networkProbeAttempts: 1,
      gatewayCalls: 0,
      modelCalls: 0,
      providerCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
      osNetworkIsolationVerified: runtime.probes.outboundNetwork.blocked,
      processMemory: {
        hardLimitBytes: runtime.resourceLimits.memoryBytes,
        status: runtime.probes.memoryCgroup.matchesConfiguredLimit
          ? "cgroup_limit_observed"
          : "unverified",
        goplsRssPeakBytes: "not_observable",
      },
      temporaryRootCleaned: runtime.temporaryRootCleaned,
    },
  };
}

export async function runCodeIntelGoOciSandboxGate(input) {
  const outputPath = path.resolve(requireText(input?.outputPath, "outputPath"));
  if (await pathExists(outputPath)) {
    throw new Error(`Go CodeIntel OCI sandbox Gate output already exists: ${outputPath}`);
  }
  const report = await buildCodeIntelGoOciSandboxGateReport(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
  return report;
}

export function parseCodeIntelGoOciSandboxGateCliArguments(argv) {
  let platform;
  let outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--platform" || argument === "--output") {
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === "--platform") platform = value;
      if (argument === "--output") outputPath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    platform: requirePlatform(platform),
    outputPath: path.resolve(requireText(outputPath, "outputPath")),
  };
}

async function runRealOciSandboxRuntime({ config, probeOciRuntime }) {
  const runtimeProbe = probeOciRuntime ?? probeOciCommandSandboxRuntime;
  const availability = await runtimeProbe(config);
  if (!availability.available) {
    throw new Error("Go CodeIntel OCI sandbox Gate requires a reachable local OCI runtime.");
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-oci-sandbox-gate-"));
  const workspace = path.join(temporaryRoot, "workspace");
  await fs.mkdir(workspace);
  let temporaryRootCleaned = false;
  try {
    const isolation = await runIsolationProbe({ config, workspace });
    const processTree = await runProcessTreeProbe({ config, workspace });
    const result = {
      sandbox: {
        backend: "oci",
        runtime: config.runtime,
        imageDigest: requireImageDigest(config.image),
        pullPolicy: "never",
      },
      resourceLimits: { ...GO_OCI_SANDBOX_RESOURCE_LIMITS },
      probes: {
        rootFilesystem: {
          readOnly: READ_ONLY_CODES.has(isolation.rootWriteCode),
          writeErrorCode: isolation.rootWriteCode,
        },
        workspace: {
          readOnly: READ_ONLY_CODES.has(isolation.workspaceWriteCode),
          writeErrorCode: isolation.workspaceWriteCode,
        },
        temporaryFilesystem: {
          writable: isolation.tmpWriteCode === "success",
        },
        outboundNetwork: {
          blocked: isolation.loopbackOnly
            && BLOCKED_NETWORK_CODES.has(isolation.outboundErrorCode),
          loopbackOnly: isolation.loopbackOnly,
          errorCode: isolation.outboundErrorCode,
        },
        memoryCgroup: {
          configuredBytes: GO_OCI_SANDBOX_RESOURCE_LIMITS.memoryBytes,
          observedBytes: isolation.memoryMaxBytes,
          matchesConfiguredLimit:
            isolation.memoryMaxBytes === GO_OCI_SANDBOX_RESOURCE_LIMITS.memoryBytes,
        },
        processTree,
      },
      temporaryRootCleaned: false,
    };
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    temporaryRootCleaned = !(await pathExists(temporaryRoot));
    if (!temporaryRootCleaned) {
      throw new Error("Go CodeIntel OCI sandbox Gate temporary root cleanup failed.");
    }
    result.temporaryRootCleaned = true;
    return result;
  } finally {
    if (!temporaryRootCleaned) {
      await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function runIsolationProbe({ config, workspace }) {
  const lease = await createOciSandboxLease({ config });
  let release;
  try {
    const invocation = buildOciSandboxInvocation({
      config,
      workspaceRoot: workspace,
      cwd: workspace,
      lease: lease.binding,
      resourceLimits: GO_OCI_SANDBOX_RESOURCE_LIMITS,
      plan: {
        executable: "node",
        argv: ["-e", buildIsolationProbeScript()],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    });
    const result = await runOciInvocation(invocation, () => lease.markRuntimeStarted());
    if (result.exitCode !== 0) {
      throw new Error(`OCI isolation probe exited with ${String(result.exitCode)}.`);
    }
    return parseIsolationProbeOutput(result.stdout);
  } finally {
    release = await lease.release();
    await lease.cleanupArtifacts();
    if (release.status !== "removed") {
      throw new Error("OCI isolation probe container cleanup failed.");
    }
  }
}

async function runProcessTreeProbe({ config, workspace }) {
  const lease = await createOciSandboxLease({ config });
  let child;
  let closeObserved = false;
  let release;
  try {
    const invocation = buildOciSandboxInvocation({
      config,
      workspaceRoot: workspace,
      cwd: workspace,
      lease: lease.binding,
      resourceLimits: GO_OCI_SANDBOX_RESOURCE_LIMITS,
      plan: {
        executable: "node",
        argv: ["-e", "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    });
    const started = startOciInvocation(invocation, () => lease.markRuntimeStarted());
    child = started.child;
    await waitForOutput(started, "ready");
    release = await lease.release();
    closeObserved = await observeClose(started.close);
    const residualContainerCount = await countLeaseContainers(config, lease.binding.leaseId);
    return {
      containerStarted: true,
      closeObserved,
      leaseCleanupStatus: release.status,
      residualContainerCount,
    };
  } finally {
    if (!release) release = await lease.release();
    if (child && !closeObserved) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The OCI CLI may already have closed after container cleanup.
      }
    }
    await lease.cleanupArtifacts();
  }
}

function startOciInvocation(invocation, onStarted) {
  const child = spawn(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: buildSandboxRuntimeEnvironment(),
  });
  onStarted();
  let stdout = "";
  let stderr = "";
  const append = (value, chunk) => (value + chunk.toString("utf8")).slice(0, MAX_OUTPUT_CHARS);
  child.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
  });
  const close = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
  return {
    child,
    close,
    stdout: () => stdout,
  };
}

async function runOciInvocation(invocation, onStarted) {
  const started = startOciInvocation(invocation, onStarted);
  return await withTimeout(started.close, EXECUTION_TIMEOUT_MS, "OCI sandbox probe timed out.");
}

async function waitForOutput(started, expected) {
  const deadlineAtMs = Date.now() + EXECUTION_TIMEOUT_MS;
  while (Date.now() < deadlineAtMs) {
    if (started.stdout().includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("OCI process-tree probe did not become ready.");
}

async function observeClose(close) {
  try {
    await withTimeout(close, EXECUTION_TIMEOUT_MS, "OCI process-tree probe did not close.");
    return true;
  } catch {
    return false;
  }
}

async function countLeaseContainers(config, leaseId) {
  const result = await runRuntimeCommand(config.runtime, [
    "ps",
    "--all",
    "--filter",
    `label=com.star-sanctuary.command-sandbox.lease=${leaseId}`,
    "--format",
    "{{.ID}}",
  ]);
  if (result.exitCode !== 0) {
    throw new Error("OCI residual container probe failed.");
  }
  return result.stdout.split(/\r?\n/u).filter((value) => value.trim()).length;
}

function runRuntimeCommand(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: buildSandboxRuntimeEnvironment(),
    });
    let stdout = "";
    let stderr = "";
    const append = (value, chunk) => (value + chunk.toString("utf8")).slice(0, MAX_OUTPUT_CHARS);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function buildIsolationProbeScript() {
  return [
    "const fs = require('node:fs');",
    "const net = require('node:net');",
    "const tryWrite = (filePath) => { try { fs.writeFileSync(filePath, 'probe'); return 'unexpected_success'; } catch (error) { return error && error.code || 'error'; } };",
    "const interfaces = fs.readdirSync('/sys/class/net').sort();",
    "const result = {",
    "  rootWriteCode: tryWrite('/belldandy-root-write-probe'),",
    "  workspaceWriteCode: tryWrite('/workspace/belldandy-workspace-write-probe'),",
    "  tmpWriteCode: tryWrite('/tmp/belldandy-tmp-write-probe') === 'unexpected_success' ? 'success' : 'error',",
    "  loopbackOnly: interfaces.length === 1 && interfaces[0] === 'lo',",
    "  memoryMax: fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(),",
    "};",
    "const socket = net.createConnection({ host: '1.1.1.1', port: 80 });",
    `socket.setTimeout(${NETWORK_TIMEOUT_MS});`,
    "const finish = (code) => { result.outboundErrorCode = code; process.stdout.write(JSON.stringify(result) + '\\n'); socket.destroy(); };",
    "socket.once('connect', () => finish('unexpected_success'));",
    "socket.once('timeout', () => finish('timeout'));",
    "socket.once('error', (error) => finish(error && error.code || 'error'));",
  ].join(" ");
}

function parseIsolationProbeOutput(stdout) {
  const lines = stdout.split(/\r?\n/u).filter((value) => value.trim());
  const value = JSON.parse(lines.at(-1) ?? "null");
  if (!value || typeof value !== "object"
    || typeof value.rootWriteCode !== "string"
    || typeof value.workspaceWriteCode !== "string"
    || typeof value.tmpWriteCode !== "string"
    || typeof value.loopbackOnly !== "boolean"
    || typeof value.outboundErrorCode !== "string"
    || !/^\d+$/u.test(value.memoryMax)) {
    throw new Error("OCI isolation probe returned an invalid result.");
  }
  return {
    rootWriteCode: value.rootWriteCode,
    workspaceWriteCode: value.workspaceWriteCode,
    tmpWriteCode: value.tmpWriteCode,
    loopbackOnly: value.loopbackOnly,
    outboundErrorCode: value.outboundErrorCode,
    memoryMaxBytes: Number(value.memoryMax),
  };
}

function collectGateFailures(runtime) {
  return [
    ...(runtime.probes.rootFilesystem.readOnly ? [] : ["root_filesystem_not_readonly"]),
    ...(runtime.probes.workspace.readOnly ? [] : ["workspace_not_readonly"]),
    ...(runtime.probes.temporaryFilesystem.writable ? [] : ["temporary_filesystem_not_writable"]),
    ...(runtime.probes.outboundNetwork.blocked ? [] : ["network_isolation_failed"]),
    ...(runtime.probes.memoryCgroup.matchesConfiguredLimit ? [] : ["memory_limit_unverified"]),
    ...(runtime.probes.processTree.containerStarted ? [] : ["process_tree_not_started"]),
    ...(runtime.probes.processTree.closeObserved ? [] : ["process_tree_close_not_observed"]),
    ...(runtime.probes.processTree.leaseCleanupStatus === "removed" ? [] : ["container_cleanup_failed"]),
    ...(runtime.probes.processTree.residualContainerCount === 0 ? [] : ["residual_container_detected"]),
    ...(runtime.temporaryRootCleaned ? [] : ["temporary_root_cleanup_failed"]),
  ];
}

function requireOciConfig(input) {
  const config = input.config ?? resolveOciCommandSandboxConfig({ readEnv: input.readEnv });
  if (!config) {
    throw new Error(
      "Go CodeIntel OCI sandbox Gate requires an OCI backend, runtime, and digest-pinned local image.",
    );
  }
  return config;
}

function requireImageDigest(image) {
  const match = /@(sha256:[a-f0-9]{64})$/u.exec(image);
  if (!match) throw new Error("OCI sandbox image must be digest-pinned.");
  return match[1];
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
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

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("Go CodeIntel OCI sandbox Gate generatedAt must be an ISO timestamp.");
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
    throw new Error("Go CodeIntel OCI sandbox Gate platform must be windows-native or wsl2-linux.");
  }
  const actual = process.platform === "win32" ? "windows-native" : "wsl2-linux";
  if (value !== actual) {
    throw new Error(`Go CodeIntel OCI sandbox Gate platform mismatch: expected ${actual}, received ${value}.`);
  }
  return value;
}

function withTimeout(operation, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptPath)) {
  try {
    const args = parseCodeIntelGoOciSandboxGateCliArguments(process.argv.slice(2));
    const report = await runCodeIntelGoOciSandboxGate(args);
    process.stdout.write(`${JSON.stringify({
      outputPath: args.outputPath,
      probes: report.probes,
      gate: report.gate,
      promotion: report.promotion,
    })}\n`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
