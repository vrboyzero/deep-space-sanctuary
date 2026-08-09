import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_HIGH_RISK_TOOL_CALLS,
  DEFAULT_MAX_RUN_WALL_TIME_MS,
  DEFAULT_MAX_TOTAL_TOKENS,
  MODEL_LOOP_COST_CONTAINMENT_LIMITS,
  MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
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

  it("fails closed before model, file-read, and text-search cost-containment limits", () => {
    const budget = new ReActRunBudgetTracker({
      maxTotalTokens: 24_000,
      maxHighRiskToolCalls: 4,
      modelLoopBudgetPolicy: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
    });

    for (let index = 0; index < MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxModelCalls; index++) {
      expect(budget.reserveModelCall({ minimumInputTokens: 1 })).toBeUndefined();
    }
    expect(budget.reserveModelCall({ minimumInputTokens: 1 })).toEqual({
      budget: "model_calls",
      limit: 4,
      observed: 5,
      policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      stage: "before_model_call",
      reasonCode: "model_call_limit",
    });

    expect(budget.reserveToolCall("file_read")).toBeUndefined();
    expect(budget.reserveToolCall("file_read")).toBeUndefined();
    expect(budget.reserveToolCall("file_read")).toEqual({
      budget: "file_read_calls",
      limit: 2,
      observed: 3,
      policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      stage: "before_tool_call",
      reasonCode: "file_read_call_limit",
    });

    expect(budget.reserveToolCall("text_search")).toBeUndefined();
    expect(budget.reserveToolCall("text_search")).toBeUndefined();
    expect(budget.reserveToolCall("text_search")).toEqual({
      budget: "text_search_calls",
      limit: 2,
      observed: 3,
      policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      stage: "before_tool_call",
      reasonCode: "text_search_call_limit",
    });
  });

  it("reserves output capacity and stops before a model call when remaining tokens are insufficient", () => {
    const budget = new ReActRunBudgetTracker({
      maxTotalTokens: 24_000,
      maxHighRiskToolCalls: 4,
      modelLoopBudgetPolicy: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
    });
    expect(budget.recordModelUsage({
      providerUsageAvailable: true,
      inputTokens: 21_000,
      outputTokens: 1_000,
    })).toBeUndefined();

    expect(budget.reserveModelCall({ minimumInputTokens: 1_500 })).toEqual({
      budget: "total_tokens",
      limit: 24_000,
      observed: 24_524,
      policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      stage: "before_model_call",
      reasonCode: "insufficient_remaining_tokens",
    });
    expect(MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve).toBe(1_024);
  });

  it("applies the same output reserve and structured reason to non-mutating model preflights", () => {
    const budget = new ReActRunBudgetTracker({
      maxTotalTokens: 24_000,
      maxHighRiskToolCalls: 4,
      modelLoopBudgetPolicy: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
    });
    expect(budget.recordModelUsage({
      providerUsageAvailable: true,
      inputTokens: 21_000,
      outputTokens: 1_000,
    })).toBeUndefined();

    expect(budget.checkModelCallPreflight({ minimumInputTokens: 1_500 })).toEqual({
      budget: "total_tokens",
      limit: 24_000,
      observed: 24_524,
      policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      stage: "before_model_call",
      reasonCode: "insufficient_remaining_tokens",
    });
    expect(budget.modelCalls).toBe(0);
  });

  it("keeps ordinary runs free of model/read/search limits and output reservation", () => {
    const budget = new ReActRunBudgetTracker({
      maxTotalTokens: 24_000,
      maxHighRiskToolCalls: 4,
    });
    expect(budget.recordModelUsage({
      providerUsageAvailable: true,
      inputTokens: 21_000,
      outputTokens: 1_000,
    })).toBeUndefined();

    for (let index = 0; index < 6; index++) {
      expect(budget.reserveModelCall({ minimumInputTokens: 1_500 })).toBeUndefined();
      expect(budget.reserveToolCall("file_read")).toBeUndefined();
      expect(budget.reserveToolCall("text_search")).toBeUndefined();
    }
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
