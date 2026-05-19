import {
  persistAuthFields,
  persistConnectionFields,
  persistSessionAuthToken,
  persistUuidField,
  persistWorkspaceRootsField,
  restoreAuthFields,
  restoreSessionAuthToken,
  restoreUuidField,
  restoreWorkspaceRootsField,
} from "./app/features/persistence.js";
import { APP_DOM_REFS } from "./app/bootstrap/dom.js";
import {
  AGENT_PANEL_VISIBLE_KEY,
  DEFAULT_VOICE_SHORTCUT,
  AGENT_ID_KEY,
  CLIENT_KEY,
  CONTENT_PANEL_VISIBLE_KEY,
  CONTROL_PANEL_VISIBLE_KEY,
  MODEL_ID_KEY,
  SESSION_AUTH_TOKEN_KEY,
  STORE_KEY,
  TOKEN_USAGE_COLLAPSED_KEY,
  UUID_KEY,
  VOICE_SHORTCUT_DISABLED_VALUE,
  VOICE_SHORTCUT_KEY,
  WEBCHAT_DEBUG_KEY,
  WORKSPACE_ROOTS_KEY,
} from "./app/bootstrap/storage-keys.js";
import {
  createDefaultSharedReviewFilters,
  experienceWorkbenchState,
  goalsState,
  memoryViewerState,
  subtasksState,
} from "./app/bootstrap/state.js";
import { createAttachmentsFeature } from "./app/features/attachments.js";
import { createAgentRuntimeFeature } from "./app/features/agent-runtime.js";
import { createAgentSessionCacheFeature } from "./app/features/agent-session-cache.js";
import { createChatEventsFeature } from "./app/features/chat-events.js";
import { createChatNetworkFeature } from "./app/features/chat-network.js";
import { createChatUiFeature } from "./app/features/chat-ui.js";
import { createCanvasContextFeature } from "./app/features/canvas-context.js";
import { buildDoctorChatSummary } from "./app/features/doctor-observability.js";
import { createAppShellFeature } from "./app/features/app-shell.js";
import { createEmailInboundSessionBannerFeature } from "./app/features/email-inbound-session-banner.js";
import { createGoalsDetailFeature } from "./app/features/goals-detail.js";
import { createGoalsGovernancePanelFeature } from "./app/features/goals-governance-panel.js";
import { createGoalsCapabilityPanelFeature } from "./app/features/goals-capability-panel.js";
import { createGoalsActionsRuntimeFeature } from "./app/features/goals-actions-runtime.js";
import { createGoalsOverviewFeature } from "./app/features/goals-overview.js";
import { createGoalsSpecialistPanelsRuntimeFeature } from "./app/features/goals-specialist-panels-runtime.js";
import { createGoalsStateRuntimeFeature } from "./app/features/goals-state-runtime.js";
import { createGoalsReadonlyPanelsFeature } from "./app/features/goals-readonly-panels.js";
import { createGoalsRuntimeFeature } from "./app/features/goals-runtime.js";
import { createGoalsTrackingPanelFeature } from "./app/features/goals-tracking-panel.js";
import { createHeaderNavigationFeature } from "./app/features/header-navigation.js";
import { createMemoryDetailRenderFeature } from "./app/features/memory-detail-render.js";
import { createMemoryRuntimeFeature } from "./app/features/memory-runtime.js";
import { createMemoryViewerFeature } from "./app/features/memory-viewer.js";
import { createExperienceWorkbenchFeature } from "./app/features/experience-workbench.js";
import { createSessionNavigationFeature } from "./app/features/session-navigation.js";
import { createSessionDigestFeature } from "./app/features/session-digest.js";
import { createSettingsRuntimeFeature } from "./app/features/settings-runtime.js";
import { createSubtasksOverviewFeature, parseGoalSessionReference } from "./app/features/subtasks-overview.js";
import { createSubtasksRuntimeFeature } from "./app/features/subtasks-runtime.js";
import { createLocaleController } from "./app/features/locale.js";
import { initPromptController } from "./app/features/prompt.js";
import { createPanelVisibilityFeature } from "./app/features/panel-visibility.js";
import { createCostBudgetTracker, readCostBudgetConfig } from "./app/features/cost-budget.js";
import { updateTokenUsageObservability } from "./app/features/token-usage-observability.js";
import { createThemeController } from "./app/features/theme.js";
import { createVoiceFeature } from "./app/features/voice.js";
import { GOVERNANCE_DETAIL_MODE_CHANGED_EVENT } from "./app/features/governance-detail-mode.js";
import { consumeSessionAuthHandoff, createSessionAuthHandoffUrl } from "./app/features/session-auth-handoff.js";
import { applyWebConfigLinks } from "./app/features/web-config-links.js";
import { createWorkspaceFeature } from "./app/features/workspace.js";
import { LOCALE_DICTIONARIES, LOCALE_META } from "./app/i18n/index.js";

const {
  statusEl,
  authModeEl,
  authValueEl,
  userUuidEl,
  saveUuidBtn,
  workspaceRootsEl,
  controlPanelEl,
  connectBtn,
  sendBtn,
  promptEl,
  voiceBtn,
  voiceDurationEl,
  messagesEl,
  modelPickerEl,
  modelFilterEl,
  modelSelectEl,
  agentSelectEl,
  themeToggleBtn,
  openWebChatTabLink,
  sidebarEl,
  sidebarTitleEl,
  fileTreeEl,
  refreshTreeBtn,
  goGoalsPageBtn,
  goChatPageBtn,
  chatSection,
  editorSection,
  canvasContextBarEl,
  editorPath,
  editorModeBadge,
  editorTextarea,
  composerSection,
  editorActions,
  cancelEditBtn,
  saveEditBtn,
  openEnvEditorBtn,
  switchRootBtn,
  switchFacetBtn,
  switchCronBtn,
  switchMemoryBtn,
  switchExperienceBtn,
  switchGoalsBtn,
  switchSubtasksBtn,
  switchCanvasBtn,
  openChannelSettingsBtn,
  agentRightPanelEl,
  memoryViewerSection,
  memoryViewerTitleEl,
  memoryViewerStatsEl,
  memoryViewerListEl,
  memoryViewerDetailEl,
  memoryViewerRefreshBtn,
  memoryDreamModalTriggerBtn,
  memoryDreamModalEl,
  memoryDreamModalTitleEl,
  memoryDreamModalCloseBtn,
  memoryDreamBarEl,
  memoryDreamStatusEl,
  memoryDreamMetaEl,
  memoryDreamObsidianEl,
  memoryDreamSummaryEl,
  memoryDreamRefreshBtn,
  memoryDreamRunBtn,
  memoryDreamHistoryToggleBtn,
  memoryDreamHistoryEl,
  memoryDreamHistoryStatusEl,
  memoryDreamHistoryRefreshBtn,
  memoryDreamHistoryListEl,
  memoryDreamHistoryDetailEl,
  memoryTabTasksBtn,
  memoryTabMemoriesBtn,
  memoryTabSharedReviewBtn,
  memoryTabOutboundAuditBtn,
  memoryOutboundAuditFiltersEl,
  memoryOutboundAuditFocusAllBtn,
  memoryOutboundAuditFocusThreadsBtn,
  memorySearchInputEl,
  memoryDedupPreviewBtn,
  memorySearchBtn,
  memoryTaskFiltersEl,
  memoryChunkFiltersEl,
  memoryTaskStatusFilterEl,
  memoryTaskSourceFilterEl,
  memoryTaskGoalFilterBarEl,
  memoryTaskGoalFilterLabelEl,
  memoryTaskGoalFilterClearBtn,
  memorySharedReviewBatchBarEl,
  memoryChunkTypeFilterEl,
  memoryChunkVisibilityFilterEl,
  memoryChunkGovernanceFilterEl,
  memoryChunkCategoryFilterEl,
  memorySharedReviewFiltersEl,
  memorySharedReviewFocusFilterEl,
  memorySharedReviewTargetFilterEl,
  memorySharedReviewClaimedByFilterEl,
  memorySharedReviewClearFiltersBtn,
  experienceWorkbenchSection,
  experienceWorkbenchTitleEl,
  experienceWorkbenchStatsEl,
  experienceWorkbenchTabCandidatesBtn,
  experienceWorkbenchTabCapabilityAcquisitionBtn,
  experienceWorkbenchTabUsageOverviewBtn,
  experienceWorkbenchCandidatesPaneEl,
  experienceWorkbenchCapabilityPaneEl,
  experienceWorkbenchCapabilityOverviewEl,
  experienceWorkbenchUsagePaneEl,
  experienceWorkbenchUsageOverviewEl,
  experienceWorkbenchQueryEl,
  experienceWorkbenchTypeFilterEl,
  experienceWorkbenchStatusFilterEl,
  experienceWorkbenchResetFiltersBtn,
  experienceWorkbenchCleanupConsumedBtn,
  experienceGenerateTaskIdEl,
  experienceGenerateMethodBtn,
  experienceGenerateSkillBtn,
  experienceWorkbenchListEl,
  experienceWorkbenchDetailEl,
  experienceWorkbenchRefreshBtn,
  experienceSynthesisModalEl,
  experienceSynthesisModalTitleEl,
  experienceSynthesisModalSummaryEl,
  experienceSynthesisModalStatusEl,
  experienceSynthesisModalListEl,
  experienceSynthesisModalCloseBtn,
  experienceSynthesisModalCancelBtn,
  experienceSynthesisModalSubmitBtn,
  experienceSynthesisModalConsumeSourcesEl,
  experienceSynthesisModalConsumeSourcesLabelEl,
  memoryDedupModalEl,
  memoryDedupModalTitleEl,
  memoryDedupModalSummaryEl,
  memoryDedupModalStatusEl,
  memoryDedupModalWarningEl,
  memoryDedupModalListEl,
  memoryDedupModalCloseBtn,
  memoryDedupModalCancelBtn,
  memoryDedupModalSubmitBtn,
  goalsSection,
  goalsSummaryEl,
  goalsListEl,
  goalsDetailEl,
  goalsRefreshBtn,
  subtasksSection,
  subtasksSummaryEl,
  subtasksListEl,
  subtasksDetailEl,
  subtasksShowArchivedEl,
  subtasksRefreshBtn,
  goalCreateBtn,
  goalCreateModal,
  goalCreateCloseBtn,
  goalCreateCancelBtn,
  goalCreateSubmitBtn,
  goalCreateTitleEl,
  goalCreateObjectiveEl,
  goalCreateRootEl,
  goalCreateAutoResumeEl,
  agentCreateModalEl,
  agentCreateModalTitleEl,
  agentCreateModalCloseBtn,
  agentCreateCancelBtn,
  agentCreateSubmitBtn,
  agentCreateIdEl,
  agentCreateDisplayNameEl,
  agentCreateModelEl,
  agentCreateSystemPromptEl,
  goalCheckpointActionModal,
  goalCheckpointActionTitleEl,
  goalCheckpointActionHintEl,
  goalCheckpointActionContextEl,
  goalCheckpointActionReviewerEl,
  goalCheckpointActionReviewerRoleEl,
  goalCheckpointActionRequestedByEl,
  goalCheckpointActionActorLabelEl,
  goalCheckpointActionActorEl,
  goalCheckpointActionSlaAtEl,
  goalCheckpointActionSummaryEl,
  goalCheckpointActionNoteLabelEl,
  goalCheckpointActionNoteHelpEl,
  goalCheckpointActionNoteEl,
  goalCheckpointActionCloseBtn,
  goalCheckpointActionCancelBtn,
  goalCheckpointActionSubmitBtn,
  taskTokenHistoryEl,
  sessionDigestSummaryEl,
  sessionContinuationSummaryEl,
  sessionDigestRefreshBtn,
  sessionDigestModalEl,
  sessionDigestModalTitleEl,
  sessionDigestModalMetaEl,
  sessionDigestModalActionsEl,
  sessionDigestModalContentEl,
  sessionDigestModalCloseBtn,
  tokenUsageEl,
  tokenUsageObservabilityEl,
  toggleContentPanelBtn,
  toggleControlPanelBtn,
  toggleAgentPanelBtn,
  restartOverlayEl,
  restartCountdownEl,
  restartReasonEl,
  tokenUsageValueEls,
  taskTokenUsagePanelEl,
  taskTokenValueEls,
  attachmentsPreviewEl,
  attachBtn,
  fileInput,
  saveWorkspaceRootsBtn,
  settingsModal,
  openSettingsBtn,
  closeSettingsBtn,
  saveSettingsBtn,
  restartBtn,
  recommendApiLink,
  aliyunOneKeyLink,
  officialHomeLink,
  workshopLink,
  cfgApiKey,
  cfgLocale,
  cfgBaseUrl,
  cfgModel,
  cfgModelPreferredProviders,
  refreshModelFallbackConfigBtn,
  modelFallbackConfigMeta,
  cfgModelFallbackContent,
  cfgExternalOutboundRequireConfirmation,
  cfgHeartbeat,
  cfgHeartbeatEnabled,
  cfgHeartbeatActiveHours,
  cfgBrowserRelayEnabled,
  cfgRelayPort,
  cfgMcpEnabled,
  cfgCronEnabled,
  cfgEmbeddingEnabled,
  cfgEmbeddingApiKey,
  cfgEmbeddingBaseUrl,
  cfgEmbeddingModel,
  cfgToolsEnabled,
  cfgAgentToolControlMode,
  cfgAgentToolControlConfirmPassword,
  cfgTtsEnabled,
  cfgTtsProvider,
  cfgTtsVoice,
  cfgTtsOpenAIBaseUrl,
  cfgTtsOpenAIApiKey,
  cfgDashScopeApiKey,
  cfgVoiceShortcut,
  cfgVoiceShortcutStatus,
  cfgVoiceShortcutDefault,
  cfgVoiceShortcutClear,
  cfgFacetAnchor,
  cfgInjectAgents,
  cfgInjectSoul,
  cfgInjectMemory,
  cfgMaxSystemPromptChars,
  cfgMaxHistory,
  cfgConversationKindMain,
  cfgConversationKindSubtask,
  cfgConversationKindGoal,
  cfgConversationKindHeartbeat,
  channelsSettingsSection,
  openCommunityConfigBtn,
  cfgCommunityApiEnabled,
  cfgCommunityApiToken,
  cfgEmailSmtpEnabled,
  cfgEmailImapEnabled,
  cfgFeishuAppId,
  cfgFeishuAppSecret,
  cfgFeishuAgentId,
  cfgQqAppId,
  cfgQqAppSecret,
  cfgQqAgentId,
  cfgQqSandbox,
  cfgDiscordEnabled,
  cfgDiscordBotToken,
  refreshChannelSecurityBtn,
  channelSecurityConfigMeta,
  cfgChannelSecurityContent,
  channelReplyChunkingConfigMeta,
  cfgChannelReplyChunkingContent,
  channelSecurityPendingList,
  doctorStatusEl,
  toolSettingsConfirmModal,
  toolSettingsConfirmImpactEl,
  toolSettingsConfirmSummaryEl,
  toolSettingsConfirmExpiryEl,
  toolSettingsConfirmApproveBtn,
  toolSettingsConfirmRejectBtn,
  externalOutboundConfirmModal,
  externalOutboundConfirmPreviewEl,
  externalOutboundConfirmTargetEl,
  externalOutboundConfirmExpiryEl,
  externalOutboundConfirmApproveBtn,
  externalOutboundConfirmRejectBtn,
  emailOutboundConfirmModal,
  emailOutboundConfirmPreviewEl,
  emailOutboundConfirmTargetEl,
  emailOutboundConfirmExpiryEl,
  emailOutboundConfirmApproveBtn,
  emailOutboundConfirmRejectBtn,
  toolSettingsModal,
  openToolSettingsBtn,
  closeToolSettingsBtn,
  saveToolSettingsBtn,
  toolSettingsBody,
  toolTabButtons,
} = APP_DOM_REFS;

let ws = null;
let isReady = false;
let activeConversationId = null;
let renderedConversationMessageState = {
  conversationId: null,
  keys: [],
};
const residentAgentRosterEnabled = window.BELLDANDY_WEB_CONFIG?.residentAgentRosterEnabled !== false;
const CONFIG_CACHE_TTL_MS = 2000;
let configCacheData = null;
let configCacheLoadedAt = 0;
let configCachePromise = null;
const taskTokenHistoryByConversation = new Map();
const TASK_TOKEN_HISTORY_LIMIT = 1;
let transientUrlToken = null;
const clientId = resolveClientId();
let queuedText = null;
let composerRunState = { phase: "idle", conversationId: "", runId: "" };

const webchatDebugEnabled = (() => {
  try {
    const stored = localStorage.getItem(WEBCHAT_DEBUG_KEY);
    if (stored === "1" || stored === "true") return true;
  } catch {
    // ignore
  }
  const flag = new URLSearchParams(window.location.search).get("debug");
  return flag === "1" || flag === "true";
})();

const webchatStartup = window.__SS_WEBCHAT_STARTUP__ || null;

function markWebchatStartup(stage, extra = {}) {
  const markFn = typeof webchatStartup?.mark === "function" ? webchatStartup.mark : null;
  if (markFn) {
    return markFn(stage, extra);
  }
  try {
    console.info("[WebChat startup]", stage, extra);
  } catch {
    // ignore console failures
  }
  return null;
}

const promptController = initPromptController({
  promptEl,
  onSubmit: () => handleComposerPrimaryAction(),
});

const localeController = createLocaleController({
  storageKey: "ss-webchat-locale",
  defaultLocale: "zh-CN",
  dictionaries: LOCALE_DICTIONARIES,
  localeMeta: LOCALE_META,
});

function isComposerRunVisible() {
  if (composerRunState.phase === "idle") return false;
  if (!activeConversationId) return true;
  return composerRunState.conversationId === activeConversationId;
}

function matchesComposerRunPayload(payload = {}) {
  if (composerRunState.phase === "idle") return false;
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  if (!conversationId || conversationId !== composerRunState.conversationId) {
    return false;
  }
  if (runId && composerRunState.runId && runId !== composerRunState.runId) {
    return false;
  }
  return true;
}

function setComposerRunState(nextState) {
  composerRunState = nextState;
  renderComposerPrimaryAction();
}

function clearComposerRunState() {
  composerRunState = { phase: "idle", conversationId: "", runId: "" };
  renderComposerPrimaryAction();
}

function renderComposerPrimaryAction() {
  if (!sendBtn) return;
  const socketReady = Boolean(ws && isReady);
  const runVisible = isComposerRunVisible();

  if (!runVisible || composerRunState.phase === "idle") {
    sendBtn.textContent = localeController.t("common.send", {}, "Send");
    sendBtn.disabled = !socketReady;
    return;
  }

  if (composerRunState.phase === "running") {
    sendBtn.textContent = localeController.t("subtasks.actionStop", {}, "Stop");
    sendBtn.disabled = !socketReady;
    return;
  }

  sendBtn.textContent = localeController.t("subtasks.actionStopping", {}, "Stopping...");
  sendBtn.disabled = true;
}

function bindComposerRun(payload = {}) {
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  if (!conversationId || !runId) return;
  setComposerRunState({
    phase: "running",
    conversationId,
    runId,
  });
}

function handleComposerRunFinal(payload = {}) {
  if (!matchesComposerRunPayload(payload)) return;
  clearComposerRunState();
}

function handleComposerRunStopped(payload = {}) {
  if (!matchesComposerRunPayload(payload)) return;
  clearComposerRunState();
}

function handleComposerAgentStatus(payload = {}) {
  if (!matchesComposerRunPayload(payload)) return;
  if (payload?.status === "error" || payload?.status === "stopped") {
    clearComposerRunState();
  } else {
    renderComposerPrimaryAction();
  }
}

async function requestActiveConversationRunStop() {
  if (composerRunState.phase !== "running") {
    return;
  }
  const nextState = {
    phase: "stop_requested",
    conversationId: composerRunState.conversationId,
    runId: composerRunState.runId,
  };
  setComposerRunState(nextState);

  try {
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "conversation.run.stop",
      params: {
        conversationId: nextState.conversationId,
        runId: nextState.runId,
        reason: "Stopped by user.",
      },
    });
    if (!res || res.ok === false) {
      setComposerRunState({
        phase: "running",
        conversationId: nextState.conversationId,
        runId: nextState.runId,
      });
      const message = res?.error?.message || localeController.t("settings.failed", {}, "Failed");
      showNotice?.(
        localeController.t("subtasks.stopFailedTitle", {}, "Stop failed"),
        message,
        "error",
        2600,
      );
      return;
    }
    if (!res.payload?.accepted) {
      clearComposerRunState();
    }
  } catch (error) {
    setComposerRunState({
      phase: "running",
      conversationId: nextState.conversationId,
      runId: nextState.runId,
    });
    showNotice?.(
      localeController.t("subtasks.stopFailedTitle", {}, "Stop failed"),
      error instanceof Error ? error.message : String(error),
      "error",
      2600,
    );
  }
}

function handleComposerPrimaryAction() {
  if (composerRunState.phase === "running" && isComposerRunVisible()) {
    void requestActiveConversationRunStop();
    return;
  }
  if (composerRunState.phase === "stop_requested" && isComposerRunVisible()) {
    return;
  }
  void sendMessage();
}

const themeController = createThemeController({
  storageKey: "ss-webchat-theme",
  defaultTheme: "dark",
  toggleButtonEl: themeToggleBtn,
  translate: localeController.t,
});
const panelVisibilityFeature = createPanelVisibilityFeature({
  refs: {
    tokenUsageEl,
    sidebarEl,
    toggleContentPanelBtn,
    controlPanelEl,
    toggleControlPanelBtn,
    agentRightPanelEl,
    toggleAgentPanelBtn,
  },
  storageKeys: {
    tokenUsageCollapsedKey: TOKEN_USAGE_COLLAPSED_KEY,
    contentPanelVisibleKey: CONTENT_PANEL_VISIBLE_KEY,
    controlPanelVisibleKey: CONTROL_PANEL_VISIBLE_KEY,
    agentPanelVisibleKey: AGENT_PANEL_VISIBLE_KEY,
  },
  defaults: {
    tokenUsageCollapsed: true,
    contentPanelVisible: false,
    controlPanelVisible: false,
    agentPanelVisible: false,
  },
  onContentPanelVisibleChange: (visible) => workspaceFeature?.handleSidebarVisibilityChange?.(visible),
  t: localeController.t,
});

let attachmentsFeature = null;
let agentRuntimeFeature = null;
const agentSessionCacheFeature = createAgentSessionCacheFeature();
let workspaceFeature = null;
let chatEventsFeature = null;
let chatNetworkFeature = null;
let chatUiFeature = null;
let canvasContextFeature = null;
let goalsCapabilityPanelFeature = null;
let goalsActionsRuntimeFeature = null;
let goalsDetailFeature = null;
let goalsGovernancePanelFeature = null;
let goalsOverviewFeature = null;
let goalsReadonlyPanelsFeature = null;
let goalsSpecialistPanelsFeature = null;
let goalsStateRuntimeFeature = null;
let goalsRuntimeFeature = null;
let goalsTrackingPanelFeature = null;
let memoryDetailRenderFeature = null;
let memoryRuntimeFeature = null;
let memoryViewerFeature = null;
let experienceWorkbenchFeature = null;
let emailInboundSessionBannerFeature = null;
let sessionDigestFeature = null;
let settingsRuntimeFeature = null;
let subtasksOverviewFeature = null;
let subtasksRuntimeFeature = null;
let sessionNavigationFeature = null;

function debugLog(...args) {
  if (!webchatDebugEnabled) return;
  console.debug(...args);
}

markWebchatStartup("app.module.evaluated", {
  debugEnabled: webchatDebugEnabled,
});

const appShellFeature = createAppShellFeature({
  refs: {
    switchRootBtn,
    switchFacetBtn,
    switchCronBtn,
    switchMemoryBtn,
    switchExperienceBtn,
    switchGoalsBtn,
    switchSubtasksBtn,
    switchCanvasBtn,
    chatSection,
    editorSection,
    memoryViewerSection,
    experienceWorkbenchSection,
    goalsSection,
    subtasksSection,
    composerSection,
    editorActions,
  },
  getTreeMode: () => workspaceFeature?.getTreeMode() ?? "root",
  subtasksState,
  reopenLinkedSession: (sessionId) => sessionNavigationFeature?.openConversationSession(sessionId, "", {
    switchToChat: false,
    renderHint: false,
  }),
  renderCanvasGoalContext: () => renderCanvasGoalContext(),
});
const showNotice = (...args) => appShellFeature.showNotice(...args);
const switchMode = (...args) => appShellFeature.switchMode(...args);
const updateSidebarModeButtons = (...args) => appShellFeature.updateSidebarModeButtons(...args);
createHeaderNavigationFeature({
  refs: {
    openWebChatTabLink,
    goGoalsPageBtn,
    goChatPageBtn,
  },
  switchMode,
  loadGoals: (forceReload = false) => loadGoals(forceReload),
  focusPrompt: () => promptEl?.focus(),
  buildMultiPageUrl: () => createSessionAuthHandoffUrl({
    currentUrl: window.location.href,
    authMode: authModeEl?.value || "",
    authValue: authValueEl?.value || "",
  }),
});

sessionNavigationFeature = createSessionNavigationFeature({
  refs: {
    messagesEl,
  },
  setActiveConversationId: (conversationId) => {
    activeConversationId = conversationId;
    renderComposerPrimaryAction();
  },
  getActiveConversationId: () => activeConversationId,
  renderCanvasGoalContext: () => renderCanvasGoalContext(),
  switchMode,
  getChatEventsFeature: () => chatEventsFeature,
  loadConversationMeta: (conversationId, options) => loadConversationMeta(conversationId, options),
  getSessionDigestFeature: () => sessionDigestFeature,
  t: localeController.t,
});
const openConversationSession = (...args) => sessionNavigationFeature.openConversationSession(...args);

emailInboundSessionBannerFeature = createEmailInboundSessionBannerFeature({
  sendReq: (...args) => sendReq(...args),
  t: localeController.t,
});

const voiceFeature = createVoiceFeature({
  storageKey: VOICE_SHORTCUT_KEY,
  disabledValue: VOICE_SHORTCUT_DISABLED_VALUE,
  defaultShortcut: DEFAULT_VOICE_SHORTCUT,
  promptEl,
  composerSection,
  voiceButtonEl: voiceBtn,
  voiceDurationEl,
  getIsSettingsOpen: () => Boolean(settingsModal && !settingsModal.classList.contains("hidden")),
  syncPromptHeight: () => promptController.syncHeight(),
  estimateDataUrlBytes,
  estimatePendingAttachmentTotalBytes: () => attachmentsFeature?.estimatePendingAttachmentTotalBytes() ?? 0,
  getAttachmentLimits: () => attachmentsFeature?.getAttachmentLimits() ?? {
    maxFileBytes: DEFAULT_ATTACHMENT_MAX_FILE_BYTES,
    maxTotalBytes: DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES,
  },
  formatBytes,
  addAttachment: (attachment) => {
    attachmentsFeature?.addAttachment(attachment);
  },
  renderAttachmentsPreview: (hintMessage) => {
    attachmentsFeature?.renderAttachmentsPreview(hintMessage);
  },
  onSendMessage: () => handleComposerPrimaryAction(),
  t: localeController.t,
  getSpeechRecognitionLocale: () => localeController.getSpeechRecognitionLocale(),
});

localeController.subscribe(() => {
  themeController.refreshLabels?.();
  panelVisibilityFeature.refreshLocale?.();
  voiceFeature.refreshLocale?.();
  chatNetworkFeature?.refreshLocale?.();
  workspaceFeature?.refreshLocale?.();
  canvasContextFeature?.refreshLocale?.();
  window._canvasApp?.refreshLocale?.();
  settingsRuntimeFeature?.refreshLocale?.();
  refreshGoalsLocale();
  refreshMemoryLocale();
  memoryViewerFeature?.syncMemoryViewerHeaderTitle?.();
  sessionDigestFeature?.refreshLocale?.();
  refreshSubtasksLocale();
  agentRuntimeFeature?.refreshLocale?.();
  syncSaveWorkspaceRootsButton();
  renderTaskTokenHistory();
  renderComposerPrimaryAction();
});

// 身份信息（从 hello-ok 获取）
let userName = "User";
let userAvatar = "👤";
const agentCatalog = new Map();
const DEFAULT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const IMAGE_COMPRESS_TRIGGER_BYTES = 800 * 1024;
const IMAGE_COMPRESS_TARGET_BYTES = 1200 * 1024;
const IMAGE_COMPRESS_MAX_EDGE = 2048;
const IMAGE_COMPRESS_RESIZE_FACTOR = 0.85;
const IMAGE_COMPRESS_QUALITIES = [0.86, 0.78, 0.7, 0.62, 0.54];
attachmentsFeature = createAttachmentsFeature({
  refs: {
    attachmentsPreviewEl,
    attachBtn,
    fileInput,
    composerSection,
    promptEl,
  },
  defaultLimits: {
    maxFileBytes: DEFAULT_ATTACHMENT_MAX_FILE_BYTES,
    maxTotalBytes: DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES,
  },
  imageCompression: {
    triggerBytes: IMAGE_COMPRESS_TRIGGER_BYTES,
    targetBytes: IMAGE_COMPRESS_TARGET_BYTES,
    maxEdge: IMAGE_COMPRESS_MAX_EDGE,
    resizeFactor: IMAGE_COMPRESS_RESIZE_FACTOR,
    qualities: IMAGE_COMPRESS_QUALITIES,
  },
  estimateDataUrlBytes,
  formatBytes,
  t: localeController.t,
});

workspaceFeature = createWorkspaceFeature({
  refs: {
    sidebarEl,
    sidebarTitleEl,
    fileTreeEl,
    refreshTreeBtn,
    editorPathEl: editorPath,
    editorModeBadgeEl: editorModeBadge,
    editorTextareaEl: editorTextarea,
    cancelEditBtn,
    saveEditBtn,
    openEnvEditorBtn,
    switchRootBtn,
    switchFacetBtn,
    switchCronBtn,
    workspaceRootsEl,
  },
  keys: {
    workspaceRootsKey: WORKSPACE_ROOTS_KEY,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  switchMode: (mode) => switchMode(mode),
  showNotice,
  escapeHtml,
  loadServerConfig,
  syncAttachmentLimitsFromConfig,
  persistWorkspaceRootsField,
  t: localeController.t,
});
workspaceFeature.handleSidebarVisibilityChange?.(panelVisibilityFeature.getState().contentPanelVisible);

restoreAuthFields({ storeKey: STORE_KEY, authModeEl, authValueEl });
restoreSessionAuthToken({ sessionStoreKey: SESSION_AUTH_TOKEN_KEY, authModeEl, authValueEl });
const handedOffAuth = consumeSessionAuthHandoff();
if (handedOffAuth?.mode === "token" && handedOffAuth.value) {
  authModeEl.value = "token";
  authValueEl.value = handedOffAuth.value;
  transientUrlToken = handedOffAuth.value;
  persistSessionAuthToken({ sessionStoreKey: SESSION_AUTH_TOKEN_KEY, authModeEl, authValueEl });
}
restoreWorkspaceRootsField({ workspaceRootsKey: WORKSPACE_ROOTS_KEY, workspaceRootsEl });
restoreUuidField({ uuidKey: UUID_KEY, userUuidEl });

// 监听 UUID 保存按钮
if (saveUuidBtn && userUuidEl) {
  saveUuidBtn.addEventListener("click", () => {
    const uuid = userUuidEl.value.trim();
    debugLog("[UUID] Saving UUID", { hasUuid: Boolean(uuid) });
    persistUuidField({ uuidKey: UUID_KEY, userUuidEl });
    // 如果 WebSocket 已连接，重新连接以更新 UUID
    if (ws && isReady) {
      debugLog("[UUID] UUID changed, reconnecting");
      teardown();
      setTimeout(() => connect(), 100);
    } else {
      debugLog("[UUID] WebSocket not connected, will use UUID on next connect");
    }
  });
}

// 监听 UUID 输入框的变化，自动保存并重新连接（备用方案）
if (userUuidEl) {
  userUuidEl.addEventListener("blur", () => {
    persistUuidField({ uuidKey: UUID_KEY, userUuidEl });
    // 如果 WebSocket 已连接，重新连接以更新 UUID
    if (ws && isReady) {
      debugLog("[UUID] UUID changed (blur), reconnecting");
      teardown();
      setTimeout(() => connect(), 100);
    }
  });
}

// [NEW] Allow ?token=... param to override/set auth
const urlToken = consumeUrlTokenParam();
if (urlToken) {
  authModeEl.value = "token";
  authValueEl.value = urlToken;
  transientUrlToken = urlToken;
  persistSessionAuthToken({ sessionStoreKey: SESSION_AUTH_TOKEN_KEY, authModeEl, authValueEl });
}

setStatus(localeController.t("status.disconnected", {}, "disconnected"));
attachmentsFeature.renderAttachmentsPreview();
markWebchatStartup("app.bootstrap.ready", {
  hasTransientUrlToken: Boolean(transientUrlToken),
});

connectBtn.addEventListener("click", () => connect());
sendBtn.addEventListener("click", () => handleComposerPrimaryAction());
if (memoryViewerRefreshBtn) {
  memoryViewerRefreshBtn.addEventListener("click", () => loadMemoryViewer(true));
}
if (experienceWorkbenchRefreshBtn) {
  experienceWorkbenchRefreshBtn.addEventListener("click", () => loadExperienceWorkbench(true));
}
if (memoryDreamRefreshBtn) {
  memoryDreamRefreshBtn.addEventListener("click", () => {
    void memoryViewerFeature?.loadDreamRuntimeStatus?.();
    void memoryViewerFeature?.loadDreamCommonsStatus?.();
  });
}
if (memoryDreamRunBtn) {
  memoryDreamRunBtn.addEventListener("click", () => {
    void memoryViewerFeature?.runDream?.();
  });
}
if (memoryDreamHistoryToggleBtn) {
  memoryDreamHistoryToggleBtn.addEventListener("click", () => {
    memoryViewerFeature?.toggleDreamHistory?.();
  });
}
if (memoryDreamHistoryRefreshBtn) {
  memoryDreamHistoryRefreshBtn.addEventListener("click", () => {
    void memoryViewerFeature?.loadDreamHistory?.(false);
  });
}
if (memoryTabTasksBtn) {
  memoryTabTasksBtn.addEventListener("click", () => switchMemoryViewerTab("tasks"));
}
if (memoryTabMemoriesBtn) {
  memoryTabMemoriesBtn.addEventListener("click", () => switchMemoryViewerTab("memories"));
}
if (memoryTabSharedReviewBtn) {
  memoryTabSharedReviewBtn.addEventListener("click", () => switchMemoryViewerTab("sharedReview"));
}
if (memoryTabOutboundAuditBtn) {
  memoryTabOutboundAuditBtn.addEventListener("click", () => switchMemoryViewerTab("outboundAudit"));
}
if (memoryOutboundAuditFocusAllBtn) {
  memoryOutboundAuditFocusAllBtn.addEventListener("click", () => memoryViewerFeature?.switchOutboundAuditFocus("all"));
}
if (memoryOutboundAuditFocusThreadsBtn) {
  memoryOutboundAuditFocusThreadsBtn.addEventListener("click", () => memoryViewerFeature?.switchOutboundAuditFocus("threads"));
}
if (memorySearchBtn) {
  memorySearchBtn.addEventListener("click", () => loadMemoryViewer(true));
}
if (memoryDedupPreviewBtn) {
  memoryDedupPreviewBtn.addEventListener("click", () => {
    void memoryViewerFeature?.openDedupModal?.();
  });
}
if (goalsRefreshBtn) {
  goalsRefreshBtn.addEventListener("click", () => loadGoals(true));
}
if (subtasksRefreshBtn) {
  subtasksRefreshBtn.addEventListener("click", () => loadSubtasks(true));
}
if (subtasksShowArchivedEl) {
  subtasksShowArchivedEl.checked = subtasksState.includeArchived === true;
  subtasksShowArchivedEl.addEventListener("change", () => {
    subtasksState.includeArchived = subtasksShowArchivedEl.checked === true;
    void loadSubtasks(true);
  });
}
if (goalCreateBtn) {
  goalCreateBtn.addEventListener("click", () => {
    toggleGoalCreateModal(true);
  });
}
if (goalCreateCloseBtn) {
  goalCreateCloseBtn.addEventListener("click", () => toggleGoalCreateModal(false));
}
if (goalCreateCancelBtn) {
  goalCreateCancelBtn.addEventListener("click", () => toggleGoalCreateModal(false));
}
if (goalCreateSubmitBtn) {
  goalCreateSubmitBtn.addEventListener("click", () => {
    void submitGoalCreateForm();
  });
}
if (goalCheckpointActionCloseBtn) {
  goalCheckpointActionCloseBtn.addEventListener("click", () => toggleGoalCheckpointActionModal(false));
}
if (goalCheckpointActionCancelBtn) {
  goalCheckpointActionCancelBtn.addEventListener("click", () => toggleGoalCheckpointActionModal(false));
}
if (memoryTaskGoalFilterClearBtn) {
  memoryTaskGoalFilterClearBtn.addEventListener("click", () => {
    void clearMemoryTaskGoalFilter();
  });
}
if (memorySearchInputEl) {
  memorySearchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadMemoryViewer(true);
    }
  });
}
if (memoryTaskStatusFilterEl) {
  memoryTaskStatusFilterEl.addEventListener("change", () => {
    if (memoryViewerState.tab === "tasks") loadMemoryViewer(true);
  });
}
if (memoryTaskSourceFilterEl) {
  memoryTaskSourceFilterEl.addEventListener("change", () => {
    if (memoryViewerState.tab === "tasks") loadMemoryViewer(true);
  });
}
if (memoryChunkTypeFilterEl) {
  memoryChunkTypeFilterEl.addEventListener("change", () => {
    if (memoryViewerState.tab === "memories") loadMemoryViewer(true);
  });
}
if (memoryChunkVisibilityFilterEl) {
  memoryChunkVisibilityFilterEl.addEventListener("change", () => {
    if (memoryViewerState.tab === "memories") loadMemoryViewer(true);
  });
}
if (memoryChunkGovernanceFilterEl) {
  memoryChunkGovernanceFilterEl.addEventListener("change", () => {
    if (memoryViewerState.tab === "memories" || memoryViewerState.tab === "sharedReview") loadMemoryViewer(true);
  });
}
if (memoryChunkCategoryFilterEl) {
  memoryChunkCategoryFilterEl.addEventListener("change", () => {
    if (memoryViewerState.tab === "memories") loadMemoryViewer(true);
  });
}
if (memorySharedReviewFocusFilterEl) {
  memorySharedReviewFocusFilterEl.addEventListener("change", () => {
    const next = String(memorySharedReviewFocusFilterEl.value || "").trim();
    memoryViewerState.sharedReviewFilters = {
      ...createDefaultSharedReviewFilters(),
      ...memoryViewerState.sharedReviewFilters,
      focus: next === "actionable" || next === "mine" ? next : "",
      claimedByAgentId: "",
    };
    memoryViewerFeature?.syncSharedReviewFilterUi?.();
    if (memoryViewerState.tab === "sharedReview") loadMemoryViewer(true);
  });
}
if (memorySharedReviewTargetFilterEl) {
  memorySharedReviewTargetFilterEl.addEventListener("change", () => {
    memoryViewerState.sharedReviewFilters = {
      ...createDefaultSharedReviewFilters(),
      ...memoryViewerState.sharedReviewFilters,
      targetAgentId: String(memorySharedReviewTargetFilterEl.value || "").trim(),
    };
    if (memoryViewerState.tab === "sharedReview") loadMemoryViewer(true);
  });
}
if (memorySharedReviewClaimedByFilterEl) {
  memorySharedReviewClaimedByFilterEl.addEventListener("change", () => {
    memoryViewerState.sharedReviewFilters = {
      ...createDefaultSharedReviewFilters(),
      ...memoryViewerState.sharedReviewFilters,
      focus: "",
      claimedByAgentId: String(memorySharedReviewClaimedByFilterEl.value || "").trim(),
    };
    memoryViewerFeature?.syncSharedReviewFilterUi?.();
    if (memoryViewerState.tab === "sharedReview") loadMemoryViewer(true);
  });
}
if (memorySharedReviewClearFiltersBtn) {
  memorySharedReviewClearFiltersBtn.addEventListener("click", () => {
    memoryViewerState.sharedReviewFilters = createDefaultSharedReviewFilters();
    memoryViewerFeature?.syncSharedReviewFilterUi?.();
    if (memoryViewerState.tab === "sharedReview") loadMemoryViewer(true);
  });
}
document.addEventListener("keydown", (event) => {
  voiceFeature.handleGlobalKeydown(event);
});

function setStatus(text) {
  statusEl.textContent = text;
  // Clear error hint if exists (it will be re-added by close handler if needed)
  const hint = document.getElementById("status-hint");
  if (hint) hint.remove();
}

function invalidateServerConfigCache() {
  configCacheData = null;
  configCacheLoadedAt = 0;
  configCachePromise = null;
}

async function loadServerConfig(options = {}) {
  const { force = false } = options;
  if (!ws || !isReady) return null;

  const now = Date.now();
  if (!force && configCacheData && now - configCacheLoadedAt < CONFIG_CACHE_TTL_MS) {
    return configCacheData;
  }
  if (!force && configCachePromise) {
    return configCachePromise;
  }

  const promise = (async () => {
    const res = await sendReq({ type: "req", id: makeId(), method: "config.read" });
    if (res?.ok === false && res.error?.code === "pairing_required") {
      const message = typeof res.error?.message === "string" ? res.error.message : "Pairing required.";
      const codeMatch = message.match(/Code:\s*([A-Z0-9-]+)/i);
      settingsRuntimeFeature?.handlePairingRequired?.({
        code: codeMatch ? codeMatch[1] : "",
        message,
      });
      return null;
    }
    if (!(res && res.ok && res.payload && res.payload.config)) {
      return null;
    }
    configCacheData = res.payload.config;
    configCacheLoadedAt = Date.now();
    return configCacheData;
  })();

  configCachePromise = promise;
  try {
    return await promise;
  } finally {
    if (configCachePromise === promise) {
      configCachePromise = null;
    }
  }
}

async function syncWorkspaceRoots() {
  if (!ws || !isReady || !workspaceRootsEl) return;
  const value = workspaceRootsEl.value.trim();
  if (!value) return;

  persistWorkspaceRootsField({ workspaceRootsKey: WORKSPACE_ROOTS_KEY, workspaceRootsEl });
  const id = makeId();
  await sendReq({
    type: "req",
    id,
    method: "config.update",
    params: { updates: { "BELLDANDY_EXTRA_WORKSPACE_ROOTS": value } }
  });
  invalidateServerConfigCache();
}

function syncAttachmentLimitsFromConfig(config) {
  attachmentsFeature?.syncLimitsFromConfig(config);
}

// 从服务器加载可操作区配置值
async function loadWorkspaceRootsFromServer() {
  return workspaceFeature?.loadWorkspaceRootsFromServer();
}

function handleHelloOk(frame) {
  invalidateServerConfigCache();
  agentRuntimeFeature?.applyHelloIdentity(frame);
  if (frame.userName) userName = frame.userName;
  if (frame.userAvatar) userAvatar = frame.userAvatar;
  chatUiFeature?.refreshAvatar("me", userAvatar);

  sessionTotalTokens = 0;
  costBudgetTracker.reset();
  taskTokenHistoryByConversation.clear();
  Object.values(tokenUsageValueEls).forEach((el) => {
    if (el) el.textContent = "--";
  });
  updateTokenUsageObservability(tokenUsageObservabilityEl, null, localeController.t.bind(localeController));
  renderTaskTokenHistory();
  if (activeConversationId) {
    void loadConversationMeta(activeConversationId);
    void sessionDigestFeature?.loadSessionDigest(activeConversationId);
  } else {
    sessionDigestFeature?.clear?.();
  }
  flushQueuedText();

  if (frame.configOk === false) {
    setTimeout(() => {
      if (settingsRuntimeFeature?.hasPendingPairing?.()) {
        void settingsRuntimeFeature.openPairingPending?.({ skipLoad: true });
      } else {
        toggleSettings(true);
      }
      const guideMsg = appendMessage("bot", "👋 欢迎使用 Star Sanctuary！\n\n检测到默认模型配置尚未完成。请继续使用当前设置弹窗补齐 API Key 与默认模型，然后点击 Save 保存。");
      if (guideMsg) guideMsg.style.whiteSpace = "pre-wrap";
    }, 500);
  }

  if (restartOverlayEl) restartOverlayEl.classList.add("hidden");

  workspaceFeature?.refreshAfterConnectionReady();
  loadWorkspaceRootsFromServer();
  void loadServerConfig().then((config) => {
    if (config) {
      syncAttachmentLimitsFromConfig(config);
    }
  });
  void loadAgentList().then((agents) => {
    void agentRuntimeFeature?.activatePreferredResidentAgent(agents);
  });
  void loadModelList();

  if (memoryViewerSection && !memoryViewerSection.classList.contains("hidden")) {
    loadMemoryViewer(true);
  }
  if (goalsSection && !goalsSection.classList.contains("hidden")) {
    loadGoals(true);
  }
  if (subtasksSection && !subtasksSection.classList.contains("hidden")) {
    loadSubtasks(true);
  }

  if (!sessionStorage.getItem("booted")) {
    playBootSequence();
    sessionStorage.setItem("booted", "true");
  }
}

function getHttpAuthHeaders() {
  const mode = authModeEl?.value || "none";
  const rawValue = authValueEl?.value.trim() || "";
  if (mode === "token" && rawValue) {
    const token = rawValue.startsWith("setup-") || !/^\d+-\d+$/.test(rawValue)
      ? rawValue
      : `setup-${rawValue}`;
    return {
      Authorization: `Bearer ${token}`,
    };
  }
  if (mode === "password" && rawValue) {
    return {
      "x-belldandy-password": rawValue,
    };
  }
  return {};
}

chatNetworkFeature = createChatNetworkFeature({
  refs: {
    statusEl,
    sendBtn,
    authModeEl,
    authValueEl,
    workspaceRootsEl,
    userUuidEl,
    agentSelectEl,
    modelPickerEl,
    modelFilterEl,
    modelSelectEl,
  },
  keys: {
    storeKey: STORE_KEY,
    workspaceRootsKey: WORKSPACE_ROOTS_KEY,
    uuidKey: UUID_KEY,
    agentIdKey: AGENT_ID_KEY,
    modelIdKey: MODEL_ID_KEY,
    clientId,
  },
  getTransientUrlToken: () => transientUrlToken,
  getSocket: () => ws,
  setSocket: (socket) => {
    ws = socket;
  },
  getReady: () => isReady,
  setReady: (ready) => {
    isReady = ready;
  },
  persistConnectionFields,
  setStatus,
  safeJsonParse,
  makeId,
  debugLog,
  onHelloOk: (frame) => handleHelloOk(frame),
  onAgentListLoaded: (agents, selectedAgentId) => syncAgentCatalog(agents, selectedAgentId),
  onEvent: (event, payload) => handleEvent(event, payload),
  onConnectionStateChanged: ({ ready }) => {
    if (!ready) {
      clearComposerRunState();
    } else {
      renderComposerPrimaryAction();
    }
  },
  t: localeController.t,
});

canvasContextFeature = createCanvasContextFeature({
  refs: {
    canvasContextBarEl,
  },
  getCanvasApp: () => window._canvasApp,
  getGoalsState: () => goalsState,
  getActiveConversationId: () => activeConversationId,
  getGoalById,
  normalizeGoalBoardId,
  getCachedGoalCapabilityEntry,
  goalRuntimeFilePath,
  escapeHtml,
  ensureGoalCapabilityCache,
  switchMode,
  loadGoals,
  openGoalTaskViewer,
  openConversationSession,
  openSourcePath,
  showNotice,
  getGoalDisplayName,
  t: localeController.t,
});

chatUiFeature = createChatUiFeature({
  refs: {
    messagesEl,
    chatSection,
  },
  getAgentProfile: () => agentRuntimeFeature?.getAgentProfile() || { name: "Agent", avatar: "🤖" },
  getUserProfile: () => ({
    name: userName,
    avatar: userAvatar,
  }),
  getCurrentAgentId: () => getCurrentAgentSelection(),
  revealGeneratedArtifactPath: async (artifactPath) => {
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "artifact.reveal",
      params: {
        path: artifactPath,
      },
    });
    if (!res || res.ok === false) {
      throw new Error(res?.error?.message || localeController.t("settings.failed", {}, "Failed"));
    }
  },
  escapeHtml,
  showNotice,
  getAvatarUploadHeaders: () => getHttpAuthHeaders(),
  onAvatarUploaded: ({ role, agentId, avatarPath }) => applyUploadedAvatarChange({ role, agentId, avatarPath }),
  t: localeController.t,
});

chatUiFeature.initCopyButtonDelegation();

goalsStateRuntimeFeature = createGoalsStateRuntimeFeature({
  refs: {
    goalsSection,
  },
  getGoalsState: () => goalsState,
  getGoalsOverviewFeature: () => goalsOverviewFeature,
  getGoalsDetailFeature: () => goalsDetailFeature,
  renderCanvasGoalContext,
  loadGoalTrackingData: (goal) => loadGoalTrackingData(goal),
  loadGoalProgressData: (goal) => loadGoalProgressData(goal),
  loadGoalHandoffData: (goal) => loadGoalHandoffData(goal),
  loadGoalCapabilityData: (goal) => loadGoalCapabilityData(goal),
  loadGoalReviewGovernanceData: (goal) => loadGoalReviewGovernanceData(goal),
  loadGoalCanvasData: (goal) => loadGoalCanvasData(goal),
});

goalsOverviewFeature = createGoalsOverviewFeature({
  refs: {
    goalsSection,
    goalsSummaryEl,
    goalsListEl,
    goalsDetailEl,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getGoalsState: () => goalsState,
  getActiveConversationId: () => activeConversationId,
  isConversationForGoal,
  escapeHtml,
  formatGoalStatus,
  formatDateTime,
  summarizeSourcePath,
  formatGoalPathSource,
  sortGoals: (items) => goalsStateRuntimeFeature?.sortGoals(items) || [],
  getGoalById: (goalId) => goalsStateRuntimeFeature?.getGoalById(goalId) || null,
  renderGoalDetail,
  renderCanvasGoalContext,
  onResumeGoal: (goalId) => resumeGoal(goalId),
  onPauseGoal: (goalId) => pauseGoal(goalId),
  t: localeController.t,
});

subtasksOverviewFeature = createSubtasksOverviewFeature({
  refs: {
    subtasksSection,
    subtasksSummaryEl,
    subtasksListEl,
    subtasksDetailEl,
  },
  isConnected: () => Boolean(ws && isReady),
  isViewActive: () => Boolean(subtasksSection && !subtasksSection.classList.contains("hidden")),
  sendReq,
  makeId,
  getSubtasksState: () => subtasksState,
  getActiveConversationId: () => activeConversationId,
  escapeHtml,
  formatDateTime,
  summarizeSourcePath,
  onOpenSourcePath: (sourcePath) => openSourcePath(sourcePath),
  onOpenTask: (taskId) => openTaskFromAudit(taskId),
  onOpenGoal: async (goalId) => {
    switchMode("goals");
    await loadGoals(true, goalId);
  },
  onOpenContinuationAction: (action) => openContinuationAction(action),
  getSelectedAgentId: () => getCurrentAgentSelection(),
  showNotice,
  t: localeController.t,
});

subtasksRuntimeFeature = createSubtasksRuntimeFeature({
  refs: {
    subtasksSection,
    subtasksListEl,
    subtasksDetailEl,
    subtasksShowArchivedEl,
  },
  getSubtasksState: () => subtasksState,
  getSubtasksOverviewFeature: () => subtasksOverviewFeature,
  switchMode,
  openConversationSession,
  t: localeController.t,
});

goalsDetailFeature = createGoalsDetailFeature({
  refs: {
    goalsDetailEl,
  },
  getActiveConversationId: () => activeConversationId,
  isConversationForGoal,
  escapeHtml,
  formatGoalStatus,
  formatDateTime,
  formatGoalPathSource,
  goalDocFilePath,
  goalRuntimeFilePath,
  goalBaseConversationId,
  onBindDetailActions: (goal) => bindGoalDetailActions(goal),
  onLoadGoalCanvasData: (goal) => {
    void loadGoalCanvasData(goal);
  },
  onLoadGoalTrackingData: (goal) => {
    void loadGoalTrackingData(goal);
  },
  onLoadGoalCapabilityData: (goal) => {
    void loadGoalCapabilityData(goal);
  },
  onLoadGoalProgressData: (goal) => {
    void loadGoalProgressData(goal);
  },
  onLoadGoalHandoffData: (goal) => {
    void loadGoalHandoffData(goal);
  },
  onLoadGoalReviewGovernanceData: (goal) => {
    void loadGoalReviewGovernanceData(goal);
  },
  t: localeController.t,
});

goalsReadonlyPanelsFeature = createGoalsReadonlyPanelsFeature({
  refs: {
    goalsDetailEl,
  },
  escapeHtml,
  formatDateTime,
  normalizeGoalBoardId,
  goalRuntimeFilePath,
  onBindHandoffPanelActions: (goal) => bindGoalHandoffPanelActions(goal),
  t: localeController.t,
});

goalsTrackingPanelFeature = createGoalsTrackingPanelFeature({
  refs: {
    goalsDetailEl,
  },
  escapeHtml,
  formatDateTime,
  getGoalCheckpointSlaBadge,
  summarizeSourcePath,
  t: localeController.t,
});

goalsGovernancePanelFeature = createGoalsGovernancePanelFeature({
  refs: {
    goalsDetailEl,
  },
  escapeHtml,
  formatDateTime,
  goalRuntimeFilePath,
  t: localeController.t,
});

goalsCapabilityPanelFeature = createGoalsCapabilityPanelFeature({
  refs: {
    goalsDetailEl,
  },
  escapeHtml,
  formatDateTime,
  onOpenSourcePath: (sourcePath) => openSourcePath(sourcePath),
  onOpenSubtask: (taskId) => openSubtaskById(taskId),
  onSaveGovernanceSettings: (goalId, nodeId, input) => saveGoalCapabilityGovernance(goalId, nodeId, input),
  onCommanderDecision: (goalId, nodeId, input) => runGoalCommanderDecision(goalId, nodeId, input),
  t: localeController.t,
});

goalsActionsRuntimeFeature = createGoalsActionsRuntimeFeature({
  refs: {
    goalCreateModal,
    goalCreateTitleEl,
    goalCreateObjectiveEl,
    goalCreateRootEl,
    goalCreateAutoResumeEl,
    goalCreateSubmitBtn,
    goalCheckpointActionModal,
    goalCheckpointActionSummaryEl,
    goalCheckpointActionNoteEl,
    goalCheckpointActionSubmitBtn,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getGoalById: (goalId) => goalsStateRuntimeFeature?.getGoalById(goalId) || null,
  loadGoals: (forceReload = false, preferredGoalId) => loadGoals(forceReload, preferredGoalId),
  goalBaseConversationId,
  openConversationSession,
  isConversationForGoal,
  getActiveConversationId: () => activeConversationId,
  setActiveConversationId: (conversationId) => {
    activeConversationId = conversationId;
    renderComposerPrimaryAction();
  },
  renderCanvasGoalContext,
  getChatEventsFeature: () => chatEventsFeature,
  loadGoalHandoffData: (goal) => loadGoalHandoffData(goal),
  loadGoalReviewGovernanceData: (goal) => loadGoalReviewGovernanceData(goal),
  loadGoalTrackingData: (goal) => loadGoalTrackingData(goal),
  loadGoalCapabilityData: (goal) => loadGoalCapabilityData(goal),
  getGoalsRuntimeFeature: () => goalsRuntimeFeature,
  getGoalActionActor: () => getGoalActionActor(),
  showNotice,
  t: localeController.t,
});
goalsActionsRuntimeFeature.bindUi();

goalsSpecialistPanelsFeature = createGoalsSpecialistPanelsRuntimeFeature({
  refs: {
    goalsDetailEl,
  },
  getGoalsState: () => goalsState,
  getGoalsCapabilityPanelFeature: () => goalsCapabilityPanelFeature,
  getGoalsReadonlyPanelsFeature: () => goalsReadonlyPanelsFeature,
  getGoalsTrackingPanelFeature: () => goalsTrackingPanelFeature,
  getGoalsGovernancePanelFeature: () => goalsGovernancePanelFeature,
  readSourceFile,
  goalRuntimeFilePath,
  safeJsonParse,
  sendReq,
  makeId,
  getCanvasContextFeature: () => canvasContextFeature,
  openSourcePath: (sourcePath) => openSourcePath(sourcePath),
  openContinuationAction: (action) => openContinuationAction(action),
  generateGoalHandoff: (goalId) => generateGoalHandoff(goalId),
  runGoalApprovalScan: (goalId, options = {}) => runGoalApprovalScan(goalId, options),
  saveGoalCapabilityGovernance: (goalId, nodeId, input) => saveGoalCapabilityGovernance(goalId, nodeId, input),
  runGoalCommanderDecision: (goalId, nodeId, input) => runGoalCommanderDecision(goalId, nodeId, input),
  runGoalSuggestionReviewDecision: (goalId, options = {}) => runGoalSuggestionReviewDecision(goalId, options),
  runGoalSuggestionReviewEscalation: (goalId, options = {}) => runGoalSuggestionReviewEscalation(goalId, options),
  runGoalCheckpointEscalation: (goalId, nodeId, checkpointId) => runGoalCheckpointEscalation(goalId, nodeId, checkpointId),
  openExperienceWorkbench: async (options = {}) => {
    switchMode("experience");
    await experienceWorkbenchFeature?.openExperienceWorkbench?.(options);
  },
  applyGoalContinuationFocus: (goalId) => applyGoalContinuationFocus(goalId),
});

goalsRuntimeFeature = createGoalsRuntimeFeature({
  refs: {
    goalsSection,
    goalsDetailEl,
    goalCheckpointActionModal,
    goalCheckpointActionTitleEl,
    goalCheckpointActionHintEl,
    goalCheckpointActionContextEl,
    goalCheckpointActionReviewerEl,
    goalCheckpointActionReviewerRoleEl,
    goalCheckpointActionRequestedByEl,
    goalCheckpointActionActorLabelEl,
    goalCheckpointActionActorEl,
    goalCheckpointActionSlaAtEl,
    goalCheckpointActionSummaryEl,
    goalCheckpointActionNoteLabelEl,
    goalCheckpointActionNoteHelpEl,
    goalCheckpointActionNoteEl,
    goalCheckpointActionCloseBtn,
    goalCheckpointActionCancelBtn,
    goalCheckpointActionSubmitBtn,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getGoalsState: () => goalsState,
  getGoalsOverviewFeature: () => goalsOverviewFeature,
  getGoalsDetailFeature: () => goalsDetailFeature,
  getGoalById,
  loadGoals: (forceReload = false, preferredGoalId) => goalsOverviewFeature?.loadGoals(forceReload, preferredGoalId),
  showNotice,
  formatDateTime,
  escapeHtml,
  onResumeGoal: (goalId, options) => resumeGoal(goalId, options),
  onPauseGoal: (goalId) => pauseGoal(goalId),
  onOpenSourcePath: (sourcePath) => openSourcePath(sourcePath),
  onOpenTask: (taskId) => openTaskFromAudit(taskId),
  onOpenGoalTaskViewer: (goalId) => openGoalTaskViewer(goalId),
  onOpenGoalBoard: (boardId, goalId) => openGoalCanvasBoard(boardId, goalId),
  onOpenGoalBoardList: (goalId) => openGoalCanvasList(goalId),
  onGenerateGoalHandoff: (goalId) => generateGoalHandoff(goalId),
  onLoadGoalReviewGovernanceData: (goal) => loadGoalReviewGovernanceData(goal),
  onLoadGoalTrackingData: (goal) => loadGoalTrackingData(goal),
  t: localeController.t,
});

memoryDetailRenderFeature = createMemoryDetailRenderFeature({
  refs: {
    memoryViewerDetailEl,
    memoryViewerStatsEl,
    memoryChunkCategoryFilterEl,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getMemoryViewerState: () => memoryViewerState,
  getMemoryViewerFeature: () => memoryViewerFeature,
  getMemoryRuntimeFeature: () => memoryRuntimeFeature,
  getGoalDisplayName,
  getCurrentAgentSelection,
  renderMemoryViewerDetailEmpty: (message) => renderMemoryViewerDetailEmpty(message),
  renderMemoryViewerStats: (stats) => renderMemoryViewerStats(stats),
  loadTaskUsageOverview: () => loadTaskUsageOverview(),
  loadTaskDetail: (taskId) => loadTaskDetail(taskId),
  loadCandidateDetail: (candidateId) => loadCandidateDetail(candidateId),
  openExperienceCandidate: async (candidateId) => {
    if (!candidateId) return;
    switchMode("experience");
    await experienceWorkbenchFeature?.openExperienceWorkbench?.({ candidateId, preferFirst: false });
  },
  openTaskFromAudit: (taskId) => openTaskFromAudit(taskId),
  openMemoryFromAudit: (chunkId) => openMemoryFromAudit(chunkId),
  openSourcePath: (sourcePath, options) => openSourcePath(sourcePath, options),
  loadGoals: (forceReload = false, preferredGoalId) => loadGoals(forceReload, preferredGoalId),
  switchMode,
  openGoalTaskViewer,
  showNotice,
  escapeHtml,
  formatDateTime,
  t: localeController.t,
});

memoryViewerFeature = createMemoryViewerFeature({
  refs: {
    memoryViewerSection,
    memoryViewerTitleEl,
    memoryViewerStatsEl,
    memoryViewerListEl,
    memoryViewerDetailEl,
    memoryDreamModalTriggerBtn,
    memoryDreamModalEl,
    memoryDreamModalTitleEl,
    memoryDreamModalCloseBtn,
    memoryDreamBarEl,
    memoryDreamStatusEl,
    memoryDreamMetaEl,
    memoryDreamObsidianEl,
    memoryDreamSummaryEl,
    memoryDreamRefreshBtn,
    memoryDreamRunBtn,
    memoryDreamHistoryToggleBtn,
    memoryDreamHistoryEl,
    memoryDreamHistoryStatusEl,
    memoryDreamHistoryRefreshBtn,
    memoryDreamHistoryListEl,
    memoryDreamHistoryDetailEl,
    memoryTabTasksBtn,
    memoryTabMemoriesBtn,
    memoryTabSharedReviewBtn,
    memoryTabOutboundAuditBtn,
    memoryOutboundAuditFiltersEl,
    memoryOutboundAuditFocusAllBtn,
    memoryOutboundAuditFocusThreadsBtn,
    memorySharedReviewBatchBarEl,
    memoryTaskFiltersEl,
    memoryChunkFiltersEl,
    memorySearchInputEl,
    memoryDedupPreviewBtn,
    memoryTaskStatusFilterEl,
    memoryTaskSourceFilterEl,
    memoryChunkTypeFilterEl,
    memoryChunkVisibilityFilterEl,
    memoryChunkGovernanceFilterEl,
    memoryChunkCategoryFilterEl,
    memorySharedReviewFiltersEl,
    memorySharedReviewFocusFilterEl,
    memorySharedReviewTargetFilterEl,
    memorySharedReviewClaimedByFilterEl,
    memoryDedupModalEl,
    memoryDedupModalTitleEl,
    memoryDedupModalSummaryEl,
    memoryDedupModalStatusEl,
    memoryDedupModalWarningEl,
    memoryDedupModalListEl,
    memoryDedupModalCloseBtn,
    memoryDedupModalCancelBtn,
    memoryDedupModalSubmitBtn,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getMemoryViewerState: () => memoryViewerState,
  getSelectedAgentId: () => getCurrentAgentSelection(),
  getSelectedAgentLabel: () => getCurrentAgentLabel(),
  getAvailableAgents: () => [...agentCatalog.values()],
  syncMemoryTaskGoalFilterUi,
  renderMemoryViewerListEmpty,
  renderMemoryViewerDetailEmpty,
  loadTaskDetail: (taskId) => loadTaskDetail(taskId),
  loadMemoryDetail: (chunkId) => loadMemoryDetail(chunkId),
  escapeHtml,
  formatCount: (value) => memoryDetailRenderFeature.formatCount(value),
  formatDateTime,
  formatDuration: (value) => memoryDetailRenderFeature.formatDuration(value),
  formatLineRange: (startLine, endLine) => memoryDetailRenderFeature.formatLineRange(startLine, endLine),
  formatScore: (score) => memoryDetailRenderFeature.formatScore(score),
  formatMemoryCategory: (value) => memoryDetailRenderFeature.formatMemoryCategory(value),
  normalizeMemoryVisibility: (value) => memoryDetailRenderFeature.normalizeMemoryVisibility(value),
  getVisibilityBadgeClass: (visibility) => memoryDetailRenderFeature.getVisibilityBadgeClass(visibility),
  summarizeSourcePath: (sourcePath) => memoryDetailRenderFeature.summarizeSourcePath(sourcePath),
  getTaskGoalId: (task) => memoryDetailRenderFeature.getTaskGoalId(task),
  getGoalDisplayName,
  getLatestExperienceUsageTimestamp: (...groups) => memoryDetailRenderFeature.getLatestExperienceUsageTimestamp(...groups),
  getActiveMemoryCategoryLabel: () => memoryDetailRenderFeature.getActiveMemoryCategoryLabel(),
  renderMemoryCategoryDistribution: (stats) => memoryDetailRenderFeature.renderMemoryCategoryDistribution(stats),
  renderTaskUsageOverviewCard: () => memoryDetailRenderFeature.renderTaskUsageOverviewCard(),
  bindStatsAuditJumpLinks: () => memoryDetailRenderFeature.bindStatsAuditJumpLinks(),
  bindMemoryPathLinks: () => memoryDetailRenderFeature.bindMemoryPathLinks(),
  bindTaskAuditJumpLinks: () => memoryDetailRenderFeature.bindTaskAuditJumpLinks(),
  openConversationSession,
  showNotice,
  t: localeController.t,
});

experienceWorkbenchFeature = createExperienceWorkbenchFeature({
  refs: {
    experienceWorkbenchSection,
    experienceWorkbenchTitleEl,
    experienceWorkbenchStatsEl,
    experienceWorkbenchTabCandidatesBtn,
    experienceWorkbenchTabCapabilityAcquisitionBtn,
    experienceWorkbenchTabUsageOverviewBtn,
    experienceWorkbenchCandidatesPaneEl,
    experienceWorkbenchCapabilityPaneEl,
    experienceWorkbenchCapabilityOverviewEl,
    experienceWorkbenchUsagePaneEl,
    experienceWorkbenchUsageOverviewEl,
    experienceWorkbenchQueryEl,
    experienceWorkbenchTypeFilterEl,
    experienceWorkbenchStatusFilterEl,
    experienceWorkbenchResetFiltersBtn,
    experienceWorkbenchCleanupConsumedBtn,
    experienceGenerateTaskIdEl,
    experienceGenerateMethodBtn,
    experienceGenerateSkillBtn,
    experienceWorkbenchListEl,
    experienceWorkbenchDetailEl,
    experienceSynthesisModalEl,
    experienceSynthesisModalTitleEl,
    experienceSynthesisModalSummaryEl,
    experienceSynthesisModalStatusEl,
    experienceSynthesisModalListEl,
    experienceSynthesisModalCloseBtn,
    experienceSynthesisModalCancelBtn,
    experienceSynthesisModalSubmitBtn,
    experienceSynthesisModalConsumeSourcesEl,
    experienceSynthesisModalConsumeSourcesLabelEl,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getExperienceWorkbenchState: () => experienceWorkbenchState,
  getMemoryViewerState: () => memoryViewerState,
  getSelectedAgentId: () => getCurrentAgentSelection(),
  getSelectedAgentLabel: () => getCurrentAgentLabel(),
  renderCandidateDetailPanel: (candidate) => memoryViewerFeature?.renderCandidateDetailPanel(candidate) || "",
  renderTaskUsageOverviewCard: () => memoryDetailRenderFeature.renderTaskUsageOverviewCard(),
  loadTaskUsageOverview: () => loadTaskUsageOverview(),
  generateExperienceCandidate: (taskId, candidateType) => memoryRuntimeFeature?.generateExperienceCandidate?.(taskId, candidateType),
  openToolSettingsTab: (tab) => settingsRuntimeFeature?.openToolSettingsTab?.(tab),
  escapeHtml,
  formatDateTime,
  openTaskFromWorkbench: async (taskId) => {
    switchMode("memory");
    await openTaskFromAudit(taskId);
  },
  openMemoryFromWorkbench: async (chunkId) => {
    switchMode("memory");
    await openMemoryFromAudit(chunkId);
  },
  openSourcePath: (sourcePath, options) => openSourcePath(sourcePath, options),
  showNotice,
  t: localeController.t,
});
experienceWorkbenchFeature.bindUi();

memoryRuntimeFeature = createMemoryRuntimeFeature({
  refs: {
    memoryViewerSection,
    memoryTaskGoalFilterBarEl,
    memoryTaskGoalFilterLabelEl,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getMemoryViewerState: () => memoryViewerState,
  getMemoryViewerFeature: () => memoryViewerFeature,
  getCurrentAgentSelection,
  getGoalDisplayName,
  switchMode,
  loadGoals: (forceReload = false, preferredGoalId) => loadGoals(forceReload, preferredGoalId),
  showNotice,
  renderMemoryViewerStats: (stats) => renderMemoryViewerStats(stats),
  renderTaskList: (items) => renderTaskList(items),
  renderMemoryList: (items) => renderMemoryList(items),
  renderSharedReviewList: (items) => renderSharedReviewList(items),
  renderTaskDetail: (task) => memoryDetailRenderFeature.renderTaskDetail(task),
  renderCandidateOnlyDetail: (candidate) => renderCandidateOnlyDetail(candidate),
  renderMemoryDetail: (item) => renderMemoryDetail(item),
  renderMemoryViewerListEmpty: (message) => renderMemoryViewerListEmpty(message),
  renderMemoryViewerDetailEmpty: (message) => renderMemoryViewerDetailEmpty(message),
  getCurrentAgentLabel: () => getCurrentAgentLabel(),
  t: localeController.t,
});

sessionDigestFeature = createSessionDigestFeature({
  refs: {
    sessionDigestSummaryEl,
    sessionContinuationSummaryEl,
    sessionDigestRefreshBtn,
    sessionDigestModalEl,
    sessionDigestModalTitleEl,
    sessionDigestModalMetaEl,
    sessionDigestModalActionsEl,
    sessionDigestModalContentEl,
    sessionDigestModalCloseBtn,
  },
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  getActiveConversationId: () => activeConversationId,
  onSendHistoryAction: ({ actionId, conversationId }) => {
    sendConversationHistoryAction(actionId, conversationId);
  },
  onOpenContinuationAction: (action) => openContinuationAction(action),
  escapeHtml,
  formatDateTime,
  showNotice,
  t: localeController.t,
});

agentRuntimeFeature = createAgentRuntimeFeature({
  refs: {
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
  },
  agentCatalog,
  residentAgentRosterEnabled,
  storageKey: AGENT_ID_KEY,
  initialIdentity: {
    agentName: "Agent",
    agentAvatar: "🤖",
    defaultAgentName: "Agent",
    defaultAgentAvatar: "🤖",
  },
  agentSessionCacheFeature,
  sendReq,
  makeId,
  requestModelCatalog: () => chatNetworkFeature?.requestModelCatalog?.(),
  getHttpAuthHeaders,
  getActiveConversationId: () => activeConversationId,
  setActiveConversationId: (conversationId) => {
    activeConversationId = conversationId;
    renderComposerPrimaryAction();
  },
  renderCanvasGoalContext,
  switchMode,
  getChatEventsFeature: () => chatEventsFeature,
  getSessionDigestFeature: () => sessionDigestFeature,
  renderConversationMessages,
  loadConversationMeta: (conversationId, options) => loadConversationMeta(conversationId, options),
  refreshMemoryViewerForAgentSwitch: (agentId) => refreshMemoryViewerForAgentSwitch(agentId),
  getSubtasksState: () => subtasksState,
  openSubtaskBySession: (sessionId, options = {}) => openSubtaskBySession(sessionId, options),
  openSubtaskById: (taskId) => openSubtaskById(taskId),
  loadSubtasks: (forceSelectFirst = false) => loadSubtasks(forceSelectFirst),
  getGoalsState: () => goalsState,
  loadGoals: (forceReload = false, preferredGoalId) => loadGoals(forceReload, preferredGoalId),
  resumeGoal: (goalId, options = {}) => resumeGoal(goalId, options),
  getMemoryViewerState: () => memoryViewerState,
  switchMemoryViewerTab: (tab) => switchMemoryViewerTab(tab),
  loadMemoryViewer: (forceSelectFirst = false) => loadMemoryViewer(forceSelectFirst),
  openTaskFromAudit: (taskId) => openTaskFromAudit(taskId),
  openConversationSession: (conversationId, hintText, options = {}) => openConversationSession(conversationId, hintText, options),
  openAgentConfigEditor: (filePath, options = {}) => openFile(filePath, options),
  appendMessage,
  getChatUiFeature: () => chatUiFeature,
  onAgentIdentityChanged: () => {
    memoryViewerFeature?.syncMemoryViewerHeaderTitle?.();
    memoryViewerFeature?.syncSharedReviewFilterUi?.();
    experienceWorkbenchFeature?.syncExperienceWorkbenchHeaderTitle?.();
    void refreshExperienceWorkbenchForAgentSwitch();
  },
  onAgentCatalogChanged: () => {
    memoryViewerFeature?.syncMemoryViewerHeaderTitle?.();
    memoryViewerFeature?.syncSharedReviewFilterUi?.();
    experienceWorkbenchFeature?.syncExperienceWorkbenchHeaderTitle?.();
  },
  showNotice,
  localeController,
  setAgentPanelHasContent: (hasContent) => panelVisibilityFeature.setAgentPanelHasContent(hasContent),
  t: localeController.t,
});

function loadAgentList() {
  return chatNetworkFeature?.loadAgentList();
}

function loadModelList() {
  return chatNetworkFeature?.loadModelList();
}

function getCurrentAgentSelection() {
  return agentRuntimeFeature?.getCurrentAgentSelection() || "default";
}

function getCurrentAgentLabel() {
  return agentRuntimeFeature?.getCurrentAgentLabel() || "";
}

function resetMemoryViewerStateForAgent(agentId = getCurrentAgentSelection()) {
  const previousAgentId = String(memoryViewerState.activeAgentId || "default").trim() || "default";
  const fallbackTab = memoryViewerState.tab;
  memoryViewerFeature?.captureAgentViewState?.(previousAgentId);
  memoryViewerState.requestToken = Number(memoryViewerState.requestToken || 0) + 1;
  memoryViewerState.activeAgentId = String(agentId || "default").trim() || "default";
  memoryViewerFeature?.applyAgentViewState?.(memoryViewerState.activeAgentId, fallbackTab);
  memoryViewerState.stats = null;
  memoryViewerState.items = [];
  memoryViewerState.selectedId = null;
  memoryViewerState.selectedTask = null;
  memoryViewerState.selectedCandidate = null;
  memoryViewerState.pendingUsageRevokeId = null;
  memoryViewerState.pendingExperienceActionKey = null;
  memoryViewerState.usageOverview = {
    loading: false,
    methods: [],
    skills: [],
  };
  memoryViewerState.usageOverviewSeq = Number(memoryViewerState.usageOverviewSeq || 0) + 1;
  memoryViewerState.memoryQueryView = null;
  memoryViewerState.experienceQueryView = null;
  memoryViewerState.sharedReviewSummary = null;
  memoryViewerState.sharedGovernance = null;
  memoryViewerState.selectedSharedReviewIds = [];
  memoryViewerState.sharedReviewBatchBusy = false;
  memoryViewerState.dreamRuntime = null;
  memoryViewerState.dreamCommons = null;
  memoryViewerState.dreamBusy = false;
  memoryViewerFeature?.clearDreamHistoryState?.({ preserveOpen: false });
}

async function refreshMemoryViewerForAgentSwitch(agentId = getCurrentAgentSelection()) {
  resetMemoryViewerStateForAgent(agentId);
  memoryViewerFeature?.syncMemoryViewerHeaderTitle?.();

  if (!memoryViewerSection || memoryViewerSection.classList.contains("hidden")) {
    return;
  }

  if (!ws || !isReady) {
    refreshMemoryLocale();
    return;
  }

  renderMemoryViewerStats(null);
  if (memoryViewerState.tab === "tasks") {
    renderMemoryViewerListEmpty(localeController.t("memory.tasksLoading", {}, "Loading tasks..."));
    renderMemoryViewerDetailEmpty(localeController.t("memory.taskDetailLoading", {}, "Loading task details..."));
  } else {
    renderMemoryViewerListEmpty(localeController.t("memory.memoriesLoading", {}, "Loading memories..."));
    renderMemoryViewerDetailEmpty(localeController.t("memory.memoryDetailLoading", {}, "Loading memory details..."));
  }

  await loadMemoryViewer(true);
}

async function refreshExperienceWorkbenchForAgentSwitch(agentId = getCurrentAgentSelection()) {
  return experienceWorkbenchFeature?.refreshExperienceWorkbenchForAgentSwitch(agentId);
}

function syncAgentRuntimeEntry(agentId, patch = {}) {
  return agentRuntimeFeature?.syncAgentRuntimeEntry(agentId, patch) || null;
}

async function ensureResidentAgentSession(agentId) {
  return agentRuntimeFeature?.ensureResidentAgentSession(agentId) || null;
}

async function activateResidentAgentConversation(agentId, options = {}) {
  return agentRuntimeFeature?.activateResidentAgentConversation(agentId, options);
}

function applyUploadedAvatarChange({ role, agentId, avatarPath }) {
  if (role === "agent") {
    agentRuntimeFeature?.applyUploadedAgentAvatarChange({ agentId, avatarPath });
    return;
  }
  const bustedPath = `${avatarPath}${avatarPath.includes("?") ? "&" : "?"}v=${Date.now()}`;
  userAvatar = bustedPath;
  chatUiFeature?.refreshAvatar("me", userAvatar);
}

function syncAgentCatalog(agents = [], selectedAgentId = "") {
  agentRuntimeFeature?.syncAgentCatalog(agents, selectedAgentId);
}

async function focusAgentObservabilityTarget(agentId) {
  return agentRuntimeFeature?.focusAgentObservabilityTarget(agentId);
}

function clearGoalContinuationFocus() {
  return agentRuntimeFeature?.clearGoalContinuationFocus();
}

function applyGoalContinuationFocus(goalId = goalsState.selectedId) {
  return agentRuntimeFeature?.applyGoalContinuationFocus(goalId) || false;
}

async function openSubtaskBySession(sessionId, options = {}) {
  return subtasksRuntimeFeature?.openSubtaskBySession(sessionId, options);
}

async function openContinuationAction(action = {}) {
  return agentRuntimeFeature?.openContinuationAction(action);
}

async function openAgentObservabilityAction(agentId, action = {}) {
  return agentRuntimeFeature?.openAgentObservabilityAction(agentId, action);
}

function renderAgentRightPanel() {
  return agentRuntimeFeature?.renderAgentRightPanel();
}

if (modelSelectEl) {
  modelSelectEl.addEventListener("change", () => {
    const selected = modelSelectEl.value || "";
    if (selected) {
      localStorage.setItem(MODEL_ID_KEY, selected);
    } else {
      localStorage.removeItem(MODEL_ID_KEY);
    }
  });
}

// 保存按钮点击事件
let saveWorkspaceRootsButtonState = "default";
let saveWorkspaceRootsResetTimer = null;

function syncSaveWorkspaceRootsButton() {
  if (!saveWorkspaceRootsBtn) return;
  const key = saveWorkspaceRootsButtonState === "saved" ? "common.saved" : "common.save";
  const fallback = saveWorkspaceRootsButtonState === "saved" ? "Saved" : "Save";
  saveWorkspaceRootsBtn.innerHTML = `<u>${localeController.t(key, {}, fallback)}</u>`;
}

syncSaveWorkspaceRootsButton();

if (saveWorkspaceRootsBtn) {
  saveWorkspaceRootsBtn.addEventListener("click", async () => {
    if (!ws || !isReady) {
      alert(localeController.t("panel.saveWorkspaceNotConnected", {}, "Please connect to the server first"));
      return;
    }

    const value = workspaceRootsEl ? workspaceRootsEl.value.trim() : "";

    // 保存到 localStorage
    persistWorkspaceRootsField({ workspaceRootsKey: WORKSPACE_ROOTS_KEY, workspaceRootsEl });

    // 更新 .env
    const id = makeId();
    const res = await sendReq({
      type: "req",
      id,
      method: "config.update",
      params: { updates: { "BELLDANDY_EXTRA_WORKSPACE_ROOTS": value } }
    });

    if (res && res.ok) {
      invalidateServerConfigCache();
      saveWorkspaceRootsButtonState = "saved";
      syncSaveWorkspaceRootsButton();
      if (saveWorkspaceRootsResetTimer) {
        clearTimeout(saveWorkspaceRootsResetTimer);
      }
      saveWorkspaceRootsResetTimer = setTimeout(() => {
        saveWorkspaceRootsButtonState = "default";
        syncSaveWorkspaceRootsButton();
        saveWorkspaceRootsResetTimer = null;
      }, 1500);
    } else {
      const msg = res && res.error ? res.error.message : localeController.t("settings.failed", {}, "Failed");
      alert(localeController.t("panel.saveWorkspaceFailed", { message: msg }, "Save failed: {message}"));
    }
  });
}

function connect() {
  return chatNetworkFeature?.connect();
}

function teardown() {
  return chatNetworkFeature?.teardown();
}

async function playBootSequence() {
  const overlay = document.getElementById("awakening");
  const logEl = document.getElementById("bootLog");
  if (!overlay || !logEl) return;

  overlay.classList.remove("hidden");

  const logs = [
    "Initializing Neural Interface...",
    "Loading Core Memories... OK",
    "Establishing Secure Link... OK",
    "Syncing with Star Sanctuary Gateway...",
    "User Identity Verified.",
    "System Online."
  ];

  for (const line of logs) {
    const p = document.createElement("div");
    p.className = "boot-line";
    p.textContent = `> ${line}`;
    logEl.appendChild(p);
    // Random delay for typing effect
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300));
  }

  await new Promise(r => setTimeout(r, 800));
  overlay.classList.add("hidden");
}
function estimateBase64DecodedBytes(base64) {
  if (typeof base64 !== "string") return 0;
  const normalized = base64.trim().replace(/\s+/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==") ? 2 : (normalized.endsWith("=") ? 1 : 0);
  return Math.max(0, (normalized.length / 4) * 3 - padding);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function restorePromptText(text) {
  promptController.restoreText(text);
}

async function approvePairingFromWebchat(code) {
  if (!code || !ws || !isReady) {
    return { ok: false, message: localeController.t("runtime.pairingConnectionUnavailable", {}, "The current connection is unavailable. Reconnect and try again.") };
  }
  const response = await sendReq({
    type: "req",
    id: makeId(),
    method: "pairing.approve",
    params: { code },
  });
  if (!response) {
    return { ok: false, message: localeController.t("runtime.pairingNoResult", {}, "The pairing approval request did not return a result.") };
  }
  if (!response.ok) {
    return { ok: false, message: response.error?.message || localeController.t("settings.pairingApproveFailedFallback", {}, "Pairing approval failed.") };
  }
  return {
    ok: true,
    clientId: typeof response.payload?.clientId === "string" ? response.payload.clientId : "",
  };
}

function renderPairingRequiredPrompt(target, payload = {}) {
  if (!target) return;
  const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
  const safeCode = escapeHtml(code);
  const message = typeof payload.message === "string" && payload.message.trim()
    ? payload.message.trim()
    : localeController.t("settings.pairingPendingDefaultMessage", {}, "The current WebChat session still needs pairing approval.");
  const safeMessage = escapeHtml(message);
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  const safeClientId = escapeHtml(clientId);
  target.innerHTML = `
    <div class="pairing-required-card" style="line-height: 1.6;">
      <div>${safeMessage}</div>
      <div style="margin-top: 8px;">${escapeHtml(localeController.t("runtime.pairingCodeLabel", {}, "Pairing code"))}：<b>${safeCode || "-"}</b></div>
      <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
        <button type="button" class="btn pairing-approve-btn">${escapeHtml(localeController.t("settings.pairingApprove", {}, "Approve"))}</button>
        <button type="button" class="btn pairing-open-settings-btn">${escapeHtml(localeController.t("settings.title", {}, "Settings"))}</button>
        <span class="pairing-status-text" style="color: var(--text-secondary); font-size: 12px;"></span>
      </div>
      <div style="margin-top: 10px; color: var(--text-secondary); font-size: 12px;">
        ${escapeHtml(localeController.t("runtime.pairingCliHint", {}, "If the inline approval button is unavailable, use the CLI fallback below and then resend your message here."))}
        <code>bdd pairing approve ${safeCode || "&lt;CODE&gt;"}</code>
      </div>
      ${safeClientId ? `<div style="margin-top: 6px; color: var(--text-secondary); font-size: 12px;">clientId: <code>${safeClientId}</code></div>` : ""}
    </div>
  `;

  const approveBtn = target.querySelector(".pairing-approve-btn");
  const openSettingsBtn = target.querySelector(".pairing-open-settings-btn");
  const statusEl = target.querySelector(".pairing-status-text");
  if (!approveBtn || !statusEl) return;
  openSettingsBtn?.addEventListener("click", () => {
    void settingsRuntimeFeature?.openPairingPending?.();
  });

  approveBtn.addEventListener("click", async () => {
    if (!code) {
      statusEl.textContent = localeController.t("settings.pairingCodeMissing", {}, "Pairing code is required.");
      return;
    }
    approveBtn.disabled = true;
    if (openSettingsBtn) openSettingsBtn.disabled = true;
    statusEl.textContent = localeController.t("settings.pairingProcessing", {}, "Processing...");
    const approved = settingsRuntimeFeature?.approvePairingPending
      ? await settingsRuntimeFeature.approvePairingPending(code, { showSuccessNotice: false })
      : await approvePairingFromWebchat(code);
    if (!approved.ok) {
      statusEl.textContent = approved.message || localeController.t("settings.pairingApproveFailedFallback", {}, "Pairing approval failed.");
      approveBtn.disabled = false;
      if (openSettingsBtn) openSettingsBtn.disabled = false;
      return;
    }
    statusEl.textContent = localeController.t("runtime.pairingApprovedResend", {}, "Pairing approved. You can resend your message now.");
    approveBtn.textContent = localeController.t("runtime.pairingApprovedButton", {}, "Approved");
    showNotice?.(
      localeController.t("settings.pairingApprovedTitle", {}, "Pairing approved"),
      localeController.t("settings.pairingApprovedMessage", { code }, "Pairing code {code} was approved. You can continue in the current WebChat session."),
      "success",
      3200,
    );
  }, { once: true });
}

function buildConversationHistoryActionPrompt(actionId, conversationId) {
  switch (actionId) {
    case "list_recent":
    case "list_main":
      return localeController.t(
        "panel.sessionHistoryPromptListMain",
        {},
        "请直接使用 conversation_list 工具，并设置 has_messages_only=true、exclude_heartbeat=true、exclude_subtasks=true、exclude_goal_sessions=true，列出最近 8 个当前可访问会话，并用简洁列表返回 conversationId、更新时间、消息数、agentId。",
      );
    case "list_all_allowed":
      return localeController.t(
        "panel.sessionHistoryPromptListAllAllowed",
        {},
        "请直接使用 conversation_list 工具，列出当前运行时策略允许访问的全部会话，并用简洁列表返回 conversationId、更新时间、消息数、agentId。",
      );
    case "read_timeline":
      if (!conversationId) return "";
      return localeController.t(
        "panel.sessionHistoryPromptReadTimeline",
        { conversationId },
        `请直接使用 conversation_read 工具读取当前会话（conversation_id=${conversationId}）的 timeline 视图，并用简洁中文总结关键节点。`,
      );
    case "read_restore":
      if (!conversationId) return "";
      return localeController.t(
        "panel.sessionHistoryPromptReadRestore",
        { conversationId },
        `请直接使用 conversation_read 工具读取当前会话（conversation_id=${conversationId}）的 restore 视图，重点说明 raw、compacted、canonical extraction 三层差异。`,
      );
    default:
      return "";
  }
}

function sendConversationHistoryAction(actionId, conversationId) {
  const promptText = buildConversationHistoryActionPrompt(actionId, conversationId);
  if (!promptText) {
    showNotice(
      localeController.t("panel.sessionDigestFullTitle", {}, "Session Digest Full Text"),
      localeController.t("panel.sessionDigestNoConversation", {}, "No active conversation yet."),
      "error",
    );
    return;
  }
  switchMode("chat");
  void sendMessage({
    textOverride: promptText,
    pendingAttachmentsOverride: [],
  });
}

function buildAttachmentsPayload(attachments) {
  return attachments.map(att => {
    let base64 = "";
    if (typeof att.content === "string" && att.content.startsWith("data:")) {
      const parts = att.content.split(",");
      base64 = parts.length > 1 ? parts[1] : "";
    } else {
      try {
        base64 = window.btoa(unescape(encodeURIComponent(att.content || "")));
      } catch (e) {
        console.error("Base64 conversion failed for", att.name, e);
      }
    }
    return {
      name: att.name,
      type: att.mimeType || "application/octet-stream",
      base64
    };
  });
}

async function sendMessage(options = {}) {
  const hasTextOverride = typeof options.textOverride === "string";
  const text = hasTextOverride ? options.textOverride.trim() : promptEl.value.trim();
  const pendingAttachments = Array.isArray(options.pendingAttachmentsOverride)
    ? options.pendingAttachmentsOverride
    : attachmentsFeature
      ? attachmentsFeature.getPendingAttachments()
      : [];
  const attachmentLimits = attachmentsFeature ? attachmentsFeature.getAttachmentLimits() : {
    maxFileBytes: DEFAULT_ATTACHMENT_MAX_FILE_BYTES,
    maxTotalBytes: DEFAULT_ATTACHMENT_MAX_TOTAL_BYTES,
  };

  if (!text && !pendingAttachments.length) return;
  if (!hasTextOverride) {
    promptEl.value = "";
    promptController.syncHeight();
  }

  if (!ws || !isReady) {
    queuedText = text;
    connect();
    return;
  }

  // ── 斜杠命令：/compact ──
  if (text === "/compact") {
    if (!activeConversationId) {
      appendMessage("bot", localeController.t("runtime.compactNoConversation", {}, "There is no active conversation to compact."));
      return;
    }
    appendMessage("me", "/compact");
    const statusEl = appendMessage("bot", localeController.t("runtime.compactPending", {}, "Compacting context..."));
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "context.compact",
      params: { conversationId: activeConversationId },
    });
    if (res && res.ok && res.payload) {
      const p = res.payload;
      if (p.compacted) {
        statusEl.textContent = localeController.t(
          "runtime.compactComplete",
          {
            tier: p.tier ?? localeController.t("common.unknown", {}, "unknown"),
            originalTokens: String(p.originalTokens ?? "?"),
            compactedTokens: String(p.compactedTokens ?? "?"),
          },
          `Context compaction complete (${p.tier ?? localeController.t("common.unknown", {}, "unknown")}): ${p.originalTokens ?? "?"} -> ${p.compactedTokens ?? "?"} tokens`,
        );
      } else {
        statusEl.textContent = localeController.t("runtime.compactSkipped", {}, "The current context is already short enough. No compaction is needed.");
      }
    } else {
      statusEl.textContent = localeController.t(
        "runtime.compactFailed",
        { message: res?.error?.message || localeController.t("common.unknown", {}, "Unknown") },
        `Context compaction failed: ${res?.error?.message || localeController.t("common.unknown", {}, "Unknown")}`,
      );
    }
    return;
  }

  // ── 斜杠命令：/restart ──
  if (text === "/restart") {
    appendMessage("me", "/restart");
    const statusEl = appendMessage("bot", localeController.t("settings.restartCommandPending", {}, "Restarting service…"));
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "system.restart",
    });
    if (res && res.ok) {
      statusEl.textContent = localeController.t("settings.restartCommandAccepted", {}, "Service is restarting, please wait...");
      setStatus(localeController.t("settings.restartingStatus", {}, "Restarting..."));
    } else {
      const message = res?.error?.message || localeController.t("settings.failed", {}, "Failed");
      statusEl.textContent = localeController.t("settings.restartFailed", { message }, `Restart failed: ${message}`);
    }
    return;
  }

  // ── 斜杠命令：/doctor ──
  if (text === "/doctor") {
    appendMessage("me", "/doctor");
    const statusEl = appendMessage("bot", localeController.t("runtime.doctorPending", {}, "Running system doctor..."));
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "system.doctor",
      params: {
        ...(activeConversationId ? { promptConversationId: activeConversationId, toolConversationId: activeConversationId } : {}),
        ...(agentSelectEl?.value ? { promptAgentId: agentSelectEl.value, toolAgentId: agentSelectEl.value } : {}),
      },
    });
    if (res && res.ok && res.payload && res.payload.checks) {
      const lines = res.payload.checks.map(c => {
        const icon = c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️" : "❌";
        return `${icon} ${c.name}: ${c.message}`;
      });
      lines.push(...buildDoctorChatSummary(res.payload, localeController.t));
      statusEl.textContent = lines.join("\n");
    } else {
      statusEl.textContent = localeController.t(
        "runtime.doctorFailed",
        { message: res?.error?.message || localeController.t("common.unknown", {}, "Unknown") },
        `System doctor failed: ${res?.error?.message || localeController.t("common.unknown", {}, "Unknown")}`,
      );
    }
    return;
  }

  // Canvas context injection: when user sends from canvas view, prepend board snapshot
  let finalText = text;
  const canvasSection = document.getElementById("canvasSection");
  if (canvasSection && !canvasSection.classList.contains("hidden") && window._canvasApp?.currentBoardId && window._canvasApp.manager?.board) {
    const snapshot = window._canvasApp.getCanvasSnapshot();
    if (snapshot) {
      finalText = `[当前画布上下文]\n${snapshot}\n\n[用户消息]\n${text}`;
    }
  }

  // 准备附件数据（用于预估体积 + 实际发送）
  const attachments = buildAttachmentsPayload(pendingAttachments);
  const attachmentDecodedBytes = attachments.reduce((sum, att) => sum + estimateBase64DecodedBytes(att.base64), 0);

  const uuid = userUuidEl ? userUuidEl.value.trim() : ""; // 获取UUID
  const params = {
    conversationId: activeConversationId || undefined,
    text: finalText,
    autoStopPreviousRun: true,
    from: "web",
    clientContext: {
      sentAtMs: Date.now(),
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
    },
    roomContext: { environment: "local" },
    modelId: modelSelectEl?.value || undefined,
    agentId: agentSelectEl?.value || undefined,
    attachments,
  };

  // 如果有UUID，添加到params
  if (uuid) {
    params.userUuid = uuid;
  }

  const oversizedAttachment = attachments.find((att) => estimateBase64DecodedBytes(att.base64) > attachmentLimits.maxFileBytes);
  if (oversizedAttachment) {
    appendMessage("bot", localeController.t(
      "runtime.sendBlockedSingleAttachment",
      {
        name: oversizedAttachment.name,
        limit: formatBytes(attachmentLimits.maxFileBytes),
      },
      `This message was blocked before sending.\nAttachment "${oversizedAttachment.name}" exceeds the per-file size limit.\nCurrent limit: ${formatBytes(attachmentLimits.maxFileBytes)} (adjustable via BELLDANDY_ATTACHMENT_MAX_FILE_BYTES).\nSuggestion: compress the file or split it and try again.`,
    ));
    console.warn("message.send blocked by single attachment limit", {
      fileName: oversizedAttachment.name,
      fileLimitBytes: attachmentLimits.maxFileBytes,
      attachmentCount: attachments.length,
    });
    if (!hasTextOverride) {
      restorePromptText(text);
    }
    return;
  }

  if (attachmentDecodedBytes > attachmentLimits.maxTotalBytes) {
    appendMessage("bot", localeController.t(
      "runtime.sendBlockedTotalAttachments",
      {
        size: formatBytes(attachmentDecodedBytes),
        limit: formatBytes(attachmentLimits.maxTotalBytes),
      },
      `This message was blocked before sending.\nAttachments total about ${formatBytes(attachmentDecodedBytes)}, which exceeds the total limit ${formatBytes(attachmentLimits.maxTotalBytes)}.\nAdjust BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES or remove some attachments and try again.`,
    ));
    console.warn("message.send blocked by attachment total limit", {
      attachmentDecodedBytes,
      totalLimitBytes: attachmentLimits.maxTotalBytes,
      attachmentCount: attachments.length,
    });
    if (!hasTextOverride) {
      restorePromptText(text);
    }
    return;
  }

  const displayText = text || (pendingAttachments.length ? localeController.t("runtime.voiceMessagePlaceholder", {}, "[Voice message]") : "");
  const attachmentBadge = pendingAttachments.length
    ? localeController.t("runtime.attachmentsCountBadge", { count: String(pendingAttachments.length) }, `[${pendingAttachments.length} attachment(s)]`)
    : "";
  const optimisticUserMeta = {
    timestampMs: params.clientContext.sentAtMs,
    isLatest: true,
  };
  appendMessage("me", displayText + (attachmentBadge ? ` ${attachmentBadge}` : ""), optimisticUserMeta);
  agentRuntimeFeature?.cacheOutgoingUserMessage({
    conversationId: activeConversationId,
    displayText: displayText + (attachmentBadge ? ` ${attachmentBadge}` : ""),
    timestampMs: optimisticUserMeta.timestampMs,
    agentId: getCurrentAgentSelection(),
  });
  const botMsgEl = chatEventsFeature?.beginStreamingReply({
    timestampMs: Date.now(),
    isLatest: false,
  }) || appendMessage("bot", "", { timestampMs: Date.now(), isLatest: false });

  if (!Array.isArray(options.pendingAttachmentsOverride)) {
    attachmentsFeature?.clearPendingAttachments();
  }

  const id = makeId();
  const payload = await sendReq({
    type: "req",
    id,
    method: "message.send",
    params,
  });

  if (payload && payload.ok === false) {
    if (payload.error && payload.error.code === "pairing_required") {
      const msg = payload.error.message ? String(payload.error.message) : "Pairing required.";
      if (!hasTextOverride) {
        restorePromptText(text);
      }
      if (!Array.isArray(options.pendingAttachmentsOverride) && Array.isArray(pendingAttachments) && pendingAttachments.length > 0) {
        for (const attachment of pendingAttachments) {
          attachmentsFeature?.addAttachment?.(attachment);
        }
        attachmentsFeature?.renderAttachmentsPreview?.();
      }
      if (botMsgEl) {
        const codeMatch = msg.match(/Code:\s*([A-Z0-9-]+)/i);
        settingsRuntimeFeature?.handlePairingRequired?.({
          code: codeMatch ? codeMatch[1] : "",
          message: msg,
        });
        renderPairingRequiredPrompt(botMsgEl, {
          code: codeMatch ? codeMatch[1] : "",
          message: msg,
        });
      }
      return;
    }
    if (payload.error && payload.error.code === "config_required") {
      if (botMsgEl) {
        botMsgEl.textContent = `${localeController.t("runtime.configRequired", { message: payload.error.message }, `Configuration missing: ${payload.error.message}`)}\n${localeController.t("runtime.configRequiredHint", {}, "Click the settings icon (⚙️) in the top-right corner to complete the configuration.")}`;
      }
      toggleSettings(true); // Auto open settings
      return;
    }
  }

  if (payload && payload.ok && payload.payload && payload.payload.conversationId) {
    activeConversationId = String(payload.payload.conversationId);
    bindComposerRun(payload.payload);
    agentRuntimeFeature?.handleMessageSendConversationBound({
      conversationId: activeConversationId,
      agentId: getCurrentAgentSelection(),
    });
    if (payload.payload.messageMeta) {
      const wrappers = messagesEl?.querySelectorAll(".msg-wrapper.me .msg[data-latest='true']") || [];
      const latestUserBubble = wrappers.length ? wrappers[wrappers.length - 1] : null;
      if (latestUserBubble) {
        chatUiFeature?.updateMessageMeta?.(latestUserBubble, payload.payload.messageMeta);
      }
    }
    renderCanvasGoalContext();
    void loadConversationMeta(activeConversationId, { renderMessages: false });
    void sessionDigestFeature?.loadSessionDigest(activeConversationId);
  }
}

// ... existing handleEvent ...

// 暴露给 WebView 等环境的接口
window.__BELLDANDY_WEBCHAT_READY__ = true;

applyWebConfigLinks(
  {
    recommendApiLink,
    aliyunOneKeyLink,
    officialHomeLink,
    openWebChatTabLink,
    workshopLink,
  },
  window.BELLDANDY_WEB_CONFIG,
);
const REDACTED_PLACEHOLDER = "[REDACTED]";

settingsRuntimeFeature = createSettingsRuntimeFeature({
  refs: APP_DOM_REFS,
  isConnected: () => Boolean(ws && isReady),
  sendReq,
  makeId,
  setStatus,
  loadServerConfig,
  invalidateServerConfigCache,
  syncAttachmentLimitsFromConfig,
  voiceFeature,
  localeController,
  chatNetworkFeature,
  approvePairing: approvePairingFromWebchat,
  onOpenCommunityConfig: () => {
    void openFile("community.json");
  },
  onOpenContinuationAction: (action) => openContinuationAction(action),
  getConnectionAuthMode: () => authModeEl?.value || "none",
  clientId,
  getSelectedAgentId: () => agentSelectEl?.value || localStorage.getItem(AGENT_ID_KEY) || "default",
  getActiveConversationId: () => activeConversationId || "",
  getSelectedSubtaskId: () => subtasksState.selectedId || "",
  isSubtasksViewActive: () => Boolean(subtasksSection && !subtasksSection.classList.contains("hidden")),
  escapeHtml,
  showNotice,
  redactedPlaceholder: REDACTED_PLACEHOLDER,
});

function toggleSettings(show) {
  settingsRuntimeFeature?.toggleSettings(show);
}

window.addEventListener(GOVERNANCE_DETAIL_MODE_CHANGED_EVENT, () => {
  if (memoryViewerSection && !memoryViewerSection.classList.contains("hidden")) {
    void loadMemoryViewer(false);
  }
  if (experienceWorkbenchSection && !experienceWorkbenchSection.classList.contains("hidden")) {
    void loadExperienceWorkbench(false);
  }
  if (goalsSection && !goalsSection.classList.contains("hidden")) {
    void loadGoals(false);
  }
});

chatEventsFeature = createChatEventsFeature({
  appendMessage,
  showNotice,
  onPairingRequired: ({ target, code, clientId, message }) => {
    settingsRuntimeFeature?.handlePairingRequired?.({ code, clientId, message });
    renderPairingRequiredPrompt(target, { code, clientId, message });
  },
  showRestartCountdown,
  setTokenUsageRunning: (running) => {
    if (!tokenUsageEl) return;
    tokenUsageEl.classList.toggle("updating", Boolean(running));
  },
  updateTokenUsage,
  showTaskTokenResult,
  onChannelSecurityPending: (payload) => settingsRuntimeFeature?.handleChannelSecurityPending(payload),
  queueGoalUpdateEvent: (payload) => goalsStateRuntimeFeature?.queueGoalUpdateEvent(payload),
  onSubtaskUpdated: (payload) => subtasksOverviewFeature?.handleSubtaskUpdate(payload),
  onToolSettingsConfirmRequired: (payload) => settingsRuntimeFeature?.handleToolSettingsConfirmRequired(payload),
  onToolSettingsConfirmResolved: (payload) => settingsRuntimeFeature?.handleToolSettingsConfirmResolved(payload),
  onExternalOutboundConfirmRequired: (payload) => settingsRuntimeFeature?.handleExternalOutboundConfirmRequired(payload),
  onExternalOutboundConfirmResolved: (payload) => settingsRuntimeFeature?.handleExternalOutboundConfirmResolved(payload),
  onEmailOutboundConfirmRequired: (payload) => settingsRuntimeFeature?.handleEmailOutboundConfirmRequired(payload),
  onEmailOutboundConfirmResolved: (payload) => settingsRuntimeFeature?.handleEmailOutboundConfirmResolved(payload),
  onToolsConfigUpdated: (payload) => settingsRuntimeFeature?.handleToolsConfigUpdated(payload),
  onConversationDigestUpdated: (payload) => sessionDigestFeature?.handleDigestUpdated(payload),
  stripThinkBlocks,
  configureMarkedOnce,
  renderAssistantMessage: (bubble, rawText) => chatUiFeature?.renderAssistantMessage?.(bubble, rawText),
  updateMessageMeta: (bubble, meta) => chatUiFeature?.updateMessageMeta?.(bubble, meta),
  forceScrollToBottom,
  getCanvasApp: () => window._canvasApp,
  getActiveConversationId: () => activeConversationId,
  onAgentStatusEvent: (payload) => {
    agentRuntimeFeature?.handleAgentStatusPayload(payload);
    handleComposerAgentStatus(payload);
  },
  onConversationDelta: (payload) => agentRuntimeFeature?.handleConversationDeltaPayload(payload),
  onConversationFinal: (payload) => {
    agentRuntimeFeature?.handleConversationFinalPayload(payload);
    handleComposerRunFinal(payload);
  },
  onConversationStopped: (payload) => {
    agentRuntimeFeature?.handleConversationStoppedPayload(payload);
    handleComposerRunStopped(payload);
  },
  getStoppedMessageText: () => localeController.t("common.interrupted", {}, "Interrupted"),
  escapeHtml,
  t: localeController.t,
});

markWebchatStartup("app.auto-connect.schedule");
connect();

function handleEvent(event, payload) {
  chatEventsFeature?.handleEvent(event, payload);
}

function showRestartCountdown(countdown, reason) {
  if (!restartOverlayEl || !restartCountdownEl) return;

  if (countdown > 0) {
    // 显示倒计时
    restartOverlayEl.classList.remove("hidden");
    if (restartReasonEl) {
      restartReasonEl.textContent = reason;
    }
    restartCountdownEl.textContent = String(countdown);
    // pulse 动画
    restartCountdownEl.classList.remove("pulse");
    void restartCountdownEl.offsetWidth; // force reflow
    restartCountdownEl.classList.add("pulse");
  } else {
    // countdown === 0，服务即将断开
    restartCountdownEl.textContent = "…";
    setStatus(localeController.t("settings.restartingStatus", {}, "Restarting..."));
  }
}

function formatTokenCount(n) {
  if (n == null || n === 0) return "--";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function formatDurationMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function formatTaskTokenTime(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "--";
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function normalizeTaskTokenRecord(record) {
  if (!record || typeof record !== "object") return null;
  return {
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : "task",
    inputTokens: Number(record.inputTokens || 0),
    outputTokens: Number(record.outputTokens || 0),
    totalTokens: Number(record.totalTokens || 0),
    durationMs: Number(record.durationMs || 0),
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    auto: record.auto === true,
  };
}

function setTaskTokenHistory(conversationId, items) {
  if (!conversationId) return;
  const normalized = Array.isArray(items)
    ? items.map(normalizeTaskTokenRecord).filter(Boolean).slice(0, TASK_TOKEN_HISTORY_LIMIT)
    : [];
  taskTokenHistoryByConversation.set(conversationId, normalized);
  if (conversationId === activeConversationId) {
    renderTaskTokenHistory();
  }
}

function prependTaskTokenHistory(conversationId, item) {
  if (!conversationId) return;
  const normalized = normalizeTaskTokenRecord(item);
  if (!normalized) return;
  const current = taskTokenHistoryByConversation.get(conversationId) || [];
  taskTokenHistoryByConversation.set(conversationId, [normalized, ...current].slice(0, TASK_TOKEN_HISTORY_LIMIT));
  if (conversationId === activeConversationId) {
    renderTaskTokenHistory();
  }
}

function getConversationMessageRenderKey(item, index) {
  if (item && typeof item.id === "string" && item.id.trim()) {
    return `id:${item.id.trim()}`;
  }
  const role = typeof item?.role === "string" ? item.role : "";
  const timestampMs = typeof item?.timestampMs === "number" && Number.isFinite(item.timestampMs)
    ? item.timestampMs
    : "";
  return `fallback:${index}:${role}:${timestampMs}`;
}

function appendConversationMessageItem(item, index) {
  if (!item || typeof item !== "object") return;
  const role = item.role === "assistant" ? "bot" : "me";
  const content = typeof item.content === "string" ? item.content : String(item.content ?? "");
  const meta = {
    timestampMs: typeof item.timestampMs === "number" && Number.isFinite(item.timestampMs) ? item.timestampMs : undefined,
    displayTimeText: typeof item.displayTimeText === "string" ? item.displayTimeText : undefined,
    isLatest: item.isLatest === true,
  };
  const bubble = appendMessage(role, role === "bot" ? "" : content, meta);
  if (bubble instanceof HTMLElement) {
    const renderKey = getConversationMessageRenderKey(item, index);
    bubble.dataset.conversationMessageKey = renderKey;
    const wrapper = bubble.closest(".msg-wrapper");
    if (wrapper instanceof HTMLElement) {
      wrapper.dataset.conversationMessageKey = renderKey;
    }
  }
  if (role === "bot") {
    chatUiFeature?.renderAssistantMessage?.(bubble, content);
  }
  chatUiFeature?.updateMessageMeta?.(bubble, meta);
}

function renderConversationMessages(conversationId, messages) {
  if (!messagesEl) return;
  const normalizedMessages = Array.isArray(messages)
    ? messages.filter((item) => item && typeof item === "object")
    : [];
  const nextKeys = normalizedMessages.map((item, index) => getConversationMessageRenderKey(item, index));
  const currentState = renderedConversationMessageState;
  const canIncrementallyAppend = currentState.conversationId === conversationId
    && currentState.keys.length > 0
    && nextKeys.length > currentState.keys.length
    && messagesEl.querySelector(".system-msg") === null
    && currentState.keys.every((key, index) => key === nextKeys[index]);

  if (canIncrementallyAppend) {
    for (let index = currentState.keys.length; index < normalizedMessages.length; index += 1) {
      appendConversationMessageItem(normalizedMessages[index], index);
    }
    renderedConversationMessageState = {
      conversationId,
      keys: nextKeys,
    };
    return;
  }

  messagesEl.innerHTML = "";

  if (normalizedMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "system-msg";
    empty.textContent = localeController.t("runtime.emptyConversation", {}, "There are no messages in this conversation yet.");
    messagesEl.appendChild(empty);
    renderedConversationMessageState = {
      conversationId,
      keys: [],
    };
    return;
  }

  for (let index = 0; index < normalizedMessages.length; index += 1) {
    appendConversationMessageItem(normalizedMessages[index], index);
  }
  renderedConversationMessageState = {
    conversationId,
    keys: nextKeys,
  };
}

async function loadConversationMeta(conversationId, options = {}) {
  const renderMessages = options.renderMessages !== false;
  const showGoalEntryBanner = options.showGoalEntryBanner === true;
  if (!conversationId || !ws || !isReady) {
    renderTaskTokenHistory();
    sessionDigestFeature?.clear?.();
    return;
  }
  const res = await sendReq({
    type: "req",
    id: makeId(),
    method: "conversation.meta",
    params: { conversationId, limit: TASK_TOKEN_HISTORY_LIMIT },
  });
  if (res && res.ok && res.payload) {
    if (Array.isArray(res.payload.taskTokenResults)) {
      setTaskTokenHistory(conversationId, res.payload.taskTokenResults);
    } else {
      renderTaskTokenHistory();
    }
    if (Array.isArray(res.payload.messages)) {
      agentRuntimeFeature?.setConversationMessages(conversationId, res.payload.messages);
    }
    if (renderMessages && Array.isArray(res.payload.messages) && conversationId === activeConversationId) {
      renderConversationMessages(conversationId, res.payload.messages);
      const emailInboundSessionBanner = await emailInboundSessionBannerFeature?.loadBannerText?.(conversationId);
      emailInboundSessionBannerFeature?.renderBanner?.(
        messagesEl,
        conversationId === activeConversationId ? emailInboundSessionBanner : "",
      );
      if (showGoalEntryBanner && parseGoalSessionReference(conversationId)) {
        const goalSessionEntryBanner = typeof res.payload.goalSessionEntryBanner === "string"
          ? res.payload.goalSessionEntryBanner.trim()
          : "";
        if (goalSessionEntryBanner) {
          appendMessage("system", goalSessionEntryBanner);
        }
      }
    }
    sessionDigestFeature?.setContinuationState?.(res.payload.continuationState || null, { conversationId });
    return;
  }
  sessionDigestFeature?.setContinuationState?.(null, { conversationId });
  renderTaskTokenHistory();
}

function renderTaskTokenHistory() {
  if (!taskTokenHistoryEl) return;
  const items = activeConversationId
    ? (taskTokenHistoryByConversation.get(activeConversationId) || [])
    : [];
  const latestItems = items.slice(0, 1);

  if (!latestItems.length) {
    taskTokenHistoryEl.innerHTML = `<div class="task-token-history-empty">${escapeHtml(localeController.t("panel.taskTokenEmpty", {}, "No task-level token records yet"))}</div>`;
    return;
  }

  taskTokenHistoryEl.innerHTML = latestItems.map((item) => `
    <div class="task-token-chip${item.auto ? " auto" : ""}">
      <div class="task-token-chip-top">
        <span class="task-token-chip-name">${escapeHtml(item.name)}</span>
        <span class="task-token-chip-badge">${item.auto ? "AUTO" : "MANUAL"}</span>
      </div>
      <div class="task-token-chip-sep">|</div>
      <div class="task-token-chip-total">TOTAL ${escapeHtml(formatTokenCount(item.totalTokens))}</div>
      <div class="task-token-chip-sep">|</div>
      <div class="task-token-chip-meta">IN ${escapeHtml(formatTokenCount(item.inputTokens))} <span style="opacity:0.5;margin:0 2px;">/</span> OUT ${escapeHtml(formatTokenCount(item.outputTokens))}</div>
      <div class="task-token-chip-sep">|</div>
      <div class="task-token-chip-meta">${escapeHtml(formatDurationMs(item.durationMs))} <span style="opacity:0.5;margin:0 2px;">/</span> ${escapeHtml(formatTaskTokenTime(item.createdAt))}</div>
    </div>
  `).join("");
}

let sessionTotalTokens = 0;
const costBudgetTracker = createCostBudgetTracker();

function updateTokenUsage(payload) {
  if (!payload) return;
  const set = (id, val) => {
    const el = tokenUsageValueEls[id];
    if (el) el.textContent = formatTokenCount(val);
  };
  set("tuSys", payload.systemPromptTokens);
  set("tuCtx", payload.contextTokens);
  set("tuIn", payload.inputTokens);
  set("tuOut", payload.outputTokens);
  set("tuCalls", payload.modelCalls);
  // 会话累计：每次收到 usage 事件，累加 input + output
  sessionTotalTokens += (payload.inputTokens || 0) + (payload.outputTokens || 0);
  set("tuAll", sessionTotalTokens);
  const sessionTotalCostUsd = costBudgetTracker.consumeUsage(payload);
  void loadServerConfig().then((config) => {
    const costBudgetConfig = readCostBudgetConfig(config);
    const ratio = costBudgetConfig.budgetUsd > 0 ? sessionTotalCostUsd / costBudgetConfig.budgetUsd : null;
    updateTokenUsageObservability(
      tokenUsageObservabilityEl,
      {
        ...payload,
        sessionTotalCostUsd,
        costBudgetUsd: costBudgetConfig.budgetUsd,
        costBudgetRatio: ratio,
      },
      localeController.t.bind(localeController),
    );
    const warning = costBudgetTracker.evaluateWarning(costBudgetConfig);
    if (warning.shouldWarn) {
      const percent = Math.max(0, Math.round((warning.ratio || 0) * 100));
      showNotice(
        localeController.t("settings.webchatCostBudgetUsdLabel", {}, "WebChat 成本预算（USD）"),
        `当前会话累计成本 $${warning.sessionTotalCostUsd.toFixed(6)}，已达到预算 $${warning.budgetUsd.toFixed(6)} 的 ${percent}%。`,
        "warning",
        5200,
      );
    }
  });
  // 移除 updating 动画
  if (tokenUsageEl) tokenUsageEl.classList.remove("updating");
}

let taskTokenHideTimer = null;
const TASK_TOKEN_TRANSIENT_PANEL_ENABLED = false;

function showTaskTokenResult(payload) {
  if (!payload) return;

  if (payload.conversationId) {
    prependTaskTokenHistory(String(payload.conversationId), payload);
  }

  if (!TASK_TOKEN_TRANSIENT_PANEL_ENABLED) {
    if (taskTokenHideTimer) {
      clearTimeout(taskTokenHideTimer);
      taskTokenHideTimer = null;
    }
    if (taskTokenUsagePanelEl) taskTokenUsagePanelEl.style.display = "none";
    return;
  }

  if (!taskTokenUsagePanelEl) return;

  const set = (id, val) => {
    const el = taskTokenValueEls[id];
    if (el) el.textContent = typeof val === "number" ? formatTokenCount(val) : String(val ?? "--");
  };
  set("taskName", payload.name);
  set("taskIn", payload.inputTokens);
  set("taskOut", payload.outputTokens);
  set("taskTotal", payload.totalTokens);

  taskTokenUsagePanelEl.style.display = "flex";

  // 8 秒后自动隐藏
  if (taskTokenHideTimer) clearTimeout(taskTokenHideTimer);
  taskTokenHideTimer = setTimeout(() => {
    taskTokenUsagePanelEl.style.display = "none";
  }, 8000);
}

function flushQueuedText() {
  const text = queuedText;
  if (!text) return;
  queuedText = null;
  promptEl.value = text;
  sendMessage();
}

function appendMessage(kind, text, meta) {
  return chatUiFeature?.appendMessage(kind, text, meta) || null;
}

/**
 * 处理消息中的图片和视频，转换为缩略图
 * @param {HTMLElement} msgEl - 消息气泡元素
 */
function processMediaInMessage(msgEl) {
  return chatUiFeature?.processMediaInMessage(msgEl);
}

/**
 * 打开媒体弹窗
 * @param {string} src - 媒体源 URL
 * @param {string} type - 媒体类型 ("image" 或 "video")
 */
function openMediaModal(src, type) {
  return chatUiFeature?.openMediaModal(src, type);
}

/** 强制滚动到底部 - 使用 chatSection 作为滚动容器 */
function forceScrollToBottom() {
  return chatUiFeature?.forceScrollToBottom();
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function makeId() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sendReq(frame) {
  return chatNetworkFeature?.sendReq(frame) ?? Promise.resolve(null);
}

function resolveClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_KEY);
    if (existing && existing.trim()) return existing.trim();
  } catch {
    // ignore
  }
  const id = makeId();
  try {
    localStorage.setItem(CLIENT_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

// ==================== 附件处理逻辑 ====================

function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== "string") return 0;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  return estimateBase64DecodedBytes(dataUrl.slice(comma + 1));
}

if (switchMemoryBtn) {
  switchMemoryBtn.addEventListener("click", async () => {
    switchMode("memory");
    await loadMemoryViewer(false);
  });
}
if (switchExperienceBtn) {
  switchExperienceBtn.addEventListener("click", async () => {
    switchMode("experience");
    await loadExperienceWorkbench(true);
  });
}
if (switchGoalsBtn) {
  switchGoalsBtn.addEventListener("click", async () => {
    switchMode("goals");
    await loadGoals(false);
  });
}
if (switchSubtasksBtn) {
  switchSubtasksBtn.addEventListener("click", async () => {
    switchMode("subtasks");
    await loadSubtasks(false);
  });
}
if (openChannelSettingsBtn) {
  openChannelSettingsBtn.addEventListener("click", () => {
    void settingsRuntimeFeature?.openChannels?.();
  });
}

// 画布工作区按钮
if (switchCanvasBtn) {
  switchCanvasBtn.addEventListener("click", async () => {
    if (window._canvasApp) {
      switchMode("canvas");
      await window._canvasApp.showBoardList();
    }
  });
}

function renderAttachmentsPreview(hintMessage = "") {
  attachmentsFeature?.renderAttachmentsPreview(hintMessage);
}

function openEnvFile() {
  return workspaceFeature?.openEnvFile();
}

function loadFileTree(folderPath = "") {
  return workspaceFeature?.loadFileTree(folderPath);
}

function openFile(filePath, options = {}) {
  return workspaceFeature?.openFile(filePath, options);
}

function openSourcePath(sourcePath, options = {}) {
  return workspaceFeature?.openSourcePath(sourcePath, options);
}

function readSourceFile(sourcePath) {
  return workspaceFeature?.readSourceFile(sourcePath);
}

function saveFile() {
  return workspaceFeature?.saveFile();
}

function cancelEdit() {
  return workspaceFeature?.cancelEdit();
}

function switchTreeMode(mode) {
  return workspaceFeature?.switchTreeMode(mode);
}

function goalBaseConversationId(goalId) {
  return canvasContextFeature?.goalBaseConversationId(goalId) || `goal:${goalId}`;
}

function isGoalConversationId(conversationId) {
  return canvasContextFeature?.isGoalConversationId(conversationId)
    || (typeof conversationId === "string" && conversationId.startsWith("goal:"));
}

function isConversationForGoal(conversationId, goalId) {
  return canvasContextFeature?.isConversationForGoal(conversationId, goalId)
    || (typeof conversationId === "string" && conversationId.startsWith(goalBaseConversationId(goalId)));
}

function parseGoalConversationContext(conversationId) {
  return canvasContextFeature?.parseGoalConversationContext(conversationId) || null;
}

function renderCanvasGoalContext() {
  return canvasContextFeature?.renderCanvasGoalContext();
}

function getGoalById(goalId) {
  return goalsStateRuntimeFeature?.getGoalById(goalId) || null;
}

function sortGoals(items) {
  return goalsStateRuntimeFeature?.sortGoals(items) || [];
}

function formatGoalStatus(status) {
  if (!status) return "-";
  const labels = {
    draft: "draft",
    aligning: "aligning",
    planning: "planning",
    ready: "ready",
    executing: "executing",
    blocked: "blocked",
    pending_approval: "pending_approval",
    reviewing: "reviewing",
    paused: "paused",
    completed: "completed",
    archived: "archived",
  };
  return labels[status] || String(status);
}

function formatGoalPathSource(source) {
  return source === "user-configured" ? "user-configured" : "default";
}

function goalDocFilePath(goal, fileName) {
  if (!goal?.docRoot) return "";
  return /[\\/]$/.test(goal.docRoot) ? `${goal.docRoot}${fileName}` : `${goal.docRoot}/${fileName}`;
}

function goalRuntimeFilePath(goal, fileName) {
  if (!goal?.runtimeRoot) return "";
  return /[\\/]$/.test(goal.runtimeRoot) ? `${goal.runtimeRoot}${fileName}` : `${goal.runtimeRoot}/${fileName}`;
}

function getGoalDisplayName(goalId) {
  return goalsStateRuntimeFeature?.getGoalDisplayName(goalId) || "-";
}

function syncMemoryTaskGoalFilterUi() {
  return memoryRuntimeFeature?.syncMemoryTaskGoalFilterUi();
}

async function clearMemoryTaskGoalFilter() {
  return memoryRuntimeFeature?.clearMemoryTaskGoalFilter();
}

async function openGoalTaskViewer(goalId) {
  return memoryRuntimeFeature?.openGoalTaskViewer(goalId);
}

function toggleGoalCreateModal(show) {
  return goalsActionsRuntimeFeature?.toggleGoalCreateModal(show);
}

function getGoalCheckpointSlaBadge(checkpoint) {
  if (!checkpoint?.slaAt) return "";
  const deadline = new Date(checkpoint.slaAt);
  if (Number.isNaN(deadline.getTime())) {
    return `<span class="memory-badge">SLA ${escapeHtml(checkpoint.slaAt)}</span>`;
  }
  const overdue = deadline.getTime() < Date.now();
  return `<span class="memory-badge ${overdue ? "is-overdue" : ""}">${overdue ? "SLA 已超时" : "SLA"} ${escapeHtml(formatDateTime(checkpoint.slaAt))}</span>`;
}

function toggleGoalCheckpointActionModal(show, context = null) {
  return goalsRuntimeFeature?.toggleGoalCheckpointActionModal(show, context);
}

function renderGoalsLoading(message) {
  return goalsRuntimeFeature?.renderGoalsLoading(message);
}

function renderGoalsSummary(items) {
  return goalsRuntimeFeature?.renderGoalsSummary(items);
}

function renderGoalsEmpty(message) {
  return goalsRuntimeFeature?.renderGoalsEmpty(message);
}

function renderGoalList(items) {
  return goalsRuntimeFeature?.renderGoalList(items);
}

function refreshGoalsLocale() {
  return goalsRuntimeFeature?.refreshGoalsLocale();
}

function refreshSubtasksLocale() {
  return subtasksRuntimeFeature?.refreshSubtasksLocale();
}

function bindGoalDetailActions(goal) {
  return goalsRuntimeFeature?.bindGoalDetailActions(goal);
}

async function runGoalCheckpointAction(goalId, nodeId, checkpointId, action) {
  return goalsRuntimeFeature?.runGoalCheckpointAction(goalId, nodeId, checkpointId, action);
}

function getGoalActionActor() {
  const uuid = userUuidEl?.value.trim() || "";
  return uuid || "web-ui";
}

async function runGoalApprovalScan(goalId, options = {}) {
  return goalsActionsRuntimeFeature?.runGoalApprovalScan(goalId, options);
}

async function runGoalSuggestionReviewDecision(goalId, input) {
  return goalsActionsRuntimeFeature?.runGoalSuggestionReviewDecision(goalId, input);
}

async function runGoalSuggestionReviewEscalation(goalId, input) {
  return goalsActionsRuntimeFeature?.runGoalSuggestionReviewEscalation(goalId, input);
}

async function runGoalCheckpointEscalation(goalId, nodeId, checkpointId) {
  return goalsActionsRuntimeFeature?.runGoalCheckpointEscalation(goalId, nodeId, checkpointId);
}

async function saveGoalCapabilityGovernance(goalId, nodeId, input) {
  return goalsActionsRuntimeFeature?.saveGoalCapabilityGovernance(goalId, nodeId, input);
}

async function runGoalCommanderDecision(goalId, nodeId, input) {
  return goalsActionsRuntimeFeature?.runGoalCommanderDecision(goalId, nodeId, input);
}

async function submitGoalCheckpointActionForm() {
  return goalsRuntimeFeature?.submitGoalCheckpointActionForm();
}

function renderGoalCapabilityPanelLoading() {
  return goalsSpecialistPanelsFeature?.renderGoalCapabilityPanelLoading();
}

function renderGoalCapabilityPanelError(message) {
  return goalsSpecialistPanelsFeature?.renderGoalCapabilityPanelError(message);
}

function renderGoalCapabilityPanel(goal, payload) {
  return goalsSpecialistPanelsFeature?.renderGoalCapabilityPanel(goal, payload);
}

function getCachedGoalCapabilityEntry(goalId) {
  return goalsSpecialistPanelsFeature?.getCachedGoalCapabilityEntry(goalId) || null;
}

async function ensureGoalCapabilityCache(goal, options = {}) {
  return goalsSpecialistPanelsFeature?.ensureGoalCapabilityCache(goal, options) || null;
}

async function loadGoalCapabilityData(goal) {
  return goalsSpecialistPanelsFeature?.loadGoalCapabilityData(goal);
}

function parseGoalProgressEntries(rawContent) {
  return goalsSpecialistPanelsFeature?.parseGoalProgressEntries(rawContent) || [];
}

function normalizeGoalBoardId(value) {
  return goalsSpecialistPanelsFeature?.normalizeGoalBoardId(value) || "";
}

function parseGoalBoardRef(rawBoardRef) {
  return goalsSpecialistPanelsFeature?.parseGoalBoardRef(rawBoardRef) || {
    boardId: "",
    linkedAt: "",
    updatedAt: "",
  };
}

function renderGoalCanvasPanelLoading() {
  return goalsSpecialistPanelsFeature?.renderGoalCanvasPanelLoading();
}

function renderGoalCanvasPanel(goal, payload) {
  return goalsSpecialistPanelsFeature?.renderGoalCanvasPanel(goal, payload);
}

async function loadGoalCanvasData(goal) {
  return goalsSpecialistPanelsFeature?.loadGoalCanvasData(goal);
}

async function openGoalCanvasList(goalId) {
  return goalsSpecialistPanelsFeature?.openGoalCanvasList(goalId);
}

async function openGoalCanvasBoard(boardId, goalId) {
  return goalsSpecialistPanelsFeature?.openGoalCanvasBoard(boardId, goalId);
}

function renderGoalTrackingPanelLoading() {
  return goalsSpecialistPanelsFeature?.renderGoalTrackingPanelLoading();
}

function renderGoalTrackingPanel(goal, payload) {
  return goalsSpecialistPanelsFeature?.renderGoalTrackingPanel(goal, payload);
}

function renderGoalTrackingPanelError(message) {
  return goalsSpecialistPanelsFeature?.renderGoalTrackingPanelError(message);
}

async function loadGoalTrackingData(goal) {
  return goalsSpecialistPanelsFeature?.loadGoalTrackingData(goal);
}

function renderGoalProgressPanelLoading() {
  return goalsSpecialistPanelsFeature?.renderGoalProgressPanelLoading();
}

function renderGoalProgressPanel(entries) {
  return goalsSpecialistPanelsFeature?.renderGoalProgressPanel(entries);
}

async function loadGoalProgressData(goal) {
  return goalsSpecialistPanelsFeature?.loadGoalProgressData(goal);
}

// ========================== GOAL HANDOFF ==========================

function renderGoalHandoffPanelLoading() {
  return goalsSpecialistPanelsFeature?.renderGoalHandoffPanelLoading();
}

function bindGoalHandoffPanelActions(goal) {
  return goalsSpecialistPanelsFeature?.bindGoalHandoffPanelActions(goal);
}

function renderGoalHandoffPanelError(goal, message) {
  return goalsSpecialistPanelsFeature?.renderGoalHandoffPanelError(goal, message);
}

function renderGoalHandoffPanel(goal, handoff, continuationState = null) {
  return goalsSpecialistPanelsFeature?.renderGoalHandoffPanel(goal, handoff, continuationState);
}

async function loadGoalHandoffData(goal) {
  return goalsSpecialistPanelsFeature?.loadGoalHandoffData(goal);
}

function parseGoalReviewGovernanceSummary(rawSummary) {
  return goalsSpecialistPanelsFeature?.parseGoalReviewGovernanceSummary(rawSummary) || null;
}

function renderGoalReviewGovernancePanelLoading() {
  return goalsSpecialistPanelsFeature?.renderGoalReviewGovernancePanelLoading();
}

function renderGoalReviewGovernancePanelError(message) {
  return goalsSpecialistPanelsFeature?.renderGoalReviewGovernancePanelError(message);
}

function renderGoalReviewGovernancePanel(goal, data) {
  return goalsSpecialistPanelsFeature?.renderGoalReviewGovernancePanel(goal, data);
}

function bindGoalReviewGovernanceActions(goal) {
  return goalsSpecialistPanelsFeature?.bindGoalReviewGovernanceActions(goal);
}

async function loadGoalReviewGovernanceData(goal) {
  return goalsSpecialistPanelsFeature?.loadGoalReviewGovernanceData(goal);
}

function renderGoalDetail(goal) {
  return goalsRuntimeFeature?.renderGoalDetail(goal);
}

async function loadGoals(forceReload = false, preferredGoalId) {
  return goalsRuntimeFeature?.loadGoals(forceReload, preferredGoalId);
}

async function loadSubtasks(forceSelectFirst = false) {
  return subtasksRuntimeFeature?.loadSubtasks(forceSelectFirst);
}

async function loadSubtaskDetail(taskId, options = {}) {
  return subtasksRuntimeFeature?.loadSubtaskDetail(taskId, options);
}

async function openSubtaskById(taskId) {
  return subtasksRuntimeFeature?.openSubtaskById(taskId);
}

async function submitGoalCreateForm() {
  return goalsActionsRuntimeFeature?.submitGoalCreateForm();
}

async function resumeGoal(goalId, options = {}) {
  return goalsActionsRuntimeFeature?.resumeGoal(goalId, options);
}

async function pauseGoal(goalId) {
  return goalsActionsRuntimeFeature?.pauseGoal(goalId);
}

async function generateGoalHandoff(goalId) {
  return goalsActionsRuntimeFeature?.generateGoalHandoff(goalId);
}

function switchMemoryViewerTab(tab) {
  return memoryRuntimeFeature?.switchMemoryViewerTab(tab);
}

function syncMemoryViewerUi() {
  return memoryRuntimeFeature?.syncMemoryViewerUi();
}

async function loadMemoryViewer(forceSelectFirst = false) {
  return memoryRuntimeFeature?.loadMemoryViewer(forceSelectFirst);
}

async function loadExperienceWorkbench(forceSelectFirst = false) {
  return experienceWorkbenchFeature?.loadExperienceWorkbench(forceSelectFirst);
}

async function loadMemoryViewerStats() {
  return memoryRuntimeFeature?.loadMemoryViewerStats();
}

async function loadTaskUsageOverview() {
  return memoryRuntimeFeature?.loadTaskUsageOverview();
}

async function loadTaskViewer(forceSelectFirst = false) {
  return memoryRuntimeFeature?.loadTaskViewer(forceSelectFirst);
}

async function loadTaskDetail(taskId, requestContext = null) {
  return memoryRuntimeFeature?.loadTaskDetail(taskId, requestContext);
}

async function loadMemoryChunkViewer(forceSelectFirst = false) {
  return memoryRuntimeFeature?.loadMemoryChunkViewer(forceSelectFirst);
}

async function loadMemoryDetail(chunkId, requestContext = null, options = {}) {
  return memoryRuntimeFeature?.loadMemoryDetail(chunkId, requestContext, options);
}

async function openTaskFromAudit(taskId) {
  return memoryRuntimeFeature?.openTaskFromAudit(taskId);
}

async function openMemoryFromAudit(chunkId) {
  return memoryRuntimeFeature?.openMemoryFromAudit(chunkId);
}

async function loadCandidateDetail(candidateId) {
  return memoryRuntimeFeature?.loadCandidateDetail(candidateId);
}

function renderMemoryViewerStats(stats) {
  return memoryViewerFeature?.renderMemoryViewerStats(stats);
}

function renderTaskList(items) {
  return memoryViewerFeature?.renderTaskList(items);
}

function renderMemoryList(items) {
  return memoryViewerFeature?.renderMemoryList(items);
}

function renderSharedReviewList(items) {
  return memoryViewerFeature?.renderSharedReviewList(items);
}

function resolveMemoryDetailTargetAgentId(chunkId) {
  return memoryRuntimeFeature?.resolveMemoryDetailTargetAgentId(chunkId);
}

function refreshMemoryLocale() {
  return memoryRuntimeFeature?.refreshMemoryLocale();
}

function renderTaskDetail(task) {
  return memoryDetailRenderFeature?.renderTaskDetail(task);
}

function renderCandidateOnlyDetail(candidate) {
  return memoryViewerFeature?.renderCandidateOnlyDetail(candidate);
}

function renderMemoryDetail(item) {
  return memoryViewerFeature?.renderMemoryDetail(item);
}

function renderMemoryViewerListEmpty(message) {
  if (!memoryViewerListEl) return;
  memoryViewerListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
}

function renderMemoryViewerDetailEmpty(message) {
  if (!memoryViewerDetailEl) return;
  memoryViewerDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
}

function summarizeSourcePath(sourcePath) {
  return memoryDetailRenderFeature?.summarizeSourcePath(sourcePath)
    || String(sourcePath || "(unknown source)");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

syncMemoryViewerUi();
updateSidebarModeButtons();

// Expose switchMode for canvas.js
window._belldandySwitchMode = switchMode;
window._belldandyT = (key, params, fallback) => localeController.t(key, params, fallback);

// Expose canvas context refresh for canvas.js
window._belldandySyncCanvasContext = renderCanvasGoalContext;

// Expose openFile for canvas.js (method node double-click → editor)
window._belldandyOpenFile = (filePath) => openFile(filePath);

// Expose loadConversation for canvas.js (session node double-click → chat)
window._belldandyLoadConversation = (conversationId) => {
  openConversationSession(conversationId);
};

// Initialize canvas app (canvas.js creates window._canvasApp)
if (window._canvasApp) {
  window._canvasApp.init((req) => sendReq(req));
  window._canvasApp.refreshLocale?.();
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function consumeUrlTokenParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) return null;
    params.delete("token");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
    return token;
  } catch {
    return null;
  }
}

if (authModeEl) {
  authModeEl.addEventListener("change", () => {
    if (authModeEl.value !== "token") transientUrlToken = null;
    persistAuthFields({ storeKey: STORE_KEY, authModeEl, authValueEl, transientUrlToken });
    persistSessionAuthToken({ sessionStoreKey: SESSION_AUTH_TOKEN_KEY, authModeEl, authValueEl });
  });
}
if (authValueEl) {
  authValueEl.addEventListener("input", () => {
    if (transientUrlToken && authValueEl.value.trim() !== transientUrlToken) {
      transientUrlToken = null;
    }
    persistAuthFields({ storeKey: STORE_KEY, authModeEl, authValueEl, transientUrlToken });
    persistSessionAuthToken({ sessionStoreKey: SESSION_AUTH_TOKEN_KEY, authModeEl, authValueEl });
  });
}

function configureMarkedOnce() {
  return chatUiFeature?.configureMarkedOnce();
}

function stripThinkBlocks(text) {
  return chatUiFeature?.stripThinkBlocks(text) || "";
}

function sanitizeAssistantHtml(rawHtml) {
  return chatUiFeature?.sanitizeAssistantHtml(rawHtml) || "";
}

