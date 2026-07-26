import { describe, expect, it } from "vitest";

import type { AgentRunEvent } from "../coding-run/contracts.js";
import {
  MAX_TUI_STREAM_CHARS,
  createInitialTuiState,
  reduceTuiState,
  type TuiChangeSnapshotResult,
} from "./state.js";

function event(
  seq: number,
  type: AgentRunEvent["type"],
  payload: Record<string, unknown>,
  binding: AgentRunEvent["binding"] = {
    conversationId: "conversation-1",
    agentRunId: "run-1",
  },
): AgentRunEvent {
  return {
    version: "v1",
    seq,
    timestampMs: seq,
    source: "conversation",
    binding,
    type,
    payload,
  };
}

describe("TUI state", () => {
  it("keeps a bounded model stream and ignores duplicate or stale-run events", () => {
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Inspect the project",
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(1, "run.started", { status: "running" }),
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(2, "message.delta", { delta: "x".repeat(MAX_TUI_STREAM_CHARS + 20) }),
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(2, "message.delta", { delta: "duplicate" }),
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(3, "message.delta", { delta: "wrong run" }, {
        conversationId: "conversation-1",
        agentRunId: "run-stale",
      }),
    });

    expect(state.stream.text.length).toBeLessThanOrEqual(MAX_TUI_STREAM_CHARS);
    expect(state.stream.text).toContain("[stream truncated]");
    expect(state.stream.text).not.toContain("duplicate");
    expect(state.stream.text).not.toContain("wrong run");
    expect(state.lastSeq).toBe(2);
  });

  it("keeps the active conversation selected until its run reaches a terminal state", () => {
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-active", agentRunId: "run-1" },
      prompt: "Inspect the project",
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(1, "run.started", { status: "running" }, {
        conversationId: "conversation-active",
        agentRunId: "run-1",
      }),
    });
    state = reduceTuiState(state, {
      type: "conversation.selected",
      conversationId: "conversation-other",
      chat: [{ role: "assistant", text: "unrelated history" }],
    });

    expect(state.selectedConversationId).toBe("conversation-active");
    expect(state.binding).toEqual({ conversationId: "conversation-active", agentRunId: "run-1" });
    expect(state.chat).toEqual([{ role: "user", text: "Inspect the project" }]);
    expect(state.notice).toContain("active run");
  });

  it("stores only safe tool summaries and binds one pending permission to the active run", () => {
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Modify a file",
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(1, "tool.started", {
        tool: { id: "tool-1", name: "file_write", arguments: { secret: "must-not-leak" } },
      }),
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(2, "permission.requested", {
        permission: {
          toolCallId: "tool-1",
          toolName: "file_write",
          worktreeId: "worktree-1",
          commandPreview: {
            kind: "command",
            action: "run",
            commandPlan: {
              executable: "node",
              argv: ["--token", "must-not-leak", "--version"],
              cwd: ".",
              environmentKeys: ["PRIVATE_TOKEN"],
              network: "none",
              writeScope: "workspace-readonly",
              stdinMode: "closed",
            },
          },
          arguments: { secret: "must-not-leak" },
        },
      }),
    });

    expect(state.tools).toEqual([
      { id: "tool-1", name: "file_write", status: "running" },
    ]);
    expect(state.pendingPermission).toEqual({
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "file_write",
      worktreeId: "worktree-1",
    });
    expect(JSON.stringify(state)).not.toContain("must-not-leak");

    state = reduceTuiState(state, {
      type: "permission.resolved",
      binding: { agentRunId: "run-stale" },
      toolCallId: "tool-1",
      decision: "allow",
    });
    expect(state.pendingPermission).toBeDefined();

    state = reduceTuiState(state, {
      type: "permission.resolved",
      binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
      toolCallId: "tool-1",
      decision: "deny",
    });
    expect(state.pendingPermission).toBeUndefined();
    expect(state.notice).toBe("Tool permission denied.");
  });

  it("retains a validated command preview for the active command approval only", () => {
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Run tests",
    });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(1, "permission.requested", {
        permission: {
          toolCallId: "tool-command-1",
          toolName: "command_job",
          commandPreview: {
            kind: "command",
            action: "start",
            commandPlan: {
              executable: "node",
              argv: ["--token", "must-not-leak", "--version"],
              cwd: ".",
              environmentKeys: ["PRIVATE_TOKEN"],
              network: "none",
              writeScope: "workspace-readonly",
              stdinMode: "pty",
            },
          },
        },
      }),
    });

    expect(state.pendingPermission).toMatchObject({
      toolName: "command_job",
      commandPreview: {
        action: "start",
        commandPlan: { argv: ["--token", "[REDACTED]", "--version"] },
      },
    });
    expect(JSON.stringify(state)).not.toContain("must-not-leak");
  });

  it("requires a restorable dry-run preview before opening restore confirmation", () => {
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "revision.previewed",
      preview: {
        revisionId: "run-1",
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact",
        canRestore: true,
        changes: [{ relativePath: "src/app.ts", action: "restore" }],
      },
    });

    expect(state.restoreConfirmation).toBeUndefined();
    state = reduceTuiState(state, { type: "revision.restore.requested" });
    expect(state.restoreConfirmation).toEqual({ revisionId: "run-1", stage: "confirm" });

    state = reduceTuiState(state, { type: "revision.restore.cancelled" });
    expect(state.restoreConfirmation).toBeUndefined();

    state = reduceTuiState(state, {
      type: "revision.previewed",
      preview: {
        ...state.revisionPreview!,
        canRestore: false,
        changes: [{ relativePath: "src/app.ts", action: "conflict", reason: "hash mismatch" }],
      },
    });
    state = reduceTuiState(state, { type: "revision.restore.requested" });
    expect(state.restoreConfirmation).toBeUndefined();
    expect(state.notice).toContain("cannot be restored");
  });

  it("retains the active run diff snapshot and ignores a late snapshot from an older run", () => {
    const result = createChangeSnapshotResult();
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Change a file",
    });
    state = reduceTuiState(state, {
      type: "change.snapshot.completed",
      agentRunId: "run-1",
      result,
    });

    expect(state.changeSnapshot).toBe(result);
    expect(state.notice).toContain("Run diff ready");

    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-2", agentRunId: "run-2" },
      prompt: "Start another run",
    });
    state = reduceTuiState(state, {
      type: "change.snapshot.completed",
      agentRunId: "run-1",
      result,
    });

    expect(state.changeSnapshot).toBeUndefined();
  });
});

function createChangeSnapshotResult(): TuiChangeSnapshotResult {
  return {
    status: "available",
    snapshot: {
      version: 1,
      snapshotId: "snapshot-1",
      baseline: { baselineId: "baseline-1", source: "run_start", hash: "sha256:baseline" },
      workspaceRoot: "E:\\workspace",
      currentHash: "sha256:current",
      diffHash: "sha256:diff",
      capturedAtMs: 1,
      files: [{ path: "note.txt", status: "modified", binary: false, diffAvailable: true }],
      hunkCount: 1,
      truncated: false,
      truncationReasons: [],
      coverage: {
        complete: true,
        fileCount: 1,
        storedFileCount: 1,
        storedBytes: 12,
        omittedFileCount: 0,
        reasons: [],
      },
      recovery: { recoveryGuarantee: "detect_only", reason: "checkpoint_missing" },
      artifacts: { summaryPath: "summary.json", patchPath: "changes.patch" },
    },
    page: {
      snapshotId: "snapshot-1",
      diffHash: "sha256:diff",
      hunks: [{ path: "note.txt", binary: false, patch: "@@ -1 +1 @@\n-before\n+after" }],
    },
  };
}
