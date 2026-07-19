import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmailOutboundController } from "./email-outbound.js";

function createRefs() {
  const createEl = () => {
    const listeners = new Map();
    return {
      innerHTML: "",
      textContent: "",
      disabled: false,
      classList: {
        add() {},
        remove() {},
      },
      addEventListener(event, listener) {
        listeners.set(event, listener);
      },
      removeEventListener(event, listener) {
        if (listeners.get(event) === listener) listeners.delete(event);
      },
      click: () => listeners.get("click")?.(),
      listenerCount: () => listeners.size,
    };
  };
  return {
    emailOutboundConfirmModal: createEl(),
    emailOutboundConfirmPreviewEl: createEl(),
    emailOutboundConfirmTargetEl: createEl(),
    emailOutboundConfirmExpiryEl: createEl(),
    emailOutboundConfirmApproveBtn: createEl(),
    emailOutboundConfirmRejectBtn: createEl(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("email outbound controller", () => {
  it("owns the pending countdown and button listeners until dispose", async () => {
    vi.useFakeTimers();
    const refs = createRefs();
    const controller = createEmailOutboundController({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      clientId: "client-web-1",
      escapeHtml: (value) => String(value),
      showNotice: vi.fn(),
      t: (_key, _params, fallback) => fallback ?? "",
    });

    controller.handleConfirmRequired({
      requestId: "email-confirm-retention",
      conversationId: "conversation-1",
      providerId: "smtp",
      to: ["alice@example.com"],
      expiresAt: Date.now() + 30_000,
      targetClientId: "client-web-1",
    });
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 1,
      timerActive: true,
      timerStartCount: 1,
      timerTickCount: 0,
      disposed: false,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getRuntimeSnapshot()).toMatchObject({ timerTickCount: 1 });
    controller.handleConfirmResolved({
      requestId: "email-confirm-retention",
      decision: "rejected",
      targetClientId: "client-web-1",
    });
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
    });

    controller.handleConfirmRequired({
      requestId: "email-confirm-dispose",
      conversationId: "conversation-2",
      providerId: "smtp",
      expiresAt: Date.now() + 30_000,
      targetClientId: "client-web-1",
    });
    controller.dispose();
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
      disposed: true,
    });
    expect(refs.emailOutboundConfirmApproveBtn.listenerCount()).toBe(0);
    expect(refs.emailOutboundConfirmRejectBtn.listenerCount()).toBe(0);

    controller.handleConfirmRequired({
      requestId: "email-confirm-after-dispose",
      conversationId: "conversation-3",
      providerId: "smtp",
      targetClientId: "client-web-1",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
      timerTickCount: 1,
    });
  });

  it("ignores a late approval response after dispose", async () => {
    let resolveApproval;
    const refs = createRefs();
    const showNotice = vi.fn();
    const controller = createEmailOutboundController({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(() => new Promise((resolve) => {
        resolveApproval = resolve;
      })),
      makeId: () => "req-1",
      clientId: "client-web-1",
      escapeHtml: (value) => String(value),
      showNotice,
      t: (_key, _params, fallback) => fallback ?? "",
    });

    controller.handleConfirmRequired({
      requestId: "email-confirm-late",
      conversationId: "conversation-1",
      providerId: "smtp",
      expiresAt: Date.now() + 30_000,
      targetClientId: "client-web-1",
    });
    refs.emailOutboundConfirmApproveBtn.click();
    controller.dispose();
    resolveApproval({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(showNotice).not.toHaveBeenCalled();
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
      disposed: true,
    });
  });

  it("shows thread guidance when the current conversation is an email thread but thread metadata is missing", () => {
    const refs = createRefs();
    const controller = createEmailOutboundController({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      clientId: "client-web-1",
      escapeHtml: (value) => String(value),
      showNotice: vi.fn(),
      t: (_key, _params, fallback) => fallback ?? "",
    });

    controller.handleConfirmRequired({
      requestId: "email-confirm-1",
      conversationId: "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-001%40example.com%3E",
      providerId: "smtp",
      accountId: "default",
      to: ["alice@example.com"],
      subject: "Reply draft",
      bodyPreview: "hello",
      expiresAt: Date.now() + 30_000,
      targetClientId: "client-web-1",
    });

    expect(refs.emailOutboundConfirmTargetEl.innerHTML).toContain("当前邮件线程");
    expect(refs.emailOutboundConfirmTargetEl.innerHTML).toContain("send_email.threadId=<thread-001@example.com>");
  });

  it("shows explicit reply guidance when thread metadata matches the current email thread", () => {
    const refs = createRefs();
    const controller = createEmailOutboundController({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      clientId: "client-web-1",
      escapeHtml: (value) => String(value),
      showNotice: vi.fn(),
      t: (_key, _params, fallback) => fallback ?? "",
    });

    controller.handleConfirmRequired({
      requestId: "email-confirm-2",
      conversationId: "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-001%40example.com%3E",
      providerId: "smtp",
      accountId: "default",
      to: ["alice@example.com"],
      subject: "Reply draft",
      bodyPreview: "hello",
      threadId: "<thread-001@example.com>",
      replyToMessageId: "<msg-010@example.com>",
      expiresAt: Date.now() + 30_000,
      targetClientId: "client-web-1",
    });

    expect(refs.emailOutboundConfirmTargetEl.innerHTML).toContain("这次草稿会继续当前邮件线程，并显式回复 <msg-010@example.com>");
  });
});
