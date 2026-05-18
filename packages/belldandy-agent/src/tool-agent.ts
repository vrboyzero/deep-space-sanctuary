/**
 * 工具增强型 Agent
 *
 * 支持工具调用的 Agent 实现，集成完整的钩子系统。
 */

import {
  evaluateRuntimeIdentityAuthority,
  type IdentityAuthorityProfile,
  type JsonObject,
} from "@belldandy/protocol";
import type { ToolExecutionRuntimeContext, ToolExecutor, ToolCallRequest, ToolFailureKind } from "@belldandy/skills";
import type { AgentRunInput, AgentStreamItem, AgentUsage, BelldandyAgent, AgentHooks } from "./index.js";
import type { HookRunner } from "./hook-runner.js";
import type { AfterCompactionEvent, BeforeCompactionEvent, HookAgentContext, HookToolContext, HookToolResultPersistContext } from "./hooks.js";
import { FailoverClient, type ModelProfile, type FailoverExecutionSummary, type FailoverLogger } from "./failover-client.js";
import { applyOpenAICompatibleReasoningConfig } from "./openai-reasoning.js";
import { buildUrl, preprocessMultimodalContent, type VideoUploadConfig } from "./multimodal.js";
import {
  buildAnthropicRequest,
  parseAnthropicResponse,
  type AnthropicUsage,
} from "./anthropic.js";
import type { OpenAIWireApi } from "./openai.js";
import { estimateTokens, estimateMessagesTokens, needsInLoopCompaction, compactIncremental, createEmptyCompactionState, type CompactionState, type CompactionOptions, type SummarizerFn } from "./compaction.js";
import type { CompactionRuntimeTracker } from "./compaction-runtime.js";
import { microcompactMessages, type MicrocompactOptions } from "./microcompact.js";
import {
  buildProviderNativeSystemBlocks,
  type ProviderNativeSystemBlock,
  type SystemPromptSection,
} from "./system-prompt.js";
import { TokenCounterService } from "./token-counter.js";
import { calculateUsageCostUsd, type ModelUsagePricing } from "./token-cost.js";
import type { ConversationStore, ActiveCounterSnapshot } from "./conversation.js";
import {
  createAgentPromptSnapshot,
  readPromptSnapshotDeltas,
  readPromptSnapshotRunId,
  type AgentPromptDelta,
  type AgentPromptSnapshot,
} from "./prompt-snapshot.js";
import {
  buildLaunchSpecPromptDeltas,
  buildToolResultPromptDeltas,
  collectSystemPromptDeltaTexts,
} from "./runtime-prompt-deltas.js";

type ApiProtocol = "openai" | "anthropic";
type CacheSupport = "supported" | "unsupported" | "unknown";
type ToolCallRepairLevel = "off" | "dedupe" | "full";
const MIN_MULTIMODAL_REQUEST_TIMEOUT_MS = 300_000;
const LARGE_TEXT_ATTACHMENT_TRIGGER_CHARS = 12_000;
const HUGE_TEXT_ATTACHMENT_TRIGGER_CHARS = 30_000;
const MIN_LARGE_TEXT_ATTACHMENT_TIMEOUT_MS = 120_000;
const MIN_HUGE_TEXT_ATTACHMENT_TIMEOUT_MS = 300_000;
const DATA_URI_BASE64_PREFIX_RE = /^data:([^;]+);base64,/i;
const BASE64_FIELD_KEY_RE = /^(base64|data)$/i;
const DEFAULT_REASONING_TRANSCRIPT_CHAR_LIMIT = 4_000;
const MIN_REASONING_DEDUPE_CHARS = 96;
const STOP_REQUESTED_ERROR = "__BELLDANDY_STOP_REQUESTED__";
const toolDefinitionTokenEstimateCache = new WeakMap<object, {
  name: string;
  description: string;
  tokens: number;
}>();

export type ToolEnabledAgentOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  toolExecutor: ToolExecutor;
  timeoutMs?: number;
  maxToolCalls?: number;
  /** 工具循环的模型调用轮次预算（<=0 关闭） */
  toolLoopIterationBudget?: number;
  /** 工具循环预算告警阈值（0-1，默认 0.7） */
  toolLoopWarningFraction?: number;
  systemPrompt?: string;
  systemPromptSections?: SystemPromptSection[];
  /** 简化版钩子接口（向后兼容） */
  hooks?: AgentHooks;
  /** 新版钩子运行器（推荐使用） */
  hookRunner?: HookRunner;
  /** 可选：统一 Logger，用于钩子失败等日志 */
  logger?: {
    debug?: (module: string, msg: string, data?: unknown) => void;
    info?: (module: string, msg: string, data?: unknown) => void;
    warn?: (module: string, msg: string, data?: unknown) => void;
    error: (module: string, msg: string, data?: unknown) => void;
  };
  /** 备用 Profile 列表（模型容灾） */
  fallbacks?: ModelProfile[];
  /** 容灾日志接口 */
  failoverLogger?: FailoverLogger;
  /** 视频文件上传专用配置（当聊天代理不支持 /files 端点时） */
  videoUploadConfig?: VideoUploadConfig;
  /** 强制指定 API 协议（默认自动检测） */
  protocol?: ApiProtocol;
  /** 最大输入 token 数限制（超过时自动裁剪历史消息，0 或不设表示不限制） */
  maxInputTokens?: number;
  /** 单次模型调用最大输出 token 数（默认 4096；调大可避免长输出被截断导致工具调用 JSON 损坏） */
  maxOutputTokens?: number;
  /** OpenAI 协议底层线路：chat.completions（默认）或 responses */
  wireApi?: OpenAIWireApi;
  /** 仅在 responses 模式下清洗工具 schema（移除不兼容关键字） */
  sanitizeResponsesToolSchema?: boolean;
  /** 同一 profile 最大重试次数（不含首次请求） */
  maxRetries?: number;
  /** 同一 profile 重试退避基线（毫秒） */
  retryBackoffMs?: number;
  /** 工具调用修复级别：off / dedupe / full */
  toolCallRepairLevel?: ToolCallRepairLevel;
  /** primary profile 专用代理 URL（可选） */
  proxyUrl?: string;
  /** OpenAI-compatible 思考模式配置（primary profile） */
  thinking?: Record<string, unknown>;
  /** OpenAI-compatible 推理强度（primary profile） */
  reasoningEffort?: string;
  /** OpenAI-compatible / provider-specific options（primary profile） */
  options?: Record<string, unknown>;
  /** 启动阶段预置冷却（毫秒） */
  bootstrapProfileCooldowns?: Record<string, number>;
  /** ReAct 循环内压缩配置（可选） */
  compaction?: CompactionOptions;
  /** 工具结果轻压缩配置（可选） */
  microcompact?: MicrocompactOptions;
  /** 模型摘要函数（用于循环内压缩） */
  summarizer?: SummarizerFn;
  /** 摘要模型名称（用于观测与 hook 事件） */
  summarizerModelName?: string;
  /** 压缩预算治理 / 熔断共享状态 */
  compactionRuntimeTracker?: CompactionRuntimeTracker;
  /** 会话存储（用于跨 run 持久化 token 计数器状态） */
  conversationStore?: ConversationStore;
  /** 模型 usage 价格表（用于估算 USD 成本） */
  usagePricing?: ModelUsagePricing;
  /** provider cache capability（用于观测） */
  cacheSupport?: CacheSupport;
  /** 记录本次 run 实际发给模型的 prompt snapshot */
  onPromptSnapshot?: (snapshot: AgentPromptSnapshot) => void;
  /** 预置到 prompt snapshot 的 system prompt 观测元数据 */
  systemPromptMetadata?: JsonObject;
  /** runtime resilience 观察回调 */
  onRuntimeResilienceEvent?: (event: {
    source: "tool_agent";
    phase: "tool_loop";
    agentId?: string;
    conversationId?: string;
    summary: FailoverExecutionSummary;
  }) => void;
  /** 当前 agent workspace 的结构化 authority profile（来自 IDENTITY.md） */
  identityAuthorityProfile?: IdentityAuthorityProfile;
};

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<any> }
  | { role: "assistant"; content?: string | null; tool_calls?: OpenAIToolCall[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export function estimateToolDefinitionTokens(tool: {
  type: "function";
  function: { name: string; description: string; parameters: object };
}): number {
  const parameters = tool.function.parameters;
  const cached = toolDefinitionTokenEstimateCache.get(parameters);
  if (cached && cached.name === tool.function.name && cached.description === tool.function.description) {
    return cached.tokens;
  }

  const tokens = estimateTokens(
    tool.function.name + tool.function.description + JSON.stringify(parameters),
  );
  toolDefinitionTokenEstimateCache.set(parameters, {
    name: tool.function.name,
    description: tool.function.description,
    tokens,
  });
  return tokens;
}

function hasMultimodalContentInMessages(messages: Message[]): boolean {
  return messages.some((m) =>
    m.role === "user" &&
    Array.isArray(m.content) &&
    m.content.some((part: any) => typeof part?.type === "string" && part.type !== "text")
  );
}

function readTextAttachmentChars(meta?: JsonObject): number {
  if (!meta || typeof meta !== "object") return 0;
  const stats = (meta as any).attachmentStats;
  const value = stats?.promptAugmentationChars ?? stats?.textAttachmentChars;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function applyPrependContextToInput(input: AgentRunInput, prependContext: string): AgentRunInput {
  const normalized = prependContext.trim();
  if (!normalized) return input;

  const nextText = input.text?.trim()
    ? `${normalized}\n\n${input.text}`
    : normalized;

  if (Array.isArray(input.content)) {
    const nextContent = [...input.content];
    const firstTextIndex = nextContent.findIndex((part: any) => part?.type === "text" && typeof part?.text === "string");
    if (firstTextIndex >= 0) {
      const current = nextContent[firstTextIndex] as { type: "text"; text: string };
      nextContent[firstTextIndex] = {
        ...current,
        text: current.text?.trim()
          ? `${normalized}\n\n${current.text}`
          : normalized,
      };
    } else {
      nextContent.unshift({ type: "text", text: normalized });
    }
    return { ...input, text: nextText, content: nextContent };
  }

  if (typeof input.content === "string") {
    return {
      ...input,
      text: nextText,
      content: input.content.trim()
        ? `${normalized}\n\n${input.content}`
        : normalized,
    };
  }

  return { ...input, text: nextText };
}

export function sanitizeAssistantToolCallHistoryContent(content?: string): string | undefined {
  if (typeof content !== "string") return undefined;
  const stripped = stripToolCallsSection(content);
  return stripped || undefined;
}

function normalizeTranscriptText(value?: string): string {
  if (typeof value !== "string") return "";
  return value
    .toLocaleLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateTranscript(candidate?: string, baseline?: string): boolean {
  const normalizedCandidate = normalizeTranscriptText(candidate);
  const normalizedBaseline = normalizeTranscriptText(baseline);
  if (
    normalizedCandidate.length < MIN_REASONING_DEDUPE_CHARS ||
    normalizedBaseline.length < MIN_REASONING_DEDUPE_CHARS
  ) {
    return false;
  }

  const shorterLength = Math.min(normalizedCandidate.length, normalizedBaseline.length);
  const longerLength = Math.max(normalizedCandidate.length, normalizedBaseline.length);
  if (shorterLength / longerLength < 0.72) {
    return false;
  }

  return normalizedBaseline.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedBaseline);
}

export function compactReasoningContentForHistory(
  content?: string,
  limit: number = DEFAULT_REASONING_TRANSCRIPT_CHAR_LIMIT,
  assistantContent?: string,
): string | undefined {
  if (typeof content !== "string") return undefined;
  const normalized = content.trim();
  if (!normalized) return undefined;
  if (isNearDuplicateTranscript(normalized, sanitizeAssistantToolCallHistoryContent(assistantContent) ?? assistantContent)) {
    return undefined;
  }
  if (!Number.isFinite(limit) || limit <= 0 || normalized.length <= limit) {
    return normalized;
  }

  const marker = `\n...[reasoning truncated, original=${normalized.length} chars]...\n`;
  if (limit <= marker.length + 16) {
    return normalized.slice(0, limit);
  }

  const remaining = limit - marker.length;
  const head = Math.max(8, Math.ceil(remaining * 0.7));
  const tail = Math.max(8, remaining - head);
  return `${normalized.slice(0, head)}${marker}${normalized.slice(Math.max(head, normalized.length - tail))}`;
}

function estimateMessageContentTokens(content: unknown): number {
  return estimateTokens(contentToTokenEstimateString(content) ?? "");
}

function estimateAssistantHistoryOverhead(message: Message): number {
  if (message.role !== "assistant") {
    return 0;
  }

  let total = 0;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    total += estimateTokens(JSON.stringify(message.tool_calls));
  }
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    total += estimateTokens(sanitizeStringForTokenEstimate(message.reasoning_content.trim()));
  }
  return total;
}

function readToolExecutionRuntimeContext(meta?: JsonObject): ToolExecutionRuntimeContext | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const launchSpec = (meta as Record<string, unknown>)._agentLaunchSpec;
  if (!launchSpec || typeof launchSpec !== "object" || Array.isArray(launchSpec)) {
    return undefined;
  }
  return {
    launchSpec: launchSpec as ToolExecutionRuntimeContext["launchSpec"],
  };
}

function estimateContextTokensFromMessages(
  messages: Message[],
  opts?: { includeSystem?: boolean; margin?: number },
): number {
  let total = 0;
  for (const message of messages) {
    if (!opts?.includeSystem && message.role === "system") {
      continue;
    }
    total += estimateMessageContentTokens(message.content) + 4;
    total += estimateAssistantHistoryOverhead(message);
  }
  if (opts?.margin && opts.margin > 0) {
    return Math.ceil(total * opts.margin);
  }
  return total;
}

function estimateSystemPromptTokens(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    if (message.role !== "system") {
      continue;
    }
    total += estimateMessageContentTokens(message.content);
  }
  return total;
}

function stringifyTranscriptContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactToolDigestText(value: unknown, limit: number = 180): string {
  const text = stringifyTranscriptContent(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function inferToolDigestTarget(args: JsonObject): string | undefined {
  const candidateKeys = ["path", "file", "filename", "url", "query", "command", "cwd", "sessionId"];
  for (const key of candidateKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return compactToolDigestText(value.trim(), 120);
    }
  }
  return undefined;
}

const RECENT_TOOL_RESULT_ARG_STRING_LIMIT = 160;
const RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT = 6;
const RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT = 12;
const RECENT_TOOL_RESULT_ARG_DEPTH_LIMIT = 3;

function compactRecentToolArgString(value: string, limit: number = RECENT_TOOL_RESULT_ARG_STRING_LIMIT): string {
  const normalized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return normalized;
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function projectRecentToolResultArgsValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return compactRecentToolArgString(value);
  }
  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || typeof value === "undefined"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const projectedItems = value
      .slice(0, RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT)
      .map((item) => projectRecentToolResultArgsValue(item, depth + 1));
    if (value.length > RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT) {
      projectedItems.push(`[+${value.length - RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT} more items]`);
    }
    return projectedItems;
  }
  if (!value || typeof value !== "object") {
    return compactRecentToolArgString(String(value));
  }
  if (depth >= RECENT_TOOL_RESULT_ARG_DEPTH_LIMIT) {
    const keys = Object.keys(value as Record<string, unknown>);
    return `[object keys=${keys.length}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const projected: JsonObject = {};
  for (const [key, entryValue] of entries.slice(0, RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT)) {
    projected[key] = projectRecentToolResultArgsValue(entryValue, depth + 1) as JsonObject[keyof JsonObject];
  }
  if (entries.length > RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT) {
    projected.__truncatedKeys = entries.length - RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT;
  }
  return projected;
}

function projectRecentToolResultArgs(args: JsonObject): JsonObject {
  const projected = projectRecentToolResultArgsValue(args, 0);
  return projected && typeof projected === "object" && !Array.isArray(projected)
    ? projected as JsonObject
    : {};
}

function buildToolDigestRecord(input: {
  toolName: string;
  args: JsonObject;
  success: boolean;
  output?: string;
  error?: string;
  toolCallId?: string;
}) {
  const target = inferToolDigestTarget(input.args);
  const keyResult = input.success ? compactToolDigestText(input.output) : undefined;
  const errorSummary = input.success ? undefined : compactToolDigestText(input.error);
  const parts = [
    `${input.toolName} ${input.success ? "succeeded" : "failed"}`,
  ];
  if (target) parts.push(`target=${target}`);
  if (keyResult) parts.push(`result=${keyResult}`);
  if (errorSummary) parts.push(`error=${errorSummary}`);

  return {
    toolName: input.toolName,
    success: input.success,
    target,
    keyResult,
    errorSummary,
    summary: parts.join(" | "),
    toolCallId: input.toolCallId,
  };
}

export function buildToolTranscriptMessageForHistory(input: {
  toolCallId: string;
  toolName?: string;
  output?: unknown;
  error?: string;
  success: boolean;
  hookRunner?: Pick<HookRunner, "runToolResultPersist">;
  persistCtx?: HookToolResultPersistContext;
  isSynthetic?: boolean;
}): Message {
  let message: JsonObject = {
    role: "tool",
    tool_call_id: input.toolCallId,
    content: input.success
      ? stringifyTranscriptContent(input.output)
      : `错误：${input.error ?? "unknown error"}`,
  };

  if (input.hookRunner) {
    const hookRes = input.hookRunner.runToolResultPersist(
      {
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        message,
        isSynthetic: input.isSynthetic,
      },
      input.persistCtx ?? {
        toolName: input.toolName,
        toolCallId: input.toolCallId,
      },
    );
    if (hookRes?.message && typeof hookRes.message === "object") {
      message = hookRes.message;
    }
  }

  return {
    role: "tool",
    tool_call_id: typeof message.tool_call_id === "string" && message.tool_call_id.trim()
      ? message.tool_call_id
      : input.toolCallId,
    content: stringifyTranscriptContent(message.content),
  };
}

function resolveMinimumAdaptiveTimeoutMs(messages: Message[], textAttachmentChars: number): number | undefined {
  let minimumTimeoutMs = 0;

  if (hasMultimodalContentInMessages(messages)) {
    minimumTimeoutMs = Math.max(minimumTimeoutMs, MIN_MULTIMODAL_REQUEST_TIMEOUT_MS);
  }

  if (textAttachmentChars >= HUGE_TEXT_ATTACHMENT_TRIGGER_CHARS) {
    minimumTimeoutMs = Math.max(minimumTimeoutMs, MIN_HUGE_TEXT_ATTACHMENT_TIMEOUT_MS);
  } else if (textAttachmentChars >= LARGE_TEXT_ATTACHMENT_TRIGGER_CHARS) {
    minimumTimeoutMs = Math.max(minimumTimeoutMs, MIN_LARGE_TEXT_ATTACHMENT_TIMEOUT_MS);
  }

  return minimumTimeoutMs > 0 ? minimumTimeoutMs : undefined;
}

function isRunStopRequested(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function readRunStopReason(signal?: AbortSignal): string {
  const reason = signal?.reason;
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  return "Stopped by user.";
}

function normalizeToolLoopIterationBudget(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 64;
  }
  return value <= 0 ? 0 : Math.max(1, Math.floor(value));
}

function normalizeToolLoopWarningFraction(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.7;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeToolCallRepairLevel(value: ToolCallRepairLevel | undefined): ToolCallRepairLevel {
  switch (value) {
    case "off":
    case "dedupe":
    case "full":
      return value;
    default:
      return "off";
  }
}

function buildIterationBudgetWarningDelta(currentIteration: number, budget: number): AgentPromptDelta {
  return {
    id: "iteration-budget-warning",
    deltaType: "iteration-budget-warning",
    role: "system",
    source: "tool-agent",
    text: [
      "## Iteration Budget Warning",
      `You are approaching the tool-loop budget (${currentIteration}/${budget}).`,
      "Prefer concluding, summarizing, or reducing tool usage in the next turn.",
    ].join("\n"),
    metadata: {
      currentIteration,
      budget,
    },
  };
}

function buildRecentToolResultRecord(input: {
  toolName: string;
  args: JsonObject;
  success: boolean;
  output?: string;
  error?: string;
  failureKind?: ToolFailureKind;
  toolCallId?: string;
  isSynthetic?: boolean;
}) {
  const digest = buildToolDigestRecord(input);
  return {
    toolCallId: input.toolCallId ?? "",
    toolName: input.toolName,
    success: input.success,
    summary: digest.summary,
    content: input.output,
    error: input.error,
    failureKind: input.failureKind,
    target: digest.target,
    args: projectRecentToolResultArgs(input.args),
    isSynthetic: input.isSynthetic,
  };
}

function cloneJsonObject<T extends JsonObject | undefined>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordToolResultArtifacts(input: {
  conversationStore?: ConversationStore;
  conversationId: string;
  toolName: string;
  args: JsonObject;
  success: boolean;
  output?: string;
  error?: string;
  failureKind?: ToolFailureKind;
  toolCallId?: string;
  isSynthetic?: boolean;
}): void {
  if (!input.conversationStore) return;
  input.conversationStore.recordToolDigest(input.conversationId, buildToolDigestRecord({
    toolName: input.toolName,
    args: input.args,
    success: input.success,
    output: input.output,
    error: input.error,
    toolCallId: input.toolCallId,
  }));
  input.conversationStore.recordRecentToolResult(input.conversationId, buildRecentToolResultRecord({
    toolName: input.toolName,
    args: input.args,
    success: input.success,
    output: input.output,
    error: input.error,
    failureKind: input.failureKind,
    toolCallId: input.toolCallId,
    isSynthetic: input.isSynthetic,
  }));
}

function buildRecoveredDuplicateToolResult(input: {
  duplicateToolCallId: string;
  toolName: string;
  previousToolCallId?: string;
  output: string;
  args: JsonObject;
}) {
  return {
    id: input.duplicateToolCallId,
    name: input.toolName,
    success: true,
    output: input.output,
    metadata: {
      repairAction: "duplicate_tool_call_reused_recent_result",
      previousToolCallId: input.previousToolCallId,
      recoveredFrom: input.previousToolCallId || "recent_success",
      reusedSummary: compactToolDigestText(input.output, 220),
      reusedArgs: cloneJsonObject(input.args),
    } as JsonObject,
  };
}

export class ToolEnabledAgent implements BelldandyAgent {
  private conversationRunChains = new Map<string, Promise<void>>();
  private readonly opts: Required<Pick<ToolEnabledAgentOptions, "timeoutMs" | "maxToolCalls" | "toolLoopIterationBudget" | "toolLoopWarningFraction" | "wireApi" | "maxRetries" | "retryBackoffMs" | "sanitizeResponsesToolSchema" | "toolCallRepairLevel">> &
    Omit<ToolEnabledAgentOptions, "timeoutMs" | "maxToolCalls" | "toolLoopIterationBudget" | "toolLoopWarningFraction" | "wireApi" | "maxRetries" | "retryBackoffMs" | "sanitizeResponsesToolSchema" | "toolCallRepairLevel">;
  private readonly failoverClient: FailoverClient;

  constructor(opts: ToolEnabledAgentOptions) {
    this.opts = {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 120_000,
      maxToolCalls: opts.maxToolCalls ?? 999999,
      toolLoopIterationBudget: normalizeToolLoopIterationBudget(opts.toolLoopIterationBudget),
      toolLoopWarningFraction: normalizeToolLoopWarningFraction(opts.toolLoopWarningFraction),
      wireApi: opts.wireApi ?? "chat_completions",
      sanitizeResponsesToolSchema: opts.sanitizeResponsesToolSchema ?? false,
      maxRetries: opts.maxRetries ?? 0,
      retryBackoffMs: opts.retryBackoffMs ?? 300,
      toolCallRepairLevel: normalizeToolCallRepairLevel(opts.toolCallRepairLevel),
    };

    // 初始化容灾客户端
    this.failoverClient = new FailoverClient({
      primary: {
        id: "primary",
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
        proxyUrl: opts.proxyUrl,
        thinking: opts.thinking,
        reasoningEffort: opts.reasoningEffort,
        options: opts.options,
      },
      fallbacks: opts.fallbacks,
      logger: opts.failoverLogger,
      bootstrapCooldowns: opts.bootstrapProfileCooldowns,
    });
  }

  private async withStageTimeout<T>(label: string, task: Promise<T>): Promise<T> {
    const timeoutMs = this.opts.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return task;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private buildCompactionHookContext(conversationId?: string, agentId?: string): HookAgentContext {
    return {
      agentId,
      sessionKey: conversationId,
    };
  }

  private async emitBeforeCompaction(
    event: BeforeCompactionEvent,
    conversationId?: string,
    agentId?: string,
  ): Promise<void> {
    if (!this.opts.hookRunner || typeof this.opts.hookRunner.runBeforeCompaction !== "function") return;
    try {
      await this.withStageTimeout(
        "before_compaction",
        this.opts.hookRunner.runBeforeCompaction(
          event,
          this.buildCompactionHookContext(conversationId, agentId),
        ),
      );
    } catch (err) {
      this.opts.logger?.error("agent", `钩子 before_compaction 执行失败: ${err}`, undefined);
    }
  }

  private async emitAfterCompaction(
    event: AfterCompactionEvent,
    conversationId?: string,
    agentId?: string,
  ): Promise<void> {
    if (!this.opts.hookRunner || typeof this.opts.hookRunner.runAfterCompaction !== "function") return;
    try {
      await this.withStageTimeout(
        "after_compaction",
        this.opts.hookRunner.runAfterCompaction(
          event,
          this.buildCompactionHookContext(conversationId, agentId),
        ),
      );
    } catch (err) {
      this.opts.logger?.error("agent", `钩子 after_compaction 执行失败: ${err}`, undefined);
    }
  }

  private async acquireConversationRunSlot(conversationId?: string): Promise<() => void> {
    if (!conversationId) {
      return () => {};
    }

    const hadPrevious = this.conversationRunChains.has(conversationId);
    const waitStartedAt = hadPrevious ? Date.now() : 0;
    const previous = this.conversationRunChains.get(conversationId) ?? Promise.resolve();
    const waitForPrevious = previous.catch(() => undefined);
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const chain = waitForPrevious.then(() => current);
    this.conversationRunChains.set(conversationId, chain);
    if (hadPrevious) {
      this.opts.logger?.debug?.("agent", "Waiting for previous conversation run slot", {
        conversationId,
      });
    }
    await waitForPrevious;
    if (hadPrevious) {
      this.opts.logger?.debug?.("agent", "Acquired conversation run slot after wait", {
        conversationId,
        waitMs: Date.now() - waitStartedAt,
      });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (this.conversationRunChains.get(conversationId) === chain) {
        this.conversationRunChains.delete(conversationId);
      }
    };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
    const startTime = Date.now();
    const runtimeContext = readToolExecutionRuntimeContext(input.meta);
    const resolvedAgentId = input.agentId ?? runtimeContext?.launchSpec?.agentId ?? runtimeContext?.launchSpec?.profileId ?? "tool-agent";
    let runSystemPrompt = this.opts.systemPrompt;
    let hookSystemPromptUsed = false;
    let prependContext: string | undefined;
    let hookPromptDeltas: AgentPromptDelta[] | undefined;
    const legacyHookCtx = { agentId: resolvedAgentId, conversationId: input.conversationId };

    // 新版钩子上下文
    const agentHookCtx: HookAgentContext = {
      agentId: resolvedAgentId,
      sessionKey: input.conversationId,
    };

    const releaseConversationRunSlot = await this.acquireConversationRunSlot(input.conversationId);
    try {
      // Hook: beforeRun / before_agent_start
      // 优先使用新版 hookRunner，向后兼容旧版 hooks
      if (this.opts.hookRunner) {
        try {
          const normalizedPrompt = typeof input.content === "string" ? input.content : input.text;
          const normalizedUserInput = input.userInput?.trim() || normalizedPrompt;
          const hookRes = await this.withStageTimeout(
            "before_agent_start",
            this.opts.hookRunner.runBeforeAgentStart(
              { prompt: normalizedPrompt, messages: input.history as any, userInput: normalizedUserInput, meta: input.meta }, // TODO: Update hook types for multimodal
              agentHookCtx,
            ),
          );
          if (hookRes) {
            // 注入系统提示词前置上下文
            if (hookRes.prependContext) {
              prependContext = hookRes.prependContext;
              input = applyPrependContextToInput(input, hookRes.prependContext);
            }
            if (hookRes.deltas && hookRes.deltas.length > 0) {
              hookPromptDeltas = hookRes.deltas.map((delta) => ({ ...delta }));
            }
            if (typeof hookRes.systemPrompt === "string") {
              hookSystemPromptUsed = true;
              runSystemPrompt = hookRes.systemPrompt;
            }
          }
        } catch (err) {
          yield { type: "status", status: "error" };
          yield { type: "final", text: `钩子 before_agent_start 执行失败: ${err}` };
          return;
        }
      } else if (this.opts.hooks?.beforeRun) {
        // 向后兼容：旧版 hooks
        try {
          const hookRes = await this.withStageTimeout(
            "beforeRun",
            Promise.resolve(this.opts.hooks.beforeRun({ input }, legacyHookCtx)),
          );
          if (hookRes && typeof hookRes === "object") {
            input = { ...input, ...hookRes };
          }
        } catch (err) {
          yield { type: "status", status: "error" };
          yield { type: "final", text: `Hook beforeRun failed: ${err}` };
          return;
        }
      }

      if (isRunStopRequested(input.abortSignal)) {
        yield { type: "status", status: "stopped" };
        return;
      }

      yield { type: "status", status: "running" };

      let content: string | Array<any> = input.content || input.text;

    // Preprocess: upload local videos to Moonshot
    const needsVideoUpload = Array.isArray(content) &&
      content.some((p: any) => p.type === "video_url" && p.video_url?.url?.startsWith("file://"));
    if (needsVideoUpload) {
      yield { type: "status", status: "uploading_video" as any };
      const profiles = this.failoverClient.getProfiles();
      const profile = profiles.find(p => p.id === "primary") || profiles[0];
      if (profile) {
        const result = await preprocessMultimodalContent(content, profile, this.opts.videoUploadConfig);
        content = result.content;
      }
    }

    const runtimeIdentityDelta = buildRuntimeIdentityPromptDelta({
      userUuid: input.userUuid,
      senderInfo: input.senderInfo,
      roomContext: input.roomContext,
    });
    const runtimeIdentityAuthorityDelta = buildRuntimeIdentityAuthorityPromptDelta({
      authorityProfile: this.opts.identityAuthorityProfile,
      userUuid: input.userUuid,
      senderInfo: input.senderInfo,
      roomContext: input.roomContext,
      launchSpec: runtimeContext?.launchSpec,
    });
    const launchSpecPromptDeltas = buildLaunchSpecPromptDeltas(runtimeContext?.launchSpec);
    const metaPromptDeltas = readPromptSnapshotDeltas(input.meta);
    const baseRunPromptDeltas = collectRunPromptDeltas({
      hookPromptDeltas,
      runtimeIdentityDelta,
      runtimeIdentityAuthorityDelta,
      launchSpecPromptDeltas,
      metaPromptDeltas,
    });
    const messages: Message[] = buildInitialMessages(
      runSystemPrompt,
      content,
      input.history,
      baseRunPromptDeltas,
    );
    let pendingToolFollowupDeltas: AgentPromptDelta[] = [];
    let currentRunPromptDeltas = baseRunPromptDeltas.map((delta) => ({ ...delta }));
    let providerNativeSystemBlocks = buildProviderNativeSystemBlocks({
      sections: hookSystemPromptUsed ? undefined : this.opts.systemPromptSections,
      deltas: currentRunPromptDeltas,
      fallbackText: runSystemPrompt,
    });
    const refreshModelPromptState = () => {
      currentRunPromptDeltas = collectRunPromptDeltas({
        hookPromptDeltas,
        runtimeIdentityDelta,
        runtimeIdentityAuthorityDelta,
        launchSpecPromptDeltas,
        metaPromptDeltas,
        transientPromptDeltas: pendingToolFollowupDeltas,
      });
      setSystemPromptMessage(messages, buildEffectiveSystemPrompt(runSystemPrompt, currentRunPromptDeltas));
      providerNativeSystemBlocks = buildProviderNativeSystemBlocks({
        sections: hookSystemPromptUsed ? undefined : this.opts.systemPromptSections,
        deltas: currentRunPromptDeltas,
        fallbackText: runSystemPrompt,
      });
      pendingToolFollowupDeltas = [];
    };
    const capturePromptSnapshot = (messagesForSnapshot: Message[]) => {
      if (!this.opts.onPromptSnapshot) {
        return;
      }
      const snapshotDeltas: AgentPromptDelta[] = [];
      if (hookPromptDeltas && hookPromptDeltas.length > 0) {
        snapshotDeltas.push(...hookPromptDeltas.map((delta) => ({ ...delta })));
      } else if (prependContext) {
        snapshotDeltas.push({
          id: "prepend-context",
          deltaType: "user-prelude",
          role: "user-prelude",
          source: "hook-runner",
          text: prependContext.trim(),
        });
      }
      for (const delta of currentRunPromptDeltas) {
        const alreadyPresent = snapshotDeltas.some((entry) => entry.id === delta.id);
        if (!alreadyPresent) {
          snapshotDeltas.push({ ...delta });
        }
      }
      this.opts.onPromptSnapshot(
        createAgentPromptSnapshot({
          agentId: resolvedAgentId,
          conversationId: input.conversationId,
          runId: readPromptSnapshotRunId(input.meta),
          messages: messagesForSnapshot,
          deltas: snapshotDeltas,
          providerNativeSystemBlocks,
          inputMeta: mergePromptSnapshotInputMeta(this.opts.systemPromptMetadata, input.meta),
          hookSystemPromptUsed,
          prependContext,
        }),
      );
    };
    const textAttachmentChars = readTextAttachmentChars(input.meta);
    let toolCallCount = 0;
    const generatedItems: AgentStreamItem[] = [];
    let runSuccess = true;
    let runError: string | undefined;

    // ReAct 循环内压缩状态
    let loopCompactionState: CompactionState = createEmptyCompactionState();

    // Usage 累加器
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreation = 0;
    let totalCacheRead = 0;
    let totalCacheHit = 0;
    let totalCacheMiss = 0;
    let totalInputCostUsd = 0;
    let totalOutputCostUsd = 0;
    let totalCacheCreationCostUsd = 0;
    let totalCacheReadCostUsd = 0;
    let totalCacheSavingsUsd = 0;
    let modelCallCount = 0;
    let toolLoopBudgetWarningIssued = false;
    let lastToolCallFingerprint: string | undefined;
    let lastToolCallName: string | undefined;
    let consecutiveDuplicateToolCalls = 0;
    let lastSuccessfulToolResult:
      | {
        fingerprint: string;
        toolName: string;
        toolCallId?: string;
        output: string;
        args: JsonObject;
      }
      | undefined;

    // 任务级 token 计数器
    const tokenCounter = new TokenCounterService();
    this.opts.toolExecutor.setTokenCounter(input.conversationId ?? "", tokenCounter);

    // 扩展 A：从 ConversationStore 恢复跨 run 的活跃计数器
    const convId = input.conversationId ?? "";
    if (this.opts.conversationStore && convId) {
      const snapshots = this.opts.conversationStore.getActiveCounters(convId);
      tokenCounter.restoreFromSnapshots(snapshots);
    }

    const buildUsageItem = (): AgentUsage => ({
      type: "usage",
      systemPromptTokens: estimateSystemPromptTokens(messages),
      contextTokens: estimateContextTokensFromMessages(messages, { includeSystem: false }),
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheCreationTokens: totalCacheCreation,
      cacheReadTokens: totalCacheRead,
      ...(totalCacheHit > 0 ? { cacheHitTokens: totalCacheHit } : {}),
      ...(totalCacheMiss > 0 ? { cacheMissTokens: totalCacheMiss } : {}),
      modelCalls: modelCallCount,
      ...(this.opts.cacheSupport ? { cacheSupport: this.opts.cacheSupport } : {}),
      ...(typeof this.opts.systemPromptMetadata?.systemPromptFingerprint === "string"
        ? { systemPromptFingerprint: this.opts.systemPromptMetadata.systemPromptFingerprint }
        : {}),
      ...(typeof this.opts.systemPromptMetadata?.structureSignature === "string"
        ? { structureSignature: this.opts.systemPromptMetadata.structureSignature }
        : {}),
      ...(this.opts.systemPromptMetadata?.warmupCoordination
        && typeof this.opts.systemPromptMetadata.warmupCoordination === "object"
        ? { warmupCoordination: this.opts.systemPromptMetadata.warmupCoordination }
        : {}),
      ...(this.opts.systemPromptMetadata?.cacheFamilyAffinity
        && typeof this.opts.systemPromptMetadata.cacheFamilyAffinity === "object"
        ? { cacheFamilyAffinity: this.opts.systemPromptMetadata.cacheFamilyAffinity }
        : {}),
      ...(totalInputCostUsd > 0 ? { inputCostUsd: totalInputCostUsd } : {}),
      ...(totalOutputCostUsd > 0 ? { outputCostUsd: totalOutputCostUsd } : {}),
      ...(totalCacheReadCostUsd > 0 ? { cacheReadCostUsd: totalCacheReadCostUsd } : {}),
      ...(totalCacheCreationCostUsd > 0 ? { cacheCreationCostUsd: totalCacheCreationCostUsd } : {}),
      ...(totalCacheSavingsUsd > 0 ? { cacheSavingsUsd: totalCacheSavingsUsd } : {}),
      ...(totalInputCostUsd > 0 || totalOutputCostUsd > 0 || totalCacheReadCostUsd > 0 || totalCacheCreationCostUsd > 0
        ? { totalCostUsd: totalInputCostUsd + totalOutputCostUsd + totalCacheReadCostUsd + totalCacheCreationCostUsd }
        : {}),
    });

    // 辅助函数：yield 并收集 items
    const yieldItem = async function* (item: AgentStreamItem) {
      generatedItems.push(item);
      yield item;
    };

    const emitStopped = async function* () {
      runSuccess = false;
      runError = readRunStopReason(input.abortSignal);
      yield* yieldItem(buildUsageItem());
      yield* yieldItem({ type: "status", status: "stopped" });
    };

    const logDebug = (msg: string, data?: unknown) => {
      this.opts.logger?.debug?.("agent", msg, data);
    };
    const logWarn = (msg: string, data?: unknown) => {
      this.opts.logger?.warn?.("agent", msg, data);
    };
    const logError = (msg: string, data?: unknown) => {
      if (this.opts.logger) {
        this.opts.logger.error("agent", msg, data);
        return;
      }
      console.error(`[agent] ${msg}`, data ?? "");
    };

      try {
      while (true) {
        if (isRunStopRequested(input.abortSignal)) {
          yield* emitStopped();
          return;
        }
        const nextModelCallIndex = modelCallCount + 1;
        const iterationBudget = this.opts.toolLoopIterationBudget;
        if (iterationBudget > 0) {
          const warningThreshold = Math.max(1, Math.ceil(iterationBudget * this.opts.toolLoopWarningFraction));
          if (
            !toolLoopBudgetWarningIssued
            && nextModelCallIndex >= warningThreshold
            && nextModelCallIndex <= iterationBudget
          ) {
            toolLoopBudgetWarningIssued = true;
            pendingToolFollowupDeltas.push(buildIterationBudgetWarningDelta(nextModelCallIndex, iterationBudget));
            logWarn("[tool-loop-budget] approaching iteration budget", {
              modelCallIndex: nextModelCallIndex,
              iterationBudget,
              warningThreshold,
              conversationId: input.conversationId,
              agentId: resolvedAgentId,
            });
          }
          if (nextModelCallIndex > iterationBudget) {
            try {
              loopCompactionState = await this.compactInLoop(
                messages,
                loopCompactionState,
                input.conversationId,
                resolvedAgentId,
                true,
              );
            } catch (err) {
              logWarn("[tool-loop-budget] forced compaction before budget stop failed", {
                error: err instanceof Error ? err.message : String(err),
                modelCallIndex: nextModelCallIndex,
                iterationBudget,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
            }
            runSuccess = false;
            runError = `工具调用迭代预算超限（最大 ${iterationBudget} 轮）。已在阻断前尝试压缩当前上下文，请收敛任务、分解问题，或开启新一轮继续。`;
            yield* yieldItem(buildUsageItem());
            yield* yieldItem({ type: "final", text: runError });
            yield* yieldItem({ type: "status", status: "error" });
            return;
          }
        }
        refreshModelPromptState();
        const microcompactCandidate = messages.some((message) => message.role === "tool");
        const microcompactOriginalTokens = microcompactCandidate ? estimateMessagesTotal(messages) : 0;
        if (microcompactCandidate) {
          await this.emitBeforeCompaction({
            messageCount: messages.length,
            tokenCount: microcompactOriginalTokens,
            source: "microcompact",
            compactionMode: "microcompact",
          }, input.conversationId, resolvedAgentId);
        }
        const microcompactResult = microcompactMessages(messages, this.opts.microcompact);
        if (microcompactResult.mutated) {
          const microcompactCompactedTokens = estimateMessagesTotal(messages);
          logDebug("[microcompact] compacted stale tool messages", microcompactResult);
          this.opts.logger?.info?.("agent", "[microcompact] compacted stale tool messages", {
            ...microcompactResult,
            originalTokens: microcompactOriginalTokens,
            compactedTokens: microcompactCompactedTokens,
            savedTokenCount: Math.max(0, microcompactOriginalTokens - microcompactCompactedTokens),
          });
          await this.emitAfterCompaction({
            messageCount: messages.length,
            tokenCount: microcompactCompactedTokens,
            compactedCount: microcompactResult.compactedCount,
            source: "microcompact",
            compactionMode: "microcompact",
            originalTokenCount: microcompactOriginalTokens,
            deltaMessageCount: microcompactResult.compactedCount,
            fallbackUsed: false,
            summarizerModel: undefined,
            savedTokenCount: Math.max(0, microcompactOriginalTokens - microcompactCompactedTokens),
            reclaimedChars: microcompactResult.reclaimedChars,
            rebuildTriggered: false,
          }, input.conversationId, resolvedAgentId);
        } else if (microcompactResult.skippedForPrefixStability) {
          logDebug("[microcompact] skipped destructive rewrite to preserve prefix stability", {
            messageCount: messages.length,
          });
          this.opts.logger?.info?.("agent", "[microcompact] skipped destructive rewrite to preserve prefix stability", {
            messageCount: messages.length,
            agentId: resolvedAgentId,
            conversationId: input.conversationId,
          });
        }

        // ReAct 循环内压缩检查：当上下文接近上限时，压缩历史消息
        const maxInput = this.opts.maxInputTokens;
        if (maxInput && maxInput > 0 && this.opts.compaction?.enabled !== false) {
          const triggerFraction = this.opts.compaction?.triggerFraction ?? 0.75;
          const currentTokens = estimateMessagesTotal(messages);
          if (needsInLoopCompaction(currentTokens, maxInput, triggerFraction)) {
            try {
              loopCompactionState = await this.compactInLoop(messages, loopCompactionState, input.conversationId, resolvedAgentId);
            } catch (err) {
              logError(`[compaction] in-loop compaction failed: ${err}`);
              // 压缩失败不阻塞，继续执行（trimMessagesToFit 会兜底）
            }
          }
        }

        const tools = this.opts.toolExecutor.getDefinitions(resolvedAgentId, input.conversationId, runtimeContext);
        const toolNames = tools.map((tool) => tool.function.name);
        const modelCallStartedAt = Date.now();
        logDebug("[model-call] dispatch", {
          modelCallIndex: nextModelCallIndex,
          conversationId: input.conversationId,
          agentId: resolvedAgentId,
          messageCount: messages.length,
          toolDefinitionCount: tools.length,
          toolNamesPreview: toolNames.slice(0, 12),
          hasApplyPatch: toolNames.includes("apply_patch"),
          hasFileRead: toolNames.includes("file_read"),
          hasFileWrite: toolNames.includes("file_write"),
          hasListFiles: toolNames.includes("list_files"),
          hasToolSearch: toolNames.includes("tool_search"),
          textAttachmentChars,
        });

        // 调用模型
        const response = await this.callModel(
          messages,
          tools.length > 0 ? tools : undefined,
          textAttachmentChars,
          {
            agentId: resolvedAgentId,
            conversationId: input.conversationId,
            modelCallIndex: nextModelCallIndex,
          },
          input.abortSignal,
          capturePromptSnapshot,
          providerNativeSystemBlocks,
        );
        logDebug("[model-call] completed", {
          modelCallIndex: nextModelCallIndex,
          conversationId: input.conversationId,
          agentId: resolvedAgentId,
          ok: response.ok,
          durationMs: Date.now() - modelCallStartedAt,
          ...(response.ok
            ? {
                responseContentLength: response.content?.length ?? 0,
                toolCallCount: response.toolCalls?.length ?? 0,
                reasoningContentLength: response.reasoning_content?.length ?? 0,
              }
            : {
                error: response.error,
              }),
        });

        if (isRunStopRequested(input.abortSignal)) {
          yield* emitStopped();
          return;
        }

        // 记录并累加 usage 信息
        if (response.ok && response.usage) {
          const u = response.usage;
          modelCallCount++;
          totalInputTokens += u.input_tokens;
          totalOutputTokens += u.output_tokens;
          totalCacheCreation += u.cache_creation_input_tokens ?? 0;
          totalCacheRead += u.cache_read_input_tokens ?? 0;
          totalCacheHit += u.prompt_cache_hit_tokens ?? 0;
          totalCacheMiss += u.prompt_cache_miss_tokens ?? 0;
          const usageCost = calculateUsageCostUsd({
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            cacheHitTokens: u.prompt_cache_hit_tokens ?? 0,
            pricing: this.opts.usagePricing,
          });
          if (usageCost) {
            totalInputCostUsd += usageCost.inputUsd;
            totalOutputCostUsd += usageCost.outputUsd;
            totalCacheReadCostUsd += usageCost.cacheReadUsd;
            totalCacheCreationCostUsd += usageCost.cacheCreationUsd;
            totalCacheSavingsUsd += usageCost.cacheSavingsUsd;
          }
          tokenCounter.notifyUsage(u.input_tokens, u.output_tokens, usageCost
            ? {
                inputCostUsd: usageCost.inputUsd + usageCost.cacheReadUsd + usageCost.cacheCreationUsd,
                outputCostUsd: usageCost.outputUsd,
              }
            : undefined);
          const parts = [`input=${u.input_tokens}`, `output=${u.output_tokens}`];
          if (u.cache_creation_input_tokens) parts.push(`cache_create=${u.cache_creation_input_tokens}`);
          if (u.cache_read_input_tokens) parts.push(`cache_read=${u.cache_read_input_tokens}`);
          if (u.prompt_cache_hit_tokens) parts.push(`cache_hit=${u.prompt_cache_hit_tokens}`);
          if (u.prompt_cache_miss_tokens) parts.push(`cache_miss=${u.prompt_cache_miss_tokens}`);
          if (usageCost) parts.push(`usd=${usageCost.totalUsd.toFixed(8)}`);
          logDebug(`[usage] ${parts.join(" ")}`);
        } else if (response.ok) {
          modelCallCount++;
        }

        if (!response.ok) {
          if (response.error === STOP_REQUESTED_ERROR) {
            yield* emitStopped();
            return;
          }
          runSuccess = false;
          runError = response.error;
          yield* yieldItem(buildUsageItem());
          yield* yieldItem({ type: "final", text: response.error });
          yield* yieldItem({ type: "status", status: "error" });
          return;
        }

        if (input.conversationId) {
          await this.opts.toolExecutor.consumeLoadedDeferredToolsForNextTurn(input.conversationId);
        }

        // 输出文本增量（如果有）；先剥离工具调用协议块，避免在对话中展示
        const postprocessStartedAt = Date.now();
        const contentForDisplay = stripToolCallsSection(response.content || "");
        logDebug("[model-call] postprocess_done", {
          modelCallIndex: nextModelCallIndex,
          conversationId: input.conversationId,
          agentId: resolvedAgentId,
          durationMs: Date.now() - postprocessStartedAt,
          originalContentLength: response.content?.length ?? 0,
          displayContentLength: contentForDisplay.length,
        });
        if (contentForDisplay) {
          for (const delta of splitText(contentForDisplay, 16)) {
            yield* yieldItem({ type: "delta", delta });
          }
        }

        // 检查是否有工具调用
        const toolCalls = response.toolCalls;
        logDebug("[tool-check] model response analyzed", {
          toolCallCount: toolCalls?.length ?? 0,
          responseContentLength: response.content?.length ?? 0,
          toolDefinitionCount: tools.length,
          toolNamesPreview: toolNames.slice(0, 12),
        });
        if (!toolCalls || toolCalls.length === 0) {
          // 无工具调用，输出最终结果（已剥离协议块）
          logDebug("[tool-check] no tool calls; returning text result");
          yield* yieldItem(buildUsageItem());
          yield* yieldItem({ type: "final", text: contentForDisplay });
          yield* yieldItem({ type: "status", status: "done" });
          return;
        }
        logDebug("[tool-check] tool calls detected", { names: toolCalls.map(tc => tc.function.name) });

        // 防止无限循环
        toolCallCount += toolCalls.length;
        if (toolCallCount > this.opts.maxToolCalls) {
          runSuccess = false;
          runError = `工具调用次数超限（最大 ${this.opts.maxToolCalls} 次）`;
          yield* yieldItem(buildUsageItem());
          yield* yieldItem({ type: "final", text: runError });
          yield* yieldItem({ type: "status", status: "error" });
          return;
        }

        // 将 assistant 消息（含 tool_calls）加入历史
        messages.push({
          role: "assistant",
          content: sanitizeAssistantToolCallHistoryContent(response.content),
          tool_calls: toolCalls,
          reasoning_content: compactReasoningContentForHistory(
            response.reasoning_content,
            DEFAULT_REASONING_TRANSCRIPT_CHAR_LIMIT,
            response.content,
          ),
        });

        // 执行工具调用
        for (const tc of toolCalls) {
          if (isRunStopRequested(input.abortSignal)) {
            yield* emitStopped();
            return;
          }
          const parsedArguments = parseToolCallArguments(tc.function.arguments, this.opts.toolCallRepairLevel);
          const request: ToolCallRequest = {
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArguments.arguments,
          };
          const requestFingerprint = buildToolCallFingerprint(request.name, parsedArguments.fingerprintArguments);

          const toolStartTime = Date.now();

          // 工具钩子上下文
          const toolHookCtx: HookToolContext = {
            agentId: resolvedAgentId,
            sessionKey: input.conversationId,
            toolName: request.name,
          };

          // Hook: beforeToolCall / before_tool_call
          if (this.opts.hookRunner) {
            try {
              const hookRes = await this.withStageTimeout(
                "before_tool_call",
                this.opts.hookRunner.runBeforeToolCall(
                  { toolName: request.name, params: request.arguments },
                  toolHookCtx,
                ),
              );
              if (hookRes?.block) {
                const reason = hookRes.blockReason || "被钩子阻止";
                const blockedError = `工具 ${request.name} 执行被阻止: ${reason}`;
                yield* yieldItem({
                  type: "tool_call",
                  id: request.id,
                  name: request.name,
                  arguments: request.arguments,
                });
                yield* yieldItem({
                  type: "tool_result",
                  id: request.id,
                  name: request.name,
                  success: false,
                  output: "",
                  error: blockedError,
                });
                messages.push(buildToolTranscriptMessageForHistory({
                  toolCallId: tc.id,
                  toolName: request.name,
                  output: "",
                  error: blockedError,
                  success: false,
                  hookRunner: this.opts.hookRunner,
                  persistCtx: {
                    agentId: resolvedAgentId,
                    sessionKey: input.conversationId,
                    toolName: request.name,
                    toolCallId: tc.id,
                  },
                  isSynthetic: true,
                }));
                recordToolResultArtifacts({
                  conversationStore: this.opts.conversationStore,
                  conversationId: input.conversationId,
                  toolName: request.name,
                  args: request.arguments,
                  success: false,
                  error: blockedError,
                  toolCallId: tc.id,
                  isSynthetic: true,
                });
                pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
                  result: {
                    id: request.id,
                    name: request.name,
                    success: false,
                    output: "",
                    error: blockedError,
                  },
                  requestArguments: request.arguments,
                }));
                continue;
              }
              if (hookRes?.skipExecution) {
                const syntheticResult = hookRes.syntheticResult || `工具 ${request.name} 本次未执行。`;
                yield* yieldItem({
                  type: "tool_call",
                  id: request.id,
                  name: request.name,
                  arguments: request.arguments,
                });
                yield* yieldItem({
                  type: "tool_result",
                  id: request.id,
                  name: request.name,
                  success: true,
                  output: syntheticResult,
                });
                messages.push(buildToolTranscriptMessageForHistory({
                  toolCallId: tc.id,
                  toolName: request.name,
                  output: syntheticResult,
                  success: true,
                  hookRunner: this.opts.hookRunner,
                  persistCtx: {
                    agentId: resolvedAgentId,
                    sessionKey: input.conversationId,
                    toolName: request.name,
                    toolCallId: tc.id,
                  },
                  isSynthetic: true,
                }));
                recordToolResultArtifacts({
                  conversationStore: this.opts.conversationStore,
                  conversationId: input.conversationId,
                  toolName: request.name,
                  args: request.arguments,
                  success: true,
                  output: syntheticResult,
                  toolCallId: tc.id,
                  isSynthetic: true,
                });
                continue;
              }
              if (hookRes?.params) {
                request.arguments = hookRes.params as JsonObject;
              }
            } catch (err) {
              const hookError = `钩子 before_tool_call 执行失败: ${err}`;
              yield* yieldItem({
                type: "tool_call",
                id: request.id,
                name: request.name,
                arguments: request.arguments,
              });
              yield* yieldItem({
                type: "tool_result",
                id: request.id,
                name: request.name,
                success: false,
                output: "",
                error: hookError,
              });
              messages.push(buildToolTranscriptMessageForHistory({
                toolCallId: tc.id,
                toolName: request.name,
                output: "",
                error: hookError,
                success: false,
                hookRunner: this.opts.hookRunner,
                persistCtx: {
                  agentId: resolvedAgentId,
                  sessionKey: input.conversationId,
                  toolName: request.name,
                  toolCallId: tc.id,
                },
                isSynthetic: true,
              }));
              recordToolResultArtifacts({
                conversationStore: this.opts.conversationStore,
                conversationId: input.conversationId,
                toolName: request.name,
                args: request.arguments,
                success: false,
                error: hookError,
                toolCallId: tc.id,
                isSynthetic: true,
              });
              pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
                result: {
                  id: request.id,
                  name: request.name,
                  success: false,
                  output: "",
                  error: hookError,
                },
                requestArguments: request.arguments,
              }));
              continue;
            }
          } else if (this.opts.hooks?.beforeToolCall) {
            // 向后兼容：旧版 hooks
            try {
              const hookRes = await this.withStageTimeout(
                "beforeToolCall",
                Promise.resolve(this.opts.hooks.beforeToolCall({
                  toolName: request.name,
                  arguments: request.arguments,
                  id: request.id
                }, legacyHookCtx)),
              );

              if (hookRes === false) {
                const blockedError = `Tool execution cancelled by hook: ${request.name}`;
                yield* yieldItem({
                  type: "tool_call",
                  id: request.id,
                  name: request.name,
                  arguments: request.arguments,
                });
                yield* yieldItem({
                  type: "tool_result",
                  id: request.id,
                  name: request.name,
                  success: false,
                  output: "",
                  error: blockedError,
                });
                messages.push(buildToolTranscriptMessageForHistory({
                  toolCallId: tc.id,
                  toolName: request.name,
                  output: "",
                  error: blockedError,
                  success: false,
                  hookRunner: this.opts.hookRunner,
                  persistCtx: {
                    agentId: resolvedAgentId,
                    sessionKey: input.conversationId,
                    toolName: request.name,
                    toolCallId: tc.id,
                  },
                  isSynthetic: true,
                }));
                recordToolResultArtifacts({
                  conversationStore: this.opts.conversationStore,
                  conversationId: input.conversationId,
                  toolName: request.name,
                  args: request.arguments,
                  success: false,
                  error: blockedError,
                  toolCallId: tc.id,
                  isSynthetic: true,
                });
                pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
                  result: {
                    id: request.id,
                    name: request.name,
                    success: false,
                    output: "",
                    error: blockedError,
                  },
                  requestArguments: request.arguments,
                }));
                continue;
              }
              if (hookRes && typeof hookRes === "object") {
                request.arguments = hookRes as JsonObject;
              }
            } catch (err) {
              const hookError = `Hook beforeToolCall failed: ${err}`;
              yield* yieldItem({
                type: "tool_call",
                id: request.id,
                name: request.name,
                arguments: request.arguments,
              });
              yield* yieldItem({
                type: "tool_result",
                id: request.id,
                name: request.name,
                success: false,
                output: "",
                error: hookError,
              });
              messages.push(buildToolTranscriptMessageForHistory({
                toolCallId: tc.id,
                toolName: request.name,
                output: "",
                error: hookError,
                success: false,
                hookRunner: this.opts.hookRunner,
                persistCtx: {
                  agentId: resolvedAgentId,
                  sessionKey: input.conversationId,
                  toolName: request.name,
                  toolCallId: tc.id,
                },
                isSynthetic: true,
              }));
              recordToolResultArtifacts({
                conversationStore: this.opts.conversationStore,
                conversationId: input.conversationId,
                toolName: request.name,
                args: request.arguments,
                success: false,
                error: hookError,
                toolCallId: tc.id,
                isSynthetic: true,
              });
              pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
                result: {
                  id: request.id,
                  name: request.name,
                  success: false,
                  output: "",
                  error: hookError,
                },
                requestArguments: request.arguments,
              }));
              continue;
            }
          }

          if (parsedArguments.repaired) {
            logWarn("[tool-call-repair] repaired truncated tool arguments", {
              toolName: request.name,
              toolCallId: request.id,
              conversationId: input.conversationId,
              agentId: resolvedAgentId,
            });
          }

          if (
            this.opts.toolCallRepairLevel !== "off"
            && lastToolCallFingerprint
            && requestFingerprint === lastToolCallFingerprint
          ) {
            consecutiveDuplicateToolCalls += 1;
            if (lastSuccessfulToolResult && lastSuccessfulToolResult.fingerprint === requestFingerprint) {
              const reusedResult = buildRecoveredDuplicateToolResult({
                duplicateToolCallId: request.id,
                toolName: request.name,
                previousToolCallId: lastSuccessfulToolResult.toolCallId,
                output: lastSuccessfulToolResult.output,
                args: lastSuccessfulToolResult.args,
              });
              yield* yieldItem({
                type: "tool_call",
                id: request.id,
                name: request.name,
                arguments: request.arguments,
              });
              yield* yieldItem({
                type: "tool_result",
                ...reusedResult,
              });
              messages.push(buildToolTranscriptMessageForHistory({
                toolCallId: tc.id,
                toolName: request.name,
                output: reusedResult.output,
                success: true,
                hookRunner: this.opts.hookRunner,
                persistCtx: {
                  agentId: resolvedAgentId,
                  sessionKey: input.conversationId,
                  toolName: request.name,
                  toolCallId: tc.id,
                },
                isSynthetic: true,
              }));
              recordToolResultArtifacts({
                conversationStore: this.opts.conversationStore,
                conversationId: input.conversationId,
                toolName: request.name,
                args: request.arguments,
                success: true,
                output: reusedResult.output,
                toolCallId: tc.id,
                isSynthetic: true,
              });
              pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
                result: reusedResult,
                requestArguments: request.arguments,
              }));
              logWarn("[tool-call-repair] reused recent successful duplicate tool result", {
                toolName: request.name,
                toolCallId: request.id,
                previousToolCallId: lastSuccessfulToolResult.toolCallId,
                duplicateCount: consecutiveDuplicateToolCalls,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
              continue;
            }
            const duplicateError = `工具调用已被拦截：检测到连续重复的相同调用（${request.name}）。请基于上一轮工具结果继续，而不是重复调用同一工具。`;
            yield* yieldItem({
              type: "tool_call",
              id: request.id,
              name: request.name,
              arguments: request.arguments,
            });
            yield* yieldItem({
              type: "tool_result",
              id: request.id,
              name: request.name,
              success: false,
              output: "",
              error: duplicateError,
              failureKind: "business_logic_error",
              metadata: {
                repairAction: "duplicate_tool_call_suppressed",
                duplicateCount: consecutiveDuplicateToolCalls,
                previousToolName: lastToolCallName,
              },
            });
            messages.push(buildToolTranscriptMessageForHistory({
              toolCallId: tc.id,
              toolName: request.name,
              output: "",
              error: duplicateError,
              success: false,
              hookRunner: this.opts.hookRunner,
              persistCtx: {
                agentId: resolvedAgentId,
                sessionKey: input.conversationId,
                toolName: request.name,
                toolCallId: tc.id,
              },
              isSynthetic: true,
            }));
            recordToolResultArtifacts({
              conversationStore: this.opts.conversationStore,
              conversationId: input.conversationId,
              toolName: request.name,
              args: request.arguments,
              success: false,
              error: duplicateError,
              failureKind: "business_logic_error",
              toolCallId: tc.id,
              isSynthetic: true,
            });
            pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
              result: {
                id: request.id,
                name: request.name,
                success: false,
                output: "",
                error: duplicateError,
                failureKind: "business_logic_error",
                metadata: {
                  repairAction: "duplicate_tool_call_suppressed",
                  duplicateCount: consecutiveDuplicateToolCalls,
                },
              },
              requestArguments: request.arguments,
            }));
            logWarn("[tool-call-repair] suppressed duplicate tool call", {
              toolName: request.name,
              toolCallId: request.id,
              duplicateCount: consecutiveDuplicateToolCalls,
              conversationId: input.conversationId,
              agentId: resolvedAgentId,
            });
            continue;
          }

          // 广播工具调用事件
          yield* yieldItem({
            type: "tool_call",
            id: request.id,
            name: request.name,
            arguments: request.arguments,
          });

          // 执行工具
          const toolRuntimeContext = input.abortSignal
            ? { ...runtimeContext, abortSignal: input.abortSignal }
            : runtimeContext;
          const result = await this.opts.toolExecutor.execute(
            request,
            input.conversationId,
            resolvedAgentId,
            input.userUuid,
            input.senderInfo,
            input.roomContext,
            toolRuntimeContext,
          );
          const toolDurationMs = Date.now() - toolStartTime;

          // Hook: afterToolCall / after_tool_call
          if (this.opts.hookRunner) {
            try {
              await this.withStageTimeout(
                "after_tool_call",
                this.opts.hookRunner.runAfterToolCall(
                  {
                    toolName: result.name,
                    params: request.arguments,
                    result: result.output,
                    error: result.error,
                    durationMs: toolDurationMs,
                  },
                  toolHookCtx,
                ),
              );
            } catch (err) {
              logError(`钩子 after_tool_call 执行失败: ${err}`);
            }
          } else if (this.opts.hooks?.afterToolCall) {
            // 向后兼容：旧版 hooks
            try {
              await this.withStageTimeout(
                "afterToolCall",
                Promise.resolve(this.opts.hooks.afterToolCall({
                  toolName: result.name,
                  arguments: request.arguments,
                  result: result.output,
                  success: result.success,
                  error: result.error,
                  id: result.id
                }, legacyHookCtx)),
              );
            } catch (err) {
              logError(`Hook afterToolCall failed: ${err}`);
            }
          }

          // 广播工具结果事件
          yield* yieldItem({
            type: "tool_result",
            id: result.id,
            name: result.name,
            success: result.success,
            output: result.output,
            error: result.error,
            failureKind: result.failureKind,
            metadata: result.metadata,
          });

          // 将工具结果加入消息历史
          messages.push(buildToolTranscriptMessageForHistory({
            toolCallId: tc.id,
            toolName: result.name,
            output: result.output,
            error: result.error,
            success: result.success,
            hookRunner: this.opts.hookRunner,
            persistCtx: {
              agentId: resolvedAgentId,
              sessionKey: input.conversationId,
              toolName: result.name,
              toolCallId: tc.id,
            },
          }));
          recordToolResultArtifacts({
            conversationStore: this.opts.conversationStore,
            conversationId: input.conversationId,
            toolName: result.name,
            args: request.arguments,
            success: result.success,
            output: result.output,
            error: result.error,
            failureKind: result.failureKind,
            toolCallId: tc.id,
          });
          pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
            result,
            requestArguments: request.arguments,
          }));
          lastToolCallFingerprint = requestFingerprint;
          lastToolCallName = request.name;
          consecutiveDuplicateToolCalls = 0;
          if (result.success) {
            lastSuccessfulToolResult = {
              fingerprint: requestFingerprint,
              toolName: request.name,
              toolCallId: tc.id,
              output: result.output,
              args: cloneJsonObject(request.arguments) ?? {},
            };
          }
          if (isRunStopRequested(input.abortSignal)) {
            yield* emitStopped();
            return;
          }
        }

        // 继续循环，让模型处理工具结果
      }
      } finally {
      const durationMs = Date.now() - startTime;

      // Hook: afterRun / agent_end（在清理 token 计数器之前执行，
      // 以便 agent_end hooks 可通过 toolExecutor.getTokenCounter() 访问计数器，
      // 用于扩展 C 自动任务边界检测等场景）
      if (this.opts.hookRunner) {
        try {
          await this.withStageTimeout(
            "agent_end",
            this.opts.hookRunner.runAgentEnd(
              {
                messages: generatedItems,
                success: runSuccess,
                error: runError,
                durationMs,
              },
              agentHookCtx,
            ),
          );
        } catch (err) {
          logError(`钩子 agent_end 执行失败: ${err}`);
        }
      } else if (this.opts.hooks?.afterRun) {
        // 向后兼容：旧版 hooks
        try {
          await this.withStageTimeout(
            "afterRun",
            Promise.resolve(this.opts.hooks.afterRun({ input, items: generatedItems }, legacyHookCtx)),
          );
        } catch (err) {
          logError(`Hook afterRun failed: ${err}`);
        }
      }

      // 清理 token 计数器（在 agent_end hook 之后执行）
      // 扩展 A：清理前先保存活跃计数器快照（跨 run 持久化）
      if (this.opts.conversationStore && convId) {
        const snapshots = tokenCounter.getSnapshots();
        this.opts.conversationStore.setActiveCounters(convId, snapshots);
      }
      const leakedCounters = tokenCounter.cleanup();
      if (leakedCounters.length > 0) {
        logError(`Token counters leaked: ${leakedCounters.join(", ")}`);
      }
      this.opts.toolExecutor.clearTokenCounter(input.conversationId ?? "");
      }
    } finally {
      releaseConversationRunSlot();
    }
  }

  private async callModel(
    messages: Message[],
    tools?: { type: "function"; function: { name: string; description: string; parameters: object } }[],
    textAttachmentChars?: number,
    runtimeScope?: { conversationId?: string; agentId?: string; modelCallIndex?: number },
    abortSignal?: AbortSignal,
    onBeforeRequest?: (messages: Message[]) => void,
    providerNativeSystemBlocks?: ProviderNativeSystemBlock[],
  ): Promise<{ ok: true; content: string; toolCalls?: OpenAIToolCall[]; reasoning_content?: string; usage?: AnthropicUsage } | { ok: false; error: string }> {
    let effectiveTimeoutMs = this.opts.timeoutMs;
    const callStartedAt = Date.now();
    let currentPhase = "preflight";
    let failoverSummary: FailoverExecutionSummary | undefined;
    const logModelPhase = (message: string, data?: unknown) => {
      this.opts.logger?.debug?.("agent", message, {
        conversationId: runtimeScope?.conversationId,
        agentId: runtimeScope?.agentId,
        modelCallIndex: runtimeScope?.modelCallIndex,
        phase: currentPhase,
        elapsedMs: Date.now() - callStartedAt,
        ...((data && typeof data === "object") ? data as Record<string, unknown> : {}),
      });
    };
    try {
      // 输入 token 预检：超限时裁剪历史消息
      const maxInput = this.opts.maxInputTokens;
      if (maxInput && maxInput > 0) {
        trimMessagesToFit(messages, tools, maxInput);
      }
      onBeforeRequest?.(messages);

      // 用于记录实际使用的协议（由 buildRequest 内部决定）
      let usedProtocol: ApiProtocol = "openai" as ApiProtocol;
      let usedWireApi: OpenAIWireApi = this.opts.wireApi;
      const minimumAdaptiveTimeoutMs = resolveMinimumAdaptiveTimeoutMs(messages, textAttachmentChars ?? 0);
      const requestTimeoutMs = minimumAdaptiveTimeoutMs
        ? Math.max(this.opts.timeoutMs, minimumAdaptiveTimeoutMs)
        : this.opts.timeoutMs;
      effectiveTimeoutMs = requestTimeoutMs;
      currentPhase = "request_start";
      logModelPhase("[model-call] request_start", {
        messageCount: messages.length,
        toolDefinitionCount: tools?.length ?? 0,
        timeoutMs: requestTimeoutMs,
        minimumAdaptiveTimeoutMs,
        textAttachmentChars: textAttachmentChars ?? 0,
      });

      currentPhase = "awaiting_model_response";
      const { response: res } = await this.failoverClient.fetchWithFailover({
        signal: abortSignal,
        timeoutMs: requestTimeoutMs,
        minimumTimeoutMs: minimumAdaptiveTimeoutMs,
        maxRetries: this.opts.maxRetries,
        retryBackoffMs: this.opts.retryBackoffMs,
        onSummary: (summary) => {
          failoverSummary = summary;
          this.opts.onRuntimeResilienceEvent?.({
            source: "tool_agent",
            phase: "tool_loop",
            agentId: runtimeScope?.agentId,
            conversationId: runtimeScope?.conversationId,
            summary,
          });
        },
        buildRequest: (profile) => {
          // 优先使用 profile 自身的 protocol（models.json 配置），再 fallback 到 agent 级别协议
          const profileProtocol = (profile.protocol as ApiProtocol) ?? this.opts.protocol ?? detectProtocol(profile.baseUrl);
          const profileWireApi = resolveWireApiForProfile(profile, this.opts.wireApi);
          usedProtocol = profileProtocol;
          usedWireApi = profileWireApi;

          if (profileProtocol === "anthropic") {
            return buildAnthropicRequest({
              profile,
              messages: messages as any,
              tools: tools as any,
              maxTokens: this.opts.maxOutputTokens ?? 4096,
              stream: false,
              enableCaching: true,
              providerNativeSystemBlocks,
            });
          }

          // OpenAI 协议
          if (profileWireApi === "responses") {
            const payload: Record<string, unknown> = {
              model: profile.model,
              input: buildResponsesInputFromMessages(messages),
              max_output_tokens: this.opts.maxOutputTokens ?? 4096,
              stream: false,
            };
            applyOpenAICompatibleReasoningConfig(payload, profile);
            if (tools && tools.length > 0) {
              const responseTools = this.opts.sanitizeResponsesToolSchema
                ? sanitizeResponsesToolDefinitions(tools)
                : tools;
              // Responses API 使用扁平化工具格式（与 Chat Completions 不同）
              payload.tools = responseTools.map(t => ({
                type: "function",
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
              }));
            }
            return {
              url: buildUrl(profile.baseUrl, "/responses"),
              init: {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${profile.apiKey}`,
                },
                body: JSON.stringify(payload),
              },
            };
          }

          const cleanMessages = messages.map(m => cleanupMessage(m, profile.model));
          const payload: Record<string, unknown> = {
            model: profile.model,
            messages: cleanMessages,
            max_tokens: this.opts.maxOutputTokens ?? 4096,
            stream: false,
          };
          applyOpenAICompatibleReasoningConfig(payload, profile);
          if (tools && tools.length > 0) {
            payload.tools = tools;
            payload.tool_choice = "auto";
          }
          return {
            url: buildUrl(profile.baseUrl, "/chat/completions"),
            init: {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${profile.apiKey}`,
              },
              body: JSON.stringify(payload),
            },
          };
        },
      });
      logModelPhase("[model-call] fetch_resolved", {
        status: res.status,
        ok: res.ok,
        usedProtocol,
        usedWireApi,
        responseContentType: res.headers.get("content-type") ?? "",
        responseContentLength: res.headers.get("content-length") ?? "",
        failoverFinalStatus: failoverSummary?.finalStatus,
        failoverFinalProfileId: failoverSummary?.finalProfileId,
        failoverFinalProvider: failoverSummary?.finalProvider,
        failoverFinalModel: failoverSummary?.finalModel,
      });

      if (!res.ok) {
        currentPhase = "read_error_response";
        const text = await safeReadText(res);
        logModelPhase("[model-call] error_response_read", {
          status: res.status,
          errorPreviewLength: text.length,
        });
        return { ok: false, error: `模型调用失败（HTTP ${res.status}）：${text}` };
      }

      // 按实际使用的协议解析响应
      if (usedProtocol === "anthropic") {
        currentPhase = "parse_anthropic_json";
        const json = (await res.json()) as any;
        logModelPhase("[model-call] json_parse_done", {
          parser: "anthropic",
        });
        currentPhase = "extract_anthropic_response";
        const parsed = parseAnthropicResponse(json);
        const toolCalls: OpenAIToolCall[] | undefined = parsed.toolCalls && parsed.toolCalls.length > 0
          ? parsed.toolCalls.map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }))
          : undefined;
        logModelPhase("[model-call] response_extracted", {
          parser: "anthropic",
          contentLength: parsed.content.length,
          toolCallCount: toolCalls?.length ?? 0,
          usageInputTokens: parsed.usage?.input_tokens ?? 0,
          usageOutputTokens: parsed.usage?.output_tokens ?? 0,
        });
        return { ok: true, content: parsed.content, toolCalls, usage: parsed.usage };
      }

      // OpenAI 响应解析
      currentPhase = "parse_openai_json";
      const json = (await res.json()) as JsonObject;
      logModelPhase("[model-call] json_parse_done", {
        parser: usedWireApi === "responses" ? "responses" : "chat_completions",
      });
      if (usedWireApi === "responses") {
        currentPhase = "extract_responses_payload";
        const content = extractResponsesText(json);
        const toolCalls = extractResponsesToolCalls(json);
        const rawUsage = (json as any).usage;
        const usage: AnthropicUsage | undefined = rawUsage ? {
          input_tokens: rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? 0,
          output_tokens: rawUsage.output_tokens ?? rawUsage.completion_tokens ?? 0,
          cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
          prompt_cache_hit_tokens: rawUsage.prompt_cache_hit_tokens ?? 0,
          prompt_cache_miss_tokens: rawUsage.prompt_cache_miss_tokens ?? 0,
        } : undefined;
        logModelPhase("[model-call] response_extracted", {
          parser: "responses",
          contentLength: content.length,
          toolCallCount: toolCalls.length,
          usageInputTokens: usage?.input_tokens ?? 0,
          usageOutputTokens: usage?.output_tokens ?? 0,
        });
        return {
          ok: true,
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
        };
      }

      const choice = (json.choices as any)?.[0];
      if (!choice) {
        currentPhase = "extract_chat_choice";
        logModelPhase("[model-call] empty_choice", {
          parser: "chat_completions",
        });
        return { ok: false, error: "模型返回空响应" };
      }
      currentPhase = "extract_chat_choice";
      const message = choice.message;
      const content = typeof message?.content === "string" ? message.content : "";
      const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls as OpenAIToolCall[] : undefined;
      const reasoning_content = typeof message?.reasoning_content === "string" ? message.reasoning_content : undefined;

      // 提取 OpenAI usage（prompt_tokens → input_tokens, completion_tokens → output_tokens）
      const rawUsage = json.usage as any;
      const usage: AnthropicUsage | undefined = rawUsage ? {
        input_tokens: rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? 0,
        output_tokens: rawUsage.completion_tokens ?? rawUsage.output_tokens ?? 0,
        cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
        prompt_cache_hit_tokens: rawUsage.prompt_cache_hit_tokens ?? 0,
        prompt_cache_miss_tokens: rawUsage.prompt_cache_miss_tokens ?? 0,
      } : undefined;
      logModelPhase("[model-call] response_extracted", {
        parser: "chat_completions",
        contentLength: content.length,
        toolCallCount: toolCalls?.length ?? 0,
        reasoningContentLength: reasoning_content?.length ?? 0,
        usageInputTokens: usage?.input_tokens ?? 0,
        usageOutputTokens: usage?.output_tokens ?? 0,
      });

      return { ok: true, content, toolCalls, reasoning_content, usage };
    } catch (err) {
      logModelPhase("[model-call] failed", {
        error: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : undefined,
        timeoutMs: effectiveTimeoutMs,
      });
      if (err instanceof Error && err.name === "AbortError") {
        if (abortSignal?.aborted) {
          return { ok: false, error: STOP_REQUESTED_ERROR };
        }
        return { ok: false, error: `模型调用超时（${effectiveTimeoutMs}ms）` };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * ReAct 循环内压缩：将 messages 数组中的旧历史消息压缩为摘要。
   * 直接修改 messages 数组（in-place），返回更新后的 CompactionState。
   */
  private async compactInLoop(
    messages: Message[],
    state: CompactionState,
    conversationId?: string,
    agentId?: string,
    force?: boolean,
  ): Promise<CompactionState> {
    // 提取可压缩的 user/assistant 消息（跳过 system 和 tool 消息）
    const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
    const systemIdx = systemMsg ? 1 : 0;

    // 找到最后一条 user 消息的位置（当前轮次的输入）
    let lastUserIdx = messages.length - 1;
    while (lastUserIdx > systemIdx && messages[lastUserIdx].role !== "user") {
      lastUserIdx--;
    }

    // 收集可压缩的历史消息（system 之后、最近几轮之前的 user/assistant 对）
    const keepRecent = this.opts.compaction?.keepRecentCount ?? 10;
    const historyMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    const historyIndices: number[] = [];

    for (let i = systemIdx; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "user" || m.role === "assistant") {
        historyMessages.push({ role: m.role, content: contentToTokenEstimateString(m.content) });
        historyIndices.push(i);
      }
    }

    // 如果历史消息不够多，不压缩
    if (historyMessages.length <= keepRecent) return state;

    const skipDecision = this.opts.compactionRuntimeTracker?.shouldSkip("loop");
    if (skipDecision?.skipped) {
      this.opts.logger?.info?.("agent", "[compaction] in-loop compaction skipped by circuit breaker", {
        remainingSkips: skipDecision.remainingSkips,
      });
      return state;
    }

    const originalTokens = estimateMessagesTokens(historyMessages);
    await this.emitBeforeCompaction({
      messageCount: historyMessages.length,
      tokenCount: originalTokens,
      source: "loop",
      compactionMode: "loop",
      deltaMessageCount: Math.max(0, historyMessages.length - keepRecent),
      summarizerModel: this.opts.summarizerModelName,
    }, conversationId, agentId);

    const result = await compactIncremental(historyMessages, state, {
      ...this.opts.compaction,
      summarizer: this.opts.summarizer,
      force,
    });
    this.opts.compactionRuntimeTracker?.recordResult(result, {
      source: "loop",
      participatesInCircuitBreaker: true,
    });

    if (!result.compacted) return state;

    // 替换 messages 数组：保留 system + 压缩后的消息 + tool 消息
    // 压缩后的消息已经包含摘要 + 最近消息
    const newMessages: Message[] = [];
    if (systemMsg) newMessages.push(systemMsg);

    // 添加压缩后的 user/assistant 消息
    for (const m of result.messages) {
      newMessages.push({ role: m.role, content: m.content });
    }

    // 保留原始 messages 中的 tool 相关消息（在最近保留范围内的）
    const keptContentSet = new Set(result.messages.map(m => m.content));
    for (let i = systemIdx; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "tool") {
        // 只保留与最近消息关联的 tool 消息
        // 简单策略：保留最后 keepRecent*2 条消息范围内的 tool 消息
        if (i >= messages.length - keepRecent * 3) {
          newMessages.push(m);
        }
      } else if (m.role === "assistant" && (m as any).tool_calls) {
        // 保留带 tool_calls 的 assistant 消息（如果在最近范围内）
        if (i >= messages.length - keepRecent * 3) {
          // 检查是否已经被压缩后的消息覆盖
          const content = typeof m.content === "string" ? m.content : "";
          if (!keptContentSet.has(content)) {
            newMessages.push(m);
          }
        }
      }
    }

    // in-place 替换
    messages.length = 0;
    messages.push(...newMessages);

    this.opts.logger?.debug?.("agent", "[compaction] in-loop compaction completed", {
      originalTokens: result.originalTokens,
      compactedTokens: result.compactedTokens,
      tier: result.tier,
      deltaMessageCount: result.deltaMessageCount,
      fallbackUsed: result.fallbackUsed,
      rebuildTriggered: result.rebuildTriggered,
    });
    this.opts.logger?.info?.("agent", "[compaction] in-loop compaction completed", {
      originalTokens: result.originalTokens,
      compactedTokens: result.compactedTokens,
      savedTokenCount: Math.max(0, result.originalTokens - result.compactedTokens),
      tier: result.tier,
      deltaMessageCount: result.deltaMessageCount,
      fallbackUsed: result.fallbackUsed,
      rebuildTriggered: result.rebuildTriggered,
    });
    await this.emitAfterCompaction({
      messageCount: result.messages.length,
      tokenCount: result.compactedTokens,
      compactedCount: historyMessages.length - result.messages.length,
      tier: result.tier,
      source: "loop",
      compactionMode: "loop",
      originalTokenCount: originalTokens,
      deltaMessageCount: result.deltaMessageCount,
      fallbackUsed: result.fallbackUsed,
      summarizerModel: this.opts.summarizerModelName,
      savedTokenCount: Math.max(0, result.originalTokens - result.compactedTokens),
      rebuildTriggered: result.rebuildTriggered,
    }, conversationId, agentId);

    return result.state;
  }
}

function mergePromptSnapshotInputMeta(
  systemPromptMetadata?: JsonObject,
  runMeta?: JsonObject,
): JsonObject | undefined {
  if (!systemPromptMetadata && !runMeta) {
    return undefined;
  }
  const merged: Record<string, unknown> = {
    ...(systemPromptMetadata ? { ...systemPromptMetadata } : {}),
    ...(runMeta ? { ...runMeta } : {}),
  };
  delete merged.promptDeltas;
  return merged as JsonObject;
}

/** 估算 messages 数组的总 token 数（用于循环内压缩判断） */
function estimateMessagesTotal(messages: Message[]): number {
  const MARGIN = 1.2;
  return estimateContextTokensFromMessages(messages, {
    includeSystem: true,
    margin: MARGIN,
  });
}

function buildRuntimeIdentityPromptDelta(input: {
  userUuid?: string;
  senderInfo?: any;
  roomContext?: any;
}): AgentPromptDelta | undefined {
  const contextLines: string[] = ["## Identity Context (Runtime)"];

  if (input.userUuid) {
    contextLines.push("- **UUID Support**: ENABLED");
    contextLines.push(`- **Current User UUID**: ${input.userUuid}`);
    contextLines.push("- You can use the `get_user_uuid` tool to retrieve this UUID at any time.");
  }

  if (input.senderInfo) {
    contextLines.push("");
    contextLines.push("### Current Message Sender");
    contextLines.push(`- **Type**: ${input.senderInfo.type}`);
    contextLines.push(`- **ID**: ${input.senderInfo.id}`);
    if (input.senderInfo.name) {
      contextLines.push(`- **Name**: ${input.senderInfo.name}`);
    }
    if (input.senderInfo.type === "agent" && input.senderInfo.identity) {
      contextLines.push(`- **Identity**: ${input.senderInfo.identity}`);
    }
    contextLines.push("- You can use the `get_message_sender_info` tool to retrieve sender information at any time.");
  }

  if (input.roomContext) {
    contextLines.push("");
    contextLines.push("### Room Context");
    contextLines.push(`- **Environment**: ${input.roomContext.environment === "community" ? "office.goddess.ai Community" : "Local WebChat"}`);
    if (input.roomContext.roomId) {
      contextLines.push(`- **Room ID**: ${input.roomContext.roomId}`);
    }
    if (input.roomContext.members && input.roomContext.members.length > 0) {
      const users = input.roomContext.members.filter((member: any) => member.type === "user");
      const agents = input.roomContext.members.filter((member: any) => member.type === "agent");
      contextLines.push(`- **Members**: ${input.roomContext.members.length} total (${users.length} users, ${agents.length} agents)`);

      const smartInjectThreshold = parseInt(process.env.BELLDANDY_ROOM_INJECT_THRESHOLD || "10", 10);
      if (input.roomContext.members.length <= smartInjectThreshold) {
        if (users.length > 0) {
          contextLines.push("  - Users:");
          users.forEach((user: any) => {
            contextLines.push(`    - ${user.name || "Unknown"} (UUID: ${user.id})`);
          });
        }

        if (agents.length > 0) {
          contextLines.push("  - Agents:");
          agents.forEach((agent: any) => {
            contextLines.push(`    - ${agent.name || "Unknown"} (Identity: ${agent.identity || "Unknown"})`);
          });
        }
      } else {
        contextLines.push("- Use the `get_room_members` tool to retrieve the full member list with details.");
      }
    }
  }

  if (input.userUuid || input.senderInfo || input.roomContext) {
    contextLines.push("");
    contextLines.push("### Identity-Based Authority Rules");
    if (input.roomContext && input.roomContext.environment === "community") {
      contextLines.push("- **Status**: ACTIVE (office.goddess.ai Community environment)");
      contextLines.push("- Identity-based authority rules (from the workspace identity profile) are now in effect.");
      contextLines.push("- You should verify sender identity before executing sensitive commands.");
    } else if (input.userUuid) {
      contextLines.push("- **Status**: ACTIVE (UUID provided)");
      contextLines.push("- Identity-based authority rules (from the workspace identity profile) are now in effect.");
    } else {
      contextLines.push("- **Status**: PARTIAL (sender info available but not in community environment)");
    }
  } else {
    return undefined;
  }

  return {
    id: "runtime-identity-context",
    deltaType: "runtime-identity",
    role: "system",
    source: "tool-agent",
    text: contextLines.join("\n").trim(),
  };
}

function buildRuntimeIdentityAuthorityPromptDelta(input: {
  authorityProfile?: IdentityAuthorityProfile;
  userUuid?: string;
  senderInfo?: any;
  roomContext?: any;
  launchSpec?: ToolExecutionRuntimeContext["launchSpec"];
}): AgentPromptDelta | undefined {
  const evaluation = evaluateRuntimeIdentityAuthority(input.authorityProfile, {
    userUuid: input.userUuid,
    senderId: input.senderInfo?.id,
    senderIdentity: input.senderInfo?.identity,
    senderType: input.senderInfo?.type,
  });
  if (!evaluation) {
    return undefined;
  }

  const lines = [
    "## Runtime Identity Authority",
    "",
    `- Authority mode: ${evaluation.authorityMode}`,
    `- Verifiable environment: ${evaluation.verifiableEnvironment ? "yes" : "no"}`,
    `- Authority active: ${evaluation.authorityActive ? "yes" : "no"}`,
    `- Current identity label: ${evaluation.currentLabel || "unknown"}`,
    `- Actor relation: ${evaluation.actorRelation}`,
    `- Recommended action: ${evaluation.recommendedAction}`,
    `- Reason: ${evaluation.reason}`,
  ];

  if (evaluation.matchedOwnerUuid) {
    lines.push(`- Matched owner UUID: ${evaluation.matchedOwnerUuid}`);
  }
  if (evaluation.matchedSuperiorLabel) {
    lines.push(`- Matched superior label: ${evaluation.matchedSuperiorLabel}`);
  }
  if (evaluation.matchedSubordinateLabel) {
    lines.push(`- Matched subordinate label: ${evaluation.matchedSubordinateLabel}`);
  }

  const team = input.launchSpec?.delegationProtocol?.team;
  if (team?.id) {
    lines.push("");
    lines.push("### Team Authority Constraints");
    lines.push(`- Team ID: ${team.id}`);
    lines.push(`- Team mode: ${team.mode}`);
    lines.push(`- Manager agent: ${team.managerAgentId || "unknown"}`);
    lines.push(`- Manager identity: ${team.managerIdentityLabel || "unknown"}`);
    switch (evaluation.recommendedAction) {
      case "execute":
        lines.push("- Team-level reprioritization or lane ownership changes may proceed if they stay inside the manager contract.");
        break;
      case "guide_only":
        lines.push("- Provide guidance, drafts, or escalation only; do not silently reassign other lanes.");
        break;
      case "escalate":
        lines.push("- Escalate peer-level authority conflicts to the manager instead of overriding team topology.");
        break;
      case "refuse_or_inform":
        lines.push("- Refuse or limit team-level changes from unrelated actors; keep the current team contract intact.");
        break;
      default:
        lines.push("- Identity authority is inactive here; do not use identity labels to change the team contract.");
        break;
    }
  }

  return {
    id: "runtime-identity-authority",
    deltaType: "runtime-identity-authority",
    role: "system",
    source: "tool-agent",
    text: lines.join("\n").trim(),
    metadata: {
      authorityMode: evaluation.authorityMode,
      authorityActive: evaluation.authorityActive,
      actorRelation: evaluation.actorRelation,
      recommendedAction: evaluation.recommendedAction,
      currentLabel: evaluation.currentLabel,
      verifiableEnvironment: evaluation.verifiableEnvironment,
      ownerUuidVerified: evaluation.ownerUuidVerified,
      senderIdentityVerified: evaluation.senderIdentityVerified,
      matchedOwnerUuid: evaluation.matchedOwnerUuid,
      matchedSuperiorLabel: evaluation.matchedSuperiorLabel,
      matchedSubordinateLabel: evaluation.matchedSubordinateLabel,
      teamId: input.launchSpec?.delegationProtocol?.team?.id,
      teamMode: input.launchSpec?.delegationProtocol?.team?.mode,
    },
  };
}

function collectRunPromptDeltas(input: {
  hookPromptDeltas?: AgentPromptDelta[];
  runtimeIdentityDelta?: AgentPromptDelta;
  runtimeIdentityAuthorityDelta?: AgentPromptDelta;
  launchSpecPromptDeltas?: AgentPromptDelta[];
  metaPromptDeltas?: AgentPromptDelta[];
  transientPromptDeltas?: AgentPromptDelta[];
}): AgentPromptDelta[] {
  const deltas: AgentPromptDelta[] = [];

  if (input.hookPromptDeltas && input.hookPromptDeltas.length > 0) {
    deltas.push(...input.hookPromptDeltas.map((delta) => ({ ...delta })));
  }
  if (input.runtimeIdentityDelta) {
    deltas.push({ ...input.runtimeIdentityDelta });
  }
  if (input.runtimeIdentityAuthorityDelta) {
    deltas.push({ ...input.runtimeIdentityAuthorityDelta });
  }
  if (input.launchSpecPromptDeltas && input.launchSpecPromptDeltas.length > 0) {
    deltas.push(...input.launchSpecPromptDeltas.map((delta) => ({ ...delta })));
  }
  if (input.metaPromptDeltas && input.metaPromptDeltas.length > 0) {
    deltas.push(...input.metaPromptDeltas.map((delta) => ({ ...delta })));
  }
  if (input.transientPromptDeltas && input.transientPromptDeltas.length > 0) {
    deltas.push(...input.transientPromptDeltas.map((delta) => ({ ...delta })));
  }

  return deltas;
}

function buildInitialMessages(
  systemPrompt: string | undefined,
  userContent: string | Array<any>,
  history?: Array<{ role: "user" | "assistant"; content: string | Array<any> }>,
  runtimePromptDeltas?: AgentPromptDelta[],
): Message[] {
  const messages: Message[] = [];

  // Layer 1: System
  const finalSystemPrompt = buildEffectiveSystemPrompt(systemPrompt, runtimePromptDeltas);

  if (finalSystemPrompt) {
    messages.push({ role: "system", content: finalSystemPrompt });
  }

  // Layer 2: History
  if (history && history.length > 0) {
    // 简单转换，tool agent 目前只支持基础 user/assistant 历史
    // 复杂 tool history 暂不还原（保持无状态简单性）
    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content as any });
      }
    }
  }

  // Layer 3: Current User Message
  messages.push({ role: "user", content: userContent });

  return messages;
}

function buildEffectiveSystemPrompt(
  systemPrompt: string | undefined,
  runtimePromptDeltas?: readonly AgentPromptDelta[],
): string {
  let finalSystemPrompt = systemPrompt?.trim() || "";
  const systemDeltaTexts = collectSystemPromptDeltaTexts(runtimePromptDeltas);
  if (systemDeltaTexts.length === 0) {
    return finalSystemPrompt;
  }

  const deltaText = systemDeltaTexts.join("\n").trim();
  return finalSystemPrompt
    ? `${finalSystemPrompt}\n${deltaText}`
    : deltaText;
}

function setSystemPromptMessage(messages: Message[], content: string): void {
  if (messages[0]?.role === "system") {
    if (content) {
      messages[0] = { role: "system", content };
    } else {
      messages.shift();
    }
    return;
  }

  if (content) {
    messages.unshift({ role: "system", content });
  }
}

/**
 * 根据 baseUrl 自动检测 API 协议类型
 */
function detectProtocol(baseUrl: string): ApiProtocol {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("anthropic.com")) {
    return "anthropic";
  }
  return "openai";
}

function normalizeWireApi(raw?: string): OpenAIWireApi | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "responses") return "responses";
  if (value === "chat_completions") return "chat_completions";
  return undefined;
}

function resolveWireApiForProfile(
  profile: { id?: string; wireApi?: string },
  defaultWireApi: OpenAIWireApi,
): OpenAIWireApi {
  const fromProfile = normalizeWireApi(profile.wireApi);
  if (fromProfile) return fromProfile;
  // fallback profile 默认走 chat_completions，避免全局 responses 导致兼容模型 404
  if (profile.id && profile.id !== "primary") return "chat_completions";
  return defaultWireApi;
}

// 辅助函数：转换 Message 对象为 OpenAI 格式（去除 undefined 字段）
function cleanupMessage(msg: Message, modelId?: string): any {
  if (msg.role === "assistant") {
    // 显式保留 reasoning_content，即使它不是标准 OpenAI 字段
    // 因为某些兼容模型（如 Kimi）需要它作为历史上下文
    const cleaned: any = {
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
      reasoning_content: msg.reasoning_content,
    };

    // [兼容性修复] 针对 Kimi/DeepSeek 等思考模型
    // 如果历史消息中缺少 reasoning_content（例如来自非思考模型 Claude），
    // 且当前请求的目标模型是思考模型，则注入空思考占位符，防止 API 报错
    const isReasoningModel = modelId && (modelId.includes("kimi") || modelId.includes("deepseek"));
    if (isReasoningModel && msg.tool_calls && !msg.reasoning_content) {
      cleaned.reasoning_content = "（思考内容已省略）";
    }

    return cleaned;
  }
  return msg;
}

function buildResponsesInputFromMessages(messages: Message[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id,
        output: msg.content,
      });
      continue;
    }

    const role = toResponsesRole(msg.role);
    const content = toResponsesContent(msg.content);

    if (typeof content !== "undefined") {
      input.push({
        type: "message",
        role,
        content,
      });
    }

    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }
  }

  return input;
}

function toResponsesRole(role: Message["role"]): "developer" | "user" | "assistant" {
  if (role === "system") return "developer";
  if (role === "assistant") return "assistant";
  return "user";
}

function toResponsesContent(content: unknown): string | Array<Record<string, unknown>> | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const mapped = content.map((part: any) => {
      if (!part || typeof part !== "object") return undefined;
      if (part.type === "text" && typeof part.text === "string") {
        return { type: "input_text", text: part.text };
      }
      if (part.type === "image_url" && typeof part.image_url?.url === "string") {
        return { type: "input_image", image_url: part.image_url.url };
      }
      if (part.type === "video_url" && typeof part.video_url?.url === "string") {
        return { type: "input_text", text: `[Video] ${part.video_url.url}` };
      }
      return undefined;
    }).filter(Boolean) as Array<Record<string, unknown>>;

    return mapped.length > 0 ? mapped : undefined;
  }

  if (typeof content === "undefined" || content === null) {
    return undefined;
  }

  return String(content);
}

function extractResponsesText(json: JsonObject): string {
  const direct = (json as any).output_text;
  if (typeof direct === "string") {
    return direct;
  }

  const output = Array.isArray((json as any).output) ? (json as any).output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!part || typeof part !== "object") continue;
        if (typeof part.text === "string" && part.text.length > 0) {
          chunks.push(part.text);
        }
      }
    }
  }

  return chunks.join("");
}

const RESPONSES_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$ref",
  "$schema",
  "$defs",
  "definitions",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  "patternProperties",
  "unevaluatedProperties",
]);

type ResponseToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
};

export function sanitizeResponsesToolDefinitions(tools: ResponseToolDefinition[]): ResponseToolDefinition[] {
  return tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      parameters: sanitizeResponsesSchemaNode(tool.function.parameters) as object,
    },
  }));
}

function sanitizeResponsesSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeResponsesSchemaNode(item))
      .filter((item) => typeof item !== "undefined");
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (RESPONSES_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    const sanitizedChild = sanitizeResponsesSchemaNode(child);
    if (typeof sanitizedChild !== "undefined") {
      output[key] = sanitizedChild;
    }
  }
  return output;
}

function extractResponsesToolCalls(json: JsonObject): OpenAIToolCall[] {
  const output = Array.isArray((json as any).output) ? (json as any).output : [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type !== "function_call") continue;

    const name = typeof item.name === "string" ? item.name : "";
    const callId = typeof item.call_id === "string"
      ? item.call_id
      : (typeof item.id === "string" ? item.id : `call_${Date.now()}`);
    const args = typeof item.arguments === "string"
      ? item.arguments
      : JSON.stringify(item.arguments ?? {});

    if (!name) continue;
    toolCalls.push({
      id: callId,
      type: "function",
      function: {
        name,
        arguments: args,
      },
    });
  }

  return toolCalls;
}

type ParsedToolCallArguments = {
  arguments: JsonObject;
  repaired: boolean;
  raw: string;
  fingerprintArguments: JsonObject;
};

function parseToolCallArguments(str: string, repairLevel: ToolCallRepairLevel): ParsedToolCallArguments {
  const raw = typeof str === "string" ? str : "";
  const direct = tryParseJsonObject(raw);
  if (direct) {
    return {
      arguments: direct,
      repaired: false,
      raw,
      fingerprintArguments: direct,
    };
  }
  if (repairLevel === "full") {
    const repairedRaw = repairIncompleteJsonObjectCandidate(raw);
    if (repairedRaw) {
      const repaired = tryParseJsonObject(repairedRaw);
      if (repaired) {
        return {
          arguments: repaired,
          repaired: true,
          raw: repairedRaw,
          fingerprintArguments: repaired,
        };
      }
    }
  }
  return {
    arguments: {},
    repaired: false,
    raw,
    fingerprintArguments: {},
  };
}

function tryParseJsonObject(str: string): JsonObject | null {
  if (typeof str !== "string" || !str.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonObject
      : null;
  } catch {
    return null;
  }
}

function repairIncompleteJsonObjectCandidate(value: string): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed.startsWith("{")) {
    return null;
  }
  const repairPlan = analyzeJsonClosure(trimmed);
  if (repairPlan.depth <= 0 && !repairPlan.inString) {
    return null;
  }
  const repaired = `${trimmed}${repairPlan.inString ? "\"" : ""}${"]".repeat(repairPlan.bracketDepth)}${"}".repeat(repairPlan.braceDepth)}`;
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

function analyzeJsonClosure(value: string): {
  depth: number;
  braceDepth: number;
  bracketDepth: number;
  inString: boolean;
} {
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") braceDepth += 1;
    else if (char === "}" && braceDepth > 0) braceDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]" && bracketDepth > 0) bracketDepth -= 1;
  }

  return {
    depth: braceDepth + bracketDepth + (inString ? 1 : 0),
    braceDepth,
    bracketDepth,
    inString,
  };
}

function buildToolCallFingerprint(toolName: string, args: JsonObject): string {
  return `${toolName}::${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return "";
  }
}

function splitText(text: string, size: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + Math.max(1, size)));
    i += Math.max(1, size);
  }
  return out;
}

/** 移除模型输出中的工具调用协议块，避免在对话中展示给用户 */
function stripToolCallsSection(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, "\n\n（正在执行操作）\n\n")
    .replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 输入 token 预检：估算 messages + tools 的总 token 数，
 * 超限时从历史消息（非 system、非最后一条 user）开始裁剪。
 * 直接修改 messages 数组（in-place）。
 */
function trimMessagesToFit(
  messages: Message[],
  tools: { type: "function"; function: { name: string; description: string; parameters: object } }[] | undefined,
  maxTokens: number,
): void {
  const SAFETY_MARGIN = 1.2;

  // 估算工具定义的 token 数（只算一次）
  let toolsTokens = 0;
  if (tools) {
    for (const t of tools) {
      toolsTokens += estimateToolDefinitionTokens(t);
    }
  }

  // 估算总 token
  const estimateTotal = () => {
    return toolsTokens + estimateContextTokensFromMessages(messages, {
      includeSystem: true,
      margin: SAFETY_MARGIN,
    });
  };

  let total = estimateTotal();
  if (total <= maxTokens) return;

  // 找到可裁剪的历史消息索引（跳过 system 和最后一条 user）
  // messages 结构：[system?, ...history(user/assistant), current_user]
  // 从 index 1 开始裁剪（保留 system），保留最后一条（current user）
  while (total > maxTokens && messages.length > 2) {
    // 找第一条非 system 消息（但不是最后一条）
    const idx = messages.findIndex((m, i) => m.role !== "system" && i < messages.length - 1);
    if (idx === -1) break;
    messages.splice(idx, 1);
    total = estimateTotal();
  }
}

function contentToTokenEstimateString(content: unknown): string {
  if (typeof content === "string") {
    return sanitizeStringForTokenEstimate(content);
  }
  if (typeof content === "undefined" || content === null) {
    return "";
  }
  try {
    return JSON.stringify(content, tokenEstimateJsonReplacer);
  } catch {
    return String(content);
  }
}

function tokenEstimateJsonReplacer(key: string, value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const sanitized = sanitizeStringForTokenEstimate(value);
  if (sanitized !== value) {
    return sanitized;
  }
  if (BASE64_FIELD_KEY_RE.test(key) && value.length > 128) {
    return `[base64:${value.length} chars omitted for token estimate]`;
  }
  return value;
}

function sanitizeStringForTokenEstimate(value: string): string {
  if (!value) return value;
  const prefixMatch = value.match(DATA_URI_BASE64_PREFIX_RE);
  if (!prefixMatch) {
    return value;
  }
  const commaIndex = value.indexOf(",");
  const encoded = commaIndex >= 0 ? value.slice(commaIndex + 1).replace(/\s+/g, "") : "";
  const mime = prefixMatch[1] || "unknown";
  return `[data-uri:${mime};base64:${encoded.length} chars omitted for token estimate]`;
}
