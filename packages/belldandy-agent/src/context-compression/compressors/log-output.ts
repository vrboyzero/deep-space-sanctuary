/**
 * 日志输出压缩器 — 保留 error/warn/summary/首尾堆栈
 *
 * 策略：
 * - 保留所有 ERROR / FATAL / WARN 行
 * - 保留首尾 N 行
 * - 保留含 stack trace / exception 的行
 * - 其余 INFO / DEBUG 行按比例采样保留
 */

import type {
  CompressionContentType,
  CompressionExecutionContext,
  CompressionRequest,
  CompressionResult,
  ContextCompressor,
} from "../types.js";
import { buildObservabilityRecord } from "../observability.js";

const ERROR_RE = /\b(ERROR|FATAL|CRITICAL|PANIC)\b/i;
const WARN_RE = /\bWARN(ING)?\b/i;
const STACK_RE = /\b(at\s+|File "|Traceback|Caused by|Exception|Stack:)/i;
const MAX_KEPT_LINES = 80;
const HEAD_TAIL_LINES = 6;
const SAMPLE_INTERVAL = 5; // 每 5 行 INFO/DEBUG 保留 1 行

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class LogOutputCompressor implements ContextCompressor {
  readonly name = "log-output";

  supports(type: CompressionContentType): boolean {
    return type === "log";
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
    let infoSampleCounter = 0;

    // 保留首尾
    for (let i = 0; i < Math.min(HEAD_TAIL_LINES, lines.length); i++) {
      keptIndices.add(i);
    }
    for (let i = Math.max(0, lines.length - HEAD_TAIL_LINES); i < lines.length; i++) {
      keptIndices.add(i);
    }

    // 中间区域：保留 error/warn/stack，采样保留 info/debug
    for (let i = HEAD_TAIL_LINES; i < lines.length - HEAD_TAIL_LINES; i++) {
      const line = lines[i];
      if (ERROR_RE.test(line) || STACK_RE.test(line)) {
        keptIndices.add(i);
      } else if (WARN_RE.test(line)) {
        keptIndices.add(i);
      } else {
        infoSampleCounter++;
        if (infoSampleCounter >= SAMPLE_INTERVAL) {
          keptIndices.add(i);
          infoSampleCounter = 0;
        }
      }
    }

    // 按顺序输出
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

    if (compressedChars >= originalChars * 0.85) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "insufficient_savings");
    }

    const savedTokensEstimate = Math.max(0, originalTokensEstimate - compressedTokensEstimate);
    const omittedSummary = `省略了 ${omittedLineCount} 行 INFO/DEBUG 日志（保留 ERROR/WARN/stack trace 和首尾 ${HEAD_TAIL_LINES} 行）`;

    return {
      applied: true,
      strategy: "log-output-extractive",
      contentType: "log",
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
          strategy: "log-output-extractive",
          contentType: "log",
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
    strategy: "log-output-passthrough",
    contentType: "log",
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
        strategy: "log-output-passthrough",
        contentType: "log",
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
