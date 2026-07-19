import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RUNTIME_DEPENDENCY_STORE_SNAPSHOT_SCHEMA_VERSION =
  "runtime-dependency-store-snapshot/v1";

const HASH_BUFFER_SIZE = 64 * 1024;
const HASH_CONCURRENCY = 32;
const SNAPSHOT_FIELDS = ["schemaVersion", "fileCount", "totalSize", "entriesSha256"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function compareEntryNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function canonicalizeStoreIndexValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeStoreIndexValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const canonical = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "checkedAt") continue;
    canonical[key] = canonicalizeStoreIndexValue(value[key]);
  }
  return canonical;
}

async function hashFile(filePath, relativePath) {
  if (relativePath.startsWith("v10/index/")) {
    let parsed;
    try {
      parsed = JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
    } catch {
      throw new Error(`Invalid runtime dependency store index: ${relativePath}`);
    }
    const canonicalBytes = Buffer.from(
      JSON.stringify(canonicalizeStoreIndexValue(parsed)),
      "utf-8",
    );
    return {
      size: canonicalBytes.length,
      sha256: crypto.createHash("sha256").update(canonicalBytes).digest("hex"),
    };
  }

  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_SIZE);
  const handle = await fs.promises.open(filePath, "r");
  let size = 0;
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      size += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { size, sha256: hash.digest("hex") };
}

function collectStoreEntries(storeRoot, currentDir, entries) {
  const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true })
    .sort(compareEntryNames);
  for (const dirEntry of dirEntries) {
    const entryPath = path.join(currentDir, dirEntry.name);
    if (dirEntry.isDirectory()) {
      collectStoreEntries(storeRoot, entryPath, entries);
      continue;
    }
    if (!dirEntry.isFile()) {
      const relativePath = path.relative(storeRoot, entryPath).split(path.sep).join("/");
      throw new Error(`Unsupported runtime dependency store entry: ${relativePath}`);
    }
    const relativePath = path.relative(storeRoot, entryPath).split(path.sep).join("/");
    entries.push({ path: relativePath, filePath: entryPath });
  }
}

async function hashStoreEntries(entries) {
  const hashedEntries = new Array(entries.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(HASH_CONCURRENCY, entries.length) },
    async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex;
        nextIndex += 1;
        const entry = entries[index];
        hashedEntries[index] = {
          path: entry.path,
          ...await hashFile(entry.filePath, entry.path),
        };
      }
    },
  );
  await Promise.all(workers);
  return hashedEntries;
}

export function normalizeRuntimeDependencyStoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Runtime dependency store snapshot must be an object");
  }
  if (snapshot.schemaVersion !== RUNTIME_DEPENDENCY_STORE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("Runtime dependency store snapshot schemaVersion mismatch");
  }
  if (!Number.isSafeInteger(snapshot.fileCount) || snapshot.fileCount <= 0) {
    throw new Error("Runtime dependency store snapshot fileCount must be a positive integer");
  }
  if (!Number.isSafeInteger(snapshot.totalSize) || snapshot.totalSize < 0) {
    throw new Error("Runtime dependency store snapshot totalSize must be a non-negative integer");
  }
  if (typeof snapshot.entriesSha256 !== "string" || !SHA256_PATTERN.test(snapshot.entriesSha256)) {
    throw new Error("Runtime dependency store snapshot entriesSha256 must be a SHA-256 digest");
  }
  return Object.freeze({
    schemaVersion: snapshot.schemaVersion,
    fileCount: snapshot.fileCount,
    totalSize: snapshot.totalSize,
    entriesSha256: snapshot.entriesSha256,
  });
}

export async function createRuntimeDependencyStoreSnapshot(storeRoot) {
  const resolvedRoot = path.resolve(storeRoot);
  let rootStats;
  try {
    rootStats = fs.statSync(resolvedRoot);
  } catch {
    throw new Error(`Runtime dependency store root is missing: ${resolvedRoot}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Runtime dependency store root must be a directory: ${resolvedRoot}`);
  }

  const entries = [];
  collectStoreEntries(resolvedRoot, resolvedRoot, entries);
  if (entries.length === 0) {
    throw new Error(`Runtime dependency store must contain at least one file: ${resolvedRoot}`);
  }
  const hashedEntries = await hashStoreEntries(entries);
  const entriesHash = crypto.createHash("sha256");
  let totalSize = 0;
  for (const entry of hashedEntries) {
    entriesHash.update(`${JSON.stringify(entry)}\n`);
    totalSize += entry.size;
  }
  return normalizeRuntimeDependencyStoreSnapshot({
    schemaVersion: RUNTIME_DEPENDENCY_STORE_SNAPSHOT_SCHEMA_VERSION,
    fileCount: entries.length,
    totalSize,
    entriesSha256: entriesHash.digest("hex"),
  });
}

export async function assertRuntimeDependencyStoreSnapshot(snapshot, storeRoot) {
  const actual = normalizeRuntimeDependencyStoreSnapshot(snapshot);
  const expected = await createRuntimeDependencyStoreSnapshot(storeRoot);
  const mismatches = SNAPSHOT_FIELDS.filter((field) => actual[field] !== expected[field]);
  if (mismatches.length > 0) {
    throw new Error(`Runtime dependency store snapshot mismatch: ${mismatches.join(", ")}`);
  }
  return snapshot;
}
