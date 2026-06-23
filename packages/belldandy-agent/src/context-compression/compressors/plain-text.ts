/**
 * 纯文本压缩器 — 抽取式保留标题、结论、异常、关键术语
 *
 * 策略：
 * - 保留含标题（# 开头）、结论词、异常词的行
 * - 保留首尾 N 行
 * - 中间段落抽取首行
 * - 生成 omittedSummary 说明省略了什么
 */

import type {
  CompressionContentType,
  CompressionExecutionContext,
  CompressionRequest,
  CompressionResult,
  ContextCompressor,
} from "../types.js";
import { buildObservabilityRecord } from "../observability.js";

const HEADING_RE = /^\s*#{1,6}\s/;
const KEYWORD_RE = /\b(error|fail|exception|warning|结论|结果|summary|conclusion|todo|fix|bug|issue|decision)\b/i;
const MAX_KEPT_LINES = 60;
const HEAD_TAIL_LINES = 8;

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class PlainTextCompressor implements ContextCompressor {
  readonly name = "plain-text";

  supports(type: CompressionContentType): boolean {
    return type === "plain_text" || type === "markdown";
  }

  async compress(request: CompressionRequest, _ctx: CompressionExecutionContext): Promise<CompressionResult> {
    const content = request.content;
    const originalChars = content.length;
    const originalTokensEstimate = estimateTokensApprox(content);

    const lines = content.split("\n");
    if (lines.length <= MAX_KEPT_LINES) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "lines_within_limit");
    }

    const keptLines: string[] = [];
    const keptIndices = new Set<number>();
    let omittedLineCount = 0;

    // 保留首尾
    for (let i = 0; i < Math.min(HEAD_TAIL_LINES, lines.length); i++) {
      keptIndices.add(i);
    }
    for (let i = Math.max(0, lines.length - HEAD_TAIL_LINES); i < lines.length; i++) {
      keptIndices.add(i);
    }

    // 保留关键行
    for (let i = HEAD_TAIL_LINES; i < lines.length - HEAD_TAIL_LINES; i++) {
      const line = lines[i];
      if (HEADING_RE.test(line) || KEYWORD_RE.test(line)) {
        keptIndices.add(i);
      }
    }

    // 按顺序输出保留行，中间插入省略标记
    let lastKept = -1;
    for (let i = 0; i < lines.length; i++) {
      if (keptIndices.has(i)) {
        if (lastKept >= 0 && i > lastKept + 1) {
          const gap = i - lastKept - 1;
          keptLines.push(`...[${gap} lines omitted]...`);
          omittedLineCount += gap;
        }
        keptLines.push(lines[i]);
        lastKept = i;
      }
    }

    const compressedContent = keptLines.join("\n");
    const compressedChars = compressedContent.length;
    const compressedTokensEstimate = estimateTokensApprox(compressedContent);

    // 如果压缩后没怎么变小，回退
    if (compressedChars >= originalChars * 0.85) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "insufficient_savings");
    }

    const savedTokensEstimate = Math.max(0, originalTokensEstimate - compressedTokensEstimate);
    const omittedSummary = `省略了 ${omittedLineCount} 行非关键内容（保留标题、异常、结论行和首尾 ${HEAD_TAIL_LINES} 行）`;

    const result: CompressionResult = {
      applied: true,
      strategy: "plain-text-extractive",
      contentType: "plain_text",
      compressedContent,
      originalChars,
      compressedChars,
      originalTokensEstimate,
      compressedTokensEstimate,
      savedTokensEstimate,
      qualityHint: {
        mode: "extractive",
        omittedSummary,
      },
      observability: buildObservabilityRecord({
        request,
        result: {
          applied: true,
          strategy: "plain-text-extractive",
          contentType: "plain_text",
          originalChars,
          compressedChars,
          originalTokensEstimate,
          compressedTokensEstimate,
          savedTokensEstimate,
          qualityHint: { mode: "extractive", omittedSummary },
          reference: undefined,
        },
      }),
    };
    return result;
  }
}

function buildPassthrough(
  request: CompressionRequest,
  originalChars: number,
  originalTokensEstimate: number,
  reason: string,
): CompressionResult {
  return {
    applied: false,
    strategy: "plain-text-passthrough",
    contentType: "plain_text",
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
        strategy: "plain-text-passthrough",
        contentType: "plain_text",
        originalChars,
        compressedChars: originalChars,
        originalTokensEstimate,
        compressedTokensEstimate: originalTokensEstimate,
        savedTokensEstimate: 0,
        qualityHint: { mode: "passthrough" },
        reference: undefined,
      },
      reason,
    }),
  };
}
