/**
 * 代码片段压缩器 — 保留结构骨架，截断函数体（Phase 2）
 *
 * 策略：
 * - 保留所有 import / export / require 行
 * - 保留函数/类/方法签名行（含参数）
 * - 保留顶层注释（含 TODO/FIXME）
 * - 函数体只保留首尾 N 行，中间用 [...N lines omitted] 占位
 * - 保留常量声明（const/let/var 顶层）
 * - 生成 omittedSummary
 *
 * 结构保真优先于摘要，不改变代码语义结构。
 */

import type {
  CompressionContentType,
  CompressionExecutionContext,
  CompressionRequest,
  CompressionResult,
  ContextCompressor,
} from "../types.js";
import { buildObservabilityRecord } from "../observability.js";

const SIGNATURE_RE = /^\s*(export\s+)?(async\s+)?(function|class|def |public |private |protected |static |abstract |interface |type |enum )\b/;
const IMPORT_RE = /^\s*(import|export|require|from|using)\b/;
const TODO_RE = /\b(TODO|FIXME|HACK|XXX|BUG|NOTE)\b/;
const BLOCK_OPEN_RE = /[{(:]\s*$/;
const BLOCK_CLOSE_RE = /^\s*[}\])]/;
const MAX_KEPT_LINES = 120;
const MIN_COMPRESSABLE_LINES = 60;
const FUNCTION_BODY_HEAD = 4;
const FUNCTION_BODY_TAIL = 3;

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3.5);
}

type LineKind = "signature" | "import" | "body" | "blank" | "close" | "comment";

function classifyLine(line: string): LineKind {
  if (!line.trim()) return "blank";
  // signature 优先于 import：export function/class 会被 IMPORT_RE 的 export 匹配，
  // 但它们是结构签名，应优先识别为 signature
  if (SIGNATURE_RE.test(line)) return "signature";
  if (IMPORT_RE.test(line)) return "import";
  if (TODO_RE.test(line) && /^\s*(\/\/|#|\/\*|\*)/.test(line)) return "comment";
  if (BLOCK_CLOSE_RE.test(line)) return "close";
  return "body";
}

/**
 * 识别函数/类体范围：从 signature 行开始，到匹配的 close 行结束。
 * 简化版：基于缩进 + 大括号/冒号匹配，不要求完整 AST。
 */
function findBlockEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{" || ch === "(") {
        depth++;
        started = true;
      } else if (ch === "}" || ch === ")") {
        depth--;
      }
    }
    if (started && depth <= 0) {
      return i;
    }
    // Python 风格：以冒号开头，下一行缩进增加，结束时缩进回到 signature 级别
    if (line.trimEnd().endsWith(":") && !started) {
      started = true;
      depth = 1;
      continue;
    }
    if (started && /^\s*$/.test(line) && i > startIdx + 1) {
      // 空行不结束块
      continue;
    }
  }
  return Math.min(lines.length - 1, startIdx + 30);
}

export class CodeSnippetCompressor implements ContextCompressor {
  readonly name = "code-snippet";

  supports(type: CompressionContentType): boolean {
    return type === "code";
  }

  async compress(request: CompressionRequest, _ctx: CompressionExecutionContext): Promise<CompressionResult> {
    const content = request.content;
    const originalChars = content.length;
    const originalTokensEstimate = estimateTokensApprox(content);

    const lines = content.split("\n");
    if (lines.length < MIN_COMPRESSABLE_LINES) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "lines_within_limit");
    }
    if (originalChars < 800) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "content_too_short");
    }

    const keptIndices = new Set<number>();
    let omittedBodyLines = 0;
    let omittedBlocks = 0;

    // 第一遍：标记 import / signature / comment / 首尾
    for (let i = 0; i < lines.length; i++) {
      const kind = classifyLine(lines[i]);
      if (kind === "import" || kind === "signature" || kind === "comment") {
        keptIndices.add(i);
      }
    }
    // 首尾保留
    for (let i = 0; i < Math.min(FUNCTION_BODY_HEAD, lines.length); i++) keptIndices.add(i);
    for (let i = Math.max(0, lines.length - FUNCTION_BODY_TAIL); i < lines.length; i++) keptIndices.add(i);

    // 第二遍：对每个 signature 块，保留 head + tail，中间省略
    for (let i = 0; i < lines.length; i++) {
      if (classifyLine(lines[i]) !== "signature") continue;
      const blockEnd = findBlockEnd(lines, i);
      const bodyStart = i + 1;
      const bodyEnd = blockEnd - 1;
      if (bodyEnd <= bodyStart) continue;

      const headEnd = Math.min(bodyStart + FUNCTION_BODY_HEAD - 1, bodyEnd);
      const tailStart = Math.max(headEnd + 1, bodyEnd - FUNCTION_BODY_TAIL + 1);

      for (let j = bodyStart; j <= headEnd; j++) keptIndices.add(j);
      for (let j = tailStart; j <= bodyEnd; j++) keptIndices.add(j);

      const omitted = Math.max(0, tailStart - headEnd - 1);
      if (omitted > 0) {
        omittedBodyLines += omitted;
        omittedBlocks++;
      }
    }

    // 如果没有可省略的块，回退
    if (omittedBodyLines === 0) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "no_omittable_blocks");
    }

    // 按顺序输出
    const keptLines: string[] = [];
    let lastKept = -1;
    for (let i = 0; i < lines.length; i++) {
      if (keptIndices.has(i)) {
        if (lastKept >= 0 && i > lastKept + 1) {
          const gap = i - lastKept - 1;
          if (gap > 0) {
            keptLines.push(`  // [...${gap} lines omitted]`);
          }
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
    const omittedSummary = `省略了 ${omittedBodyLines} 行函数/方法体（跨 ${omittedBlocks} 个块，保留 import/signature/comment 和首尾 ${FUNCTION_BODY_HEAD}/${FUNCTION_BODY_TAIL} 行）`;

    return {
      applied: true,
      strategy: "code-snippet-structure",
      contentType: "code",
      compressedContent,
      originalChars,
      compressedChars,
      originalTokensEstimate,
      compressedTokensEstimate,
      savedTokensEstimate,
      qualityHint: {
        mode: "structure_preserving",
        omittedSummary,
      },
      observability: buildObservabilityRecord({
        request,
        result: {
          applied: true,
          strategy: "code-snippet-structure",
          contentType: "code",
          originalChars,
          compressedChars,
          originalTokensEstimate,
          compressedTokensEstimate,
          savedTokensEstimate,
          qualityHint: { mode: "structure_preserving", omittedSummary },
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
    strategy: "code-snippet-passthrough",
    contentType: "code",
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
        strategy: "code-snippet-passthrough",
        contentType: "code",
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
