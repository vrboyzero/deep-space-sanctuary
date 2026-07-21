import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import {
  createBridgeAwareStopSubTaskHandler,
  createBridgeSessionGovernanceCapabilities,
  createBridgeSessionResumeController,
  createBridgeSessionTakeoverController,
  reconcileRuntimeLostBridgeSubtasks,
} from "./bridge-subtask-runtime.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";

test("bridge session governance creates, tracks, and completes a governed bridge subtask", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-governance-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const governance = createBridgeSessionGovernanceCapabilities({
    runtimeStore: store,
  });

  const registered = await governance.ensureSessionTask({
    conversationId: "conv-bridge-governance",
    agentId: "coder",
    launchSpec: {
      instruction: "Review the bridge session transcript flow.",
      parentTaskId: "goal-node-1",
      bridgeSubtask: {
        kind: "review",
        summary: "Review the bridge lifecycle semantics.",
      },
    },
    session: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
      firstTurnStrategy: "start-args-prompt",
      firstTurnHint: "Use bridge_session_start.prompt for the first turn.",
      recommendedReadWaitMs: 10_000,
      bridgeSubtask: {
        kind: "review",
        summary: "Review the bridge lifecycle semantics.",
      },
    },
  });

  expect(registered?.taskId).toBeTruthy();

  await governance.attachSession({
    taskId: String(registered?.taskId),
    sessionId: "bridge_governance_1",
    agentId: "coder",
  });
  await governance.recordOutput({
    sessionId: "bridge_governance_1",
    output: "Bridge output delta",
  });
  await governance.completeSession({
    taskId: String(registered?.taskId),
    sessionId: "bridge_governance_1",
    status: "done",
    output: "Bridge session completed successfully.",
  });

  const task = await store.getTask(String(registered?.taskId));
  expect(task).toMatchObject({
    id: registered?.taskId,
    kind: "bridge_session",
    status: "done",
    sessionId: "bridge_governance_1",
    bridgeSessionRuntime: {
      state: "closed",
    },
    launchSpec: {
      channel: "bridge_session",
      bridgeSubtask: {
        kind: "review",
      },
      bridgeSession: {
        targetId: "codex_session",
        action: "interactive",
        firstTurnStrategy: "start-args-prompt",
        recommendedReadWaitMs: 10_000,
      },
    },
    outputPreview: "Bridge session completed successfully.",
  });
  expect(task?.progress.message).toBe("Task completed.");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("bridge session resume controller relaunches the governed task and records delivered resume metadata", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-resume-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createBridgeSessionTask({
    parentConversationId: "conv-bridge-resume",
    agentId: "coder",
    profileId: "coder",
    instruction: "Continue the code review.",
    bridgeSubtask: {
      kind: "review",
      targetId: "codex_session",
      action: "interactive",
      summary: "Review bridge resume behavior.",
    },
    bridgeSession: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
      firstTurnStrategy: "start-args-prompt",
      recommendedReadWaitMs: 10_000,
      summary: "Review bridge resume behavior.",
    },
  });
  await store.attachSession(task.id, "bridge_resume_1", "coder", "coder");
  await store.completeTask(task.id, {
    status: "done",
    sessionId: "bridge_resume_1",
    output: "first review pass",
  });

  const execute = vi.fn(async (request, conversationId, agentId, _user, _sender, _room, runtimeContext) => {
    expect(conversationId).toBe("conv-bridge-resume");
    expect(agentId).toBe("coder");
    expect(runtimeContext?.bridgeGovernanceTaskId).toBe(task.id);
    expect(runtimeContext?.agentWhitelistMode).toBe("governed_bridge_internal");
    expect(runtimeContext?.launchSpec?.bridgeSubtask).toMatchObject({
      kind: "review",
      targetId: "codex_session",
      action: "interactive",
    });
    expect(request.name).toBe("bridge_session_start");
    expect(request.arguments).toMatchObject({
      targetId: "codex_session",
      action: "interactive",
      cwd: stateDir,
    });
    expect(typeof request.arguments.prompt).toBe("string");
    await store.attachSession(task.id, "bridge_resume_2", "coder", "coder");
    return {
      id: request.id,
      name: request.name,
      success: true,
      output: JSON.stringify({
        sessionId: "bridge_resume_2",
      }),
      durationMs: 0,
    };
  });

  const controller = createBridgeSessionResumeController({
    runtimeStore: store,
    bridgeRuntimeStore: store,
    toolExecutor: { execute },
  });

  const resumed = await controller(task.id, "Continue with the remaining review items.");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(resumed).toMatchObject({
    id: task.id,
    kind: "bridge_session",
    status: "running",
    sessionId: "bridge_resume_2",
    resume: [
      expect.objectContaining({
        status: "delivered",
        deliveredSessionId: "bridge_resume_2",
        resumedFromSessionId: "bridge_resume_1",
      }),
    ],
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("bridge session resume replay does not relaunch outside the command claim owner", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-resume-owner-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createBridgeSessionTask({
    parentConversationId: "conv-bridge-resume-owner",
    agentId: "coder",
    profileId: "coder",
    instruction: "Resume exactly once.",
    bridgeSession: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
    },
  });
  await store.attachSession(task.id, "bridge_resume_owner_1", "coder", "coder");
  await store.completeTask(task.id, {
    status: "done",
    sessionId: "bridge_resume_owner_1",
    output: "first result",
  });
  await store.requestResume(task.id, "Retry the governed bridge session.", {
    sessionId: "bridge_resume_owner_1",
    idempotencyKey: "bridge-resume-request-1",
    expectedRevision: 0,
  });

  const execute = vi.fn();
  const controller = createBridgeSessionResumeController({
    runtimeStore: store,
    bridgeRuntimeStore: store,
    toolExecutor: { execute } as any,
  });
  const replayed = await controller(task.id, "Retry the governed bridge session.", {
    idempotencyKey: "bridge-resume-request-1",
    expectedRevision: 0,
  });

  expect(execute).not.toHaveBeenCalled();
  expect(replayed?.resume).toHaveLength(1);
  expect(replayed?.activeCommandClaim).toMatchObject({
    kind: "resume",
    idempotencyKey: "bridge-resume-request-1",
    generation: 1,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("bridge session takeover controller closes the running session, relaunches it, and records delivered takeover metadata", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-takeover-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createBridgeSessionTask({
    parentConversationId: "conv-bridge-takeover",
    agentId: "coder",
    profileId: "coder",
    instruction: "Continue the patch task.",
    bridgeSubtask: {
      kind: "patch",
      targetId: "claude_code_session",
      action: "interactive",
      summary: "Patch bridge takeover behavior.",
    },
    bridgeSession: {
      targetId: "claude_code_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "claude interactive",
      firstTurnStrategy: "write",
      recommendedReadWaitMs: 2_200,
      summary: "Patch bridge takeover behavior.",
    },
  });
  await store.attachSession(task.id, "bridge_takeover_1", "coder", "coder");

  const execute = vi.fn(async (request, conversationId, agentId, _user, _sender, _room, runtimeContext) => {
    expect(conversationId).toBe("conv-bridge-takeover");
    expect(runtimeContext?.bridgeGovernanceTaskId).toBe(task.id);
    expect(runtimeContext?.agentWhitelistMode).toBe("governed_bridge_internal");

    if (request.name === "bridge_session_close") {
      expect(request.arguments).toMatchObject({ sessionId: "bridge_takeover_1" });
      await store.completeTask(task.id, {
        status: "stopped",
        sessionId: "bridge_takeover_1",
        error: "Safe-point takeover requested.",
      });
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({ sessionId: "bridge_takeover_1", status: "closed" }),
        durationMs: 0,
      };
    }

    if (request.name === "bridge_session_start") {
      expect(agentId).toBe("reviewer");
      expect(request.arguments).toMatchObject({
        targetId: "claude_code_session",
        action: "interactive",
        cwd: stateDir,
      });
      expect(request.arguments.prompt).toBeUndefined();
      await store.attachSession(task.id, "bridge_takeover_2", "reviewer", "reviewer");
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({ sessionId: "bridge_takeover_2" }),
        durationMs: 0,
      };
    }

    expect(request.name).toBe("bridge_session_write");
    expect(agentId).toBe("reviewer");
    expect(request.arguments).toMatchObject({
      sessionId: "bridge_takeover_2",
      waitMs: 2_200,
    });
    expect(String(request.arguments.data)).toContain("Take over the claude_code_session.interactive task as agent reviewer.");
    return {
      id: request.id,
      name: request.name,
      success: true,
      output: JSON.stringify({ sessionId: "bridge_takeover_2", status: "active" }),
      durationMs: 0,
    };
  });

  const controller = createBridgeSessionTakeoverController({
    runtimeStore: store,
    bridgeRuntimeStore: store,
    toolExecutor: { execute },
  });

  const takenOver = await controller(task.id, "reviewer", "Continue with verification-focused follow-up.");
  expect(execute).toHaveBeenCalledTimes(3);
  expect(takenOver).toMatchObject({
    id: task.id,
    kind: "bridge_session",
    status: "running",
    sessionId: "bridge_takeover_2",
    agentId: "reviewer",
    launchSpec: {
      agentId: "reviewer",
      profileId: "reviewer",
    },
    takeover: [
      expect.objectContaining({
        agentId: "reviewer",
        mode: "safe_point",
        status: "delivered",
        deliveredSessionId: "bridge_takeover_2",
        resumedFromSessionId: "bridge_takeover_1",
      }),
    ],
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("bridge-aware stop handler closes a running bridge session through tool executor", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-stop-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createBridgeSessionTask({
    parentConversationId: "conv-bridge-stop",
    agentId: "coder",
    profileId: "coder",
    instruction: "Stop the running bridge session.",
    bridgeSubtask: {
      kind: "analyze",
      targetId: "codex_session",
      action: "interactive",
      summary: "Analyze stop behavior.",
    },
    bridgeSession: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
      firstTurnStrategy: "start-args-prompt",
      summary: "Analyze stop behavior.",
    },
  });
  await store.attachSession(task.id, "bridge_stop_1", "coder", "coder");

  const execute = vi.fn(async (request, conversationId, agentId, _user, _sender, _room, runtimeContext) => {
    expect(conversationId).toBe("conv-bridge-stop");
    expect(agentId).toBe("coder");
    expect(runtimeContext?.bridgeGovernanceTaskId).toBe(task.id);
    expect(runtimeContext?.agentWhitelistMode).toBe("governed_bridge_internal");
    expect(request.name).toBe("bridge_session_close");
    expect(request.arguments).toMatchObject({ sessionId: "bridge_stop_1" });
    await store.completeTask(task.id, {
      status: "stopped",
      sessionId: "bridge_stop_1",
    });
    return {
      id: request.id,
      name: request.name,
      success: true,
      output: JSON.stringify({ sessionId: "bridge_stop_1", status: "closed" }),
      durationMs: 0,
    };
  });

  const stopSubTask = createBridgeAwareStopSubTaskHandler({
    subTaskRuntimeStore: store,
    toolExecutor: { execute },
  });

  const stopped = await stopSubTask(task.id, "User requested stop");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(stopped).toMatchObject({
    id: task.id,
    status: "stopped",
    sessionId: "bridge_stop_1",
    stopReason: "User requested stop",
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("bridge-aware stop handler lets only the command claim owner stop a regular subtask", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-stop-owner-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-stop-owner",
      agentId: "coder",
      instruction: "Stop exactly once.",
    },
  });
  await store.attachSession(task.id, "subtask_stop_owner_1", "coder", "coder");

  let releaseStop!: () => void;
  const stopReleased = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  let signalStopStarted!: () => void;
  const stopStarted = new Promise<void>((resolve) => {
    signalStopStarted = resolve;
  });
  const stopSession = vi.fn(async () => {
    signalStopStarted();
    await stopReleased;
    return true;
  });
  const stopSubTask = createBridgeAwareStopSubTaskHandler({
    subTaskRuntimeStore: store,
    subAgentOrchestrator: { stopSession },
  });

  const owner = stopSubTask(task.id, "User requested stop", {
    expectedRevision: 0,
    idempotencyKey: "stop-request-owner-1",
  });
  await stopStarted;
  const replay = await stopSubTask(task.id, "User requested stop", {
    expectedRevision: 0,
    idempotencyKey: "stop-request-owner-1",
  });

  expect(stopSession).toHaveBeenCalledTimes(1);
  expect(replay).toMatchObject({
    id: task.id,
    status: "running",
    commandGeneration: 1,
    activeCommandClaim: {
      kind: "stop",
      idempotencyKey: "stop-request-owner-1",
    },
  });

  releaseStop();
  await expect(owner).resolves.toMatchObject({
    id: task.id,
    status: "stopped",
    commandGeneration: 1,
    activeCommandClaim: undefined,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("bridge-aware stop handler releases a failed claim so a newer revision can retry", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-stop-retry-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-stop-retry",
      agentId: "coder",
      instruction: "Retry a failed stop.",
    },
  });
  await store.attachSession(task.id, "subtask_stop_retry_1", "coder", "coder");

  const failedHandler = createBridgeAwareStopSubTaskHandler({
    subTaskRuntimeStore: store,
    subAgentOrchestrator: { stopSession: vi.fn(async () => false) },
  });
  await expect(failedHandler(task.id, "First stop attempt", {
    expectedRevision: 0,
    idempotencyKey: "stop-request-failed-1",
  })).rejects.toThrow("Failed to stop subtask session subtask_stop_retry_1");
  const failedRecord = await store.getTask(task.id);
  expect(failedRecord).toMatchObject({
    status: "running",
    commandGeneration: 1,
    activeCommandClaim: undefined,
    stopRequestedAt: undefined,
  });
  expect(failedRecord?.notifications.map((item) => item.kind)).toEqual(expect.arrayContaining([
    "stop_requested",
    "stop_failed",
  ]));

  const retryHandler = createBridgeAwareStopSubTaskHandler({
    subTaskRuntimeStore: store,
    subAgentOrchestrator: { stopSession: vi.fn(async () => true) },
  });
  await expect(retryHandler(task.id, "Second stop attempt", {
    expectedRevision: 1,
    idempotencyKey: "stop-request-retry-2",
  })).resolves.toMatchObject({
    status: "stopped",
    commandGeneration: 2,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("reconcileRuntimeLostBridgeSubtasks settles persisted active bridge sessions into subtask runtime", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-runtime-lost-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createBridgeSessionTask({
    parentConversationId: "conv-bridge-runtime-lost",
    agentId: "coder",
    profileId: "coder",
    instruction: "Recover a lost bridge session after restart.",
    bridgeSubtask: {
      kind: "review",
      targetId: "codex_session",
      action: "interactive",
      summary: "Recover runtime-lost bridge session.",
    },
    bridgeSession: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
      firstTurnStrategy: "start-args-prompt",
      summary: "Recover runtime-lost bridge session.",
    },
  });
  await store.attachSession(task.id, "bridge_runtime_lost_1", "coder", "coder");

  const sessionDir = path.join(stateDir, "generated", "agent-bridge", "sessions", "bridge_runtime_lost_1");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, "transcript.live.json"), JSON.stringify({
    events: [],
  }, null, 2), "utf-8");
  await fs.writeFile(path.join(stateDir, "generated", "agent-bridge", "sessions", "registry.json"), JSON.stringify({
    records: [
      {
        id: "bridge_runtime_lost_1",
        runtimeSessionId: "pty_runtime_lost_1",
        targetId: "codex_session",
        action: "interactive",
        transport: "pty",
        taskId: task.id,
        workspaceRoot: stateDir,
        cwd: stateDir,
        commandPreview: "codex interactive",
        cols: 80,
        rows: 24,
        createdAt: Date.now() - 5_000,
        updatedAt: Date.now() - 5_000,
        status: "active",
      },
    ],
  }, null, 2), "utf-8");

  const reconciled = await reconcileRuntimeLostBridgeSubtasks({
    workspaceRoot: stateDir,
    runtimeStore: store,
  });
  expect(reconciled).toEqual({
    reconciledTaskIds: [task.id],
    sessionIds: ["bridge_runtime_lost_1"],
    orphanSessionIds: [],
  });

  const updated = await store.getTask(task.id);
  expect(updated).toMatchObject({
    id: task.id,
    kind: "bridge_session",
    status: "error",
    sessionId: "bridge_runtime_lost_1",
    bridgeSessionRuntime: {
      state: "runtime-lost",
      closeReason: "runtime-lost",
      blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
    },
  });
  expect(updated?.error).toContain("runtime lost");
  expect(updated?.outputPreview).toContain("runtime-lost");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("reconcileRuntimeLostBridgeSubtasks classifies unbound recovered sessions as orphan cleanup", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-orphan-cleanup-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const sessionDir = path.join(stateDir, "generated", "agent-bridge", "sessions", "bridge_orphan_1");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, "transcript.live.json"), JSON.stringify({
    events: [],
  }, null, 2), "utf-8");
  await fs.writeFile(path.join(stateDir, "generated", "agent-bridge", "sessions", "registry.json"), JSON.stringify({
    records: [
      {
        id: "bridge_orphan_1",
        runtimeSessionId: "pty_orphan_1",
        targetId: "codex_session",
        action: "interactive",
        transport: "pty",
        workspaceRoot: stateDir,
        cwd: stateDir,
        commandPreview: "codex interactive",
        cols: 80,
        rows: 24,
        createdAt: Date.now() - 5_000,
        updatedAt: Date.now() - 5_000,
        status: "active",
      },
    ],
  }, null, 2), "utf-8");

  const reconciled = await reconcileRuntimeLostBridgeSubtasks({
    workspaceRoot: stateDir,
    runtimeStore: store,
  });
  expect(reconciled).toEqual({
    reconciledTaskIds: [],
    sessionIds: [],
    orphanSessionIds: ["bridge_orphan_1"],
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});
