import { once } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

const { approvePairingCodeMock } = vi.hoisted(() => ({
  approvePairingCodeMock: vi.fn(async () => ({ ok: true as const, clientId: "paired-client" })),
}));

vi.mock("../security/store.js", () => ({
  approvePairingCode: approvePairingCodeMock,
}));

import { GatewayCodingRunSubscriptionSession } from "./gateway-subscription-session.js";
import { CODING_RUN_PROTOCOL_VERSION } from "./contracts.js";
import { withEnv } from "../server-testkit.js";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  approvePairingCodeMock.mockClear();
  await Promise.all(servers.splice(0).map(async (server) => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe("Gateway coding run subscription session", () => {
  it("retries after pairing.required arrives after the initial pairing_required response", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
    let subscriptionRequestCount = 0;

    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "coding.run.subscribe" || typeof frame.id !== "string") return;
        subscriptionRequestCount += 1;
        if (subscriptionRequestCount === 1) {
          socket.send(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: false,
            error: { code: "pairing_required", message: "Pairing required." },
          }));
          setTimeout(() => {
            socket.send(JSON.stringify({
              type: "event",
              event: "pairing.required",
              payload: { code: "PAIR1234" },
            }));
          }, 0);
          return;
        }
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: false,
          error: { code: "not_found", message: "Coding run event source was not found." },
        }));
      });
    });

    const session = new GatewayCodingRunSubscriptionSession("state-dir");
    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        await expect(session.subscribe({
          subscription: {
            version: CODING_RUN_PROTOCOL_VERSION,
            binding: { conversationId: "conversation-1", agentRunId: "run-1" },
            cursor: 1,
          },
          onEvent: () => undefined,
          onInterrupted: () => undefined,
        })).resolves.toEqual({
          ok: false,
          error: { code: "not_found", message: "Coding run event source was not found." },
        });
      });
    } finally {
      session.close();
    }

    expect(approvePairingCodeMock).toHaveBeenCalledWith({ code: "PAIR1234", stateDir: "state-dir" });
    expect(subscriptionRequestCount).toBe(2);
  });
});
