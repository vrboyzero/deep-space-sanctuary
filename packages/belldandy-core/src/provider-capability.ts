import type { EnvReader } from "./memory-runtime-switches.js";

export type ProviderCacheSupport = "supported" | "unsupported" | "unknown";
export type ProviderJsonReliability = "high" | "medium" | "low" | "unknown";

export type ProviderPricing = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cacheReadUsdPer1M?: number;
  cacheCreationUsdPer1M?: number;
  source: "env";
};

export type ProviderCapability = {
  cache: ProviderCacheSupport;
  contextWindow?: number;
  pricing?: ProviderPricing;
  jsonReliability: ProviderJsonReliability;
  source: "env" | "unknown";
};

export type ModelUsageLike = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

export type UsageCostBreakdown = {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  cacheSavingsUsd: number;
  totalUsd: number;
};

export type ResolvedCompactionThreshold = {
  tokenThreshold: number;
  derivedFromContextWindow: boolean;
};

function parsePositiveNumber(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") return undefined;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function parsePositiveInteger(raw: string | undefined): number | undefined {
  const value = parsePositiveNumber(raw);
  if (typeof value !== "number") return undefined;
  return Math.floor(value);
}

function parseCacheSupport(raw: string | undefined): ProviderCacheSupport {
  if (raw === "true") return "supported";
  if (raw === "false") return "unsupported";
  return "unknown";
}

function parseJsonReliability(raw: string | undefined): ProviderJsonReliability {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "unknown";
}

function roundUsd(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function resolveProviderCapabilityFromEnv(readEnv: EnvReader): ProviderCapability {
  const contextWindow = parsePositiveInteger(readEnv("BELLDANDY_MODEL_CONTEXT_WINDOW"));
  const cache = parseCacheSupport(readEnv("BELLDANDY_MODEL_CACHE_ENABLED"));
  const jsonReliability = parseJsonReliability(readEnv("BELLDANDY_MODEL_JSON_RELIABILITY"));
  const inputUsdPer1M = parsePositiveNumber(readEnv("BELLDANDY_MODEL_INPUT_USD_PER_1M"));
  const outputUsdPer1M = parsePositiveNumber(readEnv("BELLDANDY_MODEL_OUTPUT_USD_PER_1M"));
  const cacheReadUsdPer1M = parsePositiveNumber(readEnv("BELLDANDY_MODEL_CACHE_READ_USD_PER_1M"));
  const cacheCreationUsdPer1M = parsePositiveNumber(readEnv("BELLDANDY_MODEL_CACHE_CREATION_USD_PER_1M"));
  const pricing = typeof inputUsdPer1M === "number" && typeof outputUsdPer1M === "number"
    ? {
        inputUsdPer1M,
        outputUsdPer1M,
        ...(typeof cacheReadUsdPer1M === "number" ? { cacheReadUsdPer1M } : {}),
        ...(typeof cacheCreationUsdPer1M === "number" ? { cacheCreationUsdPer1M } : {}),
        source: "env" as const,
      }
    : undefined;

  return {
    cache,
    ...(typeof contextWindow === "number" ? { contextWindow } : {}),
    ...(pricing ? { pricing } : {}),
    jsonReliability,
    source: contextWindow || pricing || cache !== "unknown" || jsonReliability !== "unknown"
      ? "env"
      : "unknown",
  };
}

export function resolveCompactionThreshold(input: {
  fallbackThreshold: number;
  contextWindow?: number;
  contextWindowFraction?: number;
  minimumThreshold?: number;
}): ResolvedCompactionThreshold {
  const fallbackThreshold = Math.max(1, Math.floor(input.fallbackThreshold));
  const minimumThreshold = Math.max(1, Math.floor(input.minimumThreshold ?? 1024));
  const contextWindowFraction = typeof input.contextWindowFraction === "number" && Number.isFinite(input.contextWindowFraction)
    ? input.contextWindowFraction
    : 0.1;
  if (
    typeof input.contextWindow === "number"
    && Number.isFinite(input.contextWindow)
    && input.contextWindow > 0
    && contextWindowFraction > 0
  ) {
    return {
      tokenThreshold: Math.max(minimumThreshold, Math.floor(input.contextWindow * contextWindowFraction)),
      derivedFromContextWindow: true,
    };
  }
  return {
    tokenThreshold: fallbackThreshold,
    derivedFromContextWindow: false,
  };
}

export function calculateUsageCostUsd(
  usage: ModelUsageLike,
  pricing: ProviderPricing | undefined,
): UsageCostBreakdown | undefined {
  if (!pricing) return undefined;
  const inputUsd = ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputUsdPer1M;
  const outputUsd = ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputUsdPer1M;
  const cacheReadUsd = pricing.cacheReadUsdPer1M
    ? ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.cacheReadUsdPer1M
    : 0;
  const cacheCreationUsd = pricing.cacheCreationUsdPer1M
    ? ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * pricing.cacheCreationUsdPer1M
    : 0;
  const cacheSavingsUsd = pricing.cacheReadUsdPer1M
    ? ((usage.prompt_cache_hit_tokens ?? 0) / 1_000_000) * Math.max(0, pricing.inputUsdPer1M - pricing.cacheReadUsdPer1M)
    : 0;
  const totalUsd = Math.max(0, inputUsd - cacheSavingsUsd) + outputUsd + cacheReadUsd + cacheCreationUsd;
  return {
    inputUsd: roundUsd(inputUsd),
    outputUsd: roundUsd(outputUsd),
    cacheReadUsd: roundUsd(cacheReadUsd),
    cacheCreationUsd: roundUsd(cacheCreationUsd),
    cacheSavingsUsd: roundUsd(cacheSavingsUsd),
    totalUsd: roundUsd(totalUsd),
  };
}
