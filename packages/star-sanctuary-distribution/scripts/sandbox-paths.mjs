import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function normalizeResolvedPath(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

export function isPathInsideRoot(targetPath, rootPath) {
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

export function assertPathInsideRoots(targetPath, allowedRoots, label) {
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedAllowedRoots = allowedRoots
    .filter((rootPath) => typeof rootPath === "string" && rootPath.trim())
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

export function guardedRemovePath(targetPath, {
  allowedRoots,
  label,
} = {}) {
  const resolvedTargetPath = assertPathInsideRoots(targetPath, allowedRoots ?? [], label ?? "remove sandbox path");
  let stat;
  try {
    stat = fs.lstatSync(resolvedTargetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
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

export function resetSandboxDir(dirPath, {
  allowedRoots,
  label,
} = {}) {
  const resolvedDirPath = assertPathInsideRoots(dirPath, allowedRoots ?? [], label ?? "reset sandbox dir");
  if (!fs.existsSync(resolvedDirPath)) {
    fs.mkdirSync(resolvedDirPath, { recursive: true });
    return resolvedDirPath;
  }

  for (const entry of fs.readdirSync(resolvedDirPath)) {
    guardedRemovePath(path.join(resolvedDirPath, entry), {
      allowedRoots: [resolvedDirPath],
      label: `${label ?? "reset sandbox dir"} entry`,
    });
  }

  return resolvedDirPath;
}

export function resolveSingleExeVerifyBaseRoot({
  product = "star-sanctuary",
  env = process.env,
  tmpDir = os.tmpdir(),
} = {}) {
  return process.platform === "win32"
    ? path.join(env.LOCALAPPDATA || tmpDir, "ssx")
    : path.join(tmpDir, `${product}-verify`);
}

function sanitizeSuffix(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function resolveSingleExeVerifyRoots({
  product = "star-sanctuary",
  kind,
  suffix = "",
  env = process.env,
  tmpDir = os.tmpdir(),
}) {
  const baseRoot = resolveSingleExeVerifyBaseRoot({ product, env, tmpDir });
  const normalizedKind = sanitizeSuffix(kind);
  const normalizedSuffix = sanitizeSuffix(suffix || "default");
  const runRoot = path.join(baseRoot, `${normalizedKind}-${normalizedSuffix}`);

  return {
    baseRoot,
    runRoot,
    homeDir: path.join(runRoot, "home"),
    stateDir: path.join(runRoot, "state"),
  };
}
