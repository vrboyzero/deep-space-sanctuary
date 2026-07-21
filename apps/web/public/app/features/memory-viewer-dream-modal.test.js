// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryViewerFeature } from "./memory-viewer.js";

function createHarness(options = {}) {
  document.body.innerHTML = `
    <section id="memoryViewerSection"></section>
    <div id="memoryViewerTitle"></div>
    <div id="memoryViewerStats"></div>
    <div id="memoryViewerList"></div>
    <div id="memoryViewerDetail"></div>
    <button id="memoryDreamModalTrigger" type="button">梦境</button>
    <div id="memoryDreamModal" class="hidden">
      <span id="memoryDreamModalTitle"></span>
      <button id="memoryDreamModalClose" type="button">关闭</button>
    </div>
    <div id="memoryDreamBar"></div>
    <span id="memoryDreamStatus"></span>
    <span id="memoryDreamMeta"></span>
    <span id="memoryDreamObsidian"></span>
    <span id="memoryDreamSummary"></span>
    <button id="memoryDreamRefresh" type="button"></button>
    <button id="memoryDreamRun" type="button"></button>
    <button id="memoryDreamHistoryToggle" type="button"></button>
    <div id="memoryDreamHistory" class="hidden"></div>
    <span id="memoryDreamHistoryStatus"></span>
    <button id="memoryDreamHistoryRefresh" type="button"></button>
    <div id="memoryDreamHistoryList"></div>
    <div id="memoryDreamHistoryDetail"></div>
  `;

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
  };

  const state = {
    tab: "tasks",
    outboundAuditFocus: "all",
    items: [],
    selectedId: null,
    selectedTask: null,
    selectedCandidate: null,
    sharedReviewFilters: {},
    activeAgentId: "default",
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
  };

  const sendReq = options.sendReq ?? vi.fn();
  const feature = createMemoryViewerFeature({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: () => "req-1",
    getMemoryViewerState: () => state,
    getSelectedAgentId: () => "default",
    getSelectedAgentLabel: () => "默认 Agent",
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
    getLatestExperienceUsageTimestamp: () => 0,
    getActiveMemoryCategoryLabel: () => "",
    getMemoryCategoryDistributionViewModel: () => null,
    bindStatsAuditJumpLinks: vi.fn(),
    bindMemoryPathLinks: vi.fn(),
    bindTaskAuditJumpLinks: vi.fn(),
    openConversationSession: vi.fn(),
    showNotice: vi.fn(),
    t: options.t ?? ((_key, _params, fallback) => fallback ?? ""),
  });

  return { refs, state, sendReq, feature };
}

describe("memory viewer dream modal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens and closes the dream modal from the header trigger", () => {
    const { refs } = createHarness();

    expect(refs.memoryDreamModalEl?.classList.contains("hidden")).toBe(true);
    expect(refs.memoryDreamModalTriggerBtn?.textContent).toBe("梦境");

    refs.memoryDreamModalTriggerBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(refs.memoryDreamModalEl?.classList.contains("hidden")).toBe(false);
    expect(refs.memoryDreamModalTriggerBtn?.getAttribute("aria-expanded")).toBe("true");
    expect(refs.memoryDreamModalTitleEl?.textContent).toBe("梦境");

    refs.memoryDreamModalCloseBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(refs.memoryDreamModalEl?.classList.contains("hidden")).toBe(true);
    expect(refs.memoryDreamModalTriggerBtn?.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders Dream history entries through the list owner while preserving delegated detail selection", async () => {
    const sendReq = vi.fn((request) => {
      if (request.method === "dream.get") {
        return Promise.resolve({ ok: true, payload: { item: { id: "dream-1", title: "Dream One" }, content: "detail" } });
      }
      return Promise.resolve({ ok: true, payload: { items: [] } });
    });
    const { refs, state, feature } = createHarness({ sendReq });
    state.dreamHistoryOpen = true;
    state.selectedDreamHistoryId = "dream-1";
    state.dreamHistoryItems = [{
      id: "dream-1",
      title: "Dream One",
      status: "completed",
      triggerMode: "manual",
      createdAt: "2026-07-21T00:00:00.000Z",
      summary: "summary",
    }];
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(refs.memoryDreamHistoryListEl, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Dream history list must not use innerHTML");
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    expect(() => feature.renderDreamHistoryPanel()).not.toThrow();
    const entry = refs.memoryDreamHistoryListEl?.querySelector('[data-dream-history-id="dream-1"]');
    expect(entry?.classList.contains("active")).toBe(true);
    entry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "dream.get" }));
    });
  });

  it.each([
    {
      name: "loading",
      statePatch: { dreamHistoryDetailLoading: true },
      translationKey: "memory.dreamHistoryDetailLoading",
      text: "<img src=x onerror=alert(6)>Loading Dream",
    },
    {
      name: "error",
      statePatch: { dreamHistoryDetailError: "<svg onload=alert(7)>Dream failed" },
      translationKey: "",
      text: "<svg onload=alert(7)>Dream failed",
    },
    {
      name: "no-card",
      statePatch: {},
      translationKey: "memory.dreamHistoryDetailEmpty",
      text: "<script>alert(8)</script>Select a Dream",
    },
  ])("renders Dream history detail $name text without an HTML parser", ({ statePatch, translationKey, text }) => {
    const { refs, state, feature } = createHarness({
      t: (key, _params, fallback) => key === translationKey ? text : fallback ?? "",
    });
    state.dreamHistoryOpen = true;
    Object.assign(state, statePatch);
    const previous = document.createElement("div");
    previous.textContent = "Old full detail";
    refs.memoryDreamHistoryDetailEl?.append(previous);
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(refs.memoryDreamHistoryDetailEl, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Dream history detail empty state must not use innerHTML");
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    expect(() => feature.renderDreamHistoryPanel()).not.toThrow();
    expect(previous.isConnected).toBe(false);
    expect(refs.memoryDreamHistoryDetailEl?.querySelector(".memory-viewer-empty")?.textContent).toBe(text);
    expect(refs.memoryDreamHistoryDetailEl?.querySelector("img, script, svg, [onerror], [onload]")).toBeNull();
  });

  it("renders Dream history full detail through the owner and preserves delegated review", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("");
    const sendReq = vi.fn(() => Promise.resolve({ ok: true, payload: { items: [] } }));
    const { refs, state, feature } = createHarness({ sendReq });
    const selectedItem = {
      id: "dream-1",
      summary: "<img src=x onerror=alert(9)>Dream summary",
      status: "completed",
      triggerMode: "manual",
      finishedAt: "2026-07-21T00:00:00.000Z",
      conversationId: "<svg onload=alert(10)>conversation",
      dreamPath: "<script>alert(11)</script>dream.md",
      reason: "<iframe srcdoc=alert(12)>reason",
      consolidation: {
        profilePatchCandidates: [{ profilePath: "profile.md" }],
        review: { status: "pending" },
        apply: { status: "not_applied" },
      },
    };
    state.dreamHistoryOpen = true;
    state.dreamHistoryItems = [selectedItem];
    state.selectedDreamHistoryId = selectedItem.id;
    state.selectedDreamHistoryItem = selectedItem;
    state.selectedDreamHistoryContent = "<details open>Dream body</details>";
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(refs.memoryDreamHistoryDetailEl, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Dream history full detail must not use innerHTML");
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    expect(() => feature.renderDreamHistoryPanel()).not.toThrow();
    expect(refs.memoryDreamHistoryDetailEl?.querySelector(".memory-detail-title")?.textContent).toBe(selectedItem.summary);
    expect(refs.memoryDreamHistoryDetailEl?.querySelector(".memory-detail-pre")?.textContent).toBe(state.selectedDreamHistoryContent);
    expect(refs.memoryDreamHistoryDetailEl?.querySelector("img, script, svg, iframe, details, [onerror], [onload]")).toBeNull();

    refs.memoryDreamHistoryDetailEl
      ?.querySelector('[data-dream-consolidation-action="approve"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({ method: "dream.consolidation.review" }));
    });
  });
});
