// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createMemoryRuntimeIngressLifecycle } from "./memory-runtime-ingress-lifecycle.js";
import { createMemoryRuntimeFeature } from "./memory-runtime.js";

function createFeatureHarness() {
  const refs = {
    memoryViewerSection: document.createElement("section"),
    memoryTaskGoalFilterBarEl: document.createElement("div"),
    memoryTaskGoalFilterLabelEl: document.createElement("span"),
  };
  refs.memoryTaskGoalFilterBarEl.className = "hidden";
  refs.memoryTaskGoalFilterLabelEl.textContent = "initial label";
  const state = {
    tab: "tasks",
    items: [{ id: "task-1" }],
    stats: { total: 1 },
    selectedId: "task-1",
    selectedTask: { id: "task-1" },
    selectedCandidate: { id: "candidate-1", taskId: "task-1" },
    pendingExperienceActionKey: null,
    pendingUsageRevokeId: "usage-1",
    goalIdFilter: "goal-1",
    requestToken: 1,
    activeAgentId: "default",
  };
  const viewerFeature = {
    loadExternalOutboundAuditViewer: vi.fn(async () => {}),
    loadMemoryChunkViewer: vi.fn(async () => {}),
    loadMemoryViewer: vi.fn(async () => {}),
    loadMemoryViewerStats: vi.fn(async () => {}),
    loadTaskUsageOverview: vi.fn(async () => {}),
    loadTaskViewer: vi.fn(async () => {}),
    switchMemoryViewerTab: vi.fn(),
    syncMemoryViewerUi: vi.fn(),
  };
  const dependencies = {
    sendReq: vi.fn(async () => ({ ok: true, payload: {} })),
    switchMode: vi.fn(),
    loadGoals: vi.fn(async () => {}),
    showNotice: vi.fn(),
    renderMemoryViewerStats: vi.fn(),
    renderTaskList: vi.fn(),
    renderMemoryList: vi.fn(),
    renderSharedReviewList: vi.fn(),
    renderTaskDetail: vi.fn(),
    renderCandidateOnlyDetail: vi.fn(),
    renderMemoryDetail: vi.fn(),
    renderMemoryViewerListEmpty: vi.fn(),
    renderMemoryViewerDetailEmpty: vi.fn(),
  };
  const feature = createMemoryRuntimeFeature({
    refs,
    isConnected: () => true,
    sendReq: dependencies.sendReq,
    makeId: () => "req-1",
    getMemoryViewerState: () => state,
    getMemoryViewerFeature: () => viewerFeature,
    getCurrentAgentSelection: () => "default",
    getGoalDisplayName: () => "Goal One",
    switchMode: dependencies.switchMode,
    loadGoals: dependencies.loadGoals,
    showNotice: dependencies.showNotice,
    renderMemoryViewerStats: dependencies.renderMemoryViewerStats,
    renderTaskList: dependencies.renderTaskList,
    renderMemoryList: dependencies.renderMemoryList,
    renderSharedReviewList: dependencies.renderSharedReviewList,
    renderTaskDetail: dependencies.renderTaskDetail,
    renderCandidateOnlyDetail: dependencies.renderCandidateOnlyDetail,
    renderMemoryDetail: dependencies.renderMemoryDetail,
    renderMemoryViewerListEmpty: dependencies.renderMemoryViewerListEmpty,
    renderMemoryViewerDetailEmpty: dependencies.renderMemoryViewerDetailEmpty,
    getCurrentAgentLabel: () => "Default Agent",
    t: (_key, _params, fallback) => fallback || "",
  });
  return { dependencies, feature, refs, state, viewerFeature };
}

describe("memory runtime public ingress lifecycle", () => {
  it("blocks guarded sync and async commands after dispose", async () => {
    const lifecycle = createMemoryRuntimeIngressLifecycle();
    const syncCommand = vi.fn((value) => `sync:${value}`);
    const asyncCommand = vi.fn(async (value) => `async:${value}`);
    const guardedSync = lifecycle.guard(syncCommand, "sync:disposed");
    const guardedAsync = lifecycle.guardAsync(asyncCommand, null);

    expect(guardedSync("active")).toBe("sync:active");
    await expect(guardedAsync("active")).resolves.toBe("async:active");

    lifecycle.dispose();
    expect(guardedSync("late")).toBe("sync:disposed");
    await expect(guardedAsync("late")).resolves.toBeNull();
    expect(syncCommand).toHaveBeenCalledTimes(1);
    expect(asyncCommand).toHaveBeenCalledTimes(1);
    expect(lifecycle.getRuntimeSnapshot()).toEqual({ memoryRuntimeIngressDisposed: true });
  });

  it("blocks every public command from writing state, DOM, notices, or RPC after dispose", async () => {
    const { dependencies, feature, refs, state, viewerFeature } = createFeatureHarness();
    feature.dispose();
    const stateBefore = structuredClone(state);
    const domBefore = {
      className: refs.memoryTaskGoalFilterBarEl.className,
      label: refs.memoryTaskGoalFilterLabelEl.textContent,
    };

    feature.switchMemoryViewerTab("memories");
    feature.syncMemoryViewerUi();
    feature.syncMemoryTaskGoalFilterUi();
    feature.refreshMemoryLocale();
    expect(feature.resolveMemoryDetailTargetAgentId("task-1")).toBeUndefined();
    expect(feature.getCurrentAgentLabel()).toBe("Default Agent");
    await Promise.all([
      feature.clearMemoryTaskGoalFilter(),
      feature.loadCandidateDetail("candidate-2"),
      feature.loadMemoryChunkViewer(true),
      feature.loadMemoryDetail("chunk-1"),
      feature.loadMemoryViewer(true),
      feature.loadMemoryViewerStats(),
      feature.loadTaskDetail("task-2"),
      feature.loadTaskUsageOverview(),
      feature.loadTaskViewer(true),
      feature.generateExperienceCandidate("task-1", "method"),
      feature.openGoalTaskViewer("goal-2"),
      feature.openMemoryFromAudit("chunk-1"),
      feature.openTaskFromAudit("task-2"),
      feature.reviewExperienceCandidate("candidate-1", "accept", { taskId: "task-1" }),
      feature.updateSkillFreshnessStaleMark({ skillKey: "skill-demo" }),
    ]);

    expect(state).toEqual(stateBefore);
    expect(refs.memoryTaskGoalFilterBarEl.className).toBe(domBefore.className);
    expect(refs.memoryTaskGoalFilterLabelEl.textContent).toBe(domBefore.label);
    expect(Object.values(dependencies).every((dependency) => dependency.mock.calls.length === 0)).toBe(true);
    expect(Object.values(viewerFeature).every((dependency) => dependency.mock.calls.length === 0)).toBe(true);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      memoryRuntimeIngressDisposed: true,
      pendingMemoryRuntimeReadCount: 0,
      pendingMemoryRuntimeExperienceGenerateActionCount: 0,
      pendingMemoryRuntimeExperienceReviewActionCount: 0,
      pendingMemoryRuntimeSkillFreshnessActionCount: 0,
    });
  });
});
