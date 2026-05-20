import { createControlPanelCommanderToggleController } from "./control-panel-commander-toggle.js";
import { createEmailOutboundController } from "./email-outbound.js";
import { createExternalOutboundController } from "./external-outbound.js";
import { createSettingsController } from "./settings.js";
import { createToolSettingsController } from "./tool-settings.js";

export function createSettingsRuntimeFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  setStatus,
  loadServerConfig,
  invalidateServerConfigCache,
  syncAttachmentLimitsFromConfig,
  voiceFeature,
  localeController,
  chatNetworkFeature,
  approvePairing,
  onOpenCommunityConfig,
  onOpenContinuationAction,
  getConnectionAuthMode,
  clientId,
  getSelectedAgentId,
  getActiveConversationId,
  getSelectedSubtaskId,
  isSubtasksViewActive,
  escapeHtml,
  showNotice,
  redactedPlaceholder = "[REDACTED]",
}) {
  const {
    settingsModal,
    openSettingsBtn,
    closeSettingsBtn,
    saveSettingsBtn,
    restartBtn,
    doctorStatusEl,
    cfgLocale,
    cfgApiKey,
    cfgBaseUrl,
    cfgModel,
    cfgModelPreferredProviders,
    refreshModelFallbackConfigBtn,
    modelFallbackConfigMeta,
    cfgModelFallbackContent,
    cfgAssistantModeEnabled,
    cfgExternalOutboundRequireConfirmation,
    cfgAssistantExternalDeliveryPreference,
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
    pairingPendingList,
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
    assistantModeConfigTitleEl,
    assistantModeConfigHelpEl,
    assistantModeConfigHintEl,
    toolSettingsConfirmModal,
    toolSettingsConfirmImpactEl,
    toolSettingsConfirmSummaryEl,
    toolSettingsConfirmExpiryEl,
    toolSettingsConfirmApproveBtn,
    toolSettingsConfirmRejectBtn,
    toolSettingsModal,
    openToolSettingsBtn,
    closeToolSettingsBtn,
    saveToolSettingsBtn,
    toolSettingsBody,
    toolTabButtons,
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
  } = refs;

  const t = localeController?.t || ((_key, _params, fallback) => fallback ?? "");

  voiceFeature?.bindSettingsUI?.({
    inputEl: cfgVoiceShortcut,
    statusEl: cfgVoiceShortcutStatus,
    defaultBtn: cfgVoiceShortcutDefault,
    clearBtn: cfgVoiceShortcutClear,
  });
  localeController?.bindSelect?.(cfgLocale);

  const commanderQuickToggleController = createControlPanelCommanderToggleController({
    refs,
    isConnected,
    sendReq,
    makeId,
    loadServerConfig,
    invalidateServerConfigCache,
    showNotice,
    t,
  });

  const settingsController = createSettingsController({
    refs,
    isConnected,
    sendReq,
    makeId,
    setStatus,
    loadServerConfig,
    invalidateServerConfigCache,
    syncAttachmentLimitsFromConfig,
    onToggle: (show) => voiceFeature?.onSettingsToggle?.(show),
    getConnectionAuthMode,
    onApprovePairing: (code) => approvePairingPending(code, { showSuccessNotice: true }),
    onPairingRequired: (payload) => handlePairingRequired(payload),
    onOpenCommunityConfig,
    onModelCatalogChanged: async () => {
      await chatNetworkFeature?.loadModelList?.();
    },
    onConfigSaved: async (config) => {
      await commanderQuickToggleController.syncFromConfig(config);
    },
    onOpenContinuationAction,
    redactedPlaceholder,
    t,
  });

  const pairingPendingByCode = new Map();

  const toolSettingsController = createToolSettingsController({
    refs: {
      toolSettingsConfirmModal,
      toolSettingsConfirmImpactEl,
      toolSettingsConfirmSummaryEl,
      toolSettingsConfirmExpiryEl,
      toolSettingsConfirmApproveBtn,
      toolSettingsConfirmRejectBtn,
      toolSettingsModal,
      openToolSettingsBtn,
      closeToolSettingsBtn,
      saveToolSettingsBtn,
      toolSettingsBody,
      toolTabButtons,
    },
    isConnected,
    sendReq,
    makeId,
    clientId,
    getSelectedAgentId,
    getActiveConversationId,
    getSelectedSubtaskId,
    isSubtasksViewActive,
    escapeHtml,
    showNotice,
    t,
  });

  const externalOutboundController = createExternalOutboundController({
    refs: {
      externalOutboundConfirmModal,
      externalOutboundConfirmPreviewEl,
      externalOutboundConfirmTargetEl,
      externalOutboundConfirmExpiryEl,
      externalOutboundConfirmApproveBtn,
      externalOutboundConfirmRejectBtn,
    },
    isConnected,
    sendReq,
    makeId,
    clientId,
    escapeHtml,
    showNotice,
    t,
  });
  const emailOutboundController = createEmailOutboundController({
    refs: {
      emailOutboundConfirmModal,
      emailOutboundConfirmPreviewEl,
      emailOutboundConfirmTargetEl,
      emailOutboundConfirmExpiryEl,
      emailOutboundConfirmApproveBtn,
      emailOutboundConfirmRejectBtn,
    },
    isConnected,
    sendReq,
    makeId,
    clientId,
    escapeHtml,
    showNotice,
    t,
  });

  void commanderQuickToggleController.syncFromConfig();

  function syncPairingPendingSurface() {
    settingsController.renderPairingPending?.(
      [...pairingPendingByCode.values()].sort((a, b) => {
        const left = Date.parse(b.updatedAt || "") || 0;
        const right = Date.parse(a.updatedAt || "") || 0;
        return left - right;
      }),
    );
  }

  async function toggleSettings(show, options = {}) {
    await settingsController.toggle(show, options);
    if (show) syncPairingPendingSurface();
  }

  function handleChannelSecurityPending(payload) {
    const channel = typeof payload?.channel === "string" ? payload.channel : "unknown";
    const accountId = typeof payload?.accountId === "string" ? payload.accountId.trim() : "";
    const senderId = typeof payload?.senderId === "string" ? payload.senderId : "";
    const senderName = typeof payload?.senderName === "string" ? payload.senderName.trim() : "";
    const seenCount = Number.isFinite(Number(payload?.seenCount)) ? Number(payload.seenCount) : 0;
    const senderLabel = senderName || senderId || t("settings.channelSecurityPendingUnknownSender", {}, "未知 sender");
    const channelLabel = accountId ? `${channel}/${accountId}` : channel;
    if (settingsModal && !settingsModal.classList.contains("hidden")) {
      void settingsController.refreshChannelSecurityPending();
    }
    const message = seenCount > 1
      ? t(
        "settings.channelSecurityPendingNoticeRepeat",
        { channel: channelLabel, senderName: senderLabel, seenCount },
        `${channelLabel} sender ${senderLabel} 再次触发待审批，当前已拦截 ${seenCount} 次。`,
      )
      : t(
        "settings.channelSecurityPendingNoticeMessage",
        { channel: channelLabel, senderName: senderLabel },
        `${channelLabel} sender ${senderLabel} 已进入待审批队列。`,
      );
    showNotice(
      t("settings.channelSecurityPendingNoticeTitle", {}, "待审批 Sender"),
      message,
      "info",
      6800,
      {
        actionLabel: t("settings.channelSecurityPendingNoticeAction", {}, "去审批"),
        onAction: () => {
          void settingsController.openChannelSecurityPending();
        },
      },
    );
  }

  function handlePairingRequired(payload) {
    const code = typeof payload?.code === "string" ? payload.code.trim().toUpperCase() : "";
    if (!code) return;
    const message = typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : t("settings.pairingPendingDefaultMessage", {}, "当前 WebChat 会话需要完成配对批准。");
    const clientIdValue = typeof payload?.clientId === "string" ? payload.clientId.trim() : "";
    if (clientIdValue) {
      for (const [existingCode, item] of pairingPendingByCode.entries()) {
        if (item.clientId === clientIdValue && existingCode !== code) {
          pairingPendingByCode.delete(existingCode);
        }
      }
    }
    pairingPendingByCode.set(code, {
      code,
      message,
      clientId: clientIdValue,
      updatedAt: new Date().toISOString(),
    });
    settingsController.markPairingRequired?.();
    syncPairingPendingSurface();
    showNotice(
      t("settings.pairingPendingNoticeTitle", {}, "待批准配对"),
      t("settings.pairingPendingNoticeMessage", { code }, `检测到新的配对码 ${code}，可直接在 WebChat 设置页内批准。`),
      "info",
      6800,
      {
        actionLabel: t("settings.pairingPendingNoticeAction", {}, "去批准"),
        onAction: () => {
          void settingsController.openPairingPending();
        },
      },
    );
    void settingsController.openPairingPending?.({ skipLoad: true });
  }

  async function approvePairingPending(code, options = {}) {
    if (typeof approvePairing !== "function") {
      return { ok: false, message: t("settings.pairingApproveUnavailable", {}, "当前连接不支持配对批准。") };
    }
    const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
    if (!normalizedCode) {
      return { ok: false, message: t("settings.pairingCodeMissing", {}, "缺少配对码，无法批准。") };
    }
    const res = await approvePairing(normalizedCode);
    if (!res?.ok) {
      return {
        ok: false,
        message: res?.message || t("settings.pairingApproveFailedFallback", {}, "配对批准失败。"),
      };
    }
    pairingPendingByCode.delete(normalizedCode);
    syncPairingPendingSurface();
    if (settingsModal && !settingsModal.classList.contains("hidden")) {
      await settingsController.toggle(true, { section: "pairing-pending" });
      syncPairingPendingSurface();
    }
    if (options.showSuccessNotice !== false) {
      showNotice(
        t("settings.pairingApprovedTitle", {}, "配对已批准"),
        t("settings.pairingApprovedMessage", { code: normalizedCode }, `配对码 ${normalizedCode} 已批准，可直接继续在当前 WebChat 对话。`),
        "success",
        3200,
      );
    }
    return res;
  }

  return {
    refreshLocale() {
      toolSettingsController.refreshLocale?.();
      commanderQuickToggleController.refreshLocale?.();
    },
    syncCommanderQuickToggle(config) {
      return commanderQuickToggleController.syncFromConfig(config);
    },
    openToolSettingsTab(tab) {
      return toolSettingsController.openTab?.(tab);
    },
    toggleSettings,
    openPairingPending(options = {}) {
      return settingsController.openPairingPending?.(options);
    },
    hasPendingPairing() {
      return pairingPendingByCode.size > 0;
    },
    handlePairingRequired,
    approvePairingPending,
    openChannels() {
      return settingsController.openChannels();
    },
    handleChannelSecurityPending,
    handleToolSettingsConfirmRequired(payload) {
      toolSettingsController.handleConfirmRequired(payload);
    },
    handleToolSettingsConfirmResolved(payload) {
      toolSettingsController.handleConfirmResolved(payload);
    },
    handleExternalOutboundConfirmRequired(payload) {
      externalOutboundController.handleConfirmRequired(payload);
    },
    handleExternalOutboundConfirmResolved(payload) {
      externalOutboundController.handleConfirmResolved(payload);
    },
    handleEmailOutboundConfirmRequired(payload) {
      emailOutboundController.handleConfirmRequired(payload);
    },
    handleEmailOutboundConfirmResolved(payload) {
      emailOutboundController.handleConfirmResolved(payload);
    },
    handleToolsConfigUpdated(payload) {
      toolSettingsController.handleToolsConfigUpdated(payload);
    },
  };
}
