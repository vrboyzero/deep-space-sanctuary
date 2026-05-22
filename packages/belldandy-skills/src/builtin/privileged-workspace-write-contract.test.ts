import { describe, expect, it } from "vitest";

import { resolvePrivilegedWorkspaceWriteChannels } from "./privileged-workspace-write-contract.js";

describe("resolvePrivilegedWorkspaceWriteChannels", () => {
  it("defaults to gateway and cli when env is unset", () => {
    expect(resolvePrivilegedWorkspaceWriteChannels({} as NodeJS.ProcessEnv)).toEqual(["gateway", "cli"]);
  });

  it("accepts gateway, cli, and web from env and deduplicates values", () => {
    expect(resolvePrivilegedWorkspaceWriteChannels({
      BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS: "gateway, cli, web, gateway",
    } as NodeJS.ProcessEnv)).toEqual(["gateway", "cli", "web"]);
  });

  it("falls back to gateway and cli when env contains unsupported values", () => {
    expect(resolvePrivilegedWorkspaceWriteChannels({
      BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS: "browser-extension, browser",
    } as NodeJS.ProcessEnv)).toEqual(["gateway", "cli"]);
  });
});
