import type { ModelProfile } from "./failover-client.js";

export function applyOpenAICompatibleToolChoice(input: {
  payload: Record<string, unknown>;
  profile: Pick<ModelProfile, "id" | "baseUrl" | "model">;
  toolChoice: "auto" | "required";
}): void {
  input.payload.tool_choice = input.toolChoice;
  if (input.toolChoice === "auto") {
    return;
  }

  // DeepSeek thinking mode rejects non-auto tool_choice. Recovery requests trade
  // hidden reasoning for the stronger guarantee that a mutation Tool runs.
  if (isDeepSeekProfile(input.profile)) {
    input.payload.thinking = { type: "disabled" };
  }
}

function isDeepSeekProfile(profile: Pick<ModelProfile, "id" | "baseUrl" | "model">): boolean {
  return [profile.id, profile.baseUrl, profile.model]
    .some((value) => value?.toLowerCase().includes("deepseek"));
}
