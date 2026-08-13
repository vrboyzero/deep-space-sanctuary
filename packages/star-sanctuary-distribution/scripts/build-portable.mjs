import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolveDistributionMode, resolvePortableArtifactRoot } from "./distribution-mode.mjs";
import { resolveDistributionPolicySummary } from "./distribution-policy.mjs";
import { renderPortableGuide } from "./distribution-user-guide.mjs";
import {
  createRuntimeDependencyInstallArgs,
  createRuntimeRootPackageJson,
  sanitizeRuntimeWorkspacePackageJson,
} from "./runtime-dependency-assembler-policy.mjs";
import {
  assertRuntimeDependencySnapshot,
  createRuntimeDependencySnapshotArtifactIdentity,
} from "./runtime-dependency-snapshot-policy.mjs";
import { createRuntimeDependencyStoreSnapshot } from "./runtime-dependency-store-snapshot-policy.mjs";
import { resolveRuntimeBuildScriptPolicy } from "./runtime-build-script-policy.mjs";
import { assertPathInsideRoots, guardedRemovePath } from "./sandbox-paths.mjs";
import { copyPackageNonDistBinArtifacts } from "../../../scripts/artifact-contract.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const require = createRequire(import.meta.url);
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"));
const memoryPackageJson = JSON.parse(
  fs.readFileSync(path.join(workspaceRoot, "packages", "belldandy-memory", "package.json"), "utf-8"),
);
const version = String(rootPackageJson.version || "0.0.0-dev");
const platform = process.platform;
const arch = process.arch;
const distribution = resolveDistributionMode();
const { mode, includeOptionalNative } = distribution;
const sqliteVecVersion = String(memoryPackageJson.dependencies?.["sqlite-vec"] || "0.1.7-alpha.2");

const portableArtifactsRoot = path.join(workspaceRoot, "artifacts", "portable");
const portableCacheRoot = path.join(workspaceRoot, "artifacts", "_cache");
const portablePnpmStoreDir = path.join(portableCacheRoot, "pnpm-store-portable", mode);
const portablePrefetchRoot = path.join(portableCacheRoot, "portable-prefetch", mode);
const portablePrefetchRuntimeRoot = path.join(portablePrefetchRoot, "runtime");
const portablePrefetchLockfilePath = path.join(portablePrefetchRuntimeRoot, "pnpm-lock.yaml");
const portablePrefetchSnapshotPath = path.join(portablePrefetchRoot, "runtime-dependency-snapshot.json");
const portableRoot = resolvePortableArtifactRoot({
  workspaceRoot,
  platform,
  arch,
  mode,
});
const portableLauncherRoot = path.join(portableRoot, "launcher");
const portableRecoveryPayloadRoot = path.join(portableRoot, "payload");
const runtimeRoot = path.join(portableRoot, "runtime");
const runtimePackagesRoot = path.join(runtimeRoot, "packages");
const runtimeAppsRoot = path.join(runtimeRoot, "apps");
const runtimeManifestPath = path.join(portableRoot, "runtime-manifest.json");
const esbuildCliPath = require.resolve("esbuild/bin/esbuild");
const PORTABLE_PNPM_MAX_ATTEMPTS = 4;
const PORTABLE_PNPM_RETRY_DELAY_MS = 1_500;
const PORTABLE_PNPM_RETRYABLE_CODES = new Set(["EACCES", "EPERM"]);
const PORTABLE_RENAME_MAX_ATTEMPTS = 12;

const TEST_FILE_MARKERS = [".test.", ".spec."];
const RUNTIME_PRUNED_EXTENSIONS = new Set([
  ".d.ts",
  ".d.ts.map",
  ".js.map",
  ".ts",
  ".tsx",
]);
const PRUNED_DIRECTORY_NAMES = new Set([
  ".github",
  "__tests__",
  "bench",
  "benchmark",
  "benchmarks",
  "coverage",
  "doc",
  "docs",
  "example",
  "examples",
  "fixture",
  "fixtures",
  "spec",
  "test",
  "tests",
  "website",
]);
const PRUNED_FILE_NAMES = new Set([
  ".editorconfig",
  ".npmignore",
  ".prettierignore",
  "tsconfig.tsbuildinfo",
]);
const CONFIG_FILE_PATTERNS = [
  /^\.eslintrc(\..+)?$/i,
  /^\.prettierrc(\..+)?$/i,
  /^jest\.config\..+$/i,
  /^rollup\.config\..+$/i,
  /^tsconfig(\..+)?\.json$/i,
  /^vite\.config\..+$/i,
  /^vitest\.config\..+$/i,
  /^webpack\.config\..+$/i,
];
const DOC_FILE_PATTERNS = [
  /^authors?(\..+)?$/i,
  /^changelog(\..+)?$/i,
  /^changes(\..+)?$/i,
  /^code_of_conduct(\..+)?$/i,
  /^contributing(\..+)?$/i,
  /^history(\..+)?$/i,
  /^migration(_guide)?(\..+)?$/i,
  /^readme(\..+)?$/i,
  /^security(\..+)?$/i,
  /^upgrade(\..+)?$/i,
  /^upgrading(\..+)?$/i,
];
const LICENSE_FILE_PATTERNS = [
  /^copying(\..+)?$/i,
  /^license(\..+)?$/i,
  /^licence(\..+)?$/i,
  /^notice(\..+)?$/i,
  /^third[_-]?party[_-]?licenses?(\..+)?$/i,
];

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

function ensureWritableRecursive(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);

  if (stat.isSymbolicLink()) return;

  if (stat.isDirectory()) {
    for (const entryName of fs.readdirSync(targetPath)) {
      ensureWritableRecursive(path.join(targetPath, entryName));
    }
    try {
      fs.chmodSync(targetPath, 0o777);
    } catch {
      // Ignore chmod failures and let the final delete decide.
    }
    return;
  }

  try {
    fs.chmodSync(targetPath, 0o666);
  } catch {
    // Ignore chmod failures and let the final delete decide.
  }
}

function removePortableBuildPath(targetPath, { allowedRoots, label } = {}) {
  const resolvedTargetPath = assertPathInsideRoots(targetPath, allowedRoots ?? [], label ?? "remove portable build path");
  try {
    return guardedRemovePath(resolvedTargetPath, {
      allowedRoots: allowedRoots ?? [],
      label: label ?? "remove portable build path",
    });
  } catch (error) {
    if (process.platform !== "win32" || error?.code !== "EPERM") {
      throw error;
    }
    ensureWritableRecursive(resolvedTargetPath);
    return guardedRemovePath(resolvedTargetPath, {
      allowedRoots: allowedRoots ?? [],
      label: label ?? "remove portable build path",
    });
  }
}

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryablePortableRenameError(error) {
  return ["EPERM", "EACCES", "EBUSY"].includes(String(error?.code ?? ""));
}

function renamePortablePathWithRetry(sourcePath, targetPath) {
  for (let attempt = 1; attempt <= PORTABLE_RENAME_MAX_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      if (process.platform !== "win32" || attempt === PORTABLE_RENAME_MAX_ATTEMPTS || !isRetryablePortableRenameError(error)) {
        throw error;
      }
      sleepSync(150 * attempt);
    }
  }
}

function isBrokenSymlink(targetPath) {
  try {
    fs.statSync(targetPath);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

function archiveExistingDirectory(targetPath) {
  if (!fs.existsSync(targetPath)) return undefined;
  const archivePath = `${targetPath}.previous-${Date.now()}`;
  renamePortablePathWithRetry(targetPath, archivePath);
  return archivePath;
}

function isPortableArtifactComplete(targetPath) {
  return (
    fs.existsSync(path.join(targetPath, "version.json"))
    && fs.existsSync(path.join(targetPath, "runtime-manifest.json"))
    && fs.existsSync(path.join(targetPath, "runtime"))
    && fs.existsSync(path.join(targetPath, "launcher", "portable-entry.js"))
    && fs.existsSync(path.join(targetPath, "payload", "version.json"))
    && fs.existsSync(path.join(targetPath, "payload", "runtime-manifest.json"))
    && fs.existsSync(path.join(targetPath, "payload", "runtime-files"))
  );
}

function resetPortableBuildDir(dirPath, { allowedRoots, label } = {}) {
  const resolvedDirPath = assertPathInsideRoots(dirPath, allowedRoots ?? [], label ?? "reset portable build dir");
  removePortableBuildPath(resolvedDirPath, {
    allowedRoots: allowedRoots ?? [],
    label: label ?? "reset portable build dir",
  });
  fs.mkdirSync(resolvedDirPath, { recursive: true });
  return resolvedDirPath;
}

function cleanupPortableInstallState() {
  removePortableBuildPath(path.join(runtimeRoot, "node_modules"), {
    allowedRoots: [runtimeRoot],
    label: "cleanup portable runtime node_modules",
  });
  removePortableBuildPath(path.join(runtimeRoot, ".pnpm-store-portable"), {
    allowedRoots: [runtimeRoot],
    label: "cleanup portable runtime local pnpm store",
  });
}

function isRetryablePortablePnpmError(error) {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error);
  return [...PORTABLE_PNPM_RETRYABLE_CODES].some((code) => message.includes(code));
}

function runPortablePnpmCommandWithRetry(stepName, args) {
  let lastError;

  for (let attempt = 1; attempt <= PORTABLE_PNPM_MAX_ATTEMPTS; attempt += 1) {
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
        console.warn(`[portable] ${stepName} recovered on attempt ${attempt}/${PORTABLE_PNPM_MAX_ATTEMPTS}.`);
      }
      return;
    }

    const commandOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    lastError = new Error(`Portable dependency ${stepName} failed with exit code ${result.status ?? 1}`);
    if (
      process.platform !== "win32"
      || attempt === PORTABLE_PNPM_MAX_ATTEMPTS
      || !isRetryablePortablePnpmError(commandOutput)
    ) {
      throw lastError;
    }

    console.warn(
      `[portable] ${stepName} hit a transient Windows permission error; cleaning install state and retrying (${attempt}/${PORTABLE_PNPM_MAX_ATTEMPTS}).`,
    );
    cleanupPortableInstallState();
    sleepSync(PORTABLE_PNPM_RETRY_DELAY_MS * attempt);
  }

  throw lastError ?? new Error(`Portable dependency ${stepName} failed for an unknown reason.`);
}

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}. Run 'corepack pnpm build' first.`);
  }
}

function copyDir(src, dest, options = {}) {
  assertExists(src, "directory");
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    dereference: false,
    ...options,
  });
}

function copyFile(src, dest) {
  assertExists(src, "file");
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function writePortableRuntimeCheckScript() {
  copyFile(
    path.join(workspaceRoot, "packages", "star-sanctuary-distribution", "scripts", "portable-runtime-check.mjs"),
    path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "portable-runtime-check.js"),
  );
  copyFile(
    path.join(workspaceRoot, "packages", "star-sanctuary-distribution", "scripts", "sandbox-paths.mjs"),
    path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "sandbox-paths.mjs"),
  );
  copyFile(
    path.join(workspaceRoot, "packages", "star-sanctuary-distribution", "scripts", "runtime-dependency-report-policy.mjs"),
    path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-dependency-report-policy.mjs"),
  );
  copyFile(
    path.join(workspaceRoot, "packages", "star-sanctuary-distribution", "scripts", "runtime-dependency-module-load-policy.mjs"),
    path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-dependency-module-load-policy.mjs"),
  );
  copyFile(
    path.join(workspaceRoot, "packages", "star-sanctuary-distribution", "scripts", "runtime-native-matrix-policy.mjs"),
    path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-native-matrix-policy.mjs"),
  );
  copyFile(
    path.join(workspaceRoot, "packages", "star-sanctuary-distribution", "scripts", "runtime-dependency-target-policy.mjs"),
    path.join(runtimePackagesRoot, "star-sanctuary-distribution", "dist", "runtime-dependency-target-policy.mjs"),
  );
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeSymlinkTarget(entryPath, rawTarget) {
  const resolvedTarget = path.isAbsolute(rawTarget)
    ? path.resolve(rawTarget)
    : path.resolve(path.dirname(entryPath), rawTarget);
  return normalizeRelativePath(path.relative(path.dirname(entryPath), resolvedTarget));
}

function detectRuntimeExtension(filePath) {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".d.ts.map")) return ".d.ts.map";
  if (normalized.endsWith(".d.ts")) return ".d.ts";
  if (normalized.endsWith(".js.map")) return ".js.map";
  return path.extname(normalized);
}

function shouldPruneFileByName(fileName) {
  const normalized = fileName.toLowerCase();
  if (PRUNED_FILE_NAMES.has(normalized)) return true;
  return TEST_FILE_MARKERS.some((marker) => normalized.includes(marker));
}

function shouldPruneRuntimeMetadata(filePath) {
  return RUNTIME_PRUNED_EXTENSIONS.has(detectRuntimeExtension(filePath));
}

function isLicenseLikeFile(fileName) {
  return LICENSE_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function shouldPruneConfigFile(fileName) {
  if (PRUNED_FILE_NAMES.has(fileName.toLowerCase())) return true;
  return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function shouldPruneDocFile(fileName) {
  if (isLicenseLikeFile(fileName)) return false;
  return DOC_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function createFilteredCopyPredicate(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  return (src) => {
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink() || stat.isDirectory()) return true;
    const relativePath = normalizeRelativePath(path.relative(resolvedRoot, src));
    const fileName = path.basename(relativePath);
    return !shouldPruneFileByName(fileName) && !shouldPruneRuntimeMetadata(relativePath);
  };
}

function collectFileEntries(rootDir) {
  const entries = [];
  const stack = [path.resolve(rootDir)];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    for (const entryName of fs.readdirSync(currentDir)) {
      const entryPath = path.join(currentDir, entryName);
      const stat = fs.lstatSync(entryPath);
      const relativePath = normalizeRelativePath(path.relative(rootDir, entryPath));

      if (stat.isSymbolicLink()) {
        const rawTarget = fs.readlinkSync(entryPath);
        entries.push({
          path: relativePath,
          type: "symlink",
          target: normalizeSymlinkTarget(entryPath, rawTarget),
        });
        continue;
      }

      if (stat.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!stat.isFile()) continue;
      entries.push({
        path: relativePath,
        type: "file",
        size: stat.size,
        sha256: sha256File(entryPath),
      });
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function prunePortableRuntimeTree(rootDir) {
  const stats = {
    removedDirectories: 0,
    removedFiles: 0,
    removedSymlinks: 0,
  };
  const stack = [path.resolve(rootDir)];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    for (const entryName of fs.readdirSync(currentDir)) {
      const entryPath = path.join(currentDir, entryName);
      const stat = fs.lstatSync(entryPath);
      const normalizedName = entryName.toLowerCase();
      const relativePath = normalizeRelativePath(path.relative(rootDir, entryPath));

      if (stat.isSymbolicLink()) {
        if (isBrokenSymlink(entryPath)) {
          removePortableBuildPath(entryPath, {
            allowedRoots: [rootDir],
            label: "remove broken portable runtime symlink",
          });
          stats.removedSymlinks += 1;
        }
        continue;
      }

      if (stat.isDirectory()) {
        const isPnpmTypesPackage = normalizedName.startsWith("@types+")
          && normalizeRelativePath(path.relative(rootDir, currentDir)).endsWith("node_modules/.pnpm");
        if (isPnpmTypesPackage) {
          removePortableBuildPath(entryPath, {
            allowedRoots: [rootDir],
            label: "prune pnpm @types package from portable runtime",
          });
          stats.removedDirectories += 1;
          continue;
        }
        if (PRUNED_DIRECTORY_NAMES.has(normalizedName)) {
          removePortableBuildPath(entryPath, {
            allowedRoots: [rootDir],
            label: "prune non-runtime directory from portable runtime",
          });
          stats.removedDirectories += 1;
          continue;
        }
        stack.push(entryPath);
        continue;
      }

      if (!stat.isFile()) continue;
      const isDocFile = detectRuntimeExtension(relativePath) === ".md"
        || detectRuntimeExtension(relativePath) === ".markdown";
      const shouldPrune = shouldPruneFileByName(normalizedName)
        || shouldPruneRuntimeMetadata(relativePath)
        || shouldPruneConfigFile(entryName)
        || (isDocFile && shouldPruneDocFile(entryName));
      if (!shouldPrune) continue;
      removePortableBuildPath(entryPath, {
        allowedRoots: [rootDir],
        label: "prune non-runtime file from portable runtime",
      });
      stats.removedFiles += 1;
    }
  }

  return stats;
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
  return packageJson;
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

function copyPackage(packageName) {
  const sourceRoot = path.join(workspaceRoot, "packages", packageName);
  const destRoot = path.join(runtimePackagesRoot, packageName);

  const sourceDistRoot = path.join(sourceRoot, "dist");
  copyDir(
    sourceDistRoot,
    path.join(destRoot, "dist"),
    { filter: createFilteredCopyPredicate(sourceDistRoot) },
  );
  const packageJson = copyRuntimePackageJson(
    path.join(sourceRoot, "package.json"),
    path.join(destRoot, "package.json"),
  );
  copyPackageNonDistBinArtifacts({
    sourcePackageDir: sourceRoot,
    destinationPackageDir: destRoot,
    packageJson,
  });
}

function writeStartBat(executableName) {
  const content = [
    "@echo off",
    "setlocal",
    `\"%~dp0${executableName}\" \"%~dp0launcher\\portable-entry.js\" %*`,
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(portableRoot, "start.bat"), content, "utf-8");
}

function writeStartPs1(executableName) {
  const content = [
    "$ErrorActionPreference = 'Stop'",
    "$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path",
    `& (Join-Path $scriptDir '${executableName}') (Join-Path $scriptDir 'launcher\\portable-entry.js') @args`,
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(portableRoot, "start.ps1"), content, "utf-8");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function writePortableReadme(executableName) {
  const content = renderPortableGuide({
    executableName,
    distributionPolicy,
    mode,
  });
  fs.writeFileSync(path.join(portableRoot, "README-portable.md"), content, "utf-8");
}

function writePortableLauncher() {
  const sourceEntryPath = path.join(
    workspaceRoot,
    "packages",
    "star-sanctuary-distribution",
    "dist",
    "portable-entry.js",
  );
  const launcherEntryPath = path.join(portableLauncherRoot, "portable-entry.js");
  assertExists(sourceEntryPath, "portable launcher entry");

  const bundleResult = spawnSync(process.execPath, [
    esbuildCliPath,
    sourceEntryPath,
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--target=node22",
    `--outfile=${launcherEntryPath}`,
    "--legal-comments=none",
  ], {
    cwd: workspaceRoot,
    encoding: "utf-8",
    shell: false,
  });
  if (bundleResult.stdout) process.stdout.write(bundleResult.stdout);
  if (bundleResult.stderr) process.stderr.write(bundleResult.stderr);
  if (bundleResult.status !== 0) {
    throw new Error(`Portable launcher bundle failed with exit code ${bundleResult.status ?? 1}`);
  }

  fs.writeFileSync(
    path.join(portableLauncherRoot, "package.json"),
    `${JSON.stringify({
      name: "star-sanctuary-portable-launcher",
      private: true,
      type: "module",
    }, null, 2)}\n`,
    "utf-8",
  );
}

function writeRuntimeManifest(dependencySnapshot) {
  const entries = collectFileEntries(runtimeRoot);
  const fileEntries = entries.filter((entry) => entry.type === "file");
  const payload = {
    productName: "Star Sanctuary",
    version,
    distributionMode: mode,
    platform,
    arch,
    builtAt: new Date().toISOString(),
    includeOptionalNative,
    distributionPolicy,
    dependencySnapshot,
    runtimeDir: "runtime",
    summary: {
      fileCount: fileEntries.length,
      totalSize: fileEntries.reduce((sum, entry) => sum + entry.size, 0),
    },
    files: entries,
  };
  fs.writeFileSync(runtimeManifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return {
    path: "runtime-manifest.json",
    size: fs.statSync(runtimeManifestPath).size,
    sha256: sha256File(runtimeManifestPath),
    summary: payload.summary,
    entries,
  };
}

function writeVersionFile(executableName, runtimeManifest, pruneStats, dependencySnapshot) {
  const executablePath = path.join(portableRoot, executableName);
  const startBatPath = path.join(portableRoot, "start.bat");
  const startPs1Path = path.join(portableRoot, "start.ps1");
  const payload = {
    productName: "Star Sanctuary",
    version,
    distributionMode: mode,
    platform,
    arch,
    builtAt: new Date().toISOString(),
    includeOptionalNative,
    distributionPolicy,
    dependencySnapshot,
    runtimeDir: "runtime",
    entryScript: "runtime/packages/star-sanctuary-distribution/dist/portable-entry.js",
    runtimeSummary: runtimeManifest.summary,
    pruned: pruneStats,
    files: {
      executable: {
        path: executableName,
        size: fs.statSync(executablePath).size,
        sha256: sha256File(executablePath),
      },
      startBat: {
        path: "start.bat",
        size: fs.statSync(startBatPath).size,
        sha256: sha256File(startBatPath),
      },
      startPs1: {
        path: "start.ps1",
        size: fs.statSync(startPs1Path).size,
        sha256: sha256File(startPs1Path),
      },
      runtimeManifest: {
        path: runtimeManifest.path,
        size: runtimeManifest.size,
        sha256: runtimeManifest.sha256,
      },
      readme: {
        path: "README-portable.md",
        size: fs.statSync(path.join(portableRoot, "README-portable.md")).size,
        sha256: sha256File(path.join(portableRoot, "README-portable.md")),
      },
    },
  };
  fs.writeFileSync(path.join(portableRoot, "version.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function writePortableRecoveryPayload(runtimeManifest) {
  resetPortableBuildDir(portableRecoveryPayloadRoot, {
    allowedRoots: [portableRoot],
    label: "reset portable recovery payload root",
  });
  copyFile(path.join(portableRoot, "version.json"), path.join(portableRecoveryPayloadRoot, "version.json"));
  copyFile(runtimeManifestPath, path.join(portableRecoveryPayloadRoot, "runtime-manifest.json"));

  let compressedFiles = 0;
  let compressedBytes = 0;
  for (const entry of runtimeManifest.entries) {
    if (entry.type !== "file") continue;
    const sourcePath = path.join(runtimeRoot, ...entry.path.split("/"));
    const compressedPath = path.join(
      portableRecoveryPayloadRoot,
      "runtime-files",
      ...entry.path.split("/"),
    ) + ".gz";
    ensureDir(path.dirname(compressedPath));
    const compressedBuffer = gzipSync(fs.readFileSync(sourcePath), { level: 9 });
    fs.writeFileSync(compressedPath, compressedBuffer);
    compressedFiles += 1;
    compressedBytes += compressedBuffer.length;
  }

  return {
    compressedFiles,
    compressedBytes,
  };
}

function copyNodeRuntime() {
  const nodePath = process.execPath;
  const extension = platform === "win32" ? ".exe" : "";
  const executableName = `star-sanctuary${extension}`;
  copyFile(nodePath, path.join(portableRoot, executableName));
  return executableName;
}

function installRuntimeDependencies() {
  removePortableBuildPath(path.join(runtimeRoot, ".pnpm-store-portable"), {
    allowedRoots: [runtimeRoot],
    label: "reset portable runtime local pnpm store",
  });
  const installArgs = createRuntimeDependencyInstallArgs({
    includeOptionalNative,
    storeDir: portablePnpmStoreDir,
  });
  runPortablePnpmCommandWithRetry("install", installArgs);
}

async function readVerifiedRuntimeDependencySnapshot() {
  if (
    !fs.existsSync(portablePrefetchSnapshotPath)
    || !fs.existsSync(portablePrefetchLockfilePath)
    || !fs.existsSync(portablePnpmStoreDir)
  ) {
    throw new Error(
      `Portable dependency snapshot is missing for mode=${mode}. `
      + `Run 'corepack pnpm prefetch:portable${mode === "full" ? ":full" : ""}' before building.`,
    );
  }

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(portablePrefetchSnapshotPath, "utf-8"));
  } catch {
    throw new Error(`Portable dependency snapshot descriptor is invalid for mode=${mode}. Run prefetch again.`);
  }
  resolveRuntimeBuildScriptPolicy({ cwd: portablePrefetchRuntimeRoot, mode });
  const runtimeLockfile = fs.readFileSync(portablePrefetchLockfilePath);
  const runtimeWorkspaceConfig = fs.readFileSync(
    path.join(portablePrefetchRuntimeRoot, "pnpm-workspace.yaml"),
  );
  const storeSnapshot = await createRuntimeDependencyStoreSnapshot(portablePnpmStoreDir);
  assertRuntimeDependencySnapshot(snapshot, {
    target: {
      mode,
      platform,
      arch,
      nodeAbi: process.versions.modules,
    },
    sourceLockfile: fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml")),
    runtimeLockfile,
    runtimeWorkspaceConfig,
    storeSnapshot,
  });
  return {
    runtimeLockfile,
    runtimeWorkspaceConfig,
    artifactIdentity: createRuntimeDependencySnapshotArtifactIdentity(snapshot),
  };
}

function wireSqliteVecPlatformPackage() {
  const sqliteVecRoot = fs.realpathSync(
    path.join(runtimePackagesRoot, "belldandy-memory", "node_modules", "sqlite-vec"),
  );
  const sqliteVecPlatformRoot = fs.realpathSync(path.join(runtimeRoot, "node_modules", "sqlite-vec-windows-x64"));
  const sqliteVecPeerDir = path.join(path.dirname(sqliteVecRoot), "sqlite-vec-windows-x64");

  resetPortableBuildDir(sqliteVecPeerDir, {
    allowedRoots: [runtimeRoot],
    label: "reset sqlite-vec peer package dir",
  });
  copyDir(sqliteVecPlatformRoot, sqliteVecPeerDir);
}

function prunePortableRuntime() {
  const runtimePackageStats = prunePortableRuntimeTree(runtimePackagesRoot);
  const runtimeNodeModulesPath = path.join(runtimeRoot, "node_modules");
  const runtimeNodeModuleStats = fs.existsSync(runtimeNodeModulesPath)
    ? prunePortableRuntimeTree(runtimeNodeModulesPath)
    : { removedDirectories: 0, removedFiles: 0, removedSymlinks: 0 };
  return {
    removedDirectories: runtimePackageStats.removedDirectories + runtimeNodeModuleStats.removedDirectories,
    removedFiles: runtimePackageStats.removedFiles + runtimeNodeModuleStats.removedFiles,
    removedSymlinks: runtimePackageStats.removedSymlinks + runtimeNodeModuleStats.removedSymlinks,
  };
}

async function main() {
  if (platform !== "win32") {
    throw new Error(`Portable build currently only targets Windows. Current platform: ${platform}`);
  }
  const runtimeDependencySnapshot = await readVerifiedRuntimeDependencySnapshot();

  ensureDir(portableArtifactsRoot);
  let archivedPortableRoot;
  if (fs.existsSync(portableRoot)) {
    if (isPortableArtifactComplete(portableRoot)) {
      archivedPortableRoot = archiveExistingDirectory(portableRoot);
    } else {
      removePortableBuildPath(portableRoot, {
        allowedRoots: [portableArtifactsRoot],
        label: "remove incomplete portable artifact root",
      });
    }
  }
  try {
    resetPortableBuildDir(portableRoot, {
      allowedRoots: [portableArtifactsRoot],
      label: "reset portable artifact root",
    });
    ensureDir(portableLauncherRoot);
    ensureDir(runtimeRoot);
    ensureDir(runtimePackagesRoot);
    ensureDir(runtimeAppsRoot);

    writeRuntimePackageJson();
    fs.writeFileSync(
      path.join(runtimeRoot, "pnpm-workspace.yaml"),
      runtimeDependencySnapshot.runtimeWorkspaceConfig,
    );
    fs.writeFileSync(
      path.join(runtimeRoot, "pnpm-lock.yaml"),
      runtimeDependencySnapshot.runtimeLockfile,
    );
    copyRuntimeDependencyPatches();

    for (const packageName of packageNames) {
      copyPackage(packageName);
    }
    writePortableRuntimeCheckScript();

    copyDir(
      path.join(workspaceRoot, "packages", "belldandy-agent", "dist", "templates"),
      path.join(runtimeRoot, "templates"),
    );
    copyDir(
      path.join(workspaceRoot, "packages", "star-sanctuary-distribution", "src", "templates", "default-env"),
      path.join(runtimeRoot, "templates", "default-env"),
    );
    copyDir(
      path.join(workspaceRoot, "packages", "belldandy-skills", "src", "bundled-skills"),
      path.join(runtimeRoot, "bundled-skills"),
    );
    copyDir(
      path.join(workspaceRoot, "apps", "web", "public"),
      path.join(runtimeAppsRoot, "web", "public"),
    );
    copyFile(
      path.join(workspaceRoot, "apps", "web", "package.json"),
      path.join(runtimeAppsRoot, "web", "package.json"),
    );
    copyFile(
      path.join(workspaceRoot, ".env.example"),
      path.join(portableRoot, ".env.example"),
    );

    installRuntimeDependencies();
    wireSqliteVecPlatformPackage();
    const pruneStats = prunePortableRuntime();

    const executableName = copyNodeRuntime();
    writePortableLauncher();
    writePortableReadme(executableName);
    writeStartBat(executableName);
    writeStartPs1(executableName);
    const runtimeManifest = writeRuntimeManifest(runtimeDependencySnapshot.artifactIdentity);
    writeVersionFile(
      executableName,
      runtimeManifest,
      pruneStats,
      runtimeDependencySnapshot.artifactIdentity,
    );
    const recoveryPayload = writePortableRecoveryPayload(runtimeManifest);

    if (archivedPortableRoot) {
      try {
        removePortableBuildPath(archivedPortableRoot, {
          allowedRoots: [portableArtifactsRoot],
          label: "cleanup archived portable artifact root",
        });
      } catch (error) {
        console.warn(`[portable] Failed to remove previous portable artifact: ${archivedPortableRoot} (${String(error)})`);
      }
    }

    console.log(
      `[portable] Built Star Sanctuary portable runtime at ${portableRoot} (${includeOptionalNative ? "full" : "slim"} mode, pruned ${pruneStats.removedDirectories} dirs / ${pruneStats.removedFiles} files / ${pruneStats.removedSymlinks} symlinks, recovery payload ${recoveryPayload.compressedFiles} files / ${recoveryPayload.compressedBytes} bytes)`,
    );
  } catch (error) {
    try {
      removePortableBuildPath(portableRoot, {
        allowedRoots: [portableArtifactsRoot],
        label: "cleanup failed portable artifact root",
      });
    } catch {
      // Best effort cleanup only.
    }
    if (archivedPortableRoot) {
      fs.renameSync(archivedPortableRoot, portableRoot);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
