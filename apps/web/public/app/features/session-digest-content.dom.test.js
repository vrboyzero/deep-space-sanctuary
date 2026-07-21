// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionDigestFeature } from "./session-digest.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Session Digest modal content DOM rendering", () => {
  it("renders continuation details and replacement without using the HTML parser", () => {
    document.body.innerHTML = `
      <div id="sessionDigestSummary"></div>
      <div id="sessionContinuationSummary"></div>
      <button id="sessionDigestRefresh">刷新摘要</button>
      <div id="sessionDigestModal" class="hidden">
        <span id="sessionDigestModalTitle"></span>
        <div id="sessionDigestModalMeta"></div>
        <div id="sessionDigestModalActions"></div>
        <div id="sessionDigestModalContent"></div>
        <button id="sessionDigestModalClose">关闭</button>
      </div>
    `;
    const summary = document.getElementById("sessionDigestSummary");
    const content = document.getElementById("sessionDigestModalContent");
    const maliciousSummary = '<img src=x onerror="alert(1)">digest body';
    const recommendedTargetId = 'conversation:<svg onload="alert(2)">follow-up</svg>';
    const checkpointLabels = [
      "<script>alert(3)</script>one",
      "<style>bad</style>two",
      "<iframe src=javascript:alert(4)>three</iframe>",
      "<b>four</b>",
      "fifth-must-be-truncated",
    ];
    const recent = [
      "<img src=x onerror=alert(5)>recent-one",
      "<svg onload=alert(6)>recent-two</svg>",
      "<script>alert(7)</script>recent-three",
      "fourth-must-be-truncated",
    ];
    const continuation = {
      resumeMode: '<img src=x onerror="alert(8)">ask_user',
      targetType: "conversation",
      recommendedTargetId,
      nextAction: "<script>alert(9)</script>next action",
      summary: "<style>bad</style>continuation summary",
      checkpoints: {
        openCount: 2,
        blockerCount: 1,
        labels: checkpointLabels,
      },
      progress: {
        current: '<iframe src="javascript:alert(10)">waiting</iframe>',
        recent,
      },
    };
    const onOpenContinuationAction = vi.fn();
    const labels = {
      "panel.sessionContinuationLabel": '<img src=x onerror="alert(11)">Continuation',
      "panel.sessionContinuationTargetLabel": "<script>alert(12)</script>Target",
      "panel.sessionContinuationNextAction": "<style>bad</style>Next Action",
      "panel.sessionContinuationSummaryLabel": '<svg onload="alert(13)">Summary</svg>',
    };
    const feature = createSessionDigestFeature({
      refs: {
        sessionDigestSummaryEl: summary,
        sessionContinuationSummaryEl: document.getElementById("sessionContinuationSummary"),
        sessionDigestRefreshBtn: document.getElementById("sessionDigestRefresh"),
        sessionDigestModalEl: document.getElementById("sessionDigestModal"),
        sessionDigestModalTitleEl: document.getElementById("sessionDigestModalTitle"),
        sessionDigestModalMetaEl: document.getElementById("sessionDigestModalMeta"),
        sessionDigestModalActionsEl: document.getElementById("sessionDigestModalActions"),
        sessionDigestModalContentEl: content,
        sessionDigestModalCloseBtn: document.getElementById("sessionDigestModalClose"),
      },
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      getActiveConversationId: () => "conversation:current",
      onSendHistoryAction: undefined,
      onOpenContinuationAction,
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: () => "2026-07-20 00:00:00",
      showNotice: vi.fn(),
      t: (key, _params, fallback) => labels[key] ?? fallback ?? "",
    });
    feature.handleDigestUpdated({
      conversationId: "conversation:current",
      source: "event",
      digest: {
        status: "ready",
        messageCount: 4,
        pendingMessageCount: 1,
        threshold: 5,
        digestedMessageCount: 3,
        lastDigestAt: 1713663000000,
        rollingSummary: "initial digest body",
      },
    });
    summary.querySelector(".session-digest-card").click();

    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(content, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Session Digest modal content must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    expect(() => feature.setContinuationState(
      continuation,
      { conversationId: "conversation:current" },
    )).not.toThrow();
    feature.handleDigestUpdated({
      conversationId: "conversation:current",
      source: "event",
      digest: {
        status: "ready",
        messageCount: 4,
        pendingMessageCount: 1,
        threshold: 5,
        digestedMessageCount: 3,
        lastDigestAt: 1713663000000,
        rollingSummary: maliciousSummary,
      },
    });

    expect(content.querySelector(":scope > .session-digest-modal-copy")?.textContent).toBe(maliciousSummary);
    const section = content.querySelector(":scope > .session-digest-modal-section");
    expect(section).not.toBeNull();
    expect(section.querySelector(".session-digest-modal-section-title")?.textContent).toBe(
      labels["panel.sessionContinuationLabel"],
    );
    expect(section.querySelectorAll(".session-digest-modal-section-head .memory-badge")).toHaveLength(4);
    expect(section.querySelectorAll(".session-digest-modal-grid > .session-digest-modal-card")).toHaveLength(2);
    expect([...section.querySelectorAll(":scope > .session-digest-modal-chip-row > .memory-badge")].map((item) => item.textContent)).toEqual(
      checkpointLabels.slice(0, 4),
    );
    expect([...section.querySelectorAll(".session-digest-modal-note-list > .session-digest-modal-note")].map((item) => item.textContent)).toEqual(
      recent.slice(0, 3),
    );
    expect(content.textContent).not.toContain(checkpointLabels[4]);
    expect(content.textContent).not.toContain(recent[3]);
    expect(content.querySelector("img, svg, script, style, iframe, b, [onerror], [onload]")).toBeNull();

    const targetButton = section.querySelector("[data-continuation-action]");
    expect(JSON.parse(targetButton.getAttribute("data-continuation-action"))).toEqual({
      kind: "conversation",
      conversationId: recommendedTargetId,
    });
    targetButton.click();
    expect(onOpenContinuationAction).toHaveBeenCalledWith({
      kind: "conversation",
      conversationId: recommendedTargetId,
    });

    feature.setContinuationState(null, { conversationId: "conversation:current" });
    expect(content.children).toHaveLength(1);
    expect(content.firstElementChild.className).toBe("session-digest-modal-copy");
    expect(content.firstElementChild.textContent).toBe(maliciousSummary);
    feature.dispose();
  });
});
