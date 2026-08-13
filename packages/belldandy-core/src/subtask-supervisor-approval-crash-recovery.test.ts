import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION, type AgentRunEvent } from "./coding-run/contracts.js";
import { PendingToolPermissionRuntime } from "./coding-run/pending-tool-permission-runtime.js";
import {
  CodingRunReconciliationJournal,
  createConversationOperationId,
} from "./coding-run/reconciliation-journal.js";
import {
  reattachSubTaskSupervisorRuntime,
  SubTaskRuntimeStore,
} from "./task-runtime.js";
import { SubTaskSupervisorFanInRuntime } from "./subtask-supervisor-fan-in-runtime.js";
import { SubTaskSupervisorRuntime } from "./subtask-supervisor-runtime.js";
import { SubTaskWorktreeRuntime } from "./worktree-runtime.js";

const execFile = promisify(execFileCallback);

test("fails a pending approval closed when a worktree lane crashes before delegation completion", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-approval-crash-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const binding = { conversationId: "conversation-manager", agentRunId: "run-manager" };
  const toolCallId = "tool-delegate-parallel";
  const parentOperationId = createConversationOperationId({ ...binding, toolCallId });
  if (!parentOperationId) throw new Error("expected a valid parent operation id");

  const originalPermissions = new PendingToolPermissionRuntime({ timeoutMs: 60_000 });
  let pendingApproval: Promise<"allow" | "deny"> | undefined;
  const worktreeRuntime = new SubTaskWorktreeRuntime(stateDir);
  let taskId: string | undefined;
  let persistedWorktreePath: string | undefined;

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");
    await runGit(["init"], repoDir);
    await runGit(["config", "user.name", "Belldandy Test"], repoDir);
    await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
    await runGit(["add", "."], repoDir);
    await runGit(["commit", "-m", "init"], repoDir);

    const originalStore = new SubTaskRuntimeStore(stateDir);
    await originalStore.load();
    const task = await originalStore.createTask({
      launchSpec: {
        instruction: "Wait for approval before changing the isolated lane.",
        parentConversationId: binding.conversationId,
        agentId: "coder",
        profileId: "coder",
        background: true,
        timeoutMs: 30_000,
        channel: "subtask",
        cwd: repoDir,
        isolationMode: "worktree",
        role: "coder",
      },
      parentOperationId,
      supervisorBinding: {
        managerConversationId: binding.conversationId,
        managerAgentRunId: binding.agentRunId,
        teamId: "team-supervised",
        laneId: "lane_1",
        mode: "write",
      },
    });
    taskId = task.id;
    const prepared = await worktreeRuntime.prepareTaskLaunch(task.id, {
      instruction: task.instruction,
      parentConversationId: binding.conversationId,
      agentId: "coder",
      profileId: "coder",
      background: true,
      timeoutMs: 30_000,
      channel: "subtask",
      cwd: repoDir,
      isolationMode: "worktree",
      role: "coder",
    });
    persistedWorktreePath = prepared.summary.worktreePath;
    await originalStore.updateTaskLaunchSpec(task.id, {
      launchSpec: prepared.launchSpec,
      runtimeSummary: prepared.summary,
    });
    await originalStore.attachSession(task.id, "session-before-crash", "coder", "coder");

    const journal = new CodingRunReconciliationJournal(stateDir, { delegationTaskStore: originalStore });
    journal.record(event(1, "run.started", binding, { status: "running" }));
    journal.record(event(2, "tool.started", binding, {
      tool: { id: toolCallId, name: "delegate_parallel" },
    }));
    pendingApproval = originalPermissions.request({
      conversationId: binding.conversationId,
      agentRunId: binding.agentRunId,
      worktreeId: task.id,
      toolCallId: "tool-lane-write",
      toolName: "file_write",
    });
    expect(originalPermissions.list()).toHaveLength(1);

    const recoveredStore = new SubTaskRuntimeStore(stateDir);
    await recoveredStore.load();
    const recoveredSupervisor = new SubTaskSupervisorRuntime({
      maxActiveChildren: 4,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    });
    await reattachSubTaskSupervisorRuntime({
      runtimeStore: recoveredStore,
      supervisorRuntime: recoveredSupervisor,
    });

    const recoveredTask = await recoveredStore.getTask(task.id);
    expect(recoveredTask).toMatchObject({
      status: "interrupted",
      sessionId: "session-before-crash",
      recovery: { state: "runtime_lost", mutationReplay: "forbidden" },
    });
    expect(recoveredSupervisor.observe({
      managerConversationId: binding.conversationId,
      managerAgentRunId: binding.agentRunId,
      teamId: "team-supervised",
      laneId: "lane_1",
      taskId: task.id,
      sessionId: "session-before-crash",
    })).toMatchObject({ status: "interrupted", mode: "write" });

    const recoveredPermissions = new PendingToolPermissionRuntime();
    expect(recoveredPermissions.respond({
      agentRunId: binding.agentRunId,
      worktreeId: task.id,
      toolCallId: "tool-lane-write",
      decision: "allow",
    })).toEqual({ ok: false, code: "not_found" });
    expect(recoveredPermissions.list()).toEqual([]);

    await expect(new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: recoveredStore,
    }).reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        operationId: parentOperationId,
        toolName: "delegate_parallel",
        state: "started",
        evidence: "tool_started",
      }],
    });

    const worktree = await worktreeRuntime.reconcileTaskRuntime(task.id, recoveredTask!.launchSpec);
    expect(worktree).toMatchObject({ worktreeStatus: "created" });
    expect(path.resolve(String(worktree.worktreePath))).toBe(path.resolve(String(persistedWorktreePath)));
    await expect(fs.readFile(path.join(repoDir, "README.md"), "utf-8")).resolves.toBe("initial\n");
    expect((await runGit(["status", "--porcelain"], repoDir))).toBe("");
  } finally {
    originalPermissions.cancelRun(binding.agentRunId);
    await pendingApproval?.catch(() => "deny");
    if (taskId && persistedWorktreePath) {
      await worktreeRuntime.cleanupTaskRuntime(taskId, {
        cwd: repoDir,
        resolvedCwd: persistedWorktreePath,
        isolationMode: "worktree",
        worktreePath: persistedWorktreePath,
        worktreeRepoRoot: repoDir,
        worktreeBranch: `belldandy-${taskId}`,
      }).catch(() => undefined);
    }
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 20_000);

test("rejects fan-in when an approved dirty lane crashes across delegation completion", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-approved-crash-"));
  const repoDir = path.join(rootDir, "repo");
  const stateDir = path.join(rootDir, "state");
  const binding = { conversationId: "conversation-manager", agentRunId: "run-manager" };
  const toolCallId = "tool-delegate-parallel-approved";
  const parentOperationId = createConversationOperationId({ ...binding, toolCallId });
  if (!parentOperationId) throw new Error("expected a valid parent operation id");

  const permissions = new PendingToolPermissionRuntime();
  const worktreeRuntime = new SubTaskWorktreeRuntime(stateDir);
  let taskId: string | undefined;
  let persistedWorktreePath: string | undefined;

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");
    await runGit(["init"], repoDir);
    await runGit(["config", "user.name", "Belldandy Test"], repoDir);
    await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
    await runGit(["add", "."], repoDir);
    await runGit(["commit", "-m", "init"], repoDir);

    const originalStore = new SubTaskRuntimeStore(stateDir);
    await originalStore.load();
    const task = await originalStore.createTask({
      launchSpec: {
        instruction: "Apply an approved change only in the isolated lane.",
        parentConversationId: binding.conversationId,
        agentId: "coder",
        profileId: "coder",
        background: true,
        timeoutMs: 30_000,
        channel: "subtask",
        cwd: repoDir,
        isolationMode: "worktree",
        role: "coder",
      },
      parentOperationId,
      supervisorBinding: {
        managerConversationId: binding.conversationId,
        managerAgentRunId: binding.agentRunId,
        teamId: "team-supervised",
        laneId: "lane_approved",
        mode: "write",
      },
    });
    taskId = task.id;
    const prepared = await worktreeRuntime.prepareTaskLaunch(task.id, {
      instruction: task.instruction,
      parentConversationId: binding.conversationId,
      agentId: "coder",
      profileId: "coder",
      background: true,
      timeoutMs: 30_000,
      channel: "subtask",
      cwd: repoDir,
      isolationMode: "worktree",
      role: "coder",
    });
    persistedWorktreePath = prepared.summary.worktreePath;
    await originalStore.updateTaskLaunchSpec(task.id, {
      launchSpec: prepared.launchSpec,
      runtimeSummary: prepared.summary,
    });
    await originalStore.attachSession(task.id, "session-approved-before-crash", "coder", "coder");

    const journal = new CodingRunReconciliationJournal(stateDir, { delegationTaskStore: originalStore });
    journal.record(event(1, "run.started", binding, { status: "running" }));
    journal.record(event(2, "tool.started", binding, {
      tool: { id: toolCallId, name: "delegate_parallel" },
    }));
    const approval = permissions.request({
      conversationId: binding.conversationId,
      agentRunId: binding.agentRunId,
      worktreeId: task.id,
      toolCallId: "tool-approved-lane-write",
      toolName: "file_write",
    });
    expect(permissions.respond({
      agentRunId: binding.agentRunId,
      worktreeId: task.id,
      toolCallId: "tool-approved-lane-write",
      decision: "allow",
      responderKind: "human",
    })).toEqual({ ok: true, accepted: true });
    await expect(approval).resolves.toBe("allow");
    await fs.writeFile(path.join(String(persistedWorktreePath), "README.md"), "approved lane change\n", "utf-8");

    await expect(new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: originalStore,
    }).reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{ operationId: parentOperationId, state: "started", evidence: "tool_started" }],
    });
    journal.record(event(3, "tool.completed", binding, {
      tool: {
        id: toolCallId,
        name: "delegate_parallel",
        success: true,
        metadata: {
          delegationResults: [{
            workerSuccess: true,
            accepted: true,
            taskId: task.id,
            sessionId: "session-approved-before-crash",
          }],
        },
      },
    }));

    const recoveredStore = new SubTaskRuntimeStore(stateDir);
    await recoveredStore.load();
    const recoveredSupervisor = new SubTaskSupervisorRuntime({
      maxActiveChildren: 4,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    });
    await reattachSubTaskSupervisorRuntime({
      runtimeStore: recoveredStore,
      supervisorRuntime: recoveredSupervisor,
    });
    const recoveredTask = await recoveredStore.getTask(task.id);
    expect(recoveredTask).toMatchObject({
      status: "interrupted",
      recovery: { state: "runtime_lost", mutationReplay: "forbidden" },
    });
    expect(recoveredSupervisor.observe({
      managerConversationId: binding.conversationId,
      managerAgentRunId: binding.agentRunId,
      teamId: "team-supervised",
      laneId: "lane_approved",
      taskId: task.id,
      sessionId: "session-approved-before-crash",
    })).toMatchObject({ status: "interrupted" });

    await expect(new CodingRunReconciliationJournal(stateDir, {
      delegationTaskStore: recoveredStore,
    }).reconcile(binding)).resolves.toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        operationId: parentOperationId,
        state: "uncertain",
        evidence: "delegation_child_not_done",
      }],
    });

    const fanIn = new SubTaskSupervisorFanInRuntime({
      runtimeStore: recoveredStore,
      worktreeRuntime,
      resolutionRuntime: {
        preview: async () => { throw new Error("resolution must not run for an interrupted lane"); },
        confirm: async () => { throw new Error("confirmation must not run for an interrupted lane"); },
      },
    });
    await expect(fanIn.preview({
      managerConversationId: binding.conversationId,
      managerAgentRunId: binding.agentRunId,
      teamId: "team-supervised",
      lanes: [{
        binding: {
          managerConversationId: binding.conversationId,
          managerAgentRunId: binding.agentRunId,
          teamId: "team-supervised",
          laneId: "lane_approved",
          taskId: task.id,
          sessionId: "session-approved-before-crash",
        },
        expectedRevision: 0,
        testEvidence: {
          schemaVersion: "subtask-supervisor-test-evidence/v1",
          taskId: task.id,
          sessionId: "session-approved-before-crash",
          revision: 0,
          status: "passed",
          artifact: { id: "test-approved-lane", sha256: "a".repeat(64) },
        },
      }],
      reviewerEvidence: {
        schemaVersion: "subtask-supervisor-review-evidence/v1",
        mode: "read_only",
        verdict: "approved",
        artifact: { id: "review-approved-lane", sha256: "b".repeat(64) },
      },
    })).rejects.toMatchObject({ code: "fan_in_evidence_invalid" });

    const worktree = await worktreeRuntime.reconcileTaskRuntime(task.id, recoveredTask!.launchSpec);
    expect(worktree).toMatchObject({ worktreeStatus: "created" });
    await expect(fs.readFile(path.join(String(worktree.worktreePath), "README.md"), "utf-8"))
      .resolves.toBe("approved lane change\n");
    await expect(fs.readFile(path.join(repoDir, "README.md"), "utf-8")).resolves.toBe("initial\n");
    expect(await runGit(["status", "--porcelain"], repoDir)).toBe("");
  } finally {
    permissions.cancelRun(binding.agentRunId);
    if (taskId && persistedWorktreePath) {
      await worktreeRuntime.cleanupTaskRuntime(taskId, {
        cwd: repoDir,
        resolvedCwd: persistedWorktreePath,
        isolationMode: "worktree",
        worktreePath: persistedWorktreePath,
        worktreeRepoRoot: repoDir,
        worktreeBranch: `belldandy-${taskId}`,
      }).catch(() => undefined);
    }
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  }
}, 20_000);

function event(
  seq: number,
  type: AgentRunEvent["type"],
  binding: { conversationId: string; agentRunId: string },
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

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}
