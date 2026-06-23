/**
 * Budget Protect — 预算保护策略（Phase 3）
 *
 * 设计依据：SS借鉴RH项目优化项实施计划.md §9 Phase 3 / §4.2 顺序原则
 *
 * 目标：
 * - 预算吃紧时不再默认优先牺牲历史连续性
 * - 关键 memory/tool governance section 有明确保护策略
 * - trim 优先级：先压历史内容 → 保留最近 N 轮 → 从最老开始删 → 保护 system
 *
 * Phase 0 证据支撑：
 * - history 是预算主因（tool-heavy 94-98%），但直接删历史会破坏连续性
 * - tool schema 不被牺牲（sacrifice.keptToolSchemaCount 始终完整）
 * - memory_prelude 仅在短会话 dominant（55.8%），tool-heavy 非主因 → context-injection 不进入压缩路径
 */

/** 预算保护模式 */
export type BudgetProtectMode =
  /** 旧行为：优先删历史消息（向后兼容） */
  | "history_first"
  /** 新行为：保护 memory/capability，先压缩历史内容再删除，保留最近 N 轮 */
  | "protect_memory_capability";

/** Budget protect 配置 */
export type BudgetProtectOptions = {
  /** 保护模式，默认 protect_memory_capability */
  mode?: BudgetProtectMode;
  /** 保留最近 N 轮历史不删（每轮 = user+assistant 对），默认 3 */
  keepRecentRounds?: number;
  /** 在删除历史前，是否先尝试压缩历史消息内容，默认 true */
  compressBeforeDelete?: boolean;
  /** 历史消息压缩阈值（chars），超过此长度才尝试压缩，默认 500 */
  compressThresholdChars?: number;
};

/** 默认配置 */
export const DEFAULT_BUDGET_PROTECT_OPTIONS: Required<BudgetProtectOptions> = {
  mode: "protect_memory_capability",
  keepRecentRounds: 3,
  compressBeforeDelete: true,
  compressThresholdChars: 500,
};

/** Budget protect 执行诊断 */
export type BudgetProtectDiagnostics = {
  /** 使用的保护模式 */
  mode: BudgetProtectMode;
  /** 尝试压缩历史消息的数量 */
  compressedHistoryCount: number;
  /** 压缩历史消息节省的 token 估算 */
  compressedHistorySavedTokens: number;
  /** 删除的历史消息数量 */
  deletedHistoryCount: number;
  /** 删除历史消息的 token 估算 */
  deletedHistoryTokens: number;
  /** 受保护的最近轮数 */
  protectedRounds: number;
  /** 是否触发了保护策略 */
  protectionActivated: boolean;
};

/** 创建空的诊断记录 */
export function createEmptyBudgetProtectDiagnostics(
  mode: BudgetProtectMode,
): BudgetProtectDiagnostics {
  return {
    mode,
    compressedHistoryCount: 0,
    compressedHistorySavedTokens: 0,
    deletedHistoryCount: 0,
    deletedHistoryTokens: 0,
    protectedRounds: 0,
    protectionActivated: false,
  };
}

/**
 * 计算受保护的消息索引范围。
 *
 * 保留最近 N 轮（每轮 = user+assistant 对，或 user+assistant+tool 组合）。
 * 返回一个 Set，包含不应被删除的消息索引。
 *
 * @param messages 消息数组
 * @param keepRecentRounds 保留轮数
 * @returns 受保护的索引集合
 */
export function computeProtectedIndices(
  messages: Array<{ role: string }>,
  keepRecentRounds: number,
): Set<number> {
  const protectedIndices = new Set<number>();
  if (keepRecentRounds <= 0 || messages.length === 0) return protectedIndices;

  // 从末尾向前扫描，找到最近 N 个 user 消息的位置
  let userCount = 0;
  let protectFromIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role;
    // 最后一条 user 及其之后的所有消息都保护
    if (role === "user") {
      userCount++;
      if (userCount >= keepRecentRounds) {
        protectFromIndex = i;
        break;
      }
    }
  }

  // 如果不足 N 轮，保护所有非 system 消息
  if (userCount < keepRecentRounds) {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "system") {
        protectedIndices.add(i);
      }
    }
    return protectedIndices;
  }

  // 保护从 protectFromIndex 开始的所有消息
  for (let i = protectFromIndex; i < messages.length; i++) {
    protectedIndices.add(i);
  }

  return protectedIndices;
}

/**
 * 判断消息是否可以被压缩（用于 compressBeforeDelete 阶段）。
 *
 * 只压缩 user/assistant 消息的文本内容，不压缩 tool 消息（已由 Phase 1/2 处理）。
 */
export function isCompressibleHistoryMessage(
  message: { role: string; content?: unknown },
  thresholdChars: number,
): boolean {
  if (message.role !== "user" && message.role !== "assistant") return false;
  const content = message.content;
  if (typeof content !== "string") return false;
  return content.length >= thresholdChars;
}

/**
 * 判断消息是否可以被删除（用于删除阶段）。
 *
 * 不删除 system 消息，不删除受保护的消息。
 */
export function isDeletableHistoryMessage(
  message: { role: string },
  index: number,
  protectedIndices: Set<number>,
): boolean {
  if (message.role === "system") return false;
  if (protectedIndices.has(index)) return false;
  return true;
}

/** 解析 budget protect 配置，填充默认值 */
export function resolveBudgetProtectOptions(
  opts?: BudgetProtectOptions,
): Required<BudgetProtectOptions> {
  if (!opts) return { ...DEFAULT_BUDGET_PROTECT_OPTIONS };
  return {
    mode: opts.mode ?? DEFAULT_BUDGET_PROTECT_OPTIONS.mode,
    keepRecentRounds: opts.keepRecentRounds ?? DEFAULT_BUDGET_PROTECT_OPTIONS.keepRecentRounds,
    compressBeforeDelete: opts.compressBeforeDelete ?? DEFAULT_BUDGET_PROTECT_OPTIONS.compressBeforeDelete,
    compressThresholdChars: opts.compressThresholdChars ?? DEFAULT_BUDGET_PROTECT_OPTIONS.compressThresholdChars,
  };
}
