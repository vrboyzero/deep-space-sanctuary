import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ConversationStore, type BelldandyAgent } from "@belldandy/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { ConversationRunRegistry } from "../conversation-run-registry.js";
import { startGatewayServer } from "../server.js";
import { cleanupGlobalMemoryManagersForTest, pairWebSocketClient, resolveWebRoot, waitFor } from "../server-testkit.js";
import {
  createTaskCapabilityClosureResolver,
  createUnknownTaskCapabilityClosure,
  type TaskCapabilityClosureResolverInput,
} from "./task-capability-closure.js";
import { createProductionTaskCapabilityClosureOwner } from "./production-task-capability-owner.js";

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("task capability closure message.send gate", () => {
  it("rejects an unavailable required capability before persistence, registration, or Agent execution", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-task-capability-gate-"));
    const conversationId = "conversation-capability-blocked";
    const conversationStore = new ConversationStore({ dataDir: path.join(stateDir, "sessions") });
    const conversationRunRegistry = new ConversationRunRegistry();
    const run = vi.fn(async function* () {
      yield { type: "final" as const, text: "must not run" };
    });
    const resolve = vi.fn((_binding: TaskCapabilityClosureResolverInput) => ({
      ...createUnknownTaskCapabilityClosure(10),
      status: "blocked" as const,
      capabilities: {
        ...createUnknownTaskCapabilityClosure(10).capabilities,
        sandbox: { required: true, state: "unavailable" as const, reasonCode: "not_configured" },
      },
    }));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
      conversationRunRegistry,
      taskCapabilityClosureResolver: createTaskCapabilityClosureResolver({ resolve }),
      agentFactory: () => ({ run }) as BelldandyAgent,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: Array<Record<string, any>> = [];
    const closePromise = new Promise<void>((resolveClose) => ws.once("close", () => resolveClose()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;
      ws.send(JSON.stringify({
        type: "req",
        id: "message-send-capability-blocked",
        method: "message.send",
        params: {
          conversationId,
          text: "run bounded task",
          codingRun: { cwd: stateDir },
        },
      }));

      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "message-send-capability-blocked"));
      expect(frames.find((frame) => frame.type === "res" && frame.id === "message-send-capability-blocked")).toMatchObject({
        ok: false,
        error: {
          code: "policy_denied",
          message: "Task capability closure rejected the run: required_capability_unavailable:sandbox.",
        },
      });
      expect(resolve).toHaveBeenCalledOnce();
      const binding = resolve.mock.calls[0]?.[0];
      expect(binding).toMatchObject({
        taskId: `conversation:${conversationId}:${binding?.agentRunId}`,
        source: "conversation",
        agentRunId: expect.any(String),
      });
      expect(run).not.toHaveBeenCalled();
      expect(conversationRunRegistry.listActiveRuns()).toEqual([]);
      await conversationStore.waitForPendingPersistence(conversationId);
      expect(await conversationStore.getSessionTranscriptEvents(conversationId)).toEqual([]);
    } finally {
      ws.close();
      await closePromise;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("keeps coding runs compatible when no task capability closure resolver is configured", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-task-capability-compatible-"));
    const run = vi.fn(async function* () {
      yield { type: "final" as const, text: "completed" };
      yield { type: "status" as const, status: "done" as const };
    });
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => ({ run }) as BelldandyAgent,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: Array<Record<string, any>> = [];
    const closePromise = new Promise<void>((resolveClose) => ws.once("close", () => resolveClose()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;
      ws.send(JSON.stringify({
        type: "req",
        id: "message-send-capability-compatible",
        method: "message.send",
        params: {
          conversationId: "conversation-capability-compatible",
          text: "run bounded task",
          codingRun: { cwd: stateDir },
        },
      }));

      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "message-send-capability-compatible"));
      expect(frames.find((frame) => frame.type === "res" && frame.id === "message-send-capability-compatible")).toMatchObject({
        ok: true,
      });
      await waitFor(() => frames.some((frame) => frame.type === "event" && frame.event === "chat.final"));
      expect(run).toHaveBeenCalledOnce();
    } finally {
      ws.close();
      await closePromise;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("fails closed when requirements are explicit but no capability resolver is configured", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-task-capability-owner-missing-"));
    const conversationId = "conversation-capability-owner-missing";
    const conversationStore = new ConversationStore({ dataDir: path.join(stateDir, "sessions") });
    const run = vi.fn(async function* () {
      yield { type: "final" as const, text: "must not run" };
    });
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
      agentFactory: () => ({ run }) as BelldandyAgent,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: Array<Record<string, any>> = [];
    const closePromise = new Promise<void>((resolveClose) => ws.once("close", () => resolveClose()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;
      ws.send(JSON.stringify({
        type: "req",
        id: "message-send-capability-owner-missing",
        method: "message.send",
        params: {
          conversationId,
          text: "run traced task",
          codingRun: {
            cwd: stateDir,
            requiredCapabilities: { schemaVersion: 1, capabilities: ["trace"] },
          },
        },
      }));

      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "message-send-capability-owner-missing"));
      expect(frames.find((frame) => frame.type === "res" && frame.id === "message-send-capability-owner-missing")).toMatchObject({
        ok: false,
        error: {
          code: "policy_denied",
          message: "Task capability closure rejected the run: capability_closure_unknown.",
        },
      });
      expect(run).not.toHaveBeenCalled();
      await conversationStore.waitForPendingPersistence(conversationId);
      expect(await conversationStore.getSessionTranscriptEvents(conversationId)).toEqual([]);
    } finally {
      ws.close();
      await closePromise;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("publishes one active exact-bound production snapshot and releases it after completion", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-task-capability-active-"));
    const conversationId = "conversation-capability-active";
    let finishRun!: () => void;
    const waitForFinish = new Promise<void>((resolve) => { finishRun = resolve; });
    const run = vi.fn(async function* () {
      await waitForFinish;
      yield { type: "final" as const, text: "completed" };
      yield { type: "status" as const, status: "done" as const };
    });
    const owner = createProductionTaskCapabilityClosureOwner({
      now: () => 30,
      readTrace: () => ({ available: true, reasonCode: "gateway_event_broker" }),
    });
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      taskCapabilityClosureResolver: owner,
      agentFactory: () => ({ run }) as BelldandyAgent,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: Array<Record<string, any>> = [];
    const closePromise = new Promise<void>((resolveClose) => ws.once("close", () => resolveClose()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;
      ws.send(JSON.stringify({
        type: "req",
        id: "message-send-capability-active",
        method: "message.send",
        params: {
          conversationId,
          text: "run traced task",
          codingRun: {
            cwd: stateDir,
            requiredCapabilities: { schemaVersion: 1, capabilities: ["trace"] },
          },
        },
      }));

      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "message-send-capability-active"));
      const sendResponse = frames.find((frame) => frame.type === "res" && frame.id === "message-send-capability-active");
      expect(sendResponse).toMatchObject({ ok: true, payload: { runId: expect.any(String) } });
      const runId = sendResponse?.payload?.runId as string;
      const binding = {
        taskId: `conversation:${conversationId}:${runId}`,
        source: "conversation" as const,
        agentRunId: runId,
      };
      expect(owner.resolve(binding)).toMatchObject({
        evaluatedAtMs: 30,
        status: "satisfied",
        capabilities: { trace: { required: true, state: "available", reasonCode: "gateway_event_broker" } },
      });

      ws.send(JSON.stringify({
        type: "req",
        id: "task-projection-capability-active",
        method: "task.projection.list",
        params: {},
      }));
      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "task-projection-capability-active"));
      const projectionResponse = frames.find((frame) => frame.type === "res" && frame.id === "task-projection-capability-active");
      expect(projectionResponse?.payload?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          taskId: binding.taskId,
          capabilityClosure: expect.objectContaining({
            evaluatedAtMs: 30,
            status: "satisfied",
            capabilities: expect.objectContaining({ trace: expect.objectContaining({ state: "available" }) }),
          }),
          supportingEvidence: expect.objectContaining({
            journal: expect.objectContaining({
              status: "pending",
              observedAtMs: expect.any(Number),
            }),
          }),
        }),
      ]));

      finishRun();
      await waitFor(() => frames.some((frame) => frame.type === "event" && frame.event === "chat.final"));
      await waitFor(() => owner.resolve(binding)?.status === "unknown");
      expect(owner.resolve(binding)).toMatchObject({
        status: "unknown",
        capabilities: { tools: { reasonCode: "not_evaluated" } },
      });
    } finally {
      finishRun();
      ws.close();
      await closePromise;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
