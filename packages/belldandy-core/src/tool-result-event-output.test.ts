import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT,
  MAX_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT,
  projectToolResultEventOutput,
  resolveToolResultEventOutputCharLimit,
} from "./tool-result-event-output.js";

describe("tool result event output projection", () => {
  it("keeps the production default at 500 characters", () => {
    expect(resolveToolResultEventOutputCharLimit(undefined)).toBe(DEFAULT_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT);
    expect(DEFAULT_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT).toBe(500);
  });

  it("accepts an explicit bounded limit up to 2048 characters", () => {
    expect(resolveToolResultEventOutputCharLimit("2048")).toBe(MAX_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT);
    expect(MAX_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT).toBe(2_048);
  });

  it.each(["2049", "0", "1.5", "invalid", Number.POSITIVE_INFINITY])(
    "fails closed to the production default for invalid value %s",
    (value) => {
      expect(resolveToolResultEventOutputCharLimit(value)).toBe(DEFAULT_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT);
    },
  );

  it("truncates string output at the resolved bound and preserves non-string output", () => {
    expect(projectToolResultEventOutput("x".repeat(2_049), 2_048)).toBe(`${"x".repeat(2_048)}\u2026`);
    expect(projectToolResultEventOutput({ ok: true }, 2_048)).toEqual({ ok: true });
  });
});
