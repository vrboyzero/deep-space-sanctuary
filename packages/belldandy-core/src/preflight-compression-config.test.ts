import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFLIGHT_COMPRESSION_POLICY,
  readPreflightCompressionPolicyFromEnv,
  shouldCompressAttachmentText,
} from "./preflight-compression-config.js";

describe("preflight compression config", () => {
  it("uses conservative defaults compatible with existing attachment compression", () => {
    const policy = readPreflightCompressionPolicyFromEnv({});

    expect(policy).toEqual(DEFAULT_PREFLIGHT_COMPRESSION_POLICY);
    expect(shouldCompressAttachmentText(policy, "x".repeat(1_199))).toBe(false);
    expect(shouldCompressAttachmentText(policy, "x".repeat(1_200))).toBe(true);
  });

  it("normalizes env overrides and disables attachment compression when requested", () => {
    const policy = readPreflightCompressionPolicyFromEnv({
      BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED: "false",
      BELLDANDY_PREFLIGHT_COMPRESSION_MODE: "attachments",
      BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS: "4000",
      BELLDANDY_PREFLIGHT_TARGET_RATIO: "0.4",
      BELLDANDY_PREFLIGHT_MIN_SAVINGS_RATIO: "0.25",
      BELLDANDY_PREFLIGHT_TIMEOUT_MS: "1500",
      BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE: "sidecar",
      BELLDANDY_PREFLIGHT_SIDECAR_RETENTION_MS: "60000",
      BELLDANDY_PREFLIGHT_SIDECAR_MAX_ENTRIES: "12",
    });

    expect(policy).toEqual({
      enabled: false,
      mode: "attachments",
      attachmentThresholdChars: 4_000,
      targetRatio: 0.4,
      minSavingsRatio: 0.25,
      timeoutMs: 1_500,
      attachmentReference: "sidecar",
      sidecarRetentionMs: 60_000,
      sidecarMaxEntries: 12,
    });
    expect(shouldCompressAttachmentText(policy, "x".repeat(10_000))).toBe(false);
  });

  it("falls back on defaults for invalid env values", () => {
    const policy = readPreflightCompressionPolicyFromEnv({
      BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED: "maybe",
      BELLDANDY_PREFLIGHT_COMPRESSION_MODE: "invalid",
      BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS: "-1",
      BELLDANDY_PREFLIGHT_TARGET_RATIO: "2",
      BELLDANDY_PREFLIGHT_MIN_SAVINGS_RATIO: "0",
      BELLDANDY_PREFLIGHT_TIMEOUT_MS: "NaN",
      BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE: "disk",
    });

    expect(policy).toEqual(DEFAULT_PREFLIGHT_COMPRESSION_POLICY);
  });
});
