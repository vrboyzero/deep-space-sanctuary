/**
 * 统一压缩管线
 *
 * 流程：Normalize -> Classify -> Policy Check -> Compress or Pass-through -> Reference Store -> Observability Emit
 *
 * 所有压缩器 fail-open：若压缩器抛异常，回退到 passthrough，不阻塞主流程。
 *
 * Phase 2 扩展：
 * - 接入 CompressionReferenceStore，压缩后可选存储原文并返回 reference
 * - 实现 retrieve() 方法，统一回取入口
 * - getReferenceStore() 暴露底层 store，供冷恢复裁剪使用
 */

import { detectContentType } from "./classifier.js";
import { buildObservabilityRecord } from "./observability.js";
import { resolveCompressionPolicy, isSourceEnabled, isSourceLossyAllowed, isReferenceStoreAllowed } from "./policy.js";
import { CompressionRouter } from "./router.js";
import { ConversationReferenceStore } from "./reference-store.js";
import {
  DEFAULT_COMPRESSION_POLICY,
  type CompressionContentType,
  type CompressionExecutionContext,
  type CompressionPolicy,
  type CompressionReferenceStore,
  type CompressionRequest,
  type CompressionResult,
  type CompressionSourceKind,
  type ContextCompressor,
  type ContextCompressionPipeline,
} from "./types.js";

/** 粗略 token 估算（与 compaction.ts 的 estimateTokens 保持一致的量级） */
function estimateTokensApprox(text: string): number {
  if (!text) return 0;
  // 英文约 4 chars/token，中文约 2 chars/token，取中间偏保守
  return Math.ceil(text.length / 3.5);
}

export class ContextCompressionPipelineImpl implements ContextCompressionPipeline {
  private readonly router: CompressionRouter;
  private readonly policy: CompressionPolicy;
  /** Phase 2：引用存储 */
  private readonly referenceStore: CompressionReferenceStore | undefined;

  constructor(input: {
    compressors: ContextCompressor[];
    fallback: ContextCompressor;
    policy?: Partial<CompressionPolicy>;
    /** Phase 2：可选引用存储，传入后 retrieve/marker 才能工作 */
    referenceStore?: CompressionReferenceStore;
  }) {
    this.policy = resolveCompressionPolicy(input.policy);
    this.router = new CompressionRouter(input.compressors, input.fallback);
    this.referenceStore = input.referenceStore;
  }

  async compress(request: CompressionRequest): Promise<CompressionResult> {
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const originalChars = request.content.length;
    const originalTokensEstimate = estimateTokensApprox(request.content);

    // 策略检查：来源是否启用
    if (!isSourceEnabled(this.policy, request.sourceKind)) {
      return this.buildPassthroughResult(request, originalChars, originalTokensEstimate, "source_disabled", startedAt);
    }

    // 内容太短不压缩
    if (originalChars < 120) {
      return this.buildPassthroughResult(request, originalChars, originalTokensEstimate, "content_too_short", startedAt);
    }

    // 分类
    const contentType: CompressionContentType = detectContentType({
      content: request.content,
      sourceKind: request.sourceKind,
      metadata: request.metadata,
      hint: request.contentTypeHint,
    });

    // 路由压缩器
    const compressor = this.router.select(contentType);
    const ctx: CompressionExecutionContext = {
      policy: this.policy,
      conversationId: request.conversationId,
      runId: request.runId,
      agentId: request.agentId,
      referenceStore: this.referenceStore,
    };

    try {
      const result = await compressor.compress(request, ctx);

      // 检查节省比例是否达标
      const savingsRatio = result.originalTokensEstimate > 0
        ? result.savedTokensEstimate / result.originalTokensEstimate
        : 0;
      if (result.applied && savingsRatio < this.policy.minSavingsRatioToApply) {
        // 节省不够，回退 passthrough
        return this.buildPassthroughResult(request, originalChars, originalTokensEstimate, "savings_below_threshold", startedAt, contentType);
      }

      // Phase 2：若压缩器未自行处理引用，且策略允许，则在此统一存储原文
      if (
        result.applied &&
        !result.reference &&
        this.referenceStore &&
        isReferenceStoreAllowed(this.policy, request.sourceKind) &&
        result.compressedContent.length < originalChars
      ) {
        const stored = this.referenceStore.store(request.content, {
          sourceKind: request.sourceKind,
          sourceName: request.sourceName,
          strategy: result.strategy,
          contentType,
          conversationId: request.conversationId,
          runId: request.runId,
          originalChars,
          compressedChars: result.compressedChars,
        });
        result.reference = {
          refId: stored.refId,
          storeKind: stored.storeKind,
          retrievalHint: `compressed-${result.strategy}`,
          status: stored.status,
        };
        // 同步 observability
        result.observability.referenceStored = true;
        result.observability.referenceId = stored.refId;
        result.observability.referenceStatus = stored.status;
      }

      // 补充 durationMs
      if (!result.observability.durationMs) {
        result.observability.durationMs = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
        );
      }

      return result;
    } catch (err) {
      // fail-open：压缩器抛异常，回退 passthrough
      const errorCode = err instanceof Error ? err.message : String(err);
      return this.buildPassthroughResult(request, originalChars, originalTokensEstimate, "compressor_failed", startedAt, contentType, true, errorCode);
    }
  }

  async retrieve(input: {
    refId: string;
    conversationId?: string;
    query?: string;
  }): Promise<{ found: boolean; content?: string; metadata?: Record<string, unknown> }> {
    if (!this.referenceStore) {
      return { found: false };
    }
    return this.referenceStore.retrieve(input.refId);
  }

  getReferenceStore(): CompressionReferenceStore | undefined {
    return this.referenceStore;
  }

  private buildPassthroughResult(
    request: CompressionRequest,
    originalChars: number,
    originalTokensEstimate: number,
    reason: string,
    startedAt: number,
    contentType: CompressionContentType = "unknown",
    failed?: boolean,
    errorCode?: string,
  ): CompressionResult {
    const durationMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
    );
    const result: CompressionResult = {
      applied: false,
      strategy: "passthrough",
      contentType,
      compressedContent: request.content,
      originalChars,
      compressedChars: originalChars,
      originalTokensEstimate,
      compressedTokensEstimate: originalTokensEstimate,
      savedTokensEstimate: 0,
      qualityHint: { mode: "passthrough" },
      observability: buildObservabilityRecord({
        request,
        result: {
          applied: false,
          strategy: "passthrough",
          contentType,
          originalChars,
          compressedChars: originalChars,
          originalTokensEstimate,
          compressedTokensEstimate: originalTokensEstimate,
          savedTokensEstimate: 0,
          qualityHint: { mode: "passthrough" },
          reference: undefined,
        },
        reason,
        durationMs,
        failed,
        errorCode,
      }),
    };
    return result;
  }
}

export { DEFAULT_COMPRESSION_POLICY, resolveCompressionPolicy, isSourceEnabled, isSourceLossyAllowed, isReferenceStoreAllowed };
export type { CompressionPolicy, CompressionRequest, CompressionResult, CompressionSourceKind, ContextCompressor };
export { ConversationReferenceStore };
