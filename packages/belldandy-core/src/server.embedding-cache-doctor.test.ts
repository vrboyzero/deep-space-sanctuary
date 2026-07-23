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

test("system.doctor exposes anonymous persistent embedding cache retention", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-embedding-cache-doctor-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-embedding-cache-doctor-workspace-"));
  const manager = new MemoryManager({
    workspaceRoot,
    stateDir,
    embeddingEnabled: false,
  });
  const store = (manager as any).store;
  store.cacheEmbedding("private-embedding-cache-hash", [0.25, 0.75], "doctor-test-model");
  store.getDbHandleForSharedSchema()
    .prepare("UPDATE embedding_cache SET created_at = ? WHERE content_hash = ?")
    .run("2020-01-01T00:00:00.000Z", "private-embedding-cache-hash");
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
      id: "system-doctor-embedding-cache",
      method: "system.doctor",
      params: { agentId: "default" },
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "system-doctor-embedding-cache"));

    const doctorRes = frames.find((frame) => frame.type === "res" && frame.id === "system-doctor-embedding-cache");
    expect(doctorRes?.ok).toBe(true);
    expect(doctorRes?.payload?.memoryEmbeddingCache?.summary).toMatchObject({
      entryCount: 1,
      totalBytes: 8,
      retention: {
        maxAgeMs: 30 * 24 * 60 * 60 * 1000,
        maxEntries: 10_000,
        maxBytes: 64 * 1024 * 1024,
      },
    });
    expect(doctorRes?.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_embedding_cache",
        status: "warn",
      }),
    ]));
    const serialized = JSON.stringify(doctorRes?.payload?.memoryEmbeddingCache);
    expect(serialized).not.toContain("private-embedding-cache-hash");
    expect(serialized).not.toContain("doctor-test-model");
    expect(serialized).not.toContain("2020-01-01T00:00:00.000Z");
    expect(serialized).not.toContain("0.25");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    manager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
