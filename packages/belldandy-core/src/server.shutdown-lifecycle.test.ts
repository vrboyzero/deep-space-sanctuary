import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConversationStore } from "@belldandy/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { GatewayServerCloseError } from "./gateway-server-shutdown.js";
import { startGatewayServer, type GatewayServer } from "./server.js";
import { resolveWebRoot } from "./server-testkit.js";

const stateDirs: string[] = [];
const servers: GatewayServer[] = [];

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function waitForWebSocketFrame(
  ws: WebSocket,
  predicate: (frame: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      const frame = JSON.parse(data.toString("utf-8")) as Record<string, unknown>;
      if (!predicate(frame)) return;
      ws.off("error", onError);
      ws.off("message", onMessage);
      resolve(frame);
    };
    const onError = (error: Error): void => {
      ws.off("message", onMessage);
      reject(error);
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
  });
}

async function createServer(options: { conversationStore?: ConversationStore } = {}): Promise<GatewayServer> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-shutdown-lifecycle-"));
  stateDirs.push(stateDir);
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore: options.conversationStore,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(stateDirs.splice(0).map((stateDir) => fs.rm(stateDir, { recursive: true, force: true })));
});

describe("Gateway server shutdown lifecycle", () => {
  it("rejects HTTP and WebSocket intake while an accepted external drain is pending", async () => {
    const server = await createServer();
    const drain = createDeferred();
    const stop = vi.fn(() => drain.promise);
    server.registerShutdownResources({ emailInbound: { stop } });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });

    try {
      await waitForWebSocketFrame(ws, (frame) => frame.type === "connect.challenge");
      ws.send(JSON.stringify({ type: "connect", auth: { mode: "none" }, clientId: "shutdown-fixture" }));
      await waitForWebSocketFrame(ws, (frame) => frame.type === "hello-ok");

      const close = server.close();
      await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: {
          code: "gateway_shutting_down",
          message: "Gateway is shutting down.",
        },
      });
      expect(response.status).toBe(503);

      const gatewayResponse = waitForWebSocketFrame(
        ws,
        (frame) => frame.type === "res" && frame.id === "shutdown-request",
      );
      ws.send(JSON.stringify({ type: "req", id: "shutdown-request", method: "models.list" }));
      await expect(gatewayResponse).resolves.toMatchObject({
        ok: false,
        error: { code: "gateway_shutting_down" },
      });

      drain.resolve();
      await expect(close).resolves.toBeUndefined();
      await expect(server.close()).resolves.toBeUndefined();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      drain.resolve();
      ws.terminate();
    }
  });

  it("closes later owners and transport before exposing a Conversation flush failure", async () => {
    class FailingConversationStore extends ConversationStore {
      async waitForAllPendingPersistence(): Promise<void> {
        throw new Error("fixture persistence failure");
      }
    }

    const server = await createServer({ conversationStore: new FailingConversationStore() });
    const closeExternal = vi.fn();
    server.registerShutdownResources({
      activeNotify: { close: closeExternal },
    });

    await expect(server.close()).rejects.toBeInstanceOf(GatewayServerCloseError);
    expect(closeExternal).toHaveBeenCalledTimes(1);
    await expect(fetch(`http://127.0.0.1:${server.port}/health`)).rejects.toThrow();
  });
});
