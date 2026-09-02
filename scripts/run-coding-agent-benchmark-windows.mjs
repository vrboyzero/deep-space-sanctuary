import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import WebSocket from "ws";

import {
  resolveBenchmarkInfrastructureRetries,
  resolveBenchmarkMaximumCostUsd,
  resolvePriorObservedCostUsd,
} from "./run-coding-agent-benchmark.mjs";
import {
  GatewayReadinessDiagnostic,
  writeGatewayReadinessDiagnostic,
} from "./gateway-readiness-diagnostic.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 28889;
const DEFAULT_GATEWAY_READY_TIMEOUT_MS = 60_000;
const DEFAULT_GATEWAY_STOP_GRACE_MS = 3_000;
const REQUIRED_MODEL_PRICING_ENV_KEYS = [
  "BELLDANDY_MODEL_INPUT_USD_PER_1M",
  "BELLDANDY_MODEL_OUTPUT_USD_PER_1M",
];
const FORWARDED_MODEL_PRICING_ENV_KEYS = [
  ...REQUIRED_MODEL_PRICING_ENV_KEYS,
  "BELLDANDY_MODEL_CACHE_READ_USD_PER_1M",
];
const FORWARDED_COMMAND_SANDBOX_ENV_KEYS = [
  "BELLDANDY_COMMAND_SANDBOX_BACKEND",
  "BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME",
  "BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE",
];
const OPENAI_ROUTING_ENV_KEYS = [
  "BELLDANDY_OPENAI_BASE_URL",
  "BELLDANDY_OPENAI_WIRE_API",
];
const OPENAI_PROVIDER_ENV_KEYS = [
  "BELLDANDY_OPENAI_API_KEY",
  ...OPENAI_ROUTING_ENV_KEYS,
];
const WINDOWS_HOST_ENV_KEYS = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "PUBLIC",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERDOMAIN_ROAMINGPROFILE",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);
const ZERO_CREDENTIAL_PROVIDER_ENV_KEYS = [
  "BELLDANDY_OPENAI_API_KEY",
  "BELLDANDY_MODEL_CONFIG_FILE",
  "BELLDANDY_MODEL_PREFERRED_PROVIDERS",
  "BELLDANDY_COMPACTION_API_KEY",
  "BELLDANDY_EMBEDDING_OPENAI_API_KEY",
  "BELLDANDY_MEMORY_SUMMARY_API_KEY",
  "BELLDANDY_MEMORY_EVOLUTION_API_KEY",
  "BELLDANDY_TASK_SUMMARY_API_KEY",
  "BELLDANDY_IMAGE_OPENAI_API_KEY",
  "BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY",
  "BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY",
  "BELLDANDY_VIDEO_FILE_API_KEY",
  "BELLDANDY_TTS_OPENAI_API_KEY",
  "BELLDANDY_STT_OPENAI_API_KEY",
  "BELLDANDY_STT_GROQ_API_KEY",
  "DASHSCOPE_API_KEY",
];
const CONTROLLED_GATEWAY_RUNTIME_ENV = Object.freeze({
  AUTO_OPEN_BROWSER: "false",
  BELLDANDY_OPENAI_MAX_RETRIES: "0",
  BELLDANDY_DANGEROUS_TOOLS_ENABLED: "true",
  BELLDANDY_PRIMARY_WARMUP_ENABLED: "false",
  BELLDANDY_MEMORY_ENABLED: "false",
  BELLDANDY_EMBEDDING_ENABLED: "false",
  BELLDANDY_MEMORY_SUMMARY_ENABLED: "false",
  BELLDANDY_MEMORY_EVOLUTION_ENABLED: "false",
  BELLDANDY_TASK_MEMORY_ENABLED: "false",
  BELLDANDY_TASK_SUMMARY_ENABLED: "false",
  BELLDANDY_COMPACTION_ENABLED: "false",
  BELLDANDY_UPDATE_CHECK: "false",
  BELLDANDY_HEARTBEAT_ENABLED: "false",
  BELLDANDY_CRON_ENABLED: "false",
  BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED: "false",
  BELLDANDY_DREAM_AUTO_CRON_ENABLED: "false",
  BELLDANDY_BROWSER_RELAY_ENABLED: "false",
  BELLDANDY_MCP_ENABLED: "false",
  BELLDANDY_CHANNEL_ROUTER_ENABLED: "false",
  BELLDANDY_EMAIL_SMTP_ENABLED: "false",
  BELLDANDY_EMAIL_IMAP_ENABLED: "false",
  BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED: "false",
  BELLDANDY_DISCORD_ENABLED: "false",
  BELLDANDY_COMMUNITY_API_ENABLED: "false",
  BELLDANDY_AGENT_BRIDGE_ENABLED: "false",
  BELLDANDY_INJECT_MEMORY: "false",
  BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED: "false",
  BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED: "false",
  BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED: "false",
  BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED: "false",
  BELLDANDY_FEISHU_APP_ID: "",
  BELLDANDY_FEISHU_APP_SECRET: "",
  BELLDANDY_FEISHU_AGENT_ID: "",
  BELLDANDY_QQ_APP_ID: "",
  BELLDANDY_QQ_APP_SECRET: "",
  BELLDANDY_QQ_AGENT_ID: "",
});

export function buildWindowsChildEnvironment(baseEnv, options) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (WINDOWS_HOST_ENV_KEYS.has(key.toUpperCase()) && isNonEmptyEnvValue(value)) {
      env[key] = value;
    }
  }

  for (const key of FORWARDED_MODEL_PRICING_ENV_KEYS) {
    copyNonEmptyEnvValue(env, baseEnv, key);
  }
  for (const key of FORWARDED_COMMAND_SANDBOX_ENV_KEYS) {
    copyNonEmptyEnvValue(env, baseEnv, key);
  }
  if (options?.provider === "openai") {
    for (const key of OPENAI_ROUTING_ENV_KEYS) {
      copyNonEmptyEnvValue(env, baseEnv, key);
    }
    if (options.credentialsConfigured === true) {
      copyNonEmptyEnvValue(env, baseEnv, "BELLDANDY_OPENAI_API_KEY");
    }
  }
  return env;
}

export async function loadWindowsProviderEnvironment(filePath, dependencies = {}) {
  const readFile = dependencies.readFile ?? fs.readFile;
  const parse = dependencies.parseEnv ?? parseEnv;
  const parsed = parse(await readFile(filePath, "utf-8"));
  const env = {};
  for (const key of OPENAI_PROVIDER_ENV_KEYS) {
    copyNonEmptyEnvValue(env, parsed, key);
  }
  return env;
}

export async function resolveWindowsBenchmarkSourceEnvironment(input, dependencies = {}) {
  const baseEnv = dependencies.baseEnv ?? process.env;
  if (input.providerEnvFile === undefined) return baseEnv;

  const providerEnvFile = (dependencies.resolvePath ?? path.resolve)(
    requireInput(input, "providerEnvFile"),
  );
  const providerFileEnv = await (
    dependencies.loadProviderEnvironment ?? loadWindowsProviderEnvironment
  )(providerEnvFile);
  return { ...baseEnv, ...providerFileEnv };
}

export function buildWindowsBenchmarkInvocation(input, dependencies = {}) {
  const resolvePath = dependencies.resolvePath ?? path.resolve;
  const workspaceRoot = resolvePath(requireInput(input, "workspaceRoot"));
  const fixtureRoot = resolvePath(requireInput(input, "fixtureRoot"));
  const artifactRoot = resolvePath(requireInput(input, "artifactRoot"));
  const stateRoot = resolvePath(requireInput(input, "stateRoot"));
  const gatewayStateRoot = input.gatewayStateRoot === undefined
    ? stateRoot
    : resolvePath(requireInput(input, "gatewayStateRoot"));
  if (!isSameWindowsPath(gatewayStateRoot, stateRoot)) {
    throw new Error("Windows benchmark Gateway and Coding CI must share the same state root for pairing.");
  }
  const provider = requireInput(input, "provider");
  const modelId = requireInput(input, "modelId");
  const credentialsConfigured = input.credentialsConfigured;
  if (typeof credentialsConfigured !== "boolean") {
    throw new Error("credentialsConfigured must be a boolean.");
  }
  const baseEnv = dependencies.baseEnv ?? process.env;

  const host = input.host ?? DEFAULT_HOST;
  const gatewayAccess = input.gatewayAccess ?? "loopback";
  if (gatewayAccess !== "loopback" && gatewayAccess !== "wsl2") {
    throw new Error("Windows benchmark Gateway access must be loopback or wsl2.");
  }
  const isLoopbackHost = host === "127.0.0.1" || host === "localhost";
  const networkInterfaces = dependencies.networkInterfaces ?? os.networkInterfaces;
  const isWslAdapterHost = gatewayAccess === "wsl2"
    && Object.entries(networkInterfaces()).some(([name, addresses]) => (
      /(?:^|\W)wsl(?:\W|$)/i.test(name)
      && addresses?.some((address) => address.family === "IPv4" && address.address === host)
    ));
  if (gatewayAccess === "loopback" && !isLoopbackHost) {
    throw new Error("Windows benchmark Gateway host must use loopback.");
  }
  if (gatewayAccess === "wsl2" && !isWslAdapterHost) {
    throw new Error("Windows benchmark Gateway host must match a local WSL virtual adapter.");
  }
  const port = normalizePort(input.port ?? DEFAULT_PORT);
  const authMode = input.authMode ?? "token";
  if (authMode !== "none" && authMode !== "token") {
    throw new Error("authMode must be none or token.");
  }
  if (credentialsConfigured) {
    for (const key of REQUIRED_MODEL_PRICING_ENV_KEYS) {
      const rawValue = baseEnv[key];
      const value = typeof rawValue === "string" && rawValue.trim()
        ? Number(rawValue.trim())
        : Number.NaN;
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${key} must provide finite non-negative model pricing for a Windows benchmark formal run.`);
      }
    }
  }

  const manifestRevision = input.manifestRevision ?? "v1";
  if (manifestRevision !== "v1" && manifestRevision !== "v2" && manifestRevision !== "v3") {
    throw new Error("manifestRevision must be v1, v2, or v3.");
  }
  const v3RepositoryConfig = input.v3RepositoryConfig === undefined
    ? undefined
    : resolvePath(requireInput(input, "v3RepositoryConfig"));
  if (v3RepositoryConfig && manifestRevision !== "v3") {
    throw new Error("v3RepositoryConfig requires manifestRevision v3.");
  }
  const sourceRoot = input.sourceRoot === undefined
    ? undefined
    : resolvePath(requireInput(input, "sourceRoot"));
  if (manifestRevision === "v2" && !sourceRoot) {
    throw new Error("sourceRoot is required for manifestRevision v2.");
  }

  const attempt = input.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer.");
  }
  const infrastructureRetries = input.infrastructureRetries === undefined
    ? undefined
    : resolveBenchmarkInfrastructureRetries(input.infrastructureRetries);
  const priorObservedCostUsd = input.priorObservedCostUsd === undefined
    ? undefined
    : resolvePriorObservedCostUsd(input.priorObservedCostUsd);
  const maxTotalCostUsd = input.maxTotalCostUsd === undefined
    ? undefined
    : resolveBenchmarkMaximumCostUsd(input.maxTotalCostUsd);
  const shadowCandidateId = input.shadowCandidateId === undefined
    ? undefined
    : requireInput(input, "shadowCandidateId");

  const env = {
    ...buildWindowsChildEnvironment(baseEnv, { credentialsConfigured, provider }),
    BELLDANDY_STATE_DIR: gatewayStateRoot,
    BELLDANDY_STATE_DIR_WINDOWS: gatewayStateRoot,
    BELLDANDY_ENV_DIR: gatewayStateRoot,
    BELLDANDY_HOST: host,
    BELLDANDY_PORT: String(port),
    BELLDANDY_AUTH_MODE: authMode,
    BELLDANDY_ALLOWED_ORIGINS: `http://${host}:${port}`,
    BELLDANDY_AGENT_PROVIDER: provider,
    ...CONTROLLED_GATEWAY_RUNTIME_ENV,
    ...(provider === "openai" ? { BELLDANDY_OPENAI_MODEL: modelId } : {}),
    ...(manifestRevision === "v1" ? {} : {
      BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT: "2048",
    }),
  };
  if (!credentialsConfigured) {
    for (const key of ZERO_CREDENTIAL_PROVIDER_ENV_KEYS) delete env[key];
  }
  if (authMode === "token") {
    env.BELLDANDY_AUTH_TOKEN = (dependencies.randomToken ?? createEphemeralToken)();
    if (!env.BELLDANDY_AUTH_TOKEN) {
      throw new Error("Windows benchmark Gateway token generation failed.");
    }
  } else {
    delete env.BELLDANDY_AUTH_TOKEN;
  }

  const nodePath = dependencies.nodePath ?? process.execPath;
  return {
    endpoint: {
      host,
      port,
      origin: `http://${host}:${port}`,
      wsUrl: `ws://${host}:${port}`,
      authMode,
      authToken: authMode === "token" ? env.BELLDANDY_AUTH_TOKEN : undefined,
    },
    paths: { workspaceRoot, gatewayStateRoot },
    gateway: {
      command: nodePath,
      args: ["packages/belldandy-core/dist/bin/gateway.js"],
      cwd: workspaceRoot,
      env,
    },
    benchmark: {
      command: nodePath,
      cwd: workspaceRoot,
      env,
      args: [
        "scripts/run-coding-agent-benchmark.mjs",
        "--platform", "windows-native",
        "--fixture-root", fixtureRoot,
        "--artifact-root", artifactRoot,
        "--state-root", stateRoot,
        "--provider", provider,
        "--model-id", modelId,
        "--credentials-configured", String(credentialsConfigured),
        "--attempt", String(attempt),
        ...(infrastructureRetries === undefined
          ? []
          : ["--infrastructure-retries", String(infrastructureRetries)]),
        ...(input.taskId ? ["--task-id", requireInput(input, "taskId")] : []),
        ...(priorObservedCostUsd === undefined
          ? []
          : ["--prior-observed-cost-usd", String(priorObservedCostUsd)]),
        ...(maxTotalCostUsd === undefined
          ? []
          : ["--max-total-cost-usd", String(maxTotalCostUsd)]),
        ...(shadowCandidateId === undefined
          ? []
          : ["--shadow-candidate-id", shadowCandidateId]),
        ...(manifestRevision === "v1" ? [] : ["--manifest-revision", manifestRevision]),
        ...(sourceRoot ? ["--source-root", sourceRoot] : []),
        ...(v3RepositoryConfig ? ["--v3-repository-config", v3RepositoryConfig] : []),
      ],
    },
  };
}

export async function verifyWindowsBenchmarkGateway(endpoint, options = {}) {
  const WebSocketConstructor = options.WebSocketConstructor ?? WebSocket;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocketConstructor(endpoint.wsUrl, { origin: endpoint.origin });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocketConstructor.OPEN
        || socket.readyState === WebSocketConstructor.CONNECTING) {
        socket.close();
      }
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      finish(new Error("Windows benchmark Gateway authentication probe timed out."));
    }, timeoutMs);

    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      finish(new Error(`Windows benchmark Gateway rejected the websocket upgrade (${response.statusCode}).`));
    });
    socket.on("message", (data) => {
      let frame;
      try {
        frame = JSON.parse(data.toString("utf-8"));
      } catch {
        finish(new Error("Windows benchmark Gateway returned invalid websocket JSON."));
        return;
      }
      if (frame?.type === "connect.challenge") {
        socket.send(JSON.stringify({
          type: "connect",
          role: "cli",
          clientId: `coding-benchmark-launcher-${crypto.randomUUID()}`,
          auth: endpoint.authMode === "token"
            ? { mode: "token", token: endpoint.authToken }
            : { mode: "none" },
          clientName: "coding benchmark Windows launcher",
        }));
        return;
      }
      if (frame?.type === "hello-ok") {
        finish();
        return;
      }
      if (frame?.type === "error") {
        finish(new Error("Windows benchmark Gateway rejected the authentication probe."));
      }
    });
    socket.on("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    socket.on("close", () => {
      if (!settled) finish(new Error("Windows benchmark Gateway closed before authentication completed."));
    });
  });
}

export async function stopWindowsBenchmarkGateway(child, options = {}) {
  if (!child || hasExited(child)) return;
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GATEWAY_STOP_GRACE_MS;
  const closed = new Promise((resolve) => child.once("close", () => resolve(true)));
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(() => resolve(false), gracePeriodMs)),
  ]);
  if (stopped || hasExited(child)) return;

  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
      throw new Error("Windows benchmark Gateway PID is unavailable for cleanup.");
    }
    const terminate = options.spawnSync ?? spawnSync;
    const result = terminate(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0 && !hasExited(child)) {
      throw new Error("Windows benchmark Gateway process tree cleanup failed.");
    }
    return;
  }
  child.kill("SIGKILL");
  await closed;
}

export async function runWindowsBenchmark(input, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "win32") {
    throw new Error("The Windows benchmark launcher must execute on Windows.");
  }
  const baseEnv = await resolveWindowsBenchmarkSourceEnvironment(input, dependencies);
  const invocation = buildWindowsBenchmarkInvocation(input, {
    ...dependencies,
    baseEnv,
  });
  const diagnostic = new GatewayReadinessDiagnostic({
    host: invocation.endpoint.host,
    port: invocation.endpoint.port,
  });
  diagnostic.event("invocation_ready");
  const spawnProcess = dependencies.spawn ?? spawn;
  await assertPortClosed(invocation.endpoint.host, invocation.endpoint.port);
  await fs.mkdir(invocation.paths.gatewayStateRoot, { recursive: true });
  let stdout;
  let stderr;
  let gateway;
  let gatewayReady = false;
  let readinessFailureCode;
  const stdoutPath = path.join(invocation.paths.gatewayStateRoot, "gateway.stdout.log");
  const stderrPath = path.join(invocation.paths.gatewayStateRoot, "gateway.stderr.log");
  const diagnosticPath = path.join(invocation.paths.gatewayStateRoot, "gateway-readiness.json");
  try {
    stdout = await fs.open(stdoutPath, "wx");
    stderr = await fs.open(stderrPath, "wx");
    diagnostic.event("output_files_opened");
    diagnostic.event("gateway_spawn_requested");
    gateway = spawnProcess(invocation.gateway.command, invocation.gateway.args, {
      cwd: invocation.gateway.cwd,
      env: invocation.gateway.env,
      windowsHide: true,
      stdio: ["ignore", stdout.fd, stderr.fd],
    });
    gateway.once("spawn", () => diagnostic.childSpawned(gateway.pid));
    gateway.once("error", (error) => diagnostic.childError(error?.code));
    gateway.once("exit", (code, signal) => diagnostic.childExited(code, signal));
    diagnostic.event("port_probe_started");
    await waitForGatewayPort(gateway, invocation.endpoint, dependencies.gatewayReadyTimeoutMs, {
      onPoll: () => observeGatewayOutput(diagnostic, stdoutPath, stderrPath),
    });
    diagnostic.portConnected();
    diagnostic.authProbeStarted();
    await (dependencies.verifyGateway ?? verifyWindowsBenchmarkGateway)(invocation.endpoint);
    diagnostic.authReady();
    diagnostic.ready();
    gatewayReady = true;
    if (dependencies.runBenchmark) {
      return await dependencies.runBenchmark({
        endpoint: invocation.endpoint,
      });
    }
    const benchmark = spawnProcess(invocation.benchmark.command, invocation.benchmark.args, {
      cwd: invocation.benchmark.cwd,
      env: invocation.benchmark.env,
      windowsHide: true,
      stdio: "inherit",
    });
    return await waitForChildExit(benchmark, "Windows benchmark runner");
  } catch (error) {
    if (!gatewayReady) {
      readinessFailureCode = classifyGatewayReadinessFailure(error);
      diagnostic.fail(readinessFailureCode);
    }
    throw error;
  } finally {
    try {
      diagnostic.stopRequested();
      await stopWindowsBenchmarkGateway(gateway, dependencies);
      diagnostic.stopCompleted();
    } finally {
      await observeGatewayOutput(diagnostic, stdoutPath, stderrPath);
      await Promise.allSettled([stdout?.close(), stderr?.close()].filter(Boolean));
      if (!gatewayReady && !readinessFailureCode && diagnostic.status === "starting") {
        diagnostic.fail("gateway_startup_failed");
      }
      await writeGatewayReadinessDiagnostic(diagnosticPath, diagnostic).catch(() => {});
      await waitForPortClosed(invocation.endpoint.host, invocation.endpoint.port);
    }
  }
}

async function waitForGatewayPort(child, endpoint, timeoutMs = DEFAULT_GATEWAY_READY_TIMEOUT_MS, options = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastOutputObservationAtMs = 0;
  while (Date.now() < deadline) {
    const now = Date.now();
    if (options.onPoll && now - lastOutputObservationAtMs >= 500) {
      await options.onPoll();
      lastOutputObservationAtMs = now;
    }
    if (hasExited(child)) {
      throw new Error("Windows benchmark Gateway exited before readiness.");
    }
    if (await canConnect(endpoint.host, endpoint.port)) return;
    await delay(100);
  }
  throw new Error("Windows benchmark Gateway readiness timed out.");
}

async function observeGatewayOutput(diagnostic, stdoutPath, stderrPath) {
  const [stdoutBytes, stderrBytes] = await Promise.all([
    readFileSize(stdoutPath),
    readFileSize(stderrPath),
  ]);
  diagnostic.output("stdout", stdoutBytes);
  diagnostic.output("stderr", stderrBytes);
}

async function readFileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return Number.isSafeInteger(stat.size) ? stat.size : 0;
  } catch {
    return 0;
  }
}

export function classifyGatewayReadinessFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/readiness timed out/i.test(message)) return "gateway_readiness_timeout";
  if (/exited before readiness/i.test(message)) return "gateway_exited_before_readiness";
  if (/authentication probe timed out/i.test(message)) return "gateway_auth_probe_timeout";
  if (/closed before authentication/i.test(message)) return "gateway_auth_probe_closed";
  if (/rejected the authentication probe/i.test(message)) return "gateway_auth_probe_rejected";
  if (/rejected the websocket upgrade/i.test(message)) return "gateway_auth_upgrade_rejected";
  return "gateway_startup_failed";
}

async function assertPortClosed(host, port) {
  if (await canConnect(host, port)) {
    throw new Error(`Windows benchmark Gateway port is already in use: ${host}:${port}.`);
  }
}

async function waitForPortClosed(host, port) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!await canConnect(host, port)) return;
    await delay(100);
  }
  throw new Error(`Windows benchmark Gateway listener remained after cleanup: ${host}:${port}.`);
}

async function canConnect(host, port) {
  return await new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForChildExit(child, label) {
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === null) reject(new Error(`${label} closed without an exit code.`));
      else resolve(exitCode);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEphemeralToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function copyNonEmptyEnvValue(target, source, key) {
  const value = source?.[key];
  if (isNonEmptyEnvValue(value)) target[key] = value;
}

function isNonEmptyEnvValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Windows benchmark Gateway port is invalid.");
  }
  return port;
}

function isSameWindowsPath(left, right) {
  const normalize = (value) => path.win32.normalize(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function requireInput(input, key) {
  const value = input?.[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

function parseNamedArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${flag ?? "<end>"}.`);
    }
    values.set(flag.slice(2), value);
  }
  return values;
}

function requireValue(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required.`);
  return value.trim();
}

async function main() {
  const values = parseNamedArgs(process.argv.slice(2));
  const credentialsValue = requireValue(values, "credentials-configured");
  if (credentialsValue !== "true" && credentialsValue !== "false") {
    throw new Error("--credentials-configured must be true or false.");
  }
  const stateRoot = requireValue(values, "state-root");
  const exitCode = await runWindowsBenchmark({
    workspaceRoot: values.get("workspace-root") ?? defaultWorkspaceRoot,
    gatewayStateRoot: values.get("gateway-state-root") ?? stateRoot,
    fixtureRoot: requireValue(values, "fixture-root"),
    artifactRoot: requireValue(values, "artifact-root"),
    stateRoot,
    provider: requireValue(values, "provider"),
    modelId: requireValue(values, "model-id"),
    credentialsConfigured: credentialsValue === "true",
    attempt: Number(values.get("attempt") ?? 1),
    ...(values.has("infrastructure-retries") ? {
      infrastructureRetries: Number(requireValue(values, "infrastructure-retries")),
    } : {}),
    host: values.get("host"),
    gatewayAccess: values.get("gateway-access") ?? "loopback",
    port: values.has("port") ? Number(requireValue(values, "port")) : undefined,
    authMode: values.get("auth-mode") ?? "token",
    taskId: values.get("task-id"),
    manifestRevision: values.get("manifest-revision") ?? "v1",
    sourceRoot: values.get("source-root"),
    v3RepositoryConfig: values.get("v3-repository-config"),
    providerEnvFile: values.get("provider-env-file"),
    ...(values.has("prior-observed-cost-usd") ? {
      priorObservedCostUsd: Number(requireValue(values, "prior-observed-cost-usd")),
    } : {}),
    ...(values.has("max-total-cost-usd") ? {
      maxTotalCostUsd: Number(requireValue(values, "max-total-cost-usd")),
    } : {}),
    ...(values.has("shadow-candidate-id") ? {
      shadowCandidateId: requireValue(values, "shadow-candidate-id"),
    } : {}),
  });
  process.exitCode = exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-benchmark-windows] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
