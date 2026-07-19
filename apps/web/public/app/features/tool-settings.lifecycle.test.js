// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createToolSettingsController } from "./tool-settings.js";

function createHarness(sendReq) {
  document.body.innerHTML = `
    <button id="open"></button>
    <button id="close"></button>
    <button id="save"></button>
    <button id="tab" data-tab="builtin"></button>
    <section id="modal" class="hidden"></section>
    <section id="body"></section>
    <section id="confirm" class="hidden"></section>
    <div id="impact"></div>
    <ul id="summary"></ul>
    <div id="expiry"></div>
    <button id="approve"></button>
    <button id="reject"></button>
  `;
  const refs = {
    toolSettingsConfirmModal: document.getElementById("confirm"),
    toolSettingsConfirmImpactEl: document.getElementById("impact"),
    toolSettingsConfirmSummaryEl: document.getElementById("summary"),
    toolSettingsConfirmExpiryEl: document.getElementById("expiry"),
    toolSettingsConfirmApproveBtn: document.getElementById("approve"),
    toolSettingsConfirmRejectBtn: document.getElementById("reject"),
    toolSettingsModal: document.getElementById("modal"),
    openToolSettingsBtn: document.getElementById("open"),
    closeToolSettingsBtn: document.getElementById("close"),
    saveToolSettingsBtn: document.getElementById("save"),
    toolSettingsBody: document.getElementById("body"),
    toolTabButtons: [document.getElementById("tab")],
  };
  const controller = createToolSettingsController({
    refs,
    isConnected: () => true,
    sendReq,
    makeId: () => "req-1",
    clientId: "client-web-1",
    getSelectedAgentId: () => "default",
    getActiveConversationId: () => "conversation-1",
    getSelectedSubtaskId: () => "",
    isSubtasksViewActive: () => false,
    escapeHtml: (value) => String(value),
    showNotice: vi.fn(),
    t: (_key, _params, fallback) => fallback ?? "",
  });
  return { refs, controller };
}

function createToolListPayload() {
  return {
    builtin: [],
    mcp: {},
    plugins: [],
    methods: [],
    skills: [],
    disabled: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("tool settings panel lifecycle", () => {
  it("clears save feedback and panel listeners on dispose", async () => {
    vi.useFakeTimers();
    const sendReq = vi.fn(async (request) => {
      if (request.method === "tools.list") return { ok: true, payload: createToolListPayload() };
      if (request.method === "tools.update") return { ok: true };
      throw new Error(`unexpected request ${request.method}`);
    });
    const { refs, controller } = createHarness(sendReq);

    await controller.toggle(true);
    refs.saveToolSettingsBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getRuntimeSnapshot()).toMatchObject({
      loadedDataCount: 1,
      saveFeedbackTimerActive: true,
      panelListenerCount: 4,
      disposed: false,
    });

    controller.dispose();
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      loadedDataCount: 0,
      saveFeedbackTimerActive: false,
      panelListenerCount: 0,
      disposed: true,
    });
    const requestCount = sendReq.mock.calls.length;
    refs.openToolSettingsBtn.click();
    refs.saveToolSettingsBtn.click();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendReq).toHaveBeenCalledTimes(requestCount);
  });

  it("ignores late list and save responses after dispose", async () => {
    let resolveList;
    const listSendReq = vi.fn(() => new Promise((resolve) => {
      resolveList = resolve;
    }));
    const listHarness = createHarness(listSendReq);
    const loadPromise = listHarness.controller.toggle(true);
    listHarness.controller.dispose();
    resolveList({ ok: true, payload: createToolListPayload() });
    await loadPromise;
    expect(listHarness.controller.getRuntimeSnapshot()).toMatchObject({
      loadedDataCount: 0,
      disposed: true,
    });

    let resolveSave;
    const saveSendReq = vi.fn((request) => {
      if (request.method === "tools.list") return Promise.resolve({ ok: true, payload: createToolListPayload() });
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    });
    const saveHarness = createHarness(saveSendReq);
    await saveHarness.controller.toggle(true);
    saveHarness.refs.saveToolSettingsBtn.click();
    saveHarness.controller.dispose();
    resolveSave({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(saveHarness.controller.getRuntimeSnapshot()).toMatchObject({
      saveFeedbackTimerActive: false,
      disposed: true,
    });
  });
});
