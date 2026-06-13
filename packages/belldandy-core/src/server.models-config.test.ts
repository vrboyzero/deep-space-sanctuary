import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, MockAgent } from "@belldandy/agent";

import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";
import { startGatewayServer } from "./server.js";

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

test("models.list returns sanitized model list with current default model ref", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "kimi-k2.5",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    primaryModelConfig: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-primary",
      model: "gpt-5",
    },
    modelFallbacks: [
      {
        id: "kimi-k2.5",
        displayName: "Kimi K2.5",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-kimi",
        model: "kimi-k2.5",
      },
      {
        id: "claude-opus",
        displayName: "Claude Opus 4.5",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-claude",
        model: "claude-opus-4-5",
        protocol: "anthropic",
      },
    ],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
    ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
    await waitFor(() => frames.some((f) => f.type === "hello-ok"));

    const reqId = "models-list";
    ws.send(JSON.stringify({ type: "req", id: reqId, method: "models.list" }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId));

    const res = frames.find((f) => f.type === "res" && f.id === reqId);
    expect(res.ok).toBe(true);
    expect(res.payload.currentDefault).toBe("kimi-k2.5");
    expect(res.payload.preferredProviderIds).toEqual([]);
    expect(res.payload.manualEntrySupported).toBe(true);
    expect(res.payload.providers).toEqual([
      {
        id: "openai",
        label: "OpenAI",
        onboardingScopes: ["api_key", "base_url", "model"],
        capabilities: ["chat", "audio_transcription", "tts_output", "image_generation"],
      },
      {
        id: "moonshot",
        label: "Moonshot",
        onboardingScopes: ["api_key", "base_url", "model"],
        capabilities: ["chat", "image_input", "video_input"],
      },
      {
        id: "anthropic",
        label: "Anthropic",
        onboardingScopes: ["api_key", "base_url", "model"],
        capabilities: ["chat"],
      },
    ]);
    expect(res.payload.models).toEqual([
      expect.objectContaining({
        id: "primary",
        displayName: "gpt-5",
        model: "gpt-5",
        providerId: "openai",
        providerLabel: "OpenAI",
        source: "primary",
        authStatus: "ready",
        capabilities: expect.arrayContaining(["chat", "image_input", "text_inline"]),
        isDefault: false,
      }),
      expect.objectContaining({
        id: "kimi-k2.5",
        displayName: "Kimi K2.5（默认）",
        model: "kimi-k2.5",
        providerId: "moonshot",
        providerLabel: "Moonshot",
        source: "named",
        authStatus: "ready",
        capabilities: expect.arrayContaining(["chat", "image_input", "video_input", "text_inline"]),
        isDefault: true,
      }),
      expect.objectContaining({
        id: "claude-opus",
        displayName: "Claude Opus 4.5",
        model: "claude-opus-4-5",
        providerId: "anthropic",
        providerLabel: "Anthropic",
        source: "named",
        authStatus: "ready",
        protocol: "anthropic",
        capabilities: expect.arrayContaining(["chat", "anthropic_api", "image_input", "text_inline"]),
        isDefault: false,
      }),
    ]);
    expect(res.payload.models[0].apiKey).toBeUndefined();
    expect(res.payload.models[0].baseUrl).toBeUndefined();
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update persists preferred providers and refreshes models.list immediately", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    envDir,
    primaryModelConfig: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-primary",
      model: "gpt-5",
    },
    modelFallbacks: [
      {
        id: "moonshot-main",
        displayName: "Moonshot Main",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-moonshot",
        model: "kimi-k2.5",
      },
      {
        id: "anthropic-main",
        displayName: "Anthropic Main",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-anthropic",
        model: "claude-sonnet-4",
        protocol: "anthropic",
      },
    ],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "config-update-preferred-providers",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_MODEL_PREFERRED_PROVIDERS: "anthropic, moonshot, anthropic",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-preferred-providers"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-preferred-providers");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "models-list-preferred-providers", method: "models.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "models-list-preferred-providers"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "models-list-preferred-providers");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.preferredProviderIds).toEqual(["anthropic", "moonshot"]);

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_MODEL_PREFERRED_PROVIDERS="anthropic, moonshot, anthropic"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("models.config.update preserves redacted secrets and refreshes models.list immediately", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const modelsPath = path.join(stateDir, "models.json");
  const modelFallbacks = [
    {
      id: "openrouter-main",
      displayName: "OpenRouter Main",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-openrouter-old",
      model: "openai/gpt-4o-mini",
    },
  ];
  await fs.promises.writeFile(modelsPath, `${JSON.stringify({ fallbacks: modelFallbacks }, null, 2)}\n`, "utf-8");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    primaryModelConfig: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-primary",
      model: "gpt-4o",
    },
    modelFallbacks,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "models-config-get", method: "models.config.get", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "models-config-get"));
    const getRes = frames.find((f) => f.type === "res" && f.id === "models-config-get");
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.content).toContain('"apiKey": "[REDACTED]"');
    expect(getRes.payload?.content).not.toContain("sk-openrouter-old");

    ws.send(JSON.stringify({
      type: "req",
      id: "models-config-update",
      method: "models.config.update",
      params: {
        content: JSON.stringify({
          fallbacks: [
            {
              id: "openrouter-main",
              displayName: "OpenRouter Main",
              baseUrl: "https://openrouter.ai/api/v1",
              apiKey: "[REDACTED]",
              model: "openai/gpt-4.1-mini",
              protocol: "openai",
              wireApi: "responses",
            },
            {
              id: "anthropic-alt",
              displayName: "Anthropic Alt",
              baseUrl: "https://anthropic.example/v1",
              apiKey: "sk-anthropic-new",
              model: "claude-sonnet-4",
              protocol: "anthropic",
            },
          ],
        }, null, 2),
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "models-config-update"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "models-config-update");
    expect(updateRes.ok).toBe(true);
    expect(updateRes.payload?.content).toContain('"apiKey": "[REDACTED]"');
    expect(updateRes.payload?.content).not.toContain("sk-openrouter-old");
    expect(updateRes.payload?.content).not.toContain("sk-anthropic-new");

    const persisted = JSON.parse(await fs.promises.readFile(modelsPath, "utf-8"));
    expect(persisted).toEqual({
      fallbacks: [
        {
          id: "openrouter-main",
          displayName: "OpenRouter Main",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "sk-openrouter-old",
          model: "openai/gpt-4.1-mini",
          protocol: "openai",
          wireApi: "responses",
        },
        {
          id: "anthropic-alt",
          displayName: "Anthropic Alt",
          baseUrl: "https://anthropic.example/v1",
          apiKey: "sk-anthropic-new",
          model: "claude-sonnet-4",
          protocol: "anthropic",
        },
      ],
    });

    expect(modelFallbacks).toHaveLength(2);
    expect(modelFallbacks[0]?.apiKey).toBe("sk-openrouter-old");
    expect(modelFallbacks[1]?.apiKey).toBe("sk-anthropic-new");

    ws.send(JSON.stringify({ type: "req", id: "models-list-after-update", method: "models.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "models-list-after-update"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "models-list-after-update");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.models?.some((item: any) => item.id === "openrouter-main" && item.model === "openai/gpt-4.1-mini")).toBe(true);
    expect(listRes.payload?.models?.some((item: any) => item.id === "anthropic-alt" && item.model === "claude-sonnet-4")).toBe(true);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
