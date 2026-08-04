import type { JsonObject } from "@belldandy/protocol";
import type { SystemPromptSection } from "./system-prompt.js";
import type {
  AgentBudgetCompetition,
  AgentPrefixDrift,
  AgentPrefixShape,
} from "./prompt-budget-observability.js";
import type { AgentStructuredOutputContract } from "./structured-output.js";

export { OpenAIChatAgent, type OpenAIChatAgentOptions } from "./openai.js";
export {
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_TOOL_LOOP_ITERATION_BUDGET,
  ToolEnabledAgent,
  type ConversationReleaseRuntimeSnapshot,
  type ToolEnabledAgentOptions,
} from "./tool-agent.js";
export {
  DEFAULT_MAX_HIGH_RISK_TOOL_CALLS,
  DEFAULT_MAX_RUN_WALL_TIME_MS,
  DEFAULT_MAX_TOTAL_TOKENS,
  normalizeMaxHighRiskToolCalls,
  normalizeMaxRunWallTimeMs,
  normalizeMaxTotalTokens,
} from "./react-run-budget.js";
export { microcompactMessages, type MicrocompactMessage, type MicrocompactOptions, type MicrocompactResult } from "./microcompact.js";
export type {
  AgentStructuredOutputContract,
  StructuredOutputValidationResult,
} from "./structured-output.js";

// Failover（模型容灾）
export {
  FailoverClient,
  loadModelFallbacks,
  classifyFailoverReason,
  isUnsupportedModelErrorText,
  isRetryableReason,
  resolveFailoverCooldownMs,
  type ModelProfile,
  type FailoverReason,
  type FailoverAttempt,
  type FailoverResult,
  type FailoverExecutionStatus,
  type FailoverExecutionStepKind,
  type FailoverExecutionStep,
  type FailoverExecutionSummary,
  FailoverExhaustedError,
  type FailoverLogger,
  type ModelConfigFile,
} from "./failover-client.js";

// Workspace & System Prompt (SOUL/Persona)
export {
  ensureWorkspace,
  loadWorkspaceFiles,
  ensureAgentWorkspace,
  loadAgentWorkspaceFiles,
  needsBootstrap,
  createBootstrapFile,
  removeBootstrapFile,
  extractIdentityInfo,
  SOUL_FILENAME,
  IDENTITY_FILENAME,
  USER_FILENAME,
  BOOTSTRAP_FILENAME,
  AGENTS_FILENAME,
  TOOLS_FILENAME,
  HEARTBEAT_FILENAME,
  MEMORY_FILENAME,
  parseWorkspaceDocument,
  getWorkspaceDocumentBody,
  type WorkspaceFile,
  type WorkspaceFileName,
  type WorkspaceLoadResult,
  type WorkspaceDocumentRole,
  type WorkspaceDocumentFrontmatter,
  type WorkspaceDocument,
  type IdentityInfo,
} from "./workspace.js";

export {
  buildSystemPrompt,
  buildProviderNativeSystemBlocks,
  buildSystemPromptResult,
  buildSystemPromptSections,
  renderSystemPromptSections,
  buildWorkspaceContext,
  type ProviderNativeSystemBlock,
  type ProviderNativeSystemBlockType,
  type SystemPromptParams,
  type SystemPromptSection,
  type SystemPromptSectionSource,
  type SystemPromptBuildResult,
} from "./system-prompt.js";

export {
  buildCapabilityRoutingIndexLines,
  buildCapabilityUsageNotesLines,
} from "./capability-routing.js";

export {
  type AgentPromptDelta,
  type AgentPromptDeltaRole,
  type AgentPromptDeltaType,
  type AgentPromptSnapshot,
  type AgentPromptSnapshotContentPart,
  type AgentPromptSnapshotMessage,
} from "./prompt-snapshot.js";
export {
  type AgentBudgetCompetition,
  type AgentPrefixDrift,
  type AgentPrefixShape,
} from "./prompt-budget-observability.js";

export {
  ConversationStore,
  type Conversation,
  type ConversationMessage,
  type ConversationRuntimeSnapshot,
  type ConversationStoreOptions,
  type CompactBoundaryRecord,
  type ForcePartialCompactOptions,
  type PartialCompactDirection,
  type PartialCompactionViewRecord,
  type SessionDigestRecord,
  type SessionDigestRefreshOptions,
  type SessionDigestStatus,
  type SessionMemoryRecord,
  type PersistedConversationSummary,
  type ToolDigestRecord,
} from "./conversation.js";
export {
  DEFAULT_SESSION_TRANSCRIPT_PAGE_SIZE,
  DEFAULT_SESSION_TRANSCRIPT_READ_LIMITS,
  MAX_SESSION_TRANSCRIPT_PAGE_SIZE,
  type SessionTranscriptCompactBoundaryEvent,
  type SessionTranscriptCompactBoundaryPayload,
  type SessionTranscriptEvent,
  type SessionTranscriptEventType,
  type SessionTranscriptCursorInvalidationReason,
  type SessionTranscriptCursorStatus,
  type SessionTranscriptMessageEvent,
  type SessionTranscriptMessagePayload,
  type SessionTranscriptPageOptions,
  type SessionTranscriptPageReadResult,
  type SessionTranscriptPartialCompactionViewEvent,
  type SessionTranscriptPartialCompactionViewPayload,
  type SessionTranscriptReadDiagnostics,
  type SessionTranscriptReadLimits,
  type SessionTranscriptReadResult,
  type SessionTranscriptTruncatedReason,
} from "./session-transcript.js";
export {
  type TranscriptRelinkArtifacts,
  type TranscriptRelinkBoundary,
  type TranscriptRelinkInput,
  type TranscriptRelinkPartialCompactionView,
  type TranscriptRelinkResult,
} from "./session-transcript-relink.js";
export {
  type SessionRestoreDiagnostics,
  type SessionRestoreHistoryMessage,
  type SessionRestoreView,
} from "./session-restore.js";
export {
  SESSION_TRANSCRIPT_EXPORT_SCHEMA_VERSION,
  buildSessionTranscriptExportBundle,
  type SessionTranscriptExportBundle,
  type SessionTranscriptExportRedactionMode,
} from "./session-transcript-export.js";
export {
  writeSessionTranscriptExportBundle,
  type SessionTranscriptExportWriteOptions,
} from "./session-transcript-export-writer.js";
export {
  SESSION_TIMELINE_SCHEMA_VERSION,
  buildSessionTimelinePage,
  buildSessionTimelineProjection,
  type SessionTimelineCompactBoundaryItem,
  type SessionTimelineItem,
  type SessionTimelineMessageItem,
  type SessionTimelinePage,
  type SessionTimelinePageItem,
  type SessionTimelinePartialCompactionItem,
  type SessionTimelineProjection,
  type SessionTimelineRestoreResultItem,
  type SessionTimelineWarningCode,
} from "./session-timeline.js";

export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } }; // url format: "data:image/jpeg;base64,{base64_image}"

/** 消息发送者信息 */
export type SenderInfo = {
  type: "user" | "agent";
  id: string;
  name?: string;
  identity?: string; // Agent的身份标签（如：舰长、CEO）
};

/** 房间成员信息 */
export type RoomMember = {
  type: "user" | "agent";
  id: string;
  name?: string;
  identity?: string; // Agent的身份标签
};

/** 房间上下文信息 */
export type RoomContext = {
  roomId?: string;
  environment: "local" | "community"; // 本地WebChat vs office.goddess.ai社区
  sessionKey?: string;
  members?: RoomMember[];
  clientId?: string;
};

export type AgentRunInput = {
  conversationId: string;
  /** 仅由可信运行时注入；bare 跳过本次运行的隐式上下文与扩展。 */
  automationProfile?: "bare";
  /**
   * Legacy text field. If `content` is provided, it takes precedence.
   * If only `text` is provided, it will be treated as `{ type: "text", text }`.
   */
  text: string;
  /** 用户原始输入文本（可选；用于钩子语义召回等场景） */
  userInput?: string;
  /**
   * Multimodal content parts (text, image, etc).
   * Compatible with OpenAI's content array format.
   */
  content?: string | Array<AgentContentPart>;
  /**
   * Trusted runtime-only replacement for the static agent prompt in one run.
   * RPC callers must not be allowed to populate this field directly.
   */
  promptOverride?: AgentRunPromptOverride;
  meta?: JsonObject;
  /** 当前 Agent ID（传递给 ToolExecutor 用于 per-agent workspace 定位） */
  agentId?: string;
  /** 对话历史（role 必须是 user 或 assistant） */
  history?: Array<{ role: "user" | "assistant"; content: string | Array<AgentContentPart> }>;
  /** 用户UUID（用于身份权力验证） */
  userUuid?: string;
  /** 消息发送者信息（用于身份上下文） */
  senderInfo?: SenderInfo;
  /** 房间上下文信息（用于多人聊天场景） */
  roomContext?: RoomContext;
  /** 外部中断信号（用于停止当前 run） */
  abortSignal?: AbortSignal;
  /** 仅由可信运行时注入；普通 RPC 调用方不得构造。 */
  steering?: AgentRunSteeringMailbox;
  /** 仅由可信运行时注入；校验失败时至多执行一次无工具修复。 */
  structuredOutput?: AgentStructuredOutputContract;
};

export type AgentRunSteerCommand = {
  commandId: string;
  prompt: string;
};

export interface AgentRunSteeringMailbox {
  consumePending(input: { modelCallIndex: number }): Promise<AgentRunSteerCommand[]>;
  /** 无待处理输入时原子关闭 mailbox；返回 false 表示调用方应继续下一次模型调用。 */
  sealIfIdle(): boolean;
}

export type AgentRunPromptOverride = {
  text: string;
  sections?: SystemPromptSection[];
  metadata?: JsonObject;
};

export type AgentDelta = {
  type: "delta";
  delta: string;
};

export type AgentFinal = {
  type: "final";
  text: string;
};

export type AgentStatus = {
  type: "status";
  status: "running" | "done" | "error" | "stopped";
  code?: "output_schema_invalid";
  error?: string;
};

/** Provider 流在提交可见内容后失败时的可诊断终态。 */
export type AgentInterrupted = {
  type: "interrupted";
  reason: "provider_stream_error" | "provider_stream_timeout" | "provider_stream_protocol";
  error: string;
  committed: boolean;
  code?: string;
};

/** ReAct 硬预算耗尽时的可诊断终态；final/status 会紧随其后。 */
export type AgentBudgetExhausted = {
  type: "budget_exhausted";
  budget: "tool_loop_iterations" | "tool_calls" | "wall_time_ms" | "total_tokens" | "high_risk_tool_calls" | "cost_usd";
  limit: number;
  observed: number;
};

export type AgentToolCall = {
  type: "tool_call";
  id: string;
  name: string;
  arguments: JsonObject;
};

export type AgentToolResult = {
  type: "tool_result";
  id: string;
  name: string;
  success: boolean;
  output: string;
  error?: string;
  failureKind?: string;
  metadata?: JsonObject;
};

export type AgentUsage = {
  type: "usage";
  /** 系统提示词 token 估算 */
  systemPromptTokens: number;
  /** 上下文（历史+当前消息）token 估算 */
  contextTokens: number;
  /** API 实际 input tokens（ReAct 循环累加） */
  inputTokens: number;
  /** API 实际 output tokens（ReAct 循环累加） */
  outputTokens: number;
  /** Anthropic cache 创建 tokens */
  cacheCreationTokens: number;
  /** Anthropic cache 读取 tokens */
  cacheReadTokens: number;
  /** DeepSeek / OpenAI-compatible prompt cache hit tokens */
  cacheHitTokens?: number;
  /** DeepSeek / OpenAI-compatible prompt cache miss tokens */
  cacheMissTokens?: number;
  /** 本次 run 的模型调用次数 */
  modelCalls: number;
  /** 其中具备 Provider usage 响应的模型调用次数；缺失表示旧实现无法判定完整性 */
  providerReportedModelCalls?: number;
  /** provider cache capability */
  cacheSupport?: "supported" | "unsupported" | "unknown";
  /** system prompt prefix fingerprint for cache observability */
  systemPromptFingerprint?: string;
  /** prompt structure signature for cache coordination */
  structureSignature?: string;
  /** prompt prefix warm-up aware coordination verdict */
  warmupCoordination?: {
    eligible?: boolean;
    status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
    recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
    reason?: string;
    previousAgeMs?: number;
  };
  /** provider/model/cache family affinity verdict */
  cacheFamilyAffinity?: {
    status?: "unknown" | "aligned" | "mismatch";
    familyKey?: string;
    previousFamilyKey?: string;
    reason?: string;
  };
  /** 估算的输入成本（USD） */
  inputCostUsd?: number;
  /** 估算的输出成本（USD） */
  outputCostUsd?: number;
  /** 估算的 cache read 成本（USD） */
  cacheReadCostUsd?: number;
  /** 估算的 cache creation 成本（USD） */
  cacheCreationCostUsd?: number;
  /** 估算的 cache savings（USD） */
  cacheSavingsUsd?: number;
  /** 估算的总成本（USD） */
  totalCostUsd?: number;
  /** 估算值与 provider usage 的只读校准观测 */
  usageCalibration?: {
    estimatedPromptTokens: number;
    actualInputTokens: number;
    modelCalls: number;
    averageInputTokensPerCall: number;
    deltaTokens: number;
    deltaRatio: number;
    status?: "aligned" | "under_estimated" | "over_estimated";
  };
  /** 最近一次模型调用返回的 provider 原始 usage 字段 */
  providerRawUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
  /** 最近一次模型调用发送给 provider 的本地请求形状 */
  requestShape?: {
    messageCount: number;
    systemMessageCount: number;
    toolSchemaCount: number;
  };
  /** 最近一次模型调用发送前的本地 prompt token 估算 */
  localPromptEstimate?: {
    systemPromptTokens: number;
    contextTokens: number;
    totalPromptTokens: number;
  };
  /** 最近一次模型调用前缀形状，用于定位缓存 miss 原因 */
  prefixShape?: AgentPrefixShape;
  /** 最近一次模型调用相对上一轮的前缀漂移原因 */
  prefixDrift?: AgentPrefixDrift;
  /** 最近一次模型调用预算竞争观测 */
  budgetCompetition?: AgentBudgetCompetition;
  /** Phase 1：统一压缩层观测（本次 run 最近一次压缩批结果） */
  compression?: {
    appliedCount: number;
    skippedCount: number;
    failedCount: number;
    totalSavedTokensEstimate: number;
    /** 按来源汇总 */
    bySource?: Record<string, { applied: number; savedTokens: number }>;
    /** 工具结果 adaptive keep 选择诊断 */
    selection?: {
      adaptive: boolean;
      keepRecentToolMessages: number;
      toolMessageCount: number;
      selectedCount: number;
      keptCount: number;
      decisions: Array<{
        messageIndex: number;
        toolName: string;
        action: "compress" | "keep";
        reason: string;
        contentChars: number;
      }>;
    };
  };
};

export type AgentStreamItem =
  | AgentDelta
  | AgentFinal
  | AgentStatus
  | AgentInterrupted
  | AgentBudgetExhausted
  | AgentToolCall
  | AgentToolResult
  | AgentUsage;

export type CodingRunCapabilities = {
  /** 运行时是否可以基于真实模型定价强制 maxCostUsd。 */
  maxCostUsd: boolean;
  /** 仅表示可在下一次模型调用前注入，不表示可修改已发出的 Provider stream。 */
  steerAtModelBoundary?: boolean;
};

export interface BelldandyAgent {
  run(input: AgentRunInput): AsyncIterable<AgentStreamItem>;
  /** 释放指定会话的纯内存状态；实现不得删除 canonical 持久化数据。 */
  releaseConversation?(conversationId: string): void | Promise<void>;
  /** 未实现时视为不支持可强制的 coding-run 费用预算。 */
  getCodingRunCapabilities?(): CodingRunCapabilities;
}

export class MockAgent implements BelldandyAgent {
  async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
    yield { type: "status", status: "running" };
    const response = `Belldandy(MVP) 收到：${input.text}`;
    const chunks = splitText(response, 6);
    let out = "";
    for (const delta of chunks) {
      if (input.abortSignal?.aborted) {
        yield { type: "status", status: "stopped" };
        return;
      }
      out += delta;
      await sleep(60);
      if (input.abortSignal?.aborted) {
        yield { type: "status", status: "stopped" };
        return;
      }
      yield { type: "delta", delta };
    }
    yield { type: "final", text: out };
    yield { type: "status", status: "done" };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 钩子系统
export * from "./hooks.js";
export {
  HOOK_FAILURE_POLICIES,
  createHookRunner,
  type HookRunner,
  type HookRunnerDiagnostics,
  type HookRunnerLogger,
  type HookRunnerOptions,
} from "./hook-runner.js";
export {
  listHookFailurePolicies,
  type HookExecutionMode,
  type HookFailurePolicy,
  type HookFailurePolicyDescriptor,
} from "./hook-failure-policy.js";

// 多模态预处理（视频上传等）
export {
  buildUrl,
  uploadFileToMoonshot,
  preprocessMultimodalContent,
  type MoonshotUploadOptions,
  type PreprocessResult,
  type VideoUploadConfig,
} from "./multimodal.js";

// Anthropic 原生协议支持（prompt caching、消息/工具转换）
export {
  convertMessagesToAnthropic,
  convertToolsToAnthropic,
  buildAnthropicRequest,
  parseAnthropicResponse,
  type AnthropicUsage,
  type AnthropicRequestPayload,
  type ParsedAnthropicResponse,
} from "./anthropic.js";

// Agent Profile（多 Agent 预备）
export {
  buildDefaultProfile,
  buildBuiltinWorkerProfiles,
  isResidentAgentProfile,
  loadAgentProfiles,
  resolveAgentMemoryMode,
  resolveAgentProfileCatalogMetadata,
  resolveAgentProfileDefaultRole,
  resolveModelConfig,
  resolveAgentProfileKind,
  resolveAgentProfileMetadata,
  resolveAgentSessionNamespace,
  resolveAgentWorkspaceBinding,
  resolveAgentWorkspaceDir,
  type AgentProfile,
  type AgentConfigFile,
  type AgentMemoryMode,
  type AgentProfileCatalogMetadata,
  type AgentProfileDefaultPermissionMode,
  type AgentProfileDefaultRole,
  type AgentProfileHandoffStyle,
  type AgentProfileKind,
  type AgentWorkspaceBinding,
  type ResolvedAgentProfileMetadata,
} from "./agent-profile.js";

// Agent Registry（多 Agent 注册表）
export {
  AgentRegistry,
  type AgentFactoryFn,
  type AgentCreateOptions,
} from "./agent-registry.js";

// Sub-Agent Orchestrator（子 Agent 编排）
export {
  normalizeAgentLaunchSpec,
  normalizeAgentLaunchSpecWithCatalog,
  DEFAULT_AGENT_LAUNCH_TIMEOUT_MS,
  type AgentLaunchSpec,
  type AgentLaunchSpecInput,
} from "./launch-spec.js";

export {
  SubAgentOrchestrator,
  type SubAgentSession,
  type SubAgentSessionStatus,
  type SubAgentEvent,
  type SpawnOptions,
  type SpawnResult,
  type OrchestratorOptions,
  type OrchestratorLogger,
  type OrchestratorHookRunner,
} from "./orchestrator.js";

// 动态工作流 WorkflowContext 类型定义（实现由 @belldandy/core 提供）
export {
  type AgentCallOptions,
  type WorkflowContext,
  type WorkflowTaskResult,
  type PipelineStage,
} from "./workflow-context.js";

// 对话压缩
export {
  compactMessages,
  compactIncremental,
  needsCompaction,
  needsInLoopCompaction,
  estimateTokens,
  estimateMessagesTokens,
  createEmptyCompactionState,
  type CompactionOptions,
  type CompactionResult,
  type CompactionState,
  type SummarizerContext,
  type SummarizerFn,
} from "./compaction.js";
export {
  SessionArtifactInventory,
  SessionArtifactInventoryCursorError,
  type SessionArtifactInventoryDiagnostics,
  type SessionArtifactInventoryItem,
  type SessionArtifactInventoryLimits,
  type SessionArtifactInventoryPage,
  type SessionArtifactInventoryPageOptions,
} from "./session-artifact-inventory.js";
export {
  CompactionRuntimeTracker,
  type CompactionRuntimeReport,
  type CompactionRuntimeSource,
  type CompactionRuntimeSkipDecision,
} from "./compaction-runtime.js";

// 统一上下文压缩层（Phase 1 + Phase 2）
export {
  createCompressionPipeline,
  createCompressionPipelineWithStore,
  DEFAULT_COMPRESSION_POLICY,
  resolveCompressionPolicy,
  isSourceEnabled,
  isSourceLossyAllowed,
  isReferenceStoreAllowed,
  detectContentType,
  buildObservabilityRecord,
  PassthroughCompressor,
  PlainTextCompressor,
  LogOutputCompressor,
  SearchResultsCompressor,
  JsonToolOutputCompressor,
  CodeSnippetCompressor,
  ConversationReferenceStore,
  PersistentCompressionReferenceStore,
  readPersistentCompressionReference,
  getPersistentCompressionReferenceRoot,
  cleanupPersistentCompressionReferences,
  normalizePersistentRefId,
  generateRefId,
  hasCompressionMarker,
  hasLegacyCompressionMarker,
  isAnyCompactedContent,
  parseCompressionMarker,
  buildCompressionMarkerHeader,
  wrapWithMarker,
  rewriteMarkerRetrievable,
  statusToRetrievable,
  coldResumePruneMessages,
  pruneBeforeSummarize,
  type CompressionPolicy,
  type CompressionRequest,
  type CompressionResult,
  type CompressionSourceKind,
  type CompressionContentType,
  type CompressionBatchResult,
  type ContextCompressionPipeline,
  type ContextCompressor,
  type ReferenceStatus,
  type StoredReference,
  type CompressionReferenceStore,
  type PersistentCompressionReferenceReadResult,
  type PersistentCompressionReferenceCleanupResult,
  type ParsedCompressionMarker,
  type ColdResumePruneResult,
} from "./context-compression/index.js";

// Phase 3：预算保护策略
export {
  resolveBudgetProtectOptions,
  computeProtectedIndices,
  isCompressibleHistoryMessage,
  isDeletableHistoryMessage,
  createEmptyBudgetProtectDiagnostics,
  DEFAULT_BUDGET_PROTECT_OPTIONS,
  type BudgetProtectMode,
  type BudgetProtectOptions,
  type BudgetProtectDiagnostics,
} from "./budget-protect.js";

// Phase 4：stable prefix / transient tail 拆层
export {
  splitDeltasByStability,
  buildTransientTailText,
  injectTransientTail,
  buildIndependentBlockText,
  injectIndependentBlock,
  isTransientSafeDelta,
  isStableDelta,
  isIndependentBlockDelta,
  DEFAULT_STABLE_PREFIX_SPLIT_OPTIONS,
  type StablePrefixSplitOptions,
  type StablePrefixSplitResult,
} from "./stable-prefix-split.js";

// Phase 4 步骤 4：shared compressed context
export {
  SharedCompressedContextStore,
  getOrCreateSharedCompressedContextStore,
  getSharedCompressedContextStore,
  cleanupSharedCompressedContextStore,
  injectSharedCompressedContext,
  buildLaneSummary,
  type SharedContextEntry,
} from "./shared-compressed-context.js";
