// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDetailTaskAuditListenerLifecycle } from "./memory-detail-task-audit-listener-lifecycle.js";

function createFixture() {
  const state = {
    selectedCandidate: { id: "candidate-selected" },
    selectedTask: { id: "task-selected" },
  };
  const runtime = {
    generateExperienceCandidate: vi.fn().mockResolvedValue(undefined),
    reviewExperienceCandidate: vi.fn().mockResolvedValue(undefined),
    updateSkillFreshnessStaleMark: vi.fn().mockResolvedValue(undefined),
  };
  const dependencies = {
    getState: () => state,
    getMemoryRuntimeFeature: () => runtime,
    openTaskFromAudit: vi.fn().mockResolvedValue(undefined),
    loadCandidateDetail: vi.fn().mockResolvedValue(undefined),
    openExperienceCandidate: vi.fn().mockResolvedValue(undefined),
    switchMode: vi.fn(),
    loadGoals: vi.fn().mockResolvedValue(undefined),
    openGoalTaskViewer: vi.fn().mockResolvedValue(undefined),
    renderTaskDetail: vi.fn(),
    renderDetailEmpty: vi.fn(),
    openMemoryFromAudit: vi.fn().mockResolvedValue(undefined),
    loadTaskSourceExplanation: vi.fn().mockResolvedValue(undefined),
    t: (_key, _params, fallback) => fallback ?? "",
  };
  return {
    dependencies,
    lifecycle: createMemoryDetailTaskAuditListenerLifecycle(dependencies),
    runtime,
    state,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("memory detail task audit listener lifecycle", () => {
  it("releases a retained task jump button listener on dispose", () => {
    const container = document.createElement("div");
    container.innerHTML = '<button data-open-task-id="task-1">Open task</button>';
    const taskButton = container.querySelector("button");
    const { dependencies, lifecycle } = createFixture();

    lifecycle.bindTaskAuditJumpLinks(container);
    expect(lifecycle.getRuntimeSnapshot().retainedTaskAuditListenerCount).toBe(1);

    lifecycle.dispose();
    taskButton.click();

    expect(dependencies.openTaskFromAudit).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: true,
      retainedTaskAuditListenerCount: 0,
    });
  });

  it("preserves task audit parameters, goal ordering, freshness mapping, and repeated binding", async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button data-open-task-id="task-1">Task</button>
      <button data-open-candidate-id="candidate-1">Candidate</button>
      <button data-open-experience-candidate-id="experience-1">Experience</button>
      <button data-open-goal-id="goal-1">Goal</button>
      <button data-open-goal-tasks="goal-2">Goal tasks</button>
      <button data-open-memory-id="memory-1">Memory</button>
      <button data-load-task-source-explanation="task-2" data-load-task-conversation-id="conversation-1">Sources</button>
      <button data-generate-experience-type="method" data-generate-experience-task-id="task-3">Generate</button>
      <button data-review-candidate-action="accept" data-review-candidate-id="candidate-2" data-review-candidate-task-id="task-4">Review</button>
      <button data-skill-freshness-stale-action="mark" data-skill-freshness-source-candidate-id="source-1" data-skill-freshness-skill-key="skill-1" data-skill-freshness-task-id="task-5" data-skill-freshness-candidate-id="candidate-3">Mark stale</button>
      <button data-skill-freshness-stale-action="clear" data-skill-freshness-source-candidate-id="source-2" data-skill-freshness-skill-key="skill-2" data-skill-freshness-task-id="task-6" data-skill-freshness-candidate-id="candidate-4">Clear stale</button>
    `;
    const { dependencies, lifecycle, runtime } = createFixture();

    lifecycle.bindTaskAuditJumpLinks(container);
    container.querySelectorAll("button").forEach((button) => button.click());
    await Promise.resolve();

    expect(dependencies.openTaskFromAudit).toHaveBeenCalledWith("task-1");
    expect(dependencies.loadCandidateDetail).toHaveBeenCalledWith("candidate-1");
    expect(dependencies.openExperienceCandidate).toHaveBeenCalledWith("experience-1");
    expect(dependencies.switchMode).toHaveBeenCalledWith("goals");
    expect(dependencies.loadGoals).toHaveBeenCalledWith(true, "goal-1");
    expect(dependencies.switchMode.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.loadGoals.mock.invocationCallOrder[0],
    );
    expect(dependencies.openGoalTaskViewer).toHaveBeenCalledWith("goal-2");
    expect(dependencies.openMemoryFromAudit).toHaveBeenCalledWith("memory-1");
    expect(dependencies.loadTaskSourceExplanation).toHaveBeenCalledWith("task-2", "conversation-1");
    expect(runtime.generateExperienceCandidate).toHaveBeenCalledWith("task-3", "method");
    expect(runtime.reviewExperienceCandidate).toHaveBeenCalledWith("candidate-2", "accept", { taskId: "task-4" });
    expect(runtime.updateSkillFreshnessStaleMark).toHaveBeenNthCalledWith(1, {
      sourceCandidateId: "source-1",
      skillKey: "skill-1",
      taskId: "task-5",
      candidateId: "candidate-3",
      stale: true,
    });
    expect(runtime.updateSkillFreshnessStaleMark).toHaveBeenNthCalledWith(2, {
      sourceCandidateId: "source-2",
      skillKey: "skill-2",
      taskId: "task-6",
      candidateId: "candidate-4",
      stale: false,
    });
    expect(lifecycle.getRuntimeSnapshot().retainedTaskAuditListenerCount).toBe(11);

    lifecycle.bindTaskAuditJumpLinks(container);
    container.querySelector("[data-open-task-id]").click();
    await Promise.resolve();
    expect(dependencies.openTaskFromAudit).toHaveBeenCalledTimes(2);
    expect(lifecycle.getRuntimeSnapshot().retainedTaskAuditListenerCount).toBe(11);
  });

  it("closes candidate detail back to the selected task or empty state", () => {
    const container = document.createElement("div");
    container.innerHTML = '<button data-close-candidate-panel="1">Close</button>';
    const closeButton = container.querySelector("button");
    const { dependencies, lifecycle, state } = createFixture();

    lifecycle.bindTaskAuditJumpLinks(container);
    closeButton.click();

    expect(state.selectedCandidate).toBeNull();
    expect(dependencies.renderTaskDetail).toHaveBeenCalledWith(state.selectedTask);

    state.selectedCandidate = { id: "candidate-next" };
    state.selectedTask = null;
    closeButton.click();

    expect(state.selectedCandidate).toBeNull();
    expect(dependencies.renderDetailEmpty).toHaveBeenCalledWith("Please select a task.");
  });
});
