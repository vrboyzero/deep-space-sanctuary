import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ExtensionMarketplaceSource } from "@belldandy/plugins";

import { getExtensionMarketplaceStateDir } from "./extension-marketplace-state.js";

const MARKETPLACE_SOURCE_CACHE_DIRNAME = "source-cache";
const MARKETPLACE_MATERIALIZED_DIRNAME = "materialized";
const MARKETPLACE_SOURCE_METADATA_FILENAME = "source-state.json";

export type ExtensionMarketplaceFetchStatus = "ready" | "deferred";

export interface ExtensionMarketplaceSourceState {
  version: 1;
  marketplace: string;
  source: ExtensionMarketplaceSource;
  sourceKey: string;
  status: ExtensionMarketplaceFetchStatus;
  fetchedAt: string;
  cacheDir: string;
  resolvedSourcePath?: string;
  note?: string;
}

export interface PrepareExtensionMarketplaceSourceOptions {
  stateDir: string;
  marketplace: string;
  source: ExtensionMarketplaceSource;
}

export interface PrepareExtensionMarketplaceSourceResult extends ExtensionMarketplaceSourceState {
  metadataPath: string;
}

export interface MaterializeExtensionMarketplaceSourceOptions {
  stateDir: string;
  marketplace: string;
  extensionName: string;
  sourceState: Pick<
    ExtensionMarketplaceSourceState,
    "marketplace" | "source" | "sourceKey" | "status" | "resolvedSourcePath"
  >;
  manifestPath?: string;
}

export interface MaterializedExtensionMarketplaceSource {
  version: 1;
  marketplace: string;
  extensionName: string;
  sourceKey: string;
  materializedPath: string;
  manifestPath?: string;
  /** 物化目录的确定性内容摘要，作为启动加载前的完整性基线。 */
  contentSha256: string;
  materializedAt: string;
  strategy: "copy";
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizePathSegment(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized === "..") {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function serializeMarketplaceSource(source: ExtensionMarketplaceSource): string {
  switch (source.source) {
    case "directory":
      return JSON.stringify({
        source: source.source,
        path: path.resolve(source.path),
      });
    case "github":
      return JSON.stringify({
        source: source.source,
        repo: source.repo,
        ref: source.ref ?? "",
        manifestPath: source.manifestPath ?? "",
      });
    case "git":
      return JSON.stringify({
        source: source.source,
        url: source.url,
        ref: source.ref ?? "",
        manifestPath: source.manifestPath ?? "",
      });
    case "url":
      return JSON.stringify({
        source: source.source,
        url: source.url,
      });
    case "npm":
      return JSON.stringify({
        source: source.source,
        package: source.package,
        version: source.version ?? "",
      });
  }
}

function buildMarketplaceSourceKey(source: ExtensionMarketplaceSource): string {
  return crypto.createHash("sha256").update(serializeMarketplaceSource(source)).digest("hex").slice(0, 16);
}

function ensurePathInsideRoot(rootDir: string, targetPath: string, label: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes target root.`);
  }
  return resolvedTarget;
}

function resolveMaterializedManifestPath(materializedPath: string, manifestPath?: string): string {
  const candidate = typeof manifestPath === "string" && manifestPath.trim()
    ? manifestPath.trim()
    : "belldandy-extension.json";
  const resolved = ensurePathInsideRoot(materializedPath, path.join(materializedPath, candidate), "manifestPath");
  return resolved;
}

/**
 * Marketplace 安装目录不是可执行信任根。安装完成时与每次加载前都计算相同的
 * 树摘要，避免 manifest 以外的 plugin entry 或 skill 内容被替换后仍被激活。
 */
export async function computeMaterializedExtensionContentSha256(rootPath: string): Promise<string> {
  const canonicalRoot = await fs.realpath(rootPath);
  const rootStat = await fs.lstat(canonicalRoot);
  if (!rootStat.isDirectory()) {
    throw new Error("Materialized extension root must be a directory.");
  }

  const hash = crypto.createHash("sha256");
  const visit = async (currentPath: string, relativePath: string): Promise<void> => {
    const stat = await fs.lstat(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Materialized extension cannot contain symbolic links: ${relativePath || "."}`);
    }
    if (stat.isDirectory()) {
      hash.update(`directory\0${relativePath}\0`);
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        await visit(path.join(currentPath, entry.name), childRelativePath);
      }
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`Materialized extension contains an unsupported entry: ${relativePath}`);
    }
    hash.update(`file\0${relativePath}\0`);
    hash.update(await fs.readFile(currentPath));
  };

  await visit(canonicalRoot, "");
  return hash.digest("hex");
}

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(value, null, 2), "utf-8");
}

export function getExtensionMarketplaceSourceCacheDir(stateDir: string): string {
  return path.join(getExtensionMarketplaceStateDir(stateDir), MARKETPLACE_SOURCE_CACHE_DIRNAME);
}

export function getExtensionMarketplaceMaterializedDir(stateDir: string): string {
  return path.join(getExtensionMarketplaceStateDir(stateDir), MARKETPLACE_MATERIALIZED_DIRNAME);
}

export function getMarketplaceSourceCachePath(stateDir: string, marketplace: string, sourceKey: string): string {
  return path.join(
    getExtensionMarketplaceSourceCacheDir(stateDir),
    sanitizePathSegment(marketplace, "marketplace"),
    sanitizePathSegment(sourceKey, "sourceKey"),
  );
}

export function getMaterializedExtensionPath(stateDir: string, marketplace: string, extensionName: string): string {
  return path.join(
    getExtensionMarketplaceMaterializedDir(stateDir),
    sanitizePathSegment(marketplace, "marketplace"),
    sanitizePathSegment(extensionName, "extensionName"),
  );
}

export async function prepareExtensionMarketplaceSource(
  input: PrepareExtensionMarketplaceSourceOptions,
): Promise<PrepareExtensionMarketplaceSourceResult> {
  const marketplace = sanitizePathSegment(input.marketplace, "marketplace");
  const sourceKey = buildMarketplaceSourceKey(input.source);
  const cacheDir = getMarketplaceSourceCachePath(input.stateDir, marketplace, sourceKey);
  await fs.mkdir(cacheDir, { recursive: true });

  let status: ExtensionMarketplaceFetchStatus = "deferred";
  let resolvedSourcePath: string | undefined;
  let note: string | undefined;

  if (input.source.source === "directory") {
    resolvedSourcePath = path.resolve(input.source.path);
    const stat = await fs.stat(resolvedSourcePath).catch((error) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        throw new Error(`Marketplace source directory does not exist: ${resolvedSourcePath}`);
      }
      throw error;
    });
    if (!stat.isDirectory()) {
      throw new Error(`Marketplace source path is not a directory: ${resolvedSourcePath}`);
    }
    status = "ready";
  } else {
    note = `Source adapter is not implemented yet for ${input.source.source}.`;
  }

  const metadataPath = path.join(cacheDir, MARKETPLACE_SOURCE_METADATA_FILENAME);
  const state: ExtensionMarketplaceSourceState = {
    version: 1,
    marketplace,
    source: input.source,
    sourceKey,
    status,
    fetchedAt: nowIso(),
    cacheDir,
    resolvedSourcePath,
    note,
  };
  await writeJson(metadataPath, state);
  return {
    ...state,
    metadataPath,
  };
}

export async function materializeExtensionMarketplaceSource(
  input: MaterializeExtensionMarketplaceSourceOptions,
): Promise<MaterializedExtensionMarketplaceSource> {
  const marketplace = sanitizePathSegment(input.marketplace, "marketplace");
  const extensionName = sanitizePathSegment(input.extensionName, "extensionName");

  if (input.sourceState.status !== "ready") {
    throw new Error(`Marketplace source ${input.sourceState.source.source} is not ready to materialize.`);
  }

  if (input.sourceState.source.source !== "directory" || !input.sourceState.resolvedSourcePath) {
    throw new Error(`Marketplace source ${input.sourceState.source.source} does not support local materialization yet.`);
  }

  const materializedPath = getMaterializedExtensionPath(input.stateDir, marketplace, extensionName);
  await fs.rm(materializedPath, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(path.dirname(materializedPath), { recursive: true });
  await fs.cp(input.sourceState.resolvedSourcePath, materializedPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  const manifestPath = resolveMaterializedManifestPath(materializedPath, input.manifestPath);
  const manifestStat = await fs.stat(manifestPath).catch((error) => {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return null;
    }
    throw error;
  });

  return {
    version: 1,
    marketplace,
    extensionName,
    sourceKey: input.sourceState.sourceKey,
    materializedPath,
    manifestPath: manifestStat?.isFile() ? manifestPath : undefined,
    contentSha256: await computeMaterializedExtensionContentSha256(materializedPath),
    materializedAt: nowIso(),
    strategy: "copy",
  };
}
