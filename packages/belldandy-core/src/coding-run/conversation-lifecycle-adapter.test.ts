import { describe, expect, it } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { runAgentWithLifecycle } from "../query-runtime-agent-run.js";
import {
  CODING_RUN_EXIT_CODES,
  createAgentRunEventSequencer,
  isAgentRunEventV1,
  type AgentRunEvent,
} from "./contracts.js";
import { createConversationLifecycleEventAdapter } from "./conversation-lifecycle-adapter.js";

describe("Conversation lifecycle coding-run adapter", () => {
  it("preserves the existing runAgentWithLifecycle callback order", async () => {
    const events: AgentRunEvent[] = [];
    const adapter = createConversationLifecycleEventAdapter({
      binding: { agentRunId: "run-runtime", conversationId: "conv-runtime" },
      onEvent: (event) => events.push(event),
      now: () => 1_700_000_000_000,
    });
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "status" as const, status: "running" as const };
        yield { type: "delta" as const, delta: "Working" };
        yield { type: "tool_call" as const, id: "tool-runtime", name: "read_file", arguments: {} };
        yield { type: "tool_result" as const, id: "tool-runtime", name: "read_file", success: true, output: "ok" };
        yield { type: "final" as const, text: "Done" };
      },
    };

    adapter.start();
    const result = await runAgentWithLifecycle(agent, {
      conversationId: "conv-runtime",
      runInput: { conversationId: "conv-runtime", text: "hello" },
      ...adapter.handlers,
    });

    expect(result.receivedFinal).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "message.delta",
      "tool.started",
      "tool.completed",
      "run.completed",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("maps a completed Conversation run to ordered, redacted v1 events", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createConversationLifecycleEventAdapter({
      binding: {
        agentRunId: "run-123",
        conversationId: "conv-123",
      },
      onEvent: (event) => events.push(event),
      now: () => 1_700_000_000_000,
    });

    adapter.start();
    adapter.handlers.onStatus({ status: "running" });
    adapter.handlers.onDelta({ delta: "Working" });
    adapter.handlers.onToolCall({
      id: "tool-1",
      name: "read_file",
      arguments: { path: "src/index.ts", apiKey: "do-not-leak" },
    });
    adapter.handlers.onToolResult({
      id: "tool-1",
      name: "read_file",
      success: true,
      output: { token: "also-not-visible" },
    });
    adapter.handlers.onFinal({ text: "Done" });
    adapter.handlers.onStatus({ status: "idle" });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "message.delta",
      "tool.started",
      "tool.completed",
      "run.completed",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.every(isAgentRunEventV1)).toBe(true);
    expect(events[0]).toMatchObject({
      version: "v1",
      source: "conversation",
      binding: { agentRunId: "run-123", conversationId: "conv-123" },
    });
    expect(events[3]).toMatchObject({
      payload: {
        tool: {
          arguments: { apiKey: "[REDACTED]" },
        },
      },
    });
    expect(events[4]).toMatchObject({
      payload: {
        tool: {
          output: { token: "[REDACTED]" },
        },
      },
    });
  });

  it("keeps an interrupted run terminal and does not manufacture a completion event", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createConversationLifecycleEventAdapter({
      binding: { agentRunId: "run-interrupted", conversationId: "conv-interrupted" },
      onEvent: (event) => events.push(event),
    });

    adapter.start();
    adapter.handlers.onDelta({ delta: "partial" });
    adapter.handlers.onInterrupted({
      reason: "provider_stream_error",
      error: "token=do-not-leak",
      committed: true,
      partialText: "partial",
    });
    adapter.handlers.onFinal({ text: "late final" });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.delta",
      "run.interrupted",
    ]);
    expect(events[2]).toMatchObject({
      payload: {
        error: { message: "token=[REDACTED]" },
        interrupted: { partialText: "partial" },
      },
    });
  });

  it("rejects invalid bindings and reserves stable CLI exit codes", () => {
    expect(() => createAgentRunEventSequencer({
      source: "conversation",
      binding: { agentRunId: "run-without-conversation" },
      onEvent: () => undefined,
    })).toThrow("conversationId");
    expect(CODING_RUN_EXIT_CODES).toEqual({
      success: 0,
      invalidInput: 2,
      permissionDenied: 3,
      executionFailed: 4,
      cancelled: 5,
      outputSchemaInvalid: 6,
      gatewayUnavailable: 7,
      interrupted: 8,
    });
  });
});
