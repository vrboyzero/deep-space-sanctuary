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

  it("cancels delayed guidance on config recovery or dispose", async () => {
    vi.useFakeTimers();
    const openGuidance = vi.fn();
    const feature = createSetupGuidanceFeature({ openGuidance });

    feature.schedule();
    feature.clear();
    await vi.advanceTimersByTimeAsync(500);
    expect(openGuidance).not.toHaveBeenCalled();

    feature.schedule();
    feature.dispose();
    feature.schedule();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(openGuidance).not.toHaveBeenCalled();
  });
});
