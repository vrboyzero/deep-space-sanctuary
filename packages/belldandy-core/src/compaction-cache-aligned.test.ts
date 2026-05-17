import { describe, expect, it } from "vitest";

import {
  buildCacheAlignedChatMessages,
  buildCacheAlignedResponsesInput,
  buildCacheAlignedSummaryInstruction,
} from "./compaction-cache-aligned.js";

describe("compaction cache-aligned helpers", () => {
  it("builds cache-aligned rolling-summary replay messages with cache break instruction", () => {
    const context = {
      mode: "rolling" as const,
      prompt: "Summarize the conversation.",
      existingSummary: "Current Goal\n- finish B4",
      newMessages: [
        { role: "user", content: "Please update gateway.ts" },
        { role: "assistant", content: "I updated the runtime config." },
      ],
    };

    const instruction = buildCacheAlignedSummaryInstruction(context);
    const messages = buildCacheAlignedChatMessages(context, instruction);

    expect(instruction).toContain("<<CACHE_BREAK>>");
    expect(messages).toEqual([
      {
        role: "assistant",
        content: "## Existing Summary\nCurrent Goal\n- finish B4",
      },
      {
        role: "user",
        content: "Please update gateway.ts",
      },
      {
        role: "assistant",
        content: "I updated the runtime config.",
      },
      {
        role: "user",
        content: instruction,
      },
    ]);
  });

  it("builds cache-aligned archival responses input from replayed summaries", () => {
    const context = {
      mode: "archival" as const,
      prompt: "Compress this rolling summary into archival memory.",
      existingArchivalSummary: "Stable Goal\n- keep cache-friendly prompts",
      rollingSummary: "Pending Work\n- validate B4 tests",
    };

    const instruction = buildCacheAlignedSummaryInstruction(context);
    const input = buildCacheAlignedResponsesInput(context, instruction);

    expect(input).toEqual([
      {
        type: "message",
        role: "assistant",
        content: "## Existing Archival Summary\nStable Goal\n- keep cache-friendly prompts",
      },
      {
        type: "message",
        role: "assistant",
        content: "## Rolling Summary To Archive\nPending Work\n- validate B4 tests",
      },
      {
        type: "message",
        role: "user",
        content: instruction,
      },
    ]);
  });
});
