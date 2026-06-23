import { resolvePinnedToolCompactionLimit } from "./pinning.js";
import { isAnyCompactedContent } from "./context-compression/marker.js";

export type MicrocompactOptions = {
  enabled?: boolean;
  keepRecentToolMessages?: number;
  compactableToolNames?: string[];
  minOutputChars?: number;
  maxDigestChars?: number;
  /** 为了保持前缀缓存稳定性，禁止原地改写旧 tool message */
  preservePrefixStability?: boolean;
};

export type MicrocompactMessage =
  | { role: "system"; content?: unknown }
  | { role: "user"; content?: unknown }
  | { role: "assistant"; content?: unknown; tool_calls?: Array<{ id: string; function?: { name?: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export type MicrocompactResult = {
  mutated: boolean;
  compactedCount: number;
  reclaimedChars: number;
  skippedForPrefixStability: boolean;
};

const DEFAULT_KEEP_RECENT_TOOL_MESSAGES = 4;
const DEFAULT_MIN_OUTPUT_CHARS = 240;
const DEFAULT_MAX_DIGEST_CHARS = 180;
const DEFAULT_COMPACTABLE_TOOL_NAMES = new Set([
  "run_command",
  "file_read",
  "list_files",
  "web_fetch",
]);

function isAlreadyMicrocompacted(content: string): boolean {
  // 优先识别 microcompact 自身标记
  if (content.startsWith("[old tool output cleared]") || content.startsWith("[old tool error summary preserved]")) {
    return true;
  }
  // 同时识别统一压缩层的标记（Phase 1 [compressed tool output] + Phase 2 [compressed-ref ...]），
  // 避免 microcompact 二次压缩已压缩内容，覆盖 reference marker
  return isAnyCompactedContent(content);
}

function summarizeContent(content: string, maxDigestChars: number): string {
  const normalized = content
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "no significant output recorded";
  if (normalized.length <= maxDigestChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxDigestChars - 3))}...`;
}

function isCompactableToolName(toolName: string, options?: MicrocompactOptions): boolean {
  if (!toolName) return false;
  if (Array.isArray(options?.compactableToolNames) && options.compactableToolNames.length > 0) {
    return options.compactableToolNames.includes(toolName);
  }
  return DEFAULT_COMPACTABLE_TOOL_NAMES.has(toolName);
}

function buildCompactedToolContent(toolName: string, content: string, maxDigestChars: number): string {
  const summary = summarizeContent(content, maxDigestChars);
  if (/^错误[:：]/.test(content.trim())) {
    return [
      "[old tool error summary preserved]",
      `tool=${toolName}`,
      `error=${summary}`,
    ].join("\n");
  }
  return [
    "[old tool output cleared]",
    `tool=${toolName}`,
    `result=${summary}`,
  ].join("\n");
}

function shouldCompactToolMessage(input: {
  messages: MicrocompactMessage[];
  messageIndex: number;
  toolCallNameById: Map<string, string>;
  options?: MicrocompactOptions;
}): { toolName: string; content: string } | undefined {
  const message = input.messages[input.messageIndex];
  if (!message || message.role !== "tool") return undefined;
  if (typeof message.content !== "string" || !message.content.trim()) return undefined;
  if (isAlreadyMicrocompacted(message.content)) return undefined;

  const minOutputChars = Math.max(32, Math.floor(input.options?.minOutputChars ?? DEFAULT_MIN_OUTPUT_CHARS));
  if (message.content.length < minOutputChars) return undefined;

  const toolName = input.toolCallNameById.get(message.tool_call_id) ?? "";
  if (!isCompactableToolName(toolName, input.options)) return undefined;

  return {
    toolName,
    content: message.content,
  };
}

export function microcompactMessages(
  messages: MicrocompactMessage[],
  options?: MicrocompactOptions,
): MicrocompactResult {
  if (options?.enabled === false || messages.length === 0) {
    return {
      mutated: false,
      compactedCount: 0,
      reclaimedChars: 0,
      skippedForPrefixStability: false,
    };
  }

  const keepRecentToolMessages = Math.max(0, Math.floor(options?.keepRecentToolMessages ?? DEFAULT_KEEP_RECENT_TOOL_MESSAGES));
  const maxDigestChars = Math.max(48, Math.floor(options?.maxDigestChars ?? DEFAULT_MAX_DIGEST_CHARS));
  const toolCallNameById = new Map<string, string>();
  const toolMessageIndices: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const toolName = typeof toolCall?.function?.name === "string" ? toolCall.function.name : "";
        if (toolName && typeof toolCall?.id === "string" && toolCall.id) {
          toolCallNameById.set(toolCall.id, toolName);
        }
      }
      continue;
    }

    if (message.role === "tool") {
      toolMessageIndices.push(i);
    }
  }

  const compactUntil = Math.max(0, toolMessageIndices.length - keepRecentToolMessages);
  const effectiveCompactUntil = resolvePinnedToolCompactionLimit({
    messages,
    toolMessageIndices,
    toolCallNameById,
    keepRecentToolMessages,
    compactUntil,
  });
  if (options?.preservePrefixStability) {
    const hasCompactionCandidate = Array.from({ length: effectiveCompactUntil }).some((_, index) =>
      Boolean(shouldCompactToolMessage({
        messages,
        messageIndex: toolMessageIndices[index],
        toolCallNameById,
        options,
      })));
    return {
      mutated: false,
      compactedCount: 0,
      reclaimedChars: 0,
      skippedForPrefixStability: hasCompactionCandidate,
    };
  }
  let compactedCount = 0;
  let reclaimedChars = 0;

  for (let i = 0; i < effectiveCompactUntil; i++) {
    const messageIndex = toolMessageIndices[i];
    const candidate = shouldCompactToolMessage({
      messages,
      messageIndex,
      toolCallNameById,
      options,
    });
    const message = messages[messageIndex];
    if (!candidate || !message || message.role !== "tool") continue;

    const compacted = buildCompactedToolContent(candidate.toolName, candidate.content, maxDigestChars);
    if (compacted.length >= candidate.content.length) continue;

    reclaimedChars += candidate.content.length - compacted.length;
    compactedCount += 1;
    message.content = compacted;
  }

  return {
    mutated: compactedCount > 0,
    compactedCount,
    reclaimedChars,
    skippedForPrefixStability: false,
  };
}
