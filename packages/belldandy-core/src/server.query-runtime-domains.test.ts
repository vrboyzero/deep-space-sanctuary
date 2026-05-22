import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";
import { ToolExecutor } from "@belldandy/skills";

import { persistConversationPromptSnapshot } from "./conversation-prompt-snapshot.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  createContractedTestTool,
  createTestTool,
  createWriteContractedTestTool,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";
import { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import { ToolsConfigManager } from "./tools-config.js";

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

test("tool_settings.confirm rejects pending request without applying config change", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const confirmationStore = new ToolControlConfirmationStore();
  confirmationStore.create({
    requestId: "UI001",
    conversationId: "conv-webchat-reject",
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

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    toolsConfigManager,
    toolControlConfirmationStore: confirmationStore,
    getAgentToolControlMode: () => "confirm",
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir, "cli");
    frames.length = 0;

    ws.send(JSON.stringify({
      type: "req",
      id: "reject-webchat-confirm",
      method: "tool_settings.confirm",
      params: {
        requestId: "UI001",
        conversationId: "conv-webchat-reject",
        decision: "reject",
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "reject-webchat-confirm" && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "tool_settings.confirm.resolved"));

    expect(toolsConfigManager.getConfig().disabled.builtin).toEqual([]);
    expect(confirmationStore.get("UI001")).toBeUndefined();

    const resolvedEvent = frames.find((f) => f.type === "event" && f.event === "tool_settings.confirm.resolved");
    expect(resolvedEvent?.payload?.decision).toBe("rejected");
    expect(frames.some((f) => f.type === "event" && f.event === "tools.config.updated")).toBe(false);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("agent.contracts.get exposes tool contract v2 summary", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const toolExecutor = new ToolExecutor({
    tools: [
      createContractedTestTool("run_command"),
      createContractedTestTool("apply_patch"),
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
    await pairWebSocketClient(ws, frames, stateDir, "node");

    ws.send(JSON.stringify({ type: "req", id: "agent-contracts-get", method: "agent.contracts.get", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "agent-contracts-get"));
    const res = frames.find((f) => f.type === "res" && f.id === "agent-contracts-get");

    expect(res.ok).toBe(true);
    expect(res.payload?.summary).toMatchObject({
      totalCount: 2,
      missingV2Count: 1,
      governedTools: ["apply_patch", "run_command"],
      missingV2Tools: ["beta_builtin"],
    });
    expect(res.payload?.contracts?.run_command).toMatchObject({
      recommendedWhen: expect.any(Array),
      preflightChecks: expect.any(Array),
      hasGovernanceContract: true,
      hasBehaviorContract: true,
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("agent.contracts.get filters gateway-only write contracts for web clients", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const toolExecutor = new ToolExecutor({
    tools: [
      createWriteContractedTestTool("workspace_write"),
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

    ws.send(JSON.stringify({ type: "req", id: "agent-contracts-get-web", method: "agent.contracts.get", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "agent-contracts-get-web"));
    const res = frames.find((f) => f.type === "res" && f.id === "agent-contracts-get-web");

    expect(res.ok).toBe(true);
    expect(res.payload?.summary).toMatchObject({
      totalCount: 0,
      missingV2Count: 1,
      missingV2Tools: ["beta_builtin"],
    });
    expect(res.payload?.contracts?.workspace_write).toBeUndefined();
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("agent.contracts.get exposes write contracts for cli clients", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const toolsConfigManager = new ToolsConfigManager(stateDir);
  await toolsConfigManager.load();

  const toolExecutor = new ToolExecutor({
    tools: [
      createWriteContractedTestTool("workspace_write"),
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
    await pairWebSocketClient(ws, frames, stateDir, "cli");

    ws.send(JSON.stringify({ type: "req", id: "agent-contracts-get-cli", method: "agent.contracts.get", params: {} }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "agent-contracts-get-cli"));
    const res = frames.find((f) => f.type === "res" && f.id === "agent-contracts-get-cli");

    expect(res.ok).toBe(true);
    expect(res.payload?.summary).toMatchObject({
      totalCount: 1,
      missingV2Count: 1,
      missingV2Tools: ["beta_builtin"],
    });
    expect(res.payload?.contracts?.workspace_write).toBeDefined();
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.list and subtask.get expose persisted task runtime records", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();
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
    workspaceBinding: "current",
    workspaceDir: "coder",
  });

  const targetTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-subtask",
      agentId: "coder",
      instruction: "Implement structured task runtime",
      timeoutMs: 90_000,
      channel: "goal",
      toolSet: ["read", "edit"],
      delegationProtocol: {
        source: "delegate_task",
        intent: {
          kind: "ad_hoc",
          summary: "Implement structured task runtime",
          role: "coder",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: ["taskId", "workspace"],
        },
        expectedDeliverable: {
          format: "patch",
          summary: "Return the patch summary",
        },
        aggregationPolicy: {
          mode: "single",
          summarizeFailures: true,
          sourceAgentIds: ["planner", "reviewer"],
        },
        ownership: {
          scopeSummary: "Own the task runtime implementation only.",
          outOfScope: ["UI rewrites"],
        },
        acceptance: {
          doneDefinition: "Return whether the runtime change is ready to merge.",
          verificationHints: ["Check the diff", "Check targeted tests"],
        },
        deliverableContract: {
          format: "patch",
          requiredSections: ["Changes made", "Verification"],
        },
        launchDefaults: {
          permissionMode: "workspace_write",
          allowedToolFamilies: ["workspace-read", "workspace-write"],
          maxToolRiskLevel: "medium",
        },
      },
      bridgeSubtask: {
        kind: "review",
        targetId: "codex_exec",
        action: "review",
        goalId: "goal_bridge_1",
        goalNodeId: "node_bridge_review",
        summary: "Review the bridge patch output before returning the result.",
      },
    },
  });
  await subTaskRuntimeStore.markQueued(targetTask.id, 1);
  await subTaskRuntimeStore.attachSession(targetTask.id, "sub_task_1");
  await subTaskRuntimeStore.completeTask(targetTask.id, {
    status: "done",
    sessionId: "sub_task_1",
    output: "structured runtime finished",
  });
  await persistConversationPromptSnapshot({
    stateDir,
    snapshot: {
      agentId: "coder",
      conversationId: "sub_task_1",
      runId: "run-subtask-1",
      createdAt: 1712000000100,
      systemPrompt: "Ship the patch and keep the diff small.",
      messages: [
        { role: "system", content: "Ship the patch and keep the diff small." },
        { role: "user", content: "Implement structured task runtime" },
      ],
      hookSystemPromptUsed: false,
    },
  });

  const otherTask = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-other",
      agentId: "researcher",
      instruction: "Should not appear in filtered results",
    },
  });
  await subTaskRuntimeStore.completeTask(otherTask.id, {
    status: "error",
    output: "",
    error: "other task failed",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
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
      id: "subtask-list",
      method: "subtask.list",
      params: { conversationId: "conv-subtask" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-list"));

    const listRes = frames.find((f) => f.type === "res" && f.id === "subtask-list");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.conversationId).toBe("conv-subtask");
    expect(listRes.payload?.items).toEqual([
      expect.objectContaining({
        id: targetTask.id,
        parentConversationId: "conv-subtask",
        sessionId: "sub_task_1",
        agentId: "coder",
        status: "done",
        outputPreview: "structured runtime finished",
        launchSpec: expect.objectContaining({
          profileId: "coder",
          channel: "goal",
          timeoutMs: 90_000,
          toolSet: ["read", "edit"],
          bridgeSubtask: {
            kind: "review",
            targetId: "codex_exec",
            action: "review",
            goalId: "goal_bridge_1",
            goalNodeId: "node_bridge_review",
            summary: "Review the bridge patch output before returning the result.",
          },
          delegation: expect.objectContaining({
            source: "delegate_task",
            intentKind: "ad_hoc",
            expectedDeliverableFormat: "patch",
            aggregationMode: "single",
            sourceAgentIds: ["planner", "reviewer"],
          }),
        }),
        bridgeSubtaskView: {
          kind: "review",
          label: "Bridge review",
          badge: "bridge/review",
          targetRef: "codex_exec.review",
          summaryLine: "Bridge review via codex_exec.review: Review the bridge patch output before returning the result.",
        },
        bridgeSubtaskIndex: {
          badge: "bridge/review",
          kind: "review",
          targetId: "codex_exec",
          action: "review",
          targetRef: "codex_exec.review",
          goalId: "goal_bridge_1",
          goalNodeId: "node_bridge_review",
        },
      }),
    ]);

    ws.send(JSON.stringify({
      type: "req",
      id: "subtask-get",
      method: "subtask.get",
      params: { taskId: targetTask.id },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-get"));

    const getRes = frames.find((f) => f.type === "res" && f.id === "subtask-get");
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.item).toMatchObject({
      id: targetTask.id,
      sessionId: "sub_task_1",
      status: "done",
      outputPath: expect.any(String),
      reviewPath: expect.any(String),
      lessonPath: expect.any(String),
      launchSpec: expect.objectContaining({
        profileId: "coder",
        channel: "goal",
        bridgeSubtask: {
          kind: "review",
          targetId: "codex_exec",
          action: "review",
          goalId: "goal_bridge_1",
          goalNodeId: "node_bridge_review",
          summary: "Review the bridge patch output before returning the result.",
        },
        delegation: expect.objectContaining({
          source: "delegate_task",
          intentSummary: "Implement structured task runtime",
          expectedDeliverableSummary: "Return the patch summary",
          contextKeys: ["taskId", "workspace"],
        }),
      }),
      bridgeSubtaskView: {
        kind: "review",
        label: "Bridge review",
        badge: "bridge/review",
        targetRef: "codex_exec.review",
        summaryLine: "Bridge review via codex_exec.review: Review the bridge patch output before returning the result.",
      },
      bridgeSubtaskIndex: {
        badge: "bridge/review",
        kind: "review",
        targetId: "codex_exec",
        action: "review",
        targetRef: "codex_exec.review",
        goalId: "goal_bridge_1",
        goalNodeId: "node_bridge_review",
      },
    });
    expect(getRes.payload?.reviewContent).toContain("# Commander Review - coder @");
    expect(getRes.payload?.reviewContent).toContain("## 审查发现");
    expect(getRes.payload?.lessonContent).toContain("# Lessons Learned - coder @");
    expect(getRes.payload?.lessonContent).toContain("## 可复用信号");
    expect(getRes.payload?.bridgeSubtaskView).toMatchObject({
      kind: "review",
      label: "Bridge review",
      badge: "bridge/review",
      targetRef: "codex_exec.review",
      summaryLine: "Bridge review via codex_exec.review: Review the bridge patch output before returning the result.",
    });
    expect(getRes.payload?.bridgeSubtaskIndex).toMatchObject({
      badge: "bridge/review",
      kind: "review",
      targetId: "codex_exec",
      action: "review",
      targetRef: "codex_exec.review",
      goalId: "goal_bridge_1",
      goalNodeId: "node_bridge_review",
    });
    expect(getRes.payload?.continuationState).toMatchObject({
      version: 1,
      scope: "subtask",
      targetId: targetTask.id,
      recommendedTargetId: "sub_task_1",
      targetType: "session",
      resumeMode: "rerun",
    });
    expect(getRes.payload?.launchExplainability).toMatchObject({
      catalogDefault: {
        permissionMode: "workspace_write",
        allowedToolFamilies: ["workspace-read", "workspace-write"],
        maxToolRiskLevel: "medium",
      },
      effectiveLaunch: {
        source: "runtime_launch_spec",
        agentId: "coder",
        profileId: "coder",
        permissionMode: "workspace_write",
        allowedToolFamilies: ["workspace-read", "workspace-write"],
        maxToolRiskLevel: "medium",
      },
      delegationReason: {
        source: "delegate_task",
        intentKind: "ad_hoc",
        intentSummary: "Implement structured task runtime",
        expectedDeliverableSummary: "Return the patch summary",
        aggregationMode: "single",
        contextKeys: ["taskId", "workspace"],
        sourceAgentIds: ["planner", "reviewer"],
      },
    });
    expect(getRes.payload?.item?.launchSpec?.delegation).toMatchObject({
      ownership: {
        scopeSummary: "Own the task runtime implementation only.",
        outOfScope: ["UI rewrites"],
      },
      acceptance: {
        doneDefinition: "Return whether the runtime change is ready to merge.",
        verificationHints: ["Check the diff", "Check targeted tests"],
      },
      deliverableContract: {
        format: "patch",
        requiredSections: ["Changes made", "Verification"],
      },
    });
    expect(getRes.payload?.promptSnapshotView).toMatchObject({
      snapshot: {
        manifest: {
          conversationId: "sub_task_1",
          runId: "run-subtask-1",
          agentId: "coder",
        },
        summary: {
          messageCount: 2,
        },
        snapshot: {
          systemPrompt: "Ship the patch and keep the diff small.",
        },
      },
      residentStateBinding: {
        agentId: "coder",
      },
      launchExplainability: {
        effectiveLaunch: {
          source: "runtime_launch_spec",
          agentId: "coder",
          profileId: "coder",
        },
      },
    });
    expect(getRes.payload?.acceptanceGate).toMatchObject({
      status: "rejected",
      enforced: true,
      deliverableFormat: "patch",
      doneDefinitionCheck: "missing",
      requiredSections: ["Changes made", "Verification"],
      missingRequiredSections: ["Changes made", "Verification"],
      rejectionConfidence: "high",
      managerActionHint: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
    });
    expect(getRes.payload?.resultEnvelope).toMatchObject({
      taskId: targetTask.id,
      sessionId: "sub_task_1",
      agentId: "coder",
      status: "done",
      summary: "structured runtime finished",
      outputPath: expect.any(String),
      outputPreview: "structured runtime finished",
    });
    expect(getRes.payload?.outputContent).toBe("structured runtime finished");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.get exposes team shared state and completion gate summaries", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();
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
    workspaceBinding: "current",
    workspaceDir: "coder",
  });
  registry.register({
    id: "verifier",
    displayName: "Verifier",
    model: "primary",
  });

  const teamRoster = [
    {
      laneId: "lane_1",
      agentId: "coder",
      role: "coder" as const,
      scopeSummary: "Implement lane A only.",
      handoffTo: ["lane_2"],
    },
    {
      laneId: "lane_2",
      agentId: "verifier",
      role: "verifier" as const,
      scopeSummary: "Verify lane A and report merge readiness.",
      dependsOn: ["lane_1"],
    },
  ];

  const lane1Task = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-team-subtask",
      agentId: "coder",
      instruction: "Implement lane A",
      delegationProtocol: {
        source: "delegate_parallel",
        intent: {
          kind: "parallel_subtasks",
          summary: "Implement lane A",
          role: "coder",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: ["teamId", "laneId"],
        },
        expectedDeliverable: {
          format: "patch",
          summary: "Return the lane implementation summary.",
        },
        aggregationPolicy: {
          mode: "parallel_collect",
          summarizeFailures: true,
        },
        ownership: {
          scopeSummary: "Implement lane A only.",
          writeScope: ["packages/lane-a.ts"],
        },
        team: {
          id: "team-100",
          mode: "parallel_subtasks",
          sharedGoal: "Implement lane A and verify it before manager fan-in.",
          managerAgentId: "default",
          currentLaneId: "lane_1",
          memberRoster: teamRoster,
        },
        launchDefaults: {},
      },
    },
  });
  await subTaskRuntimeStore.attachSession(lane1Task.id, "sub_team_lane_1");
  await subTaskRuntimeStore.completeTask(lane1Task.id, {
    status: "done",
    sessionId: "sub_team_lane_1",
    output: "Implemented lane A successfully.",
  });

  const lane2Task = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-team-subtask",
      agentId: "verifier",
      instruction: "Verify lane A",
      delegationProtocol: {
        source: "delegate_parallel",
        intent: {
          kind: "verifier_handoff",
          summary: "Verify lane A",
          role: "verifier",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: ["teamId", "laneId"],
        },
        expectedDeliverable: {
          format: "verification_report",
          summary: "Return the lane verification verdict.",
        },
        aggregationPolicy: {
          mode: "parallel_collect",
          summarizeFailures: true,
        },
        ownership: {
          scopeSummary: "Verify lane A and report merge readiness.",
        },
        deliverableContract: {
          format: "verification_report",
          requiredSections: ["Findings", "Recommendation"],
        },
        team: {
          id: "team-100",
          mode: "parallel_subtasks",
          sharedGoal: "Implement lane A and verify it before manager fan-in.",
          managerAgentId: "default",
          currentLaneId: "lane_2",
          memberRoster: teamRoster,
        },
        launchDefaults: {},
      },
    },
  });
  await subTaskRuntimeStore.attachSession(lane2Task.id, "sub_team_lane_2");
  await subTaskRuntimeStore.completeTask(lane2Task.id, {
    status: "done",
    sessionId: "sub_team_lane_2",
    output: "## Findings\n- Lane A still needs a recommendation section before merge.",
  });

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentRegistry: registry,
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
      id: "subtask-team-get",
      method: "subtask.get",
      params: { taskId: lane2Task.id },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "subtask-team-get"));

    const getRes = frames.find((f) => f.type === "res" && f.id === "subtask-team-get");
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.teamSharedState).toMatchObject({
      teamId: "team-100",
      mode: "parallel_subtasks",
      sharedGoal: "Implement lane A and verify it before manager fan-in.",
      managerAgentId: "default",
      currentLaneId: "lane_2",
      completionGate: {
        status: "pending",
        finalFanInVerdict: "hold_fan_in",
        acceptedLaneIds: ["lane_1"],
        retryLaneIds: ["lane_2"],
        blockerLaneIds: [],
        missingLaneIds: [],
        unresolvedDependencyLaneIds: [],
      },
    });
    expect(getRes.payload?.teamSharedState?.fanInSummary).toContain("accepted=lane_1");
    expect(getRes.payload?.teamSharedState?.fanInSummary).toContain("retry=lane_2");
    expect(getRes.payload?.teamSharedState?.roster).toEqual(expect.arrayContaining([
      expect.objectContaining({
        laneId: "lane_1",
        taskId: lane1Task.id,
        agentId: "coder",
        role: "coder",
        laneState: "accepted",
        handoffTo: ["lane_2"],
      }),
      expect.objectContaining({
        laneId: "lane_2",
        taskId: lane2Task.id,
        agentId: "verifier",
        role: "verifier",
        laneState: "retry",
        dependsOn: ["lane_1"],
        acceptanceGateStatus: "rejected",
      }),
    ]));
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask.list and subtask.get expose bridge session runtime visibility", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const artifactPath = path.join(
    stateDir,
    "generated",
    "agent-bridge",
    "sessions",
    "bridge_runtime_query_1",
    "summary.json",
  );
  const transcriptPath = path.join(
    stateDir,
    "generated",
    "agent-bridge",
    "sessions",
    "bridge_runtime_query_1",
    "transcript.json",
  );

  const task = await subTaskRuntimeStore.createBridgeSessionTask({
    parentConversationId: "conv-bridge-query",
    agentId: "coder",
    profileId: "coder",
    instruction: "Recover the runtime-lost bridge session.",
    summary: "Recover runtime-lost bridge session.",
    bridgeSession: {
      targetId: "codex_session",
      action: "interactive",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex interactive",
      firstTurnStrategy: "start-args-prompt",
      recommendedReadWaitMs: 10_000,
      summary: "Recover runtime-lost bridge session.",
    },
  });
  await subTaskRuntimeStore.attachSession(task.id, "bridge_runtime_query_1", "coder", "coder");
  await subTaskRuntimeStore.completeTask(task.id, {
    status: "error",
    sessionId: "bridge_runtime_query_1",
    output: `Bridge session closed (runtime-lost). Audit artifact: ${artifactPath}`,
    error: "Bridge session runtime lost before the session could be resumed.",
    bridgeSessionRuntime: {
      state: "runtime-lost",
      closeReason: "runtime-lost",
      artifactPath,
      transcriptPath,
      blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
    },
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
      id: "bridge-subtask-list",
      method: "subtask.list",
      params: { conversationId: "conv-bridge-query" },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "bridge-subtask-list"));

    const listRes = frames.find((f) => f.type === "res" && f.id === "bridge-subtask-list");
    expect(listRes.ok).toBe(true);
    expect(listRes.payload?.items).toEqual([
      expect.objectContaining({
        id: task.id,
        kind: "bridge_session",
        status: "error",
        sessionId: "bridge_runtime_query_1",
        bridgeSessionRuntime: {
          state: "runtime-lost",
          closeReason: "runtime-lost",
          artifactPath,
          transcriptPath,
          blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
        },
        bridgeSessionView: {
          label: "Bridge session",
          badge: "bridge/session",
          targetRef: "codex_session.interactive",
          transport: "pty",
          cwd: stateDir,
          commandPreview: "codex interactive",
          runtimeState: "runtime-lost",
          closeReason: "runtime-lost",
          artifactPath,
          transcriptPath,
          blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
          summaryLine: "Bridge session runtime-lost via codex_session.interactive: Recover runtime-lost bridge session.",
        },
        bridgeSessionIndex: {
          badge: "bridge/session",
          targetId: "codex_session",
          action: "interactive",
          targetRef: "codex_session.interactive",
          transport: "pty",
          runtimeState: "runtime-lost",
          closeReason: "runtime-lost",
          artifactPath,
          transcriptPath,
          blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
        },
      }),
    ]);

    ws.send(JSON.stringify({
      type: "req",
      id: "bridge-subtask-get",
      method: "subtask.get",
      params: { taskId: task.id },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "bridge-subtask-get"));

    const getRes = frames.find((f) => f.type === "res" && f.id === "bridge-subtask-get");
    expect(getRes.ok).toBe(true);
    expect(getRes.payload?.item).toMatchObject({
      id: task.id,
      kind: "bridge_session",
      bridgeSessionRuntime: {
        state: "runtime-lost",
        closeReason: "runtime-lost",
        artifactPath,
        transcriptPath,
        blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
      },
      bridgeSessionView: {
        label: "Bridge session",
        badge: "bridge/session",
        targetRef: "codex_session.interactive",
        runtimeState: "runtime-lost",
        closeReason: "runtime-lost",
        artifactPath,
        transcriptPath,
        blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
      },
      bridgeSessionIndex: {
        badge: "bridge/session",
        targetId: "codex_session",
        action: "interactive",
        runtimeState: "runtime-lost",
        closeReason: "runtime-lost",
        artifactPath,
        transcriptPath,
        blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
      },
    });
    expect(getRes.payload?.bridgeSessionView).toMatchObject({
      label: "Bridge session",
      badge: "bridge/session",
      targetRef: "codex_session.interactive",
      runtimeState: "runtime-lost",
      closeReason: "runtime-lost",
      artifactPath,
      transcriptPath,
      blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
      summaryLine: "Bridge session runtime-lost via codex_session.interactive: Recover runtime-lost bridge session.",
    });
    expect(getRes.payload?.bridgeSessionIndex).toMatchObject({
      badge: "bridge/session",
      targetId: "codex_session",
      action: "interactive",
      targetRef: "codex_session.interactive",
      transport: "pty",
      runtimeState: "runtime-lost",
      closeReason: "runtime-lost",
      artifactPath,
      transcriptPath,
      blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("delegation.inspect.get exposes persisted delegation snapshot", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
  await subTaskRuntimeStore.load();

  const task = await subTaskRuntimeStore.createTask({
    launchSpec: {
      parentConversationId: "conv-delegation",
      agentId: "researcher",
      instruction: "Collect delegation context",
      delegationProtocol: {
        source: "delegate_parallel",
        intent: {
          kind: "parallel_subtasks",
          summary: "Collect delegation context",
          role: "researcher",
          goalId: "goal-1",
          nodeId: "node-1",
          planId: "plan-1",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: ["goalId", "topic"],
        },
        expectedDeliverable: {
          format: "research_notes",
          summary: "Return research notes",
        },
        aggregationPolicy: {
          mode: "parallel_collect",
          summarizeFailures: true,
          sourceAgentIds: ["planner", "resident-a"],
        },
        launchDefaults: {},
      },
    },
  });
  await subTaskRuntimeStore.attachSession(task.id, "sub_research_1");
  await subTaskRuntimeStore.completeTask(task.id, {
    status: "done",
    sessionId: "sub_research_1",
    output: "delegation context collected",
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
      id: "delegation-inspect",
      method: "delegation.inspect.get",
      params: { taskId: task.id },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "delegation-inspect"));

    const res = frames.find((f) => f.type === "res" && f.id === "delegation-inspect");
    expect(res.ok).toBe(true);
    expect(res.payload?.task).toMatchObject({
      id: task.id,
      parentConversationId: "conv-delegation",
      agentId: "researcher",
      status: "done",
    });
    expect(res.payload?.delegation).toMatchObject({
      source: "delegate_parallel",
      intentKind: "parallel_subtasks",
      intentSummary: "Collect delegation context",
      role: "researcher",
      expectedDeliverableFormat: "research_notes",
      expectedDeliverableSummary: "Return research notes",
      aggregationMode: "parallel_collect",
      sourceAgentIds: ["planner", "resident-a"],
      goalId: "goal-1",
      nodeId: "node-1",
      planId: "plan-1",
      launchDefaults: {},
    });
    expect(res.payload?.launchExplainability).toMatchObject({
      catalogDefault: {},
      effectiveLaunch: {
        agentId: "researcher",
        role: null,
        permissionMode: null,
        allowedToolFamilies: [],
        maxToolRiskLevel: null,
      },
      delegationReason: {
        source: "delegate_parallel",
        intentKind: "parallel_subtasks",
        expectedDeliverableSummary: "Return research notes",
        aggregationMode: "parallel_collect",
        sourceAgentIds: ["planner", "resident-a"],
      },
    });
    expect(res.payload?.explainability).toMatchObject({
      effectiveLaunch: {
        agentId: "researcher",
      },
      delegationReason: {
        source: "delegate_parallel",
      },
    });
    expect(res.payload?.resultEnvelope).toMatchObject({
      taskId: task.id,
      sessionId: "sub_research_1",
      status: "done",
      summary: "delegation context collected",
    });
  } finally {
    ws.close();
    await closeP;
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("external_outbound.audit.list returns recent audit records via websocket rpc", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    externalOutboundAuditStore: {
      async append() {},
      async listRecent(limit: number) {
        expect(limit).toBe(2);
        return [
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
      id: "external-outbound-audit-list",
      method: "external_outbound.audit.list",
      params: { limit: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "external-outbound-audit-list"));

    const res = frames.find((f) => f.type === "res" && f.id === "external-outbound-audit-list");
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      limit: 2,
      items: [
        expect.objectContaining({
          sourceConversationId: "conv-2",
          targetChannel: "qq",
          errorCode: "binding_not_found",
        }),
        expect.objectContaining({
          sourceConversationId: "conv-3",
          targetChannel: "discord",
          errorCode: "send_failed",
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

test("email_outbound.audit.list returns recent audit records via websocket rpc", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    emailOutboundAuditStore: {
      async append() {},
      async listRecent(limit: number) {
        expect(limit).toBe(2);
        return [
          {
            timestamp: 1710000002000,
            sourceConversationId: "conv-email-2",
            sourceChannel: "webchat" as const,
            requestedByAgentId: "default",
            providerId: "smtp",
            accountId: "default",
            to: ["alice@example.com"],
            subject: "Status",
            bodyPreview: "preview",
            attachmentCount: 1,
            threadId: "<thread-001@example.com>",
            replyToMessageId: "<reply-001@example.com>",
            decision: "confirmed" as const,
            delivery: "sent" as const,
            providerMessageId: "<msg-001@example.com>",
          },
          {
            timestamp: 1710000004000,
            sourceConversationId: "conv-email-3",
            sourceChannel: "webchat" as const,
            requestedByAgentId: "default",
            providerId: "smtp",
            accountId: "default",
            to: ["bob@example.com"],
            subject: "Send fail",
            bodyPreview: "send fail",
            decision: "auto_approved" as const,
            delivery: "failed" as const,
            errorCode: "send_failed",
            error: "smtp timeout",
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
      id: "email-outbound-audit-list",
      method: "email_outbound.audit.list",
      params: { limit: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "email-outbound-audit-list"));

    const res = frames.find((f) => f.type === "res" && f.id === "email-outbound-audit-list");
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      limit: 2,
      items: [
        expect.objectContaining({
          sourceConversationId: "conv-email-2",
          providerId: "smtp",
          attachmentCount: 1,
        }),
        expect.objectContaining({
          sourceConversationId: "conv-email-3",
          providerId: "smtp",
          errorCode: "send_failed",
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

test("email_inbound.audit.list returns recent audit records via websocket rpc", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    emailInboundAuditStore: {
      async append() {},
      async listRecent(limit: number) {
        expect(limit).toBe(2);
        return [
          {
            timestamp: 1710000005000,
            providerId: "imap",
            accountId: "primary",
            mailbox: "INBOX",
            status: "processed" as const,
            messageId: "<msg-100@example.com>",
            threadId: "<thread-100@example.com>",
            subject: "Inbound ok",
            from: ["alice@example.com"],
            to: ["team@example.com"],
            bodyPreview: "hello",
            attachmentCount: 1,
            conversationId: "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-100%40example.com%3E",
            sessionKey: "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-100%40example.com%3E",
            requestedAgentId: "default",
            checkpointUid: 42,
            createdBinding: true,
          },
          {
            timestamp: 1710000006000,
            providerId: "imap",
            accountId: "primary",
            mailbox: "INBOX",
            status: "failed" as const,
            messageId: "<msg-101@example.com>",
            threadId: "<thread-101@example.com>",
            subject: "Inbound failed",
            from: ["bob@example.com"],
            to: ["team@example.com"],
            bodyPreview: "fail",
            errorCode: "ingest_failed",
            error: "agent unavailable",
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
      id: "email-inbound-audit-list",
      method: "email_inbound.audit.list",
      params: { limit: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "email-inbound-audit-list"));

    const res = frames.find((f) => f.type === "res" && f.id === "email-inbound-audit-list");
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      limit: 2,
      items: [
        expect.objectContaining({
          providerId: "imap",
          status: "processed",
          checkpointUid: 42,
        }),
        expect.objectContaining({
          providerId: "imap",
          status: "failed",
          errorCode: "ingest_failed",
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

test("email_followup.list returns recent reminder records via websocket rpc", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    emailFollowUpReminderStore: {
      async upsert() {
        throw new Error("not implemented in test");
      },
      async markDelivered() {
        return undefined;
      },
      async resolveByThread() {
        return undefined;
      },
      async listDue() {
        return [];
      },
      async listRecent(limit: number) {
        expect(limit).toBe(2);
        return [
          {
            id: "provider=imap:account=primary:thread=%3Cthread-200%40example.com%3E",
            providerId: "imap",
            accountId: "primary",
            threadId: "<thread-200@example.com>",
            conversationId: "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-200%40example.com%3E",
            requestedAgentId: "default",
            messageId: "<msg-200@example.com>",
            subject: "Reminder pending",
            triageSummary: "needs a reply",
            followUpWindowHours: 24,
            dueAt: 1710000010000,
            status: "pending" as const,
            createdAt: 1710000000000,
            updatedAt: 1710000000000,
            deliveryCount: 0,
          },
          {
            id: "provider=imap:account=primary:thread=%3Cthread-201%40example.com%3E",
            providerId: "imap",
            accountId: "primary",
            threadId: "<thread-201@example.com>",
            conversationId: "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-201%40example.com%3E",
            requestedAgentId: "default",
            messageId: "<msg-201@example.com>",
            subject: "Reminder delivered",
            triageSummary: "follow up tomorrow",
            followUpWindowHours: 48,
            dueAt: 1710000020000,
            status: "delivered" as const,
            createdAt: 1710000001000,
            updatedAt: 1710000005000,
            deliveryCount: 1,
            lastDeliveredAt: 1710000005000,
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
      id: "email-followup-list",
      method: "email_followup.list",
      params: { limit: 2 },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "email-followup-list"));

    const res = frames.find((f) => f.type === "res" && f.id === "email-followup-list");
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({
      limit: 2,
      items: [
        expect.objectContaining({
          providerId: "imap",
          status: "pending",
          subject: "Reminder pending",
        }),
        expect.objectContaining({
          providerId: "imap",
          status: "delivered",
          deliveryCount: 1,
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
