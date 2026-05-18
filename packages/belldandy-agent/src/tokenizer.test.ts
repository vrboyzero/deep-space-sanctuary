import { describe, expect, it } from "vitest";

import { estimateTokens, resolveTokenEstimateProfile } from "./tokenizer.js";

function legacyEstimateTokens(text: string): number {
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const nonCjkCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 2 + nonCjkCount / 4);
}

describe("tokenizer", () => {
  it("resolves provider/model hints to stable local profiles", () => {
    expect(resolveTokenEstimateProfile({ model: "deepseek-v4-pro" })).toBe("deepseek");
    expect(resolveTokenEstimateProfile({ model: "gpt-5.4" })).toBe("openai");
    expect(resolveTokenEstimateProfile({ provider: "anthropic" })).toBe("anthropic");
    expect(resolveTokenEstimateProfile({ model: "custom-model" })).toBe("generic");
  });

  it("keeps short English phrases close to natural word boundaries", () => {
    expect(estimateTokens("Hello world")).toBe(2);
    expect(estimateTokens("plain text sample plain text sample")).toBe(8);
  });

  it("treats structured code-like text as heavier than plain prose", () => {
    const plain = estimateTokens("plain text sample plain text sample");
    const structured = estimateTokens("const foo = bar();\nreturn foo;");
    expect(structured).toBeGreaterThan(plain);
    expect(structured).toBe(11);
  });

  it("raises CJK estimates above the old char-based heuristic", () => {
    const text = "你好世界你好世界";
    expect(estimateTokens(text)).toBeGreaterThan(legacyEstimateTokens(text));
  });

  it("allows provider profiles to tune the same input conservatively", () => {
    const text = "缓存命中 + JSON 输出";
    expect(estimateTokens(text, { model: "deepseek-v4-pro" }))
      .toBeGreaterThanOrEqual(estimateTokens(text, { model: "gpt-5.4" }));
  });

  it("coerces object-shaped text payloads without throwing", () => {
    const value = {
      content: [
        { text: "object summary" },
      ],
    } as unknown as string;

    expect(estimateTokens(value)).toBeGreaterThan(0);
  });
});
