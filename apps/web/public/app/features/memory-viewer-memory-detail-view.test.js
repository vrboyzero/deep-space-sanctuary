// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryViewerFeature } from "./memory-viewer.js";

let previousWebConfig;

beforeEach(() => {
  previousWebConfig = globalThis.BELLDANDY_WEB_CONFIG;
  globalThis.BELLDANDY_WEB_CONFIG = {
    ...(previousWebConfig && typeof previousWebConfig === "object" ? previousWebConfig : {}),
    governanceDetailMode: "full",
  };
});

afterEach(() => {
  document.body.replaceChildren();
  if (previousWebConfig && typeof previousWebConfig === "object") {
    globalThis.BELLDANDY_WEB_CONFIG = previousWebConfig;
    return;
  }
  delete globalThis.BELLDANDY_WEB_CONFIG;
});

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Memory Viewer memory detail must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

function createHarness({ withDetailRoot = true } = {}) {
  const refs = {
    memoryViewerSection: document.createElement("section"),
    memoryViewerTitleEl: document.createElement("div"),
    memoryViewerStatsEl: document.createElement("div"),
    memoryViewerListEl: document.createElement("div"),
    memoryViewerDetailEl: withDetailRoot ? document.createElement("div") : null,
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
  if (refs.memoryViewerDetailEl) document.body.append(refs.memoryViewerDetailEl);

  const feature = createMemoryViewerFeature({
    refs,
    isConnected: () => true,
    sendReq: vi.fn(async () => ({ ok: true })),
    makeId: () => "request-1",
    getMemoryViewerState: () => ({
      tab: "memories",
      outboundAuditFocus: "all",
      sharedReviewFilters: {},
      activeAgentId: "reviewer-1",
    }),
    getSelectedAgentId: () => "reviewer-1",
    getSelectedAgentLabel: () => "Reviewer 1",
    getAvailableAgents: () => [],
    syncMemoryTaskGoalFilterUi: vi.fn(),
    renderMemoryViewerListEmpty: vi.fn(),
    renderMemoryViewerDetailEmpty: vi.fn(),
    loadTaskDetail: vi.fn(),
    loadMemoryDetail: vi.fn(),
    escapeHtml: (value) => String(value ?? ""),
    formatCount: (value) => `count:${String(value ?? 0)}`,
    formatDateTime: (value) => `date:${String(value ?? "")}`,
    formatDuration: (value) => String(value ?? ""),
    formatLineRange: (start, end) => `${start ?? ""}-${end ?? ""}`,
    formatScore: (value) => `score:${String(value ?? "")}`,
    formatMemoryCategory: (value) => `category:${String(value ?? "")}`,
    normalizeMemoryVisibility: (value) => String(value ?? "private"),
    getVisibilityBadgeClass: (value) => `visibility-${value}`,
    summarizeSourcePath: (value) => `path:${String(value ?? "")}`,
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

  return { feature, refs };
}

function createPendingItem() {
  return {
    id: 'chunk"><img src=x onerror=alert(1)>',
    sourcePath: 'state/<script>alert(2)</script>/memory.md',
    startLine: 7,
    endLine: 12,
    sourceType: "conversation",
    memoryType: "note",
    visibility: "private",
    category: "<svg onload=alert(3)>general",
    score: 0.75,
    summary: "<iframe srcdoc='<script>alert(4)</script>'>summary",
    snippet: "<object data=x>snippet",
    content: Array.from({ length: 18 }, (_, index) => `<img src=x onerror=alert(5)>content-${index + 1}`).join("\n"),
    sourceView: {
      scope: "private",
      origin: "resident",
      summary: "<math><mtext>source</mtext></math>",
    },
    targetAgentId: "target-1",
    targetDisplayName: "<script>alert(6)</script>Target",
    claimOwner: "reviewer-1",
    claimExpiresAt: "2026-07-22T00:00:00Z",
    actionableByReviewer: true,
    metadata: {
      sharedPromotion: {
        status: "pending",
        sourcePath: 'state/<script>alert(2)</script>/memory.md',
        sourceAgentId: "source-1",
        claimedByAgentId: "reviewer-1",
      },
      unsafe: "<img src=x onerror=alert(7)>",
      lines: Array.from({ length: 18 }, (_, index) => `metadata-${index + 1}`),
    },
  };
}

describe("Memory Viewer memory detail DOM owner", () => {
  it("renders pending source-scoped detail and collapsed blocks as inert DOM", () => {
    const { feature, refs } = createHarness();
    blockNonEmptyInnerHtml(refs.memoryViewerDetailEl);
    const item = createPendingItem();

    expect(() => feature.renderMemoryDetail(item)).not.toThrow();

    const shell = refs.memoryViewerDetailEl.querySelector(".memory-detail-shell");
    expect(shell?.textContent).toContain("<iframe srcdoc='<script>alert(4)</script>'>summary");
    expect(shell?.textContent).toContain("<object data=x>snippet");
    expect(refs.memoryViewerDetailEl.querySelector("img, script, svg, iframe, object, math, [onerror], [onload]")).toBeNull();

    const sourceButtons = [...refs.memoryViewerDetailEl.querySelectorAll("[data-open-source]")];
    expect(sourceButtons).toHaveLength(2);
    expect(sourceButtons.map((button) => ({
      path: button.getAttribute("data-open-source"),
      line: button.getAttribute("data-open-line"),
    }))).toEqual([
      { path: item.sourcePath, line: "7" },
      { path: item.sourcePath, line: "7" },
    ]);
    expect(refs.memoryViewerDetailEl.querySelector('[data-memory-share-claim="release"]')
      ?.getAttribute("data-memory-share-claim-scope")).toBe("source");
    expect([...refs.memoryViewerDetailEl.querySelectorAll('[data-memory-share-decision-scope="source"]')]
      .map((button) => button.getAttribute("data-memory-share-decision"))).toEqual(["approved", "rejected"]);
    expect(refs.memoryViewerDetailEl.querySelector("[data-memory-open-shared-review-context]")).not.toBeNull();

    const contentToggle = refs.memoryViewerDetailEl.querySelector('[data-memory-detail-toggle="content"]');
    const metadataToggle = refs.memoryViewerDetailEl.querySelector('[data-memory-detail-toggle="metadata"]');
    expect(contentToggle?.getAttribute("data-memory-detail-expanded")).toBe("false");
    expect(metadataToggle?.getAttribute("data-memory-detail-expanded")).toBe("false");
    contentToggle?.click();
    metadataToggle?.click();
    expect(refs.memoryViewerDetailEl.querySelector('[data-memory-detail-body="content"]')?.textContent).toContain("content-18");
    expect(refs.memoryViewerDetailEl.querySelector('[data-memory-detail-body="metadata"]')?.textContent).toContain("metadata-18");
  });

  it("preserves promote/revoke actions while compact mode replaces full-only fields", () => {
    const { feature, refs } = createHarness();
    blockNonEmptyInnerHtml(refs.memoryViewerDetailEl);

    feature.renderMemoryDetail({
      ...createPendingItem(),
      id: "private-1",
      metadata: { unsafe: "<script>alert(8)</script>" },
    });
    const privateShell = refs.memoryViewerDetailEl.querySelector(".memory-detail-shell");
    expect(refs.memoryViewerDetailEl.querySelector("[data-memory-share-promote]")
      ?.getAttribute("data-memory-share-promote")).toBe("private-1");

    globalThis.BELLDANDY_WEB_CONFIG.governanceDetailMode = "compact";
    feature.renderMemoryDetail({
      ...createPendingItem(),
      id: "approved-1",
      metadata: { sharedPromotion: { status: "approved" } },
    });

    expect(privateShell?.isConnected).toBe(false);
    expect(refs.memoryViewerDetailEl.querySelector('[data-memory-share-decision="revoked"]')).not.toBeNull();
    expect(refs.memoryViewerDetailEl.textContent).not.toContain("Source Path");
    expect(refs.memoryViewerDetailEl.textContent).not.toContain("元数据");
    expect(refs.memoryViewerDetailEl.querySelector('[data-memory-detail-body="content"]')).not.toBeNull();
    expect(refs.memoryViewerDetailEl.querySelector("img, script, svg, iframe, object, math, [onerror], [onload]")).toBeNull();
  });

  it("treats a missing detail root as a no-op and records the adjacent owner boundary", () => {
    const { feature } = createHarness({ withDetailRoot: false });
    expect(() => feature.renderMemoryDetail({ id: "memory-1" })).not.toThrow();

    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const detailStart = source.indexOf("function renderMemoryDetail(item)");
    const detailEnd = source.indexOf("function dispose()", detailStart);
    const detailSource = source.slice(detailStart, detailEnd);

    expect(source).toContain('import { createMemoryViewerMemoryDetailView }');
    expect(source).toContain("const memoryDetailView = createMemoryViewerMemoryDetailView(");
    expect(detailSource).not.toContain("memoryViewerDetailEl.innerHTML");
    expect(detailSource).toContain("memoryDetailView.render({");
    expect(detailSource).toContain("bindMemoryPathLinks();");
    expect(detailSource).toContain("bindMemoryDetailActions(item);");
  });
});
