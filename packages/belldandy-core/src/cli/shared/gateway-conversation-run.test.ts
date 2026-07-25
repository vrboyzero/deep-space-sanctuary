import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { startGatewayServer } from "../../server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot, withEnv } from "../../server-testkit.js";
import type { AgentRunEvent } from "../../coding-run/contracts.js";
import { runGatewayConversation } from "./gateway-conversation-run.js";

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("Gateway Conversation CLI stream", () => {
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
        expect(events.every((event) => JSON.parse(JSON.stringify(event)).version === "v1")).toBe(true);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
