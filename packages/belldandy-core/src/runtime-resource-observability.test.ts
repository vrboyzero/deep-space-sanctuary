import { expect, test, vi } from "vitest";

import { RuntimeResourceObservability } from "./runtime-resource-observability.js";

test("runtime resource observability keeps bounded resource samples and aggregate-only queue snapshots", () => {
  let now = 1_000;
  const histogram = {
    min: 2_000_000,
    mean: 5_000_000,
    max: 12_000_000,
    percentile: (percentile: number) => percentile === 95 ? 10_000_000 : 4_000_000,
    enable: vi.fn(),
    disable: vi.fn(),
    reset: vi.fn(),
  };
  const intervalHandle = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
  const setIntervalFn = vi.fn(() => intervalHandle);
  const clearIntervalFn = vi.fn();
  const collector = new RuntimeResourceObservability({
    sampleIntervalMs: 1_000,
    maxSamples: 2,
    now: () => now,
    memoryUsage: () => ({
      rss: 128,
      heapTotal: 96,
      heapUsed: 64,
      external: 12,
      arrayBuffers: 4,
    }),
    eventLoopPerformance: {
      eventLoopUtilization: (previous) => previous
        ? { idle: 60, active: 40, utilization: 0.4 }
        : { idle: 0, active: 0, utilization: 0 },
    },
    createEventLoopDelayHistogram: () => histogram,
    setIntervalFn,
    clearIntervalFn,
    queueProviders: [() => [
      { id: "subagent", activeCount: 2, queuedCount: 3, capacity: 10, oldestWaitMs: 120, rejectedCount: 2 },
      { id: "websocket", activeCount: 5, queuedCount: 0, oldestWaitMs: 30, rejectedCount: 1 },
    ]],
  });

  collector.start();
  now += 1_000;
  collector.sampleNow();
  now += 1_000;
  collector.sampleNow();

  const summary = collector.getSummary();
  expect(summary).toMatchObject({
    available: true,
    sampling: {
      running: true,
      sampleCount: 2,
      maxSamples: 2,
    },
    queueTotals: {
      queueCount: 2,
      activeCount: 7,
      queuedCount: 3,
      oldestWaitMs: 120,
      rejectedCount: 3,
    },
  });
  expect(summary.latest).toMatchObject({
    eventLoop: {
      utilization: 0.4,
      activeMs: 40,
      idleMs: 60,
      delay: {
        p50Ms: 4,
        p95Ms: 10,
        maxMs: 12,
      },
    },
    memory: {
      rssBytes: 128,
      heapUsedBytes: 64,
    },
    queues: [
      { id: "subagent", activeCount: 2, queuedCount: 3, capacity: 10, oldestWaitMs: 120, rejectedCount: 2 },
      { id: "websocket", activeCount: 5, queuedCount: 0, oldestWaitMs: 30, rejectedCount: 1 },
    ],
  });
  expect(JSON.stringify(summary)).not.toContain("conversationId");
  expect(histogram.enable).toHaveBeenCalledTimes(1);
  expect(histogram.reset).toHaveBeenCalledTimes(3);
  expect(intervalHandle.unref).toHaveBeenCalledTimes(1);

  collector.stop();
  expect(clearIntervalFn).toHaveBeenCalledWith(intervalHandle);
  expect(histogram.disable).toHaveBeenCalledTimes(1);
});

test("runtime resource observability can remain disabled without starting sampling work", () => {
  const createEventLoopDelayHistogram = vi.fn();
  const queueProvider = vi.fn(() => [{ id: "subagent", activeCount: 1, queuedCount: 1 }]);
  const setIntervalFn = vi.fn();
  const collector = new RuntimeResourceObservability({
    enabled: false,
    createEventLoopDelayHistogram,
    queueProviders: [queueProvider],
    setIntervalFn,
  });

  collector.start();
  expect(collector.sampleNow()).toBeUndefined();
  expect(collector.getSummary()).toMatchObject({
    available: false,
    headline: "Runtime resource sampling is disabled.",
    sampling: {
      running: false,
      sampleCount: 0,
    },
    queueTotals: {
      queueCount: 0,
      activeCount: 0,
      queuedCount: 0,
      oldestWaitMs: 0,
      rejectedCount: 0,
    },
  });
  expect(createEventLoopDelayHistogram).not.toHaveBeenCalled();
  expect(queueProvider).not.toHaveBeenCalled();
  expect(setIntervalFn).not.toHaveBeenCalled();
});

test("runtime resource observability bounds provider and overall queue snapshots", () => {
  const makeSnapshots = (prefix: string) => Array.from({ length: 20 }, (_, index) => ({
    id: `${prefix}-${index}`,
    activeCount: 1,
    queuedCount: 0,
    oldestWaitMs: 0,
    rejectedCount: 0,
  }));
  const collector = new RuntimeResourceObservability({
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
    queueProviders: [
      () => makeSnapshots("first"),
      () => makeSnapshots("second"),
      () => makeSnapshots("third"),
    ],
  });

  collector.sampleNow();

  const summary = collector.getSummary();
  expect(summary.latest?.queues).toHaveLength(32);
  expect(summary.queueTotals).toMatchObject({
    queueCount: 32,
    activeCount: 32,
    queuedCount: 0,
  });
  const queueIds = summary.latest?.queues.map((queue) => queue.id) ?? [];
  expect(queueIds).not.toContain("first-16");
  expect(queueIds).not.toContain("third-0");
});

test("runtime resource observability excludes display-only aggregate queue snapshots from totals", () => {
  const collector = new RuntimeResourceObservability({
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
    queueProviders: [() => [
      {
        id: "channel_ingress",
        activeCount: 3,
        queuedCount: 5,
        oldestWaitMs: 80,
        rejectedCount: 4,
        aggregate: true,
      },
      {
        id: "channel_ingress:discord",
        activeCount: 2,
        queuedCount: 3,
        oldestWaitMs: 80,
        rejectedCount: 3,
      },
      {
        id: "channel_ingress:qq",
        activeCount: 1,
        queuedCount: 2,
        oldestWaitMs: 30,
        rejectedCount: 1,
      },
    ]],
  });

  collector.sampleNow();

  expect(collector.getSummary().queueTotals).toEqual({
    queueCount: 2,
    activeCount: 3,
    queuedCount: 5,
    oldestWaitMs: 80,
    rejectedCount: 4,
  });
});
