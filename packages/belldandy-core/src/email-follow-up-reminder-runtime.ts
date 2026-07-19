import type { ConversationStore } from "@belldandy/agent";
import type { GatewayEventFrame } from "@belldandy/protocol";

import type { EmailInboundTriageResult } from "./email-inbound-triage.js";
import type { EmailFollowUpReminderRecord, EmailFollowUpReminderStore } from "./email-follow-up-reminder-store.js";
import type { TopLevelConversationLease, TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

type ReminderLogger = {
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstLine(value: unknown): string {
  return normalizeString(value).split("\n")[0] || "";
}

export async function scheduleEmailFollowUpReminder(input: {
  reminderStore?: EmailFollowUpReminderStore;
  event: {
    providerId: string;
    accountId: string;
    threadId: string;
    messageId: string;
    subject?: string;
    receivedAt: number;
  };
  conversationId: string;
  requestedAgentId: string;
  triage: EmailInboundTriageResult;
}): Promise<EmailFollowUpReminderRecord | undefined> {
  if (!input.reminderStore) return undefined;
  if (input.triage.needsFollowUp !== true || typeof input.triage.followUpWindowHours !== "number") {
    return undefined;
  }
  return input.reminderStore.upsert({
    providerId: input.event.providerId,
    accountId: input.event.accountId,
    threadId: input.event.threadId,
    conversationId: input.conversationId,
    requestedAgentId: input.requestedAgentId,
    messageId: input.event.messageId,
    subject: input.event.subject,
    triageSummary: input.triage.summary,
    suggestedReplyStarter: input.triage.suggestedReplyStarter,
    followUpWindowHours: input.triage.followUpWindowHours,
    sourceReceivedAt: input.event.receivedAt,
    dueAt: input.event.receivedAt + (input.triage.followUpWindowHours * 60 * 60 * 1000),
  });
}

export function buildEmailFollowUpReminderMessage(reminder: EmailFollowUpReminderRecord): string {
  const lines = [
    "邮件跟进提醒",
    `这条线程已到建议跟进时间（${reminder.followUpWindowHours}h）。`,
    reminder.subject ? `主题: ${reminder.subject}` : "",
    reminder.triageSummary ? `整理摘要: ${reminder.triageSummary}` : "",
    reminder.suggestedReplyStarter ? `建议回复 starter: ${firstLine(reminder.suggestedReplyStarter)}` : "",
    `send_email.threadId: ${reminder.threadId}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export async function processDueEmailFollowUpReminders(input: {
  reminderStore?: EmailFollowUpReminderStore;
  conversationStore: ConversationStore;
  topLevelConversationLifecycle?: TopLevelConversationLifecycle;
  broadcastEvent?: (frame: GatewayEventFrame) => void;
  logger: ReminderLogger;
  now?: number;
  limit?: number;
}): Promise<number> {
  if (!input.reminderStore) return 0;
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const reminders = await input.reminderStore.listDue(now, input.limit ?? 20);
  let delivered = 0;
  for (const reminder of reminders) {
    let lifecycleLease: TopLevelConversationLease | undefined;
    try {
      lifecycleLease = input.topLevelConversationLifecycle
        ? await input.topLevelConversationLifecycle.acquire({
            conversationId: reminder.conversationId,
            owners: [{
              key: input.conversationStore,
              priority: 100,
              release: () => input.conversationStore.releaseConversation(reminder.conversationId),
            }],
          })
        : undefined;
      const text = buildEmailFollowUpReminderMessage(reminder);
      const assistantMessage = input.conversationStore.addMessage(reminder.conversationId, "assistant", text, {
        agentId: reminder.requestedAgentId || "default",
        channel: "email_followup",
        timestampMs: now,
      });
      await input.conversationStore.waitForPendingPersistence(reminder.conversationId);
      input.broadcastEvent?.({
        type: "event",
        event: "chat.final",
        payload: {
          agentId: reminder.requestedAgentId || "default",
          conversationId: reminder.conversationId,
          role: "assistant",
          text,
          messageMeta: {
            timestampMs: assistantMessage.timestamp,
            isLatest: true,
          },
        },
      });
      await input.reminderStore.markDelivered({
        id: reminder.id,
        deliveredAt: assistantMessage.timestamp,
      });
      delivered += 1;
    } catch (error) {
      input.logger.warn("email-followup", "Failed to deliver due follow-up reminder", {
        id: reminder.id,
        conversationId: reminder.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await lifecycleLease?.release();
    }
  }
  if (delivered > 0) {
    input.logger.info("email-followup", `Delivered ${delivered} due follow-up reminder(s)`);
  }
  return delivered;
}
