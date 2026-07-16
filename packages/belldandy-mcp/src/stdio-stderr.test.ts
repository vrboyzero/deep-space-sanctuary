import { describe, expect, it } from "vitest";

import { BoundedStdioStderrLineBuffer } from "./stdio-stderr.js";

describe("BoundedStdioStderrLineBuffer", () => {
  it("keeps an unterminated stderr line bounded until its newline arrives", () => {
    const buffer = new BoundedStdioStderrLineBuffer(8);

    expect(buffer.push("a".repeat(20))).toEqual([]);
    expect(buffer.push("\n")).toEqual([{ line: "a".repeat(8), truncatedBytes: 12 }]);
  });

  it("preserves UTF-8 characters split across stream chunks", () => {
    const buffer = new BoundedStdioStderrLineBuffer(12);
    const encoded = Buffer.from("你好\n", "utf8");

    expect(buffer.push(encoded.subarray(0, 2))).toEqual([]);
    expect(buffer.push(encoded.subarray(2))).toEqual([{ line: "你好", truncatedBytes: 0 }]);
  });

  it("flushes a bounded final fragment when the stream ends without a newline", () => {
    const buffer = new BoundedStdioStderrLineBuffer(4);

    expect(buffer.push("abcdef")).toEqual([]);
    expect(buffer.finish()).toEqual([{ line: "abcd", truncatedBytes: 2 }]);
  });
});
