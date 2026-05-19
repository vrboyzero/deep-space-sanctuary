import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  MemorySourceInventoryClass,
  MemorySourceInventoryConfiguredSource,
  MemorySourceInventoryScope,
} from "@belldandy/memory";

const CONFIG_FILENAME = "memory-configured-sources.json";
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

export interface ConfiguredMemorySourcesStore {
  version: 1;
  updatedAt?: string;
  sources: MemorySourceInventoryConfiguredSource[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpFile = path.join(path.dirname(filePath), `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.promises.writeFile(tmpFile, content, "utf-8");
  try {
    await fs.promises.chmod(tmpFile, 0o600);
  } catch {
    // ignore on unsupported platforms
  }

  let lastErr: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await fs.promises.rename(tmpFile, filePath);
      return;
    } catch (error) {
      lastErr = error as NodeJS.ErrnoException;
      if (attempt < RENAME_RETRIES - 1) {
        await delay(RENAME_RETRY_DELAY_MS);
      }
    }
  }

  if (process.platform === "win32" && lastErr && (lastErr.code === "EPERM" || lastErr.code === "EBUSY")) {
    await fs.promises.writeFile(filePath, content, "utf-8");
    await fs.promises.unlink(tmpFile).catch(() => {});
    return;
  }

  await fs.promises.unlink(tmpFile).catch(() => {});
  throw lastErr;
}

export function resolveConfiguredMemorySourcesPath(stateDir: string): string {
  return path.join(stateDir, CONFIG_FILENAME);
}

export async function readConfiguredMemorySourcesStore(stateDir: string): Promise<ConfiguredMemorySourcesStore> {
  const filePath = resolveConfiguredMemorySourcesPath(stateDir);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = raw.trim() ? JSON.parse(raw) as unknown : {};
    if (!isObjectRecord(parsed)) {
      throw new Error("config root must be an object.");
    }
    const normalized = normalizeConfiguredMemorySourcesInput(parsed.sources, "sources");
    if ("error" in normalized) {
      throw new Error(normalized.error);
    }
    return {
      version: 1,
      updatedAt: readOptionalString(parsed, "updatedAt"),
      sources: normalized.sources,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { version: 1, sources: [] };
    }
    throw new Error(`Invalid configured memory sources config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeConfiguredMemorySourcesStore(
  stateDir: string,
  sources: MemorySourceInventoryConfiguredSource[],
): Promise<ConfiguredMemorySourcesStore> {
  const store: ConfiguredMemorySourcesStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources,
  };
  await writeJsonAtomic(resolveConfiguredMemorySourcesPath(stateDir), store);
  return store;
}

export function normalizeConfiguredMemorySourcesInput(
  raw: unknown,
  fieldName = "configuredSources",
): { sources: MemorySourceInventoryConfiguredSource[] } | { error: string } {
  if (raw == null) {
    return { sources: [] };
  }
  if (!Array.isArray(raw)) {
    return { error: `${fieldName} must be an array.` };
  }

  const sources: MemorySourceInventoryConfiguredSource[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!isObjectRecord(item)) {
      return { error: `${fieldName}[${index}] must be an object.` };
    }
    const label = readOptionalString(item, "label");
    if (!label) {
      return { error: `${fieldName}[${index}].label is required.` };
    }
    const sourceClass = readOptionalString(item, "sourceClass");
    if (!isInventorySourceClass(sourceClass)) {
      return { error: `${fieldName}[${index}].sourceClass must be raw, derived, or curated.` };
    }
    const scope = readOptionalString(item, "scope");
    if (scope && !isInventoryScope(scope)) {
      return { error: `${fieldName}[${index}].scope must be private, shared, or team.` };
    }
    const rootPath = readOptionalString(item, "rootPath");
    const filePath = readOptionalString(item, "filePath");
    if (!rootPath && !filePath) {
      return { error: `${fieldName}[${index}] must provide rootPath or filePath.` };
    }

    const normalizedExtensions = Array.isArray(item.fileExtensions)
      ? item.fileExtensions
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
      : undefined;

    sources.push({
      id: readOptionalString(item, "id") || buildConfiguredSourceId(label, index + 1),
      label,
      sourceClass,
      ...(scope ? { scope: scope as MemorySourceInventoryScope } : {}),
      ...(rootPath ? { rootPath } : {}),
      ...(filePath ? { filePath } : {}),
      ...(typeof item.recursive === "boolean" ? { recursive: item.recursive } : {}),
      ...(normalizedExtensions && normalizedExtensions.length > 0 ? { fileExtensions: normalizedExtensions } : {}),
      ...(readOptionalString(item, "note") ? { note: readOptionalString(item, "note") } : {}),
    });
  }

  return { sources };
}

function buildConfiguredSourceId(label: string, index: number): string {
  return `configured:${sanitizeIdentifier(label)}:${index}`;
}

function sanitizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "configured-source";
}

function isInventorySourceClass(value: string | undefined): value is MemorySourceInventoryClass {
  return value === "raw" || value === "derived" || value === "curated";
}

function isInventoryScope(value: string | undefined): value is MemorySourceInventoryScope {
  return value === "private" || value === "shared" || value === "team";
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const raw = record[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
