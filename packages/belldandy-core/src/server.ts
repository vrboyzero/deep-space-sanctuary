import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import type { Socket } from "node:net";
import path from "node:path";

import express from "express";
import { type WebSocket } from "ws";
import type { EnvDirSource } from "@star-sanctuary/distribution";
import { resolveEnvFilePaths } from "@star-sanctuary/distribution";

import {
  buildDreamInputSnapshot,
  createDurableExtractionSurface,
  DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_CODE,
  DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_MESSAGE,
  DreamRuntime,
  DurableExtractionRuntime,
  getGlobalMemoryManager,
  guardTeamSharedMemoryWrite,
  MemoryModelPrivacyRuntime,
  type DurableExtractionDigestSnapshot,
  type DurableExtractionRecord,
} from "@belldandy/memory";
import {
  DEFAULT_STATE_DIR_DISPLAY,
  drainTokenUsageUploads,
  getTokenUsageUploadRuntimeSnapshot,
} from "@belldandy/protocol";
import { MockAgent, type AgentPromptDelta, type BelldandyAgent, ConversationStore, type AgentRegistry, isResidentAgentProfile, type ModelProfile, type CompactionRuntimeReport, type ProviderNativeSystemBlock, type SessionTimelineProjection, type SessionTranscriptExportBundle, type SystemPromptSection } from "@belldandy/agent";
import type {
  GatewayReqFrame,
  GatewayResFrame,
  GatewayEventFrame,
  ConversationRunStopParams,
  CodingRunOptions,
  MessageSendParams,
  ChatMessageMeta,
} from "@belldandy/protocol";
import { approvePairingCode, ensurePairingCode, isClientAllowed, resolveStateDir } from "./security/store.js";
import { getGatewayMethodPolicy, validateGatewayMethodRegistry } from "./gateway-method-registry.js";
import { readTokenUsageUploadConfig } from "./token-usage-upload-config.js";
import { admitGatewayRequest, getPairedGatewayCapabilities } from "./request-admission.js";
import type { BelldandyLogger } from "./logger/index.js";
import type { ToolsConfigManager } from "./tools-config.js";
import type { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import type { ExternalOutboundAuditStore } from "./external-outbound-audit-store.js";
import type { ExternalOutboundConfirmationStore } from "./external-outbound-confirmation-store.js";
import type { ExternalOutboundSenderRegistry } from "./external-outbound-sender-registry.js";
import type { EmailOutboundAuditStore } from "./email-outbound-audit-store.js";
import type { EmailOutboundConfirmationStore } from "./email-outbound-confirmation-store.js";
import type { EmailOutboundProviderRegistry } from "./email-outbound-provider-registry.js";
import type { EmailInboundAuditStore } from "./email-inbound-audit-store.js";
import type { EmailFollowUpReminderStore } from "./email-follow-up-reminder-store.js";
import type { PreflightCompressionPolicy } from "./preflight-compression-config.js";
import { resolveToolResultEventOutputCharLimit } from "./tool-result-event-output.js";
import {
  buildPromptObservabilitySummary,
  formatPromptObservabilityHeadline,
  toPromptObservabilityView,
} from "./prompt-observability.js";
import { resolveModelMediaCapabilities } from "./media-capability-registry.js";
import {
  buildToolBehaviorObservability,
  readConfiguredPromptExperimentToolContracts,
} from "./tool-behavior-observability.js";
import { buildToolContractV2Observability } from "./tool-contract-v2-observability.js";
import type {
  SubTaskCommandRequestOptions,
  SubTaskRecord,
  SubTaskRuntimeStore,
} from "./task-runtime.js";
import {
  applyToolControlChanges,
  buildToolControlDisabledPayload,
  resolvePendingToolControlRequest,
  resolveToolControlPolicySnapshot,
  tryApproveToolControlPasswordInput,
} from "./tool-control-policy.js";
import {
  MemoryRuntimeBudgetGuard,
  MemoryRuntimeUsageAccounting,
  SlidingWindowRateLimiter,
  type MemoryBudgetDecision,
  type RateLimitState,
} from "./memory-runtime-budget.js";
import { BackgroundRunCoordinator } from "./background-run-coordinator.js";
import { MemoryBackgroundJobScheduler } from "./memory-background-job-scheduler.js";
import {
  buildMemoryRuntimeDoctorReport,
  getDurableExtractionAvailability,
} from "./memory-runtime-introspection.js";
import { buildExtensionGovernanceReport } from "./extension-governance.js";
import { loadExtensionMarketplaceState } from "./extension-marketplace-state.js";
import { buildExtensionRuntimeReport } from "./extension-runtime.js";
import { compileOutputSchema } from "./coding-run/output-schema.js";
import type { ExtensionHostState } from "./extension-host.js";
import { handleMessageSendWithQueryRuntime, MessageSendConfigurationError } from "./query-runtime-message-send.js";
import {
  applyTimelineProjectionFilter,
  applyTranscriptExportProjection,
  normalizeConversationIdPrefix,
  normalizeTimelineKinds,
  normalizeTranscriptEventTypes,
  normalizeTranscriptRestoreView,
  parsePositiveInteger,
} from "./conversation-debug-projection.js";
import { listRecentConversationExports } from "./conversation-export-index.js";
import {
  loadConversationPromptSnapshotArtifact,
  type ConversationPromptSnapshotArtifact,
} from "./conversation-prompt-snapshot.js";
import { buildAgentRoster } from "./query-runtime-agent-roster.js";
import { ensureResidentAgentSession } from "./query-runtime-agent-sessions.js";
import { buildLearningReviewNudgeRuntimeReport } from "./learning-review-nudge-runtime.js";
import { buildLearningReviewInput } from "./learning-review-input.js";
import { buildDeploymentBackendsDoctorReport, ensureDeploymentBackendsConfig } from "./deployment-backends.js";
import { buildMindProfileSnapshot } from "./mind-profile-snapshot.js";
import { buildResidentAgentObservabilitySnapshot } from "./resident-agent-observability.js";
import { resolveResidentStateBindingViewForAgent } from "./resident-state-binding.js";
import { buildAgentLaunchExplainability } from "./agent-launch-explainability.js";
import type { RuntimeResilienceDoctorReport } from "./runtime-resilience.js";
import { QueryRuntimeTraceStore } from "./query-runtime-trace.js";
import {
  RuntimeResourceObservability,
  type RuntimeResourceQueueSnapshot,
} from "./runtime-resource-observability.js";
import { ResidentConversationStore } from "./resident-conversation-store.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";
import { notifyConversationToolEvent } from "./query-runtime-side-effects.js";
import { buildDelegationObservabilitySnapshot } from "./subtask-result-envelope.js";
import { getToolAuditRuntimeResourceQueueSnapshots } from "./tool-audit-runtime-resource.js";
import type { ToolExecutor, TranscribeOptions, TranscribeResult, SkillRegistry, WorkflowRuntimeCapabilities } from "@belldandy/skills";
import type { ToolExecutionRuntimeContext } from "@belldandy/skills";
import { getCommandJobRuntime, listToolContractsV2, TOOL_SETTINGS_CONTROL_NAME } from "@belldandy/skills";
import type { PluginRegistry } from "@belldandy/plugins";
import type { WebhookConfig, IdempotencyManager } from "./webhook/index.js";
import type { GoalManager } from "./goals/manager.js";
import { ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";
import { autoRunResidentAgent as executeResidentAutoRun } from "./resident-auto-run.js";
import { handleAgentsSystemMethod } from "./server-methods/agents-system.js";
import { handleCronRuntimeMethod } from "./server-methods/cron-runtime.js";
import { handleModelsConfigMethod } from "./server-methods/models-config.js";
import { handleQueryRuntimeDomainsMethod } from "./server-methods/query-runtime-domains.js";
import { handleConfigChannelMethod } from "./server-methods/config-channel.js";
import { suppressConfigFileRestart } from "./config-restart-guard.js";
import { areAllConfigKeysHotReload } from "./config-hot-reload.js";
import { handleGoalMethod } from "./server-methods/goals.js";
import { handleMemoryExperienceMethod } from "./server-methods/memory-experience.js";
import { handleMessageSendMethod } from "./server-methods/message-send.js";
import { handleDreamMethod } from "./server-methods/dreams.js";
import { ObsidianCommonsRuntime } from "./obsidian-commons-runtime.js";
import { buildGatewayHttpRoutesContext } from "./server-http-runtime.js";
import { registerGatewayHttpRoutes } from "./server-http-routes.js";
import {
  createGatewayWebSocketRequestHandler,
  type GatewayWebSocketRequestContext,
} from "./server-websocket-dispatch.js";
import {
  createGatewayWebSocketRuntime,
  sendGatewayEvent,
} from "./server-websocket-runtime.js";
import { handleSystemDoctorMethod } from "./server-methods/system-doctor.js";
import { handleWorkspaceConversationMethod } from "./server-methods/workspace-conversation.js";
import { handleWorkspaceRevisionMethod } from "./server-methods/workspace-revision.js";
import { handleWorkspaceWorktreeMethod } from "./server-methods/workspace-worktree.js";
import { handleRemoteDeliveryMethod } from "./server-methods/remote-delivery.js";
import { handleExtensionRuntimeMethod } from "./server-methods/extension-runtime.js";
import { handleCodingRunMethod } from "./server-methods/coding-run.js";
import { handleCommandJobMethod } from "./server-methods/command-job.js";
import { handleCodingRunSubscriptionMethod } from "./server-methods/coding-run-subscription.js";
import { createCodingRunGatewayEventBroker, type CodingRunGatewayEventBroker } from "./coding-run/gateway-event-broker.js";
import {
  CodingRunReconciliationJournal,
  type CodingRunReconciliationJournalOwner,
} from "./coding-run/reconciliation-journal.js";
import type { PendingToolPermissionRuntime } from "./coding-run/pending-tool-permission-runtime.js";
import { handleWorkflowMethod } from "./server-methods/workflow.js";
import { buildChannelSecurityDoctorReport } from "./channel-security-doctor.js";
import {
  getChannelReplyChunkingConfigContent,
  parseChannelReplyChunkingConfigContent,
  writeChannelReplyChunkingConfig,
} from "./channel-reply-chunking-store.js";
import {
  approveChannelSecurityApprovalRequest,
  getChannelSecurityConfigContent,
  parseChannelSecurityConfigContent,
  readChannelSecurityApprovalStore,
  rejectChannelSecurityApprovalRequest,
  writeChannelSecurityConfig,
} from "./channel-security-store.js";
import { buildExternalOutboundDoctorReport, type ExternalOutboundDoctorReport } from "./external-outbound-doctor.js";
import { normalizePreferredProviderIds } from "./provider-model-catalog.js";
import type { ChannelSecurityApprovalRequestInput } from "@belldandy/channels";
import type { BackgroundContinuationRuntimeDoctorReport } from "./background-continuation-runtime.js";
import type { CronRuntimeDoctorReport } from "./cron/observability.js";
import { ConversationRunRegistry } from "./conversation-run-registry.js";
import type { WorkspaceChangeReviewRuntime } from "./workspace-change-review.js";
import type { WorkspaceRevisionRuntime } from "./workspace-revision.js";
import type { UserWorktreeRuntime } from "./user-worktree-runtime.js";
import type { RemoteDeliveryRuntime } from "./remote-delivery-runtime.js";
import {
  GatewayShutdownCoordinator,
  type GatewayShutdownRequest,
  type GatewayShutdownResult,
} from "./gateway-shutdown-coordinator.js";
import {
  type GatewayShutdownResources,
  registerGatewayShutdownResources,
} from "./gateway-shutdown-resources.js";
import {
  createGatewayServerIntakeGate,
  createGatewayTransportCloser,
  registerGatewayServerShutdownResources,
  throwOnGatewayServerShutdownFailure,
} from "./gateway-server-shutdown.js";
import {
  TopLevelConversationLifecycle,
  type TopLevelConversationLifecycleSnapshot,
} from "./top-level-conversation-lifecycle.js";

export type GatewayServerOptions = {
  port: number;
  host?: string; // [NEW] Allow binding to specific host
  auth: {
    mode: "none" | "token" | "password";
    token?: string;
    password?: string;
  };
  webRoot: string;
  envDir?: string;
  envSource?: EnvDirSource;
  stateDir?: string;
  additionalWorkspaceRoots?: string[];
  agentFactory?: () => BelldandyAgent;
  /** Multi-Agent registry (takes precedence over agentFactory when agentId is specified) */
  agentRegistry?: AgentRegistry;
  /** 主模型配置（用于 models.list 返回默认模型） */
  primaryModelConfig?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    protocol?: string;
    wireApi?: string;
    thinking?: Record<string, unknown>;
    reasoningEffort?: string;
    options?: Record<string, unknown>;
    requestBodyExtras?: Record<string, unknown>;
  };
  /** 备用模型配置（来自 models.json） */
  modelFallbacks?: ModelProfile[];
  /** provider 排序偏好（来自 env/config） */
  preferredProviderIds?: string[];
  /** models.json 的实际路径（支持自定义配置文件） */
  modelConfigPath?: string;
  conversationStoreOptions?: { maxHistory?: number; ttlSeconds?: number };
  conversationStore?: ConversationStore; // [NEW] Allow passing shared instance
  conversationRunRegistry?: ConversationRunRegistry;
  /** Conversation coding-run v1 事件的有界投影；不保存领域状态。 */
  codingRunEventBroker?: CodingRunGatewayEventBroker;
  /** Conversation tool side effect 的脱敏 append-only journal。 */
  codingRunReconciliationJournal?: CodingRunReconciliationJournalOwner;
  /** confirm 工具调用的 worker-scoped pending permission 真源。 */
  pendingToolPermissionRuntime?: PendingToolPermissionRuntime;
  topLevelConversationLifecycle?: TopLevelConversationLifecycle;
  topLevelConversationLifecycleOptions?: ConstructorParameters<typeof TopLevelConversationLifecycle>[0];
  getCompactionRuntimeReport?: () => CompactionRuntimeReport | undefined;
  getRuntimeResilienceReport?: () => RuntimeResilienceDoctorReport | undefined;
  onActivity?: () => void;
  /** 可选：统一 Logger，未提供时使用 console */
  logger?: BelldandyLogger;
  /** Server-side auto TTS: check if TTS mode is enabled */
  ttsEnabled?: () => boolean;
  /** Server-side auto TTS: synthesize speech from text */
  ttsSynthesize?: (text: string) => Promise<{ webPath: string; htmlAudio: string } | null>;
  /** 调用设置管理器 */
  toolsConfigManager?: ToolsConfigManager;
  /** 工具执行器（用于获取已注册工具列表） */
  toolExecutor?: ToolExecutor;
  /** 工具调用设置确认存储 */
  toolControlConfirmationStore?: ToolControlConfirmationStore;
  /** 外部渠道外发确认存储 */
  externalOutboundConfirmationStore?: ExternalOutboundConfirmationStore;
  /** 外部渠道外发 sender registry */
  externalOutboundSenderRegistry?: ExternalOutboundSenderRegistry;
  /** 外部渠道外发审计存储 */
  externalOutboundAuditStore?: ExternalOutboundAuditStore;
  /** 邮件外发确认存储 */
  emailOutboundConfirmationStore?: EmailOutboundConfirmationStore;
  /** 邮件外发 provider registry */
  emailOutboundProviderRegistry?: EmailOutboundProviderRegistry;
  /** 邮件外发审计存储 */
  emailOutboundAuditStore?: EmailOutboundAuditStore;
  /** 邮件收信审计存储 */
  emailInboundAuditStore?: EmailInboundAuditStore;
  /** 邮件跟进提醒存储 */
  emailFollowUpReminderStore?: EmailFollowUpReminderStore;
  /** 获取 Agent 工具控制模式 */
  getAgentToolControlMode?: () => "disabled" | "confirm" | "auto";
  /** 获取 Agent 工具控制确认密码 */
  getAgentToolControlConfirmPassword?: () => string | undefined;
  /** STT implementation: transcribe speech from audio buffer */
  sttTranscribe?: (opts: TranscribeOptions) => Promise<TranscribeResult | null>;
  /** 插件注册表（用于获取已加载插件列表） */
  pluginRegistry?: PluginRegistry;
  /** 扩展宿主快照（用于统一 extension runtime / lifecycle 诊断） */
  extensionHost?: Pick<ExtensionHostState, "extensionRuntime" | "lifecycle" | "extensionRuntimeSupervisor">;
  /** 可选：检查当前是否已配置好 AI 模型（用于 hello-ok 中告知前端是否需要引导配置）*/
  isConfigured?: () => boolean;
  /** 启动阶段观测钩子（只读） */
  startupObservability?: {
    onFirstStaticWebRequest?: (input: {
      timestampMs: number;
      method: string;
      path: string;
      userAgent?: string | null;
      referer?: string | null;
    }) => void;
    onFirstBootstrapAssetRequest?: (input: {
      timestampMs: number;
      method: string;
      path: string;
      userAgent?: string | null;
      referer?: string | null;
    }) => void;
    onFirstWebSocketConnection?: (input: { timestampMs: number; remoteAddress?: string | null }) => void;
    onFirstAuthenticatedWebSocket?: (input: { timestampMs: number; clientId: string }) => void;
    onInvalidTokenClose?: (input: { timestampMs: number; reason?: string | null; remoteAddress?: string | null }) => void;
  };
  /** 技能注册表（用于获取已加载技能列表） */
  skillRegistry?: SkillRegistry;
  /** Prompt dump / inspect 能力 */
  inspectAgentPrompt?: (input: {
    agentId?: string;
    conversationId?: string;
    runId?: string;
  }) => Promise<{
    scope?: "agent" | "run";
    agentId: string;
    displayName?: string;
    model?: string;
    conversationId?: string;
    runId?: string;
    createdAt?: number;
    text: string;
    truncated: boolean;
    maxChars?: number;
    totalChars: number;
    finalChars: number;
    sections: Array<SystemPromptSection & { charLength: number; estimatedChars: number; estimatedTokens: number }>;
    droppedSections: Array<SystemPromptSection & { charLength: number; estimatedChars: number; estimatedTokens: number }>;
    deltas?: Array<AgentPromptDelta & { charLength: number; estimatedChars: number; estimatedTokens: number }>;
    providerNativeSystemBlocks?: Array<ProviderNativeSystemBlock & { charLength: number; estimatedChars: number; estimatedTokens: number }>;
    messages?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }>;
  getConversationPromptSnapshot?: (input: {
    conversationId: string;
    runId?: string;
  }) => Promise<ConversationPromptSnapshotArtifact | undefined>;
  /** 长期任务管理器 */
  goalManager?: GoalManager;
  /** 子任务运行时存储 */
  subTaskRuntimeStore?: SubTaskRuntimeStore;
  /** 子任务 resume / continuation 控制 */
  resumeSubTask?: (
    taskId: string,
    message?: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  /** 子任务 takeover 控制 */
  takeoverSubTask?: (
    taskId: string,
    agentId: string,
    message?: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  /** 子任务 steering / update 控制 */
  updateSubTask?: (
    taskId: string,
    message: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  /** 子任务停止控制 */
  stopSubTask?: (
    taskId: string,
    reason?: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>;
  /** 动态工作流运行时（由 Gateway 装配后注入） */
  workflowRuntime?: WorkflowRuntimeCapabilities;
  /** 受控文件工具的用户轮次恢复点运行时。 */
  workspaceRevisionRuntime?: WorkspaceRevisionRuntime;
  /** 只读的 restore 后变更审查重判运行时。 */
  workspaceChangeReviewRuntime?: WorkspaceChangeReviewRuntime;
  /** 用户级受管 worktree 的只读状态投影。 */
  userWorktreeRuntime?: UserWorktreeRuntime;
  /** receipt-bound remote push / pull request owner。 */
  remoteDeliveryRuntime?: RemoteDeliveryRuntime;
  /** Commander 模式（"on" | "off" | "auto"），用于 chat commander 显式触发判定 */
  commanderMode?: "on" | "off" | "auto";
  /** 发送前附件/长输入压缩策略。 */
  preflightCompressionPolicy?: PreflightCompressionPolicy;
  /** Gateway tool_result 事件的字符串 output 投影上限；默认 500，硬上限 2048。 */
  toolResultEventOutputCharLimit?: number;
  /** Webhook 配置 */
  webhookConfig?: WebhookConfig;
  /** Webhook 幂等性管理器 */
  webhookIdempotency?: IdempotencyManager;
  /** Resident MemoryManager 组装记录 */
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  /** Gateway 统一 Memory usage owner；直接启动 server 时保留内部 fallback。 */
  memoryUsageAccounting?: MemoryRuntimeUsageAccounting;
  /** 与 memoryUsageAccounting 配套的共享预算 guard。 */
  memoryBudgetGuard?: MemoryRuntimeBudgetGuard;
  /** Dream/summary/extraction 共用的后台模型调度 owner。 */
  memoryBackgroundJobScheduler?: MemoryBackgroundJobScheduler;
  /** Dream/summary/extraction 共用的 private_summary policy 与无正文观测 owner。 */
  memoryModelPrivacyRuntime?: MemoryModelPrivacyRuntime;
  /** Cron 运行态观测摘要 */
  getCronRuntimeDoctorReport?: () => Promise<CronRuntimeDoctorReport | undefined>;
  /** Background continuation runtime 摘要 */
  getBackgroundContinuationRuntimeDoctorReport?: () => Promise<BackgroundContinuationRuntimeDoctorReport | undefined>;
  /** 由 Gateway 装配层提供的额外运行队列数值快照。 */
  getRuntimeResourceQueueSnapshots?: () => RuntimeResourceQueueSnapshot[];
  /** Cron runtime immediate run */
  runCronJobNow?: (jobId: string) => Promise<{
    runId?: string;
    status: "ok" | "error" | "skipped";
    summary?: string;
    reason?: string;
  }>;
  /** Cron runtime targeted recovery */
  runCronRecovery?: (jobId: string) => Promise<{
    outcome: "succeeded" | "failed" | "throttled" | "skipped_not_eligible";
    sourceRunId?: string;
    recoveryRunId?: string;
    reason?: string;
  }>;
  /** 当 community/http 等入口命中 DM allowlist 阻断时记录待审批 sender */
  onChannelSecurityApprovalRequired?: (input: ChannelSecurityApprovalRequestInput) => void | Promise<void>;
  /** 由 Gateway 入口 owner 安排 countdown，并在响应返回后请求统一关闭。 */
  requestSystemRestart?: (reason: string) => void;
};

export type GatewayServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
  requestShutdown: (request: GatewayShutdownRequest) => Promise<GatewayShutdownResult>;
  registerShutdownResources: (resources: GatewayShutdownResources) => void;
  broadcast: (frame: GatewayEventFrame) => void;
  isResidentAgentBusy: (agentId?: string) => boolean;
  autoRunResidentAgent: (input: {
    agentId?: string;
    conversationId?: string;
    text: string;
    visibleReminder?: string;
    skipRun?: boolean;
    userUuid?: string;
    requestChannel?: "gateway";
  }) => Promise<{
    conversationId: string;
    runId: string;
  }>;
  resolveDreamRuntime: (agentId?: string) => DreamRuntime | null;
  resolveDreamDefaultConversationId: (agentId?: string) => string;
  requestDurableExtractionFromDigest: (input: {
    conversationId: string;
    source: string;
    threshold?: number;
    force?: boolean;
  }) => Promise<void>;
  getTopLevelConversationLifecycleSnapshot: () => TopLevelConversationLifecycleSnapshot;
};

type GatewayLog = {
  debug: (module: string, message: string, data?: unknown) => void;
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

type ToolVisibilityPayload = {
  available: boolean;
  reasonCode: string;
  reasonMessage: string;
  alwaysEnabled?: boolean;
  contractReason?: string;
};

class MemoryBudgetExceededError extends Error {
  readonly decision: MemoryBudgetDecision;

  constructor(decision: MemoryBudgetDecision) {
    super(decision.reasonMessage || "Memory runtime budget exceeded.");
    this.name = "MemoryBudgetExceededError";
    this.decision = decision;
  }
}

function summarizeGroupedVisibility(entries: ToolVisibilityPayload[]): ToolVisibilityPayload {
  if (entries.length === 0) {
    return {
      available: true,
      reasonCode: "available",
      reasonMessage: "",
    };
  }
  if (entries.some((item) => item.available)) {
    return {
      available: true,
      reasonCode: "available",
      reasonMessage: "",
    };
  }
  const first = entries[0];
  const uniqueReasonCodes = [...new Set(entries.map((item) => item.reasonCode).filter(Boolean))];
  if (uniqueReasonCodes.length === 1) {
    return {
      available: false,
      reasonCode: first.reasonCode,
      reasonMessage: first.reasonMessage,
    };
  }
  return {
    available: false,
    reasonCode: "blocked-by-security-matrix",
    reasonMessage: `All tools in this group are currently unavailable: ${uniqueReasonCodes.join(", ")}`,
  };
}

const DEFAULT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const DEFAULT_ATTACHMENT_TEXT_CHAR_LIMIT = 200_000;
const DEFAULT_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT = 200_000;
const DEFAULT_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT = 12_000;

type AttachmentLimits = {
  maxFileBytes: number;
  maxTotalBytes: number;
};

type AttachmentPromptLimits = {
  textCharLimit: number;
  totalTextCharLimit: number;
  audioTranscriptAppendCharLimit: number;
};

function isUnderRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, path.resolve(target));
  return !(rel.startsWith("..") || path.isAbsolute(rel));
}

function parsePositiveIntEnv(varName: string, fallback: number): number {
  const raw = process.env[varName];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOptionalPositiveIntEnv(varName: string): number | undefined {
  const raw = process.env[varName];
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function readEnvTrimmed(varName: string): string | undefined {
  const raw = process.env[varName];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function parseThinkingConfigFromEnv(varName: string): Record<string, unknown> | undefined {
  const raw = readEnvTrimmed(varName);
  if (!raw) return undefined;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      const record = parsed as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type.trim() : "";
      if (!type) return undefined;
      return {
        ...record,
        type,
      };
    } catch {
      return undefined;
    }
  }
  return { type: raw };
}

function shouldDisableDreamThinkingByDefault(input: {
  primaryThinking?: Record<string, unknown>;
}): boolean {
  const type = typeof input.primaryThinking?.type === "string"
    ? input.primaryThinking.type.trim().toLowerCase()
    : "";
  return type === "enabled";
}

function buildDurableExtractionUnavailableError(
  durableExtractionRuntime?: DurableExtractionRuntime,
): { code: string; message: string } {
  const availability = getDurableExtractionAvailability(durableExtractionRuntime);
  if (availability.available) {
    return {
      code: "not_available",
      message: "Durable extraction runtime is not available.",
    };
  }
  const code = availability.reasonCodes[0] ?? "not_available";
  const detail = availability.reasonMessages.join(" ");
  return {
    code,
    message: detail
      ? `Durable extraction runtime is not available. ${detail}`
      : "Durable extraction runtime is not available.",
  };
}

function formatRateLimitState(rateLimit: RateLimitState): string {
  if (!rateLimit.configured) {
    return "unlimited";
  }
  const base = `${rateLimit.observedRuns}/${rateLimit.maxRuns} in ${rateLimit.windowMs}ms`;
  if (rateLimit.status === "limited") {
    return `${base}, retryAfter=${rateLimit.retryAfterMs ?? 0}ms`;
  }
  return base;
}

function getAttachmentLimits(): AttachmentLimits {
  return {
    maxFileBytes: parsePositiveIntEnv("BELLDANDY_ATTACHMENT_MAX_FILE_BYTES", DEFAULT_ATTACHMENT_MAX_FILE_BYTES),
    maxTotalBytes: parsePositiveIntEnv("BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES", DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES),
  };
}

function getAttachmentPromptLimits(): AttachmentPromptLimits {
  return {
    textCharLimit: parsePositiveIntEnv("BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT", DEFAULT_ATTACHMENT_TEXT_CHAR_LIMIT),
    totalTextCharLimit: parsePositiveIntEnv("BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT", DEFAULT_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT),
    audioTranscriptAppendCharLimit: parsePositiveIntEnv("BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT", DEFAULT_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT),
  };
}

function truncateTextForPrompt(text: string, limit: number, suffix: string): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  if (limit <= 0) {
    return { text: "", truncated: true };
  }
  if (limit <= suffix.length) {
    return { text: text.slice(0, limit), truncated: true };
  }
  return {
    text: `${text.slice(0, Math.max(0, limit - suffix.length))}${suffix}`,
    truncated: true,
  };
}

function estimateBase64DecodedBytes(base64: string): number | null {
  const normalized = base64.trim().replace(/\s+/g, "");
  if (!normalized) return 0;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  if (normalized.length % 4 !== 0) return null;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, (normalized.length / 4) * 3 - padding);
}

async function statIfExists(targetPath: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function hasTranscriptExportArtifacts(bundle: SessionTranscriptExportBundle | undefined): boolean {
  if (!bundle) {
    return false;
  }
  return bundle.summary.eventCount > 0 || bundle.restore.rawMessages.length > 0;
}

function hasTimelineArtifacts(timeline: SessionTimelineProjection | undefined): boolean {
  if (!timeline) {
    return false;
  }
  return timeline.summary.eventCount > 0
    || timeline.summary.messageCount > 0
    || timeline.items.some((item) => item.kind !== "restore_result");
}

function mergeEnvContentIntoConfig(raw: string, config: Record<string, string>): void {
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        config[key] = val;
      }
    }
  });
}

async function readEnvFileIntoConfig(filePath: string, config: Record<string, string>): Promise<void> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    mergeEnvContentIntoConfig(raw, config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return;
    }
  }
}

async function writeTextFileAtomic(filePath: string, content: string, options: { ensureParent?: boolean; mode?: number } = {}): Promise<void> {
  if (options.ensureParent) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: options.mode });
  }
  const tmpFile = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmpFile, content, "utf-8");
  await fsp.rename(tmpFile, filePath);
}

async function writeBinaryFileAtomic(filePath: string, content: Buffer, options: { ensureParent?: boolean; mode?: number } = {}): Promise<void> {
  if (options.ensureParent) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: options.mode });
  }
  const tmpFile = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmpFile, content);
  await fsp.rename(tmpFile, filePath);
}

async function updateEnvFile(filePath: string, changes: Record<string, string>): Promise<boolean> {
  if (Object.keys(changes).length === 0) return true;

  let lines: string[] = [];
  try {
    lines = (await fsp.readFile(filePath, "utf-8")).split(/\r?\n/);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      return false;
    }
  }

  const newKeys = new Set(Object.keys(changes));
  const nextLines: string[] = [];
  const handledKeys = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    let matched = false;
    if (trimmed && !trimmed.startsWith("#")) {
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        if (newKeys.has(key)) {
          nextLines.push(`${key}="${changes[key]}"`);
          handledKeys.add(key);
          matched = true;
        }
      }
    }
    if (!matched) nextLines.push(line);
  }

  for (const key of newKeys) {
    if (!handledKeys.has(key)) {
      if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") nextLines.push("");
      nextLines.push(`${key}="${changes[key]}"`);
    }
  }

  if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") nextLines.push("");

  try {
    await writeTextFileAtomic(filePath, nextLines.join("\n"), { ensureParent: true });
    return true;
  } catch {
    return false;
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalMessageTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const hours = Math.floor(absOffset / 60);
  const minutes = absOffset % 60;
  const offsetText = minutes > 0 ? `GMT${sign}${hours}:${pad2(minutes)}` : `GMT${sign}${hours}`;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${offsetText}`;
}

function toChatMessageMeta(timestampMs: number, isLatest = false): ChatMessageMeta {
  return {
    timestampMs,
    displayTimeText: formatLocalMessageTime(timestampMs),
    isLatest,
  };
}

export async function startGatewayServer(opts: GatewayServerOptions): Promise<GatewayServer> {
  const methodRegistryErrors = validateGatewayMethodRegistry();
  if (methodRegistryErrors.length > 0) {
    throw new Error(`Gateway method registry is invalid: ${methodRegistryErrors.join("; ")}`);
  }
  await ensureWebRoot(opts.webRoot);
  const stateDir = opts.stateDir ?? resolveStateDir();
  const toolResultEventOutputCharLimit = resolveToolResultEventOutputCharLimit(
    opts.toolResultEventOutputCharLimit,
  );
  const avatarDir = path.join(stateDir, "avatar");
  const runtimePreferredProviderIds = Array.isArray(opts.preferredProviderIds)
    ? opts.preferredProviderIds
    : [];
  const governanceDetailModeState: { value: "compact" | "full" } = {
    value: String(process.env.BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE ?? "").trim().toLowerCase() === "full" ? "full" : "compact",
  };
  const getRuntimeGovernanceDetailMode = (): "compact" | "full" => governanceDetailModeState.value;
  const setRuntimeGovernanceDetailMode = (value: string | undefined): void => {
    governanceDetailModeState.value = value === "full" ? "full" : "compact";
    process.env.BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE = governanceDetailModeState.value;
  };
  const getConversationPromptSnapshot = opts.getConversationPromptSnapshot
    ?? (async ({ conversationId, runId }: { conversationId: string; runId?: string }) => {
      return loadConversationPromptSnapshotArtifact({
        stateDir,
        conversationId,
        runId,
      });
    });

  const log: GatewayLog = opts.logger
    ? {
      debug: (m: string, msg: string, d?: unknown) => opts.logger!.debug(m, msg, d),
      info: (m: string, msg: string, d?: unknown) => opts.logger!.info(m, msg, d),
      warn: (m: string, msg: string, d?: unknown) => opts.logger!.warn(m, msg, d),
      error: (m: string, msg: string, d?: unknown) => opts.logger!.error(m, msg, d),
    }
    : {
      debug: () => { },
      info: (m: string, msg: string) => console.log(`[${m}] ${msg}`),
      warn: (m: string, msg: string, d?: unknown) => console.warn(`[${m}] ${msg}`, d ?? ""),
      error: (m: string, msg: string, d?: unknown) => console.error(`[${m}] ${msg}`, d ?? ""),
    };

  const app = express();
  const intakeGate = createGatewayServerIntakeGate();
  app.use((_req, res, next) => {
    const rejection = intakeGate.getHttpRejection();
    if (!rejection) {
      next();
      return;
    }
    res.status(rejection.statusCode).json(rejection.body);
  });
  const tokenUsageUploadConfig = readTokenUsageUploadConfig((name) => process.env[name]);

  await registerGatewayHttpRoutes(buildGatewayHttpRoutesContext({
    app,
    stateDir,
    log,
    options: {
      auth: opts.auth,
      webRoot: opts.webRoot,
      stateDir: opts.stateDir,
      agentFactory: opts.agentFactory,
      agentRegistry: opts.agentRegistry,
      webhookConfig: opts.webhookConfig,
      webhookIdempotency: opts.webhookIdempotency,
      onChannelSecurityApprovalRequired: opts.onChannelSecurityApprovalRequired,
      startupObservability: opts.startupObservability,
    },
    getConversationStore: () => conversationStore,
    getTopLevelConversationLifecycle: () => topLevelConversationLifecycle,
    getQueryRuntimeTraceStore: () => queryRuntimeTraceStore,
    getGovernanceDetailMode: getRuntimeGovernanceDetailMode,
    setGovernanceDetailMode: setRuntimeGovernanceDetailMode,
    writeBinaryFileAtomic,
    writeTextFileAtomic,
    emitAutoRunTaskTokenResult,
  }));

  const server = http.createServer(app);
  const trackedSockets = new Set<Socket>();
  server.on("connection", (socket) => {
    trackedSockets.add(socket);
    socket.on("close", () => {
      trackedSockets.delete(socket);
    });
  });
  const host = opts.host ?? "127.0.0.1"; // Default to localhost for security

  // 初始化会话存储
  const sessionsDir = path.join(stateDir, "sessions");

  // Ensure sessions dir exists
  await fsp.mkdir(sessionsDir, { recursive: true });
  await fsp.mkdir(avatarDir, { recursive: true });
  await ensureDeploymentBackendsConfig(stateDir);

  const conversationStore = opts.conversationStore ?? new ResidentConversationStore({
    ...opts.conversationStoreOptions,
    stateDir,
    agentRegistry: opts.agentRegistry,
  });
  (opts.toolExecutor as (ToolExecutor & {
    setConversationStore?: (conversationStore?: ConversationStore) => void;
  }) | undefined)?.setConversationStore?.(conversationStore);
  const residentAgentRuntime = new ResidentAgentRuntimeRegistry(
    opts.agentRegistry?.list().filter((profile) => isResidentAgentProfile(profile)).map((profile) => profile.id) ?? ["default"],
  );
  const conversationRunRegistry = opts.conversationRunRegistry ?? new ConversationRunRegistry();
  const codingRunReconciliationJournal = opts.codingRunReconciliationJournal
    ?? new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: opts.subTaskRuntimeStore,
      workspaceMutationEvidenceStore: opts.workspaceRevisionRuntime,
    });
  const codingRunEventBroker = opts.codingRunEventBroker ?? createCodingRunGatewayEventBroker({
    reconciliationJournal: codingRunReconciliationJournal,
  });
  const topLevelConversationLifecycle = opts.topLevelConversationLifecycle
    ?? new TopLevelConversationLifecycle(opts.topLevelConversationLifecycleOptions);
  const memoryUsageAccounting = opts.memoryUsageAccounting ?? new MemoryRuntimeUsageAccounting({
      stateDir,
      logger: {
        warn: (message, data) => log.warn("memory-usage", message, data),
      },
    });
  await memoryUsageAccounting.load();
  const memoryBudgetGuard = opts.memoryBudgetGuard ?? MemoryRuntimeBudgetGuard.fromEnv(memoryUsageAccounting);
  const memoryBackgroundJobScheduler = opts.memoryBackgroundJobScheduler ?? new MemoryBackgroundJobScheduler({
    runCoordinator: new BackgroundRunCoordinator({
      getForegroundActiveCount: () => conversationRunRegistry.getRuntimeSnapshot().activeCount,
    }),
    budgetGuard: memoryBudgetGuard,
    usageAccounting: memoryUsageAccounting,
  });
  const memoryModelPrivacyRuntime = opts.memoryModelPrivacyRuntime ?? MemoryModelPrivacyRuntime.fromEnv();
  const durableExtractionRequestRateLimiter = new SlidingWindowRateLimiter(
    parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS"),
    parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS") ?? 60 * 60 * 1_000,
  );
  const queryRuntimeTraceStore = new QueryRuntimeTraceStore();
  (opts.toolExecutor as (ToolExecutor & {
    setBroadcastObserver?: (
      observer?: (event: string, payload: Record<string, unknown>, meta: {
        conversationId: string;
        agentId?: string;
        toolName: string;
      }) => void,
    ) => void;
  }) | undefined)?.setBroadcastObserver?.((event: string, payload: Record<string, unknown>, meta: {
    conversationId: string;
    agentId?: string;
    toolName: string;
  }) => {
    notifyConversationToolEvent(meta.conversationId, {
      event,
      toolName: meta.toolName,
      agentId: meta.agentId,
      source: payload.source,
      mode: payload.mode,
    });
  });

  const durableExtractionManager = getGlobalMemoryManager();
  const durableExtractionRuntime = durableExtractionManager
    ? new DurableExtractionRuntime({
      stateDir,
      extractor: createDurableExtractionSurface({
        get isPaused() {
          return durableExtractionManager.isPaused;
        },
        extractMemoriesFromConversation(sessionKey, messages, options) {
          const scopedManager = getGlobalMemoryManager({
            conversationId: options?.sourceConversationId ?? sessionKey,
          }) ?? durableExtractionManager;
          return scopedManager.extractMemoriesFromConversation(sessionKey, messages, options);
        },
        isConversationMemoryExtractionEnabled() {
          return durableExtractionManager.isConversationMemoryExtractionEnabled();
        },
        getConversationMemoryExtractionSupport() {
          return durableExtractionManager.getConversationMemoryExtractionSupport();
        },
        getDurableMemoryGuidance() {
          return durableExtractionManager.getDurableMemoryGuidance();
        },
      }),
      getMessages: async (conversationId) => {
        return conversationStore.getCanonicalExtractionView(conversationId);
      },
      getDigest: async (conversationId) => {
        const digest = await conversationStore.getSessionDigest(conversationId);
        return toDurableExtractionDigestSnapshot(digest);
      },
      minPendingMessages: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_PENDING_MESSAGES"),
      minMessageDelta: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_MESSAGE_DELTA"),
      successCooldownMs: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_SUCCESS_COOLDOWN_MS"),
      failureBackoffMs: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MS"),
      failureBackoffMaxMs: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MAX_MS"),
      inputLimits: {
        maxMessages: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGES"),
        maxMessageBytes: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGE_BYTES"),
        maxAggregateBytes: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_INPUT_BYTES"),
      },
      closeDeadlineMs: parseOptionalPositiveIntEnv("BELLDANDY_MEMORY_DURABLE_EXTRACTION_CLOSE_DEADLINE_MS"),
      acquireJob: ({ conversationId, estimatedTokenUnits, signal }) => {
        const agentId = /^agent:([^:]+):/u.exec(conversationId.trim())?.[1] ?? "default";
        return memoryBackgroundJobScheduler.acquire({
          family: "durable_extraction",
          agentId,
          priority: "normal",
          estimatedTokenUnits,
          signal,
        });
      },
      canStartRun: async (event) => {
        const decision = await memoryBudgetGuard.evaluateDurableExtractionRun();
        if (!decision.allowed) {
          const usageEvent = {
            consumer: "durable_extraction_run",
            outcome: "blocked",
            timestamp: Date.now(),
            conversationId: event.conversationId,
            source: event.source,
            metadata: {
              extractionKey: event.extractionKey,
              digestAt: event.digestAt,
              messageCount: event.messageCount,
              threshold: event.threshold,
              digestStatus: event.digestStatus,
              runCount: event.projectedRunCount,
              reasonCode: decision.reasonCode,
              reasonMessage: decision.reasonMessage,
              retryAfterMs: decision.retryAfterMs,
              observedRuns: decision.observedRuns,
              maxRuns: decision.maxRuns,
              windowMs: decision.windowMs,
            },
          } as const;
          memoryBudgetGuard.noteEvent(usageEvent);
          await memoryUsageAccounting.recordEvent(usageEvent);
          return {
            allowed: false,
            reason: decision.reasonCode ?? "durable_extraction_run_budget_exceeded",
            retryAfterMs: decision.retryAfterMs,
          };
        }
        return { allowed: true };
      },
      onRunStarted: async (event) => {
        const usageEvent = {
          consumer: "durable_extraction_run",
          outcome: "started",
          timestamp: Date.now(),
          conversationId: event.conversationId,
          source: event.source,
          metadata: {
            extractionKey: event.extractionKey,
            digestAt: event.digestAt,
            messageCount: event.messageCount,
            threshold: event.threshold,
            digestStatus: event.digestStatus,
            runCount: event.projectedRunCount,
          },
        } as const;
        memoryBudgetGuard.noteEvent(usageEvent);
        await memoryUsageAccounting.recordEvent(usageEvent);
      },
      onRunFinished: async (event) => {
        const usageEvent = {
          consumer: "durable_extraction_run",
          outcome: event.failure ? "failed" : "completed",
          timestamp: Date.now(),
          conversationId: event.conversationId,
          source: event.source,
          quantity: event.extractedCount,
          metadata: {
            extractionKey: event.extractionKey,
            digestAt: event.digestAt,
            messageCount: event.messageCount,
            threshold: event.threshold,
            digestStatus: event.digestStatus,
            runCount: event.runCount,
            failure: event.failure,
          },
        } as const;
        memoryBudgetGuard.noteEvent(usageEvent);
        await memoryUsageAccounting.recordEvent(usageEvent);
      },
      logger: {
        debug: (message, data) => log.debug("durable-extraction", message, data),
        warn: (message, data) => log.warn("durable-extraction", message, data),
        error: (message, data) => log.error("durable-extraction", message, data),
      },
    })
    : undefined;
  await durableExtractionRuntime?.load();

  const requestDurableExtraction = async (input: {
    conversationId: string;
    source: string;
    digest: DurableExtractionDigestSnapshot;
  }): Promise<DurableExtractionRecord | undefined> => {
    if (!durableExtractionRuntime?.isAvailable()) {
      return undefined;
    }
    const decision = durableExtractionRequestRateLimiter.evaluate(
      DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_CODE,
      DURABLE_EXTRACTION_REQUEST_RATE_LIMIT_REASON_MESSAGE,
    );
    if (!decision.allowed) {
      const usageEvent = {
        consumer: "durable_extraction_request",
        outcome: "blocked",
        timestamp: Date.now(),
        conversationId: input.conversationId,
        source: input.source,
        metadata: {
          digestAt: input.digest.lastDigestAt,
          messageCount: input.digest.messageCount,
          threshold: input.digest.threshold,
          digestStatus: input.digest.status,
          reasonCode: decision.reasonCode,
          reasonMessage: decision.reasonMessage,
          retryAfterMs: decision.retryAfterMs,
          observedRuns: decision.observedRuns,
          maxRuns: decision.maxRuns,
          windowMs: decision.windowMs,
        },
      } as const;
      memoryBudgetGuard.noteEvent(usageEvent);
      await memoryUsageAccounting.recordEvent(usageEvent);
      return durableExtractionRuntime.getRecord(input.conversationId);
    }
    const record = await durableExtractionRuntime.requestExtraction(input);
    const requestEvent = {
      consumer: "durable_extraction_request",
      outcome: record.status === "queued" || record.pending ? "queued" : "skipped",
      timestamp: Date.now(),
      conversationId: input.conversationId,
      source: input.source,
      metadata: {
        digestAt: input.digest.lastDigestAt,
        messageCount: input.digest.messageCount,
        threshold: input.digest.threshold,
        digestStatus: input.digest.status,
        status: record.status,
        pending: record.pending,
        lastSkipReason: record.lastSkipReason,
      },
    } as const;
    memoryBudgetGuard.noteEvent(requestEvent);
    await memoryUsageAccounting.recordEvent(requestEvent);
    if (record.status === "queued" || record.pending) {
      durableExtractionRequestRateLimiter.note();
    }
    return record;
  };

  const dreamRuntimeCache = new Map<string, DreamRuntime>();
  const dreamObsidianMirrorEnabled = String(process.env.BELLDANDY_DREAM_OBSIDIAN_ENABLED ?? "false").trim().toLowerCase() === "true";
  const dreamObsidianMirrorVaultPath = readEnvTrimmed("BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH");
  const dreamObsidianMirrorRootDir = readEnvTrimmed("BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR");
  const dreamOpenAIThinking = parseThinkingConfigFromEnv("BELLDANDY_DREAM_OPENAI_THINKING");
  const dreamOpenAIReasoningEffort = readEnvTrimmed("BELLDANDY_DREAM_OPENAI_REASONING_EFFORT");
  const dreamOpenAITimeoutMs = parsePositiveIntEnv("BELLDANDY_DREAM_OPENAI_TIMEOUT_MS", 120_000);
  const dreamOpenAIMaxTokens = parsePositiveIntEnv("BELLDANDY_DREAM_OPENAI_MAX_TOKENS", 1_000);
  const commonsObsidianEnabled = String(
    process.env.BELLDANDY_COMMONS_OBSIDIAN_ENABLED
    ?? process.env.BELLDANDY_DREAM_OBSIDIAN_ENABLED
    ?? "false",
  ).trim().toLowerCase() === "true";
  const commonsObsidianVaultPath = readEnvTrimmed("BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH") ?? dreamObsidianMirrorVaultPath;
  const commonsObsidianRootDir = readEnvTrimmed("BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR") ?? dreamObsidianMirrorRootDir;
  let commonsExportRuntime: ObsidianCommonsRuntime | null | undefined;

  const normalizeDreamAgentId = (agentId?: string): string => {
    const normalized = typeof agentId === "string" ? agentId.trim() : "";
    return normalized || "default";
  };

  const resolveDreamDefaultConversationId = (agentId?: string): string => {
    const runtimeRecord = residentAgentRuntime.ensureMainConversation(normalizeDreamAgentId(agentId));
    return runtimeRecord.lastConversationId || runtimeRecord.mainConversationId;
  };

  const resolveDreamRuntime = (agentId?: string): DreamRuntime | null => {
    const resolvedAgentId = normalizeDreamAgentId(agentId);
    const cached = dreamRuntimeCache.get(resolvedAgentId);
    if (cached) {
      return cached;
    }

    const managerRecord = opts.residentMemoryManagers?.find((item) => item.agentId === resolvedAgentId);
    const fallbackConversationId = resolveDreamDefaultConversationId(resolvedAgentId);
    const manager = managerRecord?.manager
      ?? getGlobalMemoryManager({
        agentId: resolvedAgentId,
        conversationId: fallbackConversationId,
      })
      ?? getGlobalMemoryManager();
    if (!manager) {
      return null;
    }

    const dreamStateDir = managerRecord?.stateDir ?? stateDir;
    const dreamThinking = dreamOpenAIThinking
      ?? (shouldDisableDreamThinkingByDefault({
        primaryThinking: opts.primaryModelConfig?.thinking,
      })
        ? { type: "disabled" }
        : undefined);
    const runtime = new DreamRuntime({
      stateDir: dreamStateDir,
      agentId: resolvedAgentId,
      model: opts.primaryModelConfig?.model,
      baseUrl: opts.primaryModelConfig?.baseUrl,
      apiKey: opts.primaryModelConfig?.apiKey,
      thinking: dreamThinking,
      reasoningEffort: dreamOpenAIReasoningEffort,
      maxTokens: dreamOpenAIMaxTokens,
      timeoutMs: dreamOpenAITimeoutMs,
      modelPrivacyRuntime: memoryModelPrivacyRuntime,
      obsidianMirror: {
        enabled: dreamObsidianMirrorEnabled,
        vaultPath: dreamObsidianMirrorVaultPath,
        rootDir: dreamObsidianMirrorRootDir,
      },
      buildInputSnapshot: async ({ agentId: runtimeAgentId, conversationId, now }) => {
        const resolvedConversationId = conversationId || resolveDreamDefaultConversationId(runtimeAgentId);
        const roster = opts.agentRegistry
          ? await buildAgentRoster({
            stateDir,
            agentRegistry: opts.agentRegistry,
            residentAgentRuntime,
          })
          : [];
        const residentAgents = roster.length > 0 && (opts.residentMemoryManagers?.length ?? 0) > 0
          ? await buildResidentAgentObservabilitySnapshot({
            agents: roster,
            residentMemoryManagers: opts.residentMemoryManagers,
            conversationStore,
          })
          : undefined;
        const mindProfileSnapshot = await buildMindProfileSnapshot({
          stateDir,
          residentAgents,
          residentMemoryManagers: opts.residentMemoryManagers,
          agentId: runtimeAgentId,
        });
        return buildDreamInputSnapshot({
          agentId: runtimeAgentId,
          conversationId: resolvedConversationId,
          stateDir: dreamStateDir,
          now,
          memoryManager: manager,
          buildMindProfileSnapshot: async () => mindProfileSnapshot,
          buildLearningReviewInput: async ({ focusTask, mindProfileSnapshot: dreamMindProfileSnapshot }) => buildLearningReviewInput({
            mindProfileSnapshot: (dreamMindProfileSnapshot ?? mindProfileSnapshot) as any,
            taskExperienceDetail: focusTask,
          }),
          getSessionDigest: async (targetConversationId) => {
            const digest = await conversationStore.getSessionDigest(targetConversationId);
            return {
              conversationId: digest.conversationId,
              status: digest.status,
              messageCount: digest.messageCount,
              digestedMessageCount: digest.digestedMessageCount,
              pendingMessageCount: digest.pendingMessageCount,
              threshold: digest.threshold,
              rollingSummary: digest.rollingSummary,
              archivalSummary: digest.archivalSummary,
              lastDigestAt: digest.lastDigestAt,
              digestGeneration: digest.digestGeneration,
            };
          },
          getSessionMemory: async (targetConversationId) => {
            const sessionMemory = await conversationStore.getSessionMemory(targetConversationId);
            return {
              conversationId: sessionMemory.conversationId,
              summary: sessionMemory.summary,
              currentGoal: sessionMemory.currentGoal,
              decisions: sessionMemory.decisions,
              keyResults: sessionMemory.keyResults,
              filesTouched: sessionMemory.filesTouched,
              errorsAndFixes: sessionMemory.errorsAndFixes,
              pendingTasks: sessionMemory.pendingTasks,
              currentWork: sessionMemory.currentWork,
              nextStep: sessionMemory.nextStep,
              lastSummarizedMessageCount: sessionMemory.lastSummarizedMessageCount,
              lastSummarizedToolCursor: sessionMemory.lastSummarizedToolCursor,
              updatedAt: sessionMemory.updatedAt,
            };
          },
          getTaskChangeSeq: () => manager.getTaskChangeSeq(),
          getMemoryChangeSeq: () => manager.getMemoryChangeSeq(),
        });
      },
      logger: {
        debug: (message, data) => log.debug("dream-runtime", message, data),
        warn: (message, data) => log.warn("dream-runtime", message, data),
        error: (message, data) => log.error("dream-runtime", message, data),
      },
      profileStateDelegate: {
        upsertProfileStateEntry: (input) => manager.upsertProfileStateEntry(input),
      },
    });
    dreamRuntimeCache.set(resolvedAgentId, runtime);
    return runtime;
  };

  const resolveCommonsExportRuntime = (): ObsidianCommonsRuntime | null => {
    if (commonsExportRuntime !== undefined) {
      return commonsExportRuntime;
    }
    if ((opts.residentMemoryManagers?.length ?? 0) <= 0) {
      commonsExportRuntime = null;
      return commonsExportRuntime;
    }
    commonsExportRuntime = new ObsidianCommonsRuntime({
      stateDir,
      residentMemoryManagers: opts.residentMemoryManagers,
      mirror: {
        enabled: commonsObsidianEnabled,
        vaultPath: commonsObsidianVaultPath,
        rootDir: commonsObsidianRootDir,
      },
      logger: {
        debug: (message, data) => log.debug("commons-export", message, data),
        warn: (message, data) => log.warn("commons-export", message, data),
        error: (message, data) => log.error("commons-export", message, data),
      },
    });
    return commonsExportRuntime;
  };

  let broadcastEvent: ((frame: GatewayEventFrame) => void) | undefined;
  let websocketRuntime: ReturnType<typeof createGatewayWebSocketRuntime> | undefined;
  const runtimeResourceObservability = new RuntimeResourceObservability({
    enabled: String(process.env.BELLDANDY_RUNTIME_RESOURCE_OBSERVABILITY_ENABLED ?? "true").trim().toLowerCase() !== "false",
    sampleIntervalMs: parsePositiveIntEnv("BELLDANDY_RUNTIME_RESOURCE_SAMPLE_INTERVAL_MS", 15_000),
    maxSamples: parsePositiveIntEnv("BELLDANDY_RUNTIME_RESOURCE_MAX_SAMPLES", 24),
    eventLoopDelayResolutionMs: parsePositiveIntEnv("BELLDANDY_RUNTIME_RESOURCE_EVENT_LOOP_RESOLUTION_MS", 20),
    queueProviders: [
      () => opts.getRuntimeResourceQueueSnapshots?.() ?? [],
      () => [getTokenUsageUploadRuntimeSnapshot()],
      () => {
        const snapshot = durableExtractionRuntime?.getRuntimeSnapshot();
        return snapshot ? [{ id: "durable_extraction", ...snapshot }] : [];
      },
      () => {
        const stats = opts.webhookIdempotency?.getStats();
        return stats ? [{ id: "webhook_idempotency", activeCount: stats.inflight, queuedCount: 0 }] : [];
      },
      () => {
        const snapshot = websocketRuntime?.getRuntimeSnapshot();
        return snapshot ? [{ id: "websocket", queuedCount: 0, ...snapshot }] : [];
      },
      () => {
        const snapshot = topLevelConversationLifecycle.getRuntimeSnapshot();
        return [{
          id: "top_level_conversation_lifecycle",
          activeCount: snapshot.activeLeaseCount,
          queuedCount: snapshot.pendingReleaseCount,
          retainedCount: snapshot.retainedConversationCount,
          evictedCount: snapshot.evictedCount,
          failureCount: snapshot.releaseFailureCount,
          oldestAgeMs: snapshot.oldestIdleAgeMs,
        }];
      },
      () => getToolAuditRuntimeResourceQueueSnapshots(opts.toolExecutor),
    ],
  });
  const handleWebSocketRequest = createGatewayWebSocketRequestHandler({
    stateDir,
    additionalWorkspaceRoots: opts.additionalWorkspaceRoots ?? [],
    envDir: opts.envDir,
    envSource: opts.envSource,
    auth: opts.auth,
    log,
    agentFactory: opts.agentFactory ?? (() => new MockAgent()),
    agentRegistry: opts.agentRegistry,
    inspectAgentPrompt: opts.inspectAgentPrompt,
    getConversationPromptSnapshot,
    primaryModelConfig: opts.primaryModelConfig,
    modelFallbacks: opts.modelFallbacks,
    preferredProviderIds: runtimePreferredProviderIds,
    modelConfigPath: opts.modelConfigPath,
    conversationStore,
    conversationRunRegistry,
    codingRunEventBroker,
    codingRunReconciliationJournal,
    pendingToolPermissionRuntime: opts.pendingToolPermissionRuntime,
    topLevelConversationLifecycle,
    durableExtractionRuntime,
    resolveDreamRuntime,
    resolveDreamDefaultConversationId,
    resolveCommonsExportRuntime,
    requestDurableExtraction,
    memoryUsageAccounting,
    memoryBudgetGuard,
    memoryBackgroundJobScheduler,
    memoryModelPrivacyRuntime,
    durableExtractionRequestRateLimiter,
    ttsEnabled: opts.ttsEnabled,
    ttsSynthesize: opts.ttsSynthesize,
    toolsConfigManager: opts.toolsConfigManager,
    toolExecutor: opts.toolExecutor,
    toolControlConfirmationStore: opts.toolControlConfirmationStore,
    externalOutboundConfirmationStore: opts.externalOutboundConfirmationStore,
    externalOutboundSenderRegistry: opts.externalOutboundSenderRegistry,
    externalOutboundAuditStore: opts.externalOutboundAuditStore,
    emailOutboundConfirmationStore: opts.emailOutboundConfirmationStore,
    emailOutboundProviderRegistry: opts.emailOutboundProviderRegistry,
    emailOutboundAuditStore: opts.emailOutboundAuditStore,
    emailInboundAuditStore: opts.emailInboundAuditStore,
    emailFollowUpReminderStore: opts.emailFollowUpReminderStore,
    getAgentToolControlMode: opts.getAgentToolControlMode,
    getAgentToolControlConfirmPassword: opts.getAgentToolControlConfirmPassword,
    sttTranscribe: opts.sttTranscribe,
    pluginRegistry: opts.pluginRegistry,
    extensionHost: opts.extensionHost,
    skillRegistry: opts.skillRegistry,
    goalManager: opts.goalManager,
    subTaskRuntimeStore: opts.subTaskRuntimeStore,
    resumeSubTask: opts.resumeSubTask,
    takeoverSubTask: opts.takeoverSubTask,
    updateSubTask: opts.updateSubTask,
    stopSubTask: opts.stopSubTask,
    workflowRuntime: opts.workflowRuntime,
    workspaceRevisionRuntime: opts.workspaceRevisionRuntime,
    workspaceChangeReviewRuntime: opts.workspaceChangeReviewRuntime,
    userWorktreeRuntime: opts.userWorktreeRuntime,
    remoteDeliveryRuntime: opts.remoteDeliveryRuntime,
    commanderMode: opts.commanderMode,
    preflightCompressionPolicy: opts.preflightCompressionPolicy,
    toolResultEventOutputCharLimit,
    tokenUsageUploadConfig,
    broadcast: (frame) => broadcastEvent?.(frame),
    broadcastEvent: (frame) => broadcastEvent?.(frame),
    requestSystemRestart: opts.requestSystemRestart,
    getCompactionRuntimeReport: opts.getCompactionRuntimeReport,
    getRuntimeResilienceReport: opts.getRuntimeResilienceReport,
    queryRuntimeTraceStore,
    runtimeResourceObservability,
    residentAgentRuntime,
    residentMemoryManagers: opts.residentMemoryManagers,
    getCronRuntimeDoctorReport: opts.getCronRuntimeDoctorReport,
    getBackgroundContinuationRuntimeDoctorReport: opts.getBackgroundContinuationRuntimeDoctorReport,
    runCronJobNow: opts.runCronJobNow,
    runCronRecovery: opts.runCronRecovery,
    getGovernanceDetailMode: getRuntimeGovernanceDetailMode,
    setGovernanceDetailMode: setRuntimeGovernanceDetailMode,
    handleReq,
  });
  websocketRuntime = createGatewayWebSocketRuntime({
    server,
    host,
    stateDir,
    auth: opts.auth,
    log,
    onActivity: opts.onActivity,
    isConfigured: opts.isConfigured,
    startupObservability: opts.startupObservability,
    onRequest: (ws, frame, connection) => {
      const rejection = intakeGate.getGatewayRejection(frame.id);
      return rejection
        ? Promise.resolve(rejection)
        : handleWebSocketRequest(ws, frame, connection);
    },
  });
  runtimeResourceObservability.start();
  broadcastEvent = websocketRuntime.broadcast;
  (opts.toolExecutor as (ToolExecutor & {
    setBroadcast?: (
      broadcast?: (event: string, payload: Record<string, unknown>) => void,
    ) => void;
    setBroadcastObserver?: (
      observer?: (event: string, payload: Record<string, unknown>, meta: {
        conversationId: string;
        agentId?: string;
        toolName: string;
      }) => void,
    ) => void;
  }) | undefined)?.setBroadcast?.((event: string, payload: Record<string, unknown>) => {
    broadcastEvent?.({
      type: "event",
      event,
      payload,
    });
  });
  const detachSubTaskBroadcast = opts.subTaskRuntimeStore?.subscribe((event) => {
    broadcastEvent?.({
      type: "event",
      event: "subtask.update",
      payload: {
        kind: event.kind,
        item: event.item,
      },
    });
  });

  // MemoryManager is now created and registered globally by gateway.ts (unified instance)
  // No need to create a separate instance here.
  const detachDurableExtractionBroadcast = durableExtractionRuntime?.subscribe((event) => {
    broadcastEvent?.({
      type: "event",
      event: "conversation.memory.extraction.updated",
      payload: {
        conversationId: event.record.conversationId,
        extraction: event.record,
      },
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port, host, resolve));

  const address = server.address();
  const port =
    typeof address === "object" && address && "port" in address ? Number(address.port) : opts.port;
  const requestDurableExtractionFromDigest = async (input: {
    conversationId: string;
    source: string;
    threshold?: number;
    force?: boolean;
  }): Promise<void> => {
    if (!durableExtractionRuntime?.isAvailable()) {
      return;
    }
    try {
      await refreshConversationDigestAndBroadcast(
        conversationStore,
        {
          conversationId: input.conversationId,
          source: input.source,
          threshold: input.threshold,
          force: input.force === true,
        },
        undefined,
        durableExtractionRuntime,
        requestDurableExtraction,
        memoryUsageAccounting,
        memoryBudgetGuard,
        false,
      );
    } catch (error) {
      if (!(error instanceof MemoryBudgetExceededError)) {
        throw error;
      }
      log.warn("memory-evolution", "Session digest refresh budget exceeded during durable extraction scheduling; reusing current digest snapshot", {
        conversationId: input.conversationId,
        source: input.source,
        retryAfterMs: error.decision.retryAfterMs,
        observedRuns: error.decision.observedRuns,
        maxRuns: error.decision.maxRuns,
        windowMs: error.decision.windowMs,
      });
    }
    const digest = await conversationStore.getSessionDigest(input.conversationId, { threshold: input.threshold });
    await (requestDurableExtraction ?? durableExtractionRuntime.requestExtraction.bind(durableExtractionRuntime))({
      conversationId: input.conversationId,
      source: input.source,
      digest: toDurableExtractionDigestSnapshot(digest),
    });
  };

  const autoRunResidentAgent: GatewayServer["autoRunResidentAgent"] = async (input) => {
    return executeResidentAutoRun({
      ...input,
      createAgent: opts.agentFactory ?? (() => new MockAgent()),
      agentRegistry: opts.agentRegistry,
      conversationStore,
      conversationRunRegistry,
      residentAgentRuntime,
      topLevelConversationLifecycle,
      broadcast: broadcastEvent,
      log,
    });
  };

  const isResidentAgentBusy: GatewayServer["isResidentAgentBusy"] = (agentId) => {
    const runtime = residentAgentRuntime.get(agentId);
    return runtime.status === "running" || runtime.status === "background";
  };

  const shutdownCoordinator = new GatewayShutdownCoordinator();
  const closeTransport = createGatewayTransportCloser({
    server,
    trackedSockets,
    closeWebSockets: () => websocketRuntime?.close() ?? Promise.resolve(),
  });
  registerGatewayServerShutdownResources(shutdownCoordinator, {
    stopIntake: () => {
      intakeGate.stop();
      conversationRunRegistry.stopAccepting();
    },
    abortActiveRuns: () => conversationRunRegistry.requestStopAll("gateway_shutdown"),
    drainActiveRuns: (signal) => conversationRunRegistry.waitForIdle(signal),
    disposeTopLevelConversations: () => topLevelConversationLifecycle.dispose(),
    closeDurableExtraction: () => durableExtractionRuntime?.close(),
    flushConversationState: () => conversationStore.waitForAllPendingPersistence(),
    flushSubTaskState: () => opts.subTaskRuntimeStore?.flushAndClose(),
    flushMemoryUsage: () => memoryUsageAccounting.flush(),
    drainTokenUsage: (signal) => drainTokenUsageUploads(signal),
    detachRuntimeHooks: () => {
      detachSubTaskBroadcast?.();
      detachDurableExtractionBroadcast?.();
      runtimeResourceObservability.stop();
    },
    closeTransport,
  });
  const close = async (): Promise<void> => {
    const result = await shutdownCoordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    throwOnGatewayServerShutdownFailure(result);
  };

  return {
    port,
    host,
    close,
    requestShutdown: (request) => shutdownCoordinator.requestShutdown(request),
    registerShutdownResources: (resources) => registerGatewayShutdownResources(shutdownCoordinator, resources),
    broadcast: broadcastEvent,
    isResidentAgentBusy,
    autoRunResidentAgent,
    resolveDreamRuntime,
    resolveDreamDefaultConversationId,
    requestDurableExtractionFromDigest,
    getTopLevelConversationLifecycleSnapshot: () => topLevelConversationLifecycle.getRuntimeSnapshot(),
  };
}

function emitAutoRunTaskTokenResult(
  conversationStore: ConversationStore,
  payload: {
    conversationId: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    inputCostUsd?: number;
    outputCostUsd?: number;
    totalCostUsd?: number;
  },
  ws?: WebSocket,
): void {
  const result = {
    name: "run",
    inputTokens: Math.max(0, Number(payload.inputTokens ?? 0)),
    outputTokens: Math.max(0, Number(payload.outputTokens ?? 0)),
    totalTokens: Math.max(0, Number(payload.inputTokens ?? 0) + Number(payload.outputTokens ?? 0)),
    durationMs: Math.max(0, Number(payload.durationMs ?? 0)),
    ...(typeof payload.inputCostUsd === "number" ? { inputCostUsd: Math.max(0, payload.inputCostUsd) } : {}),
    ...(typeof payload.outputCostUsd === "number" ? { outputCostUsd: Math.max(0, payload.outputCostUsd) } : {}),
    ...(typeof payload.totalCostUsd === "number" ? { totalCostUsd: Math.max(0, payload.totalCostUsd) } : {}),
    auto: true,
  };
  conversationStore.recordTaskTokenResult(payload.conversationId, result);
  if (!ws) return;
  sendGatewayEvent(ws, {
    type: "event",
    event: "token.counter.result",
    payload: {
      conversationId: payload.conversationId,
      ...result,
    },
  });
}

async function refreshConversationDigestAndBroadcast(
  conversationStore: ConversationStore,
  payload: {
    conversationId: string;
    force?: boolean;
    threshold?: number;
    source: string;
  },
  broadcastEvent?: (frame: GatewayEventFrame) => void,
  durableExtractionRuntime?: DurableExtractionRuntime,
  requestDurableExtraction?: (input: {
    conversationId: string;
    source: string;
    digest: DurableExtractionDigestSnapshot;
  }) => Promise<DurableExtractionRecord | undefined>,
  memoryUsageAccounting?: MemoryRuntimeUsageAccounting,
  memoryBudgetGuard?: MemoryRuntimeBudgetGuard,
  scheduleDurableExtraction = true,
): Promise<{
  digest: Awaited<ReturnType<ConversationStore["refreshSessionDigest"]>>["digest"];
  updated: boolean;
  compacted: boolean;
  originalTokens?: number;
  compactedTokens?: number;
  tier?: string;
}> {
  const decision = await memoryBudgetGuard?.evaluateSessionDigestRefresh();
  if (decision && !decision.allowed) {
    const usageEvent = {
      consumer: "session_digest_refresh",
      outcome: "blocked",
      timestamp: Date.now(),
      conversationId: payload.conversationId,
      source: payload.source,
      metadata: {
        reasonCode: decision.reasonCode,
        reasonMessage: decision.reasonMessage,
        retryAfterMs: decision.retryAfterMs,
        observedRuns: decision.observedRuns,
        maxRuns: decision.maxRuns,
        windowMs: decision.windowMs,
      },
    } as const;
    memoryBudgetGuard?.noteEvent(usageEvent);
    await memoryUsageAccounting?.recordEvent(usageEvent);
    throw new MemoryBudgetExceededError(decision);
  }

  const result = await conversationStore.refreshSessionDigest(payload.conversationId, {
    force: payload.force === true,
    threshold: payload.threshold,
  });
  const usageEvent = {
    consumer: "session_digest_refresh",
    outcome: result.updated ? "completed" : "skipped",
    timestamp: Date.now(),
    conversationId: payload.conversationId,
    source: payload.source,
    metadata: {
      threshold: payload.threshold,
      force: payload.force === true,
      compacted: result.compacted,
      originalTokens: result.originalTokens,
      compactedTokens: result.compactedTokens,
      tier: result.tier,
      digestStatus: result.digest.status,
      digestLastDigestAt: result.digest.lastDigestAt,
      messageCount: result.digest.messageCount,
      pendingMessageCount: result.digest.pendingMessageCount,
    },
  } as const;
  memoryBudgetGuard?.noteEvent(usageEvent);
  await memoryUsageAccounting?.recordEvent(usageEvent);
  broadcastEvent?.({
    type: "event",
    event: "conversation.digest.updated",
    payload: {
      conversationId: payload.conversationId,
      source: payload.source,
      updated: result.updated,
      compacted: result.compacted,
      originalTokens: result.originalTokens,
      compactedTokens: result.compactedTokens,
      tier: result.tier,
      digest: result.digest,
    },
  });
  if (scheduleDurableExtraction && result.updated && durableExtractionRuntime?.isAvailable()) {
    void (requestDurableExtraction ?? durableExtractionRuntime.requestExtraction.bind(durableExtractionRuntime))({
      conversationId: payload.conversationId,
      source: payload.source,
      digest: toDurableExtractionDigestSnapshot(result.digest),
    }).catch(() => {
      // keep digest refresh non-blocking even if extraction scheduling fails
    });
  }
  return result;
}

function toDurableExtractionDigestSnapshot(
  digest: Awaited<ReturnType<ConversationStore["getSessionDigest"]>>,
): DurableExtractionDigestSnapshot {
  return {
    status: digest.status,
    threshold: digest.threshold,
    messageCount: digest.messageCount,
    digestedMessageCount: digest.digestedMessageCount,
    pendingMessageCount: digest.pendingMessageCount,
    lastDigestAt: digest.lastDigestAt,
  };
}

async function handleReq(
  ws: WebSocket,
  req: GatewayReqFrame,
  ctx: GatewayWebSocketRequestContext,
): Promise<GatewayResFrame | null> {
  const methodPolicy = getGatewayMethodPolicy(req.method);
  const paired = methodPolicy?.requiresPairing === true
    ? await isClientAllowed({ clientId: ctx.clientId, stateDir: ctx.stateDir })
    : false;
  const admission = admitGatewayRequest({
    method: req.method,
    identity: {
      subjectId: ctx.clientId,
      role: ctx.role,
      authenticated: ctx.authenticated,
      paired,
      capabilities: paired ? getPairedGatewayCapabilities() : [],
    },
  });
  if (!admission.allowed) {
    if (admission.error.code === "pairing_required") {
      const pairing = await ensurePairingCode({ clientId: ctx.clientId, stateDir: ctx.stateDir });
      ctx.log.debug("gateway-security", "Secure method rejected because client is not paired", {
        clientId: ctx.clientId,
        method: req.method,
        pairingCode: pairing.code,
      });
      sendGatewayEvent(ws, {
        type: "event",
        event: "pairing.required",
        payload: {
          clientId: ctx.clientId,
          code: pairing.code,
          message: "pairing required: approve this code to allow messages",
        },
      });
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: admission.error.code, message: `Pairing required. Code: ${pairing.code}` },
      };
    }

    ctx.log.debug("gateway-security", "Gateway request rejected by admission", {
      clientId: ctx.clientId,
      method: req.method,
      reason: admission.error.code,
    });
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: admission.error,
    };
  }

  const queryRuntimeDomainsContext = {
    clientId: ctx.clientId,
    requestChannel: ctx.requestChannel,
    stateDir: ctx.stateDir,
    agentRegistry: ctx.agentRegistry,
    residentAgentRuntime: ctx.residentAgentRuntime,
    queryRuntimeTraceStore: ctx.queryRuntimeTraceStore,
    toolExecutor: ctx.toolExecutor,
    toolsConfigManager: ctx.toolsConfigManager,
    toolControlConfirmationStore: ctx.toolControlConfirmationStore,
    getAgentToolControlMode: ctx.getAgentToolControlMode,
    getAgentToolControlConfirmPassword: ctx.getAgentToolControlConfirmPassword,
    pluginRegistry: ctx.pluginRegistry,
    extensionHost: ctx.extensionHost,
    skillRegistry: ctx.skillRegistry,
    subTaskRuntimeStore: ctx.subTaskRuntimeStore,
    getConversationPromptSnapshot: ctx.getConversationPromptSnapshot,
    resumeSubTask: ctx.resumeSubTask,
    takeoverSubTask: ctx.takeoverSubTask,
    updateSubTask: ctx.updateSubTask,
    stopSubTask: ctx.stopSubTask,
    externalOutboundConfirmationStore: ctx.externalOutboundConfirmationStore,
    externalOutboundSenderRegistry: ctx.externalOutboundSenderRegistry,
    externalOutboundAuditStore: ctx.externalOutboundAuditStore,
    emailOutboundConfirmationStore: ctx.emailOutboundConfirmationStore,
    emailOutboundProviderRegistry: ctx.emailOutboundProviderRegistry,
    emailOutboundAuditStore: ctx.emailOutboundAuditStore,
    emailInboundAuditStore: ctx.emailInboundAuditStore,
    emailFollowUpReminderStore: ctx.emailFollowUpReminderStore,
    emitEvent: (frame: GatewayEventFrame) => {
      if (ctx.broadcastEvent) {
        ctx.broadcastEvent(frame);
      } else {
        sendGatewayEvent(ws, frame);
      }
    },
    parseToolSettingsConfirmParams,
    parseExternalOutboundConfirmParams,
    parseEmailOutboundConfirmParams,
    resolvePendingToolControlRequest,
    applyToolControlChanges: (
      disabled: {
        builtin: string[];
        mcp_servers: string[];
        plugins: string[];
        skills?: string[];
      },
      changes: unknown,
    ) => ({
      ...applyToolControlChanges({
        builtin: disabled.builtin,
        mcp_servers: disabled.mcp_servers,
        plugins: disabled.plugins,
        skills: Array.isArray(disabled.skills) ? disabled.skills : [],
      }, changes as Parameters<typeof applyToolControlChanges>[1]),
      skills: Array.isArray(disabled.skills) ? disabled.skills : [],
    }),
    buildToolControlDisabledPayload: (disabled: {
      builtin: string[];
      mcp_servers: string[];
      plugins: string[];
      skills?: string[];
    }) => buildToolControlDisabledPayload({
      builtin: disabled.builtin,
      mcp_servers: disabled.mcp_servers,
      plugins: disabled.plugins,
      skills: Array.isArray(disabled.skills) ? disabled.skills : [],
    }),
    resolveToolControlPolicySnapshot,
    summarizeGroupedVisibility,
  } as const;

  const agentsSystemMethodContext = {
    stateDir: ctx.stateDir,
    clientId: ctx.clientId,
    log: ctx.log,
    broadcast: ctx.broadcast,
    requestSystemRestart: ctx.requestSystemRestart,
    agentRegistry: ctx.agentRegistry,
    residentAgentRuntime: ctx.residentAgentRuntime,
    residentMemoryManagers: ctx.residentMemoryManagers,
    conversationStore: ctx.conversationStore,
    subTaskRuntimeStore: ctx.subTaskRuntimeStore,
    writeTextFileAtomic,
    inspectAgentPrompt: ctx.inspectAgentPrompt,
  } as const;

  const modelsConfigMethodContext = {
    stateDir: ctx.stateDir,
    primaryModelConfig: ctx.primaryModelConfig,
    modelFallbacks: ctx.modelFallbacks,
    preferredProviderIds: ctx.preferredProviderIds,
    modelConfigPath: ctx.modelConfigPath,
    agentRegistry: ctx.agentRegistry,
    queryRuntimeTraceStore: ctx.queryRuntimeTraceStore,
  } as const;

  switch (req.method) {
    case "pairing.approve": {
      const parsed = parsePairingApproveParams(req.params);
      if (!parsed.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
      }
      const approved = await approvePairingCode({
        code: parsed.value.code,
        stateDir: ctx.stateDir,
      });
      if (!approved.ok) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "pairing_approve_failed", message: approved.message },
        };
      }
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: {
          code: parsed.value.code,
          clientId: approved.clientId,
        },
      };
    }

    case "models.list":
    case "models.config.get":
    case "models.config.update":
      return handleModelsConfigMethod(req, modelsConfigMethodContext);

    case "message.send":
    case "conversation.run.stop": {
      return handleMessageSendMethod(req, ws, {
        clientId: ctx.clientId,
        requestChannel: ctx.requestChannel,
        userUuid: ctx.userUuid,
        stateDir: ctx.stateDir,
        log: ctx.log,
        agentFactory: ctx.agentFactory,
        agentRegistry: ctx.agentRegistry,
        primaryModelConfig: ctx.primaryModelConfig,
        modelFallbacks: ctx.modelFallbacks,
        conversationStore: ctx.conversationStore,
        conversationRunRegistry: ctx.conversationRunRegistry,
        codingRunEventBroker: ctx.codingRunEventBroker,
        topLevelConversationLifecycle: ctx.topLevelConversationLifecycle,
        getConversationPromptSnapshot: ctx.getConversationPromptSnapshot,
        durableExtractionRuntime: ctx.durableExtractionRuntime,
        requestDurableExtraction: ctx.requestDurableExtraction,
        memoryUsageAccounting: ctx.memoryUsageAccounting,
        memoryBudgetGuard: ctx.memoryBudgetGuard,
        ttsEnabled: ctx.ttsEnabled,
        ttsSynthesize: ctx.ttsSynthesize,
        toolControlConfirmationStore: ctx.toolControlConfirmationStore,
        getAgentToolControlMode: ctx.getAgentToolControlMode,
        getAgentToolControlConfirmPassword: ctx.getAgentToolControlConfirmPassword,
        sttTranscribe: ctx.sttTranscribe,
        tokenUsageUploadConfig: ctx.tokenUsageUploadConfig,
        broadcastEvent: ctx.broadcastEvent,
        queryRuntimeTraceStore: ctx.queryRuntimeTraceStore,
        residentAgentRuntime: ctx.residentAgentRuntime,
        toolResultEventOutputCharLimit: ctx.toolResultEventOutputCharLimit,
        parseMessageSendParams,
        parseConversationRunStopParams,
        getAttachmentPromptLimits,
        truncateTextForPrompt,
        formatLocalMessageTime,
        toChatMessageMeta,
        emitAutoRunTaskTokenResult,
        refreshConversationDigestAndBroadcast,
      });
    }

    case "tool_settings.confirm":
    case "external_outbound.confirm":
    case "external_outbound.audit.list":
    case "email_outbound.confirm":
    case "email_outbound.audit.list":
    case "email_inbound.audit.list":
    case "email_followup.list": {
      return handleQueryRuntimeDomainsMethod(req, queryRuntimeDomainsContext);
    }

    case "config.read":
    case "config.update":
    case "channel.reply_chunking.get":
    case "channel.reply_chunking.update":
    case "channel.security.get":
    case "channel.security.update":
    case "channel.security.pending.list":
    case "channel.security.approve":
    case "channel.security.reject":
    case "config.readRaw":
    case "config.writeRaw": {
      return handleConfigChannelMethod(req, {
        envDir: ctx.envDir,
        auth: ctx.auth,
        stateDir: ctx.stateDir,
        preferredProviderIds: ctx.preferredProviderIds,
        statIfExists,
        readEnvFileIntoConfig,
        updateEnvFile,
        onConfigUpdating: (updates) => {
          if (areAllConfigKeysHotReload(Object.keys(updates))) {
            suppressConfigFileRestart(".env");
            suppressConfigFileRestart(".env.local");
          }
        },
        onConfigUpdated: (updates) => {
          if (Object.prototype.hasOwnProperty.call(updates, "BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE")) {
            ctx.setGovernanceDetailMode?.(updates.BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE);
          }
        },
        writeTextFileAtomic,
      });
    }

    case "tools.list":
    case "tools.update":
    case "agent.catalog.get":
    case "agent.contracts.get":
    case "delegation.inspect.get": {
      return handleQueryRuntimeDomainsMethod(req, queryRuntimeDomainsContext);
    }

    case "system.restart":
    case "agent.create":
    case "agents.list":
    case "agents.roster.get":
    case "agent.session.ensure":
    case "agents.prompt.inspect":
      return handleAgentsSystemMethod(req, agentsSystemMethodContext);

    case "system.doctor": {
      return handleSystemDoctorMethod(req, {
        stateDir: ctx.stateDir,
        requestChannel: ctx.requestChannel,
        envDir: ctx.envDir,
        envSource: ctx.envSource,
        agentFactory: ctx.agentFactory,
        agentRegistry: ctx.agentRegistry,
        conversationStore: ctx.conversationStore,
        durableExtractionRuntime: ctx.durableExtractionRuntime,
        memoryBudgetGuard: ctx.memoryBudgetGuard,
        memoryModelPrivacyRuntime: ctx.memoryModelPrivacyRuntime,
        durableExtractionRequestRateLimiter: ctx.durableExtractionRequestRateLimiter,
        toolsConfigManager: ctx.toolsConfigManager,
        toolExecutor: ctx.toolExecutor,
        externalOutboundAuditStore: ctx.externalOutboundAuditStore,
        externalOutboundConfirmationStore: ctx.externalOutboundConfirmationStore,
        emailOutboundAuditStore: ctx.emailOutboundAuditStore,
        emailInboundAuditStore: ctx.emailInboundAuditStore,
        emailFollowUpReminderStore: ctx.emailFollowUpReminderStore,
        pluginRegistry: ctx.pluginRegistry,
        extensionHost: ctx.extensionHost,
        skillRegistry: ctx.skillRegistry,
        getCompactionRuntimeReport: ctx.getCompactionRuntimeReport,
        getRuntimeResilienceReport: ctx.getRuntimeResilienceReport,
        queryRuntimeTraceStore: ctx.queryRuntimeTraceStore,
        runtimeResourceObservability: ctx.runtimeResourceObservability,
        residentAgentRuntime: ctx.residentAgentRuntime,
        residentMemoryManagers: ctx.residentMemoryManagers,
        getCronRuntimeDoctorReport: ctx.getCronRuntimeDoctorReport,
        getBackgroundContinuationRuntimeDoctorReport: ctx.getBackgroundContinuationRuntimeDoctorReport,
        resolveDreamRuntime: ctx.resolveDreamRuntime,
        resolveDreamDefaultConversationId: ctx.resolveDreamDefaultConversationId,
        resolveCommonsExportRuntime: ctx.resolveCommonsExportRuntime,
        inspectAgentPrompt: ctx.inspectAgentPrompt,
        subTaskRuntimeStore: ctx.subTaskRuntimeStore,
        goalManager: ctx.goalManager,
        workflowRuntime: ctx.workflowRuntime,
      });
    }

    case "cron.run_now":
    case "cron.recovery.run":
      return handleCronRuntimeMethod(req, {
        runCronJobNow: ctx.runCronJobNow,
        runCronRecovery: ctx.runCronRecovery,
      });

    case "goal.create":
    case "goal.list":
    case "goal.get":
    case "goal.resume":
    case "goal.pause":
    case "goal.handoff.get":
    case "goal.handoff.generate":
    case "goal.retrospect.generate":
    case "goal.experience.suggest":
    case "goal.method_candidates.generate":
    case "goal.skill_candidates.generate":
    case "goal.flow_patterns.generate":
    case "goal.flow_patterns.cross_goal":
    case "goal.review_governance.summary":
    case "goal.capability.get":
    case "goal.capability.update":
    case "goal.capability.commander_decide":
    case "goal.approval.scan":
    case "goal.suggestion_review.list":
    case "goal.suggestion_review.workflow.set":
    case "goal.suggestion_review.decide":
    case "goal.suggestion_review.escalate":
    case "goal.suggestion_review.scan":
    case "goal.suggestion.publish":
    case "goal.checkpoint.list":
    case "goal.archive":
    case "goal.delete":
    case "goal.checkpoint.request":
    case "goal.checkpoint.approve":
    case "goal.checkpoint.reject":
    case "goal.checkpoint.expire":
    case "goal.checkpoint.reopen":
    case "goal.checkpoint.escalate":
    case "goal.task_graph.read":
    case "goal.task_graph.create":
    case "goal.task_graph.update":
    case "goal.task_graph.claim":
    case "goal.task_graph.pending_review":
    case "goal.task_graph.validating":
    case "goal.task_graph.complete":
    case "goal.task_graph.block":
    case "goal.task_graph.fail":
    case "goal.task_graph.skip":
      return handleGoalMethod(req, {
        goalManager: ctx.goalManager,
        stateDir: ctx.stateDir,
        residentMemoryManagers: ctx.residentMemoryManagers,
        readEnv: readEnvTrimmed,
        parseGoalTaskCheckpointStatus,
        parseGoalTaskCreateStatus,
      });

    case "memory.search":
    case "memory.get":
    case "memory.recent":
    case "memory.stats":
    case "memory.configured_sources.get":
    case "memory.configured_sources.update":
    case "memory.inventory.preview":
    case "memory.tree.report.inventory.preview":
    case "memory.tree.report.external_ingest.preview":
    case "memory.tree.report.dedup.preview":
    case "memory.tree.report.shared_governance.preview":
    case "memory.tree.report.list":
    case "memory.tree.report.get":
    case "memory.tree.report.export_markdown":
    case "memory.tree.report.review":
    case "memory.tree.report.apply":
    case "memory.tree.lifecycle.get":
    case "memory.tree.lifecycle.report":
    case "memory.tree.job.report":
    case "memory.tree.lifecycle.ensure":
    case "memory.tree.node.rebuild":
    case "memory.tree.node.list":
    case "memory.tree.node.search":
    case "memory.tree.node.get":
    case "memory.tree.source.rebuild":
    case "memory.tree.source.list":
    case "memory.tree.score.rebuild":
    case "memory.tree.score.list":
    case "memory.dedup.preview":
    case "memory.dedup.apply":
    case "memory.share.queue":
    case "memory.share.promote":
    case "memory.share.review":
    case "memory.share.claim":
    case "memory.task.list":
    case "memory.task.get":
    case "memory.recent_work":
    case "memory.resume_context":
    case "memory.similar_past_work":
    case "memory.explain_sources":
    case "experience.candidate.check_duplicate":
    case "experience.candidate.generate":
    case "experience.candidate.get":
    case "experience.candidate.list":
    case "experience.candidate.stats":
    case "experience.candidate.accept":
    case "experience.candidate.reject":
    case "experience.candidate.reject_bulk":
    case "experience.candidate.cleanup_consumed":
    case "experience.asset.list":
    case "experience.asset.read":
    case "experience.candidate.synthesize.preview":
    case "experience.candidate.synthesize.create":
    case "experience.usage.get":
    case "experience.usage.list":
    case "experience.usage.stats":
    case "experience.usage.revoke":
    case "experience.skill.freshness.update":
      if (
        req.method === "experience.candidate.synthesize.preview"
        || req.method === "experience.candidate.synthesize.create"
      ) {
        ctx.log.info("memory-experience", "Experience synthesis request received", {
          clientId: ctx.clientId,
          method: req.method,
          requestId: req.id,
        });
      } else if (req.method === "experience.candidate.cleanup_consumed") {
        ctx.log.info("memory-experience", "Experience consumed draft cleanup request received", {
          clientId: ctx.clientId,
          method: req.method,
          requestId: req.id,
        });
      }
      return handleMemoryExperienceMethod(req, {
        stateDir: ctx.stateDir,
        residentMemoryManagers: ctx.residentMemoryManagers,
        agentRegistry: ctx.agentRegistry,
        skillRegistry: ctx.skillRegistry,
        teamSharedMemoryEnabled: process.env.BELLDANDY_TEAM_SHARED_MEMORY_ENABLED === "true",
        primaryModelConfig: ctx.primaryModelConfig,
        logger: {
          debug: (message, data) => ctx.log.debug("memory-experience", message, data),
          warn: (message, data) => ctx.log.warn("memory-experience", message, data),
          error: (message, data) => ctx.log.error("memory-experience", message, data),
        },
      });

    case "dream.run":
    case "dream.status.get":
    case "dream.history.list":
    case "dream.get":
    case "dream.consolidation.review":
    case "dream.consolidation.apply":
    case "dream.commons.status.get":
    case "dream.commons.export_now":
      return handleDreamMethod(req, {
        resolveDreamRuntime: ctx.resolveDreamRuntime ?? (() => null),
        resolveDefaultConversationId: ctx.resolveDreamDefaultConversationId ?? (() => "agent:default:main"),
        resolveCommonsExportRuntime: ctx.resolveCommonsExportRuntime ?? (() => null),
        jobScheduler: ctx.memoryBackgroundJobScheduler,
      });

    case "workspace.list":
    case "workspace.read":
    case "workspace.readSource":
    case "workspace.write":
    case "artifact.reveal":
    case "context.compact":
    case "context.compact.partial":
    case "conversation.meta":
    case "conversation.transcript.export":
    case "conversation.timeline.get":
    case "conversation.prompt_snapshot.get":
    case "conversation.preflight_compression.retrieve":
    case "conversation.tool_result_reference.retrieve":
    case "conversation.digest.get":
    case "conversation.digest.refresh":
    case "conversation.memory.extraction.get":
    case "conversation.memory.extract":
    case "conversation.restore": {
      return handleWorkspaceConversationMethod(req, {
        stateDir: ctx.stateDir,
        generatedDir: path.join(ctx.stateDir, "generated"),
        additionalWorkspaceRoots: ctx.additionalWorkspaceRoots,
        conversationStore: ctx.conversationStore,
        getConversationPromptSnapshot: ctx.getConversationPromptSnapshot,
        agentRegistry: ctx.agentRegistry,
        durableExtractionRuntime: ctx.durableExtractionRuntime,
        requestDurableExtraction: ctx.requestDurableExtraction,
        memoryUsageAccounting: ctx.memoryUsageAccounting,
        memoryBudgetGuard: ctx.memoryBudgetGuard,
        durableExtractionRequestRateLimiter: ctx.durableExtractionRequestRateLimiter,
        broadcastEvent: ctx.broadcastEvent,
        getCompactionRuntimeReport: ctx.getCompactionRuntimeReport,
        queryRuntimeTraceStore: ctx.queryRuntimeTraceStore,
        statIfExists,
        isUnderRoot,
        writeTextFileAtomic,
        guardTeamSharedMemoryWrite,
        goalManager: ctx.goalManager,
        buildDurableExtractionUnavailableError,
        refreshConversationDigestAndBroadcast,
        toDurableExtractionDigestSnapshot,
        isMemoryBudgetExceededError: (error): error is MemoryBudgetExceededError => error instanceof MemoryBudgetExceededError,
      });
    }

    case "workspace.revision.list":
    case "workspace.revision.preview":
    case "workspace.revision.restore":
    case "workspace.change.review.verify_after_restore": {
      return handleWorkspaceRevisionMethod(req, {
        runtime: ctx.workspaceRevisionRuntime,
        reviewRuntime: ctx.workspaceChangeReviewRuntime,
      });
    }

    case "workspace.worktree.status":
    case "workspace.worktree.create":
    case "workspace.worktree.diff":
    case "workspace.worktree.apply.preview":
    case "workspace.worktree.apply.confirm":
    case "workspace.worktree.remove.preview":
    case "workspace.worktree.remove.confirm":
    case "workspace.worktree.stage.preview":
    case "workspace.worktree.stage.confirm":
    case "workspace.worktree.commit.preview":
    case "workspace.worktree.commit.confirm":
    case "workspace.worktree.branch.preview":
    case "workspace.worktree.branch.confirm": {
      return handleWorkspaceWorktreeMethod(req, {
        runtime: ctx.userWorktreeRuntime,
        conversationRunRegistry: ctx.conversationRunRegistry,
        additionalWorkspaceRoots: ctx.additionalWorkspaceRoots,
      });
    }

    case "workspace.remote_delivery.targets":
    case "workspace.remote_delivery.push.preview":
    case "workspace.remote_delivery.push.confirm":
    case "workspace.remote_delivery.pull_request.preview":
    case "workspace.remote_delivery.pull_request.confirm":
    case "workspace.remote_delivery.audit.list": {
      return handleRemoteDeliveryMethod(req, {
        runtime: ctx.remoteDeliveryRuntime,
        userWorktreeRuntime: ctx.userWorktreeRuntime,
        additionalWorkspaceRoots: ctx.additionalWorkspaceRoots,
      });
    }

    case "extension.runtime.revoke": {
      return handleExtensionRuntimeMethod(req, {
        runtime: ctx.extensionHost?.extensionRuntimeSupervisor,
      });
    }

    case "coding.run.status":
    case "coding.run.follow_up.status":
    case "coding.run.steer.status":
    case "coding.run.permission.list":
    case "coding.run.control": {
      return handleCodingRunMethod(req, {
        conversationRunRegistry: ctx.conversationRunRegistry,
        codingRunReconciliationJournal: ctx.codingRunReconciliationJournal,
        goalManager: ctx.goalManager,
        subTaskRuntimeStore: ctx.subTaskRuntimeStore,
        resumeSubTask: ctx.resumeSubTask,
        stopSubTask: ctx.stopSubTask,
        workflowRuntime: ctx.workflowRuntime,
        pendingToolPermissionRuntime: ctx.pendingToolPermissionRuntime,
      });
    }

    case "coding.run.subscribe": {
      return handleCodingRunSubscriptionMethod(req, ws, {
        eventBroker: ctx.codingRunEventBroker,
      });
    }

    case "command.job.list":
    case "command.job.read":
    case "command.job.cancel": {
      try {
        return handleCommandJobMethod(req, { runtime: await getCommandJobRuntime(ctx.stateDir) });
      } catch {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "command_job_unavailable", message: "Command job runtime is unavailable." },
        };
      }
    }

    case "subtask.list":
    case "subtask.get":
    case "subtask.resume":
    case "subtask.takeover":
    case "subtask.update":
    case "subtask.stop":
    case "subtask.archive":
    case "bridge.session.list":
    case "bridge.session.peek": {
      return handleQueryRuntimeDomainsMethod(req, queryRuntimeDomainsContext);
    }

    case "workflow.run":
    case "workflow.status":
    case "workflow.stop":
    case "workflow.list": {
      return handleWorkflowMethod(req, {
        workflowRuntime: ctx.workflowRuntime,
        stateDir: ctx.stateDir,
      });
    }
  }

  return { type: "res", id: req.id, ok: false, error: { code: "not_found", message: "Unknown method." } };
}

function parseMessageSendParams(value: unknown): { ok: true; value: MessageSendParams } | { ok: false; message: string } {
  if (!value || typeof value !== "object") return { ok: false, message: "params must be an object" };
  const obj = value as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text : "";
  const limits = getAttachmentLimits();

  let attachments: MessageSendParams["attachments"];
  if (obj.attachments !== undefined) {
    if (!Array.isArray(obj.attachments)) return { ok: false, message: "attachments must be an array" };
    attachments = [];
    let totalBytes = 0;
    for (let i = 0; i < obj.attachments.length; i += 1) {
      const raw = obj.attachments[i];
      if (!raw || typeof raw !== "object") {
        return { ok: false, message: `attachments[${i}] must be an object` };
      }
      const att = raw as Record<string, unknown>;
      const name = typeof att.name === "string" ? att.name.trim() : "";
      const type = typeof att.type === "string" ? att.type.trim() : "";
      const base64 = typeof att.base64 === "string" ? att.base64.trim() : "";
      if (!name || !type || !base64) {
        return { ok: false, message: `attachments[${i}] requires name/type/base64` };
      }
      const estimatedBytes = estimateBase64DecodedBytes(base64);
      if (estimatedBytes === null) {
        return { ok: false, message: `attachments[${i}].base64 is invalid` };
      }
      if (estimatedBytes > limits.maxFileBytes) {
        return { ok: false, message: `attachment "${name}" exceeds max file size (${limits.maxFileBytes} bytes)` };
      }
      totalBytes += estimatedBytes;
      if (totalBytes > limits.maxTotalBytes) {
        return { ok: false, message: `attachments total size exceeds limit (${limits.maxTotalBytes} bytes)` };
      }
      attachments.push({ name, type, base64 });
    }
  }

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!text.trim() && !hasAttachments) return { ok: false, message: "text or attachments required" };
  const conversationId =
    typeof obj.conversationId === "string" && obj.conversationId.trim() ? obj.conversationId.trim() : undefined;
  const autoStopPreviousRun = obj.autoStopPreviousRun === true;
  const from = typeof obj.from === "string" && obj.from.trim() ? obj.from.trim() : undefined;
  const agentId = typeof obj.agentId === "string" && obj.agentId.trim() ? obj.agentId.trim() : undefined;
  const modelId = typeof obj.modelId === "string" && obj.modelId.trim() ? obj.modelId.trim() : undefined;
  const userUuid = typeof obj.userUuid === "string" && obj.userUuid.trim() ? obj.userUuid.trim() : undefined;
  const clientContextObj = obj.clientContext && typeof obj.clientContext === "object"
    ? obj.clientContext as Record<string, unknown>
    : undefined;
  const clientContext = clientContextObj
    ? {
      sentAtMs: typeof clientContextObj.sentAtMs === "number"
        ? clientContextObj.sentAtMs as number
        : undefined,
      timezoneOffsetMinutes: typeof clientContextObj.timezoneOffsetMinutes === "number"
        ? clientContextObj.timezoneOffsetMinutes as number
        : undefined,
      locale: typeof clientContextObj.locale === "string"
        ? clientContextObj.locale.trim() || undefined
        : undefined,
    }
    : undefined;

  // 解析 senderInfo 和 roomContext（用于 office.goddess.ai 社区）
  const senderInfo = obj.senderInfo && typeof obj.senderInfo === "object" ? obj.senderInfo as any : undefined;
  const roomContext = obj.roomContext && typeof obj.roomContext === "object" ? obj.roomContext as any : undefined;
  const codingRun = parseCodingRunOptions(obj.codingRun);
  if (!codingRun.ok) return codingRun;

  return {
    ok: true,
    value: {
      text,
      conversationId,
      autoStopPreviousRun,
      from,
      agentId,
      modelId,
      userUuid,
      attachments,
      senderInfo,
      roomContext,
      clientContext,
      ...(codingRun.value ? { codingRun: codingRun.value } : {}),
    },
  };
}

function parseCodingRunOptions(
  value: unknown,
): { ok: true; value?: CodingRunOptions } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (!isObjectRecord(value)) return { ok: false, message: "codingRun must be an object" };
  const allowedKeys = new Set([
    "automationProfile",
    "cwd",
    "toolAllow",
    "toolDeny",
    "permissionMode",
    "maxWallTimeMs",
    "maxTurns",
    "maxTokens",
    "maxCostUsd",
    "outputSchema",
  ]);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) return { ok: false, message: `codingRun.${unknownKey} is not supported` };

  const automationProfile = value.automationProfile;
  if (automationProfile !== undefined && automationProfile !== "bare") {
    return { ok: false, message: "codingRun.automationProfile must be bare" };
  }

  const cwdRaw = value.cwd;
  let cwd: string | undefined;
  if (cwdRaw !== undefined) {
    if (typeof cwdRaw !== "string" || !cwdRaw.trim()) {
      return { ok: false, message: "codingRun.cwd must be a non-empty absolute path" };
    }
    if (!path.isAbsolute(cwdRaw.trim())) {
      return { ok: false, message: "codingRun.cwd must be an absolute path" };
    }
    cwd = path.resolve(cwdRaw.trim());
  }

  const toolAllow = parseCodingRunToolList(value.toolAllow, "toolAllow");
  if (!toolAllow.ok) return toolAllow;
  const toolDeny = parseCodingRunToolList(value.toolDeny, "toolDeny");
  if (!toolDeny.ok) return toolDeny;

  const permissionMode = value.permissionMode;
  if (
    permissionMode !== undefined
    && permissionMode !== "plan"
    && permissionMode !== "acceptEdits"
    && permissionMode !== "confirm"
  ) {
    return { ok: false, message: "codingRun.permissionMode must be plan, acceptEdits, or confirm" };
  }

  const maxWallTimeMs = parseCodingRunPositiveInteger(value.maxWallTimeMs, "maxWallTimeMs", 1_000);
  if (!maxWallTimeMs.ok) return maxWallTimeMs;
  const maxTurns = parseCodingRunPositiveInteger(value.maxTurns, "maxTurns");
  if (!maxTurns.ok) return maxTurns;
  const maxTokens = parseCodingRunPositiveInteger(value.maxTokens, "maxTokens");
  if (!maxTokens.ok) return maxTokens;

  let maxCostUsd: number | undefined;
  if (value.maxCostUsd !== undefined) {
    if (typeof value.maxCostUsd !== "number" || !Number.isFinite(value.maxCostUsd) || value.maxCostUsd <= 0) {
      return { ok: false, message: "codingRun.maxCostUsd must be a positive finite number" };
    }
    maxCostUsd = value.maxCostUsd;
  }
  if (value.outputSchema !== undefined) {
    const compiledOutputSchema = compileOutputSchema(value.outputSchema);
    if (!compiledOutputSchema.ok) return compiledOutputSchema;
  }

  return {
    ok: true,
    value: {
      ...(automationProfile ? { automationProfile } : {}),
      ...(cwd ? { cwd } : {}),
      ...(toolAllow.value ? { toolAllow: toolAllow.value } : {}),
      ...(toolDeny.value ? { toolDeny: toolDeny.value } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(maxWallTimeMs.value ? { maxWallTimeMs: maxWallTimeMs.value } : {}),
      ...(maxTurns.value ? { maxTurns: maxTurns.value } : {}),
      ...(maxTokens.value ? { maxTokens: maxTokens.value } : {}),
      ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
      ...(value.outputSchema === undefined ? {} : { outputSchema: value.outputSchema }),
    },
  };
}

function parseCodingRunToolList(
  value: unknown,
  field: "toolAllow" | "toolDeny",
): { ok: true; value?: string[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    return { ok: false, message: `codingRun.${field} must contain 1-128 tool names` };
  }
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 160) {
      return { ok: false, message: `codingRun.${field} contains an invalid tool name` };
    }
    normalized.push(item.trim());
  }
  return { ok: true, value: [...new Set(normalized)] };
}

function parseCodingRunPositiveInteger(
  value: unknown,
  field: string,
  minimum = 1,
): { ok: true; value?: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    return { ok: false, message: `codingRun.${field} must be an integer of at least ${minimum}` };
  }
  return { ok: true, value };
}

function parseConversationRunStopParams(
  value: unknown,
): { ok: true; value: ConversationRunStopParams } | { ok: false; message: string } {
  if (!value || typeof value !== "object") return { ok: false, message: "params must be an object" };
  const obj = value as Record<string, unknown>;
  const conversationId = typeof obj.conversationId === "string" ? obj.conversationId.trim() : "";
  const runId = typeof obj.runId === "string" && obj.runId.trim() ? obj.runId.trim() : undefined;
  const reason = typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim() : undefined;
  if (!conversationId) {
    return { ok: false, message: "conversationId is required" };
  }
  return {
    ok: true,
    value: {
      conversationId,
      runId,
      reason,
    },
  };
}

function parseToolSettingsConfirmParams(
  value: unknown,
): { ok: true; value: { requestId: string; decision: "approve" | "reject"; conversationId?: string } } | { ok: false; message: string } {
  if (!value || typeof value !== "object") return { ok: false, message: "params must be an object" };
  const obj = value as Record<string, unknown>;
  const requestId = typeof obj.requestId === "string" ? obj.requestId.trim().toUpperCase() : "";
  const decision = typeof obj.decision === "string" ? obj.decision.trim().toLowerCase() : "";
  const conversationId =
    typeof obj.conversationId === "string" && obj.conversationId.trim() ? obj.conversationId.trim() : undefined;
  if (!requestId) return { ok: false, message: "requestId is required" };
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, message: 'decision must be "approve" or "reject"' };
  }
  return { ok: true, value: { requestId, decision, conversationId } };
}

function parsePairingApproveParams(
  value: unknown,
): { ok: true; value: { code: string } } | { ok: false; message: string } {
  if (!value || typeof value !== "object") return { ok: false, message: "params must be an object" };
  const obj = value as Record<string, unknown>;
  const code = typeof obj.code === "string" ? obj.code.trim().toUpperCase() : "";
  if (!code) return { ok: false, message: "code is required" };
  return { ok: true, value: { code } };
}

function parseExternalOutboundConfirmParams(
  value: unknown,
): { ok: true; value: { requestId: string; decision: "approve" | "reject"; conversationId?: string } } | { ok: false; message: string } {
  return parseToolSettingsConfirmParams(value);
}

function parseEmailOutboundConfirmParams(
  value: unknown,
): { ok: true; value: { requestId: string; decision: "approve" | "reject"; conversationId?: string } } | { ok: false; message: string } {
  return parseToolSettingsConfirmParams(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampListLimit(value: unknown, fallback: number, max = 100): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseGoalTaskCheckpointStatus(value: unknown): "not_required" | "required" | "waiting_user" | "approved" | "rejected" | "expired" | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "not_required":
    case "required":
    case "waiting_user":
    case "approved":
    case "rejected":
    case "expired":
      return normalized;
    default:
      return undefined;
  }
}

function parseGoalTaskCreateStatus(value: unknown): "draft" | "ready" | "blocked" | "skipped" | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "draft":
    case "ready":
    case "blocked":
    case "skipped":
      return normalized;
    default:
      return undefined;
  }
}

async function ensureWebRoot(webRoot: string): Promise<void> {
  const stat = await statIfExists(webRoot);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Invalid webRoot: ${webRoot}`);
  }
}
