import crypto from "node:crypto";

import type { ToolExecutionRuntimeContext, ToolExecutor } from "@belldandy/skills";

type StarweaverNotificationItem = {
  notificationId?: string;
  recommendedPeek?: string;
  signalKind?: string;
  actorId?: string;
  sessionId?: string;
  gameId?: string;
  sourceMessageId?: string;
  sourceDeliveryId?: string;
  sourceEventId?: string;
  createdAt?: string;
};

function readEnvFlag(name: string): boolean {
  return String(process.env[name] ?? "false").trim().toLowerCase() === "true";
}

function readEnvPositiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function extractJsonValue(text: string): unknown {
  let current: unknown = text;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "string") {
      return current;
    }
    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }
  return current;
}

function isNotificationLikeRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return [
    "notificationId",
    "signalKind",
    "recommendedPeek",
    "sourceMessageId",
    "sourceDeliveryId",
    "sourceEventId",
    "actorId",
    "sessionId",
    "gameId",
    "createdAt",
  ].some((key) => typeof record[key] === "string");
}

function readNotificationItemsSource(source: unknown): unknown[] {
  if (Array.isArray(source)) {
    if (source.length > 0 && source.every((item) => isNotificationLikeRecord(item))) {
      return source;
    }
    for (const item of source) {
      const nested = readNotificationItemsSource(item);
      if (nested.length > 0) {
        return nested;
      }
    }
    return [];
  }

  if (typeof source === "string") {
    const nested = extractJsonValue(source);
    if (nested !== null) {
      return readNotificationItemsSource(nested);
    }
    return [];
  }

  if (source && typeof source === "object") {
    const parsed = source as Record<string, unknown>;
    if (Array.isArray(parsed.items)) {
      return parsed.items;
    }

    const nestedKeys = ["structuredContent", "content", "output", "payload", "result", "data", "text"] as const;
    for (const key of nestedKeys) {
      const nested = readNotificationItemsSource(parsed[key]);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

function parseStarweaverNotificationItems(output: string): StarweaverNotificationItem[] {
  const parsed = extractJsonValue(output);
  const items = readNotificationItemsSource(parsed);
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      notificationId: typeof item.notificationId === "string" ? item.notificationId : undefined,
      recommendedPeek: typeof item.recommendedPeek === "string" ? item.recommendedPeek : undefined,
      signalKind: typeof item.signalKind === "string" ? item.signalKind : undefined,
      actorId: typeof item.actorId === "string" ? item.actorId : undefined,
      sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
      gameId: typeof item.gameId === "string" ? item.gameId : undefined,
      sourceMessageId: typeof item.sourceMessageId === "string" ? item.sourceMessageId : undefined,
      sourceDeliveryId: typeof item.sourceDeliveryId === "string" ? item.sourceDeliveryId : undefined,
      sourceEventId: typeof item.sourceEventId === "string" ? item.sourceEventId : undefined,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
    }));
}

function buildNotificationFingerprint(items: StarweaverNotificationItem[]): string {
  return JSON.stringify(items.map((item) => ({
    notificationId: item.notificationId || "",
    sourceMessageId: item.sourceMessageId || "",
    sourceDeliveryId: item.sourceDeliveryId || "",
    sourceEventId: item.sourceEventId || "",
    createdAt: item.createdAt || "",
    signalKind: item.signalKind || "",
    recommendedPeek: item.recommendedPeek || "",
    actorId: item.actorId || "",
    sessionId: item.sessionId || "",
    gameId: item.gameId || "",
  })));
}

function buildReminderText(items: StarweaverNotificationItem[]): string {
  const lines = items.slice(0, 3).map((item) => {
    const signal = item.signalKind || "unknown_signal";
    const peek = item.recommendedPeek || "manual_check";
    const scope = [item.actorId, item.sessionId, item.gameId].filter(Boolean).join(" / ");
    return scope
      ? `- ${signal} -> ${peek} (${scope})`
      : `- ${signal} -> ${peek}`;
  });
  return [
    "StarWeaver 提醒：检测到新的 wake signal，正在主动处理。",
    ...lines,
  ].join("\n");
}

async function acknowledgeNotificationBatch(input: {
  toolExecutor: ToolExecutor;
  runtimeContext: ToolExecutionRuntimeContext;
  conversationId: string;
  items: StarweaverNotificationItem[];
  logger: {
    info: (module: string, message: string, data?: unknown) => void;
    warn: (module: string, message: string, data?: unknown) => void;
  };
}) {
  const notificationIds = Array.from(
    new Set(
      input.items
        .map((item) => item.notificationId?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  if (notificationIds.length <= 0) {
    return;
  }

  const acknowledgedAt = new Date().toISOString();
  const ackResult = await input.toolExecutor.execute(
    {
      id: crypto.randomUUID(),
      name: "mcp_starweaver_central_agent_wake_notifications",
      arguments: {
        notificationIds,
        ackMatched: true,
        acknowledgedAt,
        includeAcked: true,
        includeExpired: true,
        limit: notificationIds.length,
      },
    },
    input.conversationId,
    "default",
    undefined,
    undefined,
    undefined,
    input.runtimeContext,
  );

  input.logger.info("starweaver-active-notify", "Acknowledged StarWeaver notification batch after resident auto-run.", {
    notificationCount: notificationIds.length,
    success: ackResult.success,
  });
}

export async function startStarweaverActiveNotifyRuntime(input: {
  toolExecutor: ToolExecutor;
  isBusy: () => boolean;
  autoRunResidentAgent: (input: {
    agentId?: string;
    text: string;
    visibleReminder?: string;
  }) => Promise<{ conversationId: string; runId: string }>;
  logger: {
    info: (module: string, message: string, data?: unknown) => void;
    warn: (module: string, message: string, data?: unknown) => void;
    error: (module: string, message: string, data?: unknown) => void;
  };
}): Promise<{ close: () => void } | undefined> {
  if (!readEnvFlag("BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED")) {
    return undefined;
  }

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let lastFingerprint = "";
  let running = false;

  const poll = async () => {
    const busy = input.isBusy();
    if (stopped || running || busy) {
      if (!stopped && !running && busy) {
        input.logger.info("starweaver-active-notify", "Skipped poll because resident agent is busy.");
      }
      return;
    }
    running = true;
    try {
      const runtimeContext: ToolExecutionRuntimeContext = {
        channel: "gateway",
        launchSpec: {
          agentId: "default",
          profileId: "default",
        },
      };
      const notificationsResult = await input.toolExecutor.execute(
        {
          id: crypto.randomUUID(),
          name: "mcp_starweaver_central_agent_wake_notifications",
          arguments: { limit: 3 },
        },
        "agent:default:main",
        "default",
        undefined,
        undefined,
        undefined,
        runtimeContext,
      );
      if (!notificationsResult.success || !notificationsResult.output) {
        input.logger.info("starweaver-active-notify", "Notification poll returned no usable output.", {
          success: notificationsResult.success,
          hasOutput: Boolean(notificationsResult.output),
        });
        return;
      }
      const output = String(notificationsResult.output);
      const items = parseStarweaverNotificationItems(output);
      input.logger.info("starweaver-active-notify", "Notification poll parsed items.", {
        itemCount: items.length,
      });
      if (items.length <= 0) {
        return;
      }
      const fingerprint = buildNotificationFingerprint(items);
      if (fingerprint === lastFingerprint) {
        input.logger.info("starweaver-active-notify", "Skipped notification batch because fingerprint is unchanged.", {
          itemCount: items.length,
        });
        return;
      }
      const autoRunResult = await input.autoRunResidentAgent({
        agentId: "default",
        text: "请处理刚收到的 StarWeaver wake signal，并优先调用相应 peek 工具读取详情。",
        visibleReminder: buildReminderText(items),
      });
      await acknowledgeNotificationBatch({
        toolExecutor: input.toolExecutor,
        runtimeContext,
        conversationId: autoRunResult.conversationId,
        items,
        logger: {
          info: input.logger.info,
          warn: input.logger.warn,
        },
      });
      lastFingerprint = fingerprint;
      input.logger.info("starweaver-active-notify", "Triggered resident auto-run from new StarWeaver notification batch.", {
        notificationCount: items.length,
      });
    } catch (error) {
      input.logger.warn("starweaver-active-notify", "StarWeaver active notify poll failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  };

  const intervalMs = readEnvPositiveInt("BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS", 5000);
  timer = setInterval(() => {
    void poll();
  }, intervalMs);
  timer.unref?.();
  input.logger.info("starweaver-active-notify", `enabled (interval=${intervalMs}ms)`);
  return {
    close: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
      }
    },
  };
}
