import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";

import { AgentRegistry, type AgentLaunchSpec } from "@belldandy/agent";
import {
  createSubTaskAgentCapabilities,
  createSubTaskResumeController,
  createSubTaskTakeoverController,
  createSubTaskRuntimeEventHandler,
  createSubTaskUpdateController,
  createSubTaskWorktreeLifecycleHandler,
  reattachSubTaskSupervisorRuntime,
  reconcileSubTaskWorktreeRuntimes,
  SubTaskRuntimeStore,
} from "./task-runtime.js";
import { GoalManager } from "./goals/manager.js";
import { GoalRuntimeBindingStore } from "./goal-runtime-binding-store.js";
import { SubTaskSupervisorRuntime } from "./subtask-supervisor-runtime.js";

test("subtask runtime store persists lifecycle, progress, and output artifacts", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-runtime-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-1",
      agentId: "coder",
      instruction: "Implement a minimal runtime",
      channel: "test",
      timeoutMs: 45_000,
      toolSet: ["read", "write"],
      role: "coder",
      allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
      maxToolRiskLevel: "high",
      maxRunWallTimeMs: 40_000,
      toolLoopIterationBudget: 5,
      maxTotalTokens: 18_000,
      maxCostUsd: 0.35,
      maxHighRiskToolCalls: 2,
      policySummary: "coder role policy",
    },
  });
  await store.markQueued(task.id, 2, {
    sessionId: "sub_1234",
    agentId: "coder",
    profileId: "coder",
  });
  expect(await store.getTask(task.id)).toMatchObject({
    sessionId: "sub_1234",
    status: "pending",
  });
  await store.attachSession(task.id, "sub_1234");

  const handler = createSubTaskRuntimeEventHandler(store);
  handler({
    type: "thought_delta",
    sessionId: "sub_1234",
    delta: "Reviewing the current orchestration path",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const completed = await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_1234",
    output: "Runtime implementation finished.",
  });

  expect(completed).toMatchObject({
    id: task.id,
    sessionId: "sub_1234",
    status: "done",
    outputPreview: "Runtime implementation finished.",
    launchSpec: {
      agentId: "coder",
      profileId: "coder",
      channel: "test",
      timeoutMs: 45_000,
      role: "coder",
      allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
      maxToolRiskLevel: "high",
      maxRunWallTimeMs: 40_000,
      toolLoopIterationBudget: 5,
      maxTotalTokens: 18_000,
      maxCostUsd: 0.35,
      maxHighRiskToolCalls: 2,
      policySummary: "coder role policy",
    },
  });
  expect(completed?.outputPath).toBeTruthy();
  expect(await fs.readFile(String(completed?.outputPath), "utf-8")).toBe("Runtime implementation finished.");

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const persisted = await reloaded.getTask(task.id);
  expect(persisted).toMatchObject({
    id: task.id,
    sessionId: "sub_1234",
    status: "done",
  });
  expect(persisted?.notifications.some((item) => item.kind === "completed")).toBe(true);
  expect(persisted?.progress.message).toBe("Task completed.");
  expect(persisted?.launchSpec).toMatchObject({
    maxRunWallTimeMs: 40_000,
    toolLoopIterationBudget: 5,
    maxTotalTokens: 18_000,
    maxCostUsd: 0.35,
    maxHighRiskToolCalls: 2,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store marks active sub-agent records interrupted after restart", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-runtime-lost-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const pending = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-runtime-lost",
      agentId: "coder",
      instruction: "Remain queued across the simulated restart",
    },
  });
  const running = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-runtime-lost",
      agentId: "coder",
      instruction: "Lose the in-memory runtime owner",
    },
  });
  await store.attachSession(running.id, "sub_runtime_lost_1", "coder", "coder");
  const bridge = await store.createBridgeSessionTask({
    parentConversationId: "conv-runtime-lost",
    agentId: "coder",
    profileId: "coder",
    instruction: "Keep the bridge runtime under its dedicated recovery owner",
    bridgeSession: {
      targetId: "codex_exec",
      action: "exec",
      transport: "pty",
      cwd: stateDir,
      commandPreview: "codex exec",
    },
  });
  await store.attachSession(bridge.id, "bridge_runtime_lost_1", "coder", "coder");

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  await expect(reloaded.getTask(pending.id)).resolves.toMatchObject({
    status: "interrupted",
    progress: { phase: "interrupted" },
    recovery: {
      state: "runtime_lost",
      previousStatus: "pending",
      mutationReplay: "forbidden",
    },
    notifications: expect.arrayContaining([expect.objectContaining({ kind: "interrupted" })]),
  });
  const recoveredRunning = await reloaded.getTask(running.id);
  expect(recoveredRunning).toMatchObject({
    sessionId: "sub_runtime_lost_1",
    status: "interrupted",
    progress: { phase: "interrupted" },
    recovery: {
      state: "runtime_lost",
      previousStatus: "running",
      mutationReplay: "forbidden",
    },
  });
  await expect(reloaded.getTask(bridge.id)).resolves.toMatchObject({
    kind: "bridge_session",
    sessionId: "bridge_runtime_lost_1",
    status: "running",
    bridgeSessionRuntime: { state: "active" },
  });
  expect((await reloaded.getTask(bridge.id))?.recovery).toBeUndefined();

  const detectedAt = recoveredRunning?.recovery?.detectedAt;
  const restartedAgain = new SubTaskRuntimeStore(stateDir);
  await restartedAgain.load();
  await expect(restartedAgain.getTask(running.id)).resolves.toMatchObject({
    status: "interrupted",
    recovery: { detectedAt },
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("createSubTaskResumeController relaunches a restart-lost task without replaying the old runtime", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-runtime-resume-"));
  const original = new SubTaskRuntimeStore(stateDir);
  await original.load();
  const task = await original.createTask({
    launchSpec: {
      parentConversationId: "conv-runtime-resume",
      agentId: "coder",
      instruction: "Continue only after explicit recovery",
      channel: "subtask",
    },
  });
  await original.attachSession(task.id, "sub_runtime_resume_1", "coder", "coder");

  const recovered = new SubTaskRuntimeStore(stateDir);
  await recovered.load();
  await expect(recovered.getTask(task.id)).resolves.toMatchObject({
    status: "interrupted",
    recovery: { mutationReplay: "forbidden" },
  });

  const spawnedFrom: string[] = [];
  const controller = createSubTaskResumeController({
    runtimeStore: recovered,
    conversationStore: { get: () => undefined },
    orchestrator: {
      getSession: () => undefined,
      async spawn(opts: any) {
        spawnedFrom.push(String(opts.resumedFromSessionId));
        opts.onSessionCreated?.("sub_runtime_resume_2", "coder");
        return {
          success: true,
          output: "Recovered run completed.",
          sessionId: "sub_runtime_resume_2",
        };
      },
    } as any,
  });

  await expect(controller(task.id, "Resume after reviewing the persisted recovery state."))
    .resolves.toMatchObject({ status: "interrupted" });
  let resumed = await recovered.getTask(task.id);
  for (let attempt = 0; attempt < 40 && resumed?.status !== "done"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    resumed = await recovered.getTask(task.id);
  }

  expect(spawnedFrom).toEqual(["sub_runtime_resume_1"]);
  expect(resumed).toMatchObject({
    sessionId: "sub_runtime_resume_2",
    status: "done",
    outputPreview: "Recovered run completed.",
  });
  expect(resumed?.recovery).toBeUndefined();
  expect(resumed?.resume).toEqual([
    expect.objectContaining({
      status: "delivered",
      deliveredSessionId: "sub_runtime_resume_2",
      resumedFromSessionId: "sub_runtime_resume_1",
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store writes scratch memory into goal run runtime roots", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-scratch-goal-"));
  const goalManager = new GoalManager(stateDir);
  const goal = await goalManager.createGoal({
    title: "阶段 3 Scratch Memory",
    objective: "验证 goal run scratch 文件落盘",
  });
  const node = await goalManager.createTaskNode(goal.id, {
    title: "实现 scratch memory",
    status: "ready",
  });
  const resumed = await goalManager.resumeGoal(goal.id, node.node.id);

  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: resumed.conversationId,
      agentId: "coder",
      instruction: "实现 commander scratch memory 落盘",
      channel: "goal",
      timeoutMs: 45_000,
      delegationProtocol: {
        source: "goal_subtask",
        intent: {
          kind: "goal_execution",
          summary: "执行 scratch memory 节点",
          role: "coder",
          goalId: goal.id,
          nodeId: node.node.id,
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: ["goalId", "nodeId", "runId"],
        },
        expectedDeliverable: {
          format: "patch",
          summary: "提交 scratch memory 实现",
        },
        aggregationPolicy: {
          mode: "main_agent_summary",
          summarizeFailures: true,
        },
        launchDefaults: {},
      },
    } as any,
  });
  await store.attachSession(task.id, "sub_scratch_goal", "coder", "coder");
  await store.recordThoughtDeltaBySession("sub_scratch_goal", "记录当前排查路径与运行态观察");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const completed = await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_scratch_goal",
    output: "scratch memory implemented",
  });

  const expectedScratchPath = path.join(goal.runtimeRoot, "runs", String(resumed.runId), "scratch", "scratch-coder.md");
  const expectedReviewPath = path.join(goal.runtimeRoot, "runs", String(resumed.runId), "review-results", `review-${task.id}.md`);
  const expectedLessonPath = path.join(goal.docRoot, "lessons-learned", `lesson-${task.id}.md`);
  expect(completed?.scratchPath).toBe(expectedScratchPath);
  expect(completed?.reviewPath).toBe(expectedReviewPath);
  expect(completed?.lessonPath).toBe(expectedLessonPath);
  const scratchContent = await fs.readFile(expectedScratchPath, "utf-8");
  const reviewContent = await fs.readFile(expectedReviewPath, "utf-8");
  const lessonContent = await fs.readFile(expectedLessonPath, "utf-8");
  expect(scratchContent).toContain("# Scratch Memory - coder @");
  expect(scratchContent).toContain("## 当前假设");
  expect(scratchContent).toContain("记录当前排查路径与运行态观察");
  expect(scratchContent).toContain("## 已验证结论");
  expect(scratchContent).toContain("scratch memory implemented");
  expect(scratchContent).toContain(`Run ID: ${resumed.runId}`);
  expect(reviewContent).toContain("# Commander Review - coder @");
  expect(reviewContent).toContain("## 审查发现");
  expect(reviewContent).toContain(expectedScratchPath);
  expect(lessonContent).toContain("# Lessons Learned - coder @");
  expect(lessonContent).toContain("## 可复用信号");
  expect(lessonContent).toContain(expectedReviewPath);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store falls back to task-local scratch memory outside goal runs", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-scratch-fallback-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-scratch-fallback",
      agentId: "researcher",
      instruction: "记录非长期任务的临时观察",
      channel: "test",
      timeoutMs: 30_000,
    },
  });
  await store.attachSession(task.id, "sub_scratch_fallback", "researcher", "researcher");
  await store.completeTask(task.id, {
    status: "error",
    sessionId: "sub_scratch_fallback",
    error: "temporary runtime failure",
  });

  const persisted = await store.getTask(task.id);
  const expectedScratchPath = path.join(stateDir, "tasks", task.id, "scratch", "scratch-researcher.md");
  const expectedReviewPath = path.join(stateDir, "tasks", task.id, "review-results", `review-${task.id}.md`);
  const expectedLessonPath = path.join(stateDir, "tasks", task.id, "lessons-learned", `lesson-${task.id}.md`);
  expect(persisted?.scratchPath).toBe(expectedScratchPath);
  expect(persisted?.reviewPath).toBe(expectedReviewPath);
  expect(persisted?.lessonPath).toBe(expectedLessonPath);
  const scratchContent = await fs.readFile(expectedScratchPath, "utf-8");
  const reviewContent = await fs.readFile(expectedReviewPath, "utf-8");
  const lessonContent = await fs.readFile(expectedLessonPath, "utf-8");
  expect(scratchContent).toContain("## 错误摘要");
  expect(scratchContent).toContain("temporary runtime failure");
  expect(scratchContent).toContain("Source Conversation: conv-scratch-fallback");
  expect(reviewContent).toContain("temporary runtime failure");
  expect(reviewContent).toContain("## 验证缺口");
  expect(lessonContent).toContain("本次未达到稳定交付");
  expect(lessonContent).toContain("## 需要规避的问题");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store loads persisted state with UTF-8 BOM", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-runtime-bom-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-bom",
      agentId: "default",
      instruction: "Validate BOM-compatible state restore",
      channel: "test",
      timeoutMs: 30_000,
    },
  });
  await store.attachSession(task.id, "sub_bom_1");
  await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_bom_1",
    output: "BOM restore works.",
  });

  const registryPath = path.join(stateDir, "subtasks", "registry.json");
  const raw = await fs.readFile(registryPath, "utf-8");
  await fs.writeFile(registryPath, `\uFEFF${raw}`, "utf-8");

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const persisted = await reloaded.getTask(task.id);
  expect(persisted).toMatchObject({
    id: task.id,
    status: "done",
    sessionId: "sub_bom_1",
    outputPreview: "BOM restore works.",
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store quarantines malformed registry without overwriting the original file", async () => {
  const cases = [
    {
      raw: "\ufeff{\"version\":1,\"items\":[",
      kind: "invalid_json",
    },
    {
      raw: JSON.stringify({ version: 2, items: [] }),
      kind: "invalid_schema",
    },
  ] as const;

  for (const scenario of cases) {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-quarantine-"));
    const statePath = path.join(stateDir, "subtasks", "registry.json");
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, scenario.raw, "utf-8");

    const store = new SubTaskRuntimeStore(stateDir);
    await store.load();

    expect(store.getQuarantineStatus()).toMatchObject({
      statePath,
      kind: scenario.kind,
    });
    expect(await store.listTasks()).toEqual([]);
    await expect(store.createTask({
      launchSpec: {
        parentConversationId: "conv-quarantine",
        agentId: "coder",
        instruction: "This mutation must not overwrite malformed state.",
      },
    })).rejects.toThrow("read-only quarantine");
    expect(await fs.readFile(statePath, "utf-8")).toBe(scenario.raw);

    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask runtime store pages filtered records without duplicates or omissions", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-pagination-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const targetTasks = [];
  for (let index = 0; index < 5; index += 1) {
    targetTasks.push(await store.createTask({
      launchSpec: {
        parentConversationId: "conv-pagination",
        agentId: "coder",
        instruction: `Paginated task ${index}`,
      },
    }));
  }
  await store.createTask({
    launchSpec: {
      parentConversationId: "conv-other",
      agentId: "coder",
      instruction: "Must be filtered before pagination",
    },
  });

  const first = await store.listTaskPage("conv-pagination", { limit: 2 });
  const second = await store.listTaskPage("conv-pagination", {
    limit: 2,
    cursor: first.nextCursor,
  });
  const third = await store.listTaskPage("conv-pagination", {
    limit: 2,
    cursor: second.nextCursor,
  });
  const pagedIds = [...first.items, ...second.items, ...third.items].map((item) => item.id);

  expect(first).toMatchObject({ limit: 2, hasMore: true });
  expect(second).toMatchObject({ limit: 2, hasMore: true });
  expect(third).toMatchObject({ limit: 2, hasMore: false });
  expect(new Set(pagedIds)).toEqual(new Set(targetTasks.map((item) => item.id)));
  expect(pagedIds).toHaveLength(targetTasks.length);
  await expect(store.listTaskPage("conv-pagination", { cursor: "not-json" }))
    .rejects.toThrow("cursor is invalid or unsupported");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store compacts only eligible terminal records and preserves non-output artifacts", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-retention-"));
  const bindingStore = new GoalRuntimeBindingStore(stateDir);
  const store = new SubTaskRuntimeStore(stateDir, undefined, bindingStore);
  await store.load();

  const removable = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-retention",
      agentId: "coder",
      instruction: "Remove only the runtime-owned output after registry publication",
    },
  });
  const completedRemovable = await store.completeTask(removable.id, {
    status: "done",
    output: "runtime output that may be compacted",
  });
  const goalBound = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-retention",
      agentId: "reviewer",
      instruction: "Protect goal-bound terminal task",
      delegationProtocol: {
        source: "goal_subtask",
        intent: { kind: "goal_execution", summary: "Protected goal task", goalId: "goal-retention" },
        contextPolicy: { includeParentConversation: true, includeStructuredContext: true, contextKeys: ["goalId"] },
        expectedDeliverable: { format: "patch", summary: "Protected result" },
        aggregationPolicy: { mode: "main_agent_summary", summarizeFailures: true, sourceAgentIds: [] },
        launchDefaults: {},
      },
    },
  });
  await store.completeTask(goalBound.id, { status: "done", output: "goal output must remain" });
  const externallyBound = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-retention",
      agentId: "reviewer",
      instruction: "Protect terminal task through the external binding owner",
    },
  });
  await store.completeTask(externallyBound.id, { status: "done", output: "external goal output must remain" });
  await bindingStore.upsertSubTaskBinding({
    source: "goal_subtask",
    goalId: "goal-external-retention",
    taskId: externallyBound.id,
    status: "done",
  });
  const active = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-retention",
      agentId: "coder",
      instruction: "Active task must remain",
    },
  });

  const report = await store.compactTerminalTasks({
    maxTerminalRecords: 0,
    minTerminalAgeMs: 0,
  });

  expect(report).toMatchObject({
    policy: { autoCompact: false, maxTerminalRecords: 0, minTerminalAgeMs: 0 },
    eligibleCount: 1,
    protectedCount: 3,
    removedCount: 1,
    errorCount: 0,
  });
  expect(await store.getTask(removable.id)).toBeUndefined();
  expect(await store.getTask(goalBound.id)).toBeDefined();
  expect(await store.getTask(externallyBound.id)).toBeDefined();
  expect(await store.getTask(active.id)).toBeDefined();
  await expect(fs.access(String(completedRemovable?.outputPath))).rejects.toThrow();
  await expect(fs.access(String(completedRemovable?.scratchPath))).resolves.toBeUndefined();
  await expect(fs.access(String(completedRemovable?.reviewPath))).resolves.toBeUndefined();
  await expect(fs.access(String(completedRemovable?.lessonPath))).resolves.toBeUndefined();

  const reloaded = new SubTaskRuntimeStore(stateDir, undefined, new GoalRuntimeBindingStore(stateDir));
  await reloaded.load();
  expect(await reloaded.getTask(removable.id)).toBeUndefined();
  expect(await reloaded.getTask(goalBound.id)).toBeDefined();
  expect(await reloaded.getTask(externallyBound.id)).toBeDefined();
  expect(await reloaded.getTask(active.id)).toBeDefined();

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime compaction keeps the published registry when output cleanup fails", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-retention-failure-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-retention-failure",
      agentId: "coder",
      instruction: "Keep registry compaction committed on cleanup failure",
    },
  });
  const completed = await store.completeTask(task.id, {
    status: "done",
    output: "output cleanup will fail",
  });
  const originalRm = fs.rm.bind(fs);
  const rmSpy = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
    if (String(target).includes(task.id)) {
      throw Object.assign(new Error("simulated cleanup failure"), { code: "EACCES" });
    }
    return originalRm(target, options);
  });

  try {
    const report = await store.compactTerminalTasks({
      maxTerminalRecords: 0,
      minTerminalAgeMs: 0,
    });
    expect(report).toMatchObject({ removedCount: 1, errorCount: 1 });
    const reloaded = new SubTaskRuntimeStore(stateDir);
    await reloaded.load();
    expect(await reloaded.getTask(task.id)).toBeUndefined();
    await expect(fs.access(String(completed?.outputPath))).resolves.toBeUndefined();
  } finally {
    rmSpy.mockRestore();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask runtime compaction rolls memory back and keeps outputs when registry publication fails", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-retention-persist-failure-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-retention-persist-failure",
      agentId: "coder",
      instruction: "Do not clean output before registry publication",
    },
  });
  const completed = await store.completeTask(task.id, {
    status: "done",
    output: "output must remain after registry failure",
  });
  const registryPath = path.join(stateDir, "subtasks", "registry.json");
  const originalRename = fs.rename.bind(fs);
  let registryRenameCount = 0;
  const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
    if (path.resolve(String(newPath)) === path.resolve(registryPath)) {
      registryRenameCount += 1;
      if (registryRenameCount > 1) {
        throw Object.assign(new Error("simulated registry publication failure"), { code: "EIO" });
      }
    }
    return originalRename(oldPath, newPath);
  });

  try {
    await expect(store.compactTerminalTasks({
      maxTerminalRecords: 0,
      minTerminalAgeMs: 0,
    })).rejects.toThrow("simulated registry publication failure");
    expect(await store.getTask(task.id)).toBeDefined();
    await expect(fs.access(String(completed?.outputPath))).resolves.toBeUndefined();
  } finally {
    renameSpy.mockRestore();
  }

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  expect(await reloaded.getTask(task.id)).toBeDefined();
  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store batches thought_delta persistence within a short window", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-runtime-thought-delta-"));
  const writeFileSpy = vi.spyOn(fs, "writeFile");

  try {
    const store = new SubTaskRuntimeStore(stateDir);
    await store.load();

    const task = await store.createTask({
      launchSpec: {
        parentConversationId: "conv-thought-delta",
        agentId: "coder",
        instruction: "Batch high-frequency thought delta persistence",
        channel: "test",
        timeoutMs: 30_000,
      },
    });
    await store.attachSession(task.id, "sub_thought_delta");

    writeFileSpy.mockClear();

    await store.recordThoughtDeltaBySession("sub_thought_delta", "first delta");
    await store.recordThoughtDeltaBySession("sub_thought_delta", "second delta");

    expect(writeFileSpy).not.toHaveBeenCalled();

    const started = Date.now();
    const scratchPath = path.join(stateDir, "tasks", task.id, "scratch", "scratch-coder.md");
    let persisted: { progress?: { message?: string } } | undefined;
    let scratchContent = "";
    while (Date.now() - started < 1_500) {
      if (writeFileSpy.mock.calls.length > 0) {
        const registry = JSON.parse(await fs.readFile(path.join(stateDir, "subtasks", "registry.json"), "utf-8")) as {
          items?: Array<{ id?: string; progress?: { message?: string } }>;
        };
        persisted = registry.items?.find((item) => item.id === task.id);
        // Registry 先于 artifact 原子写入，必须等待同一次 deferred persist 的 scratch 收尾完成。
        scratchContent = await fs.readFile(scratchPath, "utf-8").catch(() => "");
        if (persisted?.progress?.message === "second delta" && scratchContent.includes("second delta")) {
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(writeFileSpy.mock.calls.length).toBeGreaterThan(0);
    expect(persisted?.progress?.message).toBe("second delta");
    expect(scratchContent).toContain("second delta");
  } finally {
    writeFileSpy.mockRestore();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("subtask runtime store flushAndClose drains deferred state and rejects new mutations", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-flush-close-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-flush-close",
      agentId: "coder",
      instruction: "Persist the final thought delta before shutdown.",
    },
  });
  await store.attachSession(task.id, "sub_flush_close_1", "coder", "coder");
  await store.recordThoughtDeltaBySession("sub_flush_close_1", "The final deferred progress update must be persisted.");

  await Promise.all([store.flushAndClose(), store.flushAndClose()]);

  const registry = JSON.parse(await fs.readFile(path.join(stateDir, "subtasks", "registry.json"), "utf-8")) as {
    items?: Array<{ id?: string; progress?: { message?: string } }>;
  };
  expect(registry.items?.find((item) => item.id === task.id)?.progress?.message)
    .toBe("The final deferred progress update must be persisted.");

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  expect(await reloaded.getTask(task.id)).toMatchObject({
    status: "interrupted",
    recovery: {
      state: "runtime_lost",
      previousStatus: "running",
      mutationReplay: "forbidden",
    },
  });
  await expect(store.createTask({
    launchSpec: {
      parentConversationId: "conv-flush-close",
      agentId: "coder",
      instruction: "This mutation must be rejected after close.",
    },
  })).rejects.toThrow("closed");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("task runtime agent capabilities wrap spawn results into structured task records", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-caps-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const controller = new AbortController();
  let receivedAbortSignal: AbortSignal | undefined;

  const handler = createSubTaskRuntimeEventHandler(store);
  const orchestrator = {
    async spawn(opts: {
      abortSignal?: AbortSignal;
      onQueued?: (position: number) => void;
      onSessionCreated?: (sessionId: string, agentId: string) => void;
      launchSpec: {
        agentId?: string;
      };
    }) {
      receivedAbortSignal = opts.abortSignal;
      opts.onQueued?.(1);
      opts.onSessionCreated?.("sub_caps_1", opts.launchSpec.agentId ?? "default");
      handler({
        type: "thought_delta",
        sessionId: "sub_caps_1",
        delta: "Collecting implementation context",
      });
      return {
        success: true,
        output: "child agent finished",
        sessionId: "sub_caps_1",
      };
    },
    listSessions() {
      return [];
    },
  };

  const caps = createSubTaskAgentCapabilities({
    orchestrator: orchestrator as any,
    runtimeStore: store,
  });

  const result = await caps.spawnSubAgent!({
    parentConversationId: "conv-caps",
    parentOperation: {
      agentRunId: "run-caps",
      toolCallId: "tool-caps",
    },
    agentId: "coder",
    instruction: "Implement task bridge",
    abortSignal: controller.signal,
    bridgeSubtask: {
      kind: "review",
      targetId: "codex_exec",
      action: "review",
      goalId: "goal-task-runtime",
      goalNodeId: "node-review",
      summary: "把 bridge review 语义写进长期任务子任务记录",
    },
  });

  expect(result).toMatchObject({
    success: true,
    sessionId: "sub_caps_1",
  });
  expect(result.taskId).toMatch(/^task_/);
  expect(result.outputPath).toBeTruthy();
  expect(receivedAbortSignal).toBe(controller.signal);

  const sessions = await caps.listSessions!("conv-caps");
  expect(sessions).toEqual([
    expect.objectContaining({
      id: "sub_caps_1",
      taskId: result.taskId,
      agentId: "coder",
      status: "done",
      outputPath: result.outputPath,
    }),
  ]);

  const persisted = await store.getTask(String(result.taskId));
  const expectedParentOperationId = `op_${createHash("sha256")
    .update("conversation\0conv-caps\0run-caps\0tool-caps")
    .digest("hex")}`;
  expect(persisted?.parentOperationId).toBe(expectedParentOperationId);
  expect(persisted?.launchSpec.bridgeSubtask).toEqual({
    kind: "review",
    targetId: "codex_exec",
    action: "review",
    goalId: "goal-task-runtime",
    goalNodeId: "node-review",
    summary: "把 bridge review 语义写进长期任务子任务记录",
  });
  expect(persisted?.launchSpec).not.toHaveProperty("abortSignal");

  await store.flushAndClose();
  const restartedStore = new SubTaskRuntimeStore(stateDir);
  await restartedStore.load();
  const restarted = await restartedStore.getTask(String(result.taskId));
  expect(restarted?.parentOperationId).toBe(expectedParentOperationId);
  const registry = await fs.readFile(path.join(stateDir, "subtasks", "registry.json"), "utf-8");
  expect(registry).not.toContain("tool-caps");
  expect(registry).not.toContain("run-caps");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("task runtime agent capabilities persist catalog-derived launch defaults", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-catalog-caps-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const registry = new AgentRegistry(() => ({
    async *run() {
      yield { type: "status", status: "running" } as const;
      yield { type: "final", text: "catalog done" } as const;
      yield { type: "status", status: "done" } as const;
    },
  }));
  registry.register({
    id: "default",
    displayName: "Default",
    model: "primary",
  });
  registry.register({
    id: "ops-coder",
    displayName: "Ops Coder",
    model: "primary",
    defaultRole: "coder",
    defaultPermissionMode: "confirm",
    defaultAllowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
    defaultMaxToolRiskLevel: "high",
  });

  const orchestrator = {
    async spawn(opts: {
      onSessionCreated?: (sessionId: string, agentId: string) => void;
      launchSpec: AgentLaunchSpec;
    }) {
      opts.onSessionCreated?.("sub_catalog_1", opts.launchSpec.agentId);
      return {
        success: true,
        output: "catalog child finished",
        sessionId: "sub_catalog_1",
      };
    },
    listSessions() {
      return [];
    },
  };

  const caps = createSubTaskAgentCapabilities({
    orchestrator: orchestrator as any,
    runtimeStore: store,
    agentRegistry: registry,
  });

  const result = await caps.spawnSubAgent!({
    parentConversationId: "conv-catalog",
    agentId: "ops-coder",
    instruction: "Implement task bridge",
  });

  const persisted = await store.getTask(String(result.taskId));
  expect(persisted?.launchSpec).toMatchObject({
    agentId: "ops-coder",
    profileId: "ops-coder",
    role: "coder",
    permissionMode: "confirm",
    allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
    maxToolRiskLevel: "high",
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("task runtime agent capabilities persist resolved worktree launch runtime before spawn", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-worktree-caps-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const requestedCwd = path.join(stateDir, "demo-repo", "src");
  const worktreeRoot = path.join(stateDir, "virtual-worktree", "repo");
  const resolvedCwd = path.join(worktreeRoot, "src");

  let receivedLaunchSpec: Record<string, unknown> | undefined;
  const orchestrator = {
    async spawn(opts: {
      launchSpec: Record<string, unknown>;
      onSessionCreated?: (sessionId: string, agentId: string) => void;
    }) {
      receivedLaunchSpec = opts.launchSpec;
      opts.onSessionCreated?.("sub_worktree_1", String(opts.launchSpec.agentId ?? "default"));
      return {
        success: true,
        output: "child agent finished in worktree",
        sessionId: "sub_worktree_1",
      };
    },
    listSessions() {
      return [];
    },
  };

  const caps = createSubTaskAgentCapabilities({
    orchestrator: orchestrator as any,
    runtimeStore: store,
    worktreeRuntime: {
      async prepareTaskLaunch(_taskId: string, launchSpec: AgentLaunchSpec) {
        return {
          launchSpec: {
            ...launchSpec,
            cwd: resolvedCwd,
          },
          summary: {
            resolvedCwd,
            worktreePath: worktreeRoot,
            worktreeRepoRoot: path.join(stateDir, "demo-repo"),
            worktreeBranch: "belldandy-task_1234",
            worktreeStatus: "created",
          },
        };
      },
    } as any,
  });

  const result = await caps.spawnSubAgent!({
    parentConversationId: "conv-worktree",
    agentId: "coder",
    instruction: "Implement task bridge in a worktree",
    cwd: requestedCwd,
    isolationMode: "worktree",
  });

  expect(result.success).toBe(true);
  expect(receivedLaunchSpec?.cwd).toBe(resolvedCwd);

  const persisted = await store.getTask(String(result.taskId));
  expect(persisted?.launchSpec).toMatchObject({
    cwd: requestedCwd,
    resolvedCwd,
    worktreePath: worktreeRoot,
    worktreeRepoRoot: path.join(stateDir, "demo-repo"),
    worktreeBranch: "belldandy-task_1234",
    worktreeStatus: "created",
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store supports stop request and archive filtering", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-stop-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const pending = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-stop",
      agentId: "coder",
      instruction: "Wait in queue",
    },
  });
  const requested = await store.requestStop(pending.id, "Stop before execution.");
  expect(requested).toMatchObject({
    claimOwner: true,
    item: {
      id: pending.id,
      stopReason: "Stop before execution.",
    },
  });

  const stopped = await store.markStopped(pending.id, {
    reason: "Stopped before execution.",
    commandClaim: requested?.commandClaim,
  });
  expect(stopped).toMatchObject({
    id: pending.id,
    status: "stopped",
    stopReason: "Stopped before execution.",
  });

  await store.archiveTask(pending.id, "Archived after manual review.");
  const activeItems = await store.listTasks("conv-stop");
  expect(activeItems).toHaveLength(0);

  const archivedItems = await store.listTasks("conv-stop", { includeArchived: true });
  expect(archivedItems).toEqual([
    expect.objectContaining({
      id: pending.id,
      status: "stopped",
      archiveReason: "Archived after manual review.",
      archivedAt: expect.any(Number),
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store persists steering records and ignores stale session completion", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-steering-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-steer",
      agentId: "coder",
      instruction: "Implement runtime bridge",
    },
  });
  await store.attachSession(task.id, "sub_steer_1");

  const accepted = await store.requestSteering(task.id, "Focus on the failing integration path.", {
    sessionId: "sub_steer_1",
  });
  expect(accepted?.steering).toMatchObject({
    status: "accepted",
    requestedSessionId: "sub_steer_1",
  });

  await store.attachSession(task.id, "sub_steer_2");
  await store.markSteeringDelivered(task.id, String(accepted?.steering.id), { sessionId: "sub_steer_2" });

  const stale = await store.completeTask(task.id, {
    status: "stopped",
    sessionId: "sub_steer_1",
    error: "stale stop",
  });
  expect(stale?.sessionId).toBe("sub_steer_2");
  expect(stale?.status).toBe("running");

  const completed = await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_steer_2",
    output: "updated result",
  });
  expect(completed).toMatchObject({
    sessionId: "sub_steer_2",
    status: "done",
  });
  expect(completed?.steering).toEqual([
    expect.objectContaining({
      status: "delivered",
      deliveredSessionId: "sub_steer_2",
    }),
  ]);

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const persisted = await reloaded.getTask(task.id);
  expect(persisted?.steering).toEqual([
    expect.objectContaining({
      status: "delivered",
      deliveredSessionId: "sub_steer_2",
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("task runtime agent capabilities run parallel admission before task persistence or orchestration", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-supervisor-admission-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const orchestrator = {
    spawn: vi.fn(async () => ({ success: true, output: "unexpected", sessionId: "unexpected" })),
    listSessions: vi.fn(() => []),
  };
  const caps = createSubTaskAgentCapabilities({
    orchestrator: orchestrator as any,
    runtimeStore: store,
    supervisorRuntime: new SubTaskSupervisorRuntime({
      maxActiveChildren: 2,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    }),
  });

  const result = await caps.spawnSubAgent!({
    parentConversationId: "conversation-supervised",
    parentOperation: { agentRunId: "run-supervised", toolCallId: "tool-supervised" },
    agentId: "coder",
    instruction: "Implement a parallel write lane.",
    timeoutMs: 30_000,
    cwd: stateDir,
    delegationProtocol: {
      source: "delegate_parallel",
      intent: { kind: "parallel_subtasks", summary: "Implement lane.", role: "coder" },
      contextPolicy: { includeParentConversation: true, includeStructuredContext: false, contextKeys: [] },
      expectedDeliverable: { format: "patch", summary: "Return patch." },
      aggregationPolicy: { mode: "parallel_collect", summarizeFailures: true },
      launchDefaults: {},
      ownership: { scopeSummary: "Owned write lane.", writeScope: ["src/**"] },
      team: {
        id: "team-admission",
        mode: "parallel_patch",
        currentLaneId: "lane_1",
        memberRoster: [{ laneId: "lane_1", agentId: "coder", role: "coder" }],
      },
    },
  });

  expect(result).toMatchObject({
    success: false,
    error: "Parallel write lane requires an available managed worktree owner.",
  });
  expect(orchestrator.spawn).not.toHaveBeenCalled();
  await expect(store.listTasks("conversation-supervised")).resolves.toEqual([]);

  await store.flushAndClose();
  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("task runtime agent capabilities forward Supervisor control to the exact-bound owner", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-supervisor-control-capability-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const control = vi.fn(async () => ({
    status: "running" as const,
    mode: "write" as const,
    revision: 0,
    binding: {
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-parallel",
      laneId: "lane_1",
      taskId: "task-lane-1",
      sessionId: "session-lane-1",
    },
    admittedAtMs: 100,
    updatedAtMs: 200,
  }));
  const caps = createSubTaskAgentCapabilities({
    orchestrator: { spawn: vi.fn(), listSessions: vi.fn(() => []) } as any,
    runtimeStore: store,
    supervisorControlRuntime: { control },
  });
  const input = {
    action: "observe" as const,
    managerConversationId: "conversation-manager",
    managerAgentRunId: "run-manager",
    teamId: "team-parallel",
    laneId: "lane_1",
    taskId: "task-lane-1",
    sessionId: "session-lane-1",
  };

  await expect(caps.controlSubTask?.(input)).resolves.toMatchObject({
    status: "running",
    revision: 0,
    binding: { taskId: "task-lane-1", sessionId: "session-lane-1" },
  });
  expect(control).toHaveBeenCalledWith(input);

  await store.flushAndClose();
  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("task runtime agent capabilities route fan-in preview and explicit confirm to the resolution owner", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-supervisor-fan-in-capability-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const preview = vi.fn(async () => ({
    schemaVersion: "subtask-supervisor-fan-in/v1" as const,
    contentMode: "none" as const,
    status: "ready" as const,
    receipt: { id: "fan-in-receipt-1", expiresAtMs: 20_000 },
    conflictPaths: [],
    lanes: [],
    reviewer: { mode: "read_only" as const, verdict: "approved" as const, artifactSha256: "c".repeat(64) },
  }));
  const confirm = vi.fn(async () => ({
    schemaVersion: "subtask-supervisor-fan-in/v1" as const,
    contentMode: "none" as const,
    status: "completed" as const,
    applied: true,
    duplicateSideEffect: false as const,
    blockers: [],
  }));
  const caps = createSubTaskAgentCapabilities({
    orchestrator: { spawn: vi.fn(), listSessions: vi.fn(() => []) } as any,
    runtimeStore: store,
    supervisorFanInRuntime: { preview, confirm },
  });
  const common = {
    managerConversationId: "conversation-manager",
    managerAgentRunId: "run-manager",
    teamId: "team-parallel",
    lanes: [],
    reviewerEvidence: {
      schemaVersion: "subtask-supervisor-review-evidence/v1" as const,
      mode: "read_only" as const,
      verdict: "approved" as const,
      artifact: { id: "review-lane-1", sha256: "c".repeat(64) },
    },
  };

  await expect(caps.fanInSubTasks?.({ action: "preview", ...common })).resolves.toMatchObject({ status: "ready" });
  await expect(caps.fanInSubTasks?.({
    action: "confirm",
    ...common,
    receiptId: "fan-in-receipt-1",
    confirm: true,
  })).resolves.toMatchObject({ status: "completed", applied: true });
  expect(preview).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ receiptId: "fan-in-receipt-1", confirm: true }));

  await store.flushAndClose();
  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("task runtime agent capabilities isolate an admitted parallel write lane before persistence and spawn", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-supervisor-worktree-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const resolvedCwd = path.join(stateDir, "managed-worktree");
  const prepareTaskLaunch = vi.fn(async (_taskId: string, launchSpec: AgentLaunchSpec) => {
    expect(launchSpec).toMatchObject({
      isolationMode: "worktree",
      maxRunWallTimeMs: 20_000,
      toolLoopIterationBudget: 3,
      maxTotalTokens: 8_000,
      maxCostUsd: 0.1,
      maxHighRiskToolCalls: 1,
      maxToolRiskLevel: "low",
    });
    return {
      launchSpec: { ...launchSpec, cwd: resolvedCwd },
      summary: {
        resolvedCwd,
        worktreePath: resolvedCwd,
        worktreeRepoRoot: stateDir,
        worktreeBranch: "belldandy-supervised-lane",
        worktreeStatus: "created" as const,
      },
    };
  });
  const orchestrator = {
    spawn: vi.fn(async (opts: {
      launchSpec: AgentLaunchSpec;
      onSessionCreated?: (sessionId: string, agentId: string) => void;
    }) => {
      expect(opts.launchSpec).toMatchObject({
        isolationMode: "worktree",
        cwd: resolvedCwd,
        maxRunWallTimeMs: 20_000,
        toolLoopIterationBudget: 3,
        maxTotalTokens: 8_000,
        maxCostUsd: 0.1,
        maxHighRiskToolCalls: 1,
        maxToolRiskLevel: "low",
      });
      opts.onSessionCreated?.("session-supervised-write", "coder");
      return { success: true, output: "completed", sessionId: "session-supervised-write" };
    }),
    listSessions: vi.fn(() => []),
  };
  const supervisorRuntime = new SubTaskSupervisorRuntime({
    maxActiveChildren: 2,
    maxDepth: 2,
    maxWallTimeMs: 60_000,
    toolLoopIterationBudget: 4,
    maxTotalTokens: 10_000,
    maxCostUsd: 0.2,
    maxHighRiskToolCalls: 2,
    maxToolRiskLevel: "medium",
  });
  const caps = createSubTaskAgentCapabilities({
    orchestrator: orchestrator as any,
    runtimeStore: store,
    worktreeRuntime: { prepareTaskLaunch } as any,
    supervisorRuntime,
  });

  const result = await caps.spawnSubAgent!({
    parentConversationId: "conversation-supervised-write",
    parentOperation: { agentRunId: "run-supervised-write", toolCallId: "tool-supervised-write" },
    agentId: "coder",
    instruction: "Implement the owned write lane.",
    timeoutMs: 30_000,
    cwd: stateDir,
    isolationMode: "workspace",
    maxRunWallTimeMs: 20_000,
    toolLoopIterationBudget: 3,
    maxTotalTokens: 8_000,
    maxCostUsd: 0.1,
    maxHighRiskToolCalls: 1,
    maxToolRiskLevel: "low",
    delegationProtocol: {
      source: "delegate_parallel",
      intent: { kind: "parallel_subtasks", summary: "Implement write lane.", role: "coder" },
      contextPolicy: { includeParentConversation: true, includeStructuredContext: false, contextKeys: [] },
      expectedDeliverable: { format: "patch", summary: "Return patch." },
      aggregationPolicy: { mode: "parallel_collect", summarizeFailures: true },
      launchDefaults: {},
      ownership: { scopeSummary: "Owned write lane.", writeScope: ["src/**"] },
      team: {
        id: "team-supervised-write",
        mode: "parallel_patch",
        currentLaneId: "lane_1",
        memberRoster: [{ laneId: "lane_1", agentId: "coder", role: "coder" }],
      },
    },
  });

  expect(result).toMatchObject({ success: true, sessionId: "session-supervised-write" });
  expect(prepareTaskLaunch).toHaveBeenCalledTimes(1);
  expect(orchestrator.spawn).toHaveBeenCalledTimes(1);
  expect(await store.getTask(String(result.taskId))).toMatchObject({
    status: "done",
    launchSpec: {
      isolationMode: "worktree",
      resolvedCwd,
      worktreeStatus: "created",
      maxRunWallTimeMs: 20_000,
      toolLoopIterationBudget: 3,
      maxTotalTokens: 8_000,
      maxCostUsd: 0.1,
      maxHighRiskToolCalls: 1,
      maxToolRiskLevel: "low",
    },
  });
  expect(supervisorRuntime.getSnapshot()).toMatchObject({
    activeCount: 0,
    retainedTerminalCount: 1,
    items: [{
      status: "done",
      mode: "write",
      binding: {
        managerConversationId: "conversation-supervised-write",
        managerAgentRunId: "run-supervised-write",
        teamId: "team-supervised-write",
        laneId: "lane_1",
        taskId: result.taskId,
        sessionId: "session-supervised-write",
      },
    }],
  });

  await store.flushAndClose();
  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store persists no-content Supervisor bindings for restart reattach", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-supervisor-binding-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conversation-supervisor-binding",
      agentId: "coder",
      instruction: "Private child instruction must not enter the Supervisor binding.",
      cwd: path.join(stateDir, "private-workspace"),
    },
    supervisorBinding: {
      managerConversationId: "conversation-supervisor-binding",
      managerAgentRunId: "run-supervisor-binding",
      teamId: "team-supervisor-binding",
      laneId: "lane_1",
      mode: "write",
    },
  });
  await store.attachSession(task.id, "session-supervisor-binding", "coder", "coder");
  await store.flushAndClose();

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const recovered = await reloaded.getTask(task.id);
  expect(recovered).toMatchObject({
    status: "interrupted",
    sessionId: "session-supervisor-binding",
    supervisorBinding: {
      managerConversationId: "conversation-supervisor-binding",
      managerAgentRunId: "run-supervisor-binding",
      teamId: "team-supervisor-binding",
      laneId: "lane_1",
      mode: "write",
    },
  });
  const serializedBinding = JSON.stringify(recovered?.supervisorBinding);
  expect(serializedBinding).not.toContain("Private child instruction");
  expect(serializedBinding).not.toContain("private-workspace");

  const supervisorRuntime = new SubTaskSupervisorRuntime({
    maxActiveChildren: 1,
    maxDepth: 2,
    maxWallTimeMs: 60_000,
  });
  await reattachSubTaskSupervisorRuntime({ runtimeStore: reloaded, supervisorRuntime });
  expect(supervisorRuntime.getSnapshot()).toMatchObject({
    activeCount: 0,
    retainedTerminalCount: 1,
    items: [{
      status: "interrupted",
      binding: { taskId: task.id, sessionId: "session-supervisor-binding" },
    }],
  });
  await expect(reloaded.createTask({
    launchSpec: {
      parentConversationId: "conversation-supervisor-binding",
      agentId: "coder",
      instruction: "A replay must be rejected before persistence.",
    },
    supervisorBinding: recovered!.supervisorBinding,
  })).rejects.toMatchObject({ code: "binding_conflict" });
  expect(await reloaded.listTasks("conversation-supervisor-binding")).toHaveLength(1);

  await reloaded.flushAndClose();
  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask command claim reuses an identical steering retry and blocks stale completion", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-command-claim-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-command-claim",
      agentId: "coder",
      instruction: "Implement command claim",
    },
  });
  await store.attachSession(task.id, "sub_command_claim_1", "coder", "coder");

  const [first, replay] = await Promise.all([
    store.requestSteering(task.id, "Prioritize the failing integration path.", {
      sessionId: "sub_command_claim_1",
      idempotencyKey: "steering-retry-1",
    }),
    store.requestSteering(task.id, "Prioritize the failing integration path.", {
      sessionId: "sub_command_claim_1",
      idempotencyKey: "steering-retry-1",
    }),
  ]);

  expect(first?.claimOwner).toBe(true);
  expect(replay?.claimOwner).toBe(false);
  expect(replay?.steering.id).toBe(first?.steering.id);
  expect((await store.getTask(task.id))?.steering).toHaveLength(1);

  await expect(store.requestTakeover(task.id, "reviewer", "Take over the same handoff.", {
    sessionId: "sub_command_claim_1",
    mode: "safe_point",
    idempotencyKey: "competing-takeover-1",
  })).rejects.toThrow("steering is already pending");

  const stale = await store.completeTask(task.id, {
    status: "stopped",
    sessionId: "sub_command_claim_1",
    error: "old session stopped while steering handoff is pending",
  });
  expect(stale).toMatchObject({
    sessionId: "sub_command_claim_1",
    status: "running",
  });

  const terminalWithoutSessionCallback = await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_command_claim_1",
    output: "orchestrator completed before creating a session callback",
    commandGeneration: first?.commandClaim.generation,
  });
  expect(terminalWithoutSessionCallback).toMatchObject({
    status: "done",
    activeCommandClaim: undefined,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store releases a pending claim left by a previous runtime instance", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-command-recovery-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-command-recovery",
      agentId: "coder",
      instruction: "Recover interrupted command claim",
    },
  });
  await store.attachSession(task.id, "sub_command_recovery_1", "coder", "coder");
  await store.requestSteering(task.id, "Recover the interrupted steering command.", {
    sessionId: "sub_command_recovery_1",
    idempotencyKey: "interrupted-steering-claim",
  });

  const statePath = path.join(stateDir, "subtasks", "registry.json");
  const persisted = JSON.parse(await fs.readFile(statePath, "utf-8")) as {
    items: Array<{ activeCommandClaim?: { ownerInstanceId?: string } }>;
  };
  persisted.items[0]!.activeCommandClaim!.ownerInstanceId = "previous-runtime-instance";
  await fs.writeFile(statePath, JSON.stringify(persisted, null, 2), "utf-8");

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const recovered = await reloaded.getTask(task.id);
  expect(recovered?.activeCommandClaim).toBeUndefined();
  expect(recovered?.steering).toEqual([
    expect.objectContaining({
      status: "failed",
      error: expect.stringContaining("interrupted"),
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store releases an interrupted stop claim into restart-lost recovery", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-stop-recovery-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();
  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-stop-recovery",
      agentId: "coder",
      instruction: "Recover interrupted stop claim",
    },
  });
  await store.attachSession(task.id, "sub_stop_recovery_1", "coder", "coder");
  await store.requestStop(task.id, "Stop before restart.", {
    sessionId: "sub_stop_recovery_1",
    idempotencyKey: "interrupted-stop-claim",
    expectedRevision: 0,
  });

  const statePath = path.join(stateDir, "subtasks", "registry.json");
  const persisted = JSON.parse(await fs.readFile(statePath, "utf-8")) as {
    items: Array<{ activeCommandClaim?: { ownerInstanceId?: string } }>;
  };
  persisted.items[0]!.activeCommandClaim!.ownerInstanceId = "previous-runtime-instance";
  await fs.writeFile(statePath, JSON.stringify(persisted, null, 2), "utf-8");

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const recovered = await reloaded.getTask(task.id);
  expect(recovered).toMatchObject({
    status: "interrupted",
    commandGeneration: 1,
    activeCommandClaim: undefined,
    stopRequestedAt: undefined,
    stopReason: undefined,
    recovery: {
      state: "runtime_lost",
      previousStatus: "running",
      mutationReplay: "forbidden",
    },
  });
  expect(recovered?.notifications).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "stop_failed",
      message: expect.stringContaining("interrupted"),
    }),
    expect.objectContaining({ kind: "interrupted" }),
  ]));
  await expect(reloaded.requestStop(task.id, "Do not stop a lost owner twice.", {
    sessionId: "sub_stop_recovery_1",
    expectedRevision: 1,
  })).rejects.toThrow("Subtask stop only supports active tasks");
  await expect(reloaded.requestResume(task.id, "Explicitly relaunch the interrupted task.", {
    sessionId: "sub_stop_recovery_1",
    expectedRevision: 1,
  })).resolves.toMatchObject({
    item: { status: "interrupted" },
    resume: { status: "accepted" },
    claimOwner: true,
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("steering controller only lets the command claim owner stop and spawn", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-command-owner-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-command-owner",
      agentId: "coder",
      instruction: "Implement command ownership",
    },
  });
  await store.attachSession(task.id, "sub_command_owner_1", "coder", "coder");

  let releaseFirstStop!: () => void;
  const firstStopReleased = new Promise<void>((resolve) => {
    releaseFirstStop = resolve;
  });
  let signalFirstStop!: () => void;
  const firstStopStarted = new Promise<void>((resolve) => {
    signalFirstStop = resolve;
  });
  const stops: string[] = [];
  const spawns: string[] = [];
  const controller = createSubTaskUpdateController({
    runtimeStore: store,
    conversationStore: {
      get: () => ({ messages: [] }),
    },
    orchestrator: {
      getSession(sessionId: string) {
        return sessionId === "sub_command_owner_1"
          ? {
            id: sessionId,
            status: "running" as const,
            launchSpec: {
              parentConversationId: "conv-command-owner",
              agentId: "coder",
              profileId: "coder",
              instruction: "Implement command ownership",
              background: true,
              timeoutMs: 60_000,
              channel: "subtask",
            },
          }
          : undefined;
      },
      async stopSession(sessionId: string) {
        stops.push(sessionId);
        if (stops.length === 1) {
          signalFirstStop();
        }
        await firstStopReleased;
        return true;
      },
      async spawn(opts: any) {
        spawns.push(String(opts.launchSpec?.instruction));
        opts.onSessionCreated?.("sub_command_owner_2", "coder");
        return {
          success: true,
          output: "claimed steering result",
          sessionId: "sub_command_owner_2",
        };
      },
    } as any,
  });

  const first = controller(task.id, "Focus on the command claim regression.");
  await firstStopStarted;
  const replay = controller(task.id, "Focus on the command claim regression.");
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(stops).toEqual(["sub_command_owner_1"]);
  releaseFirstStop();
  await Promise.all([first, replay]);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await store.getTask(task.id))?.status === "done") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(spawns).toEqual(["Focus on the command claim regression."]);
  expect((await store.getTask(task.id))?.steering).toHaveLength(1);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store persists resume records across reload", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-resume-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-resume",
      agentId: "coder",
      instruction: "Continue runtime bridge",
    },
  });
  await store.attachSession(task.id, "sub_resume_1");
  await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_resume_1",
    output: "first result",
  });

  const accepted = await store.requestResume(task.id, "Continue with the remaining integration cases.", {
    sessionId: "sub_resume_1",
  });
  expect(accepted?.resume).toMatchObject({
    status: "accepted",
    requestedSessionId: "sub_resume_1",
  });

  await store.attachSession(task.id, "sub_resume_2");
  await store.markResumeDelivered(task.id, String(accepted?.resume.id), {
    sessionId: "sub_resume_2",
    resumedFromSessionId: "sub_resume_1",
  });

  const completed = await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_resume_2",
    output: "second result",
  });
  expect(completed?.resume).toEqual([
    expect.objectContaining({
      status: "delivered",
      deliveredSessionId: "sub_resume_2",
      resumedFromSessionId: "sub_resume_1",
    }),
  ]);

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const persisted = await reloaded.getTask(task.id);
  expect(persisted?.resume).toEqual([
    expect.objectContaining({
      status: "delivered",
      deliveredSessionId: "sub_resume_2",
      resumedFromSessionId: "sub_resume_1",
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("subtask runtime store persists takeover records across reload", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-takeover-store-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-takeover-store",
      agentId: "coder",
      instruction: "Continue runtime bridge",
    },
  });
  await store.attachSession(task.id, "sub_takeover_store_1");

  const accepted = await store.requestTakeover(task.id, "researcher", "Switch to verification-focused continuation.", {
    sessionId: "sub_takeover_store_1",
    mode: "safe_point",
  });
  expect(accepted?.takeover).toMatchObject({
    status: "accepted",
    agentId: "researcher",
    mode: "safe_point",
    requestedSessionId: "sub_takeover_store_1",
  });

  await store.attachSession(task.id, "sub_takeover_store_2", "researcher", "researcher");
  await store.markTakeoverDelivered(task.id, String(accepted?.takeover.id), {
    sessionId: "sub_takeover_store_2",
    resumedFromSessionId: "sub_takeover_store_1",
  });

  const completed = await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_takeover_store_2",
    output: "takeover result",
  });
  expect(completed?.takeover).toEqual([
    expect.objectContaining({
      status: "delivered",
      agentId: "researcher",
      mode: "safe_point",
      deliveredSessionId: "sub_takeover_store_2",
      resumedFromSessionId: "sub_takeover_store_1",
    }),
  ]);

  const reloaded = new SubTaskRuntimeStore(stateDir);
  await reloaded.load();
  const persisted = await reloaded.getTask(task.id);
  expect(persisted?.takeover).toEqual([
    expect.objectContaining({
      status: "delivered",
      agentId: "researcher",
      mode: "safe_point",
      deliveredSessionId: "sub_takeover_store_2",
      resumedFromSessionId: "sub_takeover_store_1",
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("createSubTaskUpdateController records steering and relaunches the same task with prior history", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-update-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-update",
      agentId: "coder",
      instruction: "Implement runtime bridge",
      channel: "subtask",
    },
  });
  await store.attachSession(task.id, "sub_update_1", "coder");

  const stops: string[] = [];
  const spawns: Array<Record<string, unknown>> = [];
  const controller = createSubTaskUpdateController({
    runtimeStore: store,
    conversationStore: {
      get: (conversationId: string) => conversationId === "sub_update_1"
        ? {
          messages: [
            { role: "user", content: "Implement runtime bridge" },
            { role: "assistant", content: "Need to inspect failing tests first." },
          ],
        }
        : undefined,
    },
    orchestrator: {
      getSession(sessionId: string) {
        if (sessionId !== "sub_update_1") return undefined;
        return {
          id: sessionId,
          status: "running" as const,
          launchSpec: {
            parentConversationId: "conv-update",
            agentId: "coder",
            profileId: "coder",
            instruction: "Implement runtime bridge",
            background: true,
            timeoutMs: 60_000,
            channel: "subtask",
          },
        };
      },
      async stopSession(sessionId: string) {
        stops.push(sessionId);
        await store.completeTask(task.id, {
          status: "stopped",
          sessionId,
          error: "relaunching after steering",
        });
        return true;
      },
      async spawn(opts: any) {
        spawns.push({
          instruction: opts.launchSpec?.instruction,
          history: opts.history,
          resumedFromSessionId: opts.resumedFromSessionId,
        });
        opts.onSessionCreated?.("sub_update_2", String(opts.launchSpec?.agentId ?? "coder"));
        return {
          success: true,
          output: "steered result",
          sessionId: "sub_update_2",
        };
      },
    } as any,
  });

  const accepted = await controller(task.id, "Prioritize the integration failure and skip unrelated cleanup.");
  expect(accepted?.steering).toEqual([
    expect.objectContaining({
      status: "accepted",
    }),
  ]);

  let updated = await store.getTask(task.id);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (updated?.status === "done") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    updated = await store.getTask(task.id);
  }

  expect(stops).toEqual(["sub_update_1"]);
  expect(spawns).toEqual([
    expect.objectContaining({
      instruction: "Prioritize the integration failure and skip unrelated cleanup.",
      resumedFromSessionId: "sub_update_1",
      history: [
        { role: "user", content: "Implement runtime bridge" },
        { role: "assistant", content: "Need to inspect failing tests first." },
      ],
    }),
  ]);

  expect(updated).toMatchObject({
    sessionId: "sub_update_2",
    status: "done",
  });
  expect(updated?.steering).toEqual([
    expect.objectContaining({
      status: "delivered",
      deliveredSessionId: "sub_update_2",
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("createSubTaskTakeoverController relaunches a running task at a safe point under a new agent", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-safe-point-takeover-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-safe-point-takeover",
      agentId: "coder",
      instruction: "Implement runtime bridge",
      channel: "subtask",
    },
  });
  await store.attachSession(task.id, "sub_safe_takeover_1", "coder");

  const stops: string[] = [];
  const spawns: Array<Record<string, unknown>> = [];
  const controller = createSubTaskTakeoverController({
    runtimeStore: store,
    conversationStore: {
      get: (conversationId: string) => conversationId === "sub_safe_takeover_1"
        ? {
          messages: [
            { role: "user", content: "Implement runtime bridge" },
            { role: "assistant", content: "Current run is blocked on verification details." },
          ],
        }
        : undefined,
    },
    orchestrator: {
      getSession(sessionId: string) {
        if (sessionId !== "sub_safe_takeover_1") return undefined;
        return {
          id: sessionId,
          status: "running" as const,
          launchSpec: {
            parentConversationId: "conv-safe-point-takeover",
            agentId: "coder",
            profileId: "coder",
            instruction: "Implement runtime bridge",
            background: true,
            timeoutMs: 60_000,
            channel: "subtask",
          },
        };
      },
      async stopSession(sessionId: string) {
        stops.push(sessionId);
        await store.completeTask(task.id, {
          status: "stopped",
          sessionId,
          error: "safe-point takeover relaunch",
        });
        return true;
      },
      async spawn(opts: any) {
        spawns.push({
          agentId: opts.launchSpec?.agentId,
          profileId: opts.launchSpec?.profileId,
          instruction: opts.launchSpec?.instruction,
          history: opts.history,
          resumedFromSessionId: opts.resumedFromSessionId,
        });
        opts.onSessionCreated?.("sub_safe_takeover_2", String(opts.launchSpec?.agentId ?? "researcher"));
        return {
          success: true,
          output: "safe-point takeover finished",
          sessionId: "sub_safe_takeover_2",
        };
      },
    } as any,
  });

  const accepted = await controller(
    task.id,
    "researcher",
    "Continue from the latest safe point and focus on verification.",
  );
  expect(accepted?.takeover).toEqual([
    expect.objectContaining({
      status: "accepted",
      agentId: "researcher",
      mode: "safe_point",
      message: expect.stringContaining("Take over this subtask as agent researcher."),
    }),
  ]);

  let updated = await store.getTask(task.id);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (updated?.status === "done" && updated?.sessionId === "sub_safe_takeover_2") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    updated = await store.getTask(task.id);
  }

  expect(stops).toEqual(["sub_safe_takeover_1"]);
  expect(spawns).toEqual([
    expect.objectContaining({
      agentId: "researcher",
      profileId: "researcher",
      resumedFromSessionId: "sub_safe_takeover_1",
      history: [
        { role: "user", content: "Implement runtime bridge" },
        { role: "assistant", content: "Current run is blocked on verification details." },
      ],
    }),
  ]);
  expect(String(spawns[0]?.instruction || "")).toContain("safe point under agent researcher");

  expect(updated).toMatchObject({
    sessionId: "sub_safe_takeover_2",
    status: "done",
    agentId: "researcher",
    launchSpec: {
      agentId: "researcher",
      profileId: "researcher",
    },
  });
  expect(updated?.takeover).toEqual([
    expect.objectContaining({
      status: "delivered",
      agentId: "researcher",
      mode: "safe_point",
      deliveredSessionId: "sub_safe_takeover_2",
      resumedFromSessionId: "sub_safe_takeover_1",
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("createSubTaskResumeController relaunches a finished task with prior history", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-resume-controller-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-resume-controller",
      agentId: "coder",
      instruction: "Implement runtime bridge",
      channel: "subtask",
    },
  });
  await store.attachSession(task.id, "sub_resume_controller_1", "coder");
  await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_resume_controller_1",
    output: "first pass finished",
  });

  const spawns: Array<Record<string, unknown>> = [];
  const controller = createSubTaskResumeController({
    runtimeStore: store,
    conversationStore: {
      get: (conversationId: string) => conversationId === "sub_resume_controller_1"
        ? {
          messages: [
            { role: "user", content: "Implement runtime bridge" },
            { role: "assistant", content: "First pass finished, but integration coverage is still missing." },
          ],
        }
        : undefined,
    },
    orchestrator: {
      getSession(sessionId: string) {
        if (sessionId !== "sub_resume_controller_1") return undefined;
        return {
          id: sessionId,
          status: "done" as const,
          launchSpec: {
            parentConversationId: "conv-resume-controller",
            agentId: "coder",
            profileId: "coder",
            instruction: "Implement runtime bridge",
            background: true,
            timeoutMs: 60_000,
            channel: "subtask",
          },
        };
      },
      async spawn(opts: any) {
        spawns.push({
          instruction: opts.launchSpec?.instruction,
          history: opts.history,
          resumedFromSessionId: opts.resumedFromSessionId,
        });
        opts.onSessionCreated?.("sub_resume_controller_2", String(opts.launchSpec?.agentId ?? "coder"));
        return {
          success: true,
          output: "second pass finished",
          sessionId: "sub_resume_controller_2",
        };
      },
    } as any,
  });

  const accepted = await controller(task.id, "Continue from the first pass and close the missing integration coverage.");
  expect(accepted?.resume).toEqual([
    expect.objectContaining({
      status: "accepted",
    }),
  ]);

  let updated = await store.getTask(task.id);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (updated?.status === "done" && updated?.sessionId === "sub_resume_controller_2") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    updated = await store.getTask(task.id);
  }

  expect(spawns).toEqual([
    expect.objectContaining({
      resumedFromSessionId: "sub_resume_controller_1",
      history: [
        { role: "user", content: "Implement runtime bridge" },
        { role: "assistant", content: "First pass finished, but integration coverage is still missing." },
      ],
    }),
  ]);
  expect(String(spawns[0]?.instruction || "")).toContain("Resume guidance: Continue from the first pass");

  expect(updated).toMatchObject({
    sessionId: "sub_resume_controller_2",
    status: "done",
  });
  expect(updated?.resume).toEqual([
    expect.objectContaining({
      status: "delivered",
      deliveredSessionId: "sub_resume_controller_2",
      resumedFromSessionId: "sub_resume_controller_1",
    }),
  ]);

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("createSubTaskResumeController can relaunch a finished task under a takeover agent", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-takeover-controller-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-takeover-controller",
      agentId: "coder",
      instruction: "Implement runtime bridge",
      channel: "subtask",
    },
  });
  await store.attachSession(task.id, "sub_takeover_controller_1", "coder");
  await store.completeTask(task.id, {
    status: "done",
    sessionId: "sub_takeover_controller_1",
    output: "first pass finished",
  });

  const spawns: Array<Record<string, unknown>> = [];
  const controller = createSubTaskResumeController({
    runtimeStore: store,
    conversationStore: {
      get: (conversationId: string) => conversationId === "sub_takeover_controller_1"
        ? {
          messages: [
            { role: "user", content: "Implement runtime bridge" },
            { role: "assistant", content: "First pass finished, but a verification agent should continue." },
          ],
        }
        : undefined,
    },
    orchestrator: {
      getSession(sessionId: string) {
        if (sessionId !== "sub_takeover_controller_1") return undefined;
        return {
          id: sessionId,
          status: "done" as const,
          launchSpec: {
            parentConversationId: "conv-takeover-controller",
            agentId: "coder",
            profileId: "coder",
            instruction: "Implement runtime bridge",
            background: true,
            timeoutMs: 60_000,
            channel: "subtask",
          },
        };
      },
      async spawn(opts: any) {
        spawns.push({
          agentId: opts.launchSpec?.agentId,
          profileId: opts.launchSpec?.profileId,
          instruction: opts.launchSpec?.instruction,
          resumedFromSessionId: opts.resumedFromSessionId,
        });
        opts.onSessionCreated?.("sub_takeover_controller_2", String(opts.launchSpec?.agentId ?? "researcher"));
        return {
          success: true,
          output: "takeover pass finished",
          sessionId: "sub_takeover_controller_2",
        };
      },
    } as any,
  });

  const accepted = await controller(
    task.id,
    "Continue with verification-focused follow-up.",
    { takeoverAgentId: "researcher" },
  );
  expect(accepted?.resume).toEqual([
    expect.objectContaining({
      status: "accepted",
      message: expect.stringContaining("Take over this subtask as agent researcher."),
    }),
  ]);

  let updated = await store.getTask(task.id);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (updated?.status === "done" && updated?.sessionId === "sub_takeover_controller_2") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    updated = await store.getTask(task.id);
  }

  expect(spawns).toEqual([
    expect.objectContaining({
      agentId: "researcher",
      profileId: "researcher",
      resumedFromSessionId: "sub_takeover_controller_1",
    }),
  ]);
  expect(updated).toMatchObject({
    sessionId: "sub_takeover_controller_2",
    status: "done",
    agentId: "researcher",
    launchSpec: {
      agentId: "researcher",
      profileId: "researcher",
    },
  });

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("reconcileSubTaskWorktreeRuntimes recovers active tasks and cleans archived worktrees", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-reconcile-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const activeTask = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-reconcile",
      agentId: "coder",
      instruction: "Recover active worktree runtime",
      cwd: path.join(stateDir, "repo", "src"),
      isolationMode: "worktree",
    },
  });
  await store.updateTaskWorktreeRuntime(activeTask.id, {
    runtimeSummary: {
      requestedCwd: path.join(stateDir, "repo", "src"),
      resolvedCwd: path.join(stateDir, "worktrees", activeTask.id, "src"),
      worktreePath: path.join(stateDir, "worktrees", activeTask.id),
      worktreeRepoRoot: path.join(stateDir, "repo"),
      worktreeBranch: `belldandy-${activeTask.id}`,
      worktreeStatus: "created",
    },
  });

  const archivedTask = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-reconcile",
      agentId: "coder",
      instruction: "Cleanup archived worktree runtime",
      cwd: path.join(stateDir, "repo", "pkg"),
      isolationMode: "worktree",
    },
  });
  await store.updateTaskWorktreeRuntime(archivedTask.id, {
    runtimeSummary: {
      requestedCwd: path.join(stateDir, "repo", "pkg"),
      resolvedCwd: path.join(stateDir, "worktrees", archivedTask.id, "pkg"),
      worktreePath: path.join(stateDir, "worktrees", archivedTask.id),
      worktreeRepoRoot: path.join(stateDir, "repo"),
      worktreeBranch: `belldandy-${archivedTask.id}`,
      worktreeStatus: "created",
    },
  });
  await store.completeTask(archivedTask.id, {
    status: "done",
    output: "archived result",
  });
  await store.archiveTask(archivedTask.id, "Archive after completion.");

  const reconcileCalls: string[] = [];
  const cleanupCalls: string[] = [];
  const result = await reconcileSubTaskWorktreeRuntimes({
    runtimeStore: store,
    worktreeRuntime: {
      async reconcileTaskRuntime(taskId: string, runtime: Record<string, unknown>) {
        reconcileCalls.push(taskId);
        return {
          requestedCwd: runtime.cwd as string,
          resolvedCwd: path.join(String(runtime.worktreePath), "recovered"),
          worktreePath: runtime.worktreePath as string,
          worktreeRepoRoot: runtime.worktreeRepoRoot as string,
          worktreeBranch: runtime.worktreeBranch as string,
          worktreeStatus: "created",
        };
      },
      async cleanupTaskRuntime(taskId: string, runtime: Record<string, unknown>) {
        cleanupCalls.push(taskId);
        return {
          requestedCwd: runtime.cwd as string,
          resolvedCwd: runtime.resolvedCwd as string,
          worktreePath: runtime.worktreePath as string,
          worktreeRepoRoot: runtime.worktreeRepoRoot as string,
          worktreeBranch: runtime.worktreeBranch as string,
          worktreeStatus: "removed",
        };
      },
    } as any,
  });

  expect(result).toMatchObject({
    scanned: 2,
    reconciled: 1,
    cleaned: 1,
    failed: 0,
  });
  expect(reconcileCalls).toEqual([activeTask.id]);
  expect(cleanupCalls).toEqual([archivedTask.id]);

  const activeRecord = await store.getTask(activeTask.id);
  const archivedRecord = await store.getTask(archivedTask.id);
  expect(activeRecord?.launchSpec).toMatchObject({
    worktreeStatus: "created",
    resolvedCwd: path.join(String(activeRecord?.launchSpec.worktreePath), "recovered"),
  });
  expect(archivedRecord?.launchSpec.worktreeStatus).toBe("removed");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});

test("createSubTaskWorktreeLifecycleHandler cleans archived worktrees asynchronously", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-subtask-lifecycle-"));
  const store = new SubTaskRuntimeStore(stateDir);
  await store.load();

  const task = await store.createTask({
    launchSpec: {
      parentConversationId: "conv-lifecycle",
      agentId: "coder",
      instruction: "Archive and cleanup",
      cwd: path.join(stateDir, "repo", "src"),
      isolationMode: "worktree",
    },
  });
  await store.updateTaskWorktreeRuntime(task.id, {
    runtimeSummary: {
      requestedCwd: path.join(stateDir, "repo", "src"),
      resolvedCwd: path.join(stateDir, "worktrees", task.id, "src"),
      worktreePath: path.join(stateDir, "worktrees", task.id),
      worktreeRepoRoot: path.join(stateDir, "repo"),
      worktreeBranch: `belldandy-${task.id}`,
      worktreeStatus: "created",
    },
  });
  await store.completeTask(task.id, {
    status: "done",
    output: "ready to archive",
  });

  const cleanupCalls: string[] = [];
  store.subscribe(createSubTaskWorktreeLifecycleHandler({
    runtimeStore: store,
    worktreeRuntime: {
      async cleanupTaskRuntime(taskId: string, runtime: Record<string, unknown>) {
        cleanupCalls.push(taskId);
        return {
          requestedCwd: runtime.cwd as string,
          resolvedCwd: runtime.resolvedCwd as string,
          worktreePath: runtime.worktreePath as string,
          worktreeRepoRoot: runtime.worktreeRepoRoot as string,
          worktreeBranch: runtime.worktreeBranch as string,
          worktreeStatus: "removed",
        };
      },
    } as any,
  }));

  await store.archiveTask(task.id, "Archive task and cleanup worktree.");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(cleanupCalls).toEqual([task.id]);
  const archived = await store.getTask(task.id);
  expect(archived?.launchSpec.worktreeStatus).toBe("removed");

  await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
});
