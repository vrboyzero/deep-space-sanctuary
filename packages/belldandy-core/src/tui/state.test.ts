import { describe, expect, it } from "vitest";
import type { CommandJobReadResult, CommandJobSnapshot } from "@belldandy/skills";

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
  it("requires a confirmable exact remote preview before opening or completing push confirmation", () => {
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "remote-delivery.targets.loaded",
      targets: [{
        remote: "private",
        url: "https://github.com/example/private.git",
        pushBranches: ["main"],
        pullRequestBases: ["main"],
        repository: "example/private",
      }],
      expectedCwd: "E:\\workspace",
    });
    state = reduceTuiState(state, {
      type: "remote-delivery.push.previewed",
      preview: {
        operation: "push",
        canConfirm: true,
        blockers: [],
        source: { repoRoot: "E:\\workspace", branch: "main", commit: "a".repeat(40), upstream: null },
        target: {
          remote: "private",
          url: "https://github.com/example/private.git",
          branch: "main",
          expectedOid: "b".repeat(40),
        },
        diff: { baseOid: "b".repeat(40), sha256: "c".repeat(64), byteLength: 42 },
        receipt: { receiptId: "remote-delivery-receipt", expiresAtMs: Date.now() + 60_000 },
      },
    });
    state = reduceTuiState(state, { type: "remote-delivery.push.requested" });
    expect(state.remoteDeliveryConfirmation).toEqual({ receiptId: "remote-delivery-receipt" });

    state = reduceTuiState(state, {
      type: "remote-delivery.push.completed",
      result: {
        operation: "push",
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: { remoteOid: "a".repeat(40) },
      },
    });
    expect(state.remoteDeliveryConfirmation).toBeUndefined();
    expect(state.notice).toBe("Remote push verified.");
  });

  it("requires manual reconciliation when an applied push has an uncertain outcome", () => {
    const state = reduceTuiState(createInitialTuiState("E:\\workspace"), {
      type: "remote-delivery.push.completed",
      result: {
        operation: "push",
        outcome: "uncertain",
        applied: true,
        blockers: ["audit_persistence_failed"],
        postcondition: { remoteOid: "a".repeat(40) },
      },
    });

    expect(state.notice).toBe("Remote push applied, but audit persistence failed. Manual reconciliation required.");
  });

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

  it("applies a completed steer only to its exact active binding", () => {
    let state = createInitialTuiState("E:\\workspace");
    const binding = { conversationId: "conversation-active", agentRunId: "run-1" };
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding,
      prompt: "Inspect the project",
    });
    state = reduceTuiState(state, { type: "input.changed", input: "Focus on tests" });

    const unchanged = reduceTuiState(state, {
      type: "conversation.steered",
      binding: { conversationId: "conversation-active", agentRunId: "run-stale" },
      prompt: "Focus on tests",
    });
    expect(unchanged).toBe(state);

    state = reduceTuiState(state, {
      type: "conversation.steered",
      binding,
      prompt: "Focus on tests",
    });
    expect(state.input).toBe("");
    expect(state.notice).toBe("Steer queued for the active run.");
    expect(state.chat.at(-1)).toEqual({ role: "user", text: "Focus on tests" });

    state = reduceTuiState(state, { type: "input.changed", input: "A later input" });
    state = reduceTuiState(state, {
      type: "conversation.steered",
      binding,
      prompt: "Focus on tests",
    });
    expect(state.input).toBe("A later input");
  });

  it("stores only safe tool summaries and queues a pending permission for the active run", () => {
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
    expect(state.pendingPermissions).toEqual([{
      agentRunId: "run-1",
      toolCallId: "tool-1",
      toolName: "file_write",
      worktreeId: "worktree-1",
    }]);
    expect(JSON.stringify(state)).not.toContain("must-not-leak");

    state = reduceTuiState(state, {
      type: "permission.resolved",
      binding: { agentRunId: "run-stale" },
      toolCallId: "tool-1",
      decision: "allow",
    });
    expect(state.pendingPermissions).toHaveLength(1);

    state = reduceTuiState(state, {
      type: "permission.resolved",
      binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
      toolCallId: "tool-1",
      decision: "deny",
    });
    expect(state.pendingPermissions).toEqual([]);
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

    expect(state.pendingPermissions[0]).toMatchObject({
      toolName: "command_job",
      commandPreview: {
        action: "start",
        commandPlan: { argv: ["--token", "[REDACTED]", "--version"] },
      },
    });
    expect(JSON.stringify(state)).not.toContain("must-not-leak");
  });

  it("merges the owner queue with events and never revives an exact resolved request", () => {
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Modify a file",
    });
    const other = {
      agentRunId: "run-other",
      toolCallId: "tool-other",
      toolName: "file_write",
    };
    state = reduceTuiState(state, { type: "permissions.loaded", permissions: [other], baseRevision: 0 });
    state = reduceTuiState(state, {
      type: "run.event",
      event: event(1, "permission.requested", {
        permission: { toolCallId: "tool-active", toolName: "apply_patch", worktreeId: "worktree-1" },
      }),
    });

    expect(state.pendingPermissions.map((permission) => permission.toolCallId)).toEqual([
      "tool-other",
      "tool-active",
    ]);
    state = reduceTuiState(state, { type: "permission.index.selected", index: 1 });
    expect(state.selectedPermissionIndex).toBe(1);

    state = reduceTuiState(state, {
      type: "permission.resolved",
      binding: { agentRunId: "run-stale", worktreeId: "worktree-1" },
      toolCallId: "tool-active",
      decision: "deny",
    });
    expect(state.pendingPermissions).toHaveLength(2);

    state = reduceTuiState(state, {
      type: "permission.resolved",
      binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
      toolCallId: "tool-active",
      decision: "allow",
    });
    expect(state.pendingPermissions).toEqual([other]);
    expect(state.selectedPermissionIndex).toBe(0);

    state = reduceTuiState(state, {
      type: "permissions.loaded",
      baseRevision: 2,
      permissions: [other, {
        agentRunId: "run-1",
        worktreeId: "worktree-1",
        toolCallId: "tool-active",
        toolName: "apply_patch",
      }],
    });
    expect(state.pendingPermissions).toEqual([other]);

    state = reduceTuiState(state, {
      type: "permissions.loaded",
      permissions: [],
      baseRevision: state.permissionRevision,
    });
    expect(state.pendingPermissions).toEqual([]);
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

  it("navigates exact snapshot hunk pages and resets the cursor for a replacement snapshot", () => {
    const initial = createChangeSnapshotResult();
    initial.snapshot = { ...initial.snapshot!, hunkCount: 3 };
    initial.page = { ...initial.page!, nextCursor: "cursor-2" };
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Change files",
    });
    state = reduceTuiState(state, {
      type: "change.snapshot.completed",
      agentRunId: "run-1",
      result: initial,
    });
    state = reduceTuiState(state, {
      type: "change.hunk.navigated",
      direction: "next",
      cursor: "cursor-2",
      page: {
        snapshotId: "snapshot-1",
        diffHash: "sha256:diff",
        hunks: [{ path: "two.txt", binary: false, patch: "@@ second" }],
        nextCursor: "cursor-3",
      },
    });

    expect(state.changeHunkIndex).toBe(1);
    expect(state.changeHunkPageCursors).toEqual(["cursor-2"]);
    expect(state.changeSnapshot?.page?.hunks[0]?.path).toBe("two.txt");

    const current = state;
    state = reduceTuiState(state, {
      type: "change.hunk.navigated",
      direction: "next",
      cursor: "cursor-3",
      page: {
        snapshotId: "snapshot-stale",
        diffHash: "sha256:stale",
        hunks: [{ path: "stale.txt", binary: false, patch: "@@ stale" }],
      },
    });
    expect(state).toBe(current);

    state = reduceTuiState(state, {
      type: "change.hunk.navigated",
      direction: "previous",
      page: initial.page!,
    });
    expect(state.changeHunkIndex).toBe(0);
    expect(state.changeHunkPageCursors).toEqual([]);

    const replacement = createChangeSnapshotResult();
    replacement.snapshot = { ...replacement.snapshot!, snapshotId: "snapshot-2", diffHash: "sha256:diff-2" };
    replacement.page = { ...replacement.page!, snapshotId: "snapshot-2", diffHash: "sha256:diff-2" };
    state = reduceTuiState(state, {
      type: "change.snapshot.completed",
      agentRunId: "run-1",
      result: replacement,
    });
    expect(state.changeHunkIndex).toBe(0);
    expect(state.changeHunkPageCursors).toEqual([]);
  });

  it("switches an exact idle workspace, resets workspace-bound state, and rejects late old-cwd results", () => {
    const managed = {
      targetKey: "worktree:worktree-1",
      kind: "managed" as const,
      worktreeId: "worktree-1",
      cwd: "E:\\managed\\worktree-1",
      branch: "bdd/worktree-1",
      status: "ready" as const,
      dirty: false,
      trackedChanges: 0,
      untrackedChanges: 0,
      conflictChanges: 0,
      extraCommitCount: 0,
    };
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "workspace.targets.loaded",
      expectedCwd: "E:\\workspace",
      targets: [state.workspaceTargets[0]!, managed],
    });
    state = reduceTuiState(state, { type: "workspace.target.index.selected", index: 1 });
    state = {
      ...state,
      workspaceChanges: {
        cwd: "E:\\workspace",
        trackedChanges: 1,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: ["old.txt"],
      },
      changeSnapshot: createChangeSnapshotResult(),
      revisionPreview: {
        revisionId: "run-1",
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact",
        canRestore: true,
        changes: [],
      },
    };
    state = reduceTuiState(state, {
      type: "workspace.targets.loaded",
      expectedCwd: "E:\\workspace",
      targets: [state.workspaceTargets[0]!, managed],
    });
    expect(state.selectedWorkspaceTargetIndex).toBe(0);

    state = reduceTuiState(state, {
      type: "workspace.switched",
      previousCwd: "E:\\workspace",
      targetKey: managed.targetKey,
      target: managed,
    });

    expect(state.cwd).toBe(managed.cwd);
    expect(state.workspaceChanges).toBeUndefined();
    expect(state.changeSnapshot).toBeUndefined();
    expect(state.revisionPreview).toBeUndefined();
    expect(state.selectedWorkspaceTargetIndex).toBe(1);

    const switched = state;
    state = reduceTuiState(state, {
      type: "workspace.loaded",
      expectedCwd: "E:\\workspace",
      summary: {
        cwd: "E:\\workspace",
        trackedChanges: 9,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: ["late.txt"],
      },
    });
    expect(state).toBe(switched);
    state = reduceTuiState(state, {
      type: "change.snapshot.completed",
      agentRunId: "run-1",
      cwd: "E:\\workspace",
      result: createChangeSnapshotResult(),
    });
    expect(state).toBe(switched);
  });

  it("fails closed when an active run or stale selection attempts to switch workspaces", () => {
    const managed = {
      targetKey: "worktree:worktree-1",
      kind: "managed" as const,
      worktreeId: "worktree-1",
      cwd: "E:\\managed\\worktree-1",
      branch: "bdd/worktree-1",
      status: "ready" as const,
      dirty: false,
      trackedChanges: 0,
      untrackedChanges: 0,
      conflictChanges: 0,
      extraCommitCount: 0,
    };
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, {
      type: "workspace.targets.loaded",
      expectedCwd: state.cwd,
      targets: [state.workspaceTargets[0]!, managed],
    });
    state = reduceTuiState(state, { type: "workspace.target.index.selected", index: 1 });
    state = reduceTuiState(state, {
      type: "conversation.accepted",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Change a file",
    });

    state = reduceTuiState(state, {
      type: "workspace.switched",
      previousCwd: "E:\\workspace",
      targetKey: managed.targetKey,
      target: managed,
    });
    expect(state.cwd).toBe("E:\\workspace");
    expect(state.notice).toContain("active run");

    const active = state;
    state = reduceTuiState(state, {
      type: "workspace.switched",
      previousCwd: "E:\\stale",
      targetKey: managed.targetKey,
      target: managed,
    });
    expect(state.cwd).toBe(active.cwd);
  });

  it("binds command job output only to the current exact selection", () => {
    const first = createCommandJobSnapshot("11111111-1111-4111-8111-111111111111");
    const second = createCommandJobSnapshot("22222222-2222-4222-8222-222222222222");
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, { type: "command.jobs.loaded", jobs: [first, second] });
    state = reduceTuiState(state, { type: "command.job.index.selected", index: 1 });

    const beforeLatePage = state;
    state = reduceTuiState(state, {
      type: "command.job.output.loaded",
      jobId: first.jobId,
      page: createCommandJobPage(first.jobId, 0, 8),
    });
    expect(state).toBe(beforeLatePage);

    state = reduceTuiState(state, {
      type: "command.job.output.loaded",
      jobId: second.jobId,
      page: createCommandJobPage(second.jobId, 8, 16),
    });
    expect(state.selectedCommandJobIndex).toBe(1);
    expect(state.commandJobOutput).toMatchObject({ jobId: second.jobId, startCursor: 8, nextCursor: 16 });
    expect(state.commandJobPageCursors).toEqual([8]);
  });

  it("navigates command job output with exact cursor history", () => {
    const job = createCommandJobSnapshot("33333333-3333-4333-8333-333333333333");
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, { type: "command.jobs.loaded", jobs: [job] });
    state = reduceTuiState(state, {
      type: "command.job.output.loaded",
      jobId: job.jobId,
      page: createCommandJobPage(job.jobId, 0, 8),
    });
    state = reduceTuiState(state, {
      type: "command.job.output.page.navigated",
      direction: "next",
      jobId: job.jobId,
      cursor: 8,
      page: createCommandJobPage(job.jobId, 8, 16),
    });
    expect(state.commandJobOutput?.startCursor).toBe(8);
    expect(state.commandJobPageCursors).toEqual([0, 8]);

    const current = state;
    state = reduceTuiState(state, {
      type: "command.job.output.page.navigated",
      direction: "next",
      jobId: job.jobId,
      cursor: 15,
      page: createCommandJobPage(job.jobId, 15, 23),
    });
    expect(state).toBe(current);

    state = reduceTuiState(state, {
      type: "command.job.output.page.navigated",
      direction: "previous",
      jobId: job.jobId,
      cursor: 0,
      page: createCommandJobPage(job.jobId, 0, 8),
    });
    expect(state.commandJobOutput?.startCursor).toBe(0);
    expect(state.commandJobPageCursors).toEqual([0]);
  });

  it("confirms and applies cancellation only for the exact selected running job", () => {
    const first = createCommandJobSnapshot("44444444-4444-4444-8444-444444444444");
    const second = createCommandJobSnapshot("55555555-5555-4555-8555-555555555555");
    let state = createInitialTuiState("E:\\workspace");
    state = reduceTuiState(state, { type: "command.jobs.loaded", jobs: [first, second] });
    state = reduceTuiState(state, { type: "command.job.index.selected", index: 1 });

    state = reduceTuiState(state, { type: "command.job.cancel.requested", jobId: first.jobId });
    expect(state.commandJobCancelConfirmation).toBeUndefined();
    state = reduceTuiState(state, { type: "command.job.cancel.requested", jobId: second.jobId });
    expect(state.commandJobCancelConfirmation).toEqual({ jobId: second.jobId, stage: "confirm" });

    const beforeStaleResult = state;
    state = reduceTuiState(state, {
      type: "command.job.cancelled",
      jobId: first.jobId,
      snapshot: { ...first, status: "cancelled", endedAt: 3 },
    });
    expect(state).toBe(beforeStaleResult);

    state = reduceTuiState(state, {
      type: "command.job.cancelled",
      jobId: second.jobId,
      snapshot: { ...second, status: "cancelled", endedAt: 3 },
    });
    expect(state.commandJobCancelConfirmation).toBeUndefined();
    expect(state.commandJobs[1]).toMatchObject({ jobId: second.jobId, status: "cancelled" });
    expect(state.commandJobs[0]).toMatchObject({ jobId: first.jobId, status: "running" });

    const terminalState = state;
    state = reduceTuiState(state, {
      type: "command.job.output.loaded",
      jobId: second.jobId,
      page: createCommandJobPage(second.jobId, 0, 8),
    });
    expect(state).toBe(terminalState);
  });
});

function createCommandJobSnapshot(jobId: string): CommandJobSnapshot {
  return {
    jobId,
    status: "running",
    stdinMode: "pipe",
    createdAt: 1,
    updatedAt: 2,
    supportsResize: false,
    oldestCursor: 0,
    nextCursor: 32,
    recovery: {
      lifecycle: "active",
      process: "attached",
      output: "memory_only",
      stdin: "live_only",
      mutationReplay: "forbidden",
    },
  };
}

function createCommandJobPage(jobId: string, startCursor: number, nextCursor: number): CommandJobReadResult {
  return {
    ...createCommandJobSnapshot(jobId),
    output: `page ${startCursor}`,
    startCursor,
    nextCursor,
    hasMore: nextCursor < 32,
    cursorExpired: false,
    cursorAdjusted: false,
  };
}

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
