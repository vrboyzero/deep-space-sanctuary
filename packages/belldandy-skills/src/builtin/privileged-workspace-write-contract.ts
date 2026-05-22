import type { ToolContractChannel } from "../tool-contract.js";

const DEFAULT_PRIVILEGED_WORKSPACE_WRITE_CHANNELS: ToolContractChannel[] = ["gateway", "cli"];

export function resolvePrivilegedWorkspaceWriteChannels(
  env: NodeJS.ProcessEnv = process.env,
): ToolContractChannel[] {
  const raw = typeof env.BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS === "string"
    ? env.BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS.trim()
    : "";

  if (!raw) {
    return [...DEFAULT_PRIVILEGED_WORKSPACE_WRITE_CHANNELS];
  }

  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ToolContractChannel => item === "gateway" || item === "web" || item === "cli");

  if (parsed.length === 0) {
    return [...DEFAULT_PRIVILEGED_WORKSPACE_WRITE_CHANNELS];
  }

  return [...new Set(parsed)];
}
