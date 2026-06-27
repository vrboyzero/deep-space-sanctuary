/**
 * Stable Prefix / Transient Tail 拆层（Phase 4）
 *
 * 设计依据：SS借鉴RH项目优化项实施计划.md §9 Phase 4 / Phase 0 补充取证结论
 *
 * 目标：
 * - 将 transient-safe delta（tool-recovery / team-coordination / delegation）从 system prompt 分离
 * - 改为注入到当前 user 消息前（transient tail），不破坏 system prompt 的稳定前缀
 * - 减少 prefix drift，提升 cache 命中率
 *
 * 安全边界（Phase 0 补充取证结论）：
 * - Stable prefix 保留：memory-prelude / launch-spec
 * - Transient tail 可挪入：tool-failure-recovery / tool-search-follow-up / post-action-verification /
 *   delegation-result-review / team-topology / team-handoff / team-fan-in / team-completion-gate
 * - Independent block（独立 block，不进 system prompt 也不进 transient tail）：
 *   identity-authority（模型需要知道权限边界，但不需要每轮重建 system prompt）
 */

import type { ModelMessageLayout } from "./failover-client.js";
import type { AgentPromptDelta } from "./prompt-snapshot.js";

/** Transient-safe delta 类型集合（可安全挪到 transient tail） */
const TRANSIENT_SAFE_DELTA_TYPES = new Set<string>([
  "tool-failure-recovery",
  "tool-search-follow-up",
  "tool-post-verification",
  "delegation-result-review",
  "team-topology-and-ownership",
  "team-handoff-review",
  "team-fan-in-triage",
  "team-completion-gate",
]);

/** Stable delta 类型集合（应留在 system prompt） */
const STABLE_DELTA_TYPES = new Set<string>([
  "user-prelude",
  "launch-spec",
  "role-execution-policy",
  "tool-selection-policy",
]);

/** Independent block delta 类型集合（从 system prompt 分离为独立 system 消息） */
const INDEPENDENT_BLOCK_DELTA_TYPES = new Set<string>([
  "runtime-identity-authority",
]);

/** 拆层配置 */
export type StablePrefixSplitOptions = {
  /** 是否启用 stable prefix / transient tail 拆层，默认 false（向后兼容） */
  enabled?: boolean;
};

/** 拆层结果 */
export type StablePrefixSplitResult = {
  /** 留在 system prompt 的 stable deltas */
  stableDeltas: AgentPromptDelta[];
  /** 挪到 transient tail 的 deltas */
  transientDeltas: AgentPromptDelta[];
  /** 挪到独立 block 的 deltas（不进 system prompt 也不进 transient tail） */
  independentBlockDeltas: AgentPromptDelta[];
  /** 分离的 transient delta 数量 */
  splitCount: number;
  /** 分离的 transient delta token 估算 */
  splitTokensEstimate: number;
  /** 是否实际执行了分离 */
  splitActivated: boolean;
};

/** 判断 delta 是否属于 transient-safe 类 */
export function isTransientSafeDelta(delta: AgentPromptDelta): boolean {
  return TRANSIENT_SAFE_DELTA_TYPES.has(delta.deltaType);
}

/** 判断 delta 是否属于 stable 类 */
export function isStableDelta(delta: AgentPromptDelta): boolean {
  return STABLE_DELTA_TYPES.has(delta.deltaType);
}

/** 判断 delta 是否属于 independent block 类 */
export function isIndependentBlockDelta(delta: AgentPromptDelta): boolean {
  return INDEPENDENT_BLOCK_DELTA_TYPES.has(delta.deltaType);
}

/**
 * 将 deltas 分离为 stable、transient 和 independent block 三组。
 *
 * 策略：
 * - 如果 enabled=false，所有 delta 都归入 stable（旧行为兼容）
 * - 如果 enabled=true：
 *   - transient-safe 类 delta 归入 transient（注入到 user 消息前）
 *   - independent block 类 delta 归入 independentBlock（注入为独立 system 消息）
 *   - 其余归入 stable（留在 system prompt）
 */
export function splitDeltasByStability(
  deltas: readonly AgentPromptDelta[],
  opts?: StablePrefixSplitOptions,
): StablePrefixSplitResult {
  const enabled = opts?.enabled ?? false;

  if (!enabled) {
    return {
      stableDeltas: deltas.map((d) => ({ ...d })),
      transientDeltas: [],
      independentBlockDeltas: [],
      splitCount: 0,
      splitTokensEstimate: 0,
      splitActivated: false,
    };
  }

  const stableDeltas: AgentPromptDelta[] = [];
  const transientDeltas: AgentPromptDelta[] = [];
  const independentBlockDeltas: AgentPromptDelta[] = [];

  for (const delta of deltas) {
    if (isTransientSafeDelta(delta)) {
      transientDeltas.push({ ...delta });
    } else if (isIndependentBlockDelta(delta)) {
      independentBlockDeltas.push({ ...delta });
    } else {
      stableDeltas.push({ ...delta });
    }
  }

  const splitTokensEstimate = transientDeltas.reduce(
    (sum, d) => sum + Math.ceil(d.text.length / 3.5),
    0,
  );

  return {
    stableDeltas,
    transientDeltas,
    independentBlockDeltas,
    splitCount: transientDeltas.length,
    splitTokensEstimate,
    splitActivated: transientDeltas.length > 0 || independentBlockDeltas.length > 0,
  };
}

/**
 * 构建 transient tail 文本（注入到当前 user 消息前）。
 *
 * 格式：用明确的边界标记包裹 transient 指令，让模型知道这是本轮临时指导。
 */
export function buildTransientTailText(transientDeltas: AgentPromptDelta[]): string {
  if (transientDeltas.length === 0) return "";

  const parts = transientDeltas.map((d) => d.text.trim()).filter(Boolean);
  if (parts.length === 0) return "";

  return `<transient-context hint="以下是本轮临时指导，不影响你的核心设定。">\n${parts.join("\n\n")}\n</transient-context>`;
}

/**
 * 将 transient tail 注入到 messages 中。
 *
 * 策略：在最后一条 user 消息前插入一条 system 消息作为 transient tail。
 * 不修改 system prompt（messages[0]），保持 stable prefix 不变。
 */
export function injectTransientTail(
  messages: Array<{ role: string; content: unknown }>,
  transientText: string,
): { injected: boolean; insertIndex: number } {
  if (!transientText) return { injected: false, insertIndex: -1 };

  // 找到最后一条 user 消息的位置
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    // 没有 user 消息，追加到末尾
    messages.push({ role: "system", content: transientText });
    return { injected: true, insertIndex: messages.length - 1 };
  }

  // 在最后一条 user 消息前插入 transient tail
  messages.splice(lastUserIdx, 0, { role: "system", content: transientText });
  return { injected: true, insertIndex: lastUserIdx };
}

/**
 * 构建 independent block 文本（identity-authority 等独立 block）。
 *
 * 格式：用明确的边界标记包裹，让模型知道这是稳定的身份权限信息。
 */
export function buildIndependentBlockText(independentBlockDeltas: AgentPromptDelta[]): string {
  if (independentBlockDeltas.length === 0) return "";

  const parts = independentBlockDeltas.map((d) => d.text.trim()).filter(Boolean);
  if (parts.length === 0) return "";

  return `<identity-authority hint="以下是你当前的身份与权限信息，在整个会话中保持有效。">
${parts.join("\n\n")}
</identity-authority>`;
}

/**
 * 将 independent block 注入到 messages 中。
 *
 * 策略：在 system prompt（messages[0]）之后、历史消息之前插入一条 system 消息。
 * 这样 identity-authority 作为独立 block 紧跟在 system prompt 后面，
 * 不混入 system prompt 文本，但模型仍能在前缀区域看到它。
 */
export function injectIndependentBlock(
  messages: Array<{ role: string; content: unknown }>,
  blockText: string,
): { injected: boolean; insertIndex: number } {
  if (!blockText) return { injected: false, insertIndex: -1 };

  // 在 system prompt 之后插入（index 1）
  if (messages[0]?.role === "system") {
    messages.splice(1, 0, { role: "system", content: blockText });
    return { injected: true, insertIndex: 1 };
  }

  // 没有 system prompt，插入到最前面
  messages.unshift({ role: "system", content: blockText });
  return { injected: true, insertIndex: 0 };
}

function prependTextToContent(content: unknown, text: string): unknown {
  if (typeof content === "string") {
    return content.trim() ? `${text}\n\n${content}` : text;
  }

  if (Array.isArray(content)) {
    const cloned = content.map((part) =>
      part && typeof part === "object" && !Array.isArray(part)
        ? { ...(part as Record<string, unknown>) }
        : part
    );
    const textPartIndex = cloned.findIndex((part: any) => part?.type === "text" && typeof part?.text === "string");
    if (textPartIndex >= 0) {
      const part = cloned[textPartIndex] as { type: string; text: string };
      part.text = part.text.trim() ? `${text}\n\n${part.text}` : text;
      return cloned;
    }
    cloned.unshift({ type: "text", text });
    return cloned;
  }

  if (typeof content === "undefined" || content === null) {
    return text;
  }

  return `${text}\n\n${String(content)}`;
}

export function prependTransientTailToLastUser(
  messages: Array<{ role: string; content?: unknown }>,
  transientText: string,
): { injected: boolean; targetIndex: number } {
  if (!transientText) return { injected: false, targetIndex: -1 };

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    messages[i] = {
      ...messages[i],
      content: prependTextToContent(messages[i].content, transientText),
    };
    return { injected: true, targetIndex: i };
  }

  if (messages[0]?.role === "system" && typeof messages[0].content === "string") {
    messages[0] = {
      ...messages[0],
      content: `${messages[0].content}\n\n${transientText}`,
    };
    return { injected: true, targetIndex: 0 };
  }

  return { injected: false, targetIndex: -1 };
}

export function mergeIndependentBlockIntoFirstSystem(
  messages: Array<{ role: string; content?: unknown }>,
  blockText: string,
): { injected: boolean; targetIndex: number } {
  if (!blockText) return { injected: false, targetIndex: -1 };

  if (messages[0]?.role === "system") {
    const existing = typeof messages[0].content === "string" ? messages[0].content.trim() : "";
    messages[0] = {
      ...messages[0],
      content: existing ? `${existing}\n\n${blockText}` : blockText,
    };
    return { injected: true, targetIndex: 0 };
  }

  messages.unshift({ role: "system", content: blockText });
  return { injected: true, targetIndex: 0 };
}

function cloneMessageContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part) =>
    part && typeof part === "object" && !Array.isArray(part)
      ? { ...(part as Record<string, unknown>) }
      : part
  );
}

function cloneMessages<T extends { role: string }>(messages: readonly T[]): T[] {
  return messages.map((message) => {
    const cloned = { ...message } as T & { content?: unknown };
    if ("content" in cloned) {
      cloned.content = cloneMessageContent(cloned.content);
    }
    return cloned as T;
  });
}

export function applyStablePrefixSplitMessageLayout<T extends { role: string }>(
  messages: readonly T[],
  options: {
    transientText?: string;
    independentBlockText?: string;
    messageLayout?: ModelMessageLayout;
  } = {},
): T[] {
  const cloned = cloneMessages(messages);
  const transientText = options.transientText ?? "";
  const independentBlockText = options.independentBlockText ?? "";

  if (options.messageLayout === "single_system_only") {
    if (independentBlockText) {
      mergeIndependentBlockIntoFirstSystem(
        cloned as Array<{ role: string; content?: unknown }>,
        independentBlockText,
      );
    }
    if (transientText) {
      prependTransientTailToLastUser(
        cloned as Array<{ role: string; content?: unknown }>,
        transientText,
      );
    }
    return cloned;
  }

  if (transientText) {
    injectTransientTail(
      cloned as unknown as Array<{ role: string; content: unknown }>,
      transientText,
    );
  }
  if (independentBlockText) {
    injectIndependentBlock(
      cloned as unknown as Array<{ role: string; content: unknown }>,
      independentBlockText,
    );
  }
  return cloned;
}

/** 默认配置 */
export const DEFAULT_STABLE_PREFIX_SPLIT_OPTIONS: Required<StablePrefixSplitOptions> = {
  enabled: false,
};
