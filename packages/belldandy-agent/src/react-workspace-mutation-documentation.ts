const MAX_LEADING_DOCUMENTATION_CHARS = 1_024;

export function readClippedLeadingDocumentation(source: string, contextStart: number, matchIndex: number): string | undefined {
  if (contextStart <= 0 || matchIndex < contextStart) return undefined;
  const lineEnd = source.indexOf("\n", contextStart);
  const firstLine = source.slice(contextStart, lineEnd < 0 ? source.length : lineEnd);
  if (!/^\s*\*(?!\/)/.test(firstLine)) return undefined;
  const lowerBound = Math.max(0, contextStart - MAX_LEADING_DOCUMENTATION_CHARS);
  const prefix = source.slice(lowerBound, contextStart);
  const opening = prefix.lastIndexOf("/**");
  if (opening < 0 || prefix.includes("*/", opening)) return undefined;
  const commentStart = lowerBound + opening;
  const commentEnd = source.indexOf("*/", contextStart);
  if (commentEnd < 0 || commentEnd + 2 > matchIndex
    || commentEnd + 2 - commentStart > MAX_LEADING_DOCUMENTATION_CHARS) return undefined;
  const beforeOpening = source.slice(source.lastIndexOf("\n", commentStart - 1) + 1, commentStart);
  if (beforeOpening.trim()) return undefined;
  // 只补齐标准逐行文档注释；超长或无法确认的片段仍保留原有源码窗口。
  const commentBody = source.slice(commentStart + 3, commentEnd);
  if (!commentBody.split(/\r?\n/).every((line, index) => index === 0 || !line.trim() || /^\s*\*/.test(line))) return undefined;
  return source.slice(commentStart, contextStart);
}
