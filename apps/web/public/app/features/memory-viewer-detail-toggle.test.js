// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryViewerFeature } from "./memory-viewer.js";

function createHarness() {
  document.body.innerHTML = `
    <section id="memoryViewerSection"></section>
    <div id="memoryViewerTitle"></div>
    <div id="memoryViewerStats"></div>
    <div id="memoryViewerList"></div>
    <div id="memoryViewerDetail"></div>
  `;

  const refs = {
    memoryViewerSection: document.getElementById("memoryViewerSection"),
    memoryViewerTitleEl: document.getElementById("memoryViewerTitle"),
    memoryViewerStatsEl: document.getElementById("memoryViewerStats"),
    memoryViewerListEl: document.getElementById("memoryViewerList"),
    memoryViewerDetailEl: document.getElementById("memoryViewerDetail"),
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
  };

  const state = {
    tab: "memories",
    outboundAuditFocus: "all",
    items: [],
    selectedId: null,
    selectedTask: null,
    selectedCandidate: null,
    sharedReviewFilters: {},
    activeAgentId: "default",
  };

  const feature = createMemoryViewerFeature({
    refs,
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
    getLatestExperienceUsageTimestamp: () => 0,
    getActiveMemoryCategoryLabel: () => "",
    getMemoryCategoryDistributionViewModel: () => null,
    bindStatsAuditJumpLinks: vi.fn(),
    bindMemoryPathLinks: vi.fn(),
    bindTaskAuditJumpLinks: vi.fn(),
    openConversationSession: vi.fn(),
    showNotice: vi.fn(),
    t: (_key, _params, fallback) => fallback ?? "",
  });

  return { refs, feature };
}

describe("memory viewer detail toggles", () => {
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

  it("collapses large content and metadata by default, then expands on demand", () => {
    const { refs, feature } = createHarness();
    const longContent = Array.from({ length: 18 }, (_, index) => `content-line-${index + 1}`).join("\n");
    const metadata = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`field_${index + 1}`, `value_${index + 1}`]));

    feature.renderMemoryDetail({
      id: "mem-detail-1",
      sourcePath: "state/memory/detail.md",
      sourceType: "conversation",
      memoryType: "note",
      visibility: "private",
      category: "general",
      summary: "summary",
      snippet: "snippet",
      content: longContent,
      metadata,
    });

    const contentToggle = refs.memoryViewerDetailEl.querySelector("[data-memory-detail-toggle='content']");
    const metadataToggle = refs.memoryViewerDetailEl.querySelector("[data-memory-detail-toggle='metadata']");
    const contentBody = refs.memoryViewerDetailEl.querySelector("[data-memory-detail-body='content']");
    const metadataBody = refs.memoryViewerDetailEl.querySelector("[data-memory-detail-body='metadata']");

    expect(contentToggle?.textContent).toBe("Expand");
    expect(metadataToggle?.textContent).toBe("Expand");
    expect(contentBody?.textContent).toContain("content-line-1");
    expect(contentBody?.textContent).not.toContain("content-line-18");
    expect(contentBody?.textContent?.includes("…")).toBe(true);
    expect(metadataBody?.textContent).toContain("\"field_1\": \"value_1\"");
    expect(metadataBody?.textContent).not.toContain("\"field_18\": \"value_18\"");

    contentToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    metadataToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(contentToggle?.textContent).toBe("Collapse");
    expect(metadataToggle?.textContent).toBe("Collapse");
    expect(contentBody?.textContent).toContain("content-line-18");
    expect(metadataBody?.textContent).toContain("\"field_18\": \"value_18\"");
  });
});
