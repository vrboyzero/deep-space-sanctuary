import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { MemoryManager, getGlobalMemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";

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

test("system.doctor exposes the bounded latest derived retrieval report", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-retrieval-doctor-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-retrieval-doctor-workspace-"));
  const manager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
    embeddingEnabled: false,
  });
  registerGlobalMemoryManager(manager);

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-derived-empty",
      method: "system.doctor",
      params: { agentId: "default" },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "system-doctor-derived-empty"));

    const emptyDoctorRes = frames.find((frame) => frame.type === "res" && frame.id === "system-doctor-derived-empty");
    expect(emptyDoctorRes?.ok).toBe(true);
    expect(emptyDoctorRes?.payload?.memoryDerivedRetrieval?.summary).toMatchObject({
      available: false,
      observedRunCount: 0,
    });
    expect(emptyDoctorRes?.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_derived_retrieval",
        status: "pass",
      }),
    ]));

    const scopedManager = getGlobalMemoryManager({ agentId: "default" });
    expect(scopedManager).toBeDefined();
    (scopedManager as any).embeddingProvider = {
      modelName: "test-derived-retrieval-doctor",
      embed: async () => [],
      embedQuery: async () => [],
      embedBatch: async (texts: string[]) => texts.map(() => []),
    };
    await scopedManager!.searchWithDiagnostics("derived retrieval doctor", { limit: 5 });

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-derived-observed",
      method: "system.doctor",
      params: { agentId: "default" },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "system-doctor-derived-observed"));

    const observedDoctorRes = frames.find((frame) => frame.type === "res" && frame.id === "system-doctor-derived-observed");
    expect(observedDoctorRes?.ok).toBe(true);
    expect(observedDoctorRes?.payload?.memoryDerivedRetrieval?.summary).toMatchObject({
      available: true,
      observedRunCount: 1,
      chainCount: 3,
    });
    expect(observedDoctorRes?.payload?.memoryDerivedRetrieval?.latestRun?.reports).toMatchObject({
      session: expect.objectContaining({
        skipReason: "unavailable",
      }),
      task: expect.objectContaining({
        admitted: true,
      }),
      experience: expect.objectContaining({
        admitted: true,
      }),
    });
    expect(JSON.stringify(observedDoctorRes?.payload?.memoryDerivedRetrieval)).not.toContain("derived retrieval doctor");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    manager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
