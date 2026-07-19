// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createMemoryRuntimeExperienceGenerateAction } from "./memory-runtime-experience-generate-action.js";

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
    selectedCandidate: null,
    ...overrides.state,
  };
  const dependencies = {
    getState: () => state,
    isConnected: () => true,
    sendReq: vi.fn(async () => ({ ok: true, payload: { decision: "no_match" } })),
    makeId: () => "req-1",
    getActiveAgentId: () => "default",
    confirmAction: vi.fn(() => true),
    showNotice: vi.fn(),
    rerender: vi.fn(),
    loadTaskDetail: vi.fn(async () => {}),
    loadCandidateDetail: vi.fn(async () => {}),
    isDraftNoticeEnabled: () => true,
    t: (_key, _params, fallback) => fallback || "",
    ...overrides,
  };
  return {
    action: createMemoryRuntimeExperienceGenerateAction(dependencies),
    dependencies,
    state,
  };
}

describe("memory runtime experience generate action", () => {
  it("settles a disposed duplicate preflight without notice, reload, or stale state cleanup", async () => {
    const request = createDeferred();
    const { action, dependencies, state } = createAction({
      sendReq: vi.fn(() => request.promise),
    });

    const generate = action.generate("task-1", "method");
    expect(state.pendingExperienceActionKey).toBe("generate:method:task-1");
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(1);

    action.dispose();
    expect(state.pendingExperienceActionKey).toBeNull();
    request.resolve({ ok: true, payload: { decision: "no_match" } });
    await expect(generate).resolves.toBeNull();

    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(dependencies.rerender).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingMemoryRuntimeExperienceGenerateActionCount: 0,
    });
  });

  it("suppresses a disposed preflight rejection after physical settlement", async () => {
    const request = createDeferred();
    const { action, dependencies } = createAction({
      sendReq: vi.fn(() => request.promise),
    });

    const generate = action.generate("task-1", "skill");
    action.dispose();
    request.reject(new Error("late preflight failure"));

    await expect(generate).resolves.toBeNull();
    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(0);
  });

  it("preserves the active no-match generation and reload contract", async () => {
    const calls = [];
    const candidate = { id: "candidate-1", title: "Method Draft Demo" };
    const sendReq = vi.fn(async (request) => {
      calls.push(request.method);
      if (request.method === "experience.candidate.check_duplicate") {
        return { ok: true, payload: { decision: "no_match" } };
      }
      if (request.method === "experience.candidate.generate") {
        return { ok: true, payload: { candidate, reusedExisting: false } };
      }
      throw new Error(`unexpected method ${request.method}`);
    });
    const { action, dependencies, state } = createAction({
      sendReq,
      loadTaskDetail: vi.fn(async () => { calls.push("load-task"); }),
      loadCandidateDetail: vi.fn(async () => { calls.push("load-candidate"); }),
    });

    await expect(action.generate(" task-1 ", "method")).resolves.toBe(candidate);

    expect(calls).toEqual([
      "experience.candidate.check_duplicate",
      "experience.candidate.generate",
      "load-task",
      "load-candidate",
    ]);
    expect(sendReq.mock.calls[1][0]).toMatchObject({
      method: "experience.candidate.generate",
      params: { taskId: "task-1", candidateType: "method", agentId: "default" },
    });
    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "Method Draft 已生成",
      "Method Draft Demo",
      "success",
      2200,
    );
    expect(state.pendingExperienceActionKey).toBeNull();
    expect(dependencies.rerender).toHaveBeenCalledTimes(2);
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(0);
  });

  it("opens a confirmed exact duplicate without generating another candidate", async () => {
    const existingCandidate = { id: "candidate-existing", title: "Existing Method" };
    const sendReq = vi.fn(async () => ({
      ok: true,
      payload: {
        decision: "duplicate_existing",
        exactMatch: {
          candidateId: existingCandidate.id,
          title: existingCandidate.title,
        },
      },
    }));
    const { action, dependencies, state } = createAction({
      sendReq,
      loadCandidateDetail: vi.fn(async () => {
        state.selectedCandidate = existingCandidate;
      }),
    });

    await expect(action.generate("task-1", "method")).resolves.toBe(existingCandidate);

    expect(dependencies.confirmAction).toHaveBeenCalledTimes(1);
    expect(sendReq.mock.calls.map(([request]) => request.method)).toEqual([
      "experience.candidate.check_duplicate",
    ]);
    expect(dependencies.loadCandidateDetail).toHaveBeenCalledWith("candidate-existing");
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "已打开现有候选",
      "Existing Method",
      "info",
      2200,
    );
  });

  it("continues generation after a similar-match confirmation", async () => {
    const candidate = { id: "candidate-skill", title: "Skill Draft Demo" };
    const sendReq = vi.fn(async (request) => {
      if (request.method === "experience.candidate.check_duplicate") {
        return {
          ok: true,
          payload: {
            decision: "similar_existing",
            similarMatches: [{ title: "Similar Skill" }],
          },
        };
      }
      return { ok: true, payload: { candidate, reusedExisting: false } };
    });
    const { action, dependencies } = createAction({ sendReq });

    await expect(action.generate("task-1", "skill")).resolves.toBe(candidate);

    expect(dependencies.confirmAction).toHaveBeenCalledTimes(1);
    expect(sendReq.mock.calls.map(([request]) => request.method)).toEqual([
      "experience.candidate.check_duplicate",
      "experience.candidate.generate",
    ]);
  });

  it("settles a disposed generate request without notice or reload", async () => {
    const generateRequest = createDeferred();
    const sendReq = vi.fn(async (request) => {
      if (request.method === "experience.candidate.check_duplicate") {
        return { ok: true, payload: { decision: "no_match" } };
      }
      return generateRequest.promise;
    });
    const { action, dependencies } = createAction({ sendReq });

    const generate = action.generate("task-1", "method");
    await vi.waitFor(() => expect(sendReq).toHaveBeenCalledTimes(2));
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(1);

    action.dispose();
    generateRequest.resolve({
      ok: true,
      payload: { candidate: { id: "candidate-late", title: "Late Method" } },
    });
    await expect(generate).resolves.toBeNull();

    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(0);
  });

  it("stops the reload chain after a disposed task reload settles", async () => {
    const taskReload = createDeferred();
    const sendReq = vi.fn(async (request) => {
      if (request.method === "experience.candidate.check_duplicate") {
        return { ok: true, payload: { decision: "no_match" } };
      }
      return {
        ok: true,
        payload: { candidate: { id: "candidate-1", title: "Method Draft" } },
      };
    });
    const { action, dependencies } = createAction({
      sendReq,
      loadTaskDetail: vi.fn(() => taskReload.promise),
    });

    const generate = action.generate("task-1", "method");
    await vi.waitFor(() => expect(dependencies.loadTaskDetail).toHaveBeenCalledWith("task-1"));
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(1);

    action.dispose();
    taskReload.resolve();
    await expect(generate).resolves.toBeNull();

    expect(dependencies.loadCandidateDetail).not.toHaveBeenCalled();
    expect(dependencies.rerender).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(0);
  });
});
