import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  buildRecoveredCodingCiArtifacts,
  mergeRecoveredAgentEvents,
  runCodingRunCursorContinuation,
  startGatewayDisconnectProxy,
} from "./coding-agent-recovery-harness.mjs";

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("coding agent recovery harness", () => {
  it("preserves the Headless Origin and disconnects only after forwarding the first recovery write", async () => {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    cleanups.push(async () => await closeWebSocketServer(upstream));
    const upstreamPort = upstream.address().port;

    let upstreamOrigin;
    upstream.on("connection", (socket, request) => {
      upstreamOrigin = request.headers.origin;
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString("utf-8"));
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "message.send") return;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { conversationId: "conversation-recovery", runId: "run-recovery" },
        }));
        for (const gatewayFrame of [
          { event: "agent.status", payload: { conversationId: "conversation-recovery", runId: "run-recovery", status: "running" } },
          { event: "chat.delta", payload: { conversationId: "conversation-recovery", runId: "run-recovery", delta: "working" } },
          {
            event: "tool_call",
            payload: {
              conversationId: "conversation-recovery",
              runId: "run-recovery",
              id: "tool-write-1",
              name: "apply_patch",
              arguments: { patch: "*** Update File: src/recovery-target.txt" },
            },
          },
        ]) {
          socket.send(JSON.stringify({ type: "event", ...gatewayFrame }));
        }
      });
    });

    const proxy = await startGatewayDisconnectProxy({
      upstreamHost: "127.0.0.1",
      upstreamPort,
      targetPath: "src/recovery-target.txt",
    });
    cleanups.push(async () => await proxy.close());
    const client = new WebSocket(`ws://127.0.0.1:${proxy.port}`, { origin: "http://127.0.0.1" });
    const received = [];
    client.on("message", (data) => {
      const frame = JSON.parse(data.toString("utf-8"));
      received.push(frame);
      if (frame.type === "connect.challenge") {
        client.send(JSON.stringify({ type: "connect", role: "cli" }));
      }
      if (frame.type === "hello-ok") {
        client.send(JSON.stringify({ type: "req", id: "run-request", method: "message.send", params: {} }));
      }
    });

    await once(client, "close");
    const fault = await proxy.waitForFault();

    expect(upstreamOrigin).toBe("http://127.0.0.1");
    expect(received.some((frame) => frame.event === "tool_call")).toBe(true);
    expect(fault).toMatchObject({
      status: "injected",
      disconnectCount: 1,
      disconnectedAfterSeq: 4,
      binding: { conversationId: "conversation-recovery", agentRunId: "run-recovery" },
    });
  });

  it("delays corrected v2 disconnect until the bound mutation succeeded and changed content", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "coding-recovery-v2-mutation-"));
    cleanups.push(async () => await fs.rm(workspace, { recursive: true, force: true }));
    const targetPath = path.join(workspace, "src", "recovery-target.txt");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, "recovery-marker=initial\n", "utf-8");

    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    cleanups.push(async () => await closeWebSocketServer(upstream));
    upstream.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString("utf-8"));
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "message.send") return;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { conversationId: "conversation-v2", runId: "run-v2" },
        }));
        socket.send(JSON.stringify({
          type: "event",
          event: "tool_call",
          payload: {
            conversationId: "conversation-v2",
            runId: "run-v2",
            id: "tool-write-v2",
            name: "file_write",
            arguments: { path: "src/recovery-target.txt", content: "recovery-marker=completed-once\n" },
          },
        }));
        setTimeout(async () => {
          await fs.writeFile(targetPath, "recovery-marker=completed-once\n", "utf-8");
          socket.send(JSON.stringify({
            type: "event",
            event: "tool_result",
            payload: {
              conversationId: "conversation-v2",
              runId: "run-v2",
              id: "tool-write-v2",
              name: "file_write",
              success: true,
            },
          }));
        }, 30);
      });
    });

    const proxy = await startGatewayDisconnectProxy({
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.address().port,
      targetPath: "src/recovery-target.txt",
      workspace,
      requireCompletedMutation: true,
    });
    cleanups.push(async () => await proxy.close());
    const client = new WebSocket(`ws://127.0.0.1:${proxy.port}`, { origin: "http://127.0.0.1" });
    const receivedEvents = [];
    client.on("message", (data) => {
      const frame = JSON.parse(data.toString("utf-8"));
      if (frame.event) receivedEvents.push(frame.event);
      if (frame.type === "connect.challenge") client.send(JSON.stringify({ type: "connect", role: "cli" }));
      if (frame.type === "hello-ok") {
        client.send(JSON.stringify({ type: "req", id: "run-request-v2", method: "message.send", params: {} }));
      }
    });

    await once(client, "close");
    const fault = await proxy.waitForFault();

    expect(receivedEvents).toEqual(["tool_call", "tool_result"]);
    expect(fault).toMatchObject({
      status: "injected",
      disconnectedAfterSeq: 3,
      binding: { conversationId: "conversation-v2", agentRunId: "run-v2" },
      mutation: {
        trigger: "successful_tool_result_after_content_change",
        toolCallId: "tool-write-v2",
        targetPath: "src/recovery-target.txt",
        resultSuccess: true,
      },
    });
    expect(fault.mutation.afterSha256).not.toBe(fault.mutation.beforeSha256);
  });

  it("uses an explicit Gateway origin for strict upstream Origin policies", async () => {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    cleanups.push(async () => await closeWebSocketServer(upstream));
    const upstreamOrigin = new Promise((resolve) => {
      upstream.once("connection", (_socket, request) => resolve(request.headers.origin));
    });
    const proxy = await startGatewayDisconnectProxy({
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.address().port,
      upstreamOrigin: "http://127.0.0.1:28889",
      targetPath: "src/recovery-target.txt",
    });
    cleanups.push(async () => await proxy.close());
    const client = new WebSocket(`ws://127.0.0.1:${proxy.port}`, { origin: "http://127.0.0.1:45678" });
    cleanups.push(async () => client.terminate());

    await expect(upstreamOrigin).resolves.toBe("http://127.0.0.1:28889");
  });

  it("merges the confirmed Headless prefix with one cursor continuation and one terminal", () => {
    const binding = { conversationId: "conversation-recovery", agentRunId: "run-recovery" };
    const initial = [
      event(1, "run.started", binding),
      event(2, "run.status", binding),
      event(3, "message.delta", binding),
      event(4, "tool.started", binding, { tool: { id: "tool-write-1", name: "apply_patch" } }),
      event(5, "run.failed", binding),
    ];
    const resumed = [
      event(5, "tool.completed", binding, { tool: { id: "tool-write-1", name: "apply_patch", success: true } }),
      event(6, "run.completed", binding, { output: { text: "{\"summary\":\"done\"}" } }),
    ];

    expect(mergeRecoveredAgentEvents({ initial, resumed, cursor: 4 })).toEqual([
      ...initial.slice(0, 4),
      ...resumed,
    ]);
  });

  it("keeps failed write attempts when exactly one write completes successfully", () => {
    const binding = { conversationId: "conversation-recovery", agentRunId: "run-recovery" };
    const initial = [
      event(1, "run.started", binding),
      event(2, "tool.started", binding, { tool: { id: "tool-write-failed", name: "apply_patch" } }),
      event(3, "tool.completed", binding, {
        tool: { id: "tool-write-failed", name: "apply_patch", success: false },
      }),
      event(4, "tool.started", binding, { tool: { id: "tool-write-success", name: "file_write" } }),
      event(5, "tool.completed", binding, {
        tool: { id: "tool-write-success", name: "file_write", success: true },
      }),
      event(6, "run.failed", binding),
    ];
    const resumed = [
      event(6, "run.completed", binding, { output: { text: "{\"summary\":\"done\"}" } }),
    ];

    expect(mergeRecoveredAgentEvents({ initial, resumed, cursor: 5 })).toEqual([
      ...initial.slice(0, 5),
      ...resumed,
    ]);
  });

  it("normalizes recovered bindings so artifact equality is independent of source key order", () => {
    const binding = { conversationId: "conversation-recovery", agentRunId: "run-recovery" };
    const events = mergeRecoveredAgentEvents({
      initial: [
        event(1, "run.started", binding),
        event(2, "tool.started", binding, { tool: { id: "tool-write-1", name: "file_write" } }),
      ],
      cursor: 2,
      resumed: [
        event(3, "tool.completed", { agentRunId: "run-recovery", conversationId: "conversation-recovery" }, {
          tool: { id: "tool-write-1", name: "file_write", success: true },
        }),
        event(4, "run.completed", { agentRunId: "run-recovery", conversationId: "conversation-recovery" }, {
          output: { text: "{\"summary\":\"done\"}" },
        }),
      ],
    });

    expect(events.map((item) => JSON.stringify(item.binding))).toEqual([
      JSON.stringify(binding),
      JSON.stringify(binding),
      JSON.stringify(binding),
      JSON.stringify(binding),
    ]);
  });

  it("rejects a gap, binding change, or duplicate recovery side effect", () => {
    const binding = { conversationId: "conversation-recovery", agentRunId: "run-recovery" };
    const initial = [
      event(1, "run.started", binding),
      event(2, "tool.started", binding, { tool: { id: "tool-write-1", name: "file_write" } }),
      event(3, "tool.completed", binding, {
        tool: { id: "tool-write-1", name: "file_write", success: true },
      }),
    ];
    expect(() => mergeRecoveredAgentEvents({
      initial,
      cursor: 2,
      resumed: [event(4, "run.completed", binding)],
    })).toThrow(/sequence|cursor/i);
    expect(() => mergeRecoveredAgentEvents({
      initial,
      cursor: 3,
      resumed: [
        event(4, "tool.started", binding, { tool: { id: "tool-write-2", name: "file_write" } }),
        event(5, "tool.completed", binding, {
          tool: { id: "tool-write-2", name: "file_write", success: true },
        }),
        event(6, "run.completed", binding),
      ],
    })).toThrow(/mutation/i);
  });

  it("continues one bound run through the existing coding-run stdio protocol", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-recovery-stdio-"));
    cleanups.push(async () => await fs.rm(root, { recursive: true, force: true }));
    const bddEntry = path.join(root, "fake-bdd.mjs");
    await fs.writeFile(bddEntry, [
      "process.stdin.setEncoding('utf-8');",
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; const line = input.split(/\\r?\\n/).find(Boolean); if (!line) return; input = ''; const request = JSON.parse(line); const binding = request.subscription.binding;",
      "process.stdout.write(JSON.stringify({ version: 'v1', type: 'subscription.response', id: request.id, ok: true, result: { earliestSeq: 1, latestSeq: 2 } }) + '\\n');",
      "process.stdout.write(JSON.stringify({ version: 'v1', type: 'event', event: { version: 'v1', seq: 3, timestamp: 1700000000003, type: 'tool.completed', binding, payload: { tool: { id: 'tool-write-1', name: 'file_write', success: true } } } }) + '\\n');",
      "process.stdout.write(JSON.stringify({ version: 'v1', type: 'event', event: { version: 'v1', seq: 4, timestamp: 1700000000004, type: 'run.completed', binding, payload: { output: { text: '{\\\"summary\\\":\\\"done\\\"}' } } } }) + '\\n');",
      "});",
    ].join("\n"), "utf-8");

    await expect(runCodingRunCursorContinuation({
      bddEntry,
      stateDir: root,
      binding: { conversationId: "conversation-recovery", agentRunId: "run-recovery" },
      cursor: 2,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      exitCode: 0,
      events: [{ seq: 3 }, { seq: 4, type: "run.completed" }],
    });
  });

  it("builds one coherent recovered CI manifest without hiding the injected fault", () => {
    const binding = { conversationId: "conversation-recovery", agentRunId: "run-recovery" };
    const capabilities = fixtureCapabilities();
    const completeUsage = fixtureCompleteUsage();
    const initial = [
      event(1, "run.started", binding, { capabilities }),
      event(2, "tool.started", binding, {
        tool: { id: "tool-write-1", name: "file_write", arguments: { path: "src/recovery-target.txt" } },
      }),
      event(3, "run.failed", binding, {
        usage: { status: "incomplete", reason: "provider_usage_missing" },
      }),
    ];
    const resumed = [
      event(3, "tool.completed", binding, { tool: { id: "tool-write-1", name: "file_write", success: true } }),
      event(4, "run.completed", binding, {
        output: { text: "{\"summary\":\"done\"}" },
        usage: completeUsage,
      }),
    ];

    expect(buildRecoveredCodingCiArtifacts({
      initialEvents: initial,
      resumedEvents: resumed,
      initialManifest: {
        schemaVersion: "coding-agent-ci/v1",
        protocolVersion: "v1",
        mode: "recovery-control",
        limits: { timeoutMs: 300000, maxTurns: 12, maxTokens: 24000 },
        cliExitCode: 4,
        eventCount: 3,
        terminalType: "run.failed",
        binding,
        capabilities: { schemaVersion: "stale-capabilities" },
        usage: { status: "incomplete", reason: "provider_usage_missing" },
        changedPaths: [],
        checks: {
          cleanBaseline: true,
          eventContract: true,
          capabilityHandshake: false,
          usageComplete: false,
          artifactPolicy: true,
          automaticPush: false,
        },
      },
      workspaceArtifact: {
        changedPaths: ["src/recovery-target.txt"],
        patch: "fixture patch",
      },
      fault: {
        schemaVersion: "coding-agent-fault-injection/v1",
        taskId: "gateway.disconnect-recovery",
        fault: "gateway_disconnect",
        status: "injected",
        disconnectedAfterSeq: 2,
        resumedFromSeq: null,
        disconnectCount: 1,
        reconnectCount: 0,
        binding,
      },
    })).toMatchObject({
      result: { summary: "done" },
      manifest: {
        cliExitCode: 0,
        eventCount: 4,
        terminalType: "run.completed",
        capabilities,
        usage: completeUsage,
        changedPaths: ["src/recovery-target.txt"],
        checks: {
          eventContract: true,
          capabilityHandshake: true,
          usageComplete: true,
          artifactPolicy: true,
        },
      },
      fault: {
        status: "recovered",
        disconnectedAfterSeq: 2,
        resumedFromSeq: 2,
        disconnectCount: 1,
        reconnectCount: 1,
      },
    });
  });

  it("preserves recovered evidence when the terminal output is not raw JSON", () => {
    const binding = { conversationId: "conversation-recovery", agentRunId: "run-recovery" };
    const initial = [
      event(1, "run.started", binding),
      event(2, "tool.started", binding, {
        tool: { id: "tool-write-1", name: "file_write", arguments: { path: "src/recovery-target.txt" } },
      }),
      event(3, "tool.completed", binding, {
        tool: { id: "tool-write-1", name: "file_write", success: true },
      }),
      event(4, "run.failed", binding),
    ];
    const resumed = [
      event(4, "run.completed", binding, {
        output: { text: "```json\n{\"summary\":\"done\"}\n```" },
      }),
    ];

    expect(buildRecoveredCodingCiArtifacts({
      initialEvents: initial,
      resumedEvents: resumed,
      initialManifest: {
        schemaVersion: "coding-agent-ci/v1",
        protocolVersion: "v1",
        mode: "recovery-control",
        limits: { timeoutMs: 300000, maxTurns: 12, maxTokens: 24000 },
        cliExitCode: 4,
        eventCount: 4,
        terminalType: "run.failed",
        binding,
        changedPaths: [],
        checks: { cleanBaseline: true, eventContract: true, artifactPolicy: true, automaticPush: false },
      },
      workspaceArtifact: {
        changedPaths: ["src/recovery-target.txt"],
        patch: "fixture patch",
      },
      fault: {
        schemaVersion: "coding-agent-fault-injection/v1",
        taskId: "gateway.disconnect-recovery",
        fault: "gateway_disconnect",
        status: "injected",
        disconnectedAfterSeq: 3,
        resumedFromSeq: null,
        disconnectCount: 1,
        reconnectCount: 0,
        binding,
      },
    })).toMatchObject({
      result: null,
      manifest: {
        cliExitCode: 0,
        terminalType: "run.completed",
      },
      fault: {
        status: "recovered",
        resumedFromSeq: 3,
        reconnectCount: 1,
      },
    });
  });
});

function event(seq, type, binding, payload = {}) {
  return { version: "v1", seq, timestamp: 1_700_000_000_000 + seq, type, binding, payload };
}

function fixtureCapabilities() {
  return {
    schemaVersion: "coding-run-capabilities/v1",
    protocolVersion: "v1",
    eventStream: {
      sequence: "continuous",
      terminal: "exactly_one",
      usageCompleteness: "terminal",
    },
  };
}

function fixtureCompleteUsage() {
  return {
    status: "complete",
    reason: "provider_reported_all_model_calls",
    modelCalls: 1,
    providerReportedModelCalls: 1,
  };
}

async function closeWebSocketServer(server) {
  for (const client of server.clients) client.terminate();
  await new Promise((resolve) => server.close(resolve));
}
