import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test, vi } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";
import { CompactionRuntimeTracker as SourceCompactionRuntimeTracker } from "../../belldandy-agent/src/compaction-runtime.js";
import { MemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";
import {
  SkillRegistry,
  ToolExecutor,
  createToolSettingsControlTool,
} from "@belldandy/skills";
import { PluginRegistry } from "@belldandy/plugins";

import { upsertInstalledExtension, upsertKnownMarketplace } from "./extension-marketplace-state.js";
import type { ExtensionHostState } from "./extension-host.js";
import { buildExtensionRuntimeReport } from "./extension-runtime.js";
import { recordConversationArtifactExport } from "./conversation-export-index.js";
import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  createContractedTestTool,
  createTestTool,
  createWriteContractedTestTool,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
  withEnv,
} from "./server-testkit.js";
import { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";
import { ToolsConfigManager } from "./tools-config.js";
import { RuntimeResilienceTracker } from "./runtime-resilience.js";

// MemoryManager 内部会初始化 OpenAIEmbeddingProvider，需要 OPENAI_API_KEY
// 测试环境中设置一个占位值，避免构造函数抛错（不会实际调用 API）
beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(() => {
  cleanupGlobalMemoryManagersForTest();
});

async function listenOnEphemeralPort(): Promise<{ port: number; close: () => Promise<void> }> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve ephemeral port")));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        }),
      });
    });
  });
}

async function createFakeCameraDoctorHelperScript(): Promise<string> {
  const helperDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-camera-doctor-helper-"));
  const helperPath = path.join(helperDir, "fake-camera-helper.mjs");
  await fs.promises.writeFile(helperPath, `
import readline from "node:readline";

const protocol = "camera-native-desktop/v1";
const capabilities = {
  diagnose: true,
  list: true,
  snapshot: true,
  clip: false,
  audio: false,
  hotplug: true,
  background: true,
  stillFormats: ["png"],
  clipFormats: [],
  selectionByStableKey: true,
  deviceChangeEvents: true,
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (!request || request.kind !== "request") {
    return;
  }
  let result;
  switch (request.method) {
    case "hello":
      result = {
        protocol,
        helperVersion: "server-doctor-helper",
        platform: "windows",
        transport: "stdio",
        helperStatus: "ready",
        capabilities,
      };
      break;
    case "diagnose":
      result = {
        status: "degraded",
        helperStatus: "ready",
        permissionState: "granted",
        observedAt: "2026-04-17T10:10:00.000Z",
        issues: [
          {
            code: "device_busy",
            severity: "warning",
            message: "OBSBOT Tiny 2 StreamCamera is currently busy.",
            retryable: true,
          },
        ],
        devices: [
          {
            deviceId: "obspot-main",
            stableKey: "usb-3564-fef8-453a4b75",
            label: "OBSBOT Tiny 2 StreamCamera",
            source: "external",
            transport: "native",
            external: true,
            available: true,
            kind: "videoinput",
            busy: true,
          },
        ],
        capabilities,
        helperVersion: "server-doctor-helper",
      };
      break;
    default:
      process.stdout.write(JSON.stringify({
        kind: "response",
        protocol,
        id: request.id,
        method: request.method,
        ok: false,
        error: {
          code: "unsupported_method",
          message: "unsupported",
        },
      }) + "\\n");
      return;
  }
  process.stdout.write(JSON.stringify({
    kind: "response",
    protocol,
    id: request.id,
    method: request.method,
    ok: true,
    result,
  }) + "\\n");
});
`, "utf-8");
  return helperPath;
}

test("system.doctor exposes tool behavior observability summary", async () => {
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

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-tool-behavior",
      method: "system.doctor",
      params: {
        toolAgentId: "default",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-tool-behavior" && f.ok === true));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-tool-behavior");
    expect(response.payload?.toolBehaviorObservability).toMatchObject({
      requested: {
        agentId: "default",
      },
      visibilityContext: {
        agentId: "default",
        conversationId: null,
        residentStateBinding: {
          agentId: "default",
          workspaceBinding: "current",
          workspaceDir: "default",
          scopeStateDir: stateDir,
          privateStateDir: stateDir,
          sessionsDir: path.join(stateDir, "sessions"),
          sharedStateDir: path.join(stateDir, "team-memory"),
        },
      },
      counts: {
        visibleToolContractCount: 3,
        includedContractCount: 3,
        behaviorContractCount: 3,
      },
      included: ["run_command", "apply_patch", "delegate_task"],
    });
    expect(response.payload?.toolBehaviorObservability?.contracts?.run_command).toMatchObject({
      useWhen: expect.any(Array),
      fallbackStrategy: expect.any(Array),
    });
    expect(response.payload?.toolBehaviorObservability?.summary).toContain("## run_command");
    expect(response.payload?.optionalCapabilities).toMatchObject({
      summary: {
        totalCount: 3,
        headline: expect.any(String),
      },
      items: expect.arrayContaining([
        expect.objectContaining({ id: "pty" }),
        expect.objectContaining({ id: "local_embedding" }),
        expect.objectContaining({ id: "build_scripts" }),
      ]),
    });
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "optional_capabilities",
        status: expect.stringMatching(/pass|warn/),
      }),
      expect.objectContaining({
        id: "tool_behavior_observability",
        status: "pass",
      }),
    ]));
    expect(response.payload?.toolContractV2Observability).toMatchObject({
      summary: {
        totalCount: 3,
        missingV2Count: 0,
        governedTools: expect.arrayContaining(["run_command", "apply_patch", "delegate_task"]),
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes dream runtime summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-doctor-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
  });
  registerGlobalMemoryManager(memoryManager);

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
      id: "system-doctor-dream-runtime",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-dream-runtime"));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-dream-runtime");
    expect(response?.ok).toBe(true);
    expect(response?.payload?.dreamRuntime).toMatchObject({
      requested: {
        agentId: "default",
      },
      availability: {
        enabled: true,
        available: false,
        reason: "missing model/baseUrl/apiKey",
      },
      state: {
        agentId: "default",
        status: "idle",
        recentRuns: [],
      },
    });
    expect(typeof response?.payload?.dreamRuntime?.requested?.defaultConversationId).toBe("string");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes commons export summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-commons-doctor-"));
  const vaultDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-commons-doctor-vault-"));
  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
    memoryMode: "hybrid",
  });

  const residentMemoryManagers = createScopedMemoryManagers({
    stateDir,
    agentRegistry: registry,
    modelsDir: path.join(stateDir, "models"),
    conversationStore: new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
    }),
    indexerOptions: {
      watch: false,
    },
  }).records;

  await withEnv({
    BELLDANDY_COMMONS_OBSIDIAN_ENABLED: "true",
    BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH: vaultDir,
  }, async () => {
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentRegistry: registry,
      residentMemoryManagers,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      ws.send(JSON.stringify({
        type: "req",
        id: "system-doctor-dream-commons",
        method: "system.doctor",
        params: {},
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-dream-commons"));

      const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-dream-commons");
      expect(response?.ok).toBe(true);
      expect(response?.payload?.dreamCommons).toMatchObject({
        availability: {
          enabled: true,
          available: true,
          vaultPath: vaultDir,
        },
        state: {
          status: "idle",
        },
      });
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(vaultDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("system.doctor exposes camera runtime summary when native_desktop helper is configured", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const helperPath = await createFakeCameraDoctorHelperScript();

  await withEnv({
    BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND: process.execPath,
    BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON: JSON.stringify([helperPath]),
  }, async () => {
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
        id: "system-doctor-camera-runtime",
        method: "system.doctor",
        params: {},
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-camera-runtime"));

      const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-camera-runtime");
      expect(response.ok).toBe(true);
      expect(response.payload?.cameraRuntime).toMatchObject({
        summary: {
          defaultProviderId: "native_desktop",
          defaultSelection: {
            policy: "prefer_native_desktop",
            selectedProvider: "native_desktop",
            reason: "policy_preferred_provider",
            fallbackApplied: false,
            configuredDefaultProvider: "browser_loopback",
          },
          governance: {
            blockedProviderCount: 1,
            permissionBlockedProviderCount: 0,
            permissionPromptProviderCount: 0,
            fallbackActiveProviderCount: 0,
            dominantFailureCode: "device_busy",
            recommendedAction: "关闭正在占用摄像头的会议或录制软件后重试。",
          },
          warningCount: 1,
          errorCount: 0,
        },
        providers: expect.arrayContaining([
          expect.objectContaining({
            id: "native_desktop",
            status: "degraded",
            helperStatus: "ready",
            healthCheck: expect.objectContaining({
              status: "warn",
              source: "diagnostic",
              primaryReasonCode: "device_busy",
              recoveryActions: expect.arrayContaining([
                expect.objectContaining({
                  kind: "close_competing_app",
                }),
              ]),
            }),
            runtimeHealth: expect.objectContaining({
              status: "degraded",
              historyWindow: expect.objectContaining({
                eventCount: 1,
                successCount: 1,
                failureCount: 0,
              }),
            }),
            runtimeHealthFreshness: expect.objectContaining({
              source: "memory+snapshot",
              snapshotPath: expect.stringContaining("native_desktop-runtime-health.json"),
            }),
            launchConfig: expect.objectContaining({
              command: process.execPath,
              helperEntry: helperPath,
            }),
            sampleDevices: expect.arrayContaining([
              "OBSBOT Tiny 2 StreamCamera [available, external, busy, stable=usb-3564-fef8-453a4b75]",
            ]),
          }),
        ]),
      });
      expect(response.payload?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "camera_runtime",
          name: "Camera Runtime",
          status: "warn",
        }),
      ]));
    } finally {
      ws.close();
      await closeP;
      await server.close();
    }
  });

  await fs.promises.rm(path.dirname(helperPath), { recursive: true, force: true }).catch(() => {});
  await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("system.doctor exposes bridge recovery diagnostics for a governed bridge subtask", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const bridgeTask = await subTaskRuntimeStore.createBridgeSessionTask({
    parentConversationId: "conv-bridge-doctor",
    agentId: "coder",
    profileId: "coder",
    instruction: "Recover the governed bridge task.",
    bridgeSubtask: {
      kind: "review",
      targetId: "codex_session",
      action: "interactive",
      summary: "Review bridge recovery diagnostics.",
    },
    bridgeSession: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
      summary: "Review bridge recovery diagnostics.",
    },
  });

  const toolExecutor = new ToolExecutor({
    tools: [
      createWriteContractedTestTool("bridge_session_start"),
      createWriteContractedTestTool("bridge_session_write"),
      createWriteContractedTestTool("bridge_session_close"),
    ],
    workspaceRoot: process.cwd(),
    isToolAllowedForAgent: (toolName, agentId) => !(agentId === "coder" && toolName.startsWith("bridge_session_")),
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolExecutor,
    subTaskRuntimeStore,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-bridge-recovery",
      method: "system.doctor",
      params: {
        toolTaskId: bridgeTask.id,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-bridge-recovery" && f.ok === true));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-bridge-recovery");
    expect(response.payload?.bridgeRecoveryDiagnostics).toMatchObject({
      applicable: true,
      status: "allowed",
      taskId: bridgeTask.id,
      agentId: "coder",
      conversationId: "conv-bridge-doctor",
      whitelistBypassedTools: [
        "bridge_session_start",
        "bridge_session_write",
        "bridge_session_close",
      ],
      runtimeContext: {
        bridgeGovernanceTaskId: bridgeTask.id,
        agentWhitelistMode: "governed_bridge_internal",
        hasBridgeSessionLaunch: true,
        hasBridgeSubtask: true,
      },
    });
    expect(response.payload?.bridgeRecoveryDiagnostics?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "bridge_session_start",
        defaultVisibility: expect.objectContaining({
          available: false,
          reasonCode: "not-in-agent-whitelist",
        }),
        governedVisibility: expect.objectContaining({
          available: true,
          reasonCode: "available",
        }),
        effectiveDecision: "allowed-by-governed-bridge-whitelist-bypass",
      }),
    ]));
    expect(response.payload?.toolBehaviorObservability?.visibilityContext?.bridgeRecoveryDiagnostics).toMatchObject({
      taskId: bridgeTask.id,
      status: "allowed",
    });
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "bridge_recovery_diagnostics",
        status: "pass",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes mind/profile snapshot summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  await fs.promises.mkdir(path.join(stateDir, "team-memory"), { recursive: true });
  await fs.promises.writeFile(
    path.join(stateDir, "USER.md"),
    "# USER\n**名字：** 小星\n偏好简洁状态表与短结论。\n",
    "utf-8",
  );
  await fs.promises.writeFile(
    path.join(stateDir, "MEMORY.md"),
    "# MEMORY\n优先把大文件里的主体逻辑外移。\n",
    "utf-8",
  );
  await fs.promises.writeFile(
    path.join(stateDir, "team-memory", "MEMORY.md"),
    "# Shared Memory\n团队约定：外发统一走 sessionKey / binding。\n",
    "utf-8",
  );

  const registry = new AgentRegistry(() => new MockAgent());
  registry.register({
    id: "default",
    displayName: "Belldandy",
    model: "primary",
  });
  registry.register({
    id: "coder",
    displayName: "Coder",
    model: "primary",
    kind: "resident",
    memoryMode: "hybrid",
    workspaceBinding: "current",
    workspaceDir: "coder",
  });

  const residentMemoryManagers = createScopedMemoryManagers({
    stateDir,
    agentRegistry: registry,
    modelsDir: path.join(stateDir, "models"),
    conversationStore: new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
    }),
    indexerOptions: {
      watch: false,
    },
  }).records;
  const defaultRecord = residentMemoryManagers.find((record) => record.agentId === "default");
  expect(defaultRecord).toBeTruthy();
  (defaultRecord?.manager as any)?.store.upsertChunk({
    id: "mind-private-1",
    sourcePath: "MEMORY.md",
    sourceType: "file",
    memoryType: "core",
    content: "优先把大文件里的主体逻辑外移，server.ts 只做装配。",
    agentId: "default",
    visibility: "private",
  });
  (defaultRecord?.manager as any)?.store.upsertChunk({
    id: "mind-shared-1",
    sourcePath: "team-memory/MEMORY.md",
    sourceType: "file",
    memoryType: "core",
    content: "团队约定：外发统一走 sessionKey / binding。",
    visibility: "shared",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
    residentMemoryManagers,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-mind-profile",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-mind-profile" && f.ok === true));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-mind-profile");
    expect(response.payload?.mindProfileSnapshot).toMatchObject({
      summary: {
        available: true,
        hasUserProfile: true,
        hasPrivateMemoryFile: true,
        hasSharedMemoryFile: true,
      },
      identity: {
        userName: "小星",
      },
      memory: {
        recentMemorySnippets: expect.arrayContaining([
          expect.objectContaining({ scope: "private" }),
          expect.objectContaining({ scope: "shared" }),
        ]),
      },
    });
    expect(response.payload?.mindProfileSnapshot?.summary?.privateMemoryCount).toBeGreaterThanOrEqual(1);
    expect(response.payload?.mindProfileSnapshot?.summary?.sharedMemoryCount).toBeGreaterThanOrEqual(1);
    expect(response.payload?.mindProfileSnapshot?.profile?.summaryLines).toEqual(expect.arrayContaining([
      expect.stringContaining("USER.md:"),
      expect.stringContaining("Private MEMORY.md:"),
      expect.stringContaining("Shared MEMORY.md:"),
    ]));
    expect(response.payload?.learningReviewInput).toMatchObject({
      summary: {
        available: true,
      },
    });
    expect(response.payload?.learningReviewNudgeRuntime).toMatchObject({
      summary: {
        available: false,
        triggered: false,
      },
    });
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "mind_profile_snapshot",
        status: "pass",
      }),
      expect.objectContaining({
        id: "learning_review_input",
        status: "pass",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor can include on-demand conversation transcript export and timeline", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const conversationId = "conv-doctor-conversation-debug";
  conversationStore.addMessage(conversationId, "user", "doctor timeline user");
  conversationStore.addMessage(conversationId, "assistant", "doctor timeline assistant");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
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
      id: "system-doctor-conversation-debug",
      method: "system.doctor",
      params: {
        conversationId,
        includeTranscript: true,
        includeTimeline: true,
        timelinePreviewChars: 32,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-conversation-debug" && f.ok === true));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-conversation-debug");

    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "conversation_debug",
        status: "pass",
        message: expect.stringContaining(conversationId),
      }),
    ]));
    expect(response.payload?.conversationDebug).toMatchObject({
      conversationId,
      available: true,
      messageCount: 2,
      requested: {
        includeTranscript: true,
        includeTimeline: true,
        timelinePreviewChars: 32,
      },
      transcriptExport: {
        manifest: {
          conversationId,
          redactionMode: "internal",
        },
      },
      timeline: {
        manifest: {
          conversationId,
          source: "conversation.timeline.get",
        },
      },
    });
    expect(response.payload?.conversationDebug?.timeline?.summary?.messageCount).toBe(2);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor applies lightweight conversation debug filters", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const conversationId = "conv-doctor-conversation-filter";
  conversationStore.addMessage(conversationId, "user", "doctor filter user");
  conversationStore.addMessage(conversationId, "assistant", "doctor filter assistant");
  await conversationStore.waitForPendingPersistence(conversationId);

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
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
      id: "system-doctor-conversation-filter",
      method: "system.doctor",
      params: {
        conversationId,
        includeTranscript: true,
        includeTimeline: true,
        transcriptEventTypes: ["assistant_message_finalized"],
        transcriptRestoreView: "canonical",
        timelineKinds: ["restore_result"],
        timelineLimit: 1,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-conversation-filter" && f.ok === true));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-conversation-filter");

    expect(response.payload?.conversationDebug).toMatchObject({
      conversationId,
      requested: {
        includeTranscript: true,
        includeTimeline: true,
        transcriptEventTypes: ["assistant_message_finalized"],
        transcriptRestoreView: "canonical",
        timelineKinds: ["restore_result"],
        timelineLimit: 1,
      },
    });
    expect(response.payload?.conversationDebug?.transcriptExport?.events).toHaveLength(1);
    expect(response.payload?.conversationDebug?.transcriptExport?.projectionSummary).toMatchObject({
      visibleEventCount: 1,
      visibleRawMessageCount: 0,
      visibleCanonicalExtractionCount: 2,
    });
    expect(response.payload?.conversationDebug?.timeline?.items).toHaveLength(1);
    expect(response.payload?.conversationDebug?.timeline?.items[0]?.kind).toBe("restore_result");
    expect(response.payload?.conversationDebug?.timeline?.projectionSummary).toMatchObject({
      visibleItemCount: 1,
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor can expose conversation catalog and recent export index", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const conversationId = "conv-doctor-catalog-alpha";
  conversationStore.addMessage(conversationId, "user", "doctor catalog user");
  await conversationStore.waitForPendingPersistence(conversationId);
  await recordConversationArtifactExport({
    stateDir,
    conversationId,
    artifact: "transcript",
    format: "json",
    outputPath: path.join(stateDir, "artifacts", "conversation-alpha.transcript.json"),
    mode: "internal",
    projectionFilter: { restoreView: "all" },
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationStore,
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
      id: "system-doctor-conversation-catalog",
      method: "system.doctor",
      params: {
        includeConversationCatalog: true,
        includeRecentExports: true,
        conversationIdPrefix: "conv-doctor-catalog-",
        conversationListLimit: 10,
        recentExportLimit: 10,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-conversation-catalog" && f.ok === true));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-conversation-catalog");

    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "conversation_catalog", status: "pass" }),
      expect.objectContaining({ id: "conversation_export_index", status: "pass" }),
    ]));
    expect(response.payload?.conversationCatalog?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId,
        hasTranscript: true,
      }),
    ]));
    expect(response.payload?.recentConversationExports?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId,
        artifact: "transcript",
        format: "json",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor reads memory db status without blocking sync fs path", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  await fs.promises.writeFile(path.join(stateDir, "memory.sqlite"), Buffer.alloc(2048, 1));

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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor");
    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "memory_db",
        status: "pass",
        message: expect.stringContaining("Size: 2.0 KB"),
      }),
      expect.objectContaining({
        id: "mcp_runtime",
        status: "pass",
        message: "Disabled",
      }),
    ]));
    expect(response.payload?.mcpRuntime).toEqual({
      enabled: false,
      diagnostics: null,
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes config source summary for state-dir config mode", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-state-"));

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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-config-source", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-config-source"));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-config-source");
    expect(response.ok).toBe(true);
    expect(["default_home", "bootstrap_env", "process_env"]).toContain(response.payload?.configSource?.stateDirSource);
    expect(["default home", "bootstrap env", "process env"]).toContain(response.payload?.configSource?.stateDirSourceLabel);
    expect(response.payload?.configSource).toMatchObject({
      source: "state_dir",
      sourceLabel: "state-dir config",
      envDir: path.resolve(stateDir),
      stateDir: path.resolve(stateDir),
      stateDirActive: true,
      projectRootWins: false,
      resolutionOrder: expect.arrayContaining([
        "state-dir config (BELLDANDY_STATE_DIR)",
      ]),
    });
    expect(response.payload?.configSource?.resolutionOrder?.[0]).toBe(
      `stateDir source (${response.payload?.configSource?.stateDirSourceLabel})`
    );
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "config_source",
        name: "Config Source",
        status: "pass",
        message: expect.stringContaining("BELLDANDY_STATE_DIR"),
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor includes MCP recovery and persisted-result summary when MCP diagnostics are available", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const previousMcpEnabled = process.env.BELLDANDY_MCP_ENABLED;
  process.env.BELLDANDY_MCP_ENABLED = "true";

  const mcpModule = await import("./mcp/index.js");
  const getMCPDiagnosticsSpy = vi.spyOn(mcpModule, "getMCPDiagnostics").mockReturnValue({
    initialized: true,
    toolCount: 5,
    serverCount: 2,
    connectedCount: 1,
    summary: {
      recentErrorServers: 1,
      recoveryAttemptedServers: 1,
      recoverySucceededServers: 1,
      persistedResultServers: 1,
      truncatedResultServers: 1,
    },
    servers: [
      {
        id: "mcp_a",
        name: "MCP A",
        status: "connected",
        toolCount: 5,
        resourceCount: 2,
        diagnostics: {
          connectionAttempts: 1,
          reconnectAttempts: 1,
          lastRecoveryAt: new Date("2026-04-02T10:00:00.000Z"),
          lastRecoverySucceeded: true,
          lastResult: {
            at: new Date("2026-04-02T10:01:00.000Z"),
            source: "call_tool",
            strategy: "persisted",
            estimatedChars: 4096,
            truncatedItems: 1,
            persistedItems: 1,
            persistedWebPath: "/generated/mcp-doctor.txt",
          },
        },
      },
      {
        id: "mcp_b",
        name: "MCP B",
        status: "error",
        error: "session expired",
        toolCount: 0,
        resourceCount: 0,
        diagnostics: {
          connectionAttempts: 2,
          reconnectAttempts: 1,
          lastErrorAt: new Date("2026-04-02T09:59:00.000Z"),
          lastErrorKind: "session_expired",
          lastErrorMessage: "session expired",
        },
      },
    ],
  });

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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-mcp-runtime", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-mcp-runtime"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-mcp-runtime");

    expect(getMCPDiagnosticsSpy).toHaveBeenCalled();
    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "mcp_runtime",
        status: "pass",
        message: "1/2 connected, 5 tools, recovery 1/1, persisted refs 1",
      }),
    ]));
    expect(response.payload?.mcpRuntime?.diagnostics?.summary).toEqual({
      recentErrorServers: 1,
      recoveryAttemptedServers: 1,
      recoverySucceededServers: 1,
      persistedResultServers: 1,
      truncatedResultServers: 1,
    });
    expect(response.payload?.mcpRuntime?.diagnostics?.servers[0]?.diagnostics?.lastResult).toEqual(expect.objectContaining({
      strategy: "persisted",
      persistedWebPath: "/generated/mcp-doctor.txt",
    }));
  } finally {
    getMCPDiagnosticsSpy.mockRestore();
    if (previousMcpEnabled === undefined) {
      delete process.env.BELLDANDY_MCP_ENABLED;
    } else {
      process.env.BELLDANDY_MCP_ENABLED = previousMcpEnabled;
    }
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor reports starweaver-central as primary when local stdio fallback is inactive", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-starweaver-routing-"));
  const listener = await listenOnEphemeralPort();
  await fs.promises.writeFile(path.join(stateDir, "mcp.json"), `${JSON.stringify({
    mcpServers: {
      starweaver: {
        command: "node",
        args: ["E:/project/star-sanctuary/Star_Weaver_Engine/host/mcpSouthboundHost.ts"],
        autoConnect: false,
      },
      "starweaver-central": {
        url: `http://127.0.0.1:${listener.port}/sse`,
        headers: {
          Authorization: "Bearer real-sse-key",
        },
      },
    },
  }, null, 2)}\n`, "utf-8");

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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-starweaver-routing", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-starweaver-routing"));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-starweaver-routing");
    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "starweaver_mcp_routing",
        status: "pass",
        message: "starweaver-central SSE is primary; local starweaver fallback is present but inactive.",
      }),
    ]));
    expect(response.payload?.mcpRouting).toMatchObject({
      serverCount: 2,
      starweaver: {
        status: "central_primary",
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await listener.close().catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor warns when starweaver-central still uses the placeholder API key", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-starweaver-placeholder-"));
  await fs.promises.writeFile(path.join(stateDir, "mcp.json"), `${JSON.stringify({
    mcpServers: {
      starweaver: {
        command: "node",
        args: ["E:/project/star-sanctuary/Star_Weaver_Engine/host/mcpSouthboundHost.ts"],
        autoConnect: false,
      },
      "starweaver-central": {
        url: "http://127.0.0.1:28767/sse",
        headers: {
          Authorization: "Bearer replace-with-your-sse-api-key",
        },
      },
    },
  }, null, 2)}\n`, "utf-8");

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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-starweaver-placeholder", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-starweaver-placeholder"));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-starweaver-placeholder");
    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "starweaver_mcp_routing",
        status: "warn",
        message: expect.stringContaining("placeholder API key"),
      }),
    ]));
    expect([
      "central_primary_placeholder_key",
      "central_primary_placeholder_key_unreachable",
    ]).toContain(response.payload?.mcpRouting?.starweaver?.status);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor warns when starweaver-central shared host is unreachable", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-starweaver-unreachable-"));
  await fs.promises.writeFile(path.join(stateDir, "mcp.json"), `${JSON.stringify({
    mcpServers: {
      "starweaver-central": {
        url: "http://127.0.0.1:28779/sse",
        headers: {
          Authorization: "Bearer real-sse-key",
        },
      },
    },
  }, null, 2)}\n`, "utf-8");

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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-starweaver-unreachable", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-starweaver-unreachable"));

    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-starweaver-unreachable");
    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "starweaver_mcp_routing",
        status: "warn",
        message: expect.stringContaining("shared host is unreachable"),
      }),
    ]));
    expect(response.payload?.mcpRouting?.starweaver?.status).toBe("central_primary_unreachable");
    expect(response.payload?.mcpRouting?.starweaver?.runtimeProbe?.reachable).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes unified extension runtime diagnostics for plugins and skills", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  await toolsConfigManager.updateConfig({
    plugins: ["demo-plugin"],
    skills: ["disabled-skill"],
  });

  const pluginRegistry = new PluginRegistry();
  ((pluginRegistry as any).plugins).set("demo-plugin", {
    id: "demo-plugin",
    name: "Demo Plugin",
    version: "1.0.0",
    description: "demo",
    activate: async () => {},
  });
  ((pluginRegistry as any).pluginToolMap).set("demo-plugin", ["plugin_demo_tool"]);
  ((pluginRegistry as any).loadErrors).push({
    at: new Date("2026-04-02T12:00:00.000Z"),
    phase: "load_plugin",
    target: "broken-plugin.mjs",
    message: "missing activate function",
  });

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
  ((skillRegistry as any).eligibilityCache).set("available-skill", { eligible: true, reasons: [] });
  ((skillRegistry as any).eligibilityCache).set("disabled-skill", { eligible: true, reasons: [] });
  const extensionHost: Pick<ExtensionHostState, "extensionRuntime" | "lifecycle"> = {
    extensionRuntime: buildExtensionRuntimeReport({
      pluginRegistry,
      skillRegistry,
      toolsConfigManager,
    }),
    lifecycle: {
      pluginToolsRegistered: 1,
      skillManagementToolsRegistered: ["skills_list", "skills_search", "skill_get"],
      bundledSkillsLoaded: 2,
      userSkillsLoaded: 0,
      pluginSkillsLoaded: 0,
      installedMarketplaceExtensionsLoaded: 0,
      installedMarketplacePluginsLoaded: 0,
      installedMarketplaceSkillPacksLoaded: 0,
      eligibilityRefreshed: true,
      loadCompletedAt: new Date("2026-04-02T12:05:00.000Z"),
      hookBridge: {
        source: "plugin-bridge",
        availableHookCount: 2,
        bridgedHookCount: 2,
        registrations: [
          {
            legacyHookName: "beforeRun",
            hookName: "before_agent_start",
            available: true,
            bridged: true,
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
            available: true,
            bridged: true,
          },
          {
            legacyHookName: "afterToolCall",
            hookName: "after_tool_call",
            available: false,
            bridged: false,
          },
        ],
        lastBridgedAt: new Date("2026-04-02T12:06:00.000Z"),
      },
    },
  };

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-extension-runtime", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-extension-runtime"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-extension-runtime");

    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "extension_runtime",
        status: "warn",
        message: "plugins 1 (1 disabled, 1 load errors), skills 2 (1 disabled, 0 ineligible), legacy hooks 2/2 bridged",
      }),
    ]));
    expect(response.payload?.extensionRuntime?.summary).toEqual({
      pluginCount: 1,
      disabledPluginCount: 1,
      pluginToolCount: 1,
      pluginLoadErrorCount: 1,
      skillCount: 2,
      disabledSkillCount: 1,
      ineligibleSkillCount: 0,
      promptSkillCount: 0,
      searchableSkillCount: 1,
    });
    expect(response.payload?.extensionRuntime?.diagnostics?.pluginLoadErrors).toEqual([
      expect.objectContaining({
        phase: "load_plugin",
        target: "broken-plugin.mjs",
        message: "missing activate function",
      }),
    ]);
    expect(response.payload?.extensionRuntime?.registry).toEqual({
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
    expect(response.payload?.extensionRuntime?.host?.lifecycle).toMatchObject({
      pluginToolsRegistered: 1,
      skillManagementToolsRegistered: ["skills_list", "skills_search", "skill_get"],
      bundledSkillsLoaded: 2,
      userSkillsLoaded: 0,
      pluginSkillsLoaded: 0,
      installedMarketplaceExtensionsLoaded: 0,
      installedMarketplacePluginsLoaded: 0,
      installedMarketplaceSkillPacksLoaded: 0,
      eligibilityRefreshed: true,
      loadCompletedAt: "2026-04-02T12:05:00.000Z",
      hookBridge: {
        source: "plugin-bridge",
        availableHookCount: 2,
        bridgedHookCount: 2,
        lastBridgedAt: "2026-04-02T12:06:00.000Z",
        registrations: extensionHost.lifecycle.hookBridge.registrations,
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor reports extension marketplace summary from installed ledgers", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  await toolsConfigManager.updateConfig({
    plugins: ["demo-plugin"],
    skills: ["disabled-skill"],
  });
  await upsertKnownMarketplace(stateDir, {
    name: "official-market",
    source: {
      source: "github",
      repo: "star-sanctuary/official-market",
      ref: "main",
    },
    installLocation: path.join(stateDir, "extensions", "cache", "official-market"),
    autoUpdate: true,
    lastUpdated: "2026-04-02T12:30:00.000Z",
  });
  await upsertInstalledExtension(stateDir, {
    name: "demo-plugin",
    kind: "plugin",
    marketplace: "official-market",
    version: "1.2.3",
    manifestPath: "belldandy-extension.json",
    installPath: path.join(stateDir, "extensions", "installed", "official-market", "demo-plugin"),
    status: "installed",
    enabled: true,
    lastUpdated: "2026-04-02T12:31:00.000Z",
  });
  await upsertInstalledExtension(stateDir, {
    name: "ops-skills",
    kind: "skill-pack",
    marketplace: "official-market",
    version: "0.4.0",
    installPath: path.join(stateDir, "extensions", "installed", "official-market", "ops-skills"),
    status: "broken",
    enabled: false,
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
  ((skillRegistry as any).eligibilityCache).set("available-skill", { eligible: true, reasons: [] });
  ((skillRegistry as any).eligibilityCache).set("disabled-skill", { eligible: true, reasons: [] });
  const extensionHost: Pick<ExtensionHostState, "extensionRuntime" | "lifecycle"> = {
    extensionRuntime: buildExtensionRuntimeReport({
      pluginRegistry,
      skillRegistry,
      toolsConfigManager,
    }),
    lifecycle: {
      pluginToolsRegistered: 1,
      skillManagementToolsRegistered: ["skills_list", "skills_search", "skill_get"],
      bundledSkillsLoaded: 2,
      userSkillsLoaded: 0,
      pluginSkillsLoaded: 0,
      installedMarketplaceExtensionsLoaded: 1,
      installedMarketplacePluginsLoaded: 1,
      installedMarketplaceSkillPacksLoaded: 0,
      eligibilityRefreshed: true,
      loadCompletedAt: new Date("2026-04-02T12:35:00.000Z"),
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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-extension-marketplace", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-extension-marketplace"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-extension-marketplace");

    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "extension_marketplace",
        status: "warn",
        message: "marketplaces 1 (1 auto-update), installed 2 (1 plugins, 1 skill-packs, 1 broken, 1 disabled)",
      }),
      expect.objectContaining({
        id: "extension_governance",
        status: "warn",
        message: "ledger enabled 1/2, host loaded 1 (1 plugins, 0 skill-packs), runtime policy disabled 1 plugins / 1 skills",
      }),
    ]));
    expect(response.payload?.extensionMarketplace?.summary).toEqual({
      knownMarketplaceCount: 1,
      autoUpdateMarketplaceCount: 1,
      installedExtensionCount: 2,
      installedPluginCount: 1,
      installedSkillPackCount: 1,
      pendingExtensionCount: 0,
      brokenExtensionCount: 1,
      disabledExtensionCount: 1,
    });
    expect(response.payload?.extensionMarketplace?.knownMarketplaces?.marketplaces?.["official-market"]).toMatchObject({
      name: "official-market",
      autoUpdate: true,
    });
    expect(response.payload?.extensionMarketplace?.installedExtensions?.extensions?.["demo-plugin@official-market"]).toMatchObject({
      name: "demo-plugin",
      marketplace: "official-market",
      status: "installed",
    });
    expect(response.payload?.extensionGovernance?.summary).toEqual({
      installedExtensionCount: 2,
      installedEnabledExtensionCount: 1,
      installedDisabledExtensionCount: 1,
      installedBrokenExtensionCount: 1,
      loadedMarketplaceExtensionCount: 1,
      loadedMarketplacePluginCount: 1,
      loadedMarketplaceSkillPackCount: 0,
      runtimePolicyDisabledPluginCount: 1,
      runtimePolicyDisabledSkillCount: 1,
    });
    expect(response.payload?.extensionGovernance?.layers).toMatchObject({
      installedLedger: {
        extensionIds: ["demo-plugin@official-market", "ops-skills@official-market"],
        enabledExtensionIds: ["demo-plugin@official-market"],
        disabledExtensionIds: ["ops-skills@official-market"],
        brokenExtensionIds: ["ops-skills@official-market"],
      },
      hostLoad: {
        lifecycleAvailable: true,
        loadedMarketplaceExtensionCount: 1,
        loadedMarketplacePluginCount: 1,
        loadedMarketplaceSkillPackCount: 0,
      },
      runtimePolicy: {
        disabledPluginIds: ["demo-plugin"],
        disabledSkillNames: ["disabled-skill"],
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor reports durable extraction gating reasons and restricted memory surfaces", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-doctor-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    evolutionEnabled: true,
    evolutionModel: "test-evolution-model",
    evolutionBaseUrl: "https://example.invalid/v1",
    evolutionApiKey: "",
    evolutionMinMessages: 4,
  });
  registerGlobalMemoryManager(memoryManager);

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
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-memory", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-memory"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-memory");
    expect(response.ok).toBe(true);
    expect(response.payload?.memoryRuntime?.mainThreadToolSurface?.mode).toBe("tool-executor");
    expect(response.payload?.memoryRuntime?.durableExtraction?.permissionSurface?.mode).toBe("internal-restricted");
    expect(response.payload?.memoryRuntime?.durableExtraction?.availability).toMatchObject({
      available: false,
      enabled: true,
      reasonCodes: expect.arrayContaining(["api_key_missing"]),
      model: "test-evolution-model",
      hasBaseUrl: true,
      hasApiKey: false,
    });
    expect(response.payload?.memoryRuntime?.durableExtraction?.guidance?.policyVersion).toBe("week9-v1");
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "durable_extraction_runtime",
        status: "fail",
      }),
      expect.objectContaining({
        id: "durable_extraction_policy",
        status: "pass",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    memoryManager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes team shared memory readiness and deferred sync policy", async () => {
  await withEnv({
    BELLDANDY_TEAM_SHARED_MEMORY_ENABLED: "true",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    await fs.promises.mkdir(path.join(stateDir, "team-memory", "memory"), { recursive: true });
    await fs.promises.writeFile(path.join(stateDir, "team-memory", "MEMORY.md"), "# Shared Memory\n", "utf-8");
    await fs.promises.writeFile(path.join(stateDir, "team-memory", "memory", "2026-04-02.md"), "# 2026-04-02\n", "utf-8");

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
      ws.send(JSON.stringify({ type: "req", id: "system-doctor-team-memory", method: "system.doctor", params: {} }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-team-memory"));
      const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-team-memory");

      expect(response.ok).toBe(true);
      expect(response.payload?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "team_shared_memory",
          status: "pass",
          message: "enabled at team-memory (2 files), secret guard ready, sync plan planned",
        }),
      ]));
      expect(response.payload?.memoryRuntime?.sharedMemory).toMatchObject({
        enabled: true,
        available: true,
        reasonCodes: [],
        scope: {
          relativeRoot: "team-memory",
          fileCount: 2,
          hasMainMemory: true,
          dailyCount: 1,
        },
        secretGuard: {
          enabled: true,
          scanner: "curated-high-confidence",
        },
        syncPolicy: {
          status: "planned",
          deltaSync: {
            enabled: true,
            mode: "checksum-delta",
          },
          conflictPolicy: {
            mode: "local-write-wins-per-entry",
            maxConflictRetries: 2,
          },
          deletionPolicy: {
            propagatesDeletes: false,
          },
          suppressionPolicy: {
            enabled: true,
          },
        },
      });
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("system.doctor aggregates shared governance preview summary with the latest report context", async () => {
  await withEnv({
    BELLDANDY_TEAM_SHARED_MEMORY_ENABLED: "true",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-doctor-shared-governance-"));
    const registry = new AgentRegistry(() => new MockAgent());
    registry.register({
      id: "default",
      displayName: "Belldandy",
      model: "primary",
      memoryMode: "hybrid",
    });
    registry.register({
      id: "reviewer",
      displayName: "Reviewer",
      model: "primary",
      workspaceDir: "reviewer",
      sessionNamespace: "reviewer-main",
      memoryMode: "isolated",
    });

    const residentMemoryManagers = createScopedMemoryManagers({
      stateDir,
      agentRegistry: registry,
      modelsDir: path.join(stateDir, "models"),
      conversationStore: new ConversationStore({
        dataDir: path.join(stateDir, "sessions"),
      }),
      indexerOptions: {
        watch: false,
      },
    }).records;
    const defaultRecord = residentMemoryManagers.find((record) => record.agentId === "default");
    expect(defaultRecord).toBeTruthy();
    if (!defaultRecord) {
      throw new Error("default resident memory manager is required");
    }

    const memoryDir = path.join(defaultRecord.stateDir, "memory");
    const sessionsDir = path.join(defaultRecord.stateDir, "sessions");
    await fs.promises.mkdir(memoryDir, { recursive: true });
    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await fs.promises.writeFile(path.join(memoryDir, "2026-05-21.md"), "# Shared Governance\ncoverage marker\n", "utf-8");
    await fs.promises.writeFile(path.join(sessionsDir, "doctor.session-memory.json"), JSON.stringify({
      summary: "doctor coverage marker",
    }, null, 2), "utf-8");
    await fs.promises.writeFile(path.join(defaultRecord.stateDir, "dream-runtime.json"), JSON.stringify({
      status: "idle",
    }, null, 2), "utf-8");
    defaultRecord.manager.upsertMemoryChunk({
      id: "doctor-shared-governance-chunk",
      sourcePath: "memory/2026-05-21.md",
      sourceType: "manual",
      memoryType: "daily",
      content: "doctor shared governance preview chunk",
      visibility: "private",
    });

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentRegistry: registry,
      residentMemoryManagers,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      ws.send(JSON.stringify({
        type: "req",
        id: "doctor-shared-governance-promote",
        method: "memory.share.promote",
        params: {
          agentId: "default",
          chunkId: "doctor-shared-governance-chunk",
          reason: "doctor aggregation preview",
        },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "doctor-shared-governance-promote"));
      const promoteRes = frames.find((f) => f.type === "res" && f.id === "doctor-shared-governance-promote");
      expect(promoteRes).toBeTruthy();
      if (!promoteRes?.ok) {
        throw new Error(`expected successful memory.share.promote response: ${JSON.stringify(promoteRes)}`);
      }

      ws.send(JSON.stringify({
        type: "req",
        id: "doctor-shared-governance-preview",
        method: "memory.tree.report.shared_governance.preview",
        params: {
          agentId: "default",
          reviewerAgentId: "reviewer",
        },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "doctor-shared-governance-preview"));
      const previewRes = frames.find((f) => f.type === "res" && f.id === "doctor-shared-governance-preview");
      expect(previewRes?.ok).toBe(true);
      const reportId = String(previewRes?.payload?.record?.id ?? "");
      expect(reportId.length).toBeGreaterThan(0);

      ws.send(JSON.stringify({
        type: "req",
        id: "system-doctor-shared-governance",
        method: "system.doctor",
        params: {
          agentId: "default",
          reviewerAgentId: "reviewer",
        },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-shared-governance"));
      const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-shared-governance");

      expect(response?.ok).toBe(true);
      expect(response?.payload?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "memory_shared_governance",
          status: "warn",
          message: expect.stringContaining("Memory shared governance"),
        }),
      ]));
      expect(response?.payload?.memorySharedGovernance).toMatchObject({
        headline: expect.stringContaining("Memory shared governance"),
        summary: expect.objectContaining({
          memoryMode: "hybrid",
          writeTarget: "private",
          pendingCount: 1,
          actionableCount: 1,
          uniqueSourcePathCount: 1,
          reviewSurfaceMode: "report_ledger_first",
          coverageHeadline: expect.stringContaining("present searchable="),
          coverageExplanations: expect.arrayContaining([
            expect.objectContaining({
              searchPolicy: "searchable",
              whyThisBucket: expect.any(String),
            }),
          ]),
          latestReport: expect.objectContaining({
            id: reportId,
            status: "ready",
            agentId: "default",
          }),
        }),
        report: expect.objectContaining({
          boundary: expect.objectContaining({
            agentId: "default",
            reviewerAgentId: "reviewer",
          }),
          teamSharedMemory: expect.objectContaining({
            enabled: true,
          }),
        }),
      });
      expect(response?.payload?.memorySharedGovernance?.report?.coverage?.summaryInputOnlyCount).toBeGreaterThan(0);
      expect(response?.payload?.memorySharedGovernance?.report?.coverage?.inventoryOnlyCount).toBeGreaterThan(0);
      expect(response?.payload?.memorySharedGovernance?.report?.coverage?.searchable).toEqual(expect.arrayContaining([
        expect.objectContaining({
          explanation: expect.any(String),
        }),
      ]));
      expect(response?.payload?.memorySharedGovernance?.summary?.coverageExplanations).toHaveLength(3);
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("system.doctor reports session digest rate-limit state after budget is exceeded", async () => {
  await withEnv({
    BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "1",
    BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS: "60000",
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS: undefined,
    BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS: undefined,
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const conversationStore = new ConversationStore({
      dataDir: path.join(stateDir, "sessions"),
      compaction: {
        enabled: true,
        tokenThreshold: 10,
        keepRecentCount: 1,
      },
      summarizer: async () => "rolling-summary-rate-limit",
    });
    const conversationId = "conv-rate-limit-state";
    conversationStore.addMessage(conversationId, "user", "A".repeat(80));
    conversationStore.addMessage(conversationId, "assistant", "B".repeat(80));
    conversationStore.addMessage(conversationId, "user", "C".repeat(80));

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      ws.send(JSON.stringify({
        type: "req",
        id: "digest-rate-limit-first",
        method: "conversation.digest.refresh",
        params: { conversationId, threshold: 2 },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "digest-rate-limit-first" && f.ok === true));

      ws.send(JSON.stringify({
        type: "req",
        id: "digest-rate-limit-second",
        method: "conversation.digest.refresh",
        params: { conversationId, threshold: 2, force: true },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "digest-rate-limit-second"));

      ws.send(JSON.stringify({ type: "req", id: "system-doctor-rate-limit", method: "system.doctor", params: {} }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-rate-limit"));
      const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-rate-limit");
      expect(response.ok).toBe(true);
      expect(response.payload?.memoryRuntime?.sessionDigest?.rateLimit).toMatchObject({
        status: "limited",
        configured: true,
        maxRuns: 1,
      });
      expect(response.payload?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "session_digest_runtime",
          status: "warn",
        }),
      ]));
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("system.doctor exposes compaction runtime circuit and retry stats", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const tracker = new SourceCompactionRuntimeTracker({
    maxConsecutiveCompactionFailures: 1,
  });
  tracker.recordResult({
    messages: [],
    compacted: true,
    originalTokens: 120,
    compactedTokens: 48,
    state: {
      rollingSummary: "fallback summary",
      archivalSummary: "",
      compactedMessageCount: 2,
      lastCompactedMessageCount: 2,
      lastCompactedMessageFingerprint: "2:test",
      rollingSummaryMergeCount: 1,
      lastCompactedAt: Date.now(),
    },
    tier: "rolling",
    deltaMessageCount: 2,
    fallbackUsed: true,
    rebuildTriggered: false,
      promptTooLongRetries: 0,
      warningTriggered: false,
      blockingTriggered: false,
      failureReason: "compaction backend unavailable",
      summarizerObservability: {
        mode: "rolling",
        cacheAlignedRequested: true,
        cacheSupport: "supported",
        cacheHitTokens: 640,
        cacheMissTokens: 32,
        cacheSavingsUsd: 0.000123,
        usedWireApi: "chat_completions",
        compareAvailable: true,
        comparison: {
          mode: "cache_aligned_vs_plain",
          plainRequestMessageCount: 1,
          cacheAlignedRequestMessageCount: 4,
          plainPromptCharsEstimate: 1200,
          cacheAlignedReplayCharsEstimate: 980,
          cacheAlignedInstructionChars: 180,
          replayOverheadChars: 0,
        },
        strategy: {
          kind: "cache_aligned",
          providerCacheMode: "supported",
          selectionReason: "provider_cache_supported_with_context",
          degradePath: "cache_aligned_then_compaction_fallback",
          providerModelNotes: "cache=supported, json=medium, route=deepseek-flash",
          fallbackPolicy: "fallback_summary_on_request_or_parse_or_budget_failure",
          fallbackTriggered: true,
          fallbackSummary: "model_failure_fallback",
        },
        fallbackStage: "model_failure",
        failureReason: "compaction backend unavailable",
      },
    }, {
      source: "request",
      participatesInCircuitBreaker: true,
  });
  tracker.shouldSkip("request");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    getCompactionRuntimeReport: () => tracker.getReport(),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    ws.send(JSON.stringify({ type: "req", id: "system-doctor-compaction-runtime", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-compaction-runtime"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-compaction-runtime");

    expect(response.ok).toBe(true);
      expect(response.payload?.memoryRuntime?.compactionRuntime).toMatchObject({
        totals: {
          attempts: expect.any(Number),
          failures: 1,
          skippedByCircuitBreaker: expect.any(Number),
      },
        circuitBreaker: {
          open: expect.any(Boolean),
          lastFailureReason: "compaction backend unavailable",
        },
        lastResult: {
          summarizerObservability: {
            mode: "rolling",
            cacheAlignedRequested: true,
            cacheSupport: "supported",
            cacheHitTokens: 640,
            cacheMissTokens: 32,
            cacheSavingsUsd: 0.000123,
            usedWireApi: "chat_completions",
            compareAvailable: true,
            comparison: {
              mode: "cache_aligned_vs_plain",
              plainRequestMessageCount: 1,
              cacheAlignedRequestMessageCount: 4,
              plainPromptCharsEstimate: 1200,
              cacheAlignedReplayCharsEstimate: 980,
              cacheAlignedInstructionChars: 180,
              replayOverheadChars: 0,
            },
            strategy: {
              kind: "cache_aligned",
              providerCacheMode: "supported",
              selectionReason: "provider_cache_supported_with_context",
              degradePath: "cache_aligned_then_compaction_fallback",
              providerModelNotes: "cache=supported, json=medium, route=deepseek-flash",
              fallbackPolicy: "fallback_summary_on_request_or_parse_or_budget_failure",
              fallbackTriggered: true,
              fallbackSummary: "model_failure_fallback",
            },
            fallbackStage: "model_failure",
            failureReason: "compaction backend unavailable",
          },
        },
      });
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "compaction_runtime",
        status: "warn",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes runtime resilience summary and launch explainability signal", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const tracker = new RuntimeResilienceTracker({
    stateDir,
    routing: {
      primary: {
        profileId: "primary",
        provider: "openai.com",
        model: "gpt-4.1",
      },
      fallbacks: [
        {
          profileId: "backup",
          provider: "moonshot.ai",
          model: "kimi-k2",
        },
      ],
      compaction: {
        configured: true,
        sharesPrimaryRoute: false,
        route: {
          profileId: "compaction",
          provider: "openai.com",
          model: "gpt-4.1-mini",
        },
      },
    },
  });
  tracker.record({
    source: "openai_chat",
    phase: "primary_chat",
    agentId: "default",
    conversationId: "conv-runtime-resilience",
    summary: {
      configuredProfiles: [
        { profileId: "primary", provider: "openai.com", model: "gpt-4.1" },
        { profileId: "backup", provider: "moonshot.ai", model: "kimi-k2" },
      ],
      finalStatus: "success",
      finalProfileId: "backup",
      finalProvider: "moonshot.ai",
      finalModel: "kimi-k2",
      requestCount: 2,
      failedStageCount: 1,
      degraded: true,
      stepCounts: {
        cooldownSkips: 0,
        sameProfileRetries: 1,
        crossProfileFallbacks: 1,
        terminalFailures: 0,
      },
      reasonCounts: {
        server_error: 1,
      },
      steps: [],
      startedAt: Date.now() - 500,
      updatedAt: Date.now(),
      durationMs: 500,
    },
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    getRuntimeResilienceReport: () => tracker.getReport(),
    inspectAgentPrompt: async () => ({
      agentId: "default",
      sections: [],
      text: "system prompt",
      metadata: {},
      prompt: "system prompt",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "hello" },
      ],
      createdAt: Date.now(),
      tokenBreakdown: {
        systemPromptEstimatedChars: 12,
        systemPromptEstimatedTokens: 4,
        sectionEstimatedChars: 0,
        sectionEstimatedTokens: 0,
        droppedSectionEstimatedChars: 0,
        droppedSectionEstimatedTokens: 0,
        deltaEstimatedChars: 0,
        deltaEstimatedTokens: 0,
        providerNativeSystemBlockEstimatedChars: 0,
        providerNativeSystemBlockEstimatedTokens: 0,
      },
      counts: {
        sectionCount: 0,
        droppedSectionCount: 0,
        deltaCount: 0,
        providerNativeSystemBlockCount: 0,
      },
      promptSizes: {
        totalChars: 12,
        finalChars: 12,
      },
    } as any),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-runtime-resilience",
      method: "system.doctor",
      params: {
        promptAgentId: "default",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-runtime-resilience"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-runtime-resilience");

    expect(response.ok).toBe(true);
    expect(response.payload?.runtimeResilience).toMatchObject({
      routing: {
        primary: {
          provider: "openai.com",
          model: "gpt-4.1",
        },
      },
      latest: {
        finalStatus: "success",
        finalProfileId: "backup",
        degraded: true,
      },
    });
    expect(response.payload?.runtimeResilienceDiagnostics).toMatchObject({
      alertLevel: "warn",
      alertCode: "recent_degrade",
      alertMessage: "Latest runtime required retry/fallback to recover.",
      dominantReason: "server_error",
      reasonClusterSummary: "server_error",
      mixedSignalHint: null,
      recoveryHint: "5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.",
      latestSignal: "openai_chat/primary_chat | agent=default | conv=conv-runtime-resilience",
      latestRouteBehavior: "switched primary/gpt-4.1 -> backup/kimi-k2",
      latestReasonSummary: "server_error=1",
      totalsSummary: "observed=1, degraded=1, failed=0, retry=1, switch=1, cooldown=0",
    });
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime_resilience",
        status: "warn",
        message: "recent_degrade: Latest runtime required retry/fallback to recover.",
      }),
    ]));
    expect(response.payload?.promptObservability?.launchExplainability).toMatchObject({
      runtimeResilience: {
        alertLevel: "warn",
        alertCode: "recent_degrade",
        alertMessage: "Latest runtime required retry/fallback to recover.",
        dominantReason: "server_error",
        reasonClusterSummary: "server_error",
        mixedSignalHint: null,
        recoveryHint: "5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.",
        configuredFallbackCount: 1,
        latestStatus: "success",
        latestRoute: "backup/kimi-k2",
        latestSignal: "openai_chat/primary_chat | agent=default | conv=conv-runtime-resilience",
        latestRouteBehavior: "switched primary/gpt-4.1 -> backup/kimi-k2",
        latestReasonSummary: "server_error=1",
        totalsSummary: "observed=1, degraded=1, failed=0, retry=1, switch=1, cooldown=0",
      },
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor surfaces a configured compaction route in runtime resilience payload", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-compaction-routing-"));
  const tracker = new RuntimeResilienceTracker({
    stateDir,
    routing: {
      primary: {
        profileId: "primary",
        provider: "openai.com",
        model: "gpt-5",
      },
      fallbacks: [
        {
          profileId: "openrouter-mini",
          provider: "openrouter.ai",
          model: "openai/gpt-4.1-mini",
          wireApi: "responses",
        },
      ],
      compaction: {
        configured: true,
        sharesPrimaryRoute: false,
        route: {
          profileId: "compaction",
          provider: "openrouter.ai",
          model: "openai/gpt-4.1-mini",
          wireApi: "responses",
        },
        auxSummaryVerdict: {
          strategy: "deepseek_flash_preferred",
          enabled: true,
          reason: "deepseek_primary_with_flash_candidate",
        },
      },
    },
  });

  await withEnv({}, async () => {
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      getRuntimeResilienceReport: () => tracker.getReport(),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);
      frames.length = 0;

      ws.send(JSON.stringify({ type: "req", id: "doctor-compaction-route", method: "system.doctor", params: {} }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "doctor-compaction-route"));
      const response = frames.find((f) => f.type === "res" && f.id === "doctor-compaction-route");
      expect(response.ok).toBe(true);

      expect(response.payload?.runtimeResilience?.routing?.compaction).toMatchObject({
        configured: true,
        sharesPrimaryRoute: false,
        route: {
          profileId: "compaction",
          provider: "openrouter.ai",
          model: "openai/gpt-4.1-mini",
          wireApi: "responses",
        },
        auxSummaryVerdict: {
          strategy: "deepseek_flash_preferred",
          enabled: true,
          reason: "deepseek_primary_with_flash_candidate",
        },
      });
      expect(response.payload?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "runtime_resilience_compaction_aux_verdict",
          status: "pass",
          message: "deepseek_flash_preferred / deepseek_primary_with_flash_candidate / enabled=yes",
        }),
      ]));
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("system.doctor exposes recent query runtime lifecycle traces", async () => {
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
      id: "query-runtime-message-send",
      method: "message.send",
      params: { text: "追踪这一轮 runtime" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "query-runtime-message-send" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final"));

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-query-runtime", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-query-runtime"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-query-runtime");

    expect(response.ok).toBe(true);
    expect(response.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "query_runtime_trace",
        status: "pass",
      }),
    ]));
    expect(response.payload?.queryRuntime?.observerEnabled).toBe(true);
    expect(response.payload?.queryRuntime?.totalObservedEvents).toBeGreaterThan(0);
    expect(response.payload?.queryRuntime?.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: "query-runtime-message-send",
        method: "message.send",
        status: "completed",
        latestStage: "completed",
      }),
    ]));

    const trace = response.payload?.queryRuntime?.traces?.find((item: any) => item.traceId === "query-runtime-message-send");
    const stages = trace?.stages ?? [];
    expect(trace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "request_validated",
      "conversation_loaded",
      "agent_running",
      "assistant_persisted",
      "completed",
    ]));
    expect(stages[stages.length - 1]?.stage).toBe("completed");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes agent stop diagnostics from recent query runtime traces", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-stop-runtime-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => ({
      async *run(input) {
        yield { type: "status" as const, status: "running" };
        await new Promise((resolve) => setTimeout(resolve, 180));
        if (input.abortSignal?.aborted) {
          yield { type: "status" as const, status: "stopped" };
          return;
        }
        yield { type: "final" as const, text: `done:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    }),
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
      id: "doctor-stop-message-send",
      method: "message.send",
      params: {
        conversationId: "conv-doctor-stop-runtime",
        text: "请停止这轮运行",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "doctor-stop-message-send" && f.ok === true));
    const sendRes = frames.find((f) => f.type === "res" && f.id === "doctor-stop-message-send");

    ws.send(JSON.stringify({
      type: "req",
      id: "doctor-stop-run",
      method: "conversation.run.stop",
      params: {
        conversationId: "conv-doctor-stop-runtime",
        runId: sendRes?.payload?.runId,
        reason: "Stopped by user.",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "doctor-stop-run" && f.ok === true));

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-stop-runtime", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-stop-runtime"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-stop-runtime");

    expect(response.ok).toBe(true);
    expect(response.payload?.queryRuntime?.stopDiagnostics).toMatchObject({
      available: true,
      totalRequests: 1,
      acceptedRequests: 1,
      stoppedRuns: 0,
      runningAfterStopCount: 1,
      completedAfterStopCount: 0,
      failedAfterStopCount: 0,
      notFoundCount: 0,
      runMismatchCount: 0,
    });
    expect(response.payload?.queryRuntime?.stopDiagnostics?.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId: "conv-doctor-stop-runtime",
        runId: sendRes?.payload?.runId,
        reason: "Stopped by user.",
        outcome: "running_after_stop",
        messageStatus: "running",
      }),
    ]));

    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "conversation.run.stopped"
      && f.payload?.conversationId === "conv-doctor-stop-runtime"
    ));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes delegation observability summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const protocolTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-doctor",
      agentId: "coder",
      instruction: "Protocol-backed task",
      delegationProtocol: {
        source: "goal_subtask",
        intent: {
          kind: "goal_execution",
          summary: "Protocol-backed task",
          role: "coder",
          goalId: "goal-main",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: ["goalId"],
        },
        expectedDeliverable: {
          format: "patch",
          summary: "Ship a patch",
        },
        aggregationPolicy: {
          mode: "main_agent_summary",
          summarizeFailures: true,
          sourceAgentIds: ["planner"],
        },
        launchDefaults: {},
      },
    },
  });
  await subTaskRuntimeStore.attachSession(protocolTask.id, "sub_doctor_1");

  const plainTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-doctor",
      agentId: "reviewer",
      instruction: "Legacy task",
    },
  });
  await subTaskRuntimeStore.completeTask(plainTask.id, {
    status: "done",
    output: "legacy task done",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-delegation",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-delegation"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-delegation");
    expect(res.ok).toBe(true);
    expect(res.payload?.delegationObservability?.summary).toMatchObject({
      totalCount: 2,
      protocolBackedCount: 1,
      activeCount: 1,
      completedCount: 1,
      sourceCounts: {
        goal_subtask: 1,
      },
      aggregationModeCounts: {
        main_agent_summary: 1,
      },
    });
    expect(res.payload?.delegationObservability?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: protocolTask.id,
        agentId: "coder",
        status: "running",
        source: "goal_subtask",
        aggregationMode: "main_agent_summary",
        expectedDeliverableFormat: "patch",
        expectedDeliverableSummary: "Ship a patch",
      }),
    ]));
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "delegation_protocol",
        name: "Delegation Protocol",
        status: "pass",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes cron runtime summary when provided", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    getCronRuntimeDoctorReport: async () => ({
      scheduler: {
        enabled: true,
        running: true,
        activeRuns: 2,
        lastTickAtMs: 1_710_000_000_000,
      },
      totals: {
        totalJobs: 3,
        enabledJobs: 2,
        disabledJobs: 1,
        staggeredJobs: 1,
        invalidNextRunJobs: 0,
      },
      sessionTargetCounts: {
        main: 1,
        isolated: 2,
      },
      deliveryModeCounts: {
        user: 2,
        none: 1,
      },
      failureDestinationModeCounts: {
        user: 1,
        none: 2,
      },
      recentJobs: [
        {
          id: "cron-job-1",
          name: "Digest",
          enabled: true,
          scheduleSummary: "every 60000ms",
          sessionTarget: "main",
          deliveryMode: "user",
          failureDestinationMode: "user",
          staggerMs: 15_000,
          nextRunAtMs: 1_710_000_060_000,
          lastStatus: "ok",
        },
      ],
      headline: "enabled; jobs=2/3; session main=1; isolated=2; delivery user=2; none=1; stagger=1; activeRuns=2",
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-cron-runtime",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-cron-runtime"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-cron-runtime");
    expect(res.ok).toBe(true);
    expect(res.payload?.cronRuntime).toMatchObject({
      scheduler: {
        enabled: true,
        running: true,
        activeRuns: 2,
      },
      totals: {
        totalJobs: 3,
        enabledJobs: 2,
        staggeredJobs: 1,
      },
      sessionTargetCounts: {
        main: 1,
        isolated: 2,
      },
      deliveryModeCounts: {
        user: 2,
        none: 1,
      },
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "cron_runtime",
        name: "Cron Runtime",
        status: "pass",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes background continuation runtime summary when provided", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    getBackgroundContinuationRuntimeDoctorReport: async () => ({
      totals: {
        totalRuns: 3,
        runningRuns: 1,
        failedRuns: 1,
        skippedRuns: 1,
        conversationLinkedRuns: 2,
        recoverableFailedRuns: 1,
        recoveryAttemptedRuns: 2,
        recoverySucceededRuns: 1,
      },
      kindCounts: {
        cron: 2,
        heartbeat: 1,
        subtask: 0,
      },
      sessionTargetCounts: {
        main: 1,
        isolated: 1,
      },
      recentEntries: [
        {
          runId: "cron-run-1",
          kind: "cron",
          sourceId: "cron-job-1",
          label: "Digest",
          status: "ran",
          startedAt: 1_710_000_000_000,
          updatedAt: 1_710_000_000_200,
          finishedAt: 1_710_000_000_200,
          conversationId: "cron-main:cron-job-1",
          sessionTarget: "main",
          latestRecoveryOutcome: "succeeded",
          latestRecoveryRunId: "cron-run-2",
          latestRecoveryReason: "Recovered on retry",
          continuationState: {
            version: 1,
            scope: "background",
            targetId: "cron-job-1",
            recommendedTargetId: "cron-main:cron-job-1",
            targetType: "conversation",
            resumeMode: "cron_main_conversation",
            summary: "Digest completed.",
            nextAction: "Open the linked conversation.",
            checkpoints: {
              openCount: 0,
              blockerCount: 0,
              labels: ["scope:cron", "session:main"],
            },
            progress: {
              current: "cron:ran",
              recent: ["Digest completed."],
            },
          },
        },
      ],
      headline: "runs=3; running=1; failed=1; skipped=1; recoverable=1; recovery=1/2; cron=2; heartbeat=1; linked=2; main=1; isolated=1",
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-background-continuation-runtime",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-background-continuation-runtime"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-background-continuation-runtime");
    expect(res.ok).toBe(true);
    expect(res.payload?.backgroundContinuationRuntime).toMatchObject({
      totals: {
        totalRuns: 3,
        runningRuns: 1,
        failedRuns: 1,
      },
      kindCounts: {
        cron: 2,
        heartbeat: 1,
        subtask: 0,
      },
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "background_continuation_runtime",
        name: "Background Continuation Runtime",
        status: "warn",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes assistant mode runtime summary from proactive runtime inputs", async () => {
  await withEnv({
    BELLDANDY_ASSISTANT_MODE_ENABLED: "true",
    BELLDANDY_HEARTBEAT_ENABLED: "true",
    BELLDANDY_HEARTBEAT_INTERVAL: "45m",
    BELLDANDY_HEARTBEAT_ACTIVE_HOURS: "08:00-23:00",
    BELLDANDY_CRON_ENABLED: "true",
    BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
    BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: "qq,feishu,community,discord",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      getCronRuntimeDoctorReport: async () => ({
        scheduler: {
          enabled: true,
          running: true,
          activeRuns: 1,
        },
        totals: {
          totalJobs: 3,
          enabledJobs: 2,
          disabledJobs: 1,
          staggeredJobs: 1,
          invalidNextRunJobs: 0,
        },
        sessionTargetCounts: {
          main: 1,
          isolated: 2,
        },
        deliveryModeCounts: {
          user: 2,
          none: 1,
        },
        failureDestinationModeCounts: {
          user: 1,
          none: 2,
        },
        recentJobs: [
          {
            id: "cron-job-1",
            name: "Digest",
            enabled: true,
            scheduleSummary: "every 60000ms",
            sessionTarget: "main",
            deliveryMode: "user",
            failureDestinationMode: "user",
            lastStatus: "ok",
          },
        ],
        headline: "enabled",
      }),
      getBackgroundContinuationRuntimeDoctorReport: async () => ({
        totals: {
          totalRuns: 3,
          runningRuns: 1,
          failedRuns: 1,
          skippedRuns: 0,
          conversationLinkedRuns: 2,
          recoverableFailedRuns: 1,
          recoveryAttemptedRuns: 1,
          recoverySucceededRuns: 0,
        },
        kindCounts: {
          cron: 1,
          heartbeat: 1,
          subtask: 1,
        },
        sessionTargetCounts: {
          main: 1,
          isolated: 1,
        },
        recentEntries: [
          {
            runId: "heartbeat-run-1",
            kind: "heartbeat",
            sourceId: "heartbeat",
            label: "Heartbeat",
            status: "running",
            startedAt: 1_710_000_000_000,
            updatedAt: 1_710_000_000_100,
            conversationId: "heartbeat-1",
            continuationState: {
              version: 1,
              scope: "background",
              targetId: "heartbeat",
              recommendedTargetId: "heartbeat-1",
              targetType: "conversation",
              resumeMode: "heartbeat_conversation",
              summary: "Heartbeat follow-up",
              nextAction: "Open heartbeat conversation.",
              checkpoints: {
                openCount: 0,
                blockerCount: 0,
                labels: [],
              },
              progress: {
                current: "heartbeat:running",
                recent: ["heartbeat:running"],
              },
            },
          },
          {
            runId: "subtask-run-1",
            kind: "subtask",
            sourceId: "task-1",
            label: "Subtask",
            status: "failed",
            startedAt: 1_710_000_000_200,
            updatedAt: 1_710_000_000_300,
            continuationState: {
              version: 1,
              scope: "subtask",
              targetId: "task-1",
              recommendedTargetId: "task-1",
              targetType: "conversation",
              resumeMode: "subtask_resume",
              summary: "Subtask failed",
              nextAction: "Resume subtask.",
              checkpoints: {
                openCount: 0,
                blockerCount: 1,
                labels: ["blocked"],
              },
              progress: {
                current: "subtask:failed",
                recent: ["subtask:failed"],
              },
            },
          },
          {
            runId: "cron-run-1",
            kind: "cron",
            sourceId: "cron-job-1",
            label: "Digest",
            status: "ran",
            startedAt: 1_710_000_000_400,
            updatedAt: 1_710_000_000_500,
            finishedAt: 1_710_000_000_500,
            sessionTarget: "main",
            summary: "Digest delivered.",
            nextRunAtMs: 1_710_000_600_000,
            continuationState: {
              version: 1,
              scope: "background",
              targetId: "cron-job-1",
              recommendedTargetId: "cron-main:cron-job-1",
              targetType: "conversation",
              resumeMode: "cron_main_conversation",
              summary: "Digest delivered.",
              nextAction: "Open cron conversation.",
              checkpoints: {
                openCount: 0,
                blockerCount: 0,
                labels: ["scope:cron"],
              },
              progress: {
                current: "cron:ran",
                recent: ["cron:ran"],
              },
            },
          },
        ],
        headline: "runs=3",
      }),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      await pairWebSocketClient(ws, frames, stateDir);

      ws.send(JSON.stringify({
        type: "req",
        id: "system-doctor-assistant-mode-runtime",
        method: "system.doctor",
        params: {},
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-assistant-mode-runtime"));

      const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-assistant-mode-runtime");
      expect(res.ok).toBe(true);
      expect(res.payload?.assistantModeRuntime).toMatchObject({
        available: true,
        enabled: true,
        status: "running",
        controls: {
          assistantModeEnabled: true,
          assistantModeSource: "explicit",
          assistantModeMismatch: false,
          heartbeatEnabled: true,
          heartbeatInterval: "45m",
          activeHours: "08:00-23:00",
          cronEnabled: true,
        },
        sources: {
          heartbeat: {
            enabled: true,
            interval: "45m",
            lastStatus: "running",
          },
          cron: {
            enabled: true,
            schedulerRunning: true,
            activeRuns: 1,
            totalJobs: 3,
            enabledJobs: 2,
            userDeliveryJobs: 2,
            lastStatus: "ran",
          },
        },
        delivery: {
          residentChannel: true,
          externalDeliveryPreference: ["qq", "feishu", "community", "discord"],
          confirmationRequired: true,
        },
        explanation: {
          nextAction: {
            summary: "Continue Heartbeat",
            targetId: "heartbeat-1",
            targetType: "conversation",
          },
        },
      });
      expect(res.payload?.assistantModeRuntime?.recentActions).toHaveLength(2);
      expect(res.payload?.assistantModeRuntime?.recentActions?.map((item: any) => item.kind)).toEqual(["heartbeat", "cron"]);
      expect(res.payload?.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "assistant_mode",
          name: "Assistant Mode",
          status: "pass",
        }),
      ]));
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("cron.run_now executes immediate cron runtime requests when provided", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const runCronJobNow = vi.fn(async (jobId: string) => ({
    status: "ok" as const,
    runId: `cron-run-${jobId}`,
    summary: "cron job executed immediately",
  }));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    runCronJobNow,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "cron-run-now",
      method: "cron.run_now",
      params: { jobId: "job-live" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "cron-run-now"));

    const res = frames.find((f) => f.type === "res" && f.id === "cron-run-now");
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      jobId: "job-live",
      status: "ok",
      runId: "cron-run-job-live",
      summary: "cron job executed immediately",
    });
    expect(runCronJobNow).toHaveBeenCalledWith("job-live");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("cron.recovery.run executes targeted cron recovery requests when provided", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const runCronRecovery = vi.fn(async (jobId: string) => ({
    outcome: "succeeded" as const,
    sourceRunId: `cron-failed-${jobId}`,
    recoveryRunId: `cron-recovered-${jobId}`,
    reason: "recovered from latest failure",
  }));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    runCronRecovery,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "cron-recovery-run",
      method: "cron.recovery.run",
      params: { jobId: "job-live" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "cron-recovery-run"));

    const res = frames.find((f) => f.type === "res" && f.id === "cron-recovery-run");
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      jobId: "job-live",
      outcome: "succeeded",
      sourceRunId: "cron-failed-job-live",
      recoveryRunId: "cron-recovered-job-live",
      reason: "recovered from latest failure",
    });
    expect(runCronRecovery).toHaveBeenCalledWith("job-live");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes external outbound runtime summary when audit data is available", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const previousConfirm = process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION;
  process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION = "false";
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    externalOutboundAuditStore: {
      async append() {},
      async listRecent() {
        return [
          {
            timestamp: 1710000000000,
            sourceConversationId: "conv-1",
            sourceChannel: "webchat" as const,
            targetChannel: "feishu" as const,
            targetSessionKey: "channel=feishu:chat=chat-1",
            resolution: "latest_binding" as const,
            decision: "confirmed" as const,
            delivery: "sent" as const,
            contentPreview: "hello",
          },
          {
            timestamp: 1710000002000,
            sourceConversationId: "conv-2",
            sourceChannel: "webchat" as const,
            targetChannel: "qq" as const,
            requestedSessionKey: "channel=qq:chat=chat-2",
            resolution: "explicit_session_key" as const,
            decision: "auto_approved" as const,
            delivery: "failed" as const,
            contentPreview: "resolve fail",
            errorCode: "binding_not_found",
            error: "not found",
          },
          {
            timestamp: 1710000004000,
            sourceConversationId: "conv-3",
            sourceChannel: "webchat" as const,
            targetChannel: "discord" as const,
            targetSessionKey: "channel=discord:chat=room-1",
            resolution: "latest_binding" as const,
            decision: "confirmed" as const,
            delivery: "failed" as const,
            contentPreview: "send fail",
            errorCode: "send_failed",
            error: "send failed",
          },
        ];
      },
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-external-outbound-runtime",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-external-outbound-runtime"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-external-outbound-runtime");
    expect(res.ok).toBe(true);
    expect(res.payload?.externalOutboundRuntime).toMatchObject({
      requireConfirmation: false,
      health: {
        status: "warn",
        activeFailure: true,
      },
      totals: {
        totalRecords: 3,
        sentCount: 1,
        failedCount: 2,
        resolveFailedCount: 1,
        deliveryFailedCount: 1,
      },
      channelCounts: {
        feishu: 1,
        qq: 1,
        discord: 1,
      },
      errorCodeCounts: {
        binding_not_found: 1,
        send_failed: 1,
      },
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "external_outbound_runtime",
        name: "External Outbound Runtime",
        status: "warn",
      }),
    ]));
  } finally {
    if (typeof previousConfirm === "string") {
      process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION = previousConfirm;
    } else {
      delete process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION;
    }
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor keeps external outbound runtime green after a later success recovers earlier failures", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const previousConfirm = process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION;
  process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION = "true";
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    externalOutboundAuditStore: {
      async append() {},
      async listRecent() {
        return [
          {
            timestamp: 1710000004000,
            sourceConversationId: "conv-3",
            sourceChannel: "webchat" as const,
            targetChannel: "feishu" as const,
            targetSessionKey: "channel=feishu:chat=chat-1",
            resolution: "latest_binding" as const,
            decision: "confirmed" as const,
            delivery: "sent" as const,
            contentPreview: "recovered",
          },
          {
            timestamp: 1710000002000,
            sourceConversationId: "conv-2",
            sourceChannel: "webchat" as const,
            targetChannel: "qq" as const,
            requestedSessionKey: "channel=qq:chat=chat-2",
            resolution: "explicit_session_key" as const,
            decision: "auto_approved" as const,
            delivery: "failed" as const,
            contentPreview: "resolve fail",
            errorCode: "binding_not_found",
            error: "not found",
          },
        ];
      },
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-external-outbound-runtime-recovered",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-external-outbound-runtime-recovered"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-external-outbound-runtime-recovered");
    expect(res.ok).toBe(true);
    expect(res.payload?.externalOutboundRuntime).toMatchObject({
      requireConfirmation: true,
      health: {
        status: "pass",
        activeFailure: false,
        recoveredAfterFailure: true,
      },
      totals: {
        totalRecords: 2,
        sentCount: 1,
        failedCount: 1,
      },
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "external_outbound_runtime",
        name: "External Outbound Runtime",
        status: "pass",
      }),
    ]));
  } finally {
    if (typeof previousConfirm === "string") {
      process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION = previousConfirm;
    } else {
      delete process.env.BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION;
    }
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes email outbound runtime summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const previousConfirm = process.env.BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION;
  process.env.BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION = "true";

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    emailOutboundAuditStore: {
      async append() {},
      async listRecent() {
        return [
          {
            timestamp: 1710000001000,
            sourceConversationId: "conv-email-1",
            sourceChannel: "webchat" as const,
            requestedByAgentId: "default",
            providerId: "smtp",
            accountId: "default",
            to: ["alice@example.com"],
            subject: "Status",
            bodyPreview: "hello",
            attachmentCount: 1,
            threadId: "<thread-001@example.com>",
            replyToMessageId: "<reply-001@example.com>",
            decision: "confirmed" as const,
            delivery: "sent" as const,
            providerMessageId: "<msg-001@example.com>",
            providerThreadId: "<thread-001@example.com>",
          },
          {
            timestamp: 1710000002000,
            sourceConversationId: "conv-email-2",
            sourceChannel: "webchat" as const,
            requestedByAgentId: "default",
            providerId: "smtp",
            accountId: "default",
            to: ["bob@example.com"],
            subject: "Failed",
            bodyPreview: "delivery fail",
            decision: "auto_approved" as const,
            delivery: "failed" as const,
            errorCode: "send_failed",
            error: "smtp timeout",
          },
          {
            timestamp: 1710000003000,
            sourceConversationId: "conv-email-3",
            sourceChannel: "webchat" as const,
            requestedByAgentId: "default",
            providerId: "smtp",
            accountId: "default",
            to: ["carol@example.com"],
            subject: "Rejected",
            bodyPreview: "not sent",
            decision: "rejected" as const,
            delivery: "rejected" as const,
          },
        ];
      },
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-email-outbound-runtime",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-email-outbound-runtime"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-email-outbound-runtime");
    expect(res.ok).toBe(true);
    expect(res.payload?.emailOutboundRuntime).toMatchObject({
      requireConfirmation: true,
      totals: {
        totalRecords: 3,
        sentCount: 1,
        failedCount: 1,
        rejectedCount: 1,
        attachmentRecordCount: 1,
      },
      providerCounts: {
        smtp: 3,
      },
      accountCounts: {
        default: 3,
      },
      errorCodeCounts: {
        send_failed: 1,
      },
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "email_outbound_runtime",
        name: "Email Outbound Runtime",
        status: "warn",
      }),
    ]));
  } finally {
    if (typeof previousConfirm === "string") {
      process.env.BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION = previousConfirm;
    } else {
      delete process.env.BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION;
    }
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes email inbound runtime summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const previousImapEnabled = process.env.BELLDANDY_EMAIL_IMAP_ENABLED;
  const previousImapHost = process.env.BELLDANDY_EMAIL_IMAP_HOST;
  const previousImapUser = process.env.BELLDANDY_EMAIL_IMAP_USER;
  const previousImapPass = process.env.BELLDANDY_EMAIL_IMAP_PASS;
  const previousImapAccountId = process.env.BELLDANDY_EMAIL_IMAP_ACCOUNT_ID;
  const previousImapMailbox = process.env.BELLDANDY_EMAIL_IMAP_MAILBOX;
  const previousInboundAgentId = process.env.BELLDANDY_EMAIL_INBOUND_AGENT_ID;
  process.env.BELLDANDY_EMAIL_IMAP_ENABLED = "true";
  process.env.BELLDANDY_EMAIL_IMAP_HOST = "imap.example.com";
  process.env.BELLDANDY_EMAIL_IMAP_USER = "mailer@example.com";
  process.env.BELLDANDY_EMAIL_IMAP_PASS = "secret";
  process.env.BELLDANDY_EMAIL_IMAP_ACCOUNT_ID = "primary";
  process.env.BELLDANDY_EMAIL_IMAP_MAILBOX = "INBOX";
  process.env.BELLDANDY_EMAIL_INBOUND_AGENT_ID = "default";

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    emailInboundAuditStore: {
      async append() {},
      async listRecent() {
        return [
          {
            timestamp: 1710000001000,
            providerId: "imap",
            accountId: "primary",
            mailbox: "INBOX",
            status: "processed" as const,
            messageId: "<msg-001@example.com>",
            threadId: "<thread-001@example.com>",
            subject: "Inbound ok",
            from: ["alice@example.com"],
            to: ["team@example.com"],
            bodyPreview: "hello",
            attachmentCount: 1,
            conversationId: "conv-email-inbound-1",
            sessionKey: "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-001%40example.com%3E",
            requestedAgentId: "default",
            checkpointUid: 7,
            createdBinding: true,
          },
          {
            timestamp: 1710000002000,
            providerId: "imap",
            accountId: "primary",
            mailbox: "INBOX",
            status: "failed" as const,
            messageId: "<msg-002@example.com>",
            threadId: "<thread-002@example.com>",
            subject: "Inbound failed",
            from: ["bob@example.com"],
            to: ["team@example.com"],
            bodyPreview: "fail",
            errorCode: "ingest_failed",
            error: "agent unavailable",
          },
          {
            timestamp: 1710000003000,
            providerId: "imap",
            accountId: "primary",
            mailbox: "INBOX",
            status: "skipped_duplicate" as const,
            messageId: "<msg-003@example.com>",
            threadId: "<thread-003@example.com>",
            subject: "Inbound duplicate",
            from: ["carol@example.com"],
            to: ["team@example.com"],
            bodyPreview: "dup",
          },
          {
            timestamp: 1710000004000,
            providerId: "imap",
            accountId: "primary",
            mailbox: "INBOX",
            status: "invalid_event" as const,
            subject: "Inbound invalid",
            bodyPreview: "",
            errorCode: "invalid_event",
            error: "messageId is required",
          },
        ];
      },
    },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-email-inbound-runtime",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-email-inbound-runtime"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-email-inbound-runtime");
    expect(res.ok).toBe(true);
    expect(res.payload?.emailInboundRuntime).toMatchObject({
      enabled: true,
      setup: {
        configured: true,
        runtimeExpected: true,
        accountId: "primary",
        host: "imap.example.com",
        mailbox: "INBOX",
        requestedAgentId: "default",
        missingFields: [],
      },
      totals: {
        totalRecords: 4,
        processedCount: 1,
        failedCount: 1,
        invalidEventCount: 1,
        duplicateCount: 1,
        attachmentRecordCount: 1,
        createdBindingCount: 1,
      },
      providerCounts: {
        imap: 4,
      },
      accountCounts: {
        primary: 4,
      },
      mailboxCounts: {
        INBOX: 4,
      },
      errorCodeCounts: {
        ingest_failed: 1,
        invalid_event: 1,
      },
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "email_inbound_runtime",
        name: "Email Inbound Runtime",
        status: "warn",
      }),
    ]));
  } finally {
    if (typeof previousImapEnabled === "string") {
      process.env.BELLDANDY_EMAIL_IMAP_ENABLED = previousImapEnabled;
    } else {
      delete process.env.BELLDANDY_EMAIL_IMAP_ENABLED;
    }
    if (typeof previousImapHost === "string") {
      process.env.BELLDANDY_EMAIL_IMAP_HOST = previousImapHost;
    } else {
      delete process.env.BELLDANDY_EMAIL_IMAP_HOST;
    }
    if (typeof previousImapUser === "string") {
      process.env.BELLDANDY_EMAIL_IMAP_USER = previousImapUser;
    } else {
      delete process.env.BELLDANDY_EMAIL_IMAP_USER;
    }
    if (typeof previousImapPass === "string") {
      process.env.BELLDANDY_EMAIL_IMAP_PASS = previousImapPass;
    } else {
      delete process.env.BELLDANDY_EMAIL_IMAP_PASS;
    }
    if (typeof previousImapAccountId === "string") {
      process.env.BELLDANDY_EMAIL_IMAP_ACCOUNT_ID = previousImapAccountId;
    } else {
      delete process.env.BELLDANDY_EMAIL_IMAP_ACCOUNT_ID;
    }
    if (typeof previousImapMailbox === "string") {
      process.env.BELLDANDY_EMAIL_IMAP_MAILBOX = previousImapMailbox;
    } else {
      delete process.env.BELLDANDY_EMAIL_IMAP_MAILBOX;
    }
    if (typeof previousInboundAgentId === "string") {
      process.env.BELLDANDY_EMAIL_INBOUND_AGENT_ID = previousInboundAgentId;
    } else {
      delete process.env.BELLDANDY_EMAIL_INBOUND_AGENT_ID;
    }
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes deployment backend summary from unified profile config", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  await fs.promises.writeFile(path.join(stateDir, "deployment-backends.json"), `${JSON.stringify({
    version: 1,
    selectedProfileId: "docker-main",
    profiles: [
      {
        id: "local-default",
        label: "Local Default",
        backend: "local",
        enabled: true,
        workspace: {
          mode: "direct",
        },
        credentials: {
          mode: "inherit_env",
        },
        observability: {
          logMode: "local",
        },
      },
      {
        id: "docker-main",
        label: "Docker Main",
        backend: "docker",
        enabled: true,
        runtime: {
          service: "belldandy-gateway",
          composeFile: "docker-compose.yml",
        },
        workspace: {
          mode: "mount",
          remotePath: "/workspace",
        },
        credentials: {
          mode: "env_file",
          ref: ".env.deploy",
        },
        observability: {
          logMode: "docker",
        },
      },
      {
        id: "ssh-burst",
        label: "SSH Burst",
        backend: "ssh",
        enabled: false,
        runtime: {
          host: "gateway.internal",
          user: "admin",
          port: 2222,
        },
        workspace: {
          mode: "sync",
          remotePath: "/srv/star-sanctuary",
        },
        credentials: {
          mode: "ssh_agent",
        },
        observability: {
          logMode: "ssh",
        },
      },
    ],
  }, null, 2)}\n`, "utf-8");

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
      id: "system-doctor-deployment-backends",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-deployment-backends"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-deployment-backends");
    expect(res.ok).toBe(true);
    expect(res.payload?.deploymentBackends).toMatchObject({
      summary: {
        profileCount: 3,
        enabledCount: 2,
        warningCount: 0,
        selectedProfileId: "docker-main",
        selectedResolved: true,
        selectedBackend: "docker",
        backendCounts: {
          local: 1,
          docker: 1,
          ssh: 1,
        },
      },
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "deployment_backends",
        name: "Deployment Backends",
        status: "pass",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor keeps delegation protocol green when only legacy completed subtasks exist", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const legacyTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-doctor-legacy",
      agentId: "reviewer",
      instruction: "Legacy completed task",
    },
  });
  await subTaskRuntimeStore.completeTask(legacyTask.id, {
    status: "done",
    output: "legacy done",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-delegation-legacy-only",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-delegation-legacy-only"));

    const res = frames.find((f) => f.type === "res" && f.id === "system-doctor-delegation-legacy-only");
    expect(res.ok).toBe(true);
    expect(res.payload?.delegationObservability?.summary).toMatchObject({
      totalCount: 1,
      protocolBackedCount: 0,
      activeCount: 0,
      completedCount: 1,
    });
    expect(res.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "delegation_protocol",
        name: "Delegation Protocol",
        status: "pass",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes recent subtask query runtime lifecycle traces", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const runningTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-subtask-trace",
      agentId: "coder",
      instruction: "Need runtime trace",
      channel: "subtask",
    },
  });
  await subTaskRuntimeStore.attachSession(runningTask.id, "sub_trace_1");

  const doneTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-subtask-trace",
      agentId: "reviewer",
      instruction: "Archive me",
    },
  });
  await subTaskRuntimeStore.completeTask(doneTask.id, {
    status: "done",
    output: "archivable output",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
    stopSubTask: async (taskId, reason) => subTaskRuntimeStore.markStopped(taskId, {
      reason: reason ?? "Stopped from trace test.",
      sessionId: "sub_trace_1",
    }),
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-trace-list",
      method: "subtask.list",
      params: { conversationId: "conv-subtask-trace", includeArchived: true },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-trace-get",
      method: "subtask.get",
      params: { taskId: doneTask.id },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-trace-stop",
      method: "subtask.stop",
      params: { taskId: runningTask.id, reason: "Stop for trace" },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-trace-archive",
      method: "subtask.archive",
      params: { taskId: doneTask.id, reason: "Archive for trace" },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-trace-list"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-trace-get"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-trace-stop"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-trace-archive"));

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-subtask-trace", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-subtask-trace"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-subtask-trace");

    expect(response.ok).toBe(true);
    const traces = response.payload?.queryRuntime?.traces ?? [];
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: "subtask-trace-list",
        method: "subtask.list",
        status: "completed",
      }),
      expect.objectContaining({
        traceId: "subtask-trace-get",
        method: "subtask.get",
        status: "completed",
      }),
      expect.objectContaining({
        traceId: "subtask-trace-stop",
        method: "subtask.stop",
        status: "completed",
      }),
      expect.objectContaining({
        traceId: "subtask-trace-archive",
        method: "subtask.archive",
        status: "completed",
      }),
    ]));

    const stopTrace = traces.find((item: any) => item.traceId === "subtask-trace-stop");
    const archiveTrace = traces.find((item: any) => item.traceId === "subtask-trace-archive");
    expect(stopTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "task_loaded",
      "task_stopped",
      "completed",
    ]));
    expect(archiveTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "task_loaded",
      "task_archived",
      "completed",
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes recent workspace query runtime lifecycle traces", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  await fs.promises.mkdir(path.join(stateDir, "docs"), { recursive: true });
  await fs.promises.writeFile(path.join(stateDir, "docs", "note.md"), "# hello", "utf-8");

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

    ws.send(JSON.stringify({ type: "req", id: "workspace-trace-list", method: "workspace.list", params: { path: "docs" } }));
    ws.send(JSON.stringify({ type: "req", id: "workspace-trace-read", method: "workspace.read", params: { path: "docs/note.md" } }));
    ws.send(JSON.stringify({ type: "req", id: "workspace-trace-write", method: "workspace.write", params: { path: "docs/generated.md", content: "generated" } }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-trace-list"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-trace-read"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-trace-write"));

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-workspace-trace", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-workspace-trace"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-workspace-trace");

    expect(response.ok).toBe(true);
    const traces = response.payload?.queryRuntime?.traces ?? [];
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: "workspace-trace-list",
        method: "workspace.list",
        status: "completed",
      }),
      expect.objectContaining({
        traceId: "workspace-trace-read",
        method: "workspace.read",
        status: "completed",
      }),
      expect.objectContaining({
        traceId: "workspace-trace-write",
        method: "workspace.write",
        status: "completed",
      }),
    ]));

    const listTrace = traces.find((item: any) => item.traceId === "workspace-trace-list");
    const readTrace = traces.find((item: any) => item.traceId === "workspace-trace-read");
    const writeTrace = traces.find((item: any) => item.traceId === "workspace-trace-write");
    expect(listTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "workspace_target_resolved",
      "workspace_listed",
      "completed",
    ]));
    expect(readTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "workspace_target_resolved",
      "workspace_read",
      "completed",
    ]));
    expect(writeTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "workspace_target_resolved",
      "workspace_written",
      "completed",
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("system.doctor exposes workspace.readSource and tools query runtime lifecycle traces", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-tools-workspace-"));
  await fs.promises.writeFile(path.join(workspaceRoot, "source.ts"), "export const value = 1;\n", "utf-8");

  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  const confirmationStore = new ToolControlConfirmationStore();
  let toolExecutor!: ToolExecutor;
  toolExecutor = new ToolExecutor({
    tools: [
      createContractedTestTool("alpha_builtin"),
      createContractedTestTool("beta_builtin"),
      createToolSettingsControlTool({
        toolsConfigManager,
        getControlMode: () => "auto",
        listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
        confirmationStore,
      }),
    ],
    workspaceRoot: process.cwd(),
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    additionalWorkspaceRoots: [workspaceRoot],
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
      id: "workspace-trace-read-source",
      method: "workspace.readSource",
      params: { path: path.join(workspaceRoot, "source.ts") },
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "tools-trace-list",
      method: "tools.list",
      params: {},
    }));
    ws.send(JSON.stringify({
      type: "req",
      id: "tools-trace-update",
      method: "tools.update",
      params: { disabled: { builtin: ["alpha_builtin"] } },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "workspace-trace-read-source"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-trace-list"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-trace-update"));

    ws.send(JSON.stringify({ type: "req", id: "system-doctor-tools-workspace-trace", method: "system.doctor", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-tools-workspace-trace"));
    const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-tools-workspace-trace");

    expect(response.ok).toBe(true);
    const traces = response.payload?.queryRuntime?.traces ?? [];
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: "workspace-trace-read-source",
        method: "workspace.readSource",
        status: "completed",
      }),
      expect.objectContaining({
        traceId: "tools-trace-list",
        method: "tools.list",
        status: "completed",
      }),
      expect.objectContaining({
        traceId: "tools-trace-update",
        method: "tools.update",
        status: "completed",
      }),
    ]));

    const sourceTrace = traces.find((item: any) => item.traceId === "workspace-trace-read-source");
    const toolsListTrace = traces.find((item: any) => item.traceId === "tools-trace-list");
    const toolsUpdateTrace = traces.find((item: any) => item.traceId === "tools-trace-update");
    expect(sourceTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "workspace_target_resolved",
      "workspace_source_read",
      "completed",
    ]));
    expect(toolsListTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "tool_inventory_loaded",
      "tool_visibility_built",
      "completed",
    ]));
    expect(toolsUpdateTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
      "request_validated",
      "tool_settings_updated",
      "completed",
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
