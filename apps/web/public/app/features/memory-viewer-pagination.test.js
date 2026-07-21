// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createMemoryViewerFeature } from "./memory-viewer.js";

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Memory Viewer list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createHarness(initialTab = "memories") {
  document.body.innerHTML = `
    <section id="memoryViewerSection"></section>
    <div id="memoryViewerTitle"></div>
    <div id="memoryViewerStats"></div>
    <div id="memoryViewerList"></div>
    <div id="memoryViewerDetail"></div>
    <div id="memorySharedReviewBatchBar"></div>
  `;

  const state = {
    tab: initialTab,
    outboundAuditFocus: "all",
    listPageByTab: {},
    items: [],
    selectedId: null,
    selectedTask: null,
    selectedCandidate: null,
    sharedReviewSummary: null,
    sharedReviewFilters: {},
    selectedSharedReviewIds: [],
    sharedReviewBatchBusy: false,
    activeAgentId: "default",
  };

  const refs = {
    memoryViewerSection: document.getElementById("memoryViewerSection"),
    memoryViewerTitleEl: document.getElementById("memoryViewerTitle"),
    memoryViewerStatsEl: document.getElementById("memoryViewerStats"),
    memoryViewerListEl: document.getElementById("memoryViewerList"),
    memoryViewerDetailEl: document.getElementById("memoryViewerDetail"),
    memorySharedReviewBatchBarEl: document.getElementById("memorySharedReviewBatchBar"),
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

  const loadTaskDetail = vi.fn(async () => {});
  const loadMemoryDetail = vi.fn(async () => {});
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
    renderMemoryViewerListEmpty: vi.fn((message) => {
      refs.memoryViewerListEl.innerHTML = `<div class="memory-viewer-empty">${String(message)}</div>`;
    }),
    renderMemoryViewerDetailEmpty: vi.fn((message) => {
      refs.memoryViewerDetailEl.innerHTML = `<div class="memory-viewer-empty">${String(message)}</div>`;
    }),
    loadTaskDetail,
    loadMemoryDetail,
    escapeHtml: (value) => String(value ?? ""),
    formatCount: (value) => String(value ?? 0),
    formatDateTime: (value) => String(value ?? ""),
    formatDuration: (value) => String(value ?? ""),
    formatLineRange: () => "",
    formatScore: (value) => String(value ?? ""),
    formatMemoryCategory: (value) => String(value ?? ""),
    normalizeMemoryVisibility: (value) => String(value ?? ""),
    getVisibilityBadgeClass: (visibility) => visibility === "shared" ? "memory-badge-shared" : "memory-badge-private",
    summarizeSourcePath: (value) => String(value ?? ""),
    getTaskGoalId: (item) => item?.goalId || "",
    getGoalDisplayName: (goalId) => goalId,
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

  return { state, refs, feature, loadTaskDetail, loadMemoryDetail };
}

describe("memory viewer pagination", () => {
  it("renders memory lists by page and loads the first item of the next page on navigation", async () => {
    const { state, refs, feature, loadMemoryDetail } = createHarness("memories");
    blockNonEmptyInnerHtml(refs.memoryViewerListEl);
    const attackMemoryId = 'mem-1"><img src=x onerror=alert(1)>';
    const items = Array.from({ length: 21 }, (_, index) => ({
      id: index === 0 ? attackMemoryId : `mem-${index + 1}`,
      sourcePath: index === 0 ? "<script>alert(2)</script>memory.md" : `state/memory/${index + 1}.md`,
      summary: index === 0 ? "<img src=x onerror=alert(3)>summary" : `summary ${index + 1}`,
      snippet: `snippet ${index + 1}`,
      memoryType: index === 0 ? "<svg onload=alert(4)>note" : "note",
      sourceType: index === 0 ? "<iframe srcdoc='<script>alert(5)</script>'>conversation" : "conversation",
      visibility: index === 0 ? "shared" : "private",
      sourceView: { scope: index === 0 ? "hybrid" : "private" },
      category: index === 0 ? "<math><mtext>general</mtext></math>" : "general",
      score: index === 0 ? "<object data=x>0.9" : index + 1,
    }));
    state.items = items;
    state.selectedId = attackMemoryId;
    state.memorySearchDiagnostics = {
      retrievalMode: "<img src=x onerror=alert(6)>explicit",
      sourceClassMix: { curated: 1 },
      stages: {
        raw: { count: 5 },
        scoreAware: { count: 4 },
        reranked: { count: 3 },
        returned: { count: 2, topHits: [{ id: "<svg onload=alert(7)>mem-1", sourceClass: "curated" }] },
      },
    };

    expect(() => feature.renderMemoryList(items)).not.toThrow();

    const rows = [...refs.memoryViewerListEl.querySelectorAll("[data-memory-id]")];
    expect(rows).toHaveLength(20);
    expect(rows[0]?.getAttribute("data-memory-id")).toBe(attackMemoryId);
    expect(rows[0]?.classList.contains("active")).toBe(true);
    expect(rows[0]?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(2)</script>memory.md");
    const firstRowMeta = [...rows[0]?.querySelectorAll(".memory-list-item-meta span") ?? []];
    expect(firstRowMeta.map((node) => node.textContent)).toEqual([
      "<svg onload=alert(4)>note",
      "<iframe srcdoc='<script>alert(5)</script>'>conversation",
      "shared",
      "hybrid",
      "<math><mtext>general</mtext></math>",
      "score <object data=x>0.9",
    ]);
    expect(firstRowMeta.map((node) => node.className)).toEqual([
      "",
      "",
      "memory-badge memory-badge-shared",
      "memory-badge memory-badge-hybrid",
      "memory-badge",
      "",
    ]);
    expect(rows[0]?.querySelector(".memory-list-item-snippet")?.textContent).toBe("<img src=x onerror=alert(3)>summary");
    expect(refs.memoryViewerListEl.textContent).toContain("mode=<img src=x onerror=alert(6)>explicit");
    expect(refs.memoryViewerListEl.textContent).toContain("top hits: <svg onload=alert(7)>mem-1 (curated)");
    expect(refs.memoryViewerListEl.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]")).toBeNull();
    expect(refs.memoryViewerListEl.textContent).toContain("Showing 1-20 / 21");

    rows[1]?.click();
    await Promise.resolve();
    expect(loadMemoryDetail).toHaveBeenLastCalledWith("mem-2");
    expect(state.selectedId).toBe("mem-2");
    expect(rows[1]?.classList.contains("active")).toBe(true);

    refs.memoryViewerListEl.querySelector("[data-memory-list-page-action='next']")?.click();
    await Promise.resolve();

    expect(loadMemoryDetail).toHaveBeenCalledTimes(2);
    expect(loadMemoryDetail).toHaveBeenCalledWith("mem-21");
    expect(state.selectedId).toBe("mem-21");
    expect(refs.memoryViewerListEl.querySelectorAll("[data-memory-id]")).toHaveLength(1);
    expect(refs.memoryViewerListEl.querySelector("[data-memory-id='mem-21']")?.classList.contains("active")).toBe(true);
  });

  it("renders task rows safely and preserves row selection and next-page loading", async () => {
    const { state, refs, feature, loadTaskDetail } = createHarness("tasks");
    blockNonEmptyInnerHtml(refs.memoryViewerListEl);
    const attackTaskId = 'task-1"><img src=x onerror=alert(1)>';
    const items = Array.from({ length: 21 }, (_, index) => ({
      id: index === 0 ? attackTaskId : `task-${index + 1}`,
      title: index === 0 ? "<script>alert(2)</script>Task" : `Task ${index + 1}`,
      summary: index === 0 ? "<img src=x onerror=alert(3)>Summary" : `Summary ${index + 1}`,
      status: index === 0 ? "<svg onload=alert(4)>status" : "completed",
      source: index === 0 ? "<iframe srcdoc='<script>alert(5)</script>'>source" : "manual",
      goalId: index === 0 ? "<math><mtext>Goal</mtext></math>" : "",
      createdAt: index === 0 ? "<object data=x>date" : `2026-07-${String(index + 1).padStart(2, "0")}`,
    }));
    state.items = items;
    state.selectedId = attackTaskId;

    expect(() => feature.renderTaskList(items)).not.toThrow();

    const rows = [...refs.memoryViewerListEl.querySelectorAll("[data-task-id]")];
    expect(rows).toHaveLength(20);
    expect(rows[0]?.getAttribute("data-task-id")).toBe(attackTaskId);
    expect(rows[0]?.classList.contains("active")).toBe(true);
    expect(rows[0]?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(2)</script>Task");
    expect([...rows[0]?.querySelectorAll(".memory-list-item-meta span") ?? []].map((node) => node.textContent)).toEqual([
      "<svg onload=alert(4)>status",
      "<iframe srcdoc='<script>alert(5)</script>'>source",
      "<math><mtext>Goal</mtext></math>",
      "<object data=x>date",
    ]);
    expect(rows[0]?.querySelector(".memory-list-item-snippet")?.textContent).toBe("<img src=x onerror=alert(3)>Summary");
    expect(refs.memoryViewerListEl.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]")).toBeNull();
    expect(refs.memoryViewerListEl.textContent).toContain("Showing 1-20 / 21");

    rows[1]?.click();
    await Promise.resolve();
    expect(state.selectedId).toBe("task-2");
    expect(rows[1]?.classList.contains("active")).toBe(true);
    expect(loadTaskDetail).toHaveBeenLastCalledWith("task-2");

    refs.memoryViewerListEl.querySelector("[data-memory-list-page-action='next']")?.click();
    await Promise.resolve();

    expect(loadTaskDetail).toHaveBeenLastCalledWith("task-21");
    expect(state.selectedId).toBe("task-21");
    expect(refs.memoryViewerListEl.querySelectorAll("[data-task-id]")).toHaveLength(1);
    expect(refs.memoryViewerListEl.querySelector("[data-task-id='task-21']")?.classList.contains("active")).toBe(true);
  });

  it("renders outbound audit rows safely and preserves detail selection across pagination", async () => {
    const { state, refs, feature } = createHarness("outboundAudit");
    blockNonEmptyInnerHtml(refs.memoryViewerListEl);
    const organizerRawId = 'thread-1"><img src=x onerror=alert(1)>';
    const organizerId = `email_thread_organizer:${organizerRawId}`;
    const items = Array.from({ length: 26 }, (_, index) => {
      if (index === 0) {
        return {
          auditKind: "email_thread_organizer",
          id: organizerRawId,
          latestSubject: "<script>alert(2)</script>Organizer",
          latestTimestamp: "<svg onload=alert(3)>2026-07-21",
          latestSender: "<iframe srcdoc='<script>alert(4)</script>'>sender",
          latestTriageCategory: "<math><mtext>priority</mtext></math>",
          needsReply: true,
          latestTriageSummary: "<img src=x onerror=alert(5)>Organizer summary",
        };
      }
      return {
        auditKind: "channel",
        requestId: `req-${index + 1}`,
        targetChannel: index === 2 ? "<object data=x>channel" : "feishu",
        decision: index === 2 ? "<script>alert(6)</script>decision" : "confirmed",
        delivery: index === 2 ? "<svg onload=alert(7)>delivery" : "sent",
        timestamp: index === 2 ? "<iframe srcdoc='<script>alert(8)</script>'>date" : `2026-07-${String(index + 1).padStart(2, "0")}`,
        requestedByAgentId: index === 2 ? "<math><mtext>agent</mtext></math>" : `agent-${index + 1}`,
        contentPreview: index === 2 ? "<img src=x onerror=alert(9)>Audit preview" : `Audit preview ${index + 1}`,
      };
    });
    state.items = items;
    state.selectedId = organizerId;

    expect(() => feature.renderExternalOutboundAuditList(items)).not.toThrow();

    const rows = [...refs.memoryViewerListEl.querySelectorAll("[data-outbound-audit-id]")];
    expect(rows).toHaveLength(25);
    expect(rows[0]?.getAttribute("data-outbound-audit-id")).toBe(organizerId);
    expect(rows[0]?.classList.contains("active")).toBe(true);
    expect(rows[0]?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(2)</script>Organizer");
    expect([...rows[0]?.querySelectorAll(".memory-list-item-meta span") ?? []].map((node) => node.textContent)).toEqual([
      "<svg onload=alert(3)>2026-07-21",
      "<iframe srcdoc='<script>alert(4)</script>'>sender",
      "<math><mtext>priority</mtext></math> / 待回复",
    ]);
    expect(rows[0]?.querySelector(".memory-list-item-snippet")?.textContent)
      .toBe("<img src=x onerror=alert(5)>Organizer summary");
    expect(rows[2]?.querySelector(".memory-list-item-title")?.textContent)
      .toBe("<object data=x>channel · <script>alert(6)</script>decision / <svg onload=alert(7)>delivery");
    expect(rows[2]?.querySelector(".memory-list-item-snippet")?.textContent)
      .toBe("<img src=x onerror=alert(9)>Audit preview");
    expect(refs.memoryViewerListEl.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]")).toBeNull();
    expect(refs.memoryViewerListEl.textContent).toContain("Showing 1-25 / 26");

    rows[1]?.click();
    await Promise.resolve();
    expect(state.selectedId).toBe("channel:req-2");
    expect(refs.memoryViewerListEl.querySelector("[data-outbound-audit-id='channel:req-2']")?.classList.contains("active")).toBe(true);
    expect(refs.memoryViewerDetailEl.textContent).toContain("Audit preview 2");

    refs.memoryViewerListEl.querySelector("[data-memory-list-page-action='next']")?.click();
    await Promise.resolve();

    expect(state.selectedId).toBe("channel:req-26");
    expect(refs.memoryViewerListEl.querySelectorAll("[data-outbound-audit-id]")).toHaveLength(1);
    expect(refs.memoryViewerListEl.querySelector("[data-outbound-audit-id='channel:req-26']")?.classList.contains("active")).toBe(true);
    expect(refs.memoryViewerDetailEl.textContent).toContain("Audit preview 26");
  });

  it("renders shared-review rows safely and preserves batch and detail selection across pagination", async () => {
    const { state, refs, feature, loadMemoryDetail } = createHarness("sharedReview");
    blockNonEmptyInnerHtml(refs.memoryViewerListEl);
    const attackMemoryId = 'shared-1"><img src=x onerror=alert(1)>';
    const attackTargetId = 'target"><svg onload=alert(2)>';
    const items = Array.from({ length: 26 }, (_, index) => ({
      id: index === 0 ? attackMemoryId : `shared-${index + 1}`,
      sourcePath: index === 0 ? "<script>alert(3)</script>memory.md" : `state/memory/${index + 1}.md`,
      summary: index === 0 ? "<img src=x onerror=alert(4)>Summary" : `Summary ${index + 1}`,
      visibility: "shared",
      sourceView: { scope: index === 0 ? "hybrid" : "shared" },
      category: index === 0 ? "<math><mtext>decision</mtext></math>" : "decision",
      targetAgentId: index === 0 ? attackTargetId : `agent-${index + 1}`,
      targetDisplayName: index === 0 ? "<iframe srcdoc='<script>alert(5)</script>'>Target" : `Agent ${index + 1}`,
      reviewStatus: "pending",
      claimOwner: index === 0 ? "<svg onload=alert(6)>claim-owner" : "",
      blockedByOtherReviewer: index === 0,
      actionableByReviewer: index !== 0,
      claimExpiresAt: index === 0 ? "<object data=x>soon" : "",
      updatedAt: index === 0 ? "<svg onload=alert(7)>2026-07-21" : `2026-07-${String(index + 1).padStart(2, "0")}`,
    }));
    state.items = items;
    state.selectedId = attackMemoryId;
    state.selectedSharedReviewIds = [attackMemoryId];

    expect(() => feature.renderSharedReviewList(items)).not.toThrow();

    const rows = [...refs.memoryViewerListEl.querySelectorAll("[data-shared-review-memory-id]")];
    expect(rows).toHaveLength(25);
    expect(rows[0]?.getAttribute("data-shared-review-memory-id")).toBe(attackMemoryId);
    expect(rows[0]?.getAttribute("data-shared-review-target-agent-id")).toBe(attackTargetId);
    expect(rows[0]?.classList.contains("active")).toBe(true);
    const checkbox = rows[0]?.querySelector("[data-shared-review-select]");
    expect(checkbox?.checked).toBe(true);
    expect(rows[0]?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(3)</script>memory.md");
    expect([...rows[0]?.querySelectorAll(".memory-list-item-meta span") ?? []].map((node) => ({
      text: node.textContent,
      className: node.className,
    }))).toEqual([
      { text: "<iframe srcdoc='<script>alert(5)</script>'>Target", className: "memory-badge" },
      { text: "pending", className: "memory-badge" },
      { text: "Review Claim: <svg onload=alert(6)>claim-owner", className: "memory-badge memory-badge-hybrid" },
      { text: "Blocked", className: "memory-badge memory-badge-hybrid" },
      { text: "hybrid", className: "memory-badge memory-badge-hybrid" },
      { text: "<math><mtext>decision</mtext></math>", className: "memory-badge" },
      { text: "Expires <object data=x>soon", className: "" },
      { text: "<svg onload=alert(7)>2026-07-21", className: "" },
    ]);
    expect(rows[0]?.querySelector(".memory-list-item-snippet")?.textContent).toBe("<img src=x onerror=alert(4)>Summary");
    expect(refs.memoryViewerListEl.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]")).toBeNull();
    expect(refs.memoryViewerListEl.textContent).toContain("Showing 1-25 / 26");

    checkbox?.click();
    await Promise.resolve();
    expect(state.selectedSharedReviewIds).toEqual([]);
    expect(loadMemoryDetail).not.toHaveBeenCalled();

    rows[1]?.click();
    await Promise.resolve();
    expect(state.selectedId).toBe("shared-2");
    expect(rows[1]?.classList.contains("active")).toBe(true);
    expect(loadMemoryDetail).toHaveBeenLastCalledWith("shared-2", null, { targetAgentId: "agent-2" });

    refs.memoryViewerListEl.querySelector("[data-memory-list-page-action='next']")?.click();
    await Promise.resolve();

    expect(state.selectedId).toBe("shared-26");
    expect(loadMemoryDetail).toHaveBeenLastCalledWith("shared-26", null, { targetAgentId: "agent-26" });
    expect(refs.memoryViewerListEl.querySelectorAll("[data-shared-review-memory-id]")).toHaveLength(1);
    expect(refs.memoryViewerListEl.querySelector("[data-shared-review-memory-id='shared-26']")?.classList.contains("active")).toBe(true);
  });
});
