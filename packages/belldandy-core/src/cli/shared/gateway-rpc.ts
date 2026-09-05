import { randomUUID } from "node:crypto";

import { approvePairingCode } from "../../security/store.js";

export type GatewayConnectAuth =
  | { mode: "none" }
  | { mode: "token"; token: string }
  | { mode: "password"; password: string };

export type GatewayMethodResult<T> =
  | {
    ok: true;
    payload: T;
    paired: boolean;
    wsUrl: string;
  }
  | {
    ok: false;
    error: string;
    errorCode?: string;
    paired: boolean;
    wsUrl: string;
  };

const DEFAULT_GATEWAY_PORT = 28889;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveGatewayBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const rawHost = (env.BELLDANDY_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const host = rawHost === "0.0.0.0" ? "127.0.0.1" : rawHost;
  const portValue = Number(env.BELLDANDY_PORT ?? String(DEFAULT_GATEWAY_PORT));
  const port = Number.isFinite(portValue) && portValue >= 1 && portValue <= 65535
    ? Math.floor(portValue)
    : DEFAULT_GATEWAY_PORT;
  return `http://${host}:${port}`;
}

export function resolveGatewayConnectAuth(env: NodeJS.ProcessEnv = process.env): GatewayConnectAuth {
  const authMode = (env.BELLDANDY_AUTH_MODE ?? "none").trim();
  if (authMode === "token") {
    return {
      mode: "token",
      token: (env.BELLDANDY_AUTH_TOKEN ?? "").trim(),
    };
  }
  if (authMode === "password") {
    return {
      mode: "password",
      password: (env.BELLDANDY_AUTH_PASSWORD ?? "").trim(),
    };
  }
  return { mode: "none" };
}

export async function invokeGatewayMethod<T>(input: {
  stateDir: string;
  method: string;
  params?: Record<string, unknown>;
  requestIdPrefix: string;
  timeoutMs?: number;
  clientName?: string;
  parsePayload: (payload: Record<string, unknown>) => T;
}): Promise<GatewayMethodResult<T>> {
  const { default: WebSocket } = await import("ws");

  const baseUrl = resolveGatewayBaseUrl(process.env).replace(/\/+$/, "");
  const wsUrl = baseUrl.replace(/^http/i, "ws");
  const auth = resolveGatewayConnectAuth(process.env);
  const clientId = `bdd-cli-${randomUUID()}`;

  return await new Promise((resolve) => {
    let settled = false;
    let paired = false;
    let currentRequestId = "";
    let requestSequence = 0;
    let pendingPairingRetry = false;
    let requestInFlight = false;
    let pairingInProgress = false;
    let pairingRetrySent = false;

    const finish = (
      result:
        | { ok: true; payload: T }
        | { ok: false; error: string; errorCode?: string },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      if (result.ok) {
        resolve({
          ok: true,
          payload: result.payload,
          paired,
          wsUrl,
        });
        return;
      }
      resolve({
        ok: false,
        error: result.error,
        paired,
        wsUrl,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      });
    };

    const sendRequest = () => {
      if (settled || requestInFlight || pairingInProgress) return;
      if (pendingPairingRetry) {
        if (!paired) return;
        if (pairingRetrySent) {
          finish({ ok: false, error: "Gateway still requires pairing after approval.", errorCode: "pairing_required" });
          return;
        }
        pairingRetrySent = true;
        pendingPairingRetry = false;
      }
      currentRequestId = `${input.requestIdPrefix}-${Date.now()}-${requestSequence += 1}`;
      requestInFlight = true;
      socket.send(JSON.stringify({
        type: "req",
        id: currentRequestId,
        method: input.method,
        params: input.params ?? {},
      }));
    };

    const socket = new WebSocket(wsUrl, {
      origin: baseUrl,
    });

    const timeout = setTimeout(() => {
      finish({ ok: false, error: `Timed out while calling ${input.method} via ${wsUrl}` });
    }, input.timeoutMs ?? 3_000);

    socket.on("message", async (data) => {
      if (settled) return;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data.toString("utf-8")) as Record<string, unknown>;
      } catch {
        finish({ ok: false, error: "Gateway returned invalid websocket JSON." });
        return;
      }

      if (frame.type === "connect.challenge") {
        socket.send(JSON.stringify({
          type: "connect",
          role: "cli",
          clientId,
          auth,
          clientName: input.clientName ?? "bdd console",
        }));
        return;
      }

      if (frame.type === "hello-ok") {
        setTimeout(() => {
          if (!settled && !pendingPairingRetry && !requestInFlight) {
            sendRequest();
          }
        }, 20);
        return;
      }

      if (frame.type === "event" && frame.event === "pairing.required") {
        if (pairingInProgress || paired) return;
        const payload = isRecord(frame.payload) ? frame.payload : {};
        const code = typeof payload.code === "string" ? payload.code.trim() : "";
        if (!code) {
          finish({ ok: false, error: "Gateway pairing is required, but no pairing code was returned." });
          return;
        }
        pairingInProgress = true;
        try {
          const approved = await approvePairingCode({ code, stateDir: input.stateDir });
          if (!approved.ok) {
            finish({ ok: false, error: approved.message });
            return;
          }
          paired = true;
        } catch {
          finish({ ok: false, error: "Gateway pairing approval failed." });
          return;
        } finally {
          pairingInProgress = false;
        }
        // 配对完成不能覆盖在途 requestId；只有明确被拒绝的请求才能补发。
        sendRequest();
        return;
      }

      if (frame.type === "res" && frame.id === currentRequestId) {
        requestInFlight = false;
        if (frame.ok === true) {
          const payload = isRecord(frame.payload) ? frame.payload : {};
          try {
            finish({
              ok: true,
              payload: input.parsePayload(payload),
            });
          } catch (error) {
            finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }

        const error = isRecord(frame.error) ? frame.error : {};
        const errorCode = typeof error.code === "string" ? error.code : "request_failed";
        const errorMessage = typeof error.message === "string" ? error.message : "Gateway request failed.";
        if (errorCode === "pairing_required") {
          pendingPairingRetry = true;
          sendRequest();
          return;
        }
        finish({ ok: false, error: errorMessage, errorCode });
      }
    });

    socket.on("error", (error) => {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

    socket.on("close", () => {
      if (!settled) {
        finish({ ok: false, error: `Gateway websocket ${wsUrl} closed before ${input.method} completed.` });
      }
    });
  });
}
