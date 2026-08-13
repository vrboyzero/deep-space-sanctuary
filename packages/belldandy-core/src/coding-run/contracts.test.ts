import { describe, expect, it } from "vitest";

import {
  CODING_RUN_CAPABILITIES,
  CODING_RUN_PROTOCOL_VERSION,
  createAgentRunEventSequencer,
  isAgentRunEventV1,
  isCodingRunCapabilitiesV1,
  isCodingRunUsageCompletenessV1,
  isConversationFollowUpStatusQueryV1,
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
  it("publishes an exact v1 Headless capability and terminal usage contract", () => {
    expect(CODING_RUN_CAPABILITIES).toEqual({
      schemaVersion: "coding-run-capabilities/v1",
      protocolVersion: "v1",
      eventStream: {
        sequence: "continuous",
        terminal: "exactly_one",
        usageCompleteness: "terminal",
      },
      observability: {
        trace: {
          schemaVersion: "coding-run-trace/v1",
          contentMode: "none",
          bodyFields: [],
        },
      },
    });
    expect(isCodingRunCapabilitiesV1(CODING_RUN_CAPABILITIES)).toBe(true);
    expect(isCodingRunCapabilitiesV1({
      schemaVersion: "coding-run-capabilities/v1",
      protocolVersion: "v1",
      eventStream: {
        sequence: "continuous",
        terminal: "exactly_one",
        usageCompleteness: "terminal",
      },
    })).toBe(true);
    expect(isCodingRunCapabilitiesV1({
      ...CODING_RUN_CAPABILITIES,
      eventStream: { ...CODING_RUN_CAPABILITIES.eventStream, terminal: "best_effort" },
    })).toBe(false);
    expect(isCodingRunCapabilitiesV1({
      ...CODING_RUN_CAPABILITIES,
      observability: {
        trace: { ...CODING_RUN_CAPABILITIES.observability.trace, bodyFields: ["prompt"] },
      },
    })).toBe(false);

    expect(isCodingRunUsageCompletenessV1({
      status: "complete",
      reason: "provider_reported_all_model_calls",
      modelCalls: 2,
      providerReportedModelCalls: 2,
    })).toBe(true);
    expect(isCodingRunUsageCompletenessV1({
      status: "incomplete",
      reason: "provider_usage_missing",
      modelCalls: 2,
      providerReportedModelCalls: 1,
    })).toBe(true);
    expect(isCodingRunUsageCompletenessV1({
      status: "complete",
      reason: "provider_reported_all_model_calls",
      modelCalls: 2,
      providerReportedModelCalls: 1,
    })).toBe(false);
  });

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

  it("keeps sequenced event timestamps monotonic when the system clock moves backwards", () => {
    const timestamps = [1_000, 900, 1_100];
    const events: AgentRunEvent[] = [];
    const sequencer = createAgentRunEventSequencer({
      source: "conversation",
      binding: {
        conversationId: "conversation-clock",
        agentRunId: "run-clock",
      },
      now: () => timestamps.shift() ?? 1_100,
      onEvent: (event) => events.push(event),
    });

    sequencer.emit("run.started", { status: "running" });
    sequencer.emit("run.status", { status: "running" });
    sequencer.emit("run.completed", {});

    expect(events.map((event) => event.timestampMs)).toEqual([1_000, 1_000, 1_100]);
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
      operation: "conversation.follow_up",
      binding: { conversationId: "conversation-123", agentRunId: "run-123" },
      prompt: "run the focused tests next",
      idempotencyKey: "follow-up-request-123",
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.replace",
      binding: { conversationId: "conversation-123", agentRunId: "run-123" },
      prompt: "replace the current turn",
      idempotencyKey: "replace-request-123",
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
      operation: "conversation.follow_up",
      binding: { conversationId: "conversation-123", agentRunId: "run-123" },
      prompt: "run the focused tests next",
    })).toBe(false);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.replace",
      binding: { conversationId: "conversation-123", agentRunId: "run-123" },
      prompt: "replace the current turn",
      idempotencyKey: "",
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

  it("accepts exact Conversation steer controls and rejects unbounded or unknown input", () => {
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.steer",
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "focus on one failing test",
      idempotencyKey: "request-1",
    })).toBe(true);
    expect(isRunControlV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.steer",
      binding: { conversationId: "conversation-a", agentRunId: "run-a" },
      prompt: "focus",
      idempotencyKey: "request-1",
      immediateProviderInjection: true,
    })).toBe(false);
  });

  it("validates an exact follow-up command status query", () => {
    expect(isConversationFollowUpStatusQueryV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      binding: { conversationId: "conversation-123", agentRunId: "run-123" },
      commandId: "follow-up-123",
    })).toBe(true);
    expect(isConversationFollowUpStatusQueryV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      binding: { conversationId: "conversation-123" },
      commandId: "follow-up-123",
    })).toBe(false);
    expect(isConversationFollowUpStatusQueryV1({
      version: CODING_RUN_PROTOCOL_VERSION,
      binding: { conversationId: "conversation-123", agentRunId: "run-123" },
      commandId: "follow-up-123",
      includePrompt: true,
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

  it("redacts every structured command environment value regardless of its field name", () => {
    expect(sanitizeCodingRunData({
      commandPlan: {
        executable: "node",
        env: {
          PRIVATE_TOKEN: "must-not-leak",
          LOG_LEVEL: "debug",
        },
      },
    })).toEqual({
      commandPlan: {
        executable: "node",
        env: {
          PRIVATE_TOKEN: "[REDACTED]",
          LOG_LEVEL: "[REDACTED]",
        },
      },
    });
  });
});
