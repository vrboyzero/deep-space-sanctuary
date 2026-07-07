import type { CompressionPolicy } from "@belldandy/agent";

export type PreflightCompressionMode = "off" | "attachments" | "long_input" | "all_long_blocks";
export type PreflightCompressionReferenceMode = "none" | "memory" | "sidecar";

export type PreflightCompressionPolicy = {
  enabled: boolean;
  mode: PreflightCompressionMode;
  attachmentThresholdChars: number;
  targetRatio: number;
  minSavingsRatio: number;
  timeoutMs: number;
  attachmentReference: PreflightCompressionReferenceMode;
  sidecarRetentionMs: number;
  sidecarMaxEntries: number;
};

export const DEFAULT_PREFLIGHT_SIDECAR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_PREFLIGHT_SIDECAR_MAX_ENTRIES = 512;

export const DEFAULT_PREFLIGHT_COMPRESSION_POLICY: PreflightCompressionPolicy = {
  enabled: true,
  mode: "attachments",
  attachmentThresholdChars: 1_200,
  targetRatio: 0.5,
  minSavingsRatio: 0.15,
  timeoutMs: 3_000,
  attachmentReference: "none",
  sidecarRetentionMs: DEFAULT_PREFLIGHT_SIDECAR_RETENTION_MS,
  sidecarMaxEntries: DEFAULT_PREFLIGHT_SIDECAR_MAX_ENTRIES,
};

export function readPreflightCompressionPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PreflightCompressionPolicy {
  return normalizePreflightCompressionPolicy({
    enabled: parseOptionalBoolean(env.BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED),
    mode: parsePreflightCompressionMode(env.BELLDANDY_PREFLIGHT_COMPRESSION_MODE),
    attachmentThresholdChars: parseOptionalPositiveInteger(env.BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS),
    targetRatio: parseOptionalRatio(env.BELLDANDY_PREFLIGHT_TARGET_RATIO),
    minSavingsRatio: parseOptionalRatio(env.BELLDANDY_PREFLIGHT_MIN_SAVINGS_RATIO),
    timeoutMs: parseOptionalPositiveInteger(env.BELLDANDY_PREFLIGHT_TIMEOUT_MS),
    attachmentReference: parsePreflightCompressionReferenceMode(env.BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE),
    sidecarRetentionMs: parseOptionalPositiveInteger(env.BELLDANDY_PREFLIGHT_SIDECAR_RETENTION_MS),
    sidecarMaxEntries: parseOptionalPositiveInteger(env.BELLDANDY_PREFLIGHT_SIDECAR_MAX_ENTRIES),
  });
}

export function normalizePreflightCompressionPolicy(
  input?: Partial<PreflightCompressionPolicy>,
): PreflightCompressionPolicy {
  const base = DEFAULT_PREFLIGHT_COMPRESSION_POLICY;
  const enabled = typeof input?.enabled === "boolean" ? input.enabled : base.enabled;
  const mode = input?.mode ?? base.mode;
  return {
    enabled: enabled && mode !== "off",
    mode,
    attachmentThresholdChars: normalizePositiveInteger(
      input?.attachmentThresholdChars,
      base.attachmentThresholdChars,
    ),
    targetRatio: normalizeRatio(input?.targetRatio, base.targetRatio),
    minSavingsRatio: normalizeRatio(input?.minSavingsRatio, base.minSavingsRatio),
    timeoutMs: normalizePositiveInteger(input?.timeoutMs, base.timeoutMs),
    attachmentReference: input?.attachmentReference ?? base.attachmentReference,
    sidecarRetentionMs: normalizePositiveInteger(input?.sidecarRetentionMs, base.sidecarRetentionMs),
    sidecarMaxEntries: normalizePositiveInteger(input?.sidecarMaxEntries, base.sidecarMaxEntries),
  };
}

export function shouldCompressAttachmentText(
  policy: PreflightCompressionPolicy | undefined,
  text: string,
): boolean {
  const resolved = normalizePreflightCompressionPolicy(policy);
  if (!resolved.enabled) return false;
  if (resolved.mode !== "attachments" && resolved.mode !== "all_long_blocks") return false;
  return text.length >= resolved.attachmentThresholdChars;
}

export function toAttachmentCompressionPolicy(
  policy: PreflightCompressionPolicy | undefined,
): Partial<CompressionPolicy> {
  const resolved = normalizePreflightCompressionPolicy(policy);
  return {
    minSavingsRatioToApply: resolved.minSavingsRatio,
    allowReferenceStore: resolved.attachmentReference === "memory",
    sourceOverrides: {
      attachment_text: {
        enabled: resolved.enabled && (resolved.mode === "attachments" || resolved.mode === "all_long_blocks"),
        allowLossy: true,
        allowReferenceStore: resolved.attachmentReference === "memory",
      },
    },
  };
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return undefined;
}

function parsePreflightCompressionMode(value: string | undefined): PreflightCompressionMode | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "off"
    || normalized === "attachments"
    || normalized === "long_input"
    || normalized === "all_long_blocks"
    ? normalized
    : undefined;
}

function parsePreflightCompressionReferenceMode(
  value: string | undefined,
): PreflightCompressionReferenceMode | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "none" || normalized === "memory" || normalized === "sidecar"
    ? normalized
    : undefined;
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function parseOptionalRatio(value: string | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : undefined;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && typeof value === "number" && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeRatio(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && typeof value === "number" && value > 0 && value <= 1
    ? value
    : fallback;
}
