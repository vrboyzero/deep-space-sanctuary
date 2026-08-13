import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";
import WebSocket from "ws";

import { startGatewayServer } from "./server.js";
import { pairWebSocketClient, resolveWebRoot, waitFor } from "./server-testkit.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";

test("task.projection.list exposes an exact-bound verifier failure without private verifier details", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-verifier-projection-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();
  const task = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conversation-goal-verifier",
      agentId: "qa",
      role: "verifier",
      instruction: "private verifier instruction must not enter the task projection",
      cwd: path.join(stateDir, "private-verifier-workspace"),
    },
  });
  await subTaskRuntimeStore.attachSession(task.id, "verifier-run-failed", "qa", "qa");
  await subTaskRuntimeStore.completeTask(task.id, {
    status: "error",
    sessionId: "verifier-run-failed",
    output: "private verifier output must not enter the task projection",
    error: "private verifier error must not enter the task projection",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
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
      id: "task-projection-verifier-failure",
      method: "task.projection.list",
      params: {},
    }));
    await waitFor(() => frames.some((frame) => (
      frame.type === "res" && frame.id === "task-projection-verifier-failure"
    )));

    const response = frames.find((frame) => (
      frame.type === "res" && frame.id === "task-projection-verifier-failure"
    ));
    expect(response).toMatchObject({
      ok: true,
      payload: {
        totalCount: 1,
        items: [{
          taskId: `subtask:${task.id}`,
          status: "failed",
          owner: {
            source: "subtask",
            binding: {
              agentRunId: "verifier-run-failed",
              conversationId: "conversation-goal-verifier",
              subtask: { taskId: task.id },
            },
          },
          evidence: {
            reasonCategory: "owner_failure",
            reasonCode: "owner_reported_failure",
          },
          allowedActions: ["observe", "retry"],
        }],
      },
    });
    expect(JSON.stringify(response)).not.toMatch(
      /private verifier instruction|private verifier output|private verifier error|private-verifier-workspace/,
    );
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
