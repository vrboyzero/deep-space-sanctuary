// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppShellFeature } from "./app-shell.js";

function createHarness() {
  return createAppShellFeature({
    refs: {},
    getTreeMode: () => "root",
    subtasksState: {},
  });
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("app shell notice lifecycle", () => {
  it("cancels removal timers when notices are dismissed or acted on", async () => {
    vi.useFakeTimers();
    const feature = createHarness();
    const onAction = vi.fn();

    feature.showNotice("Dismiss", "body", "info", 3_200);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeNoticeCount: 1,
      activeTimerCount: 1,
      disposed: false,
    });
    document.querySelector(".notice-close-btn").click();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeNoticeCount: 0,
      activeTimerCount: 0,
    });

    feature.showNotice("Action", "body", "info", 3_200, {
      actionLabel: "Open",
      onAction,
    });
    document.querySelector(".notice-action-btn").click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeNoticeCount: 0,
      activeTimerCount: 0,
    });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(document.querySelectorAll(".notice-item")).toHaveLength(0);
  });

  it("removes active notices and action listeners on dispose", () => {
    vi.useFakeTimers();
    const feature = createHarness();
    const onAction = vi.fn();

    feature.showNotice("Timed", "body", "info", 3_200);
    feature.showNotice("Persistent", "body", "info", 0, {
      actionLabel: "Open",
      onAction,
    });
    const detachedActionButton = document.querySelector(".notice-action-btn");
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeNoticeCount: 2,
      activeTimerCount: 1,
      disposed: false,
    });

    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeNoticeCount: 0,
      activeTimerCount: 0,
      disposed: true,
    });
    expect(document.getElementById("noticeStack")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    detachedActionButton.click();
    feature.showNotice("Late", "body");
    expect(onAction).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".notice-item")).toHaveLength(0);
  });
});
