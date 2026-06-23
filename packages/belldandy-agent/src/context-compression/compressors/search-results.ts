/**
 * 搜索结果压缩器 — 按文件聚合，保留 top-N 匹配
 *
 * 策略：
 * - 识别 `path:line:content` 格式的搜索结果
 * - 按文件路径聚合
 * - 每文件保留前 N 条匹配
 * - 保留含 error/config/entrypoint 等高价值线索的行
 * - 生成省略文件列表摘要
 */

import type {
  CompressionContentType,
  CompressionExecutionContext,
  CompressionRequest,
  CompressionResult,
  ContextCompressor,
} from "../types.js";
import { buildObservabilityRecord } from "../observability.js";

const SEARCH_LINE_RE = /^(.+?):(\d+):(.*)$/;
const HIGH_VALUE_RE = /\b(error|config|entrypoint|main|index|init|setup|test|fix|bug|todo|hack)\b/i;
const MAX_MATCHES_PER_FILE = 5;
const MAX_TOTAL_FILES = 30;

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3.5);
}

type FileGroup = {
  path: string;
  lines: Array<{ lineNo: number; content: string }>;
};

export class SearchResultsCompressor implements ContextCompressor {
  readonly name = "search-results";

  supports(type: CompressionContentType): boolean {
    return type === "search";
  }

  async compress(request: CompressionRequest, _ctx: CompressionExecutionContext): Promise<CompressionResult> {
    const content = request.content;
    const originalChars = content.length;
    const originalTokensEstimate = estimateTokensApprox(content);

    const lines = content.split("\n");
    const groups = new Map<string, FileGroup>();
    const nonSearchLines: string[] = [];

    for (const line of lines) {
      const match = line.match(SEARCH_LINE_RE);
      if (match) {
        const [, path, lineNoStr, lineContent] = match;
        const lineNo = Number(lineNoStr);
        let group = groups.get(path);
        if (!group) {
          group = { path, lines: [] };
          groups.set(path, group);
        }
        group.lines.push({ lineNo, content: lineContent });
      } else {
        nonSearchLines.push(line);
      }
    }

    // 如果没有识别到搜索结果格式，回退
    if (groups.size === 0) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "no_search_format_detected");
    }

    // 按文件聚合，每文件保留 top-N
    const sortedPaths = Array.from(groups.keys()).sort();
    const keptPaths: string[] = [];
    const omittedPaths: string[] = [];
    const outputParts: string[] = [];

    for (const path of sortedPaths) {
      if (keptPaths.length >= MAX_TOTAL_FILES) {
        omittedPaths.push(path);
        continue;
      }
      const group = groups.get(path)!;
      // 优先保留高价值行
      const sorted = group.lines.sort((a, b) => {
        const aHigh = HIGH_VALUE_RE.test(a.content) ? 0 : 1;
        const bHigh = HIGH_VALUE_RE.test(b.content) ? 0 : 1;
        if (aHigh !== bHigh) return aHigh - bHigh;
        return a.lineNo - b.lineNo;
      });
      const kept = sorted.slice(0, MAX_MATCHES_PER_FILE);
      const omittedCount = group.lines.length - kept.length;

      keptPaths.push(path);
      outputParts.push(`--- ${path} (${kept.length}/${group.lines.length} matches${omittedCount > 0 ? `, ${omittedCount} omitted` : ""}) ---`);
      for (const match of kept) {
        outputParts.push(`${path}:${match.lineNo}:${match.content}`);
      }
    }

    // 保留非搜索行（通常是摘要或 header）
    if (nonSearchLines.length > 0) {
      outputParts.unshift(nonSearchLines.slice(0, 5).join("\n"));
    }

    const omittedSummaryParts: string[] = [];
    if (omittedPaths.length > 0) {
      omittedSummaryParts.push(`省略了 ${omittedPaths.length} 个文件的搜索结果（共保留 ${keptPaths.length} 个文件）`);
    }
    const totalOmittedMatches = sortedPaths.reduce((sum, path) => {
      const group = groups.get(path)!;
      return sum + Math.max(0, group.lines.length - MAX_MATCHES_PER_FILE);
    }, 0);
    if (totalOmittedMatches > 0) {
      omittedSummaryParts.push(`省略了 ${totalOmittedMatches} 条低优先级匹配`);
    }
    const omittedSummary = omittedSummaryParts.join("；") || undefined;

    const compressedContent = outputParts.join("\n");
    const compressedChars = compressedContent.length;
    const compressedTokensEstimate = estimateTokensApprox(compressedContent);

    if (compressedChars >= originalChars * 0.85) {
      return buildPassthrough(request, originalChars, originalTokensEstimate, "insufficient_savings");
    }

    const savedTokensEstimate = Math.max(0, originalTokensEstimate - compressedTokensEstimate);

    return {
      applied: true,
      strategy: "search-results-aggregate",
      contentType: "search",
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
          strategy: "search-results-aggregate",
          contentType: "search",
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
    strategy: "search-results-passthrough",
    contentType: "search",
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
        strategy: "search-results-passthrough",
        contentType: "search",
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
