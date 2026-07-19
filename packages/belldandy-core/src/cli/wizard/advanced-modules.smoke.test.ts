import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const promptState = vi.hoisted(() => ({
  responses: [] as Array<string | boolean>,
  notes: [] as Array<{ title?: string; message: string }>,
}));

const gatewayRuntimeState = vi.hoisted(() => ({
  mode: "offline" as "offline" | "success",
  runNowResponse: {
    status: "ok" as "ok" | "error" | "skipped",
    runId: "cron-run-immediate",
    summary: "ran immediately",
    reason: undefined as string | undefined,
  },
  recoveryResponse: {
    outcome: "succeeded" as "succeeded" | "failed" | "throttled" | "skipped_not_eligible",
    sourceRunId: "cron-run-failed",
    recoveryRunId: "cron-run-recovered",
    reason: "recovered",
  },
  backgroundContinuationRecentEntries: [] as Array<Record<string, unknown>>,
  lastRequest: null as Record<string, unknown> | null,
  requests: [] as Array<Record<string, unknown>>,
}));

const gatewayRuntimeReachabilityMock = vi.hoisted(() => vi.fn());
const legacyFetchMock = vi.hoisted(() => vi.fn());

function nextPromptResponse(): string | boolean {
  if (promptState.responses.length === 0) {
    throw new Error("Missing mocked prompt response");
  }
  return promptState.responses.shift()!;
}

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(async () => nextPromptResponse()),
  select: vi.fn(async () => nextPromptResponse()),
  text: vi.fn(async () => nextPromptResponse()),
  password: vi.fn(async () => nextPromptResponse()),
  note: vi.fn((message: string, title?: string) => {
    promptState.notes.push({ message, title });
  }),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("ws", () => {
  class MockWebSocket {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(_url: string, _options?: Record<string, unknown>) {
      setTimeout(() => {
        this.emit("message", Buffer.from(JSON.stringify({
          type: "connect.challenge",
          nonce: "mock-nonce",
        })));
      }, 0);
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
      return this;
    }

    once(event: string, listener: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        this.off(event, wrapped);
        listener(...args);
      };
      return this.on(event, wrapped);
    }

    off(event: string, listener: (...args: unknown[]) => void) {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(event, current.filter((item) => item !== listener));
      return this;
    }

    private emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }

    send(raw: string) {
      const frame = JSON.parse(raw) as Record<string, unknown>;
      if (frame.type === "connect") {
        setTimeout(() => {
          this.emit("message", Buffer.from(JSON.stringify({
            type: "hello-ok",
            sessionId: "mock-session",
            role: "cli",
            methods: ["cron.run_now", "cron.recovery.run", "system.doctor"],
            events: ["pairing.required"],
          })));
        }, 0);
        return;
      }
      if (frame.type === "req" && frame.method === "cron.run_now") {
        gatewayRuntimeState.lastRequest = frame;
        gatewayRuntimeState.requests.push(frame);
        setTimeout(() => {
          this.emit("message", Buffer.from(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: gatewayRuntimeState.runNowResponse,
          })));
        }, 0);
        return;
      }
      if (frame.type === "req" && frame.method === "cron.recovery.run") {
        gatewayRuntimeState.lastRequest = frame;
        gatewayRuntimeState.requests.push(frame);
        setTimeout(() => {
          this.emit("message", Buffer.from(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: gatewayRuntimeState.recoveryResponse,
          })));
        }, 0);
        return;
      }
      if (frame.type === "req" && frame.method === "system.doctor") {
        gatewayRuntimeState.lastRequest = frame;
        gatewayRuntimeState.requests.push(frame);
        setTimeout(() => {
          this.emit("message", Buffer.from(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: {
              backgroundContinuationRuntime: {
                recentEntries: gatewayRuntimeState.backgroundContinuationRecentEntries,
              },
            },
          })));
        }, 0);
      }
    }

    close() {
      setTimeout(() => {
        this.emit("close");
      }, 0);
    }
  }

  return {
    default: MockWebSocket,
  };
});

vi.mock("./gateway-runtime-reachability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gateway-runtime-reachability.js")>();
  return {
    ...actual,
    checkGatewayRuntimeReachability: gatewayRuntimeReachabilityMock,
  };
});

import { runAdvancedModulesWizard } from "./advanced-modules.js";
import { resolveGatewayBaseUrl } from "./gateway-runtime-reachability.js";

const tempRoots: string[] = [];

async function createTempSetup(): Promise<{
  rootDir: string;
  envDir: string;
  stateDir: string;
  envPath: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "advanced-modules-smoke-"));
  const envDir = path.join(rootDir, "env");
  const stateDir = path.join(rootDir, "state");
  const envPath = path.join(envDir, ".env.local");
  await fs.mkdir(envDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(envPath, "", "utf-8");
  tempRoots.push(rootDir);
  return { rootDir, envDir, stateDir, envPath };
}

describe("advanced-modules interaction smoke", () => {
  beforeEach(() => {
    promptState.responses = [];
    promptState.notes = [];
    gatewayRuntimeState.mode = "offline";
    gatewayRuntimeState.runNowResponse = {
      status: "ok",
      runId: "cron-run-immediate",
      summary: "ran immediately",
      reason: undefined,
    };
    gatewayRuntimeState.recoveryResponse = {
      outcome: "succeeded",
      sourceRunId: "cron-run-failed",
      recoveryRunId: "cron-run-recovered",
      reason: "recovered",
    };
    gatewayRuntimeState.backgroundContinuationRecentEntries = [];
    gatewayRuntimeState.lastRequest = null;
    gatewayRuntimeState.requests = [];
    gatewayRuntimeReachabilityMock.mockReset();
    gatewayRuntimeReachabilityMock.mockImplementation(async (envValues: ReadonlyMap<string, string>) => ({
      reachable: gatewayRuntimeState.mode === "success",
      healthUrl: `${resolveGatewayBaseUrl(envValues).replace(/\/+$/, "")}/health`,
    }));
    legacyFetchMock.mockReset();
    legacyFetchMock.mockRejectedValue(new Error("legacy fetch must not run"));
    vi.stubGlobal("fetch", legacyFetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    while (tempRoots.length > 0) {
      const rootDir = tempRoots.pop();
      if (rootDir) {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    }
  });

  test("community configure updates reconnect and office fields", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "community.json"), `${JSON.stringify({
      endpoint: "https://office.goddess.ai",
      agents: [{
        name: "default",
        apiKey: "community-secret",
      }],
      reconnect: {
        enabled: true,
        maxRetries: 10,
        backoffMs: 5000,
      },
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "https://office.goddess.ai",
      true,
      "5",
      "2500",
      "upsert",
      "default",
      "default",
      true,
      "ops-room",
      "",
      "downloads",
      "docs, assets",
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["community"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "community.json"), "utf-8")) as {
      reconnect?: { enabled?: boolean; maxRetries?: number; backoffMs?: number };
      agents: Array<{ office?: { downloadDir?: string; uploadRoots?: string[] }; room?: { name?: string } }>;
    };

    expect(result.configuredModules).toEqual(["community"]);
    expect(savedConfig.reconnect).toEqual({
      enabled: true,
      maxRetries: 5,
      backoffMs: 2500,
    });
    expect(savedConfig.agents).toHaveLength(1);
    expect(savedConfig.agents[0]?.room?.name).toBe("ops-room");
    expect(savedConfig.agents[0]?.office).toEqual({
      downloadDir: "downloads",
      uploadRoots: ["docs", "assets"],
    });
  });

  test("community configure records risk note when reusing gateway auth for API", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_AUTH_TOKEN=gateway-shared-token",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "community.json"), `${JSON.stringify({
      endpoint: "https://office.goddess.ai",
      agents: [],
      reconnect: {
        enabled: true,
        maxRetries: 10,
        backoffMs: 5000,
      },
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "https://office.goddess.ai",
      true,
      "10",
      "5000",
      false,
      true,
      false,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "token",
      modules: ["community"],
    });

    expect(result.configuredModules).toEqual(["community"]);
    const riskNote = promptState.notes.find((item) => item.title === "Community API risk");
    expect(riskNote).toBeDefined();
    expect(riskNote?.message).toContain("reusing the gateway auth token");
    expect(riskNote?.message).toContain("one token can call both gateway and community routes");
  });

  test("community diagnostics summarizes API and auth risks before editing", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_COMMUNITY_API_ENABLED=true",
      "BELLDANDY_HOST=0.0.0.0",
      "BELLDANDY_AUTH_TOKEN=gateway-token",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "community.json"), `${JSON.stringify({
      endpoint: "http://community.example.com",
      agents: [
        {
          name: "alpha",
          apiKey: "community-alpha",
          room: { name: "shared-room" },
          office: { downloadDir: "downloads" },
        },
        {
          name: "bravo",
          apiKey: "community-bravo",
          room: { name: "shared-room" },
          office: { uploadRoots: ["docs"] },
        },
        {
          name: "charlie",
          apiKey: "community-charlie",
        },
      ],
      reconnect: {
        enabled: true,
        maxRetries: 0,
        backoffMs: 750,
      },
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(false);

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "token",
      modules: ["community"],
    });

    const diagnostics = promptState.notes.find((item) => item.title === "Community diagnostics");

    expect(result.configuredModules).toEqual([]);
    expect(diagnostics).toBeDefined();
    expect(diagnostics?.message).toContain("reachable beyond localhost");
    expect(diagnostics?.message).toContain("plain HTTP");
    expect(diagnostics?.message).toContain("reusing the gateway auth token");
    expect(diagnostics?.message).toContain("Reconnect max retries is 0");
    expect(diagnostics?.message).toContain("Reconnect backoff is 750ms");
    expect(diagnostics?.message).toContain("have no room configured: charlie");
    expect(diagnostics?.message).toContain("have office downloadDir but no uploadRoots: alpha");
    expect(diagnostics?.message).toContain("have office uploadRoots but no downloadDir: bravo");
    expect(diagnostics?.message).toContain("Multiple agents target the same room: shared-room");
  });

  test("community organize can remove multiple agents", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "community.json"), `${JSON.stringify({
      endpoint: "https://office.goddess.ai",
      agents: [
        {
          name: "alpha",
          apiKey: "community-alpha",
          room: { name: "room-a" },
        },
        {
          name: "bravo",
          apiKey: "community-bravo",
          office: { downloadDir: "downloads" },
        },
        {
          name: "charlie",
          apiKey: "community-charlie",
        },
      ],
      reconnect: {
        enabled: true,
        maxRetries: 10,
        backoffMs: 5000,
      },
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "https://office.goddess.ai",
      true,
      "10",
      "5000",
      "organize",
      "remove_multiple",
      "alpha",
      true,
      "charlie",
      false,
      true,
      false,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["community"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "community.json"), "utf-8")) as {
      agents: Array<{ name: string }>;
    };

    expect(result.configuredModules).toEqual(["community"]);
    expect(savedConfig.agents).toEqual([
      expect.objectContaining({ name: "bravo" }),
    ]);
  });

  test("community organize can batch edit room for multiple agents", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "community.json"), `${JSON.stringify({
      endpoint: "https://office.goddess.ai",
      agents: [
        {
          name: "alpha",
          apiKey: "community-alpha",
        },
        {
          name: "bravo",
          apiKey: "community-bravo",
          room: { name: "old-room" },
        },
      ],
      reconnect: {
        enabled: true,
        maxRetries: 10,
        backoffMs: 5000,
      },
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "https://office.goddess.ai",
      true,
      "10",
      "5000",
      "organize",
      "edit_room_multiple",
      "alpha",
      true,
      "bravo",
      false,
      "shared-room",
      "shared-secret",
      true,
      false,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["community"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "community.json"), "utf-8")) as {
      agents: Array<{ name: string; room?: { name: string; password?: string } }>;
    };

    expect(result.configuredModules).toEqual(["community"]);
    expect(savedConfig.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "alpha", room: { name: "shared-room", password: "shared-secret" } }),
      expect.objectContaining({ name: "bravo", room: { name: "shared-room", password: "shared-secret" } }),
    ]));
  });

  test("community organize can batch clear office for multiple agents", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "community.json"), `${JSON.stringify({
      endpoint: "https://office.goddess.ai",
      agents: [
        {
          name: "alpha",
          apiKey: "community-alpha",
          office: { downloadDir: "downloads", uploadRoots: ["docs"] },
        },
        {
          name: "bravo",
          apiKey: "community-bravo",
          office: { downloadDir: "downloads-2", uploadRoots: ["assets"] },
        },
      ],
      reconnect: {
        enabled: true,
        maxRetries: 10,
        backoffMs: 5000,
      },
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "https://office.goddess.ai",
      true,
      "10",
      "5000",
      "organize",
      "edit_office_multiple",
      "alpha",
      true,
      "bravo",
      false,
      "",
      "",
      true,
      false,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["community"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "community.json"), "utf-8")) as {
      agents: Array<{ name: string; office?: { downloadDir?: string; uploadRoots?: string[] } }>;
    };

    expect(result.configuredModules).toEqual(["community"]);
    expect(savedConfig.agents.map((agent) => agent.name)).toEqual(["alpha", "bravo"]);
    expect(savedConfig.agents.every((agent) => agent.office == null)).toBe(true);
  });

  test("models organize can batch edit advanced fields", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "models.json"), `${JSON.stringify({
      fallbacks: [
        {
          id: "alpha",
          displayName: "Anthropic Alpha",
          baseUrl: "https://api.anthropic.com",
          apiKey: "sk-alpha",
          model: "claude-sonnet-4",
          protocol: "anthropic",
          wireApi: "chat_completions",
          requestTimeoutMs: 30000,
          maxRetries: 1,
          retryBackoffMs: 1500,
          proxyUrl: "https://proxy.internal",
        },
        {
          id: "bravo",
          displayName: "OpenAI Bravo",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-bravo",
          model: "gpt-4o",
          wireApi: "responses",
          maxRetries: 0,
          retryBackoffMs: 2500,
          proxyUrl: "https://proxy.bravo.internal",
        },
        {
          id: "charlie",
          displayName: "Moonshot Charlie",
          baseUrl: "https://api.moonshot.cn/v1",
          apiKey: "sk-charlie",
          model: "kimi-k2.5",
          protocol: "openai",
          requestTimeoutMs: 45000,
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "organize",
      "edit_advanced_multiple",
      "alpha",
      true,
      "bravo",
      false,
      "openai",
      "__clear__",
      "set",
      "90000",
      "set",
      "3",
      "keep",
      "clear",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["models"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "models.json"), "utf-8")) as {
      fallbacks: Array<{
        id: string;
        protocol?: string;
        wireApi?: string;
        requestTimeoutMs?: number;
        maxRetries?: number;
        retryBackoffMs?: number;
        proxyUrl?: string;
      }>;
    };

    expect(result.configuredModules).toEqual(["models"]);
    expect(result.notes).toContain("Updated advanced fields for 2 fallback(s): alpha, bravo");
    expect(result.notes).toContain("Advanced fields: protocol=openai; wireApi=clear; requestTimeoutMs=90000ms; maxRetries=3; proxyUrl=clear");
    expect(savedConfig.fallbacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "alpha",
        protocol: "openai",
        requestTimeoutMs: 90000,
        maxRetries: 3,
        retryBackoffMs: 1500,
      }),
      expect.objectContaining({
        id: "bravo",
        protocol: "openai",
        requestTimeoutMs: 90000,
        maxRetries: 3,
        retryBackoffMs: 2500,
      }),
      expect.objectContaining({
        id: "charlie",
        protocol: "openai",
        requestTimeoutMs: 45000,
      }),
    ]));
    expect(savedConfig.fallbacks.find((item) => item.id === "alpha")?.wireApi).toBeUndefined();
    expect(savedConfig.fallbacks.find((item) => item.id === "alpha")?.proxyUrl).toBeUndefined();
    expect(savedConfig.fallbacks.find((item) => item.id === "bravo")?.wireApi).toBeUndefined();
    expect(savedConfig.fallbacks.find((item) => item.id === "bravo")?.proxyUrl).toBeUndefined();
    expect(savedConfig.fallbacks.find((item) => item.id === "charlie")?.wireApi).toBeUndefined();
    expect(savedConfig.fallbacks.find((item) => item.id === "charlie")?.proxyUrl).toBeUndefined();
  });

  test("models can update preferred provider order lightly", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_MODEL_PREFERRED_PROVIDERS=openai, anthropic",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "models.json"), `${JSON.stringify({
      fallbacks: [
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
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "preferred_providers",
      "anthropic, moonshot, anthropic, custom",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["models"],
    });

    const envContent = await fs.readFile(envPath, "utf-8");
    const previewNote = promptState.notes.find((item) => item.title === "Preferred providers preview");

    expect(result.configuredModules).toEqual(["models"]);
    expect(result.notes).toContain("Preferred providers updated: anthropic, moonshot, custom");
    expect(previewNote?.message).toContain("Current preferred provider order: openai, anthropic.");
    expect(previewNote?.message).toContain("Next effective provider order: anthropic, moonshot, custom.");
    expect(previewNote?.message).toContain("Matched current fallback buckets: anthropic, moonshot.");
    expect(previewNote?.message).toContain("Not currently visible from fallback buckets: custom.");
    expect(envContent).toContain('BELLDANDY_MODEL_PREFERRED_PROVIDERS="anthropic, moonshot, anthropic, custom"');
  });

  test("webhook configure edits promptTemplate and renames existing rule", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "webhooks.json"), `${JSON.stringify({
      version: 1,
      webhooks: [{
        id: "audit",
        enabled: true,
        token: "webhook-secret",
        defaultAgentId: "default",
      }],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "upsert",
      "audit",
      "audit-v2",
      true,
      true,
      "default",
      "webhook:ops",
      "{{event}} {{user.name}} {{status}}",
      "{\"event\":\"deploy\"}",
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "webhooks.json"), "utf-8")) as {
      webhooks: Array<{ id: string; promptTemplate?: string; conversationIdPrefix?: string }>;
    };
    const payloadSchemaNote = promptState.notes.find((item) => item.title === "Webhook payload schema");
    const requestPreviewNote = promptState.notes.find((item) => item.title === "Webhook request preview");

    expect(result.configuredModules).toEqual(["webhook"]);
    expect(promptState.notes.some((item) => item.title === "Webhook template preview")).toBe(true);
    expect(promptState.notes.some((item) => item.title === "Webhook payload schema")).toBe(true);
    expect(promptState.notes.some((item) => item.title === "Webhook request preview")).toBe(true);
    expect(promptState.notes.some((item) => item.title === "Webhook template field source")).toBe(true);
    expect(promptState.notes.some((item) => item.title === "Webhook template field support")).toBe(true);
    expect(promptState.notes.some((item) => item.title === "Webhook preview missing fields")).toBe(true);
    expect(promptState.notes.some((item) => item.title === "Webhook template warning")).toBe(true);
    expect(payloadSchemaNote?.message).toContain("- event: string (\"deploy\")");
    expect(requestPreviewNote?.message).toContain("Template coverage: resolved 1/2 top-level placeholders");
    expect(requestPreviewNote?.message).toContain("Request body preview: {\"payload\":{\"event\":\"deploy\"}}");
    expect(savedConfig.webhooks).toEqual([{
      id: "audit-v2",
      enabled: true,
      token: "webhook-secret",
      defaultAgentId: "default",
      conversationIdPrefix: "webhook:ops",
      promptTemplate: "{{event}} {{user.name}} {{status}}",
    }]);
  });

  test("webhook configure supports multi-sample preview comparison", async () => {
    const { envPath, stateDir } = await createTempSetup();

    promptState.responses.push(
      true,
      "audit",
      true,
      "webhook-secret",
      "default",
      "",
      "{{event}} {{status}}",
      "[{\"event\":\"deploy\",\"status\":\"ok\"},{\"event\":\"deploy\",\"user\":{\"name\":\"ops\"}}]",
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const payloadSchemaNote = promptState.notes.find((item) => item.title === "Webhook payload schema");
    const requestPreviewNote = promptState.notes.find((item) => item.title === "Webhook request preview");
    const missingFieldsNote = promptState.notes.find((item) => item.title === "Webhook preview missing fields");

    expect(result.configuredModules).toEqual(["webhook"]);
    expect(payloadSchemaNote?.message).toContain("Compared payload samples: 2");
    expect(payloadSchemaNote?.message).toContain("Sample 2 schema highlights: event=string (\"deploy\"); user=object{name}; user.name=string (\"ops\")");
    expect(requestPreviewNote?.message).toContain("Compared request samples: 2");
    expect(requestPreviewNote?.message).toContain("Sample 2 Missing top-level fields for template: status");
    expect(missingFieldsNote?.message).toContain("Sample 2: missing top-level keys status");
  });

  test("webhook organize can filter custom-template rules before batch disable", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "webhooks.json"), `${JSON.stringify({
      version: 1,
      webhooks: [
        {
          id: "audit",
          enabled: true,
          token: "token-a",
          defaultAgentId: "default",
        },
        {
          id: "ops",
          enabled: true,
          token: "token-b",
          defaultAgentId: "default",
          promptTemplate: "{{event}} {{status}}",
        },
        {
          id: "release",
          enabled: true,
          token: "token-c",
          defaultAgentId: "default",
          promptTemplate: "{{release}}",
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "organize",
      "disable_multiple",
      "filter",
      "custom_template",
      "apply_all_matched",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "webhooks.json"), "utf-8")) as {
      webhooks: Array<{ id: string; enabled: boolean }>;
    };
    const filterNote = promptState.notes.find((item) => item.title === "Webhook organize filter");

    expect(result.configuredModules).toEqual(["webhook"]);
    expect(filterNote?.message).toContain("webhooks with custom templates");
    expect(savedConfig.webhooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "audit", enabled: true }),
      expect.objectContaining({ id: "ops", enabled: false }),
      expect.objectContaining({ id: "release", enabled: false }),
    ]));
  });

  test("webhook organize preset can remove disabled JSON fallback rules", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "webhooks.json"), `${JSON.stringify({
      version: 1,
      webhooks: [
        {
          id: "audit",
          enabled: true,
          token: "token-a",
          defaultAgentId: "default",
        },
        {
          id: "ops",
          enabled: false,
          token: "token-b",
          defaultAgentId: "default",
        },
        {
          id: "release",
          enabled: false,
          token: "token-c",
          defaultAgentId: "default",
          promptTemplate: "{{release}}",
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "organize",
      "preset_strategy",
      "remove_disabled_default_template_rules",
      "apply_all_matched",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "webhooks.json"), "utf-8")) as {
      webhooks: Array<{ id: string; enabled: boolean }>;
    };
    const presetNote = promptState.notes.find((item) => item.title === "Webhook organize preset");
    const previewNote = promptState.notes.find((item) => item.title === "Webhook organize preview");

    expect(result.configuredModules).toEqual(["webhook"]);
    expect(presetNote?.message).toContain("Remove disabled JSON fallback webhooks");
    expect(previewNote?.message).toContain("Would remove 1 webhook(s) from webhooks.json.");
    expect(savedConfig.webhooks.map((rule) => rule.id)).toEqual(["audit", "release"]);
  });

  test("webhook organize can save matched rules as reusable selection and reuse them", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "webhooks.json"), `${JSON.stringify({
      version: 1,
      webhooks: [
        {
          id: "audit",
          enabled: true,
          token: "token-a",
          defaultAgentId: "default",
        },
        {
          id: "ops",
          enabled: true,
          token: "token-b",
          defaultAgentId: "default",
          promptTemplate: "{{event}}",
        },
        {
          id: "release",
          enabled: true,
          token: "token-c",
          defaultAgentId: "default",
          promptTemplate: "{{user.name}}",
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "organize",
      "disable_multiple",
      "filter",
      "custom_template",
      "save_as_selection",
    );

    const firstResult = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedSelectionState = JSON.parse(await fs.readFile(path.join(stateDir, "webhook-organize-state.json"), "utf-8")) as {
      lastSelection?: { label: string; webhookIds: string[] };
      lastPreview?: { action: string; webhookIds: string[] };
    };
    const savedSelectionNote = promptState.notes.find((item) => item.title === "Webhook saved selection");

    expect(firstResult.configuredModules).toEqual(["webhook"]);
    expect(savedSelectionNote?.message).toContain("Saved 2 matched webhook(s) as reusable selection");
    expect(savedSelectionState.lastSelection).toEqual(expect.objectContaining({
      label: "Filter webhooks with custom templates",
      webhookIds: ["ops", "release"],
    }));
    expect(savedSelectionState.lastPreview).toEqual(expect.objectContaining({
      action: "disable_multiple",
      webhookIds: ["ops", "release"],
    }));

    promptState.responses = [
      true,
      "organize",
      "disable_multiple",
      "reuse_last_selection",
      "apply_all_matched",
      true,
    ];
    promptState.notes = [];

    const secondResult = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "webhooks.json"), "utf-8")) as {
      webhooks: Array<{ id: string; enabled: boolean }>;
    };
    const reuseNote = promptState.notes.find((item) => item.title === "Webhook reuse selection");

    expect(secondResult.configuredModules).toEqual(["webhook"]);
    expect(reuseNote?.message).toContain("Reusing last selected webhooks");
    expect(savedConfig.webhooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "audit", enabled: true }),
      expect.objectContaining({ id: "ops", enabled: false }),
      expect.objectContaining({ id: "release", enabled: false }),
    ]));
  });

  test("webhook organize can reuse last preview result", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "webhooks.json"), `${JSON.stringify({
      version: 1,
      webhooks: [
        {
          id: "audit",
          enabled: true,
          token: "token-a",
          defaultAgentId: "default",
        },
        {
          id: "ops",
          enabled: false,
          token: "token-b",
          defaultAgentId: "default",
          promptTemplate: "{{event}}",
        },
        {
          id: "release",
          enabled: true,
          token: "token-c",
          defaultAgentId: "default",
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "organize",
      "disable_multiple",
      "filter",
      "enabled",
      "save_as_selection",
    );

    await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    promptState.responses = [
      true,
      "organize",
      "reuse_preview_result",
      "apply_all_matched",
      true,
    ];
    promptState.notes = [];

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "webhooks.json"), "utf-8")) as {
      webhooks: Array<{ id: string; enabled: boolean }>;
    };
    const reusePreviewNote = promptState.notes.find((item) => item.title === "Webhook reuse preview");

    expect(result.configuredModules).toEqual(["webhook"]);
    expect(reusePreviewNote?.message).toContain("Reusing last preview result");
    expect(savedConfig.webhooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "audit", enabled: false }),
      expect.objectContaining({ id: "ops", enabled: false }),
      expect.objectContaining({ id: "release", enabled: false }),
    ]));
  });

  test("webhook organize can save, apply, and remove a custom strategy", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(path.join(stateDir, "webhooks.json"), `${JSON.stringify({
      version: 1,
      webhooks: [
        {
          id: "audit",
          enabled: true,
          token: "token-a",
          defaultAgentId: "default",
        },
        {
          id: "ops",
          enabled: true,
          token: "token-b",
          defaultAgentId: "default",
          promptTemplate: "{{event}}",
        },
        {
          id: "release",
          enabled: true,
          token: "token-c",
          defaultAgentId: "default",
          promptTemplate: "{{user.name}}",
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      "organize",
      "disable_multiple",
      "filter",
      "custom_template",
      "save_as_strategy",
      "Pause custom templates",
    );

    const firstResult = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedStrategyState = JSON.parse(await fs.readFile(path.join(stateDir, "webhook-organize-state.json"), "utf-8")) as {
      customPresets?: Array<{ id: string; label: string; action: string; criteria: { enabled: string; template: string } }>;
    };
    const savedStrategyNote = promptState.notes.find((item) => item.title === "Webhook saved strategy");

    expect(firstResult.configuredModules).toEqual(["webhook"]);
    expect(savedStrategyNote?.message).toContain("Saved strategy: Pause custom templates");
    expect(savedStrategyNote?.message).toContain("Matched now: 2 webhook(s)");
    expect(savedStrategyNote?.message).toContain("Risk: 1 matched webhook(s) use unsupported nested placeholders.");
    expect(savedStrategyState.customPresets).toEqual([
      expect.objectContaining({
        id: "pause-custom-templates",
        label: "Pause custom templates",
        action: "disable_multiple",
        criteria: { enabled: "any", template: "custom_template" },
      }),
    ]);

    promptState.responses = [
      true,
      "organize",
      "saved_strategy",
      "pause-custom-templates",
      "apply_all_matched",
      true,
    ];
    promptState.notes = [];

    const secondResult = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const savedConfig = JSON.parse(await fs.readFile(path.join(stateDir, "webhooks.json"), "utf-8")) as {
      webhooks: Array<{ id: string; enabled: boolean }>;
    };
    const applySavedStrategyNote = promptState.notes.find((item) => item.title === "Webhook saved strategy");

    expect(secondResult.configuredModules).toEqual(["webhook"]);
    expect(applySavedStrategyNote?.message).toContain("Saved preset: Pause custom templates");
    expect(savedConfig.webhooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "audit", enabled: true }),
      expect.objectContaining({ id: "ops", enabled: false }),
      expect.objectContaining({ id: "release", enabled: false }),
    ]));

    promptState.responses = [
      true,
      "organize",
      "manage_saved_strategies",
      "remove_one",
      "pause-custom-templates",
      true,
    ];
    promptState.notes = [];

    const thirdResult = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["webhook"],
    });

    const clearedState = JSON.parse(await fs.readFile(path.join(stateDir, "webhook-organize-state.json"), "utf-8")) as {
      customPresets?: Array<{ id: string }>;
    };
    const removeSavedStrategyNote = promptState.notes.find((item) => item.title === "Webhook saved strategy");

    expect(thirdResult.configuredModules).toEqual(["webhook"]);
    expect(removeSavedStrategyNote?.message).toContain("Removed saved strategy");
    expect(clearedState.customPresets ?? []).toEqual([]);
  });

  test("cron configure updates active hours and writes one cron job", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=true",
      "BELLDANDY_HEARTBEAT_INTERVAL=30m",
      "",
    ].join("\n"), "utf-8");

    promptState.responses.push(
      true,
      true,
      true,
      "45m",
      "08:00-23:00",
      true,
      "Morning summary",
      "Daily summary",
      true,
      "dailyAt",
      "09:00",
      "Asia/Shanghai",
      "",
      "systemEvent",
      "Send daily summary",
      "main",
      "user",
      "user",
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const envContent = await fs.readFile(envPath, "utf-8");
    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{
        name: string;
        enabled: boolean;
        schedule: { kind: string; time?: string; timezone?: string };
        payload: { kind: string; text?: string };
        sessionTarget: string;
        delivery: { mode: string };
        failureDestination?: { mode: string };
      }>;
    };

    expect(result.configuredModules).toEqual(["cron"]);
    expect(envContent).toContain("BELLDANDY_HEARTBEAT_INTERVAL=45m");
    expect(envContent).toContain("BELLDANDY_HEARTBEAT_ACTIVE_HOURS=08:00-23:00");
    expect(savedStore.jobs).toHaveLength(1);
    expect(savedStore.jobs[0]).toMatchObject({
      name: "Morning summary",
      enabled: true,
      schedule: {
        kind: "dailyAt",
        time: "09:00",
        timezone: "Asia/Shanghai",
      },
      payload: {
        kind: "systemEvent",
        text: "Send daily summary",
      },
      sessionTarget: "main",
      delivery: { mode: "user" },
      failureDestination: { mode: "user" },
    });
  });

  test("cron organize can disable multiple jobs", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-a",
          name: "Job A",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          deleteAfterRun: false,
          schedule: { kind: "at", at: "2026-04-13T09:00:00+08:00" },
          payload: { kind: "systemEvent", text: "A" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            nextRunAtMs: Date.now() + 1000,
            lastStatus: "error",
            lastError: "network timeout",
          },
        },
        {
          id: "job-b",
          name: "Job B",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "dailyAt", time: "09:00", timezone: "Asia/Shanghai" },
          payload: { kind: "goalApprovalScan", allGoals: true, autoEscalate: true },
          sessionTarget: "isolated",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: { nextRunAtMs: Date.now() + 2000 },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "simple_filter",
      "all",
      "select_subset",
      "job-a",
      true,
      "job-b",
      false,
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ enabled: boolean }>;
    };
    const diagnostics = promptState.notes.find((item) => item.title === "Automation diagnostics");
    const suggestions = promptState.notes.find((item) => item.title === "Cron organize suggestions");
    const preview = promptState.notes.find((item) => item.title === "Cron organize preview");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(diagnostics).toBeDefined();
    expect(diagnostics?.message).toContain("Earliest next run:");
    expect(diagnostics?.message).toContain("Recent failures:");
    expect(diagnostics?.message).toContain("Delivery summary:");
    expect(diagnostics?.message).toContain("One-shot jobs kept after run:");
    expect(diagnostics?.message).toContain("Silent jobs:");
    expect(diagnostics?.message).toContain("Goal approval scan jobs without failure delivery:");
    expect(suggestions?.message).toContain("Disable silent failed jobs: 1 match(es)");
    expect(suggestions?.message).toContain("runtime=failures 1, silent failures 1");
    expect(suggestions?.message).toContain("examples=Job A");
    expect(suggestions?.message).toContain("Disable silent goal scans: 1 match(es)");
    expect(preview?.message).toContain("Would disable 2 job(s).");
    expect(savedStore.jobs.every((job) => job.enabled === false)).toBe(true);
  });

  test("cron organize can filter failed jobs before batch disable", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-failed",
          name: "Job Failed",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "Failed" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "user" },
          state: {
            lastStatus: "error",
            lastError: "provider unavailable",
          },
        },
        {
          id: "job-ok",
          name: "Job OK",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "dailyAt", time: "09:00", timezone: "Asia/Shanghai" },
          payload: { kind: "goalApprovalScan", allGoals: true },
          sessionTarget: "isolated",
          delivery: { mode: "user" },
          failureDestination: { mode: "user" },
          state: {
            nextRunAtMs: Date.now() + 2000,
            lastStatus: "ok",
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "simple_filter",
      "failed",
      "apply_all_matched",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; enabled: boolean }>;
    };
    const filterNote = promptState.notes.find((item) => item.title === "Cron organize filter");
    const previewNote = promptState.notes.find((item) => item.title === "Cron organize preview");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(filterNote?.message).toContain("jobs with recent failures");
    expect(filterNote?.message).toContain("matched 1 job(s): Job Failed");
    expect(previewNote?.message).toContain("Would disable 1 job(s).");
    expect(savedStore.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "job-failed", enabled: false }),
      expect.objectContaining({ id: "job-ok", enabled: true }),
    ]));
  });

  test("cron organize can combine conditions before batch disable", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-target",
          name: "Job Target",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "goalApprovalScan", allGoals: true },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            lastStatus: "error",
            lastError: "approval store unavailable",
          },
        },
        {
          id: "job-non-silent",
          name: "Job Non Silent",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "goalApprovalScan", allGoals: true },
          sessionTarget: "main",
          delivery: { mode: "user" },
          failureDestination: { mode: "user" },
          state: {
            lastStatus: "error",
            lastError: "approval store unavailable",
          },
        },
        {
          id: "job-system",
          name: "Job System",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "noop" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            lastStatus: "error",
            lastError: "provider unavailable",
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "combined_conditions",
      "enabled",
      "error",
      "goalApprovalScan",
      true,
      false,
      true,
      false,
      false,
      "select_subset",
      "job-target",
      false,
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; enabled: boolean }>;
    };
    const conditionsNote = promptState.notes.find((item) => item.title === "Cron organize conditions");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(conditionsNote?.message).toContain("enabled, last=error, payload=goalApprovalScan, silent, failureDelivery=none");
    expect(savedStore.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "job-target", enabled: false }),
      expect.objectContaining({ id: "job-non-silent", enabled: true }),
      expect.objectContaining({ id: "job-system", enabled: true }),
    ]));
  });

  test("cron organize can persist a custom strategy from combined conditions", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-save-preset",
          name: "Job Save Preset",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "goalApprovalScan", allGoals: true },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            lastStatus: "error",
            lastError: "approval store unavailable",
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "combined_conditions",
      "enabled",
      "error",
      "goalApprovalScan",
      true,
      false,
      true,
      false,
      true,
      "Disable failed silent scans",
      "select_subset",
      "job-save-preset",
      false,
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const organizeState = JSON.parse(await fs.readFile(path.join(stateDir, "cron-organize-state.json"), "utf-8")) as {
      customPresets: Array<{ label: string; action: string; criteria: { payloadKind: string; silentOnly: boolean } }>;
    };
    const savedStrategyNote = promptState.notes.find((item) => item.title === "Cron saved strategy");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(savedStrategyNote?.message).toContain("Saved custom strategy \"Disable failed silent scans\"");
    expect(organizeState.customPresets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Disable failed silent scans",
        action: "disable_multiple",
        criteria: expect.objectContaining({
          payloadKind: "goalApprovalScan",
          silentOnly: true,
        }),
      }),
    ]));
  });

  test("cron organize preset can remove disabled one-shot jobs", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-one-shot",
          name: "Job One Shot",
          enabled: false,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "at", at: "2026-04-13T09:00:00+08:00" },
          payload: { kind: "systemEvent", text: "cleanup" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: { lastStatus: "ok" },
        },
        {
          id: "job-disabled-recurring",
          name: "Job Disabled Recurring",
          enabled: false,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "keep" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {},
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "preset_strategy",
      "remove_disabled_one_shot",
      "apply_all_matched",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string }>;
    };
    const presetNote = promptState.notes.find((item) => item.title === "Cron organize preset");
    const previewNote = promptState.notes.find((item) => item.title === "Cron organize preview");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(presetNote?.message).toContain("Preset: Remove disabled one-shot jobs");
    expect(presetNote?.message).toContain("Action: remove");
    expect(previewNote?.message).toContain("Would remove 1 job(s) from cron-jobs.json.");
    expect(savedStore.jobs).toEqual([
      expect.objectContaining({ id: "job-disabled-recurring" }),
    ]);
  });

  test("cron organize can reuse last selected jobs", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-last-a",
          name: "Job Last A",
          enabled: false,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "A" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {},
        },
        {
          id: "job-last-b",
          name: "Job Last B",
          enabled: false,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "B" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {},
        },
      ],
    }, null, 2)}\n`, "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-organize-state.json"), `${JSON.stringify({
      version: 1,
      customPresets: [],
      lastSelection: {
        label: "Filter failed jobs: Job Last A, Job Last B",
        jobIds: ["job-last-a", "job-last-b"],
        storedAt: Date.now(),
      },
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "enable_multiple",
      "reuse_last_selection",
      "apply_all_matched",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; enabled: boolean }>;
    };
    const reuseNote = promptState.notes.find((item) => item.title === "Cron reuse last selection");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(reuseNote?.message).toContain("Reusing last selected jobs");
    expect(savedStore.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "job-last-a", enabled: true }),
      expect.objectContaining({ id: "job-last-b", enabled: true }),
    ]));
  });

  test("cron organize dry-run previews matched jobs without applying changes", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-preview-a",
          name: "Job Preview A",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "A" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            nextRunAtMs: Date.now() + 1000,
            lastStatus: "error",
            lastError: "network timeout",
          },
        },
        {
          id: "job-preview-b",
          name: "Job Preview B",
          enabled: false,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "at", at: "2026-04-13T09:00:00+08:00" },
          payload: { kind: "systemEvent", text: "B" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {},
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "simple_filter",
      "all",
      "dry_run_only",
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; enabled: boolean }>;
    };
    const organizeState = JSON.parse(await fs.readFile(path.join(stateDir, "cron-organize-state.json"), "utf-8")) as {
      lastPreview?: { action: string; label: string; jobIds: string[] };
    };
    const previewNote = promptState.notes.find((item) => item.title === "Cron organize preview");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(result.notes).toContain("Cron organize dry-run: disable 2 matched job(s)");
    expect(previewNote?.message).toContain("Matched jobs: 2");
    expect(previewNote?.message).toContain("Would disable 1 job(s).");
    expect(previewNote?.message).toContain("Already disabled: 1");
    expect(organizeState.lastPreview).toEqual(expect.objectContaining({
      action: "disable_multiple",
      label: "Filter all jobs: Job Preview A, Job Preview B",
      jobIds: ["job-preview-a", "job-preview-b"],
    }));
    expect(savedStore.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "job-preview-a", enabled: true }),
      expect.objectContaining({ id: "job-preview-b", enabled: false }),
    ]));
  });

  test("cron organize can reuse last preview result", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-preview-reuse-a",
          name: "Job Preview Reuse A",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "A" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            nextRunAtMs: Date.now() + 1000,
          },
        },
        {
          id: "job-preview-reuse-b",
          name: "Job Preview Reuse B",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "B" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            nextRunAtMs: Date.now() + 2000,
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "simple_filter",
      "all",
      "dry_run_only",
    );

    await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    promptState.responses = [
      true,
      true,
      false,
      "organize",
      "reuse_preview_result",
      "disable_multiple",
      "apply_all_matched",
      true,
    ];
    promptState.notes = [];

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; enabled: boolean }>;
    };
    const reusePreviewNote = promptState.notes.find((item) => item.title === "Cron reuse preview");
    const previewNote = promptState.notes.find((item) => item.title === "Cron organize preview");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(reusePreviewNote?.message).toContain("Reusing last preview result");
    expect(reusePreviewNote?.message).toContain("Action: disable");
    expect(previewNote?.message).toContain("Would disable 2 job(s).");
    expect(savedStore.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "job-preview-reuse-a", enabled: false }),
      expect.objectContaining({ id: "job-preview-reuse-b", enabled: false }),
    ]));
  });

  test("cron organize can reuse last preview result and switch action", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-preview-switch-a",
          name: "Job Preview Switch A",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "A" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            nextRunAtMs: Date.now() + 1000,
          },
        },
        {
          id: "job-preview-switch-b",
          name: "Job Preview Switch B",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "at", at: "2026-04-13T09:00:00+08:00" },
          payload: { kind: "systemEvent", text: "B" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            nextRunAtMs: Date.now() + 2000,
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "simple_filter",
      "all",
      "dry_run_only",
    );

    await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    promptState.responses = [
      true,
      true,
      false,
      "organize",
      "reuse_preview_result",
      "remove_multiple",
      "apply_all_matched",
      true,
    ];
    promptState.notes = [];

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string }>;
    };
    const organizeState = JSON.parse(await fs.readFile(path.join(stateDir, "cron-organize-state.json"), "utf-8")) as {
      lastPreview?: { action: string; jobIds: string[] };
    };
    const reusePreviewNote = promptState.notes.find((item) => item.title === "Cron reuse preview");
    const previewNote = promptState.notes.find((item) => item.title === "Cron organize preview");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(reusePreviewNote?.message).toContain("Action: disable");
    expect(previewNote?.message).toContain("Action preview: remove");
    expect(previewNote?.message).toContain("Would remove 2 job(s) from cron-jobs.json.");
    expect(organizeState.lastPreview).toEqual(expect.objectContaining({
      action: "remove_multiple",
      jobIds: ["job-preview-switch-a", "job-preview-switch-b"],
    }));
    expect(savedStore.jobs).toEqual([]);
  });

  test("cron organize can save preview result as reusable selection and reuse it", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-selection-a",
          name: "Job Selection A",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "A" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: { nextRunAtMs: Date.now() + 1000 },
        },
        {
          id: "job-selection-b",
          name: "Job Selection B",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "B" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: { nextRunAtMs: Date.now() + 2000 },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "simple_filter",
      "all",
      "save_as_selection",
    );

    const firstResult = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedSelectionState = JSON.parse(await fs.readFile(path.join(stateDir, "cron-organize-state.json"), "utf-8")) as {
      lastSelection?: { label: string; jobIds: string[] };
    };
    const savedSelectionNote = promptState.notes.find((item) => item.title === "Cron saved selection");

    expect(firstResult.configuredModules).toEqual(["cron"]);
    expect(savedSelectionNote?.message).toContain("Saved 2 matched job(s) as reusable selection");
    expect(savedSelectionState.lastSelection).toEqual(expect.objectContaining({
      label: "Filter all jobs: Job Selection A, Job Selection B",
      jobIds: ["job-selection-a", "job-selection-b"],
    }));

    promptState.responses = [
      true,
      true,
      false,
      "organize",
      "disable_multiple",
      "reuse_last_selection",
      "apply_all_matched",
      true,
    ];
    promptState.notes = [];

    const secondResult = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; enabled: boolean }>;
    };
    const reuseNote = promptState.notes.find((item) => item.title === "Cron reuse last selection");

    expect(secondResult.configuredModules).toEqual(["cron"]);
    expect(reuseNote?.message).toContain("Reusing last selected jobs");
    expect(savedStore.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "job-selection-a", enabled: false }),
      expect.objectContaining({ id: "job-selection-b", enabled: false }),
    ]));
  });

  test("cron organize can remove one saved custom strategy", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-keep",
          name: "Job Keep",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "keep" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {},
        },
      ],
    }, null, 2)}\n`, "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-organize-state.json"), `${JSON.stringify({
      version: 1,
      customPresets: [
        {
          id: "disable-failed",
          label: "Disable failed jobs",
          action: "disable_multiple",
          criteria: {
            enabled: "enabled",
            lastStatus: "error",
            payloadKind: "any",
            silentOnly: false,
            missingNextRunOnly: false,
            failureDeliveryOffOnly: false,
            oneShotOnly: false,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "remove-one-shot",
          label: "Remove one-shot jobs",
          action: "remove_multiple",
          criteria: {
            enabled: "disabled",
            lastStatus: "any",
            payloadKind: "any",
            silentOnly: false,
            missingNextRunOnly: false,
            failureDeliveryOffOnly: false,
            oneShotOnly: true,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "organize",
      "manage_saved_strategies",
      "remove_one",
      "disable-failed",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const organizeState = JSON.parse(await fs.readFile(path.join(stateDir, "cron-organize-state.json"), "utf-8")) as {
      customPresets: Array<{ id: string }>;
    };
    const savedStrategyNote = promptState.notes.find((item) => item.title === "Cron saved strategy");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(savedStrategyNote?.message).toContain("Removed saved strategy \"Disable failed jobs\"");
    expect(organizeState.customPresets).toEqual([
      expect.objectContaining({ id: "remove-one-shot" }),
    ]);
  });

  test("cron run now queues one enabled job for the next scheduler tick", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    const originalNextRunAtMs = Date.now() + 60_000;
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-run-now",
          name: "Job Run Now",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "Run me" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: { nextRunAtMs: originalNextRunAtMs },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "run_now",
      "job-run-now",
      true,
    );

    const startedAt = Date.now();
    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; state: { nextRunAtMs?: number } }>;
    };
    const runNowNote = promptState.notes.find((item) => item.title === "Cron run now");
    const queuedJob = savedStore.jobs.find((job) => job.id === "job-run-now");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(runNowNote).toBeDefined();
    expect(runNowNote?.message).toContain("Queued \"Job Run Now\"");
    expect(runNowNote?.message).toContain("This is a silent job");
    expect(queuedJob?.state.nextRunAtMs).toBeDefined();
    expect(queuedJob!.state.nextRunAtMs!).toBeGreaterThanOrEqual(startedAt);
    expect(queuedJob!.state.nextRunAtMs!).toBeLessThan(originalNextRunAtMs);
  });

  test("cron run now executes immediately via runtime when gateway is reachable", async () => {
    const { envPath, stateDir } = await createTempSetup();
    gatewayRuntimeState.mode = "success";
    gatewayRuntimeState.runNowResponse = {
      status: "ok",
      runId: "cron-run-live",
      summary: "systemEvent completed",
      reason: undefined,
    };
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    const originalNextRunAtMs = Date.now() + 120_000;
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-run-live",
          name: "Job Run Live",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "Run live" },
          sessionTarget: "main",
          delivery: { mode: "user" },
          failureDestination: { mode: "user" },
          state: { nextRunAtMs: originalNextRunAtMs },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "run_now",
      "job-run-live",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const savedStore = JSON.parse(await fs.readFile(path.join(stateDir, "cron-jobs.json"), "utf-8")) as {
      jobs: Array<{ id: string; state: { nextRunAtMs?: number } }>;
    };
    const runNowNote = promptState.notes.find((item) => item.title === "Cron run now");
    const queuedJob = savedStore.jobs.find((job) => job.id === "job-run-live");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(runNowNote).toBeDefined();
    expect(runNowNote?.message).toContain("Executed \"Job Run Live\" immediately via runtime.");
    expect(runNowNote?.message).toContain("Summary: systemEvent completed");
    expect(runNowNote?.message).toContain("Run id: cron-run-live");
    expect(gatewayRuntimeReachabilityMock).toHaveBeenCalledWith(expect.any(Map));
    expect(legacyFetchMock).not.toHaveBeenCalled();
    expect(gatewayRuntimeState.lastRequest).toMatchObject({
      method: "cron.run_now",
      params: { jobId: "job-run-live" },
    });
    expect(queuedJob?.state.nextRunAtMs).toBe(originalNextRunAtMs);
  });

  test("cron recovery run executes targeted recovery and replays latest result", async () => {
    const { envPath, stateDir } = await createTempSetup();
    gatewayRuntimeState.mode = "success";
    gatewayRuntimeState.recoveryResponse = {
      outcome: "succeeded",
      sourceRunId: "cron-run-failed-live",
      recoveryRunId: "cron-run-recovered-live",
      reason: "systemEvent retried successfully",
    };
    gatewayRuntimeState.backgroundContinuationRecentEntries = [
      {
        kind: "cron",
        runId: "cron-run-recovered-live",
        sourceId: "job-recovery-live",
        label: "Job Recovery Live",
        status: "ran",
        startedAt: 1710000003000,
        updatedAt: 1710000004000,
        finishedAt: 1710000004000,
        durationMs: 1000,
        summary: "systemEvent recovered",
        reason: "Recovered from cron-run-failed-live: systemEvent retried successfully",
        recoveredFromRunId: "cron-run-failed-live",
      },
      {
        kind: "cron",
        runId: "cron-run-failed-live",
        sourceId: "job-recovery-live",
        label: "Job Recovery Live",
        status: "failed",
        startedAt: 1710000000000,
        updatedAt: 1710000002000,
        finishedAt: 1710000002000,
        durationMs: 2000,
        summary: "systemEvent failed",
        reason: "provider unavailable",
        latestRecoveryAttemptAt: 1710000003000,
        latestRecoveryOutcome: "succeeded",
        latestRecoveryRunId: "cron-run-recovered-live",
        latestRecoveryReason: "systemEvent retried successfully",
      },
    ];
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-recovery-live",
          name: "Job Recovery Live",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 3600000 },
          payload: { kind: "systemEvent", text: "Recover me" },
          sessionTarget: "main",
          delivery: { mode: "none" },
          failureDestination: { mode: "user" },
          state: {
            nextRunAtMs: Date.now() + 120_000,
            lastStatus: "error",
            lastError: "provider unavailable",
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "recovery_run",
      "job-recovery-live",
      true,
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const recoveryRunNote = promptState.notes.find((item) => item.title === "Cron recovery run");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(recoveryRunNote).toBeDefined();
    expect(recoveryRunNote?.message).toContain("Recovery outcome: succeeded");
    expect(recoveryRunNote?.message).toContain("Source run id: cron-run-failed-live");
    expect(recoveryRunNote?.message).toContain("Recovery run id: cron-run-recovered-live");
    expect(recoveryRunNote?.message).toContain("Replay summary: systemEvent recovered");
    expect(gatewayRuntimeState.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "cron.recovery.run",
        params: { jobId: "job-recovery-live" },
      }),
      expect.objectContaining({
        method: "system.doctor",
      }),
    ]));
  });

  test("cron recovery replay shows latest failure and recovery summary", async () => {
    const { envPath, stateDir } = await createTempSetup();
    gatewayRuntimeState.mode = "success";
    gatewayRuntimeState.backgroundContinuationRecentEntries = [
      {
        kind: "cron",
        runId: "cron-run-recovered-replay",
        sourceId: "job-recovery-replay",
        label: "Job Recovery Replay",
        status: "ran",
        startedAt: 1710000103000,
        updatedAt: 1710000103500,
        finishedAt: 1710000103500,
        durationMs: 500,
        summary: "approval scan recovered",
        reason: "Recovered from cron-run-failed-replay: approval store restored",
        recoveredFromRunId: "cron-run-failed-replay",
      },
      {
        kind: "cron",
        runId: "cron-run-failed-replay",
        sourceId: "job-recovery-replay",
        label: "Job Recovery Replay",
        status: "failed",
        startedAt: 1710000100000,
        updatedAt: 1710000102000,
        finishedAt: 1710000102000,
        durationMs: 2000,
        summary: "approval scan failed",
        reason: "approval store unavailable",
        latestRecoveryAttemptAt: 1710000103000,
        latestRecoveryOutcome: "succeeded",
        latestRecoveryRunId: "cron-run-recovered-replay",
        latestRecoveryReason: "approval store restored",
      },
    ];
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=true",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-recovery-replay",
          name: "Job Recovery Replay",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "dailyAt", time: "09:00", timezone: "Asia/Shanghai" },
          payload: { kind: "goalApprovalScan", allGoals: true },
          sessionTarget: "isolated",
          delivery: { mode: "none" },
          failureDestination: { mode: "user" },
          state: {
            nextRunAtMs: Date.now() + 120_000,
            lastStatus: "error",
            lastError: "approval store unavailable",
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      true,
      false,
      "recovery_replay",
      "job-recovery-replay",
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const recoveryReplayNote = promptState.notes.find((item) => item.title === "Cron recovery replay");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(recoveryReplayNote).toBeDefined();
    expect(recoveryReplayNote?.message).toContain("Latest failed run: cron-run-failed-replay");
    expect(recoveryReplayNote?.message).toContain("Latest recovery attempt: succeeded");
    expect(recoveryReplayNote?.message).toContain("Recovery run id: cron-run-recovered-replay");
    expect(recoveryReplayNote?.message).toContain("Replay summary: approval scan recovered");
    expect(gatewayRuntimeState.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "system.doctor",
      }),
    ]));
  });

  test("cron recovery hint explains failed approval scan guidance", async () => {
    const { envPath, stateDir } = await createTempSetup();
    await fs.writeFile(envPath, [
      "BELLDANDY_CRON_ENABLED=false",
      "BELLDANDY_HEARTBEAT_ENABLED=false",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "cron-jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-recovery",
          name: "Job Recovery",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "dailyAt", time: "09:00", timezone: "Asia/Shanghai" },
          payload: { kind: "goalApprovalScan", allGoals: true, autoEscalate: true },
          sessionTarget: "isolated",
          delivery: { mode: "none" },
          failureDestination: { mode: "none" },
          state: {
            nextRunAtMs: Date.now() + 1000,
            lastStatus: "error",
            lastError: "approval store unavailable",
          },
        },
      ],
    }, null, 2)}\n`, "utf-8");

    promptState.responses.push(
      true,
      false,
      false,
      "recovery_hint",
      "job-recovery",
    );

    const result = await runAdvancedModulesWizard({
      envPath,
      stateDir,
      authMode: "none",
      modules: ["cron"],
    });

    const recoveryHint = promptState.notes.find((item) => item.title === "Cron recovery hint");

    expect(result.configuredModules).toEqual(["cron"]);
    expect(recoveryHint).toBeDefined();
    expect(recoveryHint?.message).toContain("Cron runtime is disabled in env");
    expect(recoveryHint?.message).toContain("Last failure: approval store unavailable");
    expect(recoveryHint?.message).toContain("Goal approval scan failures will stay silent");
  });
});
