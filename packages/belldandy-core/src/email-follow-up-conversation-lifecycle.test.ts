import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi, type MockInstance } from "vitest";

import { ConversationStore } from "@belldandy/agent";
import {
  createFileEmailFollowUpReminderStore,
  resolveEmailFollowUpReminderStorePath,
  type EmailFollowUpReminderStore,
} from "./email-follow-up-reminder-store.js";
import {
  processDueEmailFollowUpReminders,
  scheduleEmailFollowUpReminder,
} from "./email-follow-up-reminder-runtime.js";
import { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => (
    fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  )));
});

test("Email follow-up reminders hold a Store-only lifecycle lease", async () => {
  const fixture = await createReminderFixture("success");
  const writeLeaseCounts: number[] = [];
  const addMessageOriginal = fixture.conversationStore.addMessage.bind(fixture.conversationStore);
  vi.spyOn(fixture.conversationStore, "addMessage").mockImplementation((...args) => {
    writeLeaseCounts.push(fixture.lifecycle.getRuntimeSnapshot().activeLeaseCount);
    return addMessageOriginal(...args);
  });

  const delivered = await processDueEmailFollowUpReminders({
    reminderStore: fixture.reminderStore,
    conversationStore: fixture.conversationStore,
    topLevelConversationLifecycle: fixture.lifecycle,
    broadcastEvent: vi.fn(),
    logger: createLogger(),
    now: fixture.now,
  });

  expect(delivered).toBe(1);
  expect(writeLeaseCounts).toEqual([1]);
  expect(fixture.releaseStore).toHaveBeenCalledWith(fixture.conversationId);
  expect(fixture.lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeConversationCount: 0,
    activeLeaseCount: 0,
    retainedConversationCount: 0,
    pendingReleaseCount: 0,
    evictedCount: 1,
    releaseFailureCount: 0,
  });
});

test("Email follow-up broadcast failures still release the Store lease", async () => {
  const fixture = await createReminderFixture("failure");
  const logger = createLogger();

  const delivered = await processDueEmailFollowUpReminders({
    reminderStore: fixture.reminderStore,
    conversationStore: fixture.conversationStore,
    topLevelConversationLifecycle: fixture.lifecycle,
    broadcastEvent: () => {
      throw new Error("follow-up-broadcast-failed");
    },
    logger,
    now: fixture.now,
  });

  expect(delivered).toBe(0);
  expect(logger.warn).toHaveBeenCalledWith(
    "email-followup",
    "Failed to deliver due follow-up reminder",
    expect.objectContaining({ error: "follow-up-broadcast-failed" }),
  );
  expect((await fixture.reminderStore.listRecent(1))[0]?.status).toBe("pending");
  expect(fixture.releaseStore).toHaveBeenCalledWith(fixture.conversationId);
  expect(fixture.lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeLeaseCount: 0,
    retainedConversationCount: 0,
    pendingReleaseCount: 0,
    evictedCount: 1,
    releaseFailureCount: 0,
  });
});

async function createReminderFixture(suffix: string): Promise<{
  now: number;
  conversationId: string;
  reminderStore: EmailFollowUpReminderStore;
  conversationStore: ConversationStore;
  lifecycle: TopLevelConversationLifecycle;
  releaseStore: MockInstance<(id: string) => Promise<void>>;
}> {
  const now = Date.now();
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), `belldandy-email-followup-${suffix}-`));
  tempDirs.push(stateDir);
  const conversationId = `channel=email:scope=thread:${suffix}`;
  const reminderStore = createFileEmailFollowUpReminderStore(resolveEmailFollowUpReminderStorePath(stateDir));
  await scheduleEmailFollowUpReminder({
    reminderStore,
    event: {
      providerId: "imap",
      accountId: "primary",
      threadId: `<thread-${suffix}@example.com>`,
      messageId: `<msg-${suffix}@example.com>`,
      subject: "Lifecycle reminder",
      receivedAt: now - (25 * 60 * 60 * 1000),
    },
    conversationId,
    requestedAgentId: "default",
    triage: {
      category: "reply_required",
      priority: "high",
      disposition: "reply",
      summary: "needs follow-up",
      rationale: ["direct request"],
      needsReply: true,
      needsFollowUp: true,
      followUpWindowHours: 24,
      suggestedReplyWarnings: [],
      suggestedReplyChecklist: [],
    },
  });
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const lifecycle = new TopLevelConversationLifecycle({
    idleTtlMs: 60_000,
    maxIdleConversations: 0,
    startTimer: false,
  });
  const releaseStoreOriginal = conversationStore.releaseConversation.bind(conversationStore);
  const releaseStore = vi.spyOn(conversationStore, "releaseConversation").mockImplementation(async (id) => {
    await releaseStoreOriginal(id);
  });
  return {
    now,
    conversationId,
    reminderStore,
    conversationStore,
    lifecycle,
    releaseStore,
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
