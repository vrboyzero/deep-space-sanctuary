import fs from "node:fs";
import path from "node:path";

import { assertPathInsideRoots, assertSafeSingleExeRuntimeVersionDirInfo, guardedRemovePath } from "./sandbox-paths.js";

type CleanupResult = {
  removedVersionDirs: string[];
  removedTempDirs: string[];
  skippedPaths: Array<{ path: string; reason: string }>;
};

type RuntimeActivityMarker = {
  pid: number;
  productName?: string;
  versionKey?: string;
  startedAt: string;
  updatedAt: string;
};

const TEMP_DIR_PATTERNS = [
  { pattern: /\.staging-(\d+)-(\d+)$/, timestampGroup: 2 },
  { pattern: /\.corrupt-(\d+)$/, timestampGroup: 1 },
];
const DEFAULT_KEEP_VERSION_COUNT = 2;
const DEFAULT_TEMP_DIR_MIN_AGE_MS = 5 * 60 * 1000;
const RUNTIME_ACTIVITY_MARKER_FILE = ".runtime-active.json";

function removeRuntimePath(targetPath: string, allowedRoots: string[], label: string): string {
  return guardedRemovePath(targetPath, allowedRoots, label);
}

function isTempRuntimeDir(entryName: string): boolean {
  return TEMP_DIR_PATTERNS.some(({ pattern }) => pattern.test(entryName));
}

function safeStatMtimeMs(targetPath: string): number {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function getRuntimeActivityMarkerPath(versionRootDir: string): string {
  return path.join(versionRootDir, RUNTIME_ACTIVITY_MARKER_FILE);
}

function resolveTempDirTimestampMs(entryName: string, entryPath: string): number {
  for (const { pattern, timestampGroup } of TEMP_DIR_PATTERNS) {
    const match = entryName.match(pattern);
    if (!match) continue;
    const rawTimestamp = Number(match[timestampGroup]);
    if (Number.isFinite(rawTimestamp) && rawTimestamp > 0) {
      return rawTimestamp;
    }
  }
  return safeStatMtimeMs(entryPath);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    return false;
  }
}

function readRuntimeActivityMarker(versionRootDir: string): RuntimeActivityMarker | undefined {
  const markerPath = getRuntimeActivityMarkerPath(versionRootDir);
  if (!fs.existsSync(markerPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(markerPath, "utf-8")) as RuntimeActivityMarker;
  } catch {
    return undefined;
  }
}

export function writeSingleExeRuntimeActivityMarker(params: {
  versionRootDir: string;
  pid?: number;
  productName?: string;
  versionKey?: string;
}): string {
  const versionRootDir = path.resolve(params.versionRootDir);
  const markerPath = getRuntimeActivityMarkerPath(versionRootDir);
  const now = new Date().toISOString();
  const payload: RuntimeActivityMarker = {
    pid: params.pid ?? process.pid,
    productName: params.productName,
    versionKey: params.versionKey,
    startedAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return markerPath;
}

export function removeSingleExeRuntimeActivityMarker(versionRootDir: string): void {
  removeRuntimePath(
    getRuntimeActivityMarkerPath(path.resolve(versionRootDir)),
    [path.resolve(versionRootDir)],
    "remove single-exe runtime activity marker",
  );
}

export function cleanupSingleExeRuntimeDirs(params: {
  runtimeBaseDir: string;
  currentVersionRootDir: string;
  appHomeDir: string;
  productName?: string;
  keepVersionCount?: number;
  tempDirMinAgeMs?: number;
}): CleanupResult {
  assertSafeSingleExeRuntimeVersionDirInfo({
    appHomeDir: params.appHomeDir,
    runtimeBaseDir: params.runtimeBaseDir,
    versionKey: path.basename(params.currentVersionRootDir),
    versionRootDir: params.currentVersionRootDir,
    runtimeDir: path.join(params.currentVersionRootDir, "runtime"),
    versionFilePath: path.join(params.currentVersionRootDir, "version.json"),
    runtimeManifestPath: path.join(params.currentVersionRootDir, "runtime-manifest.json"),
  }, {
    productName: params.productName,
  });

  const runtimeBaseDir = path.resolve(params.runtimeBaseDir);
  const currentVersionRootDir = assertPathInsideRoots(
    params.currentVersionRootDir,
    [runtimeBaseDir],
    "use current single-exe runtime version root",
  );
  const keepVersionCount = Math.max(1, params.keepVersionCount ?? DEFAULT_KEEP_VERSION_COUNT);
  const tempDirMinAgeMs = Math.max(0, params.tempDirMinAgeMs ?? DEFAULT_TEMP_DIR_MIN_AGE_MS);
  const result: CleanupResult = {
    removedVersionDirs: [],
    removedTempDirs: [],
    skippedPaths: [],
  };

  if (!fs.existsSync(runtimeBaseDir)) {
    return result;
  }

  const versionDirs: string[] = [];
  for (const entryName of fs.readdirSync(runtimeBaseDir)) {
    const entryPath = path.join(runtimeBaseDir, entryName);
    let stat: fs.Stats;

    try {
      stat = fs.lstatSync(entryPath);
    } catch (error) {
      result.skippedPaths.push({
        path: entryPath,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!stat.isDirectory()) continue;

    if (isTempRuntimeDir(entryName)) {
      const tempDirTimestampMs = resolveTempDirTimestampMs(entryName, entryPath);
      if (Date.now() - tempDirTimestampMs < tempDirMinAgeMs) {
        result.skippedPaths.push({
          path: entryPath,
          reason: "temp_dir_is_recent",
        });
        continue;
      }
      try {
        removeRuntimePath(entryPath, [runtimeBaseDir], "clean single-exe temp runtime dir");
        result.removedTempDirs.push(entryPath);
      } catch (error) {
        result.skippedPaths.push({
          path: entryPath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    versionDirs.push(entryPath);
  }

  const previousVersionDirs = versionDirs
    .filter((entryPath) => path.resolve(entryPath) !== currentVersionRootDir)
    .sort((a, b) => safeStatMtimeMs(b) - safeStatMtimeMs(a))
    .map((entryPath) => {
      const activityMarker = readRuntimeActivityMarker(entryPath);
      const isActive = Boolean(activityMarker?.pid && isProcessAlive(activityMarker.pid));
      return {
        entryPath,
        activityMarker,
        isActive,
      };
    });

  const removableVersionDirs: Array<{
    entryPath: string;
    activityMarker: RuntimeActivityMarker | undefined;
  }> = [];
  let keptInactiveVersionCount = 0;
  for (const versionDir of previousVersionDirs) {
    if (versionDir.isActive) {
      result.skippedPaths.push({
        path: versionDir.entryPath,
        reason: `runtime_version_in_use:${versionDir.activityMarker?.pid}`,
      });
      continue;
    }

    if (keptInactiveVersionCount < Math.max(0, keepVersionCount - 1)) {
      keptInactiveVersionCount += 1;
      continue;
    }

    removableVersionDirs.push({
      entryPath: versionDir.entryPath,
      activityMarker: versionDir.activityMarker,
    });
  }

  for (const { entryPath } of removableVersionDirs) {
    try {
      removeRuntimePath(entryPath, [runtimeBaseDir], "clean stale single-exe runtime version dir");
      result.removedVersionDirs.push(entryPath);
    } catch (error) {
      result.skippedPaths.push({
        path: entryPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
