/**
 * Belldandy MCP 类型定义
 * 
 * MCP (Model Context Protocol) 是一个标准化协议，用于 AI 助手连接外部数据源和工具。
 * 本模块定义了 Belldandy 与 MCP 服务器交互所需的所有类型。
 */

import type { Tool, Resource } from "@modelcontextprotocol/sdk/types.js";

// ============================================================================
// 配置类型
// ============================================================================

/**
 * MCP 服务器传输类型
 * - stdio: 通过子进程的标准输入/输出通信（本地服务器）
 * - sse: 通过 HTTP Server-Sent Events 通信（远程服务器）
 */
export type MCPTransportType = "stdio" | "sse";

/**
 * stdio 传输配置
 * 用于启动本地 MCP 服务器进程
 */
export interface MCPStdioConfig {
  type: "stdio";
  /** 要执行的命令（如 "npx", "node", "python" 等） */
  command: string;
  /** 命令行参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
}

/**
 * SSE (Server-Sent Events) 传输配置
 * 用于连接远程 HTTP MCP 服务器
 */
export interface MCPSSEConfig {
  type: "sse";
  /** 服务器 URL */
  url: string;
  /** 可选的请求头（如认证信息） */
  headers?: Record<string, string>;
  /** 显式允许明文 HTTP，仅用于受控兼容场景。 */
  allowInsecureHttp?: boolean;
  /** 显式允许 loopback、私网或保留地址，仅用于本地/受控网络。 */
  allowPrivateNetwork?: boolean;
}

/**
 * MCP 服务器配置
 * 定义单个 MCP 服务器的连接参数
 */
export interface MCPServerConfig {
  /** 服务器唯一标识符 */
  id: string;
  /** 服务器显示名称 */
  name: string;
  /** 服务器描述 */
  description?: string;
  /** 传输配置 */
  transport: MCPStdioConfig | MCPSSEConfig;
  /** 是否在启动时自动连接 */
  autoConnect?: boolean;
  /** 是否启用此服务器 */
  enabled?: boolean;
  /** 连接超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  retryCount?: number;
  /** 重试间隔（毫秒） */
  retryDelay?: number;
}

/**
 * MCP 全局配置
 * ~/.star_sanctuary/mcp.json 的结构
 */
export interface MCPConfig {
  /** 配置版本 */
  version: string;
  /** MCP 服务器列表 */
  servers: MCPServerConfig[];
  /** 全局设置 */
  settings?: {
    /** 默认超时时间（毫秒） */
    defaultTimeout?: number;
    /** 启用调试日志 */
    debug?: boolean;
    /** 工具名称前缀（用于区分不同服务器的同名工具） */
    toolPrefix?: boolean;
  };
}

// ============================================================================
// 运行时类型
// ============================================================================

/**
 * MCP 服务器连接状态
 */
export type MCPServerStatus = 
  | "disconnected"  // 未连接
  | "connecting"    // 正在连接
  | "connected"     // 已连接
  | "error"         // 连接错误
  | "reconnecting"; // 重新连接中

export type MCPServerFailureKind =
  | "session_expired"
  | "transport"
  | "unknown";

export type MCPServerFailureSource =
  | "connect"
  | "call_tool"
  | "read_resource"
  | "list_tools"
  | "list_resources";

export type MCPResultHandlingStrategy =
  | "inline"
  | "truncated"
  | "persisted";

export type MCPServerResultSource =
  | "call_tool"
  | "read_resource";

export interface MCPServerLastResultDiagnostics {
  at: Date;
  source: MCPServerResultSource;
  strategy: MCPResultHandlingStrategy;
  estimatedChars: number;
  truncatedItems: number;
  persistedItems?: number;
  persistedWebPath?: string;
}

export interface MCPServerRuntimeDiagnostics {
  connectionAttempts: number;
  reconnectAttempts: number;
  lastConnectStartedAt?: Date;
  lastDisconnectAt?: Date;
  lastErrorAt?: Date;
  lastErrorKind?: MCPServerFailureKind;
  lastErrorMessage?: string;
  lastErrorSource?: MCPServerFailureSource;
  lastErrorRetryable?: boolean;
  lastSessionExpiredAt?: Date;
  lastRetryAt?: Date;
  lastRetryDelayMs?: number;
  lastRetryAttempt?: number;
  lastRetryMax?: number;
  lastRecoveryAt?: Date;
  lastRecoverySucceeded?: boolean;
  lastResult?: MCPServerLastResultDiagnostics;
}

export interface MCPResultDiagnostics {
  strategy: MCPResultHandlingStrategy;
  truncated: boolean;
  estimatedChars: number;
  truncatedItems: number;
  persistedItems?: number;
  persistedFilepath?: string;
  persistedWebPath?: string;
}

export interface MCPToolContentItem {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  truncated?: boolean;
  originalLength?: number;
  note?: string;
}

export interface MCPResourceContentItem {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  truncated?: boolean;
  originalLength?: number;
  note?: string;
}

/**
 * MCP 服务器运行时状态
 */
export interface MCPServerState {
  /** 服务器 ID */
  id: string;
  /** 连接状态 */
  status: MCPServerStatus;
  /** 错误信息（如果有） */
  error?: string;
  /** 上次连接时间 */
  connectedAt?: Date;
  /** 可用工具列表 */
  tools: MCPToolInfo[];
  /** 可用资源列表 */
  resources: MCPResourceInfo[];
  /** 服务器元数据 */
  metadata?: {
    serverName?: string;
    serverVersion?: string;
    protocolVersion?: string;
  };
  /** 运行时诊断 */
  diagnostics?: MCPServerRuntimeDiagnostics;
}

/**
 * MCP 工具信息
 * 桥接到 Belldandy 工具系统的信息
 */
export interface MCPToolInfo {
  /** 原始工具名称 */
  name: string;
  /** 桥接后的工具名称（可能包含服务器前缀） */
  bridgedName: string;
  /** 工具描述 */
  description?: string;
  /** 输入参数 Schema (JSON Schema 格式) */
  inputSchema: Record<string, unknown>;
  /** 来源服务器 ID */
  serverId: string;
}

/**
 * MCP 资源信息
 */
export interface MCPResourceInfo {
  /** 资源 URI */
  uri: string;
  /** 资源名称 */
  name: string;
  /** 资源描述 */
  description?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 来源服务器 ID */
  serverId: string;
}

// ============================================================================
// 工具调用类型
// ============================================================================

/**
 * MCP 工具调用请求
 */
export interface MCPToolCallRequest {
  /** 工具名称（桥接后的名称） */
  name: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
}

/**
 * MCP 工具调用结果
 */
export interface MCPToolCallResult {
  /** 是否成功 */
  success: boolean;
  /** 结果内容 */
  content?: MCPToolContentItem[];
  /** 结构化输出内容（如果 MCP server 返回） */
  structuredContent?: unknown;
  /** 错误信息 */
  error?: string;
  /** 是否为错误响应 */
  isError?: boolean;
  /** 输出处理诊断 */
  diagnostics?: MCPResultDiagnostics;
}

// ============================================================================
// 资源访问类型
// ============================================================================

/**
 * MCP 资源读取请求
 */
export interface MCPResourceReadRequest {
  /** 资源 URI */
  uri: string;
}

/**
 * MCP 资源读取结果
 */
export interface MCPResourceReadResult {
  /** 资源内容 */
  contents: MCPResourceContentItem[];
  /** 输出处理诊断 */
  diagnostics?: MCPResultDiagnostics;
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * MCP 事件类型
 */
export type MCPEventType = 
  | "server:connected"
  | "server:disconnected"
  | "server:error"
  | "tools:updated"
  | "resources:updated";

/**
 * MCP 事件
 */
export interface MCPEvent {
  type: MCPEventType;
  serverId: string;
  timestamp: Date;
  data?: unknown;
}

/**
 * MCP 事件监听器
 */
export type MCPEventListener = (event: MCPEvent) => void;

// ============================================================================
// 管理器接口
// ============================================================================

/**
 * MCP 管理器接口
 * 用于管理多个 MCP 服务器连接
 */
export interface MCPManager {
  /** 初始化管理器 */
  initialize(): Promise<void>;
  
  /** 关闭所有连接 */
  shutdown(): Promise<void>;
  
  /** 连接指定服务器 */
  connect(serverId: string): Promise<void>;
  
  /** 断开指定服务器 */
  disconnect(serverId: string): Promise<void>;
  
  /** 获取服务器状态 */
  getServerState(serverId: string): MCPServerState | undefined;
  
  /** 获取所有服务器状态 */
  getAllServerStates(): MCPServerState[];
  
  /** 获取所有可用工具 */
  getAllTools(): MCPToolInfo[];
  
  /** 获取所有可用资源 */
  getAllResources(): MCPResourceInfo[];
  
  /** 调用工具 */
  callTool(request: MCPToolCallRequest): Promise<MCPToolCallResult>;
  
  /** 读取资源 */
  readResource(request: MCPResourceReadRequest): Promise<MCPResourceReadResult>;
  
  /** 添加事件监听器 */
  addEventListener(listener: MCPEventListener): void;
  
  /** 移除事件监听器 */
  removeEventListener(listener: MCPEventListener): void;
}

// ============================================================================
// 工具桥接类型
// ============================================================================

/**
 * Belldandy 工具定义
 * 用于将 MCP 工具桥接到 Belldandy 的工具系统
 */
export interface BelldandyToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入参数 Schema */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** 工具执行函数 */
  execute: (params: Record<string, unknown>) => Promise<unknown>;
  /** 元数据 */
  metadata?: {
    /** 来源 MCP 服务器 */
    mcpServer?: string;
    /** 原始工具名称 */
    originalName?: string;
    /** 工具类别 */
    category?: string;
  };
}

// ============================================================================
// 类型守卫
// ============================================================================

/**
 * 检查传输配置是否为 stdio 类型
 */
export function isStdioTransport(
  transport: MCPStdioConfig | MCPSSEConfig
): transport is MCPStdioConfig {
  return transport.type === "stdio";
}

/**
 * 检查传输配置是否为 SSE 类型
 */
export function isSSETransport(
  transport: MCPStdioConfig | MCPSSEConfig
): transport is MCPSSEConfig {
  return transport.type === "sse";
}

// ============================================================================
// 默认值
// ============================================================================

/**
 * 默认 MCP 配置
 */
export const DEFAULT_MCP_CONFIG: MCPConfig = {
  version: "1.0.0",
  servers: [],
  settings: {
    defaultTimeout: 30000,
    debug: false,
    toolPrefix: true,
  },
};

/**
 * 默认服务器配置值
 */
export const DEFAULT_SERVER_CONFIG = {
  autoConnect: true,
  enabled: true,
  timeout: 30000,
  retryCount: 3,
  retryDelay: 1000,
} as const;
