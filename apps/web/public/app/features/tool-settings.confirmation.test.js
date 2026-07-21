// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createToolSettingsController } from "./tool-settings.js";

function createElement() {
  const listeners = new Map();
  return {
    innerHTML: "",
    textContent: "",
    children: [],
    disabled: false,
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
    },
    addEventListener(event, listener) {
      listeners.set(event, listener);
    },
    removeEventListener(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children.map((child) => child.textContent || "").join("");
    },
    click: () => listeners.get("click")?.(),
    listenerCount: () => listeners.size,
  };
}

function createController(overrides = {}) {
  const refs = {
    toolSettingsConfirmModal: createElement(),
    toolSettingsConfirmImpactEl: createElement(),
    toolSettingsConfirmSummaryEl: createElement(),
    toolSettingsConfirmExpiryEl: createElement(),
    toolSettingsConfirmApproveBtn: createElement(),
    toolSettingsConfirmRejectBtn: createElement(),
    toolTabButtons: [],
  };
  const showNotice = overrides.showNotice || vi.fn();
  const controller = createToolSettingsController({
    refs,
    isConnected: () => true,
    sendReq: overrides.sendReq || vi.fn(),
    makeId: () => "req-1",
    clientId: "client-web-1",
    getSelectedAgentId: () => "default",
    getActiveConversationId: () => "conversation-1",
    getSelectedSubtaskId: () => "",
    isSubtasksViewActive: () => false,
    escapeHtml: (value) => String(value),
    showNotice,
    t: (_key, _params, fallback) => fallback ?? "",
  });
  return { refs, showNotice, controller };
}

function createRequiredPayload(requestId = "tool-confirm-1") {
  return {
    requestId,
    conversationId: "conversation-1",
    impact: "global change",
    summary: ["disable shell_exec"],
    expiresAt: Date.now() + 30_000,
    targetClientId: "client-web-1",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("tool settings confirmation lifecycle", () => {
  it("renders confirmation summary entries as list item text without an HTML escaper", () => {
    const maliciousSummary = '<img src=x onerror="alert(1)">disable shell_exec';
    document.body.innerHTML = `
      <div id="modal" class="hidden"></div>
      <div id="impact"></div>
      <ul id="summary"></ul>
      <div id="expiry"></div>
      <button id="approve"></button>
      <button id="reject"></button>
    `;
    const controller = createToolSettingsController({
      refs: {
        toolSettingsConfirmModal: document.getElementById("modal"),
        toolSettingsConfirmImpactEl: document.getElementById("impact"),
        toolSettingsConfirmSummaryEl: document.getElementById("summary"),
        toolSettingsConfirmExpiryEl: document.getElementById("expiry"),
        toolSettingsConfirmApproveBtn: document.getElementById("approve"),
        toolSettingsConfirmRejectBtn: document.getElementById("reject"),
        toolTabButtons: [],
      },
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-dom",
      clientId: "client-web-1",
      getSelectedAgentId: () => "default",
      getActiveConversationId: () => "conversation-1",
      getSelectedSubtaskId: () => "",
      isSubtasksViewActive: () => false,
      escapeHtml: () => {
        throw new Error("confirmation summary must not require an HTML escaper");
      },
      showNotice: vi.fn(),
      t: (_key, _params, fallback) => fallback ?? "",
    });

    expect(() => controller.handleConfirmRequired({
      ...createRequiredPayload("tool-confirm-dom"),
      summary: [maliciousSummary, "enable browser"],
    })).not.toThrow();

    const summary = document.getElementById("summary");
    expect(summary.querySelectorAll(":scope > li")).toHaveLength(2);
    expect([...summary.children].map((item) => item.textContent)).toEqual([
      maliciousSummary,
      "enable browser",
    ]);
    expect(summary.querySelector("img, [onerror]")).toBeNull();

    controller.handleConfirmRequired({
      ...createRequiredPayload("tool-confirm-empty-summary"),
      summary: [],
    });
    expect(summary.querySelectorAll(":scope > li")).toHaveLength(1);
    expect(summary.firstElementChild.textContent).toBe(
      "No displayable change summary was provided for this request.",
    );
    controller.disposeConfirmation();
  });

  it("owns the pending countdown and confirmation listeners until dispose", async () => {
    vi.useFakeTimers();
    const { refs, controller } = createController();

    controller.handleConfirmRequired(createRequiredPayload());
    expect(controller.getConfirmationRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 1,
      timerActive: true,
      timerStartCount: 1,
      timerTickCount: 0,
      disposed: false,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getConfirmationRuntimeSnapshot()).toMatchObject({ timerTickCount: 1 });

    controller.handleConfirmResolved({
      requestId: "tool-confirm-1",
      decision: "rejected",
      targetClientId: "client-web-1",
    });
    expect(controller.getConfirmationRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
    });

    controller.handleConfirmRequired(createRequiredPayload("tool-confirm-dispose"));
    controller.disposeConfirmation();
    expect(controller.getConfirmationRuntimeSnapshot()).toMatchObject({
      pendingConfirmationCount: 0,
      timerActive: false,
      disposed: true,
    });
    expect(refs.toolSettingsConfirmApproveBtn.listenerCount()).toBe(0);
    expect(refs.toolSettingsConfirmRejectBtn.listenerCount()).toBe(0);

    controller.handleConfirmRequired(createRequiredPayload("tool-confirm-after-dispose"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.getConfirmationRuntimeSnapshot()).toMatchObject({ timerTickCount: 1 });
  });

  it("ignores confirm and Agent follow-up settlements after dispose", async () => {
    let resolveConfirm;
    let resolveFollowUp;
    const sendReq = vi.fn((request) => {
      if (request.method === "tool_settings.confirm") {
        return new Promise((resolve) => {
          resolveConfirm = resolve;
        });
      }
      if (request.method === "message.send") {
        return new Promise((resolve) => {
          resolveFollowUp = resolve;
        });
      }
      throw new Error(`unexpected request ${request.method}`);
    });
    const { refs, showNotice, controller } = createController({ sendReq });

    controller.handleConfirmRequired(createRequiredPayload());
    refs.toolSettingsConfirmApproveBtn.click();
    controller.disposeConfirmation();
    resolveConfirm({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(showNotice).not.toHaveBeenCalled();

    const current = createController({ sendReq, showNotice });
    current.controller.handleConfirmRequired(createRequiredPayload("tool-confirm-follow-up"));
    current.refs.toolSettingsConfirmApproveBtn.click();
    resolveConfirm({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(sendReq).toHaveBeenCalledTimes(3);
    current.controller.disposeConfirmation();
    resolveFollowUp({ ok: false, error: { message: "late failure" } });
    await Promise.resolve();
    await Promise.resolve();

    expect(showNotice).toHaveBeenCalledTimes(1);
  });
});
