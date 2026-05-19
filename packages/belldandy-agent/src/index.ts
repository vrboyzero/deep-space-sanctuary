import type { JsonObject } from "@belldandy/protocol";

export { OpenAIChatAgent, type OpenAIChatAgentOptions } from "./openai.js";
export { ToolEnabledAgent, type ToolEnabledAgentOptions } from "./tool-agent.js";
export { microcompactMessages, type MicrocompactMessage, type MicrocompactOptions, type MicrocompactResult } from "./microcompact.js";

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
  ConversationStore,
  type Conversation,
  type ConversationMessage,
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
  type SessionTranscriptCompactBoundaryEvent,
  type SessionTranscriptCompactBoundaryPayload,
  type SessionTranscriptEvent,
  type SessionTranscriptEventType,
  type SessionTranscriptMessageEvent,
  type SessionTranscriptMessagePayload,
  type SessionTranscriptPartialCompactionViewEvent,
  type SessionTranscriptPartialCompactionViewPayload,
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
  SESSION_TIMELINE_SCHEMA_VERSION,
  buildSessionTimelineProjection,
  type SessionTimelineCompactBoundaryItem,
  type SessionTimelineItem,
  type SessionTimelineMessageItem,
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
};

export type AgentStreamItem =
  | AgentDelta
  | AgentFinal
  | AgentStatus
  | AgentToolCall
  | AgentToolResult
  | AgentUsage;

export interface BelldandyAgent {
  run(input: AgentRunInput): AsyncIterable<AgentStreamItem>;
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
export { createHookRunner, type HookRunner, type HookRunnerLogger, type HookRunnerOptions } from "./hook-runner.js";

// 多模态预处理（视频上传等）
export { buildUrl, uploadFileToMoonshot, preprocessMultimodalContent, type PreprocessResult, type VideoUploadConfig } from "./multimodal.js";

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
  CompactionRuntimeTracker,
  type CompactionRuntimeReport,
  type CompactionRuntimeSource,
  type CompactionRuntimeSkipDecision,
} from "./compaction-runtime.js";
