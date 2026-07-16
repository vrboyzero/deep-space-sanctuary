import crypto from "node:crypto";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  formatExtensionId,
  isValidExtensionName,
  isValidMarketplaceName,
  parseExtensionMarketplaceSource,
  type ExtensionManifestKind,
  type ExtensionMarketplaceSource,
} from "@belldandy/plugins";

const EXTENSION_STATE_DIRNAME = "extensions";
const KNOWN_MARKETPLACES_FILENAME = "known-marketplaces.json";
const INSTALLED_EXTENSIONS_FILENAME = "installed-extensions.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export interface KnownMarketplaceRecord {
  name: string;
  source: ExtensionMarketplaceSource;
  installLocation?: string;
  autoUpdate: boolean;
  addedAt: string;
  lastUpdated?: string;
}

export interface KnownMarketplaceLedger {
  version: 1;
  marketplaces: Record<string, KnownMarketplaceRecord>;
  updatedAt: string;
}

export type InstalledExtensionStatus = "installed" | "pending" | "broken";

export interface InstalledExtensionRecord {
  id: string;
  name: string;
  kind: ExtensionManifestKind;
  marketplace: string;
  version?: string;
  manifestPath?: string;
  installPath: string;
  sourceKey?: string;
  /** 安装物化后的完整目录摘要；缺失时不得作为受信 Marketplace 扩展加载。 */
  contentSha256?: string;
  /** 与 contentSha256 同一批准动作产生的时间。 */
  approvedAt?: string;
  installedAt: string;
  lastUpdated?: string;
  status: InstalledExtensionStatus;
  enabled: boolean;
}

export interface InstalledExtensionLedger {
  version: 1;
  extensions: Record<string, InstalledExtensionRecord>;
  updatedAt: string;
}

export interface ExtensionMarketplaceStateSnapshot {
  knownMarketplaces: KnownMarketplaceLedger;
  installedExtensions: InstalledExtensionLedger;
  summary: {
    knownMarketplaceCount: number;
    autoUpdateMarketplaceCount: number;
    installedExtensionCount: number;
    installedPluginCount: number;
    installedSkillPackCount: number;
    pendingExtensionCount: number;
    brokenExtensionCount: number;
    disabledExtensionCount: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return assertString(value, label);
}

function assertOptionalSha256(value: unknown, label: string): string | undefined {
  const normalized = assertOptionalString(value, label);
  if (normalized !== undefined && !SHA256_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return normalized?.toLowerCase();
}

function assertMarketplaceName(value: unknown, label: string): string {
  const normalized = assertString(value, label);
  if (!isValidMarketplaceName(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function assertExtensionName(value: unknown, label: string): string {
  const normalized = assertString(value, label);
  if (!isValidExtensionName(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function assertExtensionKind(value: unknown, label: string): ExtensionManifestKind {
  if (value === "plugin" || value === "skill-pack") return value;
  throw new Error(`${label} must be "plugin" or "skill-pack".`);
}

function assertExtensionStatus(value: unknown, label: string): InstalledExtensionStatus {
  if (value === "installed" || value === "pending" || value === "broken") return value;
  throw new Error(`${label} is invalid.`);
}

async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tempPath, targetPath);
}

export function getExtensionMarketplaceStateDir(stateDir: string): string {
  return path.join(stateDir, EXTENSION_STATE_DIRNAME);
}

export function getKnownMarketplacesLedgerPath(stateDir: string): string {
  return path.join(getExtensionMarketplaceStateDir(stateDir), KNOWN_MARKETPLACES_FILENAME);
}

export function getInstalledExtensionsLedgerPath(stateDir: string): string {
  return path.join(getExtensionMarketplaceStateDir(stateDir), INSTALLED_EXTENSIONS_FILENAME);
}

export function createEmptyKnownMarketplaceLedger(): KnownMarketplaceLedger {
  return {
    version: 1,
    marketplaces: {},
    updatedAt: nowIso(),
  };
}

export function createEmptyInstalledExtensionLedger(): InstalledExtensionLedger {
  return {
    version: 1,
    extensions: {},
    updatedAt: nowIso(),
  };
}

function parseKnownMarketplaceRecord(
  name: string,
  input: unknown,
): KnownMarketplaceRecord {
  const record = isRecordLike(input) ? input : {};
  return {
    name: assertMarketplaceName(record.name ?? name, `Known marketplace "${name}".name`),
    source: parseExtensionMarketplaceSource(record.source, `Known marketplace "${name}".source`),
    installLocation: assertOptionalString(record.installLocation, `Known marketplace "${name}".installLocation`),
    autoUpdate: record.autoUpdate === undefined ? false : Boolean(record.autoUpdate),
    addedAt: assertString(record.addedAt, `Known marketplace "${name}".addedAt`),
    lastUpdated: assertOptionalString(record.lastUpdated, `Known marketplace "${name}".lastUpdated`),
  };
}

function parseInstalledExtensionRecord(
  id: string,
  input: unknown,
): InstalledExtensionRecord {
  const record = isRecordLike(input) ? input : {};
  const name = assertExtensionName(record.name, `Installed extension "${id}".name`);
  const marketplace = assertMarketplaceName(record.marketplace, `Installed extension "${id}".marketplace`);
  const expectedId = formatExtensionId(name, marketplace);
  if (id !== expectedId) {
    throw new Error(`Installed extension id "${id}" does not match "${expectedId}".`);
  }

  return {
    id,
    name,
    kind: assertExtensionKind(record.kind, `Installed extension "${id}".kind`),
    marketplace,
    version: assertOptionalString(record.version, `Installed extension "${id}".version`),
    manifestPath: assertOptionalString(record.manifestPath, `Installed extension "${id}".manifestPath`),
    installPath: assertString(record.installPath, `Installed extension "${id}".installPath`),
    sourceKey: assertOptionalString(record.sourceKey, `Installed extension "${id}".sourceKey`),
    contentSha256: assertOptionalSha256(record.contentSha256, `Installed extension "${id}".contentSha256`),
    approvedAt: assertOptionalString(record.approvedAt, `Installed extension "${id}".approvedAt`),
    installedAt: assertString(record.installedAt, `Installed extension "${id}".installedAt`),
    lastUpdated: assertOptionalString(record.lastUpdated, `Installed extension "${id}".lastUpdated`),
    status: assertExtensionStatus(record.status, `Installed extension "${id}".status`),
    enabled: record.enabled === undefined ? true : Boolean(record.enabled),
  };
}

export async function loadKnownMarketplaceLedger(stateDir: string): Promise<KnownMarketplaceLedger> {
  const ledgerPath = getKnownMarketplacesLedgerPath(stateDir);
  try {
    const raw = await fs.readFile(ledgerPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecordLike(parsed) || parsed.version !== 1 || !isRecordLike(parsed.marketplaces)) {
      throw new Error("Invalid known marketplaces ledger schema.");
    }
    const marketplaces = Object.fromEntries(
      Object.entries(parsed.marketplaces).map(([name, record]) => [name, parseKnownMarketplaceRecord(name, record)]),
    );
    return {
      version: 1,
      marketplaces,
      updatedAt: assertString(parsed.updatedAt, "Known marketplaces ledger.updatedAt"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return createEmptyKnownMarketplaceLedger();
    }
    throw error;
  }
}

export async function saveKnownMarketplaceLedger(stateDir: string, ledger: KnownMarketplaceLedger): Promise<void> {
  await atomicWriteJson(getKnownMarketplacesLedgerPath(stateDir), {
    ...ledger,
    version: 1,
    updatedAt: nowIso(),
  } satisfies KnownMarketplaceLedger);
}

export async function upsertKnownMarketplace(
  stateDir: string,
  record: Omit<KnownMarketplaceRecord, "addedAt"> & { addedAt?: string },
): Promise<KnownMarketplaceLedger> {
  const ledger = await loadKnownMarketplaceLedger(stateDir);
  const name = assertMarketplaceName(record.name, "Known marketplace.name");
  const existing = ledger.marketplaces[name];
  const nextRecord: KnownMarketplaceRecord = {
    name,
    source: parseExtensionMarketplaceSource(record.source, `Known marketplace "${name}".source`),
    installLocation: record.installLocation?.trim() || undefined,
    autoUpdate: record.autoUpdate === true,
    addedAt: existing?.addedAt ?? record.addedAt ?? nowIso(),
    lastUpdated: record.lastUpdated?.trim() || undefined,
  };
  const nextLedger: KnownMarketplaceLedger = {
    version: 1,
    marketplaces: {
      ...ledger.marketplaces,
      [name]: nextRecord,
    },
    updatedAt: nowIso(),
  };
  await saveKnownMarketplaceLedger(stateDir, nextLedger);
  return nextLedger;
}

export async function removeKnownMarketplace(stateDir: string, name: string): Promise<KnownMarketplaceLedger> {
  const normalized = assertMarketplaceName(name, "Known marketplace.name");
  const ledger = await loadKnownMarketplaceLedger(stateDir);
  const nextMarketplaces = { ...ledger.marketplaces };
  delete nextMarketplaces[normalized];
  const nextLedger: KnownMarketplaceLedger = {
    version: 1,
    marketplaces: nextMarketplaces,
    updatedAt: nowIso(),
  };
  await saveKnownMarketplaceLedger(stateDir, nextLedger);
  return nextLedger;
}

export async function listKnownMarketplaces(stateDir: string): Promise<KnownMarketplaceRecord[]> {
  const ledger = await loadKnownMarketplaceLedger(stateDir);
  return Object.values(ledger.marketplaces).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getKnownMarketplace(stateDir: string, name: string): Promise<KnownMarketplaceRecord | undefined> {
  const ledger = await loadKnownMarketplaceLedger(stateDir);
  const normalized = assertMarketplaceName(name, "Known marketplace.name");
  return ledger.marketplaces[normalized];
}

export async function loadInstalledExtensionLedger(stateDir: string): Promise<InstalledExtensionLedger> {
  const ledgerPath = getInstalledExtensionsLedgerPath(stateDir);
  try {
    const raw = await fs.readFile(ledgerPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecordLike(parsed) || parsed.version !== 1 || !isRecordLike(parsed.extensions)) {
      throw new Error("Invalid installed extensions ledger schema.");
    }
    const extensions = Object.fromEntries(
      Object.entries(parsed.extensions).map(([id, record]) => [id, parseInstalledExtensionRecord(id, record)]),
    );
    return {
      version: 1,
      extensions,
      updatedAt: assertString(parsed.updatedAt, "Installed extensions ledger.updatedAt"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return createEmptyInstalledExtensionLedger();
    }
    throw error;
  }
}

export async function saveInstalledExtensionLedger(stateDir: string, ledger: InstalledExtensionLedger): Promise<void> {
  await atomicWriteJson(getInstalledExtensionsLedgerPath(stateDir), {
    ...ledger,
    version: 1,
    updatedAt: nowIso(),
  } satisfies InstalledExtensionLedger);
}

export async function upsertInstalledExtension(
  stateDir: string,
  record: Omit<InstalledExtensionRecord, "id" | "installedAt"> & { id?: string; installedAt?: string },
): Promise<InstalledExtensionLedger> {
  const name = assertExtensionName(record.name, "Installed extension.name");
  const marketplace = assertMarketplaceName(record.marketplace, "Installed extension.marketplace");
  const id = record.id?.trim() || formatExtensionId(name, marketplace);
  const expectedId = formatExtensionId(name, marketplace);
  if (id !== expectedId) {
    throw new Error(`Installed extension.id must match "${expectedId}".`);
  }

  const ledger = await loadInstalledExtensionLedger(stateDir);
  const existing = ledger.extensions[id];
  const nextRecord: InstalledExtensionRecord = {
    id,
    name,
    kind: record.kind,
    marketplace,
    version: record.version?.trim() || undefined,
    manifestPath: record.manifestPath?.trim() || undefined,
    installPath: assertString(record.installPath, "Installed extension.installPath"),
    sourceKey: record.sourceKey?.trim() || undefined,
    contentSha256: assertOptionalSha256(record.contentSha256, "Installed extension.contentSha256"),
    approvedAt: record.approvedAt?.trim() || undefined,
    installedAt: existing?.installedAt ?? record.installedAt ?? nowIso(),
    lastUpdated: record.lastUpdated?.trim() || undefined,
    status: record.status,
    enabled: record.enabled !== false,
  };
  const nextLedger: InstalledExtensionLedger = {
    version: 1,
    extensions: {
      ...ledger.extensions,
      [id]: nextRecord,
    },
    updatedAt: nowIso(),
  };
  await saveInstalledExtensionLedger(stateDir, nextLedger);
  return nextLedger;
}

export async function removeInstalledExtension(stateDir: string, extensionId: string): Promise<InstalledExtensionLedger> {
  const normalized = assertString(extensionId, "Installed extension.id");
  const ledger = await loadInstalledExtensionLedger(stateDir);
  const nextExtensions = { ...ledger.extensions };
  delete nextExtensions[normalized];
  const nextLedger: InstalledExtensionLedger = {
    version: 1,
    extensions: nextExtensions,
    updatedAt: nowIso(),
  };
  await saveInstalledExtensionLedger(stateDir, nextLedger);
  return nextLedger;
}

export async function listInstalledExtensions(stateDir: string): Promise<InstalledExtensionRecord[]> {
  const ledger = await loadInstalledExtensionLedger(stateDir);
  return Object.values(ledger.extensions).sort((a, b) => a.id.localeCompare(b.id));
}

export async function getInstalledExtension(stateDir: string, extensionId: string): Promise<InstalledExtensionRecord | undefined> {
  const ledger = await loadInstalledExtensionLedger(stateDir);
  const normalized = assertString(extensionId, "Installed extension.id");
  return ledger.extensions[normalized];
}

export async function setInstalledExtensionEnabled(
  stateDir: string,
  extensionId: string,
  enabled: boolean,
): Promise<InstalledExtensionRecord> {
  const ledger = await loadInstalledExtensionLedger(stateDir);
  const normalized = assertString(extensionId, "Installed extension.id");
  const existing = ledger.extensions[normalized];
  if (!existing) {
    throw new Error(`Installed extension not found: ${normalized}`);
  }

  const nextRecord: InstalledExtensionRecord = {
    ...existing,
    enabled,
    lastUpdated: nowIso(),
  };
  const nextLedger: InstalledExtensionLedger = {
    version: 1,
    extensions: {
      ...ledger.extensions,
      [normalized]: nextRecord,
    },
    updatedAt: nowIso(),
  };
  await saveInstalledExtensionLedger(stateDir, nextLedger);
  return nextRecord;
}

export async function loadExtensionMarketplaceState(stateDir: string): Promise<ExtensionMarketplaceStateSnapshot> {
  const [knownMarketplaces, installedExtensions] = await Promise.all([
    loadKnownMarketplaceLedger(stateDir),
    loadInstalledExtensionLedger(stateDir),
  ]);
  const installedExtensionItems = Object.values(installedExtensions.extensions);
  return {
    knownMarketplaces,
    installedExtensions,
    summary: {
      knownMarketplaceCount: Object.keys(knownMarketplaces.marketplaces).length,
      autoUpdateMarketplaceCount: Object.values(knownMarketplaces.marketplaces).filter((item) => item.autoUpdate).length,
      installedExtensionCount: installedExtensionItems.length,
      installedPluginCount: installedExtensionItems.filter((item) => item.kind === "plugin").length,
      installedSkillPackCount: installedExtensionItems.filter((item) => item.kind === "skill-pack").length,
      pendingExtensionCount: installedExtensionItems.filter((item) => item.status === "pending").length,
      brokenExtensionCount: installedExtensionItems.filter((item) => item.status === "broken").length,
      disabledExtensionCount: installedExtensionItems.filter((item) => !item.enabled).length,
    },
  };
}
