import { describe, expect, it, vi } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "./contracts.js";
import { CodingRunClient } from "./stdio.js";

describe("CodingRunClient", () => {
  it("maps the six consumer lifecycle methods to exact v1 frames", async () => {
    const written: Array<Record<string, unknown>> = [];
    let requestNumber = 0;
    const client = new CodingRunClient({
      write: (line) => { written.push(JSON.parse(line) as Record<string, unknown>); },
      createRequestId: () => `request-${++requestNumber}`,
    });
    const expectRequest = async (
      pending: Promise<unknown>,
      expected: Record<string, unknown>,
      responseType: string,
      result: unknown,
    ) => {
      const frame = written.shift();
      expect(frame).toEqual(expected);
      client.consume(`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: responseType,
        id: expected.id,
        ok: true,
        result,
      })}\n`);
      await expect(pending).resolves.toEqual(result);
    };

    await expectRequest(client.start({
      prompt: "Inspect the workspace.",
      cwd: process.cwd(),
      conversationId: "conversation-1",
    }), {
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "conversation.request",
      id: "request-1",
      conversation: {
        version: CODING_RUN_PROTOCOL_VERSION,
        text: "Inspect the workspace.",
        cwd: process.cwd(),
        conversationId: "conversation-1",
      },
    }, "conversation.response", {
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    });

    await expectRequest(client.subscribeRun({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      cursor: 7,
    }), {
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "subscription.request",
      id: "request-2",
      subscription: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        cursor: 7,
      },
    }, "subscription.response", { latestSeq: 7 });

    await expectRequest(client.respondPermission({
      agentRunId: "run-1",
      worktreeId: "worktree-1",
      toolCallId: "tool-1",
      decision: "allow",
    }), {
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.request",
      id: "request-3",
      control: {
        version: CODING_RUN_PROTOCOL_VERSION,
        operation: "permission.respond",
        binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
        toolCallId: "tool-1",
        decision: "allow",
      },
    }, "control.response", { accepted: true });

    await expectRequest(client.steer({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      prompt: "Focus on the failing test.",
      idempotencyKey: "steer-1",
    }), {
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.request",
      id: "request-4",
      control: {
        version: CODING_RUN_PROTOCOL_VERSION,
        operation: "conversation.steer",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        prompt: "Focus on the failing test.",
        idempotencyKey: "steer-1",
      },
    }, "control.response", { accepted: true });

    await expectRequest(client.cancel({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      reason: "consumer requested cancellation",
    }), {
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.request",
      id: "request-5",
      control: {
        version: CODING_RUN_PROTOCOL_VERSION,
        operation: "cancel",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        reason: "consumer requested cancellation",
      },
    }, "control.response", { accepted: true });

    await expectRequest(client.readArtifact({
      agentRunId: "run-1",
      workspaceId: "workspace-1",
    }), {
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "artifact.request",
      id: "request-6",
      artifact: { revisionId: "run-1", workspaceId: "workspace-1" },
    }, "artifact.response", { revisionId: "run-1", canRestore: true });
  });

  it("times out only the local wait and ignores a late response", async () => {
    vi.useFakeTimers();
    const written: Array<Record<string, unknown>> = [];
    const client = new CodingRunClient({
      write: (line) => { written.push(JSON.parse(line) as Record<string, unknown>); },
      createRequestId: () => "timeout-1",
      requestTimeoutMs: 50,
    });
    try {
      const pending = client.cancel({ conversationId: "conversation-1", agentRunId: "run-1" });
      const settled = pending.then(
        () => ({ state: "resolved" }),
        (error: unknown) => ({
          state: "rejected",
          name: error instanceof Error ? error.name : "",
          code: (error as { code?: unknown } | undefined)?.code,
          message: error instanceof Error ? error.message : "",
        }),
      );

      await vi.advanceTimersByTimeAsync(50);
      await expect(Promise.race([settled, Promise.resolve({ state: "pending" })])).resolves.toEqual({
        state: "rejected",
        name: "CodingRunClientRequestError",
        code: "request_timeout",
        message: "Coding run request timed out.",
      });

      client.consume(`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.response",
        id: "timeout-1",
        ok: true,
        result: { accepted: true },
      })}\n`);
      await expect(settled).resolves.toMatchObject({ state: "rejected", code: "request_timeout" });
      expect(written).toHaveLength(1);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("honors AbortSignal without writing an already-aborted request", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const client = new CodingRunClient({
      write: (line) => { written.push(line); },
      createRequestId: () => "abort-1",
    });
    try {
      const beforeWrite = new AbortController();
      beforeWrite.abort();
      await expect(client.steer({
        conversationId: "conversation-1",
        agentRunId: "run-1",
        prompt: "Do not send this.",
        idempotencyKey: "abort-before-write",
      }, { signal: beforeWrite.signal })).rejects.toMatchObject({
        name: "CodingRunClientRequestError",
        code: "request_aborted",
        message: "Coding run request was aborted.",
      });
      expect(written).toHaveLength(0);

      const afterWrite = new AbortController();
      const pending = client.cancel({
        conversationId: "conversation-1",
        agentRunId: "run-1",
      }, { signal: afterWrite.signal });
      expect(written).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
      afterWrite.abort();
      await expect(pending).rejects.toMatchObject({ code: "request_aborted" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("closes every pending request and clears its lifecycle resources", async () => {
    vi.useFakeTimers();
    const client = new CodingRunClient({ write: () => undefined });
    try {
      const first = client.cancel({ conversationId: "conversation-1", agentRunId: "run-1" });
      const second = client.readArtifact({ agentRunId: "run-1" });
      expect(vi.getTimerCount()).toBe(2);

      client.close("Consumer closed the SDK.");

      await expect(first).rejects.toMatchObject({ code: "client_closed", message: "Consumer closed the SDK." });
      await expect(second).rejects.toMatchObject({ code: "client_closed", message: "Consumer closed the SDK." });
      expect(vi.getTimerCount()).toBe(0);
      await expect(client.cancel({
        conversationId: "conversation-1",
        agentRunId: "run-1",
      })).rejects.toMatchObject({ code: "client_closed" });
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("fails a relative cwd locally and allows explicit cursor resubscription", async () => {
    const written: Array<Record<string, unknown>> = [];
    let requestNumber = 0;
    const client = new CodingRunClient({
      write: (line) => { written.push(JSON.parse(line) as Record<string, unknown>); },
      createRequestId: () => `cursor-${++requestNumber}`,
    });

    await expect(client.start({ prompt: "Inspect.", cwd: "relative-workspace" })).rejects.toMatchObject({
      code: "invalid_request",
      message: "Invalid coding run conversation request.",
    });
    expect(written).toHaveLength(0);

    const first = client.subscribeRun({ conversationId: "conversation-1", agentRunId: "run-1", cursor: 4 });
    expect(written[0]).toMatchObject({
      id: "cursor-1",
      subscription: { cursor: 4 },
    });
    client.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "subscription.response",
      id: "cursor-1",
      ok: true,
      result: { latestSeq: 8 },
    })}\n`);
    await expect(first).resolves.toEqual({ latestSeq: 8 });

    const resumed = client.subscribeRun({ conversationId: "conversation-1", agentRunId: "run-1", cursor: 8 });
    expect(written[1]).toMatchObject({
      id: "cursor-2",
      subscription: { cursor: 8 },
    });
    client.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "subscription.response",
      id: "cursor-2",
      ok: true,
      result: { latestSeq: 9 },
    })}\n`);
    await expect(resumed).resolves.toEqual({ latestSeq: 9 });
    client.close();
  });

  it("returns safe typed errors for transport and Gateway failures", async () => {
    const transportClient = new CodingRunClient({
      write: () => { throw new Error("token=transport-secret"); },
    });
    let transportFailure: Promise<unknown> | undefined;
    expect(() => {
      transportFailure = transportClient.cancel({ conversationId: "conversation-1", agentRunId: "run-1" });
    }).not.toThrow();
    await expect(transportFailure).rejects.toMatchObject({
      name: "CodingRunClientRequestError",
      code: "transport_error",
      message: "token=[REDACTED]",
    });

    const written: Array<Record<string, unknown>> = [];
    const gatewayClient = new CodingRunClient({
      write: (line) => { written.push(JSON.parse(line) as Record<string, unknown>); },
      createRequestId: () => "gateway-error-1",
    });
    const gatewayFailure = gatewayClient.respondPermission({
      agentRunId: "run-1",
      toolCallId: "tool-1",
      decision: "deny",
    });
    gatewayClient.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.response",
      id: "gateway-error-1",
      ok: false,
      error: { code: "permission_denied", message: "token=gateway-secret" },
    })}\n`);
    await expect(gatewayFailure).rejects.toMatchObject({
      name: "CodingRunClientRequestError",
      code: "permission_denied",
      message: "token=[REDACTED]",
    });
    gatewayClient.close();
    expect(written).toHaveLength(1);
  });

  it("fails closed on an undeclared control error code", async () => {
    vi.useFakeTimers();
    const protocolErrors: unknown[] = [];
    const client = new CodingRunClient({
      write: () => undefined,
      createRequestId: () => "invalid-error-code-1",
      requestTimeoutMs: 20,
      onProtocolError: (error) => protocolErrors.push(error),
    });
    try {
      const pending = client.cancel({ conversationId: "conversation-1", agentRunId: "run-1" });
      const timedOut = expect(pending).rejects.toMatchObject({ code: "request_timeout" });
      client.consume(`${JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.response",
        id: "invalid-error-code-1",
        ok: false,
        error: { code: "unexpected_gateway_code", message: "token=must-not-surface" },
      })}\n`);

      expect(protocolErrors).toEqual([{
        code: "invalid_frame",
        message: "Invalid coding run NDJSON frame.",
      }]);
      await vi.advanceTimersByTimeAsync(20);
      await timedOut;
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });
});
