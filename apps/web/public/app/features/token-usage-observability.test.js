import { describe, expect, it } from "vitest";

import { buildTokenUsageObservabilityText } from "./token-usage-observability.js";

describe("token usage observability", () => {
  it("builds a readable cache observability summary", () => {
    const text = buildTokenUsageObservabilityText({
      cacheSupport: "supported",
      cacheHitTokens: 1234,
      cacheMissTokens: 56,
      cacheSavingsUsd: 0.001234,
      systemPromptFingerprint: "1234567890abcdef1234",
      warmupCoordination: {
        status: "warming",
        recommendation: "delay_if_possible",
      },
      cacheFamilyAffinity: {
        status: "aligned",
      },
      deepseekRoute: {
        selectedTier: "flash",
        reason: "auto_kept_on_flash",
      },
      auxSummaryVerdict: {
        strategy: "deepseek_flash_preferred",
        enabled: true,
        reason: "deepseek_primary_with_flash_candidate",
      },
    });

    expect(text).toContain("CACHE supported");
    expect(text).toContain("HIT 1,234 / MISS 56");
    expect(text).toContain("SAVE $0.001234");
    expect(text).toContain("FP 1234567890abcdef");
    expect(text).toContain("WARM warming / delay_if_possible");
    expect(text).toContain("AFF aligned");
    expect(text).toContain("ROUTE flash / auto_kept_on_flash");
    expect(text).toContain("AUX deepseek_flash_preferred / deepseek_primary_with_flash_candidate / enabled=yes");
  });

  it("returns an empty string when no observability fields are present", () => {
    expect(buildTokenUsageObservabilityText({})).toBe("");
  });
});
