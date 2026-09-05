const TOOL_SECTION_BEGIN = "<|tool_calls_section_begin|>";
const TOOL_SECTION_END = "<|tool_calls_section_end|>";
const TOOL_CALL_BEGIN = "<|tool_call_begin|>";
const TOOL_CALL_END = "<|tool_call_end|>";
const FINISH_REASONS = new Set([
  "stop", "length", "tool_calls", "function_call", "content_filter",
  "end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal",
]);

export function classifyModelFinishReason(value: unknown): string {
  return typeof value === "string" && FINISH_REASONS.has(value) ? value : "unknown";
}

export function stripToolCallsSection(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, "\n\n\uFF08\u6B63\u5728\u6267\u884C\u64CD\u4F5C\uFF09\n\n")
    .replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function diagnoseModelOutputPostprocess(
  rawText: string,
  displayText: string,
  validateOutput: (text: string) => { ok: boolean },
) {
  // Only fixed categories, counts and booleans may leave this diagnostic boundary.
  return {
    rawContentLength: rawText.length,
    rawTrimmedLength: rawText.trim().length,
    displayContentLength: displayText.length,
    contentChanged: rawText !== displayText,
    whitespaceOnlyChange: rawText !== displayText && rawText.replace(/\n{3,}/g, "\n\n").trim() === displayText,
    rawJsonKind: classifyJson(rawText),
    displayJsonKind: classifyJson(displayText),
    rawSchemaValid: validateOutput(rawText).ok,
    displaySchemaValid: validateOutput(displayText).ok,
    toolSectionBegins: rawText.split(TOOL_SECTION_BEGIN).length - 1,
    toolSectionEnds: rawText.split(TOOL_SECTION_END).length - 1,
    toolCallBegins: rawText.split(TOOL_CALL_BEGIN).length - 1,
    toolCallEnds: rawText.split(TOOL_CALL_END).length - 1,
  };
}

function classifyJson(text: string): "empty" | "object" | "array" | "primitive" | "non_json" {
  if (!text.trim()) return "empty";
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value)) return "array";
    return value !== null && typeof value === "object" ? "object" : "primitive";
  } catch {
    return "non_json";
  }
}
