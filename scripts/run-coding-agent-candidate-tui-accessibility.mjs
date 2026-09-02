import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { resolveBenchmarkRepositoryIdentity } from "./coding-agent-benchmark-preflight.mjs";
import { loadCodingAgentCandidateCliTuiAggregateBinding } from "./coding-agent-candidate-cli-tui-receipt.mjs";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");
const SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/cli-tui-accessibility.schema.json",
);
const SOURCE_PATHS = Object.freeze([
  "packages/belldandy-core/src/tui/app.tsx",
  "packages/belldandy-core/src/tui/input.ts",
  "scripts/run-tui-performance-benchmark.mjs",
  "scripts/run-tui-performance-pty.py",
  "scripts/run-tui-accessibility-native-worker.mjs",
  "scripts/run-coding-agent-candidate-tui-accessibility.mjs",
]);

export const CODING_AGENT_CANDIDATE_TUI_ACCESSIBILITY_VERSION =
  "tui-accessibility-cross-platform/v1";

export function parseCodingAgentCandidateTuiAccessibilityArguments(argv) {
  const options = { startupTimeoutSeconds: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--aggregate-root", "--platform", "--generated-at", "--startup-timeout-seconds"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--aggregate-root") {
      if (options.aggregateRoot !== undefined) throw new Error("--aggregate-root may only be provided once");
      options.aggregateRoot = path.resolve(value);
    } else if (flag === "--platform") {
      if (options.platform !== undefined) throw new Error("--platform may only be provided once");
      if (!["windows-native", "wsl2-linux"].includes(value)) {
        throw new Error("--platform must be windows-native or wsl2-linux");
      }
      options.platform = value;
    } else if (flag === "--generated-at") {
      if (options.generatedAt !== undefined) throw new Error("--generated-at may only be provided once");
      if (!Number.isFinite(Date.parse(value))) throw new Error("--generated-at must be an ISO-8601 timestamp");
      options.generatedAt = value;
    } else {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 5 || parsed > 120) {
        throw new Error("--startup-timeout-seconds must be an integer between 5 and 120");
      }
      options.startupTimeoutSeconds = parsed;
    }
    index += 1;
  }
  if (!options.aggregateRoot) throw new Error("--aggregate-root is required");
  if (!options.platform) throw new Error("--platform is required");
  return options;
}

export async function runCodingAgentCandidateTuiAccessibility(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const platform = requirePlatform(input?.platform);
  const generatedAt = input?.generatedAt ?? new Date().toISOString();
  const outputPath = resolveOutputPath(aggregateRoot, platform);
  if (await exists(outputPath)) {
    throw new Error(`Candidate TUI accessibility artifact already exists for ${platform}.`);
  }
  const aggregate = await loadCodingAgentCandidateCliTuiAggregateBinding(aggregateRoot);
  const resolveIdentity = dependencies.resolveRepositoryIdentity ?? resolveBenchmarkRepositoryIdentity;
  const repositoryIdentity = await resolveIdentity(WORKSPACE_ROOT);
  if (!jsonEqual(repositoryIdentity, aggregate.harness)) {
    throw new Error("Candidate TUI accessibility current repository identity drifted from aggregate harness.");
  }
  const collect = dependencies.collectObservation ?? collectIsolatedTuiAccessibilityObservation;
  const observed = await collect(platform, {
    startupTimeoutSeconds: input?.startupTimeoutSeconds ?? 30,
  });
  const sourceIdentity = await createSourceIdentity(aggregate.harness);
  const accessibility = normalizeAccessibility(observed.sample?.accessibility);
  const lifecycle = normalizeLifecycle(observed.sample?.lifecycle);
  const failures = collectFailures({ accessibility, lifecycle });
  const artifact = {
    schemaVersion: CODING_AGENT_CANDIDATE_TUI_ACCESSIBILITY_VERSION,
    generatedAt,
    platform,
    environment: normalizeEnvironment(platform, observed.environment),
    sourceIdentity,
    status: failures.length === 0 ? "complete" : "failed",
    observation: {
      schemaVersion: "tui-native-accessibility-observation/v1",
      sequence: 1,
      capturedBytes: requireNonNegativeInteger(observed.sample?.capturedBytes, "capturedBytes"),
    },
    accessibility,
    lifecycle,
    gate: { passed: failures.length === 0, failures },
  };
  await validateArtifact(artifact);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { artifact, outputPath };
}

export async function collectIsolatedTuiAccessibilityObservation(platform, input = {}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-accessibility-"));
  const timeoutMs = (input.startupTimeoutSeconds ?? 30) * 1000 + 15_000;
  const workerPath = path.join(WORKSPACE_ROOT, "scripts/run-tui-accessibility-native-worker.mjs");
  const args = [
    "--import", "tsx",
    workerPath,
    "--platform", platform,
    "--startup-timeout-seconds", String(input.startupTimeoutSeconds ?? 30),
    "--state-dir", stateDir,
  ];
  let child;
  let timeout;
  try {
    const result = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, args, {
        cwd: WORKSPACE_ROOT,
        env: createSafeChildEnvironment(),
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const append = (current, chunk, label) => {
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") > 2 * 1024 * 1024) {
          reject(new Error(`Candidate TUI accessibility ${label} exceeded 2 MiB.`));
          terminateWorkerProcessTree(child);
        }
        return next;
      };
      child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk, "stdout"); });
      child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk, "stderr"); });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
      timeout = setTimeout(() => {
        terminateWorkerProcessTree(child);
        reject(new Error(
          `Candidate TUI accessibility ${platform} worker timed out after ${timeoutMs}ms.`,
        ));
      }, timeoutMs);
    });
    if (result.code !== 0) {
      throw new Error(
        `Candidate TUI accessibility ${platform} worker failed (${result.code ?? result.signal}): ${safeMessage(result.stderr)}`,
      );
    }
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`Candidate TUI accessibility ${platform} worker returned invalid JSON: ${error.message}`);
    }
  } finally {
    clearTimeout(timeout);
    if (child && child.exitCode === null && child.signalCode === null) {
      terminateWorkerProcessTree(child);
    }
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

function terminateWorkerProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && Number.isSafeInteger(child.pid) && child.pid > 0) {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
      shell: false,
    });
  }
  try {
    child.kill("SIGKILL");
  } catch {}
}

function createSafeChildEnvironment() {
  const blocked = /(?:^BELLDANDY_|TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;
  return Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) => typeof value === "string" && !blocked.test(key)));
}

function safeMessage(value) {
  const normalized = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return normalized.slice(0, 500) || "no diagnostic output";
}

async function createSourceIdentity(harness) {
  const files = [];
  for (const relativePath of SOURCE_PATHS) {
    const bytes = await fs.readFile(path.join(WORKSPACE_ROOT, ...relativePath.split("/")));
    files.push({ path: relativePath, sha256: sha256(bytes) });
  }
  return { harness, files, aggregateSha256: sha256(JSON.stringify(files)) };
}

function normalizeAccessibility(value) {
  return {
    keyboardNavigation: value?.keyboardNavigation === true,
    focusVisible: value?.focusVisible === true,
    labelsPresent: value?.labelsPresent === true,
  };
}

function normalizeLifecycle(value) {
  return {
    firstFrame: value?.firstFrame === true,
    narrowFallback: value?.narrowFallback === true,
    wideLayoutRestored: value?.wideLayoutRestored === true,
    mouseTabNavigation: value?.mouseTabNavigation === true,
    inputReplayRendered: value?.inputReplayRendered === true,
    ctrlCSent: value?.ctrlCSent === true,
    inputModesRestoredBeforeScreen: value?.inputModesRestoredBeforeScreen === true,
    stateDirRemoved: value?.stateDirRemoved === true,
    exitCode: Number.isSafeInteger(value?.exitCode) ? value.exitCode : -1,
    timedOut: value?.timedOut === true,
    residualProcessCount: Number.isSafeInteger(value?.residualProcessCount)
      && value.residualProcessCount >= 0 ? value.residualProcessCount : 1,
  };
}

function collectFailures({ accessibility, lifecycle }) {
  const failures = [];
  for (const [name, passed] of Object.entries(accessibility)) {
    if (!passed) failures.push(`accessibility.${name} did not pass`);
  }
  for (const name of [
    "firstFrame",
    "narrowFallback",
    "wideLayoutRestored",
    "mouseTabNavigation",
    "inputReplayRendered",
    "ctrlCSent",
    "inputModesRestoredBeforeScreen",
    "stateDirRemoved",
  ]) {
    if (!lifecycle[name]) failures.push(`lifecycle.${name} did not pass`);
  }
  if (lifecycle.exitCode !== 0) failures.push("lifecycle.exitCode was non-zero");
  if (lifecycle.timedOut) failures.push("lifecycle.timedOut was true");
  if (lifecycle.residualProcessCount !== 0) failures.push("lifecycle.residualProcessCount was non-zero");
  return failures;
}

function normalizeEnvironment(platform, value) {
  if (!value || typeof value !== "object") throw new Error("TUI accessibility environment is invalid.");
  const expected = platform === "windows-native"
    ? { runtimePlatform: "win32", terminalBackend: "conpty", wsl: false }
    : { runtimePlatform: "linux", terminalBackend: "unix-pty", wsl: true };
  const normalized = {
    runtimePlatform: value.platform,
    arch: requireString(value.arch, "environment.arch"),
    release: requireString(value.release, "environment.release"),
    nodeVersion: requireString(value.nodeVersion, "environment.nodeVersion"),
    terminalBackend: value.terminalBackend,
    wsl: value.wsl === true,
    ...(typeof value.distribution === "string" && value.distribution.trim()
      ? { distribution: value.distribution.trim() }
      : {}),
  };
  if (normalized.runtimePlatform !== expected.runtimePlatform
    || normalized.terminalBackend !== expected.terminalBackend
    || normalized.wsl !== expected.wsl) {
    throw new Error(`TUI accessibility environment drifted for ${platform}.`);
  }
  return normalized;
}

async function validateArtifact(value) {
  const compiled = compileOutputSchema(JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8")));
  if (!compiled.ok || !compiled.validator.validateOutput(JSON.stringify(value)).ok) {
    throw new Error("Candidate TUI accessibility artifact failed Schema validation.");
  }
}

function resolveOutputPath(aggregateRoot, platform) {
  const target = path.resolve(
    aggregateRoot,
    "candidate-evidence",
    "cli-tui",
    "accessibility",
    `${platform}.json`,
  );
  const relative = path.relative(aggregateRoot, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Candidate TUI accessibility output escapes aggregate root.");
  }
  return target;
}

function requirePlatform(value) {
  if (!["windows-native", "wsl2-linux"].includes(value)) {
    throw new Error("platform must be windows-native or wsl2-linux");
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function exists(target) {
  return fs.lstat(target).then(() => true, () => false);
}

async function main() {
  const options = parseCodingAgentCandidateTuiAccessibilityArguments(process.argv.slice(2));
  const result = await runCodingAgentCandidateTuiAccessibility(options);
  process.stdout.write(`${JSON.stringify({
    status: result.artifact.status,
    platform: result.artifact.platform,
    outputPath: result.outputPath,
  })}\n`);
  if (result.artifact.status !== "complete") process.exitCode = 2;
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`[candidate:tui-accessibility] failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
