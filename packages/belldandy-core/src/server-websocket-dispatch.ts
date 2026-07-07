import type {
  AgentRegistry,
  BelldandyAgent,
  CompactionRuntimeReport,
  ConversationStore,
  ModelProfile,
} from "@belldandy/agent";
import type { GatewayEventFrame, GatewayReqFrame, GatewayResFrame, TokenUsageUploadConfig } from "@belldandy/protocol";
import type { EnvDirSource } from "@star-sanctuary/distribution";
import type { PluginRegistry } from "@belldandy/plugins";
import type { SkillRegistry, ToolContractChannel, ToolExecutor, TranscribeOptions, TranscribeResult } from "@belldandy/skills";
import type { WebSocket } from "ws";

import type { BackgroundContinuationRuntimeDoctorReport } from "./background-continuation-runtime.js";
import type { ConversationRunRegistry } from "./conversation-run-registry.js";
import type { CronRuntimeDoctorReport } from "./cron/observability.js";
import type { DreamRuntime, DurableExtractionDigestSnapshot, DurableExtractionRecord, DurableExtractionRuntime } from "@belldandy/memory";
import type { ExtensionHostState } from "./extension-host.js";
import type { ExternalOutboundAuditStore } from "./external-outbound-audit-store.js";
import type { ExternalOutboundConfirmationStore } from "./external-outbound-confirmation-store.js";
import type { ExternalOutboundSenderRegistry } from "./external-outbound-sender-registry.js";
import type { EmailOutboundAuditStore } from "./email-outbound-audit-store.js";
import type { EmailOutboundConfirmationStore } from "./email-outbound-confirmation-store.js";
import type { EmailOutboundProviderRegistry } from "./email-outbound-provider-registry.js";
import type { EmailInboundAuditStore } from "./email-inbound-audit-store.js";
import type { EmailFollowUpReminderStore } from "./email-follow-up-reminder-store.js";
import type { GoalManager } from "./goals/manager.js";
import type {
  MemoryRuntimeBudgetGuard,
  MemoryRuntimeUsageAccounting,
  SlidingWindowRateLimiter,
} from "./memory-runtime-budget.js";
import type { QueryRuntimeTraceStore } from "./query-runtime-trace.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";
import type { ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";
import type { RuntimeResilienceDoctorReport } from "./runtime-resilience.js";
import type { GatewayServerOptions } from "./server.js";
import type { ObsidianCommonsRuntime } from "./obsidian-commons-runtime.js";
import type { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import type { ToolsConfigManager } from "./tools-config.js";
import type { SubTaskRecord, SubTaskRuntimeStore } from "./task-runtime.js";
import type { GatewayWebSocketConnectionContext } from "./server-websocket-runtime.js";
import type { PreflightCompressionPolicy } from "./preflight-compression-config.js";

type GatewayLog = {
  debug: (module: string, message: string, data?: unknown) => void;
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

export type GatewayWebSocketRequestContext = {
  clientId: string;
  requestChannel: ToolContractChannel;
  userUuid?: string;
  stateDir: string;
  additionalWorkspaceRoots: string[];
  envDir?: string;
  envSource?: EnvDirSource;
  auth: GatewayServerOptions["auth"];
  log: GatewayLog;
  agentFactory: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  inspectAgentPrompt?: GatewayServerOptions["inspectAgentPrompt"];
  getConversationPromptSnapshot?: GatewayServerOptions["getConversationPromptSnapshot"];
  primaryModelConfig?: { baseUrl: string; apiKey: string; model: string; protocol?: string; wireApi?: string };
  modelFallbacks?: ModelProfile[];
  preferredProviderIds: string[];
  modelConfigPath?: string;
  conversationStore: ConversationStore;
  conversationRunRegistry: ConversationRunRegistry;
  durableExtractionRuntime?: DurableExtractionRuntime;
  resolveDreamRuntime?: (agentId?: string) => DreamRuntime | null;
  resolveDreamDefaultConversationId?: (agentId?: string) => string;
  resolveCommonsExportRuntime?: () => ObsidianCommonsRuntime | null;
  requestDurableExtraction?: (input: {
    conversationId: string;
    source: string;
    digest: DurableExtractionDigestSnapshot;
  }) => Promise<DurableExtractionRecord | undefined>;
  memoryUsageAccounting: MemoryRuntimeUsageAccounting;
  memoryBudgetGuard: MemoryRuntimeBudgetGuard;
  durableExtractionRequestRateLimiter: SlidingWindowRateLimiter;
  ttsEnabled?: () => boolean;
  ttsSynthesize?: (text: string) => Promise<{ webPath: string; htmlAudio: string } | null>;
  toolsConfigManager?: ToolsConfigManager;
  toolExecutor?: ToolExecutor;
  toolControlConfirmationStore?: ToolControlConfirmationStore;
  externalOutboundConfirmationStore?: ExternalOutboundConfirmationStore;
  externalOutboundSenderRegistry?: ExternalOutboundSenderRegistry;
  externalOutboundAuditStore?: ExternalOutboundAuditStore;
  emailOutboundConfirmationStore?: EmailOutboundConfirmationStore;
  emailOutboundProviderRegistry?: EmailOutboundProviderRegistry;
  emailOutboundAuditStore?: EmailOutboundAuditStore;
  emailInboundAuditStore?: EmailInboundAuditStore;
  emailFollowUpReminderStore?: EmailFollowUpReminderStore;
  getAgentToolControlMode?: () => "disabled" | "confirm" | "auto";
  getAgentToolControlConfirmPassword?: () => string | undefined;
  getGovernanceDetailMode?: () => "compact" | "full";
  setGovernanceDetailMode?: (value: string | undefined) => void;
  sttTranscribe?: (opts: TranscribeOptions) => Promise<TranscribeResult | null>;
  pluginRegistry?: PluginRegistry;
  extensionHost?: Pick<ExtensionHostState, "extensionRuntime" | "lifecycle">;
  skillRegistry?: SkillRegistry;
  goalManager?: GoalManager;
  subTaskRuntimeStore?: SubTaskRuntimeStore;
  resumeSubTask?: (taskId: string, message?: string) => Promise<SubTaskRecord | undefined>;
  takeoverSubTask?: (taskId: string, agentId: string, message?: string) => Promise<SubTaskRecord | undefined>;
  updateSubTask?: (taskId: string, message: string) => Promise<SubTaskRecord | undefined>;
  stopSubTask?: (taskId: string, reason?: string) => Promise<SubTaskRecord | undefined>;
  tokenUsageUploadConfig: TokenUsageUploadConfig;
  broadcast?: (frame: GatewayEventFrame) => void;
  broadcastEvent?: (frame: GatewayEventFrame) => void;
  getCompactionRuntimeReport?: () => CompactionRuntimeReport | undefined;
  getRuntimeResilienceReport?: () => RuntimeResilienceDoctorReport | undefined;
  queryRuntimeTraceStore: QueryRuntimeTraceStore;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  getCronRuntimeDoctorReport?: () => Promise<CronRuntimeDoctorReport | undefined>;
  getBackgroundContinuationRuntimeDoctorReport?: () => Promise<BackgroundContinuationRuntimeDoctorReport | undefined>;
  runCronJobNow?: (jobId: string) => Promise<{
    runId?: string;
    status: "ok" | "error" | "skipped";
    summary?: string;
    reason?: string;
  }>;
  runCronRecovery?: (jobId: string) => Promise<{
    outcome: "succeeded" | "failed" | "throttled" | "skipped_not_eligible";
    sourceRunId?: string;
    recoveryRunId?: string;
    reason?: string;
  }>;
  /** 动态工作流运行时（由 Gateway 装配后注入） */
  workflowRuntime?: import("@belldandy/skills").WorkflowRuntimeCapabilities;
  /** Commander 模式（"on" | "off" | "auto"），用于 chat commander 显式触发判定 */
  commanderMode?: "on" | "off" | "auto";
  /** 发送前附件/长输入压缩策略。业务逻辑在 query runtime 内执行，这里只透传配置。 */
  preflightCompressionPolicy?: PreflightCompressionPolicy;
};

type CreateGatewayWebSocketRequestHandlerOptions = Omit<
  GatewayWebSocketRequestContext,
  "clientId" | "requestChannel" | "userUuid"
> & {
  handleReq: (
    ws: WebSocket,
    req: GatewayReqFrame,
    ctx: GatewayWebSocketRequestContext,
  ) => Promise<GatewayResFrame | null>;
};

export function buildGatewayWebSocketRequestContext(
  connection: GatewayWebSocketConnectionContext,
  options: Omit<CreateGatewayWebSocketRequestHandlerOptions, "handleReq">,
): GatewayWebSocketRequestContext {
  return {
    clientId: connection.clientId,
    requestChannel: resolveGatewayWebSocketRequestChannel(connection),
    userUuid: connection.userUuid,
    stateDir: options.stateDir,
    additionalWorkspaceRoots: options.additionalWorkspaceRoots,
    envDir: options.envDir,
    envSource: options.envSource,
    auth: options.auth,
    log: options.log,
    agentFactory: options.agentFactory,
    agentRegistry: options.agentRegistry,
    inspectAgentPrompt: options.inspectAgentPrompt,
    getConversationPromptSnapshot: options.getConversationPromptSnapshot,
    primaryModelConfig: options.primaryModelConfig,
    modelFallbacks: options.modelFallbacks,
    preferredProviderIds: options.preferredProviderIds,
    modelConfigPath: options.modelConfigPath,
    conversationStore: options.conversationStore,
    conversationRunRegistry: options.conversationRunRegistry,
    durableExtractionRuntime: options.durableExtractionRuntime,
    resolveDreamRuntime: options.resolveDreamRuntime,
    resolveDreamDefaultConversationId: options.resolveDreamDefaultConversationId,
    resolveCommonsExportRuntime: options.resolveCommonsExportRuntime,
    requestDurableExtraction: options.requestDurableExtraction,
    memoryUsageAccounting: options.memoryUsageAccounting,
    memoryBudgetGuard: options.memoryBudgetGuard,
    durableExtractionRequestRateLimiter: options.durableExtractionRequestRateLimiter,
    ttsEnabled: options.ttsEnabled,
    ttsSynthesize: options.ttsSynthesize,
    toolsConfigManager: options.toolsConfigManager,
    toolExecutor: options.toolExecutor,
    toolControlConfirmationStore: options.toolControlConfirmationStore,
    externalOutboundConfirmationStore: options.externalOutboundConfirmationStore,
    externalOutboundSenderRegistry: options.externalOutboundSenderRegistry,
    externalOutboundAuditStore: options.externalOutboundAuditStore,
    emailOutboundConfirmationStore: options.emailOutboundConfirmationStore,
    emailOutboundProviderRegistry: options.emailOutboundProviderRegistry,
    emailOutboundAuditStore: options.emailOutboundAuditStore,
    emailInboundAuditStore: options.emailInboundAuditStore,
    emailFollowUpReminderStore: options.emailFollowUpReminderStore,
    getAgentToolControlMode: options.getAgentToolControlMode,
    getAgentToolControlConfirmPassword: options.getAgentToolControlConfirmPassword,
    getGovernanceDetailMode: options.getGovernanceDetailMode,
    setGovernanceDetailMode: options.setGovernanceDetailMode,
    sttTranscribe: options.sttTranscribe,
    pluginRegistry: options.pluginRegistry,
    extensionHost: options.extensionHost,
    skillRegistry: options.skillRegistry,
    goalManager: options.goalManager,
    subTaskRuntimeStore: options.subTaskRuntimeStore,
    resumeSubTask: options.resumeSubTask,
    takeoverSubTask: options.takeoverSubTask,
    updateSubTask: options.updateSubTask,
    stopSubTask: options.stopSubTask,
    tokenUsageUploadConfig: options.tokenUsageUploadConfig,
    broadcast: options.broadcast,
    broadcastEvent: options.broadcastEvent,
    getCompactionRuntimeReport: options.getCompactionRuntimeReport,
    getRuntimeResilienceReport: options.getRuntimeResilienceReport,
    queryRuntimeTraceStore: options.queryRuntimeTraceStore,
    residentAgentRuntime: options.residentAgentRuntime,
    residentMemoryManagers: options.residentMemoryManagers,
    getCronRuntimeDoctorReport: options.getCronRuntimeDoctorReport,
    getBackgroundContinuationRuntimeDoctorReport: options.getBackgroundContinuationRuntimeDoctorReport,
    runCronJobNow: options.runCronJobNow,
    runCronRecovery: options.runCronRecovery,
    preflightCompressionPolicy: options.preflightCompressionPolicy,
  };
}

function resolveGatewayWebSocketRequestChannel(
  connection: GatewayWebSocketConnectionContext,
): ToolContractChannel {
  if (connection.role === "cli" || connection.clientId.startsWith("bdd-cli-")) {
    return "cli";
  }
  if (connection.role === "web") {
    return "web";
  }
  return "gateway";
}

export function createGatewayWebSocketRequestHandler(
  options: CreateGatewayWebSocketRequestHandlerOptions,
) {
  return (
    ws: WebSocket,
    frame: GatewayReqFrame,
    connection: GatewayWebSocketConnectionContext,
  ): Promise<GatewayResFrame | null> => {
    return options.handleReq(ws, frame, buildGatewayWebSocketRequestContext(connection, options));
  };
}
