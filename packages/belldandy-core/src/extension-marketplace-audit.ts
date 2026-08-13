import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteMarketplaceJson } from "./extension-marketplace-atomic-write.js";
import {
  getExtensionMarketplaceStateDir,
  getInstalledExtensionsLedgerPath,
  loadInstalledExtensionLedger,
  type InstalledExtensionRecord,
} from "./extension-marketplace-state.js";

export type MarketplaceExtensionAuditOperation = "install" | "update" | "uninstall";
export type MarketplaceExtensionAuditStatus = "confirmed" | "completed" | "failed" | "uncertain";

export interface MarketplaceExtensionAuditRecord {
  version: 1;
  auditId: string;
  operation: MarketplaceExtensionAuditOperation;
  extensionId: string;
  confirmationHash: string;
  sourceKey?: string;
  contentSha256?: string;
  previousContentSha256?: string;
  versionLabel?: string;
  hostApi?: number;
  permissions: string[];
  enabled: boolean;
  status: MarketplaceExtensionAuditStatus;
  createdAt: string;
  completedAt?: string;
}

export type BeginMarketplaceExtensionAuditInput = Omit<
  MarketplaceExtensionAuditRecord,
  "version" | "auditId" | "status" | "createdAt" | "completedAt"
>;

const AUDIT_DIRNAME = "audit";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const AUDIT_ID_PATTERN = /^extension-audit-[0-9a-f-]{36}$/;

function getMarketplaceExtensionAuditDir(stateDir: string): string {
  return path.join(getExtensionMarketplaceStateDir(stateDir), AUDIT_DIRNAME);
}

function getMarketplaceExtensionAuditPath(stateDir: string, auditId: string): string {
  if (!AUDIT_ID_PATTERN.test(auditId)) throw new Error("Marketplace extension audit id is invalid.");
  return path.join(getMarketplaceExtensionAuditDir(stateDir), `${auditId}.json`);
}

async function atomicWriteAudit(stateDir: string, record: MarketplaceExtensionAuditRecord): Promise<void> {
  const targetPath = getMarketplaceExtensionAuditPath(stateDir, record.auditId);
  await atomicWriteMarketplaceJson(targetPath, record, { trailingNewline: true });
}

function parseAuditRecord(value: unknown): MarketplaceExtensionAuditRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Marketplace extension audit record must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1
    || typeof record.auditId !== "string" || !AUDIT_ID_PATTERN.test(record.auditId)
    || (record.operation !== "install" && record.operation !== "update" && record.operation !== "uninstall")
    || typeof record.extensionId !== "string" || !record.extensionId
    || typeof record.confirmationHash !== "string" || !SHA256_PATTERN.test(record.confirmationHash)
    || !Array.isArray(record.permissions) || record.permissions.some((item) => typeof item !== "string")
    || typeof record.enabled !== "boolean"
    || (
      record.status !== "confirmed"
      && record.status !== "completed"
      && record.status !== "failed"
      && record.status !== "uncertain"
    )
    || typeof record.createdAt !== "string" || !record.createdAt
  ) {
    throw new Error("Marketplace extension audit record is invalid.");
  }
  return {
    version: 1,
    auditId: record.auditId,
    operation: record.operation,
    extensionId: record.extensionId,
    confirmationHash: record.confirmationHash,
    sourceKey: typeof record.sourceKey === "string" ? record.sourceKey : undefined,
    contentSha256: typeof record.contentSha256 === "string" ? record.contentSha256 : undefined,
    previousContentSha256: typeof record.previousContentSha256 === "string"
      ? record.previousContentSha256
      : undefined,
    versionLabel: typeof record.versionLabel === "string" ? record.versionLabel : undefined,
    hostApi: typeof record.hostApi === "number" ? record.hostApi : undefined,
    permissions: [...record.permissions] as string[],
    enabled: record.enabled,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
  };
}

export async function beginMarketplaceExtensionAudit(
  stateDir: string,
  input: BeginMarketplaceExtensionAuditInput,
): Promise<MarketplaceExtensionAuditRecord> {
  const record: MarketplaceExtensionAuditRecord = {
    version: 1,
    auditId: `extension-audit-${crypto.randomUUID()}`,
    ...input,
    permissions: [...input.permissions],
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };
  await atomicWriteAudit(stateDir, record);
  return record;
}

export async function completeMarketplaceExtensionAudit(
  stateDir: string,
  record: MarketplaceExtensionAuditRecord,
): Promise<MarketplaceExtensionAuditRecord> {
  const completed: MarketplaceExtensionAuditRecord = {
    ...record,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  await atomicWriteAudit(stateDir, completed);
  return completed;
}

export async function failMarketplaceExtensionAudit(
  stateDir: string,
  record: MarketplaceExtensionAuditRecord,
): Promise<void> {
  await atomicWriteAudit(stateDir, {
    ...record,
    status: "failed",
    completedAt: new Date().toISOString(),
  });
}

export async function markMarketplaceExtensionAuditUncertain(
  stateDir: string,
  record: MarketplaceExtensionAuditRecord,
): Promise<MarketplaceExtensionAuditRecord> {
  const uncertain: MarketplaceExtensionAuditRecord = {
    ...record,
    status: "uncertain",
    completedAt: undefined,
  };
  await atomicWriteAudit(stateDir, uncertain);
  return uncertain;
}

export async function listMarketplaceExtensionAudits(
  stateDir: string,
): Promise<MarketplaceExtensionAuditRecord[]> {
  const auditDir = getMarketplaceExtensionAuditDir(stateDir);
  const entries = await fs.readdir(auditDir, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
    throw error;
  });
  const records: MarketplaceExtensionAuditRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    records.push(parseAuditRecord(JSON.parse(await fs.readFile(path.join(auditDir, entry.name), "utf-8")) as unknown));
  }
  return records.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.auditId.localeCompare(right.auditId));
}

function installedRecordMatchesAudit(
  installed: InstalledExtensionRecord | undefined,
  audit: MarketplaceExtensionAuditRecord,
): boolean {
  return Boolean(
    installed
    && installed.status === "installed"
    && audit.sourceKey
    && installed.sourceKey === audit.sourceKey
    && audit.contentSha256
    && installed.contentSha256 === audit.contentSha256
    && installed.version === audit.versionLabel
    && installed.approvedHostApi === audit.hostApi
    && installed.enabled === audit.enabled
    && JSON.stringify(installed.approvedPermissions ?? []) === JSON.stringify(audit.permissions),
  );
}

async function installedExtensionLedgerExists(stateDir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(getInstalledExtensionsLedgerPath(stateDir));
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return false;
    throw error;
  }
}

export async function reconcileMarketplaceExtensionAudits(
  stateDir: string,
): Promise<MarketplaceExtensionAuditRecord[]> {
  const [audits, installedLedger, installedLedgerExists] = await Promise.all([
    listMarketplaceExtensionAudits(stateDir),
    loadInstalledExtensionLedger(stateDir),
    installedExtensionLedgerExists(stateDir),
  ]);
  const reconciled: MarketplaceExtensionAuditRecord[] = [];
  for (const audit of audits) {
    const installed = installedLedger.extensions[audit.extensionId];
    const targetCommitted = audit.operation === "uninstall"
      ? installedLedgerExists && installed === undefined
      : installedRecordMatchesAudit(installed, audit);
    if (
      (audit.status === "confirmed" || audit.status === "uncertain")
      && targetCommitted
    ) {
      reconciled.push(await completeMarketplaceExtensionAudit(stateDir, audit));
      continue;
    }
    if (audit.status === "confirmed") {
      reconciled.push(await markMarketplaceExtensionAuditUncertain(stateDir, audit));
      continue;
    }
    reconciled.push(audit);
  }
  return reconciled;
}
