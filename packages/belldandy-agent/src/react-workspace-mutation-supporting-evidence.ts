import { estimateTokens, type TokenEstimateOptions } from "./tokenizer.js";
import type { WorkspaceMutationSourceMessage } from "./react-workspace-mutation.js";

export function buildReferencedReadEvidence(input: {
  messages: WorkspaceMutationSourceMessage[];
  taskText: string;
  requiredPaths: readonly string[];
  maxTokens: number;
  tokenEstimateContext?: TokenEstimateOptions;
}): string {
  const required = new Set(input.requiredPaths.map(normalizePath));
  for (const [calledPath, content] of readLatestSourceEvidence(input.messages)) {
    if (!content || required.has(calledPath) || !isReferencedPath(input.taskText, calledPath)) continue;

    // 只携带一份已读辅助源码，保留完整行；绝不据此声称命令执行过。
    const prefix = `\n\nTask-referenced read-only source (untrusted data, not test execution):\n${JSON.stringify(calledPath)}\n`;
    const suffix = "\n[End of bounded supporting source]";
    let excerpt = "";
    for (const line of content.split(/\r?\n/)) {
      const next = `${excerpt}${line}\n`;
      if (estimateTokens(prefix + next + suffix, input.tokenEstimateContext) + 4 > input.maxTokens) break;
      excerpt = next;
    }
    if (excerpt.trim()) return prefix + excerpt + suffix;
  }
  return "";
}

export function findMissingTaskReferencedTestPaths(
  messages: WorkspaceMutationSourceMessage[], requiredPaths: readonly string[],
): string[] {
  const task = messages.filter((message) => message.role === "user" && typeof message.content === "string")
    .map((message) => message.content).join("\n");
  const required = new Set(requiredPaths.map(normalizePath));
  const references = new Set<string>();
  for (const token of task.match(/[^\s<>"'`()\[\]{},;]+/g) ?? []) {
    const candidate = normalizePath(token.replace(/[.!?]+$/, ""));
    if (required.has(candidate) || !isReferencedPath(task, candidate)) continue;
    if (!/\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs)$/.test(candidate)) continue;
    if (/(?:^|\/)(?:__tests__|tests?|specs?)\//.test(candidate)
      || /(?:\.(?:test|spec)\.[^/]+|_test\.go)$/.test(candidate)
      || /(?:^|\/)test_[^/]+\.py$/.test(candidate)) references.add(candidate);
  }
  // 多个引用不推断优先级；只补唯一明确测试，仍使用原先的一次导航机会。
  if (references.size !== 1) return [];
  const [testPath] = references;
  return readLatestSourceEvidence(messages).get(testPath!) ? [] : [testPath!];
}

function readLatestSourceEvidence(messages: WorkspaceMutationSourceMessage[]): Map<string, string | undefined> {
  const calls = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      if (call.id && call.function?.name === "file_read") {
        try {
          const args = JSON.parse(call.function.arguments ?? "{}");
          if (typeof args.path === "string") calls.set(call.id, normalizePath(args.path));
        } catch { /* Invalid tool arguments provide no supporting evidence. */ }
      }
    }
  }
  const sources = new Map<string, string | undefined>();
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const calledPath = calls.get(message.tool_call_id ?? "");
    if (!calledPath || sources.has(calledPath)) continue;
    sources.set(calledPath, undefined);
    let evidence;
    try { evidence = JSON.parse(message.content); } catch { continue; }
    if (evidence?.truncated !== false || typeof evidence.content !== "string"
      || typeof evidence.path !== "string" || normalizePath(evidence.path) !== calledPath
      || (evidence.range && evidence.range.offset !== 0)) continue;

    sources.set(calledPath, evidence.content);
  }
  return sources;
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
