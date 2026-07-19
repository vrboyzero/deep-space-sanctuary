// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalSubtaskListControlsFeature } from "./goal-subtask-list-controls.js";

describe("goal and subtask list controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("projects archived state and reloads both lists until dispose", () => {
    document.body.innerHTML = `
      <button id="goals-refresh"></button>
      <input id="goals-archived" type="checkbox" />
      <button id="subtasks-refresh"></button>
      <input id="subtasks-archived" type="checkbox" />
    `;
    const goalsState = { includeArchived: true };
    const subtasksState = { includeArchived: false };
    const loadGoals = vi.fn();
    const loadSubtasks = vi.fn();
    const feature = createGoalSubtaskListControlsFeature({
      refs: {
        goalsRefreshBtn: document.getElementById("goals-refresh"),
        goalsShowArchivedEl: document.getElementById("goals-archived"),
        subtasksRefreshBtn: document.getElementById("subtasks-refresh"),
        subtasksShowArchivedEl: document.getElementById("subtasks-archived"),
      },
      goalsState,
      subtasksState,
      loadGoals,
      loadSubtasks,
    });

    const goalsArchived = document.getElementById("goals-archived");
    const subtasksArchived = document.getElementById("subtasks-archived");
    expect(goalsArchived.checked).toBe(true);
    expect(subtasksArchived.checked).toBe(false);
    expect(feature.getRuntimeSnapshot()).toEqual({
      active: true,
      listenerCount: 4,
      disposed: false,
    });

    document.getElementById("goals-refresh").click();
    document.getElementById("subtasks-refresh").click();
    goalsArchived.checked = false;
    goalsArchived.dispatchEvent(new Event("change"));
    subtasksArchived.checked = true;
    subtasksArchived.dispatchEvent(new Event("change"));

    expect(goalsState.includeArchived).toBe(false);
    expect(subtasksState.includeArchived).toBe(true);
    expect(loadGoals).toHaveBeenCalledTimes(2);
    expect(loadGoals).toHaveBeenCalledWith(true);
    expect(loadSubtasks).toHaveBeenCalledTimes(2);
    expect(loadSubtasks).toHaveBeenCalledWith(true);

    expect(feature.deactivate()).toBe(true);
    goalsArchived.checked = true;
    subtasksArchived.checked = false;
    document.getElementById("goals-refresh").click();
    document.getElementById("subtasks-refresh").click();
    goalsArchived.dispatchEvent(new Event("change"));
    subtasksArchived.dispatchEvent(new Event("change"));
    expect(feature.getRuntimeSnapshot()).toEqual({
      active: false,
      listenerCount: 0,
      disposed: false,
    });
    expect(goalsState.includeArchived).toBe(false);
    expect(subtasksState.includeArchived).toBe(true);
    expect(loadGoals).toHaveBeenCalledTimes(2);
    expect(loadSubtasks).toHaveBeenCalledTimes(2);

    expect(feature.activate()).toBe(true);
    expect(goalsArchived.checked).toBe(false);
    expect(subtasksArchived.checked).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({
      active: true,
      listenerCount: 4,
      disposed: false,
    });
    document.getElementById("goals-refresh").click();
    document.getElementById("subtasks-refresh").click();
    goalsArchived.checked = true;
    goalsArchived.dispatchEvent(new Event("change"));
    subtasksArchived.checked = false;
    subtasksArchived.dispatchEvent(new Event("change"));
    expect(goalsState.includeArchived).toBe(true);
    expect(subtasksState.includeArchived).toBe(false);
    expect(loadGoals).toHaveBeenCalledTimes(4);
    expect(loadSubtasks).toHaveBeenCalledTimes(4);

    feature.dispose();
    feature.dispose();
    expect(feature.activate()).toBe(false);
    goalsArchived.checked = false;
    subtasksArchived.checked = true;
    document.getElementById("goals-refresh").click();
    document.getElementById("subtasks-refresh").click();
    goalsArchived.dispatchEvent(new Event("change"));
    subtasksArchived.dispatchEvent(new Event("change"));

    expect(feature.getRuntimeSnapshot()).toEqual({
      active: false,
      listenerCount: 0,
      disposed: true,
    });
    expect(goalsState.includeArchived).toBe(true);
    expect(subtasksState.includeArchived).toBe(false);
    expect(loadGoals).toHaveBeenCalledTimes(4);
    expect(loadSubtasks).toHaveBeenCalledTimes(4);
  });
});
