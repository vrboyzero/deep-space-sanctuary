import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, MockAgent, normalizeAgentLaunchSpec } from "@belldandy/agent";
import { ToolExecutor } from "@belldandy/skills";
import { PluginRegistry } from "@belldandy/plugins";

import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  createContractedTestTool,
  createWriteContractedTestTool,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";
import { ToolsConfigManager } from "./tools-config.js";

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

test("tools.list resolves launch runtime visibility from subtask taskId", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
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
    workspaceBinding: "custom",
    workspaceDir: "workspace-alpha",
    sessionNamespace: "coder-main",
    memoryMode: "hybrid",
  });
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();
  const repoRoot = path.join(stateDir, "demo-repo");
  const requestedCwd = path.join(repoRoot, "src");
  const worktreeRoot = path.join(stateDir, "virtual-worktree", "demo-repo");
  const resolvedCwd = path.join(worktreeRoot, "src");

  const task = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-runtime",
      agentId: "coder",
      instruction: "Inspect launch runtime visibility",
      cwd: requestedCwd,
      toolSet: ["goal_init", "write_tool"],
      permissionMode: "plan",
      isolationMode: "worktree",
    },
  });
  await subTaskRuntimeStore.updateTaskLaunchSpec(task.id, {
    launchSpec: normalizeAgentLaunchSpec({
      parentConversationId: "conv-runtime",
      agentId: "coder",
      instruction: "Inspect launch runtime visibility",
      cwd: resolvedCwd,
      toolSet: ["goal_init", "write_tool"],
      permissionMode: "plan",
      isolationMode: "worktree",
    }),
    runtimeSummary: {
      requestedCwd,
      resolvedCwd,
      worktreePath: worktreeRoot,
      worktreeRepoRoot: repoRoot,
      worktreeBranch: "belldandy-task_runtime",
      worktreeStatus: "created",
    },
  });

  const toolExecutor = new ToolExecutor({
    tools: [
      createContractedTestTool("goal_init"),
      createContractedTestTool("alpha_builtin"),
      createWriteContractedTestTool("write_tool"),
      createContractedTestTool("plugin_demo_tool"),
      createContractedTestTool("mcp_demo_ping"),
    ],
    workspaceRoot: process.cwd(),
  });
  const pluginRegistry = new PluginRegistry();
  ((pluginRegistry as any).plugins).set("demo-plugin", {
    id: "demo-plugin",
    name: "Demo Plugin",
    activate: async () => {},
  });
  ((pluginRegistry as any).pluginToolMap).set("demo-plugin", ["plugin_demo_tool"]);

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolExecutor,
    agentRegistry: registry,
    toolsConfigManager: await (async () => {
      const manager = new ToolsConfigManager(stateDir);
      await manager.load();
      return manager;
    })(),
    subTaskRuntimeStore,
    pluginRegistry,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "tools-list-task-runtime",
      method: "tools.list",
      params: {
        taskId: task.id,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-task-runtime"));
    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-task-runtime");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.visibilityContext).toMatchObject({
      agentId: "coder",
      conversationId: "conv-runtime",
      residentStateBinding: {
        agentId: "coder",
        workspaceBinding: "custom",
        workspaceDir: "workspace-alpha",
        scopeStateDir: path.join(stateDir, "workspaces", "workspace-alpha"),
        privateStateDir: path.join(stateDir, "workspaces", "workspace-alpha", "agents", "coder"),
        sessionsDir: path.join(stateDir, "workspaces", "workspace-alpha", "agents", "coder", "sessions"),
        sharedStateDir: path.join(stateDir, "workspaces", "workspace-alpha", "team-memory"),
      },
      taskId: task.id,
      launchExplainability: expect.objectContaining({
        effectiveLaunch: expect.objectContaining({
          source: "runtime_launch_spec",
          agentId: "coder",
          profileId: "coder",
          permissionMode: "plan",
        }),
      }),
      launchSpec: {
        permissionMode: "plan",
        isolationMode: "worktree",
        cwd: requestedCwd,
        resolvedCwd,
        worktreePath: worktreeRoot,
        worktreeStatus: "created",
      },
    });
    expect(listRes.payload?.visibility?.goal_init).toMatchObject({
      available: true,
      reasonCode: "available",
    });
    expect(listRes.payload?.visibility?.alpha_builtin).toMatchObject({
      available: false,
      reasonCode: "excluded-by-launch-toolset",
    });
    expect(listRes.payload?.visibility?.write_tool).toMatchObject({
      available: false,
      reasonCode: "blocked-by-launch-permission-mode",
    });
    expect(listRes.payload?.mcpVisibility?.demo).toMatchObject({
      available: false,
      reasonCode: "excluded-by-launch-toolset",
    });
    expect(listRes.payload?.pluginVisibility?.["demo-plugin"]).toMatchObject({
      available: false,
      reasonCode: "excluded-by-launch-toolset",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("task.projection.list exposes a restart-lost subtask as resumable without private child details", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-projection-lost-"));
  const originalStore = new SubTaskRuntimeStore(stateDir);
  await originalStore.load();
  const task = await originalStore.createTask({
    launchSpec: {
      parentConversationId: "conversation-child-crash",
      agentId: "coder",
      instruction: "private child instruction must not enter the task projection",
      cwd: path.join(stateDir, "private-child-workspace"),
    },
    parentOperationId: `op_${"a".repeat(64)}`,
  });
  await originalStore.attachSession(task.id, "subtask-run-before-crash", "coder", "coder");

  const recoveredStore = new SubTaskRuntimeStore(stateDir);
  await recoveredStore.load();
  await expect(recoveredStore.getTask(task.id)).resolves.toMatchObject({
    status: "interrupted",
    recovery: {
      state: "runtime_lost",
      previousStatus: "running",
      mutationReplay: "forbidden",
    },
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore: recoveredStore,
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
      id: "task-projection-child-crash",
      method: "task.projection.list",
      params: {},
    }));
    await waitFor(() => frames.some((frame) => frame.type === "res" && frame.id === "task-projection-child-crash"));

    const response = frames.find((frame) => frame.type === "res" && frame.id === "task-projection-child-crash");
    expect(response).toMatchObject({
      ok: true,
      payload: {
        totalCount: 1,
        items: [{
          taskId: `subtask:${task.id}`,
          status: "interrupted",
          owner: {
            source: "subtask",
            binding: {
              agentRunId: "subtask-run-before-crash",
              conversationId: "conversation-child-crash",
              subtask: { taskId: task.id },
            },
          },
          evidence: {
            reasonCategory: "owner_interrupted",
            reasonCode: "owner_runtime_interrupted",
          },
          allowedActions: ["observe", "resume"],
        }],
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/private child instruction|private-child-workspace|op_a{64}|mutationReplay|previousStatus/);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("tools.list exposes bridge recovery diagnostics for a governed bridge subtask", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();
  await toolsConfigManager.updateConfig({
    builtin: ["bridge_session_close"],
  });

  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();
  const task = await subTaskRuntimeStore.createBridgeSessionTask({
    parentConversationId: "conv-bridge-runtime",
    agentId: "coder",
    profileId: "coder",
    instruction: "Inspect bridge recovery diagnostics.",
    bridgeSubtask: {
      kind: "review",
      targetId: "codex_session",
      action: "interactive",
      summary: "Inspect bridge recovery diagnostics.",
    },
    bridgeSession: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
      summary: "Inspect bridge recovery diagnostics.",
    },
  });

  const toolExecutor = new ToolExecutor({
    tools: [
      createWriteContractedTestTool("bridge_session_start"),
      createWriteContractedTestTool("bridge_session_write"),
      createWriteContractedTestTool("bridge_session_close"),
    ],
    workspaceRoot: process.cwd(),
    isToolDisabled: (name) => toolsConfigManager.isToolDisabled(name),
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
      id: "tools-list-bridge-recovery",
      method: "tools.list",
      params: {
        taskId: task.id,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "tools-list-bridge-recovery"));

    const listRes = frames.find((f) => f.type === "res" && f.id === "tools-list-bridge-recovery");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.visibilityContext?.bridgeRecoveryDiagnostics).toMatchObject({
      applicable: true,
      status: "blocked",
      taskId: task.id,
      blockedTools: ["bridge_session_close"],
      whitelistBypassedTools: [
        "bridge_session_start",
        "bridge_session_write",
      ],
      runtimeContext: {
        bridgeGovernanceTaskId: task.id,
        agentWhitelistMode: "governed_bridge_internal",
      },
    });
    expect(listRes.payload?.visibilityContext?.bridgeRecoveryDiagnostics?.tools).toEqual(expect.arrayContaining([
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
      }),
      expect.objectContaining({
        name: "bridge_session_close",
        governedVisibility: expect.objectContaining({
          available: false,
          reasonCode: "disabled-by-settings",
        }),
        effectiveDecision: "blocked",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.stop and subtask.archive manage task runtime visibility", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const runningTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-stop",
      agentId: "coder",
      instruction: "Need manual stop",
      channel: "subtask",
    },
  });
  await subTaskRuntimeStore.attachSession(runningTask.id, "sub_stop_1");

  const doneTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-stop",
      agentId: "reviewer",
      instruction: "Can be archived",
    },
  });
  await subTaskRuntimeStore.completeTask(doneTask.id, {
    status: "done",
    output: "finished already",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
    stopSubTask: async (taskId, reason, options) => {
      const accepted = await subTaskRuntimeStore.requestStop(taskId, reason ?? "Stopped from RPC.", {
        sessionId: "sub_stop_1",
        expectedRevision: options?.expectedRevision,
        idempotencyKey: options?.idempotencyKey,
      });
      if (!accepted || !accepted.claimOwner) return accepted?.item;
      return subTaskRuntimeStore.markStopped(taskId, {
        reason: reason ?? "Stopped from RPC.",
        sessionId: "sub_stop_1",
        commandClaim: accepted.commandClaim,
      });
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
      id: "subtask-stop",
      method: "subtask.stop",
      params: { taskId: runningTask.id, reason: "User requested stop", expectedRevision: 0 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-stop"));

    const stopRes = frames.find((f) => f.type === "res" && f.id === "subtask-stop");
    expect(stopRes.ok).toBe(true);
    expect(stopRes.payload?.item).toMatchObject({
      id: runningTask.id,
      status: "stopped",
      stopReason: "User requested stop",
      commandGeneration: 1,
    });
    expect(stopRes.payload?.item).not.toHaveProperty("activeCommandClaim");

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-archive",
      method: "subtask.archive",
      params: { taskId: doneTask.id, reason: "Clean up finished task" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-archive"));

    const archiveRes = frames.find((f) => f.type === "res" && f.id === "subtask-archive");
    expect(archiveRes.ok).toBe(true);
    expect(archiveRes.payload?.item).toMatchObject({
      id: doneTask.id,
      archiveReason: "Clean up finished task",
      archivedAt: expect.any(Number),
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-list-default",
      method: "subtask.list",
      params: { conversationId: "conv-stop" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-list-default"));

    const defaultListRes = frames.find((f) => f.type === "res" && f.id === "subtask-list-default");
    expect(defaultListRes.ok).toBe(true);
    expect(defaultListRes.payload).not.toHaveProperty("page");
    expect(defaultListRes.payload?.items).toEqual([
      expect.objectContaining({
        id: runningTask.id,
        status: "stopped",
      }),
    ]);

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-list-archived",
      method: "subtask.list",
      params: { conversationId: "conv-stop", includeArchived: true },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-list-archived"));

    const archivedListRes = frames.find((f) => f.type === "res" && f.id === "subtask-list-archived");
    expect(archivedListRes.ok).toBe(true);
    expect(archivedListRes.payload?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: runningTask.id, status: "stopped" }),
      expect.objectContaining({ id: doneTask.id, archivedAt: expect.any(Number) }),
    ]));

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-list-page-1",
      method: "subtask.list",
      params: { conversationId: "conv-stop", includeArchived: true, limit: 1 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-list-page-1"));

    const firstPageRes = frames.find((f) => f.type === "res" && f.id === "subtask-list-page-1");
    expect(firstPageRes.ok).toBe(true);
    expect(firstPageRes.payload?.items).toHaveLength(1);
    expect(firstPageRes.payload?.page).toMatchObject({
      limit: 1,
      hasMore: true,
      nextCursor: expect.any(String),
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-list-page-2",
      method: "subtask.list",
      params: {
        conversationId: "conv-stop",
        includeArchived: true,
        limit: 1,
        cursor: firstPageRes.payload.page.nextCursor,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-list-page-2"));

    const secondPageRes = frames.find((f) => f.type === "res" && f.id === "subtask-list-page-2");
    expect(secondPageRes.ok).toBe(true);
    expect(secondPageRes.payload?.items).toHaveLength(1);
    expect(secondPageRes.payload?.page).toEqual({ limit: 1, hasMore: false });
    expect(new Set([
      firstPageRes.payload.items[0].id,
      secondPageRes.payload.items[0].id,
    ])).toEqual(new Set([runningTask.id, doneTask.id]));

    for (const [id, paginationParams] of [
      ["subtask-list-invalid-cursor", { cursor: "not-json" }],
      ["subtask-list-invalid-limit", { limit: 201 }],
    ] as const) {
      ws.send(JSON.stringify({
        type: "req",
        id,
        method: "subtask.list",
        params: { conversationId: "conv-stop", ...paginationParams },
      }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === id));
      const invalidRes = frames.find((f) => f.type === "res" && f.id === id);
      expect(invalidRes.ok).toBe(false);
      expect(invalidRes.error?.code).toBe("invalid_params");
    }
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.update accepts steering for a running task and returns the updated record", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const runningTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-update",
      agentId: "coder",
      instruction: "Need steering",
      channel: "subtask",
    },
  });
  await subTaskRuntimeStore.attachSession(runningTask.id, "sub_update_1");
  let receivedCommandOptions: { expectedRevision?: number; idempotencyKey?: string } | undefined;

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
    updateSubTask: async (taskId, message, options) => {
      receivedCommandOptions = options;
      const accepted = await subTaskRuntimeStore.requestSteering(taskId, message, {
        sessionId: "sub_update_1",
        expectedRevision: options?.expectedRevision,
        idempotencyKey: options?.idempotencyKey,
      });
      await subTaskRuntimeStore.markSteeringDelivered(taskId, String(accepted?.steering.id), {
        sessionId: "sub_update_2",
      });
      return subTaskRuntimeStore.getTask(taskId);
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
      id: "subtask-update",
      method: "subtask.update",
      params: {
        taskId: runningTask.id,
        message: "Focus on the integration failure first.",
        expectedRevision: 0,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-update"));

    const updateRes = frames.find((f) => f.type === "res" && f.id === "subtask-update");
    expect(updateRes.ok).toBe(true);
    expect(receivedCommandOptions).toEqual({
      expectedRevision: 0,
      idempotencyKey: "subtask-update",
    });
    expect(updateRes.payload?.item).toMatchObject({
      id: runningTask.id,
      sessionId: "sub_update_1",
      steering: [
        expect.objectContaining({
          message: "Focus on the integration failure first.",
          status: "delivered",
          deliveredSessionId: "sub_update_2",
        }),
      ],
    });

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-update-stale",
      method: "subtask.update",
      params: {
        taskId: runningTask.id,
        message: "This stale command must not create another accepted record.",
        expectedRevision: 0,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-update-stale"));

    const staleRes = frames.find((f) => f.type === "res" && f.id === "subtask-update-stale");
    expect(staleRes).toMatchObject({
      ok: false,
      error: {
        code: "revision_conflict",
        message: "Subtask command revision conflict. Expected 0, current 1.",
      },
    });
    expect((await subTaskRuntimeStore.getTask(runningTask.id))?.steering).toHaveLength(1);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.resume accepts continuation for a finished task and returns the updated record", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const finishedTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-resume",
      agentId: "coder",
      instruction: "Need continuation",
      channel: "subtask",
    },
  });
  await subTaskRuntimeStore.attachSession(finishedTask.id, "sub_resume_1");
  await subTaskRuntimeStore.completeTask(finishedTask.id, {
    status: "done",
    sessionId: "sub_resume_1",
    output: "first pass output",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
    resumeSubTask: async (taskId, message) => {
      const accepted = await subTaskRuntimeStore.requestResume(taskId, message || "", {
        sessionId: "sub_resume_1",
      });
      await subTaskRuntimeStore.markResumeDelivered(taskId, String(accepted?.resume.id), {
        sessionId: "sub_resume_2",
        resumedFromSessionId: "sub_resume_1",
      });
      return subTaskRuntimeStore.getTask(taskId);
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
      id: "subtask-resume",
      method: "subtask.resume",
      params: {
        taskId: finishedTask.id,
        message: "Continue from the first pass and finish the missing validations.",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-resume"));

    const resumeRes = frames.find((f) => f.type === "res" && f.id === "subtask-resume");
    expect(resumeRes.ok).toBe(true);
    expect(resumeRes.payload?.item).toMatchObject({
      id: finishedTask.id,
      sessionId: "sub_resume_1",
      resume: [
        expect.objectContaining({
          message: "Continue from the first pass and finish the missing validations.",
          status: "delivered",
          deliveredSessionId: "sub_resume_2",
          resumedFromSessionId: "sub_resume_1",
        }),
      ],
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.takeover accepts takeover for a finished task and returns the updated record", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const finishedTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-takeover",
      agentId: "coder",
      instruction: "Need takeover",
      channel: "subtask",
    },
  });
  await subTaskRuntimeStore.attachSession(finishedTask.id, "sub_takeover_1", "coder");
  await subTaskRuntimeStore.completeTask(finishedTask.id, {
    status: "done",
    sessionId: "sub_takeover_1",
    output: "first pass output",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
    takeoverSubTask: async (taskId, agentId, message) => {
      const accepted = await subTaskRuntimeStore.requestResume(taskId, message || "", {
        sessionId: "sub_takeover_1",
      });
      await subTaskRuntimeStore.attachSession(taskId, "sub_takeover_2", agentId);
      await subTaskRuntimeStore.markResumeDelivered(taskId, String(accepted?.resume.id), {
        sessionId: "sub_takeover_2",
        resumedFromSessionId: "sub_takeover_1",
      });
      return subTaskRuntimeStore.getTask(taskId);
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
      id: "subtask-takeover",
      method: "subtask.takeover",
      params: {
        taskId: finishedTask.id,
        agentId: "researcher",
        message: "Continue with verification-focused follow-up.",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-takeover"));

    const takeoverRes = frames.find((f) => f.type === "res" && f.id === "subtask-takeover");
    expect(takeoverRes.ok).toBe(true);
    expect(takeoverRes.payload?.item).toMatchObject({
      id: finishedTask.id,
      sessionId: "sub_takeover_2",
      agentId: "researcher",
      launchSpec: {
        agentId: "researcher",
      },
      resume: [
        expect.objectContaining({
          message: "Continue with verification-focused follow-up.",
          status: "delivered",
          deliveredSessionId: "sub_takeover_2",
          resumedFromSessionId: "sub_takeover_1",
        }),
      ],
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.takeover accepts safe-point takeover for a running task and returns the updated record", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const runningTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-safe-point-takeover",
      agentId: "coder",
      instruction: "Need safe-point takeover",
      channel: "subtask",
    },
  });
  await subTaskRuntimeStore.attachSession(runningTask.id, "sub_safe_point_takeover_1", "coder");

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    subTaskRuntimeStore,
    takeoverSubTask: async (taskId, agentId, message) => {
      const accepted = await subTaskRuntimeStore.requestTakeover(taskId, agentId, message || "", {
        sessionId: "sub_safe_point_takeover_1",
        mode: "safe_point",
      });
      await subTaskRuntimeStore.attachSession(taskId, "sub_safe_point_takeover_2", agentId, agentId);
      await subTaskRuntimeStore.markTakeoverDelivered(taskId, String(accepted?.takeover.id), {
        sessionId: "sub_safe_point_takeover_2",
        resumedFromSessionId: "sub_safe_point_takeover_1",
      });
      return subTaskRuntimeStore.getTask(taskId);
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
      id: "subtask-safe-point-takeover",
      method: "subtask.takeover",
      params: {
        taskId: runningTask.id,
        agentId: "researcher",
        message: "Stop at a safe point and continue with verification.",
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-safe-point-takeover"));

    const takeoverRes = frames.find((f) => f.type === "res" && f.id === "subtask-safe-point-takeover");
    expect(takeoverRes.ok).toBe(true);
    expect(takeoverRes.payload?.item).toMatchObject({
      id: runningTask.id,
      sessionId: "sub_safe_point_takeover_2",
      agentId: "researcher",
      launchSpec: {
        agentId: "researcher",
        profileId: "researcher",
      },
      takeover: [
        expect.objectContaining({
          agentId: "researcher",
          mode: "safe_point",
          status: "delivered",
          deliveredSessionId: "sub_safe_point_takeover_2",
          resumedFromSessionId: "sub_safe_point_takeover_1",
        }),
      ],
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
