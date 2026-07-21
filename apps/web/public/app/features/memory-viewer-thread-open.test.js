// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

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

  const sendReq = vi.fn(async () => ({ ok: true, payload: { conversationId: "channel=email:thread-1" } }));
  const openConversationSession = vi.fn();
  const showNotice = vi.fn();

  const feature = createMemoryViewerFeature({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: () => "req-1",
    getMemoryViewerState: () => ({ tab: "outboundAudit", outboundAuditFocus: "threads", sharedReviewFilters: {} }),
    getSelectedAgentId: () => "default",
    getSelectedAgentLabel: () => "default",
    getAvailableAgents: () => [],
    syncMemoryTaskGoalFilterUi: vi.fn(),
    renderMemoryViewerListEmpty: vi.fn(),
    renderMemoryViewerDetailEmpty: vi.fn(),
    loadTaskDetail: vi.fn(),
    loadMemoryDetail: vi.fn(),
    escapeHtml: (value) => String(value),
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
    openConversationSession,
    showNotice,
    t: (_key, _params, fallback) => fallback ?? "",
  });

  return { refs, feature, sendReq, openConversationSession, showNotice };
}

describe("memory viewer thread organizer open action", () => {
  it("opens the thread conversation and auto-requests one advice run", async () => {
    const { refs, feature, sendReq, openConversationSession } = createHarness();

    feature.renderExternalOutboundAuditDetail({
      auditKind: "email_thread_organizer",
      conversationId: "channel=email:thread-1",
      latestSubject: "Re: Kickoff",
      latestTriageSummary: "需要尽快回复",
      latestSuggestedReplyStarter: "Hi Alice,",
      latestSuggestedReplyQuality: "review_required",
      latestSuggestedReplyDraft: "Hi Alice,\n\nThanks for following up.",
    });

    refs.memoryViewerDetailEl.querySelector("[data-open-email-thread-conversation]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openConversationSession).toHaveBeenCalledWith(
      "channel=email:thread-1",
      expect.stringContaining("channel=email:thread-1"),
      expect.objectContaining({
        systemNoticeText: expect.stringContaining("线程整理摘要: 需要尽快回复"),
      }),
    );
    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "message.send",
      params: expect.objectContaining({
        conversationId: "channel=email:thread-1",
        text: expect.stringContaining("我刚从邮件线程整理打开了这个线程"),
        agentId: "default",
      }),
    }));

    refs.memoryViewerDetailEl.querySelector("[data-open-email-thread-conversation]")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendReq).toHaveBeenCalledTimes(1);
  });
});
