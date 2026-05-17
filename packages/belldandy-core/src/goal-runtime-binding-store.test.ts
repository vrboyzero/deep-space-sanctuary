import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GoalManager } from "./goals/manager.js";
import { GoalRuntimeBindingStore } from "./goal-runtime-binding-store.js";
import { SubTaskRuntimeStore } from "./task-runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
});

async function createTempStateDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("GoalRuntimeBindingStore integrations", () => {
  it("persists goal session bindings for goal/node/run conversations", async () => {
    const stateDir = await createTempStateDir("belldandy-goal-binding-");
    const bindingStore = new GoalRuntimeBindingStore(stateDir);
    const goalManager = new GoalManager(stateDir, {
      bindingStore,
    });

    const goal = await goalManager.createGoal({
      title: "阶段 3 绑定账本验证",
      objective: "验证 goal/node/run 绑定能独立落盘",
    });
    const created = await goalManager.createTaskNode(goal.id, {
      title: "实现 binding ledger",
      status: "ready",
    });
    const resumed = await goalManager.resumeGoal(goal.id, created.node.id);

    const activeBinding = await bindingStore.getBinding(`goal-session:${resumed.conversationId}`);
    expect(activeBinding).toMatchObject({
      source: "goal_session",
      goalId: goal.id,
      nodeId: created.node.id,
      runId: resumed.runId,
      conversationId: resumed.conversationId,
      status: "executing",
      scopeKeys: {
        goal: `goal:${goal.id}`,
        node: `goal:${goal.id}:node:${created.node.id}`,
        run: `goal:${goal.id}:node:${created.node.id}:run:${resumed.runId}`,
      },
    });

    await goalManager.pauseGoal(goal.id);

    const pausedBinding = await bindingStore.getBinding(`goal-session:${resumed.conversationId}`);
    expect(pausedBinding?.status).toBe("paused");
  });

  it("persists goal subtask bindings with run and agent isolation keys", async () => {
    const stateDir = await createTempStateDir("belldandy-subtask-binding-");
    const bindingStore = new GoalRuntimeBindingStore(stateDir);
    const runtimeStore = new SubTaskRuntimeStore(stateDir, undefined, bindingStore);
    await runtimeStore.load();

    const task = await runtimeStore.createTask({
      launchSpec: {
        parentConversationId: "goal:goal_binding_demo:node:node_impl:run:run_bind_1",
        agentId: "coder",
        instruction: "实现长期任务节点的绑定账本",
        channel: "goal",
        timeoutMs: 45_000,
        delegationProtocol: {
          source: "goal_subtask",
          intent: {
            kind: "goal_execution",
            summary: "执行 goal node",
            role: "coder",
            goalId: "goal_binding_demo",
            nodeId: "node_impl",
          },
          contextPolicy: {
            includeParentConversation: true,
            includeStructuredContext: true,
            contextKeys: ["goalId", "nodeId"],
          },
          expectedDeliverable: {
            format: "patch",
            summary: "提交节点实现结果",
          },
          aggregationPolicy: {
            mode: "main_agent_summary",
            summarizeFailures: true,
          },
          launchDefaults: {},
        },
      } as any,
    });

    await runtimeStore.attachSession(task.id, "sub_goal_bind_1", "coder", "coder");
    await runtimeStore.completeTask(task.id, {
      status: "done",
      sessionId: "sub_goal_bind_1",
      output: "binding ledger implemented",
    });

    const bindings = await bindingStore.listBindings({ taskId: task.id });
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      source: "goal_subtask",
      goalId: "goal_binding_demo",
      nodeId: "node_impl",
      runId: "run_bind_1",
      taskId: task.id,
      agentId: "coder",
      sessionId: "sub_goal_bind_1",
      status: "done",
      scopeKeys: {
        goal: "goal:goal_binding_demo",
        node: "goal:goal_binding_demo:node:node_impl",
        run: "goal:goal_binding_demo:node:node_impl:run:run_bind_1",
        agent: "goal:goal_binding_demo:node:node_impl:run:run_bind_1:agent:coder",
      },
    });
  });
});
