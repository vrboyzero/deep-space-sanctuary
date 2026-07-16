/**
 * MCP 客户端封装
 * 
 * 对 @modelcontextprotocol/sdk 的 Client 进行封装，
 * 提供连接管理、工具发现和调用等功能。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import spawn from "cross-spawn";
import fs from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import {
  OutboundRequestPolicy,
  OutboundRequestPolicyError,
  resolveStateDir,
} from "@belldandy/protocol";

import {
  type MCPServerConfig,
  type MCPServerState,
  type MCPServerStatus,
  type MCPServerFailureKind,
  type MCPServerFailureSource,
  type MCPExecutionOptions,
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
  DEFAULT_SERVER_CONFIG,
} from "./types.js";
import { mcpDebug, mcpLog, mcpWarn, mcpError } from "./logger-adapter.js";
import { BoundedStdioStderrLineBuffer } from "./stdio-stderr.js";

type MCPConnectFailureLogLevel = "error" | "none";
type MCPConnectOptions = MCPExecutionOptions & {
  failureLogLevel?: MCPConnectFailureLogLevel;
};

type MCPConnectionLease = {
  client: Client;
  transport: Transport | null;
};

const FILESYSTEM_SERVER_PACKAGE = "@modelcontextprotocol/server-filesystem";
const EXTRA_WORKSPACE_ROOTS_ENV_KEY = "BELLDANDY_EXTRA_WORKSPACE_ROOTS";
const MAX_INLINE_TEXT_CHARS = 12_000;
const MAX_INLINE_BINARY_CHARS = 4_096;
const MAX_PERSISTED_TEXT_BYTES = 256_000;
const MAX_PERSISTED_BINARY_BYTES = 256_000;
const MCP_PERSIST_DIR = "generated";
const MAX_SESSION_RECOVERY_ATTEMPTS = 1;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MIN_RECONNECT_JITTER_RATIO = 0.5;
const STDIO_STDERR_IGNORE_PATTERNS: Record<string, RegExp[]> = {
  "chrome-devtools": [
    /^No handler registered for issue code PerformanceIssue$/,
  ],
};

/**
 * 表示 MCP SDK 操作超过配置 deadline。消息只含受控 source 和时长，避免泄漏请求内容。
 */
export class MCPDeadlineError extends Error {
  readonly source: MCPServerFailureSource;
  readonly timeoutMs: number;

  constructor(source: MCPServerFailureSource, timeoutMs: number) {
    super("MCP " + source + " timed out after " + timeoutMs + "ms.");
    this.name = "MCPDeadlineError";
    this.source = source;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 表示上层主动取消 MCP 操作。它与 transport 故障分开记录，避免无意义自动重连。
 */
export class MCPAbortError extends Error {
  readonly source: MCPServerFailureSource;

  constructor(source: MCPServerFailureSource) {
    super("MCP " + source + " cancelled by caller.");
    this.name = "MCPAbortError";
    this.source = source;
  }
}

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  if (Number.isFinite(value) && value! > 0) {
    return Math.floor(value!);
  }
  return fallback;
}

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

  const buffer = new BoundedStdioStderrLineBuffer();

  const flushLine = (rawLine: string, truncatedBytes: number) => {
    const suffix = truncatedBytes > 0 ? ` [truncated ${truncatedBytes} bytes]` : "";
    const line = `${rawLine}${suffix}`.trim();
    if (classifyStdioStderrLine(serverId, line) === "ignore") {
      return;
    }
    mcpLog(`mcp:${serverId}`, `stdio stderr: ${line}`);
  };

  stderrStream.on("data", (chunk) => {
    for (const line of buffer.push(chunk)) {
      flushLine(line.line, line.truncatedBytes);
    }
  });

  stderrStream.on("end", () => {
    for (const line of buffer.finish()) {
      flushLine(line.line, line.truncatedBytes);
    }
  });
}

/**
 * 重连只在有限窗口内指数扩展，抖动避免多个失联 MCP 服务同时打到同一远端。
 */
export function calculateMCPReconnectDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs = MAX_RECONNECT_DELAY_MS,
  random: () => number = Math.random,
): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const normalizedInitialDelay = Number.isFinite(initialDelayMs) ? Math.max(0, Math.floor(initialDelayMs)) : 0;
  const normalizedMaxDelay = Number.isFinite(maxDelayMs) ? Math.max(0, Math.floor(maxDelayMs)) : 0;
  const exponent = Math.min(normalizedAttempt - 1, 30);
  const exponentialDelay = Math.min(normalizedMaxDelay, normalizedInitialDelay * (2 ** exponent));
  const minimumDelay = Math.floor(exponentialDelay * MIN_RECONNECT_JITTER_RATIO);
  const randomSample = random();
  const sample = Number.isFinite(randomSample)
    ? Math.min(Math.max(randomSample, 0), 0.999_999)
    : MIN_RECONNECT_JITTER_RATIO;
  return Math.min(
    normalizedMaxDelay,
    Math.round(minimumDelay + (exponentialDelay - minimumDelay) * sample),
  );
}

function createMcpSseOutboundFetch(policy: Pick<OutboundRequestPolicy, "request">): FetchLike {
  return async (url, init) => {
    const headers = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined;
    const body = normalizeMcpSseRequestBody(init?.body);
    const result = await policy.request({
      url,
      method: init?.method,
      headers,
      body,
      signal: init?.signal ?? undefined,
    });
    return result.response;
  };
}

function normalizeMcpSseRequestBody(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new TypeError("MCP SSE outbound request body must be text or binary data.");
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

function buildHardLimitedPersistedOutputNote(input: {
  originalBytes: number;
  keptBytes: number;
  webPath: string;
  preview?: string;
}): string {
  const header = `[MCP output exceeded hard limit: original ${input.originalBytes} bytes, saved first ${input.keptBytes} bytes to ${input.webPath}]`;
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

function truncateUtf8TextByBytes(text: string, maxBytes: number): { text: string; bytes: number } {
  const buffer = Buffer.from(text, "utf-8");
  if (buffer.length <= maxBytes) {
    return { text, bytes: buffer.length };
  }
  const truncated = buffer.subarray(0, maxBytes).toString("utf-8");
  return {
    text: truncated,
    bytes: Buffer.byteLength(truncated, "utf-8"),
  };
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

  /** server 未设置 timeout 时继承的全局默认值 */
  private readonly defaultTimeoutMs: number;
  
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

  constructor(
    config: MCPServerConfig,
    options: { defaultTimeoutMs?: number } = {},
  ) {
    this.config = config;
    this.defaultTimeoutMs = normalizeTimeoutMs(
      options.defaultTimeoutMs,
      DEFAULT_SERVER_CONFIG.timeout,
    );
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
  async connect(options: MCPConnectOptions = {}): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      mcpLog(`mcp:${this.config.id}`, "已连接或正在连接中，跳过");
      return;
    }

    this.diagnostics.connectionAttempts += 1;
    this.diagnostics.lastConnectStartedAt = new Date();
    this.setStatus("connecting");
    this.error = undefined;

    try {
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

      // 传输创建和握手均受同一 deadline 约束，避免 DNS/stdio 启动卡住连接状态。
      this.transport = await this.runWithDeadline(
        "connect",
        () => this.createTransport(),
        options,
      );

      // 连接到服务器
      const transport = this.transport;
      if (!transport) {
        throw new Error("MCP transport was not created.");
      }
      await this.runWithDeadline(
        "connect",
        (sdkClient, requestOptions) => sdkClient.connect(transport, requestOptions),
        options,
      );

      // 获取服务器信息
      const serverInfo = this.client.getServerVersion();
      this.metadata = {
        serverName: serverInfo?.name,
        serverVersion: serverInfo?.version,
        protocolVersion: undefined, // SDK 不再提供此字段
      };

      // 发现工具和资源
      await this.discoverCapabilities(options);

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
      if ((options.failureLogLevel ?? "error") === "error") {
        mcpError(`mcp:${this.config.id}`, `连接失败: ${this.error}`);
      }
      
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
    args: Record<string, unknown>,
    options: MCPExecutionOptions = {},
  ): Promise<MCPToolCallResult> {
    if (!this.client || this.status !== "connected") {
      return {
        success: false,
        error: "MCP 服务器未连接",
        isError: true,
      };
    }

    try {
      const logToolCall =
        toolName === "agent_wake_notifications" && args.ackMatched !== true
          ? mcpDebug
          : mcpLog;
      logToolCall(`mcp:${this.config.id}`, `调用工具: ${toolName}`);
      const result = await this.executeWithSessionRecovery("call_tool", () =>
        this.runWithDeadline(
          "call_tool",
          (sdkClient, requestOptions) => sdkClient.callTool(
            {
              name: toolName,
              arguments: args,
            },
            undefined,
            requestOptions,
          ),
          options,
        )
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
  async readResource(
    uri: string,
    options: MCPExecutionOptions = {},
  ): Promise<MCPResourceReadResult> {
    if (!this.client || this.status !== "connected") {
      throw new Error("MCP 服务器未连接");
    }

    mcpLog(`mcp:${this.config.id}`, `读取资源: ${uri}`);

    try {
      const result = await this.executeWithSessionRecovery("read_resource", () =>
        this.runWithDeadline(
          "read_resource",
          (sdkClient, requestOptions) => sdkClient.readResource({ uri }, requestOptions),
          options,
        )
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
  async refresh(options: MCPExecutionOptions = {}): Promise<void> {
    if (this.status !== "connected") {
      throw new Error("MCP 服务器未连接");
    }

    try {
      await this.discoverCapabilities(options);
    } catch (error) {
      this.recordFailure(error, {
        source: this.getFailureSource(error, "list_tools"),
        retryable: this.classifyFailureKind(error) === "transport",
      });
      if (this.isConnectionInterruption(error)) {
        this.setStatus("error");
      }
      throw error;
    }
    
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
  private async createSSETransport(
    config: MCPServerConfig["transport"] & { type: "sse" }
  ): Promise<Transport> {
    mcpLog(`mcp:${this.config.id}`, `创建 SSE 传输: ${config.url}`);

    // 先校验初始流地址，再由同一个 fetch 包装器复核重定向和后续 JSON-RPC POST。
    const outboundPolicy = new OutboundRequestPolicy({
      allowInsecureHttp: config.allowInsecureHttp === true,
      allowPrivateNetwork: config.allowPrivateNetwork === true,
    });
    await outboundPolicy.resolveAllowedAddresses(config.url);
    const outboundFetch = createMcpSseOutboundFetch(outboundPolicy);

    const transport = new SSEClientTransport(
      new URL(config.url),
      {
        eventSourceInit: { fetch: outboundFetch },
        requestInit: config.headers
          ? { headers: config.headers }
          : undefined,
        fetch: outboundFetch,
      }
    );

    return transport;
  }

  /**
   * 发现服务器能力（工具和资源）
   */
  private async discoverCapabilities(options: MCPExecutionOptions = {}): Promise<void> {
    if (!this.client) return;

    // 发现工具
    try {
      const toolsResult = await this.runWithDeadline(
        "list_tools",
        (sdkClient, requestOptions) => sdkClient.listTools(undefined, requestOptions),
        options,
      );
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
      } else if (this.isConnectionInterruption(err)) {
        throw err;
      } else {
        this.recordFailure(err, { updateCurrentError: false, source: "list_tools" });
        mcpWarn(`mcp:${this.config.id}`, "无法列出工具", err);
        this.tools = [];
      }
    }

    // 发现资源
    try {
      const resourcesResult = await this.runWithDeadline(
        "list_resources",
        (sdkClient, requestOptions) => sdkClient.listResources(undefined, requestOptions),
        options,
      );
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
      } else if (this.isConnectionInterruption(err)) {
        throw err;
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
   * 解析本次操作的有效 deadline：server 显式值优先，其次才是全局默认值。
   */
  private getOperationTimeoutMs(): number {
    return normalizeTimeoutMs(this.config.timeout, this.defaultTimeoutMs);
  }

  /**
   * 运行受 deadline 控制的 SDK 操作。外层 race 只负责及时返回；同时主动 abort 和关闭
   * 当前 lease，确保不支持 signal 的 transport/fake 也不会把后台工作遗留到下一次连接。
   */
  private async runWithDeadline<T>(
    source: MCPServerFailureSource,
    operation: (sdkClient: Client, requestOptions: RequestOptions) => Promise<T>,
    options: MCPExecutionOptions = {},
  ): Promise<T> {
    const sdkClient = this.client;
    if (!sdkClient) {
      throw new Error("MCP server is not connected.");
    }

    const lease: MCPConnectionLease = {
      client: sdkClient,
      transport: this.transport,
    };
    const timeoutMs = this.getOperationTimeoutMs();
    const requestController = new AbortController();
    let interrupted = false;
    let rejectInterruption!: (error: Error) => void;
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
    });
    const interrupt = (error: Error) => {
      if (interrupted) {
        return;
      }
      interrupted = true;
      requestController.abort(error);
      rejectInterruption(error);
    };

    const callerSignal = options.signal;
    const onCallerAbort = () => interrupt(new MCPAbortError(source));
    if (callerSignal?.aborted) {
      onCallerAbort();
    } else {
      callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    }

    const deadlineError = new MCPDeadlineError(source, timeoutMs);
    const timeout = setTimeout(() => {
      interrupt(deadlineError);
    }, timeoutMs);
    const requestOptions: RequestOptions = {
      signal: requestController.signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    };
    const operationPromise = Promise.resolve().then(() => {
      if (requestController.signal.aborted) {
        throw requestController.signal.reason instanceof Error
          ? requestController.signal.reason
          : deadlineError;
      }
      return operation(sdkClient, requestOptions);
    });

    try {
      return await Promise.race([operationPromise, interruption]);
    } catch (error) {
      const interruptionError = requestController.signal.reason instanceof Error
        ? requestController.signal.reason
        : undefined;
      const terminalError = interrupted
        ? interruptionError ?? deadlineError
        : this.isSdkRequestTimeout(error)
          ? deadlineError
          : undefined;
      if (!terminalError) {
        throw error;
      }

      if (!requestController.signal.aborted) {
        requestController.abort(terminalError);
      }
      await this.cleanupLeaseIfCurrent(lease);
      throw terminalError;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  private async cleanupLeaseIfCurrent(lease: MCPConnectionLease): Promise<void> {
    if (this.client !== lease.client || this.transport !== lease.transport) {
      return;
    }
    await this.cleanup({ waitForClose: false });
  }

  private isConnectionInterruption(error: unknown): error is MCPDeadlineError | MCPAbortError {
    return error instanceof MCPDeadlineError || error instanceof MCPAbortError;
  }

  private isSdkRequestTimeout(error: unknown): boolean {
    if (error instanceof MCPDeadlineError) {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized.includes("request timed out") || normalized.includes("maximum total timeout");
  }

  private getFailureSource(
    error: unknown,
    fallback: MCPServerFailureSource,
  ): MCPServerFailureSource {
    return this.isConnectionInterruption(error) ? error.source : fallback;
  }

  /**
   * 清理资源
   */
  private async cleanup(options: { waitForClose?: boolean } = {}): Promise<void> {
    // 先摘除所有权，迟到 close/error 不能把新连接的引用清掉。
    const sdkClient = this.client;
    const transport = this.transport;
    const childProcess = this.childProcess;
    this.client = null;
    this.transport = null;
    this.childProcess = null;

    // 清空缓存
    this.tools = [];
    this.resources = [];
    this.metadata = undefined;
    this.connectedAt = undefined;

    // 同时启动 transport 与 SDK close，避免 client.close 卡住时延迟真实 socket/process 关闭。
    const closeOperations: Promise<void>[] = [];
    if (transport) {
      try {
        closeOperations.push(Promise.resolve(transport.close()).catch((err) => {
          mcpWarn(`mcp:${this.config.id}`, "关闭传输时出错", err);
        }));
      } catch (err) {
        mcpWarn(`mcp:${this.config.id}`, "关闭传输时出错", err);
      }
    }
    if (sdkClient) {
      try {
        closeOperations.push(Promise.resolve(sdkClient.close()).catch((err) => {
          mcpWarn(`mcp:${this.config.id}`, "关闭客户端时出错", err);
        }));
      } catch (err) {
        mcpWarn(`mcp:${this.config.id}`, "关闭客户端时出错", err);
      }
    }
    if (childProcess) {
      try {
        childProcess.kill();
      } catch (err) {
        mcpWarn(`mcp:${this.config.id}`, "终止子进程时出错", err);
      }
    }

    const closed = Promise.all(closeOperations);
    if (options.waitForClose !== false) {
      await closed;
    } else {
      void closed;
    }
  }

  private async runReconnectLoop(): Promise<void> {
    const maxRetries = this.config.retryCount ?? 3;
    const initialDelay = this.config.retryDelay ?? 1000;

    while (!this.reconnectCancelled) {
      if (this.reconnectCount >= maxRetries) {
        mcpError(`mcp:${this.config.id}`, "已达到最大重试次数");
        this.error = "重连失败：已达到最大重试次数";
        this.recordFailure(new Error(this.error), { source: "connect", retryable: false });
        this.setStatus("error");
        return;
      }

      this.reconnectCount++;
      const delay = calculateMCPReconnectDelay(this.reconnectCount, initialDelay);
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
      } catch (error) {
        if (this.reconnectCancelled) {
          return;
        }
        if (error instanceof OutboundRequestPolicyError) {
          mcpWarn(`mcp:${this.config.id}`, "MCP SSE 出站策略拒绝重连，停止重试");
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
    if (error instanceof MCPAbortError) {
      return "cancelled";
    }
    if (error instanceof MCPDeadlineError) {
      return "transport";
    }
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
        if (this.isConnectionInterruption(error)) {
          // deadline/调用方取消已清理当前 lease，状态不能继续显示为 connected。
          this.setStatus("error");
        }
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
    const originalBytes = Buffer.byteLength(text, "utf-8");
    const hardLimited = originalBytes > MAX_PERSISTED_TEXT_BYTES;
    const persistedText = hardLimited
      ? truncateUtf8TextByBytes(text, MAX_PERSISTED_TEXT_BYTES)
      : { text, bytes: originalBytes };
    const persisted = await this.persistLargeText(persistedText.text, input.persistId, input.mimeType);
    if (persisted) {
      const preview = persistedText.text.slice(0, 2000);
      const note = hardLimited
        ? buildHardLimitedPersistedOutputNote({
            originalBytes,
            keptBytes: persistedText.bytes,
            webPath: persisted.webPath,
            preview,
          })
        : buildPersistedOutputNote({
            originalLength: text.length,
            webPath: persisted.webPath,
            preview,
          });
      return {
        text: note,
        truncated: hardLimited,
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
    const decoded = Buffer.from(value, "base64");
    const originalBytes = decoded.byteLength;
    const hardLimited = originalBytes > MAX_PERSISTED_BINARY_BYTES;
    const persistedBuffer = hardLimited ? decoded.subarray(0, MAX_PERSISTED_BINARY_BYTES) : decoded;
    const persisted = await this.persistLargeBinary(persistedBuffer, input.persistId, input.mimeType);
    if (persisted) {
      const note = hardLimited
        ? buildHardLimitedPersistedOutputNote({
            originalBytes,
            keptBytes: persistedBuffer.byteLength,
            webPath: persisted.webPath,
          })
        : buildPersistedOutputNote({
            originalLength: value.length,
            webPath: persisted.webPath,
          });
      return {
        value: undefined,
        truncated: hardLimited,
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
    value: string | Buffer,
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
      await fs.writeFile(filepath, Buffer.isBuffer(value) ? value : Buffer.from(value, "base64"));
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
