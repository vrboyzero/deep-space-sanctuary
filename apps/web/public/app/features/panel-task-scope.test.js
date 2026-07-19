// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPanelTaskScope } from "./panel-task-scope.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("PanelTaskScope lifecycle", () => {
  it("replaces the active generation and releases its signal, timer, and listener", async () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const firstTimer = vi.fn();
    const scope = createPanelTaskScope();

    expect(scope.activate()).toBe(true);
    scope.addEventListener(button, "click", firstListener);
    scope.setTimeout(firstTimer, 100);
    const firstTask = scope.beginTask();
    expect(firstTask.signal.aborted).toBe(false);

    expect(scope.activate()).toBe(true);
    expect(firstTask.signal.aborted).toBe(true);
    scope.addEventListener(button, "click", secondListener);
    button.click();
    await vi.advanceTimersByTimeAsync(100);

    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(firstTimer).not.toHaveBeenCalled();
    expect(firstTask.commit(vi.fn())).toBe(false);
    expect(scope.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 1,
      pendingTaskCount: 1,
      active: true,
      disposed: false,
    });

    firstTask.settle();
    firstTask.settle();
    expect(scope.getRuntimeSnapshot().pendingTaskCount).toBe(0);
  });

  it("allows only the latest task in one activation to commit", () => {
    const scope = createPanelTaskScope();
    scope.activate();
    const firstTask = scope.beginTask();
    const secondTask = scope.beginTask();
    const firstCommit = vi.fn();
    const secondCommit = vi.fn();

    expect(firstTask.commit(firstCommit)).toBe(false);
    expect(secondTask.commit(secondCommit)).toBe(true);
    expect(firstCommit).not.toHaveBeenCalled();
    expect(secondCommit).toHaveBeenCalledTimes(1);

    firstTask.settle();
    secondTask.settle();
    expect(scope.getRuntimeSnapshot().pendingTaskCount).toBe(0);
  });

  it("invalidates task commits without ending the active signal", () => {
    const scope = createPanelTaskScope();
    scope.activate();
    const staleTask = scope.beginTask();
    const staleCommit = vi.fn();

    expect(scope.invalidateTasks()).toBe(true);
    expect(staleTask.signal.aborted).toBe(false);
    expect(staleTask.commit(staleCommit)).toBe(false);
    expect(staleCommit).not.toHaveBeenCalled();

    const currentTask = scope.beginTask();
    const currentCommit = vi.fn();
    expect(currentTask.signal).toBe(staleTask.signal);
    expect(currentTask.commit(currentCommit)).toBe(true);
    expect(currentCommit).toHaveBeenCalledTimes(1);
    expect(scope.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 0,
      pendingTaskCount: 2,
      active: true,
      disposed: false,
    });

    staleTask.settle();
    currentTask.settle();
    scope.deactivate();
    expect(scope.invalidateTasks()).toBe(false);
  });

  it("deactivates repeatedly but makes dispose terminal", async () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    const listener = vi.fn();
    const timer = vi.fn();
    const scope = createPanelTaskScope();

    scope.activate();
    scope.addEventListener(button, "click", listener);
    scope.setTimeout(timer, 100);
    const task = scope.beginTask();
    expect(scope.deactivate()).toBe(true);
    expect(scope.deactivate()).toBe(false);
    expect(task.signal.aborted).toBe(true);
    button.click();
    await vi.advanceTimersByTimeAsync(100);

    expect(listener).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(task.commit(vi.fn())).toBe(false);
    expect(scope.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 0,
      pendingTaskCount: 1,
      active: false,
      disposed: false,
    });

    expect(scope.activate()).toBe(true);
    const replacementTask = scope.beginTask();
    expect(scope.dispose()).toBe(true);
    expect(scope.dispose()).toBe(false);
    expect(replacementTask.signal.aborted).toBe(true);
    expect(scope.activate()).toBe(false);
    expect(scope.beginTask()).toBeNull();
    task.settle();
    replacementTask.settle();
    expect(scope.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 0,
      pendingTaskCount: 0,
      active: false,
      disposed: true,
    });
  });
});
