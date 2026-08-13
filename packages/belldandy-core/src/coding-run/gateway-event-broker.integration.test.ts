import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import type { BelldandyAgent } from "@belldandy/agent";
import { startGatewayServer } from "../server.js";
import { cleanupGlobalMemoryManagersForTest, pairWebSocketClient, resolveWebRoot, waitFor } from "../server-testkit.js";
import { CODING_RUN_PROTOCOL_VERSION } from "./contracts.js";

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("coding.run.subscribe Gateway integration", () => {
  it("从真实 message.send 生命周期按精确 binding 重放 v1 事件", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-subscribe-"));
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "status" as const, status: "running" as const };
        yield { type: "delta" as const, delta: "streamed answer" };
        yield { type: "final" as const, text: "streamed answer" };
        yield { type: "status" as const, status: "done" as const };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: Array<Record<string, any>> = [];
    const closePromise = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;
      ws.send(JSON.stringify({
        type: "req",
        id: "message-send",
        method: "message.send",
        params: { conversationId: "conversation-subscribe", text: "hello" },
      }));
      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "message-send" && frame.ok === true));
      await waitFor(() => frames.some((frame) => frame.type === "event" && frame.event === "chat.final"));
      const run = frames.find((frame) => frame.type === "res" && frame.id === "message-send")?.payload;
      expect(run).toMatchObject({ conversationId: "conversation-subscribe" });

      ws.send(JSON.stringify({
        type: "req",
        id: "subscribe-exact",
        method: "coding.run.subscribe",
        params: {
          version: CODING_RUN_PROTOCOL_VERSION,
          binding: { conversationId: run.conversationId, agentRunId: run.runId },
          cursor: 0,
        },
      }));
      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "subscribe-exact" && frame.ok === true));
      await waitFor(() => frames.some((frame) => (
        frame.type === "event"
        && frame.event === "coding.run.event"
        && frame.payload?.event?.type === "run.completed"
      )));

      const subscriptionResponse = frames.find((frame) => frame.type === "res" && frame.id === "subscribe-exact");
      expect(subscriptionResponse?.payload?.efficiencyEvidence).toMatchObject({
        status: "complete",
        projectionTimeline: {
          source: "gateway_event_broker",
          coverage: "complete",
          binding: { conversationId: "conversation-subscribe", agentRunId: run.runId },
          statusCoverage: ["needs_input"],
          items: [
            { status: "running" },
            { status: "completed" },
          ],
        },
        humanInterventionEvidence: {
          source: "human_response",
          coverage: "complete",
          binding: { conversationId: "conversation-subscribe", agentRunId: run.runId },
          count: 0,
        },
      });
      const serializedEvidence = JSON.stringify(subscriptionResponse?.payload?.efficiencyEvidence);
      expect(serializedEvidence).not.toContain("hello");
      expect(serializedEvidence).not.toContain("streamed answer");
      expect(serializedEvidence).not.toContain("prompt");
      expect(serializedEvidence).not.toContain("output");
      expect(serializedEvidence).not.toContain("toolArgs");

      const replay = frames
        .filter((frame) => frame.type === "event" && frame.event === "coding.run.event")
        .map((frame) => frame.payload.event);
      expect(replay.map((event: Record<string, unknown>) => event.seq)).toEqual([...replay.keys()].map((index) => index + 1));
      expect(replay[0]).toMatchObject({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "run.started",
        binding: { conversationId: "conversation-subscribe", agentRunId: run.runId },
      });
      expect(replay.at(-1)).toMatchObject({ type: "run.completed", payload: { output: { text: "streamed answer" } } });

      ws.send(JSON.stringify({
        type: "req",
        id: "subscribe-stale",
        method: "coding.run.subscribe",
        params: {
          version: CODING_RUN_PROTOCOL_VERSION,
          binding: { conversationId: "other-conversation", agentRunId: run.runId },
        },
      }));
      await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "subscribe-stale"));
      expect(frames.find((frame) => frame.type === "res" && frame.id === "subscribe-stale")).toMatchObject({
        ok: false,
        error: { code: "run_mismatch" },
      });
    } finally {
      ws.close();
      await closePromise;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
