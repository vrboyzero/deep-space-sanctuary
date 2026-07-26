import { randomUUID } from "node:crypto";

import type { WebSocket } from "ws";

import { approvePairingCode } from "../security/store.js";
import { resolveGatewayBaseUrl, resolveGatewayConnectAuth } from "../cli/shared/gateway-rpc.js";
import {
  isAgentRunEventV1,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingRunSubscription,
  type CodingRunSubscriptionErrorCode,
} from "./contracts.js";

const RECONNECT_DELAYS_MS = [200, 500, 1_000] as const;
const REQUEST_TIMEOUT_MS = 5_000;

export type GatewayCodingRunSubscriptionResult =
  | { ok: true; payload: { earliestSeq: number; latestSeq: number } }
  | { ok: false; error: { code: CodingRunSubscriptionErrorCode; message: string } };

type ActiveSubscription = {
  generation: number;
  binding: CodingRunSubscription["binding"];
  lastSeq: number;
  onEvent: (event: AgentRunEvent) => void;
  onInterrupted: (error: { code: CodingRunSubscriptionErrorCode; message: string }) => void;
};

/**
 * stdio 进程专用的单订阅 Gateway 会话。它只重连 `coding.run.subscribe`，不会重放模型、工具或控制请求。
 */
export class GatewayCodingRunSubscriptionSession {
  private socket: WebSocket | undefined;
  private active: ActiveSubscription | undefined;
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly stateDir: string) {}

  async subscribe(input: {
    subscription: CodingRunSubscription;
    onEvent: (event: AgentRunEvent) => void;
    onInterrupted: (error: { code: CodingRunSubscriptionErrorCode; message: string }) => void;
  }): Promise<GatewayCodingRunSubscriptionResult> {
    this.closeSocket();
    const generation = this.generation += 1;
    this.closed = false;
    this.reconnectAttempt = 0;
    const cursor = input.subscription.cursor ?? 0;
    this.active = {
      generation,
      binding: { ...input.subscription.binding },
      lastSeq: cursor,
      onEvent: input.onEvent,
      onInterrupted: input.onInterrupted,
    };
    return await this.connectAndSubscribe(generation, input.subscription.cursor !== undefined, true);
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
    this.active = undefined;
    this.closeSocket();
  }

  private async connectAndSubscribe(
    generation: number,
    hasExplicitCursor: boolean,
    initial: boolean,
  ): Promise<GatewayCodingRunSubscriptionResult> {
    const active = this.active;
    if (!active || active.generation !== generation || this.closed) {
      return failure("gateway_unavailable", "Coding run subscription session is closed.");
    }

    const baseUrl = resolveGatewayBaseUrl(process.env).replace(/\/+$/, "");
    const wsUrl = baseUrl.replace(/^http/i, "ws");
    const { default: WebSocketConstructor } = await import("ws");

    return await new Promise<GatewayCodingRunSubscriptionResult>((resolve) => {
      const socket = new WebSocketConstructor(wsUrl, { origin: baseUrl });
      this.socket = socket;
      let helloReceived = false;
      let requestId = "";
      let requestSettled = false;
      let pairingInFlight = false;
      let pairingApproved = false;
      let pairingResponsePending = false;
      let pairingRetryCount = 0;
      const timeout = setTimeout(() => {
        finish(failure("gateway_unavailable", "Timed out while subscribing to Gateway coding run events."));
        socket.close();
      }, REQUEST_TIMEOUT_MS);

      const finish = (result: GatewayCodingRunSubscriptionResult) => {
        if (requestSettled) return;
        requestSettled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const sendSubscription = () => {
        const current = this.active;
        if (!current || current.generation !== generation || !helloReceived || requestId || socket.readyState !== WebSocketConstructor.OPEN) {
          return;
        }
        requestId = `bdd-coding-run-subscribe-${randomUUID()}`;
        socket.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "coding.run.subscribe",
          params: {
            version: "v1",
            binding: { ...current.binding },
            cursor: current.lastSeq,
          },
        }));
      };
      const retrySubscriptionAfterPairing = () => {
        if (!pairingResponsePending || !pairingApproved || requestId || requestSettled) return;
        if (pairingRetryCount >= 1) {
          finish(failure("permission_required", "Gateway still requires pairing after the subscription retry."));
          return;
        }
        pairingResponsePending = false;
        pairingRetryCount += 1;
        sendSubscription();
      };
      const handlePairingRequiredResponse = () => {
        // Pairing events and failed requests are separate asynchronous Gateway frames.
        requestId = "";
        pairingResponsePending = true;
        retrySubscriptionAfterPairing();
      };
      const markPairingApproved = () => {
        pairingApproved = true;
        retrySubscriptionAfterPairing();
      };

      socket.on("message", (data) => {
        void this.handleMessage({
          raw: data.toString("utf-8"),
          socket,
          generation,
          initial,
          hasExplicitCursor,
          markHelloReceived: () => { helloReceived = true; },
          isRequestSettled: () => requestSettled,
          finish,
          sendSubscription,
          setPairingInFlight: (value) => { pairingInFlight = value; },
          isPairingInFlight: () => pairingInFlight,
          requestId: () => requestId,
          handlePairingRequiredResponse,
          markPairingApproved,
        });
      });
      socket.on("error", (error) => {
        if (!requestSettled) finish(failure("gateway_unavailable", toSafeCodingRunErrorMessage(error)));
      });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = undefined;
        if (!requestSettled) {
          finish(failure("gateway_unavailable", "Gateway websocket closed before coding run subscription completed."));
          return;
        }
        this.scheduleReconnect(generation);
      });
    });
  }

  private async handleMessage(input: {
    raw: string;
    socket: WebSocket;
    generation: number;
    initial: boolean;
    hasExplicitCursor: boolean;
    markHelloReceived: () => void;
    isRequestSettled: () => boolean;
    finish: (result: GatewayCodingRunSubscriptionResult) => void;
    sendSubscription: () => void;
    setPairingInFlight: (value: boolean) => void;
    isPairingInFlight: () => boolean;
    requestId: () => string;
    handlePairingRequiredResponse: () => void;
    markPairingApproved: () => void;
  }): Promise<void> {
    const frame = parseRecord(input.raw);
    if (!frame) {
      if (!input.isRequestSettled()) input.finish(failure("gateway_unavailable", "Gateway returned invalid websocket JSON."));
      return;
    }
    if (frame.type === "connect.challenge") {
      input.socket.send(JSON.stringify({
        type: "connect",
        role: "cli",
        clientId: `bdd-coding-run-${randomUUID()}`,
        clientName: "bdd coding-run stdio",
        auth: resolveGatewayConnectAuth(process.env),
      }));
      return;
    }
    if (frame.type === "hello-ok") {
      input.markHelloReceived();
      setTimeout(input.sendSubscription, 20);
      return;
    }
    if (frame.type === "event" && frame.event === "pairing.required") {
      if (input.isPairingInFlight()) return;
      const code = isRecord(frame.payload) && typeof frame.payload.code === "string" ? frame.payload.code.trim() : "";
      if (!code) {
        input.finish(failure("permission_required", "Gateway pairing is required, but no pairing code was returned."));
        return;
      }
      input.setPairingInFlight(true);
      try {
        const approved = await approvePairingCode({ code, stateDir: this.stateDir });
        if (!approved.ok) {
          input.finish(failure("permission_required", approved.message));
          return;
        }
        input.markPairingApproved();
      } catch (error) {
        input.finish(failure("permission_required", toSafeCodingRunErrorMessage(error)));
      } finally {
        input.setPairingInFlight(false);
      }
      return;
    }
    if (frame.type === "res" && frame.id === input.requestId()) {
      if (frame.ok !== true) {
        const error = isRecord(frame.error) ? frame.error : {};
        if (error.code === "pairing_required") {
          input.handlePairingRequiredResponse();
          return;
        }
        const code = toSubscriptionErrorCode(error.code);
        const message = typeof error.message === "string" ? error.message : "Gateway subscription request failed.";
        const result = failure(code, toSafeCodingRunErrorMessage(message));
        input.finish(result);
        if (!input.initial && result.ok === false) this.interruptActive(input.generation, result.error);
        return;
      }
      const payload = isRecord(frame.payload) ? frame.payload : {};
      const parsed = parseSubscriptionPayload(payload);
      if (!parsed) {
        input.finish(failure("gateway_unavailable", "Gateway returned an invalid coding run subscription response."));
        return;
      }
      const active = this.active;
      if (active && active.generation === input.generation && !input.hasExplicitCursor && active.lastSeq === 0) {
        active.lastSeq = parsed.earliestSeq - 1;
      }
      this.reconnectAttempt = 0;
      input.finish({ ok: true, payload: parsed });
      return;
    }
    if (frame.type === "event" && frame.event === "coding.run.event") {
      const event = isRecord(frame.payload) ? frame.payload.event : undefined;
      this.consumeEvent(input.generation, event);
    }
  }

  private consumeEvent(generation: number, value: unknown): void {
    const active = this.active;
    if (!active || active.generation !== generation || !isAgentRunEventV1(value)) return;
    if (value.binding.conversationId !== active.binding.conversationId || value.binding.agentRunId !== active.binding.agentRunId) return;
    if (value.seq <= active.lastSeq) return;
    if (value.seq !== active.lastSeq + 1) {
      this.interruptActive(generation, {
        code: "gateway_unavailable",
        message: "Gateway coding run event sequence has a gap; no partial continuation was emitted.",
      });
      this.closeSocket();
      return;
    }
    active.lastSeq = value.seq;
    try {
      active.onEvent(value);
    } catch {
      // stdio writer failures are isolated by the caller and cannot mutate Gateway state.
    }
  }

  private scheduleReconnect(generation: number): void {
    const active = this.active;
    if (this.closed || !active || active.generation !== generation || this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt];
    if (delay === undefined) {
      this.interruptActive(generation, {
        code: "gateway_unavailable",
        message: "Gateway coding run subscription could not reconnect within the fixed retry budget.",
      });
      return;
    }
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectAndSubscribe(generation, true, false).then((result) => {
        if (!result.ok) {
          // 来源/权限错误会在 connectAndSubscribe 内终止 active；瞬时连接失败则继续固定退避。
          const active = this.active;
          if (active && active.generation === generation) this.scheduleReconnect(generation);
        }
      });
    }, delay);
  }

  private interruptActive(generation: number, error: { code: CodingRunSubscriptionErrorCode; message: string }): void {
    const active = this.active;
    if (!active || active.generation !== generation) return;
    this.active = undefined;
    try {
      active.onInterrupted(error);
    } catch {
      // 订阅消费者异常不能影响 Gateway session 的资源清理。
    }
  }

  private closeSocket(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)) socket.close();
  }
}

function parseSubscriptionPayload(value: Record<string, unknown>): { earliestSeq: number; latestSeq: number } | undefined {
  return isNonNegativeSafeInt(value.earliestSeq) && isNonNegativeSafeInt(value.latestSeq) && value.earliestSeq <= value.latestSeq
    ? { earliestSeq: value.earliestSeq, latestSeq: value.latestSeq }
    : undefined;
}

function failure(code: CodingRunSubscriptionErrorCode, message: string): GatewayCodingRunSubscriptionResult {
  return { ok: false, error: { code, message: toSafeCodingRunErrorMessage(message) } };
}

function toSubscriptionErrorCode(value: unknown): CodingRunSubscriptionErrorCode {
  return value === "cursor_expired" ? "cursor_expired"
    : value === "not_found" ? "not_found"
    : value === "run_mismatch" ? "run_mismatch"
    : value === "permission_required" ? "permission_required"
    : value === "permission_denied" ? "permission_denied"
    : value === "invalid_request" || value === "invalid_params" ? "invalid_request"
    : "gateway_unavailable";
}

function parseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isNonNegativeSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
