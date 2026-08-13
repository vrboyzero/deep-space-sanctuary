import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBridgeAwareStopSubTaskHandler } from "./bridge-subtask-runtime.js";
import { SubTaskSupervisorControlRuntime } from "./subtask-supervisor-control-runtime.js";
import { SubTaskSupervisorRuntime } from "./subtask-supervisor-runtime.js";
import { createSubTaskUpdateController, SubTaskRuntimeStore } from "./task-runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("SubTaskSupervisorControlRuntime", () => {
  it("observes only the current authoritative parallel lane binding", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-control-observe-"));
    cleanupPaths.push(stateDir);
    const store = new SubTaskRuntimeStore(stateDir);
    await store.load();
    const task = await store.createTask({
      launchSpec: {
        parentConversationId: "conversation-manager",
        agentId: "coder",
        instruction: "Implement the isolated lane.",
      },
      supervisorBinding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-parallel",
        laneId: "lane_1",
        mode: "write",
      },
    });
    await store.attachSession(task.id, "session-current", "coder", "coder");
    const supervisorRuntime = new SubTaskSupervisorRuntime({
      maxActiveChildren: 2,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    });
    const controlRuntime = new SubTaskSupervisorControlRuntime({
      runtimeStore: store,
      supervisorRuntime,
    });
    const binding = {
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-parallel",
      laneId: "lane_1",
      taskId: task.id,
      sessionId: "session-current",
    };

    await expect(controlRuntime.observe(binding)).resolves.toMatchObject({
      status: "running",
      mode: "write",
      revision: 0,
      binding,
    });
    await expect(controlRuntime.observe({
      ...binding,
      managerAgentRunId: "run-other",
    })).rejects.toMatchObject({ code: "binding_conflict" });
    await expect(controlRuntime.observe({
      ...binding,
      sessionId: "session-stale",
    })).rejects.toMatchObject({ code: "binding_conflict" });

    await controlRuntime.dispose();
    await store.flushAndClose();
  });

  it("cancels only the exact lane and deduplicates an in-flight retry", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-control-cancel-"));
    cleanupPaths.push(stateDir);
    const store = new SubTaskRuntimeStore(stateDir);
    await store.load();
    const task = await store.createTask({
      launchSpec: {
        parentConversationId: "conversation-manager",
        agentId: "coder",
        instruction: "Implement the isolated lane.",
      },
      supervisorBinding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-parallel",
        laneId: "lane_1",
        mode: "write",
      },
    });
    await store.attachSession(task.id, "session-current", "coder", "coder");
    let releaseStop!: () => void;
    const stopReleased = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    let signalStopStarted!: () => void;
    const stopStarted = new Promise<void>((resolve) => {
      signalStopStarted = resolve;
    });
    const stoppedSessions: string[] = [];
    const cancelSubTask = createBridgeAwareStopSubTaskHandler({
      subTaskRuntimeStore: store,
      subAgentOrchestrator: {
        async stopSession(sessionId) {
          stoppedSessions.push(sessionId);
          signalStopStarted();
          await stopReleased;
          return true;
        },
      },
    });
    const controlRuntime = new SubTaskSupervisorControlRuntime({
      runtimeStore: store,
      supervisorRuntime: new SubTaskSupervisorRuntime({
        maxActiveChildren: 2,
        maxDepth: 2,
        maxWallTimeMs: 60_000,
      }),
      cancelSubTask,
    });
    const binding = {
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-parallel",
      laneId: "lane_1",
      taskId: task.id,
      sessionId: "session-current",
    };

    await expect(controlRuntime.cancel({
      binding: { ...binding, managerAgentRunId: "run-other" },
      reason: "Cancel the lane.",
      idempotencyKey: "cancel-lane-1",
    })).rejects.toMatchObject({ code: "binding_conflict" });
    const { sessionId: _cancelSessionId, ...cancelWithoutSession } = binding;
    await expect(controlRuntime.cancel({
      binding: cancelWithoutSession,
      reason: "Cancel without a current session.",
      idempotencyKey: "cancel-without-session",
    })).rejects.toMatchObject({ code: "binding_conflict" });
    const first = controlRuntime.cancel({
      binding,
      reason: "Cancel the lane.",
      idempotencyKey: "cancel-lane-1",
    });
    await stopStarted;
    const retry = controlRuntime.cancel({
      binding,
      reason: "Cancel the lane.",
      idempotencyKey: "cancel-lane-1",
    });

    await expect(retry).resolves.toMatchObject({ status: "running" });
    expect(stoppedSessions).toEqual(["session-current"]);
    releaseStop();
    await expect(first).resolves.toMatchObject({
      status: "cancelled",
      revision: 1,
      binding,
    });
    expect(stoppedSessions).toEqual(["session-current"]);

    controlRuntime.dispose();
    await store.flushAndClose();
  });

  it("steers the current session once and serializes a competing cancel", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-supervisor-control-steer-"));
    cleanupPaths.push(stateDir);
    const store = new SubTaskRuntimeStore(stateDir);
    await store.load();
    const task = await store.createTask({
      launchSpec: {
        parentConversationId: "conversation-manager",
        agentId: "coder",
        profileId: "coder",
        instruction: "Implement the isolated lane.",
      },
      supervisorBinding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-parallel",
        laneId: "lane_1",
        mode: "write",
      },
    });
    await store.attachSession(task.id, "session-current", "coder", "coder");
    let releaseSteeringStop!: () => void;
    const steeringStopReleased = new Promise<void>((resolve) => {
      releaseSteeringStop = resolve;
    });
    let signalSteeringStopStarted!: () => void;
    const steeringStopStarted = new Promise<void>((resolve) => {
      signalSteeringStopStarted = resolve;
    });
    const stoppedSessions: string[] = [];
    const spawnedInstructions: string[] = [];
    const orchestrator = {
      getSession(sessionId: string) {
        return sessionId === "session-current"
          ? {
              id: sessionId,
              status: "running" as const,
              launchSpec: {
                parentConversationId: "conversation-manager",
                agentId: "coder",
                profileId: "coder",
                instruction: "Implement the isolated lane.",
                background: true,
                timeoutMs: 60_000,
                channel: "subtask",
              },
            }
          : undefined;
      },
      async stopSession(sessionId: string) {
        stoppedSessions.push(sessionId);
        signalSteeringStopStarted();
        await steeringStopReleased;
        return true;
      },
      async spawn(options: any) {
        spawnedInstructions.push(String(options.launchSpec?.instruction));
        options.onSessionCreated?.("session-steered", "coder");
        return {
          success: true,
          output: "Steered lane completed.",
          sessionId: "session-steered",
        };
      },
    };
    const steerSubTask = createSubTaskUpdateController({
      runtimeStore: store,
      orchestrator: orchestrator as any,
      conversationStore: { get: () => ({ messages: [] }) },
    });
    const cancelSubTask = createBridgeAwareStopSubTaskHandler({
      subTaskRuntimeStore: store,
      subAgentOrchestrator: orchestrator,
    });
    const controlRuntime = new SubTaskSupervisorControlRuntime({
      runtimeStore: store,
      supervisorRuntime: new SubTaskSupervisorRuntime({
        maxActiveChildren: 2,
        maxDepth: 2,
        maxWallTimeMs: 60_000,
      }),
      cancelSubTask,
      steerSubTask,
    });
    const binding = {
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-parallel",
      laneId: "lane_1",
      taskId: task.id,
      sessionId: "session-current",
    };

    await expect(controlRuntime.steer({
      binding: { ...binding, sessionId: "session-stale" },
      message: "Prioritize the integration failure.",
      idempotencyKey: "steer-lane-1",
    })).rejects.toMatchObject({ code: "binding_conflict" });
    const { sessionId: _steerSessionId, ...steerWithoutSession } = binding;
    await expect(controlRuntime.steer({
      binding: steerWithoutSession,
      message: "Steer without a current session.",
      idempotencyKey: "steer-without-session",
    })).rejects.toMatchObject({ code: "binding_conflict" });
    const first = controlRuntime.steer({
      binding,
      message: "Prioritize the integration failure.",
      idempotencyKey: "steer-lane-1",
    });
    await steeringStopStarted;
    const retry = controlRuntime.steer({
      binding,
      message: "Prioritize the integration failure.",
      idempotencyKey: "steer-lane-1",
    });
    await expect(controlRuntime.cancel({
      binding,
      reason: "Competing cancellation.",
      idempotencyKey: "cancel-lane-1",
    })).rejects.toMatchObject({ code: "command_pending" });
    await expect(retry).resolves.toMatchObject({ status: "running" });
    expect(stoppedSessions).toEqual(["session-current"]);

    releaseSteeringStop();
    await expect(first).resolves.toMatchObject({ status: "running" });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await store.getTask(task.id))?.sessionId === "session-steered") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(spawnedInstructions).toEqual(["Prioritize the integration failure."]);
    await expect(controlRuntime.observe(binding)).rejects.toMatchObject({ code: "binding_conflict" });
    await expect(controlRuntime.observe({
      ...binding,
      sessionId: "session-steered",
    })).resolves.toMatchObject({
      status: "running",
      revision: 1,
      binding: { sessionId: "session-steered" },
    });

    controlRuntime.dispose();
    await store.flushAndClose();
  });
});
