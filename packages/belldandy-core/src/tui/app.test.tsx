import { PassThrough } from "node:stream";

import { render } from "ink";
import { describe, expect, it, vi } from "vitest";

import type { AgentRunEvent } from "../coding-run/contracts.js";
import { CodingTuiApp } from "./app.js";
import type { CodingTuiRuntime } from "./runtime.js";

describe("CodingTuiApp", () => {
  it("renders a bounded non-empty terminal frame", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 72;
    stdout.rows = 20;
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    stdout.isTTY = false;
    let output = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk) => { output += String(chunk); });
    const runtime = {
      cwd: "E:\\workspace",
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: ["safe\u001b[2Jpath.ts"],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={() => {}}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: false, patchConsole: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    instance.unmount();
    await instance.waitUntilExit();

    expect(output).toContain("Star Sanctuary");
    expect(output).toContain("CHAT");
    expect(output).not.toContain("\u001b[2J");
  });

  it("renders a complete fallback message in an extremely narrow terminal", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 24;
    stdout.rows = 8;
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    stdout.isTTY = false;
    let output = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk) => { output += String(chunk); });
    const runtime = {
      cwd: "E:\\workspace",
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={() => {}}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: false, patchConsole: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    instance.unmount();
    await instance.waitUntilExit();

    expect(output).toContain("Terminal too small.");
    expect(output).not.toContain("coding workbench");
  });

  it("routes SGR mouse input without leaking it into chat and keeps bracketed paste intact", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 72;
    stdout.rows = 24;
    stdout.isTTY = false;
    stdout.setEncoding("utf8");
    let output = "";
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    const runtime = {
      cwd: "E:\\workspace",
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={() => {}}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );

    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    stdin.write("\u001b[200~pasted\ntext\u001b[201~");
    await vi.waitFor(() => expect(output).toContain("> pastedtext"));
    stdin.write("\u001b[<0;18;2M");
    await vi.waitFor(() => expect(output).toContain("Revision Checkpoints"));
    expect(output).not.toContain("[<0;18;2M");

    stdin.write("\x03");
    await instance.waitUntilExit();
  });

  it("shows restore conflict evidence in the Changes checkpoint view", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 100;
    stdout.rows = 24;
    stdout.isTTY = false;
    let output = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    const runtime = {
      cwd: "E:\\workspace",
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => [{
        revisionId: "run-1",
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact" as const,
      }]),
      previewRevision: vi.fn(async () => ({
        revisionId: "run-1",
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact" as const,
        canRestore: false,
        changes: [{
          relativePath: "src/app.ts",
          action: "conflict" as const,
          recordedAfterHash: "a".repeat(64),
          currentHash: "b".repeat(64),
        }],
        conflictArtifact: {
          artifactPath: "E:\\state\\evidence.json",
          capturedAtMs: 3,
          conflictCount: 1,
        },
      })),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp runtime={runtime} onEventRegistration={() => {}} onErrorRegistration={() => {}} />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );
    await vi.waitFor(() => expect(runtime.listRevisions).toHaveBeenCalled());
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("No persisted conversations."));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("Revision Checkpoints"));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.previewRevision).toHaveBeenCalledWith("run-1", "workspace-1"));
    await vi.waitFor(() => expect(output).toContain("conflict src/app.ts"));
    expect(output).toContain("agent aaaaaaa... current bbbbbbb...");
    stdin.write("\x03");
    await instance.waitUntilExit();
  });

  it("refreshes the active run diff after a successful restore", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 100;
    stdout.rows = 24;
    stdout.isTTY = false;
    let output = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    const runtime = {
      cwd: "E:\\workspace",
      requestConversation: vi.fn(async () => binding),
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => [{
        revisionId: "run-1",
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact" as const,
      }]),
      previewRevision: vi.fn(async () => ({
        revisionId: "run-1",
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact" as const,
        canRestore: true,
        changes: [{ relativePath: "src/app.ts", action: "restore" as const }],
      })),
      restoreRevision: vi.fn(async () => ({
        revisionId: "run-1",
        workspaceId: "workspace-1",
        workspaceRoot: "E:\\workspace",
        createdAtMs: 1,
        updatedAtMs: 2,
        changedFileCount: 1,
        recoveryGuarantee: "exact" as const,
        canRestore: true,
        changes: [{ relativePath: "src/app.ts", action: "restore" as const }],
        applied: true,
      })),
      recomputeChangeSnapshot: vi.fn(async () => ({
        status: "available" as const,
        snapshot: {
          diffHash: "sha256:restored",
          files: [],
          hunkCount: 0,
          truncated: false,
          recovery: { recoveryGuarantee: "detect_only" as const, reason: "no_changes" as const },
        },
        page: { hunks: [] },
      })),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp runtime={runtime} onEventRegistration={() => {}} onErrorRegistration={() => {}} />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );
    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(runtime.loadRuntimeSnapshot).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("Restore the change.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.requestConversation).toHaveBeenCalledWith("Restore the change.", undefined));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("No persisted conversations."));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("Revision Checkpoints"));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.previewRevision).toHaveBeenCalledWith("run-1", "workspace-1"));
    stdin.write("\r");
    await vi.waitFor(() => expect(output).toContain("Restore"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await vi.waitFor(() => expect(runtime.restoreRevision).toHaveBeenCalledWith("run-1", "workspace-1"));
    await vi.waitFor(() => expect(runtime.recomputeChangeSnapshot).toHaveBeenCalledWith("run-1"));
    await vi.waitFor(() => expect(output).toContain("Run diff 0 files 0 hunks"));
    instance.unmount();
    await instance.waitUntilExit();
  });

  it("steers an active run once without starting another Conversation", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 72;
    stdout.rows = 20;
    stdout.isTTY = false;
    stdout.setEncoding("utf8");
    let output = "";
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    let onEvent: ((event: AgentRunEvent) => void) | undefined;
    let resolveSteer: (() => void) | undefined;
    const steer = new Promise<void>((resolve) => {
      resolveSteer = resolve;
    });
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    const runtime = {
      cwd: "E:\\workspace",
      requestConversation: vi.fn(async () => binding),
      steer: vi.fn(() => steer),
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={(handler) => { onEvent = handler; }}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );

    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(runtime.loadRuntimeSnapshot).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("Inspect the workspace.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.requestConversation).toHaveBeenCalledWith("Inspect the workspace.", undefined));
    await new Promise((resolve) => setTimeout(resolve, 20));
    onEvent?.({
      version: "v1",
      seq: 1,
      timestampMs: 1,
      source: "conversation",
      binding,
      type: "run.started",
      payload: { status: "running" },
    });
    await vi.waitFor(() => expect(output).toContain("running"));

    stdin.write("Focus on the failing test.");
    await vi.waitFor(() => expect(output).toContain("> Focus on the failing test."));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.steer).toHaveBeenCalledWith(binding, "Focus on the failing test."));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.steer).toHaveBeenCalledTimes(1);
    expect(runtime.requestConversation).toHaveBeenCalledTimes(1);
    resolveSteer?.();
    await vi.waitFor(() => expect(output).toContain("Steer queued for the active run."));

    instance.unmount();
    await instance.waitUntilExit();
  });

  it("navigates bounded run diff hunks without recomputing the snapshot", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 100;
    stdout.rows = 24;
    stdout.isTTY = false;
    stdout.setEncoding("utf8");
    let output = "";
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    let onEvent: ((event: AgentRunEvent) => void) | undefined;
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    const firstPage = {
      snapshotId: "snapshot-1",
      diffHash: "sha256:diff",
      hunks: [{ path: "one.txt", binary: false, patch: "@@ first\n-one before\n+one after" }],
      nextCursor: "cursor-2",
    };
    const secondPage = {
      snapshotId: "snapshot-1",
      diffHash: "sha256:diff",
      hunks: [{ path: "two.txt", binary: false, patch: "@@ second\n-two before\n+two after" }],
    };
    const runtime = {
      cwd: "E:\\workspace",
      requestConversation: vi.fn(async () => binding),
      completeChangeSnapshot: vi.fn(async () => ({
        status: "available",
        snapshot: {
          version: 1,
          snapshotId: "snapshot-1",
          baseline: { baselineId: "baseline-1", source: "run_start", hash: "sha256:baseline" },
          workspaceRoot: "E:\\workspace",
          currentHash: "sha256:current",
          diffHash: "sha256:diff",
          capturedAtMs: 1,
          files: [
            { path: "one.txt", status: "modified", binary: false, diffAvailable: true },
            { path: "two.txt", status: "modified", binary: false, diffAvailable: true },
          ],
          hunkCount: 2,
          truncated: false,
          truncationReasons: [],
          coverage: {
            complete: true,
            fileCount: 2,
            storedFileCount: 2,
            storedBytes: 40,
            omittedFileCount: 0,
            reasons: [],
          },
          recovery: { recoveryGuarantee: "detect_only", reason: "checkpoint_missing" },
          artifacts: { summaryPath: "summary.json", patchPath: "changes.patch" },
        },
        page: firstPage,
      })),
      readChangeSnapshotPage: vi.fn(async (_snapshotId: string, cursor?: string) => (
        cursor === "cursor-2" ? secondPage : firstPage
      )),
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 2,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: ["one.txt", "two.txt"],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={(handler) => { onEvent = handler; }}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );

    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(runtime.loadRuntimeSnapshot).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("Change both files.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.requestConversation).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    onEvent?.({
      version: "v1",
      seq: 1,
      timestampMs: 1,
      source: "conversation",
      binding,
      type: "run.completed",
      payload: { output: { text: "done" } },
    });
    await vi.waitFor(() => expect(runtime.completeChangeSnapshot).toHaveBeenCalledWith("run-1"));
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("Hunk 1/2 one.txt"));

    stdin.write("\x1b[6~");
    await vi.waitFor(() => expect(runtime.readChangeSnapshotPage).toHaveBeenCalledWith("snapshot-1", "cursor-2"));
    await vi.waitFor(() => expect(output).toContain("Hunk 2/2 two.txt"));
    stdin.write("\x1b[5~");
    await vi.waitFor(() => expect(runtime.readChangeSnapshotPage).toHaveBeenCalledWith("snapshot-1", undefined));
    expect(runtime.completeChangeSnapshot).toHaveBeenCalledTimes(1);

    instance.unmount();
    await instance.waitUntilExit();
  });

  it("restores a pending permission queue and resolves only the selected exact request", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 100;
    stdout.rows = 24;
    stdout.isTTY = false;
    stdout.setEncoding("utf8");
    let output = "";
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    const permissions = [{
      agentRunId: "run-1",
      toolCallId: "tool-first",
      toolName: "file_write",
    }, {
      agentRunId: "run-2",
      worktreeId: "worktree-2",
      toolCallId: "tool-second",
      toolName: "command_job",
      commandPreview: {
        kind: "command" as const,
        action: "cancel" as const,
        jobId: "11111111-1111-4111-8111-111111111111",
      },
    }];
    const runtime = {
      cwd: "E:\\workspace",
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: true,
        gatewayPaired: true,
        checks: { pass: 1, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
      listPendingPermissions: vi.fn(async () => permissions),
      listCommandJobs: vi.fn(async () => []),
      listWorkspaceTargets: vi.fn(async () => [{
        targetKey: "launch",
        kind: "launch",
        cwd: "E:\\workspace",
        status: "ready",
      }]),
      respondPermission: vi.fn(async () => {}),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp runtime={runtime} onEventRegistration={() => {}} onErrorRegistration={() => {}} />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );
    await vi.waitFor(() => expect(runtime.listPendingPermissions).toHaveBeenCalled());
    await vi.waitFor(() => expect(output).toContain("1/2"));
    expect(output).toContain("tool-first");

    stdin.write("\x1b[B");
    await vi.waitFor(() => expect(output).toContain("2/2"));
    expect(output).toContain("tool-second");
    stdin.write("\x1b[C");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");

    await vi.waitFor(() => expect(runtime.respondPermission).toHaveBeenCalledWith(permissions[1], "deny"));
    await vi.waitFor(() => expect(output).toContain("1/1"));
    expect(runtime.respondPermission).toHaveBeenCalledTimes(1);

    instance.unmount();
    await instance.waitUntilExit();
  });

  it("views paged command job output and cancels only the selected job", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 100;
    stdout.rows = 24;
    stdout.isTTY = false;
    stdout.setEncoding("utf8");
    let output = "";
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    const firstJobId = "11111111-1111-4111-8111-111111111111";
    const secondJobId = "22222222-2222-4222-8222-222222222222";
    const jobs = [firstJobId, secondJobId].map((jobId, index) => ({
      jobId,
      status: "running" as const,
      stdinMode: "pipe" as const,
      createdAt: index + 1,
      updatedAt: index + 2,
      supportsResize: false,
      oldestCursor: 0,
      nextCursor: 16,
      recovery: {
        lifecycle: "active" as const,
        process: "attached" as const,
        output: "memory_only" as const,
        stdin: "live_only" as const,
        mutationReplay: "forbidden" as const,
      },
    }));
    const runtime = {
      cwd: "E:\\workspace",
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: true,
        gatewayPaired: true,
        checks: { pass: 1, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
      listPendingPermissions: vi.fn(async () => []),
      listCommandJobs: vi.fn(async () => jobs),
      listWorkspaceTargets: vi.fn(async () => [{
        targetKey: "launch",
        kind: "launch",
        cwd: "E:\\workspace",
        status: "ready",
      }]),
      readCommandJob: vi.fn(async (jobId: string, cursor?: number) => ({
        ...jobs.find((job) => job.jobId === jobId)!,
        output: `${jobId === firstJobId ? "first" : "second"} page ${cursor ?? 0}`,
        startCursor: cursor ?? 0,
        nextCursor: (cursor ?? 0) + 8,
        hasMore: (cursor ?? 0) === 0,
        cursorExpired: false,
        cursorAdjusted: false,
      })),
      cancelCommandJob: vi.fn(async (jobId: string) => ({
        ...jobs.find((job) => job.jobId === jobId)!,
        status: "cancelled" as const,
        endedAt: 3,
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp runtime={runtime} onEventRegistration={() => {}} onErrorRegistration={() => {}} />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );
    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("No persisted conversations."));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("Revision Checkpoints"));
    stdin.write("\t");
    await vi.waitFor(() => expect(runtime.listCommandJobs).toHaveBeenCalled());
    await vi.waitFor(() => expect(output).toContain("first page 0"));
    expect(output).toContain("replay forbidden");

    stdin.write("\x1b[B");
    await vi.waitFor(() => expect(runtime.readCommandJob).toHaveBeenCalledWith(secondJobId));
    await vi.waitFor(() => expect(output).toContain("second page 0"));
    stdin.write("\x1b[6~");
    await vi.waitFor(() => expect(runtime.readCommandJob).toHaveBeenCalledWith(secondJobId, 8));
    await vi.waitFor(() => expect(output).toContain("second page 8"));

    stdin.write("\x7f");
    await vi.waitFor(() => expect(output).toContain("Cancel Job"));
    expect(output).toContain(secondJobId);
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.cancelCommandJob).toHaveBeenCalledWith(secondJobId));
    expect(runtime.cancelCommandJob).toHaveBeenCalledTimes(1);

    stdin.write("\x03");
    await instance.waitUntilExit();
  });

  it("cancels an active run once when Ctrl+C is pressed repeatedly", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 72;
    stdout.rows = 20;
    stdout.isTTY = false;
    let output = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    let onEvent: ((event: AgentRunEvent) => void) | undefined;
    let resolveCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    const runtime = {
      cwd: "E:\\workspace",
      requestConversation: vi.fn(async () => binding),
      cancel: vi.fn(() => cancellation),
      completeChangeSnapshot: vi.fn(async () => ({
        status: "available",
        snapshot: {
          diffHash: "sha256:run-diff",
          files: [{ path: "note.txt" }],
          hunkCount: 1,
          truncated: false,
          recovery: { recoveryGuarantee: "detect_only", reason: "checkpoint_missing" },
        },
        page: {
          hunks: [{ path: "note.txt", patch: "@@ -1 +1 @@\n-before\n+after" }],
        },
      })),
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={(handler) => { onEvent = handler; }}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );

    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(runtime.loadRuntimeSnapshot).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("Inspect the workspace.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.requestConversation).toHaveBeenCalledWith("Inspect the workspace.", undefined));
    await vi.waitFor(() => expect(onEvent).toBeTypeOf("function"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    onEvent?.({
      version: "v1",
      seq: 1,
      timestampMs: 1,
      source: "conversation",
      binding,
      type: "run.started",
      payload: { status: "running" },
    });
    await vi.waitFor(() => expect(output).toContain("running"));

    stdin.write("\x03");
    await vi.waitFor(() => expect(runtime.cancel).toHaveBeenCalledTimes(1));
    stdin.write("\x03");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.cancel).toHaveBeenCalledTimes(1);
    expect(runtime.cancel).toHaveBeenCalledWith(binding);

    resolveCancellation?.();
    onEvent?.({
      version: "v1",
      seq: 2,
      timestampMs: 2,
      source: "conversation",
      binding,
      type: "run.cancelled",
      payload: { reason: "Cancelled from TUI." },
    });
    await vi.waitFor(() => expect(output).toContain("cancelled"));
    await vi.waitFor(() => expect(runtime.completeChangeSnapshot).toHaveBeenCalledWith("run-1"));
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("Run diff 1 files 1 hunks"));
    expect(output).toContain("Recovery detect-only checkpoint missing");
    expect(output).toContain("-before");
    stdin.write("\x03");
    await instance.waitUntilExit();
  });

  it("switches an idle exact worktree and blocks another switch while a run is active", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 100;
    stdout.rows = 24;
    stdout.isTTY = false;
    stdout.setEncoding("utf8");
    let output = "";
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    let runtimeCwd = "E:\\workspace";
    const launch = { targetKey: "launch", kind: "launch" as const, cwd: runtimeCwd, status: "ready" as const };
    const managed = {
      targetKey: "worktree:worktree-1",
      kind: "managed" as const,
      worktreeId: "worktree-1",
      cwd: "E:\\managed\\worktree-1",
      branch: "bdd/worktree-1",
      status: "ready" as const,
      dirty: false,
    };
    const runtime = {
      get cwd() { return runtimeCwd; },
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: runtimeCwd,
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: true,
        gatewayPaired: true,
        checks: { pass: 1, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
      listPendingPermissions: vi.fn(async () => []),
      listCommandJobs: vi.fn(async () => []),
      listWorkspaceTargets: vi.fn(async () => [launch, managed]),
      switchWorkspace: vi.fn(async (targetKey: string) => {
        expect(targetKey).toBe(managed.targetKey);
        runtimeCwd = managed.cwd;
        return managed;
      }),
      requestConversation: vi.fn(async () => ({ conversationId: "conversation-1", agentRunId: "run-1" })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={() => {}}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );

    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(runtime.listWorkspaceTargets).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("Worktrees"));
    stdin.write("\x1b[D");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\x1b[B");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.switchWorkspace).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(output).toContain(managed.cwd));

    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("Inspect managed workspace.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.requestConversation).toHaveBeenCalled());
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\x1b[A");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runtime.switchWorkspace).toHaveBeenCalledTimes(1);
    expect(output).toContain("active run");

    instance.unmount();
    await instance.waitUntilExit();
  });

  it("shows an exact remote push preview and writes only after the modal confirmation", async () => {
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
    stdout.columns = 100;
    stdout.rows = 24;
    stdout.isTTY = false;
    stdout.setEncoding("utf8");
    let output = "";
    stdout.on("data", (chunk) => { output += String(chunk); });
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn(() => stdin);
    stdin.ref = vi.fn(() => stdin);
    stdin.unref = vi.fn(() => stdin);
    const preview = {
      operation: "push" as const,
      canConfirm: true,
      blockers: [],
      approval: { mode: "user_interaction" as const, delegable: false as const, rememberable: false as const },
      source: { repoRoot: "E:\\workspace", branch: "main", commit: "a".repeat(40), upstream: null },
      target: {
        remote: "private",
        url: "https://github.com/example/private.git",
        branch: "main",
        expectedOid: "b".repeat(40),
      },
      diff: { baseOid: "b".repeat(40), sha256: "c".repeat(64), byteLength: 12 },
      receipt: { receiptId: "remote-delivery-receipt", expiresAtMs: Date.now() + 60_000 },
    };
    const runtime = {
      cwd: "E:\\workspace",
      listConversations: vi.fn(async () => []),
      inspectWorkspace: vi.fn(async () => ({
        cwd: "E:\\workspace",
        repoRoot: "E:\\workspace",
        branch: "main",
        trackedChanges: 0,
        untrackedChanges: 0,
        conflictChanges: 0,
        changedPaths: [],
      })),
      listRevisions: vi.fn(async () => []),
      listRemoteDeliveryTargets: vi.fn(async () => [{
        remote: "private",
        url: "https://github.com/example/private.git",
        pushBranches: ["main"],
        pullRequestBases: ["main"],
        repository: "example/private",
      }]),
      previewRemotePush: vi.fn(async () => preview),
      confirmRemotePush: vi.fn(async () => ({
        operation: "push" as const,
        outcome: "succeeded" as const,
        applied: true,
        blockers: [],
        postcondition: { remoteOid: "a".repeat(40) },
      })),
      loadRuntimeSnapshot: vi.fn(async () => ({
        generatedAt: "now",
        gatewayConnected: false,
        gatewayPaired: false,
        checks: { pass: 0, warn: 0, fail: 0 },
        agents: { total: 0, running: 0, error: 0 },
        subtasks: { total: 0, active: 0, failed: 0 },
        hints: [],
      })),
    } as unknown as CodingTuiRuntime;

    const instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={() => {}}
        onErrorRegistration={() => {}}
      />,
      { stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );

    await vi.waitFor(() => expect(stdin.setRawMode).toHaveBeenCalledWith(true));
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\t");
    await vi.waitFor(() => expect(output).toContain("Delivery private/main"));
    stdin.write("\x10");
    await vi.waitFor(() => expect(runtime.previewRemotePush).toHaveBeenCalledWith("private", "main"));
    await vi.waitFor(() => expect(output).toContain("User approval only"));
    expect(output).toContain("Target private/main");
    expect(output).toContain("https://github.com/example/private.git");
    expect(output).toContain("Current remote bbbbbbbbbb");
    expect(output).toContain("New commit aaaaaaaaaa");
    expect(output).toContain("Diff base bbbbbbbbbb | sha256 cccccccccc | 12 bytes");
    expect(output).toContain("External side effect: update remote ref; rollback is not guaranteed");
    expect(output).toContain("Delegable no | Rememberable no");
    expect(runtime.confirmRemotePush).not.toHaveBeenCalled();

    output = "";
    stdout.columns = 32;
    stdout.emit("resize");
    await vi.waitFor(() => expect(output).toContain("Approval"));
    expect(output).toContain("Push");
    expect(output).toContain("Cancel");
    expect(output).toContain("Target private/main");
    expect(output).toContain("URL https://github.com/ex...");
    expect(output).toContain("Current remote bbbbbbbbbb");
    expect(output).toContain("New commit aaaaaaaaaa");
    expect(output).toContain("Diff base bbbbbbbbbb");
    expect(output).toContain("External side effect:");
    expect(output).toContain("Delegable no");
    expect(output).not.toContain("Terminal too small.");
    expect(runtime.confirmRemotePush).not.toHaveBeenCalled();

    stdin.write("\r");
    await vi.waitFor(() => expect(runtime.confirmRemotePush).toHaveBeenCalledWith("remote-delivery-receipt"));
    await vi.waitFor(() => expect(output).toContain("Push verified"));

    instance.unmount();
    await instance.waitUntilExit();
  });
});
