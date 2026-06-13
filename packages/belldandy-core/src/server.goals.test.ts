import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { GoalManager } from "./goals/manager.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";

// MemoryManager 内部会初始化 OpenAIEmbeddingProvider，需要 OPENAI_API_KEY
// 测试环境中设置一个占位值，避免构造函数抛错（不会实际调用 API）
beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

test("goal.handoff.get returns structured handoff snapshot without mutating goal artifacts", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seededGoalManager = new GoalManager(stateDir);
  const goal = await seededGoalManager.createGoal({
    title: "Server Handoff Goal",
    objective: "Read structured handoff snapshot",
  });
  await seededGoalManager.createTaskNode(goal.id, {
    id: "node_server_handoff",
    title: "Server-side review",
    status: "ready",
    checkpointRequired: true,
  });
  await seededGoalManager.claimTaskNode(goal.id, "node_server_handoff", {
    runId: "run_server_handoff_1",
    summary: "Server handoff started",
  });
  await seededGoalManager.requestCheckpoint(goal.id, "node_server_handoff", {
    title: "Need server review",
    summary: "Waiting for remote confirmation",
    reviewer: "reviewer",
    requestedBy: "main-agent",
    runId: "run_server_handoff_1",
  });

  const handoffBefore = await fs.promises.readFile(goal.handoffPath, "utf-8");
  const progressBefore = await fs.promises.readFile(goal.progressPath, "utf-8");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    goalManager: seededGoalManager,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-handoff-get",
      method: "goal.handoff.get",
      params: { goalId: goal.id },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-handoff-get"));
    const getRes = frames.find((f) => f.type === "res" && f.id === "goal-handoff-get");
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.handoff).toMatchObject({
      goalId: goal.id,
      resumeMode: "checkpoint",
      recommendedNodeId: "node_server_handoff",
      checkpointReplay: {
        checkpointId: expect.any(String),
        nodeId: "node_server_handoff",
        title: "Need server review",
      },
      openCheckpoints: [
        expect.objectContaining({
          nodeId: "node_server_handoff",
          title: "Need server review",
        }),
      ],
    });
    expect(getRes.payload?.continuationState).toMatchObject({
      version: 1,
      scope: "goal",
      targetId: goal.id,
      recommendedTargetId: "node_server_handoff",
      targetType: "node",
      resumeMode: "checkpoint",
      replay: {
        kind: "goal_checkpoint",
        checkpointId: expect.any(String),
        nodeId: "node_server_handoff",
      },
      checkpoints: {
        openCount: 1,
      },
    });

    const handoffAfter = await fs.promises.readFile(goal.handoffPath, "utf-8");
    const progressAfter = await fs.promises.readFile(goal.progressPath, "utf-8");
    expect(handoffAfter).toBe(handoffBefore);
    expect(progressAfter).toBe(progressBefore);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("goal.resume accepts checkpoint replay metadata and records replay progress", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seededGoalManager = new GoalManager(stateDir);
  const goal = await seededGoalManager.createGoal({
    title: "Server Replay Goal",
    objective: "Resume from checkpoint replay",
  });
  await seededGoalManager.createTaskNode(goal.id, {
    id: "node_server_replay",
    title: "Replay node",
    status: "ready",
    checkpointRequired: true,
  });
  await seededGoalManager.claimTaskNode(goal.id, "node_server_replay", {
    runId: "run_server_replay_1",
    summary: "Replay node setup",
  });
  await seededGoalManager.requestCheckpoint(goal.id, "node_server_replay", {
    title: "Need replay approval",
    summary: "Resume should target the replay node",
    reviewer: "reviewer",
    requestedBy: "main-agent",
    runId: "run_server_replay_1",
  });
  const handoff = await seededGoalManager.getHandoff(goal.id);

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    goalManager: seededGoalManager,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-resume-replay",
      method: "goal.resume",
      params: {
        goalId: goal.id,
        nodeId: "node_server_replay",
        checkpointId: handoff.handoff.checkpointReplay?.checkpointId,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-resume-replay"));
    const resumeRes = frames.find((f) => f.type === "res" && f.id === "goal-resume-replay");
    expect(resumeRes.ok).toBe(true);
    expect(resumeRes.payload?.goal).toMatchObject({
      id: goal.id,
      activeNodeId: "node_server_replay",
      status: "executing",
    });
    expect(String(resumeRes.payload?.conversationId || "")).toContain(`goal:${goal.id}:node:node_server_replay:run:`);

    const progress = await fs.promises.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("checkpoint_replay_started");
    expect(progress).toContain(`Checkpoint: ${handoff.handoff.checkpointReplay?.checkpointId}`);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("goal.archive hides archived goals from the default list and exposes them when includeArchived=true", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seededGoalManager = new GoalManager(stateDir);
  const goal = await seededGoalManager.createGoal({
    title: "Server Archive Goal",
    objective: "Archive through gateway methods",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    goalManager: seededGoalManager,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-archive",
      method: "goal.archive",
      params: {
        goalId: goal.id,
        reason: "Archived from WebSocket test",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-archive"));
    const archiveRes = frames.find((f) => f.type === "res" && f.id === "goal-archive");
    expect(archiveRes.ok).toBe(true);
    expect(archiveRes.payload?.goal).toMatchObject({
      id: goal.id,
      status: "archived",
      archiveReason: "Archived from WebSocket test",
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-list-default",
      method: "goal.list",
      params: {},
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-list-default"));
    const defaultListRes = frames.find((f) => f.type === "res" && f.id === "goal-list-default");
    expect(defaultListRes.ok).toBe(true);
    expect(defaultListRes.payload?.goals).toEqual([]);

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-list-archived",
      method: "goal.list",
      params: {
        includeArchived: true,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-list-archived"));
    const archivedListRes = frames.find((f) => f.type === "res" && f.id === "goal-list-archived");
    expect(archivedListRes.ok).toBe(true);
    expect(archivedListRes.payload?.goals).toEqual([
      expect.objectContaining({
        id: goal.id,
        status: "archived",
        archiveReason: "Archived from WebSocket test",
      }),
    ]);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("goal.delete removes an archived goal through gateway methods", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const seededGoalManager = new GoalManager(stateDir);
  const goal = await seededGoalManager.createGoal({
    title: "Server Delete Goal",
    objective: "Delete through gateway methods",
  });
  await seededGoalManager.archiveGoal(goal.id, {
    reason: "Archived before delete",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    goalManager: seededGoalManager,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-delete",
      method: "goal.delete",
      params: {
        goalId: goal.id,
        confirmText: goal.id,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-delete"));
    const deleteRes = frames.find((f) => f.type === "res" && f.id === "goal-delete");
    expect(deleteRes.ok).toBe(true);
    expect(deleteRes.payload).toMatchObject({
      goalId: goal.id,
      goal: {
        id: goal.id,
        status: "archived",
      },
      cleanupWarnings: [],
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-list-after-delete",
      method: "goal.list",
      params: {
        includeArchived: true,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-list-after-delete"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "goal-list-after-delete");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.goals).toEqual([]);

    ws.send(JSON.stringify({
      type: "req",
      id: "goal-get-after-delete",
      method: "goal.get",
      params: {
        goalId: goal.id,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "goal-get-after-delete"));
    const getRes = frames.find((f) => f.type === "res" && f.id === "goal-get-after-delete");
    expect(getRes.ok).toBe(false);
    expect(getRes.error?.code).toBe("not_found");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
