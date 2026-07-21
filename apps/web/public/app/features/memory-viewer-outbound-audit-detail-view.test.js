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
      if (value) throw new Error("Memory Viewer outbound audit detail must not use innerHTML");
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
    getMemoryViewerState: () => ({ tab: "outboundAudit", outboundAuditFocus: "all", sharedReviewFilters: {} }),
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
    formatDateTime: (value) => `date:${String(value ?? "")}`,
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

  return { feature, refs };
}

describe("Memory Viewer outbound audit detail DOM owner", () => {
  it("renders full and compact organizer detail as inert text with the conversation action", () => {
    const { feature, refs } = createHarness();
    blockNonEmptyInnerHtml(refs.memoryViewerDetailEl);
    const conversationId = 'channel=email:thread"><img src=x onerror=alert(1)>';
    const item = {
      auditKind: "email_thread_organizer",
      conversationId,
      providerId: "<script>alert(2)</script>provider",
      targetAccountId: "account-1",
      requestedAgentId: "agent-1",
      latestSubject: "<svg onload=alert(3)>Subject",
      latestSender: "<iframe srcdoc='<script>alert(4)</script>'>sender",
      latestStatus: "processed",
      latestTriageCategory: "action_required",
      latestTriagePriority: "high",
      latestTriageDisposition: "reply",
      latestTriageSummary: "<img src=x onerror=alert(5)>Summary",
      latestSuggestedReplyQuality: "review_required",
      latestSuggestedReplyWarnings: ["<object data=x>warning"],
      latestSuggestedReplyChecklist: ["<math><mtext>check</mtext></math>"],
      latestSuggestedReplyDraft: "<script>alert(6)</script>draft",
      latestSuggestedReplyStarter: "starter",
      latestSuggestedReplyConfidence: "medium",
      latestSuggestedReplySubject: "Re: subject",
      latestTriageFollowUpWindowHours: 12,
      latestPreview: "<img src=x onerror=alert(7)>preview",
      threadId: "thread-1",
      latestMessageId: "message-1",
      messageCount: 4,
      processedCount: 3,
      failedCount: 1,
      retryScheduledCount: 2,
      needsReply: true,
      needsFollowUp: true,
      reminderStatus: "pending",
      reminderDueAt: "2026-07-22T00:00:00Z",
      reminderLastDeliveredAt: "2026-07-21T00:00:00Z",
      reminderResolvedAt: "2026-07-20T00:00:00Z",
    };

    expect(() => feature.renderExternalOutboundAuditDetail(item)).not.toThrow();

    const fullShell = refs.memoryViewerDetailEl.querySelector(".memory-detail-shell");
    const action = refs.memoryViewerDetailEl.querySelector("[data-open-email-thread-conversation]");
    expect(action?.getAttribute("data-open-email-thread-conversation")).toBe(conversationId);
    expect(action?.disabled).toBe(false);
    expect(fullShell?.textContent).toContain("<svg onload=alert(3)>Subject");
    expect(fullShell?.textContent).toContain("<object data=x>warning");
    expect(fullShell?.textContent).toContain("线程 ID");
    expect(refs.memoryViewerDetailEl.querySelector("img, script, svg, iframe, object, math, [onerror], [onload]")).toBeNull();

    globalThis.BELLDANDY_WEB_CONFIG.governanceDetailMode = "compact";
    feature.renderExternalOutboundAuditDetail(item);

    expect(fullShell?.isConnected).toBe(false);
    expect(refs.memoryViewerDetailEl.textContent).toContain("<svg onload=alert(3)>Subject");
    expect(refs.memoryViewerDetailEl.textContent).not.toContain("线程 ID");
    expect(refs.memoryViewerDetailEl.textContent).not.toContain("<object data=x>warning");
  });

  it("renders inbound, outbound email, and channel details with cross-branch replacement", () => {
    const { feature, refs } = createHarness();
    blockNonEmptyInnerHtml(refs.memoryViewerDetailEl);

    feature.renderExternalOutboundAuditDetail({
      auditKind: "email_inbound",
      timestamp: "2026-07-21T10:00:00Z",
      conversationId: "conversation-1",
      requestedAgentId: "agent-1",
      providerId: "provider-1",
      targetAccountId: "account-1",
      from: ["<img src=x onerror=alert(1)>sender@example.com"],
      subject: "<script>alert(2)</script>Inbound",
      status: "failed",
      createdBinding: true,
      triageCategory: "action_required",
      triagePriority: "high",
      triageDisposition: "reply",
      triageSummary: "Inbound summary",
      suggestedReplyQuality: "review_required",
      suggestedReplyWarnings: ["<svg onload=alert(3)>warning"],
      suggestedReplyChecklist: ["check one"],
      suggestedReplyDraft: "draft",
      suggestedReplyStarter: "starter",
      suggestedReplyConfidence: "medium",
      suggestedReplySubject: "Re: inbound",
      retryScheduled: true,
      retryAttempt: 2,
      messageId: "message-1",
      threadId: "thread-1",
      inReplyToMessageId: "message-0",
      references: ["ref-1", "ref-2"],
      triageFollowUpWindowHours: 4,
      errorCode: "SMTP_FAILED",
      error: "<iframe srcdoc='<script>alert(4)</script>'>failure",
      attachmentCount: 2,
      inlineAttachmentCount: 1,
      mailbox: "INBOX",
      sessionKey: "session-1",
      checkpointUid: 42,
      bodyPreview: "<object data=x>Inbound preview",
    });

    const inboundShell = refs.memoryViewerDetailEl.querySelector(".memory-detail-shell");
    expect(inboundShell?.textContent).toContain("<img src=x onerror=alert(1)>sender@example.com");
    expect(inboundShell?.textContent).toContain("回复建议风险");
    expect(inboundShell?.textContent).toContain("SMTP_FAILED");

    feature.renderExternalOutboundAuditDetail({
      auditKind: "email",
      timestamp: "2026-07-21T11:00:00Z",
      sourceConversationId: "conversation-2",
      requestedByAgentId: "agent-2",
      providerId: "provider-2",
      targetAccountId: "account-2",
      to: ["to@example.com"],
      cc: ["cc@example.com"],
      bcc: ["<img src=x onerror=alert(5)>bcc@example.com"],
      subject: "Outbound subject",
      decision: "confirmed",
      delivery: "failed",
      requestId: "request-2",
      threadId: "thread-2",
      errorCode: "DELIVERY_FAILED",
      error: "Outbound failure",
      attachmentCount: 3,
      replyToMessageId: "message-2",
      providerMessageId: "provider-message-2",
      bodyPreview: "Outbound preview",
    });

    const outboundShell = refs.memoryViewerDetailEl.querySelector(".memory-detail-shell");
    expect(inboundShell?.isConnected).toBe(false);
    expect(outboundShell?.textContent).toContain("to@example.com, cc@example.com, <img src=x onerror=alert(5)>bcc@example.com");
    expect(outboundShell?.textContent).toContain("Provider Message ID");
    expect(outboundShell?.textContent).not.toContain("回复建议风险");

    globalThis.BELLDANDY_WEB_CONFIG.governanceDetailMode = "compact";
    feature.renderExternalOutboundAuditDetail({
      auditKind: "channel",
      timestamp: "2026-07-21T12:00:00Z",
      sourceConversationId: "conversation-3",
      requestedByAgentId: "agent-3",
      targetChatId: "chat-3",
      targetAccountId: "account-3",
      requestedSessionKey: "requested-session-3",
      targetSessionKey: "target-session-3",
      decision: "confirmed",
      delivery: "sent",
      requestId: "request-3",
      resolution: "direct",
      contentPreview: "Channel preview",
    });

    expect(outboundShell?.isConnected).toBe(false);
    expect(refs.memoryViewerDetailEl.textContent).toContain("chat-3");
    expect(refs.memoryViewerDetailEl.textContent).toContain("Channel preview");
    expect(refs.memoryViewerDetailEl.textContent).not.toContain("Request ID");
    expect(refs.memoryViewerDetailEl.querySelector("img, script, svg, iframe, object, math, [onerror], [onload]")).toBeNull();
  });

  it("treats a missing detail root as a no-op and records the adjacent owner boundary", () => {
    const { feature } = createHarness({ withDetailRoot: false });
    expect(() => feature.renderExternalOutboundAuditDetail({ auditKind: "channel" })).not.toThrow();

    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const detailStart = source.indexOf("function renderExternalOutboundAuditDetail(item)");
    const detailEnd = source.indexOf("function getCandidateDetailViewInput", detailStart);
    const detailSource = source.slice(detailStart, detailEnd);

    expect(source).toContain('import { createMemoryViewerOutboundAuditDetailView }');
    expect(source).toContain("const outboundAuditDetailView = createMemoryViewerOutboundAuditDetailView(");
    expect(detailSource).not.toContain("memoryViewerDetailEl.innerHTML");
    expect(detailSource).toContain("outboundAuditDetailView.render({");
    expect(detailSource).toContain('querySelectorAll("[data-open-email-thread-conversation]")');
  });
});
