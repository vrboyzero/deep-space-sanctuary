import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

import { withEnv } from "../../server-testkit.js";

const approvePairingCode = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("../../security/store.js", () => ({ approvePairingCode }));

import { runGatewayConversation } from "./gateway-conversation-run.js";

afterEach(() => {
  approvePairingCode.mockClear();
});

describe("Gateway Conversation CLI pairing", () => {
  it("does not retry message.send while the pairing-triggering request is still in flight", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-gateway-pairing-"));
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test Gateway did not expose a TCP port.");

    let messageSendCount = 0;
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "message.send" || typeof frame.id !== "string") return;

        messageSendCount += 1;
        const runId = `pairing-run-${messageSendCount}`;
        const respond = () => {
          socket.send(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: { conversationId: "pairing-conversation", runId },
          }));
          socket.send(JSON.stringify({
            type: "event",
            event: "chat.final",
            payload: { conversationId: "pairing-conversation", runId, text: `done:${runId}` },
          }));
        };

        if (messageSendCount === 1) {
          socket.send(JSON.stringify({
            type: "event",
            event: "pairing.required",
            payload: { code: "test-pairing-code" },
          }));
          setTimeout(respond, 25);
          return;
        }
        respond();
      });
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const result = await runGatewayConversation({
          stateDir,
          prompt: "pairing retry ordering",
          timeoutMs: 2_000,
          onEvent: () => {},
        });

        expect(result).toMatchObject({
          binding: { conversationId: "pairing-conversation", agentRunId: "pairing-run-1" },
          terminalType: "run.completed",
          outputText: "done:pairing-run-1",
        });
      });
      expect(approvePairingCode).toHaveBeenCalledTimes(1);
      expect(messageSendCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("retries only after the paired in-flight request is explicitly rejected", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-gateway-pairing-retry-"));
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test Gateway did not expose a TCP port.");

    let messageSendCount = 0;
    let firstResponseSent = false;
    let retriedBeforeFirstResponse = false;
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "message.send" || typeof frame.id !== "string") return;

        messageSendCount += 1;
        if (messageSendCount === 1) {
          socket.send(JSON.stringify({
            type: "event",
            event: "pairing.required",
            payload: { code: "test-pairing-code" },
          }));
          setTimeout(() => {
            firstResponseSent = true;
            socket.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "pairing_required", message: "pairing is required" },
            }));
          }, 25);
          return;
        }

        retriedBeforeFirstResponse ||= !firstResponseSent;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { conversationId: "pairing-retry-conversation", runId: "pairing-retry-run-2" },
        }));
        socket.send(JSON.stringify({
          type: "event",
          event: "chat.final",
          payload: {
            conversationId: "pairing-retry-conversation",
            runId: "pairing-retry-run-2",
            text: "done:pairing-retry-run-2",
          },
        }));
      });
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const result = await runGatewayConversation({
          stateDir,
          prompt: "pairing retry after rejection",
          timeoutMs: 2_000,
          onEvent: () => {},
        });

        expect(result).toMatchObject({
          binding: { conversationId: "pairing-retry-conversation", agentRunId: "pairing-retry-run-2" },
          terminalType: "run.completed",
          outputText: "done:pairing-retry-run-2",
        });
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      expect(approvePairingCode).toHaveBeenCalledTimes(1);
      expect(messageSendCount).toBe(2);
      expect(retriedBeforeFirstResponse).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("clears the scheduled initial request when pairing sends the run first", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-gateway-pairing-initial-"));
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test Gateway did not expose a TCP port.");

    let messageSendCount = 0;
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          socket.send(JSON.stringify({
            type: "event",
            event: "pairing.required",
            payload: { code: "test-pairing-code" },
          }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "message.send" || typeof frame.id !== "string") return;

        messageSendCount += 1;
        const runId = `pairing-initial-run-${messageSendCount}`;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { conversationId: "pairing-initial-conversation", runId },
        }));
        if (messageSendCount === 1) {
          setTimeout(() => {
            if (messageSendCount !== 1) return;
            socket.send(JSON.stringify({
              type: "event",
              event: "chat.final",
              payload: {
                conversationId: "pairing-initial-conversation",
                runId,
                text: `done:${runId}`,
              },
            }));
          }, 35);
          return;
        }
        socket.send(JSON.stringify({
          type: "event",
          event: "chat.final",
          payload: {
            conversationId: "pairing-initial-conversation",
            runId,
            text: `done:${runId}`,
          },
        }));
      });
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const result = await runGatewayConversation({
          stateDir,
          prompt: "pairing before initial request timer",
          timeoutMs: 2_000,
          onEvent: () => {},
        });

        expect(result).toMatchObject({
          binding: { conversationId: "pairing-initial-conversation", agentRunId: "pairing-initial-run-1" },
          terminalType: "run.completed",
          outputText: "done:pairing-initial-run-1",
        });
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      expect(approvePairingCode).toHaveBeenCalledTimes(1);
      expect(messageSendCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
