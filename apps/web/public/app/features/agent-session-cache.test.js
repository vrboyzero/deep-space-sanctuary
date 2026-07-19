import { describe, expect, it } from "vitest";

import { createAgentSessionCacheFeature } from "./agent-session-cache.js";

describe("agent session cache retention", () => {
  it("evicts the least recently used inactive conversation", () => {
    let now = 0;
    const cache = createAgentSessionCacheFeature({
      maxConversationEntries: 2,
      maxApproxBytes: 1024 * 1024,
      now: () => ++now,
    });
    cache.setConversationMessages("conv-a", [message("a")]);
    cache.setConversationMessages("conv-b", [message("b")]);

    expect(cache.getConversationMessages("conv-a")).toHaveLength(1);
    cache.setConversationMessages("conv-c", [message("c")]);

    expect(cache.getConversationMessages("conv-a")).toHaveLength(1);
    expect(cache.getConversationMessages("conv-b")).toEqual([]);
    expect(cache.getConversationMessages("conv-c")).toHaveLength(1);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 2,
      activeConversationCount: 0,
      pendingConversationCount: 0,
      evictedConversationCount: 1,
      overBudget: false,
    });
  });

  it("pins the visible and streaming conversations until they become inactive", () => {
    const cache = createAgentSessionCacheFeature({
      maxConversationEntries: 1,
      maxApproxBytes: 1024 * 1024,
    });
    cache.setActiveConversation("conv-visible");
    cache.setConversationMessages("conv-visible", [message("visible")]);

    cache.appendAssistantDelta("conv-streaming", "partial");

    expect(cache.getConversationMessages("conv-visible")).toHaveLength(1);
    expect(cache.getConversationMessages("conv-streaming")).toHaveLength(1);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 2,
      activeConversationCount: 1,
      pendingConversationCount: 1,
      overBudget: true,
    });

    cache.finalizeAssistantMessage("conv-streaming", "complete");

    expect(cache.getConversationMessages("conv-visible")).toHaveLength(1);
    expect(cache.getConversationMessages("conv-streaming")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 1,
      pendingConversationCount: 0,
      evictedConversationCount: 1,
      overBudget: false,
    });
  });

  it("enforces the approximate byte budget for inactive conversations", () => {
    const cache = createAgentSessionCacheFeature({
      maxConversationEntries: 10,
      maxApproxBytes: 1024,
    });
    cache.setConversationMessages("conv-a", [message("a".repeat(300))]);
    cache.setConversationMessages("conv-b", [message("b".repeat(300))]);

    expect(cache.getConversationMessages("conv-a")).toEqual([]);
    expect(cache.getConversationMessages("conv-b")).toHaveLength(1);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 1,
      overBudget: false,
    });
  });

  it("evicts expired inactive conversations while retaining the active conversation", () => {
    let now = 0;
    const cache = createAgentSessionCacheFeature({
      inactiveTtlMs: 100,
      maxConversationEntries: 10,
      maxApproxBytes: 1024 * 1024,
      now: () => now,
    });
    cache.setActiveConversation("conv-active");
    cache.setConversationMessages("conv-active", [message("active")]);
    cache.setConversationMessages("conv-inactive", [message("inactive")]);
    cache.appendAssistantDelta("conv-streaming", "partial");

    now = 101;

    expect(cache.getConversationMessages("conv-active")).toHaveLength(1);
    expect(cache.getConversationMessages("conv-inactive")).toEqual([]);
    expect(cache.getConversationMessages("conv-streaming")).toHaveLength(1);
    expect(cache.getConversationMessages("conv-inactive")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 2,
      activeConversationCount: 1,
      pendingConversationCount: 1,
      evictedConversationCount: 1,
      inactiveTtlMs: 100,
    });
  });

  it("keeps authoritative agent bindings when only cached messages are evicted", () => {
    const cache = createAgentSessionCacheFeature({
      maxConversationEntries: 1,
      maxApproxBytes: 1024 * 1024,
    });
    cache.bindAgentConversation("agent-a", "conv-a", { main: true });
    cache.setConversationMessages("conv-a", [message("a")]);
    cache.setConversationMessages("conv-b", [message("b")]);

    expect(cache.getConversationMessages("conv-a")).toEqual([]);
    expect(cache.getAgentConversation("agent-a")).toBe("conv-a");
  });

  it("clears generations for reuse and disposes all retained state", () => {
    const cache = createAgentSessionCacheFeature();
    cache.bindAgentConversation("agent-a", "conv-a", { main: true });
    cache.setActiveConversation("conv-a");
    cache.setConversationMessages("conv-a", [message("a")]);

    cache.clearGeneration();
    expect(cache.getAgentConversation("agent-a")).toBe("");
    expect(cache.getConversationMessages("conv-a")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedAgentBindingCount: 0,
      retainedConversationCount: 0,
      disposed: false,
    });

    cache.setConversationMessages("conv-b", [message("b")]);
    cache.dispose();
    expect(cache.getConversationMessages("conv-b")).toEqual([]);
    expect(cache.getRuntimeSnapshot()).toMatchObject({
      retainedAgentBindingCount: 0,
      retainedConversationCount: 0,
      disposed: true,
    });
  });
});

function message(content) {
  return {
    role: "user",
    content,
    timestampMs: 1,
  };
}
