export const DEFAULT_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT = 500;
export const MAX_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT = 2_048;

export function resolveToolResultEventOutputCharLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT
    ? parsed
    : DEFAULT_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT;
}

export function projectToolResultEventOutput(output: unknown, limit: unknown): unknown {
  if (typeof output !== "string") return output;
  const resolvedLimit = resolveToolResultEventOutputCharLimit(limit);
  return output.length > resolvedLimit ? `${output.slice(0, resolvedLimit)}\u2026` : output;
}
