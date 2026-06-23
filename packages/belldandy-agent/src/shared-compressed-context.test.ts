/**
 * Phase 4 步骤 4 测试：shared compressed context
 */

import { describe, expect, it } from "vitest";

import {
  SharedCompressedContextStore,
  getOrCreateSharedCompressedContextStore,
  getSharedCompressedContextStore,
  cleanupSharedCompressedContextStore,
  injectSharedCompressedContext,
  buildLaneSummary,
} from "./shared-compressed-context.js";

describe("Phase 4 step 4: SharedCompressedContextStore", () => {
  it("stores and retrieves entries by laneId", () => {
    const store = new SharedCompressedContextStore("team-1");
    store.upsert({ laneId: "lane-a", agentId: "coder", rawSummary: "Fixed bug in file.ts" });
    const entry = store.get("lane-a");
    expect(entry).toBeDefined();
    expect(entry?.rawSummary).toBe("Fixed bug in file.ts");
    expect(entry?.agentId).toBe("coder");
    expect(entry?.status).toBe("active");
  });

  it("upserts update existing entries", () => {
    const store = new SharedCompressedContextStore("team-1");
    store.upsert({ laneId: "lane-a", rawSummary: "v1" });
    store.upsert({ laneId: "lane-a", rawSummary: "v2", compressedSummary: "v2-compressed" });
    const entry = store.get("lane-a");
    expect(entry?.rawSummary).toBe("v2");
    expect(entry?.compressedSummary).toBe("v2-compressed");
  });

  it("getActiveEntries returns only active entries", () => {
    const store = new SharedCompressedContextStore("team-1");
    store.upsert({ laneId: "lane-a", rawSummary: "a" });
    store.upsert({ laneId: "lane-b", rawSummary: "b" });
    store.markStale("lane-a");
    const active = store.getActiveEntries();
    expect(active).toHaveLength(1);
    expect(active[0].laneId).toBe("lane-b");
  });

  it("markStale returns false for unknown laneId", () => {
    const store = new SharedCompressedContextStore("team-1");
    expect(store.markStale("unknown")).toBe(false);
  });

  it("buildFanInContextText returns empty for no active entries", () => {
    const store = new SharedCompressedContextStore("team-1");
    expect(store.buildFanInContextText()).toBe("");
  });

  it("buildFanInContextText wraps entries with team-shared-context tag", () => {
    const store = new SharedCompressedContextStore("team-1");
    store.upsert({ laneId: "lane-a", agentId: "coder", rawSummary: "Fixed bug" });
    store.upsert({ laneId: "lane-b", agentId: "tester", rawSummary: "Wrote tests" });
    const text = store.buildFanInContextText();
    expect(text).toContain("<team-shared-context");
    expect(text).toContain("Lane lane-a");
    expect(text).toContain("Fixed bug");
    expect(text).toContain("Lane lane-b");
    expect(text).toContain("Wrote tests");
    expect(text).toContain("</team-shared-context>");
  });

  it("buildFanInContextText uses compressed summary when available", () => {
    const store = new SharedCompressedContextStore("team-1");
    store.upsert({
      laneId: "lane-a",
      rawSummary: "very long raw summary...",
      compressedSummary: "short compressed",
    });
    const text = store.buildFanInContextText();
    expect(text).toContain("short compressed");
    expect(text).not.toContain("very long raw summary");
  });

  it("clear removes all entries", () => {
    const store = new SharedCompressedContextStore("team-1");
    store.upsert({ laneId: "lane-a", rawSummary: "a" });
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe("Phase 4 step 4: shared context registry", () => {
  it("getOrCreate creates and returns store", () => {
    const store = getOrCreateSharedCompressedContextStore("registry-team-1");
    expect(store).toBeDefined();
    expect(store.getTeamId()).toBe("registry-team-1");
  });

  it("getOrCreate returns existing store", () => {
    const store1 = getOrCreateSharedCompressedContextStore("registry-team-2");
    store1.upsert({ laneId: "lane-x", rawSummary: "test" });
    const store2 = getOrCreateSharedCompressedContextStore("registry-team-2");
    expect(store2.get("lane-x")).toBeDefined();
  });

  it("get returns undefined for unknown team", () => {
    expect(getSharedCompressedContextStore("nonexistent-team")).toBeUndefined();
  });

  it("cleanup removes store from registry", () => {
    getOrCreateSharedCompressedContextStore("registry-team-3");
    expect(cleanupSharedCompressedContextStore("registry-team-3")).toBe(true);
    expect(getSharedCompressedContextStore("registry-team-3")).toBeUndefined();
  });
});

describe("Phase 4 step 4: injectSharedCompressedContext", () => {
  it("injects before last user message", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "do fan-in" },
    ];
    const result = injectSharedCompressedContext(messages, "shared context text");
    expect(result.injected).toBe(true);
    expect(result.insertIndex).toBe(1);
    expect(messages[1]).toEqual({ role: "system", content: "shared context text" });
    expect(messages[2]).toEqual({ role: "user", content: "do fan-in" });
  });

  it("appends to end if no user message", () => {
    const messages = [{ role: "system", content: "sys" }];
    const result = injectSharedCompressedContext(messages, "shared context");
    expect(result.injected).toBe(true);
    expect(messages[messages.length - 1]).toEqual({ role: "system", content: "shared context" });
  });

  it("does nothing for empty text", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = injectSharedCompressedContext(messages, "");
    expect(result.injected).toBe(false);
    expect(messages).toHaveLength(1);
  });
});

describe("Phase 4 step 4: buildLaneSummary", () => {
  it("returns short output unchanged", () => {
    expect(buildLaneSummary("short output")).toBe("short output");
  });

  it("truncates long output with head and tail", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const output = lines.join("\n");
    const summary = buildLaneSummary(output, 100);
    expect(summary).toContain("line 0");
    expect(summary).toContain("lines omitted");
    expect(summary).toContain("line 19");
  });

  it("returns placeholder for empty output", () => {
    expect(buildLaneSummary("")).toBe("(no output)");
    expect(buildLaneSummary("  ")).toBe("(no output)");
  });
});
