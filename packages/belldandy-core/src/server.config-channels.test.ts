import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { startGatewayServer } from "./server.js";
import {
  isConfigFileRestartSuppressed,
  resetSuppressedConfigFileRestarts,
} from "./config-restart-guard.js";
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

afterEach(() => {
  cleanupGlobalMemoryManagersForTest();
  resetSuppressedConfigFileRestarts();
});

test("config.update persists tool control mode and redacts confirm password in config.read", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), 'BELLDANDY_AGENT_TOOL_CONTROL_MODE="disabled"\n', "utf-8");

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
      id: "config-update-agent-tool-control",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_AGENT_TOOL_CONTROL_MODE: "confirm",
          BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD: "星河123",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-agent-tool-control"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-agent-tool-control");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-agent-tool-control", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-agent-tool-control"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-agent-tool-control");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_AGENT_TOOL_CONTROL_MODE).toBe("confirm");
    expect(readRes.payload?.config?.BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD).toBe("[REDACTED]");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_AGENT_TOOL_CONTROL_MODE="confirm"');
    expect(envLocalContent).toContain('BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD="星河123"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts system and model env settings and redacts auth/video secrets in config.read", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");

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
      id: "config-update-system-model",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_HOST: "0.0.0.0",
          BELLDANDY_PORT: "29999",
          BELLDANDY_GATEWAY_PORT: "30000",
          BELLDANDY_UPDATE_CHECK: "false",
          BELLDANDY_AUTH_MODE: "token",
          BELLDANDY_AUTH_TOKEN: "setup-test-token",
          BELLDANDY_ALLOWED_ORIGINS: "http://localhost:5173",
          BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "12345",
          BELLDANDY_OPENAI_WIRE_API: "responses",
          BELLDANDY_OPENAI_THINKING: "enabled",
          BELLDANDY_OPENAI_REASONING_EFFORT: "max",
          BELLDANDY_RESPONSES_SANITIZE_TOOL_SCHEMA: "true",
          BELLDANDY_OPENAI_PROXY_URL: "http://127.0.0.1:7890",
          BELLDANDY_OPENAI_SYSTEM_PROMPT: "follow house rules",
          BELLDANDY_AGENT_TIMEOUT_MS: "150000",
          BELLDANDY_AGENT_PROTOCOL: "anthropic",
          BELLDANDY_VIDEO_FILE_API_URL: "https://api.moonshot.cn/v1",
          BELLDANDY_VIDEO_FILE_API_KEY: "video-secret",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-system-model"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-system-model");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-system-model", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-system-model"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-system-model");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_HOST).toBe("0.0.0.0");
    expect(readRes.payload?.config?.BELLDANDY_PORT).toBe("29999");
    expect(readRes.payload?.config?.BELLDANDY_GATEWAY_PORT).toBe("30000");
    expect(readRes.payload?.config?.BELLDANDY_UPDATE_CHECK).toBe("false");
    expect(readRes.payload?.config?.BELLDANDY_AUTH_MODE).toBe("token");
    expect(readRes.payload?.config?.BELLDANDY_ALLOWED_ORIGINS).toBe("http://localhost:5173");
    expect(readRes.payload?.config?.BELLDANDY_OPENAI_WIRE_API).toBe("responses");
    expect(readRes.payload?.config?.BELLDANDY_OPENAI_THINKING).toBe("enabled");
    expect(readRes.payload?.config?.BELLDANDY_OPENAI_REASONING_EFFORT).toBe("max");
    expect(readRes.payload?.config?.BELLDANDY_OPENAI_PROXY_URL).toBe("http://127.0.0.1:7890");
    expect(readRes.payload?.config?.BELLDANDY_OPENAI_SYSTEM_PROMPT).toBe("follow house rules");
    expect(readRes.payload?.config?.BELLDANDY_AGENT_PROTOCOL).toBe("anthropic");
    expect(readRes.payload?.config?.BELLDANDY_VIDEO_FILE_API_URL).toBe("https://api.moonshot.cn/v1");
    expect(readRes.payload?.config?.BELLDANDY_AUTH_TOKEN).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_VIDEO_FILE_API_KEY).toBe("[REDACTED]");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_AUTH_MODE="token"');
    expect(envLocalContent).toContain('BELLDANDY_AUTH_TOKEN="setup-test-token"');
    expect(envLocalContent).toContain('BELLDANDY_OPENAI_WIRE_API="responses"');
    expect(envLocalContent).toContain('BELLDANDY_VIDEO_FILE_API_KEY="video-secret"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts unified Aliyun API key targets and redacts them in config.read", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");

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
      id: "config-update-aliyun-keys",
      method: "config.update",
      params: {
        updates: {
          DASHSCOPE_API_KEY: "aliyun-shared-key",
          BELLDANDY_COMPACTION_API_KEY: "aliyun-shared-key",
          BELLDANDY_MEMORY_EVOLUTION_API_KEY: "aliyun-shared-key",
          BELLDANDY_MEMORY_SUMMARY_API_KEY: "aliyun-shared-key",
          BELLDANDY_EMBEDDING_OPENAI_API_KEY: "aliyun-shared-key",
          BELLDANDY_TASK_SUMMARY_API_KEY: "aliyun-shared-key",
          BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY: "aliyun-shared-key",
          BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY: "aliyun-shared-key",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-aliyun-keys"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-aliyun-keys");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-aliyun-keys", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-aliyun-keys"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-aliyun-keys");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.DASHSCOPE_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_COMPACTION_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_EVOLUTION_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_SUMMARY_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_EMBEDDING_OPENAI_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_TASK_SUMMARY_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY).toBe("[REDACTED]");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('DASHSCOPE_API_KEY="aliyun-shared-key"');
    expect(envLocalContent).toContain('BELLDANDY_COMPACTION_API_KEY="aliyun-shared-key"');
    expect(envLocalContent).toContain('BELLDANDY_MEMORY_EVOLUTION_API_KEY="aliyun-shared-key"');
    expect(envLocalContent).toContain('BELLDANDY_MEMORY_SUMMARY_API_KEY="aliyun-shared-key"');
    expect(envLocalContent).toContain('BELLDANDY_EMBEDDING_OPENAI_API_KEY="aliyun-shared-key"');
    expect(envLocalContent).toContain('BELLDANDY_TASK_SUMMARY_API_KEY="aliyun-shared-key"');
    expect(envLocalContent).toContain('BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY="aliyun-shared-key"');
    expect(envLocalContent).toContain('BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY="aliyun-shared-key"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts memory and tool env settings", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");

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
      id: "config-update-memory-tools",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_BROWSER_ALLOWED_DOMAINS: "github.com,developer.mozilla.org",
          BELLDANDY_BROWSER_DENIED_DOMAINS: "mail.google.com",
          BELLDANDY_AGENT_BRIDGE_ENABLED: "true",
          BELLDANDY_TOOL_GROUPS: "browser,system",
          BELLDANDY_MAX_INPUT_TOKENS: "20000",
          BELLDANDY_MAX_OUTPUT_TOKENS: "8192",
          BELLDANDY_MEMORY_ENABLED: "false",
          BELLDANDY_EMBEDDING_ENABLED: "true",
          BELLDANDY_EMBEDDING_PROVIDER: "local",
          BELLDANDY_LOCAL_EMBEDDING_MODEL: "BAAI/bge-m3",
          BELLDANDY_EMBEDDING_BATCH_SIZE: "4",
          BELLDANDY_CONTEXT_INJECTION: "false",
          BELLDANDY_CONTEXT_INJECTION_LIMIT: "7",
          BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "true",
          BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT: "4",
          BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES: "preference,fact,experience",
          BELLDANDY_MIND_PROFILE_RUNTIME_ENABLED: "false",
          BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINES: "6",
          BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINE_LENGTH: "140",
          BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS: "480",
          BELLDANDY_MIND_PROFILE_RUNTIME_MIN_SIGNAL_COUNT: "3",
          BELLDANDY_TASK_DEDUP_GUARD_ENABLED: "false",
          BELLDANDY_TASK_DEDUP_WINDOW_MINUTES: "30",
          BELLDANDY_TASK_DEDUP_MODE: "strict",
          BELLDANDY_TASK_DEDUP_POLICY: "run_command:off,file_write:hard-block",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-memory-tools"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-memory-tools");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-memory-tools", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-memory-tools"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-memory-tools");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_BROWSER_ALLOWED_DOMAINS).toBe("github.com,developer.mozilla.org");
    expect(readRes.payload?.config?.BELLDANDY_TOOL_GROUPS).toBe("browser,system");
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_ENABLED).toBe("false");
    expect(readRes.payload?.config?.BELLDANDY_EMBEDDING_PROVIDER).toBe("local");
    expect(readRes.payload?.config?.BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES).toBe("preference,fact,experience");
    expect(readRes.payload?.config?.BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS).toBe("480");
    expect(readRes.payload?.config?.BELLDANDY_TASK_DEDUP_POLICY).toBe("run_command:off,file_write:hard-block");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_AGENT_BRIDGE_ENABLED="true"');
    expect(envLocalContent).toContain('BELLDANDY_MAX_OUTPUT_TOKENS="8192"');
    expect(envLocalContent).toContain('BELLDANDY_MEMORY_ENABLED="false"');
    expect(envLocalContent).toContain('BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION="true"');
    expect(envLocalContent).toContain('BELLDANDY_TASK_DEDUP_MODE="strict"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts advanced memory and camera helper env settings", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");

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
      id: "config-update-memory-camera-advanced",
      method: "config.update",
      params: {
        updates: {
          DASHSCOPE_API_KEY: "aliyun-shared-key",
          BELLDANDY_COMPACTION_API_KEY: "aliyun-shared-key",
          BELLDANDY_EMBEDDING_OPENAI_API_KEY: "aliyun-shared-key",
          BELLDANDY_MEMORY_SUMMARY_ENABLED: "true",
          BELLDANDY_MEMORY_SUMMARY_MODEL: "qwen-plus",
          BELLDANDY_MEMORY_SUMMARY_BASE_URL: "https://memory-summary.example.com/v1",
          BELLDANDY_MEMORY_SUMMARY_API_KEY: "summary-dedicated-key",
          BELLDANDY_MEMORY_EVOLUTION_ENABLED: "true",
          BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES: "8",
          BELLDANDY_MEMORY_EVOLUTION_MODEL: "qwen-max",
          BELLDANDY_MEMORY_EVOLUTION_BASE_URL: "https://memory-evolution.example.com/v1",
          BELLDANDY_MEMORY_EVOLUTION_API_KEY: "evolution-dedicated-key",
          BELLDANDY_AUTO_RECALL_ENABLED: "true",
          BELLDANDY_AUTO_RECALL_LIMIT: "5",
          BELLDANDY_AUTO_RECALL_MIN_SCORE: "0.42",
          BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "9000",
          BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "2",
          BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS: "1200000",
          BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS: "3",
          BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS: "3600000",
          BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_PENDING_MESSAGES: "6",
          BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_MESSAGE_DELTA: "4",
          BELLDANDY_MEMORY_DURABLE_EXTRACTION_SUCCESS_COOLDOWN_MS: "300000",
          BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MS: "5000",
          BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MAX_MS: "600000",
          BELLDANDY_TEAM_SHARED_MEMORY_ENABLED: "true",
          BELLDANDY_SHARED_REVIEW_CLAIM_TIMEOUT_MS: "5400000",
          BELLDANDY_TASK_MEMORY_ENABLED: "true",
          BELLDANDY_TASK_SUMMARY_ENABLED: "true",
          BELLDANDY_TASK_SUMMARY_MODEL: "moonshot-v1-32k",
          BELLDANDY_TASK_SUMMARY_BASE_URL: "https://task-summary.example.com/v1",
          BELLDANDY_TASK_SUMMARY_API_KEY: "task-summary-dedicated-key",
          BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS: "30000",
          BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS: "3",
          BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL: "4000",
          BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED: "false",
          BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED: "false",
          BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED: "true",
          BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED: "true",
          BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED: "false",
          BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED: "true",
          BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED: "true",
          BELLDANDY_MEMORY_DEEP_RETRIEVAL: "true",
          BELLDANDY_EMBEDDING_QUERY_PREFIX: "query: ",
          BELLDANDY_EMBEDDING_PASSAGE_PREFIX: "passage: ",
          BELLDANDY_RERANKER_MIN_SCORE: "0.2",
          BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR: "500",
          BELLDANDY_MEMORY_INDEXER_VERBOSE_WATCH: "true",
          BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND: "node",
          BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON: '["helper.js"]',
          BELLDANDY_CAMERA_NATIVE_HELPER_CWD: "E:/project/star-sanctuary",
          BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS: "10000",
          BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS: "15000",
          BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS: "2000",
          BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON: '{"FOO":"bar"}',
          BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_COMMAND: "powershell.exe",
          BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_ARGS_JSON: "[]",
          BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND: "C:/ffmpeg/bin/ffmpeg.exe",
          BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON: '["-hide_banner"]',
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-memory-camera-advanced"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-memory-camera-advanced");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-memory-camera-advanced", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-memory-camera-advanced"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-memory-camera-advanced");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_SUMMARY_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_EVOLUTION_MODEL).toBe("qwen-max");
    expect(readRes.payload?.config?.BELLDANDY_AUTO_RECALL_LIMIT).toBe("5");
    expect(readRes.payload?.config?.BELLDANDY_TASK_SUMMARY_MODEL).toBe("moonshot-v1-32k");
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_DEEP_RETRIEVAL).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_EMBEDDING_PASSAGE_PREFIX).toBe("passage: ");
    expect(readRes.payload?.config?.BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON).toBe('{"FOO":"bar"}');
    expect(readRes.payload?.config?.BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND).toBe("C:/ffmpeg/bin/ffmpeg.exe");
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_SUMMARY_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_MEMORY_EVOLUTION_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_TASK_SUMMARY_API_KEY).toBe("[REDACTED]");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_MEMORY_SUMMARY_MODEL="qwen-plus"');
    expect(envLocalContent).toContain('BELLDANDY_MEMORY_SUMMARY_API_KEY="summary-dedicated-key"');
    expect(envLocalContent).toContain('BELLDANDY_MEMORY_EVOLUTION_API_KEY="evolution-dedicated-key"');
    expect(envLocalContent).toContain('BELLDANDY_TASK_SUMMARY_API_KEY="task-summary-dedicated-key"');
    expect(envLocalContent).toContain('BELLDANDY_MEMORY_INDEXER_VERBOSE_WATCH="true"');
    expect(envLocalContent).toContain('BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON="{"FOO":"bar"}"');
    expect(envLocalContent).toContain('BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON="["-hide_banner"]"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts system governance env settings and keeps extra workspace roots in shared env", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), 'BELLDANDY_EXTRA_WORKSPACE_ROOTS="E:/legacy"\n', "utf-8");

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
      id: "config-update-system-governance",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_UPDATE_CHECK_TIMEOUT_MS: "3500",
          BELLDANDY_UPDATE_CHECK_API_URL: "https://api.github.com/repos/example/project/releases/latest",
          BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "65536",
          BELLDANDY_WEBHOOK_PREAUTH_TIMEOUT_MS: "5000",
          BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS: "60000",
          BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "120",
          BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_TRACKED_KEYS: "4096",
          BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY: "8",
          BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_TRACKED_KEYS: "4096",
          BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED: "true",
          BELLDANDY_TOKEN_USAGE_UPLOAD_URL: "http://127.0.0.1:3001/api/internal/token-usage",
          BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY: "gro_secret_key",
          BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS: "3000",
          BELLDANDY_TOKEN_USAGE_STRICT_UUID: "true",
          BELLDANDY_AUTO_TASK_TIME_ENABLED: "true",
          BELLDANDY_AUTO_TASK_TOKEN_ENABLED: "false",
          BELLDANDY_WEBHOOK_CONFIG_PATH: "~/.star_sanctuary/webhooks.json",
          BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS: "600000",
          BELLDANDY_STATE_DIR: "~/.star_sanctuary",
          BELLDANDY_STATE_DIR_WINDOWS: "C:/Users/admin/.star_sanctuary",
          BELLDANDY_STATE_DIR_WSL: "~/.star_sanctuary",
          BELLDANDY_WORKSPACE_DIR: "./workspace",
          BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/tools,D:/projects",
          BELLDANDY_WEB_ROOT: "apps/web/public",
          BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: "full",
          BELLDANDY_LOG_LEVEL: "info",
          BELLDANDY_LOG_CONSOLE: "true",
          BELLDANDY_LOG_FILE: "true",
          BELLDANDY_LOG_DIR: "~/.star_sanctuary/logs",
          BELLDANDY_LOG_MAX_SIZE: "10MB",
          BELLDANDY_LOG_RETENTION_DAYS: "7",
          BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED: "true",
          BELLDANDY_DREAM_AUTO_CRON_ENABLED: "false",
          BELLDANDY_DREAM_OBSIDIAN_ENABLED: "true",
          BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH: "C:/Vault",
          BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR: "Dream",
          BELLDANDY_COMMONS_OBSIDIAN_ENABLED: "true",
          BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH: "C:/Vault",
          BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR: "Commons",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-system-governance"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-system-governance");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-system-governance", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-system-governance"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-system-governance");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_UPDATE_CHECK_TIMEOUT_MS).toBe("3500");
    expect(readRes.payload?.config?.BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES).toBe("65536");
    expect(readRes.payload?.config?.BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_AUTO_TASK_TOKEN_ENABLED).toBe("false");
    expect(readRes.payload?.config?.BELLDANDY_EXTRA_WORKSPACE_ROOTS).toBe("E:/tools,D:/projects");
    expect(readRes.payload?.config?.BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE).toBe("full");
    expect(readRes.payload?.config?.BELLDANDY_LOG_DIR).toBe("~/.star_sanctuary/logs");
    expect(readRes.payload?.config?.BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR).toBe("Dream");
    expect(readRes.payload?.config?.BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR).toBe("Commons");

    const envContent = await fs.promises.readFile(path.join(envDir, ".env"), "utf-8");
    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envContent).toContain('BELLDANDY_EXTRA_WORKSPACE_ROOTS="E:/tools,D:/projects"');
    expect(envLocalContent).toContain('BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY="gro_secret_key"');
    expect(envLocalContent).toContain('BELLDANDY_STATE_DIR_WINDOWS="C:/Users/admin/.star_sanctuary"');
    expect(envLocalContent).toContain('BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE="full"');
    expect(envLocalContent).toContain('BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR="Commons"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update hot reloads multimedia and attachment settings without restart suppression drift", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");

  const originalAttachmentMaxFileBytes = process.env.BELLDANDY_ATTACHMENT_MAX_FILE_BYTES;
  const originalTtsProvider = process.env.BELLDANDY_TTS_PROVIDER;
  const originalExternalOutbound = process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION;

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
      id: "config-update-hot-reload-batch",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "2048",
          BELLDANDY_TTS_PROVIDER: "openai",
          BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "false",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-hot-reload-batch"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-hot-reload-batch");
    expect(updateRes.ok).toBe(true);

    expect(process.env.BELLDANDY_ATTACHMENT_MAX_FILE_BYTES).toBe("2048");
    expect(process.env.BELLDANDY_TTS_PROVIDER).toBe("openai");
    expect(process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION).toBe("false");
    expect(isConfigFileRestartSuppressed(".env.local")).toBe(true);
    expect(isConfigFileRestartSuppressed(".env")).toBe(true);

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_ATTACHMENT_MAX_FILE_BYTES="2048"');
    expect(envLocalContent).toContain('BELLDANDY_TTS_PROVIDER="openai"');
    expect(envLocalContent).toContain('BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION="false"');
  } finally {
    if (originalAttachmentMaxFileBytes == null) delete process.env.BELLDANDY_ATTACHMENT_MAX_FILE_BYTES;
    else process.env.BELLDANDY_ATTACHMENT_MAX_FILE_BYTES = originalAttachmentMaxFileBytes;
    if (originalTtsProvider == null) delete process.env.BELLDANDY_TTS_PROVIDER;
    else process.env.BELLDANDY_TTS_PROVIDER = originalTtsProvider;
    if (originalExternalOutbound == null) delete process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION;
    else process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION = originalExternalOutbound;
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update hot reloads auto task report flags", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");

  const originalAutoTaskTime = process.env.BELLDANDY_AUTO_TASK_TIME_ENABLED;
  const originalAutoTaskToken = process.env.BELLDANDY_AUTO_TASK_TOKEN_ENABLED;

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
      id: "config-update-auto-task-report-flags",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_AUTO_TASK_TIME_ENABLED: "false",
          BELLDANDY_AUTO_TASK_TOKEN_ENABLED: "false",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-auto-task-report-flags"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-auto-task-report-flags");
    expect(updateRes.ok).toBe(true);

    expect(process.env.BELLDANDY_AUTO_TASK_TIME_ENABLED).toBe("false");
    expect(process.env.BELLDANDY_AUTO_TASK_TOKEN_ENABLED).toBe("false");
    expect(isConfigFileRestartSuppressed(".env.local")).toBe(true);
    expect(isConfigFileRestartSuppressed(".env")).toBe(true);

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_AUTO_TASK_TIME_ENABLED="false"');
    expect(envLocalContent).toContain('BELLDANDY_AUTO_TASK_TOKEN_ENABLED="false"');
  } finally {
    if (originalAutoTaskTime == null) delete process.env.BELLDANDY_AUTO_TASK_TIME_ENABLED;
    else process.env.BELLDANDY_AUTO_TASK_TIME_ENABLED = originalAutoTaskTime;
    if (originalAutoTaskToken == null) delete process.env.BELLDANDY_AUTO_TASK_TOKEN_ENABLED;
    else process.env.BELLDANDY_AUTO_TASK_TOKEN_ENABLED = originalAutoTaskToken;
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts channel settings and config.read redacts channel secrets", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), 'BELLDANDY_AUTH_MODE="token"\n', "utf-8");

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
      id: "config-update-channels",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_COMMUNITY_API_ENABLED: "false",
          BELLDANDY_COMMUNITY_API_TOKEN: "community-secret",
          BELLDANDY_FEISHU_APP_ID: "cli_test_app",
          BELLDANDY_FEISHU_APP_SECRET: "feishu-secret",
          BELLDANDY_FEISHU_AGENT_ID: "coder",
          BELLDANDY_QQ_APP_ID: "qq-app-id",
          BELLDANDY_QQ_APP_SECRET: "qq-secret",
          BELLDANDY_QQ_AGENT_ID: "researcher",
          BELLDANDY_QQ_SANDBOX: "false",
          BELLDANDY_EMAIL_SMTP_ENABLED: "true",
          BELLDANDY_EMAIL_IMAP_ENABLED: "false",
          BELLDANDY_DISCORD_ENABLED: "true",
          BELLDANDY_DISCORD_BOT_TOKEN: "discord-secret",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-channels"));

    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-channels");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-channels", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-channels"));

    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-channels");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_FEISHU_APP_ID).toBe("cli_test_app");
    expect(readRes.payload?.config?.BELLDANDY_FEISHU_AGENT_ID).toBe("coder");
    expect(readRes.payload?.config?.BELLDANDY_QQ_APP_ID).toBe("qq-app-id");
    expect(readRes.payload?.config?.BELLDANDY_QQ_SANDBOX).toBe("false");
    expect(readRes.payload?.config?.BELLDANDY_EMAIL_SMTP_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_EMAIL_IMAP_ENABLED).toBe("false");
    expect(readRes.payload?.config?.BELLDANDY_DISCORD_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_COMMUNITY_API_TOKEN).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_FEISHU_APP_SECRET).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_QQ_APP_SECRET).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_DISCORD_BOT_TOKEN).toBe("[REDACTED]");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_COMMUNITY_API_TOKEN="community-secret"');
    expect(envLocalContent).toContain('BELLDANDY_FEISHU_APP_SECRET="feishu-secret"');
    expect(envLocalContent).toContain('BELLDANDY_QQ_APP_SECRET="qq-secret"');
    expect(envLocalContent).toContain('BELLDANDY_DISCORD_BOT_TOKEN="discord-secret"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts advanced channel env settings and redacts email secrets", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), 'BELLDANDY_AUTH_MODE="token"\n', "utf-8");

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
      id: "config-update-channel-advanced",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
          BELLDANDY_EMAIL_DEFAULT_PROVIDER: "smtp",
          BELLDANDY_EMAIL_SMTP_ENABLED: "true",
          BELLDANDY_EMAIL_SMTP_ACCOUNT_ID: "default",
          BELLDANDY_EMAIL_SMTP_HOST: "smtp.example.com",
          BELLDANDY_EMAIL_SMTP_PORT: "587",
          BELLDANDY_EMAIL_SMTP_SECURE: "false",
          BELLDANDY_EMAIL_SMTP_USER: "mailer@example.com",
          BELLDANDY_EMAIL_SMTP_PASS: "smtp-app-pass",
          BELLDANDY_EMAIL_SMTP_FROM_ADDRESS: "mailer@example.com",
          BELLDANDY_EMAIL_SMTP_FROM_NAME: "Belldandy",
          BELLDANDY_EMAIL_INBOUND_AGENT_ID: "researcher",
          BELLDANDY_EMAIL_IMAP_ENABLED: "true",
          BELLDANDY_EMAIL_IMAP_ACCOUNT_ID: "mailbox-1",
          BELLDANDY_EMAIL_IMAP_HOST: "imap.example.com",
          BELLDANDY_EMAIL_IMAP_PORT: "993",
          BELLDANDY_EMAIL_IMAP_SECURE: "true",
          BELLDANDY_EMAIL_IMAP_USER: "reader@example.com",
          BELLDANDY_EMAIL_IMAP_PASS: "imap-app-pass",
          BELLDANDY_EMAIL_IMAP_MAILBOX: "INBOX",
          BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS: "60000",
          BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS: "10000",
          BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS: "20000",
          BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE: "latest",
          BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT: "50",
          BELLDANDY_CHANNEL_ROUTER_ENABLED: "true",
          BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH: "~/.star_sanctuary/channels-routing.json",
          BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID: "default",
          BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID: "123456789012345678",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-channel-advanced"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-channel-advanced");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-channel-advanced", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-channel-advanced"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-channel-advanced");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_EMAIL_DEFAULT_PROVIDER).toBe("smtp");
    expect(readRes.payload?.config?.BELLDANDY_EMAIL_SMTP_HOST).toBe("smtp.example.com");
    expect(readRes.payload?.config?.BELLDANDY_EMAIL_SMTP_PASS).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_EMAIL_IMAP_PASS).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_CHANNEL_ROUTER_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH).toBe("~/.star_sanctuary/channels-routing.json");
    expect(readRes.payload?.config?.BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID).toBe("123456789012345678");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_EMAIL_SMTP_PASS="smtp-app-pass"');
    expect(envLocalContent).toContain('BELLDANDY_EMAIL_IMAP_PASS="imap-app-pass"');
    expect(envLocalContent).toContain('BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID="default"');
    expect(envLocalContent).toContain('BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID="123456789012345678"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update accepts final cleanup prompt and multimedia env settings", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");

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
      id: "config-update-final-cleanup",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS: "methodology,context",
          BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES: "methodology:5,extra:150",
          BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS: "apply_patch,run_command",
          BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "48",
          BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "20",
          BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS: "10",
          BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS: "5",
          BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS: "7",
          BELLDANDY_COMPACTION_ENABLED: "true",
          BELLDANDY_COMPACTION_THRESHOLD: "20000",
          BELLDANDY_COMPACTION_KEEP_RECENT: "10",
          BELLDANDY_COMPACTION_TRIGGER_FRACTION: "0.75",
          BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD: "2000",
          BELLDANDY_COMPACTION_WARNING_THRESHOLD: "14000",
          BELLDANDY_COMPACTION_BLOCKING_THRESHOLD: "18000",
          BELLDANDY_COMPACTION_MAX_CONSECUTIVE_FAILURES: "3",
          BELLDANDY_COMPACTION_MAX_PTL_RETRIES: "2",
          BELLDANDY_COMPACTION_MODEL: "gpt-4o-mini",
          BELLDANDY_COMPACTION_BASE_URL: "https://compaction.example.com/v1",
          BELLDANDY_COMPACTION_API_KEY: "compaction-secret",
          BELLDANDY_DANGEROUS_TOOLS_ENABLED: "true",
          BELLDANDY_TOOLS_POLICY_FILE: "~/.star_sanctuary/tools-policy.json",
          BELLDANDY_SUB_AGENT_MAX_CONCURRENT: "3",
          BELLDANDY_SUB_AGENT_MAX_QUEUE_SIZE: "10",
          BELLDANDY_SUB_AGENT_TIMEOUT_MS: "120000",
          BELLDANDY_SUB_AGENT_MAX_DEPTH: "2",
          BELLDANDY_TTS_MODEL: "qwen3-tts-plus",
          BELLDANDY_IMAGE_ENABLED: "true",
          BELLDANDY_IMAGE_PROVIDER: "openai",
          BELLDANDY_IMAGE_OPENAI_API_KEY: "image-secret",
          BELLDANDY_IMAGE_OPENAI_BASE_URL: "https://api.openai.com/v1",
          BELLDANDY_IMAGE_MODEL: "gpt-image-2",
          BELLDANDY_IMAGE_OUTPUT_FORMAT: "png",
          BELLDANDY_IMAGE_TIMEOUT_MS: "60000",
          BELLDANDY_IMAGE_UNDERSTAND_ENABLED: "true",
          BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY: "vision-secret",
          BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL: "https://vision.example.com/v1",
          BELLDANDY_IMAGE_UNDERSTAND_MODEL: "gpt-4.1-mini",
          BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS: "45000",
          BELLDANDY_IMAGE_UNDERSTAND_AUTO_ON_ATTACHMENT: "false",
          BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND: "false",
          BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND: "true",
          BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND: "false",
          BELLDANDY_VIDEO_UNDERSTAND_ENABLED: "true",
          BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY: "video-secret",
          BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL: "https://video.example.com/v1",
          BELLDANDY_VIDEO_UNDERSTAND_MODEL: "kimi-k2.5",
          BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS: "90000",
          BELLDANDY_VIDEO_UNDERSTAND_FPS: "3",
          BELLDANDY_VIDEO_UNDERSTAND_AUTO_ON_ATTACHMENT: "true",
          BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS: "7",
          BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT: "1200",
          BELLDANDY_STT_PROVIDER: "groq",
          BELLDANDY_STT_MODEL: "whisper-large-v3",
          BELLDANDY_STT_LANGUAGE: "zh",
          BELLDANDY_STT_GROQ_API_KEY: "gsk-secret",
          BELLDANDY_STT_GROQ_BASE_URL: "https://api.groq.com/openai/v1",
          BELLDANDY_ROOM_INJECT_THRESHOLD: "10",
          BELLDANDY_ROOM_MEMBERS_CACHE_TTL: "300000",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-final-cleanup"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-final-cleanup");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({ type: "req", id: "config-read-final-cleanup", method: "config.read", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-final-cleanup"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-final-cleanup");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS).toBe("methodology,context");
    expect(readRes.payload?.config?.BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS).toBe("48");
    expect(readRes.payload?.config?.BELLDANDY_COMPACTION_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_COMPACTION_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_DANGEROUS_TOOLS_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_TTS_MODEL).toBe("qwen3-tts-plus");
    expect(readRes.payload?.config?.BELLDANDY_IMAGE_ENABLED).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_IMAGE_OPENAI_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND).toBe("false");
    expect(readRes.payload?.config?.BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND).toBe("true");
    expect(readRes.payload?.config?.BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND).toBe("false");
    expect(readRes.payload?.config?.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_VIDEO_UNDERSTAND_FPS).toBe("3");
    expect(readRes.payload?.config?.BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS).toBe("7");
    expect(readRes.payload?.config?.BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT).toBe("1200");
    expect(readRes.payload?.config?.BELLDANDY_STT_MODEL).toBe("whisper-large-v3");
    expect(readRes.payload?.config?.BELLDANDY_STT_GROQ_API_KEY).toBe("[REDACTED]");
    expect(readRes.payload?.config?.BELLDANDY_ROOM_MEMBERS_CACHE_TTL).toBe("300000");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_COMPACTION_API_KEY="compaction-secret"');
    expect(envLocalContent).toContain('BELLDANDY_DANGEROUS_TOOLS_ENABLED="true"');
    expect(envLocalContent).toContain('BELLDANDY_TTS_MODEL="qwen3-tts-plus"');
    expect(envLocalContent).toContain('BELLDANDY_IMAGE_OPENAI_API_KEY="image-secret"');
    expect(envLocalContent).toContain('BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY="vision-secret"');
    expect(envLocalContent).toContain('BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND="false"');
    expect(envLocalContent).toContain('BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND="true"');
    expect(envLocalContent).toContain('BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND="false"');
    expect(envLocalContent).toContain('BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY="video-secret"');
    expect(envLocalContent).toContain('BELLDANDY_VIDEO_UNDERSTAND_FPS="3"');
    expect(envLocalContent).toContain('BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS="7"');
    expect(envLocalContent).toContain('BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT="1200"');
    expect(envLocalContent).toContain('BELLDANDY_STT_MODEL="whisper-large-v3"');
    expect(envLocalContent).toContain('BELLDANDY_STT_GROQ_API_KEY="gsk-secret"');
    expect(envLocalContent).toContain('BELLDANDY_ROOM_INJECT_THRESHOLD="10"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update persists assistant external delivery preference", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), 'BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE="feishu,qq"\n', "utf-8");

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
      id: "config-update-assistant-delivery-preference",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: "community,discord",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-assistant-delivery-preference"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-assistant-delivery-preference");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({
      type: "req",
      id: "config-read-assistant-delivery-preference",
      method: "config.read",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-read-assistant-delivery-preference"));
    const readRes = frames.find((f) => f.type === "res" && f.id === "config-read-assistant-delivery-preference");
    expect(readRes.ok).toBe(true);
    expect(readRes.payload?.config?.BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE).toBe("community,discord");

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE="community,discord"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("config.update treats unchanged fields as no-op and still applies governance-only runtime update for full-form submissions", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-env-"));
  await fs.promises.writeFile(path.join(envDir, ".env"), "", "utf-8");
  await fs.promises.writeFile(
    path.join(envDir, ".env.local"),
    [
      'BELLDANDY_HOST="127.0.0.1"',
      'BELLDANDY_PORT="28889"',
      'BELLDANDY_GATEWAY_PORT="28889"',
      'BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE="compact"',
      "",
    ].join("\n"),
    "utf-8",
  );

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
      id: "config-update-governance-full-form",
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_HOST: "127.0.0.1",
          BELLDANDY_PORT: "28889",
          BELLDANDY_GATEWAY_PORT: "28889",
          BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: "full",
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "config-update-governance-full-form"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "config-update-governance-full-form");
    expect(updateRes.ok).toBe(true);
    expect(isConfigFileRestartSuppressed(".env.local")).toBe(true);

    const configJsRes = await fetch(`http://127.0.0.1:${server.port}/config.js`);
    expect(configJsRes.ok).toBe(true);
    const configJs = await configJsRes.text();
    expect(configJs).toContain('"governanceDetailMode": "full"');

    const envLocalContent = await fs.promises.readFile(path.join(envDir, ".env.local"), "utf-8");
    expect(envLocalContent).toContain('BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE="full"');
    expect(envLocalContent).toContain('BELLDANDY_HOST="127.0.0.1"');
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(envDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("channel.reply_chunking.get and update persist runtime chunk strategy config", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
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
      id: "channel-reply-chunking-update",
      method: "channel.reply_chunking.update",
      params: {
        content: JSON.stringify({
          channels: {
            discord: {
              textLimit: 1800,
              chunkMode: "newline",
            },
            community: {
              accounts: {
                alpha: {
                  textLimit: 900,
                  chunkMode: "length",
                },
              },
            },
          },
        }),
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "channel-reply-chunking-update"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "channel-reply-chunking-update");
    expect(updateRes.ok).toBe(true);

    ws.send(JSON.stringify({
      type: "req",
      id: "channel-reply-chunking-get",
      method: "channel.reply_chunking.get",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "channel-reply-chunking-get"));
    const getRes = frames.find((f) => f.type === "res" && f.id === "channel-reply-chunking-get");
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.config).toEqual({
      version: 1,
      channels: {
        discord: {
          textLimit: 1800,
          chunkMode: "newline",
        },
        community: {
          accounts: {
            alpha: {
              textLimit: 900,
              chunkMode: "length",
            },
          },
        },
      },
    });

    const stored = JSON.parse(
      await fs.promises.readFile(path.join(stateDir, "channel-reply-chunking.json"), "utf-8"),
    );
    expect(stored).toEqual(getRes.payload?.config);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
