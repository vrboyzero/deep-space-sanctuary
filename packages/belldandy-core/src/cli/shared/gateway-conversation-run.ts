import { randomUUID } from "node:crypto";

import type { CodingRunOptions } from "@belldandy/protocol";
import { approvePairingCode } from "../../security/store.js";
import {
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingRunErrorCode,
} from "../../coding-run/contracts.js";
import { createGatewayConversationEventAdapter } from "../../coding-run/gateway-conversation-event-adapter.js";
import { resolveGatewayBaseUrl, resolveGatewayConnectAuth } from "./gateway-rpc.js";

const DEFAULT_CODING_RUN_TIMEOUT_MS = 5 * 60_000;
const STOP_GRACE_PERIOD_MS = 10_000;
const MAX_PENDING_GATEWAY_EVENTS = 256;

type TerminalEventType = "run.cancelled" | "run.interrupted" | "run.completed" | "run.failed";

export type GatewayConversationRunResult = {
  binding: {
    agentRunId: string;
    conversationId: string;
  };
  terminalType: TerminalEventType;
  outputText?: string;
  errorCode?: CodingRunErrorCode;
  timedOut: boolean;
};

export class GatewayConversationRunError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "gateway_unavailable" | "permission_denied" | "execution_failed",
  ) {
    super(toSafeCodingRunErrorMessage(message));
    this.name = "GatewayConversationRunError";
  }
}

export async function runGatewayConversation(input: {
  stateDir: string;
  prompt: string;
  conversationId?: string;
  agentId?: string;
  modelId?: string;
  timeoutMs?: number;
  codingRun?: CodingRunOptions;
  signal?: AbortSignal;
  onEvent: (event: AgentRunEvent) => void;
}): Promise<GatewayConversationRunResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new GatewayConversationRunError("A non-empty prompt is required.", "invalid_input");
  }
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  const baseUrl = resolveGatewayBaseUrl(process.env).replace(/\/+$/, "");
  const wsUrl = baseUrl.replace(/^http/i, "ws");
  const auth = resolveGatewayConnectAuth(process.env);
  const { default: WebSocket } = await import("ws");

  return await new Promise<GatewayConversationRunResult>((resolve, reject) => {
    let settled = false;
    let helloReceived = false;
    let requestInFlight = false;
    let pairingApprovalInFlight = false;
    let pairingRequired = false;
    let pairingApproved = false;
    let runRequestId = "";
    let stopRequestId = "";
    let binding: GatewayConversationRunResult["binding"] | undefined;
    let timedOut = false;
    let runTimeout: ReturnType<typeof setTimeout> | undefined;
    let stopGraceTimeout: ReturnType<typeof setTimeout> | undefined;
    let initialRequestDelay: ReturnType<typeof setTimeout> | undefined;
    const pendingEvents: Array<{ event: string; payload: unknown }> = [];
    const adapter = createGatewayConversationEventAdapter({
      automationProfile: input.codingRun?.automationProfile,
      onEvent: input.onEvent,
    });
    const socket = new WebSocket(wsUrl, { origin: baseUrl });

    const cleanup = () => {
      if (runTimeout) clearTimeout(runTimeout);
      if (stopGraceTimeout) clearTimeout(stopGraceTimeout);
      if (initialRequestDelay) clearTimeout(initialRequestDelay);
      input.signal?.removeEventListener("abort", onAbort);
    };

    const closeSocket = () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };

    const finish = (result: GatewayConversationRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeSocket();
      resolve(result);
    };

    const failBeforeRun = (error: GatewayConversationRunError) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeSocket();
      reject(error);
    };

    const completeFromTerminal = () => {
      const terminalEvent = adapter.getTerminalEvent();
      if (!terminalEvent || !binding) return;
      const output = isRecord(terminalEvent.payload.output) && typeof terminalEvent.payload.output.text === "string"
        ? terminalEvent.payload.output.text
        : undefined;
      const errorCode = isRecord(terminalEvent.payload.error)
        && typeof terminalEvent.payload.error.code === "string"
        ? terminalEvent.payload.error.code as CodingRunErrorCode
        : undefined;
      finish({
        binding,
        terminalType: terminalEvent.type as TerminalEventType,
        ...(output === undefined ? {} : { outputText: output }),
        ...(errorCode === undefined ? {} : { errorCode }),
        timedOut,
      });
    };

    const failAfterRun = (inputFailure: { code: CodingRunErrorCode; message: string }) => {
      if (settled || !binding) return;
      adapter.fail(inputFailure);
      completeFromTerminal();
    };

    const consumeGatewayEvent = (event: string, payload: unknown) => {
      if (!binding) {
        if (pendingEvents.length >= MAX_PENDING_GATEWAY_EVENTS) {
          failBeforeRun(new GatewayConversationRunError(
            "Gateway produced too many events before accepting the Conversation run.",
            "gateway_unavailable",
          ));
          return;
        }
        pendingEvents.push({ event, payload });
        return;
      }
      adapter.consume({ event, payload });
      completeFromTerminal();
    };

    const sendStopRequest = (reason: string) => {
      if (!binding || stopRequestId || settled || socket.readyState !== WebSocket.OPEN) return;
      stopRequestId = `bdd-agent-stop-${randomUUID()}`;
      socket.send(JSON.stringify({
        type: "req",
        id: stopRequestId,
        method: "conversation.run.stop",
        params: {
          conversationId: binding.conversationId,
          runId: binding.agentRunId,
          reason,
        },
      }));
    };

    const requestStopWithGracePeriod = (reason: string, timeoutFailure: boolean) => {
      if (!binding || settled) return;
      timedOut ||= timeoutFailure;
      sendStopRequest(reason);
      if (!stopGraceTimeout) {
        stopGraceTimeout = setTimeout(() => {
          failAfterRun({
            code: timeoutFailure ? "interrupted" : "cancelled",
            message: timeoutFailure
              ? "Gateway did not confirm cancellation before the coding run timeout elapsed."
              : "Gateway did not confirm cancellation before the caller disconnect grace period elapsed.",
          });
        }, STOP_GRACE_PERIOD_MS);
      }
    };

    const sendRunRequest = () => {
      if (settled || !helloReceived || requestInFlight || pairingApprovalInFlight || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (initialRequestDelay) {
        clearTimeout(initialRequestDelay);
        initialRequestDelay = undefined;
      }
      requestInFlight = true;
      runRequestId = `bdd-agent-run-${randomUUID()}`;
      socket.send(JSON.stringify({
        type: "req",
        id: runRequestId,
        method: "message.send",
        params: {
          ...(input.conversationId?.trim() ? { conversationId: input.conversationId.trim() } : {}),
          ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
          ...(input.modelId?.trim() ? { modelId: input.modelId.trim() } : {}),
          ...(input.codingRun ? { codingRun: input.codingRun } : {}),
          text: prompt,
          from: "cli",
          autoStopPreviousRun: false,
        },
      }));
    };

    const approvePairingAndRetry = async (payload: unknown) => {
      if (pairingApprovalInFlight || settled) return;
      const code = isRecord(payload) && typeof payload.code === "string" ? payload.code.trim() : "";
      if (!code) {
        failBeforeRun(new GatewayConversationRunError(
          "Gateway pairing is required, but no pairing code was returned.",
          "permission_denied",
        ));
        return;
      }
      pairingApprovalInFlight = true;
      let retry = false;
      try {
        const approved = await approvePairingCodeWithRetry({ code, stateDir: input.stateDir });
        if (!approved.ok) {
          failBeforeRun(new GatewayConversationRunError(approved.message, "permission_denied"));
          return;
        }
        pairingApproved = true;
        pairingRequired = false;
        retry = !requestInFlight;
      } catch (error) {
        failBeforeRun(new GatewayConversationRunError(
          error instanceof Error ? error.message : String(error),
          "permission_denied",
        ));
      } finally {
        pairingApprovalInFlight = false;
        if (retry) sendRunRequest();
      }
    };

    const onAbort = () => {
      if (binding) {
        requestStopWithGracePeriod("Cancelled by caller.", false);
        return;
      }
      failBeforeRun(new GatewayConversationRunError("Coding run cancelled before Gateway acceptance.", "execution_failed"));
    };

    if (input.signal?.aborted) {
      onAbort();
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });

    socket.on("message", (data) => {
      if (settled) return;
      let frame: Record<string, unknown>;
      try {
        const parsed = JSON.parse(data.toString("utf-8"));
        if (!isRecord(parsed)) throw new Error("invalid gateway frame");
        frame = parsed;
      } catch {
        if (binding) {
          failAfterRun({ code: "gateway_unavailable", message: "Gateway returned invalid websocket JSON." });
        } else {
          failBeforeRun(new GatewayConversationRunError("Gateway returned invalid websocket JSON.", "gateway_unavailable"));
        }
        return;
      }

      if (frame.type === "connect.challenge") {
        socket.send(JSON.stringify({
          type: "connect",
          role: "cli",
          clientId: `bdd-agent-${randomUUID()}`,
          clientName: "bdd agent",
          auth,
        }));
        return;
      }

      if (frame.type === "hello-ok") {
        helloReceived = true;
        // Gateway creates the initial pairing code asynchronously after hello-ok.
        // Match the existing CLI RPC handshake so the first request cannot race it.
        initialRequestDelay = setTimeout(() => {
          initialRequestDelay = undefined;
          sendRunRequest();
        }, 20);
        return;
      }

      if (frame.type === "event") {
        const event = typeof frame.event === "string" ? frame.event : "";
        if (event === "pairing.required") {
          pairingRequired = true;
          void approvePairingAndRetry(frame.payload);
          return;
        }
        if (event) consumeGatewayEvent(event, frame.payload);
        return;
      }

      if (frame.type !== "res" || typeof frame.id !== "string") return;
      if (frame.id === stopRequestId) {
        if (frame.ok !== true) {
          failAfterRun({ code: "gateway_unavailable", message: readGatewayError(frame) });
        }
        return;
      }
      if (frame.id !== runRequestId) return;

      requestInFlight = false;
      if (frame.ok !== true) {
        const errorCode = readGatewayErrorCode(frame);
        if (errorCode === "pairing_required") {
          pairingRequired = true;
          if (pairingApproved && !pairingApprovalInFlight) {
            pairingApproved = false;
            pairingRequired = false;
            sendRunRequest();
          }
          return;
        }
        failBeforeRun(new GatewayConversationRunError(
          readGatewayError(frame),
          errorCode === "permission_denied" ? "permission_denied" : "execution_failed",
        ));
        return;
      }

      const payload = isRecord(frame.payload) ? frame.payload : {};
      const conversationId = typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
      const agentRunId = typeof payload.runId === "string" ? payload.runId.trim() : "";
      if (!conversationId || !agentRunId) {
        failBeforeRun(new GatewayConversationRunError(
          "Gateway accepted message.send without conversationId/runId.",
          "gateway_unavailable",
        ));
        return;
      }
      binding = { conversationId, agentRunId };
      const messageMeta = isRecord(payload.messageMeta) ? payload.messageMeta : undefined;
      const promptTimestampMs = typeof messageMeta?.timestampMs === "number"
        && Number.isInteger(messageMeta.timestampMs)
        && messageMeta.timestampMs >= 0
        ? messageMeta.timestampMs
        : undefined;
      adapter.start(binding, {
        ...(promptTimestampMs === undefined ? {} : { promptId: `message:${promptTimestampMs}` }),
        agentId: input.agentId?.trim() || "default",
      });
      runTimeout = setTimeout(() => {
        requestStopWithGracePeriod("Coding run timed out.", true);
      }, timeoutMs);
      for (const pendingEvent of pendingEvents.splice(0)) {
        consumeGatewayEvent(pendingEvent.event, pendingEvent.payload);
        if (settled) return;
      }
      if (pairingRequired) {
        return;
      }
    });

    socket.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (binding) {
        failAfterRun({ code: "gateway_unavailable", message });
      } else {
        failBeforeRun(new GatewayConversationRunError(message, "gateway_unavailable"));
      }
    });

    socket.on("close", () => {
      if (settled) return;
      if (binding) {
        failAfterRun({
          code: "gateway_unavailable",
          message: "Gateway websocket closed before the Conversation run reached a terminal event.",
        });
      } else {
        failBeforeRun(new GatewayConversationRunError(
          "Gateway websocket closed before accepting the Conversation run.",
          "gateway_unavailable",
        ));
      }
    });
  });
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CODING_RUN_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1_000) {
    throw new GatewayConversationRunError("timeoutMs must be an integer of at least 1000 ms.", "invalid_input");
  }
  return value;
}

function readGatewayError(frame: Record<string, unknown>): string {
  if (!isRecord(frame.error) || typeof frame.error.message !== "string" || !frame.error.message.trim()) {
    return "Gateway request failed.";
  }
  return toSafeCodingRunErrorMessage(frame.error.message);
}

function readGatewayErrorCode(frame: Record<string, unknown>): string | undefined {
  return isRecord(frame.error) && typeof frame.error.code === "string" ? frame.error.code : undefined;
}

async function approvePairingCodeWithRetry(input: {
  code: string;
  stateDir: string;
}): Promise<Awaited<ReturnType<typeof approvePairingCode>>> {
  const deadline = Date.now() + 15_000;
  let latest = await approvePairingCode(input);
  while (!latest.ok && latest.message === "pairing code not found or expired" && Date.now() < deadline) {
    await delay(20);
    latest = await approvePairingCode(input);
  }
  return latest;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
