// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createThemeController } from "./theme.js";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.body.replaceChildren();
  localStorage.clear();
});

describe("theme controller lifecycle", () => {
  it("replaces the transition timer on rapid theme changes", async () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    const controller = createThemeController({ toggleButtonEl: button });

    controller.setTheme("light");
    await vi.advanceTimersByTimeAsync(120);
    controller.setTheme("dark");
    await vi.advanceTimersByTimeAsync(120);

    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(true);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 1,
      listenerCount: 1,
      disposed: false,
    });
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(120);
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
    expect(controller.getRuntimeSnapshot().activeTimerCount).toBe(0);
  });

  it("removes transition state and the toggle listener on dispose", () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    document.body.appendChild(button);
    const controller = createThemeController({ toggleButtonEl: button });

    button.click();
    expect(controller.getTheme()).toBe("light");
    const timerCountBeforeDispose = vi.getTimerCount();
    controller.dispose();
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 0,
      disposed: true,
    });
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
    expect(vi.getTimerCount()).toBe(timerCountBeforeDispose - 1);

    button.click();
    controller.setTheme("dark");
    expect(controller.getTheme()).toBe("light");
  });
});
