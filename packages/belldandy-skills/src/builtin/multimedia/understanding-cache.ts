import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ImageUnderstandResult } from "./image-understand.js";
import type { TranscribeResult } from "./stt-transcribe.js";
import type { VideoUnderstandResult } from "./video-understand.js";
import { createMediaFileSha256 } from "./media-file-stream.js";
import { raceWithAbort } from "../../abort-utils.js";

const CACHE_RECORD_VERSION = 2;
const LEGACY_CACHE_RECORD_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 512;
const DEFAULT_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export type MediaUnderstandingCacheKind =
  | "audio-transcription"
  | "image-understanding"
  | "video-understanding";

const ALL_CACHE_KINDS: MediaUnderstandingCacheKind[] = [
  "audio-transcription",
  "image-understanding",
  "video-understanding",
];

type MediaUnderstandingCacheRecord<Result> = {
  version: number;
  fingerprint: string;
  mime?: string;
  createdAt: string;
  accessedAt: string;
  bytes: number;
  result: Result;
};

export type CachedAudioTranscriptionRecord = MediaUnderstandingCacheRecord<TranscribeResult>;
export type CachedImageUnderstandingRecord = MediaUnderstandingCacheRecord<ImageUnderstandResult>;
export type CachedVideoUnderstandingRecord = MediaUnderstandingCacheRecord<VideoUnderstandResult>;

type MediaUnderstandingCachePolicy = {
  ttlMs: number;
  maxEntries: number;
  maxBytes: number;
};

const singleFlightRuns = new Map<string, Promise<unknown>>();
const governanceRuns = new Map<string, Promise<void>>();

export function resolveMediaUnderstandingCacheRoot(stateDir: string): string {
  return path.join(stateDir, "storage", "attachment-understanding-cache");
}

export function resolveMediaUnderstandingCacheDir(
  stateDir: string,
  kind: MediaUnderstandingCacheKind,
): string {
  return path.join(resolveMediaUnderstandingCacheRoot(stateDir), kind);
}

function getMediaUnderstandingCachePath(
  stateDir: string,
  kind: MediaUnderstandingCacheKind,
  fingerprint: string,
): string {
  return path.join(resolveMediaUnderstandingCacheDir(stateDir, kind), `${fingerprint}.json`);
}

export function createMediaFingerprint(input: {
  buffer: Buffer;
  mime?: string;
}): string {
  const hash = crypto.createHash("sha256");
  hash.update(input.mime?.trim().toLowerCase() ?? "");
  hash.update("\n");
  hash.update(input.buffer);
  return hash.digest("hex");
}

export async function createMediaFingerprintFromFile(input: {
  filePath: string;
  mime?: string;
}): Promise<string> {
  return createMediaFileSha256({
    filePath: input.filePath,
    prefix: `${input.mime?.trim().toLowerCase() ?? ""}\n`,
  });
}

export async function readCachedAudioTranscription(input: {
  stateDir: string;
  fingerprint: string;
}): Promise<CachedAudioTranscriptionRecord | undefined> {
  return readCacheRecord({
    ...input,
    kind: "audio-transcription",
    validateResult: (result): result is TranscribeResult => (
      isObject(result) && typeof result.text === "string"
    ),
  });
}

export async function writeCachedAudioTranscription(input: {
  stateDir: string;
  fingerprint: string;
  mime?: string;
  result: TranscribeResult;
}): Promise<void> {
  await writeCacheRecord({
    ...input,
    kind: "audio-transcription",
  });
}

export async function readCachedImageUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
}): Promise<CachedImageUnderstandingRecord | undefined> {
  return readCacheRecord({
    ...input,
    kind: "image-understanding",
    validateResult: (result): result is ImageUnderstandResult => (
      isObject(result) && typeof result.summary === "string"
    ),
  });
}

export async function writeCachedImageUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
  mime?: string;
  result: ImageUnderstandResult;
}): Promise<void> {
  await writeCacheRecord({
    ...input,
    kind: "image-understanding",
  });
}

export async function readCachedVideoUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
}): Promise<CachedVideoUnderstandingRecord | undefined> {
  return readCacheRecord({
    ...input,
    kind: "video-understanding",
    validateResult: (result): result is VideoUnderstandResult => (
      isObject(result) && typeof result.summary === "string"
    ),
  });
}

export async function writeCachedVideoUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
  mime?: string;
  result: VideoUnderstandResult;
}): Promise<void> {
  await writeCacheRecord({
    ...input,
    kind: "video-understanding",
  });
}

export async function runMediaUnderstandingCacheSingleFlight<T>(input: {
  stateDir: string;
  kind: MediaUnderstandingCacheKind;
  fingerprint: string;
  operation: () => Promise<T> | T;
  waitSignal?: AbortSignal;
}): Promise<{ value: T; joined: boolean }> {
  const key = [
    path.resolve(input.stateDir),
    input.kind,
    input.fingerprint,
  ].join("\0");
  const existing = singleFlightRuns.get(key) as Promise<T> | undefined;
  if (existing) {
    return {
      value: await raceWithAbort(existing, input.waitSignal),
      joined: true,
    };
  }

  let operation: Promise<T>;
  try {
    operation = Promise.resolve(input.operation());
  } catch (error) {
    operation = Promise.reject(error);
  }
  singleFlightRuns.set(key, operation);
  try {
    return {
      value: await operation,
      joined: false,
    };
  } finally {
    if (singleFlightRuns.get(key) === operation) {
      singleFlightRuns.delete(key);
    }
  }
}

async function readCacheRecord<Result>(input: {
  stateDir: string;
  kind: MediaUnderstandingCacheKind;
  fingerprint: string;
  validateResult: (result: unknown) => result is Result;
}): Promise<MediaUnderstandingCacheRecord<Result> | undefined> {
  const filePath = getMediaUnderstandingCachePath(input.stateDir, input.kind, input.fingerprint);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const candidate = JSON.parse(raw) as unknown;
    if (!isObject(candidate)
      || (candidate.version !== CACHE_RECORD_VERSION && candidate.version !== LEGACY_CACHE_RECORD_VERSION)
      || candidate.fingerprint !== input.fingerprint
      || !input.validateResult(candidate.result)) {
      await fs.rm(filePath, { force: true });
      return undefined;
    }

    const createdAtMs = parseTimestamp(candidate.createdAt);
    if (createdAtMs === undefined) {
      await fs.rm(filePath, { force: true });
      return undefined;
    }
    const accessedAtMs = parseTimestamp(candidate.accessedAt) ?? createdAtMs;
    const nowMs = Date.now();
    if (nowMs - accessedAtMs > readCachePolicy().ttlMs) {
      await fs.rm(filePath, { force: true });
      return undefined;
    }

    const serialized = serializeCacheRecord({
      version: CACHE_RECORD_VERSION,
      fingerprint: input.fingerprint,
      ...(typeof candidate.mime === "string" ? { mime: candidate.mime } : {}),
      createdAt: new Date(createdAtMs).toISOString(),
      accessedAt: new Date(nowMs).toISOString(),
      result: candidate.result,
    });
    try {
      await writeFileAtomically(filePath, serialized.json);
    } catch {
      // Cache touch/migration failure must not discard an otherwise valid Provider result.
    }
    return serialized.record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    return undefined;
  }
}

async function writeCacheRecord<Result>(input: {
  stateDir: string;
  kind: MediaUnderstandingCacheKind;
  fingerprint: string;
  mime?: string;
  result: Result;
}): Promise<void> {
  const now = new Date().toISOString();
  const serialized = serializeCacheRecord({
    version: CACHE_RECORD_VERSION,
    fingerprint: input.fingerprint,
    ...(input.mime ? { mime: input.mime } : {}),
    createdAt: now,
    accessedAt: now,
    result: input.result,
  });
  const filePath = getMediaUnderstandingCachePath(input.stateDir, input.kind, input.fingerprint);
  const policy = readCachePolicy();
  if (serialized.record.bytes > policy.maxBytes) {
    await fs.rm(filePath, { force: true });
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomically(filePath, serialized.json);
  await enqueueCacheGovernance(input.stateDir, policy);
}

function serializeCacheRecord<Result>(input: Omit<MediaUnderstandingCacheRecord<Result>, "bytes">): {
  record: MediaUnderstandingCacheRecord<Result>;
  json: string;
} {
  const record: MediaUnderstandingCacheRecord<Result> = {
    ...input,
    bytes: 0,
  };
  let json = "";
  for (let iteration = 0; iteration < 4; iteration += 1) {
    json = JSON.stringify(record, null, 2);
    const bytes = Buffer.byteLength(json, "utf-8");
    if (record.bytes === bytes) break;
    record.bytes = bytes;
  }
  json = JSON.stringify(record, null, 2);
  record.bytes = Buffer.byteLength(json, "utf-8");
  json = JSON.stringify(record, null, 2);
  return { record, json };
}

async function writeFileAtomically(filePath: string, json: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const stagingPath = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(stagingPath, json, {
      encoding: "utf-8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(stagingPath, filePath);
  } finally {
    await fs.rm(stagingPath, { force: true });
  }
}

function readCachePolicy(): MediaUnderstandingCachePolicy {
  return {
    ttlMs: parsePositiveInteger(
      process.env.BELLDANDY_UNDERSTANDING_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS,
    ),
    maxEntries: parsePositiveInteger(
      process.env.BELLDANDY_UNDERSTANDING_CACHE_MAX_ENTRIES,
      DEFAULT_CACHE_MAX_ENTRIES,
    ),
    maxBytes: parsePositiveInteger(
      process.env.BELLDANDY_UNDERSTANDING_CACHE_MAX_BYTES,
      DEFAULT_CACHE_MAX_BYTES,
    ),
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidResultForKind(kind: MediaUnderstandingCacheKind, result: unknown): boolean {
  if (!isObject(result)) return false;
  if (kind === "audio-transcription") return typeof result.text === "string";
  return typeof result.summary === "string";
}

async function enqueueCacheGovernance(
  stateDir: string,
  policy: MediaUnderstandingCachePolicy,
): Promise<void> {
  const rootDir = path.resolve(resolveMediaUnderstandingCacheRoot(stateDir));
  const previous = governanceRuns.get(rootDir) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => enforceCachePolicy(stateDir, policy));
  governanceRuns.set(rootDir, current);
  try {
    await current;
  } finally {
    if (governanceRuns.get(rootDir) === current) {
      governanceRuns.delete(rootDir);
    }
  }
}

async function enforceCachePolicy(
  stateDir: string,
  policy: MediaUnderstandingCachePolicy,
): Promise<void> {
  type Entry = { filePath: string; bytes: number; accessedAtMs: number };
  let entries: Entry[] = [];
  let totalBytes = 0;
  const nowMs = Date.now();
  const compactionThreshold = Math.max(64, policy.maxEntries * 2);

  for (const kind of ALL_CACHE_KINDS) {
    const dir = resolveMediaUnderstandingCacheDir(stateDir, kind);
    let directory;
    try {
      directory = await fs.opendir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    for await (const dirent of directory) {
      if (!dirent.isFile()) continue;
      const filePath = path.join(dir, dirent.name);
      if (dirent.name.endsWith(".tmp")) {
        await fs.rm(filePath, { force: true });
        continue;
      }
      if (!dirent.name.endsWith(".json")) continue;

      try {
        const stat = await fs.stat(filePath);
        if (stat.size > policy.maxBytes) {
          await fs.rm(filePath, { force: true });
          continue;
        }
        const parsed = JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown;
        const expectedFingerprint = path.basename(dirent.name, ".json");
        if (!isObject(parsed)
          || (parsed.version !== CACHE_RECORD_VERSION && parsed.version !== LEGACY_CACHE_RECORD_VERSION)
          || parsed.fingerprint !== expectedFingerprint
          || !isValidResultForKind(kind, parsed.result)) {
          await fs.rm(filePath, { force: true });
          continue;
        }
        const accessedAtMs = parseTimestamp(parsed.accessedAt)
          ?? parseTimestamp(parsed.createdAt)
          ?? stat.mtimeMs;
        if (nowMs - accessedAtMs > policy.ttlMs) {
          await fs.rm(filePath, { force: true });
          continue;
        }
        entries.push({ filePath, bytes: stat.size, accessedAtMs });
        totalBytes += stat.size;

        if (entries.length >= compactionThreshold) {
          entries.sort((left, right) => right.accessedAtMs - left.accessedAtMs);
          const evicted = entries.splice(policy.maxEntries);
          for (const entry of evicted) {
            await fs.rm(entry.filePath, { force: true });
            totalBytes -= entry.bytes;
          }
        }
      } catch {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
      }
    }
  }

  entries.sort((left, right) => left.accessedAtMs - right.accessedAtMs);
  while (entries.length > policy.maxEntries || totalBytes > policy.maxBytes) {
    const evicted = entries.shift();
    if (!evicted) break;
    await fs.rm(evicted.filePath, { force: true });
    totalBytes -= evicted.bytes;
  }
}

export async function clearMediaUnderstandingCache(input: {
  stateDir: string;
  kinds?: readonly MediaUnderstandingCacheKind[];
}): Promise<{
  rootDir: string;
  clearedKinds: MediaUnderstandingCacheKind[];
}> {
  const clearedKinds = (input.kinds?.length ? [...input.kinds] : ALL_CACHE_KINDS)
    .filter((kind, index, list) => list.indexOf(kind) === index);

  for (const kind of clearedKinds) {
    await fs.rm(resolveMediaUnderstandingCacheDir(input.stateDir, kind), {
      recursive: true,
      force: true,
    });
  }

  return {
    rootDir: resolveMediaUnderstandingCacheRoot(input.stateDir),
    clearedKinds,
  };
}
