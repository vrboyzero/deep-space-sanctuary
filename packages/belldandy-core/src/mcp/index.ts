/**
 * MCP 集成模块
 * 
 * 提供 MCP 管理器的初始化和工具注册功能，
 * 将 MCP 工具桥接到 Belldandy 的工具系统中。
 */

import {
  setMCPLogger,
  initializeMCP,
  shutdownMCP,
  getMCPManager,
  type MCPManager,
  type MCPServerRuntimeDiagnostics,
  type MCPToolInfo,
} from "@belldandy/mcp";
import { withToolContract } from "@belldandy/skills";
import type { ToolExecutor, Tool, ToolContext, ToolCallResult } from "@belldandy/skills";
import type { JsonObject } from "@belldandy/protocol";
import { formatMcpToolError } from "./error-format.js";

// ============================================================================
// MCP 集成状态
// ============================================================================

/** MCP 集成状态 */
interface MCPIntegrationState {
  /** 是否已初始化 */
  initialized: boolean;
  /** 管理器实例 */
  manager: MCPManager | null;
  /** 注册的工具数量 */
  toolCount: number;
}

/** 全局集成状态 */
const state: MCPIntegrationState = {
  initialized: false,
  manager: null,
  toolCount: 0,
};

// ============================================================================
// MCP 工具转换
// ============================================================================

/**
 * 将 MCP 工具转换为 Belldandy Tool 接口
 * 
 * @param mcpTool MCP 工具信息
 * @param callTool 工具调用函数
 * @returns Belldandy Tool 实现
 */
function mcpToolToTool(
  mcpTool: MCPToolInfo,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
): Tool {
  const shortDescription = String(mcpTool.description ?? "").split(/\r?\n/)[0]?.trim()
    || `MCP tool ${mcpTool.name}`;
  return withToolContract({
    definition: {
      name: mcpTool.bridgedName,
      description: mcpTool.description 
        ? `${mcpTool.description}\n[来自 MCP 服务器: ${mcpTool.serverId}]`
        : `MCP 工具: ${mcpTool.name} [来自: ${mcpTool.serverId}]`,
      parameters: mcpTool.inputSchema as Tool["definition"]["parameters"],
      loadingMode: "deferred",
      shortDescription,
      keywords: ["mcp", mcpTool.serverId, mcpTool.name, mcpTool.bridgedName],
      tags: ["mcp", `mcp:${mcpTool.serverId}`],
    },
    execute: async (args: JsonObject, context: ToolContext): Promise<ToolCallResult> => {
      const start = Date.now();
      try {
        const result = await callTool(mcpTool.bridgedName, args as Record<string, unknown>);
        return {
          id: "",  // 由 ToolExecutor 设置
          name: mcpTool.bridgedName,
          success: true,
          output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          id: "",
          name: mcpTool.bridgedName,
          success: false,
          output: "",
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        };
      }
    },
  }, {
    // MCP schemas do not describe side effects. Keep their default contract conservative
    // until a later policy layer can map a server-specific capability declaration.
    family: "other",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "high",
    channels: ["gateway"],
    safeScopes: ["remote-safe"],
    activityDescription: `Invoke external MCP tool ${mcpTool.serverId}/${mcpTool.name}`,
    resultSchema: { kind: "text", description: "External MCP tool response." },
    outputPersistencePolicy: "external-state",
  });
}

// ============================================================================
// MCP 集成函数
// ============================================================================

/**
 * 初始化 MCP 集成
 *
 * @param logger 可选，统一 Logger。传入后 MCP 模块的日志将写入文件
 * @returns MCP 管理器实例
 */
export async function initMCPIntegration(logger?: {
  debug?: (m: string, msg: string, d?: unknown) => void;
  info: (m: string, msg: string, d?: unknown) => void;
  warn: (m: string, msg: string, d?: unknown) => void;
  error: (m: string, msg: string, d?: unknown) => void;
}): Promise<MCPManager> {
  if (logger) {
    setMCPLogger(logger);
  }

  if (state.initialized && state.manager) {
    logger ? logger.info("mcp", "已经初始化，返回现有实例") : console.log("[MCP Integration] 已经初始化，返回现有实例");
    return state.manager;
  }

  logger ? logger.info("mcp", "正在初始化...") : console.log("[MCP Integration] 正在初始化...");

  try {
    const manager = await initializeMCP();
    state.manager = manager;
    state.initialized = true;
    state.toolCount = manager.getAllTools().length;

    logger ? logger.info("mcp", `初始化完成，共 ${state.toolCount} 个 MCP 工具可用`) : console.log(`[MCP Integration] 初始化完成，共 ${state.toolCount} 个 MCP 工具可用`);
    return manager;
  } catch (error) {
    logger ? logger.error("mcp", "初始化失败", error) : console.error("[MCP Integration] 初始化失败:", error);
    throw error;
  }
}

/**
 * 关闭 MCP 集成
 */
export async function shutdownMCPIntegration(): Promise<void> {
  if (!state.initialized) {
    return;
  }

  // 使用全局 logger（若已在 init 时设置）
  console.log("[MCP Integration] 正在关闭...");

  await shutdownMCP();

  state.manager = null;
  state.initialized = false;
  state.toolCount = 0;

  console.log("[MCP Integration] 已关闭");
}

/**
 * 获取 MCP 管理器（如果已初始化）
 */
export function getMCPManagerIfInitialized(): MCPManager | null {
  return state.manager;
}

/**
 * 检查 MCP 是否已初始化
 */
export function isMCPInitialized(): boolean {
  return state.initialized;
}

/**
 * 获取所有 MCP 工具
 * 
 * 将 MCP 工具转换为可以注册到 ToolExecutor 的 Tool 实例。
 * 
 * @returns Tool 实例数组
 */
export function getMCPTools(): Tool[] {
  if (!state.manager) {
    return [];
  }

  const mcpTools = state.manager.getAllTools();
  
  return mcpTools.map((tool: MCPToolInfo) =>
    mcpToolToTool(tool, async (name: string, args: Record<string, unknown>) => {
      const result = await state.manager!.callTool({
        name,
        arguments: args,
      });

      if (result.isError) {
        throw new Error(
          formatMcpToolError(result, `MCP 工具调用失败: ${name}`)
        );
      }

      if (result.structuredContent !== undefined) {
        return result.structuredContent;
      }

      // 提取结果内容
      if (!result.content || result.content.length === 0) {
        return null;
      }

      // 单个文本结果
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

      // 多个结果或复杂类型
      return result.content;
    })
  );
}

/**
 * 将 MCP 工具注册到 ToolExecutor
 * 
 * @param executor 工具执行器
 * @returns 注册的工具数量
 */
export function registerMCPToolsToExecutor(
  executor: ToolExecutor
): number {
  const tools = getMCPTools();
  
  if (tools.length === 0) {
    return 0;
  }

  // 注册每个工具
  for (const tool of tools) {
    executor.registerTool(tool, { origin: "mcp" });
  }
  return tools.length;
}

/**
 * 获取 MCP 诊断信息
 */
export function getMCPDiagnostics(): {
  initialized: boolean;
  toolCount: number;
  serverCount: number;
  connectedCount: number;
  summary: {
    recentErrorServers: number;
    recoveryAttemptedServers: number;
    recoverySucceededServers: number;
    persistedResultServers: number;
    truncatedResultServers: number;
  };
  servers: Array<{
    id: string;
    name: string;
    status: string;
    error?: string;
    toolCount: number;
    resourceCount: number;
    diagnostics?: MCPServerRuntimeDiagnostics;
  }>;
} | null {
  if (!state.manager) {
    return null;
  }

  const diag = state.manager.getDiagnostics();
  return {
    initialized: diag.initialized,
    toolCount: diag.toolCount,
    serverCount: diag.serverCount,
    connectedCount: diag.connectedCount,
    summary: diag.summary,
    servers: diag.servers.map((s: {
      id: string;
      name: string;
      status: string;
      error?: string;
      toolCount: number;
      resourceCount: number;
      diagnostics?: MCPServerRuntimeDiagnostics;
    }) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      error: s.error,
      toolCount: s.toolCount,
      resourceCount: s.resourceCount,
      diagnostics: s.diagnostics,
    })),
  };
}

/**
 * 打印 MCP 状态
 */
export function printMCPStatus(logger?: { info: (m: string, msg: string) => void }): void {
  const diag = getMCPDiagnostics();

  if (!diag) {
    (logger ? logger.info("mcp", "未初始化") : console.log("[MCP] 未初始化"));
    return;
  }

  const log = (msg: string) => (logger ? logger.info("mcp", msg) : console.log(`[MCP] ${msg}`));
  log(`状态: ${diag.initialized ? "已初始化" : "未初始化"}`);
  log(`服务器: ${diag.connectedCount}/${diag.serverCount} 已连接`);
  log(`工具: ${diag.toolCount} 个可用`);
  if (diag.summary.recoveryAttemptedServers > 0 || diag.summary.persistedResultServers > 0) {
    log(`摘要: recovery=${diag.summary.recoverySucceededServers}/${diag.summary.recoveryAttemptedServers}, persisted=${diag.summary.persistedResultServers}, truncated=${diag.summary.truncatedResultServers}`);
  }
  if (diag.servers.length > 0) {
    for (const server of diag.servers) {
      const failureSuffix = server.diagnostics?.lastErrorMessage
        ? `, lastError=${server.diagnostics.lastErrorKind ?? "unknown"}:${server.diagnostics.lastErrorMessage}`
        : "";
      const resultSuffix = server.diagnostics?.lastResult
        ? `, lastResult=${server.diagnostics.lastResult.source}:${server.diagnostics.lastResult.strategy}`
        : "";
      log(`  - ${server.name} (${server.id}): ${server.status}, ${server.toolCount} 工具, ${server.resourceCount} 资源${failureSuffix}${resultSuffix}`);
    }
  }
}

// ============================================================================
// 导出
// ============================================================================

export type { MCPManager };
export { createBridgeMcpCapabilities } from "./bridge-runtime.js";
