import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { ToolExecutor } from "@belldandy/skills";

import { CODING_RUN_PROTOCOL_VERSION } from "./contracts.js";
import { createCodingRunGatewayEventBroker } from "./gateway-event-broker.js";
import { PendingToolPermissionRuntime } from "./pending-tool-permission-runtime.js";
import { runCodingRunStdio } from "./stdio-process.js";
import { startGatewayServer } from "../server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  createWriteContractedTestTool,
  resolveWebRoot,
  sleep,
  waitFor,
  withEnv,
} from "../server-testkit.js";

async function* chunks(values: readonly string[]): AsyncIterable<string> {
  yield* values;
}

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("coding run stdio process bridge", () => {
  it("forwards a valid control to the injected Gateway bridge and writes NDJSON only", async () => {
    const output: string[] = [];
    const controls: unknown[] = [];
    const exitCode = await runCodingRunStdio({
      stateDir: "state-dir",
      input: chunks([`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.request",
        id: "request-1",
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "cancel",
          binding: { agentRunId: "run-1", conversationId: "conversation-1" },
        },
      })}\n`]),
      writeStdout: (line) => { output.push(line); },
      writeStderr: () => undefined,
      invokeGatewayControl: async (control) => {
        controls.push(control);
        return { ok: true, payload: { accepted: true } };
      },
    });

    expect(exitCode).toBe(0);
    expect(controls).toHaveLength(1);
    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.response",
      id: "request-1",
      ok: true,
      result: { accepted: true },
    }]);
  });

  it("maps a bounded Conversation request to the injected Gateway bridge", async () => {
    const output: string[] = [];
    const requests: unknown[] = [];
    const exitCode = await runCodingRunStdio({
      stateDir: "state-dir",
      input: chunks([`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "conversation.request",
        id: "conversation-1",
        conversation: {
          version: CODING_RUN_PROTOCOL_VERSION,
          text: "Inspect this workspace.",
          cwd: process.cwd(),
          conversationId: "conversation-existing",
        },
      })}\n`]),
      writeStdout: (line) => { output.push(line); },
      writeStderr: () => undefined,
      invokeGatewayConversation: async (request) => {
        requests.push(request);
        return {
          ok: true,
          payload: {
            binding: { conversationId: "conversation-existing", agentRunId: "run-created" },
          },
        };
      },
    });

    expect(exitCode).toBe(0);
    expect(requests).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      text: "Inspect this workspace.",
      cwd: process.cwd(),
      conversationId: "conversation-existing",
    }]);
    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "conversation.response",
      id: "conversation-1",
      ok: true,
      result: {
        binding: { conversationId: "conversation-existing", agentRunId: "run-created" },
      },
    }]);
  });

  it("maps a read-only artifact request to the injected Gateway bridge", async () => {
    const output: string[] = [];
    const requests: unknown[] = [];
    const exitCode = await runCodingRunStdio({
      stateDir: "state-dir",
      input: chunks([`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "artifact.request",
        id: "artifact-1",
        artifact: { revisionId: "run-1", workspaceId: "workspace-1" },
      })}\n`]),
      writeStdout: (line) => { output.push(line); },
      writeStderr: () => undefined,
      invokeGatewayArtifact: async (artifact) => {
        requests.push(artifact);
        return { ok: true, payload: { revisionId: "run-1", canRestore: true } };
      },
    });

    expect(exitCode).toBe(0);
    expect(requests).toEqual([{ revisionId: "run-1", workspaceId: "workspace-1" }]);
    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "artifact.response",
      id: "artifact-1",
      ok: true,
      result: { revisionId: "run-1", canRestore: true },
    }]);
  });

  it("maps a read-only TaskProjection request to the injected Gateway bridge", async () => {
    const output: string[] = [];
    const requests: unknown[] = [];
    const exitCode = await runCodingRunStdio({
      stateDir: "state-dir",
      input: chunks([`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "projection.request",
        id: "projection-1",
        projection: { limit: 10, cursor: { epoch: "epoch-1", revision: 2, offset: 1 } },
      })}\n`]),
      writeStdout: (line) => { output.push(line); },
      writeStderr: () => undefined,
      invokeGatewayProjection: async (projection) => {
        requests.push(projection);
        return { ok: true, payload: { epoch: "epoch-1", revision: 2, totalCount: 1, items: [] } };
      },
    });
    expect(exitCode).toBe(0);
    expect(requests).toEqual([{ limit: 10, cursor: { epoch: "epoch-1", revision: 2, offset: 1 } }]);
    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "projection.response",
      id: "projection-1",
      ok: true,
      result: { epoch: "epoch-1", revision: 2, totalCount: 1, items: [] },
    }]);
  });

  it("fails a real stdio projection cursor closed after Gateway restart", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-stdio-projection-restart-"));
    let firstGateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    const firstPort = firstGateway.port;
    try {
      const firstOutput: string[] = [];
      await withEnv({ BELLDANDY_HOST: "127.0.0.1", BELLDANDY_PORT: String(firstPort), BELLDANDY_AUTH_MODE: "none" }, async () => {
        const result = await runCodingRunStdio({
          stateDir,
          input: chunks([`${JSON.stringify({
            version: CODING_RUN_PROTOCOL_VERSION,
            type: "projection.request",
            id: "projection-before-restart",
            projection: { limit: 10 },
          })}\n`]),
          writeStdout: (line) => { firstOutput.push(line); },
          writeStderr: () => undefined,
        });
        expect(result).toBe(0);
      });
      const firstFrame = JSON.parse(firstOutput[0]) as { result?: { epoch?: string; revision?: number } };
      const oldCursor = { epoch: firstFrame.result?.epoch, revision: firstFrame.result?.revision, offset: 0 };
      expect(typeof oldCursor.epoch).toBe("string");
      expect(Number.isSafeInteger(oldCursor.revision)).toBe(true);

      await firstGateway.close();
      firstGateway = await startGatewayServer({
        port: 0,
        auth: { mode: "none" },
        webRoot: resolveWebRoot(),
        stateDir,
      });
      const secondOutput: string[] = [];
      await withEnv({ BELLDANDY_HOST: "127.0.0.1", BELLDANDY_PORT: String(firstGateway.port), BELLDANDY_AUTH_MODE: "none" }, async () => {
        const result = await runCodingRunStdio({
          stateDir,
          input: chunks([`${JSON.stringify({
            version: CODING_RUN_PROTOCOL_VERSION,
            type: "projection.request",
            id: "projection-after-restart",
            projection: { cursor: oldCursor },
          })}\n`]),
          writeStdout: (line) => { secondOutput.push(line); },
          writeStderr: () => undefined,
        });
        expect(result).toBe(0);
      });
      expect(JSON.parse(secondOutput[0])).toMatchObject({
        type: "projection.response",
        id: "projection-after-restart",
        ok: false,
        error: { code: "cursor_stale" },
      });
    } finally {
      await firstGateway.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("starts a real Gateway Conversation then subscribes to its streamed events through stdio", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-stdio-conversation-"));
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "status" as const, status: "running" as const };
        yield { type: "delta" as const, delta: "streamed workspace answer" };
        yield { type: "final" as const, text: "streamed workspace answer" };
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
    const frames: Array<Record<string, unknown>> = [];
    let binding: { conversationId: string; agentRunId: string } | undefined;
    let releaseConversationResponse: (() => void) | undefined;
    const conversationResponse = new Promise<void>((resolve) => { releaseConversationResponse = resolve; });
    let releaseCompleted: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => { releaseCompleted = resolve; });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(gateway.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const bridge = runCodingRunStdio({
          stateDir,
          input: (async function* () {
            yield `${JSON.stringify({
              version: CODING_RUN_PROTOCOL_VERSION,
              type: "conversation.request",
              id: "conversation-real-gateway",
              conversation: {
                version: CODING_RUN_PROTOCOL_VERSION,
                text: "Inspect this workspace.",
                cwd: stateDir,
                conversationId: "conversation-stdio",
              },
            })}\n`;
            await conversationResponse;
            if (!binding) throw new Error("Expected a complete Conversation binding.");
            yield `${JSON.stringify({
              version: CODING_RUN_PROTOCOL_VERSION,
              type: "subscription.request",
              id: "subscription-after-conversation",
              subscription: {
                version: CODING_RUN_PROTOCOL_VERSION,
                binding,
              },
            })}\n`;
            await completed;
          })(),
          writeStdout: (line) => {
            const frame = JSON.parse(line) as Record<string, unknown>;
            frames.push(frame);
            if (frame.type === "conversation.response" && frame.ok === true) {
              const responseBinding = (frame.result as { binding?: { conversationId?: string; agentRunId?: string } } | undefined)?.binding;
              if (responseBinding?.conversationId && responseBinding.agentRunId) {
                binding = { conversationId: responseBinding.conversationId, agentRunId: responseBinding.agentRunId };
                releaseConversationResponse?.();
              }
            }
            const event = frame.type === "event" ? frame.event as Record<string, unknown> | undefined : undefined;
            if (event?.type === "run.completed") releaseCompleted?.();
          },
          writeStderr: () => undefined,
        });

        await expect(bridge).resolves.toBe(0);
      });

      expect(binding).toEqual(expect.objectContaining({ conversationId: "conversation-stdio" }));
      expect(frames).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.response",
          id: "conversation-real-gateway",
          ok: true,
          result: { binding },
        }),
        expect.objectContaining({ type: "subscription.response", id: "subscription-after-conversation", ok: true }),
      ]));
      const events = frames
        .filter((frame) => frame.type === "event")
        .map((frame) => frame.event as Record<string, unknown>);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "message.delta", payload: { delta: "streamed workspace answer" } }),
        expect.objectContaining({
          type: "run.completed",
          payload: expect.objectContaining({
            output: { text: "streamed workspace answer" },
            usage: { status: "incomplete", reason: "usage_not_reported" },
          }),
        }),
      ]));
    } finally {
      releaseConversationResponse?.();
      releaseCompleted?.();
      await gateway.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("forwards an exact subscription and writes its response before queued event frames", async () => {
    const output: string[] = [];
    const subscription = {
      version: CODING_RUN_PROTOCOL_VERSION,
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      cursor: 0,
    } as const;
    const exitCode = await runCodingRunStdio({
      stateDir: "state-dir",
      input: chunks([`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "subscription.request",
        id: "subscription-1",
        subscription,
      })}\n`]),
      writeStdout: (line) => { output.push(line); },
      writeStderr: () => undefined,
      invokeGatewaySubscription: async (input) => {
        input.onEvent({
          version: CODING_RUN_PROTOCOL_VERSION,
          seq: 1,
          timestampMs: 1,
          source: "conversation",
          binding: { ...subscription.binding },
          type: "run.started",
          payload: { status: "running" },
        });
        return { ok: true, payload: { earliestSeq: 1, latestSeq: 1 } };
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(exitCode).toBe(0);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "subscription.response",
        id: "subscription-1",
        ok: true,
        result: { earliestSeq: 1, latestSeq: 1 },
      },
      {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "event",
        event: expect.objectContaining({ seq: 1, type: "run.started" }),
      },
    ]);
  });

  it("keeps a real Gateway session open long enough to replay subscribed events", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-stdio-subscription-"));
    const broker = createCodingRunGatewayEventBroker();
    broker.registerConversationRun({ conversationId: "conversation-1", agentRunId: "run-1" });
    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    });
    broker.publishGatewayEvent({
      event: "chat.final",
      payload: { conversationId: "conversation-1", runId: "run-1", text: "done" },
    });
    const gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      codingRunEventBroker: broker,
    });
    const originalHost = process.env.BELLDANDY_HOST;
    const originalPort = process.env.BELLDANDY_PORT;
    const originalAuthMode = process.env.BELLDANDY_AUTH_MODE;
    process.env.BELLDANDY_HOST = "127.0.0.1";
    process.env.BELLDANDY_PORT = String(gateway.port);
    process.env.BELLDANDY_AUTH_MODE = "none";
    const output: string[] = [];
    let releaseInput: (() => void) | undefined;
    const keepInputOpen = new Promise<void>((resolve) => { releaseInput = resolve; });

    try {
      const result = await runCodingRunStdio({
        stateDir,
        input: (async function* () {
          yield `${JSON.stringify({
            version: CODING_RUN_PROTOCOL_VERSION,
            type: "subscription.request",
            id: "subscription-real-gateway",
            subscription: {
              version: CODING_RUN_PROTOCOL_VERSION,
              binding: { conversationId: "conversation-1", agentRunId: "run-1" },
              cursor: 0,
            },
          })}\n`;
          await keepInputOpen;
        })(),
        writeStdout: (line) => {
          output.push(line);
          if (line.includes('"type":"event"') && line.includes('"run.completed"')) releaseInput?.();
        },
        writeStderr: () => undefined,
      });

      expect(result).toBe(0);
      const frames = output.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(frames[0]).toMatchObject({
        type: "subscription.response",
        id: "subscription-real-gateway",
        ok: true,
      });
      expect(frames.at(-1)).toMatchObject({
        type: "event",
        event: { type: "run.completed", seq: 3 },
      });
    } finally {
      if (originalHost === undefined) delete process.env.BELLDANDY_HOST;
      else process.env.BELLDANDY_HOST = originalHost;
      if (originalPort === undefined) delete process.env.BELLDANDY_PORT;
      else process.env.BELLDANDY_PORT = originalPort;
      if (originalAuthMode === undefined) delete process.env.BELLDANDY_AUTH_MODE;
      else process.env.BELLDANDY_AUTH_MODE = originalAuthMode;
      await gateway.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("reconnects to a restarted real Gateway from its last confirmed cursor without duplicating events", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-stdio-reconnect-"));
    const broker = createCodingRunGatewayEventBroker();
    const conversationId = "conversation-reconnect";
    const agentRunId = "run-reconnect";
    broker.registerConversationRun({ conversationId, agentRunId });
    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId, runId: agentRunId, status: "running" },
    });
    const subscribeSpy = vi.spyOn(broker, "subscribe");
    let gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      codingRunEventBroker: broker,
    });
    const port = gateway.port;
    const events: Array<Record<string, unknown>> = [];
    let releaseFirstStatus: (() => void) | undefined;
    const firstStatus = new Promise<void>((resolve) => { releaseFirstStatus = resolve; });
    let releaseRecoveredStatus: (() => void) | undefined;
    const recoveredStatus = new Promise<void>((resolve) => { releaseRecoveredStatus = resolve; });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const bridge = runCodingRunStdio({
          stateDir,
          input: (async function* () {
            yield `${JSON.stringify({
              version: CODING_RUN_PROTOCOL_VERSION,
              type: "subscription.request",
              id: "subscription-reconnect",
              subscription: {
                version: CODING_RUN_PROTOCOL_VERSION,
                binding: { conversationId, agentRunId },
                cursor: 0,
              },
            })}\n`;
            await recoveredStatus;
          })(),
          writeStdout: (line) => {
            const frame = JSON.parse(line) as Record<string, unknown>;
            const event = frame.type === "event" ? frame.event as Record<string, unknown> | undefined : undefined;
            if (!event) return;
            events.push(event);
            if (event.seq === 2) releaseFirstStatus?.();
            if (event.seq === 3) releaseRecoveredStatus?.();
          },
          writeStderr: () => undefined,
        });

        await firstStatus;
        await gateway.close();
        // 第一轮 200ms 重连在 Gateway 尚未重启时必须失败，后续固定重试才有意义。
        await sleep(300);
        gateway = await startGatewayServer({
          port,
          auth: { mode: "none" },
          webRoot: resolveWebRoot(),
          stateDir,
          codingRunEventBroker: broker,
        });
        broker.publishGatewayEvent({
          event: "agent.status",
          payload: { conversationId, runId: agentRunId, status: "waiting" },
        });

        await recoveredStatus;
        expect(await bridge).toBe(0);
      });

      expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(events.at(-1)).toMatchObject({ type: "run.status", payload: { status: "waiting" } });
      expect(subscribeSpy.mock.calls.map(([input]) => input.cursor)).toEqual([0, 2]);
    } finally {
      releaseFirstStatus?.();
      releaseRecoveredStatus?.();
      await gateway.close().catch(() => {});
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15_000);

  it("holds a real confirm tool until the stdio bridge allows or denies its exact pending request", async () => {
    const allow = await runGatewayPermissionScenario("allow");
    expect(allow.waitedForPermission).toBe(true);
    expect(allow.result).toMatchObject({ success: true, name: "confirm_write" });
    expect(allow.permissionEvent).toMatchObject({
      type: "permission.requested",
      payload: {
        permission: {
          toolCallId: "tool-allow",
          toolName: "confirm_write",
          worktreeId: "worktree-1",
        },
      },
    });
    expect(JSON.stringify(allow.permissionEvent)).not.toContain("must-not-leak");

    const deny = await runGatewayPermissionScenario("deny");
    expect(deny.waitedForPermission).toBe(true);
    expect(deny.result).toMatchObject({
      success: false,
      name: "confirm_write",
      failureKind: "permission_or_policy",
    });
  }, 30_000);

  it("preserves a safe Gateway rejection as a structured control error", async () => {
    const output: string[] = [];
    await runCodingRunStdio({
      stateDir: "state-dir",
      input: chunks([`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.request",
        id: "request-2",
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "cancel",
          binding: { agentRunId: "run-1", conversationId: "conversation-1" },
        },
      })}\n`]),
      writeStdout: (line) => { output.push(line); },
      writeStderr: () => undefined,
      invokeGatewayControl: async () => ({
        ok: false,
        error: { code: "run_mismatch", message: "Conversation run binding no longer matches the active Conversation run." },
      }),
    });

    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.response",
      id: "request-2",
      ok: false,
      error: {
        code: "run_mismatch",
        message: "Conversation run binding no longer matches the active Conversation run.",
      },
    }]);
  });

  it("reports an incomplete stdin frame before a clean process exit", async () => {
    const output: string[] = [];
    const exitCode = await runCodingRunStdio({
      stateDir: "state-dir",
      input: chunks(["{\"version\":\"v1\""]),
      writeStdout: (line) => { output.push(line); },
      writeStderr: () => undefined,
      invokeGatewayControl: async () => ({ ok: true, payload: {} }),
    });

    expect(exitCode).toBe(0);
    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "protocol.error",
      code: "invalid_frame",
      message: "Invalid coding run NDJSON frame.",
    }]);
  });
});

async function runGatewayPermissionScenario(decision: "allow" | "deny"): Promise<{
  waitedForPermission: boolean;
  permissionEvent: Record<string, unknown> | undefined;
  result: Awaited<ReturnType<ToolExecutor["execute"]>>;
}> {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `belldandy-coding-run-permission-${decision}-`));
  const broker = createCodingRunGatewayEventBroker();
  const conversationId = `conversation-${decision}`;
  const agentRunId = `run-${decision}`;
  const toolCallId = `tool-${decision}`;
  broker.registerConversationRun({ conversationId, agentRunId });
  const pendingPermissions = new PendingToolPermissionRuntime({
    onRequested: (request) => {
      broker.publishGatewayEvent({
        event: "tool_event",
        payload: {
          conversationId: request.conversationId,
          runId: request.agentRunId,
          kind: "coding_run_permission_requested",
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          ...(request.worktreeId ? { worktreeId: request.worktreeId } : {}),
          arguments: { token: "must-not-leak" },
        },
      });
    },
  });
  const toolExecutor = new ToolExecutor({
    tools: [createWriteContractedTestTool("confirm_write")],
    workspaceRoot: stateDir,
    permissionController: pendingPermissions,
  });
  const gateway = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    codingRunEventBroker: broker,
    pendingToolPermissionRuntime: pendingPermissions,
    toolExecutor,
  });
  const frames: Array<Record<string, unknown>> = [];
  let releasePermissionRequest: (() => void) | undefined;
  const permissionRequested = new Promise<void>((resolve) => { releasePermissionRequest = resolve; });
  let toolExecution: ReturnType<ToolExecutor["execute"]> | undefined;
  let toolFinished = false;
  let waitedForPermission = false;

  try {
    await withEnv({
      BELLDANDY_HOST: "127.0.0.1",
      BELLDANDY_PORT: String(gateway.port),
      BELLDANDY_AUTH_MODE: "none",
    }, async () => {
      const bridge = runCodingRunStdio({
        stateDir,
        input: (async function* () {
          yield `${JSON.stringify({
            version: CODING_RUN_PROTOCOL_VERSION,
            type: "subscription.request",
            id: `subscription-${decision}`,
            subscription: {
              version: CODING_RUN_PROTOCOL_VERSION,
              binding: { conversationId, agentRunId },
              cursor: 0,
            },
          })}\n`;
          await permissionRequested;
          yield `${JSON.stringify({
            version: CODING_RUN_PROTOCOL_VERSION,
            type: "control.request",
            id: `permission-${decision}`,
            control: {
              version: CODING_RUN_PROTOCOL_VERSION,
              operation: "permission.respond",
              binding: { agentRunId, worktreeId: "worktree-1" },
              toolCallId,
              decision,
            },
          })}\n`;
        })(),
        writeStdout: (line) => {
          const frame = JSON.parse(line) as Record<string, unknown>;
          frames.push(frame);
          if (frame.type === "subscription.response" && frame.ok === true && !toolExecution) {
            toolExecution = toolExecutor.execute(
              { id: toolCallId, name: "confirm_write", arguments: { token: "must-not-leak" } },
              conversationId,
              "default",
              undefined,
              undefined,
              undefined,
              {
                agentRunId,
                worktreeId: "worktree-1",
                launchSpec: { permissionMode: "confirm" },
              },
            );
            void toolExecution.then(() => { toolFinished = true; });
          }
          if (
            frame.type === "event"
            && (frame.event as Record<string, unknown> | undefined)?.type === "permission.requested"
          ) {
            waitedForPermission = !toolFinished;
            releasePermissionRequest?.();
          }
        },
        writeStderr: () => undefined,
      });

      await waitFor(() => frames.some((frame) => frame.type === "event"
        && (frame.event as Record<string, unknown> | undefined)?.type === "permission.requested"));
      expect(await bridge).toBe(0);
    });

    if (!toolExecution) throw new Error("Expected confirm tool execution to start after subscription.");
    const result = await toolExecution;
    return {
      waitedForPermission,
      permissionEvent: frames
        .map((frame) => frame.event)
        .find((event): event is Record<string, unknown> => Boolean(event)
          && (event as Record<string, unknown>).type === "permission.requested"),
      result,
    };
  } finally {
    releasePermissionRequest?.();
    await gateway.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}
