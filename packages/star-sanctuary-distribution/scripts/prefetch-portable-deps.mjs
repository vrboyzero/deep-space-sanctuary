import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDistributionMode } from "./distribution-mode.mjs";
import { resolveDistributionPolicySummary } from "./distribution-policy.mjs";
import {
  createRuntimeDependencyPrefetchArgs,
  createRuntimeRootPackageJson,
  sanitizeRuntimeWorkspacePackageJson,
} from "./runtime-dependency-assembler-policy.mjs";
import {
  createRuntimeDependencySnapshot,
  serializeRuntimeDependencySnapshot,
} from "./runtime-dependency-snapshot-policy.mjs";
import { createRuntimeDependencyStoreSnapshot } from "./runtime-dependency-store-snapshot-policy.mjs";
import {
  resolveRuntimeBuildScriptPolicy,
  serializeRuntimeWorkspaceConfig,
} from "./runtime-build-script-policy.mjs";
import { assertPathInsideRoots, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"));
const memoryPackageJson = JSON.parse(
  fs.readFileSync(path.join(workspaceRoot, "packages", "belldandy-memory", "package.json"), "utf-8"),
);
const platform = process.platform;
const arch = process.arch;
const distribution = resolveDistributionMode();
const { mode, includeOptionalNative } = distribution;
const sqliteVecVersion = String(memoryPackageJson.dependencies?.["sqlite-vec"] || "0.1.7-alpha.2");

const portableCacheRoot = path.join(workspaceRoot, "artifacts", "_cache");
const portablePnpmStoreDir = path.join(portableCacheRoot, "pnpm-store-portable", mode);
const prefetchRoot = path.join(portableCacheRoot, "portable-prefetch", mode);
const runtimeRoot = path.join(prefetchRoot, "runtime");
const snapshotPath = path.join(prefetchRoot, "runtime-dependency-snapshot.json");
const runtimePackagesRoot = path.join(runtimeRoot, "packages");
const runtimeAppsRoot = path.join(runtimeRoot, "apps");
const PORTABLE_PREFETCH_MAX_ATTEMPTS = 4;
const PORTABLE_PREFETCH_RETRY_DELAY_MS = 1_500;
const PORTABLE_PREFETCH_RETRYABLE_CODES = new Set(["EACCES", "EPERM"]);

const packageNames = [
  "belldandy-protocol",
  "star-sanctuary-distribution",
  "belldandy-agent",
  "belldandy-core",
  "belldandy-skills",
  "belldandy-memory",
  "belldandy-channels",
  "belldandy-mcp",
  "belldandy-plugins",
  "belldandy-browser",
];
const distributionPolicy = resolveDistributionPolicySummary({
  workspaceRoot,
  packageDirs: packageNames,
  mode,
});

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryablePortablePrefetchError(error) {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error);
  return [...PORTABLE_PREFETCH_RETRYABLE_CODES].some((code) => message.includes(code));
}

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function copyFile(src, dest) {
  assertExists(src, "file");
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyRuntimePackageJson(src, dest) {
  const packageJson = JSON.parse(fs.readFileSync(src, "utf-8"));
  ensureDir(path.dirname(dest));
  fs.writeFileSync(
    dest,
    `${JSON.stringify(sanitizeRuntimeWorkspacePackageJson(packageJson, {
      excludedOptionalDependencies: distributionPolicy.excludedOptionalDependencies,
    }), null, 2)}\n`,
    "utf-8",
  );
}

function writeRuntimePackageJson() {
  const runtimePackageJson = createRuntimeRootPackageJson({
    packageManager: rootPackageJson.packageManager,
    engines: rootPackageJson.engines,
    pnpm: rootPackageJson.pnpm,
    sqliteVecVersion,
    excludedOptionalDependencies: distributionPolicy.excludedOptionalDependencies,
  });
  fs.writeFileSync(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    "utf-8",
  );
}

function copyRuntimeDependencyPatches() {
  const patchedDependencies = rootPackageJson.pnpm?.patchedDependencies ?? {};
  for (const patchPath of Object.values(patchedDependencies)) {
    if (typeof patchPath !== "string" || !patchPath.trim()) {
      throw new Error(`Invalid runtime dependency patch path: ${String(patchPath)}`);
    }
    const sourcePath = assertPathInsideRoots(
      path.resolve(workspaceRoot, patchPath),
      [workspaceRoot],
      "copy runtime dependency patch source",
    );
    const destinationPath = assertPathInsideRoots(
      path.resolve(runtimeRoot, patchPath),
      [runtimeRoot],
      "copy runtime dependency patch destination",
    );
    copyFile(sourcePath, destinationPath);
  }
}

function copyWorkspacePackageManifest(packageName) {
  copyRuntimePackageJson(
    path.join(workspaceRoot, "packages", packageName, "package.json"),
    path.join(runtimePackagesRoot, packageName, "package.json"),
  );
}

function preparePrefetchWorkspace() {
  resetSandboxDir(prefetchRoot, {
    allowedRoots: [portableCacheRoot],
    label: "reset portable prefetch workspace",
  });
  ensureDir(runtimePackagesRoot);
  ensureDir(runtimeAppsRoot);

  writeRuntimePackageJson();
  fs.writeFileSync(
    path.join(runtimeRoot, "pnpm-workspace.yaml"),
    serializeRuntimeWorkspaceConfig(mode),
    "utf-8",
  );
  copyFile(path.join(workspaceRoot, "pnpm-lock.yaml"), path.join(runtimeRoot, "pnpm-lock.yaml"));
  copyRuntimeDependencyPatches();

  for (const packageName of packageNames) {
    copyWorkspacePackageManifest(packageName);
  }

  copyFile(
    path.join(workspaceRoot, "apps", "web", "package.json"),
    path.join(runtimeAppsRoot, "web", "package.json"),
  );
}

function prefetchRuntimeDependencies() {
  ensureDir(portablePnpmStoreDir);
  const { lockfileArgs, fetchArgs } = createRuntimeDependencyPrefetchArgs({
    includeOptionalNative,
    storeDir: portablePnpmStoreDir,
  });

  let lastError;
  for (let attempt = 1; attempt <= PORTABLE_PREFETCH_MAX_ATTEMPTS; attempt += 1) {
    let commandOutput = "";
    let failedStep = "lockfile";
    let failedStatus = 1;
    for (const [stepName, args] of [["lockfile", lockfileArgs], ["fetch", fetchArgs]]) {
      const result = spawnSync("corepack", args, {
        cwd: runtimeRoot,
        encoding: "utf-8",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          CI: "true",
        },
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      commandOutput += `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      if (result.status !== 0) {
        failedStep = stepName;
        failedStatus = result.status ?? 1;
        break;
      }
      failedStep = "";
    }

    if (!failedStep) {
      if (attempt > 1) {
        console.warn(`[portable] dependency prefetch recovered on attempt ${attempt}/${PORTABLE_PREFETCH_MAX_ATTEMPTS}.`);
      }
      return;
    }

    lastError = new Error(`Portable dependency prefetch ${failedStep} failed with exit code ${failedStatus}`);
    if (
      process.platform !== "win32"
      || attempt === PORTABLE_PREFETCH_MAX_ATTEMPTS
      || !isRetryablePortablePrefetchError(commandOutput)
    ) {
      throw lastError;
    }

    console.warn(
      `[portable] dependency prefetch hit a transient Windows permission error; recreating the warmup workspace and retrying (${attempt}/${PORTABLE_PREFETCH_MAX_ATTEMPTS}).`,
    );
    preparePrefetchWorkspace();
    sleepSync(PORTABLE_PREFETCH_RETRY_DELAY_MS * attempt);
  }

  throw lastError ?? new Error("Portable dependency prefetch failed for an unknown reason.");
}

async function writeRuntimeDependencySnapshot() {
  const snapshot = createRuntimeDependencySnapshot({
    target: {
      mode,
      platform,
      arch,
      nodeAbi: process.versions.modules,
    },
    sourceLockfile: fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml")),
    runtimeLockfile: fs.readFileSync(path.join(runtimeRoot, "pnpm-lock.yaml")),
    runtimeWorkspaceConfig: fs.readFileSync(path.join(runtimeRoot, "pnpm-workspace.yaml")),
    storeSnapshot: await createRuntimeDependencyStoreSnapshot(portablePnpmStoreDir),
  });
  const temporaryPath = `${snapshotPath}.tmp`;
  fs.writeFileSync(temporaryPath, serializeRuntimeDependencySnapshot(snapshot), "utf-8");
  fs.renameSync(temporaryPath, snapshotPath);
}

async function main() {
  if (platform !== "win32") {
    throw new Error(`Portable dependency prefetch currently only targets Windows. Current platform: ${platform}`);
  }

  resolveRuntimeBuildScriptPolicy({ cwd: workspaceRoot, mode: "workspace" });
  resetSandboxDir(portablePnpmStoreDir, {
    allowedRoots: [portableCacheRoot],
    label: "reset portable pnpm store",
  });
  preparePrefetchWorkspace();
  resolveRuntimeBuildScriptPolicy({ cwd: runtimeRoot, mode });
  prefetchRuntimeDependencies();
  // Descriptor 只在 lockfile resolution 与 store fetch 都成功后发布，避免部分 prefetch 被 assembler 接纳。
  await writeRuntimeDependencySnapshot();

  console.log(
    `[portable] Prefetched runtime dependencies into ${portablePnpmStoreDir} using ${runtimeRoot} (${includeOptionalNative ? "full" : "slim"} mode, ${platform}-${arch}, included optional deps: ${distributionPolicy.includedOptionalDependencies.join(", ") || "(none)"})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
