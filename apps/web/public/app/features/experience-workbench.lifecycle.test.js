// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchFeature } from "./experience-workbench.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createBulkRejectLifecycleFixture({ bulkRequest } = {}) {
  document.body.innerHTML = '<div id="capability"></div>';
  const candidate = {
    id: "candidate-1",
    type: "method",
    status: "draft",
    title: "Candidate one",
    summary: "Draft candidate",
  };
  const state = {
    requestToken: 0,
    activeAgentId: "default",
    activeTab: "capability-acquisition",
    filters: { query: "", type: "", status: "" },
    items: [],
    draftItems: [],
    publishedAssets: [],
    selectedId: null,
    selectedCandidate: null,
  };
  const memoryViewerState = { pendingExperienceActionKey: null };
  const sendReq = vi.fn((request) => {
    if (request.method === "experience.candidate.reject_bulk") {
      return bulkRequest?.(request) ?? Promise.resolve({ ok: true, payload: { count: 1 } });
    }
    if (request.method === "experience.candidate.list") {
      return Promise.resolve({ ok: true, payload: { items: [candidate] } });
    }
    if (request.method === "experience.candidate.stats") {
      return Promise.resolve({
        ok: true,
        payload: { stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
      });
    }
    if (request.method === "experience.asset.list") {
      return Promise.resolve({ ok: true, payload: { items: [] } });
    }
    return Promise.resolve({ ok: true, payload: {} });
  });
  const showNotice = vi.fn();
  const feature = createExperienceWorkbenchFeature({
    refs: {
      experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
    },
    isConnected: () => true,
    sendReq,
    makeId: () => "request-1",
    getExperienceWorkbenchState: () => state,
    getMemoryViewerState: () => memoryViewerState,
    getSelectedAgentId: () => state.activeAgentId,
    getSelectedAgentLabel: () => state.activeAgentId,
    escapeHtml: (value) => String(value || ""),
    formatDateTime: (value) => String(value || ""),
    showNotice,
  });

  return { candidate, feature, memoryViewerState, sendReq, showNotice, state };
}

function createSynthesisPreviewLifecycleFixture({ acceptRequest, candidateListRequest, createRequest, previewRequest } = {}) {
  document.body.innerHTML = `
    <div id="capability"></div>
    <div id="synthesis-modal" class="hidden"></div>
    <div id="synthesis-title"></div>
    <div id="synthesis-summary"></div>
    <div id="synthesis-status"></div>
    <div id="synthesis-list"></div>
    <button id="synthesis-close"></button>
    <button id="synthesis-cancel"></button>
    <button id="synthesis-submit"></button>
    <input id="synthesis-consume" type="checkbox" checked />
  `;
  const candidate = {
    id: "candidate-1",
    type: "method",
    status: "draft",
    title: "Candidate one",
    summary: "Draft candidate",
  };
  const state = {
    requestToken: 0,
    activeAgentId: "default",
    activeTab: "capability-acquisition",
    filters: { query: "", type: "", status: "" },
    items: [],
    draftItems: [],
    publishedAssets: [],
    selectedId: null,
    selectedCandidate: null,
    synthesisModal: {
      open: false,
      loading: false,
      submitting: false,
      error: "",
      seedCandidateId: "",
      seedAssetPath: "",
      preview: null,
      markSourcesConsumed: true,
      createdCandidate: null,
    },
  };
  const memoryViewerState = { pendingExperienceActionKey: null };
  const sendReq = vi.fn((request) => {
    if (request.method === "experience.candidate.synthesize.preview") {
      return previewRequest?.(request) ?? Promise.resolve({
        ok: true,
        payload: { candidateType: "method", sourceCandidateIds: [candidate.id] },
      });
    }
    if (request.method === "experience.candidate.synthesize.create") {
      return createRequest?.(request) ?? Promise.resolve({
        ok: true,
        payload: { candidate, sourceCount: 1, consumedSourceCount: 0 },
      });
    }
    if (request.method === "experience.candidate.accept") {
      return acceptRequest?.(request) ?? Promise.resolve({
        ok: true,
        payload: { candidate: { ...candidate, status: "accepted" } },
      });
    }
    if (request.method === "experience.candidate.list") {
      return candidateListRequest?.(request, { candidate, state })
        ?? Promise.resolve({ ok: true, payload: { items: [candidate] } });
    }
    if (request.method === "experience.candidate.stats") {
      return Promise.resolve({
        ok: true,
        payload: { stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
      });
    }
    if (request.method === "experience.asset.list") {
      return Promise.resolve({ ok: true, payload: { items: [] } });
    }
    return Promise.resolve({ ok: true, payload: {} });
  });
  const showNotice = vi.fn();
  const feature = createExperienceWorkbenchFeature({
    refs: {
      experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      experienceSynthesisModalEl: document.getElementById("synthesis-modal"),
      experienceSynthesisModalTitleEl: document.getElementById("synthesis-title"),
      experienceSynthesisModalSummaryEl: document.getElementById("synthesis-summary"),
      experienceSynthesisModalStatusEl: document.getElementById("synthesis-status"),
      experienceSynthesisModalListEl: document.getElementById("synthesis-list"),
      experienceSynthesisModalCloseBtn: document.getElementById("synthesis-close"),
      experienceSynthesisModalCancelBtn: document.getElementById("synthesis-cancel"),
      experienceSynthesisModalSubmitBtn: document.getElementById("synthesis-submit"),
      experienceSynthesisModalConsumeSourcesEl: document.getElementById("synthesis-consume"),
    },
    isConnected: () => true,
    sendReq,
    makeId: () => "request-1",
    getExperienceWorkbenchState: () => state,
    getMemoryViewerState: () => memoryViewerState,
    getSelectedAgentId: () => state.activeAgentId,
    getSelectedAgentLabel: () => state.activeAgentId,
    escapeHtml: (value) => String(value || ""),
    formatDateTime: (value) => String(value || ""),
    showNotice,
  });
  feature.bindUi();

  return { candidate, feature, memoryViewerState, sendReq, showNotice, state };
}

async function createSynthesisDraftForAccept(feature, state) {
  document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
  await vi.waitFor(() => {
    expect(state.synthesisModal.preview).toBeTruthy();
    expect(state.synthesisModal.loading).toBe(false);
  });
  document.getElementById("synthesis-submit").click();
  await vi.waitFor(() => {
    expect(state.synthesisModal.createdCandidate).toBeTruthy();
    expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(0);
  });
}

describe("experience workbench static UI lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("owns all initialization listeners until dispose", () => {
    document.body.innerHTML = `
      <input id="query" />
      <select id="type"></select>
      <select id="status"></select>
      <button id="reset"></button>
      <button id="cleanup"></button>
      <input id="generate-task" />
      <button id="generate-method"></button>
      <button id="generate-skill"></button>
      <button id="tab-candidates"></button>
      <button id="tab-capability"></button>
      <button id="tab-assets"></button>
      <button id="tab-usage"></button>
      <div id="synthesis-modal"></div>
      <button id="synthesis-close"></button>
      <button id="synthesis-cancel"></button>
      <button id="synthesis-submit"></button>
      <input id="synthesis-consume" type="checkbox" checked />
    `;
    const state = {
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      generateTaskId: "",
      synthesisModal: {
        open: false,
        loading: false,
        submitting: false,
        error: "",
        seedCandidateId: "",
        seedAssetPath: "",
        preview: null,
        markSourcesConsumed: true,
        createdCandidate: null,
      },
    };
    const generateExperienceCandidate = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchQueryEl: document.getElementById("query"),
        experienceWorkbenchTypeFilterEl: document.getElementById("type"),
        experienceWorkbenchStatusFilterEl: document.getElementById("status"),
        experienceWorkbenchResetFiltersBtn: document.getElementById("reset"),
        experienceWorkbenchCleanupConsumedBtn: document.getElementById("cleanup"),
        experienceGenerateTaskIdEl: document.getElementById("generate-task"),
        experienceGenerateMethodBtn: document.getElementById("generate-method"),
        experienceGenerateSkillBtn: document.getElementById("generate-skill"),
        experienceWorkbenchTabCandidatesBtn: document.getElementById("tab-candidates"),
        experienceWorkbenchTabCapabilityAcquisitionBtn: document.getElementById("tab-capability"),
        experienceWorkbenchTabAssetsBtn: document.getElementById("tab-assets"),
        experienceWorkbenchTabUsageOverviewBtn: document.getElementById("tab-usage"),
        experienceSynthesisModalEl: document.getElementById("synthesis-modal"),
        experienceSynthesisModalCloseBtn: document.getElementById("synthesis-close"),
        experienceSynthesisModalCancelBtn: document.getElementById("synthesis-cancel"),
        experienceSynthesisModalSubmitBtn: document.getElementById("synthesis-submit"),
        experienceSynthesisModalConsumeSourcesEl: document.getElementById("synthesis-consume"),
      },
      isConnected: () => false,
      sendReq: vi.fn(),
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => ({ pendingExperienceActionKey: null }),
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      generateExperienceCandidate,
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice: vi.fn(),
    });

    feature.bindUi();
    feature.bindUi();
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 17,
      pendingGenerateCount: 0,
      pendingReviewCount: 0,
      pendingBulkRejectCount: 0,
      pendingSynthesisPreviewCount: 0,
      pendingSynthesisCreateCount: 0,
      pendingSynthesisAcceptCount: 0,
      pendingCleanupCount: 0,
      pendingSkillFreshnessCount: 0,
      selectedSynthesisSourceCount: 0,
      viewActive: true,
      disposed: false,
    });

    const taskInput = document.getElementById("generate-task");
    taskInput.value = "task-1";
    taskInput.dispatchEvent(new Event("input"));
    const consumeSources = document.getElementById("synthesis-consume");
    consumeSources.checked = false;
    consumeSources.dispatchEvent(new Event("change"));
    expect(state.generateTaskId).toBe("task-1");
    expect(state.synthesisModal.markSourcesConsumed).toBe(false);

    feature.dispose();
    feature.dispose();
    taskInput.value = "task-after-dispose";
    taskInput.dispatchEvent(new Event("input"));
    consumeSources.checked = true;
    consumeSources.dispatchEvent(new Event("change"));
    document.getElementById("generate-method").click();
    feature.bindUi();
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingGenerateCount: 0,
      pendingReviewCount: 0,
      pendingBulkRejectCount: 0,
      pendingSynthesisPreviewCount: 0,
      pendingSynthesisCreateCount: 0,
      pendingSynthesisAcceptCount: 0,
      pendingCleanupCount: 0,
      pendingSkillFreshnessCount: 0,
      selectedSynthesisSourceCount: 0,
      viewActive: false,
      disposed: true,
    });
    expect(state.generateTaskId).toBe("");
    expect(state.synthesisModal.markSourcesConsumed).toBe(true);
    expect(generateExperienceCandidate).not.toHaveBeenCalled();
  });

  it("clears retained content and ignores late read responses after dispose", async () => {
    document.body.innerHTML = `
      <section id="section"></section>
      <h2 id="title"></h2>
      <div id="stats">retained stats</div>
      <button id="tab-candidates"></button>
      <button id="tab-capability"></button>
      <button id="tab-assets"></button>
      <button id="tab-usage"></button>
      <div id="pane-candidates"></div>
      <div id="pane-capability"></div>
      <div id="pane-assets"></div>
      <div id="pane-usage"></div>
      <div id="capability">retained capability</div>
      <div id="assets-list">retained assets</div>
      <div id="assets-detail">retained asset detail</div>
      <div id="usage">retained usage</div>
      <input id="query" />
      <select id="type"></select>
      <select id="status"></select>
      <button id="cleanup"></button>
      <div id="list">retained list</div>
      <div id="detail">retained detail</div>
      <div id="modal"></div>
      <div id="modal-summary">retained modal summary</div>
      <div id="modal-status">retained modal status</div>
      <div id="modal-list">retained modal list</div>
      <button id="modal-submit"></button>
    `;
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "candidates",
      filters: { query: "", type: "", status: "" },
      items: [{ id: "old-item" }],
      draftItems: [{ id: "old-draft" }],
      draftItemsLoading: false,
      draftItemsError: "",
      publishedAssets: [{ publishedPath: "old.md", type: "method" }],
      publishedAssetsLoading: false,
      publishedAssetsError: "",
      selectedId: "old-item",
      selectedCandidate: { id: "old-item", content: "retained candidate" },
      selectedAssetPath: "old.md",
      selectedAsset: { publishedPath: "old.md", content: "retained asset" },
      selectedAssetLoading: false,
      selectedAssetError: "",
      stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 },
      synthesisModal: {
        open: true,
        loading: false,
        submitting: false,
        error: "retained error",
        seedCandidateId: "old-item",
        seedAssetPath: "old.md",
        preview: { sourceCandidates: [{ id: "old-item" }] },
        markSourcesConsumed: false,
        createdCandidate: { id: "created-item" },
      },
    };
    const deferred = createDeferred();
    const sendReq = vi.fn(() => deferred.promise);
    const refs = {
      experienceWorkbenchSection: document.getElementById("section"),
      experienceWorkbenchTitleEl: document.getElementById("title"),
      experienceWorkbenchStatsEl: document.getElementById("stats"),
      experienceWorkbenchTabCandidatesBtn: document.getElementById("tab-candidates"),
      experienceWorkbenchTabCapabilityAcquisitionBtn: document.getElementById("tab-capability"),
      experienceWorkbenchTabAssetsBtn: document.getElementById("tab-assets"),
      experienceWorkbenchTabUsageOverviewBtn: document.getElementById("tab-usage"),
      experienceWorkbenchCandidatesPaneEl: document.getElementById("pane-candidates"),
      experienceWorkbenchCapabilityPaneEl: document.getElementById("pane-capability"),
      experienceWorkbenchAssetsPaneEl: document.getElementById("pane-assets"),
      experienceWorkbenchUsagePaneEl: document.getElementById("pane-usage"),
      experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      experienceWorkbenchAssetsListEl: document.getElementById("assets-list"),
      experienceWorkbenchAssetsDetailEl: document.getElementById("assets-detail"),
      experienceWorkbenchUsageOverviewEl: document.getElementById("usage"),
      experienceWorkbenchQueryEl: document.getElementById("query"),
      experienceWorkbenchTypeFilterEl: document.getElementById("type"),
      experienceWorkbenchStatusFilterEl: document.getElementById("status"),
      experienceWorkbenchCleanupConsumedBtn: document.getElementById("cleanup"),
      experienceWorkbenchListEl: document.getElementById("list"),
      experienceWorkbenchDetailEl: document.getElementById("detail"),
      experienceSynthesisModalEl: document.getElementById("modal"),
      experienceSynthesisModalSummaryEl: document.getElementById("modal-summary"),
      experienceSynthesisModalStatusEl: document.getElementById("modal-status"),
      experienceSynthesisModalListEl: document.getElementById("modal-list"),
      experienceSynthesisModalSubmitBtn: document.getElementById("modal-submit"),
    };
    const feature = createExperienceWorkbenchFeature({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => ({ pendingExperienceActionKey: null }),
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice: vi.fn(),
    });

    const loadPromise = feature.loadExperienceWorkbench(true);
    expect(sendReq).toHaveBeenCalledTimes(4);
    const activeGeneration = state.requestToken;
    feature.dispose();
    expect(state.requestToken).toBeGreaterThan(activeGeneration);
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(state.publishedAssets).toEqual([]);
    expect(state.selectedCandidate).toBeNull();
    expect(state.selectedAsset).toBeNull();
    expect(state.stats).toBeNull();
    expect(state.synthesisModal).toMatchObject({
      open: false,
      preview: null,
      createdCandidate: null,
      seedCandidateId: "",
      seedAssetPath: "",
    });
    for (const id of [
      "stats",
      "capability",
      "assets-list",
      "assets-detail",
      "usage",
      "list",
      "detail",
      "modal-summary",
      "modal-status",
      "modal-list",
    ]) {
      expect(document.getElementById(id).textContent).toBe("");
    }
    expect(refs.experienceSynthesisModalEl.classList.contains("hidden")).toBe(true);

    deferred.resolve({ ok: true, payload: { items: [{ id: "late-item" }] } });
    await loadPromise;
    expect(state.items).toEqual([]);
    expect(refs.experienceWorkbenchListEl.textContent).toBe("");
    await feature.loadExperienceWorkbench(true);
    await feature.loadExperienceCandidateDetail("late-item");
    await feature.openExperienceWorkbench({ candidateId: "late-item" });
    expect(sendReq).toHaveBeenCalledTimes(4);
  });

  it("keeps physical generate pending state but rejects a late candidate after dispose", async () => {
    document.body.innerHTML = `
      <input id="generate-task" />
      <button id="generate-method"></button>
      <button id="generate-skill"></button>
    `;
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      generateTaskId: "",
      items: [],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const deferred = createDeferred();
    const generateExperienceCandidate = vi.fn(() => deferred.promise);
    const sendReq = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceGenerateTaskIdEl: document.getElementById("generate-task"),
        experienceGenerateMethodBtn: document.getElementById("generate-method"),
        experienceGenerateSkillBtn: document.getElementById("generate-skill"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => ({ pendingExperienceActionKey: null }),
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      generateExperienceCandidate,
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice: vi.fn(),
    });

    feature.bindUi();
    const taskInput = document.getElementById("generate-task");
    taskInput.value = "task-1";
    taskInput.dispatchEvent(new Event("input"));
    document.getElementById("generate-method").click();
    expect(generateExperienceCandidate).toHaveBeenCalledWith("task-1", "method");
    expect(feature.getRuntimeSnapshot().pendingGenerateCount).toBe(1);

    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingGenerateCount: 1,
      disposed: true,
    });
    deferred.resolve({ id: "late-candidate", status: "draft" });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingGenerateCount).toBe(0);
    });
    expect(state.selectedId).toBeNull();
    expect(state.selectedCandidate).toBeNull();
    expect(state.items).toEqual([]);
    expect(sendReq).not.toHaveBeenCalled();

    document.getElementById("generate-skill").click();
    expect(generateExperienceCandidate).toHaveBeenCalledTimes(1);
  });

  it("keeps physical review pending state and ignores a late review result after dispose", async () => {
    document.body.innerHTML = '<div id="capability"></div>';
    const candidate = {
      id: "candidate-1",
      type: "method",
      status: "draft",
      title: "Candidate one",
      summary: "Draft candidate",
    };
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      items: [],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    const reviewDeferred = createDeferred();
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.candidate.accept") {
        return reviewDeferred.promise;
      }
      if (request.method === "experience.candidate.list") {
        return Promise.resolve({ ok: true, payload: { items: [candidate] } });
      }
      if (request.method === "experience.candidate.stats") {
        return Promise.resolve({
          ok: true,
          payload: { stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
        });
      }
      if (request.method === "experience.asset.list") {
        return Promise.resolve({ ok: true, payload: { items: [] } });
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => memoryViewerState,
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector('[data-capability-review-candidate-action="accept"]').click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
        method: "experience.candidate.accept",
        params: expect.objectContaining({ candidateId: "candidate-1", agentId: "default" }),
      }));
    });
    expect(memoryViewerState.pendingExperienceActionKey).toBe("candidate:candidate-1:accept");
    expect(feature.getRuntimeSnapshot()).toMatchObject({ pendingReviewCount: 1 });

    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingReviewCount: 1,
      disposed: true,
    });

    reviewDeferred.resolve({
      ok: true,
      payload: { candidate: { ...candidate, status: "accepted" } },
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(0);
    });
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("applies an active review result before it reloads workbench data", async () => {
    document.body.innerHTML = '<div id="capability"></div>';
    const candidate = {
      id: "candidate-1",
      type: "method",
      status: "draft",
      title: "Candidate one",
      summary: "Draft candidate",
    };
    const reviewedCandidate = { ...candidate, status: "accepted" };
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      items: [],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    let reviewCompleted = false;
    let reloadObservedAppliedCandidate = false;
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.candidate.accept") {
        reviewCompleted = true;
        return Promise.resolve({ ok: true, payload: { candidate: reviewedCandidate } });
      }
      if (request.method === "experience.candidate.list") {
        if (reviewCompleted) {
          reloadObservedAppliedCandidate ||= state.items[0]?.status === "accepted" && state.draftItems.length === 0;
          return Promise.resolve({
            ok: true,
            payload: { items: request.params?.filter?.status === "draft" ? [] : [reviewedCandidate] },
          });
        }
        return Promise.resolve({ ok: true, payload: { items: [candidate] } });
      }
      if (request.method === "experience.candidate.stats") {
        return Promise.resolve({
          ok: true,
          payload: { stats: reviewCompleted
            ? { total: 1, methods: 1, skills: 0, draft: 0, accepted: 1, rejected: 0 }
            : { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
        });
      }
      if (request.method === "experience.asset.list") {
        return Promise.resolve({ ok: true, payload: { items: [] } });
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => memoryViewerState,
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector('[data-capability-review-candidate-action="accept"]').click();
    await vi.waitFor(() => {
      expect(sendReq.mock.calls.filter(([request]) => request.method === "experience.candidate.list")).toHaveLength(4);
    });

    expect(reloadObservedAppliedCandidate).toBe(true);
    expect(state.items).toEqual([reviewedCandidate]);
    expect(state.draftItems).toEqual([]);
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(0);
    expect(showNotice).toHaveBeenCalledWith(
      "Candidate accepted",
      "The experience candidate was accepted and published.",
      "success",
      2200,
    );
  });

  it("settles an active review failure without mutating candidate state", async () => {
    document.body.innerHTML = '<div id="capability"></div>';
    const candidate = {
      id: "candidate-1",
      type: "method",
      status: "draft",
      title: "Candidate one",
      summary: "Draft candidate",
    };
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      items: [],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    let listRequestCount = 0;
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.candidate.accept") {
        return Promise.resolve({
          ok: false,
          error: { code: "review_failed", message: "Review was rejected" },
        });
      }
      if (request.method === "experience.candidate.list") {
        listRequestCount += 1;
        return Promise.resolve({ ok: true, payload: { items: [candidate] } });
      }
      if (request.method === "experience.candidate.stats") {
        return Promise.resolve({
          ok: true,
          payload: { stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
        });
      }
      if (request.method === "experience.asset.list") {
        return Promise.resolve({ ok: true, payload: { items: [] } });
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => memoryViewerState,
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector('[data-capability-review-candidate-action="accept"]').click();
    await vi.waitFor(() => {
      expect(listRequestCount).toBe(4);
    });

    expect(state.items).toEqual([candidate]);
    expect(state.draftItems).toEqual([candidate]);
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(0);
    expect(showNotice).toHaveBeenCalledWith(
      "Candidate action failed",
      "Review was rejected",
      "error",
    );
  });

  it("keeps review pending through a late reload and ignores reload data after dispose", async () => {
    document.body.innerHTML = '<div id="capability"></div>';
    const candidate = {
      id: "candidate-1",
      type: "method",
      status: "draft",
      title: "Candidate one",
      summary: "Draft candidate",
    };
    const reviewedCandidate = { ...candidate, status: "accepted" };
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      items: [],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    const reloadDeferred = createDeferred();
    let reviewCompleted = false;
    let reloadRequestCount = 0;
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.candidate.accept") {
        reviewCompleted = true;
        return Promise.resolve({ ok: true, payload: { candidate: reviewedCandidate } });
      }
      if (reviewCompleted) {
        reloadRequestCount += 1;
        return reloadDeferred.promise;
      }
      if (request.method === "experience.candidate.list") {
        return Promise.resolve({ ok: true, payload: { items: [candidate] } });
      }
      if (request.method === "experience.candidate.stats") {
        return Promise.resolve({
          ok: true,
          payload: { stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
        });
      }
      if (request.method === "experience.asset.list") {
        return Promise.resolve({ ok: true, payload: { items: [] } });
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => memoryViewerState,
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector('[data-capability-review-candidate-action="accept"]').click();
    await vi.waitFor(() => {
      expect(reloadRequestCount).toBe(4);
    });
    expect(state.items).toEqual([reviewedCandidate]);
    expect(state.draftItems).toEqual([]);
    expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(1);

    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingReviewCount: 1,
      disposed: true,
    });

    reloadDeferred.resolve({
      ok: true,
      payload: {
        items: [{ ...candidate, status: "draft" }],
        stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 },
      },
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(0);
    });
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(showNotice).toHaveBeenCalledTimes(1);
  });

  it("settles a late review rejection after dispose without UI effects", async () => {
    document.body.innerHTML = '<div id="capability"></div>';
    const candidate = {
      id: "candidate-1",
      type: "method",
      status: "draft",
      title: "Candidate one",
      summary: "Draft candidate",
    };
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      items: [],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    const reviewDeferred = createDeferred();
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.candidate.accept") {
        return reviewDeferred.promise;
      }
      if (request.method === "experience.candidate.list") {
        return Promise.resolve({ ok: true, payload: { items: [candidate] } });
      }
      if (request.method === "experience.candidate.stats") {
        return Promise.resolve({
          ok: true,
          payload: { stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
        });
      }
      if (request.method === "experience.asset.list") {
        return Promise.resolve({ ok: true, payload: { items: [] } });
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => memoryViewerState,
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector('[data-capability-review-candidate-action="accept"]').click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.accept" }));
    });
    expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(1);

    feature.dispose();
    reviewDeferred.reject(new Error("late review failure"));
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(0);
    });
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("ignores a late review result after an agent generation switch", async () => {
    document.body.innerHTML = '<div id="capability"></div>';
    const candidate = {
      id: "candidate-1",
      type: "method",
      status: "draft",
      title: "Candidate one",
      summary: "Draft candidate",
    };
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "capability-acquisition",
      filters: { query: "", type: "", status: "" },
      items: [],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    const reviewDeferred = createDeferred();
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.candidate.accept") {
        return reviewDeferred.promise;
      }
      if (request.method === "experience.candidate.list") {
        return Promise.resolve({ ok: true, payload: { items: [candidate] } });
      }
      if (request.method === "experience.candidate.stats") {
        return Promise.resolve({
          ok: true,
          payload: { stats: { total: 1, methods: 1, skills: 0, draft: 1, accepted: 0, rejected: 0 } },
        });
      }
      if (request.method === "experience.asset.list") {
        return Promise.resolve({ ok: true, payload: { items: [] } });
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => memoryViewerState,
      getSelectedAgentId: () => "default",
      getSelectedAgentLabel: () => "Default",
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector('[data-capability-review-candidate-action="accept"]').click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.accept" }));
    });
    expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(1);

    feature.resetExperienceWorkbenchStateForAgent("agent-2");
    expect(state.activeAgentId).toBe("agent-2");
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();

    reviewDeferred.resolve({
      ok: true,
      payload: { candidate: { ...candidate, status: "accepted" } },
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingReviewCount).toBe(0);
    });
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(showNotice).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(5);
  });

  it("settles an active bulk reject failure without mutating candidate state", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { candidate, feature, memoryViewerState, sendReq, showNotice, state } = createBulkRejectLifecycleFixture({
        bulkRequest: () => Promise.resolve({
          ok: false,
          error: { code: "bulk_reject_failed", message: "Bulk rejection failed" },
        }),
      });

      await feature.loadExperienceWorkbench(false);
      document.querySelector("[data-capability-bulk-reject-type='method']").click();
      await vi.waitFor(() => {
        expect(sendReq.mock.calls.filter(([request]) => request.method === "experience.candidate.list")).toHaveLength(4);
      });

      expect(state.items).toEqual([candidate]);
      expect(state.draftItems).toEqual([candidate]);
      expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
      expect(feature.getRuntimeSnapshot().pendingBulkRejectCount).toBe(0);
      expect(showNotice).toHaveBeenCalledWith(
        "Candidate action failed",
        "Bulk rejection failed",
        "error",
      );
      expect(sendReq.mock.calls.filter(([request]) => request.method === "experience.candidate.list")).toHaveLength(4);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("settles a late bulk reject response after dispose without UI effects", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const bulkDeferred = createDeferred();
      const { feature, memoryViewerState, sendReq, showNotice, state } = createBulkRejectLifecycleFixture({
        bulkRequest: () => bulkDeferred.promise,
      });

      await feature.loadExperienceWorkbench(false);
      document.querySelector("[data-capability-bulk-reject-type='method']").click();
      await vi.waitFor(() => {
        expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.reject_bulk" }));
      });
      expect(feature.getRuntimeSnapshot().pendingBulkRejectCount).toBe(1);

      feature.dispose();
      expect(feature.getRuntimeSnapshot()).toMatchObject({
        pendingBulkRejectCount: 1,
        disposed: true,
      });
      bulkDeferred.resolve({ ok: true, payload: { count: 1 } });
      await vi.waitFor(() => {
        expect(feature.getRuntimeSnapshot().pendingBulkRejectCount).toBe(0);
      });
      expect(state.items).toEqual([]);
      expect(state.draftItems).toEqual([]);
      expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
      expect(showNotice).not.toHaveBeenCalled();
      expect(sendReq).toHaveBeenCalledTimes(5);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("ignores a late bulk reject response after an agent generation switch", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const bulkDeferred = createDeferred();
      const { feature, memoryViewerState, sendReq, showNotice, state } = createBulkRejectLifecycleFixture({
        bulkRequest: () => bulkDeferred.promise,
      });

      await feature.loadExperienceWorkbench(false);
      document.querySelector("[data-capability-bulk-reject-type='method']").click();
      await vi.waitFor(() => {
        expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.reject_bulk" }));
      });
      expect(feature.getRuntimeSnapshot().pendingBulkRejectCount).toBe(1);

      feature.resetExperienceWorkbenchStateForAgent("agent-2");
      bulkDeferred.resolve({ ok: true, payload: { count: 1 } });
      await vi.waitFor(() => {
        expect(feature.getRuntimeSnapshot().pendingBulkRejectCount).toBe(0);
      });
      expect(state.activeAgentId).toBe("agent-2");
      expect(state.items).toEqual([]);
      expect(state.draftItems).toEqual([]);
      expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
      expect(showNotice).not.toHaveBeenCalled();
      expect(sendReq).toHaveBeenCalledTimes(5);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("settles an active synthesis preview failure without retaining preview state", async () => {
    const { candidate, feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      previewRequest: () => Promise.resolve({
        ok: false,
        error: { code: "synthesis_preview_failed", message: "Preview unavailable" },
      }),
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.preview" }));
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(0);
    });

    expect(state.synthesisModal).toMatchObject({
      open: true,
      loading: false,
      preview: null,
      error: "Preview unavailable",
    });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).toHaveBeenCalledWith("合成预览失败", "Preview unavailable", "error");
  });

  it("ignores a late synthesis preview after its modal closes", async () => {
    const previewDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      previewRequest: () => previewDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.preview" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(1);

    document.getElementById("synthesis-close").click();
    previewDeferred.resolve({ ok: true, payload: { candidateType: "method", sourceCandidateIds: ["candidate-1"] } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(0);
    });

    expect(state.synthesisModal).toMatchObject({
      open: false,
      loading: false,
      preview: null,
    });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(5);
  });

  it("ignores a late synthesis preview after an agent generation switch", async () => {
    const previewDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      previewRequest: () => previewDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.preview" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(1);

    feature.resetExperienceWorkbenchStateForAgent("agent-2");
    previewDeferred.resolve({ ok: true, payload: { candidateType: "method", sourceCandidateIds: ["candidate-1"] } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(0);
    });

    expect(state.activeAgentId).toBe("agent-2");
    expect(state.synthesisModal).toMatchObject({
      open: false,
      loading: false,
      preview: null,
    });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(5);
  });

  it("ignores a late synthesis preview after dispose", async () => {
    const previewDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      previewRequest: () => previewDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.preview" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(1);

    feature.dispose();
    previewDeferred.resolve({ ok: true, payload: { candidateType: "method", sourceCandidateIds: ["candidate-1"] } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(0);
    });

    expect(state.synthesisModal).toMatchObject({
      open: false,
      loading: false,
      preview: null,
    });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(5);
  });

  it("settles an active synthesis create failure without retaining a created candidate", async () => {
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      createRequest: () => Promise.resolve({
        ok: false,
        error: { code: "synthesis_create_failed", message: "Create unavailable" },
      }),
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(state.synthesisModal.loading).toBe(false);
      expect(state.synthesisModal.preview).toBeTruthy();
    });
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.create" }));
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(0);
    });

    expect(state.synthesisModal).toMatchObject({
      open: true,
      submitting: false,
      createdCandidate: null,
      error: "Create unavailable",
    });
    expect(state.items).toEqual([{ id: "candidate-1", type: "method", status: "draft", title: "Candidate one", summary: "Draft candidate" }]);
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).toHaveBeenCalledWith("合成失败", "Create unavailable", "error");
  });

  it("applies an active synthesis create before its reload settles", async () => {
    const createdCandidate = {
      id: "candidate-1-synthesized",
      type: "method",
      status: "draft",
      title: "Synthesized candidate",
      summary: "Created draft",
    };
    let createCompleted = false;
    let reloadObservedCreatedCandidate = false;
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      createRequest: () => {
        createCompleted = true;
        return Promise.resolve({
          ok: true,
          payload: { candidate: createdCandidate, sourceCount: 1, consumedSourceCount: 0 },
        });
      },
      candidateListRequest: () => {
        if (createCompleted) {
          reloadObservedCreatedCandidate ||= state.items.some((item) => item.id === createdCandidate.id)
            && state.synthesisModal.createdCandidate?.id === createdCandidate.id;
          return Promise.resolve({ ok: true, payload: { items: [createdCandidate] } });
        }
        return Promise.resolve({
          ok: true,
          payload: { items: [{ id: "candidate-1", type: "method", status: "draft", title: "Candidate one", summary: "Draft candidate" }] },
        });
      },
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(state.synthesisModal.preview).toBeTruthy();
      expect(state.synthesisModal.loading).toBe(false);
    });
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq.mock.calls.filter(([request]) => request.method === "experience.candidate.list")).toHaveLength(4);
    });

    expect(reloadObservedCreatedCandidate).toBe(true);
    expect(state.synthesisModal.createdCandidate).toEqual(createdCandidate);
    expect(state.items).toEqual([createdCandidate]);
    expect(state.draftItems).toEqual([createdCandidate]);
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(0);
    expect(showNotice).toHaveBeenCalledWith(
      "合成草稿已创建",
      expect.stringContaining("1"),
      "success",
      2800,
    );
  });

  it("ignores a late synthesis create after dispose", async () => {
    const createRequestDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      createRequest: () => createRequestDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(state.synthesisModal.preview).toBeTruthy();
      expect(state.synthesisModal.loading).toBe(false);
    });
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.create" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(1);

    feature.dispose();
    createRequestDeferred.resolve({
      ok: true,
      payload: {
        candidate: { id: "candidate-1-synthesized", type: "method", status: "draft" },
        sourceCount: 1,
        consumedSourceCount: 0,
      },
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(0);
    });

    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(state.synthesisModal).toMatchObject({ open: false, submitting: false, createdCandidate: null });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(6);
  });

  it("ignores a late synthesis create after an agent generation switch", async () => {
    const createRequestDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      createRequest: () => createRequestDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(state.synthesisModal.preview).toBeTruthy();
      expect(state.synthesisModal.loading).toBe(false);
    });
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.create" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(1);

    feature.resetExperienceWorkbenchStateForAgent("agent-2");
    createRequestDeferred.resolve({
      ok: true,
      payload: {
        candidate: { id: "candidate-1-synthesized", type: "method", status: "draft" },
        sourceCount: 1,
        consumedSourceCount: 0,
      },
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(0);
    });

    expect(state.activeAgentId).toBe("agent-2");
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(state.synthesisModal).toMatchObject({ open: false, submitting: false, createdCandidate: null });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(6);
  });

  it("settles an active synthesis accept shortcut failure without closing its modal", async () => {
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      acceptRequest: () => Promise.resolve({
        ok: false,
        error: { code: "synthesis_accept_failed", message: "Accept unavailable" },
      }),
    });

    await feature.loadExperienceWorkbench(false);
    await createSynthesisDraftForAccept(feature, state);
    showNotice.mockClear();
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.accept" }));
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisAcceptCount).toBe(0);
    });

    expect(state.synthesisModal).toMatchObject({
      open: true,
      submitting: false,
      createdCandidate: { id: "candidate-1" },
    });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).toHaveBeenCalledWith("Candidate action failed", "Accept unavailable", "error");
  });

  it("ignores a late synthesis accept shortcut response after dispose", async () => {
    const acceptDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      acceptRequest: () => acceptDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    await createSynthesisDraftForAccept(feature, state);
    showNotice.mockClear();
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.accept" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisAcceptCount).toBe(1);

    feature.dispose();
    acceptDeferred.resolve({ ok: true, payload: { candidate: { id: "candidate-1", status: "accepted" } } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisAcceptCount).toBe(0);
    });

    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(state.synthesisModal).toMatchObject({ open: false, submitting: false, createdCandidate: null });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("ignores a late synthesis accept shortcut response after an agent generation switch", async () => {
    const acceptDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      acceptRequest: () => acceptDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    await createSynthesisDraftForAccept(feature, state);
    showNotice.mockClear();
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.accept" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisAcceptCount).toBe(1);

    feature.resetExperienceWorkbenchStateForAgent("agent-2");
    acceptDeferred.resolve({ ok: true, payload: { candidate: { id: "candidate-1", status: "accepted" } } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisAcceptCount).toBe(0);
    });

    expect(state.activeAgentId).toBe("agent-2");
    expect(state.items).toEqual([]);
    expect(state.draftItems).toEqual([]);
    expect(state.synthesisModal).toMatchObject({ open: false, submitting: false, createdCandidate: null });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("deactivates a pending synthesis preview while its request settles physically", async () => {
    const previewDeferred = createDeferred();
    const { feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      previewRequest: () => previewDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.preview" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(1);
    expect(feature.getRuntimeSnapshot().selectedSynthesisSourceCount).toBe(0);
    expect(memoryViewerState.pendingExperienceActionKey).toBe("synthesize-preview:candidate-1");
    const requestTokenBeforeDeactivate = state.requestToken;

    feature.setViewActive(false);

    expect(feature.getRuntimeSnapshot()).toMatchObject({
      viewActive: false,
      pendingSynthesisPreviewCount: 1,
      selectedSynthesisSourceCount: 0,
    });
    expect(state.requestToken).toBe(requestTokenBeforeDeactivate + 1);
    expect(state.synthesisModal).toMatchObject({
      open: false,
      loading: false,
      submitting: false,
      preview: null,
      createdCandidate: null,
    });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();

    previewDeferred.resolve({
      ok: true,
      payload: { candidateType: "method", sourceCandidateIds: ["candidate-1"] },
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisPreviewCount).toBe(0);
    });

    expect(state.synthesisModal).toMatchObject({ open: false, loading: false, preview: null });
    expect(showNotice).not.toHaveBeenCalled();
    const requestCountBeforeActivate = sendReq.mock.calls.length;
    feature.setViewActive(true);
    expect(feature.getRuntimeSnapshot().viewActive).toBe(true);
    expect(sendReq).toHaveBeenCalledTimes(requestCountBeforeActivate);
  });

  it("clears selected synthesis sources on deactivate while create settles physically", async () => {
    const createRequestDeferred = createDeferred();
    const { candidate, feature, memoryViewerState, sendReq, showNotice, state } = createSynthesisPreviewLifecycleFixture({
      createRequest: () => createRequestDeferred.promise,
    });

    await feature.loadExperienceWorkbench(false);
    document.querySelector("[data-capability-synthesize-candidate-id='candidate-1']").click();
    await vi.waitFor(() => {
      expect(state.synthesisModal.preview).toBeTruthy();
      expect(feature.getRuntimeSnapshot().selectedSynthesisSourceCount).toBe(1);
    });
    document.getElementById("synthesis-submit").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.synthesize.create" }));
    });
    expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(1);

    feature.setViewActive(false);

    expect(feature.getRuntimeSnapshot()).toMatchObject({
      viewActive: false,
      pendingSynthesisCreateCount: 1,
      selectedSynthesisSourceCount: 0,
    });
    expect(state.synthesisModal).toMatchObject({ open: false, preview: null, createdCandidate: null });
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();

    createRequestDeferred.resolve({
      ok: true,
      payload: {
        candidate: { id: "candidate-1-synthesized", type: "method", status: "draft" },
        sourceCount: 1,
        consumedSourceCount: 0,
      },
    });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSynthesisCreateCount).toBe(0);
    });

    expect(state.items).toEqual([candidate]);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("keeps a skill freshness update physical and ignores its late response after an agent switch", async () => {
    document.body.innerHTML = '<div id="list"></div><div id="detail"></div>';
    const updateDeferred = createDeferred();
    const candidate = {
      id: "candidate-1",
      type: "skill",
      status: "accepted",
      sourceTaskSnapshot: {},
      skillFreshness: { status: "active" },
    };
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "candidates",
      filters: { query: "", type: "", status: "" },
      items: [candidate],
      draftItems: [],
      publishedAssets: [],
      selectedId: candidate.id,
      selectedCandidate: candidate,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.skill.freshness.update") {
        return updateDeferred.promise;
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const feature = createExperienceWorkbenchFeature({
      refs: {
        experienceWorkbenchListEl: document.getElementById("list"),
        experienceWorkbenchDetailEl: document.getElementById("detail"),
      },
      isConnected: () => true,
      sendReq,
      makeId: () => "request-1",
      getExperienceWorkbenchState: () => state,
      getMemoryViewerState: () => memoryViewerState,
      getSelectedAgentId: () => state.activeAgentId,
      getSelectedAgentLabel: () => state.activeAgentId,
      renderCandidateDetailPanel: () => `
        <button
          data-skill-freshness-stale-action="mark"
          data-skill-freshness-source-candidate-id="source-1"
          data-skill-freshness-skill-key="skill-a"
          data-skill-freshness-candidate-id="candidate-1"
        ></button>
      `,
      escapeHtml: (value) => String(value || ""),
      formatDateTime: (value) => String(value || ""),
      showNotice,
    });

    await feature.syncExperienceWorkbenchUi({ preferFirst: false, loadDetailIfNeeded: false });
    document.querySelector("[data-skill-freshness-stale-action]").click();
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
        method: "experience.skill.freshness.update",
        params: {
          sourceCandidateId: "source-1",
          skillKey: "skill-a",
          stale: true,
          agentId: "default",
        },
      }));
    });
    expect(feature.getRuntimeSnapshot().pendingSkillFreshnessCount).toBe(1);
    expect(memoryViewerState.pendingExperienceActionKey).toBe("skill-freshness:source-1:stale");

    feature.resetExperienceWorkbenchStateForAgent("agent-2");
    updateDeferred.resolve({ ok: true, payload: { stale: true } });
    await vi.waitFor(() => {
      expect(feature.getRuntimeSnapshot().pendingSkillFreshnessCount).toBe(0);
    });

    expect(state.activeAgentId).toBe("agent-2");
    expect(state.items).toEqual([]);
    expect(state.selectedCandidate).toBeNull();
    expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(showNotice).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("keeps a cleanup request physical until a late response settles after dispose", async () => {
    document.body.innerHTML = '<button id="cleanup"></button>';
    const cleanupDeferred = createDeferred();
    const state = {
      requestToken: 0,
      activeAgentId: "default",
      activeTab: "candidates",
      filters: { query: "", type: "", status: "" },
      items: [{
        id: "consumed-candidate",
        type: "method",
        status: "draft",
        metadata: { synthesisConsumed: { consumed: true } },
      }],
      draftItems: [],
      publishedAssets: [],
      selectedId: null,
      selectedCandidate: null,
    };
    const memoryViewerState = { pendingExperienceActionKey: null };
    const sendReq = vi.fn((request) => {
      if (request.method === "experience.candidate.cleanup_consumed") {
        return cleanupDeferred.promise;
      }
      return Promise.resolve({ ok: true, payload: {} });
    });
    const showNotice = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const feature = createExperienceWorkbenchFeature({
        refs: {
          experienceWorkbenchCleanupConsumedBtn: document.getElementById("cleanup"),
        },
        isConnected: () => true,
        sendReq,
        makeId: () => "request-1",
        getExperienceWorkbenchState: () => state,
        getMemoryViewerState: () => memoryViewerState,
        getSelectedAgentId: () => "default",
        getSelectedAgentLabel: () => "Default",
        escapeHtml: (value) => String(value || ""),
        formatDateTime: (value) => String(value || ""),
        showNotice,
      });

      feature.bindUi();
      document.getElementById("cleanup").click();
      await vi.waitFor(() => {
        expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "experience.candidate.cleanup_consumed" }));
      });
      expect(feature.getRuntimeSnapshot().pendingCleanupCount).toBe(1);
      expect(memoryViewerState.pendingExperienceActionKey).toBe("cleanup-consumed");

      feature.dispose();
      cleanupDeferred.resolve({ ok: true, payload: { count: 1 } });
      await vi.waitFor(() => {
        expect(feature.getRuntimeSnapshot().pendingCleanupCount).toBe(0);
      });

      expect(state.items).toEqual([]);
      expect(memoryViewerState.pendingExperienceActionKey).toBeNull();
      expect(showNotice).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
