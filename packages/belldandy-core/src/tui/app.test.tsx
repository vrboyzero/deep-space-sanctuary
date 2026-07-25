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
    stdin.write("\x03");
    await instance.waitUntilExit();
  });
});
