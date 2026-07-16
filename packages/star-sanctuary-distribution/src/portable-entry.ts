import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateBootstrapAuthToken } from "./bootstrap-auth-token.js";
import { startGatewaySupervisor } from "./gateway-supervisor.js";
import { ensureDefaultEnvFiles, loadRuntimeEnvFiles, readTrimmedEnv, resolveRuntimeEnvDir } from "./env.js";
import { ensurePortableRuntime } from "./portable-runtime.js";
import { resolveStateDir } from "./state-dir.js";

function resolvePaths() {
  const entryFile = fileURLToPath(import.meta.url);
  const distDir = path.dirname(entryFile);
  const candidatePortableRoots = [
    path.resolve(distDir, ".."),
    path.resolve(distDir, "..", "..", "..", ".."),
  ];
  const portableRoot = candidatePortableRoots.find((candidate) => (
    fs.existsSync(path.join(candidate, "payload", "version.json"))
    || fs.existsSync(path.join(candidate, "version.json"))
  ));

  if (!portableRoot) {
    throw new Error(`Unable to resolve portable root from launcher path: ${entryFile}`);
  }

  const payloadRoot = path.join(portableRoot, "payload");
  return { payloadRoot, portableRoot };
}

function ensurePortableEnv(params: {
  baseEnv: NodeJS.ProcessEnv;
  runtimeDir: string;
  envDir: string;
}): NodeJS.ProcessEnv {
  const stateDir = path.resolve(resolveRuntimeEnvDir({
    baseEnv: params.baseEnv,
    fallbackEnvDir: params.envDir,
  }));
  ensureDefaultEnvFiles(stateDir, { runtimeDir: params.runtimeDir });
  const env: NodeJS.ProcessEnv = loadRuntimeEnvFiles(params.baseEnv, stateDir);
  env.STAR_SANCTUARY_RUNTIME_MODE = "portable";
  env.BELLDANDY_RUNTIME_MODE = "portable";
  env.STAR_SANCTUARY_RUNTIME_DIR = params.runtimeDir;
  env.BELLDANDY_RUNTIME_DIR = params.runtimeDir;
  env.AUTO_OPEN_BROWSER = readTrimmedEnv(env, "AUTO_OPEN_BROWSER") ?? "true";

  if (readTrimmedEnv(env, "BELLDANDY_AUTH_MODE") === "token" && !readTrimmedEnv(env, "BELLDANDY_AUTH_TOKEN")) {
    const setupToken = generateBootstrapAuthToken();
    env.SETUP_TOKEN = setupToken;
    env.BELLDANDY_AUTH_TOKEN = setupToken;
  }

  return env;
}

async function startGateway() {
  const { payloadRoot, portableRoot } = resolvePaths();
  const ensuredRuntime = ensurePortableRuntime({
    portableRoot,
    payloadRoot,
  });
  const runtimeDir = ensuredRuntime.runtimeDir;
  const gatewayEntry = path.join(runtimeDir, "packages", "belldandy-core", "dist", "bin", "gateway.js");
  const envDir = path.resolve(resolveRuntimeEnvDir({
    baseEnv: process.env,
    fallbackEnvDir: resolveStateDir(process.env),
  }));
  const env = ensurePortableEnv({
    baseEnv: process.env,
    runtimeDir,
    envDir,
  });

  if (ensuredRuntime.recovered) {
    console.log(
      `[Star Sanctuary Portable] Recovered runtime from ${ensuredRuntime.payloadRoot} (reason=${ensuredRuntime.recoveryReason ?? "unknown"})`,
    );
  } else {
    console.log(`[Star Sanctuary Portable] Reusing runtime at ${runtimeDir}`);
  }

  await startGatewaySupervisor({
    label: "Star Sanctuary Portable",
    gatewayEntry,
    cwd: portableRoot,
    stateDir: envDir,
    env,
  });
}

void startGateway().catch((error) => {
  console.error(`[Star Sanctuary Portable] Failed to start gateway: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
