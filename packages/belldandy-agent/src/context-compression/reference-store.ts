/**
 * 引用存储 — conversation-scoped 原文回取（Phase 2）
 *
 * 设计依据：SS借鉴RH项目优化项实施计划.md §6.2.C / §7.2
 *
 * 职责：
 * - 存储被压缩内容的原始全文，供后续 retrieve 回取
 * - 支持 invalidate / prune，用于冷恢复裁剪时标记失效
 * - 纯内存实现，生命周期与 conversation run 对齐
 *
 * 不做：
 * - 持久化到磁盘（后续 Phase 4 再考虑 stateDir sidecar）
 * - 跨 conversation 共享
 */

import type { CompressionReferenceStore, ReferenceStatus, StoredReference } from "./types.js";

let refIdCounter = 0;

/** 生成单调递增的引用 ID，带前缀便于 marker 解析识别 */
export function generateRefId(prefix = "cr"): string {
  refIdCounter += 1;
  const ts = Date.now().toString(36);
  const seq = refIdCounter.toString(36);
  return `${prefix}_${ts}_${seq}`;
}

/**
 * conversation-scoped 引用存储。
 *
 * 每个会话 run 应使用独立实例，避免跨会话污染。
 * 线程安全：单线程 Node.js 下安全；异步并发下 Map 操作本身原子。
 */
export class ConversationReferenceStore implements CompressionReferenceStore {
  private readonly refs = new Map<string, StoredReference>();
  private readonly storeKind: "conversation" | "runtime";
  /** 软上限，超过时 prune 最老条目，防止无界增长 */
  private readonly maxEntries: number;

  constructor(opts?: {
    storeKind?: "conversation" | "runtime";
    maxEntries?: number;
  }) {
    this.storeKind = opts?.storeKind ?? "conversation";
    this.maxEntries = opts?.maxEntries ?? 64;
  }

  store(content: string, metadata?: Record<string, unknown>): StoredReference {
    const refId = generateRefId();
    const record: StoredReference = {
      refId,
      content,
      metadata: { ...(metadata ?? {}) },
      createdAt: Date.now(),
      status: "active",
      storeKind: this.storeKind,
    };
    this.refs.set(refId, record);
    this.enforceMaxEntries();
    return record;
  }

  retrieve(refId: string): {
    found: boolean;
    content?: string;
    status?: ReferenceStatus;
    metadata?: Record<string, unknown>;
  } {
    const record = this.refs.get(refId);
    if (!record) {
      return { found: false };
    }
    return {
      found: true,
      content: record.content,
      status: record.status,
      metadata: { ...record.metadata },
    };
  }

  invalidate(refId: string): boolean {
    const record = this.refs.get(refId);
    if (!record) return false;
    if (record.status === "invalidated") return false;
    record.status = "invalidated";
    return true;
  }

  prune(predicate: (ref: StoredReference) => boolean): number {
    let pruned = 0;
    for (const [refId, record] of this.refs) {
      if (predicate(record)) {
        record.status = "invalidated";
        // 失效后不立即删除，保留 status 供 marker 回读
        // 真正删除交给 clear() 或 maxEntries 淘汰
        pruned++;
        // 触发删除：失效条目可安全移除以释放内存
        this.refs.delete(refId);
        void refId;
      }
    }
    return pruned;
  }

  releaseConversation(conversationId: string): { prunedCount: number; retainedCount: number } {
    // 无归属 metadata 的旧引用不能推断 owner，必须保留到原有容量淘汰路径。
    const prunedCount = this.prune((record) => record.metadata.conversationId === conversationId);
    return {
      prunedCount,
      retainedCount: this.refs.size,
    };
  }

  has(refId: string): boolean {
    return this.refs.has(refId);
  }

  size(): number {
    return this.refs.size;
  }

  clear(): void {
    this.refs.clear();
  }

  /** 返回所有条目的快照（只读视图，用于诊断） */
  snapshot(): StoredReference[] {
    return Array.from(this.refs.values()).map((r) => ({ ...r, metadata: { ...r.metadata } }));
  }

  private enforceMaxEntries(): void {
    if (this.refs.size <= this.maxEntries) return;
    // 淘汰最老的 active 条目
    const entries = Array.from(this.refs.entries());
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = entries.slice(0, Math.max(0, entries.length - this.maxEntries));
    for (const [refId] of toRemove) {
      this.refs.delete(refId);
    }
  }
}
