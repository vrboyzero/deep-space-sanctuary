import type { GatewayEventFrame, GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import type { WebSocket } from "ws";

import { CODING_RUN_PROTOCOL_VERSION, type CodingContextBinding } from "../coding-run/contracts.js";
import type { CodingRunGatewayEventBroker } from "../coding-run/gateway-event-broker.js";
import { sendGatewayEvent } from "../server-websocket-runtime.js";

const subscriptionsBySocket = new WeakMap<WebSocket, { unsubscribe: () => void }>();

type ConversationBinding = Pick<CodingContextBinding, "conversationId" | "agentRunId"> & {
  conversationId: string;
};

/**
 * 订阅只读取由 coding-run broker 投影的既有 Gateway 生命周期事件。响应先由 transport 写出，
 * 再激活订阅，避免 replay 帧与对应 RPC 响应发生乱序。
 */
export function handleCodingRunSubscriptionMethod(
  req: GatewayReqFrame,
  ws: WebSocket,
  ctx: { eventBroker: CodingRunGatewayEventBroker },
): GatewayResFrame {
  const parsed = parseSubscriptionParams(req.params);
  if (!parsed) {
    return failure(req.id, "invalid_params", "params must include a complete v1 Conversation binding and optional cursor.");
  }

  const result = ctx.eventBroker.subscribe({
    binding: parsed.binding,
    ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    onEvent: (event) => {
      const frame: GatewayEventFrame = {
        type: "event",
        event: "coding.run.event",
        payload: { event },
      };
      sendGatewayEvent(ws, frame);
    },
  });
  if (!result.ok) {
    return failure(req.id, result.code, result.message);
  }

  subscriptionsBySocket.get(ws)?.unsubscribe();
  subscriptionsBySocket.set(ws, result.subscription);
  ws.once("close", () => {
    const current = subscriptionsBySocket.get(ws);
    if (current !== result.subscription) return;
    subscriptionsBySocket.delete(ws);
    current.unsubscribe();
  });
  setImmediate(result.subscription.activate);
  return {
    type: "res",
    id: req.id,
    ok: true,
    payload: {
      version: CODING_RUN_PROTOCOL_VERSION,
      binding: { ...parsed.binding },
      earliestSeq: result.earliestSeq,
      latestSeq: result.latestSeq,
    },
  };
}

function parseSubscriptionParams(value: unknown): { binding: ConversationBinding; cursor?: number } | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "binding", "cursor"])) return undefined;
  if (value.version !== CODING_RUN_PROTOCOL_VERSION || !isRecord(value.binding)) return undefined;
  if (!hasOnlyKeys(value.binding, ["conversationId", "agentRunId"])) return undefined;
  const conversationId = normalizeNonEmptyString(value.binding.conversationId);
  const agentRunId = normalizeNonEmptyString(value.binding.agentRunId);
  if (!conversationId || !agentRunId) return undefined;
  if (value.cursor !== undefined && (typeof value.cursor !== "number" || !Number.isSafeInteger(value.cursor) || value.cursor < 0)) return undefined;
  return {
    binding: { conversationId, agentRunId },
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
  };
}

function failure(id: string, code: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code, message } };
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
