// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentRuntimeFeature } from "./agent-runtime.js";
import { PENDING_AGENT_SELECTION_KEY } from "./chat-network.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function createFixture(options = {}) {
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = `
    <select id="agentSelect"><option value="coder">Coder</option></select>
    <aside id="agentRightPanel"></aside>
    <div id="goalsDetail"></div>
    <div id="messages"></div>
    <div id="agentCreateModal" class="hidden">
      <button id="agentCreateModalClose"></button>
      <button id="agentCreateCancel"></button>
      <button id="agentCreateSubmit"></button>
      <input id="agentCreateId" />
      <input id="agentCreateDisplayName" />
      <select id="agentCreateModel"></select>
      <textarea id="agentCreateSystemPrompt"></textarea>
    </div>
    <div id="agentObservabilityModal" class="hidden">
      <button id="agentObservabilityModalClose"></button>
      <h2 id="agentObservabilityModalTitle"></h2>
      <div id="agentObservabilityModalBody"></div>
    </div>
  `;
  const refs = {
    agentSelectEl: document.getElementById("agentSelect"),
    agentRightPanelEl: document.getElementById("agentRightPanel"),
    goalsDetailEl: document.getElementById("goalsDetail"),
    messagesEl: document.getElementById("messages"),
    agentCreateModalEl: document.getElementById("agentCreateModal"),
    agentCreateModalCloseBtn: document.getElementById("agentCreateModalClose"),
    agentCreateCancelBtn: document.getElementById("agentCreateCancel"),
    agentCreateSubmitBtn: document.getElementById("agentCreateSubmit"),
    agentCreateIdEl: document.getElementById("agentCreateId"),
    agentCreateDisplayNameEl: document.getElementById("agentCreateDisplayName"),
    agentCreateModelEl: document.getElementById("agentCreateModel"),
    agentCreateSystemPromptEl: document.getElementById("agentCreateSystemPrompt"),
  };
  const modelCatalogRequest = createDeferred();
  const requestModelCatalog = vi.fn(() => modelCatalogRequest.promise);
  const agentCatalog = new Map();
  const noopAsync = vi.fn(async () => {});
  const sendReq = options.sendReq || vi.fn(async () => null);
  const showNotice = vi.fn();
  const openAgentConfigEditor = vi.fn();
  const setActiveConversationId = vi.fn();
  const renderCanvasGoalContext = vi.fn();
  const renderConversationMessages = vi.fn();
  const refreshMemoryViewerForAgentSwitch = options.refreshMemoryViewerForAgentSwitch || noopAsync;
  const switchMode = vi.fn();
  const openTaskFromAudit = vi.fn(async () => {});
  const loadSubtasks = vi.fn(async () => {});
  const openConversationSession = vi.fn();
  const onAgentIdentityChanged = vi.fn();
  const onAgentCatalogChanged = vi.fn();
  const agentSessionCacheFeature = {
    bindAgentConversation: vi.fn(),
    getAgentConversation: vi.fn(() => ""),
    getConversationMessages: vi.fn(() => options.conversationMessages || []),
    appendUserMessage: vi.fn(),
    appendAssistantDelta: vi.fn(),
    finalizeAssistantMessage: vi.fn(),
    setConversationMessages: vi.fn(),
  };
  const setAgentPanelHasContent = vi.fn();
  const feature = createAgentRuntimeFeature({
    refs,
    agentCatalog,
    residentAgentRosterEnabled: options.residentAgentRosterEnabled === true,
    agentSessionCacheFeature,
    sendReq,
    makeId: () => "req-1",
    requestModelCatalog,
    getHttpAuthHeaders: () => ({}),
    getActiveConversationId: () => "",
    setActiveConversationId,
    renderCanvasGoalContext,
    switchMode,
    getChatEventsFeature: () => ({ resetStreamingState: vi.fn() }),
    getSessionDigestFeature: () => ({ clear: vi.fn(), loadSessionDigest: noopAsync }),
    renderConversationMessages,
    loadConversationMeta: noopAsync,
    refreshMemoryViewerForAgentSwitch,
    getSubtasksState: () => ({}),
    openSubtaskBySession: noopAsync,
    openSubtaskById: noopAsync,
    loadSubtasks,
    getGoalsState: () => ({}),
    loadGoals: noopAsync,
    resumeGoal: noopAsync,
    getMemoryViewerState: () => ({}),
    switchMemoryViewerTab: vi.fn(),
    loadMemoryViewer: noopAsync,
    openTaskFromAudit,
    openConversationSession,
    openAgentConfigEditor,
    appendMessage: vi.fn(),
    getChatUiFeature: () => ({ refreshAvatar: vi.fn() }),
    onAgentIdentityChanged,
    onAgentCatalogChanged,
    showNotice,
    localeController: { t: (_key, _params, fallback) => fallback || "" },
    setAgentPanelHasContent,
    t: (_key, _params, fallback) => fallback || "",
  });

  feature.syncAgentCatalog([{
    id: "coder",
    displayName: "Coder",
    name: "Coder",
    model: "primary",
    status: "idle",
  }], "coder");

  return {
    feature,
    agentCatalog,
    modelCatalogRequest,
    refs,
    requestModelCatalog,
    sendReq,
    setAgentPanelHasContent,
    showNotice,
    openAgentConfigEditor,
    agentSessionCacheFeature,
    setActiveConversationId,
    renderCanvasGoalContext,
    renderConversationMessages,
    switchMode,
    openTaskFromAudit,
    loadSubtasks,
    openConversationSession,
    onAgentIdentityChanged,
    onAgentCatalogChanged,
  };
}

function startAvatarUpload(fixture) {
  fixture.refs.agentRightPanelEl.querySelector(".agent-card-avatar").click();
  const input = document.body.querySelector('input[type="file"]');
  const file = new File(["avatar"], "avatar.png", { type: "image/png" });
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event("change"));
  return input;
}

describe("agent runtime lifecycle", () => {
  it("settles a stale create-model request without restoring disposed modal state", async () => {
    const fixture = createFixture();
    const createButton = fixture.refs.agentRightPanelEl.querySelector(".agent-panel-create-btn");

    createButton.click();
    fixture.refs.agentCreateIdEl.value = "private-body";
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      createModalDisposed: false,
      pendingModelCatalogRequestCount: 1,
    });

    fixture.feature.dispose();
    expect(fixture.refs.agentCreateModalEl.classList.contains("hidden")).toBe(true);
    expect(fixture.refs.agentCreateIdEl.value).toBe("");
    expect(fixture.refs.agentCreateModelEl.textContent).toBe("");
    expect(fixture.setAgentPanelHasContent).toHaveBeenLastCalledWith(false);
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      createModalDisposed: true,
      ownedListenerCount: 0,
      pendingModelCatalogRequestCount: 1,
    });

    fixture.modelCatalogRequest.resolve({
      models: [{ id: "late-model", displayName: "Late model" }],
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.refs.agentCreateModelEl.textContent).toBe("");
    expect(fixture.feature.getRuntimeSnapshot().pendingModelCatalogRequestCount).toBe(0);

    createButton.click();
    expect(fixture.requestModelCatalog).toHaveBeenCalledTimes(1);
    expect(fixture.refs.agentCreateModalEl.classList.contains("hidden")).toBe(true);
  });

  it("settles a stale agent.create request without committing form side effects", async () => {
    const createRequest = createDeferred();
    const sendReq = vi.fn(() => createRequest.promise);
    const fixture = createFixture({ sendReq });
    fixture.refs.agentCreateIdEl.value = "private-agent";
    fixture.refs.agentCreateDisplayNameEl.value = "Private name";
    fixture.refs.agentCreateModelEl.innerHTML = "<option value=\"primary\">Primary</option>";
    fixture.refs.agentCreateModelEl.value = "primary";
    fixture.refs.agentCreateSystemPromptEl.value = "private system prompt";

    fixture.refs.agentCreateSubmitBtn.click();
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      agentCreateBusy: true,
      pendingAgentCreateRequestCount: 1,
    });

    fixture.feature.dispose();
    expect(fixture.refs.agentCreateIdEl.value).toBe("");
    expect(fixture.refs.agentCreateDisplayNameEl.value).toBe("");
    expect(fixture.refs.agentCreateSystemPromptEl.value).toBe("");
    expect(fixture.refs.agentCreateSubmitBtn.disabled).toBe(false);
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      agentCreateBusy: false,
      pendingAgentCreateRequestCount: 1,
    });

    createRequest.resolve({ ok: true, payload: { agentId: "private-agent" } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem(PENDING_AGENT_SELECTION_KEY)).toBeNull();
    expect(fixture.showNotice).not.toHaveBeenCalled();
    expect(fixture.openAgentConfigEditor).not.toHaveBeenCalled();
    expect(fixture.feature.getRuntimeSnapshot().pendingAgentCreateRequestCount).toBe(0);
  });

  it("releases the avatar input and skips JSON parsing after dispose during fetch", async () => {
    const fetchRequest = createDeferred();
    const json = vi.fn(async () => ({ ok: true, avatarPath: "/avatar/late.png" }));
    vi.stubGlobal("fetch", vi.fn(() => fetchRequest.promise));
    const fixture = createFixture();
    const input = startAvatarUpload(fixture);

    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      avatarUploadBusy: true,
      hasAvatarUploadInput: true,
      pendingAvatarUploadRequestCount: 1,
    });

    fixture.feature.dispose();
    expect(input.isConnected).toBe(false);
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      avatarUploadBusy: false,
      hasAvatarUploadInput: false,
      pendingAvatarUploadRequestCount: 1,
    });

    fetchRequest.resolve({ ok: true, json });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(json).not.toHaveBeenCalled();
    expect(fixture.agentCatalog.get("coder")?.avatar).toBe("");
    expect(fixture.showNotice).not.toHaveBeenCalled();
    expect(fixture.feature.getRuntimeSnapshot().pendingAvatarUploadRequestCount).toBe(0);
  });

  it("commits an avatar payload for the active owner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, avatarPath: "/avatar/current.png" }),
    })));
    const fixture = createFixture();
    startAvatarUpload(fixture);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.agentCatalog.get("coder")?.avatar).toContain("/avatar/current.png?v=");
    expect(fixture.showNotice).toHaveBeenCalledWith("", "", "success", 2200);
    expect(fixture.feature.getRuntimeSnapshot()).toMatchObject({
      avatarUploadBusy: false,
      pendingAvatarUploadRequestCount: 0,
    });
  });

  it("ignores a stale avatar payload after dispose during JSON parsing", async () => {
    const jsonRequest = createDeferred();
    const json = vi.fn(() => jsonRequest.promise);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json })));
    const fixture = createFixture();
    startAvatarUpload(fixture);
    await Promise.resolve();
    await Promise.resolve();
    expect(json).toHaveBeenCalledTimes(1);

    fixture.feature.dispose();
    jsonRequest.resolve({ ok: true, avatarPath: "/avatar/late.png" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.agentCatalog.get("coder")?.avatar).toBe("");
    expect(fixture.showNotice).not.toHaveBeenCalled();
    expect(fixture.feature.getRuntimeSnapshot().pendingAvatarUploadRequestCount).toBe(0);
  });

  it("binds and activates a resident session for the active owner", async () => {
    const sendReq = vi.fn(async () => ({
      ok: true,
      payload: {
        conversationId: "conversation-current",
        mainConversationId: "conversation-main",
        lastConversationId: "conversation-current",
        status: "idle",
      },
    }));
    const fixture = createFixture({ residentAgentRosterEnabled: true, sendReq });

    await fixture.feature.activateResidentAgentConversation("coder", { forceEnsure: true });

    expect(fixture.agentSessionCacheFeature.bindAgentConversation).toHaveBeenCalledTimes(3);
    expect(fixture.agentCatalog.get("coder")).toMatchObject({
      mainConversationId: "conversation-main",
      lastConversationId: "conversation-current",
    });
    expect(fixture.setActiveConversationId).toHaveBeenCalledWith("conversation-current");
    expect(fixture.renderCanvasGoalContext).toHaveBeenCalledTimes(1);
    expect(fixture.feature.getRuntimeSnapshot().pendingResidentEnsureRequestCount).toBe(0);
  });

  it("settles a stale resident ensure without writing cache, catalog, or UI", async () => {
    const ensureRequest = createDeferred();
    const sendReq = vi.fn(() => ensureRequest.promise);
    const fixture = createFixture({ residentAgentRosterEnabled: true, sendReq });
    const activation = fixture.feature.activateResidentAgentConversation("coder", { forceEnsure: true });
    expect(fixture.feature.getRuntimeSnapshot().pendingResidentEnsureRequestCount).toBe(1);

    fixture.feature.dispose();
    ensureRequest.resolve({
      ok: true,
      payload: {
        conversationId: "conversation-late",
        mainConversationId: "conversation-late",
        lastConversationId: "conversation-late",
        status: "idle",
      },
    });
    await activation;

    expect(fixture.agentSessionCacheFeature.bindAgentConversation).not.toHaveBeenCalled();
    expect(fixture.agentCatalog.get("coder")?.mainConversationId).toBe("");
    expect(fixture.agentCatalog.get("coder")?.lastConversationId).toBe("");
    expect(fixture.setActiveConversationId).not.toHaveBeenCalled();
    expect(fixture.renderCanvasGoalContext).not.toHaveBeenCalled();
    expect(fixture.renderConversationMessages).not.toHaveBeenCalled();
    expect(fixture.feature.getRuntimeSnapshot().pendingResidentEnsureRequestCount).toBe(0);

    await fixture.feature.activateResidentAgentConversation("coder", { forceEnsure: true });
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("replaces and releases the observability modal listener and body state", () => {
    const fixture = createFixture();
    const modal = document.getElementById("agentObservabilityModal");
    const closeButton = document.getElementById("agentObservabilityModalClose");
    const title = document.getElementById("agentObservabilityModalTitle");
    const body = document.getElementById("agentObservabilityModalBody");
    const detailButton = fixture.refs.agentRightPanelEl.querySelectorAll(".agent-card-detail-btn")[1];

    detailButton.click();
    expect(modal.classList.contains("hidden")).toBe(false);
    expect(body.textContent.length).toBeGreaterThan(0);
    expect(fixture.feature.getRuntimeSnapshot().observabilityModalListenerCount).toBe(1);

    closeButton.click();
    expect(modal.classList.contains("hidden")).toBe(true);
    expect(fixture.feature.getRuntimeSnapshot().observabilityModalListenerCount).toBe(0);

    detailButton.click();
    expect(fixture.feature.getRuntimeSnapshot().observabilityModalListenerCount).toBe(1);
    fixture.feature.dispose();

    expect(modal.classList.contains("hidden")).toBe(true);
    expect(closeButton.onclick).toBeNull();
    expect(title.textContent).toBe("");
    expect(body.textContent).toBe("");
    expect(fixture.feature.getRuntimeSnapshot().observabilityModalListenerCount).toBe(0);
  });

  it("allows only the latest observability navigation to commit", async () => {
    const firstRefresh = createDeferred();
    const secondRefresh = createDeferred();
    const refreshMemoryViewerForAgentSwitch = vi.fn()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);
    const fixture = createFixture({ refreshMemoryViewerForAgentSwitch });

    const firstAction = fixture.feature.openAgentObservabilityAction("coder", {
      kind: "task",
      taskId: "task-stale",
    });
    const secondAction = fixture.feature.openAgentObservabilityAction("coder", {
      kind: "subtasks",
    });
    expect(fixture.feature.getRuntimeSnapshot().pendingObservabilityNavigationCount).toBe(2);

    firstRefresh.resolve();
    await firstAction;
    expect(fixture.switchMode).not.toHaveBeenCalled();
    expect(fixture.openTaskFromAudit).not.toHaveBeenCalled();

    secondRefresh.resolve();
    await secondAction;
    expect(fixture.switchMode).toHaveBeenCalledWith("subtasks");
    expect(fixture.loadSubtasks).toHaveBeenCalledWith(true);
    expect(fixture.feature.getRuntimeSnapshot().pendingObservabilityNavigationCount).toBe(0);
  });

  it("settles stale observability navigation without committing after dispose", async () => {
    const refreshRequest = createDeferred();
    const fixture = createFixture({
      refreshMemoryViewerForAgentSwitch: vi.fn(() => refreshRequest.promise),
    });
    const action = fixture.feature.openAgentObservabilityAction("coder", {
      kind: "task",
      taskId: "task-late",
    });
    expect(fixture.feature.getRuntimeSnapshot().pendingObservabilityNavigationCount).toBe(1);

    fixture.feature.dispose();
    refreshRequest.resolve();
    await action;

    expect(fixture.switchMode).not.toHaveBeenCalled();
    expect(fixture.openTaskFromAudit).not.toHaveBeenCalled();
    expect(fixture.feature.getRuntimeSnapshot().pendingObservabilityNavigationCount).toBe(0);
  });

  it("settles a stale system restart failure without restoring an error notice", async () => {
    const restartRequest = createDeferred();
    const sendReq = vi.fn()
      .mockResolvedValueOnce({ ok: true, payload: { agentId: "restart-agent" } })
      .mockImplementationOnce(() => restartRequest.promise);
    const fixture = createFixture({ sendReq });
    fixture.refs.agentCreateIdEl.value = "restart-agent";
    fixture.refs.agentCreateDisplayNameEl.value = "Restart agent";
    fixture.refs.agentCreateModelEl.innerHTML = "<option value=\"primary\">Primary</option>";
    fixture.refs.agentCreateModelEl.value = "primary";
    fixture.refs.agentCreateSystemPromptEl.value = "restart prompt";
    fixture.refs.agentCreateSubmitBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    const successNotice = fixture.showNotice.mock.calls.find((call) => call[2] === "success");
    successNotice[4].onAction();
    expect(fixture.feature.getRuntimeSnapshot().pendingSystemRestartRequestCount).toBe(1);

    fixture.feature.dispose();
    restartRequest.resolve({
      ok: false,
      error: { message: "late restart failure" },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.showNotice).toHaveBeenCalledTimes(1);
    expect(fixture.feature.getRuntimeSnapshot().pendingSystemRestartRequestCount).toBe(0);
  });

  it("rejects synchronous catalog, cache, storage, and command ingress after dispose", async () => {
    const fixture = createFixture({
      residentAgentRosterEnabled: true,
      conversationMessages: [{ role: "assistant", content: "partial", __streaming: true }],
    });
    fixture.feature.dispose();
    fixture.onAgentIdentityChanged.mockClear();
    fixture.onAgentCatalogChanged.mockClear();
    for (const method of Object.values(fixture.agentSessionCacheFeature)) {
      method.mockClear?.();
    }

    fixture.feature.applyHelloIdentity({ agentName: "Late", agentAvatar: "/late.png" });
    fixture.feature.syncAgentRuntimeEntry("coder", { status: "running" });
    fixture.feature.applyUploadedAgentAvatarChange({ agentId: "coder", avatarPath: "/late.png" });
    fixture.feature.updateAgentCatalogAvatar("coder", "/late-direct.png");
    fixture.feature.syncAgentCatalog([{ id: "late-agent", displayName: "Late agent" }], "late-agent");
    fixture.feature.handleAgentStatusPayload({ agentId: "coder", status: "running" });
    fixture.feature.handleConversationDeltaPayload({ conversationId: "conversation-1", delta: "late" });
    fixture.feature.handleConversationFinalPayload({ conversationId: "conversation-1", text: "late" });
    fixture.feature.handleConversationStoppedPayload({ conversationId: "conversation-1" });
    fixture.feature.setConversationMessages("conversation-1", [{ role: "user", content: "late" }]);
    fixture.feature.cacheOutgoingUserMessage({
      conversationId: "conversation-1",
      displayText: "late",
      timestampMs: 1,
      agentId: "coder",
    });
    fixture.feature.handleMessageSendConversationBound({
      conversationId: "conversation-1",
      agentId: "coder",
    });
    await fixture.feature.focusAgentObservabilityTarget("late-agent");
    await fixture.feature.openContinuationAction({
      kind: "conversation",
      conversationId: "conversation-late",
    });

    expect([...fixture.agentCatalog.keys()]).toEqual(["coder"]);
    expect(fixture.agentCatalog.get("coder")).toMatchObject({ avatar: "", status: "idle" });
    expect(fixture.onAgentIdentityChanged).not.toHaveBeenCalled();
    expect(fixture.onAgentCatalogChanged).not.toHaveBeenCalled();
    expect(fixture.agentSessionCacheFeature.bindAgentConversation).not.toHaveBeenCalled();
    expect(fixture.agentSessionCacheFeature.appendUserMessage).not.toHaveBeenCalled();
    expect(fixture.agentSessionCacheFeature.appendAssistantDelta).not.toHaveBeenCalled();
    expect(fixture.agentSessionCacheFeature.finalizeAssistantMessage).not.toHaveBeenCalled();
    expect(fixture.agentSessionCacheFeature.setConversationMessages).not.toHaveBeenCalled();
    expect(localStorage.getItem("selected-agent-id")).toBeNull();
    expect(fixture.openConversationSession).not.toHaveBeenCalled();
    expect(fixture.switchMode).not.toHaveBeenCalled();
  });
});
