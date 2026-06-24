import { describe, expect, it } from "vitest";

import {
  WorkflowBudgetGuard,
  WorkflowBudgetExceededError,
  resolveWorkflowBudgetFromEnv,
  DEFAULT_WORKFLOW_MAX_AGENT_CALLS,
  DEFAULT_WORKFLOW_MAX_RETRIES,
  DEFAULT_WORKFLOW_TIMEOUT_MS,
  DEFAULT_WORKFLOW_MAX_CONCURRENT,
} from "./workflow-budget-guard.js";

describe("WorkflowBudgetGuard", () => {
  it("默认不超限时 check 不抛错", () => {
    const guard = new WorkflowBudgetGuard({ maxAgentCalls: 10, maxTokens: 1000 });
    expect(() => guard.check()).not.toThrow();
  });

  it("agent call 超限抛错", () => {
    const guard = new WorkflowBudgetGuard({ maxAgentCalls: 2, onExceeded: "abort" });
    guard.consume(0, 1);
    guard.consume(0, 1);
    expect(() => guard.check()).toThrow(WorkflowBudgetExceededError);
    expect(() => guard.check()).toThrow(/agent call budget exceeded/);
  });

  it("token 超限抛错", () => {
    const guard = new WorkflowBudgetGuard({ maxTokens: 100, onExceeded: "abort" });
    guard.consume(150, 0);
    expect(() => guard.check()).toThrow(/token budget exceeded/);
  });

  it("wall clock 超限抛错", () => {
    const guard = new WorkflowBudgetGuard({ maxWallClockMs: -1, onExceeded: "abort" });
    expect(() => guard.check()).toThrow(/wall clock budget exceeded/);
  });

  it("retry 超限抛错", () => {
    const guard = new WorkflowBudgetGuard({ maxRetries: 1, onExceeded: "abort" });
    guard.consumeRetry();
    expect(() => guard.consumeRetry()).toThrow(/max retries exceeded/);
  });

  it("warn 模式不抛错但标记 exceeded", () => {
    const guard = new WorkflowBudgetGuard({ maxAgentCalls: 1, onExceeded: "warn" });
    guard.consume(0, 1);
    expect(() => guard.check()).not.toThrow();
    expect(guard.isExceeded()).toBe(true);
    expect(guard.getExceededReason()).toMatch(/agent call budget exceeded/);
  });

  it("getUsage 返回正确统计", () => {
    const guard = new WorkflowBudgetGuard({ maxTokens: 1000, maxAgentCalls: 50 });
    guard.consume(100, 2);
    guard.consume(50, 1);
    const usage = guard.getUsage();
    expect(usage.tokens).toBe(150);
    expect(usage.calls).toBe(3);
    expect(usage.retries).toBe(0);
    expect(usage.durationMs).toBeGreaterThanOrEqual(0);
    expect(usage.exceeded).toBe(false);
  });

  it("reset 清零计数", () => {
    const guard = new WorkflowBudgetGuard({ maxTokens: 100 });
    guard.consume(50, 3);
    guard.consumeRetry();
    guard.reset();
    const usage = guard.getUsage();
    expect(usage.tokens).toBe(0);
    expect(usage.calls).toBe(0);
    expect(usage.retries).toBe(0);
    expect(usage.exceeded).toBe(false);
  });

  it("isExceeded 在超限后返回 true", () => {
    const guard = new WorkflowBudgetGuard({ maxAgentCalls: 1, onExceeded: "warn" });
    guard.consume(0, 1);
    guard.check();
    expect(guard.isExceeded()).toBe(true);
  });

  it("未设上限时不超限", () => {
    const guard = new WorkflowBudgetGuard({});
    guard.consume(999999, 999999);
    expect(() => guard.check()).not.toThrow();
    expect(guard.isExceeded()).toBe(false);
  });

  it("WorkflowBudgetExceededError 携带 usage", () => {
    const guard = new WorkflowBudgetGuard({ maxTokens: 10, onExceeded: "abort" });
    guard.consume(20, 1);
    try {
      guard.check();
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowBudgetExceededError);
      const e = err as WorkflowBudgetExceededError;
      expect(e.usage.tokens).toBe(20);
      expect(e.usage.calls).toBe(1);
      expect(e.reason).toMatch(/token budget exceeded/);
    }
  });
});

describe("resolveWorkflowBudgetFromEnv", () => {
  it("无环境变量时使用默认值", () => {
    const budget = resolveWorkflowBudgetFromEnv(() => undefined);
    expect(budget.maxAgentCalls).toBe(DEFAULT_WORKFLOW_MAX_AGENT_CALLS);
    expect(budget.maxRetries).toBe(DEFAULT_WORKFLOW_MAX_RETRIES);
    expect(budget.maxWallClockMs).toBe(DEFAULT_WORKFLOW_TIMEOUT_MS);
    expect(budget.maxConcurrent).toBe(DEFAULT_WORKFLOW_MAX_CONCURRENT);
    expect(budget.onExceeded).toBe("abort");
  });

  it("读取环境变量覆盖默认值", () => {
    const env: Record<string, string> = {
      BELLDANDY_WORKFLOW_MAX_AGENT_CALLS: "100",
      BELLDANDY_WORKFLOW_MAX_RETRIES: "5",
      BELLDANDY_WORKFLOW_TIMEOUT_MS: "300000",
      BELLDANDY_WORKFLOW_MAX_CONCURRENT: "12",
    };
    const budget = resolveWorkflowBudgetFromEnv((name) => env[name]);
    expect(budget.maxAgentCalls).toBe(100);
    expect(budget.maxRetries).toBe(5);
    expect(budget.maxWallClockMs).toBe(300000);
    expect(budget.maxConcurrent).toBe(12);
  });

  it("非法值回退默认", () => {
    const env: Record<string, string> = {
      BELLDANDY_WORKFLOW_MAX_AGENT_CALLS: "not-a-number",
      BELLDANDY_WORKFLOW_MAX_CONCURRENT: "-5",
    };
    const budget = resolveWorkflowBudgetFromEnv((name) => env[name]);
    expect(budget.maxAgentCalls).toBe(DEFAULT_WORKFLOW_MAX_AGENT_CALLS);
    expect(budget.maxConcurrent).toBe(DEFAULT_WORKFLOW_MAX_CONCURRENT);
  });
});
