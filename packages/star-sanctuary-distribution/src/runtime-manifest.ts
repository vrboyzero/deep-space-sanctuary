import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

export type RuntimeManifestFileEntry = {
  path: string;
  type: "file" | "symlink";
  size?: number;
  sha256?: string;
  target?: string;
};

export type RuntimeManifest = {
  productName: string;
  version: string;
  distributionMode?: "slim" | "full";
  platform: string;
  arch: string;
  builtAt: string;
  includeOptionalNative: boolean;
  runtimeDir: string;
  summary: {
    fileCount: number;
    totalSize: number;
  };
  files: RuntimeManifestFileEntry[];
};

export type PortableVersionFile = {
  productName: string;
  version: string;
  distributionMode?: "slim" | "full";
  distributionPolicy?: {
    policyVersion: number;
    mode: "slim" | "full";
    summary: string;
    alwaysIncluded: Array<{
      dependency: string;
      sourcePackage: string;
      reason: string;
    }>;
    optionalDependencies: Array<{
      dependency: string;
      sourcePackage: string;
      packageDir: string;
      enabledIn: string[];
      excludedIn: string[];
      reason: string;
    }>;
    includedOptionalDependencies: string[];
    excludedOptionalDependencies: string[];
    actualRuntimeOptionalDependencies: string[];
  };
  platform: string;
  arch: string;
  builtAt: string;
  includeOptionalNative: boolean;
  runtimeDir: string;
  entryScript: string;
  runtimeSummary?: {
    fileCount: number;
    totalSize: number;
  };
  files?: {
    runtimeManifest?: {
      path: string;
      size: number;
      sha256: string;
    };
  };
};

export type RuntimePayloadPaths = {
  payloadRoot: string;
  versionFilePath: string;
  runtimeManifestPath: string;
  runtimeSourceDir: string;
};

export type RuntimeInstallationValidation = {
  ok: boolean;
  reason?: string;
  expectedKey?: string;
  actualKey?: string;
  missingPaths?: string[];
  invalidPaths?: Array<{ path: string; reason: string }>;
};

const MAX_RUNTIME_MANIFEST_FILES = 200_000;
const MAX_RUNTIME_MANIFEST_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_RUNTIME_MANIFEST_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_RUNTIME_MANIFEST_JSON_BYTES = 64 * 1024 * 1024;
const MAX_PORTABLE_VERSION_JSON_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

declare const validatedRuntimeManifest: unique symbol;
declare const validatedPortableVersion: unique symbol;

export type ValidatedRuntimeManifest = RuntimeManifest & {
  readonly [validatedRuntimeManifest]: true;
};

export type ValidatedPortableVersionFile = PortableVersionFile & {
  readonly [validatedPortableVersion]: true;
};

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object.`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${label}: expected a non-empty string.`);
  }
  return value;
}

function assertNonNegativeSafeInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`Invalid ${label}: expected a non-negative safe integer no greater than ${maximum}.`);
  }
  return value as number;
}

/** runtime manifest 只使用 POSIX 相对路径，避免 Windows 分隔符、盘符或 UNC 在解包阶段重新解释。 */
function assertSafeRuntimeRelativePath(value: unknown, label: string): string {
  const relativePath = assertNonEmptyString(value, label);
  if (relativePath.includes("\0")
    || relativePath.includes("\\")
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error(`Unsafe runtime relative path for ${label}: ${relativePath}`);
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.endsWith(".") || segment.endsWith(" "))) {
    throw new Error(`Unsafe runtime relative path for ${label}: ${relativePath}`);
  }
  return segments.join("/");
}

function assertSafeRuntimeSymlinkTarget(value: unknown, entryPath: string): string {
  const target = assertNonEmptyString(value, `runtime manifest symlink target for ${entryPath}`);
  if (target.includes("\0")
    || target.includes("\\")
    || path.posix.isAbsolute(target)
    || path.win32.isAbsolute(target)
    || /^[A-Za-z]:/.test(target)) {
    throw new Error(`Unsafe runtime symlink target for ${entryPath}: ${target}`);
  }

  const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), target));
  if (resolvedTarget === ".." || resolvedTarget.startsWith("../") || resolvedTarget === ".") {
    throw new Error(`Runtime symlink target escapes runtime root: ${entryPath} -> ${target}`);
  }
  return target;
}

function assertDistributionMode(value: unknown, label: string): "slim" | "full" | undefined {
  if (value === undefined) return undefined;
  if (value !== "slim" && value !== "full") {
    throw new Error(`Invalid ${label}: expected slim or full.`);
  }
  return value;
}

function parseRuntimeSummary(value: unknown, label: string): { fileCount: number; totalSize: number } {
  const summary = assertRecord(value, label);
  return {
    fileCount: assertNonNegativeSafeInteger(summary.fileCount, `${label}.fileCount`, MAX_RUNTIME_MANIFEST_FILES),
    totalSize: assertNonNegativeSafeInteger(summary.totalSize, `${label}.totalSize`, MAX_RUNTIME_MANIFEST_TOTAL_BYTES),
  };
}

function parseBoundedJsonText(raw: string, label: string, maxBytes: number): unknown {
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new Error(`Invalid ${label}: JSON exceeds the ${maxBytes} byte limit.`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readBoundedJsonFile(filePath: string, label: string, maxBytes: number): unknown {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Invalid ${label}: expected a file at ${filePath}.`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`Invalid ${label}: JSON exceeds the ${maxBytes} byte limit.`);
  }
  return parseBoundedJsonText(fs.readFileSync(filePath, "utf-8"), label, maxBytes);
}

function parseRuntimeManifestEntry(value: unknown, index: number): RuntimeManifestFileEntry {
  const entry = assertRecord(value, `runtime manifest files[${index}]`);
  const entryPath = assertSafeRuntimeRelativePath(entry.path, `runtime manifest files[${index}].path`);
  if (entry.type === "file") {
    return {
      path: entryPath,
      type: "file",
      size: assertNonNegativeSafeInteger(entry.size, `runtime manifest files[${index}].size`, MAX_RUNTIME_MANIFEST_ENTRY_BYTES),
      sha256: (() => {
        const sha256 = assertNonEmptyString(entry.sha256, `runtime manifest files[${index}].sha256`);
        if (!SHA256_PATTERN.test(sha256)) {
          throw new Error(`Invalid runtime manifest files[${index}].sha256.`);
        }
        return sha256.toLowerCase();
      })(),
    };
  }
  if (entry.type === "symlink") {
    return {
      path: entryPath,
      type: "symlink",
      target: assertSafeRuntimeSymlinkTarget(entry.target, entryPath),
    };
  }
  throw new Error(`Invalid runtime manifest files[${index}].type.`);
}

function assertNoRuntimeManifestPathConflicts(entries: RuntimeManifestFileEntry[]): void {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (paths.has(entry.path)) {
      throw new Error(`Duplicate runtime manifest path: ${entry.path}`);
    }
    paths.add(entry.path);
  }
  for (const entryPath of paths) {
    const segments = entryPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const parentPath = segments.slice(0, index).join("/");
      if (paths.has(parentPath)) {
        throw new Error(`Runtime manifest parent-child conflict: ${parentPath} and ${entryPath}`);
      }
    }
  }
}

export function parseAndValidateRuntimeManifest(value: unknown): ValidatedRuntimeManifest {
  const manifest = assertRecord(value, "runtime manifest");
  const rawFiles = manifest.files;
  if (!Array.isArray(rawFiles) || rawFiles.length > MAX_RUNTIME_MANIFEST_FILES) {
    throw new Error(`Invalid runtime manifest files: expected at most ${MAX_RUNTIME_MANIFEST_FILES} entries.`);
  }
  const files = rawFiles.map((entry, index) => parseRuntimeManifestEntry(entry, index));
  assertNoRuntimeManifestPathConflicts(files);
  const summary = parseRuntimeSummary(manifest.summary, "runtime manifest summary");
  const fileEntries = files.filter((entry): entry is RuntimeManifestFileEntry & { type: "file"; size: number } => entry.type === "file");
  const totalSize = fileEntries.reduce((sum, entry) => sum + entry.size, 0);
  if (summary.fileCount !== fileEntries.length) {
    throw new Error(`Runtime manifest summary fileCount does not match file entries: ${summary.fileCount}!=${fileEntries.length}.`);
  }
  if (summary.totalSize !== totalSize) {
    throw new Error(`Runtime manifest summary totalSize does not match file entries: ${summary.totalSize}!=${totalSize}.`);
  }

  return {
    productName: assertNonEmptyString(manifest.productName, "runtime manifest productName"),
    version: assertNonEmptyString(manifest.version, "runtime manifest version"),
    ...(assertDistributionMode(manifest.distributionMode, "runtime manifest distributionMode")
      ? { distributionMode: assertDistributionMode(manifest.distributionMode, "runtime manifest distributionMode") }
      : {}),
    platform: assertNonEmptyString(manifest.platform, "runtime manifest platform"),
    arch: assertNonEmptyString(manifest.arch, "runtime manifest arch"),
    builtAt: assertNonEmptyString(manifest.builtAt, "runtime manifest builtAt"),
    includeOptionalNative: (() => {
      if (typeof manifest.includeOptionalNative !== "boolean") {
        throw new Error("Invalid runtime manifest includeOptionalNative.");
      }
      return manifest.includeOptionalNative;
    })(),
    runtimeDir: assertSafeRuntimeRelativePath(manifest.runtimeDir, "runtime manifest runtimeDir"),
    summary,
    files,
  } as ValidatedRuntimeManifest;
}

export function parseAndValidateRuntimeManifestJson(raw: string): ValidatedRuntimeManifest {
  return parseAndValidateRuntimeManifest(parseBoundedJsonText(
    raw,
    "runtime manifest",
    MAX_RUNTIME_MANIFEST_JSON_BYTES,
  ));
}

export function parseAndValidatePortableVersion(value: unknown): ValidatedPortableVersionFile {
  const versionFile = assertRecord(value, "portable version file");
  const runtimeDir = assertSafeRuntimeRelativePath(versionFile.runtimeDir, "portable version runtimeDir");
  const entryScript = assertSafeRuntimeRelativePath(versionFile.entryScript, "portable version entryScript");
  if (!entryScript.startsWith(`${runtimeDir}/`)) {
    throw new Error("Portable version entryScript must be inside runtimeDir.");
  }

  let runtimeManifest: NonNullable<PortableVersionFile["files"]>["runtimeManifest"] | undefined;
  if (versionFile.files !== undefined) {
    const files = assertRecord(versionFile.files, "portable version files");
    if (files.runtimeManifest !== undefined) {
      const manifestFile = assertRecord(files.runtimeManifest, "portable version runtimeManifest");
      const sha256 = assertNonEmptyString(manifestFile.sha256, "portable version runtimeManifest.sha256");
      if (!SHA256_PATTERN.test(sha256)) {
        throw new Error("Invalid portable version runtimeManifest.sha256.");
      }
      runtimeManifest = {
        path: assertSafeRuntimeRelativePath(manifestFile.path, "portable version runtimeManifest.path"),
        size: assertNonNegativeSafeInteger(manifestFile.size, "portable version runtimeManifest.size", MAX_RUNTIME_MANIFEST_ENTRY_BYTES),
        sha256: sha256.toLowerCase(),
      };
    }
  }

  if (typeof versionFile.includeOptionalNative !== "boolean") {
    throw new Error("Invalid portable version includeOptionalNative.");
  }
  const distributionMode = assertDistributionMode(versionFile.distributionMode, "portable version distributionMode");
  return {
    productName: assertNonEmptyString(versionFile.productName, "portable version productName"),
    version: assertNonEmptyString(versionFile.version, "portable version version"),
    ...(distributionMode ? { distributionMode } : {}),
    ...(versionFile.distributionPolicy ? { distributionPolicy: versionFile.distributionPolicy as PortableVersionFile["distributionPolicy"] } : {}),
    platform: assertNonEmptyString(versionFile.platform, "portable version platform"),
    arch: assertNonEmptyString(versionFile.arch, "portable version arch"),
    builtAt: assertNonEmptyString(versionFile.builtAt, "portable version builtAt"),
    includeOptionalNative: versionFile.includeOptionalNative,
    runtimeDir,
    entryScript,
    ...(versionFile.runtimeSummary ? { runtimeSummary: parseRuntimeSummary(versionFile.runtimeSummary, "portable version runtimeSummary") } : {}),
    ...(runtimeManifest ? { files: { runtimeManifest } } : {}),
  } as ValidatedPortableVersionFile;
}

export function parseAndValidatePortableVersionJson(raw: string): ValidatedPortableVersionFile {
  return parseAndValidatePortableVersion(parseBoundedJsonText(
    raw,
    "portable version file",
    MAX_PORTABLE_VERSION_JSON_BYTES,
  ));
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function resolveManifestEntryPath(params: {
  versionRoot: string;
  runtimeDir: string;
  entryPath: string;
}): string {
  const { versionRoot, runtimeDir, entryPath } = params;
  return path.join(versionRoot, runtimeDir, ...entryPath.split("/"));
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

function normalizeResolvedPath(targetPath: string): string {
  const resolvedPath = typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(targetPath)
    : fs.realpathSync(targetPath);
  return normalizeRelativePath(path.resolve(resolvedPath));
}

function validateInstalledRuntimeManifestEntries(params: {
  versionRoot: string;
  runtimeManifest: RuntimeManifest;
}): RuntimeInstallationValidation {
  const { versionRoot, runtimeManifest } = params;
  const invalidPaths: Array<{ path: string; reason: string }> = [];

  for (const entry of runtimeManifest.files) {
    const absolutePath = resolveManifestEntryPath({
      versionRoot,
      runtimeDir: runtimeManifest.runtimeDir,
      entryPath: entry.path,
    });

    if (!fs.existsSync(absolutePath)) {
      invalidPaths.push({ path: entry.path, reason: "missing" });
      continue;
    }

    if (entry.type === "file") {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absolutePath);
      } catch (error) {
        invalidPaths.push({
          path: entry.path,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (!stat.isFile()) {
        invalidPaths.push({ path: entry.path, reason: "expected_file" });
        continue;
      }

      if (typeof entry.size === "number" && stat.size !== entry.size) {
        invalidPaths.push({
          path: entry.path,
          reason: `size_mismatch:${stat.size}!=${entry.size}`,
        });
        continue;
      }

      if (entry.sha256 && sha256File(absolutePath) !== entry.sha256) {
        invalidPaths.push({ path: entry.path, reason: "sha256_mismatch" });
      }
      continue;
    }

    if (!entry.target) {
      invalidPaths.push({ path: entry.path, reason: "missing_symlink_target" });
      continue;
    }

    try {
      const expectedTargetPath = resolveManifestSymlinkTargetPath({
        linkPath: absolutePath,
        target: entry.target,
      });
      if (process.platform === "win32") {
        const linkStat = fs.lstatSync(absolutePath);
        const targetStat = fs.statSync(expectedTargetPath);
        if (!linkStat.isSymbolicLink() && linkStat.isDirectory() && targetStat.isDirectory()) {
          continue;
        }
      }
      const actualResolvedPath = normalizeResolvedPath(absolutePath);
      const expectedResolvedPath = normalizeResolvedPath(expectedTargetPath);
      if (actualResolvedPath !== expectedResolvedPath) {
        invalidPaths.push({ path: entry.path, reason: "symlink_target_mismatch" });
      }
    } catch (error) {
      invalidPaths.push({
        path: entry.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (invalidPaths.length > 0) {
    return {
      ok: false,
      reason: "runtime_manifest_entry_mismatch",
      invalidPaths,
    };
  }

  return { ok: true };
}

function resolveMaybePath(value: string | undefined): string | undefined {
  return value && value.trim() ? path.resolve(value.trim()) : undefined;
}

export function resolveSingleExePayloadRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = resolveMaybePath(
    env.STAR_SANCTUARY_SINGLE_EXE_PAYLOAD_DIR
    ?? env.BELLDANDY_SINGLE_EXE_PAYLOAD_DIR,
  );
  if (explicit) return explicit;

  const executableDir = path.dirname(process.execPath);
  const candidates = [
    executableDir,
    path.join(executableDir, "payload"),
  ];

  for (const candidate of candidates) {
    const versionFilePath = path.join(candidate, "version.json");
    const runtimeManifestPath = path.join(candidate, "runtime-manifest.json");
    if (fs.existsSync(versionFilePath) && fs.existsSync(runtimeManifestPath)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to resolve single-exe payload root. Set STAR_SANCTUARY_SINGLE_EXE_PAYLOAD_DIR to a portable artifact directory.",
  );
}

export function resolveRuntimePayloadPaths(payloadRoot: string): RuntimePayloadPaths {
  const resolvedPayloadRoot = path.resolve(payloadRoot);
  return {
    payloadRoot: resolvedPayloadRoot,
    versionFilePath: path.join(resolvedPayloadRoot, "version.json"),
    runtimeManifestPath: path.join(resolvedPayloadRoot, "runtime-manifest.json"),
    runtimeSourceDir: path.join(resolvedPayloadRoot, "runtime"),
  };
}

export function readPortableVersionFile(payloadRoot: string): ValidatedPortableVersionFile {
  const { versionFilePath } = resolveRuntimePayloadPaths(payloadRoot);
  return parseAndValidatePortableVersion(readBoundedJsonFile(
    versionFilePath,
    "portable version file",
    MAX_PORTABLE_VERSION_JSON_BYTES,
  ));
}

export function readRuntimeManifest(payloadRoot: string): ValidatedRuntimeManifest {
  const { runtimeManifestPath } = resolveRuntimePayloadPaths(payloadRoot);
  return parseAndValidateRuntimeManifest(readBoundedJsonFile(
    runtimeManifestPath,
    "runtime manifest",
    MAX_RUNTIME_MANIFEST_JSON_BYTES,
  ));
}

export function getRuntimeVersionKey(versionFile: PortableVersionFile): string {
  return `${versionFile.version}-${versionFile.platform}-${versionFile.arch}`;
}

export function getCriticalRuntimeRelativePaths(versionFile: PortableVersionFile): string[] {
  const criticalPaths = new Set<string>([
    "version.json",
    "runtime-manifest.json",
    versionFile.entryScript,
    path.join(versionFile.runtimeDir, "packages", "belldandy-core", "dist", "bin", "gateway.js"),
    path.join(versionFile.runtimeDir, "apps", "web", "public", "index.html"),
    path.join(versionFile.runtimeDir, "templates", "AGENTS.md"),
  ]);

  return [...criticalPaths].map((item) => item.split(path.sep).join("/"));
}

export function validateInstalledRuntimeVersion(params: {
  versionRoot: string;
  sourceVersionFile: PortableVersionFile;
  sourceRuntimeManifest?: RuntimeManifest;
}): RuntimeInstallationValidation {
  const { versionRoot } = params;
  let sourceVersionFile: ValidatedPortableVersionFile;
  let sourceRuntimeManifest: ValidatedRuntimeManifest | undefined;
  try {
    sourceVersionFile = parseAndValidatePortableVersion(params.sourceVersionFile);
    sourceRuntimeManifest = params.sourceRuntimeManifest
      ? parseAndValidateRuntimeManifest(params.sourceRuntimeManifest)
      : undefined;
  } catch {
    return { ok: false, reason: "invalid_source_runtime_metadata" };
  }
  const resolvedVersionRoot = path.resolve(versionRoot);
  const installedVersionFilePath = path.join(resolvedVersionRoot, "version.json");
  const installedRuntimeManifestPath = path.join(resolvedVersionRoot, "runtime-manifest.json");

  if (!fs.existsSync(installedVersionFilePath) || !fs.existsSync(installedRuntimeManifestPath)) {
    return { ok: false, reason: "missing_version_metadata" };
  }

  let installedVersionFile: ValidatedPortableVersionFile;
  try {
    installedVersionFile = parseAndValidatePortableVersion(readBoundedJsonFile(
      installedVersionFilePath,
      "installed portable version file",
      MAX_PORTABLE_VERSION_JSON_BYTES,
    ));
  } catch {
    return { ok: false, reason: "invalid_installed_version_metadata" };
  }
  const expectedKey = getRuntimeVersionKey(sourceVersionFile);
  const actualKey = getRuntimeVersionKey(installedVersionFile);
  if (expectedKey !== actualKey) {
    return {
      ok: false,
      reason: "version_key_mismatch",
      expectedKey,
      actualKey,
    };
  }

  if (
    (sourceVersionFile.distributionMode ?? "slim")
      !== (installedVersionFile.distributionMode ?? (installedVersionFile.includeOptionalNative ? "full" : "slim"))
  ) {
    return {
      ok: false,
      reason: "distribution_mode_mismatch",
      expectedKey,
      actualKey,
    };
  }

  const expectedManifestSha = sourceVersionFile.files?.runtimeManifest?.sha256;
  const actualManifestSha = sha256File(installedRuntimeManifestPath);
  if (expectedManifestSha && expectedManifestSha !== actualManifestSha) {
    return {
      ok: false,
      reason: "runtime_manifest_sha_mismatch",
      expectedKey,
      actualKey,
    };
  }

  const missingPaths = getCriticalRuntimeRelativePaths(sourceVersionFile)
    .map((relativePath) => ({
      relativePath,
      absolutePath: path.join(resolvedVersionRoot, relativePath),
    }))
    .filter((entry) => !fs.existsSync(entry.absolutePath))
    .map((entry) => entry.relativePath);

  if (missingPaths.length > 0) {
    return {
      ok: false,
      reason: "missing_runtime_files",
      expectedKey,
      actualKey,
      missingPaths,
    };
  }

  if (sourceRuntimeManifest) {
    let installedRuntimeManifest: ValidatedRuntimeManifest;
    try {
      installedRuntimeManifest = parseAndValidateRuntimeManifest(readBoundedJsonFile(
        installedRuntimeManifestPath,
        "installed runtime manifest",
        MAX_RUNTIME_MANIFEST_JSON_BYTES,
      ));
    } catch {
      return {
        ok: false,
        reason: "invalid_installed_runtime_manifest",
        expectedKey,
        actualKey,
      };
    }

    if (
      installedRuntimeManifest.runtimeDir !== sourceRuntimeManifest.runtimeDir
      || installedRuntimeManifest.summary.fileCount !== sourceRuntimeManifest.summary.fileCount
      || installedRuntimeManifest.summary.totalSize !== sourceRuntimeManifest.summary.totalSize
    ) {
      return {
        ok: false,
        reason: "runtime_manifest_summary_mismatch",
        expectedKey,
        actualKey,
      };
    }

    const manifestValidation = validateInstalledRuntimeManifestEntries({
      versionRoot: resolvedVersionRoot,
      runtimeManifest: sourceRuntimeManifest,
    });
    if (!manifestValidation.ok) {
      return {
        ...manifestValidation,
        expectedKey,
        actualKey,
      };
    }
  }

  return {
    ok: true,
    expectedKey,
    actualKey,
  };
}
