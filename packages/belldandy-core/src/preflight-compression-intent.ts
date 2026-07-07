export type PreflightCompressionTaskIntent =
  | "summary"
  | "precision"
  | "debug"
  | "default";

export type PreflightCompressionIntentDecision = {
  taskIntent: PreflightCompressionTaskIntent;
  precisionRequired: boolean;
  matchedKeywords: string[];
};

const SUMMARY_KEYWORDS = [
  "总结",
  "概括",
  "提炼",
  "摘要",
  "overview",
  "summarize",
  "summary",
];

const PRECISION_KEYWORDS = [
  "逐字",
  "全文",
  "完整",
  "精确",
  "核对",
  "校对",
  "原文",
  "表格",
  "数字",
  "代码",
  "字段",
  "路径",
  "行号",
  "line",
  "path",
  "exact",
  "verbatim",
  "full text",
];

const DEBUG_KEYWORDS = [
  "报错",
  "异常",
  "堆栈",
  "失败",
  "错误行",
  "error",
  "stack",
  "trace",
  "failed",
  "exception",
  "test failed",
];

export function classifyPreflightCompressionIntent(text: string): PreflightCompressionIntentDecision {
  const normalized = text.toLowerCase();
  const precisionMatches = collectKeywordMatches(normalized, PRECISION_KEYWORDS);
  const debugMatches = collectKeywordMatches(normalized, DEBUG_KEYWORDS);
  const summaryMatches = collectKeywordMatches(normalized, SUMMARY_KEYWORDS);

  if (precisionMatches.length > 0) {
    return {
      taskIntent: "precision",
      precisionRequired: true,
      matchedKeywords: precisionMatches,
    };
  }

  if (debugMatches.length > 0) {
    return {
      taskIntent: "debug",
      precisionRequired: true,
      matchedKeywords: debugMatches,
    };
  }

  if (summaryMatches.length > 0) {
    return {
      taskIntent: "summary",
      precisionRequired: false,
      matchedKeywords: summaryMatches,
    };
  }

  return {
    taskIntent: "default",
    precisionRequired: false,
    matchedKeywords: [],
  };
}

function collectKeywordMatches(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
}
