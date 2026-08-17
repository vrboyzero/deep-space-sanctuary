/**
 * 工具增强型 Agent
 *
 * 支持工具调用的 Agent 实现，集成完整的钩子系统。
 */

import {
  evaluateRuntimeIdentityAuthority,
  readResponseTextBounded,
  type IdentityAuthorityProfile,
  type JsonObject,
} from "@belldandy/protocol";
import type { ToolExecutionRuntimeContext, ToolExecutor, ToolCallRequest, ToolFailureKind } from "@belldandy/skills";
import type { AgentBudgetExhausted, AgentInterrupted, AgentRunInput, AgentStreamItem, AgentUsage, BelldandyAgent, AgentHooks } from "./index.js";
import type { HookRunner } from "./hook-runner.js";
import { AgentEndLedger } from "./agent-end-ledger.js";
import type { AfterCompactionEvent, BeforeCompactionEvent, HookAgentContext, HookToolContext, HookToolResultPersistContext } from "./hooks.js";
import {
  FailoverAttemptError,
  FailoverClient,
  type ModelMessageLayout,
  type ModelProfile,
  type FailoverExecutionSummary,
  type FailoverLogger,
} from "./failover-client.js";
import {
  consumeModelResponseStreamWithFailover,
  toAgentInterrupted,
} from "./model-response-stream-failover.js";
import {
  createModelStreamTextDelivery,
  type ModelStreamTextDelivery,
} from "./model-stream-delivery.js";
import { applyOpenAICompatibleReasoningConfig } from "./openai-reasoning.js";
import {
  applyOpenAICompatibleToolChoice,
  disableDeepSeekThinking,
} from "./openai-tool-choice.js";
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
  createCompressionPipeline,
  createCompressionPipelineWithStore,
  PersistentCompressionReferenceStore,
  coldResumePruneMessages,
  pruneBeforeSummarize,
  hasCompressionMarker,
  hasLegacyCompressionMarker,
  isAnyCompactedContent,
  parseCompressionMarker,
  wrapWithMarker,
  rewriteMarkerRetrievable,
  type CompressionBatchResult,
  type CompressionPolicy,
  type CompressionReferenceStore,
  type CompressionResult,
  type CompressionSourceKind,
  type ContextCompressionPipeline,
} from "./context-compression/index.js";
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
import {
  resolveBudgetProtectOptions,
  computeProtectedIndices,
  isCompressibleHistoryMessage,
  isDeletableHistoryMessage,
  createEmptyBudgetProtectDiagnostics,
  type BudgetProtectOptions,
  type BudgetProtectMode,
} from "./budget-protect.js";
import {
  applyStablePrefixSplitMessageLayout,
  splitDeltasByStability,
  buildTransientTailText,
  buildIndependentBlockText,
  isTransientSafeDelta,
  isIndependentBlockDelta,
  type StablePrefixSplitOptions,
  type StablePrefixSplitResult,
} from "./stable-prefix-split.js";
import {
  buildBudgetCompetition,
  buildPrefixShape,
  classifyPrefixDrift,
  readPrefixComparableSnapshot,
} from "./prompt-budget-observability.js";
import { selectToolMessagesForCompression } from "./tool-result-adaptive-keep.js";
import { createStructuredOutputSession } from "./structured-output.js";
import { filterProviderControlFrameSuffix } from "./provider-control-frame.js";
import {
  isBareAgentAutomationProfile,
  selectAgentAutomationPromptDeltas,
} from "./agent-run-automation.js";
import {
  createReActRunAbortController,
  MODEL_LOOP_COST_CONTAINMENT_LIMITS,
  normalizeMaxHighRiskToolCalls,
  normalizeMaxRunWallTimeMs,
  normalizeMaxTotalTokens,
  ReActRunBudgetTracker,
  type ReActRunAbortController,
} from "./react-run-budget.js";
import {
  buildReactFinalizationRequest,
  REACT_FINALIZATION_INPUT_SAFETY_FACTOR,
  REACT_FINALIZATION_OUTPUT_TOKEN_RESERVE,
  type ReactFinalizationRequest,
} from "./react-finalization.js";
import {
  areWorkspaceMutationNavigationToolCallsAllowed,
  buildWorkspaceMutationContinuationPlan,
  buildWorkspaceMutationInputCorrectionPlan,
  buildWorkspaceMutationNavigationRequest,
  buildWorkspaceMutationObjectiveReviewRequest,
  buildWorkspaceMutationRecoveryPlan,
  buildWorkspaceMutationVerificationRequest,
  coalesceWorkspaceMutationApplyPatchToolCalls,
  formatWorkspaceMutationPatchHunkDiagnostics,
  formatWorkspaceMutationUnexpectedEndMarkerDiagnostics,
  hasOnlyWorkspaceMutationPatchPaths,
  inspectContextOnlyWorkspaceMutationPatchPreservation,
  inspectWorkspaceMutationPatchHunks,
  isCompleteWorkspaceMutationVerificationReadResult,
  normalizeWorkspaceMutationRecoveryToolCall,
  retainActionableWorkspaceMutationPatchSections,
  retainMissingWorkspaceMutationPatchSections,
  selectWorkspaceMutationNavigationToolDefinitions,
  selectRequiredWorkspaceMutationNavigationToolCalls,
  selectRequiredWorkspaceMutationVerificationToolCalls,
  selectWorkspaceMutationToolDefinitions,
  WORKSPACE_MUTATION_NAVIGATION_INPUT_TOKEN_LIMIT,
  WORKSPACE_MUTATION_NAVIGATION_OUTPUT_TOKEN_RESERVE,
  WORKSPACE_MUTATION_NAVIGATION_MAX_FILE_READ_CALLS,
  WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE,
  type WorkspaceMutationNavigationRequest,
  type WorkspaceMutationRecoveryPlan,
  type WorkspaceMutationRecoveryRequest,
  type WorkspaceMutationVerificationRequest,
} from "./react-workspace-mutation.js";
import {
  buildBoundedStructuredOutputRepairRequest,
  type BoundedStructuredOutputRepairRequest,
} from "./react-structured-output-repair.js";
import {
  createWorkspaceMutationPathCoverage,
  hasOnlyWorkspaceMutationChangedPaths,
} from "./workspace-mutation-coverage.js";

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
/** 默认值只覆盖未配置场景；显式 iteration=0 仍保留旧版无限语义。 */
export const DEFAULT_TOOL_LOOP_ITERATION_BUDGET = 8;
export const DEFAULT_MAX_TOOL_CALLS = 32;
const MIN_REASONING_DEDUPE_CHARS = 96;
const STOP_REQUESTED_ERROR = "__BELLDANDY_STOP_REQUESTED__";
const CARRYOVER_CONTEXT_TOOL_LIMIT = 12;
const CARRYOVER_CONTEXT_FACT_LIMIT = 4;
const CARRYOVER_CONTEXT_IMPORTANT_TOOLS = new Set([
  "file_read",
  "conversation_read",
  "retrieve_tool_result",
  "log_read",
  "log_search",
  "browser_get_content",
  "run_command",
]);

/**
 * reasoning_content 回传策略
 *
 * Phase 0 live probe 证据（2026-06-23, deepseek-v4-pro）：
 * - tool_calls turn 不带 reasoning_content 时 status=200，不报 400
 * - reasoning_content 回传抬升 521 prompt tokens（+60%）
 *
 * 策略：
 * - required_on_tool_call_turn: 仅在 provider 必需时保留 tool_calls turn 的 reasoning_content
 * - allowed_but_strip_elsewhere: 非 tool_calls turn 默认不回传
 * - must_preserve_full_reasoning: 全量保留（向后兼容）
 *
 * 默认行为可通过 env BELLDANDY_REASONING_CONTENT_POLICY 覆盖。
 */
type ReasoningContentPolicy = "required_on_tool_call_turn" | "allowed_but_strip_elsewhere" | "must_preserve_full_reasoning";

function resolveReasoningContentPolicy(): ReasoningContentPolicy {
  const raw = String(process.env.BELLDANDY_REASONING_CONTENT_POLICY ?? "").trim().toLowerCase();
  if (raw === "must_preserve_full_reasoning") return "must_preserve_full_reasoning";
  if (raw === "allowed_but_strip_elsewhere") return "allowed_but_strip_elsewhere";
  // 默认：最小回传
  return "required_on_tool_call_turn";
}

/** 判断模型是否属于已知需要 reasoning_content 占位的思考模型 */
function isKnownReasoningModel(modelId?: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  // kimi 仍需要占位（未做 live probe 验证，保守保留）
  if (lower.includes("kimi")) return true;
  // deepseek-v4-pro 已通过 live probe 验证不需要占位
  // 但 deepseek-reasoner 等旧模型可能仍需要，保守保留
  if (lower.includes("deepseek-reasoner")) return true;
  return false;
}
const toolDefinitionTokenEstimateCache = new WeakMap<object, {
  name: string;
  description: string;
  tokens: number;
}>();

type TokenEstimateContext = {
  model?: string;
};

export type ToolEnabledAgentOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  toolExecutor: ToolExecutor;
  timeoutMs?: number;
  /** Provider streaming gray switch. Missing or false keeps the buffered product path. */
  streamingEnabled?: boolean;
  /** 单次 run 可执行的工具调用总数上限，0 表示不允许执行工具调用。 */
  maxToolCalls?: number;
  /** 单次 ReAct run 的 wall-time 上限（毫秒）；非正或非法值回退到安全默认值。 */
  maxRunWallTimeMs?: number;
  /** 单次 ReAct run 的累计 token 上限；非正或非法值回退到安全默认值。 */
  maxTotalTokens?: number;
  /** 单次 ReAct run 可实际执行的高风险 Tool 次数；0 表示禁止高风险 Tool。 */
  maxHighRiskToolCalls?: number;
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
  /** OpenAI-compatible 请求体顶层透传字段（保留字段会被忽略） */
  requestBodyExtras?: Record<string, unknown>;
  /** 单模型消息布局兼容模式（用于本地 chat template 兼容） */
  messageLayout?: ModelMessageLayout;
  /** 启动阶段预置冷却（毫秒） */
  bootstrapProfileCooldowns?: Record<string, number>;
  /** ReAct 循环内压缩配置（可选） */
  compaction?: CompactionOptions;
  /** 工具结果轻压缩配置（可选） */
  microcompact?: MicrocompactOptions;
  /** Phase 3：预算保护策略配置（可选，默认 protect_memory_capability） */
  budgetProtect?: BudgetProtectOptions;
  /** Phase 4：stable prefix / transient tail 拆层配置（可选，默认 false） */
  stablePrefixSplit?: StablePrefixSplitOptions;
  /** 统一上下文压缩层配置（可选，Phase 1 新增；Phase 2 扩展 referenceStore） */
  compression?: {
    enabled?: boolean;
    policy?: Partial<CompressionPolicy>;
    /** Phase 2：是否启用引用存储（原文回取）。默认 false，与 Phase 1 行为一致 */
    enableReferenceStore?: boolean;
    /** Phase 4：是否启用工具结果持久 reference store。默认 false，避免敏感输出默认落盘 */
    persistentReferenceStore?: {
      enabled?: boolean;
      stateDir: string;
      ttlMs?: number;
      maxEntries?: number;
    };
  };
  /** 统一上下文压缩层实例（可选，用于外部注入或测试） */
  compressionPipeline?: ContextCompressionPipeline;
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

type ToolCallExecutionTrace = {
  fingerprint: string;
  toolName: string;
  args: JsonObject;
  success?: boolean;
  failureKind?: ToolFailureKind;
};

type StarweaverActiveNotifySummaryItem = {
  recommendedPeek?: string;
  signalKind?: string;
  actorId?: string;
  sessionId?: string;
  gameId?: string;
};

type StarweaverVisibleNotifyPayload = {
  notificationItems: StarweaverActiveNotifySummaryItem[];
  prelude?: string;
};

type EffectiveSystemPromptState = {
  text: string;
  truncationReason?: JsonObject;
  bypassProviderNativeSystemBlocks: boolean;
};

type PromptTrimDiagnostics = {
  trimmedMessageCount: number;
  trimmedHistoryTokens: number;
  /** Phase 3：budget protect 诊断 */
  budgetProtect?: {
    mode: string;
    compressedHistoryCount: number;
    compressedHistorySavedTokens: number;
    deletedHistoryCount: number;
    deletedHistoryTokens: number;
    protectedRounds: number;
    protectionActivated: boolean;
  };
};

type HistoryCompressionContext = {
  pipeline?: ContextCompressionPipeline;
  conversationId?: string;
  runId?: string;
  agentId?: string;
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

function inferHistoryCompressionSourceKind(message: Message): CompressionSourceKind {
  if (typeof message.content !== "string") {
    return "manual";
  }
  const trimmed = message.content.trim();
  if (!trimmed) {
    return "manual";
  }
  try {
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && JSON.parse(trimmed)) {
      return "tool_result";
    }
  } catch {
    // not json-shaped enough, continue with other heuristics
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "tool_result";
  }
  if (/^(.+?):(\d+):/m.test(trimmed) || /\b(rg|grep|ripgrep)\b/i.test(trimmed)) {
    return "search_result";
  }
  if (/^\s*(import|export|function|class|def |const |let |var |public |private |async )\b/m.test(trimmed)) {
    return "code_snippet";
  }
  return "manual";
}

async function compressHistoryMessageForBudgetProtect(
  message: Message,
  ctx: HistoryCompressionContext,
  tokenEstimateContext?: TokenEstimateContext,
): Promise<{
  applied: boolean;
  content?: string;
  savedTokens?: number;
}> {
  if (!ctx.pipeline || typeof message.content !== "string" || !message.content.trim()) {
    return { applied: false };
  }
  if (isAnyCompactedContent(message.content)) {
    return { applied: false };
  }

  const result = await ctx.pipeline.compress({
    sourceKind: inferHistoryCompressionSourceKind(message),
    sourceName: message.role === "assistant" ? "assistant_history" : "user_history",
    content: message.content,
    conversationId: ctx.conversationId,
    runId: ctx.runId,
    agentId: ctx.agentId,
  });
  if (!result.applied || result.compressedContent.length >= message.content.length) {
    return { applied: false };
  }

  const originalTokens = estimateMessageContentTokens(message.content, tokenEstimateContext);
  const compressedTokens = estimateMessageContentTokens(result.compressedContent, tokenEstimateContext);
  const savedTokens = Math.max(0, originalTokens - compressedTokens);
  if (savedTokens <= 0) {
    return { applied: false };
  }

  return {
    applied: true,
    content: result.compressedContent,
    savedTokens,
  };
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

function estimateMessageContentTokens(content: unknown, tokenEstimateContext?: TokenEstimateContext): number {
  return estimateTokens(contentToTokenEstimateString(content) ?? "", tokenEstimateContext);
}

function readEnvFlag(name: string): boolean {
  return String(process.env[name] ?? "false").trim().toLowerCase() === "true";
}

function readEnvPositiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function parseStarweaverNotificationItems(output: string): StarweaverActiveNotifySummaryItem[] {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return [];
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      recommendedPeek:
        typeof item.recommendedPeek === "string" ? item.recommendedPeek : undefined,
      signalKind: typeof item.signalKind === "string" ? item.signalKind : undefined,
      actorId: typeof item.actorId === "string" ? item.actorId : undefined,
      sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
      gameId: typeof item.gameId === "string" ? item.gameId : undefined,
    }));
}

function buildStarweaverActiveNotifyPrelude(input: {
  notificationItems: StarweaverActiveNotifySummaryItem[];
  peeks: Array<{ toolName: string; output: string }>;
}): string | undefined {
  if (input.notificationItems.length === 0 && input.peeks.length === 0) {
    return undefined;
  }

  const lines: string[] = [
    "StarWeaver active notify preflight:",
  ];

  if (input.notificationItems.length > 0) {
    lines.push(
      ...input.notificationItems.slice(0, 3).map((item, index) => {
        const parts = [
          `#${index + 1}`,
          item.signalKind ? `signal=${item.signalKind}` : "",
          item.recommendedPeek ? `peek=${item.recommendedPeek}` : "",
          item.actorId ? `actor=${item.actorId}` : "",
          item.sessionId ? `session=${item.sessionId}` : "",
          item.gameId ? `game=${item.gameId}` : "",
        ].filter(Boolean);
        return `- ${parts.join(" ")}`;
      }),
    );
  }

  if (input.peeks.length > 0) {
    lines.push(
      ...input.peeks.map((item) => `- ${item.toolName}: ${item.output}`),
    );
  }

  return lines.join("\n");
}

function estimateAssistantHistoryOverhead(message: Message, tokenEstimateContext?: TokenEstimateContext): number {
  if (message.role !== "assistant") {
    return 0;
  }

  let total = 0;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    total += estimateTokens(JSON.stringify(message.tool_calls), tokenEstimateContext);
  }
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    total += estimateTokens(sanitizeStringForTokenEstimate(message.reasoning_content.trim()), tokenEstimateContext);
  }
  return total;
}

function readToolExecutionRuntimeContext(meta?: JsonObject): ToolExecutionRuntimeContext | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const launchSpec = (meta as Record<string, unknown>)._agentLaunchSpec;
  const requestChannel = (meta as Record<string, unknown>)._toolRequestChannel;
  const workspaceRevisionId = (meta as Record<string, unknown>).runId;
  const hasLaunchSpec = Boolean(launchSpec) && typeof launchSpec === "object" && !Array.isArray(launchSpec);
  const hasWorkspaceRevisionId = typeof workspaceRevisionId === "string" && workspaceRevisionId.trim().length > 0;
  const channel = requestChannel === "cli"
    || requestChannel === "web"
    || requestChannel === "browser-extension"
    || requestChannel === "gateway"
    ? requestChannel
    : undefined;
  if (!hasLaunchSpec && !channel && !hasWorkspaceRevisionId) {
    return undefined;
  }
  return {
    ...(hasLaunchSpec ? { launchSpec: launchSpec as ToolExecutionRuntimeContext["launchSpec"] } : {}),
    ...(channel ? { channel } : {}),
    ...(hasWorkspaceRevisionId ? { agentRunId: workspaceRevisionId.trim() } : {}),
    ...(hasWorkspaceRevisionId ? { workspaceRevisionId: workspaceRevisionId.trim() } : {}),
  };
}

function estimateContextTokensFromMessages(
  messages: Message[],
  opts?: { includeSystem?: boolean; margin?: number },
  tokenEstimateContext?: TokenEstimateContext,
): number {
  let total = 0;
  for (const message of messages) {
    if (!opts?.includeSystem && message.role === "system") {
      continue;
    }
    total += estimateMessageContentTokens(message.content, tokenEstimateContext) + 4;
    total += estimateAssistantHistoryOverhead(message, tokenEstimateContext);
  }
  if (opts?.margin && opts.margin > 0) {
    return Math.ceil(total * opts.margin);
  }
  return total;
}

function estimateSystemPromptTokens(messages: Message[], tokenEstimateContext?: TokenEstimateContext): number {
  let total = 0;
  for (const message of messages) {
    if (message.role !== "system") {
      continue;
    }
    total += estimateMessageContentTokens(message.content, tokenEstimateContext);
  }
  return total;
}

function buildUsageCalibration(input: {
  estimatedPromptTokens: number;
  actualInputTokens: number;
  modelCalls: number;
}): AgentUsage["usageCalibration"] | undefined {
  const estimatedPromptTokens = Math.max(0, Number(input.estimatedPromptTokens ?? 0));
  const actualInputTokens = Math.max(0, Number(input.actualInputTokens ?? 0));
  const modelCalls = Math.max(0, Number(input.modelCalls ?? 0));
  if (estimatedPromptTokens <= 0 || actualInputTokens <= 0 || modelCalls <= 0) {
    return undefined;
  }

  const averageInputTokensPerCall = actualInputTokens / modelCalls;
  const deltaTokens = averageInputTokensPerCall - estimatedPromptTokens;
  const deltaRatio = estimatedPromptTokens > 0 ? deltaTokens / estimatedPromptTokens : 0;
  const absDeltaRatio = Math.abs(deltaRatio);
  const status = absDeltaRatio <= 0.15
    ? "aligned"
    : deltaRatio > 0
      ? "under_estimated"
      : "over_estimated";

  return {
    estimatedPromptTokens,
    actualInputTokens,
    modelCalls,
    averageInputTokensPerCall,
    deltaTokens,
    deltaRatio,
    status,
  };
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
  const conversationId = typeof args.conversation_id === "string" ? args.conversation_id.trim() : "";
  if (conversationId) {
    const view = typeof args.view === "string" ? args.view.trim() : "";
    return view ? `${conversationId}#${view}` : conversationId;
  }
  const pageUrl = typeof args.pageUrl === "string" ? args.pageUrl.trim() : "";
  if (pageUrl) {
    return compactToolDigestText(pageUrl, 120);
  }
  const browserUrl = typeof args.url === "string" ? args.url.trim() : "";
  if (browserUrl) {
    return compactToolDigestText(browserUrl, 120);
  }
  const logQuery = typeof args.query === "string" ? args.query.trim() : "";
  if (logQuery) {
    const startDate = typeof args.startDate === "string" ? args.startDate.trim() : "";
    const endDate = typeof args.endDate === "string" ? args.endDate.trim() : "";
    const range = [startDate, endDate].filter(Boolean).join("..");
    return compactToolDigestText(range ? `${logQuery} @ ${range}` : logQuery, 120);
  }
  const logDate = typeof args.date === "string" ? args.date.trim() : "";
  if (logDate) {
    const moduleName = typeof args.module === "string" ? args.module.trim() : "";
    const keyword = typeof args.keyword === "string" ? args.keyword.trim() : "";
    const suffix = [moduleName && `module=${moduleName}`, keyword && `keyword=${keyword}`].filter(Boolean).join(" ");
    return compactToolDigestText(suffix ? `${logDate} ${suffix}` : logDate, 120);
  }
  const candidateKeys = ["path", "file", "filename", "url", "query", "command", "cwd", "sessionId"];
  for (const key of candidateKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return compactToolDigestText(value.trim(), 120);
    }
  }
  return undefined;
}

function buildCarryoverSourceKey(toolName: string, args: JsonObject, target?: string): string {
  const normalizedTarget = typeof target === "string" ? target.trim() : "";
  if (normalizedTarget) {
    return `${toolName}:${normalizedTarget}`;
  }
  const projectedArgs = projectRecentToolResultArgs(args);
  const serializedArgs = compactToolDigestText(JSON.stringify(projectedArgs || {}), 120);
  return `${toolName}:${serializedArgs || "{}"}`;
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

function isMeaningfulRecentToolArgValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (value === null || typeof value === "undefined") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => isMeaningfulRecentToolArgValue(item));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      isMeaningfulRecentToolArgValue(item),
    );
  }
  return String(value).trim().length > 0;
}

function projectRecentToolResultArgsValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    const compacted = compactRecentToolArgString(value);
    return compacted || undefined;
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
    const filteredItems = projectedItems.filter((item) => isMeaningfulRecentToolArgValue(item));
    if (value.length > RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT) {
      filteredItems.push(`[+${value.length - RECENT_TOOL_RESULT_ARG_ARRAY_PREVIEW_LIMIT} more items]`);
    }
    return filteredItems.length > 0 ? filteredItems : undefined;
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
    const projectedValue = projectRecentToolResultArgsValue(entryValue, depth + 1);
    if (isMeaningfulRecentToolArgValue(projectedValue)) {
      projected[key] = projectedValue as JsonObject[keyof JsonObject];
    }
  }
  if (entries.length > RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT) {
    projected.__truncatedKeys = entries.length - RECENT_TOOL_RESULT_ARG_OBJECT_PREVIEW_LIMIT;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
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
    return DEFAULT_TOOL_LOOP_ITERATION_BUDGET;
  }
  return value <= 0 ? 0 : Math.max(1, Math.floor(value));
}

function normalizeMaxToolCalls(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_TOOL_CALLS;
  }
  return Math.max(0, Math.floor(value));
}

function normalizePositiveRunLimit(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizePositiveCostUsd(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function restrictRunLimit(configured: number, requested: unknown): number {
  const requestedLimit = normalizePositiveRunLimit(requested);
  if (requestedLimit === undefined) return configured;
  if (configured <= 0) return requestedLimit;
  return Math.min(configured, requestedLimit);
}

function restrictHighRiskToolCallLimit(configured: number, requested: unknown): number {
  const requestedLimit = Number(requested);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 0) return configured;
  if (configured === 0) return requestedLimit;
  if (requestedLimit === 0) return configured;
  return Math.min(configured, requestedLimit);
}

function resolveRunBudgets(input: {
  launchSpec?: ToolExecutionRuntimeContext["launchSpec"];
  maxRunWallTimeMs: number;
  maxTotalTokens: number;
  toolLoopIterationBudget: number;
  maxHighRiskToolCalls: number;
}): {
  maxRunWallTimeMs: number;
  maxTotalTokens: number;
  toolLoopIterationBudget: number;
  maxHighRiskToolCalls: number;
  maxCostUsd?: number;
} {
  return {
    maxRunWallTimeMs: restrictRunLimit(input.maxRunWallTimeMs, input.launchSpec?.maxRunWallTimeMs),
    maxTotalTokens: restrictRunLimit(input.maxTotalTokens, input.launchSpec?.maxTotalTokens),
    toolLoopIterationBudget: restrictRunLimit(input.toolLoopIterationBudget, input.launchSpec?.toolLoopIterationBudget),
    maxHighRiskToolCalls: restrictHighRiskToolCallLimit(
      input.maxHighRiskToolCalls,
      input.launchSpec?.maxHighRiskToolCalls,
    ),
    ...(normalizePositiveCostUsd(input.launchSpec?.maxCostUsd) !== undefined
      ? { maxCostUsd: normalizePositiveCostUsd(input.launchSpec?.maxCostUsd) }
      : {}),
  };
}

function hasUsagePricing(pricing: ModelUsagePricing | undefined): pricing is ModelUsagePricing {
  return Boolean(
    pricing
    && Number.isFinite(pricing.inputUsdPer1M)
    && pricing.inputUsdPer1M >= 0
    && Number.isFinite(pricing.outputUsdPer1M)
    && pricing.outputUsdPer1M >= 0,
  );
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
    args: input.success ? projectRecentToolResultArgs(input.args) : undefined,
    isSynthetic: input.isSynthetic,
  };
}

function buildCarryoverFacts(input: {
  summary: string;
  target?: string;
  output?: string;
  error?: string;
}): string[] {
  const facts = [
    input.target ? `target: ${compactToolDigestText(input.target, 180)}` : "",
    input.output ? `result: ${compactToolDigestText(input.output, 220)}` : "",
    input.error ? `error: ${compactToolDigestText(input.error, 220)}` : "",
    input.summary ? `summary: ${compactToolDigestText(input.summary, 220)}` : "",
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(facts)].slice(0, CARRYOVER_CONTEXT_FACT_LIMIT);
}

function projectCarryoverToolOutput(toolName: string, output: string | undefined): string | undefined {
  if (toolName !== "file_read" || !output) return output;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const content = (parsed as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
  } catch {
    // 兼容返回纯文本或旧格式结果的 file_read 实现。
  }
  return output;
}

function inferCarryoverSourceType(toolName: string): "file_read" | "conversation_read" | "tool_result" | "log_read" | "web_result" | "other" {
  switch (toolName) {
    case "file_read":
      return "file_read";
    case "conversation_read":
      return "conversation_read";
    case "log_read":
    case "log_search":
      return "log_read";
    case "browser_get_content":
      return "web_result";
    default:
      return "tool_result";
  }
}

function buildCarryoverContextRecord(input: {
  toolName: string;
  args: JsonObject;
  success: boolean;
  output?: string;
  error?: string;
  toolCallId?: string;
}) {
  if (!CARRYOVER_CONTEXT_IMPORTANT_TOOLS.has(input.toolName)) {
    return undefined;
  }
  const digest = buildToolDigestRecord(input);
  const carryoverOutput = projectCarryoverToolOutput(input.toolName, input.output);
  const keyFacts = buildCarryoverFacts({
    summary: digest.summary,
    target: digest.target,
    output: input.success ? carryoverOutput : undefined,
    error: input.success ? undefined : input.error,
  });
  const summary = input.success
    ? compactToolDigestText(carryoverOutput || digest.summary, 420)
    : compactToolDigestText(input.error || digest.summary, 420);
  if (!summary || (summary.length < 48 && keyFacts.length === 0)) {
    return undefined;
  }

  const titleBase = digest.target
    ? `${input.toolName}: ${digest.target}`
    : input.toolName;
  const priority = input.success
    ? Math.min(10, 4 + keyFacts.length + (summary.length >= 160 ? 2 : 0))
    : Math.min(10, 6 + keyFacts.length);

  return {
    sourceType: inferCarryoverSourceType(input.toolName),
    sourceKey: buildCarryoverSourceKey(input.toolName, input.args, digest.target),
    title: compactToolDigestText(titleBase, 120),
    summary,
    keyFacts,
    tokenEstimate: estimateTokens([summary, ...keyFacts].join("\n")),
    lastUsedAt: Date.now(),
    priority,
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
  metadata?: JsonObject;
}): void {
  if (!input.conversationStore) return;
  const argsWithMetadata = cloneJsonObject(input.args) ?? {};
  if (input.toolName === "browser_get_content") {
    const pageUrl = typeof input.metadata?.pageUrl === "string" ? input.metadata.pageUrl.trim() : "";
    if (pageUrl) {
      argsWithMetadata.pageUrl = pageUrl;
    }
  }
  const toolDigest = buildToolDigestRecord({
    toolName: input.toolName,
    args: argsWithMetadata,
    success: input.success,
    output: input.output,
    error: input.error,
    toolCallId: input.toolCallId,
  });
  const recentToolResult = buildRecentToolResultRecord({
    toolName: input.toolName,
    args: argsWithMetadata,
    success: input.success,
    output: input.output,
    error: input.error,
    failureKind: input.failureKind,
    toolCallId: input.toolCallId,
    isSynthetic: input.isSynthetic,
  });
  const carryoverRecord = buildCarryoverContextRecord({
    toolName: input.toolName,
    args: argsWithMetadata,
    success: input.success,
    output: input.output,
    error: input.error,
    toolCallId: input.toolCallId,
  });
  input.conversationStore.recordToolArtifacts(input.conversationId, {
    toolDigest,
    recentToolResult,
    ...(carryoverRecord
      ? {
          carryoverContext: carryoverRecord,
          carryoverContextLimit: CARRYOVER_CONTEXT_TOOL_LIMIT,
        }
      : {}),
  });
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

function buildToolCallSuppressedResult(input: {
  toolCallId: string;
  toolName: string;
  error: string;
  duplicateCount?: number;
  metadata: JsonObject;
}) {
  return {
    id: input.toolCallId,
    name: input.toolName,
    success: false,
    output: "",
    error: input.error,
    failureKind: "business_logic_error" as const,
    metadata: {
      ...(typeof input.duplicateCount === "number" ? { duplicateCount: input.duplicateCount } : {}),
      ...input.metadata,
    } as JsonObject,
  };
}

function normalizeThrashArgValue(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeThrashArgValue(item)).join("|");
  }
  if (value && typeof value === "object") {
    return stableStringify(value);
  }
  return "";
}

function buildToolCallThrashSignature(args: JsonObject): string {
  const entries = Object.entries(args)
    .map(([key, value]) => {
      const normalizedValue = normalizeThrashArgValue(value);
      if (!normalizedValue) {
        return "";
      }
      return `${key.toLowerCase()}=${normalizedValue}`;
    })
    .filter(Boolean)
    .sort();
  return entries.join("&");
}

function isNearDuplicateToolCall(
  left: ToolCallExecutionTrace | undefined,
  right: ToolCallExecutionTrace,
): boolean {
  if (!left || left.toolName !== right.toolName) {
    return false;
  }
  if (left.fingerprint === right.fingerprint) {
    return true;
  }
  const leftSignature = buildToolCallThrashSignature(left.args);
  const rightSignature = buildToolCallThrashSignature(right.args);
  if (!leftSignature || !rightSignature) {
    return false;
  }
  if (leftSignature === rightSignature) {
    return true;
  }
  return leftSignature.includes(rightSignature) || rightSignature.includes(leftSignature);
}

function detectCrossToolThrash(
  history: ToolCallExecutionTrace[],
  current: ToolCallExecutionTrace,
): { partnerToolName?: string; loopSize?: number } | undefined {
  if (history.length < 2) {
    return undefined;
  }
  const last = history[history.length - 1];
  const previous = history[history.length - 2];
  if (!last || !previous) {
    return undefined;
  }
  if (current.toolName === last.toolName || current.toolName !== previous.toolName) {
    return undefined;
  }
  if (last.toolName === previous.toolName) {
    return undefined;
  }
  const currentSignature = buildToolCallThrashSignature(current.args);
  const previousSignature = buildToolCallThrashSignature(previous.args);
  if (!currentSignature || !previousSignature || currentSignature !== previousSignature) {
    return undefined;
  }
  return {
    partnerToolName: last.toolName,
    loopSize: 3,
  };
}

export type ConversationReleaseRuntimeSnapshot = {
  pendingConversationReleaseCount: number;
  compressionReferences: {
    releaseCount: number;
    prunedCount: number;
    currentRetainedCount: number;
    unsupportedReleaseCount: number;
    failureCount: number;
  };
};

export class ToolEnabledAgent implements BelldandyAgent {
  private conversationRunChains = new Map<string, Promise<void>>();
  private pendingConversationReleases = new Map<string, Promise<void>>();
  private starweaverActiveNotifyLastRunAt = new Map<string, number>();
  private starweaverVisibleNotifyFingerprint = new Map<string, string>();
  private readonly compressionReferenceReleaseRuntime = {
    releaseCount: 0,
    prunedCount: 0,
    currentRetainedCount: 0,
    unsupportedReleaseCount: 0,
    failureCount: 0,
  };
  private readonly opts: Required<Pick<ToolEnabledAgentOptions, "timeoutMs" | "streamingEnabled" | "maxToolCalls" | "maxRunWallTimeMs" | "maxTotalTokens" | "maxHighRiskToolCalls" | "toolLoopIterationBudget" | "toolLoopWarningFraction" | "wireApi" | "maxRetries" | "retryBackoffMs" | "sanitizeResponsesToolSchema" | "toolCallRepairLevel">> &
    Omit<ToolEnabledAgentOptions, "timeoutMs" | "streamingEnabled" | "maxToolCalls" | "maxRunWallTimeMs" | "maxTotalTokens" | "maxHighRiskToolCalls" | "toolLoopIterationBudget" | "toolLoopWarningFraction" | "wireApi" | "maxRetries" | "retryBackoffMs" | "sanitizeResponsesToolSchema" | "toolCallRepairLevel">;
  private readonly failoverClient: FailoverClient;
  /** 统一上下文压缩管线（Phase 1 + Phase 2） */
  private readonly compressionPipeline: ContextCompressionPipeline | undefined;
  /** Phase 2：引用存储（若启用） */
  private readonly compressionReferenceStore: CompressionReferenceStore | undefined;
  /** 最近一次压缩批结果（用于 observability 透传） */
  private lastCompressionBatch: CompressionBatchResult | undefined;
  /** Phase 2：最近一次冷恢复裁剪诊断 */
  private lastColdResumePrune: { scannedMarkers: number; invalidatedMarkers: number; retrievableMarkers: number } | undefined;
  /** Phase 4：最近一次 stable prefix / transient tail 拆层诊断 */
  private lastStablePrefixSplit: StablePrefixSplitResult | undefined;
  /** Phase 4：整个 run 中累积的 stable prefix split 诊断（汇总所有轮次） */
  private accumulatedStablePrefixSplit: {
    totalSplitCount: number;
    totalSplitTokensEstimate: number;
    roundsWithSplit: number;
    stableDeltaCount: number;
    transientDeltaCount: number;
  } | undefined;

  constructor(opts: ToolEnabledAgentOptions) {
    this.opts = {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 120_000,
      streamingEnabled: opts.streamingEnabled === true,
      maxToolCalls: normalizeMaxToolCalls(opts.maxToolCalls),
      maxRunWallTimeMs: normalizeMaxRunWallTimeMs(opts.maxRunWallTimeMs),
      maxTotalTokens: normalizeMaxTotalTokens(opts.maxTotalTokens),
      maxHighRiskToolCalls: normalizeMaxHighRiskToolCalls(opts.maxHighRiskToolCalls),
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
        requestBodyExtras: opts.requestBodyExtras,
      },
      fallbacks: opts.fallbacks,
      logger: opts.failoverLogger,
      bootstrapCooldowns: opts.bootstrapProfileCooldowns,
    });

    // 初始化统一上下文压缩管线（Phase 1 + Phase 2）
    // 默认启用，可通过 compression.enabled=false 关闭
    // Phase 2：若 compression.enableReferenceStore=true，则创建带引用存储的管线
    const compressionEnabled = opts.compression?.enabled !== false;
    if (compressionEnabled) {
      if (opts.compressionPipeline) {
        // 外部注入优先
        this.compressionPipeline = opts.compressionPipeline;
        this.compressionReferenceStore = opts.compressionPipeline.getReferenceStore?.();
      } else if (opts.compression?.persistentReferenceStore?.enabled) {
        // Phase 4：显式启用时才把工具结果 reference 持久化到 stateDir。
        const store = new PersistentCompressionReferenceStore({
          stateDir: opts.compression.persistentReferenceStore.stateDir,
          ttlMs: opts.compression.persistentReferenceStore.ttlMs,
          maxEntries: opts.compression.persistentReferenceStore.maxEntries,
          storeKind: "conversation",
        });
        this.compressionPipeline = createCompressionPipeline(opts.compression?.policy, { referenceStore: store });
        this.compressionReferenceStore = store;
      } else if (opts.compression?.enableReferenceStore) {
        // Phase 2：带引用存储的管线
        const { pipeline, store } = createCompressionPipelineWithStore(
          opts.compression?.policy,
          { storeKind: "conversation" },
        );
        this.compressionPipeline = pipeline;
        this.compressionReferenceStore = store;
      } else {
        // Phase 1 兼容模式：不带引用存储
        this.compressionPipeline = createCompressionPipeline(opts.compression?.policy);
        this.compressionReferenceStore = undefined;
      }
    } else {
      this.compressionPipeline = undefined;
      this.compressionReferenceStore = undefined;
    }
  }

  async releaseConversation(conversationId: string): Promise<void> {
    if (!conversationId) return;

    const activeChain = this.conversationRunChains.get(conversationId);
    if (!activeChain) {
      this.releaseConversationState(conversationId);
      return;
    }
    const pendingRelease = this.pendingConversationReleases.get(conversationId);
    if (pendingRelease) {
      await pendingRelease;
      return;
    }

    const release = activeChain.catch(() => undefined).then(() => {
      // 旧 run 结束后若已有新 run 接管同一会话，必须由新 run 的终态再次触发释放。
      if (!this.conversationRunChains.has(conversationId)) {
        this.releaseConversationState(conversationId);
      }
    });
    this.pendingConversationReleases.set(conversationId, release);
    try {
      await release;
    } finally {
      if (this.pendingConversationReleases.get(conversationId) === release) {
        this.pendingConversationReleases.delete(conversationId);
      }
    }
  }

  getConversationReleaseRuntimeSnapshot(): ConversationReleaseRuntimeSnapshot {
    return {
      pendingConversationReleaseCount: this.pendingConversationReleases.size,
      compressionReferences: { ...this.compressionReferenceReleaseRuntime },
    };
  }

  private releaseConversationState(conversationId: string): void {
    this.starweaverActiveNotifyLastRunAt.delete(conversationId);
    this.starweaverVisibleNotifyFingerprint.delete(conversationId);
    this.releaseCompressionReferences(conversationId);
    this.opts.toolExecutor.releaseConversation(conversationId);
  }

  private releaseCompressionReferences(conversationId: string): void {
    const store = this.compressionReferenceStore;
    if (!store) return;

    if (typeof store.releaseConversation !== "function") {
      // 不以通用 prune() 猜测外部 Store 的生命周期语义。
      this.compressionReferenceReleaseRuntime.unsupportedReleaseCount += 1;
      this.updateCompressionReferenceRetainedCount(store);
      return;
    }

    try {
      const result = store.releaseConversation(conversationId);
      this.compressionReferenceReleaseRuntime.releaseCount += 1;
      this.compressionReferenceReleaseRuntime.prunedCount += result.prunedCount;
      this.compressionReferenceReleaseRuntime.currentRetainedCount = result.retainedCount;
    } catch {
      // 清理能力失败不能阻断 ToolExecutor 与其它会话状态释放。
      this.compressionReferenceReleaseRuntime.failureCount += 1;
      this.updateCompressionReferenceRetainedCount(store);
    }
  }

  private updateCompressionReferenceRetainedCount(store: CompressionReferenceStore): void {
    try {
      this.compressionReferenceReleaseRuntime.currentRetainedCount = store.size();
    } catch {
      this.compressionReferenceReleaseRuntime.failureCount += 1;
    }
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

  /**
   * 统一压缩层 — 对 messages 中的 tool messages 做内容感知压缩（Phase 1 + Phase 2）
   *
   * 策略：
   * - 保留最近 keepRecent 条 tool message 不压（避免影响当前轮上下文）
   * - 已被 microcompact 标记的 tool message 跳过
   * - 已被统一 marker 标记的 tool message 跳过（避免重复压缩）
   * - Phase 2：使用统一 marker 格式 [compressed-ref ...]，支持 reference store 回取
   * - fail-open：压缩失败不阻塞主流程
   */
  private async compressToolMessagesInPlace(
    messages: Message[],
    ctx: {
      conversationId?: string;
      agentId?: string;
      runId?: string;
    },
  ): Promise<CompressionBatchResult> {
    const pipeline = this.compressionPipeline;
    if (!pipeline) {
      return { results: [], totalSavedTokensEstimate: 0, appliedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    // 构造 tool_call_id -> tool name 映射
    const toolCallNameById = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc?.id && tc?.function?.name) {
            toolCallNameById.set(tc.id, tc.function.name);
          }
        }
      }
    }

    const keepRecent = Math.max(0, this.opts.microcompact?.keepRecentToolMessages ?? 4);
    const selection = selectToolMessagesForCompression({
      messages,
      toolCallNameById,
      keepRecentToolMessages: keepRecent,
    });

    const results: CompressionResult[] = [];
    let appliedCount = 0;
    let skippedCount = selection.decisions.filter((decision) => decision.action === "keep").length;
    let failedCount = 0;
    let totalSavedTokensEstimate = 0;
    let referenceStoredCount = 0;

    for (const msgIdx of selection.selectedIndices) {
      const msg = messages[msgIdx];
      if (!msg || msg.role !== "tool") continue;

      const content = msg.content;
      if (typeof content !== "string" || !content.trim()) continue;

      // 跳过已被任何压缩层标记的（Phase 2 统一检测）
      if (isAnyCompactedContent(content)) {
        skippedCount++;
        continue;
      }

      const toolName = toolCallNameById.get(msg.tool_call_id) ?? "unknown";

      try {
        const result = await pipeline.compress({
          sourceKind: "tool_result",
          sourceName: toolName,
          content,
          conversationId: ctx.conversationId,
          runId: ctx.runId,
          agentId: ctx.agentId,
        });

        results.push(result);

        if (result.applied && result.compressedContent.length < content.length) {
          // Phase 2：使用统一 marker 格式包装压缩内容
          if (result.reference) {
            // 有引用存储，使用可回取 marker
            msg.content = wrapWithMarker({
              refId: result.reference.refId,
              strategy: result.strategy,
              source: toolName,
              retrievable: result.reference.status === "active",
              compressedContent: result.compressedContent,
            });
            referenceStoredCount++;
          } else {
            // 无引用存储，使用旧标记格式保持兼容
            const marker = `[compressed tool output]\nsource=${toolName}\nstrategy=${result.strategy}\n`;
            msg.content = marker + result.compressedContent;
          }
          appliedCount++;
          totalSavedTokensEstimate += result.savedTokensEstimate;
        } else {
          skippedCount++;
        }
      } catch (err) {
        // fail-open
        failedCount++;
        this.opts.logger?.warn?.("agent", "[compression] tool_result compress failed, fallback to original", {
          toolName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      results,
      totalSavedTokensEstimate,
      appliedCount,
      skippedCount,
      failedCount,
      referenceStoredCount,
      selection: {
        adaptive: selection.adaptive,
        keepRecentToolMessages: selection.keepRecentToolMessages,
        toolMessageCount: selection.toolMessageCount,
        selectedCount: selection.selectedIndices.length,
        keptCount: selection.decisions.filter((decision) => decision.action === "keep").length,
        decisions: selection.decisions.map((decision) => ({
          messageIndex: decision.messageIndex,
          toolName: decision.toolName,
          action: decision.action,
          reason: decision.reason,
          contentChars: decision.contentChars,
        })),
      },
    };
  }

  private async emitBeforeCompaction(
    event: BeforeCompactionEvent,
    conversationId?: string,
    agentId?: string,
    hookRunner?: HookRunner,
  ): Promise<void> {
    if (!hookRunner || typeof hookRunner.runBeforeCompaction !== "function") return;
    try {
      await this.withStageTimeout(
        "before_compaction",
        hookRunner.runBeforeCompaction(
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
    hookRunner?: HookRunner,
  ): Promise<void> {
    if (!hookRunner || typeof hookRunner.runAfterCompaction !== "function") return;
    try {
      await this.withStageTimeout(
        "after_compaction",
        hookRunner.runAfterCompaction(
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

  private async runStarweaverActiveNotifyPreflight(input: {
    conversationId: string;
    agentId: string;
    runtimeContext?: ToolExecutionRuntimeContext;
  }): Promise<StarweaverVisibleNotifyPayload | undefined> {
    if (!readEnvFlag("BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED")) {
      return undefined;
    }

    const pollIntervalMs = readEnvPositiveInt(
      "BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS",
      5000,
    );
    const now = Date.now();
    const lastRunAt = this.starweaverActiveNotifyLastRunAt.get(input.conversationId) ?? 0;
    if (now - lastRunAt < pollIntervalMs) {
      return undefined;
    }

    const definitions = this.opts.toolExecutor.getDefinitions(
      input.agentId,
      input.conversationId,
      input.runtimeContext,
    );
    const toolNames = new Set(definitions.map((item) => item.function.name));
    const notificationsToolName = "mcp_starweaver_central_agent_wake_notifications";
    if (!toolNames.has(notificationsToolName)) {
      return undefined;
    }

    const executePreflightTool = async (name: string, args: JsonObject = {}) =>
      this.opts.toolExecutor.execute(
        {
          id: `starweaver-active-notify-${name}-${now}`,
          name,
          arguments: args,
        },
        input.conversationId,
        input.agentId,
        undefined,
        undefined,
        undefined,
        input.runtimeContext,
      );

    const notificationsResult = await executePreflightTool(notificationsToolName, {
      limit: 3,
    });
    if (!notificationsResult.success || !notificationsResult.output) {
      return undefined;
    }

    const notificationItems = parseStarweaverNotificationItems(notificationsResult.output);
    if (notificationItems.length === 0) {
      this.starweaverActiveNotifyLastRunAt.set(input.conversationId, now);
      return undefined;
    }

    const peekOutputs: Array<{ toolName: string; output: string }> = [];
    for (const item of notificationItems) {
      const mappedToolName =
        item.recommendedPeek === "command_peek"
          ? "mcp_starweaver_central_starweaver_command_peek"
          : item.recommendedPeek === "agent_delivery_peek"
            ? "mcp_starweaver_central_starweaver_agent_delivery_peek"
            : item.recommendedPeek === "events_peek"
              ? "mcp_starweaver_central_starweaver_events_peek"
              : item.recommendedPeek === "wake_signals_peek"
                ? "mcp_starweaver_central_starweaver_wake_signals_peek"
                : undefined;
      if (!mappedToolName || !toolNames.has(mappedToolName)) {
        continue;
      }

      const peekResult = await executePreflightTool(mappedToolName, {
        ...(item.actorId ? { actorId: item.actorId } : {}),
        ...(item.sessionId ? { sessionId: item.sessionId } : {}),
        ...(item.gameId ? { gameId: item.gameId } : {}),
      });
      if (peekResult.success && peekResult.output) {
        peekOutputs.push({
          toolName: mappedToolName,
          output: peekResult.output,
        });
      }
    }

    this.starweaverActiveNotifyLastRunAt.set(input.conversationId, now);
    return {
      notificationItems,
      prelude: buildStarweaverActiveNotifyPrelude({
        notificationItems,
        peeks: peekOutputs,
      }),
    };
  }

  private maybeAppendStarweaverVisibleNotify(input: {
    conversationId: string;
    agentId: string;
    payload: StarweaverVisibleNotifyPayload;
  }): void {
    const conversationStore = this.opts.conversationStore;
    if (!conversationStore || input.payload.notificationItems.length === 0) {
      return;
    }

    const fingerprint = JSON.stringify(
      input.payload.notificationItems.map((item) => ({
        signalKind: item.signalKind || "",
        recommendedPeek: item.recommendedPeek || "",
        actorId: item.actorId || "",
        sessionId: item.sessionId || "",
        gameId: item.gameId || "",
      })),
    );
    if (this.starweaverVisibleNotifyFingerprint.get(input.conversationId) === fingerprint) {
      return;
    }

    const lines = input.payload.notificationItems.slice(0, 3).map((item) => {
      const signal = item.signalKind || "unknown_signal";
      const peek = item.recommendedPeek || "manual_check";
      const scope = [item.actorId, item.sessionId, item.gameId].filter(Boolean).join(" / ");
      return scope
        ? `- ${signal} -> ${peek} (${scope})`
        : `- ${signal} -> ${peek}`;
    });

    const text = [
      "StarWeaver 有新的主动提示，已在本轮开始前自动检查。",
      ...lines,
    ].join("\n");

    conversationStore.addMessage(input.conversationId, "assistant", text, {
      agentId: input.agentId,
      channel: "webchat",
    });
    this.starweaverVisibleNotifyFingerprint.set(input.conversationId, fingerprint);
  }

  getCodingRunCapabilities(): {
    maxCostUsd: boolean;
    workspaceMutationRequirement: true;
    requiredChangedPaths: true;
    steerAtModelBoundary: true;
  } {
    return {
      maxCostUsd: hasUsagePricing(this.opts.usagePricing),
      workspaceMutationRequirement: true,
      requiredChangedPaths: true,
      steerAtModelBoundary: true,
    };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
    const startTime = Date.now();
    const bareAutomation = isBareAgentAutomationProfile(input.automationProfile);
    const runHookRunner = bareAutomation ? undefined : this.opts.hookRunner;
    const runLegacyHooks = bareAutomation ? undefined : this.opts.hooks;
    const runtimeContext = readToolExecutionRuntimeContext(input.meta);
    const runBudgets = resolveRunBudgets({
      launchSpec: runtimeContext?.launchSpec,
      maxRunWallTimeMs: this.opts.maxRunWallTimeMs,
      maxTotalTokens: this.opts.maxTotalTokens,
      toolLoopIterationBudget: this.opts.toolLoopIterationBudget,
      maxHighRiskToolCalls: this.opts.maxHighRiskToolCalls,
    });
    if (runBudgets.maxCostUsd !== undefined && !hasUsagePricing(this.opts.usagePricing)) {
      throw new Error("This coding run requested maxCostUsd, but the selected Agent profile has no valid usage pricing.");
    }
    const resolvedAgentId = input.agentId ?? runtimeContext?.launchSpec?.agentId ?? runtimeContext?.launchSpec?.profileId ?? "tool-agent";
    const runPromptOverride = input.promptOverride;
    let runSystemPrompt = runPromptOverride ? runPromptOverride.text : this.opts.systemPrompt;
    const runSystemPromptSections = runPromptOverride ? runPromptOverride.sections : this.opts.systemPromptSections;
    const runSystemPromptMetadata = runPromptOverride ? runPromptOverride.metadata : this.opts.systemPromptMetadata;
    let hookSystemPromptUsed = false;
    let prependContext: string | undefined;
    let hookPromptDeltas: AgentPromptDelta[] | undefined;
    const legacyHookCtx = { agentId: resolvedAgentId, conversationId: input.conversationId };

    // 新版钩子上下文
    const agentHookCtx: HookAgentContext = {
      agentId: resolvedAgentId,
      sessionKey: input.conversationId,
      abortSignal: input.abortSignal,
    };

    const releaseConversationRunSlot = await this.acquireConversationRunSlot(input.conversationId);
    let runAbortController: ReActRunAbortController | undefined;
    try {
      // Hook: beforeRun / before_agent_start
      // 优先使用新版 hookRunner，向后兼容旧版 hooks
      if (runHookRunner) {
        try {
          const normalizedPrompt = typeof input.content === "string" ? input.content : input.text;
          const normalizedUserInput = input.userInput?.trim() || normalizedPrompt;
          const hookRes = await this.withStageTimeout(
            "before_agent_start",
            runHookRunner.runBeforeAgentStart(
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
      } else if (runLegacyHooks?.beforeRun) {
        // 向后兼容：旧版 hooks
        try {
          const hookRes = await this.withStageTimeout(
            "beforeRun",
            Promise.resolve(runLegacyHooks.beforeRun({ input }, legacyHookCtx)),
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

      if (!bareAutomation) try {
        const starweaverNotify = await this.runStarweaverActiveNotifyPreflight({
          conversationId: input.conversationId,
          agentId: resolvedAgentId,
          runtimeContext,
        });
        if (starweaverNotify?.prelude) {
          input = applyPrependContextToInput(input, starweaverNotify.prelude);
          prependContext = prependContext
            ? `${prependContext}\n\n${starweaverNotify.prelude}`
            : starweaverNotify.prelude;
        }
        if (starweaverNotify) {
          this.maybeAppendStarweaverVisibleNotify({
            conversationId: input.conversationId,
            agentId: resolvedAgentId,
            payload: starweaverNotify,
          });
        }
      } catch (err) {
        this.opts.logger?.warn?.("agent", "StarWeaver active notify preflight failed", {
          conversationId: input.conversationId,
          agentId: resolvedAgentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      yield { type: "status", status: "running" };

      // Wall-time 从 ReAct 实际开始计量，并将父级停止与本轮 deadline 合并到同一信号。
      const runBudgetStartedAt = Date.now();
      const maxRunWallTimeMs = runBudgets.maxRunWallTimeMs;
      const activeRunAbortController = createReActRunAbortController(
        input.abortSignal,
        maxRunWallTimeMs,
      );
      runAbortController = activeRunAbortController;
      input = { ...input, abortSignal: activeRunAbortController.signal };

      let content: string | Array<any> = input.content || input.text;

    // Preprocess: upload local videos to Moonshot
    const needsVideoUpload = Array.isArray(content) &&
      content.some((p: any) => p.type === "video_url" && p.video_url?.url?.startsWith("file://"));
    if (needsVideoUpload) {
      yield { type: "status", status: "uploading_video" as any };
      const profiles = this.failoverClient.getProfiles();
      const profile = profiles.find(p => p.id === "primary") || profiles[0];
      if (profile) {
        const result = await preprocessMultimodalContent(
          content,
          profile,
          this.opts.videoUploadConfig,
          { abortSignal: input.abortSignal },
        );
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
    const metaPromptDeltas = selectAgentAutomationPromptDeltas(
      input.automationProfile,
      readPromptSnapshotDeltas(input.meta) ?? [],
    );
    const baseRunPromptDeltas = collectRunPromptDeltas({
      hookPromptDeltas,
      runtimeIdentityDelta,
      runtimeIdentityAuthorityDelta,
      launchSpecPromptDeltas,
      metaPromptDeltas,
    });
    let currentSystemPromptState = buildEffectiveSystemPromptState({
      systemPrompt: runSystemPrompt,
      runtimePromptDeltas: baseRunPromptDeltas,
      systemPromptMetadata: runSystemPromptMetadata,
    });
    const messages: Message[] = buildInitialMessages(
      currentSystemPromptState.text,
      content,
      input.history,
    );
    let pendingToolFollowupDeltas: AgentPromptDelta[] = [];
    let currentRunPromptDeltas = baseRunPromptDeltas.map((delta) => ({ ...delta }));
    // Phase 4：transient tail 文本（每次 refresh 后重建）
    let currentTransientTailText = "";
    // Phase 4 步骤 2：independent block 文本（identity-authority 独立 block）
    let currentIndependentBlockText = "";
    let providerNativeSystemBlocks = buildProviderNativeSystemBlocks({
      sections: hookSystemPromptUsed ? undefined : runSystemPromptSections,
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
      // Phase 4：stable prefix / transient tail 拆层
      const splitResult = splitDeltasByStability(currentRunPromptDeltas, this.opts.stablePrefixSplit);
      this.lastStablePrefixSplit = splitResult;
      // 累积整个 run 中所有轮次的 split 诊断
      if (splitResult.splitActivated) {
        if (!this.accumulatedStablePrefixSplit) {
          this.accumulatedStablePrefixSplit = {
            totalSplitCount: 0,
            totalSplitTokensEstimate: 0,
            roundsWithSplit: 0,
            stableDeltaCount: 0,
            transientDeltaCount: 0,
          };
        }
        this.accumulatedStablePrefixSplit.totalSplitCount += splitResult.splitCount;
        this.accumulatedStablePrefixSplit.totalSplitTokensEstimate += splitResult.splitTokensEstimate;
        this.accumulatedStablePrefixSplit.roundsWithSplit++;
        this.accumulatedStablePrefixSplit.stableDeltaCount = splitResult.stableDeltas.length;
        this.accumulatedStablePrefixSplit.transientDeltaCount = splitResult.transientDeltas.length;
      }
      // 只用 stable deltas 构建 system prompt，保持 stable prefix 稳定
      const deltasForSystemPrompt = splitResult.splitActivated ? splitResult.stableDeltas : currentRunPromptDeltas;
      currentSystemPromptState = buildEffectiveSystemPromptState({
        systemPrompt: runSystemPrompt,
        runtimePromptDeltas: deltasForSystemPrompt,
        systemPromptMetadata: runSystemPromptMetadata,
      });
      setSystemPromptMessage(messages, currentSystemPromptState.text);
      // 构建 transient tail 文本（稍后在发送请求前注入）
      currentTransientTailText = splitResult.splitActivated ? buildTransientTailText(splitResult.transientDeltas) : "";
      // Phase 4 步骤 2：构建 independent block 文本（identity-authority 独立 block）
      currentIndependentBlockText = splitResult.splitActivated ? buildIndependentBlockText(splitResult.independentBlockDeltas) : "";
      providerNativeSystemBlocks = buildProviderNativeSystemBlocks({
        sections: hookSystemPromptUsed ? undefined : runSystemPromptSections,
        deltas: deltasForSystemPrompt,
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
          inputMeta: mergePromptSnapshotInputMeta(
            runSystemPromptMetadata,
            {
              ...(input.meta ?? {}),
              ...(lastPrefixShape ? { prefixShape: lastPrefixShape as unknown as JsonObject } : {}),
              ...(lastPrefixDrift ? { prefixDrift: lastPrefixDrift as unknown as JsonObject } : {}),
              ...(lastBudgetCompetition ? { budgetCompetition: lastBudgetCompetition as unknown as JsonObject } : {}),
            } as JsonObject,
            currentSystemPromptState.truncationReason,
          ),
          hookSystemPromptUsed,
          prependContext,
        }),
      );
    };
    const textAttachmentChars = readTextAttachmentChars(input.meta);
    let toolCallCount = 0;
    const generatedItems = new AgentEndLedger();
    let runSuccess = true;
    let runError: string | undefined;
    const structuredOutputSession = input.structuredOutput
      ? createStructuredOutputSession(input.structuredOutput)
      : undefined;
    const runBudget = new ReActRunBudgetTracker({
      maxTotalTokens: runBudgets.maxTotalTokens,
      maxHighRiskToolCalls: runBudgets.maxHighRiskToolCalls,
      ...(runBudgets.maxCostUsd === undefined ? {} : { maxCostUsd: runBudgets.maxCostUsd }),
      ...(runtimeContext?.launchSpec?.modelLoopBudgetPolicy
        ? { modelLoopBudgetPolicy: runtimeContext.launchSpec.modelLoopBudgetPolicy }
        : {}),
    });

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
    let totalUsageCostUsd = 0;
    let modelCallCount = 0;
    let providerReportedModelCallCount = 0;
    let pendingEmptyContentFinalizationError: string | undefined;
    let emptyContentFinalizationAttempted = false;
    const workspaceMutationRequired = runtimeContext?.launchSpec?.workspaceMutationRequirement === "required";
    const requiredChangedPaths = runtimeContext?.launchSpec?.requiredChangedPaths ?? [];
    const workspaceMutationPathCoverage = createWorkspaceMutationPathCoverage(requiredChangedPaths);
    const workspaceMutationVerificationEligible = requiredChangedPaths.length > 0
      && requiredChangedPaths.length <= WORKSPACE_MUTATION_NAVIGATION_MAX_FILE_READ_CALLS;
    let workspaceMutationObserved = false;
    let workspaceMutationNavigationAttempts = 0;
    const workspaceMutationNavigationAttemptLimit = 1;
    let workspaceMutationRecoveryPending = false;
    let workspaceMutationRecoveryAttempted = false;
    let workspaceMutationContinuationPending = false;
    let workspaceMutationContinuationAttempted = false;
    let workspaceMutationInputCorrectionPending = false;
    let workspaceMutationInputCorrectionAttempted = false;
    let workspaceMutationVerificationPending = false;
    let workspaceMutationVerificationAttempts = 0;
    let workspaceMutationVerificationCompletedReadCount = 0;
    let workspaceMutationObjectiveReviewPending = false;
    let workspaceMutationObjectiveReviewAttempts = 0;
    let workspaceMutationObjectiveCorrectionAttempted = false;
    let workspaceMutationFinalizationPending = false;
    let pendingBoundedStructuredOutputRepairRequest: BoundedStructuredOutputRepairRequest | undefined;
    let lastProviderRawUsage: AgentUsage["providerRawUsage"] | undefined;
    let lastRequestShape: AgentUsage["requestShape"] | undefined;
    let lastLocalPromptEstimate: AgentUsage["localPromptEstimate"] | undefined;
    let lastPrefixShape: AgentUsage["prefixShape"] | undefined;
    let lastPrefixDrift: AgentUsage["prefixDrift"] | undefined;
    let lastBudgetCompetition: AgentUsage["budgetCompetition"] | undefined;
    let lastTrimDiagnostics: PromptTrimDiagnostics | undefined;
    // Phase 4：重置累积的 stable prefix split 诊断
    this.accumulatedStablePrefixSplit = undefined;
    let toolLoopBudgetWarningIssued = false;
    let lastToolCallFingerprint: string | undefined;
    let lastToolCallName: string | undefined;
    let consecutiveDuplicateToolCalls = 0;
    const recentToolCallTraces: ToolCallExecutionTrace[] = [];
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
    let currentTokenEstimateModel = this.opts.model;

    // 扩展 A：从 ConversationStore 恢复跨 run 的活跃计数器
    const convId = input.conversationId ?? "";
    if (this.opts.conversationStore && convId) {
      const snapshots = this.opts.conversationStore.getActiveCounters(convId);
      tokenCounter.restoreFromSnapshots(snapshots);
    }

    const buildUsageItem = (): AgentUsage => {
      const tokenEstimateContext = currentTokenEstimateModel ? { model: currentTokenEstimateModel } : undefined;
      const systemPromptTokens = estimateSystemPromptTokens(messages, tokenEstimateContext);
      const contextTokens = estimateContextTokensFromMessages(messages, { includeSystem: false }, tokenEstimateContext);
      const usageCalibration = buildUsageCalibration({
        estimatedPromptTokens: systemPromptTokens + contextTokens,
        actualInputTokens: totalInputTokens,
        modelCalls: modelCallCount,
      });
      return {
        type: "usage",
        systemPromptTokens,
        contextTokens,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheCreationTokens: totalCacheCreation,
        cacheReadTokens: totalCacheRead,
        ...(totalCacheHit > 0 ? { cacheHitTokens: totalCacheHit } : {}),
        ...(totalCacheMiss > 0 ? { cacheMissTokens: totalCacheMiss } : {}),
        modelCalls: modelCallCount,
        providerReportedModelCalls: providerReportedModelCallCount,
        ...(this.opts.cacheSupport ? { cacheSupport: this.opts.cacheSupport } : {}),
        ...(typeof runSystemPromptMetadata?.systemPromptFingerprint === "string"
          ? { systemPromptFingerprint: runSystemPromptMetadata.systemPromptFingerprint }
          : {}),
        ...(typeof runSystemPromptMetadata?.structureSignature === "string"
          ? { structureSignature: runSystemPromptMetadata.structureSignature }
          : {}),
        ...(runSystemPromptMetadata?.warmupCoordination
          && typeof runSystemPromptMetadata.warmupCoordination === "object"
          ? { warmupCoordination: runSystemPromptMetadata.warmupCoordination }
          : {}),
        ...(runSystemPromptMetadata?.cacheFamilyAffinity
          && typeof runSystemPromptMetadata.cacheFamilyAffinity === "object"
          ? { cacheFamilyAffinity: runSystemPromptMetadata.cacheFamilyAffinity }
          : {}),
        ...(totalInputCostUsd > 0 ? { inputCostUsd: totalInputCostUsd } : {}),
        ...(totalOutputCostUsd > 0 ? { outputCostUsd: totalOutputCostUsd } : {}),
        ...(totalCacheReadCostUsd > 0 ? { cacheReadCostUsd: totalCacheReadCostUsd } : {}),
        ...(totalCacheCreationCostUsd > 0 ? { cacheCreationCostUsd: totalCacheCreationCostUsd } : {}),
        ...(totalCacheSavingsUsd > 0 ? { cacheSavingsUsd: totalCacheSavingsUsd } : {}),
        ...(totalInputCostUsd > 0 || totalOutputCostUsd > 0 || totalCacheReadCostUsd > 0 || totalCacheCreationCostUsd > 0
          ? { totalCostUsd: totalUsageCostUsd }
          : {}),
        ...(usageCalibration ? { usageCalibration } : {}),
        ...(lastProviderRawUsage ? { providerRawUsage: { ...lastProviderRawUsage } } : {}),
        ...(lastRequestShape ? { requestShape: { ...lastRequestShape } } : {}),
        ...(lastLocalPromptEstimate ? { localPromptEstimate: { ...lastLocalPromptEstimate } } : {}),
        ...(lastPrefixShape ? { prefixShape: { ...lastPrefixShape } } : {}),
        ...(lastPrefixDrift ? { prefixDrift: { ...lastPrefixDrift } } : {}),
        ...(lastBudgetCompetition ? { budgetCompetition: { ...lastBudgetCompetition } } : {}),
        ...(this.lastCompressionBatch && (this.lastCompressionBatch.appliedCount > 0 || this.lastCompressionBatch.selection) ? {
          compression: {
            appliedCount: this.lastCompressionBatch.appliedCount,
            skippedCount: this.lastCompressionBatch.skippedCount,
            failedCount: this.lastCompressionBatch.failedCount,
            totalSavedTokensEstimate: this.lastCompressionBatch.totalSavedTokensEstimate,
            bySource: buildCompressionBySourceSummary(this.lastCompressionBatch.results),
            ...(this.lastCompressionBatch.selection ? {
              selection: { ...this.lastCompressionBatch.selection },
            } : {}),
            // Phase 2：引用存储与冷恢复裁剪诊断
            ...(this.lastCompressionBatch.referenceStoredCount && this.lastCompressionBatch.referenceStoredCount > 0 ? {
              referenceStoredCount: this.lastCompressionBatch.referenceStoredCount,
            } : {}),
            ...(this.lastColdResumePrune ? {
              coldResumePrune: { ...this.lastColdResumePrune },
            } : {}),
          },
        } : {}),
        // Phase 3：budget protect 诊断透传
        ...(lastTrimDiagnostics?.budgetProtect && lastTrimDiagnostics.budgetProtect.protectionActivated ? {
          budgetProtect: { ...lastTrimDiagnostics.budgetProtect },
        } : {}),
        // Phase 4：stable prefix / transient tail 拆层诊断透传（使用累积数据）
        ...(this.accumulatedStablePrefixSplit && this.accumulatedStablePrefixSplit.roundsWithSplit > 0 ? {
          stablePrefixSplit: {
            splitCount: this.accumulatedStablePrefixSplit.totalSplitCount,
            splitTokensEstimate: this.accumulatedStablePrefixSplit.totalSplitTokensEstimate,
            roundsWithSplit: this.accumulatedStablePrefixSplit.roundsWithSplit,
            stableDeltaCount: this.accumulatedStablePrefixSplit.stableDeltaCount,
            transientDeltaCount: this.accumulatedStablePrefixSplit.transientDeltaCount,
          },
        } : {}),
      };
    };

    // 辅助函数：yield 并收集 items
    const yieldItem = async function* (item: AgentStreamItem) {
      generatedItems.record(item);
      yield item;
    };

    const emitStopped = async function* () {
      runSuccess = false;
      runError = readRunStopReason(input.abortSignal);
      yield* yieldItem(buildUsageItem());
      yield* yieldItem({ type: "status", status: "stopped" });
    };

    // 预算终态必须在 final/status 前输出，供 Gateway 保持失败语义而非成功收尾。
    const emitBudgetExhausted = async function* (
      budget: AgentBudgetExhausted["budget"],
      limit: number,
      observed: number,
      error: string,
      details?: Pick<AgentBudgetExhausted, "policyId" | "stage" | "reasonCode">,
    ) {
      runSuccess = false;
      runError = error;
      yield* yieldItem(buildUsageItem());
      yield* yieldItem({ type: "budget_exhausted", budget, limit, observed, ...details });
      yield* yieldItem({ type: "final", text: error });
      yield* yieldItem({ type: "status", status: "error" });
    };

    const emitStructuredOutputFailure = async function* (
      rejection: { originalText: string; message: string },
      budget?: AgentBudgetExhausted,
      includeSchemaErrorCode = true,
    ) {
      runSuccess = false;
      runError = rejection.message;
      yield* yieldItem(buildUsageItem());
      if (budget) yield* yieldItem(budget);
      yield* yieldItem({ type: "final", text: rejection.originalText });
      yield* yieldItem({
        type: "status",
        status: "error",
        ...(includeSchemaErrorCode
          ? { code: "output_schema_invalid" as const, error: rejection.message }
          : {}),
      });
    };

    const emitWorkspaceMutationFailure = async function* (detail: string) {
      const error = `required workspace mutation was not completed: ${detail}`;
      runSuccess = false;
      runError = error;
      yield* yieldItem(buildUsageItem());
      yield* yieldItem({ type: "final", text: error });
      yield* yieldItem({ type: "status", status: "error" });
    };

    const emitRunAbort = async function* () {
      if (activeRunAbortController.isWallTimeExceeded()) {
        const observed = Math.max(
          maxRunWallTimeMs,
          Date.now() - runBudgetStartedAt,
        );
        yield* emitBudgetExhausted(
          "wall_time_ms",
          maxRunWallTimeMs,
          observed,
          `单次运行 wall-time 预算超限（最大 ${maxRunWallTimeMs}ms）。已停止后续模型和工具调用；请拆分任务，或仅为受控 Profile 提高预算后继续。`,
        );
        return;
      }
      yield* emitStopped();
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
        const stopRequestedAfterModel = isRunStopRequested(input.abortSignal);
        if (stopRequestedAfterModel && !structuredOutputSession) {
          yield* emitRunAbort();
          return;
        }
        const nextModelCallIndex = modelCallCount + 1;
        const structuredOutputRepairCall = structuredOutputSession?.isRepairCall() ?? false;
        const iterationBudget = runBudgets.toolLoopIterationBudget;
        const effectiveIterationBudget = iterationBudget > 0
          ? iterationBudget
            + workspaceMutationNavigationAttempts
            + (workspaceMutationContinuationPending ? 1 : 0)
            + workspaceMutationVerificationAttempts * 2
            + (workspaceMutationVerificationPending ? 2 : 0)
            + (workspaceMutationFinalizationPending && workspaceMutationVerificationAttempts > 0 ? 1 : 0)
          : 0;
        const workspaceMutationRecoveryRequiredByGate = workspaceMutationRequired
          && !workspaceMutationObserved
          && !workspaceMutationRecoveryAttempted
          && modelCallCount > 0
          && (
            (iterationBudget > 0 && nextModelCallIndex >= iterationBudget - 1)
            || (
              runBudget.modelLoopBudgetPolicy !== undefined
              && runBudget.modelCalls + 2 >= MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxModelCalls
            )
          );
        const workspaceMutationRecoveryRequested = workspaceMutationRequired
          && !workspaceMutationObserved
          && !workspaceMutationRecoveryAttempted
          && (
            workspaceMutationRecoveryPending
            || workspaceMutationRecoveryRequiredByGate
            || workspaceMutationNavigationAttempts > 0
          );
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
          if (nextModelCallIndex > effectiveIterationBudget) {
            try {
              loopCompactionState = await this.compactInLoop(
                messages,
                loopCompactionState,
                input.conversationId,
                resolvedAgentId,
                true,
                runHookRunner,
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
            yield* emitBudgetExhausted(
              "tool_loop_iterations",
              effectiveIterationBudget,
              nextModelCallIndex,
              `工具调用迭代预算超限（最大 ${effectiveIterationBudget} 轮）。已在阻断前尝试压缩当前上下文，请收敛任务、分解问题，或开启新一轮继续。`,
            );
            return;
          }
        }
        refreshModelPromptState();
        // 统一压缩层 — 在 microcompact 前对 tool_result 做内容感知压缩（Phase 1 + Phase 2）
        // 只压缩尚未被压缩过的 tool message，保留最近 N 条不压（与 microcompact 的 keepRecent 对齐）
        if (this.compressionPipeline) {
          this.lastCompressionBatch = await this.compressToolMessagesInPlace(messages, {
            conversationId: input.conversationId,
            agentId: resolvedAgentId,
          });
          if (this.lastCompressionBatch.appliedCount > 0) {
            logDebug("[compression] tool_result compressed in-place", {
              appliedCount: this.lastCompressionBatch.appliedCount,
              skippedCount: this.lastCompressionBatch.skippedCount,
              savedTokensEstimate: this.lastCompressionBatch.totalSavedTokensEstimate,
              referenceStoredCount: this.lastCompressionBatch.referenceStoredCount ?? 0,
            });
          }
        }
        // Phase 2：prune-before-summarize — 在 microcompact/compaction 前先校正 marker 状态
        // 确保后续 summarizer 看到的引用状态与 reference store 一致
        if (this.compressionReferenceStore) {
          const pruneResult = pruneBeforeSummarize(messages as unknown as Array<{ role: string; content?: unknown }>, this.compressionReferenceStore);
          if (pruneResult.scannedMarkers > 0) {
            this.lastColdResumePrune = {
              scannedMarkers: pruneResult.scannedMarkers,
              invalidatedMarkers: pruneResult.invalidatedMarkers,
              retrievableMarkers: pruneResult.retrievableMarkers,
            };
            if (pruneResult.invalidatedMarkers > 0) {
              logDebug("[compression] prune-before-summarize invalidated stale markers", {
                scanned: pruneResult.scannedMarkers,
                invalidated: pruneResult.invalidatedMarkers,
                retrievable: pruneResult.retrievableMarkers,
              });
            }
          }
        }
        const microcompactCandidate = messages.some((message) => message.role === "tool");
        const microcompactEstimateContext = currentTokenEstimateModel ? { model: currentTokenEstimateModel } : undefined;
        const microcompactOriginalTokens = microcompactCandidate ? estimateMessagesTotal(messages, microcompactEstimateContext) : 0;
        if (microcompactCandidate) {
          await this.emitBeforeCompaction({
            messageCount: messages.length,
            tokenCount: microcompactOriginalTokens,
            source: "microcompact",
            compactionMode: "microcompact",
          }, input.conversationId, resolvedAgentId, runHookRunner);
        }
        const microcompactResult = microcompactMessages(messages, this.opts.microcompact);
        if (microcompactResult.mutated) {
          const microcompactCompactedTokens = estimateMessagesTotal(messages, microcompactEstimateContext);
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
          }, input.conversationId, resolvedAgentId, runHookRunner);
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
          const currentTokens = estimateMessagesTotal(messages, microcompactEstimateContext);
          if (needsInLoopCompaction(currentTokens, maxInput, triggerFraction)) {
            try {
              loopCompactionState = await this.compactInLoop(
                messages,
                loopCompactionState,
                input.conversationId,
                resolvedAgentId,
                undefined,
                runHookRunner,
              );
            } catch (err) {
              logError(`[compaction] in-loop compaction failed: ${err}`);
              // 压缩失败不阻塞，继续执行（trimMessagesToFit 会兜底）
            }
          }
        }

        const emptyContentFinalizationPending = pendingEmptyContentFinalizationError !== undefined;
        const pendingSteerCommands = input.steering
          && !structuredOutputRepairCall
          && !emptyContentFinalizationPending
          && !workspaceMutationRecoveryRequested
          && !workspaceMutationVerificationPending
          && !workspaceMutationObjectiveReviewPending
          && !workspaceMutationFinalizationPending
          ? input.steering.peekPending()
          : [];

        let tools = structuredOutputRepairCall
          || emptyContentFinalizationPending
          || workspaceMutationFinalizationPending
          ? []
          : this.opts.toolExecutor.getDefinitions(resolvedAgentId, input.conversationId, runtimeContext);
        let toolNames = tools.map((tool) => tool.function.name);
        const preflightMessages = pendingSteerCommands.length > 0
          ? [
            ...messages,
            ...pendingSteerCommands.map((command): Message => ({ role: "user", content: command.prompt })),
          ]
          : messages;
        const preflightRequestMessages = applyStablePrefixSplitMessageLayout(preflightMessages, {
          transientText: currentTransientTailText,
          independentBlockText: currentIndependentBlockText,
          messageLayout: this.opts.messageLayout,
        }) as Message[];
        const mutationRecoverySourceMessages = pendingSteerCommands.length === 0
          ? preflightRequestMessages
          : applyStablePrefixSplitMessageLayout(messages, {
              transientText: currentTransientTailText,
              independentBlockText: currentIndependentBlockText,
              messageLayout: this.opts.messageLayout,
            }) as Message[];
        const boundedStructuredOutputRepairRequest = structuredOutputRepairCall
          ? pendingBoundedStructuredOutputRepairRequest
          : undefined;
        const budgetPreflightMessages = boundedStructuredOutputRepairRequest
          ? boundedStructuredOutputRepairRequest.messages as Message[]
          : preflightRequestMessages;
        const dispatchTokenEstimateContext = currentTokenEstimateModel ? { model: currentTokenEstimateModel } : undefined;
        const preflightSystemPromptTokens = estimateSystemPromptTokens(
          budgetPreflightMessages,
          dispatchTokenEstimateContext,
        );
        const preflightContextTokens = estimateContextTokensFromMessages(
          budgetPreflightMessages,
          { includeSystem: false },
          dispatchTokenEstimateContext,
        );
        const preflightPromptTokens = preflightSystemPromptTokens + preflightContextTokens;
        let workspaceMutationRecoveryCall = false;
        let workspaceMutationContinuationCall = false;
        let workspaceMutationInputCorrectionCall = false;
        let workspaceMutationCallRequiredPaths: string[] = [];
        let workspaceMutationRecoveryRequest: WorkspaceMutationRecoveryRequest | undefined;
        let workspaceMutationNavigationCall = false;
        let workspaceMutationNavigationRequest: WorkspaceMutationNavigationRequest | undefined;
        let workspaceMutationVerificationCall = false;
        let workspaceMutationVerificationRequest: WorkspaceMutationVerificationRequest | undefined;
        let workspaceMutationObjectiveReviewCall = false;
        let workspaceMutationObjectiveReviewRequest: WorkspaceMutationRecoveryRequest | undefined;
        let workspaceMutationFinalizationCall = false;
        let finalizationOnlyCall = false;
        let finalizationRequest: ReactFinalizationRequest | undefined;
        let finalizationTrigger: ReturnType<ReActRunBudgetTracker["checkModelCallPreflight"]>;
        const finalizationOutputTokens = Math.max(
          1,
          Math.min(
            REACT_FINALIZATION_OUTPUT_TOKEN_RESERVE,
            this.opts.maxOutputTokens ?? REACT_FINALIZATION_OUTPUT_TOKEN_RESERVE,
          ),
        );
        let mutationRecoveryOutputTokens = Math.max(
          1,
          Math.min(
            WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE,
            this.opts.maxOutputTokens ?? WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE,
          ),
        );
        const mutationNavigationOutputTokens = Math.max(
          1,
          Math.min(
            WORKSPACE_MUTATION_NAVIGATION_OUTPUT_TOKEN_RESERVE,
            this.opts.maxOutputTokens ?? WORKSPACE_MUTATION_NAVIGATION_OUTPUT_TOKEN_RESERVE,
          ),
        );
        const mutationVerificationOutputTokens = mutationNavigationOutputTokens;
        const buildMutationRecoveryCandidate = (): WorkspaceMutationRecoveryPlan | undefined => {
          const mutationTools = selectWorkspaceMutationToolDefinitions(
            tools,
            (name) => this.opts.toolExecutor.getRegisteredToolContract?.(name),
          );
          return buildWorkspaceMutationRecoveryPlan({
            messages: mutationRecoverySourceMessages,
            tools: mutationTools,
            remainingTokenBudget: runBudget.maxTotalTokens - runBudget.totalTokens,
            maxOutputTokens: this.opts.maxOutputTokens
              ?? WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE,
            finalizationOutputTokens,
            inputSafetyFactor: REACT_FINALIZATION_INPUT_SAFETY_FACTOR,
            missingRequiredChangedPaths: workspaceMutationPathCoverage.missingPaths(),
            tokenEstimateContext: dispatchTokenEstimateContext,
          });
        };
        const buildMutationContinuationCandidate = (): WorkspaceMutationRecoveryPlan | undefined => {
          const mutationTools = selectWorkspaceMutationToolDefinitions(
            tools,
            (name) => this.opts.toolExecutor.getRegisteredToolContract?.(name),
          );
          const buildPlan = workspaceMutationInputCorrectionPending
            ? buildWorkspaceMutationInputCorrectionPlan
            : buildWorkspaceMutationContinuationPlan;
          return buildPlan({
            messages: mutationRecoverySourceMessages,
            tools: mutationTools,
            remainingTokenBudget: runBudget.maxTotalTokens - runBudget.totalTokens,
            maxOutputTokens: this.opts.maxOutputTokens
              ?? WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE,
            finalizationOutputTokens,
            inputSafetyFactor: REACT_FINALIZATION_INPUT_SAFETY_FACTOR,
            missingRequiredChangedPaths: workspaceMutationPathCoverage.missingPaths(),
            tokenEstimateContext: dispatchTokenEstimateContext,
          });
        };
        const headroomCandidate = workspaceMutationRequired
          && !workspaceMutationObserved
          && !workspaceMutationRecoveryAttempted
          && modelCallCount > 0
          ? buildMutationRecoveryCandidate()
          : undefined;
        const protectedOutputTokens = headroomCandidate
          ? finalizationOutputTokens + headroomCandidate.outputTokens + finalizationOutputTokens
          : 0;
        const protectedMinimumCost = headroomCandidate
          ? calculateUsageCostUsd({
              inputTokens: preflightPromptTokens
                + headroomCandidate.estimatedInputTokens
                + headroomCandidate.finalizationInputTokenReserve,
              outputTokens: protectedOutputTokens,
              pricing: this.opts.usagePricing,
            })
          : undefined;
        const workspaceMutationRecoveryRequiredByHeadroom = headroomCandidate
          ? !requiresRequiredPathSourceNavigation(headroomCandidate)
            && isMutationRecoveryReadyForHeadroom(headroomCandidate)
            && runBudget.checkModelCallPreflight({
              minimumInputTokens: preflightPromptTokens
                + headroomCandidate.estimatedInputTokens
                + headroomCandidate.finalizationInputTokenReserve,
              minimumOutputTokens: protectedOutputTokens,
              ...(protectedMinimumCost ? { minimumCostUsd: protectedMinimumCost.totalUsd } : {}),
            }) !== undefined
          : false;
        const workspaceMutationRecoveryReadyByGate = workspaceMutationRecoveryRequested
          && headroomCandidate !== undefined
          && !requiresRequiredPathSourceNavigation(headroomCandidate);
        const workspaceMutationNavigationRequiredByGate = workspaceMutationRequired
          && !workspaceMutationObserved
          && !workspaceMutationRecoveryAttempted
          && headroomCandidate !== undefined
          && requiresRequiredPathSourceNavigation(headroomCandidate);
        if (workspaceMutationRecoveryRequested && headroomCandidate === undefined) {
          yield* emitWorkspaceMutationFailure(
            "no bounded mutation recovery request can be built from the allowed tools and remaining token budget.",
          );
          return;
        }
        let selectedMutationCandidate: WorkspaceMutationRecoveryPlan | undefined;
        if (workspaceMutationContinuationPending) {
          const pendingMutationAttempted = workspaceMutationInputCorrectionPending
            ? workspaceMutationInputCorrectionAttempted
            : workspaceMutationContinuationAttempted;
          if (pendingMutationAttempted) {
            yield* emitWorkspaceMutationFailure(
              workspaceMutationInputCorrectionPending
                ? "the bounded atomic input correction was already attempted."
                : "the bounded missing-path mutation continuation was already attempted.",
            );
            return;
          }
          selectedMutationCandidate = buildMutationContinuationCandidate();
          if (!selectedMutationCandidate
            || requiresRequiredPathSourceNavigation(selectedMutationCandidate)) {
            yield* emitWorkspaceMutationFailure(
              "no bounded missing-path mutation continuation can be built from the allowed tools, retained source evidence, and remaining token budget.",
            );
            return;
          }
          workspaceMutationContinuationCall = true;
          workspaceMutationInputCorrectionCall = workspaceMutationInputCorrectionPending;
          workspaceMutationCallRequiredPaths = workspaceMutationPathCoverage.missingPaths();
        } else if (workspaceMutationRecoveryReadyByGate || workspaceMutationRecoveryRequiredByHeadroom) {
          selectedMutationCandidate = headroomCandidate ?? buildMutationRecoveryCandidate();
          workspaceMutationCallRequiredPaths = workspaceMutationPathCoverage.missingPaths();
        }
        if (selectedMutationCandidate) {
          const candidate = selectedMutationCandidate;
          mutationRecoveryOutputTokens = candidate.outputTokens;
          const candidateMinimumCost = calculateUsageCostUsd({
            inputTokens: candidate.estimatedInputTokens,
            outputTokens: mutationRecoveryOutputTokens + finalizationOutputTokens,
            pricing: this.opts.usagePricing,
          });
          const candidatePreflight = runBudget.checkModelCallPreflight({
            minimumInputTokens: candidate.estimatedInputTokens,
            minimumOutputTokens: mutationRecoveryOutputTokens + finalizationOutputTokens,
            ...(candidateMinimumCost ? { minimumCostUsd: candidateMinimumCost.totalUsd } : {}),
          });
          if (candidatePreflight) {
            const error = candidatePreflight.budget === "cost_usd"
              ? `required workspace mutation recovery exceeds the remaining cost budget (maximum $${candidatePreflight.limit.toFixed(8)}, projected $${candidatePreflight.observed.toFixed(8)}).`
              : `required workspace mutation recovery exceeds the remaining token budget (maximum ${candidatePreflight.limit}, projected ${candidatePreflight.observed}).`;
            yield* emitBudgetExhausted(
              candidatePreflight.budget,
              candidatePreflight.limit,
              candidatePreflight.observed,
              error,
              {
                policyId: candidatePreflight.policyId,
                stage: candidatePreflight.stage,
                reasonCode: candidatePreflight.reasonCode,
              },
            );
            return;
          }
          workspaceMutationRecoveryCall = true;
          if (workspaceMutationContinuationCall) {
            if (workspaceMutationInputCorrectionCall) {
              workspaceMutationInputCorrectionAttempted = true;
            } else {
              workspaceMutationContinuationAttempted = true;
            }
            workspaceMutationContinuationPending = false;
            workspaceMutationInputCorrectionPending = false;
          } else {
            workspaceMutationRecoveryAttempted = true;
            workspaceMutationRecoveryPending = false;
          }
          workspaceMutationRecoveryRequest = candidate;
          tools = candidate.tools;
          toolNames = tools.map((tool) => tool.function.name);
          logWarn(workspaceMutationInputCorrectionCall
            ? "[workspace-mutation] switching to one bounded atomic input correction"
            : workspaceMutationContinuationCall
              ? "[workspace-mutation] switching to one bounded missing-path continuation"
              : "[workspace-mutation] switching to one bounded mutation-only call", {
            mutationInputTokens: candidate.estimatedInputTokens,
            mutationOutputTokens: mutationRecoveryOutputTokens,
            finalizationOutputReserve: finalizationOutputTokens,
            requiredPathCount: workspaceMutationCallRequiredPaths.length,
            evidenceCount: candidate.evidenceCount,
            truncatedEvidenceCount: candidate.truncatedEvidenceCount,
            conversationId: input.conversationId,
            agentId: resolvedAgentId,
          });
        }
        if (workspaceMutationVerificationPending) {
          const verificationTools = selectWorkspaceMutationNavigationToolDefinitions(
            tools,
            (name) => this.opts.toolExecutor.getRegisteredToolContract?.(name),
          );
          const remainingVerificationInputTokens = Math.min(
            WORKSPACE_MUTATION_NAVIGATION_INPUT_TOKEN_LIMIT,
            Math.floor(Math.max(
              0,
              runBudget.maxTotalTokens
                - runBudget.totalTokens
                - mutationVerificationOutputTokens
                - finalizationOutputTokens,
            ) / REACT_FINALIZATION_INPUT_SAFETY_FACTOR),
          );
          const candidate = buildWorkspaceMutationVerificationRequest({
            messages: mutationRecoverySourceMessages,
            tools: verificationTools,
            maxInputTokens: remainingVerificationInputTokens,
            requiredChangedPaths,
            tokenEstimateContext: dispatchTokenEstimateContext,
          });
          if (!candidate) {
            yield* emitWorkspaceMutationFailure(
              "the mutation succeeded, but no bounded read-after-write request can be built from the allowed tools and remaining token budget.",
            );
            return;
          }
          const candidateMinimumCost = calculateUsageCostUsd({
            inputTokens: candidate.estimatedInputTokens,
            outputTokens: mutationVerificationOutputTokens + finalizationOutputTokens,
            pricing: this.opts.usagePricing,
          });
          const candidatePreflight = runBudget.checkModelCallPreflight({
            minimumInputTokens: candidate.estimatedInputTokens,
            minimumOutputTokens: mutationVerificationOutputTokens + finalizationOutputTokens,
            ...(candidateMinimumCost ? { minimumCostUsd: candidateMinimumCost.totalUsd } : {}),
          });
          if (candidatePreflight) {
            const error = candidatePreflight.budget === "cost_usd"
              ? `required workspace mutation verification exceeds the remaining cost budget (maximum $${candidatePreflight.limit.toFixed(8)}, projected $${candidatePreflight.observed.toFixed(8)}).`
              : `required workspace mutation verification exceeds the remaining token budget (maximum ${candidatePreflight.limit}, projected ${candidatePreflight.observed}).`;
            yield* emitBudgetExhausted(
              candidatePreflight.budget,
              candidatePreflight.limit,
              candidatePreflight.observed,
              error,
              {
                policyId: candidatePreflight.policyId,
                stage: candidatePreflight.stage,
                reasonCode: candidatePreflight.reasonCode,
              },
            );
            return;
          }
          workspaceMutationVerificationCall = true;
          workspaceMutationVerificationPending = false;
          workspaceMutationVerificationAttempts++;
          workspaceMutationVerificationCompletedReadCount = 0;
          workspaceMutationVerificationRequest = candidate;
          tools = candidate.tools;
          toolNames = tools.map((tool) => tool.function.name);
          logWarn("[workspace-mutation] switching to one bounded read-after-write verification call", {
            verificationInputTokens: candidate.estimatedInputTokens,
            verificationOutputTokens: mutationVerificationOutputTokens,
            requiredPathCount: candidate.requiredVerificationPaths.length,
            conversationId: input.conversationId,
            agentId: resolvedAgentId,
          });
        }
        if (workspaceMutationObjectiveReviewPending && !workspaceMutationVerificationCall) {
          const mutationTools = selectWorkspaceMutationToolDefinitions(
            tools,
            (name) => this.opts.toolExecutor.getRegisteredToolContract?.(name),
          ).filter((tool) => tool.function.name === "apply_patch");
          const remainingReviewInputTokens = Math.min(
            WORKSPACE_MUTATION_NAVIGATION_INPUT_TOKEN_LIMIT,
            Math.floor(Math.max(
              0,
              runBudget.maxTotalTokens
                - runBudget.totalTokens
                - mutationVerificationOutputTokens,
            ) / REACT_FINALIZATION_INPUT_SAFETY_FACTOR),
          );
          const candidate = buildWorkspaceMutationObjectiveReviewRequest({
            messages: mutationRecoverySourceMessages,
            tools: workspaceMutationObjectiveCorrectionAttempted ? [] : mutationTools,
            maxInputTokens: remainingReviewInputTokens,
            requiredChangedPaths,
            correctionAllowed: !workspaceMutationObjectiveCorrectionAttempted,
            tokenEstimateContext: dispatchTokenEstimateContext,
          });
          if (!candidate) {
            yield* emitWorkspaceMutationFailure(
              "the mutation was read back, but no bounded post-write objective review can be built from the allowed tools, evidence, and remaining token budget.",
            );
            return;
          }
          const candidateMinimumCost = calculateUsageCostUsd({
            inputTokens: candidate.estimatedInputTokens,
            outputTokens: mutationVerificationOutputTokens,
            pricing: this.opts.usagePricing,
          });
          const candidatePreflight = runBudget.checkModelCallPreflight({
            minimumInputTokens: candidate.estimatedInputTokens,
            minimumOutputTokens: mutationVerificationOutputTokens,
            ...(candidateMinimumCost ? { minimumCostUsd: candidateMinimumCost.totalUsd } : {}),
          });
          if (candidatePreflight) {
            const error = candidatePreflight.budget === "cost_usd"
              ? `required workspace mutation objective review exceeds the remaining cost budget (maximum $${candidatePreflight.limit.toFixed(8)}, projected $${candidatePreflight.observed.toFixed(8)}).`
              : `required workspace mutation objective review exceeds the remaining token budget (maximum ${candidatePreflight.limit}, projected ${candidatePreflight.observed}).`;
            yield* emitBudgetExhausted(
              candidatePreflight.budget,
              candidatePreflight.limit,
              candidatePreflight.observed,
              error,
              {
                policyId: candidatePreflight.policyId,
                stage: candidatePreflight.stage,
                reasonCode: candidatePreflight.reasonCode,
              },
            );
            return;
          }
          workspaceMutationObjectiveReviewCall = true;
          workspaceMutationObjectiveReviewPending = false;
          workspaceMutationObjectiveReviewAttempts++;
          workspaceMutationObjectiveReviewRequest = candidate;
          workspaceMutationCallRequiredPaths = [...requiredChangedPaths];
          tools = candidate.tools;
          toolNames = tools.map((tool) => tool.function.name);
          logWarn("[workspace-mutation] switching to bounded post-write objective review", {
            reviewInputTokens: candidate.estimatedInputTokens,
            reviewOutputTokens: mutationVerificationOutputTokens,
            reviewAttempt: workspaceMutationObjectiveReviewAttempts,
            correctionAttempted: workspaceMutationObjectiveCorrectionAttempted,
            requiredPathCount: requiredChangedPaths.length,
            evidenceCount: candidate.evidenceCount,
            truncatedEvidenceCount: candidate.truncatedEvidenceCount,
            conversationId: input.conversationId,
            agentId: resolvedAgentId,
          });
        }
        if (workspaceMutationFinalizationPending && !workspaceMutationVerificationCall) {
          const remainingInputTokens = Math.floor(Math.max(
            0,
            runBudget.maxTotalTokens
              - runBudget.totalTokens
              - finalizationOutputTokens,
          ) / REACT_FINALIZATION_INPUT_SAFETY_FACTOR);
          const candidate = buildReactFinalizationRequest({
            messages: preflightRequestMessages,
            maxInputTokens: remainingInputTokens,
            tokenEstimateContext: dispatchTokenEstimateContext,
          });
          if (!candidate) {
            yield* emitWorkspaceMutationFailure(
              "the mutation succeeded, but no bounded tool-free finalization fits the remaining token budget.",
            );
            return;
          }
          const candidateMinimumCost = calculateUsageCostUsd({
            inputTokens: candidate.estimatedInputTokens,
            outputTokens: finalizationOutputTokens,
            pricing: this.opts.usagePricing,
          });
          const candidatePreflight = runBudget.checkModelCallPreflight({
            minimumInputTokens: candidate.estimatedInputTokens,
            minimumOutputTokens: finalizationOutputTokens,
            ...(candidateMinimumCost ? { minimumCostUsd: candidateMinimumCost.totalUsd } : {}),
          });
          if (candidatePreflight) {
            const error = candidatePreflight.budget === "cost_usd"
              ? `required workspace mutation finalization exceeds the remaining cost budget (maximum $${candidatePreflight.limit.toFixed(8)}, projected $${candidatePreflight.observed.toFixed(8)}).`
              : `required workspace mutation finalization exceeds the remaining token budget (maximum ${candidatePreflight.limit}, projected ${candidatePreflight.observed}).`;
            yield* emitBudgetExhausted(
              candidatePreflight.budget,
              candidatePreflight.limit,
              candidatePreflight.observed,
              error,
              {
                policyId: candidatePreflight.policyId,
                stage: candidatePreflight.stage,
                reasonCode: candidatePreflight.reasonCode,
              },
            );
            return;
          }
          workspaceMutationFinalizationPending = false;
          workspaceMutationFinalizationCall = true;
          finalizationOnlyCall = true;
          finalizationRequest = candidate;
          tools = [];
          toolNames = [];
        }
        const reservedPromptTokens = workspaceMutationVerificationRequest?.estimatedInputTokens
          ?? workspaceMutationObjectiveReviewRequest?.estimatedInputTokens
          ?? workspaceMutationNavigationRequest?.estimatedInputTokens
          ?? workspaceMutationRecoveryRequest?.estimatedInputTokens
          ?? finalizationRequest?.estimatedInputTokens
          ?? boundedStructuredOutputRepairRequest?.estimatedInputTokens
          ?? preflightPromptTokens;
        const reservedOutputTokens = workspaceMutationVerificationCall
          ? mutationVerificationOutputTokens + finalizationOutputTokens
          : workspaceMutationObjectiveReviewCall
          ? mutationVerificationOutputTokens
          : workspaceMutationNavigationCall
          ? mutationNavigationOutputTokens
          : workspaceMutationRecoveryCall
          ? mutationRecoveryOutputTokens + finalizationOutputTokens
          : finalizationOnlyCall || boundedStructuredOutputRepairRequest
            ? finalizationOutputTokens
            : runtimeContext?.launchSpec?.modelLoopBudgetPolicy
              ? MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve
              : 0;
        const modelLoopMinimumCost = calculateUsageCostUsd({
          inputTokens: reservedPromptTokens,
          outputTokens: reservedOutputTokens,
          pricing: this.opts.usagePricing,
        });
        const modelLoopBudgetExhausted = runBudget.reserveModelCall({
          minimumInputTokens: reservedPromptTokens,
          minimumOutputTokens: reservedOutputTokens,
          ...(modelLoopMinimumCost ? { minimumCostUsd: modelLoopMinimumCost.totalUsd } : {}),
        });
        if (modelLoopBudgetExhausted) {
          const error = modelLoopBudgetExhausted.budget === "model_calls"
            ? `模型循环成本止损已触发（最多 ${modelLoopBudgetExhausted.limit} 次模型调用）。任务结果尚未评估，请缩小任务或在新的受控运行中继续。`
            : modelLoopBudgetExhausted.budget === "cost_usd"
              ? `剩余费用预算不足以覆盖下一次模型调用的最小输入与输出保留（最大 $${modelLoopBudgetExhausted.limit.toFixed(8)}，预计累计 $${modelLoopBudgetExhausted.observed.toFixed(8)}）。`
              : `剩余 token 预算不足以覆盖下一次模型调用的最小输入与 ${MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve} token 输出保留（最大 ${modelLoopBudgetExhausted.limit}，预计累计 ${modelLoopBudgetExhausted.observed}）。`;
          yield* emitBudgetExhausted(
            modelLoopBudgetExhausted.budget,
            modelLoopBudgetExhausted.limit,
            modelLoopBudgetExhausted.observed,
            error,
            {
              policyId: modelLoopBudgetExhausted.policyId,
              stage: modelLoopBudgetExhausted.stage,
              reasonCode: modelLoopBudgetExhausted.reasonCode,
            },
          );
          return;
        }
        if (emptyContentFinalizationPending) {
          const recoveryError = pendingEmptyContentFinalizationError
            ?? "模型返回空内容，且无法构造有界最终总结。";
          pendingEmptyContentFinalizationError = undefined;
          const remainingInputTokens = Math.floor(Math.max(
            0,
            runBudget.maxTotalTokens
              - runBudget.totalTokens
              - finalizationOutputTokens,
          ) / REACT_FINALIZATION_INPUT_SAFETY_FACTOR);
          const candidate = buildReactFinalizationRequest({
            messages: preflightRequestMessages,
            maxInputTokens: remainingInputTokens,
            tokenEstimateContext: dispatchTokenEstimateContext,
          });
          const candidateMinimumCost = candidate
            ? calculateUsageCostUsd({
              inputTokens: candidate.estimatedInputTokens,
              outputTokens: finalizationOutputTokens,
              pricing: this.opts.usagePricing,
            })
            : undefined;
          const candidatePreflight = candidate
            ? runBudget.checkModelCallPreflight({
              minimumInputTokens: candidate.estimatedInputTokens,
              minimumOutputTokens: finalizationOutputTokens,
              ...(candidateMinimumCost ? { minimumCostUsd: candidateMinimumCost.totalUsd } : {}),
            })
            : undefined;
          if (!candidate) {
            runSuccess = false;
            runError = recoveryError;
            yield* yieldItem(buildUsageItem());
            yield* yieldItem({ type: "final", text: recoveryError });
            yield* yieldItem({ type: "status", status: "error" });
            return;
          }
          if (candidatePreflight) {
            const error = candidatePreflight.budget === "cost_usd"
              ? `剩余费用预算不足以覆盖空内容恢复的有界最终总结（最大 $${candidatePreflight.limit.toFixed(8)}，预计累计 $${candidatePreflight.observed.toFixed(8)}）。`
              : `剩余 token 预算不足以覆盖空内容恢复的有界最终总结（最大 ${candidatePreflight.limit}，预计累计 ${candidatePreflight.observed}）。`;
            yield* emitBudgetExhausted(
              candidatePreflight.budget,
              candidatePreflight.limit,
              candidatePreflight.observed,
              error,
              {
                policyId: candidatePreflight.policyId,
                stage: candidatePreflight.stage,
                reasonCode: candidatePreflight.reasonCode,
              },
            );
            return;
          }
          finalizationOnlyCall = true;
          finalizationRequest = candidate;
          tools = [];
          toolNames = [];
          logWarn("[model-empty-content] switching to bounded finalization-only call", {
            remainingInputTokens,
            finalizationInputTokens: candidate.estimatedInputTokens,
            finalizationOutputTokens,
            evidenceCount: candidate.evidenceCount,
            truncatedEvidenceCount: candidate.truncatedEvidenceCount,
            conversationId: input.conversationId,
            agentId: resolvedAgentId,
          });
        }
        if (
          modelCallCount > 0
          && !structuredOutputRepairCall
          && !runBudget.modelLoopBudgetPolicy
          && !finalizationOnlyCall
          && !workspaceMutationVerificationCall
        ) {
          const ordinaryMinimumCost = calculateUsageCostUsd({
            inputTokens: preflightPromptTokens,
            outputTokens: finalizationOutputTokens,
            pricing: this.opts.usagePricing,
          });
          const ordinaryPreflight = runBudget.checkModelCallPreflight({
            minimumInputTokens: preflightPromptTokens,
            minimumOutputTokens: finalizationOutputTokens,
            ...(ordinaryMinimumCost ? { minimumCostUsd: ordinaryMinimumCost.totalUsd } : {}),
          });
          if (
            (ordinaryPreflight || workspaceMutationNavigationRequiredByGate)
            && workspaceMutationRequired
            && !workspaceMutationObserved
            && !workspaceMutationRecoveryAttempted
          ) {
            const candidate = buildMutationRecoveryCandidate();
            if (!candidate) {
              yield* emitWorkspaceMutationFailure(
                "the ordinary model loop reached its budget gate before an allowed bounded mutation-only request could be built.",
              );
              return;
            }
            if (!requiresRequiredPathSourceNavigation(candidate)
              && isMutationRecoveryReadyForHeadroom(candidate)) {
              mutationRecoveryOutputTokens = candidate.outputTokens;
              const candidateMinimumCost = calculateUsageCostUsd({
                inputTokens: candidate.estimatedInputTokens,
                outputTokens: mutationRecoveryOutputTokens + finalizationOutputTokens,
                pricing: this.opts.usagePricing,
              });
              const candidatePreflight = runBudget.checkModelCallPreflight({
                minimumInputTokens: candidate.estimatedInputTokens,
                minimumOutputTokens: mutationRecoveryOutputTokens + finalizationOutputTokens,
                ...(candidateMinimumCost ? { minimumCostUsd: candidateMinimumCost.totalUsd } : {}),
              });
              if (candidatePreflight) {
                yield* emitBudgetExhausted(
                  candidatePreflight.budget,
                  candidatePreflight.limit,
                  candidatePreflight.observed,
                  "required workspace mutation recovery cannot fit before the active model-loop budget closes.",
                );
                return;
              }
              workspaceMutationRecoveryCall = true;
              workspaceMutationRecoveryAttempted = true;
              workspaceMutationRecoveryPending = false;
              workspaceMutationCallRequiredPaths = workspaceMutationPathCoverage.missingPaths();
              workspaceMutationRecoveryRequest = candidate;
              tools = candidate.tools;
              toolNames = tools.map((tool) => tool.function.name);
            } else {
              if (workspaceMutationNavigationAttempts >= workspaceMutationNavigationAttemptLimit) {
                yield* emitWorkspaceMutationFailure(
                  `the ${workspaceMutationNavigationAttemptLimit} bounded source-navigation call(s) did not produce complete source evidence for mutation recovery.`,
                );
                return;
              }
              const navigationTools = selectWorkspaceMutationNavigationToolDefinitions(
                tools,
                (name) => this.opts.toolExecutor.getRegisteredToolContract?.(name),
              );
              const remainingNavigationInputTokens = Math.min(
                WORKSPACE_MUTATION_NAVIGATION_INPUT_TOKEN_LIMIT,
                Math.floor(Math.max(
                  0,
                  runBudget.maxTotalTokens
                    - runBudget.totalTokens
                    - candidate.estimatedInputTokens
                    - candidate.outputTokens
                    - finalizationOutputTokens
                    - mutationNavigationOutputTokens,
                ) / REACT_FINALIZATION_INPUT_SAFETY_FACTOR),
              );
              const navigationRequest = buildWorkspaceMutationNavigationRequest({
                messages: mutationRecoverySourceMessages,
                tools: navigationTools,
                maxInputTokens: remainingNavigationInputTokens,
                missingRequiredChangedPaths: candidate.missingRequiredSourceEvidencePaths,
                tokenEstimateContext: dispatchTokenEstimateContext,
              });
              const navigationMinimumCost = navigationRequest
                ? calculateUsageCostUsd({
                    inputTokens: navigationRequest.estimatedInputTokens + candidate.estimatedInputTokens,
                    outputTokens: mutationNavigationOutputTokens
                      + candidate.outputTokens
                      + finalizationOutputTokens,
                    pricing: this.opts.usagePricing,
                  })
                : undefined;
              const navigationPreflight = navigationRequest
                ? runBudget.checkModelCallPreflight({
                    minimumInputTokens: navigationRequest.estimatedInputTokens + candidate.estimatedInputTokens,
                    minimumOutputTokens: mutationNavigationOutputTokens
                      + candidate.outputTokens
                      + finalizationOutputTokens,
                    ...(navigationMinimumCost ? { minimumCostUsd: navigationMinimumCost.totalUsd } : {}),
                  })
                : ordinaryPreflight;
              if (!navigationRequest || navigationPreflight) {
                yield* emitWorkspaceMutationFailure(
                  "the ordinary model loop reached its budget gate before bounded source navigation and mutation recovery could both fit.",
                );
                return;
              }
              workspaceMutationNavigationCall = true;
              workspaceMutationNavigationAttempts++;
              workspaceMutationNavigationRequest = navigationRequest;
              tools = navigationRequest.tools;
              toolNames = tools.map((tool) => tool.function.name);
              logWarn("[workspace-mutation] switching to one bounded source-navigation call", {
                navigationInputTokens: navigationRequest.estimatedInputTokens,
                navigationOutputTokens: mutationNavigationOutputTokens,
                evidenceCount: navigationRequest.evidenceCount,
                truncatedEvidenceCount: navigationRequest.truncatedEvidenceCount,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
            }
          }
          if (ordinaryPreflight && !workspaceMutationRecoveryCall && !workspaceMutationNavigationCall) {
            const remainingInputTokens = Math.floor(Math.max(
              0,
              runBudget.maxTotalTokens
                - runBudget.totalTokens
                - finalizationOutputTokens,
            ) / REACT_FINALIZATION_INPUT_SAFETY_FACTOR);
            const candidate = buildReactFinalizationRequest({
              messages: preflightRequestMessages,
              maxInputTokens: remainingInputTokens,
              tokenEstimateContext: dispatchTokenEstimateContext,
            });
            const candidateMinimumCost = candidate
              ? calculateUsageCostUsd({
                inputTokens: candidate.estimatedInputTokens,
                outputTokens: finalizationOutputTokens,
                pricing: this.opts.usagePricing,
              })
              : undefined;
            const candidatePreflight = candidate
              ? runBudget.checkModelCallPreflight({
                minimumInputTokens: candidate.estimatedInputTokens,
                minimumOutputTokens: finalizationOutputTokens,
                ...(candidateMinimumCost ? { minimumCostUsd: candidateMinimumCost.totalUsd } : {}),
              })
              : ordinaryPreflight;
            if (candidate && !candidatePreflight) {
              finalizationOnlyCall = true;
              finalizationRequest = candidate;
              finalizationTrigger = ordinaryPreflight;
              tools = [];
              toolNames = [];
              logWarn("[model-loop-budget] switching to bounded finalization-only call", {
                triggerBudget: ordinaryPreflight.budget,
                triggerObserved: ordinaryPreflight.observed,
                remainingInputTokens,
                finalizationInputTokens: candidate.estimatedInputTokens,
                evidenceCount: candidate.evidenceCount,
                truncatedEvidenceCount: candidate.truncatedEvidenceCount,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
            } else {
              const error = ordinaryPreflight.budget === "cost_usd"
                ? `剩余费用预算不足以覆盖有界最终总结（最大 $${ordinaryPreflight.limit.toFixed(8)}，预计累计 $${ordinaryPreflight.observed.toFixed(8)}）。`
                : `剩余 token 预算不足以覆盖有界最终总结（最大 ${ordinaryPreflight.limit}，预计累计 ${ordinaryPreflight.observed}）。`;
              yield* emitBudgetExhausted(
                ordinaryPreflight.budget,
                ordinaryPreflight.limit,
                ordinaryPreflight.observed,
                error,
              );
              return;
            }
          }
        }
        const steerCommands = input.steering
          && !structuredOutputRepairCall
          && !finalizationOnlyCall
          && !workspaceMutationRecoveryCall
          && !workspaceMutationNavigationCall
          && !workspaceMutationVerificationCall
          && !workspaceMutationObjectiveReviewCall
          ? await input.steering.consumePending({ modelCallIndex: nextModelCallIndex })
          : [];
        for (const command of steerCommands) {
          messages.push({ role: "user", content: command.prompt });
        }
        const requestMessages = workspaceMutationVerificationRequest
          ? workspaceMutationVerificationRequest.messages as Message[]
          : workspaceMutationObjectiveReviewRequest
          ? workspaceMutationObjectiveReviewRequest.messages as Message[]
          : workspaceMutationNavigationRequest
          ? workspaceMutationNavigationRequest.messages as Message[]
          : workspaceMutationRecoveryRequest
          ? workspaceMutationRecoveryRequest.messages as Message[]
          : finalizationRequest
            ? finalizationRequest.messages as Message[]
            : boundedStructuredOutputRepairRequest
              ? boundedStructuredOutputRepairRequest.messages as Message[]
              : applyStablePrefixSplitMessageLayout(messages, {
                transientText: currentTransientTailText,
                independentBlockText: currentIndependentBlockText,
                messageLayout: this.opts.messageLayout,
              }) as Message[];
        const dispatchSystemPromptTokens = estimateSystemPromptTokens(
          requestMessages,
          dispatchTokenEstimateContext,
        );
        const dispatchContextTokens = estimateContextTokensFromMessages(
          requestMessages,
          { includeSystem: false },
          dispatchTokenEstimateContext,
        );
        lastRequestShape = {
          messageCount: requestMessages.length,
          systemMessageCount: requestMessages.filter((message) => message.role === "system").length,
          toolSchemaCount: tools.length,
        };
        lastLocalPromptEstimate = {
          systemPromptTokens: dispatchSystemPromptTokens,
          contextTokens: dispatchContextTokens,
          totalPromptTokens: dispatchSystemPromptTokens + dispatchContextTokens,
        };
        const modelCallStartedAt = Date.now();
        logDebug("[model-call] dispatch", {
          modelCallIndex: nextModelCallIndex,
          conversationId: input.conversationId,
          agentId: resolvedAgentId,
          messageCount: lastRequestShape.messageCount,
          systemMessageCount: lastRequestShape.systemMessageCount,
          toolDefinitionCount: lastRequestShape.toolSchemaCount,
          estimatedSystemPromptTokens: lastLocalPromptEstimate.systemPromptTokens,
          estimatedContextTokens: lastLocalPromptEstimate.contextTokens,
          estimatedPromptTokens: lastLocalPromptEstimate.totalPromptTokens,
          toolNamesPreview: toolNames.slice(0, 12),
          hasApplyPatch: toolNames.includes("apply_patch"),
          hasFileRead: toolNames.includes("file_read"),
          hasFileWrite: toolNames.includes("file_write"),
          hasListFiles: toolNames.includes("list_files"),
          hasToolSearch: toolNames.includes("tool_search"),
          textAttachmentChars,
          finalizationOnly: finalizationOnlyCall,
          workspaceMutationNavigation: workspaceMutationNavigationCall,
          workspaceMutationRecovery: workspaceMutationRecoveryCall,
          workspaceMutationVerification: workspaceMutationVerificationCall,
          workspaceMutationObjectiveReview: workspaceMutationObjectiveReviewCall,
          workspaceMutationFinalization: workspaceMutationFinalizationCall,
        });

        // 调用模型。流式模式通过相邻单槽 delivery 转发，避免在本文件持有队列和协议状态。
        const streamDelivery = this.opts.streamingEnabled
          && !structuredOutputSession
          && !finalizationOnlyCall
          && !workspaceMutationNavigationCall
          && !workspaceMutationRecoveryCall
          && !workspaceMutationVerificationCall
          && !workspaceMutationObjectiveReviewCall
          ? createModelStreamTextDelivery()
          : undefined;
        const responsePromise = this.callModel(
          requestMessages,
          tools.length > 0 ? tools : undefined,
          textAttachmentChars,
          {
            agentId: resolvedAgentId,
            conversationId: input.conversationId,
            modelCallIndex: nextModelCallIndex,
          },
          input.abortSignal,
          (requestMessages, trimDiagnostics) => {
            lastTrimDiagnostics = trimDiagnostics;
            lastPrefixShape = buildPrefixShape({
              messages: requestMessages,
              tools,
              runtimePromptDeltas: currentRunPromptDeltas,
              providerNativeSystemBlocks,
              model: currentTokenEstimateModel,
            });
            const previousComparableSnapshot = readPrefixComparableSnapshot(runSystemPromptMetadata);
            lastPrefixDrift = classifyPrefixDrift({
              previous: previousComparableSnapshot,
              current: {
                fingerprint: lastPrefixShape.fingerprint,
                shapeHashes: { ...lastPrefixShape.shapeHashes },
                routeTier: undefined,
                routeModel: currentTokenEstimateModel,
              },
            });
            lastBudgetCompetition = buildBudgetCompetition({
              messages: requestMessages,
              tools,
              runtimePromptDeltas: currentRunPromptDeltas,
              providerNativeSystemBlocks,
              prependContext,
              maxInputTokens: maxInput,
              model: currentTokenEstimateModel,
              trimDiagnostics: lastTrimDiagnostics,
            });
            capturePromptSnapshot(requestMessages);
          },
          currentSystemPromptState.bypassProviderNativeSystemBlocks
            || finalizationOnlyCall
            || workspaceMutationNavigationCall
            || workspaceMutationRecoveryCall
            || workspaceMutationVerificationCall
            || workspaceMutationObjectiveReviewCall
            || boundedStructuredOutputRepairRequest !== undefined
            ? undefined
            : providerNativeSystemBlocks,
          streamDelivery,
          workspaceMutationVerificationCall
            ? mutationVerificationOutputTokens
            : workspaceMutationObjectiveReviewCall
            ? mutationVerificationOutputTokens
            : workspaceMutationNavigationCall
            ? mutationNavigationOutputTokens
            : workspaceMutationRecoveryCall
            ? mutationRecoveryOutputTokens
            : finalizationOnlyCall || boundedStructuredOutputRepairRequest
              ? finalizationOutputTokens
              : undefined,
          workspaceMutationNavigationCall || workspaceMutationRecoveryCall || workspaceMutationVerificationCall
            ? "required"
            : undefined,
          finalizationOnlyCall,
        );
        if (boundedStructuredOutputRepairRequest) {
          pendingBoundedStructuredOutputRepairRequest = undefined;
        }
        modelCallCount++;
        let response: Awaited<typeof responsePromise>;
        if (streamDelivery) {
          const deliveredResponsePromise = responsePromise.then(
            async (result) => {
              if (result.ok) await streamDelivery.complete();
              else if (result.interrupted?.committed) await streamDelivery.interrupt();
              else await streamDelivery.abort();
              return result;
            },
            async (error) => {
              await streamDelivery.abort();
              throw error;
            },
          );
          for await (const delta of streamDelivery.deltas) {
            yield* yieldItem({ type: "delta", delta });
          }
          response = await deliveredResponsePromise;
        } else {
          response = await responsePromise;
        }
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
          yield* emitRunAbort();
          return;
        }

        // 记录并累加 usage 信息
        if (response.usage) {
          const u = response.usage;
          providerReportedModelCallCount++;
          lastProviderRawUsage = response.rawUsage ? { ...response.rawUsage } : {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
            promptCacheHitTokens: u.prompt_cache_hit_tokens ?? 0,
            promptCacheMissTokens: u.prompt_cache_miss_tokens ?? 0,
          };
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
            totalUsageCostUsd += usageCost.totalUsd;
          }
          tokenCounter.notifyUsage(u.input_tokens, u.output_tokens, usageCost
            ? {
                inputCostUsd: Math.max(0, usageCost.totalUsd - usageCost.outputUsd),
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
        }

        // 供应商没有 usage 时，才用本轮请求形状和返回载荷做本地估算。
        // 估算仅用于预算兜底，不覆盖 Provider 已报告的 usage/cached token。
        const fallbackOutputTokenSource = (response.ok
          ? [
            response.content,
            response.reasoning_content,
            response.toolCalls?.map((toolCall) => JSON.stringify(toolCall)).join("\n"),
          ]
          : [response.reasoning_content]
        ).filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
        const usageCostForBudget = response.usage
          ? calculateUsageCostUsd({
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
            cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
            cacheHitTokens: response.usage.prompt_cache_hit_tokens ?? 0,
            pricing: this.opts.usagePricing,
          })
          : undefined;
        const totalTokenBudgetExhausted = (response.ok || response.emptyContent)
          ? runBudget.recordModelUsage({
            providerUsageAvailable: response.usage !== undefined,
            inputTokens: response.usage?.input_tokens ?? 0,
            outputTokens: response.usage?.output_tokens ?? 0,
            cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0,
            fallbackInputTokens: lastLocalPromptEstimate?.totalPromptTokens
              ?? estimateMessagesTotal(requestMessages, dispatchTokenEstimateContext),
            fallbackOutputTokens: estimateTokens(fallbackOutputTokenSource, dispatchTokenEstimateContext),
            ...(usageCostForBudget ? { costUsd: usageCostForBudget.totalUsd } : {}),
          })
          : undefined;
        if (totalTokenBudgetExhausted) {
          const error = totalTokenBudgetExhausted.budget === "cost_usd"
            ? `累计费用预算超限（最大 $${totalTokenBudgetExhausted.limit.toFixed(8)}，已累计 $${totalTokenBudgetExhausted.observed.toFixed(8)}）。已停止后续模型和工具调用。`
            : `累计 token 预算超限（最大 ${totalTokenBudgetExhausted.limit} token，已累计 ${totalTokenBudgetExhausted.observed}）。请拆分任务、收敛上下文，或仅为受控 Profile 提高预算后继续。`;
          if (structuredOutputRepairCall && structuredOutputSession) {
            const rejection = structuredOutputSession.rejectRepair(error);
            yield* emitStructuredOutputFailure(rejection, {
              type: "budget_exhausted",
              budget: totalTokenBudgetExhausted.budget,
              limit: totalTokenBudgetExhausted.limit,
              observed: totalTokenBudgetExhausted.observed,
            }, false);
            return;
          }
          yield* emitBudgetExhausted(
            totalTokenBudgetExhausted.budget,
            totalTokenBudgetExhausted.limit,
            totalTokenBudgetExhausted.observed,
            error,
          );
          return;
        }

        if (!response.ok) {
          if (response.error === STOP_REQUESTED_ERROR) {
            yield* emitRunAbort();
            return;
          }
          if (workspaceMutationRecoveryCall) {
            yield* emitWorkspaceMutationFailure(`the mutation-only model call failed: ${response.error}`);
            return;
          }
          if (workspaceMutationNavigationCall) {
            yield* emitWorkspaceMutationFailure(`the bounded source-navigation model call failed: ${response.error}`);
            return;
          }
          if (workspaceMutationVerificationCall) {
            yield* emitWorkspaceMutationFailure(`the bounded read-after-write model call failed: ${response.error}`);
            return;
          }
          if (
            response.emptyContent?.finishReason === "length"
            && !emptyContentFinalizationAttempted
            && !finalizationOnlyCall
            && !structuredOutputRepairCall
          ) {
            emptyContentFinalizationAttempted = true;
            pendingEmptyContentFinalizationError = response.error;
            logWarn("[model-empty-content] scheduling one bounded finalization", {
              finishReason: response.emptyContent.finishReason,
              reasoningContentLength: response.emptyContent.reasoningContentLength,
              modelCallIndex: nextModelCallIndex,
              totalTokens: runBudget.totalTokens,
              maxTotalTokens: runBudget.maxTotalTokens,
              conversationId: input.conversationId,
              agentId: resolvedAgentId,
            });
            continue;
          }
          runSuccess = false;
          runError = response.error;
          yield* yieldItem(buildUsageItem());
          if (response.interrupted) {
            yield* yieldItem(response.interrupted);
            yield* yieldItem({ type: "status", status: "error" });
            return;
          }
          yield* yieldItem({ type: "final", text: response.error });
          yield* yieldItem({ type: "status", status: "error" });
          return;
        }

        // 输出文本增量（如果有）；先剥离工具调用协议块，避免在对话中展示
        const postprocessStartedAt = Date.now();
        const contentForDisplay = streamDelivery
          ? streamDelivery.getText().trim()
          : stripToolCallsSection(response.content || "");
        logDebug("[model-call] postprocess_done", {
          modelCallIndex: nextModelCallIndex,
          conversationId: input.conversationId,
          agentId: resolvedAgentId,
          durationMs: Date.now() - postprocessStartedAt,
          originalContentLength: response.content?.length ?? 0,
          displayContentLength: contentForDisplay.length,
        });
        if (stopRequestedAfterModel && structuredOutputSession) {
          const review = structuredOutputSession.reviewFinal(contentForDisplay);
          if (review.action !== "accept") {
            const rejection = structuredOutputSession.rejectRepair(
              `Structured output repair was not started because the ${maxRunWallTimeMs}ms wall-time budget expired.`,
            );
            yield* emitStructuredOutputFailure(rejection, {
              type: "budget_exhausted",
              budget: "wall_time_ms",
              limit: maxRunWallTimeMs,
              observed: Math.max(maxRunWallTimeMs, Date.now() - runBudgetStartedAt),
            });
            return;
          }
          yield* emitRunAbort();
          return;
        }

        if (
          input.conversationId
          && !structuredOutputRepairCall
          && !finalizationOnlyCall
          && !workspaceMutationNavigationCall
          && !workspaceMutationRecoveryCall
          && !workspaceMutationVerificationCall
        ) {
          await this.opts.toolExecutor.consumeLoadedDeferredToolsForNextTurn(input.conversationId);
        }

        if (
          contentForDisplay
          && !streamDelivery
          && !structuredOutputSession
          && !workspaceMutationRecoveryCall
          && !workspaceMutationVerificationCall
          && !(workspaceMutationRequired && !workspaceMutationObserved)
        ) {
          for (const delta of splitText(contentForDisplay, 16)) {
            yield* yieldItem({ type: "delta", delta });
          }
        }

        // 检查是否有工具调用
        let toolCalls = response.toolCalls;
        logDebug("[tool-check] model response analyzed", {
          toolCallCount: toolCalls?.length ?? 0,
          responseContentLength: response.content?.length ?? 0,
          toolDefinitionCount: tools.length,
          toolNamesPreview: toolNames.slice(0, 12),
        });
        if (finalizationOnlyCall && toolCalls && toolCalls.length > 0) {
          const error = "有界最终总结返回了工具调用；该阶段禁止继续执行工具或发起额外模型调用。";
          if (structuredOutputSession) {
            yield* emitStructuredOutputFailure({
              originalText: contentForDisplay,
              message: error,
            });
          } else if (finalizationTrigger) {
            yield* emitBudgetExhausted(
              finalizationTrigger.budget,
              finalizationTrigger.limit,
              finalizationTrigger.observed,
              error,
            );
          } else {
            runSuccess = false;
            runError = error;
            yield* yieldItem(buildUsageItem());
            yield* yieldItem({ type: "final", text: error });
            yield* yieldItem({ type: "status", status: "error" });
          }
          return;
        }
        if (structuredOutputRepairCall && toolCalls && toolCalls.length > 0 && structuredOutputSession) {
          const rejection = structuredOutputSession.rejectRepair(
            "Structured output repair returned a tool call instead of valid JSON.",
          );
          yield* emitStructuredOutputFailure(rejection);
          return;
        }
        if (!toolCalls || toolCalls.length === 0) {
          if (workspaceMutationVerificationCall) {
            yield* emitWorkspaceMutationFailure(
              "the bounded read-after-write model call did not request the required post-mutation file reads.",
            );
            return;
          }
          if (workspaceMutationRequired && !workspaceMutationObserved) {
            if (workspaceMutationNavigationCall) {
              yield* emitWorkspaceMutationFailure(
                "the bounded source-navigation model call did not request a source-read tool.",
              );
              return;
            }
            if (workspaceMutationRecoveryCall || workspaceMutationRecoveryAttempted) {
              yield* emitWorkspaceMutationFailure(
                "the one mutation-only model call did not request a workspace mutation tool.",
              );
              return;
            }
            workspaceMutationRecoveryPending = true;
            messages.push({
              role: "assistant",
              content: response.content || contentForDisplay,
            });
            continue;
          }
          if (structuredOutputSession) {
            const review = structuredOutputSession.reviewFinal(contentForDisplay);
            if (review.action === "repair") {
              if (finalizationOnlyCall) {
                const rejection = structuredOutputSession.rejectRepair(
                  "Structured output repair was not started because the bounded finalization-only call is terminal.",
                );
                yield* emitStructuredOutputFailure(rejection);
                return;
              }
              const repairWallTimeObserved = Date.now() - runBudgetStartedAt;
              if (repairWallTimeObserved >= maxRunWallTimeMs) {
                const rejection = structuredOutputSession.rejectRepair(
                  `Structured output repair was not started because the ${maxRunWallTimeMs}ms wall-time budget expired.`,
                );
                yield* emitStructuredOutputFailure(rejection, {
                  type: "budget_exhausted",
                  budget: "wall_time_ms",
                  limit: maxRunWallTimeMs,
                  observed: repairWallTimeObserved,
                });
                return;
              }
              const repairModelCallIndex = modelCallCount + 1;
              const iterationBudget = runBudgets.toolLoopIterationBudget;
              if (iterationBudget > 0 && repairModelCallIndex > iterationBudget) {
                const rejection = structuredOutputSession.rejectRepair(
                  `Structured output repair was not started because the model-turn budget is limited to ${iterationBudget}.`,
                );
                yield* emitStructuredOutputFailure(rejection, {
                  type: "budget_exhausted",
                  budget: "tool_loop_iterations",
                  limit: iterationBudget,
                  observed: repairModelCallIndex,
                });
                return;
              }
              const repairAssistantMessage: Message = {
                role: "assistant",
                content: response.content || contentForDisplay,
              };
              const repairPromptMessage: Message = { role: "user", content: review.prompt };
              const repairMessages = applyStablePrefixSplitMessageLayout(
                [...messages, repairAssistantMessage, repairPromptMessage],
                {
                  transientText: currentTransientTailText,
                  independentBlockText: currentIndependentBlockText,
                  messageLayout: this.opts.messageLayout,
                },
              ) as Message[];
              const repairTokenEstimateContext = currentTokenEstimateModel
                ? { model: currentTokenEstimateModel }
                : undefined;
              const minimumRepairInputTokens = estimateMessagesTotal(
                repairMessages,
                repairTokenEstimateContext,
              );
              const minimumRepairCost = calculateUsageCostUsd({
                inputTokens: minimumRepairInputTokens,
                outputTokens: runtimeContext?.launchSpec?.modelLoopBudgetPolicy
                  ? MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve
                  : 0,
                pricing: this.opts.usagePricing,
              });
              const repairBudgetExhausted = runBudget.checkModelCallPreflight({
                minimumInputTokens: minimumRepairInputTokens,
                ...(minimumRepairCost ? { minimumCostUsd: minimumRepairCost.totalUsd } : {}),
              });
              if (
                repairBudgetExhausted
                && (repairBudgetExhausted.budget === "total_tokens"
                  || repairBudgetExhausted.budget === "cost_usd")
              ) {
                const boundedRepairInputTokens = Math.floor(Math.max(
                  0,
                  runBudget.maxTotalTokens
                    - runBudget.totalTokens
                    - finalizationOutputTokens,
                ) / REACT_FINALIZATION_INPUT_SAFETY_FACTOR);
                const boundedRepair = buildBoundedStructuredOutputRepairRequest({
                  repairPrompt: review.prompt,
                  originalText: contentForDisplay,
                  maxInputTokens: boundedRepairInputTokens,
                  tokenEstimateContext: repairTokenEstimateContext,
                });
                const boundedRepairMinimumCost = boundedRepair
                  ? calculateUsageCostUsd({
                    inputTokens: boundedRepair.estimatedInputTokens,
                    outputTokens: finalizationOutputTokens,
                    pricing: this.opts.usagePricing,
                  })
                  : undefined;
                const boundedRepairPreflight = boundedRepair
                  ? runBudget.checkModelCallPreflight({
                    minimumInputTokens: boundedRepair.estimatedInputTokens,
                    minimumOutputTokens: finalizationOutputTokens,
                    ...(boundedRepairMinimumCost
                      ? { minimumCostUsd: boundedRepairMinimumCost.totalUsd }
                      : {}),
                  })
                  : repairBudgetExhausted;
                if (boundedRepair && !boundedRepairPreflight) {
                  pendingBoundedStructuredOutputRepairRequest = boundedRepair;
                  logWarn("[structured-output] switching to one bounded repair call", {
                    fullRepairInputTokens: minimumRepairInputTokens,
                    boundedRepairInputTokens: boundedRepair.estimatedInputTokens,
                    boundedRepairOutputTokens: finalizationOutputTokens,
                    draftTruncated: boundedRepair.draftTruncated,
                    conversationId: input.conversationId,
                    agentId: resolvedAgentId,
                  });
                  continue;
                }
              }
              if (repairBudgetExhausted) {
                const budgetLabel = repairBudgetExhausted.budget === "cost_usd" ? "cost" : "token";
                const rejection = structuredOutputSession.rejectRepair(
                  `Structured output repair was not started because its minimum prompt exceeds the remaining ${budgetLabel} budget.`,
                );
                yield* emitStructuredOutputFailure(rejection, {
                  type: "budget_exhausted",
                  budget: repairBudgetExhausted.budget,
                  limit: repairBudgetExhausted.limit,
                  observed: repairBudgetExhausted.observed,
                  ...(repairBudgetExhausted.policyId ? {
                    policyId: repairBudgetExhausted.policyId,
                    stage: repairBudgetExhausted.stage,
                    reasonCode: repairBudgetExhausted.reasonCode,
                  } : {}),
                });
                return;
              }
              messages.push(repairAssistantMessage, repairPromptMessage);
              continue;
            }
            if (review.action === "reject") {
              yield* emitStructuredOutputFailure(review);
              return;
            }
            for (const delta of splitText(review.outputText, 16)) {
              yield* yieldItem({ type: "delta", delta });
            }
            yield* yieldItem(buildUsageItem());
            yield* yieldItem({ type: "final", text: review.outputText });
            yield* yieldItem({ type: "status", status: "done" });
            return;
          }
          if (!finalizationOnlyCall && input.steering && !input.steering.sealIfIdle()) {
            messages.push({
              role: "assistant",
              content: response.content || contentForDisplay,
            });
            continue;
          }
          // 无工具调用，输出最终结果（已剥离协议块）
          logDebug("[tool-check] no tool calls; returning text result");
          yield* yieldItem(buildUsageItem());
          yield* yieldItem({ type: "final", text: contentForDisplay });
          yield* yieldItem({ type: "status", status: "done" });
          return;
        }
        if (workspaceMutationVerificationCall) {
          const requiredToolCalls = selectRequiredWorkspaceMutationVerificationToolCalls(
            toolCalls,
            workspaceMutationVerificationRequest?.requiredVerificationPaths ?? [],
            toolNames,
            workspaceMutationVerificationRequest?.maxFileReadCalls ?? 0,
          );
          if (!requiredToolCalls) {
            yield* emitWorkspaceMutationFailure(
              "the bounded read-after-write model call must request one valid bounded full-file file_read for every required path, with no omissions, duplicates, or extra calls.",
            );
            return;
          }
          toolCalls = requiredToolCalls;
        }
        if (workspaceMutationRecoveryCall || workspaceMutationObjectiveReviewCall) {
          if (workspaceMutationContinuationCall && toolCalls.length > 1) {
            const splitToolCallCount = toolCalls.length;
            const coalescedToolCall = coalesceWorkspaceMutationApplyPatchToolCalls(
              toolCalls,
              workspaceMutationCallRequiredPaths,
            );
            if (coalescedToolCall) {
              logWarn("[workspace-mutation] coalescing split missing-path apply_patch calls", {
                splitToolCallCount,
                requiredPathCount: workspaceMutationCallRequiredPaths.length,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
              toolCalls = [coalescedToolCall];
            }
          }
          const requestedMutationTool = toolCalls.length === 1
            && toolNames.includes(toolCalls[0]?.function.name ?? "");
          if (!requestedMutationTool) {
            yield* emitWorkspaceMutationFailure(
              workspaceMutationObjectiveReviewCall
                ? "the post-write objective review may request at most one allowed workspace mutation tool."
                : "the mutation-only model call must request exactly one allowed workspace mutation tool.",
            );
            return;
          }
          if (workspaceMutationObjectiveReviewCall && workspaceMutationObjectiveCorrectionAttempted) {
            yield* emitWorkspaceMutationFailure(
              "the post-write objective review requested another correction after its one allowed correction was already attempted.",
            );
            return;
          }
          const normalizedMutationToolCall = normalizeWorkspaceMutationRecoveryToolCall(toolCalls[0]!);
          const missingPathMutationToolCall = workspaceMutationContinuationCall
            ? retainMissingWorkspaceMutationPatchSections(
                normalizedMutationToolCall,
                workspaceMutationCallRequiredPaths,
                requiredChangedPaths,
              )
            : undefined;
          const constrainedMutationToolCall = missingPathMutationToolCall ?? normalizedMutationToolCall;
          if (missingPathMutationToolCall) {
            logWarn("[workspace-mutation] dropping already-covered continuation patch sections", {
              missingRequiredPathCount: workspaceMutationCallRequiredPaths.length,
              conversationId: input.conversationId,
              agentId: resolvedAgentId,
            });
          }
          const patchDiagnostics = inspectWorkspaceMutationPatchHunks(constrainedMutationToolCall);
          const patchPreservationDiagnostics = patchDiagnostics?.contextOnlyHunkCount
            ? inspectContextOnlyWorkspaceMutationPatchPreservation(constrainedMutationToolCall)
            : undefined;
          const actionableMutationToolCall = patchPreservationDiagnostics?.canPreserve === false
            && (patchPreservationDiagnostics.rejectionReason === "non_actionable_update_section"
              || patchPreservationDiagnostics.rejectionReason === "duplicate_update_path")
            && !workspaceMutationContinuationCall
            ? retainActionableWorkspaceMutationPatchSections(
              constrainedMutationToolCall,
              workspaceMutationCallRequiredPaths,
            )
            : undefined;
          if (patchDiagnostics && patchDiagnostics.unexpectedEndMarkerCount > 0) {
            yield* emitWorkspaceMutationFailure(
              `the mutation-only apply_patch call contained an unexpected End Patch marker before the final marker. ${formatWorkspaceMutationUnexpectedEndMarkerDiagnostics(patchDiagnostics)}`,
            );
            return;
          }
          if (workspaceMutationObjectiveReviewCall
            && !hasOnlyWorkspaceMutationPatchPaths(
              constrainedMutationToolCall,
              workspaceMutationCallRequiredPaths,
            )) {
            yield* emitWorkspaceMutationFailure(
              "the post-write objective correction patch targeted an unlisted path or did not contain a valid required-path file section.",
            );
            return;
          }
          if (patchDiagnostics
            && patchDiagnostics.contextOnlyHunkCount > 0
            && patchPreservationDiagnostics?.canPreserve === false
            && !actionableMutationToolCall) {
            yield* emitWorkspaceMutationFailure(
              `the mutation-only apply_patch call contained a context-only hunk that could not be preserved safely; use unique safe Update File sections, valid hunk structure, and at least one real added or removed line per file. ${formatWorkspaceMutationPatchHunkDiagnostics(patchDiagnostics, patchPreservationDiagnostics)}`,
            );
            return;
          }
          toolCalls = [actionableMutationToolCall ?? constrainedMutationToolCall];
          if (workspaceMutationObjectiveReviewCall) {
            workspaceMutationObjectiveCorrectionAttempted = true;
          }
        }
        if (workspaceMutationNavigationCall) {
          const maxFileReadCalls = workspaceMutationNavigationRequest?.maxFileReadCalls ?? 2;
          const missingRequiredSourceEvidencePaths = workspaceMutationNavigationRequest
            ?.missingRequiredSourceEvidencePaths ?? [];
          if (missingRequiredSourceEvidencePaths.length > 0) {
            const requiredToolCalls = selectRequiredWorkspaceMutationNavigationToolCalls(
              toolCalls,
              missingRequiredSourceEvidencePaths,
              toolNames,
              maxFileReadCalls,
            );
            if (!requiredToolCalls) {
              yield* emitWorkspaceMutationFailure(
                "the bounded source-navigation model call did not request each missing required source path exactly once.",
              );
              return;
            }
            if (requiredToolCalls.length !== toolCalls.length) {
              logWarn("[workspace-mutation] dropped non-required source-navigation tool calls", {
                requestedToolCallCount: toolCalls.length,
                retainedToolCallCount: requiredToolCalls.length,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
            }
            toolCalls = requiredToolCalls;
          }
          const requestedNavigationTool = areWorkspaceMutationNavigationToolCallsAllowed(
            toolCalls.map((toolCall) => toolCall.function.name),
            toolNames,
            maxFileReadCalls,
          );
          if (!requestedNavigationTool) {
            const fileReadLimit = maxFileReadCalls === 2 ? "two" : String(maxFileReadCalls);
            yield* emitWorkspaceMutationFailure(
              `the bounded source-navigation model call must request one allowed source-read tool or at most ${fileReadLimit} file_read calls.`,
            );
            return;
          }
        }
        logDebug("[tool-check] tool calls detected", { names: toolCalls.map(tc => tc.function.name) });

        // 防止无限循环
        toolCallCount += toolCalls.length;
        if (toolCallCount > this.opts.maxToolCalls) {
          yield* emitBudgetExhausted(
            "tool_calls",
            this.opts.maxToolCalls,
            toolCallCount,
            `工具调用次数超限（最大 ${this.opts.maxToolCalls} 次）`,
          );
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
        const workspaceMutationFreshToolExecutionRequired = workspaceMutationRecoveryCall
          || workspaceMutationVerificationCall;
        for (const tc of toolCalls) {
          if (isRunStopRequested(input.abortSignal)) {
            yield* emitRunAbort();
            return;
          }
          const parsedArguments = parseToolCallArguments(tc.function.arguments, this.opts.toolCallRepairLevel);
          const request: ToolCallRequest = {
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArguments.arguments,
          };
          const requestFingerprint = buildToolCallFingerprint(request.name, parsedArguments.fingerprintArguments);
          const currentToolTrace: ToolCallExecutionTrace = {
            fingerprint: requestFingerprint,
            toolName: request.name,
            args: cloneJsonObject(request.arguments) ?? {},
          };

          const toolStartTime = Date.now();

          // 工具钩子上下文
          const toolHookCtx: HookToolContext = {
            agentId: resolvedAgentId,
            sessionKey: input.conversationId,
            toolName: request.name,
          };

          // Hook: beforeToolCall / before_tool_call
          if (runHookRunner) {
            try {
              const hookRes = await this.withStageTimeout(
                "before_tool_call",
                runHookRunner.runBeforeToolCall(
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
                  hookRunner: runHookRunner,
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
                if (workspaceMutationFreshToolExecutionRequired) {
                  yield* emitWorkspaceMutationFailure(blockedError);
                  return;
                }
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
                  hookRunner: runHookRunner,
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
                if (workspaceMutationFreshToolExecutionRequired) {
                  yield* emitWorkspaceMutationFailure(
                    workspaceMutationVerificationCall
                      ? `tool ${request.name} was skipped by a hook instead of reading the post-mutation workspace.`
                      : `tool ${request.name} was skipped by a hook instead of mutating the workspace.`,
                  );
                  return;
                }
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
                hookRunner: runHookRunner,
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
              if (workspaceMutationFreshToolExecutionRequired) {
                yield* emitWorkspaceMutationFailure(hookError);
                return;
              }
              continue;
            }
          } else if (runLegacyHooks?.beforeToolCall) {
            // 向后兼容：旧版 hooks
            try {
              const hookRes = await this.withStageTimeout(
                "beforeToolCall",
                Promise.resolve(runLegacyHooks.beforeToolCall({
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
                  hookRunner: runHookRunner,
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
                if (workspaceMutationFreshToolExecutionRequired) {
                  yield* emitWorkspaceMutationFailure(blockedError);
                  return;
                }
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
                hookRunner: runHookRunner,
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
              if (workspaceMutationFreshToolExecutionRequired) {
                yield* emitWorkspaceMutationFailure(hookError);
                return;
              }
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
                hookRunner: runHookRunner,
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
              if (workspaceMutationFreshToolExecutionRequired) {
                yield* emitWorkspaceMutationFailure(
                  workspaceMutationVerificationCall
                    ? `tool ${request.name} reused a prior result instead of reading the post-mutation workspace.`
                    : `tool ${request.name} reused a prior result instead of mutating the workspace.`,
                );
                return;
              }
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
              hookRunner: runHookRunner,
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
            if (workspaceMutationFreshToolExecutionRequired) {
              yield* emitWorkspaceMutationFailure(duplicateError);
              return;
            }
            continue;
          }

          if (this.opts.toolCallRepairLevel === "full") {
            const previousTrace = recentToolCallTraces.at(-1);
            if (isNearDuplicateToolCall(previousTrace, currentToolTrace)) {
              const nearDuplicateError = `工具调用已被拦截：检测到近重复调用（${request.name}）。请先根据上一轮结果调整参数或改换策略，不要做几乎相同的重试。`;
              const nearDuplicateResult = buildToolCallSuppressedResult({
                toolCallId: request.id,
                toolName: request.name,
                error: nearDuplicateError,
                metadata: {
                  repairAction: "near_duplicate_tool_call_suppressed",
                  previousToolName: previousTrace?.toolName,
                },
              });
              yield* yieldItem({
                type: "tool_call",
                id: request.id,
                name: request.name,
                arguments: request.arguments,
              });
              yield* yieldItem({
                type: "tool_result",
                ...nearDuplicateResult,
              });
              messages.push(buildToolTranscriptMessageForHistory({
                toolCallId: tc.id,
                toolName: request.name,
                output: "",
                error: nearDuplicateError,
                success: false,
                hookRunner: runHookRunner,
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
                error: nearDuplicateError,
                failureKind: "business_logic_error",
                toolCallId: tc.id,
                isSynthetic: true,
              });
              pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
                result: nearDuplicateResult,
                requestArguments: request.arguments,
              }));
              logWarn("[tool-call-repair] suppressed near-duplicate tool call", {
                toolName: request.name,
                toolCallId: request.id,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
              if (workspaceMutationFreshToolExecutionRequired) {
                yield* emitWorkspaceMutationFailure(nearDuplicateError);
                return;
              }
              continue;
            }

            const thrashLoop = detectCrossToolThrash(recentToolCallTraces, currentToolTrace);
            if (thrashLoop) {
              const thrashError = `工具调用已被拦截：检测到跨工具抖动（${request.name} <-> ${thrashLoop.partnerToolName ?? "unknown"}）。请先总结上一轮失败原因，再决定是回到 \`tool_search\` 重新识别，还是明确修改参数后再试。`;
              const thrashResult = buildToolCallSuppressedResult({
                toolCallId: request.id,
                toolName: request.name,
                error: thrashError,
                metadata: {
                  repairAction: "cross_tool_thrash_suppressed",
                  partnerToolName: thrashLoop.partnerToolName,
                  loopSize: thrashLoop.loopSize,
                },
              });
              yield* yieldItem({
                type: "tool_call",
                id: request.id,
                name: request.name,
                arguments: request.arguments,
              });
              yield* yieldItem({
                type: "tool_result",
                ...thrashResult,
              });
              messages.push(buildToolTranscriptMessageForHistory({
                toolCallId: tc.id,
                toolName: request.name,
                output: "",
                error: thrashError,
                success: false,
                hookRunner: runHookRunner,
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
                error: thrashError,
                failureKind: "business_logic_error",
                toolCallId: tc.id,
                isSynthetic: true,
              });
              pendingToolFollowupDeltas.push(...buildToolResultPromptDeltas({
                result: thrashResult,
                requestArguments: request.arguments,
              }));
              logWarn("[tool-call-repair] suppressed cross-tool thrashing", {
                toolName: request.name,
                toolCallId: request.id,
                partnerToolName: thrashLoop.partnerToolName,
                conversationId: input.conversationId,
                agentId: resolvedAgentId,
              });
              if (workspaceMutationFreshToolExecutionRequired) {
                yield* emitWorkspaceMutationFailure(thrashError);
                return;
              }
              continue;
            }
          }

          if (isRunStopRequested(input.abortSignal)) {
            yield* emitRunAbort();
            return;
          }

          const navigationToolBudgetExhausted = runBudget.reserveToolCall(request.name);
          if (navigationToolBudgetExhausted) {
            const toolLabel = request.name === "file_read" ? "文件读取" : "文本搜索";
            yield* emitBudgetExhausted(
              navigationToolBudgetExhausted.budget,
              navigationToolBudgetExhausted.limit,
              navigationToolBudgetExhausted.observed,
              `${toolLabel}成本止损已触发（最多 ${navigationToolBudgetExhausted.limit} 次）。已在执行 ${request.name} 前停止；任务结果尚未评估。`,
              {
                policyId: navigationToolBudgetExhausted.policyId,
                stage: navigationToolBudgetExhausted.stage,
                reasonCode: navigationToolBudgetExhausted.reasonCode,
              },
            );
            return;
          }

          // 仅在真实 execute 前预留配额，Hook 阻断、结果复用和 repair 合成结果都不计入。
          const toolRiskLevel = this.opts.toolExecutor.getRegisteredToolContract(request.name)?.riskLevel;
          if (toolRiskLevel === "high" || toolRiskLevel === "critical") {
            const highRiskBudgetExhausted = runBudget.reserveHighRiskToolCall();
            if (highRiskBudgetExhausted) {
              yield* emitBudgetExhausted(
                highRiskBudgetExhausted.budget,
                highRiskBudgetExhausted.limit,
                highRiskBudgetExhausted.observed,
                `高风险工具调用次数超限（最大 ${highRiskBudgetExhausted.limit} 次）。已在执行前阻断 ${request.name}；请拆分任务，或仅为受控 Profile 提高预算后继续。`,
              );
              return;
            }
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

          // 非协作 Tool 可能在 deadline 已过后才返回；此时丢弃迟到结果，避免覆盖预算终态。
          // 用户主动 stop 仍保留既有的“已完成结果后在安全点停止”语义。
          if (activeRunAbortController.isWallTimeExceeded()) {
            yield* emitRunAbort();
            return;
          }
          const toolDurationMs = Date.now() - toolStartTime;

          // Hook: afterToolCall / after_tool_call
          if (runHookRunner) {
            try {
              await this.withStageTimeout(
                "after_tool_call",
                runHookRunner.runAfterToolCall(
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
          } else if (runLegacyHooks?.afterToolCall) {
            // 向后兼容：旧版 hooks
            try {
              await this.withStageTimeout(
                "afterToolCall",
                Promise.resolve(runLegacyHooks.afterToolCall({
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

          if (activeRunAbortController.isWallTimeExceeded()) {
            yield* emitRunAbort();
            return;
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
            hookRunner: runHookRunner,
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
                metadata: result.metadata,
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
          recentToolCallTraces.push({
            fingerprint: requestFingerprint,
            toolName: request.name,
            args: cloneJsonObject(request.arguments) ?? {},
            success: result.success,
            failureKind: result.failureKind,
          });
          if (recentToolCallTraces.length > 6) {
            recentToolCallTraces.shift();
          }
          const resultContract = this.opts.toolExecutor.getRegisteredToolContract?.(request.name);
          const successfulWorkspaceMutation = result.success
            && resultContract?.isReadOnly === false
            && (resultContract.family === "workspace-write" || resultContract.family === "patch");
          const mutationCallStayedWithinRequiredPaths = !workspaceMutationRecoveryCall
            && !workspaceMutationObjectiveReviewCall
            || hasOnlyWorkspaceMutationChangedPaths(
              result.metadata,
              workspaceMutationCallRequiredPaths,
            );
          if (workspaceMutationContinuationCall
            && successfulWorkspaceMutation
            && !mutationCallStayedWithinRequiredPaths) {
            yield* emitWorkspaceMutationFailure(
              "the bounded missing-path mutation continuation changed an already-covered or unlisted path.",
            );
            return;
          }
          if (workspaceMutationObjectiveReviewCall
            && successfulWorkspaceMutation
            && !mutationCallStayedWithinRequiredPaths) {
            yield* emitWorkspaceMutationFailure(
              "the post-write objective correction changed an unlisted path.",
            );
            return;
          }
          if (successfulWorkspaceMutation) {
            workspaceMutationObserved = workspaceMutationObserved
              || workspaceMutationPathCoverage.observeSuccessfulMutation(result.metadata);
            if (workspaceMutationObjectiveReviewCall
              && workspaceMutationVerificationEligible
              && workspaceMutationVerificationAttempts < 2) {
              workspaceMutationVerificationPending = true;
              lastToolCallFingerprint = undefined;
              lastToolCallName = undefined;
              consecutiveDuplicateToolCalls = 0;
              recentToolCallTraces.length = 0;
              lastSuccessfulToolResult = undefined;
            } else if (workspaceMutationObserved
              && workspaceMutationVerificationEligible
              && workspaceMutationVerificationAttempts === 0) {
              workspaceMutationVerificationPending = true;
              lastToolCallFingerprint = undefined;
              lastToolCallName = undefined;
              consecutiveDuplicateToolCalls = 0;
              recentToolCallTraces.length = 0;
              lastSuccessfulToolResult = undefined;
            } else if (workspaceMutationObserved && workspaceMutationVerificationAttempts > 0) {
              workspaceMutationFinalizationPending = true;
            }
          }
          if (workspaceMutationObjectiveReviewCall && !successfulWorkspaceMutation) {
            yield* emitWorkspaceMutationFailure(
              result.success
                ? `tool ${request.name} did not satisfy the trusted post-write correction contract.`
                : `post-write correction tool ${request.name} failed: ${result.error || "unknown tool failure"}`,
            );
            return;
          }
          if (workspaceMutationRecoveryCall) {
            if (!successfulWorkspaceMutation) {
              const missingPaths = workspaceMutationPathCoverage.missingPaths();
              const canCorrectRecoveryInputFailure = !workspaceMutationContinuationCall
                && !workspaceMutationContinuationAttempted;
              const canCorrectContinuationInputFailure = workspaceMutationContinuationCall
                && workspaceMutationContinuationAttempted
                && missingPaths.length < requiredChangedPaths.length;
              const canCorrectAtomicInputFailure = !workspaceMutationInputCorrectionCall
                && !workspaceMutationInputCorrectionAttempted
                && request.name === "apply_patch"
                && result.failureKind === "input_error"
                && result.metadata?.repairAction === "apply_patch_input_invalid"
                && !workspaceMutationObserved
                && workspaceMutationCallRequiredPaths.length > 0
                && missingPaths.length === workspaceMutationCallRequiredPaths.length
                && (canCorrectRecoveryInputFailure || canCorrectContinuationInputFailure);
              if (canCorrectAtomicInputFailure) {
                workspaceMutationContinuationPending = true;
                workspaceMutationInputCorrectionPending = true;
                logWarn("[workspace-mutation] bounded apply_patch failed atomically; scheduling one input correction", {
                  missingRequiredPathCount: missingPaths.length,
                  conversationId: input.conversationId,
                  agentId: resolvedAgentId,
                });
                continue;
              }
              yield* emitWorkspaceMutationFailure(
                result.success
                  ? `tool ${request.name} did not satisfy the trusted workspace mutation contract.`
                  : `tool ${request.name} failed: ${result.error || "unknown tool failure"}`,
              );
              return;
            }
            if (!workspaceMutationObserved) {
              const missingPaths = workspaceMutationPathCoverage.missingPaths();
              const madeTrustedPartialProgress = !workspaceMutationContinuationCall
                && !workspaceMutationContinuationAttempted
                && mutationCallStayedWithinRequiredPaths
                && missingPaths.length > 0
                && missingPaths.length < workspaceMutationCallRequiredPaths.length;
              if (madeTrustedPartialProgress) {
                workspaceMutationContinuationPending = true;
                logWarn("[workspace-mutation] bounded mutation-only call left trusted required paths missing", {
                  missingRequiredPathCount: missingPaths.length,
                  conversationId: input.conversationId,
                  agentId: resolvedAgentId,
                });
              } else {
                yield* emitWorkspaceMutationFailure(
                  `${workspaceMutationContinuationCall
                    ? "the bounded missing-path mutation continuation"
                    : "the one mutation-only model call"} did not cover every required changed path; still missing ${JSON.stringify(missingPaths)}.`,
                );
                return;
              }
            }
            if (workspaceMutationObserved && !workspaceMutationVerificationPending) {
              workspaceMutationFinalizationPending = true;
            }
          }
          if (workspaceMutationNavigationCall && !result.success) {
            yield* emitWorkspaceMutationFailure(
              `the bounded source-navigation tool failed: ${result.error || "unknown tool failure"}`,
            );
            return;
          }
          if (workspaceMutationVerificationCall && !result.success) {
            yield* emitWorkspaceMutationFailure(
              `the bounded read-after-write tool failed: ${result.error || "unknown tool failure"}`,
            );
            return;
          }
          if (workspaceMutationVerificationCall && result.success) {
            const completeRead = isCompleteWorkspaceMutationVerificationReadResult({
              arguments: request.arguments,
              output: result.output,
            });
            if (!completeRead) {
              yield* emitWorkspaceMutationFailure(
                "the bounded read-after-write tool did not return the complete post-mutation file for the requested path.",
              );
              return;
            }
            workspaceMutationVerificationCompletedReadCount++;
            if (workspaceMutationVerificationCompletedReadCount
              === workspaceMutationVerificationRequest?.requiredVerificationPaths.length) {
              workspaceMutationObjectiveReviewPending = true;
            }
          }
          if (isRunStopRequested(input.abortSignal)) {
            yield* emitRunAbort();
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
      if (runHookRunner) {
        try {
          const agentEndSnapshot = generatedItems.snapshot();
          await this.withStageTimeout(
            "agent_end",
            runHookRunner.runAgentEnd(
              {
                messages: agentEndSnapshot.items,
                success: runSuccess,
                error: runError,
                durationMs,
                summary: agentEndSnapshot.summary,
              },
              agentHookCtx,
            ),
          );
        } catch (err) {
          logError(`钩子 agent_end 执行失败: ${err}`);
        }
      } else if (runLegacyHooks?.afterRun) {
        // 向后兼容：旧版 hooks
        try {
          const agentEndSnapshot = generatedItems.snapshot();
          await this.withStageTimeout(
            "afterRun",
            Promise.resolve(runLegacyHooks.afterRun({ input, items: agentEndSnapshot.items }, legacyHookCtx)),
          );
        } catch (err) {
          logError(`Hook afterRun failed: ${err}`);
        }
      }

      // 清理 token 计数器（在 agent_end hook 之后执行）
      // 扩展 A：清理前先保存活跃计数器快照（跨 run 持久化）
      if (this.opts.conversationStore && convId) {
        await this.opts.conversationStore.waitForPendingPersistence(convId);
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
      runAbortController?.dispose();
      releaseConversationRunSlot();
    }
  }

  private async callModel(
    messages: Message[],
    tools?: { type: "function"; function: { name: string; description: string; parameters: object } }[],
    textAttachmentChars?: number,
    runtimeScope?: { conversationId?: string; agentId?: string; modelCallIndex?: number },
    abortSignal?: AbortSignal,
    onBeforeRequest?: (messages: Message[], trimDiagnostics?: PromptTrimDiagnostics) => void,
    providerNativeSystemBlocks?: ProviderNativeSystemBlock[],
    streamDelivery?: ModelStreamTextDelivery,
    maxOutputTokensOverride?: number,
    toolChoiceOverride?: "auto" | "required",
    disableDeepSeekThinkingOverride = false,
  ): Promise<{
    ok: true;
    content: string;
    toolCalls?: OpenAIToolCall[];
    reasoning_content?: string;
    usage?: AnthropicUsage;
    rawUsage?: AgentUsage["providerRawUsage"];
  } | {
    ok: false;
    error: string;
    interrupted?: AgentInterrupted;
    emptyContent?: {
      finishReason: string;
      reasoningContentLength: number;
    };

    reasoning_content?: string;
    usage?: AnthropicUsage;
    rawUsage?: AgentUsage["providerRawUsage"];
  }> {
    let effectiveTimeoutMs = this.opts.timeoutMs;
    const maxOutputTokens = maxOutputTokensOverride ?? this.opts.maxOutputTokens ?? 4096;
    const callStartedAt = Date.now();
    let currentPhase = "preflight";
    let failoverSummary: FailoverExecutionSummary | undefined;
    let currentTokenEstimateModel = this.opts.model;
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
      let trimDiagnostics: PromptTrimDiagnostics | undefined;
      if (maxInput && maxInput > 0) {
        trimDiagnostics = await trimMessagesToFit(
          messages,
          tools,
          maxInput,
          currentTokenEstimateModel ? { model: currentTokenEstimateModel } : undefined,
          this.opts.budgetProtect,
          {
            pipeline: this.compressionPipeline,
            conversationId: runtimeScope?.conversationId,
            agentId: runtimeScope?.agentId,
          },
        );
      }
      onBeforeRequest?.(messages, trimDiagnostics);

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
      const recordFailoverSummary = (summary: FailoverExecutionSummary) => {
        failoverSummary = summary;
        this.opts.onRuntimeResilienceEvent?.({
          source: "tool_agent",
          phase: "tool_loop",
          agentId: runtimeScope?.agentId,
          conversationId: runtimeScope?.conversationId,
          summary,
        });
      };
      const buildRequest = (profile: ModelProfile) => {
        // 优先使用 profile 自身的 protocol（models.json 配置），再 fallback 到 agent 级别协议
        const profileProtocol = (profile.protocol as ApiProtocol) ?? this.opts.protocol ?? detectProtocol(profile.baseUrl);
        const profileWireApi = resolveWireApiForProfile(profile, this.opts.wireApi);
        currentTokenEstimateModel = profile.model;
        usedProtocol = profileProtocol;
        usedWireApi = profileWireApi;

        if (profileProtocol === "anthropic") {
          return buildAnthropicRequest({
            profile,
            messages: messages as any,
            tools: tools as any,
            maxTokens: maxOutputTokens,
            stream: streamDelivery !== undefined,
            enableCaching: true,
            providerNativeSystemBlocks,
            toolChoice: toolChoiceOverride,
          });
        }

        if (profileWireApi === "responses") {
          const payload: Record<string, unknown> = {
            model: profile.model,
            input: buildResponsesInputFromMessages(messages),
            max_output_tokens: maxOutputTokens,
            stream: streamDelivery !== undefined,
          };
          applyOpenAICompatibleReasoningConfig(payload, profile);
          if (disableDeepSeekThinkingOverride) {
            disableDeepSeekThinking({ payload, profile });
          }
          if (tools && tools.length > 0) {
            const responseTools = this.opts.sanitizeResponsesToolSchema
              ? sanitizeResponsesToolDefinitions(tools)
              : tools;
            payload.tools = responseTools.map(t => ({
              type: "function",
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            }));
            applyOpenAICompatibleToolChoice({
              payload,
              profile,
              toolChoice: toolChoiceOverride ?? "auto",
            });
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
          max_tokens: maxOutputTokens,
          stream: streamDelivery !== undefined,
        };
        applyOpenAICompatibleReasoningConfig(payload, profile);
        if (disableDeepSeekThinkingOverride) {
          disableDeepSeekThinking({ payload, profile });
        }
        if (tools && tools.length > 0) {
          payload.tools = tools;
          applyOpenAICompatibleToolChoice({
            payload,
            profile,
            toolChoice: toolChoiceOverride ?? "auto",
          });
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
      };

      let res: Response;
      let streamedResponse: Awaited<ReturnType<typeof consumeModelResponseStreamWithFailover>>["response"] | undefined;
      if (streamDelivery) {
        const result = await consumeModelResponseStreamWithFailover({
          failoverClient: this.failoverClient,
          buildRequest,
          resolveProtocol: (profile) => ({
            protocol: (profile.protocol as ApiProtocol) ?? this.opts.protocol ?? detectProtocol(profile.baseUrl),
            wireApi: resolveWireApiForProfile(profile, this.opts.wireApi),
          }),
          onAttemptStart: () => streamDelivery.beginAttempt(),
          onTextDelta: async (delta, control) => {
            if (await streamDelivery.push(delta)) control.commit();
          },
          signal: abortSignal,
          timeoutMs: requestTimeoutMs,
          minimumTimeoutMs: minimumAdaptiveTimeoutMs,
          maxRetries: this.opts.maxRetries,
          retryBackoffMs: this.opts.retryBackoffMs,
          onSummary: recordFailoverSummary,
        });
        res = result.transportResponse;
        streamedResponse = result.response;
      } else {
        const result = await this.failoverClient.fetchWithFailover({
          buildRequest,
          signal: abortSignal,
          timeoutMs: requestTimeoutMs,
          minimumTimeoutMs: minimumAdaptiveTimeoutMs,
          maxRetries: this.opts.maxRetries,
          retryBackoffMs: this.opts.retryBackoffMs,
          onSummary: recordFailoverSummary,
        });
        res = result.response;
      }
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

      if (streamedResponse) {
        currentPhase = "extract_stream_response";
        const toolCalls: OpenAIToolCall[] | undefined = streamedResponse.toolCalls.length > 0
          ? streamedResponse.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function" as const,
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          }))
          : undefined;
        const streamUsage = streamedResponse.usage;
        const usage: AnthropicUsage | undefined = streamUsage ? {
          input_tokens: streamUsage.inputTokens ?? 0,
          output_tokens: streamUsage.outputTokens ?? 0,
          cache_creation_input_tokens: streamUsage.cacheCreationInputTokens ?? 0,
          cache_read_input_tokens: streamUsage.cacheReadInputTokens ?? 0,
          prompt_cache_hit_tokens: streamUsage.promptCacheHitTokens ?? 0,
          prompt_cache_miss_tokens: streamUsage.promptCacheMissTokens ?? 0,
        } : undefined;
        const providerRawUsage: AgentUsage["providerRawUsage"] | undefined = streamUsage ? {
          inputTokens: streamUsage.inputTokens,
          outputTokens: streamUsage.outputTokens,
          totalTokens: streamUsage.totalTokens,
          cacheCreationInputTokens: streamUsage.cacheCreationInputTokens,
          cacheReadInputTokens: streamUsage.cacheReadInputTokens,
          promptCacheHitTokens: streamUsage.promptCacheHitTokens,
          promptCacheMissTokens: streamUsage.promptCacheMissTokens,
        } : undefined;
        if (
          !streamedResponse.content.trim()
          && (!toolCalls || toolCalls.length === 0)
          && streamedResponse.reasoningContent?.trim()
        ) {
          const reasoningContent = streamedResponse.reasoningContent.trim();
          return {
            ok: false,
            error: `模型返回空内容。finish_reason=${streamedResponse.finishReason || "unknown"}，reasoning_content=present(${reasoningContent.length})。`,
            emptyContent: {
              finishReason: streamedResponse.finishReason || "unknown",
              reasoningContentLength: reasoningContent.length,
            },
            reasoning_content: reasoningContent,
            usage,
            rawUsage: providerRawUsage,
          };
        }
        logModelPhase("[model-call] response_extracted", {
          parser: `${usedProtocol}:${usedWireApi}:stream`,
          contentLength: streamedResponse.content.length,
          toolCallCount: toolCalls?.length ?? 0,
          reasoningContentLength: streamedResponse.reasoningContent?.length ?? 0,
          usageInputTokens: usage?.input_tokens ?? 0,
          usageOutputTokens: usage?.output_tokens ?? 0,
        });
        return {
          ok: true,
          content: streamedResponse.content,
          toolCalls,
          reasoning_content: streamedResponse.reasoningContent,
          usage,
          rawUsage: providerRawUsage,
        };
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
        return {
          ok: true,
          content: parsed.content,
          toolCalls,
          usage: parsed.usage,
          rawUsage: parsed.usage ? {
            inputTokens: parsed.usage.input_tokens,
            outputTokens: parsed.usage.output_tokens,
            cacheCreationInputTokens: parsed.usage.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens: parsed.usage.cache_read_input_tokens ?? 0,
            promptCacheHitTokens: parsed.usage.prompt_cache_hit_tokens ?? 0,
            promptCacheMissTokens: parsed.usage.prompt_cache_miss_tokens ?? 0,
          } : undefined,
        };
      }

      // OpenAI 响应解析
      currentPhase = "parse_openai_json";
      const json = (await res.json()) as JsonObject;
      logModelPhase("[model-call] json_parse_done", {
        parser: usedWireApi === "responses" ? "responses" : "chat_completions",
      });
      if (usedWireApi === "responses") {
        currentPhase = "extract_responses_payload";
        const content = filterProviderControlFrameSuffix(extractResponsesText(json));
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
          rawUsage: rawUsage ? {
            promptTokens: typeof rawUsage.prompt_tokens === "number" ? rawUsage.prompt_tokens : undefined,
            completionTokens: typeof rawUsage.completion_tokens === "number" ? rawUsage.completion_tokens : undefined,
            totalTokens: typeof rawUsage.total_tokens === "number" ? rawUsage.total_tokens : undefined,
            inputTokens: typeof rawUsage.input_tokens === "number" ? rawUsage.input_tokens : undefined,
            outputTokens: typeof rawUsage.output_tokens === "number" ? rawUsage.output_tokens : undefined,
            cacheCreationInputTokens: typeof rawUsage.cache_creation_input_tokens === "number"
              ? rawUsage.cache_creation_input_tokens
              : undefined,
            cacheReadInputTokens: typeof rawUsage.cache_read_input_tokens === "number"
              ? rawUsage.cache_read_input_tokens
              : undefined,
            promptCacheHitTokens: typeof rawUsage.prompt_cache_hit_tokens === "number"
              ? rawUsage.prompt_cache_hit_tokens
              : undefined,
            promptCacheMissTokens: typeof rawUsage.prompt_cache_miss_tokens === "number"
              ? rawUsage.prompt_cache_miss_tokens
              : undefined,
          } : undefined,
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
      const content = typeof message?.content === "string"
        ? filterProviderControlFrameSuffix(message.content)
        : "";
      const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls as OpenAIToolCall[] : undefined;
      const reasoning_content = typeof message?.reasoning_content === "string" ? message.reasoning_content : undefined;
      const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "";

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
      const providerRawUsage: AgentUsage["providerRawUsage"] | undefined = rawUsage ? {
        promptTokens: typeof rawUsage.prompt_tokens === "number" ? rawUsage.prompt_tokens : undefined,
        completionTokens: typeof rawUsage.completion_tokens === "number" ? rawUsage.completion_tokens : undefined,
        totalTokens: typeof rawUsage.total_tokens === "number" ? rawUsage.total_tokens : undefined,
        inputTokens: typeof rawUsage.input_tokens === "number" ? rawUsage.input_tokens : undefined,
        outputTokens: typeof rawUsage.output_tokens === "number" ? rawUsage.output_tokens : undefined,
        cacheCreationInputTokens: typeof rawUsage.cache_creation_input_tokens === "number"
          ? rawUsage.cache_creation_input_tokens
          : undefined,
        cacheReadInputTokens: typeof rawUsage.cache_read_input_tokens === "number"
          ? rawUsage.cache_read_input_tokens
          : undefined,
        promptCacheHitTokens: typeof rawUsage.prompt_cache_hit_tokens === "number"
          ? rawUsage.prompt_cache_hit_tokens
          : undefined,
        promptCacheMissTokens: typeof rawUsage.prompt_cache_miss_tokens === "number"
          ? rawUsage.prompt_cache_miss_tokens
          : undefined,
      } : undefined;

      if (!content.trim() && (!toolCalls || toolCalls.length === 0) && reasoning_content?.trim()) {
        const normalizedReasoningContent = reasoning_content.trim();
        return {
          ok: false,
          error: `模型返回空内容。finish_reason=${finishReason || "unknown"}，reasoning_content=present(${normalizedReasoningContent.length})。`,
          emptyContent: {
            finishReason: finishReason || "unknown",
            reasoningContentLength: normalizedReasoningContent.length,
          },
          reasoning_content: normalizedReasoningContent,
          usage,
          rawUsage: providerRawUsage,
        };
      }
      logModelPhase("[model-call] response_extracted", {
        parser: "chat_completions",
        contentLength: content.length,
        toolCallCount: toolCalls?.length ?? 0,
        reasoningContentLength: reasoning_content?.length ?? 0,
        usageInputTokens: usage?.input_tokens ?? 0,
        usageOutputTokens: usage?.output_tokens ?? 0,
      });

      return {
        ok: true,
        content,
        toolCalls,
        reasoning_content,
        usage,
        rawUsage: providerRawUsage,
      };
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
      if (err instanceof FailoverAttemptError && err.committed) {
        return {
          ok: false,
          error: err.message,
          interrupted: toAgentInterrupted(err),
        };
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
    hookRunner?: HookRunner,
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
    }, conversationId, agentId, hookRunner);

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
    }, conversationId, agentId, hookRunner);

    return result.state;
  }
}

function isMutationRecoveryReadyForHeadroom(candidate: WorkspaceMutationRecoveryPlan): boolean {
  if (candidate.sourceEvidenceItemCount > 0) {
    return candidate.sourceEvidenceCount > 0;
  }
  const sourceDependentMutationOnly = candidate.tools.every((tool) => (
    tool.function.name === "apply_patch" || tool.function.name === "file_edit"
  ));
  return !sourceDependentMutationOnly;
}

function requiresRequiredPathSourceNavigation(candidate: WorkspaceMutationRecoveryPlan): boolean {
  return candidate.sourceEvidenceItemCount > 0
    && candidate.missingRequiredSourceEvidencePaths.length > 0;
}

function mergePromptSnapshotInputMeta(
  systemPromptMetadata?: JsonObject,
  runMeta?: JsonObject,
  trustedTruncationReason?: JsonObject,
): JsonObject | undefined {
  if (!systemPromptMetadata && !runMeta) {
    return undefined;
  }
  const merged: Record<string, unknown> = {
    ...(systemPromptMetadata ? { ...systemPromptMetadata } : {}),
    ...(runMeta ? { ...runMeta } : {}),
  };
  delete merged.promptDeltas;
  delete merged.tokenBreakdown;
  delete merged.promptTokenBreakdown;
  delete merged.truncationReason;
  const resolvedTruncationReason = trustedTruncationReason ?? readTrustedTruncationReason(systemPromptMetadata);
  if (resolvedTruncationReason) {
    merged.truncationReason = { ...resolvedTruncationReason };
  }
  const systemPromptMaxChars = readTrustedSystemPromptMaxChars(systemPromptMetadata);
  if (typeof systemPromptMaxChars === "number") {
    merged.systemPromptMaxChars = systemPromptMaxChars;
  }
  return merged as JsonObject;
}

/** 估算 messages 数组的总 token 数（用于循环内压缩判断） */
function estimateMessagesTotal(messages: Message[], tokenEstimateContext?: TokenEstimateContext): number {
  const MARGIN = 1.2;
  return estimateContextTokensFromMessages(messages, {
    includeSystem: true,
    margin: MARGIN,
  }, tokenEstimateContext);
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
): Message[] {
  const messages: Message[] = [];

  // Layer 1: System
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
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

function buildEffectiveSystemPromptState(input: {
  systemPrompt?: string;
  runtimePromptDeltas?: readonly AgentPromptDelta[];
  systemPromptMetadata?: JsonObject;
}): EffectiveSystemPromptState {
  const text = buildEffectiveSystemPrompt(input.systemPrompt, input.runtimePromptDeltas);
  const maxChars = readTrustedSystemPromptMaxChars(input.systemPromptMetadata);
  const trustedTruncationReason = readTrustedTruncationReason(input.systemPromptMetadata);
  if (!maxChars || text.length <= maxChars) {
    return {
      text,
      ...(trustedTruncationReason ? { truncationReason: trustedTruncationReason } : {}),
      bypassProviderNativeSystemBlocks: false,
    };
  }

  const runtimeDeltaText = collectSystemPromptDeltaTexts(input.runtimePromptDeltas).join("\n").trim();
  let cappedText = text;
  if (runtimeDeltaText) {
    if (runtimeDeltaText.length >= maxChars) {
      cappedText = hardTruncatePromptText(runtimeDeltaText, maxChars);
    } else {
      const separatorChars = input.systemPrompt?.trim() ? 1 : 0;
      const baseBudget = Math.max(0, maxChars - runtimeDeltaText.length - separatorChars);
      const cappedBase = hardTruncatePromptText(input.systemPrompt?.trim() ?? "", baseBudget);
      cappedText = cappedBase
        ? `${cappedBase}\n${runtimeDeltaText}`
        : runtimeDeltaText;
    }
  } else {
    cappedText = hardTruncatePromptText(text, maxChars);
  }
  if (cappedText.length > maxChars) {
    cappedText = hardTruncatePromptText(cappedText, maxChars);
  }

  return {
    text: cappedText,
    truncationReason: buildEffectiveSystemPromptTruncationReason({
      existing: trustedTruncationReason,
      maxChars,
      runtimeDeltaText,
    }),
    bypassProviderNativeSystemBlocks: true,
  };
}

function hardTruncatePromptText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  const suffix = "\n...[system prompt truncated]";
  if (maxChars <= suffix.length) {
    return suffix.slice(0, maxChars);
  }
  return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function readTrustedSystemPromptMaxChars(systemPromptMetadata?: JsonObject): number | undefined {
  const rawValue = systemPromptMetadata && typeof systemPromptMetadata === "object"
    ? (systemPromptMetadata as Record<string, unknown>).systemPromptMaxChars
    : undefined;
  return typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0
    ? Math.floor(rawValue)
    : undefined;
}

function readTrustedTruncationReason(systemPromptMetadata?: JsonObject): JsonObject | undefined {
  const rawValue = systemPromptMetadata && typeof systemPromptMetadata === "object"
    ? (systemPromptMetadata as Record<string, unknown>).truncationReason
    : undefined;
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return undefined;
  }
  return { ...(rawValue as Record<string, unknown>) } as JsonObject;
}

function readTrustedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function buildEffectiveSystemPromptTruncationReason(input: {
  existing?: JsonObject;
  maxChars: number;
  runtimeDeltaText: string;
}): JsonObject {
  const existing = input.existing && typeof input.existing === "object"
    ? { ...(input.existing as Record<string, unknown>) }
    : {};
  const droppedSectionIds = readTrustedStringArray(existing.droppedSectionIds);
  const droppedSectionLabels = readTrustedStringArray(existing.droppedSectionLabels);
  const truncatedSectionIds = Array.from(new Set([
    ...readTrustedStringArray(existing.truncatedSectionIds),
    "final-system-prompt",
  ]));
  const truncatedSectionLabels = Array.from(new Set([
    ...readTrustedStringArray(existing.truncatedSectionLabels),
    "final-system-prompt",
  ]));
  const reasonMessage = input.runtimeDeltaText
    ? `Preserved runtime system deltas and truncated the remaining system prompt to fit ${input.maxChars} char limit.`
    : `Truncated final system prompt to fit ${input.maxChars} char limit.`;

  return {
    code: "max_chars_limit",
    maxChars: input.maxChars,
    droppedSectionCount: typeof existing.droppedSectionCount === "number"
      ? existing.droppedSectionCount
      : droppedSectionIds.length,
    ...(droppedSectionIds.length > 0 ? { droppedSectionIds } : {}),
    ...(droppedSectionLabels.length > 0 ? { droppedSectionLabels } : {}),
    truncatedSectionIds,
    truncatedSectionLabels,
    message: reasonMessage,
  } as JsonObject;
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

/** 按来源汇总压缩结果 */
function buildCompressionBySourceSummary(
  results: CompressionResult[],
): Record<string, { applied: number; savedTokens: number }> {
  const summary: Record<string, { applied: number; savedTokens: number }> = {};
  for (const result of results) {
    const source = result.observability.sourceKind;
    if (!summary[source]) {
      summary[source] = { applied: 0, savedTokens: 0 };
    }
    if (result.applied) {
      summary[source].applied++;
      summary[source].savedTokens += result.savedTokensEstimate;
    }
  }
  return summary;
}

// 辅助函数：转换 Message 对象为 OpenAI 格式（去除 undefined 字段）
// reasoning_content 最小回传策略（Phase 0 probe 验证）：
// - 默认 required_on_tool_call_turn：仅对已知需要占位的模型 + tool_calls turn 保留 reasoning_content
// - 非 tool_calls turn 的 reasoning_content 默认不回传（减少 prompt 体积）
// - 可通过 env BELLDANDY_REASONING_CONTENT_POLICY=must_preserve_full_reasoning 回退旧行为
function cleanupMessage(msg: Message, modelId?: string): any {
  if (msg.role === "assistant") {
    const policy = resolveReasoningContentPolicy();
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    const isReasoningModel = isKnownReasoningModel(modelId);

    // 决定是否保留 reasoning_content
    let reasoningContentToSend: string | undefined;

    if (policy === "must_preserve_full_reasoning") {
      // 旧行为：全量保留
      reasoningContentToSend = msg.reasoning_content;
    } else if (policy === "allowed_but_strip_elsewhere") {
      // 中间策略：所有 turn 都不回传 reasoning_content，除非已知需要占位
      if (isReasoningModel && hasToolCalls && !msg.reasoning_content) {
        reasoningContentToSend = "（思考内容已省略）";
      }
      // 有 reasoning_content 时不回传
    } else {
      // 默认 required_on_tool_call_turn：
      // - 非 tool_calls turn：不回传 reasoning_content（减少 prompt 体积）
      // - tool_calls turn：仅对已知需要占位的模型保留/补占位
      if (hasToolCalls && isReasoningModel) {
        reasoningContentToSend = msg.reasoning_content ?? "（思考内容已省略）";
      }
      // 非 tool_calls turn 或非已知思考模型：不回传
    }

    const cleaned: any = {
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls,
    };
    if (typeof reasoningContentToSend === "string" && reasoningContentToSend) {
      cleaned.reasoning_content = reasoningContentToSend;
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
  const result = await readResponseTextBounded(res, { maxBytes: 2048 });
  return result.truncated ? `${result.text}…` : result.text;
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
 * 输入 token 预检：估算 messages + tools 的总 token 数，超限时按 budget protect 策略裁剪。
 *
 * Phase 3 改造：
 * - protect_memory_capability 模式（默认）：先压缩历史内容 → 保留最近 N 轮 → 从最老开始删 → 保护 system
 * - history_first 模式（旧行为）：从第一条非 system 消息开始删
 *
 * 直接修改 messages 数组（in-place）。
 */
async function trimMessagesToFit(
  messages: Message[],
  tools: { type: "function"; function: { name: string; description: string; parameters: object } }[] | undefined,
  maxTokens: number,
  tokenEstimateContext?: TokenEstimateContext,
  budgetProtectOpts?: BudgetProtectOptions,
  historyCompressionContext?: HistoryCompressionContext,
): Promise<PromptTrimDiagnostics> {
  const SAFETY_MARGIN = 1.2;
  const bpOpts = resolveBudgetProtectOptions(budgetProtectOpts);
  const bpDiag = createEmptyBudgetProtectDiagnostics(bpOpts.mode);
  let trimmedMessageCount = 0;
  let trimmedHistoryTokens = 0;

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
    }, tokenEstimateContext);
  };

  let total = estimateTotal();
  if (total <= maxTokens) {
    return {
      trimmedMessageCount,
      trimmedHistoryTokens,
      budgetProtect: bpDiag,
    };
  }

  if (bpOpts.mode === "history_first") {
    // 旧行为：从第一条非 system 消息开始删，保留最后一条
    while (total > maxTokens && messages.length > 2) {
      const idx = messages.findIndex((m, i) => m.role !== "system" && i < messages.length - 1);
      if (idx === -1) break;
      const [removed] = messages.splice(idx, 1);
      if (removed) {
        trimmedMessageCount += 1;
        trimmedHistoryTokens += estimateMessageContentTokens(removed.content, tokenEstimateContext) + 4;
        trimmedHistoryTokens += estimateAssistantHistoryOverhead(removed, tokenEstimateContext);
      }
      total = estimateTotal();
    }
    bpDiag.deletedHistoryCount = trimmedMessageCount;
    bpDiag.deletedHistoryTokens = trimmedHistoryTokens;
    bpDiag.protectionActivated = false;
    return {
      trimmedMessageCount,
      trimmedHistoryTokens,
      budgetProtect: bpDiag,
    };
  }

  // protect_memory_capability 模式（Phase 3 新行为）
  bpDiag.protectionActivated = true;

  // 计算受保护的索引（最近 N 轮）
  const protectedIndices = computeProtectedIndices(messages, bpOpts.keepRecentRounds);
  bpDiag.protectedRounds = bpOpts.keepRecentRounds;

  // 阶段 1：先尝试压缩历史中的长消息内容（user/assistant）
  if (bpOpts.compressBeforeDelete) {
    for (let i = 0; i < messages.length && total > maxTokens; i++) {
      const msg = messages[i];
      if (!msg || protectedIndices.has(i)) continue;
      if (!isCompressibleHistoryMessage(msg, bpOpts.compressThresholdChars)) continue;

      const originalContent = msg.content as string;
      const originalTokens = estimateMessageContentTokens(originalContent, tokenEstimateContext);
      let compressed = "";
      let saved = 0;

      try {
        const structured = await compressHistoryMessageForBudgetProtect(
          msg,
          historyCompressionContext ?? {},
          tokenEstimateContext,
        );
        if (structured.applied && structured.content) {
          compressed = structured.content;
          saved = structured.savedTokens ?? 0;
        }
      } catch {
        // fail-open：统一压缩层失败时回退旧策略
      }

      if (!compressed || saved <= 0) {
        // 回退：保留首尾，中间省略（兼容旧行为，但只作为兜底）
        const headChars = Math.min(300, Math.floor(originalContent.length * 0.3));
        const tailChars = Math.min(200, Math.floor(originalContent.length * 0.1));
        if (headChars + tailChars + 50 >= originalContent.length) continue; // 压缩收益太小
        compressed = `${originalContent.slice(0, headChars)}\n... [${originalContent.length - headChars - tailChars} chars omitted by budget-protect] ...\n${originalContent.slice(-tailChars)}`;
        const compressedTokens = estimateMessageContentTokens(compressed, tokenEstimateContext);
        saved = Math.max(0, originalTokens - compressedTokens);
      }

      if (saved > 0) {
        msg.content = compressed;
        bpDiag.compressedHistoryCount++;
        bpDiag.compressedHistorySavedTokens += saved;
        trimmedHistoryTokens += saved;
        total = estimateTotal();
      }
    }
  }

  // 阶段 2：从最老的历史消息开始删除（跳过 system 和受保护的）
  while (total > maxTokens && messages.length > 2) {
    // 从头找第一个可删除的消息（非 system、非受保护、非最后一条）
    let idx = -1;
    for (let i = 0; i < messages.length - 1; i++) {
      if (isDeletableHistoryMessage(messages[i], i, protectedIndices)) {
        idx = i;
        break;
      }
    }
    if (idx === -1) break;
    const [removed] = messages.splice(idx, 1);
    if (removed) {
      trimmedMessageCount += 1;
      const removedTokens = estimateMessageContentTokens(removed.content, tokenEstimateContext) + 4
        + estimateAssistantHistoryOverhead(removed, tokenEstimateContext);
      trimmedHistoryTokens += removedTokens;
      bpDiag.deletedHistoryCount++;
      bpDiag.deletedHistoryTokens += removedTokens;
      // 删除后受保护索引需要调整（索引前移）
      // 但由于我们每次都从头找，且 protectedIndices 是基于原始位置的，
      // 删除后重新计算更安全
      // 简化：删除后重算受保护索引
      const newProtected = computeProtectedIndices(messages, bpOpts.keepRecentRounds);
      protectedIndices.clear();
      for (const idx2 of newProtected) protectedIndices.add(idx2);
    }
    total = estimateTotal();
  }

  return {
    trimmedMessageCount,
    trimmedHistoryTokens,
    budgetProtect: bpDiag,
  };
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
