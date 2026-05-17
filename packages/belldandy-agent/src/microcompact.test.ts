import { describe, expect, it } from "vitest";
import { microcompactMessages } from "./microcompact.js";

describe("microcompactMessages", () => {
  it("clears old noisy tool outputs while preserving the recent tool window", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "reading file",
        tool_calls: [{ id: "call-1", function: { name: "file_read" } }],
      },
      { role: "tool" as const, tool_call_id: "call-1", content: "A".repeat(600) },
      {
        role: "assistant" as const,
        content: "running command",
        tool_calls: [{ id: "call-2", function: { name: "run_command" } }],
      },
      { role: "tool" as const, tool_call_id: "call-2", content: "B".repeat(600) },
      {
        role: "assistant" as const,
        content: "latest fetch",
        tool_calls: [{ id: "call-3", function: { name: "web_fetch" } }],
      },
      { role: "tool" as const, tool_call_id: "call-3", content: "C".repeat(600) },
    ];

    const result = microcompactMessages(messages, {
      keepRecentToolMessages: 1,
    });

    expect(result).toMatchObject({
      mutated: true,
      compactedCount: 2,
      skippedForPrefixStability: false,
    });
    expect(result.reclaimedChars).toBeGreaterThan(0);
    expect(messages[1]).toMatchObject({
      role: "tool",
      content: expect.stringContaining("[old tool output cleared]"),
    });
    expect(messages[1].content).toContain("tool=file_read");
    expect(messages[3]).toMatchObject({
      role: "tool",
      content: expect.stringContaining("[old tool output cleared]"),
    });
    expect(messages[3].content).toContain("tool=run_command");
    expect(messages[5]).toMatchObject({
      role: "tool",
      content: "C".repeat(600),
    });
  });

  it("keeps short outputs and non-compactable tools untouched", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "searching memory",
        tool_calls: [{ id: "call-1", function: { name: "memory_search" } }],
      },
      { role: "tool" as const, tool_call_id: "call-1", content: "matched 2 memories" },
      {
        role: "assistant" as const,
        content: "listing files",
        tool_calls: [{ id: "call-2", function: { name: "list_files" } }],
      },
      { role: "tool" as const, tool_call_id: "call-2", content: "small output" },
    ];

    const result = microcompactMessages(messages, {
      keepRecentToolMessages: 0,
      minOutputChars: 50,
    });

    expect(result.mutated).toBe(false);
    expect(result.skippedForPrefixStability).toBe(false);
    expect(messages[1]).toMatchObject({ content: "matched 2 memories" });
    expect(messages[3]).toMatchObject({ content: "small output" });
  });

  it("preserves a structured error summary for old failed tool outputs", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "run command",
        tool_calls: [{ id: "call-1", function: { name: "run_command" } }],
      },
      {
        role: "tool" as const,
        tool_call_id: "call-1",
        content: `错误：${"stack trace ".repeat(80)}`,
      },
    ];

    const result = microcompactMessages(messages, {
      keepRecentToolMessages: 0,
      minOutputChars: 80,
    });

    expect(result.mutated).toBe(true);
    expect(result.skippedForPrefixStability).toBe(false);
    expect(messages[1].content).toContain("[old tool error summary preserved]");
    expect(messages[1].content).toContain("tool=run_command");
    expect(messages[1].content).toContain("error=");
  });

  it("pins recent high-signal tool outputs so they are not compacted ahead of generic ones", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "generic list",
        tool_calls: [{ id: "call-1", function: { name: "list_files" } }],
      },
      { role: "tool" as const, tool_call_id: "call-1", content: "A".repeat(600) },
      {
        role: "assistant" as const,
        content: "inspect error log",
        tool_calls: [{ id: "call-2", function: { name: "run_command" } }],
      },
      {
        role: "tool" as const,
        tool_call_id: "call-2",
        content: "Error: failed to load packages/app/src/bootstrap.ts because config was undefined.\n" + "B".repeat(520),
      },
      {
        role: "assistant" as const,
        content: "latest fetch",
        tool_calls: [{ id: "call-3", function: { name: "web_fetch" } }],
      },
      { role: "tool" as const, tool_call_id: "call-3", content: "C".repeat(600) },
    ];

    const result = microcompactMessages(messages, {
      keepRecentToolMessages: 1,
    });

    expect(result).toMatchObject({
      mutated: true,
      compactedCount: 1,
      skippedForPrefixStability: false,
    });
    expect(messages[1].content).toContain("[old tool output cleared]");
    expect(messages[3].content).toContain("packages/app/src/bootstrap.ts");
    expect(messages[3].content).not.toContain("[old tool");
    expect(messages[5].content).toBe("C".repeat(600));
  });

  it("does not compact the same tool output twice once a placeholder has already been written", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "reading file",
        tool_calls: [{ id: "call-1", function: { name: "file_read" } }],
      },
      {
        role: "tool" as const,
        tool_call_id: "call-1",
        content: "[old tool output cleared]\ntool=file_read\nresult=already compacted",
      },
    ];

    const result = microcompactMessages(messages, {
      keepRecentToolMessages: 0,
      minOutputChars: 20,
    });

    expect(result).toEqual({
      mutated: false,
      compactedCount: 0,
      reclaimedChars: 0,
      skippedForPrefixStability: false,
    });
    expect(messages[1].content).toContain("already compacted");
  });

  it("skips destructive microcompact when prefix stability protection is enabled", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "reading file",
        tool_calls: [{ id: "call-1", function: { name: "file_read" } }],
      },
      { role: "tool" as const, tool_call_id: "call-1", content: "A".repeat(600) },
    ];

    const result = microcompactMessages(messages, {
      keepRecentToolMessages: 0,
      preservePrefixStability: true,
    });

    expect(result).toEqual({
      mutated: false,
      compactedCount: 0,
      reclaimedChars: 0,
      skippedForPrefixStability: true,
    });
    expect(messages[1].content).toBe("A".repeat(600));
  });
});
