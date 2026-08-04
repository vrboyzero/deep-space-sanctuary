import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  BELLDANDY_ISOLATED_EXTENSION_HOST_API_VERSION,
  BELLDANDY_LEGACY_EXTENSION_HOST_API_VERSION,
  formatExtensionId,
  isSupportedExtensionHostApi,
  parseExtensionManifest,
  type ExtensionManifest,
  type ExtensionMarketplaceSource,
} from "@belldandy/plugins";
import { FilesystemCapability } from "@belldandy/protocol";

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
  beginMarketplaceExtensionAudit,
  completeMarketplaceExtensionAudit,
  markMarketplaceExtensionAuditUncertain,
  reconcileMarketplaceExtensionAudits,
  type MarketplaceExtensionAuditRecord,
} from "./extension-marketplace-audit.js";
import {
  computeExtensionMarketplaceSourceKey,
  computeMaterializedExtensionContentSha256,
  getExtensionMarketplaceMaterializedDir,
  getMaterializedExtensionPath,
  materializeExtensionMarketplaceSource,
  prepareExtensionMarketplaceSource,
  type MaterializedExtensionMarketplaceSource,
  type PrepareExtensionMarketplaceSourceResult,
} from "./extension-marketplace-source.js";
import { assertExtensionRuntimeInactive, listExtensionRuntimeLeases } from "./extension-runtime-lease.js";

const DEFAULT_MANIFEST_PATH = "belldandy-extension.json";

export interface InstallMarketplaceExtensionInput {
  stateDir: string;
  marketplace: string;
  source: ExtensionMarketplaceSource;
  manifestPath?: string;
  autoUpdate?: boolean;
  enabled?: boolean;
  confirmationHash?: string;
}

export interface MarketplaceExtensionInstallPreview {
  version: 1;
  operation: "install";
  marketplace: string;
  extensionId: string;
  sourceKey: string;
  contentSha256: string;
  manifestPath: string;
  versionLabel: string;
  hostApi: number;
  permissions: string[];
  enabled: boolean;
  autoUpdate: boolean;
  confirmationHash: string;
}

export interface InstallMarketplaceExtensionResult {
  marketplace: string;
  preparedSource: PrepareExtensionMarketplaceSourceResult;
  materialized: MaterializedExtensionMarketplaceSource;
  manifest: ExtensionManifest;
  installed: InstalledExtensionRecord;
  audit: MarketplaceExtensionAuditRecord;
}

type InstallMarketplaceExtensionMaterializedResult = Omit<InstallMarketplaceExtensionResult, "audit">;

export interface UpdateMarketplaceExtensionInput {
  stateDir: string;
  extensionId: string;
  confirmationHash?: string;
  runtimeCoordinator?: MarketplaceExtensionRuntimeCoordinator;
}

export interface MarketplaceExtensionUpdatePreview
  extends Omit<MarketplaceExtensionInstallPreview, "operation" | "confirmationHash"> {
  operation: "update";
  currentContentSha256?: string;
  currentVersion?: string;
  currentHostApi?: number;
  currentPermissions?: string[];
  confirmationHash: string;
}

export interface UninstallMarketplaceExtensionInput {
  stateDir: string;
  extensionId: string;
  confirmationHash?: string;
  runtimeCoordinator?: MarketplaceExtensionRuntimeCoordinator;
}

export type MarketplaceExtensionRuntimeMutation = "disable" | "update" | "uninstall";

export interface MarketplaceExtensionRuntimeCoordinator {
  revokeForMutation(input: {
    extensionId: string;
    operation: MarketplaceExtensionRuntimeMutation;
  }): Promise<void>;
}

export interface MarketplaceExtensionMutationOptions {
  runtimeCoordinator?: MarketplaceExtensionRuntimeCoordinator;
}

export interface MarketplaceExtensionUninstallPreview {
  version: 1;
  operation: "uninstall";
  extensionId: string;
  installPath: string;
  sourceKey?: string;
  contentSha256?: string;
  versionLabel?: string;
  hostApi?: number;
  permissions: string[];
  enabled: boolean;
  confirmationHash: string;
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

function hashTrustConfirmation(value: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isSamePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function resolveManagedExtensionRemovalPath(
  stateDir: string,
  extension: InstalledExtensionRecord,
): string {
  const expectedPath = getMaterializedExtensionPath(stateDir, extension.marketplace, extension.name);
  if (!isSamePath(extension.installPath, expectedPath)) {
    throw new Error("Marketplace extension install path is outside the managed materialized root.");
  }

  try {
    const materializedRoot = new FilesystemCapability({
      rootPath: getExtensionMarketplaceMaterializedDir(stateDir),
      label: "marketplace materialized root",
    });
    return materializedRoot.resolveForRemovalPath(expectedPath, "marketplace extension install path");
  } catch {
    throw new Error("Marketplace extension install path is outside the managed materialized root.");
  }
}

async function quiesceMarketplaceExtensionRuntime(input: {
  stateDir: string;
  extensionId: string;
  operation: MarketplaceExtensionRuntimeMutation;
  runtimeCoordinator?: MarketplaceExtensionRuntimeCoordinator;
}): Promise<void> {
  const leases = await listExtensionRuntimeLeases(input.stateDir);
  const active = leases.some((lease) => lease.extensionId === input.extensionId);
  if (active) {
    if (!input.runtimeCoordinator) {
      throw new Error(`Marketplace extension runtime is active; revoke it before mutation: ${input.extensionId}`);
    }
    await input.runtimeCoordinator.revokeForMutation({
      extensionId: input.extensionId,
      operation: input.operation,
    });
  }
  await assertExtensionRuntimeInactive(input.stateDir, input.extensionId);
}

async function assertMarketplaceExtensionMutationResolved(
  stateDir: string,
  extensionId: string,
  operation: MarketplaceExtensionAuditRecord["operation"],
  confirmationHash?: string,
): Promise<void> {
  const audits = await reconcileMarketplaceExtensionAudits(stateDir);
  const unresolved = audits.find((audit) =>
    audit.extensionId === extensionId
    && (audit.status === "confirmed" || audit.status === "uncertain"));
  if (unresolved) {
    throw new Error(
      `Unresolved marketplace extension audit blocks mutation: ${unresolved.auditId} (${unresolved.operation}).`,
    );
  }
  const completed = confirmationHash
    ? audits.find((audit) =>
      audit.extensionId === extensionId
      && audit.operation === operation
      && audit.confirmationHash === confirmationHash
      && audit.status === "completed")
    : undefined;
  if (completed) {
    throw new Error(`Marketplace extension audit already completed: ${completed.auditId} (${completed.operation}).`);
  }
}

function assertInstallableManifestTrust(manifest: ExtensionManifest): void {
  if (!manifest.compatibility) {
    throw new Error("Marketplace extension must declare compatibility.hostApi.");
  }
  if (!isSupportedExtensionHostApi(manifest.kind, manifest.compatibility.hostApi)) {
    throw new Error(
      `Marketplace extension host API ${manifest.compatibility.hostApi} is incompatible with supported APIs ${BELLDANDY_LEGACY_EXTENSION_HOST_API_VERSION} and ${BELLDANDY_ISOLATED_EXTENSION_HOST_API_VERSION}.`,
    );
  }
  if (
    manifest.kind === "plugin"
    && manifest.compatibility.hostApi === BELLDANDY_ISOLATED_EXTENSION_HOST_API_VERSION
  ) {
    if (!manifest.runtime) {
      throw new Error("Marketplace Host API v2 plugin must declare runtime.capabilities.");
    }
    if (manifest.runtime.capabilities.length > 0) {
      throw new Error("Marketplace Host API v2 plugin broker capabilities are not supported.");
    }
  }
  if (!manifest.permissions) {
    throw new Error("Marketplace extension must declare permissions.");
  }

  const declaredSkillDirs = new Set(
    (manifest.entry.skillDirs ?? []).map((skillDir) => skillDir.replace(/\\/g, "/")),
  );
  const approvedSkillDirs = new Set(
    manifest.permissions.filter((permission) => permission.startsWith("skill:"))
      .map((permission) => permission.slice("skill:".length)),
  );
  if (
    declaredSkillDirs.size !== approvedSkillDirs.size
    || [...declaredSkillDirs].some((skillDir) => !approvedSkillDirs.has(skillDir))
  ) {
    throw new Error("Marketplace extension skill permissions must match entry.skillDirs.");
  }
  if (
    manifest.kind === "skill-pack"
    && manifest.permissions.some((permission) => !permission.startsWith("skill:"))
  ) {
    throw new Error("Marketplace skill-pack permissions may only approve skill directories.");
  }
}

export async function previewMarketplaceExtensionInstall(
  input: Omit<InstallMarketplaceExtensionInput, "confirmationHash">,
): Promise<MarketplaceExtensionInstallPreview> {
  if (input.source.source !== "directory") {
    throw new Error(`Marketplace source ${input.source.source} is not ready for trust preview.`);
  }
  const sourceRoot = await fs.realpath(path.resolve(input.source.path));
  const sourceStat = await fs.stat(sourceRoot);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Marketplace source path is not a directory: ${sourceRoot}`);
  }

  const manifestPath = resolveManifestPath(input.source, input.manifestPath);
  const manifestFilePath = path.resolve(sourceRoot, manifestPath);
  const relativeManifestPath = path.relative(sourceRoot, manifestFilePath);
  if (relativeManifestPath.startsWith("..") || path.isAbsolute(relativeManifestPath)) {
    throw new Error("manifestPath escapes marketplace source root.");
  }
  const contentSha256 = await computeMaterializedExtensionContentSha256(sourceRoot);
  const manifest = parseExtensionManifest(
    JSON.parse(await fs.readFile(manifestFilePath, "utf-8")) as unknown,
  );
  assertInstallableManifestTrust(manifest);

  const previewBinding = {
    version: 1,
    operation: "install",
    marketplace: input.marketplace,
    extensionId: formatExtensionId(manifest.name, input.marketplace),
    sourceKey: computeExtensionMarketplaceSourceKey(input.source),
    contentSha256,
    manifestPath,
    versionLabel: manifest.version,
    hostApi: manifest.compatibility!.hostApi,
    permissions: [...manifest.permissions!],
    enabled: input.enabled !== false,
    autoUpdate: input.autoUpdate === true,
  } as const;
  return {
    ...previewBinding,
    permissions: [...previewBinding.permissions],
    confirmationHash: hashTrustConfirmation(previewBinding),
  };
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
  expectedContentSha256: string;
}): Promise<InstallMarketplaceExtensionMaterializedResult> {
  const manifest = await loadManifestFromPreparedSource(input.preparedSource, input.manifestPath);
  assertInstallableManifestTrust(manifest);
  const materialized = await materializeExtensionMarketplaceSource({
    stateDir: input.stateDir,
    marketplace: input.marketplace,
    extensionName: manifest.name,
    manifestPath: input.manifestPath,
    sourceState: input.preparedSource,
    expectedContentSha256: input.expectedContentSha256,
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
    approvedHostApi: manifest.compatibility!.hostApi,
    approvedPermissions: manifest.permissions!,
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
  const preview = await previewMarketplaceExtensionInstall(input);
  await assertMarketplaceExtensionMutationResolved(
    input.stateDir,
    preview.extensionId,
    "install",
    input.confirmationHash,
  );
  if (!input.confirmationHash || input.confirmationHash !== preview.confirmationHash) {
    throw new Error("Marketplace extension installation requires an exact trust preview confirmation.");
  }
  const pendingAudit = await beginMarketplaceExtensionAudit(input.stateDir, {
    operation: "install",
    extensionId: preview.extensionId,
    confirmationHash: preview.confirmationHash,
    sourceKey: preview.sourceKey,
    contentSha256: preview.contentSha256,
    versionLabel: preview.versionLabel,
    hostApi: preview.hostApi,
    permissions: preview.permissions,
    enabled: preview.enabled,
  });
  try {
    const manifestPath = resolveManifestPath(input.source, input.manifestPath);
    const preparedSource = await prepareExtensionMarketplaceSource({
      stateDir: input.stateDir,
      marketplace: input.marketplace,
      source: input.source,
    });
    const result = await installMarketplaceExtensionWithPreparedSource({
      stateDir: input.stateDir,
      marketplace: input.marketplace,
      source: input.source,
      preparedSource,
      manifestPath,
      autoUpdate: input.autoUpdate === true,
      enabled: input.enabled !== false,
      expectedContentSha256: preview.contentSha256,
    });
    const audit = await completeMarketplaceExtensionAudit(input.stateDir, pendingAudit);
    return { ...result, audit };
  } catch (error) {
    await markMarketplaceExtensionAuditUncertain(input.stateDir, pendingAudit).catch(() => {});
    throw error;
  }
}

export async function updateMarketplaceExtension(
  input: UpdateMarketplaceExtensionInput,
): Promise<InstallMarketplaceExtensionResult> {
  await assertMarketplaceExtensionMutationResolved(
    input.stateDir,
    input.extensionId,
    "update",
    input.confirmationHash,
  );
  const preview = await previewMarketplaceExtensionUpdate(input);
  if (!input.confirmationHash || input.confirmationHash !== preview.confirmationHash) {
    throw new Error("Marketplace extension update requires an exact trust preview confirmation.");
  }
  const installed = await getInstalledExtension(input.stateDir, input.extensionId);
  if (!installed) {
    throw new Error(`Installed extension not found: ${input.extensionId}`);
  }
  await quiesceMarketplaceExtensionRuntime({
    stateDir: input.stateDir,
    extensionId: input.extensionId,
    operation: "update",
    runtimeCoordinator: input.runtimeCoordinator,
  });
  const knownMarketplace = await getKnownMarketplace(input.stateDir, installed.marketplace);
  if (!knownMarketplace) {
    throw new Error(`Known marketplace not found: ${installed.marketplace}`);
  }

  const pendingAudit = await beginMarketplaceExtensionAudit(input.stateDir, {
    operation: "update",
    extensionId: preview.extensionId,
    confirmationHash: preview.confirmationHash,
    sourceKey: preview.sourceKey,
    contentSha256: preview.contentSha256,
    previousContentSha256: preview.currentContentSha256,
    versionLabel: preview.versionLabel,
    hostApi: preview.hostApi,
    permissions: preview.permissions,
    enabled: preview.enabled,
  });
  try {
    const preparedSource = await prepareExtensionMarketplaceSource({
      stateDir: input.stateDir,
      marketplace: installed.marketplace,
      source: knownMarketplace.source,
    });
    const result = await installMarketplaceExtensionWithPreparedSource({
      stateDir: input.stateDir,
      marketplace: installed.marketplace,
      source: knownMarketplace.source,
      preparedSource,
      manifestPath: assertRelativeManifestPath(installed.manifestPath),
      autoUpdate: knownMarketplace.autoUpdate,
      enabled: installed.enabled,
      previousInstalledAt: installed.installedAt,
      expectedContentSha256: preview.contentSha256,
    });
    const audit = await completeMarketplaceExtensionAudit(input.stateDir, pendingAudit);
    return { ...result, audit };
  } catch (error) {
    await markMarketplaceExtensionAuditUncertain(input.stateDir, pendingAudit).catch(() => {});
    throw error;
  }
}

export async function previewMarketplaceExtensionUpdate(
  input: Omit<UpdateMarketplaceExtensionInput, "confirmationHash">,
): Promise<MarketplaceExtensionUpdatePreview> {
  const installed = await getInstalledExtension(input.stateDir, input.extensionId);
  if (!installed) {
    throw new Error(`Installed extension not found: ${input.extensionId}`);
  }
  const knownMarketplace = await getKnownMarketplace(input.stateDir, installed.marketplace);
  if (!knownMarketplace) {
    throw new Error(`Known marketplace not found: ${installed.marketplace}`);
  }

  const next = await previewMarketplaceExtensionInstall({
    stateDir: input.stateDir,
    marketplace: installed.marketplace,
    source: knownMarketplace.source,
    manifestPath: installed.manifestPath,
    autoUpdate: knownMarketplace.autoUpdate,
    enabled: installed.enabled,
  });
  if (next.extensionId !== installed.id) {
    throw new Error("Marketplace extension update cannot change the approved extension identity.");
  }
  const { confirmationHash: _installConfirmationHash, ...nextBinding } = next;
  const previewBinding = {
    ...nextBinding,
    operation: "update" as const,
    currentContentSha256: installed.contentSha256,
    currentVersion: installed.version,
    currentHostApi: installed.approvedHostApi,
    currentPermissions: installed.approvedPermissions ? [...installed.approvedPermissions] : undefined,
  };
  return {
    ...previewBinding,
    confirmationHash: hashTrustConfirmation(previewBinding),
  };
}

export async function enableMarketplaceExtension(stateDir: string, extensionId: string): Promise<InstalledExtensionRecord> {
  return setInstalledExtensionEnabled(stateDir, extensionId, true);
}

export async function disableMarketplaceExtension(
  stateDir: string,
  extensionId: string,
  options: MarketplaceExtensionMutationOptions = {},
): Promise<InstalledExtensionRecord> {
  await quiesceMarketplaceExtensionRuntime({
    stateDir,
    extensionId,
    operation: "disable",
    runtimeCoordinator: options.runtimeCoordinator,
  });
  return setInstalledExtensionEnabled(stateDir, extensionId, false);
}

export async function uninstallMarketplaceExtension(
  input: UninstallMarketplaceExtensionInput,
): Promise<{ removed: InstalledExtensionRecord; audit: MarketplaceExtensionAuditRecord }> {
  await assertMarketplaceExtensionMutationResolved(
    input.stateDir,
    input.extensionId,
    "uninstall",
    input.confirmationHash,
  );
  const preview = await previewMarketplaceExtensionUninstall(input);
  if (!input.confirmationHash || input.confirmationHash !== preview.confirmationHash) {
    throw new Error("Marketplace extension uninstall requires an exact trust preview confirmation.");
  }
  const installed = await getInstalledExtension(input.stateDir, input.extensionId);
  if (!installed) {
    throw new Error(`Installed extension not found: ${input.extensionId}`);
  }
  await quiesceMarketplaceExtensionRuntime({
    stateDir: input.stateDir,
    extensionId: input.extensionId,
    operation: "uninstall",
    runtimeCoordinator: input.runtimeCoordinator,
  });
  const pendingAudit = await beginMarketplaceExtensionAudit(input.stateDir, {
    operation: "uninstall",
    extensionId: preview.extensionId,
    confirmationHash: preview.confirmationHash,
    sourceKey: preview.sourceKey,
    contentSha256: preview.contentSha256,
    versionLabel: preview.versionLabel,
    hostApi: preview.hostApi,
    permissions: preview.permissions,
    enabled: preview.enabled,
  });
  try {
    const managedInstallPath = resolveManagedExtensionRemovalPath(input.stateDir, installed);
    await fs.rm(managedInstallPath, { recursive: true, force: true });
    await removeInstalledExtension(input.stateDir, input.extensionId);
    const audit = await completeMarketplaceExtensionAudit(input.stateDir, pendingAudit);
    return { removed: installed, audit };
  } catch (error) {
    await markMarketplaceExtensionAuditUncertain(input.stateDir, pendingAudit).catch(() => {});
    throw error;
  }
}

export async function previewMarketplaceExtensionUninstall(
  input: Omit<UninstallMarketplaceExtensionInput, "confirmationHash">,
): Promise<MarketplaceExtensionUninstallPreview> {
  const installed = await getInstalledExtension(input.stateDir, input.extensionId);
  if (!installed) {
    throw new Error(`Installed extension not found: ${input.extensionId}`);
  }
  const previewBinding = {
    version: 1 as const,
    operation: "uninstall" as const,
    extensionId: installed.id,
    installPath: path.resolve(installed.installPath),
    sourceKey: installed.sourceKey,
    contentSha256: installed.contentSha256,
    versionLabel: installed.version,
    hostApi: installed.approvedHostApi,
    permissions: installed.approvedPermissions ? [...installed.approvedPermissions] : [],
    enabled: installed.enabled,
  };
  return {
    ...previewBinding,
    confirmationHash: hashTrustConfirmation(previewBinding),
  };
}

