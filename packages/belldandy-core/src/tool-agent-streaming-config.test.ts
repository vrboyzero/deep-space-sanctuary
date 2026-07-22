import { describe, expect, it } from "vitest";

import { resolveToolAgentStreamingEnabled } from "./tool-agent-streaming-config.js";

describe("Tool Agent streaming config", () => {
  it("enables only an explicit true value", () => {
    expect(resolveToolAgentStreamingEnabled("true")).toBe(true);
    expect(resolveToolAgentStreamingEnabled(" TRUE ")).toBe(true);
  });

  it("falls back to the disabled default for missing or invalid values", () => {
    expect(resolveToolAgentStreamingEnabled(undefined)).toBe(false);
    expect(resolveToolAgentStreamingEnabled("false")).toBe(false);
    expect(resolveToolAgentStreamingEnabled("1")).toBe(false);
    expect(resolveToolAgentStreamingEnabled("yes")).toBe(false);
    expect(resolveToolAgentStreamingEnabled("invalid")).toBe(false);
  });
});
