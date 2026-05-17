import type { GoalCapabilityExecutionMode, GoalCapabilityGovernanceMode } from "./goals/types.js";

export type CommanderRuntimeMode = "on" | "off" | "auto";

export type CommanderRuntimeSwitches = {
  commanderMode: CommanderRuntimeMode;
  defaultCommanderAgentId?: string;
  defaultGoalExecutionMode?: GoalCapabilityExecutionMode;
  defaultGoalGovernanceMode?: GoalCapabilityGovernanceMode;
  autoReworkEnabled: boolean;
};

export type CommanderEnvReader = (name: string) => string | undefined;

function normalizeCommanderMode(raw: string | undefined): CommanderRuntimeMode {
  const value = raw?.trim().toLowerCase();
  return value === "on" || value === "off" ? value : "auto";
}

function normalizeGoalExecutionMode(raw: string | undefined): GoalCapabilityExecutionMode | undefined {
  const value = raw?.trim();
  switch (value) {
    case "single_agent":
    case "multi_agent":
    case "multi_agent_parallel":
    case "multi_agent_sequential":
    case "auto":
      return value;
    default:
      return undefined;
  }
}

function normalizeGoalGovernanceMode(raw: string | undefined): GoalCapabilityGovernanceMode | undefined {
  const value = raw?.trim();
  switch (value) {
    case "direct":
    case "commander":
    case "auto":
      return value;
    default:
      return undefined;
  }
}

export function resolveCommanderRuntimeSwitches(readEnv: CommanderEnvReader): CommanderRuntimeSwitches {
  return {
    commanderMode: normalizeCommanderMode(readEnv("BELLDANDY_COMMANDER_MODE")),
    defaultCommanderAgentId: readEnv("BELLDANDY_COMMANDER_AGENT_ID")?.trim() || undefined,
    defaultGoalExecutionMode: normalizeGoalExecutionMode(readEnv("BELLDANDY_GOAL_EXECUTION_MODE")),
    defaultGoalGovernanceMode: normalizeGoalGovernanceMode(readEnv("BELLDANDY_GOAL_GOVERNANCE_MODE")),
    autoReworkEnabled: readEnv("BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED") === "true",
  };
}
