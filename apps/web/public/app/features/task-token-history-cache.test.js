import { describe, expect, it } from "vitest";

import { createTaskTokenHistoryCache } from "./task-token-history-cache.js";

describe("task token history cache retention", () => {
  it("keeps one record per conversation and evicts inactive LRU entries", () => {
    let now = 0;
    const cache = createTaskTokenHistoryCache({
      maxConversationEntries: 2,
      maxApproxBytes: 1024 * 1024,
      maxRecordsPerConversation: 1,
      now: () => ++now,
    });
    cache.set("conv-a", [record("a-old"), record("a-new")]);
    cache.set("conv-b", [record("b")]);

    expect(cache.get("conv-a")).toEqual([record("a-old")]);
    cache.set("conv-c", [record("c")]);

    expect(cache.get("conv-a")).toHaveLength(1);
    expect(cache.get("conv-b")).toEqual([]);
    expect(cache.get("conv-c")).toHaveLength(1);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 2,
      retainedRecordCount: 2,
      evictedConversationCount: 1,
      overBudget: false,
    });
  });

  it("pins the visible conversation until it becomes inactive", () => {
    const cache = createTaskTokenHistoryCache({
      maxConversationEntries: 1,
      maxApproxBytes: 1024 * 1024,
    });
    cache.setActiveConversation("conv-visible");
    cache.set("conv-visible", [record("visible")]);
    cache.set("conv-other", [record("other")]);

    expect(cache.get("conv-visible")).toHaveLength(1);
    expect(cache.get("conv-other")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 1,
      activeConversationCount: 1,
      overBudget: false,
    });
  });

  it("prunes an oversized visible entry after it is unpinned", () => {
    const cache = createTaskTokenHistoryCache({
      maxConversationEntries: 4,
      maxApproxBytes: 128,
    });
    cache.setActiveConversation("conv-visible");
    cache.set("conv-visible", [record("x".repeat(200))]);
    expect(cache.getRuntimeSnapshot().overBudget).toBe(true);

    cache.setActiveConversation("");

    expect(cache.get("conv-visible")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 0,
      evictedConversationCount: 1,
      overBudget: false,
    });
  });

  it("evicts expired inactive records while retaining active records until unpinned", () => {
    let now = 0;
    const cache = createTaskTokenHistoryCache({
      inactiveTtlMs: 100,
      maxConversationEntries: 10,
      maxApproxBytes: 1024 * 1024,
      now: () => now,
    });
    cache.setActiveConversation("conv-active");
    cache.set("conv-active", [record("active")]);
    cache.set("conv-inactive", [record("inactive")]);

    now = 101;

    expect(cache.get("conv-active")).toHaveLength(1);
    expect(cache.get("conv-inactive")).toEqual([]);
    expect(cache.get("conv-inactive")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 1,
      activeConversationCount: 1,
      evictedConversationCount: 1,
      inactiveTtlMs: 100,
    });

    cache.setActiveConversation("");
    now = 202;
    expect(cache.get("conv-active")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 0,
      evictedConversationCount: 2,
    });
  });

  it("prepends within the record limit and clears generation state", () => {
    const cache = createTaskTokenHistoryCache({ maxRecordsPerConversation: 1 });
    cache.set("conv-a", [record("old")]);
    cache.prepend("conv-a", record("new"));
    expect(cache.get("conv-a")).toEqual([record("new")]);

    cache.clearGeneration();
    expect(cache.get("conv-a")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 0,
      generationClearCount: 1,
      disposed: false,
    });

    cache.set("conv-b", [record("current")]);
    cache.dispose();
    expect(cache.get("conv-b")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 0,
      disposed: true,
    });
  });
});

function record(name) {
  return {
    name,
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    durationMs: 4,
    createdAt: 5,
    auto: false,
  };
}
