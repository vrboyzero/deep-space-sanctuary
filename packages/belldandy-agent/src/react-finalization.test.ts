import { describe, expect, it, vi } from "vitest";
import {
  buildReactFinalizationRequest,
  estimateReactModelCallBudgetInputTokens,
  estimateReactFinalizationInputTokens,
  isReactEmptyContentFinalizationTrigger,
  REACT_FINALIZATION_OUTPUT_TOKEN_RESERVE,
} from "./react-finalization.js";
import { MODEL_LOOP_COST_CONTAINMENT_LIMITS } from "./react-run-budget.js";

describe("ReAct finalization request", () => {
  it("keeps the terminal reserve aligned with the opt-in cost-containment contract", () => {
    expect(REACT_FINALIZATION_OUTPUT_TOKEN_RESERVE)
      .toBe(MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve);
  });

  it("includes retained tool schemas and the established message safety factor in model-call headroom", () => {
    const expressInput = estimateReactModelCallBudgetInputTokens(9_807, 1_769);
    const parallelReadInput = estimateReactModelCallBudgetInputTokens(4_353, 1_850);

    expect(expressInput).toBe(13_538);
    expect(11_087 + expressInput + REACT_FINALIZATION_OUTPUT_TOKEN_RESERVE).toBe(25_649);
    expect(parallelReadInput).toBe(7_074);
    expect(18_084 + parallelReadInput + REACT_FINALIZATION_OUTPUT_TOKEN_RESERVE).toBe(26_182);
  });

  it("limits stop-triggered recovery to a structured-output repair", () => {
    expect(isReactEmptyContentFinalizationTrigger({
      finishReason: "length",
      structuredOutputRepairCall: false,
    })).toBe(true);
    expect(isReactEmptyContentFinalizationTrigger({
      finishReason: "length",
      structuredOutputRepairCall: true,
    })).toBe(true);
    expect(isReactEmptyContentFinalizationTrigger({
      finishReason: "stop",
      structuredOutputRepairCall: true,
    })).toBe(true);
    expect(isReactEmptyContentFinalizationTrigger({
      finishReason: "stop",
      structuredOutputRepairCall: false,
    })).toBe(false);
    expect(isReactEmptyContentFinalizationTrigger({
      finishReason: "unknown",
      structuredOutputRepairCall: true,
    })).toBe(false);
  });

  it("builds a bounded tool-free transcript with the task and recent evidence", () => {
    const request = buildReactFinalizationRequest({
      maxInputTokens: 600,
      tokenEstimateContext: { model: "deepseek-v4-pro" },
      messages: [
        { role: "system", content: "Keep the repository read-only." },
        { role: "user", content: "Diagnose the dependency mismatch." },
        {
          role: "assistant",
          tool_calls: [{
            id: "call-read",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call-read",
          content: JSON.stringify({
            path: "package-lock.json",
            content: `preact-render-to-string ${"X".repeat(20_000)} version=6.5.0`,
          }),
        },
      ],
    });

    expect(request).toBeDefined();
    expect(request?.estimatedInputTokens).toBeLessThanOrEqual(600);
    expect(request?.estimatedInputTokens).toBe(
      estimateReactFinalizationInputTokens(request?.messages ?? [], { model: "deepseek-v4-pro" }),
    );
    expect(request?.evidenceCount).toBe(1);
    expect(request?.truncatedEvidenceCount).toBe(1);
    expect(request?.messages).toEqual([
      { role: "system", content: "Keep the repository read-only." },
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Diagnose the dependency mismatch."),
      }),
    ]);
    expect(request?.messages[1]?.content).toContain("[tool=file_read]");
    expect(request?.messages.some((message) => message.role === ("tool" as string))).toBe(false);
  });

  it("keeps a complete structured-output schema outside bounded task clipping", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["rootCause"],
      properties: {
        rootCause: { const: "exact dependency cause" },
      },
    };
    const request = buildReactFinalizationRequest({
      maxInputTokens: 700,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      structuredOutputSchema: schema,
      messages: [
        { role: "system", content: "Keep the repository read-only." },
        { role: "user", content: `Diagnose the dependency mismatch. ${"task ".repeat(4_000)}` },
      ],
    });

    expect(request).toBeDefined();
    expect(request?.estimatedInputTokens).toBeLessThanOrEqual(700);
    expect(request?.messages.at(-1)?.content).toContain(
      `Final-output contract data:\n${JSON.stringify({ schema })}`,
    );
  });

  it("fails closed when schema serialization erases the contract", () => {
    const toJSON = vi.fn(() => undefined);
    const request = buildReactFinalizationRequest({
      maxInputTokens: 700,
      structuredOutputSchema: { toJSON },
      messages: [
        { role: "system", content: "Keep the repository read-only." },
        { role: "user", content: "Return the final result." },
      ],
    });

    expect(request).toBeUndefined();
    expect(toJSON).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the retained system contract leaves no finalization input budget", () => {
    const request = buildReactFinalizationRequest({
      maxInputTokens: 16,
      messages: [
        { role: "system", content: "S".repeat(2_000) },
        { role: "user", content: "finish" },
      ],
    });

    expect(request).toBeUndefined();
  });
});
