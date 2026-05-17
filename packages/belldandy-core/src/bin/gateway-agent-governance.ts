import type { AgentProfile } from "@belldandy/agent";
import type { ToolContract, ToolContractFamily } from "@belldandy/skills";

const COMMANDER_HARD_BLOCK_FAMILIES = new Set<ToolContractFamily>([
  "workspace-write",
  "patch",
  "command-exec",
]);

export function isAgentToolAllowed(input: {
  agentId: string;
  toolName: string;
  contract?: ToolContract;
  profile?: Pick<AgentProfile, "toolWhitelist">;
}): boolean {
  if (input.agentId === "commander" && input.contract && COMMANDER_HARD_BLOCK_FAMILIES.has(input.contract.family)) {
    return false;
  }

  const whitelist = input.profile?.toolWhitelist?.filter((item) => typeof item === "string" && item.trim());
  if (!whitelist || whitelist.length === 0) {
    return true;
  }

  return whitelist.includes(input.toolName);
}
