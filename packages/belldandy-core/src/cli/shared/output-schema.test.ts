import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "./output-schema.js";

describe("compileOutputSchema", () => {
  it("normalizes a single explicit JSON code block after validation", () => {
    const compiled = compileOutputSchema({
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string" },
      },
      additionalProperties: false,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.validator.validateOutput([
      "```json",
      '{"summary":"normalized"}',
      "```",
    ].join("\n"))).toEqual({
      ok: true,
      outputText: '{"summary":"normalized"}',
    });
  });

  it("rejects terminal output with more than one fenced JSON block", () => {
    const compiled = compileOutputSchema({
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string" },
      },
      additionalProperties: false,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.validator.validateOutput([
      "```json",
      '{"summary":"first"}',
      "```",
      "",
      "```json",
      '{"summary":"second"}',
      "```",
    ].join("\n"))).toEqual({
      ok: false,
      message: "Final output is not valid JSON.",
    });
  });
});
