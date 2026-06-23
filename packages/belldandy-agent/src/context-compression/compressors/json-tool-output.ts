/**
 * JSON 工具输出压缩器 — 结构保留，截断大值（Phase 2）
 *
 * 策略：
 * - JSON.parse 成功后做结构保留压缩
 * - 保留所有 key 名（结构骨架）
 * - 截断超长 string 值（> maxStringValueChars 时截断并附 [truncated:N chars]）
 * - 数组保留前 N 个元素，超出部分用 `[...N more items]` 占位
 * - 嵌套深度超过 maxDepth 时用 `<object:depth=N keys=[...]>` 占位
 * - 保留数字、布尔、null 原值
 * - 生成 omittedSummary
 *
 * 可逆性：当 ctx.referenceStore 可用时，原文已由 pipeline 统一存储，此处不重复存储。
 */

import type {
  CompressionContentType,
  CompressionExecutionContext,
  CompressionRequest,
  CompressionResult,
  ContextCompressor,
} from "../types.js";
import { buildObservabilityRecord } from "../observability.js";

const MAX_STRING_VALUE_CHARS = 200;
const MAX_ARRAY_INLINE_ITEMS = 8;
const MAX_DEPTH = 6;
const MIN_COMPRESSABLE_CHARS = 600;

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function truncateString(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const kept = value.slice(0, Math.max(0, limit - 24));
  const omitted = value.length - kept.length;
  return `${kept}…[truncated:${omitted} chars]`;
}

/**
 * 递归压缩 JSON 值。
 * 返回 { value: 压缩后的值, truncatedValues, truncatedArrays, depthCapped }
 */
function compressJsonValue(
  value: unknown,
  depth: number,
  stats: { truncatedValues: number; truncatedArrays: number; depthCapped: number },
): unknown {
  if (depth > MAX_DEPTH) {
    stats.depthCapped++;
    if (value === null) return null;
    if (typeof value === "object") {
      const keys = Array.isArray(value) ? [] : Object.keys(value as object).slice(0, 8);
      return Array.isArray(value)
        ? `<array:depth=${depth} len=${value.length}>`
        : `<object:depth=${depth} keys=[${keys.join(",")}]>`;
    }
    return value;
  }

  if (typeof value === "string") {
    if (value.length > MAX_STRING_VALUE_CHARS) {
      stats.truncatedValues++;
      return truncateString(value, MAX_STRING_VALUE_CHARS);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length <= MAX_ARRAY_INLINE_ITEMS) {
      return value.map((item) => compressJsonValue(item, depth + 1, stats));
    }
    stats.truncatedArrays++;
    const kept = value.slice(0, MAX_ARRAY_INLINE_ITEMS).map((item) => compressJsonValue(item, depth + 1, stats));
    return [...kept, `[...${value.length - MAX_ARRAY_INLINE_ITEMS} more items]`];
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) {
      result[k] = compressJsonValue(v, depth + 1, stats);
    }
    return result;
  }

  return value;
}

export class JsonToolOutputCompressor implements ContextCompressor {
  readonly name = "json-tool-output";

  supports(type: CompressionContentType): boolean {
    return type === "json";
  }

  async compress(request: CompressionRequest, _ctx: CompressionExecutionContext): Promise<CompressionResult> {
    const content = request.content;
    const originalChars = content.length;
    const originalTokensEstimate = estimateTokensApprox(content);

    if (originalChars < MIN_COMPRESSABLE_CHARS) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "content_too_short");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "json_parse_failed");
    }

    const stats = { truncatedValues: 0, truncatedArrays: 0, depthCapped: 0 };
    const compressed = compressJsonValue(parsed, 0, stats);

    if (stats.truncatedValues === 0 && stats.truncatedArrays === 0 && stats.depthCapped === 0) {
      // 没有可压缩点
      return buildPassthrough(request, originalChars, originalTokensEstimate, "no_compressible_values");
    }

    let compressedContent: string;
    try {
      compressedContent = JSON.stringify(compressed, null, 2);
    } catch {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "json_stringify_failed");
    }

    const compressedChars = compressedContent.length;
    const compressedTokensEstimate = estimateTokensApprox(compressedContent);

    if (compressedChars >= originalChars * 0.85) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "insufficient_savings");
    }

    const savedTokensEstimate = Math.max(0, originalTokensEstimate - compressedTokensEstimate);
    const summaryParts: string[] = [];
    if (stats.truncatedValues > 0) summaryParts.push(`截断了 ${stats.truncatedValues} 个超长字符串值`);
    if (stats.truncatedArrays > 0) summaryParts.push(`截断了 ${stats.truncatedArrays} 个长数组`);
    if (stats.depthCapped > 0) summaryParts.push(`深度超过 ${MAX_DEPTH} 的 ${stats.depthCapped} 个节点被占位`);
    const omittedSummary = summaryParts.join("；") || undefined;

    return {
      applied: true,
      strategy: "json-tool-output-structure",
      contentType: "json",
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
          strategy: "json-tool-output-structure",
          contentType: "json",
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
    strategy: "json-tool-output-passthrough",
    contentType: "json",
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
        strategy: "json-tool-output-passthrough",
        contentType: "json",
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
