/**
 * @belldandy/mcp - MCP (Model Context Protocol) 支持模块
 * 
 * 本模块为 Belldandy 提供 MCP 协议支持，使 Agent 能够：
 * - 连接外部 MCP 服务器
 * - 发现和调用 MCP 工具
 * - 访问 MCP 资源
 * 
 * @example
 * ```typescript
 * import { initializeMCP, getMCPManager } from "@belldandy/mcp";
 * 
 * // 初始化 MCP 管理器
 * await initializeMCP();
 * 
 * // 获取管理器实例
 * const manager = getMCPManager();
 * 
 * // 获取所有可用工具
 * const tools = manager.getAllTools();
 * 
 * // 调用工具
 * const result = await manager.callTool({
 *   name: "mcp_filesystem_read_file",
 *   arguments: { path: "/tmp/test.txt" }
 * });
 * ```
 */

// 类型导出
export type {
  // 配置类型
  MCPTransportType,
  MCPStdioConfig,
  MCPSSEConfig,
  MCPServerConfig,
  MCPConfig,
  
  // 运行时类型
  MCPServerStatus,
  MCPServerFailureKind,
  MCPServerFailureSource,
  MCPExecutionOptions,
  MCPServerRuntimeDiagnostics,
  MCPResultDiagnostics,
  MCPServerState,
  MCPToolInfo,
  MCPResourceInfo,
  MCPToolContentItem,
  MCPResourceContentItem,
  
  // 调用类型
  MCPToolCallRequest,
  MCPToolCallResult,
  MCPResourceReadRequest,
  MCPResourceReadResult,
  
  // 事件类型
  MCPEventType,
  MCPEvent,
  MCPEventListener,
  
  // 接口
  MCPManager as IMCPManager,
  BelldandyToolDefinition,
} from "./types.js";

// 类型守卫和默认值
export {
  isStdioTransport,
  isSSETransport,
  DEFAULT_MCP_CONFIG,
  DEFAULT_SERVER_CONFIG,
} from "./types.js";

// 日志适配器（供 belldandy-core 注入 logger）
export { setMCPLogger } from "./logger-adapter.js";

// 配置模块
export {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  configExists,
  addServer,
  removeServer,
  updateServer,
  getServer,
  getEnabledServers,
  getAutoConnectServers,
  BELLDANDY_DIR,
  MCP_CONFIG_PATH,
} from "./config.js";

// 客户端
export { MCPClient } from "./client.js";

// 工具桥接
export {
  MCPToolBridge,
  toOpenAIFunction,
  toAnthropicTool,
  toOpenAIFunctions,
  toAnthropicTools,
} from "./tool-bridge.js";

// 管理器
export {
  MCPManager,
  getMCPManager,
  initializeMCP,
  shutdownMCP,
} from "./manager.js";
