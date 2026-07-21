// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionDigestFeature } from "./session-digest.js";

function createFixture({ blockHtmlParser = false, withHistoryAction = true } = {}) {
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
  const actions = document.getElementById("sessionDigestModalActions");
  if (blockHtmlParser) {
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(actions, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Session Digest history actions must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });
  }
  const maliciousLabel = '<img src=x onerror="alert(1)">列出主会话';
  const onSendHistoryAction = withHistoryAction ? vi.fn() : undefined;
  const feature = createSessionDigestFeature({
    refs: {
      sessionDigestSummaryEl: document.getElementById("sessionDigestSummary"),
      sessionContinuationSummaryEl: document.getElementById("sessionContinuationSummary"),
      sessionDigestRefreshBtn: document.getElementById("sessionDigestRefresh"),
      sessionDigestModalEl: document.getElementById("sessionDigestModal"),
      sessionDigestModalTitleEl: document.getElementById("sessionDigestModalTitle"),
      sessionDigestModalMetaEl: document.getElementById("sessionDigestModalMeta"),
      sessionDigestModalActionsEl: actions,
      sessionDigestModalContentEl: document.getElementById("sessionDigestModalContent"),
      sessionDigestModalCloseBtn: document.getElementById("sessionDigestModalClose"),
    },
    isConnected: () => true,
    sendReq: vi.fn(),
    makeId: () => "req-1",
    getActiveConversationId: () => "conversation:current",
    onSendHistoryAction,
    onOpenContinuationAction: vi.fn(),
    escapeHtml: (value) => String(value ?? ""),
    formatDateTime: () => "2026-07-20 00:00:00",
    showNotice: vi.fn(),
    t: (key, _params, fallback) => key === "panel.sessionHistoryListMain" ? maliciousLabel : fallback ?? "",
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
      rollingSummary: "Digest body",
    },
  });

  return {
    actions,
    feature,
    maliciousLabel,
    modal: document.getElementById("sessionDigestModal"),
    onSendHistoryAction,
    summary: document.getElementById("sessionDigestSummary"),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Session Digest history action DOM rendering", () => {
  it("renders delegated history actions without using the HTML parser", () => {
    const fixture = createFixture({ blockHtmlParser: true });

    fixture.summary.querySelector(".session-digest-card").click();

    const buttons = fixture.actions.querySelectorAll(".session-digest-action-btn");
    expect(buttons).toHaveLength(4);
    expect(Array.from(buttons, (button) => button.getAttribute("data-history-action"))).toEqual([
      "list_main",
      "list_all_allowed",
      "read_timeline",
      "read_restore",
    ]);
    expect(Array.from(buttons, (button) => button.type)).toEqual(["button", "button", "button", "button"]);
    expect(buttons[0].textContent).toBe(fixture.maliciousLabel);
    expect(fixture.actions.querySelector("img, [onerror]")).toBeNull();
    expect(fixture.actions.classList.contains("hidden")).toBe(false);

    buttons[3].click();
    expect(fixture.onSendHistoryAction).toHaveBeenCalledWith({
      actionId: "read_restore",
      conversationId: "conversation:current",
    });
    expect(fixture.modal.classList.contains("hidden")).toBe(true);
    fixture.feature.dispose();
  });

  it("keeps the action region empty and hidden without a history callback", () => {
    const fixture = createFixture({ withHistoryAction: false });

    fixture.summary.querySelector(".session-digest-card").click();

    expect(fixture.actions.children).toHaveLength(0);
    expect(fixture.actions.classList.contains("hidden")).toBe(true);
    fixture.feature.dispose();
  });
});
