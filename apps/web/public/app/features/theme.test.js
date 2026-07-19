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

  it("owns transition state and the toggle listener across activation cycles", () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    document.body.appendChild(button);
    const controller = createThemeController({ toggleButtonEl: button });

    button.click();
    expect(controller.getTheme()).toBe("light");
    const timerCountBeforeDeactivate = vi.getTimerCount();
    expect(controller.deactivate()).toBe(true);
    expect(controller.deactivate()).toBe(false);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 0,
      disposed: false,
    });
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
    expect(vi.getTimerCount()).toBe(timerCountBeforeDeactivate - 1);

    document.documentElement.dataset.theme = "dark";
    button.textContent = "stale";
    localStorage.setItem("ss-webchat-theme", "retained");
    button.click();
    controller.setTheme("dark");
    controller.toggle();
    controller.refreshLabels();
    expect(controller.getTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(button.textContent).toBe("stale");
    expect(localStorage.getItem("ss-webchat-theme")).toBe("retained");

    expect(controller.activate()).toBe(true);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 1,
      disposed: false,
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(button.textContent).toBe("Dark");
    expect(localStorage.getItem("ss-webchat-theme")).toBe("retained");
    button.click();
    expect(controller.getTheme()).toBe("dark");
    expect(localStorage.getItem("ss-webchat-theme")).toBe("dark");
    expect(controller.getRuntimeSnapshot().activeTimerCount).toBe(1);

    const timerCountBeforeDispose = vi.getTimerCount();
    controller.dispose();
    controller.dispose();
    expect(controller.activate()).toBe(false);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 0,
      disposed: true,
    });
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
    expect(vi.getTimerCount()).toBe(timerCountBeforeDispose - 1);

    button.click();
    controller.setTheme("light");
    controller.toggle();
    controller.refreshLabels();
    expect(controller.getTheme()).toBe("dark");
  });
});
