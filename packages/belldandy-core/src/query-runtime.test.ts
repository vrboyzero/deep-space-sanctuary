import { expect, test } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { runAgentToCompletionWithLifecycle, runAgentWithLifecycle } from "./query-runtime-agent-run.js";
import { notifyConversationToolEvent } from "./query-runtime-side-effects.js";
import { QueryRuntime } from "./query-runtime.js";
import { QueryRuntimeTraceStore } from "./query-runtime-trace.js";

test("query runtime emits lifecycle stages for successful execution", async () => {
  const stages: string[] = [];
  const traceIds: string[] = [];
  const runtime = new QueryRuntime({
    method: "message.send",
    observer: (event) => {
      stages.push(event.stage);
      traceIds.push(event.traceId);
    },
  });

  const result = await runtime.run(async (instance) => {
    instance.mark("request_validated", { conversationId: "conv-query-runtime" });
    instance.mark("agent_running", { conversationId: "conv-query-runtime" });
    instance.mark("completed", { conversationId: "conv-query-runtime" });
    return "ok";
  });

  expect(result).toBe("ok");
  expect(stages).toEqual(["started", "request_validated", "agent_running", "completed"]);
  expect(new Set(traceIds).size).toBe(1);
});

test("query runtime emits failed stage when executor throws", async () => {
  const stages: string[] = [];
  const runtime = new QueryRuntime({
    method: "message.send",
    observer: (event) => {
      stages.push(event.stage);
    },
  });

  await expect(runtime.run(async () => {
    throw new Error("boom");
  })).rejects.toThrow("boom");

  expect(stages).toEqual(["started", "failed"]);
});

test("query runtime trace store retains recent lifecycle summary for diagnostics", async () => {
  const traceStore = new QueryRuntimeTraceStore({
    maxTraces: 4,
    maxStagesPerTrace: 3,
  });
  const runtime = new QueryRuntime({
    method: "conversation.digest.refresh",
    traceId: "trace-refresh-1",
    observer: traceStore.createObserver<"conversation.digest.refresh">(),
  });

  await runtime.run(async (instance) => {
    instance.mark("request_validated", { conversationId: "conv-trace-store" });
    instance.mark("digest_refreshed", {
      conversationId: "conv-trace-store",
      detail: { updated: true },
    });
    instance.mark("completed", { conversationId: "conv-trace-store" });
  });

  const summary = traceStore.getSummary();
  expect(summary.observerEnabled).toBe(true);
  expect(summary.totalObservedEvents).toBe(4);
  expect(summary.activeTraceCount).toBe(0);
  expect(summary.traces).toHaveLength(1);
  expect(summary.traces[0]).toMatchObject({
    traceId: "trace-refresh-1",
    method: "conversation.digest.refresh",
    status: "completed",
    conversationId: "conv-trace-store",
    latestStage: "completed",
    stageCount: 4,
  });
  expect(summary.traces[0]?.stages.map((item) => item.stage)).toEqual([
    "request_validated",
    "digest_refreshed",
    "completed",
  ]);
  expect(summary.traces[0]?.stages[1]?.detail).toMatchObject({ updated: true });
});

test("query runtime trace store aggregates bounded stage durations during observation", () => {
  const traceStore = new QueryRuntimeTraceStore({
    maxDurationAggregates: 4,
    maxDurationSamplesPerAggregate: 2,
  });

  traceStore.observe({
    traceId: "duration-a",
    method: "message.send",
    stage: "started",
    timestamp: 0,
    detail: { prompt: "must-not-enter-aggregate" },
  });
  traceStore.observe({
    traceId: "duration-a",
    method: "message.send",
    stage: "request_validated",
    timestamp: 10,
  });
  traceStore.observe({
    traceId: "duration-b",
    method: "message.send",
    stage: "started",
    timestamp: 100,
  });
  traceStore.observe({
    traceId: "duration-b",
    method: "message.send",
    stage: "request_validated",
    timestamp: 150,
  });
  traceStore.observe({
    traceId: "duration-c",
    method: "message.send",
    stage: "started",
    timestamp: 200,
  });
  traceStore.observe({
    traceId: "duration-c",
    method: "message.send",
    stage: "request_validated",
    timestamp: 300,
  });

  const summary = traceStore.getSummary();
  const aggregate = summary.stageDurations.aggregates.find((item) =>
    item.method === "message.send"
    && item.previousStage === "started"
    && item.stage === "request_validated");

  expect(aggregate).toMatchObject({
    outcome: "running",
    count: 2,
    sumMs: 150,
    maxMs: 100,
    p50Ms: 50,
    p95Ms: 100,
  });
  expect(summary.stageDurations.slowest[0]).toMatchObject(aggregate ?? {});
  expect(JSON.stringify(summary.stageDurations)).not.toContain("must-not-enter-aggregate");
});

test("query runtime trace store evicts least-recent duration aggregates at its configured limit", () => {
  const traceStore = new QueryRuntimeTraceStore({
    maxDurationAggregates: 1,
    maxDurationSamplesPerAggregate: 4,
  });

  traceStore.observe({ traceId: "duration-message", method: "message.send", stage: "started", timestamp: 0 });
  traceStore.observe({ traceId: "duration-message", method: "message.send", stage: "request_validated", timestamp: 20 });
  traceStore.observe({ traceId: "duration-workspace", method: "workspace.read", stage: "started", timestamp: 100 });
  traceStore.observe({ traceId: "duration-workspace", method: "workspace.read", stage: "workspace_target_resolved", timestamp: 140 });

  const summary = traceStore.getSummary();
  expect(summary.stageDurations.aggregates).toEqual([
    expect.objectContaining({
      method: "workspace.read",
      previousStage: "started",
      stage: "workspace_target_resolved",
      count: 1,
      sumMs: 40,
    }),
  ]);
});

test("query runtime trace store can disable duration aggregation without changing trace diagnostics", () => {
  const traceStore = new QueryRuntimeTraceStore({
    enableStageDurationAggregation: false,
  });

  traceStore.observe({ traceId: "duration-disabled", method: "message.send", stage: "started", timestamp: 0 });
  traceStore.observe({ traceId: "duration-disabled", method: "message.send", stage: "request_validated", timestamp: 20 });

  const summary = traceStore.getSummary();
  expect(summary.stageDurations).toMatchObject({
    available: false,
    aggregateCount: 0,
    aggregates: [],
    slowest: [],
  });
  expect(summary.traces[0]).toMatchObject({
    traceId: "duration-disabled",
    stageCount: 2,
    latestStage: "request_validated",
  });
});

test("query runtime trace store derives stop diagnostics for runs that are still active after stop", async () => {
  const traceStore = new QueryRuntimeTraceStore({
    maxTraces: 8,
    maxStagesPerTrace: 8,
  });

  const messageRuntime = new QueryRuntime({
    method: "message.send",
    traceId: "trace-message-stop-runtime",
    observer: traceStore.createObserver<"message.send">(),
  });
  const stopRuntime = new QueryRuntime({
    method: "conversation.run.stop",
    traceId: "trace-conversation-stop-runtime",
    observer: traceStore.createObserver<"conversation.run.stop">(),
  });

  await messageRuntime.run(async (instance) => {
    instance.mark("request_validated", {
      conversationId: "conv-stop-runtime",
      detail: {
        runId: "run-stop-runtime",
      },
    });
    instance.mark("agent_running", {
      conversationId: "conv-stop-runtime",
    });
    instance.mark("tool_result_emitted", {
      conversationId: "conv-stop-runtime",
      detail: {
        toolName: "inspect_tools",
      },
    });
  });

  await stopRuntime.run(async (instance) => {
    instance.mark("request_validated", {
      conversationId: "conv-stop-runtime",
      detail: {
        runId: "run-stop-runtime",
        reason: "Stopped by user.",
        hasReason: true,
      },
    });
    instance.mark("task_stopped", {
      conversationId: "conv-stop-runtime",
      detail: {
        runId: "run-stop-runtime",
        state: "stop_requested",
        reason: "Stopped by user.",
      },
    });
    instance.mark("completed", {
      conversationId: "conv-stop-runtime",
      detail: {
        accepted: true,
        state: "stop_requested",
        runId: "run-stop-runtime",
        reason: "Stopped by user.",
      },
    });
  });

  const summary = traceStore.getSummary();
  expect(summary.stopDiagnostics).toMatchObject({
    available: true,
    totalRequests: 1,
    acceptedRequests: 1,
    stoppedRuns: 0,
    runningAfterStopCount: 1,
    completedAfterStopCount: 0,
    failedAfterStopCount: 0,
    notFoundCount: 0,
    runMismatchCount: 0,
  });
  expect(summary.stopDiagnostics.recent).toEqual(expect.arrayContaining([
    expect.objectContaining({
      stopTraceId: "trace-conversation-stop-runtime",
      conversationId: "conv-stop-runtime",
      runId: "run-stop-runtime",
      reason: "Stopped by user.",
      outcome: "running_after_stop",
      messageTraceId: "trace-message-stop-runtime",
      messageStatus: "running",
      messageLatestStage: "tool_result_emitted",
    }),
  ]));
});

test("agent run helper captures tool lifecycle and usage summary", async () => {
  const toolCalls: string[] = [];
  const toolResults: Array<{ name: string; success: boolean }> = [];
  const toolEvents: string[] = [];
  const agent: BelldandyAgent = {
    async *run(input) {
      yield {
        type: "tool_call" as const,
        id: "tool-call-1",
        name: "tool.alpha",
        arguments: { mode: "apply" },
      };
      notifyConversationToolEvent(input.conversationId, {
        kind: "tool_config_updated",
      });
      yield {
        type: "tool_result" as const,
        id: "tool-call-1",
        name: "tool.alpha",
        success: true,
        output: "ok",
      };
      yield {
        type: "usage" as const,
        systemPromptTokens: 2,
        contextTokens: 5,
        inputTokens: 11,
        outputTokens: 7,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheHitTokens: 9,
        cacheMissTokens: 3,
        modelCalls: 1,
        cacheSupport: "supported" as const,
        systemPromptFingerprint: "abc123",
        structureSignature: "sig-usage-1",
        warmupCoordination: {
          eligible: true,
          status: "warming" as const,
          recommendation: "delay_if_possible" as const,
          reason: "matching_prefix_recent_but_ordering_risk_present",
          previousAgeMs: 1200,
        },
        cacheFamilyAffinity: {
          status: "aligned" as const,
          familyKey: "family-usage-1",
          previousFamilyKey: "family-usage-1",
          reason: "same_cache_family_as_previous",
        },
        cacheSavingsUsd: 0.0005,
      };
      yield {
        type: "final" as const,
        text: "done",
      };
    },
  };

  const result = await runAgentToCompletionWithLifecycle(agent, {
    conversationId: "conv-agent-run-helper",
    runInput: {
      conversationId: "conv-agent-run-helper",
      text: "hello",
    },
    onToolCall: (item) => {
      toolCalls.push(item.name);
    },
    onToolResult: (item) => {
      toolResults.push({
        name: item.name,
        success: item.success,
      });
    },
    onToolEvent: (detail) => {
      toolEvents.push(String(detail.kind ?? ""));
    },
  });

  expect(result).toMatchObject({
    finalText: "done",
    latestUsage: {
      inputTokens: 11,
      outputTokens: 7,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitTokens: 9,
      cacheMissTokens: 3,
      cacheSupport: "supported",
      systemPromptFingerprint: "abc123",
      structureSignature: "sig-usage-1",
      warmupCoordination: {
        eligible: true,
        status: "warming",
        recommendation: "delay_if_possible",
        reason: "matching_prefix_recent_but_ordering_risk_present",
        previousAgeMs: 1200,
      },
      cacheFamilyAffinity: {
        status: "aligned",
        familyKey: "family-usage-1",
        previousFamilyKey: "family-usage-1",
        reason: "same_cache_family_as_previous",
      },
      cacheSavingsUsd: 0.0005,
    },
    toolCallCount: 1,
    toolResultCount: 1,
    toolEventCount: 1,
  });
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(toolCalls).toEqual(["tool.alpha"]);
  expect(toolResults).toEqual([{ name: "tool.alpha", success: true }]);
  expect(toolEvents).toEqual(["tool_config_updated"]);
});

test("agent stream helper preserves status delta and final summary for streaming runtimes", async () => {
  const statuses: string[] = [];
  const deltas: string[] = [];
  const finals: string[] = [];
  const agent: BelldandyAgent = {
    async *run() {
      yield {
        type: "status" as const,
        status: "running",
      };
      yield {
        type: "delta" as const,
        delta: "hel",
      };
      yield {
        type: "delta" as const,
        delta: "lo",
      };
      yield {
        type: "final" as const,
        text: "hello",
      };
      yield {
        type: "status" as const,
        status: "done",
      };
    },
  };

  const result = await runAgentWithLifecycle(agent, {
    conversationId: "conv-stream-helper",
    runInput: {
      conversationId: "conv-stream-helper",
      text: "ignored",
    },
    onStatus: (item) => {
      statuses.push(item.status);
    },
    onDelta: (item) => {
      deltas.push(item.delta);
    },
    onFinal: (item) => {
      finals.push(item.text);
    },
  });

  expect(statuses).toEqual(["running", "done"]);
  expect(deltas).toEqual(["hel", "lo"]);
  expect(finals).toEqual(["hello"]);
  expect(result).toMatchObject({
    receivedFinal: true,
    fullText: "hello",
    finalText: "hello",
    latestStatus: "done",
    statusCount: 2,
    deltaCount: 2,
  });
});

test("agent stream helper retains and forwards structured budget exhaustion", async () => {
  const exhausted: Array<{ budget: string; limit: number; observed: number }> = [];
  const agent: BelldandyAgent = {
    async *run() {
      yield { type: "status" as const, status: "running" };
      yield {
        type: "budget_exhausted" as const,
        budget: "tool_calls" as const,
        limit: 32,
        observed: 33,
      };
      yield { type: "final" as const, text: "工具调用次数超限" };
      yield { type: "status" as const, status: "error" };
    },
  };

  const result = await runAgentWithLifecycle(agent, {
    conversationId: "conv-budget-exhausted",
    runInput: {
      conversationId: "conv-budget-exhausted",
      text: "ignored",
    },
    onBudgetExhausted: (item) => exhausted.push(item),
  });

  expect(exhausted).toEqual([{ budget: "tool_calls", limit: 32, observed: 33 }]);
  expect(result).toMatchObject({
    budgetExhausted: { budget: "tool_calls", limit: 32, observed: 33 },
    receivedFinal: true,
    latestStatus: "error",
  });
});
