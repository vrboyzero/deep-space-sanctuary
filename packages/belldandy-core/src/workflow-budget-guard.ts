/**
 * WorkflowBudgetGuard — 动态工作流 Token / 调用次数 / 重试 / 耗时预算熔断器
 *
 * 在每次 ctx.agent() 调用前 check()，超限时抛出 WorkflowBudgetExceededError。
 * 预算侧 maxConcurrent 是硬上限，不可被脚本覆盖（由 WorkflowRuntime 在创建
 * orchestrator 时读取，本类只负责记录和校验）。
 *
 * 默认值从环境变量读取：
 * - BELLDANDY_WORKFLOW_MAX_AGENT_CALLS (默认 50)
 * - BELLDANDY_WORKFLOW_MAX_TOKENS       (默认无上限)
 * - BELLDANDY_WORKFLOW_MAX_RETRIES      (默认 2)
 * - BELLDANDY_WORKFLOW_TIMEOUT_MS       (默认 600000，10 分钟)
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type WorkflowBudget = {
  /** 总 Token 上限（基于 AgentUsage 估算累加） */
  maxTokens?: number;
  /** 最大 agent() 调用次数 */
  maxAgentCalls?: number;
  /** 单节点最大重试次数 */
  maxRetries?: number;
  /** 单次 workflow 总耗时上限（毫秒） */
  maxWallClockMs?: number;
  /** 预算侧并发硬上限（不可被脚本覆盖） */
  maxConcurrent?: number;
  /** 超限行为：abort 抛错中止；warn 只记录不中止 */
  onExceeded?: "abort" | "warn";
};

export type WorkflowBudgetUsage = {
  tokens: number;
  calls: number;
  retries: number;
  durationMs: number;
  exceeded: boolean;
  exceededReason?: string;
};

export class WorkflowBudgetExceededError extends Error {
  readonly reason: string;
  readonly usage: WorkflowBudgetUsage;

  constructor(reason: string, usage: WorkflowBudgetUsage) {
    super(`Workflow budget exceeded: ${reason}`);
    this.name = "WorkflowBudgetExceededError";
    this.reason = reason;
    this.usage = usage;
  }
}

// ─── 默认值 ───────────────────────────────────────────────────────────────

export const DEFAULT_WORKFLOW_MAX_AGENT_CALLS = 50;
export const DEFAULT_WORKFLOW_MAX_RETRIES = 2;
export const DEFAULT_WORKFLOW_TIMEOUT_MS = 600_000;
export const DEFAULT_WORKFLOW_MAX_CONCURRENT = 6;

export function resolveWorkflowBudgetFromEnv(readEnv: (name: string) => string | undefined): WorkflowBudget {
  const parseIntWithDefault = (name: string, defaultValue: number): number => {
    const raw = readEnv(name);
    if (!raw) return defaultValue;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  };
  return {
    maxAgentCalls: parseIntWithDefault("BELLDANDY_WORKFLOW_MAX_AGENT_CALLS", DEFAULT_WORKFLOW_MAX_AGENT_CALLS),
    maxRetries: parseIntWithDefault("BELLDANDY_WORKFLOW_MAX_RETRIES", DEFAULT_WORKFLOW_MAX_RETRIES),
    maxWallClockMs: parseIntWithDefault("BELLDANDY_WORKFLOW_TIMEOUT_MS", DEFAULT_WORKFLOW_TIMEOUT_MS),
    maxConcurrent: parseIntWithDefault("BELLDANDY_WORKFLOW_MAX_CONCURRENT", DEFAULT_WORKFLOW_MAX_CONCURRENT),
    onExceeded: "abort",
  };
}

// ─── WorkflowBudgetGuard ──────────────────────────────────────────────────

export class WorkflowBudgetGuard {
  private tokens = 0;
  private calls = 0;
  private retries = 0;
  private readonly startedAt: number;
  private exceeded = false;
  private exceededReason: string | undefined;
  private readonly onExceededMode: "abort" | "warn";
  private readonly maxTokens?: number;
  private readonly maxAgentCalls?: number;
  private readonly maxRetries?: number;
  private readonly maxWallClockMs?: number;

  constructor(budget: WorkflowBudget = {}) {
    this.maxTokens = budget.maxTokens;
    this.maxAgentCalls = budget.maxAgentCalls;
    this.maxRetries = budget.maxRetries;
    this.maxWallClockMs = budget.maxWallClockMs;
    this.onExceededMode = budget.onExceeded ?? "abort";
    this.startedAt = Date.now();
  }

  /**
   * 在发起 agent() 调用前检查预算。超限时根据 onExceeded 模式抛错或仅记录。
   */
  check(): void {
    const reason = this.findExceededReason();
    if (!reason) return;
    this.exceeded = true;
    this.exceededReason = reason;
    if (this.onExceededMode === "abort") {
      throw new WorkflowBudgetExceededError(reason, this.getUsage());
    }
    // warn 模式：只记录，不抛错；调用方应通过 isExceeded() 自行决定是否跳过
  }

  /**
   * 消费 token 和调用次数。在 agent() 调用完成后调用。
   */
  consume(tokens: number, calls: number = 1): void {
    if (tokens > 0) this.tokens += tokens;
    if (calls > 0) this.calls += calls;
  }

  /**
   * 消费一次重试计数。超限时根据 onExceeded 模式抛错或仅记录。
   */
  consumeRetry(): void {
    this.retries++;
    const limit = this.maxRetries;
    if (limit !== undefined && this.retries > limit) {
      const reason = `max retries exceeded (${this.retries}/${limit})`;
      this.exceeded = true;
      this.exceededReason = reason;
      if (this.onExceededMode === "abort") {
        throw new WorkflowBudgetExceededError(reason, this.getUsage());
      }
    }
  }

  /**
   * 当前是否已超限（abort 模式下抛错后仍可查询）。
   */
  isExceeded(): boolean {
    if (this.exceeded) return true;
    const reason = this.findExceededReason();
    if (reason) {
      this.exceeded = true;
      this.exceededReason = reason;
    }
    return this.exceeded;
  }

  getExceededReason(): string | undefined {
    return this.exceededReason;
  }

  getUsage(): WorkflowBudgetUsage {
    return {
      tokens: this.tokens,
      calls: this.calls,
      retries: this.retries,
      durationMs: Date.now() - this.startedAt,
      exceeded: this.exceeded,
      exceededReason: this.exceededReason,
    };
  }

  /**
   * 重置预算（用于 resume 场景重新计数）。
   */
  reset(): void {
    this.tokens = 0;
    this.calls = 0;
    this.retries = 0;
    this.exceeded = false;
    this.exceededReason = undefined;
  }

  private findExceededReason(): string | undefined {
    if (this.maxTokens !== undefined && this.tokens > this.maxTokens) {
      return `token budget exceeded (${this.tokens}/${this.maxTokens})`;
    }
    if (this.maxAgentCalls !== undefined && this.calls >= this.maxAgentCalls) {
      return `agent call budget exceeded (${this.calls}/${this.maxAgentCalls})`;
    }
    if (this.maxWallClockMs !== undefined) {
      const elapsed = Date.now() - this.startedAt;
      if (elapsed > this.maxWallClockMs) {
        return `wall clock budget exceeded (${elapsed}ms/${this.maxWallClockMs}ms)`;
      }
    }
    return undefined;
  }
}
