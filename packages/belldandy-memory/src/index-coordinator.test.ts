import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexCoordinator } from "./index-coordinator.js";

describe("IndexCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shares one full scan across lazy and manual callers, then starts a new generation", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runFullScan = vi.fn()
      .mockImplementationOnce(async () => await firstGate)
      .mockResolvedValue(undefined);
    const coordinator = new IndexCoordinator({
      runFullScan,
      processWatchEvent: async () => {},
    });

    const first = coordinator.runFullScan();
    const joined = coordinator.runFullScan();

    expect(joined).toBe(first);
    expect(runFullScan).toHaveBeenCalledTimes(1);

    releaseFirst();
    await first;

    const nextGeneration = coordinator.runFullScan();
    expect(nextGeneration).not.toBe(first);
    await nextGeneration;
    expect(runFullScan).toHaveBeenCalledTimes(2);

    await coordinator.close();
  });

  it("keeps watch concurrency bounded while draining distinct paths", async () => {
    vi.useFakeTimers();
    let active = 0;
    let peakActive = 0;
    const releases: Array<() => void> = [];
    const processWatchEvent = vi.fn(async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });
    const coordinator = new IndexCoordinator({
      runFullScan: async () => {},
      processWatchEvent,
      watchCoalesceMs: 10,
      maxConcurrentWatchEvents: 2,
    });

    coordinator.enqueueWatchEvent("a.md", "upsert");
    coordinator.enqueueWatchEvent("b.md", "upsert");
    coordinator.enqueueWatchEvent("c.md", "upsert");
    await vi.advanceTimersByTimeAsync(10);

    expect(processWatchEvent).toHaveBeenCalledTimes(2);
    expect(peakActive).toBe(2);

    releases.splice(0).forEach((release) => release());
    await vi.runAllTimersAsync();
    expect(processWatchEvent).toHaveBeenCalledTimes(3);

    releases.splice(0).forEach((release) => release());
    await coordinator.close();
    expect(peakActive).toBe(2);
  });

  it("serializes a path and applies only the latest event queued behind an active flush", async () => {
    vi.useFakeTimers();
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const observed: string[] = [];
    const processWatchEvent = vi.fn(async (event: { kind: "upsert" | "remove" }) => {
      observed.push(event.kind);
      if (observed.length === 1) {
        await activeGate;
      }
    });
    const coordinator = new IndexCoordinator({
      runFullScan: async () => {},
      processWatchEvent,
      watchCoalesceMs: 10,
      maxConcurrentWatchEvents: 2,
    });

    coordinator.enqueueWatchEvent("memory.md", "upsert");
    await vi.advanceTimersByTimeAsync(10);
    expect(observed).toEqual(["upsert"]);

    coordinator.enqueueWatchEvent("memory.md", "remove");
    coordinator.enqueueWatchEvent("memory.md", "upsert");
    await vi.advanceTimersByTimeAsync(10);
    expect(observed).toEqual(["upsert"]);

    releaseActive();
    await vi.runAllTimersAsync();
    await coordinator.close();

    expect(observed).toEqual(["upsert", "upsert"]);
  });

  it("does not overlap a full scan with active or queued watch work", async () => {
    vi.useFakeTimers();
    let releaseActiveWatch!: () => void;
    const activeWatchGate = new Promise<void>((resolve) => {
      releaseActiveWatch = resolve;
    });
    let releaseFullScan!: () => void;
    const fullScanGate = new Promise<void>((resolve) => {
      releaseFullScan = resolve;
    });
    let markFullScanStarted!: () => void;
    const fullScanStarted = new Promise<void>((resolve) => {
      markFullScanStarted = resolve;
    });
    const processed: string[] = [];
    const processWatchEvent = vi.fn(async (event: { sourcePath: string }) => {
      processed.push(event.sourcePath);
      if (event.sourcePath === "active.md") {
        await activeWatchGate;
      }
    });
    const runFullScan = vi.fn(async () => {
      markFullScanStarted();
      await fullScanGate;
    });
    const coordinator = new IndexCoordinator({
      runFullScan,
      processWatchEvent,
      watchCoalesceMs: 10,
      maxConcurrentWatchEvents: 2,
    });

    coordinator.enqueueWatchEvent("active.md", "upsert");
    await vi.advanceTimersByTimeAsync(10);
    expect(processed).toEqual(["active.md"]);

    const scan = coordinator.runFullScan();
    coordinator.enqueueWatchEvent("queued.md", "remove");
    await vi.advanceTimersByTimeAsync(10);

    expect(runFullScan).not.toHaveBeenCalled();
    expect(processed).toEqual(["active.md"]);

    releaseActiveWatch();
    await fullScanStarted;
    expect(runFullScan).toHaveBeenCalledTimes(1);
    expect(processed).toEqual(["active.md"]);

    releaseFullScan();
    await scan;
    await Promise.resolve();
    expect(processed).toEqual(["active.md", "queued.md"]);

    await coordinator.close();
  });

  it("collapses a pending-path overflow into one full rescan after watch work drains", async () => {
    vi.useFakeTimers();
    let releaseWatch!: () => void;
    const watchGate = new Promise<void>((resolve) => {
      releaseWatch = resolve;
    });
    const processWatchEvent = vi.fn(async () => await watchGate);
    const runFullScan = vi.fn(async () => {});
    const coordinator = new IndexCoordinator({
      runFullScan,
      processWatchEvent,
      watchCoalesceMs: 10,
      maxPendingWatchPaths: 2,
      maxConcurrentWatchEvents: 1,
    });

    expect(coordinator.enqueueWatchEvent("a.md", "upsert")).toBe(true);
    expect(coordinator.enqueueWatchEvent("b.md", "upsert")).toBe(true);
    expect(coordinator.enqueueWatchEvent("c.md", "upsert")).toBe(false);
    expect(coordinator.enqueueWatchEvent("d.md", "remove")).toBe(false);
    await vi.advanceTimersByTimeAsync(10);

    expect(processWatchEvent).toHaveBeenCalledTimes(1);
    expect(runFullScan).not.toHaveBeenCalled();

    releaseWatch();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(processWatchEvent).toHaveBeenCalledTimes(2);
    expect(runFullScan).toHaveBeenCalledTimes(1);

    await coordinator.close();
  });

  it("stops accepting new events and drains accepted work during close", async () => {
    vi.useFakeTimers();
    const processed: string[] = [];
    const coordinator = new IndexCoordinator({
      runFullScan: async () => {},
      processWatchEvent: async (event) => {
        processed.push(event.sourcePath);
      },
      watchCoalesceMs: 1_000,
    });

    expect(coordinator.enqueueWatchEvent("accepted.md", "upsert")).toBe(true);
    const closing = coordinator.close();
    expect(coordinator.enqueueWatchEvent("late.md", "upsert")).toBe(false);
    await vi.runAllTimersAsync();
    await closing;

    expect(processed).toEqual(["accepted.md"]);
  });

  it("aborts an active watch flush after the close drain deadline", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const coordinator = new IndexCoordinator({
      runFullScan: async () => {},
      processWatchEvent: async (_event, signal) => {
        observedSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      watchCoalesceMs: 10,
      closeDrainTimeoutMs: 20,
    });

    coordinator.enqueueWatchEvent("active.md", "upsert");
    await vi.advanceTimersByTimeAsync(10);
    expect(observedSignal?.aborted).toBe(false);

    const closing = coordinator.close();
    await vi.advanceTimersByTimeAsync(20);
    await closing;

    expect(observedSignal?.aborted).toBe(true);
  });
});
