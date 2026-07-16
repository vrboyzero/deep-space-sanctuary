import path from "node:path";

import { resolveStateDir } from "@belldandy/protocol";

import { generateBootstrapAuthToken } from "./bootstrap-auth-token.js";
import { ensureDefaultEnvFiles, loadRuntimeEnvFiles, readTrimmedEnv, resolveRuntimeEnvDir } from "./env.js";
import { startGatewaySupervisor } from "./gateway-supervisor.js";
import {
  cleanupSingleExeRuntimeDirs,
  removeSingleExeRuntimeActivityMarker,
  writeSingleExeRuntimeActivityMarker,
} from "./runtime-cleanup.js";
import { resolveSingleExePayloadRoot } from "./runtime-manifest.js";
import {
  ensureSingleExeRuntime,
  ensureSingleExeRuntimeFromSea,
  SINGLE_EXE_NODE_RUNTIME_FILE_NAME,
} from "./runtime-extract.js";
import { resolveSingleExeAppHomeDir } from "./runtime-version-dir.js";
import { isSeaRuntime } from "./sea.js";

function ensureSingleExeEnv(params: {
  baseEnv: NodeJS.ProcessEnv;
  runtimeDir: string;
  envDir: string;
}): NodeJS.ProcessEnv {
  ensureDefaultEnvFiles(params.envDir, { runtimeDir: params.runtimeDir });
  const env: NodeJS.ProcessEnv = loadRuntimeEnvFiles(params.baseEnv, params.envDir);
  env.STAR_SANCTUARY_RUNTIME_MODE = "single-exe";
  env.BELLDANDY_RUNTIME_MODE = "single-exe";
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

async function main(): Promise<void> {
  const baseEnv = { ...process.env };
  const stateDir = resolveStateDir(baseEnv);
  const envDir = path.resolve(resolveRuntimeEnvDir({
    baseEnv,
    fallbackEnvDir: stateDir,
  }));
  console.log(`[Star Sanctuary Single-Exe] State dir: ${envDir}`);
  const runningFromSea = isSeaRuntime();
  const appHomeDir = resolveSingleExeAppHomeDir({ env: baseEnv });
  const ensuredRuntime = runningFromSea
    ? ensureSingleExeRuntimeFromSea({ env: baseEnv, appHomeDir })
    : ensureSingleExeRuntime({
      payloadRoot: resolveSingleExePayloadRoot(process.env),
      env: baseEnv,
      appHomeDir,
    });

  if (!runningFromSea) {
    console.log(`[Star Sanctuary Single-Exe] Payload root: ${resolveSingleExePayloadRoot(process.env)}`);
  } else {
    console.log("[Star Sanctuary Single-Exe] Using embedded SEA payload");
  }

  const gatewayEntry = path.join(
    ensuredRuntime.versionDirInfo.runtimeDir,
    "packages",
    "belldandy-core",
    "dist",
    "bin",
    "gateway.js",
  );
  const embeddedNodeRuntime = path.join(
    ensuredRuntime.versionDirInfo.versionRootDir,
    SINGLE_EXE_NODE_RUNTIME_FILE_NAME,
  );
  const env = ensureSingleExeEnv({
    baseEnv,
    runtimeDir: ensuredRuntime.versionDirInfo.runtimeDir,
    envDir,
  });

  console.log(`[Star Sanctuary Single-Exe] Gateway entry: ${gatewayEntry}`);

  if (ensuredRuntime.extracted) {
    console.log(
      `[Star Sanctuary Single-Exe] Prepared runtime ${ensuredRuntime.versionDirInfo.versionKey} at ${ensuredRuntime.versionDirInfo.versionRootDir}`,
    );
  } else {
    console.log(
      `[Star Sanctuary Single-Exe] Reusing runtime ${ensuredRuntime.versionDirInfo.versionKey} at ${ensuredRuntime.versionDirInfo.versionRootDir}`,
    );
  }

  const runtimeActivityMarkerPath = writeSingleExeRuntimeActivityMarker({
    versionRootDir: ensuredRuntime.versionDirInfo.versionRootDir,
    productName: ensuredRuntime.versionFile.productName,
    versionKey: ensuredRuntime.versionDirInfo.versionKey,
  });
  const cleanupRuntimeActivityMarker = () => {
    try {
      removeSingleExeRuntimeActivityMarker(ensuredRuntime.versionDirInfo.versionRootDir);
    } catch (error) {
      console.warn(
        `[Star Sanctuary Single-Exe] Failed to remove runtime activity marker ${runtimeActivityMarkerPath}: ${String(error)}`,
      );
    }
  };
  process.on("exit", cleanupRuntimeActivityMarker);
  process.on("SIGINT", () => cleanupRuntimeActivityMarker());
  process.on("SIGTERM", () => cleanupRuntimeActivityMarker());

  const cleanupResult = cleanupSingleExeRuntimeDirs({
    runtimeBaseDir: ensuredRuntime.versionDirInfo.runtimeBaseDir,
    currentVersionRootDir: ensuredRuntime.versionDirInfo.versionRootDir,
    appHomeDir,
    productName: ensuredRuntime.versionFile.productName,
  });
  if (cleanupResult.removedVersionDirs.length > 0 || cleanupResult.removedTempDirs.length > 0) {
    console.log(
      `[Star Sanctuary Single-Exe] Cleaned runtime cache: removedVersions=${cleanupResult.removedVersionDirs.length}, removedTempDirs=${cleanupResult.removedTempDirs.length}`,
    );
  }
  for (const skippedPath of cleanupResult.skippedPaths) {
    console.warn(`[Star Sanctuary Single-Exe] Skipped runtime cleanup for ${skippedPath.path}: ${skippedPath.reason}`);
  }

  await startGatewaySupervisor({
    label: "Star Sanctuary Single-Exe",
    gatewayEntry,
    runtimeExecutable: runningFromSea ? embeddedNodeRuntime : undefined,
    cwd: envDir,
    stateDir: envDir,
    env,
  });
}

void main().catch((error) => {
  console.error(`[Star Sanctuary Single-Exe] Failed to start gateway: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
