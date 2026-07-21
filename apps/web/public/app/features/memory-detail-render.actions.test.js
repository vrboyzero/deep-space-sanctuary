// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDetailRenderFeature } from "./memory-detail-render.js";
import { createMemoryViewerFeature } from "./memory-viewer.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness({
  detailSendReq = vi.fn(),
  detailShowNotice = vi.fn(),
  detailLoadTaskUsageOverview = vi.fn(async () => {}),
  detailLoadTaskDetail = vi.fn(async () => {}),
  categoryFilterValue = "",
} = {}) {
  document.body.innerHTML = `
    <div id="memoryViewerDetail"></div>
    <div id="memoryViewerStats"></div>
  `;

  const refs = {
    memoryViewerDetailEl: document.getElementById("memoryViewerDetail"),
    memoryViewerStatsEl: document.getElementById("memoryViewerStats"),
    memoryChunkCategoryFilterEl: { value: categoryFilterValue },
  };

  const state = {
    tab: "tasks",
    items: [],
    stats: null,
    selectedId: "task-1",
    selectedTask: null,
    selectedCandidate: null,
    pendingUsageRevokeId: null,
    pendingExperienceActionKey: null,
    activeAgentId: "default",
  };

  const loadCandidateDetail = vi.fn(async () => {});
  const openExperienceCandidate = vi.fn(async () => {});
  const openTaskFromAudit = vi.fn(async () => {});
  const openSourcePath = vi.fn(async () => {});
  const loadGoals = vi.fn(async () => {});
  const switchMode = vi.fn();
  const runtime = {
    generateExperienceCandidate: vi.fn(async () => {}),
    reviewExperienceCandidate: vi.fn(async () => {}),
    updateSkillFreshnessStaleMark: vi.fn(async () => {}),
  };

  const viewerFeature = createMemoryViewerFeature({
    refs: {
      memoryViewerSection: null,
      memoryViewerTitleEl: null,
      memoryViewerStatsEl: refs.memoryViewerStatsEl,
      memoryViewerListEl: null,
      memoryViewerDetailEl: refs.memoryViewerDetailEl,
      memoryDreamBarEl: null,
      memoryDreamStatusEl: null,
      memoryDreamMetaEl: null,
      memoryDreamObsidianEl: null,
      memoryDreamSummaryEl: null,
      memoryDreamRefreshBtn: null,
      memoryDreamRunBtn: null,
      memoryDreamHistoryToggleBtn: null,
      memoryDreamHistoryEl: null,
      memoryDreamHistoryStatusEl: null,
      memoryDreamHistoryRefreshBtn: null,
      memoryDreamHistoryListEl: null,
      memoryDreamHistoryDetailEl: null,
      memoryTabTasksBtn: null,
      memoryTabMemoriesBtn: null,
      memoryTabSharedReviewBtn: null,
      memoryTabOutboundAuditBtn: null,
      memoryOutboundAuditFiltersEl: null,
      memoryOutboundAuditFocusAllBtn: null,
      memoryOutboundAuditFocusThreadsBtn: null,
      memorySharedReviewBatchBarEl: null,
      memoryTaskFiltersEl: null,
      memoryChunkFiltersEl: null,
      memorySearchInputEl: null,
      memoryTaskStatusFilterEl: null,
      memoryTaskSourceFilterEl: null,
      memoryChunkTypeFilterEl: null,
      memoryChunkVisibilityFilterEl: null,
      memoryChunkGovernanceFilterEl: null,
      memoryChunkCategoryFilterEl: null,
      memorySharedReviewFiltersEl: null,
      memorySharedReviewFocusFilterEl: null,
      memorySharedReviewTargetFilterEl: null,
      memorySharedReviewClaimedByFilterEl: null,
    },
    isConnected: () => true,
    sendReq: vi.fn(),
    makeId: () => "req-1",
    getMemoryViewerState: () => state,
    getSelectedAgentId: () => "default",
    getSelectedAgentLabel: () => "default",
    getAvailableAgents: () => [],
    syncMemoryTaskGoalFilterUi: vi.fn(),
    renderMemoryViewerListEmpty: vi.fn(),
    renderMemoryViewerDetailEmpty: vi.fn(),
    loadTaskDetail: vi.fn(),
    loadMemoryDetail: vi.fn(),
    escapeHtml: (value) => String(value ?? ""),
    formatCount: (value) => String(value ?? 0),
    formatDateTime: (value) => String(value ?? ""),
    formatDuration: (value) => String(value ?? ""),
    formatLineRange: () => "",
    formatScore: (value) => String(value ?? ""),
    formatMemoryCategory: (value) => String(value ?? ""),
    normalizeMemoryVisibility: (value) => String(value ?? ""),
    getVisibilityBadgeClass: () => "",
    summarizeSourcePath: (value) => String(value ?? ""),
    getTaskGoalId: () => "",
    getGoalDisplayName: () => "",
    getLatestExperienceUsageTimestamp: () => "",
    getActiveMemoryCategoryLabel: () => "",
    getMemoryCategoryDistributionViewModel: () => null,
    bindStatsAuditJumpLinks: vi.fn(),
    bindMemoryPathLinks: vi.fn(),
    bindTaskAuditJumpLinks: vi.fn(),
    openConversationSession: vi.fn(),
    showNotice: vi.fn(),
    t: (_key, _params, fallback) => fallback ?? "",
  });

  const detailRenderFeature = createMemoryDetailRenderFeature({
    refs,
    isConnected: () => true,
    sendReq: detailSendReq,
    makeId: () => "req-1",
    getMemoryViewerState: () => state,
    getMemoryViewerFeature: () => viewerFeature,
    getMemoryRuntimeFeature: () => runtime,
    getGoalDisplayName: () => "",
    getCurrentAgentSelection: () => "default",
    renderMemoryViewerDetailEmpty: vi.fn(),
    renderMemoryViewerStats: vi.fn(),
    loadTaskUsageOverview: detailLoadTaskUsageOverview,
    loadTaskDetail: detailLoadTaskDetail,
    loadCandidateDetail,
    openExperienceCandidate,
    openTaskFromAudit,
    openMemoryFromAudit: vi.fn(async () => {}),
    openSourcePath,
    loadGoals,
    switchMode,
    openGoalTaskViewer: vi.fn(async () => {}),
    showNotice: detailShowNotice,
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: (value) => String(value ?? ""),
    t: (_key, _params, fallback) => fallback ?? "",
  });

  return {
    refs,
    state,
    runtime,
    detailRenderFeature,
    detailLoadTaskDetail,
    detailLoadTaskUsageOverview,
    detailShowNotice,
    loadGoals,
    loadCandidateDetail,
    openSourcePath,
    openTaskFromAudit,
    openExperienceCandidate,
    switchMode,
  };
}

describe("memory detail render actions", () => {
  let previousWebConfig;

  beforeEach(() => {
    previousWebConfig = globalThis.BELLDANDY_WEB_CONFIG;
    globalThis.BELLDANDY_WEB_CONFIG = {
      ...(previousWebConfig && typeof previousWebConfig === "object" ? previousWebConfig : {}),
      governanceDetailMode: "full",
    };
  });

  afterEach(() => {
    if (previousWebConfig && typeof previousWebConfig === "object") {
      globalThis.BELLDANDY_WEB_CONFIG = previousWebConfig;
      return;
    }
    delete globalThis.BELLDANDY_WEB_CONFIG;
  });

  it("projects category distribution rows without returning HTML", () => {
    const { detailRenderFeature } = createHarness({ categoryFilterValue: "experience" });

    expect(detailRenderFeature.getMemoryCategoryDistributionViewModel({
      categoryBuckets: {
        preference: 1,
        experience: 99,
      },
      uncategorized: 0,
    })).toEqual({
      label: "Category Distribution",
      caption: "Library 100",
      rows: [
        {
          key: "preference",
          label: "Preference",
          count: "1",
          percent: "1.0%",
          widthPercent: 3,
          active: false,
        },
        {
          key: "experience",
          label: "Experience",
          count: "99",
          percent: "99%",
          widthPercent: 99,
          active: true,
        },
      ],
    });
    expect(detailRenderFeature.getMemoryCategoryDistributionViewModel({
      categoryBuckets: {},
      uncategorized: 0,
    })).toEqual({
      label: "Category Distribution",
      caption: "No categorized samples",
      rows: [],
    });
  });

  it("projects the task usage overview for a DOM owner without returning HTML", () => {
    const { state, detailRenderFeature } = createHarness();
    state.usageOverview = {
      loading: false,
      methods: [{
        assetKey: '<img src=x onerror=alert(1)>method',
        usageCount: 8,
        lastUsedAt: "2026-07-21T10:00:00.000Z",
        sourceCandidateId: "candidate-1",
        sourceCandidateTitle: "<script>Candidate</script>",
        lastUsedTaskId: "task-9",
        sourceCandidatePublishedPath: "methods/demo.md",
      }, {
        assetKey: "method-low",
        usageCount: 2,
        lastUsedAt: "2026-07-20T10:00:00.000Z",
      }],
      skills: [],
    };

    expect(detailRenderFeature.getTaskUsageOverviewViewModel()).toEqual({
      title: "Experience Usage Overview",
      caption: "Shown by cumulative global usage count",
      showLanes: true,
      lanes: [{
        tone: "method",
        title: "Hot Methods",
        topLabel: "Top 2",
        emptyLabel: "No records",
        items: [{
          assetKey: '<img src=x onerror=alert(1)>method',
          meta: [
            "candidate candidate-1",
            "<script>Candidate</script>",
            "Recent 2026-07-21T10:00:00.000Z",
          ],
          badges: [],
          actions: [
            { kind: "candidate", value: "candidate-1", label: "Candidate" },
            { kind: "task", value: "task-9", label: "Recent Task" },
            { kind: "source", value: "methods/demo.md", label: "Open Artifact" },
          ],
          barPercent: 100,
          metrics: "8",
        }, {
          assetKey: "method-low",
          meta: ["Recent 2026-07-20T10:00:00.000Z"],
          badges: [],
          actions: [],
          barPercent: 25,
          metrics: "2",
        }],
      }, {
        tone: "skill",
        title: "Hot Skills",
        topLabel: "",
        emptyLabel: "No records",
        items: [],
      }],
    });
    expect(detailRenderFeature.renderTaskUsageOverviewCard).toBeUndefined();
  });

  it("binds generate/review/stale actions in task detail", async () => {
    const { refs, state, runtime, detailRenderFeature } = createHarness();
    state.selectedCandidate = {
      id: "exp-skill-pending",
      taskId: "task-1",
      type: "skill",
      status: "draft",
      title: "技能候选",
      slug: "skill-demo",
      content: "# skill",
      summary: "summary",
      sourceTaskSnapshot: {},
      skillFreshness: {
        status: "needs_patch",
        skillKey: "demo skill",
        sourceCandidateId: "exp-skill-accepted",
        summary: "需要补丁",
        signals: [],
        suggestion: {
          kind: "review_patch_candidate",
          summary: "open patch",
          candidateId: "exp-patch-1",
        },
      },
    };
    state.selectedTask = {
      id: "task-1",
      conversationId: "conv-1",
      status: "success",
      source: "chat",
      title: "任务一",
      usedMethods: [],
      usedSkills: [
        {
          usageId: "usage-skill-1",
          taskId: "task-1",
          assetType: "skill",
          assetKey: "demo skill",
          usedVia: "tool",
          createdAt: "2026-04-20T00:00:00.000Z",
          usageCount: 1,
          lastUsedAt: "2026-04-20T00:00:00.000Z",
          lastUsedTaskId: "task-1",
          sourceCandidateId: "exp-skill-accepted",
          sourceCandidateStatus: "accepted",
          skillFreshness: {
            status: "warn_stale",
            skillKey: "demo skill",
            sourceCandidateId: "exp-skill-accepted",
            summary: "说明可能过期",
            signals: [],
            suggestion: {
              kind: "monitor",
              summary: "继续观察",
            },
          },
        },
      ],
      activities: [],
      toolCalls: [],
      memoryLinks: [],
      artifactPaths: [],
    };

    detailRenderFeature.renderTaskDetail(state.selectedTask);

    refs.memoryViewerDetailEl.querySelector("[data-generate-experience-type='method']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    refs.memoryViewerDetailEl.querySelector("[data-review-candidate-action='accept']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    refs.memoryViewerDetailEl.querySelector("[data-skill-freshness-stale-action='mark']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.generateExperienceCandidate).toHaveBeenCalledWith("task-1", "method");
    expect(runtime.reviewExperienceCandidate).toHaveBeenCalledWith("exp-skill-pending", "accept", { taskId: "task-1" });
    expect(runtime.updateSkillFreshnessStaleMark).toHaveBeenCalledWith({
      sourceCandidateId: "exp-skill-accepted",
      skillKey: "demo skill",
      taskId: "task-1",
      candidateId: "exp-skill-pending",
      stale: true,
    });
  });

  it("opens patch candidate from skill freshness detail", async () => {
    const { refs, state, detailRenderFeature, loadCandidateDetail } = createHarness();
    state.selectedCandidate = {
      id: "exp-skill-pending",
      taskId: "task-1",
      type: "skill",
      status: "draft",
      title: "技能候选",
      slug: "skill-demo",
      content: "# skill",
      summary: "summary",
      sourceTaskSnapshot: {},
      skillFreshness: {
        status: "needs_patch",
        skillKey: "demo skill",
        sourceCandidateId: "exp-skill-accepted",
        summary: "需要补丁",
        signals: [],
        suggestion: {
          kind: "review_patch_candidate",
          summary: "open patch",
          candidateId: "exp-patch-1",
        },
      },
    };
    state.selectedTask = {
      id: "task-1",
      conversationId: "conv-1",
      status: "success",
      source: "chat",
      title: "任务一",
      usedMethods: [],
      usedSkills: [],
      activities: [],
      toolCalls: [],
      memoryLinks: [],
      artifactPaths: [],
    };

    detailRenderFeature.renderTaskDetail(state.selectedTask);

    refs.memoryViewerDetailEl.querySelector("[data-open-candidate-id='exp-patch-1']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(loadCandidateDetail).toHaveBeenCalledWith("exp-patch-1");
  });

  it("opens experience workbench candidate entry from memory detail actions", async () => {
    const { refs, state, detailRenderFeature, openExperienceCandidate } = createHarness();
    state.selectedCandidate = {
      id: "exp-skill-pending",
      taskId: "task-1",
      type: "skill",
      status: "draft",
      title: "技能候选",
      slug: "skill-demo",
      content: "# skill",
      summary: "summary",
      sourceTaskSnapshot: {},
    };
    state.selectedTask = {
      id: "task-1",
      conversationId: "conv-1",
      status: "success",
      source: "chat",
      title: "任务一",
      usedMethods: [{ sourceCandidateId: "exp-method-1" }],
      usedSkills: [],
      activities: [],
      toolCalls: [],
      memoryLinks: [],
      artifactPaths: [],
    };

    detailRenderFeature.renderTaskDetail(state.selectedTask);
    refs.memoryViewerDetailEl.querySelector("[data-open-experience-candidate-id='exp-method-1']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    refs.memoryViewerDetailEl.querySelector("[data-open-experience-candidate-id='exp-skill-pending']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(openExperienceCandidate).toHaveBeenCalledWith("exp-method-1");
    expect(openExperienceCandidate).toHaveBeenCalledWith("exp-skill-pending");
  });

  it("routes source explanation reads through the disposable detail owner", async () => {
    const request = createDeferred();
    const detailSendReq = vi.fn(() => request.promise);
    const { refs, state, detailRenderFeature } = createHarness({ detailSendReq });
    state.selectedTask = {
      id: "task-1",
      conversationId: "conversation-1",
      status: "success",
      source: "chat",
      title: "Task one",
      usedMethods: [],
      usedSkills: [],
      activities: [],
      toolCalls: [],
      memoryLinks: [],
      artifactPaths: [],
      sourceExplanation: null,
      sourceExplanationError: "",
      sourceExplanationLoading: false,
    };

    detailRenderFeature.renderTaskDetail(state.selectedTask);
    refs.memoryViewerDetailEl.querySelector("[data-load-task-source-explanation]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(detailSendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "memory.explain_sources",
    }));
    expect(detailRenderFeature.getRuntimeSnapshot().pendingSourceExplanationReadCount).toBe(1);

    detailRenderFeature.dispose();
    expect(state.selectedTask.sourceExplanationLoading).toBe(false);
    request.resolve({
      ok: true,
      payload: { explanation: { taskId: "task-1", summary: "late explanation" } },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(state.selectedTask.sourceExplanation).toBeNull();
    expect(detailRenderFeature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingSourceExplanationReadCount: 0,
    });
  });

  it("routes usage revoke through the disposable detail action owner", async () => {
    const request = createDeferred();
    const detailSendReq = vi.fn(() => request.promise);
    const {
      state,
      detailRenderFeature,
      detailLoadTaskDetail,
      detailLoadTaskUsageOverview,
      detailShowNotice,
    } = createHarness({ detailSendReq });
    state.selectedTask = { id: "task-1" };

    const revoke = detailRenderFeature.revokeTaskUsage("usage-1", "task-1", "skill-demo");
    expect(state.pendingUsageRevokeId).toBe("usage-1");
    expect(detailRenderFeature.getRuntimeSnapshot()).toMatchObject({
      pendingSourceExplanationReadCount: 0,
      pendingUsageRevokeActionCount: 1,
    });

    detailRenderFeature.dispose();
    expect(state.pendingUsageRevokeId).toBeNull();
    request.resolve({ ok: true, payload: { revoked: true } });
    await revoke;

    expect(detailShowNotice).not.toHaveBeenCalled();
    expect(detailLoadTaskUsageOverview).not.toHaveBeenCalled();
    expect(detailLoadTaskDetail).not.toHaveBeenCalled();
    expect(detailRenderFeature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingSourceExplanationReadCount: 0,
      pendingUsageRevokeActionCount: 0,
    });
  });

  it("owns stats audit jump listeners through the detail lifecycle", () => {
    const { refs, detailRenderFeature, openTaskFromAudit } = createHarness();
    refs.memoryViewerStatsEl.innerHTML = `
      <button data-open-task-id="task-1">Task</button>
      <button data-open-source="C:/workspace/source.md">Source</button>
      <button data-open-candidate-id="candidate-1">Candidate</button>
      <button data-open-goal-id="goal-1">Goal</button>
    `;
    const taskButton = refs.memoryViewerStatsEl.querySelector("[data-open-task-id]");

    detailRenderFeature.bindStatsAuditJumpLinks();
    expect(detailRenderFeature.getRuntimeSnapshot().retainedStatsAuditListenerCount).toBe(4);

    detailRenderFeature.dispose();
    taskButton.click();

    expect(openTaskFromAudit).not.toHaveBeenCalled();
    expect(detailRenderFeature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      retainedStatsAuditListenerCount: 0,
    });
  });

  it("owns detail path listeners through the detail lifecycle", () => {
    const { refs, detailRenderFeature, openSourcePath } = createHarness();
    refs.memoryViewerDetailEl.innerHTML = `
      <button data-open-source="C:/workspace/source.md" data-open-line="42">Source</button>
    `;
    const pathButton = refs.memoryViewerDetailEl.querySelector("[data-open-source]");

    detailRenderFeature.bindMemoryPathLinks();
    expect(detailRenderFeature.getRuntimeSnapshot().retainedMemoryPathListenerCount).toBe(1);

    detailRenderFeature.dispose();
    pathButton.click();

    expect(openSourcePath).not.toHaveBeenCalled();
    expect(detailRenderFeature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      retainedMemoryPathListenerCount: 0,
    });
  });

  it("owns task audit listeners through the detail lifecycle", () => {
    const { refs, detailRenderFeature, openTaskFromAudit } = createHarness();
    refs.memoryViewerDetailEl.innerHTML = `
      <button data-open-task-id="task-1">Task</button>
      <button data-open-candidate-id="candidate-1">Candidate</button>
    `;
    const taskButton = refs.memoryViewerDetailEl.querySelector("[data-open-task-id]");

    detailRenderFeature.bindTaskAuditJumpLinks();
    expect(detailRenderFeature.getRuntimeSnapshot().retainedTaskAuditListenerCount).toBe(2);

    detailRenderFeature.dispose();
    taskButton.click();

    expect(openTaskFromAudit).not.toHaveBeenCalled();
    expect(detailRenderFeature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      retainedTaskAuditListenerCount: 0,
    });
  });

  it("owns rendered usage revoke button listeners without retaining the task body", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { refs, state, detailRenderFeature } = createHarness();
      state.selectedTask = {
        id: "task-1",
        conversationId: "conversation-1",
        status: "success",
        source: "chat",
        title: "Task one",
        usedMethods: [{
          usageId: "usage-1",
          taskId: "task-1",
          assetKey: "method-demo",
          usedVia: "tool",
          usageCount: 1,
        }],
        usedSkills: [],
        activities: [],
        toolCalls: [],
        memoryLinks: [],
        artifactPaths: [],
      };

      detailRenderFeature.renderTaskDetail(state.selectedTask);
      const revokeButton = refs.memoryViewerDetailEl.querySelector("[data-revoke-usage-id]");
      expect(detailRenderFeature.getRuntimeSnapshot().retainedUsageRevokeButtonListenerCount).toBe(1);

      detailRenderFeature.dispose();
      revokeButton.click();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(detailRenderFeature.getRuntimeSnapshot()).toMatchObject({
        disposed: true,
        retainedUsageRevokeButtonListenerCount: 0,
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
