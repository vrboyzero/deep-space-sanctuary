import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { startGatewayServer } from "../../../server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot, withEnv } from "../../../server-testkit.js";
import { cancelAgentRunCommand } from "./cancel.js";
import { continueAgentRunCommand } from "./continue.js";
import { inspectAgentConversation } from "./inspect.js";
import { runAgentRunCommand } from "./run.js";

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("bdd agent controls", () => {
  it("continues one Conversation and inspects its Gateway-owned metadata", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-controls-"));
    const conversationId = "agent-cli-continue";
    const observedConversationIds: string[] = [];
    const agent: BelldandyAgent = {
      async *run(input) {
        observedConversationIds.push(input.conversationId);
        yield { type: "status", status: "running" };
        yield { type: "final", text: `echo:${input.text}` };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "first",
          conversationId,
          jsonl: true,
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);

        stdout.length = 0;
        expect(await continueAgentRunCommand({
          stateDir,
          conversationId,
          prompt: "second",
          jsonl: true,
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);

        const inspectStdout: string[] = [];
        expect(await inspectAgentConversation({
          stateDir,
          conversationId,
          json: true,
          writeStdout: (text) => inspectStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);

        expect(observedConversationIds).toEqual([conversationId, conversationId]);
        const events = stdout.join("").trim().split("\n").map((line) => JSON.parse(line) as { binding: { conversationId?: string } });
        expect(events.every((event) => event.binding.conversationId === conversationId)).toBe(true);
        expect(JSON.parse(inspectStdout.join(""))).toMatchObject({
          conversationId,
          messages: expect.any(Array),
        });
        expect(stderr).toEqual([]);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("cancels only the bound active Conversation run", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-cancel-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" };
        await new Promise<void>((resolve) => {
          if (input.abortSignal?.aborted) {
            resolve();
            return;
          }
          input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield { type: "status", status: "stopped" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let resolveBinding: ((binding: { conversationId: string; agentRunId: string }) => void) | undefined;
    const bindingReady = new Promise<{ conversationId: string; agentRunId: string }>((resolve) => {
      resolveBinding = resolve;
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const run = runAgentRunCommand({
          stateDir,
          prompt: "wait for cancellation",
          jsonl: true,
          writeStdout: (text) => {
            stdout.push(text);
            const event = JSON.parse(text) as { type?: string; binding?: { conversationId?: string; agentRunId?: string } };
            if (event.type === "run.started" && event.binding?.conversationId && event.binding.agentRunId) {
              resolveBinding?.({
                conversationId: event.binding.conversationId,
                agentRunId: event.binding.agentRunId,
              });
            }
          },
          writeStderr: (text) => stderr.push(text),
        });
        const binding = await bindingReady;

        const cancelStdout: string[] = [];
        expect(await cancelAgentRunCommand({
          stateDir,
          ...binding,
          reason: "test cancellation",
          json: true,
          writeStdout: (text) => cancelStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        expect(await run).toBe(5);

        expect(JSON.parse(cancelStdout.join(""))).toMatchObject({
          operation: "cancel",
          binding,
        });
        expect(stdout.join("")).toContain('"type":"run.cancelled"');
        expect(stderr).toEqual([]);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 10_000);
});
