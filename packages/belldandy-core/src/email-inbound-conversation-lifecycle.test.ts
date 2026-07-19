import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { type BelldandyAgent, ConversationStore } from "@belldandy/agent";
import type { NormalizedEmailInboundEvent } from "./email-inbound-contract.js";
import { ingestEmailInboundEvent } from "./email-inbound-ingress.js";
import {
  createFileEmailThreadBindingStore,
  resolveEmailThreadBindingStorePath,
} from "./email-thread-binding-store.js";
import { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => (
    fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  )));
});

test("same-thread Email runs share active leases until the final owner completes", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-lifecycle-"));
  tempDirs.push(stateDir);
  const order: string[] = [];
  const started = new Set<string>();
  const gates = new Map<string, () => void>();
  const lifecycle = new TopLevelConversationLifecycle({
    idleTtlMs: 60_000,
    maxIdleConversations: 0,
    startTimer: false,
  });
  const waitForGate = (messageId: string) => new Promise<void>((resolve) => {
    gates.set(messageId, resolve);
  });
  const agent: BelldandyAgent = {
    async *run(input) {
      const messageId = input.text.includes("<msg-001@example.com>")
        ? "<msg-001@example.com>"
        : "<msg-002@example.com>";
      const runPending = waitForGate(messageId);
      started.add(messageId);
      yield { type: "status", status: "running" };
      await runPending;
      yield { type: "final", text: `echo:${messageId}` };
      yield { type: "status", status: "done" };
    },
    releaseConversation: vi.fn(async () => {
      order.push("agent");
    }),
  };
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const writeLeaseCounts: number[] = [];
  const addMessageOriginal = conversationStore.addMessage.bind(conversationStore);
  vi.spyOn(conversationStore, "addMessage").mockImplementation((...args) => {
    writeLeaseCounts.push(lifecycle.getRuntimeSnapshot().activeLeaseCount);
    return addMessageOriginal(...args);
  });
  const releaseStoreOriginal = conversationStore.releaseConversation.bind(conversationStore);
  const releaseStore = vi.spyOn(conversationStore, "releaseConversation").mockImplementation(async (id) => {
    order.push("store");
    await releaseStoreOriginal(id);
  });
  const agentFactory = () => agent;
  const threadBindingStore = createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir));
  const context = {
    agentFactory,
    conversationStore,
    threadBindingStore,
    topLevelConversationLifecycle: lifecycle,
    log: {
      info() {},
      warn() {},
      error() {},
    },
  };

  const firstPending = ingestEmailInboundEvent(context, {
    event: createEmailEvent("<msg-001@example.com>"),
    requestedAgentId: "default",
  });
  await waitFor(() => started.has("<msg-001@example.com>"));
  expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeConversationCount: 1,
    activeLeaseCount: 1,
    retainedConversationCount: 1,
  });

  const secondPending = ingestEmailInboundEvent(context, {
    event: createEmailEvent("<msg-002@example.com>"),
    requestedAgentId: "default",
  });
  await waitFor(() => started.has("<msg-002@example.com>"));
  expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeConversationCount: 1,
    activeLeaseCount: 2,
    retainedConversationCount: 1,
  });
  expect(writeLeaseCounts.length).toBeGreaterThanOrEqual(2);
  expect(writeLeaseCounts.every((count) => count >= 1)).toBe(true);

  gates.get("<msg-001@example.com>")?.();
  const first = await firstPending;
  expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeConversationCount: 1,
    activeLeaseCount: 1,
    retainedConversationCount: 1,
  });
  expect(agent.releaseConversation).not.toHaveBeenCalled();
  expect(releaseStore).not.toHaveBeenCalled();

  gates.get("<msg-002@example.com>")?.();
  const second = await secondPending;
  await waitFor(() => releaseStore.mock.calls.length === 1);

  expect(first.conversationId).toBe(second.conversationId);
  expect(agent.releaseConversation).toHaveBeenCalledWith(first.conversationId);
  expect(releaseStore).toHaveBeenCalledWith(first.conversationId);
  expect(order).toEqual(["agent", "store"]);
  expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeConversationCount: 0,
    activeLeaseCount: 0,
    retainedConversationCount: 0,
    pendingReleaseCount: 0,
    evictedCount: 1,
    releaseFailureCount: 0,
  });
});

test("Email run failures still release Agent and Store owners", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-lifecycle-failure-"));
  tempDirs.push(stateDir);
  const order: string[] = [];
  const lifecycle = new TopLevelConversationLifecycle({
    idleTtlMs: 60_000,
    maxIdleConversations: 0,
    startTimer: false,
  });
  const agent: BelldandyAgent = {
    async *run() {
      throw new Error("email-agent-failed");
    },
    releaseConversation: vi.fn(async () => {
      order.push("agent");
    }),
  };
  const conversationStore = new ConversationStore({
    dataDir: path.join(stateDir, "sessions"),
  });
  const releaseStoreOriginal = conversationStore.releaseConversation.bind(conversationStore);
  const releaseStore = vi.spyOn(conversationStore, "releaseConversation").mockImplementation(async (id) => {
    order.push("store");
    await releaseStoreOriginal(id);
  });

  await expect(ingestEmailInboundEvent({
    agentFactory: () => agent,
    conversationStore,
    threadBindingStore: createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir)),
    topLevelConversationLifecycle: lifecycle,
    log: {
      info() {},
      warn() {},
      error() {},
    },
  }, {
    event: createEmailEvent("<msg-failure@example.com>"),
    requestedAgentId: "default",
  })).rejects.toThrow("email-agent-failed");

  expect(agent.releaseConversation).toHaveBeenCalledTimes(1);
  expect(releaseStore).toHaveBeenCalledTimes(1);
  expect(order).toEqual(["agent", "store"]);
  expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
    activeLeaseCount: 0,
    retainedConversationCount: 0,
    pendingReleaseCount: 0,
    evictedCount: 1,
    releaseFailureCount: 0,
  });
});

function createEmailEvent(messageId: string): NormalizedEmailInboundEvent {
  return {
    providerId: "imap",
    accountId: "primary",
    messageId,
    threadId: "<thread-lifecycle@example.com>",
    receivedAt: Date.parse("2026-07-18T05:30:00.000Z"),
    subject: "Lifecycle fixture",
    from: [{ address: "alice@example.com", name: "Alice" }],
    to: [{ address: "team@example.com" }],
    cc: [],
    bcc: [],
    replyTo: [],
    textBody: `Please process ${messageId}`,
    attachments: [],
    references: [],
    headers: {},
    metadata: {},
    security: {
      sourceTrust: "external_untrusted",
      sanitationRequired: true,
      externalLabels: [],
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Email lifecycle fixture");
}
