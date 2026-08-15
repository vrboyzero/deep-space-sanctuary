import { describe, expect, it } from "vitest";
import { buildBoundedStructuredOutputRepairRequest } from "./react-structured-output-repair.js";

describe("bounded structured-output repair request", () => {
  it("keeps the complete repair contract and bounds only the untrusted draft", () => {
    const repairPrompt = [
      "Return JSON for this schema:",
      '{"type":"object","properties":{"status":{"const":"ok"}}}',
    ].join("\n");
    const originalText = `status is ok\n${"diagnostic ".repeat(2_000)}`;
    const request = buildBoundedStructuredOutputRepairRequest({
      repairPrompt,
      originalText,
      maxInputTokens: 420,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    });

    expect(request).toBeDefined();
    expect(request?.estimatedInputTokens).toBeLessThanOrEqual(420);
    expect(request?.draftTruncated).toBe(true);
    expect(request?.messages).toHaveLength(2);
    expect(request?.messages[0]?.content).toContain("Bounded structured-output repair phase");
    expect(request?.messages[1]?.content).toContain(repairPrompt);
    expect(request?.messages[1]?.content).toContain("bounded for structured-output repair");
  });

  it("fails closed when the complete repair contract or a useful draft cannot fit", () => {
    expect(buildBoundedStructuredOutputRepairRequest({
      repairPrompt: `schema ${"field ".repeat(2_000)}`,
      originalText: "status is ok",
      maxInputTokens: 64,
    })).toBeUndefined();
    expect(buildBoundedStructuredOutputRepairRequest({
      repairPrompt: "return valid JSON",
      originalText: "",
      maxInputTokens: 512,
    })).toBeUndefined();
  });
});
