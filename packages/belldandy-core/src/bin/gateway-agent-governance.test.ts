import { describe, expect, it } from "vitest";

import type { ToolContract } from "@belldandy/skills";

import { isAgentToolAllowed } from "./gateway-agent-governance.js";

function createContract(family: ToolContract["family"]): ToolContract {
  return {
    name: `tool-${family}`,
    family,
    isReadOnly: family === "workspace-read",
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "medium",
    channels: ["gateway"],
    safeScopes: ["local-safe"],
    activityDescription: family,
    resultSchema: {
      kind: "text",
      description: family,
    },
    outputPersistencePolicy: "conversation",
  };
}

describe("isAgentToolAllowed", () => {
  it("hard-blocks commander from write, patch, and command families even when whitelisted", () => {
    expect(isAgentToolAllowed({
      agentId: "commander",
      toolName: "file_write",
      contract: createContract("workspace-write"),
      profile: { toolWhitelist: ["file_write"] },
    })).toBe(false);

    expect(isAgentToolAllowed({
      agentId: "commander",
      toolName: "apply_patch",
      contract: createContract("patch"),
      profile: { toolWhitelist: ["apply_patch"] },
    })).toBe(false);

    expect(isAgentToolAllowed({
      agentId: "commander",
      toolName: "run_command",
      contract: createContract("command-exec"),
      profile: { toolWhitelist: ["run_command"] },
    })).toBe(false);
  });

  it("still respects whitelist rules for non-blocked families", () => {
    expect(isAgentToolAllowed({
      agentId: "commander",
      toolName: "delegate_task",
      contract: createContract("session-orchestration"),
      profile: { toolWhitelist: ["delegate_task"] },
    })).toBe(true);

    expect(isAgentToolAllowed({
      agentId: "researcher",
      toolName: "delegate_task",
      contract: createContract("session-orchestration"),
      profile: { toolWhitelist: ["memory_search"] },
    })).toBe(false);
  });
});
