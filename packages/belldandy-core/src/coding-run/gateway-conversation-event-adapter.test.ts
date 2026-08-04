import { describe, expect, it } from "vitest";

import { CODING_RUN_CAPABILITIES, type AgentRunEvent } from "./contracts.js";
import { createGatewayConversationEventAdapter } from "./gateway-conversation-event-adapter.js";

describe("Gateway Conversation coding-run event adapter", () => {
  it("records the accepted automation profile in the start handshake", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createGatewayConversationEventAdapter({
      automationProfile: "bare",
      onEvent: (event) => events.push(event),
    });

    adapter.start({ agentRunId: "run-bare", conversationId: "conversation-bare" });

    expect(events[0]).toMatchObject({
      type: "run.started",
      payload: {
        automationProfile: "bare",
        capabilities: CODING_RUN_CAPABILITIES,
      },
    });
  });

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
      event: "token.usage",
      payload: {
        conversationId: "conversation-123",
        runId: "run-123",
        inputTokens: 25,
        outputTokens: 9,
        totalCostUsd: 0.0125,
        modelCalls: 2,
        providerReportedModelCalls: 2,
        providerRawUsage: {
          inputTokens: 25,
          outputTokens: 9,
          apiKey: "do-not-leak",
        },
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
      "run.usage",
      "run.completed",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events[0]).toMatchObject({
      payload: { status: "running", capabilities: CODING_RUN_CAPABILITIES },
    });
    expect(events[2]).toMatchObject({ payload: { tool: { arguments: { apiKey: "[REDACTED]" } } } });
    expect(events[3]).toMatchObject({ payload: { tool: { output: { token: "[REDACTED]" } } } });
    expect(events[4]).toMatchObject({
      payload: {
        usage: {
          source: "provider_reported",
          input: 25,
          output: 9,
          modelCalls: 2,
          providerReportedModelCalls: 2,
          costUsd: 0.0125,
          completeness: {
            status: "complete",
            reason: "provider_reported_all_model_calls",
            modelCalls: 2,
            providerReportedModelCalls: 2,
          },
        },
      },
    });
    expect(events[4]?.payload).not.toHaveProperty("usage.providerRawUsage");
    expect(JSON.stringify(events[4])).not.toContain("do-not-leak");
    expect(events[5]).toMatchObject({
      payload: {
        usage: {
          status: "complete",
          reason: "provider_reported_all_model_calls",
          modelCalls: 2,
          providerReportedModelCalls: 2,
        },
      },
    });
  });

  it("marks normalized usage as unavailable when Gateway has no provider usage evidence", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createGatewayConversationEventAdapter({ onEvent: (event) => events.push(event) });
    adapter.start({ agentRunId: "run-usage-unavailable", conversationId: "conversation-usage-unavailable" });

    adapter.consume({
      event: "token.usage",
      payload: {
        conversationId: "conversation-usage-unavailable",
        runId: "run-usage-unavailable",
        inputTokens: 7,
        outputTokens: 3,
        totalCostUsd: 0.004,
      },
    });

    expect(events[1]).toMatchObject({
      type: "run.usage",
      payload: {
        usage: {
          source: "unavailable",
          input: 7,
          output: 3,
          costUsd: 0.004,
          completeness: {
            status: "incomplete",
            reason: "reporting_count_unavailable",
          },
        },
      },
    });
  });

  it("marks terminal usage incomplete when Provider usage covers only part of the model calls", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createGatewayConversationEventAdapter({ onEvent: (event) => events.push(event) });
    const binding = { agentRunId: "run-usage-partial", conversationId: "conversation-usage-partial" };
    adapter.start(binding);
    adapter.consume({
      event: "token.usage",
      payload: {
        conversationId: binding.conversationId,
        runId: binding.agentRunId,
        inputTokens: 7,
        outputTokens: 3,
        modelCalls: 2,
        providerReportedModelCalls: 1,
        providerRawUsage: { inputTokens: 7, outputTokens: 3 },
      },
    });
    adapter.consume({
      event: "chat.final",
      payload: { conversationId: binding.conversationId, runId: binding.agentRunId, text: "Done" },
    });

    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      payload: {
        usage: {
          status: "incomplete",
          reason: "provider_usage_missing",
          modelCalls: 2,
          providerReportedModelCalls: 1,
        },
      },
    });
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
        usage: {
          status: "incomplete",
          reason: "usage_not_reported",
        },
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
        commandPreview: {
          kind: "command",
          action: "run",
          commandPlan: {
            executable: "node",
            argv: ["--token=must-not-leak"],
            cwd: ".",
            environmentKeys: ["PRIVATE_TOKEN"],
            network: "none",
            writeScope: "workspace-readonly",
            stdinMode: "closed",
          },
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "permission.requested",
      payload: { permission: { toolCallId: "tool-permission", toolName: "apply_patch" } },
    });
    expect(events[1]?.payload).not.toHaveProperty("arguments");
    expect(events[1]?.payload.permission).not.toHaveProperty("commandPreview");
  });

  it("projects only a sanitized command preview for a pending command permission", () => {
    const events: AgentRunEvent[] = [];
    const adapter = createGatewayConversationEventAdapter({ onEvent: (event) => events.push(event) });
    adapter.start({ agentRunId: "run-command-permission", conversationId: "conversation-command-permission" });
    adapter.consume({
      event: "tool_event",
      payload: {
        conversationId: "conversation-command-permission",
        runId: "run-command-permission",
        kind: "coding_run_permission_requested",
        toolCallId: "tool-command-permission",
        toolName: "command_job",
        commandPreview: {
          kind: "command",
          action: "start",
          commandPlan: {
            executable: "node",
            argv: ["--token", "must-not-leak", "--version"],
            cwd: ".",
            environmentKeys: ["PRIVATE_TOKEN"],
            network: "none",
            writeScope: "workspace-readonly",
            stdinMode: "pty",
          },
        },
      },
    });

    expect(events[1]).toMatchObject({
      type: "permission.requested",
      payload: {
        permission: {
          toolCallId: "tool-command-permission",
          toolName: "command_job",
          commandPreview: {
            kind: "command",
            action: "start",
            commandPlan: { argv: ["--token", "[REDACTED]", "--version"] },
          },
        },
      },
    });
    expect(JSON.stringify(events[1])).not.toContain("must-not-leak");
  });
});
