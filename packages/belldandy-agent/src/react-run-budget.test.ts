import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_HIGH_RISK_TOOL_CALLS,
  DEFAULT_MAX_RUN_WALL_TIME_MS,
  DEFAULT_MAX_TOTAL_TOKENS,
  ReActRunBudgetTracker,
  createReActRunAbortController,
  normalizeMaxHighRiskToolCalls,
  normalizeMaxRunWallTimeMs,
  normalizeMaxTotalTokens,
} from "./react-run-budget.js";

describe("ReAct run budgets", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses finite defaults for missing or invalid limits", () => {
    expect(normalizeMaxRunWallTimeMs(undefined)).toBe(DEFAULT_MAX_RUN_WALL_TIME_MS);
    expect(normalizeMaxRunWallTimeMs(0)).toBe(DEFAULT_MAX_RUN_WALL_TIME_MS);
    expect(normalizeMaxTotalTokens(Number.NaN)).toBe(DEFAULT_MAX_TOTAL_TOKENS);
    expect(normalizeMaxTotalTokens(0)).toBe(DEFAULT_MAX_TOTAL_TOKENS);
    expect(normalizeMaxHighRiskToolCalls(undefined)).toBe(DEFAULT_MAX_HIGH_RISK_TOOL_CALLS);
    expect(normalizeMaxHighRiskToolCalls(-1)).toBe(DEFAULT_MAX_HIGH_RISK_TOOL_CALLS);
  });

  it("uses provider usage when available and falls back to estimates only when absent", () => {
    const budget = new ReActRunBudgetTracker({
      maxTotalTokens: 100,
      maxHighRiskToolCalls: 4,
    });

    expect(budget.recordModelUsage({
      providerUsageAvailable: true,
      inputTokens: 40,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      fallbackInputTokens: 99,
      fallbackOutputTokens: 99,
    })).toBeUndefined();
    expect(budget.totalTokens).toBe(75);

    const exhausted = budget.recordModelUsage({
      providerUsageAvailable: false,
      inputTokens: 0,
      outputTokens: 0,
      fallbackInputTokens: 20,
      fallbackOutputTokens: 10,
    });
    expect(exhausted).toEqual({
      budget: "total_tokens",
      limit: 100,
      observed: 105,
    });
  });

  it("blocks the next high-risk tool before execution without counting low-risk tools", () => {
    const budget = new ReActRunBudgetTracker({
      maxTotalTokens: 100,
      maxHighRiskToolCalls: 1,
    });

    expect(budget.reserveHighRiskToolCall()).toBeUndefined();
    expect(budget.highRiskToolCalls).toBe(1);
    expect(budget.reserveHighRiskToolCall()).toEqual({
      budget: "high_risk_tool_calls",
      limit: 1,
      observed: 2,
    });
    expect(budget.highRiskToolCalls).toBe(1);
  });

  it("treats zero high-risk tool calls as unlimited", () => {
    const budget = new ReActRunBudgetTracker({
      maxTotalTokens: 100,
      maxHighRiskToolCalls: 0,
    });

    expect(normalizeMaxHighRiskToolCalls(0)).toBe(Number.POSITIVE_INFINITY);
    for (let index = 0; index < 10; index++) {
      expect(budget.reserveHighRiskToolCall()).toBeUndefined();
    }
    expect(budget.highRiskToolCalls).toBe(10);
  });

  it("aborts the run at the wall-time deadline and forwards parent cancellation", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = createReActRunAbortController(parent.signal, 50);

    parent.abort("Stopped by parent.");
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe("Stopped by parent.");
    deadline.dispose();

    const timed = createReActRunAbortController(undefined, 50);
    vi.advanceTimersByTime(50);
    expect(timed.signal.aborted).toBe(true);
    expect(timed.isWallTimeExceeded()).toBe(true);
    timed.dispose();
  });
});
