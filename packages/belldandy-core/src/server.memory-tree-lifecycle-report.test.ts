import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { MemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";

import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

test("server exposes lifecycle report through RPC and system.doctor", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-lifecycle-report-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-lifecycle-report-workspace-"));
  const manager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  (manager as any).embeddingProvider = {
    modelName: "test-memory-tree-lifecycle-report",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  registerGlobalMemoryManager(manager);

  manager.upsertMemoryChunk({
    id: "rpc-lifecycle-report-core",
    sourcePath: path.join(stateDir, "MEMORY.md"),
    sourceType: "file",
    memoryType: "other",
    agentId: "default",
    visibility: "private",
    content: "goal alpha still needs lifecycle report and doctor visibility.",
  });
  const store = (manager as any).store as {
    createTask: (task: Record<string, unknown>) => void;
    linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
  };
  store.createTask({
    id: "rpc-lifecycle-report-task-1",
    conversationId: "goal:alpha:doctor",
    sessionKey: "goal:alpha:doctor",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Expose lifecycle doctor view",
    summary: "Need lifecycle report and doctor visibility.",
    startedAt: "2026-05-21T12:00:00.000Z",
    finishedAt: "2026-05-21T12:10:00.000Z",
    createdAt: "2026-05-21T12:00:00.000Z",
    updatedAt: "2026-05-21T12:10:00.000Z",
  });
  store.linkTaskMemory("rpc-lifecycle-report-task-1", "rpc-lifecycle-report-core", "generated");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    additionalWorkspaceRoots: [workspaceRoot],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "memory-tree-lifecycle-report",
      method: "memory.tree.lifecycle.report",
      params: {},
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-lifecycle-report",
      method: "system.doctor",
      params: {},
    }));

    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "memory-tree-lifecycle-report"));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "system-doctor-lifecycle-report"));

    const reportRes = frames.find((frame) => frame.type === "res" && frame.id === "memory-tree-lifecycle-report");
    const doctorRes = frames.find((frame) => frame.type === "res" && frame.id === "system-doctor-lifecycle-report");

    expect(reportRes?.ok).toBe(true);
    expect(reportRes?.payload?.report?.summary).toMatchObject({
      dirtyTargetCount: 4,
      sourceDirty: true,
      nodeDirtyCount: 3,
    });
    expect(reportRes?.payload?.report?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_tree_lifecycle",
        status: "warn",
      }),
      expect.objectContaining({
        id: "memory_tree_lifecycle_source",
        status: "warn",
      }),
    ]));

    expect(doctorRes?.ok).toBe(true);
    expect(doctorRes?.payload?.memoryTreeLifecycle?.summary).toMatchObject({
      dirtyTargetCount: 4,
      sourceDirty: true,
      nodeDirtyCount: 3,
    });
    expect(doctorRes?.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_tree_lifecycle",
        status: "warn",
      }),
      expect.objectContaining({
        id: "memory_tree_lifecycle_topic",
        status: "warn",
      }),
      expect.objectContaining({
        id: "memory_tree_lifecycle_profile",
        status: "warn",
      }),
      expect.objectContaining({
        id: "memory_tree_lifecycle_global",
        status: "warn",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    manager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
