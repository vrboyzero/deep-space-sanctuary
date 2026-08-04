import type { AgentPromptDelta } from "./prompt-snapshot.js";

export const BARE_AGENT_AUTOMATION_PROFILE = "bare" as const;

export function isBareAgentAutomationProfile(value: unknown): value is typeof BARE_AGENT_AUTOMATION_PROFILE {
  return value === BARE_AGENT_AUTOMATION_PROFILE;
}

export function selectAgentAutomationPromptDeltas(
  automationProfile: unknown,
  deltas: AgentPromptDelta[],
): AgentPromptDelta[] {
  if (!isBareAgentAutomationProfile(automationProfile)) {
    return deltas;
  }
  return deltas.filter((delta) => delta.deltaType === "attachment" || delta.deltaType === "audio-transcript");
}
