import { describe, expect, it, vi } from "vitest";

import type { SpawnResult } from "@belldandy/agent";
import {
  WorkflowBudgetExceededError,
  WorkflowBudgetGuard,
} from "./workflow-budget-guard.js";
import { runWorkflowAgentCall } from "./workflow-agent-call-runner.js";

function successResult(output = "okay"): SpawnResult {
  return { success: true, output, sessionId: "sub_success" };
}

function failureResult(error = "temporary failure"): SpawnResult {
  return { success: false, output: "", error, sessionId: "sub_failure" };
}

function createOptions(overrides: Partial<Parameters<typeof runWorkflowAgentCall>[0]> = {}) {
  return {
    budgetGuard: new WorkflowBudgetGuard({
      maxAgentCalls: 10,
      maxTokens: 100,
      maxRetries: 2,
      onExceeded: "abort",
    }),
    beforeFirstAttempt: vi.fn(),
    spawn: vi.fn(async () => failureResult()),
    estimateTokens: (output: string) => Math.ceil(output.length / 4),
    ...overrides,
  };
}

describe("runWorkflowAgentCall", () => {
  it("默认零重试并只消费首次 call", async () => {
    const options = createOptions();

    await expect(runWorkflowAgentCall(options)).resolves.toMatchObject({
      result: { success: false },
    });

    expect(options.spawn).toHaveBeenCalledTimes(1);
    expect(options.budgetGuard.getUsage()).toMatchObject({ calls: 1, retries: 0, tokens: 0 });
  });

  it("显式 retry 为每次 attempt 重新预留并在成功时结算 token", async () => {
    const spawn = vi.fn()
      .mockResolvedValueOnce(failureResult())
      .mockResolvedValueOnce(successResult());
    const options = createOptions({ requestedMaxRetries: 1, spawn });

    await expect(runWorkflowAgentCall(options)).resolves.toMatchObject({
      result: { success: true, output: "okay" },
      tokenCount: 1,
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    expect(options.budgetGuard.getUsage()).toMatchObject({ calls: 2, retries: 1, tokens: 1 });
    expect(options.beforeFirstAttempt).toHaveBeenCalledTimes(1);
  });

  it("retry hard cap 在下一次 spawn 前阻断并回滚 call reservation", async () => {
    const budgetGuard = new WorkflowBudgetGuard({
      maxAgentCalls: 10,
      maxTokens: 100,
      maxRetries: 1,
      onExceeded: "abort",
    });
    const options = createOptions({ requestedMaxRetries: 2, budgetGuard });

    await expect(runWorkflowAgentCall(options)).rejects.toBeInstanceOf(WorkflowBudgetExceededError);

    expect(options.spawn).toHaveBeenCalledTimes(2);
    expect(budgetGuard.getUsage()).toMatchObject({ calls: 2, retries: 1, tokens: 0 });
  });

  it("call hard cap 在 retry 计数和下一次 spawn 前阻断", async () => {
    const budgetGuard = new WorkflowBudgetGuard({
      maxAgentCalls: 1,
      maxTokens: 100,
      maxRetries: 2,
      onExceeded: "abort",
    });
    const options = createOptions({ requestedMaxRetries: 1, budgetGuard });

    await expect(runWorkflowAgentCall(options)).rejects.toBeInstanceOf(WorkflowBudgetExceededError);

    expect(options.spawn).toHaveBeenCalledTimes(1);
    expect(budgetGuard.getUsage()).toMatchObject({ calls: 1, retries: 0, tokens: 0 });
  });

  it("abort 后不重试结构化失败", async () => {
    const controller = new AbortController();
    const spawn = vi.fn(async () => {
      controller.abort("cancelled between attempts");
      return failureResult();
    });
    const options = createOptions({
      requestedMaxRetries: 2,
      abortSignal: controller.signal,
      spawn,
    });

    await expect(runWorkflowAgentCall(options)).rejects.toThrow("cancelled between attempts");

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(options.budgetGuard.getUsage()).toMatchObject({ calls: 1, retries: 0, tokens: 0 });
  });

  it("spawn 抛错不重试但保留已发起 call", async () => {
    const spawn = vi.fn(async () => { throw new Error("transport failed"); });
    const options = createOptions({ requestedMaxRetries: 2, spawn });

    await expect(runWorkflowAgentCall(options)).rejects.toThrow("transport failed");

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(options.budgetGuard.getUsage()).toMatchObject({ calls: 1, retries: 0, tokens: 0 });
  });

  it("首次 pending 写失败时不 spawn 并回滚 call reservation", async () => {
    const beforeFirstAttempt = vi.fn(() => { throw new Error("journal failed"); });
    const options = createOptions({
      requestedMaxRetries: 2,
      beforeFirstAttempt,
    });

    await expect(runWorkflowAgentCall(options)).rejects.toThrow("journal failed");

    expect(options.spawn).not.toHaveBeenCalled();
    expect(options.budgetGuard.getUsage()).toMatchObject({ calls: 0, retries: 0, tokens: 0 });
  });
});
