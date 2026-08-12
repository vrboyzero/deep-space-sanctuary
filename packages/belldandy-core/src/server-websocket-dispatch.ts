import type {
  AgentRegistry,
  BelldandyAgent,
  CompactionRuntimeReport,
  ConversationStore,
  ModelProfile,
} from "@belldandy/agent";
import type { BelldandyRole, GatewayEventFrame, GatewayReqFrame, GatewayResFrame, TokenUsageUploadConfig } from "@belldandy/protocol";
import type { EnvDirSource } from "@star-sanctuary/distribution";
import type { PluginRegistry } from "@belldandy/plugins";
import type { SkillRegistry, ToolContractChannel, ToolExecutor, TranscribeOptions, TranscribeResult } from "@belldandy/skills";
import type { WebSocket } from "ws";

import type { BackgroundContinuationRuntimeDoctorReport } from "./background-continuation-runtime.js";
import type { ConversationRunRegistry } from "./conversation-run-registry.js";
import type { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";
import type { CronRuntimeDoctorReport } from "./cron/observability.js";
import type {
  DreamRuntime,
  DurableExtractionDigestSnapshot,
  DurableExtractionRecord,
  DurableExtractionRuntime,
  MemoryModelPrivacyRuntime,
} from "@belldandy/memory";
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
import type { MemoryBackgroundJobScheduler } from "./memory-background-job-scheduler.js";
import type { QueryRuntimeTraceStore } from "./query-runtime-trace.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";
import type { ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";
import type { RuntimeResourceObservability } from "./runtime-resource-observability.js";
import type { RuntimeResilienceDoctorReport } from "./runtime-resilience.js";
import type { GatewayServerOptions } from "./server.js";
import type { ObsidianCommonsRuntime } from "./obsidian-commons-runtime.js";
import type { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import type { ToolsConfigManager } from "./tools-config.js";
import type { SubTaskRecord, SubTaskRuntimeStore } from "./task-runtime.js";
import type { GatewayWebSocketConnectionContext } from "./server-websocket-runtime.js";
import type { PreflightCompressionPolicy } from "./preflight-compression-config.js";
import type { WorkspaceChangeReviewRuntime } from "./workspace-change-review.js";
import type { WorkspaceRevisionRuntime } from "./workspace-revision.js";
import type { UserWorktreeRuntime } from "./user-worktree-runtime.js";
import type { RemoteDeliveryRuntime } from "./remote-delivery-runtime.js";
import type { CodingRunGatewayEventBroker } from "./coding-run/gateway-event-broker.js";
import type { CodingRunReconciliationJournalOwner } from "./coding-run/reconciliation-journal.js";
import type { PendingToolPermissionRuntime } from "./coding-run/pending-tool-permission-runtime.js";
import type { TaskProjectionCollectionRuntime } from "./coding-run/task-projection-collection-runtime.js";

type GatewayLog = {
  debug: (module: string, message: string, data?: unknown) => void;
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

export type GatewayWebSocketRequestContext = {
  clientId: string;
  role: BelldandyRole;
  authenticated: boolean;
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
  codingRunEventBroker: CodingRunGatewayEventBroker;
  codingRunReconciliationJournal: CodingRunReconciliationJournalOwner;
  taskProjectionCollectionRuntime: TaskProjectionCollectionRuntime;
  pendingToolPermissionRuntime?: PendingToolPermissionRuntime;
  topLevelConversationLifecycle: TopLevelConversationLifecycle;
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
  memoryBackgroundJobScheduler: MemoryBackgroundJobScheduler;
  memoryModelPrivacyRuntime: MemoryModelPrivacyRuntime;
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
  extensionHost?: Pick<ExtensionHostState, "extensionRuntime" | "lifecycle" | "extensionRuntimeSupervisor">;
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
  requestSystemRestart?: (reason: string) => void;
  getCompactionRuntimeReport?: () => CompactionRuntimeReport | undefined;
  getRuntimeResilienceReport?: () => RuntimeResilienceDoctorReport | undefined;
  queryRuntimeTraceStore: QueryRuntimeTraceStore;
  runtimeResourceObservability: RuntimeResourceObservability;
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
  /** 发送前附件/长输入压缩策略。业务逻辑在 query runtime 内执行，这里只透传配置。 */
  preflightCompressionPolicy?: PreflightCompressionPolicy;
  toolResultEventOutputCharLimit: number;
};

type CreateGatewayWebSocketRequestHandlerOptions = Omit<
  GatewayWebSocketRequestContext,
  "clientId" | "role" | "authenticated" | "requestChannel" | "userUuid"
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
    role: connection.role,
    authenticated: connection.authenticated,
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
    codingRunEventBroker: options.codingRunEventBroker,
    codingRunReconciliationJournal: options.codingRunReconciliationJournal,
    taskProjectionCollectionRuntime: options.taskProjectionCollectionRuntime,
    pendingToolPermissionRuntime: options.pendingToolPermissionRuntime,
    topLevelConversationLifecycle: options.topLevelConversationLifecycle,
    durableExtractionRuntime: options.durableExtractionRuntime,
    resolveDreamRuntime: options.resolveDreamRuntime,
    resolveDreamDefaultConversationId: options.resolveDreamDefaultConversationId,
    resolveCommonsExportRuntime: options.resolveCommonsExportRuntime,
    requestDurableExtraction: options.requestDurableExtraction,
    memoryUsageAccounting: options.memoryUsageAccounting,
    memoryBudgetGuard: options.memoryBudgetGuard,
    memoryBackgroundJobScheduler: options.memoryBackgroundJobScheduler,
    memoryModelPrivacyRuntime: options.memoryModelPrivacyRuntime,
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
    workflowRuntime: options.workflowRuntime,
    workspaceRevisionRuntime: options.workspaceRevisionRuntime,
    workspaceChangeReviewRuntime: options.workspaceChangeReviewRuntime,
    userWorktreeRuntime: options.userWorktreeRuntime,
    remoteDeliveryRuntime: options.remoteDeliveryRuntime,
    tokenUsageUploadConfig: options.tokenUsageUploadConfig,
    broadcast: options.broadcast,
    broadcastEvent: options.broadcastEvent,
    requestSystemRestart: options.requestSystemRestart,
    getCompactionRuntimeReport: options.getCompactionRuntimeReport,
    getRuntimeResilienceReport: options.getRuntimeResilienceReport,
    queryRuntimeTraceStore: options.queryRuntimeTraceStore,
    runtimeResourceObservability: options.runtimeResourceObservability,
    residentAgentRuntime: options.residentAgentRuntime,
    residentMemoryManagers: options.residentMemoryManagers,
    getCronRuntimeDoctorReport: options.getCronRuntimeDoctorReport,
    getBackgroundContinuationRuntimeDoctorReport: options.getBackgroundContinuationRuntimeDoctorReport,
    runCronJobNow: options.runCronJobNow,
    runCronRecovery: options.runCronRecovery,
    preflightCompressionPolicy: options.preflightCompressionPolicy,
    toolResultEventOutputCharLimit: options.toolResultEventOutputCharLimit,
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
