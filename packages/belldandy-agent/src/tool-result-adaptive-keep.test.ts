import { describe, expect, it } from "vitest";

import { selectToolMessagesForCompression, type ToolResultAdaptiveKeepMessage } from "./tool-result-adaptive-keep.js";

describe("tool result adaptive keep selection", () => {
  it("keeps the recent tool window while selecting older low-signal outputs", () => {
    const messages = buildToolMessages([
      ["old-1", "run_command", "ordinary output ".repeat(40)],
      ["old-2", "web_fetch", "web content ".repeat(40)],
      ["recent-1", "run_command", "recent output ".repeat(40)],
      ["recent-2", "file_read", "recent file ".repeat(40)],
    ]);
    const selection = selectToolMessagesForCompression({
      messages,
      toolCallNameById: buildToolNameMap(messages),
      keepRecentToolMessages: 2,
    });

    expect(selection.selectedIndices).toEqual([1, 3]);
    expect(selection.decisions.filter((item) => item.reason === "recent_window")).toHaveLength(2);
  });

  it("keeps older failed command output as diagnostic evidence", () => {
    const messages = buildToolMessages([
      ["failed-cmd", "run_command", "Exit code: 1\nERROR test failed\nstack trace".repeat(20)],
      ["old-low", "web_fetch", "ordinary output ".repeat(40)],
      ["recent-1", "run_command", "recent output ".repeat(40)],
      ["recent-2", "file_read", "recent file ".repeat(40)],
    ]);
    const selection = selectToolMessagesForCompression({
      messages,
      toolCallNameById: buildToolNameMap(messages),
      keepRecentToolMessages: 2,
    });

    expect(selection.selectedIndices).toEqual([3]);
    expect(selection.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolName: "run_command",
        action: "keep",
        reason: "failure_or_diagnostic_output",
      }),
    ]));
  });

  it("keeps latest important read result outside the recent window", () => {
    const messages = buildToolMessages([
      ["read-old", "file_read", "src/old.ts\nold content ".repeat(40)],
      ["read-latest", "file_read", "src/current.ts\ncurrent content ".repeat(40)],
      ["old-low", "web_fetch", "ordinary output ".repeat(40)],
      ["recent-1", "run_command", "recent output ".repeat(40)],
    ]);
    const selection = selectToolMessagesForCompression({
      messages,
      toolCallNameById: buildToolNameMap(messages),
      keepRecentToolMessages: 1,
    });

    expect(selection.selectedIndices).toEqual([1, 5]);
    expect(selection.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolCallId: "read-latest",
        action: "keep",
        reason: "latest_important_read_result",
      }),
    ]));
  });

  it("keeps older tool output when later assistant text references its path", () => {
    const messages = buildToolMessages([
      ["search-1", "web_fetch", "Found issue in packages/app/src/index.ts:42\n".repeat(40)],
      ["old-low", "web_fetch", "ordinary output ".repeat(40)],
      ["recent-1", "run_command", "recent output ".repeat(40)],
    ]);
    messages.splice(2, 0, {
      role: "assistant",
      content: "接下来继续检查 packages/app/src/index.ts:42 的调用链。",
    });
    const selection = selectToolMessagesForCompression({
      messages,
      toolCallNameById: buildToolNameMap(messages),
      keepRecentToolMessages: 1,
    });

    expect(selection.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolCallId: "search-1",
        action: "keep",
        reason: "referenced_by_later_assistant",
      }),
    ]));
  });
});

function buildToolMessages(items: Array<[string, string, string]>): ToolResultAdaptiveKeepMessage[] {
  return items.flatMap(([id, name, content]) => [
    {
      role: "assistant" as const,
      content: null,
      tool_calls: [{ id, function: { name } }],
    },
    {
      role: "tool" as const,
      tool_call_id: id,
      content,
    },
  ]);
}

function buildToolNameMap(messages: ToolResultAdaptiveKeepMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const toolCall of message.tool_calls) {
      if (toolCall.id && toolCall.function?.name) {
        map.set(toolCall.id, toolCall.function.name);
      }
    }
  }
  return map;
}
