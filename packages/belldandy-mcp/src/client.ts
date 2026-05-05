/**
 * MCP 客户端封装
 * 
 * 对 @modelcontextprotocol/sdk 的 Client 进行封装，
 * 提供连接管理、工具发现和调用等功能。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import spawn from "cross-spawn";
import fs from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { resolveStateDir } from "@belldandy/protocol";

import {
  type MCPServerConfig,
  type MCPServerState,
  type MCPServerStatus,
  type MCPServerFailureKind,
  type MCPServerFailureSource,
  type MCPServerResultSource,
  type MCPServerRuntimeDiagnostics,
  type MCPToolInfo,
  type MCPResourceInfo,
  type MCPToolContentItem,
  type MCPResourceContentItem,
  type MCPResultDiagnostics,
  type MCPToolCallResult,
  type MCPResourceReadResult,
  type MCPEvent,
  type MCPEventListener,
  isStdioTransport,
  isSSETransport,
} from "./types.js";
import { mcpLog, mcpWarn, mcpError } from "./logger-adapter.js";

const FILESYSTEM_SERVER_PACKAGE = "@modelcontextprotocol/server-filesystem";
const EXTRA_WORKSPACE_ROOTS_ENV_KEY = "BELLDANDY_EXTRA_WORKSPACE_ROOTS";
const MAX_INLINE_TEXT_CHARS = 12_000;
const MAX_INLINE_BINARY_CHARS = 4_096;
const MCP_PERSIST_DIR = "generated";
const MAX_SESSION_RECOVERY_ATTEMPTS = 1;
const STDIO_STDERR_IGNORE_PATTERNS: Record<string, RegExp[]> = {
  "chrome-devtools": [
    /^No handler registered for issue code PerformanceIssue$/,
  ],
};

export function shouldPipeStdioStderr(serverId: string): boolean {
  return (STDIO_STDERR_IGNORE_PATTERNS[serverId]?.length ?? 0) > 0;
}

export function classifyStdioStderrLine(serverId: string, rawLine: string): "ignore" | "forward" {
  const line = rawLine.trim();
  if (!line) {
    return "ignore";
  }

  const ignorePatterns = STDIO_STDERR_IGNORE_PATTERNS[serverId];
  if (ignorePatterns?.some((pattern) => pattern.test(line))) {
    return "ignore";
  }

  return "forward";
}

function attachStdioStderrRelay(serverId: string, transport: StdioClientTransport): void {
  const stderrStream = transport.stderr as NodeJS.ReadableStream | null;
  if (!stderrStream) {
    return;
  }

  let pending = "";

  const flushLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (classifyStdioStderrLine(serverId, line) === "ignore") {
      return;
    }
    mcpLog(`mcp:${serverId}`, `stdio stderr: ${line}`);
  };

  stderrStream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      flushLine(line);
    }
  });

  stderrStream.on("end", () => {
    if (pending) {
      flushLine(pending);
      pending = "";
    }
  });
}

function normalizeComparablePath(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function parseExtraWorkspaceRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[EXTRA_WORKSPACE_ROOTS_ENV_KEY]?.trim();
  if (!raw) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    const comparable = normalizeComparablePath(resolved);
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    result.push(resolved);
  }
  return result;
}

export function expandFilesystemServerArgs(
  command: string,
  args: string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  const currentArgs = [...(args ?? [])];
  const extraRoots = parseExtraWorkspaceRoots(env);
  if (!extraRoots.length) return currentArgs;

  const packageIndex = currentArgs.lastIndexOf(FILESYSTEM_SERVER_PACKAGE);
  const commandLooksFilesystem = command.includes("server-filesystem");
  if (packageIndex < 0 && !commandLooksFilesystem) {
    return currentArgs;
  }

  const rootsStartIndex = packageIndex >= 0 ? packageIndex + 1 : 0;
  const prefix = currentArgs.slice(0, rootsStartIndex);
  const existingRoots = currentArgs.slice(rootsStartIndex);
  const seen = new Set(existingRoots.map((entry) => normalizeComparablePath(entry)));
  const appendedRoots: string[] = [];

  for (const root of extraRoots) {
    const comparable = normalizeComparablePath(root);
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    appendedRoots.push(root);
  }

  if (!appendedRoots.length) return currentArgs;
  return [...prefix, ...existingRoots, ...appendedRoots];
}

function buildTextTruncationNote(originalLength: number, keptLength: number): string {
  return `[MCP output truncated: original ${originalLength} chars, showing first ${keptLength}. Narrow the query or use pagination/filtering if supported.]`;
}

function buildBinaryTruncationNote(originalLength: number): string {
  return `[MCP binary payload omitted from inline result: original ${originalLength} chars of base64. Use a narrower query or resource-specific fetch path if supported.]`;
}

function buildPersistedOutputNote(input: {
  originalLength: number;
  webPath: string;
  preview?: string;
}): string {
  const header = `[MCP output saved: original ${input.originalLength} chars. Read full output at ${input.webPath}]`;
  if (!input.preview) {
    return header;
  }
  return `${header}\n\nPreview:\n${input.preview}`;
}

function sanitizePersistSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extensionForMimeType(mimeType: string | undefined, fallback: string): string {
  if (!mimeType) return fallback;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("json")) return "json";
  if (normalized.includes("markdown")) return "md";
  if (normalized.includes("plain")) return "txt";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("pdf")) return "pdf";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("octet-stream")) return "bin";
  const subtype = normalized.split("/")[1]?.split(";")[0]?.trim();
  return subtype ? sanitizePersistSegment(subtype) : fallback;
}

type MCPNormalizedToolCallContent = {
  content: MCPToolContentItem[];
  diagnostics: MCPResultDiagnostics;
};

type MCPNormalizedResourceReadContent = {
  contents: MCPResourceContentItem[];
  diagnostics: MCPResultDiagnostics;
};

type MCPNormalizedTextItem = {
  text?: string;
  truncated: boolean;
  persisted: boolean;
  persistedFilepath?: string;
  persistedWebPath?: string;
  originalLength?: number;
  note?: string;
  estimatedChars: number;
};

type MCPNormalizedBinaryItem = {
  value?: string;
  truncated: boolean;
  persisted: boolean;
  persistedFilepath?: string;
  persistedWebPath?: string;
  originalLength?: number;
  note?: string;
  estimatedChars: number;
};

// ============================================================================
// MCP 客户端类
// ============================================================================

/**
 * MCP 客户端
 * 
 * 封装单个 MCP 服务器的连接和交互。
 */
export class MCPClient {
  /** 服务器配置 */
  private config: MCPServerConfig;
  
  /** MCP SDK 客户端实例 */
  private client: Client | null = null;
  
  /** 传输层实例 */
  private transport: Transport | null = null;
  
  /** 子进程实例（仅 stdio 传输） */
  private childProcess: ChildProcess | null = null;
  
  /** 当前状态 */
  private status: MCPServerStatus = "disconnected";
  
  /** 错误信息 */
  private error: string | undefined;
  
  /** 连接时间 */
  private connectedAt: Date | undefined;
  
  /** 缓存的工具列表 */
  private tools: MCPToolInfo[] = [];
  
  /** 缓存的资源列表 */
  private resources: MCPResourceInfo[] = [];
  
  /** 服务器元数据 */
  private metadata: MCPServerState["metadata"];
  
  /** 事件监听器 */
  private eventListeners: Set<MCPEventListener> = new Set();
  
  /** 重连计数器 */
  private reconnectCount = 0;

  /** 当前进行中的重连任务 */
  private reconnectPromise: Promise<void> | null = null;

  /** 当前重连等待的取消控制器 */
  private reconnectDelayAbortController: AbortController | null = null;

  /** 重连是否已被取消 */
  private reconnectCancelled = false;

  /** 运行时诊断 */
  private diagnostics: MCPServerRuntimeDiagnostics = {
    connectionAttempts: 0,
    reconnectAttempts: 0,
  };

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  // ==========================================================================
  // 公共方法
  // ==========================================================================

  /**
   * 获取服务器 ID
   */
  get serverId(): string {
    return this.config.id;
  }

  /**
   * 获取服务器名称
   */
  get serverName(): string {
    return this.config.name;
  }

  /**
   * 获取当前状态
   */
  getState(): MCPServerState {
    return {
      id: this.config.id,
      status: this.status,
      error: this.error,
      connectedAt: this.connectedAt,
      tools: [...this.tools],
      resources: [...this.resources],
      metadata: this.metadata,
      diagnostics: this.getDiagnosticsSnapshot(),
    };
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      mcpLog(`mcp:${this.config.id}`, "已连接或正在连接中，跳过");
      return;
    }

    this.diagnostics.connectionAttempts += 1;
    this.diagnostics.lastConnectStartedAt = new Date();
    this.setStatus("connecting");
    this.error = undefined;

    try {
      // 创建传输层
      this.transport = await this.createTransport();

      // 创建客户端
      this.client = new Client(
        {
          name: "belldandy",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      // 连接到服务器
      await this.client.connect(this.transport);

      // 获取服务器信息
      const serverInfo = this.client.getServerVersion();
      this.metadata = {
        serverName: serverInfo?.name,
        serverVersion: serverInfo?.version,
        protocolVersion: undefined, // SDK 不再提供此字段
      };

      // 发现工具和资源
      await this.discoverCapabilities();

      // 更新状态
      this.connectedAt = new Date();
      this.reconnectCount = 0;
      this.setStatus("connected");

      mcpLog(`mcp:${this.config.id}`, `已连接到服务器 ${this.metadata.serverName || "unknown"}`);
      mcpLog(`mcp:${this.config.id}`, `发现 ${this.tools.length} 个工具, ${this.resources.length} 个资源`);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.recordFailure(err, { source: "connect" });
      this.setStatus("error");
      mcpError(`mcp:${this.config.id}`, `连接失败: ${this.error}`);
      
      // 清理资源
      await this.cleanup();
      
      throw err;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.status === "disconnected") {
      return;
    }

    mcpLog(`mcp:${this.config.id}`, "正在断开连接...");

    this.cancelPendingReconnect();
    this.diagnostics.lastDisconnectAt = new Date();

    await this.cleanup();
    this.setStatus("disconnected");

    mcpLog(`mcp:${this.config.id}`, "已断开连接");
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<void> {
    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }

    this.reconnectCancelled = false;

    let reconnectPromise: Promise<void>;
    reconnectPromise = this.runReconnectLoop().finally(() => {
      if (this.reconnectPromise === reconnectPromise) {
        this.reconnectPromise = null;
      }
      this.reconnectDelayAbortController = null;
      this.reconnectCancelled = false;
    });

    this.reconnectPromise = reconnectPromise;
    return reconnectPromise;
  }

  /**
   * 调用工具
   * 
   * @param toolName 工具名称（原始名称，非桥接名称）
   * @param args 工具参数
   * @returns 工具调用结果
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    if (!this.client || this.status !== "connected") {
      return {
        success: false,
        error: "MCP 服务器未连接",
        isError: true,
      };
    }

    try {
      mcpLog(`mcp:${this.config.id}`, `调用工具: ${toolName}`);
      const result = await this.executeWithSessionRecovery("call_tool", () =>
        this.client!.callTool({
          name: toolName,
          arguments: args,
        })
      );

      const normalized = await this.normalizeToolCallContent(
        Array.isArray(result.content) ? result.content : [],
      );
      this.recordResultDiagnostics("call_tool", normalized.diagnostics);

      return {
        success: !result.isError,
        content: normalized.content,
        structuredContent: "structuredContent" in result ? result.structuredContent : undefined,
        isError: Boolean(result.isError),
        diagnostics: normalized.diagnostics,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.recordFailure(err, { updateCurrentError: false, source: "call_tool" });
      mcpError(`mcp:${this.config.id}`, `工具调用失败: ${errorMessage}`);
      
      return {
        success: false,
        error: errorMessage,
        isError: true,
      };
    }
  }

  /**
   * 读取资源
   * 
   * @param uri 资源 URI
   * @returns 资源内容
   */
  async readResource(uri: string): Promise<MCPResourceReadResult> {
    if (!this.client || this.status !== "connected") {
      throw new Error("MCP 服务器未连接");
    }

    mcpLog(`mcp:${this.config.id}`, `读取资源: ${uri}`);

    try {
      const result = await this.executeWithSessionRecovery("read_resource", () =>
        this.client!.readResource({ uri })
      );
      const normalized = await this.normalizeResourceReadContent(result.contents);
      this.recordResultDiagnostics("read_resource", normalized.diagnostics);

      return {
        contents: normalized.contents,
        diagnostics: normalized.diagnostics,
      };
    } catch (err) {
      this.recordFailure(err, { updateCurrentError: false, source: "read_resource" });
      throw err;
    }
  }

  /**
   * 刷新工具和资源列表
   */
  async refresh(): Promise<void> {
    if (this.status !== "connected") {
      throw new Error("MCP 服务器未连接");
    }

    await this.discoverCapabilities();
    
    this.emitEvent("tools:updated", { tools: this.tools });
    this.emitEvent("resources:updated", { resources: this.resources });
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: MCPEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: MCPEventListener): void {
    this.eventListeners.delete(listener);
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  /**
   * 创建传输层
   */
  private async createTransport(): Promise<Transport> {
    const transport = this.config.transport;

    if (isStdioTransport(transport)) {
      return this.createStdioTransport(transport);
    } else if (isSSETransport(transport)) {
      return this.createSSETransport(transport);
    } else {
      throw new Error(`不支持的传输类型`);
    }
  }

  /**
   * 创建 stdio 传输层
   */
  private createStdioTransport(
    config: MCPServerConfig["transport"] & { type: "stdio" }
  ): Transport {
    const expandedArgs = expandFilesystemServerArgs(config.command, config.args, process.env);
    if ((expandedArgs?.length ?? 0) !== (config.args?.length ?? 0)) {
      mcpLog(
        `mcp:${this.config.id}`,
        `filesystem roots expanded from ${EXTRA_WORKSPACE_ROOTS_ENV_KEY}: ${(expandedArgs || []).join(" ")}`
      );
    }
    mcpLog(`mcp:${this.config.id}`, `创建 stdio 传输: ${config.command} ${(expandedArgs || []).join(" ")}`);

    const stderrMode = shouldPipeStdioStderr(this.config.id) ? "pipe" : "inherit";
    const transport = new StdioClientTransport({
      command: config.command,
      args: expandedArgs,
      env: config.env,
      cwd: config.cwd,
      stderr: stderrMode,
    });
    if (stderrMode === "pipe") {
      attachStdioStderrRelay(this.config.id, transport);
    }

    return transport;
  }

  /**
   * 创建 SSE 传输层
   */
  private createSSETransport(
    config: MCPServerConfig["transport"] & { type: "sse" }
  ): Transport {
    mcpLog(`mcp:${this.config.id}`, `创建 SSE 传输: ${config.url}`);

    const transport = new SSEClientTransport(
      new URL(config.url),
      {
        requestInit: config.headers
          ? { headers: config.headers }
          : undefined,
      }
    );

    return transport;
  }

  /**
   * 发现服务器能力（工具和资源）
   */
  private async discoverCapabilities(): Promise<void> {
    if (!this.client) return;

    // 发现工具
    try {
      const toolsResult = await this.client.listTools();
      this.tools = (toolsResult.tools || []).map((tool) => ({
        name: tool.name,
        bridgedName: this.getBridgedToolName(tool.name),
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        serverId: this.config.id,
      }));
    } catch (err) {
      if (this.isJsonRpcMethodNotFound(err)) {
        mcpLog(`mcp:${this.config.id}`, "服务器未实现 tools/list，按无工具处理");
        this.tools = [];
      } else {
        this.recordFailure(err, { updateCurrentError: false, source: "list_tools" });
        mcpWarn(`mcp:${this.config.id}`, "无法列出工具", err);
        this.tools = [];
      }
    }

    // 发现资源
    try {
      const resourcesResult = await this.client.listResources();
      this.resources = (resourcesResult.resources || []).map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        serverId: this.config.id,
      }));
    } catch (err) {
      if (this.isJsonRpcMethodNotFound(err)) {
        mcpLog(`mcp:${this.config.id}`, "服务器未实现 resources/list，按无资源处理");
        this.resources = [];
      } else {
        this.recordFailure(err, { updateCurrentError: false, source: "list_resources" });
        mcpWarn(`mcp:${this.config.id}`, "无法列出资源", err);
        this.resources = [];
      }
    }
  }

  /**
   * 获取桥接后的工具名称
   * 
   * 格式: mcp_{serverId}_{toolName}
   */
  private getBridgedToolName(toolName: string): string {
    // 将工具名转换为安全的标识符
    const safeName = toolName.replace(/[^a-zA-Z0-9_]/g, "_");
    const safeServerId = this.config.id.replace(/[^a-zA-Z0-9_]/g, "_");
    return `mcp_${safeServerId}_${safeName}`;
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    // 关闭客户端连接
    if (this.client) {
      try {
        await this.client.close();
      } catch (err) {
        mcpWarn(`mcp:${this.config.id}`, "关闭客户端时出错", err);
      }
      this.client = null;
    }

    // 关闭传输层
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (err) {
        mcpWarn(`mcp:${this.config.id}`, "关闭传输时出错", err);
      }
      this.transport = null;
    }

    // 终止子进程
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch (err) {
        mcpWarn(`mcp:${this.config.id}`, "终止子进程时出错", err);
      }
      this.childProcess = null;
    }

    // 清空缓存
    this.tools = [];
    this.resources = [];
    this.metadata = undefined;
    this.connectedAt = undefined;
  }

  private async runReconnectLoop(): Promise<void> {
    const maxRetries = this.config.retryCount ?? 3;
    const delay = this.config.retryDelay ?? 1000;

    while (!this.reconnectCancelled) {
      if (this.reconnectCount >= maxRetries) {
        mcpError(`mcp:${this.config.id}`, "已达到最大重试次数");
        this.error = "重连失败：已达到最大重试次数";
        this.recordFailure(new Error(this.error), { source: "connect", retryable: false });
        this.setStatus("error");
        return;
      }

      this.reconnectCount++;
      this.diagnostics.reconnectAttempts += 1;
      this.diagnostics.lastRetryAt = new Date();
      this.diagnostics.lastRetryDelayMs = delay;
      this.diagnostics.lastRetryAttempt = this.reconnectCount;
      this.diagnostics.lastRetryMax = maxRetries;
      this.setStatus("reconnecting");

      mcpLog(
        `mcp:${this.config.id}`,
        `正在重连 (${this.reconnectCount}/${maxRetries})...`
      );

      const shouldContinue = await this.waitReconnectDelay(delay);
      if (!shouldContinue || this.reconnectCancelled) {
        mcpLog(`mcp:${this.config.id}`, "重连等待已取消");
        return;
      }

      try {
        await this.cleanup();
        if (this.reconnectCancelled) {
          return;
        }

        await this.connect();

        if (this.reconnectCancelled) {
          await this.cleanup();
          this.setStatus("disconnected");
        }
        return;
      } catch {
        if (this.reconnectCancelled) {
          return;
        }
      }
    }
  }

  private async waitReconnectDelay(delay: number): Promise<boolean> {
    this.reconnectDelayAbortController?.abort();
    const controller = new AbortController();
    this.reconnectDelayAbortController = controller;

    try {
      return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve(true);
        }, delay);

        const onAbort = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", onAbort);
          resolve(false);
        };

        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    } finally {
      if (this.reconnectDelayAbortController === controller) {
        this.reconnectDelayAbortController = null;
      }
    }
  }

  private cancelPendingReconnect(): void {
    this.reconnectCancelled = true;
    this.reconnectDelayAbortController?.abort();
    this.reconnectDelayAbortController = null;
  }

  private classifyFailureKind(error: unknown): MCPServerFailureKind {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (
      normalized.includes("session expired")
      || normalized.includes("session not found")
      || normalized.includes("invalid session")
    ) {
      return "session_expired";
    }
    if (
      normalized.includes("timeout")
      || normalized.includes("econn")
      || normalized.includes("network")
      || normalized.includes("transport")
      || normalized.includes("fetch failed")
      || normalized.includes("socket")
    ) {
      return "transport";
    }
    return "unknown";
  }

  private isJsonRpcMethodNotFound(error: unknown): boolean {
    if (!error) return false;
    const maybeCode = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (maybeCode === -32601 || maybeCode === "-32601") {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized.includes("-32601") || normalized.includes("method not found");
  }

  private recordFailure(
    error: unknown,
    options: {
      source?: MCPServerFailureSource;
      retryable?: boolean;
      updateCurrentError?: boolean;
    } = {},
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    const kind = this.classifyFailureKind(error);
    this.diagnostics.lastErrorAt = new Date();
    this.diagnostics.lastErrorKind = kind;
    this.diagnostics.lastErrorMessage = message;
    this.diagnostics.lastErrorSource = options.source;
    this.diagnostics.lastErrorRetryable = options.retryable ?? (kind === "session_expired" || kind === "transport");
    if (kind === "session_expired") {
      this.diagnostics.lastSessionExpiredAt = this.diagnostics.lastErrorAt;
    }
    if (options.updateCurrentError !== false) {
      this.error = message;
    }
  }

  private async executeWithSessionRecovery<T>(
    source: MCPServerFailureSource,
    operation: () => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_SESSION_RECOVERY_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const kind = this.classifyFailureKind(error);
        const isRecoverable = kind === "session_expired";
        this.recordFailure(error, {
          source,
          retryable: isRecoverable,
          updateCurrentError: false,
        });
        if (!isRecoverable || attempt >= MAX_SESSION_RECOVERY_ATTEMPTS) {
          throw error;
        }
        this.diagnostics.lastRecoveryAt = new Date();
        try {
          await this.reconnect();
          this.diagnostics.lastRecoverySucceeded = true;
        } catch (reconnectError) {
          this.diagnostics.lastRecoverySucceeded = false;
          this.recordFailure(reconnectError, {
            source: "connect",
            retryable: false,
          });
          throw reconnectError;
        }
      }
    }
    throw lastError;
  }

  private createResultDiagnostics(input: {
    estimatedChars: number;
    truncatedItems: number;
    persistedItems?: number;
    persistedFilepath?: string;
    persistedWebPath?: string;
  }): MCPResultDiagnostics {
    return {
      strategy: input.persistedItems && input.persistedItems > 0
        ? "persisted"
        : input.truncatedItems > 0 ? "truncated" : "inline",
      truncated: input.truncatedItems > 0,
      estimatedChars: input.estimatedChars,
      truncatedItems: input.truncatedItems,
      persistedItems: input.persistedItems,
      persistedFilepath: input.persistedFilepath,
      persistedWebPath: input.persistedWebPath,
    };
  }

  private recordResultDiagnostics(
    source: MCPServerResultSource,
    diagnostics: MCPResultDiagnostics,
  ): void {
    this.diagnostics.lastResult = {
      at: new Date(),
      source,
      strategy: diagnostics.strategy,
      estimatedChars: diagnostics.estimatedChars,
      truncatedItems: diagnostics.truncatedItems,
      persistedItems: diagnostics.persistedItems,
      persistedWebPath: diagnostics.persistedWebPath,
    };
  }

  private async normalizeToolCallContent(
    contentArray: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
      resource?: { uri?: string; text?: string; mimeType?: string };
    }>,
  ): Promise<MCPNormalizedToolCallContent> {
    let truncatedItems = 0;
    let persistedItems = 0;
    let estimatedChars = 0;
    let persistedFilepath: string | undefined;
    let persistedWebPath: string | undefined;
    const content: MCPToolContentItem[] = [];
    for (const item of contentArray) {
      if (item.type === "text") {
        const normalized = await this.normalizeLargeTextItem({
          text: item.text,
          persistId: `${this.config.id}-tool-text`,
          mimeType: "text/plain",
        });
        if (normalized.persisted) {
          persistedItems += 1;
          persistedFilepath ??= normalized.persistedFilepath;
          persistedWebPath ??= normalized.persistedWebPath;
        }
        if (normalized.truncated) truncatedItems += 1;
        estimatedChars += normalized.estimatedChars;
        content.push({
          type: "text",
          text: normalized.text,
          truncated: normalized.truncated,
          originalLength: normalized.originalLength,
          note: normalized.note,
        });
        continue;
      }
      if (item.type === "image") {
        const normalized = await this.normalizeLargeBinaryItem({
          value: item.data,
          persistId: `${this.config.id}-tool-image`,
          mimeType: item.mimeType,
        });
        if (normalized.persisted) {
          persistedItems += 1;
          persistedFilepath ??= normalized.persistedFilepath;
          persistedWebPath ??= normalized.persistedWebPath;
        }
        if (normalized.truncated) truncatedItems += 1;
        estimatedChars += normalized.estimatedChars;
        content.push({
          type: "image",
          data: normalized.value,
          mimeType: item.mimeType,
          truncated: normalized.truncated,
          originalLength: normalized.originalLength,
          note: normalized.note,
        });
        continue;
      }
      if (item.type === "resource") {
        const normalized = await this.normalizeLargeTextItem({
          text: item.resource?.text,
          persistId: `${this.config.id}-tool-resource`,
          mimeType: item.resource?.mimeType,
        });
        if (normalized.persisted) {
          persistedItems += 1;
          persistedFilepath ??= normalized.persistedFilepath;
          persistedWebPath ??= normalized.persistedWebPath;
        }
        if (normalized.truncated) truncatedItems += 1;
        estimatedChars += normalized.estimatedChars;
        content.push({
          type: "resource",
          uri: item.resource?.uri,
          text: normalized.text,
          mimeType: item.resource?.mimeType,
          truncated: normalized.truncated,
          originalLength: normalized.originalLength,
          note: normalized.note,
        });
        continue;
      }
      const fallback = await this.normalizeLargeTextItem({
        text: JSON.stringify(item),
        persistId: `${this.config.id}-tool-fallback`,
        mimeType: "application/json",
      });
      if (fallback.persisted) {
        persistedItems += 1;
        persistedFilepath ??= fallback.persistedFilepath;
        persistedWebPath ??= fallback.persistedWebPath;
      }
      if (fallback.truncated) truncatedItems += 1;
      estimatedChars += fallback.estimatedChars;
      content.push({
        type: "text",
        text: fallback.text,
        truncated: fallback.truncated,
        originalLength: fallback.originalLength,
        note: fallback.note,
      });
    }

    return {
      content,
      diagnostics: this.createResultDiagnostics({
        estimatedChars,
        truncatedItems,
        persistedItems,
        persistedFilepath,
        persistedWebPath,
      }),
    };
  }

  private async normalizeResourceReadContent(
    contents: Array<{
      uri: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    }>,
  ): Promise<MCPNormalizedResourceReadContent> {
    let truncatedItems = 0;
    let persistedItems = 0;
    let estimatedChars = 0;
    let persistedFilepath: string | undefined;
    let persistedWebPath: string | undefined;
    const normalizedContents: MCPResourceContentItem[] = [];
    for (const content of contents) {
      const normalizedText = await this.normalizeLargeTextItem({
        text: "text" in content ? content.text : undefined,
        persistId: `${this.config.id}-resource-text`,
        mimeType: content.mimeType,
      });
      const normalizedBlob = await this.normalizeLargeBinaryItem({
        value: "blob" in content ? content.blob : undefined,
        persistId: `${this.config.id}-resource-blob`,
        mimeType: content.mimeType,
      });
      if (normalizedText.persisted) {
        persistedItems += 1;
        persistedFilepath ??= normalizedText.persistedFilepath;
        persistedWebPath ??= normalizedText.persistedWebPath;
      }
      if (normalizedBlob.persisted) {
        persistedItems += 1;
        persistedFilepath ??= normalizedBlob.persistedFilepath;
        persistedWebPath ??= normalizedBlob.persistedWebPath;
      }
      if (normalizedText.truncated || normalizedBlob.truncated) truncatedItems += 1;
      estimatedChars += normalizedText.estimatedChars + normalizedBlob.estimatedChars;
      const notes = [normalizedText.note, normalizedBlob.note].filter(Boolean);
      normalizedContents.push({
        uri: content.uri,
        mimeType: content.mimeType,
        text: normalizedText.text,
        blob: normalizedBlob.value,
        truncated: normalizedText.truncated || normalizedBlob.truncated,
        originalLength: normalizedBlob.originalLength ?? normalizedText.originalLength,
        note: notes.length > 0 ? notes.join(" ") : undefined,
      });
    }

    return {
      contents: normalizedContents,
      diagnostics: this.createResultDiagnostics({
        estimatedChars,
        truncatedItems,
        persistedItems,
        persistedFilepath,
        persistedWebPath,
      }),
    };
  }

  private async normalizeLargeTextItem(input: {
    text: string | undefined;
    persistId: string;
    mimeType?: string;
  }): Promise<MCPNormalizedTextItem> {
    const text = input.text;
    if (!text) {
      return { text, truncated: false, persisted: false, estimatedChars: 0 };
    }
    if (text.length <= MAX_INLINE_TEXT_CHARS) {
      return { text, truncated: false, persisted: false, originalLength: text.length, estimatedChars: text.length };
    }
    const persisted = await this.persistLargeText(text, input.persistId, input.mimeType);
    if (persisted) {
      const preview = text.slice(0, 2000);
      const note = buildPersistedOutputNote({
        originalLength: text.length,
        webPath: persisted.webPath,
        preview,
      });
      return {
        text: note,
        truncated: false,
        persisted: true,
        persistedFilepath: persisted.filepath,
        persistedWebPath: persisted.webPath,
        originalLength: text.length,
        note,
        estimatedChars: note.length,
      };
    }
    const note = buildTextTruncationNote(text.length, MAX_INLINE_TEXT_CHARS);
    const truncatedText = `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n${note}`;
    return {
      text: truncatedText,
      truncated: true,
      persisted: false,
      originalLength: text.length,
      note,
      estimatedChars: truncatedText.length,
    };
  }

  private async normalizeLargeBinaryItem(input: {
    value: string | undefined;
    persistId: string;
    mimeType?: string;
  }): Promise<MCPNormalizedBinaryItem> {
    const value = input.value;
    if (!value) {
      return { value, truncated: false, persisted: false, estimatedChars: 0 };
    }
    if (value.length <= MAX_INLINE_BINARY_CHARS) {
      return { value, truncated: false, persisted: false, originalLength: value.length, estimatedChars: value.length };
    }
    const persisted = await this.persistLargeBinary(value, input.persistId, input.mimeType);
    if (persisted) {
      const note = buildPersistedOutputNote({
        originalLength: value.length,
        webPath: persisted.webPath,
      });
      return {
        value: undefined,
        truncated: false,
        persisted: true,
        persistedFilepath: persisted.filepath,
        persistedWebPath: persisted.webPath,
        originalLength: value.length,
        note,
        estimatedChars: note.length,
      };
    }
    return {
      value: undefined,
      truncated: true,
      persisted: false,
      originalLength: value.length,
      note: buildBinaryTruncationNote(value.length),
      estimatedChars: 0,
    };
  }

  private async persistLargeText(
    text: string,
    persistId: string,
    mimeType?: string,
  ): Promise<{ filepath: string; webPath: string } | undefined> {
    try {
      const stateDir = resolveStateDir(process.env);
      const generatedDir = path.join(stateDir, MCP_PERSIST_DIR);
      await fs.mkdir(generatedDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const extension = extensionForMimeType(mimeType, "txt");
      const filename = `mcp-${sanitizePersistSegment(persistId)}-${timestamp}.${extension}`;
      const filepath = path.join(generatedDir, filename);
      await fs.writeFile(filepath, text, "utf-8");
      return {
        filepath,
        webPath: `/generated/${filename}`,
      };
    } catch (error) {
      mcpWarn(`mcp:${this.config.id}`, "持久化 MCP 文本结果失败，回退为截断输出", error);
      return undefined;
    }
  }

  private async persistLargeBinary(
    value: string,
    persistId: string,
    mimeType?: string,
  ): Promise<{ filepath: string; webPath: string } | undefined> {
    try {
      const stateDir = resolveStateDir(process.env);
      const generatedDir = path.join(stateDir, MCP_PERSIST_DIR);
      await fs.mkdir(generatedDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const extension = extensionForMimeType(mimeType, "bin");
      const filename = `mcp-${sanitizePersistSegment(persistId)}-${timestamp}.${extension}`;
      const filepath = path.join(generatedDir, filename);
      await fs.writeFile(filepath, Buffer.from(value, "base64"));
      return {
        filepath,
        webPath: `/generated/${filename}`,
      };
    } catch (error) {
      mcpWarn(`mcp:${this.config.id}`, "持久化 MCP 二进制结果失败，回退为截断输出", error);
      return undefined;
    }
  }

  private getDiagnosticsSnapshot(): MCPServerRuntimeDiagnostics {
    return {
      ...this.diagnostics,
      lastResult: this.diagnostics.lastResult
        ? { ...this.diagnostics.lastResult }
        : undefined,
    };
  }

  /**
   * 设置状态并触发事件
   */
  private setStatus(status: MCPServerStatus): void {
    const oldStatus = this.status;
    this.status = status;

    if (oldStatus !== status) {
      switch (status) {
        case "connected":
          this.emitEvent("server:connected", {
            metadata: this.metadata,
            diagnostics: this.getDiagnosticsSnapshot(),
          });
          break;
        case "disconnected":
          this.emitEvent("server:disconnected", {
            diagnostics: this.getDiagnosticsSnapshot(),
          });
          break;
        case "error":
          this.emitEvent("server:error", {
            error: this.error,
            diagnostics: this.getDiagnosticsSnapshot(),
          });
          break;
      }
    }
  }

  /**
   * 触发事件
   */
  private emitEvent(type: MCPEvent["type"], data?: unknown): void {
    const event: MCPEvent = {
      type,
      serverId: this.config.id,
      timestamp: new Date(),
      data,
    };

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        mcpError(`mcp:${this.config.id}`, "事件监听器错误", err);
      }
    }
  }
}
