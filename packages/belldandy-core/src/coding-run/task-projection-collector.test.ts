import { describe, expect, it, vi } from "vitest";

import { collectTaskProjectionSources } from "./task-projection-collector.js";
import { createTaskCapabilityClosureResolver } from "./task-capability-closure.js";

describe("task projection collector", () => {
  it("collects exact-bound Conversation, Goal, Workflow, and Subtask owner views", async () => {
    const sources = await collectTaskProjectionSources({
      now: () => 500,
      conversationRunRegistry: {
        listActiveRuns: () => [{
          conversationId: "conversation-1",
          runId: "run-1",
          startedAt: 100,
          state: "running",
        }],
      },
      goalManager: {
        listGoals: async () => [
          { id: "goal-1", status: "executing", lastRunId: "goal-run-1", updatedAt: "2026-08-13T00:00:00.000Z" },
          { id: "goal-without-run", status: "ready", updatedAt: "2026-08-13T00:00:00.000Z" },
        ],
      },
      workflowRuntime: {
        listActiveRuns: () => [{
          workflowRunId: "workflow-run-1",
          journalId: "journal-1",
          workflowName: "test",
          status: "running",
          startedAt: 200,
        }],
      },
      subTaskRuntimeStore: {
        listTasks: async () => [{
          id: "subtask-1",
          sessionId: "subtask-run-1",
          parentConversationId: "conversation-1",
          kind: "sub_agent",
          status: "running",
          progress: { phase: "running" },
          updatedAt: 300,
          launchSpec: {},
        }],
      },
    });

    expect(sources.map((source) => source.taskId)).toEqual([
      "conversation:conversation-1:run-1",
      "goal:goal-1",
      "workflow:workflow-run-1",
      "subtask:subtask-1",
    ]);
    expect(sources.every((source) => source.capabilityClosure.status === "unknown")).toBe(true);
    expect(JSON.stringify(sources)).not.toMatch(/instruction|prompt|workflowName|goal-without-run/);
  });

  it("associates worktree evidence only through the exact Conversation/run owner", async () => {
    const reconcile = vi.fn(async () => ({
      state: "none" as const,
      journalState: "available" as const,
      observedOperationCount: 0,
      mutationOperationCount: 0,
      appliedOperationCount: 0,
      uncertainOperationCount: 0,
      operations: [],
    }));
    const sources = await collectTaskProjectionSources({
      conversationRunRegistry: {
        listActiveRuns: () => [{ conversationId: "conversation-1", runId: "run-1", startedAt: 100, state: "running" }],
      },
      userWorktreeRuntime: {
        listStatus: async () => [{
          worktreeId: "worktree-1",
          owner: { conversationId: "conversation-1", runId: "run-1" },
          worktreePath: "private-path",
          repoRoot: "private-root",
          baseCommit: "base",
          branch: "branch",
          dirty: true,
          status: "ready",
          blockers: [],
          retention: { status: "retained", reason: "private reason" },
        }],
      },
      reconciliationJournal: { reconcile },
      now: () => 500,
    });

    expect(sources[0].supportingEvidence).toEqual({
      worktree: { status: "dirty", observedAtMs: 0 },
      journal: { status: "pending", observedAtMs: 500 },
    });
    expect(reconcile).toHaveBeenCalledWith({ conversationId: "conversation-1", agentRunId: "run-1" });
    expect(JSON.stringify(sources)).not.toMatch(/private-path|private-root|private reason/);
  });

  it("projects exact worktree keep/discard lifecycle evidence without owner crossover", async () => {
    const lifecycleReads: Array<{ conversationId: string; runId: string }> = [];
    const sources = await collectTaskProjectionSources({
      conversationRunRegistry: {
        listActiveRuns: () => [
          { conversationId: "conversation-keep", runId: "run-shared", startedAt: 100, state: "running" },
          { conversationId: "conversation-discard", runId: "run-shared", startedAt: 200, state: "running" },
        ],
      },
      userWorktreeRuntime: {
        listStatus: async () => [{
          worktreeId: "worktree-kept",
          owner: { conversationId: "conversation-keep", runId: "run-shared" },
          worktreePath: "private-kept-path",
          repoRoot: "private-repo",
          baseCommit: "base",
          branch: "private-branch",
          dirty: true,
          trackedChanges: 1,
          status: "blocked",
          blockers: ["uncommitted_changes"],
          retention: { status: "retained", decision: "keep", reason: "private retention reason" },
        }],
        readLifecycleEvidence: async (owner) => {
          lifecycleReads.push(owner);
          return owner.conversationId === "conversation-keep"
            ? { lifecycle: "kept", observedAtMs: 300 }
            : { lifecycle: "discarded", observedAtMs: 400 };
        },
      },
    });

    expect(sources.map((source) => source.supportingEvidence?.worktree)).toEqual([
      { status: "dirty", lifecycle: "kept", observedAtMs: 300 },
      { status: "missing", lifecycle: "discarded", observedAtMs: 400 },
    ]);
    expect(lifecycleReads).toEqual([
      { conversationId: "conversation-keep", runId: "run-shared" },
      { conversationId: "conversation-discard", runId: "run-shared" },
    ]);
    expect(JSON.stringify(sources)).not.toMatch(/private-kept-path|private-repo|private-branch|private retention reason/);
  });

  it("fails worktree lifecycle reader errors closed without exposing private failure details", async () => {
    const sources = await collectTaskProjectionSources({
      now: () => 500,
      conversationRunRegistry: {
        listActiveRuns: () => [{ conversationId: "conversation-1", runId: "run-1", startedAt: 100, state: "running" }],
      },
      userWorktreeRuntime: {
        listStatus: async () => [],
        readLifecycleEvidence: async () => { throw new Error("private lifecycle audit path"); },
      },
    });

    expect(sources[0].supportingEvidence?.worktree).toEqual({ status: "uncertain", observedAtMs: 500 });
    expect(JSON.stringify(sources)).not.toContain("private lifecycle audit path");
  });

  it("fails journal evidence closed without exposing reconciliation details", async () => {
    const sources = await collectTaskProjectionSources({
      conversationRunRegistry: {
        listActiveRuns: () => [
          { conversationId: "conversation-1", runId: "run-uncertain", startedAt: 100, state: "running" },
          { conversationId: "conversation-1", runId: "run-missing", startedAt: 200, state: "running" },
          { conversationId: "conversation-1", runId: "run-error", startedAt: 300, state: "running" },
        ],
      },
      reconciliationJournal: {
        reconcile: async ({ agentRunId }) => {
          if (agentRunId === "run-error") throw new Error("private journal path");
          if (agentRunId === "run-missing") {
            return {
              state: "uncertain", journalState: "missing", reason: "journal_missing",
              observedOperationCount: 0, mutationOperationCount: 0, appliedOperationCount: 0,
              uncertainOperationCount: 1, operations: [],
            };
          }
          return {
            state: "uncertain", journalState: "available",
            observedOperationCount: 1, mutationOperationCount: 1, appliedOperationCount: 0,
            uncertainOperationCount: 1,
            operations: [{
              operationId: "private-operation-id", toolName: "file_write", mutation: "possible",
              state: "uncertain", evidence: "tool_started",
            }],
          };
        },
      },
      now: () => 600,
    });

    expect(sources.map((source) => source.supportingEvidence?.journal)).toEqual([
      { status: "uncertain", observedAtMs: 600 },
      { status: "skipped", observedAtMs: 600 },
      { status: "uncertain", observedAtMs: 600 },
    ]);
    expect(JSON.stringify(sources)).not.toMatch(/private journal path|private-operation-id|file_write/);
  });

  it("projects pending approval only for the exact Conversation/run binding", async () => {
    const sources = await collectTaskProjectionSources({
      conversationRunRegistry: {
        listActiveRuns: () => [
          { conversationId: "conversation-1", runId: "run-shared", startedAt: 100, state: "running" },
          { conversationId: "conversation-2", runId: "run-shared", startedAt: 200, state: "running" },
        ],
      },
      pendingToolPermissionRuntime: {
        list: () => [{
          conversationId: "conversation-1",
          agentRunId: "run-shared",
          toolCallId: "private-tool-call",
          toolName: "private-tool-name",
        }],
      },
      now: () => 500,
    });

    expect(sources.map((source) => source.view.status)).toEqual(["awaiting_review", "running"]);
    expect(JSON.stringify(sources)).not.toMatch(/private-tool-call|private-tool-name/);
  });

  it("isolates optional owner read failures without fabricating tasks", async () => {
    const sources = await collectTaskProjectionSources({
      goalManager: { listGoals: async () => { throw new Error("private goal failure"); } },
      subTaskRuntimeStore: { listTasks: async () => { throw new Error("private subtask failure"); } },
      userWorktreeRuntime: { listStatus: async () => { throw new Error("private worktree failure"); } },
    });

    expect(sources).toEqual([]);
  });

  it("uses the exact capability resolver seam without guessing other owner state", async () => {
    const resolver = createTaskCapabilityClosureResolver({
      now: () => 900,
      resolve: ({ taskId, source, agentRunId }) => {
        if (taskId !== "conversation:conversation-1:run-1" || source !== "conversation" || agentRunId !== "run-1") {
          throw new Error("unexpected owner binding");
        }
        return {
          schemaVersion: "task-capability-closure/v1",
          evaluatedAtMs: 800,
          status: "satisfied",
          capabilities: Object.fromEntries([
            "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal", "trace", "verifier", "mcp", "plugin", "skill",
          ].map((name) => [name, { required: name === "tools", state: "available" }])),
        } as never;
      },
    });

    const sources = await collectTaskProjectionSources({
      now: () => 500,
      taskCapabilityClosureResolver: resolver,
      conversationRunRegistry: {
        listActiveRuns: () => [{ conversationId: "conversation-1", runId: "run-1", startedAt: 100, state: "running" }],
      },
    });

    expect(sources[0].capabilityClosure).toMatchObject({ status: "satisfied", evaluatedAtMs: 800 });
    expect(sources[0].capabilityClosure.capabilities.tools).toEqual({ required: true, state: "available" });
    expect(JSON.stringify(sources[0])).not.toMatch(/unexpected|private|secret/i);
  });
});
