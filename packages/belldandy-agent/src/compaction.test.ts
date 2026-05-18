import { describe, expect, it, vi } from "vitest";
import {
  compactIncremental,
  createEmptyCompactionState,
  normalizeCompactionState,
} from "./compaction.js";

describe("compactIncremental", () => {
  it("only summarizes newly overflowed messages on subsequent compactions", async () => {
    const prompts: string[] = [];
    const summarizer = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return `summary-${prompts.length}`;
    });
    const firstMessages = [
      { role: "user" as const, content: "U1" },
      { role: "assistant" as const, content: "A1" },
      { role: "user" as const, content: "U2" },
      { role: "assistant" as const, content: "A2" },
      { role: "user" as const, content: "U3" },
      { role: "assistant" as const, content: "A3" },
    ];

    const first = await compactIncremental(firstMessages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });
    const second = await compactIncremental(
      [
        ...firstMessages,
        { role: "user" as const, content: "U4" },
        { role: "assistant" as const, content: "A4" },
      ],
      first.state,
      {
        keepRecentCount: 2,
        tokenThreshold: 1,
        summarizer,
        force: true,
      },
    );

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("U1");
    expect(prompts[0]).toContain("A2");
    expect(prompts[1]).toContain("U3");
    expect(prompts[1]).toContain("A3");
    expect(prompts[1]).not.toContain("U1");
    expect(prompts[1]).not.toContain("A2");
    expect(second.state.compactedMessageCount).toBe(6);
    expect(second.state.lastCompactedMessageCount).toBe(6);
  });

  it("reuses existing summary when there is no new overflow", async () => {
    const summarizer = vi.fn(async () => "summary-v1");
    const messages = [
      { role: "user" as const, content: "U1" },
      { role: "assistant" as const, content: "A1" },
      { role: "user" as const, content: "U2" },
      { role: "assistant" as const, content: "A2" },
      { role: "user" as const, content: "U3" },
      { role: "assistant" as const, content: "A3" },
    ];

    const first = await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });
    const second = await compactIncremental(messages, first.state, {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });

    expect(summarizer).toHaveBeenCalledTimes(1);
    expect(second.compacted).toBe(false);
    expect(second.messages[0]?.content).toContain("4 earlier messages compressed");
    expect(second.messages[0]?.content).toContain("summary-v1");
  });

  it("falls back to a full rebuild when the compacted boundary fingerprint no longer matches", async () => {
    const prompts: string[] = [];
    const summarizer = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return `summary-${prompts.length}`;
    });
    const firstMessages = [
      { role: "user" as const, content: "U1" },
      { role: "assistant" as const, content: "A1" },
      { role: "user" as const, content: "U2" },
      { role: "assistant" as const, content: "A2" },
      { role: "user" as const, content: "U3" },
      { role: "assistant" as const, content: "A3" },
    ];

    const first = await compactIncremental(firstMessages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });
    await compactIncremental(
      [
        { role: "user" as const, content: "U1 changed" },
        { role: "assistant" as const, content: "A1" },
        { role: "user" as const, content: "U2" },
        { role: "assistant" as const, content: "A2" },
        { role: "user" as const, content: "U3" },
        { role: "assistant" as const, content: "A3" },
        { role: "user" as const, content: "U4" },
        { role: "assistant" as const, content: "A4" },
      ],
      first.state,
      {
        keepRecentCount: 2,
        tokenThreshold: 1,
        summarizer,
        force: true,
      },
    );

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("U1 changed");
    expect(prompts[1]).toContain("U2");
    expect(prompts[1]).toContain("U3");
    expect(prompts[1]).not.toContain("## Existing Summary");
  });

  it("archives rolling summary when merge rounds cross the threshold", async () => {
    const summarizer = vi.fn(async (prompt: string) => {
      if (prompt.includes("ultra-concise archival summary")) {
        return "archived-summary";
      }
      return "rolling-summary";
    });
    const firstMessages = [
      { role: "user" as const, content: "U1" },
      { role: "assistant" as const, content: "A1" },
      { role: "user" as const, content: "U2" },
      { role: "assistant" as const, content: "A2" },
      { role: "user" as const, content: "U3" },
      { role: "assistant" as const, content: "A3" },
    ];

    const first = await compactIncremental(firstMessages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      archivalThreshold: 99999,
      archivalMergeThreshold: 2,
      summarizer,
      force: true,
    });
    const second = await compactIncremental(
      [
        ...firstMessages,
        { role: "user" as const, content: "U4" },
        { role: "assistant" as const, content: "A4" },
      ],
      first.state,
      {
        keepRecentCount: 2,
        tokenThreshold: 1,
        archivalThreshold: 99999,
        archivalMergeThreshold: 2,
        summarizer,
        force: true,
      },
    );

    expect(first.tier).toBe("rolling");
    expect(first.state.rollingSummaryMergeCount).toBe(1);
    expect(second.tier).toBe("archival");
    expect(second.state.rollingSummary).toBe("");
    expect(second.state.archivalSummary).toBe("archived-summary");
    expect(second.state.rollingSummaryMergeCount).toBe(0);
  });

  it("falls back locally when compaction prompt crosses the blocking threshold", async () => {
    const summarizer = vi.fn(async () => "should-not-run");
    const messages = [
      { role: "user" as const, content: "U1".repeat(80) },
      { role: "assistant" as const, content: "A1".repeat(80) },
      { role: "user" as const, content: "U2".repeat(80) },
      { role: "assistant" as const, content: "A2".repeat(80) },
      { role: "user" as const, content: "U3".repeat(80) },
      { role: "assistant" as const, content: "A3".repeat(80) },
    ];

    const result = await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      blockingThreshold: 50,
      summarizer,
      force: true,
    });

    expect(result.compacted).toBe(true);
    expect(result.fallbackUsed).toBe(true);
    expect(result.blockingTriggered).toBe(true);
    expect(result.warningTriggered).toBe(false);
    expect(summarizer).not.toHaveBeenCalled();
    expect(result.messages[0]?.content).toContain("Conversation context");
  });

  it("retries with a smaller prompt when summarizer fails with prompt-too-long", async () => {
    const prompts: string[] = [];
    const summarizer = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        throw new Error("prompt too long");
      }
      return "retry-summary";
    });
    const messages = [
      { role: "user" as const, content: "U1" },
      { role: "assistant" as const, content: "A1" },
      { role: "user" as const, content: "U2" },
      { role: "assistant" as const, content: "A2" },
      { role: "user" as const, content: "U3" },
      { role: "assistant" as const, content: "A3" },
    ];

    const result = await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      maxPromptTooLongRetries: 1,
      summarizer,
      force: true,
    });

    expect(result.compacted).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(result.promptTooLongRetries).toBe(1);
    expect(result.failureReason).toBeUndefined();
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("U1");
    expect(prompts[0]).toContain("U2");
    expect(prompts[1]).toContain("U2");
    expect(prompts[1]).toContain("A2");
    expect(prompts[1]).toContain("## Existing Summary");
    expect(result.state.rollingSummary).toBe("retry-summary");
  });

  it("pins recent high-signal messages by expanding the preserved tail before compaction", async () => {
    const prompts: string[] = [];
    const summarizer = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return "pinned-summary";
    });
    const messages = [
      { role: "user" as const, content: "先做常规扫描。" },
      { role: "assistant" as const, content: "已读取入口模块。" },
      { role: "user" as const, content: "请重点检查 packages/app/src/bootstrap.ts 的启动错误，并保留补丁思路。" },
      { role: "assistant" as const, content: "错误是 config.load() 返回 undefined，需要补默认值回退。" },
      { role: "user" as const, content: "顺便确认 CLI 参数兼容。" },
      { role: "assistant" as const, content: "收到，我继续处理。" },
    ];

    const result = await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("packages/app/src/bootstrap.ts");
    expect(prompts[0]).not.toContain("config.load()");
    expect(result.compacted).toBe(true);
    expect(result.state.compactedMessageCount).toBe(2);
    expect(result.messages.some((message) => message.content.includes("packages/app/src/bootstrap.ts"))).toBe(true);
    expect(result.messages.some((message) => message.content.includes("config.load()"))).toBe(true);
  });

  it("uses a task continuity rolling prompt instead of a generic topic summary prompt", async () => {
    const prompts: string[] = [];
    const summarizer = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return "structured-rolling-summary";
    });
    const messages = [
      { role: "user" as const, content: "请修复 packages/app/src/index.ts 里的启动报错" },
      { role: "assistant" as const, content: "我先检查 index.ts 和最近的错误日志。" },
      { role: "user" as const, content: "错误是 config.load() 返回 undefined，启动时崩溃。" },
      { role: "assistant" as const, content: "已确认需要在 loadConfig() 增加默认值回退。" },
      { role: "user" as const, content: "顺便保留现有 CLI 参数兼容。" },
      { role: "assistant" as const, content: "我会补回归测试并记录下一步。" },
    ];

    await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Current Goal");
    expect(prompts[0]).toContain("Key Decisions");
    expect(prompts[0]).toContain("Key Files / Functions / Changes");
    expect(prompts[0]).toContain("Errors and Fixes");
    expect(prompts[0]).toContain("Current Work");
    expect(prompts[0]).toContain("Next Step");
    expect(prompts[0]).toContain("Prefer concrete outcomes over topic descriptions.");
    expect(prompts[0]).toContain("Do not write vague lines such as 'the user asked about X'");
  });

  it("uses an outcome-focused archival prompt when rolling summary is archived", async () => {
    const prompts: string[] = [];
    const summarizer = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes("## Rolling Summary To Archive")) {
        return "archived-summary";
      }
      return "rolling-summary with files and fixes";
    });
    const messages = [
      { role: "user" as const, content: "U1".repeat(60) },
      { role: "assistant" as const, content: "A1".repeat(60) },
      { role: "user" as const, content: "U2".repeat(60) },
      { role: "assistant" as const, content: "A2".repeat(60) },
      { role: "user" as const, content: "U3".repeat(60) },
      { role: "assistant" as const, content: "A3".repeat(60) },
    ];

    const result = await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      archivalMergeThreshold: 1,
      summarizer,
      force: true,
    });

    expect(result.tier).toBe("archival");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Stable Goal");
    expect(prompts[1]).toContain("Final Decisions");
    expect(prompts[1]).toContain("Durable Files / Modules");
    expect(prompts[1]).toContain("Resolved Failures");
    expect(prompts[1]).toContain("Outstanding Follow-up");
    expect(prompts[1]).toContain("Last Known Working State");
    expect(prompts[1]).toContain("Prefer concrete outcomes over topic descriptions.");
  });

  it("passes structured rolling-summary context into the summarizer while keeping prompt compatibility", async () => {
    const calls: Array<{ prompt: string; context: any }> = [];
    const summarizer = vi.fn(async (prompt: string, context?: any) => {
      calls.push({ prompt, context });
      return "rolling-summary-v1";
    });
    const messages = [
      { role: "user" as const, content: "U1" },
      { role: "assistant" as const, content: "A1" },
      { role: "user" as const, content: "U2" },
      { role: "assistant" as const, content: "A2" },
      { role: "user" as const, content: "U3" },
      { role: "assistant" as const, content: "A3" },
    ];

    await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain("## Conversation");
    expect(calls[0]?.context).toMatchObject({
      mode: "rolling",
      prompt: expect.stringContaining("## Conversation"),
      existingSummary: "",
      newMessages: [
        { role: "user", content: "U1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "U2" },
        { role: "assistant", content: "A2" },
      ],
    });
  });

  it("captures summarizer observability returned by cache-aligned summary workers", async () => {
    const summarizer = vi.fn(async () => ({
      summary: "rolling-summary-v1",
      observability: {
        mode: "rolling" as const,
        cacheAlignedRequested: true,
        cacheSupport: "supported" as const,
        cacheHitTokens: 1200,
        cacheMissTokens: 80,
        cacheSavingsUsd: 0.000456,
        usedWireApi: "chat_completions" as const,
        warmupCoordination: {
          eligible: true,
          status: "warm_candidate" as const,
          recommendation: "proceed" as const,
          reason: "cache_aligned_summary_selected",
        },
        cacheFamilyAffinity: {
          status: "aligned" as const,
          familyKey: "family-compaction-1",
          reason: "cache_aligned_summary_family_selected",
        },
      },
    }));
    const messages = [
      { role: "user" as const, content: "U1" },
      { role: "assistant" as const, content: "A1" },
      { role: "user" as const, content: "U2" },
      { role: "assistant" as const, content: "A2" },
      { role: "user" as const, content: "U3" },
      { role: "assistant" as const, content: "A3" },
    ];

    const result = await compactIncremental(messages, createEmptyCompactionState(), {
      keepRecentCount: 2,
      tokenThreshold: 1,
      summarizer,
      force: true,
    });

    expect(result.summarizerObservability).toMatchObject({
      mode: "rolling",
      cacheAlignedRequested: true,
      cacheSupport: "supported",
      cacheHitTokens: 1200,
      cacheMissTokens: 80,
      cacheSavingsUsd: 0.000456,
      usedWireApi: "chat_completions",
      warmupCoordination: {
        eligible: true,
        status: "warm_candidate",
        recommendation: "proceed",
        reason: "cache_aligned_summary_selected",
      },
      cacheFamilyAffinity: {
        status: "aligned",
        familyKey: "family-compaction-1",
        reason: "cache_aligned_summary_family_selected",
      },
    });
  });
});

describe("normalizeCompactionState", () => {
  it("backfills newly introduced incremental state fields", () => {
    const normalized = normalizeCompactionState({
      rollingSummary: "rolling-summary-v1",
      archivalSummary: "",
      compactedMessageCount: 4,
      lastCompactedAt: 123,
    });

    expect(normalized).toMatchObject({
      rollingSummary: "rolling-summary-v1",
      archivalSummary: "",
      compactedMessageCount: 4,
      lastCompactedMessageCount: 4,
      lastCompactedMessageFingerprint: "",
      rollingSummaryMergeCount: 0,
      lastCompactedAt: 123,
    });
  });
});
