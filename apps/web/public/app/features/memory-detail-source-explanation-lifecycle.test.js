import { describe, expect, it, vi } from "vitest";

import { createMemoryDetailSourceExplanationLifecycle } from "./memory-detail-source-explanation-lifecycle.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFixture({ sendReq = vi.fn() } = {}) {
  const state = {
    activeAgentId: "agent-1",
    selectedTask: {
      id: "task-1",
      conversationId: "conversation-1",
      sourceExplanation: null,
      sourceExplanationError: "",
      sourceExplanationLoading: false,
    },
  };
  const renderTaskDetail = vi.fn();
  const showNotice = vi.fn();
  const lifecycle = createMemoryDetailSourceExplanationLifecycle({
    isConnected: () => true,
    sendReq,
    makeId: () => "request-1",
    getMemoryViewerState: () => state,
    getCurrentAgentSelection: () => state.activeAgentId,
    renderTaskDetail,
    showNotice,
    t: (_key, _params, fallback) => fallback || "",
  });
  return { lifecycle, renderTaskDetail, showNotice, state };
}

describe("memory detail source explanation lifecycle", () => {
  it("settles a disposed source explanation read without restoring task content", async () => {
    const request = createDeferred();
    const { lifecycle, renderTaskDetail, state } = createFixture({
      sendReq: vi.fn(() => request.promise),
    });

    const load = lifecycle.loadTaskSourceExplanation("task-1", "conversation-1");
    expect(state.selectedTask.sourceExplanationLoading).toBe(true);
    expect(renderTaskDetail).toHaveBeenCalledTimes(1);
    expect(lifecycle.getRuntimeSnapshot().pendingSourceExplanationReadCount).toBe(1);

    lifecycle.dispose();
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingSourceExplanationReadCount: 1,
    });

    request.resolve({
      ok: true,
      payload: { explanation: { taskId: "task-1", summary: "late explanation" } },
    });
    await load;

    expect(state.selectedTask.sourceExplanation).toBeNull();
    expect(state.selectedTask.sourceExplanationError).toBe("");
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
    expect(renderTaskDetail).toHaveBeenCalledTimes(1);
    expect(lifecycle.getRuntimeSnapshot().pendingSourceExplanationReadCount).toBe(0);
  });

  it("settles a disposed rejected source explanation read without restoring an error", async () => {
    const request = createDeferred();
    const { lifecycle, renderTaskDetail, state } = createFixture({
      sendReq: vi.fn(() => request.promise),
    });

    const load = lifecycle.loadTaskSourceExplanation("task-1", "conversation-1");
    lifecycle.dispose();
    request.reject(new Error("late explanation failure"));

    await expect(load).resolves.toBeUndefined();
    expect(state.selectedTask.sourceExplanation).toBeNull();
    expect(state.selectedTask.sourceExplanationError).toBe("");
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
    expect(renderTaskDetail).toHaveBeenCalledTimes(1);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingSourceExplanationReadCount: 0,
    });
  });

  it("commits an active source explanation with the selected task and agent context", async () => {
    const explanation = { taskId: "task-1", summary: "current explanation" };
    const sendReq = vi.fn().mockResolvedValue({
      ok: true,
      payload: { explanation },
    });
    const { lifecycle, renderTaskDetail, state } = createFixture({ sendReq });

    await lifecycle.loadTaskSourceExplanation("task-1", "conversation-1");

    expect(sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "memory.explain_sources",
      params: {
        taskId: "task-1",
        conversationId: "conversation-1",
        agentId: "agent-1",
      },
    });
    expect(state.selectedTask.sourceExplanation).toBe(explanation);
    expect(state.selectedTask.sourceExplanationError).toBe("");
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
    expect(renderTaskDetail).toHaveBeenCalledTimes(2);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({
      disposed: false,
      sourceExplanationGeneration: 1,
      pendingSourceExplanationReadCount: 0,
    });
  });

  it("commits an active transport failure as a task explanation error", async () => {
    const { lifecycle, renderTaskDetail, state } = createFixture({
      sendReq: vi.fn().mockRejectedValue(new Error("source service unavailable")),
    });

    await expect(
      lifecycle.loadTaskSourceExplanation("task-1", "conversation-1"),
    ).resolves.toBeUndefined();

    expect(state.selectedTask.sourceExplanation).toBeNull();
    expect(state.selectedTask.sourceExplanationError).toBe("source service unavailable");
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
    expect(renderTaskDetail).toHaveBeenCalledTimes(2);
    expect(lifecycle.getRuntimeSnapshot().pendingSourceExplanationReadCount).toBe(0);
  });

  it("commits an active unsuccessful response as a task explanation error", async () => {
    const { lifecycle, state } = createFixture({
      sendReq: vi.fn().mockResolvedValue({
        ok: false,
        error: { message: "source explanation denied" },
      }),
    });
    state.selectedTask.sourceExplanation = { taskId: "task-1", summary: "old" };

    await lifecycle.loadTaskSourceExplanation("task-1", "conversation-1");

    expect(state.selectedTask.sourceExplanation).toBeNull();
    expect(state.selectedTask.sourceExplanationError).toBe("source explanation denied");
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
  });

  it("allows only the current agent generation to commit a source explanation", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const sendReq = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    const { lifecycle, state } = createFixture({ sendReq });

    const firstLoad = lifecycle.loadTaskSourceExplanation("task-1", "conversation-1");
    state.activeAgentId = "agent-2";
    lifecycle.clearGeneration();
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);

    const secondLoad = lifecycle.loadTaskSourceExplanation("task-1", "conversation-1");
    expect(lifecycle.getRuntimeSnapshot().pendingSourceExplanationReadCount).toBe(2);
    expect(sendReq.mock.calls[1][0].params.agentId).toBe("agent-2");

    firstRequest.resolve({
      ok: true,
      payload: { explanation: { taskId: "task-1", summary: "stale agent" } },
    });
    await firstLoad;
    expect(state.selectedTask.sourceExplanation).toBeNull();
    expect(state.selectedTask.sourceExplanationLoading).toBe(true);
    expect(lifecycle.getRuntimeSnapshot().pendingSourceExplanationReadCount).toBe(1);

    const currentExplanation = { taskId: "task-1", summary: "current agent" };
    secondRequest.resolve({ ok: true, payload: { explanation: currentExplanation } });
    await secondLoad;
    expect(state.selectedTask.sourceExplanation).toBe(currentExplanation);
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
    expect(lifecycle.getRuntimeSnapshot().pendingSourceExplanationReadCount).toBe(0);
  });
});
