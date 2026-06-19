import type { ModelProfile } from "./failover-client.js";

const OPENAI_REQUEST_BODY_EXTRA_RESERVED_KEYS = new Set([
  "model",
  "messages",
  "input",
  "stream",
  "max_tokens",
  "max_output_tokens",
]);

export function applyOpenAICompatibleReasoningConfig(
  payload: Record<string, unknown>,
  profile: Pick<ModelProfile, "thinking" | "reasoningEffort" | "options" | "requestBodyExtras">,
): void {
  if (profile.thinking) {
    payload.thinking = profile.thinking;
  }
  if (profile.reasoningEffort) {
    payload.reasoning_effort = profile.reasoningEffort;
  }
  if (profile.options) {
    payload.options = profile.options;
  }
  if (profile.requestBodyExtras) {
    mergeOpenAIRequestBodyExtras(payload, profile.requestBodyExtras);
  }
}

export function mergeOpenAIRequestBodyExtras(
  payload: Record<string, unknown>,
  extras: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(extras)) {
    if (OPENAI_REQUEST_BODY_EXTRA_RESERVED_KEYS.has(key)) {
      continue;
    }
    payload[key] = value;
  }
}
