import { describe, expect, it, vi } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "../coding-run/contracts.js";
import { handleCodingRunMethod } from "./coding-run.js";

describe("coding.run.control", () => {
  it("resumes a Goal only when the observed run binding still matches", async () => {
    const resumeGoal = vi.fn(async () => ({
      conversationId: "goal-conversation-next",
      runId: "goal-run-next",
    }));
    const response = await handleCodingRunMethod({
      type: "req",
      id: "goal-resume",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "goal.resume",
          binding: { agentRunId: "goal-run-current", goal: { goalId: "goal-1", nodeId: "node-1" } },
          checkpointId: "checkpoint-1",
        },
      },
    }, {
      goalManager: {
        getGoal: async () => ({ id: "goal-1", lastRunId: "goal-run-current", activeNodeId: "node-1" }),
        resumeGoal,
        pauseGoal: async () => undefined,
      },
    });

    expect(resumeGoal).toHaveBeenCalledWith("goal-1", "node-1", { checkpointId: "checkpoint-1" });
    expect(response).toMatchObject({
      ok: true,
      payload: {
        accepted: true,
        binding: {
          agentRunId: "goal-run-next",
          conversationId: "goal-conversation-next",
          goal: { goalId: "goal-1", nodeId: "node-1" },
        },
      },
    });
  });

  it("rejects stale bindings without invoking a Goal write operation", async () => {
    const resumeGoal = vi.fn();
    const response = await handleCodingRunMethod({
      type: "req",
      id: "goal-stale",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "goal.resume",
          binding: { agentRunId: "goal-run-stale", goal: { goalId: "goal-1" } },
        },
      },
    }, {
      goalManager: {
        getGoal: async () => ({ id: "goal-1", lastRunId: "goal-run-current" }),
        resumeGoal,
        pauseGoal: async () => undefined,
      },
    });

    expect(response).toMatchObject({ ok: false, error: { code: "run_mismatch" } });
    expect(resumeGoal).not.toHaveBeenCalled();
  });

  it("cancels a Subtask only after matching its current agent run", async () => {
    const stopSubTask = vi.fn(async () => ({ id: "task-1", sessionId: "agent-next" }));
    const response = await handleCodingRunMethod({
      type: "req",
      id: "subtask-cancel",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "subtask.cancel",
          binding: { agentRunId: "agent-current", subtask: { taskId: "task-1" } },
          reason: "stop safely",
        },
      },
    }, {
      subTaskRuntimeStore: { getTask: async () => ({ id: "task-1", sessionId: "agent-current" }) },
      stopSubTask,
    });

    expect(stopSubTask).toHaveBeenCalledWith("task-1", "stop safely", { idempotencyKey: "coding-run:subtask.cancel:agent-current" });
    expect(response).toMatchObject({
      ok: true,
      payload: { binding: { agentRunId: "agent-next", subtask: { taskId: "task-1" } } },
    });
  });

  it("cancels a Conversation only after matching its active run", async () => {
    const requestStop = vi.fn(async () => ({ accepted: true, runId: "conversation-run-1", state: "stop_requested" as const }));
    const response = await handleCodingRunMethod({
      type: "req",
      id: "conversation-cancel",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "cancel",
          binding: { agentRunId: "conversation-run-1", conversationId: "conversation-1" },
          reason: "cancel safely",
        },
      },
    }, {
      conversationRunRegistry: {
        get: () => ({ runId: "conversation-run-1" }),
        requestStop,
      },
    });

    expect(requestStop).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      runId: "conversation-run-1",
      reason: "cancel safely",
    });
    expect(response).toMatchObject({
      ok: true,
      payload: { binding: { agentRunId: "conversation-run-1", conversationId: "conversation-1" } },
    });
  });

  it("cancels a Workflow only when both Journal and runtime run bindings match", async () => {
    const stopRun = vi.fn(async () => true);
    const response = await handleCodingRunMethod({
      type: "req",
      id: "workflow-cancel-exact",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "workflow.cancel",
          binding: {
            agentRunId: "workflow-run-1",
            workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
          },
          reason: "cancel safely",
        },
      },
    }, {
      workflowRuntime: {
        getStatusByRunId: () => ({ workflowRunId: "workflow-run-1", journalId: "journal-1", status: "running" }),
        stopRun,
      },
    });

    expect(stopRun).toHaveBeenCalledWith("journal-1", "workflow-run-1", "cancel safely");
    expect(response).toMatchObject({
      ok: true,
      payload: {
        binding: {
          agentRunId: "workflow-run-1",
          workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
        },
      },
    });
  });

  it("rejects a Workflow cancel that lacks the exact runtime run binding", async () => {
    const stopRun = vi.fn(async () => true);
    const response = await handleCodingRunMethod({
      type: "req",
      id: "workflow-cancel-stale",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "workflow.cancel",
          binding: { agentRunId: "workflow-run-1", workflow: { journalId: "journal-1" } },
        },
      },
    }, {
      workflowRuntime: {
        getStatusByRunId: () => ({ workflowRunId: "workflow-run-1", journalId: "journal-1", status: "running" }),
        stopRun,
      },
    });

    expect(response).toMatchObject({ ok: false, error: { code: "run_mismatch" } });
    expect(stopRun).not.toHaveBeenCalled();
  });

  it("accepts a retried Workflow cancel while the same bound run is already stopping", async () => {
    const stopRun = vi.fn(async () => true);
    const response = await handleCodingRunMethod({
      type: "req",
      id: "workflow-cancel-retry",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "workflow.cancel",
          binding: {
            agentRunId: "workflow-run-1",
            workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
          },
        },
      },
    }, {
      workflowRuntime: {
        getStatusByRunId: () => ({ workflowRunId: "workflow-run-1", journalId: "journal-1", status: "partial", stopRequested: true }),
        stopRun,
      },
    });

    expect(response).toMatchObject({ ok: true, payload: { accepted: true } });
    expect(stopRun).toHaveBeenCalledWith("journal-1", "workflow-run-1", undefined);
  });

  it("responds to a pending tool permission only through its exact worker binding", async () => {
    const respond = vi.fn(() => ({ ok: true as const, accepted: true as const }));
    const response = await handleCodingRunMethod({
      type: "req",
      id: "permission-response",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "permission.respond",
          binding: { agentRunId: "conversation-run-1" },
          toolCallId: "tool-call-1",
          decision: "allow",
        },
      },
    }, {
      pendingToolPermissionRuntime: { respond },
    });

    expect(respond).toHaveBeenCalledWith({
      agentRunId: "conversation-run-1",
      toolCallId: "tool-call-1",
      decision: "allow",
    });
    expect(response).toMatchObject({
      ok: true,
      payload: {
        accepted: true,
        operation: "permission.respond",
        binding: { agentRunId: "conversation-run-1" },
      },
    });
  });

  it("keeps a missing pending permission runtime fail closed", async () => {
    const response = await handleCodingRunMethod({
      type: "req",
      id: "permission-unavailable",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "permission.respond",
          binding: { agentRunId: "conversation-run-1" },
          toolCallId: "tool-call-1",
          decision: "deny",
        },
      },
    }, {});

    expect(response).toMatchObject({ ok: false, error: { code: "not_available" } });
  });

  it("keeps controls without an equivalent source verifier fail closed", async () => {
    const response = await handleCodingRunMethod({
      type: "req",
      id: "workflow-cancel",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "workflow.cancel",
          binding: { agentRunId: "entry-1", workflow: { journalId: "journal-1" } },
        },
      },
    }, {});

    expect(response).toMatchObject({ ok: false, error: { code: "not_available" } });
  });
});
