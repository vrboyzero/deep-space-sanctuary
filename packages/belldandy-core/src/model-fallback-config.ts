import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ModelConfigFile, ModelProfile } from "@belldandy/agent";

export const REDACTED_MODEL_SECRET_PLACEHOLDER = "[REDACTED]";

const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized || undefined;
}

function normalizePositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function normalizeNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function normalizeThinkingConfig(value: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) return undefined;
  const type = normalizeOptionalString(value.type);
  if (!type) return undefined;
  return {
    ...value,
    type,
  };
}

function normalizeOptionsConfig(value: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) return undefined;
  return { ...value };
}

function normalizeRequestBodyExtrasConfig(value: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) return undefined;
  return { ...value };
}

function normalizeMessageLayout(value: unknown): "single_system_only" | undefined {
  return normalizeString(value) === "single_system_only" ? "single_system_only" : undefined;
}

function normalizeModelProfile(value: unknown, index: number): ModelProfile {
  const item = isObjectRecord(value) ? value : {};
  const id = normalizeOptionalString(item.id) ?? `fallback-${index}`;
  const baseUrl = normalizeString(item.baseUrl);
  const apiKey = normalizeString(item.apiKey);
  const model = normalizeString(item.model);

  if (!baseUrl) {
    throw new Error(`fallbacks[${index}].baseUrl is required`);
  }
  if (!apiKey) {
    throw new Error(`fallbacks[${index}].apiKey is required`);
  }
  if (!model) {
    throw new Error(`fallbacks[${index}].model is required`);
  }

  return {
    id,
    displayName: normalizeOptionalString(item.displayName),
    baseUrl,
    apiKey,
    model,
    protocol: normalizeOptionalString(item.protocol),
    wireApi: normalizeOptionalString(item.wireApi),
    requestTimeoutMs: normalizePositiveInt(item.requestTimeoutMs),
    maxRetries: normalizeNonNegativeInt(item.maxRetries),
    retryBackoffMs: normalizePositiveInt(item.retryBackoffMs),
    proxyUrl: normalizeOptionalString(item.proxyUrl),
    thinking: normalizeThinkingConfig(item.thinking),
    reasoningEffort: normalizeOptionalString(item.reasoningEffort),
    options: normalizeOptionsConfig(item.options),
    requestBodyExtras: normalizeRequestBodyExtrasConfig(item.requestBodyExtras),
    messageLayout: normalizeMessageLayout(item.messageLayout),
  };
}

export function normalizeModelFallbackConfig(value: unknown): ModelConfigFile {
  const root = isObjectRecord(value) ? value : {};
  const fallbacks = Array.isArray(root.fallbacks)
    ? root.fallbacks.map((item, index) => normalizeModelProfile(item, index))
    : [];

  const seenIds = new Set<string>();
  for (const fallback of fallbacks) {
    const id = fallback.id ?? "";
    if (!id) {
      throw new Error("fallback id is required");
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate model fallback id: ${id}`);
    }
    seenIds.add(id);
  }

  return { fallbacks };
}

function toPersistedModelProfile(profile: ModelProfile): Record<string, unknown> {
  return {
    id: profile.id,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    ...(profile.protocol ? { protocol: profile.protocol } : {}),
    ...(profile.wireApi ? { wireApi: profile.wireApi } : {}),
    ...(typeof profile.requestTimeoutMs === "number" ? { requestTimeoutMs: profile.requestTimeoutMs } : {}),
    ...(typeof profile.maxRetries === "number" ? { maxRetries: profile.maxRetries } : {}),
    ...(typeof profile.retryBackoffMs === "number" ? { retryBackoffMs: profile.retryBackoffMs } : {}),
    ...(profile.proxyUrl ? { proxyUrl: profile.proxyUrl } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
    ...(profile.options ? { options: profile.options } : {}),
    ...(profile.requestBodyExtras ? { requestBodyExtras: profile.requestBodyExtras } : {}),
    ...(profile.messageLayout ? { messageLayout: profile.messageLayout } : {}),
  };
}

function redactModelProfileSecrets(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    apiKey: REDACTED_MODEL_SECRET_PLACEHOLDER,
  };
}

export function stringifyModelFallbackConfig(
  config: ModelConfigFile,
  options: { redactApiKeys?: boolean } = {},
): string {
  const normalized = normalizeModelFallbackConfig(config);
  const fallbacks = options.redactApiKeys
    ? normalized.fallbacks.map((item) => redactModelProfileSecrets(item))
    : normalized.fallbacks;
  return `${JSON.stringify({ fallbacks: fallbacks.map((item) => toPersistedModelProfile(item)) }, null, 2)}\n`;
}

export function parseModelFallbackConfigContent(content: string): ModelConfigFile {
  const raw = content.trim() ? JSON.parse(content) as unknown : {};
  return normalizeModelFallbackConfig(raw);
}

export function resolveModelFallbackConfigPath(
  stateDir: string,
  configuredPath?: string,
): string {
  const normalized = typeof configuredPath === "string" ? configuredPath.trim() : "";
  return normalized || path.join(stateDir, "models.json");
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
      if (attempt < RENAME_RETRIES - 1) await delay(RENAME_RETRY_DELAY_MS);
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

export async function readModelFallbackConfig(filePath: string): Promise<ModelConfigFile> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return parseModelFallbackConfigContent(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { fallbacks: [] };
    }
    throw error;
  }
}

export function mergeModelFallbackConfigSecrets(
  existingConfig: ModelConfigFile,
  nextConfig: ModelConfigFile,
  options: { redactedPlaceholder?: string } = {},
): ModelConfigFile {
  const placeholder = options.redactedPlaceholder ?? REDACTED_MODEL_SECRET_PLACEHOLDER;
  const existingById = new Map(
    normalizeModelFallbackConfig(existingConfig).fallbacks.map((item) => [item.id ?? "", item]),
  );

  return {
    fallbacks: normalizeModelFallbackConfig(nextConfig).fallbacks.map((item) => {
      const normalizedApiKey = normalizeString(item.apiKey);
      if (normalizedApiKey !== placeholder) {
        return {
          ...item,
          apiKey: normalizedApiKey,
        };
      }
      const existing = existingById.get(item.id ?? "");
      if (!existing?.apiKey) {
        throw new Error(`fallback "${item.id ?? "unknown"}" uses [REDACTED] but no existing apiKey was found`);
      }
      return {
        ...item,
        apiKey: existing.apiKey,
      };
    }),
  };
}

export async function writeModelFallbackConfig(filePath: string, config: ModelConfigFile): Promise<void> {
  const normalized = normalizeModelFallbackConfig(config);
  await writeJsonAtomic(filePath, {
    fallbacks: normalized.fallbacks.map((item) => toPersistedModelProfile(item)),
  });
}

export async function getModelFallbackConfigContent(
  filePath: string,
  options: { redactApiKeys?: boolean } = {},
): Promise<{ path: string; config: ModelConfigFile; content: string }> {
  const config = await readModelFallbackConfig(filePath);
  const visibleConfig = options.redactApiKeys
    ? { fallbacks: config.fallbacks.map((item) => redactModelProfileSecrets(item)) }
    : config;
  return {
    path: filePath,
    config: visibleConfig,
    content: stringifyModelFallbackConfig(config, options),
  };
}
