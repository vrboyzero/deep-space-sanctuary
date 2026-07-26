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
});
