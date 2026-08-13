import { describe, expect, it, vi } from "vitest";

import type { AgentLaunchSpec } from "@belldandy/agent";
import type { SubAgentResult } from "@belldandy/skills";

import {
  SubTaskSupervisorAdmissionError,
  SubTaskSupervisorRuntime,
} from "./subtask-supervisor-runtime.js";

function createParallelLaunch(input: {
  instruction?: string;
  laneId?: string;
  writeScope?: string[];
  cwd?: string;
  timeoutMs?: number;
  depth?: number;
  role?: "coder" | "verifier";
} = {}): AgentLaunchSpec {
  const laneId = input.laneId ?? "lane_1";
  const role = input.role ?? "coder";
  return {
    instruction: input.instruction ?? "Implement the assigned lane.",
    parentConversationId: "conversation-manager",
    agentId: role,
    profileId: role,
    background: true,
    timeoutMs: input.timeoutMs ?? 30_000,
    channel: "subtask",
    context: input.depth === undefined ? undefined : { _orchestratorDepth: input.depth },
    cwd: input.cwd ?? "E:\\repo",
    isolationMode: "workspace",
    role,
    delegationProtocol: {
      source: "delegate_parallel",
      intent: { kind: "parallel_subtasks", summary: "Implement a parallel lane.", role },
      contextPolicy: {
        includeParentConversation: true,
        includeStructuredContext: false,
        contextKeys: [],
      },
      expectedDeliverable: { format: "patch", summary: "Return a verified patch." },
      aggregationPolicy: { mode: "parallel_collect", summarizeFailures: true },
      launchDefaults: {},
      ...(input.writeScope ? {
        ownership: { scopeSummary: "Owned lane.", writeScope: input.writeScope },
      } : {}),
      team: {
        id: "team-supervised",
        mode: input.writeScope ? "parallel_patch" : "parallel_subtasks",
        currentLaneId: laneId,
        memberRoster: [{ laneId, agentId: role, role }],
      },
    },
  };
}

const parentOperation = { agentRunId: "run-manager", toolCallId: "tool-parallel" };

describe("SubTaskSupervisorRuntime", () => {
  it("tightens governed lane run budgets and projects the content-free budget envelope", async () => {
    let releaseLaunch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const runtime = new SubTaskSupervisorRuntime({
      maxActiveChildren: 4,
      maxVerifierChildren: 1,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
      toolLoopIterationBudget: 6,
      maxTotalTokens: 12_000,
      maxCostUsd: 0.5,
      maxHighRiskToolCalls: 2,
      maxToolRiskLevel: "medium",
    });
    const launchSpec: AgentLaunchSpec = {
      ...createParallelLaunch({ timeoutMs: 50_000 }),
      maxRunWallTimeMs: 55_000,
      toolLoopIterationBudget: 10,
      maxTotalTokens: 8_000,
      maxCostUsd: 0.8,
      maxHighRiskToolCalls: 0,
      maxToolRiskLevel: "high",
    };
    const launch = vi.fn(async (received: AgentLaunchSpec): Promise<SubAgentResult> => {
      expect(received).toMatchObject({
        timeoutMs: 50_000,
        maxRunWallTimeMs: 50_000,
        toolLoopIterationBudget: 6,
        maxTotalTokens: 8_000,
        maxCostUsd: 0.5,
        maxHighRiskToolCalls: 2,
        maxToolRiskLevel: "medium",
      });
      await blocked;
      return { success: true, output: "bounded" };
    });

    const pending = runtime.execute({
      launchSpec,
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));

    expect(runtime.getSnapshot()).toMatchObject({
      contentMode: "none",
      budget: {
        activeChildren: 1,
        maxActiveChildren: 4,
        activeVerifiers: 0,
        maxVerifierChildren: 1,
        maxRunWallTimeMs: 60_000,
        toolLoopIterationBudget: 6,
        maxTotalTokens: 12_000,
        maxCostUsd: 0.5,
        maxHighRiskToolCalls: 2,
        maxToolRiskLevel: "medium",
      },
    });
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain("bounded");

    releaseLaunch();
    await pending;
  });

  it("forces a structured parallel write lane into an isolated worktree and exposes no-content projection", async () => {
    let releaseLaunch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const runtime = new SubTaskSupervisorRuntime({
      maxActiveChildren: 2,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    });
    const launch = vi.fn(async (launchSpec: AgentLaunchSpec, observer: {
      bindTask(taskId: string): void;
      bindSession(sessionId: string): void;
    }): Promise<SubAgentResult> => {
      expect(launchSpec.isolationMode).toBe("worktree");
      observer.bindTask("task-supervised");
      observer.bindSession("session-supervised");
      await blocked;
      return { success: true, output: "private worker output", taskId: "task-supervised", sessionId: "session-supervised" };
    });

    const pending = runtime.execute({
      launchSpec: createParallelLaunch({ writeScope: ["packages/core/**"] }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));

    expect(runtime.getSnapshot()).toMatchObject({
      schemaVersion: "subtask-supervisor-runtime/v1",
      contentMode: "none",
      activeCount: 1,
      maxActiveChildren: 2,
      items: [{
        status: "running",
        mode: "write",
        binding: {
          managerConversationId: "conversation-manager",
          managerAgentRunId: "run-manager",
          teamId: "team-supervised",
          laneId: "lane_1",
          taskId: "task-supervised",
          sessionId: "session-supervised",
        },
      }],
    });
    const serialized = JSON.stringify(runtime.getSnapshot());
    expect(serialized).not.toContain("Implement the assigned lane");
    expect(serialized).not.toContain("E:\\repo");
    expect(serialized).not.toContain("private worker output");

    releaseLaunch();
    await expect(pending).resolves.toMatchObject({ success: true, taskId: "task-supervised" });
    expect(runtime.getSnapshot()).toMatchObject({ activeCount: 0, retainedTerminalCount: 1 });
  });

  it("deduplicates an identical active lane and rejects a conflicting retry", async () => {
    let resolveLaunch!: (result: SubAgentResult) => void;
    const launchResult = new Promise<SubAgentResult>((resolve) => {
      resolveLaunch = resolve;
    });
    const runtime = new SubTaskSupervisorRuntime({ maxActiveChildren: 2, maxDepth: 2, maxWallTimeMs: 60_000 });
    const launch = vi.fn(async () => launchResult);
    const input = {
      launchSpec: createParallelLaunch(),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    };

    const first = runtime.execute(input);
    const retry = runtime.execute(input);
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    await expect(runtime.execute({
      ...input,
      launchSpec: createParallelLaunch({ instruction: "Conflicting lane instruction." }),
    })).rejects.toMatchObject({ code: "binding_conflict" });

    resolveLaunch({ success: true, output: "done", taskId: "task-one", sessionId: "session-one" });
    await expect(Promise.all([first, retry])).resolves.toEqual([
      expect.objectContaining({ taskId: "task-one" }),
      expect.objectContaining({ taskId: "task-one" }),
    ]);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("fails admission before launch when policy, binding, or worktree requirements are unavailable", async () => {
    const runtime = new SubTaskSupervisorRuntime({ maxActiveChildren: 1, maxDepth: 2, maxWallTimeMs: 60_000 });
    const launch = vi.fn(async (): Promise<SubAgentResult> => ({ success: true, output: "unexpected" }));
    const cases: Array<{ expectedCode: SubTaskSupervisorAdmissionError["code"]; input: Parameters<typeof runtime.execute>[0] }> = [
      {
        expectedCode: "manager_binding_required",
        input: {
          launchSpec: createParallelLaunch(),
          worktreeIsolationAvailable: true,
          launch,
        },
      },
      {
        expectedCode: "worktree_required",
        input: {
          launchSpec: createParallelLaunch({ writeScope: ["src/**"] }),
          parentOperation,
          worktreeIsolationAvailable: false,
          launch,
        },
      },
      {
        expectedCode: "depth_exceeded",
        input: {
          launchSpec: createParallelLaunch({ depth: 2 }),
          parentOperation,
          worktreeIsolationAvailable: true,
          launch,
        },
      },
      {
        expectedCode: "wall_time_exceeded",
        input: {
          launchSpec: createParallelLaunch({ timeoutMs: 60_001 }),
          parentOperation,
          worktreeIsolationAvailable: true,
          launch,
        },
      },
    ];

    for (const item of cases) {
      await expect(runtime.execute(item.input)).rejects.toMatchObject({ code: item.expectedCode });
    }
    expect(launch).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().activeCount).toBe(0);
  });

  it("rejects a new lane when the active child budget is exhausted", async () => {
    let releaseLaunch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const runtime = new SubTaskSupervisorRuntime({ maxActiveChildren: 1, maxDepth: 2, maxWallTimeMs: 60_000 });
    const launch = vi.fn(async (): Promise<SubAgentResult> => {
      await blocked;
      return { success: true, output: "done" };
    });
    const first = runtime.execute({
      launchSpec: createParallelLaunch({ laneId: "lane_1" }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));

    await expect(runtime.execute({
      launchSpec: createParallelLaunch({ laneId: "lane_2" }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    })).rejects.toMatchObject({ code: "child_budget_exceeded" });
    expect(launch).toHaveBeenCalledTimes(1);

    releaseLaunch();
    await first;
  });

  it("rejects an additional active verifier lane before launch", async () => {
    let releaseLaunch!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const runtime = new SubTaskSupervisorRuntime({
      maxActiveChildren: 4,
      maxVerifierChildren: 1,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    });
    const launch = vi.fn(async (): Promise<SubAgentResult> => {
      await blocked;
      return { success: true, output: "verified" };
    });
    const first = runtime.execute({
      launchSpec: createParallelLaunch({ laneId: "verify_1", role: "verifier" }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));

    await expect(runtime.execute({
      launchSpec: createParallelLaunch({ laneId: "verify_2", role: "verifier" }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    })).rejects.toMatchObject({ code: "verifier_budget_exceeded" });
    expect(runtime.getSnapshot()).toMatchObject({
      budget: { activeVerifiers: 1, maxVerifierChildren: 1 },
      items: [expect.objectContaining({ role: "verifier" })],
    });
    expect(launch).toHaveBeenCalledTimes(1);

    releaseLaunch();
    await first;
  });

  it("keeps legacy single-child launch behavior outside the governed parallel seam", async () => {
    const runtime = new SubTaskSupervisorRuntime({ maxActiveChildren: 1, maxDepth: 1, maxWallTimeMs: 1 });
    const launchSpec = { ...createParallelLaunch(), delegationProtocol: undefined, timeoutMs: 120_000 };
    const launch = vi.fn(async (received: AgentLaunchSpec): Promise<SubAgentResult> => ({
      success: true,
      output: "legacy",
      taskId: received.parentConversationId,
    }));

    await expect(runtime.execute({
      launchSpec,
      worktreeIsolationAvailable: false,
      launch,
    })).resolves.toMatchObject({ success: true, taskId: "conversation-manager" });
    expect(launch).toHaveBeenCalledWith(launchSpec, expect.any(Object));
    expect(runtime.getSnapshot()).toMatchObject({ activeCount: 0, retainedTerminalCount: 0 });
  });

  it("reattaches persisted exact bindings after restart without relaunching child work", async () => {
    const runtime = new SubTaskSupervisorRuntime({ maxActiveChildren: 2, maxDepth: 2, maxWallTimeMs: 60_000 });
    const launch = vi.fn(async (): Promise<SubAgentResult> => ({ success: true, output: "unexpected" }));

    runtime.reattach([{
      binding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-supervised",
        laneId: "lane_1",
        mode: "write",
      },
      taskId: "task-restart-lost",
      sessionId: "session-restart-lost",
      status: "interrupted",
      admittedAtMs: 100,
      updatedAtMs: 200,
      finishedAtMs: 200,
    }]);

    expect(runtime.observe({
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-supervised",
      laneId: "lane_1",
      taskId: "task-restart-lost",
      sessionId: "session-restart-lost",
    })).toMatchObject({
      status: "interrupted",
      mode: "write",
      binding: { taskId: "task-restart-lost", sessionId: "session-restart-lost" },
    });
    expect(() => runtime.observe({
      managerConversationId: "conversation-manager",
      managerAgentRunId: "wrong-run",
      teamId: "team-supervised",
      laneId: "lane_1",
      taskId: "task-restart-lost",
    })).toThrowError(expect.objectContaining({ code: "binding_conflict" }));

    await expect(runtime.execute({
      launchSpec: createParallelLaunch({ writeScope: ["packages/core/**"] }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    })).rejects.toMatchObject({ code: "binding_conflict" });
    expect(launch).not.toHaveBeenCalled();
    expect(runtime.getSnapshot()).toMatchObject({ activeCount: 0, retainedTerminalCount: 1 });
  });

  it("publishes a 4-write and 8-read restart batch atomically when a persisted lane conflicts", () => {
    const runtime = new SubTaskSupervisorRuntime({
      maxActiveChildren: 12,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    });
    const lanes = Array.from({ length: 12 }, (_, index) => ({
      binding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-supervised",
        laneId: `lane_${index + 1}`,
        mode: index < 4 ? "write" as const : "read" as const,
      },
      taskId: `task-${index + 1}`,
      sessionId: `session-${index + 1}`,
      status: index % 3 === 0 ? "done" as const : index % 3 === 1 ? "timeout" as const : "interrupted" as const,
      admittedAtMs: 100 + index,
      updatedAtMs: 200 + index,
      finishedAtMs: 200 + index,
    }));

    expect(() => runtime.reattach([
      ...lanes,
      {
        ...lanes[11]!,
        binding: { ...lanes[11]!.binding, laneId: "lane_conflict" },
        taskId: "task-1",
      },
    ])).toThrowError(expect.objectContaining({ code: "binding_conflict" }));

    expect(runtime.getSnapshot()).toMatchObject({
      activeCount: 0,
      retainedTerminalCount: 0,
      items: [],
    });
  });

  it("keeps a steered session authoritative when the original launch settles late", async () => {
    let releaseOriginal!: () => void;
    const originalReleased = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });
    const runtime = new SubTaskSupervisorRuntime({ maxActiveChildren: 2, maxDepth: 2, maxWallTimeMs: 60_000 });
    const launch = async (_launchSpec: AgentLaunchSpec, observer: {
      bindTask(taskId: string): void;
      bindSession(sessionId: string): void;
    }): Promise<SubAgentResult> => {
      observer.bindTask("task-steered");
      observer.bindSession("session-original");
      await originalReleased;
      return {
        success: false,
        output: "",
        error: "Original session stopped for steering.",
        taskId: "task-steered",
        sessionId: "session-original",
      };
    };
    const pending = runtime.execute({
      launchSpec: createParallelLaunch({ writeScope: ["packages/core/**"] }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    });
    await vi.waitFor(() => expect(runtime.getSnapshot().items[0]?.binding.sessionId).toBe("session-original"));

    runtime.reconcile({
      binding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-supervised",
        laneId: "lane_1",
        mode: "write",
      },
      taskId: "task-steered",
      sessionId: "session-steered",
      status: "running",
      commandGeneration: 1,
      admittedAtMs: 100,
      updatedAtMs: 200,
    });
    releaseOriginal();
    await expect(pending).resolves.toMatchObject({ sessionId: "session-original" });

    expect(runtime.observe({
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-supervised",
      laneId: "lane_1",
      taskId: "task-steered",
      sessionId: "session-steered",
    })).toMatchObject({
      status: "running",
      binding: { sessionId: "session-steered" },
    });
  });

  it("releases mixed 4-write and 8-read lane budgets without accepting late obsolete completion", async () => {
    const releases = new Map<string, (result: SubAgentResult) => void>();
    const runtime = new SubTaskSupervisorRuntime({
      maxActiveChildren: 4,
      maxVerifierChildren: 1,
      maxDepth: 2,
      maxWallTimeMs: 60_000,
    });
    const launch = vi.fn(async (launchSpec: AgentLaunchSpec, observer: {
      bindTask(taskId: string): void;
      bindSession(sessionId: string): void;
    }): Promise<SubAgentResult> => {
      const laneId = launchSpec.delegationProtocol?.team?.currentLaneId ?? "unknown";
      observer.bindTask(`task-${laneId}`);
      observer.bindSession(`session-${laneId}`);
      return new Promise<SubAgentResult>((resolve) => {
        releases.set(laneId, resolve);
      });
    });
    const executeLane = (index: number) => runtime.execute({
      launchSpec: createParallelLaunch({
        laneId: `lane_${index + 1}`,
        ...(index < 4 ? { writeScope: [`packages/lane-${index + 1}/**`] } : {}),
        ...(index === 4 ? { role: "verifier" as const } : {}),
      }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    });

    const firstWave = [0, 1, 2, 4].map(executeLane);
    await vi.waitFor(() => expect(releases.size).toBe(4));
    expect(runtime.getSnapshot()).toMatchObject({
      activeCount: 4,
      budget: { activeChildren: 4, activeVerifiers: 1 },
    });

    for (const index of [3, 5, 6, 7, 8, 9, 10, 11]) {
      await expect(executeLane(index)).rejects.toMatchObject({ code: "child_budget_exceeded" });
    }

    releases.get("lane_1")?.({
      success: false,
      output: "",
      error: "Sub-agent timed out after 30000ms",
      taskId: "task-lane_1",
      sessionId: "session-lane_1",
    });
    releases.get("lane_2")?.({
      success: false,
      output: "",
      error: "Child process exited before completion.",
      taskId: "task-lane_2",
      sessionId: "session-lane_2",
    });
    releases.get("lane_5")?.({
      success: true,
      output: "verified",
      taskId: "task-lane_5",
      sessionId: "session-lane_5",
    });
    await Promise.all([firstWave[0], firstWave[1], firstWave[3]]);
    expect(runtime.getSnapshot()).toMatchObject({
      activeCount: 1,
      budget: { activeChildren: 1, activeVerifiers: 0 },
    });

    const secondWave = [3, 5, 6].map(executeLane);
    await vi.waitFor(() => expect(runtime.getSnapshot().activeCount).toBe(4));
    runtime.reconcile({
      binding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-supervised",
        laneId: "lane_3",
        mode: "write",
      },
      taskId: "task-lane_3",
      sessionId: "session-lane_3-steered",
      status: "running",
      commandGeneration: 1,
      admittedAtMs: 100,
      updatedAtMs: 200,
    });
    releases.get("lane_3")?.({
      success: false,
      output: "",
      error: "Original session stopped for steering.",
      taskId: "task-lane_3",
      sessionId: "session-lane_3",
    });
    await firstWave[2];
    expect(runtime.observe({
      managerConversationId: "conversation-manager",
      managerAgentRunId: "run-manager",
      teamId: "team-supervised",
      laneId: "lane_3",
      taskId: "task-lane_3",
      sessionId: "session-lane_3-steered",
    })).toMatchObject({ status: "running", revision: 1 });

    runtime.reconcile({
      binding: {
        managerConversationId: "conversation-manager",
        managerAgentRunId: "run-manager",
        teamId: "team-supervised",
        laneId: "lane_3",
        mode: "write",
      },
      taskId: "task-lane_3",
      sessionId: "session-lane_3-steered",
      status: "done",
      commandGeneration: 1,
      admittedAtMs: 100,
      updatedAtMs: 300,
      finishedAtMs: 300,
    });
    for (const laneId of ["lane_4", "lane_6", "lane_7"]) {
      releases.get(laneId)?.({
        success: true,
        output: "done",
        taskId: `task-${laneId}`,
        sessionId: `session-${laneId}`,
      });
    }
    await Promise.all(secondWave);

    for (const index of [7, 8, 9, 10, 11]) {
      const pending = executeLane(index);
      await vi.waitFor(() => expect(releases.has(`lane_${index + 1}`)).toBe(true));
      releases.get(`lane_${index + 1}`)?.({
        success: true,
        output: "done",
        taskId: `task-lane_${index + 1}`,
        sessionId: `session-lane_${index + 1}`,
      });
      await pending;
    }

    expect(runtime.getSnapshot()).toMatchObject({
      activeCount: 0,
      retainedTerminalCount: 12,
      budget: { activeChildren: 0, activeVerifiers: 0 },
    });

    const followUp = runtime.execute({
      launchSpec: createParallelLaunch({ laneId: "lane_13" }),
      parentOperation,
      worktreeIsolationAvailable: true,
      launch,
    });
    await vi.waitFor(() => expect(releases.has("lane_13")).toBe(true));
    releases.get("lane_13")?.({
      success: true,
      output: "done",
      taskId: "task-lane_13",
      sessionId: "session-lane_13",
    });
    await expect(followUp).resolves.toMatchObject({ success: true });
  });
});
