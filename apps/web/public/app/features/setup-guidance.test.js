import { afterEach, describe, expect, it, vi } from "vitest";

import { createSetupGuidanceFeature } from "./setup-guidance.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("setup guidance lifecycle", () => {
  it("replaces delayed guidance across hello generations", async () => {
    vi.useFakeTimers();
    const openGuidance = vi.fn();
    const feature = createSetupGuidanceFeature({ openGuidance });

    feature.schedule();
    feature.schedule();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 1,
      disposed: false,
    });
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(openGuidance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(openGuidance).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().activeTimerCount).toBe(0);
  });

  it("owns delayed guidance across activation cycles and terminal dispose", async () => {
    vi.useFakeTimers();
    const openGuidance = vi.fn();
    const feature = createSetupGuidanceFeature({ openGuidance });

    feature.schedule();
    feature.clear();
    await vi.advanceTimersByTimeAsync(500);
    expect(openGuidance).not.toHaveBeenCalled();

    feature.schedule();
    expect(feature.deactivate()).toBe(true);
    expect(feature.deactivate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      disposed: false,
    });
    expect(vi.getTimerCount()).toBe(0);
    feature.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(openGuidance).not.toHaveBeenCalled();

    expect(feature.activate()).toBe(true);
    feature.schedule();
    feature.schedule();
    expect(feature.getRuntimeSnapshot().activeTimerCount).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(openGuidance).toHaveBeenCalledTimes(1);

    feature.schedule();
    feature.dispose();
    feature.schedule();
    expect(feature.activate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(openGuidance).toHaveBeenCalledTimes(1);
  });
});
