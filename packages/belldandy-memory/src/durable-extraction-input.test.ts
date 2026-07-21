import { describe, expect, it } from "vitest";

import {
  renderDurableExtractionMessages,
  selectDurableExtractionInput,
} from "./durable-extraction-input.js";

describe("selectDurableExtractionInput", () => {
  it("keeps the newest complete messages within count and aggregate UTF-8 limits", () => {
    const messages = [
      { role: "user", content: "oldest" },
      { role: "assistant", content: "middle" },
      { role: "user", content: "newest" },
    ];
    const expectedTail = messages.slice(-2);
    const maxAggregateBytes = Buffer.byteLength(renderDurableExtractionMessages(expectedTail), "utf8");

    const selected = selectDurableExtractionInput(messages, {
      maxMessages: 3,
      maxMessageBytes: 100,
      maxAggregateBytes,
    });

    expect(selected.messages).toEqual(expectedTail);
    expect(selected.conversationText).toBe(renderDurableExtractionMessages(expectedTail));
    expect(selected.inputBytes).toBe(maxAggregateBytes);
    expect(selected.droppedMessageCount).toBe(1);
  });

  it("truncates an oversized newest message from the tail without breaking UTF-8", () => {
    const selected = selectDurableExtractionInput([
      { role: "user", content: "prefix-😀汉字-tail" },
    ], {
      maxMessages: 4,
      maxMessageBytes: 10,
      maxAggregateBytes: 100,
    });

    expect(selected.messages).toHaveLength(1);
    expect(Buffer.byteLength(selected.messages[0].content, "utf8")).toBeLessThanOrEqual(10);
    expect(selected.messages[0].content).toMatch(/tail$/u);
    expect(selected.messages[0].content).not.toContain("�");
    expect(selected.truncatedMessageCount).toBe(1);
  });

  it("returns an empty bounded input when aggregate bytes cannot fit one message envelope", () => {
    const selected = selectDurableExtractionInput([
      { role: "assistant", content: "latest" },
    ], {
      maxMessages: 1,
      maxMessageBytes: 100,
      maxAggregateBytes: 2,
    });

    expect(selected.messages).toEqual([]);
    expect(selected.conversationText).toBe("");
    expect(selected.inputBytes).toBe(0);
  });
});
