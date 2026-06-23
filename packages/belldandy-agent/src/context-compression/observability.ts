/**
 * 压缩观测工具
 *
 * 构建单次压缩观测记录，计算节省比例。
 */

import type { CompressionObservabilityRecord, CompressionRequest, CompressionResult } from "./types.js";

export function buildObservabilityRecord(input: {
  request: CompressionRequest;
  result: Pick<CompressionResult,
    "applied" | "strategy" | "contentType" | "originalChars" | "compressedChars"
    | "originalTokensEstimate" | "compressedTokensEstimate" | "savedTokensEstimate"
    | "qualityHint" | "reference">;
  reason?: string;
  durationMs?: number;
  failed?: boolean;
  errorCode?: string;
}): CompressionObservabilityRecord {
  const { request, result } = input;
  const savedRatio = result.originalTokensEstimate > 0
    ? result.savedTokensEstimate / result.originalTokensEstimate
    : 0;

  return {
    requestId: request.requestId,
    conversationId: request.conversationId,
    runId: request.runId,
    agentId: request.agentId,
    sourceKind: request.sourceKind,
    sourceName: request.sourceName,
    contentType: result.contentType,
    strategy: result.strategy,
    applied: result.applied,
    reason: input.reason,
    originalChars: result.originalChars,
    compressedChars: result.compressedChars,
    originalTokensEstimate: result.originalTokensEstimate,
    compressedTokensEstimate: result.compressedTokensEstimate,
    savedTokensEstimate: result.savedTokensEstimate,
    savedRatio,
    referenceStored: Boolean(result.reference),
    referenceId: result.reference?.refId,
    lossiness: result.qualityHint?.mode === "passthrough" ? "none"
      : result.qualityHint?.mode === "structure_preserving" ? "low"
      : result.qualityHint?.mode === "extractive" ? "medium"
      : "high",
    omittedSummary: result.qualityHint?.omittedSummary,
    durationMs: input.durationMs,
    failed: input.failed,
    errorCode: input.errorCode,
  };
}
