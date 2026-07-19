import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkflowRunController,
  resolveWorkflowRunBudget,
} from "./workflow-run-controller.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkflowRunController", () => {
  it("在 deadline 到达时中止协作式等待，并保留 deadline 错误", async () => {
    vi.useFakeTimers();
    const deadlineError = new Error("Workflow wall-clock budget exceeded.");
    const controller = createWorkflowRunController({
      deadlineMs: 100,
      onDeadline: () => deadlineError,
    });

    const pending = controller.race(new Promise<void>(() => {}));
    const expectation = expect(pending).rejects.toBe(deadlineError);
    await vi.advanceTimersByTimeAsync(100);

    await expectation;
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(deadlineError);
    controller.dispose();
  });

  it("将父级取消转发到当前 run", () => {
    const parent = new AbortController();
    const controller = createWorkflowRunController({ parentSignal: parent.signal });

    parent.abort("Parent workflow stopped.");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("Parent workflow stopped.");
    controller.dispose();
  });

  it("dispose 后不再接收父级取消", () => {
    const parent = new AbortController();
    const controller = createWorkflowRunController({ parentSignal: parent.signal });

    controller.dispose();
    parent.abort("Parent workflow stopped.");

    expect(controller.signal.aborted).toBe(false);
  });
});

describe("resolveWorkflowRunBudget", () => {
  it("将调用方请求限制在环境硬上限内，不能把 abort 降级为 warn", () => {
    expect(resolveWorkflowRunBudget(
      {
        maxTokens: 300,
        maxAgentCalls: 2,
        maxRetries: 1,
        maxWallClockMs: 100,
        maxConcurrent: 3,
        onExceeded: "abort",
      },
      {
        maxTokens: 3_000,
        maxAgentCalls: 20,
        maxRetries: 10,
        maxWallClockMs: 1_000,
        maxConcurrent: 30,
        onExceeded: "warn",
      },
    )).toEqual({
      maxTokens: 300,
      maxAgentCalls: 2,
      maxRetries: 1,
      maxWallClockMs: 100,
      maxConcurrent: 3,
      onExceeded: "abort",
    });
  });
});
