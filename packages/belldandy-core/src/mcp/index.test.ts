import { afterEach, describe, expect, it, vi } from "vitest";

import { getMCPManagerIfInitialized, getMCPTools, initMCPIntegration, shutdownMCPIntegration } from "./index.js";

vi.mock("@belldandy/mcp", () => {
  const manager = {
    getAllTools: vi.fn(),
    callTool: vi.fn(),
    getDiagnostics: vi.fn(() => ({
      initialized: true,
      toolCount: 0,
      serverCount: 1,
      connectedCount: 1,
      summary: {
        recentErrorServers: 0,
        recoveryAttemptedServers: 0,
        recoverySucceededServers: 0,
        persistedResultServers: 0,
        truncatedResultServers: 0,
      },
      servers: [],
    })),
  };

  return {
    setMCPLogger: vi.fn(),
    initializeMCP: vi.fn(async () => manager),
    shutdownMCP: vi.fn(async () => {}),
    getMCPManager: vi.fn(() => manager),
    __mockManager: manager,
  };
});

describe("mcp integration", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await shutdownMCPIntegration();
  });

  it("prefers structuredContent when converting MCP tools into ToolExecutor tools", async () => {
    const mcpModule = await import("@belldandy/mcp");
    const manager = (mcpModule as typeof mcpModule & {
      __mockManager: {
        getAllTools: ReturnType<typeof vi.fn>;
        callTool: ReturnType<typeof vi.fn>;
      };
    }).__mockManager;

    manager.getAllTools.mockReturnValue([
      {
        name: "agent_wake_notifications",
        bridgedName: "mcp_starweaver_central_agent_wake_notifications",
        description: "wake notifications",
        inputSchema: { type: "object", properties: {} },
        serverId: "starweaver-central",
      },
    ]);
    manager.callTool.mockResolvedValue({
      success: true,
      isError: false,
      structuredContent: {
        items: [
          {
            signalKind: "command_available",
            recommendedPeek: "command_peek",
            actorId: "actor.player",
          },
        ],
      },
      content: [],
    });

    await initMCPIntegration();
    expect(getMCPManagerIfInitialized()).toBeTruthy();

    const [tool] = getMCPTools();
    const abortController = new AbortController();
    const result = await tool!.execute({}, { abortSignal: abortController.signal } as any);
    const parsed = JSON.parse(result.output);

    expect(parsed).toEqual({
      items: [
        {
          signalKind: "command_available",
          recommendedPeek: "command_peek",
          actorId: "actor.player",
        },
      ],
    });
    expect(manager.callTool).toHaveBeenCalledWith({
      name: "mcp_starweaver_central_agent_wake_notifications",
      arguments: {},
    }, {
      signal: abortController.signal,
    });
  });
});
