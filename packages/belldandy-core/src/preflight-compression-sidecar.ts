import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type PreflightCompressionSidecarSourceKind =
  | "attachment_text"
  | "attachment_understanding"
  | "audio_transcript"
  | "ocr_text";

export type PreflightCompressionSidecar = {
  version: 1;
  conversationId: string;
  runId?: string;
  sourceRef: string;
  sourceKind: PreflightCompressionSidecarSourceKind;
  sourceName?: string;
  fingerprint?: string;
  originalTextPath: string;
  compressedText: string;
  originalChars: number;
  compressedChars: number;
  strategy: string;
  createdAt: number;
};

export type PreflightCompressionSidecarReadResult = {
  sidecar: PreflightCompressionSidecar;
  originalText: string;
};

export type PreflightCompressionSidecarCleanupResult = {
  root: string;
  totalSidecars: number;
  totalBytes: number;
  expiredCount: number;
  overLimitCount: number;
  removedCount: number;
  invalidCount: number;
  dryRun: boolean;
  retentionMs: number;
  maxEntries: number;
};

export function buildPreflightCompressionSourceRef(): string {
  return `pfc_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

export async function writePreflightCompressionSidecar(input: {
  stateDir: string;
  conversationId: string;
  runId?: string;
  sourceRef?: string;
  sourceKind: PreflightCompressionSidecarSourceKind;
  sourceName?: string;
  fingerprint?: string;
  originalText: string;
  compressedText: string;
  strategy: string;
  now?: number;
  cleanupRetentionMs?: number;
  cleanupMaxEntries?: number;
}): Promise<PreflightCompressionSidecar> {
  const sourceRef = normalizeSourceRef(input.sourceRef ?? buildPreflightCompressionSourceRef());
  const root = getPreflightCompressionSidecarRunRoot({
    stateDir: input.stateDir,
    conversationId: input.conversationId,
    runId: input.runId,
  });
  const originalTextPath = `${sourceRef}.txt`;
  const metadataPath = `${sourceRef}.json`;
  const originalTextFile = resolveSidecarFile(root, originalTextPath);
  const metadataFile = resolveSidecarFile(root, metadataPath);

  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(originalTextFile, input.originalText, "utf-8");

  const sidecar: PreflightCompressionSidecar = {
    version: 1,
    conversationId: input.conversationId,
    ...(input.runId ? { runId: input.runId } : {}),
    sourceRef,
    sourceKind: input.sourceKind,
    ...(input.sourceName ? { sourceName: input.sourceName } : {}),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    originalTextPath,
    compressedText: input.compressedText,
    originalChars: input.originalText.length,
    compressedChars: input.compressedText.length,
    strategy: input.strategy,
    createdAt: input.now ?? Date.now(),
  };
  await fs.writeFile(metadataFile, JSON.stringify(sidecar, null, 2), "utf-8");
  await cleanupPreflightCompressionSidecars({
    stateDir: input.stateDir,
    retentionMs: input.cleanupRetentionMs,
    maxEntries: input.cleanupMaxEntries,
    now: input.now,
  });
  return sidecar;
}

export async function readPreflightCompressionSidecar(input: {
  stateDir: string;
  conversationId: string;
  runId?: string;
  sourceRef: string;
}): Promise<PreflightCompressionSidecarReadResult> {
  const sourceRef = normalizeSourceRef(input.sourceRef);
  const root = getPreflightCompressionSidecarRunRoot({
    stateDir: input.stateDir,
    conversationId: input.conversationId,
    runId: input.runId,
  });
  const metadataFile = resolveSidecarFile(root, `${sourceRef}.json`);
  const originalTextFile = resolveSidecarFile(root, `${sourceRef}.txt`);
  const sidecar = JSON.parse(await fs.readFile(metadataFile, "utf-8")) as PreflightCompressionSidecar;

  if (sidecar.version !== 1 || sidecar.sourceRef !== sourceRef || sidecar.conversationId !== input.conversationId) {
    throw new Error("invalid_sidecar_metadata");
  }
  if ((sidecar.runId ?? undefined) !== (input.runId ?? undefined)) {
    throw new Error("sidecar_run_mismatch");
  }

  return {
    sidecar,
    originalText: await fs.readFile(originalTextFile, "utf-8"),
  };
}

export function getPreflightCompressionSidecarRunRoot(input: {
  stateDir: string;
  conversationId: string;
  runId?: string;
}): string {
  return path.join(
    input.stateDir,
    "storage",
    "preflight-compression",
    sanitizePathSegment(input.conversationId),
    sanitizePathSegment(input.runId ?? "no-run"),
  );
}

export function normalizeSourceRef(sourceRef: string): string {
  const normalized = sourceRef.trim();
  if (!/^[a-zA-Z0-9._-]{8,128}$/.test(normalized)) {
    throw new Error("invalid_source_ref");
  }
  return normalized;
}

export async function cleanupPreflightCompressionSidecars(input: {
  stateDir: string;
  retentionMs?: number;
  maxEntries?: number;
  now?: number;
  dryRun?: boolean;
}): Promise<PreflightCompressionSidecarCleanupResult> {
  const root = getPreflightCompressionSidecarRoot(input.stateDir);
  const retentionMs = normalizePositiveInteger(input.retentionMs, 7 * 24 * 60 * 60 * 1000);
  const maxEntries = normalizePositiveInteger(input.maxEntries, 512);
  const now = input.now ?? Date.now();
  const dryRun = input.dryRun === true;
  const records: Array<{
    sidecar: PreflightCompressionSidecar;
    metadataFile: string;
    originalTextFile: string;
    bytes: number;
    expired: boolean;
  }> = [];
  let invalidCount = 0;

  try {
    await fs.access(root);
  } catch {
    return {
      root,
      totalSidecars: 0,
      totalBytes: 0,
      expiredCount: 0,
      overLimitCount: 0,
      removedCount: 0,
      invalidCount: 0,
      dryRun,
      retentionMs,
      maxEntries,
    };
  }

  for (const metadataFile of await listSidecarMetadataFiles(root)) {
    try {
      const sidecar = JSON.parse(await fs.readFile(metadataFile, "utf-8")) as PreflightCompressionSidecar;
      const runRoot = path.dirname(metadataFile);
      const sourceRef = normalizeSourceRef(sidecar.sourceRef);
      const originalTextFile = resolveSidecarFile(runRoot, `${sourceRef}.txt`);
      const metadataStats = await fs.stat(metadataFile).catch(() => null);
      const textStats = await fs.stat(originalTextFile).catch(() => null);
      records.push({
        sidecar,
        metadataFile,
        originalTextFile,
        bytes: (metadataStats?.size ?? 0) + (textStats?.size ?? 0),
        expired: now - sidecar.createdAt > retentionMs,
      });
    } catch {
      invalidCount++;
    }
  }

  const expired = new Set(records.filter((record) => record.expired));
  const activeSorted = records
    .filter((record) => !record.expired)
    .sort((left, right) => left.sidecar.createdAt - right.sidecar.createdAt);
  const overLimit = new Set(activeSorted.slice(0, Math.max(0, activeSorted.length - maxEntries)));
  const toRemove = [...new Set([...expired, ...overLimit])];
  if (!dryRun) {
    for (const record of toRemove) {
      await fs.rm(record.metadataFile, { force: true });
      await fs.rm(record.originalTextFile, { force: true });
    }
  }

  return {
    root,
    totalSidecars: records.length,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    expiredCount: expired.size,
    overLimitCount: overLimit.size,
    removedCount: dryRun ? 0 : toRemove.length,
    invalidCount,
    dryRun,
    retentionMs,
    maxEntries,
  };
}

export function getPreflightCompressionSidecarRoot(stateDir: string): string {
  return path.join(stateDir, "storage", "preflight-compression");
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96);
  if (!safe) return "unknown";
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  return `${safe}-${hash}`;
}

function resolveSidecarFile(root: string, fileName: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, fileName);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("sidecar_path_escape");
  }
  return resolvedFile;
}

async function listSidecarMetadataFiles(root: string): Promise<string[]> {
  const resolvedRoot = path.resolve(root);
  const results: string[] = [];
  async function visit(dir: string): Promise<void> {
    const resolvedDir = path.resolve(dir);
    const relative = path.relative(resolvedRoot, resolvedDir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("sidecar_path_escape");
    }
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(resolvedDir, entry.name);
      if (entry.isDirectory()) {
        await visit(next);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        results.push(next);
      }
    }
  }
  await visit(resolvedRoot);
  return results;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && typeof value === "number" && value > 0
    ? Math.floor(value)
    : fallback;
}
