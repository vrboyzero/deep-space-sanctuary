export const TOOL_AGENT_STREAMING_ENV_KEY = "BELLDANDY_TOOL_AGENT_STREAMING_ENABLED";

export function resolveToolAgentStreamingEnabled(value: string | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}
