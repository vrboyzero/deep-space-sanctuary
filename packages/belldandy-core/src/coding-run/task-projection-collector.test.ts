import { describe, expect, it } from "vitest";

import { collectTaskProjectionSources } from "./task-projection-collector.js";

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
      now: () => 500,
    });

    expect(sources[0].supportingEvidence).toEqual({
      worktree: { status: "dirty", observedAtMs: 0 },
    });
    expect(JSON.stringify(sources)).not.toMatch(/private-path|private-root|private reason/);
  });

  it("isolates optional owner read failures without fabricating tasks", async () => {
    const sources = await collectTaskProjectionSources({
      goalManager: { listGoals: async () => { throw new Error("private goal failure"); } },
      subTaskRuntimeStore: { listTasks: async () => { throw new Error("private subtask failure"); } },
      userWorktreeRuntime: { listStatus: async () => { throw new Error("private worktree failure"); } },
    });

    expect(sources).toEqual([]);
  });
});
