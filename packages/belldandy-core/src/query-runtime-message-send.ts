import crypto from "node:crypto";

import type { WebSocket } from "ws";
import type { CodingRunGatewayEventBroker } from "./coding-run/gateway-event-broker.js";
import type {
  ConversationFollowUpClaim,
  ConversationRunBinding,
} from "./coding-run/conversation-follow-up-queue.js";
import { ConversationSteerMailbox } from "./coding-run/conversation-steer-mailbox.js";
import {
  resolveModelConfig,
  type AgentPromptDelta,
  type AgentRegistry,
  type BelldandyAgent,
  type CompressionResult,
  type ConversationStore,
  type ModelProfile,
} from "@belldandy/agent";
import type { DurableExtractionDigestSnapshot, DurableExtractionRecord, DurableExtractionRuntime } from "@belldandy/memory";
import {
  uploadTokenUsage,
  type ChatMessageMeta,
  type CodingRunModelRouteEvidence,
  type ConversationRunStopParams,
  type GatewayEventFrame,
  type GatewayResFrame,
  type MessageSendParams,
  type TokenUsageUploadConfig,
} from "@belldandy/protocol";
import type { MemoryRuntimeBudgetGuard, MemoryRuntimeUsageAccounting } from "./memory-runtime-budget.js";
import { preparePromptWithAttachments, type AttachmentPromptLimits } from "./attachment-understanding-runner.js";
import { detectChatCommanderTrigger, buildChatCommanderHintText } from "./chat-commander-trigger.js";
import { ConversationRunRegistry } from "./conversation-run-registry.js";
import type { PendingToolPermissionRuntime } from "./coding-run/pending-tool-permission-runtime.js";
import { runAgentWithLifecycle, type QueryRuntimeAgentBudgetExhausted } from "./query-runtime-agent-run.js";
import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";
import type {
  TopLevelConversationLease,
  TopLevelConversationLifecycle,
} from "./top-level-conversation-lifecycle.js";
import {
  appendAutoTaskReport,
  consumeAutoTaskReport,
  resolveAutoTaskReportForOutput,
  sanitizeVisibleAssistantText,
} from "./task-auto-report.js";
import type { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import type { ToolContractChannel, TranscribeOptions, TranscribeResult } from "@belldandy/skills";
import type { MediaCapability } from "./media-capability-registry.js";
import type { ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";
import type { ConversationPromptSnapshotArtifact } from "./conversation-prompt-snapshot.js";
import { resolveDeepSeekTierRoute } from "./deepseek-tier-routing.js";
import type { PreflightCompressionPolicy } from "./preflight-compression-config.js";
import { resolveProjectRules } from "./project-rules.js";
import { buildCodingRunPromptOverride } from "./coding-run-prompt.js";
import {
  isBareCodingRun,
  projectCodingRunAutomationContext,
} from "./coding-run-automation-profile.js";
import { projectToolResultEventOutput } from "./tool-result-event-output.js";
import { compileOutputSchema } from "./coding-run/output-schema.js";
import {
  createConversationTaskCapabilityClosureBinding,
  evaluateTaskCapabilityClosureForStart,
  type TaskCapabilityClosureResolver,
} from "./coding-run/task-capability-closure.js";

type QueryRuntimeLogger = {
  debug: (module: string, message: string, data?: unknown) => void;
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

type ToolControlPasswordApproval = {
  sanitizedText: string;
};

export type MessageSendQueryRuntimeContext = {
  request: {
    ws: WebSocket;
    requestId: string;
    params: MessageSendParams;
    clientId: string;
    requestChannel?: ToolContractChannel;
    userUuid?: string;
    stateDir: string;
    /** 仅供 Conversation owner 的内部串行交接使用，不来自 Gateway 请求。 */
    followUpClaim?: ConversationFollowUpClaim;
  };
  runtime: {
    log: QueryRuntimeLogger;
    agentFactory: () => BelldandyAgent;
    agentRegistry?: AgentRegistry;
    conversationStore: ConversationStore;
    conversationRunRegistry: ConversationRunRegistry;
    codingRunEventBroker?: CodingRunGatewayEventBroker;
    taskCapabilityClosureResolver?: TaskCapabilityClosureResolver;
    pendingToolPermissionRuntime?: PendingToolPermissionRuntime;
    topLevelConversationLifecycle?: TopLevelConversationLifecycle;
    runtimeObserver?: QueryRuntimeObserver<"message.send">;
    residentAgentRuntime?: ResidentAgentRuntimeRegistry;
    getConversationPromptSnapshot?: (input: {
      conversationId: string;
      runId?: string;
    }) => Promise<ConversationPromptSnapshotArtifact | undefined>;
    primaryModelConfig?: Parameters<typeof resolveModelConfig>[1];
    modelFallbacks?: ModelProfile[];
    deepSeekRoutePolicyEnabled?: boolean;
    /** Commander 模式（"on" | "off" | "auto"），用于 chat commander 显式触发判定 */
    commanderMode?: "on" | "off" | "auto";
    preflightCompressionPolicy?: PreflightCompressionPolicy;
  };
  toolControl: {
    confirmationStore?: ToolControlConfirmationStore;
    getMode?: () => "disabled" | "confirm" | "auto";
    getConfirmPassword?: () => string | undefined;
    tryApprovePasswordInput: (input: {
      confirmationStore?: ToolControlConfirmationStore;
      getMode?: () => "disabled" | "confirm" | "auto";
      getConfirmPassword?: () => string | undefined;
      conversationId: string;
      userText: string;
    }) => ToolControlPasswordApproval;
  };
  media: {
    sttTranscribe?: (opts: TranscribeOptions) => Promise<TranscribeResult | null>;
    ttsEnabled?: () => boolean;
    ttsSynthesize?: (text: string) => Promise<{ webPath: string; htmlAudio: string } | null>;
    resolveCurrentModelMediaCapabilities?: (input: {
      requestedAgentId?: string;
      requestedModelId?: string;
    }) => MediaCapability[];
    getAttachmentPromptLimits: () => AttachmentPromptLimits;
    truncateTextForPrompt: (text: string, limit: number, suffix: string) => { text: string; truncated: boolean };
    formatLocalMessageTime: (timestampMs: number) => string;
  };
  io: {
    broadcastEvent?: (frame: GatewayEventFrame) => void;
    sendEvent: (ws: WebSocket, frame: GatewayEventFrame) => void;
    toChatMessageMeta: (timestampMs: number, isLatest?: boolean) => ChatMessageMeta;
    toolResultEventOutputCharLimit: number;
  };
  effects: {
    tokenUsageUploadConfig: TokenUsageUploadConfig;
    durableExtractionRuntime?: DurableExtractionRuntime;
    requestDurableExtraction?: (input: {
      conversationId: string;
      source: string;
      digest: DurableExtractionDigestSnapshot;
    }) => Promise<DurableExtractionRecord | undefined>;
    memoryUsageAccounting: MemoryRuntimeUsageAccounting;
    memoryBudgetGuard: MemoryRuntimeBudgetGuard;
    emitAutoRunTaskTokenResult: (
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
    ) => void;
    refreshConversationDigestAndBroadcast: (
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
    ) => Promise<unknown>;
  };
};

export type ConversationRunStopQueryRuntimeContext = {
  request: {
    requestId: string;
    params: ConversationRunStopParams;
  };
  runtime: {
    conversationRunRegistry: ConversationRunRegistry;
    runtimeObserver?: QueryRuntimeObserver<"conversation.run.stop">;
  };
};

export async function handleMessageSendWithQueryRuntime(
  ctx: MessageSendQueryRuntimeContext,
): Promise<GatewayResFrame> {
  const { request, runtime: runtimeDeps, toolControl, media, io } = ctx;
  const runtime = new QueryRuntime({
    method: "message.send" as const,
    traceId: request.requestId,
    observer: runtimeDeps.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    const requestedAgentId = request.params.agentId;
    const requestedModelId = request.params.modelId;
    const autoStopPreviousRun = request.params.autoStopPreviousRun === true;
    const conversationId = request.params.conversationId ?? crypto.randomUUID();
    const runId = crypto.randomUUID();
    if (!runtimeDeps.conversationRunRegistry.isConversationStartAllowed(
      conversationId,
      request.followUpClaim?.commandId,
    )) {
      return {
        type: "res",
        id: request.requestId,
        ok: false,
        error: {
          code: "conversation_reserved",
          message: "Conversation is reserved for a queued follow-up handoff.",
        },
      };
    }
    const effectiveUserUuid = request.params.userUuid ?? request.userUuid;
    const previousPromptSnapshot = runtimeDeps.getConversationPromptSnapshot
      ? await runtimeDeps.getConversationPromptSnapshot({ conversationId })
      : undefined;
    const modelRouteDecision = resolveDeepSeekTierRoute({
      requestedModelId,
      primaryModelConfig: runtimeDeps.primaryModelConfig,
      modelFallbacks: runtimeDeps.modelFallbacks,
      previousPromptSnapshot,
      policyEnabled: runtimeDeps.deepSeekRoutePolicyEnabled,
    });
    const effectiveModelId = resolveEffectiveMessageSendModelId({
      requestedModelId,
      routeDecision: modelRouteDecision,
      primaryModelConfig: runtimeDeps.primaryModelConfig,
    });
    const modelRouteEvidence = assertExpectedResolvedModel({
      codingRun: request.params.codingRun,
      effectiveModelId,
      primaryModelConfig: runtimeDeps.primaryModelConfig,
      modelFallbacks: runtimeDeps.modelFallbacks,
    });
    const createOpts = effectiveModelId ? { modelOverride: effectiveModelId } : undefined;

    queryRuntime.mark("request_validated", {
      conversationId,
      detail: {
        requestedAgentId: requestedAgentId ?? "default",
        requestedModelId: requestedModelId ?? "default",
        effectiveModelId: effectiveModelId ?? "default",
        resolvedProviderModelId: modelRouteEvidence?.resolvedModelId,
        deepseekRouteMode: modelRouteDecision.routeMode,
        deepseekRouteReason: modelRouteDecision.reason,
        deepseekRouteDegraded: modelRouteDecision.degraded,
        runId,
        hasAttachments: Array.isArray(request.params.attachments) && request.params.attachments.length > 0,
      },
    });

    const lifecycleLease = runtimeDeps.topLevelConversationLifecycle
      ? await runtimeDeps.topLevelConversationLifecycle.acquire({
          conversationId,
          owners: [{
            key: runtimeDeps.conversationStore,
            priority: 100,
            release: () => runtimeDeps.conversationStore.releaseConversation(conversationId),
          }],
        })
      : undefined;
    let lifecycleLeaseTransferred = false;
    let capabilitySnapshotOwned = false;
    const taskCapabilityBinding = createConversationTaskCapabilityClosureBinding({
      conversationId,
      agentRunId: runId,
    });
    try {
    const agent = createAgent({
      agentFactory: runtimeDeps.agentFactory,
      agentRegistry: runtimeDeps.agentRegistry,
      requestedAgentId,
      createOpts,
    });
    assertCodingRunCapabilities(agent, request.params.codingRun);
    capabilitySnapshotOwned = await assertTaskCapabilityClosure({
      resolver: runtimeDeps.taskCapabilityClosureResolver,
      codingRun: request.params.codingRun,
      conversationId,
      runId,
      agentId: requestedAgentId ?? "default",
      requestChannel: request.requestChannel,
    });

    queryRuntime.mark("agent_created", {
      conversationId,
      detail: {
        requestedAgentId: requestedAgentId ?? "default",
        requestedModelId: requestedModelId ?? "default",
        effectiveModelId: effectiveModelId ?? "default",
        deepseekRouteMode: modelRouteDecision.routeMode,
        deepseekRouteReason: modelRouteDecision.reason,
        runId,
      },
    });

    let userText = request.params.text;
    const normalizedRoomContext = request.params.roomContext
      ? { ...request.params.roomContext, clientId: request.clientId }
      : request.params.from === "web"
        ? { environment: "local" as const, clientId: request.clientId }
        : undefined;

    userText = toolControl.tryApprovePasswordInput({
      confirmationStore: toolControl.confirmationStore,
      getMode: toolControl.getMode,
      getConfirmPassword: toolControl.getConfirmPassword,
      conversationId,
      userText,
    }).sanitizedText;

    const { conversation: existingConv, history } = await runtimeDeps.conversationStore.getConversationHistoryCompacted(conversationId);

    queryRuntime.mark("conversation_loaded", {
      conversationId,
      detail: {
        historyLength: history.length,
        existingAgentId: existingConv?.agentId,
      },
    });

    if (existingConv?.agentId && requestedAgentId && existingConv.agentId !== requestedAgentId) {
      queryRuntime.mark("completed", {
        conversationId,
        detail: {
          rejected: "agent_mismatch",
        },
      });
      return {
        type: "res",
        id: request.requestId,
        ok: false,
        error: {
          code: "agent_mismatch",
          message: `会话已绑定 Agent "${existingConv.agentId}"，不能使用 "${requestedAgentId}"。请新建会话。`,
        },
      };
    }

    if (lifecycleLease && typeof agent.releaseConversation === "function") {
      lifecycleLease.addOwner({
        // Registry Agent 按实例区分 model override；无 Registry 时 factory 是稳定的替换 key。
        key: runtimeDeps.agentRegistry ? agent : runtimeDeps.agentFactory,
        priority: 0,
        release: () => agent.releaseConversation?.(conversationId),
      });
    }

    if (autoStopPreviousRun) {
      const previousRun = runtimeDeps.conversationRunRegistry.get(conversationId);
      if (previousRun && previousRun.runId !== runId) {
        const stopReason = "Auto-stopped by newer message.send request.";
        const stopResult = await runtimeDeps.conversationRunRegistry.requestStop({
          conversationId,
          runId: previousRun.runId,
          reason: stopReason,
        });
        queryRuntime.mark("previous_run_stop_requested", {
          conversationId,
          detail: {
            previousRunId: previousRun.runId,
            accepted: stopResult.accepted,
            state: stopResult.state,
            reason: stopReason,
          },
        });
        runtimeDeps.log.info("message", "Auto stop previous conversation run", {
          conversationId,
          previousRunId: previousRun.runId,
          accepted: stopResult.accepted,
          state: stopResult.state,
        });
      }
    }

    const userMessageTimestamp = Date.now();
    const userMessage = runtimeDeps.conversationStore.addMessage(conversationId, "user", userText, {
      agentId: requestedAgentId,
      channel: "webchat",
      timestampMs: userMessageTimestamp,
      clientContext: request.params.clientContext,
    });
    await runtimeDeps.conversationStore.waitForPendingPersistence(conversationId);

    queryRuntime.mark("user_message_persisted", {
      conversationId,
      detail: {
        userTimestampMs: userMessage.timestamp,
      },
    });

    runtimeDeps.log.debug("message", "Processing message.send", {
      conversationId,
      hasUserUuid: Boolean(effectiveUserUuid),
      userUuidSource: request.params.userUuid ? "message.send" : (request.userUuid ? "connect" : "none"),
      payloadKeys: Object.keys(request.params),
    });
    if ("attachments" in request.params) {
      const atts = (request.params as { attachments?: MessageSendParams["attachments"] }).attachments;
      runtimeDeps.log.debug("message", "Attachments field detected", {
        isArray: Array.isArray(atts),
        count: Array.isArray(atts) ? atts.length : undefined,
      });
    } else {
      runtimeDeps.log.debug("message", "No attachments field in payload");
    }

    const preparedPrompt = await preparePromptWithAttachments({
      conversationId,
      runId,
      promptText: userText,
      attachments: request.params.attachments,
      stateDir: request.stateDir,
      sttTranscribe: media.sttTranscribe,
      log: runtimeDeps.log,
      getAttachmentPromptLimits: media.getAttachmentPromptLimits,
      truncateTextForPrompt: media.truncateTextForPrompt,
      acceptedContentCapabilities: media.resolveCurrentModelMediaCapabilities?.({
        requestedAgentId,
        requestedModelId,
      }),
      preflightCompressionPolicy: runtimeDeps.preflightCompressionPolicy,
    });

    const abortController = new AbortController();

    // ── Chat Commander 显式触发判定 ──
    // 检测用户消息是否显式要求使用 commander / multi-agent / parallel review / workflow
    // 不做 auto 判定，只响应显式触发或 commanderMode === "on"
    const commanderPromptDeltas: AgentPromptDelta[] = [];
    if (!isBareCodingRun(request.params.codingRun)) {
      const commanderTrigger = detectChatCommanderTrigger(userText, runtimeDeps.commanderMode);
      if (commanderTrigger.triggered) {
        commanderPromptDeltas.push({
          id: `chat-commander-hint-${runId}`,
          deltaType: "chat-commander-hint",
          role: "system",
          text: buildChatCommanderHintText(commanderTrigger),
          source: "chat-commander-trigger",
          metadata: {
            matchedPhrases: commanderTrigger.matchedPhrases,
            suggestedTools: commanderTrigger.suggestedTools,
            reason: commanderTrigger.reason,
          },
        });
        runtimeDeps.log.info("chat-commander", `Triggered: ${commanderTrigger.reason}`, {
          matchedPhrases: commanderTrigger.matchedPhrases,
          runId,
        });
      }
    }
    const automationContext = projectCodingRunAutomationContext({
      codingRun: request.params.codingRun,
      history,
      explicitPromptDeltas: preparedPrompt.promptDeltas,
      implicitPromptDeltas: commanderPromptDeltas,
    });

    const steeringMailbox = agent.getCodingRunCapabilities?.().steerAtModelBoundary === true
      ? new ConversationSteerMailbox({
          binding: { conversationId, agentRunId: runId },
          onDeliver: async (command) => {
            const steerMessage = runtimeDeps.conversationStore.addMessage(
              conversationId,
              "user",
              command.prompt,
              {
                agentId: requestedAgentId,
                channel: "webchat",
                timestampMs: Date.now(),
              },
            );
            await runtimeDeps.conversationStore.waitForPendingPersistence(conversationId);
            runtimeDeps.log.debug("coding-run", "Conversation steer input persisted for model-boundary delivery.", {
              conversationId,
              runId,
              commandId: command.commandId,
              userTimestampMs: steerMessage.timestamp,
            });
          },
        })
      : undefined;
    await runtimeDeps.conversationRunRegistry.registerDurable({
      conversationId,
      runId,
      agentId: requestedAgentId ?? "default",
      startedAt: Date.now(),
      state: "running",
      stop: (reason?: string) => {
        if (abortController.signal.aborted) {
          return false;
        }
        abortController.abort(readMessageSendStopReason(undefined, reason));
        return true;
      },
    }, {
      ...(request.followUpClaim ? { followUp: request.followUpClaim } : {}),
      ...(steeringMailbox ? { steering: steeringMailbox } : {}),
    });
    try {
      runtimeDeps.codingRunEventBroker?.registerConversationRun({
        conversationId,
        agentRunId: runId,
      });
    } catch (error) {
      await settleConversationRecoveryMarker({
        runtime: runtimeDeps,
        conversationId,
        runId,
      });
      runtimeDeps.conversationRunRegistry.clear(conversationId, runId);
      throw error;
    }

    lifecycleLeaseTransferred = true;
    void runAgentInBackground({
      ctx,
      queryRuntime,
      agent,
      lifecycleLease,
      abortController,
      conversationId,
      requestedAgentId,
      effectiveUserUuid,
      runId,
      followUpQueueBinding: request.followUpClaim?.queueBinding,
      steeringMailbox,
      userMessageTimestamp: userMessage.timestamp,
      userText,
      ...(automationContext.automationProfile
        ? { automationProfile: automationContext.automationProfile }
        : {}),
      history: automationContext.history,
      normalizedRoomContext,
      promptText: preparedPrompt.promptText,
      contentParts: preparedPrompt.contentParts,
      promptDeltas: automationContext.promptDeltas,
      attachmentCompressionResults: preparedPrompt.attachmentCompressionResults,
      textAttachmentCount: preparedPrompt.textAttachmentCount,
      textAttachmentChars: preparedPrompt.textAttachmentChars,
      audioTranscriptChars: preparedPrompt.audioTranscriptChars,
      audioTranscriptCacheHits: preparedPrompt.audioTranscriptCacheHits,
      attachmentPromptLimits: preparedPrompt.attachmentPromptLimits,
      senderInfo: request.params.senderInfo,
      clientContext: request.params.clientContext,
      codingRun: request.params.codingRun,
      from: request.params.from,
      routeDecision: {
        requestedRoute: requestedModelId,
        effectiveModelId,
        selectedTier: modelRouteDecision.selectedTier,
        routeMode: modelRouteDecision.routeMode,
        degraded: modelRouteDecision.degraded,
        reason: modelRouteDecision.reason,
        ...(modelRouteDecision.tierPinning
          ? {
            tierPinning: {
              pinned: modelRouteDecision.tierPinning.pinned,
              ...(modelRouteDecision.tierPinning.previousTier
                ? { previousTier: modelRouteDecision.tierPinning.previousTier }
                : {}),
              ...(modelRouteDecision.tierPinning.reason
                ? { reason: modelRouteDecision.tierPinning.reason }
                : {}),
            },
          }
          : {}),
      },
      capabilitySnapshotOwned,
    });

    return {
      type: "res",
      id: request.requestId,
      ok: true,
      payload: {
        conversationId,
        runId,
        messageMeta: io.toChatMessageMeta(userMessage.timestamp, true),
        ...(modelRouteEvidence ? { modelRoute: modelRouteEvidence } : {}),
      },
    };
    } finally {
      if (!lifecycleLeaseTransferred) {
        if (capabilitySnapshotOwned) {
          runtimeDeps.taskCapabilityClosureResolver?.release?.(taskCapabilityBinding);
        }
        await lifecycleLease?.release();
      }
    }
  });
}

export async function handleConversationRunStopWithQueryRuntime(
  ctx: ConversationRunStopQueryRuntimeContext,
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "conversation.run.stop" as const,
    traceId: ctx.request.requestId,
    observer: ctx.runtime.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    const conversationId = typeof ctx.request.params.conversationId === "string"
      ? ctx.request.params.conversationId.trim()
      : "";
    const runId = typeof ctx.request.params.runId === "string" && ctx.request.params.runId.trim()
      ? ctx.request.params.runId.trim()
      : undefined;
    const reason = typeof ctx.request.params.reason === "string" && ctx.request.params.reason.trim()
      ? ctx.request.params.reason.trim()
      : "Stopped by user.";

    queryRuntime.mark("request_validated", {
      conversationId,
      detail: {
        runId,
        hasReason: Boolean(reason),
        reason,
      },
    });

    const result = await ctx.runtime.conversationRunRegistry.requestStop({
      conversationId,
      runId,
      reason,
    });

    if (result.accepted) {
      queryRuntime.mark("task_stopped", {
        conversationId,
        detail: {
          runId: result.runId,
          state: result.state,
          reason,
        },
      });
    }
    queryRuntime.mark("completed", {
      conversationId,
      detail: {
        accepted: result.accepted,
        state: result.state,
        runId: result.runId,
        reason,
      },
    });

    return {
      type: "res",
      id: ctx.request.requestId,
      ok: true,
      payload: {
        accepted: result.accepted,
        state: result.state,
        runId: result.runId,
      },
    };
  });
}

function resolveEffectiveMessageSendModelId(input: {
  requestedModelId?: string;
  routeDecision: ReturnType<typeof resolveDeepSeekTierRoute>;
  primaryModelConfig?: MessageSendQueryRuntimeContext["runtime"]["primaryModelConfig"];
}): string | undefined {
  if (input.routeDecision.resolvedModelId) {
    return input.routeDecision.resolvedModelId;
  }
  if (input.routeDecision.routeMode !== "deepseek_virtual") {
    return input.requestedModelId;
  }
  return input.primaryModelConfig ? "primary" : undefined;
}

function assertExpectedResolvedModel(input: {
  codingRun: MessageSendParams["codingRun"];
  effectiveModelId?: string;
  primaryModelConfig?: MessageSendQueryRuntimeContext["runtime"]["primaryModelConfig"];
  modelFallbacks?: ModelProfile[];
}): CodingRunModelRouteEvidence | undefined {
  const declaredModelId = input.codingRun?.expectedResolvedModelId?.trim();
  if (!declaredModelId) return undefined;
  if (!input.effectiveModelId || !input.primaryModelConfig) {
    throw new CodingRunModelRouteError();
  }
  const resolved = resolveModelConfig(
    input.effectiveModelId,
    input.primaryModelConfig,
    input.modelFallbacks ?? [],
  );
  const resolvedModelId = resolved.model.trim();
  if (!resolvedModelId || resolvedModelId !== declaredModelId) {
    throw new CodingRunModelRouteError();
  }
  return {
    declaredModelId,
    resolvedModelId,
    source: resolved.source,
  };
}

function createAgent(input: {
  agentFactory: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  requestedAgentId?: string;
  createOpts?: { modelOverride: string };
}): BelldandyAgent {
  try {
    if (input.agentRegistry && input.requestedAgentId) {
      return input.agentRegistry.create(input.requestedAgentId, input.createOpts);
    }
    if (input.agentRegistry) {
      return input.agentRegistry.create("default", input.createOpts);
    }
    return input.agentFactory();
  } catch (error: any) {
    if (error?.message === "CONFIG_REQUIRED") {
      throw new MessageSendConfigurationError();
    }
    throw error;
  }
}

export class MessageSendConfigurationError extends Error {
  constructor() {
    super("API Key or configuration missing.");
    this.name = "MessageSendConfigurationError";
  }
}

export class CodingRunModelRouteError extends Error {
  constructor() {
    super("Coding run declared model does not match the Gateway resolved model.");
    this.name = "CodingRunModelRouteError";
  }
}

type MessageSendBackgroundInput = {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  agent: BelldandyAgent;
  capabilitySnapshotOwned: boolean;
  lifecycleLease?: TopLevelConversationLease;
  abortController: AbortController;
  conversationId: string;
  requestedAgentId?: string;
  effectiveUserUuid?: string;
  runId: string;
  followUpQueueBinding?: ConversationRunBinding;
  steeringMailbox?: ConversationSteerMailbox;
  userMessageTimestamp: number;
  userText: string;
  automationProfile?: "bare";
  history: Array<unknown>;
  normalizedRoomContext?: Record<string, unknown>;
  promptText: string;
  contentParts: Array<Record<string, unknown>>;
  promptDeltas: AgentPromptDelta[];
  attachmentCompressionResults?: CompressionResult[];
  textAttachmentCount: number;
  textAttachmentChars: number;
  audioTranscriptChars: number;
  audioTranscriptCacheHits: number;
  attachmentPromptLimits: AttachmentPromptLimits;
  senderInfo?: unknown;
  clientContext?: MessageSendParams["clientContext"];
  codingRun?: MessageSendParams["codingRun"];
  from?: string;
  routeDecision?: {
    requestedRoute?: string;
    effectiveModelId?: string;
    selectedTier?: "flash" | "pro";
    routeMode?: "passthrough" | "deepseek_virtual";
    degraded?: boolean;
    reason?: string;
    tierPinning?: {
      pinned?: boolean;
      previousTier?: "flash" | "pro";
      reason?: string;
    };
  };
  auxSummaryVerdict?: {
    strategy?: string;
    enabled?: boolean;
    reason?: string;
  };
};

type MessageSendLatestUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  cacheSupport?: "supported" | "unsupported" | "unknown";
  systemPromptFingerprint?: string;
  structureSignature?: string;
  warmupCoordination?: {
    eligible?: boolean;
    status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
    recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
    reason?: string;
    previousAgeMs?: number;
  };
  cacheFamilyAffinity?: {
    status?: "unknown" | "aligned" | "mismatch";
    familyKey?: string;
    previousFamilyKey?: string;
    reason?: string;
  };
  deepseekRoute?: {
    requestedRoute?: string;
    effectiveModelId?: string;
    selectedTier?: "flash" | "pro";
    routeMode?: "passthrough" | "deepseek_virtual";
    degraded?: boolean;
    reason?: string;
    tierPinning?: {
      pinned?: boolean;
      previousTier?: "flash" | "pro";
      reason?: string;
    };
  };
  attachmentCompression?: {
    appliedCount: number;
    totalSavedChars: number;
    totalSavedCharsPositive: boolean;
    bySource?: Record<string, { applied: number; savedChars: number }>;
  };
  auxSummaryVerdict?: {
    strategy?: string;
    enabled?: boolean;
    reason?: string;
  };
  inputCostUsd?: number;
  outputCostUsd?: number;
  cacheCreationCostUsd?: number;
  cacheReadCostUsd?: number;
  cacheSavingsUsd?: number;
  totalCostUsd?: number;
  usageCalibration?: {
    estimatedPromptTokens: number;
    actualInputTokens: number;
    modelCalls: number;
    averageInputTokensPerCall: number;
    deltaTokens: number;
    deltaRatio: number;
    status?: "aligned" | "under_estimated" | "over_estimated";
  };
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
  requestShape?: {
    messageCount: number;
    systemMessageCount: number;
    toolSchemaCount: number;
  };
  localPromptEstimate?: {
    systemPromptTokens: number;
    contextTokens: number;
    totalPromptTokens: number;
  };
  prefixShape?: Record<string, unknown>;
  prefixDrift?: Record<string, unknown>;
  budgetCompetition?: Record<string, unknown>;
  compression?: {
    appliedCount: number;
    skippedCount: number;
    failedCount: number;
    totalSavedTokensEstimate: number;
    bySource?: Record<string, { applied: number; savedTokens: number }>;
  };
};

type MessageSendRunResult = Awaited<ReturnType<typeof runAgentWithLifecycle>>;

type MessageSendCompletionPolicy = {
  conversationId: string;
  runId: string;
  agentId: string;
  finalText: string;
  finalTimestampMs: number;
  statusBeforeFinal?: string;
  terminalStage: "completed" | "failed";
  terminalDetail: Record<string, unknown>;
  assistantPersistedDetail?: Record<string, unknown>;
  digestSource: string;
  digestWarningMessage: string;
};

type MessageSendBackgroundRunState = {
  run: {
    getLatestUsage: () => MessageSendLatestUsage | undefined;
    setLatestUsage: (usage: MessageSendLatestUsage | undefined) => void;
    getRunMeta: () => Record<string, unknown> | undefined;
    setRunMeta: (meta: Record<string, unknown> | undefined) => void;
    hasEmittedTaskResult: () => boolean;
    markTaskResultEmitted: () => void;
    hasReceivedFinal: () => boolean;
    setReceivedFinal: (value: boolean) => void;
  };
  usageUpload: {
    getLastUploadedUsageTotal: () => number;
    setLastUploadedUsageTotal: (value: number) => void;
  };
};

function buildMessageSendAgentRunInput(
  input: MessageSendBackgroundInput,
  media: MessageSendQueryRuntimeContext["media"],
): any {
  const codingRunLaunchSpec = buildCodingRunLaunchSpec(input.codingRun);
  const codingRunPromptOverride = buildCodingRunPromptOverride(input.codingRun);
  const structuredOutput = buildAgentStructuredOutputContract(input.codingRun);
  const runInput: any = {
    conversationId: input.conversationId,
    ...(input.automationProfile ? { automationProfile: input.automationProfile } : {}),
    text: input.promptText,
    userInput: input.userText,
    abortSignal: input.abortController.signal,
    ...(input.steeringMailbox ? { steering: input.steeringMailbox } : {}),
    history: input.history,
    agentId: input.requestedAgentId,
    userUuid: input.effectiveUserUuid,
    senderInfo: input.senderInfo,
    roomContext: input.normalizedRoomContext,
    ...(codingRunPromptOverride ? { promptOverride: codingRunPromptOverride } : {}),
    ...(structuredOutput ? { structuredOutput } : {}),
    meta: {
      ...(input.ctx.request.requestChannel ? { _toolRequestChannel: input.ctx.request.requestChannel } : {}),
      ...(codingRunLaunchSpec ? { _agentLaunchSpec: codingRunLaunchSpec } : {}),
      runId: input.runId,
      currentMessageTime: {
        timestampMs: input.userMessageTimestamp,
        displayTimeText: media.formatLocalMessageTime(input.userMessageTimestamp),
        isLatest: true,
        role: "user",
        clientContext: input.clientContext,
      },
    },
  };

  const attachmentStats = buildMessageSendAttachmentStats(input);
  if (attachmentStats) {
    runInput.meta = {
      ...(runInput.meta ?? {}),
      attachmentStats,
    };
  }
  if (input.promptDeltas.length > 0) {
    runInput.meta = {
      ...(runInput.meta ?? {}),
      promptDeltas: input.promptDeltas.map((delta) => ({
        ...delta,
        ...(delta.metadata ? { metadata: { ...delta.metadata } } : {}),
      })),
    };
  }

  if (input.contentParts.length > 0) {
    runInput.content = [
      { type: "text", text: input.promptText },
      ...input.contentParts,
    ];
  }

  return runInput;
}

function buildAgentStructuredOutputContract(
  codingRun: MessageSendParams["codingRun"],
): Parameters<BelldandyAgent["run"]>[0]["structuredOutput"] {
  if (codingRun?.outputSchema === undefined) return undefined;
  const compiled = compileOutputSchema(codingRun.outputSchema);
  if (!compiled.ok) throw new Error(compiled.message);
  return {
    schema: codingRun.outputSchema,
    validateOutput: compiled.validator.validateOutput,
  };
}

export class CodingRunCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodingRunCapabilityError";
  }
}

export class TaskCapabilityClosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskCapabilityClosureError";
  }
}

function assertCodingRunCapabilities(
  agent: BelldandyAgent,
  codingRun: MessageSendParams["codingRun"],
): void {
  const capabilities = agent.getCodingRunCapabilities?.();
  if (codingRun?.maxCostUsd !== undefined && capabilities?.maxCostUsd !== true) {
    throw new CodingRunCapabilityError(
      "This Agent cannot enforce maxCostUsd because valid model usage pricing is unavailable.",
    );
  }
  if (
    codingRun?.workspaceMutationRequirement === "required"
    && capabilities?.workspaceMutationRequirement !== true
  ) {
    throw new CodingRunCapabilityError(
      "This Agent cannot enforce the required workspace mutation contract.",
    );
  }
  if (codingRun?.requiredChangedPaths && capabilities?.requiredChangedPaths !== true) {
    throw new CodingRunCapabilityError(
      "This Agent cannot enforce the required changed-path coverage contract.",
    );
  }
}

async function assertTaskCapabilityClosure(input: {
  resolver?: TaskCapabilityClosureResolver;
  codingRun: MessageSendParams["codingRun"];
  conversationId: string;
  runId: string;
  agentId: string;
  requestChannel?: ToolContractChannel;
}): Promise<boolean> {
  if (!input.codingRun) return false;
  const requirements = input.codingRun.requiredCapabilities;
  if (!input.resolver) {
    if (!requirements) return false;
    throw new TaskCapabilityClosureError("Task capability closure rejected the run: capability_closure_unknown.");
  }
  if (!requirements && input.resolver.evaluateForStart) return false;
  const binding = createConversationTaskCapabilityClosureBinding({
    conversationId: input.conversationId,
    agentRunId: input.runId,
  });
  const closure = requirements && input.resolver.evaluateForStart
    ? await input.resolver.evaluateForStart({
      binding,
      requirements,
      context: {
        conversationId: input.conversationId,
        agentId: input.agentId,
        ...(input.codingRun.automationProfile ? { automationProfile: input.codingRun.automationProfile } : {}),
        ...(input.requestChannel ? { requestChannel: input.requestChannel } : {}),
        ...(input.codingRun.permissionMode ? { permissionMode: input.codingRun.permissionMode } : {}),
        ...(input.codingRun.toolAllow ? { toolAllow: [...input.codingRun.toolAllow] } : {}),
        ...(input.codingRun.toolDeny ? { toolDeny: [...input.codingRun.toolDeny] } : {}),
      },
    })
    : input.resolver.resolve(binding);
  const decision = evaluateTaskCapabilityClosureForStart(closure);
  if (decision.ok) return Boolean(requirements && input.resolver.evaluateForStart);
  if (requirements && input.resolver.evaluateForStart) input.resolver.release?.(binding);
  const unavailable = decision.unavailable.length > 0 ? `:${decision.unavailable.join(",")}` : "";
  throw new TaskCapabilityClosureError(`Task capability closure rejected the run: ${decision.reasonCode}${unavailable}.`);
}

function buildCodingRunLaunchSpec(
  codingRun: MessageSendParams["codingRun"],
): Record<string, unknown> | undefined {
  if (!codingRun) return undefined;
  const launchSpec = {
    commandSandbox: "required",
    ...(codingRun.cwd ? { cwd: codingRun.cwd, isolationMode: "cwd" } : {}),
    ...(codingRun.toolAllow?.length
      ? { toolSet: [...codingRun.toolAllow] }
      : isBareCodingRun(codingRun) ? { toolSet: [] } : {}),
    ...(codingRun.toolDeny?.length ? { toolDeny: [...codingRun.toolDeny] } : {}),
    ...(codingRun.permissionMode ? { permissionMode: codingRun.permissionMode } : {}),
    ...(codingRun.toolArgumentPolicy ? { toolArgumentPolicy: codingRun.toolArgumentPolicy } : {}),
    ...(codingRun.modelLoopBudgetPolicy ? { modelLoopBudgetPolicy: codingRun.modelLoopBudgetPolicy } : {}),
    ...(codingRun.workspaceMutationRequirement
      ? { workspaceMutationRequirement: codingRun.workspaceMutationRequirement }
      : {}),
    ...(codingRun.requiredChangedPaths?.length
      ? { requiredChangedPaths: [...codingRun.requiredChangedPaths] }
      : {}),
    ...(codingRun.maxWallTimeMs ? { maxRunWallTimeMs: codingRun.maxWallTimeMs } : {}),
    ...(codingRun.maxTurns ? { toolLoopIterationBudget: codingRun.maxTurns } : {}),
    ...(codingRun.maxTokens ? { maxTotalTokens: codingRun.maxTokens } : {}),
    ...(codingRun.maxCostUsd ? { maxCostUsd: codingRun.maxCostUsd } : {}),
  };
  return Object.keys(launchSpec).length > 0 ? launchSpec : undefined;
}

async function buildProjectRulesPromptDelta(
  codingRun: MessageSendParams["codingRun"],
): Promise<AgentPromptDelta | undefined> {
  if (isBareCodingRun(codingRun)) return undefined;
  const cwd = codingRun?.cwd?.trim();
  if (!cwd) return undefined;

  const resolution = await resolveProjectRules({ cwd });
  if (resolution.rules.length === 0) return undefined;

  return {
    id: `project-rules-${resolution.prompt.contentHash.replace(/^sha256:/, "").slice(0, 16)}`,
    deltaType: "project-rules",
    role: "system",
    text: resolution.prompt.text,
    source: "project-rules",
    metadata: {
      cwd: resolution.cwd,
      root: resolution.root.path,
      rootSource: resolution.root.source,
      sourceCount: resolution.prompt.sourceCount,
      contentHash: resolution.prompt.contentHash,
      sources: resolution.rules.map((rule) => ({
        path: rule.path,
        scopeDir: rule.scopeDir,
        priority: rule.priority,
        contentHash: rule.contentHash,
        sizeBytes: rule.sizeBytes,
      })),
      diagnostics: resolution.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    },
  };
}

function buildMessageSendAttachmentStats(
  input: Pick<
    MessageSendBackgroundInput,
    "textAttachmentCount" | "textAttachmentChars" | "audioTranscriptChars" | "audioTranscriptCacheHits" | "attachmentPromptLimits" | "attachmentCompressionResults"
  >,
): Record<string, unknown> | undefined {
  const attachmentCompression = summarizeAttachmentCompressionResults(input.attachmentCompressionResults);
  if (input.textAttachmentCount <= 0 && input.audioTranscriptChars <= 0 && !attachmentCompression) {
    return undefined;
  }

  return {
    textAttachmentCount: input.textAttachmentCount,
    textAttachmentChars: input.textAttachmentChars,
    audioTranscriptChars: input.audioTranscriptChars,
    audioTranscriptCacheHits: input.audioTranscriptCacheHits,
    promptAugmentationChars: input.textAttachmentChars + input.audioTranscriptChars,
    textAttachmentTruncatedCharLimit: input.attachmentPromptLimits.textCharLimit,
    textAttachmentTotalCharLimit: input.attachmentPromptLimits.totalTextCharLimit,
    audioTranscriptAppendCharLimit: input.attachmentPromptLimits.audioTranscriptAppendCharLimit,
    ...(attachmentCompression ? { attachmentCompression } : {}),
  };
}

function summarizeAttachmentCompressionResults(
  results: CompressionResult[] | undefined,
): {
  appliedCount: number;
  totalSavedChars: number;
  totalSavedCharsPositive: boolean;
  bySource?: Record<string, { applied: number; savedChars: number }>;
} | undefined {
  if (!Array.isArray(results) || results.length === 0) {
    return undefined;
  }
  let appliedCount = 0;
  let totalSavedChars = 0;
  const bySource = new Map<string, { applied: number; savedChars: number }>();
  for (const result of results) {
    if (!result?.applied) continue;
    const sourceKind = typeof result.observability?.sourceKind === "string" && result.observability.sourceKind.trim()
      ? result.observability.sourceKind.trim()
      : "unknown";
    const savedChars = Math.max(0, Number(result.originalChars ?? 0) - Number(result.compressedChars ?? 0));
    appliedCount += 1;
    totalSavedChars += savedChars;
    const current = bySource.get(sourceKind) ?? { applied: 0, savedChars: 0 };
    current.applied += 1;
    current.savedChars += savedChars;
    bySource.set(sourceKind, current);
  }
  if (appliedCount <= 0) {
    return undefined;
  }
  return {
    appliedCount,
    totalSavedChars,
    totalSavedCharsPositive: totalSavedChars > 0,
    ...(bySource.size > 0 ? { bySource: Object.fromEntries(bySource.entries()) } : {}),
  };
}

function readAttachmentCompressionFromRunMeta(
  meta: Record<string, unknown> | undefined,
): {
  appliedCount: number;
  totalSavedChars: number;
  totalSavedCharsPositive: boolean;
  bySource?: Record<string, { applied: number; savedChars: number }>;
} | undefined {
  const attachmentStats = meta?.attachmentStats;
  if (!attachmentStats || typeof attachmentStats !== "object") {
    return undefined;
  }
  const attachmentCompression = (attachmentStats as Record<string, unknown>).attachmentCompression;
  if (!attachmentCompression || typeof attachmentCompression !== "object") {
    return undefined;
  }
  return attachmentCompression as {
    appliedCount: number;
    totalSavedChars: number;
    totalSavedCharsPositive: boolean;
    bySource?: Record<string, { applied: number; savedChars: number }>;
  };
}

function createMessageSendBackgroundRunState(): MessageSendBackgroundRunState {
  const runState: {
    latestUsage?: MessageSendLatestUsage;
    runMeta?: Record<string, unknown>;
    didEmitAutoRunTaskResult: boolean;
    receivedFinal: boolean;
  } = {
    latestUsage: undefined,
    runMeta: undefined,
    didEmitAutoRunTaskResult: false,
    receivedFinal: false,
  };
  const usageUploadState = {
    lastUploadedUsageTotal: 0,
  };

  return {
    run: {
      getLatestUsage: () => runState.latestUsage,
      setLatestUsage: (usage) => {
        runState.latestUsage = usage;
      },
      getRunMeta: () => runState.runMeta,
      setRunMeta: (meta) => {
        runState.runMeta = meta;
      },
      hasEmittedTaskResult: () => runState.didEmitAutoRunTaskResult,
      markTaskResultEmitted: () => {
        runState.didEmitAutoRunTaskResult = true;
      },
      hasReceivedFinal: () => runState.receivedFinal,
      setReceivedFinal: (value) => {
        runState.receivedFinal = value;
      },
    },
    usageUpload: {
      getLastUploadedUsageTotal: () => usageUploadState.lastUploadedUsageTotal,
      setLastUploadedUsageTotal: (value) => {
        usageUploadState.lastUploadedUsageTotal = value;
      },
    },
  };
}

function isJsonObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readToolResultAcceptanceGateStatus(metadata: unknown): string | undefined {
  const firstGate = readFirstDelegationAcceptanceGate(metadata);
  if (!firstGate || typeof firstGate.accepted !== "boolean") {
    return undefined;
  }
  return firstGate.accepted ? "accepted" : "rejected";
}

function readToolResultAcceptanceGateConfidence(metadata: unknown): string | undefined {
  const firstGate = readFirstDelegationAcceptanceGate(metadata);
  return typeof firstGate?.rejectionConfidence === "string" && firstGate.rejectionConfidence.trim()
    ? firstGate.rejectionConfidence.trim()
    : undefined;
}

function readToolResultFollowUpRuntimeAction(metadata: unknown): string | undefined {
  const strategy = readToolResultFollowUpStrategy(metadata);
  return typeof strategy?.recommendedRuntimeAction === "string" && strategy.recommendedRuntimeAction.trim()
    ? strategy.recommendedRuntimeAction.trim()
    : undefined;
}

function readToolResultFollowUpHighPriorityLabels(metadata: unknown): string | undefined {
  const strategy = readToolResultFollowUpStrategy(metadata);
  const labels = Array.isArray(strategy?.highPriorityLabels)
    ? strategy.highPriorityLabels
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    : [];
  return labels.length > 0 ? labels.slice(0, 3).join(", ") : undefined;
}

function readToolResultVerifierHandoffSuggested(metadata: unknown): boolean | undefined {
  const strategy = readToolResultFollowUpStrategy(metadata);
  const labels = Array.isArray(strategy?.verifierHandoffLabels)
    ? strategy.verifierHandoffLabels
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    : [];
  return labels.length > 0 ? true : undefined;
}

function readToolResultFollowUpStrategy(metadata: unknown): Record<string, unknown> | undefined {
  if (!isJsonObjectRecord(metadata) || !isJsonObjectRecord(metadata.followUpStrategy)) {
    return undefined;
  }
  return metadata.followUpStrategy;
}

function readPlanLifecycleMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!isJsonObjectRecord(metadata) || !isJsonObjectRecord(metadata.planLifecycle)) {
    return undefined;
  }
  return metadata.planLifecycle;
}

function readPlanLifecycleString(metadata: unknown, key: string): string | undefined {
  const lifecycle = readPlanLifecycleMetadata(metadata);
  const value = lifecycle?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPlanLifecycleBoolean(metadata: unknown, key: string): boolean | undefined {
  const lifecycle = readPlanLifecycleMetadata(metadata);
  const value = lifecycle?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readFirstDelegationAcceptanceGate(metadata: unknown): Record<string, unknown> | undefined {
  if (!isJsonObjectRecord(metadata)) {
    return undefined;
  }
  const results = Array.isArray(metadata.delegationResults) ? metadata.delegationResults : [];
  for (const result of results) {
    if (!isJsonObjectRecord(result)) {
      continue;
    }
    const gate = result.acceptanceGate;
    if (isJsonObjectRecord(gate)) {
      return gate;
    }
  }
  return undefined;
}

function sanitizeToolResultEventMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!isJsonObjectRecord(metadata)) {
    return undefined;
  }
  const {
    delegationResults: _delegationResults,
    followUpStrategy: _followUpStrategy,
    ...rest
  } = metadata;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function emitMessageSendTaskResult(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  conversationId: string;
  durationMs: number;
  state: MessageSendBackgroundRunState;
}): void {
  const latestUsage = input.state.run.getLatestUsage();
  if (input.state.run.hasEmittedTaskResult() || !latestUsage) {
    return;
  }

  input.ctx.effects.emitAutoRunTaskTokenResult(
    input.ctx.runtime.conversationStore,
    {
      conversationId: input.conversationId,
      inputTokens: latestUsage.inputTokens,
      outputTokens: latestUsage.outputTokens,
      durationMs: input.durationMs,
      inputCostUsd: latestUsage.inputCostUsd,
      outputCostUsd: latestUsage.outputCostUsd,
      totalCostUsd: latestUsage.totalCostUsd,
    },
    input.ctx.request.ws,
  );
  input.queryRuntime.mark("task_result_recorded", {
    conversationId: input.conversationId,
    detail: {
      inputTokens: latestUsage.inputTokens,
      outputTokens: latestUsage.outputTokens,
      ...(latestUsage.usageCalibration ? { usageCalibration: latestUsage.usageCalibration } : {}),
    },
  });
  input.state.run.markTaskResultEmitted();
}

function handleMessageSendUsageEvent(input: {
  ctx: MessageSendQueryRuntimeContext;
  conversationId: string;
  runId: string;
  effectiveUserUuid?: string;
  from?: string;
  state: MessageSendBackgroundRunState;
  routeDecision?: {
    requestedRoute?: string;
    effectiveModelId?: string;
    selectedTier?: "flash" | "pro";
    routeMode?: "passthrough" | "deepseek_virtual";
    degraded?: boolean;
    reason?: string;
    tierPinning?: {
      pinned?: boolean;
      previousTier?: "flash" | "pro";
      reason?: string;
    };
  };
  auxSummaryVerdict?: {
    strategy?: string;
    enabled?: boolean;
    reason?: string;
  };
  item: {
    systemPromptTokens: number;
    contextTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
    modelCalls: number;
    providerReportedModelCalls?: number;
    cacheSupport?: "supported" | "unsupported" | "unknown";
    systemPromptFingerprint?: string;
    structureSignature?: string;
    warmupCoordination?: {
      eligible?: boolean;
      status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
      recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
      reason?: string;
      previousAgeMs?: number;
    };
    cacheFamilyAffinity?: {
      status?: "unknown" | "aligned" | "mismatch";
      familyKey?: string;
      previousFamilyKey?: string;
      reason?: string;
    };
    inputCostUsd?: number;
    outputCostUsd?: number;
    cacheCreationCostUsd?: number;
    cacheReadCostUsd?: number;
    cacheSavingsUsd?: number;
    totalCostUsd?: number;
    usageCalibration?: {
      estimatedPromptTokens: number;
      actualInputTokens: number;
      modelCalls: number;
      averageInputTokensPerCall: number;
      deltaTokens: number;
      deltaRatio: number;
      status?: "aligned" | "under_estimated" | "over_estimated";
    };
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
    requestShape?: {
      messageCount: number;
      systemMessageCount: number;
      toolSchemaCount: number;
    };
    localPromptEstimate?: {
      systemPromptTokens: number;
      contextTokens: number;
      totalPromptTokens: number;
    };
    prefixShape?: {
      fingerprint: string;
      cacheEligiblePrefixFingerprint: string;
      shapeHashes: Record<string, string>;
      counts: Record<string, number>;
      prefixTokens: Record<string, number>;
    };
    prefixDrift?: {
      status: "first_snapshot" | "stable" | "drifted";
      changed: boolean;
      reasons: string[];
      previousFingerprint?: string;
      currentFingerprint: string;
    };
    budgetCompetition?: Record<string, unknown>;
    compression?: {
      appliedCount: number;
      skippedCount: number;
      failedCount: number;
      totalSavedTokensEstimate: number;
      bySource?: Record<string, { applied: number; savedTokens: number }>;
    };
    attachmentCompression?: {
      appliedCount: number;
      totalSavedChars: number;
      totalSavedCharsPositive: boolean;
      bySource?: Record<string, { applied: number; savedChars: number }>;
    };
  };
}): void {
  const latestUsage = {
    inputTokens: Number(input.item.inputTokens ?? 0),
    outputTokens: Number(input.item.outputTokens ?? 0),
    ...(typeof input.item.providerReportedModelCalls === "number"
      ? { providerReportedModelCalls: Number(input.item.providerReportedModelCalls) }
      : {}),
    ...(typeof input.item.cacheCreationTokens === "number" ? { cacheCreationTokens: Number(input.item.cacheCreationTokens) } : {}),
    ...(typeof input.item.cacheReadTokens === "number" ? { cacheReadTokens: Number(input.item.cacheReadTokens) } : {}),
    ...(typeof input.item.cacheHitTokens === "number" ? { cacheHitTokens: Number(input.item.cacheHitTokens) } : {}),
    ...(typeof input.item.cacheMissTokens === "number" ? { cacheMissTokens: Number(input.item.cacheMissTokens) } : {}),
    ...(typeof input.item.cacheSupport === "string" ? { cacheSupport: input.item.cacheSupport } : {}),
    ...(typeof input.item.systemPromptFingerprint === "string" ? { systemPromptFingerprint: input.item.systemPromptFingerprint } : {}),
    ...(typeof input.item.structureSignature === "string" ? { structureSignature: input.item.structureSignature } : {}),
    ...(input.item.warmupCoordination && typeof input.item.warmupCoordination === "object"
      ? { warmupCoordination: input.item.warmupCoordination }
      : {}),
    ...(input.item.cacheFamilyAffinity && typeof input.item.cacheFamilyAffinity === "object"
      ? { cacheFamilyAffinity: input.item.cacheFamilyAffinity }
      : {}),
    ...(input.routeDecision && typeof input.routeDecision === "object"
      ? { deepseekRoute: input.routeDecision }
      : {}),
    ...(input.item.attachmentCompression && typeof input.item.attachmentCompression === "object"
      ? { attachmentCompression: input.item.attachmentCompression }
      : {}),
    ...(input.auxSummaryVerdict && typeof input.auxSummaryVerdict === "object"
      ? { auxSummaryVerdict: input.auxSummaryVerdict }
      : {}),
    ...(typeof input.item.inputCostUsd === "number" ? { inputCostUsd: Number(input.item.inputCostUsd) } : {}),
    ...(typeof input.item.outputCostUsd === "number" ? { outputCostUsd: Number(input.item.outputCostUsd) } : {}),
    ...(typeof input.item.cacheCreationCostUsd === "number" ? { cacheCreationCostUsd: Number(input.item.cacheCreationCostUsd) } : {}),
    ...(typeof input.item.cacheReadCostUsd === "number" ? { cacheReadCostUsd: Number(input.item.cacheReadCostUsd) } : {}),
    ...(typeof input.item.cacheSavingsUsd === "number" ? { cacheSavingsUsd: Number(input.item.cacheSavingsUsd) } : {}),
    ...(typeof input.item.totalCostUsd === "number" ? { totalCostUsd: Number(input.item.totalCostUsd) } : {}),
    ...(input.item.usageCalibration && typeof input.item.usageCalibration === "object"
      ? { usageCalibration: input.item.usageCalibration }
      : {}),
    ...(input.item.providerRawUsage && typeof input.item.providerRawUsage === "object"
      ? { providerRawUsage: input.item.providerRawUsage }
      : {}),
    ...(input.item.requestShape && typeof input.item.requestShape === "object"
      ? { requestShape: input.item.requestShape }
      : {}),
    ...(input.item.localPromptEstimate && typeof input.item.localPromptEstimate === "object"
      ? { localPromptEstimate: input.item.localPromptEstimate }
      : {}),
    ...(input.item.prefixShape && typeof input.item.prefixShape === "object"
      ? { prefixShape: input.item.prefixShape }
      : {}),
    ...(input.item.prefixDrift && typeof input.item.prefixDrift === "object"
      ? { prefixDrift: input.item.prefixDrift }
      : {}),
    ...(input.item.budgetCompetition && typeof input.item.budgetCompetition === "object"
      ? { budgetCompetition: input.item.budgetCompetition }
      : {}),
    ...(input.item.compression && typeof input.item.compression === "object"
      ? { compression: input.item.compression }
      : {}),
  };
  input.state.run.setLatestUsage(latestUsage);

  input.ctx.io.sendEvent(input.ctx.request.ws, {
    type: "event",
    event: "token.usage",
    payload: {
      conversationId: input.conversationId,
      runId: input.runId,
      systemPromptTokens: input.item.systemPromptTokens,
      contextTokens: input.item.contextTokens,
      inputTokens: input.item.inputTokens,
      outputTokens: input.item.outputTokens,
      cacheCreationTokens: input.item.cacheCreationTokens,
      cacheReadTokens: input.item.cacheReadTokens,
      ...(typeof input.item.cacheHitTokens === "number" ? { cacheHitTokens: input.item.cacheHitTokens } : {}),
      ...(typeof input.item.cacheMissTokens === "number" ? { cacheMissTokens: input.item.cacheMissTokens } : {}),
      modelCalls: input.item.modelCalls,
      ...(typeof input.item.providerReportedModelCalls === "number"
        ? { providerReportedModelCalls: input.item.providerReportedModelCalls }
        : {}),
      ...(typeof input.item.cacheSupport === "string" ? { cacheSupport: input.item.cacheSupport } : {}),
      ...(typeof input.item.systemPromptFingerprint === "string" ? { systemPromptFingerprint: input.item.systemPromptFingerprint } : {}),
      ...(typeof input.item.structureSignature === "string" ? { structureSignature: input.item.structureSignature } : {}),
      ...(input.item.warmupCoordination && typeof input.item.warmupCoordination === "object"
        ? { warmupCoordination: input.item.warmupCoordination }
        : {}),
      ...(input.item.cacheFamilyAffinity && typeof input.item.cacheFamilyAffinity === "object"
        ? { cacheFamilyAffinity: input.item.cacheFamilyAffinity }
        : {}),
      ...(input.routeDecision && typeof input.routeDecision === "object"
        ? { deepseekRoute: input.routeDecision }
        : {}),
      ...(input.item.attachmentCompression && typeof input.item.attachmentCompression === "object"
        ? { attachmentCompression: input.item.attachmentCompression }
        : {}),
      ...(input.auxSummaryVerdict && typeof input.auxSummaryVerdict === "object"
        ? { auxSummaryVerdict: input.auxSummaryVerdict }
        : {}),
      ...(typeof input.item.inputCostUsd === "number" ? { inputCostUsd: input.item.inputCostUsd } : {}),
      ...(typeof input.item.outputCostUsd === "number" ? { outputCostUsd: input.item.outputCostUsd } : {}),
      ...(typeof input.item.cacheCreationCostUsd === "number" ? { cacheCreationCostUsd: input.item.cacheCreationCostUsd } : {}),
      ...(typeof input.item.cacheReadCostUsd === "number" ? { cacheReadCostUsd: input.item.cacheReadCostUsd } : {}),
      ...(typeof input.item.cacheSavingsUsd === "number" ? { cacheSavingsUsd: input.item.cacheSavingsUsd } : {}),
      ...(typeof input.item.totalCostUsd === "number" ? { totalCostUsd: input.item.totalCostUsd } : {}),
      ...(input.item.usageCalibration && typeof input.item.usageCalibration === "object"
        ? { usageCalibration: input.item.usageCalibration }
        : {}),
      ...(input.item.providerRawUsage && typeof input.item.providerRawUsage === "object"
        ? { providerRawUsage: input.item.providerRawUsage }
        : {}),
      ...(input.item.requestShape && typeof input.item.requestShape === "object"
        ? { requestShape: input.item.requestShape }
        : {}),
      ...(input.item.localPromptEstimate && typeof input.item.localPromptEstimate === "object"
        ? { localPromptEstimate: input.item.localPromptEstimate }
        : {}),
      ...(input.item.prefixShape && typeof input.item.prefixShape === "object"
        ? { prefixShape: input.item.prefixShape }
        : {}),
      ...(input.item.prefixDrift && typeof input.item.prefixDrift === "object"
        ? { prefixDrift: input.item.prefixDrift }
        : {}),
      ...(input.item.budgetCompetition && typeof input.item.budgetCompetition === "object"
        ? { budgetCompetition: input.item.budgetCompetition }
        : {}),
      ...(input.item.compression && typeof input.item.compression === "object"
        ? { compression: input.item.compression }
        : {}),
    },
  });

  let lastUploadedUsageTotal = input.state.usageUpload.getLastUploadedUsageTotal();
  if (input.ctx.effects.tokenUsageUploadConfig.enabled && input.effectiveUserUuid) {
    const usageTotal = Math.max(0, Number(input.item.inputTokens ?? 0) + Number(input.item.outputTokens ?? 0));
    const deltaTokens = Math.max(0, usageTotal - lastUploadedUsageTotal);
    if (usageTotal > lastUploadedUsageTotal) {
      lastUploadedUsageTotal = usageTotal;
    }
    if (deltaTokens > 0) {
      void uploadTokenUsage({
        config: input.ctx.effects.tokenUsageUploadConfig,
        userUuid: input.effectiveUserUuid,
        conversationId: input.conversationId,
        source: input.from ?? "webchat",
        deltaTokens,
        log: input.ctx.runtime.log,
      });
    }
  }
  input.state.usageUpload.setLastUploadedUsageTotal(lastUploadedUsageTotal);
}

function createMessageSendStreamAdapter(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  conversationId: string;
  runId: string;
  agentId: string;
  effectiveUserUuid?: string;
  from?: string;
  isTts: boolean;
  state: MessageSendBackgroundRunState;
  routeDecision?: {
    requestedRoute?: string;
    effectiveModelId?: string;
    selectedTier?: "flash" | "pro";
    routeMode?: "passthrough" | "deepseek_virtual";
    degraded?: boolean;
    reason?: string;
    tierPinning?: {
      pinned?: boolean;
      previousTier?: "flash" | "pro";
      reason?: string;
    };
  };
}): {
  handlers: {
    onStatus: (item: { status: string; code?: string; error?: string }) => void;
    onBudgetExhausted: (item: QueryRuntimeAgentBudgetExhausted) => void;
    onToolCall: (item: { id: string; name: string; arguments?: unknown }) => void;
    onToolResult: (item: { id: string; name: string; success: boolean; output?: unknown; error?: string; failureKind?: string; metadata?: unknown }) => void;
    onToolEvent: (detail: Record<string, unknown>) => void;
    onDelta: (item: { delta: string }) => void;
    onUsage: (item: {
      systemPromptTokens: number;
      contextTokens: number;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      cacheHitTokens?: number;
      cacheMissTokens?: number;
      modelCalls: number;
      providerReportedModelCalls?: number;
      cacheSupport?: "supported" | "unsupported" | "unknown";
      systemPromptFingerprint?: string;
      structureSignature?: string;
      warmupCoordination?: {
        eligible?: boolean;
        status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
        recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
        reason?: string;
        previousAgeMs?: number;
      };
      cacheFamilyAffinity?: {
        status?: "unknown" | "aligned" | "mismatch";
        familyKey?: string;
        previousFamilyKey?: string;
        reason?: string;
      };
      inputCostUsd?: number;
      outputCostUsd?: number;
      cacheCreationCostUsd?: number;
      cacheReadCostUsd?: number;
      cacheSavingsUsd?: number;
      totalCostUsd?: number;
      usageCalibration?: {
        estimatedPromptTokens: number;
        actualInputTokens: number;
        modelCalls: number;
        averageInputTokensPerCall: number;
        deltaTokens: number;
        deltaRatio: number;
        status?: "aligned" | "under_estimated" | "over_estimated";
      };
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
      requestShape?: {
        messageCount: number;
        systemMessageCount: number;
        toolSchemaCount: number;
      };
      localPromptEstimate?: {
        systemPromptTokens: number;
        contextTokens: number;
        totalPromptTokens: number;
      };
      attachmentCompression?: {
        appliedCount: number;
        totalSavedChars: number;
        totalSavedCharsPositive: boolean;
        bySource?: Record<string, { applied: number; savedChars: number }>;
      };
    }) => void;
  };
} {
  return {
    handlers: {
      onStatus: (item) => {
        input.ctx.io.sendEvent(input.ctx.request.ws, {
          type: "event",
          event: "agent.status",
          payload: {
            agentId: input.agentId,
            conversationId: input.conversationId,
            runId: input.runId,
            status: item.status,
            ...(item.code ? { code: item.code } : {}),
            ...(item.error ? { error: item.error } : {}),
          },
        });
      },
      onToolCall: (item) => {
        input.queryRuntime.mark("tool_call_emitted", {
          conversationId: input.conversationId,
          detail: {
            toolName: item.name,
          },
        });
        input.ctx.io.sendEvent(input.ctx.request.ws, {
          type: "event",
          event: "tool_call",
          payload: {
            conversationId: input.conversationId,
            runId: input.runId,
            id: item.id,
            name: item.name,
            arguments: item.arguments,
          },
        });
      },
      onToolResult: (item) => {
        const acceptanceGateStatus = readToolResultAcceptanceGateStatus(item.metadata);
        const acceptanceGateConfidence = readToolResultAcceptanceGateConfidence(item.metadata);
        const followUpRuntimeAction = readToolResultFollowUpRuntimeAction(item.metadata);
        const followUpHighPriorityLabels = readToolResultFollowUpHighPriorityLabels(item.metadata);
        const verifierHandoffSuggested = readToolResultVerifierHandoffSuggested(item.metadata);
        const planLifecycleAction = readPlanLifecycleString(item.metadata, "action");
        const planStatus = readPlanLifecycleString(item.metadata, "status");
        const planId = readPlanLifecycleString(item.metadata, "planId");
        const previousPlanId = readPlanLifecycleString(item.metadata, "previousPlanId");
        const operationTypes = readPlanLifecycleMetadata(item.metadata)?.operationTypes;
        const enteredPlanMode = readPlanLifecycleBoolean(item.metadata, "enteredPlanMode");
        const switchedCurrentPlan = readPlanLifecycleBoolean(item.metadata, "switchedCurrentPlan");
        const retainedTerminalSnapshot = readPlanLifecycleBoolean(item.metadata, "retainedTerminalSnapshot");
        input.queryRuntime.mark("tool_result_emitted", {
          conversationId: input.conversationId,
          detail: {
            toolName: item.name,
            success: item.success,
            hasError: Boolean(item.error),
            ...(item.failureKind ? { failureKind: item.failureKind } : {}),
            ...(acceptanceGateStatus ? { acceptanceGateStatus } : {}),
            ...(acceptanceGateConfidence ? { acceptanceGateConfidence } : {}),
            ...(followUpRuntimeAction ? { followUpRuntimeAction } : {}),
            ...(followUpHighPriorityLabels ? { followUpHighPriorityLabels } : {}),
            ...(verifierHandoffSuggested ? { verifierHandoffSuggested } : {}),
            ...(planLifecycleAction ? { planLifecycleAction } : {}),
            ...(planStatus ? { planStatus } : {}),
            ...(planId ? { planId } : {}),
            ...(previousPlanId ? { previousPlanId } : {}),
            ...(Array.isArray(operationTypes) && operationTypes.length > 0
              ? {
                planOperationTypes: operationTypes
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .map((value) => value.trim())
                  .join(", "),
              }
              : {}),
            ...(typeof enteredPlanMode === "boolean" ? { enteredPlanMode } : {}),
            ...(typeof switchedCurrentPlan === "boolean" ? { switchedCurrentPlan } : {}),
            ...(typeof retainedTerminalSnapshot === "boolean" ? { retainedTerminalSnapshot } : {}),
          },
        });
        input.ctx.io.sendEvent(input.ctx.request.ws, {
          type: "event",
          event: "tool_result",
          payload: {
            conversationId: input.conversationId,
            runId: input.runId,
            id: item.id,
            name: item.name,
            success: item.success,
            output: projectToolResultEventOutput(item.output, input.ctx.io.toolResultEventOutputCharLimit),
            ...(item.error ? { error: item.error } : {}),
            ...(item.failureKind ? { failureKind: item.failureKind } : {}),
            ...(sanitizeToolResultEventMetadata(item.metadata) ? { metadata: sanitizeToolResultEventMetadata(item.metadata) } : {}),
          },
        });
      },
      onToolEvent: (detail) => {
        input.queryRuntime.mark("tool_event_emitted", {
          conversationId: input.conversationId,
          detail,
        });
        input.ctx.io.sendEvent(input.ctx.request.ws, {
          type: "event",
          event: "tool_event",
          payload: {
            conversationId: input.conversationId,
            runId: input.runId,
            ...(isJsonObjectRecord(detail) ? detail : {}),
          },
        });
      },
      onDelta: (item) => {
        if (!input.isTts) {
          input.ctx.io.sendEvent(input.ctx.request.ws, {
            type: "event",
            event: "chat.delta",
            payload: {
              conversationId: input.conversationId,
              runId: input.runId,
              delta: item.delta,
            },
          });
        }
      },
      onUsage: (item) => {
        const attachmentCompression = readAttachmentCompressionFromRunMeta(input.state.run.getRunMeta?.());
        handleMessageSendUsageEvent({
          ctx: input.ctx,
          conversationId: input.conversationId,
          runId: input.runId,
          effectiveUserUuid: input.effectiveUserUuid,
          from: input.from,
          state: input.state,
          routeDecision: input.routeDecision,
          item: {
            ...item,
            ...(attachmentCompression ? { attachmentCompression } : {}),
          },
        });
      },
      onBudgetExhausted: (item) => {
        input.ctx.io.sendEvent(input.ctx.request.ws, {
          type: "event",
          event: "agent.budget_exhausted",
          payload: {
            agentId: input.agentId,
            conversationId: input.conversationId,
            runId: input.runId,
            budget: item.budget,
            limit: item.limit,
            observed: item.observed,
            ...(item.policyId ? { policyId: item.policyId } : {}),
            ...(item.stage ? { stage: item.stage } : {}),
            ...(item.reasonCode ? { reasonCode: item.reasonCode } : {}),
          },
        });
      },
    },
  };
}

function scheduleMessageSendDigestRefresh(input: {
  ctx: MessageSendQueryRuntimeContext;
  conversationId: string;
  source: string;
  warningMessage: string;
}): void {
  void input.ctx.effects.refreshConversationDigestAndBroadcast(
    input.ctx.runtime.conversationStore,
    {
      conversationId: input.conversationId,
      source: input.source,
    },
    input.ctx.io.broadcastEvent,
    input.ctx.effects.durableExtractionRuntime,
    input.ctx.effects.requestDurableExtraction,
    input.ctx.effects.memoryUsageAccounting,
    input.ctx.effects.memoryBudgetGuard,
  ).catch((error) => {
    input.ctx.runtime.log.warn("conversation.digest", input.warningMessage, {
      conversationId: input.conversationId,
      error: String(error),
    });
  });
}

function sanitizeMessageSendAssistantText(text: string): string {
  return sanitizeVisibleAssistantText(text)
    .replace(/<audio[^>]*>.*?<\/audio>/gi, "")
    .replace(/\[Download\]\([^)]*\/generated\/[^)]*\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emitMessageSendFinalFrame(input: {
  ctx: MessageSendQueryRuntimeContext;
  conversationId: string;
  runId: string;
  agentId: string;
  text: string;
  timestampMs: number;
}): void {
  input.ctx.runtime.log.debug("message", "Emitting chat.final", {
    conversationId: input.conversationId,
    runId: input.runId,
    agentId: input.agentId,
    textLength: input.text.length,
    timestampMs: input.timestampMs,
  });
  input.ctx.io.sendEvent(input.ctx.request.ws, {
    type: "event",
    event: "chat.final",
    payload: {
      agentId: input.agentId,
      conversationId: input.conversationId,
      runId: input.runId,
      role: "assistant",
      text: input.text,
      messageMeta: input.ctx.io.toChatMessageMeta(input.timestampMs, true),
    },
  });
}

function emitMessageSendStoppedFrame(input: {
  ctx: MessageSendQueryRuntimeContext;
  conversationId: string;
  runId: string;
  agentId: string;
  reason: string;
  hadPartialResponse: boolean;
}): void {
  input.ctx.io.sendEvent(input.ctx.request.ws, {
    type: "event",
    event: "conversation.run.stopped",
    payload: {
      agentId: input.agentId,
      conversationId: input.conversationId,
      runId: input.runId,
      reason: input.reason,
      hadPartialResponse: input.hadPartialResponse,
    },
  });
}

function readMessageSendStopReason(signal?: AbortSignal, fallback?: unknown): string {
  if (typeof signal?.reason === "string" && signal.reason.trim()) {
    return signal.reason.trim();
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  if (fallback instanceof Error && fallback.message.trim()) {
    return fallback.message.trim();
  }
  return "Stopped by user.";
}

function wasMessageSendStopped(input: {
  abortSignal?: AbortSignal;
  runResult?: MessageSendRunResult;
  error?: unknown;
}): boolean {
  return Boolean(
    input.abortSignal?.aborted
    || input.runResult?.latestStatus === "stopped"
    || (input.error instanceof Error && input.error.name === "AbortError"),
  );
}

function isMessageSendAgentRunFailed(runResult: MessageSendRunResult): boolean {
  return Boolean(runResult.interrupted || runResult.budgetExhausted || runResult.latestStatus === "error");
}

function applyMessageSendCompletionPolicy(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  policy: MessageSendCompletionPolicy;
}): void {
  const { ctx, queryRuntime, policy } = input;

  if (policy.statusBeforeFinal) {
    ctx.io.sendEvent(ctx.request.ws, {
      type: "event",
      event: "agent.status",
      payload: {
        agentId: policy.agentId,
        conversationId: policy.conversationId,
        runId: policy.runId,
        status: policy.statusBeforeFinal,
      },
    });
  }

  if (policy.assistantPersistedDetail) {
    queryRuntime.mark("assistant_persisted", {
      conversationId: policy.conversationId,
      detail: policy.assistantPersistedDetail,
    });
  }

  queryRuntime.mark(policy.terminalStage, {
    conversationId: policy.conversationId,
    detail: policy.terminalDetail,
  });

  emitMessageSendFinalFrame({
    ctx,
      conversationId: policy.conversationId,
      runId: policy.runId,
      agentId: policy.agentId,
      text: policy.finalText,
      timestampMs: policy.finalTimestampMs,
    });

  scheduleMessageSendDigestRefresh({
    ctx,
    conversationId: policy.conversationId,
    source: policy.digestSource,
    warningMessage: policy.digestWarningMessage,
  });
}

async function finalizeMessageSendSuccess(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  conversationId: string;
  runId: string;
  abortController: AbortController;
  requestedAgentId?: string;
  runResult: MessageSendRunResult;
  state: MessageSendBackgroundRunState;
}): Promise<void> {
  const { ctx, queryRuntime, runResult } = input;
  ctx.runtime.log.debug("message", "message.send run completed", {
    conversationId: input.conversationId,
    runId: input.runId,
    agentId: input.requestedAgentId ?? "default",
    durationMs: runResult.durationMs,
    receivedFinal: runResult.receivedFinal,
    latestStatus: runResult.latestStatus ?? null,
    fullTextLength: runResult.fullText.length,
    finalTextLength: runResult.finalText.length,
    toolCallCount: runResult.toolCallCount,
    toolResultCount: runResult.toolResultCount,
    toolEventCount: runResult.toolEventCount,
    statusCount: runResult.statusCount,
    deltaCount: runResult.deltaCount,
  });
  if (wasMessageSendStopped({
    abortSignal: input.abortController.signal,
    runResult,
  })) {
    consumeAutoTaskReport(input.conversationId);
    finalizeMessageSendStopped({
      ctx,
      queryRuntime,
      conversationId: input.conversationId,
      runId: input.runId,
      requestedAgentId: input.requestedAgentId,
      partialText: runResult.fullText,
      reason: readMessageSendStopReason(input.abortController.signal),
    });
    return;
  }
  if (runResult.interrupted) {
    finalizeMessageSendInterrupted({
      ctx,
      queryRuntime,
      conversationId: input.conversationId,
      runId: input.runId,
      requestedAgentId: input.requestedAgentId,
      interrupted: runResult.interrupted,
    });
    return;
  }
  if (isMessageSendAgentRunFailed(runResult)) {
    consumeAutoTaskReport(input.conversationId);
    finalizeMessageSendAgentRunFailure({
      ctx,
      queryRuntime,
      conversationId: input.conversationId,
      runId: input.runId,
      requestedAgentId: input.requestedAgentId,
      runResult,
    });
    return;
  }
  let finalEventText = runResult.fullText;

  if ((ctx.media.ttsEnabled?.() ?? false) && runResult.fullText && ctx.media.ttsSynthesize) {
    ctx.io.sendEvent(ctx.request.ws, {
      type: "event",
      event: "agent.status",
      payload: {
        conversationId: input.conversationId,
        runId: input.runId,
        status: "generating_audio",
      },
    });
    const ttsResult = await ctx.media.ttsSynthesize(runResult.fullText);
    if (ttsResult) {
      finalEventText = ttsResult.htmlAudio + "\n\n" + runResult.fullText;
    }
  }

  if (!runResult.receivedFinal) {
    consumeAutoTaskReport(input.conversationId);
    input.state.run.setReceivedFinal(false);
    ctx.runtime.log.debug("message", "message.send completed without final item", {
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.requestedAgentId ?? "default",
      latestStatus: runResult.latestStatus ?? null,
      fullTextLength: runResult.fullText.length,
      toolCallCount: runResult.toolCallCount,
      toolResultCount: runResult.toolResultCount,
    });
    queryRuntime.mark("completed", {
      conversationId: input.conversationId,
      detail: {
        receivedFinal: false,
        ...(runResult.latestUsage?.usageCalibration ? { usageCalibration: runResult.latestUsage.usageCalibration } : {}),
      },
    });
    return;
  }
  input.state.run.setReceivedFinal(true);
  const autoTaskReport = resolveAutoTaskReportForOutput({
    conversationId: input.conversationId,
    durationMs: runResult.durationMs,
    inputTokens: runResult.latestUsage?.inputTokens,
    outputTokens: runResult.latestUsage?.outputTokens,
  });

  const sanitized = sanitizeMessageSendAssistantText(runResult.fullText);
  const assistantText = appendAutoTaskReport(sanitized || runResult.fullText, autoTaskReport);
  const completionFinalText = appendAutoTaskReport(
    sanitizeVisibleAssistantText(finalEventText || runResult.fullText),
    autoTaskReport,
  );
  let assistantTimestamp = Date.now();
  if (assistantText) {
    const assistantMessage = ctx.runtime.conversationStore.addMessage(
      input.conversationId,
      "assistant",
      assistantText,
      {
        agentId: input.requestedAgentId,
        timestampMs: assistantTimestamp,
      },
    );
    assistantTimestamp = assistantMessage.timestamp;
    await ctx.runtime.conversationStore.waitForPendingPersistence(input.conversationId);
    ctx.runtime.log.debug("message", "Assistant message persisted for message.send", {
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.requestedAgentId ?? "default",
      assistantTimestampMs: assistantTimestamp,
      sanitizedLength: sanitized.length,
      rawLength: runResult.fullText.length,
    });
  } else {
    ctx.runtime.log.debug("message", "message.send finalized without assistant persistence", {
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.requestedAgentId ?? "default",
      rawLength: runResult.fullText.length,
      sanitizedLength: sanitized.length,
    });
  }

  applyMessageSendCompletionPolicy({
    ctx,
    queryRuntime,
    policy: {
      conversationId: input.conversationId,
      runId: input.runId,
      finalText: completionFinalText,
      finalTimestampMs: assistantTimestamp,
      terminalStage: "completed",
      terminalDetail: {
        receivedFinal: input.state.run.hasReceivedFinal(),
        response: "assistant_finalized",
        ...(runResult.latestUsage?.usageCalibration ? { usageCalibration: runResult.latestUsage.usageCalibration } : {}),
      },
      statusBeforeFinal: "done",
      agentId: input.requestedAgentId ?? "default",
      assistantPersistedDetail: {
        assistantTimestampMs: assistantTimestamp,
        receivedFinal: input.state.run.hasReceivedFinal(),
      },
      digestSource: "message.send",
      digestWarningMessage: "Auto refresh after message.send failed",
    },
  });
}

function finalizeMessageSendStopped(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  conversationId: string;
  runId: string;
  requestedAgentId?: string;
  partialText?: string;
  reason?: string;
}): void {
  consumeAutoTaskReport(input.conversationId);
  const stopReason = readMessageSendStopReason(undefined, input.reason);
  input.ctx.runtime.conversationRunRegistry.markStopped(input.conversationId, input.runId, stopReason);
  input.queryRuntime.mark("task_stopped", {
    conversationId: input.conversationId,
    detail: {
      runId: input.runId,
      hadPartialResponse: Boolean(input.partialText),
      reason: stopReason,
    },
  });
  input.queryRuntime.mark("completed", {
    conversationId: input.conversationId,
    detail: {
      runId: input.runId,
      response: "stopped",
      hadPartialResponse: Boolean(input.partialText),
    },
  });
  input.ctx.io.sendEvent(input.ctx.request.ws, {
    type: "event",
    event: "agent.status",
    payload: {
      agentId: input.requestedAgentId ?? "default",
      conversationId: input.conversationId,
      runId: input.runId,
      status: "stopped",
    },
  });
  emitMessageSendStoppedFrame({
    ctx: input.ctx,
    conversationId: input.conversationId,
    runId: input.runId,
    agentId: input.requestedAgentId ?? "default",
    reason: stopReason,
    hadPartialResponse: Boolean(input.partialText),
  });
  scheduleMessageSendDigestRefresh({
    ctx: input.ctx,
    conversationId: input.conversationId,
    source: "message.stop",
    warningMessage: "Auto refresh after message stop failed",
  });
}

function finalizeMessageSendInterrupted(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  conversationId: string;
  runId: string;
  requestedAgentId?: string;
  interrupted: NonNullable<MessageSendRunResult["interrupted"]>;
}): void {
  consumeAutoTaskReport(input.conversationId);
  const hadPartialResponse = Boolean(input.interrupted.partialText);
  input.ctx.runtime.log.warn("agent", "Agent provider stream was interrupted after commit", {
    conversationId: input.conversationId,
    runId: input.runId,
    reason: input.interrupted.reason,
    code: input.interrupted.code ?? null,
    hadPartialResponse,
  });
  input.queryRuntime.mark("failed", {
    conversationId: input.conversationId,
    detail: {
      runId: input.runId,
      error: input.interrupted.error,
      reason: input.interrupted.reason,
      source: "provider_stream",
      hadPartialResponse,
      ...(input.interrupted.code ? { code: input.interrupted.code } : {}),
    },
  });
  input.ctx.io.sendEvent(input.ctx.request.ws, {
    type: "event",
    event: "agent.status",
    payload: {
      agentId: input.requestedAgentId ?? "default",
      conversationId: input.conversationId,
      runId: input.runId,
      status: "error",
    },
  });
  emitMessageSendInterruptedFrame({
    ctx: input.ctx,
    conversationId: input.conversationId,
    runId: input.runId,
    agentId: input.requestedAgentId ?? "default",
    reason: input.interrupted.reason,
    error: input.interrupted.error,
    code: input.interrupted.code,
    hadPartialResponse,
  });
  scheduleMessageSendDigestRefresh({
    ctx: input.ctx,
    conversationId: input.conversationId,
    source: "message.agent_interrupted",
    warningMessage: "Auto refresh after agent stream interruption failed",
  });
}

function finalizeMessageSendFailure(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  conversationId: string;
  runId: string;
  requestedAgentId?: string;
  error: unknown;
}): void {
  input.ctx.runtime.log.error("agent", "Agent run failed", input.error);

  const errorTimestamp = Date.now();
  const autoTaskReport = resolveAutoTaskReportForOutput({
    conversationId: input.conversationId,
  });
  applyMessageSendCompletionPolicy({
    ctx: input.ctx,
    queryRuntime: input.queryRuntime,
    policy: {
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.requestedAgentId ?? "default",
      finalText: appendAutoTaskReport(`Error: ${String(input.error)}`, autoTaskReport),
      finalTimestampMs: errorTimestamp,
      statusBeforeFinal: "error",
      terminalStage: "failed",
      terminalDetail: {
        error: input.error instanceof Error ? input.error.message : String(input.error),
      },
      digestSource: "message.error",
      digestWarningMessage: "Auto refresh after message failure failed",
    },
  });
}

/** 已正常结束的 Agent 流仍可报告 error；不能让 final item 将其覆盖为 completed。 */
function finalizeMessageSendAgentRunFailure(input: {
  ctx: MessageSendQueryRuntimeContext;
  queryRuntime: QueryRuntime<"message.send">;
  conversationId: string;
  runId: string;
  requestedAgentId?: string;
  runResult: MessageSendRunResult;
}): void {
  const errorText = input.runResult.finalText || input.runResult.fullText || "Agent reported an error.";
  const budgetExhausted = input.runResult.budgetExhausted;
  const errorTimestamp = Date.now();
  input.ctx.runtime.log.warn("agent", "Agent run reached an error terminal state", {
    conversationId: input.conversationId,
    runId: input.runId,
    latestStatus: input.runResult.latestStatus ?? null,
    ...(budgetExhausted ? { budgetExhausted } : {}),
  });

  applyMessageSendCompletionPolicy({
    ctx: input.ctx,
    queryRuntime: input.queryRuntime,
    policy: {
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.requestedAgentId ?? "default",
      finalText: sanitizeVisibleAssistantText(errorText),
      finalTimestampMs: errorTimestamp,
      ...(input.runResult.latestStatus === "error" ? {} : { statusBeforeFinal: "error" }),
      terminalStage: "failed",
      terminalDetail: {
        error: errorText,
        source: "agent_stream",
        ...(input.runResult.latestStatus ? { latestStatus: input.runResult.latestStatus } : {}),
        ...(budgetExhausted ? { budgetExhausted } : {}),
      },
      digestSource: "message.agent_error",
      digestWarningMessage: "Auto refresh after agent stream failure failed",
    },
  });
}

function emitMessageSendInterruptedFrame(input: {
  ctx: MessageSendQueryRuntimeContext;
  conversationId: string;
  runId: string;
  agentId: string;
  reason: string;
  error: string;
  code?: string;
  hadPartialResponse: boolean;
}): void {
  input.ctx.io.sendEvent(input.ctx.request.ws, {
    type: "event",
    event: "conversation.run.interrupted",
    payload: {
      agentId: input.agentId,
      conversationId: input.conversationId,
      runId: input.runId,
      reason: input.reason,
      error: input.error,
      ...(input.code ? { code: input.code } : {}),
      hadPartialResponse: input.hadPartialResponse,
    },
  });
}

async function runAgentInBackground(input: MessageSendBackgroundInput): Promise<void> {
  const { ctx, queryRuntime } = input;
  const state = createMessageSendBackgroundRunState();

  try {
    queryRuntime.mark("agent_running", {
      conversationId: input.conversationId,
      detail: {
        historyLength: input.history.length,
      },
    });
    ctx.runtime.residentAgentRuntime?.markStatus(input.requestedAgentId ?? "default", "running");
    ctx.runtime.residentAgentRuntime?.touchConversation(input.requestedAgentId ?? "default", input.conversationId);

    const projectRulesDelta = await buildProjectRulesPromptDelta(input.codingRun);
    const runInput = buildMessageSendAgentRunInput({
      ...input,
      ...(projectRulesDelta
        ? { promptDeltas: [...input.promptDeltas, projectRulesDelta] }
        : {}),
    }, ctx.media);
    state.run.setRunMeta(runInput.meta && typeof runInput.meta === "object" ? runInput.meta as Record<string, unknown> : undefined);
    const isTts = ctx.media.ttsEnabled?.() ?? false;
    const streamAdapter = createMessageSendStreamAdapter({
      ctx,
      queryRuntime,
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.requestedAgentId ?? "default",
      effectiveUserUuid: input.effectiveUserUuid,
      from: input.from,
      isTts,
      state,
      routeDecision: input.routeDecision,
    });
    const runResult = await runAgentWithLifecycle(input.agent, {
      conversationId: input.conversationId,
      runInput,
      onStatus: streamAdapter.handlers.onStatus,
      onBudgetExhausted: streamAdapter.handlers.onBudgetExhausted,
      onToolEvent: streamAdapter.handlers.onToolEvent,
      onToolCall: streamAdapter.handlers.onToolCall,
      onToolResult: streamAdapter.handlers.onToolResult,
      onDelta: streamAdapter.handlers.onDelta,
      onUsage: streamAdapter.handlers.onUsage,
      onFailed: (detail) => {
        emitMessageSendTaskResult({
          ctx,
          queryRuntime,
          conversationId: input.conversationId,
          durationMs: detail.durationMs,
          state,
        });
      },
    });

    state.run.setReceivedFinal(runResult.receivedFinal);
    emitMessageSendTaskResult({
      ctx,
      queryRuntime,
      conversationId: input.conversationId,
      durationMs: runResult.durationMs,
      state,
    });

    const agentRunFailed = isMessageSendAgentRunFailed(runResult);
    await finalizeMessageSendSuccess({
      ctx,
      queryRuntime,
      conversationId: input.conversationId,
      runId: input.runId,
      abortController: input.abortController,
      requestedAgentId: input.requestedAgentId,
      runResult,
      state,
    });
    ctx.runtime.residentAgentRuntime?.markStatus(input.requestedAgentId ?? "default", agentRunFailed ? "error" : "idle");
  } catch (error) {
    if (wasMessageSendStopped({
      abortSignal: input.abortController.signal,
      error,
    })) {
      finalizeMessageSendStopped({
        ctx,
        queryRuntime,
        conversationId: input.conversationId,
        runId: input.runId,
        requestedAgentId: input.requestedAgentId,
        reason: readMessageSendStopReason(input.abortController.signal, error),
      });
      ctx.runtime.residentAgentRuntime?.markStatus(input.requestedAgentId ?? "default", "idle");
    } else {
      ctx.runtime.residentAgentRuntime?.markStatus(input.requestedAgentId ?? "default", "error");
      finalizeMessageSendFailure({
        ctx,
        queryRuntime,
        conversationId: input.conversationId,
        runId: input.runId,
        requestedAgentId: input.requestedAgentId,
        error,
      });
    }
  } finally {
    ctx.runtime.pendingToolPermissionRuntime?.cancelRun(input.runId);
    const reconciliationDurable = ctx.runtime.codingRunEventBroker?.isReconciliationDurable({
      conversationId: input.conversationId,
      agentRunId: input.runId,
    }) ?? true;
    if (reconciliationDurable) {
      await settleConversationRecoveryMarker({
        runtime: ctx.runtime,
        conversationId: input.conversationId,
        runId: input.runId,
      });
    } else {
      ctx.runtime.log.warn("coding-run", "Conversation recovery marker remains active because reconciliation journal persistence failed.", {
        conversationId: input.conversationId,
        runId: input.runId,
      });
    }
    ctx.runtime.conversationRunRegistry.clear(input.conversationId, input.runId);
    if (input.capabilitySnapshotOwned) {
      ctx.runtime.taskCapabilityClosureResolver?.release?.(createConversationTaskCapabilityClosureBinding({
        conversationId: input.conversationId,
        agentRunId: input.runId,
      }));
    }
    await handOffConversationFollowUp(input);
  }
}

async function settleConversationRecoveryMarker(input: {
  runtime: Pick<MessageSendQueryRuntimeContext["runtime"], "log" | "conversationRunRegistry" | "codingRunEventBroker">;
  conversationId: string;
  runId: string;
}): Promise<boolean> {
  let settled = false;
  try {
    settled = await input.runtime.conversationRunRegistry
      .settleRecoveryMarker(input.conversationId, input.runId);
  } catch (error) {
    input.runtime.log.warn("coding-run", "Failed to settle Conversation recovery marker.", {
      conversationId: input.conversationId,
      runId: input.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  if (!settled) return false;

  await input.runtime.codingRunEventBroker
    ?.removeReconciliationEvidence({
      conversationId: input.conversationId,
      agentRunId: input.runId,
    })
    .catch((error) => {
      input.runtime.log.warn("coding-run", "Failed to remove settled Conversation reconciliation evidence.", {
        conversationId: input.conversationId,
        runId: input.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
}

async function handOffConversationFollowUp(input: MessageSendBackgroundInput): Promise<void> {
  const { ctx } = input;
  const completedBinding: ConversationRunBinding = {
    conversationId: input.conversationId,
    agentRunId: input.runId,
  };
  const queueBindings = input.followUpQueueBinding
    && input.followUpQueueBinding.agentRunId !== completedBinding.agentRunId
    ? [input.followUpQueueBinding, completedBinding]
    : [completedBinding];
  let claim: ConversationFollowUpClaim | undefined;
  for (const binding of queueBindings) {
    claim = ctx.runtime.conversationRunRegistry.claimNextFollowUp(binding);
    if (claim) break;
  }

  await input.lifecycleLease?.release();
  if (!claim) return;

  try {
    const params: MessageSendParams = {
      ...ctx.request.params,
      conversationId: input.conversationId,
      text: claim.prompt,
      autoStopPreviousRun: false,
    };
    delete params.attachments;
    const response = await handleMessageSendWithQueryRuntime({
      ...ctx,
      request: {
        ...ctx.request,
        requestId: `${ctx.request.requestId}:follow-up:${claim.commandId}`,
        params,
        followUpClaim: claim,
      },
    });
    if (!response.ok) {
      throw new Error(response.error?.code ?? "follow_up_start_failed");
    }
  } catch {
    const failureMessage = "Conversation follow-up could not start a serial Agent run.";
    ctx.runtime.conversationRunRegistry.markFollowUpFailed(claim, failureMessage);
    for (const binding of queueBindings) {
      ctx.runtime.conversationRunRegistry.failRemainingFollowUps(binding, failureMessage);
    }
    ctx.runtime.log.warn("coding-run", "Conversation follow-up handoff failed.", {
      conversationId: input.conversationId,
      sourceRunId: claim.queueBinding.agentRunId,
      commandId: claim.commandId,
      errorCode: "follow_up_start_failed",
    });
  }
}
