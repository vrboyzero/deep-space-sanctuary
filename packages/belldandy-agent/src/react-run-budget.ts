/**
 * ReAct 单次运行的资源预算。
 *
 * 此模块保持无 I/O，供 Agent 循环在模型响应与实际 Tool 执行前做确定性决策。
 */

export const DEFAULT_MAX_RUN_WALL_TIME_MS = 300_000;
export const DEFAULT_MAX_TOTAL_TOKENS = 128_000;
export const DEFAULT_MAX_HIGH_RISK_TOOL_CALLS = 4;

export type ReActRunBudgetKind = "wall_time_ms" | "total_tokens" | "high_risk_tool_calls";

export type ReActRunBudgetExhausted = {
  budget: ReActRunBudgetKind;
  limit: number;
  observed: number;
};

export type ReActRunBudgetUsage = {
  /** Provider 返回的 usage 是否完整可用；可用时始终优先于本地估算。 */
  providerUsageAvailable: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Provider 未返回 usage 时使用的本地 prompt / output 估算。 */
  fallbackInputTokens?: number;
  fallbackOutputTokens?: number;
};

export type ReActRunBudgetTrackerOptions = {
  maxTotalTokens: number;
  maxHighRiskToolCalls: number;
};

export type ReActRunAbortController = {
  signal: AbortSignal;
  dispose: () => void;
  isWallTimeExceeded: () => boolean;
};

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeNumber(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

/** 非正或非法 wall-time 不允许关闭安全默认值。 */
export function normalizeMaxRunWallTimeMs(value: number | undefined): number {
  return normalizePositiveLimit(value, DEFAULT_MAX_RUN_WALL_TIME_MS);
}

/** 非正或非法累计 token 不允许关闭安全默认值。 */
export function normalizeMaxTotalTokens(value: number | undefined): number {
  return normalizePositiveLimit(value, DEFAULT_MAX_TOTAL_TOKENS);
}

/** 0 明确表示禁止高风险 Tool；负数和非法值回退到安全默认值。 */
export function normalizeMaxHighRiskToolCalls(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_MAX_HIGH_RISK_TOOL_CALLS;
  }
  return Math.floor(value);
}

/**
 * 将父级取消与本轮 wall-time 合并。
 *
 * deadline 只负责中止后续模型/Tool 等可取消等待；调用方仍需依据
 * isWallTimeExceeded() 输出 budget_exhausted，而不是误报成用户主动 stop。
 */
export function createReActRunAbortController(
  parentSignal: AbortSignal | undefined,
  maxRunWallTimeMs: number,
): ReActRunAbortController {
  const controller = new AbortController();
  let wallTimeExceeded = false;

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeout = setTimeout(() => {
    // 父级先取消时保持 stopped 语义，不能被稍后的 deadline 覆盖成预算耗尽。
    if (controller.signal.aborted) {
      return;
    }
    wallTimeExceeded = true;
    controller.abort("ReAct run wall-time budget exhausted.");
  }, maxRunWallTimeMs);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    isWallTimeExceeded: () => wallTimeExceeded,
  };
}

export class ReActRunBudgetTracker {
  readonly maxTotalTokens: number;
  readonly maxHighRiskToolCalls: number;
  totalTokens = 0;
  highRiskToolCalls = 0;

  constructor(options: ReActRunBudgetTrackerOptions) {
    this.maxTotalTokens = normalizeMaxTotalTokens(options.maxTotalTokens);
    this.maxHighRiskToolCalls = normalizeMaxHighRiskToolCalls(options.maxHighRiskToolCalls);
  }

  /**
   * Provider usage 覆盖本地估算；缺失 usage 才以请求/响应估算补齐。
   * cache read / creation 也计入本轮总 token 成本。
   */
  recordModelUsage(usage: ReActRunBudgetUsage): ReActRunBudgetExhausted | undefined {
    const consumedTokens = usage.providerUsageAvailable
      ? normalizeNonNegativeNumber(usage.inputTokens)
        + normalizeNonNegativeNumber(usage.outputTokens)
        + normalizeNonNegativeNumber(usage.cacheReadTokens)
        + normalizeNonNegativeNumber(usage.cacheCreationTokens)
      : normalizeNonNegativeNumber(usage.fallbackInputTokens)
        + normalizeNonNegativeNumber(usage.fallbackOutputTokens);

    this.totalTokens += consumedTokens;
    if (this.totalTokens > this.maxTotalTokens) {
      return {
        budget: "total_tokens",
        limit: this.maxTotalTokens,
        observed: this.totalTokens,
      };
    }
    return undefined;
  }

  /** 在真实 ToolExecutor.execute() 前预留一次高风险调用配额。 */
  reserveHighRiskToolCall(): ReActRunBudgetExhausted | undefined {
    const observed = this.highRiskToolCalls + 1;
    if (observed > this.maxHighRiskToolCalls) {
      return {
        budget: "high_risk_tool_calls",
        limit: this.maxHighRiskToolCalls,
        observed,
      };
    }
    this.highRiskToolCalls = observed;
    return undefined;
  }
}
