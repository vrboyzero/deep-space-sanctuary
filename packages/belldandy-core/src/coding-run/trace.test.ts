import { describe, expect, it } from "vitest";

import type { AgentRunEvent } from "./contracts.js";
import type { TaskProjection, TaskProjectionStatus } from "./task-projection.js";
import {
  CODING_RUN_TRACE_POLICY,
  isCodingRunTraceEventV1,
  projectCodingRunTraceEvents,
  validateCodingRunTraceEvents,
} from "./trace.js";
import { parseTaskEfficiencyEvidence } from "./task-efficiency-metrics.js";

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

    const withTimeRegression = trace.map((item) => item.event === "run.completed"
      ? { ...item, timestampMs: trace[0]!.timestampMs - 1 }
      : item);
    expect(() => validateCodingRunTraceEvents(withTimeRegression)).toThrow(/timestamp/i);
  });

  it("summarizes no-content task efficiency from trace and complete TaskProjection evidence", () => {
    const binding = { agentRunId: "run-efficiency", conversationId: "conversation-efficiency" };
    const events: AgentRunEvent[] = [
      eventAt(1, 1_000, "run.started", binding, { status: "running" }),
      eventAt(2, 1_100, "permission.requested", binding, {
        permission: { toolCallId: "tool-efficiency", toolName: "file_edit" },
      }),
      eventAt(3, 1_200, "tool.started", binding, {
        tool: { id: "tool-efficiency", name: "file_edit" },
      }),
      eventAt(4, 1_300, "tool.completed", binding, {
        tool: { id: "tool-efficiency", name: "file_edit", success: true },
      }),
      eventAt(5, 2_500, "run.usage", binding, {
        usage: {
          status: "complete",
          reason: "provider_reported_all_model_calls",
          modelCalls: 2,
          providerReportedModelCalls: 2,
        },
      }),
      eventAt(6, 3_000, "run.completed", binding, {
        usage: {
          status: "complete",
          reason: "provider_reported_all_model_calls",
          modelCalls: 2,
          providerReportedModelCalls: 2,
        },
      }),
    ];
    const trace = projectCodingRunTraceEvents(events);
    const projectionTimeline = {
      coverage: "complete" as const,
      items: [
        projectionAt("running", 1_000),
        projectionAt("needs_input", 1_100),
        projectionAt("running", 1_400),
        projectionAt("blocked", 1_600),
        projectionAt("running", 1_800),
        projectionAt("verifying", 2_200),
        projectionAt("completed", 3_000),
      ],
    };

    const validation = validateCodingRunTraceEvents(trace, {
      projectionTimeline,
      humanInterventionEvidence: {
        source: "human_response",
        coverage: "complete",
        binding,
        count: 1,
      },
    });

    expect(validation.efficiency).toEqual({
      schemaVersion: "task-efficiency-metrics/v1",
      contentMode: "none",
      status: "complete",
      completionLatencyMs: 2_000,
      blockedDurationMs: 200,
      needsInputDurationMs: 300,
      humanInterventionCount: 1,
      contextCallCount: 2,
      toolCallCount: 1,
      validationDurationMs: 800,
      usageCompleteness: {
        status: "complete",
        reason: "provider_reported_all_model_calls",
        modelCalls: 2,
        providerReportedModelCalls: 2,
      },
      missingMetrics: [],
    });
    expect(JSON.stringify(validation.efficiency)).not.toMatch(/prompt|toolArgs|fileContent|output|error/);
  });

  it("marks task efficiency incomplete instead of inventing missing projection or usage metrics", () => {
    const binding = { agentRunId: "run-efficiency-missing", conversationId: "conversation-efficiency-missing" };
    const trace = projectCodingRunTraceEvents([
      eventAt(1, 5_000, "run.started", binding, { status: "running" }),
      eventAt(2, 5_250, "run.completed", binding, {}),
    ]);

    expect(validateCodingRunTraceEvents(trace).efficiency).toEqual({
      schemaVersion: "task-efficiency-metrics/v1",
      contentMode: "none",
      status: "incomplete",
      completionLatencyMs: 250,
      toolCallCount: 0,
      usageCompleteness: {
        status: "incomplete",
        reason: "usage_not_reported",
      },
      missingMetrics: [
        "blockedDurationMs",
        "needsInputDurationMs",
        "humanInterventionCount",
        "contextCallCount",
        "validationDurationMs",
        "usageCompleteness",
      ],
    });
  });

  it("uses broker status coverage without inventing unobserved blocked or validation durations", () => {
    const binding = { agentRunId: "run-broker-efficiency", conversationId: "conversation-broker-efficiency" };
    const trace = projectCodingRunTraceEvents([
      eventAt(1, 1_000, "run.started", binding, { status: "running" }),
      eventAt(2, 1_100, "permission.requested", binding, {
        permission: { toolCallId: "tool-broker", toolName: "file_edit" },
      }),
      eventAt(3, 1_500, "run.completed", binding, {
        usage: {
          status: "complete",
          reason: "provider_reported_all_model_calls",
          modelCalls: 1,
          providerReportedModelCalls: 1,
        },
      }),
    ]);

    const validation = validateCodingRunTraceEvents(trace, {
      projectionTimeline: {
        source: "gateway_event_broker",
        coverage: "complete",
        binding,
        statusCoverage: ["needs_input"],
        items: [
          { status: "running", observedAtMs: 1_000 },
          { status: "needs_input", observedAtMs: 1_100 },
          { status: "running", observedAtMs: 1_300 },
          { status: "completed", observedAtMs: 1_500 },
        ],
      },
      humanInterventionEvidence: {
        source: "human_response",
        coverage: "complete",
        binding,
        count: 0,
      },
    });

    expect(validation.efficiency).toMatchObject({
      status: "incomplete",
      needsInputDurationMs: 200,
      humanInterventionCount: 0,
      missingMetrics: ["blockedDurationMs", "validationDurationMs"],
    });
    expect(validation.efficiency).not.toHaveProperty("blockedDurationMs");
    expect(validation.efficiency).not.toHaveProperty("validationDurationMs");
  });

  it("rejects cross-bound, non-monotonic, or lifecycle-incomplete projection timelines", () => {
    const binding = { agentRunId: "run-efficiency", conversationId: "conversation-efficiency" };
    const trace = projectCodingRunTraceEvents([
      eventAt(1, 1_000, "run.started", binding, { status: "running" }),
      eventAt(2, 3_000, "run.completed", binding, {
        usage: {
          status: "complete",
          reason: "provider_reported_all_model_calls",
          modelCalls: 1,
          providerReportedModelCalls: 1,
        },
      }),
    ]);
    const completeItems = [
      projectionAt("running", 1_000),
      projectionAt("completed", 3_000),
    ];

    const crossBound = completeItems.map((item, index) => index === 1
      ? {
          ...item,
          owner: {
            ...item.owner,
            binding: { ...item.owner.binding, agentRunId: "another-run" },
          },
        }
      : item);
    expect(() => validateCodingRunTraceEvents(trace, {
      projectionTimeline: { coverage: "complete", items: crossBound },
    })).toThrow(/binding or order/i);

    expect(() => validateCodingRunTraceEvents(trace, {
      projectionTimeline: {
        coverage: "complete",
        items: [projectionAt("running", 1_000), projectionAt("completed", 1_000)],
      },
    })).toThrow(/binding or order/i);

    expect(() => validateCodingRunTraceEvents(trace, {
      projectionTimeline: {
        coverage: "complete",
        items: [projectionAt("running", 1_001), projectionAt("completed", 3_000)],
      },
    })).toThrow(/cover the trace lifecycle/i);

    expect(() => validateCodingRunTraceEvents(trace, {
      projectionTimeline: {
        coverage: "complete",
        items: [projectionAt("running", 1_000), projectionAt("completed", 2_999)],
      },
    })).toThrow(/cover the trace lifecycle/i);

    expect(() => validateCodingRunTraceEvents(trace, {
      humanInterventionEvidence: {
        source: "human_response",
        coverage: "complete",
        binding,
        count: -1,
      },
    })).toThrow(/human intervention evidence/i);

    expect(() => validateCodingRunTraceEvents(trace, {
      humanInterventionEvidence: {
        source: "human_response",
        coverage: "complete",
        binding: { ...binding, agentRunId: "another-run" },
        count: 1,
      },
    })).toThrow(/human intervention evidence/i);
  });

  it("rejects cross-bound or body-bearing broker efficiency evidence", () => {
    const binding = { agentRunId: "run-evidence-parser", conversationId: "conversation-evidence-parser" };
    const evidence = {
      status: "complete",
      projectionTimeline: {
        source: "gateway_event_broker",
        coverage: "complete",
        binding,
        statusCoverage: ["needs_input"],
        items: [
          { status: "running", observedAtMs: 1_000 },
          { status: "completed", observedAtMs: 1_500 },
        ],
      },
      humanInterventionEvidence: {
        source: "human_response",
        coverage: "complete",
        binding,
        count: 0,
      },
    };

    expect(parseTaskEfficiencyEvidence(evidence, binding)).toEqual(evidence);
    expect(parseTaskEfficiencyEvidence({ ...evidence, prompt: "private" }, binding)).toBeUndefined();
    expect(parseTaskEfficiencyEvidence(evidence, { ...binding, agentRunId: "run-other" })).toBeUndefined();
    expect(parseTaskEfficiencyEvidence({
      ...evidence,
      projectionTimeline: {
        ...evidence.projectionTimeline,
        items: [
          { status: "running", observedAtMs: 1_500 },
          { status: "completed", observedAtMs: 1_000 },
        ],
      },
    }, binding)).toBeUndefined();
  });
});

function projectionAt(status: TaskProjectionStatus, observedAtMs: number) {
  const reason = status === "needs_input"
    ? { reasonCategory: "awaiting_input" as const, reasonCode: "awaiting_user_review" }
    : status === "blocked"
      ? { reasonCategory: "owner_blocked" as const, reasonCode: "owner_reported_blocked" }
      : status === "verifying"
        ? { reasonCategory: "verification" as const, reasonCode: "validation_in_progress" }
        : status === "completed"
          ? { reasonCategory: "completed" as const, reasonCode: "owner_completed" }
          : { reasonCategory: "running" as const, reasonCode: "owner_running" };
  const allowedActions = status === "needs_input"
    ? ["observe", "respond"] as const
    : status === "blocked"
      ? ["observe"] as const
      : status === "verifying"
        ? ["observe", "cancel"] as const
        : status === "completed"
          ? ["observe"] as const
          : ["observe", "cancel"] as const;
  return {
    schemaVersion: "task-projection/v1",
    taskId: "conversation:conversation-efficiency:run-efficiency",
    status,
    owner: {
      source: "conversation",
      binding: { agentRunId: "run-efficiency", conversationId: "conversation-efficiency" },
    },
    evidence: { observedAtMs, ...reason },
    allowedActions: [...allowedActions],
    capabilityClosure: {
      schemaVersion: "task-capability-closure/v1",
      evaluatedAtMs: observedAtMs,
      status: "satisfied",
      capabilities: Object.fromEntries([
        "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal",
        "trace", "verifier", "mcp", "plugin", "skill",
      ].map((name) => [name, { required: false, state: "available" }])) as any,
    },
  } satisfies TaskProjection;
}

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

function eventAt(
  seq: number,
  timestampMs: number,
  type: AgentRunEvent["type"],
  binding: AgentRunEvent["binding"],
  payload: Record<string, unknown>,
): AgentRunEvent {
  return {
    version: "v1",
    seq,
    timestampMs,
    source: "conversation",
    binding,
    type,
    payload,
  };
}
