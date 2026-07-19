import { describe, expect, it } from "vitest";

import { createEmailThreadAdviceRetention } from "./email-thread-advice-retention.js";

describe("email thread advice retention", () => {
  it("bounds settled conversation keys by least-recently-used order", () => {
    let now = 0;
    const retention = createEmailThreadAdviceRetention({
      maxEntries: 2,
      now: () => ++now,
    });

    retention.succeed(retention.begin("conversation-1"));
    retention.succeed(retention.begin("conversation-2"));
    expect(retention.has("conversation-1")).toBe(true);
    retention.succeed(retention.begin("conversation-3"));

    expect(retention.has("conversation-1")).toBe(true);
    expect(retention.has("conversation-2")).toBe(false);
    expect(retention.has("conversation-3")).toBe(true);
    expect(retention.getRuntimeSnapshot()).toMatchObject({
      retainedEntryCount: 2,
      pendingEntryCount: 0,
      settledEntryCount: 2,
      maxEntries: 2,
      evictedEntryCount: 1,
      overBudget: false,
    });
  });

  it("pins pending requests until they settle and releases failures for retry", () => {
    const retention = createEmailThreadAdviceRetention({ maxEntries: 1 });
    const first = retention.begin("conversation-1");
    const second = retention.begin("conversation-2");

    expect(retention.getRuntimeSnapshot()).toMatchObject({
      retainedEntryCount: 2,
      pendingEntryCount: 2,
      overBudget: true,
    });

    expect(retention.fail(first)).toBe(true);
    expect(retention.has("conversation-1")).toBe(false);
    const retry = retention.begin("conversation-1");
    expect(retry).not.toBeNull();
    expect(retention.succeed(second)).toBe(true);
    expect(retention.has("conversation-2")).toBe(true);
    expect(retention.getRuntimeSnapshot()).toMatchObject({
      pendingEntryCount: 1,
      settledEntryCount: 1,
      overBudget: true,
    });
    expect(retention.fail(retry)).toBe(true);
    expect(retention.getRuntimeSnapshot()).toMatchObject({
      retainedEntryCount: 1,
      overBudget: false,
    });
  });

  it("isolates stale settlements across generation clear and dispose", () => {
    const retention = createEmailThreadAdviceRetention();
    const stale = retention.begin("conversation-1");

    retention.clearGeneration();
    const current = retention.begin("conversation-1");

    expect(retention.fail(stale)).toBe(false);
    expect(retention.has("conversation-1")).toBe(true);
    expect(retention.succeed(current)).toBe(true);
    expect(retention.getRuntimeSnapshot()).toMatchObject({
      retainedEntryCount: 1,
      generationClearCount: 1,
      disposed: false,
    });

    retention.dispose();
    expect(retention.begin("conversation-2")).toBeNull();
    expect(retention.getRuntimeSnapshot()).toMatchObject({
      retainedEntryCount: 0,
      pendingEntryCount: 0,
      settledEntryCount: 0,
      disposed: true,
    });
  });
});
