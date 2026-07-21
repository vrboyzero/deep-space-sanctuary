import { buildResidentPanelSummary } from "./resident-observability-summary.js";
import { buildAgentWorkSummary } from "./agent-work-summary.js";
import { PENDING_AGENT_SELECTION_KEY } from "./chat-network.js";
import { setRuntimeStyles, toRuntimeStyleUrl } from "./runtime-style-registry.js";

function getElementsByDataValue(root, attribute, expectedValue) {
  if (!root || !attribute || !expectedValue) return [];
  return [...root.querySelectorAll(`[${attribute}]`)]
    .filter((node) => node.getAttribute(attribute) === expectedValue);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createAgentRuntimeFeature({
  refs,
  agentCatalog,
  residentAgentRosterEnabled,
  storageKey = "selected-agent-id",
  initialIdentity = {},
  agentSessionCacheFeature,
  sendReq,
  makeId,
  requestModelCatalog,
  getHttpAuthHeaders,
  getActiveConversationId,
  setActiveConversationId,
  renderCanvasGoalContext,
  switchMode,
  getChatEventsFeature,
  getSessionDigestFeature,
  renderConversationMessages,
  loadConversationMeta,
  refreshMemoryViewerForAgentSwitch,
  getSubtasksState,
  openSubtaskBySession,
  openSubtaskById,
  loadSubtasks,
  getGoalsState,
  loadGoals,
  resumeGoal,
  getMemoryViewerState,
  switchMemoryViewerTab,
  loadMemoryViewer,
  openTaskFromAudit,
  openConversationSession,
  openAgentConfigEditor,
  appendMessage,
  getChatUiFeature,
  onAgentIdentityChanged,
  onAgentCatalogChanged,
  showNotice,
  localeController,
  setAgentPanelHasContent,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    agentSelectEl,
    agentRightPanelEl,
    goalsDetailEl,
    messagesEl,
    agentCreateModalEl,
    agentCreateModalTitleEl,
    agentCreateModalCloseBtn,
    agentCreateCancelBtn,
    agentCreateSubmitBtn,
    agentCreateIdEl,
    agentCreateDisplayNameEl,
    agentCreateModelEl,
    agentCreateSystemPromptEl,
  } = refs;

  const ownedListeners = [];
  const pendingAgentCreateRequests = new Set();
  const pendingAvatarUploadRequests = new Set();
  const pendingModelCatalogRequests = new Set();
  const pendingObservabilityNavigations = new Set();
  const pendingResidentEnsureRequests = new Set();
  const pendingSystemRestartRequests = new Set();
  let agentCreateActionGeneration = 0;
  let avatarUploadGeneration = 0;
  let createModalGeneration = 0;
  let disposed = false;
  let observabilityNavigationGeneration = 0;
  let residentSessionGeneration = 0;
  let residentAgentActivationSeq = 0;
  let systemRestartGeneration = 0;
  let agentPanelUploadInput = null;
  let agentPanelUploadTargetAgentId = "";
  let agentPanelUploadBusyAgentId = "";
  let currentAgentName = initialIdentity.agentName || "Agent";
  let currentAgentAvatar = initialIdentity.agentAvatar || "🤖";
  let defaultAgentName = initialIdentity.defaultAgentName || currentAgentName;
  let defaultAgentAvatar = initialIdentity.defaultAgentAvatar || currentAgentAvatar;
  let agentCreateBusy = false;
  let observabilityModalBinding = null;

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    ownedListeners.push({ target, type, handler });
  }

  function isCurrentCreateModal(generation) {
    return !disposed && generation === createModalGeneration;
  }

  function isCurrentAgentCreate(generation) {
    return !disposed && generation === agentCreateActionGeneration;
  }

  function isCurrentAvatarUpload(generation) {
    return !disposed && generation === avatarUploadGeneration;
  }

  function isCurrentResidentSession(generation) {
    return !disposed && generation === residentSessionGeneration;
  }

  function isCurrentObservabilityNavigation(generation) {
    return !disposed && generation === observabilityNavigationGeneration;
  }

  function isCurrentSystemRestart(generation) {
    return !disposed && generation === systemRestartGeneration;
  }

  function closeAgentCreateModal(options = {}) {
    if (!agentCreateModalEl) return;
    if (agentCreateBusy && !options.force) return;
    createModalGeneration += 1;
    agentCreateModalEl.classList.add("hidden");
  }

  function resetAgentCreateForm() {
    if (agentCreateIdEl) agentCreateIdEl.value = "";
    if (agentCreateDisplayNameEl) agentCreateDisplayNameEl.value = "";
    if (agentCreateSystemPromptEl) agentCreateSystemPromptEl.value = "";
  }

  function renderAgentCreateModelOptions(modelCatalog) {
    if (!agentCreateModelEl) return;
    agentCreateModelEl.textContent = "";
    const addOption = (value, label) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      agentCreateModelEl.appendChild(option);
    };
    addOption("primary", t("agentPanel.createModelPrimary"));
    const models = Array.isArray(modelCatalog?.models) ? modelCatalog.models : [];
    const seen = new Set(["primary"]);
    for (const model of models) {
      const modelId = typeof model?.id === "string" ? model.id.trim() : "";
      if (!modelId || seen.has(modelId)) continue;
      seen.add(modelId);
      const label = model.displayName || model.model || modelId;
      addOption(modelId, `${label} (${modelId})`);
    }
    agentCreateModelEl.value = "primary";
  }

  async function openAgentCreateModal() {
    if (disposed || !agentCreateModalEl) return;
    const generation = ++createModalGeneration;
    resetAgentCreateForm();
    renderAgentCreateModelOptions(null);
    agentCreateModalEl.classList.remove("hidden");
    agentCreateIdEl?.focus();

    const requestToken = Symbol("agent-create-model-catalog");
    pendingModelCatalogRequests.add(requestToken);
    try {
      const modelCatalog = await requestModelCatalog?.();
      if (!isCurrentCreateModal(generation)) return;
      renderAgentCreateModelOptions(modelCatalog);
    } catch {
      if (!isCurrentCreateModal(generation)) return;
      renderAgentCreateModelOptions(null);
    } finally {
      pendingModelCatalogRequests.delete(requestToken);
    }
  }

  async function triggerSystemRestart(reason) {
    if (disposed) return;
    const generation = systemRestartGeneration;
    const requestToken = Symbol("agent-system-restart");
    pendingSystemRestartRequests.add(requestToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "system.restart",
        params: typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {},
      });
      if (!isCurrentSystemRestart(generation)) return;
      if (!res?.ok) {
        throw new Error(res?.error?.message || t("agentPanel.restartFailedMessage"));
      }
    } catch (error) {
      if (!isCurrentSystemRestart(generation)) return;
      throw error;
    } finally {
      pendingSystemRestartRequests.delete(requestToken);
    }
  }

  async function submitAgentCreate() {
    if (disposed || agentCreateBusy) return;
    const id = String(agentCreateIdEl?.value || "").trim();
    const displayName = String(agentCreateDisplayNameEl?.value || "").trim();
    const model = String(agentCreateModelEl?.value || "").trim() || "primary";
    const systemPromptOverride = String(agentCreateSystemPromptEl?.value || "").trim();

    if (!id || !displayName || !systemPromptOverride) {
      showNotice(
        t("agentPanel.createFailedTitle"),
        t("agentPanel.createValidationMessage"),
        "error",
        0,
      );
      return;
    }

    agentCreateBusy = true;
    const generation = ++agentCreateActionGeneration;
    const requestToken = Symbol("agent-create");
    pendingAgentCreateRequests.add(requestToken);
    if (agentCreateSubmitBtn) {
      agentCreateSubmitBtn.disabled = true;
    }

    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "agent.create",
        params: {
          id,
          displayName,
          model,
          systemPromptOverride,
        },
      });
      if (!isCurrentAgentCreate(generation)) return;
      if (!res?.ok) {
        showNotice(
          t("agentPanel.createFailedTitle"),
          res?.error?.message || t("agentPanel.createUnknownError"),
          "error",
          0,
        );
        return;
      }

      sessionStorage.setItem(PENDING_AGENT_SELECTION_KEY, id);
      closeAgentCreateModal({ force: true });
      showNotice(
        t("agentPanel.createSuccessTitle"),
        t("agentPanel.createSuccessMessage", { agentId: id }),
        "success",
        0,
        {
          actionLabel: t("agentPanel.restartNowAction"),
          onAction: () => {
            void triggerSystemRestart(`Activate newly created agent "${id}"`).catch((error) => {
              showNotice(
                t("agentPanel.restartFailedTitle"),
                error instanceof Error ? error.message : String(error),
                "error",
                0,
              );
            });
          },
        },
      );
      openAgentConfigFile(id);
    } catch (error) {
      if (!isCurrentAgentCreate(generation)) return;
      showNotice(
        t("agentPanel.createFailedTitle"),
        error instanceof Error ? error.message : String(error),
        "error",
        0,
      );
    } finally {
      pendingAgentCreateRequests.delete(requestToken);
      if (!isCurrentAgentCreate(generation)) return;
      agentCreateBusy = false;
      if (agentCreateSubmitBtn) {
        agentCreateSubmitBtn.disabled = false;
      }
    }
  }

  function syncAgentIdentityUi() {
    getChatUiFeature?.()?.refreshAvatar("bot", currentAgentAvatar);
    onAgentIdentityChanged?.({
      agentName: currentAgentName,
      agentAvatar: currentAgentAvatar,
      defaultAgentName,
      defaultAgentAvatar,
    });
  }

  function getAgentProfile() {
    return {
      name: currentAgentName,
      avatar: currentAgentAvatar,
    };
  }

  function applyHelloIdentity(frame = {}) {
    if (disposed) return;
    if (frame.agentName) {
      currentAgentName = frame.agentName;
      defaultAgentName = frame.agentName;
    }
    if (frame.agentAvatar) {
      currentAgentAvatar = frame.agentAvatar;
      defaultAgentAvatar = frame.agentAvatar;
    }
    syncAgentIdentityUi();
  }

  function getCurrentAgentSelection() {
    const selected = agentSelectEl?.value?.trim();
    return selected || "default";
  }

  function getCurrentAgentLabel() {
    const selectedAgentId = getCurrentAgentSelection();
    const selectedAgent = agentCatalog.get(selectedAgentId);
    if (selectedAgent?.displayName || selectedAgent?.name) {
      return selectedAgent.displayName || selectedAgent.name;
    }
    const selectedIndex = typeof agentSelectEl?.selectedIndex === "number" ? agentSelectEl.selectedIndex : -1;
    if (selectedIndex >= 0) {
      const optionLabel = agentSelectEl?.options?.[selectedIndex]?.text;
      if (typeof optionLabel === "string" && optionLabel.trim()) {
        return optionLabel.trim();
      }
    }
    return "";
  }

  function syncAgentRuntimeEntry(agentId, patch = {}) {
    if (disposed || !agentId) return null;
    const existing = agentCatalog.get(agentId);
    if (!existing) return null;
    const next = {
      ...existing,
      ...patch,
    };
    agentCatalog.set(agentId, next);
    return next;
  }

  async function ensureResidentAgentSession(agentId) {
    if (disposed || !residentAgentRosterEnabled || !agentId) return null;
    const generation = residentSessionGeneration;
    const requestToken = Symbol("resident-agent-session-ensure");
    pendingResidentEnsureRequests.add(requestToken);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "agent.session.ensure",
        params: { agentId },
      });
      if (!isCurrentResidentSession(generation)) return null;
      if (!res || !res.ok || !res.payload?.conversationId) {
        return null;
      }

      const mainConversationId = typeof res.payload.mainConversationId === "string" && res.payload.mainConversationId.trim()
        ? res.payload.mainConversationId.trim()
        : String(res.payload.conversationId);
      const lastConversationId = typeof res.payload.lastConversationId === "string" && res.payload.lastConversationId.trim()
        ? res.payload.lastConversationId.trim()
        : String(res.payload.conversationId);
      agentSessionCacheFeature.bindAgentConversation(agentId, mainConversationId, { main: true });
      agentSessionCacheFeature.bindAgentConversation(agentId, lastConversationId);
      syncAgentRuntimeEntry(agentId, {
        status: typeof res.payload.status === "string" ? res.payload.status : "idle",
        mainConversationId,
        lastConversationId,
        lastActiveAt: typeof res.payload.lastActiveAt === "number" ? res.payload.lastActiveAt : undefined,
      });
      return res.payload;
    } catch (error) {
      if (!isCurrentResidentSession(generation)) return null;
      throw error;
    } finally {
      pendingResidentEnsureRequests.delete(requestToken);
    }
  }

  async function activateResidentAgentConversation(agentId, options = {}) {
    if (disposed || !agentId) return;
    const activationSeq = ++residentAgentActivationSeq;
    const forceEnsure = options.forceEnsure === true;
    const switchToChat = options.switchToChat !== false;
    let conversationId = agentSessionCacheFeature.getAgentConversation(agentId)
      || agentCatalog.get(agentId)?.lastConversationId
      || agentCatalog.get(agentId)?.mainConversationId
      || "";

    if (!conversationId || forceEnsure) {
      const ensured = await ensureResidentAgentSession(agentId);
      if (disposed || activationSeq !== residentAgentActivationSeq) return;
      conversationId = typeof ensured?.conversationId === "string" ? ensured.conversationId : conversationId;
    }

    if (!conversationId) {
      setActiveConversationId(null);
      renderCanvasGoalContext?.();
      getChatEventsFeature?.()?.resetStreamingState();
      getSessionDigestFeature?.()?.clear?.();
      renderConversationMessages([]);
      return;
    }

    agentSessionCacheFeature.bindAgentConversation(agentId, conversationId, {
      main: conversationId === agentCatalog.get(agentId)?.mainConversationId,
    });
    setActiveConversationId(conversationId);
    renderCanvasGoalContext?.();
    if (switchToChat) {
      switchMode("chat");
    }
    getChatEventsFeature?.()?.resetStreamingState();

    const cachedMessages = agentSessionCacheFeature.getConversationMessages(conversationId);
    if (cachedMessages.length > 0) {
      renderConversationMessages(cachedMessages);
    } else {
      renderConversationMessages([]);
    }

    void loadConversationMeta(conversationId, { showGoalEntryBanner: true });
    void getSessionDigestFeature?.()?.loadSessionDigest(conversationId);
  }

  function syncSelectedAgentIdentity() {
    if (disposed) return null;
    const selectedAgent = agentCatalog.get(getCurrentAgentSelection());
    if (!selectedAgent) return null;
    const fallbackAgent = agentCatalog.get("default");
    const identity = {
      selectedAgent,
      agentName: selectedAgent.name || selectedAgent.displayName || defaultAgentName || "Agent",
      agentAvatar: selectedAgent.avatar || fallbackAgent?.avatar || defaultAgentAvatar || "🤖",
    };
    currentAgentName = identity.agentName;
    currentAgentAvatar = identity.agentAvatar;
    syncAgentIdentityUi();
    return identity;
  }

  function updateAgentCatalogAvatar(agentId, avatarPath) {
    if (disposed) return null;
    const targetAgentId = agentId && agentId !== "default" ? agentId : "default";
    const existing = agentCatalog.get(targetAgentId);
    if (existing) {
      existing.avatar = avatarPath;
      agentCatalog.set(targetAgentId, existing);
      return targetAgentId;
    }

    agentCatalog.set(targetAgentId, {
      id: targetAgentId,
      displayName: targetAgentId,
      name: targetAgentId,
      avatar: avatarPath,
      model: "",
    });
    return targetAgentId;
  }

  function applyUploadedAgentAvatarChange({ agentId, avatarPath }) {
    if (disposed) return;
    const bustedPath = `${avatarPath}${avatarPath.includes("?") ? "&" : "?"}v=${Date.now()}`;
    const targetAgentId = agentId && typeof agentId === "string" ? agentId : getCurrentAgentSelection();
    const updatedAgentId = updateAgentCatalogAvatar(targetAgentId, bustedPath);
    if (updatedAgentId === "default") {
      defaultAgentAvatar = bustedPath;
    }
    syncSelectedAgentIdentity();
    renderAgentRightPanel();
  }

  function handleAgentPanelAvatarUploadChange() {
    const selectedFile = agentPanelUploadInput?.files?.[0];
    const targetAgentId = agentPanelUploadTargetAgentId;
    agentPanelUploadTargetAgentId = "";
    if (agentPanelUploadInput) {
      agentPanelUploadInput.value = "";
    }
    if (disposed || !selectedFile || !targetAgentId) return;
    void uploadAgentPanelAvatar(targetAgentId, selectedFile);
  }

  function ensureAgentPanelAvatarUploadInput() {
    if (disposed) return null;
    if (agentPanelUploadInput) return agentPanelUploadInput;

    agentPanelUploadInput = document.createElement("input");
    agentPanelUploadInput.type = "file";
    agentPanelUploadInput.accept = "image/png,image/jpeg,image/gif,image/webp";
    agentPanelUploadInput.className = "hidden";
    agentPanelUploadInput.addEventListener("change", handleAgentPanelAvatarUploadChange);
    document.body.appendChild(agentPanelUploadInput);
    return agentPanelUploadInput;
  }

  function openAgentPanelAvatarPicker(agentId) {
    if (disposed || !agentId || agentPanelUploadBusyAgentId) return;
    agentPanelUploadTargetAgentId = agentId;
    ensureAgentPanelAvatarUploadInput()?.click();
  }

  function openAgentConfigFile(agentId) {
    const normalizedAgentId = typeof agentId === "string" ? agentId.trim() : "";
    if (!normalizedAgentId || typeof openAgentConfigEditor !== "function") return;
    void openAgentConfigEditor("agents.json", {
      findPattern: `"id"\\s*:\\s*"${escapeRegExp(normalizedAgentId)}"`,
    });
  }

  async function uploadAgentPanelAvatar(agentId, file) {
    if (disposed || !agentId || !file || agentPanelUploadBusyAgentId) return;

    const generation = ++avatarUploadGeneration;
    const requestToken = Symbol("agent-avatar-upload");
    pendingAvatarUploadRequests.add(requestToken);
    agentPanelUploadBusyAgentId = agentId;
    renderAgentRightPanel();

    try {
      const formData = new FormData();
      formData.append("role", "agent");
      if (agentId !== "default") {
        formData.append("agentId", agentId);
      }
      formData.append("file", file, file.name || "avatar.png");

      const res = await fetch("/api/avatar/upload", {
        method: "POST",
        body: formData,
        headers: getHttpAuthHeaders(),
      });
      if (!isCurrentAvatarUpload(generation)) return;
      const payload = await res.json().catch(() => null);
      if (!isCurrentAvatarUpload(generation)) return;
      if (!res.ok || !payload?.ok) {
        const message = payload?.error?.message || t("agentPanel.avatarUploadFailedMessage");
        showNotice(
          t("agentPanel.avatarUploadFailedTitle"),
          message,
          "error",
          3800,
        );
        return;
      }

      const avatarPath = typeof payload.avatarPath === "string" ? payload.avatarPath : "";
      if (!avatarPath) {
        showNotice(
          t("agentPanel.avatarUploadFailedTitle"),
          t("agentPanel.avatarMissingPathMessage"),
          "error",
          3800,
        );
        return;
      }

      applyUploadedAgentAvatarChange({ agentId, avatarPath });
      const agentLabel = agentCatalog.get(agentId)?.displayName || agentCatalog.get(agentId)?.name || agentId;
      showNotice(
        t("agentPanel.avatarUpdatedTitle"),
        t("agentPanel.avatarUpdatedMessage", { agentName: agentLabel }),
        "success",
        2200,
      );
    } catch (error) {
      if (!isCurrentAvatarUpload(generation)) return;
      showNotice(
        t("agentPanel.avatarUploadFailedTitle"),
        error instanceof Error ? error.message : String(error),
        "error",
        3800,
      );
    } finally {
      pendingAvatarUploadRequests.delete(requestToken);
      if (!isCurrentAvatarUpload(generation)) return;
      agentPanelUploadBusyAgentId = "";
      renderAgentRightPanel();
    }
  }

  function syncAgentCatalog(agents = [], selectedAgentId = "") {
    if (disposed) return;
    agentCatalog.clear();
    for (const agent of Array.isArray(agents) ? agents : []) {
      if (!agent || typeof agent !== "object" || !agent.id) continue;
      const mainConversationId = typeof agent.mainConversationId === "string" ? agent.mainConversationId : "";
      const lastConversationId = typeof agent.lastConversationId === "string" ? agent.lastConversationId : "";
      if (mainConversationId) {
        agentSessionCacheFeature.bindAgentConversation(agent.id, mainConversationId, { main: true });
      }
      if (lastConversationId) {
        agentSessionCacheFeature.bindAgentConversation(agent.id, lastConversationId);
      }
      agentCatalog.set(agent.id, {
        id: agent.id,
        displayName: agent.displayName || agent.id,
        name: agent.name || agent.displayName || agent.id,
        avatar: agent.avatar || "",
        model: agent.model || "",
        status: typeof agent.status === "string" ? agent.status : "idle",
        mainConversationId,
        lastConversationId,
        lastActiveAt: typeof agent.lastActiveAt === "number" ? agent.lastActiveAt : undefined,
        memoryMode: typeof agent.memoryMode === "string" ? agent.memoryMode : "",
        workspaceBinding: typeof agent.workspaceBinding === "string" ? agent.workspaceBinding : "",
        sessionNamespace: typeof agent.sessionNamespace === "string" ? agent.sessionNamespace : "",
        conversationDigest: agent.conversationDigest && typeof agent.conversationDigest === "object"
          ? {
            status: typeof agent.conversationDigest.status === "string" ? agent.conversationDigest.status : "",
            pendingMessageCount: Number(agent.conversationDigest.pendingMessageCount) || 0,
          }
          : null,
        recentTaskDigest: agent.recentTaskDigest && typeof agent.recentTaskDigest === "object"
          ? {
            recentCount: Number(agent.recentTaskDigest.recentCount) || 0,
            latestTaskId: typeof agent.recentTaskDigest.latestTaskId === "string" ? agent.recentTaskDigest.latestTaskId : "",
            latestTitle: typeof agent.recentTaskDigest.latestTitle === "string" ? agent.recentTaskDigest.latestTitle : "",
            latestStatus: typeof agent.recentTaskDigest.latestStatus === "string" ? agent.recentTaskDigest.latestStatus : "",
            latestFinishedAt: typeof agent.recentTaskDigest.latestFinishedAt === "string" ? agent.recentTaskDigest.latestFinishedAt : "",
          }
          : null,
        recentSubtaskDigest: agent.recentSubtaskDigest && typeof agent.recentSubtaskDigest === "object"
          ? {
            recentCount: Number(agent.recentSubtaskDigest.recentCount) || 0,
            latestTaskId: typeof agent.recentSubtaskDigest.latestTaskId === "string" ? agent.recentSubtaskDigest.latestTaskId : "",
            latestSummary: typeof agent.recentSubtaskDigest.latestSummary === "string" ? agent.recentSubtaskDigest.latestSummary : "",
            latestStatus: typeof agent.recentSubtaskDigest.latestStatus === "string" ? agent.recentSubtaskDigest.latestStatus : "",
            latestUpdatedAt: Number(agent.recentSubtaskDigest.latestUpdatedAt) || 0,
            latestAgentId: typeof agent.recentSubtaskDigest.latestAgentId === "string" ? agent.recentSubtaskDigest.latestAgentId : "",
            latestParentTaskId: typeof agent.recentSubtaskDigest.latestParentTaskId === "string" ? agent.recentSubtaskDigest.latestParentTaskId : "",
          }
          : null,
        experienceUsageDigest: agent.experienceUsageDigest && typeof agent.experienceUsageDigest === "object"
          ? {
            usageCount: Number(agent.experienceUsageDigest.usageCount) || 0,
            methodCount: Number(agent.experienceUsageDigest.methodCount) || 0,
            skillCount: Number(agent.experienceUsageDigest.skillCount) || 0,
            latestAssetType: typeof agent.experienceUsageDigest.latestAssetType === "string" ? agent.experienceUsageDigest.latestAssetType : "",
            latestAssetKey: typeof agent.experienceUsageDigest.latestAssetKey === "string" ? agent.experienceUsageDigest.latestAssetKey : "",
            latestTaskId: typeof agent.experienceUsageDigest.latestTaskId === "string" ? agent.experienceUsageDigest.latestTaskId : "",
            latestUsedAt: typeof agent.experienceUsageDigest.latestUsedAt === "string" ? agent.experienceUsageDigest.latestUsedAt : "",
          }
          : null,
        sharedGovernance: agent.sharedGovernance && typeof agent.sharedGovernance === "object"
          ? {
            pendingCount: Number(agent.sharedGovernance.pendingCount) || 0,
            claimedCount: Number(agent.sharedGovernance.claimedCount) || 0,
          }
          : null,
        continuationState: agent.continuationState && typeof agent.continuationState === "object"
          ? {
            scope: typeof agent.continuationState.scope === "string" ? agent.continuationState.scope : "",
            targetId: typeof agent.continuationState.targetId === "string" ? agent.continuationState.targetId : "",
            recommendedTargetId: typeof agent.continuationState.recommendedTargetId === "string" ? agent.continuationState.recommendedTargetId : "",
            targetType: typeof agent.continuationState.targetType === "string" ? agent.continuationState.targetType : "",
            resumeMode: typeof agent.continuationState.resumeMode === "string" ? agent.continuationState.resumeMode : "",
            summary: typeof agent.continuationState.summary === "string" ? agent.continuationState.summary : "",
            nextAction: typeof agent.continuationState.nextAction === "string" ? agent.continuationState.nextAction : "",
          }
          : null,
        observabilityHeadline: typeof agent.observabilityHeadline === "string" ? agent.observabilityHeadline : "",
      });
    }

    if (agentSelectEl && selectedAgentId && agentSelectEl.value !== selectedAgentId) {
      agentSelectEl.value = selectedAgentId;
    }

    syncSelectedAgentIdentity();
    renderAgentRightPanel();
    onAgentCatalogChanged?.();
  }

  async function focusAgentObservabilityTarget(agentId) {
    if (disposed) return;
    const targetAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : "default";
    if (agentSelectEl && agentSelectEl.value !== targetAgentId) {
      agentSelectEl.value = targetAgentId;
      localStorage.setItem(storageKey, targetAgentId);
    }
    syncSelectedAgentIdentity();
    renderAgentRightPanel();
    await refreshMemoryViewerForAgentSwitch(targetAgentId);
    if (residentAgentRosterEnabled) {
      await activateResidentAgentConversation(targetAgentId, {
        forceEnsure: true,
        switchToChat: false,
      });
    }
  }

  function clearGoalContinuationFocus() {
    if (disposed) return;
    goalsDetailEl?.querySelectorAll(".is-continuation-focus").forEach((node) => {
      node.classList.remove("is-continuation-focus");
    });
  }

  function applyGoalContinuationFocus(goalId = getGoalsState()?.selectedId) {
    if (disposed) return false;
    clearGoalContinuationFocus();
    const goalsState = getGoalsState?.();
    const focus = goalsState?.continuationFocusNode;
    if (!goalsDetailEl || !focus || !focus.nodeId || !goalId || focus.goalId !== goalId) {
      return false;
    }
    const matched = getElementsByDataValue(goalsDetailEl, "data-goal-node-id", focus.nodeId)
      .map((node) => node.closest("[data-goal-continuation-focus]") || node);
    if (!matched.length) return false;
    matched.forEach((node) => node.classList.add("is-continuation-focus"));
    matched
      .map((node) => node.closest(".goal-tracking-card, .goal-capability-card"))
      .filter(Boolean)
      .forEach((node) => node.classList.add("is-continuation-focus"));
    if (!focus.scrolled) {
      matched[0].scrollIntoView({ block: "center", behavior: "smooth" });
      focus.scrolled = true;
    }
    return true;
  }

  async function openContinuationAction(action = {}) {
    const kind = typeof action?.kind === "string" ? action.kind : "";
    if (disposed || !kind) return;

    const goalsState = getGoalsState?.();
    const subtasksState = getSubtasksState?.();

    switch (kind) {
      case "goalReplay":
        if (action.goalId && action.nodeId && goalsState) {
          goalsState.continuationFocusNode = {
            goalId: action.goalId,
            nodeId: action.nodeId,
            scrolled: false,
          };
        } else if (goalsState) {
          goalsState.continuationFocusNode = null;
        }
        if (subtasksState) {
          subtasksState.linkedSessionContext = null;
          subtasksState.continuationFocusSessionId = null;
        }
        if (!action.goalId) return;
        await resumeGoal(action.goalId, {
          nodeId: typeof action.nodeId === "string" ? action.nodeId : undefined,
          checkpointId: typeof action.checkpointId === "string" ? action.checkpointId : undefined,
          silent: true,
        });
        await loadGoals(true, action.goalId);
        return;
      case "goal":
        if (goalsState) {
          goalsState.continuationFocusNode = null;
        }
        if (subtasksState) {
          subtasksState.linkedSessionContext = null;
          subtasksState.continuationFocusSessionId = null;
        }
        if (!action.goalId) return;
        switchMode("goals");
        await loadGoals(true, action.goalId);
        return;
      case "node":
        if (action.goalId && action.nodeId && goalsState) {
          goalsState.continuationFocusNode = {
            goalId: action.goalId,
            nodeId: action.nodeId,
            scrolled: false,
          };
        }
        if (!action.goalId) return;
        switchMode("goals");
        await loadGoals(true, action.goalId);
        return;
      case "session":
        if (goalsState) {
          goalsState.continuationFocusNode = null;
        }
        if (action.sessionId) {
          await openSubtaskBySession(action.sessionId, { taskId: action.taskId });
          return;
        }
        if (action.taskId && subtasksState) {
          subtasksState.linkedSessionContext = null;
          await openSubtaskById(action.taskId);
        }
        return;
      case "conversation":
        if (goalsState) {
          goalsState.continuationFocusNode = null;
        }
        if (subtasksState) {
          subtasksState.continuationFocusSessionId = null;
        }
        if (action.conversationId) {
          openConversationSession(
            action.conversationId,
            t("agentPanel.openContinuationConversationHint", { conversationId: action.conversationId }),
          );
          return;
        }
        switchMode("chat");
        return;
      default:
        return;
    }
  }

  async function openAgentObservabilityAction(agentId, action = {}) {
    const kind = typeof action?.kind === "string" ? action.kind : "";
    if (disposed || !kind) return;
    const generation = ++observabilityNavigationGeneration;
    const navigationToken = Symbol("agent-observability-navigation");
    pendingObservabilityNavigations.add(navigationToken);
    try {
      await focusAgentObservabilityTarget(agentId);
      if (!isCurrentObservabilityNavigation(generation)) return;

      switch (kind) {
        case "task":
          if (!action.taskId) return;
          switchMode("memory");
          await openTaskFromAudit(action.taskId);
          if (!isCurrentObservabilityNavigation(generation)) return;
          return;
        case "tasks":
          switchMode("memory");
          if (getMemoryViewerState?.()?.tab !== "tasks") {
            switchMemoryViewerTab("tasks");
          } else {
            await loadMemoryViewer(true);
            if (!isCurrentObservabilityNavigation(generation)) return;
          }
          return;
        case "subtask":
          if (!action.taskId) return;
          await openSubtaskById(action.taskId);
          if (!isCurrentObservabilityNavigation(generation)) return;
          return;
        case "subtasks":
          switchMode("subtasks");
          await loadSubtasks(true);
          if (!isCurrentObservabilityNavigation(generation)) return;
          return;
        case "sharedReview":
          switchMode("memory");
          if (getMemoryViewerState?.()?.tab !== "sharedReview") {
            switchMemoryViewerTab("sharedReview");
          } else {
            await loadMemoryViewer(true);
            if (!isCurrentObservabilityNavigation(generation)) return;
          }
          return;
        case "goal":
        case "node":
        case "session":
        case "conversation":
          await openContinuationAction(action);
          if (!isCurrentObservabilityNavigation(generation)) return;
          return;
        default:
          return;
      }
    } catch (error) {
      if (!isCurrentObservabilityNavigation(generation)) return;
      throw error;
    } finally {
      pendingObservabilityNavigations.delete(navigationToken);
    }
  }

  function closeAgentObservabilityModal({ clearContent = false } = {}) {
    const modalOverlay = observabilityModalBinding?.modalOverlay
      || document.getElementById("agentObservabilityModal");
    const modalClose = observabilityModalBinding?.modalClose
      || document.getElementById("agentObservabilityModalClose");
    if (observabilityModalBinding) {
      modalOverlay?.removeEventListener("click", observabilityModalBinding.backdropHandler);
      if (modalClose?.onclick === observabilityModalBinding.closeHandler) {
        modalClose.onclick = null;
      }
      observabilityModalBinding = null;
    } else if (modalClose && clearContent) {
      modalClose.onclick = null;
    }
    modalOverlay?.classList.add("hidden");
    if (!clearContent) return;
    const modalTitle = document.getElementById("agentObservabilityModalTitle");
    const modalBody = document.getElementById("agentObservabilityModalBody");
    if (modalTitle) modalTitle.textContent = "";
    if (modalBody) modalBody.textContent = "";
  }

  function openAgentObservabilityModal(agent, observability) {
    if (disposed) return;
    closeAgentObservabilityModal();
    const modalOverlay = document.getElementById("agentObservabilityModal");
    const modalTitle = document.getElementById("agentObservabilityModalTitle");
    const modalBody = document.getElementById("agentObservabilityModalBody");
    const modalClose = document.getElementById("agentObservabilityModalClose");
    if (!modalOverlay || !modalBody) return;

    if (modalTitle) {
      modalTitle.textContent = agent.displayName || agent.id || "Agent";
    }

    modalBody.textContent = "";

    if (Array.isArray(observability.badges) && observability.badges.length > 0) {
      const badgesEl = document.createElement("div");
      badgesEl.className = "agent-observability-modal-badges";
      for (const text of observability.badges) {
        if (!text) continue;
        const badge = document.createElement("span");
        badge.className = "agent-observability-modal-badge";
        badge.textContent = text;
        badgesEl.appendChild(badge);
      }
      modalBody.appendChild(badgesEl);
    }

    if (Array.isArray(observability.rows) && observability.rows.length > 0) {
      const rowsEl = document.createElement("div");
      rowsEl.className = "agent-observability-modal-rows";
      for (const row of observability.rows) {
        const rowBtn = document.createElement("button");
        rowBtn.type = "button";
        rowBtn.className = "agent-observability-modal-row";
        rowBtn.title = row.value || row.label || "";
        rowBtn.addEventListener("click", () => {
          closeAgentObservabilityModal();
          void openAgentObservabilityAction(agent.id, row.action);
        });

        const labelEl = document.createElement("span");
        labelEl.className = "agent-observability-modal-label";
        labelEl.textContent = row.label || "";
        rowBtn.appendChild(labelEl);

        const valueEl = document.createElement("span");
        valueEl.className = "agent-observability-modal-value";
        valueEl.textContent = row.value || "";
        rowBtn.appendChild(valueEl);

        rowsEl.appendChild(rowBtn);
      }
      modalBody.appendChild(rowsEl);
    }

    modalOverlay.classList.remove("hidden");

    const closeHandler = () => closeAgentObservabilityModal();
    const backdropHandler = (event) => {
      if (event.target === modalOverlay) closeAgentObservabilityModal();
    };
    if (modalClose) {
      modalClose.onclick = closeHandler;
    }
    modalOverlay.addEventListener("click", backdropHandler);
    observabilityModalBinding = {
      backdropHandler,
      closeHandler,
      modalClose,
      modalOverlay,
    };
  }

  function renderAgentRightPanel() {
    if (disposed || !agentRightPanelEl) return;

    const agents = [...agentCatalog.values()];
    agentRightPanelEl.textContent = "";
    if (typeof setAgentPanelHasContent === "function") {
      setAgentPanelHasContent(agents.length > 0);
    } else {
      agentRightPanelEl.classList.toggle("hidden", agents.length === 0);
    }
    if (agents.length === 0) return;

    const fragment = document.createDocumentFragment();
    const activeAgentId = getCurrentAgentSelection();
    const uploadBusy = Boolean(agentPanelUploadBusyAgentId);

    const toolbar = document.createElement("div");
    toolbar.className = "agent-panel-toolbar";
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "button agent-panel-create-btn";
    createBtn.textContent = t("agentPanel.createButton");
    createBtn.addEventListener("click", () => {
      void openAgentCreateModal();
    });
    toolbar.appendChild(createBtn);
    fragment.appendChild(toolbar);

    for (const agent of agents) {
      const card = document.createElement("div");
      card.className = "agent-card";
      if (agent.id === activeAgentId) {
        card.classList.add("active");
      }
      card.setAttribute("data-agent-id", agent.id);

      const main = document.createElement("button");
      main.type = "button";
      main.className = "agent-card-main";
      main.title = agent.observabilityHeadline || agent.displayName || agent.id;

      const avatar = document.createElement("div");
      avatar.className = "agent-card-avatar avatar-clickable";
      avatar.title = t("agentPanel.changeAvatarTitle", { agentName: agent.displayName || agent.id });
      if (uploadBusy && agentPanelUploadBusyAgentId === agent.id) {
        avatar.classList.add("agent-card-avatar--uploading");
        avatar.title = t("agentPanel.uploadingAvatar");
      }
      avatar.addEventListener("click", (event) => {
        event.stopPropagation();
        openAgentPanelAvatarPicker(agent.id);
      });

      if (typeof agent.avatar === "string" && agent.avatar.trim()) {
        setRuntimeStyles(avatar, {
          "background-image": toRuntimeStyleUrl(agent.avatar, avatar.ownerDocument),
        });
        avatar.classList.add("agent-card-avatar-image");
      } else {
        const fallbackSeed = (agent.displayName || agent.name || agent.id || "?").trim();
        avatar.textContent = fallbackSeed.slice(0, 1).toUpperCase();
      }

      const content = document.createElement("div");
      content.className = "agent-card-content";

      const name = document.createElement("div");
      name.className = "agent-card-name";
      name.textContent = agent.displayName || agent.id;

      const meta = document.createElement("div");
      meta.className = "agent-card-meta";
      const statusText = typeof agent.status === "string" && agent.status && agent.status !== "idle"
        ? ` · ${agent.status}`
        : "";
      meta.textContent = `${agent.model || agent.id}${statusText}`;

      content.appendChild(name);
      content.appendChild(meta);
      main.appendChild(avatar);
      main.appendChild(content);
      main.addEventListener("click", () => {
        if (!agentSelectEl) return;
        agentSelectEl.value = agent.id;
        agentSelectEl.dispatchEvent(new Event("change"));
      });

      card.appendChild(main);
      const observability = buildResidentPanelSummary(agent, t);
      if (
        Array.isArray(observability?.badges) && observability.badges.length > 0
        || Array.isArray(observability?.rows) && observability.rows.length > 0
      ) {
        const summaryWrap = document.createElement("div");
        summaryWrap.className = "agent-card-observability";

        const workSummary = buildAgentWorkSummary(agent, t);
        const workSummaryBtn = document.createElement("button");
        workSummaryBtn.type = "button";
        workSummaryBtn.className = "agent-card-work-summary";
        if (!workSummary.actionable) {
          workSummaryBtn.disabled = true;
        }
        workSummaryBtn.title = workSummary.tooltip || workSummary.title;
        workSummaryBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!workSummary.action) return;
          void openAgentObservabilityAction(agent.id, workSummary.action);
        });

        const workSummaryLines = document.createElement("div");
        workSummaryLines.className = "agent-card-work-summary-lines";
        for (const line of workSummary.lines) {
          const lineEl = document.createElement("div");
          lineEl.className = "agent-card-work-summary-line";

          const labelEl = document.createElement("span");
          labelEl.className = "agent-card-work-summary-label";
          labelEl.textContent = line.label;
          lineEl.appendChild(labelEl);

          const valueEl = document.createElement("span");
          valueEl.className = "agent-card-work-summary-value";
          valueEl.textContent = line.value;
          valueEl.title = line.value;
          lineEl.appendChild(valueEl);

          workSummaryLines.appendChild(lineEl);
        }
        workSummaryBtn.appendChild(workSummaryLines);
        summaryWrap.appendChild(workSummaryBtn);

        const actionsRow = document.createElement("div");
        actionsRow.className = "agent-card-actions";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "agent-card-detail-btn";
        editBtn.textContent = t("agentPanel.editConfig");
        editBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          openAgentConfigFile(agent.id);
        });
        actionsRow.appendChild(editBtn);

        const detailBtn = document.createElement("button");
        detailBtn.type = "button";
        detailBtn.className = "agent-card-detail-btn";
        detailBtn.textContent = t("agentPanel.showDetail");
        detailBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          openAgentObservabilityModal(agent, observability);
        });
        actionsRow.appendChild(detailBtn);

        summaryWrap.appendChild(actionsRow);
        card.appendChild(summaryWrap);
      }
      fragment.appendChild(card);
    }

    agentRightPanelEl.appendChild(fragment);
  }

  async function handleAgentSelectionChange() {
    if (disposed) return;
    const selectedAgentId = agentSelectEl?.value || "default";
    localStorage.setItem(storageKey, selectedAgentId);
    syncSelectedAgentIdentity();
    renderAgentRightPanel();
    void refreshMemoryViewerForAgentSwitch(selectedAgentId);

    if (residentAgentRosterEnabled) {
      await activateResidentAgentConversation(selectedAgentId, { forceEnsure: true });
      return;
    }

    setActiveConversationId(null);
    renderCanvasGoalContext?.();
    getChatEventsFeature?.()?.resetStreamingState();
    getSessionDigestFeature?.()?.clear?.();
    if (messagesEl) {
      messagesEl.textContent = "";
    }
    const displayName = agentSelectEl?.options?.[agentSelectEl.selectedIndex]?.text || agentSelectEl?.value || selectedAgentId;
    appendMessage?.("system", `已切换到 ${displayName}`);
  }

  function findAgentIdByConversation(conversationId) {
    const normalizedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!normalizedConversationId) return "";
    return [...agentCatalog.values()].find(
      (agent) => agentSessionCacheFeature.getAgentConversation(agent.id) === normalizedConversationId,
    )?.id || "";
  }

  async function activatePreferredResidentAgent(agents = []) {
    if (!residentAgentRosterEnabled) return;
    const selectedAgentId = agentSelectEl?.value || agents?.[0]?.id || "default";
    if (!selectedAgentId) return;
    await activateResidentAgentConversation(selectedAgentId, { forceEnsure: true, switchToChat: false });
  }

  function cacheOutgoingUserMessage({ conversationId, displayText, timestampMs, agentId }) {
    if (disposed || !residentAgentRosterEnabled || !conversationId) return;
    const targetAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : getCurrentAgentSelection();
    agentSessionCacheFeature.bindAgentConversation(targetAgentId, conversationId, {
      main: conversationId === agentCatalog.get(targetAgentId)?.mainConversationId,
    });
    agentSessionCacheFeature.appendUserMessage(conversationId, displayText, {
      timestampMs,
      agentId: targetAgentId,
    });
  }

  function handleMessageSendConversationBound({ conversationId, agentId }) {
    const normalizedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (disposed || !residentAgentRosterEnabled || !normalizedConversationId) return;
    const targetAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : getCurrentAgentSelection();
    agentSessionCacheFeature.bindAgentConversation(targetAgentId, normalizedConversationId, {
      main: normalizedConversationId === agentCatalog.get(targetAgentId)?.mainConversationId,
    });
    syncAgentRuntimeEntry(targetAgentId, {
      lastConversationId: normalizedConversationId,
    });
    renderAgentRightPanel();
  }

  function handleAgentStatusPayload(payload) {
    if (disposed) return;
    const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
    const agentId = typeof payload?.agentId === "string"
      ? payload.agentId
      : findAgentIdByConversation(conversationId);
    if (!agentId) return;
    const nextStatus = payload?.status === "running"
      ? "running"
      : payload?.status === "error"
        ? "error"
        : "idle";
    syncAgentRuntimeEntry(agentId, { status: nextStatus });
    renderAgentRightPanel();
  }

  function handleConversationDeltaPayload(payload) {
    if (disposed) return;
    const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
    const delta = typeof payload?.delta === "string" ? payload.delta : "";
    if (!conversationId || !delta) return;
    agentSessionCacheFeature.appendAssistantDelta(conversationId, delta, {
      timestampMs: Date.now(),
    });
  }

  function handleConversationFinalPayload(payload) {
    if (disposed) return;
    const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
    if (!conversationId) return;
    agentSessionCacheFeature.finalizeAssistantMessage(conversationId, payload?.text || "", {
      timestampMs: typeof payload?.messageMeta?.timestampMs === "number" ? payload.messageMeta.timestampMs : Date.now(),
      displayTimeText: typeof payload?.messageMeta?.displayTimeText === "string" ? payload.messageMeta.displayTimeText : "",
      agentId: typeof payload?.agentId === "string" ? payload.agentId : undefined,
    });
  }

  function handleConversationStoppedPayload(payload) {
    if (disposed) return;
    const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
    if (!conversationId) return;
    const currentMessages = agentSessionCacheFeature.getConversationMessages(conversationId);
    const latest = currentMessages[currentMessages.length - 1];
    if (!latest || latest.role !== "assistant" || latest.__streaming !== true) {
      return;
    }
    const partialText = typeof latest.content === "string" ? latest.content : String(latest.content ?? "");
    if (!partialText.trim()) {
      return;
    }
    agentSessionCacheFeature.finalizeAssistantMessage(conversationId, partialText, {
      timestampMs: Date.now(),
      agentId: typeof payload?.agentId === "string" ? payload.agentId : undefined,
    });
  }

  function setConversationMessages(conversationId, messages) {
    if (disposed || !conversationId || !Array.isArray(messages)) return;
    agentSessionCacheFeature.setConversationMessages(conversationId, messages);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    createModalGeneration += 1;
    agentCreateActionGeneration += 1;
    avatarUploadGeneration += 1;
    residentSessionGeneration += 1;
    residentAgentActivationSeq += 1;
    observabilityNavigationGeneration += 1;
    systemRestartGeneration += 1;
    for (const { target, type, handler } of ownedListeners) {
      target.removeEventListener(type, handler);
    }
    ownedListeners.length = 0;
    agentCreateModalEl?.classList.add("hidden");
    agentCreateBusy = false;
    if (agentCreateSubmitBtn) {
      agentCreateSubmitBtn.disabled = false;
    }
    resetAgentCreateForm();
    if (agentCreateModelEl) {
      agentCreateModelEl.textContent = "";
    }
    if (agentRightPanelEl) {
      // 清空动态节点即可释放其按钮 listener 与闭包正文。
      agentRightPanelEl.textContent = "";
    }
    agentPanelUploadTargetAgentId = "";
    agentPanelUploadBusyAgentId = "";
    if (agentPanelUploadInput) {
      agentPanelUploadInput.removeEventListener("change", handleAgentPanelAvatarUploadChange);
      agentPanelUploadInput.value = "";
      agentPanelUploadInput.remove();
      agentPanelUploadInput = null;
    }
    closeAgentObservabilityModal({ clearContent: true });
    setAgentPanelHasContent?.(false);
  }

  function getRuntimeSnapshot() {
    return {
      createModalDisposed: disposed,
      createModalGeneration,
      agentCreateActionGeneration,
      agentCreateBusy,
      avatarUploadBusy: Boolean(agentPanelUploadBusyAgentId),
      avatarUploadGeneration,
      hasAvatarUploadInput: Boolean(agentPanelUploadInput),
      observabilityModalListenerCount: observabilityModalBinding ? 1 : 0,
      observabilityNavigationGeneration,
      ownedListenerCount: ownedListeners.length,
      pendingAgentCreateRequestCount: pendingAgentCreateRequests.size,
      pendingAvatarUploadRequestCount: pendingAvatarUploadRequests.size,
      pendingModelCatalogRequestCount: pendingModelCatalogRequests.size,
      pendingObservabilityNavigationCount: pendingObservabilityNavigations.size,
      pendingResidentEnsureRequestCount: pendingResidentEnsureRequests.size,
      pendingSystemRestartRequestCount: pendingSystemRestartRequests.size,
      residentSessionGeneration,
      systemRestartGeneration,
    };
  }

  const handleAgentSelectionChangeEvent = () => {
    if (disposed) return;
    void handleAgentSelectionChange();
  };
  const handleAgentCreateModalClose = () => closeAgentCreateModal();
  const handleAgentCreateCancel = () => closeAgentCreateModal();
  const handleAgentCreateSubmit = () => {
    if (disposed) return;
    void submitAgentCreate();
  };

  addOwnedListener(agentSelectEl, "change", handleAgentSelectionChangeEvent);
  addOwnedListener(agentCreateModalCloseBtn, "click", handleAgentCreateModalClose);
  addOwnedListener(agentCreateCancelBtn, "click", handleAgentCreateCancel);
  addOwnedListener(agentCreateSubmitBtn, "click", handleAgentCreateSubmit);

  return {
    getAgentProfile,
    applyHelloIdentity,
    getCurrentAgentSelection,
    getCurrentAgentLabel,
    syncAgentRuntimeEntry,
    ensureResidentAgentSession,
    activateResidentAgentConversation,
    applyUploadedAgentAvatarChange,
    syncAgentCatalog,
    syncSelectedAgentIdentity,
    updateAgentCatalogAvatar,
    focusAgentObservabilityTarget,
    clearGoalContinuationFocus,
    applyGoalContinuationFocus,
    openContinuationAction,
    openAgentObservabilityAction,
    renderAgentRightPanel,
    findAgentIdByConversation,
    activatePreferredResidentAgent,
    cacheOutgoingUserMessage,
    handleMessageSendConversationBound,
    handleAgentStatusPayload,
    handleConversationDeltaPayload,
    handleConversationFinalPayload,
    handleConversationStoppedPayload,
    setConversationMessages,
    dispose,
    getRuntimeSnapshot,
    refreshLocale() {
      renderAgentRightPanel();
    },
  };
}
