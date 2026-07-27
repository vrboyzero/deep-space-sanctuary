import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ensureDefaultEnvFiles, resolveEnvFilePaths, resolveGatewayRuntimePaths } from "@star-sanctuary/distribution";
import { loadProjectEnvFiles } from "../cli/shared/env-loader.js";
import { buildAutoOpenTargetUrl, resolveLauncherSetupAuth } from "./launcher-auth.js";
import { startBrowserRelayRuntime, startCronRuntime, startHeartbeatRuntime } from "./gateway-background-runtime.js";
import { createCapabilityPlanGenerator } from "./gateway-capability-runtime.js";
import { createGatewayChannelsRuntime } from "./gateway-channels-runtime.js";
import { createCachedChannelSttTranscribe } from "./gateway-channel-stt.js";
import { parseConversationAllowedKinds, readEnv } from "./gateway-config.js";
import { createGatewayPromptInspectionRuntime } from "./gateway-prompt-inspection-runtime.js";
import {
  DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT,
  buildRuntimeSkillAssetSummaries,
  loadRuntimeMethodAssetSummaries,
  resolveRecommendedMethodNames,
  resolveRecommendedSkillNames,
} from "./gateway-runtime-assets.js";
import { isAgentToolAllowed } from "./gateway-agent-governance.js";
import {
  buildGatewayServerOptions,
} from "./gateway-server-runtime.js";
import { loadToolsPolicy, mergePolicy } from "./gateway-tool-policy.js";
import { startGatewayConfigWatcher } from "./gateway-watch-runtime.js";
import { buildGoalSessionContextPrelude } from "../goal-session-context.js";
import { buildGoalSessionRuntimeEventMessage } from "../goal-session-runtime-event.js";
import { buildMindProfileRuntimePrelude } from "../mind-profile-runtime-prelude.js";
import { buildPromptFocusRuntimePrelude } from "../prompt-focus-runtime-prelude.js";
import { resolveCommanderRuntimeSwitches } from "../commander-runtime-switches.js";
import { resolveMemoryRuntimeSwitches } from "../memory-runtime-switches.js";
import { resolveTaskMemoryCarveOutEffects } from "../task-memory-carve-out.js";
import { resolveToolAgentStreamingEnabled } from "../tool-agent-streaming-config.js";
import { calculateUsageCostUsd, resolveCompactionThreshold, resolveProviderCapabilityFromEnv } from "../provider-capability.js";
import { resolveCompactionModelRoute } from "../compaction-model-routing.js";
import { normalizePreferredProviderIds } from "../provider-model-catalog.js";
import { ResidentConversationStore } from "../resident-conversation-store.js";
import { buildLearningReviewNudgePrelude } from "../learning-review-nudge.js";
import { runPostTaskLearningReview } from "../learning-review-runner.js";
import { notifyConversationToolEvent } from "../query-runtime-side-effects.js";
import {
  buildCacheAlignedChatMessages,
  buildCacheAlignedResponsesInput,
  buildCacheAlignedSummaryInstruction,
} from "../compaction-cache-aligned.js";
import { DreamAutomationRuntime } from "../dream-automation-runtime.js";
import { startMemoryIdleSummaryRuntime } from "../memory-idle-summary-runtime.js";
import { createGatewayMemoryBackgroundRuntime } from "./gateway-memory-background-runtime.js";
import { GoalRuntimeBindingStore } from "../goal-runtime-binding-store.js";
import {
  createSubTaskAgentCapabilities,
  createSubTaskResumeController,
  createSubTaskTakeoverController,
  createSubTaskRuntimeEventHandler,
  createSubTaskUpdateController,
  createSubTaskWorktreeLifecycleHandler,
  reconcileSubTaskWorktreeRuntimes,
  type SubTaskCommandRequestOptions,
  type SubTaskRecord,
  SubTaskRuntimeStore,
} from "../task-runtime.js";
import {
  createBridgeAwareStopSubTaskHandler,
  createBridgeSessionGovernanceCapabilities,
  createBridgeSessionResumeController,
  createBridgeSessionTakeoverController,
  createGatewaySubTaskResumeDispatcher,
  createGatewaySubTaskTakeoverDispatcher,
  reconcileRuntimeLostBridgeSubtasks,
} from "../bridge-subtask-runtime.js";
import { SubTaskWorktreeRuntime } from "../worktree-runtime.js";
import { WorkspaceChangeReviewRuntime } from "../workspace-change-review.js";
import { WorkspaceRevisionRuntime } from "../workspace-revision.js";
import { UserWorktreeRuntime } from "../user-worktree-runtime.js";
import {
  GhPullRequestClient,
  RemoteDeliveryRuntime,
  parseRemoteDeliveryTargets,
} from "../remote-delivery-runtime.js";
import { PendingToolPermissionRuntime } from "../coding-run/pending-tool-permission-runtime.js";
import { CodingRunRecoveryMarkerStore } from "../coding-run/recovery-marker-store.js";
import { normalizeEmailOutboundDraft } from "../email-outbound-contract.js";
import { createFileEmailOutboundAuditStore, resolveEmailOutboundAuditStorePath } from "../email-outbound-audit-store.js";
import { EmailOutboundConfirmationStore } from "../email-outbound-confirmation-store.js";
import { EmailOutboundProviderRegistry } from "../email-outbound-provider-registry.js";
import { SmtpEmailOutboundProvider } from "../email-outbound-smtp-provider.js";
import { createFileEmailInboundAuditStore, resolveEmailInboundAuditStorePath } from "../email-inbound-audit-store.js";
import {
  createFileEmailFollowUpReminderStore,
  resolveEmailFollowUpReminderStorePath,
} from "../email-follow-up-reminder-store.js";
import {
  createFileEmailThreadBindingStore,
  resolveEmailThreadBindingStorePath,
} from "../email-thread-binding-store.js";
import {
  createFileEmailInboundCheckpointStore,
  resolveEmailInboundCheckpointStorePath,
} from "../email-inbound-checkpoint-store.js";
import { startImapPollingEmailInboundRuntime } from "../email-inbound-imap-runtime.js";
import { TopLevelConversationLifecycle } from "../top-level-conversation-lifecycle.js";
import { startStarweaverActiveNotifyRuntime } from "../starweaver-active-notify-runtime.js";
import { formatToolAuditLogMessage, shouldDebugToolAuditLog } from "../tool-audit-log.js";
import { requestPrimaryModelWarmup } from "../primary-warmup-probe.js";

import {
  OpenAIChatAgent,
  ToolEnabledAgent,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_TOOL_LOOP_ITERATION_BUDGET,
  normalizeMaxHighRiskToolCalls,
  normalizeMaxRunWallTimeMs,
  normalizeMaxTotalTokens,
  type BelldandyAgent,
  AGENTS_FILENAME,
  BOOTSTRAP_FILENAME,
  classifyFailoverReason,
  ensureWorkspace,
  loadWorkspaceFiles,
  buildSystemPromptResult,
  ConversationStore,
  loadModelFallbacks,
  MEMORY_FILENAME,
  type ModelProfile,
  type SummarizerContext,
  type VideoUploadConfig,
  FailoverClient,
  type SummarizerFn,
  AgentRegistry,
  SubAgentOrchestrator,
  normalizeAgentLaunchSpecWithCatalog,
  loadAgentProfiles,
  buildDefaultProfile,
  buildBuiltinWorkerProfiles,
  HEARTBEAT_FILENAME,
  IDENTITY_FILENAME,
  parseWorkspaceDocument,
  resolveAgentProfileCatalogMetadata,
  resolveModelConfig,
  SOUL_FILENAME,
  TOOLS_FILENAME,
  type AgentProfile,
  type SystemPromptBuildResult,
  type WorkspaceFile,
  type WorkspaceLoadResult,
  USER_FILENAME,
  HookRegistry,
  createHookRunner,
  type HookRunner,
  CompactionRuntimeTracker,
  resolveFailoverCooldownMs,
} from "@belldandy/agent";
import {
  ToolExecutor,
  ToolPoolAssembler,
  DEFAULT_POLICY,
  type Tool,
  type ToolDiscoveryFamilyDefinition,
  resolveSafeScopesForChannel,
  type ToolContractAccessPolicy,
  createToolSearchTool,
  TOOL_SEARCH_NAME,
  TOOL_SETTINGS_CONTROL_NAME,
  createToolSettingsControlTool,
  planCurrentGetTool,
  planCurrentUpdateTool,
  createSendChannelMessageTool,
  createSendEmailTool,
  type AgentToolControlMode,
  fetchTool,
  applyPatchTool,
  fileReadTool,
  fileWriteTool,
  fileDeleteTool,
  listFilesTool,
  textSearchTool,
  fileGlobTool,
  createMemorySearchTool,
  createMemoryGetTool,
  memoryReadTool,
  memoryWriteTool,
  memorySharePromoteTool,
  taskSearchTool,
  taskGetTool,
  taskRecentTool,
  taskPromoteMethodTool,
  taskPromoteSkillDraftTool,
  experienceCandidateGetTool,
  experienceCandidateListTool,
  experienceCandidateAcceptTool,
  experienceCandidateRejectTool,
  experienceUsageGetTool,
  experienceUsageListTool,
  experienceUsageRecordTool,
  experienceUsageRevokeTool,
  browserOpenTool,
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserGetContentTool,
  cameraDeviceMemoryTool,
  cameraListTool,
  cameraSnapTool,
  screenListTargetsTool,
  screenCaptureTool,
  multimediaCacheClearTool,
  imageGenerateTool,
  imageUnderstandTool,
  videoUnderstandTool,
  textToSpeechTool,
  clearMediaUnderstandingCache,
  synthesizeSpeech,
  transcribeSpeech,
  commandJobTool,
  runCommandTool,
  shutdownCommandJobs,
  bridgeTargetListTool,
  bridgeTargetDiagnoseTool,
  bridgeRunTool,
  bridgeSessionStartTool,
  bridgeSessionWriteTool,
  bridgeSessionReadTool,
  bridgeSessionStatusTool,
  bridgeSessionCloseTool,
  bridgeSessionListTool,
  shutdownBridgeSessions,
  ptcRuntimeTool,
  methodListTool,
  methodReadTool,
  methodCreateTool,
  methodSearchTool,
  goalInitTool,
  goalGetTool,
  goalListTool,
  goalResumeTool,
  goalPauseTool,
  goalHandoffGenerateTool,
  goalRetrospectGenerateTool,
  goalExperienceSuggestTool,
  goalMethodCandidatesGenerateTool,
  goalSkillCandidatesGenerateTool,
  goalFlowPatternsGenerateTool,
  goalCrossGoalFlowPatternsTool,
  goalReviewGovernanceSummaryTool,
  goalApprovalScanTool,
  goalSuggestionReviewListTool,
  goalSuggestionReviewWorkflowSetTool,
  goalSuggestionReviewDecideTool,
  goalSuggestionReviewEscalateTool,
  goalSuggestionReviewScanTool,
  goalSuggestionPublishTool,
  goalCheckpointListTool,
  goalCheckpointRequestTool,
  goalCheckpointApproveTool,
  goalCheckpointRejectTool,
  goalCheckpointExpireTool,
  goalCheckpointReopenTool,
  goalCheckpointEscalateTool,
  goalCapabilityPlanTool,
  goalOrchestrateTool,
  goalCommanderDecideTool,
  taskGraphReadTool,
  taskGraphCreateTool,
  taskGraphUpdateTool,
  taskGraphClaimTool,
  taskGraphPendingReviewTool,
  taskGraphValidatingTool,
  taskGraphCompleteTool,
  taskGraphBlockTool,
  taskGraphFailTool,
  taskGraphSkipTool,
  logReadTool,
  logSearchTool,
  createCronTool,
  createServiceRestartTool,
  switchFacetTool,
  listFaqisTool,
  switchFaqiTool,
  sessionsSpawnTool,
  sessionsHistoryTool,
  delegateTaskTool,
  delegateParallelTool,
  conversationListTool,
  conversationReadTool,
  retrieveToolResultTool,
  createCanvasTools,
  getUserUuidTool,
  getMessageSenderInfoTool,
  getRoomMembersTool,
  createLeaveRoomTool,
  createJoinRoomTool,
  officeWorkshopSearchTool,
  officeWorkshopGetItemTool,
  officeWorkshopDownloadTool,
  officeWorkshopPublishTool,
  officeWorkshopMineTool,
  officeWorkshopUpdateTool,
  officeWorkshopDeleteTool,
  officeHomesteadGetTool,
  officeHomesteadInventoryTool,
  officeHomesteadClaimTool,
  officeHomesteadPlaceTool,
  officeHomesteadRecallTool,
  officeHomesteadMountTool,
  officeHomesteadUnmountTool,
  officeHomesteadOpenBlindBoxTool,
  timerTool,
  tokenCounterStartTool,
  tokenCounterStopTool,
  listToolContractsV2,
  ensureFaqiDir,
  getCurrentFaqiForAgent,
  indexFaqiDefinitions,
  loadFaqiDefinitions,
  readFaqiState,
  resolveToolWhitelistFromFaqi,
  LIST_FAQIS_TOOL_NAME,
  SWITCH_FAQI_TOOL_NAME,
} from "@belldandy/skills";
import { listMemoryFiles, ensureMemoryDir, getGlobalMemoryManager, listGlobalMemoryManagers, type MemoryCategory } from "@belldandy/memory";
import {
  createFileCurrentConversationBindingStore,
  resolveReplyChunkingConfigPath,
  resolveCurrentConversationBindingStorePath,
} from "@belldandy/channels";
import {
  DEFAULT_STATE_DIR_DISPLAY,
  loadIdentityAuthorityProfile,
  type IdentityAuthorityProfile,
  type JsonObject,
} from "@belldandy/protocol";
import {
  AUTO_TASK_REPORT_COUNTER_NAME,
  beginAutoTaskReport,
  getAutoTaskReportFlags,
  recordAutoTaskReportDuration,
  recordAutoTaskReportToken,
} from "../task-auto-report.js";
import { GoalManager } from "../goals/manager.js";
import { parseGoalSessionKey } from "../goals/session.js";
import { WorkflowRuntime } from "../workflow-runtime.js";
import { computeWorkflowToolPolicyHash } from "../workflow-fingerprint.js";
import { registerCodeAuditBuiltinWorkflow } from "../workflow-builtin-code-audit.js";
import { registerParallelResearchBuiltinWorkflow } from "../workflow-builtin-parallel-research.js";
import { resolveWorkflowExecutionPolicy } from "../workflow-execution-policy.js";
import { runWorkflowTool, RUN_WORKFLOW_TOOL_NAME } from "@belldandy/skills";
import { buildContextInjectionPrelude } from "../context-injection.js";
import { bridgeLegacyPluginHooks, initializeExtensionHost } from "../extension-host.js";
import { createOciExtensionRuntimeAdapter } from "../extension-runtime-oci-adapter.js";
import { truncateToolTranscriptContent } from "../tool-transcript.js";
import { buildAgentRuntimePromptSections } from "./gateway-prompt-sections.js";
import { enrichDelegationProtocolTeamWithIdentity } from "../team-identity-governance.js";

const GOAL_TOOL_NAMES = new Set([
  "goal_init",
  "goal_get",
  "goal_list",
  "goal_resume",
  "goal_pause",
  "goal_archive",
  "goal_delete",
  "goal_handoff_get",
  "goal_handoff_generate",
  "goal_retrospect_generate",
  "goal_experience_suggest",
  "goal_method_candidates_generate",
  "goal_skill_candidates_generate",
  "goal_flow_patterns_generate",
  "goal_cross_goal_flow_patterns",
  "goal_review_governance_summary",
  "goal_approval_scan",
  "goal_suggestion_review_list",
  "goal_suggestion_review_workflow_set",
  "goal_suggestion_review_decide",
  "goal_suggestion_review_escalate",
  "goal_suggestion_review_scan",
  "goal_suggestion_publish",
  "goal_checkpoint_list",
  "goal_checkpoint_request",
  "goal_checkpoint_approve",
  "goal_checkpoint_reject",
  "goal_checkpoint_expire",
  "goal_checkpoint_reopen",
  "goal_checkpoint_escalate",
  "goal_capability_plan",
  "goal_orchestrate",
  "task_graph_read",
  "task_graph_create",
  "task_graph_update",
  "task_graph_claim",
  "task_graph_pending_review",
  "task_graph_validating",
  "task_graph_complete",
  "task_graph_block",
  "task_graph_fail",
  "task_graph_skip",
]);

import { startGatewayServer } from "../server.js";
import { createGatewayShutdownRequestOwner } from "../gateway-shutdown-request-owner.js";
import {
  BackgroundContinuationLedger,
  buildBackgroundContinuationRuntimeDoctorReport,
} from "../background-continuation-runtime.js";
import { BackgroundRunCoordinator } from "../background-run-coordinator.js";
import {
  evaluateBackgroundRunBusy,
  type BackgroundRunBusyContext,
} from "../background-run-busy-policy.js";
import { BackgroundRecoveryRuntime } from "../background-recovery-runtime.js";
import { ConversationRunRegistry } from "../conversation-run-registry.js";
import { type HeartbeatRunnerHandle } from "../heartbeat/index.js";
import { createSubTaskBackgroundContinuationLedgerHandler } from "../subtask-background-continuation-ledger.js";
import { RuntimeResilienceTracker } from "../runtime-resilience.js";
import {
  CronStore,
  buildCronRuntimeDoctorReport,
  type CronSchedulerHandle,
} from "../cron/index.js";
import {
  initMCPIntegration,
  shutdownMCPIntegration,
  registerMCPToolsToExecutor,
  getMCPManagerIfInitialized,
  getMCPDiagnostics,
  printMCPStatus,
  createBridgeMcpCapabilities,
} from "../mcp/index.js";
import { createLoggerFromEnv } from "../logger/index.js";
import { ToolsConfigManager } from "../tools-config.js";
import { ToolControlConfirmationStore } from "../tool-control-confirmation-store.js";
import { createFileExternalOutboundAuditStore, resolveExternalOutboundAuditStorePath } from "../external-outbound-audit-store.js";
import { ExternalOutboundConfirmationStore } from "../external-outbound-confirmation-store.js";
import { ExternalOutboundSenderRegistry } from "../external-outbound-sender-registry.js";
import { loadWebhookConfig, IdempotencyManager } from "../webhook/index.js";
import { BELLDANDY_VERSION } from "../version.generated.js";
import { checkForUpdates } from "../update-checker.js";
import { writeMCPDiscoveryWorkspaceDocs, type MCPPromptDiscoveryState } from "../mcp-discovery.js";
import { readMcpRoutingDoctorReport } from "../mcp-config-routing.js";
import { createScopedMemoryManagers } from "../resident-memory-managers.js";
import { loadConversationPromptSnapshotArtifact } from "../conversation-prompt-snapshot.js";
import { PromptSnapshotStore } from "../prompt-snapshot-store.js";
import { readPreflightCompressionPolicyFromEnv } from "../preflight-compression-config.js";
import {
  parsePromptExperimentConfig,
} from "../prompt-observability.js";
import {
  buildToolActionKey,
  buildWarnOnlyDuplicateNotice,
  parseToolDedupGlobalMode,
  parseToolDedupPolicy,
  resolveToolDedupMode,
  summarizeToolDedupPolicy,
  shouldBypassToolDedup,
} from "../task-dedup.js";

// --- Env Loading ---
let runtimePaths = resolveGatewayRuntimePaths({
  env: process.env,
  cwd: process.cwd(),
  gatewayModuleUrl: import.meta.url,
});
let envFiles = resolveEnvFilePaths({ envDir: runtimePaths.envDir });
const ensuredDefaultEnvFiles = ensureDefaultEnvFiles(runtimePaths.envDir);

loadProjectEnvFiles({
  envPath: envFiles.envPath,
  envLocalPath: envFiles.envLocalPath,
});

runtimePaths = resolveGatewayRuntimePaths({
  env: process.env,
  cwd: process.cwd(),
  gatewayModuleUrl: import.meta.url,
});
envFiles = resolveEnvFilePaths({ envDir: runtimePaths.envDir });

// Keep downstream runtimes that resolve their own config paths aligned with Gateway's
// already-resolved runtime directories, especially MCP which reads BELLDANDY_STATE_DIR.
process.env.BELLDANDY_STATE_DIR = runtimePaths.stateDir;
process.env.BELLDANDY_ENV_DIR = runtimePaths.envDir;

// --- Configuration ---
const port = Number(readEnv("BELLDANDY_PORT") ?? "28889");
const host = readEnv("BELLDANDY_HOST") ?? "127.0.0.1"; // Security: Default to localhost
const authMode = (readEnv("BELLDANDY_AUTH_MODE") ?? "none") as "none" | "token" | "password";
const commanderRuntimeSwitches = resolveCommanderRuntimeSwitches(readEnv);
const commanderMode = commanderRuntimeSwitches.commanderMode;
const autoOpenBrowser = readEnv("AUTO_OPEN_BROWSER") === "true";
let authToken = readEnv("BELLDANDY_AUTH_TOKEN");
const launcherSetupAuth = resolveLauncherSetupAuth({
  authMode,
  authToken,
  autoOpenBrowser,
  setupToken: readEnv("SETUP_TOKEN"),
});
authToken = launcherSetupAuth.authToken;
const setupToken = launcherSetupAuth.setupToken;
if (setupToken) {
  process.env.SETUP_TOKEN = setupToken;
  process.env.BELLDANDY_AUTH_TOKEN = setupToken;
}
const authPassword = readEnv("BELLDANDY_AUTH_PASSWORD");
const communityApiEnabled = readEnv("BELLDANDY_COMMUNITY_API_ENABLED") === "true";
const webRoot = runtimePaths.webRoot;
const updateCheckEnabled = readEnv("BELLDANDY_UPDATE_CHECK") !== "false";
const updateCheckApiUrl = readEnv("BELLDANDY_UPDATE_CHECK_API_URL");
const updateCheckTimeoutMs = Number(readEnv("BELLDANDY_UPDATE_CHECK_TIMEOUT_MS") ?? "3000") || 3000;

// Channels
const feishuAppId = readEnv("BELLDANDY_FEISHU_APP_ID");
const feishuAppSecret = readEnv("BELLDANDY_FEISHU_APP_SECRET");
const feishuAgentId = readEnv("BELLDANDY_FEISHU_AGENT_ID");

// Channels - QQ
const qqAppId = readEnv("BELLDANDY_QQ_APP_ID");
const qqAppSecret = readEnv("BELLDANDY_QQ_APP_SECRET");
const qqAgentId = readEnv("BELLDANDY_QQ_AGENT_ID");
const qqSandbox = readEnv("BELLDANDY_QQ_SANDBOX") !== "false";

// Channels - Discord
const discordEnabled = readEnv("BELLDANDY_DISCORD_ENABLED") === "true";
const discordBotToken = readEnv("BELLDANDY_DISCORD_BOT_TOKEN");
const channelRouterEnabled = readEnv("BELLDANDY_CHANNEL_ROUTER_ENABLED") === "true";
const channelRouterDefaultAgentId = readEnv("BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID") ?? "default";

// Heartbeat
const heartbeatEnabled = readEnv("BELLDANDY_HEARTBEAT_ENABLED") === "true";
const heartbeatIntervalRaw = readEnv("BELLDANDY_HEARTBEAT_INTERVAL") ?? "30m";
const heartbeatActiveHoursRaw = readEnv("BELLDANDY_HEARTBEAT_ACTIVE_HOURS"); // e.g. "08:00-23:00"
const dreamAutoHeartbeatEnabled = readEnv("BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED") === "true";

// Cron 定时任务
const cronEnabled = readEnv("BELLDANDY_CRON_ENABLED") === "true";
const dreamAutoCronEnabled = readEnv("BELLDANDY_DREAM_AUTO_CRON_ENABLED") === "true";

// State & Memory
const stateDir = runtimePaths.stateDir;
const channelRouterConfigPath = readEnv("BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH") ?? path.join(stateDir, "channels-routing.json");
const channelSecurityConfigPath = path.join(stateDir, "channel-security.json");
const channelReplyChunkingConfigPath = resolveReplyChunkingConfigPath(stateDir);
const webhookConfigPath = readEnv("BELLDANDY_WEBHOOK_CONFIG_PATH") ?? path.join(stateDir, "webhooks.json");
const webhookIdempotencyWindowMs = Number(readEnv("BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS")) || 10 * 60 * 1000; // 默认 10 分钟
const extraWorkspaceRootsRaw = readEnv("BELLDANDY_EXTRA_WORKSPACE_ROOTS");
const extraWorkspaceRoots = extraWorkspaceRootsRaw
  ? extraWorkspaceRootsRaw
    .split(",")
    .map((p) => path.resolve(p.trim()))
    .filter((p) => p.length > 0)
  : undefined;

// Logger（尽早初始化，后续所有输出走统一日志）
const logger = createLoggerFromEnv(stateDir);
logger.info("gateway", `Environment Dir: ${runtimePaths.envDir}`);
logger.info(
  "gateway",
  `State Dir Source: ${runtimePaths.stateDirSource}${runtimePaths.stateDirBootstrapFilePath ? ` (${runtimePaths.stateDirBootstrapFilePath})` : ""}`,
);
if (ensuredDefaultEnvFiles.createdEnv) {
  logger.info("gateway", `Generated default .env at ${ensuredDefaultEnvFiles.envPath}`);
}
if (ensuredDefaultEnvFiles.createdEnvLocal) {
  logger.info("gateway", `Generated default .env.local at ${ensuredDefaultEnvFiles.envLocalPath}`);
}
const clearedMultimediaCache = await clearMediaUnderstandingCache({ stateDir });
logger.info("gateway", "Cleared multimedia understanding cache on startup", clearedMultimediaCache);

const toolsPolicyFile = readEnv("BELLDANDY_TOOLS_POLICY_FILE");
const toolsPolicyFromFile = toolsPolicyFile ? loadToolsPolicy(toolsPolicyFile, logger) : undefined;
const toolsPolicy = mergePolicy(DEFAULT_POLICY, toolsPolicyFromFile);



// Agent & Tools
const agentProvider = (readEnv("BELLDANDY_AGENT_PROVIDER") ?? "mock") as "mock" | "openai";
const openaiBaseUrl = readEnv("BELLDANDY_OPENAI_BASE_URL");
const openaiApiKey = readEnv("BELLDANDY_OPENAI_API_KEY");
const openaiModel = readEnv("BELLDANDY_OPENAI_MODEL");
const preferredProviderIds = normalizePreferredProviderIds(readEnv("BELLDANDY_MODEL_PREFERRED_PROVIDERS"));
const openaiWireApi = (readEnv("BELLDANDY_OPENAI_WIRE_API") ?? "chat_completions").toLowerCase() === "responses"
  ? "responses"
  : "chat_completions";
const openaiThinking = (() => {
  const raw = readEnv("BELLDANDY_OPENAI_THINKING");
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const normalized = raw.trim();
  if (normalized.startsWith("{")) {
    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      const parsedRecord = parsed as Record<string, unknown>;
      const type = typeof parsedRecord.type === "string"
        ? parsedRecord.type.trim()
        : "";
      if (!type) return undefined;
      return {
        ...parsedRecord,
        type,
      };
    } catch {
      return undefined;
    }
  }
  return { type: normalized };
})();
const openaiReasoningEffort = (() => {
  const raw = readEnv("BELLDANDY_OPENAI_REASONING_EFFORT");
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  return normalized || undefined;
})();
const sanitizeResponsesToolSchema = (readEnv("BELLDANDY_RESPONSES_SANITIZE_TOOL_SCHEMA") ?? "false") === "true";
const openaiMaxRetriesRaw = readEnv("BELLDANDY_OPENAI_MAX_RETRIES");
const openaiMaxRetries = openaiMaxRetriesRaw ? Math.max(0, parseInt(openaiMaxRetriesRaw, 10) || 0) : 0;
const openaiRetryBackoffMsRaw = readEnv("BELLDANDY_OPENAI_RETRY_BACKOFF_MS");
const openaiRetryBackoffMs = openaiRetryBackoffMsRaw ? Math.max(100, parseInt(openaiRetryBackoffMsRaw, 10) || 300) : 300;
const openaiProxyUrl = readEnv("BELLDANDY_OPENAI_PROXY_URL");
const primaryWarmupEnabled = (readEnv("BELLDANDY_PRIMARY_WARMUP_ENABLED") ?? "true") !== "false";
const primaryWarmupTimeoutMsRaw = readEnv("BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS");
const primaryWarmupTimeoutMs = primaryWarmupTimeoutMsRaw ? Math.max(1000, parseInt(primaryWarmupTimeoutMsRaw, 10) || 8000) : 8000;
const primaryWarmupCooldownMsRaw = readEnv("BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS");
const primaryWarmupCooldownMs = primaryWarmupCooldownMsRaw ? Math.max(5000, parseInt(primaryWarmupCooldownMsRaw, 10) || 60000) : 60000;
const openaiStream = (readEnv("BELLDANDY_OPENAI_STREAM") ?? "true") !== "false";
const toolAgentStreamingEnabled = resolveToolAgentStreamingEnabled(
  readEnv("BELLDANDY_TOOL_AGENT_STREAMING_ENABLED"),
);
const openaiSystemPrompt = readEnv("BELLDANDY_OPENAI_SYSTEM_PROMPT");
const agentProtocol = readEnv("BELLDANDY_AGENT_PROTOCOL") as "openai" | "anthropic" | undefined;
const injectAgents = (readEnv("BELLDANDY_INJECT_AGENTS") ?? "true") !== "false";
const injectSoul = (readEnv("BELLDANDY_INJECT_SOUL") ?? "true") !== "false";
const injectMemory = (readEnv("BELLDANDY_INJECT_MEMORY") ?? "true") !== "false";
const injectMethodSkillList = (readEnv("BELLDANDY_INJECT_METHOD_SKILL_LIST") ?? "true") !== "false";
const maxSystemPromptCharsRaw = readEnv("BELLDANDY_MAX_SYSTEM_PROMPT_CHARS");
const maxSystemPromptChars = maxSystemPromptCharsRaw ? parseInt(maxSystemPromptCharsRaw, 10) || 0 : 0;
const promptExperimentConfig = parsePromptExperimentConfig({
  disabledSectionIdsRaw: readEnv("BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS"),
  sectionPriorityOverridesRaw: readEnv("BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES"),
  disabledToolContractNamesRaw: readEnv("BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS"),
});


const toolsEnabled = (readEnv("BELLDANDY_TOOLS_ENABLED") ?? "false") === "true";
const agentToolControlModeRaw = (readEnv("BELLDANDY_AGENT_TOOL_CONTROL_MODE") ?? "disabled").trim().toLowerCase();
const agentToolControlMode: AgentToolControlMode = (
  agentToolControlModeRaw === "auto" || agentToolControlModeRaw === "confirm"
    ? agentToolControlModeRaw
    : "disabled"
);
const agentToolControlConfirmPassword = (readEnv("BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD") ?? "").trim();
const toolGroups = new Set(
  (readEnv("BELLDANDY_TOOL_GROUPS") ?? "all").split(",").map(s => s.trim().toLowerCase()),
);
const allowedConversationKinds = parseConversationAllowedKinds(readEnv("BELLDANDY_CONVERSATION_ALLOWED_KINDS"));
const hasToolGroup = (group: string) => toolGroups.has("all") || toolGroups.has(group);
const agentTimeoutMsRaw = readEnv("BELLDANDY_AGENT_TIMEOUT_MS");
const agentTimeoutMs = agentTimeoutMsRaw ? Math.max(5000, parseInt(agentTimeoutMsRaw, 10) || 120_000) : undefined;
const maxInputTokensRaw = readEnv("BELLDANDY_MAX_INPUT_TOKENS");
const maxInputTokens = maxInputTokensRaw ? parseInt(maxInputTokensRaw, 10) || 0 : 0;
const maxOutputTokensRaw = readEnv("BELLDANDY_MAX_OUTPUT_TOKENS");
// 默认 4096，与硬编码默认值保持一致；用户可调大以避免长输出被截断
const maxOutputTokens = maxOutputTokensRaw ? parseInt(maxOutputTokensRaw, 10) || 4096 : 4096;
const maxToolCallsRaw = readEnv("BELLDANDY_MAX_TOOL_CALLS");
const maxToolCalls = (() => {
  if (!maxToolCallsRaw) return DEFAULT_MAX_TOOL_CALLS;
  const value = parseInt(maxToolCallsRaw, 10);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_MAX_TOOL_CALLS;
  return Math.floor(value);
})();
const maxRunWallTimeMsRaw = readEnv("BELLDANDY_MAX_RUN_WALL_TIME_MS");
const maxRunWallTimeMs = normalizeMaxRunWallTimeMs(
  maxRunWallTimeMsRaw ? Number(maxRunWallTimeMsRaw) : undefined,
);
const maxTotalTokensRaw = readEnv("BELLDANDY_MAX_TOTAL_TOKENS");
const maxTotalTokens = normalizeMaxTotalTokens(
  maxTotalTokensRaw ? Number(maxTotalTokensRaw) : undefined,
);
const maxHighRiskToolCallsRaw = readEnv("BELLDANDY_MAX_HIGH_RISK_TOOL_CALLS");
const maxHighRiskToolCalls = normalizeMaxHighRiskToolCalls(
  maxHighRiskToolCallsRaw ? Number(maxHighRiskToolCallsRaw) : undefined,
);
const toolLoopIterationBudgetRaw = readEnv("BELLDANDY_TOOL_LOOP_ITERATION_BUDGET");
const toolLoopIterationBudget = (() => {
  if (!toolLoopIterationBudgetRaw) return DEFAULT_TOOL_LOOP_ITERATION_BUDGET;
  const value = parseInt(toolLoopIterationBudgetRaw, 10);
  if (!Number.isFinite(value)) return DEFAULT_TOOL_LOOP_ITERATION_BUDGET;
  return value <= 0 ? 0 : Math.max(1, Math.floor(value));
})();
const toolLoopWarningFractionRaw = readEnv("BELLDANDY_TOOL_LOOP_WARNING_FRACTION");
const toolLoopWarningFraction = (() => {
  if (!toolLoopWarningFractionRaw) return 0.7;
  const value = parseFloat(toolLoopWarningFractionRaw);
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(1, Math.max(0, value));
})();

// Compaction 配置
const compactionEnabled = readEnv("BELLDANDY_COMPACTION_ENABLED") !== "false";
const providerCapability = resolveProviderCapabilityFromEnv(readEnv);
const toolCallRepairLevel = providerCapability.jsonReliability === "low"
  ? "full"
  : (providerCapability.jsonReliability === "medium" ? "dedupe" : "off");
const preservePrimaryPrefixStability = providerCapability.cache === "supported";
const compactionFallbackTokenThreshold = parseInt(readEnv("BELLDANDY_COMPACTION_THRESHOLD") || "12000", 10);
const compactionContextWindowFraction = parseFloat(readEnv("BELLDANDY_COMPACTION_CONTEXT_WINDOW_FRACTION") || "0.1") || 0.1;
const compactionTokenThreshold = resolveCompactionThreshold({
  fallbackThreshold: compactionFallbackTokenThreshold,
  contextWindow: providerCapability.contextWindow,
  contextWindowFraction: compactionContextWindowFraction,
}).tokenThreshold;
const compactionTriggerFraction = parseFloat(readEnv("BELLDANDY_COMPACTION_TRIGGER_FRACTION") || "0.75") || 0.75;
const compactionArchivalThreshold = parseInt(readEnv("BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD") || "2000", 10);
const compactionWarningThreshold = parseInt(
  readEnv("BELLDANDY_COMPACTION_WARNING_THRESHOLD") || String(Math.max(1024, Math.floor(compactionTokenThreshold * 0.7))),
  10,
);
const compactionBlockingThreshold = parseInt(
  readEnv("BELLDANDY_COMPACTION_BLOCKING_THRESHOLD") || String(Math.max(compactionWarningThreshold + 1, Math.floor(compactionTokenThreshold * 0.9))),
  10,
);
const compactionMaxConsecutiveFailures = parseInt(readEnv("BELLDANDY_COMPACTION_MAX_CONSECUTIVE_FAILURES") || "3", 10);
const compactionMaxPromptTooLongRetries = parseInt(readEnv("BELLDANDY_COMPACTION_MAX_PTL_RETRIES") || "2", 10);
const compactionModelRouteRef = readEnv("BELLDANDY_COMPACTION_MODEL_ROUTE");
const deepSeekRoutePolicyEnabled = String(readEnv("BELLDANDY_DEEPSEEK_ROUTE_POLICY_ENABLED") ?? "true").trim().toLowerCase() !== "false";
const compactionModel = readEnv("BELLDANDY_COMPACTION_MODEL");
const compactionBaseUrl = readEnv("BELLDANDY_COMPACTION_BASE_URL");
const compactionApiKey = readEnv("BELLDANDY_COMPACTION_API_KEY");

// Video File Upload (dedicated endpoint when chat proxy doesn't support /files)
const videoFileApiUrl = readEnv("BELLDANDY_VIDEO_FILE_API_URL");
const videoFileApiKey = readEnv("BELLDANDY_VIDEO_FILE_API_KEY");
const videoUploadConfig: VideoUploadConfig | undefined =
  videoFileApiUrl ? { apiUrl: videoFileApiUrl, apiKey: videoFileApiKey || openaiApiKey || "" } : undefined;

// Model Failover
const modelConfigFile = readEnv("BELLDANDY_MODEL_CONFIG_FILE")
  ?? path.join(stateDir, "models.json");
let modelFallbacks: ModelProfile[] = [];
try {
  modelFallbacks = await loadModelFallbacks(modelConfigFile);
  if (modelFallbacks.length > 0) {
    logger.info("failover", `加载了 ${modelFallbacks.length} 个备用模型 Profile (from ${modelConfigFile})`);
  }
} catch (err) {
  logger.warn("failover", `加载备用模型配置失败: ${String(err)}`);
}

// Agent Profiles (Multi-Agent 预备)
const agentsConfigFile = path.join(stateDir, "agents.json");
const loadedAgentProfiles = await loadAgentProfiles(agentsConfigFile);
if (loadedAgentProfiles.length > 0) {
  logger.info("agent-profile", `加载了 ${loadedAgentProfiles.length} 个 Agent Profile (from ${agentsConfigFile})`);
}
const builtinWorkerProfiles = buildBuiltinWorkerProfiles().filter((profile) =>
  !loadedAgentProfiles.some((item) => item.id === profile.id)
);
if (builtinWorkerProfiles.length > 0) {
  logger.info("agent-profile", `启用 ${builtinWorkerProfiles.length} 个内建 Worker Profile: [${builtinWorkerProfiles.map((profile) => profile.id).join(", ")}]`);
}
const agentProfiles = [...loadedAgentProfiles, ...builtinWorkerProfiles];

// MCP
const mcpEnabled = (readEnv("BELLDANDY_MCP_ENABLED") ?? "false") === "true";


// --- Background Run Coordination ---

const codingRunRecoveryStore = new CodingRunRecoveryMarkerStore(stateDir);
const conversationRunRegistry = new ConversationRunRegistry({ recoveryStore: codingRunRecoveryStore });
const backgroundRunCoordinator = new BackgroundRunCoordinator({
  getForegroundActiveCount: () => conversationRunRegistry.getRuntimeSnapshot().activeCount,
});
const memoryBackgroundRuntime = await createGatewayMemoryBackgroundRuntime({
  stateDir,
  runCoordinator: backgroundRunCoordinator,
  logger: {
    warn: (message, data) => logger.warn("memory-usage", message, data),
  },
});
const isBusy = (context?: BackgroundRunBusyContext) => evaluateBackgroundRunBusy(
  backgroundRunCoordinator.getRuntimeSnapshot(),
  context,
).busy;

// --- Validation ---
if (!Number.isFinite(port) || port <= 0) {
  throw new Error("Invalid BELLDANDY_PORT");
}

if (authMode === "token" && !authToken) {
  throw new Error("BELLDANDY_AUTH_MODE=token requires BELLDANDY_AUTH_TOKEN");
}

if (authMode === "password" && !authPassword) {
  throw new Error("BELLDANDY_AUTH_MODE=password requires BELLDANDY_AUTH_PASSWORD");
}

// [MODIFIED] Lenient Mode: Removed strict check for OpenAI keys here.
// Validation happens lazily in createAgent.
/*
if (agentProvider === "openai") {
  if (!openaiBaseUrl) throw new Error("BELLDANDY_AGENT_PROVIDER=openai requires BELLDANDY_OPENAI_BASE_URL");
  if (!openaiApiKey) throw new Error("BELLDANDY_AGENT_PROVIDER=openai requires BELLDANDY_OPENAI_API_KEY");
  if (!openaiModel) throw new Error("BELLDANDY_AGENT_PROVIDER=openai requires BELLDANDY_OPENAI_MODEL");
}
*/

// Security Check: Reject unsafe configuration
if ((host === "0.0.0.0" || host === "::") && authMode === "none") {
  logger.error("gateway", "FATAL: Cannot bind to 0.0.0.0 with AUTH_MODE=none");
  logger.error("gateway", "Set BELLDANDY_AUTH_MODE=token and BELLDANDY_AUTH_TOKEN in .env to enable public access");
  process.exit(1);
}

// Security Check: Community API should never run with AUTH_MODE=none
if (communityApiEnabled && authMode === "none") {
  logger.error("gateway", "FATAL: BELLDANDY_COMMUNITY_API_ENABLED=true cannot be used with BELLDANDY_AUTH_MODE=none");
  logger.error("gateway", "Set BELLDANDY_AUTH_MODE=token (recommended) or password before enabling /api/message");
  process.exit(1);
}

// --- Initialization ---

// 1. Ensure state dir exists
if (!fs.existsSync(stateDir)) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {
    // ignore
  }
}

// 1.5 Ensure methods and facets dir exists
const methodsDir = path.join(stateDir, "methods");
if (!fs.existsSync(methodsDir)) {
  try {
    fs.mkdirSync(methodsDir, { recursive: true });
  } catch {
    // ignore
  }
}

const facetsDir = path.join(stateDir, "facets");
if (!fs.existsSync(facetsDir)) {
  try {
    fs.mkdirSync(facetsDir, { recursive: true });
  } catch {
    // ignore
  }
}

const faqisDir = path.join(stateDir, "faqis");
if (!fs.existsSync(faqisDir)) {
  try {
    fs.mkdirSync(faqisDir, { recursive: true });
  } catch {
    // ignore
  }
}

// 1.6 Ensure agents dir exists
const agentsDir = path.join(stateDir, "agents");
if (!fs.existsSync(agentsDir)) {
  try {
    fs.mkdirSync(agentsDir, { recursive: true });
  } catch {
    // ignore
  }
}

// 2. Memory: unified MemoryManager created after sessionsDir init (see section 7.5b)
const memoryRuntimeSwitches = resolveMemoryRuntimeSwitches(readEnv);
if (!memoryRuntimeSwitches.masterEnabled) {
  logger.warn("memory", "BELLDANDY_MEMORY_ENABLED=false — runtime memory features disabled while static workspace prompt injection remains unchanged.");
}

// 2.5 Init Embedding Provider (configured via env for MemoryManager)
const embeddingEnabled = memoryRuntimeSwitches.embeddingEnabled;
if (embeddingEnabled && !openaiApiKey) {
  logger.warn("memory", "BELLDANDY_EMBEDDING_ENABLED=true but no OpenAI API key, skipping");
}

// [SECURITY] 危险工具需显式启用
const dangerousToolsEnabled = readEnv("BELLDANDY_DANGEROUS_TOOLS_ENABLED") === "true";
const agentBridgeEnabled = readEnv("BELLDANDY_AGENT_BRIDGE_ENABLED") === "true";
const readExternalOutboundRequireConfirmation = () => readEnv("BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION") !== "false";
const readEmailOutboundRequireConfirmation = () => {
  const value = readEnv("BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION");
  return value ? value !== "false" : readExternalOutboundRequireConfirmation();
};
const emailDefaultProviderId = readEnv("BELLDANDY_EMAIL_DEFAULT_PROVIDER")?.trim() || "smtp";
const emailSmtpEnabled = readEnv("BELLDANDY_EMAIL_SMTP_ENABLED") === "true";
const emailSmtpAccountId = readEnv("BELLDANDY_EMAIL_SMTP_ACCOUNT_ID")?.trim() || "default";
const emailSmtpHost = readEnv("BELLDANDY_EMAIL_SMTP_HOST")?.trim() || "";
const emailSmtpPortRaw = Number(readEnv("BELLDANDY_EMAIL_SMTP_PORT") || "587");
const emailSmtpPort = Number.isFinite(emailSmtpPortRaw) && emailSmtpPortRaw > 0 ? Math.floor(emailSmtpPortRaw) : 587;
const emailSmtpSecure = readEnv("BELLDANDY_EMAIL_SMTP_SECURE") === "true";
const emailSmtpUser = readEnv("BELLDANDY_EMAIL_SMTP_USER")?.trim() || "";
const emailSmtpPass = readEnv("BELLDANDY_EMAIL_SMTP_PASS")?.trim() || "";
const emailSmtpFromAddress = readEnv("BELLDANDY_EMAIL_SMTP_FROM_ADDRESS")?.trim() || "";
const emailSmtpFromName = readEnv("BELLDANDY_EMAIL_SMTP_FROM_NAME")?.trim() || "";
const emailInboundAgentId = readEnv("BELLDANDY_EMAIL_INBOUND_AGENT_ID")?.trim() || "default";
const emailImapEnabled = readEnv("BELLDANDY_EMAIL_IMAP_ENABLED") === "true";
const emailImapAccountId = readEnv("BELLDANDY_EMAIL_IMAP_ACCOUNT_ID")?.trim() || "default";
const emailImapHost = readEnv("BELLDANDY_EMAIL_IMAP_HOST")?.trim() || "";
const emailImapPortRaw = Number(readEnv("BELLDANDY_EMAIL_IMAP_PORT") || "993");
const emailImapPort = Number.isFinite(emailImapPortRaw) && emailImapPortRaw > 0 ? Math.floor(emailImapPortRaw) : 993;
const emailImapSecure = (readEnv("BELLDANDY_EMAIL_IMAP_SECURE") ?? "true") !== "false";
const emailImapUser = readEnv("BELLDANDY_EMAIL_IMAP_USER")?.trim() || "";
const emailImapPass = readEnv("BELLDANDY_EMAIL_IMAP_PASS")?.trim() || "";
const emailImapMailbox = readEnv("BELLDANDY_EMAIL_IMAP_MAILBOX")?.trim() || "INBOX";
const emailImapPollIntervalMsRaw = Number(readEnv("BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS") || "60000");
const emailImapPollIntervalMs = Number.isFinite(emailImapPollIntervalMsRaw) && emailImapPollIntervalMsRaw > 0
  ? Math.floor(emailImapPollIntervalMsRaw)
  : 60_000;
const emailImapConnectTimeoutMsRaw = Number(readEnv("BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS") || "10000");
const emailImapConnectTimeoutMs = Number.isFinite(emailImapConnectTimeoutMsRaw) && emailImapConnectTimeoutMsRaw > 0
  ? Math.floor(emailImapConnectTimeoutMsRaw)
  : 10_000;
const emailImapSocketTimeoutMsRaw = Number(readEnv("BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS") || "20000");
const emailImapSocketTimeoutMs = Number.isFinite(emailImapSocketTimeoutMsRaw) && emailImapSocketTimeoutMsRaw > 0
  ? Math.floor(emailImapSocketTimeoutMsRaw)
  : 20_000;
const emailImapBootstrapMode = readEnv("BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE")?.trim().toLowerCase() === "all"
  ? "all"
  : "latest";
const emailImapRecentWindowLimitRaw = Number(readEnv("BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT") || "0");
const emailImapRecentWindowLimit = Number.isFinite(emailImapRecentWindowLimitRaw) && emailImapRecentWindowLimitRaw > 0
  ? Math.floor(emailImapRecentWindowLimitRaw)
  : 0;

// Cron Store（无论是否启用调度器，工具都可以管理任务）
const cronStore = new CronStore(stateDir);
const backgroundContinuationLedger = new BackgroundContinuationLedger(stateDir);
let backgroundRecoveryRuntime: BackgroundRecoveryRuntime | undefined;
let heartbeatRunner: HeartbeatRunnerHandle | undefined;
let cronSchedulerHandle: CronSchedulerHandle | undefined;
let emailInboundRuntimeHandle: Awaited<ReturnType<typeof startImapPollingEmailInboundRuntime>> | undefined;
let starweaverActiveNotifyRuntimeHandle: Awaited<ReturnType<typeof startStarweaverActiveNotifyRuntime>> | undefined;
let browserRelayRuntimeHandle: Awaited<ReturnType<typeof startBrowserRelayRuntime>> | undefined;

type GatewaySystemRestartOptions = {
  countdownSeconds?: number;
  graceMs?: number;
  broadcast?: boolean;
};
let requestGatewaySystemRestart: (
  reason: string,
  options?: GatewaySystemRestartOptions,
) => void = () => {
  throw new Error("Gateway shutdown request owner is not ready.");
};

// 延迟绑定 broadcast：工具注册时 server 尚未创建，执行时才调用
  let serverBroadcast: ((msg: unknown) => void) | undefined;

  function emitConversationToolEvent(conversationId: string | undefined, detail: Record<string, unknown>): void {
    const normalizedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!normalizedConversationId) {
      return;
    }

    notifyConversationToolEvent(normalizedConversationId, detail);
    serverBroadcast?.({
      type: "event",
      event: "tool_event",
      payload: {
        conversationId: normalizedConversationId,
        ...detail,
      },
    });
  }

// 2.5 Init ToolsConfigManager (调用设置)
const toolsConfigManager = new ToolsConfigManager(stateDir, {
  info: (m) => logger.info("tools-config", m),
  warn: (m) => logger.warn("tools-config", m),
});
await toolsConfigManager.load();
await ensureFaqiDir(stateDir);
const faqiState = await readFaqiState(stateDir);
const { definitions: faqiDefinitions, issues: faqiLoadIssues } = await loadFaqiDefinitions(stateDir);
const faqiDefinitionsByName = indexFaqiDefinitions(faqiDefinitions);
for (const issue of faqiLoadIssues) {
  logger.warn("faqi", `Ignored invalid FAQI "${issue.name}" (${issue.filePath}): ${issue.message}`);
}
const toolControlConfirmationStore = new ToolControlConfirmationStore();
const externalOutboundConfirmationStore = new ExternalOutboundConfirmationStore();
const emailOutboundConfirmationStore = new EmailOutboundConfirmationStore();
const currentConversationBindingStore = createFileCurrentConversationBindingStore(
  resolveCurrentConversationBindingStorePath(stateDir),
);

// 3. Init Executor (conditional)
// Inject browser logger before registering tools
if (toolsEnabled) {
  const { setBrowserLogger } = await import("@belldandy/skills");
  setBrowserLogger(logger.child("browser"));
}

const gatewayToolPoolAssembler = new ToolPoolAssembler([
  {
    tools: [
      fetchTool,
      applyPatchTool,
      fileReadTool,
      fileWriteTool,
      fileDeleteTool,
      listFilesTool,
      textSearchTool,
      fileGlobTool,
      createMemorySearchTool(),
      createMemoryGetTool(),
      memoryReadTool,
      memoryWriteTool,
      memorySharePromoteTool,
      taskSearchTool,
      taskGetTool,
      taskRecentTool,
      taskPromoteMethodTool,
      taskPromoteSkillDraftTool,
      experienceCandidateGetTool,
      experienceCandidateListTool,
      experienceCandidateAcceptTool,
      experienceCandidateRejectTool,
      experienceUsageGetTool,
      experienceUsageListTool,
      experienceUsageRecordTool,
      experienceUsageRevokeTool,
      getUserUuidTool,
      getMessageSenderInfoTool,
      getRoomMembersTool,
      createLeaveRoomTool(undefined),
      createJoinRoomTool(undefined),
      ptcRuntimeTool,
      officeWorkshopSearchTool,
      officeWorkshopGetItemTool,
      officeWorkshopDownloadTool,
      officeWorkshopPublishTool,
      officeWorkshopMineTool,
      officeWorkshopUpdateTool,
      officeWorkshopDeleteTool,
      officeHomesteadGetTool,
      officeHomesteadInventoryTool,
      officeHomesteadClaimTool,
      officeHomesteadPlaceTool,
      officeHomesteadRecallTool,
      officeHomesteadMountTool,
      officeHomesteadUnmountTool,
      officeHomesteadOpenBlindBoxTool,
      timerTool,
      tokenCounterStartTool,
      tokenCounterStopTool,
      planCurrentGetTool,
      planCurrentUpdateTool,
      goalInitTool,
      goalGetTool,
      goalListTool,
      goalResumeTool,
      goalPauseTool,
      goalHandoffGenerateTool,
      goalRetrospectGenerateTool,
      goalExperienceSuggestTool,
      goalMethodCandidatesGenerateTool,
      goalSkillCandidatesGenerateTool,
      goalFlowPatternsGenerateTool,
      goalCrossGoalFlowPatternsTool,
      goalReviewGovernanceSummaryTool,
      goalApprovalScanTool,
      goalSuggestionReviewListTool,
      goalSuggestionReviewWorkflowSetTool,
      goalSuggestionReviewDecideTool,
      goalSuggestionReviewEscalateTool,
      goalSuggestionReviewScanTool,
      goalSuggestionPublishTool,
      goalCheckpointListTool,
      goalCheckpointRequestTool,
      goalCheckpointApproveTool,
      goalCheckpointRejectTool,
      goalCheckpointExpireTool,
      goalCheckpointReopenTool,
      goalCheckpointEscalateTool,
      goalCapabilityPlanTool,
      goalOrchestrateTool,
      goalCommanderDecideTool,
      taskGraphReadTool,
      taskGraphCreateTool,
      taskGraphUpdateTool,
      taskGraphClaimTool,
      taskGraphPendingReviewTool,
      taskGraphValidatingTool,
      taskGraphCompleteTool,
      taskGraphBlockTool,
      taskGraphFailTool,
      taskGraphSkipTool,
      sessionsSpawnTool,
      sessionsHistoryTool,
      delegateTaskTool,
      delegateParallelTool,
      conversationListTool,
      conversationReadTool,
      retrieveToolResultTool,
      ...(agentBridgeEnabled ? [
        bridgeTargetListTool,
        bridgeTargetDiagnoseTool,
        bridgeRunTool,
        bridgeSessionStartTool,
        bridgeSessionWriteTool,
        bridgeSessionReadTool,
        bridgeSessionStatusTool,
        bridgeSessionCloseTool,
        bridgeSessionListTool,
      ] : []),
    ],
  },
  {
    tool: runCommandTool,
  },
  {
    tool: commandJobTool,
  },
  {
    group: "browser",
    tools: [
      browserOpenTool,
      browserNavigateTool,
      browserClickTool,
      browserTypeTool,
      browserScreenshotTool,
      browserGetContentTool,
    ],
  },
  {
    group: "multimedia",
    tools: [
      cameraDeviceMemoryTool,
      cameraListTool,
      cameraSnapTool,
      screenListTargetsTool,
      screenCaptureTool,
      multimediaCacheClearTool,
      imageGenerateTool,
      imageUnderstandTool,
      videoUnderstandTool,
      textToSpeechTool,
    ],
  },
  {
    group: "methodology",
    tools: [
      methodListTool,
      methodReadTool,
      methodCreateTool,
      methodSearchTool,
    ],
  },
  {
    group: "system",
    factory: async () => [
      logReadTool,
      logSearchTool,
      createCronTool({
        store: cronStore,
        scheduler: {
          status: () => cronSchedulerHandle?.status() ?? { running: false, activeRuns: 0 },
        },
      }),
      createServiceRestartTool(
        (msg) => serverBroadcast?.(msg),
        (reason) => requestGatewaySystemRestart(reason, {
          countdownSeconds: 0,
          graceMs: 300,
          broadcast: false,
        }),
      ),
      listFaqisTool,
      switchFaqiTool,
      switchFacetTool,
    ],
  },
  {
    group: "canvas",
    factory: async () => createCanvasTools((msg) => serverBroadcast?.(msg)),
  },
]);

const DELEGATION_TOOL_NAMES = new Set([
  "sessions_spawn",
  "delegate_task",
  "delegate_parallel",
]);

const gatewayContractAccessPolicy: ToolContractAccessPolicy = {
  channel: "gateway",
  allowedSafeScopes: resolveSafeScopesForChannel("gateway"),
  includeToolsWithoutContract: false,
  blockedToolNames: dangerousToolsEnabled ? [] : [runCommandTool.definition.name, commandJobTool.definition.name],
};

const toolsToRegister = toolsEnabled
  ? await gatewayToolPoolAssembler.assemble({
    ...gatewayContractAccessPolicy,
    requireToolContracts: true,
    enabledGroups: toolGroups,
  })
  : [];

const HEAVY_BUILTIN_DISCOVERY_FAMILIES: Record<string, ToolDiscoveryFamilyDefinition> = {
  goals: {
    id: "goals",
    title: "Goals",
    summary: "Long-running goal governance, checkpoints, orchestration, retrospective, and task graph operations.",
    gateMode: "hidden-until-expanded",
    order: 10,
    keywords: ["goal", "governance", "checkpoint", "orchestrate", "task graph", "long-running"],
  },
  office: {
    id: "office",
    title: "Office",
    summary: "Remote office workshop and homestead operations, including download, publish, inventory, and placement actions.",
    gateMode: "hidden-until-expanded",
    order: 20,
    keywords: ["office", "workshop", "homestead", "publish", "download", "inventory"],
  },
  browser: {
    id: "browser",
    title: "Browser",
    summary: "Interactive browser automation for opening pages, navigating, clicking, typing, screenshot capture, and page content reads.",
    gateMode: "hidden-until-expanded",
    order: 30,
    keywords: ["browser", "web page", "navigate", "click", "type", "screenshot"],
  },
  canvas: {
    id: "canvas",
    title: "Canvas",
    summary: "Structured canvas board operations for reading, creating, editing nodes and edges, layout, and snapshots.",
    gateMode: "hidden-until-expanded",
    order: 40,
    keywords: ["canvas", "board", "node", "edge", "layout", "snapshot"],
  },
};

function resolveHeavyBuiltinDiscoveryFamily(toolName: string): ToolDiscoveryFamilyDefinition | undefined {
  if (toolName.startsWith("goal_") || toolName.startsWith("task_graph_")) {
    return HEAVY_BUILTIN_DISCOVERY_FAMILIES.goals;
  }
  if (toolName.startsWith("office_")) {
    return HEAVY_BUILTIN_DISCOVERY_FAMILIES.office;
  }
  if (toolName.startsWith("browser_")) {
    return HEAVY_BUILTIN_DISCOVERY_FAMILIES.browser;
  }
  if (toolName.startsWith("canvas_")) {
    return HEAVY_BUILTIN_DISCOVERY_FAMILIES.canvas;
  }
  return undefined;
}

function applyHeavyBuiltinDiscoveryFamilies(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    const family = resolveHeavyBuiltinDiscoveryFamily(tool.definition.name);
    if (family) {
      tool.definition.discoveryFamily = family;
    }
    return tool;
  });
}

const runtimeToolsToRegister = applyHeavyBuiltinDiscoveryFamilies(toolsToRegister);

const gatewayExecutorContractAccessPolicy: ToolContractAccessPolicy = {
  ...gatewayContractAccessPolicy,
  blockedToolNames: [
    ...(gatewayContractAccessPolicy.blockedToolNames ? Array.from(gatewayContractAccessPolicy.blockedToolNames) : []),
    ...(promptExperimentConfig?.disabledToolContractNames ?? []),
  ],
};

const CORE_TOOL_NAMES = new Set<string>([
  TOOL_SETTINGS_CONTROL_NAME,
  TOOL_SEARCH_NAME,
  LIST_FAQIS_TOOL_NAME,
  SWITCH_FAQI_TOOL_NAME,
  applyPatchTool.definition.name,
  fileReadTool.definition.name,
  listFilesTool.definition.name,
  textSearchTool.definition.name,
  fileGlobTool.definition.name,
  commandJobTool.definition.name,
  runCommandTool.definition.name,
]);

const deferredToolNames = runtimeToolsToRegister
  .map((tool) => tool.definition.name)
  .filter((name) => !CORE_TOOL_NAMES.has(name));

let agentRegistry: AgentRegistry | undefined;
const autoTaskReportFlags = getAutoTaskReportFlags();
const AGENT_META_ALWAYS_ALLOWED_TOOLS = new Set<string>([
  TOOL_SETTINGS_CONTROL_NAME,
  TOOL_SEARCH_NAME,
  LIST_FAQIS_TOOL_NAME,
  SWITCH_FAQI_TOOL_NAME,
  switchFacetTool.definition.name,
]);
const workspaceRevisionRuntime = new WorkspaceRevisionRuntime({ stateDir });
const workspaceChangeReviewRuntime = new WorkspaceChangeReviewRuntime({
  stateDir,
  workspaceRevisionRuntime,
});
const userWorktreeRuntime = new UserWorktreeRuntime(stateDir);
const remoteDeliveryRuntime = new RemoteDeliveryRuntime({
  stateDir,
  targets: parseRemoteDeliveryTargets(readEnv("BELLDANDY_REMOTE_DELIVERY_TARGETS_JSON")),
  pullRequests: new GhPullRequestClient(),
});
const pendingToolPermissionRuntime = new PendingToolPermissionRuntime({
  onRequested: (request) => {
    emitConversationToolEvent(request.conversationId, {
      kind: "coding_run_permission_requested",
      agentRunId: request.agentRunId,
      ...(request.worktreeId ? { worktreeId: request.worktreeId } : {}),
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      ...(request.commandPreview ? { commandPreview: request.commandPreview } : {}),
    });
  },
});
const toolExecutor: ToolExecutor = new ToolExecutor({
  tools: runtimeToolsToRegister,
  workspaceRoot: stateDir, // Use the resolved state directory as the workspace root for file operations
  stateDir,
  workspaceMutationObserver: workspaceRevisionRuntime,
  permissionController: pendingToolPermissionRuntime,
  extraWorkspaceRoots, // 额外允许 file_read/file_write/file_delete 的根目录（如其他盘符）
  alwaysEnabledTools: toolsEnabled ? [TOOL_SETTINGS_CONTROL_NAME, TOOL_SEARCH_NAME] : [],
  policy: toolsPolicy,
  contractAccessPolicy: gatewayExecutorContractAccessPolicy,
  requireToolContracts: true,
  deferredToolNames,
  allowedConversationKinds,
  isToolDisabled: (name) => toolsConfigManager.isToolDisabled(name),
  isToolAllowedForAgent: (toolName, agentId, role): boolean => {
    if (AGENT_META_ALWAYS_ALLOWED_TOOLS.has(toolName)) {
      return true;
    }
    const resolvedAgentId = typeof agentId === "string" && agentId.trim()
      ? agentId.trim()
      : "default";
    const profile = agentRegistry?.getProfile(resolvedAgentId);
    const contract = toolExecutor.getRegisteredToolContract(toolName);
    return isAgentToolAllowed({
      agentId: resolvedAgentId,
      role,
      toolName,
      contract,
      profile,
    });
  },
  isToolAllowedInConversation: (toolName, conversationId) => {
    if (!GOAL_TOOL_NAMES.has(toolName)) {
      return true;
    }
    return Boolean(parseGoalSessionKey(conversationId));
  },
  getAgentCatalogPreferences: (agentId) => {
    const resolvedAgentId = typeof agentId === "string" && agentId.trim()
      ? agentId.trim()
      : "default";
    const profile = agentRegistry?.getProfile(resolvedAgentId);
    if (!profile) {
      return undefined;
    }
    const catalog = resolveAgentProfileCatalogMetadata(profile);
    return {
      methods: catalog.methods,
      skills: catalog.skills,
    };
  },
  broadcast: (event, payload) => {
    serverBroadcast?.({ type: "event", event, payload });
  },
  onTokenCounterSet: (conversationId, counter) => {
    if (!autoTaskReportFlags.tokenEnabled || !conversationId) {
      return;
    }
    try {
      counter.start(AUTO_TASK_REPORT_COUNTER_NAME);
    } catch (err) {
      logger.warn(
        "auto-task-report",
        `Failed to start auto task report counter for session ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
  auditLogger: (log) => {
    const msg = formatToolAuditLogMessage(log);
    if (shouldDebugToolAuditLog(log)) {
      logger.debug("tools", msg, { toolName: log.toolName, success: log.success, durationMs: log.durationMs });
      return;
    }
    logger.info("tools", msg, { toolName: log.toolName, success: log.success, durationMs: log.durationMs });
  },
  logger: {
    info: (m) => logger.info("tools", m),
    warn: (m) => logger.warn("tools", m),
    error: (m) => logger.error("tools", m),
    debug: (m) => logger.debug("tools", m),
  },
});
const externalOutboundSenderRegistry = new ExternalOutboundSenderRegistry(currentConversationBindingStore);
const externalOutboundAuditStore = createFileExternalOutboundAuditStore(
  resolveExternalOutboundAuditStorePath(stateDir),
);
const emailOutboundProviderRegistry = new EmailOutboundProviderRegistry();
const emailOutboundAuditStore = createFileEmailOutboundAuditStore(
  resolveEmailOutboundAuditStorePath(stateDir),
);
const emailInboundAuditStore = createFileEmailInboundAuditStore(
  resolveEmailInboundAuditStorePath(stateDir),
);
const emailFollowUpReminderStore = createFileEmailFollowUpReminderStore(
  resolveEmailFollowUpReminderStorePath(stateDir),
);
const emailThreadBindingStore = createFileEmailThreadBindingStore(
  resolveEmailThreadBindingStorePath(stateDir),
);
const emailInboundCheckpointStore = createFileEmailInboundCheckpointStore(
  resolveEmailInboundCheckpointStorePath(stateDir),
);

if (emailSmtpEnabled) {
  if (!emailSmtpHost || !emailSmtpFromAddress) {
    logger.warn("email", "BELLDANDY_EMAIL_SMTP_ENABLED=true but host/from address is incomplete, skipping SMTP provider registration");
  } else {
    emailOutboundProviderRegistry.register(new SmtpEmailOutboundProvider({
      providerId: "smtp",
      accountId: emailSmtpAccountId,
      host: emailSmtpHost,
      port: emailSmtpPort,
      secure: emailSmtpSecure,
      ...(emailSmtpUser ? { username: emailSmtpUser } : {}),
      ...(emailSmtpPass ? { password: emailSmtpPass } : {}),
      fromAddress: emailSmtpFromAddress,
      ...(emailSmtpFromName ? { fromName: emailSmtpFromName } : {}),
    }), {
      makeDefault: emailDefaultProviderId === "smtp",
    });
    logger.info("email", `registered SMTP outbound provider (account=${emailSmtpAccountId}, host=${emailSmtpHost}, port=${emailSmtpPort}, secure=${emailSmtpSecure})`);
  }
}

if (toolsEnabled) {
  toolExecutor.registerTool(createToolSearchTool({
    getDiscoveryEntries: (conversationId?: string, agentId?: string, expandedFamilyIds?: string[]) =>
      toolExecutor.getDiscoveryEntries(agentId, conversationId, undefined, { expandedFamilyIds }),
    getLoadedDeferredToolList: (conversationId: string) =>
      toolExecutor.getLoadedDeferredToolList(conversationId),
    loadDeferredTools: (conversationId: string, toolNames: string[]) =>
      toolExecutor.loadDeferredTools(conversationId, toolNames),
    unloadDeferredTools: (conversationId: string, toolNames: string[]) =>
      toolExecutor.unloadDeferredTools(conversationId, toolNames),
    clearLoadedDeferredTools: (conversationId: string) =>
      toolExecutor.clearLoadedDeferredTools(conversationId),
    shrinkLoadedDeferredTools: (conversationId: string, toolNames: string[]) =>
      toolExecutor.shrinkLoadedDeferredTools(conversationId, toolNames),
  }), { origin: "core", silentReplace: true });
}

// 4. Log enabled tools
if (toolsEnabled) {
  const safeTools = "web_fetch, apply_patch, file_read, file_write, file_delete, list_files, text_search, file_glob, memory_search, memory_get, memory_read, memory_write, memory_share_promote, task_search, task_get, task_recent, conversation_list, conversation_read, experience_candidate_get, experience_candidate_list, experience_usage_get, experience_usage_list, ptc_runtime, browser_*, log_read, log_search";
  if (dangerousToolsEnabled) {
    logger.warn("tools", "⚠️ DANGEROUS_TOOLS_ENABLED=true: run_command and command_job are active");
    logger.info("tools", `Tools enabled: ${safeTools}, run_command, command_job`);
  } else {
    logger.info("tools", `Tools enabled: ${safeTools}`);
  }
}

let mcpPromptDiscovery: MCPPromptDiscoveryState | undefined;

// 4.1 Initialize MCP and register MCP tools
if (mcpEnabled && toolsEnabled) {
  try {
    logger.info("mcp", "正在初始化 MCP 支持...");
    await initMCPIntegration(logger);
    toolExecutor.setMcpCapabilities(createBridgeMcpCapabilities(() => getMCPManagerIfInitialized()));
    const registeredCount = registerMCPToolsToExecutor(toolExecutor);
    const mcpManager = getMCPManagerIfInitialized();
    if (mcpManager) {
      mcpPromptDiscovery = await writeMCPDiscoveryWorkspaceDocs({
        stateDir,
        serverStates: mcpManager.getAllServerStates(),
      });
      logger.info("mcp", `已生成 MCP discovery docs: ${mcpPromptDiscovery.docsIndexPath}`);
    }
    if (registeredCount > 0) {
      logger.info("mcp", `已启用，注册了 ${registeredCount} 个 MCP 工具`);
    }
    printMCPStatus(logger);
    const mcpRouting = await readMcpRoutingDoctorReport(stateDir);
    if (mcpRouting.parseError) {
      logger.warn("mcp", `Starweaver MCP routing unavailable: ${mcpRouting.parseError}`);
    } else if (mcpRouting.starweaver.status === "local_fallback_active") {
      logger.warn("mcp", `${mcpRouting.starweaver.headline} ${mcpRouting.starweaver.fix ?? ""}`.trim());
    } else if (
      mcpRouting.starweaver.status === "central_primary_placeholder_key"
      || mcpRouting.starweaver.status === "central_primary_unreachable"
      || mcpRouting.starweaver.status === "central_primary_placeholder_key_unreachable"
    ) {
      logger.warn("mcp", `${mcpRouting.starweaver.headline} ${mcpRouting.starweaver.fix ?? ""}`.trim());
    } else if (mcpRouting.starweaver.status === "central_primary") {
      logger.info("mcp", mcpRouting.starweaver.headline);
    }
  } catch (err) {
    logger.warn("mcp", "初始化失败，MCP 工具将不可用", err);
  }
} else if (mcpEnabled && !toolsEnabled) {
  logger.warn("mcp", "BELLDANDY_MCP_ENABLED=true 但 BELLDANDY_TOOLS_ENABLED=false，MCP 需要启用工具系统");
}

// 4.2 Prepare extension host runtime
const hookRegistry = new HookRegistry();
const activeMcpServers: string[] = [];
try {
  const mcpModule = await import("../mcp/index.js");
  const diag = mcpModule.getMCPDiagnostics();
  if (diag) {
    for (const server of diag.servers) {
      if (server.status === "connected") activeMcpServers.push(server.name);
    }
  }
} catch { /* MCP not available */ }

const gatewayMainDirectory = path.dirname(fileURLToPath(import.meta.url));
const currentExtensionHostRoot = path.resolve(gatewayMainDirectory, "..");
const builtExtensionHostRoot = path.resolve(gatewayMainDirectory, "..", "..", "dist");
const extensionHostRoot = fs.existsSync(path.join(currentExtensionHostRoot, "extension-runtime-host-process.js"))
  ? currentExtensionHostRoot
  : builtExtensionHostRoot;
const extensionRuntimeAdmission = await createOciExtensionRuntimeAdapter({
  stateDir,
  hostRoot: extensionHostRoot,
});
if (!extensionRuntimeAdmission.available && extensionRuntimeAdmission.reason !== "not_configured") {
  logger.warn("marketplace", `sandbox-required Extension Host unavailable: ${extensionRuntimeAdmission.reason}`);
}

const extensionHost = await initializeExtensionHost({
  stateDir,
  bundledSkillsDir: runtimePaths.bundledSkillsDir,
  workspaceRoot: stateDir,
  toolsEnabled,
  toolExecutor,
  toolsConfigManager,
  logger,
  activeMcpServers,
  hookRegistry,
  ...(extensionRuntimeAdmission.available
    ? { extensionRuntimeAdapter: extensionRuntimeAdmission.adapter }
    : { extensionRuntimeUnavailableReason: extensionRuntimeAdmission.reason }),
});

const {
  pluginRegistry,
  skillRegistry,
  promptSkills,
  searchableSkills,
} = extensionHost;
const runtimeMethodAssetResult = injectMethodSkillList
  ? await loadRuntimeMethodAssetSummaries(stateDir, DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT)
  : { summaries: [], totalCount: 0 };
const runtimeMethodAssets = runtimeMethodAssetResult.summaries;
const runtimePromptSkillAssets = injectMethodSkillList
  ? await buildRuntimeSkillAssetSummaries(promptSkills, DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT)
  : [];
const runtimeSearchableSkillAssets = injectMethodSkillList
  ? await buildRuntimeSkillAssetSummaries(searchableSkills, DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT)
  : [];
const runtimeAllKnownSkills = skillRegistry.listSkills();

if (toolsEnabled) {
  toolExecutor.registerTool(createToolSettingsControlTool({
    toolsConfigManager,
    getControlMode: () => agentToolControlMode,
    getHasConfirmPassword: () => Boolean(agentToolControlConfirmPassword),
    listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
    listPluginIds: () => pluginRegistry.getPluginIds(),
    confirmationStore: toolControlConfirmationStore,
  }), { origin: "core" });
  logger.info("tools", `registered ${TOOL_SETTINGS_CONTROL_NAME} (mode=${agentToolControlMode})`);
  toolExecutor.registerTool(createSendChannelMessageTool({
    senderRegistry: externalOutboundSenderRegistry,
    confirmationStore: externalOutboundConfirmationStore,
    auditStore: externalOutboundAuditStore,
    getRequireConfirmation: readExternalOutboundRequireConfirmation,
  }), { origin: "core" });
  logger.info("tools", `registered send_channel_message (confirm=${readExternalOutboundRequireConfirmation() ? "required" : "auto"})`);
  toolExecutor.registerTool(createSendEmailTool({
    providerRegistry: emailOutboundProviderRegistry,
    confirmationStore: emailOutboundConfirmationStore,
    auditStore: emailOutboundAuditStore,
    reminderStore: emailFollowUpReminderStore,
    normalizeDraft: (draft) => normalizeEmailOutboundDraft(draft as any),
    getRequireConfirmation: readEmailOutboundRequireConfirmation,
    getDefaultAccountId: () => emailSmtpAccountId,
    getDefaultProviderId: () => emailOutboundProviderRegistry.getDefaultProviderId() || emailDefaultProviderId,
  }), { origin: "core" });
  logger.info("tools", `registered send_email (confirm=${readEmailOutboundRequireConfirmation() ? "required" : "auto"}, providers=${emailOutboundProviderRegistry.listProviderIds().join(",") || "none"})`);
}

// 4.4 Bridge plugin hooks → HookRegistry (deferred to after hookRegistry init, see section 7.5)

// 4.5 Ensure memory directory exists (actual indexing deferred to unified MemoryManager)
await ensureMemoryDir(stateDir);
const memoryFilesResult = await listMemoryFiles(stateDir);
if (memoryFilesResult.files.length > 0) {
  logger.info("memory", `found ${memoryFilesResult.files.length} files (MEMORY.md=${memoryFilesResult.hasMainMemory}, daily=${memoryFilesResult.dailyCount})`);
} else {
  logger.info("memory", `no files found (run 'echo "# Memory" > ${DEFAULT_STATE_DIR_DISPLAY}/MEMORY.md' to create)`);
}

// 5. Init Workspace (SOUL/Persona)
const workspaceResult = await ensureWorkspace({ dir: stateDir, createMissing: true });
if (workspaceResult.created.length > 0) {
  logger.info("workspace", `created ${workspaceResult.created.join(", ")}`);
}

// 6. Load Workspace files for system prompt
const workspace = await loadWorkspaceFiles(stateDir);
logger.info("workspace", `SOUL=${workspace.hasSoul}, IDENTITY=${workspace.hasIdentity}, USER=${workspace.hasUser}, BOOTSTRAP=${workspace.hasBootstrap}`);

// 7. Build dynamic system prompt
const skillInstructions: Array<{
  name: string;
  instructions: string;
  priority: "high" | "always";
  description?: string;
}> = promptSkills.map((skill) => ({
  name: skill.name,
  instructions: skill.instructions,
  priority: skill.priority === "always" ? "always" : "high",
  description: skill.description,
}));
const hasSearchableSkills = searchableSkills.length > 0;
const defaultPromptProfile = agentProfiles.find((profile) => profile.id === "default") ?? buildDefaultProfile();
const agentAuthorityProfileCache = new Map<string, IdentityAuthorityProfile | undefined>();
const agentWorkspaceBindings = new Map<string, string>();
const defaultIdentityAuthorityProfile = await loadIdentityAuthorityProfile(stateDir);
agentAuthorityProfileCache.set("default", defaultIdentityAuthorityProfile);
agentWorkspaceBindings.set("default", "default");

const ROOT_WORKSPACE_FILE_NAMES = [
  AGENTS_FILENAME,
  SOUL_FILENAME,
  TOOLS_FILENAME,
  IDENTITY_FILENAME,
  USER_FILENAME,
  HEARTBEAT_FILENAME,
  BOOTSTRAP_FILENAME,
  MEMORY_FILENAME,
] as const;

const AGENT_WORKSPACE_FILE_NAMES = [
  SOUL_FILENAME,
  IDENTITY_FILENAME,
  USER_FILENAME,
  AGENTS_FILENAME,
  TOOLS_FILENAME,
  MEMORY_FILENAME,
] as const;

function readWorkspaceFileSync(filePath: string, name: WorkspaceFile["name"]): WorkspaceFile {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return {
      name,
      path: filePath,
      content,
      document: parseWorkspaceDocument(content),
      missing: false,
    };
  } catch {
    return {
      name,
      path: filePath,
      missing: true,
    };
  }
}

function loadWorkspaceFilesSync(dir: string): WorkspaceLoadResult {
  const files = ROOT_WORKSPACE_FILE_NAMES.map((name) => readWorkspaceFileSync(path.join(dir, name), name));
  return {
    dir,
    files,
    hasSoul: files.some((file) => file.name === SOUL_FILENAME && !file.missing),
    hasIdentity: files.some((file) => file.name === IDENTITY_FILENAME && !file.missing),
    hasUser: files.some((file) => file.name === USER_FILENAME && !file.missing),
    hasBootstrap: files.some((file) => file.name === BOOTSTRAP_FILENAME && !file.missing),
    hasAgents: files.some((file) => file.name === AGENTS_FILENAME && !file.missing),
    hasTools: files.some((file) => file.name === TOOLS_FILENAME && !file.missing),
    hasHeartbeat: files.some((file) => file.name === HEARTBEAT_FILENAME && !file.missing),
    hasMemory: files.some((file) => file.name === MEMORY_FILENAME && !file.missing),
  };
}

function loadAgentWorkspaceFilesSync(rootDir: string, agentId: string): WorkspaceLoadResult {
  if (!agentId || agentId === "default") {
    return loadWorkspaceFilesSync(rootDir);
  }

  const agentDir = path.join(rootDir, "agents", agentId);
  const files = AGENT_WORKSPACE_FILE_NAMES.map((name) => {
    const agentFilePath = path.join(agentDir, name);
    if (fs.existsSync(agentFilePath)) {
      return readWorkspaceFileSync(agentFilePath, name);
    }
    return readWorkspaceFileSync(path.join(rootDir, name), name);
  });

  return {
    dir: agentDir,
    files,
    hasSoul: files.some((file) => file.name === SOUL_FILENAME && !file.missing),
    hasIdentity: files.some((file) => file.name === IDENTITY_FILENAME && !file.missing),
    hasUser: files.some((file) => file.name === USER_FILENAME && !file.missing),
    hasBootstrap: false,
    hasAgents: files.some((file) => file.name === AGENTS_FILENAME && !file.missing),
    hasTools: files.some((file) => file.name === TOOLS_FILENAME && !file.missing),
    hasHeartbeat: false,
    hasMemory: files.some((file) => file.name === MEMORY_FILENAME && !file.missing),
  };
}

const buildRuntimeSectionsForProfile = (profile: AgentProfile) => {
  const visibleContracts = toolExecutor.getContracts(profile.id);
  const visibleToolContracts = visibleContracts.length > 0 ? listToolContractsV2(visibleContracts) : [];
  const canDelegate = visibleContracts.some((contract) => DELEGATION_TOOL_NAMES.has(contract.name));
  const catalog = resolveAgentProfileCatalogMetadata(profile);
  return buildAgentRuntimePromptSections({
    hasAvailableTools: visibleContracts.length > 0,
    visibleContracts: visibleToolContracts,
    canDelegate,
    includeMethodSkillAssetSummary: injectMethodSkillList,
    role: catalog.defaultRole,
    profileId: profile.id,
    recommendedMethodNames: injectMethodSkillList ? resolveRecommendedMethodNames(catalog.methods, runtimeMethodAssets) : [],
    recommendedSkillNames: injectMethodSkillList ? resolveRecommendedSkillNames(catalog.skills, runtimeAllKnownSkills) : [],
    methodAssets: runtimeMethodAssets,
    promptSkillAssets: runtimePromptSkillAssets,
    searchableSkillAssets: runtimeSearchableSkillAssets,
    methodAssetTotalCount: runtimeMethodAssetResult.totalCount,
    promptSkillAssetTotalCount: injectMethodSkillList ? promptSkills.length : 0,
    searchableSkillAssetTotalCount: injectMethodSkillList ? searchableSkills.length : 0,
    identityAuthorityProfile: agentAuthorityProfileCache.get(profile.id),
  });
};

const dynamicSystemPromptBuild = buildSystemPromptResult({
  workspace,
  extraSystemPrompt: openaiSystemPrompt,
  userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  currentTime: new Date().toISOString(),
  injectAgents,
  injectSoul,
  injectMemory,
  maxChars: maxSystemPromptChars,
  skillInstructions,
  hasSearchableSkills,
  runtimeSections: buildRuntimeSectionsForProfile(defaultPromptProfile),
  sectionPriorityOverrides: promptExperimentConfig?.sectionPriorityOverrides,
});
const dynamicSystemPrompt = dynamicSystemPromptBuild.text;
logger.info("system-prompt", `length=${dynamicSystemPrompt.length} chars${maxSystemPromptChars ? `, limit=${maxSystemPromptChars}` : ""}`);
if (
  dynamicSystemPromptBuild.skillPromptBudget
  && (
    dynamicSystemPromptBuild.skillPromptBudget.deferredInstructionCount > 0
    || dynamicSystemPromptBuild.skillPromptBudget.omittedSummaryCount > 0
    || dynamicSystemPromptBuild.skillPromptBudget.routingOmitted
  )
) {
  const budget = dynamicSystemPromptBuild.skillPromptBudget;
  logger.warn(
    "skills",
    `prompt budget applied (renderedBytes=${budget.renderedBytes}/${budget.maxBytes}, deferredInstructions=${budget.deferredInstructionCount}, omittedSummaries=${budget.omittedSummaryCount}, routingOmitted=${budget.routingOmitted})`,
  );
}

// 7.5 Hook System: HookRegistry + Context Injection
// Context Injection: 对话开始时自动注入最近记忆摘要
const contextInjectionEnabled = memoryRuntimeSwitches.contextInjectionEnabled;
const carryoverContextEnabled = readEnv("BELLDANDY_CARRYOVER_CONTEXT_ENABLED") !== "false";
const contextInjectionLimit = Math.max(1, parseInt(readEnv("BELLDANDY_CONTEXT_INJECTION_LIMIT") || "5", 10));
const contextInjectionIncludeSession = readEnv("BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION") === "true";
const contextInjectionTaskLimit = Math.max(0, parseInt(readEnv("BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT") || "3", 10) || 3);
const contextInjectionAllowedCategories = parseContextInjectionCategories(
  readEnv("BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES") || "preference,fact,decision,entity",
);
// Auto-Recall: 对话开始时按当前用户输入自动进行语义召回（默认关闭）
const autoRecallEnabled = memoryRuntimeSwitches.autoRecallEnabled;
const autoRecallLimit = Math.max(1, parseInt(readEnv("BELLDANDY_AUTO_RECALL_LIMIT") || "3", 10) || 3);
const autoRecallMinScoreRaw = Number(readEnv("BELLDANDY_AUTO_RECALL_MIN_SCORE") || "0.3");
const autoRecallMinScore = Number.isFinite(autoRecallMinScoreRaw) ? autoRecallMinScoreRaw : 0.3;
const mindProfileRuntimeEnabled = readEnv("BELLDANDY_MIND_PROFILE_RUNTIME_ENABLED") !== "false";
const mindProfileRuntimeMaxLines = Math.max(1, parseInt(readEnv("BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINES") || "4", 10) || 4);
const mindProfileRuntimeMaxLineLength = Math.max(24, parseInt(readEnv("BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINE_LENGTH") || "120", 10) || 120);
const mindProfileRuntimeMaxChars = Math.max(80, parseInt(readEnv("BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS") || "360", 10) || 360);
const mindProfileRuntimeMinSignalCount = Math.max(1, parseInt(readEnv("BELLDANDY_MIND_PROFILE_RUNTIME_MIN_SIGNAL_COUNT") || "2", 10) || 2);
const promptFocusEnabled = readEnv("BELLDANDY_PROMPT_FOCUS_ENABLED") !== "false";
const promptFocusMaxSections = Math.max(1, parseInt(readEnv("BELLDANDY_PROMPT_FOCUS_MAX_SECTIONS") || "3", 10) || 3);
const promptFocusMaxChars = Math.max(160, parseInt(readEnv("BELLDANDY_PROMPT_FOCUS_MAX_CHARS") || "900", 10) || 900);
const promptFocusMinScore = Math.max(1, parseInt(readEnv("BELLDANDY_PROMPT_FOCUS_MIN_SCORE") || "4", 10) || 4);
const promptFocusMaxExcerptChars = Math.max(80, parseInt(readEnv("BELLDANDY_PROMPT_FOCUS_MAX_EXCERPT_CHARS") || "220", 10) || 220);
const promptFocusSemanticEnabled = readEnv("BELLDANDY_PROMPT_FOCUS_SEMANTIC_ENABLED") !== "false";
const promptFocusSemanticMinScoreRaw = Number(readEnv("BELLDANDY_PROMPT_FOCUS_SEMANTIC_MIN_SCORE") || "0.3");
const promptFocusSemanticMinScore = Number.isFinite(promptFocusSemanticMinScoreRaw) ? promptFocusSemanticMinScoreRaw : 0.3;
const toolResultTranscriptCharLimit = Math.max(0, parseInt(readEnv("BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT") || "12000", 10) || 12000);
const configuredTaskDedupGuardEnabled = readEnv("BELLDANDY_TASK_DEDUP_GUARD_ENABLED") !== "false";
const taskDedupWindowMinutes = Math.max(1, parseInt(readEnv("BELLDANDY_TASK_DEDUP_WINDOW_MINUTES") || "20", 10) || 20);
const taskDedupGlobalMode = parseToolDedupGlobalMode(readEnv("BELLDANDY_TASK_DEDUP_MODE"));
const taskDedupPolicy = parseToolDedupPolicy(readEnv("BELLDANDY_TASK_DEDUP_POLICY"));

if (contextInjectionEnabled || autoRecallEnabled) {
  hookRegistry.register({
    source: "context-injection",
    hookName: "before_agent_start",
    priority: 100,
    handler: async (event, _ctx) => {
      const mm = getGlobalMemoryManager({
        agentId: _ctx.agentId,
        conversationId: _ctx.sessionKey,
      });
      if (!mm) return undefined;
      try {
        const carryoverQuery = typeof event.userInput === "string" && event.userInput.trim()
          ? event.userInput.trim()
          : typeof event.prompt === "string" && event.prompt.trim()
            ? event.prompt.trim()
            : undefined;
        const carryoverContext = carryoverContextEnabled && _ctx.sessionKey
          ? conversationStore.getCarryoverContext(_ctx.sessionKey, { limit: 6, query: carryoverQuery })
          : [];
        return await buildContextInjectionPrelude(mm, event, _ctx, {
          contextInjectionEnabled,
          contextInjectionLimit,
          contextInjectionIncludeSession,
          contextInjectionTaskLimit,
          contextInjectionAllowedCategories,
          autoRecallEnabled,
          autoRecallLimit,
          autoRecallMinScore,
        }, {
          carryoverContext,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLocaleLowerCase().includes("semantic memory")) {
          logger.warn("auto-recall", `Failed to fetch semantic memory: ${message}`);
        } else {
          logger.warn("context-injection", `Failed to build context injection prelude: ${message}`);
        }
        return undefined;
      }
    },
  });
  if (contextInjectionEnabled) {
    logger.info(
      "context-injection",
      `enabled (memoryLimit=${contextInjectionLimit}, taskLimit=${contextInjectionTaskLimit}, includeSession=${contextInjectionIncludeSession}, categories=${contextInjectionAllowedCategories.join(",") || "all"}, carryover=${carryoverContextEnabled})`,
    );
  }
  if (autoRecallEnabled) logger.info("auto-recall", `enabled (limit=${autoRecallLimit}, minScore=${autoRecallMinScore})`);
}

hookRegistry.register({
  source: "goal-session-context",
  hookName: "before_agent_start",
  priority: 110,
  handler: async (_event, _ctx) => {
    try {
      return await buildGoalSessionContextPrelude({
        sessionKey: _ctx.sessionKey,
        getGoal: (goalId) => goalManager.getGoal(goalId),
        getHandoff: (goalId) => goalManager.getHandoff(goalId),
        readTaskGraph: (goalId) => goalManager.readTaskGraph(goalId),
      });
    } catch (err) {
      logger.warn("goals", `Failed to build goal session context prelude: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  },
});

if (mindProfileRuntimeEnabled) {
  hookRegistry.register({
    source: "mind-profile-runtime",
    hookName: "before_agent_start",
    priority: 115,
    handler: async (_event, _ctx) => {
      try {
        return await buildMindProfileRuntimePrelude({
          stateDir,
          agentId: _ctx.agentId,
          sessionKey: _ctx.sessionKey,
          currentTurnText: _event.userInput?.trim() || _event.prompt?.trim() || undefined,
          residentMemoryManagers: scopedMemoryManagers.records,
          config: {
            enabled: mindProfileRuntimeEnabled,
            maxLines: mindProfileRuntimeMaxLines,
            maxLineLength: mindProfileRuntimeMaxLineLength,
            maxChars: mindProfileRuntimeMaxChars,
            minSignalCount: mindProfileRuntimeMinSignalCount,
          },
        });
      } catch (err) {
        logger.warn("mind-profile-runtime", `Failed to build runtime prelude: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    },
  });
  logger.info(
    "mind-profile-runtime",
    `enabled (maxLines=${mindProfileRuntimeMaxLines}, maxLineLength=${mindProfileRuntimeMaxLineLength}, maxChars=${mindProfileRuntimeMaxChars}, minSignals=${mindProfileRuntimeMinSignalCount})`,
  );
}

if (promptFocusEnabled) {
    hookRegistry.register({
      source: "prompt-focus-runtime",
      hookName: "before_agent_start",
      priority: 118,
      handler: async (_event, _ctx) => {
        try {
          const resolvedAgentId = _ctx.agentId?.trim() || "default";
          const mm = getGlobalMemoryManager({
            agentId: _ctx.agentId,
            conversationId: _ctx.sessionKey,
          });
          return await buildPromptFocusRuntimePrelude({
            stateDir,
            agentId: resolvedAgentId,
            workspaceAgentId: agentWorkspaceBindings.get(resolvedAgentId) ?? resolvedAgentId,
            currentTurnText: _event.userInput?.trim() || _event.prompt?.trim() || undefined,
            config: {
              enabled: promptFocusEnabled,
              maxSections: promptFocusMaxSections,
              maxChars: promptFocusMaxChars,
              minScore: promptFocusMinScore,
              maxExcerptChars: promptFocusMaxExcerptChars,
              semanticEnabled: promptFocusSemanticEnabled,
              semanticMinScore: promptFocusSemanticMinScore,
            },
            semanticEmbedder: promptFocusSemanticEnabled && mm
              ? {
                cacheKey: mm.getEmbeddingRuntimeCacheKey(),
                embedQuery: (text) => mm.embedRetrievalQuery(text),
                embedPassages: (texts) => mm.embedRetrievalPassages(texts),
              }
              : undefined,
          });
        } catch (err) {
          logger.warn("prompt-focus", `Failed to build prompt focus prelude: ${err instanceof Error ? err.message : String(err)}`);
          return undefined;
        }
    },
  });
  logger.info(
    "prompt-focus",
    `enabled (maxSections=${promptFocusMaxSections}, maxChars=${promptFocusMaxChars}, minScore=${promptFocusMinScore}, maxExcerptChars=${promptFocusMaxExcerptChars}, semantic=${promptFocusSemanticEnabled}, semanticMinScore=${promptFocusSemanticMinScore})`,
  );
}

hookRegistry.register({
  source: "learning-review-nudge",
  hookName: "before_agent_start",
  priority: 120,
  handler: async (_event, _ctx) => {
    const mm = getGlobalMemoryManager({
      agentId: _ctx.agentId,
      conversationId: _ctx.sessionKey,
    });
    if (!mm) return undefined;
    try {
      return await buildLearningReviewNudgePrelude({
        stateDir,
        agentId: _ctx.agentId,
        sessionKey: _ctx.sessionKey,
        currentTurnText: _event.userInput?.trim() || _event.prompt?.trim() || undefined,
        manager: mm,
        residentMemoryManagers: scopedMemoryManagers.records,
        getGoalReviewNudgeSummary: async (goalId) => {
          try {
            const reviews = await goalManager.listSuggestionReviews(goalId);
            return {
              pendingReviewCount: reviews.items.filter((item) => item.status === "pending_review").length,
              needsRevisionCount: reviews.items.filter((item) => item.status === "needs_revision").length,
            };
          } catch {
            return undefined;
          }
        },
      });
    } catch (err) {
      logger.warn("learning-review", `Failed to build learning/review nudge prelude: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  },
});
logger.info("learning-review", "enabled prompt/runtime nudge prelude");

if (toolResultTranscriptCharLimit > 0) {
  hookRegistry.register({
    source: "tool-transcript",
    hookName: "tool_result_persist",
    priority: 100,
    handler: (event) => {
      const content = typeof event.message.content === "string"
        ? event.message.content
        : String(event.message.content ?? "");
      if (!content || content.length <= toolResultTranscriptCharLimit) {
        return undefined;
      }
      return {
        message: {
          ...event.message,
          content: truncateToolTranscriptContent(content, toolResultTranscriptCharLimit),
        },
      };
    },
  });
  logger.info("tool-transcript", `enabled (limit=${toolResultTranscriptCharLimit})`);
}

// 7.6 Bridge legacy plugin hooks → HookRegistry
bridgeLegacyPluginHooks({
  extensionHost,
  hookRegistry,
  logger,
});

const hookRunner: HookRunner = createHookRunner(hookRegistry, {
  logger: {
    debug: (m) => logger.debug("hooks", m),
    warn: (m) => logger.warn("hooks", m),
    error: (m) => logger.error("hooks", m),
  },
  catchErrors: true,
});

// 8. Agent Registry (replaces single agentFactory closure)
const primaryModelConfig = {
  baseUrl: openaiBaseUrl ?? "",
  apiKey: openaiApiKey ?? "",
  model: openaiModel ?? "",
  protocol: agentProtocol,
  wireApi: openaiWireApi,
  thinking: openaiThinking,
  reasoningEffort: openaiReasoningEffort,
};

let primaryBootstrapCooldownUntil = 0;

function getBootstrapProfileCooldowns(): Record<string, number> | undefined {
  const remainingMs = primaryBootstrapCooldownUntil - Date.now();
  if (remainingMs <= 0) return undefined;
  return { primary: remainingMs };
}

async function runPrimaryWarmupProbe(): Promise<void> {
  if (!primaryWarmupEnabled || agentProvider !== "openai") return;
  if (!openaiBaseUrl || !openaiApiKey || !openaiModel) return;

  try {
    const result = await requestPrimaryModelWarmup({
      baseUrl: openaiBaseUrl,
      apiKey: openaiApiKey,
      model: openaiModel,
      wireApi: openaiWireApi,
      thinking: openaiThinking,
      reasoningEffort: openaiReasoningEffort,
      timeoutMs: primaryWarmupTimeoutMs,
    });

    if (result.ok) {
      logger.info("warmup", `primary probe success (wire_api=${openaiWireApi}, model=${openaiModel})`);
      return;
    }

    const reason = classifyFailoverReason(result.status, result.responseBody);
    const cooldownMs = resolveFailoverCooldownMs(reason, {
      defaultCooldownMs: primaryWarmupCooldownMs,
    }) ?? primaryWarmupCooldownMs;
    primaryBootstrapCooldownUntil = Date.now() + cooldownMs;
    logger.warn(
      "warmup",
      `primary probe failed: HTTP ${result.status} (reason=${reason}, wire_api=${openaiWireApi}, model=${openaiModel}), apply ${cooldownMs}ms cooldown. body=${result.responseBody.slice(0, 200)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    primaryBootstrapCooldownUntil = Date.now() + primaryWarmupCooldownMs;
    logger.warn(
      "warmup",
      `primary probe error: ${msg} (wire_api=${openaiWireApi}, model=${openaiModel}), apply ${primaryWarmupCooldownMs}ms cooldown.`,
    );
  }
}

void runPrimaryWarmupProbe();

const readProviderLabel = (baseUrl: string): string => {
  if (!baseUrl) {
    return "unknown";
  }
  try {
    return new URL(baseUrl).hostname.replace(/^api\./, "").replace(/^www\./, "");
  } catch {
    return baseUrl;
  }
};

function extractCompactionChatCompletionText(
  content: unknown,
): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (typeof (part as { text?: unknown }).text === "string") {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("");
}

const toRuntimeResilienceRoute = (profile: {
  id?: string;
  baseUrl: string;
  model: string;
  protocol?: string;
  wireApi?: string;
}) => ({
  profileId: profile.id ?? "primary",
  provider: readProviderLabel(profile.baseUrl),
  model: profile.model,
  ...(profile.protocol ? { protocol: profile.protocol } : {}),
  ...(profile.wireApi ? { wireApi: profile.wireApi } : {}),
});

const compactionRouteResolution = resolveCompactionModelRoute({
  enabled: compactionEnabled,
  routeRef: compactionModelRouteRef,
  explicitBaseUrl: compactionBaseUrl,
  explicitApiKey: compactionApiKey,
  explicitModel: compactionModel,
  primaryModelConfig,
  modelFallbacks,
  deepSeekRoutePolicyEnabled,
});

const compactionRoute = compactionRouteResolution?.enabled
  ? toRuntimeResilienceRoute({
      id: "compaction",
      baseUrl: compactionRouteResolution.baseUrl,
      model: compactionRouteResolution.model,
      protocol: compactionRouteResolution.protocol,
      wireApi: compactionRouteResolution.wireApi,
    })
  : undefined;

const runtimeResilienceTracker = new RuntimeResilienceTracker({
  stateDir,
  routing: {
    primary: toRuntimeResilienceRoute({
      id: "primary",
      baseUrl: primaryModelConfig.baseUrl,
      model: primaryModelConfig.model,
      protocol: primaryModelConfig.protocol,
      wireApi: primaryModelConfig.wireApi,
    }),
    fallbacks: modelFallbacks.map(toRuntimeResilienceRoute),
    ...(compactionRoute
      ? {
        compaction: {
          configured: true,
          sharesPrimaryRoute: compactionRoute.provider === readProviderLabel(primaryModelConfig.baseUrl)
            && compactionRoute.model === primaryModelConfig.model,
          route: compactionRoute,
          ...(compactionRouteResolution?.auxSummaryVerdict
            ? { auxSummaryVerdict: compactionRouteResolution.auxSummaryVerdict }
            : {}),
        },
      }
      : {
        compaction: {
          configured: false,
          sharesPrimaryRoute: false,
        },
      }),
  },
});

// 8.1 Resolve per-agent workspaces lazily so WebChat first paint stays on the hot path.
const agentWorkspaceCache = new Map<string, {
  build: SystemPromptBuildResult;
  authorityProfile?: IdentityAuthorityProfile;
}>();
const promptSnapshotStore = new PromptSnapshotStore({
  maxSnapshots: Math.max(1, parseInt(readEnv("BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS") || "48", 10) || 48),
});
const promptSnapshotMaxPersistedRuns = Math.max(1, parseInt(readEnv("BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS") || "20", 10) || 20);
const promptSnapshotHeartbeatMaxRuns = Math.max(1, parseInt(readEnv("BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS") || "5", 10) || 5);
const promptSnapshotEmailThreadMaxRuns = Math.max(1, parseInt(readEnv("BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS") || "10", 10) || 10);
const promptSnapshotRetentionDays = (() => {
  const raw = readEnv("BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return 7;
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 7;
  }
  return Math.max(0, parsed);
})();
const gatewayPromptInspectionRuntime = createGatewayPromptInspectionRuntime({
  stateDir,
  logger,
  promptSnapshotStore,
  promptSnapshotMaxPersistedRuns,
  promptSnapshotHeartbeatMaxRuns,
  promptSnapshotEmailThreadMaxRuns,
  promptSnapshotRetentionDays,
  agentWorkspaceCache,
  resolveAgentWorkspaceCacheEntry: ensureAgentWorkspaceCacheEntry,
  dynamicSystemPromptBuild,
  toolExecutor,
  promptExperimentConfig,
  providerCacheSupport: providerCapability.cache,
  providerCapabilitySource: providerCapability.source,
  isTtsEnabled: () => {
    const ttsEnv = process.env.BELLDANDY_TTS_ENABLED;
    if (ttsEnv === "false") return false;
    return ttsEnv === "true" || fs.existsSync(path.join(stateDir, "TTS_ENABLED"));
  },
});

function ensureAgentWorkspaceCacheEntry(profile: AgentProfile): {
  build: SystemPromptBuildResult;
  authorityProfile?: IdentityAuthorityProfile;
} {
  const cached = agentWorkspaceCache.get(profile.id);
  if (cached) {
    return cached;
  }

  const wsDir = profile.workspaceDir ?? profile.id;
  agentWorkspaceBindings.set(profile.id, wsDir);
  try {
    fs.mkdirSync(path.join(stateDir, "agents", wsDir, "facets"), { recursive: true });
    const agentWs = loadAgentWorkspaceFilesSync(stateDir, wsDir);
    agentAuthorityProfileCache.set(profile.id, defaultIdentityAuthorityProfile);
    void loadIdentityAuthorityProfile(agentWs.dir)
      .then((agentAuthorityProfile) => {
        if (agentAuthorityProfile) {
          agentAuthorityProfileCache.set(profile.id, agentAuthorityProfile);
          const current = agentWorkspaceCache.get(profile.id);
          if (current) {
            current.authorityProfile = agentAuthorityProfile;
          }
        }
      })
      .catch((err) => {
        logger.warn("agent-workspace", `Failed to load authority profile for agent "${profile.id}", using default: ${err instanceof Error ? err.message : String(err)}`);
      });

    const agentPromptBuild = buildSystemPromptResult({
      workspace: agentWs,
      extraSystemPrompt: openaiSystemPrompt,
      userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      currentTime: new Date().toISOString(),
      injectAgents,
      injectSoul,
      injectMemory,
      maxChars: maxSystemPromptChars,
      skillInstructions,
      hasSearchableSkills,
      runtimeSections: buildRuntimeSectionsForProfile(profile),
      sectionPriorityOverrides: promptExperimentConfig?.sectionPriorityOverrides,
    });
    const entry = {
      build: agentPromptBuild,
      authorityProfile: defaultIdentityAuthorityProfile,
    };
    agentWorkspaceCache.set(profile.id, entry);
    logger.info("agent-workspace", `Loaded workspace for agent "${profile.id}" (dir: agents/${wsDir}/), prompt=${agentPromptBuild.text.length} chars`);
    return entry;
  } catch (err) {
    logger.warn("agent-workspace", `Failed to load workspace for agent "${profile.id}", falling back to default: ${err instanceof Error ? err.message : String(err)}`);
    agentAuthorityProfileCache.set(profile.id, defaultIdentityAuthorityProfile);
    const entry = {
      build: dynamicSystemPromptBuild,
      authorityProfile: defaultIdentityAuthorityProfile,
    };
    agentWorkspaceCache.set(profile.id, entry);
    return entry;
  }
}

// Default agent uses the root workspace (already loaded above)
agentWorkspaceCache.set("default", {
  build: dynamicSystemPromptBuild,
  authorityProfile: defaultIdentityAuthorityProfile,
});

const resolveIdentityAuthorityProfileForAgent = (agentId: string): IdentityAuthorityProfile | undefined => {
  return agentWorkspaceCache.get(agentId)?.authorityProfile
    ?? agentAuthorityProfileCache.get(agentId)
    ?? (agentId === "default" ? defaultIdentityAuthorityProfile : undefined);
};

agentRegistry = agentProvider === "openai"
  ? new AgentRegistry((profile: AgentProfile, opts?: { modelOverride?: string }): BelldandyAgent => {
    const modelRef = opts?.modelOverride ?? profile.model;
    // Resolve model config: "primary" → env vars, named → models.json lookup
    const resolved = resolveModelConfig(modelRef, primaryModelConfig, modelFallbacks);
    if (modelRef !== "primary" && resolved.source === "primary") {
      logger.warn("agent-registry", `Model "${modelRef}" not found in models.json, falling back to primary config (agent: ${profile.id})`);
    }

    if (!resolved.apiKey) {
      throw new Error("CONFIG_REQUIRED");
    }

    const promptInspection = gatewayPromptInspectionRuntime.buildEffectiveAgentPromptInspection(profile);
    const currentSystemPrompt = promptInspection.text;

    // Determine tools enabled: profile override > env
    const profileToolsEnabled = profile.toolsEnabled ?? toolsEnabled;
    // Determine max input tokens: profile override > env
    const profileMaxInputTokens = profile.maxInputTokens ?? maxInputTokens;
    // Determine max output tokens: profile override > env（默认 4096，调大可避免长输出截断工具调用 JSON）
    const profileMaxOutputTokens = profile.maxOutputTokens ?? maxOutputTokens;
    // Profile 可显式提高后台/长任务预算；未配置时仍采用全局安全默认值。
    const profileMaxToolCalls = profile.maxToolCalls ?? maxToolCalls;
    const profileMaxRunWallTimeMs = profile.maxRunWallTimeMs ?? maxRunWallTimeMs;
    const profileMaxTotalTokens = profile.maxTotalTokens ?? maxTotalTokens;
    const profileMaxHighRiskToolCalls = profile.maxHighRiskToolCalls ?? maxHighRiskToolCalls;
    const profileToolLoopIterationBudget = profile.toolLoopIterationBudget ?? toolLoopIterationBudget;

    // Resolve protocol: per-model override > global env
    const resolvedProtocol = (resolved.protocol ?? agentProtocol) as "openai" | "anthropic" | undefined;
    // Resolve wire_api: per-model override > global env
    const resolvedWireApi = (resolved.wireApi ?? "").toLowerCase() === "responses"
      ? "responses"
      : (resolved.wireApi ?? "").toLowerCase() === "chat_completions"
        ? "chat_completions"
        : openaiWireApi;
    const resolvedRequestTimeoutMs = (() => {
      const candidates: number[] = [];
      if (typeof resolved.requestTimeoutMs === "number" && resolved.requestTimeoutMs > 0) {
        candidates.push(resolved.requestTimeoutMs);
      }
      if (typeof agentTimeoutMs === "number" && agentTimeoutMs > 0) {
        candidates.push(agentTimeoutMs);
      }
      if (candidates.length === 0) return undefined;
      return Math.max(...candidates);
    })();
    const resolvedMaxRetries = resolved.maxRetries ?? openaiMaxRetries;
    const resolvedRetryBackoffMs = resolved.retryBackoffMs ?? openaiRetryBackoffMs;
    const resolvedProxyUrl = resolved.proxyUrl ?? openaiProxyUrl;
    const bootstrapProfileCooldowns = getBootstrapProfileCooldowns();
    const resolvedCompactionTokenThreshold = resolved.source === "primary"
      ? resolveCompactionThreshold({
          fallbackThreshold: compactionFallbackTokenThreshold,
          contextWindow: providerCapability.contextWindow,
          contextWindowFraction: compactionContextWindowFraction,
        }).tokenThreshold
      : compactionFallbackTokenThreshold;
    const agentCompactionWarningThreshold = parseInt(
      readEnv("BELLDANDY_COMPACTION_WARNING_THRESHOLD") || String(Math.max(1024, Math.floor(resolvedCompactionTokenThreshold * 0.7))),
      10,
    );
    const agentCompactionBlockingThreshold = parseInt(
      readEnv("BELLDANDY_COMPACTION_BLOCKING_THRESHOLD") || String(Math.max(agentCompactionWarningThreshold + 1, Math.floor(resolvedCompactionTokenThreshold * 0.9))),
      10,
    );
    const agentCompactionOpts = {
      ...compactionOpts,
      tokenThreshold: resolvedCompactionTokenThreshold,
      warningThreshold: agentCompactionWarningThreshold,
      blockingThreshold: agentCompactionBlockingThreshold,
    };
    const usagePricing = resolved.source === "primary" ? providerCapability.pricing : undefined;
    const agentMicrocompactOpts = resolved.source === "primary" ? primaryMicrocompactOpts : undefined;

    if (profileToolsEnabled) {
      return new ToolEnabledAgent({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: resolved.model,
        streamingEnabled: toolAgentStreamingEnabled,
        systemPrompt: currentSystemPrompt,
        systemPromptSections: promptInspection.sections,
        systemPromptMetadata: promptInspection.metadata as JsonObject,
        identityAuthorityProfile: resolveIdentityAuthorityProfileForAgent(profile.id),
        toolExecutor: toolExecutor,
        logger,
        hookRunner,
        onPromptSnapshot: (snapshot) => {
          gatewayPromptInspectionRuntime.persistPromptSnapshot(snapshot);
        },
        ...(resolvedRequestTimeoutMs !== undefined && { timeoutMs: resolvedRequestTimeoutMs }),
        maxRetries: resolvedMaxRetries,
        retryBackoffMs: resolvedRetryBackoffMs,
        thinking: resolved.thinking,
        reasoningEffort: resolved.reasoningEffort,
        options: resolved.options,
        requestBodyExtras: resolved.requestBodyExtras,
        messageLayout: resolved.messageLayout,
        ...(resolvedProxyUrl && { proxyUrl: resolvedProxyUrl }),
        ...(bootstrapProfileCooldowns && { bootstrapProfileCooldowns }),
        fallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
        failoverLogger: logger,
        onRuntimeResilienceEvent: (event) => {
          runtimeResilienceTracker.record(event);
        },
        videoUploadConfig,
        protocol: resolvedProtocol,
        wireApi: resolvedWireApi,
        sanitizeResponsesToolSchema,
        ...(profileMaxInputTokens > 0 && { maxInputTokens: profileMaxInputTokens }),
        ...(profileMaxOutputTokens > 0 && { maxOutputTokens: profileMaxOutputTokens }),
        maxToolCalls: profileMaxToolCalls,
        maxRunWallTimeMs: profileMaxRunWallTimeMs,
        maxTotalTokens: profileMaxTotalTokens,
        maxHighRiskToolCalls: profileMaxHighRiskToolCalls,
        toolLoopIterationBudget: profileToolLoopIterationBudget,
        toolLoopWarningFraction,
        toolCallRepairLevel,
        compaction: agentCompactionOpts,
        ...(agentMicrocompactOpts ? { microcompact: agentMicrocompactOpts } : {}),
        // Phase 2/3：统一压缩层与预算保护策略
        compression: compressionOpts,
        budgetProtect: budgetProtectOpts,
        // Phase 4：stable prefix / transient tail 拆层
        stablePrefixSplit: stablePrefixSplitOpts,
        summarizer: compactionSummarizer,
        summarizerModelName: compactionRoute?.model || compactionModel || openaiModel,
        compactionRuntimeTracker,
        conversationStore: conversationStore, // 扩展 A：传入 conversationStore 支持跨 run 持久化
        usagePricing,
        cacheSupport: providerCapability.cache,
      });
    }
    return new OpenAIChatAgent({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      stream: openaiStream,
      systemPrompt: currentSystemPrompt,
      systemPromptSections: promptInspection.sections,
      systemPromptMetadata: promptInspection.metadata as JsonObject,
      onPromptSnapshot: (snapshot) => {
        gatewayPromptInspectionRuntime.persistPromptSnapshot(snapshot);
      },
      fallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
      failoverLogger: logger,
      onRuntimeResilienceEvent: (event) => {
        runtimeResilienceTracker.record(event);
      },
      videoUploadConfig,
      protocol: resolvedProtocol,
      wireApi: resolvedWireApi,
      ...(resolvedRequestTimeoutMs !== undefined && { timeoutMs: resolvedRequestTimeoutMs }),
      maxRetries: resolvedMaxRetries,
      retryBackoffMs: resolvedRetryBackoffMs,
      thinking: resolved.thinking,
      reasoningEffort: resolved.reasoningEffort,
      options: resolved.options,
      requestBodyExtras: resolved.requestBodyExtras,
      ...(resolvedProxyUrl && { proxyUrl: resolvedProxyUrl }),
      ...(bootstrapProfileCooldowns && { bootstrapProfileCooldowns }),
      ...(profileMaxOutputTokens > 0 && { maxOutputTokens: profileMaxOutputTokens }),
    });
  })
  : undefined;

// Register agent profiles
if (agentRegistry) {
  const buildRegisteredProfile = (profile: AgentProfile): AgentProfile => {
    const resolution = resolveToolWhitelistFromFaqi({
      agentId: profile.id,
      state: faqiState,
      definitions: faqiDefinitionsByName,
      fallbackToolWhitelist: profile.toolWhitelist,
    });
    const configuredFaqi = getCurrentFaqiForAgent(faqiState, profile.id);

    if (resolution.source === "faqi" && resolution.activeFaqi) {
      logger.info(
        "faqi",
        `Agent "${profile.id}" using FAQI "${resolution.activeFaqi.name}" (${resolution.activeFaqi.toolNames.length} tools)`,
      );
      return {
        ...profile,
        toolWhitelist: [...resolution.activeFaqi.toolNames],
      };
    }

    if (configuredFaqi) {
      logger.warn(
        "faqi",
        `Agent "${profile.id}" references missing/invalid currentFaqi "${configuredFaqi}", falling back to toolWhitelist`,
      );
    }

    return profile.toolWhitelist
      ? { ...profile, toolWhitelist: [...profile.toolWhitelist] }
      : profile;
  };

  // Always register the default profile
  const defaultProfile = buildDefaultProfile();
  // Check if agents.json has a custom "default" override
  const customDefault = agentProfiles.find(p => p.id === "default");
  agentRegistry.register(buildRegisteredProfile(customDefault ?? defaultProfile));

  // Register additional profiles from agents.json
  for (const profile of agentProfiles) {
    if (profile.id !== "default") {
      agentRegistry.register(buildRegisteredProfile(profile));
    }
  }

  const profileIds = agentRegistry.list().map(p => p.id);
  logger.info("agent-registry", `Registered ${profileIds.length} agent profile(s): [${profileIds.join(", ")}]`);
}

// Backward-compatible agentFactory wrapper (for existing code paths)
const createAgent = agentRegistry
  ? () => agentRegistry.create("default")
  : undefined;

// 7.5 Init Conversation Store (Shared)
const sessionsDir = path.join(stateDir, "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });

// 创建 summarizer 函数（基于 FailoverClient，用便宜模型生成摘要）
let compactionSummarizer: SummarizerFn | undefined;
if (compactionEnabled) {
  const compactionModelRoute = resolveCompactionModelRoute({
    enabled: compactionEnabled,
    routeRef: compactionModelRouteRef,
    explicitBaseUrl: compactionBaseUrl,
    explicitApiKey: compactionApiKey,
    explicitModel: compactionModel,
    primaryModelConfig,
    modelFallbacks,
    deepSeekRoutePolicyEnabled,
  });
  if (compactionModelRoute?.enabled) {
    const summarizerBaseUrl = compactionModelRoute.baseUrl;
    const summarizerApiKey = compactionModelRoute.apiKey;
    const summarizerModel = compactionModelRoute.model;
    const summarizerWireApi = (compactionModelRoute.wireApi ?? openaiWireApi).toLowerCase() === "responses"
      ? "responses"
      : "chat_completions";
    const summarizerClient = new FailoverClient({
      primary: { id: "compaction", baseUrl: summarizerBaseUrl, apiKey: summarizerApiKey, model: summarizerModel },
      logger,
    });
    compactionSummarizer = async (prompt: string, context?: SummarizerContext): Promise<{
      summary: string;
      observability?: {
        mode?: "rolling" | "archival";
        cacheAlignedRequested?: boolean;
        cacheSupport?: "supported" | "unsupported" | "unknown";
        cacheHitTokens?: number;
        cacheMissTokens?: number;
        cacheSavingsUsd?: number;
        usedWireApi?: "chat_completions" | "responses";
        compareAvailable?: boolean;
        comparison?: {
          mode?: "cache_aligned_vs_plain";
          plainRequestMessageCount?: number;
          cacheAlignedRequestMessageCount?: number;
          plainPromptCharsEstimate?: number;
          cacheAlignedReplayCharsEstimate?: number;
          cacheAlignedInstructionChars?: number;
          replayOverheadChars?: number;
        };
        strategy?: {
          kind?: "cache_aligned" | "plain";
          providerCacheMode?: "supported" | "unsupported" | "unknown";
          selectionReason?: string;
          degradePath?: string;
          providerModelNotes?: string;
          fallbackPolicy?: string;
          fallbackTriggered?: boolean;
          fallbackSummary?: string;
        };
        warmupCoordination?: {
          eligible?: boolean;
          status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
          recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
          reason?: string;
        };
        cacheFamilyAffinity?: {
          status?: "unknown" | "aligned" | "mismatch";
          familyKey?: string;
          previousFamilyKey?: string;
          reason?: string;
        };
        fallbackStage?: "request" | "response_parse" | "compaction_budget" | "prompt_too_long" | "model_failure";
        failureReason?: string;
      };
    }> => {
      const useCacheAlignedSummary = providerCapability.cache === "supported" && Boolean(context);
      const plainRequestMessageCount = context ? 1 : 1;
      const cacheAlignedInstruction = context
        ? buildCacheAlignedSummaryInstruction(context)
        : prompt;
      const cacheAlignedChatMessages = context
        ? buildCacheAlignedChatMessages(context, cacheAlignedInstruction)
        : [{ role: "user", content: prompt }];
      const plainPromptCharsEstimate = prompt.length;
      const cacheAlignedReplayCharsEstimate = context
        ? cacheAlignedChatMessages
          .slice(0, -1)
          .reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0), 0)
        : 0;
      const cacheAlignedInstructionChars = context ? cacheAlignedInstruction.length : 0;
      const replayOverheadChars = Math.max(0, (cacheAlignedReplayCharsEstimate + cacheAlignedInstructionChars) - plainPromptCharsEstimate);
      const strategyKind = useCacheAlignedSummary ? "cache_aligned" : "plain";
      const strategySelectionReason = useCacheAlignedSummary
        ? "provider_cache_supported_with_context"
        : context
          ? `provider_cache_${providerCapability.cache}`
          : "missing_cache_alignment_context";
      const strategyDegradePath = useCacheAlignedSummary
        ? "cache_aligned_then_compaction_fallback"
        : providerCapability.cache === "supported"
          ? "plain_without_context_then_compaction_fallback"
          : providerCapability.cache === "unsupported"
            ? "provider_plain_only_then_compaction_fallback"
            : "unknown_provider_mode_then_compaction_fallback";
      const familyKeySource = [
        summarizerModel,
        context?.mode ?? "unknown",
        useCacheAlignedSummary ? "cache_aligned" : "plain",
        context?.existingSummary?.trim() ? "existing_summary" : "",
        context?.rollingSummary?.trim() ? "rolling_summary" : "",
        context?.existingArchivalSummary?.trim() ? "existing_archival" : "",
        Array.isArray(context?.newMessages) ? `new_messages:${context?.newMessages.length ?? 0}` : "",
      ].filter(Boolean).join("|");
      const cacheFamilyKey = providerCapability.cache === "supported" && familyKeySource
        ? crypto.createHash("sha256").update(familyKeySource).digest("hex").slice(0, 16)
        : undefined;
      const warmupCoordination = (() => {
        if (providerCapability.cache !== "supported") {
          return {
            eligible: false,
            status: "unsupported" as const,
            recommendation: "proceed" as const,
            reason: "provider_cache_not_supported",
          };
        }
        if (!context) {
          return {
            eligible: true,
            status: "cold" as const,
            recommendation: "proceed_with_caution" as const,
            reason: "missing_cache_alignment_context",
          };
        }
        if (!useCacheAlignedSummary) {
          return {
            eligible: true,
            status: "cold" as const,
            recommendation: "proceed_with_caution" as const,
            reason: "cache_alignment_not_selected",
          };
        }
        return {
          eligible: true,
          status: "warm_candidate" as const,
          recommendation: "proceed" as const,
          reason: "cache_aligned_summary_selected",
        };
      })();
      const cacheFamilyAffinity = (() => {
        if (providerCapability.cache !== "supported") {
          return {
            status: "unknown" as const,
            reason: "provider_cache_not_supported",
          };
        }
        if (!cacheFamilyKey) {
          return {
            status: "unknown" as const,
            reason: "cache_family_key_unavailable",
          };
        }
        return {
          status: "aligned" as const,
          familyKey: cacheFamilyKey,
          reason: useCacheAlignedSummary
            ? "cache_aligned_summary_family_selected"
            : "plain_summary_family_selected",
        };
      })();
      const providerModelNotes = [
        `cache=${providerCapability.cache}`,
        `json=${providerCapability.jsonReliability}`,
        `route=${compactionModelRoute.routeRef}`,
      ].join(", ");
      const baseObservability = {
        mode: context?.mode,
        cacheAlignedRequested: useCacheAlignedSummary,
        cacheSupport: providerCapability.cache,
        compareAvailable: Boolean(context),
        usedWireApi: summarizerWireApi,
        comparison: {
          mode: "cache_aligned_vs_plain" as const,
          plainRequestMessageCount,
          cacheAlignedRequestMessageCount: cacheAlignedChatMessages.length,
          plainPromptCharsEstimate,
          cacheAlignedReplayCharsEstimate,
          cacheAlignedInstructionChars,
          replayOverheadChars,
        },
        strategy: {
          kind: strategyKind as "cache_aligned" | "plain",
          providerCacheMode: providerCapability.cache,
          selectionReason: strategySelectionReason,
          degradePath: strategyDegradePath,
          providerModelNotes,
          fallbackPolicy: "fallback_summary_on_request_or_parse_or_budget_failure",
          fallbackTriggered: false,
          fallbackSummary: "primary_compaction_response",
        },
        warmupCoordination,
        cacheFamilyAffinity,
      } as const;
      try {
        const { response } = await summarizerClient.fetchWithFailover({
          timeoutMs: 30_000,
          onSummary: (summary) => {
            runtimeResilienceTracker.record({
              source: "compaction",
              phase: "compaction",
              summary,
            });
          },
          buildRequest: (profile) => {
            const trimmedBase = profile.baseUrl.replace(/\/+$/, "");
            const base = /\/v\d+$/.test(trimmedBase) ? trimmedBase : `${trimmedBase}/v1`;
            const isResponsesWireApi = summarizerWireApi === "responses";
            const url = isResponsesWireApi ? `${base}/responses` : `${base}/chat/completions`;
            const body = isResponsesWireApi
              ? {
                model: profile.model,
                input: useCacheAlignedSummary
                  ? buildCacheAlignedResponsesInput(context!, cacheAlignedInstruction)
                  : prompt,
                max_output_tokens: 1024,
              }
              : {
                model: profile.model,
                messages: useCacheAlignedSummary
                  ? buildCacheAlignedChatMessages(context!, cacheAlignedInstruction)
                  : [{ role: "user", content: prompt }],
                max_tokens: 1024,
                temperature: 0.3,
              };
            return {
              url,
              init: {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${profile.apiKey}`,
                },
                body: JSON.stringify(body),
              },
            };
          },
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const error = new Error(`Compaction summarizer failed (HTTP ${response.status}): ${errorText.slice(0, 500)}`) as Error & {
            compactionObservability?: Record<string, unknown>;
          };
          error.compactionObservability = {
            ...baseObservability,
            fallbackStage: "request",
            failureReason: error.message,
            strategy: {
              ...baseObservability.strategy,
              fallbackTriggered: true,
              fallbackSummary: "request_failed",
            },
          };
          throw error;
        }
        const json = await response.json() as any;
        const rawUsage = json?.usage && typeof json.usage === "object" ? json.usage : undefined;
        const cacheHitTokens = typeof rawUsage?.prompt_cache_hit_tokens === "number"
          ? rawUsage.prompt_cache_hit_tokens
          : undefined;
        const cacheMissTokens = typeof rawUsage?.prompt_cache_miss_tokens === "number"
          ? rawUsage.prompt_cache_miss_tokens
          : undefined;
        const cacheCost = rawUsage
          ? calculateUsageCostUsd({
            input_tokens: 0,
            output_tokens: 0,
            prompt_cache_hit_tokens: cacheHitTokens ?? 0,
            prompt_cache_miss_tokens: cacheMissTokens ?? 0,
          }, providerCapability.pricing)
          : undefined;
        const successObservability = {
          ...baseObservability,
          ...(typeof cacheHitTokens === "number" ? { cacheHitTokens } : {}),
          ...(typeof cacheMissTokens === "number" ? { cacheMissTokens } : {}),
          ...(typeof cacheCost?.cacheSavingsUsd === "number" ? { cacheSavingsUsd: cacheCost.cacheSavingsUsd } : {}),
          strategy: {
            ...baseObservability.strategy,
            fallbackTriggered: false,
            fallbackSummary: "primary_compaction_response",
          },
        } as const;
        if (summarizerWireApi === "responses") {
          if (typeof json.output_text === "string") {
            return {
              summary: json.output_text,
              observability: successObservability,
            };
          }
          const output = Array.isArray(json.output) ? json.output : [];
          const parts: string[] = [];
          for (const item of output) {
            if (item?.type !== "message" || !Array.isArray(item.content)) continue;
            for (const part of item.content) {
              if (typeof part?.text === "string") parts.push(part.text);
            }
          }
          return {
            summary: parts.join(""),
            observability: successObservability,
          };
        }
        return {
          summary: extractCompactionChatCompletionText(json.choices?.[0]?.message?.content),
          observability: successObservability,
        };
      } catch (error) {
        if (error && typeof error === "object" && "compactionObservability" in error) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const wrappedError = new Error(message) as Error & { compactionObservability?: Record<string, unknown> };
        wrappedError.compactionObservability = {
          ...baseObservability,
          fallbackStage: "response_parse",
          failureReason: message,
          strategy: {
            ...baseObservability.strategy,
            fallbackTriggered: true,
            fallbackSummary: "response_parse_failed",
          },
        };
        throw wrappedError;
      }
    };
    logger.info("compaction", `Summarizer initialized (model: ${summarizerModel}, baseUrl: ${summarizerBaseUrl}, routeRef: ${compactionModelRoute.routeRef}, source: ${compactionModelRoute.source})`);
  } else if (compactionModelRoute) {
    logger.warn("compaction", `Compaction summarizer route disabled: ${compactionModelRoute.reason} (routeRef=${compactionModelRoute.routeRef}, protocol=${compactionModelRoute.protocol ?? "openai"})`);
  }
}

const compactionOpts = {
  tokenThreshold: compactionTokenThreshold,
  warningThreshold: compactionWarningThreshold,
  blockingThreshold: compactionBlockingThreshold,
  keepRecentCount: parseInt(readEnv("BELLDANDY_COMPACTION_KEEP_RECENT") || "10", 10),
  triggerFraction: compactionTriggerFraction,
  archivalThreshold: compactionArchivalThreshold,
  maxConsecutiveCompactionFailures: compactionMaxConsecutiveFailures,
  maxPromptTooLongRetries: compactionMaxPromptTooLongRetries,
  enabled: compactionEnabled,
};
const primaryMicrocompactOpts = preservePrimaryPrefixStability
  ? {
      preservePrefixStability: true,
    }
  : undefined;

// Phase 2/3：统一压缩层与预算保护策略配置
const compressionReferenceStoreEnabled = readEnv("BELLDANDY_COMPRESSION_REFERENCE_STORE") !== "false";
const compressionPersistentReferenceStoreEnabled = readEnv("BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_STORE") === "true";
const compressionPersistentReferenceTtlMs = parseInt(readEnv("BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_TTL_MS") || String(24 * 60 * 60 * 1000), 10);
const compressionPersistentReferenceMaxEntries = parseInt(readEnv("BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_MAX_ENTRIES") || "128", 10);
const compressionReferenceStoreAllowed = compressionReferenceStoreEnabled || compressionPersistentReferenceStoreEnabled;
const compressionOpts = {
  enabled: true,
  enableReferenceStore: compressionReferenceStoreEnabled,
  persistentReferenceStore: {
    enabled: compressionPersistentReferenceStoreEnabled,
    stateDir,
    ttlMs: Number.isFinite(compressionPersistentReferenceTtlMs) && compressionPersistentReferenceTtlMs > 0
      ? compressionPersistentReferenceTtlMs
      : 24 * 60 * 60 * 1000,
    maxEntries: Number.isFinite(compressionPersistentReferenceMaxEntries) && compressionPersistentReferenceMaxEntries > 0
      ? compressionPersistentReferenceMaxEntries
      : 128,
  },
  policy: {
    allowReferenceStore: compressionReferenceStoreAllowed,
    sourceOverrides: {
      tool_result: { enabled: true, allowLossy: true, allowReferenceStore: compressionReferenceStoreAllowed },
      attachment_text: { enabled: true, allowLossy: true, allowReferenceStore: false },
    },
  },
};
const budgetProtectMode = (readEnv("BELLDANDY_BUDGET_PROTECT_MODE") || "protect_memory_capability") as "protect_memory_capability" | "history_first";
const budgetProtectKeepRecentRounds = parseInt(readEnv("BELLDANDY_BUDGET_PROTECT_KEEP_RECENT_ROUNDS") || "3", 10);
const budgetProtectOpts = {
  mode: budgetProtectMode,
  keepRecentRounds: Number.isFinite(budgetProtectKeepRecentRounds) && budgetProtectKeepRecentRounds > 0 ? budgetProtectKeepRecentRounds : 3,
  compressBeforeDelete: true,
  compressThresholdChars: 500,
};
// Phase 4：stable prefix / transient tail 拆层配置
const stablePrefixSplitEnabled = readEnv("BELLDANDY_STABLE_PREFIX_SPLIT") === "true";
const stablePrefixSplitOpts = { enabled: stablePrefixSplitEnabled };
const preflightCompressionPolicy = readPreflightCompressionPolicyFromEnv(process.env);
logger.info("compression", "Unified compression layer config", {
  enabled: compressionOpts.enabled,
  referenceStore: compressionReferenceStoreEnabled,
  persistentReferenceStore: compressionPersistentReferenceStoreEnabled,
  persistentReferenceTtlMs: compressionOpts.persistentReferenceStore.ttlMs,
  persistentReferenceMaxEntries: compressionOpts.persistentReferenceStore.maxEntries,
  budgetProtectMode: budgetProtectOpts.mode,
  budgetProtectKeepRecentRounds: budgetProtectOpts.keepRecentRounds,
  stablePrefixSplit: stablePrefixSplitEnabled,
  preflightCompression: {
    enabled: preflightCompressionPolicy.enabled,
    mode: preflightCompressionPolicy.mode,
    attachmentThresholdChars: preflightCompressionPolicy.attachmentThresholdChars,
    targetRatio: preflightCompressionPolicy.targetRatio,
    minSavingsRatio: preflightCompressionPolicy.minSavingsRatio,
    timeoutMs: preflightCompressionPolicy.timeoutMs,
    attachmentReference: preflightCompressionPolicy.attachmentReference,
  },
});
const compactionRuntimeTracker = new CompactionRuntimeTracker(compactionOpts);
if (preservePrimaryPrefixStability) {
  logger.info("compaction", "Enabled prefix-stability microcompact guard for cache-capable primary provider", {
    cacheSupport: providerCapability.cache,
    capabilitySource: providerCapability.source,
  });
}

const conversationStore = new ResidentConversationStore({
  stateDir,
  agentRegistry,
  maxHistory: parseInt(readEnv("BELLDANDY_MAX_HISTORY") || "50", 10),
  compaction: compactionOpts,
  summarizer: compactionSummarizer,
  summarizerModelName: compactionRoute?.model || compactionModel || openaiModel,
  compactionRuntimeTracker,
  onBeforeCompaction: async (event, ctx) => {
    logger.debug("compaction", "before compaction", {
      ...event,
      conversationId: ctx.sessionKey,
      agentId: ctx.agentId,
    });
    await hookRunner.runBeforeCompaction(event, ctx);
  },
  onAfterCompaction: async (event, ctx) => {
    logger.info("compaction", "after compaction", {
      ...event,
      conversationId: ctx.sessionKey,
      agentId: ctx.agentId,
    });
    await hookRunner.runAfterCompaction(event, ctx);
  },
});
const topLevelConversationLifecycle = new TopLevelConversationLifecycle();

// Wire conversationStore into ToolExecutor (for caching support)
toolExecutor.setConversationStore(conversationStore);

// 7.6 Init Sub-Agent Orchestrator (wire agentCapabilities into ToolExecutor)
let subTaskRuntimeStore: SubTaskRuntimeStore | undefined;
let subTaskWorktreeRuntime: SubTaskWorktreeRuntime | undefined;
let subAgentOrchestrator: SubAgentOrchestrator | undefined;
const goalRuntimeBindingStore = new GoalRuntimeBindingStore(stateDir, {
  warn: (message, data) => logger.warn("goal-binding", message, data),
});
let resumeSubTask:
  | ((taskId: string, message?: string, options?: SubTaskCommandRequestOptions) => Promise<SubTaskRecord | undefined>)
  | undefined;
let takeoverSubTask:
  | ((
    taskId: string,
    agentId: string,
    message?: string,
    options?: SubTaskCommandRequestOptions,
  ) => Promise<SubTaskRecord | undefined>)
  | undefined;
let updateSubTask:
  | ((taskId: string, message: string, options?: SubTaskCommandRequestOptions) => Promise<SubTaskRecord | undefined>)
  | undefined;
let workflowRuntime: WorkflowRuntime | undefined;
if (agentRegistry && toolsEnabled) {
  const subAgentMaxConcurrent = parseInt(readEnv("BELLDANDY_SUB_AGENT_MAX_CONCURRENT") || "3", 10);
  const subAgentTimeoutMs = parseInt(readEnv("BELLDANDY_SUB_AGENT_TIMEOUT_MS") || "120000", 10);
  const subAgentMaxDepth = parseInt(readEnv("BELLDANDY_SUB_AGENT_MAX_DEPTH") || "2", 10);
  const subAgentMaxQueueSize = parseInt(readEnv("BELLDANDY_SUB_AGENT_MAX_QUEUE_SIZE") || "10", 10);
  subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir, {
    info: (m, d) => logger.info("task-runtime", m, d),
    warn: (m, d) => logger.warn("task-runtime", m, d),
    error: (m, d) => logger.error("task-runtime", m, d),
    debug: (m, d) => logger.debug("task-runtime", m, d),
  }, goalRuntimeBindingStore);
  await subTaskRuntimeStore.load();
  await reconcileRuntimeLostBridgeSubtasks({
    workspaceRoot: stateDir,
    runtimeStore: subTaskRuntimeStore,
    logger: {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    },
  });
  subTaskWorktreeRuntime = new SubTaskWorktreeRuntime(stateDir, {
    info: (m, d) => logger.info("task-worktree", m, d),
    warn: (m, d) => logger.warn("task-worktree", m, d),
    error: (m, d) => logger.error("task-worktree", m, d),
    debug: (m, d) => logger.debug("task-worktree", m, d),
  });
  subTaskRuntimeStore.subscribe(createSubTaskWorktreeLifecycleHandler({
    runtimeStore: subTaskRuntimeStore,
    worktreeRuntime: subTaskWorktreeRuntime,
    logger: {
      info: (m, d) => logger.info("task-worktree", m, d),
      warn: (m, d) => logger.warn("task-worktree", m, d),
      error: (m, d) => logger.error("task-worktree", m, d),
      debug: (m, d) => logger.debug("task-worktree", m, d),
    },
  }));
  backgroundRecoveryRuntime = new BackgroundRecoveryRuntime({
    ledger: backgroundContinuationLedger,
    recoverHeartbeat: async () => {
      if (!heartbeatRunner) {
        return {
          status: "skipped",
          reason: "Heartbeat runner is not available.",
        };
      }
      const result = await heartbeatRunner.runOnce();
      return {
        status: result.status,
        runId: result.runId,
        reason: result.reason,
        message: result.message,
      };
    },
    recoverCron: async (jobId) => {
      if (!cronSchedulerHandle) {
        return {
          status: "skipped",
          reason: "Cron scheduler is not available.",
        };
      }
      return cronSchedulerHandle.runJobNow(jobId);
    },
    recoverSubtask: async (taskId, message) => {
      if (!resumeSubTask) {
        return {
          accepted: false,
          reason: "Subtask resume controller is not available.",
        };
      }
      const resumed = await resumeSubTask(taskId, message);
      return {
        accepted: Boolean(resumed),
        runId: resumed?.sessionId || resumed?.id,
        reason: resumed ? "Subtask recovery accepted." : "Subtask recovery returned no task.",
      };
    },
  });
  const subTaskBackgroundContinuationLedgerHandler = createSubTaskBackgroundContinuationLedgerHandler({
    ledger: backgroundContinuationLedger,
    onFailedRecord: async (record) => {
      await backgroundRecoveryRuntime?.maybeRecover(record);
    },
    logger: {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    },
  });
  subTaskRuntimeStore.subscribe(subTaskBackgroundContinuationLedgerHandler);
  for (const item of await subTaskRuntimeStore.listTasks(undefined, { includeArchived: true })) {
    subTaskBackgroundContinuationLedgerHandler({
      kind: item.archivedAt ? "archived" : "updated",
      item,
    });
  }
  await reconcileSubTaskWorktreeRuntimes({
    runtimeStore: subTaskRuntimeStore,
    worktreeRuntime: subTaskWorktreeRuntime,
    logger: {
      info: (m, d) => logger.info("task-worktree", m, d),
      warn: (m, d) => logger.warn("task-worktree", m, d),
      error: (m, d) => logger.error("task-worktree", m, d),
      debug: (m, d) => logger.debug("task-worktree", m, d),
    },
  });

  subAgentOrchestrator = new SubAgentOrchestrator({
    agentRegistry,
    conversationStore,
    maxConcurrent: subAgentMaxConcurrent,
    maxQueueSize: subAgentMaxQueueSize,
    sessionTimeoutMs: subAgentTimeoutMs,
    maxDepth: subAgentMaxDepth,
    logger: {
      info: (m, d) => logger.info("orchestrator", m, d),
      warn: (m, d) => logger.warn("orchestrator", m, d),
      error: (m, d) => logger.error("orchestrator", m, d),
      debug: (m, d) => logger.debug("orchestrator", m, d),
    },
    onEvent: createSubTaskRuntimeEventHandler(subTaskRuntimeStore, {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    }),
  });

  toolExecutor.setAgentCapabilities(createSubTaskAgentCapabilities({
    orchestrator: subAgentOrchestrator,
    runtimeStore: subTaskRuntimeStore,
    agentRegistry,
    resolveIdentityAuthorityProfile: resolveIdentityAuthorityProfileForAgent,
    worktreeRuntime: subTaskWorktreeRuntime,
    logger: {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    },
  }));
  toolExecutor.setBridgeSessionGovernance(createBridgeSessionGovernanceCapabilities({
    runtimeStore: subTaskRuntimeStore,
  }));

  updateSubTask = createSubTaskUpdateController({
    runtimeStore: subTaskRuntimeStore,
    orchestrator: subAgentOrchestrator,
    conversationStore,
    logger: {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    },
  });
  const resumeAgentSubTask = createSubTaskResumeController({
    runtimeStore: subTaskRuntimeStore,
    orchestrator: subAgentOrchestrator,
    agentRegistry,
    conversationStore,
    logger: {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    },
  });
  const resumeBridgeSessionSubTask = createBridgeSessionResumeController({
    runtimeStore: subTaskRuntimeStore,
    bridgeRuntimeStore: subTaskRuntimeStore,
    toolExecutor,
  });
  resumeSubTask = createGatewaySubTaskResumeDispatcher({
    runtimeStore: subTaskRuntimeStore,
    resumeBridgeSessionSubTask,
    resumeAgentSubTask,
  });
  const takeoverAgentSubTaskController = createSubTaskTakeoverController({
    runtimeStore: subTaskRuntimeStore,
    orchestrator: subAgentOrchestrator,
    agentRegistry,
    conversationStore,
    logger: {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    },
  });
  const takeoverBridgeSessionSubTask = createBridgeSessionTakeoverController({
    runtimeStore: subTaskRuntimeStore,
    bridgeRuntimeStore: subTaskRuntimeStore,
    toolExecutor,
    logger: {
      warn: (m, d) => logger.warn("task-runtime", m, d),
    },
  });
  takeoverSubTask = createGatewaySubTaskTakeoverDispatcher({
    runtimeStore: subTaskRuntimeStore,
    takeoverBridgeSessionSubTask,
    takeoverAgentSubTask: takeoverAgentSubTaskController,
  });

  logger.info("orchestrator", `Sub-agent orchestrator initialized (maxConcurrent=${subAgentMaxConcurrent}, queue=${subAgentMaxQueueSize}, timeout=${subAgentTimeoutMs}ms, maxDepth=${subAgentMaxDepth})`);
  logger.info("task-runtime", "Sub-task runtime initialized for sub-agent orchestration.");
}

backgroundRecoveryRuntime ??= new BackgroundRecoveryRuntime({
  ledger: backgroundContinuationLedger,
  recoverHeartbeat: async () => {
    if (!heartbeatRunner) {
      return {
        status: "skipped",
        reason: "Heartbeat runner is not available.",
      };
    }
    const result = await heartbeatRunner.runOnce();
    return {
      status: result.status,
      runId: result.runId,
      reason: result.reason,
      message: result.message,
    };
  },
  recoverCron: async (jobId) => {
    if (!cronSchedulerHandle) {
      return {
        status: "skipped",
        reason: "Cron scheduler is not available.",
      };
    }
    return cronSchedulerHandle.runJobNow(jobId);
  },
  recoverSubtask: async (taskId, message) => {
    if (!resumeSubTask) {
      return {
        accepted: false,
        reason: "Subtask resume controller is not available.",
      };
    }
    const resumed = await resumeSubTask(taskId, message);
    return {
      accepted: Boolean(resumed),
      runId: resumed?.sessionId || resumed?.id,
      reason: resumed ? "Subtask recovery accepted." : "Subtask recovery returned no task.",
    };
  },
});

const ttsEnabledPath = path.join(stateDir, "TTS_ENABLED");
const isTtsEnabledFn = () => {
  const ttsEnv = process.env.BELLDANDY_TTS_ENABLED;
  if (ttsEnv === "false") return false;
  return ttsEnv === "true" || fs.existsSync(ttsEnabledPath);
};

// 7.7 Init scoped MemoryManagers (default + resident agent workspaces)
const teamSharedMemoryEnabled = readEnv("BELLDANDY_TEAM_SHARED_MEMORY_ENABLED") === "true";
const embeddingApiKey = readEnv("BELLDANDY_EMBEDDING_OPENAI_API_KEY") ?? openaiApiKey;
const embeddingBaseUrl = readEnv("BELLDANDY_EMBEDDING_OPENAI_BASE_URL") ?? openaiBaseUrl;
const embeddingModel = readEnv("BELLDANDY_EMBEDDING_MODEL");
const embeddingProvider = (readEnv("BELLDANDY_EMBEDDING_PROVIDER") as "openai" | "local") || "openai";
const localEmbeddingModel = readEnv("BELLDANDY_LOCAL_EMBEDDING_MODEL");
const embeddingBatchSize = Number(readEnv("BELLDANDY_EMBEDDING_BATCH_SIZE")) || 2;

// 若 embedding 需要 API Key 但 key 为空，则自动降级为不启用向量检索。
// MemoryManager 会使用 NullEmbeddingProvider，Gateway 可以正常启动。
// 用户通过 WebChat 设置面板配置 Key 后重启即可恢复向量检索。
const resolvedEmbeddingEnabled = embeddingEnabled && !(embeddingProvider === "openai" && !embeddingApiKey);
if (embeddingEnabled && !resolvedEmbeddingEnabled) {
  logger.warn("memory", "BELLDANDY_EMBEDDING_ENABLED=true but no API key found — embedding disabled. Configure API Key via WebChat settings and restart.");
}


// L0 摘要层配置
const summaryEnabled = memoryRuntimeSwitches.summaryEnabled;
const summaryModel = readEnv("BELLDANDY_MEMORY_SUMMARY_MODEL") || openaiModel;
const summaryBaseUrl = readEnv("BELLDANDY_MEMORY_SUMMARY_BASE_URL") || openaiBaseUrl;
const summaryApiKey = readEnv("BELLDANDY_MEMORY_SUMMARY_API_KEY") || openaiApiKey;

// M-N3: 会话记忆自动提取配置
const evolutionEnabled = memoryRuntimeSwitches.evolutionEnabled;
const evolutionModel = readEnv("BELLDANDY_MEMORY_EVOLUTION_MODEL") || openaiModel;
const evolutionBaseUrl = readEnv("BELLDANDY_MEMORY_EVOLUTION_BASE_URL") || openaiBaseUrl;
const evolutionApiKey = readEnv("BELLDANDY_MEMORY_EVOLUTION_API_KEY") || openaiApiKey;
const evolutionMinMessages = Number(readEnv("BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES")) || 4;

// M-N4: 源路径聚合检索配置
const deepRetrievalEnabled = memoryRuntimeSwitches.deepRetrievalEnabled;
const nodeAssistedRetrievalEnabled = memoryRuntimeSwitches.nodeAssistedRetrievalEnabled;

// Task 层总结配置
const taskStatsCarveOutEnabled = memoryRuntimeSwitches.taskStatsCarveOutEnabled;
const taskMemoryEnabled = memoryRuntimeSwitches.taskMemoryEnabled;
const taskSummaryEnabled = memoryRuntimeSwitches.taskSummaryEnabled;
const taskSummaryModel = readEnv("BELLDANDY_TASK_SUMMARY_MODEL") || openaiModel;
const taskSummaryBaseUrl = readEnv("BELLDANDY_TASK_SUMMARY_BASE_URL") || openaiBaseUrl;
const taskSummaryApiKey = readEnv("BELLDANDY_TASK_SUMMARY_API_KEY") || openaiApiKey;
const taskSummaryMinDurationMs = Number(readEnv("BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS")) || 15_000;
const taskSummaryMinToolCalls = Number(readEnv("BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS")) || 2;
const taskSummaryMinTokenTotal = Number(readEnv("BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL")) || 2_000;
const configuredExperienceAutoPromotionEnabled = (readEnv("BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED") ?? "true") !== "false";
const configuredExperienceAutoMethodEnabled = (readEnv("BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED") ?? "true") !== "false";
const configuredExperienceAutoSkillEnabled = (readEnv("BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED") ?? "true") !== "false";
const methodGenerationConfirmRequired = parseEnvBoolean(readEnv("BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED"));
const skillGenerationConfirmRequired = parseEnvBoolean(readEnv("BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED"));
const methodPublishConfirmRequired = parseEnvBoolean(readEnv("BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED"));
const skillPublishConfirmRequired = parseEnvBoolean(readEnv("BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED"));
const taskMemoryCarveOutEffects = resolveTaskMemoryCarveOutEffects({
  taskStatsCarveOutEnabled,
  taskDedupGuardEnabled: configuredTaskDedupGuardEnabled,
  experienceAutoPromotionEnabled: configuredExperienceAutoPromotionEnabled,
  experienceAutoMethodEnabled: configuredExperienceAutoMethodEnabled,
  experienceAutoSkillEnabled: configuredExperienceAutoSkillEnabled,
});
const taskDedupGuardEnabled = taskMemoryCarveOutEffects.taskDedupGuardEnabled;
const experienceAutoPromotionEnabled = taskMemoryCarveOutEffects.experienceAutoPromotionEnabled;
const experienceAutoMethodEnabled = taskMemoryCarveOutEffects.experienceAutoMethodEnabled;
const experienceAutoSkillEnabled = taskMemoryCarveOutEffects.experienceAutoSkillEnabled;
const effectiveExperienceAutoMethodEnabled = experienceAutoMethodEnabled && !methodGenerationConfirmRequired;
const effectiveExperienceAutoSkillEnabled = experienceAutoSkillEnabled && !skillGenerationConfirmRequired;
let requestMemoryEvolutionExtraction:
  | ((input: {
    conversationId: string;
    source: string;
    threshold?: number;
    force?: boolean;
  }) => Promise<void>)
  | undefined;

// P1-4: Task-aware Embedding 前缀（用于 Jina/BGE 等支持 task 参数的模型）
const embeddingQueryPrefix = readEnv("BELLDANDY_EMBEDDING_QUERY_PREFIX") || undefined;
const embeddingPassagePrefix = readEnv("BELLDANDY_EMBEDDING_PASSAGE_PREFIX") || undefined;

// P1-5 & P0-2: Reranker 配置
const rerankerMinScore = Number(readEnv("BELLDANDY_RERANKER_MIN_SCORE")) || undefined;
const rerankerLengthNormAnchor = Number(readEnv("BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR")) || undefined;

const scopedMemoryManagers = createScopedMemoryManagers({
  stateDir,
  agentRegistry,
  modelsDir: path.join(stateDir, "models"),
  includeTeamSharedMemory: teamSharedMemoryEnabled,
  embeddingEnabled: resolvedEmbeddingEnabled,
  openaiApiKey: embeddingApiKey,
  openaiBaseUrl: embeddingBaseUrl,
  openaiModel: embeddingModel,
  provider: embeddingProvider,
  localModel: localEmbeddingModel,
  embeddingBatchSize,
  embeddingQueryPrefix,
  embeddingPassagePrefix,
  summaryEnabled,
  summaryModel,
  summaryBaseUrl,
  summaryApiKey,
  modelPrivacyRuntime: memoryBackgroundRuntime.modelPrivacyRuntime,
  evolutionEnabled,
  evolutionModel,
  evolutionBaseUrl,
  evolutionApiKey,
  evolutionMinMessages,
  taskMemoryEnabled,
  taskSummaryEnabled,
  taskSummaryModel,
  taskSummaryBaseUrl,
  taskSummaryApiKey,
  taskSummaryMinDurationMs,
  taskSummaryMinToolCalls,
  taskSummaryMinTokenTotal,
  experienceAutoPromotionEnabled,
  experienceAutoMethodEnabled: effectiveExperienceAutoMethodEnabled,
  experienceAutoSkillEnabled: effectiveExperienceAutoSkillEnabled,
  conversationStore,
  deepRetrievalEnabled,
  nodeAssistedRetrievalEnabled,
  rerankerOptions: {
    ...(rerankerMinScore != null ? { minScore: rerankerMinScore } : {}),
    ...(rerankerLengthNormAnchor != null ? { lengthNormAnchor: rerankerLengthNormAnchor } : {}),
  },
  indexerOptions: {
    ignorePatterns: ["node_modules", ".git", "logs", "models", "plugins", "skills", "methods", ".star_sanctuary", ".belldandy"],
    extensions: [".md", ".txt", ".jsonl"],
    watch: true,
  },
});
if (taskStatsCarveOutEnabled) {
  logger.info(
    "memory",
    "Task stats carve-out enabled: task capture stays on while memory master switch is off; task summary, task dedup guard, and experience auto promotion remain disabled.",
  );
}
logger.info(
  "memory",
  `Scoped MemoryManagers initialized (bindings=${scopedMemoryManagers.records.length}, unique=${new Set(scopedMemoryManagers.records.map((item) => item.stateDir)).size}, teamShared=${teamSharedMemoryEnabled}, summary=${summaryEnabled}, evolution=${evolutionEnabled}, taskMemory=${taskMemoryEnabled}, taskStatsCarveOut=${taskStatsCarveOutEnabled}, experienceAuto=${experienceAutoPromotionEnabled}, methodAuto=${effectiveExperienceAutoMethodEnabled}, skillAuto=${effectiveExperienceAutoSkillEnabled}, methodGenerateConfirm=${methodGenerationConfirmRequired}, skillGenerateConfirm=${skillGenerationConfirmRequired}, methodPublishConfirm=${methodPublishConfirmRequired}, skillPublishConfirm=${skillPublishConfirmRequired})`,
);

if (agentRegistry && toolsEnabled) {
  // Workflow 与 Memory 共用同一 SQLite schema，必须在 scoped manager 注册完成后装配。
  const workflowMemoryManager = scopedMemoryManagers.defaultManager;
  try {
    const dbHandle = workflowMemoryManager.getDbHandleForSharedSchema();
    workflowRuntime = new WorkflowRuntime({
      db: dbHandle,
      agentRegistry,
      conversationStore,
      recoveryStore: codingRunRecoveryStore,
      readEnv: readEnv,
      workflowExecutionPolicy: resolveWorkflowExecutionPolicy({ stateDir, readEnv }),
      resolveWorkflowAgentLaunchSpec: (input) => normalizeAgentLaunchSpecWithCatalog({
        instruction: input.instruction,
        parentConversationId: input.parentConversationId,
        agentId: "default",
        modelOverride: input.modelOverride,
        role: input.role,
        allowedToolFamilies: input.allowedToolFamilies,
        maxToolRiskLevel: input.maxToolRiskLevel,
        timeoutMs: input.timeoutMs,
        delegationProtocol: input.delegationProtocol,
        cwd: input.cwd,
        isolationMode: input.isolationMode,
      }, {
        agentRegistry,
        defaults: {
          timeoutMs: parseInt(readEnv("BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS") ?? "300000", 10),
        },
      }),
      resolveAgentExecutionFingerprintInputs: (input) => {
        const profile = agentRegistry.getProfile(input.profileId) ?? agentRegistry.getProfile(input.agentId);
        const inspection = profile
          ? gatewayPromptInspectionRuntime.buildEffectiveAgentPromptInspection(profile)
          : undefined;
        return {
          agentProfileId: profile?.id ?? input.profileId ?? input.agentId,
          systemPromptHash: typeof inspection?.metadata?.systemPromptFingerprint === "string"
            ? inspection.metadata.systemPromptFingerprint
            : undefined,
          toolPolicyHash: computeWorkflowToolPolicyHash({
            role: input.role,
            permissionMode: input.permissionMode,
            allowedToolFamilies: input.allowedToolFamilies,
            maxToolRiskLevel: input.maxToolRiskLevel,
            policySummary: input.policySummary,
          }),
        };
      },
      logger: {
        info: (m, d) => logger.info("workflow", m, d),
        warn: (m, d) => logger.warn("workflow", m, d),
        error: (m, d) => logger.error("workflow", m, d),
        debug: (m, d) => logger.debug("workflow", m, d),
      },
    });
    toolExecutor.setWorkflowRuntime(workflowRuntime);
    toolExecutor.registerTool(runWorkflowTool, { origin: "workflow" });
    registerCodeAuditBuiltinWorkflow();
    registerParallelResearchBuiltinWorkflow();
    logger.info("workflow", "WorkflowRuntime initialized (run_workflow tool registered, builtins: code-audit, parallel-research)");
  } catch (err) {
    logger.warn("workflow", `Failed to initialize WorkflowRuntime: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ========== 后台任务调度：pause/resume + 空闲摘要 ==========

const IDLE_SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
const memoryIdleSummaryRuntime = startMemoryIdleSummaryRuntime({
  summaryEnabled,
  intervalMs: IDLE_SUMMARY_INTERVAL_MS,
  listManagers: listGlobalMemoryManagers,
  runCoordinator: backgroundRunCoordinator,
  jobScheduler: memoryBackgroundRuntime.jobScheduler,
  resolveAgentId: (manager) => scopedMemoryManagers.records.find((item) => item.manager === manager)?.agentId ?? "default",
  logger: {
    info: (message) => logger.info("memory-summary", message),
    error: (message) => logger.error("memory-summary", message),
  },
});
if (summaryEnabled) {
  logger.info("memory-summary", `Idle summary timer started (interval=${IDLE_SUMMARY_INTERVAL_MS / 1000}s)`);
}

// before_agent_start: 暂停后台 LLM 任务
hookRegistry.register({
  source: "memory-throttle",
  hookName: "before_agent_start",
  priority: 50, // 高优先级，尽早暂停
  handler: async () => {
    memoryIdleSummaryRuntime.onAgentStart();
    logger.debug("memory-throttle", "Paused background LLM tasks (agent active)");
  },
});

// agent_end: 恢复后台 LLM 任务
hookRegistry.register({
  source: "memory-throttle",
  hookName: "agent_end",
  priority: 50, // 高优先级，在 evolution hook 之前恢复
  handler: async () => {
    memoryIdleSummaryRuntime.onAgentEnd();
  },
});

function detectTaskSource(sessionKey: string, meta?: Record<string, unknown>): "chat" | "sub_agent" | "cron" | "heartbeat" | "manual" {
  if (typeof meta?._parentConversationId === "string" && meta._parentConversationId.trim()) {
    return "sub_agent";
  }
  if (sessionKey.startsWith("sub_")) return "sub_agent";
  if (sessionKey.startsWith("cron-")) return "cron";
  if (sessionKey.startsWith("heartbeat-")) return "heartbeat";
  return "chat";
}

function extractGoalTaskMetadata(
  sessionKey: string,
  meta?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const parsed = parseGoalSessionKey(sessionKey);
  const goalId = typeof meta?.goalId === "string" && meta.goalId.trim()
    ? meta.goalId.trim()
    : parsed?.goalId;
  const nodeId = typeof meta?.nodeId === "string" && meta.nodeId.trim()
    ? meta.nodeId.trim()
    : parsed?.kind === "goal_node" ? parsed.nodeId : undefined;
  const runId = typeof meta?.runId === "string" && meta.runId.trim()
    ? meta.runId.trim()
    : parsed?.kind === "goal_node" ? parsed.runId : undefined;
  const goalSession = typeof meta?.goalSession === "boolean"
    ? meta.goalSession
    : Boolean(parsed?.goalSession);

  const result: Record<string, unknown> = {};
  if (goalId) result.goalId = goalId;
  if (nodeId) result.nodeId = nodeId;
  if (runId) result.runId = runId;
  if (goalSession) result.goalSession = true;
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseContextInjectionCategories(raw: string | undefined): MemoryCategory[] {
  const allowed = new Set<MemoryCategory>(["preference", "fact", "decision", "entity", "experience", "other"]);
  const values = String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is MemoryCategory => allowed.has(item as MemoryCategory));
  return values.length > 0 ? values : ["preference", "fact", "decision", "entity"];
}

function extractTaskArtifactPaths(toolName: string, result: unknown, params: Record<string, unknown>): string[] {
  if (toolName === "file_write" && typeof params.path === "string" && params.path.trim()) {
    return [params.path.trim()];
  }

  if (toolName === "method_create" && typeof params.filename === "string" && params.filename.trim()) {
    return [`methods/${params.filename.trim()}`];
  }

  if (typeof result !== "string" || !result.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;

    if (toolName === "apply_patch" && parsed.summary && typeof parsed.summary === "object") {
      const summary = parsed.summary as Record<string, unknown>;
      const values = [
        ...(Array.isArray(summary.added) ? summary.added : []),
        ...(Array.isArray(summary.modified) ? summary.modified : []),
      ].map((value) => String(value)).filter(Boolean);
      return [...new Set(values)];
    }

    if ((toolName === "file_write" || toolName === "file_delete") && typeof parsed.path === "string" && parsed.path.trim()) {
      return [parsed.path.trim()];
    }
  } catch {
    // ignore parse failure
  }

  return [];
}

if (taskMemoryEnabled) {
  hookRegistry.register({
    source: "task-memory",
    hookName: "before_agent_start",
    priority: 40,
    handler: async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      const mm = getGlobalMemoryManager({
        agentId: ctx.agentId,
        conversationId: sessionKey,
      });
      if (!mm) return;

      const meta = event.meta && typeof event.meta === "object"
        ? event.meta as Record<string, unknown>
        : undefined;
      const objective = typeof event.userInput === "string" && event.userInput.trim()
        ? event.userInput
        : event.prompt;

      mm.startTaskCapture({
        conversationId: sessionKey,
        sessionKey,
        agentId: ctx.agentId,
        source: detectTaskSource(sessionKey, meta),
        objective,
        parentConversationId: typeof meta?._parentConversationId === "string"
          ? meta._parentConversationId
          : undefined,
        metadata: extractGoalTaskMetadata(sessionKey, meta),
      });
    },
  });

  if (taskDedupGuardEnabled) {
    hookRegistry.register({
      source: "task-memory",
      hookName: "before_tool_call",
      priority: 40,
      handler: async (event, ctx) => {
        const mm = getGlobalMemoryManager({
          agentId: ctx.agentId,
          conversationId: ctx.sessionKey,
        });
        if (!mm) return;

        if (shouldBypassToolDedup(event.params ?? {})) {
          return;
        }

        const mode = resolveToolDedupMode(event.toolName, {
          globalMode: taskDedupGlobalMode,
          policy: taskDedupPolicy,
        });
        if (mode === "off") return;

        const actionKey = buildToolActionKey(event.toolName, event.params ?? {});
        if (!actionKey) return;

        const duplicated = mm.findRecentDuplicateToolAction({
          toolName: event.toolName,
          actionKey,
          agentId: ctx.agentId,
          withinMinutes: taskDedupWindowMinutes,
        });
        if (!duplicated) return;

        const label = duplicated.title ?? duplicated.objective ?? duplicated.summary ?? duplicated.id;
        const duplicateMessage = `检测到相同工具动作已在 ${duplicated.finishedAt ?? duplicated.updatedAt} 的任务「${label}」中成功执行`;

        if (mode === "warn-only") {
          logger.warn("task-dedup", `${duplicateMessage}，本次将把重复执行提示注入给 Agent: tool=${event.toolName}, actionKey=${actionKey}`);
          return {
            skipExecution: true,
            syntheticResult: buildWarnOnlyDuplicateNotice({
              toolName: event.toolName,
              actionKey,
              finishedAt: duplicated.finishedAt ?? duplicated.updatedAt,
              taskLabel: label,
              withinMinutes: taskDedupWindowMinutes,
            }),
          };
        }

        return {
          block: true,
          blockReason: `${duplicateMessage}。当前工具属于高风险重复动作，已阻止再次执行。若确需重试，请显式传入 retry=true、force=true 或 allowDuplicate=true。`,
        };
      },
    });
  }

  hookRegistry.register({
    source: "task-memory",
    hookName: "after_tool_call",
    priority: 40,
    handler: async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      const mm = getGlobalMemoryManager({
        agentId: ctx.agentId,
        conversationId: sessionKey,
      });
      if (!mm) return;

      const artifactPaths = extractTaskArtifactPaths(
        event.toolName,
        event.result,
        event.params ?? {},
      );

      mm.recordTaskToolCall(sessionKey, {
        toolName: event.toolName,
        success: !event.error,
        durationMs: event.durationMs,
        note: event.error,
        actionKey: buildToolActionKey(event.toolName, event.params ?? {}),
        artifactPaths,
      });
    },
  });

  hookRegistry.register({
    source: "task-memory",
    hookName: "agent_end",
    priority: 40,
    handler: async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      const mm = getGlobalMemoryManager({
        agentId: ctx.agentId,
        conversationId: sessionKey,
      });
      if (!mm) return;

      const taskId = mm.completeTaskCapture({
        conversationId: sessionKey,
        success: event.success,
        durationMs: event.durationMs,
        error: event.error,
        messages: Array.isArray(event.messages) ? event.messages : undefined,
      });
      if (!taskId) return;

        for (const candidate of mm.listExperienceCandidates(10, { taskId })) {
          if (candidate.type !== "method" && candidate.type !== "skill") continue;
          emitConversationToolEvent(sessionKey, {
            kind: "experience_draft_generated",
            conversationId: sessionKey,
            taskId,
            candidateId: candidate.id,
            candidateType: candidate.type,
            title: candidate.title,
            agentId: ctx.agentId || "default",
            source: "task_auto_promotion",
          });
        }

      runPostTaskLearningReview({
        stateDir,
        residentMemoryManagers: scopedMemoryManagers.records,
        agentId: ctx.agentId,
        task: mm.getTaskDetail(taskId),
        findCandidate: (resolvedTaskId, type) => mm.findExperienceCandidateByTaskAndType(resolvedTaskId, type),
        promote: (resolvedTaskId, type) => type === "method"
          ? mm.promoteTaskToMethodCandidate(resolvedTaskId)
          : mm.promoteTaskToSkillCandidate(resolvedTaskId),
        canPromote: (type) => resolveExperiencePromotionGate(type),
      }).then((result) => {
        if (!result) return;
          for (const action of result.actions) {
            if (action.status !== "generated" || !action.candidateId) continue;
            emitConversationToolEvent(sessionKey, {
              kind: "experience_draft_generated",
              conversationId: sessionKey,
              taskId,
              candidateId: action.candidateId,
              candidateType: action.type,
              title: action.title,
              agentId: ctx.agentId || "default",
              source: "post_task_learning_review",
            });
          }
        logger.info("learning-review", `post-run ${result.summary}`);
      }).catch((err) => {
        logger.warn("learning-review", `Post-run learning review failed for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
  });

  logger.info(
    "task-memory",
    `Registered task memory hooks (taskStatsCarveOut=${taskStatsCarveOutEnabled}, dedupGuard=${taskDedupGuardEnabled}, dedupWindowMinutes=${taskDedupWindowMinutes}, ${summarizeToolDedupPolicy({
      globalMode: taskDedupGlobalMode,
      policy: taskDedupPolicy,
    })})`,
  );
}

// M-N3: 注册 agent_end hook 用于会话记忆自动提取
if (evolutionEnabled) {
  hookRegistry.register({
    source: "memory-evolution",
    hookName: "agent_end",
    priority: 100, // 低于 plugin-bridge (200)，让插件先执行
    handler: async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;
      if (!event.success) return; // 失败的会话不提取
      const scheduleExtraction = requestMemoryEvolutionExtraction;
      if (!scheduleExtraction) {
        logger.warn("memory-evolution", `Skipped scheduling durable extraction for session ${sessionKey}: scheduler unavailable`);
        return;
      }

      // 延迟 5s 仅保留为节流窗口，真正的提取调度统一交给 server/runtime。
      setTimeout(() => {
        scheduleExtraction({
          conversationId: sessionKey,
          source: "memory_evolution",
        }).catch(err => {
          logger.error("memory-evolution", `Durable extraction scheduling failed for session ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 5000);
    },
  });
  logger.info("memory-evolution", "Registered agent_end hook for unified durable extraction scheduling");
}

function resolveExperiencePromotionGate(type: "method" | "skill"): { allowed: boolean; reason?: string } {
  if (!experienceAutoPromotionEnabled) {
    return { allowed: false, reason: "experience auto promotion is disabled" };
  }

  if (type === "method") {
    if (!experienceAutoMethodEnabled) {
      return { allowed: false, reason: "method auto promotion is disabled" };
    }
    if (methodGenerationConfirmRequired) {
      return { allowed: false, reason: "method generation requires user confirmation" };
    }
    return { allowed: true };
  }

  if (!experienceAutoSkillEnabled) {
    return { allowed: false, reason: "skill auto promotion is disabled" };
  }
  if (skillGenerationConfirmRequired) {
    return { allowed: false, reason: "skill generation requires user confirmation" };
  }
  return { allowed: true };
}

function parseEnvBoolean(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

// ========== 扩展 C：自动任务边界检测 ==========
// 通过 hook 系统自动识别任务边界：
// - after_tool_call: 检测到 sessions_spawn / delegate_task / delegate_parallel 时自动 start 计数器
// - agent_end: 自动 stop 所有自动启动的计数器并广播结果
const AUTO_BOUNDARY_TOOLS = new Set(["sessions_spawn", "delegate_task", "delegate_parallel"]);
const AUTO_COUNTER_PREFIX = "auto:";

if (autoTaskReportFlags.timeEnabled || autoTaskReportFlags.tokenEnabled) {
  hookRegistry.register({
    source: "auto-task-report",
    hookName: "before_agent_start",
    priority: 120,
    handler: async (_event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      beginAutoTaskReport(sessionKey, autoTaskReportFlags);
    },
  });

  hookRegistry.register({
    source: "auto-task-report",
    hookName: "agent_end",
    priority: 95,
    handler: async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      if (autoTaskReportFlags.timeEnabled) {
        recordAutoTaskReportDuration(sessionKey, event.durationMs);
      }

      if (!autoTaskReportFlags.tokenEnabled) {
        return;
      }

      const counter = toolExecutor.getTokenCounter(sessionKey);
      if (!counter || !counter.list().includes(AUTO_TASK_REPORT_COUNTER_NAME)) {
        return;
      }

      try {
        const result = counter.stop(AUTO_TASK_REPORT_COUNTER_NAME);
        recordAutoTaskReportToken({
          conversationId: sessionKey,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.totalTokens,
        });
      } catch (err) {
        logger.warn(
          "auto-task-report",
          `Failed to stop auto task report counter for session ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  logger.info(
    "auto-task-report",
    `Registered auto task report hooks (time=${autoTaskReportFlags.timeEnabled}, token=${autoTaskReportFlags.tokenEnabled})`,
  );
}

if (toolsEnabled) {
  // after_tool_call: 检测任务派发工具，自动启动 token 计数器
  hookRegistry.register({
    source: "auto-boundary",
    hookName: "after_tool_call",
    priority: 150,
    handler: async (event, ctx) => {
      const toolName = ctx.toolName;
      if (!toolName || !AUTO_BOUNDARY_TOOLS.has(toolName)) return;

      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      const counter = toolExecutor.getTokenCounter(sessionKey);
      if (!counter) return;

      const counterName = `${AUTO_COUNTER_PREFIX}${toolName}_${Date.now()}`;

      try {
        counter.start(counterName);
        logger.debug("auto-boundary", `Auto-started counter "${counterName}" after ${toolName} (session: ${sessionKey})`);
      } catch (err) {
        logger.warn("auto-boundary", `Failed to auto-start counter: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  // agent_end: 自动停止所有 auto: 前缀的计数器并广播结果
  hookRegistry.register({
    source: "auto-boundary",
    hookName: "agent_end",
    priority: 90, // agent_end 为并行 void hook，执行顺序不由 priority 决定；token counter 可用性由 tool-agent.ts finally 块排序保证
    handler: async (event, ctx) => {
      const sessionKey = ctx.sessionKey;
      if (!sessionKey) return;

      const counter = toolExecutor.getTokenCounter(sessionKey);
      if (!counter) return;

      const activeCounters = counter.list();
      const autoCounters = activeCounters.filter(name => name.startsWith(AUTO_COUNTER_PREFIX));
      if (autoCounters.length === 0) return;

      for (const name of autoCounters) {
        try {
          const result = counter.stop(name);
          // 广播结果到前端
          serverBroadcast?.({
            type: "event",
            event: "token.counter.result",
            payload: {
              conversationId: sessionKey,
              auto: true,
              ...result,
            },
          });
          logger.info("auto-boundary", `Auto-stopped counter "${name}": input=${result.inputTokens}, output=${result.outputTokens}, total=${result.totalTokens}, duration=${result.durationMs}ms`);
        } catch (err) {
          logger.warn("auto-boundary", `Failed to auto-stop counter "${name}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
  });

  logger.info("auto-boundary", "Registered auto task boundary detection hooks (Extension C)");
}

// Load Webhook configuration
const webhookConfig = loadWebhookConfig(webhookConfigPath, {
  info: (m, d) => logger.info("webhook", m, d),
  warn: (m, d) => logger.warn("webhook", m, d),
  error: (m, d) => logger.error("webhook", m, d),
});

const webhookIdempotency = new IdempotencyManager(webhookIdempotencyWindowMs);
const goalManager = new GoalManager(stateDir, {
  bindingStore: goalRuntimeBindingStore,
});
const generateCapabilityPlanForNode = createCapabilityPlanGenerator({
  goalManager,
  methodsDir,
  skillRegistry,
  toolsConfigManager,
  agentRegistry,
  getMcpDiagnostics: getMCPDiagnostics,
  getDefaultCapabilityPlanInput: () => {
    const runtimeSwitches = resolveCommanderRuntimeSwitches(readEnv);
    return {
      forceMode: runtimeSwitches.defaultGoalExecutionMode,
      forceGovernanceMode: runtimeSwitches.commanderMode === "on"
        ? "commander"
        : runtimeSwitches.commanderMode === "off"
        ? "direct"
        : runtimeSwitches.defaultGoalGovernanceMode,
      commanderAgentId: runtimeSwitches.defaultCommanderAgentId,
    };
  },
});

toolExecutor.setGoalCapabilities({
  createGoal: (input) => goalManager.createGoal(input),
  listGoals: () => goalManager.listGoals(),
  getGoal: (goalId) => goalManager.getGoal(goalId),
  resumeGoal: (goalId, nodeId) => goalManager.resumeGoal(goalId, nodeId),
  pauseGoal: (goalId) => goalManager.pauseGoal(goalId),
  generateHandoff: (goalId) => goalManager.generateHandoff(goalId),
  generateRetrospective: (goalId) => goalManager.generateRetrospective(goalId),
  generateExperienceSuggestions: (goalId) => goalManager.generateExperienceSuggestions(goalId),
  generateMethodCandidates: (goalId) => goalManager.generateMethodCandidates(goalId),
  generateSkillCandidates: (goalId) => goalManager.generateSkillCandidates(goalId),
  generateFlowPatterns: (goalId) => goalManager.generateFlowPatterns(goalId),
  generateCrossGoalFlowPatterns: () => goalManager.generateCrossGoalFlowPatterns(),
  getReviewGovernanceSummary: (goalId) => goalManager.getReviewGovernanceSummary(goalId),
  scanApprovalWorkflows: (goalId, input) => goalManager.scanApprovalWorkflows(goalId, input),
  listSuggestionReviews: (goalId) => goalManager.listSuggestionReviews(goalId),
  configureSuggestionReviewWorkflow: (goalId, input) => goalManager.configureSuggestionReviewWorkflow(goalId, input),
  decideSuggestionReview: (goalId, input) => goalManager.decideSuggestionReview(goalId, input),
  escalateSuggestionReview: (goalId, input) => goalManager.escalateSuggestionReview(goalId, input),
  scanSuggestionReviewWorkflows: (goalId, input) => goalManager.scanSuggestionReviewWorkflows(goalId, input),
  publishSuggestion: (goalId, input) => goalManager.publishSuggestion(goalId, input),
  listCheckpoints: (goalId) => goalManager.listCheckpoints(goalId),
  requestCheckpoint: (goalId, nodeId, input) => goalManager.requestCheckpoint(goalId, nodeId, input),
  approveCheckpoint: (goalId, nodeId, input) => goalManager.approveCheckpoint(goalId, nodeId, input),
  rejectCheckpoint: (goalId, nodeId, input) => goalManager.rejectCheckpoint(goalId, nodeId, input),
  expireCheckpoint: (goalId, nodeId, input) => goalManager.expireCheckpoint(goalId, nodeId, input),
  reopenCheckpoint: (goalId, nodeId, input) => goalManager.reopenCheckpoint(goalId, nodeId, input),
  escalateCheckpoint: (goalId, nodeId, input) => goalManager.escalateCheckpoint(goalId, nodeId, input),
  listCapabilityPlans: (goalId) => goalManager.listCapabilityPlans(goalId),
  getCapabilityPlan: (goalId, nodeId) => goalManager.getCapabilityPlan(goalId, nodeId),
  saveCapabilityPlan: (goalId, nodeId, input) => goalManager.saveCapabilityPlan(goalId, nodeId, input),
  generateCapabilityPlan: (goalId, nodeId, input) => generateCapabilityPlanForNode(goalId, nodeId, input),
  readTaskGraph: (goalId) => goalManager.readTaskGraph(goalId),
  createTaskNode: (goalId, input) => goalManager.createTaskNode(goalId, input),
  updateTaskNode: (goalId, nodeId, input) => goalManager.updateTaskNode(goalId, nodeId, input),
  claimTaskNode: (goalId, nodeId, input) => goalManager.claimTaskNode(goalId, nodeId, input),
  markTaskNodePendingReview: (goalId, nodeId, input) => goalManager.markTaskNodePendingReview(goalId, nodeId, input),
  markTaskNodeValidating: (goalId, nodeId, input) => goalManager.markTaskNodeValidating(goalId, nodeId, input),
  completeTaskNode: (goalId, nodeId, input) => goalManager.completeTaskNode(goalId, nodeId, input),
  blockTaskNode: (goalId, nodeId, input) => goalManager.blockTaskNode(goalId, nodeId, input),
  failTaskNode: (goalId, nodeId, input) => goalManager.failTaskNode(goalId, nodeId, input),
  skipTaskNode: (goalId, nodeId, input) => goalManager.skipTaskNode(goalId, nodeId, input),
});

if (webhookConfig.webhooks.length > 0) {
  logger.info("webhook", `Loaded ${webhookConfig.webhooks.length} webhook(s) from ${webhookConfigPath}`);
} else {
  logger.info("webhook", `No webhooks configured (create ${DEFAULT_STATE_DIR_DISPLAY}/webhooks.json to enable)`);
}

const inspectAgentPrompt = async ({ agentId, conversationId, runId }: {
  agentId?: string;
  conversationId?: string;
  runId?: string;
}) => {
    const resolvedConversationId = typeof conversationId === "string" && conversationId.trim()
      ? conversationId.trim()
      : undefined;
    const resolvedRunId = typeof runId === "string" && runId.trim()
      ? runId.trim()
      : undefined;
    const resolvedAgentId = typeof agentId === "string" && agentId.trim()
      ? agentId.trim()
      : undefined;

    if (resolvedConversationId || resolvedRunId) {
      let snapshot = promptSnapshotStore.get({
        conversationId: resolvedConversationId,
        runId: resolvedRunId,
        agentId: resolvedAgentId,
      });
      if (!snapshot && resolvedConversationId) {
        const persisted = await loadConversationPromptSnapshotArtifact({
          stateDir,
          conversationId: resolvedConversationId,
          runId: resolvedRunId,
        });
        if (persisted) {
          snapshot = {
            agentId: persisted.manifest.agentId,
            conversationId: persisted.manifest.conversationId,
            runId: persisted.manifest.runId,
            createdAt: persisted.manifest.createdAt,
            systemPrompt: persisted.snapshot.systemPrompt,
            messages: persisted.snapshot.messages,
            deltas: persisted.snapshot.deltas,
            providerNativeSystemBlocks: persisted.snapshot.providerNativeSystemBlocks,
            inputMeta: persisted.snapshot.inputMeta,
            hookSystemPromptUsed: persisted.snapshot.hookSystemPromptUsed,
            prependContext: persisted.snapshot.prependContext,
          };
        }
      }
      if (!snapshot) {
        throw new Error(
          `Prompt snapshot not found for conversationId="${resolvedConversationId ?? ""}" runId="${resolvedRunId ?? ""}"`,
        );
      }
      const snapshotProfile = agentRegistry?.getProfile(snapshot.agentId ?? resolvedAgentId ?? "default");
      return gatewayPromptInspectionRuntime.buildRunPromptInspection(snapshot, snapshotProfile);
    }

    const fallbackAgentId = resolvedAgentId ?? "default";
    const profile = agentRegistry?.getProfile(fallbackAgentId);
    if (!profile) {
      throw new Error(`AgentProfile not found: "${fallbackAgentId}"`);
    }
    return gatewayPromptInspectionRuntime.buildEffectiveAgentPromptInspection(profile);
  };
const getConversationPromptSnapshot = async ({ conversationId, runId }: {
  conversationId: string;
  runId?: string;
}) => loadConversationPromptSnapshotArtifact({
  stateDir,
  conversationId,
  runId,
});
const stopSubTask = createBridgeAwareStopSubTaskHandler({
  subTaskRuntimeStore,
  subAgentOrchestrator,
  toolExecutor: toolsEnabled ? toolExecutor : undefined,
  logger: {
    warn: (m, d) => logger.warn("task-runtime", m, d),
  },
});
const ttsSynthesize = async (text: string) => {
  const result = await synthesizeSpeech({ text, stateDir });
  if (result) {
    logger.info("tts-auto", `Audio generated: ${result.webPath}`);
  }
  return result;
};
const sttTranscribe = async (opts: Parameters<typeof transcribeSpeech>[0]) => {
  const result = await transcribeSpeech(opts);
  if (result) {
    logger.info("stt", `Transcribed audio (${result.durationSec?.toFixed(1) ?? "?"}s) via ${result.provider}: "${result.text.slice(0, 50)}${result.text.length > 50 ? "..." : ""}"`);
  }
  return result;
};
const cachedSttTranscribe = createCachedChannelSttTranscribe({
  stateDir,
  logger,
  transcribe: transcribeSpeech,
});
const channelRuntime = createGatewayChannelsRuntime({
  stateDir,
  logger,
  channelRouterEnabled,
  channelRouterConfigPath,
  channelRouterDefaultAgentId,
  channelSecurityConfigPath,
  channelReplyChunkingConfigPath,
  agentRegistry,
  createAgent,
  conversationStore,
  topLevelConversationLifecycle,
  currentConversationBindingStore,
  externalOutboundSenderRegistry,
  toolsEnabled,
  toolExecutor,
  serverBroadcast: (message) => serverBroadcast?.(message),
  sttTranscribe: cachedSttTranscribe,
  feishuAppId,
  feishuAppSecret,
  feishuAgentId,
  qqAppId,
  qqAppSecret,
  qqAgentId,
  qqSandbox,
  discordEnabled,
  discordBotToken,
  readEnv,
});
const {
  deliverToLatestBoundExternalChannel,
  recordChannelSecurityApprovalRequest,
  getRuntimeResourceQueueSnapshots: getChannelIngressRuntimeResourceQueueSnapshots,
} = channelRuntime;

const startupConnectivityObservability: {
  gatewayReadyAtMs?: number;
  firstStaticWebRequestAtMs?: number;
  firstStaticWebRequestPath?: string | null;
  firstStaticWebRequestMethod?: string | null;
  firstStaticWebRequestUserAgent?: string | null;
  firstStaticWebRequestReferer?: string | null;
  firstBootstrapAssetRequestAtMs?: number;
  firstBootstrapAssetRequestPath?: string | null;
  firstBootstrapAssetRequestMethod?: string | null;
  firstBootstrapAssetRequestUserAgent?: string | null;
  firstBootstrapAssetRequestReferer?: string | null;
  firstWebSocketConnectionAtMs?: number;
  firstWebSocketConnectionRemoteAddress?: string | null;
  firstAuthenticatedWebSocketAtMs?: number;
  firstAuthenticatedWebSocketClientId?: string;
  invalidTokenCloseCount: number;
  firstInvalidTokenCloseAtMs?: number;
  firstInvalidTokenCloseReason?: string | null;
} = {
  invalidTokenCloseCount: 0,
};

const serverOptions = buildGatewayServerOptions({
  port,
  host,
  auth: { mode: authMode, token: authToken, password: authPassword },
  webRoot,
  envDir: runtimePaths.envDir,
  envSource: runtimePaths.envSource,
  stateDir,
  additionalWorkspaceRoots: extraWorkspaceRoots,
  agentFactory: createAgent,
  agentRegistry,
  primaryModelConfig,
  modelFallbacks,
  preferredProviderIds,
  modelConfigPath: modelConfigFile,
  residentMemoryManagers: scopedMemoryManagers.records,
  memoryUsageAccounting: memoryBackgroundRuntime.usageAccounting,
  memoryBudgetGuard: memoryBackgroundRuntime.budgetGuard,
  memoryBackgroundJobScheduler: memoryBackgroundRuntime.jobScheduler,
  memoryModelPrivacyRuntime: memoryBackgroundRuntime.modelPrivacyRuntime,
  conversationStore,
  conversationRunRegistry,
  topLevelConversationLifecycle,
  getCompactionRuntimeReport: () => compactionRuntimeTracker.getReport(),
  getRuntimeResilienceReport: () => runtimeResilienceTracker.getReport(),
  logger,
  toolsConfigManager,
  toolExecutor: toolsEnabled ? toolExecutor : undefined,
  pendingToolPermissionRuntime,
  toolControlConfirmationStore,
  externalOutboundConfirmationStore,
  externalOutboundSenderRegistry,
  externalOutboundAuditStore,
  emailOutboundConfirmationStore,
  emailOutboundProviderRegistry,
  emailOutboundAuditStore,
  emailInboundAuditStore,
  emailFollowUpReminderStore,
  getAgentToolControlMode: () => agentToolControlMode,
  getAgentToolControlConfirmPassword: () => agentToolControlConfirmPassword,
  pluginRegistry,
  skillRegistry,
  onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
  getCronRuntimeDoctorReport: async () => buildCronRuntimeDoctorReport({
    enabled: cronEnabled,
    store: cronStore,
    scheduler: cronSchedulerHandle,
  }),
  runCronJobNow: async (jobId) => {
    if (!cronSchedulerHandle) {
      return {
        status: "skipped" as const,
        reason: "Cron scheduler is not running.",
      };
    }
    return cronSchedulerHandle.runJobNow(jobId);
  },
  runCronRecovery: async (jobId) => {
    const candidate = (await backgroundContinuationLedger.listRecent(40)).find((item) => {
      return item.kind === "cron"
        && item.sourceId === jobId
        && item.status === "failed"
        && item.latestRecoveryOutcome !== "succeeded";
    });
    if (!candidate) {
      return {
        outcome: "skipped_not_eligible" as const,
        reason: `No recoverable failed cron run was found for ${jobId}.`,
      };
    }
    if (!backgroundRecoveryRuntime) {
      return {
        outcome: "skipped_not_eligible" as const,
        sourceRunId: candidate.runId,
        reason: "Background recovery runtime is not available.",
      };
    }
    const result = await backgroundRecoveryRuntime.maybeRecover(candidate);
    return {
      outcome: result.outcome,
      sourceRunId: candidate.runId,
      ...(result.recoveryRunId ? { recoveryRunId: result.recoveryRunId } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
    };
  },
  getBackgroundContinuationRuntimeDoctorReport: async () => buildBackgroundContinuationRuntimeDoctorReport({
    ledger: backgroundContinuationLedger,
  }),
  getRuntimeResourceQueueSnapshots: () => {
    const snapshots: Array<{
      id: string;
      activeCount: number;
      queuedCount: number;
      capacity?: number;
      oldestWaitMs?: number;
      rejectedCount?: number;
      aggregate?: boolean;
    }> = [];
    if (subAgentOrchestrator) {
      const snapshot = subAgentOrchestrator.getRuntimeSnapshot();
      snapshots.push({
        id: "subagent",
        activeCount: snapshot.activeCount,
        queuedCount: snapshot.queuedCount,
        capacity: snapshot.maxQueueSize,
      });
    }
    const workflowSnapshot = workflowRuntime?.getRuntimeSnapshot?.();
    if (workflowSnapshot) {
      snapshots.push({
        id: "workflow_runs",
        activeCount: workflowSnapshot.activeRunCount,
        queuedCount: 0,
      }, {
        id: "workflow_agents",
        activeCount: workflowSnapshot.activeAgentCount,
        queuedCount: workflowSnapshot.queuedAgentCount,
        capacity: workflowSnapshot.maxQueuedAgentCount,
      });
    }
    const cronSnapshot = cronSchedulerHandle?.status();
    if (cronSnapshot) {
      snapshots.push({
        id: "cron",
        activeCount: cronSnapshot.activeRuns,
        queuedCount: 0,
      });
    }
    const backgroundRunSnapshot = backgroundRunCoordinator.getRuntimeSnapshot();
    snapshots.push({
      id: "background_runs",
      activeCount: backgroundRunSnapshot.activeCount,
      queuedCount: backgroundRunSnapshot.queuedCount,
      capacity: backgroundRunSnapshot.capacity,
      aggregate: true,
    }, {
      id: "foreground_runs",
      activeCount: backgroundRunSnapshot.foregroundActiveCount,
      queuedCount: 0,
    });
    snapshots.push(...getChannelIngressRuntimeResourceQueueSnapshots());
    return snapshots;
  },
  inspectAgentPrompt,
  getConversationPromptSnapshot,
  extensionHost,
  goalManager,
  subTaskRuntimeStore,
  resumeSubTask,
  takeoverSubTask,
  updateSubTask,
  stopSubTask,
  workflowRuntime,
  workspaceRevisionRuntime,
  workspaceChangeReviewRuntime,
  userWorktreeRuntime,
  remoteDeliveryRuntime,
  commanderMode,
  preflightCompressionPolicy,
  ttsEnabled: isTtsEnabledFn,
  ttsSynthesize,
  sttTranscribe,
  isConfigured: () => agentProvider === "mock" || (agentProvider === "openai" && !!openaiApiKey && !!openaiModel),
  webhookConfig,
  webhookIdempotency,
  requestSystemRestart: (reason) => requestGatewaySystemRestart(reason),
});
serverOptions.startupObservability = {
  onFirstStaticWebRequest: ({ timestampMs, method, path, userAgent, referer }) => {
    if (startupConnectivityObservability.firstStaticWebRequestAtMs) return;
    startupConnectivityObservability.firstStaticWebRequestAtMs = timestampMs;
    startupConnectivityObservability.firstStaticWebRequestMethod = method;
    startupConnectivityObservability.firstStaticWebRequestPath = path;
    startupConnectivityObservability.firstStaticWebRequestUserAgent = userAgent ?? null;
    startupConnectivityObservability.firstStaticWebRequestReferer = referer ?? null;
    const readyAtMs = startupConnectivityObservability.gatewayReadyAtMs ?? timestampMs;
    logger.info(
      "launcher",
      `Startup observability: first static web request after ${timestampMs - readyAtMs}ms`
        + ` (method=${method}, path=${path})`
        + (userAgent ? ` (ua=${userAgent})` : "")
        + (referer ? ` (referer=${referer})` : ""),
    );
  },
  onFirstBootstrapAssetRequest: ({ timestampMs, method, path, userAgent, referer }) => {
    if (startupConnectivityObservability.firstBootstrapAssetRequestAtMs) return;
    startupConnectivityObservability.firstBootstrapAssetRequestAtMs = timestampMs;
    startupConnectivityObservability.firstBootstrapAssetRequestMethod = method;
    startupConnectivityObservability.firstBootstrapAssetRequestPath = path;
    startupConnectivityObservability.firstBootstrapAssetRequestUserAgent = userAgent ?? null;
    startupConnectivityObservability.firstBootstrapAssetRequestReferer = referer ?? null;
    const readyAtMs = startupConnectivityObservability.gatewayReadyAtMs ?? timestampMs;
    logger.info(
      "launcher",
      `Startup observability: first bootstrap asset request after ${timestampMs - readyAtMs}ms`
        + ` (method=${method}, path=${path})`
        + (userAgent ? ` (ua=${userAgent})` : "")
        + (referer ? ` (referer=${referer})` : ""),
    );
  },
  onFirstWebSocketConnection: ({ timestampMs, remoteAddress }) => {
    if (startupConnectivityObservability.firstWebSocketConnectionAtMs) return;
    startupConnectivityObservability.firstWebSocketConnectionAtMs = timestampMs;
    startupConnectivityObservability.firstWebSocketConnectionRemoteAddress = remoteAddress ?? null;
    const readyAtMs = startupConnectivityObservability.gatewayReadyAtMs ?? timestampMs;
    logger.info(
      "launcher",
      `Startup observability: first websocket connection after ${timestampMs - readyAtMs}ms`
        + (remoteAddress ? ` (remote=${remoteAddress})` : ""),
    );
  },
  onFirstAuthenticatedWebSocket: ({ timestampMs, clientId }) => {
    if (startupConnectivityObservability.firstAuthenticatedWebSocketAtMs) return;
    startupConnectivityObservability.firstAuthenticatedWebSocketAtMs = timestampMs;
    startupConnectivityObservability.firstAuthenticatedWebSocketClientId = clientId;
    const readyAtMs = startupConnectivityObservability.gatewayReadyAtMs ?? timestampMs;
    logger.info(
      "launcher",
      `Startup observability: first authenticated websocket after ${timestampMs - readyAtMs}ms (clientId=${clientId})`,
    );
  },
  onInvalidTokenClose: ({ timestampMs, reason }) => {
    startupConnectivityObservability.invalidTokenCloseCount += 1;
    if (!startupConnectivityObservability.firstInvalidTokenCloseAtMs) {
      startupConnectivityObservability.firstInvalidTokenCloseAtMs = timestampMs;
      startupConnectivityObservability.firstInvalidTokenCloseReason = reason ?? null;
      const readyAtMs = startupConnectivityObservability.gatewayReadyAtMs ?? timestampMs;
      logger.warn(
        "launcher",
        `Startup observability: invalid-token websocket close after ${timestampMs - readyAtMs}ms`
          + (reason ? ` (reason=${reason})` : ""),
      );
    }
  },
};
const server = await startGatewayServer(serverOptions);
const shutdownRequestOwner = createGatewayShutdownRequestOwner({
  requestShutdown: (request) => server.requestShutdown(request),
  broadcast: (frame) => server.broadcast(frame),
});
requestGatewaySystemRestart = (reason, options) => {
  void shutdownRequestOwner.requestSystemRestart(reason, options).catch((error) => {
    logger.error("shutdown", "Gateway system restart failed", error);
  });
};
requestMemoryEvolutionExtraction = server.requestDurableExtractionFromDigest;
const dreamAutomationRuntime = new DreamAutomationRuntime({
  heartbeatEnabled: dreamAutoHeartbeatEnabled,
  cronEnabled: dreamAutoCronEnabled,
  agentIds: scopedMemoryManagers.records.map((item) => item.agentId),
  resolveDreamRuntime: server.resolveDreamRuntime,
  resolveDefaultConversationId: server.resolveDreamDefaultConversationId,
  runCoordinator: backgroundRunCoordinator,
  jobScheduler: memoryBackgroundRuntime.jobScheduler,
  isBusy,
  logger: {
    debug: (message, data) => logger.debug("dream-automation", message, data),
    warn: (message, data) => logger.warn("dream-automation", message, data),
    error: (message, data) => logger.error("dream-automation", message, data),
  },
});

goalManager.setEventSink((payload) => {
  server.broadcast({
    type: "event",
    event: "goal.update",
    payload,
  });
  void (async () => {
    try {
      const runtimeEvent = await buildGoalSessionRuntimeEventMessage({
        event: payload,
        readTaskGraph: (goalId) => goalManager.readTaskGraph(goalId),
      });
      if (!runtimeEvent) {
        return;
      }
      const message = conversationStore.addMessage(
        runtimeEvent.conversationId,
        "assistant",
        runtimeEvent.text,
        {
          agentId: "default",
          channel: "webchat",
        },
      );
      await conversationStore.waitForPendingPersistence(runtimeEvent.conversationId);
      server.broadcast({
        type: "event",
        event: "chat.final",
        payload: {
          agentId: "default",
          conversationId: runtimeEvent.conversationId,
          role: "assistant",
          text: runtimeEvent.text,
          messageMeta: {
            timestampMs: message.timestamp,
            isLatest: true,
          },
        },
      });
    } catch (error) {
      logger.warn("goals", `Failed to persist goal runtime event: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
});

// 绑定 broadcast 给 service_restart 工具使用
serverBroadcast = (msg) => server.broadcast(msg as any);

logger.info("gateway", `Belldandy Gateway running: http://${server.host}:${server.port}`);
logger.info("gateway", `Belldandy Version: v${BELLDANDY_VERSION}`);
logger.info("gateway", `WebChat: http://${server.host}:${server.port}/`);
logger.info("gateway", `WS: ws://${server.host}:${server.port}`);
startupConnectivityObservability.gatewayReadyAtMs = Date.now();
void checkForUpdates({
  currentVersion: BELLDANDY_VERSION,
  logger,
  enabled: updateCheckEnabled,
  timeoutMs: updateCheckTimeoutMs,
  releasesApiUrl: updateCheckApiUrl,
});

if (server.host === "0.0.0.0" || server.host === "::") {
  // Print LAN IPs for easier access from other machines
  const nets = os.networkInterfaces();
  logger.info("gateway", "Network Interfaces (Public Access):");
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        logger.info("gateway", `  -> http://${net.address}:${server.port}/`);
      }
    }
  }
} else {
  logger.info("gateway", `Access restricted to local machine (${server.host}).`);
  logger.info("gateway", "To allow remote access, set BELLDANDY_HOST=0.0.0.0 in .env");
}
logger.info("gateway", `State Dir: ${stateDir}`);
logger.info("gateway", `Memory DBs: unique=${new Set(scopedMemoryManagers.records.map((item) => path.join(item.stateDir, "memory.sqlite"))).size}, bindings=${scopedMemoryManagers.records.length}`);
logger.info("gateway", `Tools Enabled: ${toolsEnabled}`);

// 8.5 Auto Open Browser (Magic Link)
if (autoOpenBrowser) {
  const targetUrl = buildAutoOpenTargetUrl({
    host: server.host,
    port: server.port,
    authMode,
    setupToken,
  });

  logger.info("launcher", `Opening browser at ${targetUrl}...`);
  const autoOpenStartedAtMs = Date.now();
  // Dynamic import to avoid issues if 'open' is optional or ESM
  try {
    const { default: open } = await import("open");
    await open(targetUrl);
    logger.info("launcher", `Startup observability: browser open returned after ${Date.now() - autoOpenStartedAtMs}ms`);
  } catch (err) {
    logger.error("launcher", "Failed to auto-open browser", err);
    logger.info("launcher", `Please open manually: ${targetUrl}`);
    logger.warn("launcher", `Startup observability: browser open failed after ${Date.now() - autoOpenStartedAtMs}ms`);
  }
}

channelRuntime.logChannelRuntimeConfiguration();
await channelRuntime.startChannels();

heartbeatRunner = await startHeartbeatRuntime({
  enabled: heartbeatEnabled,
  createAgent,
  heartbeatIntervalRaw,
  heartbeatActiveHoursRaw,
  stateDir,
  conversationStore,
  broadcast: (frame) => server.broadcast(frame as any),
  deliverToLatestBoundExternalChannel,
  backgroundContinuationLedger,
  backgroundRecoveryRuntime,
  runCoordinator: backgroundRunCoordinator,
  isBusy,
  onFinalizedRun: (event) => {
    void dreamAutomationRuntime.handleHeartbeatEvent(event).catch((error) => {
      logger.error("dream-automation", "Heartbeat-triggered dream automation failed", error);
    });
  },
  logger,
});

cronSchedulerHandle = await startCronRuntime({
  enabled: cronEnabled,
  createAgent,
  heartbeatActiveHoursRaw,
  cronStore,
  conversationStore,
  broadcast: (frame) => server.broadcast(frame as any),
  deliverToLatestBoundExternalChannel,
  backgroundContinuationLedger,
  backgroundRecoveryRuntime,
  goalManager,
  runCoordinator: backgroundRunCoordinator,
  isBusy,
  onFinalizedRun: (event) => {
    void dreamAutomationRuntime.handleCronEvent(event).catch((error) => {
      logger.error("dream-automation", "Cron-triggered dream automation failed", error);
    });
  },
  logger,
});

emailInboundRuntimeHandle = await startImapPollingEmailInboundRuntime({
  enabled: emailImapEnabled,
  host: emailImapHost,
  port: emailImapPort,
  secure: emailImapSecure,
  username: emailImapUser,
  password: emailImapPass,
  accountId: emailImapAccountId,
  mailbox: emailImapMailbox,
  pollIntervalMs: emailImapPollIntervalMs,
  requestedAgentId: emailInboundAgentId,
  connectTimeoutMs: emailImapConnectTimeoutMs,
  socketTimeoutMs: emailImapSocketTimeoutMs,
  bootstrapMode: emailImapBootstrapMode,
  recentWindowLimit: emailImapRecentWindowLimit,
  agentFactory: createAgent,
  agentRegistry,
  conversationStore,
  topLevelConversationLifecycle,
  threadBindingStore: emailThreadBindingStore,
  checkpointStore: emailInboundCheckpointStore,
  auditStore: emailInboundAuditStore,
  reminderStore: emailFollowUpReminderStore,
  broadcastEvent: (frame) => server.broadcast(frame),
  logger,
});

starweaverActiveNotifyRuntimeHandle = await startStarweaverActiveNotifyRuntime({
  toolExecutor,
  isBusy: () => server.isResidentAgentBusy("default"),
  autoRunResidentAgent: (input) => server.autoRunResidentAgent(input),
  logger,
});

const browserRelayEnabled = readEnv("BELLDANDY_BROWSER_RELAY_ENABLED") === "true";
const browserRelayPort = Number(readEnv("BELLDANDY_RELAY_PORT") ?? "28892");
browserRelayRuntimeHandle = await startBrowserRelayRuntime({
  enabled: browserRelayEnabled,
  port: browserRelayPort,
  stateDir,
  configuredToken: readEnv("BELLDANDY_RELAY_TOKEN"),
  logger,
});

const configWatcher = startGatewayConfigWatcher({
  envDir: envFiles.envDir,
  envPath: envFiles.envPath,
  envLocalPath: envFiles.envLocalPath,
  logger,
  onRestartRequired: (fileName) => {
    logger.info("config-watcher", `检测到 ${fileName} 变更，正在重启服务...`);
    void shutdownRequestOwner.requestConfigRestart(fileName).catch((error) => {
      logger.error("shutdown", "Gateway config restart failed", error);
    });
  },
});

server.registerShutdownResources({
  shutdownRequests: shutdownRequestOwner,
  configWatcher,
  cron: cronSchedulerHandle,
  heartbeat: heartbeatRunner,
  memoryIdleSummary: memoryIdleSummaryRuntime,
  dreamAutomation: dreamAutomationRuntime,
  backgroundRuns: backgroundRunCoordinator,
  emailInbound: emailInboundRuntimeHandle,
  activeNotify: starweaverActiveNotifyRuntimeHandle,
  channels: channelRuntime,
  shutdownMcp: shutdownMCPIntegration,
  browserRelay: browserRelayRuntimeHandle,
  shutdownAgentBridge: agentBridgeEnabled ? shutdownBridgeSessions : undefined,
  shutdownCommandJobs,
  extensionRuntime: extensionHost.extensionRuntimeSupervisor,
});
shutdownRequestOwner.installSignalHandlers();
