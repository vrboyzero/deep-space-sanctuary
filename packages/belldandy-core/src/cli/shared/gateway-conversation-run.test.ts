import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

import type { BelldandyAgent } from "@belldandy/agent";
import { startGatewayServer } from "../../server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot, withEnv } from "../../server-testkit.js";
import type { AgentRunEvent } from "../../coding-run/contracts.js";
import { runGatewayConversation } from "./gateway-conversation-run.js";

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("Gateway Conversation CLI stream", () => {
  it("rejects an unsupported automation profile at the Gateway boundary", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-profile-invalid-"));
    const run = vi.fn(async function* () {
      yield { type: "final" as const, text: "unexpected" };
    });
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => ({ run }),
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        await expect(runGatewayConversation({
          stateDir,
          prompt: "invalid profile",
          codingRun: { automationProfile: "resident" } as never,
          onEvent: () => {},
        })).rejects.toMatchObject({
          code: "execution_failed",
          message: expect.stringContaining("automationProfile"),
        });
      });
      expect(run).not.toHaveBeenCalled();
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("streams one real Gateway Conversation as ordered v1 events", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" };
        yield { type: "delta", delta: `echo:${input.text}` };
        yield { type: "final", text: `echo:${input.text}` };
        yield { type: "status", status: "done" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
      primaryModelConfig: {
        baseUrl: "https://api.example.invalid/v1",
        apiKey: "test-placeholder-key",
        model: "deepseek-v4-flash",
      },
    });
    const events: AgentRunEvent[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const result = await runGatewayConversation({
          stateDir,
          prompt: "hello",
          timeoutMs: 5_000,
          modelId: "deepseek-v4-flash",
          codingRun: {
            automationProfile: "bare",
            expectedResolvedModelId: "deepseek-v4-flash",
          },
          onEvent: (event) => events.push(event),
        });

        expect(result.terminalType).toBe("run.completed");
        expect(result.outputText).toBe("echo:hello");
        expect(result.binding.conversationId).toBeTruthy();
        expect(result.binding.agentRunId).toBeTruthy();
        expect(events.map((event) => event.type)).toEqual([
          "run.started",
          "run.status",
          "message.delta",
          "run.status",
          "run.status",
          "run.completed",
        ]);
        expect(events
          .filter((event) => event.type === "run.status")
          .map((event) => event.payload.status)).toEqual(["running", "done", "done"]);
        expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(events[0]?.payload.modelRoute).toEqual({
          declaredModelId: "deepseek-v4-flash",
          resolvedModelId: "deepseek-v4-flash",
          source: "primary",
        });
        expect(events.every((event) => JSON.parse(JSON.stringify(event)).version === "v1")).toBe(true);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("emits one failed terminal without replay when Gateway closes after accepting a run", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-restart-"));
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
        if (frame.type !== "req" || frame.method !== "message.send") return;
        messageSendCount += 1;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { conversationId: "restart-conversation", runId: "restart-run" },
        }));
        setTimeout(() => socket.close(1012, "Injected Gateway restart"), 0);
      });
    });
    const events: AgentRunEvent[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const result = await runGatewayConversation({
          stateDir,
          prompt: "restart boundary",
          timeoutMs: 5_000,
          onEvent: (event) => events.push(event),
        });

        expect(result).toMatchObject({
          binding: { conversationId: "restart-conversation", agentRunId: "restart-run" },
          terminalType: "run.failed",
          timedOut: false,
        });
      });
      expect(messageSendCount).toBe(1);
      expect(events.map((event) => event.type)).toEqual(["run.started", "run.failed"]);
      expect(events.at(-1)?.payload).toMatchObject({ error: { code: "gateway_unavailable" } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
