/**
 * Belldandy 钩子系统
 *
 * 提供 13 种生命周期钩子，覆盖 Agent、消息、工具、会话、网关等场景。
 * 支持优先级排序、双执行模式（并行/顺序）、错误处理选项。
 */

import type { JsonObject } from "@belldandy/protocol";
import type { AgentPromptDelta } from "./prompt-snapshot.js";
import type { AgentRunInput, AgentStreamItem } from "./index.js";

// ============================================================================
// 钩子名称
// ============================================================================

/**
 * 所有钩子名称的联合类型
 */
export type HookName =
  // Agent 钩子
  | "before_agent_start"
  | "agent_end"
  | "before_compaction"
  | "after_compaction"
  // 消息钩子
  | "message_received"
  | "message_sending"
  | "message_sent"
  // 工具钩子
  | "before_tool_call"
  | "after_tool_call"
  | "tool_result_persist"
  // 会话钩子
  | "session_start"
  | "session_end"
  // 网关钩子
  | "gateway_start"
  | "gateway_stop";

// ============================================================================
// 上下文类型
// ============================================================================

/**
 * Agent 钩子上下文
 */
export interface HookAgentContext {
  /** Agent 标识符 */
  agentId?: string;
  /** 会话标识符 */
  sessionKey?: string;
  /** 工作区目录 */
  workspaceDir?: string;
  /** 消息提供者（如 discord、feishu 等） */
  messageProvider?: string;
  /** 当前 Agent run 的调用方取消信号；支持取消的前置 Hook 应停止自身等待。 */
  abortSignal?: AbortSignal;
}

/**
 * 消息钩子上下文
 */
export interface HookMessageContext {
  /** 频道/聊天 ID */
  channelId: string;
  /** 账户 ID */
  accountId?: string;
  /** 会话 ID */
  conversationId?: string;
}

/**
 * 工具钩子上下文
 */
export interface HookToolContext {
  /** Agent 标识符 */
  agentId?: string;
  /** 会话标识符 */
  sessionKey?: string;
  /** 工具名称 */
  toolName: string;
}

/**
 * 工具结果持久化钩子上下文
 */
export interface HookToolResultPersistContext {
  /** Agent 标识符 */
  agentId?: string;
  /** 会话标识符 */
  sessionKey?: string;
  /** 工具名称 */
  toolName?: string;
  /** 工具调用 ID */
  toolCallId?: string;
}

/**
 * 会话钩子上下文
 */
export interface HookSessionContext {
  /** Agent 标识符 */
  agentId?: string;
  /** 会话 ID */
  sessionId: string;
  /** 会话终止信号；支持取消的 Hook 应及时停止自身等待或外部 I/O。 */
  abortSignal?: AbortSignal;
}

/**
 * 网关钩子上下文
 */
export interface HookGatewayContext {
  /** 网关端口 */
  port?: number;
}

// ============================================================================
// 事件类型
// ============================================================================

// ----- Agent 钩子事件 -----

/**
 * before_agent_start 钩子事件
 *
 * 在 Agent 开始处理请求之前触发。
 */
export interface BeforeAgentStartEvent {
  /** 用户输入的 prompt */
  prompt: string;
  /** 历史消息（可选） */
  messages?: unknown[];
  /** 用户原始输入（用于语义召回；可选，缺失时可回退到 prompt） */
  userInput?: string;
  /** 透传的运行元信息（如父会话 ID） */
  meta?: JsonObject;
}

/**
 * before_agent_start 钩子返回值
 *
 * 可用于注入系统提示词或上下文。
 */
export interface BeforeAgentStartResult {
  /** 替换或追加的系统提示词 */
  systemPrompt?: string;
  /** 前置上下文（会拼接到消息前） */
  prependContext?: string;
  /** 结构化 prompt delta（双写阶段可选） */
  deltas?: AgentPromptDelta[];
}

/**
 * agent_end 钩子事件
 *
 * 在 Agent 完成运行后触发（无论成功还是失败）。
 */
export interface AgentEndEvent {
  /** 生成的消息列表 */
  messages: unknown[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如有） */
  error?: string;
  /** 运行时长（毫秒） */
  durationMs?: number;
  /** 长运行 Hook 账本的有界摘要；短运行保持完整 messages 行为。 */
  summary?: {
    truncated: boolean;
    eventCount: number;
    retainedEventCount: number;
    droppedEventCount: number;
    totalDeltaChars: number;
  };
}

export type CompactionMode =
  | "request"
  | "loop"
  | "manual"
  | "partial_up_to"
  | "partial_from"
  | "session_memory"
  | "microcompact";

/**
 * before_compaction 钩子事件
 *
 * 在上下文压缩之前触发。
 */
export interface BeforeCompactionEvent {
  /** 当前消息数量 */
  messageCount: number;
  /** 当前 token 数量（如有） */
  tokenCount?: number;
  /** 压缩层级：rolling（滚动摘要）或 archival（归档压缩） */
  tier?: "rolling" | "archival";
  /** 触发来源 */
  source?: CompactionMode;
  /** 压缩模式 */
  compactionMode?: CompactionMode;
  /** 本轮预计处理的增量消息数 */
  deltaMessageCount?: number;
  /** 使用的摘要模型（如有） */
  summarizerModel?: string;
}

/**
 * after_compaction 钩子事件
 *
 * 在上下文压缩之后触发。
 */
export interface AfterCompactionEvent {
  /** 压缩后消息数量 */
  messageCount: number;
  /** 压缩后 token 数量（如有） */
  tokenCount?: number;
  /** 被压缩的消息数量 */
  compactedCount: number;
  /** 压缩层级 */
  tier?: "rolling" | "archival";
  /** 触发来源 */
  source?: CompactionMode;
  /** 压缩模式 */
  compactionMode?: CompactionMode;
  /** 压缩前 token 数量 */
  originalTokenCount?: number;
  /** 本轮实际处理的增量消息数 */
  deltaMessageCount?: number;
  /** 是否走了 fallback 摘要路径 */
  fallbackUsed?: boolean;
  /** 使用的摘要模型（如有） */
  summarizerModel?: string;
  /** 本轮节省的 token 数 */
  savedTokenCount?: number;
  /** 本轮回收的字符数（适用于 microcompact） */
  reclaimedChars?: number;
  /** 是否因边界失效触发了安全重建 */
  rebuildTriggered?: boolean;
}

// ----- 消息钩子事件 -----

/**
 * message_received 钩子事件
 *
 * 当收到消息时触发。
 */
export interface MessageReceivedEvent {
  /** 发送者标识 */
  from: string;
  /** 消息内容 */
  content: string;
  /** 时间戳（毫秒） */
  timestamp?: number;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * message_sending 钩子事件
 *
 * 在发送消息之前触发。
 */
export interface MessageSendingEvent {
  /** 接收者标识 */
  to: string;
  /** 消息内容 */
  content: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * message_sending 钩子返回值
 *
 * 可用于修改或取消消息发送。
 */
export interface MessageSendingResult {
  /** 修改后的消息内容 */
  content?: string;
  /** 是否取消发送 */
  cancel?: boolean;
}

/**
 * message_sent 钩子事件
 *
 * 在消息发送完成后触发。
 */
export interface MessageSentEvent {
  /** 接收者标识 */
  to: string;
  /** 消息内容 */
  content: string;
  /** 是否发送成功 */
  success: boolean;
  /** 错误信息（如有） */
  error?: string;
}

// ----- 工具钩子事件 -----

/**
 * before_tool_call 钩子事件
 *
 * 在工具执行之前触发。
 */
export interface BeforeToolCallEvent {
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  params: Record<string, unknown>;
}

/**
 * before_tool_call 钩子返回值
 *
 * 可用于修改参数或阻止执行。
 */
export interface BeforeToolCallResult {
  /** 修改后的参数 */
  params?: Record<string, unknown>;
  /** 是否阻止执行 */
  block?: boolean;
  /** 阻止原因 */
  blockReason?: string;
  /** 是否跳过本次实际工具执行，并返回一条合成结果给模型 */
  skipExecution?: boolean;
  /** 跳过执行时返回给模型的合成工具结果 */
  syntheticResult?: string;
}

/**
 * after_tool_call 钩子事件
 *
 * 在工具执行完成后触发。
 */
export interface AfterToolCallEvent {
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  params: Record<string, unknown>;
  /** 执行结果 */
  result?: unknown;
  /** 错误信息（如有） */
  error?: string;
  /** 执行时长（毫秒） */
  durationMs?: number;
}

/**
 * tool_result_persist 钩子事件
 *
 * 在工具结果持久化到 transcript 之前触发（同步钩子）。
 */
export interface ToolResultPersistEvent {
  /** 工具名称 */
  toolName?: string;
  /** 工具调用 ID */
  toolCallId?: string;
  /** 即将写入的消息对象 */
  message: JsonObject;
  /** 是否为合成结果（如 guard/repair 步骤生成） */
  isSynthetic?: boolean;
}

/**
 * tool_result_persist 钩子返回值
 *
 * 可用于修改持久化的消息内容。
 */
export interface ToolResultPersistResult {
  /** 修改后的消息对象 */
  message?: JsonObject;
}

// ----- 会话钩子事件 -----

/**
 * session_start 钩子事件
 *
 * 在会话开始时触发。
 */
export interface SessionStartEvent {
  /** 会话 ID */
  sessionId: string;
  /** 如果是恢复的会话，原会话 ID */
  resumedFrom?: string;
}

/**
 * session_end 钩子事件
 *
 * 在会话结束时触发。
 */
export interface SessionEndEvent {
  /** 会话 ID */
  sessionId: string;
  /** 消息数量 */
  messageCount: number;
  /** 会话时长（毫秒） */
  durationMs?: number;
}

// ----- 网关钩子事件 -----

/**
 * gateway_start 钩子事件
 *
 * 在网关服务启动时触发。
 */
export interface GatewayStartEvent {
  /** 监听端口 */
  port: number;
}

/**
 * gateway_stop 钩子事件
 *
 * 在网关服务停止时触发。
 */
export interface GatewayStopEvent {
  /** 停止原因 */
  reason?: string;
}

// ============================================================================
// 钩子处理函数映射
// ============================================================================

/**
 * 钩子处理函数类型映射
 */
export interface HookHandlerMap {
  // Agent 钩子
  before_agent_start: (
    event: BeforeAgentStartEvent,
    ctx: HookAgentContext,
  ) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void;

  agent_end: (
    event: AgentEndEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;

  before_compaction: (
    event: BeforeCompactionEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;

  after_compaction: (
    event: AfterCompactionEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;

  // 消息钩子
  message_received: (
    event: MessageReceivedEvent,
    ctx: HookMessageContext,
  ) => Promise<void> | void;

  message_sending: (
    event: MessageSendingEvent,
    ctx: HookMessageContext,
  ) => Promise<MessageSendingResult | void> | MessageSendingResult | void;

  message_sent: (
    event: MessageSentEvent,
    ctx: HookMessageContext,
  ) => Promise<void> | void;

  // 工具钩子
  before_tool_call: (
    event: BeforeToolCallEvent,
    ctx: HookToolContext,
  ) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;

  after_tool_call: (
    event: AfterToolCallEvent,
    ctx: HookToolContext,
  ) => Promise<void> | void;

  tool_result_persist: (
    event: ToolResultPersistEvent,
    ctx: HookToolResultPersistContext,
  ) => ToolResultPersistResult | void; // 注意：同步钩子，不返回 Promise

  // 会话钩子
  session_start: (
    event: SessionStartEvent,
    ctx: HookSessionContext,
  ) => Promise<void> | void;

  session_end: (
    event: SessionEndEvent,
    ctx: HookSessionContext,
  ) => Promise<void> | void;

  // 网关钩子
  gateway_start: (
    event: GatewayStartEvent,
    ctx: HookGatewayContext,
  ) => Promise<void> | void;

  gateway_stop: (
    event: GatewayStopEvent,
    ctx: HookGatewayContext,
  ) => Promise<void> | void;
}

// ============================================================================
// 钩子注册
// ============================================================================

/**
 * 钩子注册项
 */
export interface HookRegistration<K extends HookName = HookName> {
  /** 注册来源标识（插件 ID 或模块名） */
  source: string;
  /** 钩子名称 */
  hookName: K;
  /** 处理函数 */
  handler: HookHandlerMap[K];
  /** 优先级（越高越先执行，默认 0） */
  priority?: number;
}

/**
 * 钩子注册表
 *
 * 存储所有已注册的钩子处理函数。
 */
export class HookRegistry {
  private readonly hooks: HookRegistration[] = [];

  /**
   * 注册钩子
   */
  register<K extends HookName>(registration: HookRegistration<K>): void {
    this.hooks.push(registration as HookRegistration);
  }

  /**
   * 注销钩子
   */
  unregister(source: string, hookName?: HookName): void {
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.source === source && (!hookName || hook.hookName === hookName)) {
        this.hooks.splice(i, 1);
      }
    }
  }

  /**
   * 获取指定名称的钩子（按优先级排序，高优先级在前）
   */
  getHooks<K extends HookName>(hookName: K): HookRegistration<K>[] {
    return (this.hooks as HookRegistration<K>[])
      .filter((h) => h.hookName === hookName)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * 检查是否有指定名称的钩子
   */
  hasHooks(hookName: HookName): boolean {
    return this.hooks.some((h) => h.hookName === hookName);
  }

  /**
   * 获取指定名称的钩子数量
   */
  getHookCount(hookName: HookName): number {
    return this.hooks.filter((h) => h.hookName === hookName).length;
  }

  /**
   * 清空所有钩子
   */
  clear(): void {
    this.hooks.length = 0;
  }

  /**
   * 获取所有已注册的钩子（用于调试）
   */
  getAllHooks(): ReadonlyArray<HookRegistration> {
    return this.hooks;
  }
}

// ============================================================================
// 向后兼容：简化版 Agent 钩子接口
// ============================================================================

/**
 * 简化版钩子上下文（向后兼容）
 *
 * @deprecated 建议使用 HookAgentContext
 */
export interface AgentHookContext {
  /** Agent 标识符 */
  agentId?: string;
  /** 会话标识符 */
  conversationId: string;
}

/**
 * beforeRun 钩子事件（向后兼容）
 *
 * @deprecated 建议使用 BeforeAgentStartEvent
 */
export interface BeforeRunEvent {
  /** Agent 运行输入 */
  input: AgentRunInput;
}

/**
 * afterRun 钩子事件（向后兼容）
 *
 * @deprecated 建议使用 AgentEndEvent
 */
export interface AfterRunEvent {
  /** Agent 运行输入 */
  input: AgentRunInput;
  /** 生成的所有流式输出项 */
  items: AgentStreamItem[];
}

/**
 * beforeToolCall 钩子事件（向后兼容）
 *
 * @deprecated 建议使用 BeforeToolCallEvent
 */
export interface LegacyBeforeToolCallEvent {
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  arguments: JsonObject;
  /** 工具调用 ID */
  id: string;
}

/**
 * afterToolCall 钩子事件（向后兼容）
 *
 * @deprecated 建议使用 AfterToolCallEvent
 */
export interface LegacyAfterToolCallEvent {
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  arguments: JsonObject;
  /** 工具执行结果 */
  result: string | JsonObject;
  /** 是否执行成功 */
  success: boolean;
  /** 错误信息（如有） */
  error?: string;
  /** 工具调用 ID */
  id: string;
}

/**
 * 简化版 Agent 钩子接口（向后兼容）
 *
 * 提供 Agent 生命周期中的关键拦截点，允许插件干预 Agent 的决策流程。
 *
 * @deprecated 建议使用 HookRegistry + HookRunner
 */
export interface AgentHooks {
  /**
   * 运行前钩子
   *
   * 在 Agent 开始处理请求之前调用。
   * 可用于：修改输入、注入上下文、记录日志等。
   *
   * @returns 返回 Partial<AgentRunInput> 可以修改输入
   */
  beforeRun?: (
    event: BeforeRunEvent,
    context: AgentHookContext,
  ) => Promise<void | Partial<AgentRunInput>> | void | Partial<AgentRunInput>;

  /**
   * 运行后钩子
   *
   * 在 Agent 完成运行后调用（无论成功还是失败）。
   * 可用于：分析对话、记录审计日志、触发后续操作等。
   */
  afterRun?: (
    event: AfterRunEvent,
    context: AgentHookContext,
  ) => Promise<void> | void;

  /**
   * 工具调用前钩子
   *
   * 在工具执行之前调用。
   * 可用于：参数校验、权限检查、参数修改、阻止危险操作等。
   *
   * @returns 返回 false 阻止执行，返回 JsonObject 修改参数
   */
  beforeToolCall?: (
    event: LegacyBeforeToolCallEvent,
    context: AgentHookContext,
  ) => Promise<boolean | JsonObject | void> | boolean | JsonObject | void;

  /**
   * 工具调用后钩子
   *
   * 在工具执行完成后调用。
   * 可用于：结果审计、日志记录、触发关联操作等。
   */
  afterToolCall?: (
    event: LegacyAfterToolCallEvent,
    context: AgentHookContext,
  ) => Promise<void> | void;
}
