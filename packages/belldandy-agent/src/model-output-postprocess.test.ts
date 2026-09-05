import { describe, expect, it } from "vitest";

import { classifyModelFinishReason, diagnoseModelOutputPostprocess, stripToolCallsSection } from "./model-output-postprocess.js";

function validateSummary(text: string): { ok: boolean } {
  try {
    const value = JSON.parse(text);
    return { ok: value?.summary === "complete" };
  } catch {
    return { ok: false };
  }
}

describe("model output postprocess diagnostics", () => {
  it.each(["stop", "length", "tool_calls", "max_tokens"])("retains the known finish reason %s", (value) => {
    expect(classifyModelFinishReason(value)).toBe(value);
  });

  it.each([undefined, null, "private-provider-value", { reason: "private-value" }])
    ("does not expose an absent or unrecognized finish reason %j", (value) => {
      expect(classifyModelFinishReason(value)).toBe("unknown");
    });

  it("distinguishes whitespace contraction from a protocol change without exposing text", () => {
    const raw = `${"\n".repeat(346)}private-response-value`;
    const diagnostics = diagnoseModelOutputPostprocess(raw, stripToolCallsSection(raw), validateSummary);
    expect(diagnostics).toMatchObject({
      rawContentLength: raw.length, rawTrimmedLength: 22, displayContentLength: 22,
      contentChanged: true, whitespaceOnlyChange: true, rawJsonKind: "non_json", displayJsonKind: "non_json",
      rawSchemaValid: false, displaySchemaValid: false,
      toolSectionBegins: 0, toolSectionEnds: 0, toolCallBegins: 0, toolCallEnds: 0,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("private-response-value");
  });

  it("identifies protocol markers without returning or executing their payload", () => {
    const raw = "private-response-value<|tool_calls_section_begin|><|tool_call_begin|>private-tool-arguments<|tool_call_end|><|tool_calls_section_end|>";
    const display = stripToolCallsSection(raw);
    const diagnostics = diagnoseModelOutputPostprocess(raw, display, validateSummary);
    expect(display).not.toContain("private-tool-arguments");
    expect(diagnostics).toMatchObject({
      contentChanged: true, whitespaceOnlyChange: false, rawSchemaValid: false, displaySchemaValid: false,
      toolSectionBegins: 1, toolSectionEnds: 1, toolCallBegins: 1, toolCallEnds: 1,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/private-response-value|private-tool-arguments/);
  });

  it("reports when display processing changes a schema-valid value without accepting it", () => {
    const raw = JSON.stringify({ summary: "complete", detail: "<|tool_calls_section_begin|>private-detail<|tool_calls_section_end|>" });
    const validateExact = (text: string) => ({ ok: text === raw });
    const display = stripToolCallsSection(raw);
    expect(diagnoseModelOutputPostprocess(raw, display, validateExact)).toMatchObject({
      contentChanged: true, whitespaceOnlyChange: false, rawJsonKind: "object", displayJsonKind: "non_json",
      rawSchemaValid: true, displaySchemaValid: false, toolSectionBegins: 1, toolSectionEnds: 1,
    });
  });

  it("distinguishes truncated protocol text and ordinary invalid JSON", () => {
    const raw = '{"summary":"private-value"<|tool_call_begin|>private-arguments';
    expect(diagnoseModelOutputPostprocess(raw, stripToolCallsSection(raw), validateSummary)).toMatchObject({
      contentChanged: false, rawJsonKind: "non_json", rawSchemaValid: false, displaySchemaValid: false,
      toolCallBegins: 1, toolCallEnds: 0,
    });
  });

  it.each([
    ["", "empty"], ["[]", "array"], ["null", "primitive"], ["true", "primitive"],
    ['"private-value"', "primitive"], ['{"summary":"complete"}', "object"],
  ])("classifies %s without logging JSON keys or values", (raw, kind) => {
    const result = diagnoseModelOutputPostprocess(raw, stripToolCallsSection(raw), validateSummary);
    expect(result).toMatchObject({ rawJsonKind: kind, displayJsonKind: kind, contentChanged: false });
    expect(JSON.stringify(result)).not.toMatch(/private-value|complete|summary/);
  });
});
