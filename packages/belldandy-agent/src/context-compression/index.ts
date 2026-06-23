/**
 * 统一上下文压缩层 — 公开接口
 *
 * 用法：
 * ```ts
 * import { createCompressionPipeline } from "./context-compression/index.js";
 * const pipeline = createCompressionPipeline();
 * const result = await pipeline.compress({
 *   sourceKind: "tool_result",
 *   sourceName: "run_command",
 *   content: largeToolOutput,
 * });
 * ```
 *
 * Phase 2 扩展：
 * - 传入 referenceStore 后，压缩原文可回取
 * - 可通过 retrieve() 统一回取
 * - coldResumePruneMessages / pruneBeforeSummarize 用于冷恢复裁剪
 */

import { ContextCompressionPipelineImpl } from "./pipeline.js";
import { PassthroughCompressor } from "./compressors/passthrough.js";
import { PlainTextCompressor } from "./compressors/plain-text.js";
import { LogOutputCompressor } from "./compressors/log-output.js";
import { SearchResultsCompressor } from "./compressors/search-results.js";
import { JsonToolOutputCompressor } from "./compressors/json-tool-output.js";
import { CodeSnippetCompressor } from "./compressors/code-snippet.js";
import { ConversationReferenceStore } from "./reference-store.js";
import type {
  CompressionPolicy,
  CompressionRequest,
  CompressionResult,
  CompressionSourceKind,
  CompressionContentType,
  CompressionBatchResult,
  CompressionReferenceStore,
  ContextCompressionPipeline,
  ContextCompressor,
  ReferenceStatus,
  StoredReference,
} from "./types.js";

export type {
  CompressionPolicy,
  CompressionRequest,
  CompressionResult,
  CompressionSourceKind,
  CompressionContentType,
  CompressionBatchResult,
  ContextCompressionPipeline,
  ContextCompressor,
  ReferenceStatus,
  StoredReference,
  CompressionReferenceStore,
};

export { DEFAULT_COMPRESSION_POLICY } from "./types.js";
export { resolveCompressionPolicy, isSourceEnabled, isSourceLossyAllowed, isReferenceStoreAllowed } from "./policy.js";
export { detectContentType } from "./classifier.js";
export { buildObservabilityRecord } from "./observability.js";

export { PassthroughCompressor } from "./compressors/passthrough.js";
export { PlainTextCompressor } from "./compressors/plain-text.js";
export { LogOutputCompressor } from "./compressors/log-output.js";
export { SearchResultsCompressor } from "./compressors/search-results.js";
export { JsonToolOutputCompressor } from "./compressors/json-tool-output.js";
export { CodeSnippetCompressor } from "./compressors/code-snippet.js";

// Phase 2：引用存储与 marker
export { ConversationReferenceStore, generateRefId } from "./reference-store.js";
export {
  COMPRESSION_MARKER_PREFIX,
  LEGACY_MARKER_PREFIX,
  MICROCOMPACT_CLEARED_PREFIX,
  MICROCOMPACT_ERROR_PREFIX,
  hasCompressionMarker,
  hasLegacyCompressionMarker,
  isAnyCompactedContent,
  parseCompressionMarker,
  buildCompressionMarkerHeader,
  wrapWithMarker,
  rewriteMarkerRetrievable,
  statusToRetrievable,
  type ParsedCompressionMarker,
} from "./marker.js";
export {
  coldResumePruneMessages,
  pruneBeforeSummarize,
  type ColdResumePruneResult,
} from "./cold-resume-prune.js";

/**
 * 创建默认压缩管线（含 Phase 1 + Phase 2 压缩器）。
 *
 * @param policy 策略覆盖
 * @param opts.referenceStore 可选引用存储；传入后 retrieve/marker 才能工作
 */
export function createCompressionPipeline(
  policy?: Partial<CompressionPolicy>,
  opts?: {
    referenceStore?: CompressionReferenceStore;
  },
): ContextCompressionPipeline {
  const compressors: ContextCompressor[] = [
    new JsonToolOutputCompressor(),
    new LogOutputCompressor(),
    new SearchResultsCompressor(),
    new CodeSnippetCompressor(),
    new PlainTextCompressor(),
  ];
  const fallback = new PassthroughCompressor();
  return new ContextCompressionPipelineImpl({
    compressors,
    fallback,
    policy,
    referenceStore: opts?.referenceStore,
  });
}

/** 创建带独立引用存储的压缩管线（Phase 2 推荐用法） */
export function createCompressionPipelineWithStore(
  policy?: Partial<CompressionPolicy>,
  storeOpts?: { storeKind?: "conversation" | "runtime"; maxEntries?: number },
): {
  pipeline: ContextCompressionPipeline;
  store: ConversationReferenceStore;
} {
  const store = new ConversationReferenceStore(storeOpts);
  const pipeline = createCompressionPipeline(policy, { referenceStore: store });
  return { pipeline, store };
}
