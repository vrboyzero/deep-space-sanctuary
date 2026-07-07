import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { CompressionReferenceStore, ReferenceStatus, StoredReference } from "./context-compression/types.js";

export type PersistentCompressionReferenceReadResult = {
  record: StoredReference;
  content: string;
};

export type PersistentCompressionReferenceCleanupResult = {
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

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 128;

export class PersistentCompressionReferenceStore implements CompressionReferenceStore {
  private readonly stateDir: string;
  private readonly storeKind: "conversation" | "runtime";
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts: {
    stateDir: string;
    storeKind?: "conversation" | "runtime";
    ttlMs?: number;
    maxEntries?: number;
  }) {
    this.stateDir = opts.stateDir;
    this.storeKind = opts.storeKind ?? "conversation";
    this.ttlMs = normalizePositiveInteger(opts.ttlMs, DEFAULT_TTL_MS);
    this.maxEntries = normalizePositiveInteger(opts.maxEntries, DEFAULT_MAX_ENTRIES);
  }

  store(content: string, metadata?: Record<string, unknown>): StoredReference {
    const refId = buildPersistentRefId();
    const record: StoredReference = {
      refId,
      content,
      metadata: { ...(metadata ?? {}) },
      createdAt: Date.now(),
      status: "active",
      storeKind: this.storeKind,
    };
    const root = getPersistentCompressionReferenceRoot(this.stateDir);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(resolveReferenceFile(root, `${refId}.txt`), content, "utf-8");
    fs.writeFileSync(
      resolveReferenceFile(root, `${refId}.json`),
      JSON.stringify({ ...record, content: undefined }, null, 2),
      "utf-8",
    );
    cleanupPersistentCompressionReferences({
      stateDir: this.stateDir,
      ttlMs: this.ttlMs,
      maxEntries: this.maxEntries,
    });
    return record;
  }

  retrieve(refId: string): {
    found: boolean;
    content?: string;
    status?: ReferenceStatus;
    metadata?: Record<string, unknown>;
  } {
    try {
      const result = readPersistentCompressionReference({
        stateDir: this.stateDir,
        refId,
      });
      return {
        found: true,
        content: result.record.status === "active" ? result.content : undefined,
        status: result.record.status,
        metadata: { ...result.record.metadata },
      };
    } catch {
      return { found: false };
    }
  }

  invalidate(refId: string): boolean {
    try {
      const root = getPersistentCompressionReferenceRoot(this.stateDir);
      const normalizedRefId = normalizePersistentRefId(refId);
      const metadataFile = resolveReferenceFile(root, `${normalizedRefId}.json`);
      const record = readPersistentReferenceMetadata(metadataFile);
      if (record.status === "invalidated") return false;
      record.status = "invalidated";
      fs.writeFileSync(metadataFile, JSON.stringify({ ...record, content: undefined }, null, 2), "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  prune(predicate: (ref: StoredReference) => boolean): number {
    const root = getPersistentCompressionReferenceRoot(this.stateDir);
    if (!fs.existsSync(root)) return 0;
    let pruned = 0;
    for (const metadataFile of listMetadataFiles(root)) {
      const record = readPersistentReferenceMetadata(metadataFile);
      if (isExpired(record, this.ttlMs) || predicate(record)) {
        deleteReferenceFiles(root, record.refId);
        pruned++;
      }
    }
    return pruned;
  }

  has(refId: string): boolean {
    try {
      const root = getPersistentCompressionReferenceRoot(this.stateDir);
      const normalizedRefId = normalizePersistentRefId(refId);
      return fs.existsSync(resolveReferenceFile(root, `${normalizedRefId}.json`));
    } catch {
      return false;
    }
  }

  size(): number {
    const root = getPersistentCompressionReferenceRoot(this.stateDir);
    if (!fs.existsSync(root)) return 0;
    return listMetadataFiles(root).length;
  }

  clear(): void {
    fs.rmSync(getPersistentCompressionReferenceRoot(this.stateDir), { recursive: true, force: true });
  }

  snapshot(): StoredReference[] {
    const root = getPersistentCompressionReferenceRoot(this.stateDir);
    if (!fs.existsSync(root)) return [];
    return listMetadataFiles(root).map((file) => readPersistentReferenceMetadata(file));
  }

}

export function readPersistentCompressionReference(input: {
  stateDir: string;
  refId: string;
  conversationId?: string;
  runId?: string;
  now?: number;
  ttlMs?: number;
}): PersistentCompressionReferenceReadResult {
  const root = getPersistentCompressionReferenceRoot(input.stateDir);
  const refId = normalizePersistentRefId(input.refId);
  const metadataFile = resolveReferenceFile(root, `${refId}.json`);
  const contentFile = resolveReferenceFile(root, `${refId}.txt`);
  const record = readPersistentReferenceMetadata(metadataFile);
  if (record.refId !== refId) {
    throw new Error("reference_metadata_mismatch");
  }
  const metadata = record.metadata ?? {};
  if (input.conversationId && metadata.conversationId !== input.conversationId) {
    throw new Error("reference_conversation_mismatch");
  }
  if (input.runId && metadata.runId !== input.runId) {
    throw new Error("reference_run_mismatch");
  }
  const ttlMs = normalizePositiveInteger(input.ttlMs, DEFAULT_TTL_MS);
  const status: ReferenceStatus = isExpired(record, ttlMs, input.now) ? "expired" : record.status;
  return {
    record: {
      ...record,
      status,
    },
    content: status === "active" ? fs.readFileSync(contentFile, "utf-8") : "",
  };
}

export function getPersistentCompressionReferenceRoot(stateDir: string): string {
  return path.join(stateDir, "storage", "compression-references");
}

export function normalizePersistentRefId(refId: string): string {
  const normalized = refId.trim();
  if (!/^tcr_[a-z0-9_]{8,80}$/i.test(normalized)) {
    throw new Error("invalid_ref_id");
  }
  return normalized;
}

export function cleanupPersistentCompressionReferences(input: {
  stateDir: string;
  ttlMs?: number;
  maxEntries?: number;
  now?: number;
  dryRun?: boolean;
}): PersistentCompressionReferenceCleanupResult {
  const root = getPersistentCompressionReferenceRoot(input.stateDir);
  const ttlMs = normalizePositiveInteger(input.ttlMs, DEFAULT_TTL_MS);
  const maxEntries = normalizePositiveInteger(input.maxEntries, DEFAULT_MAX_ENTRIES);
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
      ttlMs,
      maxEntries,
    };
  }

  const records: Array<{
    record: StoredReference;
    bytes: number;
    expired: boolean;
  }> = [];
  let invalidCount = 0;
  for (const metadataFile of listMetadataFiles(root)) {
    try {
      const record = readPersistentReferenceMetadata(metadataFile);
      const metadataStats = fs.existsSync(metadataFile) ? fs.statSync(metadataFile) : null;
      const contentFile = resolveReferenceFile(root, `${record.refId}.txt`);
      const contentStats = fs.existsSync(contentFile) ? fs.statSync(contentFile) : null;
      records.push({
        record,
        bytes: (metadataStats?.size ?? 0) + (contentStats?.size ?? 0),
        expired: isExpired(record, ttlMs, now),
      });
    } catch {
      invalidCount++;
    }
  }

  const expired = new Set(records.filter((item) => item.expired));
  const activeSorted = records
    .filter((item) => !item.expired)
    .sort((left, right) => left.record.createdAt - right.record.createdAt);
  const overLimit = new Set(activeSorted.slice(0, Math.max(0, activeSorted.length - maxEntries)));
  const toRemove = [...new Set([...expired, ...overLimit])];
  if (!dryRun) {
    for (const item of toRemove) {
      deleteReferenceFiles(root, item.record.refId);
    }
  }

  return {
    root,
    totalReferences: records.length,
    totalBytes: records.reduce((sum, item) => sum + item.bytes, 0),
    expiredCount: expired.size,
    overLimitCount: overLimit.size,
    removedCount: dryRun ? 0 : toRemove.length,
    invalidCount,
    dryRun,
    ttlMs,
    maxEntries,
  };
}

function buildPersistentRefId(): string {
  const ts = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString("hex");
  return `tcr_${ts}_${random}`;
}

function readPersistentReferenceMetadata(metadataFile: string): StoredReference {
  const parsed = JSON.parse(fs.readFileSync(metadataFile, "utf-8")) as Omit<StoredReference, "content">;
  return {
    ...parsed,
    content: "",
    metadata: { ...(parsed.metadata ?? {}) },
  };
}

function listMetadataFiles(root: string): string[] {
  return fs.readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolveReferenceFile(root, name));
}

function deleteReferenceFiles(root: string, refId: string): void {
  const normalizedRefId = normalizePersistentRefId(refId);
  fs.rmSync(resolveReferenceFile(root, `${normalizedRefId}.json`), { force: true });
  fs.rmSync(resolveReferenceFile(root, `${normalizedRefId}.txt`), { force: true });
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

function isExpired(record: StoredReference, ttlMs: number, now = Date.now()): boolean {
  return now - record.createdAt > ttlMs;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && typeof value === "number" && value > 0
    ? Math.floor(value)
    : fallback;
}
