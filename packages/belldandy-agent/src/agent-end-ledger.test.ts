import { describe, expect, it } from "vitest";

import { AgentEndLedger } from "./agent-end-ledger.js";

describe("AgentEndLedger", () => {
  it("keeps short runs behaviorally equivalent", () => {
    const ledger = new AgentEndLedger();
    ledger.record({ type: "delta", delta: "hello" });
    ledger.record({ type: "final", text: "hello" });
    ledger.record({ type: "status", status: "done" });

    const snapshot = ledger.snapshot();

    expect(snapshot.items).toEqual([
      { type: "delta", delta: "hello" },
      { type: "final", text: "hello" },
      { type: "status", status: "done" },
    ]);
    expect(snapshot.summary).toMatchObject({
      truncated: false,
      eventCount: 3,
      totalDeltaChars: 5,
    });
  });

  it("bounds long streams while preserving the final and terminal status", () => {
    const ledger = new AgentEndLedger({ headEvents: 2, tailEvents: 2, maxItemBytes: 32 });
    for (let index = 0; index < 10; index += 1) {
      ledger.record({ type: "delta", delta: `delta-${index}` });
    }
    ledger.record({ type: "final", text: "final response" });
    ledger.record({ type: "status", status: "done" });

    const snapshot = ledger.snapshot();

    expect(snapshot.summary).toMatchObject({
      truncated: true,
      eventCount: 12,
      droppedEventCount: 8,
      totalDeltaChars: 70,
    });
    expect(snapshot.items).toContainEqual({ type: "final", text: "final response" });
    expect(snapshot.items).toContainEqual({ type: "status", status: "done" });
  });

  it("bounds and redacts retained tool details", () => {
    const ledger = new AgentEndLedger({ maxItemBytes: 24 });
    ledger.record({
      type: "tool_call",
      id: "call-1",
      name: "demo",
      arguments: { nested: { authorization: "Bearer nested-secret" } },
    });
    ledger.record({
      type: "tool_result",
      id: "call-1",
      name: "demo",
      success: false,
      output: "x".repeat(80),
      error: "token=tool-result-secret",
    });

    const snapshot = ledger.snapshot();
    const serialized = JSON.stringify(snapshot.items);

    expect(serialized).not.toContain("nested-secret");
    expect(serialized).not.toContain("tool-result-secret");
    expect(serialized).toContain("[TRUNCATED]");
  });
});
