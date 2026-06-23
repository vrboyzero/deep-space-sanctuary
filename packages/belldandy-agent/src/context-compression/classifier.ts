/**
 * 内容分类器（规则型）
 *
 * 依据 headroom §13.3 的规则型检测方案：
 * - 以 { 或 [ 开头且可 JSON.parse -> json
 * - 多行且包含时间戳 / log level -> log
 * - 含 path:line: / rg / grep 结构 -> search
 * - 含函数签名 / import / class 等明显结构 -> code
 * - 其他长文本 -> plain_text
 */

import type { CompressionContentType, CompressionSourceKind } from "./types.js";

const LOG_LEVEL_RE = /\b(ERROR|WARN(ING)?|INFO|DEBUG|TRACE|FATAL)\b/i;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2}\.\d+/;
const SEARCH_RESULT_RE = /^(.+?):(\d+):/m;
const GREP_RG_RE = /\b(rg|grep|ripgrep)\b/i;
const CODE_SIGNATURE_RE = /^\s*(import|export|function|class|def |const |let |var |public |private |async )\b/m;
const CODE_BRACE_RE = /\{\s*[^}]*\}|=>|;\s*$/m;

function tryParseJson(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function detectContentType(input: {
  content: string;
  sourceKind: CompressionSourceKind;
  metadata?: Record<string, unknown>;
  hint?: CompressionContentType;
}): CompressionContentType {
  // 优先使用 hint
  if (input.hint && input.hint !== "unknown") return input.hint;

  const content = input.content;
  if (!content || !content.trim()) return "unknown";

  // sourceKind 强信号
  if (input.sourceKind === "code_snippet" || input.sourceKind === "file_read") {
    if (CODE_SIGNATURE_RE.test(content)) return "code";
  }

  // JSON 检测
  if (tryParseJson(content)) return "json";

  const lineCount = content.split("\n").length;

  // 日志检测：多行 + 包含 log level 或时间戳
  if (lineCount >= 3 && (LOG_LEVEL_RE.test(content) || TIMESTAMP_RE.test(content))) {
    return "log";
  }

  // 搜索结果检测：path:line: 格式或包含 grep/rg
  if (SEARCH_RESULT_RE.test(content) || GREP_RG_RE.test(content)) {
    return "search";
  }

  // 代码检测：包含明显的代码结构
  if (CODE_SIGNATURE_RE.test(content) || (lineCount >= 3 && CODE_BRACE_RE.test(content))) {
    return "code";
  }

  // markdown 检测：包含标题/列表等
  if (/^#{1,6}\s/m.test(content) || /^\s*[-*]\s/m.test(content)) {
    return "markdown";
  }

  return "plain_text";
}

/** 默认分类器实例 */
export const defaultClassifier = { detect: detectContentType };
