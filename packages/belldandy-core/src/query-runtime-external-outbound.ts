import type { GatewayEventFrame, GatewayResFrame } from "@belldandy/protocol";

import type { ExternalOutboundAuditStore } from "./external-outbound-audit-store.js";
import type { ExternalOutboundConfirmationStore } from "./external-outbound-confirmation-store.js";
import type { ExternalOutboundSenderRegistry } from "./external-outbound-sender-registry.js";
import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";

type ExternalOutboundQueryRuntimeMethod = "external_outbound.confirm";

export type QueryRuntimeExternalOutboundContext = {
  requestId: string;
  clientId?: string;
  confirmationStore?: ExternalOutboundConfirmationStore;
  senderRegistry?: ExternalOutboundSenderRegistry;
  auditStore?: ExternalOutboundAuditStore;
  emitEvent?: (frame: GatewayEventFrame) => void;
  runtimeObserver?: QueryRuntimeObserver<ExternalOutboundQueryRuntimeMethod>;
};

function buildPreview(value: string): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

export async function handleExternalOutboundConfirmWithQueryRuntime(
  ctx: QueryRuntimeExternalOutboundContext,
  params: {
    requestId: string;
    decision: "approve" | "reject";
    conversationId?: string;
  },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "external_outbound.confirm" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("runtime_checked", {
      detail: {
        hasConfirmationStore: Boolean(ctx.confirmationStore),
        hasSenderRegistry: Boolean(ctx.senderRegistry),
      },
    });

    if (!ctx.confirmationStore || !ctx.senderRegistry || !ctx.auditStore || !ctx.emitEvent) {
      queryRuntime.mark("completed", {
        detail: { code: "unsupported" },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "unsupported", message: "当前服务未启用外部渠道确认处理。" },
      };
    }

    queryRuntime.mark("request_validated", {
      conversationId: params.conversationId,
      detail: {
        requestId: params.requestId,
        decision: params.decision,
      },
    });

    const pending = ctx.confirmationStore.get(params.requestId);
    if (!pending) {
      queryRuntime.mark("completed", {
        conversationId: params.conversationId,
        detail: { code: "not_found" },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_found", message: `未找到待确认的外发请求: ${params.requestId}` },
      };
    }

    if (params.conversationId && pending.conversationId !== params.conversationId) {
      queryRuntime.mark("completed", {
        conversationId: params.conversationId,
        detail: { code: "conversation_mismatch" },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "conversation_mismatch", message: "待确认请求不属于当前会话。" },
      };
    }

    if (params.decision === "reject") {
      ctx.confirmationStore.delete(pending.requestId);
      await ctx.auditStore.append({
        timestamp: Date.now(),
        requestId: pending.requestId,
        sourceConversationId: pending.conversationId,
        sourceChannel: "webchat",
        requestedByAgentId: pending.requestedByAgentId,
        targetChannel: pending.channel,
        requestedSessionKey: pending.sessionKey,
        targetSessionKey: pending.resolvedSessionKey,
        targetChatId: pending.targetChatId,
        targetAccountId: pending.targetAccountId,
        resolution: pending.resolution,
        decision: "rejected",
        delivery: "rejected",
        contentPreview: buildPreview(pending.content),
      });
      ctx.emitEvent({
        type: "event",
        event: "external_outbound.confirm.resolved",
        payload: {
          source: "webchat_ui",
          conversationId: pending.conversationId,
          requestId: pending.requestId,
          channel: pending.channel,
          decision: "rejected",
          delivery: "rejected",
          resolvedAt: Date.now(),
          targetClientId: ctx.clientId,
        },
      });
      queryRuntime.mark("tool_event_emitted", {
        conversationId: pending.conversationId,
        detail: {
          event: "external_outbound.confirm.resolved",
          decision: "rejected",
        },
      });
      queryRuntime.mark("completed", {
        conversationId: pending.conversationId,
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: true,
        payload: {
          conversationId: pending.conversationId,
          requestId: pending.requestId,
          channel: pending.channel,
          decision: "rejected",
        },
      };
    }

    const sent = await ctx.senderRegistry.sendResolvedText({
      channel: pending.channel,
      content: pending.content,
      resolvedSessionKey: pending.resolvedSessionKey,
      idempotencyKey: pending.requestId,
    });
    if (!sent.ok) {
      await ctx.auditStore.append({
        timestamp: Date.now(),
        requestId: pending.requestId,
        sourceConversationId: pending.conversationId,
        sourceChannel: "webchat",
        requestedByAgentId: pending.requestedByAgentId,
        targetChannel: pending.channel,
        requestedSessionKey: pending.sessionKey,
        targetSessionKey: pending.resolvedSessionKey,
        targetChatId: pending.targetChatId,
        targetAccountId: pending.targetAccountId,
        resolution: pending.resolution,
        decision: "confirmed",
        delivery: "failed",
        contentPreview: buildPreview(pending.content),
        errorCode: sent.code,
        error: sent.message,
      });
      queryRuntime.mark("completed", {
        conversationId: pending.conversationId,
        detail: { code: sent.code },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: sent.code, message: sent.message },
      };
    }

    ctx.confirmationStore.delete(pending.requestId);
    await ctx.auditStore.append({
      timestamp: Date.now(),
      requestId: pending.requestId,
      sourceConversationId: pending.conversationId,
      sourceChannel: "webchat",
      requestedByAgentId: pending.requestedByAgentId,
      targetChannel: pending.channel,
      requestedSessionKey: pending.sessionKey,
      targetSessionKey: pending.resolvedSessionKey,
      targetChatId: pending.targetChatId,
      targetAccountId: pending.targetAccountId,
      resolution: pending.resolution,
      decision: "confirmed",
      delivery: "sent",
      contentPreview: buildPreview(pending.content),
    });
    ctx.emitEvent({
      type: "event",
      event: "external_outbound.confirm.resolved",
      payload: {
        source: "webchat_ui",
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        channel: pending.channel,
        decision: "approved",
        delivery: "sent",
        targetSessionKey: pending.resolvedSessionKey,
        resolvedAt: Date.now(),
        targetClientId: ctx.clientId,
      },
    });
    queryRuntime.mark("tool_event_emitted", {
      conversationId: pending.conversationId,
      detail: {
        event: "external_outbound.confirm.resolved",
        decision: "approved",
      },
    });
    queryRuntime.mark("completed", {
      conversationId: pending.conversationId,
    });
    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        channel: pending.channel,
        decision: "approved",
      },
    };
  });
}
