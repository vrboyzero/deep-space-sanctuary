import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveBenchmarkMaximumCostUsd,
  resolvePriorObservedCostUsd,
} from "./run-coding-agent-benchmark.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const WSL_BENCHMARK_PRICING_ENV_KEYS = [
  "BELLDANDY_MODEL_INPUT_USD_PER_1M",
  "BELLDANDY_MODEL_OUTPUT_USD_PER_1M",
  "BELLDANDY_MODEL_CACHE_READ_USD_PER_1M",
];
const WSL_SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export function buildWslBenchmarkInvocation(input, dependencies = {}) {
  const distribution = requireInput(input, "distribution");
  const resolvePath = dependencies.resolvePath ?? path.resolve;
  const workspaceRoot = resolvePath(requireInput(input, "workspaceRoot"));
  const toWslPath = dependencies.toWslPath ?? ((value) => resolveWslPath(value, distribution));
  const workspaceRootWsl = toWslPath(workspaceRoot);
  const fixtureRoot = resolvePath(requireInput(input, "fixtureRoot"));
  if (!/^[A-Za-z]:[\\/]/.test(fixtureRoot)) {
    throw new Error("fixtureRoot must use a local Windows drive path for the Windows Gateway workspace snapshot.");
  }
  const fixtureRootWsl = toWslPath(fixtureRoot);
  const artifactRootWsl = toWslPath(requireInput(input, "artifactRoot"));
  const stateRootWsl = toWslPath(requireInput(input, "stateRoot"));
  const manifestRevision = input.manifestRevision ?? "v1";
  if (manifestRevision !== "v1" && manifestRevision !== "v2" && manifestRevision !== "v3") {
    throw new Error("manifestRevision must be v1, v2, or v3.");
  }
  const v3RepositoryConfig = input.v3RepositoryConfig === undefined
    ? undefined
    : requireInput(input, "v3RepositoryConfig");
  if (v3RepositoryConfig && manifestRevision !== "v3") {
    throw new Error("v3 repository config requires manifestRevision v3.");
  }
  const sourceRootWsl = input.sourceRoot ? toWslPath(requireInput(input, "sourceRoot")) : undefined;
  const v3RepositoryConfigWsl = v3RepositoryConfig ? toWslPath(v3RepositoryConfig) : undefined;
  if (manifestRevision === "v2" && !sourceRootWsl) {
    throw new Error("sourceRoot is required for manifestRevision v2.");
  }
  const credentialsConfigured = input.credentialsConfigured;
  if (typeof credentialsConfigured !== "boolean") {
    throw new Error("credentialsConfigured must be a boolean.");
  }
  const attempt = Number.isInteger(input.attempt) ? input.attempt : 1;
  const priorObservedCostUsd = input.priorObservedCostUsd === undefined
    ? undefined
    : resolvePriorObservedCostUsd(input.priorObservedCostUsd);
  const maxTotalCostUsd = input.maxTotalCostUsd === undefined
    ? undefined
    : resolveBenchmarkMaximumCostUsd(input.maxTotalCostUsd);
  const shadowCandidateId = input.shadowCandidateId === undefined
    ? undefined
    : requireInput(input, "shadowCandidateId");
  const toolchainBin = resolveWslToolchainBin(input.toolchainBin);
  const authMode = input.authMode ?? "none";
  if (authMode !== "none" && authMode !== "token") {
    throw new Error("authMode must be none or token.");
  }
  const baseEnv = dependencies.baseEnv ?? process.env;
  const pricingEnvArgs = WSL_BENCHMARK_PRICING_ENV_KEYS.flatMap((key) => {
    const value = baseEnv[key];
    return typeof value === "string" && value.trim() ? [`${key}=${value.trim()}`] : [];
  });
  let childEnv;
  if (authMode === "token") {
    const authToken = input.authToken ?? baseEnv.BELLDANDY_AUTH_TOKEN;
    if (typeof authToken !== "string" || !authToken.trim()) {
      throw new Error("BELLDANDY_AUTH_TOKEN is required when authMode is token.");
    }
    childEnv = {
      ...baseEnv,
      BELLDANDY_AUTH_TOKEN: authToken,
      WSLENV: appendWslenvVariable(baseEnv.WSLENV, "BELLDANDY_AUTH_TOKEN"),
    };
  }

  return {
    command: "wsl.exe",
    ...(childEnv ? { env: childEnv } : {}),
    args: [
      "--distribution", distribution,
      "--exec", "env",
      `BELLDANDY_HOST=${input.host ?? "127.0.0.1"}`,
      `BELLDANDY_PORT=${input.port ?? "28889"}`,
      `BELLDANDY_AUTH_MODE=${authMode}`,
      ...pricingEnvArgs,
      ...(toolchainBin ? [`PATH=${toolchainBin}:${WSL_SYSTEM_PATH}`] : []),
      ...(manifestRevision === "v2" || manifestRevision === "v3"
        ? ["BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT=2048"]
        : []),
      "node", `${workspaceRootWsl}/scripts/run-coding-agent-benchmark.mjs`,
      "--platform", "wsl2-linux",
      "--fixture-root", fixtureRootWsl,
      "--gateway-fixture-root", fixtureRoot,
      "--artifact-root", artifactRootWsl,
      "--state-root", stateRootWsl,
      "--provider", requireInput(input, "provider"),
      "--model-id", requireInput(input, "modelId"),
      "--credentials-configured", String(credentialsConfigured),
      "--attempt", String(attempt),
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
      ...(sourceRootWsl ? ["--source-root", sourceRootWsl] : []),
      ...(v3RepositoryConfigWsl ? ["--v3-repository-config", v3RepositoryConfigWsl] : []),
    ],
  };
}

function appendWslenvVariable(currentValue, variableName) {
  const entries = String(currentValue ?? "").split(":").map((item) => item.trim()).filter(Boolean);
  if (!entries.some((item) => item.split("/", 1)[0] === variableName)) entries.push(variableName);
  return entries.join(":");
}

function resolveWslPath(value, distribution) {
  const result = spawnSync(
    "wsl.exe",
    ["--distribution", distribution, "--exec", "wslpath", "-a", path.resolve(value)],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wslpath failed for ${path.resolve(value)}: ${String(result.stderr ?? "").trim()}`);
  }
  const resolved = String(result.stdout ?? "").trim();
  if (!resolved.startsWith("/")) throw new Error(`wslpath returned an invalid path for ${path.resolve(value)}.`);
  return resolved.replace(/\/$/, "");
}

function requireInput(input, key) {
  const value = input?.[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

function resolveWslToolchainBin(value) {
  if (value === undefined) return undefined;
  const toolchainBin = requireInput({ toolchainBin: value }, "toolchainBin").replace(/\/+$/, "");
  if (!toolchainBin.startsWith("/") || toolchainBin === "" || /[:\0\r\n]/.test(toolchainBin)) {
    throw new Error("toolchainBin must be a single absolute Linux directory.");
  }
  return toolchainBin;
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
  if (process.platform !== "win32") {
    throw new Error("The WSL benchmark launcher must execute on a Windows host.");
  }
  const values = parseNamedArgs(process.argv.slice(2));
  const credentialsValue = requireValue(values, "credentials-configured");
  if (credentialsValue !== "true" && credentialsValue !== "false") {
    throw new Error("--credentials-configured must be true or false.");
  }
  const invocation = buildWslBenchmarkInvocation({
    distribution: requireValue(values, "distribution"),
    workspaceRoot: values.get("workspace-root") ?? defaultWorkspaceRoot,
    fixtureRoot: requireValue(values, "fixture-root"),
    artifactRoot: requireValue(values, "artifact-root"),
    stateRoot: requireValue(values, "state-root"),
    provider: requireValue(values, "provider"),
    modelId: requireValue(values, "model-id"),
    credentialsConfigured: credentialsValue === "true",
    attempt: Number(values.get("attempt") ?? 1),
    host: values.get("host"),
    port: values.get("port"),
    authMode: values.get("auth-mode"),
    authToken: process.env.BELLDANDY_AUTH_TOKEN,
    taskId: values.get("task-id"),
    manifestRevision: values.get("manifest-revision") ?? "v1",
    sourceRoot: values.get("source-root"),
    v3RepositoryConfig: values.get("v3-repository-config"),
    toolchainBin: values.get("toolchain-bin"),
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
  const child = spawn(invocation.command, invocation.args, {
    cwd: defaultWorkspaceRoot,
    stdio: "inherit",
    windowsHide: true,
    env: invocation.env ?? process.env,
  });
  child.once("error", (error) => {
    console.error(`[coding-agent-benchmark-wsl] ${error.message}`);
    process.exitCode = 1;
  });
  child.once("close", (exitCode) => {
    process.exitCode = exitCode ?? 1;
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-benchmark-wsl] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
