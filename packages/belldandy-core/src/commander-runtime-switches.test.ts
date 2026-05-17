import { describe, expect, it } from "vitest";

import { resolveCommanderRuntimeSwitches } from "./commander-runtime-switches.js";

function createEnv(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

describe("commander runtime switches", () => {
  it("reads runtime governance defaults and auto rework switch from env", () => {
    const switches = resolveCommanderRuntimeSwitches(createEnv({
      BELLDANDY_COMMANDER_MODE: "on",
      BELLDANDY_COMMANDER_AGENT_ID: "commander",
      BELLDANDY_GOAL_EXECUTION_MODE: "multi_agent_parallel",
      BELLDANDY_GOAL_GOVERNANCE_MODE: "auto",
      BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED: "true",
    }));

    expect(switches).toEqual({
      commanderMode: "on",
      defaultCommanderAgentId: "commander",
      defaultGoalExecutionMode: "multi_agent_parallel",
      defaultGoalGovernanceMode: "auto",
      autoReworkEnabled: true,
    });
  });

  it("falls back to safe defaults when env values are missing or invalid", () => {
    const switches = resolveCommanderRuntimeSwitches(createEnv({
      BELLDANDY_COMMANDER_MODE: "invalid",
      BELLDANDY_COMMANDER_AGENT_ID: "   ",
      BELLDANDY_GOAL_EXECUTION_MODE: "parallel",
      BELLDANDY_GOAL_GOVERNANCE_MODE: "manual",
      BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED: "false",
    }));

    expect(switches).toEqual({
      commanderMode: "auto",
      defaultCommanderAgentId: undefined,
      defaultGoalExecutionMode: undefined,
      defaultGoalGovernanceMode: undefined,
      autoReworkEnabled: false,
    });
  });
});
