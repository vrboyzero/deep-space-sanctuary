import { describe, expect, it, vi } from "vitest";

import { createStructuredOutputSession } from "./structured-output.js";

const validationMessage = "Final output does not match --output-schema at /summary (keyword=maxLength, limit=1000).";

describe("structured-output maxLength terminal repair", () => {
  it("clamps a repeated overlong string by Unicode code points and revalidates it", () => {
    const schema = summarySchema(1_000);
    const validateOutput = vi.fn(createSummaryValidator(1_000));
    const session = createStructuredOutputSession({ schema, validateOutput });
    const overlong = JSON.stringify({ summary: "星".repeat(999) + "🌟🌟" });

    expect(session.reviewFinal(overlong)).toMatchObject({ action: "repair" });
    const review = session.reviewFinal(overlong);

    expect(review.action).toBe("accept");
    if (review.action !== "accept") return;
    const output = JSON.parse(review.outputText) as { summary: string };
    expect([...output.summary]).toHaveLength(1_000);
    expect(output.summary.endsWith("🌟")).toBe(true);
    expect(validateOutput).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      name: "schema limit differs",
      schema: summarySchema(999),
      text: JSON.stringify({ summary: "x".repeat(1_001) }),
    },
    {
      name: "target is not a string",
      schema: summarySchema(1_000),
      text: JSON.stringify({ summary: ["x"] }),
    },
    {
      name: "draft is not raw JSON",
      schema: summarySchema(1_000),
      text: "not-json",
    },
  ])("fails closed when $name", ({ schema, text }) => {
    const session = createStructuredOutputSession({
      schema,
      validateOutput: () => ({ ok: false as const, message: validationMessage }),
    });

    expect(session.reviewFinal(text)).toMatchObject({ action: "repair" });
    expect(session.reviewFinal(text)).toEqual({
      action: "reject",
      originalText: text,
      message: validationMessage,
    });
  });
});

function summarySchema(maxLength: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: { summary: { type: "string", maxLength } },
  };
}

function createSummaryValidator(maxLength: number) {
  return (text: string) => {
    try {
      const output = JSON.parse(text) as { summary?: unknown };
      return typeof output.summary === "string" && [...output.summary].length <= maxLength
        ? { ok: true as const, outputText: text.trim() }
        : { ok: false as const, message: validationMessage };
    } catch {
      return { ok: false as const, message: "Final output is not valid JSON." };
    }
  };
}
