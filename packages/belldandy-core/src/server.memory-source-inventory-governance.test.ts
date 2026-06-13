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

test("inventory preview and system.doctor expose source family governance summaries", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-governance-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-governance-workspace-"));
  const sessionsDir = path.join(stateDir, "sessions");
  await fs.promises.mkdir(sessionsDir, { recursive: true });
  await fs.promises.writeFile(path.join(sessionsDir, "conv-1.jsonl"), "{\"role\":\"user\",\"content\":\"hello\"}\n", "utf-8");
  await fs.promises.writeFile(path.join(sessionsDir, "conv-1.digest.json"), "{\"digestGeneration\":1}\n", "utf-8");
  await fs.promises.writeFile(path.join(sessionsDir, "conv-1.session-memory.json"), "{\"currentWork\":\"governance\"}\n", "utf-8");
  await fs.promises.writeFile(path.join(stateDir, "MEMORY.md"), "# Core Memory\n", "utf-8");

  const manager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
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
      id: "inventory-preview-governance",
      method: "memory.tree.report.inventory.preview",
      params: {},
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-governance",
      method: "system.doctor",
      params: {},
    }));

    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "inventory-preview-governance"));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "system-doctor-governance"));

    const inventoryRes = frames.find((frame) => frame.type === "res" && frame.id === "inventory-preview-governance");
    const doctorRes = frames.find((frame) => frame.type === "res" && frame.id === "system-doctor-governance");

    expect(inventoryRes?.ok).toBe(true);
    expect(inventoryRes?.payload?.record).toMatchObject({
      reportType: "inventory",
      status: "ready",
      summary: expect.objectContaining({
        governance: expect.objectContaining({
          sourceFamilyCount: expect.any(Number),
          highRiskFamilyCount: expect.any(Number),
          topHighRiskFamilies: expect.arrayContaining([
            expect.objectContaining({
              sourceFamilyKey: expect.stringContaining("sessions"),
            }),
          ]),
        }),
      }),
      details: expect.objectContaining({
        governance: expect.objectContaining({
          sourceFamilyCount: expect.any(Number),
          highRiskFamilyCount: expect.any(Number),
          topHighRiskFamilies: expect.arrayContaining([
            expect.objectContaining({
              sourceFamilyKey: expect.stringContaining("sessions"),
            }),
          ]),
        }),
      }),
    });

    expect(doctorRes?.ok).toBe(true);
    expect(doctorRes?.payload?.memorySourceInventory?.summary).toMatchObject({
      sourceFamilyCount: expect.any(Number),
      highRiskFamilyCount: expect.any(Number),
      topHighRiskFamilies: expect.arrayContaining([
        expect.objectContaining({
          sourceFamilyKey: expect.stringContaining("sessions"),
        }),
      ]),
      searchPolicyExplanations: expect.arrayContaining([
        expect.objectContaining({
          searchPolicy: "searchable",
        }),
      ]),
    });
    expect(doctorRes?.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_source_inventory",
        status: "warn",
        message: expect.stringContaining("summaryInputOnly="),
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
