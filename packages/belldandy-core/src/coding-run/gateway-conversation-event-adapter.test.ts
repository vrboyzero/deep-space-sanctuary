import { describe, expect, it } from "vitest";

import type { AgentRunEvent } from "./contracts.js";
import { createGatewayConversationEventAdapter } from "./gateway-conversation-event-adapter.js";

describe("Gateway Conversation coding-run event adapter", () => {
  it("maps one Gateway run into ordered v1 events and ignores other runs", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createGatewayConversationEventAdapter({
      onEvent: (event) => events.push(event),
      now: () => 1_700_000_000_000,
    });

    adapter.start({ agentRunId: "run-123", conversationId: "conversation-123" });
    adapter.consume({
      event: "chat.delta",
      payload: { conversationId: "other", runId: "run-123", delta: "ignore" },
    });
    adapter.consume({
      event: "agent.status",
      payload: { conversationId: "conversation-123", runId: "run-123", status: "running" },
    });
    adapter.consume({
      event: "tool_call",
      payload: {
        conversationId: "conversation-123",
        runId: "run-123",
        id: "tool-123",
        name: "read_file",
        arguments: { apiKey: "do-not-leak" },
      },
    });
    adapter.consume({
      event: "tool_result",
      payload: {
        conversationId: "conversation-123",
        runId: "run-123",
        id: "tool-123",
        name: "read_file",
        success: true,
        output: { token: "do-not-leak" },
      },
    });
    adapter.consume({
      event: "chat.final",
      payload: { conversationId: "conversation-123", runId: "run-123", text: "Done" },
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "tool.started",
      "tool.completed",
      "run.completed",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events[2]).toMatchObject({ payload: { tool: { arguments: { apiKey: "[REDACTED]" } } } });
    expect(events[3]).toMatchObject({ payload: { tool: { output: { token: "[REDACTED]" } } } });
  });

  it("turns an errored Gateway status followed by chat.final into a failed run", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createGatewayConversationEventAdapter({
      onEvent: (event) => events.push(event),
    });

    adapter.start({ agentRunId: "run-failed", conversationId: "conversation-failed" });
    adapter.consume({
      event: "agent.budget_exhausted",
      payload: {
        conversationId: "conversation-failed",
        runId: "run-failed",
        budget: "token",
        limit: 1,
        observed: 2,
      },
    });
    adapter.consume({
      event: "agent.status",
      payload: { conversationId: "conversation-failed", runId: "run-failed", status: "error" },
    });
    adapter.consume({
      event: "chat.final",
      payload: { conversationId: "conversation-failed", runId: "run-failed", text: "token=do-not-leak" },
    });
    adapter.consume({
      event: "chat.delta",
      payload: { conversationId: "conversation-failed", runId: "run-failed", delta: "late" },
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.budget_exhausted",
      "run.status",
      "run.failed",
    ]);
    expect(events[3]).toMatchObject({
      payload: {
        error: {
          code: "budget_exhausted",
          message: "token=[REDACTED]",
        },
      },
    });
  });

  it("projects a pending permission as a safe event without tool arguments", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createGatewayConversationEventAdapter({ onEvent: (event) => events.push(event) });
    adapter.start({ agentRunId: "run-permission", conversationId: "conversation-permission" });
    adapter.consume({
      event: "tool_event",
      payload: {
        conversationId: "conversation-permission",
        runId: "run-permission",
        kind: "coding_run_permission_requested",
        toolCallId: "tool-permission",
        toolName: "apply_patch",
        arguments: { secret: "must-not-leak" },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "permission.requested",
      payload: { permission: { toolCallId: "tool-permission", toolName: "apply_patch" } },
    });
    expect(events[1]?.payload).not.toHaveProperty("arguments");
  });
});
