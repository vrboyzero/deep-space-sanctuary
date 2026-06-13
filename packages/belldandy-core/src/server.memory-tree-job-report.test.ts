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

test("server exposes memory tree job report through RPC and doctor", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-job-report-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-job-report-workspace-"));
  const manager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  (manager as any).embeddingProvider = {
    modelName: "test-memory-tree-job-report",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  registerGlobalMemoryManager(manager);

  manager.upsertMemoryChunk({
    id: "rpc-job-report-core",
    sourcePath: path.join(stateDir, "MEMORY.md"),
    sourceType: "file",
    memoryType: "other",
    agentId: "default",
    visibility: "private",
    content: "goal alpha needs a job-style phase 3 view before the full queue exists.",
  });
  const store = (manager as any).store as {
    createTask: (task: Record<string, unknown>) => void;
    linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
  };
  store.createTask({
    id: "rpc-job-report-task-1",
    conversationId: "goal:alpha:job-report",
    sessionKey: "goal:alpha:job-report",
    agentId: "default",
    source: "chat",
    status: "success",
    title: "Expose memory tree jobs report",
    summary: "Need a phase 3 job report surface.",
    startedAt: "2026-05-21T13:00:00.000Z",
    finishedAt: "2026-05-21T13:05:00.000Z",
    createdAt: "2026-05-21T13:00:00.000Z",
    updatedAt: "2026-05-21T13:05:00.000Z",
  });
  store.linkTaskMemory("rpc-job-report-task-1", "rpc-job-report-core", "generated");

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
      id: "memory-tree-job-report",
      method: "memory.tree.job.report",
      params: {},
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-job-report",
      method: "system.doctor",
      params: {},
    }));

    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "memory-tree-job-report"));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "system-doctor-job-report"));

    const reportRes = frames.find((frame) => frame.type === "res" && frame.id === "memory-tree-job-report");
    const doctorRes = frames.find((frame) => frame.type === "res" && frame.id === "system-doctor-job-report");

    expect(reportRes?.ok).toBe(true);
    expect(reportRes?.payload?.report?.summary).toMatchObject({
      visibleJobCount: 5,
      queuedCount: 5,
    });
    expect(reportRes?.payload?.report?.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobType: "source_rebuild",
        implementationStage: "runtime_managed",
      }),
      expect.objectContaining({
        jobType: "derived_materialize",
        implementationStage: "planned",
      }),
    ]));

    expect(doctorRes?.ok).toBe(true);
    expect(doctorRes?.payload?.memoryTreeJobs?.summary).toMatchObject({
      visibleJobCount: 5,
      queuedCount: 5,
    });
    expect(doctorRes?.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_tree_jobs",
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
