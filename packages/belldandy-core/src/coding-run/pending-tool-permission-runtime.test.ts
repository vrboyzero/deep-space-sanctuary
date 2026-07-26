import { describe, expect, it, vi } from "vitest";

import { PendingToolPermissionRuntime } from "./pending-tool-permission-runtime.js";

describe("PendingToolPermissionRuntime", () => {
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
