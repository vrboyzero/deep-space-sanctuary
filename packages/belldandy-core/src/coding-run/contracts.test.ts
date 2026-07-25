import { describe, expect, it } from "vitest";

import {
  CODING_RUN_PROTOCOL_VERSION,
  isAgentRunEventV1,
  isRunControlV1,
  sanitizeCodingRunData,
  type AgentRunEvent,
} from "./contracts.js";

function createConversationEvent(): AgentRunEvent {
  return {
    version: CODING_RUN_PROTOCOL_VERSION,
    seq: 1,
    timestampMs: 1_700_000_000_000,
    source: "conversation",
    binding: {
      agentRunId: "run-123",
      conversationId: "conversation-123",
    },
    type: "run.started",
    payload: { status: "running" },
  };
}

describe("coding-run public protocol boundary", () => {
  it("accepts only a complete, JSON-serializable v1 Conversation event", () => {
    const valid = createConversationEvent();

    expect(isAgentRunEventV1(valid)).toBe(true);
    expect(isAgentRunEventV1({
      ...valid,
      binding: { agentRunId: valid.binding.agentRunId },
    })).toBe(false);
    expect(isAgentRunEventV1({
      ...valid,
      binding: { ...valid.binding, unexpected: true },
    })).toBe(false);
    expect(isAgentRunEventV1({
      ...valid,
      payload: { elapsedMs: Number.POSITIVE_INFINITY },
    })).toBe(false);
    expect(isAgentRunEventV1({ ...valid, unexpected: true })).toBe(false);
  });

  it("accepts the safe permission-requested event type declared by the v1 protocol", () => {
    expect(isAgentRunEventV1({
      ...createConversationEvent(),
      type: "permission.requested",
      payload: {
        permission: {
          toolCallId: "tool-123",
          toolName: "apply_patch",
        },
      },
    })).toBe(true);
  });

  it("requires source-scoped control bindings and rejects unknown fields", () => {
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "cancel",
      binding: { agentRunId: "run-123", conversationId: "conversation-123" },
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.continue",
      binding: { conversationId: "conversation-123" },
      prompt: "continue",
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "permission.respond",
      binding: { agentRunId: "run-123", worktreeId: "worktree-123" },
      toolCallId: "tool-123",
      decision: "deny",
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "goal.resume",
      binding: { agentRunId: "goal-run-123", goal: { goalId: "goal-123", nodeId: "node-123" } },
      checkpointId: "checkpoint-123",
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "workflow.resume",
      binding: { agentRunId: "workflow-call-123", workflow: { journalId: "journal-123" } },
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "subtask.cancel",
      binding: { agentRunId: "agent-session-123", subtask: { taskId: "task-123" } },
      reason: "stop",
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "cancel",
      binding: { agentRunId: "run-123" },
    })).toBe(false);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.continue",
      binding: { conversationId: "conversation-123" },
      prompt: "continue",
      extra: true,
    })).toBe(false);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "goal.resume",
      binding: { agentRunId: "goal-run-123", goal: { goalId: "goal-123" }, subtask: { taskId: "task-123" } },
    })).toBe(false);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "workflow.cancel",
      binding: { agentRunId: "workflow-call-123", workflow: { journalId: "journal-123" } },
      reason: 1,
    })).toBe(false);
  });

  it("turns non-JSON values into deterministic, safe payload values", () => {
    const payload = sanitizeCodingRunData({
      apiKey: "do-not-leak",
      infinity: Number.POSITIVE_INFINITY,
      unsupported: undefined,
      bigint: 9n,
      callback: () => undefined,
      nested: { sessionToken: "also-do-not-leak" },
    });

    expect(payload).toEqual({
      apiKey: "[REDACTED]",
      infinity: null,
      unsupported: "[UNSERIALIZABLE]",
      bigint: "9",
      callback: "[UNSERIALIZABLE]",
      nested: { sessionToken: "[REDACTED]" },
    });
    expect(() => JSON.stringify(payload)).not.toThrow();
  });
});
