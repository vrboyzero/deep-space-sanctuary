import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  readPortableVersionFile,
  readRuntimeManifest,
  validateInstalledRuntimeVersion,
  type PortableVersionFile,
  type RuntimeManifest,
} from "./runtime-manifest.js";
import { assertPathInsideRoots, guardedRemovePath } from "./sandbox-paths.js";

export type PortableRecoveryPayloadPaths = {
  payloadRoot: string;
  versionFilePath: string;
  runtimeManifestPath: string;
  runtimeFilesDir: string;
};

export type EnsurePortableRuntimeParams = {
  portableRoot: string;
  payloadRoot?: string;
};

export type EnsuredPortableRuntime = {
  recovered: boolean;
  recoveryReason?: string;
  payloadRoot?: string;
  versionFile: PortableVersionFile;
  runtimeManifest: RuntimeManifest;
  runtimeDir: string;
};

type RuntimeSymlinkEntry = {
  linkPath: string;
  targetPath: string;
};

const PORTABLE_RENAME_MAX_ATTEMPTS = 12;

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isRetryableWindowsRenameError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ["EPERM", "EACCES", "EBUSY"].includes(String((error as NodeJS.ErrnoException).code ?? ""));
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removePortablePath(targetPath: string, portableRoot: string, label: string): string {
  return guardedRemovePath(targetPath, [portableRoot], label);
}

function assertPortablePath(targetPath: string, portableRoot: string, label: string): string {
  return assertPathInsideRoots(targetPath, [portableRoot], label);
}

function hasPortableRecoveryPayload(payloadRoot: string): boolean {
  const payloadPaths = resolvePortableRecoveryPayloadPaths(payloadRoot);
  return (
    fs.existsSync(payloadPaths.versionFilePath)
    && fs.existsSync(payloadPaths.runtimeManifestPath)
    && fs.existsSync(payloadPaths.runtimeFilesDir)
  );
}

function logPortableRuntime(message: string): void {
  console.log(`[Star Sanctuary Portable] ${message}`);
}

function resolveManifestSymlinkTargetPath(params: {
  linkPath: string;
  target: string;
}): string {
  const { linkPath, target } = params;
  return path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(path.dirname(linkPath), target);
}

function materializeRuntimeSymlinks(runtimeSymlinks: RuntimeSymlinkEntry[], portableRoot: string): void {
  const symlinkType: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";

  for (const runtimeSymlink of runtimeSymlinks) {
    const linkPath = assertPortablePath(runtimeSymlink.linkPath, portableRoot, "materialize portable runtime symlink");
    const targetPath = assertPortablePath(runtimeSymlink.targetPath, portableRoot, "use portable runtime symlink target");
    ensureDir(path.dirname(linkPath));
    removePortablePath(linkPath, portableRoot, "replace portable runtime symlink");
    fs.symlinkSync(targetPath, linkPath, symlinkType);
  }
}

function extractPortablePayloadToStage(params: {
  stageDir: string;
  payloadPaths: PortableRecoveryPayloadPaths;
  versionFile: PortableVersionFile;
  runtimeManifest: RuntimeManifest;
  finalRuntimeDir: string;
}): {
  copiedFiles: number;
  symlinkCount: number;
  runtimeSymlinks: RuntimeSymlinkEntry[];
} {
  const { stageDir, payloadPaths, versionFile, runtimeManifest, finalRuntimeDir } = params;
  const stageRuntimeDir = path.join(stageDir, versionFile.runtimeDir);
  const runtimeSymlinks: RuntimeSymlinkEntry[] = [];
  let copiedFiles = 0;

  ensureDir(stageDir);
  ensureDir(stageRuntimeDir);
  fs.copyFileSync(payloadPaths.versionFilePath, path.join(stageDir, "version.json"));
  fs.copyFileSync(payloadPaths.runtimeManifestPath, path.join(stageDir, "runtime-manifest.json"));

  for (const entry of runtimeManifest.files) {
    const destinationPath = path.join(stageRuntimeDir, ...entry.path.split("/"));

    if (entry.type === "file") {
      const compressedAssetPath = path.join(
        payloadPaths.runtimeFilesDir,
        ...entry.path.split("/"),
      ) + ".gz";
      let compressedAsset: Buffer;
      try {
        compressedAsset = fs.readFileSync(compressedAssetPath);
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          throw error;
        }
        throw new Error(`Portable recovery payload is missing ${entry.path}`);
      }
      ensureDir(path.dirname(destinationPath));
      fs.writeFileSync(destinationPath, gunzipSync(compressedAsset));
      copiedFiles += 1;
      continue;
    }

    runtimeSymlinks.push({
      linkPath: path.join(finalRuntimeDir, ...entry.path.split("/")),
      targetPath: resolveManifestSymlinkTargetPath({
        linkPath: path.join(finalRuntimeDir, ...entry.path.split("/")),
        target: entry.target ?? "",
      }),
    });
  }

  return {
    copiedFiles,
    symlinkCount: runtimeSymlinks.length,
    runtimeSymlinks,
  };
}

function renamePortablePathWithRetry(sourcePath: string, targetPath: string): void {
  for (let attempt = 1; attempt <= PORTABLE_RENAME_MAX_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      if (process.platform !== "win32" || attempt === PORTABLE_RENAME_MAX_ATTEMPTS || !isRetryableWindowsRenameError(error)) {
        throw error;
      }
      sleepSync(150 * attempt);
    }
  }
}

function replacePortableRuntimeAtomically(params: {
  portableRoot: string;
  stageDir: string;
  finalize?: () => void;
}): void {
  const portableRoot = path.resolve(params.portableRoot);
  const stageDir = assertPortablePath(params.stageDir, portableRoot, "use portable runtime recovery stage");
  const finalize = params.finalize;
  const runtimeDir = assertPortablePath(path.join(portableRoot, "runtime"), portableRoot, "use portable runtime dir");
  const versionFilePath = assertPortablePath(path.join(portableRoot, "version.json"), portableRoot, "use portable version file");
  const runtimeManifestPath = assertPortablePath(path.join(portableRoot, "runtime-manifest.json"), portableRoot, "use portable runtime manifest");
  const stageRuntimeDir = assertPortablePath(path.join(stageDir, "runtime"), portableRoot, "use portable staged runtime dir");
  const stageVersionFilePath = assertPortablePath(path.join(stageDir, "version.json"), portableRoot, "use portable staged version file");
  const stageRuntimeManifestPath = assertPortablePath(path.join(stageDir, "runtime-manifest.json"), portableRoot, "use portable staged runtime manifest");
  const backupSuffix = `.corrupt-${Date.now()}`;
  const backupRuntimeDir = assertPortablePath(`${runtimeDir}${backupSuffix}`, portableRoot, "use portable runtime backup dir");
  const backupVersionFilePath = assertPortablePath(`${versionFilePath}${backupSuffix}`, portableRoot, "use portable version backup file");
  const backupRuntimeManifestPath = assertPortablePath(`${runtimeManifestPath}${backupSuffix}`, portableRoot, "use portable runtime manifest backup file");

  const movedBackups: string[] = [];

  const moveIfExists = (sourcePath: string, targetPath: string): void => {
    const resolvedSourcePath = assertPortablePath(sourcePath, portableRoot, "move portable runtime source path");
    const resolvedTargetPath = assertPortablePath(targetPath, portableRoot, "move portable runtime backup path");
    removePortablePath(resolvedTargetPath, portableRoot, "clear portable backup target");
    try {
      renamePortablePathWithRetry(resolvedSourcePath, resolvedTargetPath);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return;
      }
      throw error;
    }
    movedBackups.push(resolvedTargetPath);
  };

  moveIfExists(runtimeDir, backupRuntimeDir);
  moveIfExists(versionFilePath, backupVersionFilePath);
  moveIfExists(runtimeManifestPath, backupRuntimeManifestPath);

  try {
    renamePortablePathWithRetry(stageRuntimeDir, runtimeDir);
    renamePortablePathWithRetry(stageVersionFilePath, versionFilePath);
    renamePortablePathWithRetry(stageRuntimeManifestPath, runtimeManifestPath);
    finalize?.();
  } catch (error) {
    try {
      removePortablePath(runtimeDir, portableRoot, "rollback portable runtime dir");
      removePortablePath(versionFilePath, portableRoot, "rollback portable version file");
      removePortablePath(runtimeManifestPath, portableRoot, "rollback portable runtime manifest");
    } catch {
      // Best effort cleanup before rollback.
    }

    moveIfExists(backupRuntimeDir, runtimeDir);
    moveIfExists(backupVersionFilePath, versionFilePath);
    moveIfExists(backupRuntimeManifestPath, runtimeManifestPath);
    throw error;
  } finally {
    removePortablePath(stageDir, portableRoot, "cleanup portable runtime recovery stage");
  }

  for (const backupPath of movedBackups) {
    try {
      removePortablePath(backupPath, portableRoot, "cleanup portable runtime backup");
    } catch {
      // Best effort cleanup only.
    }
  }
}

export function resolvePortableRecoveryPayloadPaths(payloadRoot: string): PortableRecoveryPayloadPaths {
  const resolvedPayloadRoot = path.resolve(payloadRoot);
  return {
    payloadRoot: resolvedPayloadRoot,
    versionFilePath: path.join(resolvedPayloadRoot, "version.json"),
    runtimeManifestPath: path.join(resolvedPayloadRoot, "runtime-manifest.json"),
    runtimeFilesDir: path.join(resolvedPayloadRoot, "runtime-files"),
  };
}

export function ensurePortableRuntime(params: EnsurePortableRuntimeParams): EnsuredPortableRuntime {
  const portableRoot = path.resolve(params.portableRoot);
  const defaultPayloadRoot = path.join(portableRoot, "payload");
  const payloadRoot = params.payloadRoot ? path.resolve(params.payloadRoot) : defaultPayloadRoot;
  const hasRecoveryPayload = hasPortableRecoveryPayload(payloadRoot);

  const versionSourceRoot = hasRecoveryPayload ? payloadRoot : portableRoot;
  const versionFile = readPortableVersionFile(versionSourceRoot);
  const runtimeManifest = readRuntimeManifest(versionSourceRoot);
  const runtimeDir = path.join(portableRoot, versionFile.runtimeDir);

  const validation = validateInstalledRuntimeVersion({
    versionRoot: portableRoot,
    sourceVersionFile: versionFile,
    sourceRuntimeManifest: runtimeManifest,
  });
  if (validation.ok) {
    return {
      recovered: false,
      payloadRoot: hasRecoveryPayload ? payloadRoot : undefined,
      versionFile,
      runtimeManifest,
      runtimeDir,
    };
  }

  if (!hasRecoveryPayload) {
    throw new Error(
      `Portable runtime validation failed (${validation.reason ?? "unknown_reason"}), but no recovery payload was found in ${payloadRoot}.`,
    );
  }

  const stageDir = assertPortablePath(
    path.join(portableRoot, `.portable-runtime-recovery-${process.pid}-${Date.now()}`),
    portableRoot,
    "create portable runtime recovery stage",
  );
  const startedAt = Date.now();
  logPortableRuntime(
    `Recovering runtime at ${runtimeDir} from ${payloadRoot} (reason=${validation.reason ?? "unknown"})`,
  );
  removePortablePath(stageDir, portableRoot, "reset portable runtime recovery stage");

  try {
    const extraction = extractPortablePayloadToStage({
      stageDir,
      payloadPaths: resolvePortableRecoveryPayloadPaths(payloadRoot),
      versionFile,
      runtimeManifest,
      finalRuntimeDir: runtimeDir,
    });

    replacePortableRuntimeAtomically({
      portableRoot,
      stageDir,
      finalize: () => {
        materializeRuntimeSymlinks(extraction.runtimeSymlinks, portableRoot);
      },
    });

    logPortableRuntime(
      `Recovered runtime: files=${extraction.copiedFiles}, symlinks=${extraction.symlinkCount}, durationMs=${Date.now() - startedAt}`,
    );
  } catch (error) {
    removePortablePath(stageDir, portableRoot, "cleanup failed portable runtime recovery stage");
    throw error;
  }

  const postValidation = validateInstalledRuntimeVersion({
    versionRoot: portableRoot,
    sourceVersionFile: versionFile,
    sourceRuntimeManifest: runtimeManifest,
  });
  if (!postValidation.ok) {
    throw new Error(
      `Portable runtime validation failed after recovery (${postValidation.reason ?? "unknown_reason"}).`,
    );
  }

  logPortableRuntime(`Validated runtime at ${runtimeDir}`);

  return {
    recovered: true,
    recoveryReason: validation.reason,
    payloadRoot,
    versionFile,
    runtimeManifest,
    runtimeDir,
  };
}
