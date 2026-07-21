// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDetailStatsListenerLifecycle } from "./memory-detail-stats-listener-lifecycle.js";

function createFixture() {
  const dependencies = {
    openTaskFromAudit: vi.fn().mockResolvedValue(undefined),
    openSourcePath: vi.fn().mockResolvedValue(undefined),
    loadCandidateDetail: vi.fn().mockResolvedValue(undefined),
    switchMode: vi.fn(),
    loadGoals: vi.fn().mockResolvedValue(undefined),
  };
  const lifecycle = createMemoryDetailStatsListenerLifecycle(dependencies);
  return { dependencies, lifecycle };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("memory detail stats listener lifecycle", () => {
  it("releases a retained task jump button listener on dispose", () => {
    const container = document.createElement("div");
    container.innerHTML = '<button data-open-task-id="task-1">Open task</button>';
    const taskButton = container.querySelector("button");
    const { dependencies, lifecycle } = createFixture();

    lifecycle.bindStatsAuditJumpLinks(container);
    expect(lifecycle.getRuntimeSnapshot().retainedStatsAuditListenerCount).toBe(1);

    lifecycle.dispose();
    taskButton.click();

    expect(dependencies.openTaskFromAudit).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: true,
      retainedStatsAuditListenerCount: 0,
    });
  });

  it("binds all stats jump actions once across repeated binding", async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button data-open-task-id="task-1">Task</button>
      <button data-open-source="C:/workspace/source.md">Source</button>
      <button data-open-candidate-id="candidate-1">Candidate</button>
      <button data-open-goal-id="goal-1">Goal</button>
    `;
    const { dependencies, lifecycle } = createFixture();

    lifecycle.bindStatsAuditJumpLinks(container);
    container.querySelector("[data-open-task-id]").click();
    container.querySelector("[data-open-source]").click();
    container.querySelector("[data-open-candidate-id]").click();
    container.querySelector("[data-open-goal-id]").click();
    await Promise.resolve();

    expect(dependencies.openTaskFromAudit).toHaveBeenCalledWith("task-1");
    expect(dependencies.openSourcePath).toHaveBeenCalledWith("C:/workspace/source.md");
    expect(dependencies.loadCandidateDetail).toHaveBeenCalledWith("candidate-1");
    expect(dependencies.switchMode).toHaveBeenCalledWith("goals");
    expect(dependencies.loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(lifecycle.getRuntimeSnapshot().retainedStatsAuditListenerCount).toBe(4);

    lifecycle.bindStatsAuditJumpLinks(container);
    container.querySelector("[data-open-task-id]").click();
    await Promise.resolve();
    expect(dependencies.openTaskFromAudit).toHaveBeenCalledTimes(2);
    expect(lifecycle.getRuntimeSnapshot().retainedStatsAuditListenerCount).toBe(4);
  });

  it("owns all stats listeners across deactivate and reactivate cycles", async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button data-open-task-id="task-1">Task</button>
      <button data-open-source="C:/workspace/source.md">Source</button>
      <button data-open-candidate-id="candidate-1">Candidate</button>
      <button data-open-goal-id="goal-1">Goal</button>
    `;
    const buttons = Array.from(container.querySelectorAll("button"));
    const addListenerSpies = buttons.map((button) => vi.spyOn(button, "addEventListener"));
    const { dependencies, lifecycle } = createFixture();

    expect(lifecycle.bindStatsAuditJumpLinks(container)).toBe(true);
    const retainedListeners = addListenerSpies.map((spy) => (
      spy.mock.calls.find(([type]) => type === "click")?.[1]
    ));
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: false,
      retainedStatsAuditListenerCount: 4,
    });

    buttons.forEach((button) => button.click());
    await Promise.resolve();
    expect(dependencies.openTaskFromAudit).toHaveBeenCalledWith("task-1");
    expect(dependencies.openSourcePath).toHaveBeenCalledWith("C:/workspace/source.md");
    expect(dependencies.loadCandidateDetail).toHaveBeenCalledWith("candidate-1");
    expect(dependencies.switchMode).toHaveBeenCalledWith("goals");
    expect(dependencies.loadGoals).toHaveBeenCalledWith(true, "goal-1");

    Object.values(dependencies).forEach((dependency) => dependency.mockClear());
    expect(lifecycle.deactivate()).toBe(true);
    expect(lifecycle.deactivate()).toBe(false);
    buttons.forEach((button) => button.click());
    for (const retainedListener of retainedListeners) {
      await retainedListener?.({ type: "click" });
    }
    expect(dependencies.openTaskFromAudit).not.toHaveBeenCalled();
    expect(dependencies.openSourcePath).not.toHaveBeenCalled();
    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(dependencies.switchMode).not.toHaveBeenCalled();
    expect(dependencies.loadGoals).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: false,
      retainedStatsAuditListenerCount: 0,
    });

    const addCallCounts = addListenerSpies.map((spy) => spy.mock.calls.length);
    expect(lifecycle.bindStatsAuditJumpLinks(container)).toBe(false);
    expect(addListenerSpies.map((spy) => spy.mock.calls.length)).toEqual(addCallCounts);

    expect(lifecycle.activate()).toBe(true);
    expect(lifecycle.bindStatsAuditJumpLinks(container)).toBe(true);
    buttons.forEach((button) => button.click());
    await Promise.resolve();
    expect(dependencies.openTaskFromAudit).toHaveBeenCalledWith("task-1");
    expect(dependencies.openSourcePath).toHaveBeenCalledWith("C:/workspace/source.md");
    expect(dependencies.loadCandidateDetail).toHaveBeenCalledWith("candidate-1");
    expect(dependencies.switchMode).toHaveBeenCalledWith("goals");
    expect(dependencies.loadGoals).toHaveBeenCalledWith(true, "goal-1");

    expect(lifecycle.dispose()).toBe(true);
    expect(lifecycle.dispose()).toBe(false);
    expect(lifecycle.activate()).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: true,
      retainedStatsAuditListenerCount: 0,
    });
  });
});
