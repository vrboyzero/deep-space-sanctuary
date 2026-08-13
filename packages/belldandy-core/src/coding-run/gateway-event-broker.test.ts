import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCodingRunGatewayEventBroker } from "./gateway-event-broker.js";
import { CodingRunReconciliationJournal } from "./reconciliation-journal.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("CodingRunGatewayEventBroker", () => {
  it("exports a complete no-content observation for a retained permission wait lifecycle", () => {
    let now = 1_000;
    const broker = createCodingRunGatewayEventBroker({ now: () => now });
    const binding = { conversationId: "conversation-observation", agentRunId: "run-observation" };

    expect(broker.registerConversationRun(binding)).toBe(true);
    now = 1_100;
    expect(broker.publishGatewayEvent({
      event: "tool_event",
      payload: {
        conversationId: binding.conversationId,
        runId: binding.agentRunId,
        kind: "coding_run_permission_requested",
        toolCallId: "tool-observation",
        toolName: "file_edit",
      },
    })).toBe(true);
    now = 1_400;
    expect(broker.observePermissionSettled(binding, {
      toolCallId: "tool-observation",
      responderKind: "human",
    })).toBe(true);
    now = 2_000;
    expect(broker.publishGatewayEvent({
      event: "chat.final",
      payload: { conversationId: binding.conversationId, runId: binding.agentRunId, text: "private" },
    })).toBe(true);

    expect(broker.readEfficiencyEvidence(binding)).toEqual({
      status: "complete",
      projectionTimeline: {
        source: "gateway_event_broker",
        coverage: "complete",
        binding,
        statusCoverage: ["needs_input"],
        items: [
          { status: "running", observedAtMs: 1_000 },
          { status: "needs_input", observedAtMs: 1_100 },
          { status: "running", observedAtMs: 1_400 },
          { status: "completed", observedAtMs: 2_000 },
        ],
      },
      humanInterventionEvidence: {
        source: "human_response",
        coverage: "complete",
        binding,
        count: 1,
      },
    });
    expect(JSON.stringify(broker.readEfficiencyEvidence(binding))).not.toContain("private");
  });

  it("keeps evidence incomplete when the lifecycle is active, clipped, or cross-bound", () => {
    let now = 3_000;
    const binding = { conversationId: "conversation-coverage", agentRunId: "run-coverage" };
    const broker = createCodingRunGatewayEventBroker({ maxEventsPerRun: 2, now: () => now });
    broker.registerConversationRun(binding);

    expect(broker.readEfficiencyEvidence(binding)).toEqual({
      status: "incomplete",
      reason: "run_not_terminal",
    });
    expect(broker.readEfficiencyEvidence({ ...binding, conversationId: "conversation-other" })).toEqual({
      status: "incomplete",
      reason: "run_mismatch",
    });

    now = 3_100;
    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: binding.conversationId, runId: binding.agentRunId, status: "running" },
    });
    now = 3_200;
    broker.publishGatewayEvent({
      event: "chat.final",
      payload: { conversationId: binding.conversationId, runId: binding.agentRunId, text: "done" },
    });

    expect(broker.readEfficiencyEvidence(binding)).toEqual({
      status: "incomplete",
      reason: "lifecycle_not_retained",
    });
  });

  it("counts automatic settlements as non-human and leaves unknown responders incomplete", () => {
    let now = 4_000;
    const broker = createCodingRunGatewayEventBroker({ now: () => now });
    for (const responderKind of ["automatic", "unknown"] as const) {
      const binding = {
        conversationId: `conversation-${responderKind}`,
        agentRunId: `run-${responderKind}`,
      };
      const toolCallId = `tool-${responderKind}`;
      broker.registerConversationRun(binding);
      now += 100;
      broker.publishGatewayEvent({
        event: "tool_event",
        payload: {
          conversationId: binding.conversationId,
          runId: binding.agentRunId,
          kind: "coding_run_permission_requested",
          toolCallId,
          toolName: "file_edit",
        },
      });
      now += 100;
      expect(broker.observePermissionSettled(binding, { toolCallId, responderKind })).toBe(true);
      now += 100;
      broker.publishGatewayEvent({
        event: "chat.final",
        payload: { conversationId: binding.conversationId, runId: binding.agentRunId, text: "done" },
      });

      const evidence = broker.readEfficiencyEvidence(binding);
      expect(evidence).toMatchObject({ status: "complete" });
      if (evidence.status !== "complete") throw new Error("expected complete lifecycle evidence");
      if (responderKind === "automatic") {
        expect(evidence.humanInterventionEvidence).toMatchObject({ count: 0 });
      } else {
        expect(evidence).not.toHaveProperty("humanInterventionEvidence");
      }
    }
  });

  it("settles a pending permission after the terminal event without appending a late running state", () => {
    let now = 5_000;
    const binding = { conversationId: "conversation-terminal-settle", agentRunId: "run-terminal-settle" };
    const broker = createCodingRunGatewayEventBroker({ now: () => now });
    broker.registerConversationRun(binding);
    now = 5_100;
    broker.publishGatewayEvent({
      event: "tool_event",
      payload: {
        conversationId: binding.conversationId,
        runId: binding.agentRunId,
        kind: "coding_run_permission_requested",
        toolCallId: "tool-terminal-settle",
        toolName: "file_edit",
      },
    });
    now = 5_200;
    broker.publishGatewayEvent({
      event: "conversation.run.stopped",
      payload: { conversationId: binding.conversationId, runId: binding.agentRunId, reason: "cancelled" },
    });
    now = 5_300;
    expect(broker.observePermissionSettled(binding, {
      toolCallId: "tool-terminal-settle",
      responderKind: "automatic",
    })).toBe(true);

    expect(broker.readEfficiencyEvidence(binding)).toMatchObject({
      status: "complete",
      projectionTimeline: {
        items: [
          { status: "running", observedAtMs: 5_000 },
          { status: "needs_input", observedAtMs: 5_100 },
          { status: "cancelled", observedAtMs: 5_200 },
        ],
      },
      humanInterventionEvidence: { count: 0 },
    });
  });

  it("按精确 Conversation binding 缓冲并从 cursor 续读单调 v1 事件", () => {
    const broker = createCodingRunGatewayEventBroker();
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };

    expect(broker.registerConversationRun(binding)).toBe(true);
    expect(broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    })).toBe(true);

    const received: number[] = [];
    const subscription = broker.subscribe({
      binding,
      cursor: 1,
      onEvent: (event) => received.push(event.seq),
    });
    expect(subscription).toMatchObject({ ok: true, earliestSeq: 1, latestSeq: 2 });
    if (!subscription.ok) throw new Error("expected successful subscription");

    subscription.subscription.activate();
    expect(received).toEqual([2]);

    broker.publishGatewayEvent({
      event: "chat.delta",
      payload: { conversationId: "conversation-1", runId: "run-1", delta: "hello" },
    });
    expect(received).toEqual([2, 3]);
  });

  it("拒绝陈旧 binding、无效 cursor 与已过期 cursor，且不放行迟到事件", () => {
    const broker = createCodingRunGatewayEventBroker({ maxEventsPerRun: 2 });
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    broker.registerConversationRun(binding);
    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    });
    broker.publishGatewayEvent({
      event: "chat.delta",
      payload: { conversationId: "conversation-1", runId: "run-1", delta: "hello" },
    });

    expect(broker.subscribe({
      binding: { conversationId: "other", agentRunId: "run-1" },
      onEvent: () => undefined,
    })).toMatchObject({ ok: false, code: "run_mismatch" });
    expect(broker.subscribe({
      binding,
      cursor: 0,
      onEvent: () => undefined,
    })).toMatchObject({ ok: false, code: "cursor_expired", earliestSeq: 2 });
    expect(broker.subscribe({
      binding,
      cursor: 99,
      onEvent: () => undefined,
    })).toMatchObject({ ok: false, code: "invalid_cursor" });

    broker.publishGatewayEvent({
      event: "chat.final",
      payload: { conversationId: "conversation-1", runId: "run-1", text: "done" },
    });
    expect(broker.publishGatewayEvent({
      event: "chat.delta",
      payload: { conversationId: "conversation-1", runId: "run-1", delta: "late" },
    })).toBe(false);
  });

  it("在订阅响应激活前维持重放顺序", () => {
    const broker = createCodingRunGatewayEventBroker();
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    broker.registerConversationRun(binding);
    const received: number[] = [];
    const subscription = broker.subscribe({ binding, onEvent: (event) => received.push(event.seq) });
    if (!subscription.ok) throw new Error("expected successful subscription");

    broker.publishGatewayEvent({
      event: "agent.status",
      payload: { conversationId: "conversation-1", runId: "run-1", status: "running" },
    });
    subscription.subscription.activate();

    expect(received).toEqual([1, 2]);
  });

  it("persists a redacted operation stream for restart reconciliation", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-broker-reconciliation-"));
    temporaryDirectories.push(stateDir);
    const workspaceMutationEvidenceStore = {
      getOperationEvidence: async ({ operationId }: { operationId: string }) => ({
        operationId,
        state: "committed" as const,
        workspaceCount: 1,
        targetCount: 1,
        committedTargetCount: 1,
      }),
    };
    const journal = new CodingRunReconciliationJournal(stateDir, { workspaceMutationEvidenceStore });
    const broker = createCodingRunGatewayEventBroker({ reconciliationJournal: journal });
    const binding = { conversationId: "conversation-durable", agentRunId: "run-durable" };

    expect(broker.registerConversationRun(binding)).toBe(true);
    expect(broker.publishGatewayEvent({
      event: "tool_call",
      payload: {
        conversationId: binding.conversationId,
        runId: binding.agentRunId,
        id: "tool-durable",
        name: "file_write",
        arguments: { content: "must-not-persist" },
      },
    })).toBe(true);
    expect(broker.publishGatewayEvent({
      event: "tool_result",
      payload: {
        conversationId: binding.conversationId,
        runId: binding.agentRunId,
        id: "tool-durable",
        name: "file_write",
        success: true,
        output: "must-not-persist-either",
      },
    })).toBe(true);

    await expect(new CodingRunReconciliationJournal(stateDir, {
      workspaceMutationEvidenceStore,
    }).reconcile(binding)).resolves.toMatchObject({
      state: "applied",
      lastJournalSeq: 3,
      operations: [{
        toolName: "file_write",
        startedSeq: 2,
        completedSeq: 3,
        evidence: "workspace_mutation_committed",
      }],
    });
  });

  it("keeps a run non-settleable after completion journal persistence fails", () => {
    const binding = { conversationId: "conversation-sink-down", agentRunId: "run-sink-down" };
    const broker = createCodingRunGatewayEventBroker({
      reconciliationJournal: {
        record: (event) => {
          if (event.type === "tool.completed") throw new Error("journal sink down");
          return true;
        },
      },
    });

    expect(broker.registerConversationRun(binding)).toBe(true);
    expect(broker.publishGatewayEvent({
      event: "tool_call",
      payload: {
        conversationId: binding.conversationId,
        runId: binding.agentRunId,
        id: "tool-sink-down",
        name: "file_write",
      },
    })).toBe(true);
    expect(() => broker.publishGatewayEvent({
      event: "tool_result",
      payload: {
        conversationId: binding.conversationId,
        runId: binding.agentRunId,
        id: "tool-sink-down",
        name: "file_write",
        success: true,
      },
    })).toThrow("journal sink down");
    expect(broker.isReconciliationDurable(binding)).toBe(false);
  });

  it("does not retain a broker run when the initial journal record fails", () => {
    const binding = { conversationId: "conversation-start-failure", agentRunId: "run-start-failure" };
    const broker = createCodingRunGatewayEventBroker({
      reconciliationJournal: {
        record: () => { throw new Error("initial journal sink down"); },
      },
    });

    expect(() => broker.registerConversationRun(binding)).toThrow("initial journal sink down");
    expect(broker.subscribe({ binding, onEvent: () => undefined })).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});
