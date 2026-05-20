import { describe, expect, it } from "vitest";

// @vitest-environment jsdom

import {
  buildTokenUsageObservabilitySegments,
  buildTokenUsageObservabilityText,
  syncTokenUsageObservabilityPopover,
} from "./token-usage-observability.js";

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
      usageCalibration: {
        estimatedPromptTokens: 1800,
        actualInputTokens: 2100,
        modelCalls: 2,
        averageInputTokensPerCall: 1050,
        deltaTokens: -750,
        deltaRatio: -0.4167,
        status: "over_estimated",
      },
      sessionTotalCostUsd: 0.0123,
      costBudgetUsd: 0.05,
    });

    expect(text).toContain("CACHE supported");
    expect(text).toContain("HIT 1,234 / MISS 56");
    expect(text).toContain("SAVE $0.001234");
    expect(text).toContain("FP 1234567890abcdef");
    expect(text).toContain("WARM warming / delay_if_possible");
    expect(text).toContain("AFF aligned");
    expect(text).toContain("ROUTE flash / auto_kept_on_flash");
    expect(text).toContain("AUX deepseek_flash_preferred / deepseek_primary_with_flash_candidate / enabled=yes");
    expect(text).toContain("CAL 1,800 -> 1,050 (-42%, over_estimated)");
    expect(text).toContain("COST $0.012300 / $0.050000 (25%)");
  });

  it("returns an empty string when no observability fields are present", () => {
    expect(buildTokenUsageObservabilityText({})).toBe("");
  });

  it("exposes observability as readable segments for popover rendering", () => {
    const segments = buildTokenUsageObservabilitySegments({
      cacheSupport: "unknown",
      cacheHitTokens: 33536,
      cacheMissTokens: 5142,
      deepseekRoute: {
        selectedTier: "flash",
        reason: "auto_kept_on_flash",
      },
    });

    expect(segments).toEqual([
      "CACHE unknown",
      "HIT 33,536 / MISS 5,142",
      "ROUTE flash / auto_kept_on_flash",
    ]);
  });

  it("can hide cost budget segments for the header popover without changing text formatting support", () => {
    const payload = {
      cacheSupport: "unknown",
      sessionTotalCostUsd: 0.0123,
      costBudgetUsd: 0.05,
    };

    expect(buildTokenUsageObservabilitySegments(payload)).toEqual([
      "CACHE unknown",
      "COST $0.012300 / $0.050000 (25%)",
    ]);
    expect(buildTokenUsageObservabilitySegments(payload, undefined, { includeCostBudget: false })).toEqual([
      "CACHE unknown",
    ]);
    expect(buildTokenUsageObservabilityText(payload)).toContain("COST $0.012300 / $0.050000 (25%)");
  });

  it("shifts the expanded observability popover back into the viewport", () => {
    document.body.innerHTML = `
      <div id="tokenUsage" class="token-usage">
        <div id="tokenUsageObservability" class="token-usage-observability">demo</div>
      </div>
    `;
    const tokenUsageEl = document.getElementById("tokenUsage");
    const observabilityEl = document.getElementById("tokenUsageObservability");
    Object.defineProperty(window, "innerWidth", {
      value: 1000,
      configurable: true,
    });
    observabilityEl.getBoundingClientRect = () => ({
      left: -120,
      right: 780,
      width: 900,
      height: 48,
      top: 0,
      bottom: 48,
      x: -120,
      y: 0,
      toJSON() {
        return {};
      },
    });

    syncTokenUsageObservabilityPopover(tokenUsageEl, observabilityEl);

    expect(tokenUsageEl.style.getPropertyValue("--token-usage-observability-shift")).toBe("136px");
  });
});
