import { afterEach, describe, expect, it, vi } from "vitest";

import { createExternalOutboundController } from "./external-outbound.js";

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
    externalOutboundConfirmModal: createEl(),
    externalOutboundConfirmPreviewEl: createEl(),
    externalOutboundConfirmTargetEl: createEl(),
    externalOutboundConfirmExpiryEl: createEl(),
    externalOutboundConfirmApproveBtn: createEl(),
    externalOutboundConfirmRejectBtn: createEl(),
  };
}

function createController(overrides = {}) {
  const refs = createRefs();
  const showNotice = overrides.showNotice || vi.fn();
  const controller = createExternalOutboundController({
    refs,
    isConnected: () => true,
    sendReq: overrides.sendReq || vi.fn(),
    makeId: () => "req-1",
    clientId: "client-web-1",
    escapeHtml: (value) => String(value),
    showNotice,
    t: (_key, _params, fallback) => fallback ?? "",
  });
  return { refs, showNotice, controller };
}

function createRequiredPayload(requestId = "external-confirm-1") {
  return {
    requestId,
    conversationId: "conversation-1",
    channel: "discord",
    contentPreview: "send this message",
    targetChatId: "chat-1",
    expiresAt: Date.now() + 30_000,
    targetClientId: "client-web-1",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("external outbound controller", () => {
  it("owns the pending countdown and button listeners until dispose", async () => {
    vi.useFakeTimers();
    const { refs, controller } = createController();

    controller.handleConfirmRequired(createRequiredPayload());
    expect(refs.externalOutboundConfirmTargetEl.innerHTML).toContain("discord");
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
      requestId: "external-confirm-1",
      decision: "rejected",
      targetClientId: "client-web-1",
    });
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
    });

    controller.handleConfirmRequired(createRequiredPayload("external-confirm-dispose"));
    controller.dispose();
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
      disposed: true,
    });
    expect(refs.externalOutboundConfirmApproveBtn.listenerCount()).toBe(0);
    expect(refs.externalOutboundConfirmRejectBtn.listenerCount()).toBe(0);

    controller.handleConfirmRequired(createRequiredPayload("external-confirm-after-dispose"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
      timerTickCount: 1,
    });
  });

  it("ignores a late approval response after dispose", async () => {
    let resolveApproval;
    const { refs, showNotice, controller } = createController({
      sendReq: vi.fn(() => new Promise((resolve) => {
        resolveApproval = resolve;
      })),
    });

    controller.handleConfirmRequired(createRequiredPayload());
    refs.externalOutboundConfirmApproveBtn.click();
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
});
