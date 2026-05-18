import { resolvePinnedConversationTailStart } from "./pinning.js";
import { estimateTokens } from "./tokenizer.js";

/**
 * 对话压缩（Compaction）模块 — 三层渐进式压缩
 *
 * Tier 0: System Prompt（固定，不压缩）
 * Tier 1: Archival Summary（超浓缩，跨会话级归档摘要）
 * Tier 2: Rolling Summary（滚动摘要，增量更新）
 * Tier 3: Working Memory（最近 N 条完整消息）
 *
 * 当对话历史超过 token 阈值时，溢出的消息增量合入 Rolling Summary；
 * 当 Rolling Summary 过大时，进一步压缩为 Archival Summary。
 */

// ─── Types ───────────────────────────────────────────────────────────────

export type CompactionOptions = {
  /** 触发压缩的 token 阈值（默认 12000） */
  tokenThreshold?: number;
  /** compaction prompt 进入预算告警的 token 阈值 */
  warningThreshold?: number;
  /** compaction prompt 进入预算阻断并直接 fallback 的 token 阈值 */
  blockingThreshold?: number;
  /** 压缩后保留的最近消息条数（默认 10） */
  keepRecentCount?: number;
  /** 安全余量系数（默认 1.2，即估算值 * 1.2） */
  safetyMargin?: number;
  /** 上下文窗口使用比例触发点（默认 0.75，用于 ReAct 循环内压缩） */
  triggerFraction?: number;
  /** Rolling Summary 超过此 token 数时触发归档压缩（默认 2000） */
  archivalThreshold?: number;
  /** Rolling Summary 合并轮次超过此阈值时触发归档压缩（默认 6） */
  archivalMergeThreshold?: number;
  /** 连续 compaction 模型失败达到此阈值后，后续若干轮自动 compaction 熔断 */
  maxConsecutiveCompactionFailures?: number;
  /** prompt-too-long 时最多自救重试次数 */
  maxPromptTooLongRetries?: number;
  /** 是否启用压缩（默认 true） */
  enabled?: boolean;
};

/**
 * 三层压缩持久化状态
 */
export type CompactionState = {
  /** Tier 2: 滚动摘要 */
  rollingSummary: string;
  /** Tier 1: 归档摘要 */
  archivalSummary: string;
  /** 已被压缩的消息总数 */
  compactedMessageCount: number;
  /** 最近一次稳定压缩边界（用于真增量压缩） */
  lastCompactedMessageCount: number;
  /** 最近一次稳定压缩边界的指纹，用于检测 rewind / resume / edit */
  lastCompactedMessageFingerprint: string;
  /** Rolling Summary 已累计的增量合并轮次 */
  rollingSummaryMergeCount: number;
  /** 上次压缩时间戳 */
  lastCompactedAt: number;
};

export type CompactionResult = {
  /** 压缩后的消息列表 */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** 是否执行了压缩 */
  compacted: boolean;
  /** 压缩前估算 token 数 */
  originalTokens: number;
  /** 压缩后估算 token 数 */
  compactedTokens: number;
  /** 更新后的压缩状态 */
  state: CompactionState;
  /** 本次压缩的层级（未压缩时为 undefined） */
  tier?: "rolling" | "archival";
  /** 本轮实际增量处理的消息数 */
  deltaMessageCount: number;
  /** 是否走了 fallback 摘要路径 */
  fallbackUsed: boolean;
  /** 是否因边界失效触发了安全重建 */
  rebuildTriggered: boolean;
  /** prompt-too-long 自救重试次数 */
  promptTooLongRetries: number;
  /** 是否触发了预算告警 */
  warningTriggered: boolean;
  /** 是否触发了预算阻断并回退 fallback */
  blockingTriggered: boolean;
  /** 模型摘要失败原因（仅模型路径失败时存在） */
  failureReason?: string;
  /** 摘要链路观测（命中回执 / cache-aligned / fallback 阶段） */
  summarizerObservability?: {
    mode?: "rolling" | "archival";
    cacheAlignedRequested?: boolean;
    cacheSupport?: "supported" | "unsupported" | "unknown";
    cacheHitTokens?: number;
    cacheMissTokens?: number;
    cacheSavingsUsd?: number;
    usedWireApi?: "chat_completions" | "responses";
    compareAvailable?: boolean;
    comparison?: {
      mode?: "cache_aligned_vs_plain";
      plainRequestMessageCount?: number;
      cacheAlignedRequestMessageCount?: number;
      plainPromptCharsEstimate?: number;
      cacheAlignedReplayCharsEstimate?: number;
      cacheAlignedInstructionChars?: number;
      replayOverheadChars?: number;
    };
    strategy?: {
      kind?: "cache_aligned" | "plain";
      providerCacheMode?: "supported" | "unsupported" | "unknown";
      selectionReason?: string;
      degradePath?: string;
      providerModelNotes?: string;
      fallbackPolicy?: string;
      fallbackTriggered?: boolean;
      fallbackSummary?: string;
    };
    warmupCoordination?: {
      eligible?: boolean;
      status?: "unsupported" | "cold" | "warming" | "warm_candidate" | "drifted";
      recommendation?: "proceed" | "proceed_with_caution" | "delay_if_possible";
      reason?: string;
      previousAgeMs?: number;
    };
    cacheFamilyAffinity?: {
      status?: "unknown" | "aligned" | "mismatch";
      familyKey?: string;
      previousFamilyKey?: string;
      reason?: string;
    };
    fallbackStage?: "request" | "response_parse" | "compaction_budget" | "prompt_too_long" | "model_failure";
    failureReason?: string;
  };
};

/**
 * 摘要生成函数签名
 */
export type SummarizerContext = {
  mode: "rolling" | "archival";
  prompt: string;
  existingSummary?: string;
  newMessages?: Array<{ role: string; content: string }>;
  rollingSummary?: string;
  existingArchivalSummary?: string;
};

export type SummarizerFn = (
  prompt: string,
  context?: SummarizerContext,
) => Promise<
  | string
  | {
    summary: string;
    observability?: CompactionResult["summarizerObservability"];
  }
>;

// ─── Token 估算 ─────────────────────────────────────────────────────────

const SAFETY_MARGIN = 1.2;
const ARCHIVAL_MERGE_THRESHOLD = 6;
const MAX_PROMPT_TOO_LONG_RETRIES = 2;

export { estimateTokens } from "./tokenizer.js";

/**
 * 估算消息列表的总 token 数（含安全余量）
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>,
  margin: number = SAFETY_MARGIN,
): number {
  const raw = messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
  return Math.ceil(raw * margin);
}

// ─── 空状态 ──────────────────────────────────────────────────────────────

export function createEmptyCompactionState(): CompactionState {
  return {
    rollingSummary: "",
    archivalSummary: "",
    compactedMessageCount: 0,
    lastCompactedMessageCount: 0,
    lastCompactedMessageFingerprint: "",
    rollingSummaryMergeCount: 0,
    lastCompactedAt: 0,
  };
}

export function normalizeCompactionState(input?: Partial<CompactionState> | null): CompactionState {
  const empty = createEmptyCompactionState();
  const compactedMessageCount = typeof input?.compactedMessageCount === "number" && Number.isFinite(input.compactedMessageCount)
    ? Math.max(0, Math.floor(input.compactedMessageCount))
    : 0;
  const lastCompactedMessageCount = typeof input?.lastCompactedMessageCount === "number" && Number.isFinite(input.lastCompactedMessageCount)
    ? Math.max(0, Math.floor(input.lastCompactedMessageCount))
    : compactedMessageCount;

  return {
    rollingSummary: typeof input?.rollingSummary === "string" ? input.rollingSummary : empty.rollingSummary,
    archivalSummary: typeof input?.archivalSummary === "string" ? input.archivalSummary : empty.archivalSummary,
    compactedMessageCount,
    lastCompactedMessageCount,
    lastCompactedMessageFingerprint:
      typeof input?.lastCompactedMessageFingerprint === "string"
        ? input.lastCompactedMessageFingerprint
        : empty.lastCompactedMessageFingerprint,
    rollingSummaryMergeCount:
      typeof input?.rollingSummaryMergeCount === "number" && Number.isFinite(input.rollingSummaryMergeCount)
        ? Math.max(0, Math.floor(input.rollingSummaryMergeCount))
        : empty.rollingSummaryMergeCount,
    lastCompactedAt:
      typeof input?.lastCompactedAt === "number" && Number.isFinite(input.lastCompactedAt)
        ? Math.max(0, input.lastCompactedAt)
        : empty.lastCompactedAt,
  };
}

// ─── 工具结果压缩 ────────────────────────────────────────────────────────

/**
 * 压缩工具调用相关的消息内容，保留关键信息，丢弃冗长输出
 */
function compressToolContent(content: string): string {
  // 工具结果通常很长（网页、文件内容、命令输出），截取关键部分
  if (content.length <= 500) return content;

  // 保留前 400 字符 + 末尾 100 字符，中间用省略标记
  const head = content.slice(0, 400);
  const tail = content.slice(-100);
  return `${head}\n... [${content.length - 500} chars omitted] ...\n${tail}`;
}

/**
 * 对即将合入摘要的消息做预压缩（特别是工具结果）
 */
function precompressMessages(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role,
    content: m.content.length > 500 ? compressToolContent(m.content) : m.content,
  }));
}

function mergeSummarizerObservability(
  base: CompactionResult["summarizerObservability"] | undefined,
  override: CompactionResult["summarizerObservability"] | undefined,
): CompactionResult["summarizerObservability"] | undefined {
  if (!base && !override) return undefined;
  if (!base) return override ? { ...override } : undefined;
  if (!override) return { ...base };
  return {
    ...base,
    ...override,
    comparison: {
      ...(base.comparison ?? {}),
      ...(override.comparison ?? {}),
    },
    strategy: {
      ...(base.strategy ?? {}),
      ...(override.strategy ?? {}),
    },
  };
}

function coerceSummaryText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => coerceSummaryText(item)).filter(Boolean).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directKeys = ["summary", "text", "output_text", "content", "reasoning_content", "value"];
  for (const key of directKeys) {
    const extracted = coerceSummaryText(record[key]);
    if (extracted) {
      return extracted;
    }
  }

  const nestedCollections = ["parts", "items", "segments"];
  for (const key of nestedCollections) {
    const extracted = coerceSummaryText(record[key]);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

// ─── 摘要 Prompt 构建 ───────────────────────────────────────────────────

function buildRollingSummaryPrompt(
  existingSummary: string,
  newMessages: Array<{ role: string; content: string }>,
): string {
  const msgText = newMessages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  if (existingSummary) {
    return [
      "You are maintaining a task continuity summary for an engineering assistant conversation.",
      "Update the existing summary with the new conversation content.",
      "",
      "## Existing Summary",
      existingSummary,
      "",
      "## New Conversation Content",
      msgText,
      "",
      "## Instructions",
      "Rewrite the summary so it stays useful for continuing the same engineering task.",
      "Prefer concrete outcomes over topic descriptions.",
      "Do not write vague lines such as 'the user asked about X' unless you also record the conclusion or current state.",
      "When relevant, mention concrete file paths, functions, tools, outputs, errors, and fixes.",
      "Preserve the latest completed step and the most likely next step.",
      "Use concise markdown with these sections when they have useful content:",
      "- Current Goal",
      "- Key Decisions",
      "- Key Files / Functions / Changes",
      "- Errors and Fixes",
      "- Pending Work",
      "- Current Work",
      "- Next Step",
      "- User Constraints / Preferences",
      "",
      "Keep the summary concise (under 900 tokens).",
      "Output ONLY the updated markdown summary, no preamble.",
    ].join("\n");
  }

  return [
    "You are creating a task continuity summary for an engineering assistant conversation.",
    "",
    "## Conversation",
    msgText,
    "",
    "## Instructions",
    "Create a concise summary that will help continue the same task later.",
    "Prefer concrete outcomes over topic descriptions.",
    "Do not write vague lines such as 'the user asked about X' unless you also record the conclusion or current state.",
    "When relevant, mention concrete file paths, functions, tools, outputs, errors, and fixes.",
    "Use concise markdown with these sections when they have useful content:",
    "- Current Goal",
    "- Key Decisions",
    "- Key Files / Functions / Changes",
    "- Errors and Fixes",
    "- Pending Work",
    "- Current Work",
    "- Next Step",
    "- User Constraints / Preferences",
    "",
    "Keep the summary concise (under 900 tokens).",
    "Output ONLY the markdown summary, no preamble.",
  ].join("\n");
}

function buildArchivalPrompt(existingArchivalSummary: string, rollingSummary: string): string {
  const parts = [
    "You are compressing conversation memory into an ultra-concise archival summary for future task continuation.",
  ];

  if (existingArchivalSummary) {
    parts.push(
      "",
      "## Existing Archival Summary",
      existingArchivalSummary,
    );
  }

  parts.push(
    "",
    "## Rolling Summary To Archive",
    rollingSummary,
    "",
    "## Instructions",
    "Create an ultra-concise archival summary (under 400 tokens) that keeps only durable information.",
    "Prefer concrete outcomes over topic descriptions.",
    "Drop routine tool logs, intermediate reasoning, repeated discussion, and temporary noise.",
    "Use concise markdown with these sections when they have useful content:",
    "- Stable Goal",
    "- Final Decisions",
    "- Durable Files / Modules",
    "- Resolved Failures",
    "- Outstanding Follow-up",
    "- Last Known Working State",
    "",
    "Merge with any existing archival memory.",
    "Output ONLY the archival markdown summary, no preamble.",
  );

  return parts.join("\n");
}

// ─── 降级摘要 ────────────────────────────────────────────────────────────

/**
 * 降级摘要：不调用模型，直接截取关键信息
 */
function buildFallbackSummary(
  messages: Array<{ role: string; content: string }>,
): string {
  const MAX_SUMMARY_CHARS = 2000;
  const lines: string[] = [];
  let totalChars = 0;

  for (const msg of messages) {
    const prefix = msg.role === "user" ? "User" : "Assistant";
    const snippet = msg.content.length > 200
      ? msg.content.slice(0, 200) + "..."
      : msg.content;
    const line = `- ${prefix}: ${snippet}`;

    if (totalChars + line.length > MAX_SUMMARY_CHARS) {
      lines.push(`... (${messages.length - lines.length} more messages omitted)`);
      break;
    }

    lines.push(line);
    totalChars += line.length;
  }

  return lines.join("\n");
}

function buildFallbackArchival(existingArchivalSummary: string, rollingSummary: string): string {
  const merged = [existingArchivalSummary, rollingSummary].filter(Boolean).join("\n\n---\n\n");
  if (merged.length <= 1000) return merged;
  return merged.slice(0, 1000) + "\n... [archival truncated]";
}

function mergeSummaryWithFallback(
  existingSummary: string,
  messages: Array<{ role: string; content: string }>,
): string {
  const fallback = buildFallbackSummary(messages);
  if (!fallback) return existingSummary;
  return existingSummary
    ? `${existingSummary}\n\n---\n\n${fallback}`
    : fallback;
}

function isPromptTooLongError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) return false;
  const normalized = message.toLowerCase();
  return [
    "prompt too long",
    "context length",
    "maximum context length",
    "context window",
    "too many tokens",
    "token limit",
    "input is too long",
    "input too long",
    "context_length_exceeded",
    "prompt is too long",
    "request too large",
    "413",
  ].some((needle) => normalized.includes(needle));
}

type SummarizationAttemptResult = {
  summary: string;
  fallbackUsed: boolean;
  warningTriggered: boolean;
  blockingTriggered: boolean;
  promptTooLongRetries: number;
  failureReason?: string;
  summarizerObservability?: CompactionResult["summarizerObservability"];
};

async function summarizeRollingWithBudget(
  existingSummary: string,
  newMessages: Array<{ role: string; content: string }>,
  options: {
    summarizer?: SummarizerFn;
    warningThreshold?: number;
    blockingThreshold?: number;
    maxPromptTooLongRetries: number;
  },
): Promise<SummarizationAttemptResult> {
  let warningTriggered = false;
  let blockingTriggered = false;
  let promptTooLongRetries = 0;
  let failureReason: string | undefined;

  if (!options.summarizer) {
    return {
      summary: mergeSummaryWithFallback(existingSummary, newMessages),
      fallbackUsed: true,
      warningTriggered,
      blockingTriggered,
      promptTooLongRetries,
      summarizerObservability: {
        mode: "rolling",
        strategy: {
          fallbackTriggered: true,
          fallbackSummary: "summarizer_unavailable",
        },
        fallbackStage: "model_failure",
        failureReason: "summarizer_unavailable",
      },
    };
  }

  let attemptSummary = existingSummary;
  let remainingMessages = [...newMessages];
  while (true) {
    const prompt = buildRollingSummaryPrompt(attemptSummary, remainingMessages);
    const promptTokens = estimateTokens(prompt);
    if (options.warningThreshold && promptTokens >= options.warningThreshold) {
      warningTriggered = true;
    }
    if (options.blockingThreshold && promptTokens >= options.blockingThreshold) {
      blockingTriggered = true;
      return {
        summary: mergeSummaryWithFallback(attemptSummary, remainingMessages),
        fallbackUsed: true,
        warningTriggered,
        blockingTriggered,
        promptTooLongRetries,
        summarizerObservability: {
          mode: "rolling",
          strategy: {
            fallbackTriggered: true,
            fallbackSummary: "compaction_budget_guard",
          },
          fallbackStage: "compaction_budget",
        },
      };
    }

    try {
      const response = await options.summarizer(prompt, {
        mode: "rolling",
        prompt,
        existingSummary: attemptSummary,
        newMessages: remainingMessages,
      });
      const summaryText = typeof response === "string"
        ? response
        : coerceSummaryText(response?.summary);
      return {
        summary: summaryText,
        fallbackUsed: false,
        warningTriggered,
        blockingTriggered,
        promptTooLongRetries,
        summarizerObservability: typeof response === "object" && response
          ? {
            mode: "rolling",
            ...(response.observability && typeof response.observability === "object"
              ? response.observability
              : {}),
          }
          : {
            mode: "rolling",
          },
      };
    } catch (error) {
      if (
        isPromptTooLongError(error)
        && promptTooLongRetries < options.maxPromptTooLongRetries
        && remainingMessages.length > 1
      ) {
        promptTooLongRetries += 1;
        const dropCount = Math.max(1, Math.floor(remainingMessages.length / 2));
        const droppedMessages = remainingMessages.slice(0, dropCount);
        remainingMessages = remainingMessages.slice(dropCount);
        attemptSummary = mergeSummaryWithFallback(attemptSummary, droppedMessages);
        continue;
      }
      failureReason = error instanceof Error ? error.message : String(error);
      const inheritedObservability =
        error && typeof error === "object" && "compactionObservability" in error
          ? ((error as { compactionObservability?: CompactionResult["summarizerObservability"] }).compactionObservability)
          : undefined;
      return {
        summary: mergeSummaryWithFallback(attemptSummary, remainingMessages),
        fallbackUsed: true,
        warningTriggered,
        blockingTriggered,
        promptTooLongRetries,
        failureReason,
        summarizerObservability: mergeSummarizerObservability(inheritedObservability, {
          mode: "rolling",
          strategy: {
            fallbackTriggered: true,
            fallbackSummary: isPromptTooLongError(error) ? "prompt_too_long_guard" : "model_failure_fallback",
          },
          fallbackStage: isPromptTooLongError(error) ? "prompt_too_long" : "model_failure",
          failureReason,
        }),
      };
    }
  }
}

async function summarizeArchivalWithBudget(
  existingArchivalSummary: string,
  rollingSummary: string,
  options: {
    summarizer?: SummarizerFn;
    warningThreshold?: number;
    blockingThreshold?: number;
    maxPromptTooLongRetries: number;
  },
): Promise<SummarizationAttemptResult> {
  let warningTriggered = false;
  let blockingTriggered = false;
  let promptTooLongRetries = 0;
  let failureReason: string | undefined;

  if (!options.summarizer) {
    return {
      summary: buildFallbackArchival(existingArchivalSummary, rollingSummary),
      fallbackUsed: true,
      warningTriggered,
      blockingTriggered,
      promptTooLongRetries,
      summarizerObservability: {
        mode: "archival",
        strategy: {
          fallbackTriggered: true,
          fallbackSummary: "summarizer_unavailable",
        },
        fallbackStage: "model_failure",
        failureReason: "summarizer_unavailable",
      },
    };
  }

  let attemptArchivalSummary = existingArchivalSummary;
  let attemptRollingSummary = rollingSummary;
  while (true) {
    const prompt = buildArchivalPrompt(attemptArchivalSummary, attemptRollingSummary);
    const promptTokens = estimateTokens(prompt);
    if (options.warningThreshold && promptTokens >= options.warningThreshold) {
      warningTriggered = true;
    }
    if (options.blockingThreshold && promptTokens >= options.blockingThreshold) {
      blockingTriggered = true;
      return {
        summary: buildFallbackArchival(attemptArchivalSummary, attemptRollingSummary),
        fallbackUsed: true,
        warningTriggered,
        blockingTriggered,
        promptTooLongRetries,
        summarizerObservability: {
          mode: "archival",
          strategy: {
            fallbackTriggered: true,
            fallbackSummary: "compaction_budget_guard",
          },
          fallbackStage: "compaction_budget",
        },
      };
    }

    try {
      const response = await options.summarizer(prompt, {
        mode: "archival",
        prompt,
        existingArchivalSummary: attemptArchivalSummary,
        rollingSummary: attemptRollingSummary,
      });
      const summaryText = typeof response === "string"
        ? response
        : coerceSummaryText(response?.summary);
      return {
        summary: summaryText,
        fallbackUsed: false,
        warningTriggered,
        blockingTriggered,
        promptTooLongRetries,
        summarizerObservability: typeof response === "object" && response
          ? {
            mode: "archival",
            ...(response.observability && typeof response.observability === "object"
              ? response.observability
              : {}),
          }
          : {
            mode: "archival",
          },
      };
    } catch (error) {
      if (
        isPromptTooLongError(error)
        && promptTooLongRetries < options.maxPromptTooLongRetries
        && attemptRollingSummary.length > 256
      ) {
        promptTooLongRetries += 1;
        const splitIndex = Math.max(1, Math.floor(attemptRollingSummary.length / 2));
        const droppedPrefix = attemptRollingSummary.slice(0, splitIndex);
        attemptRollingSummary = attemptRollingSummary.slice(splitIndex);
        attemptArchivalSummary = buildFallbackArchival(attemptArchivalSummary, droppedPrefix);
        continue;
      }
      failureReason = error instanceof Error ? error.message : String(error);
      const inheritedObservability =
        error && typeof error === "object" && "compactionObservability" in error
          ? ((error as { compactionObservability?: CompactionResult["summarizerObservability"] }).compactionObservability)
          : undefined;
      return {
        summary: buildFallbackArchival(attemptArchivalSummary, attemptRollingSummary),
        fallbackUsed: true,
        warningTriggered,
        blockingTriggered,
        promptTooLongRetries,
        failureReason,
        summarizerObservability: mergeSummarizerObservability(inheritedObservability, {
          mode: "archival",
          strategy: {
            fallbackTriggered: true,
            fallbackSummary: isPromptTooLongError(error) ? "prompt_too_long_guard" : "model_failure_fallback",
          },
          fallbackStage: isPromptTooLongError(error) ? "prompt_too_long" : "model_failure",
          failureReason,
        }),
      };
    }
  }
}

function hashStringFNV1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createMessagesFingerprint(
  messages: Array<{ role: string; content: string }>,
): string {
  if (messages.length === 0) return "";
  let combined = "";
  for (const message of messages) {
    combined += `${message.role}\u241f${message.content}\u241e`;
  }
  return `${messages.length}:${hashStringFNV1a(combined)}`;
}

// ─── 核心压缩逻辑 ────────────────────────────────────────────────────────

/**
 * 增量压缩：将溢出的消息合入 Rolling Summary，必要时触发归档压缩。
 *
 * @param messages 当前完整消息列表
 * @param state 当前压缩状态（可为空状态）
 * @param options 压缩配置
 * @param summarizer 可选的模型摘要函数
 */
export async function compactIncremental(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  state: CompactionState,
  options?: CompactionOptions & { summarizer?: SummarizerFn; force?: boolean },
): Promise<CompactionResult> {
  const normalizedState = normalizeCompactionState(state);
  const threshold = options?.tokenThreshold ?? 12000;
  const keepRecent = options?.keepRecentCount ?? 10;
  const margin = options?.safetyMargin ?? SAFETY_MARGIN;
  const archivalThreshold = options?.archivalThreshold ?? 2000;
  const archivalMergeThreshold = options?.archivalMergeThreshold ?? ARCHIVAL_MERGE_THRESHOLD;
  const warningThreshold = options?.warningThreshold;
  const blockingThreshold = options?.blockingThreshold;
  const maxPromptTooLongRetries = options?.maxPromptTooLongRetries ?? MAX_PROMPT_TOO_LONG_RETRIES;
  const force = options?.force === true;

  const originalTokens = estimateMessagesTokens(messages, margin);

  // 不需要压缩
  if ((!force && originalTokens <= threshold) || messages.length <= keepRecent) {
    return {
      messages,
      compacted: false,
      originalTokens,
      compactedTokens: originalTokens,
      state: normalizedState,
      deltaMessageCount: 0,
      fallbackUsed: false,
      rebuildTriggered: false,
      promptTooLongRetries: 0,
      warningTriggered: false,
      blockingTriggered: false,
    };
  }

  // 分割：溢出消息 + 保留消息。A2 pinning 仅扩大连续尾部保留范围，不改长期记忆格式。
  const defaultSplitIndex = messages.length - keepRecent;
  const pinnedTailStart = resolvePinnedConversationTailStart(messages, keepRecent);
  const splitIndex = typeof pinnedTailStart === "number"
    ? Math.min(defaultSplitIndex, Math.max(0, pinnedTailStart))
    : defaultSplitIndex;
  const overflowMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);
  const overflowFingerprint = createMessagesFingerprint(overflowMessages);
  const previousBoundary = Math.min(splitIndex, Math.max(
    normalizedState.lastCompactedMessageCount,
    normalizedState.compactedMessageCount,
  ));
  const hasExistingSummaryState = Boolean(
    normalizedState.rollingSummary
    || normalizedState.archivalSummary
    || normalizedState.compactedMessageCount > 0
    || normalizedState.lastCompactedMessageCount > 0,
  );
  const previousBoundaryFingerprint = previousBoundary > 0
    ? createMessagesFingerprint(messages.slice(0, previousBoundary))
    : "";
  const boundaryInvalid =
    hasExistingSummaryState
    && (
      previousBoundary !== Math.max(normalizedState.lastCompactedMessageCount, normalizedState.compactedMessageCount)
      || (previousBoundary > 0 && !normalizedState.lastCompactedMessageFingerprint)
      || (previousBoundary > 0 && normalizedState.lastCompactedMessageFingerprint !== previousBoundaryFingerprint)
    );
  const rebuildState = boundaryInvalid ? createEmptyCompactionState() : normalizedState;
  const incrementalStart = boundaryInvalid ? 0 : previousBoundary;
  const newOverflowMessages = overflowMessages.slice(incrementalStart);

  if (newOverflowMessages.length === 0 && hasExistingSummaryState && !boundaryInvalid) {
    const compactedMessages = buildCompactedMessages(normalizedState, recentMessages);
    return {
      messages: compactedMessages,
      compacted: false,
      originalTokens,
      compactedTokens: estimateMessagesTokens(compactedMessages, margin),
      state: normalizedState,
      deltaMessageCount: 0,
      fallbackUsed: false,
      rebuildTriggered: false,
      promptTooLongRetries: 0,
      warningTriggered: false,
      blockingTriggered: false,
    };
  }

  // 预压缩工具结果等长内容
  const compressed = precompressMessages(newOverflowMessages);
  let fallbackUsed = false;
  let warningTriggered = false;
  let blockingTriggered = false;
  let promptTooLongRetries = 0;
  let failureReason: string | undefined;
  let summarizerObservability: CompactionResult["summarizerObservability"];

  // ── Tier 2: 更新 Rolling Summary ──
  const rollingSummaryResult = await summarizeRollingWithBudget(rebuildState.rollingSummary, compressed, {
    summarizer: options?.summarizer,
    warningThreshold,
    blockingThreshold,
    maxPromptTooLongRetries,
  });
  let newRollingSummary = coerceSummaryText(rollingSummaryResult.summary);
  fallbackUsed = rollingSummaryResult.fallbackUsed;
  warningTriggered = rollingSummaryResult.warningTriggered;
  blockingTriggered = rollingSummaryResult.blockingTriggered;
  promptTooLongRetries = rollingSummaryResult.promptTooLongRetries;
  failureReason = rollingSummaryResult.failureReason;
  summarizerObservability = rollingSummaryResult.summarizerObservability;

  // ── Tier 1: 检查是否需要归档压缩 ──
  let newArchivalSummary = rebuildState.archivalSummary;
  let tier: "rolling" | "archival" = "rolling";
  let rollingSummaryMergeCount = newRollingSummary
    ? Math.max(1, rebuildState.rollingSummaryMergeCount + 1)
    : 0;
  const rollingSummaryTokens = estimateTokens(newRollingSummary);

  if (newRollingSummary && (rollingSummaryTokens > archivalThreshold || rollingSummaryMergeCount >= archivalMergeThreshold)) {
    tier = "archival";
    const archivalSummaryResult = await summarizeArchivalWithBudget(rebuildState.archivalSummary, newRollingSummary, {
      summarizer: options?.summarizer,
      warningThreshold,
      blockingThreshold,
      maxPromptTooLongRetries,
    });
    newArchivalSummary = coerceSummaryText(archivalSummaryResult.summary);
    fallbackUsed = fallbackUsed || archivalSummaryResult.fallbackUsed;
    warningTriggered = warningTriggered || archivalSummaryResult.warningTriggered;
    blockingTriggered = blockingTriggered || archivalSummaryResult.blockingTriggered;
    promptTooLongRetries += archivalSummaryResult.promptTooLongRetries;
    failureReason = archivalSummaryResult.failureReason ?? failureReason;
    summarizerObservability = archivalSummaryResult.summarizerObservability ?? summarizerObservability;
    // 归档后清空 Rolling Summary
    newRollingSummary = "";
    rollingSummaryMergeCount = 0;
  }

  // 构建新状态
  const newState: CompactionState = {
    rollingSummary: newRollingSummary,
    archivalSummary: newArchivalSummary,
    compactedMessageCount: splitIndex,
    lastCompactedMessageCount: splitIndex,
    lastCompactedMessageFingerprint: overflowFingerprint,
    rollingSummaryMergeCount,
    lastCompactedAt: Date.now(),
  };

  // 构建压缩后的消息列表
  const compactedMessages = buildCompactedMessages(newState, recentMessages);
  const compactedTokens = estimateMessagesTokens(compactedMessages, margin);

  return {
    messages: compactedMessages,
    compacted: true,
    originalTokens,
    compactedTokens,
    state: newState,
    tier,
    deltaMessageCount: newOverflowMessages.length,
    fallbackUsed,
    rebuildTriggered: boundaryInvalid,
    promptTooLongRetries,
    warningTriggered,
    blockingTriggered,
    failureReason,
    ...(summarizerObservability ? { summarizerObservability } : {}),
  };
}

/**
 * 根据压缩状态 + 最近消息，构建发送给模型的消息列表
 */
export function buildCompactedMessages(
  state: CompactionState,
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const result: Array<{ role: "user" | "assistant"; content: string }> = [];

  // 拼接摘要上下文
  const summaryParts: string[] = [];
  if (state.archivalSummary) {
    summaryParts.push(`[Archival Summary]\n${state.archivalSummary}`);
  }
  if (state.rollingSummary) {
    summaryParts.push(`[Recent Context Summary]\n${state.rollingSummary}`);
  }

  if (summaryParts.length > 0) {
    const totalCompacted = state.compactedMessageCount;
    result.push({
      role: "user",
      content: `[Conversation context (${totalCompacted} earlier messages compressed)]\n\n${summaryParts.join("\n\n")}`,
    });
    result.push({
      role: "assistant",
      content: "Understood. I have the context from our previous conversation. Let me continue from where we left off.",
    });
  }

  result.push(...recentMessages);
  return result;
}

// ─── 兼容性包装 ──────────────────────────────────────────────────────────

/**
 * 兼容旧版 API：无状态压缩（内部创建临时状态）
 */
export async function compactMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: CompactionOptions & {
    summarizer?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  },
): Promise<CompactionResult> {
  // 将旧版 summarizer 适配为新版 SummarizerFn
  let newSummarizer: SummarizerFn | undefined;
  if (options?.summarizer) {
    const oldSummarizer = options.summarizer;
    newSummarizer = async (prompt: string) => {
      return oldSummarizer([{ role: "user", content: prompt }]);
    };
  }

  const { summarizer: _ignored, ...restOptions } = options ?? {};
  const result = await compactIncremental(
    messages,
    createEmptyCompactionState(),
    newSummarizer ? { ...restOptions, summarizer: newSummarizer } : restOptions,
  );
  return result;
}

/**
 * 判断消息列表是否需要压缩
 */
export function needsCompaction(
  messages: Array<{ role: string; content: string }>,
  options?: CompactionOptions,
): boolean {
  if (options?.enabled === false) return false;
  const threshold = options?.tokenThreshold ?? 12000;
  const keepRecent = options?.keepRecentCount ?? 10;
  const margin = options?.safetyMargin ?? SAFETY_MARGIN;

  if (messages.length <= keepRecent) return false;
  return estimateMessagesTokens(messages, margin) > threshold;
}

/**
 * 判断 ReAct 循环内是否需要压缩（基于上下文窗口使用比例）
 */
export function needsInLoopCompaction(
  estimatedTokens: number,
  maxContextTokens: number,
  triggerFraction: number = 0.75,
): boolean {
  if (maxContextTokens <= 0) return false;
  return estimatedTokens > maxContextTokens * triggerFraction;
}
