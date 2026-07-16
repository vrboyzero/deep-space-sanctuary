import { renderDoctorObservabilityCards } from "./doctor-observability.js";
import { setExperienceDraftGenerateNoticeEnabled } from "./experience-draft-notice-mode.js";
import { setGovernanceDetailMode } from "./governance-detail-mode.js";
import {
  ASSISTANT_MODE_PRESET_CUSTOM,
  applyAssistantModePreset,
  applyAssistantModeSettingsConfig,
  collectAssistantModeSettingsUpdates,
  readAssistantModeSettingsFromRefs,
  resolveAssistantModePreset,
} from "./assistant-mode-settings-config.js";
import { applyAssistantModeSettingsViewModel } from "./assistant-mode-settings-view-model.js";

export function createSettingsController({
  refs,
  isConnected,
  sendReq,
  makeId,
  setStatus,
  loadServerConfig,
  invalidateServerConfigCache,
  syncAttachmentLimitsFromConfig,
  onToggle,
  getConnectionAuthMode,
  onApprovePairing,
  onPairingRequired,
  onOpenCommunityConfig,
  onModelCatalogChanged,
  onConfigSaved,
  onOpenContinuationAction,
  getWebchatPerformanceSummary,
  redactedPlaceholder = "[REDACTED]",
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    settingsModal,
    settingsTabButtons,
    settingsTabPanels,
    openSettingsBtn,
    closeSettingsBtn,
    saveSettingsBtn,
    restartBtn,
    doctorStatusEl,
    cfgApiKey,
    cfgHost,
    cfgPort,
    cfgGatewayPort,
    cfgUpdateCheckEnabled,
    cfgUpdateCheckTimeoutMs,
    cfgUpdateCheckApiUrl,
    cfgDevRuntimeDistGuard,
    cfgAuthMode,
    cfgAuthToken,
    cfgAuthPassword,
    cfgAllowedOrigins,
    cfgAttachmentMaxFileBytes,
    cfgAttachmentMaxTotalBytes,
    cfgAttachmentTextCharLimit,
    cfgAttachmentTextTotalCharLimit,
    cfgAudioTranscriptAppendCharLimit,
    cfgBaseUrl,
    cfgModel,
    cfgAgentProvider,
    cfgOpenAiStreamEnabled,
    cfgOpenAiWireApi,
    cfgOpenAiThinking,
    cfgOpenAiReasoningEffort,
    cfgResponsesSanitizeToolSchema,
    cfgOpenAiMaxRetries,
    cfgOpenAiRetryBackoffMs,
    cfgOpenAiProxyUrl,
    cfgPrimaryWarmupEnabled,
    cfgPrimaryWarmupTimeoutMs,
    cfgPrimaryWarmupCooldownMs,
    cfgOpenAiSystemPrompt,
    cfgAgentTimeoutMs,
    cfgAgentProtocol,
    cfgVideoFileApiUrl,
    cfgVideoFileApiKey,
    cfgModelPreferredProviders,
    refreshModelFallbackConfigBtn,
    modelFallbackConfigMeta,
    cfgModelFallbackContent,
    cfgAssistantModeEnabled,
    cfgAssistantModePreset,
    cfgExternalOutboundRequireConfirmation,
    cfgAssistantExternalDeliveryPreference,
    cfgHeartbeat,
    cfgHeartbeatEnabled,
    cfgHeartbeatActiveHours,
    cfgStarweaverActiveNotifyEnabled,
    cfgStarweaverActiveNotifyPollIntervalMs,
    cfgBrowserRelayEnabled,
    cfgRelayPort,
    cfgMcpEnabled,
    cfgBrowserAllowedDomains,
    cfgBrowserDeniedDomains,
    cfgAgentBridgeEnabled,
    cfgToolGroups,
    cfgMaxInputTokens,
    cfgMaxOutputTokens,
    cfgToolLoopIterationBudget,
    cfgToolLoopWarningFraction,
    cfgWebAllowPrivilegedSafeScope,
    cfgPrivilegedWorkspaceWriteChannels,
    cfgDangerousToolsEnabled,
    cfgToolsPolicyFile,
    cfgSubAgentMaxConcurrent,
    cfgSubAgentMaxQueueSize,
    cfgSubAgentTimeoutMs,
    cfgSubAgentMaxDepth,
    cfgWorkflowMaxConcurrent,
    cfgWorkflowMaxQueueSize,
    cfgWorkflowTimeoutMs,
    cfgWorkflowAgentTimeoutMs,
    cfgWorkflowMaxAgentCalls,
    cfgWorkflowMaxDepth,
    cfgMemoryEnabled,
    refreshMemoryConfiguredSourcesBtn,
    previewMemoryInventoryBtn,
    previewMemoryExternalIngestBtn,
    approveMemoryExternalIngestReportBtn,
    rejectMemoryExternalIngestReportBtn,
    applyMemoryExternalIngestReportBtn,
    memoryConfiguredSourcesMeta,
    memoryConfiguredSourcesActionStatus,
    cfgMemoryConfiguredSourceId,
    cfgMemoryConfiguredSourcesContent,
    cfgMemoryConfiguredSourcesPreviewContent,
    cfgMemoryConfiguredSourcesActionNote,
    cfgCronEnabled,
    cfgEmbeddingEnabled,
    cfgEmbeddingProvider,
    cfgEmbeddingApiKey,
    cfgEmbeddingBaseUrl,
    cfgEmbeddingModel,
    cfgLocalEmbeddingModel,
    cfgEmbeddingBatchSize,
    cfgContextInjectionEnabled,
    cfgContextInjectionLimit,
    cfgContextInjectionIncludeSession,
    cfgContextInjectionTaskLimit,
    cfgContextInjectionAllowedCategories,
    cfgCarryoverContextEnabled,
    cfgAutoRecallEnabled,
    cfgAutoRecallLimit,
    cfgAutoRecallMinScore,
    cfgToolResultTranscriptCharLimit,
    cfgMindProfileRuntimeEnabled,
    cfgMindProfileRuntimeMaxLines,
    cfgMindProfileRuntimeMaxLineLength,
    cfgMindProfileRuntimeMaxChars,
    cfgMindProfileRuntimeMinSignalCount,
    cfgMemorySummaryEnabled,
    cfgMemorySummaryModel,
    cfgMemorySummaryBaseUrl,
    cfgMemorySummaryApiKey,
    cfgMemoryEvolutionEnabled,
    cfgMemoryEvolutionMinMessages,
    cfgMemoryEvolutionModel,
    cfgMemoryEvolutionBaseUrl,
    cfgMemoryEvolutionApiKey,
    cfgMemorySessionDigestMaxRuns,
    cfgMemorySessionDigestWindowMs,
    cfgMemoryDurableExtractionMaxRuns,
    cfgMemoryDurableExtractionWindowMs,
    cfgMemoryDurableExtractionMinPendingMessages,
    cfgMemoryDurableExtractionMinMessageDelta,
    cfgMemoryDurableExtractionSuccessCooldownMs,
    cfgMemoryDurableExtractionFailureBackoffMs,
    cfgMemoryDurableExtractionFailureBackoffMaxMs,
    cfgTeamSharedMemoryEnabled,
    cfgSharedReviewClaimTimeoutMs,
    cfgTaskMemoryEnabled,
    cfgTaskStatsWhenMemoryDisabled,
    cfgTaskSummaryEnabled,
    cfgTaskSummaryModel,
    cfgTaskSummaryBaseUrl,
    cfgTaskSummaryApiKey,
    cfgTaskSummaryMinDurationMs,
    cfgTaskSummaryMinToolCalls,
    cfgTaskSummaryMinTokenTotal,
    cfgExperienceAutoPromotionEnabled,
    cfgExperienceAutoMethodEnabled,
    cfgExperienceAutoSkillEnabled,
    cfgMethodGenerationConfirmRequired,
    cfgSkillGenerationConfirmRequired,
    cfgMethodPublishConfirmRequired,
    cfgSkillPublishConfirmRequired,
    cfgExperienceSynthesisMaxSimilarSources,
    cfgExperienceSynthesisMaxSourceContentChars,
    cfgExperienceSynthesisTotalSourceContentCharBudget,
    cfgMemoryDeepRetrievalEnabled,
    cfgMemoryNodeAssistedRetrievalEnabled,
    cfgEmbeddingQueryPrefix,
    cfgEmbeddingPassagePrefix,
    cfgRerankerMinScore,
    cfgRerankerLengthNormAnchor,
    cfgMemoryIndexerVerboseWatch,
    cfgTaskDedupGuardEnabled,
    cfgTaskDedupWindowMinutes,
    cfgTaskDedupMode,
    cfgTaskDedupPolicy,
    cfgToolsEnabled,
    cfgAgentToolControlMode,
    cfgAgentToolControlConfirmPassword,
    cfgTtsEnabled,
    cfgTtsProvider,
    cfgTtsVoice,
    cfgTtsModel,
    cfgTtsOpenAIBaseUrl,
    cfgTtsOpenAIApiKey,
    cfgImageEnabled,
    cfgImageProvider,
    cfgImageApiKey,
    cfgImageBaseUrl,
    cfgImageModel,
    cfgImageOutputFormat,
    cfgImageTimeoutMs,
    cfgImageUnderstandEnabled,
    cfgImageUnderstandApiKey,
    cfgImageUnderstandProvider,
    cfgImageUnderstandBaseUrl,
    cfgImageUnderstandModel,
    cfgImageUnderstandTimeoutMs,
    cfgImageUnderstandMaxInputMb,
    cfgImageUnderstandPrompt,
    cfgImageUnderstandAutoOnAttachment,
    cfgBrowserScreenshotAutoUnderstand,
    cfgCameraSnapAutoUnderstand,
    cfgScreenCaptureAutoUnderstand,
    cfgVideoUnderstandEnabled,
    cfgVideoUnderstandApiKey,
    cfgVideoUnderstandProvider,
    cfgVideoUnderstandBaseUrl,
    cfgVideoUnderstandModel,
    cfgVideoUnderstandTimeoutMs,
    cfgVideoUnderstandTransport,
    cfgVideoUnderstandFps,
    cfgVideoUnderstandMaxInputMb,
    cfgVideoUnderstandPrompt,
    cfgVideoUnderstandAutoOnAttachment,
    cfgVideoUnderstandAutoAttachmentMaxTimelineItems,
    cfgVideoUnderstandAutoAttachmentSummaryCharLimit,
    cfgSttProvider,
    cfgSttModel,
    cfgSttOpenAiBaseUrl,
    cfgSttOpenAiApiKey,
    cfgSttLanguage,
    cfgSttGroqApiKey,
    cfgSttGroqBaseUrl,
    cfgQqSttFallbackProviders,
    cfgCameraNativeHelperCommand,
    cfgCameraNativeHelperArgsJson,
    cfgCameraNativeHelperCwd,
    cfgCameraNativeHelperStartupTimeoutMs,
    cfgCameraNativeHelperRequestTimeoutMs,
    cfgCameraNativeHelperIdleShutdownMs,
    cfgCameraNativeHelperEnvJson,
    cfgCameraNativeHelperPowershellCommand,
    cfgCameraNativeHelperPowershellArgsJson,
    cfgCameraNativeHelperFfmpegCommand,
    cfgCameraNativeHelperFfmpegArgsJson,
    cfgDashScopeApiKey,
    cfgFacetAnchor,
    cfgInjectAgents,
    cfgInjectSoul,
    cfgInjectMemory,
    cfgInjectMethodSkillList,
    cfgPromptFocusEnabled,
    cfgPromptFocusSemanticEnabled,
    cfgPromptFocusSemanticMinScore,
    cfgMaxSystemPromptChars,
    cfgMaxHistory,
    pairingPendingList,
    cfgConversationKindMain,
    cfgConversationKindSubtask,
    cfgConversationKindGoal,
    cfgConversationKindHeartbeat,
    cfgPromptExperimentDisableSections,
    cfgPromptExperimentSectionPriorityOverrides,
    cfgPromptExperimentDisableToolContracts,
    cfgPromptSnapshotMaxRuns,
    cfgPromptSnapshotMaxPersistedRuns,
    cfgPromptSnapshotEmailThreadMaxRuns,
    cfgPromptSnapshotHeartbeatMaxRuns,
    cfgPromptSnapshotRetentionDays,
    cfgCompactionEnabled,
    cfgCompactionThreshold,
    cfgCompactionKeepRecent,
    cfgCompactionTriggerFraction,
    cfgCompactionArchivalThreshold,
    cfgCompactionWarningThreshold,
    cfgCompactionBlockingThreshold,
    cfgCompactionMaxConsecutiveFailures,
    cfgCompactionMaxPtlRetries,
    cfgCompactionContextWindowFraction,
    cfgModelContextWindow,
    cfgCompressionReferenceStore,
    cfgPreflightCompressionEnabled,
    cfgPreflightCompressionMode,
    cfgPreflightAttachmentThresholdChars,
    cfgPreflightTargetRatio,
    cfgPreflightMinSavingsRatio,
    cfgPreflightTimeoutMs,
    cfgPreflightAttachmentReference,
    cfgPreflightSidecarRetentionMs,
    cfgPreflightSidecarMaxEntries,
    cfgCompressionPersistentReferenceStore,
    cfgCompressionPersistentReferenceTtlMs,
    cfgCompressionPersistentReferenceMaxEntries,
    cfgBudgetProtectMode,
    cfgBudgetProtectKeepRecentRounds,
    cfgStablePrefixSplit,
    cfgCompactionModelRoute,
    cfgDeepseekRoutePolicyEnabled,
    cfgCompactionModel,
    cfgCompactionBaseUrl,
    cfgCompactionApiKey,
    channelsSettingsSection,
    openCommunityConfigBtn,
    cfgCommunityApiEnabled,
    cfgCommunityApiToken,
    cfgEmailOutboundRequireConfirmation,
    cfgEmailDefaultProvider,
    cfgEmailSmtpEnabled,
    cfgEmailImapEnabled,
    cfgEmailSmtpAccountId,
    cfgEmailSmtpHost,
    cfgEmailSmtpPort,
    cfgEmailSmtpSecure,
    cfgEmailSmtpUser,
    cfgEmailSmtpPass,
    cfgEmailSmtpFromAddress,
    cfgEmailSmtpFromName,
    cfgEmailInboundAgentId,
    cfgEmailImapAccountId,
    cfgEmailImapHost,
    cfgEmailImapPort,
    cfgEmailImapSecure,
    cfgEmailImapUser,
    cfgEmailImapPass,
    cfgEmailImapMailbox,
    cfgEmailImapPollIntervalMs,
    cfgEmailImapConnectTimeoutMs,
    cfgEmailImapSocketTimeoutMs,
    cfgEmailImapBootstrapMode,
    cfgEmailImapRecentWindowLimit,
    cfgChannelRouterEnabled,
    cfgChannelRouterConfigPath,
    cfgChannelRouterDefaultAgentId,
    cfgChannelIngressMaxConcurrent,
    cfgChannelIngressMaxConcurrentPerChannel,
    cfgChannelIngressMaxPendingPerSession,
    cfgChannelIngressMaxQueued,
    cfgChannelIngressMaxWaitMs,
    cfgChannelIngressMaxPayloadBytes,
    cfgChannelIngressMaxQueuedPayloadBytes,
    cfgFeishuAppId,
    cfgFeishuAppSecret,
    cfgFeishuAgentId,
    cfgQqAppId,
    cfgQqAppSecret,
    cfgQqAgentId,
    cfgQqSandbox,
    cfgQqEventSampleCaptureEnabled,
    cfgQqEventSampleCaptureDir,
    cfgDiscordEnabled,
    cfgDiscordBotToken,
    cfgDiscordDefaultChannelId,
    refreshChannelSecurityBtn,
    channelSecurityConfigMeta,
    cfgChannelSecurityContent,
    channelReplyChunkingConfigMeta,
    cfgChannelReplyChunkingContent,
    channelSecurityPendingList,
    cfgWebhookPreauthMaxBytes,
    cfgWebhookPreauthTimeoutMs,
    cfgWebhookRateLimitWindowMs,
    cfgWebhookRateLimitMaxRequests,
    cfgWebhookRateLimitMaxTrackedKeys,
    cfgWebhookMaxInFlightPerKey,
    cfgWebhookMaxInFlightTrackedKeys,
    cfgTokenUsageUploadEnabled,
    cfgTokenUsageUploadUrl,
    cfgTokenUsageUploadApiKey,
    cfgTokenUsageUploadTimeoutMs,
    cfgTokenUsageStrictUuid,
    cfgWebchatCostBudgetUsd,
    cfgWebchatCostBudgetWarnFraction,
    cfgAutoTaskTimeEnabled,
    cfgAutoTaskTokenEnabled,
    cfgWebhookConfigPath,
    cfgWebhookIdempotencyWindowMs,
    cfgStateDir,
    cfgStateDirWindows,
    cfgStateDirWsl,
    cfgWorkspaceDir,
    cfgExtraWorkspaceRoots,
    cfgWebRoot,
    cfgGovernanceDetailMode,
    cfgCommanderMode,
    cfgCommanderAgentId,
    cfgGoalExecutionMode,
    cfgGoalGovernanceMode,
    cfgCommanderAutoReworkEnabled,
    cfgExperienceDraftGenerateNoticeEnabled,
    cfgLogLevel,
    cfgLogConsole,
    cfgLogFile,
    cfgLogDir,
    cfgLogMaxSize,
    cfgLogRetentionDays,
    cfgDreamAutoHeartbeatEnabled,
    cfgDreamAutoCronEnabled,
    cfgDreamOpenAIThinking,
    cfgDreamOpenAIReasoningEffort,
    cfgDreamOpenAITimeoutMs,
    cfgDreamOpenAIMaxTokens,
    cfgDreamObsidianEnabled,
    cfgDreamObsidianVaultPath,
    cfgDreamObsidianRootDir,
    cfgCommonsObsidianEnabled,
    cfgCommonsObsidianVaultPath,
    cfgCommonsObsidianRootDir,
    cfgRoomInjectThreshold,
    cfgRoomMembersCacheTtl,
    assistantModeConfigTitleEl,
    assistantModeConfigHelpEl,
    assistantModeConfigHintEl,
  } = refs;
  const assistantModeRefs = {
    cfgAssistantModeEnabled,
    cfgExternalOutboundRequireConfirmation,
    cfgAssistantExternalDeliveryPreference,
    cfgHeartbeat,
    cfgHeartbeatEnabled,
    cfgHeartbeatActiveHours,
    cfgCronEnabled,
    cfgStarweaverActiveNotifyEnabled,
    cfgStarweaverActiveNotifyPollIntervalMs,
  };
  const aliyunApiKeyTargets = [
    "DASHSCOPE_API_KEY",
    "BELLDANDY_COMPACTION_API_KEY",
    "BELLDANDY_MEMORY_EVOLUTION_API_KEY",
    "BELLDANDY_MEMORY_SUMMARY_API_KEY",
    "BELLDANDY_EMBEDDING_OPENAI_API_KEY",
    "BELLDANDY_TASK_SUMMARY_API_KEY",
    "BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY",
    "BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY",
  ];
  let lastLoadedConfig = null;
  let lastLoadedFormState = null;
  let lastLoadedChannelSecurityContent = '{\n  "version": 1,\n  "channels": {}\n}\n';
  let lastLoadedChannelReplyChunkingContent = '{\n  "version": 1,\n  "channels": {}\n}\n';
  let lastLoadedConfiguredMemorySourcesContent = "[]\n";
  let lastConfiguredMemoryPreviewPayload = null;
  let doctorRequestVersion = 0;
  const tabButtons = Array.isArray(settingsTabButtons) ? settingsTabButtons.filter(Boolean) : [];
  const tabPanels = Array.isArray(settingsTabPanels) ? settingsTabPanels.filter(Boolean) : [];
  const conversationKindCheckboxes = {
    main: cfgConversationKindMain,
    subtask: cfgConversationKindSubtask,
    goal: cfgConversationKindGoal,
    heartbeat: cfgConversationKindHeartbeat,
  };
  function readCurrentAssistantModeSettings() {
    return readAssistantModeSettingsFromRefs(assistantModeRefs);
  }

  function applyAssistantModeCopy(options = {}) {
    return applyAssistantModeSettingsViewModel({
      assistantModeConfigTitleEl,
      assistantModeConfigHelpEl,
      assistantModeConfigHintEl,
      cfgAssistantModePreset,
    }, t, options);
  }

  function syncAssistantModeForm(options = {}) {
    const settings = applyAssistantModeSettingsConfig(
      assistantModeRefs,
      collectAssistantModeSettingsUpdates(assistantModeRefs, options),
    );
    applyAssistantModeCopy({ settings });
    return settings;
  }

  function extractPairingRequiredPayload(res) {
    if (!res || res.ok !== false || res.error?.code !== "pairing_required") {
      return null;
    }
    const message = typeof res.error?.message === "string" && res.error.message.trim()
      ? res.error.message.trim()
      : "Pairing required.";
    const codeMatch = message.match(/Code:\s*([A-Z0-9-]+)/i);
    return {
      code: codeMatch ? codeMatch[1] : "",
      message,
    };
  }

  function handlePairingRequiredResponse(res) {
    const payload = extractPairingRequiredPayload(res);
    if (!payload) return false;
    onPairingRequired?.(payload);
    applyAssistantModeCopy({
      pairingRequired: true,
      settings: readCurrentAssistantModeSettings(),
    });
    return true;
  }

  applyAssistantModeCopy();
  if (cfgAssistantModePreset && typeof cfgAssistantModePreset.addEventListener === "function") {
    cfgAssistantModePreset.addEventListener("change", () => {
      const presetKey = cfgAssistantModePreset.value || ASSISTANT_MODE_PRESET_CUSTOM;
      if (presetKey !== ASSISTANT_MODE_PRESET_CUSTOM) {
        const settings = applyAssistantModePreset(assistantModeRefs, presetKey);
        applyAssistantModeCopy({
          settings,
          currentPreset: presetKey,
        });
        return;
      }
      applyAssistantModeCopy({
        settings: readCurrentAssistantModeSettings(),
        currentPreset: resolveAssistantModePreset(readCurrentAssistantModeSettings()),
      });
    });
  }
  if (cfgAssistantModeEnabled && typeof cfgAssistantModeEnabled.addEventListener === "function") {
    cfgAssistantModeEnabled.addEventListener("change", () => {
      syncAssistantModeForm({
        applyEnabledDefaults: cfgAssistantModeEnabled.checked === true,
      });
    });
  }
  for (const inputEl of [cfgHeartbeatEnabled, cfgCronEnabled]) {
    if (!inputEl || typeof inputEl.addEventListener !== "function") continue;
    inputEl.addEventListener("change", () => {
      const settings = applyAssistantModeSettingsConfig(
        assistantModeRefs,
        collectAssistantModeSettingsUpdates(assistantModeRefs, {
          useDriverState: true,
          applyEnabledDefaults: false,
        }),
      );
      applyAssistantModeCopy({ settings });
    });
  }
  for (const inputEl of [
    cfgExternalOutboundRequireConfirmation,
    cfgAssistantExternalDeliveryPreference,
    cfgHeartbeat,
    cfgHeartbeatActiveHours,
    cfgStarweaverActiveNotifyEnabled,
    cfgStarweaverActiveNotifyPollIntervalMs,
  ]) {
    if (!inputEl || typeof inputEl.addEventListener !== "function") continue;
    inputEl.addEventListener("change", () => {
      applyAssistantModeCopy({
        settings: readCurrentAssistantModeSettings(),
      });
    });
  }

  function loadConversationAllowedKinds(rawValue) {
    const defaultKinds = ["main", "subtask", "goal", "heartbeat"];
    const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
    const kinds = !normalized || normalized === "all"
      ? defaultKinds
      : normalized === "none"
        ? []
      : normalized.split(",").map((item) => item.trim()).filter(Boolean);
    Object.entries(conversationKindCheckboxes).forEach(([kind, inputEl]) => {
      if (!inputEl) return;
      inputEl.checked = kinds.includes(kind);
    });
  }

  function serializeConversationAllowedKinds() {
    const kinds = Object.entries(conversationKindCheckboxes)
      .filter(([, inputEl]) => Boolean(inputEl?.checked))
      .map(([kind]) => kind)
      .join(",");
    return kinds || "none";
  }

  function getSettingsTabId(buttonOrPanel) {
    if (!buttonOrPanel || typeof buttonOrPanel !== "object") return "";
    return buttonOrPanel.dataset?.settingsTabTarget
      || buttonOrPanel.dataset?.settingsPanel
      || "";
  }

  function getLiveSettingsTabButtons() {
    if (settingsModal && typeof settingsModal.querySelectorAll === "function") {
      return [...settingsModal.querySelectorAll(".settings-tab")];
    }
    return tabButtons;
  }

  function getLiveSettingsTabPanels() {
    if (settingsModal && typeof settingsModal.querySelectorAll === "function") {
      return [...settingsModal.querySelectorAll(".settings-panel")];
    }
    return tabPanels;
  }

  function setSettingsTabButtonState(buttonEl, active) {
    if (!buttonEl) return;
    buttonEl.classList?.toggle?.("active", active);
    if (typeof buttonEl.setAttribute === "function") {
      buttonEl.setAttribute("aria-selected", active ? "true" : "false");
      buttonEl.setAttribute("tabindex", active ? "0" : "-1");
    }
  }

  function setSettingsPanelState(panelEl, active) {
    if (!panelEl) return;
    panelEl.classList?.toggle?.("active", active);
    if ("hidden" in panelEl) {
      panelEl.hidden = !active;
    } else {
      panelEl.classList?.toggle?.("hidden", !active);
    }
  }

  function activateSettingsTab(tabId = "model") {
    const normalizedTabId = typeof tabId === "string" && tabId.trim() ? tabId.trim() : "model";
    getLiveSettingsTabButtons().forEach((buttonEl) => {
      setSettingsTabButtonState(buttonEl, getSettingsTabId(buttonEl) === normalizedTabId);
    });
    getLiveSettingsTabPanels().forEach((panelEl) => {
      setSettingsPanelState(panelEl, getSettingsTabId(panelEl) === normalizedTabId);
    });
    return normalizedTabId;
  }

  function resolveSettingsSectionRoute(section) {
    if (section === "channels") {
      return { tabId: "channels", target: channelsSettingsSection };
    }
    if (section === "pairing-pending") {
      return { tabId: "model", target: pairingPendingList };
    }
    if (section === "channel-security-pending") {
      return { tabId: "model", target: channelSecurityPendingList };
    }
    return { tabId: "model", target: null };
  }

  if (settingsModal && typeof settingsModal.addEventListener === "function") {
    settingsModal.addEventListener("click", (event) => {
      const target = event?.target;
      const buttonEl = typeof target?.closest === "function"
        ? target.closest(".settings-tab")
        : null;
      if (!buttonEl) return;
      activateSettingsTab(getSettingsTabId(buttonEl) || "model");
    });
  } else {
    tabButtons.forEach((buttonEl) => {
      if (!buttonEl || typeof buttonEl.addEventListener !== "function") return;
      buttonEl.addEventListener("click", () => {
        activateSettingsTab(getSettingsTabId(buttonEl) || "model");
      });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      void toggle(true);
    });
  }
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", () => {
      void toggle(false);
    });
  }
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      void saveConfig();
    });
  }
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      void restartServer();
    });
  }
  if (openCommunityConfigBtn) {
    openCommunityConfigBtn.addEventListener("click", () => {
      void openCommunityConfig();
    });
  }
  if (refreshModelFallbackConfigBtn) {
    refreshModelFallbackConfigBtn.addEventListener("click", () => {
      void loadModelFallbackConfig();
    });
  }
  if (refreshChannelSecurityBtn) {
    refreshChannelSecurityBtn.addEventListener("click", () => {
      void loadChannelSecuritySurface();
    });
  }
  if (refreshMemoryConfiguredSourcesBtn) {
    refreshMemoryConfiguredSourcesBtn.addEventListener("click", () => {
      void loadConfiguredMemorySources();
    });
  }
  if (previewMemoryInventoryBtn) {
    previewMemoryInventoryBtn.addEventListener("click", () => {
      void previewConfiguredMemoryInventory();
    });
  }
  if (previewMemoryExternalIngestBtn) {
    previewMemoryExternalIngestBtn.addEventListener("click", () => {
      void previewConfiguredMemoryExternalIngest();
    });
  }
  if (approveMemoryExternalIngestReportBtn) {
    approveMemoryExternalIngestReportBtn.addEventListener("click", () => {
      void reviewConfiguredMemoryReport("approved");
    });
  }
  if (rejectMemoryExternalIngestReportBtn) {
    rejectMemoryExternalIngestReportBtn.addEventListener("click", () => {
      void reviewConfiguredMemoryReport("rejected");
    });
  }
  if (applyMemoryExternalIngestReportBtn) {
    applyMemoryExternalIngestReportBtn.addEventListener("click", () => {
      void applyConfiguredMemoryReport();
    });
  }
  if (channelSecurityPendingList) {
    channelSecurityPendingList.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button[data-channel-security-action]") : null;
      if (!target) return;
      const action = target.getAttribute("data-channel-security-action");
      const requestId = target.getAttribute("data-channel-security-request-id");
      if (!action || !requestId) return;
      void handleChannelSecurityPendingAction(action, requestId, target);
    });
  }
  if (pairingPendingList) {
    pairingPendingList.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button[data-pairing-action]") : null;
      if (!target) return;
      const action = target.getAttribute("data-pairing-action");
      const code = target.getAttribute("data-pairing-code");
      if (action !== "approve" || !code) return;
      void handlePairingPendingAction(code, target);
    });
  }
  async function toggle(show, options = {}) {
    if (!settingsModal) return;
    if (show) {
      settingsModal.classList.remove("hidden");
      onToggle?.(true);
      if (!options.skipLoad) {
        await loadConfig();
        await Promise.all([
          loadModelFallbackConfig(),
          loadConfiguredMemorySources(),
          loadChannelSecuritySurface(),
          runDoctor(),
        ]);
        lastLoadedFormState = captureSettingsFormState();
      }
      const { tabId, target } = resolveSettingsSectionRoute(options.section);
      activateSettingsTab(tabId);
      if (target?.scrollIntoView) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    onToggle?.(false);
    settingsModal.classList.add("hidden");
  }

  async function loadConfig() {
    if (!isConnected()) return;
    const c = await loadServerConfig?.();
    if (!c) return;
    lastLoadedConfig = c;
    syncAttachmentLimitsFromConfig(c);
    if (cfgHost) cfgHost.value = c["BELLDANDY_HOST"] || "";
    if (cfgPort) cfgPort.value = c["BELLDANDY_PORT"] || "";
    if (cfgGatewayPort) cfgGatewayPort.value = c["BELLDANDY_GATEWAY_PORT"] || "";
    if (cfgUpdateCheckEnabled) cfgUpdateCheckEnabled.checked = c["BELLDANDY_UPDATE_CHECK"] !== "false";
    if (cfgUpdateCheckTimeoutMs) cfgUpdateCheckTimeoutMs.value = c["BELLDANDY_UPDATE_CHECK_TIMEOUT_MS"] || "";
    if (cfgUpdateCheckApiUrl) cfgUpdateCheckApiUrl.value = c["BELLDANDY_UPDATE_CHECK_API_URL"] || "";
    if (cfgDevRuntimeDistGuard) cfgDevRuntimeDistGuard.value = c["BELLDANDY_DEV_RUNTIME_DIST_GUARD"] || "build";
    if (cfgAuthMode) cfgAuthMode.value = c["BELLDANDY_AUTH_MODE"] || "none";
    if (cfgAuthToken) cfgAuthToken.value = c["BELLDANDY_AUTH_TOKEN"] || "";
    if (cfgAuthPassword) cfgAuthPassword.value = c["BELLDANDY_AUTH_PASSWORD"] || "";
    if (cfgAllowedOrigins) cfgAllowedOrigins.value = c["BELLDANDY_ALLOWED_ORIGINS"] || "";
    if (cfgAttachmentMaxFileBytes) cfgAttachmentMaxFileBytes.value = c["BELLDANDY_ATTACHMENT_MAX_FILE_BYTES"] || "";
    if (cfgAttachmentMaxTotalBytes) cfgAttachmentMaxTotalBytes.value = c["BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES"] || "";
    if (cfgAttachmentTextCharLimit) cfgAttachmentTextCharLimit.value = c["BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT"] || "";
    if (cfgAttachmentTextTotalCharLimit) cfgAttachmentTextTotalCharLimit.value = c["BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT"] || "";
    if (cfgAudioTranscriptAppendCharLimit) cfgAudioTranscriptAppendCharLimit.value = c["BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT"] || "";
    cfgApiKey.value = c["BELLDANDY_OPENAI_API_KEY"] || "";
    cfgBaseUrl.value = c["BELLDANDY_OPENAI_BASE_URL"] || "";
    cfgModel.value = c["BELLDANDY_OPENAI_MODEL"] || "";
    if (cfgAgentProvider) cfgAgentProvider.value = c["BELLDANDY_AGENT_PROVIDER"] || "openai";
    if (cfgOpenAiStreamEnabled) cfgOpenAiStreamEnabled.checked = c["BELLDANDY_OPENAI_STREAM"] !== "false";
    if (cfgOpenAiWireApi) cfgOpenAiWireApi.value = c["BELLDANDY_OPENAI_WIRE_API"] || "chat_completions";
    if (cfgOpenAiThinking) cfgOpenAiThinking.value = c["BELLDANDY_OPENAI_THINKING"] || "";
    if (cfgOpenAiReasoningEffort) cfgOpenAiReasoningEffort.value = c["BELLDANDY_OPENAI_REASONING_EFFORT"] || "";
    if (cfgResponsesSanitizeToolSchema) cfgResponsesSanitizeToolSchema.checked = c["BELLDANDY_RESPONSES_SANITIZE_TOOL_SCHEMA"] === "true";
    if (cfgOpenAiMaxRetries) cfgOpenAiMaxRetries.value = c["BELLDANDY_OPENAI_MAX_RETRIES"] || "";
    if (cfgOpenAiRetryBackoffMs) cfgOpenAiRetryBackoffMs.value = c["BELLDANDY_OPENAI_RETRY_BACKOFF_MS"] || "";
    if (cfgOpenAiProxyUrl) cfgOpenAiProxyUrl.value = c["BELLDANDY_OPENAI_PROXY_URL"] || "";
    if (cfgPrimaryWarmupEnabled) cfgPrimaryWarmupEnabled.checked = c["BELLDANDY_PRIMARY_WARMUP_ENABLED"] !== "false";
    if (cfgPrimaryWarmupTimeoutMs) cfgPrimaryWarmupTimeoutMs.value = c["BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS"] || "";
    if (cfgPrimaryWarmupCooldownMs) cfgPrimaryWarmupCooldownMs.value = c["BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS"] || "";
    if (cfgOpenAiSystemPrompt) cfgOpenAiSystemPrompt.value = c["BELLDANDY_OPENAI_SYSTEM_PROMPT"] || "";
    if (cfgAgentTimeoutMs) cfgAgentTimeoutMs.value = c["BELLDANDY_AGENT_TIMEOUT_MS"] || "";
    if (cfgAgentProtocol) cfgAgentProtocol.value = c["BELLDANDY_AGENT_PROTOCOL"] || "";
    if (cfgVideoFileApiUrl) cfgVideoFileApiUrl.value = c["BELLDANDY_VIDEO_FILE_API_URL"] || "";
    if (cfgVideoFileApiKey) cfgVideoFileApiKey.value = c["BELLDANDY_VIDEO_FILE_API_KEY"] || "";
    if (cfgModelPreferredProviders) {
      cfgModelPreferredProviders.value = c["BELLDANDY_MODEL_PREFERRED_PROVIDERS"] || "";
    }
    const assistantModeSettings = applyAssistantModeSettingsConfig({
      cfgAssistantModeEnabled,
      cfgAssistantModePreset,
      cfgExternalOutboundRequireConfirmation,
      cfgAssistantExternalDeliveryPreference,
      cfgHeartbeat,
      cfgHeartbeatEnabled,
      cfgHeartbeatActiveHours,
      cfgCronEnabled,
      cfgStarweaverActiveNotifyEnabled,
      cfgStarweaverActiveNotifyPollIntervalMs,
    }, c);
    applyAssistantModeCopy({ settings: assistantModeSettings });
    if (cfgBrowserRelayEnabled) cfgBrowserRelayEnabled.checked = c["BELLDANDY_BROWSER_RELAY_ENABLED"] === "true";
    if (cfgRelayPort) cfgRelayPort.value = c["BELLDANDY_RELAY_PORT"] || "";
    if (cfgMcpEnabled) cfgMcpEnabled.checked = c["BELLDANDY_MCP_ENABLED"] === "true";
    if (cfgBrowserAllowedDomains) cfgBrowserAllowedDomains.value = c["BELLDANDY_BROWSER_ALLOWED_DOMAINS"] || "";
    if (cfgBrowserDeniedDomains) cfgBrowserDeniedDomains.value = c["BELLDANDY_BROWSER_DENIED_DOMAINS"] || "";
    if (cfgAgentBridgeEnabled) cfgAgentBridgeEnabled.checked = c["BELLDANDY_AGENT_BRIDGE_ENABLED"] === "true";
    if (cfgToolGroups) cfgToolGroups.value = c["BELLDANDY_TOOL_GROUPS"] || "";
    if (cfgMaxInputTokens) cfgMaxInputTokens.value = c["BELLDANDY_MAX_INPUT_TOKENS"] || "";
    if (cfgMaxOutputTokens) cfgMaxOutputTokens.value = c["BELLDANDY_MAX_OUTPUT_TOKENS"] || "";
    if (cfgToolLoopIterationBudget) cfgToolLoopIterationBudget.value = c["BELLDANDY_TOOL_LOOP_ITERATION_BUDGET"] || "";
    if (cfgToolLoopWarningFraction) cfgToolLoopWarningFraction.value = c["BELLDANDY_TOOL_LOOP_WARNING_FRACTION"] || "";
    if (cfgWebAllowPrivilegedSafeScope) cfgWebAllowPrivilegedSafeScope.checked = c["BELLDANDY_WEB_ALLOW_PRIVILEGED_SAFE_SCOPE"] === "true";
    if (cfgPrivilegedWorkspaceWriteChannels) cfgPrivilegedWorkspaceWriteChannels.value = c["BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS"] || "";
    if (cfgDangerousToolsEnabled) cfgDangerousToolsEnabled.checked = c["BELLDANDY_DANGEROUS_TOOLS_ENABLED"] === "true";
    if (cfgToolsPolicyFile) cfgToolsPolicyFile.value = c["BELLDANDY_TOOLS_POLICY_FILE"] || "";
    if (cfgSubAgentMaxConcurrent) cfgSubAgentMaxConcurrent.value = c["BELLDANDY_SUB_AGENT_MAX_CONCURRENT"] || "";
    if (cfgSubAgentMaxQueueSize) cfgSubAgentMaxQueueSize.value = c["BELLDANDY_SUB_AGENT_MAX_QUEUE_SIZE"] || "";
    if (cfgSubAgentTimeoutMs) cfgSubAgentTimeoutMs.value = c["BELLDANDY_SUB_AGENT_TIMEOUT_MS"] || "";
    if (cfgSubAgentMaxDepth) cfgSubAgentMaxDepth.value = c["BELLDANDY_SUB_AGENT_MAX_DEPTH"] || "";
    if (cfgWorkflowMaxConcurrent) cfgWorkflowMaxConcurrent.value = c["BELLDANDY_WORKFLOW_MAX_CONCURRENT"] || "";
    if (cfgWorkflowMaxQueueSize) cfgWorkflowMaxQueueSize.value = c["BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE"] || "";
    if (cfgWorkflowTimeoutMs) cfgWorkflowTimeoutMs.value = c["BELLDANDY_WORKFLOW_TIMEOUT_MS"] || "";
    if (cfgWorkflowAgentTimeoutMs) cfgWorkflowAgentTimeoutMs.value = c["BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS"] || "";
    if (cfgWorkflowMaxAgentCalls) cfgWorkflowMaxAgentCalls.value = c["BELLDANDY_WORKFLOW_MAX_AGENT_CALLS"] || "";
    if (cfgWorkflowMaxDepth) cfgWorkflowMaxDepth.value = c["BELLDANDY_WORKFLOW_MAX_DEPTH"] || "";
    if (cfgMemoryEnabled) cfgMemoryEnabled.checked = c["BELLDANDY_MEMORY_ENABLED"] !== "false";
    if (cfgEmbeddingEnabled) cfgEmbeddingEnabled.checked = c["BELLDANDY_EMBEDDING_ENABLED"] === "true";
    if (cfgEmbeddingProvider) cfgEmbeddingProvider.value = c["BELLDANDY_EMBEDDING_PROVIDER"] || "openai";
    if (cfgEmbeddingApiKey) cfgEmbeddingApiKey.value = c["BELLDANDY_EMBEDDING_OPENAI_API_KEY"] || "";
    if (cfgEmbeddingBaseUrl) cfgEmbeddingBaseUrl.value = c["BELLDANDY_EMBEDDING_OPENAI_BASE_URL"] || "";
    if (cfgEmbeddingModel) cfgEmbeddingModel.value = c["BELLDANDY_EMBEDDING_MODEL"] || "";
    if (cfgLocalEmbeddingModel) cfgLocalEmbeddingModel.value = c["BELLDANDY_LOCAL_EMBEDDING_MODEL"] || "";
    if (cfgEmbeddingBatchSize) cfgEmbeddingBatchSize.value = c["BELLDANDY_EMBEDDING_BATCH_SIZE"] || "";
    if (cfgContextInjectionEnabled) cfgContextInjectionEnabled.checked = c["BELLDANDY_CONTEXT_INJECTION"] !== "false";
    if (cfgContextInjectionLimit) cfgContextInjectionLimit.value = c["BELLDANDY_CONTEXT_INJECTION_LIMIT"] || "";
    if (cfgContextInjectionIncludeSession) cfgContextInjectionIncludeSession.checked = c["BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION"] === "true";
    if (cfgContextInjectionTaskLimit) cfgContextInjectionTaskLimit.value = c["BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT"] || "";
    if (cfgContextInjectionAllowedCategories) cfgContextInjectionAllowedCategories.value = c["BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES"] || "";
    if (cfgCarryoverContextEnabled) cfgCarryoverContextEnabled.checked = c["BELLDANDY_CARRYOVER_CONTEXT_ENABLED"] !== "false";
    if (cfgAutoRecallEnabled) cfgAutoRecallEnabled.checked = c["BELLDANDY_AUTO_RECALL_ENABLED"] === "true";
    if (cfgAutoRecallLimit) cfgAutoRecallLimit.value = c["BELLDANDY_AUTO_RECALL_LIMIT"] || "";
    if (cfgAutoRecallMinScore) cfgAutoRecallMinScore.value = c["BELLDANDY_AUTO_RECALL_MIN_SCORE"] || "";
    if (cfgToolResultTranscriptCharLimit) cfgToolResultTranscriptCharLimit.value = c["BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT"] || "";
    if (cfgMindProfileRuntimeEnabled) cfgMindProfileRuntimeEnabled.checked = c["BELLDANDY_MIND_PROFILE_RUNTIME_ENABLED"] !== "false";
    if (cfgMindProfileRuntimeMaxLines) cfgMindProfileRuntimeMaxLines.value = c["BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINES"] || "";
    if (cfgMindProfileRuntimeMaxLineLength) cfgMindProfileRuntimeMaxLineLength.value = c["BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINE_LENGTH"] || "";
    if (cfgMindProfileRuntimeMaxChars) cfgMindProfileRuntimeMaxChars.value = c["BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS"] || "";
    if (cfgMindProfileRuntimeMinSignalCount) cfgMindProfileRuntimeMinSignalCount.value = c["BELLDANDY_MIND_PROFILE_RUNTIME_MIN_SIGNAL_COUNT"] || "";
    if (cfgMemorySummaryEnabled) cfgMemorySummaryEnabled.checked = c["BELLDANDY_MEMORY_SUMMARY_ENABLED"] === "true";
    if (cfgMemorySummaryModel) cfgMemorySummaryModel.value = c["BELLDANDY_MEMORY_SUMMARY_MODEL"] || "";
    if (cfgMemorySummaryBaseUrl) cfgMemorySummaryBaseUrl.value = c["BELLDANDY_MEMORY_SUMMARY_BASE_URL"] || "";
    if (cfgMemorySummaryApiKey) cfgMemorySummaryApiKey.value = c["BELLDANDY_MEMORY_SUMMARY_API_KEY"] || "";
    if (cfgMemoryEvolutionEnabled) cfgMemoryEvolutionEnabled.checked = c["BELLDANDY_MEMORY_EVOLUTION_ENABLED"] === "true";
    if (cfgMemoryEvolutionMinMessages) cfgMemoryEvolutionMinMessages.value = c["BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES"] || "";
    if (cfgMemoryEvolutionModel) cfgMemoryEvolutionModel.value = c["BELLDANDY_MEMORY_EVOLUTION_MODEL"] || "";
    if (cfgMemoryEvolutionBaseUrl) cfgMemoryEvolutionBaseUrl.value = c["BELLDANDY_MEMORY_EVOLUTION_BASE_URL"] || "";
    if (cfgMemoryEvolutionApiKey) cfgMemoryEvolutionApiKey.value = c["BELLDANDY_MEMORY_EVOLUTION_API_KEY"] || "";
    if (cfgMemorySessionDigestMaxRuns) cfgMemorySessionDigestMaxRuns.value = c["BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS"] || "";
    if (cfgMemorySessionDigestWindowMs) cfgMemorySessionDigestWindowMs.value = c["BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS"] || "";
    if (cfgMemoryDurableExtractionMaxRuns) cfgMemoryDurableExtractionMaxRuns.value = c["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS"] || "";
    if (cfgMemoryDurableExtractionWindowMs) cfgMemoryDurableExtractionWindowMs.value = c["BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS"] || "";
    if (cfgMemoryDurableExtractionMinPendingMessages) cfgMemoryDurableExtractionMinPendingMessages.value = c["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_PENDING_MESSAGES"] || "";
    if (cfgMemoryDurableExtractionMinMessageDelta) cfgMemoryDurableExtractionMinMessageDelta.value = c["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_MESSAGE_DELTA"] || "";
    if (cfgMemoryDurableExtractionSuccessCooldownMs) cfgMemoryDurableExtractionSuccessCooldownMs.value = c["BELLDANDY_MEMORY_DURABLE_EXTRACTION_SUCCESS_COOLDOWN_MS"] || "";
    if (cfgMemoryDurableExtractionFailureBackoffMs) cfgMemoryDurableExtractionFailureBackoffMs.value = c["BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MS"] || "";
    if (cfgMemoryDurableExtractionFailureBackoffMaxMs) cfgMemoryDurableExtractionFailureBackoffMaxMs.value = c["BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MAX_MS"] || "";
    if (cfgTeamSharedMemoryEnabled) cfgTeamSharedMemoryEnabled.checked = c["BELLDANDY_TEAM_SHARED_MEMORY_ENABLED"] === "true";
    if (cfgSharedReviewClaimTimeoutMs) cfgSharedReviewClaimTimeoutMs.value = c["BELLDANDY_SHARED_REVIEW_CLAIM_TIMEOUT_MS"] || "";
    if (cfgTaskMemoryEnabled) cfgTaskMemoryEnabled.checked = c["BELLDANDY_TASK_MEMORY_ENABLED"] === "true";
    if (cfgTaskStatsWhenMemoryDisabled) cfgTaskStatsWhenMemoryDisabled.checked = c["BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED"] === "true";
    if (cfgTaskSummaryEnabled) cfgTaskSummaryEnabled.checked = c["BELLDANDY_TASK_SUMMARY_ENABLED"] === "true";
    if (cfgTaskSummaryModel) cfgTaskSummaryModel.value = c["BELLDANDY_TASK_SUMMARY_MODEL"] || "";
    if (cfgTaskSummaryBaseUrl) cfgTaskSummaryBaseUrl.value = c["BELLDANDY_TASK_SUMMARY_BASE_URL"] || "";
    if (cfgTaskSummaryApiKey) cfgTaskSummaryApiKey.value = c["BELLDANDY_TASK_SUMMARY_API_KEY"] || "";
    if (cfgTaskSummaryMinDurationMs) cfgTaskSummaryMinDurationMs.value = c["BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS"] || "";
    if (cfgTaskSummaryMinToolCalls) cfgTaskSummaryMinToolCalls.value = c["BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS"] || "";
    if (cfgTaskSummaryMinTokenTotal) cfgTaskSummaryMinTokenTotal.value = c["BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL"] || "";
    if (cfgExperienceAutoPromotionEnabled) cfgExperienceAutoPromotionEnabled.checked = c["BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED"] !== "false";
    if (cfgExperienceAutoMethodEnabled) cfgExperienceAutoMethodEnabled.checked = c["BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED"] !== "false";
    if (cfgExperienceAutoSkillEnabled) cfgExperienceAutoSkillEnabled.checked = c["BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED"] !== "false";
    if (cfgMethodGenerationConfirmRequired) cfgMethodGenerationConfirmRequired.checked = c["BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED"] === "true";
    if (cfgSkillGenerationConfirmRequired) cfgSkillGenerationConfirmRequired.checked = c["BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED"] === "true";
    if (cfgMethodPublishConfirmRequired) cfgMethodPublishConfirmRequired.checked = c["BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED"] === "true";
    if (cfgSkillPublishConfirmRequired) cfgSkillPublishConfirmRequired.checked = c["BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED"] === "true";
    if (cfgExperienceSynthesisMaxSimilarSources) cfgExperienceSynthesisMaxSimilarSources.value = c["BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES"] || "";
    if (cfgExperienceSynthesisMaxSourceContentChars) cfgExperienceSynthesisMaxSourceContentChars.value = c["BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS"] || "";
    if (cfgExperienceSynthesisTotalSourceContentCharBudget) cfgExperienceSynthesisTotalSourceContentCharBudget.value = c["BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET"] || "";
    if (cfgMemoryDeepRetrievalEnabled) cfgMemoryDeepRetrievalEnabled.checked = c["BELLDANDY_MEMORY_DEEP_RETRIEVAL"] === "true";
    if (cfgMemoryNodeAssistedRetrievalEnabled) cfgMemoryNodeAssistedRetrievalEnabled.checked = c["BELLDANDY_MEMORY_NODE_ASSISTED_RETRIEVAL"] === "true";
    if (cfgEmbeddingQueryPrefix) cfgEmbeddingQueryPrefix.value = c["BELLDANDY_EMBEDDING_QUERY_PREFIX"] || "";
    if (cfgEmbeddingPassagePrefix) cfgEmbeddingPassagePrefix.value = c["BELLDANDY_EMBEDDING_PASSAGE_PREFIX"] || "";
    if (cfgRerankerMinScore) cfgRerankerMinScore.value = c["BELLDANDY_RERANKER_MIN_SCORE"] || "";
    if (cfgRerankerLengthNormAnchor) cfgRerankerLengthNormAnchor.value = c["BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR"] || "";
    if (cfgMemoryIndexerVerboseWatch) cfgMemoryIndexerVerboseWatch.checked = c["BELLDANDY_MEMORY_INDEXER_VERBOSE_WATCH"] === "true";
    if (cfgTaskDedupGuardEnabled) cfgTaskDedupGuardEnabled.checked = c["BELLDANDY_TASK_DEDUP_GUARD_ENABLED"] !== "false";
    if (cfgTaskDedupWindowMinutes) cfgTaskDedupWindowMinutes.value = c["BELLDANDY_TASK_DEDUP_WINDOW_MINUTES"] || "";
    if (cfgTaskDedupMode) cfgTaskDedupMode.value = c["BELLDANDY_TASK_DEDUP_MODE"] || "";
    if (cfgTaskDedupPolicy) cfgTaskDedupPolicy.value = c["BELLDANDY_TASK_DEDUP_POLICY"] || "";
    if (cfgToolsEnabled) cfgToolsEnabled.checked = c["BELLDANDY_TOOLS_ENABLED"] === "true";
    if (cfgAgentToolControlMode) cfgAgentToolControlMode.value = c["BELLDANDY_AGENT_TOOL_CONTROL_MODE"] || "disabled";
    if (cfgAgentToolControlConfirmPassword) cfgAgentToolControlConfirmPassword.value = c["BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD"] || "";
    if (cfgTtsEnabled) cfgTtsEnabled.checked = c["BELLDANDY_TTS_ENABLED"] === "true";
    if (cfgTtsProvider) cfgTtsProvider.value = c["BELLDANDY_TTS_PROVIDER"] || "edge";
    if (cfgTtsVoice) cfgTtsVoice.value = c["BELLDANDY_TTS_VOICE"] || "";
    if (cfgTtsModel) cfgTtsModel.value = c["BELLDANDY_TTS_MODEL"] || "";
    if (cfgTtsOpenAIBaseUrl) cfgTtsOpenAIBaseUrl.value = c["BELLDANDY_TTS_OPENAI_BASE_URL"] || "";
    if (cfgTtsOpenAIApiKey) cfgTtsOpenAIApiKey.value = c["BELLDANDY_TTS_OPENAI_API_KEY"] || "";
    if (cfgImageEnabled) cfgImageEnabled.checked = c["BELLDANDY_IMAGE_ENABLED"] !== "false";
    if (cfgImageProvider) cfgImageProvider.value = c["BELLDANDY_IMAGE_PROVIDER"] || "openai";
    if (cfgImageApiKey) cfgImageApiKey.value = c["BELLDANDY_IMAGE_OPENAI_API_KEY"] || "";
    if (cfgImageBaseUrl) cfgImageBaseUrl.value = c["BELLDANDY_IMAGE_OPENAI_BASE_URL"] || "";
    if (cfgImageModel) cfgImageModel.value = c["BELLDANDY_IMAGE_MODEL"] || "";
    if (cfgImageOutputFormat) cfgImageOutputFormat.value = c["BELLDANDY_IMAGE_OUTPUT_FORMAT"] || "";
    if (cfgImageTimeoutMs) cfgImageTimeoutMs.value = c["BELLDANDY_IMAGE_TIMEOUT_MS"] || "";
    if (cfgImageUnderstandEnabled) cfgImageUnderstandEnabled.checked = c["BELLDANDY_IMAGE_UNDERSTAND_ENABLED"] === "true";
    if (cfgImageUnderstandApiKey) cfgImageUnderstandApiKey.value = c["BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY"] || "";
    if (cfgImageUnderstandProvider) cfgImageUnderstandProvider.value = c["BELLDANDY_IMAGE_UNDERSTAND_PROVIDER"] || "openai";
    if (cfgImageUnderstandBaseUrl) cfgImageUnderstandBaseUrl.value = c["BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL"] || "";
    if (cfgImageUnderstandModel) cfgImageUnderstandModel.value = c["BELLDANDY_IMAGE_UNDERSTAND_MODEL"] || "";
    if (cfgImageUnderstandTimeoutMs) cfgImageUnderstandTimeoutMs.value = c["BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS"] || "";
    if (cfgImageUnderstandMaxInputMb) cfgImageUnderstandMaxInputMb.value = c["BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB"] || "";
    if (cfgImageUnderstandPrompt) cfgImageUnderstandPrompt.value = c["BELLDANDY_IMAGE_UNDERSTAND_PROMPT"] || "";
    if (cfgImageUnderstandAutoOnAttachment) cfgImageUnderstandAutoOnAttachment.checked = c["BELLDANDY_IMAGE_UNDERSTAND_AUTO_ON_ATTACHMENT"] !== "false";
    if (cfgBrowserScreenshotAutoUnderstand) cfgBrowserScreenshotAutoUnderstand.checked = c["BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND"] !== "false";
    if (cfgCameraSnapAutoUnderstand) cfgCameraSnapAutoUnderstand.checked = c["BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND"] !== "false";
    if (cfgScreenCaptureAutoUnderstand) cfgScreenCaptureAutoUnderstand.checked = c["BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND"] !== "false";
    if (cfgVideoUnderstandEnabled) cfgVideoUnderstandEnabled.checked = c["BELLDANDY_VIDEO_UNDERSTAND_ENABLED"] === "true";
    if (cfgVideoUnderstandApiKey) cfgVideoUnderstandApiKey.value = c["BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY"] || "";
    if (cfgVideoUnderstandProvider) cfgVideoUnderstandProvider.value = c["BELLDANDY_VIDEO_UNDERSTAND_PROVIDER"] || "openai";
    if (cfgVideoUnderstandBaseUrl) cfgVideoUnderstandBaseUrl.value = c["BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL"] || "";
    if (cfgVideoUnderstandModel) cfgVideoUnderstandModel.value = c["BELLDANDY_VIDEO_UNDERSTAND_MODEL"] || "";
    if (cfgVideoUnderstandTimeoutMs) cfgVideoUnderstandTimeoutMs.value = c["BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS"] || "";
    if (cfgVideoUnderstandTransport) cfgVideoUnderstandTransport.value = c["BELLDANDY_VIDEO_UNDERSTAND_TRANSPORT"] || "auto";
    if (cfgVideoUnderstandFps) cfgVideoUnderstandFps.value = c["BELLDANDY_VIDEO_UNDERSTAND_FPS"] || "";
    if (cfgVideoUnderstandMaxInputMb) cfgVideoUnderstandMaxInputMb.value = c["BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB"] || "";
    if (cfgVideoUnderstandPrompt) cfgVideoUnderstandPrompt.value = c["BELLDANDY_VIDEO_UNDERSTAND_PROMPT"] || "";
    if (cfgVideoUnderstandAutoOnAttachment) cfgVideoUnderstandAutoOnAttachment.checked = c["BELLDANDY_VIDEO_UNDERSTAND_AUTO_ON_ATTACHMENT"] !== "false";
    if (cfgVideoUnderstandAutoAttachmentMaxTimelineItems) cfgVideoUnderstandAutoAttachmentMaxTimelineItems.value = c["BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS"] || "";
    if (cfgVideoUnderstandAutoAttachmentSummaryCharLimit) cfgVideoUnderstandAutoAttachmentSummaryCharLimit.value = c["BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT"] || "";
    if (cfgSttProvider) cfgSttProvider.value = c["BELLDANDY_STT_PROVIDER"] || "";
    if (cfgSttModel) cfgSttModel.value = c["BELLDANDY_STT_MODEL"] || "";
    if (cfgSttOpenAiBaseUrl) cfgSttOpenAiBaseUrl.value = c["BELLDANDY_STT_OPENAI_BASE_URL"] || "";
    if (cfgSttOpenAiApiKey) cfgSttOpenAiApiKey.value = c["BELLDANDY_STT_OPENAI_API_KEY"] || "";
    if (cfgSttLanguage) cfgSttLanguage.value = c["BELLDANDY_STT_LANGUAGE"] || "";
    if (cfgSttGroqApiKey) cfgSttGroqApiKey.value = c["BELLDANDY_STT_GROQ_API_KEY"] || "";
    if (cfgSttGroqBaseUrl) cfgSttGroqBaseUrl.value = c["BELLDANDY_STT_GROQ_BASE_URL"] || "";
    if (cfgQqSttFallbackProviders) cfgQqSttFallbackProviders.value = c["BELLDANDY_QQ_STT_FALLBACK_PROVIDERS"] || "";
    if (cfgCameraNativeHelperCommand) cfgCameraNativeHelperCommand.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND"] || "";
    if (cfgCameraNativeHelperArgsJson) cfgCameraNativeHelperArgsJson.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON"] || "";
    if (cfgCameraNativeHelperCwd) cfgCameraNativeHelperCwd.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_CWD"] || "";
    if (cfgCameraNativeHelperStartupTimeoutMs) cfgCameraNativeHelperStartupTimeoutMs.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS"] || "";
    if (cfgCameraNativeHelperRequestTimeoutMs) cfgCameraNativeHelperRequestTimeoutMs.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS"] || "";
    if (cfgCameraNativeHelperIdleShutdownMs) cfgCameraNativeHelperIdleShutdownMs.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS"] || "";
    if (cfgCameraNativeHelperEnvJson) cfgCameraNativeHelperEnvJson.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON"] || "";
    if (cfgCameraNativeHelperPowershellCommand) cfgCameraNativeHelperPowershellCommand.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_COMMAND"] || "";
    if (cfgCameraNativeHelperPowershellArgsJson) cfgCameraNativeHelperPowershellArgsJson.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_ARGS_JSON"] || "";
    if (cfgCameraNativeHelperFfmpegCommand) cfgCameraNativeHelperFfmpegCommand.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND"] || "";
    if (cfgCameraNativeHelperFfmpegArgsJson) cfgCameraNativeHelperFfmpegArgsJson.value = c["BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON"] || "";
    if (cfgDashScopeApiKey) cfgDashScopeApiKey.value = aliyunApiKeyTargets
      .map((key) => c[key] || "")
      .find((value) => value) || "";
    cfgFacetAnchor.value = c["BELLDANDY_FACET_ANCHOR"] || "";
    cfgInjectAgents.checked = c["BELLDANDY_INJECT_AGENTS"] === "true";
    cfgInjectSoul.checked = c["BELLDANDY_INJECT_SOUL"] === "true";
    cfgInjectMemory.checked = c["BELLDANDY_INJECT_MEMORY"] === "true";
    if (cfgInjectMethodSkillList) cfgInjectMethodSkillList.checked = c["BELLDANDY_INJECT_METHOD_SKILL_LIST"] !== "false";
    if (cfgPromptFocusEnabled) cfgPromptFocusEnabled.checked = c["BELLDANDY_PROMPT_FOCUS_ENABLED"] !== "false";
    if (cfgPromptFocusSemanticEnabled) cfgPromptFocusSemanticEnabled.checked = c["BELLDANDY_PROMPT_FOCUS_SEMANTIC_ENABLED"] !== "false";
    if (cfgPromptFocusSemanticMinScore) cfgPromptFocusSemanticMinScore.value = c["BELLDANDY_PROMPT_FOCUS_SEMANTIC_MIN_SCORE"] || "";
    cfgMaxSystemPromptChars.value = c["BELLDANDY_MAX_SYSTEM_PROMPT_CHARS"] || "";
    cfgMaxHistory.value = c["BELLDANDY_MAX_HISTORY"] || "";
    loadConversationAllowedKinds(c["BELLDANDY_CONVERSATION_ALLOWED_KINDS"]);
    if (cfgPromptExperimentDisableSections) cfgPromptExperimentDisableSections.value = c["BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS"] || "";
    if (cfgPromptExperimentSectionPriorityOverrides) cfgPromptExperimentSectionPriorityOverrides.value = c["BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES"] || "";
    if (cfgPromptExperimentDisableToolContracts) cfgPromptExperimentDisableToolContracts.value = c["BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS"] || "";
    if (cfgPromptSnapshotMaxRuns) cfgPromptSnapshotMaxRuns.value = c["BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS"] || "";
    if (cfgPromptSnapshotMaxPersistedRuns) cfgPromptSnapshotMaxPersistedRuns.value = c["BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS"] || "";
    if (cfgPromptSnapshotEmailThreadMaxRuns) cfgPromptSnapshotEmailThreadMaxRuns.value = c["BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS"] || "";
    if (cfgPromptSnapshotHeartbeatMaxRuns) cfgPromptSnapshotHeartbeatMaxRuns.value = c["BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS"] || "";
    if (cfgPromptSnapshotRetentionDays) cfgPromptSnapshotRetentionDays.value = c["BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS"] || "";
    if (cfgCompactionEnabled) cfgCompactionEnabled.checked = c["BELLDANDY_COMPACTION_ENABLED"] !== "false";
    if (cfgCompactionThreshold) cfgCompactionThreshold.value = c["BELLDANDY_COMPACTION_THRESHOLD"] || "";
    if (cfgCompactionKeepRecent) cfgCompactionKeepRecent.value = c["BELLDANDY_COMPACTION_KEEP_RECENT"] || "";
    if (cfgCompactionTriggerFraction) cfgCompactionTriggerFraction.value = c["BELLDANDY_COMPACTION_TRIGGER_FRACTION"] || "";
    if (cfgCompactionArchivalThreshold) cfgCompactionArchivalThreshold.value = c["BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD"] || "";
    if (cfgCompactionWarningThreshold) cfgCompactionWarningThreshold.value = c["BELLDANDY_COMPACTION_WARNING_THRESHOLD"] || "";
    if (cfgCompactionBlockingThreshold) cfgCompactionBlockingThreshold.value = c["BELLDANDY_COMPACTION_BLOCKING_THRESHOLD"] || "";
    if (cfgCompactionMaxConsecutiveFailures) cfgCompactionMaxConsecutiveFailures.value = c["BELLDANDY_COMPACTION_MAX_CONSECUTIVE_FAILURES"] || "";
    if (cfgCompactionMaxPtlRetries) cfgCompactionMaxPtlRetries.value = c["BELLDANDY_COMPACTION_MAX_PTL_RETRIES"] || "";
    if (cfgCompactionContextWindowFraction) cfgCompactionContextWindowFraction.value = c["BELLDANDY_COMPACTION_CONTEXT_WINDOW_FRACTION"] || "";
    if (cfgModelContextWindow) cfgModelContextWindow.value = c["BELLDANDY_MODEL_CONTEXT_WINDOW"] || "";
    if (cfgCompressionReferenceStore) cfgCompressionReferenceStore.checked = c["BELLDANDY_COMPRESSION_REFERENCE_STORE"] !== "false";
    if (cfgPreflightCompressionEnabled) cfgPreflightCompressionEnabled.checked = c["BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED"] !== "false";
    if (cfgPreflightCompressionMode) cfgPreflightCompressionMode.value = c["BELLDANDY_PREFLIGHT_COMPRESSION_MODE"] || "attachments";
    if (cfgPreflightAttachmentThresholdChars) cfgPreflightAttachmentThresholdChars.value = c["BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS"] || "";
    if (cfgPreflightTargetRatio) cfgPreflightTargetRatio.value = c["BELLDANDY_PREFLIGHT_TARGET_RATIO"] || "";
    if (cfgPreflightMinSavingsRatio) cfgPreflightMinSavingsRatio.value = c["BELLDANDY_PREFLIGHT_MIN_SAVINGS_RATIO"] || "";
    if (cfgPreflightTimeoutMs) cfgPreflightTimeoutMs.value = c["BELLDANDY_PREFLIGHT_TIMEOUT_MS"] || "";
    if (cfgPreflightAttachmentReference) cfgPreflightAttachmentReference.value = c["BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE"] || "none";
    if (cfgPreflightSidecarRetentionMs) cfgPreflightSidecarRetentionMs.value = c["BELLDANDY_PREFLIGHT_SIDECAR_RETENTION_MS"] || "";
    if (cfgPreflightSidecarMaxEntries) cfgPreflightSidecarMaxEntries.value = c["BELLDANDY_PREFLIGHT_SIDECAR_MAX_ENTRIES"] || "";
    if (cfgCompressionPersistentReferenceStore) cfgCompressionPersistentReferenceStore.checked = c["BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_STORE"] === "true";
    if (cfgCompressionPersistentReferenceTtlMs) cfgCompressionPersistentReferenceTtlMs.value = c["BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_TTL_MS"] || "";
    if (cfgCompressionPersistentReferenceMaxEntries) cfgCompressionPersistentReferenceMaxEntries.value = c["BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_MAX_ENTRIES"] || "";
    if (cfgBudgetProtectMode) cfgBudgetProtectMode.value = c["BELLDANDY_BUDGET_PROTECT_MODE"] || "protect_memory_capability";
    if (cfgBudgetProtectKeepRecentRounds) cfgBudgetProtectKeepRecentRounds.value = c["BELLDANDY_BUDGET_PROTECT_KEEP_RECENT_ROUNDS"] || "";
    if (cfgStablePrefixSplit) cfgStablePrefixSplit.checked = c["BELLDANDY_STABLE_PREFIX_SPLIT"] === "true";
    if (cfgCompactionModelRoute) cfgCompactionModelRoute.value = c["BELLDANDY_COMPACTION_MODEL_ROUTE"] || "";
    if (cfgDeepseekRoutePolicyEnabled) cfgDeepseekRoutePolicyEnabled.checked = c["BELLDANDY_DEEPSEEK_ROUTE_POLICY_ENABLED"] !== "false";
    if (cfgCompactionModel) cfgCompactionModel.value = c["BELLDANDY_COMPACTION_MODEL"] || "";
    if (cfgCompactionBaseUrl) cfgCompactionBaseUrl.value = c["BELLDANDY_COMPACTION_BASE_URL"] || "";
    if (cfgCompactionApiKey) cfgCompactionApiKey.value = c["BELLDANDY_COMPACTION_API_KEY"] || "";
    if (cfgCommunityApiEnabled) cfgCommunityApiEnabled.checked = c["BELLDANDY_COMMUNITY_API_ENABLED"] === "true";
    if (cfgCommunityApiToken) cfgCommunityApiToken.value = c["BELLDANDY_COMMUNITY_API_TOKEN"] || "";
    if (cfgEmailOutboundRequireConfirmation) cfgEmailOutboundRequireConfirmation.checked = c["BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION"] === "true";
    if (cfgEmailDefaultProvider) cfgEmailDefaultProvider.value = c["BELLDANDY_EMAIL_DEFAULT_PROVIDER"] || "";
    if (cfgEmailSmtpEnabled) cfgEmailSmtpEnabled.checked = c["BELLDANDY_EMAIL_SMTP_ENABLED"] === "true";
    if (cfgEmailImapEnabled) cfgEmailImapEnabled.checked = c["BELLDANDY_EMAIL_IMAP_ENABLED"] === "true";
    if (cfgEmailSmtpAccountId) cfgEmailSmtpAccountId.value = c["BELLDANDY_EMAIL_SMTP_ACCOUNT_ID"] || "";
    if (cfgEmailSmtpHost) cfgEmailSmtpHost.value = c["BELLDANDY_EMAIL_SMTP_HOST"] || "";
    if (cfgEmailSmtpPort) cfgEmailSmtpPort.value = c["BELLDANDY_EMAIL_SMTP_PORT"] || "";
    if (cfgEmailSmtpSecure) cfgEmailSmtpSecure.checked = c["BELLDANDY_EMAIL_SMTP_SECURE"] === "true";
    if (cfgEmailSmtpUser) cfgEmailSmtpUser.value = c["BELLDANDY_EMAIL_SMTP_USER"] || "";
    if (cfgEmailSmtpPass) cfgEmailSmtpPass.value = c["BELLDANDY_EMAIL_SMTP_PASS"] || "";
    if (cfgEmailSmtpFromAddress) cfgEmailSmtpFromAddress.value = c["BELLDANDY_EMAIL_SMTP_FROM_ADDRESS"] || "";
    if (cfgEmailSmtpFromName) cfgEmailSmtpFromName.value = c["BELLDANDY_EMAIL_SMTP_FROM_NAME"] || "";
    if (cfgEmailInboundAgentId) cfgEmailInboundAgentId.value = c["BELLDANDY_EMAIL_INBOUND_AGENT_ID"] || "";
    if (cfgEmailImapAccountId) cfgEmailImapAccountId.value = c["BELLDANDY_EMAIL_IMAP_ACCOUNT_ID"] || "";
    if (cfgEmailImapHost) cfgEmailImapHost.value = c["BELLDANDY_EMAIL_IMAP_HOST"] || "";
    if (cfgEmailImapPort) cfgEmailImapPort.value = c["BELLDANDY_EMAIL_IMAP_PORT"] || "";
    if (cfgEmailImapSecure) cfgEmailImapSecure.checked = c["BELLDANDY_EMAIL_IMAP_SECURE"] !== "false";
    if (cfgEmailImapUser) cfgEmailImapUser.value = c["BELLDANDY_EMAIL_IMAP_USER"] || "";
    if (cfgEmailImapPass) cfgEmailImapPass.value = c["BELLDANDY_EMAIL_IMAP_PASS"] || "";
    if (cfgEmailImapMailbox) cfgEmailImapMailbox.value = c["BELLDANDY_EMAIL_IMAP_MAILBOX"] || "";
    if (cfgEmailImapPollIntervalMs) cfgEmailImapPollIntervalMs.value = c["BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS"] || "";
    if (cfgEmailImapConnectTimeoutMs) cfgEmailImapConnectTimeoutMs.value = c["BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS"] || "";
    if (cfgEmailImapSocketTimeoutMs) cfgEmailImapSocketTimeoutMs.value = c["BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS"] || "";
    if (cfgEmailImapBootstrapMode) cfgEmailImapBootstrapMode.value = c["BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE"] || "latest";
    if (cfgEmailImapRecentWindowLimit) cfgEmailImapRecentWindowLimit.value = c["BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT"] || "";
    if (cfgChannelRouterEnabled) cfgChannelRouterEnabled.checked = c["BELLDANDY_CHANNEL_ROUTER_ENABLED"] === "true";
    if (cfgChannelRouterConfigPath) cfgChannelRouterConfigPath.value = c["BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH"] || "";
    if (cfgChannelRouterDefaultAgentId) cfgChannelRouterDefaultAgentId.value = c["BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID"] || "";
    if (cfgChannelIngressMaxConcurrent) cfgChannelIngressMaxConcurrent.value = c["BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT"] || "";
    if (cfgChannelIngressMaxConcurrentPerChannel) cfgChannelIngressMaxConcurrentPerChannel.value = c["BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT_PER_CHANNEL"] || "";
    if (cfgChannelIngressMaxPendingPerSession) cfgChannelIngressMaxPendingPerSession.value = c["BELLDANDY_CHANNEL_INGRESS_MAX_PENDING_PER_SESSION"] || "";
    if (cfgChannelIngressMaxQueued) cfgChannelIngressMaxQueued.value = c["BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED"] || "";
    if (cfgChannelIngressMaxWaitMs) cfgChannelIngressMaxWaitMs.value = c["BELLDANDY_CHANNEL_INGRESS_MAX_WAIT_MS"] || "";
    if (cfgChannelIngressMaxPayloadBytes) cfgChannelIngressMaxPayloadBytes.value = c["BELLDANDY_CHANNEL_INGRESS_MAX_PAYLOAD_BYTES"] || "";
    if (cfgChannelIngressMaxQueuedPayloadBytes) cfgChannelIngressMaxQueuedPayloadBytes.value = c["BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED_PAYLOAD_BYTES"] || "";
    if (cfgFeishuAppId) cfgFeishuAppId.value = c["BELLDANDY_FEISHU_APP_ID"] || "";
    if (cfgFeishuAppSecret) cfgFeishuAppSecret.value = c["BELLDANDY_FEISHU_APP_SECRET"] || "";
    if (cfgFeishuAgentId) cfgFeishuAgentId.value = c["BELLDANDY_FEISHU_AGENT_ID"] || "";
    if (cfgQqAppId) cfgQqAppId.value = c["BELLDANDY_QQ_APP_ID"] || "";
    if (cfgQqAppSecret) cfgQqAppSecret.value = c["BELLDANDY_QQ_APP_SECRET"] || "";
    if (cfgQqAgentId) cfgQqAgentId.value = c["BELLDANDY_QQ_AGENT_ID"] || "";
    if (cfgQqSandbox) cfgQqSandbox.checked = c["BELLDANDY_QQ_SANDBOX"] !== "false";
    if (cfgQqEventSampleCaptureEnabled) cfgQqEventSampleCaptureEnabled.checked = c["BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED"] === "true";
    if (cfgQqEventSampleCaptureDir) cfgQqEventSampleCaptureDir.value = c["BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR"] || "";
    if (cfgDiscordEnabled) cfgDiscordEnabled.checked = c["BELLDANDY_DISCORD_ENABLED"] === "true";
    if (cfgDiscordBotToken) cfgDiscordBotToken.value = c["BELLDANDY_DISCORD_BOT_TOKEN"] || "";
    if (cfgDiscordDefaultChannelId) cfgDiscordDefaultChannelId.value = c["BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID"] || "";
    if (cfgWebhookPreauthMaxBytes) cfgWebhookPreauthMaxBytes.value = c["BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES"] || "";
    if (cfgWebhookPreauthTimeoutMs) cfgWebhookPreauthTimeoutMs.value = c["BELLDANDY_WEBHOOK_PREAUTH_TIMEOUT_MS"] || "";
    if (cfgWebhookRateLimitWindowMs) cfgWebhookRateLimitWindowMs.value = c["BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS"] || "";
    if (cfgWebhookRateLimitMaxRequests) cfgWebhookRateLimitMaxRequests.value = c["BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS"] || "";
    if (cfgWebhookRateLimitMaxTrackedKeys) cfgWebhookRateLimitMaxTrackedKeys.value = c["BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_TRACKED_KEYS"] || "";
    if (cfgWebhookMaxInFlightPerKey) cfgWebhookMaxInFlightPerKey.value = c["BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY"] || "";
    if (cfgWebhookMaxInFlightTrackedKeys) cfgWebhookMaxInFlightTrackedKeys.value = c["BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_TRACKED_KEYS"] || "";
    if (cfgTokenUsageUploadEnabled) cfgTokenUsageUploadEnabled.checked = c["BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED"] === "true";
    if (cfgTokenUsageUploadUrl) cfgTokenUsageUploadUrl.value = c["BELLDANDY_TOKEN_USAGE_UPLOAD_URL"] || "";
    if (cfgTokenUsageUploadApiKey) cfgTokenUsageUploadApiKey.value = c["BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY"] || c["BELLDANDY_TOKEN_USAGE_UPLOAD_TOKEN"] || "";
    if (cfgTokenUsageUploadTimeoutMs) cfgTokenUsageUploadTimeoutMs.value = c["BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS"] || "";
    if (cfgTokenUsageStrictUuid) cfgTokenUsageStrictUuid.checked = c["BELLDANDY_TOKEN_USAGE_STRICT_UUID"] === "true";
    if (cfgWebchatCostBudgetUsd) cfgWebchatCostBudgetUsd.value = c["BELLDANDY_WEBCHAT_COST_BUDGET_USD"] || "";
    if (cfgWebchatCostBudgetWarnFraction) cfgWebchatCostBudgetWarnFraction.value = c["BELLDANDY_WEBCHAT_COST_BUDGET_WARN_FRACTION"] || "";
    if (cfgAutoTaskTimeEnabled) cfgAutoTaskTimeEnabled.checked = c["BELLDANDY_AUTO_TASK_TIME_ENABLED"] === "true";
    if (cfgAutoTaskTokenEnabled) cfgAutoTaskTokenEnabled.checked = c["BELLDANDY_AUTO_TASK_TOKEN_ENABLED"] === "true";
    if (cfgWebhookConfigPath) cfgWebhookConfigPath.value = c["BELLDANDY_WEBHOOK_CONFIG_PATH"] || "";
    if (cfgWebhookIdempotencyWindowMs) cfgWebhookIdempotencyWindowMs.value = c["BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS"] || "";
    if (cfgStateDir) cfgStateDir.value = c["BELLDANDY_STATE_DIR"] || "";
    if (cfgStateDirWindows) cfgStateDirWindows.value = c["BELLDANDY_STATE_DIR_WINDOWS"] || "";
    if (cfgStateDirWsl) cfgStateDirWsl.value = c["BELLDANDY_STATE_DIR_WSL"] || "";
    if (cfgWorkspaceDir) cfgWorkspaceDir.value = c["BELLDANDY_WORKSPACE_DIR"] || "";
    if (cfgExtraWorkspaceRoots) cfgExtraWorkspaceRoots.value = c["BELLDANDY_EXTRA_WORKSPACE_ROOTS"] || "";
    if (cfgWebRoot) cfgWebRoot.value = c["BELLDANDY_WEB_ROOT"] || "";
    if (cfgGovernanceDetailMode) cfgGovernanceDetailMode.value = c["BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE"] === "full" ? "full" : "compact";
    if (cfgCommanderMode) cfgCommanderMode.value = c["BELLDANDY_COMMANDER_MODE"] === "on" ? "on" : c["BELLDANDY_COMMANDER_MODE"] === "off" ? "off" : "auto";
    if (cfgCommanderAgentId) cfgCommanderAgentId.value = c["BELLDANDY_COMMANDER_AGENT_ID"] || "";
    if (cfgGoalExecutionMode) cfgGoalExecutionMode.value = c["BELLDANDY_GOAL_EXECUTION_MODE"] || "auto";
    if (cfgGoalGovernanceMode) cfgGoalGovernanceMode.value = c["BELLDANDY_GOAL_GOVERNANCE_MODE"] || "auto";
    if (cfgCommanderAutoReworkEnabled) cfgCommanderAutoReworkEnabled.checked = c["BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED"] === "true";
    if (cfgExperienceDraftGenerateNoticeEnabled) {
      cfgExperienceDraftGenerateNoticeEnabled.checked = c["BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED"] !== "false";
    }
    if (cfgLogLevel) cfgLogLevel.value = c["BELLDANDY_LOG_LEVEL"] || "info";
    if (cfgLogConsole) cfgLogConsole.checked = c["BELLDANDY_LOG_CONSOLE"] !== "false";
    if (cfgLogFile) cfgLogFile.checked = c["BELLDANDY_LOG_FILE"] !== "false";
    if (cfgLogDir) cfgLogDir.value = c["BELLDANDY_LOG_DIR"] || "";
    if (cfgLogMaxSize) cfgLogMaxSize.value = c["BELLDANDY_LOG_MAX_SIZE"] || "";
    if (cfgLogRetentionDays) cfgLogRetentionDays.value = c["BELLDANDY_LOG_RETENTION_DAYS"] || "";
    if (cfgDreamAutoHeartbeatEnabled) cfgDreamAutoHeartbeatEnabled.checked = c["BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED"] === "true";
    if (cfgDreamAutoCronEnabled) cfgDreamAutoCronEnabled.checked = c["BELLDANDY_DREAM_AUTO_CRON_ENABLED"] === "true";
    if (cfgDreamOpenAIThinking) cfgDreamOpenAIThinking.value = c["BELLDANDY_DREAM_OPENAI_THINKING"] || "";
    if (cfgDreamOpenAIReasoningEffort) cfgDreamOpenAIReasoningEffort.value = c["BELLDANDY_DREAM_OPENAI_REASONING_EFFORT"] || "";
    if (cfgDreamOpenAITimeoutMs) cfgDreamOpenAITimeoutMs.value = c["BELLDANDY_DREAM_OPENAI_TIMEOUT_MS"] || "";
    if (cfgDreamOpenAIMaxTokens) cfgDreamOpenAIMaxTokens.value = c["BELLDANDY_DREAM_OPENAI_MAX_TOKENS"] || "";
    if (cfgDreamObsidianEnabled) cfgDreamObsidianEnabled.checked = c["BELLDANDY_DREAM_OBSIDIAN_ENABLED"] === "true";
    if (cfgDreamObsidianVaultPath) cfgDreamObsidianVaultPath.value = c["BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH"] || "";
    if (cfgDreamObsidianRootDir) cfgDreamObsidianRootDir.value = c["BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR"] || "";
    if (cfgCommonsObsidianEnabled) cfgCommonsObsidianEnabled.checked = c["BELLDANDY_COMMONS_OBSIDIAN_ENABLED"] === "true";
    if (cfgCommonsObsidianVaultPath) cfgCommonsObsidianVaultPath.value = c["BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH"] || "";
    if (cfgCommonsObsidianRootDir) cfgCommonsObsidianRootDir.value = c["BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR"] || "";
    if (cfgRoomInjectThreshold) cfgRoomInjectThreshold.value = c["BELLDANDY_ROOM_INJECT_THRESHOLD"] || "";
    if (cfgRoomMembersCacheTtl) cfgRoomMembersCacheTtl.value = c["BELLDANDY_ROOM_MEMBERS_CACHE_TTL"] || "";
    lastLoadedFormState = captureSettingsFormState();
  }

  function captureSettingsFormState() {
    const snapshot = {};
    for (const [fieldName, ref] of Object.entries(refs || {})) {
      if (!ref || typeof ref !== "object") continue;
      if (typeof ref.value === "string") {
        snapshot[fieldName] = `value:${ref.value}`;
        continue;
      }
      if (typeof ref.checked === "boolean") {
        snapshot[fieldName] = `checked:${ref.checked ? "true" : "false"}`;
      }
    }
    return snapshot;
  }

  async function loadModelFallbackConfig() {
    if (!isConnected()) return;
    const configRes = await sendReq({ type: "req", id: makeId(), method: "models.config.get" });

    if (cfgModelFallbackContent && configRes?.ok) {
      const content = typeof configRes.payload?.content === "string"
        ? configRes.payload.content
        : '{\n  "fallbacks": []\n}\n';
      cfgModelFallbackContent.value = content;
    }
    if (modelFallbackConfigMeta) {
      if (configRes?.ok) {
        modelFallbackConfigMeta.textContent = t(
          "settings.modelFallbackConfigMeta",
          { path: configRes.payload?.path || "models.json" },
          `配置文件：${configRes.payload?.path || "models.json"}`,
        );
      } else if (handlePairingRequiredResponse(configRes)) {
        modelFallbackConfigMeta.textContent = t(
          "settings.modelFallbackConfigPairingRequired",
          {},
          "当前会话尚未完成 Pairing，完成批准后再读取模型 fallback 配置。",
        );
      } else {
        modelFallbackConfigMeta.textContent = t(
          "settings.modelFallbackConfigLoadFailed",
          {},
          "读取模型 fallback 配置失败",
        );
      }
    }
  }

  function stringifyConfiguredMemorySources(sources) {
    return `${JSON.stringify(Array.isArray(sources) ? sources : [], null, 2)}\n`;
  }

  function parseConfiguredMemorySourcesContent() {
    const fallback = [];
    const content = typeof cfgMemoryConfiguredSourcesContent?.value === "string"
      ? cfgMemoryConfiguredSourcesContent.value.trim()
      : "";
    if (!content) {
      return { ok: true, sources: fallback };
    }
    try {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          message: t("settings.memoryConfiguredSourcesInvalidArray", {}, "Configured Sources JSON 必须是数组。"),
        };
      }
      return { ok: true, sources: parsed };
    } catch (error) {
      return {
        ok: false,
        message: t(
          "settings.memoryConfiguredSourcesInvalidJson",
          { message: error instanceof Error ? error.message : String(error) },
          "Configured Sources JSON 解析失败：{message}",
        ),
      };
    }
  }

  function setConfiguredMemoryPreviewContent(value) {
    lastConfiguredMemoryPreviewPayload = value ?? null;
    if (!cfgMemoryConfiguredSourcesPreviewContent) return;
    cfgMemoryConfiguredSourcesPreviewContent.value = typeof value === "string"
      ? value
      : `${JSON.stringify(value ?? {}, null, 2)}\n`;
    updateConfiguredMemoryActionStatus(resolveConfiguredMemoryPreviewState(value));
  }

  function resolveConfiguredMemoryPreviewState(value) {
    const payload = value && typeof value === "object" ? value : null;
    const record = payload?.record && typeof payload.record === "object" ? payload.record : null;
    const report = payload?.report && typeof payload.report === "object" ? payload.report : null;
    const reportId = typeof record?.id === "string" && record.id.trim()
      ? record.id.trim()
      : typeof report?.id === "string" && report.id.trim()
        ? report.id.trim()
        : "";
    const status = typeof record?.status === "string" && record.status.trim()
      ? record.status.trim()
      : typeof report?.status === "string" && report.status.trim()
        ? report.status.trim()
        : "";
    return {
      kind: typeof payload?.kind === "string" ? payload.kind : "",
      reportId,
      status,
    };
  }

  function updateConfiguredMemoryActionStatus(state, overrideMessage = "") {
    if (!memoryConfiguredSourcesActionStatus) return;
    if (overrideMessage) {
      memoryConfiguredSourcesActionStatus.textContent = overrideMessage;
      return;
    }
    if (state?.reportId) {
      memoryConfiguredSourcesActionStatus.textContent = t(
        "settings.memoryConfiguredSourcesActionStatusReady",
        {
          reportId: state.reportId,
          status: state.status || "ready",
        },
        `当前 report：${state.reportId}（${state.status || "ready"}）`,
      );
      return;
    }
    memoryConfiguredSourcesActionStatus.textContent = t(
      "settings.memoryConfiguredSourcesActionStatusIdle",
      {},
      "当前还没有可执行的 ingest report。请先运行 External Ingest Preview。",
    );
  }

  function resolveConfiguredMemoryPreviewPayload() {
    const raw = typeof cfgMemoryConfiguredSourcesPreviewContent?.value === "string"
      ? cfgMemoryConfiguredSourcesPreviewContent.value.trim()
      : "";
    if (!raw) {
      return {
        ok: false,
        message: t(
          "settings.memoryConfiguredSourcesMissingReport",
          {},
          "当前预览里没有可操作的 ingest report。请先运行 External Ingest Preview。",
        ),
      };
    }
    try {
      const payload = JSON.parse(raw);
      lastConfiguredMemoryPreviewPayload = payload;
      return {
        ok: true,
        payload,
        state: resolveConfiguredMemoryPreviewState(payload),
      };
    } catch (error) {
      const fallbackState = resolveConfiguredMemoryPreviewState(lastConfiguredMemoryPreviewPayload);
      if (fallbackState?.reportId) {
        return {
          ok: true,
          payload: lastConfiguredMemoryPreviewPayload,
          state: fallbackState,
        };
      }
      return {
        ok: false,
        message: t(
          "settings.memoryConfiguredSourcesPreviewStateInvalid",
          { message: error instanceof Error ? error.message : String(error) },
          "当前预览结果不是有效 JSON：{message}",
        ),
      };
    }
  }

  function readConfiguredMemoryActionNote() {
    return typeof cfgMemoryConfiguredSourcesActionNote?.value === "string"
      ? cfgMemoryConfiguredSourcesActionNote.value.trim()
      : "";
  }

  async function loadConfiguredMemorySources() {
    if (!isConnected()) return;
    const res = await sendReq({ type: "req", id: makeId(), method: "memory.configured_sources.get" });
    if (cfgMemoryConfiguredSourcesContent && res?.ok) {
      const sources = Array.isArray(res.payload?.configuredSources) ? res.payload.configuredSources : [];
      const content = stringifyConfiguredMemorySources(sources);
      cfgMemoryConfiguredSourcesContent.value = content;
      lastLoadedConfiguredMemorySourcesContent = content;
    }
    if (memoryConfiguredSourcesMeta) {
      if (res?.ok) {
        memoryConfiguredSourcesMeta.textContent = t(
          "settings.memoryConfiguredSourcesMeta",
          { path: res.payload?.path || "memory-configured-sources.json" },
          `配置文件：${res.payload?.path || "memory-configured-sources.json"}`,
        );
      } else if (handlePairingRequiredResponse(res)) {
        memoryConfiguredSourcesMeta.textContent = t(
          "settings.memoryConfiguredSourcesPairingRequired",
          {},
          "当前会话尚未完成 Pairing，完成批准后再读取外来源配置。",
        );
      } else {
        memoryConfiguredSourcesMeta.textContent = t(
          "settings.memoryConfiguredSourcesLoadFailed",
          {},
          "读取外来源配置失败",
        );
      }
    }
  }

  async function saveConfiguredMemorySources() {
    if (!cfgMemoryConfiguredSourcesContent) return { ok: true };
    const parsed = parseConfiguredMemorySourcesContent();
    if (!parsed.ok) {
      return { ok: false, message: parsed.message || "Invalid configured sources JSON" };
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.configured_sources.update",
      params: {
        configuredSources: parsed.sources,
      },
    });
    if (!res?.ok) {
      return {
        ok: false,
        message: res?.error?.message || "Failed to save configured memory sources",
      };
    }
    const nextContent = stringifyConfiguredMemorySources(
      Array.isArray(res.payload?.configuredSources) ? res.payload.configuredSources : parsed.sources,
    );
    cfgMemoryConfiguredSourcesContent.value = nextContent;
    lastLoadedConfiguredMemorySourcesContent = nextContent;
    if (memoryConfiguredSourcesMeta) {
      memoryConfiguredSourcesMeta.textContent = t(
        "settings.memoryConfiguredSourcesMeta",
        { path: res.payload?.path || "memory-configured-sources.json" },
        `配置文件：${res.payload?.path || "memory-configured-sources.json"}`,
      );
    }
    return { ok: true };
  }

  async function previewConfiguredMemoryInventory() {
    if (!isConnected()) return;
    const parsed = parseConfiguredMemorySourcesContent();
    if (!parsed.ok) {
      alert(parsed.message || t("settings.memoryConfiguredSourcesPreviewFailed", {}, "来源配置预览失败。"));
      return;
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.inventory.preview",
      params: {
        configuredSources: parsed.sources,
      },
    });
    if (!res?.ok) {
      alert(t(
        "settings.memoryConfiguredSourcesInventoryPreviewFailed",
        { message: res?.error?.message || "Unknown error" },
        "Inventory preview 失败：{message}",
      ));
      return;
    }
    setConfiguredMemoryPreviewContent({
      kind: "inventory_preview",
      report: res.payload?.report ?? null,
    });
  }

  async function previewConfiguredMemoryExternalIngest() {
    if (!isConnected()) return;
    const parsed = parseConfiguredMemorySourcesContent();
    if (!parsed.ok) {
      alert(parsed.message || t("settings.memoryConfiguredSourcesPreviewFailed", {}, "来源配置预览失败。"));
      return;
    }
    const configuredSourceId = typeof cfgMemoryConfiguredSourceId?.value === "string"
      ? cfgMemoryConfiguredSourceId.value.trim()
      : "";
    const params = {
      configuredSources: parsed.sources,
      ...(configuredSourceId ? { configuredSourceId } : {}),
    };
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.tree.report.external_ingest.preview",
      params,
    });
    if (!res?.ok) {
      alert(t(
        "settings.memoryConfiguredSourcesIngestPreviewFailed",
        { message: res?.error?.message || "Unknown error" },
        "External ingest preview 失败：{message}",
      ));
      return;
    }
    setConfiguredMemoryPreviewContent({
      kind: "external_ingest_preview",
      report: res.payload?.report ?? null,
      record: res.payload?.record ?? null,
    });
  }

  async function reviewConfiguredMemoryReport(decision) {
    if (!isConnected()) return;
    const preview = resolveConfiguredMemoryPreviewPayload();
    if (!preview.ok) {
      alert(preview.message);
      return;
    }
    if (!preview.state?.reportId) {
      const message = t(
        "settings.memoryConfiguredSourcesMissingReport",
        {},
        "当前预览里没有可操作的 ingest report。请先运行 External Ingest Preview。",
      );
      updateConfiguredMemoryActionStatus(null, message);
      alert(message);
      return;
    }
    const note = readConfiguredMemoryActionNote();
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.tree.report.review",
      params: {
        reportId: preview.state.reportId,
        decision,
        reviewedBy: "webchat.settings",
        ...(note ? { note } : {}),
      },
    });
    if (!res?.ok) {
      if (handlePairingRequiredResponse(res)) {
        updateConfiguredMemoryActionStatus(preview.state);
        return;
      }
      const message = t(
        "settings.memoryConfiguredSourcesReportReviewFailed",
        { message: res?.error?.message || "Unknown error" },
        "Report review 失败：{message}",
      );
      updateConfiguredMemoryActionStatus(preview.state, message);
      alert(message);
      return;
    }
    setConfiguredMemoryPreviewContent({
      kind: "report_review",
      report: res.payload?.report ?? null,
      result: res.payload?.result ?? null,
    });
  }

  async function applyConfiguredMemoryReport() {
    if (!isConnected()) return;
    const preview = resolveConfiguredMemoryPreviewPayload();
    if (!preview.ok) {
      alert(preview.message);
      return;
    }
    if (!preview.state?.reportId) {
      const message = t(
        "settings.memoryConfiguredSourcesMissingReport",
        {},
        "当前预览里没有可操作的 ingest report。请先运行 External Ingest Preview。",
      );
      updateConfiguredMemoryActionStatus(null, message);
      alert(message);
      return;
    }
    const note = readConfiguredMemoryActionNote();
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.tree.report.apply",
      params: {
        reportId: preview.state.reportId,
        confirmed: true,
        appliedBy: "webchat.settings",
        ...(note ? { note } : {}),
      },
    });
    if (!res?.ok) {
      if (handlePairingRequiredResponse(res)) {
        updateConfiguredMemoryActionStatus(preview.state);
        return;
      }
      const message = t(
        "settings.memoryConfiguredSourcesReportApplyFailed",
        { message: res?.error?.message || "Unknown error" },
        "Report apply 失败：{message}",
      );
      updateConfiguredMemoryActionStatus(preview.state, message);
      alert(message);
      return;
    }
    setConfiguredMemoryPreviewContent({
      kind: "report_apply",
      report: res.payload?.report ?? null,
      result: res.payload?.result ?? null,
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function renderChannelSecurityPending(pending = []) {
    if (!channelSecurityPendingList) return;
    if (!Array.isArray(pending) || pending.length === 0) {
      channelSecurityPendingList.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("settings.channelSecurityPendingEmpty", {}, "当前没有待审批 sender。"))}</div>`;
      return;
    }
    channelSecurityPendingList.innerHTML = pending.map((item) => `
      <div class="memory-detail-card">
        <span class="memory-detail-label">${escapeHtml(`${item.channel}${item.accountId ? `/${item.accountId}` : ""}:${item.senderId}`)}</span>
        <div class="memory-detail-text">${escapeHtml(item.senderName || "-")}</div>
        <div class="memory-list-item-meta">
          <span>${escapeHtml(item.chatId || "-")}</span>
          <span>${escapeHtml(formatDateTime(item.updatedAt || item.requestedAt))}</span>
          <span>${escapeHtml(`seen ${Number(item.seenCount || 0)}`)}</span>
        </div>
        ${item.messagePreview ? `<div class="memory-list-item-snippet">${escapeHtml(item.messagePreview)}</div>` : ""}
        <div class="goal-detail-actions goal-checkpoint-actions">
          <button type="button" class="button goal-inline-action" data-channel-security-action="approve" data-channel-security-request-id="${escapeHtml(item.id)}">${escapeHtml(t("settings.channelSecurityApprove", {}, "批准"))}</button>
          <button type="button" class="button goal-inline-action-secondary" data-channel-security-action="reject" data-channel-security-request-id="${escapeHtml(item.id)}">${escapeHtml(t("settings.channelSecurityReject", {}, "拒绝"))}</button>
        </div>
      </div>
    `).join("");
  }

  function renderPairingPending(pending = []) {
    if (!pairingPendingList) return;
    if (!Array.isArray(pending) || pending.length === 0) {
      pairingPendingList.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("settings.pairingPendingEmpty", {}, "当前没有待批准的配对码。"))}</div>`;
      return;
    }
    pairingPendingList.innerHTML = pending.map((item) => `
      <div class="memory-detail-card">
        <span class="memory-detail-label">Pairing Code: ${escapeHtml(item.code || "-")}</span>
        <div class="memory-detail-text">${escapeHtml(item.message || t("settings.pairingPendingDefaultMessage", {}, "当前 WebChat 会话需要完成配对批准。"))}</div>
        <div class="memory-list-item-meta">
          <span>${escapeHtml(item.clientId || "-")}</span>
          <span>${escapeHtml(formatDateTime(item.updatedAt))}</span>
        </div>
        <div class="goal-detail-actions goal-checkpoint-actions">
          <button type="button" class="button goal-inline-action" data-pairing-action="approve" data-pairing-code="${escapeHtml(item.code || "")}">${escapeHtml(t("settings.pairingApprove", {}, "批准"))}</button>
        </div>
      </div>
    `).join("");
  }

  async function loadChannelSecurityConfig() {
    if (!isConnected()) return;
    const configRes = await sendReq({ type: "req", id: makeId(), method: "channel.security.get" });

    if (cfgChannelSecurityContent && configRes?.ok) {
      const content = typeof configRes.payload?.content === "string"
        ? configRes.payload.content
        : '{\n  "version": 1,\n  "channels": {}\n}\n';
      cfgChannelSecurityContent.value = content;
      lastLoadedChannelSecurityContent = content;
    }
    if (channelSecurityConfigMeta) {
      if (configRes?.ok) {
        channelSecurityConfigMeta.textContent = t(
          "settings.channelSecurityMeta",
          { path: configRes.payload?.path || "channel-security.json" },
          `配置文件：${configRes.payload?.path || "channel-security.json"}`,
        );
      } else if (handlePairingRequiredResponse(configRes)) {
        channelSecurityConfigMeta.textContent = t(
          "settings.channelSecurityPairingRequired",
          {},
          "当前会话尚未完成 Pairing，完成批准后再读取渠道安全配置。",
        );
      } else {
        channelSecurityConfigMeta.textContent = t("settings.channelSecurityLoadFailed", {}, "读取渠道安全配置失败");
      }
    }
  }

  async function loadChannelReplyChunkingConfig() {
    if (!isConnected()) return;
    const configRes = await sendReq({ type: "req", id: makeId(), method: "channel.reply_chunking.get" });

    if (cfgChannelReplyChunkingContent && configRes?.ok) {
      const content = typeof configRes.payload?.content === "string"
        ? configRes.payload.content
        : '{\n  "version": 1,\n  "channels": {}\n}\n';
      cfgChannelReplyChunkingContent.value = content;
      lastLoadedChannelReplyChunkingContent = content;
    }
    if (channelReplyChunkingConfigMeta) {
      if (configRes?.ok) {
        channelReplyChunkingConfigMeta.textContent = t(
          "settings.channelReplyChunkingMeta",
          { path: configRes.payload?.path || "channel-reply-chunking.json" },
          `配置文件：${configRes.payload?.path || "channel-reply-chunking.json"}`,
        );
      } else if (handlePairingRequiredResponse(configRes)) {
        channelReplyChunkingConfigMeta.textContent = t(
          "settings.channelReplyChunkingPairingRequired",
          {},
          "当前会话尚未完成 Pairing，完成批准后再读取渠道回复分段配置。",
        );
      } else {
        channelReplyChunkingConfigMeta.textContent = t("settings.channelReplyChunkingLoadFailed", {}, "读取渠道回复分段配置失败");
      }
    }
  }

  async function loadChannelSecurityPendingList() {
    if (!isConnected()) return;
    const pendingRes = await sendReq({ type: "req", id: makeId(), method: "channel.security.pending.list" });
    renderChannelSecurityPending(pendingRes?.ok ? pendingRes.payload?.pending : []);
  }

  async function loadChannelSecuritySurface() {
    if (!isConnected()) return;
    await Promise.all([
      loadChannelSecurityConfig(),
      loadChannelReplyChunkingConfig(),
      loadChannelSecurityPendingList(),
    ]);
  }

  async function saveChannelSecurityConfig() {
    if (!cfgChannelSecurityContent) return { ok: true };
    const content = cfgChannelSecurityContent.value || '{\n  "version": 1,\n  "channels": {}\n}\n';
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "channel.security.update",
      params: { content },
    });
    if (!res?.ok) {
      return {
        ok: false,
        message: res?.error?.message || "Failed to save channel security config",
      };
    }
    const nextContent = typeof res.payload?.content === "string" ? res.payload.content : content;
    cfgChannelSecurityContent.value = nextContent;
    lastLoadedChannelSecurityContent = nextContent;
    if (channelSecurityConfigMeta) {
      channelSecurityConfigMeta.textContent = t(
        "settings.channelSecurityMeta",
        { path: res.payload?.path || "channel-security.json" },
        `配置文件：${res.payload?.path || "channel-security.json"}`,
      );
    }
    return { ok: true };
  }

  async function saveModelFallbackConfig() {
    if (!cfgModelFallbackContent) return { ok: true };
    const content = cfgModelFallbackContent.value || '{\n  "fallbacks": []\n}\n';
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "models.config.update",
      params: { content },
    });
    if (!res?.ok) {
      return {
        ok: false,
        message: res?.error?.message || "Failed to save model fallback config",
      };
    }
    const nextContent = typeof res.payload?.content === "string" ? res.payload.content : content;
    cfgModelFallbackContent.value = nextContent;
    if (modelFallbackConfigMeta) {
      modelFallbackConfigMeta.textContent = t(
        "settings.modelFallbackConfigMeta",
        { path: res.payload?.path || "models.json" },
        `配置文件：${res.payload?.path || "models.json"}`,
      );
    }
    return { ok: true };
  }

  async function saveChannelReplyChunkingConfig() {
    if (!cfgChannelReplyChunkingContent) return { ok: true };
    const content = cfgChannelReplyChunkingContent.value || '{\n  "version": 1,\n  "channels": {}\n}\n';
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "channel.reply_chunking.update",
      params: { content },
    });
    if (!res?.ok) {
      return {
        ok: false,
        message: res?.error?.message || "Failed to save channel reply chunking config",
      };
    }
    const nextContent = typeof res.payload?.content === "string" ? res.payload.content : content;
    cfgChannelReplyChunkingContent.value = nextContent;
    lastLoadedChannelReplyChunkingContent = nextContent;
    if (channelReplyChunkingConfigMeta) {
      channelReplyChunkingConfigMeta.textContent = t(
        "settings.channelReplyChunkingMeta",
        { path: res.payload?.path || "channel-reply-chunking.json" },
        `配置文件：${res.payload?.path || "channel-reply-chunking.json"}`,
      );
    }
    return { ok: true };
  }

  async function handleChannelSecurityPendingAction(action, requestId, buttonEl) {
    if (!isConnected()) return;
    const originalText = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = t("settings.channelSecurityProcessing", {}, "处理中...");
    const method = action === "approve" ? "channel.security.approve" : "channel.security.reject";
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method,
      params: { requestId },
    });
    if (!res?.ok) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
      alert(t("settings.channelSecurityActionFailed", { message: res?.error?.message || "Unknown error" }, "渠道安全审批操作失败：{message}"));
      return;
    }
    await loadChannelSecuritySurface();
    await runDoctor({ forceRefresh: true });
  }

  async function handlePairingPendingAction(code, buttonEl) {
    if (!isConnected()) return;
    if (typeof onApprovePairing !== "function") return;
    const originalText = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = t("settings.pairingProcessing", {}, "处理中...");
    const res = await onApprovePairing(code);
    if (!res?.ok) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
      alert(t("settings.pairingApproveFailed", { message: res?.message || "Unknown error" }, "配对批准失败：{message}"));
    }
  }

  function assignSecretUpdate(updates, key, inputEl) {
    if (!inputEl) return;
    const value = inputEl.value.trim();
    if (value === redactedPlaceholder) return;
    updates[key] = value;
  }

  function assignSecretUpdates(updates, keys, inputEl) {
    if (!Array.isArray(keys)) return;
    keys.forEach((key) => assignSecretUpdate(updates, key, inputEl));
  }

  function assignSecretOverrideUpdate(updates, key, inputEl) {
    if (!inputEl) return;
    const value = inputEl.value.trim();
    if (!value || value === redactedPlaceholder) return;
    updates[key] = value;
  }

  const doctorToggleBtn = document.getElementById("doctorToggleBtn");
  if (doctorToggleBtn) {
    doctorToggleBtn.addEventListener("click", () => {
      if (doctorStatusEl) doctorStatusEl.classList.toggle("hidden");
    });
  }

  function attachLocalDoctorObservability(payload) {
    if (!payload || typeof payload !== "object" || typeof getWebchatPerformanceSummary !== "function") {
      return payload;
    }
    try {
      const webchatPerformance = getWebchatPerformanceSummary();
      return webchatPerformance && typeof webchatPerformance === "object"
        ? { ...payload, webchatPerformance }
        : payload;
    } catch {
      return payload;
    }
  }

  function renderDoctorPayload(payload, options = {}) {
    if (!doctorStatusEl || !doctorToggleBtn || !payload?.checks) return false;
    let hasFail = false;
    let hasWarn = false;
    doctorStatusEl.innerHTML = "";

    const doctorPerformance = payload.performance;
    if (doctorPerformance && Number.isFinite(Number(doctorPerformance.totalMs))) {
      const timingBadge = document.createElement("span");
      timingBadge.className = "badge doctor-summary-badge";
      const stages = Array.isArray(doctorPerformance.stages) ? doctorPerformance.stages : [];
      const slowStages = stages
        .filter((stage) => Number.isFinite(Number(stage?.durationMs)))
        .sort((left, right) => Number(right.durationMs || 0) - Number(left.durationMs || 0))
        .slice(0, 2)
        .map((stage) => `${stage.name}:${Math.round(Number(stage.durationMs || 0))}ms`);
      timingBadge.textContent = slowStages.length > 0
        ? t(
          "settings.doctorTimingSummary",
          { totalMs: Math.round(Number(doctorPerformance.totalMs || 0)), slowStages: slowStages.join(", ") },
          `耗时 ${Math.round(Number(doctorPerformance.totalMs || 0))}ms · ${slowStages.join(", ")}`,
        )
        : t(
          "settings.doctorTiming",
          { totalMs: Math.round(Number(doctorPerformance.totalMs || 0)) },
          `耗时 ${Math.round(Number(doctorPerformance.totalMs || 0))}ms`,
        );
      doctorStatusEl.appendChild(timingBadge);
    }

    if (options.detailPending) {
      const pendingBadge = document.createElement("span");
      pendingBadge.className = "badge doctor-summary-badge";
      pendingBadge.textContent = t(
        "settings.doctorLoadingDetails",
        {},
        "正在加载详细观察项...",
      );
      doctorStatusEl.appendChild(pendingBadge);
    }

    payload.checks.forEach((check) => {
      if (check.status === "fail") {
        hasFail = true;
      } else if (check.status === "warn") {
        hasWarn = true;
      }
      const badge = document.createElement("span");
      badge.className = `badge doctor-summary-badge ${check.status}`;
      badge.textContent = `${check.name}: ${check.message || check.status}`;
      doctorStatusEl.appendChild(badge);
    });

    if (options.includeCards) {
      renderDoctorObservabilityCards(doctorStatusEl, attachLocalDoctorObservability(payload), t, {
        onOpenContinuationAction,
      });
    }

    if (hasFail) {
      doctorToggleBtn.className = "button badge fail";
      doctorToggleBtn.textContent = t("settings.doctorHasIssues", {}, "存在未通过的检查");
    } else if (hasWarn) {
      doctorToggleBtn.className = "button badge warn";
      doctorToggleBtn.textContent = t("settings.doctorHasWarnings", {}, "存在需关注项");
    } else {
      doctorToggleBtn.className = "button badge pass";
      doctorToggleBtn.textContent = t("settings.doctorAllPassed", {}, "所有检查通过");
    }

    return true;
  }

  async function loadDoctorDetails(version, requestParams = {}) {
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "system.doctor",
      params: {
        ...requestParams,
        surface: "full",
      },
    });
    if (version !== doctorRequestVersion || !doctorStatusEl) {
      return;
    }
    if (res?.ok && res.payload?.checks) {
      renderDoctorPayload(res.payload, { includeCards: true });
      return;
    }
    const badge = document.createElement("span");
    badge.className = "badge doctor-summary-badge warn";
    badge.textContent = t(
      "settings.doctorDetailLoadFailed",
      {},
      "详细观察项加载失败，当前显示的是摘要结果。",
    );
    doctorStatusEl.appendChild(badge);
  }

  async function runDoctor(options = {}) {
    if (!doctorStatusEl || !doctorToggleBtn) return;
    const version = ++doctorRequestVersion;
    doctorToggleBtn.className = "button button-muted badge";
    doctorToggleBtn.innerHTML = `<span data-i18n="settings.doctorChecking">${t("settings.doctorChecking", {}, "检查中...")}</span>`;
    doctorStatusEl.innerHTML = "";
    
    if (!isConnected()) {
      doctorToggleBtn.className = "button badge fail";
      doctorToggleBtn.innerHTML = `<span data-i18n="settings.doctorDisconnected">${t("settings.doctorDisconnected", {}, "Disconnected")}</span>`;
      return;
    }

    const requestParams = options.forceRefresh === true ? { forceRefresh: true } : {};
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "system.doctor",
      params: {
        ...requestParams,
        surface: "summary",
      },
    });
    if (version !== doctorRequestVersion) {
      return;
    }
    if (res && res.ok && res.payload && res.payload.checks) {
      renderDoctorPayload(res.payload, {
        includeCards: false,
        detailPending: true,
      });
      void loadDoctorDetails(version, requestParams);
      return;
    }
    if (handlePairingRequiredResponse(res)) {
      doctorToggleBtn.className = "button badge warn";
      doctorToggleBtn.textContent = t("settings.doctorPairingRequired", {}, "等待配对批准");
      const badge = document.createElement("span");
      badge.className = "badge doctor-summary-badge warn";
      badge.textContent = t(
        "settings.doctorPairingRequiredHelp",
        {},
        "系统检查依赖已完成 Pairing 的当前 WebChat 会话；请先批准配对码后再重试。",
      );
      doctorStatusEl.appendChild(badge);
      return;
    }
    doctorToggleBtn.className = "button badge fail";
    doctorToggleBtn.innerHTML = `<span data-i18n="settings.doctorCheckFailed">${t("settings.doctorCheckFailed", {}, "Check Failed")}</span>`;
  }

  async function saveConfig() {
    if (!isConnected()) {
      alert(t("settings.notConnectedError", {}, "Error: Not connected to server.\nPlease refresh the page or check if the Gateway is running."));
      return;
    }
    if (saveSettingsBtn) {
      saveSettingsBtn.textContent = t("settings.saving", {}, "Saving...");
      saveSettingsBtn.disabled = true;
    }

    const updates = {};
    const mainApiKey = cfgApiKey.value.trim();
    if (cfgHost) updates["BELLDANDY_HOST"] = cfgHost.value.trim() || "127.0.0.1";
    if (cfgPort) updates["BELLDANDY_PORT"] = cfgPort.value.trim() || "28889";
    if (cfgGatewayPort) updates["BELLDANDY_GATEWAY_PORT"] = cfgGatewayPort.value.trim() || "28889";
    if (cfgUpdateCheckEnabled) updates["BELLDANDY_UPDATE_CHECK"] = cfgUpdateCheckEnabled.checked ? "true" : "false";
    if (cfgUpdateCheckTimeoutMs) updates["BELLDANDY_UPDATE_CHECK_TIMEOUT_MS"] = cfgUpdateCheckTimeoutMs.value.trim();
    if (cfgUpdateCheckApiUrl) updates["BELLDANDY_UPDATE_CHECK_API_URL"] = cfgUpdateCheckApiUrl.value.trim();
    if (cfgDevRuntimeDistGuard) updates["BELLDANDY_DEV_RUNTIME_DIST_GUARD"] = cfgDevRuntimeDistGuard.value.trim() || "build";
    if (cfgAuthMode) updates["BELLDANDY_AUTH_MODE"] = cfgAuthMode.value.trim() || "none";
    assignSecretUpdate(updates, "BELLDANDY_AUTH_TOKEN", cfgAuthToken);
    assignSecretUpdate(updates, "BELLDANDY_AUTH_PASSWORD", cfgAuthPassword);
    if (cfgAllowedOrigins) updates["BELLDANDY_ALLOWED_ORIGINS"] = cfgAllowedOrigins.value.trim();
    if (cfgAttachmentMaxFileBytes) updates["BELLDANDY_ATTACHMENT_MAX_FILE_BYTES"] = cfgAttachmentMaxFileBytes.value.trim();
    if (cfgAttachmentMaxTotalBytes) updates["BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES"] = cfgAttachmentMaxTotalBytes.value.trim();
    if (cfgAttachmentTextCharLimit) updates["BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT"] = cfgAttachmentTextCharLimit.value.trim();
    if (cfgAttachmentTextTotalCharLimit) updates["BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT"] = cfgAttachmentTextTotalCharLimit.value.trim();
    if (cfgAudioTranscriptAppendCharLimit) updates["BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT"] = cfgAudioTranscriptAppendCharLimit.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_OPENAI_API_KEY", cfgApiKey);
    updates["BELLDANDY_OPENAI_BASE_URL"] = cfgBaseUrl.value.trim() || "https://api.openai.com/v1";
    updates["BELLDANDY_OPENAI_MODEL"] = cfgModel.value.trim();
    if (cfgAgentProvider) updates["BELLDANDY_AGENT_PROVIDER"] = cfgAgentProvider.value.trim() || "openai";
    if (cfgOpenAiStreamEnabled) updates["BELLDANDY_OPENAI_STREAM"] = cfgOpenAiStreamEnabled.checked ? "true" : "false";
    if (cfgOpenAiWireApi) updates["BELLDANDY_OPENAI_WIRE_API"] = cfgOpenAiWireApi.value.trim() || "chat_completions";
    if (cfgOpenAiThinking) updates["BELLDANDY_OPENAI_THINKING"] = cfgOpenAiThinking.value.trim();
    if (cfgOpenAiReasoningEffort) updates["BELLDANDY_OPENAI_REASONING_EFFORT"] = cfgOpenAiReasoningEffort.value.trim();
    if (cfgResponsesSanitizeToolSchema) updates["BELLDANDY_RESPONSES_SANITIZE_TOOL_SCHEMA"] = cfgResponsesSanitizeToolSchema.checked ? "true" : "false";
    if (cfgOpenAiMaxRetries) updates["BELLDANDY_OPENAI_MAX_RETRIES"] = cfgOpenAiMaxRetries.value.trim();
    if (cfgOpenAiRetryBackoffMs) updates["BELLDANDY_OPENAI_RETRY_BACKOFF_MS"] = cfgOpenAiRetryBackoffMs.value.trim();
    if (cfgOpenAiProxyUrl) updates["BELLDANDY_OPENAI_PROXY_URL"] = cfgOpenAiProxyUrl.value.trim();
    if (cfgPrimaryWarmupEnabled) updates["BELLDANDY_PRIMARY_WARMUP_ENABLED"] = cfgPrimaryWarmupEnabled.checked ? "true" : "false";
    if (cfgPrimaryWarmupTimeoutMs) updates["BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS"] = cfgPrimaryWarmupTimeoutMs.value.trim();
    if (cfgPrimaryWarmupCooldownMs) updates["BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS"] = cfgPrimaryWarmupCooldownMs.value.trim();
    if (cfgOpenAiSystemPrompt) updates["BELLDANDY_OPENAI_SYSTEM_PROMPT"] = cfgOpenAiSystemPrompt.value;
    if (cfgAgentTimeoutMs) updates["BELLDANDY_AGENT_TIMEOUT_MS"] = cfgAgentTimeoutMs.value.trim();
    if (cfgAgentProtocol) updates["BELLDANDY_AGENT_PROTOCOL"] = cfgAgentProtocol.value.trim();
    if (cfgVideoFileApiUrl) updates["BELLDANDY_VIDEO_FILE_API_URL"] = cfgVideoFileApiUrl.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_VIDEO_FILE_API_KEY", cfgVideoFileApiKey);
    if (cfgModelPreferredProviders) {
      updates["BELLDANDY_MODEL_PREFERRED_PROVIDERS"] = cfgModelPreferredProviders.value.trim();
    }
    Object.assign(updates, collectAssistantModeSettingsUpdates({
      cfgAssistantModeEnabled,
      cfgExternalOutboundRequireConfirmation,
      cfgAssistantExternalDeliveryPreference,
      cfgHeartbeat,
      cfgHeartbeatEnabled,
      cfgHeartbeatActiveHours,
      cfgCronEnabled,
      cfgStarweaverActiveNotifyEnabled,
      cfgStarweaverActiveNotifyPollIntervalMs,
    }, {
      applyEnabledDefaults: true,
    }));
    if (cfgBrowserRelayEnabled) updates["BELLDANDY_BROWSER_RELAY_ENABLED"] = cfgBrowserRelayEnabled.checked ? "true" : "false";
    if (cfgRelayPort) updates["BELLDANDY_RELAY_PORT"] = cfgRelayPort.value.trim();
    if (cfgMcpEnabled) updates["BELLDANDY_MCP_ENABLED"] = cfgMcpEnabled.checked ? "true" : "false";
    if (cfgBrowserAllowedDomains) updates["BELLDANDY_BROWSER_ALLOWED_DOMAINS"] = cfgBrowserAllowedDomains.value.trim();
    if (cfgBrowserDeniedDomains) updates["BELLDANDY_BROWSER_DENIED_DOMAINS"] = cfgBrowserDeniedDomains.value.trim();
    if (cfgAgentBridgeEnabled) updates["BELLDANDY_AGENT_BRIDGE_ENABLED"] = cfgAgentBridgeEnabled.checked ? "true" : "false";
    if (cfgToolGroups) updates["BELLDANDY_TOOL_GROUPS"] = cfgToolGroups.value.trim();
    if (cfgMaxInputTokens) updates["BELLDANDY_MAX_INPUT_TOKENS"] = cfgMaxInputTokens.value.trim();
    if (cfgMaxOutputTokens) updates["BELLDANDY_MAX_OUTPUT_TOKENS"] = cfgMaxOutputTokens.value.trim();
    if (cfgToolLoopIterationBudget) updates["BELLDANDY_TOOL_LOOP_ITERATION_BUDGET"] = cfgToolLoopIterationBudget.value.trim();
    if (cfgToolLoopWarningFraction) updates["BELLDANDY_TOOL_LOOP_WARNING_FRACTION"] = cfgToolLoopWarningFraction.value.trim();
    if (cfgWebAllowPrivilegedSafeScope) updates["BELLDANDY_WEB_ALLOW_PRIVILEGED_SAFE_SCOPE"] = cfgWebAllowPrivilegedSafeScope.checked ? "true" : "false";
    if (cfgPrivilegedWorkspaceWriteChannels) updates["BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS"] = cfgPrivilegedWorkspaceWriteChannels.value.trim();
    if (cfgDangerousToolsEnabled) updates["BELLDANDY_DANGEROUS_TOOLS_ENABLED"] = cfgDangerousToolsEnabled.checked ? "true" : "false";
    if (cfgToolsPolicyFile) updates["BELLDANDY_TOOLS_POLICY_FILE"] = cfgToolsPolicyFile.value.trim();
    if (cfgSubAgentMaxConcurrent) updates["BELLDANDY_SUB_AGENT_MAX_CONCURRENT"] = cfgSubAgentMaxConcurrent.value.trim();
    if (cfgSubAgentMaxQueueSize) updates["BELLDANDY_SUB_AGENT_MAX_QUEUE_SIZE"] = cfgSubAgentMaxQueueSize.value.trim();
    if (cfgSubAgentTimeoutMs) updates["BELLDANDY_SUB_AGENT_TIMEOUT_MS"] = cfgSubAgentTimeoutMs.value.trim();
    if (cfgSubAgentMaxDepth) updates["BELLDANDY_SUB_AGENT_MAX_DEPTH"] = cfgSubAgentMaxDepth.value.trim();
    if (cfgWorkflowMaxConcurrent) updates["BELLDANDY_WORKFLOW_MAX_CONCURRENT"] = cfgWorkflowMaxConcurrent.value.trim();
    if (cfgWorkflowMaxQueueSize) updates["BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE"] = cfgWorkflowMaxQueueSize.value.trim();
    if (cfgWorkflowTimeoutMs) updates["BELLDANDY_WORKFLOW_TIMEOUT_MS"] = cfgWorkflowTimeoutMs.value.trim();
    if (cfgWorkflowAgentTimeoutMs) updates["BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS"] = cfgWorkflowAgentTimeoutMs.value.trim();
    if (cfgWorkflowMaxAgentCalls) updates["BELLDANDY_WORKFLOW_MAX_AGENT_CALLS"] = cfgWorkflowMaxAgentCalls.value.trim();
    if (cfgWorkflowMaxDepth) updates["BELLDANDY_WORKFLOW_MAX_DEPTH"] = cfgWorkflowMaxDepth.value.trim();
    if (cfgMemoryEnabled) updates["BELLDANDY_MEMORY_ENABLED"] = cfgMemoryEnabled.checked ? "true" : "false";
    if (cfgEmbeddingEnabled) updates["BELLDANDY_EMBEDDING_ENABLED"] = cfgEmbeddingEnabled.checked ? "true" : "false";
    if (cfgEmbeddingProvider) updates["BELLDANDY_EMBEDDING_PROVIDER"] = cfgEmbeddingProvider.value.trim() || "openai";
    if (cfgEmbeddingBaseUrl) updates["BELLDANDY_EMBEDDING_OPENAI_BASE_URL"] = cfgEmbeddingBaseUrl.value.trim();
    if (cfgEmbeddingModel) updates["BELLDANDY_EMBEDDING_MODEL"] = cfgEmbeddingModel.value.trim();
    if (cfgLocalEmbeddingModel) updates["BELLDANDY_LOCAL_EMBEDDING_MODEL"] = cfgLocalEmbeddingModel.value.trim();
    if (cfgEmbeddingBatchSize) updates["BELLDANDY_EMBEDDING_BATCH_SIZE"] = cfgEmbeddingBatchSize.value.trim();
    if (cfgContextInjectionEnabled) updates["BELLDANDY_CONTEXT_INJECTION"] = cfgContextInjectionEnabled.checked ? "true" : "false";
    if (cfgContextInjectionLimit) updates["BELLDANDY_CONTEXT_INJECTION_LIMIT"] = cfgContextInjectionLimit.value.trim();
    if (cfgContextInjectionIncludeSession) updates["BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION"] = cfgContextInjectionIncludeSession.checked ? "true" : "false";
    if (cfgContextInjectionTaskLimit) updates["BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT"] = cfgContextInjectionTaskLimit.value.trim();
    if (cfgContextInjectionAllowedCategories) updates["BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES"] = cfgContextInjectionAllowedCategories.value.trim();
    if (cfgCarryoverContextEnabled) updates["BELLDANDY_CARRYOVER_CONTEXT_ENABLED"] = cfgCarryoverContextEnabled.checked ? "true" : "false";
    if (cfgAutoRecallEnabled) updates["BELLDANDY_AUTO_RECALL_ENABLED"] = cfgAutoRecallEnabled.checked ? "true" : "false";
    if (cfgAutoRecallLimit) updates["BELLDANDY_AUTO_RECALL_LIMIT"] = cfgAutoRecallLimit.value.trim();
    if (cfgAutoRecallMinScore) updates["BELLDANDY_AUTO_RECALL_MIN_SCORE"] = cfgAutoRecallMinScore.value.trim();
    if (cfgToolResultTranscriptCharLimit) updates["BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT"] = cfgToolResultTranscriptCharLimit.value.trim();
    if (cfgMindProfileRuntimeEnabled) updates["BELLDANDY_MIND_PROFILE_RUNTIME_ENABLED"] = cfgMindProfileRuntimeEnabled.checked ? "true" : "false";
    if (cfgMindProfileRuntimeMaxLines) updates["BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINES"] = cfgMindProfileRuntimeMaxLines.value.trim();
    if (cfgMindProfileRuntimeMaxLineLength) updates["BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINE_LENGTH"] = cfgMindProfileRuntimeMaxLineLength.value.trim();
    if (cfgMindProfileRuntimeMaxChars) updates["BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS"] = cfgMindProfileRuntimeMaxChars.value.trim();
    if (cfgMindProfileRuntimeMinSignalCount) updates["BELLDANDY_MIND_PROFILE_RUNTIME_MIN_SIGNAL_COUNT"] = cfgMindProfileRuntimeMinSignalCount.value.trim();
    if (cfgMemorySummaryEnabled) updates["BELLDANDY_MEMORY_SUMMARY_ENABLED"] = cfgMemorySummaryEnabled.checked ? "true" : "false";
    if (cfgMemorySummaryModel) updates["BELLDANDY_MEMORY_SUMMARY_MODEL"] = cfgMemorySummaryModel.value.trim();
    if (cfgMemorySummaryBaseUrl) updates["BELLDANDY_MEMORY_SUMMARY_BASE_URL"] = cfgMemorySummaryBaseUrl.value.trim();
    if (cfgMemoryEvolutionEnabled) updates["BELLDANDY_MEMORY_EVOLUTION_ENABLED"] = cfgMemoryEvolutionEnabled.checked ? "true" : "false";
    if (cfgMemoryEvolutionMinMessages) updates["BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES"] = cfgMemoryEvolutionMinMessages.value.trim();
    if (cfgMemoryEvolutionModel) updates["BELLDANDY_MEMORY_EVOLUTION_MODEL"] = cfgMemoryEvolutionModel.value.trim();
    if (cfgMemoryEvolutionBaseUrl) updates["BELLDANDY_MEMORY_EVOLUTION_BASE_URL"] = cfgMemoryEvolutionBaseUrl.value.trim();
    if (cfgMemorySessionDigestMaxRuns) updates["BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS"] = cfgMemorySessionDigestMaxRuns.value.trim();
    if (cfgMemorySessionDigestWindowMs) updates["BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS"] = cfgMemorySessionDigestWindowMs.value.trim();
    if (cfgMemoryDurableExtractionMaxRuns) updates["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS"] = cfgMemoryDurableExtractionMaxRuns.value.trim();
    if (cfgMemoryDurableExtractionWindowMs) updates["BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS"] = cfgMemoryDurableExtractionWindowMs.value.trim();
    if (cfgMemoryDurableExtractionMinPendingMessages) updates["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_PENDING_MESSAGES"] = cfgMemoryDurableExtractionMinPendingMessages.value.trim();
    if (cfgMemoryDurableExtractionMinMessageDelta) updates["BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_MESSAGE_DELTA"] = cfgMemoryDurableExtractionMinMessageDelta.value.trim();
    if (cfgMemoryDurableExtractionSuccessCooldownMs) updates["BELLDANDY_MEMORY_DURABLE_EXTRACTION_SUCCESS_COOLDOWN_MS"] = cfgMemoryDurableExtractionSuccessCooldownMs.value.trim();
    if (cfgMemoryDurableExtractionFailureBackoffMs) updates["BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MS"] = cfgMemoryDurableExtractionFailureBackoffMs.value.trim();
    if (cfgMemoryDurableExtractionFailureBackoffMaxMs) updates["BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MAX_MS"] = cfgMemoryDurableExtractionFailureBackoffMaxMs.value.trim();
    if (cfgTeamSharedMemoryEnabled) updates["BELLDANDY_TEAM_SHARED_MEMORY_ENABLED"] = cfgTeamSharedMemoryEnabled.checked ? "true" : "false";
    if (cfgSharedReviewClaimTimeoutMs) updates["BELLDANDY_SHARED_REVIEW_CLAIM_TIMEOUT_MS"] = cfgSharedReviewClaimTimeoutMs.value.trim();
    if (cfgTaskMemoryEnabled) updates["BELLDANDY_TASK_MEMORY_ENABLED"] = cfgTaskMemoryEnabled.checked ? "true" : "false";
    if (cfgTaskStatsWhenMemoryDisabled) updates["BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED"] = cfgTaskStatsWhenMemoryDisabled.checked ? "true" : "false";
    if (cfgTaskSummaryEnabled) updates["BELLDANDY_TASK_SUMMARY_ENABLED"] = cfgTaskSummaryEnabled.checked ? "true" : "false";
    if (cfgTaskSummaryModel) updates["BELLDANDY_TASK_SUMMARY_MODEL"] = cfgTaskSummaryModel.value.trim();
    if (cfgTaskSummaryBaseUrl) updates["BELLDANDY_TASK_SUMMARY_BASE_URL"] = cfgTaskSummaryBaseUrl.value.trim();
    if (cfgTaskSummaryMinDurationMs) updates["BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS"] = cfgTaskSummaryMinDurationMs.value.trim();
    if (cfgTaskSummaryMinToolCalls) updates["BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS"] = cfgTaskSummaryMinToolCalls.value.trim();
    if (cfgTaskSummaryMinTokenTotal) updates["BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL"] = cfgTaskSummaryMinTokenTotal.value.trim();
    if (cfgExperienceAutoPromotionEnabled) updates["BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED"] = cfgExperienceAutoPromotionEnabled.checked ? "true" : "false";
    if (cfgExperienceAutoMethodEnabled) updates["BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED"] = cfgExperienceAutoMethodEnabled.checked ? "true" : "false";
    if (cfgExperienceAutoSkillEnabled) updates["BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED"] = cfgExperienceAutoSkillEnabled.checked ? "true" : "false";
    if (cfgMethodGenerationConfirmRequired) updates["BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED"] = cfgMethodGenerationConfirmRequired.checked ? "true" : "false";
    if (cfgSkillGenerationConfirmRequired) updates["BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED"] = cfgSkillGenerationConfirmRequired.checked ? "true" : "false";
    if (cfgMethodPublishConfirmRequired) updates["BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED"] = cfgMethodPublishConfirmRequired.checked ? "true" : "false";
    if (cfgSkillPublishConfirmRequired) updates["BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED"] = cfgSkillPublishConfirmRequired.checked ? "true" : "false";
    if (cfgExperienceSynthesisMaxSimilarSources) updates["BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES"] = cfgExperienceSynthesisMaxSimilarSources.value.trim();
    if (cfgExperienceSynthesisMaxSourceContentChars) updates["BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS"] = cfgExperienceSynthesisMaxSourceContentChars.value.trim();
    if (cfgExperienceSynthesisTotalSourceContentCharBudget) updates["BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET"] = cfgExperienceSynthesisTotalSourceContentCharBudget.value.trim();
    if (cfgMemoryDeepRetrievalEnabled) updates["BELLDANDY_MEMORY_DEEP_RETRIEVAL"] = cfgMemoryDeepRetrievalEnabled.checked ? "true" : "false";
    if (cfgMemoryNodeAssistedRetrievalEnabled) updates["BELLDANDY_MEMORY_NODE_ASSISTED_RETRIEVAL"] = cfgMemoryNodeAssistedRetrievalEnabled.checked ? "true" : "false";
    if (cfgEmbeddingQueryPrefix) updates["BELLDANDY_EMBEDDING_QUERY_PREFIX"] = cfgEmbeddingQueryPrefix.value.trim();
    if (cfgEmbeddingPassagePrefix) updates["BELLDANDY_EMBEDDING_PASSAGE_PREFIX"] = cfgEmbeddingPassagePrefix.value.trim();
    if (cfgRerankerMinScore) updates["BELLDANDY_RERANKER_MIN_SCORE"] = cfgRerankerMinScore.value.trim();
    if (cfgRerankerLengthNormAnchor) updates["BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR"] = cfgRerankerLengthNormAnchor.value.trim();
    if (cfgMemoryIndexerVerboseWatch) updates["BELLDANDY_MEMORY_INDEXER_VERBOSE_WATCH"] = cfgMemoryIndexerVerboseWatch.checked ? "true" : "false";
    if (cfgTaskDedupGuardEnabled) updates["BELLDANDY_TASK_DEDUP_GUARD_ENABLED"] = cfgTaskDedupGuardEnabled.checked ? "true" : "false";
    if (cfgTaskDedupWindowMinutes) updates["BELLDANDY_TASK_DEDUP_WINDOW_MINUTES"] = cfgTaskDedupWindowMinutes.value.trim();
    if (cfgTaskDedupMode) updates["BELLDANDY_TASK_DEDUP_MODE"] = cfgTaskDedupMode.value.trim();
    if (cfgTaskDedupPolicy) updates["BELLDANDY_TASK_DEDUP_POLICY"] = cfgTaskDedupPolicy.value.trim();
    if (cfgToolsEnabled) updates["BELLDANDY_TOOLS_ENABLED"] = cfgToolsEnabled.checked ? "true" : "false";
    if (cfgAgentToolControlMode) updates["BELLDANDY_AGENT_TOOL_CONTROL_MODE"] = cfgAgentToolControlMode.value.trim() || "disabled";
    assignSecretUpdate(updates, "BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD", cfgAgentToolControlConfirmPassword);
    if (cfgTtsEnabled) updates["BELLDANDY_TTS_ENABLED"] = cfgTtsEnabled.checked ? "true" : "false";
    if (cfgTtsProvider) updates["BELLDANDY_TTS_PROVIDER"] = cfgTtsProvider.value.trim() || "edge";
    if (cfgTtsVoice) updates["BELLDANDY_TTS_VOICE"] = cfgTtsVoice.value.trim();
    if (cfgTtsModel) updates["BELLDANDY_TTS_MODEL"] = cfgTtsModel.value.trim();
    if (cfgTtsOpenAIBaseUrl) updates["BELLDANDY_TTS_OPENAI_BASE_URL"] = cfgTtsOpenAIBaseUrl.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_TTS_OPENAI_API_KEY", cfgTtsOpenAIApiKey);
    if (cfgImageEnabled) updates["BELLDANDY_IMAGE_ENABLED"] = cfgImageEnabled.checked ? "true" : "false";
    if (cfgImageProvider) updates["BELLDANDY_IMAGE_PROVIDER"] = cfgImageProvider.value.trim() || "openai";
    if (cfgImageBaseUrl) updates["BELLDANDY_IMAGE_OPENAI_BASE_URL"] = cfgImageBaseUrl.value.trim();
    if (cfgImageModel) updates["BELLDANDY_IMAGE_MODEL"] = cfgImageModel.value.trim();
    if (cfgImageOutputFormat) updates["BELLDANDY_IMAGE_OUTPUT_FORMAT"] = cfgImageOutputFormat.value.trim();
    if (cfgImageTimeoutMs) updates["BELLDANDY_IMAGE_TIMEOUT_MS"] = cfgImageTimeoutMs.value.trim();
    if (cfgImageUnderstandEnabled) updates["BELLDANDY_IMAGE_UNDERSTAND_ENABLED"] = cfgImageUnderstandEnabled.checked ? "true" : "false";
    if (cfgImageUnderstandProvider) updates["BELLDANDY_IMAGE_UNDERSTAND_PROVIDER"] = cfgImageUnderstandProvider.value.trim() || "openai";
    if (cfgImageUnderstandBaseUrl) updates["BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL"] = cfgImageUnderstandBaseUrl.value.trim();
    if (cfgImageUnderstandModel) updates["BELLDANDY_IMAGE_UNDERSTAND_MODEL"] = cfgImageUnderstandModel.value.trim();
    if (cfgImageUnderstandTimeoutMs) updates["BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS"] = cfgImageUnderstandTimeoutMs.value.trim();
    if (cfgImageUnderstandMaxInputMb) updates["BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB"] = cfgImageUnderstandMaxInputMb.value.trim();
    if (cfgImageUnderstandPrompt) updates["BELLDANDY_IMAGE_UNDERSTAND_PROMPT"] = cfgImageUnderstandPrompt.value.trim();
    if (cfgImageUnderstandAutoOnAttachment) updates["BELLDANDY_IMAGE_UNDERSTAND_AUTO_ON_ATTACHMENT"] = cfgImageUnderstandAutoOnAttachment.checked ? "true" : "false";
    if (cfgBrowserScreenshotAutoUnderstand) updates["BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND"] = cfgBrowserScreenshotAutoUnderstand.checked ? "true" : "false";
    if (cfgCameraSnapAutoUnderstand) updates["BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND"] = cfgCameraSnapAutoUnderstand.checked ? "true" : "false";
    if (cfgScreenCaptureAutoUnderstand) updates["BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND"] = cfgScreenCaptureAutoUnderstand.checked ? "true" : "false";
    if (cfgVideoUnderstandEnabled) updates["BELLDANDY_VIDEO_UNDERSTAND_ENABLED"] = cfgVideoUnderstandEnabled.checked ? "true" : "false";
    if (cfgVideoUnderstandProvider) updates["BELLDANDY_VIDEO_UNDERSTAND_PROVIDER"] = cfgVideoUnderstandProvider.value.trim() || "openai";
    if (cfgVideoUnderstandBaseUrl) updates["BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL"] = cfgVideoUnderstandBaseUrl.value.trim();
    if (cfgVideoUnderstandModel) updates["BELLDANDY_VIDEO_UNDERSTAND_MODEL"] = cfgVideoUnderstandModel.value.trim();
    if (cfgVideoUnderstandTimeoutMs) updates["BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS"] = cfgVideoUnderstandTimeoutMs.value.trim();
    if (cfgVideoUnderstandTransport) updates["BELLDANDY_VIDEO_UNDERSTAND_TRANSPORT"] = cfgVideoUnderstandTransport.value.trim() || "auto";
    if (cfgVideoUnderstandFps) updates["BELLDANDY_VIDEO_UNDERSTAND_FPS"] = cfgVideoUnderstandFps.value.trim();
    if (cfgVideoUnderstandMaxInputMb) updates["BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB"] = cfgVideoUnderstandMaxInputMb.value.trim();
    if (cfgVideoUnderstandPrompt) updates["BELLDANDY_VIDEO_UNDERSTAND_PROMPT"] = cfgVideoUnderstandPrompt.value.trim();
    if (cfgVideoUnderstandAutoOnAttachment) updates["BELLDANDY_VIDEO_UNDERSTAND_AUTO_ON_ATTACHMENT"] = cfgVideoUnderstandAutoOnAttachment.checked ? "true" : "false";
    if (cfgVideoUnderstandAutoAttachmentMaxTimelineItems) updates["BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS"] = cfgVideoUnderstandAutoAttachmentMaxTimelineItems.value.trim();
    if (cfgVideoUnderstandAutoAttachmentSummaryCharLimit) updates["BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT"] = cfgVideoUnderstandAutoAttachmentSummaryCharLimit.value.trim();
    if (cfgSttProvider) updates["BELLDANDY_STT_PROVIDER"] = cfgSttProvider.value.trim();
    if (cfgSttModel) updates["BELLDANDY_STT_MODEL"] = cfgSttModel.value.trim();
    if (cfgSttOpenAiBaseUrl) updates["BELLDANDY_STT_OPENAI_BASE_URL"] = cfgSttOpenAiBaseUrl.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_STT_OPENAI_API_KEY", cfgSttOpenAiApiKey);
    if (cfgSttLanguage) updates["BELLDANDY_STT_LANGUAGE"] = cfgSttLanguage.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_STT_GROQ_API_KEY", cfgSttGroqApiKey);
    if (cfgSttGroqBaseUrl) updates["BELLDANDY_STT_GROQ_BASE_URL"] = cfgSttGroqBaseUrl.value.trim();
    if (cfgQqSttFallbackProviders) updates["BELLDANDY_QQ_STT_FALLBACK_PROVIDERS"] = cfgQqSttFallbackProviders.value.trim();
    if (cfgCameraNativeHelperCommand) updates["BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND"] = cfgCameraNativeHelperCommand.value.trim();
    if (cfgCameraNativeHelperArgsJson) updates["BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON"] = cfgCameraNativeHelperArgsJson.value.trim();
    if (cfgCameraNativeHelperCwd) updates["BELLDANDY_CAMERA_NATIVE_HELPER_CWD"] = cfgCameraNativeHelperCwd.value.trim();
    if (cfgCameraNativeHelperStartupTimeoutMs) updates["BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS"] = cfgCameraNativeHelperStartupTimeoutMs.value.trim();
    if (cfgCameraNativeHelperRequestTimeoutMs) updates["BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS"] = cfgCameraNativeHelperRequestTimeoutMs.value.trim();
    if (cfgCameraNativeHelperIdleShutdownMs) updates["BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS"] = cfgCameraNativeHelperIdleShutdownMs.value.trim();
    if (cfgCameraNativeHelperEnvJson) updates["BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON"] = cfgCameraNativeHelperEnvJson.value.trim();
    if (cfgCameraNativeHelperPowershellCommand) updates["BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_COMMAND"] = cfgCameraNativeHelperPowershellCommand.value.trim();
    if (cfgCameraNativeHelperPowershellArgsJson) updates["BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_ARGS_JSON"] = cfgCameraNativeHelperPowershellArgsJson.value.trim();
    if (cfgCameraNativeHelperFfmpegCommand) updates["BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND"] = cfgCameraNativeHelperFfmpegCommand.value.trim();
    if (cfgCameraNativeHelperFfmpegArgsJson) updates["BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON"] = cfgCameraNativeHelperFfmpegArgsJson.value.trim();
    assignSecretUpdates(updates, aliyunApiKeyTargets, cfgDashScopeApiKey);
    assignSecretOverrideUpdate(updates, "BELLDANDY_EMBEDDING_OPENAI_API_KEY", cfgEmbeddingApiKey);
    assignSecretOverrideUpdate(updates, "BELLDANDY_COMPACTION_API_KEY", cfgCompactionApiKey);
    assignSecretOverrideUpdate(updates, "BELLDANDY_MEMORY_SUMMARY_API_KEY", cfgMemorySummaryApiKey);
    assignSecretOverrideUpdate(updates, "BELLDANDY_MEMORY_EVOLUTION_API_KEY", cfgMemoryEvolutionApiKey);
    assignSecretOverrideUpdate(updates, "BELLDANDY_TASK_SUMMARY_API_KEY", cfgTaskSummaryApiKey);
    assignSecretUpdate(updates, "BELLDANDY_IMAGE_OPENAI_API_KEY", cfgImageApiKey);
    assignSecretOverrideUpdate(updates, "BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY", cfgImageUnderstandApiKey);
    assignSecretOverrideUpdate(updates, "BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY", cfgVideoUnderstandApiKey);
    updates["BELLDANDY_FACET_ANCHOR"] = cfgFacetAnchor.value.trim();
    updates["BELLDANDY_INJECT_AGENTS"] = cfgInjectAgents.checked ? "true" : "false";
    updates["BELLDANDY_INJECT_SOUL"] = cfgInjectSoul.checked ? "true" : "false";
    updates["BELLDANDY_INJECT_MEMORY"] = cfgInjectMemory.checked ? "true" : "false";
    if (cfgInjectMethodSkillList) updates["BELLDANDY_INJECT_METHOD_SKILL_LIST"] = cfgInjectMethodSkillList.checked ? "true" : "false";
    if (cfgPromptFocusEnabled) updates["BELLDANDY_PROMPT_FOCUS_ENABLED"] = cfgPromptFocusEnabled.checked ? "true" : "false";
    if (cfgPromptFocusSemanticEnabled) updates["BELLDANDY_PROMPT_FOCUS_SEMANTIC_ENABLED"] = cfgPromptFocusSemanticEnabled.checked ? "true" : "false";
    if (cfgPromptFocusSemanticMinScore) updates["BELLDANDY_PROMPT_FOCUS_SEMANTIC_MIN_SCORE"] = cfgPromptFocusSemanticMinScore.value.trim();
    updates["BELLDANDY_MAX_SYSTEM_PROMPT_CHARS"] = cfgMaxSystemPromptChars.value.trim();
    updates["BELLDANDY_MAX_HISTORY"] = cfgMaxHistory.value.trim();
    updates["BELLDANDY_CONVERSATION_ALLOWED_KINDS"] = serializeConversationAllowedKinds();
    if (cfgPromptExperimentDisableSections) updates["BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS"] = cfgPromptExperimentDisableSections.value.trim();
    if (cfgPromptExperimentSectionPriorityOverrides) updates["BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES"] = cfgPromptExperimentSectionPriorityOverrides.value.trim();
    if (cfgPromptExperimentDisableToolContracts) updates["BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS"] = cfgPromptExperimentDisableToolContracts.value.trim();
    if (cfgPromptSnapshotMaxRuns) updates["BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS"] = cfgPromptSnapshotMaxRuns.value.trim();
    if (cfgPromptSnapshotMaxPersistedRuns) updates["BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS"] = cfgPromptSnapshotMaxPersistedRuns.value.trim();
    if (cfgPromptSnapshotEmailThreadMaxRuns) updates["BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS"] = cfgPromptSnapshotEmailThreadMaxRuns.value.trim();
    if (cfgPromptSnapshotHeartbeatMaxRuns) updates["BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS"] = cfgPromptSnapshotHeartbeatMaxRuns.value.trim();
    if (cfgPromptSnapshotRetentionDays) updates["BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS"] = cfgPromptSnapshotRetentionDays.value.trim();
    if (cfgCompactionEnabled) updates["BELLDANDY_COMPACTION_ENABLED"] = cfgCompactionEnabled.checked ? "true" : "false";
    if (cfgCompactionThreshold) updates["BELLDANDY_COMPACTION_THRESHOLD"] = cfgCompactionThreshold.value.trim();
    if (cfgCompactionKeepRecent) updates["BELLDANDY_COMPACTION_KEEP_RECENT"] = cfgCompactionKeepRecent.value.trim();
    if (cfgCompactionTriggerFraction) updates["BELLDANDY_COMPACTION_TRIGGER_FRACTION"] = cfgCompactionTriggerFraction.value.trim();
    if (cfgCompactionArchivalThreshold) updates["BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD"] = cfgCompactionArchivalThreshold.value.trim();
    if (cfgCompactionWarningThreshold) updates["BELLDANDY_COMPACTION_WARNING_THRESHOLD"] = cfgCompactionWarningThreshold.value.trim();
    if (cfgCompactionBlockingThreshold) updates["BELLDANDY_COMPACTION_BLOCKING_THRESHOLD"] = cfgCompactionBlockingThreshold.value.trim();
    if (cfgCompactionMaxConsecutiveFailures) updates["BELLDANDY_COMPACTION_MAX_CONSECUTIVE_FAILURES"] = cfgCompactionMaxConsecutiveFailures.value.trim();
    if (cfgCompactionMaxPtlRetries) updates["BELLDANDY_COMPACTION_MAX_PTL_RETRIES"] = cfgCompactionMaxPtlRetries.value.trim();
    if (cfgCompactionContextWindowFraction) updates["BELLDANDY_COMPACTION_CONTEXT_WINDOW_FRACTION"] = cfgCompactionContextWindowFraction.value.trim();
    if (cfgModelContextWindow) updates["BELLDANDY_MODEL_CONTEXT_WINDOW"] = cfgModelContextWindow.value.trim();
    if (cfgCompressionReferenceStore) updates["BELLDANDY_COMPRESSION_REFERENCE_STORE"] = cfgCompressionReferenceStore.checked ? "true" : "false";
    if (cfgPreflightCompressionEnabled) updates["BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED"] = cfgPreflightCompressionEnabled.checked ? "true" : "false";
    if (cfgPreflightCompressionMode) updates["BELLDANDY_PREFLIGHT_COMPRESSION_MODE"] = cfgPreflightCompressionMode.value.trim() || "attachments";
    if (cfgPreflightAttachmentThresholdChars) updates["BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS"] = cfgPreflightAttachmentThresholdChars.value.trim();
    if (cfgPreflightTargetRatio) updates["BELLDANDY_PREFLIGHT_TARGET_RATIO"] = cfgPreflightTargetRatio.value.trim();
    if (cfgPreflightMinSavingsRatio) updates["BELLDANDY_PREFLIGHT_MIN_SAVINGS_RATIO"] = cfgPreflightMinSavingsRatio.value.trim();
    if (cfgPreflightTimeoutMs) updates["BELLDANDY_PREFLIGHT_TIMEOUT_MS"] = cfgPreflightTimeoutMs.value.trim();
    if (cfgPreflightAttachmentReference) updates["BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE"] = cfgPreflightAttachmentReference.value.trim() || "none";
    if (cfgPreflightSidecarRetentionMs) updates["BELLDANDY_PREFLIGHT_SIDECAR_RETENTION_MS"] = cfgPreflightSidecarRetentionMs.value.trim();
    if (cfgPreflightSidecarMaxEntries) updates["BELLDANDY_PREFLIGHT_SIDECAR_MAX_ENTRIES"] = cfgPreflightSidecarMaxEntries.value.trim();
    if (cfgCompressionPersistentReferenceStore) updates["BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_STORE"] = cfgCompressionPersistentReferenceStore.checked ? "true" : "false";
    if (cfgCompressionPersistentReferenceTtlMs) updates["BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_TTL_MS"] = cfgCompressionPersistentReferenceTtlMs.value.trim();
    if (cfgCompressionPersistentReferenceMaxEntries) updates["BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_MAX_ENTRIES"] = cfgCompressionPersistentReferenceMaxEntries.value.trim();
    if (cfgBudgetProtectMode) updates["BELLDANDY_BUDGET_PROTECT_MODE"] = cfgBudgetProtectMode.value.trim() || "protect_memory_capability";
    if (cfgBudgetProtectKeepRecentRounds) updates["BELLDANDY_BUDGET_PROTECT_KEEP_RECENT_ROUNDS"] = cfgBudgetProtectKeepRecentRounds.value.trim();
    if (cfgStablePrefixSplit) updates["BELLDANDY_STABLE_PREFIX_SPLIT"] = cfgStablePrefixSplit.checked ? "true" : "false";
    if (cfgCompactionModelRoute) updates["BELLDANDY_COMPACTION_MODEL_ROUTE"] = cfgCompactionModelRoute.value.trim();
    if (cfgDeepseekRoutePolicyEnabled) updates["BELLDANDY_DEEPSEEK_ROUTE_POLICY_ENABLED"] = cfgDeepseekRoutePolicyEnabled.checked ? "true" : "false";
    if (cfgCompactionModel) updates["BELLDANDY_COMPACTION_MODEL"] = cfgCompactionModel.value.trim();
    if (cfgCompactionBaseUrl) updates["BELLDANDY_COMPACTION_BASE_URL"] = cfgCompactionBaseUrl.value.trim();
    if (cfgCommunityApiEnabled) updates["BELLDANDY_COMMUNITY_API_ENABLED"] = cfgCommunityApiEnabled.checked ? "true" : "false";
    assignSecretUpdate(updates, "BELLDANDY_COMMUNITY_API_TOKEN", cfgCommunityApiToken);
    if (cfgEmailOutboundRequireConfirmation) updates["BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION"] = cfgEmailOutboundRequireConfirmation.checked ? "true" : "false";
    if (cfgEmailDefaultProvider) updates["BELLDANDY_EMAIL_DEFAULT_PROVIDER"] = cfgEmailDefaultProvider.value.trim();
    if (cfgEmailSmtpEnabled) updates["BELLDANDY_EMAIL_SMTP_ENABLED"] = cfgEmailSmtpEnabled.checked ? "true" : "false";
    if (cfgEmailImapEnabled) updates["BELLDANDY_EMAIL_IMAP_ENABLED"] = cfgEmailImapEnabled.checked ? "true" : "false";
    if (cfgEmailSmtpAccountId) updates["BELLDANDY_EMAIL_SMTP_ACCOUNT_ID"] = cfgEmailSmtpAccountId.value.trim();
    if (cfgEmailSmtpHost) updates["BELLDANDY_EMAIL_SMTP_HOST"] = cfgEmailSmtpHost.value.trim();
    if (cfgEmailSmtpPort) updates["BELLDANDY_EMAIL_SMTP_PORT"] = cfgEmailSmtpPort.value.trim();
    if (cfgEmailSmtpSecure) updates["BELLDANDY_EMAIL_SMTP_SECURE"] = cfgEmailSmtpSecure.checked ? "true" : "false";
    if (cfgEmailSmtpUser) updates["BELLDANDY_EMAIL_SMTP_USER"] = cfgEmailSmtpUser.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_EMAIL_SMTP_PASS", cfgEmailSmtpPass);
    if (cfgEmailSmtpFromAddress) updates["BELLDANDY_EMAIL_SMTP_FROM_ADDRESS"] = cfgEmailSmtpFromAddress.value.trim();
    if (cfgEmailSmtpFromName) updates["BELLDANDY_EMAIL_SMTP_FROM_NAME"] = cfgEmailSmtpFromName.value.trim();
    if (cfgEmailInboundAgentId) updates["BELLDANDY_EMAIL_INBOUND_AGENT_ID"] = cfgEmailInboundAgentId.value.trim();
    if (cfgEmailImapAccountId) updates["BELLDANDY_EMAIL_IMAP_ACCOUNT_ID"] = cfgEmailImapAccountId.value.trim();
    if (cfgEmailImapHost) updates["BELLDANDY_EMAIL_IMAP_HOST"] = cfgEmailImapHost.value.trim();
    if (cfgEmailImapPort) updates["BELLDANDY_EMAIL_IMAP_PORT"] = cfgEmailImapPort.value.trim();
    if (cfgEmailImapSecure) updates["BELLDANDY_EMAIL_IMAP_SECURE"] = cfgEmailImapSecure.checked ? "true" : "false";
    if (cfgEmailImapUser) updates["BELLDANDY_EMAIL_IMAP_USER"] = cfgEmailImapUser.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_EMAIL_IMAP_PASS", cfgEmailImapPass);
    if (cfgEmailImapMailbox) updates["BELLDANDY_EMAIL_IMAP_MAILBOX"] = cfgEmailImapMailbox.value.trim();
    if (cfgEmailImapPollIntervalMs) updates["BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS"] = cfgEmailImapPollIntervalMs.value.trim();
    if (cfgEmailImapConnectTimeoutMs) updates["BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS"] = cfgEmailImapConnectTimeoutMs.value.trim();
    if (cfgEmailImapSocketTimeoutMs) updates["BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS"] = cfgEmailImapSocketTimeoutMs.value.trim();
    if (cfgEmailImapBootstrapMode) updates["BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE"] = cfgEmailImapBootstrapMode.value.trim();
    if (cfgEmailImapRecentWindowLimit) updates["BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT"] = cfgEmailImapRecentWindowLimit.value.trim();
    if (cfgChannelRouterEnabled) updates["BELLDANDY_CHANNEL_ROUTER_ENABLED"] = cfgChannelRouterEnabled.checked ? "true" : "false";
    if (cfgChannelRouterConfigPath) updates["BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH"] = cfgChannelRouterConfigPath.value.trim();
    if (cfgChannelRouterDefaultAgentId) updates["BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID"] = cfgChannelRouterDefaultAgentId.value.trim();
    if (cfgChannelIngressMaxConcurrent) updates["BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT"] = cfgChannelIngressMaxConcurrent.value.trim();
    if (cfgChannelIngressMaxConcurrentPerChannel) updates["BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT_PER_CHANNEL"] = cfgChannelIngressMaxConcurrentPerChannel.value.trim();
    if (cfgChannelIngressMaxPendingPerSession) updates["BELLDANDY_CHANNEL_INGRESS_MAX_PENDING_PER_SESSION"] = cfgChannelIngressMaxPendingPerSession.value.trim();
    if (cfgChannelIngressMaxQueued) updates["BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED"] = cfgChannelIngressMaxQueued.value.trim();
    if (cfgChannelIngressMaxWaitMs) updates["BELLDANDY_CHANNEL_INGRESS_MAX_WAIT_MS"] = cfgChannelIngressMaxWaitMs.value.trim();
    if (cfgChannelIngressMaxPayloadBytes) updates["BELLDANDY_CHANNEL_INGRESS_MAX_PAYLOAD_BYTES"] = cfgChannelIngressMaxPayloadBytes.value.trim();
    if (cfgChannelIngressMaxQueuedPayloadBytes) updates["BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED_PAYLOAD_BYTES"] = cfgChannelIngressMaxQueuedPayloadBytes.value.trim();
    if (cfgFeishuAppId) updates["BELLDANDY_FEISHU_APP_ID"] = cfgFeishuAppId.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_FEISHU_APP_SECRET", cfgFeishuAppSecret);
    if (cfgFeishuAgentId) updates["BELLDANDY_FEISHU_AGENT_ID"] = cfgFeishuAgentId.value.trim();
    if (cfgQqAppId) updates["BELLDANDY_QQ_APP_ID"] = cfgQqAppId.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_QQ_APP_SECRET", cfgQqAppSecret);
    if (cfgQqAgentId) updates["BELLDANDY_QQ_AGENT_ID"] = cfgQqAgentId.value.trim();
    if (cfgQqSandbox) updates["BELLDANDY_QQ_SANDBOX"] = cfgQqSandbox.checked ? "true" : "false";
    if (cfgQqEventSampleCaptureEnabled) updates["BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED"] = cfgQqEventSampleCaptureEnabled.checked ? "true" : "false";
    if (cfgQqEventSampleCaptureDir) updates["BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR"] = cfgQqEventSampleCaptureDir.value.trim();
    if (cfgDiscordEnabled) updates["BELLDANDY_DISCORD_ENABLED"] = cfgDiscordEnabled.checked ? "true" : "false";
    assignSecretUpdate(updates, "BELLDANDY_DISCORD_BOT_TOKEN", cfgDiscordBotToken);
    if (cfgDiscordDefaultChannelId) updates["BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID"] = cfgDiscordDefaultChannelId.value.trim();
    if (cfgWebhookPreauthMaxBytes) updates["BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES"] = cfgWebhookPreauthMaxBytes.value.trim();
    if (cfgWebhookPreauthTimeoutMs) updates["BELLDANDY_WEBHOOK_PREAUTH_TIMEOUT_MS"] = cfgWebhookPreauthTimeoutMs.value.trim();
    if (cfgWebhookRateLimitWindowMs) updates["BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS"] = cfgWebhookRateLimitWindowMs.value.trim();
    if (cfgWebhookRateLimitMaxRequests) updates["BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS"] = cfgWebhookRateLimitMaxRequests.value.trim();
    if (cfgWebhookRateLimitMaxTrackedKeys) updates["BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_TRACKED_KEYS"] = cfgWebhookRateLimitMaxTrackedKeys.value.trim();
    if (cfgWebhookMaxInFlightPerKey) updates["BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY"] = cfgWebhookMaxInFlightPerKey.value.trim();
    if (cfgWebhookMaxInFlightTrackedKeys) updates["BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_TRACKED_KEYS"] = cfgWebhookMaxInFlightTrackedKeys.value.trim();
    if (cfgTokenUsageUploadEnabled) updates["BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED"] = cfgTokenUsageUploadEnabled.checked ? "true" : "false";
    if (cfgTokenUsageUploadUrl) updates["BELLDANDY_TOKEN_USAGE_UPLOAD_URL"] = cfgTokenUsageUploadUrl.value.trim();
    assignSecretUpdate(updates, "BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY", cfgTokenUsageUploadApiKey);
    if (cfgTokenUsageUploadTimeoutMs) updates["BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS"] = cfgTokenUsageUploadTimeoutMs.value.trim();
    if (cfgTokenUsageStrictUuid) updates["BELLDANDY_TOKEN_USAGE_STRICT_UUID"] = cfgTokenUsageStrictUuid.checked ? "true" : "false";
    if (cfgWebchatCostBudgetUsd) updates["BELLDANDY_WEBCHAT_COST_BUDGET_USD"] = cfgWebchatCostBudgetUsd.value.trim();
    if (cfgWebchatCostBudgetWarnFraction) updates["BELLDANDY_WEBCHAT_COST_BUDGET_WARN_FRACTION"] = cfgWebchatCostBudgetWarnFraction.value.trim();
    if (cfgAutoTaskTimeEnabled) updates["BELLDANDY_AUTO_TASK_TIME_ENABLED"] = cfgAutoTaskTimeEnabled.checked ? "true" : "false";
    if (cfgAutoTaskTokenEnabled) updates["BELLDANDY_AUTO_TASK_TOKEN_ENABLED"] = cfgAutoTaskTokenEnabled.checked ? "true" : "false";
    if (cfgWebhookConfigPath) updates["BELLDANDY_WEBHOOK_CONFIG_PATH"] = cfgWebhookConfigPath.value.trim();
    if (cfgWebhookIdempotencyWindowMs) updates["BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS"] = cfgWebhookIdempotencyWindowMs.value.trim();
    if (cfgStateDir) updates["BELLDANDY_STATE_DIR"] = cfgStateDir.value.trim();
    if (cfgStateDirWindows) updates["BELLDANDY_STATE_DIR_WINDOWS"] = cfgStateDirWindows.value.trim();
    if (cfgStateDirWsl) updates["BELLDANDY_STATE_DIR_WSL"] = cfgStateDirWsl.value.trim();
    if (cfgWorkspaceDir) updates["BELLDANDY_WORKSPACE_DIR"] = cfgWorkspaceDir.value.trim();
    if (cfgExtraWorkspaceRoots) updates["BELLDANDY_EXTRA_WORKSPACE_ROOTS"] = cfgExtraWorkspaceRoots.value.trim();
    if (cfgWebRoot) updates["BELLDANDY_WEB_ROOT"] = cfgWebRoot.value.trim();
    if (cfgGovernanceDetailMode) updates["BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE"] = cfgGovernanceDetailMode.value === "full" ? "full" : "compact";
    if (cfgCommanderMode) updates["BELLDANDY_COMMANDER_MODE"] = cfgCommanderMode.value === "on" ? "on" : cfgCommanderMode.value === "off" ? "off" : "auto";
    if (cfgCommanderAgentId) updates["BELLDANDY_COMMANDER_AGENT_ID"] = cfgCommanderAgentId.value.trim();
    if (cfgGoalExecutionMode) updates["BELLDANDY_GOAL_EXECUTION_MODE"] = cfgGoalExecutionMode.value.trim() || "auto";
    if (cfgGoalGovernanceMode) updates["BELLDANDY_GOAL_GOVERNANCE_MODE"] = cfgGoalGovernanceMode.value.trim() || "auto";
    if (cfgCommanderAutoReworkEnabled) updates["BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED"] = cfgCommanderAutoReworkEnabled.checked ? "true" : "false";
    if (cfgExperienceDraftGenerateNoticeEnabled) {
      updates["BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED"] = cfgExperienceDraftGenerateNoticeEnabled.checked ? "true" : "false";
    }
    if (cfgLogLevel) updates["BELLDANDY_LOG_LEVEL"] = cfgLogLevel.value.trim();
    if (cfgLogConsole) updates["BELLDANDY_LOG_CONSOLE"] = cfgLogConsole.checked ? "true" : "false";
    if (cfgLogFile) updates["BELLDANDY_LOG_FILE"] = cfgLogFile.checked ? "true" : "false";
    if (cfgLogDir) updates["BELLDANDY_LOG_DIR"] = cfgLogDir.value.trim();
    if (cfgLogMaxSize) updates["BELLDANDY_LOG_MAX_SIZE"] = cfgLogMaxSize.value.trim();
    if (cfgLogRetentionDays) updates["BELLDANDY_LOG_RETENTION_DAYS"] = cfgLogRetentionDays.value.trim();
    if (cfgDreamAutoHeartbeatEnabled) updates["BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED"] = cfgDreamAutoHeartbeatEnabled.checked ? "true" : "false";
    if (cfgDreamAutoCronEnabled) updates["BELLDANDY_DREAM_AUTO_CRON_ENABLED"] = cfgDreamAutoCronEnabled.checked ? "true" : "false";
    if (cfgDreamOpenAIThinking) updates["BELLDANDY_DREAM_OPENAI_THINKING"] = cfgDreamOpenAIThinking.value.trim();
    if (cfgDreamOpenAIReasoningEffort) updates["BELLDANDY_DREAM_OPENAI_REASONING_EFFORT"] = cfgDreamOpenAIReasoningEffort.value.trim();
    if (cfgDreamOpenAITimeoutMs) updates["BELLDANDY_DREAM_OPENAI_TIMEOUT_MS"] = cfgDreamOpenAITimeoutMs.value.trim();
    if (cfgDreamOpenAIMaxTokens) updates["BELLDANDY_DREAM_OPENAI_MAX_TOKENS"] = cfgDreamOpenAIMaxTokens.value.trim();
    if (cfgDreamObsidianEnabled) updates["BELLDANDY_DREAM_OBSIDIAN_ENABLED"] = cfgDreamObsidianEnabled.checked ? "true" : "false";
    if (cfgDreamObsidianVaultPath) updates["BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH"] = cfgDreamObsidianVaultPath.value.trim();
    if (cfgDreamObsidianRootDir) updates["BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR"] = cfgDreamObsidianRootDir.value.trim();
    if (cfgCommonsObsidianEnabled) updates["BELLDANDY_COMMONS_OBSIDIAN_ENABLED"] = cfgCommonsObsidianEnabled.checked ? "true" : "false";
    if (cfgCommonsObsidianVaultPath) updates["BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH"] = cfgCommonsObsidianVaultPath.value.trim();
    if (cfgCommonsObsidianRootDir) updates["BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR"] = cfgCommonsObsidianRootDir.value.trim();
    if (cfgRoomInjectThreshold) updates["BELLDANDY_ROOM_INJECT_THRESHOLD"] = cfgRoomInjectThreshold.value.trim();
    if (cfgRoomMembersCacheTtl) updates["BELLDANDY_ROOM_MEMBERS_CACHE_TTL"] = cfgRoomMembersCacheTtl.value.trim();

    if (!cfgAgentProvider && mainApiKey && mainApiKey !== redactedPlaceholder) {
      updates["BELLDANDY_AGENT_PROVIDER"] = "openai";
    }

    const effectiveAuthMode = String(
      updates.BELLDANDY_AUTH_MODE
      ?? lastLoadedConfig?.BELLDANDY_AUTH_MODE
      ?? getConnectionAuthMode?.()
      ?? "none",
    ).trim().toLowerCase();
    if (updates.BELLDANDY_COMMUNITY_API_ENABLED === "true" && effectiveAuthMode === "none") {
      if (saveSettingsBtn) {
        saveSettingsBtn.textContent = t("settings.failed", {}, "Failed");
        saveSettingsBtn.disabled = false;
      }
      alert(t(
        "settings.communityApiRequiresAuth",
        {},
        "Community API cannot be used with AUTH_MODE=none. Switch to token or password first.",
      ));
      return;
    }

    const modelFallbackSave = await saveModelFallbackConfig();
    if (!modelFallbackSave.ok) {
      if (saveSettingsBtn) {
        saveSettingsBtn.textContent = t("settings.failed", {}, "Failed");
        saveSettingsBtn.disabled = false;
      }
      alert(t(
        "settings.modelFallbackConfigSaveFailed",
        { message: modelFallbackSave.message || "Unknown error" },
        "Model fallback config save failed: {message}",
      ));
      return;
    }

    const configuredMemorySourcesSave = await saveConfiguredMemorySources();
    if (!configuredMemorySourcesSave.ok) {
      if (saveSettingsBtn) {
        saveSettingsBtn.textContent = t("settings.failed", {}, "Failed");
        saveSettingsBtn.disabled = false;
      }
      alert(t(
        "settings.memoryConfiguredSourcesSaveFailed",
        { message: configuredMemorySourcesSave.message || "Unknown error" },
        "Configured memory sources save failed: {message}",
      ));
      return;
    }

    const channelSecuritySave = await saveChannelSecurityConfig();
    if (!channelSecuritySave.ok) {
      if (saveSettingsBtn) {
        saveSettingsBtn.textContent = t("settings.failed", {}, "Failed");
        saveSettingsBtn.disabled = false;
      }
      alert(t(
        "settings.channelSecuritySaveFailed",
        { message: channelSecuritySave.message || "Unknown error" },
        "Channel security save failed: {message}",
      ));
      return;
    }

    const channelReplyChunkingSave = await saveChannelReplyChunkingConfig();
    if (!channelReplyChunkingSave.ok) {
      if (saveSettingsBtn) {
        saveSettingsBtn.textContent = t("settings.failed", {}, "Failed");
        saveSettingsBtn.disabled = false;
      }
      alert(t(
        "settings.channelReplyChunkingSaveFailed",
        { message: channelReplyChunkingSave.message || "Unknown error" },
        "Channel reply chunking save failed: {message}",
      ));
      return;
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "config.update",
      params: { updates },
    });
    console.info("[settings] config.update submitted", {
      starweaverActiveNotifyEnabled: updates["BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED"],
      starweaverActiveNotifyPollIntervalMs: updates["BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS"],
    });

    if (res && res.ok) {
      setGovernanceDetailMode(updates["BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE"]);
      setExperienceDraftGenerateNoticeEnabled(updates["BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED"]);
      invalidateServerConfigCache?.();
      await onModelCatalogChanged?.();
      if (saveSettingsBtn) {
        saveSettingsBtn.textContent = t("settings.saved", {}, "Saved");
      }

      const currentFormState = captureSettingsFormState();
      lastLoadedFormState = currentFormState;
      lastLoadedConfig = {
        ...(lastLoadedConfig || {}),
        ...updates,
      };
      await onConfigSaved?.(lastLoadedConfig, res.payload || null);
      if (res.payload?.restartRequired !== true) {
        if (saveSettingsBtn) {
          saveSettingsBtn.disabled = false;
          setTimeout(() => {
            saveSettingsBtn.textContent = t("settings.save", {}, "Save");
          }, 1200);
        }
        return;
      }

      const restartResult = await restartServer({
        confirmRestart: false,
        reason: "settings updated",
        showAlertOnFailure: false,
      });
      if (restartResult.ok) {
        if (saveSettingsBtn) {
          saveSettingsBtn.textContent = t("settings.restartingStatus", {}, "Restarting...");
        }
        return;
      }

      if (saveSettingsBtn) {
        saveSettingsBtn.textContent = t("settings.save", {}, "Save");
        saveSettingsBtn.disabled = false;
      }
      alert(t(
        "settings.configSavedAutoRestartFailed",
        { message: restartResult.message || "Unknown error" },
        "Configuration saved, but automatic restart failed: {message}. Please restart the server manually.",
      ));
      return;
    }

    if (saveSettingsBtn) {
      saveSettingsBtn.textContent = t("settings.failed", {}, "Failed");
      saveSettingsBtn.disabled = false;
    }
    alert(t("settings.saveFailed", { message: res?.error ? res.error.message : "Unknown error" }, "Save failed: {message}"));
  }

  async function restartServer(options = {}) {
    const {
      confirmRestart = true,
      reason = "",
      showAlertOnFailure = true,
    } = options;
    if (confirmRestart && !confirm(t("settings.restartConfirm", {}, "Are you sure you want to restart the server?"))) {
      return { ok: false, cancelled: true };
    }
    if (!isConnected()) {
      return {
        ok: false,
        message: t("settings.notConnectedError", {}, "Error: Not connected to server.\nPlease refresh the page or check if the Gateway is running."),
      };
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "system.restart",
      params: typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {},
    });
    if (res?.ok) {
      setStatus(t("settings.restartingStatus", {}, "Restarting..."));
      return { ok: true };
    }
    const message = res?.error?.message || "Unknown error";
    if (showAlertOnFailure) {
      alert(t("settings.restartFailed", { message }, `Restart failed: ${message}`));
    }
    return { ok: false, message };
  }

  async function openCommunityConfig() {
    if (typeof onOpenCommunityConfig !== "function") return;
    await toggle(false);
    onOpenCommunityConfig();
  }

  return {
    toggle,
    renderPairingPending,
    loadConfig,
    saveConfig,
    markPairingRequired() {
      applyAssistantModeCopy({
        pairingRequired: true,
        settings: readCurrentAssistantModeSettings(),
      });
    },
    openPairingPending(options = {}) {
      return toggle(true, { section: "pairing-pending", skipLoad: options.skipLoad === true });
    },
    openChannels() {
      return toggle(true, { section: "channels" });
    },
    openChannelSecurityPending() {
      return toggle(true, { section: "channel-security-pending" });
    },
    refreshChannelSecurityPending() {
      return loadChannelSecurityPendingList();
    },
  };
}
