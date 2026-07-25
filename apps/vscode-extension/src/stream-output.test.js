import { describe, expect, it, vi } from "vitest";

import { createCodingRunStreamOutput } from "./stream-output.cjs";

describe("VS Code coding-run stream output", () => {
  it("writes only message deltas and bounds visible model output", () => {
    const channel = { append: vi.fn(), appendLine: vi.fn(), clear: vi.fn() };
    const output = createCodingRunStreamOutput(channel, { maxChars: 5 });

    expect(output.appendEvent({ type: "tool.completed", payload: { output: "must-not-display" } })).toBe(false);
    expect(output.appendEvent({ type: "message.delta", payload: { delta: "abcdef" } })).toBe(true);
    expect(channel.append).toHaveBeenCalledWith("abcde");
    expect(channel.appendLine).toHaveBeenCalledWith("\n[coding-run stream truncated]");

    output.reset();
    expect(channel.clear).toHaveBeenCalledTimes(1);
    expect(output.appendEvent({ type: "message.delta", payload: { delta: "next" } })).toBe(true);
    expect(channel.append).toHaveBeenLastCalledWith("next");
  });
});
