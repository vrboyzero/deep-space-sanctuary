import { describe, expect, it } from "vitest";

import {
  applyPromptExperimentsToSections,
  buildPromptObservabilitySummary,
  buildPromptTokenBreakdown,
  formatPromptObservabilityHeadline,
  measurePromptText,
  parsePromptExperimentConfig,
  renderPromptObservabilityText,
  toPromptObservabilityView,
  withDeltaPromptMetrics,
  withProviderNativeSystemBlockPromptMetrics,
  withSectionPromptMetrics,
} from "./prompt-observability.js";

describe("prompt observability", () => {
  it("measures chars and tokens for sections, deltas, and provider-native blocks", () => {
    expect(withSectionPromptMetrics({
      id: "core",
      label: "core",
      source: "core",
      priority: 0,
      text: "hello world",
    })).toMatchObject({
      charLength: 11,
      estimatedChars: 11,
      estimatedTokens: 2,
    });

    expect(withDeltaPromptMetrics({
      id: "delta-1",
      deltaType: "attachment",
      role: "attachment",
      text: "中文测试",
    })).toMatchObject({
      charLength: 4,
      estimatedChars: 4,
      estimatedTokens: 4,
    });

    expect(withProviderNativeSystemBlockPromptMetrics({
      id: "block-1",
      blockType: "static-capability",
      text: "abcd",
      sourceSectionIds: ["methodology"],
      sourceDeltaIds: [],
      cacheControlEligible: true,
    })).toMatchObject({
      charLength: 4,
      estimatedChars: 4,
      estimatedTokens: 1,
    });

    expect(measurePromptText("")).toMatchObject({
      charLength: 0,
      estimatedChars: 0,
      estimatedTokens: 0,
    });
  });

  it("builds token breakdown across prompt layers", () => {
    expect(buildPromptTokenBreakdown({
      systemPromptText: "hello world",
      sections: [{ text: "hello world" }],
      droppedSections: [{ text: "abcd" }],
      deltas: [{ text: "中文测试" }],
      providerNativeSystemBlocks: [{ text: "abcd" }],
    })).toMatchObject({
      systemPromptEstimatedChars: 11,
      systemPromptEstimatedTokens: 2,
      sectionEstimatedChars: 11,
      sectionEstimatedTokens: 2,
      droppedSectionEstimatedChars: 4,
      droppedSectionEstimatedTokens: 1,
      deltaEstimatedChars: 4,
      deltaEstimatedTokens: 4,
      providerNativeSystemBlockEstimatedChars: 4,
      providerNativeSystemBlockEstimatedTokens: 1,
    });
  });

  it("uses model-aware estimates when a model is provided", () => {
    const markdown = Array.from({ length: 20 }, (_, index) => `## Section ${index}\n- item ${index}\n`).join("");
    const generic = buildPromptTokenBreakdown({
      systemPromptText: markdown,
    });
    const deepseek = buildPromptTokenBreakdown({
      systemPromptText: markdown,
      model: "deepseek-v4-pro",
    });

    expect(deepseek.systemPromptEstimatedTokens).toBeGreaterThan(generic.systemPromptEstimatedTokens);
  });

  it("parses and applies the disabled-section experiment", () => {
    const config = parsePromptExperimentConfig({
      disabledSectionIdsRaw: "methodology, context , ,workspace-tools",
      sectionPriorityOverridesRaw: "context:5,core:0,invalid,nope:abc",
      disabledToolContractNamesRaw: "apply_patch, run_command , ",
    });
    expect(config).toEqual({
      disabledSectionIds: ["methodology", "context", "workspace-tools"],
      sectionPriorityOverrides: {
        context: 5,
        core: 0,
      },
      disabledToolContractNames: ["apply_patch", "run_command"],
    });

    const applied = applyPromptExperimentsToSections([
      {
        id: "core",
        label: "core",
        source: "core",
        priority: 0,
        text: "core",
      },
      {
        id: "methodology",
        label: "methodology",
        source: "methodology",
        priority: 1,
        text: "methodology",
      },
      {
        id: "context",
        label: "context",
        source: "context",
        priority: 2,
        text: "context",
      },
      {
        id: "extra",
        label: "extra",
        source: "extra",
        priority: 100,
        text: "extra",
      },
    ], config);

    expect(applied.sections.map((section) => section.id)).toEqual(["core", "extra"]);
    expect(applied.droppedSections.map((section) => section.id)).toEqual(["methodology", "context"]);
    expect(applied.disabledSectionIdsApplied).toEqual(["methodology", "context"]);
    expect(applied.sectionPriorityOverridesApplied).toEqual({
      core: 0,
      context: 5,
    });
  });

  it("builds a doctor-friendly prompt observability summary", () => {
    const summary = buildPromptObservabilitySummary({
      scope: "run",
      agentId: "default",
      displayName: "Belldandy",
      model: "primary",
      conversationId: "conv-1",
      runId: "run-1",
      createdAt: 123,
      text: "hello world",
      totalChars: 11,
      finalChars: 11,
      sections: [{ id: "core", text: "hello world" }],
      droppedSections: [{ id: "methodology", text: "abcd" }],
      deltas: [{ id: "delta-1", text: "中文测试" }],
      providerNativeSystemBlocks: [{ id: "block-1", text: "abcd", cacheControlEligible: true }],
      truncated: true,
      maxChars: 8,
      metadata: {
        truncationReason: {
          code: "max_chars_limit",
          maxChars: 8,
          droppedSectionCount: 1,
          droppedSectionIds: ["methodology"],
          droppedSectionLabels: ["methodology"],
          truncatedSectionIds: ["core"],
          truncatedSectionLabels: ["core"],
          message: "Dropped methodology and truncated core to fit 8 char limit.",
        },
        cacheSupport: "supported",
        capabilitySource: "provider-model-catalog",
        providerCacheEligible: true,
        systemPromptFingerprint: "abc123fingerprint",
        prefixDrift: {
          status: "drifted",
          changed: true,
          reasons: ["system_prompt_fingerprint_changed", "section_id_order_changed"],
          previousFingerprint: "prev123",
          currentFingerprint: "abc123fingerprint",
        },
        prefixWarmState: {
          eligible: true,
          status: "warming",
          samePrefixAsPrevious: true,
          previousAgeMs: 1200,
          reason: "matching_prefix_recently_seen_may_still_be_warming",
        },
        orderingGuard: {
          status: "risk",
          reasons: ["dynamic_runtime_sections_present", "tool_contract_list_injected"],
        },
        structureSignature: "sig-123",
        cacheFamilyAffinity: {
          status: "aligned",
          familyKey: "family-1",
          previousFamilyKey: "family-1",
          reason: "same_cache_family_as_previous",
        },
        warmupCoordination: {
          eligible: true,
          status: "warming",
          recommendation: "delay_if_possible",
          reason: "matching_prefix_recent_but_ordering_risk_present",
          previousAgeMs: 1200,
        },
        contextInjection: {
          prependContextChars: 480,
          totalBlockCount: 3,
          blockTags: ["current-turn", "recent-memory", "auto-recall"],
          blockLineCounts: {
            "current-turn": 1,
            "recent-memory": 2,
            "auto-recall": 2,
          },
          autoRecall: {
            candidateCount: 3,
            keptCount: 2,
            injectedCount: 2,
            filteredOutCount: 1,
            minScore: 0.3,
            sourceClassMix: {
              curated: 1,
              raw: 1,
            },
            topHitIds: ["chunk-1", "chunk-2"],
            nodeHitCount: 1,
            nodeBackedCount: 1,
            chunkOnlyCount: 1,
            nodeBackedShare: 0.5,
            chunkOnlyShare: 0.5,
            nodeHitRate: 0.5,
            fallbackApplied: true,
            fallbackRate: 0.5,
            usefulHitCount: 1,
            usefulHitRate: 0.5,
            charsPerUsefulHit: 400,
            tokensPerUsefulHit: 100,
            sourceNoiseCount: 1,
            sourceNoiseRatio: 0.5,
            nodeSummarySavingsChars: 120,
            nodeSummarySavingsTokens: 30,
            nodeSummaryCompressionRatio: 0.4,
            injectionCharsBySourceClass: {
              curated: 240,
              raw: 160,
            },
            injectionTokensBySourceClass: {
              curated: 60,
              raw: 40,
            },
          },
        },
        promptExperiments: {
          disabledSectionIdsApplied: ["methodology"],
        },
      },
    });

    expect(summary).toMatchObject({
      scope: "run",
      agentId: "default",
      counts: {
        sectionCount: 1,
        droppedSectionCount: 1,
        deltaCount: 1,
        providerNativeSystemBlockCount: 1,
      },
      promptSizes: {
        totalChars: 11,
        finalChars: 11,
      },
      tokenBreakdown: {
        systemPromptEstimatedTokens: 2,
        droppedSectionEstimatedTokens: 1,
        deltaEstimatedTokens: 4,
        providerNativeSystemBlockEstimatedTokens: 1,
      },
      cacheSupport: "supported",
      capabilitySource: "provider-model-catalog",
      providerCacheEligible: true,
      systemPromptFingerprint: "abc123fingerprint",
      prefixDrift: {
        status: "drifted",
        changed: true,
        reasons: ["system_prompt_fingerprint_changed", "section_id_order_changed"],
        previousFingerprint: "prev123",
        currentFingerprint: "abc123fingerprint",
      },
      prefixWarmState: {
        eligible: true,
        status: "warming",
        samePrefixAsPrevious: true,
        previousAgeMs: 1200,
        reason: "matching_prefix_recently_seen_may_still_be_warming",
      },
      orderingGuard: {
        status: "risk",
        reasons: ["dynamic_runtime_sections_present", "tool_contract_list_injected"],
      },
      structureSignature: "sig-123",
      cacheFamilyAffinity: {
        status: "aligned",
        familyKey: "family-1",
        previousFamilyKey: "family-1",
        reason: "same_cache_family_as_previous",
      },
      warmupCoordination: {
        eligible: true,
        status: "warming",
        recommendation: "delay_if_possible",
        reason: "matching_prefix_recent_but_ordering_risk_present",
        previousAgeMs: 1200,
      },
      contextInjection: {
        prependContextChars: 480,
        totalBlockCount: 3,
        blockTags: ["current-turn", "recent-memory", "auto-recall"],
        autoRecall: {
          candidateCount: 3,
          keptCount: 2,
          injectedCount: 2,
          filteredOutCount: 1,
          minScore: 0.3,
          topHitIds: ["chunk-1", "chunk-2"],
          nodeHitCount: 1,
          nodeBackedCount: 1,
          chunkOnlyCount: 1,
          nodeBackedShare: 0.5,
          chunkOnlyShare: 0.5,
          nodeHitRate: 0.5,
          fallbackApplied: true,
          fallbackRate: 0.5,
          usefulHitCount: 1,
          usefulHitRate: 0.5,
          charsPerUsefulHit: 400,
          tokensPerUsefulHit: 100,
          sourceNoiseCount: 1,
          sourceNoiseRatio: 0.5,
          nodeSummarySavingsChars: 120,
          nodeSummarySavingsTokens: 30,
          nodeSummaryCompressionRatio: 0.4,
        },
      },
      truncationReason: {
        code: "max_chars_limit",
        maxChars: 8,
        droppedSectionCount: 1,
        droppedSectionIds: ["methodology"],
        truncatedSectionIds: ["core"],
      },
      experiments: {
        disabledSectionIdsApplied: ["methodology"],
      },
    });
  });

  it("reads token breakdown from canonical metadata key", () => {
    const summary = buildPromptObservabilitySummary({
      agentId: "default",
      text: "hello world",
      totalChars: 11,
      finalChars: 11,
      metadata: {
        tokenBreakdown: {
          systemPromptEstimatedChars: 11,
          systemPromptEstimatedTokens: 3,
          sectionEstimatedChars: 11,
          sectionEstimatedTokens: 3,
          droppedSectionEstimatedChars: 0,
          droppedSectionEstimatedTokens: 0,
          deltaEstimatedChars: 0,
          deltaEstimatedTokens: 0,
          providerNativeSystemBlockEstimatedChars: 0,
          providerNativeSystemBlockEstimatedTokens: 0,
        },
      },
    });

    expect(summary.tokenBreakdown).toMatchObject({
      systemPromptEstimatedTokens: 3,
      sectionEstimatedTokens: 3,
    });
  });

  it("ignores legacy promptTokenBreakdown aliases outside snapshot artifact normalization", () => {
    const runSummary = buildPromptObservabilitySummary({
      agentId: "default",
      text: "hello world",
      totalChars: 11,
      finalChars: 11,
      metadata: {
        snapshotScope: "run",
        promptTokenBreakdown: {
          systemPromptEstimatedChars: 11,
          systemPromptEstimatedTokens: 3,
          sectionEstimatedChars: 11,
          sectionEstimatedTokens: 3,
          droppedSectionEstimatedChars: 0,
          droppedSectionEstimatedTokens: 0,
          deltaEstimatedChars: 0,
          deltaEstimatedTokens: 0,
          providerNativeSystemBlockEstimatedChars: 0,
          providerNativeSystemBlockEstimatedTokens: 0,
        },
      },
    });

    expect(runSummary.tokenBreakdown).toMatchObject({
      systemPromptEstimatedTokens: 2,
      sectionEstimatedTokens: 0,
    });

    const agentSummary = buildPromptObservabilitySummary({
      agentId: "default",
      text: "hello world",
      totalChars: 11,
      finalChars: 11,
      metadata: {
        promptTokenBreakdown: {
          systemPromptEstimatedChars: 11,
          systemPromptEstimatedTokens: 99,
          sectionEstimatedChars: 11,
          sectionEstimatedTokens: 99,
          droppedSectionEstimatedChars: 0,
          droppedSectionEstimatedTokens: 0,
          deltaEstimatedChars: 0,
          deltaEstimatedTokens: 0,
          providerNativeSystemBlockEstimatedChars: 0,
          providerNativeSystemBlockEstimatedTokens: 0,
        },
      },
    });

    expect(agentSummary.tokenBreakdown).toMatchObject({
      systemPromptEstimatedTokens: 2,
      sectionEstimatedTokens: 0,
    });
  });

  it("renders canonical prompt observability text and headline", () => {
    const summary = buildPromptObservabilitySummary({
      scope: "run",
      agentId: "default",
      conversationId: "conv-1",
      runId: "run-1",
      createdAt: 123,
      text: "hello world",
      totalChars: 11,
      finalChars: 11,
      sections: [{ id: "core", text: "hello world" }],
      droppedSections: [{ id: "methodology", text: "abcd" }],
      deltas: [{ id: "delta-1", text: "中文测试" }],
      providerNativeSystemBlocks: [{ id: "block-1", text: "abcd" }],
      truncated: true,
      maxChars: 8,
      metadata: {
        truncationReason: {
          code: "max_chars_limit",
          maxChars: 8,
          droppedSectionCount: 1,
          droppedSectionIds: ["methodology"],
          droppedSectionLabels: ["methodology"],
          truncatedSectionIds: ["core"],
          truncatedSectionLabels: ["core"],
          message: "Dropped methodology and truncated core to fit 8 char limit.",
        },
        contextInjection: {
          prependContextChars: 480,
          totalBlockCount: 3,
          blockTags: ["current-turn", "recent-memory", "auto-recall"],
          autoRecall: {
            candidateCount: 3,
            keptCount: 2,
            injectedCount: 2,
            filteredOutCount: 1,
            minScore: 0.3,
            topHitIds: ["chunk-1", "chunk-2"],
            nodeHitCount: 1,
            nodeBackedCount: 1,
            chunkOnlyCount: 1,
            nodeBackedShare: 0.5,
            chunkOnlyShare: 0.5,
            nodeHitRate: 0.5,
            fallbackApplied: true,
            fallbackRate: 0.5,
            usefulHitCount: 1,
            usefulHitRate: 0.5,
            charsPerUsefulHit: 400,
            tokensPerUsefulHit: 100,
            sourceNoiseCount: 1,
            sourceNoiseRatio: 0.5,
            nodeSummarySavingsChars: 120,
            nodeSummarySavingsTokens: 30,
            nodeSummaryCompressionRatio: 0.4,
          },
        },
      },
    });

    const view = toPromptObservabilityView(summary, {
      truncated: false,
      includesHookSystemPrompt: true,
      hasPrependContext: false,
    });

    expect(formatPromptObservabilityHeadline(view)).toContain("agent=default");
    expect(formatPromptObservabilityHeadline(view)).toContain("sections=1");
    expect(formatPromptObservabilityHeadline(view)).toContain("blockTokens=1");
    expect(formatPromptObservabilityHeadline(view)).toContain("prependChars=480");
    expect(formatPromptObservabilityHeadline(view)).toContain("autoRecall=2");
    expect(formatPromptObservabilityHeadline(view)).toContain("nodeHit=0.5");
    expect(formatPromptObservabilityHeadline(view)).toContain("fallback=0.5");
    expect(formatPromptObservabilityHeadline(view)).toContain("useful=0.5");
    expect(formatPromptObservabilityHeadline(view)).toContain("tok/useful=100");
    expect(formatPromptObservabilityHeadline(view)).toContain("noise=0.5");
    expect(formatPromptObservabilityHeadline(view)).toContain("summarySaveTok=30");
    expect(formatPromptObservabilityHeadline(view)).toContain("truncation=max_chars_limit");

    expect(renderPromptObservabilityText(view)).toContain("Prompt Observability");
    expect(renderPromptObservabilityText(view)).toContain("sectionCount: 1");
    expect(renderPromptObservabilityText(view)).toContain("droppedSectionCount: 1");
    expect(renderPromptObservabilityText(view)).toContain("systemPromptEstimatedTokens: 2");
    expect(renderPromptObservabilityText(view)).toContain("includesHookSystemPrompt: yes");
    expect(renderPromptObservabilityText(view)).toContain("prependContextChars: 480");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallKeptCount: 2");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallInjectedCount: 2");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallNodeHitRate: 0.5");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallFallbackRate: 0.5");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallUsefulHitRate: 0.5");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallTokensPerUsefulHit: 100");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallSourceNoiseRatio: 0.5");
    expect(renderPromptObservabilityText(view)).toContain("autoRecallNodeSummarySavingsTokens: 30");
    expect(renderPromptObservabilityText(view)).toContain("truncationReasonCode: max_chars_limit");
    expect(renderPromptObservabilityText(view)).toContain("truncationTruncatedSectionIds: core");
  });
});
