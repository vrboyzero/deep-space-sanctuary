// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDreamRuntimeBarView,
  buildEmailThreadConversationAdvicePrompt,
  buildEmailThreadConversationOpenNote,
  buildMemoryDetailCollapsedPreview,
  buildSharedReviewBatchActionState,
  buildSharedReviewQueueParams,
  collectActionableSharedReviewIds,
  createMemoryViewerFeature,
  createDefaultMemoryViewerAgentViewState,
  extractCandidateContextTargets,
  extractTaskContextTargets,
  formatDreamFallbackReasonLabel,
  formatDreamGenerationModeLabel,
  getMemoryViewerListPageSize,
  normalizeMemoryViewerAgentViewState,
  paginateMemoryViewerItems,
} from "./memory-viewer.js";
import { buildDreamHistoryPanelView } from "./memory-viewer-dream-history.js";

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

function createDedupHarness(sendReqImpl = vi.fn(), options = {}) {
  document.body.innerHTML = `
    <section id="memoryViewerSection">
      <div id="memoryViewerTitle"></div>
      <div id="memoryViewerStats"></div>
      <div id="memoryViewerList"></div>
      <div id="memoryViewerDetail"></div>
      <button id="memoryTabTasks"></button>
      <button id="memoryTabMemories"></button>
      <button id="memoryTabSharedReview"></button>
      <button id="memoryTabOutboundAudit"></button>
      <div id="memoryTaskFilters"></div>
      <div id="memoryChunkFilters"></div>
      <input id="memorySearchInput" />
      <button id="memoryDedupPreviewBtn" class="hidden"></button>
      <select id="memoryTaskStatusFilter"></select>
      <select id="memoryTaskSourceFilter"></select>
      <select id="memoryChunkTypeFilter"><option value=""></option><option value="daily">daily</option></select>
      <select id="memoryChunkVisibilityFilter"><option value=""></option></select>
      <select id="memoryChunkGovernanceFilter"><option value=""></option><option value="pending">pending</option></select>
      <select id="memoryChunkCategoryFilter"><option value=""></option><option value="experience">experience</option></select>
      <div id="memorySharedReviewFilters"></div>
      <select id="memorySharedReviewFocusFilter"></select>
      <select id="memorySharedReviewTargetFilter"></select>
      <select id="memorySharedReviewClaimedByFilter"></select>
      <div id="memoryOutboundAuditFilters"></div>
      <button id="memoryOutboundAuditFocusAll"></button>
      <button id="memoryOutboundAuditFocusThreads"></button>
      <div id="memorySharedReviewBatchBar"></div>
    </section>
    <div id="memoryDreamModal"></div>
    <div id="memoryDreamBar"></div>
    <div id="memoryDreamStatus"></div>
    <div id="memoryDreamMeta"></div>
    <div id="memoryDreamObsidian"></div>
    <div id="memoryDreamSummary"></div>
    <button id="memoryDreamRefresh"></button>
    <button id="memoryDreamRun"></button>
    <button id="memoryDreamHistoryToggle"></button>
    <div id="memoryDreamHistory"></div>
    <div id="memoryDreamHistoryStatus"></div>
    <button id="memoryDreamHistoryRefresh"></button>
    <div id="memoryDreamHistoryList"></div>
    <div id="memoryDreamHistoryDetail"></div>
    <button id="memoryDreamModalTrigger"></button>
    <button id="memoryDreamModalClose"></button>
    <div id="memoryDedupModal" class="hidden">
      <div id="memoryDedupModalTitle"></div>
      <div id="memoryDedupModalSummary"></div>
      <div id="memoryDedupModalStatus" class="hidden"></div>
      <div id="memoryDedupModalWarning" class="hidden"></div>
      <div id="memoryDedupModalList"></div>
      <button id="memoryDedupModalClose"></button>
      <button id="memoryDedupModalCancel"></button>
      <button id="memoryDedupModalSubmit"></button>
    </div>
  `;

  const state = {
    tab: "tasks",
    listPageByTab: {},
    items: [],
    stats: null,
    selectedId: null,
    selectedTask: null,
    selectedCandidate: null,
    outboundAuditFocus: "all",
    memoryEvaluation: null,
    sharedReviewSummary: null,
    selectedSharedReviewIds: [],
    sharedReviewBatchBusy: false,
    dreamRuntime: null,
    dreamCommons: null,
    dreamBusy: false,
    dreamHistoryOpen: false,
    dreamHistoryLoading: false,
    dreamHistoryError: "",
    dreamHistoryItems: [],
    selectedDreamHistoryId: null,
    selectedDreamHistoryItem: null,
    selectedDreamHistoryContent: "",
    dreamHistoryDetailLoading: false,
    dreamHistoryDetailError: "",
    dreamHistorySeq: 0,
    dreamHistoryDetailSeq: 0,
    requestToken: 0,
    activeAgentId: "default",
    agentViewStates: {},
    dedupModal: {
      open: false,
      loading: false,
      applying: false,
      error: "",
      report: null,
      result: null,
    },
  };

  const refs = {
    memoryViewerSection: document.getElementById("memoryViewerSection"),
    memoryViewerTitleEl: document.getElementById("memoryViewerTitle"),
    memoryViewerStatsEl: document.getElementById("memoryViewerStats"),
    memoryViewerListEl: document.getElementById("memoryViewerList"),
    memoryViewerDetailEl: document.getElementById("memoryViewerDetail"),
    memoryDreamModalTriggerBtn: document.getElementById("memoryDreamModalTrigger"),
    memoryDreamModalEl: document.getElementById("memoryDreamModal"),
    memoryDreamModalTitleEl: document.getElementById("memoryDreamModalTitle"),
    memoryDreamModalCloseBtn: document.getElementById("memoryDreamModalClose"),
    memoryDreamBarEl: document.getElementById("memoryDreamBar"),
    memoryDreamStatusEl: document.getElementById("memoryDreamStatus"),
    memoryDreamMetaEl: document.getElementById("memoryDreamMeta"),
    memoryDreamObsidianEl: document.getElementById("memoryDreamObsidian"),
    memoryDreamSummaryEl: document.getElementById("memoryDreamSummary"),
    memoryDreamRefreshBtn: document.getElementById("memoryDreamRefresh"),
    memoryDreamRunBtn: document.getElementById("memoryDreamRun"),
    memoryDreamHistoryToggleBtn: document.getElementById("memoryDreamHistoryToggle"),
    memoryDreamHistoryEl: document.getElementById("memoryDreamHistory"),
    memoryDreamHistoryStatusEl: document.getElementById("memoryDreamHistoryStatus"),
    memoryDreamHistoryRefreshBtn: document.getElementById("memoryDreamHistoryRefresh"),
    memoryDreamHistoryListEl: document.getElementById("memoryDreamHistoryList"),
    memoryDreamHistoryDetailEl: document.getElementById("memoryDreamHistoryDetail"),
    memoryTabTasksBtn: document.getElementById("memoryTabTasks"),
    memoryTabMemoriesBtn: document.getElementById("memoryTabMemories"),
    memoryTabSharedReviewBtn: document.getElementById("memoryTabSharedReview"),
    memoryTabOutboundAuditBtn: document.getElementById("memoryTabOutboundAudit"),
    memoryOutboundAuditFiltersEl: document.getElementById("memoryOutboundAuditFilters"),
    memoryOutboundAuditFocusAllBtn: document.getElementById("memoryOutboundAuditFocusAll"),
    memoryOutboundAuditFocusThreadsBtn: document.getElementById("memoryOutboundAuditFocusThreads"),
    memorySharedReviewBatchBarEl: document.getElementById("memorySharedReviewBatchBar"),
    memoryTaskFiltersEl: document.getElementById("memoryTaskFilters"),
    memoryChunkFiltersEl: document.getElementById("memoryChunkFilters"),
    memorySearchInputEl: document.getElementById("memorySearchInput"),
    memoryDedupPreviewBtn: document.getElementById("memoryDedupPreviewBtn"),
    memoryTaskStatusFilterEl: document.getElementById("memoryTaskStatusFilter"),
    memoryTaskSourceFilterEl: document.getElementById("memoryTaskSourceFilter"),
    memoryChunkTypeFilterEl: document.getElementById("memoryChunkTypeFilter"),
    memoryChunkVisibilityFilterEl: document.getElementById("memoryChunkVisibilityFilter"),
    memoryChunkGovernanceFilterEl: document.getElementById("memoryChunkGovernanceFilter"),
    memoryChunkCategoryFilterEl: document.getElementById("memoryChunkCategoryFilter"),
    memorySharedReviewFiltersEl: document.getElementById("memorySharedReviewFilters"),
    memorySharedReviewFocusFilterEl: document.getElementById("memorySharedReviewFocusFilter"),
    memorySharedReviewTargetFilterEl: document.getElementById("memorySharedReviewTargetFilter"),
    memorySharedReviewClaimedByFilterEl: document.getElementById("memorySharedReviewClaimedByFilter"),
    memoryDedupModalEl: document.getElementById("memoryDedupModal"),
    memoryDedupModalTitleEl: document.getElementById("memoryDedupModalTitle"),
    memoryDedupModalSummaryEl: document.getElementById("memoryDedupModalSummary"),
    memoryDedupModalStatusEl: document.getElementById("memoryDedupModalStatus"),
    memoryDedupModalWarningEl: document.getElementById("memoryDedupModalWarning"),
    memoryDedupModalListEl: document.getElementById("memoryDedupModalList"),
    memoryDedupModalCloseBtn: document.getElementById("memoryDedupModalClose"),
    memoryDedupModalCancelBtn: document.getElementById("memoryDedupModalCancel"),
    memoryDedupModalSubmitBtn: document.getElementById("memoryDedupModalSubmit"),
  };

  const sendReq = typeof sendReqImpl === "function" ? sendReqImpl : vi.fn(sendReqImpl);
  const showNotice = vi.fn();
  const feature = createMemoryViewerFeature({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: (() => {
      let seq = 0;
      return () => `req-${++seq}`;
    })(),
    getMemoryViewerState: () => state,
    getSelectedAgentId: () => "default",
    getSelectedAgentLabel: () => "Belldandy",
    getAvailableAgents: () => [],
    syncMemoryTaskGoalFilterUi: vi.fn(),
    renderMemoryViewerListEmpty: vi.fn(),
    renderMemoryViewerDetailEmpty: vi.fn(),
    loadTaskDetail: vi.fn(),
    loadMemoryDetail: vi.fn(),
    escapeHtml: (value) => String(value ?? ""),
    formatCount: (value) => String(Number.isFinite(Number(value)) ? Number(value) : 0),
    formatDateTime: (value) => String(value ?? "-"),
    formatDuration: (value) => String(value ?? "-"),
    formatLineRange: (start, end) => (typeof start === "number" || typeof end === "number" ? `${start ?? "?"}-${end ?? "?"}` : "-"),
    formatScore: (value) => String(value ?? "-"),
    formatMemoryCategory: (value) => String(value ?? "-"),
    normalizeMemoryVisibility: (value) => value,
    getVisibilityBadgeClass: () => "",
    summarizeSourcePath: (value) => String(value ?? ""),
    getTaskGoalId: () => "",
    getGoalDisplayName: () => "",
    getLatestExperienceUsageTimestamp: () => "",
    getActiveMemoryCategoryLabel: () => "",
    renderMemoryCategoryDistribution: () => "",
    renderTaskUsageOverviewCard: () => "",
    bindStatsAuditJumpLinks: vi.fn(),
    bindMemoryPathLinks: vi.fn(),
    bindTaskAuditJumpLinks: vi.fn(),
    openConversationSession: vi.fn(),
    emailThreadAdviceRetention: options.emailThreadAdviceRetention,
    showNotice,
    t: (_key, _params, fallback) => fallback ?? "",
  });

  return { refs, state, sendReq, showNotice, feature };
}

describe("memory viewer load lifecycle", () => {
  it("forwards dispose into the top-level load owner", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const { feature, state } = createDedupHarness(vi.fn(() => request));

    const load = feature.loadMemoryViewer();
    expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(1);
    const requestTokenBeforeDispose = state.requestToken;

    feature.dispose();
    expect(state.requestToken).toBe(requestTokenBeforeDispose + 1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingLoadRequestCount: 1,
    });

    resolveRequest({ ok: false });
    await load;
    expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(0);
  });

  it("clears retained MemoryViewer bodies through the main dispose wiring", () => {
    const { feature, refs, state } = createDedupHarness();
    state.items = [{ id: "private-item", content: "private body" }];
    state.selectedId = "private-item";
    state.selectedDreamHistoryContent = "private dream body";
    state.dreamHistoryItems = [{ id: "private-dream" }];
    refs.memoryViewerListEl.textContent = "private list";
    refs.memoryViewerDetailEl.textContent = "private detail";
    refs.memoryDreamHistoryDetailEl.textContent = "private dream detail";

    feature.dispose();

    expect(state.items).toEqual([]);
    expect(state.selectedId).toBeNull();
    expect(state.selectedDreamHistoryContent).toBe("");
    expect(refs.memoryViewerListEl.textContent).toBe("");
    expect(refs.memoryViewerDetailEl.textContent).toBe("");
    expect(refs.memoryDreamHistoryDetailEl.textContent).toBe("");
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      retainedItemCount: 0,
      retainedDreamHistoryItemCount: 0,
      populatedDomCount: 0,
    });
  });

  it("settles stale Dream history load through the main lifecycle wiring", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, state } = createDedupHarness(vi.fn(() => request));
    const load = feature.loadDreamHistory();
    expect(feature.getRuntimeSnapshot().pendingDreamHistoryListRequestCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: true, payload: { items: [{ id: "dream-late" }] } });
    await load;

    expect(state.dreamHistoryItems).toEqual([]);
    expect(feature.getRuntimeSnapshot().pendingDreamHistoryRequestCount).toBe(0);
  });

  it("settles stale Dream Commons status through the main lifecycle wiring", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, state } = createDedupHarness(vi.fn(() => request));
    const load = feature.loadDreamCommonsStatus();
    expect(feature.getRuntimeSnapshot().pendingDreamRuntimeCommonsRequestCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: true, payload: { headline: "late Commons body" } });
    await load;

    expect(state.dreamCommons).toBeNull();
    expect(feature.getRuntimeSnapshot().pendingDreamRuntimeRequestCount).toBe(0);
  });

  it("settles stale Dream run through the main action wiring", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, state } = createDedupHarness(vi.fn(() => request));
    const run = feature.runDream();
    expect(feature.getRuntimeSnapshot().pendingDreamRunActionCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: true, payload: { record: { summary: "late Dream" } } });
    await run;

    expect(state.dreamRuntime).toBeNull();
    expect(state.dreamBusy).toBe(false);
    expect(feature.getRuntimeSnapshot().pendingDreamRunActionCount).toBe(0);
  });

  it("settles stale shared promotion through the real detail action wiring", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, sendReq } = createDedupHarness(vi.fn(() => request));
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("manual promotion");
    try {
      feature.renderMemoryDetail({
        id: "chunk-1",
        content: "private memory",
        visibility: "private",
        sourceView: { scope: "private" },
      });
      document.querySelector("[data-memory-share-promote]").click();
      expect(feature.getRuntimeSnapshot().pendingMemorySharePromoteActionCount).toBe(1);

      feature.dispose();
      resolveRequest({ ok: true, payload: { promotedCount: 1 } });
      await vi.waitFor(() => {
        expect(feature.getRuntimeSnapshot().pendingMemorySharePromoteActionCount).toBe(0);
      });

      expect(sendReq).toHaveBeenCalledTimes(1);
    } finally {
      promptSpy.mockRestore();
    }
  });

  it("settles stale shared claim through the real detail action wiring", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, sendReq } = createDedupHarness(vi.fn(() => request));
    feature.renderMemoryDetail({
      id: "chunk-1",
      content: "pending shared memory",
      visibility: "private",
      sourceView: { scope: "private" },
      metadata: { sharedPromotion: { status: "pending" } },
    });
    document.querySelector('[data-memory-share-claim="claim"]').click();
    expect(feature.getRuntimeSnapshot().pendingMemoryShareClaimActionCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: true, payload: { claimedCount: 1 } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingMemoryShareClaimActionCount).toBe(0);
    });

    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "memory.share.claim" }));
  });

  it("settles stale shared review through the real detail action wiring", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, sendReq } = createDedupHarness(vi.fn(() => request));
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("review note");
    try {
      feature.renderMemoryDetail({
        id: "chunk-1",
        content: "pending shared memory",
        visibility: "private",
        sourceView: { scope: "private" },
        metadata: { sharedPromotion: { status: "pending" } },
      });
      document.querySelector('[data-memory-share-decision="approved"]').click();
      expect(feature.getRuntimeSnapshot().pendingMemoryShareReviewActionCount).toBe(1);

      feature.dispose();
      resolveRequest({ ok: true, payload: { reviewedCount: 1 } });
      await vi.waitFor(() => {
        expect(feature.getRuntimeSnapshot().pendingMemoryShareReviewActionCount).toBe(0);
      });

      expect(sendReq).toHaveBeenCalledTimes(1);
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "memory.share.review" }));
    } finally {
      promptSpy.mockRestore();
    }
  });

  it("settles stale shared batch action through the real batch bar wiring", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, sendReq, state } = createDedupHarness(vi.fn(() => request));
    state.tab = "sharedReview";
    state.items = [{
      id: "chunk-1",
      reviewStatus: "pending",
      actionableByReviewer: true,
    }];
    state.selectedSharedReviewIds = ["chunk-1"];
    feature.syncMemoryViewerUi();
    document.querySelector('[data-shared-review-batch-action="claim"]').click();
    expect(feature.getRuntimeSnapshot().pendingMemoryShareBatchActionCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: true, payload: { claimedCount: 1 } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingMemoryShareBatchActionCount).toBe(0);
    });

    expect(state.sharedReviewBatchBusy).toBe(false);
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "memory.share.claim" }));
  });

  it("clears the batch bar and blocks every public ingress after dispose", async () => {
    const { feature, refs, sendReq, state } = createDedupHarness();
    state.tab = "sharedReview";
    state.items = [{ id: "chunk-1", reviewStatus: "pending", actionableByReviewer: true }];
    state.selectedSharedReviewIds = ["chunk-1"];
    feature.syncMemoryViewerUi();
    expect(refs.memorySharedReviewBatchBarEl.textContent).not.toBe("");

    feature.dispose();
    expect(refs.memorySharedReviewBatchBarEl.textContent).toBe("");
    const stateAfterDispose = JSON.stringify(state);
    const requestTokenAfterDispose = state.requestToken;
    const statsAfterDispose = refs.memoryViewerStatsEl.innerHTML;
    const sharedFiltersAfterDispose = refs.memorySharedReviewTargetFilterEl.innerHTML;

    feature.applyAgentViewState("late-agent", "memories");
    feature.captureAgentViewState("late-agent");
    feature.clearDreamHistoryState({ preserveOpen: false });
    feature.closeDreamModal();
    feature.closeDedupModal();
    feature.openDreamModal();
    feature.switchMemoryViewerTab("memories");
    feature.switchOutboundAuditFocus("threads");
    feature.syncMemoryViewerUi();
    feature.syncMemoryViewerHeaderTitle();
    feature.syncSharedReviewFilterUi();
    feature.toggleDreamHistory();
    feature.renderCandidateOnlyDetail(null);
    feature.renderExternalOutboundAuditDetail(null);
    feature.renderExternalOutboundAuditList([]);
    feature.renderDreamHistoryPanel();
    feature.renderDreamModal();
    feature.renderDreamRuntimeBar();
    feature.renderDedupModal();
    feature.renderMemoryDetail(null);
    feature.renderMemoryList([]);
    feature.renderMemoryViewerStats({ files: 99 });
    feature.renderSharedReviewList([]);
    feature.renderTaskList([]);
    expect(feature.renderCandidateDetailPanel({ id: "late-candidate" })).toBe("");

    await Promise.all([
      feature.applyDedupFromModal(),
      feature.loadDreamCommonsStatus(),
      feature.loadDreamHistory(),
      feature.loadDreamHistoryDetail("dream-late"),
      feature.loadDreamRuntimeStatus(),
      feature.loadExternalOutboundAuditViewer(),
      feature.loadMemoryChunkViewer(),
      feature.loadMemoryViewer(),
      feature.loadMemoryViewerStats(),
      feature.loadSharedReviewQueue(),
      feature.loadTaskUsageOverview(),
      feature.loadTaskViewer(),
      feature.openDedupModal(),
      feature.runDream(),
    ]);

    expect(JSON.stringify(state)).toBe(stateAfterDispose);
    expect(state.requestToken).toBe(requestTokenAfterDispose);
    expect(refs.memoryViewerStatsEl.innerHTML).toBe(statsAfterDispose);
    expect(refs.memorySharedReviewTargetFilterEl.innerHTML).toBe(sharedFiltersAfterDispose);
    expect(sendReq).not.toHaveBeenCalled();
  });

  it("tracks a direct public loader through stale physical settlement", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, state } = createDedupHarness(vi.fn(() => request));
    const load = feature.loadTaskViewer();
    expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: true, payload: { items: [{ id: "task-late" }] } });
    await load;

    expect(state.items).toEqual([]);
    expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(0);
  });

  it("tracks shared review context navigation through stale physical settlement", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const { feature, state } = createDedupHarness(vi.fn(() => request));
    feature.renderMemoryDetail({
      id: "chunk-1",
      content: "pending shared memory",
      visibility: "private",
      sourceView: { scope: "private" },
      metadata: { sharedPromotion: { status: "pending" } },
    });
    document.querySelector("[data-memory-open-shared-review-context]").click();
    expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: true, payload: { items: [{ id: "chunk-late" }] } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(0);
    });

    expect(state.items).toEqual([]);
    expect(state.selectedId).toBeNull();
  });
});

describe("memory viewer shared review filters", () => {
  it("settles email thread advice retention through the real click path", async () => {
    const lease = { conversationId: "conversation-email-1", generation: 0, token: 1 };
    const retention = {
      begin: vi.fn(() => lease),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    const sendReq = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: { message: "retry" } });
    const { refs, feature } = createDedupHarness(sendReq, {
      emailThreadAdviceRetention: retention,
    });
    const item = {
      auditKind: "email_thread_organizer",
      conversationId: "conversation-email-1",
      latestSubject: "Re: Retention",
    };

    feature.renderExternalOutboundAuditDetail(item);
    refs.memoryViewerDetailEl.querySelector("[data-open-email-thread-conversation]").click();
    await Promise.resolve();

    expect(retention.begin).toHaveBeenCalledWith("conversation-email-1");
    expect(retention.succeed).toHaveBeenCalledWith(lease);
    expect(retention.fail).not.toHaveBeenCalled();

    refs.memoryViewerDetailEl.querySelector("[data-open-email-thread-conversation]").click();
    await Promise.resolve();

    expect(retention.fail).toHaveBeenCalledWith(lease);
  });

  it("settles stale email thread advice without retention or notice side effects", async () => {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const lease = { conversationId: "conversation-email-1", generation: 0, token: 1 };
    const retention = {
      begin: vi.fn(() => lease),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    const { refs, feature, showNotice } = createDedupHarness(vi.fn(() => request), {
      emailThreadAdviceRetention: retention,
    });
    feature.renderExternalOutboundAuditDetail({
      auditKind: "email_thread_organizer",
      conversationId: "conversation-email-1",
      latestSubject: "Re: Lifecycle",
    });
    refs.memoryViewerDetailEl.querySelector("[data-open-email-thread-conversation]").click();
    expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(1);

    feature.dispose();
    resolveRequest({ ok: false, error: { message: "late failure" } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingLoadRequestCount).toBe(0);
    });

    expect(retention.succeed).not.toHaveBeenCalled();
    expect(retention.fail).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("builds an explicit advice request prompt for opened email thread conversations", () => {
    const prompt = buildEmailThreadConversationAdvicePrompt({
      latestSubject: "Re: Kickoff",
      latestTriageSummary: "需要尽快回复并确认时间",
      latestSuggestedReplyStarter: "Hi Alice,",
      latestSuggestedReplyQuality: "review_required",
    });

    expect(prompt).toContain("我刚从邮件线程整理打开了这个线程");
    expect(prompt).toContain("线程整理摘要: 需要尽快回复并确认时间");
    expect(prompt).toContain("建议回复 starter: Hi Alice,");
  });

  it("builds a compact organizer note for opening email thread conversations", () => {
    expect(buildEmailThreadConversationOpenNote({
      latestTriageSummary: "需要尽快回复并确认时间",
      latestSuggestedReplySubject: "Re: Kickoff",
      latestSuggestedReplyStarter: "Hi Alice,",
      latestSuggestedReplyQuality: "review_required",
      latestSuggestedReplyConfidence: "medium",
      latestSuggestedReplyWarnings: ["先核对日期。"],
      latestSuggestedReplyDraft: [
        "Hi Alice,",
        "",
        "Thanks for following up.",
        "I am checking the schedule now.",
        "Will confirm the final time by tomorrow.",
      ].join("\n"),
    })).toContain("线程整理摘要: 需要尽快回复并确认时间");

    expect(buildEmailThreadConversationOpenNote({
      latestTriageSummary: "需要尽快回复并确认时间",
      latestSuggestedReplySubject: "Re: Kickoff",
      latestSuggestedReplyStarter: "Hi Alice,",
      latestSuggestedReplyQuality: "review_required",
      latestSuggestedReplyConfidence: "medium",
      latestSuggestedReplyWarnings: ["先核对日期。"],
      latestSuggestedReplyDraft: [
        "Hi Alice,",
        "",
        "Thanks for following up.",
        "I am checking the schedule now.",
        "Will confirm the final time by tomorrow.",
      ].join("\n"),
    })).toContain("建议回复草稿摘录");
  });

  it("defaults shared review queue to pending status", () => {
    expect(buildSharedReviewQueueParams({
      reviewerAgentId: "coder",
    })).toEqual({
      limit: 50,
      reviewerAgentId: "coder",
      filter: {
        sharedPromotionStatus: "pending",
      },
    });
  });

  it("maps actionable focus and target agent filters into queue params", () => {
    expect(buildSharedReviewQueueParams({
      reviewerAgentId: "coder",
      query: "timeout",
      governanceStatus: "approved",
      sharedReviewFilters: {
        focus: "actionable",
        targetAgentId: "default",
      },
    })).toEqual({
      limit: 50,
      reviewerAgentId: "coder",
      query: "timeout",
      filter: {
        sharedPromotionStatus: "approved",
        actionableOnly: true,
        targetAgentId: "default",
      },
    });
  });

  it("maps my-claims focus and explicit claimed owner filters correctly", () => {
    expect(buildSharedReviewQueueParams({
      reviewerAgentId: "reviewer",
      sharedReviewFilters: {
        focus: "mine",
      },
    })).toEqual({
      limit: 50,
      reviewerAgentId: "reviewer",
      filter: {
        sharedPromotionStatus: "pending",
        claimedByAgentId: "reviewer",
      },
    });

    expect(buildSharedReviewQueueParams({
      reviewerAgentId: "reviewer",
      sharedReviewFilters: {
        claimedByAgentId: "coder",
      },
    })).toEqual({
      limit: 50,
      reviewerAgentId: "reviewer",
      filter: {
        sharedPromotionStatus: "pending",
        claimedByAgentId: "coder",
      },
    });
  });

  it("derives batch action counts from selected shared review items", () => {
    const state = buildSharedReviewBatchActionState([
      {
        id: "claimable",
        reviewStatus: "pending",
        claimTimedOut: false,
        actionableByReviewer: true,
      },
      {
        id: "mine",
        reviewStatus: "pending",
        claimOwner: "reviewer",
        claimTimedOut: false,
        actionableByReviewer: true,
      },
      {
        id: "overdue",
        reviewStatus: "pending",
        claimOwner: "coder",
        claimTimedOut: true,
        actionableByReviewer: true,
      },
      {
        id: "approved",
        reviewStatus: "approved",
      },
      {
        id: "blocked",
        reviewStatus: "pending",
        claimOwner: "coder",
        claimTimedOut: false,
        actionableByReviewer: false,
      },
    ], ["claimable", "mine", "overdue", "approved", "blocked"], "reviewer");

    expect(state.selectedCount).toBe(5);
    expect(state.actions.claim.map((item) => item.id)).toEqual(["claimable", "overdue"]);
    expect(state.actions.release.map((item) => item.id)).toEqual(["mine"]);
    expect(state.actions.approved.map((item) => item.id)).toEqual(["claimable", "mine", "overdue"]);
    expect(state.actions.rejected.map((item) => item.id)).toEqual(["claimable", "mine", "overdue"]);
    expect(state.actions.revoked.map((item) => item.id)).toEqual(["approved"]);
  });

  it("collects only currently actionable shared review ids", () => {
    expect(collectActionableSharedReviewIds([
      {
        id: "claimable",
        reviewStatus: "pending",
        actionableByReviewer: true,
      },
      {
        id: "mine",
        reviewStatus: "pending",
        claimOwner: "reviewer",
        actionableByReviewer: true,
      },
      {
        id: "approved",
        reviewStatus: "approved",
      },
      {
        id: "blocked",
        reviewStatus: "pending",
        claimOwner: "coder",
        actionableByReviewer: false,
      },
    ], "reviewer")).toEqual(["claimable", "mine", "approved"]);
  });

  it("extracts task context entry targets from linked memories and usage records", () => {
    expect(extractTaskContextTargets({
      memoryLinks: [{ chunkId: "mem_a" }, { chunkId: " mem_a " }, { chunkId: "mem_b" }],
      artifactPaths: [" docs/a.md ", "", "docs/b.md"],
      usedMethods: [{ sourceCandidateId: "cand_method" }],
      usedSkills: [{ sourceCandidateId: "cand_skill" }, { sourceCandidateId: "cand_method" }],
    })).toEqual({
      firstMemoryId: "mem_a",
      memoryCount: 2,
      firstArtifactPath: "docs/a.md",
      artifactCount: 2,
      firstCandidateId: "cand_method",
      candidateCount: 2,
    });
  });

  it("extracts candidate context entry targets from source snapshot", () => {
    expect(extractCandidateContextTargets({
      taskId: "task_source_1",
      publishedPath: " methods/demo.md ",
      sourceTaskSnapshot: {
        conversationId: "goal:goal_demo",
        memoryLinks: [{ chunkId: "mem_source_1" }, { chunkId: " mem_source_1 " }, { chunkId: "mem_source_2" }],
        artifactPaths: [" artifacts/out.md ", "artifacts/log.md"],
      },
    })).toEqual({
      sourceTaskId: "task_source_1",
      sourceConversationId: "goal:goal_demo",
      firstMemoryId: "mem_source_1",
      memoryCount: 2,
      firstArtifactPath: "artifacts/out.md",
      artifactCount: 2,
      publishedPath: "methods/demo.md",
    });
  });

  it("creates a clean default memory viewer view state for a resident agent", () => {
    expect(createDefaultMemoryViewerAgentViewState("outboundAudit")).toEqual({
      tab: "outboundAudit",
      outboundAuditFocus: "all",
      searchQuery: "",
      taskStatus: "",
      taskSource: "",
      memoryType: "",
      memoryVisibility: "",
      memoryGovernance: "",
      sharedReviewGovernance: "pending",
      memoryCategory: "",
      sharedReviewFilters: {
        focus: "",
        targetAgentId: "",
        claimedByAgentId: "",
      },
      goalIdFilter: null,
    });
  });

  it("normalizes persisted memory viewer agent view state before restoring filters", () => {
    expect(normalizeMemoryViewerAgentViewState({
      tab: " outboundAudit ",
      outboundAuditFocus: " threads ",
      searchQuery: " note ",
      taskStatus: " done ",
      taskSource: " cron ",
      memoryType: " decision ",
      memoryVisibility: " shared ",
      memoryGovernance: " pending ",
      sharedReviewGovernance: " approved ",
      memoryCategory: " architecture ",
      sharedReviewFilters: {
        focus: "mine",
        targetAgentId: " default ",
        claimedByAgentId: " reviewer ",
      },
      goalIdFilter: " goal_demo ",
    }, "tasks")).toEqual({
      tab: "outboundAudit",
      outboundAuditFocus: "threads",
      searchQuery: "note",
      taskStatus: "done",
      taskSource: "cron",
      memoryType: "decision",
      memoryVisibility: "shared",
      memoryGovernance: "pending",
      sharedReviewGovernance: "approved",
      memoryCategory: "architecture",
      sharedReviewFilters: {
        focus: "mine",
        targetAgentId: "default",
        claimedByAgentId: "reviewer",
      },
      goalIdFilter: "goal_demo",
    });
  });

  it("uses smaller page sizes for heavy memory viewer lists", () => {
    expect(getMemoryViewerListPageSize("tasks")).toBe(20);
    expect(getMemoryViewerListPageSize("memories")).toBe(20);
    expect(getMemoryViewerListPageSize("sharedReview")).toBe(25);
    expect(getMemoryViewerListPageSize("outboundAudit")).toBe(25);
  });

  it("paginates memory viewer items with stable page metadata", () => {
    const pagination = paginateMemoryViewerItems(
      Array.from({ length: 26 }, (_, index) => ({ id: `item-${index + 1}` })),
      { page: 1, pageSize: 20 },
    );

    expect(pagination.currentPage).toBe(1);
    expect(pagination.totalPages).toBe(2);
    expect(pagination.visibleStart).toBe(21);
    expect(pagination.visibleEnd).toBe(26);
    expect(pagination.visibleItems.map((item) => item.id)).toEqual([
      "item-21",
      "item-22",
      "item-23",
      "item-24",
      "item-25",
      "item-26",
    ]);
  });

  it("renders P16 search diagnostics in memory stats and list summaries", () => {
    const { refs, state, feature } = createDedupHarness();
    state.tab = "memories";
    state.stats = {
      categorized: 7,
      uncategorized: 2,
    };
    state.items = [
      {
        id: "mem-curated",
        sourcePath: "memory/MEMORY.md",
        summary: "curated memory summary",
        snippet: "curated memory snippet",
        memoryType: "other",
        sourceType: "manual",
        visibility: "private",
        sourceView: { scope: "private" },
        category: "decision",
        score: 0.94,
      },
      {
        id: "mem-derived",
        sourcePath: "memory/derived.md",
        summary: "derived memory summary",
        snippet: "derived memory snippet",
        memoryType: "other",
        sourceType: "manual",
        visibility: "private",
        sourceView: { scope: "private" },
        category: "fact",
        score: 0.61,
      },
    ];
    state.selectedId = "mem-curated";
    state.memoryQueryView = { scope: "private" };
    state.memorySearchDiagnostics = {
      retrievalMode: "explicit",
      sourceClassMix: {
        curated: 1,
        derived: 1,
      },
      stages: {
        raw: { count: 5 },
        scoreAware: { count: 4 },
        reranked: { count: 3 },
        returned: {
          count: 2,
          topHits: [
            { id: "mem-curated", sourceClass: "curated" },
            { id: "mem-derived", sourceClass: "derived" },
          ],
        },
      },
    };

    feature.renderMemoryViewerStats(state.stats);
    feature.renderMemoryList(state.items);

    expect(refs.memoryViewerStatsEl.textContent).toContain("Search Returned");
    expect(refs.memoryViewerStatsEl.textContent).toContain("Search Pipeline");
    expect(refs.memoryViewerStatsEl.textContent).toContain("5 → 4 → 3 → 2");
    expect(refs.memoryViewerStatsEl.textContent).toContain("curated:1, derived:1");
    expect(refs.memoryViewerStatsEl.textContent).toContain("mem-curated (curated), mem-derived (derived)");
    expect(refs.memoryViewerListEl.innerHTML).toContain("Search Diagnostics");
    expect(refs.memoryViewerListEl.innerHTML).toContain("mode=explicit · raw 5 -&gt; score 4 -&gt; rerank 3 -&gt; final 2");
    expect(refs.memoryViewerListEl.innerHTML).toContain("source mix: curated:1, derived:1");
    expect(refs.memoryViewerListEl.innerHTML).toContain("top hits: mem-curated (curated), mem-derived (derived)");
  });

  it("loads doctor memory evaluation into memories stats as a shared readonly summary", async () => {
    const sendReq = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        payload: {
          status: {
            categorized: 7,
            uncategorized: 2,
          },
          queryView: { scope: "private" },
          sharedGovernance: {
            pendingCount: 4,
            claimedCount: 1,
            approvedCount: 2,
            rejectedCount: 0,
            revokedCount: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: {
          memoryEvaluation: {
            available: true,
            status: "warn",
            headline: "Memory evaluation indicates stale profile and governance backlog.",
            profileStateFieldCount: 5,
            freshnessReviewRequiredCount: 2,
            freshnessStaleCount: 1,
            governancePendingCount: 4,
            governanceClaimedCount: 1,
            dreamProfilePatchBacklogCount: 3,
            dreamStaleBacklogCount: 2,
            dreamContradictionBacklogCount: 1,
            experienceUsageLinkedResidentCount: 2,
            signals: ["dream patch backlog 3"],
          },
        },
      });
    const { refs, state, feature } = createDedupHarness(sendReq);
    state.tab = "memories";

    await feature.loadMemoryViewerStats();

    expect(sendReq).toHaveBeenCalledTimes(2);
    expect(sendReq.mock.calls[0]?.[0]?.method).toBe("memory.stats");
    expect(sendReq.mock.calls[1]?.[0]?.method).toBe("system.doctor");
    expect(state.memoryEvaluation).toMatchObject({
      available: true,
      status: "warn",
      profileStateFieldCount: 5,
      governancePendingCount: 4,
    });
    expect(refs.memoryViewerStatsEl.textContent).toContain("Memory Evaluation");
    expect(refs.memoryViewerStatsEl.textContent).toContain("Memory evaluation indicates stale profile and governance backlog.");
    expect(refs.memoryViewerStatsEl.textContent).toContain("Profile Coverage");
    expect(refs.memoryViewerStatsEl.textContent).toContain("freshness review 2 / stale 1");
    expect(refs.memoryViewerStatsEl.textContent).toContain("shared pending 4 / claimed 1");
    expect(refs.memoryViewerStatsEl.textContent).toContain("patch 3 / stale 2 / contradiction 1");
    expect(refs.memoryViewerStatsEl.textContent).toContain("experience-linked residents 2");
  });

  it("builds collapsed previews for oversized memory detail blocks", () => {
    const preview = buildMemoryDetailCollapsedPreview(
      Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join("\n"),
      { maxLines: 4, maxChars: 200 },
    );

    expect(preview.truncated).toBe(true);
    expect(preview.lineCount).toBe(20);
    expect(preview.preview).toContain("line-1");
    expect(preview.preview).not.toContain("line-20");
    expect(preview.preview.endsWith("\n…")).toBe(true);
  });

  it("formats dream generation mode and fallback reason labels", () => {
    expect(formatDreamGenerationModeLabel("llm")).toBe("LLM");
    expect(formatDreamGenerationModeLabel("fallback")).toBe("Fallback");
    expect(formatDreamFallbackReasonLabel("missing_model_config")).toBe("缺少模型配置");
    expect(formatDreamFallbackReasonLabel("llm_call_failed")).toBe("LLM 调用失败");
  });

  it("builds memory viewer dream bar text with fallback observability and enabled run button", () => {
    const view = buildDreamRuntimeBarView({
      connected: true,
      dreamBusy: false,
      dreamRuntime: {
        requested: {
          agentId: "coder",
          defaultConversationId: "agent:coder:main",
        },
        availability: {
          enabled: true,
          available: false,
          reason: "missing model/baseUrl/apiKey",
        },
        state: {
          status: "idle",
          lastObsidianSync: {
            stage: "synced",
            targetPath: "E:/vaults/main/Star Sanctuary/Agents/coder/Dreams/2026/04/dream-1.md",
            updatedAt: "2026-04-20T12:06:00.000Z",
          },
          autoStats: {
            attemptedCount: 2,
            executedCount: 1,
            skippedCount: 1,
          },
          recentRuns: [
            {
              id: "dream-1",
              status: "completed",
              finishedAt: "2026-04-20T12:00:00.000Z",
              summary: "fallback dream generated from rule skeleton",
              generationMode: "fallback",
              fallbackReason: "missing_model_config",
              consolidation: {
                profilePatchCandidates: [{ field: "profile.headline" }],
                staleCandidates: [{ memoryClass: "episodic_task" }],
                contradictionCandidates: [],
              },
            },
          ],
        },
      },
      dreamCommons: {
        availability: {
          enabled: true,
          available: true,
          vaultPath: "E:/vaults/main",
        },
        state: {
          status: "completed",
          lastSuccessAt: "2026-04-20T12:05:00.000Z",
          approvedCount: 3,
          revokedCount: 1,
          noteCount: 4,
        },
      },
    }, {
      formatDateTime: (value) => value || "-",
      formatCount: (value) => String(value ?? 0),
    });

    expect(view.statusLine).toContain("fallback 就绪");
    expect(view.metaLine).toContain("agent:coder:main");
    expect(view.obsidianLine).toContain("Obsidian：synced");
    expect(view.obsidianLine).toContain("E:/vaults/main/Star Sanctuary/Agents/coder/Dreams/2026/04/dream-1.md");
    expect(view.summaryLine).toContain("生成：Fallback (缺少模型配置)");
    expect(view.summaryLine).toContain("整理建议：profile_patch 1 / stale 1 / contradiction 0");
    expect(view.summaryLine).toContain("Commons：completed · approved 3 / revoked 1 / notes 4");
    expect(view.runDisabled).toBe(false);
    expect(view.runTitle).toBe("");
  });

  it("builds dream history panel view with selected dream detail", () => {
    const view = buildDreamHistoryPanelView({
      connected: true,
      open: true,
      items: [
        {
          id: "dream-2",
          status: "completed",
          triggerMode: "manual",
          requestedAt: "2026-04-20T13:00:00.000Z",
          finishedAt: "2026-04-20T13:01:00.000Z",
          summary: "fallback dream generated from rule skeleton",
          generationMode: "fallback",
          fallbackReason: "missing_model_config",
          dreamPath: "state/dreams/dream-2.md",
          consolidation: {
            profilePatchCandidates: [{ field: "profile.headline" }],
            staleCandidates: [{ memoryClass: "episodic_task" }],
            contradictionCandidates: [{ topic: "profile inconsistency" }],
          },
          obsidianSync: {
            stage: "synced",
            targetPath: "vault/Star Sanctuary/Agents/coder/Dreams/2026/04/dream-2.md",
          },
        },
      ],
      selectedId: "dream-2",
      selectedItem: {
        id: "dream-2",
        status: "completed",
        triggerMode: "manual",
        requestedAt: "2026-04-20T13:00:00.000Z",
        finishedAt: "2026-04-20T13:01:00.000Z",
        summary: "fallback dream generated from rule skeleton",
        generationMode: "fallback",
        fallbackReason: "missing_model_config",
        dreamPath: "state/dreams/dream-2.md",
        consolidation: {
          profilePatchCandidates: [{ field: "profile.headline" }],
          staleCandidates: [{ memoryClass: "episodic_task" }],
          contradictionCandidates: [{ topic: "profile inconsistency" }],
        },
        obsidianSync: {
          stage: "synced",
          targetPath: "vault/Star Sanctuary/Agents/coder/Dreams/2026/04/dream-2.md",
        },
      },
      selectedContent: "# Dream Fallback\n\n## 本次主题候选\n- runtime",
    }, {
      formatDateTime: (value) => value || "-",
    });

    expect(view.open).toBe(true);
    expect(view.historyStatusLine).toContain("1 条");
    expect(view.entries[0]?.isActive).toBe(true);
    expect(view.entries[0]?.meta.join(" · ")).toContain("Fallback");
    expect(view.entries[0]?.snippet).toContain("profile_patch=1 / stale=1 / contradiction=1");
    expect(view.detail.title).toContain("fallback dream generated");
    expect(view.detail.cards.some((card) => card.label === "生成" && String(card.value).includes("Fallback"))).toBe(true);
    expect(view.detail.cards.some((card) => card.label === "整理建议" && String(card.value).includes("profile_patch=1 / stale=1 / contradiction=1"))).toBe(true);
    expect(view.detail.cards.some((card) => card.label === "整理治理" && String(card.value).includes("review=pending"))).toBe(true);
    expect(view.detail.actions.canApprove).toBe(false);
    expect(view.detail.actions.canReject).toBe(true);
    expect(view.detail.actions.canApply).toBe(false);
    expect(view.detail.content).toContain("# Dream Fallback");
  });

  it("shows dedup preview entry only on memories tab", () => {
    const { refs, state, feature } = createDedupHarness();

    state.tab = "tasks";
    feature.syncMemoryViewerUi();
    expect(refs.memoryDedupPreviewBtn.classList.contains("hidden")).toBe(true);

    state.tab = "memories";
    feature.syncMemoryViewerUi();
    expect(refs.memoryDedupPreviewBtn.classList.contains("hidden")).toBe(false);
  });

  it("renders top-level memory freshness in candidate-only detail", () => {
    const { refs, feature } = createDedupHarness();

    feature.renderCandidateOnlyDetail({
      id: "candidate-freshness-1",
      taskId: "task-freshness-1",
      type: "method",
      status: "draft",
      title: "Candidate Freshness Demo",
      slug: "candidate-freshness-demo",
      sourceTaskSnapshot: {},
      memoryFreshness: {
        summary: {
          available: true,
          headline: "Procedural experience needs review before publish.",
          reviewRequiredCount: 1,
          staleCount: 0,
          supersededCount: 0,
        },
      },
      learningReviewInput: {
        summary: {
          headline: "Learning headline fallback",
        },
        summaryLines: ["method candidate pending review"],
        nudges: ["Promote after review."],
      },
    });

    expect(refs.memoryViewerDetailEl.innerHTML).toContain("Memory Freshness：");
    expect(refs.memoryViewerDetailEl.innerHTML).toContain("Procedural experience needs review before publish.");
    expect(refs.memoryViewerDetailEl.innerHTML).toContain("review_required=1 / stale=0 / superseded=0");
  });

  it("runs dedup preview then apply with confirmed=true from the modal", async () => {
    const sendReq = vi.fn(async (req) => {
      if (req.method === "memory.dedup.preview") {
        return {
          ok: true,
          payload: {
            report: {
              filter: { memoryType: "daily", category: "experience", sharedPromotionStatus: "pending" },
              totals: {
                scannedChunks: 5,
                duplicateGroups: 1,
                removableChunks: 1,
                affectedTaskLinkCount: 2,
              },
              observability: {
                beforeChunkCount: 5,
                estimatedAfterChunkCount: 4,
                pageCount: 12,
                freelistCount: 3,
              },
              sourceIndexingSummary: {
                reindexableSourcePathCount: 1,
                nonReindexableSourcePathCount: 1,
              },
              groups: [
                {
                  normalizedHash: "abc",
                  preview: "same content",
                  sourceIndexing: {
                    reindexableSourcePathCount: 1,
                    nonReindexableSourcePathCount: 1,
                  },
                  keep: {
                    id: "chunk-a",
                    sourcePath: "memory/a.md",
                    memoryType: "daily",
                    startLine: 1,
                    endLine: 4,
                    taskLinkCount: 1,
                    sourceIndexing: {
                      reindexable: true,
                      scope: "state_memory_root",
                    },
                  },
                  remove: [
                    {
                      id: "chunk-b",
                      sourcePath: "artifacts/export.md",
                      memoryType: "daily",
                      startLine: 1,
                      endLine: 4,
                      taskLinkCount: 2,
                      sourceIndexing: {
                        reindexable: false,
                        scope: "external",
                      },
                    },
                  ],
                },
              ],
            },
          },
        };
      }
      if (req.method === "memory.dedup.apply") {
        return {
          ok: true,
          payload: {
            result: {
              backupPath: "state/artifacts/memory-dedup-backups/memory-dedup-run-1.sqlite",
              totals: {
                scannedChunks: 5,
                duplicateGroups: 1,
                removedChunks: 1,
                relinkedTaskMemoryLinks: 2,
              },
              observability: {
                beforeChunkCount: 5,
                afterChunkCount: 4,
                beforePageCount: 12,
                afterPageCount: 12,
                beforeFreelistCount: 3,
                afterFreelistCount: 5,
              },
              groups: [
                {
                  keepChunkId: "chunk-a",
                  removedChunkIds: ["chunk-b"],
                  relinkedTaskMemoryLinks: 2,
                },
              ],
            },
          },
        };
      }
      if (req.method === "memory.stats") {
        return { ok: true, payload: { status: { files: 1, chunks: 4, vectorIndexed: 0, summarized: 0 } } };
      }
      if (req.method === "system.doctor") {
        return { ok: true, payload: { memoryEvaluation: null } };
      }
      if (req.method === "memory.recent") {
        return { ok: true, payload: { items: [] } };
      }
      if (req.method === "dream.status.get") {
        return { ok: true, payload: { availability: { enabled: false, available: false, reason: "not_loaded" } } };
      }
      if (req.method === "dream.commons.status.get") {
        return { ok: true, payload: { availability: { enabled: false, available: false, reason: "not_loaded" } } };
      }
      throw new Error(`unexpected method ${req.method}`);
    });
    const { refs, state, feature } = createDedupHarness(sendReq);

    state.tab = "memories";
    refs.memoryChunkTypeFilterEl.value = "daily";
    refs.memoryChunkGovernanceFilterEl.value = "pending";
    refs.memoryChunkCategoryFilterEl.value = "experience";
    feature.syncMemoryViewerUi();

    await feature.openDedupModal();
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "memory.dedup.preview",
      params: expect.objectContaining({
        agentId: "default",
        filter: {
          memoryType: "daily",
          category: "experience",
          sharedPromotionStatus: "pending",
        },
      }),
    }));
    expect(refs.memoryDedupModalEl.classList.contains("hidden")).toBe(false);
    expect(refs.memoryDedupModalSubmitBtn.disabled).toBe(false);
    expect(refs.memoryDedupModalSummaryEl.textContent).toContain("page_count");
    expect(refs.memoryDedupModalSummaryEl.textContent).toContain("freelist_count");
    expect(refs.memoryDedupModalSummaryEl.textContent).toContain("1 个可索引源文件 / 1 个旁路源");
    expect(refs.memoryDedupModalListEl.textContent).toContain("可索引源：memory/");
    expect(refs.memoryDedupModalListEl.textContent).toContain("非默认索引源");

    await feature.applyDedupFromModal();
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "memory.dedup.apply",
      params: expect.objectContaining({
        agentId: "default",
        confirmed: true,
        filter: {
          memoryType: "daily",
          category: "experience",
          sharedPromotionStatus: "pending",
        },
      }),
    }));
    expect(refs.memoryDedupModalSubmitBtn.textContent).toContain("清理已完成");
    expect(refs.memoryDedupModalSummaryEl.textContent).toContain("5 -> 4");
    expect(refs.memoryDedupModalSummaryEl.textContent).toContain("3 -> 5");
    expect(refs.memoryDedupModalWarningEl.textContent).toContain("SQLite 在 DELETE 后不会立即缩小文件体积");
  });
});
