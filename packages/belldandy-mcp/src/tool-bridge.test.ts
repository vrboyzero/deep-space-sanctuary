import { describe, expect, it } from "vitest";

import { MCPToolBridge } from "./tool-bridge.js";

describe("MCPToolBridge", () => {
  it("reuses successful starweaver runtime_describe results within the same runtime scope", async () => {
    let callCount = 0;
    const bridge = new MCPToolBridge(async () => {
      callCount += 1;
      return {
        success: true,
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({ callCount })
          }
        ],
        structuredContent: {
          callCount
        }
      };
    });

    bridge.registerTools([
      {
        name: "starweaver_runtime_describe",
        bridgedName: "mcp_starweaver_central_starweaver_runtime_describe",
        description: "runtime describe",
        inputSchema: { type: "object", properties: {} },
        serverId: "starweaver-central"
      }
    ]);

    const sameScope = {
      actorId: "actor.player",
      sessionId: "session-a",
      gameId: "game-a"
    };

    const first = await bridge.callTool(
      "mcp_starweaver_central_starweaver_runtime_describe",
      sameScope
    );
    const second = await bridge.callTool(
      "mcp_starweaver_central_starweaver_runtime_describe",
      sameScope
    );
    const changedScope = await bridge.callTool(
      "mcp_starweaver_central_starweaver_runtime_describe",
      {
        actorId: "actor.player",
        sessionId: "session-b",
        gameId: "game-a"
      }
    );

    expect(first.structuredContent).toEqual({ callCount: 1 });
    expect(second.structuredContent).toEqual({ callCount: 1 });
    expect(changedScope.structuredContent).toEqual({ callCount: 2 });
    expect(callCount).toBe(2);
  });
});
