import type { AgentPromptDelta } from "@belldandy/agent";
import type { CodingRunOptions } from "@belldandy/protocol";

export const BARE_AUTOMATION_PROFILE = "bare" as const;

export function isBareCodingRun(codingRun: CodingRunOptions | undefined): boolean {
  return codingRun?.automationProfile === BARE_AUTOMATION_PROFILE;
}

export function projectCodingRunAutomationContext<T>(input: {
  codingRun?: CodingRunOptions;
  history: T[];
  explicitPromptDeltas: AgentPromptDelta[];
  implicitPromptDeltas: AgentPromptDelta[];
}): {
  automationProfile?: CodingRunOptions["automationProfile"];
  history: T[];
  promptDeltas: AgentPromptDelta[];
} {
  if (isBareCodingRun(input.codingRun)) {
    return {
      automationProfile: BARE_AUTOMATION_PROFILE,
      history: [],
      promptDeltas: input.explicitPromptDeltas.map(clonePromptDelta),
    };
  }
  return {
    history: input.history,
    promptDeltas: [...input.explicitPromptDeltas, ...input.implicitPromptDeltas].map(clonePromptDelta),
  };
}

function clonePromptDelta(delta: AgentPromptDelta): AgentPromptDelta {
  return {
    ...delta,
    ...(delta.metadata ? { metadata: { ...delta.metadata } } : {}),
  };
}
