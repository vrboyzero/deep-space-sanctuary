/**
 * Shared Compressed Context — team/delegation/fan-in 场景共享压缩上下文（Phase 4 步骤 4）
 *
 * 设计依据：SS借鉴RH项目优化项实施计划.md §9 Phase 4 / §6.2
 *
 * 目标：
 * - 让 team 成员共享一份压缩后的上下文摘要
 * - fan-in 时 manager 不需要查看每个 lane 的完整历史
 * - 利用 Phase 1-2 的统一压缩层对 lane output 做压缩
 * - 减少 manager 的 prompt 体积，提升 fan-in 效率
 *
 * 不做：
 * - 跨会话持久化（当前只做 run-scoped 内存存储）
 * - 替代 SubTaskTeamSharedStateView（互补关系）
 */

import type { CompressionResult } from "./context-compression/types.js";

/** Team-scoped 共享压缩上下文条目 */
export type SharedContextEntry = {
  /** lane ID */
  laneId: string;
  /** lane 的 agent ID */
  agentId?: string;
  /** 原始 output 摘要（未压缩） */
  rawSummary: string;
  /** 压缩后的 output 摘要 */
  compressedSummary?: string;
  /** 压缩结果（如果有） */
  compressionResult?: CompressionResult;
  /** 条目创建时间 */
  createdAt: number;
  /** 条目状态 */
  status: "active" | "stale" | "archived";
};

/** 共享压缩上下文存储 */
export class SharedCompressedContextStore {
  private readonly entries = new Map<string, SharedContextEntry>();
  private readonly teamId: string;

  constructor(teamId: string) {
    this.teamId = teamId;
  }

  /** 添加或更新一个 lane 的共享上下文条目 */
  upsert(input: {
    laneId: string;
    agentId?: string;
    rawSummary: string;
    compressedSummary?: string;
    compressionResult?: CompressionResult;
  }): SharedContextEntry {
    const existing = this.entries.get(input.laneId);
    const entry: SharedContextEntry = {
      laneId: input.laneId,
      agentId: input.agentId ?? existing?.agentId,
      rawSummary: input.rawSummary,
      compressedSummary: input.compressedSummary ?? existing?.compressedSummary,
      compressionResult: input.compressionResult ?? existing?.compressionResult,
      createdAt: Date.now(),
      status: "active",
    };
    this.entries.set(input.laneId, entry);
    return entry;
  }

  /** 获取一个 lane 的条目 */
  get(laneId: string): SharedContextEntry | undefined {
    return this.entries.get(laneId);
  }

  /** 获取所有 active 条目 */
  getActiveEntries(): SharedContextEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.status === "active");
  }

  /** 标记一个 lane 的条目为 stale */
  markStale(laneId: string): boolean {
    const entry = this.entries.get(laneId);
    if (!entry) return false;
    entry.status = "stale";
    return true;
  }

  /** 构建 fan-in 共享上下文文本（注入到 manager 的 messages 中） */
  buildFanInContextText(): string {
    const activeEntries = this.getActiveEntries();
    if (activeEntries.length === 0) return "";

    const parts = activeEntries.map((entry) => {
      const summary = entry.compressedSummary ?? entry.rawSummary;
      const agentLabel = entry.agentId ? ` (agent: ${entry.agentId})` : "";
      return `### Lane ${entry.laneId}${agentLabel}\n${summary}`;
    });

    return `<team-shared-context hint="以下是各 lane 的压缩上下文摘要，用于 fan-in 决策。">\n${parts.join("\n\n")}\n</team-shared-context>`;
  }

  /** 获取存储大小 */
  size(): number {
    return this.entries.size;
  }

  /** 获取 team ID */
  getTeamId(): string {
    return this.teamId;
  }

  /** 清空所有条目 */
  clear(): void {
    this.entries.clear();
  }
}

/** 全局 registry：teamId → SharedCompressedContextStore */
const sharedContextRegistry = new Map<string, SharedCompressedContextStore>();

/** 获取或创建一个 team 的共享压缩上下文存储 */
export function getOrCreateSharedCompressedContextStore(teamId: string): SharedCompressedContextStore {
  let store = sharedContextRegistry.get(teamId);
  if (!store) {
    store = new SharedCompressedContextStore(teamId);
    sharedContextRegistry.set(teamId, store);
  }
  return store;
}

/** 获取一个 team 的共享压缩上下文存储（不创建） */
export function getSharedCompressedContextStore(teamId: string): SharedCompressedContextStore | undefined {
  return sharedContextRegistry.get(teamId);
}

/** 清理一个 team 的共享压缩上下文存储 */
export function cleanupSharedCompressedContextStore(teamId: string): boolean {
  return sharedContextRegistry.delete(teamId);
}

/**
 * 将 fan-in 共享上下文注入到 manager 的 messages 中。
 *
 * 策略：在最后一条 user 消息前插入一条 system 消息。
 */
export function injectSharedCompressedContext(
  messages: Array<{ role: string; content: unknown }>,
  contextText: string,
): { injected: boolean; insertIndex: number } {
  if (!contextText) return { injected: false, insertIndex: -1 };

  // 找到最后一条 user 消息
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    messages.push({ role: "system", content: contextText });
    return { injected: true, insertIndex: messages.length - 1 };
  }

  messages.splice(lastUserIdx, 0, { role: "system", content: contextText });
  return { injected: true, insertIndex: lastUserIdx };
}

/**
 * 从 lane output 构建摘要文本。
 *
 * 策略：提取 output 的关键信息（前 N 行 + 结论行），不做完整压缩。
 * 完整压缩由调用方使用统一压缩层处理。
 */
export function buildLaneSummary(output: string, maxChars: number = 500): string {
  if (!output || output.trim().length === 0) return "(no output)";
  if (output.length <= maxChars) return output.trim();

  const lines = output.split("\n");
  const headLines = lines.slice(0, 5);
  const tailLines = lines.slice(-3);
  const omitted = lines.length - 8;
  return `${headLines.join("\n")}\n... [${omitted} lines omitted] ...\n${tailLines.join("\n")}`;
}
