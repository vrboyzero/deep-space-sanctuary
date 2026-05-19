import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { MemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";
import { getGoalUpdateAreas } from "./goal-events.js";
import { GoalManager } from "./manager.js";
import { readGoalLearningReviewRefreshState } from "./learning-review-refresh.js";
import { SubTaskRuntimeStore } from "../task-runtime.js";
import {
  getGoalReviewNotificationDispatchesPath,
  getGoalReviewNotificationsPath,
  getReviewGovernanceConfigPath,
} from "./review-governance.js";
import { writeGoalSuggestionReviews } from "./runtime.js";

describe("GoalManager", () => {
  it("creates goals with default and custom roots, and supports resume/pause", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const customRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-custom-"));
    const manager = new GoalManager(stateDir);

    const goalA = await manager.createGoal({
      title: "Alpha Goal",
      objective: "Test default root",
    });
    const goalB = await manager.createGoal({
      title: "Beta Goal",
      objective: "Test custom root",
      goalRoot: path.join(customRoot, "goal_beta"),
    });

    expect(goalA.runtimeRoot).toContain(path.join("goals", goalA.id));
    expect(goalB.runtimeRoot).toBe(path.join(customRoot, "goal_beta"));

    const all = await manager.listGoals();
    expect(all.length).toBe(2);

    const resumed = await manager.resumeGoal(goalA.id, "node-1");
    expect(resumed.conversationId).toContain(`goal:${goalA.id}:node:node-1:run:`);
    expect(resumed.runId).toBeTruthy();
    expect(resumed.goal.lastNodeId).toBe("node-1");

    const paused = await manager.pauseGoal(goalA.id);
    expect(paused.status).toBe("paused");
    expect(paused.lastNodeId).toBe("node-1");
    expect(paused.lastRunId).toBeTruthy();

    const resumedLastNode = await manager.resumeGoal(goalA.id, paused.lastNodeId);
    expect(resumedLastNode.goal.activeNodeId).toBe("node-1");
    expect(resumedLastNode.goal.lastNodeId).toBe("node-1");
    expect(resumedLastNode.runId).toBeTruthy();

    const northstar = await fs.readFile(goalA.northstarPath, "utf-8");
    expect(northstar).toContain(`Goal Root: ${goalA.goalRoot}`);

    const taskGraph = JSON.parse(await fs.readFile(goalA.tasksPath, "utf-8"));
    expect(taskGraph.version).toBe(2);
    expect(taskGraph.goalId).toBe(goalA.id);

    const registry = JSON.parse(await fs.readFile(path.join(stateDir, "goals", "index.json"), "utf-8"));
    expect(registry.goals).toHaveLength(2);
  });

  it("records checkpoint replay when resuming a goal from an open checkpoint", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Checkpoint Replay Goal",
      objective: "Replay from an open checkpoint",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_replay",
      title: "Replay Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_replay", {
      runId: "run_replay_1",
      summary: "Checkpoint replay setup",
    });
    await manager.requestCheckpoint(goal.id, "node_replay", {
      title: "Need replay review",
      summary: "Replay should reopen the node channel.",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_replay_1",
    });

    const handoff = await manager.getHandoff(goal.id);
    expect(handoff.handoff.checkpointReplay).toMatchObject({
      checkpointId: expect.any(String),
      nodeId: "node_replay",
      title: "Need replay review",
    });

    const replayed = await manager.resumeGoal(goal.id, "node_replay", {
      checkpointId: handoff.handoff.checkpointReplay?.checkpointId,
    });
    expect(replayed.goal.activeNodeId).toBe("node_replay");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("checkpoint_replay_started");
    expect(progress).toContain(`Checkpoint: ${handoff.handoff.checkpointReplay?.checkpointId}`);
  });

  it("does not advance goal registry when runtime header persistence fails during resume", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Runtime Failure Goal",
      objective: "Keep registry/runtime consistent on runtime write failure",
    });

    const runtimePath = path.join(goal.runtimeRoot, "runtime.json");
    const originalRuntime = JSON.parse(await fs.readFile(runtimePath, "utf-8")) as {
      status: string;
      activeNodeId?: string;
    };
    const originalRegistry = JSON.parse(await fs.readFile(goal.registryPath, "utf-8")) as {
      goals: Array<{ id: string; status: string; activeNodeId?: string }>;
    };

    const originalRename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (target === runtimePath) {
        const error = new Error("runtime persistence failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return originalRename(source, target);
    });

    try {
      await expect(manager.resumeGoal(goal.id, "node_runtime_fail")).rejects.toThrow("runtime persistence failure");
    } finally {
      renameSpy.mockRestore();
    }

    const runtimeAfterFailure = JSON.parse(await fs.readFile(runtimePath, "utf-8")) as {
      status: string;
      activeNodeId?: string;
    };
    const registryAfterFailure = JSON.parse(await fs.readFile(goal.registryPath, "utf-8")) as {
      goals: Array<{ id: string; status: string; activeNodeId?: string }>;
    };
    const storedGoal = registryAfterFailure.goals.find((item) => item.id === goal.id);
    expect(runtimeAfterFailure.status).toBe(originalRuntime.status);
    expect(runtimeAfterFailure.activeNodeId).toBe(originalRuntime.activeNodeId);
    expect(storedGoal?.status).toBe(originalRegistry.goals.find((item) => item.id === goal.id)?.status);
    expect(storedGoal?.activeNodeId).toBeUndefined();
  });

  it("rolls runtime header state back when registry persistence fails during resume", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Registry Failure Goal",
      objective: "Keep runtime rolled back on registry write failure",
    });

    const runtimePath = path.join(goal.runtimeRoot, "runtime.json");
    const originalRuntime = JSON.parse(await fs.readFile(runtimePath, "utf-8")) as {
      status: string;
      activeNodeId?: string;
    };

    const originalRename = fs.rename.bind(fs);
    let registryFailed = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (!registryFailed && target === goal.registryPath) {
        registryFailed = true;
        const error = new Error("registry persistence failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return originalRename(source, target);
    });

    try {
      await expect(manager.resumeGoal(goal.id, "node_registry_fail")).rejects.toThrow("registry persistence failure");
    } finally {
      renameSpy.mockRestore();
    }

    const runtimeAfterFailure = JSON.parse(await fs.readFile(runtimePath, "utf-8")) as {
      status: string;
      activeNodeId?: string;
    };
    const registryAfterFailure = JSON.parse(await fs.readFile(goal.registryPath, "utf-8")) as {
      goals: Array<{ id: string; status: string; activeNodeId?: string }>;
    };
    const storedGoal = registryAfterFailure.goals.find((item) => item.id === goal.id);
    expect(runtimeAfterFailure.status).toBe(originalRuntime.status);
    expect(runtimeAfterFailure.activeNodeId).toBe(originalRuntime.activeNodeId);
    expect(storedGoal?.status).toBe("planning");
    expect(storedGoal?.activeNodeId).toBeUndefined();
  });

  it("reads and mutates formal task graph with dependency guards", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Gamma Goal",
      objective: "Task graph",
    });

    const emptyGraph = await manager.readTaskGraph(goal.id);
    expect(emptyGraph.version).toBe(2);
    expect(emptyGraph.nodes).toHaveLength(0);

    const root = await manager.createTaskNode(goal.id, {
      id: "node_root",
      title: "Root Node",
      status: "ready",
    });
    expect(root.node.id).toBe("node_root");

    const child = await manager.createTaskNode(goal.id, {
      id: "node_child",
      title: "Child Node",
      dependsOn: ["node_root"],
      status: "ready",
    });
    expect(child.graph.edges).toHaveLength(1);
    expect(child.graph.edges[0]).toMatchObject({ from: "node_root", to: "node_child" });

    await expect(manager.claimTaskNode(goal.id, "node_child")).rejects.toThrow(/unfinished dependencies/i);

    const claimedRoot = await manager.claimTaskNode(goal.id, "node_root", {
      owner: "agent.main",
      runId: "run_demo",
    });
    expect(claimedRoot.node.status).toBe("in_progress");
    expect(claimedRoot.goal.activeNodeId).toBe("node_root");

    const doneRoot = await manager.completeTaskNode(goal.id, "node_root", {
      summary: "Done",
      artifacts: ["artifacts/root.txt"],
    });
    expect(doneRoot.node.status).toBe("done");
    expect(doneRoot.node.artifacts).toContain("artifacts/root.txt");

    const claimedChild = await manager.claimTaskNode(goal.id, "node_child");
    expect(claimedChild.node.status).toBe("in_progress");

    const blockedChild = await manager.blockTaskNode(goal.id, "node_child", {
      blockReason: "Need review",
    });
    expect(blockedChild.node.status).toBe("blocked");
    expect(blockedChild.goal.status).toBe("blocked");

    const updatedChild = await manager.updateTaskNode(goal.id, "node_child", {
      acceptance: ["Review accepted"],
      artifacts: ["artifacts/child.txt"],
    });
    expect(updatedChild.node.acceptance).toContain("Review accepted");
    expect(updatedChild.node.artifacts).toContain("artifacts/child.txt");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("task_node_created");
    expect(progress).toContain("task_node_completed");
    expect(progress).toContain("task_node_blocked");
  });

  it("serializes concurrent mutations for the same goal without losing graph updates", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Concurrent Goal",
      objective: "Protect task graph updates",
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        manager.createTaskNode(goal.id, {
          id: `node_${index}`,
          title: `Node ${index}`,
          status: "ready",
        })),
    );

    const graphAfterCreate = await manager.readTaskGraph(goal.id);
    expect(graphAfterCreate.nodes).toHaveLength(8);
    expect(new Set(graphAfterCreate.nodes.map((item) => item.id)).size).toBe(8);

    await Promise.all([
      manager.updateTaskNode(goal.id, "node_0", { acceptance: ["acceptance-0"] }),
      manager.updateTaskNode(goal.id, "node_1", { artifacts: ["artifacts/node-1.md"] }),
      manager.createTaskNode(goal.id, {
        id: "node_8",
        title: "Node 8",
        status: "ready",
      }),
    ]);

    const graphAfterMixedWrites = await manager.readTaskGraph(goal.id);
    expect(graphAfterMixedWrites.nodes).toHaveLength(9);
    expect(graphAfterMixedWrites.nodes.find((item) => item.id === "node_0")?.acceptance).toContain("acceptance-0");
    expect(graphAfterMixedWrites.nodes.find((item) => item.id === "node_1")?.artifacts).toContain("artifacts/node-1.md");
    expect(graphAfterMixedWrites.nodes.some((item) => item.id === "node_8")).toBe(true);
  });

  it("supports checkpoint request, approve and reject with progress tracking", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Checkpoint Goal",
      objective: "Checkpoint flow",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_checkpoint",
      title: "Checkpoint Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_checkpoint", { runId: "run_cp_1" });

    const requested = await manager.requestCheckpoint(goal.id, "node_checkpoint", {
      title: "Need approval",
      summary: "Ready for review",
      note: "Please verify output",
      reviewer: "producer",
      reviewerRole: "产品验收",
      requestedBy: "main-agent",
      slaAt: "2026-03-21T12:00:00.000Z",
      runId: "run_cp_1",
    });
    expect(requested.goal.status).toBe("pending_approval");
    expect(requested.node.status).toBe("pending_review");
    expect(requested.node.checkpointStatus).toBe("waiting_user");
    expect(requested.checkpoint.status).toBe("waiting_user");
    expect(requested.checkpoint.reviewer).toBe("producer");
    expect(requested.checkpoint.requestedBy).toBe("main-agent");
    expect(requested.checkpoint.slaAt).toBe("2026-03-21T12:00:00.000Z");
    expect(requested.checkpoint.history[0]?.actor).toBe("main-agent");

    const listed = await manager.listCheckpoints(goal.id);
    expect(listed.items).toHaveLength(1);

    const approved = await manager.approveCheckpoint(goal.id, "node_checkpoint", {
      summary: "Approved",
      note: "Looks good",
      decidedBy: "designer",
      runId: "run_cp_1",
    });
    expect(approved.goal.status).toBe("reviewing");
    expect(approved.node.status).toBe("validating");
    expect(approved.node.checkpointStatus).toBe("approved");
    expect(approved.checkpoint.status).toBe("approved");
    expect(approved.checkpoint.decidedBy).toBe("designer");
    expect(approved.checkpoint.history[approved.checkpoint.history.length - 1]?.actor).toBe("designer");

    const done = await manager.completeTaskNode(goal.id, "node_checkpoint", {
      summary: "Validated and complete",
      runId: "run_cp_1",
    });
    expect(done.node.status).toBe("done");

    await manager.createTaskNode(goal.id, {
      id: "node_checkpoint_reject",
      title: "Reject Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_checkpoint_reject", { runId: "run_cp_2" });
    await manager.requestCheckpoint(goal.id, "node_checkpoint_reject", {
      title: "Need second approval",
      runId: "run_cp_2",
    });
    const rejected = await manager.rejectCheckpoint(goal.id, "node_checkpoint_reject", {
      summary: "Rejected",
      note: "Missing artifact",
      runId: "run_cp_2",
    });
    expect(rejected.goal.status).toBe("blocked");
    expect(rejected.node.status).toBe("blocked");
    expect(rejected.node.checkpointStatus).toBe("rejected");
    expect(rejected.checkpoint.status).toBe("rejected");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("checkpoint_requested");
    expect(progress).toContain("checkpoint_approved");
    expect(progress).toContain("checkpoint_rejected");
  });

  it("aligns checkpoint enforcement with capability risk policy", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Risk Policy Goal",
      objective: "Enforce risk checkpoint policy",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_risk",
      title: "Deploy Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_risk", { runId: "run_risk_1" });
    await manager.saveCapabilityPlan(goal.id, "node_risk", {
      executionMode: "single_agent",
      riskLevel: "high",
      objective: "Deploy Node with risk guard",
      summary: "Need strict checkpoint",
      checkpoint: {
        required: true,
        reasons: ["涉及部署/上线/发布。"],
        approvalMode: "strict",
        requiredRequestFields: ["reviewerRole", "slaAt", "note"],
        requiredDecisionFields: ["summary", "note", "decidedBy"],
        suggestedTitle: "High-risk execution checkpoint",
        suggestedReviewerRole: "producer",
        suggestedSlaHours: 12,
        escalationMode: "manual",
      },
    });

    await expect(manager.requestCheckpoint(goal.id, "node_risk", {
      summary: "Ready for review",
      runId: "run_risk_1",
    })).rejects.toThrow(/requires request fields/i);

    const requested = await manager.requestCheckpoint(goal.id, "node_risk", {
      title: "High-risk execution checkpoint",
      summary: "Ready for review",
      note: "Rollback plan prepared",
      reviewer: "producer-user",
      reviewerRole: "producer",
      requestedBy: "main-agent",
      slaAt: "2026-03-21T12:00:00.000Z",
      runId: "run_risk_1",
    });
    expect(requested.checkpoint.policy?.approvalMode).toBe("strict");
    expect(requested.checkpoint.policy?.requiredDecisionFields).toContain("decidedBy");

    await expect(manager.approveCheckpoint(goal.id, "node_risk", {
      summary: "Approved",
      note: "Proceed",
      runId: "run_risk_1",
    })).rejects.toThrow(/requires approve fields: decidedBy/i);

    const approved = await manager.approveCheckpoint(goal.id, "node_risk", {
      summary: "Approved",
      note: "Proceed",
      decidedBy: "producer-user",
      runId: "run_risk_1",
    });
    expect(approved.checkpoint.status).toBe("approved");
    expect(approved.checkpoint.decidedBy).toBe("producer-user");
  });

  it("supports dedicated pending_review / validating / failed / skipped transitions", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Transition Goal",
      objective: "Dedicated status tools",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_transition",
      title: "Transition Node",
      status: "ready",
    });

    await manager.claimTaskNode(goal.id, "node_transition", { runId: "run_t1" });
    const pendingReview = await manager.markTaskNodePendingReview(goal.id, "node_transition", {
      summary: "Need review",
      runId: "run_t1",
    });
    expect(pendingReview.node.status).toBe("pending_review");

    const validating = await manager.markTaskNodeValidating(goal.id, "node_transition", {
      summary: "Validation running",
      runId: "run_t1",
    });
    expect(validating.node.status).toBe("validating");

    const failed = await manager.failTaskNode(goal.id, "node_transition", {
      summary: "Validation failed",
      blockReason: "Tests red",
      runId: "run_t1",
    });
    expect(failed.node.status).toBe("failed");
    expect(failed.goal.status).toBe("blocked");

    const skipped = await manager.skipTaskNode(goal.id, "node_transition", {
      summary: "Skip after failure",
      runId: "run_t1",
    });
    expect(skipped.node.status).toBe("skipped");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("task_node_pending_review");
    expect(progress).toContain("task_node_validating");
    expect(progress).toContain("task_node_failed");
    expect(progress).toContain("task_node_skipped");
  });

  it("supports checkpoint expire and reopen with history", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Checkpoint History Goal",
      objective: "Expire reopen history",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_checkpoint_history",
      title: "Checkpoint History Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_checkpoint_history", { runId: "run_hist_1" });
    const requested = await manager.requestCheckpoint(goal.id, "node_checkpoint_history", {
      title: "Approval timeout",
      summary: "Wait review",
      reviewer: "qa",
      requestedBy: "worker-1",
      slaAt: "2026-03-22T09:30:00.000Z",
      runId: "run_hist_1",
    });
    const expired = await manager.expireCheckpoint(goal.id, "node_checkpoint_history", {
      checkpointId: requested.checkpoint.id,
      note: "Timeout",
      decidedBy: "scheduler",
      runId: "run_hist_1",
    });
    expect(expired.checkpoint.status).toBe("expired");
    expect(expired.node.checkpointStatus).toBe("expired");
    expect(expired.checkpoint.decidedBy).toBe("scheduler");

    const reopened = await manager.reopenCheckpoint(goal.id, "node_checkpoint_history", {
      checkpointId: requested.checkpoint.id,
      note: "Retry review",
      reviewer: "lead",
      requestedBy: "main-agent",
      slaAt: "2026-03-23T08:00:00.000Z",
      runId: "run_hist_2",
    });
    expect(reopened.checkpoint.status).toBe("waiting_user");
    expect(reopened.node.status).toBe("pending_review");
    expect(reopened.checkpoint.history.map((item) => item.action)).toEqual(["requested", "expired", "reopened"]);
    expect(reopened.checkpoint.reviewer).toBe("lead");
    expect(reopened.checkpoint.requestedBy).toBe("main-agent");
    expect(reopened.checkpoint.decidedBy).toBeUndefined();
    expect(reopened.checkpoint.slaAt).toBe("2026-03-23T08:00:00.000Z");
    expect(reopened.checkpoint.history[reopened.checkpoint.history.length - 1]?.actor).toBe("main-agent");

    const checkpoints = await manager.listCheckpoints(goal.id);
    expect(checkpoints.items[0].history).toHaveLength(3);

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("checkpoint_expired");
    expect(progress).toContain("checkpoint_reopened");
  });

  it("auto refreshes handoff on key task and checkpoint transitions", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Auto Handoff Goal",
      objective: "Auto refresh handoff",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_auto",
      title: "Auto Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_auto", {
      runId: "run_auto_1",
      summary: "Started auto node",
    });

    let handoff = await fs.readFile(goal.handoffPath, "utf-8");
    expect(handoff).toContain("Resume Mode: current_node");
    expect(handoff).toContain("Resume Node: node_auto");

    const requested = await manager.requestCheckpoint(goal.id, "node_auto", {
      title: "Auto checkpoint",
      summary: "Need approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_auto_1",
    });

    handoff = await fs.readFile(goal.handoffPath, "utf-8");
    expect(handoff).toContain("Resume Mode: checkpoint");
    expect(handoff).toContain(requested.checkpoint.id);
    expect(handoff).toContain("Auto checkpoint");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).not.toContain("handoff_generated");
  });

  it("emits goal update events for key transitions", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const events: Array<{ reason: string; areas: string[]; goalId: string; nodeId?: string }> = [];
    manager.setEventSink((event) => {
      events.push({
        reason: event.reason,
        areas: [...event.areas],
        goalId: event.goal.id,
        nodeId: event.nodeId,
      });
    });
    const goal = await manager.createGoal({
      title: "Goal Event Goal",
      objective: "Emit update events",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_event",
      title: "Event Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_event", { runId: "run_event_1" });
    await manager.requestCheckpoint(goal.id, "node_event", {
      title: "Event checkpoint",
      summary: "Need review",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_event_1",
    });

    expect(events.some((item) => item.reason === "task_node_created" && item.goalId === goal.id && item.nodeId === "node_event")).toBe(true);
    expect(events.some((item) => item.reason === "task_node_claimed" && item.goalId === goal.id && item.nodeId === "node_event")).toBe(true);
    expect(events.some((item) => item.reason === "checkpoint_requested" && item.goalId === goal.id && item.nodeId === "node_event")).toBe(true);
    expect(events.every((item) => item.areas.includes("handoff"))).toBe(true);
    expect(events.some((item) => item.areas.includes("tracking") && item.areas.includes("progress"))).toBe(true);
    expect(events.find((item) => item.reason === "checkpoint_requested")?.areas).toEqual(getGoalUpdateAreas("checkpoint_requested"));
  });

  it("persists capability plans and orchestration state", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Capability Goal",
      objective: "Plan before execute",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_plan",
      title: "Plan Node",
      status: "ready",
    });

    const planned = await manager.saveCapabilityPlan(goal.id, "node_plan", {
      executionMode: "multi_agent",
      governanceMode: "commander",
      commanderAgentId: "commander-main",
      preferredAgents: ["commander-main", "coder"],
      objective: "Plan Node capability plan",
      summary: "Need methods and sub-agents",
      queryHints: ["Plan Node", "orchestrate"],
      reasoning: ["Need explicit planning before claim"],
      methods: [{ file: "Refactor-Plan.md", title: "Refactor Plan", score: 20 }],
      skills: [{ name: "find-skills", score: 10 }],
      mcpServers: [{ serverId: "docs", status: "connected", toolCount: 4 }],
      subAgents: [{ agentId: "coder", role: "coder", objective: "Implement changes", deliverable: "code patch", handoffToVerifier: true }],
      gaps: ["Need more domain skills"],
    });
    expect(planned.status).toBe("planned");
    expect(planned.executionMode).toBe("multi_agent");
    expect(planned.governanceMode).toBe("commander");
    expect(planned.commanderAgentId).toBe("commander-main");
    expect(planned.analysis.status).toBe("pending");

    const commanderPlanPath = path.join(goal.runtimeRoot, "runs", "node-node_plan", "commander-plan.md");
    const workOrderPath = path.join(goal.runtimeRoot, "runs", "node-node_plan", "work-order", "coder.md");
    expect(await fs.readFile(commanderPlanPath, "utf-8")).toContain("Commander Agent: commander-main");
    expect(await fs.readFile(workOrderPath, "utf-8")).toContain("Agent ID: coder");

    const fetched = await manager.getCapabilityPlan(goal.id, "node_plan");
    expect(fetched?.id).toBe(planned.id);
    expect(fetched?.methods).toHaveLength(1);

    const orchestrated = await manager.saveCapabilityPlan(goal.id, "node_plan", {
      id: planned.id,
      executionMode: planned.executionMode,
      governanceMode: planned.governanceMode,
      commanderAgentId: planned.commanderAgentId,
      preferredAgents: planned.preferredAgents,
      objective: planned.objective,
      summary: planned.summary,
      queryHints: planned.queryHints,
      reasoning: planned.reasoning,
      methods: planned.methods,
      skills: planned.skills,
      mcpServers: planned.mcpServers,
      subAgents: planned.subAgents,
      gaps: planned.gaps,
      status: "orchestrated",
      actualUsage: {
        methods: ["Refactor-Plan.md", "Hotfix-Plan.md"],
        skills: ["find-skills"],
        mcpServers: ["docs", "canvas"],
        toolNames: ["mcp_docs_search", "mcp_canvas_open"],
        updatedAt: "2026-03-20T09:59:59.000Z",
      },
      orchestratedAt: "2026-03-20T10:00:00.000Z",
      orchestration: {
        claimed: true,
        delegated: false,
        delegationCount: 0,
        coordinationPlan: {
          summary: "按 1 路分工推进，并以 verifier_handoff 收口。",
          plannedDelegationCount: 1,
          rolePolicy: {
            selectedRoles: ["coder"],
            selectionReasons: ["测试：按 coder 主实现再收口。"],
            verifierRole: "verifier",
            fanInStrategy: "verifier_handoff",
          },
        },
        delegationResults: [{
          agentId: "coder",
          role: "coder",
          status: "skipped",
          summary: "测试中未实际委托。",
        }],
        verifierHandoff: {
          status: "pending",
          verifierRole: "verifier",
          summary: "等待主 Agent 汇总后交给 verifier。",
          sourceAgentIds: ["coder"],
          notes: ["测试记录"],
        },
        notes: ["delegated coder"],
      },
    });
    expect(orchestrated.status).toBe("orchestrated");
    expect(orchestrated.orchestration?.delegated).toBe(false);
    expect(orchestrated.orchestration?.coordinationPlan?.rolePolicy.fanInStrategy).toBe("verifier_handoff");
    expect(orchestrated.orchestration?.verifierHandoff?.status).toBe("pending");
    expect(orchestrated.orchestration?.acceptanceGate?.status).toBe("pending");
    expect(orchestrated.analysis.status).toBe("diverged");
    expect(orchestrated.analysis.deviations.some((item) => item.kind === "unplanned_but_used" && item.area === "method")).toBe(true);
    expect(orchestrated.analysis.deviations.some((item) => item.kind === "delegation_gap")).toBe(true);
    expect(orchestrated.analysis.recommendations.length).toBeGreaterThan(0);

    const listed = await manager.listCapabilityPlans(goal.id);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.analysis.status).toBe("diverged");

    const orchestratedCommanderPlanPath = path.join(goal.runtimeRoot, "runs", "node-node_plan", "commander-plan.md");
    expect(await fs.readFile(orchestratedCommanderPlanPath, "utf-8")).toContain("Plan ID:");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("capability_plan_generated");
    expect(progress).toContain("node_orchestrated");
  });

  it("persists verifier fan-in acceptance gate results on capability plans", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Verifier Gate Goal",
      objective: "Persist verifier gate state",
    });
    await manager.createTaskNode(goal.id, {
      id: "node_verify",
      title: "Verify fan-in",
      status: "ready",
    });

    const saved = await manager.saveCapabilityPlan(goal.id, "node_verify", {
      executionMode: "multi_agent",
      objective: "Verify fan-in",
      summary: "Need verifier to approve fan-in",
      status: "orchestrated",
      subAgents: [{ agentId: "coder", role: "coder", objective: "Ship patch", handoffToVerifier: true }],
      orchestration: {
        delegated: true,
        delegationCount: 1,
        coordinationPlan: {
          summary: "Fan in through verifier.",
          plannedDelegationCount: 1,
          rolePolicy: {
            selectedRoles: ["coder", "verifier"],
            selectionReasons: ["need verification"],
            verifierRole: "verifier",
            fanInStrategy: "verifier_handoff",
          },
        },
        delegationResults: [{
          agentId: "coder",
          role: "coder",
          status: "success",
          summary: "Patch delivered",
          taskId: "task_coder",
        }],
        verifierHandoff: {
          status: "completed",
          verifierRole: "verifier",
          verifierAgentId: "verifier",
          verifierTaskId: "task_verifier",
          summary: "Verifier reviewed coder output.",
          sourceAgentIds: ["coder"],
          sourceTaskIds: ["task_coder"],
        },
        verifierResult: {
          status: "completed",
          summary: "Verifier checks passed.",
          findings: [],
          recommendation: "approve",
          evidenceTaskIds: ["task_coder"],
          generatedAt: "2026-04-18T10:00:00.000Z",
        },
      },
    });

    expect(saved.orchestration?.acceptanceGate).toMatchObject({
      status: "accepted",
      requiredSourceTaskIds: ["task_coder"],
      requiredEvidenceTaskIds: ["task_coder"],
    });

    const fetched = await manager.getCapabilityPlan(goal.id, "node_verify");
    expect(fetched?.orchestration?.acceptanceGate).toMatchObject({
      status: "accepted",
      requiredSourceTaskIds: ["task_coder"],
      requiredEvidenceTaskIds: ["task_coder"],
    });
  });

  it("writes commander review fan-in artifact for commander-governed plans", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Commander Review Goal",
      objective: "Persist commander review artifact",
    });
    await manager.createTaskNode(goal.id, {
      id: "node_commander",
      title: "Commander fan-in",
      status: "ready",
    });

    const saved = await manager.saveCapabilityPlan(goal.id, "node_commander", {
      executionMode: "multi_agent_parallel",
      governanceMode: "commander",
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder"],
      objective: "Commander fan-in",
      summary: "Need commander review to close the loop",
      status: "orchestrated",
      subAgents: [{ agentId: "coder", role: "coder", objective: "Ship patch" }],
      orchestration: {
        finalApprovalMode: "user_required",
        reworkRevisionCount: 2,
        lastReworkReason: "Need regression evidence before close",
        lastReworkAt: "2026-03-20T09:30:00.000Z",
        reworkTargetAgentIds: ["coder"],
        delegated: true,
        delegationCount: 1,
        coordinationPlan: {
          summary: "Commander reviews child lanes.",
          plannedDelegationCount: 1,
          managerAgentId: "commander",
          rolePolicy: {
            selectedRoles: ["coder"],
            selectionReasons: ["commander mode"],
            fanInStrategy: "commander_review",
          },
        },
        delegationResults: [{
          agentId: "coder",
          role: "coder",
          status: "success",
          summary: "Patch delivered",
          taskId: "task_coder",
        }],
      },
    });

    expect(saved.orchestration?.acceptanceGate?.status).toBe("accepted");
    const commanderReviewPath = path.join(goal.runtimeRoot, "runs", "node-node_commander", "review-results", "review-node-commander.md");
    const reviewContent = await fs.readFile(commanderReviewPath, "utf-8");
    expect(reviewContent).toContain("Review Status: accepted");
    expect(reviewContent).toContain("Final Approval Default: user_required");
    expect(reviewContent).toContain("Rework Revision Count: 2");
    expect(reviewContent).toContain("Rework Targets: coder");
    expect(reviewContent).toContain("Need regression evidence before close");
    expect(reviewContent).toContain("Commander review fan-in is complete");
    expect(reviewContent).toContain("task_coder");
    const commanderPlanPath = path.join(goal.runtimeRoot, "runs", "node-node_commander", "commander-plan.md");
    const commanderPlanContent = await fs.readFile(commanderPlanPath, "utf-8");
    expect(commanderPlanContent).toContain("Final Approval Default: user_required");
    expect(commanderPlanContent).toContain("Rework Revision Count: 2");
    expect(commanderPlanContent).toContain("Rework Targets: coder");
    const workOrderPath = path.join(goal.runtimeRoot, "runs", "node-node_commander", "work-order", "coder.md");
    const workOrderContent = await fs.readFile(workOrderPath, "utf-8");
    expect(workOrderContent).toContain("## Rework Context");
    expect(workOrderContent).toContain("Need regression evidence before close");
    expect(workOrderContent).toContain("Rework Targets: coder");
  });

  it("reissues only failed lane work-orders during commander rework", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Commander Rework Goal",
      objective: "Reissue failed lane only",
    });
    await manager.createTaskNode(goal.id, {
      id: "node_rework",
      title: "Commander rework",
      status: "ready",
    });

    await manager.saveCapabilityPlan(goal.id, "node_rework", {
      runId: "run_rework_1",
      executionMode: "multi_agent_parallel",
      governanceMode: "commander",
      commanderAgentId: "commander",
      preferredAgents: ["commander", "coder", "reviewer"],
      objective: "Commander rework",
      summary: "Need reissue after lane failure",
      status: "orchestrated",
      subAgents: [
        { agentId: "coder", role: "coder", objective: "Ship patch" },
        { agentId: "reviewer", role: "verifier", objective: "Review patch" },
      ],
      orchestration: {
        finalApprovalMode: "user_required",
        reworkRevisionCount: 2,
        lastReworkReason: "Lane reviewer failed validation",
        lastReworkAt: "2026-03-21T09:00:00.000Z",
        reworkTargetAgentIds: ["reviewer"],
        delegated: true,
        delegationCount: 2,
        coordinationPlan: {
          summary: "Commander retries only failed lanes.",
          plannedDelegationCount: 2,
          managerAgentId: "commander",
          rolePolicy: {
            selectedRoles: ["coder", "verifier"],
            selectionReasons: ["commander mode"],
            fanInStrategy: "commander_review",
          },
        },
        delegationResults: [
          { agentId: "coder", role: "coder", status: "success", summary: "Patch delivered", taskId: "task_coder" },
          { agentId: "reviewer", role: "verifier", status: "failed", summary: "Review failed", taskId: "task_reviewer" },
        ],
      },
    });

    const reviewerWorkOrderPath = path.join(goal.runtimeRoot, "runs", "run-rework-1", "work-order", "reviewer.md");
    const coderWorkOrderPath = path.join(goal.runtimeRoot, "runs", "run-rework-1", "work-order", "coder.md");
    expect(await fs.readFile(reviewerWorkOrderPath, "utf-8")).toContain("Lane reviewer failed validation");
    expect(await fs.readFile(reviewerWorkOrderPath, "utf-8")).toContain("Rework Targets: reviewer");
    await expect(fs.access(coderWorkOrderPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("generates handoff markdown from current goal runtime", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Handoff Goal",
      objective: "Recover after interruption",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_impl",
      title: "Implement feature",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_impl", {
      runId: "run_handoff_1",
      summary: "Implementation started",
    });
    await manager.requestCheckpoint(goal.id, "node_impl", {
      title: "Need producer review",
      summary: "Waiting for review",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_handoff_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_impl", {
      executionMode: "single_agent",
      riskLevel: "medium",
      objective: "Implement feature safely",
      summary: "Need review before completion",
    });

    const result = await manager.generateHandoff(goal.id);
    expect(result.handoff.goalId).toBe(goal.id);
    expect(result.handoff.resumeMode).toBe("checkpoint");
    expect(result.handoff.openCheckpoints).toHaveLength(1);
    expect(result.handoff.recommendedNodeId).toBe("node_impl");
    expect(result.handoff.checkpointReplay).toMatchObject({
      checkpointId: expect.any(String),
      nodeId: "node_impl",
      title: "Need producer review",
    });
    expect(result.handoff.focusCapability?.nodeId).toBe("node_impl");
    expect(result.continuationState).toMatchObject({
      version: 1,
      scope: "goal",
      targetId: goal.id,
      recommendedTargetId: "node_impl",
      targetType: "node",
      resumeMode: "checkpoint",
      replay: {
        kind: "goal_checkpoint",
        checkpointId: expect.any(String),
        nodeId: "node_impl",
      },
      checkpoints: {
        openCount: 1,
        blockerCount: 1,
      },
      progress: {
        current: "aligning",
      },
    });

    const handoffContent = await fs.readFile(goal.handoffPath, "utf-8");
    expect(handoffContent).toContain("# handoff");
    expect(handoffContent).toContain("## Summary");
    expect(handoffContent).toContain("Need producer review");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("handoff_generated");
  });

  it("reads handoff snapshot without mutating handoff artifacts or progress", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Handoff Read Goal",
      objective: "Inspect continuation without side effects",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_review",
      title: "Review implementation",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_review", {
      runId: "run_handoff_read_1",
      summary: "Review started",
    });
    await manager.requestCheckpoint(goal.id, "node_review", {
      title: "Need reviewer approval",
      summary: "Waiting for sign-off",
      reviewer: "reviewer",
      requestedBy: "main-agent",
      runId: "run_handoff_read_1",
    });

    const handoffBefore = await fs.readFile(goal.handoffPath, "utf-8");
    const progressBefore = await fs.readFile(goal.progressPath, "utf-8");

    const result = await manager.getHandoff(goal.id);
    expect(result.handoff.goalId).toBe(goal.id);
    expect(result.handoff.resumeMode).toBe("checkpoint");
    expect(result.handoff.checkpointReplay).toMatchObject({
      checkpointId: expect.any(String),
      nodeId: "node_review",
      title: "Need reviewer approval",
    });
    expect(result.continuationState).toMatchObject({
      version: 1,
      scope: "goal",
      targetId: goal.id,
      recommendedTargetId: "node_review",
      targetType: "node",
      resumeMode: "checkpoint",
      replay: {
        kind: "goal_checkpoint",
        checkpointId: expect.any(String),
        nodeId: "node_review",
      },
    });

    const handoffAfter = await fs.readFile(goal.handoffPath, "utf-8");
    const progressAfter = await fs.readFile(goal.progressPath, "utf-8");
    expect(handoffAfter).toBe(handoffBefore);
    expect(progressAfter).toBe(progressBefore);
    expect(progressAfter).not.toContain("handoff_generated");
  });

  it("injects bridge governance summary into handoff and continuation guidance", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
    const goal = await manager.createGoal({
      title: "Bridge Handoff Goal",
      objective: "Surface bridge recovery context in handoff",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_bridge_review",
      title: "Review bridge recovery",
      status: "ready",
      checkpointRequired: true,
    });
    const bridgeTask = await subTaskRuntimeStore.createBridgeSessionTask({
      parentConversationId: `goal:${goal.id}`,
      agentId: "agent_bridge",
      profileId: "bridge_profile",
      instruction: "Recover runtime-lost bridge session.",
      summary: "Recover runtime-lost bridge session.",
      bridgeSubtask: {
        kind: "review",
        targetId: "codex_session",
        action: "interactive",
        goalId: goal.id,
        goalNodeId: "node_bridge_review",
        summary: "Recover runtime-lost bridge session.",
      },
      bridgeSession: {
        targetId: "codex_session",
        action: "interactive",
        transport: "pty",
        cwd: stateDir,
        commandPreview: "codex --interactive",
        summary: "Recover runtime-lost bridge session.",
      },
    });
    await subTaskRuntimeStore.attachSession(bridgeTask.id, "bridge_session_runtime_lost");
    await subTaskRuntimeStore.completeTask(bridgeTask.id, {
      status: "error",
      error: "Bridge runtime was lost during startup recovery.",
      bridgeSessionRuntime: {
        state: "runtime-lost",
        closeReason: "runtime-lost",
        blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
        artifactPath: "artifacts/bridge-recovery.md",
        transcriptPath: "logs/bridge-recovery.jsonl",
      },
    });

    await manager.claimTaskNode(goal.id, "node_bridge_review", {
      runId: bridgeTask.id,
      summary: "Bridge review started",
    });
    await manager.requestCheckpoint(goal.id, "node_bridge_review", {
      title: "Need bridge recovery review",
      summary: "Waiting for reviewer sign-off",
      reviewer: "reviewer",
      requestedBy: "main-agent",
      runId: bridgeTask.id,
    });

    const result = await manager.generateHandoff(goal.id);
    expect(result.handoff.bridgeGovernance).toMatchObject({
      bridgeNodeCount: 1,
      runtimeLostCount: 1,
      blockedCount: 1,
      items: [
        expect.objectContaining({
          nodeId: "node_bridge_review",
          taskId: bridgeTask.id,
          runtimeState: "runtime-lost",
          closeReason: "runtime-lost",
          artifactPath: "artifacts/bridge-recovery.md",
          transcriptPath: "logs/bridge-recovery.jsonl",
        }),
      ],
    });
    expect(result.handoff.summary).toContain("关联 bridge 运行态已丢失");
    expect(result.handoff.nextAction).toContain("恢复前先查看关联 bridge 产物 / transcript");
    expect(result.handoff.openCheckpoints[0]?.summary).toContain("Bridge：bridge 运行态丢失");
    expect(result.handoff.checkpointReplay?.reason).toContain("Bridge：bridge 运行态丢失");
    expect(result.handoff.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bridge",
        nodeId: "node_bridge_review",
        status: "runtime-lost",
      }),
    ]));
    expect(result.continuationState).toMatchObject({
      summary: expect.stringContaining("bridge 运行态已丢失"),
      nextAction: expect.stringContaining("bridge 产物 / transcript"),
      checkpoints: {
        openCount: 1,
        blockerCount: expect.any(Number),
        labels: expect.arrayContaining([
          expect.stringContaining("Bridge session runtime lost during startup recovery"),
        ]),
      },
    });

    const handoffContent = await fs.readFile(goal.handoffPath, "utf-8");
    expect(handoffContent).toContain("## Bridge Governance");
    expect(handoffContent).toContain("artifacts/bridge-recovery.md");
    expect(handoffContent).toContain("logs/bridge-recovery.jsonl");
  });

  it("generates retrospective artifacts from current goal runtime", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Retrospective Goal",
      objective: "Review execution patterns",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_done",
      title: "Done Node",
      status: "ready",
    });
    await manager.claimTaskNode(goal.id, "node_done", {
      runId: "run_ret_1",
      summary: "Started implementation",
    });
    await manager.completeTaskNode(goal.id, "node_done", {
      summary: "Completed implementation",
      artifacts: ["artifacts/done.txt"],
      runId: "run_ret_1",
    });
    await manager.createTaskNode(goal.id, {
      id: "node_blocked",
      title: "Blocked Node",
      status: "ready",
      checkpointRequired: true,
    });
    await manager.claimTaskNode(goal.id, "node_blocked", { runId: "run_ret_2" });
    await manager.requestCheckpoint(goal.id, "node_blocked", {
      title: "Need review",
      summary: "Waiting for producer",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_ret_2",
    });
    await manager.saveCapabilityPlan(goal.id, "node_done", {
      executionMode: "single_agent",
      riskLevel: "medium",
      objective: "Complete Done Node",
      summary: "Reuse known method",
      methods: [{ file: "Refactor-Plan.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Refactor-Plan.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T10:00:00.000Z",
    });

    const result = await manager.generateRetrospective(goal.id);
    expect(result.retrospective.goalId).toBe(goal.id);
    expect(result.retrospective.taskSummary.completedNodes).toBe(1);
    expect(result.retrospective.checkpointSummary.waitingUserCount).toBe(1);
    expect(result.retrospective.capabilitySummary.orchestratedPlans).toBe(1);
    expect(result.retrospective.recommendations.length).toBeGreaterThan(0);
    expect(result.retrospective.markdownPath).toContain("06-retrospective.md");
    expect(result.retrospective.jsonPath).toContain("retrospective.json");

    const markdown = await fs.readFile(path.join(goal.docRoot, "06-retrospective.md"), "utf-8");
    expect(markdown).toContain("# 06-retrospective");
    expect(markdown).toContain("## Summary");

    const json = JSON.parse(await fs.readFile(path.join(goal.runtimeRoot, "retrospective.json"), "utf-8"));
    expect(json.goalId).toBe(goal.id);
    expect(json.capabilitySummary.uniqueMethods).toContain("Refactor-Plan.md");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("retrospective_generated");
  });

  it("generates method candidate suggestions from completed goal nodes", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Method Candidate Goal",
      objective: "Extract reusable execution pattern",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_method",
      title: "Finalize Delivery",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes", "Artifacts linked"],
    });
    await manager.claimTaskNode(goal.id, "node_method", {
      runId: "run_method_1",
      summary: "Started delivery task",
    });
    await manager.requestCheckpoint(goal.id, "node_method", {
      title: "Delivery review",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_method_1",
    });
    await manager.approveCheckpoint(goal.id, "node_method", {
      summary: "Approved",
      note: "Looks good",
      decidedBy: "producer",
      runId: "run_method_1",
    });
    await manager.completeTaskNode(goal.id, "node_method", {
      summary: "Delivery finalized",
      artifacts: ["artifacts/delivery.md"],
      runId: "run_method_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_method", {
      executionMode: "single_agent",
      riskLevel: "low",
      objective: "Finalize Delivery safely",
      summary: "Stable delivery flow",
      actualUsage: {
        methods: ["Release-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T12:00:00.000Z",
    });

    const result = await manager.generateMethodCandidates(goal.id);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.nodeId).toBe("node_method");
    expect(result.candidates[0]?.evidence.methodsUsed).toContain("Release-Checklist.md");
    expect(result.markdownPath).toContain("07-method-candidates.md");
    expect(result.jsonPath).toContain("method-candidates.json");

    const markdown = await fs.readFile(path.join(goal.docRoot, "07-method-candidates.md"), "utf-8");
    expect(markdown).toContain("# 07-method-candidates");
    expect(markdown).toContain("method_candidate_node_method");

    const json = JSON.parse(await fs.readFile(path.join(goal.runtimeRoot, "method-candidates.json"), "utf-8"));
    expect(json.items[0].nodeId).toBe("node_method");
    expect(json.items[0].draftContent).toContain("# Finalize Delivery 方法候选");
    expect(json.items[0].draftContent).toContain("## 0. 元信息");
    expect(json.items[0].draftContent).toContain("## 3. 执行步骤");
    expect(json.items[0].draftContent).toContain("method-synthesis.md");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("method_candidates_generated");
  });

  it("generates skill candidate suggestions from capability gaps", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Skill Candidate Goal",
      objective: "Extract reusable capability wrapper",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_skill",
      title: "Automate Review Flow",
      status: "ready",
    });
    await manager.saveCapabilityPlan(goal.id, "node_skill", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Automate review flow",
      summary: "Need automation wrapper",
      gaps: ["Need automation wrapper", "Need reusable review coordinator"],
      methods: [{ file: "Review-Checklist.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Review-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch", "browser_open"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T13:00:00.000Z",
    });

    const result = await manager.generateSkillCandidates(goal.id);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.nodeId).toBe("node_skill");
    expect(result.candidates[0]?.evidence.gaps).toContain("Need automation wrapper");
    expect(result.candidates[0]?.evidence.toolNamesUsed).toContain("browser_open");
    expect(result.markdownPath).toContain("08-skill-candidates.md");
    expect(result.jsonPath).toContain("skill-candidates.json");

    const markdown = await fs.readFile(path.join(goal.docRoot, "08-skill-candidates.md"), "utf-8");
    expect(markdown).toContain("# 08-skill-candidates");
    expect(markdown).toContain("skill_candidate_node_skill");

    const json = JSON.parse(await fs.readFile(path.join(goal.runtimeRoot, "skill-candidates.json"), "utf-8"));
    expect(json.items[0].nodeId).toBe("node_skill");
    expect(json.items[0].draftContent).toContain('name: "node-skill"');
    expect(json.items[0].draftContent).toContain("## 快速开始");
    expect(json.items[0].draftContent).toContain("## NEVER");
    expect(json.items[0].draftContent).toContain("skill-synthesis.md");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("skill_candidates_generated");
  });

  it("falls back to legacy draft structure when synthesis templates are unavailable", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const originalCwd = process.cwd();
    const isolatedCwd = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-no-template-"));
    process.chdir(isolatedCwd);
    try {
      const manager = new GoalManager(stateDir);
      const goal = await manager.createGoal({
        title: "Fallback Template Goal",
        objective: "Use fallback draft structure when templates are missing",
      });

      await manager.createTaskNode(goal.id, {
        id: "node_fallback",
        title: "Fallback Delivery",
        status: "ready",
        checkpointRequired: true,
        acceptance: ["Fallback regression passes"],
      });
      await manager.claimTaskNode(goal.id, "node_fallback", {
        runId: "run_fallback_1",
        summary: "Started fallback delivery",
      });
      await manager.requestCheckpoint(goal.id, "node_fallback", {
        title: "Fallback checkpoint",
        summary: "Fallback ready",
        reviewer: "producer",
        requestedBy: "main-agent",
        runId: "run_fallback_1",
      });
      await manager.approveCheckpoint(goal.id, "node_fallback", {
        summary: "Fallback approved",
        note: "Fallback looks good",
        decidedBy: "producer",
        runId: "run_fallback_1",
      });
      await manager.completeTaskNode(goal.id, "node_fallback", {
        summary: "Fallback delivery completed",
        runId: "run_fallback_1",
        artifacts: ["artifacts/fallback.md"],
      });
      await manager.saveCapabilityPlan(goal.id, "node_fallback", {
        executionMode: "single_agent",
        riskLevel: "low",
        objective: "Fallback delivery",
        summary: "Fallback summary",
        actualUsage: {
          methods: ["Fallback-Checklist.md"],
          skills: ["find-skills"],
          mcpServers: [],
          toolNames: ["file_read"],
        },
        status: "orchestrated",
        orchestratedAt: "2026-03-20T16:00:00.000Z",
      });

      const methodResult = await manager.generateMethodCandidates(goal.id);
      expect(methodResult.candidates[0]?.draftContent).toContain('status: "draft"');
      expect(methodResult.candidates[0]?.draftContent).toContain("## 建议步骤");

      await manager.saveCapabilityPlan(goal.id, "node_fallback", {
        executionMode: "multi_agent",
        riskLevel: "medium",
        objective: "Fallback skill flow",
        summary: "Fallback skill summary",
        gaps: ["Need fallback skill wrapper"],
        actualUsage: {
          methods: ["Fallback-Checklist.md"],
          skills: ["find-skills"],
          mcpServers: [],
          toolNames: ["file_read", "apply_patch"],
        },
        status: "orchestrated",
        orchestratedAt: "2026-03-20T16:30:00.000Z",
      });

      const skillResult = await manager.generateSkillCandidates(goal.id);
      expect(skillResult.candidates[0]?.draftContent).toContain('version: "0.1.0-draft"');
      expect(skillResult.candidates[0]?.draftContent).toContain("## 适用场景");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("generates flow pattern summaries from repeated node flows", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Flow Pattern Goal",
      objective: "Detect repeated node flow",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_a",
      title: "Node A",
      status: "ready",
    });
    await manager.claimTaskNode(goal.id, "node_a", { runId: "run_a" });
    await manager.completeTaskNode(goal.id, "node_a", {
      summary: "Done A",
      runId: "run_a",
    });
    await manager.saveCapabilityPlan(goal.id, "node_a", {
      executionMode: "single_agent",
      riskLevel: "low",
      objective: "Complete A",
      summary: "Stable A",
      actualUsage: {
        methods: ["Checklist-A.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T14:00:00.000Z",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_b",
      title: "Node B",
      status: "ready",
    });
    await manager.claimTaskNode(goal.id, "node_b", { runId: "run_b" });
    await manager.completeTaskNode(goal.id, "node_b", {
      summary: "Done B",
      runId: "run_b",
    });
    await manager.saveCapabilityPlan(goal.id, "node_b", {
      executionMode: "single_agent",
      riskLevel: "low",
      objective: "Complete B",
      summary: "Stable B",
      actualUsage: {
        methods: ["Checklist-A.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T14:05:00.000Z",
    });

    const result = await manager.generateFlowPatterns(goal.id);
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.patterns[0]?.count).toBeGreaterThanOrEqual(2);
    expect(result.patterns[0]?.action).toBe("promote_method");
    expect(result.patterns[0]?.eventSequence).toContain("task_node_claimed");
    expect(result.patterns[0]?.eventSequence).toContain("task_node_completed");
    expect(result.markdownPath).toContain("09-flow-patterns.md");
    expect(result.jsonPath).toContain("flow-patterns.json");

    const markdown = await fs.readFile(path.join(goal.docRoot, "09-flow-patterns.md"), "utf-8");
    expect(markdown).toContain("# 09-flow-patterns");
    expect(markdown).toContain("flow_pattern_1");

    const json = JSON.parse(await fs.readFile(path.join(goal.runtimeRoot, "flow-patterns.json"), "utf-8"));
    expect(json.items[0].count).toBeGreaterThanOrEqual(2);
    expect(json.items[0].action).toBe("promote_method");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("flow_patterns_generated");
  });

  it("aggregates retrospective, candidates, and flow summaries via experience suggest", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Experience Suggest Goal",
      objective: "Aggregate reusable experience outputs",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_experience",
      title: "Experience Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes"],
    });
    await manager.claimTaskNode(goal.id, "node_experience", { runId: "run_exp_1", summary: "Started node" });
    await manager.requestCheckpoint(goal.id, "node_experience", {
      title: "Experience review",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_exp_1",
    });
    await manager.approveCheckpoint(goal.id, "node_experience", {
      summary: "Approved",
      note: "Stable flow",
      decidedBy: "producer",
      runId: "run_exp_1",
    });
    await manager.completeTaskNode(goal.id, "node_experience", {
      summary: "Experience node completed",
      artifacts: ["artifacts/experience.md"],
      runId: "run_exp_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_experience", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Aggregate reusable suggestions",
      summary: "Need reusable automation wrapper",
      gaps: ["Need reusable automation wrapper"],
      methods: [{ file: "Review-Checklist.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Review-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T15:00:00.000Z",
    });

    const result = await manager.generateExperienceSuggestions(goal.id);
    expect(result.retrospective.goalId).toBe(goal.id);
    expect(result.methodCandidates.count).toBeGreaterThan(0);
    expect(result.skillCandidates.count).toBeGreaterThan(0);
    expect(result.summary).toContain("method=");
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.methodCandidates.markdownPath).toContain("07-method-candidates.md");
    expect(result.skillCandidates.markdownPath).toContain("08-skill-candidates.md");
    expect(result.flowPatterns.markdownPath).toContain("09-flow-patterns.md");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("experience_suggestions_generated");
    expect(progress).not.toContain("retrospective_generated");
  });

  it("syncs suggestion reviews and supports review decisions", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Suggestion Review Goal",
      objective: "Review goal suggestions",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_review",
      title: "Review Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes"],
    });
    await manager.claimTaskNode(goal.id, "node_review", { runId: "run_review_1", summary: "Started review node" });
    await manager.requestCheckpoint(goal.id, "node_review", {
      title: "Review checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_review_1",
    });
    await manager.approveCheckpoint(goal.id, "node_review", {
      summary: "Approved",
      note: "Looks stable",
      decidedBy: "producer",
      runId: "run_review_1",
    });
    await manager.completeTaskNode(goal.id, "node_review", {
      summary: "Review node completed",
      artifacts: ["artifacts/review.md"],
      runId: "run_review_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_review", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Generate reviewable suggestions",
      summary: "Need reusable coordination wrapper",
      gaps: ["Need reusable coordination wrapper"],
      methods: [{ file: "Review-Checklist.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Review-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T16:00:00.000Z",
    });

    await manager.generateMethodCandidates(goal.id);
    await manager.generateSkillCandidates(goal.id);
    await manager.generateFlowPatterns(goal.id);

    const reviews = await manager.listSuggestionReviews(goal.id);
    expect(reviews.items.length).toBeGreaterThanOrEqual(3);
    expect(reviews.items.some((item) => item.suggestionType === "method_candidate")).toBe(true);
    expect(reviews.items.some((item) => item.suggestionType === "skill_candidate")).toBe(true);
    expect(reviews.items.some((item) => item.suggestionType === "flow_pattern")).toBe(true);

    const decided = await manager.decideSuggestionReview(goal.id, {
      reviewId: reviews.items[0]?.id,
      decision: "accepted",
      reviewer: "producer",
      decidedBy: "producer",
      note: "Ready for publish later",
    });
    expect(decided.review.status).toBe("accepted");
    expect(decided.review.decidedBy).toBe("producer");

    const json = JSON.parse(await fs.readFile(path.join(goal.runtimeRoot, "suggestion-reviews.json"), "utf-8"));
    expect(json.items.length).toBeGreaterThanOrEqual(3);
    expect(json.items.some((item: { status: string }) => item.status === "accepted")).toBe(true);

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("suggestion_review_decided");
  });

  it("supports chain workflow on suggestion reviews", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Suggestion Review Chain Goal",
      objective: "Review chain workflow",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_review_chain",
      title: "Review Chain Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes"],
    });
    await manager.claimTaskNode(goal.id, "node_review_chain", { runId: "run_review_chain_1", summary: "Started review chain node" });
    await manager.requestCheckpoint(goal.id, "node_review_chain", {
      title: "Review chain checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_review_chain_1",
    });
    await manager.approveCheckpoint(goal.id, "node_review_chain", {
      summary: "Approved",
      note: "Looks stable",
      decidedBy: "producer",
      runId: "run_review_chain_1",
    });
    await manager.completeTaskNode(goal.id, "node_review_chain", {
      summary: "Review chain node completed",
      artifacts: ["artifacts/review-chain.md"],
      runId: "run_review_chain_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_review_chain", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Generate chain-review suggestions",
      summary: "Need reusable coordination wrapper",
      gaps: ["Need reusable coordination wrapper"],
      methods: [{ file: "Review-Checklist.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Review-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T16:10:00.000Z",
    });

    await manager.generateMethodCandidates(goal.id);
    const reviews = await manager.listSuggestionReviews(goal.id);
    const methodReview = reviews.items.find((item) => item.suggestionType === "method_candidate");
    expect(methodReview).toBeTruthy();

    const configured = await manager.configureSuggestionReviewWorkflow(goal.id, {
      reviewId: methodReview?.id,
      mode: "chain",
      reviewers: ["tech-lead", "producer"],
      escalationMode: "manual",
      note: "Chain review required",
    });
    expect(configured.review.workflow?.mode).toBe("chain");
    expect(configured.review.workflow?.stages).toHaveLength(2);
    expect(configured.review.reviewer).toBe("tech-lead");
    expect(configured.review.status).toBe("pending_review");

    const firstDecision = await manager.decideSuggestionReview(goal.id, {
      reviewId: methodReview?.id,
      decision: "accepted",
      reviewer: "tech-lead",
      decidedBy: "tech-lead",
      note: "Tech lead approved",
    });
    expect(firstDecision.review.status).toBe("pending_review");
    expect(firstDecision.review.workflow?.currentStageIndex).toBe(1);
    expect(firstDecision.review.reviewer).toBe("producer");

    const finalDecision = await manager.decideSuggestionReview(goal.id, {
      reviewId: methodReview?.id,
      decision: "accepted",
      reviewer: "producer",
      decidedBy: "producer",
      note: "Producer approved",
    });
    expect(finalDecision.review.status).toBe("accepted");
    expect(finalDecision.review.workflow?.status).toBe("accepted");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("suggestion_review_workflow_configured");
    expect(progress).toContain("suggestion_review_decided");
  });

  it("supports quorum workflow and manual escalation on suggestion reviews", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Suggestion Review Quorum Goal",
      objective: "Review quorum workflow",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_review_quorum",
      title: "Review Quorum Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes"],
    });
    await manager.claimTaskNode(goal.id, "node_review_quorum", { runId: "run_review_quorum_1", summary: "Started review quorum node" });
    await manager.requestCheckpoint(goal.id, "node_review_quorum", {
      title: "Review quorum checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_review_quorum_1",
    });
    await manager.approveCheckpoint(goal.id, "node_review_quorum", {
      summary: "Approved",
      note: "Looks stable",
      decidedBy: "producer",
      runId: "run_review_quorum_1",
    });
    await manager.completeTaskNode(goal.id, "node_review_quorum", {
      summary: "Review quorum node completed",
      artifacts: ["artifacts/review-quorum.md"],
      runId: "run_review_quorum_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_review_quorum", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Generate quorum-review suggestions",
      summary: "Need reusable coordination wrapper",
      gaps: ["Need reusable coordination wrapper"],
      methods: [{ file: "Review-Checklist.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Review-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T16:20:00.000Z",
    });

    await manager.generateSkillCandidates(goal.id);
    const reviews = await manager.listSuggestionReviews(goal.id);
    const skillReview = reviews.items.find((item) => item.suggestionType === "skill_candidate");
    expect(skillReview).toBeTruthy();

    const configured = await manager.configureSuggestionReviewWorkflow(goal.id, {
      reviewId: skillReview?.id,
      mode: "quorum",
      reviewers: ["tech-lead", "producer", "owner"],
      minApprovals: 2,
      escalationMode: "manual",
      note: "Quorum review required",
    });
    expect(configured.review.workflow?.mode).toBe("quorum");
    expect(configured.review.workflow?.stages[0]?.minApprovals).toBe(2);

    const escalated = await manager.escalateSuggestionReview(goal.id, {
      reviewId: skillReview?.id,
      escalatedBy: "producer",
      escalatedTo: "owner",
      reason: "Need owner visibility",
      force: true,
    });
    expect(escalated.review.status).toBe("pending_review");
    expect(escalated.review.workflow?.stages[0]?.escalation.count).toBe(1);
    expect(escalated.review.workflow?.stages[0]?.reviewers.some((item) => item.reviewer === "owner")).toBe(true);

    const firstVote = await manager.decideSuggestionReview(goal.id, {
      reviewId: skillReview?.id,
      decision: "accepted",
      reviewer: "tech-lead",
      decidedBy: "tech-lead",
      note: "Approve 1",
    });
    expect(firstVote.review.status).toBe("pending_review");

    const secondVote = await manager.decideSuggestionReview(goal.id, {
      reviewId: skillReview?.id,
      decision: "accepted",
      reviewer: "owner",
      decidedBy: "owner",
      note: "Approve 2",
    });
    expect(secondVote.review.status).toBe("accepted");
    expect(secondVote.review.workflow?.status).toBe("accepted");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("suggestion_review_escalated");
  });

  it("scans overdue suggestion review workflows and auto escalates configured reviewers", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Suggestion Review SLA Goal",
      objective: "Scan overdue review workflow",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_review_scan",
      title: "Review Scan Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes"],
    });
    await manager.claimTaskNode(goal.id, "node_review_scan", { runId: "run_review_scan_1", summary: "Started review scan node" });
    await manager.requestCheckpoint(goal.id, "node_review_scan", {
      title: "Review scan checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_review_scan_1",
    });
    await manager.approveCheckpoint(goal.id, "node_review_scan", {
      summary: "Approved",
      note: "Looks stable",
      decidedBy: "producer",
      runId: "run_review_scan_1",
    });
    await manager.completeTaskNode(goal.id, "node_review_scan", {
      summary: "Review scan node completed",
      artifacts: ["artifacts/review-scan.md"],
      runId: "run_review_scan_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_review_scan", {
      executionMode: "single_agent",
      riskLevel: "medium",
      objective: "Generate scan-review suggestions",
      summary: "Need SLA governance",
      actualUsage: {
        methods: ["Review-Checklist.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T16:25:00.000Z",
    });

    await manager.generateMethodCandidates(goal.id);
    const reviews = await manager.listSuggestionReviews(goal.id);
    const methodReview = reviews.items.find((item) => item.suggestionType === "method_candidate");
    expect(methodReview).toBeTruthy();

    const configured = await manager.configureSuggestionReviewWorkflow(goal.id, {
      reviewId: methodReview?.id,
      mode: "single",
      reviewers: ["tech-lead"],
      slaHours: 1,
      escalationMode: "manual",
      escalationReviewer: "owner",
      note: "SLA review required",
    });
    const slaAt = configured.review.workflow?.stages[0]?.slaAt;
    expect(slaAt).toBeTruthy();
    const scanTime = new Date(new Date(slaAt as string).getTime() + 5 * 60 * 1000).toISOString();

    const scanned = await manager.scanSuggestionReviewWorkflows(goal.id, {
      now: scanTime,
      autoEscalate: true,
    });
    expect(scanned.overdueCount).toBe(1);
    expect(scanned.escalatedCount).toBe(1);
    expect(scanned.items[0]?.action).toBe("auto_escalated");
    expect(scanned.items[0]?.escalatedTo).toBe("owner");
    expect(scanned.reviews.items.find((item) => item.id === methodReview?.id)?.reviewer).toBe("owner");
    expect(scanned.reviews.items.find((item) => item.id === methodReview?.id)?.workflow?.stages[0]?.escalation.count).toBe(1);
    expect(scanned.reviews.items.find((item) => item.id === methodReview?.id)?.workflow?.stages[0]?.escalation.overdueAt).toBe(scanTime);

    const rescanned = await manager.scanSuggestionReviewWorkflows(goal.id, {
      now: new Date(new Date(scanTime).getTime() + 5 * 60 * 1000).toISOString(),
      autoEscalate: true,
    });
    expect(rescanned.overdueCount).toBe(1);
    expect(rescanned.escalatedCount).toBe(0);
    expect(rescanned.items[0]?.action).toBe("overdue");

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("suggestion_review_scanned");
  });

  it("uses review scan learning runner to generate first suggestion batch when reviews are still empty", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Learning Review Scan Goal",
      objective: "Use review scan to backfill first suggestion batch",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_learning_scan",
      title: "Learning Scan Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Review runner can backfill suggestions"],
    });
    await manager.claimTaskNode(goal.id, "node_learning_scan", {
      runId: "run_learning_scan_1",
      summary: "Started learning scan node",
    });
    await manager.requestCheckpoint(goal.id, "node_learning_scan", {
      title: "Learning scan checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_learning_scan_1",
    });
    await manager.approveCheckpoint(goal.id, "node_learning_scan", {
      summary: "Approved",
      note: "Looks stable",
      decidedBy: "producer",
      runId: "run_learning_scan_1",
    });
    await manager.completeTaskNode(goal.id, "node_learning_scan", {
      summary: "Learning scan node completed",
      artifacts: ["artifacts/learning-scan.md"],
      runId: "run_learning_scan_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_learning_scan", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Backfill first suggestion batch from review scan",
      summary: "Need reusable learning review wrapper",
      gaps: ["Need reusable learning review wrapper"],
      methods: [{ file: "Learning-Review.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Learning-Review.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T17:00:00.000Z",
    });

    const beforeScan = await manager.listSuggestionReviews(goal.id);
    expect(beforeScan.items).toHaveLength(0);

    const scanned = await manager.scanSuggestionReviewWorkflows(goal.id, {});
    expect(scanned.learningReview?.generated).toBe(true);
    expect(scanned.learningReview?.suggestionCounts.method).toBeGreaterThan(0);
    expect(scanned.reviews.items.length).toBeGreaterThan(0);

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("experience_suggestions_generated");
  });

  it("skips unchanged refresh and reopens when new goal signals appear", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Learning Refresh Goal",
      objective: "Verify refresh fingerprint gate",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_refresh_1",
      title: "Refresh Node 1",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["First refresh signal exists"],
    });
    await manager.claimTaskNode(goal.id, "node_refresh_1", {
      runId: "run_refresh_1",
      summary: "Started refresh node 1",
    });
    await manager.requestCheckpoint(goal.id, "node_refresh_1", {
      title: "Refresh checkpoint 1",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_refresh_1",
    });
    await manager.approveCheckpoint(goal.id, "node_refresh_1", {
      summary: "Approved",
      note: "Looks stable",
      decidedBy: "producer",
      runId: "run_refresh_1",
    });
    await manager.completeTaskNode(goal.id, "node_refresh_1", {
      summary: "Refresh node 1 completed",
      artifacts: ["artifacts/refresh-1.md"],
      runId: "run_refresh_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_refresh_1", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Generate first refresh batch",
      summary: "Need first refresh wrapper",
      gaps: ["Need first refresh wrapper"],
      actualUsage: {
        methods: ["Refresh-Review.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T17:00:00.000Z",
    });

    const firstScan = await manager.scanSuggestionReviewWorkflows(goal.id, {});
    expect(firstScan.learningReview?.refreshed).toBe(true);
    expect(firstScan.learningReview?.generated).toBe(true);

    const reviews = await manager.listSuggestionReviews(goal.id);
    await writeGoalSuggestionReviews(goal, {
      version: 1,
      syncedAt: "2026-04-10T01:00:00.000Z",
      items: reviews.items.map((item) => ({
        ...item,
        status: "rejected",
        reviewer: item.reviewer ?? "producer",
        decidedBy: "producer",
        decidedAt: "2026-04-10T01:00:00.000Z",
        updatedAt: "2026-04-10T01:00:00.000Z",
      })),
    });

    const secondScan = await manager.scanSuggestionReviewWorkflows(goal.id, {});
    expect(secondScan.learningReview?.outcome).toBe("unchanged_signal");
    expect(secondScan.learningReview?.refreshed).toBe(false);

    await manager.createTaskNode(goal.id, {
      id: "node_refresh_2",
      title: "Refresh Node 2",
      status: "ready",
      checkpointRequired: false,
      acceptance: ["Second refresh signal exists"],
    });
    await manager.claimTaskNode(goal.id, "node_refresh_2", {
      runId: "run_refresh_2",
      summary: "Started refresh node 2",
    });
    await manager.completeTaskNode(goal.id, "node_refresh_2", {
      summary: "Refresh node 2 completed",
      artifacts: ["artifacts/refresh-2.md"],
      runId: "run_refresh_2",
    });

    const thirdScan = await manager.scanSuggestionReviewWorkflows(goal.id, {});
    expect(thirdScan.learningReview?.refreshed).toBe(true);
    expect(thirdScan.learningReview?.outcome).toBe("generated");

    const refreshState = await readGoalLearningReviewRefreshState(goal);
    expect(refreshState.lastOutcome).toBe("generated");
    expect(refreshState.lastRefreshFingerprint).toBeTruthy();
    expect(refreshState.lastScanFingerprint).toBeTruthy();

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    const matches = progress.match(/experience_suggestions_generated/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("materializes approval notifications into dispatch outbox channels without duplicate fanout", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    await fs.mkdir(path.join(stateDir, "governance"), { recursive: true });
    await fs.writeFile(getReviewGovernanceConfigPath(stateDir), JSON.stringify({
      version: 1,
      reviewers: [
        {
          id: "owner",
          name: "Owner",
          reviewerRole: "approver",
          channels: ["reviewer_inbox", "im_dm", "webhook"],
          active: true,
        },
      ],
      templates: [],
      defaults: {
        reminderMinutes: [60, 15],
        notificationChannels: ["goal_detail"],
        notificationRoutes: {
          im_dm: "im://review/{recipient}",
          webhook: "webhook://review/{recipient}",
          org_feed: "org://review-feed",
        },
      },
      updatedAt: "2026-03-21T00:00:00.000Z",
    }, null, 2), "utf-8");

    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Approval Dispatch Goal",
      objective: "Materialize approval dispatch channels",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_dispatch",
      title: "Dispatch Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Dispatch runtime exists"],
    });
    await manager.claimTaskNode(goal.id, "node_dispatch", { runId: "run_dispatch_1", summary: "Started dispatch node" });
    await manager.requestCheckpoint(goal.id, "node_dispatch", {
      title: "Dispatch checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_dispatch_1",
    });
    await manager.approveCheckpoint(goal.id, "node_dispatch", {
      summary: "Approved",
      note: "Proceed",
      decidedBy: "producer",
      runId: "run_dispatch_1",
    });
    await manager.completeTaskNode(goal.id, "node_dispatch", {
      summary: "Dispatch node completed",
      artifacts: ["artifacts/dispatch.md"],
      runId: "run_dispatch_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_dispatch", {
      executionMode: "single_agent",
      riskLevel: "medium",
      objective: "Generate dispatchable suggestion review",
      summary: "Need approval notification fanout",
      actualUsage: {
        methods: ["Dispatch-Checklist.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-21T01:00:00.000Z",
    });

    await manager.generateMethodCandidates(goal.id);
    const reviews = await manager.listSuggestionReviews(goal.id);
    const methodReview = reviews.items.find((item) => item.suggestionType === "method_candidate");
    expect(methodReview).toBeTruthy();

    const configured = await manager.configureSuggestionReviewWorkflow(goal.id, {
      reviewId: methodReview?.id,
      mode: "single",
      reviewers: ["tech-lead"],
      slaHours: 1,
      escalationMode: "manual",
      escalationReviewer: "owner",
      note: "Dispatch workflow",
    });
    const slaAt = configured.review.workflow?.stages[0]?.slaAt;
    expect(slaAt).toBeTruthy();
    const scanTime = new Date(new Date(slaAt as string).getTime() + 5 * 60 * 1000).toISOString();

    const scanned = await manager.scanApprovalWorkflows(goal.id, {
      now: scanTime,
      autoEscalate: true,
    });
    expect(scanned.notifications.map((item) => item.kind).sort()).toEqual(["auto_escalated", "sla_overdue"]);
    expect(scanned.dispatches.length).toBeGreaterThanOrEqual(6);
    expect(scanned.dispatches.some((item) => item.channel === "goal_detail" && item.status === "materialized")).toBe(true);
    expect(scanned.dispatches.some((item) => item.channel === "goal_channel" && item.status === "materialized")).toBe(true);
    expect(scanned.dispatches.some((item) => item.channel === "org_feed" && item.status === "materialized")).toBe(true);
    expect(scanned.dispatches.some((item) => item.channel === "reviewer_inbox" && item.recipient === "owner")).toBe(true);
    expect(scanned.dispatches.some((item) => item.channel === "im_dm" && item.status === "pending" && item.routeKey === "im://review/owner")).toBe(true);
    expect(scanned.dispatches.some((item) => item.channel === "webhook" && item.status === "pending" && item.routeKey === "webhook://review/owner")).toBe(true);
    expect(scanned.summary).toContain("dispatches=");

    const dispatchState = JSON.parse(await fs.readFile(path.join(goal.runtimeRoot, "review-notification-dispatches.json"), "utf-8")) as {
      items: Array<{ channel: string; status: string; notificationId: string }>;
    };
    expect(dispatchState.items).toHaveLength(scanned.dispatches.length);
    expect(dispatchState.items.every((item) => Boolean(item.notificationId))).toBe(true);

    const rescanned = await manager.scanApprovalWorkflows(goal.id, {
      now: new Date(new Date(scanTime).getTime() + 5 * 60 * 1000).toISOString(),
      autoEscalate: true,
    });
    expect(rescanned.notifications).toHaveLength(0);
    expect(rescanned.dispatches).toHaveLength(0);

    const summary = await manager.getReviewGovernanceSummary(goal.id);
    expect(summary.notificationDispatchesPath).toContain("review-notification-dispatches.json");
    expect(summary.notificationDispatchCounts.total).toBe(scanned.dispatches.length);
    expect(summary.notificationDispatchCounts.byChannel.goal_detail).toBeGreaterThanOrEqual(1);
    expect(summary.notificationDispatchCounts.byStatus.pending).toBeGreaterThanOrEqual(1);
    expect(summary.summary).toContain("dispatches=");
  });

  it("persists capped approval notification state changes even when item counts stay flat", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    await fs.mkdir(path.join(stateDir, "governance"), { recursive: true });
    await fs.writeFile(getReviewGovernanceConfigPath(stateDir), JSON.stringify({
      version: 1,
      reviewers: [],
      templates: [],
      defaults: {
        reminderMinutes: [60],
        notificationChannels: ["goal_detail"],
      },
      updatedAt: "2026-03-21T00:00:00.000Z",
    }, null, 2), "utf-8");

    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Approval Notification Cap Goal",
      objective: "Persist bounded notification state updates",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_cap",
      title: "Cap Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Checkpoint overdue state is persisted"],
    });
    await manager.claimTaskNode(goal.id, "node_cap", { runId: "run_cap_1", summary: "Started cap node" });
    const requested = await manager.requestCheckpoint(goal.id, "node_cap", {
      title: "Cap checkpoint",
      summary: "Ready for cap scan",
      reviewer: "producer",
      requestedBy: "main-agent",
      slaAt: "2026-03-21T01:00:00.000Z",
      runId: "run_cap_1",
    });

    const notificationsPath = getGoalReviewNotificationsPath(goal);
    const dispatchesPath = getGoalReviewNotificationDispatchesPath(goal);
    const seededNotifications = Array.from({ length: 200 }, (_, index) => {
      const createdAt = new Date(Date.UTC(2026, 2, 20, 0, index, 0)).toISOString();
      return {
        id: `review_notification_seed_${index}`,
        goalId: goal.id,
        targetType: "checkpoint" as const,
        targetId: `seed_target_${index}`,
        nodeId: "seed_node",
        stageId: "checkpoint",
        recipient: "seed-reviewer",
        kind: "sla_overdue" as const,
        message: `Seed notification ${index}`,
        dedupeKey: `checkpoint:seed_target_${index}:checkpoint:overdue`,
        createdAt,
      };
    });
    const seededDispatches = seededNotifications.flatMap((notification, index) => {
      const createdAt = notification.createdAt;
      return [
        {
          id: `review_dispatch_seed_${index}_detail`,
          notificationId: notification.id,
          goalId: goal.id,
          targetType: "checkpoint" as const,
          targetId: notification.targetId,
          nodeId: notification.nodeId,
          stageId: notification.stageId,
          kind: notification.kind,
          channel: "goal_detail" as const,
          routeKey: `goal:${goal.id}:detail`,
          message: notification.message,
          dedupeKey: `${notification.dedupeKey}:dispatch:goal_detail:goal:${goal.id}:detail`,
          status: "materialized" as const,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: `review_dispatch_seed_${index}_channel`,
          notificationId: notification.id,
          goalId: goal.id,
          targetType: "checkpoint" as const,
          targetId: notification.targetId,
          nodeId: notification.nodeId,
          stageId: notification.stageId,
          kind: notification.kind,
          channel: "goal_channel" as const,
          routeKey: `goal:${goal.id}:channel`,
          message: notification.message,
          dedupeKey: `${notification.dedupeKey}:dispatch:goal_channel:goal:${goal.id}:channel`,
          status: "materialized" as const,
          createdAt,
          updatedAt: createdAt,
        },
      ];
    });
    await fs.writeFile(notificationsPath, JSON.stringify({
      version: 1,
      items: seededNotifications,
    }, null, 2), "utf-8");
    await fs.writeFile(dispatchesPath, JSON.stringify({
      version: 1,
      items: seededDispatches,
    }, null, 2), "utf-8");

    const scanned = await manager.scanApprovalWorkflows(goal.id, {
      now: "2026-03-21T02:00:00.000Z",
      autoEscalate: false,
    });
    expect(scanned.notifications).toHaveLength(1);
    expect(scanned.dispatches).toHaveLength(2);

    const nextNotificationKey = `checkpoint:${requested.checkpoint.id}:checkpoint:overdue`;
    const persistedNotifications = JSON.parse(await fs.readFile(notificationsPath, "utf-8")) as {
      items: Array<{ dedupeKey: string }>;
    };
    expect(persistedNotifications.items).toHaveLength(200);
    expect(persistedNotifications.items.some((item) => item.dedupeKey === nextNotificationKey)).toBe(true);
    expect(persistedNotifications.items.some((item) => item.dedupeKey === seededNotifications[0]?.dedupeKey)).toBe(false);

    const persistedDispatches = JSON.parse(await fs.readFile(dispatchesPath, "utf-8")) as {
      items: Array<{ dedupeKey: string }>;
    };
    expect(persistedDispatches.items).toHaveLength(400);
    expect(persistedDispatches.items.some((item) => item.dedupeKey === `${nextNotificationKey}:dispatch:goal_detail:goal:${goal.id}:detail`)).toBe(true);
    expect(persistedDispatches.items.some((item) => item.dedupeKey === `${nextNotificationKey}:dispatch:goal_channel:goal:${goal.id}:channel`)).toBe(true);
    expect(persistedDispatches.items.some((item) => item.dedupeKey === seededDispatches[0]?.dedupeKey)).toBe(false);
  });

  it("rebuilds missing dispatch outbox entries from persisted notifications on the next scan", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    await fs.mkdir(path.join(stateDir, "governance"), { recursive: true });
    await fs.writeFile(getReviewGovernanceConfigPath(stateDir), JSON.stringify({
      version: 1,
      reviewers: [],
      templates: [],
      defaults: {
        reminderMinutes: [60],
        notificationChannels: ["goal_detail"],
      },
      updatedAt: "2026-03-21T00:00:00.000Z",
    }, null, 2), "utf-8");

    const manager = new GoalManager(stateDir);
    const goal = await manager.createGoal({
      title: "Approval Dispatch Recovery Goal",
      objective: "Recover dispatch outbox from persisted notifications",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_dispatch_recovery",
      title: "Dispatch Recovery Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Dispatch outbox can be rebuilt"],
    });
    await manager.claimTaskNode(goal.id, "node_dispatch_recovery", {
      runId: "run_dispatch_recovery_1",
      summary: "Started recovery node",
    });
    const requested = await manager.requestCheckpoint(goal.id, "node_dispatch_recovery", {
      title: "Recovery checkpoint",
      summary: "Ready for recovery scan",
      reviewer: "producer",
      requestedBy: "main-agent",
      slaAt: "2026-03-21T01:00:00.000Z",
      runId: "run_dispatch_recovery_1",
    });

    const notificationsPath = getGoalReviewNotificationsPath(goal);
    const dispatchesPath = getGoalReviewNotificationDispatchesPath(goal);
    const originalRename = fs.rename.bind(fs);
    let failedOnce = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (!failedOnce && target === dispatchesPath) {
        failedOnce = true;
        const error = new Error("dispatch write failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return originalRename(source, target);
    });

    try {
      await expect(manager.scanApprovalWorkflows(goal.id, {
        now: "2026-03-21T02:00:00.000Z",
        autoEscalate: false,
      })).rejects.toThrow("dispatch write failure");
    } finally {
      renameSpy.mockRestore();
    }

    const notificationKey = `checkpoint:${requested.checkpoint.id}:checkpoint:overdue`;
    const persistedNotifications = JSON.parse(await fs.readFile(notificationsPath, "utf-8")) as {
      items: Array<{ dedupeKey: string }>;
    };
    expect(persistedNotifications.items.some((item) => item.dedupeKey === notificationKey)).toBe(true);
    const initialDispatchState = JSON.parse(await fs.readFile(dispatchesPath, "utf-8")) as {
      items: Array<{ dedupeKey: string }>;
    };
    expect(initialDispatchState.items).toHaveLength(0);

    const rescanned = await manager.scanApprovalWorkflows(goal.id, {
      now: "2026-03-21T02:01:00.000Z",
      autoEscalate: false,
    });
    expect(rescanned.notifications).toHaveLength(0);
    expect(rescanned.dispatches).toHaveLength(2);

    const persistedDispatches = JSON.parse(await fs.readFile(dispatchesPath, "utf-8")) as {
      items: Array<{ dedupeKey: string }>;
    };
    expect(persistedDispatches.items.some((item) => item.dedupeKey === `${notificationKey}:dispatch:goal_detail:goal:${goal.id}:detail`)).toBe(true);
    expect(persistedDispatches.items.some((item) => item.dedupeKey === `${notificationKey}:dispatch:goal_channel:goal:${goal.id}:channel`)).toBe(true);
  });

  it("publishes accepted method and skill suggestions into formal asset directories", async () => {
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "test-placeholder-key";
    }
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const memoryWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-memory-"));
    const memoryManager = new MemoryManager({
      workspaceRoot: memoryWorkspace,
      stateDir,
      taskMemoryEnabled: false,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: false,
      experienceAutoSkillEnabled: false,
    });
    registerGlobalMemoryManager(memoryManager);
    const goal = await manager.createGoal({
      title: "Suggestion Publish Goal",
      objective: "Publish reviewed suggestions",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_publish",
      title: "Publish Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes"],
    });
    await manager.claimTaskNode(goal.id, "node_publish", { runId: "run_publish_1", summary: "Started publish node" });
    await manager.requestCheckpoint(goal.id, "node_publish", {
      title: "Publish checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_publish_1",
    });
    await manager.approveCheckpoint(goal.id, "node_publish", {
      summary: "Approved",
      note: "Stable enough",
      decidedBy: "producer",
      runId: "run_publish_1",
    });
    await manager.completeTaskNode(goal.id, "node_publish", {
      summary: "Publish node completed",
      artifacts: ["artifacts/publish.md"],
      runId: "run_publish_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_publish", {
      executionMode: "multi_agent",
      riskLevel: "medium",
      objective: "Generate publishable suggestions",
      summary: "Need reusable coordination wrapper",
      gaps: ["Need reusable coordination wrapper"],
      methods: [{ file: "Publish-Checklist.md" }],
      skills: [{ name: "find-skills" }],
      mcpServers: [{ serverId: "docs", status: "connected" }],
      actualUsage: {
        methods: ["Publish-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["file_read", "apply_patch"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T17:00:00.000Z",
    });

    const methodResult = await manager.generateMethodCandidates(goal.id);
    const skillResult = await manager.generateSkillCandidates(goal.id);
    await manager.generateFlowPatterns(goal.id);

    const reviews = await manager.listSuggestionReviews(goal.id);
    const methodReview = reviews.items.find((item) => item.suggestionType === "method_candidate");
    const skillReview = reviews.items.find((item) => item.suggestionType === "skill_candidate");
    expect(methodReview).toBeTruthy();
    expect(skillReview).toBeTruthy();

    await manager.decideSuggestionReview(goal.id, {
      reviewId: methodReview?.id,
      decision: "accepted",
      reviewer: "producer",
      decidedBy: "producer",
      note: "Publish method",
    });
    await manager.decideSuggestionReview(goal.id, {
      reviewId: skillReview?.id,
      decision: "accepted",
      reviewer: "producer",
      decidedBy: "producer",
      note: "Publish skill",
    });

    const publishedMethod = await manager.publishSuggestion(goal.id, {
      reviewId: methodReview?.id,
      reviewer: "producer",
      decidedBy: "producer",
    });
    const publishedSkill = await manager.publishSuggestion(goal.id, {
      reviewId: skillReview?.id,
      reviewer: "producer",
      decidedBy: "producer",
    });

    expect(publishedMethod.record.assetType).toBe("method");
    expect(publishedSkill.record.assetType).toBe("skill");
    expect(publishedMethod.record.publishedPath).toContain(path.join(stateDir, "methods"));
    expect(publishedSkill.record.publishedPath).toContain(path.join(stateDir, "skills"));

    const methodContent = await fs.readFile(publishedMethod.record.publishedPath, "utf-8");
    expect(methodContent).toContain(methodResult.candidates[0]?.draftContent.split("\n")[0] ?? "#");
    const skillContent = await fs.readFile(publishedSkill.record.publishedPath, "utf-8");
    expect(skillContent).toContain(skillResult.candidates[0]?.draftContent.split("\n")[0] ?? "---");

    const publishJson = JSON.parse(await fs.readFile(path.join(goal.runtimeRoot, "publish-records.json"), "utf-8"));
    expect(publishJson.items).toHaveLength(2);
    expect(publishJson.items[0].publishedPath).toBeTruthy();
    expect(publishJson.items.every((item: { experienceCandidateId?: string }) => Boolean(item.experienceCandidateId))).toBe(true);

    const methodExperience = memoryManager.listExperienceCandidates(10, {
      taskId: `goal_suggestion:${goal.id}:method_candidate:${methodReview?.suggestionId}`,
      type: "method",
    })[0];
    const skillExperience = memoryManager.listExperienceCandidates(10, {
      taskId: `goal_suggestion:${goal.id}:skill_candidate:${skillReview?.suggestionId}`,
      type: "skill",
    })[0];
    expect(methodExperience?.status).toBe("accepted");
    expect(skillExperience?.status).toBe("accepted");
    expect(methodExperience?.publishedPath).toBe(publishedMethod.record.publishedPath);
    expect(skillExperience?.publishedPath).toBe(publishedSkill.record.publishedPath);

    const publishedMethodAgain = await manager.publishSuggestion(goal.id, {
      reviewId: methodReview?.id,
      reviewer: "producer",
      decidedBy: "producer",
    });
    expect(publishedMethodAgain.record.id).toBe(publishedMethod.record.id);
    const methodExperienceAfter = memoryManager.listExperienceCandidates(10, {
      taskId: `goal_suggestion:${goal.id}:method_candidate:${methodReview?.suggestionId}`,
      type: "method",
    })[0];
    expect(methodExperienceAfter?.id).toBe(methodExperience?.id);

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("suggestion_published");
    memoryManager.close();
  });

  it("reuses an already published method artifact when publish-record persistence failed previously", async () => {
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "test-placeholder-key";
    }
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const memoryWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-memory-"));
    const memoryManager = new MemoryManager({
      workspaceRoot: memoryWorkspace,
      stateDir,
      taskMemoryEnabled: false,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: false,
      experienceAutoSkillEnabled: false,
    });
    registerGlobalMemoryManager(memoryManager);
    const goal = await manager.createGoal({
      title: "Suggestion Publish Recovery Goal",
      objective: "Recover publish record after partial publish success",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_publish_recovery",
      title: "Publish Recovery Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Recovered publish record points to the original asset"],
    });
    await manager.claimTaskNode(goal.id, "node_publish_recovery", {
      runId: "run_publish_recovery_1",
      summary: "Started publish recovery node",
    });
    await manager.requestCheckpoint(goal.id, "node_publish_recovery", {
      title: "Publish recovery checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_publish_recovery_1",
    });
    await manager.approveCheckpoint(goal.id, "node_publish_recovery", {
      summary: "Approved",
      note: "Proceed",
      decidedBy: "producer",
      runId: "run_publish_recovery_1",
    });
    await manager.completeTaskNode(goal.id, "node_publish_recovery", {
      summary: "Publish recovery node completed",
      artifacts: ["artifacts/publish-recovery.md"],
      runId: "run_publish_recovery_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_publish_recovery", {
      executionMode: "single_agent",
      riskLevel: "medium",
      objective: "Generate recoverable method suggestion",
      summary: "Need method publish retry recovery",
      methods: [{ file: "Publish-Recovery-Checklist.md" }],
      actualUsage: {
        methods: ["Publish-Recovery-Checklist.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T17:00:00.000Z",
    });

    await manager.generateMethodCandidates(goal.id);
    const reviews = await manager.listSuggestionReviews(goal.id);
    const methodReview = reviews.items.find((item) => item.suggestionType === "method_candidate");
    expect(methodReview).toBeTruthy();

    await manager.decideSuggestionReview(goal.id, {
      reviewId: methodReview?.id,
      decision: "accepted",
      reviewer: "producer",
      decidedBy: "producer",
      note: "Publish method after retry",
    });

    const publishRecordsPath = path.join(goal.runtimeRoot, "publish-records.json");
    const originalRename = fs.rename.bind(fs);
    let failedOnce = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (!failedOnce && target === publishRecordsPath) {
        failedOnce = true;
        const error = new Error("publish-record persistence failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return originalRename(source, target);
    });

    try {
      await expect(manager.publishSuggestion(goal.id, {
        reviewId: methodReview?.id,
        reviewer: "producer",
        decidedBy: "producer",
      })).rejects.toThrow("publish-record persistence failure");
    } finally {
      renameSpy.mockRestore();
    }

    const methodsDir = path.join(stateDir, "methods");
    const publishedFilesAfterFailure = (await fs.readdir(methodsDir)).filter((item) => item.endsWith(".md"));
    expect(publishedFilesAfterFailure).toHaveLength(1);
    const recoveredPath = path.join(methodsDir, publishedFilesAfterFailure[0] as string);
    const publishStateAfterFailure = JSON.parse(await fs.readFile(publishRecordsPath, "utf-8").catch(() => "{\"version\":1,\"items\":[]}")) as {
      items: Array<{ reviewId: string }>;
    };
    expect(publishStateAfterFailure.items.some((item) => item.reviewId === methodReview?.id)).toBe(false);

    const recovered = await manager.publishSuggestion(goal.id, {
      reviewId: methodReview?.id,
      reviewer: "producer",
      decidedBy: "producer",
    });
    expect(recovered.record.publishedPath).toBe(recoveredPath);

    const publishedFilesAfterRetry = (await fs.readdir(methodsDir)).filter((item) => item.endsWith(".md"));
    expect(publishedFilesAfterRetry).toHaveLength(1);

    const publishState = JSON.parse(await fs.readFile(publishRecordsPath, "utf-8")) as {
      items: Array<{ reviewId: string; publishedPath: string }>;
    };
    expect(publishState.items.filter((item) => item.reviewId === methodReview?.id)).toHaveLength(1);
    expect(publishState.items.find((item) => item.reviewId === methodReview?.id)?.publishedPath).toBe(recoveredPath);
    memoryManager.close();
  });

  it("routes published suggestion experience candidates to the scoped memory manager for an agent workspace", async () => {
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "test-placeholder-key";
    }
    const rootStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-root-"));
    const defaultMemoryWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-memory-default-"));
    const defaultMemoryManager = new MemoryManager({
      workspaceRoot: defaultMemoryWorkspace,
      stateDir: rootStateDir,
      taskMemoryEnabled: false,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: false,
      experienceAutoSkillEnabled: false,
    });
    registerGlobalMemoryManager(defaultMemoryManager);
    registerGlobalMemoryManager(defaultMemoryManager, {
      agentId: "default",
      workspaceRoot: rootStateDir,
      isDefault: true,
    });

    const coderStateDir = path.join(rootStateDir, "agents", "coder");
    await fs.mkdir(coderStateDir, { recursive: true });
    const coderMemoryWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-memory-coder-"));
    const coderMemoryManager = new MemoryManager({
      workspaceRoot: coderMemoryWorkspace,
      stateDir: coderStateDir,
      taskMemoryEnabled: false,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: false,
      experienceAutoSkillEnabled: false,
    });
    registerGlobalMemoryManager(coderMemoryManager, {
      agentId: "coder",
      workspaceRoot: coderStateDir,
    });

    const manager = new GoalManager(coderStateDir);
    const goal = await manager.createGoal({
      title: "Scoped Suggestion Publish Goal",
      objective: "Publish suggestions into the agent-scoped memory manager",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_scoped_publish",
      title: "Scoped Publish Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Published candidate is stored in the agent-scoped memory manager"],
    });
    await manager.claimTaskNode(goal.id, "node_scoped_publish", {
      runId: "run_scoped_publish_1",
      summary: "Started scoped publish node",
    });
    await manager.requestCheckpoint(goal.id, "node_scoped_publish", {
      title: "Scoped publish checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "coder",
      runId: "run_scoped_publish_1",
    });
    await manager.approveCheckpoint(goal.id, "node_scoped_publish", {
      summary: "Approved",
      note: "Proceed",
      decidedBy: "producer",
      runId: "run_scoped_publish_1",
    });
    await manager.completeTaskNode(goal.id, "node_scoped_publish", {
      summary: "Scoped publish node completed",
      artifacts: ["artifacts/scoped-publish.md"],
      runId: "run_scoped_publish_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_scoped_publish", {
      executionMode: "single_agent",
      riskLevel: "medium",
      objective: "Generate a scoped method suggestion",
      summary: "Route publication into the coder memory manager",
      methods: [{ file: "Scoped-Publish-Checklist.md" }],
      actualUsage: {
        methods: ["Scoped-Publish-Checklist.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T17:30:00.000Z",
    });

    await manager.generateMethodCandidates(goal.id);
    const reviews = await manager.listSuggestionReviews(goal.id);
    const methodReview = reviews.items.find((item) => item.suggestionType === "method_candidate");
    expect(methodReview).toBeTruthy();

    await manager.decideSuggestionReview(goal.id, {
      reviewId: methodReview?.id,
      decision: "accepted",
      reviewer: "producer",
      decidedBy: "producer",
      note: "Publish into scoped manager",
    });

    const published = await manager.publishSuggestion(goal.id, {
      reviewId: methodReview?.id,
      reviewer: "producer",
      decidedBy: "producer",
    });

    const taskId = `goal_suggestion:${goal.id}:method_candidate:${methodReview?.suggestionId}`;
    const scopedExperience = coderMemoryManager.listExperienceCandidates(10, {
      taskId,
      type: "method",
    })[0];
    const defaultExperience = defaultMemoryManager.listExperienceCandidates(10, {
      taskId,
      type: "method",
    })[0];

    expect(scopedExperience?.status).toBe("accepted");
    expect(scopedExperience?.publishedPath).toBe(published.record.publishedPath);
    expect(defaultExperience).toBeUndefined();

    coderMemoryManager.close();
    defaultMemoryManager.close();
  });

  it("aggregates repeated flow patterns across goals", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);

    const goalA = await manager.createGoal({
      title: "Cross Flow Alpha",
      objective: "Goal A",
    });
    await manager.createTaskNode(goalA.id, {
      id: "node_a",
      title: "Node A",
      status: "ready",
    });
    await manager.claimTaskNode(goalA.id, "node_a", { runId: "run_a" });
    await manager.completeTaskNode(goalA.id, "node_a", { summary: "Done A", runId: "run_a" });
    await manager.saveCapabilityPlan(goalA.id, "node_a", {
      executionMode: "single_agent",
      riskLevel: "low",
      objective: "Complete A",
      summary: "Stable A",
      actualUsage: {
        methods: ["Checklist-A.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T18:00:00.000Z",
    });
    await manager.generateFlowPatterns(goalA.id);

    const goalB = await manager.createGoal({
      title: "Cross Flow Beta",
      objective: "Goal B",
    });
    await manager.createTaskNode(goalB.id, {
      id: "node_b",
      title: "Node B",
      status: "ready",
    });
    await manager.claimTaskNode(goalB.id, "node_b", { runId: "run_b" });
    await manager.completeTaskNode(goalB.id, "node_b", { summary: "Done B", runId: "run_b" });
    await manager.saveCapabilityPlan(goalB.id, "node_b", {
      executionMode: "single_agent",
      riskLevel: "low",
      objective: "Complete B",
      summary: "Stable B",
      actualUsage: {
        methods: ["Checklist-A.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T18:05:00.000Z",
    });
    await manager.generateFlowPatterns(goalB.id);

    const result = await manager.generateCrossGoalFlowPatterns();
    expect(result.goalsScanned).toBeGreaterThanOrEqual(2);
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.patterns[0]?.goalCount).toBeGreaterThanOrEqual(2);
    expect(result.patterns[0]?.occurrenceCount).toBeGreaterThanOrEqual(2);
    expect(result.patterns[0]?.recommendedAction).toBe("promote_method");
    expect(result.jsonPath).toContain("cross-goal-flow-patterns.json");
    expect(result.markdownPath).toContain("cross-goal-flow-patterns.md");

    const json = JSON.parse(await fs.readFile(path.join(stateDir, "goals", "cross-goal-flow-patterns.json"), "utf-8"));
    expect(json.goalsScanned).toBeGreaterThanOrEqual(2);
    expect(json.items[0].goalCount).toBeGreaterThanOrEqual(2);

    const markdown = await fs.readFile(path.join(stateDir, "docs", "long-tasks", "cross-goal-flow-patterns.md"), "utf-8");
    expect(markdown).toContain("# 12-cross-goal-flow-patterns");
    expect(markdown).toContain("cross_goal_flow_1");
  });

  it("aggregates review governance summary without requiring a new frontend shell", async () => {
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "test-placeholder-key";
    }
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-state-"));
    const manager = new GoalManager(stateDir);
    const memoryWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "ss-goal-memory-"));
    const memoryManager = new MemoryManager({
      workspaceRoot: memoryWorkspace,
      stateDir,
      taskMemoryEnabled: false,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: false,
      experienceAutoSkillEnabled: false,
    });
    registerGlobalMemoryManager(memoryManager);
    const goal = await manager.createGoal({
      title: "Governance Summary Goal",
      objective: "Summarize review governance",
    });

    await manager.createTaskNode(goal.id, {
      id: "node_govern",
      title: "Govern Node",
      status: "ready",
      checkpointRequired: true,
      acceptance: ["Regression passes"],
    });
    await manager.claimTaskNode(goal.id, "node_govern", { runId: "run_govern_1", summary: "Started govern node" });
    await manager.requestCheckpoint(goal.id, "node_govern", {
      title: "Govern checkpoint",
      summary: "Ready for approval",
      reviewer: "producer",
      requestedBy: "main-agent",
      runId: "run_govern_1",
    });
    await manager.approveCheckpoint(goal.id, "node_govern", {
      summary: "Approved",
      note: "Looks stable",
      decidedBy: "producer",
      runId: "run_govern_1",
    });
    await manager.completeTaskNode(goal.id, "node_govern", {
      summary: "Govern node completed",
      artifacts: ["artifacts/govern.md"],
      runId: "run_govern_1",
    });
    await manager.saveCapabilityPlan(goal.id, "node_govern", {
      runId: "run_govern_1",
      executionMode: "multi_agent_parallel",
      governanceMode: "commander",
      commanderAgentId: "commander-main",
      preferredAgents: ["commander-main", "coder", "reviewer"],
      riskLevel: "medium",
      objective: "Summarize governance",
      summary: "Stable governance path",
      subAgents: [
        { agentId: "coder", role: "coder", objective: "Prepare implementation evidence", deliverable: "patch diff" },
        { agentId: "reviewer", role: "verifier", objective: "Summarize regression and review evidence", deliverable: "review note" },
      ],
      actualUsage: {
        methods: ["Review-Checklist.md"],
        skills: [],
        mcpServers: [],
        toolNames: ["file_read"],
      },
      status: "orchestrated",
      orchestratedAt: "2026-03-20T18:10:00.000Z",
      orchestration: {
        claimed: true,
        delegated: true,
        delegationCount: 2,
        finalApprovalMode: "user_required",
        reworkRevisionCount: 1,
        lastReworkReason: "Need final regression confirmation before close",
        lastReworkAt: "2026-03-20T18:05:00.000Z",
        reworkContext: {
          quickSummary: "Need final regression confirmation before close",
          historySummary: "Rework Revision 1 | current=Need final regression confirmation before close",
          persistedReason: "Rework Revision 1 || current=Need final regression confirmation before close",
        },
        coordinationPlan: {
          summary: "Commander 汇总 coder / reviewer 两路结果后再进入人工验收。",
          plannedDelegationCount: 2,
          managerAgentId: "commander-main",
          rolePolicy: {
            selectedRoles: ["coder", "verifier"],
            selectionReasons: ["实现与评审分离，便于 fan-in 收口。"],
            fanInStrategy: "commander_review",
          },
        },
        delegationResults: [
          {
            agentId: "coder",
            role: "coder",
            status: "success",
            summary: "Patch delivered with runtime artifact.",
            taskId: "run_lane_coder",
            outputPath: "runtime/runs/run_govern_1/work-order/coder.md",
          },
          {
            agentId: "reviewer",
            role: "verifier",
            status: "success",
            summary: "Regression review completed.",
            taskId: "run_lane_reviewer",
            outputPath: "runtime/runs/run_govern_1/work-order/reviewer.md",
          },
        ],
        acceptanceGate: {
          status: "accepted",
          summary: "Commander review fan-in is complete and ready for user approval.",
          managerActionHint: "进入 validating，并等待用户最终审批验收后再收口。",
          reasons: ["两路 delegation 已成功返回。", "关键验收证据已汇总。"],
          contractSpecificChecks: [
            {
              id: "regression",
              label: "Regression passes",
              status: "passed",
              enforced: true,
              evidence: "runtime/runs/run_govern_1/review-results/review-node-govern.md",
            },
          ],
        },
      },
    });

    await manager.generateMethodCandidates(goal.id);
    await manager.generateFlowPatterns(goal.id);
    const reviews = await manager.listSuggestionReviews(goal.id);
    const methodReview = reviews.items.find((item) => item.suggestionType === "method_candidate");
    expect(methodReview).toBeTruthy();

    await manager.decideSuggestionReview(goal.id, {
      reviewId: methodReview?.id,
      decision: "accepted",
      reviewer: "producer",
      decidedBy: "producer",
      note: "Ready to publish",
    });
    await manager.publishSuggestion(goal.id, {
      reviewId: methodReview?.id,
      reviewer: "producer",
      decidedBy: "producer",
    });

    const summary = await manager.getReviewGovernanceSummary(goal.id);
    expect(summary.reviewStatusCounts.accepted).toBeGreaterThanOrEqual(1);
    expect(summary.reviewTypeCounts.method_candidate).toBeGreaterThanOrEqual(1);
    expect(summary.workflowPendingCount).toBeGreaterThanOrEqual(0);
    expect(summary.workflowOverdueCount).toBeGreaterThanOrEqual(0);
    expect(summary.publishRecords.items.length).toBeGreaterThanOrEqual(1);
    expect(summary.crossGoal.jsonPath).toContain("cross-goal-flow-patterns.json");
    expect(summary.summary).toContain("published=1");
    expect(summary.recommendations.length).toBeGreaterThan(0);
    expect(summary.commanderFocus).toMatchObject({
      nodeId: "node_govern",
      runId: "run_govern_1",
      governanceMode: "commander",
      executionMode: "multi_agent_parallel",
      commanderAgentId: "commander-main",
      reviewStatus: "accepted",
      finalApprovalMode: "user_required",
      reworkRevisionCount: 1,
      fanInSummary: "Commander review fan-in is complete and can be used as the acceptance signal for this capability plan.",
      managerActionHint: "Commander review is complete enough to approve this capability plan or move the node into validating/done.",
      reworkContext: {
        quickSummary: "Need final regression confirmation before close",
      },
    });
    expect(summary.commanderFocus?.reworkContext?.historySummary).toContain("Rework Revision 1");
    expect(summary.commanderFocus?.delegationResults).toHaveLength(2);
    expect(
      summary.commanderFocus?.checkLines.some((item) => (
        item.includes("successful delegated source")
        && item.includes("sources=coder, reviewer")
      )),
    ).toBe(true);
    expect(
      summary.commanderFocus?.checkLines.some((item) => (
        item.includes("no failed delegated source")
        && item.includes("failed=0")
      )),
    ).toBe(true);
    expect(summary.commanderFocus?.reviewPath).toContain(path.join("run-govern-1", "review-results", "review-node-govern.md"));
    expect(summary.commanderFocus?.commanderPlanPath).toContain(path.join("run-govern-1", "commander-plan.md"));
    expect(summary.commanderFocus?.workOrderPaths[0]).toContain(path.join("run-govern-1", "work-order", "coder.md"));
    expect(summary.recommendations[0]).toContain("Commander 建议");
    memoryManager.close();
  });
});
