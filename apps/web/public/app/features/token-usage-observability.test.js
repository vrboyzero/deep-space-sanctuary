import { describe, expect, it } from "vitest";

// @vitest-environment jsdom

import {
  buildTokenUsageDiagnosticsSegments,
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
        tierPinning: {
          pinned: true,
          previousTier: "flash",
          reason: "no_upgrade_signal",
        },
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
      localPromptEstimate: {
        systemPromptTokens: 41651,
        contextTokens: 1902,
        totalPromptTokens: 43553,
      },
      requestShape: {
        messageCount: 23,
        systemMessageCount: 7,
        toolSchemaCount: 66,
      },
      providerRawUsage: {
        promptTokens: 35338,
        completionTokens: 81,
        totalTokens: 35419,
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
    expect(text).toContain("ROUTE flash / auto_kept_on_flash / pinned=flash:no_upgrade_signal");
    expect(text).toContain("AUX deepseek_flash_preferred / deepseek_primary_with_flash_candidate / enabled=yes");
    expect(text).toContain("CAL 1,800 -> 1,050 (-42%, over_estimated)");
    expect(text).not.toContain("LOCAL ");
    expect(text).not.toContain("RAW ");
    expect(text).toContain("COST $0.012300 / $0.050000 (25%)");
  });

  it("returns an empty string when no observability fields are present", () => {
    expect(buildTokenUsageObservabilityText({})).toBe("");
  });

  it("formats LOCAL and RAW diagnostics for settings doctor cards", () => {
    expect(buildTokenUsageDiagnosticsSegments({
      localPromptEstimate: {
        systemPromptTokens: 41651,
        contextTokens: 1902,
        totalPromptTokens: 43553,
      },
      requestShape: {
        messageCount: 23,
        systemMessageCount: 7,
        toolSchemaCount: 66,
      },
      providerRawUsage: {
        promptTokens: 35338,
        completionTokens: 81,
        totalTokens: 35419,
      },
    })).toEqual([
      "LOCAL sys=41,651 ctx=1,902 total=43,553 msg=23 sysmsg=7 tools=66",
      "RAW prompt=35,338 completion=81 total=35,419",
    ]);
  });

  it("formats DRIFT and BUDGET diagnostics for settings doctor cards", () => {
    expect(buildTokenUsageDiagnosticsSegments({
      prefixDrift: {
        status: "drifted",
        reasons: [
          "tool_schema_shape_changed",
          "message_prefix_shape_changed",
        ],
      },
      budgetCompetition: {
        pressure: {
          estimatedTotalTokens: 43553,
        },
        sacrifice: {
          historyTrimmed: true,
          trimmedMessageCount: 4,
        },
      },
    })).toEqual([
      "DRIFT drifted / tool_schema_shape_changed,message_prefix_shape_changed",
      "BUDGET prompt=43,553 trim=4 historyTrim=yes",
    ]);
  });

  it("formats COMPRESSION diagnostics when compression is applied", () => {
    const segments = buildTokenUsageObservabilitySegments({
      compression: {
        appliedCount: 3,
        skippedCount: 1,
        failedCount: 0,
        totalSavedTokensEstimate: 1250,
      },
    });
    const compressionSegment = segments.find((s) => s.includes("COMPRESSION"));
    expect(compressionSegment).toBeDefined();
    expect(compressionSegment).toContain("applied=3");
    expect(compressionSegment).toContain("saved=1250tok");
  });

  it("formats ATTACH_COMP diagnostics when attachment compression is applied", () => {
    const segments = buildTokenUsageObservabilitySegments({
      attachmentCompression: {
        appliedCount: 1,
        totalSavedChars: 332,
        totalSavedCharsPositive: true,
      },
    });
    const attachmentSegment = segments.find((s) => s.includes("ATTACH_COMP"));
    expect(attachmentSegment).toBeDefined();
    expect(attachmentSegment).toContain("applied=1");
    expect(attachmentSegment).toContain("saved=332char");
  });

  it("does not show COMPRESSION segment when no compression applied", () => {
    const segments = buildTokenUsageObservabilitySegments({
      compression: {
        appliedCount: 0,
        skippedCount: 5,
        failedCount: 0,
        totalSavedTokensEstimate: 0,
      },
    });
    const compressionSegment = segments.find((s) => s.includes("COMPRESSION"));
    expect(compressionSegment).toBeUndefined();
  });

  it("exposes observability as readable segments for popover rendering", () => {
    const segments = buildTokenUsageObservabilitySegments({
      cacheSupport: "unknown",
      cacheHitTokens: 33536,
      cacheMissTokens: 5142,
      deepseekRoute: {
        selectedTier: "flash",
        reason: "auto_kept_on_flash",
        tierPinning: {
          pinned: true,
          previousTier: "flash",
          reason: "no_upgrade_signal",
        },
      },
      localPromptEstimate: {
        systemPromptTokens: 41651,
        contextTokens: 1902,
        totalPromptTokens: 43553,
      },
      requestShape: {
        messageCount: 23,
        systemMessageCount: 7,
        toolSchemaCount: 66,
      },
      providerRawUsage: {
        promptTokens: 35338,
        completionTokens: 81,
        totalTokens: 35419,
      },
    });

    expect(segments).toEqual([
      "CACHE unknown",
      "HIT 33,536 / MISS 5,142",
      "ROUTE flash / auto_kept_on_flash / pinned=flash:no_upgrade_signal",
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

  it("anchors the expanded observability popover to the header and centers it", () => {
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
    tokenUsageEl.getBoundingClientRect = () => ({
      left: 40,
      right: 280,
      width: 240,
      height: 48,
      top: 0,
      bottom: 48,
      x: 40,
      y: 0,
      toJSON() {
        return {};
      },
    });

    syncTokenUsageObservabilityPopover(tokenUsageEl, observabilityEl);

    expect(observabilityEl.style.getPropertyValue("--token-usage-observability-top")).toBe("56px");
    expect(observabilityEl.style.getPropertyValue("--token-usage-observability-shift")).toBe("0px");
  });
});
