import { expect, test } from "vitest";

import {
  buildBackgroundContinuationState,
  buildConversationContinuationState,
  buildGoalContinuationState,
  buildResidentContinuationState,
  buildSubTaskContinuationState,
} from "./continuation-state.js";
import type { GoalHandoffSnapshot } from "./goals/types.js";
import type { SubTaskRecord } from "./task-runtime.js";

test("buildSubTaskContinuationState summarizes minimal recovery state", () => {
  const record: SubTaskRecord = {
    id: "task_sub_1",
    kind: "sub_agent",
    parentConversationId: "conv-sub",
    sessionId: "sub_session_2",
    agentId: "coder",
    launchSpec: {
      agentId: "coder",
      profileId: "coder",
      background: true,
      timeoutMs: 60_000,
      channel: "subtask",
    },
    background: true,
    status: "error",
    instruction: "Implement runtime bridge",
    summary: "Integration coverage is still missing.",
    progress: {
      phase: "error",
      message: "The second integration test still fails.",
      lastActivityAt: 1712000000500,
    },
    createdAt: 1712000000000,
    updatedAt: 1712000000500,
    finishedAt: 1712000000500,
    outputPreview: "Partial patch applied.",
    error: "integration test failed",
    steering: [],
    takeover: [],
    resume: [
      {
        id: "task_resume_1",
        message: "Continue from the failure.",
        status: "delivered",
        requestedAt: 1712000000200,
        deliveredAt: 1712000000300,
        requestedSessionId: "sub_session_1",
        deliveredSessionId: "sub_session_2",
        resumedFromSessionId: "sub_session_1",
      },
    ],
    notifications: [
      { id: "n1", kind: "completed", message: "Task completed successfully.", createdAt: 1712000000100 },
      { id: "n2", kind: "resume_delivered", message: "Resume delivered to the relaunched subtask session.", createdAt: 1712000000300 },
      { id: "n3", kind: "failed", message: "integration test failed", createdAt: 1712000000500 },
    ],
  };

  expect(buildSubTaskContinuationState(record)).toMatchObject({
    version: 1,
    scope: "subtask",
    targetId: "task_sub_1",
    recommendedTargetId: "sub_session_2",
    targetType: "session",
    resumeMode: "same_task_relaunch",
    summary: "Integration coverage is still missing.",
    checkpoints: {
      openCount: 0,
      blockerCount: 2,
      labels: ["integration test failed", "The second integration test still fails."],
    },
    progress: {
      current: "The second integration test still fails.",
      recent: [
        "integration test failed",
        "Resume delivered to the relaunched subtask session.",
        "Task completed successfully.",
      ],
    },
  });
});

test("buildSubTaskContinuationState falls back to bridge summary for bridge subtasks", () => {
  const record: SubTaskRecord = {
    id: "task_bridge_1",
    kind: "sub_agent",
    parentConversationId: "conv-bridge",
    sessionId: "sub_bridge_1",
    agentId: "coder",
    launchSpec: {
      agentId: "coder",
      profileId: "coder",
      background: true,
      timeoutMs: 60_000,
      channel: "subtask",
      bridgeSubtask: {
        kind: "review",
        targetId: "codex_exec",
        action: "review",
        goalId: "goal_bridge_1",
        goalNodeId: "node_bridge_review",
        summary: "Inspect the bridge patch output before approval.",
      },
    },
    background: true,
    status: "done",
    instruction: "Bridge review follow-up",
    summary: "",
    progress: {
      phase: "done",
      lastActivityAt: 1712000000700,
    },
    createdAt: 1712000000000,
    updatedAt: 1712000000700,
    finishedAt: 1712000000700,
    steering: [],
    takeover: [],
    resume: [],
    notifications: [],
  };

  expect(buildSubTaskContinuationState(record)).toMatchObject({
    summary: "Bridge review via codex_exec.review: Inspect the bridge patch output before approval.",
    progress: {
      current: "Bridge review via codex_exec.review: Inspect the bridge patch output before approval.",
      recent: [],
    },
  });
});

test("buildSubTaskContinuationState exposes restart-lost recovery as a blocker", () => {
  const record: SubTaskRecord = {
    id: "task_interrupted_1",
    kind: "sub_agent",
    parentConversationId: "conv-interrupted",
    sessionId: "sub_interrupted_1",
    agentId: "coder",
    launchSpec: {
      agentId: "coder",
      profileId: "coder",
      background: true,
      timeoutMs: 60_000,
      channel: "subtask",
    },
    background: true,
    status: "interrupted",
    instruction: "Resume only after runtime recovery review",
    summary: "Subtask runtime owner was lost.",
    progress: {
      phase: "interrupted",
      message: "Manual resume is required.",
      lastActivityAt: 1712000000500,
    },
    createdAt: 1712000000000,
    updatedAt: 1712000000500,
    finishedAt: 1712000000500,
    error: "Subtask runtime owner was lost.",
    recovery: {
      state: "runtime_lost",
      previousStatus: "running",
      detectedAt: 1712000000500,
      mutationReplay: "forbidden",
    },
    steering: [],
    takeover: [],
    resume: [],
    notifications: [],
  };

  expect(buildSubTaskContinuationState(record)).toMatchObject({
    resumeMode: "recovery",
    nextAction: "Resume this task from the last recorded state or inspect the failure details first.",
    checkpoints: {
      blockerCount: 2,
      labels: ["Subtask runtime owner was lost.", "Manual resume is required."],
    },
  });
});

test("buildGoalContinuationState normalizes goal handoff into shared shape", () => {
  const handoff: GoalHandoffSnapshot = {
    version: 1,
    goalId: "goal_1",
    generatedAt: "2026-04-08T08:00:00.000Z",
    goalStatus: "executing",
    currentPhase: "implementation",
    activeConversationId: "goal_conv_1",
    activeNodeId: "node_impl",
    lastNodeId: "node_impl",
    lastRunId: "run_goal_1",
    resumeMode: "checkpoint",
    recommendedNodeId: "node_impl",
    summary: "One checkpoint is waiting for approval before the next node can continue.",
    nextAction: "Review the open checkpoint for node_impl, then resume execution from that node.",
    tracking: {
      totalNodes: 4,
      completedNodes: 1,
      inProgressNodes: 1,
      blockedNodes: 1,
      pendingReviewNodes: 0,
      validatingNodes: 0,
      failedNodes: 0,
      skippedNodes: 0,
      openCheckpointCount: 1,
    },
    openCheckpoints: [
      {
        id: "checkpoint_1",
        status: "waiting_user",
        title: "Need producer review",
        nodeId: "node_impl",
        summary: "Please confirm the rollout decision.",
        updatedAt: "2026-04-08T07:58:00.000Z",
      },
    ],
    checkpointReplay: {
      checkpointId: "checkpoint_1",
      nodeId: "node_impl",
      title: "Need producer review",
      summary: "Please confirm the rollout decision.",
      reason: "Approval pending",
    },
    blockers: [
      {
        kind: "checkpoint",
        id: "checkpoint_1",
        title: "Need producer review",
        status: "waiting_user",
        nodeId: "node_impl",
        reason: "Approval pending",
      },
    ],
    recentProgress: [
      {
        at: "2026-04-08T07:55:00.000Z",
        event: "checkpoint_requested",
        title: "Need producer review",
        summary: "Checkpoint requested for rollout.",
      },
      {
        at: "2026-04-08T07:40:00.000Z",
        event: "node_claimed",
        title: "Implement rollout",
        summary: "Implementation resumed.",
      },
    ],
    bridgeGovernance: {
      bridgeNodeCount: 1,
      activeCount: 0,
      runtimeLostCount: 1,
      orphanedCount: 0,
      closedCount: 0,
      blockedCount: 1,
      artifactCount: 1,
      transcriptCount: 1,
      items: [
        {
          nodeId: "node_impl",
          title: "Implement rollout",
          taskId: "task_bridge_1",
          runtimeState: "runtime-lost",
          closeReason: "runtime-lost",
          blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
          artifactPath: "artifacts/bridge.md",
          transcriptPath: "logs/bridge.jsonl",
          summaryLines: ["Bridge review via codex_session.interactive: recover the rollout runtime."],
        },
      ],
    },
  };

  expect(buildGoalContinuationState(handoff)).toMatchObject({
    version: 1,
    scope: "goal",
    targetId: "goal_1",
    recommendedTargetId: "node_impl",
    targetType: "node",
    resumeMode: "checkpoint",
    summary: "One checkpoint is waiting for approval before the next node can continue.",
    nextAction: "Review the open checkpoint for node_impl, then resume execution from that node.",
    replay: {
      kind: "goal_checkpoint",
      checkpointId: "checkpoint_1",
      nodeId: "node_impl",
      title: "Need producer review",
      summary: "Please confirm the rollout decision.",
      reason: "Approval pending",
    },
    checkpoints: {
      openCount: 1,
      blockerCount: 1,
      labels: [
        "Need producer review",
        "Need producer review",
        "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
        "Bridge review via codex_session.interactive: recover the rollout runtime.",
      ],
    },
    progress: {
      current: "implementation",
      recent: [
        "Checkpoint requested for rollout.",
        "Implementation resumed.",
        "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
      ],
    },
  });
});

test("buildConversationContinuationState summarizes main conversation recovery state", () => {
  expect(buildConversationContinuationState({
    conversationId: "agent:coder:main",
    messages: [
      { role: "user", content: "Need a continuation summary.", timestampMs: 1712000000000 },
      { role: "assistant", content: "The runtime patch is ready for review.", timestampMs: 1712000000500 },
    ],
    loadedDeferredTools: ["alpha_deferred"],
    compactBoundaries: [{ createdAt: 1712000000200 }],
    taskTokenResults: [{ name: "run", totalTokens: 42, createdAt: 1712000000300 }],
  })).toMatchObject({
    version: 1,
    scope: "conversation",
    targetId: "agent:coder:main",
    recommendedTargetId: "agent:coder:main",
    targetType: "conversation",
    resumeMode: "conversation_context",
    summary: "The runtime patch is ready for review.",
    checkpoints: {
      openCount: 1,
      blockerCount: 0,
      labels: ["tool:alpha_deferred", "compact:1", "task:run"],
    },
    progress: {
      current: "2 messages",
      recent: [
        "assistant: The runtime patch is ready for review.",
        "user: Need a continuation summary.",
      ],
    },
  });
});

test("buildConversationContinuationState prefers session memory and resume context over latest raw message", () => {
  expect(buildConversationContinuationState({
    conversationId: "conv-multi-round-resume",
    messages: [
      { role: "user", content: "继续核对多轮续做一致性。", timestampMs: 1712000000000 },
      { role: "assistant", content: "收到，我继续。", timestampMs: 1712000000500 },
    ],
    loadedDeferredTools: ["memory_recent_work"],
    compactBoundaries: [{ createdAt: 1712000000200 }],
    taskTokenResults: [{ name: "resume-check", totalTokens: 42, createdAt: 1712000000300 }],
    sessionDigest: {
      status: "ready",
      rollingSummary: "已确认 prompt artifact 与请求体都带上续做注入，正在核对多轮一致性。",
    },
    sessionMemory: {
      summary: "已确认 prompt artifact 与请求体都带上续做注入，正在核对多轮一致性。",
      currentWork: "已确认 prompt artifact 与请求体都带上续做注入，待继续核对多轮一致性。",
      nextStep: "继续检查 digest / continuation / resume_context 是否仍一致。",
    },
    resumeContext: {
      currentStopPoint: "已确认 prompt artifact 与请求体都带上续做注入，待继续核对多轮一致性。",
      nextStep: "继续检查 digest / continuation / resume_context 是否仍一致。",
      blockers: ["inspect.text 仍主要是系统 prompt 视角。"],
    },
  })).toMatchObject({
    summary: "已确认 prompt artifact 与请求体都带上续做注入，待继续核对多轮一致性。",
    nextAction: "继续检查 digest / continuation / resume_context 是否仍一致。",
    checkpoints: {
      openCount: 1,
      blockerCount: 1,
      labels: [
        "tool:memory_recent_work",
        "compact:1",
        "task:resume-check",
        "inspect.text 仍主要是系统 prompt 视角。",
      ],
    },
    progress: {
      current: "已确认 prompt artifact 与请求体都带上续做注入，待继续核对多轮一致性。",
      recent: [
        "assistant: 收到，我继续。",
        "user: 继续核对多轮续做一致性。",
      ],
    },
  });
});

test("buildResidentContinuationState summarizes resident recovery state", () => {
  expect(buildResidentContinuationState({
    agentId: "coder",
    status: "running",
    mainConversationId: "agent:coder:main",
    lastConversationId: "agent:coder:main",
    lastActiveAt: 1712000000500,
    sharedGovernance: {
      pendingCount: 2,
      claimedCount: 1,
    },
    recentTaskDigest: {
      recentCount: 1,
      latestTaskId: "task_goal_1",
      latestTitle: "Implement runtime bridge",
      latestStatus: "success",
      headline: "1 recent, latest=Implement runtime bridge (success)",
    },
    recentSubtaskDigest: {
      recentCount: 1,
      latestTaskId: "task_sub_1",
      latestSummary: "Review the structured patch output.",
      latestStatus: "done",
      headline: "1 recent, latest=Review the structured patch output. (done)",
    },
    experienceUsageDigest: {
      usageCount: 1,
      latestAssetKey: "runtime-bridge-checklist",
      headline: "1 recent, latest=runtime-bridge-checklist",
    },
  })).toMatchObject({
    version: 1,
    scope: "resident",
    targetId: "coder",
    recommendedTargetId: "agent:coder:main",
    targetType: "conversation",
    resumeMode: "resident_review",
    checkpoints: {
      openCount: 2,
      blockerCount: 0,
    },
    progress: {
      current: "running",
      recent: [
        "1 recent, latest=Implement runtime bridge (success)",
        "1 recent, latest=Review the structured patch output. (done)",
        "1 recent, latest=runtime-bridge-checklist",
      ],
    },
  });
});

test("buildBackgroundContinuationState links background runs to shared continuation targets", () => {
  expect(buildBackgroundContinuationState({
    scope: "cron",
    targetId: "cron-job-1",
    targetLabel: "Digest",
    status: "ran",
    summary: "Digest completed and sent to the main session.",
    conversationId: "cron-main:cron-job-1",
    sessionTarget: "main",
    nextRunAtMs: 1712000060000,
  })).toMatchObject({
    version: 1,
    scope: "background",
    targetId: "cron-job-1",
    recommendedTargetId: "cron-main:cron-job-1",
    targetType: "conversation",
    resumeMode: "cron_main_conversation",
    summary: "Digest completed and sent to the main session.",
    checkpoints: {
      openCount: 0,
      blockerCount: 0,
      labels: ["scope:cron", "session:main"],
    },
    progress: {
      current: "cron:ran",
    },
  });
});
