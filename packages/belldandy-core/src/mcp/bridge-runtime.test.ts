import { describe, expect, it, vi } from "vitest";
import type { MCPManager } from "@belldandy/mcp";

import { createBridgeMcpCapabilities } from "./bridge-runtime.js";

describe("createBridgeMcpCapabilities", () => {
  it("forwards the runtime AbortSignal to the MCP manager", async () => {
    const manager = {
      getAllTools: vi.fn(() => [{
        serverId: "bridge-server",
        name: "inspect",
        bridgedName: "mcp_bridge_server_inspect",
      }]),
      callTool: vi.fn().mockResolvedValue({
        success: true,
        isError: false,
        content: [{ type: "text", text: "ok" }],
      }),
    };
    const abortController = new AbortController();
    const capabilities = createBridgeMcpCapabilities(
      () => manager as unknown as MCPManager,
    );

    await expect(capabilities.callTool({
      serverId: "bridge-server",
      toolName: "inspect",
      arguments: { path: "README.md" },
      signal: abortController.signal,
    })).resolves.toBe("ok");

    expect(manager.callTool).toHaveBeenCalledWith({
      name: "mcp_bridge_server_inspect",
      arguments: { path: "README.md" },
    }, {
      signal: abortController.signal,
    });
  });
});
