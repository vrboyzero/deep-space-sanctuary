import { describe, expect, it, vi } from "vitest";

import {
  HOOK_FAILURE_POLICIES,
  createHookRunner,
} from "./hook-runner.js";
import { HookRegistry } from "./hooks.js";

describe("HookRunner failure policies", () => {
  it("enumerates one explicit failure policy for every Hook", () => {
    expect(HOOK_FAILURE_POLICIES).toEqual({
      before_agent_start: "fail_open",
      agent_end: "fail_open",
      before_compaction: "fail_open",
      after_compaction: "fail_open",
      message_received: "fail_open",
      message_sending: "fail_open",
      message_sent: "fail_open",
      before_tool_call: "fail_closed",
      after_tool_call: "fail_open",
      tool_result_persist: "fail_open",
      session_start: "fail_open",
      session_end: "fail_open",
      gateway_start: "fail_open",
      gateway_stop: "fail_open",
    });
  });

  it("latches a before_tool_call failure closed without skipping later handlers", async () => {
    const registry = new HookRegistry();
    const laterHandler = vi.fn(() => ({
      params: { approved: true },
      block: false,
    }));
    registry.register({
      source: "failing-plugin",
      hookName: "before_tool_call",
      priority: 100,
      handler: () => {
        throw new Error("fixture-secret-must-not-enter-diagnostics");
      },
    });
    registry.register({
      source: "later-owner",
      hookName: "before_tool_call",
      handler: laterHandler,
    });
    const runner = createHookRunner(registry, {
      logger: { error: vi.fn() },
      catchErrors: true,
    });

    await expect(runner.runBeforeToolCall({} as never, {} as never)).resolves.toEqual({
      params: { approved: true },
      block: true,
      blockReason: "Hook handler failed; tool call blocked by fail-closed policy.",
    });
    expect(laterHandler).toHaveBeenCalledOnce();
    expect(JSON.stringify(runner.getDiagnostics())).not.toContain("fixture-secret");
  });

  it("keeps ordinary modifying and parallel Hooks fail-open", async () => {
    const registry = new HookRegistry();
    const modifyingHandler = vi.fn(() => ({ content: "safe-result" }));
    const parallelHandler = vi.fn();
    registry.register({
      source: "failing-modifier",
      hookName: "message_sending",
      priority: 100,
      handler: () => {
        throw new Error("modifier failed");
      },
    });
    registry.register({
      source: "later-modifier",
      hookName: "message_sending",
      handler: modifyingHandler,
    });
    registry.register({
      source: "failing-observer",
      hookName: "agent_end",
      handler: () => {
        throw new Error("observer failed");
      },
    });
    registry.register({
      source: "later-observer",
      hookName: "agent_end",
      handler: parallelHandler,
    });
    const runner = createHookRunner(registry, {
      logger: { error: vi.fn() },
      catchErrors: true,
    });

    await expect(runner.runMessageSending({} as never, {} as never)).resolves.toEqual({
      content: "safe-result",
    });
    await expect(runner.runAgentEnd({} as never, {} as never)).resolves.toBeUndefined();
    expect(modifyingHandler).toHaveBeenCalledOnce();
    expect(parallelHandler).toHaveBeenCalledOnce();
  });

  it("keeps synchronous Hook failures and accidental Promises fail-open", () => {
    const registry = new HookRegistry();
    const laterHandler = vi.fn((event: { message: Record<string, unknown> }) => ({
      message: { ...event.message, retained: true },
    }));
    registry.register({
      source: "failing-sync-owner",
      hookName: "tool_result_persist",
      priority: 100,
      handler: () => {
        throw new Error("sync failed");
      },
    });
    registry.register({
      source: "async-sync-owner",
      hookName: "tool_result_persist",
      priority: 50,
      handler: (() => Promise.resolve({ message: { ignored: true } })) as never,
    });
    registry.register({
      source: "later-sync-owner",
      hookName: "tool_result_persist",
      handler: laterHandler as never,
    });
    const runner = createHookRunner(registry, {
      logger: { error: vi.fn(), warn: vi.fn() },
      catchErrors: true,
    });

    expect(runner.runToolResultPersist({ message: { original: true } }, {} as never)).toEqual({
      message: { original: true, retained: true },
    });
    expect(laterHandler).toHaveBeenCalledOnce();
  });

  it("preserves explicit error propagation when catchErrors is disabled", async () => {
    const registry = new HookRegistry();
    const laterHandler = vi.fn();
    registry.register({
      source: "strict-owner",
      hookName: "before_tool_call",
      priority: 100,
      handler: () => {
        throw new Error("strict failure");
      },
    });
    registry.register({
      source: "later-owner",
      hookName: "before_tool_call",
      handler: laterHandler,
    });
    const runner = createHookRunner(registry, {
      logger: { error: vi.fn() },
      catchErrors: false,
    });

    await expect(runner.runBeforeToolCall({} as never, {} as never)).rejects.toThrow("strict failure");
    expect(laterHandler).not.toHaveBeenCalled();
  });
});
