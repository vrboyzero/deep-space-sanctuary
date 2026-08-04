import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "../coding-run/contracts.js";
import { ConversationFollowUpQueue } from "../coding-run/conversation-follow-up-queue.js";
import { CodingRunReconciliationJournal } from "../coding-run/reconciliation-journal.js";
import { ConversationRunRegistry } from "../conversation-run-registry.js";
import { handleCodingRunMethod } from "./coding-run.js";

describe("coding.run.control", () => {
  it("projects only an exact active Conversation run binding", async () => {
    const response = await handleCodingRunMethod({
      type: "req",
      id: "conversation-status",
      method: "coding.run.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          source: "conversation",
          binding: { agentRunId: "conversation-run-1", conversationId: "conversation-1" },
        },
      },
    }, {
      conversationRunRegistry: {
        get: () => ({ runId: "conversation-run-1" }),
        getRun: () => ({
          conversationId: "conversation-1",
          runId: "conversation-run-1",
          agentId: "default",
          startedAt: 1_700_000_000_000,
          state: "running" as const,
          stop: () => true,
        }),
        requestStop: async () => ({ accepted: false, state: "not_found" as const }),
      },
    });

    expect(response).toEqual({
      type: "res",
      id: "conversation-status",
      ok: true,
      payload: {
        source: "conversation",
        status: "running",
        recovery: { operation: "conversation.continue" },
        binding: { agentRunId: "conversation-run-1", conversationId: "conversation-1" },
        evidence: {
          registryState: "running",
          agentId: "default",
          startedAtMs: 1_700_000_000_000,
          hasStopReason: false,
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("stop\"");
  });

  it("rejects a stale Conversation status binding and unsupported query fields", async () => {
    const registry = {
      get: () => ({ runId: "conversation-run-current" }),
      getRun: () => undefined,
      requestStop: async () => ({ accepted: false, state: "not_found" as const }),
    };
    const stale = await handleCodingRunMethod({
      type: "req",
      id: "conversation-status-stale",
      method: "coding.run.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          source: "conversation",
          binding: { agentRunId: "conversation-run-old", conversationId: "conversation-1" },
        },
      },
    }, { conversationRunRegistry: registry });
    const forged = await handleCodingRunMethod({
      type: "req",
      id: "conversation-status-forged",
      method: "coding.run.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          source: "conversation",
          binding: { agentRunId: "conversation-run-current", conversationId: "conversation-1" },
          includePrompt: true,
        },
      },
    }, { conversationRunRegistry: registry });

    expect(stale).toMatchObject({ ok: false, error: { code: "run_mismatch" } });
    expect(forged).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  it("projects exact Conversation and Workflow markers left by a lost runtime owner", async () => {
    const conversationBinding = { conversationId: "conversation-lost", agentRunId: "run-lost" };
    const conversation = await handleCodingRunMethod({
      type: "req",
      id: "conversation-lost-status",
      method: "coding.run.status",
      params: { query: { version: CODING_RUN_PROTOCOL_VERSION, source: "conversation", binding: conversationBinding } },
    }, {
      conversationRunRegistry: {
        get: () => undefined,
        getRun: () => undefined,
        getRecoveryStatus: async () => ({
          state: "lost",
          marker: {
            source: "conversation",
            binding: conversationBinding,
            state: "active",
            ownerInstanceId: "private-owner",
            ownerProcessId: 123,
            startedAtMs: 100,
            updatedAtMs: 200,
          },
        }),
        requestStop: async () => ({ accepted: false, state: "not_found" }),
      },
    });
    const workflowBinding = {
      agentRunId: "workflow-run-lost",
      workflow: { journalId: "journal-lost", workflowRunId: "workflow-run-lost" },
    };
    const workflow = await handleCodingRunMethod({
      type: "req",
      id: "workflow-lost-status",
      method: "coding.run.status",
      params: { query: { version: CODING_RUN_PROTOCOL_VERSION, source: "workflow", binding: workflowBinding } },
    }, {
      workflowRuntime: {
        getStatus: () => null,
        getStatusByRunId: () => null,
        getRecoveryStatusByRunId: async () => ({
          state: "lost",
          marker: {
            source: "workflow",
            binding: workflowBinding,
            state: "active",
            ownerInstanceId: "private-owner",
            ownerProcessId: 123,
            startedAtMs: 300,
            updatedAtMs: 400,
          },
        }),
        stopRun: async () => false,
      },
    });

    expect(conversation).toMatchObject({
      ok: true,
      payload: { source: "conversation", status: "interrupted", evidence: { runtimeState: "lost" } },
    });
    expect(workflow).toMatchObject({
      ok: true,
      payload: { source: "workflow", status: "interrupted", evidence: { runtimeState: "lost" } },
    });
    expect(JSON.stringify([conversation, workflow])).not.toContain("private-owner");
    expect(JSON.stringify([conversation, workflow])).not.toContain("ownerProcessId");
  });

  it("projects persisted side-effect reconciliation for a lost Conversation run", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-status-reconciliation-"));
    const conversationBinding = { conversationId: "conversation-durable", agentRunId: "run-durable" };
    try {
      const journal = new CodingRunReconciliationJournal(stateDir, {
        workspaceMutationEvidenceStore: {
          getOperationEvidence: async ({ operationId }) => ({
            operationId,
            state: "committed",
            workspaceCount: 1,
            targetCount: 1,
            committedTargetCount: 1,
          }),
        },
      });
      journal.record({
        version: CODING_RUN_PROTOCOL_VERSION,
        seq: 1,
        timestampMs: 100,
        source: "conversation",
        binding: conversationBinding,
        type: "run.started",
        payload: { status: "running" },
      });
      journal.record({
        version: CODING_RUN_PROTOCOL_VERSION,
        seq: 2,
        timestampMs: 110,
        source: "conversation",
        binding: conversationBinding,
        type: "tool.started",
        payload: { tool: { id: "tool-1", name: "file_write", arguments: { secret: "hidden" } } },
      });
      journal.record({
        version: CODING_RUN_PROTOCOL_VERSION,
        seq: 3,
        timestampMs: 120,
        source: "conversation",
        binding: conversationBinding,
        type: "tool.completed",
        payload: { tool: { id: "tool-1", name: "file_write", success: true, output: "hidden" } },
      });

      const response = await handleCodingRunMethod({
        type: "req",
        id: "conversation-durable-status",
        method: "coding.run.status",
        params: {
          query: {
            version: CODING_RUN_PROTOCOL_VERSION,
            source: "conversation",
            binding: conversationBinding,
          },
        },
      }, {
        conversationRunRegistry: {
          get: () => undefined,
          getRun: () => undefined,
          getRecoveryStatus: async () => ({
            state: "lost",
            marker: {
              source: "conversation",
              binding: conversationBinding,
              state: "active",
              ownerInstanceId: "private-owner",
              ownerProcessId: 123,
              startedAtMs: 90,
              updatedAtMs: 125,
            },
          }),
          requestStop: async () => ({ accepted: false, state: "not_found" }),
        },
        codingRunReconciliationJournal: journal,
      });

      expect(response).toMatchObject({
        ok: true,
        payload: {
          source: "conversation",
          status: "interrupted",
          evidence: {
            runtimeState: "lost",
            reconciliation: {
              state: "applied",
              journalState: "available",
              observedOperationCount: 1,
              appliedOperationCount: 1,
              operations: [{
                toolName: "file_write",
                state: "applied",
                evidence: "workspace_mutation_committed",
              }],
            },
          },
        },
      });
      expect(JSON.stringify(response)).not.toContain("hidden");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("projects Goal, Workflow, and Subtask status from their authoritative owners", async () => {
    const goal = await handleCodingRunMethod({
      type: "req",
      id: "goal-status",
      method: "coding.run.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          source: "goal",
          binding: { agentRunId: "goal-run-1", goal: { goalId: "goal-1", nodeId: "node-1" } },
        },
      },
    }, {
      goalManager: {
        getGoal: async () => ({ id: "goal-1", status: "executing", activeNodeId: "node-1", lastRunId: "goal-run-1" }),
        readTaskGraph: async () => ({
          version: 2,
          goalId: "goal-1",
          updatedAt: "2026-07-27T00:00:00.000Z",
          edges: [],
          nodes: [{
            id: "node-1",
            title: "Implement",
            status: "in_progress",
            dependsOn: [],
            acceptance: [],
            artifacts: [],
            checkpointRequired: false,
            checkpointStatus: "not_required",
            lastRunId: "goal-run-1",
            createdAt: "2026-07-27T00:00:00.000Z",
            updatedAt: "2026-07-27T00:00:00.000Z",
          }],
        }),
        resumeGoal: async () => ({ conversationId: "goal-conversation" }),
        pauseGoal: async () => undefined,
      },
    });
    const workflow = await handleCodingRunMethod({
      type: "req",
      id: "workflow-status",
      method: "coding.run.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          source: "workflow",
          binding: {
            agentRunId: "workflow-run-1",
            workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
          },
        },
      },
    }, {
      workflowRuntime: {
        getStatusByRunId: () => ({
          workflowRunId: "workflow-run-1",
          journalId: "journal-1",
          status: "running",
          stats: { total: 1, pending: 1, done: 0, errors: 0, skipped: 0, totalTokens: 0, cacheHits: 0 },
        }),
        stopRun: async () => true,
      },
    });
    const subtask = await handleCodingRunMethod({
      type: "req",
      id: "subtask-status",
      method: "coding.run.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          source: "subtask",
          binding: { agentRunId: "session-1", conversationId: "conversation-1", subtask: { taskId: "task-1" } },
        },
      },
    }, {
      subTaskRuntimeStore: {
        getTask: async () => ({
          id: "task-1",
          sessionId: "session-1",
          parentConversationId: "conversation-1",
          kind: "sub_agent",
          status: "running",
          progress: { phase: "running" },
          launchSpec: { role: "coder" },
        }),
      },
    });

    expect(goal).toMatchObject({ ok: true, payload: { source: "goal", status: "running" } });
    expect(workflow).toMatchObject({ ok: true, payload: { source: "workflow", status: "running" } });
    expect(subtask).toMatchObject({ ok: true, payload: { source: "subtask", status: "running" } });
  });

  it("does not project stale Goal, Workflow, or Subtask bindings", async () => {
    const goal = await handleCodingRunMethod({
      type: "req",
      id: "goal-status-stale",
      method: "coding.run.status",
      params: { query: { version: CODING_RUN_PROTOCOL_VERSION, source: "goal", binding: { agentRunId: "old", goal: { goalId: "goal-1" } } } },
    }, {
      goalManager: {
        getGoal: async () => ({ id: "goal-1", status: "executing", lastRunId: "current" }),
        resumeGoal: async () => ({ conversationId: "goal-conversation" }),
        pauseGoal: async () => undefined,
      },
    });
    const workflow = await handleCodingRunMethod({
      type: "req",
      id: "workflow-status-stale",
      method: "coding.run.status",
      params: { query: { version: CODING_RUN_PROTOCOL_VERSION, source: "workflow", binding: { agentRunId: "old", workflow: { journalId: "journal-1", workflowRunId: "old" } } } },
    }, {
      workflowRuntime: {
        getStatusByRunId: () => ({ workflowRunId: "current", journalId: "journal-1", status: "running" }),
        stopRun: async () => true,
      },
    });
    const subtask = await handleCodingRunMethod({
      type: "req",
      id: "subtask-status-stale",
      method: "coding.run.status",
      params: { query: { version: CODING_RUN_PROTOCOL_VERSION, source: "subtask", binding: { agentRunId: "old", subtask: { taskId: "task-1" } } } },
    }, {
      subTaskRuntimeStore: { getTask: async () => ({ id: "task-1", sessionId: "current" }) },
    });

    expect(goal).toMatchObject({ ok: false, error: { code: "run_mismatch" } });
    expect(workflow).toMatchObject({ ok: false, error: { code: "run_mismatch" } });
    expect(subtask).toMatchObject({ ok: false, error: { code: "run_mismatch" } });
  });

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

  it("queues an idempotent Conversation follow-up only through the exact active run", async () => {
    const enqueueFollowUp = vi.fn(() => ({
      ok: true as const,
      replayed: false,
      item: {
        commandId: "follow-up-1",
        intent: "follow_up" as const,
        status: "queued" as const,
        sourceBinding: { conversationId: "conversation-1", agentRunId: "run-1" },
        promptChars: 19,
        requestedAtMs: 123,
        hasError: false,
      },
    }));
    const response = await handleCodingRunMethod({
      type: "req",
      id: "conversation-follow-up",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "conversation.follow_up",
          binding: { conversationId: "conversation-1", agentRunId: "run-1" },
          prompt: "run focused tests",
          idempotencyKey: "request-1",
        },
      },
    }, {
      conversationRunRegistry: {
        get: () => ({ runId: "run-1" }),
        requestStop: async () => ({ accepted: false, state: "not_found" }),
        enqueueFollowUp,
      },
    });

    expect(enqueueFollowUp).toHaveBeenCalledWith({
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "run focused tests",
      idempotencyKey: "request-1",
    });
    expect(response).toMatchObject({
      ok: true,
      payload: {
        accepted: true,
        replayed: false,
        operation: "conversation.follow_up",
        command: { commandId: "follow-up-1", status: "queued", promptChars: 19 },
      },
    });
    expect(JSON.stringify(response)).not.toContain("run focused tests");
    expect(JSON.stringify(response)).not.toContain("request-1");
  });

  it("preserves follow-up replay, conflict, and queue-full results through the Gateway boundary", async () => {
    const registry = new ConversationRunRegistry({
      followUpQueue: new ConversationFollowUpQueue({ maxQueuedPerRun: 1 }),
    });
    registry.register({
      conversationId: "conversation-1",
      runId: "run-1",
      startedAt: 1,
      state: "running",
      stop: () => true,
    });
    const request = (id: string, prompt: string, idempotencyKey: string) => handleCodingRunMethod({
      type: "req" as const,
      id,
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "conversation.follow_up",
          binding: { conversationId: "conversation-1", agentRunId: "run-1" },
          prompt,
          idempotencyKey,
        },
      },
    }, { conversationRunRegistry: registry });

    const first = await request("follow-up-first", "continue", "request-1");
    const replay = await request("follow-up-replay", "continue", "request-1");
    const conflict = await request("follow-up-conflict", "different", "request-1");
    const full = await request("follow-up-full", "another", "request-2");

    expect(first).toMatchObject({ ok: true, payload: { replayed: false } });
    expect(replay).toMatchObject({
      ok: true,
      payload: { replayed: true, command: { commandId: (first as any).payload.command.commandId } },
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
    expect(full).toMatchObject({ ok: false, error: { code: "queue_full" } });
  });

  it("requests an exact Conversation replacement and returns its observable command", async () => {
    const replaceActiveRun = vi.fn(async () => ({
      ok: true as const,
      replayed: false,
      stopRequested: true,
      item: {
        commandId: "replace-1",
        intent: "replace" as const,
        status: "queued" as const,
        sourceBinding: { conversationId: "conversation-1", agentRunId: "run-1" },
        promptChars: 16,
        requestedAtMs: 123,
        hasError: false,
      },
    }));
    const response = await handleCodingRunMethod({
      type: "req",
      id: "conversation-replace",
      method: "coding.run.control",
      params: {
        control: {
          version: CODING_RUN_PROTOCOL_VERSION,
          operation: "conversation.replace",
          binding: { conversationId: "conversation-1", agentRunId: "run-1" },
          prompt: "replacement text",
          idempotencyKey: "replace-request-1",
        },
      },
    }, {
      conversationRunRegistry: {
        get: () => ({ runId: "run-1" }),
        requestStop: async () => ({ accepted: false, state: "not_found" }),
        replaceActiveRun,
      },
    });

    expect(replaceActiveRun).toHaveBeenCalledWith({
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "replacement text",
      idempotencyKey: "replace-request-1",
    });
    expect(response).toMatchObject({
      ok: true,
      payload: {
        accepted: true,
        stopRequested: true,
        replayed: false,
        operation: "conversation.replace",
        command: { commandId: "replace-1", intent: "replace", status: "queued" },
      },
    });
    expect(JSON.stringify(response)).not.toContain("replacement text");
    expect(JSON.stringify(response)).not.toContain("replace-request-1");
  });

  it("queues steer for an exact active Conversation and reads its safe status", async () => {
    const enqueueSteer = vi.fn(() => ({
      ok: true as const,
      replayed: false,
      item: {
        commandId: "steer-1",
        intent: "steer" as const,
        status: "queued" as const,
        sourceBinding: { conversationId: "conversation-1", agentRunId: "run-1" },
        promptChars: 17,
        requestedAtMs: 123,
        hasError: false,
      },
    }));
    const getSteerStatus = vi.fn(() => ({
      commandId: "steer-1",
      intent: "steer" as const,
      status: "delivered" as const,
      sourceBinding: { conversationId: "conversation-1", agentRunId: "run-1" },
      promptChars: 17,
      requestedAtMs: 123,
      deliveredAtMs: 125,
      deliveredModelCallIndex: 2,
      hasError: false,
    }));
    const context = {
      conversationRunRegistry: {
        get: () => ({ runId: "run-1" }),
        requestStop: async () => ({ accepted: false as const, state: "not_found" as const }),
        enqueueSteer,
        getSteerStatus,
      },
    };

    const accepted = await handleCodingRunMethod({
      type: "req",
      id: "conversation-steer",
      method: "coding.run.control",
      params: { control: {
        version: CODING_RUN_PROTOCOL_VERSION,
        operation: "conversation.steer",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        prompt: "focus on the test",
        idempotencyKey: "request-1",
      } },
    }, context);
    const status = await handleCodingRunMethod({
      type: "req",
      id: "conversation-steer-status",
      method: "coding.run.steer.status",
      params: { query: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        commandId: "steer-1",
      } },
    }, context);

    expect(enqueueSteer).toHaveBeenCalledWith({
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "focus on the test",
      idempotencyKey: "request-1",
    });
    expect(accepted).toMatchObject({
      ok: true,
      payload: { accepted: true, operation: "conversation.steer", command: { commandId: "steer-1" } },
    });
    expect(status).toMatchObject({
      ok: true,
      payload: { status: "delivered", deliveredModelCallIndex: 2 },
    });
    expect(JSON.stringify(accepted)).not.toContain("focus on the test");
    expect(JSON.stringify(accepted)).not.toContain("request-1");
  });

  it("reads follow-up command status without exposing prompt or idempotency key", async () => {
    const getFollowUpStatus = vi.fn(() => ({
      commandId: "follow-up-1",
      intent: "follow_up" as const,
      status: "delivered" as const,
      sourceBinding: { conversationId: "conversation-1", agentRunId: "run-1" },
      promptChars: 19,
      requestedAtMs: 123,
      deliveredAtMs: 456,
      nextBinding: { conversationId: "conversation-1", agentRunId: "run-2" },
      hasError: false,
    }));
    const response = await handleCodingRunMethod({
      type: "req",
      id: "conversation-follow-up-status",
      method: "coding.run.follow_up.status",
      params: {
        query: {
          version: CODING_RUN_PROTOCOL_VERSION,
          binding: { conversationId: "conversation-1", agentRunId: "run-1" },
          commandId: "follow-up-1",
        },
      },
    }, {
      conversationRunRegistry: {
        get: () => undefined,
        requestStop: async () => ({ accepted: false, state: "not_found" }),
        getFollowUpStatus,
      },
    });

    expect(getFollowUpStatus).toHaveBeenCalledWith(
      { conversationId: "conversation-1", agentRunId: "run-1" },
      "follow-up-1",
    );
    expect(response).toMatchObject({
      ok: true,
      payload: {
        commandId: "follow-up-1",
        status: "delivered",
        nextBinding: { conversationId: "conversation-1", agentRunId: "run-2" },
      },
    });
    expect(JSON.stringify(response)).not.toContain('"prompt":');
    expect(JSON.stringify(response)).not.toContain("idempotency");
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

  it("lists the bounded safe pending permission owner projection", async () => {
    const list = vi.fn(() => [{
      conversationId: "conversation-1",
      agentRunId: "conversation-run-1",
      worktreeId: "worktree-1",
      toolCallId: "tool-call-1",
      toolName: "command_job",
      commandPreview: { action: "cancel" as const, jobId: "11111111-1111-4111-8111-111111111111" },
    }]);

    const response = await handleCodingRunMethod({
      type: "req",
      id: "permission-list",
      method: "coding.run.permission.list",
      params: {},
    }, {
      pendingToolPermissionRuntime: { list },
    });

    expect(list).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      type: "res",
      id: "permission-list",
      ok: true,
      payload: {
        permissions: [{
          conversationId: "conversation-1",
          agentRunId: "conversation-run-1",
          worktreeId: "worktree-1",
          toolCallId: "tool-call-1",
          toolName: "command_job",
          commandPreview: { action: "cancel", jobId: "11111111-1111-4111-8111-111111111111" },
        }],
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
