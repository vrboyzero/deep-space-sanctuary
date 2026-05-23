import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  readPortableVersionFile,
  readRuntimeManifest,
  resolveRuntimePayloadPaths,
  validateInstalledRuntimeVersion,
  type PortableVersionFile,
  type RuntimeManifest,
  type RuntimeManifestFileEntry,
} from "./runtime-manifest.js";
import { assertPathInsideRoots, assertSafeSingleExeRuntimeVersionDirInfo, guardedRemovePath } from "./sandbox-paths.js";
import { resolveRuntimeVersionDirInfo, type RuntimeVersionDirInfo } from "./runtime-version-dir.js";
import { getSeaModule, isSeaRuntime } from "./sea.js";

export type EnsureSingleExeRuntimeParams = {
  payloadRoot: string;
  env?: NodeJS.ProcessEnv;
  appHomeDir?: string;
};

export type EnsuredSingleExeRuntime = {
  extracted: boolean;
  versionFile: PortableVersionFile;
  versionDirInfo: RuntimeVersionDirInfo;
  payloadPaths?: ReturnType<typeof resolveRuntimePayloadPaths>;
};

export type EnsureSingleExeRuntimeFromSeaParams = {
  env?: NodeJS.ProcessEnv;
  appHomeDir?: string;
};

type DeferredDirectoryLink = {
  linkPath: string;
  targetPath: string;
  relativeTargetPath: string;
  relativePath: string;
};

type RuntimeCopyStats = {
  copiedFiles: number;
  copiedDirectories: number;
  copiedSymlinkFiles: number;
  deferredDirectoryLinks: number;
  skippedBrokenSymlinks: number;
};

type RuntimeSymlinkEntry = {
  linkPath: string;
  targetPath: string;
  relativeTargetPath: string;
};

const SINGLE_EXE_SEA_VERSION_ASSET_KEY = "portable/version.json";
const SINGLE_EXE_SEA_RUNTIME_MANIFEST_ASSET_KEY = "portable/runtime-manifest.json";
const SINGLE_EXE_SEA_RUNTIME_ASSET_PREFIX = "portable/runtime/";
export const SINGLE_EXE_NODE_RUNTIME_FILE_NAME = process.platform === "win32" ? "node-runtime.exe" : "node-runtime";
const SINGLE_EXE_SEA_NODE_RUNTIME_ASSET_KEY = `portable/${SINGLE_EXE_NODE_RUNTIME_FILE_NAME}.gz`;

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeRuntimePath(targetPath: string, allowedRoots: string[], label: string): string {
  return guardedRemovePath(targetPath, allowedRoots, label);
}

function assertRuntimePath(targetPath: string, allowedRoots: string[], label: string): string {
  return assertPathInsideRoots(targetPath, allowedRoots, label);
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function hasNativeArtifacts(targetPath: string): boolean {
  try {
    for (const entryName of fs.readdirSync(targetPath)) {
      const entryPath = path.join(targetPath, entryName);
      const stat = fs.statSync(entryPath);
      if (stat.isDirectory()) continue;
      const normalized = entryName.toLowerCase();
      if (normalized.endsWith(".node") || normalized.endsWith(".dll") || normalized.endsWith(".exe")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function orderWindowsRuntimeSymlinks<T extends { targetPath: string }>(runtimeSymlinks: T[]): T[] {
  if (process.platform !== "win32" || runtimeSymlinks.length <= 1) {
    return runtimeSymlinks;
  }

  return [...runtimeSymlinks].sort((left, right) => {
    const leftScore = hasNativeArtifacts(left.targetPath) ? 1 : 0;
    const rightScore = hasNativeArtifacts(right.targetPath) ? 1 : 0;
    return leftScore - rightScore;
  });
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveManifestSymlinkMap(entries: RuntimeManifestFileEntry[]): Map<string, RuntimeManifestFileEntry> {
  return new Map(
    entries
      .filter((entry) => entry.type === "symlink")
      .map((entry) => [normalizeRelativePath(entry.path), entry]),
  );
}

function resolveDeferredDirectoryLink(params: {
  symlinkEntry: RuntimeManifestFileEntry | undefined;
  sourceEntryPath: string;
  sourceRootDir: string;
  targetRootDir: string;
}): DeferredDirectoryLink {
  const { symlinkEntry, sourceEntryPath, sourceRootDir, targetRootDir } = params;
  const relativePath = normalizeRelativePath(path.relative(sourceRootDir, sourceEntryPath));
  const rawTarget = symlinkEntry?.target ?? fs.readlinkSync(sourceEntryPath);
  const resolvedSourceTarget = path.isAbsolute(rawTarget)
    ? path.resolve(rawTarget)
    : path.resolve(path.dirname(sourceEntryPath), rawTarget);

  if (!isWithinRoot(resolvedSourceTarget, sourceRootDir)) {
    throw new Error(`Single-exe runtime symlink escapes payload runtime: ${relativePath} -> ${rawTarget}`);
  }

  const linkPath = path.join(targetRootDir, relativePath);
  const targetPath = path.join(targetRootDir, path.relative(sourceRootDir, resolvedSourceTarget));

  return {
    linkPath,
    targetPath,
    relativeTargetPath: path.relative(path.dirname(linkPath), targetPath),
    relativePath,
  };
}

function copyRuntimeTree(params: {
  sourceRootDir: string;
  targetRootDir: string;
  symlinkEntryMap: Map<string, RuntimeManifestFileEntry>;
}): {
  stats: RuntimeCopyStats;
  deferredDirectoryLinks: DeferredDirectoryLink[];
} {
  const { sourceRootDir, targetRootDir, symlinkEntryMap } = params;
  const deferredDirectoryLinks: DeferredDirectoryLink[] = [];
  const stats: RuntimeCopyStats = {
    copiedFiles: 0,
    copiedDirectories: 0,
    copiedSymlinkFiles: 0,
    deferredDirectoryLinks: 0,
    skippedBrokenSymlinks: 0,
  };

  function visitDirectory(currentSourceDir: string, currentTargetDir: string): void {
    ensureDir(currentTargetDir);
    stats.copiedDirectories += 1;

    for (const entryName of fs.readdirSync(currentSourceDir)) {
      const sourceEntryPath = path.join(currentSourceDir, entryName);
      const targetEntryPath = path.join(currentTargetDir, entryName);
      const sourceStat = fs.lstatSync(sourceEntryPath);

      if (sourceStat.isSymbolicLink()) {
        const relativePath = normalizeRelativePath(path.relative(sourceRootDir, sourceEntryPath));
        let targetStat: fs.Stats;

        try {
          targetStat = fs.statSync(sourceEntryPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            stats.skippedBrokenSymlinks += 1;
            continue;
          }
          throw error;
        }

        if (targetStat.isDirectory()) {
          deferredDirectoryLinks.push(
            resolveDeferredDirectoryLink({
              symlinkEntry: symlinkEntryMap.get(relativePath),
              sourceEntryPath,
              sourceRootDir,
              targetRootDir,
            }),
          );
          stats.deferredDirectoryLinks += 1;
          continue;
        }

        ensureDir(path.dirname(targetEntryPath));
        fs.copyFileSync(sourceEntryPath, targetEntryPath);
        stats.copiedSymlinkFiles += 1;
        continue;
      }

      if (sourceStat.isDirectory()) {
        visitDirectory(sourceEntryPath, targetEntryPath);
        continue;
      }

      if (!sourceStat.isFile()) continue;

      ensureDir(path.dirname(targetEntryPath));
      fs.copyFileSync(sourceEntryPath, targetEntryPath);
      stats.copiedFiles += 1;
    }
  }

  visitDirectory(sourceRootDir, targetRootDir);

  return {
    stats,
    deferredDirectoryLinks,
  };
}

function materializeDirectoryLinks(directoryLinks: DeferredDirectoryLink[], versionRootDir: string): void {
  const symlinkType: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";

  for (const directoryLink of orderWindowsRuntimeSymlinks(directoryLinks)) {
    const linkPath = assertRuntimePath(directoryLink.linkPath, [versionRootDir], "materialize single-exe runtime directory link");
    const targetPath = assertRuntimePath(directoryLink.targetPath, [versionRootDir], "use single-exe runtime directory link target");
    ensureDir(path.dirname(linkPath));
    removeRuntimePath(linkPath, [versionRootDir], "replace single-exe runtime directory link");
    if (process.platform === "win32") {
      createWindowsJunctionWithRetry({
        ...directoryLink,
        linkPath,
        targetPath,
      }, versionRootDir, "retry single-exe runtime directory link");
      continue;
    }
    fs.symlinkSync(directoryLink.relativeTargetPath, linkPath, symlinkType);
  }
}

function materializeRuntimeSymlinks(runtimeSymlinks: RuntimeSymlinkEntry[], versionRootDir: string): void {
  const symlinkType: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";

  for (const runtimeSymlink of orderWindowsRuntimeSymlinks(runtimeSymlinks)) {
    const linkPath = assertRuntimePath(runtimeSymlink.linkPath, [versionRootDir], "materialize single-exe runtime symlink");
    const targetPath = assertRuntimePath(runtimeSymlink.targetPath, [versionRootDir], "use single-exe runtime symlink target");
    ensureDir(path.dirname(linkPath));
    removeRuntimePath(linkPath, [versionRootDir], "replace single-exe runtime symlink");
    if (process.platform === "win32") {
      createWindowsJunctionWithRetry({
        ...runtimeSymlink,
        linkPath,
        targetPath,
      }, versionRootDir, "retry single-exe runtime symlink");
      continue;
    }
    fs.symlinkSync(runtimeSymlink.relativeTargetPath, linkPath, symlinkType);
  }
}

function isRetryableWindowsJunctionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("access is denied")
    || message.includes("eperm")
    || message.includes("eacces")
    || message.includes("ebusy")
  );
}

function createWindowsJunctionWithRetry(
  params: RuntimeSymlinkEntry | DeferredDirectoryLink,
  versionRootDir: string,
  label: string,
): void {
  const { linkPath, targetPath } = params;
  const maxAttempts = 16;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.symlinkSync(targetPath, linkPath, "junction");
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableWindowsJunctionError(error)) {
        if (isRetryableWindowsJunctionError(error) && canFallbackToDirectoryCopy(targetPath)) {
          materializeDirectoryCopyFallback({
            linkPath,
            targetPath,
            versionRootDir,
            label,
          });
          return;
        }
        throw error;
      }
      removeRuntimePath(linkPath, [versionRootDir], label);
      sleepSync(250 * attempt);
    }
  }
}

function canFallbackToDirectoryCopy(targetPath: string): boolean {
  if (process.platform !== "win32") return false;
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function materializeDirectoryCopyFallback(params: {
  linkPath: string;
  targetPath: string;
  versionRootDir: string;
  label: string;
}): void {
  const { linkPath, targetPath, versionRootDir, label } = params;
  removeRuntimePath(linkPath, [versionRootDir], label);
  ensureDir(path.dirname(linkPath));
  fs.cpSync(targetPath, linkPath, {
    recursive: true,
    force: true,
    dereference: false,
  });
  logSingleExeExtract(`Fell back to directory copy for Windows runtime link: ${linkPath}`);
}

function logSingleExeExtract(message: string): void {
  console.log(`[Star Sanctuary Single-Exe] ${message}`);
}

function copyPayloadToStage(params: {
  stageDir: string;
  payloadPaths: ReturnType<typeof resolveRuntimePayloadPaths>;
  finalVersionDirInfo: RuntimeVersionDirInfo;
}): {
  stats: RuntimeCopyStats;
  deferredDirectoryLinks: DeferredDirectoryLink[];
} {
  const { stageDir, payloadPaths, finalVersionDirInfo } = params;
  const runtimeManifest = readRuntimeManifest(payloadPaths.payloadRoot);
  const symlinkEntryMap = resolveManifestSymlinkMap(runtimeManifest.files);
  const runtimeDirRelativePath = path.relative(
    finalVersionDirInfo.versionRootDir,
    finalVersionDirInfo.runtimeDir,
  );
  const stageRuntimeDir = path.join(stageDir, runtimeDirRelativePath);
  ensureDir(stageDir);
  fs.copyFileSync(payloadPaths.versionFilePath, path.join(stageDir, "version.json"));
  fs.copyFileSync(payloadPaths.runtimeManifestPath, path.join(stageDir, "runtime-manifest.json"));
  return copyRuntimeTree({
    sourceRootDir: payloadPaths.runtimeSourceDir,
    targetRootDir: stageRuntimeDir,
    symlinkEntryMap,
  });
}

function getSeaAssetText(assetKey: string): string {
  const sea = getSeaModule();
  if (!sea) {
    throw new Error("node:sea is unavailable in the current process.");
  }
  const value = sea.getAsset(assetKey, "utf8");
  return typeof value === "string" ? value : bufferFromSeaAsset(value).toString("utf8");
}

function getSeaAssetBuffer(assetKey: string): Buffer {
  const sea = getSeaModule();
  if (!sea) {
    throw new Error("node:sea is unavailable in the current process.");
  }
  return bufferFromSeaAsset(sea.getRawAsset(assetKey));
}

function bufferFromSeaAsset(value: ArrayBuffer | ArrayBufferView): Buffer {
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.from(value);
}

function resolveManifestSymlinkTargetPath(params: {
  linkPath: string;
  target: string;
  runtimeRootDir: string;
  runtimeDirName: string;
}): string {
  const { linkPath, target, runtimeRootDir, runtimeDirName } = params;
  if (path.isAbsolute(target)) {
    const normalizedTarget = target.replace(/\\/g, "/");
    const runtimeMarker = `/${runtimeDirName}/`;
    const runtimeIndex = normalizedTarget.lastIndexOf(runtimeMarker);
    if (runtimeIndex >= 0) {
      const runtimeRelativePath = normalizedTarget.slice(runtimeIndex + runtimeMarker.length);
      return path.join(runtimeRootDir, ...runtimeRelativePath.split("/"));
    }
  }

  return path.resolve(path.dirname(linkPath), target);
}

function copySeaPayloadToStage(params: {
  stageDir: string;
  versionFile: PortableVersionFile;
  runtimeManifest: RuntimeManifest;
}): {
  stats: RuntimeCopyStats;
  runtimeSymlinks: RuntimeSymlinkEntry[];
} {
  const { stageDir, versionFile, runtimeManifest } = params;
  const stageRuntimeDir = path.join(stageDir, versionFile.runtimeDir);
  const stats: RuntimeCopyStats = {
    copiedFiles: 0,
    copiedDirectories: 0,
    copiedSymlinkFiles: 0,
    deferredDirectoryLinks: 0,
    skippedBrokenSymlinks: 0,
  };
  const runtimeSymlinks: RuntimeSymlinkEntry[] = [];

  ensureDir(stageDir);
  ensureDir(stageRuntimeDir);
  fs.writeFileSync(path.join(stageDir, "version.json"), getSeaAssetText(SINGLE_EXE_SEA_VERSION_ASSET_KEY), "utf-8");
  fs.writeFileSync(
    path.join(stageDir, "runtime-manifest.json"),
    getSeaAssetText(SINGLE_EXE_SEA_RUNTIME_MANIFEST_ASSET_KEY),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(stageDir, SINGLE_EXE_NODE_RUNTIME_FILE_NAME),
    gunzipSync(getSeaAssetBuffer(SINGLE_EXE_SEA_NODE_RUNTIME_ASSET_KEY)),
  );

  for (const entry of runtimeManifest.files) {
    const destinationPath = path.join(stageRuntimeDir, ...entry.path.split("/"));

    if (entry.type === "file") {
      ensureDir(path.dirname(destinationPath));
      fs.writeFileSync(
        destinationPath,
        getSeaAssetBuffer(`${SINGLE_EXE_SEA_RUNTIME_ASSET_PREFIX}${entry.path}`),
      );
      stats.copiedFiles += 1;
      continue;
    }

    runtimeSymlinks.push({
      linkPath: destinationPath,
      targetPath: resolveManifestSymlinkTargetPath({
        linkPath: destinationPath,
        target: entry.target ?? "",
        runtimeRootDir: stageRuntimeDir,
        runtimeDirName: runtimeManifest.runtimeDir,
      }),
      relativeTargetPath: path.relative(
        path.dirname(destinationPath),
        resolveManifestSymlinkTargetPath({
          linkPath: destinationPath,
          target: entry.target ?? "",
          runtimeRootDir: stageRuntimeDir,
          runtimeDirName: runtimeManifest.runtimeDir,
        }),
      ),
    });
    stats.deferredDirectoryLinks += 1;
  }

  return {
    stats,
    runtimeSymlinks,
  };
}

function rebuildVersionDirWithRollback(params: {
  versionRootDir: string;
  runtimeBaseDir: string;
  rebuild: () => void;
}): void {
  const runtimeBaseDir = path.resolve(params.runtimeBaseDir);
  const versionRootDir = assertRuntimePath(params.versionRootDir, [runtimeBaseDir], "use single-exe runtime version root");
  const rebuild = params.rebuild;
  const backupDir = assertRuntimePath(`${versionRootDir}.corrupt-${Date.now()}`, [runtimeBaseDir], "use single-exe runtime backup dir");
  const hadExistingVersionDir = fs.existsSync(versionRootDir);

  if (hadExistingVersionDir) {
    fs.renameSync(versionRootDir, backupDir);
  }

  try {
    removeRuntimePath(versionRootDir, [runtimeBaseDir], "reset single-exe runtime version root");
    rebuild();
  } catch (error) {
    try {
      if (fs.existsSync(versionRootDir)) {
        removeRuntimePath(versionRootDir, [runtimeBaseDir], "cleanup failed single-exe runtime version root");
      }
    } catch {
      // Best effort cleanup before rollback.
    }

    if (hadExistingVersionDir && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, versionRootDir);
    }
    throw error;
  }

  if (hadExistingVersionDir && fs.existsSync(backupDir)) {
    try {
      removeRuntimePath(backupDir, [runtimeBaseDir], "cleanup single-exe runtime backup dir");
    } catch {
      // Best effort cleanup only.
    }
  }
}

export function ensureSingleExeRuntime(params: EnsureSingleExeRuntimeParams): EnsuredSingleExeRuntime {
  const env = params.env ?? process.env;
  const payloadPaths = resolveRuntimePayloadPaths(params.payloadRoot);
  const versionFile = readPortableVersionFile(params.payloadRoot);
  const runtimeManifest = readRuntimeManifest(params.payloadRoot);
  const versionDirInfo = resolveRuntimeVersionDirInfo(versionFile, {
    env,
    appHomeDir: params.appHomeDir,
  });
  assertSafeSingleExeRuntimeVersionDirInfo(versionDirInfo, {
    env,
    productName: versionFile.productName,
  });

  ensureDir(versionDirInfo.runtimeBaseDir);

  const validation = validateInstalledRuntimeVersion({
    versionRoot: versionDirInfo.versionRootDir,
    sourceVersionFile: versionFile,
    sourceRuntimeManifest: runtimeManifest,
  });
  if (validation.ok) {
    return {
      extracted: false,
      versionFile,
      versionDirInfo,
      payloadPaths,
    };
  }

  const startedAt = Date.now();
  logSingleExeExtract(
    `Extracting runtime ${versionDirInfo.versionKey} to ${versionDirInfo.versionRootDir} (reason=${validation.reason ?? "unknown"})`,
  );

  try {
    let stats: RuntimeCopyStats | undefined;
    rebuildVersionDirWithRollback({
      versionRootDir: versionDirInfo.versionRootDir,
      runtimeBaseDir: versionDirInfo.runtimeBaseDir,
      rebuild: () => {
        const copyResult = copyPayloadToStage({
          stageDir: versionDirInfo.versionRootDir,
          payloadPaths,
          finalVersionDirInfo: versionDirInfo,
        });
        stats = copyResult.stats;
        materializeDirectoryLinks(copyResult.deferredDirectoryLinks, versionDirInfo.versionRootDir);
      },
    });

    logSingleExeExtract(
      `Extracted runtime ${versionDirInfo.versionKey}: files=${stats?.copiedFiles ?? 0}, dirs=${stats?.copiedDirectories ?? 0}, linkDirs=${stats?.deferredDirectoryLinks ?? 0}, linkFiles=${stats?.copiedSymlinkFiles ?? 0}, skippedBrokenLinks=${stats?.skippedBrokenSymlinks ?? 0}, durationMs=${Date.now() - startedAt}`,
    );
  } catch (error) {
    throw error;
  }

  const postValidation = validateInstalledRuntimeVersion({
    versionRoot: versionDirInfo.versionRootDir,
    sourceVersionFile: versionFile,
    sourceRuntimeManifest: runtimeManifest,
  });
  if (!postValidation.ok) {
    throw new Error(
      `Single-exe runtime validation failed after extract (${postValidation.reason ?? "unknown_reason"}).`,
    );
  }

  logSingleExeExtract(`Validated runtime ${versionDirInfo.versionKey} at ${versionDirInfo.versionRootDir}`);

  return {
    extracted: true,
    versionFile,
    versionDirInfo,
    payloadPaths,
  };
}

export function ensureSingleExeRuntimeFromSea(
  params: EnsureSingleExeRuntimeFromSeaParams = {},
): EnsuredSingleExeRuntime {
  if (!isSeaRuntime()) {
    throw new Error("Single-exe SEA runtime is not available in the current process.");
  }

  const env = params.env ?? process.env;
  const versionFile = JSON.parse(getSeaAssetText(SINGLE_EXE_SEA_VERSION_ASSET_KEY)) as PortableVersionFile;
  const runtimeManifest = JSON.parse(getSeaAssetText(SINGLE_EXE_SEA_RUNTIME_MANIFEST_ASSET_KEY)) as RuntimeManifest;
  const versionDirInfo = resolveRuntimeVersionDirInfo(versionFile, {
    env,
    appHomeDir: params.appHomeDir,
  });
  assertSafeSingleExeRuntimeVersionDirInfo(versionDirInfo, {
    env,
    productName: versionFile.productName,
  });

  ensureDir(versionDirInfo.runtimeBaseDir);

  const validation = validateInstalledRuntimeVersion({
    versionRoot: versionDirInfo.versionRootDir,
    sourceVersionFile: versionFile,
    sourceRuntimeManifest: runtimeManifest,
  });
  if (validation.ok) {
    return {
      extracted: false,
      versionFile,
      versionDirInfo,
    };
  }

  const startedAt = Date.now();
  logSingleExeExtract(
    `Extracting embedded runtime ${versionDirInfo.versionKey} to ${versionDirInfo.versionRootDir} (reason=${validation.reason ?? "unknown"})`,
  );

  try {
    let stats: RuntimeCopyStats | undefined;
    rebuildVersionDirWithRollback({
      versionRootDir: versionDirInfo.versionRootDir,
      runtimeBaseDir: versionDirInfo.runtimeBaseDir,
      rebuild: () => {
        const copyResult = copySeaPayloadToStage({
          stageDir: versionDirInfo.versionRootDir,
          versionFile,
          runtimeManifest,
        });
        stats = copyResult.stats;
        materializeRuntimeSymlinks(copyResult.runtimeSymlinks, versionDirInfo.versionRootDir);
      },
    });

    logSingleExeExtract(
      `Extracted embedded runtime ${versionDirInfo.versionKey}: files=${stats?.copiedFiles ?? 0}, symlinks=${stats?.deferredDirectoryLinks ?? 0}, durationMs=${Date.now() - startedAt}`,
    );
  } catch (error) {
    throw error;
  }

  const postValidation = validateInstalledRuntimeVersion({
    versionRoot: versionDirInfo.versionRootDir,
    sourceVersionFile: versionFile,
    sourceRuntimeManifest: runtimeManifest,
  });
  if (!postValidation.ok) {
    throw new Error(
      `Single-exe embedded runtime validation failed after extract (${postValidation.reason ?? "unknown_reason"}).`,
    );
  }

  logSingleExeExtract(`Validated embedded runtime ${versionDirInfo.versionKey} at ${versionDirInfo.versionRootDir}`);

  return {
    extracted: true,
    versionFile,
    versionDirInfo,
  };
}
