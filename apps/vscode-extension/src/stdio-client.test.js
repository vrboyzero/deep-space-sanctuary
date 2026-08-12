import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { CodingRunStdioClient } = require("./stdio-client.cjs");

function createChildHarness() {
  let child;
  const spawn = vi.fn(() => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => {
      child.emit("exit", null, "SIGTERM");
      return true;
    });
    return child;
  });
  return {
    spawn,
    get child() {
      if (!child) throw new Error("Expected child process to be started.");
      return child;
    },
  };
}

describe("VS Code coding-run stdio client", () => {
  it("starts bdd without a shell and forwards an exact Conversation cancellation", async () => {
    const harness = createChildHarness();
    const client = new CodingRunStdioClient({
      command: "bdd",
      stateDir: "C:\\state-dir",
      spawn: harness.spawn,
      createRequestId: () => "request-1",
    });

    await client.start();
    expect(harness.spawn).toHaveBeenCalledWith("bdd", ["coding-run", "stdio", "--state-dir", "C:\\state-dir"], expect.objectContaining({
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    }));

    const sent = once(harness.child.stdin, "data");
    const response = client.cancelConversation({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      reason: "Stop from VS Code.",
    });
    const [chunk] = await sent;
    expect(JSON.parse(String(chunk))).toMatchObject({
      type: "control.request",
      id: "request-1",
      control: {
        operation: "cancel",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      },
    });

    harness.child.stdout.write(`${JSON.stringify({
      version: "v1",
      type: "control.response",
      id: "request-1",
      ok: true,
      result: { accepted: true },
    })}\n`);
    await expect(response).resolves.toEqual({ ok: true, result: { accepted: true } });
  });

  it("starts a bounded Conversation request with the active workspace and optional prior Conversation", async () => {
    const harness = createChildHarness();
    const client = new CodingRunStdioClient({
      command: "bdd",
      spawn: harness.spawn,
      createRequestId: () => "conversation-1",
    });

    await client.start();
    const sent = once(harness.child.stdin, "data");
    const response = client.requestConversation({
      text: "Update the selected project.",
      cwd: process.cwd(),
      conversationId: "conversation-existing",
    });
    const [chunk] = await sent;
    expect(JSON.parse(String(chunk))).toEqual({
      version: "v1",
      type: "conversation.request",
      id: "conversation-1",
      conversation: {
        version: "v1",
        text: "Update the selected project.",
        cwd: process.cwd(),
        conversationId: "conversation-existing",
      },
    });

    harness.child.stdout.write(`${JSON.stringify({
      version: "v1",
      type: "conversation.response",
      id: "conversation-1",
      ok: true,
      result: { binding: { conversationId: "conversation-existing", agentRunId: "run-created" } },
    })}\n`);
    await expect(response).resolves.toEqual({
      ok: true,
      result: { binding: { conversationId: "conversation-existing", agentRunId: "run-created" } },
    });
  });

  it("rejects a Conversation request outside an absolute workspace before starting the bridge", async () => {
    const harness = createChildHarness();
    const client = new CodingRunStdioClient({ command: "bdd", spawn: harness.spawn });

    await expect(client.requestConversation({ text: "Inspect it.", cwd: "relative-workspace" }))
      .rejects.toThrow("cwd must be an absolute path");
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it("rejects an incomplete binding before it can start a child process", async () => {
    const harness = createChildHarness();
    const client = new CodingRunStdioClient({ command: "bdd", spawn: harness.spawn });

    await expect(client.cancelWorkflow({ journalId: "journal-1", workflowRunId: "" }))
      .rejects.toThrow("workflowRunId is required");
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it("forwards an exact pending tool permission decision without starting on incomplete input", async () => {
    const harness = createChildHarness();
    const client = new CodingRunStdioClient({
      command: "bdd",
      spawn: harness.spawn,
      createRequestId: () => "permission-1",
    });

    await expect(client.respondPermission({
      agentRunId: "run-1",
      toolCallId: "tool-1",
      decision: "approve",
    })).rejects.toThrow("decision must be allow or deny");
    expect(harness.spawn).not.toHaveBeenCalled();

    const response = client.respondPermission({
      agentRunId: "run-1",
      worktreeId: "worktree-1",
      toolCallId: "tool-1",
      decision: "allow",
    });
    const sent = once(harness.child.stdin, "data");
    const [chunk] = await sent;
    expect(JSON.parse(String(chunk))).toEqual({
      version: "v1",
      type: "control.request",
      id: "permission-1",
      control: {
        version: "v1",
        operation: "permission.respond",
        binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
        toolCallId: "tool-1",
        decision: "allow",
      },
    });

    harness.child.stdout.write(`${JSON.stringify({
      version: "v1",
      type: "control.response",
      id: "permission-1",
      ok: true,
      result: { accepted: true },
    })}\n`);
    await expect(response).resolves.toEqual({ ok: true, result: { accepted: true } });
  });

  it("subscribes with an exact Conversation binding and reports subscription interruption separately", async () => {
    const harness = createChildHarness();
    const events = [];
    const interruptions = [];
    const client = new CodingRunStdioClient({
      command: "bdd",
      spawn: harness.spawn,
      createRequestId: () => "subscription-1",
      onEvent: (event) => events.push(event),
      onSubscriptionError: (error) => interruptions.push(error),
    });

    await client.start();
    const sent = once(harness.child.stdin, "data");
    const response = client.subscribeConversation({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      cursor: 4,
    });
    const [chunk] = await sent;
    expect(JSON.parse(String(chunk))).toEqual({
      version: "v1",
      type: "subscription.request",
      id: "subscription-1",
      subscription: {
        version: "v1",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        cursor: 4,
      },
    });

    harness.child.stdout.write(`${JSON.stringify({
      version: "v1",
      type: "subscription.response",
      id: "subscription-1",
      ok: true,
      result: { earliestSeq: 5, latestSeq: 5 },
    })}\n${JSON.stringify({
      version: "v1",
      type: "event",
      event: {
        version: "v1",
        seq: 5,
        timestampMs: 1,
        source: "conversation",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        type: "run.status",
        payload: { status: "running" },
      },
    })}\n${JSON.stringify({
      version: "v1",
      type: "subscription.error",
      code: "cursor_expired",
      message: "Requested cursor has expired.",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    })}\n`);

    await expect(response).resolves.toEqual({ ok: true, result: { earliestSeq: 5, latestSeq: 5 } });
    expect(events).toEqual([expect.objectContaining({ seq: 5, type: "run.status" })]);
    expect(interruptions).toEqual([{
      code: "cursor_expired",
      message: "Requested cursor has expired.",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    }]);
  });

  it("keeps a Gateway source rejection structured and rejects unknown response frames", async () => {
    const harness = createChildHarness();
    const protocolErrors = [];
    const client = new CodingRunStdioClient({
      command: "bdd",
      spawn: harness.spawn,
      createRequestId: () => "request-2",
      onProtocolError: (error) => protocolErrors.push(error),
    });
    await client.start();

    const sent = once(harness.child.stdin, "data");
    const response = client.cancelWorkflow({ journalId: "journal-1", workflowRunId: "workflow-run-1" });
    await sent;
    harness.child.stdout.write(`${JSON.stringify({
      version: "v1",
      type: "control.response",
      id: "request-2",
      ok: false,
      error: { code: "run_mismatch", message: "Workflow run binding no longer matches an active Workflow run." },
    })}\n`);
    harness.child.stdout.write("not-json\n");

    await expect(response).resolves.toEqual({
      ok: false,
      error: { code: "run_mismatch", message: "Workflow run binding no longer matches an active Workflow run." },
    });
    expect(protocolErrors).toEqual([{ code: "invalid_frame", message: "Invalid coding run NDJSON frame." }]);
  });

  it("reads a bounded TaskProjection page and rejects invalid projection inputs", async () => {
    const harness = createChildHarness();
    const client = new CodingRunStdioClient({
      command: "bdd",
      spawn: harness.spawn,
      createRequestId: () => "projection-1",
    });

    await expect(client.listTaskProjections({ prompt: "forbidden" }))
      .rejects.toThrow("unsupported fields");
    expect(harness.spawn).not.toHaveBeenCalled();

    const response = client.listTaskProjections({ limit: 10, cursor: { epoch: "epoch-1", revision: 2, offset: 1 } });
    const sent = once(harness.child.stdin, "data");
    const [chunk] = await sent;
    expect(JSON.parse(String(chunk))).toEqual({
      version: "v1",
      type: "projection.request",
      id: "projection-1",
      projection: { limit: 10, cursor: { epoch: "epoch-1", revision: 2, offset: 1 } },
    });

    harness.child.stdout.write(`${JSON.stringify({
      version: "v1",
      type: "projection.response",
      id: "projection-1",
      ok: true,
      result: { epoch: "epoch-1", revision: 2, totalCount: 1, items: [] },
    })}\n`);
    await expect(response).resolves.toEqual({
      ok: true,
      result: { epoch: "epoch-1", revision: 2, totalCount: 1, items: [] },
    });
  });

  it("preserves a structured projection source rejection", async () => {
    const harness = createChildHarness();
    const client = new CodingRunStdioClient({ command: "bdd", spawn: harness.spawn, createRequestId: () => "projection-error" });
    const response = client.listTaskProjections();
    const sent = once(harness.child.stdin, "data");
    await sent;
    harness.child.stdout.write(`${JSON.stringify({
      version: "v1",
      type: "projection.response",
      id: "projection-error",
      ok: false,
      error: { code: "cursor_stale", message: "Projection cursor belongs to an older Gateway epoch." },
    })}\n`);
    await expect(response).resolves.toEqual({
      ok: false,
      error: { code: "cursor_stale", message: "Projection cursor belongs to an older Gateway epoch." },
    });
  });
});
