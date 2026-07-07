export type ToolResultAdaptiveKeepMessage =
  | { role: "system"; content?: unknown }
  | { role: "user"; content?: unknown }
  | { role: "assistant"; content?: unknown; tool_calls?: Array<{ id: string; function?: { name?: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolResultCompressionDecision = {
  messageIndex: number;
  toolCallId: string;
  toolName: string;
  contentChars: number;
  action: "compress" | "keep";
  reason: string;
};

export type ToolResultCompressionSelection = {
  adaptive: boolean;
  keepRecentToolMessages: number;
  toolMessageCount: number;
  selectedIndices: number[];
  decisions: ToolResultCompressionDecision[];
};

const IMPORTANT_READ_TOOLS = new Set([
  "file_read",
  "conversation_read",
  "retrieve_tool_result",
  "log_read",
  "browser_get_content",
]);

const FAILURE_TOOL_NAMES = new Set([
  "run_command",
  "log_search",
  "log_read",
]);

const FAILURE_PATTERN = /\b(error|failed|failure|exception|traceback|assertionerror|exit code:\s*[1-9]|tests?\s+failed|失败|报错|异常)\b/i;
const PATH_PATTERN = /(?:[A-Za-z]:[\\/][^\s"'<>]+|(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+(?::\d+)?)/g;

export function selectToolMessagesForCompression(input: {
  messages: ToolResultAdaptiveKeepMessage[];
  toolCallNameById: Map<string, string>;
  keepRecentToolMessages?: number;
  adaptive?: boolean;
}): ToolResultCompressionSelection {
  const keepRecentToolMessages = Math.max(0, Math.floor(input.keepRecentToolMessages ?? 4));
  const adaptive = input.adaptive !== false;
  const toolMessageIndices = collectToolMessageIndices(input.messages);
  const compactUntil = Math.max(0, toolMessageIndices.length - keepRecentToolMessages);
  const recentImportantReadIndexByTool = collectRecentImportantReadIndexByTool({
    messages: input.messages,
    toolMessageIndices,
    toolCallNameById: input.toolCallNameById,
    compactUntil,
  });
  const selectedIndices: number[] = [];
  const decisions: ToolResultCompressionDecision[] = [];

  for (let i = 0; i < compactUntil; i++) {
    const messageIndex = toolMessageIndices[i];
    const message = input.messages[messageIndex];
    if (!message || message.role !== "tool") continue;

    const toolName = input.toolCallNameById.get(message.tool_call_id) ?? "unknown";
    const keepReason = adaptive
      ? resolveAdaptiveKeepReason({
        messages: input.messages,
        messageIndex,
        toolName,
        content: message.content,
        recentImportantReadIndexByTool,
      })
      : undefined;

    if (keepReason) {
      decisions.push({
        messageIndex,
        toolCallId: message.tool_call_id,
        toolName,
        contentChars: message.content.length,
        action: "keep",
        reason: keepReason,
      });
      continue;
    }

    selectedIndices.push(messageIndex);
    decisions.push({
      messageIndex,
      toolCallId: message.tool_call_id,
      toolName,
      contentChars: message.content.length,
      action: "compress",
      reason: adaptive ? "older_low_signal" : "older_than_recent_window",
    });
  }

  for (let i = compactUntil; i < toolMessageIndices.length; i++) {
    const messageIndex = toolMessageIndices[i];
    const message = input.messages[messageIndex];
    if (!message || message.role !== "tool") continue;
    decisions.push({
      messageIndex,
      toolCallId: message.tool_call_id,
      toolName: input.toolCallNameById.get(message.tool_call_id) ?? "unknown",
      contentChars: message.content.length,
      action: "keep",
      reason: "recent_window",
    });
  }

  return {
    adaptive,
    keepRecentToolMessages,
    toolMessageCount: toolMessageIndices.length,
    selectedIndices,
    decisions,
  };
}

function collectToolMessageIndices(messages: ToolResultAdaptiveKeepMessage[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "tool") {
      indices.push(i);
    }
  }
  return indices;
}

function collectRecentImportantReadIndexByTool(input: {
  messages: ToolResultAdaptiveKeepMessage[];
  toolMessageIndices: number[];
  toolCallNameById: Map<string, string>;
  compactUntil: number;
}): Map<string, number> {
  const result = new Map<string, number>();
  for (let i = 0; i < input.compactUntil; i++) {
    const messageIndex = input.toolMessageIndices[i];
    const message = input.messages[messageIndex];
    if (!message || message.role !== "tool") continue;
    const toolName = input.toolCallNameById.get(message.tool_call_id) ?? "unknown";
    if (IMPORTANT_READ_TOOLS.has(toolName)) {
      result.set(toolName, messageIndex);
    }
  }
  return result;
}

function resolveAdaptiveKeepReason(input: {
  messages: ToolResultAdaptiveKeepMessage[];
  messageIndex: number;
  toolName: string;
  content: string;
  recentImportantReadIndexByTool: Map<string, number>;
}): string | undefined {
  if (FAILURE_TOOL_NAMES.has(input.toolName) && FAILURE_PATTERN.test(input.content)) {
    return "failure_or_diagnostic_output";
  }

  if (input.recentImportantReadIndexByTool.get(input.toolName) === input.messageIndex) {
    return "latest_important_read_result";
  }

  if (isReferencedByLaterAssistant(input.messages, input.messageIndex, input.content)) {
    return "referenced_by_later_assistant";
  }

  return undefined;
}

function isReferencedByLaterAssistant(
  messages: ToolResultAdaptiveKeepMessage[],
  messageIndex: number,
  content: string,
): boolean {
  const paths = extractPathSignals(content);
  if (paths.length === 0) return false;
  const laterAssistantText = messages
    .slice(messageIndex + 1)
    .filter((message): message is Extract<ToolResultAdaptiveKeepMessage, { role: "assistant" }> => message.role === "assistant")
    .map((message) => typeof message.content === "string" ? message.content : "")
    .join("\n");
  if (!laterAssistantText) return false;
  return paths.some((path) => laterAssistantText.includes(path));
}

function extractPathSignals(content: string): string[] {
  const matches = content.match(PATH_PATTERN) ?? [];
  return Array.from(new Set(matches.map((value) => value.trim()).filter((value) => value.length >= 6))).slice(0, 12);
}
