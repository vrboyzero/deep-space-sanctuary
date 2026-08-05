import { describe, expect, it } from "vitest";

import type { AgentRunEvent } from "./contracts.js";
import {
  CODING_RUN_TRACE_POLICY,
  isCodingRunTraceEventV1,
  projectCodingRunTraceEvents,
  validateCodingRunTraceEvents,
} from "./trace.js";

describe("coding run metadata trace", () => {
  it("correlates run, prompt, agent, tool, policy, and recovery without recording content", () => {
    const secret = "trace-must-not-record-this-secret";
    const binding = {
      agentRunId: "run-trace-1",
      conversationId: "conversation-trace-1",
      workspaceCheckpoint: {
        workspaceCheckpointId: "checkpoint-trace-1",
        recoveryGuarantee: "exact" as const,
      },
    };
    const events: AgentRunEvent[] = [
      event(1, "run.started", binding, {
        status: "running",
        traceContext: {
          promptId: "prompt-trace-1",
          agentId: "coding-agent-trace-1",
        },
        prompt: secret,
      }),
      event(2, "message.delta", binding, { delta: secret }),
      event(3, "tool.started", binding, {
        tool: {
          id: "tool-trace-1",
          name: "file_edit",
          arguments: { path: `private/${secret}.txt`, oldText: secret, newText: secret },
        },
      }),
      event(4, "permission.requested", binding, {
        permission: {
          toolCallId: "tool-trace-1",
          toolName: "file_edit",
          commandPreview: { argv: [`--token=${secret}`] },
        },
      }),
      event(5, "tool.completed", binding, {
        tool: {
          id: "tool-trace-1",
          name: "file_edit",
          success: false,
          failureKind: "permission_or_policy",
          output: { fileContent: secret },
          error: secret,
        },
      }),
      event(6, "run.interrupted", binding, {
        error: { code: "gateway_unavailable", message: secret },
        interrupted: { reason: secret, hadPartialResponse: true },
        usage: { status: "incomplete", reason: "usage_not_reported" },
      }),
    ];

    const trace = projectCodingRunTraceEvents(events);

    expect(validateCodingRunTraceEvents(trace)).toMatchObject({
      schemaVersion: "coding-run-trace/v1",
      contentMode: "none",
      binding: {
        agentRunId: binding.agentRunId,
        conversationId: binding.conversationId,
      },
      sourceEventCount: events.length,
      terminal: "run.interrupted",
    });
    expect(trace.map((item) => item.seq)).toEqual(trace.map((_, index) => index + 1));
    expect(new Set(trace.map((item) => item.domain))).toEqual(new Set([
      "run",
      "prompt",
      "agent",
      "tool",
      "policy",
      "recovery",
    ]));
    expect(trace.every((item) => item.content.mode === "none")).toBe(true);
    expect(trace.find((item) => item.event === "prompt.accepted")?.correlation).toMatchObject({
      promptId: "prompt-trace-1",
      agentId: "coding-agent-trace-1",
    });
    expect(trace.find((item) => item.event === "policy.approval_requested")?.correlation).toMatchObject({
      toolCallId: "tool-trace-1",
      policyId: "policy:run-trace-1:tool-trace-1",
    });
    expect(trace.find((item) => item.event === "recovery.interrupted")?.correlation).toMatchObject({
      recoveryId: "checkpoint-trace-1",
      workspaceCheckpointId: "checkpoint-trace-1",
    });
    expect(trace.every(isCodingRunTraceEventV1)).toBe(true);
    expect(JSON.stringify(trace)).not.toContain(secret);
    expect(JSON.stringify(trace)).not.toContain("fileContent");
    expect(JSON.stringify(trace)).not.toContain("commandPreview");
  });

  it("derives bounded trace-local correlation ids when optional source ids are unavailable", () => {
    const binding = { agentRunId: "run-derived", conversationId: "conversation-derived" };
    const trace = projectCodingRunTraceEvents([
      event(1, "run.started", binding, { status: "running" }),
      event(2, "run.completed", binding, {
        output: { text: "must-not-enter-trace" },
        usage: { status: "incomplete", reason: "usage_not_reported" },
      }),
    ]);

    expect(trace[0]?.correlation).toMatchObject({
      promptId: "prompt:run-derived",
      agentId: "unknown",
    });
    expect(trace.at(-1)).toMatchObject({
      domain: "run",
      event: "run.completed",
      outcome: "completed",
    });
    expect(JSON.stringify(trace)).not.toContain("must-not-enter-trace");
  });

  it("rejects trace records that add undeclared body-like fields", () => {
    const binding = { agentRunId: "run-invalid", conversationId: "conversation-invalid" };
    const [record] = projectCodingRunTraceEvents([
      event(1, "run.started", binding, { status: "running" }),
      event(2, "run.completed", binding, {
        usage: { status: "incomplete", reason: "usage_not_reported" },
      }),
    ]);

    expect(CODING_RUN_TRACE_POLICY).toEqual({
      schemaVersion: "coding-run-trace/v1",
      contentMode: "none",
      bodyFields: [],
    });
    expect(isCodingRunTraceEventV1({ ...record, prompt: "must be rejected" })).toBe(false);
    expect(isCodingRunTraceEventV1({
      ...record,
      content: { mode: "none", text: "must be rejected" },
    })).toBe(false);
    expect(isCodingRunTraceEventV1({ ...record, domain: "tool" })).toBe(false);
  });

  it("keeps derived correlation ids bounded and rejects source sequence gaps", () => {
    const longRunId = `run-${"a".repeat(240)}`;
    const longToolCallId = `tool-${"b".repeat(239)}`;
    const binding = { agentRunId: longRunId, conversationId: "conversation-bounded" };
    const trace = projectCodingRunTraceEvents([
      event(1, "run.started", binding, { status: "running" }),
      event(2, "permission.requested", binding, {
        permission: { toolCallId: longToolCallId, toolName: "file_edit" },
      }),
      event(3, "run.completed", binding, {
        usage: { status: "incomplete", reason: "usage_not_reported" },
      }),
    ]);

    expect(trace.every(isCodingRunTraceEventV1)).toBe(true);
    expect(trace.find((item) => item.correlation.policyId)?.correlation.policyId?.length)
      .toBeLessThanOrEqual(256);
    expect(trace[0]?.correlation.promptId.length).toBeLessThanOrEqual(256);

    const withGap = trace.map((item) => item.sourceSeq === 2 ? { ...item, sourceSeq: 3 } : item);
    expect(() => validateCodingRunTraceEvents(withGap)).toThrow(/source sequence/i);
  });
});

function event(
  seq: number,
  type: AgentRunEvent["type"],
  binding: AgentRunEvent["binding"],
  payload: Record<string, unknown>,
): AgentRunEvent {
  return {
    version: "v1",
    seq,
    timestampMs: 1_700_000_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  };
}
