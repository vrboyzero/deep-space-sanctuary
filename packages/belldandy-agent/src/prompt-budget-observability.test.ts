import { describe, expect, it } from "vitest";

import {
  buildBudgetCompetition,
  buildPrefixShape,
  classifyPrefixDrift,
} from "./prompt-budget-observability.js";

describe("prompt budget observability", () => {
  it("builds stable prefix shape hashes and token buckets", () => {
    const result = buildPrefixShape({
      messages: [
        { role: "system", content: "system rules" },
        { role: "assistant", content: "working", reasoning_content: "hidden chain" },
        { role: "user", content: "please continue" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "apply_patch",
          description: "patch files",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      }],
      runtimePromptDeltas: [{
        id: "tool-failure",
        deltaType: "tool-failure-recovery",
        role: "system",
        text: "recover from failure",
      }],
      providerNativeSystemBlocks: [{
        id: "provider-native-static-capability",
        blockType: "static-capability",
        text: "native cache block",
        sourceSectionIds: [],
        sourceDeltaIds: [],
        cacheControlEligible: true,
      }],
      model: "deepseek-v4-pro",
    });

    expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(result.shapeHashes.systemPrompt).toMatch(/^[0-9a-f]{16}$/);
    expect(result.counts.toolSchemaCount).toBe(1);
    expect(result.prefixTokens.toolSchemaTokens).toBeGreaterThan(0);
  });

  it("classifies prefix drift reasons by changed shape layers", () => {
    const drift = classifyPrefixDrift({
      previous: {
        fingerprint: "prev-fingerprint",
        shapeHashes: {
          systemPrompt: "a",
          toolSchema: "b",
          runtimeDelta: "c",
          providerNativeBlocks: "d",
          messagePrefix: "e",
        },
        routeTier: "flash",
        routeModel: "deepseek-v4-flash",
      },
      current: {
        fingerprint: "next-fingerprint",
        shapeHashes: {
          systemPrompt: "a2",
          toolSchema: "b2",
          runtimeDelta: "c",
          providerNativeBlocks: "d",
          messagePrefix: "e2",
        },
        routeTier: "pro",
        routeModel: "deepseek-v4-pro",
      },
    });

    expect(drift.status).toBe("drifted");
    expect(drift.reasons).toEqual(expect.arrayContaining([
      "prefix_fingerprint_changed",
      "system_prompt_shape_changed",
      "tool_schema_shape_changed",
      "message_prefix_shape_changed",
      "deepseek_route_tier_changed",
      "deepseek_route_model_changed",
    ]));
  });

  it("surfaces budget competition and history sacrifice separately from tool schema cost", () => {
    const budget = buildBudgetCompetition({
      messages: [
        { role: "system", content: "system rules" },
        { role: "assistant", content: "tool summary", reasoning_content: "reasoning blob" },
        { role: "tool", tool_call_id: "call-1", content: "tool output payload" },
        { role: "user", content: "continue task" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "tool_search",
          description: "search tools",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      }],
      runtimePromptDeltas: [{
        id: "recent-memory",
        deltaType: "user-prelude",
        role: "user-prelude",
        text: "<recent-memory>important memory</recent-memory>",
        metadata: {
          blockTag: "recent-memory",
        },
      }, {
        id: "tool-guidance",
        deltaType: "tool-search-follow-up",
        role: "system",
        text: "use loaded tool directly",
      }],
      prependContext: "<recent-memory>important memory</recent-memory>",
      maxInputTokens: 10,
      trimDiagnostics: {
        trimmedMessageCount: 2,
        trimmedHistoryTokens: 80,
      },
    });

    expect(budget.tokenBreakdown.memoryPreludeTokens).toBeGreaterThan(0);
    expect(budget.tokenBreakdown.toolGuidanceDeltaTokens).toBeGreaterThan(0);
    expect(budget.sacrifice.historyTrimmed).toBe(true);
    expect(budget.sacrifice.keptToolSchemaCount).toBe(1);
    expect(budget.competition[0]?.estimatedTokens).toBeGreaterThan(0);
  });
});
