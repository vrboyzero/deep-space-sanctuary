import { describe, expect, it, vi } from "vitest";

import { ChannelIngressScheduler } from "./channel-ingress-scheduler.js";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushScheduler(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ChannelIngressScheduler", () => {
  it("keeps one session ordered while allowing another session to run", async () => {
    const scheduler = new ChannelIngressScheduler({
      maxConcurrent: 2,
      maxConcurrentPerChannel: 2,
    });
    const first = createDeferred();
    const other = createDeferred();
    const started: string[] = [];

    const firstResult = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:dm:one",
      run: async () => {
        started.push("first");
        await first.promise;
      },
    });
    const secondResult = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:dm:one",
      run: () => {
        started.push("second");
      },
    });
    const otherResult = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:dm:two",
      run: async () => {
        started.push("other");
        await other.promise;
      },
    });

    expect(firstResult.accepted).toBe(true);
    expect(secondResult.accepted).toBe(true);
    expect(otherResult.accepted).toBe(true);
    if (!firstResult.accepted || !secondResult.accepted || !otherResult.accepted) return;

    await flushScheduler();
    expect(started).toEqual(["first", "other"]);

    first.resolve();
    other.resolve();
    await Promise.all([firstResult.completion, secondResult.completion, otherResult.completion]);
    expect(started).toEqual(["first", "other", "second"]);
  });

  it("round-robins ready sessions instead of letting one session monopolize the queue", async () => {
    const scheduler = new ChannelIngressScheduler({ maxConcurrent: 1 });
    const first = createDeferred();
    const secondSession = createDeferred();
    const started: string[] = [];

    const firstResult = scheduler.enqueue({
      channel: "qq",
      sessionKey: "qq:group:one",
      run: async () => {
        started.push("one-first");
        await first.promise;
      },
    });
    const sameSessionResult = scheduler.enqueue({
      channel: "qq",
      sessionKey: "qq:group:one",
      run: () => {
        started.push("one-second");
      },
    });
    const otherSessionResult = scheduler.enqueue({
      channel: "qq",
      sessionKey: "qq:group:two",
      run: async () => {
        started.push("two-first");
        await secondSession.promise;
      },
    });

    if (!firstResult.accepted || !sameSessionResult.accepted || !otherSessionResult.accepted) return;
    await flushScheduler();
    expect(started).toEqual(["one-first"]);

    first.resolve();
    await flushScheduler();
    expect(started).toEqual(["one-first", "two-first"]);

    secondSession.resolve();
    await Promise.all([firstResult.completion, sameSessionResult.completion, otherSessionResult.completion]);
    expect(started).toEqual(["one-first", "two-first", "one-second"]);
  });

  it("enforces the per-channel limit without blocking another channel's available slot", async () => {
    const scheduler = new ChannelIngressScheduler({
      maxConcurrent: 2,
      maxConcurrentPerChannel: 1,
    });
    const discordFirst = createDeferred();
    const qqFirst = createDeferred();
    const started: string[] = [];

    const firstDiscord = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:one",
      run: async () => {
        started.push("discord-first");
        await discordFirst.promise;
      },
    });
    const secondDiscord = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:two",
      run: () => {
        started.push("discord-second");
      },
    });
    const firstQq = scheduler.enqueue({
      channel: "qq",
      sessionKey: "qq:one",
      run: async () => {
        started.push("qq-first");
        await qqFirst.promise;
      },
    });

    if (!firstDiscord.accepted || !secondDiscord.accepted || !firstQq.accepted) return;
    await flushScheduler();
    expect(started).toEqual(["discord-first", "qq-first"]);

    discordFirst.resolve();
    await flushScheduler();
    expect(started).toEqual(["discord-first", "qq-first", "discord-second"]);

    qqFirst.resolve();
    await Promise.all([firstDiscord.completion, secondDiscord.completion, firstQq.completion]);
  });

  it("coalesces duplicate message events without retaining a second task", async () => {
    const scheduler = new ChannelIngressScheduler({ maxConcurrent: 1 });
    const pending = createDeferred();
    let invocationCount = 0;

    const first = scheduler.enqueue({
      channel: "feishu",
      sessionKey: "feishu:dm:one",
      dedupeKey: "message-1",
      run: async () => {
        invocationCount += 1;
        await pending.promise;
      },
    });
    const duplicate = scheduler.enqueue({
      channel: "feishu",
      sessionKey: "feishu:dm:one",
      dedupeKey: "message-1",
      run: () => {
        invocationCount += 1;
      },
    });

    expect(first).toMatchObject({ accepted: true, coalesced: false });
    expect(duplicate).toMatchObject({ accepted: true, coalesced: true });
    if (!first.accepted || !duplicate.accepted) return;

    await flushScheduler();
    expect(invocationCount).toBe(1);
    expect(scheduler.getRuntimeSnapshots()[0]).toMatchObject({ activeCount: 1, queuedCount: 0 });

    pending.resolve();
    await Promise.all([first.completion, duplicate.completion]);
    expect(invocationCount).toBe(1);
  });

  it("rejects bounded queues and expires work that waited too long", async () => {
    let now = 0;
    const scheduler = new ChannelIngressScheduler({
      maxConcurrent: 1,
      maxPendingPerSession: 1,
      maxWaitMs: 10,
      now: () => now,
    });
    const active = createDeferred();
    let expiredHandlerRan = false;

    const running = scheduler.enqueue({
      channel: "community",
      sessionKey: "community:room:one",
      run: async () => {
        await active.promise;
      },
    });
    const expired = scheduler.enqueue({
      channel: "community",
      sessionKey: "community:room:one",
      run: () => {
        expiredHandlerRan = true;
      },
    });
    const rejected = scheduler.enqueue({
      channel: "community",
      sessionKey: "community:room:one",
      run: () => undefined,
    });

    expect(rejected).toEqual(expect.objectContaining({
      accepted: false,
      reason: "session_queue_full",
    }));
    if (!running.accepted || !expired.accepted) return;

    await flushScheduler();
    now = 11;
    active.resolve();
    await expect(running.completion).resolves.toEqual({ status: "completed" });
    await expect(expired.completion).resolves.toEqual({ status: "expired", waitedMs: 11 });
    expect(expiredHandlerRan).toBe(false);
    expect(scheduler.getRuntimeSnapshots()[0]).toMatchObject({
      activeCount: 0,
      queuedCount: 0,
      rejectedCount: 2,
    });
  });

  it("expires queued work while a slow active task still holds the only slot", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const scheduler = new ChannelIngressScheduler({
        maxConcurrent: 1,
        maxWaitMs: 10,
        now: () => now,
      });
      const active = createDeferred();
      const running = scheduler.enqueue({
        channel: "feishu",
        sessionKey: "feishu:active",
        run: async () => {
          await active.promise;
        },
      });
      const expired = scheduler.enqueue({
        channel: "feishu",
        sessionKey: "feishu:waiting",
        run: () => undefined,
      });
      if (!running.accepted || !expired.accepted) return;

      await flushScheduler();
      now = 11;
      await vi.advanceTimersByTimeAsync(11);
      await expect(expired.completion).resolves.toEqual({ status: "expired", waitedMs: 11 });
      expect(scheduler.getRuntimeSnapshots()[0]).toMatchObject({ activeCount: 1, queuedCount: 0 });

      active.resolve();
      await running.completion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels queued work for a stopped channel and releases capacity after handler failures", async () => {
    const scheduler = new ChannelIngressScheduler({ maxConcurrent: 1 });
    const active = createDeferred();
    let cancelledHandlerRan = false;

    const running = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:dm:one",
      run: async () => {
        await active.promise;
      },
    });
    const cancelled = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:dm:two",
      run: () => {
        cancelledHandlerRan = true;
      },
    });
    if (!running.accepted || !cancelled.accepted) return;

    await flushScheduler();
    expect(scheduler.cancelChannel("discord")).toBe(1);
    await expect(cancelled.completion).resolves.toEqual({ status: "cancelled", reason: "channel_stopped" });
    expect(cancelledHandlerRan).toBe(false);

    active.resolve();
    await running.completion;

    const failed = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:dm:three",
      run: () => {
        throw new Error("handler failed");
      },
    });
    const later = scheduler.enqueue({
      channel: "discord",
      sessionKey: "discord:dm:four",
      run: () => undefined,
    });
    if (!failed.accepted || !later.accepted) return;

    await expect(failed.completion).rejects.toThrow("handler failed");
    await expect(later.completion).resolves.toEqual({ status: "completed" });
    expect(scheduler.getRuntimeSnapshots()[0]).toMatchObject({ activeCount: 0, queuedCount: 0 });
  });

  it("bounds a 1000-message burst and keeps session identifiers out of diagnostics", async () => {
    const scheduler = new ChannelIngressScheduler({
      maxConcurrent: 1,
      maxQueued: 16,
      maxPendingPerSession: 1_000,
    });
    const active = createDeferred();
    const running = scheduler.enqueue({
      channel: "community",
      sessionKey: "burst-active",
      run: async () => {
        await active.promise;
      },
    });
    expect(running.accepted).toBe(true);

    let acceptedCount = running.accepted ? 1 : 0;
    let rejectedCount = 0;
    for (let index = 0; index < 1_000; index += 1) {
      const result = scheduler.enqueue({
        channel: "community",
        sessionKey: `burst-session-${index}`,
        run: () => undefined,
      });
      if (result.accepted) {
        acceptedCount += 1;
      } else {
        rejectedCount += 1;
      }
    }

    const snapshot = scheduler.getRuntimeSnapshots()[0];
    expect(acceptedCount).toBe(17);
    expect(rejectedCount).toBe(984);
    expect(snapshot).toMatchObject({
      activeCount: 1,
      queuedCount: 16,
      rejectedCount: 984,
      aggregate: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("burst-session-");

    expect(scheduler.cancelChannel("community")).toBe(16);
    if (running.accepted) {
      active.resolve();
      await running.completion;
    }
  });
});
