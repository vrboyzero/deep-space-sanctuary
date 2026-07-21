import type { SubAgentOrchestrator } from "@belldandy/agent";

import type { GatewayServerOptions } from "../server.js";

type GatewayServerRuntimeInput = Omit<
  GatewayServerOptions,
  | "inspectAgentPrompt"
  | "getConversationPromptSnapshot"
  | "stopSubTask"
  | "ttsEnabled"
  | "ttsSynthesize"
  | "sttTranscribe"
  | "isConfigured"
> & {
  inspectAgentPrompt: NonNullable<GatewayServerOptions["inspectAgentPrompt"]>;
  getConversationPromptSnapshot: NonNullable<GatewayServerOptions["getConversationPromptSnapshot"]>;
  stopSubTask: NonNullable<GatewayServerOptions["stopSubTask"]>;
  ttsEnabled: NonNullable<GatewayServerOptions["ttsEnabled"]>;
  ttsSynthesize: NonNullable<GatewayServerOptions["ttsSynthesize"]>;
  sttTranscribe: NonNullable<GatewayServerOptions["sttTranscribe"]>;
  isConfigured: NonNullable<GatewayServerOptions["isConfigured"]>;
};

type GatewayStopSubTaskHandlerInput = {
  subTaskRuntimeStore: GatewayServerOptions["subTaskRuntimeStore"];
  subAgentOrchestrator?: Pick<SubAgentOrchestrator, "stopSession">;
};

export function createGatewayStopSubTaskHandler(
  input: GatewayStopSubTaskHandlerInput,
): NonNullable<GatewayServerOptions["stopSubTask"]> {
  return async (taskId, reason, options) => {
    const runtimeStore = input.subTaskRuntimeStore;
    if (!runtimeStore) return undefined;

    const current = await runtimeStore.getTask(taskId);
    if (!current) return undefined;

    const normalizedReason = typeof reason === "string" && reason.trim()
      ? reason.trim()
      : "Task stopped by user.";
    const accepted = await runtimeStore.requestStop(taskId, normalizedReason, {
      sessionId: current.sessionId,
      expectedRevision: options?.expectedRevision,
      idempotencyKey: options?.idempotencyKey,
    });
    if (!accepted) return undefined;
    if (!accepted.claimOwner) {
      return accepted.item;
    }

    if (current.status === "pending" && !current.sessionId) {
      return runtimeStore.markStopped(taskId, {
        reason: normalizedReason,
        commandClaim: accepted.commandClaim,
      });
    }

    if (current.sessionId && input.subAgentOrchestrator) {
      const stopped = await input.subAgentOrchestrator.stopSession(current.sessionId, normalizedReason);
      if (stopped) {
        return runtimeStore.markStopped(taskId, {
          reason: normalizedReason,
          sessionId: current.sessionId,
          commandClaim: accepted.commandClaim,
        });
      }
      await runtimeStore.markStopFailed(
        taskId,
        accepted.commandClaim.commandId,
        `Failed to stop subtask session ${current.sessionId}.`,
      );
      throw new Error(`Failed to stop subtask session ${current.sessionId}.`);
    }
    return accepted.item;
  };
}

export function buildGatewayServerOptions(input: GatewayServerRuntimeInput): GatewayServerOptions {
  return {
    port: input.port,
    host: input.host,
    auth: input.auth,
    webRoot: input.webRoot,
    envDir: input.envDir,
    envSource: input.envSource,
    stateDir: input.stateDir,
    additionalWorkspaceRoots: input.additionalWorkspaceRoots,
    agentFactory: input.agentFactory,
    agentRegistry: input.agentRegistry,
    primaryModelConfig: input.primaryModelConfig,
    modelFallbacks: input.modelFallbacks,
    preferredProviderIds: input.preferredProviderIds,
    modelConfigPath: input.modelConfigPath,
    residentMemoryManagers: input.residentMemoryManagers,
    memoryUsageAccounting: input.memoryUsageAccounting,
    memoryBudgetGuard: input.memoryBudgetGuard,
    memoryBackgroundJobScheduler: input.memoryBackgroundJobScheduler,
    memoryModelPrivacyRuntime: input.memoryModelPrivacyRuntime,
    conversationStore: input.conversationStore,
    conversationRunRegistry: input.conversationRunRegistry,
    getCompactionRuntimeReport: input.getCompactionRuntimeReport,
    getRuntimeResilienceReport: input.getRuntimeResilienceReport,
    onActivity: input.onActivity,
    logger: input.logger,
    toolsConfigManager: input.toolsConfigManager,
    toolExecutor: input.toolExecutor,
    toolControlConfirmationStore: input.toolControlConfirmationStore,
    externalOutboundConfirmationStore: input.externalOutboundConfirmationStore,
    externalOutboundSenderRegistry: input.externalOutboundSenderRegistry,
    externalOutboundAuditStore: input.externalOutboundAuditStore,
    emailOutboundConfirmationStore: input.emailOutboundConfirmationStore,
    emailOutboundProviderRegistry: input.emailOutboundProviderRegistry,
    emailOutboundAuditStore: input.emailOutboundAuditStore,
    emailInboundAuditStore: input.emailInboundAuditStore,
    emailFollowUpReminderStore: input.emailFollowUpReminderStore,
    getAgentToolControlMode: input.getAgentToolControlMode,
    getAgentToolControlConfirmPassword: input.getAgentToolControlConfirmPassword,
    pluginRegistry: input.pluginRegistry,
    skillRegistry: input.skillRegistry,
    onChannelSecurityApprovalRequired: input.onChannelSecurityApprovalRequired,
    getCronRuntimeDoctorReport: input.getCronRuntimeDoctorReport,
    getBackgroundContinuationRuntimeDoctorReport: input.getBackgroundContinuationRuntimeDoctorReport,
    getRuntimeResourceQueueSnapshots: input.getRuntimeResourceQueueSnapshots,
    runCronJobNow: input.runCronJobNow,
    runCronRecovery: input.runCronRecovery,
    inspectAgentPrompt: input.inspectAgentPrompt,
    getConversationPromptSnapshot: input.getConversationPromptSnapshot,
    extensionHost: input.extensionHost,
    goalManager: input.goalManager,
    subTaskRuntimeStore: input.subTaskRuntimeStore,
    resumeSubTask: input.resumeSubTask,
    takeoverSubTask: input.takeoverSubTask,
    updateSubTask: input.updateSubTask,
    stopSubTask: input.stopSubTask,
    workflowRuntime: input.workflowRuntime,
    commanderMode: input.commanderMode,
    ttsEnabled: input.ttsEnabled,
    ttsSynthesize: input.ttsSynthesize,
    sttTranscribe: input.sttTranscribe,
    isConfigured: input.isConfigured,
    webhookConfig: input.webhookConfig,
    webhookIdempotency: input.webhookIdempotency,
    requestSystemRestart: input.requestSystemRestart,
  };
}
