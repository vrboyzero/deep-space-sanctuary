import { describe, expect, it, vi } from "vitest";

import { createWebchatPerformanceObservability } from "./webchat-performance-observability.js";

class FakePerformanceObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakePerformanceObserver.instances.push(this);
  }

  observe(options) {
    this.options = options;
  }

  disconnect() {
    this.disconnected = true;
  }

  emit(entries) {
    this.callback({ getEntries: () => entries });
  }
}

function createStartupHarness() {
  const listeners = new Set();
  return {
    parseStartedAtMs: 10,
    marks: [{
      stage: "index.inline-bootstrap.start",
      atMs: 12,
      referrer: "https://private.example.test/path?token=secret",
    }],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(entry) {
      this.marks.push(entry);
      for (const listener of listeners) {
        listener(entry);
      }
    },
  };
}

describe("webchat performance observability", () => {
  it("records bounded 10/100/1000 render fixtures without retaining page content or URLs", () => {
    FakePerformanceObserver.instances = [];
    const startup = createStartupHarness();
    let clock = 20;
    const performanceApi = {
      now: () => clock,
      mark: vi.fn(),
      measure: vi.fn(),
      clearMarks: vi.fn(),
      clearMeasures: vi.fn(),
      getEntriesByType: vi.fn(() => [{
        type: "navigate",
        domInteractive: 18,
        domContentLoadedEventEnd: 24,
        loadEventEnd: 31,
        duration: 32,
        transferSize: 2048,
        decodedBodySize: 4096,
        referrer: "https://private.example.test/never-retain",
      }]),
    };
    const observability = createWebchatPerformanceObservability({
      startup,
      performanceApi,
      PerformanceObserverCtor: FakePerformanceObserver,
    });

    observability.start();
    startup.emit({
      stage: "chat-network.websocket.open",
      atMs: 22,
      url: "wss://example.test/?token=secret",
    });
    for (const [renderedChars, durationMs] of [[10, 2], [100, 10], [1000, 100]]) {
      observability.measureStreamingRender({ kind: "delta", renderedChars }, () => {
        clock += durationMs;
      });
    }

    const longTaskObserver = FakePerformanceObserver.instances.find((item) => item.options?.type === "longtask");
    const interactionObserver = FakePerformanceObserver.instances.find((item) => item.options?.type === "event");
    longTaskObserver.emit([{ duration: 80, attribution: [{ name: "ignored" }] }]);
    interactionObserver.emit([{ name: "click", duration: 24, target: { textContent: "secret" } }]);

    const summary = observability.getSummary();
    expect(summary).toMatchObject({
      available: true,
      sampling: { running: true },
      startup: {
        markCount: 2,
        navigation: {
          type: "navigate",
          durationMs: 32,
          transferSize: 2048,
        },
      },
      streaming: {
        renderCount: 3,
        totalRenderedChars: 1110,
        p50Ms: 10,
        p95Ms: 100,
        maxMs: 100,
      },
      longTasks: {
        supported: true,
        count: 1,
        p95Ms: 80,
      },
      interactions: {
        supported: true,
        count: 1,
        p95Ms: 24,
      },
    });
    expect(summary.streaming.recent.map((item) => item.renderedChars)).toEqual([10, 100, 1000]);
    expect(summary.interactions.recent).toEqual([{ name: "click", durationMs: 24 }]);
    expect(JSON.stringify(summary)).not.toContain("private.example.test");
    expect(JSON.stringify(summary)).not.toContain("token=secret");
    expect(performanceApi.measure).toHaveBeenCalledTimes(3);

    observability.dispose();
    expect(longTaskObserver.disconnected).toBe(true);
    expect(interactionObserver.disconnected).toBe(true);
    startup.emit({ stage: "after.dispose", atMs: 999 });
    expect(observability.getSummary().startup.markCount).toBe(2);
  });

  it("caps retained render samples and silently degrades when PerformanceObserver is unavailable", () => {
    const observability = createWebchatPerformanceObservability({
      startup: { marks: [] },
      performanceApi: { now: () => 1 },
      PerformanceObserverCtor: null,
      maxRenderSamples: 2,
    });

    observability.start();
    observability.recordStreamingRender({ kind: "delta", renderedChars: 1, durationMs: 1 });
    observability.recordStreamingRender({ kind: "delta", renderedChars: 2, durationMs: 2 });
    observability.recordStreamingRender({ kind: "final", renderedChars: 3, durationMs: 3 });

    const summary = observability.getSummary();
    expect(summary.streaming).toMatchObject({
      renderCount: 3,
      totalRenderedChars: 6,
      recent: [
        { kind: "delta", renderedChars: 2, durationMs: 2 },
        { kind: "final", renderedChars: 3, durationMs: 3 },
      ],
    });
    expect(summary.longTasks.supported).toBe(false);
    expect(summary.interactions.supported).toBe(false);
  });
});
