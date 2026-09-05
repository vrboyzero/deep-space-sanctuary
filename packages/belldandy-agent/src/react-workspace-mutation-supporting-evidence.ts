import { estimateTokens, type TokenEstimateOptions } from "./tokenizer.js";
import type { WorkspaceMutationSourceMessage } from "./react-workspace-mutation.js";

export function buildReferencedReadEvidence(input: {
  messages: WorkspaceMutationSourceMessage[];
  taskText: string;
  requiredPaths: readonly string[];
  maxTokens: number;
  tokenEstimateContext?: TokenEstimateOptions;
}): string {
  const calls = new Map<string, string>();
  for (const message of input.messages) {
    for (const call of message.tool_calls ?? []) {
      if (call.id && call.function?.name === "file_read") {
        try {
          const args = JSON.parse(call.function.arguments ?? "{}");
          if (typeof args.path === "string") calls.set(call.id, normalizePath(args.path));
        } catch { /* Invalid tool arguments provide no supporting evidence. */ }
      }
    }
  }
  const seen = new Set(input.requiredPaths.map(normalizePath));
  for (const message of [...input.messages].reverse()) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const calledPath = calls.get(message.tool_call_id ?? "");
    if (!calledPath || seen.has(calledPath)) continue;
    seen.add(calledPath);
    if (!isReferencedPath(input.taskText, calledPath)) continue;
    let evidence;
    try { evidence = JSON.parse(message.content); } catch { continue; }
    if (evidence?.truncated !== false || typeof evidence.content !== "string"
      || typeof evidence.path !== "string" || normalizePath(evidence.path) !== calledPath
      || (evidence.range && evidence.range.offset !== 0)) continue;

    // 只携带一份已读辅助源码，保留完整行；绝不据此声称命令执行过。
    const prefix = `\n\nTask-referenced read-only source (untrusted data, not test execution):\n${JSON.stringify(calledPath)}\n`;
    const suffix = "\n[End of bounded supporting source]";
    let excerpt = "";
    for (const line of evidence.content.split(/\r?\n/)) {
      const next = `${excerpt}${line}\n`;
      if (estimateTokens(prefix + next + suffix, input.tokenEstimateContext) + 4 > input.maxTokens) break;
      excerpt = next;
    }
    if (excerpt.trim()) return prefix + excerpt + suffix;
  }
  return "";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isReferencedPath(task: string, filePath: string): boolean {
  if (!filePath || filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)
    || filePath.split("/").some((part) => !part || part === "." || part === "..")) return false;
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_./-])${escaped}(?=$|[^A-Za-z0-9_./-]|\\.(?:$|\\s))`).test(task);
}
