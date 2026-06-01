import type { MCPManager } from "@belldandy/mcp";
import type { MCPRuntimeCapabilities } from "@belldandy/skills";
import { formatMcpToolError } from "./error-format.js";

function formatMcpBridgeResultContent(result: Awaited<ReturnType<MCPManager["callTool"]>>): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  if (!result.content || result.content.length === 0) {
    return null;
  }

  if (
    result.content.length === 1
    && result.content[0].type === "text"
    && result.content[0].text
  ) {
    try {
      return JSON.parse(result.content[0].text);
    } catch {
      return result.content[0].text;
    }
  }

  return result.content;
}

export function createBridgeMcpCapabilities(
  getManager: () => MCPManager | null,
): MCPRuntimeCapabilities {
  return {
    async callTool(request: Parameters<MCPRuntimeCapabilities["callTool"]>[0]) {
      const manager = getManager();
      if (!manager) {
        throw new Error("MCP runtime 未初始化。");
      }

      const tool = manager.getAllTools().find((item) =>
        item.serverId === request.serverId && item.name === request.toolName);
      if (!tool) {
        throw new Error(`MCP 工具不存在: ${request.serverId}/${request.toolName}`);
      }

      const result = await manager.callTool({
        name: tool.bridgedName,
        arguments: request.arguments,
      });

      if (result.isError) {
        throw new Error(
          formatMcpToolError(
            result,
            `MCP 工具调用失败: ${request.serverId}/${request.toolName}`
          )
        );
      }

      return formatMcpBridgeResultContent(result);
    },
    getDiagnostics() {
      const manager = getManager();
      if (!manager) {
        return null;
      }

      const diagnostics = manager.getDiagnostics();
      const tools = manager.getAllTools().map((tool) => ({
        serverId: tool.serverId,
        toolName: tool.name,
        bridgedName: tool.bridgedName,
      }));

      return {
        initialized: diagnostics.initialized,
        toolCount: diagnostics.toolCount,
        serverCount: diagnostics.serverCount,
        connectedCount: diagnostics.connectedCount,
        servers: diagnostics.servers.map((server) => ({
          id: server.id,
          name: server.name,
          status: server.status,
          error: server.error,
          toolCount: server.toolCount,
          resourceCount: server.resourceCount,
        })),
        tools,
      };
    },
  };
}
