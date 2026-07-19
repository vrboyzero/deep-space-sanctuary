import { describe, expect, it, vi } from "vitest";

import { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";

describe("TopLevelConversationLifecycle", () => {
  it("pins active conversations and evicts the least recently idle entry over capacity", async () => {
    let now = 0;
    const releaseFirst = vi.fn();
    const releaseSecond = vi.fn();
    const lifecycle = new TopLevelConversationLifecycle({
      idleTtlMs: 1_000,
      maxIdleConversations: 1,
      now: () => now,
      startTimer: false,
    });

    const first = await lifecycle.acquire({
      conversationId: "conversation-first",
      owners: [{ key: releaseFirst, release: releaseFirst }],
    });
    const second = await lifecycle.acquire({
      conversationId: "conversation-second",
      owners: [{ key: releaseSecond, release: releaseSecond }],
    });

    await first.release();
    expect(releaseFirst).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      activeConversationCount: 1,
      activeLeaseCount: 1,
      idleConversationCount: 1,
      retainedConversationCount: 2,
    });

    now = 10;
    await second.release();

    expect(releaseFirst).toHaveBeenCalledOnce();
    expect(releaseSecond).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      activeConversationCount: 0,
      activeLeaseCount: 0,
      idleConversationCount: 1,
      retainedConversationCount: 1,
      pendingReleaseCount: 0,
      evictedCount: 1,
      releaseFailureCount: 0,
      oldestIdleAgeMs: 0,
    });
  });

  it("deduplicates owners and releases agent state before the conversation store after TTL", async () => {
    let now = 100;
    const order: string[] = [];
    const agentOwner = {};
    const storeOwner = {};
    const lifecycle = new TopLevelConversationLifecycle({
      idleTtlMs: 50,
      maxIdleConversations: 8,
      now: () => now,
      startTimer: false,
    });
    const lease = await lifecycle.acquire({
      conversationId: "conversation-ttl",
      owners: [{
        key: storeOwner,
        priority: 100,
        release: () => { order.push("store"); },
      }],
    });
    lease.addOwner({
      key: agentOwner,
      priority: 0,
      release: () => { order.push("agent-old"); },
    });
    lease.addOwner({
      key: agentOwner,
      priority: 0,
      release: () => { order.push("agent"); },
    });
    await lease.release();

    now = 149;
    await lifecycle.sweep();
    expect(order).toEqual([]);

    now = 150;
    await lifecycle.sweep();
    expect(order).toEqual(["agent", "store"]);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 0,
      evictedCount: 1,
    });
  });

  it("waits for pending cleanup before a new lease takes over the same conversation", async () => {
    let resolveCleanup: (() => void) | undefined;
    const cleanupPending = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const lifecycle = new TopLevelConversationLifecycle({
      idleTtlMs: 1_000,
      maxIdleConversations: 0,
      startTimer: false,
    });
    const oldLease = await lifecycle.acquire({
      conversationId: "conversation-takeover",
      owners: [{ key: cleanupPending, release: () => cleanupPending }],
    });

    const oldRelease = oldLease.release();
    await vi.waitFor(() => expect(lifecycle.getRuntimeSnapshot().pendingReleaseCount).toBe(1));

    let acquired = false;
    const newLeasePending = lifecycle.acquire({
      conversationId: "conversation-takeover",
      owners: [{ key: lifecycle, release: vi.fn() }],
    }).then((lease) => {
      acquired = true;
      return lease;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);

    resolveCleanup?.();
    await oldRelease;
    const newLease = await newLeasePending;

    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      activeConversationCount: 1,
      activeLeaseCount: 1,
      retainedConversationCount: 1,
      pendingReleaseCount: 0,
      evictedCount: 1,
    });

    await newLease.release();
    expect(lifecycle.getRuntimeSnapshot().retainedConversationCount).toBe(0);
  });

  it("isolates owner failures and still releases later owners", async () => {
    const releaseStore = vi.fn();
    const lifecycle = new TopLevelConversationLifecycle({
      maxIdleConversations: 0,
      startTimer: false,
    });
    const lease = await lifecycle.acquire({
      conversationId: "conversation-release-failure",
      owners: [
        {
          key: lifecycle,
          priority: 0,
          release: () => { throw new Error("agent cleanup failed"); },
        },
        {
          key: releaseStore,
          priority: 100,
          release: releaseStore,
        },
      ],
    });

    await expect(lease.release()).resolves.toBeUndefined();

    expect(releaseStore).toHaveBeenCalledOnce();
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      retainedConversationCount: 0,
      evictedCount: 1,
      releaseFailureCount: 1,
    });
  });

  it("does not issue a new lease after dispose wins a pending-cleanup race", async () => {
    let resolveCleanup: (() => void) | undefined;
    const cleanupPending = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const lifecycle = new TopLevelConversationLifecycle({
      maxIdleConversations: 0,
      startTimer: false,
    });
    const lease = await lifecycle.acquire({
      conversationId: "conversation-dispose-race",
      owners: [{ key: cleanupPending, release: () => cleanupPending }],
    });
    const release = lease.release();
    await vi.waitFor(() => expect(lifecycle.getRuntimeSnapshot().pendingReleaseCount).toBe(1));
    const acquire = lifecycle.acquire({ conversationId: "conversation-dispose-race" })
      .then(() => "acquired", (error: unknown) => error);
    const dispose = lifecycle.dispose();

    resolveCleanup?.();
    await release;
    await dispose;

    await expect(acquire).resolves.toEqual(expect.objectContaining({
      message: "top_level_conversation_lifecycle_disposed",
    }));
  });
});
