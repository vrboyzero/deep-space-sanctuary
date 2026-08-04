import { expect, test } from "vitest";

import {
  buildAssistantModeRuntimeReport,
  DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
  parseAssistantExternalDeliveryPreference,
} from "./assistant-mode-runtime.js";
import type { AssistantModeGoalRuntimeSummary } from "./assistant-mode-goals.js";

test("assistant mode runtime reports disabled state when proactive runtime is off", () => {
  const report = buildAssistantModeRuntimeReport({
    heartbeatEnabled: false,
    heartbeatInterval: "30m",
    cronEnabled: false,
    externalOutboundRequireConfirmation: true,
  });

  expect(report).toMatchObject({
    available: true,
    enabled: false,
    status: "disabled",
    controls: {
      assistantModeEnabled: false,
      assistantModeSource: "derived",
      assistantModeMismatch: false,
      heartbeatEnabled: false,
      heartbeatInterval: "30m",
      cronEnabled: false,
    },
    delivery: {
      residentChannel: true,
      confirmationRequired: true,
      externalDeliveryPreference: DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
    },
    explanation: {},
  });
  expect(report.recentActions).toEqual([]);
  expect(report.headline).toContain("mode=off(derived)");
  expect(report.headline).toContain("status=disabled");
});

test("assistant mode runtime aggregates proactive actions and ignores subtask entries", () => {
  const report = buildAssistantModeRuntimeReport({
    assistantModeEnabled: true,
    assistantModeConfigured: true,
    heartbeatEnabled: true,
    heartbeatInterval: "45m",
    heartbeatActiveHours: "08:00-23:00",
    cronEnabled: true,
    cronRuntime: {
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
        main: 2,
        isolated: 1,
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
          id: "cron-digest",
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
    },
    backgroundContinuationRuntime: {
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
          startedAt: 1710000000000,
          updatedAt: 1710000000100,
          conversationId: "heartbeat-1",
          continuationState: {
            version: 1,
            scope: "background",
            targetId: "heartbeat",
            recommendedTargetId: "heartbeat-1",
            targetType: "conversation",
            resumeMode: "heartbeat_conversation",
            summary: "Heartbeat follow-up",
            nextAction: "Continue heartbeat conversation",
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
          startedAt: 1710000000200,
          updatedAt: 1710000000300,
          continuationState: {
            version: 1,
            scope: "subtask",
            targetId: "task-1",
            recommendedTargetId: "task-1",
            targetType: "conversation",
            resumeMode: "subtask_resume",
            summary: "Subtask failed",
            nextAction: "Resume subtask",
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
          sourceId: "cron-digest",
          label: "Digest",
          status: "ran",
          startedAt: 1710000000400,
          updatedAt: 1710000000500,
          finishedAt: 1710000000500,
          sessionTarget: "main",
          summary: "Digest delivered",
          nextRunAtMs: 1710003600000,
          continuationState: {
            version: 1,
            scope: "background",
            targetId: "cron-digest",
            recommendedTargetId: "cron-main:cron-digest",
            targetType: "conversation",
            resumeMode: "cron_main_conversation",
            summary: "Digest delivered",
            nextAction: "Open cron conversation",
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
    },
    residentAgents: {
      summary: {
        totalCount: 1,
        activeCount: 1,
        runningCount: 1,
        idleCount: 0,
        backgroundCount: 0,
        errorCount: 0,
        memoryModeCounts: {
          isolated: 0,
          shared: 0,
          hybrid: 1,
        },
        workspaceBindingCounts: {
          current: 1,
          custom: 0,
        },
        writeTargetCounts: {
          private: 1,
          shared: 0,
        },
        sharedReadEnabledCount: 1,
        digestReadyCount: 0,
        digestUpdatedCount: 1,
        digestIdleCount: 0,
        digestMissingCount: 0,
        sharedGovernanceCounts: {
          pendingCount: 0,
          claimedCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
          revokedCount: 0,
        },
        recentTaskLinkedCount: 1,
        recentSubtaskLinkedCount: 0,
        experienceUsageLinkedCount: 0,
        catalogAnnotatedCount: 1,
        structuredHandoffCount: 0,
        skillHintedCount: 0,
        headline: "1 resident(s); running 1 / idle 0",
      },
      agents: [
        {
          id: "default",
          displayName: "Belldandy",
          model: "test-model",
          kind: "resident",
          workspaceBinding: "current",
          sessionNamespace: "default",
          memoryMode: "hybrid",
          status: "running",
          memoryPolicy: {
            agentId: "default",
            workspaceDir: "E:/project/star-sanctuary",
            memoryMode: "hybrid",
            privateStateDir: "C:/Users/admin/.star_sanctuary",
            sessionsDir: "C:/Users/admin/.star_sanctuary/sessions",
            sharedStateDir: "C:/Users/admin/.star_sanctuary/team-memory",
            writeTarget: "private",
            readTargets: ["private", "shared"],
            protectedStateGlobs: [],
          },
          conversationDigest: {
            conversationId: "agent:default:main",
            status: "updated",
            messageCount: 12,
            pendingMessageCount: 3,
            threshold: 10,
            lastDigestAt: 1710000000000,
          },
          continuationState: {
            version: 1,
            scope: "background",
            targetId: "heartbeat",
            recommendedTargetId: "heartbeat-1",
            targetType: "conversation",
            resumeMode: "resident_followup",
            summary: "Resident follow-up",
            nextAction: "Review resident follow-up",
            checkpoints: {
              openCount: 0,
              blockerCount: 0,
              labels: [],
            },
            progress: {
              current: "resident:running",
              recent: ["resident:running"],
            },
          },
          observabilityHeadline: "Belldandy running with updated digest",
          warnings: [],
        },
      ],
    } as any,
    externalOutboundRequireConfirmation: false,
  });

  expect(report.status).toBe("running");
  expect(report.controls).toMatchObject({
    assistantModeEnabled: true,
    assistantModeSource: "explicit",
    assistantModeMismatch: false,
    heartbeatEnabled: true,
    heartbeatInterval: "45m",
    activeHours: "08:00-23:00",
    cronEnabled: true,
  });
  expect(report.sources).toMatchObject({
    heartbeat: {
      enabled: true,
      lastStatus: "running",
    } as any,
    cron: {
      enabled: true,
      schedulerRunning: true,
      activeRuns: 1,
      totalJobs: 3,
      enabledJobs: 2,
      userDeliveryJobs: 2,
      lastStatus: "ran",
    },
  });
  expect(report.recentActions).toHaveLength(2);
  expect(report.recentActions.map((item) => item.kind)).toEqual(["heartbeat", "cron"]);
  expect(report.delivery.confirmationRequired).toBe(false);
  expect(report.resident).toMatchObject({
    totalCount: 1,
    runningCount: 1,
    idleCount: 0,
    headline: "1 resident(s); running 1 / idle 0",
    primary: {
      id: "default",
      displayName: "Belldandy",
      status: "running",
      digestStatus: "updated",
      pendingMessageCount: 3,
      recommendedTargetId: "heartbeat-1",
      targetType: "conversation",
      nextAction: "Review resident follow-up",
    },
  });
  expect(report.explanation).toMatchObject({
    nextAction: {
      summary: "Continue Heartbeat",
      targetId: "heartbeat-1",
      targetType: "conversation",
    },
  });
  expect(report.focus).toMatchObject({
    summary: "Heartbeat",
    targetId: "heartbeat-1",
    targetType: "conversation",
  });
  expect(report.attentionItems).toEqual([]);
  expect(report.headline).toContain("mode=on(explicit)");
  expect(report.headline).toContain("notify=resident+feishu>qq>community>discord");
});

test("assistant mode runtime reports attention reason from failed proactive action", () => {
  const report = buildAssistantModeRuntimeReport({
    assistantModeEnabled: true,
    assistantModeConfigured: true,
    heartbeatEnabled: true,
    heartbeatInterval: "30m",
    cronEnabled: false,
    backgroundContinuationRuntime: {
      totals: {
        totalRuns: 1,
        runningRuns: 0,
        failedRuns: 1,
        skippedRuns: 0,
        conversationLinkedRuns: 1,
        recoverableFailedRuns: 0,
        recoveryAttemptedRuns: 0,
        recoverySucceededRuns: 0,
      },
      kindCounts: {
        cron: 0,
        heartbeat: 1,
        subtask: 0,
      },
      sessionTargetCounts: {
        main: 1,
        isolated: 0,
      },
      recentEntries: [
        {
          runId: "heartbeat-run-failed",
          kind: "heartbeat",
          sourceId: "heartbeat",
          label: "Heartbeat",
          status: "failed",
          startedAt: 1710001000000,
          updatedAt: 1710001000100,
          reason: "provider unavailable",
          continuationState: {
            version: 1,
            scope: "background",
            targetId: "heartbeat",
            recommendedTargetId: "heartbeat-2",
            targetType: "conversation",
            resumeMode: "heartbeat_conversation",
            summary: "Heartbeat failed",
            nextAction: "Retry heartbeat conversation",
            checkpoints: {
              openCount: 0,
              blockerCount: 1,
              labels: ["provider"],
            },
            progress: {
              current: "heartbeat:failed",
              recent: ["heartbeat:failed"],
            },
          },
        },
      ],
      headline: "runs=1",
    },
    externalOutboundRequireConfirmation: true,
  });

  expect(report.status).toBe("attention");
  expect(report.explanation).toMatchObject({
    nextAction: {
      summary: "Wait for the next heartbeat window (30m)",
    },
    attentionReason: "Heartbeat: provider unavailable",
  });
  expect(report.focus).toMatchObject({
    summary: "Heartbeat",
    targetId: "heartbeat-2",
    targetType: "conversation",
  });
  expect(report.attentionItems).toEqual([
    {
      kind: "failed_action",
      summary: "Heartbeat: provider unavailable",
      targetId: "heartbeat-2",
      targetType: "conversation",
    },
  ]);
});

test("assistant mode runtime normalizes configured external delivery preference", () => {
  expect(parseAssistantExternalDeliveryPreference(" qq , feishu > discord , unknown ")).toEqual([
    "qq",
    "feishu",
    "discord",
  ]);
  expect(parseAssistantExternalDeliveryPreference("")).toEqual(
    DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
  );
});

test("assistant mode runtime builds mismatch and cron attention items", () => {
  const report = buildAssistantModeRuntimeReport({
    assistantModeEnabled: true,
    assistantModeConfigured: true,
    heartbeatEnabled: false,
    heartbeatInterval: "30m",
    cronEnabled: false,
    cronRuntime: {
      scheduler: {
        enabled: true,
        running: false,
        activeRuns: 0,
      },
      totals: {
        totalJobs: 2,
        enabledJobs: 1,
        disabledJobs: 1,
        staggeredJobs: 0,
        invalidNextRunJobs: 1,
      },
      sessionTargetCounts: {
        main: 1,
        isolated: 0,
      },
      deliveryModeCounts: {
        user: 1,
        none: 0,
      },
      failureDestinationModeCounts: {
        user: 1,
        none: 0,
      },
      recentJobs: [],
      headline: "warn",
    },
    externalOutboundRequireConfirmation: true,
  });

  expect(report.explanation).toMatchObject({
    blockedReason: "assistant mode is enabled, but heartbeat and cron are both off",
    attentionReason: "1 enabled cron job(s) currently have no nextRunAtMs",
  });
  expect(report.attentionItems).toEqual([
    {
      kind: "cron_invalid_next_run",
      summary: "1 enabled cron job(s) currently have no nextRunAtMs",
    },
  ]);
});

test("assistant mode runtime includes pending outbound confirmations in attention items", () => {
  const report = buildAssistantModeRuntimeReport({
    assistantModeEnabled: true,
    assistantModeConfigured: true,
    heartbeatEnabled: true,
    heartbeatInterval: "30m",
    cronEnabled: true,
    externalOutboundRuntime: {
      available: true,
      requireConfirmation: true,
      health: {
        status: "warn",
        activeFailure: false,
        recoveredAfterFailure: false,
        latestRecordAt: 1710001000000,
        latestSentAt: 1710001000000,
      },
      totals: {
        totalRecords: 2,
        pendingConfirmationCount: 1,
        confirmedCount: 1,
        autoApprovedCount: 0,
        rejectedCount: 0,
        sentCount: 1,
        failedCount: 0,
        resolveFailedCount: 0,
        deliveryFailedCount: 0,
      },
      channelCounts: {
        qq: 2,
      },
      errorCodeCounts: {},
      failureStageCounts: {
        resolve: 0,
        delivery: 0,
        confirmation: 0,
      },
      recentFailures: [],
      recentPending: [
        {
          requestId: "confirm-1",
          createdAt: 1710001000000,
          expiresAt: 1710001600000,
          conversationId: "conv-pending-1",
          requestedByAgentId: "default",
          targetChannel: "qq",
          requestedSessionKey: "channel=qq:chat=chat-1",
          targetSessionKey: "channel=qq:chat=chat-1",
          contentPreview: "please follow up",
        },
      ],
      headline: "records=2; pending=1; sent=1; failed=0; confirm=required",
    },
    externalOutboundRequireConfirmation: true,
  });

  expect(report.attentionItems).toContainEqual({
    kind: "pending_confirmation",
    summary: "1 outbound confirmation(s) pending; latest qq request confirm-1",
    targetId: "conv-pending-1",
    targetType: "conversation",
  });
});

test("assistant mode runtime includes long task summary and attention fallback", () => {
  const report = buildAssistantModeRuntimeReport({
    heartbeatEnabled: false,
    heartbeatInterval: "30m",
    cronEnabled: false,
    delegationObservability: {
      summary: {
        totalCount: 2,
        protocolBackedCount: 1,
        completedCount: 2,
        activeCount: 0,
        sourceCounts: {
          goal_subtask: 1,
        },
        aggregationModeCounts: {
          main_agent_summary: 1,
        },
        headline: "delegation protocol=1/2; active=0; completed=2; sources=goal_subtask:1",
      },
      items: [
        {
          taskId: "subtask-2",
          agentId: "coder",
          status: "interrupted",
          source: "goal_subtask",
          aggregationMode: "main_agent_summary",
          expectedDeliverableSummary: "返回治理摘要",
          intentSummary: "整理工具治理摘要",
        },
        {
          taskId: "subtask-1",
          agentId: "researcher",
          status: "done",
        },
      ],
    },
    externalOutboundRequireConfirmation: true,
  });

  expect(report.longTasks).toMatchObject({
    totalCount: 2,
    activeCount: 0,
    protocolBackedCount: 1,
    headline: "delegation protocol=1/2; active=0; completed=2; sources=goal_subtask:1",
    primary: {
      taskId: "subtask-2",
      agentId: "coder",
      status: "interrupted",
      source: "goal_subtask",
      aggregationMode: "main_agent_summary",
      intentSummary: "整理工具治理摘要",
      expectedDeliverableSummary: "返回治理摘要",
    },
  });
  expect(report.status).toBe("disabled");
  expect(report.explanation).toMatchObject({
    attentionReason: "整理工具治理摘要: interrupted",
  });
  expect(report.focus).toMatchObject({
    summary: "整理工具治理摘要, status=interrupted, deliverable=返回治理摘要",
  });
  expect(report.attentionItems).toContainEqual({
    kind: "long_task_attention",
    summary: "整理工具治理摘要: interrupted, deliverable=返回治理摘要",
  });
});

test("assistant mode runtime maps goal summary into focus and attention", () => {
  const goals: AssistantModeGoalRuntimeSummary = {
    totalCount: 2,
    activeCount: 2,
    blockedCount: 1,
    pendingApprovalCount: 0,
    reviewingCount: 0,
    headline: "goals=2; active=2; blocked=1; pendingApproval=0; reviewing=0",
    primary: {
      goalId: "goal_review",
      title: "Review Flow",
      status: "blocked",
      activeConversationId: "goal:review",
      summary: "当前 goal 处于阻塞态，优先解除关键节点阻塞。",
      nextAction: "先解除 review 节点的阻塞，再继续推进。",
      blockerSummary: "等待用户确认策略",
      checkpointSummary: "等待用户确认当前评审策略",
      targetId: "goal:review",
      targetType: "conversation",
    },
  };

  const report = buildAssistantModeRuntimeReport({
    heartbeatEnabled: true,
    heartbeatInterval: "30m",
    cronEnabled: false,
    goals,
    externalOutboundRequireConfirmation: true,
  });

  expect(report.goals).toMatchObject(goals);
  expect(report.status).toBe("attention");
  expect(report.explanation).toMatchObject({
    nextAction: {
      summary: "Wait for the next heartbeat window (30m)",
    },
    attentionReason: "Review Flow: 等待用户确认策略",
  });
  expect(report.focus).toMatchObject({
    summary: "先解除 review 节点的阻塞，再继续推进。, status=blocked",
    targetId: "goal:review",
    targetType: "conversation",
  });
  expect(report.attentionItems).toContainEqual({
    kind: "goal_attention",
    summary: "Review Flow: 等待用户确认策略",
    targetId: "goal:review",
    targetType: "conversation",
  });
});

test("assistant mode runtime prefers resident focus over passive next action fallback", () => {
  const residentAgents = {
    summary: {
      totalCount: 1,
      activeCount: 1,
      runningCount: 0,
      idleCount: 1,
      backgroundCount: 0,
      errorCount: 0,
      digestReadyCount: 0,
      digestUpdatedCount: 1,
      digestIdleCount: 0,
      digestMissingCount: 0,
      recentTaskLinkedCount: 0,
      recentSubtaskLinkedCount: 0,
      experienceUsageLinkedCount: 0,
      catalogAnnotatedCount: 0,
      structuredHandoffCount: 0,
      skillHintedCount: 0,
      headline: "1 resident agent(s), active=1, running=0, idle=1",
      sharedReadEnabledCount: 0,
      memoryModeCounts: {
        isolated: 1,
        shared: 0,
        hybrid: 0,
      },
      writeTargetCounts: {
        private: 1,
        shared: 0,
      },
      workspaceBindingCounts: {
        current: 1,
        explicit: 0,
      },
      sharedGovernanceCounts: {
        pendingCount: 0,
        claimedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        revokedCount: 0,
      },
    },
    agents: [
      {
        id: "default",
        displayName: "Belldandy",
        sessionNamespace: "default",
        memoryMode: "isolated",
        status: "idle",
        conversationDigest: {
          conversationId: "agent:default:main",
          status: "updated",
          messageCount: 2,
          pendingMessageCount: 2,
          threshold: 2,
          lastDigestAt: 1710000000000,
        },
        memoryPolicy: {
          agentId: "default",
          workspaceDir: "E:/state/agents/default",
          memoryMode: "isolated",
          privateStateDir: "E:/state/agents/default",
          privateMemoryDir: "E:/state/agents/default/memory",
          sessionNamespace: "default",
          writeTarget: "private",
          readTargets: ["private"],
          summary: "private only",
        },
        sharedGovernance: {
          pendingCount: 0,
          claimedCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
          revokedCount: 0,
        },
        continuationState: {
          version: 1,
          scope: "background",
          targetId: "agent:default:main",
          recommendedTargetId: "agent:default:main",
          targetType: "conversation",
          resumeMode: "resident_conversation",
          summary: "Resident follow-up",
          nextAction: "Continue resident follow-up",
          checkpoints: {
            openCount: 0,
            blockerCount: 0,
            labels: [],
          },
          progress: {
            current: "resident:followup",
            recent: ["resident:followup"],
          },
        },
      },
    ],
  } as any;

  const report = buildAssistantModeRuntimeReport({
    heartbeatEnabled: true,
    heartbeatInterval: "30m",
    cronEnabled: false,
    residentAgents,
    externalOutboundRequireConfirmation: true,
  });

  expect(report.explanation).toMatchObject({
    nextAction: {
      summary: "Wait for the next heartbeat window (30m)",
    },
  });
  expect(report.focus).toMatchObject({
    summary: "Continue resident follow-up",
    targetId: "agent:default:main",
    targetType: "conversation",
  });
});
