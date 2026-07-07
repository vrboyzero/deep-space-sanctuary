import fs from "node:fs";
import path from "node:path";

import {
  cleanupPreflightCompressionSidecars,
} from "./preflight-compression-sidecar.js";
import {
  readPreflightCompressionPolicyFromEnv,
} from "./preflight-compression-config.js";

export type PreflightCompressionGovernanceReport = {
  summary: {
    status: "pass" | "warn";
    headline: string;
  };
  config: {
    enabled: boolean;
    mode: string;
    attachmentThresholdChars: number;
    targetRatio: number;
    minSavingsRatio: number;
    timeoutMs: number;
    attachmentReference: string;
    sidecarRetentionMs: number;
    sidecarMaxEntries: number;
    referenceStoreEnabled: boolean;
    persistentReferenceStoreEnabled: boolean;
    persistentReferenceTtlMs: number;
    persistentReferenceMaxEntries: number;
  };
  storage: {
    sidecars: Awaited<ReturnType<typeof cleanupPreflightCompressionSidecars>>;
    persistentReferences: PersistentReferenceStorageSummary;
  };
  checks: Array<{
    id: string;
    name: string;
    status: "pass" | "warn";
    message: string;
  }>;
};

const DEFAULT_PERSISTENT_REFERENCE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERSISTENT_REFERENCE_MAX_ENTRIES = 128;

type PersistentReferenceStorageSummary = {
  root: string;
  totalReferences: number;
  totalBytes: number;
  expiredCount: number;
  overLimitCount: number;
  removedCount: number;
  invalidCount: number;
  dryRun: boolean;
  ttlMs: number;
  maxEntries: number;
};

export async function buildPreflightCompressionGovernanceReport(input: {
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
}): Promise<PreflightCompressionGovernanceReport> {
  const env = input.env ?? process.env;
  const policy = readPreflightCompressionPolicyFromEnv(env);
  const referenceStoreEnabled = parseBoolean(env.BELLDANDY_COMPRESSION_REFERENCE_STORE, true);
  const persistentReferenceStoreEnabled = parseBoolean(env.BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_STORE, false);
  const persistentReferenceTtlMs = parsePositiveInteger(
    env.BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_TTL_MS,
    DEFAULT_PERSISTENT_REFERENCE_TTL_MS,
  );
  const persistentReferenceMaxEntries = parsePositiveInteger(
    env.BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_MAX_ENTRIES,
    DEFAULT_PERSISTENT_REFERENCE_MAX_ENTRIES,
  );
  const sidecars = await cleanupPreflightCompressionSidecars({
    stateDir: input.stateDir,
    retentionMs: policy.sidecarRetentionMs,
    maxEntries: policy.sidecarMaxEntries,
    now: input.now,
    dryRun: true,
  });
  const persistentReferences = inspectPersistentCompressionReferences({
    stateDir: input.stateDir,
    ttlMs: persistentReferenceTtlMs,
    maxEntries: persistentReferenceMaxEntries,
    now: input.now,
    dryRun: true,
  });
  const sidecarPendingRemoval = sidecars.expiredCount + sidecars.overLimitCount;
  const referencePendingRemoval = persistentReferences.expiredCount + persistentReferences.overLimitCount;
  const invalidCount = sidecars.invalidCount + persistentReferences.invalidCount;
  const status: "pass" | "warn" = invalidCount > 0 || sidecarPendingRemoval > 0 || referencePendingRemoval > 0
    ? "warn"
    : "pass";

  return {
    summary: {
      status,
      headline: [
        `preflight=${policy.enabled ? policy.mode : "off"}`,
        `sidecars=${sidecars.totalSidecars}`,
        `sidecarPendingCleanup=${sidecarPendingRemoval}`,
        `toolRefs=${persistentReferences.totalReferences}`,
        `toolRefPendingCleanup=${referencePendingRemoval}`,
      ].join(", "),
    },
    config: {
      enabled: policy.enabled,
      mode: policy.mode,
      attachmentThresholdChars: policy.attachmentThresholdChars,
      targetRatio: policy.targetRatio,
      minSavingsRatio: policy.minSavingsRatio,
      timeoutMs: policy.timeoutMs,
      attachmentReference: policy.attachmentReference,
      sidecarRetentionMs: policy.sidecarRetentionMs,
      sidecarMaxEntries: policy.sidecarMaxEntries,
      referenceStoreEnabled,
      persistentReferenceStoreEnabled,
      persistentReferenceTtlMs,
      persistentReferenceMaxEntries,
    },
    storage: {
      sidecars,
      persistentReferences,
    },
    checks: [
      {
        id: "preflight_compression_config",
        name: "Preflight Compression Config",
        status: policy.enabled ? "pass" : "warn",
        message: policy.enabled
          ? `enabled (${policy.mode}, attachment threshold ${policy.attachmentThresholdChars})`
          : "disabled",
      },
      {
        id: "preflight_sidecar_storage",
        name: "Preflight Sidecar Storage",
        status: sidecars.invalidCount > 0 || sidecarPendingRemoval > 0 ? "warn" : "pass",
        message: `${sidecars.totalSidecars} sidecar(s), ${sidecarPendingRemoval} pending cleanup, invalid=${sidecars.invalidCount}`,
      },
      {
        id: "compression_reference_storage",
        name: "Compression Reference Storage",
        status: persistentReferences.invalidCount > 0 || referencePendingRemoval > 0 ? "warn" : "pass",
        message: `${persistentReferences.totalReferences} persistent reference(s), ${referencePendingRemoval} pending cleanup, enabled=${persistentReferenceStoreEnabled ? "true" : "false"}`,
      },
    ],
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function inspectPersistentCompressionReferences(input: {
  stateDir: string;
  ttlMs: number;
  maxEntries: number;
  now?: number;
  dryRun?: boolean;
}): PersistentReferenceStorageSummary {
  const root = path.join(input.stateDir, "storage", "compression-references");
  const now = input.now ?? Date.now();
  const dryRun = input.dryRun === true;
  if (!fs.existsSync(root)) {
    return {
      root,
      totalReferences: 0,
      totalBytes: 0,
      expiredCount: 0,
      overLimitCount: 0,
      removedCount: 0,
      invalidCount: 0,
      dryRun,
      ttlMs: input.ttlMs,
      maxEntries: input.maxEntries,
    };
  }

  const records: Array<{ refId: string; createdAt: number; bytes: number; expired: boolean }> = [];
  let invalidCount = 0;
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    try {
      const metadataFile = resolveReferenceFile(root, name);
      const parsed = JSON.parse(fs.readFileSync(metadataFile, "utf-8")) as { refId?: unknown; createdAt?: unknown };
      const refId = typeof parsed.refId === "string" ? normalizePersistentRefId(parsed.refId) : "";
      const createdAt = typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
        ? parsed.createdAt
        : 0;
      const contentFile = resolveReferenceFile(root, `${refId}.txt`);
      const metadataStats = fs.statSync(metadataFile);
      const contentStats = fs.existsSync(contentFile) ? fs.statSync(contentFile) : null;
      records.push({
        refId,
        createdAt,
        bytes: metadataStats.size + (contentStats?.size ?? 0),
        expired: now - createdAt > input.ttlMs,
      });
    } catch {
      invalidCount++;
    }
  }
  const expired = new Set(records.filter((record) => record.expired));
  const activeSorted = records
    .filter((record) => !record.expired)
    .sort((left, right) => left.createdAt - right.createdAt);
  const overLimit = new Set(activeSorted.slice(0, Math.max(0, activeSorted.length - input.maxEntries)));
  return {
    root,
    totalReferences: records.length,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    expiredCount: expired.size,
    overLimitCount: overLimit.size,
    removedCount: 0,
    invalidCount,
    dryRun,
    ttlMs: input.ttlMs,
    maxEntries: input.maxEntries,
  };
}

function normalizePersistentRefId(refId: string): string {
  const normalized = refId.trim();
  if (!/^tcr_[a-z0-9_]{8,80}$/i.test(normalized)) {
    throw new Error("invalid_ref_id");
  }
  return normalized;
}

function resolveReferenceFile(root: string, fileName: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, fileName);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("reference_path_escape");
  }
  return resolvedFile;
}
