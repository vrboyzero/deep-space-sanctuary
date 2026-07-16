import fs from "node:fs/promises";
import path from "node:path";

import {
  formatExtensionId,
  parseExtensionManifest,
  type ExtensionManifest,
  type ExtensionMarketplaceSource,
} from "@belldandy/plugins";

import {
  getInstalledExtension,
  getKnownMarketplace,
  removeInstalledExtension,
  setInstalledExtensionEnabled,
  type InstalledExtensionRecord,
  upsertInstalledExtension,
  upsertKnownMarketplace,
} from "./extension-marketplace-state.js";
import {
  materializeExtensionMarketplaceSource,
  prepareExtensionMarketplaceSource,
  type MaterializedExtensionMarketplaceSource,
  type PrepareExtensionMarketplaceSourceResult,
} from "./extension-marketplace-source.js";

const DEFAULT_MANIFEST_PATH = "belldandy-extension.json";

export interface InstallMarketplaceExtensionInput {
  stateDir: string;
  marketplace: string;
  source: ExtensionMarketplaceSource;
  manifestPath?: string;
  autoUpdate?: boolean;
  enabled?: boolean;
}

export interface InstallMarketplaceExtensionResult {
  marketplace: string;
  preparedSource: PrepareExtensionMarketplaceSourceResult;
  materialized: MaterializedExtensionMarketplaceSource;
  manifest: ExtensionManifest;
  installed: InstalledExtensionRecord;
}

export interface UpdateMarketplaceExtensionInput {
  stateDir: string;
  extensionId: string;
}

export interface UninstallMarketplaceExtensionInput {
  stateDir: string;
  extensionId: string;
}

function assertRelativeManifestPath(value?: string): string {
  const normalized = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_MANIFEST_PATH;
  if (path.isAbsolute(normalized) || normalized.startsWith("/") || normalized.startsWith("\\")) {
    throw new Error("manifestPath must be relative.");
  }
  if (normalized.split(/[\\/]+/).some((part) => part === "..")) {
    throw new Error("manifestPath cannot contain parent directory traversal.");
  }
  return normalized;
}

function resolveManifestPath(source: ExtensionMarketplaceSource, manifestPath?: string): string {
  if (manifestPath && manifestPath.trim()) {
    return assertRelativeManifestPath(manifestPath);
  }
  if ("manifestPath" in source && typeof source.manifestPath === "string" && source.manifestPath.trim()) {
    return assertRelativeManifestPath(source.manifestPath);
  }
  return DEFAULT_MANIFEST_PATH;
}

async function loadManifestFromPreparedSource(
  preparedSource: PrepareExtensionMarketplaceSourceResult,
  manifestPath: string,
): Promise<ExtensionManifest> {
  if (preparedSource.status !== "ready" || !preparedSource.resolvedSourcePath) {
    throw new Error(`Marketplace source ${preparedSource.source.source} is not ready to read manifest.`);
  }
  const manifestFilePath = path.join(preparedSource.resolvedSourcePath, manifestPath);
  const raw = await fs.readFile(manifestFilePath, "utf-8");
  return parseExtensionManifest(JSON.parse(raw) as unknown);
}

async function installMarketplaceExtensionWithPreparedSource(input: {
  stateDir: string;
  marketplace: string;
  source: ExtensionMarketplaceSource;
  preparedSource: PrepareExtensionMarketplaceSourceResult;
  manifestPath: string;
  autoUpdate: boolean;
  enabled: boolean;
  previousInstalledAt?: string;
}): Promise<InstallMarketplaceExtensionResult> {
  const manifest = await loadManifestFromPreparedSource(input.preparedSource, input.manifestPath);
  const materialized = await materializeExtensionMarketplaceSource({
    stateDir: input.stateDir,
    marketplace: input.marketplace,
    extensionName: manifest.name,
    manifestPath: input.manifestPath,
    sourceState: input.preparedSource,
  });

  await upsertKnownMarketplace(input.stateDir, {
    name: input.marketplace,
    source: input.source,
    installLocation: input.preparedSource.cacheDir,
    autoUpdate: input.autoUpdate,
    lastUpdated: input.preparedSource.fetchedAt,
  });

  await upsertInstalledExtension(input.stateDir, {
    id: formatExtensionId(manifest.name, input.marketplace),
    name: manifest.name,
    kind: manifest.kind,
    marketplace: input.marketplace,
    version: manifest.version,
    manifestPath: input.manifestPath,
    installPath: materialized.materializedPath,
    sourceKey: input.preparedSource.sourceKey,
    contentSha256: materialized.contentSha256,
    approvedAt: materialized.materializedAt,
    installedAt: input.previousInstalledAt,
    lastUpdated: materialized.materializedAt,
    status: "installed",
    enabled: input.enabled,
  });

  const installed = await getInstalledExtension(input.stateDir, formatExtensionId(manifest.name, input.marketplace));
  if (!installed) {
    throw new Error(`Installed extension record missing after install: ${manifest.name}@${input.marketplace}`);
  }

  return {
    marketplace: input.marketplace,
    preparedSource: input.preparedSource,
    materialized,
    manifest,
    installed,
  };
}

export async function installMarketplaceExtension(
  input: InstallMarketplaceExtensionInput,
): Promise<InstallMarketplaceExtensionResult> {
  const manifestPath = resolveManifestPath(input.source, input.manifestPath);
  const preparedSource = await prepareExtensionMarketplaceSource({
    stateDir: input.stateDir,
    marketplace: input.marketplace,
    source: input.source,
  });
  return installMarketplaceExtensionWithPreparedSource({
    stateDir: input.stateDir,
    marketplace: input.marketplace,
    source: input.source,
    preparedSource,
    manifestPath,
    autoUpdate: input.autoUpdate === true,
    enabled: input.enabled !== false,
  });
}

export async function updateMarketplaceExtension(
  input: UpdateMarketplaceExtensionInput,
): Promise<InstallMarketplaceExtensionResult> {
  const installed = await getInstalledExtension(input.stateDir, input.extensionId);
  if (!installed) {
    throw new Error(`Installed extension not found: ${input.extensionId}`);
  }
  const knownMarketplace = await getKnownMarketplace(input.stateDir, installed.marketplace);
  if (!knownMarketplace) {
    throw new Error(`Known marketplace not found: ${installed.marketplace}`);
  }

  const preparedSource = await prepareExtensionMarketplaceSource({
    stateDir: input.stateDir,
    marketplace: installed.marketplace,
    source: knownMarketplace.source,
  });
  return installMarketplaceExtensionWithPreparedSource({
    stateDir: input.stateDir,
    marketplace: installed.marketplace,
    source: knownMarketplace.source,
    preparedSource,
    manifestPath: assertRelativeManifestPath(installed.manifestPath),
    autoUpdate: knownMarketplace.autoUpdate,
    enabled: installed.enabled,
    previousInstalledAt: installed.installedAt,
  });
}

export async function enableMarketplaceExtension(stateDir: string, extensionId: string): Promise<InstalledExtensionRecord> {
  return setInstalledExtensionEnabled(stateDir, extensionId, true);
}

export async function disableMarketplaceExtension(stateDir: string, extensionId: string): Promise<InstalledExtensionRecord> {
  return setInstalledExtensionEnabled(stateDir, extensionId, false);
}

export async function uninstallMarketplaceExtension(
  input: UninstallMarketplaceExtensionInput,
): Promise<{ removed: InstalledExtensionRecord }> {
  const installed = await getInstalledExtension(input.stateDir, input.extensionId);
  if (!installed) {
    throw new Error(`Installed extension not found: ${input.extensionId}`);
  }
  await fs.rm(installed.installPath, { recursive: true, force: true }).catch(() => {});
  await removeInstalledExtension(input.stateDir, input.extensionId);
  return { removed: installed };
}

