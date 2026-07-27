import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import {
  CODING_RUN_PROTOCOL_VERSION,
  type AgentRunEvent,
} from "../coding-run/contracts.js";
import { createCodingRunGatewayEventBroker } from "../coding-run/gateway-event-broker.js";
import { runCodingRunStdio } from "../coding-run/stdio-process.js";
import { startGatewayServer } from "../server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  resolveWebRoot,
  waitFor,
  withEnv,
} from "../server-testkit.js";
import { createCodingTuiRuntime } from "./runtime.js";
import { createInitialTuiState, reduceTuiState } from "./state.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Coding TUI runtime integration", () => {
  it("starts and subscribes to one real Gateway Conversation without duplicating controls", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-runtime-"));
    temporaryDirectories.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    await fs.mkdir(workspace);
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "status" as const, status: "running" as const };
        yield { type: "delta" as const, delta: "TUI streamed answer" };
        yield { type: "final" as const, text: "TUI streamed answer" };
        yield { type: "status" as const, status: "done" as const };
      },
    };
    const gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const events: AgentRunEvent[] = [];
    const errors: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(gateway.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const runtime = createCodingTuiRuntime({
          stateDir,
          cwd: workspace,
          onEvent: (event) => events.push(event),
          onSubscriptionError: (error) => errors.push(error.message),
          onProtocolError: (error) => errors.push(error.message),
          onBridgeError: (message) => errors.push(message),
        });
        try {
          const binding = await runtime.requestConversation("Inspect the workspace.");
          await waitFor(() => events.some((event) => event.type === "run.completed"));

          expect(binding.conversationId).toBeTruthy();
          expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
          expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "message.delta", payload: { delta: "TUI streamed answer" } }),
            expect.objectContaining({ type: "run.completed", payload: { output: { text: "TUI streamed answer" } } }),
          ]));
          expect(new Set(events.map((event) => event.binding.agentRunId))).toEqual(new Set([binding.agentRunId]));
          expect(errors).toEqual([]);
        } finally {
          await runtime.close();
        }
      });
    } finally {
      await gateway.close();
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("steers the same real Gateway Conversation at its next model boundary", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-steer-"));
    temporaryDirectories.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    await fs.mkdir(workspace);
    let releaseFirstModel: (() => void) | undefined;
    const firstModelPending = new Promise<void>((resolve) => { releaseFirstModel = resolve; });
    const deliveredPrompts: string[] = [];
    let runInvocations = 0;
    const agent: BelldandyAgent = {
      getCodingRunCapabilities: () => ({ maxCostUsd: false, steerAtModelBoundary: true }),
      async *run(input) {
        runInvocations += 1;
        yield { type: "status" as const, status: "running" as const };
        await firstModelPending;
        if (!input.steering) throw new Error("steering mailbox missing");
        const commands = await input.steering.consumePending({ modelCallIndex: 2 });
        deliveredPrompts.push(...commands.map((command) => command.prompt));
        input.steering.sealIfIdle();
        yield { type: "final" as const, text: `steered:${deliveredPrompts.join("|")}` };
        yield { type: "status" as const, status: "done" as const };
      },
    };
    const gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const events: AgentRunEvent[] = [];
    const errors: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(gateway.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const runtime = createCodingTuiRuntime({
          stateDir,
          cwd: workspace,
          onEvent: (event) => events.push(event),
          onSubscriptionError: (error) => errors.push(error.message),
          onProtocolError: (error) => errors.push(error.message),
          onBridgeError: (message) => errors.push(message),
        });
        try {
          const binding = await runtime.requestConversation("Start the task.");
          await waitFor(() => events.some((event) => event.type === "run.started"));
          await runtime.steer(binding, "Focus on the regression.");
          releaseFirstModel?.();
          await waitFor(() => events.some((event) => event.type === "run.completed"));

          expect(runInvocations).toBe(1);
          expect(deliveredPrompts).toEqual(["Focus on the regression."]);
          expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
              type: "run.completed",
              binding,
              payload: { output: { text: "steered:Focus on the regression." } },
            }),
          ]));
          expect(new Set(events.map((event) => event.binding.agentRunId))).toEqual(new Set([binding.agentRunId]));
          expect(errors).toEqual([]);
        } finally {
          releaseFirstModel?.();
          await runtime.close();
        }
      });
    } finally {
      releaseFirstModel?.();
      await gateway.close().catch(() => {});
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("cancels only its bound active Gateway Conversation run", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-cancel-"));
    temporaryDirectories.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    await fs.mkdir(workspace);
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status" as const, status: "running" as const };
        await new Promise<void>((resolve) => {
          if (input.abortSignal?.aborted) {
            resolve();
            return;
          }
          input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield { type: "status" as const, status: "stopped" as const };
      },
    };
    const gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const events: AgentRunEvent[] = [];
    const errors: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(gateway.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const runtime = createCodingTuiRuntime({
          stateDir,
          cwd: workspace,
          onEvent: (event) => events.push(event),
          onSubscriptionError: (error) => errors.push(error.message),
          onProtocolError: (error) => errors.push(error.message),
          onBridgeError: (message) => errors.push(message),
        });
        try {
          const binding = await runtime.requestConversation("Wait for cancellation.");
          await waitFor(() => events.some((event) => event.type === "run.started"));
          await runtime.cancel(binding);
          await waitFor(() => events.some((event) => event.type === "run.cancelled"));

          const terminalEvents = events.filter((event) =>
            event.type === "run.completed"
            || event.type === "run.failed"
            || event.type === "run.cancelled"
            || event.type === "run.interrupted");
          expect(terminalEvents).toEqual([
            expect.objectContaining({ type: "run.cancelled", binding }),
          ]);
          expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
          expect(events.every((event) =>
            event.binding.conversationId === binding.conversationId
            && event.binding.agentRunId === binding.agentRunId)).toBe(true);
          expect(errors).toEqual([]);
        } finally {
          await runtime.close();
        }
      });
    } finally {
      await gateway.close();
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("resumes its active subscription from the last confirmed cursor after a forced Gateway disconnect", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-reconnect-"));
    temporaryDirectories.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    await fs.mkdir(workspace);
    const broker = createCodingRunGatewayEventBroker();
    const subscribeSpy = vi.spyOn(broker, "subscribe");
    let releaseRun: (() => void) | undefined;
    const runReleased = new Promise<void>((resolve) => { releaseRun = resolve; });
    let runInvocations = 0;
    const agent: BelldandyAgent = {
      async *run() {
        runInvocations += 1;
        yield { type: "status" as const, status: "running" as const };
        yield { type: "delta" as const, delta: "before restart" };
        await runReleased;
        yield { type: "delta" as const, delta: " after restart" };
        yield { type: "final" as const, text: "before restart after restart" };
        yield { type: "status" as const, status: "done" as const };
      },
    };
    const gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      codingRunEventBroker: broker,
      agentFactory: () => agent,
    });
    let proxy = await startTcpProxy(gateway.port);
    const proxyPort = proxy.port;
    const events: AgentRunEvent[] = [];
    const errors: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(proxyPort),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const runtime = createCodingTuiRuntime({
          stateDir,
          cwd: workspace,
          onEvent: (event) => events.push(event),
          onSubscriptionError: (error) => errors.push(error.message),
          onProtocolError: (error) => errors.push(error.message),
          onBridgeError: (message) => errors.push(message),
        });
        try {
          const binding = await runtime.requestConversation("Continue after a Gateway restart.");
          await waitFor(() => events.some((event) =>
            event.type === "message.delta" && event.payload.delta === "before restart"));
          const cursorBeforeRestart = events.at(-1)!.seq;

          await proxy.close();
          await new Promise((resolve) => setTimeout(resolve, 300));
          proxy = await startTcpProxy(gateway.port, proxyPort);
          releaseRun?.();
          await waitFor(() => events.some((event) => event.type === "run.completed"));

          expect(runInvocations).toBe(1);
          expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
          expect(events
            .filter((event) => event.type === "message.delta")
            .map((event) => event.payload.delta)).toEqual(["before restart", " after restart"]);
          expect(events.every((event) =>
            event.binding.conversationId === binding.conversationId
            && event.binding.agentRunId === binding.agentRunId)).toBe(true);
          expect(subscribeSpy.mock.calls.map(([request]) => request.cursor)).toEqual([0, cursorBeforeRestart]);
          expect(errors).toEqual([]);
        } finally {
          releaseRun?.();
          await runtime.close();
        }
      });
    } finally {
      releaseRun?.();
      await proxy.close().catch(() => {});
      await gateway.close().catch(() => {});
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("shows the same run events as a Headless subscriber without starting another run", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-headless-"));
    temporaryDirectories.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    await fs.mkdir(workspace);
    let releaseRun: (() => void) | undefined;
    const runReleased = new Promise<void>((resolve) => { releaseRun = resolve; });
    let runInvocations = 0;
    const agent: BelldandyAgent = {
      async *run() {
        runInvocations += 1;
        yield { type: "status" as const, status: "running" as const };
        await runReleased;
        yield {
          type: "tool_call" as const,
          id: "tool-1",
          name: "read_file",
          arguments: { apiKey: "must-not-leak" },
        };
        yield {
          type: "tool_result" as const,
          id: "tool-1",
          name: "read_file",
          success: true,
          output: "token=must-not-leak",
        };
        yield { type: "delta" as const, delta: "shared answer" };
        yield { type: "final" as const, text: "shared answer" };
        yield { type: "status" as const, status: "done" as const };
      },
    };
    const gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const tuiEvents: AgentRunEvent[] = [];
    const headlessEvents: AgentRunEvent[] = [];
    const errors: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(gateway.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const runtime = createCodingTuiRuntime({
          stateDir,
          cwd: workspace,
          onEvent: (event) => tuiEvents.push(event),
          onSubscriptionError: (error) => errors.push(error.message),
          onProtocolError: (error) => errors.push(error.message),
          onBridgeError: (message) => errors.push(message),
        });
        let finishHeadlessInput: (() => void) | undefined;
        const headlessInputFinished = new Promise<void>((resolve) => { finishHeadlessInput = resolve; });
        let markHeadlessSubscribed: (() => void) | undefined;
        const headlessSubscribed = new Promise<void>((resolve) => { markHeadlessSubscribed = resolve; });
        try {
          const binding = await runtime.requestConversation("Show one run in two clients.");
          const headless = runCodingRunStdio({
            stateDir,
            input: (async function* () {
              yield `${JSON.stringify({
                version: CODING_RUN_PROTOCOL_VERSION,
                type: "subscription.request",
                id: "headless-shared-run",
                subscription: {
                  version: CODING_RUN_PROTOCOL_VERSION,
                  binding,
                  cursor: 0,
                },
              })}\n`;
              await headlessInputFinished;
            })(),
            writeStdout: (line) => {
              const frame = JSON.parse(line) as {
                type?: string;
                ok?: boolean;
                event?: AgentRunEvent;
              };
              if (frame.type === "subscription.response" && frame.ok === true) {
                markHeadlessSubscribed?.();
              }
              if (frame.type === "event" && frame.event) {
                headlessEvents.push(frame.event);
                if (frame.event.type === "run.completed") finishHeadlessInput?.();
              }
            },
            writeStderr: (line) => { errors.push(line); },
          });

          await headlessSubscribed;
          releaseRun?.();
          await waitFor(() => tuiEvents.some((event) => event.type === "run.completed"));
          await waitFor(() => headlessEvents.some((event) => event.type === "run.completed"));
          finishHeadlessInput?.();
          expect(await headless).toBe(0);

          expect(runInvocations).toBe(1);
          expect(headlessEvents).toEqual(tuiEvents);
          expect(tuiEvents.map((event) => event.seq)).toEqual(tuiEvents.map((_event, index) => index + 1));
          expect(tuiEvents.filter((event) =>
            event.type === "run.completed"
            || event.type === "run.failed"
            || event.type === "run.cancelled"
            || event.type === "run.interrupted")).toHaveLength(1);
          expect(tuiEvents.every((event) =>
            event.binding.conversationId === binding.conversationId
            && event.binding.agentRunId === binding.agentRunId)).toBe(true);
          let tuiState = createInitialTuiState(workspace);
          tuiState = reduceTuiState(tuiState, {
            type: "conversation.accepted",
            binding,
            prompt: "Show one run in two clients.",
          });
          for (const event of tuiEvents) {
            tuiState = reduceTuiState(tuiState, { type: "run.event", event });
          }
          expect(tuiState.tools).toEqual([{
            id: "tool-1",
            name: "read_file",
            status: "succeeded",
          }]);
          expect(JSON.stringify(tuiState)).not.toContain("must-not-leak");
          expect(errors).toEqual([]);
        } finally {
          releaseRun?.();
          finishHeadlessInput?.();
          await runtime.close();
        }
      });
    } finally {
      releaseRun?.();
      await gateway.close().catch(() => {});
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);
});

async function startTcpProxy(targetPort: number, port = 0): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.createConnection({ host: "127.0.0.1", port: targetPort });
    sockets.add(client);
    sockets.add(upstream);
    const cleanup = () => {
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", cleanup);
    upstream.on("close", cleanup);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("TCP proxy did not bind to an IPv4 port.");
  }
  let closed = false;
  return {
    port: address.port,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
