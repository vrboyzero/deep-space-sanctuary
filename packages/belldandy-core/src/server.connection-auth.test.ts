import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test, vi } from "vitest";
import WebSocket from "ws";

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

test("gateway rejects invalid token", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "token", token: "t" },
    webRoot: resolveWebRoot(),
    stateDir,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];

  ws.on("error", () => {});
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));
  const closeP = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf-8") }));
  });

  await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "token", token: "wrong" } }));

  const closeInfo = await closeP;
  expect(closeInfo.code).toBe(4403);

  await server.close();
  await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("gateway accepts browser same-origin websocket with explicit port", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: `http://127.0.0.1:${server.port}` });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
  await waitFor(() => frames.some((f) => f.type === "hello-ok"));

  ws.close();
  await closeP;
  await server.close();
  await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("secure methods require pairing for config raw and tools update", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    close: vi.fn(),
  };

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    logger,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
  await waitFor(() => frames.some((f) => f.type === "hello-ok"));

  ws.send(JSON.stringify({ type: "req", id: "raw-read", method: "config.readRaw", params: {} }));
  await waitFor(() => frames.some((f) => f.type === "res" && f.id === "raw-read"));
  const rawReadRes = frames.find((f) => f.type === "res" && f.id === "raw-read");
  expect(rawReadRes.ok).toBe(false);
  expect(rawReadRes.error?.code).toBe("pairing_required");

  ws.send(JSON.stringify({ type: "req", id: "raw-write", method: "config.writeRaw", params: { content: 1 } }));
  await waitFor(() => frames.some((f) => f.type === "res" && f.id === "raw-write"));
  const rawWriteRes = frames.find((f) => f.type === "res" && f.id === "raw-write");
  expect(rawWriteRes.ok).toBe(false);
  expect(rawWriteRes.error?.code).toBe("pairing_required");

  ws.send(JSON.stringify({ type: "req", id: "tools-update", method: "tools.update", params: { disabled: { builtin: [] } } }));
  await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-update"));
  const toolsUpdateRes = frames.find((f) => f.type === "res" && f.id === "tools-update");
  expect(toolsUpdateRes.ok).toBe(false);
  expect(toolsUpdateRes.error?.code).toBe("pairing_required");
  expect(logger.debug).toHaveBeenCalledWith(
    "gateway-security",
    "Secure method rejected because client is not paired",
    expect.objectContaining({
      clientId: expect.any(String),
      method: "config.readRaw",
      pairingCode: expect.any(String),
    }),
  );
  expect(logger.warn).not.toHaveBeenCalledWith(
    "gateway-security",
    "Secure method rejected because client is not paired",
    expect.anything(),
  );

  ws.close();
  await closeP;
  await server.close();
  await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("config.update rejects enabling community api when auth mode is none", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), 'BELLDANDY_AUTH_MODE="none"\n', "utf-8");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    envDir,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "config-update-community-auth-guard",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_COMMUNITY_API_ENABLED: "true",
          BELLDANDY_COMMUNITY_API_TOKEN: "community-secret",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-community-auth-guard"));

    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-community-auth-guard");
    expect(updateRes.ok).toBe(false);
    expect(updateRes.error?.code).toBe("community_api_requires_auth");

    const envLocalPath = path.join(envDir, ".env.local");
    const envLocalStat = await fs.promises.stat(envLocalPath).catch(() => null);
    if (envLocalStat?.isFile()) {
      const envLocalContent = await fs.promises.readFile(envLocalPath, "utf-8");
      expect(envLocalContent).not.toContain("BELLDANDY_COMMUNITY_API_ENABLED");
    }
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});
