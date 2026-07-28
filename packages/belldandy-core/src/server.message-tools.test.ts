import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { type BelldandyAgent, ConversationStore } from "@belldandy/agent";
import { PluginRegistry } from "@belldandy/plugins";
import {
  SkillRegistry,
  ToolExecutor,
  createToolSettingsControlTool,
  planCurrentGetTool,
  planCurrentUpdateTool,
  TOOL_SETTINGS_CONTROL_NAME,
  withToolContract,
} from "@belldandy/skills";

import { upsertInstalledExtension } from "./extension-marketplace-state.js";
import type { ExtensionHostState } from "./extension-host.js";
import { buildExtensionRuntimeReport } from "./extension-runtime.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  createContractedTestTool,
  createTestTool,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";
import { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import { ToolsConfigManager } from "./tools-config.js";

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

test("message.send hides tool control confirm password from agent input and applies confirmed change", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const confirmationStore = new ToolControlConfirmationStore();
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  let toolExecutor!: ToolExecutor;
  let server!: Awaited<ReturnType<typeof startGatewayServer>>;
  const seenInputs: Array<{ text: string; userInput?: string; history: Array<{ role: string; content: string }> }> = [];

  toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
      createToolSettingsControlTool({
        toolsConfigManager,
        getControlMode: () => "confirm",
        getHasConfirmPassword: () => true,
        listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
        confirmationStore,
      }),
    ],
    workspaceRoot: process.cwd(),
    alwaysEnabledTools: [TOOL_SETTINGS_CONTROL_NAME],
    broadcast: (event, payload) => {
      server?.broadcast({ type: "event", event, payload });
    },
  });

  const conversationId = "conv-tool-confirm-password";
  confirmationStore.create({
    requestId: "PW123",
    conversationId,
    requestedByAgentId: "default",
    changes: {
      enableBuiltin: [],
      disableBuiltin: ["alpha_builtin"],
      enableMcpServers: [],
      disableMcpServers: [],
      enablePlugins: [],
      disablePlugins: [],
    },
  });

  const agent: BelldandyAgent = {
    async *run(input) {
      seenInputs.push({
        text: input.text,
        userInput: input.userInput,
        history: (input.history ?? []).map((item) => ({
          role: item.role,
          content: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
        })),
      });
      yield { type: "status", status: "running" as const };
      const request = {
        id: "tool-call-confirm-password",
        name: TOOL_SETTINGS_CONTROL_NAME,
        arguments: {
          action: "confirm",
          requestId: "PW123",
        },
      };
      yield {
        type: "tool_call" as const,
        id: request.id,
        name: request.name,
        arguments: request.arguments,
      };
      const result = await toolExecutor.execute(request, input.conversationId, input.agentId, input.userUuid, input.senderInfo, input.roomContext);
      yield {
        type: "tool_result" as const,
        id: result.id,
        name: result.name,
        success: result.success,
        output: result.output,
        error: result.error,
      };
      yield { type: "final" as const, text: input.text };
      yield { type: "status", status: "done" as const };
    },
  };

  server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    toolsConfigManager,
    toolExecutor,
    toolControlConfirmationStore: confirmationStore,
    getAgentToolControlMode: () => "confirm",
    getAgentToolControlConfirmPassword: () => "星河123",
    agentFactory: () => agent,
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
      id: "confirm-password-message",
      method: "message.send",
      params: {
        text: "星河123",
        conversationId,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "confirm-password-message" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_result"));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    const toolResultEvent = frames.find((f) => f.type === "event" && f.event === "tool_result");
    expect(toolResultEvent?.payload?.success).toBe(true);
    expect(String(toolResultEvent?.payload?.output ?? "")).not.toContain("星河123");
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0].text).toBe("【已提交工具开关确认口令】");
    expect(seenInputs[0].userInput).toBe("【已提交工具开关确认口令】");
    expect(seenInputs[0].history.some((item) => item.content.includes("星河123"))).toBe(false);
    expect(toolsConfigManager.getConfig().disabled.builtin).toEqual(["alpha_builtin"]);

    const storedHistory = conversationStore.getHistory(conversationId);
    expect(storedHistory.some((item) => item.content === "星河123")).toBe(false);
    expect(storedHistory.some((item) => item.content === "【已提交工具开关确认口令】")).toBe(true);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send emits webchat confirm event and tool_settings.confirm approves without chat prompt noise", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const confirmationStore = new ToolControlConfirmationStore();
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  let toolExecutor!: ToolExecutor;
  let server!: Awaited<ReturnType<typeof startGatewayServer>>;

  toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
      createToolSettingsControlTool({
        toolsConfigManager,
        getControlMode: () => "confirm",
        getHasConfirmPassword: () => true,
        listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
        confirmationStore,
      }),
    ],
    workspaceRoot: process.cwd(),
    alwaysEnabledTools: [TOOL_SETTINGS_CONTROL_NAME],
    broadcast: (event, payload) => {
      server?.broadcast({ type: "event", event, payload });
    },
  });

  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "status", status: "running" as const };
      const request = {
        id: "tool-call-webchat-confirm",
        name: TOOL_SETTINGS_CONTROL_NAME,
        arguments: {
          action: "apply",
          disableBuiltin: ["alpha_builtin"],
        },
      };
      yield {
        type: "tool_call" as const,
        id: request.id,
        name: request.name,
        arguments: request.arguments,
      };
      const result = await toolExecutor.execute(request, input.conversationId, input.agentId, input.userUuid, input.senderInfo, input.roomContext);
      yield {
        type: "tool_result" as const,
        id: result.id,
        name: result.name,
        success: result.success,
        output: result.output,
        error: result.error,
      };
      yield { type: "final" as const, text: "收到" };
      yield { type: "status", status: "done" as const };
    },
  };

  server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    toolsConfigManager,
    toolExecutor,
    toolControlConfirmationStore: confirmationStore,
    getAgentToolControlMode: () => "confirm",
    getAgentToolControlConfirmPassword: () => "星河123",
    agentFactory: () => agent,
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
      id: "message-send-webchat-confirm",
      method: "message.send",
      params: {
        text: "请关闭 alpha_builtin",
        conversationId: "conv-webchat-confirm",
        from: "web",
        roomContext: {
          environment: "local",
        },
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-webchat-confirm" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_result"));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_settings.confirm.required"));

    const toolResultEvent = frames.find((f) => f.type === "event" && f.event === "tool_result");
    expect(toolResultEvent?.payload?.success).toBe(true);
    expect(String(toolResultEvent?.payload?.output ?? "")).toContain("WebChat 页面确认窗口");
    expect(String(toolResultEvent?.payload?.output ?? "")).not.toContain("批准工具设置变更");

    const requiredEvent = frames.find((f) => f.type === "event" && f.event === "tool_settings.confirm.required");
    expect(requiredEvent?.payload?.conversationId).toBe("conv-webchat-confirm");
    expect(requiredEvent?.payload?.summary).toEqual(["关闭 builtin: alpha_builtin"]);
    expect(String(requiredEvent?.payload?.targetClientId ?? "").length).toBeGreaterThan(0);

    const requestId = String(requiredEvent?.payload?.requestId ?? "");
    ws.send(JSON.stringify({
      type: "req",
      id: "approve-webchat-confirm",
      method: "tool_settings.confirm",
      params: {
        requestId,
        conversationId: "conv-webchat-confirm",
        decision: "approve",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "approve-webchat-confirm" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tools.config.updated"));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_settings.confirm.resolved"));

    expect(toolsConfigManager.getConfig().disabled.builtin).toEqual(["alpha_builtin"]);
    expect(confirmationStore.get(requestId)).toBeUndefined();

    const resolvedEvent = frames.find((f) => f.type === "event" && f.event === "tool_settings.confirm.resolved");
    expect(resolvedEvent?.payload?.decision).toBe("approved");

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-tool-confirm-trace", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-tool-confirm-trace"));
    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-tool-confirm-trace");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const confirmTrace = traces.find((item: any) => item.traceId === "approve-webchat-confirm");
    expect(confirmTrace).toMatchObject({
      method: "tool_settings.confirm",
      status: "completed",
      conversationId: "conv-webchat-confirm",
    });
    expect(confirmTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "request_validated",
      "tool_settings_updated",
      "tool_event_emitted",
      "completed",
    ]));

    const storedHistory = conversationStore.getHistory("conv-webchat-confirm");
    expect(storedHistory.some((item) => item.content.includes("批准工具设置变更"))).toBe(false);
    expect(storedHistory.some((item) => item.content.includes("请在页面确认窗口中处理"))).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list hides tool_settings_control from builtin tools", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const confirmationStore = new ToolControlConfirmationStore();
  let toolExecutor!: ToolExecutor;
  toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
      createTestTool("mcp_demo_ping"),
      createToolSettingsControlTool({
        toolsConfigManager,
        getControlMode: () => "auto",
        listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
        confirmationStore,
      }),
    ],
    workspaceRoot: process.cwd(),
    alwaysEnabledTools: [TOOL_SETTINGS_CONTROL_NAME],
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "tools-list-hidden-control", method: "tools.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-hidden-control"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-hidden-control");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.builtin).toContain("alpha_builtin");
    expect(listRes.payload?.builtin).not.toContain(TOOL_SETTINGS_CONTROL_NAME);
    expect(listRes.payload?.mcp).toEqual({
      demo: {
        tools: ["mcp_demo_ping"],
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list exposes workflow runtime capability when run_workflow is unavailable", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
    ],
    workspaceRoot: process.cwd(),
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "tools-list-workflow-capability", method: "tools.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-workflow-capability"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-workflow-capability");

    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.runtimeCapabilities?.workflow).toEqual({
      toolName: "run_workflow",
      runtimeAvailable: false,
      registered: false,
      reasonCode: "runtime_unavailable",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list returns contract summaries for contract-aware tools", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const toolExecutor = new ToolExecutor({
    tools: [
      createContractedTestTool("alpha_builtin"),
      createTestTool("beta_builtin"),
    ],
    workspaceRoot: process.cwd(),
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "tools-list-contracts", method: "tools.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-contracts"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-contracts");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.builtin).toEqual(["alpha_builtin", "beta_builtin"]);
    expect(listRes.payload?.contracts?.alpha_builtin).toMatchObject({
      family: "other",
      riskLevel: "low",
      channels: ["gateway"],
      safeScopes: ["local-safe"],
      needsPermission: false,
      isReadOnly: true,
      isConcurrencySafe: true,
    });
    expect(listRes.payload?.visibility?.alpha_builtin).toMatchObject({
      available: true,
      reasonCode: "available",
    });
    expect(listRes.payload?.toolControl).toMatchObject({
      mode: "disabled",
      requiresConfirmation: false,
    });
    expect(listRes.payload?.contracts?.beta_builtin).toBeUndefined();
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list exposes tool behavior contract observability for visible tools", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const toolExecutor = new ToolExecutor({
    tools: [
      createContractedTestTool("run_command"),
      createContractedTestTool("apply_patch"),
      createContractedTestTool("delegate_task"),
      createTestTool("beta_builtin"),
    ],
    workspaceRoot: process.cwd(),
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "tools-list-behavior-contracts", method: "tools.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-behavior-contracts"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-behavior-contracts");

    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.toolBehaviorObservability).toMatchObject({
      counts: {
        includedContractCount: 3,
      },
      included: [
        "run_command",
        "apply_patch",
        "delegate_task",
      ],
    });
    expect(listRes.payload?.toolBehaviorObservability?.contracts?.run_command).toMatchObject({
      useWhen: expect.any(Array),
      preflightChecks: expect.any(Array),
    });
    expect(listRes.payload?.toolBehaviorObservability?.summary).toContain("## run_command");
    expect(listRes.payload?.toolBehaviorObservability?.summary).toContain("## apply_patch");
    expect(listRes.payload?.toolBehaviorObservability?.summary).toContain("## delegate_task");
    expect(listRes.payload?.toolBehaviorObservability?.contracts?.beta_builtin).toBeUndefined();
    expect(listRes.payload?.toolContractV2Observability).toMatchObject({
      counts: {
        totalCount: 3,
        missingV2Count: 1,
      },
    });
    expect(listRes.payload?.toolContractV2Observability?.contracts?.run_command).toMatchObject({
      family: "other",
      recommendedWhen: expect.any(Array),
      confirmWhen: expect.any(Array),
    });
    expect(listRes.payload?.toolContractsIncluded).toBeUndefined();
    expect(listRes.payload?.toolBehaviorContracts).toBeUndefined();
    expect(listRes.payload?.toolContractSummary).toBeUndefined();
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list exposes visibility reasons for selected agent and conversation", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  await toolsConfigManager.updateConfig({
    mcp_servers: ["demo"],
    plugins: ["demo-plugin"],
    skills: ["disabled-skill"],
  });
  const confirmationStore = new ToolControlConfirmationStore();
  confirmationStore.create({
    requestId: "ABCDE",
    conversationId: "conv-visibility",
    changes: {
      enableBuiltin: [],
      disableBuiltin: ["alpha_builtin"],
      enableMcpServers: [],
      disableMcpServers: [],
      enablePlugins: [],
      disablePlugins: [],
    },
  });

  const goalTool = withToolContract(createTestTool("goal_init"), {
    family: "other",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway"],
    safeScopes: ["local-safe"],
    activityDescription: "goal tool",
    resultSchema: {
      kind: "text",
      description: "test tool output",
    },
    outputPersistencePolicy: "conversation",
  });

  const toolExecutor = new ToolExecutor({
    tools: [
      createContractedTestTool("alpha_builtin"),
      createContractedTestTool("beta_builtin"),
      goalTool,
      createTestTool("mcp_demo_ping"),
    ],
    workspaceRoot: process.cwd(),
    contractAccessPolicy: {
      channel: "gateway",
      allowedSafeScopes: ["local-safe"],
      blockedToolNames: ["beta_builtin"],
    },
    isToolAllowedForAgent: (toolName, agentId) => agentId !== "restricted" || toolName === "goal_init",
    isToolAllowedInConversation: (toolName, conversationId) => toolName !== "goal_init" || conversationId.startsWith("goal:"),
  });
  const pluginRegistry = new PluginRegistry();
  ((pluginRegistry as any).plugins).set("demo-plugin", {
    id: "demo-plugin",
    name: "Demo Plugin",
    activate: async () => {},
  });
  ((pluginRegistry as any).pluginToolMap).set("demo-plugin", ["plugin_demo_tool"]);
  const skillRegistry = new SkillRegistry();
  ((skillRegistry as any).skills).set("bundled:available-skill", {
    name: "available-skill",
    description: "available skill",
    instructions: "available",
    source: { type: "bundled" },
    priority: "normal",
    tags: ["ops"],
  });
  ((skillRegistry as any).skills).set("bundled:disabled-skill", {
    name: "disabled-skill",
    description: "disabled skill",
    instructions: "disabled",
    source: { type: "bundled" },
    priority: "high",
    tags: ["blocked"],
  });
  ((skillRegistry as any).skills).set("bundled:ineligible-skill", {
    name: "ineligible-skill",
    description: "ineligible skill",
    instructions: "ineligible",
    source: { type: "bundled" },
    priority: "low",
    tags: ["needs-env"],
  });
  ((skillRegistry as any).eligibilityCache).set("available-skill", { eligible: true, reasons: [] });
  ((skillRegistry as any).eligibilityCache).set("disabled-skill", { eligible: true, reasons: [] });
  ((skillRegistry as any).eligibilityCache).set("ineligible-skill", { eligible: false, reasons: ["missing env: DEMO_TOKEN"] });
  await upsertInstalledExtension(stateDir, {
    name: "demo-plugin",
    kind: "plugin",
    marketplace: "official-market",
    installPath: path.join(stateDir, "extensions", "installed", "official-market", "demo-plugin"),
    status: "installed",
    enabled: true,
  });
  await upsertInstalledExtension(stateDir, {
    name: "ops-skills",
    kind: "skill-pack",
    marketplace: "official-market",
    installPath: path.join(stateDir, "extensions", "installed", "official-market", "ops-skills"),
    status: "pending",
    enabled: false,
  });
  const extensionHost: Pick<ExtensionHostState, "extensionRuntime" | "lifecycle"> = {
    extensionRuntime: buildExtensionRuntimeReport({
      pluginRegistry,
      skillRegistry,
      toolsConfigManager,
    }),
    lifecycle: {
      pluginToolsRegistered: 1,
      skillManagementToolsRegistered: ["skills_list", "skills_search", "skill_get"],
      bundledSkillsLoaded: 3,
      userSkillsLoaded: 0,
      pluginSkillsLoaded: 0,
      installedMarketplaceExtensionsLoaded: 1,
      installedMarketplacePluginsLoaded: 1,
      installedMarketplaceSkillPacksLoaded: 0,
      eligibilityRefreshed: true,
      loadCompletedAt: new Date("2026-04-02T13:10:00.000Z"),
      hookBridge: {
        source: "plugin-bridge",
        availableHookCount: 0,
        bridgedHookCount: 0,
        registrations: [
          {
            legacyHookName: "beforeRun",
            hookName: "before_agent_start",
            available: false,
            bridged: false,
          },
          {
            legacyHookName: "afterRun",
            hookName: "agent_end",
            available: false,
            bridged: false,
          },
          {
            legacyHookName: "beforeToolCall",
            hookName: "before_tool_call",
            available: false,
            bridged: false,
          },
          {
            legacyHookName: "afterToolCall",
            hookName: "after_tool_call",
            available: false,
            bridged: false,
          },
        ],
      },
    },
  };

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
    toolControlConfirmationStore: confirmationStore,
    getAgentToolControlMode: () => "confirm",
    getAgentToolControlConfirmPassword: () => "",
    pluginRegistry,
    extensionHost,
    skillRegistry,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "tools-list-visibility",
      method: "tools.list",
      params: {
        agentId: "restricted",
        conversationId: "conv-visibility",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-visibility"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-visibility");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.visibilityContext).toMatchObject({
      agentId: "restricted",
      conversationId: "conv-visibility",
      launchExplainability: expect.objectContaining({
        effectiveLaunch: expect.objectContaining({
          source: "catalog_default",
          agentId: "restricted",
        }),
      }),
    });
    expect(listRes.payload?.visibility?.alpha_builtin).toMatchObject({
      available: false,
      reasonCode: "not-in-agent-whitelist",
    });
    expect(listRes.payload?.visibility?.beta_builtin).toMatchObject({
      available: false,
      reasonCode: "blocked-by-security-matrix",
      contractReason: "blocked",
    });
    expect(listRes.payload?.visibility?.goal_init).toMatchObject({
      available: false,
      reasonCode: "conversation-restricted",
    });
    expect(listRes.payload?.mcpVisibility?.demo).toMatchObject({
      available: false,
      reasonCode: "disabled-by-settings",
    });
    expect(listRes.payload?.pluginVisibility?.["demo-plugin"]).toMatchObject({
      available: false,
      reasonCode: "disabled-by-settings",
    });
    expect(listRes.payload?.skillVisibility?.["available-skill"]).toMatchObject({
      available: true,
      reasonCode: "available",
      eligible: true,
    });
    expect(listRes.payload?.skillVisibility?.["disabled-skill"]).toMatchObject({
      available: false,
      reasonCode: "disabled-by-settings",
      eligible: true,
    });
    expect(listRes.payload?.skillVisibility?.["ineligible-skill"]).toMatchObject({
      available: false,
      reasonCode: "not-eligible",
      eligible: false,
      eligibilityReasons: ["missing env: DEMO_TOKEN"],
    });
    expect(listRes.payload?.extensions?.summary).toEqual({
      pluginCount: 1,
      disabledPluginCount: 1,
      pluginToolCount: 1,
      pluginLoadErrorCount: 0,
      pluginHookMetricCount: 0,
      pluginHookFailureCount: 0,
      skillCount: 3,
      disabledSkillCount: 1,
      ineligibleSkillCount: 1,
      promptSkillCount: 0,
      searchableSkillCount: 1,
    });
    expect(listRes.payload?.extensions?.plugins).toEqual([
      expect.objectContaining({
        id: "demo-plugin",
        disabled: true,
        toolNames: ["plugin_demo_tool"],
      }),
    ]);
    expect(listRes.payload?.extensions?.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "available-skill",
        source: "bundled",
        disabled: false,
        eligible: true,
      }),
      expect.objectContaining({
        name: "disabled-skill",
        disabled: true,
        eligible: true,
      }),
      expect.objectContaining({
        name: "ineligible-skill",
        disabled: false,
        eligible: false,
        eligibilityReasons: ["missing env: DEMO_TOKEN"],
      }),
    ]));
    expect(listRes.payload?.extensions?.registry).toEqual({
      pluginToolRegistrations: [
        {
          pluginId: "demo-plugin",
          toolNames: ["plugin_demo_tool"],
          disabled: true,
        },
      ],
      skillManagementTools: [
        { name: "skills_list", shouldRegister: true, reasonCode: "available" },
        { name: "skills_search", shouldRegister: true, reasonCode: "available" },
        { name: "skill_get", shouldRegister: true, reasonCode: "available" },
      ],
      promptSkillNames: [],
      searchableSkillNames: ["available-skill"],
    });
    expect(listRes.payload?.extensionGovernance?.summary).toEqual({
      installedExtensionCount: 2,
      installedEnabledExtensionCount: 1,
      installedDisabledExtensionCount: 1,
      installedBrokenExtensionCount: 0,
      loadedMarketplaceExtensionCount: 1,
      loadedMarketplacePluginCount: 1,
      loadedMarketplaceSkillPackCount: 0,
      runtimePolicyDisabledPluginCount: 1,
      runtimePolicyDisabledSkillCount: 1,
    });
    expect(listRes.payload?.extensionGovernance?.layers).toMatchObject({
      installedLedger: {
        enabledExtensionIds: ["demo-plugin@official-market"],
        disabledExtensionIds: ["ops-skills@official-market"],
      },
      hostLoad: {
        lifecycleAvailable: true,
        loadedMarketplaceExtensionCount: 1,
      },
      runtimePolicy: {
        disabledPluginIds: ["demo-plugin"],
        disabledSkillNames: ["disabled-skill"],
      },
    });
    expect(listRes.payload?.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "available-skill",
        eligible: true,
      }),
      expect.objectContaining({
        name: "disabled-skill",
        eligible: true,
      }),
      expect.objectContaining({
        name: "ineligible-skill",
        eligible: false,
        eligibilityReasons: ["missing env: DEMO_TOKEN"],
      }),
    ]));
    expect(listRes.payload?.toolControl).toMatchObject({
      mode: "confirm",
      requiresConfirmation: true,
      hasConfirmPassword: false,
    });
    expect(listRes.payload?.toolControl?.pendingRequest).toMatchObject({
      requestId: "ABCDE",
      conversationId: "conv-visibility",
      summary: ["关闭 builtin: alpha_builtin"],
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list returns published methods inventory for tool settings", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  await fs.promises.mkdir(path.join(stateDir, "methods"), { recursive: true });
  await fs.promises.writeFile(
    path.join(stateDir, "methods", "网页自动化基础.md"),
    [
      "---",
      'summary: "用于处理网页自动化的基础 SOP"',
      'status: "published"',
      "---",
      "",
      "# 网页自动化基础",
      "",
      "## 适用场景",
      "处理网页自动化任务。",
    ].join("\n"),
    "utf-8",
  );

  const toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
    ],
    workspaceRoot: process.cwd(),
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "tools-list-methods", method: "tools.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-methods"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-methods");

    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.methods).toEqual([
      expect.objectContaining({
        filename: "网页自动化基础.md",
        title: "网页自动化基础",
        summary: "用于处理网页自动化的基础 SOP",
        status: "published",
        path: "methods/网页自动化基础.md",
      }),
    ]);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list and conversation.meta expose loaded deferred tools from executor session state", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  const toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
      createTestTool("alpha_deferred"),
    ],
    workspaceRoot: process.cwd(),
    deferredToolNames: ["alpha_deferred"],
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    toolsConfigManager,
    toolExecutor,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;

    await toolExecutor.loadDeferredTools("conv-loaded-tools", ["alpha_deferred"]);

    ws.send(JSON.stringify({
      type: "req",
      id: "tools-list-loaded-tools",
      method: "tools.list",
      params: {
        conversationId: "conv-loaded-tools",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-loaded-tools"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-loaded-tools");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.visibilityContext).toMatchObject({
      conversationId: "conv-loaded-tools",
      loadedDeferredTools: ["alpha_deferred"],
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "conversation-meta-loaded-tools",
      method: "conversation.meta",
      params: {
        conversationId: "conv-loaded-tools",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "conversation-meta-loaded-tools"));
    const metaRes = frames.find((f) => f.type === "res" && f.id === "conversation-meta-loaded-tools");
    expect(metaRes.ok).toBe(true);
    expect(metaRes.payload?.loadedDeferredTools).toEqual(["alpha_deferred"]);
    expect(metaRes.payload?.continuationState).toMatchObject({
      version: 1,
      scope: "conversation",
      targetId: "conv-loaded-tools",
      resumeMode: "conversation_context",
      checkpoints: {
        labels: ["tool:alpha_deferred"],
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.update ignores tool_settings_control in disabled builtin list", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const confirmationStore = new ToolControlConfirmationStore();
  let toolExecutor!: ToolExecutor;
  toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
      createToolSettingsControlTool({
        toolsConfigManager,
        getControlMode: () => "auto",
        listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
        confirmationStore,
      }),
    ],
    workspaceRoot: process.cwd(),
    alwaysEnabledTools: [TOOL_SETTINGS_CONTROL_NAME],
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "tools-update-filter-control",
      method: "tools.update",
      params: {
        disabled: {
          builtin: [TOOL_SETTINGS_CONTROL_NAME, "alpha_builtin"],
        },
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-update-filter-control"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "tools-update-filter-control");
    expect(updateRes.ok).toBe(true);
    expect(toolsConfigManager.getConfig().disabled.builtin).toEqual(["alpha_builtin"]);

    ws.send(JSON.stringify({ type: "req", id: "tools-list-filter-control", method: "tools.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-filter-control"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-filter-control");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.disabled?.builtin).toEqual(["alpha_builtin"]);
    expect(listRes.payload?.disabled?.builtin).not.toContain(TOOL_SETTINGS_CONTROL_NAME);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send emits conversation.plan.updated when agent updates current plan state", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  let toolExecutor!: ToolExecutor;
  let server!: Awaited<ReturnType<typeof startGatewayServer>>;

  toolExecutor = new ToolExecutor({
    tools: [
      planCurrentGetTool,
      planCurrentUpdateTool,
    ],
    workspaceRoot: process.cwd(),
    conversationStore,
  });

  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "status", status: "running" as const };
      const request = {
        id: "tool-call-plan-update",
        name: "plan_current_update",
        arguments: {
          ifAbsent: "create",
          seed: {
            title: "Phase A",
            status: "active",
            mode: "agent",
          },
          operations: [
            {
              type: "set_focus",
              nextAction: "先落会话真源",
            },
            {
              type: "upsert_step",
              step: {
                id: "store",
                title: "补 store 接线",
                status: "in_progress",
              },
            },
          ],
        },
      };
      yield {
        type: "tool_call" as const,
        id: request.id,
        name: request.name,
        arguments: request.arguments,
      };
      const result = await toolExecutor.execute(request, input.conversationId, input.agentId, input.userUuid, input.senderInfo, input.roomContext);
      yield {
        type: "tool_result" as const,
        id: result.id,
        name: result.name,
        success: result.success,
        output: result.output,
        error: result.error,
        metadata: result.metadata,
      };
      yield { type: "final" as const, text: "计划已更新" };
      yield { type: "status", status: "done" as const };
    },
  };

  server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    toolExecutor,
    agentFactory: () => agent,
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
      id: "message-send-plan-update",
      method: "message.send",
      params: {
        text: "请更新当前计划",
        conversationId: "conv-plan-update-event",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-plan-update" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "conversation.plan.updated"));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_result"));

    const planEvent = frames.find((f) => f.type === "event" && f.event === "conversation.plan.updated");
    expect(planEvent?.payload).toMatchObject({
      conversationId: "conv-plan-update-event",
      source: "tool",
      cleared: false,
      planLifecycle: {
        action: "created",
        enteredPlanMode: true,
        switchedCurrentPlan: false,
      },
      planState: {
        title: "Phase A",
        status: "active",
        nextAction: "先落会话真源",
        steps: [{
          id: "store",
          title: "补 store 接线",
          status: "in_progress",
        }],
      },
    });

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-plan-update-trace", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-plan-update-trace"));
    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-plan-update-trace");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const runtimeTrace = traces.find((item: any) => item.traceId === "message-send-plan-update");
    const toolResultStage = runtimeTrace?.stages?.find((item: any) => item.stage === "tool_result_emitted");
    expect(toolResultStage?.detail).toMatchObject({
      toolName: "plan_current_update",
      success: true,
      planLifecycleAction: "created",
      enteredPlanMode: true,
      switchedCurrentPlan: false,
      planStatus: "active",
      planOperationTypes: "set_focus, upsert_step",
    });

    const storedPlan = conversationStore.getPlanState("conv-plan-update-event");
    expect(storedPlan).toMatchObject({
      title: "Phase A",
      steps: [{
        id: "store",
        title: "补 store 接线",
        status: "in_progress",
      }],
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send exposes current plan replacement lifecycle in doctor trace", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  conversationStore.updatePlanState("conv-plan-replace-event", {
    ifAbsent: "create",
    seed: {
      title: "旧计划",
      status: "active",
      mode: "agent",
    },
    operations: [{
      type: "upsert_step",
      step: {
        id: "old-step",
        title: "旧步骤",
        status: "in_progress",
      },
    }],
    updatedBy: "agent",
  });
  const previousPlan = conversationStore.getPlanState("conv-plan-replace-event");
  let toolExecutor!: ToolExecutor;
  let server!: Awaited<ReturnType<typeof startGatewayServer>>;

  toolExecutor = new ToolExecutor({
    tools: [
      planCurrentGetTool,
      planCurrentUpdateTool,
    ],
    workspaceRoot: process.cwd(),
    conversationStore,
  });

  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "status", status: "running" as const };
      const request = {
        id: "tool-call-plan-replace",
        name: "plan_current_update",
        arguments: {
          operations: [
            {
              type: "replace",
              plan: {
                version: 1,
                planId: "plan-replaced",
                status: "active",
                title: "新计划",
                mode: "agent",
                currentStepId: "new-step",
                nextAction: "进入新计划",
                steps: [
                  {
                    id: "new-step",
                    title: "新步骤",
                    status: "pending",
                  },
                ],
              },
            },
          ],
        },
      };
      yield {
        type: "tool_call" as const,
        id: request.id,
        name: request.name,
        arguments: request.arguments,
      };
      const result = await toolExecutor.execute(request, input.conversationId, input.agentId, input.userUuid, input.senderInfo, input.roomContext);
      yield {
        type: "tool_result" as const,
        id: result.id,
        name: result.name,
        success: result.success,
        output: result.output,
        error: result.error,
        metadata: result.metadata,
      };
      yield { type: "final" as const, text: "计划已替换" };
      yield { type: "status", status: "done" as const };
    },
  };

  server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    toolExecutor,
    agentFactory: () => agent,
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
      id: "message-send-plan-replace",
      method: "message.send",
      params: {
        text: "请替换当前计划",
        conversationId: "conv-plan-replace-event",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-plan-replace" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "conversation.plan.updated"));

    const planEvent = frames.find((f) => f.type === "event" && f.event === "conversation.plan.updated");
    expect(planEvent?.payload).toMatchObject({
      conversationId: "conv-plan-replace-event",
      cleared: false,
      planLifecycle: {
        action: "replaced",
        hadExistingPlan: true,
        enteredPlanMode: false,
        switchedCurrentPlan: true,
        previousPlanId: previousPlan?.planId,
        planId: "plan-replaced",
      },
    });

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-plan-replace-trace", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-plan-replace-trace"));
    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-plan-replace-trace");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const runtimeTrace = traces.find((item: any) => item.traceId === "message-send-plan-replace");
    const toolResultStage = runtimeTrace?.stages?.find((item: any) => item.stage === "tool_result_emitted");
    expect(toolResultStage?.detail).toMatchObject({
      toolName: "plan_current_update",
      success: true,
      planLifecycleAction: "replaced",
      enteredPlanMode: false,
      switchedCurrentPlan: true,
      previousPlanId: previousPlan?.planId,
      planId: "plan-replaced",
      planOperationTypes: "replace",
    });

    const storedPlan = conversationStore.getPlanState("conv-plan-replace-event");
    expect(storedPlan).toMatchObject({
      planId: "plan-replaced",
      title: "新计划",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send emits tools.config.updated when agent changes tool settings", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const confirmationStore = new ToolControlConfirmationStore();
  let toolExecutor!: ToolExecutor;
  let gatewayServer!: Awaited<ReturnType<typeof startGatewayServer>>;

  toolExecutor = new ToolExecutor({
    tools: [
      createTestTool("alpha_builtin"),
      createToolSettingsControlTool({
        toolsConfigManager,
        getControlMode: () => "auto",
        listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
        confirmationStore,
      }),
    ],
    workspaceRoot: process.cwd(),
    alwaysEnabledTools: [TOOL_SETTINGS_CONTROL_NAME],
  });

  const agent: BelldandyAgent = {
    async *run(input) {
      yield { type: "status", status: "running" as const };
      const request = {
        id: "tool-call-1",
        name: TOOL_SETTINGS_CONTROL_NAME,
        arguments: {
          action: "apply",
          disableBuiltin: ["alpha_builtin"],
        },
      };
      yield {
        type: "tool_call" as const,
        id: request.id,
        name: request.name,
        arguments: request.arguments,
      };
      const result = await toolExecutor.execute(request, input.conversationId, input.agentId, input.userUuid, input.senderInfo, input.roomContext);
      yield {
        type: "tool_result" as const,
        id: result.id,
        name: result.name,
        success: result.success,
        output: result.output,
        error: result.error,
      };
      yield {
        type: "usage" as const,
        systemPromptTokens: 1,
        contextTokens: 2,
        inputTokens: 3,
        outputTokens: 4,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        modelCalls: 1,
      };
      yield { type: "final", text: "tool settings updated" };
      yield { type: "status", status: "done" as const };
    },
  };

  gatewayServer = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
    agentFactory: () => agent,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${gatewayServer.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "message-send-tool-settings-update",
      method: "message.send",
      params: {
        text: "please update tool settings",
        conversationId: "conv-tool-settings-update",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-tool-settings-update" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_result"));
    const toolResultEvent = frames.find((f) => f.type === "event" && f.event === "tool_result");
    expect(toolResultEvent?.payload?.success).toBe(true);
    expect(toolsConfigManager.getConfig().disabled.builtin).toEqual(["alpha_builtin"]);
    await waitFor(
      () => frames.some((f) => f.type === "event" && f.event === "tools.config.updated"),
      1000,
    );
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    const configUpdatedEvent = frames.find((f) => f.type === "event" && f.event === "tools.config.updated");
    expect(configUpdatedEvent?.payload).toEqual({
      source: "agent",
      mode: "auto",
      disabled: {
        builtin: ["alpha_builtin"],
        mcp_servers: [],
        plugins: [],
        skills: [],
      },
    });

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-tool-side-effects", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-tool-side-effects"));
    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-tool-side-effects");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const runtimeTrace = traces.find((item: any) => item.traceId === "message-send-tool-settings-update");
    expect(runtimeTrace).toMatchObject({
      method: "message.send",
      status: "completed",
      conversationId: "conv-tool-settings-update",
    });
    expect(runtimeTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "tool_result_emitted",
      "tool_event_emitted",
      "task_result_recorded",
      "completed",
    ]));

    ws.send(JSON.stringify({ type: "req", id: "tools-list-after-agent-update", method: "tools.list", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-after-agent-update"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-after-agent-update");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.disabled?.builtin).toEqual(["alpha_builtin"]);
  } finally {
    ws.close();
    await closeP;
    await gatewayServer.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send trims duplicated delegation metadata from tool_result events while keeping lightweight fields", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });

  const agent: BelldandyAgent = {
    async *run() {
      yield { type: "status", status: "running" as const };
      yield {
        type: "tool_result" as const,
        id: "tool-result-projection-1",
        name: "image_generate",
        success: true,
        output: "<img src=\"/generated/images/demo.png\" alt=\"Generated Image\">",
        metadata: {
          webPath: "/generated/images/demo.png",
          currentFaqi: "safe-dev",
          facetName: "coder",
          targetLabel: "root",
          delegationResults: [{
            agentId: "worker-1",
            status: "success",
            summary: "已有总结",
            acceptanceGate: {
              accepted: false,
              summary: "deliverable missing required sections",
              rejectionConfidence: "high",
            },
          }],
          followUpStrategy: {
            summary: "已有后续策略总结",
            recommendedRuntimeAction: "resume_parallel",
            highPriorityLabels: ["worker-1"],
            verifierHandoffLabels: ["verifier-1"],
          },
        },
      };
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => agent,
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
      id: "message-send-tool-result-metadata-projection",
      method: "message.send",
      params: {
        text: "run projection test",
        conversationId: "conv-tool-result-metadata-projection",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "message-send-tool-result-metadata-projection" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_result"));

    const toolResultEvent = frames.find((f) => f.type === "event" && f.event === "tool_result");
    expect(toolResultEvent?.payload?.metadata).toEqual({
      webPath: "/generated/images/demo.png",
      currentFaqi: "safe-dev",
      facetName: "coder",
      targetLabel: "root",
    });
    expect(toolResultEvent?.payload?.metadata?.delegationResults).toBeUndefined();
    expect(toolResultEvent?.payload?.metadata?.followUpStrategy).toBeUndefined();

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-tool-result-metadata-projection", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-tool-result-metadata-projection"));
    const doctorRes = frames.find((f) => f.type === "res" && f.id === "system-doctor-tool-result-metadata-projection");
    const traces = doctorRes.payload?.queryRuntime?.traces ?? [];
    const runtimeTrace = traces.find((item: any) => item.traceId === "message-send-tool-result-metadata-projection");
    const toolResultStage = runtimeTrace?.stages?.find((item: any) => item.stage === "tool_result_emitted");
    expect(toolResultStage?.detail).toMatchObject({
      toolName: "image_generate",
      success: true,
      acceptanceGateStatus: "rejected",
      acceptanceGateConfidence: "high",
      followUpRuntimeAction: "resume_parallel",
      followUpHighPriorityLabels: "worker-1",
      verifierHandoffSuggested: true,
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("message.send preserves bounded structured tool output when the event limit is explicitly raised", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const structuredOutput = JSON.stringify({ output: "x".repeat(1_100) });
  const agent: BelldandyAgent = {
    async *run() {
      yield { type: "status", status: "running" as const };
      yield {
        type: "tool_result" as const,
        id: "tool-result-bounded-output-1",
        name: "command_job",
        success: true,
        output: structuredOutput,
      };
      yield { type: "final" as const, text: "ok" };
      yield { type: "status", status: "done" as const };
    },
  };
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
    agentFactory: () => agent,
    toolResultEventOutputCharLimit: 2_048,
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
      id: "message-send-bounded-tool-result-output",
      method: "message.send",
      params: {
        text: "run bounded output projection test",
        conversationId: "conv-bounded-tool-result-output",
      },
    }));

    await waitFor(() => frames.some((frame) => frame.type === "event" && frame.event === "tool_result"));
    const toolResultEvent = frames.find((frame) => frame.type === "event" && frame.event === "tool_result");
    expect(toolResultEvent?.payload?.output).toBe(structuredOutput);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
