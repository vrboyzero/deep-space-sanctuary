/**
 * 统一上下文压缩层 — 类型定义
 *
 * 设计依据：
 * - docs/计划中/headroom功能借鉴方案.md §13.2
 * - docs/计划中/SS借鉴RH项目优化项实施计划.md §6.2
 *
 * 原则：
 * - 所有压缩器 fail-open，不阻塞主流程
 * - 结构保真优先于自然语言摘要
 * - 可逆优先于盲截断
 */

/** 上下文来源类型 */
export type CompressionSourceKind =
  | "tool_result"
  | "memory_injection"
  | "task_overview"
  | "resume_detail"
  | "attachment_text"
  | "search_result"
  | "file_read"
  | "code_snippet"
  | "subagent_handoff"
  | "manual";

/** 内容类型（由分类器识别） */
export type CompressionContentType =
  | "json"
  | "log"
  | "search"
  | "code"
  | "plain_text"
  | "markdown"
  | "unknown";

/** 压缩请求 */
export type CompressionRequest = {
  requestId?: string;
  conversationId?: string;
  runId?: string;
  agentId?: string;
  sourceKind: CompressionSourceKind;
  sourceName?: string;
  contentTypeHint?: CompressionContentType;
  content: string;
  metadata?: Record<string, unknown>;
  policy?: Partial<CompressionPolicy>;
};

/** 压缩质量模式 */
export type CompressionQualityMode =
  | "structure_preserving"
  | "extractive"
  | "abstractive"
  | "passthrough";

/** 引用状态（Phase 2） */
export type ReferenceStatus = "active" | "invalidated" | "expired";

/** 引用信息（可逆压缩时附带） */
export type CompressionReference = {
  refId: string;
  storeKind: "conversation" | "runtime" | "memory";
  retrievalHint: string;
  /** 当前引用状态，用于冷恢复裁剪时表达"可回取"还是"已失效" */
  status?: ReferenceStatus;
};

/** 已存储的引用记录（Phase 2） */
export type StoredReference = {
  refId: string;
  /** 原始未压缩内容 */
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  status: ReferenceStatus;
  storeKind: "conversation" | "runtime";
};

/** 压缩结果 */
export type CompressionResult = {
  applied: boolean;
  strategy: string;
  contentType: CompressionContentType;
  compressedContent: string;
  originalChars: number;
  compressedChars: number;
  originalTokensEstimate: number;
  compressedTokensEstimate: number;
  savedTokensEstimate: number;
  qualityHint?: {
    mode: CompressionQualityMode;
    omittedSummary?: string;
  };
  reference?: CompressionReference;
  observability: CompressionObservabilityRecord;
};

/** 压缩策略配置 */
export type CompressionPolicy = {
  enabled: boolean;
  allowLossy: boolean;
  allowReferenceStore: boolean;
  preservePrefixStability: boolean;
  maxInlineChars: number;
  maxInlineTokensEstimate: number;
  preferStructurePreserving: boolean;
  /** 最小节省比例，低于此比例不应用压缩 */
  minSavingsRatioToApply: number;
  sourceOverrides?: Partial<Record<CompressionSourceKind, {
    enabled?: boolean;
    allowLossy?: boolean;
    allowReferenceStore?: boolean;
  }>>;
};

/** 单次压缩观测记录 */
export type CompressionObservabilityRecord = {
  requestId?: string;
  conversationId?: string;
  runId?: string;
  agentId?: string;
  sourceKind: CompressionSourceKind;
  sourceName?: string;
  contentType: CompressionContentType;
  strategy: string;
  applied: boolean;
  reason?: string;
  originalChars: number;
  compressedChars: number;
  originalTokensEstimate: number;
  compressedTokensEstimate: number;
  savedTokensEstimate: number;
  savedRatio?: number;
  referenceStored: boolean;
  referenceId?: string;
  /** Phase 2：引用当前状态 */
  referenceStatus?: ReferenceStatus;
  lossiness: "none" | "low" | "medium" | "high";
  omittedSummary?: string;
  durationMs?: number;
  failed?: boolean;
  errorCode?: string;
};

/** 批量压缩结果 */
export type CompressionBatchResult = {
  results: CompressionResult[];
  totalSavedTokensEstimate: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  /** Phase 2：本批次中存储到 reference store 的引用数 */
  referenceStoredCount?: number;
  /** Phase 3：工具结果 adaptive keep 选择诊断 */
  selection?: {
    adaptive: boolean;
    keepRecentToolMessages: number;
    toolMessageCount: number;
    selectedCount: number;
    keptCount: number;
    decisions: Array<{
      messageIndex: number;
      toolName: string;
      action: "compress" | "keep";
      reason: string;
      contentChars: number;
    }>;
  };
};

/** 压缩执行上下文（传给压缩器的运行时信息） */
export type CompressionExecutionContext = {
  policy: CompressionPolicy;
  conversationId?: string;
  runId?: string;
  agentId?: string;
  /** Phase 2：引用存储（压缩器可选使用） */
  referenceStore?: CompressionReferenceStore;
};

/** 引用存储接口（Phase 2） */
export interface CompressionReferenceStore {
  store(content: string, metadata?: Record<string, unknown>): StoredReference;
  retrieve(refId: string): { found: boolean; content?: string; status?: ReferenceStatus; metadata?: Record<string, unknown> };
  invalidate(refId: string): boolean;
  prune(predicate: (ref: StoredReference) => boolean): number;
  /** 可选会话释放能力；持久化 Store 可不实现，以保留冷恢复引用。 */
  releaseConversation?(conversationId: string): { prunedCount: number; retainedCount: number };
  has(refId: string): boolean;
  size(): number;
  clear(): void;
}

/** 压缩器接口 */
export interface ContextCompressor {
  readonly name: string;
  supports(type: CompressionContentType): boolean;
  compress(request: CompressionRequest, ctx: CompressionExecutionContext): Promise<CompressionResult>;
}

/** 分类器接口 */
export interface ContentClassifier {
  detect(input: {
    content: string;
    sourceKind: CompressionSourceKind;
    metadata?: Record<string, unknown>;
    hint?: CompressionContentType;
  }): CompressionContentType;
}

/** 管线接口 */
export interface ContextCompressionPipeline {
  compress(request: CompressionRequest): Promise<CompressionResult>;
  retrieve?(input: {
    refId: string;
    conversationId?: string;
    query?: string;
  }): Promise<{ found: boolean; content?: string; metadata?: Record<string, unknown> }>;
  /** Phase 2：获取底层引用存储（用于冷恢复裁剪） */
  getReferenceStore?(): CompressionReferenceStore | undefined;
}

/** 默认策略 */
export const DEFAULT_COMPRESSION_POLICY: CompressionPolicy = {
  enabled: true,
  allowLossy: true,
  allowReferenceStore: false,
  preservePrefixStability: true,
  maxInlineChars: 8_000,
  maxInlineTokensEstimate: 2_000,
  preferStructurePreserving: true,
  minSavingsRatioToApply: 0.15,
  sourceOverrides: {
    tool_result: { enabled: true, allowLossy: true, allowReferenceStore: false },
    attachment_text: { enabled: true, allowLossy: true, allowReferenceStore: false },
    memory_injection: { enabled: false, allowLossy: false, allowReferenceStore: false },
    task_overview: { enabled: false, allowLossy: false, allowReferenceStore: false },
    resume_detail: { enabled: false, allowLossy: false, allowReferenceStore: false },
  },
};
