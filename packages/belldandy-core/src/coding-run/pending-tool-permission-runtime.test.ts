import { describe, expect, it, vi } from "vitest";

import { PendingToolPermissionRuntime } from "./pending-tool-permission-runtime.js";

describe("PendingToolPermissionRuntime", () => {
  it("reports an exact-bound settlement and distinguishes human from automatic responders", async () => {
    vi.useFakeTimers();
    try {
      const onSettled = vi.fn();
      const runtime = new PendingToolPermissionRuntime({ timeoutMs: 100, onSettled });
      const humanDecision = runtime.request({
        conversationId: "conversation-human",
        agentRunId: "run-human",
        toolCallId: "tool-human",
        toolName: "file_edit",
      });

      expect(runtime.respond({
        agentRunId: "run-human",
        toolCallId: "tool-human",
        decision: "allow",
        responderKind: "human",
      })).toEqual({ ok: true, accepted: true });
      await expect(humanDecision).resolves.toBe("allow");
      expect(onSettled).toHaveBeenLastCalledWith({
        conversationId: "conversation-human",
        agentRunId: "run-human",
        toolCallId: "tool-human",
        decision: "allow",
        responderKind: "human",
        reason: "response",
      });

      const timedOut = runtime.request({
        conversationId: "conversation-timeout",
        agentRunId: "run-timeout",
        toolCallId: "tool-timeout",
        toolName: "file_edit",
      });
      await vi.advanceTimersByTimeAsync(100);
      await expect(timedOut).resolves.toBe("deny");
      expect(onSettled).toHaveBeenLastCalledWith({
        conversationId: "conversation-timeout",
        agentRunId: "run-timeout",
        toolCallId: "tool-timeout",
        decision: "deny",
        responderKind: "automatic",
        reason: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists multiple pending requests as bounded safe owner snapshots", async () => {
    const runtime = new PendingToolPermissionRuntime();
    const first = runtime.request({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "file_write",
    });
    const second = runtime.request({
      conversationId: "conversation-2",
      agentRunId: "run-2",
      worktreeId: "worktree-2",
      toolCallId: "tool-2",
      toolName: "command_job",
      commandPreview: {
        kind: "command",
        action: "cancel",
        jobId: "11111111-1111-4111-8111-111111111111",
      },
    });
    const extras = Array.from({ length: 99 }, (_value, index) => runtime.request({
      conversationId: `conversation-extra-${index}`,
      agentRunId: `run-extra-${index}`,
      toolCallId: `tool-extra-${index}`,
      toolName: "file_read",
    }));

    const pending = runtime.list();

    expect(pending).toHaveLength(100);
    expect(pending.slice(0, 2)).toEqual([
      {
        conversationId: "conversation-1",
        agentRunId: "run-1",
        toolCallId: "tool-1",
        toolName: "file_write",
      },
      {
        conversationId: "conversation-2",
        agentRunId: "run-2",
        worktreeId: "worktree-2",
        toolCallId: "tool-2",
        toolName: "command_job",
        commandPreview: { action: "cancel", jobId: "11111111-1111-4111-8111-111111111111" },
      },
    ]);
    expect(JSON.stringify(pending)).not.toContain("abortSignal");
    expect(JSON.stringify(pending)).not.toContain("timeout");
    expect(JSON.stringify(pending)).not.toContain("tool-extra-98");

    runtime.cancelRun("run-1");
    runtime.cancelRun("run-2");
    for (let index = 0; index < extras.length; index += 1) runtime.cancelRun(`run-extra-${index}`);
    await expect(Promise.all([first, second, ...extras])).resolves.toEqual(Array(101).fill("deny"));
  });

  it("only resolves an exact active run and tool-call binding", async () => {
    const onRequested = vi.fn();
    const runtime = new PendingToolPermissionRuntime({ onRequested });
    const pending = runtime.request({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "run_command",
      commandPreview: {
        kind: "command",
        action: "run",
        commandPlan: {
          executable: "node",
          argv: ["--version"],
          cwd: ".",
          environmentKeys: ["LOG_LEVEL"],
          network: "none",
          writeScope: "workspace-readonly",
          stdinMode: "closed",
        },
      },
    });

    expect(onRequested).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "run_command",
      commandPreview: {
        kind: "command",
        action: "run",
        commandPlan: {
          executable: "node",
          argv: ["--version"],
          cwd: ".",
          environmentKeys: ["LOG_LEVEL"],
          network: "none",
          writeScope: "workspace-readonly",
          stdinMode: "closed",
        },
      },
    });
    expect(runtime.respond({
      agentRunId: "run-other",
      toolCallId: "tool-1",
      decision: "allow",
    })).toEqual({ ok: false, code: "run_mismatch" });
    expect(runtime.respond({
      agentRunId: "run-1",
      toolCallId: "tool-other",
      decision: "allow",
    })).toEqual({ ok: false, code: "not_found" });

    expect(runtime.respond({
      agentRunId: "run-1",
      toolCallId: "tool-1",
      decision: "allow",
    })).toEqual({ ok: true, accepted: true });
    await expect(pending).resolves.toBe("allow");
  });

  it("makes an identical reconnect retry idempotent but refuses a conflicting decision", async () => {
    const runtime = new PendingToolPermissionRuntime();
    const pending = runtime.request({
      conversationId: "conversation-1",
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "run_command",
    });

    expect(runtime.respond({ agentRunId: "run-1", toolCallId: "tool-1", decision: "deny" }))
      .toEqual({ ok: true, accepted: true });
    await expect(pending).resolves.toBe("deny");
    expect(runtime.respond({ agentRunId: "run-1", toolCallId: "tool-1", decision: "deny" }))
      .toEqual({ ok: true, accepted: true, alreadyResolved: true });
    expect(runtime.respond({ agentRunId: "run-1", toolCallId: "tool-1", decision: "allow" }))
      .toEqual({ ok: false, code: "permission_denied" });
  });

  it("drops a command preview attached to a non-command permission", async () => {
    const onRequested = vi.fn();
    const runtime = new PendingToolPermissionRuntime({ onRequested });
    const pending = runtime.request({
      conversationId: "conversation-1",
      agentRunId: "run-non-command",
      toolCallId: "tool-non-command",
      toolName: "file_write",
      commandPreview: {
        kind: "command",
        action: "run",
        commandPlan: {
          executable: "node",
          argv: ["--token=must-not-leak"],
          cwd: ".",
          environmentKeys: ["PRIVATE_TOKEN"],
          network: "none",
          writeScope: "workspace-readonly",
          stdinMode: "closed",
        },
      },
    });

    expect(onRequested).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      agentRunId: "run-non-command",
      toolCallId: "tool-non-command",
      toolName: "file_write",
    });
    runtime.cancelRun("run-non-command");
    await expect(pending).resolves.toBe("deny");
  });

  it("fails closed when the run aborts, times out, or tries to reuse a tool call id", async () => {
    vi.useFakeTimers();
    try {
      const runtime = new PendingToolPermissionRuntime({ timeoutMs: 100 });
      const abortController = new AbortController();
      const aborted = runtime.request({
        conversationId: "conversation-1",
        agentRunId: "run-1",
        toolCallId: "tool-1",
        toolName: "apply_patch",
        abortSignal: abortController.signal,
      });
      abortController.abort();
      await expect(aborted).resolves.toBe("deny");

      const timedOut = runtime.request({
        conversationId: "conversation-1",
        agentRunId: "run-2",
        toolCallId: "tool-2",
        toolName: "apply_patch",
      });
      await vi.advanceTimersByTimeAsync(100);
      await expect(timedOut).resolves.toBe("deny");

      const first = runtime.request({
        conversationId: "conversation-1",
        agentRunId: "run-3",
        toolCallId: "tool-3",
        toolName: "apply_patch",
      });
      await expect(runtime.request({
        conversationId: "conversation-1",
        agentRunId: "run-3",
        toolCallId: "tool-3",
        toolName: "apply_patch",
      })).resolves.toBe("deny");
      runtime.cancelRun("run-3");
      await expect(first).resolves.toBe("deny");
    } finally {
      vi.useRealTimers();
    }
  });
});
