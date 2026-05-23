import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RuntimeVersionDirInfo } from "./runtime-version-dir.js";

function normalizeResolvedPath(targetPath: string): string {
  const resolvedPath = path.resolve(targetPath);
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

function slugifyProductName(productName: string): string {
  const normalized = productName.replace(/[^A-Za-z0-9]+/g, "");
  return normalized || "StarSanctuary";
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTargetPath = normalizeResolvedPath(targetPath);
  const resolvedRootPath = normalizeResolvedPath(rootPath);
  if (resolvedTargetPath === resolvedRootPath) {
    return true;
  }

  const rootWithSeparator = resolvedRootPath.endsWith(path.sep)
    ? resolvedRootPath
    : `${resolvedRootPath}${path.sep}`;
  return resolvedTargetPath.startsWith(rootWithSeparator);
}

export function assertPathInsideRoots(targetPath: string, allowedRoots: string[], label: string): string {
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedAllowedRoots = allowedRoots
    .filter((rootPath) => typeof rootPath === "string" && rootPath.trim().length > 0)
    .map((rootPath) => path.resolve(rootPath));

  if (resolvedAllowedRoots.length === 0) {
    throw new Error(`Refusing to ${label}: no allowed sandbox roots were provided.`);
  }

  if (!resolvedAllowedRoots.some((rootPath) => isPathInsideRoot(resolvedTargetPath, rootPath))) {
    throw new Error(
      `Refusing to ${label}: ${resolvedTargetPath} is outside allowed sandbox roots (${resolvedAllowedRoots.join(", ")}).`,
    );
  }

  return resolvedTargetPath;
}

export function guardedRemovePath(targetPath: string, allowedRoots: string[], label: string): string {
  const resolvedTargetPath = assertPathInsideRoots(targetPath, allowedRoots, label);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedTargetPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return resolvedTargetPath;
    }
    throw error;
  }

  fs.rmSync(resolvedTargetPath, {
    recursive: stat.isDirectory() && !stat.isSymbolicLink(),
    force: true,
  });
  return resolvedTargetPath;
}

export function resolveSingleExeVerifyBaseRoot(params?: {
  env?: NodeJS.ProcessEnv;
  tmpDir?: string;
  product?: string;
}): string {
  const env = params?.env ?? process.env;
  const tmpDir = params?.tmpDir ?? os.tmpdir();
  const product = params?.product ?? "star-sanctuary";

  return process.platform === "win32"
    ? path.join(env.LOCALAPPDATA || tmpDir, "ssx")
    : path.join(tmpDir, `${product}-verify`);
}

function resolveDefaultSingleExeAppHomeDirs(params?: {
  env?: NodeJS.ProcessEnv;
  productName?: string;
}): string[] {
  const env = params?.env ?? process.env;
  const productName = params?.productName ?? "Star Sanctuary";
  const productSlug = slugifyProductName(productName);
  const defaultHomeDir = path.join(os.homedir(), ".star_sanctuary", productSlug);
  const directories = [defaultHomeDir];

  if (process.platform === "win32" && env.LOCALAPPDATA?.trim()) {
    directories.unshift(path.join(path.resolve(env.LOCALAPPDATA), productSlug));
  }

  return directories.map((dirPath) => path.resolve(dirPath));
}

function isSafeSingleExeAppHomeDir(appHomeDir: string, params?: {
  env?: NodeJS.ProcessEnv;
  productName?: string;
}): boolean {
  const resolvedAppHomeDir = path.resolve(appHomeDir);
  if (isPathInsideRoot(resolvedAppHomeDir, resolveSingleExeVerifyBaseRoot({
    env: params?.env,
  }))) {
    return true;
  }

  return resolveDefaultSingleExeAppHomeDirs(params)
    .some((allowedRoot) => resolvedAppHomeDir === allowedRoot);
}

export function assertSafeSingleExeRuntimeVersionDirInfo(
  versionDirInfo: RuntimeVersionDirInfo,
  params?: {
    env?: NodeJS.ProcessEnv;
    productName?: string;
  },
): RuntimeVersionDirInfo {
  if (!isSafeSingleExeAppHomeDir(versionDirInfo.appHomeDir, params)) {
    throw new Error(
      `Refusing single-exe runtime cleanup: app home dir ${path.resolve(versionDirInfo.appHomeDir)} `
      + "is outside allowed single-exe sandboxes.",
    );
  }

  const resolvedAppHomeDir = path.resolve(versionDirInfo.appHomeDir);
  const expectedRuntimeBaseDir = path.join(resolvedAppHomeDir, "runtime");
  const resolvedRuntimeBaseDir = path.resolve(versionDirInfo.runtimeBaseDir);
  if (resolvedRuntimeBaseDir !== expectedRuntimeBaseDir) {
    throw new Error(
      `Refusing single-exe runtime cleanup: runtime base dir ${resolvedRuntimeBaseDir} `
      + `does not match expected sandbox root ${expectedRuntimeBaseDir}.`,
    );
  }

  assertPathInsideRoots(versionDirInfo.versionRootDir, [resolvedRuntimeBaseDir], "use single-exe version root");
  assertPathInsideRoots(versionDirInfo.runtimeDir, [versionDirInfo.versionRootDir], "use single-exe runtime dir");
  assertPathInsideRoots(versionDirInfo.versionFilePath, [versionDirInfo.versionRootDir], "use single-exe version metadata");
  assertPathInsideRoots(versionDirInfo.runtimeManifestPath, [versionDirInfo.versionRootDir], "use single-exe runtime manifest");

  return versionDirInfo;
}
