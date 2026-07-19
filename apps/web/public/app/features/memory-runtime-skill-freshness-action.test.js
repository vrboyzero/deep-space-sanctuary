import { describe, expect, it, vi } from "vitest";

import { createMemoryRuntimeSkillFreshnessAction } from "./memory-runtime-skill-freshness-action.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createAction(overrides = {}) {
  const state = {
    pendingExperienceActionKey: null,
    ...overrides.state,
  };
  const dependencies = {
    getState: () => state,
    isConnected: () => true,
    sendReq: vi.fn(async () => ({ ok: true, payload: {} })),
    makeId: () => "req-1",
    getActiveAgentId: () => "default",
    showNotice: vi.fn(),
    rerender: vi.fn(),
    loadTaskUsageOverview: vi.fn(async () => {}),
    loadTaskDetail: vi.fn(async () => {}),
    loadCandidateDetail: vi.fn(async () => {}),
    t: (_key, _params, fallback) => fallback || "",
    ...overrides,
  };
  return {
    action: createMemoryRuntimeSkillFreshnessAction(dependencies),
    dependencies,
    state,
  };
}

describe("memory runtime skill freshness action", () => {
  it("settles a disposed freshness update without notice, reload, or stale state cleanup", async () => {
    const request = createDeferred();
    const { action, dependencies, state } = createAction({
      sendReq: vi.fn(() => request.promise),
    });

    const update = action.update({
      sourceCandidateId: "source-1",
      skillKey: "skill-demo",
      taskId: "task-1",
      candidateId: "candidate-1",
      stale: true,
    });
    expect(state.pendingExperienceActionKey).toBe("skill-freshness:source-1:stale");
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeSkillFreshnessActionCount).toBe(1);

    action.dispose();
    expect(state.pendingExperienceActionKey).toBeNull();
    request.resolve({ ok: true, payload: { skillFreshness: { stale: true } } });
    await expect(update).resolves.toBeNull();

    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(dependencies.loadTaskUsageOverview).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(dependencies.rerender).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemoryRuntimeSkillFreshnessActionCount: 0,
    });
  });

  it("suppresses a disposed freshness rejection after physical settlement", async () => {
    const request = createDeferred();
    const { action, dependencies } = createAction({
      sendReq: vi.fn(() => request.promise),
    });

    const update = action.update({ skillKey: "skill-demo" });
    action.dispose();
    request.reject(new Error("late freshness failure"));

    await expect(update).resolves.toBeNull();
    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeSkillFreshnessActionCount).toBe(0);
  });

  it("preserves the active stale update notice and reload contract", async () => {
    const calls = [];
    const skillFreshness = { skillKey: "skill-demo", stale: true };
    const sendReq = vi.fn(async (request) => {
      calls.push(request.method);
      return { ok: true, payload: { skillFreshness } };
    });
    const { action, dependencies, state } = createAction({
      sendReq,
      loadTaskUsageOverview: vi.fn(async () => { calls.push("load-usage"); }),
      loadTaskDetail: vi.fn(async () => { calls.push("load-task"); }),
      loadCandidateDetail: vi.fn(async () => { calls.push("load-candidate"); }),
    });

    await expect(action.update({
      sourceCandidateId: " source-1 ",
      skillKey: " skill-demo ",
      taskId: " task-1 ",
      candidateId: " candidate-1 ",
    })).resolves.toBe(skillFreshness);

    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "req-1",
      method: "experience.skill.freshness.update",
      params: {
        sourceCandidateId: "source-1",
        skillKey: "skill-demo",
        stale: true,
        agentId: "default",
      },
    });
    expect(calls).toEqual([
      "experience.skill.freshness.update",
      "load-usage",
      "load-task",
      "load-candidate",
    ]);
    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "已标记 stale",
      "skill-demo",
      "success",
      2200,
    );
    expect(state.pendingExperienceActionKey).toBeNull();
    expect(dependencies.rerender).toHaveBeenCalledTimes(2);
  });

  it("preserves the clear-stale mapping for a skill-key-only update", async () => {
    const skillFreshness = { skillKey: "skill-demo", stale: false };
    const sendReq = vi.fn(async () => ({ ok: true, payload: { skillFreshness } }));
    const { action, dependencies } = createAction({ sendReq });

    await expect(action.update({ skillKey: "skill-demo", stale: false })).resolves.toBe(skillFreshness);

    expect(sendReq.mock.calls[0][0].params).toEqual({
      skillKey: "skill-demo",
      stale: false,
      agentId: "default",
    });
    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "已取消 stale",
      "skill-demo",
      "success",
      2200,
    );
    expect(dependencies.loadTaskUsageOverview).toHaveBeenCalledTimes(1);
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
  });

  it("stops the freshness reload chain after a disposed task reload settles", async () => {
    const taskReload = createDeferred();
    const { action, dependencies } = createAction({
      sendReq: vi.fn(async () => ({
        ok: true,
        payload: { skillFreshness: { skillKey: "skill-demo", stale: true } },
      })),
      loadTaskDetail: vi.fn(() => taskReload.promise),
    });

    const update = action.update({
      skillKey: "skill-demo",
      taskId: "task-1",
      candidateId: "candidate-1",
    });
    await vi.waitFor(() => expect(dependencies.loadTaskDetail).toHaveBeenCalledWith("task-1"));
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeSkillFreshnessActionCount).toBe(1);

    action.dispose();
    taskReload.resolve();
    await expect(update).resolves.toBeNull();

    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(dependencies.rerender).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeSkillFreshnessActionCount).toBe(0);
  });
});
