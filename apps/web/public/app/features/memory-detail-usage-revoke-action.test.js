import { describe, expect, it, vi } from "vitest";

import { createMemoryDetailUsageRevokeAction } from "./memory-detail-usage-revoke-action.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFixture(overrides = {}) {
  const state = {
    activeAgentId: "agent-1",
    pendingUsageRevokeId: null,
    selectedTask: { id: "task-1" },
    stats: { taskCount: 1 },
    ...overrides.state,
  };
  const dependencies = {
    getState: () => state,
    isConnected: () => true,
    sendReq: vi.fn().mockResolvedValue({ ok: true, payload: { revoked: true } }),
    makeId: () => "request-1",
    getActiveAgentId: () => state.activeAgentId,
    showNotice: vi.fn(),
    renderTaskDetail: vi.fn(),
    renderMemoryViewerStats: vi.fn(),
    loadTaskUsageOverview: vi.fn().mockResolvedValue(undefined),
    loadTaskDetail: vi.fn().mockResolvedValue(undefined),
    t: (_key, _params, fallback) => fallback || "",
    ...overrides,
  };
  const action = createMemoryDetailUsageRevokeAction(dependencies);
  return { action, dependencies, state };
}

describe("memory detail usage revoke action", () => {
  it("settles a disposed revoke without notice, reload, or stale busy cleanup", async () => {
    const request = createDeferred();
    const { action, dependencies, state } = createFixture({
      sendReq: vi.fn(() => request.promise),
    });

    const revoke = action.revoke("usage-1", "task-1", "skill-demo");
    expect(state.pendingUsageRevokeId).toBe("usage-1");
    expect(dependencies.renderTaskDetail).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(1);

    action.dispose();
    expect(state.pendingUsageRevokeId).toBeNull();
    request.resolve({ ok: true, payload: { revoked: true } });
    await revoke;

    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(dependencies.loadTaskUsageOverview).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(dependencies.renderTaskDetail).toHaveBeenCalledTimes(1);
    expect(dependencies.renderMemoryViewerStats).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingUsageRevokeActionCount: 0,
    });
  });

  it("settles a disposed rejected revoke without restoring busy or notice", async () => {
    const request = createDeferred();
    const { action, dependencies, state } = createFixture({
      sendReq: vi.fn(() => request.promise),
    });

    const revoke = action.revoke("usage-1", "task-1");
    action.dispose();
    request.reject(new Error("late revoke failure"));

    await expect(revoke).resolves.toBeUndefined();
    expect(state.pendingUsageRevokeId).toBeNull();
    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(dependencies.loadTaskUsageOverview).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(0);
  });

  it("preserves the active revoke request, notice, reload, and busy contract", async () => {
    const { action, dependencies, state } = createFixture();

    await action.revoke(" usage-1 ", " task-1 ", " skill-demo ");

    expect(dependencies.sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "experience.usage.revoke",
      params: { usageId: "usage-1", agentId: "agent-1" },
    });
    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "Usage revoked",
      "skill-demo was removed from the current task usage record.",
      "success",
      2200,
    );
    expect(dependencies.loadTaskUsageOverview).toHaveBeenCalledTimes(1);
    expect(dependencies.loadTaskDetail).toHaveBeenCalledWith("task-1");
    expect(state.pendingUsageRevokeId).toBeNull();
    expect(dependencies.renderTaskDetail).toHaveBeenCalledTimes(2);
    expect(dependencies.renderMemoryViewerStats).toHaveBeenCalledWith(state.stats);
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(0);
  });

  it("settles an active transport failure with notice and busy recovery", async () => {
    const { action, dependencies, state } = createFixture({
      sendReq: vi.fn().mockRejectedValue(new Error("usage service unavailable")),
    });

    await expect(action.revoke("usage-1", "task-1")).resolves.toBeUndefined();

    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "Revoke failed",
      "usage service unavailable",
      "error",
    );
    expect(dependencies.loadTaskUsageOverview).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(state.pendingUsageRevokeId).toBeNull();
    expect(dependencies.renderTaskDetail).toHaveBeenCalledTimes(2);
    expect(dependencies.renderMemoryViewerStats).toHaveBeenCalledTimes(1);
  });

  it("settles an unsuccessful response without starting reloads", async () => {
    const { action, dependencies, state } = createFixture({
      sendReq: vi.fn().mockResolvedValue({
        ok: false,
        error: { message: "usage revoke denied" },
      }),
    });

    await action.revoke("usage-1", "task-1");

    expect(dependencies.showNotice).toHaveBeenCalledWith(
      "Revoke failed",
      "usage revoke denied",
      "error",
    );
    expect(dependencies.loadTaskUsageOverview).not.toHaveBeenCalled();
    expect(dependencies.loadTaskDetail).not.toHaveBeenCalled();
    expect(state.pendingUsageRevokeId).toBeNull();
    expect(dependencies.renderTaskDetail).toHaveBeenCalledTimes(2);
    expect(dependencies.renderMemoryViewerStats).toHaveBeenCalledTimes(1);
  });

  it("keeps reloads physical but skips final rendering after dispose", async () => {
    const usageReload = createDeferred();
    const taskReload = createDeferred();
    const { action, dependencies, state } = createFixture({
      loadTaskUsageOverview: vi.fn(() => usageReload.promise),
      loadTaskDetail: vi.fn(() => taskReload.promise),
    });

    const revoke = action.revoke("usage-1", "task-1", "skill-demo");
    await vi.waitFor(() => {
      expect(dependencies.loadTaskUsageOverview).toHaveBeenCalledTimes(1);
      expect(dependencies.loadTaskDetail).toHaveBeenCalledWith("task-1");
    });
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(1);

    action.dispose();
    expect(state.pendingUsageRevokeId).toBeNull();
    usageReload.resolve();
    taskReload.resolve();
    await revoke;

    expect(dependencies.renderTaskDetail).toHaveBeenCalledTimes(1);
    expect(dependencies.renderMemoryViewerStats).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(0);
  });

  it("allows only the current agent generation to settle revoke UI state", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const { action, dependencies, state } = createFixture({
      sendReq: vi.fn()
        .mockImplementationOnce(() => firstRequest.promise)
        .mockImplementationOnce(() => secondRequest.promise),
    });

    const firstRevoke = action.revoke("usage-1", "task-1");
    state.activeAgentId = "agent-2";
    action.clearGeneration();
    expect(state.pendingUsageRevokeId).toBeNull();

    const secondRevoke = action.revoke("usage-2", "task-1");
    expect(state.pendingUsageRevokeId).toBe("usage-2");
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(2);
    expect(dependencies.sendReq.mock.calls[1][0].params.agentId).toBe("agent-2");

    firstRequest.resolve({ ok: true, payload: { revoked: true } });
    await firstRevoke;
    expect(state.pendingUsageRevokeId).toBe("usage-2");
    expect(dependencies.showNotice).not.toHaveBeenCalled();
    expect(dependencies.loadTaskUsageOverview).not.toHaveBeenCalled();
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(1);

    secondRequest.resolve({ ok: true, payload: { revoked: true } });
    await secondRevoke;
    expect(state.pendingUsageRevokeId).toBeNull();
    expect(dependencies.showNotice).toHaveBeenCalledTimes(1);
    expect(dependencies.loadTaskUsageOverview).toHaveBeenCalledTimes(1);
    expect(dependencies.loadTaskDetail).toHaveBeenCalledTimes(1);
    expect(action.getRuntimeSnapshot().pendingUsageRevokeActionCount).toBe(0);
  });
});
