import { createHash } from "node:crypto";
import syncFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION, type AgentRunEvent } from "./contracts.js";
import { CodingRunReconciliationJournal } from "./reconciliation-journal.js";

const temporaryDirectories: string[] = [];
const binding = { conversationId: "conversation-1", agentRunId: "run-1" } as const;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("CodingRunReconciliationJournal", () => {
  it("fails closed when a journal write is partial before ENOSPC", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);
    journal.record(event(1, "run.started", { status: "running" }));

    const originalWriteSync = syncFs.writeSync.bind(syncFs);
    let writeCount = 0;
    vi.spyOn(syncFs, "writeSync").mockImplementation(((file: number, data: string | NodeJS.ArrayBufferView) => {
      writeCount += 1;
      if (writeCount > 1) {
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      }
      const buffer = typeof data === "string"
        ? Buffer.from(data, "utf-8")
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const partialBytes = Math.max(1, Math.floor(buffer.byteLength / 2));
      return originalWriteSync(file, buffer, 0, partialBytes, null);
    }) as typeof syncFs.writeSync);

    let thrown: unknown;
    try {
      journal.record(event(2, "tool.started", {
        tool: { id: "tool-disk-full", name: "file_write" },
      }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "ENOSPC" });

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      journalState: "unavailable",
      reason: "journal_invalid",
    });
  });

  it("reopens a completed mutation as applied without persisting tool content", async () => {
    const stateDir = await createStateDir();
    const workspaceMutationEvidenceStore = createWorkspaceMutationEvidenceStore("committed");
    const journal = new CodingRunReconciliationJournal(stateDir, {
      workspaceMutationEvidenceStore,
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: {
        id: "tool-call-1",
        name: "file_write",
        arguments: { path: "secret.txt", content: "must-not-persist" },
      },
    }));
    journal.record(event(3, "tool.completed", {
      tool: {
        id: "tool-call-1",
        name: "file_write",
        success: true,
        output: { content: "also-must-not-persist" },
      },
    }));

    const restarted = new CodingRunReconciliationJournal(stateDir, {
      workspaceMutationEvidenceStore,
    });
    await expect(restarted.reconcile(binding)).resolves.toMatchObject({
      state: "applied",
      journalState: "available",
      observedOperationCount: 1,
      mutationOperationCount: 1,
      appliedOperationCount: 1,
      uncertainOperationCount: 0,
      operations: [{
        toolName: "file_write",
        mutation: "possible",
        state: "applied",
        startedSeq: 2,
        completedSeq: 3,
        evidence: "workspace_mutation_committed",
      }],
    });

    const journalDir = path.join(stateDir, "coding-run-reconciliation");
    const journalFiles = await fs.readdir(journalDir);
    expect(journalFiles).toHaveLength(1);
    const persisted = await fs.readFile(path.join(journalDir, journalFiles[0]!), "utf-8");
    expect(persisted).not.toContain("arguments");
    expect(persisted).not.toContain("output");
    expect(persisted).not.toContain("must-not-persist");
    expect(persisted).not.toContain("also-must-not-persist");
    expect(persisted).not.toContain("secret.txt");
  });

  it.each([
    { state: "prepared", evidence: "workspace_mutation_incomplete" },
    { state: "missing", evidence: "workspace_mutation_evidence_missing" },
    { state: "conflict", evidence: "workspace_mutation_evidence_conflict" },
  ] as const)("fails closed when file completion has $state owner evidence", async ({ state, evidence }) => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir, {
      workspaceMutationEvidenceStore: createWorkspaceMutationEvidenceStore(state),
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-file-owner", name: "file_write", arguments: { content: "must-not-persist" } },
    }));
    journal.record(event(3, "tool.completed", {
      tool: { id: "tool-file-owner", name: "file_write", success: true },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        toolName: "file_write",
        state: "uncertain",
        evidence,
      }],
    });
  });

  it("fails closed when workspace mutation evidence cannot be read", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir, {
      workspaceMutationEvidenceStore: {
        getOperationEvidence: async () => {
          throw new Error("disk unavailable");
        },
      },
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-file-unavailable", name: "apply_patch" },
    }));
    journal.record(event(3, "tool.completed", {
      tool: { id: "tool-file-unavailable", name: "apply_patch", success: true },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      operations: [{ evidence: "workspace_mutation_evidence_unavailable" }],
    });
  });

  it("reopens an unfinished mutation as uncertain", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-call-uncertain", name: "apply_patch", arguments: { patch: "secret" } },
    }));

    const restarted = new CodingRunReconciliationJournal(stateDir);
    await expect(restarted.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      journalState: "available",
      observedOperationCount: 1,
      mutationOperationCount: 1,
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        toolName: "apply_patch",
        mutation: "possible",
        state: "started",
        startedSeq: 2,
        evidence: "tool_started",
      }],
    });
  });

  it("does not treat a completion without durable start evidence as applied", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(3, "tool.completed", {
      tool: { id: "tool-call-missing-start", name: "file_write", success: true },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        toolName: "file_write",
        state: "uncertain",
        completedSeq: 3,
        evidence: "completion_without_start",
      }],
    });
  });

  it("keeps a completed read-only tool out of side-effect counts", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-call-read", name: "file_read", arguments: { path: "private.txt" } },
    }));
    journal.record(event(3, "tool.completed", {
      tool: { id: "tool-call-read", name: "file_read", success: true, output: "private-content" },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "none",
      observedOperationCount: 1,
      mutationOperationCount: 0,
      appliedOperationCount: 0,
      uncertainOperationCount: 0,
      operations: [{
        toolName: "file_read",
        mutation: "none",
        state: "none",
        evidence: "tool_completed_success",
      }],
    });
  });

  it("deduplicates repeated events and fails closed on operation identity drift", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);
    const started = event(2, "tool.started", {
      tool: { id: "tool-call-drift", name: "file_write", arguments: { content: "secret" } },
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(started);
    journal.record(started);
    journal.record(event(3, "tool.completed", {
      tool: { id: "tool-call-drift", name: "file_read", success: true },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      observedOperationCount: 1,
      mutationOperationCount: 1,
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        toolName: "unknown",
        mutation: "unknown",
        state: "uncertain",
        evidence: "operation_identity_conflict",
      }],
    });
  });

  it("fails closed when duplicate completions disagree about the outcome", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-call-outcome-drift", name: "file_write" },
    }));
    journal.record(event(3, "tool.completed", {
      tool: { id: "tool-call-outcome-drift", name: "file_write", success: false },
    }));
    journal.record(event(4, "tool.completed", {
      tool: { id: "tool-call-outcome-drift", name: "file_write", success: true },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        toolName: "file_write",
        mutation: "possible",
        state: "uncertain",
        evidence: "operation_outcome_conflict",
      }],
    });
  });

  it("refuses to append beyond the configured per-run capacity", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);
    journal.record(event(1, "run.started", { status: "running" }));
    const journalDir = path.join(stateDir, "coding-run-reconciliation");
    const [journalFile] = await fs.readdir(journalDir);
    const initialSize = (await fs.stat(path.join(journalDir, journalFile!))).size;
    const boundedJournal = new CodingRunReconciliationJournal(stateDir, { maxBytesPerRun: initialSize });

    expect(() => boundedJournal.record(event(2, "tool.started", {
      tool: { id: "tool-call-capacity", name: "file_write" },
    }))).toThrow("capacity");
    expect((await fs.stat(path.join(journalDir, journalFile!))).size).toBe(initialSize);
  });

  it("rejects unexpected persisted fields and removes settled evidence", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);
    journal.record(event(1, "run.started", { status: "running" }));
    const journalDir = path.join(stateDir, "coding-run-reconciliation");
    const [journalFile] = await fs.readdir(journalDir);
    const journalPath = path.join(journalDir, journalFile!);
    const record = JSON.parse(await fs.readFile(journalPath, "utf-8")) as Record<string, unknown>;
    await fs.writeFile(journalPath, `${JSON.stringify({ ...record, arguments: "must-not-be-accepted" })}\n`);

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      journalState: "unavailable",
      reason: "journal_invalid",
    });
    await expect(journal.remove(binding)).resolves.toBe(true);
    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      journalState: "missing",
      reason: "journal_missing",
    });
  });

  it("classifies command_job actions without persisting their arguments", async () => {
    const stateDir = await createStateDir();
    const journal = new CodingRunReconciliationJournal(stateDir);
    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: {
        id: "tool-command-read",
        name: "command_job",
        arguments: { action: "read", jobId: "must-not-persist" },
      },
    }));
    journal.record(event(3, "tool.completed", {
      tool: { id: "tool-command-read", name: "command_job", success: true },
    }));
    journal.record(event(4, "tool.started", {
      tool: { id: "tool-command-unknown", name: "command_job", arguments: { action: "future_action" } },
    }));
    journal.record(event(5, "tool.completed", {
      tool: { id: "tool-command-unknown", name: "command_job", success: true },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      observedOperationCount: 2,
      mutationOperationCount: 1,
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [
        { toolName: "command_job", mutation: "none", state: "none" },
        { toolName: "command_job", mutation: "unknown", state: "uncertain" },
      ],
    });
    const journalDir = path.join(stateDir, "coding-run-reconciliation");
    const [journalFile] = await fs.readdir(journalDir);
    const persisted = await fs.readFile(path.join(journalDir, journalFile!), "utf-8");
    expect(persisted).not.toContain("must-not-persist");
    expect(persisted).not.toContain("future_action");
    expect(persisted).not.toContain("\"action\"");
    expect(persisted).not.toContain("\"jobId\"");
  });

  it("fails closed when a successful delegate_task child is interrupted", async () => {
    const stateDir = await createStateDir();
    const operationId = createTestOperationId("tool-delegate-interrupted");
    const journal = new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: createDelegationTaskStore([{
        id: "task-sensitive-1",
        kind: "sub_agent",
        parentConversationId: binding.conversationId,
        parentOperationId: operationId,
        sessionId: "session-sensitive-1",
        status: "interrupted",
      }]),
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-delegate-interrupted", name: "delegate_task", arguments: { instruction: "must-not-persist" } },
    }));
    journal.record(event(3, "tool.completed", {
      tool: {
        id: "tool-delegate-interrupted",
        name: "delegate_task",
        success: true,
        metadata: {
          delegationResults: [{
            workerSuccess: true,
            accepted: true,
            taskId: "task-sensitive-1",
            sessionId: "session-sensitive-1",
            outputPath: "E:/sensitive/output.md",
          }],
        },
      },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        toolName: "delegate_task",
        state: "uncertain",
        evidence: "delegation_child_not_done",
      }],
    });

    const journalDir = path.join(stateDir, "coding-run-reconciliation");
    const [journalFile] = await fs.readdir(journalDir);
    const persisted = await fs.readFile(path.join(journalDir, journalFile!), "utf-8");
    expect(persisted).not.toContain("task-sensitive-1");
    expect(persisted).not.toContain("session-sensitive-1");
    expect(persisted).not.toContain("must-not-persist");
    expect(persisted).not.toContain("E:/sensitive/output.md");
    expect(persisted).not.toContain("outputPath");
  });

  it("marks a successful delegate_task applied only when the bound child is durably done", async () => {
    const stateDir = await createStateDir();
    const operationId = createTestOperationId("tool-delegate-done");
    const journal = new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: createDelegationTaskStore([{
        id: "task-done-1",
        kind: "sub_agent",
        parentConversationId: binding.conversationId,
        parentOperationId: operationId,
        sessionId: "session-done-1",
        status: "done",
      }]),
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-delegate-done", name: "delegate_task" },
    }));
    journal.record(event(3, "tool.completed", {
      tool: {
        id: "tool-delegate-done",
        name: "delegate_task",
        success: true,
        metadata: {
          delegationResults: [{
            workerSuccess: true,
            accepted: true,
            taskId: "task-done-1",
            sessionId: "session-done-1",
          }],
        },
      },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "applied",
      appliedOperationCount: 1,
      uncertainOperationCount: 0,
      operations: [{
        toolName: "delegate_task",
        state: "applied",
        evidence: "delegation_children_applied",
      }],
    });
  });

  it("keeps delegate_parallel uncertain when any child is interrupted", async () => {
    const stateDir = await createStateDir();
    const operationId = createTestOperationId("tool-delegate-parallel");
    const journal = new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: createDelegationTaskStore([
        {
          id: "task-parallel-done",
          kind: "sub_agent",
          parentConversationId: binding.conversationId,
          parentOperationId: operationId,
          sessionId: "session-parallel-done",
          status: "done",
        },
        {
          id: "task-parallel-interrupted",
          kind: "sub_agent",
          parentConversationId: binding.conversationId,
          parentOperationId: operationId,
          sessionId: "session-parallel-interrupted",
          status: "interrupted",
        },
      ]),
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: "tool-delegate-parallel", name: "delegate_parallel" },
    }));
    journal.record(event(3, "tool.completed", {
      tool: {
        id: "tool-delegate-parallel",
        name: "delegate_parallel",
        success: true,
        metadata: {
          delegationResults: [
            { workerSuccess: true, accepted: true, taskId: "task-parallel-done", sessionId: "session-parallel-done" },
            { workerSuccess: true, accepted: true, taskId: "task-parallel-interrupted", sessionId: "session-parallel-interrupted" },
          ],
        },
      },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        toolName: "delegate_parallel",
        state: "uncertain",
        evidence: "delegation_child_not_done",
      }],
    });
  });

  it.each([
    {
      name: "missing completion binding",
      metadata: undefined,
      tasks: [{ id: "task-missing", sessionId: "session-missing", status: "done" }],
      evidence: "delegation_binding_missing",
    },
    {
      name: "session binding drift",
      metadata: {
        delegationResults: [{ workerSuccess: true, accepted: true, taskId: "task-drift", sessionId: "session-old" }],
      },
      tasks: [{ id: "task-drift", sessionId: "session-current", status: "done" }],
      evidence: "delegation_binding_conflict",
    },
    {
      name: "duplicate child binding",
      metadata: {
        delegationResults: [
          { workerSuccess: true, accepted: true, taskId: "task-duplicate", sessionId: "session-duplicate" },
          { workerSuccess: true, accepted: true, taskId: "task-duplicate", sessionId: "session-duplicate" },
        ],
      },
      tasks: [{ id: "task-duplicate", sessionId: "session-duplicate", status: "done" }],
      evidence: "delegation_binding_conflict",
    },
  ])("fails closed on $name", async ({ metadata, tasks, evidence }) => {
    const stateDir = await createStateDir();
    const toolCallId = `tool-${stateDir.slice(-8)}`;
    const operationId = createTestOperationId(toolCallId);
    const journal = new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: createDelegationTaskStore(tasks.map((task) => ({
        ...task,
        kind: "sub_agent",
        parentConversationId: binding.conversationId,
        parentOperationId: operationId,
      }))),
    });

    journal.record(event(1, "run.started", { status: "running" }));
    journal.record(event(2, "tool.started", {
      tool: { id: toolCallId, name: "delegate_parallel" },
    }));
    journal.record(event(3, "tool.completed", {
      tool: {
        id: toolCallId,
        name: "delegate_parallel",
        success: true,
        ...(metadata ? { metadata } : {}),
      },
    }));

    await expect(journal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{ state: "uncertain", evidence }],
    });
  });

  it("releases command_job action classifications after terminal events and removal", async () => {
    const terminalStateDir = await createStateDir();
    const terminalJournal = new CodingRunReconciliationJournal(terminalStateDir);
    terminalJournal.record(event(1, "run.started", { status: "running" }));
    terminalJournal.record(event(2, "tool.started", {
      tool: { id: "tool-command-terminal", name: "command_job", arguments: { action: "read" } },
    }));
    terminalJournal.record(event(3, "run.completed", { status: "completed" }));
    terminalJournal.record(event(4, "tool.completed", {
      tool: { id: "tool-command-terminal", name: "command_job", success: true },
    }));

    await expect(terminalJournal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      operations: [{ mutation: "unknown", evidence: "operation_identity_conflict" }],
    });

    const removedStateDir = await createStateDir();
    const removedJournal = new CodingRunReconciliationJournal(removedStateDir);
    removedJournal.record(event(1, "run.started", { status: "running" }));
    removedJournal.record(event(2, "tool.started", {
      tool: { id: "tool-command-removed", name: "command_job", arguments: { action: "read" } },
    }));
    await expect(removedJournal.remove(binding)).resolves.toBe(true);
    removedJournal.record(event(3, "run.started", { status: "running" }));
    removedJournal.record(event(4, "tool.completed", {
      tool: { id: "tool-command-removed", name: "command_job", success: true },
    }));

    await expect(removedJournal.reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      operations: [{ mutation: "unknown", evidence: "completion_without_start" }],
    });
  });
});

function event(
  seq: number,
  type: AgentRunEvent["type"],
  payload: Record<string, unknown>,
): AgentRunEvent {
  return {
    version: CODING_RUN_PROTOCOL_VERSION,
    seq,
    timestampMs: 1_700_000_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  };
}

async function createStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-reconciliation-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createTestOperationId(toolCallId: string): string {
  return `op_${createHash("sha256")
    .update(`conversation\0${binding.conversationId}\0${binding.agentRunId}\0${toolCallId}`)
    .digest("hex")}`;
}

function createDelegationTaskStore(tasks: Array<Record<string, unknown>>) {
  return {
    listTasks: async () => tasks,
  };
}

function createWorkspaceMutationEvidenceStore(state: "committed" | "prepared" | "missing" | "conflict") {
  return {
    getOperationEvidence: async ({ operationId }: { operationId: string }) => ({
      operationId,
      state,
      workspaceCount: state === "missing" ? 0 : 1,
      targetCount: state === "missing" ? 0 : 1,
      committedTargetCount: state === "committed" ? 1 : 0,
    }),
  };
}
