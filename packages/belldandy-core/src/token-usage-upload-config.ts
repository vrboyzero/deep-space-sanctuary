import type { TokenUsageUploadConfig } from "@belldandy/protocol";

type ReadEnv = (name: string) => string | undefined;

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;

/** 统一 WebChat 与 Community 的 token-usage 上传配置，缺失或非法值一律回退安全默认值。 */
export function readTokenUsageUploadConfig(readEnv: ReadEnv): TokenUsageUploadConfig {
  return {
    enabled: readBooleanEnv(readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED")),
    url: readTrimmedEnv(readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_URL")),
    token: readTrimmedEnv(readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY"))
      ?? readTrimmedEnv(readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_TOKEN")),
    timeoutMs: readTimeoutMs(readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS")),
    trustedPrivateEndpoint: readBooleanEnv(readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_TRUSTED_PRIVATE_ENDPOINT")),
  };
}

function readBooleanEnv(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function readTrimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function readTimeoutMs(value: string | undefined): number {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TIMEOUT_MS
    ? parsed
    : DEFAULT_TIMEOUT_MS;
}
