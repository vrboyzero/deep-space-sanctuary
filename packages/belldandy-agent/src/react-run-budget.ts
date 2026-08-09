/**
 * ReAct 单次运行的资源预算。
 *
 * 此模块保持无 I/O，供 Agent 循环在模型响应与实际 Tool 执行前做确定性决策。
 */

export const DEFAULT_MAX_RUN_WALL_TIME_MS = 300_000;
export const DEFAULT_MAX_TOTAL_TOKENS = 128_000;
export const DEFAULT_MAX_HIGH_RISK_TOOL_CALLS = 4;

export const MODEL_LOOP_COST_CONTAINMENT_POLICY_ID = "cost-containment-v1" as const;
export const MODEL_LOOP_COST_CONTAINMENT_LIMITS = Object.freeze({
  maxModelCalls: 4,
  maxFileReadCalls: 2,
  maxTextSearchCalls: 2,
  minimumOutputTokenReserve: 1_024,
});

export type ModelLoopBudgetPolicy = typeof MODEL_LOOP_COST_CONTAINMENT_POLICY_ID;

export type ReActRunBudgetKind =
  | "wall_time_ms"
  | "total_tokens"
  | "high_risk_tool_calls"
  | "cost_usd"
  | "model_calls"
  | "file_read_calls"
  | "text_search_calls";

export type ReActRunBudgetStage = "before_model_call" | "before_tool_call";
export type ReActRunBudgetReasonCode =
  | "model_call_limit"
  | "file_read_call_limit"
  | "text_search_call_limit"
  | "insufficient_remaining_tokens"
  | "insufficient_remaining_cost";

export type ReActRunBudgetExhausted = {
  budget: ReActRunBudgetKind;
  limit: number;
  observed: number;
  policyId?: ModelLoopBudgetPolicy;
  stage?: ReActRunBudgetStage;
  reasonCode?: ReActRunBudgetReasonCode;
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
  /** 有可用定价信息时的本次模型调用 USD 成本。 */
  costUsd?: number;
};

export type ReActModelCallPreflight = {
  /** 本次调用至少需要发送的输入 token；不预估未知输出。 */
  minimumInputTokens: number;
  /** 受控策略为模型输出预留的 token；普通运行默认为 0。 */
  minimumOutputTokens?: number;
  /** 有价格表时，本次最小输入成本。 */
  minimumCostUsd?: number;
};

export type ReActRunBudgetTrackerOptions = {
  maxTotalTokens: number;
  maxHighRiskToolCalls: number;
  maxCostUsd?: number;
  modelLoopBudgetPolicy?: ModelLoopBudgetPolicy;
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

function normalizePositiveCostLimit(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/** 非正或非法 wall-time 不允许关闭安全默认值。 */
export function normalizeMaxRunWallTimeMs(value: number | undefined): number {
  return normalizePositiveLimit(value, DEFAULT_MAX_RUN_WALL_TIME_MS);
}

/** 非正或非法累计 token 不允许关闭安全默认值。 */
export function normalizeMaxTotalTokens(value: number | undefined): number {
  return normalizePositiveLimit(value, DEFAULT_MAX_TOTAL_TOKENS);
}

/** 0 明确表示不限制高风险 Tool；负数和非法值回退到安全默认值。 */
export function normalizeMaxHighRiskToolCalls(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_MAX_HIGH_RISK_TOOL_CALLS;
  }
  if (value === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(1, Math.floor(value));
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
  readonly maxCostUsd?: number;
  readonly modelLoopBudgetPolicy?: ModelLoopBudgetPolicy;
  totalTokens = 0;
  highRiskToolCalls = 0;
  totalCostUsd = 0;
  modelCalls = 0;
  fileReadCalls = 0;
  textSearchCalls = 0;

  constructor(options: ReActRunBudgetTrackerOptions) {
    this.maxTotalTokens = normalizeMaxTotalTokens(options.maxTotalTokens);
    this.maxHighRiskToolCalls = normalizeMaxHighRiskToolCalls(options.maxHighRiskToolCalls);
    this.maxCostUsd = normalizePositiveCostLimit(options.maxCostUsd);
    this.modelLoopBudgetPolicy = options.modelLoopBudgetPolicy === MODEL_LOOP_COST_CONTAINMENT_POLICY_ID
      ? options.modelLoopBudgetPolicy
      : undefined;
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
    this.totalCostUsd += normalizeNonNegativeDecimal(usage.costUsd);
    if (this.maxCostUsd !== undefined && this.totalCostUsd > this.maxCostUsd) {
      return {
        budget: "cost_usd",
        limit: this.maxCostUsd,
        observed: this.totalCostUsd,
      };
    }
    return undefined;
  }

  /** 在额外模型调用前失败关闭；只读检查，不预扣实际 usage。 */
  checkModelCallPreflight(input: ReActModelCallPreflight): ReActRunBudgetExhausted | undefined {
    const policyEnabled = this.modelLoopBudgetPolicy === MODEL_LOOP_COST_CONTAINMENT_POLICY_ID;
    const minimumOutputTokens = policyEnabled
      ? Math.max(
        normalizeNonNegativeNumber(input.minimumOutputTokens),
        MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve,
      )
      : normalizeNonNegativeNumber(input.minimumOutputTokens);
    const projectedTokens = this.totalTokens
      + normalizeNonNegativeNumber(input.minimumInputTokens)
      + minimumOutputTokens;
    if (projectedTokens > this.maxTotalTokens) {
      return {
        budget: "total_tokens",
        limit: this.maxTotalTokens,
        observed: projectedTokens,
        ...(policyEnabled ? {
          policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
          stage: "before_model_call" as const,
          reasonCode: "insufficient_remaining_tokens" as const,
        } : {}),
      };
    }
    if (this.maxCostUsd !== undefined) {
      const projectedCostUsd = this.totalCostUsd + normalizeNonNegativeDecimal(input.minimumCostUsd);
      if (projectedCostUsd > this.maxCostUsd) {
        return {
          budget: "cost_usd",
          limit: this.maxCostUsd,
          observed: projectedCostUsd,
          ...(policyEnabled ? {
            policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
            stage: "before_model_call" as const,
            reasonCode: "insufficient_remaining_cost" as const,
          } : {}),
        };
      }
    }
    return undefined;
  }

  /**
   * 受控成本策略在 Provider dispatch 前原子预留一次模型调用。
   * 未启用策略时保持普通 profile 的既有 post-usage 预算语义。
   */
  reserveModelCall(input: ReActModelCallPreflight): ReActRunBudgetExhausted | undefined {
    if (this.modelLoopBudgetPolicy !== MODEL_LOOP_COST_CONTAINMENT_POLICY_ID) {
      return undefined;
    }
    const observed = this.modelCalls + 1;
    if (observed > MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxModelCalls) {
      return this.costContainmentExhausted(
        "model_calls",
        MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxModelCalls,
        observed,
        "before_model_call",
        "model_call_limit",
      );
    }
    const preflight = this.checkModelCallPreflight(input);
    if (preflight) {
      return {
        ...preflight,
        policyId: this.modelLoopBudgetPolicy,
        stage: "before_model_call",
        reasonCode: preflight.budget === "cost_usd"
          ? "insufficient_remaining_cost"
          : "insufficient_remaining_tokens",
      };
    }
    this.modelCalls = observed;
    return undefined;
  }

  /** 仅对真实执行前的 file_read/text_search 尝试计数，其他 Tool 不受影响。 */
  reserveToolCall(toolName: string): ReActRunBudgetExhausted | undefined {
    if (this.modelLoopBudgetPolicy !== MODEL_LOOP_COST_CONTAINMENT_POLICY_ID) {
      return undefined;
    }
    if (toolName === "file_read") {
      const observed = this.fileReadCalls + 1;
      if (observed > MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxFileReadCalls) {
        return this.costContainmentExhausted(
          "file_read_calls",
          MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxFileReadCalls,
          observed,
          "before_tool_call",
          "file_read_call_limit",
        );
      }
      this.fileReadCalls = observed;
    } else if (toolName === "text_search") {
      const observed = this.textSearchCalls + 1;
      if (observed > MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxTextSearchCalls) {
        return this.costContainmentExhausted(
          "text_search_calls",
          MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxTextSearchCalls,
          observed,
          "before_tool_call",
          "text_search_call_limit",
        );
      }
      this.textSearchCalls = observed;
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

  private costContainmentExhausted(
    budget: ReActRunBudgetKind,
    limit: number,
    observed: number,
    stage: ReActRunBudgetStage,
    reasonCode: ReActRunBudgetReasonCode,
  ): ReActRunBudgetExhausted {
    return {
      budget,
      limit,
      observed,
      policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      stage,
      reasonCode,
    };
  }
}

function normalizeNonNegativeDecimal(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}
