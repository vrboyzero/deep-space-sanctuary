import { describe, expect, it, vi } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION, type AgentRunEvent, type CodingRunSubscription } from "./contracts.js";
import {
  CodingRunNdjsonClient,
  createCodingRunNdjsonServer,
} from "./stdio.js";

function createProjection() {
  const capabilities = Object.fromEntries([
    "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal", "trace", "verifier", "mcp", "plugin", "skill",
  ].map((name) => [name, { required: false, state: "available" }]));
  return {
    schemaVersion: "task-projection/v1",
    taskId: "task-1",
    status: "running",
    owner: { source: "conversation", binding: { agentRunId: "run-1", conversationId: "conversation-1" } },
    evidence: { observedAtMs: 1, reasonCategory: "running", reasonCode: "owner_running" },
    allowedActions: ["observe", "cancel"],
    capabilityClosure: { schemaVersion: "task-capability-closure/v1", evaluatedAtMs: 1, status: "satisfied", capabilities },
  };
}

function createEvent(): AgentRunEvent {
  return {
    version: CODING_RUN_PROTOCOL_VERSION,
    seq: 1,
    timestampMs: 1_700_000_000_000,
    source: "conversation",
    binding: { agentRunId: "run-1", conversationId: "conversation-1" },
    type: "run.started",
    payload: { status: "running" },
  };
}

describe("coding-run NDJSON stdio transport", () => {
  it("routes split, versioned control frames and emits independently parseable responses", async () => {
    const output: string[] = [];
    const handleControl = vi.fn(async (control) => ({ accepted: control.operation }));
    const server = createCodingRunNdjsonServer({ write: (line) => { output.push(line); }, handleControl });
    const request = JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.request",
      id: "request-1",
      control: {
        version: CODING_RUN_PROTOCOL_VERSION,
        operation: "goal.resume",
        binding: { agentRunId: "goal-run-1", goal: { goalId: "goal-1" } },
      },
    });

    await server.consume(request.slice(0, 30));
    await server.consume(`${request.slice(30)}\n`);

    expect(handleControl).toHaveBeenCalledWith(expect.objectContaining({ operation: "goal.resume" }));
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.response",
      id: "request-1",
      ok: true,
      result: { accepted: "goal.resume" },
    });
  });

  it("fails closed on malformed controls and redacts handler failures", async () => {
    const output: string[] = [];
    const server = createCodingRunNdjsonServer({
      write: (line) => { output.push(line); },
      handleControl: async () => {
        throw new Error("token=do-not-leak");
      },
    });

    await server.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.request",
      id: "bad-request",
      control: { version: CODING_RUN_PROTOCOL_VERSION, operation: "goal.resume", binding: {} },
    })}\n`);
    await server.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "control.request",
      id: "failure-request",
      control: {
        version: CODING_RUN_PROTOCOL_VERSION,
        operation: "subtask.cancel",
        binding: { agentRunId: "agent-1", subtask: { taskId: "task-1" } },
      },
    })}\n`);

    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.response",
        id: "bad-request",
        ok: false,
        error: { code: "invalid_request", message: "Invalid coding run control request." },
      },
      {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.response",
        id: "failure-request",
        ok: false,
        error: { code: "internal", message: "token=[REDACTED]" },
      },
    ]);
  });

  it("lets the TypeScript client correlate responses and receive stream events", async () => {
    const written: string[] = [];
    const events: AgentRunEvent[] = [];
    const client = new CodingRunNdjsonClient({
      write: (line) => { written.push(line); },
      onEvent: (event) => events.push(event),
      createRequestId: () => "request-2",
    });

    const pending = client.control({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "workflow.resume",
      binding: { agentRunId: "entry-1", workflow: { journalId: "journal-1" } },
    });

    expect(JSON.parse(written[0])).toMatchObject({ type: "control.request", id: "request-2" });
    const inbound = [
      JSON.stringify({ version: CODING_RUN_PROTOCOL_VERSION, type: "event", event: createEvent() }),
      JSON.stringify({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "control.response",
        id: "request-2",
        ok: true,
        result: { resumed: true },
      }),
    ].join("\n");

    client.consume(inbound.slice(0, 25));
    client.consume(`${inbound.slice(25)}\n`);

    await expect(pending).resolves.toEqual({ ok: true, result: { resumed: true } });
    expect(events).toEqual([createEvent()]);
  });

  it("routes exact Conversation subscription frames and reports a separate cursor interruption", async () => {
    const output: string[] = [];
    const handleSubscription = vi.fn(async (subscription: CodingRunSubscription) => ({ latestSeq: subscription.cursor ?? 0 }));
    const server = createCodingRunNdjsonServer({
      write: (line) => { output.push(line); },
      handleControl: async () => undefined,
      handleSubscription,
    });
    await server.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "subscription.request",
      id: "subscription-1",
      subscription: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        cursor: 4,
      },
    })}\n`);
    await server.emitSubscriptionError({
      code: "cursor_expired",
      message: "Requested cursor has expired.",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    });

    expect(handleSubscription).toHaveBeenCalledWith(expect.objectContaining({ cursor: 4 }));
    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "subscription.response",
        id: "subscription-1",
        ok: true,
        result: { latestSeq: 4 },
      },
      {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "subscription.error",
        code: "cursor_expired",
        message: "Requested cursor has expired.",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      },
    ]);

    const written: string[] = [];
    const subscriptionErrors: unknown[] = [];
    const client = new CodingRunNdjsonClient({
      write: (line) => { written.push(line); },
      createRequestId: () => "subscription-2",
      onSubscriptionError: (error) => subscriptionErrors.push(error),
    });
    const pending = client.subscribe({
      version: CODING_RUN_PROTOCOL_VERSION,
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    });
    expect(JSON.parse(written[0])).toMatchObject({ type: "subscription.request", id: "subscription-2" });
    client.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "subscription.response",
      id: "subscription-2",
      ok: true,
      result: { latestSeq: 1 },
    })}\n${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "subscription.error",
      code: "cursor_expired",
      message: "Requested cursor has expired.",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    })}\n`);
    await expect(pending).resolves.toEqual({ ok: true, result: { latestSeq: 1 } });
    expect(subscriptionErrors).toEqual([{
      code: "cursor_expired",
      message: "Requested cursor has expired.",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    }]);
  });

  it("routes a bounded Conversation request without exposing broader Gateway message parameters", async () => {
    const output: string[] = [];
    const handleConversation = vi.fn(async (conversation) => ({
      binding: {
        conversationId: conversation.conversationId ?? "conversation-created",
        agentRunId: "run-created",
      },
    }));
    const server = createCodingRunNdjsonServer({
      write: (line) => { output.push(line); },
      handleControl: async () => undefined,
      handleConversation,
    });

    await server.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "conversation.request",
      id: "conversation-1",
      conversation: {
        version: CODING_RUN_PROTOCOL_VERSION,
        text: "Update the current workspace.",
        cwd: process.cwd(),
        conversationId: "conversation-existing",
      },
    })}\n`);

    expect(handleConversation).toHaveBeenCalledWith({
      version: CODING_RUN_PROTOCOL_VERSION,
      text: "Update the current workspace.",
      cwd: process.cwd(),
      conversationId: "conversation-existing",
    });
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

  it("fails a malformed Conversation request with a correlated Conversation response", async () => {
    const output: string[] = [];
    const handleConversation = vi.fn();
    const server = createCodingRunNdjsonServer({
      write: (line) => { output.push(line); },
      handleControl: async () => undefined,
      handleConversation,
    });

    await server.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "conversation.request",
      id: "conversation-invalid",
      conversation: {
        version: CODING_RUN_PROTOCOL_VERSION,
        text: "Inspect this workspace.",
        cwd: "relative-workspace",
      },
    })}\n`);

    expect(handleConversation).not.toHaveBeenCalled();
    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "conversation.response",
      id: "conversation-invalid",
      ok: false,
      error: { code: "invalid_request", message: "Invalid coding run conversation request." },
    }]);
  });

  it("routes a read-only artifact request without changing existing frame kinds", async () => {
    const output: string[] = [];
    const handleArtifact = vi.fn(async (artifact) => ({
      revisionId: artifact.revisionId,
      changes: [{ relativePath: "result.txt", action: "restore" }],
    }));
    const server = createCodingRunNdjsonServer({
      write: (line) => { output.push(line); },
      handleControl: async () => undefined,
      handleArtifact,
    });

    await server.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "artifact.request",
      id: "artifact-1",
      artifact: {
        revisionId: "run-1",
        workspaceId: "workspace-1",
      },
    })}\n`);

    expect(handleArtifact).toHaveBeenCalledWith({
      revisionId: "run-1",
      workspaceId: "workspace-1",
    });
    expect(output.map((line) => JSON.parse(line))).toEqual([{
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "artifact.response",
      id: "artifact-1",
      ok: true,
      result: {
        revisionId: "run-1",
        changes: [{ relativePath: "result.txt", action: "restore" }],
      },
    }]);
  });

  it("correlates an artifact response in the low-level TypeScript transport", async () => {
    const written: string[] = [];
    const client = new CodingRunNdjsonClient({
      write: (line) => { written.push(line); },
      createRequestId: () => "artifact-client-1",
    });

    const pending = client.artifact({ revisionId: "run-1" });
    expect(JSON.parse(written[0])).toEqual({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "artifact.request",
      id: "artifact-client-1",
      artifact: { revisionId: "run-1" },
    });

    client.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "artifact.response",
      id: "artifact-client-1",
      ok: true,
      result: { revisionId: "run-1", canRestore: true },
    })}\n`);

    await expect(pending).resolves.toEqual({
      ok: true,
      result: { revisionId: "run-1", canRestore: true },
    });
  });

  it("routes and correlates a bounded TaskProjection page", async () => {
    const output: string[] = [];
    const handleProjection = vi.fn(async (projection) => ({
      epoch: "epoch-1",
      revision: 2,
      totalCount: 1,
      items: [createProjection()],
      ...(projection.cursor ? {} : { nextCursor: undefined }),
    }));
    const server = createCodingRunNdjsonServer({
      write: (line) => { output.push(line); },
      handleControl: async () => undefined,
      handleProjection,
    });
    await server.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "projection.request",
      id: "projection-1",
      projection: { limit: 10 },
    })}\n`);
    expect(handleProjection).toHaveBeenCalledWith({ limit: 10 });
    expect(JSON.parse(output[0])).toMatchObject({ type: "projection.response", id: "projection-1", ok: true });

    const written: string[] = [];
    const client = new CodingRunNdjsonClient({ write: (line) => { written.push(line); }, createRequestId: () => "projection-client-1" });
    const pending = client.projection({ limit: 1 });
    expect(JSON.parse(written[0])).toMatchObject({ type: "projection.request", id: "projection-client-1", projection: { limit: 1 } });
    client.consume(`${JSON.stringify({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "projection.response",
      id: "projection-client-1",
      ok: true,
      result: { epoch: "epoch-1", revision: 2, totalCount: 1, items: [createProjection()] },
    })}\n`);
    await expect(pending).resolves.toMatchObject({ ok: true, result: { epoch: "epoch-1", revision: 2 } });
  });

  it("fails malformed TaskProjection requests closed with a correlated response", async () => {
    const output: string[] = [];
    const handleProjection = vi.fn();
    const server = createCodingRunNdjsonServer({ write: (line) => { output.push(line); }, handleControl: async () => undefined, handleProjection });
    await server.consume(`${JSON.stringify({ version: CODING_RUN_PROTOCOL_VERSION, type: "projection.request", id: "projection-invalid", projection: { prompt: "no" } })}\n`);
    expect(handleProjection).not.toHaveBeenCalled();
    expect(JSON.parse(output[0])).toEqual({
      version: CODING_RUN_PROTOCOL_VERSION,
      type: "projection.response",
      id: "projection-invalid",
      ok: false,
      error: { code: "invalid_request", message: "Invalid task projection request." },
    });
  });
});
