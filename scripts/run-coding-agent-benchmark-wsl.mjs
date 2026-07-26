import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePriorObservedCostUsd } from "./run-coding-agent-benchmark.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");

export function buildWslBenchmarkInvocation(input, dependencies = {}) {
  const distribution = requireInput(input, "distribution");
  const workspaceRoot = path.resolve(requireInput(input, "workspaceRoot"));
  const toWslPath = dependencies.toWslPath ?? ((value) => resolveWslPath(value, distribution));
  const workspaceRootWsl = toWslPath(workspaceRoot);
  const fixtureRootWsl = toWslPath(requireInput(input, "fixtureRoot"));
  const artifactRootWsl = toWslPath(requireInput(input, "artifactRoot"));
  const stateRootWsl = toWslPath(requireInput(input, "stateRoot"));
  const credentialsConfigured = input.credentialsConfigured;
  if (typeof credentialsConfigured !== "boolean") {
    throw new Error("credentialsConfigured must be a boolean.");
  }
  const attempt = Number.isInteger(input.attempt) ? input.attempt : 1;
  const priorObservedCostUsd = input.priorObservedCostUsd === undefined
    ? undefined
    : resolvePriorObservedCostUsd(input.priorObservedCostUsd);
  const authMode = input.authMode ?? "none";
  if (authMode !== "none" && authMode !== "token") {
    throw new Error("authMode must be none or token.");
  }
  let childEnv;
  if (authMode === "token") {
    const baseEnv = dependencies.baseEnv ?? process.env;
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
      "node", `${workspaceRootWsl}/scripts/run-coding-agent-benchmark.mjs`,
      "--platform", "wsl2-linux",
      "--fixture-root", fixtureRootWsl,
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
    ...(values.has("prior-observed-cost-usd") ? {
      priorObservedCostUsd: Number(requireValue(values, "prior-observed-cost-usd")),
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
