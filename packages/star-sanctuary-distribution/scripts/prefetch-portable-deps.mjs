import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDistributionMode } from "./distribution-mode.mjs";
import { resolveDistributionPolicySummary } from "./distribution-policy.mjs";
import { resetSandboxDir } from "./sandbox-paths.mjs";

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

function sanitizeRuntimeWorkspacePackageJson(packageJson) {
  const sanitized = { ...packageJson };
  delete sanitized.devDependencies;
  delete sanitized.scripts;
  return sanitized;
}

function copyRuntimePackageJson(src, dest) {
  const packageJson = JSON.parse(fs.readFileSync(src, "utf-8"));
  ensureDir(path.dirname(dest));
  fs.writeFileSync(
    dest,
    `${JSON.stringify(sanitizeRuntimeWorkspacePackageJson(packageJson), null, 2)}\n`,
    "utf-8",
  );
}

function writeRuntimePackageJson() {
  const runtimePackageJson = {
    name: "star-sanctuary-portable-runtime",
    private: true,
    type: "module",
    packageManager: rootPackageJson.packageManager,
    engines: rootPackageJson.engines,
    dependencies: {
      "sqlite-vec-windows-x64": sqliteVecVersion,
    },
  };
  fs.writeFileSync(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    "utf-8",
  );
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
  copyFile(path.join(workspaceRoot, "pnpm-workspace.yaml"), path.join(runtimeRoot, "pnpm-workspace.yaml"));
  copyFile(path.join(workspaceRoot, "pnpm-lock.yaml"), path.join(runtimeRoot, "pnpm-lock.yaml"));

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
  const args = [
    "pnpm",
    "fetch",
    "--prefer-offline",
    "--child-concurrency=1",
    "--network-concurrency=1",
    "--store-dir",
    portablePnpmStoreDir,
    "--config.package-import-method=copy",
  ];
  if (!includeOptionalNative) {
    args.push("--no-optional");
  }

  let lastError;
  for (let attempt = 1; attempt <= PORTABLE_PREFETCH_MAX_ATTEMPTS; attempt += 1) {
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

    if (result.status === 0) {
      if (attempt > 1) {
        console.warn(`[portable] dependency prefetch recovered on attempt ${attempt}/${PORTABLE_PREFETCH_MAX_ATTEMPTS}.`);
      }
      return;
    }

    const commandOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    lastError = new Error(`Portable dependency prefetch failed with exit code ${result.status ?? 1}`);
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

function main() {
  if (platform !== "win32") {
    throw new Error(`Portable dependency prefetch currently only targets Windows. Current platform: ${platform}`);
  }

  preparePrefetchWorkspace();
  prefetchRuntimeDependencies();

  console.log(
    `[portable] Prefetched runtime dependencies into ${portablePnpmStoreDir} using ${runtimeRoot} (${includeOptionalNative ? "full" : "slim"} mode, ${platform}-${arch}, included optional deps: ${distributionPolicy.includedOptionalDependencies.join(", ") || "(none)"})`,
  );
}

main();
