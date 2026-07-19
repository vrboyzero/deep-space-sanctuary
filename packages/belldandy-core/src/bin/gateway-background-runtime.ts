import type { BelldandyAgent } from "@belldandy/agent";
import type { BackgroundRunClaimCoordinator } from "../background-run-coordinator.js";
import type { BelldandyLogger } from "../logger/index.js";
import type { ResidentConversationStore } from "../resident-conversation-store.js";
import { deliverAutoMessageToResidentChannel } from "../auto-chat-delivery.js";
import {
  BackgroundContinuationLedger,
} from "../background-continuation-runtime.js";
import type { BackgroundRecoveryRuntime } from "../background-recovery-runtime.js";
import {
  startHeartbeatRunner,
  type HeartbeatRunnerHandle,
} from "../heartbeat/index.js";
import {
  CronStore,
  startCronScheduler,
  type CronGoalApprovalScanPayload,
  type CronJob,
  type CronSchedulerHandle,
} from "../cron/index.js";
import type { GoalManager } from "../goals/manager.js";
import { RelayServer, resolveRelayCredential } from "@belldandy/browser";

function parseIntervalMs(raw: string): number {
  const match = /^(\d+)(m|h|s)?$/.exec(raw.trim().toLowerCase());
  if (!match) return 30 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2] || "m";
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    default: return value * 60 * 1000;
  }
}

function parseActiveHours(raw: string | undefined): { start: string; end: string } | undefined {
  if (!raw) return undefined;
  const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(raw.trim());
  if (!match) return undefined;
  return { start: match[1], end: match[2] };
}

type GatewayBackgroundLogger = Pick<BelldandyLogger, "info" | "warn" | "error" | "child">;

export async function startHeartbeatRuntime(input: {
  enabled: boolean;
  createAgent?: () => BelldandyAgent;
  heartbeatIntervalRaw: string;
  heartbeatActiveHoursRaw?: string;
  stateDir: string;
  conversationStore: ResidentConversationStore;
  broadcast: (frame: unknown) => void;
  deliverToLatestBoundExternalChannel: (source: "heartbeat" | "cron", message: string) => Promise<boolean>;
  backgroundContinuationLedger: BackgroundContinuationLedger;
  backgroundRecoveryRuntime?: Pick<BackgroundRecoveryRuntime, "maybeRecover">;
  runCoordinator?: BackgroundRunClaimCoordinator;
  isBusy: () => boolean;
  onFinalizedRun?: (input: {
    status: "ran" | "skipped" | "failed";
    conversationId?: string;
    runId?: string;
    reason?: string;
    message?: string;
  }) => Promise<void> | void;
  logger: GatewayBackgroundLogger;
}): Promise<HeartbeatRunnerHandle | undefined> {
  if (!input.enabled) {
    return undefined;
  }
  if (!input.createAgent) {
    input.logger.warn("heartbeat", "enabled but no Agent configured (provider not openai?), skipping.");
    return undefined;
  }

  try {
    const heartbeatAgent = input.createAgent();
    const intervalMs = parseIntervalMs(input.heartbeatIntervalRaw);
    const activeHours = parseActiveHours(input.heartbeatActiveHoursRaw);

    const sendMessage = async (messageInput: { prompt: string; conversationId: string; runId: string }): Promise<string> => {
      let result = "";
      for await (const item of heartbeatAgent.run({
        conversationId: messageInput.conversationId,
        text: messageInput.prompt,
      })) {
        if (item.type === "delta") {
          result += item.delta;
        } else if (item.type === "final") {
          result = item.text;
        }
      }
      return result;
    };

    const deliverToUser = async (message: string): Promise<void> => {
      deliverAutoMessageToResidentChannel({
        conversationStore: input.conversationStore,
        broadcast: (frame) => input.broadcast(frame),
        agentId: "default",
        text: `❤️ [Heartbeat] ${message}`,
      });

      await input.deliverToLatestBoundExternalChannel("heartbeat", message);
    };

    const heartbeatRunner = startHeartbeatRunner({
      intervalMs,
      workspaceDir: input.stateDir,
      sendMessage,
      deliverToUser,
      activeHours,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isBusy: input.isBusy,
      runCoordinator: input.runCoordinator,
      log: (message) => input.logger.info("heartbeat", message),
      onRunEvent: async (event) => {
        if (event.phase === "started") {
          await input.backgroundContinuationLedger.startRun({
            runId: event.runId,
            kind: "heartbeat",
            sourceId: "heartbeat",
            label: "Heartbeat",
            conversationId: event.conversationId,
            startedAt: event.startedAt,
          });
          return;
        }
        const finalized = await input.backgroundContinuationLedger.finishRun({
          runId: event.runId,
          kind: "heartbeat",
          sourceId: "heartbeat",
          label: "Heartbeat",
          status: event.result.status === "failed"
            ? "failed"
            : event.result.status === "skipped"
              ? "skipped"
              : "ran",
          summary: event.result.message,
          reason: event.result.reason,
          conversationId: event.conversationId,
          startedAt: event.startedAt,
          finishedAt: event.finishedAt,
        });
        if (finalized.status === "failed") {
          await input.backgroundRecoveryRuntime?.maybeRecover(finalized);
        }
        await input.onFinalizedRun?.({
          status: event.result.status,
          conversationId: event.conversationId,
          runId: event.runId,
          reason: event.result.reason,
          message: event.result.message,
        });
      },
    });

    input.logger.info("heartbeat", `enabled (interval=${input.heartbeatIntervalRaw}, activeHours=${input.heartbeatActiveHoursRaw ?? "all"})`);
    return heartbeatRunner;
  } catch {
    input.logger.warn("heartbeat", "Agent creation failed (likely missing config), skipping Heartbeat startup.");
    return undefined;
  }
}

export async function startCronRuntime(input: {
  enabled: boolean;
  createAgent?: () => BelldandyAgent;
  heartbeatActiveHoursRaw?: string;
  cronStore: CronStore;
  conversationStore: ResidentConversationStore;
  broadcast: (frame: unknown) => void;
  deliverToLatestBoundExternalChannel: (source: "heartbeat" | "cron", message: string) => Promise<boolean>;
  backgroundContinuationLedger: BackgroundContinuationLedger;
  backgroundRecoveryRuntime?: Pick<BackgroundRecoveryRuntime, "maybeRecover">;
  goalManager: GoalManager;
  runCoordinator?: BackgroundRunClaimCoordinator;
  isBusy: () => boolean;
  onFinalizedRun?: (input: {
    status: "ok" | "skipped" | "error";
    sourceId: string;
    label: string;
    conversationId?: string;
    sessionTarget?: "main" | "isolated";
    runId?: string;
    reason?: string;
    summary?: string;
  }) => Promise<void> | void;
  logger: GatewayBackgroundLogger;
}): Promise<CronSchedulerHandle | undefined> {
  if (!input.enabled) {
    input.logger.info("cron", "scheduler disabled (set BELLDANDY_CRON_ENABLED=true to enable)");
    return undefined;
  }

  const activeHours = parseActiveHours(input.heartbeatActiveHoursRaw);

  let cronSendMessage:
    ((job: CronJob, prompt: string) => Promise<string | { text: string; conversationId?: string }>)
    | undefined;
  if (input.createAgent) {
    try {
      const cronAgent = input.createAgent();
      cronSendMessage = async (job, prompt: string): Promise<{ text: string; conversationId: string }> => {
        let result = "";
        const conversationId = job.sessionTarget === "main"
          ? `cron-main:${job.id}`
          : `cron-run:${job.id}:${Date.now()}`;
        for await (const item of cronAgent.run({
          conversationId,
          text: prompt,
        })) {
          if (item.type === "delta") {
            result += item.delta;
          } else if (item.type === "final") {
            result = item.text;
          }
        }
        return {
          text: result,
          conversationId,
        };
      };
    } catch {
      input.logger.warn("cron", "Agent creation failed; systemEvent cron jobs will be disabled, but structured approval scan jobs remain available.");
    }
  } else {
    input.logger.info("cron", "No Agent configured; systemEvent cron jobs are disabled, but structured approval scan jobs remain available.");
  }

  const cronDeliverToUser = async (message: string): Promise<void> => {
    deliverAutoMessageToResidentChannel({
      conversationStore: input.conversationStore,
      broadcast: (frame) => input.broadcast(frame),
      agentId: "default",
      text: message,
    });
    await input.deliverToLatestBoundExternalChannel("cron", message);
  };

  const runGoalApprovalScan = async (payload: CronGoalApprovalScanPayload): Promise<{ summary: string; notifyMessage?: string }> => {
    const requestedGoalIds = [
      payload.goalId?.trim(),
      ...(payload.goalIds ?? []).map((goalId) => goalId.trim()).filter(Boolean),
    ].filter(Boolean) as string[];
    const listedGoals = payload.allGoals ? await input.goalManager.listGoals() : [];
    const goalIds = Array.from(new Set([
      ...requestedGoalIds,
      ...listedGoals.map((goal) => goal.id),
    ]));
    if (goalIds.length === 0) {
      return {
        summary: "approval_scan goals=0 ok=0 failed=0 review_overdue=0 review_escalated=0 checkpoint_overdue=0 checkpoint_escalated=0 notifications=0",
      };
    }

    let reviewOverdue = 0;
    let reviewEscalated = 0;
    let checkpointOverdue = 0;
    let checkpointEscalated = 0;
    let notifications = 0;
    const failures: Array<{ goalId: string; error: string }> = [];

    for (const goalId of goalIds) {
      try {
        const result = await input.goalManager.scanApprovalWorkflows(goalId, {
          autoEscalate: payload.autoEscalate ?? true,
        });
        reviewOverdue += result.reviewResult.overdueCount;
        reviewEscalated += result.reviewResult.escalatedCount;
        checkpointOverdue += result.checkpointItems.filter((item) => item.overdue).length;
        checkpointEscalated += result.checkpointItems.filter((item) => item.escalated).length;
        notifications += result.notifications.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ goalId, error: message });
        input.logger.warn("cron", `Approval scan failed for goal "${goalId}": ${message}`);
      }
    }

    const summary = [
      `approval_scan goals=${goalIds.length}`,
      `ok=${goalIds.length - failures.length}`,
      `failed=${failures.length}`,
      `review_overdue=${reviewOverdue}`,
      `review_escalated=${reviewEscalated}`,
      `checkpoint_overdue=${checkpointOverdue}`,
      `checkpoint_escalated=${checkpointEscalated}`,
      `notifications=${notifications}`,
    ].join(" ");
    const shouldNotify = failures.length > 0
      || reviewOverdue > 0
      || reviewEscalated > 0
      || checkpointOverdue > 0
      || checkpointEscalated > 0
      || notifications > 0;
    const notifyMessage = shouldNotify
      ? [
        `审批扫描完成：${summary}`,
        failures.length > 0 ? `失败目标：${failures.map((item) => item.goalId).join(", ")}` : "",
      ].filter(Boolean).join("\n")
      : undefined;
    return { summary, notifyMessage };
  };

  const cronSchedulerHandle = startCronScheduler({
    store: input.cronStore,
    sendMessage: cronSendMessage,
    runGoalApprovalScan,
    deliverToUser: cronDeliverToUser,
    activeHours,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isBusy: input.isBusy,
    runCoordinator: input.runCoordinator,
    log: (message) => input.logger.info("cron", message),
    onExecutionEvent: async (event) => {
      if (event.phase === "started") {
        await input.backgroundContinuationLedger.startRun({
          runId: event.runId,
          kind: "cron",
          sourceId: event.jobId,
          label: event.jobName,
          conversationId: event.conversationId,
          sessionTarget: event.sessionTarget,
          startedAt: event.startedAt,
        });
        return;
      }
      const finalized = await input.backgroundContinuationLedger.finishRun({
        runId: event.runId,
        kind: "cron",
        sourceId: event.jobId,
        label: event.jobName,
        status: event.status === "error"
          ? "failed"
          : event.status === "skipped"
            ? "skipped"
            : "ran",
        summary: event.summary,
        reason: event.reason,
        conversationId: event.conversationId,
        sessionTarget: event.sessionTarget,
        startedAt: event.startedAt,
        finishedAt: event.finishedAt,
        nextRunAtMs: event.nextRunAtMs,
      });
      if (finalized.status === "failed") {
        await input.backgroundRecoveryRuntime?.maybeRecover(finalized);
      }
      await input.onFinalizedRun?.({
        status: event.status,
        sourceId: event.jobId,
        label: event.jobName,
        conversationId: event.conversationId,
        sessionTarget: event.sessionTarget,
        runId: event.runId,
        reason: event.reason,
        summary: event.summary,
      });
    },
  });

  input.logger.info(
    "cron",
    `scheduler enabled (activeHours=${input.heartbeatActiveHoursRaw ?? "all"}, systemEvent=${cronSendMessage ? "enabled" : "disabled"}, structured=goalApprovalScan)`,
  );
  return cronSchedulerHandle;
}

export async function startBrowserRelayRuntime(input: {
  enabled: boolean;
  port: number;
  stateDir: string;
  configuredToken?: string;
  logger: GatewayBackgroundLogger;
}): Promise<void> {
  if (!input.enabled) {
    return;
  }
  const relayLogger = input.logger.child("browser-relay");
  try {
    const credential = await resolveRelayCredential({
      stateDir: input.stateDir,
      configuredToken: input.configuredToken,
    });
    // Browser tools read the token dynamically from process.env; never write it to logs or WebChat config.
    process.env.BELLDANDY_RELAY_TOKEN = credential.token;
    const relay = new RelayServer(input.port, { token: credential.token }, relayLogger);
    await relay.start();
    input.logger.info("browser-relay", `enabled (port=${relay.port}, credential=${credential.source})`);
  } catch (error) {
    input.logger.error("browser-relay", "Relay Error", error);
  }
}
