import type {
  ChatMessageMeta,
  ConversationRunStopParams,
  GatewayEventFrame,
  GatewayReqFrame,
  GatewayResFrame,
  MessageSendParams,
  TokenUsageUploadConfig,
} from "@belldandy/protocol";
import type { WebSocket } from "ws";

import type { DurableExtractionDigestSnapshot, DurableExtractionRecord, DurableExtractionRuntime } from "@belldandy/memory";
import type { ConversationStore } from "@belldandy/agent";
import type { MemoryRuntimeBudgetGuard, MemoryRuntimeUsageAccounting } from "../memory-runtime-budget.js";
import {
  MessageSendConfigurationError,
  handleConversationRunStopWithQueryRuntime,
  handleMessageSendWithQueryRuntime,
} from "../query-runtime-message-send.js";
import { ensureResidentAgentSession } from "../query-runtime-agent-sessions.js";
import { resolveModelMediaCapabilities } from "../media-capability-registry.js";
import { tryApproveToolControlPasswordInput } from "../tool-control-policy.js";
import { sendGatewayEvent } from "../server-websocket-runtime.js";
import type { GatewayWebSocketRequestContext } from "../server-websocket-dispatch.js";

type MessageSendMethodContext = Pick<
  GatewayWebSocketRequestContext,
  | "clientId"
  | "requestChannel"
  | "userUuid"
  | "stateDir"
  | "log"
  | "agentFactory"
  | "agentRegistry"
  | "primaryModelConfig"
  | "modelFallbacks"
  | "conversationStore"
  | "conversationRunRegistry"
  | "getConversationPromptSnapshot"
  | "durableExtractionRuntime"
  | "requestDurableExtraction"
  | "memoryUsageAccounting"
  | "memoryBudgetGuard"
  | "ttsEnabled"
  | "ttsSynthesize"
  | "toolControlConfirmationStore"
  | "getAgentToolControlMode"
  | "getAgentToolControlConfirmPassword"
  | "sttTranscribe"
  | "tokenUsageUploadConfig"
  | "broadcastEvent"
  | "queryRuntimeTraceStore"
  | "residentAgentRuntime"
  | "commanderMode"
  | "preflightCompressionPolicy"
> & {
  parseMessageSendParams: (value: unknown) => { ok: true; value: MessageSendParams } | { ok: false; message: string };
  parseConversationRunStopParams: (
    value: unknown,
  ) => { ok: true; value: ConversationRunStopParams } | { ok: false; message: string };
  getAttachmentPromptLimits: () => {
    textCharLimit: number;
    totalTextCharLimit: number;
    audioTranscriptAppendCharLimit: number;
  };
  truncateTextForPrompt: (text: string, limit: number, suffix: string) => { text: string; truncated: boolean };
  formatLocalMessageTime: (timestampMs: number) => string;
  toChatMessageMeta: (timestampMs: number, isLatest?: boolean) => ChatMessageMeta;
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
    scheduleDurableExtraction?: boolean,
  ) => Promise<{
    digest: Awaited<ReturnType<ConversationStore["refreshSessionDigest"]>>["digest"];
    updated: boolean;
    compacted: boolean;
    originalTokens?: number;
    compactedTokens?: number;
    tier?: string;
  }>;
};

export async function handleMessageSendMethod(
  req: GatewayReqFrame,
  ws: WebSocket,
  ctx: MessageSendMethodContext,
): Promise<GatewayResFrame | null> {
  if (req.method === "conversation.run.stop") {
    const parsed = ctx.parseConversationRunStopParams(req.params);
    if (!parsed.ok) {
      return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
    }
    return handleConversationRunStopWithQueryRuntime({
      request: {
        requestId: req.id,
        params: parsed.value,
      },
      runtime: {
        conversationRunRegistry: ctx.conversationRunRegistry,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"conversation.run.stop">(),
      },
    });
  }

  if (req.method !== "message.send") {
    return null;
  }

  const parsed = ctx.parseMessageSendParams(req.params);
  if (!parsed.ok) {
    return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
  }
  const resolvedAgentId = typeof parsed.value.agentId === "string" && parsed.value.agentId.trim()
    ? parsed.value.agentId.trim()
    : "default";
  const resolvedConversationId = parsed.value.conversationId?.trim()
    ? parsed.value.conversationId.trim()
    : ensureResidentAgentSession({
      agentId: resolvedAgentId,
      agentRegistry: ctx.agentRegistry,
      residentAgentRuntime: ctx.residentAgentRuntime,
      conversationStore: ctx.conversationStore,
    }).conversationId;
  ctx.residentAgentRuntime.touchConversation(resolvedAgentId, resolvedConversationId, {
    main: resolvedConversationId === ctx.residentAgentRuntime.get(resolvedAgentId).mainConversationId,
  });

  try {
    return await handleMessageSendWithQueryRuntime({
      request: {
        ws,
        requestId: req.id,
        params: {
          ...parsed.value,
          agentId: resolvedAgentId,
          conversationId: resolvedConversationId,
        },
        clientId: ctx.clientId,
        requestChannel: ctx.requestChannel,
        userUuid: ctx.userUuid,
        stateDir: ctx.stateDir,
      },
      runtime: {
        log: ctx.log,
        agentFactory: ctx.agentFactory,
        agentRegistry: ctx.agentRegistry,
        conversationStore: ctx.conversationStore,
        conversationRunRegistry: ctx.conversationRunRegistry,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"message.send">(),
        residentAgentRuntime: ctx.residentAgentRuntime,
        getConversationPromptSnapshot: ctx.getConversationPromptSnapshot,
        primaryModelConfig: ctx.primaryModelConfig,
        modelFallbacks: ctx.modelFallbacks,
        deepSeekRoutePolicyEnabled: String(process.env.BELLDANDY_DEEPSEEK_ROUTE_POLICY_ENABLED ?? "true").trim().toLowerCase() !== "false",
        commanderMode: ctx.commanderMode,
        preflightCompressionPolicy: ctx.preflightCompressionPolicy,
      },
      toolControl: {
        confirmationStore: ctx.toolControlConfirmationStore,
        getMode: ctx.getAgentToolControlMode,
        getConfirmPassword: ctx.getAgentToolControlConfirmPassword,
        tryApprovePasswordInput: tryApproveToolControlPasswordInput,
      },
      media: {
        sttTranscribe: ctx.sttTranscribe,
        ttsEnabled: ctx.ttsEnabled,
        ttsSynthesize: ctx.ttsSynthesize,
        resolveCurrentModelMediaCapabilities: ({ requestedAgentId, requestedModelId }) => {
          const currentAgentId = requestedAgentId ?? "default";
          const modelRef = typeof requestedModelId === "string" && requestedModelId.trim()
            ? requestedModelId.trim()
            : ctx.agentRegistry?.getProfile(currentAgentId)?.model;
          return resolveModelMediaCapabilities({
            modelRef,
            primaryModelConfig: ctx.primaryModelConfig,
            modelFallbacks: ctx.modelFallbacks,
          });
        },
        getAttachmentPromptLimits: ctx.getAttachmentPromptLimits,
        truncateTextForPrompt: ctx.truncateTextForPrompt,
        formatLocalMessageTime: ctx.formatLocalMessageTime,
      },
      io: {
        broadcastEvent: ctx.broadcastEvent,
        sendEvent: sendGatewayEvent,
        toChatMessageMeta: ctx.toChatMessageMeta,
      },
      effects: {
        tokenUsageUploadConfig: ctx.tokenUsageUploadConfig as TokenUsageUploadConfig,
        durableExtractionRuntime: ctx.durableExtractionRuntime,
        requestDurableExtraction: ctx.requestDurableExtraction,
        memoryUsageAccounting: ctx.memoryUsageAccounting,
        memoryBudgetGuard: ctx.memoryBudgetGuard,
        emitAutoRunTaskTokenResult: ctx.emitAutoRunTaskTokenResult,
        refreshConversationDigestAndBroadcast: ctx.refreshConversationDigestAndBroadcast,
      },
    });
  } catch (error) {
    if (error instanceof MessageSendConfigurationError) {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "config_required", message: "API Key or configuration missing." },
      };
    }
    throw error;
  }
}
