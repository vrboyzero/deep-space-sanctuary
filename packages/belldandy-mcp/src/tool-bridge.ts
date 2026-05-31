/**
 * MCP 工具桥接器
 * 
 * 将 MCP 服务器提供的工具桥接到 Belldandy 的工具系统中，
 * 使 Agent 能够调用外部 MCP 工具。
 */

import type {
  MCPToolInfo,
  MCPToolCallResult,
  BelldandyToolDefinition,
} from "./types.js";
import { mcpLog } from "./logger-adapter.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 工具调用函数类型
 */
type ToolCallFn = (
  toolName: string,
  serverId: string,
  args: Record<string, unknown>
) => Promise<MCPToolCallResult>;

interface RuntimeDescribeSessionCacheEntry {
  cacheKey: string;
  result: MCPToolCallResult;
}

function isStarweaverRuntimeDescribeTool(tool: MCPToolInfo): boolean {
  return (
    tool.serverId.startsWith("starweaver") &&
    tool.name === "starweaver_runtime_describe"
  );
}

function toRuntimeScopeCacheKey(args: Record<string, unknown>): string {
  return [
    typeof args.actorId === "string" ? args.actorId : "",
    typeof args.sessionId === "string" ? args.sessionId : "",
    typeof args.gameId === "string" ? args.gameId : ""
  ].join("::");
}

// ============================================================================
// 工具桥接器类
// ============================================================================

/**
 * MCP 工具桥接器
 * 
 * 负责将 MCP 工具转换为 Belldandy 可用的工具定义。
 */
export class MCPToolBridge {
  /** 工具调用函数 */
  private callToolFn: ToolCallFn;
  
  /** 是否使用工具前缀 */
  private usePrefix: boolean;
  
  /** 已桥接的工具映射: bridgedName -> MCPToolInfo */
  private bridgedTools: Map<string, MCPToolInfo> = new Map();
  private runtimeDescribeSessionCache: Map<string, RuntimeDescribeSessionCacheEntry> = new Map();

  constructor(callToolFn: ToolCallFn, usePrefix: boolean = true) {
    this.callToolFn = callToolFn;
    this.usePrefix = usePrefix;
  }

  // ==========================================================================
  // 公共方法
  // ==========================================================================

  /**
   * 注册 MCP 工具
   * 
   * @param tools MCP 工具列表
   */
  registerTools(tools: MCPToolInfo[]): void {
    for (const tool of tools) {
      this.bridgedTools.set(tool.bridgedName, tool);
    }
    mcpLog("MCPToolBridge", `注册了 ${tools.length} 个工具`);
  }

  /**
   * 注销服务器的所有工具
   * 
   * @param serverId 服务器 ID
   */
  unregisterServerTools(serverId: string): void {
    const toRemove: string[] = [];
    
    for (const [name, tool] of this.bridgedTools) {
      if (tool.serverId === serverId) {
        toRemove.push(name);
      }
    }
    
    for (const name of toRemove) {
      this.bridgedTools.delete(name);
    }
    this.runtimeDescribeSessionCache.delete(serverId);
    
    mcpLog("MCPToolBridge", `注销了服务器 ${serverId} 的 ${toRemove.length} 个工具`);
  }

  /**
   * 注销所有工具
   */
  unregisterAllTools(): void {
    const count = this.bridgedTools.size;
    this.bridgedTools.clear();
    this.runtimeDescribeSessionCache.clear();
    mcpLog("MCPToolBridge", `注销了全部 ${count} 个工具`);
  }

  /**
   * 获取已桥接的工具数量
   */
  getToolCount(): number {
    return this.bridgedTools.size;
  }

  /**
   * 检查工具是否存在
   * 
   * @param bridgedName 桥接后的工具名称
   */
  hasTool(bridgedName: string): boolean {
    return this.bridgedTools.has(bridgedName);
  }

  /**
   * 获取工具信息
   * 
   * @param bridgedName 桥接后的工具名称
   */
  getToolInfo(bridgedName: string): MCPToolInfo | undefined {
    return this.bridgedTools.get(bridgedName);
  }

  /**
   * 获取所有已桥接的工具信息
   */
  getAllTools(): MCPToolInfo[] {
    return Array.from(this.bridgedTools.values());
  }

  /**
   * 将所有已桥接的工具转换为 Belldandy 工具定义
   * 
   * @returns Belldandy 工具定义数组
   */
  toBelldandyTools(): BelldandyToolDefinition[] {
    return Array.from(this.bridgedTools.values()).map((tool) =>
      this.createBelldandyTool(tool)
    );
  }

  /**
   * 获取指定服务器的工具定义
   * 
   * @param serverId 服务器 ID
   * @returns Belldandy 工具定义数组
   */
  getServerTools(serverId: string): BelldandyToolDefinition[] {
    return Array.from(this.bridgedTools.values())
      .filter((tool) => tool.serverId === serverId)
      .map((tool) => this.createBelldandyTool(tool));
  }

  /**
   * 调用工具
   * 
   * @param bridgedName 桥接后的工具名称
   * @param args 工具参数
   * @returns 工具调用结果
   */
  async callTool(
    bridgedName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    const tool = this.bridgedTools.get(bridgedName);
    
    if (!tool) {
      return {
        success: false,
        error: `工具 "${bridgedName}" 不存在`,
        isError: true,
      };
    }

    if (isStarweaverRuntimeDescribeTool(tool)) {
      const cacheKey = toRuntimeScopeCacheKey(args);
      const cached = this.runtimeDescribeSessionCache.get(tool.serverId);
      if (cached && cached.cacheKey === cacheKey) {
        return cached.result;
      }

      const result = await this.callToolFn(tool.name, tool.serverId, args);
      if (!result.isError && result.success) {
        this.runtimeDescribeSessionCache.set(tool.serverId, {
          cacheKey,
          result,
        });
      } else {
        this.runtimeDescribeSessionCache.delete(tool.serverId);
      }
      return result;
    }

    return this.callToolFn(tool.name, tool.serverId, args);
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  /**
   * 创建 Belldandy 工具定义
   */
  private createBelldandyTool(tool: MCPToolInfo): BelldandyToolDefinition {
    // 构建输入 Schema
    const inputSchema = this.normalizeInputSchema(tool.inputSchema);

    // 构建描述（包含来源信息）
    const description = this.buildDescription(tool);

    return {
      name: tool.bridgedName,
      description,
      inputSchema,
      execute: async (params: Record<string, unknown>) => {
        const result = await this.callTool(tool.bridgedName, params);
        
        if (result.isError) {
          throw new Error(result.error || "工具调用失败");
        }
        
        // 返回工具结果
        return this.formatResult(result);
      },
      metadata: {
        mcpServer: tool.serverId,
        originalName: tool.name,
        category: "mcp",
      },
    };
  }

  /**
   * 规范化输入 Schema
   */
  private normalizeInputSchema(
    schema: Record<string, unknown>
  ): BelldandyToolDefinition["inputSchema"] {
    // 确保 schema 是对象类型
    if (schema.type !== "object") {
      return {
        type: "object",
        properties: {},
        required: [],
      };
    }

    return {
      type: "object",
      properties: (schema.properties as Record<string, unknown>) || {},
      required: (schema.required as string[]) || [],
    };
  }

  /**
   * 构建工具描述
   */
  private buildDescription(tool: MCPToolInfo): string {
    const parts: string[] = [];

    // 添加原始描述
    if (tool.description) {
      parts.push(tool.description);
    }

    // 添加来源信息
    parts.push(`[来自 MCP 服务器: ${tool.serverId}]`);

    return parts.join("\n");
  }

  /**
   * 格式化工具结果
   */
  private formatResult(result: MCPToolCallResult): unknown {
    if (!result.content || result.content.length === 0) {
      return null;
    }

    // 如果只有一个文本结果，直接返回文本
    if (
      result.content.length === 1 &&
      result.content[0].type === "text" &&
      result.content[0].text
    ) {
      // 尝试解析 JSON
      try {
        return JSON.parse(result.content[0].text);
      } catch {
        return result.content[0].text;
      }
    }

    // 多个结果或非文本结果，返回结构化数据
    return result.content.map((item) => {
      switch (item.type) {
        case "text":
          return {
            type: "text",
            content: item.text,
            truncated: item.truncated,
            originalLength: item.originalLength,
            note: item.note,
          };
        case "image":
          return {
            type: "image",
            data: item.data,
            mimeType: item.mimeType,
            truncated: item.truncated,
            originalLength: item.originalLength,
            note: item.note,
          };
        case "resource":
          return {
            type: "resource",
            uri: item.uri,
            text: item.text,
            mimeType: item.mimeType,
            truncated: item.truncated,
            originalLength: item.originalLength,
            note: item.note,
          };
        default:
          return item;
      }
    });
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成工具调用的 OpenAI Function 格式
 * 
 * 用于将 MCP 工具转换为 OpenAI API 的 function calling 格式。
 * 
 * @param tool MCP 工具信息
 * @returns OpenAI Function 定义
 */
export function toOpenAIFunction(tool: MCPToolInfo): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} {
  return {
    type: "function",
    function: {
      name: tool.bridgedName,
      description: tool.description || `MCP 工具: ${tool.name}`,
      parameters: tool.inputSchema,
    },
  };
}

/**
 * 生成工具调用的 Anthropic Tool 格式
 * 
 * 用于将 MCP 工具转换为 Anthropic API 的 tool use 格式。
 * 
 * @param tool MCP 工具信息
 * @returns Anthropic Tool 定义
 */
export function toAnthropicTool(tool: MCPToolInfo): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: tool.bridgedName,
    description: tool.description || `MCP 工具: ${tool.name}`,
    input_schema: tool.inputSchema,
  };
}

/**
 * 批量转换工具为 OpenAI 格式
 */
export function toOpenAIFunctions(
  tools: MCPToolInfo[]
): ReturnType<typeof toOpenAIFunction>[] {
  return tools.map(toOpenAIFunction);
}

/**
 * 批量转换工具为 Anthropic 格式
 */
export function toAnthropicTools(
  tools: MCPToolInfo[]
): ReturnType<typeof toAnthropicTool>[] {
  return tools.map(toAnthropicTool);
}
