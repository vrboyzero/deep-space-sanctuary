/**
 * Passthrough 压缩器 — 默认兜底，不压缩
 */

import type {
  CompressionContentType,
  CompressionExecutionContext,
  CompressionRequest,
  CompressionResult,
  ContextCompressor,
} from "../types.js";
import { buildObservabilityRecord } from "../observability.js";

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class PassthroughCompressor implements ContextCompressor {
  readonly name = "passthrough";

  supports(_type: CompressionContentType): boolean {
    return true;
  }

  async compress(request: CompressionRequest, _ctx: CompressionExecutionContext): Promise<CompressionResult> {
    const originalChars = request.content.length;
    const originalTokensEstimate = estimateTokensApprox(request.content);
    const result: CompressionResult = {
      applied: false,
      strategy: "passthrough",
      contentType: "unknown",
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
          contentType: "unknown",
          originalChars,
          compressedChars: originalChars,
          originalTokensEstimate,
          compressedTokensEstimate: originalTokensEstimate,
          savedTokensEstimate: 0,
          qualityHint: { mode: "passthrough" },
          reference: undefined,
        },
        reason: "passthrough_default",
      }),
    };
    return result;
  }
}
