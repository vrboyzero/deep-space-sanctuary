const FILE_PATH_SIGNAL_REGEX = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?(?:[\w@.-]+[\\/])+[\w@.-]+\.[A-Za-z0-9]{1,8}/;
const ERROR_SIGNAL_REGEX = /\b(error|failed|failure|exception|traceback|stack trace|enoent|econnrefused|econnreset|timed? out|timeout|context_length_exceeded|ts\d{4}|http\s*[45]\d{2})\b|错误|失败|异常|报错|未找到|超时|崩溃/i;
const PATCH_SIGNAL_REGEX = /\b(apply_patch|patch|diff|hunk|git diff|file_write|file_delete|edit_file)\b|补丁|修复|修改|变更|差异/i;

const DEFAULT_PIN_LOOKBACK_MESSAGES = 8;
const DEFAULT_PIN_LOOKBACK_TOOL_MESSAGES = 4;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function hasImportantPinSignal(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return FILE_PATH_SIGNAL_REGEX.test(normalized)
    || ERROR_SIGNAL_REGEX.test(normalized)
    || PATCH_SIGNAL_REGEX.test(normalized);
}

export function resolvePinnedConversationTailStart(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  baseKeepRecentCount: number,
  lookbackMessages: number = DEFAULT_PIN_LOOKBACK_MESSAGES,
): number | undefined {
  if (messages.length <= baseKeepRecentCount) {
    return undefined;
  }

  const splitIndex = messages.length - baseKeepRecentCount;
  const scanStart = Math.max(0, splitIndex - Math.max(0, Math.floor(lookbackMessages)));

  for (let index = splitIndex - 1; index >= scanStart; index -= 1) {
    if (hasImportantPinSignal(messages[index]?.content ?? "")) {
      const pairedIndex = index > 0 ? index - 1 : index;
      return Math.max(scanStart, pairedIndex);
    }
  }

  return undefined;
}

export function resolvePinnedToolCompactionLimit(input: {
  messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
  toolMessageIndices: number[];
  toolCallNameById: Map<string, string>;
  keepRecentToolMessages: number;
  compactUntil: number;
  lookbackMessages?: number;
}): number {
  const lookbackMessages = Math.max(0, Math.floor(input.lookbackMessages ?? DEFAULT_PIN_LOOKBACK_TOOL_MESSAGES));
  if (input.compactUntil <= 0 || lookbackMessages <= 0 || input.toolMessageIndices.length <= 1) {
    return input.compactUntil;
  }

  const scanStart = Math.max(0, input.compactUntil - lookbackMessages);
  for (let toolIndex = input.compactUntil - 1; toolIndex >= scanStart; toolIndex -= 1) {
    const messageIndex = input.toolMessageIndices[toolIndex];
    const message = input.messages[messageIndex];
    if (!message || typeof message.content !== "string") {
      continue;
    }
    const toolName = input.toolCallNameById.get(message.tool_call_id ?? "") ?? "";
    if (hasImportantPinSignal(message.content) || toolName.startsWith("memory_")) {
      return toolIndex;
    }
  }

  return input.compactUntil;
}
