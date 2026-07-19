import { describe, expect, it, vi } from "vitest";

import { createMemoryRuntimeExperienceReviewAction } from "./memory-runtime-experience-review-action.js";

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
    loadTaskDetail: vi.fn(async () => {}),
    loadCandidateDetail: vi.fn(async () => {}),
    t: (_key, _params, fallback) => fallback || "",
    ...overrides,
  };
  return {
    action: createMemoryRuntimeExperienceReviewAction(dependencies),
    dependencies,
    state,
  };
}

describe("memory runtime experience review action", () => {
  it("settles a disposed review without notice, reload, or stale state cleanup", async () => {
    const request = createDeferred();
    const { action, dependencies, state } = createAction({
      sendReq: vi.fn(() => request.promise),
    });

    const review = action.review("candidate-1", "accept", { taskId: "task-1" });
    expect(state.pendingExperienceActionKey).toBe("candidate:candidate-1:accept");
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceReviewActionCount).toBe(1);

    action.dispose();
    expect(state.pendingExperienceActionKey).toBeNull();
    request.resolve({
      ok: true,
      payload: { candidate: { id: "candidate-1", title: "Late Candidate" } },
    });
    await expect(review).resolves.toBeNull();

    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(dependencies.rerender).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemoryRuntimeExperienceReviewActionCount: 0,
    });
  });

  it("suppresses a disposed review rejection after physical settlement", async () => {
    const request = createDeferred();
    const { action, dependencies } = createAction({
      sendReq: vi.fn(() => request.promise),
    });

    const review = action.review("candidate-1", "reject");
    action.dispose();
    request.reject(new Error("late review failure"));

    await expect(review).resolves.toBeNull();
    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceReviewActionCount).toBe(0);
  });

  it("preserves the active accept notice and reload contract", async () => {
    const calls = [];
    const candidate = { id: "candidate-1", title: "Accepted Candidate" };
    const sendReq = vi.fn(async (request) => {
      calls.push(request.method);
      return { ok: true, payload: { candidate } };
    });
    const { action, dependencies, state } = createAction({
      sendReq,
      loadTaskDetail: vi.fn(async () => { calls.push("load-task"); }),
      loadCandidateDetail: vi.fn(async () => { calls.push("load-candidate"); }),
    });

    await expect(action.review(" candidate-1 ", "accept", { taskId: " task-1 " })).resolves.toBe(candidate);

    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "req-1",
      method: "experience.candidate.accept",
      params: { candidateId: "candidate-1", agentId: "default" },
    });
    expect(calls).toEqual(["experience.candidate.accept", "load-task", "load-candidate"]);
    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "候选已接受",
      "Accepted Candidate",
      "success",
      2200,
    );
    expect(state.pendingExperienceActionKey).toBeNull();
    expect(dependencies.rerender).toHaveBeenCalledTimes(2);
  });

  it("preserves the active reject mapping without a task reload", async () => {
    const candidate = { id: "candidate-2", title: "Rejected Candidate" };
    const sendReq = vi.fn(async () => ({ ok: true, payload: { candidate } }));
    const { action, dependencies } = createAction({ sendReq });

    await expect(action.review("candidate-2", "reject")).resolves.toBe(candidate);

    expect(sendReq.mock.calls[0][0].method).toBe("experience.candidate.reject");
    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "候选已拒绝",
      "Rejected Candidate",
      "success",
      2200,
    );
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.loadCandidateDetail).toHaveBeenCalledWith("candidate-2");
  });

  it("stops the review reload chain after a disposed task reload settles", async () => {
    const taskReload = createDeferred();
    const { action, dependencies } = createAction({
      sendReq: vi.fn(async () => ({
        ok: true,
        payload: { candidate: { id: "candidate-1", title: "Accepted Candidate" } },
      })),
      loadTaskDetail: vi.fn(() => taskReload.promise),
    });

    const review = action.review("candidate-1", "accept", { taskId: "task-1" });
    await vi.waitFor(() => expect(dependencies.loadTaskDetail).toHaveBeenCalledWith("task-1"));
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceReviewActionCount).toBe(1);

    action.dispose();
    taskReload.resolve();
    await expect(review).resolves.toBeNull();

    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(dependencies.rerender).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceReviewActionCount).toBe(0);
  });
});
