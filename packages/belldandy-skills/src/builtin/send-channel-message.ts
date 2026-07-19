import crypto from "node:crypto";

import type { JsonObject, Tool, ToolCallResult, ToolContext } from "../types.js";
import { withToolContract } from "../tool-contract.js";

export const SEND_CHANNEL_MESSAGE_TOOL_NAME = "send_channel_message";

type ExternalOutboundChannel = "feishu" | "qq" | "discord" | "community";
type ExternalOutboundResolutionMode = "explicit_session_key" | "latest_binding";

type ExternalOutboundResolveResult =
  | {
    ok: true;
    channel: ExternalOutboundChannel;
    resolution: ExternalOutboundResolutionMode;
    resolvedSessionKey: string;
    targetChatId?: string;
    targetAccountId?: string;
  }
  | {
    ok: false;
    code: string;
    message: string;
  };

type ExternalOutboundSendResult =
  | {
    ok: true;
    channel: ExternalOutboundChannel;
    resolvedSessionKey: string;
  }
  | {
    ok: false;
    code: string;
    message: string;
  };

type ExternalOutboundSenderRegistryLike = {
  resolveTarget(input: {
    channel: ExternalOutboundChannel;
    sessionKey?: string;
  }): Promise<ExternalOutboundResolveResult>;
  sendResolvedText(input: {
    channel: ExternalOutboundChannel;
    content: string;
    resolvedSessionKey: string;
    idempotencyKey?: string;
  }): Promise<ExternalOutboundSendResult>;
};

type ExternalOutboundConfirmationStoreLike = {
  create(request: {
    requestId: string;
    conversationId: string;
    requestedByAgentId?: string;
    channel: ExternalOutboundChannel;
    content: string;
    sessionKey?: string;
    resolvedSessionKey: string;
    resolution: ExternalOutboundResolutionMode;
    targetChatId?: string;
    targetAccountId?: string;
  }): {
    requestId: string;
    expiresAt: number;
  };
  cleanupExpired(): void;
};

type ExternalOutboundAuditStoreLike = {
  append(record: {
    timestamp: number;
    requestId?: string;
    sourceConversationId: string;
    sourceChannel: "webchat";
    requestedByAgentId?: string;
    targetChannel: ExternalOutboundChannel;
    requestedSessionKey?: string;
    targetSessionKey?: string;
    targetChatId?: string;
    targetAccountId?: string;
    resolution: ExternalOutboundResolutionMode;
    decision: "confirmed" | "rejected" | "auto_approved";
    delivery: "sent" | "failed" | "rejected";
    contentPreview: string;
    errorCode?: string;
    error?: string;
  }): Promise<void>;
};

export type SendChannelMessageDeps = {
  senderRegistry: ExternalOutboundSenderRegistryLike;
  confirmationStore: ExternalOutboundConfirmationStoreLike;
  auditStore: ExternalOutboundAuditStoreLike;
  getRequireConfirmation: () => boolean;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isLocalWebChatContext(context: ToolContext): boolean {
  return context.roomContext?.environment === "local";
}

function getConfirmTargetClientId(context: ToolContext): string | undefined {
  const roomContext = context.roomContext as (ToolContext["roomContext"] & { clientId?: string }) | undefined;
  return normalizeString(roomContext?.clientId) || undefined;
}

function buildPreview(value: string): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function buildSuccessOutput(input: {
  channel: ExternalOutboundChannel;
  resolution: ExternalOutboundResolutionMode;
  resolvedSessionKey: string;
  targetChatId?: string;
  targetAccountId?: string;
  pending?: boolean;
}): string {
  const lines = input.pending
    ? [
      `已创建待确认的 ${input.channel} 外发请求。`,
      "当前通道将通过 WebChat 页面确认窗口处理后续审批。",
      "不要要求用户在聊天区输入确认短语；等待页面确认结果后再继续。",
    ]
    : [`已向 ${input.channel} 发送文本消息。`];
  lines.push(`Target sessionKey: ${input.resolvedSessionKey}`);
  lines.push(`Resolution: ${input.resolution}`);
  if (input.targetChatId) {
    lines.push(`Target chat: ${input.targetChatId}`);
  }
  if (input.targetAccountId) {
    lines.push(`Target account: ${input.targetAccountId}`);
  }
  return lines.join("\n");
}

function formatOutboundErrorMessage(code: string | undefined, message: string): string {
  const normalizedCode = normalizeString(code);
  return normalizedCode ? `[${normalizedCode}] ${message}` : message;
}

async function appendResolveFailureAudit(
  deps: Pick<SendChannelMessageDeps, "auditStore">,
  context: ToolContext,
  input: {
    channel: ExternalOutboundChannel;
    content: string;
    requestedSessionKey?: string;
    code?: string;
    message: string;
  },
): Promise<void> {
  await deps.auditStore.append({
    timestamp: Date.now(),
    sourceConversationId: context.conversationId,
    sourceChannel: "webchat",
    requestedByAgentId: context.agentId,
    targetChannel: input.channel,
    requestedSessionKey: input.requestedSessionKey || undefined,
    resolution: input.requestedSessionKey ? "explicit_session_key" : "latest_binding",
    decision: "auto_approved",
    delivery: "failed",
    contentPreview: buildPreview(input.content),
    errorCode: input.code,
    error: input.message,
  });
}

export function createSendChannelMessageTool(deps: SendChannelMessageDeps): Tool {
  return withToolContract({
    definition: {
      name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
      description: "Send a text message from the current local WebChat session to an already bound external channel session. Supported channels: feishu, qq, discord, community. Text only.",
      parameters: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "目标外部渠道",
            enum: ["feishu", "qq", "discord", "community"],
          },
          content: {
            type: "string",
            description: "要发送的纯文本内容",
          },
          sessionKey: {
            type: "string",
            description: "可选。显式指定目标 canonical sessionKey；未提供时会锁定该渠道当前最新 binding。",
          },
        },
        required: ["channel", "content"],
      },
    },

    async execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
      const startedAt = Date.now();
      deps.confirmationStore.cleanupExpired();

      if (!isLocalWebChatContext(context)) {
        return {
          id: "",
          name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
          success: false,
          output: "",
          error: "send_channel_message 目前只允许在本地 WebChat 会话中使用。",
          durationMs: Date.now() - startedAt,
        };
      }

      const channel = normalizeString(args.channel) as ExternalOutboundChannel;
      const content = normalizeString(args.content);
      const requestedSessionKey = normalizeString(args.sessionKey);
      if (!channel || !["feishu", "qq", "discord", "community"].includes(channel)) {
        return {
          id: "",
          name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
          success: false,
          output: "",
          error: "channel 必须是 feishu / qq / discord / community 之一。",
          durationMs: Date.now() - startedAt,
        };
      }
      if (!content) {
        return {
          id: "",
          name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
          success: false,
          output: "",
          error: "content 不能为空。",
          durationMs: Date.now() - startedAt,
        };
      }

      const resolved = await deps.senderRegistry.resolveTarget({
        channel,
        ...(requestedSessionKey ? { sessionKey: requestedSessionKey } : {}),
      });
      if (!resolved.ok) {
        await appendResolveFailureAudit(deps, context, {
          channel,
          content,
          requestedSessionKey,
          code: resolved.code,
          message: resolved.message,
        });
        return {
          id: "",
          name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
          success: false,
          output: "",
          error: formatOutboundErrorMessage(resolved.code, resolved.message),
          durationMs: Date.now() - startedAt,
        };
      }

      // The confirmation and direct-send paths share one delivery identity so a replay cannot
      // accidentally create a second platform message while the process is still alive.
      const requestId = crypto.randomUUID().slice(0, 8).toUpperCase();

      if (deps.getRequireConfirmation()) {
        if (!context.broadcast) {
          return {
            id: "",
            name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
            success: false,
            output: "",
            error: "当前运行时缺少 WebChat 确认广播能力，无法继续外部渠道外发确认。",
            durationMs: Date.now() - startedAt,
          };
        }
        const pending = deps.confirmationStore.create({
          requestId,
          conversationId: context.conversationId,
          requestedByAgentId: context.agentId,
          channel,
          content,
          ...(requestedSessionKey ? { sessionKey: requestedSessionKey } : {}),
          resolvedSessionKey: resolved.resolvedSessionKey,
          resolution: resolved.resolution,
          ...(resolved.targetChatId ? { targetChatId: resolved.targetChatId } : {}),
          ...(resolved.targetAccountId ? { targetAccountId: resolved.targetAccountId } : {}),
        });
        context.broadcast("external_outbound.confirm.required", {
          source: "agent",
          conversationId: context.conversationId,
          requestId,
          requestedByAgentId: context.agentId,
          channel,
          contentPreview: buildPreview(content),
          targetSessionKey: resolved.resolvedSessionKey,
          targetChatId: resolved.targetChatId,
          targetAccountId: resolved.targetAccountId,
          resolution: resolved.resolution,
          expiresAt: pending.expiresAt,
          targetClientId: getConfirmTargetClientId(context),
        });
        return {
          id: "",
          name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
          success: true,
          output: buildSuccessOutput({
            channel,
            resolution: resolved.resolution,
            resolvedSessionKey: resolved.resolvedSessionKey,
            targetChatId: resolved.targetChatId,
            targetAccountId: resolved.targetAccountId,
            pending: true,
          }),
          durationMs: Date.now() - startedAt,
        };
      }

      const sent = await deps.senderRegistry.sendResolvedText({
        channel,
        content,
        resolvedSessionKey: resolved.resolvedSessionKey,
        idempotencyKey: requestId,
      });
      await deps.auditStore.append({
        timestamp: Date.now(),
        sourceConversationId: context.conversationId,
        sourceChannel: "webchat",
        requestedByAgentId: context.agentId,
        targetChannel: channel,
        requestedSessionKey: requestedSessionKey || undefined,
        targetSessionKey: resolved.resolvedSessionKey,
        targetChatId: resolved.targetChatId,
        targetAccountId: resolved.targetAccountId,
        resolution: resolved.resolution,
        decision: "auto_approved",
        delivery: sent.ok ? "sent" : "failed",
        contentPreview: buildPreview(content),
        errorCode: sent.ok ? undefined : sent.code,
        error: sent.ok ? undefined : sent.message,
      });
      if (!sent.ok) {
        return {
          id: "",
          name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
          success: false,
          output: "",
          error: formatOutboundErrorMessage(sent.code, sent.message),
          durationMs: Date.now() - startedAt,
        };
      }
      return {
        id: "",
        name: SEND_CHANNEL_MESSAGE_TOOL_NAME,
        success: true,
        output: buildSuccessOutput({
          channel,
          resolution: resolved.resolution,
          resolvedSessionKey: resolved.resolvedSessionKey,
          targetChatId: resolved.targetChatId,
          targetAccountId: resolved.targetAccountId,
        }),
        durationMs: Date.now() - startedAt,
      };
    },
  }, {
    family: "other",
    isReadOnly: false,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "high",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "Send a text message from WebChat to a bound external channel session",
    resultSchema: {
      kind: "text",
      description: "Text summary of the outbound send or pending confirmation request.",
    },
    outputPersistencePolicy: "conversation",
  });
}
