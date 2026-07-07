import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./doctor-observability.js", () => ({
  renderDoctorObservabilityCards: vi.fn(),
}));

import { renderDoctorObservabilityCards } from "./doctor-observability.js";
import { createSettingsController } from "./settings.js";

class FakeHTMLElement {}

class FakeButton extends FakeHTMLElement {
  constructor(attrs = {}) {
    super();
    this.attrs = attrs;
    this.disabled = false;
    this.textContent = attrs.textContent || "批准";
  }

  addEventListener() {}

  closest(selector) {
    if (selector === "button[data-pairing-action]") return this;
    return null;
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
}

function createFakeList() {
  const listeners = new Map();
  return {
    innerHTML: "",
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type, event) {
      listeners.get(type)?.(event);
    },
    scrollIntoView: vi.fn(),
  };
}

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, force) {
      if (typeof force === "boolean") {
        if (force) classes.add(name);
        else classes.delete(name);
        return force;
      }
      if (classes.has(name)) {
        classes.delete(name);
        return false;
      }
      classes.add(name);
      return true;
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function createSettingsTabButton(tabId, active = false) {
  const listeners = new Map();
  const attrs = new Map();
  return {
    dataset: { settingsTabTarget: tabId },
    classList: createClassList(active ? ["active"] : []),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type) {
      listeners.get(type)?.({ target: this });
    },
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    getAttribute(name) {
      return attrs.get(name) ?? null;
    },
  };
}

function createSettingsPanel(tabId, active = false) {
  return {
    dataset: { settingsPanel: tabId },
    classList: createClassList(active ? ["active"] : []),
    hidden: !active,
  };
}

function createSettingsTabs() {
  const tabIds = ["model", "memory", "tools", "channels", "system"];
  return {
    buttons: tabIds.map((tabId, index) => createSettingsTabButton(tabId, index === 0)),
    panels: tabIds.map((tabId, index) => createSettingsPanel(tabId, index === 0)),
  };
}

function createFakeModal() {
  const classes = new Set(["hidden"]);
  return {
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
}

function createButton(textContent = "") {
  const listeners = new Map();
  return {
    textContent,
    disabled: false,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type) {
      listeners.get(type)?.({ target: this });
    },
  };
}

function createDomNode() {
  return {
    className: "",
    textContent: "",
    innerHTML: "",
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    classList: createClassList(),
  };
}

function createInput(value = "") {
  const listeners = new Map();
  return {
    value,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type) {
      listeners.get(type)?.({ target: this });
    },
  };
}

function createCheckbox(checked = false) {
  const listeners = new Map();
  return {
    checked,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type) {
      listeners.get(type)?.({ target: this });
    },
  };
}

function createSettingsRefs(overrides = {}) {
  const settingsTabs = overrides.settingsTabs || createSettingsTabs();
  return {
    settingsModal: overrides.settingsModal || createFakeModal(),
    settingsTabButtons: overrides.settingsTabButtons || settingsTabs.buttons,
    settingsTabPanels: overrides.settingsTabPanels || settingsTabs.panels,
    pairingPendingList: overrides.pairingPendingList || createFakeList(),
    channelSecurityPendingList: overrides.channelSecurityPendingList || createFakeList(),
    channelsSettingsSection: overrides.channelsSettingsSection || createFakeList(),
    saveSettingsBtn: overrides.saveSettingsBtn || createButton("保存"),
    cfgHost: overrides.cfgHost || createInput(""),
    cfgPort: overrides.cfgPort || createInput(""),
    cfgGatewayPort: overrides.cfgGatewayPort || createInput(""),
    cfgUpdateCheckEnabled: overrides.cfgUpdateCheckEnabled || createCheckbox(true),
    cfgUpdateCheckTimeoutMs: overrides.cfgUpdateCheckTimeoutMs || createInput(""),
    cfgUpdateCheckApiUrl: overrides.cfgUpdateCheckApiUrl || createInput(""),
    cfgDevRuntimeDistGuard: overrides.cfgDevRuntimeDistGuard || createInput("build"),
    cfgAuthMode: overrides.cfgAuthMode || createInput("none"),
    cfgAuthToken: overrides.cfgAuthToken || createInput(""),
    cfgAuthPassword: overrides.cfgAuthPassword || createInput(""),
    cfgAllowedOrigins: overrides.cfgAllowedOrigins || createInput(""),
    cfgAttachmentMaxFileBytes: overrides.cfgAttachmentMaxFileBytes || createInput(""),
    cfgAttachmentMaxTotalBytes: overrides.cfgAttachmentMaxTotalBytes || createInput(""),
    cfgAttachmentTextCharLimit: overrides.cfgAttachmentTextCharLimit || createInput(""),
    cfgAttachmentTextTotalCharLimit: overrides.cfgAttachmentTextTotalCharLimit || createInput(""),
    cfgAudioTranscriptAppendCharLimit: overrides.cfgAudioTranscriptAppendCharLimit || createInput(""),
    cfgApiKey: overrides.cfgApiKey || createInput(""),
    cfgBaseUrl: overrides.cfgBaseUrl || createInput(""),
    cfgModel: overrides.cfgModel || createInput(""),
    cfgAgentProvider: overrides.cfgAgentProvider || createInput("openai"),
    cfgOpenAiStreamEnabled: overrides.cfgOpenAiStreamEnabled || createCheckbox(true),
    cfgOpenAiWireApi: overrides.cfgOpenAiWireApi || createInput("chat_completions"),
    cfgOpenAiThinking: overrides.cfgOpenAiThinking || createInput(""),
    cfgOpenAiReasoningEffort: overrides.cfgOpenAiReasoningEffort || createInput(""),
    cfgResponsesSanitizeToolSchema: overrides.cfgResponsesSanitizeToolSchema || createCheckbox(false),
    cfgOpenAiMaxRetries: overrides.cfgOpenAiMaxRetries || createInput(""),
    cfgOpenAiRetryBackoffMs: overrides.cfgOpenAiRetryBackoffMs || createInput(""),
    cfgOpenAiProxyUrl: overrides.cfgOpenAiProxyUrl || createInput(""),
    cfgPrimaryWarmupEnabled: overrides.cfgPrimaryWarmupEnabled || createCheckbox(true),
    cfgPrimaryWarmupTimeoutMs: overrides.cfgPrimaryWarmupTimeoutMs || createInput(""),
    cfgPrimaryWarmupCooldownMs: overrides.cfgPrimaryWarmupCooldownMs || createInput(""),
    cfgOpenAiSystemPrompt: overrides.cfgOpenAiSystemPrompt || createInput(""),
    cfgAgentTimeoutMs: overrides.cfgAgentTimeoutMs || createInput(""),
    cfgAgentProtocol: overrides.cfgAgentProtocol || createInput(""),
    cfgVideoFileApiUrl: overrides.cfgVideoFileApiUrl || createInput(""),
    cfgVideoFileApiKey: overrides.cfgVideoFileApiKey || createInput(""),
    cfgModelPreferredProviders: overrides.cfgModelPreferredProviders || createInput(""),
    cfgAssistantModeEnabled: overrides.cfgAssistantModeEnabled || createCheckbox(false),
    cfgAssistantModePreset: overrides.cfgAssistantModePreset || createInput("custom"),
    cfgExternalOutboundRequireConfirmation: overrides.cfgExternalOutboundRequireConfirmation || createCheckbox(false),
    cfgAssistantExternalDeliveryPreference: overrides.cfgAssistantExternalDeliveryPreference || createInput(""),
    cfgHeartbeat: overrides.cfgHeartbeat || createInput(""),
    cfgHeartbeatEnabled: overrides.cfgHeartbeatEnabled || createCheckbox(false),
    cfgHeartbeatActiveHours: overrides.cfgHeartbeatActiveHours || createInput(""),
    cfgStarweaverActiveNotifyEnabled: overrides.cfgStarweaverActiveNotifyEnabled || createCheckbox(false),
    cfgStarweaverActiveNotifyPollIntervalMs: overrides.cfgStarweaverActiveNotifyPollIntervalMs || createInput("5000"),
    cfgBrowserRelayEnabled: overrides.cfgBrowserRelayEnabled || createCheckbox(false),
    cfgRelayPort: overrides.cfgRelayPort || createInput(""),
    cfgMcpEnabled: overrides.cfgMcpEnabled || createCheckbox(false),
    cfgBrowserAllowedDomains: overrides.cfgBrowserAllowedDomains || createInput(""),
    cfgBrowserDeniedDomains: overrides.cfgBrowserDeniedDomains || createInput(""),
    cfgAgentBridgeEnabled: overrides.cfgAgentBridgeEnabled || createCheckbox(false),
    cfgToolGroups: overrides.cfgToolGroups || createInput(""),
    cfgMaxInputTokens: overrides.cfgMaxInputTokens || createInput(""),
    cfgMaxOutputTokens: overrides.cfgMaxOutputTokens || createInput(""),
    cfgToolLoopIterationBudget: overrides.cfgToolLoopIterationBudget || createInput(""),
    cfgToolLoopWarningFraction: overrides.cfgToolLoopWarningFraction || createInput(""),
    cfgWebAllowPrivilegedSafeScope: overrides.cfgWebAllowPrivilegedSafeScope || createCheckbox(false),
    cfgPrivilegedWorkspaceWriteChannels: overrides.cfgPrivilegedWorkspaceWriteChannels || createInput(""),
    cfgDangerousToolsEnabled: overrides.cfgDangerousToolsEnabled || createCheckbox(false),
    cfgToolsPolicyFile: overrides.cfgToolsPolicyFile || createInput(""),
    cfgSubAgentMaxConcurrent: overrides.cfgSubAgentMaxConcurrent || createInput(""),
    cfgSubAgentMaxQueueSize: overrides.cfgSubAgentMaxQueueSize || createInput(""),
    cfgSubAgentTimeoutMs: overrides.cfgSubAgentTimeoutMs || createInput(""),
    cfgSubAgentMaxDepth: overrides.cfgSubAgentMaxDepth || createInput(""),
    cfgWorkflowMaxConcurrent: overrides.cfgWorkflowMaxConcurrent || createInput(""),
    cfgWorkflowMaxQueueSize: overrides.cfgWorkflowMaxQueueSize || createInput(""),
    cfgWorkflowTimeoutMs: overrides.cfgWorkflowTimeoutMs || createInput(""),
    cfgWorkflowAgentTimeoutMs: overrides.cfgWorkflowAgentTimeoutMs || createInput(""),
    cfgWorkflowMaxAgentCalls: overrides.cfgWorkflowMaxAgentCalls || createInput(""),
    cfgWorkflowMaxDepth: overrides.cfgWorkflowMaxDepth || createInput(""),
    cfgMemoryEnabled: overrides.cfgMemoryEnabled || createCheckbox(true),
    refreshMemoryConfiguredSourcesBtn: overrides.refreshMemoryConfiguredSourcesBtn || createButton("刷新来源配置"),
    previewMemoryInventoryBtn: overrides.previewMemoryInventoryBtn || createButton("预览 Inventory"),
    previewMemoryExternalIngestBtn: overrides.previewMemoryExternalIngestBtn || createButton("预览 External Ingest"),
    approveMemoryExternalIngestReportBtn: overrides.approveMemoryExternalIngestReportBtn || createButton("批准 Report"),
    rejectMemoryExternalIngestReportBtn: overrides.rejectMemoryExternalIngestReportBtn || createButton("拒绝 Report"),
    applyMemoryExternalIngestReportBtn: overrides.applyMemoryExternalIngestReportBtn || createButton("执行 Report"),
    memoryConfiguredSourcesMeta: overrides.memoryConfiguredSourcesMeta || createDomNode(),
    memoryConfiguredSourcesActionStatus: overrides.memoryConfiguredSourcesActionStatus || createDomNode(),
    cfgMemoryConfiguredSourceId: overrides.cfgMemoryConfiguredSourceId || createInput(""),
    cfgMemoryConfiguredSourcesContent: overrides.cfgMemoryConfiguredSourcesContent || createInput(""),
    cfgMemoryConfiguredSourcesPreviewContent: overrides.cfgMemoryConfiguredSourcesPreviewContent || createInput(""),
    cfgMemoryConfiguredSourcesActionNote: overrides.cfgMemoryConfiguredSourcesActionNote || createInput(""),
    cfgCronEnabled: overrides.cfgCronEnabled || createCheckbox(false),
    cfgEmbeddingEnabled: overrides.cfgEmbeddingEnabled || createCheckbox(false),
    cfgEmbeddingProvider: overrides.cfgEmbeddingProvider || createInput("openai"),
    cfgEmbeddingApiKey: overrides.cfgEmbeddingApiKey || createInput(""),
    cfgEmbeddingBaseUrl: overrides.cfgEmbeddingBaseUrl || createInput(""),
    cfgEmbeddingModel: overrides.cfgEmbeddingModel || createInput(""),
    cfgLocalEmbeddingModel: overrides.cfgLocalEmbeddingModel || createInput(""),
    cfgEmbeddingBatchSize: overrides.cfgEmbeddingBatchSize || createInput(""),
    cfgContextInjectionEnabled: overrides.cfgContextInjectionEnabled || createCheckbox(true),
    cfgContextInjectionLimit: overrides.cfgContextInjectionLimit || createInput(""),
    cfgContextInjectionIncludeSession: overrides.cfgContextInjectionIncludeSession || createCheckbox(false),
    cfgContextInjectionTaskLimit: overrides.cfgContextInjectionTaskLimit || createInput(""),
    cfgContextInjectionAllowedCategories: overrides.cfgContextInjectionAllowedCategories || createInput(""),
    cfgCarryoverContextEnabled: overrides.cfgCarryoverContextEnabled || createCheckbox(true),
    cfgAutoRecallEnabled: overrides.cfgAutoRecallEnabled || createCheckbox(false),
    cfgAutoRecallLimit: overrides.cfgAutoRecallLimit || createInput(""),
    cfgAutoRecallMinScore: overrides.cfgAutoRecallMinScore || createInput(""),
    cfgToolResultTranscriptCharLimit: overrides.cfgToolResultTranscriptCharLimit || createInput(""),
    cfgMindProfileRuntimeEnabled: overrides.cfgMindProfileRuntimeEnabled || createCheckbox(true),
    cfgMindProfileRuntimeMaxLines: overrides.cfgMindProfileRuntimeMaxLines || createInput(""),
    cfgMindProfileRuntimeMaxLineLength: overrides.cfgMindProfileRuntimeMaxLineLength || createInput(""),
    cfgMindProfileRuntimeMaxChars: overrides.cfgMindProfileRuntimeMaxChars || createInput(""),
    cfgMindProfileRuntimeMinSignalCount: overrides.cfgMindProfileRuntimeMinSignalCount || createInput(""),
    cfgMemorySummaryEnabled: overrides.cfgMemorySummaryEnabled || createCheckbox(false),
    cfgMemorySummaryModel: overrides.cfgMemorySummaryModel || createInput(""),
    cfgMemorySummaryBaseUrl: overrides.cfgMemorySummaryBaseUrl || createInput(""),
    cfgMemorySummaryApiKey: overrides.cfgMemorySummaryApiKey || createInput(""),
    cfgMemoryEvolutionEnabled: overrides.cfgMemoryEvolutionEnabled || createCheckbox(false),
    cfgMemoryEvolutionMinMessages: overrides.cfgMemoryEvolutionMinMessages || createInput(""),
    cfgMemoryEvolutionModel: overrides.cfgMemoryEvolutionModel || createInput(""),
    cfgMemoryEvolutionBaseUrl: overrides.cfgMemoryEvolutionBaseUrl || createInput(""),
    cfgMemoryEvolutionApiKey: overrides.cfgMemoryEvolutionApiKey || createInput(""),
    cfgMemorySessionDigestMaxRuns: overrides.cfgMemorySessionDigestMaxRuns || createInput(""),
    cfgMemorySessionDigestWindowMs: overrides.cfgMemorySessionDigestWindowMs || createInput(""),
    cfgMemoryDurableExtractionMaxRuns: overrides.cfgMemoryDurableExtractionMaxRuns || createInput(""),
    cfgMemoryDurableExtractionWindowMs: overrides.cfgMemoryDurableExtractionWindowMs || createInput(""),
    cfgMemoryDurableExtractionMinPendingMessages: overrides.cfgMemoryDurableExtractionMinPendingMessages || createInput(""),
    cfgMemoryDurableExtractionMinMessageDelta: overrides.cfgMemoryDurableExtractionMinMessageDelta || createInput(""),
    cfgMemoryDurableExtractionSuccessCooldownMs: overrides.cfgMemoryDurableExtractionSuccessCooldownMs || createInput(""),
    cfgMemoryDurableExtractionFailureBackoffMs: overrides.cfgMemoryDurableExtractionFailureBackoffMs || createInput(""),
    cfgMemoryDurableExtractionFailureBackoffMaxMs: overrides.cfgMemoryDurableExtractionFailureBackoffMaxMs || createInput(""),
    cfgTeamSharedMemoryEnabled: overrides.cfgTeamSharedMemoryEnabled || createCheckbox(false),
    cfgSharedReviewClaimTimeoutMs: overrides.cfgSharedReviewClaimTimeoutMs || createInput(""),
    cfgTaskMemoryEnabled: overrides.cfgTaskMemoryEnabled || createCheckbox(false),
    cfgTaskStatsWhenMemoryDisabled: overrides.cfgTaskStatsWhenMemoryDisabled || createCheckbox(false),
    cfgTaskSummaryEnabled: overrides.cfgTaskSummaryEnabled || createCheckbox(false),
    cfgTaskSummaryModel: overrides.cfgTaskSummaryModel || createInput(""),
    cfgTaskSummaryBaseUrl: overrides.cfgTaskSummaryBaseUrl || createInput(""),
    cfgTaskSummaryApiKey: overrides.cfgTaskSummaryApiKey || createInput(""),
    cfgTaskSummaryMinDurationMs: overrides.cfgTaskSummaryMinDurationMs || createInput(""),
    cfgTaskSummaryMinToolCalls: overrides.cfgTaskSummaryMinToolCalls || createInput(""),
    cfgTaskSummaryMinTokenTotal: overrides.cfgTaskSummaryMinTokenTotal || createInput(""),
    cfgExperienceAutoPromotionEnabled: overrides.cfgExperienceAutoPromotionEnabled || createCheckbox(true),
    cfgExperienceAutoMethodEnabled: overrides.cfgExperienceAutoMethodEnabled || createCheckbox(true),
    cfgExperienceAutoSkillEnabled: overrides.cfgExperienceAutoSkillEnabled || createCheckbox(true),
    cfgMethodGenerationConfirmRequired: overrides.cfgMethodGenerationConfirmRequired || createCheckbox(false),
    cfgSkillGenerationConfirmRequired: overrides.cfgSkillGenerationConfirmRequired || createCheckbox(false),
    cfgMethodPublishConfirmRequired: overrides.cfgMethodPublishConfirmRequired || createCheckbox(false),
    cfgSkillPublishConfirmRequired: overrides.cfgSkillPublishConfirmRequired || createCheckbox(false),
    cfgExperienceSynthesisMaxSimilarSources: overrides.cfgExperienceSynthesisMaxSimilarSources || createInput(""),
    cfgExperienceSynthesisMaxSourceContentChars: overrides.cfgExperienceSynthesisMaxSourceContentChars || createInput(""),
    cfgExperienceSynthesisTotalSourceContentCharBudget: overrides.cfgExperienceSynthesisTotalSourceContentCharBudget || createInput(""),
    cfgMemoryDeepRetrievalEnabled: overrides.cfgMemoryDeepRetrievalEnabled || createCheckbox(false),
    cfgMemoryNodeAssistedRetrievalEnabled: overrides.cfgMemoryNodeAssistedRetrievalEnabled || createCheckbox(false),
    cfgEmbeddingQueryPrefix: overrides.cfgEmbeddingQueryPrefix || createInput(""),
    cfgEmbeddingPassagePrefix: overrides.cfgEmbeddingPassagePrefix || createInput(""),
    cfgRerankerMinScore: overrides.cfgRerankerMinScore || createInput(""),
    cfgRerankerLengthNormAnchor: overrides.cfgRerankerLengthNormAnchor || createInput(""),
    cfgMemoryIndexerVerboseWatch: overrides.cfgMemoryIndexerVerboseWatch || createCheckbox(false),
    cfgTaskDedupGuardEnabled: overrides.cfgTaskDedupGuardEnabled || createCheckbox(true),
    cfgTaskDedupWindowMinutes: overrides.cfgTaskDedupWindowMinutes || createInput(""),
    cfgTaskDedupMode: overrides.cfgTaskDedupMode || createInput(""),
    cfgTaskDedupPolicy: overrides.cfgTaskDedupPolicy || createInput(""),
    cfgToolsEnabled: overrides.cfgToolsEnabled || createCheckbox(false),
    cfgAgentToolControlMode: overrides.cfgAgentToolControlMode || createInput("disabled"),
    cfgAgentToolControlConfirmPassword: overrides.cfgAgentToolControlConfirmPassword || createInput(""),
    cfgTtsEnabled: overrides.cfgTtsEnabled || createCheckbox(false),
    cfgTtsProvider: overrides.cfgTtsProvider || createInput("edge"),
    cfgTtsVoice: overrides.cfgTtsVoice || createInput(""),
    cfgTtsOpenAIBaseUrl: overrides.cfgTtsOpenAIBaseUrl || createInput(""),
    cfgTtsOpenAIApiKey: overrides.cfgTtsOpenAIApiKey || createInput(""),
    cfgImageEnabled: overrides.cfgImageEnabled || createCheckbox(true),
    cfgImageProvider: overrides.cfgImageProvider || createInput("openai"),
    cfgImageApiKey: overrides.cfgImageApiKey || createInput(""),
    cfgImageBaseUrl: overrides.cfgImageBaseUrl || createInput(""),
    cfgImageModel: overrides.cfgImageModel || createInput(""),
    cfgImageOutputFormat: overrides.cfgImageOutputFormat || createInput(""),
    cfgImageTimeoutMs: overrides.cfgImageTimeoutMs || createInput(""),
    cfgImageUnderstandEnabled: overrides.cfgImageUnderstandEnabled || createCheckbox(false),
    cfgImageUnderstandApiKey: overrides.cfgImageUnderstandApiKey || createInput(""),
    cfgImageUnderstandProvider: overrides.cfgImageUnderstandProvider || createInput("openai"),
    cfgImageUnderstandBaseUrl: overrides.cfgImageUnderstandBaseUrl || createInput(""),
    cfgImageUnderstandModel: overrides.cfgImageUnderstandModel || createInput(""),
    cfgImageUnderstandTimeoutMs: overrides.cfgImageUnderstandTimeoutMs || createInput(""),
    cfgImageUnderstandMaxInputMb: overrides.cfgImageUnderstandMaxInputMb || createInput(""),
    cfgImageUnderstandPrompt: overrides.cfgImageUnderstandPrompt || createInput(""),
    cfgImageUnderstandAutoOnAttachment: overrides.cfgImageUnderstandAutoOnAttachment || createCheckbox(true),
    cfgBrowserScreenshotAutoUnderstand: overrides.cfgBrowserScreenshotAutoUnderstand || createCheckbox(true),
    cfgCameraSnapAutoUnderstand: overrides.cfgCameraSnapAutoUnderstand || createCheckbox(true),
    cfgScreenCaptureAutoUnderstand: overrides.cfgScreenCaptureAutoUnderstand || createCheckbox(true),
    cfgVideoUnderstandEnabled: overrides.cfgVideoUnderstandEnabled || createCheckbox(false),
    cfgVideoUnderstandApiKey: overrides.cfgVideoUnderstandApiKey || createInput(""),
    cfgVideoUnderstandProvider: overrides.cfgVideoUnderstandProvider || createInput("openai"),
    cfgVideoUnderstandBaseUrl: overrides.cfgVideoUnderstandBaseUrl || createInput(""),
    cfgVideoUnderstandModel: overrides.cfgVideoUnderstandModel || createInput(""),
    cfgVideoUnderstandTimeoutMs: overrides.cfgVideoUnderstandTimeoutMs || createInput(""),
    cfgVideoUnderstandTransport: overrides.cfgVideoUnderstandTransport || createInput("auto"),
    cfgVideoUnderstandFps: overrides.cfgVideoUnderstandFps || createInput(""),
    cfgVideoUnderstandMaxInputMb: overrides.cfgVideoUnderstandMaxInputMb || createInput(""),
    cfgVideoUnderstandPrompt: overrides.cfgVideoUnderstandPrompt || createInput(""),
    cfgVideoUnderstandAutoOnAttachment: overrides.cfgVideoUnderstandAutoOnAttachment || createCheckbox(true),
    cfgVideoUnderstandAutoAttachmentMaxTimelineItems: overrides.cfgVideoUnderstandAutoAttachmentMaxTimelineItems || createInput(""),
    cfgVideoUnderstandAutoAttachmentSummaryCharLimit: overrides.cfgVideoUnderstandAutoAttachmentSummaryCharLimit || createInput(""),
    cfgSttProvider: overrides.cfgSttProvider || createInput(""),
    cfgSttModel: overrides.cfgSttModel || createInput(""),
    cfgSttOpenAiBaseUrl: overrides.cfgSttOpenAiBaseUrl || createInput(""),
    cfgSttOpenAiApiKey: overrides.cfgSttOpenAiApiKey || createInput(""),
    cfgSttLanguage: overrides.cfgSttLanguage || createInput(""),
    cfgSttGroqApiKey: overrides.cfgSttGroqApiKey || createInput(""),
    cfgSttGroqBaseUrl: overrides.cfgSttGroqBaseUrl || createInput(""),
    cfgQqSttFallbackProviders: overrides.cfgQqSttFallbackProviders || createInput(""),
    cfgCameraNativeHelperCommand: overrides.cfgCameraNativeHelperCommand || createInput(""),
    cfgCameraNativeHelperArgsJson: overrides.cfgCameraNativeHelperArgsJson || createInput(""),
    cfgCameraNativeHelperCwd: overrides.cfgCameraNativeHelperCwd || createInput(""),
    cfgCameraNativeHelperStartupTimeoutMs: overrides.cfgCameraNativeHelperStartupTimeoutMs || createInput(""),
    cfgCameraNativeHelperRequestTimeoutMs: overrides.cfgCameraNativeHelperRequestTimeoutMs || createInput(""),
    cfgCameraNativeHelperIdleShutdownMs: overrides.cfgCameraNativeHelperIdleShutdownMs || createInput(""),
    cfgCameraNativeHelperEnvJson: overrides.cfgCameraNativeHelperEnvJson || createInput(""),
    cfgCameraNativeHelperPowershellCommand: overrides.cfgCameraNativeHelperPowershellCommand || createInput(""),
    cfgCameraNativeHelperPowershellArgsJson: overrides.cfgCameraNativeHelperPowershellArgsJson || createInput(""),
    cfgCameraNativeHelperFfmpegCommand: overrides.cfgCameraNativeHelperFfmpegCommand || createInput(""),
    cfgCameraNativeHelperFfmpegArgsJson: overrides.cfgCameraNativeHelperFfmpegArgsJson || createInput(""),
    cfgDashScopeApiKey: overrides.cfgDashScopeApiKey || createInput(""),
    cfgFacetAnchor: overrides.cfgFacetAnchor || createInput(""),
    cfgInjectAgents: overrides.cfgInjectAgents || createCheckbox(false),
    cfgInjectSoul: overrides.cfgInjectSoul || createCheckbox(false),
    cfgInjectMemory: overrides.cfgInjectMemory || createCheckbox(false),
    cfgPromptFocusEnabled: overrides.cfgPromptFocusEnabled || createCheckbox(true),
    cfgPromptFocusSemanticEnabled: overrides.cfgPromptFocusSemanticEnabled || createCheckbox(true),
    cfgPromptFocusSemanticMinScore: overrides.cfgPromptFocusSemanticMinScore || createInput(""),
    cfgMaxSystemPromptChars: overrides.cfgMaxSystemPromptChars || createInput(""),
    cfgMaxHistory: overrides.cfgMaxHistory || createInput(""),
    cfgConversationKindMain: overrides.cfgConversationKindMain || createCheckbox(false),
    cfgConversationKindSubtask: overrides.cfgConversationKindSubtask || createCheckbox(false),
    cfgConversationKindGoal: overrides.cfgConversationKindGoal || createCheckbox(false),
    cfgConversationKindHeartbeat: overrides.cfgConversationKindHeartbeat || createCheckbox(false),
    cfgPromptExperimentDisableSections: overrides.cfgPromptExperimentDisableSections || createInput(""),
    cfgPromptExperimentSectionPriorityOverrides: overrides.cfgPromptExperimentSectionPriorityOverrides || createInput(""),
    cfgPromptExperimentDisableToolContracts: overrides.cfgPromptExperimentDisableToolContracts || createInput(""),
    cfgPromptSnapshotMaxRuns: overrides.cfgPromptSnapshotMaxRuns || createInput(""),
    cfgPromptSnapshotMaxPersistedRuns: overrides.cfgPromptSnapshotMaxPersistedRuns || createInput(""),
    cfgPromptSnapshotEmailThreadMaxRuns: overrides.cfgPromptSnapshotEmailThreadMaxRuns || createInput(""),
    cfgPromptSnapshotHeartbeatMaxRuns: overrides.cfgPromptSnapshotHeartbeatMaxRuns || createInput(""),
    cfgPromptSnapshotRetentionDays: overrides.cfgPromptSnapshotRetentionDays || createInput(""),
    cfgCompactionEnabled: overrides.cfgCompactionEnabled || createCheckbox(true),
    cfgCompactionThreshold: overrides.cfgCompactionThreshold || createInput(""),
    cfgCompactionKeepRecent: overrides.cfgCompactionKeepRecent || createInput(""),
    cfgCompactionTriggerFraction: overrides.cfgCompactionTriggerFraction || createInput(""),
    cfgCompactionArchivalThreshold: overrides.cfgCompactionArchivalThreshold || createInput(""),
    cfgCompactionWarningThreshold: overrides.cfgCompactionWarningThreshold || createInput(""),
    cfgCompactionBlockingThreshold: overrides.cfgCompactionBlockingThreshold || createInput(""),
    cfgCompactionMaxConsecutiveFailures: overrides.cfgCompactionMaxConsecutiveFailures || createInput(""),
    cfgCompactionMaxPtlRetries: overrides.cfgCompactionMaxPtlRetries || createInput(""),
    cfgCompactionContextWindowFraction: overrides.cfgCompactionContextWindowFraction || createInput(""),
    cfgModelContextWindow: overrides.cfgModelContextWindow || createInput(""),
    cfgCompressionReferenceStore: overrides.cfgCompressionReferenceStore || createCheckbox(true),
    cfgPreflightCompressionEnabled: overrides.cfgPreflightCompressionEnabled || createCheckbox(true),
    cfgPreflightCompressionMode: overrides.cfgPreflightCompressionMode || createInput("attachments"),
    cfgPreflightAttachmentThresholdChars: overrides.cfgPreflightAttachmentThresholdChars || createInput(""),
    cfgPreflightTargetRatio: overrides.cfgPreflightTargetRatio || createInput(""),
    cfgPreflightMinSavingsRatio: overrides.cfgPreflightMinSavingsRatio || createInput(""),
    cfgPreflightTimeoutMs: overrides.cfgPreflightTimeoutMs || createInput(""),
    cfgPreflightAttachmentReference: overrides.cfgPreflightAttachmentReference || createInput("none"),
    cfgPreflightSidecarRetentionMs: overrides.cfgPreflightSidecarRetentionMs || createInput(""),
    cfgPreflightSidecarMaxEntries: overrides.cfgPreflightSidecarMaxEntries || createInput(""),
    cfgCompressionPersistentReferenceStore: overrides.cfgCompressionPersistentReferenceStore || createCheckbox(false),
    cfgCompressionPersistentReferenceTtlMs: overrides.cfgCompressionPersistentReferenceTtlMs || createInput(""),
    cfgCompressionPersistentReferenceMaxEntries: overrides.cfgCompressionPersistentReferenceMaxEntries || createInput(""),
    cfgBudgetProtectMode: overrides.cfgBudgetProtectMode || createInput("protect_memory_capability"),
    cfgBudgetProtectKeepRecentRounds: overrides.cfgBudgetProtectKeepRecentRounds || createInput(""),
    cfgStablePrefixSplit: overrides.cfgStablePrefixSplit || createCheckbox(false),
    cfgCompactionModelRoute: overrides.cfgCompactionModelRoute || createInput(""),
    cfgCompactionModel: overrides.cfgCompactionModel || createInput(""),
    cfgCompactionBaseUrl: overrides.cfgCompactionBaseUrl || createInput(""),
    cfgCompactionApiKey: overrides.cfgCompactionApiKey || createInput(""),
    cfgEmailOutboundRequireConfirmation: overrides.cfgEmailOutboundRequireConfirmation || createCheckbox(false),
    cfgEmailDefaultProvider: overrides.cfgEmailDefaultProvider || createInput(""),
    cfgEmailSmtpEnabled: overrides.cfgEmailSmtpEnabled || createCheckbox(false),
    cfgEmailSmtpAccountId: overrides.cfgEmailSmtpAccountId || createInput(""),
    cfgEmailSmtpHost: overrides.cfgEmailSmtpHost || createInput(""),
    cfgEmailSmtpPort: overrides.cfgEmailSmtpPort || createInput(""),
    cfgEmailSmtpSecure: overrides.cfgEmailSmtpSecure || createCheckbox(false),
    cfgEmailSmtpUser: overrides.cfgEmailSmtpUser || createInput(""),
    cfgEmailSmtpPass: overrides.cfgEmailSmtpPass || createInput(""),
    cfgEmailSmtpFromAddress: overrides.cfgEmailSmtpFromAddress || createInput(""),
    cfgEmailSmtpFromName: overrides.cfgEmailSmtpFromName || createInput(""),
    cfgEmailImapEnabled: overrides.cfgEmailImapEnabled || createCheckbox(false),
    cfgEmailInboundAgentId: overrides.cfgEmailInboundAgentId || createInput(""),
    cfgEmailImapAccountId: overrides.cfgEmailImapAccountId || createInput(""),
    cfgEmailImapHost: overrides.cfgEmailImapHost || createInput(""),
    cfgEmailImapPort: overrides.cfgEmailImapPort || createInput(""),
    cfgEmailImapSecure: overrides.cfgEmailImapSecure || createCheckbox(false),
    cfgEmailImapUser: overrides.cfgEmailImapUser || createInput(""),
    cfgEmailImapPass: overrides.cfgEmailImapPass || createInput(""),
    cfgEmailImapMailbox: overrides.cfgEmailImapMailbox || createInput(""),
    cfgEmailImapPollIntervalMs: overrides.cfgEmailImapPollIntervalMs || createInput(""),
    cfgEmailImapConnectTimeoutMs: overrides.cfgEmailImapConnectTimeoutMs || createInput(""),
    cfgEmailImapSocketTimeoutMs: overrides.cfgEmailImapSocketTimeoutMs || createInput(""),
    cfgEmailImapBootstrapMode: overrides.cfgEmailImapBootstrapMode || createInput(""),
    cfgEmailImapRecentWindowLimit: overrides.cfgEmailImapRecentWindowLimit || createInput(""),
    cfgChannelRouterEnabled: overrides.cfgChannelRouterEnabled || createCheckbox(false),
    cfgChannelRouterConfigPath: overrides.cfgChannelRouterConfigPath || createInput(""),
    cfgChannelRouterDefaultAgentId: overrides.cfgChannelRouterDefaultAgentId || createInput(""),
    cfgFeishuAppId: overrides.cfgFeishuAppId || createInput(""),
    cfgFeishuAppSecret: overrides.cfgFeishuAppSecret || createInput(""),
    cfgFeishuAgentId: overrides.cfgFeishuAgentId || createInput(""),
    cfgQqAppId: overrides.cfgQqAppId || createInput(""),
    cfgQqAppSecret: overrides.cfgQqAppSecret || createInput(""),
    cfgQqAgentId: overrides.cfgQqAgentId || createInput(""),
    cfgQqSandbox: overrides.cfgQqSandbox || createCheckbox(false),
    cfgQqEventSampleCaptureEnabled: overrides.cfgQqEventSampleCaptureEnabled || createCheckbox(false),
    cfgQqEventSampleCaptureDir: overrides.cfgQqEventSampleCaptureDir || createInput(""),
    cfgCommunityApiEnabled: overrides.cfgCommunityApiEnabled || createCheckbox(false),
    cfgCommunityApiToken: overrides.cfgCommunityApiToken || createInput(""),
    cfgDiscordEnabled: overrides.cfgDiscordEnabled || createCheckbox(false),
    cfgDiscordBotToken: overrides.cfgDiscordBotToken || createInput(""),
    cfgDiscordDefaultChannelId: overrides.cfgDiscordDefaultChannelId || createInput(""),
    cfgWebhookPreauthMaxBytes: overrides.cfgWebhookPreauthMaxBytes || createInput(""),
    cfgWebhookPreauthTimeoutMs: overrides.cfgWebhookPreauthTimeoutMs || createInput(""),
    cfgWebhookRateLimitWindowMs: overrides.cfgWebhookRateLimitWindowMs || createInput(""),
    cfgWebhookRateLimitMaxRequests: overrides.cfgWebhookRateLimitMaxRequests || createInput(""),
    cfgWebhookRateLimitMaxTrackedKeys: overrides.cfgWebhookRateLimitMaxTrackedKeys || createInput(""),
    cfgWebhookMaxInFlightPerKey: overrides.cfgWebhookMaxInFlightPerKey || createInput(""),
    cfgWebhookMaxInFlightTrackedKeys: overrides.cfgWebhookMaxInFlightTrackedKeys || createInput(""),
    cfgTokenUsageUploadEnabled: overrides.cfgTokenUsageUploadEnabled || createCheckbox(false),
    cfgTokenUsageUploadUrl: overrides.cfgTokenUsageUploadUrl || createInput(""),
    cfgTokenUsageUploadApiKey: overrides.cfgTokenUsageUploadApiKey || createInput(""),
    cfgTokenUsageUploadTimeoutMs: overrides.cfgTokenUsageUploadTimeoutMs || createInput(""),
    cfgTokenUsageStrictUuid: overrides.cfgTokenUsageStrictUuid || createCheckbox(false),
    cfgWebchatCostBudgetUsd: overrides.cfgWebchatCostBudgetUsd || createInput(""),
    cfgWebchatCostBudgetWarnFraction: overrides.cfgWebchatCostBudgetWarnFraction || createInput(""),
    cfgAutoTaskTimeEnabled: overrides.cfgAutoTaskTimeEnabled || createCheckbox(false),
    cfgAutoTaskTokenEnabled: overrides.cfgAutoTaskTokenEnabled || createCheckbox(false),
    cfgWebhookConfigPath: overrides.cfgWebhookConfigPath || createInput(""),
    cfgWebhookIdempotencyWindowMs: overrides.cfgWebhookIdempotencyWindowMs || createInput(""),
    cfgStateDir: overrides.cfgStateDir || createInput(""),
    cfgStateDirWindows: overrides.cfgStateDirWindows || createInput(""),
    cfgStateDirWsl: overrides.cfgStateDirWsl || createInput(""),
    cfgWorkspaceDir: overrides.cfgWorkspaceDir || createInput(""),
    cfgExtraWorkspaceRoots: overrides.cfgExtraWorkspaceRoots || createInput(""),
    cfgWebRoot: overrides.cfgWebRoot || createInput(""),
    cfgGovernanceDetailMode: overrides.cfgGovernanceDetailMode || createInput("compact"),
    cfgCommanderMode: overrides.cfgCommanderMode || createInput("auto"),
    cfgCommanderAgentId: overrides.cfgCommanderAgentId || createInput(""),
    cfgGoalExecutionMode: overrides.cfgGoalExecutionMode || createInput("auto"),
    cfgGoalGovernanceMode: overrides.cfgGoalGovernanceMode || createInput("auto"),
    cfgCommanderAutoReworkEnabled: overrides.cfgCommanderAutoReworkEnabled || createCheckbox(false),
    cfgExperienceDraftGenerateNoticeEnabled: overrides.cfgExperienceDraftGenerateNoticeEnabled || createCheckbox(true),
    cfgLogLevel: overrides.cfgLogLevel || createInput(""),
    cfgLogConsole: overrides.cfgLogConsole || createCheckbox(false),
    cfgLogFile: overrides.cfgLogFile || createCheckbox(false),
    cfgLogDir: overrides.cfgLogDir || createInput(""),
    cfgLogMaxSize: overrides.cfgLogMaxSize || createInput(""),
    cfgLogRetentionDays: overrides.cfgLogRetentionDays || createInput(""),
    cfgDreamAutoHeartbeatEnabled: overrides.cfgDreamAutoHeartbeatEnabled || createCheckbox(false),
    cfgDreamAutoCronEnabled: overrides.cfgDreamAutoCronEnabled || createCheckbox(false),
    cfgDreamOpenAIThinking: overrides.cfgDreamOpenAIThinking || createInput(""),
    cfgDreamOpenAIReasoningEffort: overrides.cfgDreamOpenAIReasoningEffort || createInput(""),
    cfgDreamOpenAITimeoutMs: overrides.cfgDreamOpenAITimeoutMs || createInput(""),
    cfgDreamOpenAIMaxTokens: overrides.cfgDreamOpenAIMaxTokens || createInput(""),
    cfgDreamObsidianEnabled: overrides.cfgDreamObsidianEnabled || createCheckbox(false),
    cfgDreamObsidianVaultPath: overrides.cfgDreamObsidianVaultPath || createInput(""),
    cfgDreamObsidianRootDir: overrides.cfgDreamObsidianRootDir || createInput(""),
    cfgCommonsObsidianEnabled: overrides.cfgCommonsObsidianEnabled || createCheckbox(false),
    cfgCommonsObsidianVaultPath: overrides.cfgCommonsObsidianVaultPath || createInput(""),
    cfgCommonsObsidianRootDir: overrides.cfgCommonsObsidianRootDir || createInput(""),
    cfgRoomInjectThreshold: overrides.cfgRoomInjectThreshold || createInput(""),
    cfgRoomMembersCacheTtl: overrides.cfgRoomMembersCacheTtl || createInput(""),
    doctorStatusEl: overrides.doctorStatusEl || createDomNode(),
    assistantModeConfigTitleEl: overrides.assistantModeConfigTitleEl || { textContent: "" },
    assistantModeConfigHelpEl: overrides.assistantModeConfigHelpEl || { textContent: "" },
    assistantModeConfigHintEl: overrides.assistantModeConfigHintEl || { textContent: "" },
  };
}

function createController(overrides = {}) {
  const refs = overrides.refs || createSettingsRefs(overrides.refsOverrides || {});
  const onApprovePairing = overrides.onApprovePairing || vi.fn().mockResolvedValue({ ok: true });
  const sendReq = overrides.sendReq || vi.fn();
  const loadServerConfig = overrides.loadServerConfig || vi.fn();
  const controller = createSettingsController({
    refs,
    isConnected: overrides.isConnected || (() => true),
    sendReq,
    makeId: overrides.makeId || (() => "req-1"),
    setStatus: overrides.setStatus || vi.fn(),
    loadServerConfig,
    invalidateServerConfigCache: overrides.invalidateServerConfigCache || vi.fn(),
    syncAttachmentLimitsFromConfig: overrides.syncAttachmentLimitsFromConfig || vi.fn(),
    getConnectionAuthMode: overrides.getConnectionAuthMode || (() => "none"),
    onApprovePairing,
    t: overrides.t,
  });
  return {
    controller,
    refs,
    pairingPendingList: refs.pairingPendingList,
    settingsModal: refs.settingsModal,
    onApprovePairing,
    sendReq,
    loadServerConfig,
  };
}

describe("settings controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    globalThis.HTMLElement = FakeHTMLElement;
    const doctorToggleBtn = createDomNode();
    globalThis.document = {
      getElementById: vi.fn((id) => (id === "doctorToggleBtn" ? doctorToggleBtn : null)),
      createElement: vi.fn(() => createDomNode()),
    };
    globalThis.alert = vi.fn();
    globalThis.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete globalThis.HTMLElement;
    delete globalThis.document;
    delete globalThis.alert;
    delete globalThis.confirm;
  });

  it("renders pairing approvals inside settings", () => {
    const { controller, pairingPendingList } = createController();

    controller.renderPairingPending([
      {
        code: "ABCD1234",
        clientId: "client-1",
        message: "需要批准当前配对码。",
        updatedAt: "2026-04-12T09:30:00.000Z",
      },
    ]);

    expect(pairingPendingList.innerHTML).toContain("ABCD1234");
    expect(pairingPendingList.innerHTML).toContain("client-1");
    expect(pairingPendingList.innerHTML).toContain("批准");
  });

  it("routes pairing approval clicks through the provided handler", async () => {
    const { controller, pairingPendingList, onApprovePairing } = createController();

    controller.renderPairingPending([
      {
        code: "ABCD1234",
        message: "需要批准当前配对码。",
        updatedAt: "2026-04-12T09:30:00.000Z",
      },
    ]);

    const button = new FakeButton({
      "data-pairing-action": "approve",
      "data-pairing-code": "ABCD1234",
    });
    pairingPendingList.trigger("click", { target: button });
    await Promise.resolve();
    await Promise.resolve();

    expect(onApprovePairing).toHaveBeenCalledWith("ABCD1234");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("处理中...");
  });

  it("loads assistant mode config fields through settings mapping", async () => {
    const loadServerConfig = vi.fn().mockResolvedValue({
      BELLDANDY_HOST: "0.0.0.0",
      BELLDANDY_PORT: "3000",
      BELLDANDY_GATEWAY_PORT: "3001",
      BELLDANDY_UPDATE_CHECK: "false",
      BELLDANDY_UPDATE_CHECK_TIMEOUT_MS: "3500",
      BELLDANDY_UPDATE_CHECK_API_URL: "https://api.github.com/repos/example/project/releases/latest",
      BELLDANDY_DEV_RUNTIME_DIST_GUARD: "warn",
      BELLDANDY_AUTH_MODE: "token",
      BELLDANDY_AUTH_TOKEN: "[REDACTED]",
      BELLDANDY_ALLOWED_ORIGINS: "http://localhost:5173,https://app.example.com",
      BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "12345",
      BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES: "67890",
      BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT: "2000",
      BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT: "4000",
      BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT: "800",
      BELLDANDY_AGENT_PROVIDER: "openai",
      BELLDANDY_OPENAI_BASE_URL: "https://api.example.com/v1",
      BELLDANDY_OPENAI_MODEL: "gpt-test",
      BELLDANDY_OPENAI_STREAM: "false",
      BELLDANDY_OPENAI_WIRE_API: "responses",
      BELLDANDY_OPENAI_THINKING: "enabled",
      BELLDANDY_OPENAI_REASONING_EFFORT: "max",
      BELLDANDY_RESPONSES_SANITIZE_TOOL_SCHEMA: "true",
      BELLDANDY_OPENAI_MAX_RETRIES: "2",
      BELLDANDY_OPENAI_RETRY_BACKOFF_MS: "450",
      BELLDANDY_OPENAI_PROXY_URL: "http://127.0.0.1:7890",
      BELLDANDY_PRIMARY_WARMUP_ENABLED: "false",
      BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS: "9000",
      BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS: "65000",
      BELLDANDY_OPENAI_SYSTEM_PROMPT: "follow house rules",
      BELLDANDY_AGENT_TIMEOUT_MS: "150000",
      BELLDANDY_AGENT_PROTOCOL: "anthropic",
      BELLDANDY_VIDEO_FILE_API_URL: "https://api.moonshot.cn/v1",
      BELLDANDY_TTS_OPENAI_BASE_URL: "https://tts.example.com/v1",
      BELLDANDY_MODEL_PREFERRED_PROVIDERS: "moonshot,openrouter",
      BELLDANDY_MEMORY_SUMMARY_API_KEY: "aliyun-memory-summary-key",
      BELLDANDY_ASSISTANT_MODE_ENABLED: "true",
      BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "false",
      BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: "qq,feishu",
      BELLDANDY_HEARTBEAT_INTERVAL: "45m",
      BELLDANDY_HEARTBEAT_ENABLED: "true",
      BELLDANDY_HEARTBEAT_ACTIVE_HOURS: "08:00-23:00",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED: "true",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS: "7000",
      BELLDANDY_BROWSER_RELAY_ENABLED: "true",
      BELLDANDY_RELAY_PORT: "28892",
      BELLDANDY_MCP_ENABLED: "true",
      BELLDANDY_BROWSER_ALLOWED_DOMAINS: "github.com,developer.mozilla.org",
      BELLDANDY_BROWSER_DENIED_DOMAINS: "mail.google.com",
      BELLDANDY_AGENT_BRIDGE_ENABLED: "true",
      BELLDANDY_TOOL_GROUPS: "browser,system",
      BELLDANDY_MAX_INPUT_TOKENS: "20000",
      BELLDANDY_MAX_OUTPUT_TOKENS: "8192",
      BELLDANDY_MEMORY_ENABLED: "false",
      BELLDANDY_WORKFLOW_MAX_CONCURRENT: "6",
      BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE: "20",
      BELLDANDY_WORKFLOW_TIMEOUT_MS: "600000",
      BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS: "300000",
      BELLDANDY_WORKFLOW_MAX_AGENT_CALLS: "50",
      BELLDANDY_WORKFLOW_MAX_DEPTH: "2",
      BELLDANDY_EMBEDDING_ENABLED: "true",
      BELLDANDY_EMBEDDING_PROVIDER: "local",
      BELLDANDY_EMBEDDING_OPENAI_BASE_URL: "https://embedding.example.com/v1",
      BELLDANDY_EMBEDDING_MODEL: "text-embedding-3-small",
      BELLDANDY_LOCAL_EMBEDDING_MODEL: "BAAI/bge-m3",
      BELLDANDY_EMBEDDING_BATCH_SIZE: "4",
      BELLDANDY_CONTEXT_INJECTION: "false",
      BELLDANDY_CONTEXT_INJECTION_LIMIT: "7",
      BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "true",
      BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT: "4",
      BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES: "preference,fact,experience",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "false",
      BELLDANDY_AUTO_RECALL_ENABLED: "true",
      BELLDANDY_AUTO_RECALL_LIMIT: "5",
      BELLDANDY_AUTO_RECALL_MIN_SCORE: "0.42",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "9000",
      BELLDANDY_MIND_PROFILE_RUNTIME_ENABLED: "false",
      BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINES: "6",
      BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINE_LENGTH: "140",
      BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS: "480",
      BELLDANDY_MIND_PROFILE_RUNTIME_MIN_SIGNAL_COUNT: "3",
      BELLDANDY_MEMORY_SUMMARY_ENABLED: "true",
      BELLDANDY_MEMORY_SUMMARY_MODEL: "qwen-plus",
      BELLDANDY_MEMORY_SUMMARY_BASE_URL: "https://memory-summary.example.com/v1",
      BELLDANDY_MEMORY_EVOLUTION_ENABLED: "true",
      BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES: "8",
      BELLDANDY_MEMORY_EVOLUTION_MODEL: "qwen-max",
      BELLDANDY_MEMORY_EVOLUTION_BASE_URL: "https://memory-evolution.example.com/v1",
      BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "2",
      BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS: "1200000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS: "3",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS: "3600000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_PENDING_MESSAGES: "6",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_MESSAGE_DELTA: "4",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_SUCCESS_COOLDOWN_MS: "300000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MS: "5000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MAX_MS: "600000",
      BELLDANDY_TEAM_SHARED_MEMORY_ENABLED: "true",
      BELLDANDY_SHARED_REVIEW_CLAIM_TIMEOUT_MS: "5400000",
      BELLDANDY_TASK_MEMORY_ENABLED: "true",
      BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED: "true",
      BELLDANDY_TASK_SUMMARY_ENABLED: "true",
      BELLDANDY_TASK_SUMMARY_MODEL: "moonshot-v1-32k",
      BELLDANDY_TASK_SUMMARY_BASE_URL: "https://task-summary.example.com/v1",
      BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS: "30000",
      BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS: "3",
      BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL: "4000",
      BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED: "false",
      BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED: "false",
      BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED: "true",
      BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED: "true",
      BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED: "false",
      BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED: "true",
      BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED: "true",
      BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES: "8",
      BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS: "1600",
      BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET: "10000",
      BELLDANDY_MEMORY_DEEP_RETRIEVAL: "true",
      BELLDANDY_MEMORY_NODE_ASSISTED_RETRIEVAL: "true",
      BELLDANDY_EMBEDDING_QUERY_PREFIX: "query: ",
      BELLDANDY_EMBEDDING_PASSAGE_PREFIX: "passage: ",
      BELLDANDY_RERANKER_MIN_SCORE: "0.2",
      BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR: "500",
      BELLDANDY_MEMORY_INDEXER_VERBOSE_WATCH: "true",
      BELLDANDY_TASK_DEDUP_GUARD_ENABLED: "false",
      BELLDANDY_TASK_DEDUP_WINDOW_MINUTES: "30",
      BELLDANDY_TASK_DEDUP_MODE: "strict",
      BELLDANDY_TASK_DEDUP_POLICY: "run_command:off,file_write:hard-block",
      BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND: "node",
      BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON: '["helper.js"]',
      BELLDANDY_CAMERA_NATIVE_HELPER_CWD: "E:/project/star-sanctuary",
      BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS: "10000",
      BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS: "15000",
      BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS: "2000",
      BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON: '{"FOO":"bar"}',
      BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_COMMAND: "powershell.exe",
      BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_ARGS_JSON: "[]",
      BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND: "C:/ffmpeg/bin/ffmpeg.exe",
      BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON: '["-hide_banner"]',
      BELLDANDY_CRON_ENABLED: "true",
      BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
      BELLDANDY_EMAIL_DEFAULT_PROVIDER: "smtp",
      BELLDANDY_EMAIL_SMTP_ENABLED: "true",
      BELLDANDY_EMAIL_SMTP_ACCOUNT_ID: "default",
      BELLDANDY_EMAIL_SMTP_HOST: "smtp.example.com",
      BELLDANDY_EMAIL_SMTP_PORT: "587",
      BELLDANDY_EMAIL_SMTP_SECURE: "false",
      BELLDANDY_EMAIL_SMTP_USER: "mailer@example.com",
      BELLDANDY_EMAIL_SMTP_PASS: "[REDACTED]",
      BELLDANDY_EMAIL_SMTP_FROM_ADDRESS: "mailer@example.com",
      BELLDANDY_EMAIL_SMTP_FROM_NAME: "Belldandy",
      BELLDANDY_EMAIL_INBOUND_AGENT_ID: "researcher",
      BELLDANDY_EMAIL_IMAP_ENABLED: "false",
      BELLDANDY_EMAIL_IMAP_ACCOUNT_ID: "mailbox-1",
      BELLDANDY_EMAIL_IMAP_HOST: "imap.example.com",
      BELLDANDY_EMAIL_IMAP_PORT: "993",
      BELLDANDY_EMAIL_IMAP_SECURE: "true",
      BELLDANDY_EMAIL_IMAP_USER: "reader@example.com",
      BELLDANDY_EMAIL_IMAP_PASS: "[REDACTED]",
      BELLDANDY_EMAIL_IMAP_MAILBOX: "INBOX",
      BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS: "60000",
      BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS: "10000",
      BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS: "20000",
      BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE: "latest",
      BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT: "50",
      BELLDANDY_CHANNEL_ROUTER_ENABLED: "true",
      BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH: "~/.star_sanctuary/channels-routing.json",
      BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID: "default",
      BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID: "123456789012345678",
      BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "65536",
      BELLDANDY_WEBHOOK_PREAUTH_TIMEOUT_MS: "5000",
      BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS: "60000",
      BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "120",
      BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_TRACKED_KEYS: "4096",
      BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY: "8",
      BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_TRACKED_KEYS: "4096",
      BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED: "true",
      BELLDANDY_TOKEN_USAGE_UPLOAD_URL: "http://127.0.0.1:3001/api/internal/token-usage",
      BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY: "[REDACTED]",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS: "3000",
      BELLDANDY_TOKEN_USAGE_STRICT_UUID: "true",
      BELLDANDY_WEBCHAT_COST_BUDGET_USD: "0.05",
      BELLDANDY_WEBCHAT_COST_BUDGET_WARN_FRACTION: "0.8",
      BELLDANDY_AUTO_TASK_TIME_ENABLED: "true",
      BELLDANDY_AUTO_TASK_TOKEN_ENABLED: "false",
      BELLDANDY_WEBHOOK_CONFIG_PATH: "~/.star_sanctuary/webhooks.json",
      BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS: "600000",
      BELLDANDY_STATE_DIR: "~/.star_sanctuary",
      BELLDANDY_STATE_DIR_WINDOWS: "C:/Users/admin/.star_sanctuary",
      BELLDANDY_STATE_DIR_WSL: "~/.star_sanctuary",
      BELLDANDY_WORKSPACE_DIR: "./workspace",
      BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/tools,D:/projects",
      BELLDANDY_WEB_ROOT: "apps/web/public",
      BELLDANDY_PROMPT_FOCUS_ENABLED: "false",
      BELLDANDY_PROMPT_FOCUS_SEMANTIC_ENABLED: "true",
      BELLDANDY_PROMPT_FOCUS_SEMANTIC_MIN_SCORE: "0.35",
      BELLDANDY_LOG_LEVEL: "info",
      BELLDANDY_LOG_CONSOLE: "true",
      BELLDANDY_LOG_FILE: "true",
      BELLDANDY_LOG_DIR: "~/.star_sanctuary/logs",
      BELLDANDY_LOG_MAX_SIZE: "10MB",
      BELLDANDY_LOG_RETENTION_DAYS: "7",
      BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED: "true",
      BELLDANDY_DREAM_AUTO_CRON_ENABLED: "false",
      BELLDANDY_DREAM_OPENAI_THINKING: "disabled",
      BELLDANDY_DREAM_OPENAI_REASONING_EFFORT: "",
      BELLDANDY_DREAM_OPENAI_TIMEOUT_MS: "120000",
      BELLDANDY_DREAM_OPENAI_MAX_TOKENS: "1000",
      BELLDANDY_DREAM_OBSIDIAN_ENABLED: "true",
      BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH: "C:/Vault",
      BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR: "Dream",
      BELLDANDY_COMMONS_OBSIDIAN_ENABLED: "true",
      BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH: "C:/Vault",
      BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR: "Commons",
    });
    const { controller, refs } = createController({ loadServerConfig });

    await controller.loadConfig();

    expect(refs.cfgHost.value).toBe("0.0.0.0");
    expect(refs.cfgPort.value).toBe("3000");
    expect(refs.cfgGatewayPort.value).toBe("3001");
    expect(refs.cfgUpdateCheckEnabled.checked).toBe(false);
    expect(refs.cfgUpdateCheckTimeoutMs.value).toBe("3500");
    expect(refs.cfgUpdateCheckApiUrl.value).toBe("https://api.github.com/repos/example/project/releases/latest");
    expect(refs.cfgDevRuntimeDistGuard.value).toBe("warn");
    expect(refs.cfgAuthMode.value).toBe("token");
    expect(refs.cfgAuthToken.value).toBe("[REDACTED]");
    expect(refs.cfgAllowedOrigins.value).toBe("http://localhost:5173,https://app.example.com");
    expect(refs.cfgAttachmentMaxFileBytes.value).toBe("12345");
    expect(refs.cfgAttachmentMaxTotalBytes.value).toBe("67890");
    expect(refs.cfgAttachmentTextCharLimit.value).toBe("2000");
    expect(refs.cfgAttachmentTextTotalCharLimit.value).toBe("4000");
    expect(refs.cfgAudioTranscriptAppendCharLimit.value).toBe("800");
    expect(refs.assistantModeConfigTitleEl.textContent).toBe("Assistant Mode 配置");
    expect(refs.assistantModeConfigHelpEl.textContent).toContain("统一收口主动工作相关配置");
    expect(refs.assistantModeConfigHintEl.textContent).toContain("assistant mode 已启用");
    expect(refs.assistantModeConfigHintEl.textContent).toContain("主开关已显式配置");
    expect(refs.cfgAgentProvider.value).toBe("openai");
    expect(refs.cfgBaseUrl.value).toBe("https://api.example.com/v1");
    expect(refs.cfgModel.value).toBe("gpt-test");
    expect(refs.cfgOpenAiStreamEnabled.checked).toBe(false);
    expect(refs.cfgOpenAiWireApi.value).toBe("responses");
    expect(refs.cfgOpenAiThinking.value).toBe("enabled");
    expect(refs.cfgOpenAiReasoningEffort.value).toBe("max");
    expect(refs.cfgResponsesSanitizeToolSchema.checked).toBe(true);
    expect(refs.cfgOpenAiMaxRetries.value).toBe("2");
    expect(refs.cfgOpenAiRetryBackoffMs.value).toBe("450");
    expect(refs.cfgOpenAiProxyUrl.value).toBe("http://127.0.0.1:7890");
    expect(refs.cfgPrimaryWarmupEnabled.checked).toBe(false);
    expect(refs.cfgPrimaryWarmupTimeoutMs.value).toBe("9000");
    expect(refs.cfgPrimaryWarmupCooldownMs.value).toBe("65000");
    expect(refs.cfgOpenAiSystemPrompt.value).toBe("follow house rules");
    expect(refs.cfgAgentTimeoutMs.value).toBe("150000");
    expect(refs.cfgAgentProtocol.value).toBe("anthropic");
    expect(refs.cfgVideoFileApiUrl.value).toBe("https://api.moonshot.cn/v1");
    expect(refs.cfgTtsOpenAIBaseUrl.value).toBe("https://tts.example.com/v1");
    expect(refs.cfgModelPreferredProviders.value).toBe("moonshot,openrouter");
    expect(refs.cfgDashScopeApiKey.value).toBe("aliyun-memory-summary-key");
    expect(refs.cfgAssistantModeEnabled.checked).toBe(true);
    expect(refs.cfgAssistantModePreset.value).toBe("custom");
    expect(refs.cfgExternalOutboundRequireConfirmation.checked).toBe(false);
    expect(refs.cfgAssistantExternalDeliveryPreference.value).toBe("qq,feishu");
    expect(refs.cfgHeartbeat.value).toBe("45m");
    expect(refs.cfgHeartbeatEnabled.checked).toBe(true);
    expect(refs.cfgHeartbeatActiveHours.value).toBe("08:00-23:00");
    expect(refs.cfgStarweaverActiveNotifyEnabled.checked).toBe(true);
    expect(refs.cfgStarweaverActiveNotifyPollIntervalMs.value).toBe("7000");
    expect(refs.cfgBrowserRelayEnabled.checked).toBe(true);
    expect(refs.cfgRelayPort.value).toBe("28892");
    expect(refs.cfgMcpEnabled.checked).toBe(true);
    expect(refs.cfgBrowserAllowedDomains.value).toBe("github.com,developer.mozilla.org");
    expect(refs.cfgBrowserDeniedDomains.value).toBe("mail.google.com");
    expect(refs.cfgAgentBridgeEnabled.checked).toBe(true);
    expect(refs.cfgToolGroups.value).toBe("browser,system");
    expect(refs.cfgMaxInputTokens.value).toBe("20000");
    expect(refs.cfgMaxOutputTokens.value).toBe("8192");
    expect(refs.cfgMemoryEnabled.checked).toBe(false);
    expect(refs.cfgWorkflowMaxConcurrent.value).toBe("6");
    expect(refs.cfgWorkflowMaxQueueSize.value).toBe("20");
    expect(refs.cfgWorkflowTimeoutMs.value).toBe("600000");
    expect(refs.cfgWorkflowAgentTimeoutMs.value).toBe("300000");
    expect(refs.cfgWorkflowMaxAgentCalls.value).toBe("50");
    expect(refs.cfgWorkflowMaxDepth.value).toBe("2");
    expect(refs.cfgEmbeddingEnabled.checked).toBe(true);
    expect(refs.cfgEmbeddingProvider.value).toBe("local");
    expect(refs.cfgEmbeddingBaseUrl.value).toBe("https://embedding.example.com/v1");
    expect(refs.cfgEmbeddingModel.value).toBe("text-embedding-3-small");
    expect(refs.cfgLocalEmbeddingModel.value).toBe("BAAI/bge-m3");
    expect(refs.cfgEmbeddingBatchSize.value).toBe("4");
    expect(refs.cfgContextInjectionEnabled.checked).toBe(false);
    expect(refs.cfgContextInjectionLimit.value).toBe("7");
    expect(refs.cfgContextInjectionIncludeSession.checked).toBe(true);
    expect(refs.cfgContextInjectionTaskLimit.value).toBe("4");
    expect(refs.cfgContextInjectionAllowedCategories.value).toBe("preference,fact,experience");
    expect(refs.cfgCarryoverContextEnabled.checked).toBe(false);
    expect(refs.cfgAutoRecallEnabled.checked).toBe(true);
    expect(refs.cfgAutoRecallLimit.value).toBe("5");
    expect(refs.cfgAutoRecallMinScore.value).toBe("0.42");
    expect(refs.cfgToolResultTranscriptCharLimit.value).toBe("9000");
    expect(refs.cfgMindProfileRuntimeEnabled.checked).toBe(false);
    expect(refs.cfgMindProfileRuntimeMaxLines.value).toBe("6");
    expect(refs.cfgMindProfileRuntimeMaxLineLength.value).toBe("140");
    expect(refs.cfgMindProfileRuntimeMaxChars.value).toBe("480");
    expect(refs.cfgMindProfileRuntimeMinSignalCount.value).toBe("3");
    expect(refs.cfgMemorySummaryEnabled.checked).toBe(true);
    expect(refs.cfgMemorySummaryModel.value).toBe("qwen-plus");
    expect(refs.cfgMemorySummaryBaseUrl.value).toBe("https://memory-summary.example.com/v1");
    expect(refs.cfgMemorySummaryApiKey.value).toBe("aliyun-memory-summary-key");
    expect(refs.cfgMemoryEvolutionEnabled.checked).toBe(true);
    expect(refs.cfgMemoryEvolutionMinMessages.value).toBe("8");
    expect(refs.cfgMemoryEvolutionModel.value).toBe("qwen-max");
    expect(refs.cfgMemoryEvolutionBaseUrl.value).toBe("https://memory-evolution.example.com/v1");
    expect(refs.cfgMemorySessionDigestMaxRuns.value).toBe("2");
    expect(refs.cfgMemorySessionDigestWindowMs.value).toBe("1200000");
    expect(refs.cfgMemoryDurableExtractionMaxRuns.value).toBe("3");
    expect(refs.cfgMemoryDurableExtractionWindowMs.value).toBe("3600000");
    expect(refs.cfgTeamSharedMemoryEnabled.checked).toBe(true);
    expect(refs.cfgTaskMemoryEnabled.checked).toBe(true);
    expect(refs.cfgTaskStatsWhenMemoryDisabled.checked).toBe(true);
    expect(refs.cfgTaskSummaryEnabled.checked).toBe(true);
    expect(refs.cfgTaskSummaryModel.value).toBe("moonshot-v1-32k");
    expect(refs.cfgTaskSummaryBaseUrl.value).toBe("https://task-summary.example.com/v1");
    expect(refs.cfgExperienceAutoPromotionEnabled.checked).toBe(false);
    expect(refs.cfgMethodGenerationConfirmRequired.checked).toBe(true);
    expect(refs.cfgExperienceSynthesisMaxSimilarSources.value).toBe("8");
    expect(refs.cfgExperienceSynthesisMaxSourceContentChars.value).toBe("1600");
    expect(refs.cfgExperienceSynthesisTotalSourceContentCharBudget.value).toBe("10000");
    expect(refs.cfgMemoryDeepRetrievalEnabled.checked).toBe(true);
    expect(refs.cfgMemoryNodeAssistedRetrievalEnabled.checked).toBe(true);
    expect(refs.cfgEmbeddingQueryPrefix.value).toBe("query: ");
    expect(refs.cfgMemoryIndexerVerboseWatch.checked).toBe(true);
    expect(refs.cfgTaskDedupGuardEnabled.checked).toBe(false);
    expect(refs.cfgTaskDedupWindowMinutes.value).toBe("30");
    expect(refs.cfgTaskDedupMode.value).toBe("strict");
    expect(refs.cfgTaskDedupPolicy.value).toBe("run_command:off,file_write:hard-block");
    expect(refs.cfgCameraNativeHelperCommand.value).toBe("node");
    expect(refs.cfgCameraNativeHelperArgsJson.value).toBe('["helper.js"]');
    expect(refs.cfgCameraNativeHelperEnvJson.value).toBe('{"FOO":"bar"}');
    expect(refs.cfgCronEnabled.checked).toBe(true);
    expect(refs.cfgEmailOutboundRequireConfirmation.checked).toBe(true);
    expect(refs.cfgEmailDefaultProvider.value).toBe("smtp");
    expect(refs.cfgEmailSmtpEnabled.checked).toBe(true);
    expect(refs.cfgEmailSmtpAccountId.value).toBe("default");
    expect(refs.cfgEmailSmtpHost.value).toBe("smtp.example.com");
    expect(refs.cfgEmailSmtpPort.value).toBe("587");
    expect(refs.cfgEmailSmtpSecure.checked).toBe(false);
    expect(refs.cfgEmailSmtpUser.value).toBe("mailer@example.com");
    expect(refs.cfgEmailSmtpPass.value).toBe("[REDACTED]");
    expect(refs.cfgEmailSmtpFromAddress.value).toBe("mailer@example.com");
    expect(refs.cfgEmailSmtpFromName.value).toBe("Belldandy");
    expect(refs.cfgEmailInboundAgentId.value).toBe("researcher");
    expect(refs.cfgEmailImapEnabled.checked).toBe(false);
    expect(refs.cfgEmailImapAccountId.value).toBe("mailbox-1");
    expect(refs.cfgEmailImapHost.value).toBe("imap.example.com");
    expect(refs.cfgEmailImapPort.value).toBe("993");
    expect(refs.cfgEmailImapSecure.checked).toBe(true);
    expect(refs.cfgEmailImapUser.value).toBe("reader@example.com");
    expect(refs.cfgEmailImapPass.value).toBe("[REDACTED]");
    expect(refs.cfgEmailImapMailbox.value).toBe("INBOX");
    expect(refs.cfgEmailImapPollIntervalMs.value).toBe("60000");
    expect(refs.cfgEmailImapConnectTimeoutMs.value).toBe("10000");
    expect(refs.cfgEmailImapSocketTimeoutMs.value).toBe("20000");
    expect(refs.cfgEmailImapBootstrapMode.value).toBe("latest");
    expect(refs.cfgEmailImapRecentWindowLimit.value).toBe("50");
    expect(refs.cfgChannelRouterEnabled.checked).toBe(true);
    expect(refs.cfgChannelRouterConfigPath.value).toBe("~/.star_sanctuary/channels-routing.json");
    expect(refs.cfgChannelRouterDefaultAgentId.value).toBe("default");
    expect(refs.cfgDiscordDefaultChannelId.value).toBe("123456789012345678");
    expect(refs.cfgWebhookPreauthMaxBytes.value).toBe("65536");
    expect(refs.cfgWebhookPreauthTimeoutMs.value).toBe("5000");
    expect(refs.cfgWebhookRateLimitWindowMs.value).toBe("60000");
    expect(refs.cfgWebhookRateLimitMaxRequests.value).toBe("120");
    expect(refs.cfgWebhookRateLimitMaxTrackedKeys.value).toBe("4096");
    expect(refs.cfgWebhookMaxInFlightPerKey.value).toBe("8");
    expect(refs.cfgWebhookMaxInFlightTrackedKeys.value).toBe("4096");
    expect(refs.cfgTokenUsageUploadEnabled.checked).toBe(true);
    expect(refs.cfgTokenUsageUploadUrl.value).toBe("http://127.0.0.1:3001/api/internal/token-usage");
    expect(refs.cfgTokenUsageUploadApiKey.value).toBe("[REDACTED]");
    expect(refs.cfgTokenUsageUploadTimeoutMs.value).toBe("3000");
    expect(refs.cfgTokenUsageStrictUuid.checked).toBe(true);
    expect(refs.cfgWebchatCostBudgetUsd.value).toBe("0.05");
    expect(refs.cfgWebchatCostBudgetWarnFraction.value).toBe("0.8");
    expect(refs.cfgAutoTaskTimeEnabled.checked).toBe(true);
    expect(refs.cfgAutoTaskTokenEnabled.checked).toBe(false);
    expect(refs.cfgWebhookConfigPath.value).toBe("~/.star_sanctuary/webhooks.json");
    expect(refs.cfgWebhookIdempotencyWindowMs.value).toBe("600000");
    expect(refs.cfgStateDir.value).toBe("~/.star_sanctuary");
    expect(refs.cfgStateDirWindows.value).toBe("C:/Users/admin/.star_sanctuary");
    expect(refs.cfgStateDirWsl.value).toBe("~/.star_sanctuary");
    expect(refs.cfgWorkspaceDir.value).toBe("./workspace");
    expect(refs.cfgExtraWorkspaceRoots.value).toBe("E:/tools,D:/projects");
    expect(refs.cfgWebRoot.value).toBe("apps/web/public");
    expect(refs.cfgPromptFocusEnabled.checked).toBe(false);
    expect(refs.cfgPromptFocusSemanticEnabled.checked).toBe(true);
    expect(refs.cfgPromptFocusSemanticMinScore.value).toBe("0.35");
    expect(refs.cfgLogLevel.value).toBe("info");
    expect(refs.cfgLogConsole.checked).toBe(true);
    expect(refs.cfgLogFile.checked).toBe(true);
    expect(refs.cfgLogDir.value).toBe("~/.star_sanctuary/logs");
    expect(refs.cfgLogMaxSize.value).toBe("10MB");
    expect(refs.cfgLogRetentionDays.value).toBe("7");
    expect(refs.cfgDreamAutoHeartbeatEnabled.checked).toBe(true);
    expect(refs.cfgDreamAutoCronEnabled.checked).toBe(false);
    expect(refs.cfgDreamOpenAIThinking.value).toBe("disabled");
    expect(refs.cfgDreamOpenAIReasoningEffort.value).toBe("");
    expect(refs.cfgDreamOpenAITimeoutMs.value).toBe("120000");
    expect(refs.cfgDreamOpenAIMaxTokens.value).toBe("1000");
    expect(refs.cfgDreamObsidianEnabled.checked).toBe(true);
    expect(refs.cfgDreamObsidianVaultPath.value).toBe("C:/Vault");
    expect(refs.cfgDreamObsidianRootDir.value).toBe("Dream");
    expect(refs.cfgCommonsObsidianEnabled.checked).toBe(true);
    expect(refs.cfgCommonsObsidianVaultPath.value).toBe("C:/Vault");
    expect(refs.cfgCommonsObsidianRootDir.value).toBe("Commons");
  });

  it("opens settings on the model tab by default", async () => {
    const { controller, refs } = createController({
      loadServerConfig: vi.fn().mockResolvedValue({}),
      sendReq: vi.fn(async (frame) => {
        if (frame.method === "models.config.get") {
          return { ok: true, payload: { path: "models.json", content: '{\n  "fallbacks": []\n}\n' } };
        }
        if (frame.method === "channel.security.get") {
          return { ok: true, payload: { path: "channel-security.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        }
        if (frame.method === "channel.reply_chunking.get") {
          return { ok: true, payload: { path: "channel-reply-chunking.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        }
        if (frame.method === "channel.security.pending.list") {
          return { ok: true, payload: { pending: [] } };
        }
        if (frame.method === "system.doctor") {
          return { ok: true, payload: { surface: frame.params?.surface || "summary", checks: [] } };
        }
        return { ok: true, payload: {} };
      }),
    });

    await controller.toggle(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(refs.settingsTabButtons[0].classList.contains("active")).toBe(true);
    expect(refs.settingsTabPanels[0].hidden).toBe(false);
    expect(refs.settingsTabPanels[3].hidden).toBe(true);
  });

  it("loads persisted configured memory sources into the memory settings surface", async () => {
    const { controller, refs } = createController({
      loadServerConfig: vi.fn().mockResolvedValue({}),
      sendReq: vi.fn(async (frame) => {
        switch (frame.method) {
          case "models.config.get":
            return { ok: true, payload: { path: "models.json", content: '{\n  "fallbacks": []\n}\n' } };
          case "memory.configured_sources.get":
            return {
              ok: true,
              payload: {
                path: "E:/state/memory-configured-sources.json",
                configuredSources: [
                  {
                    id: "configured:obsidian-vault:1",
                    label: "Obsidian Vault",
                    sourceClass: "curated",
                    scope: "private",
                    rootPath: "C:/Vault",
                    fileExtensions: [".md"],
                  },
                ],
              },
            };
          case "channel.security.get":
            return { ok: true, payload: { path: "channel-security.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
          case "channel.reply_chunking.get":
            return { ok: true, payload: { path: "channel-reply-chunking.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
          case "channel.security.pending.list":
            return { ok: true, payload: { pending: [] } };
          case "system.doctor":
            return { ok: true, payload: { surface: frame.params?.surface || "summary", checks: [] } };
          default:
            return { ok: true, payload: {} };
        }
      }),
    });

    await controller.toggle(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(refs.cfgMemoryConfiguredSourcesContent.value).toContain('"id": "configured:obsidian-vault:1"');
    expect(refs.memoryConfiguredSourcesMeta.textContent).toContain("memory-configured-sources.json");
  });

  it("saves configured memory sources through settings without forcing restart", async () => {
    const refs = createSettingsRefs({
      cfgMemoryConfiguredSourcesContent: createInput('[\n  {\n    "id": "configured:obsidian-vault:1",\n    "label": "Obsidian Vault",\n    "sourceClass": "curated",\n    "scope": "private",\n    "rootPath": "C:/Vault",\n    "fileExtensions": [".md"]\n  }\n]'),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "memory.configured_sources.update":
          return {
            ok: true,
            payload: {
              path: "E:/state/memory-configured-sources.json",
              configuredSources: frame.params?.configuredSources || [],
            },
          };
        case "config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({
      refs,
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({}),
    });

    await controller.loadConfig();
    await controller.saveConfig();

    expect(sendReq.mock.calls.some(([frame]) => frame.method === "memory.configured_sources.update")).toBe(true);
    expect(sendReq.mock.calls.some(([frame]) => frame.method === "system.restart")).toBe(false);
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("runs external ingest preview from the current configured sources draft", async () => {
    const refs = createSettingsRefs({
      cfgMemoryConfiguredSourceId: createInput("configured:obsidian-vault:1"),
      cfgMemoryConfiguredSourcesContent: createInput('[\n  {\n    "id": "configured:obsidian-vault:1",\n    "label": "Obsidian Vault",\n    "sourceClass": "curated",\n    "scope": "private",\n    "rootPath": "C:/Vault",\n    "fileExtensions": [".md"]\n  }\n]'),
    });
    const sendReq = vi.fn(async (frame) => {
      if (frame.method === "memory.tree.report.external_ingest.preview") {
        return {
          ok: true,
          payload: {
            report: {
              sourceId: "configured:obsidian-vault:1",
              totalFiles: 3,
              eligibleFiles: 2,
            },
            record: {
              id: "report-1",
              reportType: "external_ingest_preview",
              status: "ready",
            },
          },
        };
      }
      return { ok: true, payload: {} };
    });
    createController({ refs, sendReq });

    refs.previewMemoryExternalIngestBtn.trigger("click");
    await Promise.resolve();

    const previewCall = sendReq.mock.calls.find(([frame]) => frame.method === "memory.tree.report.external_ingest.preview");
    expect(previewCall?.[0]?.params).toMatchObject({
      configuredSourceId: "configured:obsidian-vault:1",
    });
    expect(refs.cfgMemoryConfiguredSourcesPreviewContent.value).toContain('"kind": "external_ingest_preview"');
    expect(refs.cfgMemoryConfiguredSourcesPreviewContent.value).toContain('"sourceId": "configured:obsidian-vault:1"');
    expect(refs.memoryConfiguredSourcesActionStatus.textContent).toContain("report-1");
    expect(refs.memoryConfiguredSourcesActionStatus.textContent).toContain("ready");
  });

  it("reviews and applies configured external ingest reports from the settings panel", async () => {
    const refs = createSettingsRefs({
      cfgMemoryConfiguredSourcesPreviewContent: createInput('{\n  "kind": "external_ingest_preview",\n  "record": {\n    "id": "report-1",\n    "status": "ready"\n  },\n  "report": {\n    "sourceId": "configured:obsidian-vault:1"\n  }\n}'),
      cfgMemoryConfiguredSourcesActionNote: createInput("approve then apply"),
    });
    const sendReq = vi.fn(async (frame) => {
      if (frame.method === "memory.tree.report.review") {
        return {
          ok: true,
          payload: {
            result: {
              decision: "approved",
            },
            report: {
              id: "report-1",
              status: "approved",
              reportType: "external_ingest_preview",
            },
          },
        };
      }
      if (frame.method === "memory.tree.report.apply") {
        return {
          ok: true,
          payload: {
            result: {
              updatedChunkCount: 4,
            },
            report: {
              id: "report-1",
              status: "applied",
              reportType: "external_ingest_preview",
            },
          },
        };
      }
      return { ok: true, payload: {} };
    });
    createController({ refs, sendReq });

    refs.approveMemoryExternalIngestReportBtn.trigger("click");
    await Promise.resolve();

    const reviewCall = sendReq.mock.calls.find(([frame]) => frame.method === "memory.tree.report.review");
    expect(reviewCall?.[0]?.params).toMatchObject({
      reportId: "report-1",
      decision: "approved",
      reviewedBy: "webchat.settings",
      note: "approve then apply",
    });
    expect(refs.cfgMemoryConfiguredSourcesPreviewContent.value).toContain('"kind": "report_review"');
    expect(refs.memoryConfiguredSourcesActionStatus.textContent).toContain("approved");

    refs.applyMemoryExternalIngestReportBtn.trigger("click");
    await Promise.resolve();

    const applyCall = sendReq.mock.calls.find(([frame]) => frame.method === "memory.tree.report.apply");
    expect(applyCall?.[0]?.params).toMatchObject({
      reportId: "report-1",
      confirmed: true,
      appliedBy: "webchat.settings",
      note: "approve then apply",
    });
    expect(refs.cfgMemoryConfiguredSourcesPreviewContent.value).toContain('"kind": "report_apply"');
    expect(refs.memoryConfiguredSourcesActionStatus.textContent).toContain("applied");
  });

  it("routes channel and pending entrypoints to the correct tabs", async () => {
    const { controller, refs } = createController({
      loadServerConfig: vi.fn().mockResolvedValue({}),
      sendReq: vi.fn(async (frame) => {
        if (frame.method === "models.config.get") {
          return { ok: true, payload: { path: "models.json", content: '{\n  "fallbacks": []\n}\n' } };
        }
        if (frame.method === "channel.security.get") {
          return { ok: true, payload: { path: "channel-security.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        }
        if (frame.method === "channel.reply_chunking.get") {
          return { ok: true, payload: { path: "channel-reply-chunking.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        }
        if (frame.method === "channel.security.pending.list") {
          return { ok: true, payload: { pending: [] } };
        }
        if (frame.method === "system.doctor") {
          return { ok: true, payload: { surface: frame.params?.surface || "summary", checks: [] } };
        }
        return { ok: true, payload: {} };
      }),
    });

    await controller.openChannels();
    await Promise.resolve();
    await Promise.resolve();
    expect(refs.settingsTabButtons[3].classList.contains("active")).toBe(true);
    expect(refs.channelsSettingsSection.scrollIntoView).toHaveBeenCalled();

    await controller.openPairingPending();
    await Promise.resolve();
    await Promise.resolve();
    expect(refs.settingsTabButtons[0].classList.contains("active")).toBe(true);
    expect(refs.pairingPendingList.scrollIntoView).toHaveBeenCalled();

    await controller.openChannelSecurityPending();
    await Promise.resolve();
    await Promise.resolve();
    expect(refs.settingsTabButtons[0].classList.contains("active")).toBe(true);
    expect(refs.channelSecurityPendingList.scrollIntoView).toHaveBeenCalled();
  });

  it("saves assistant mode config fields through settings mapping", async () => {
    const refs = createSettingsRefs({
      cfgHost: createInput("0.0.0.0"),
      cfgPort: createInput("29999"),
      cfgGatewayPort: createInput("30000"),
      cfgUpdateCheckEnabled: createCheckbox(false),
      cfgUpdateCheckTimeoutMs: createInput("3500"),
      cfgUpdateCheckApiUrl: createInput("https://api.github.com/repos/example/project/releases/latest"),
      cfgDevRuntimeDistGuard: createInput("warn"),
      cfgAuthMode: createInput("token"),
      cfgAuthToken: createInput("setup-test-token"),
      cfgAuthPassword: createInput("super-secret-pass"),
      cfgAllowedOrigins: createInput("http://localhost:5173"),
      cfgAttachmentMaxFileBytes: createInput("555"),
      cfgAttachmentMaxTotalBytes: createInput("777"),
      cfgAttachmentTextCharLimit: createInput("888"),
      cfgAttachmentTextTotalCharLimit: createInput("999"),
      cfgAudioTranscriptAppendCharLimit: createInput("111"),
      cfgBaseUrl: createInput("https://api.example.com/v1"),
      cfgModel: createInput("gpt-test"),
      cfgAgentProvider: createInput("openai"),
      cfgOpenAiStreamEnabled: createCheckbox(false),
      cfgOpenAiWireApi: createInput("responses"),
      cfgOpenAiThinking: createInput("enabled"),
      cfgOpenAiReasoningEffort: createInput("max"),
      cfgResponsesSanitizeToolSchema: createCheckbox(true),
      cfgOpenAiMaxRetries: createInput("2"),
      cfgOpenAiRetryBackoffMs: createInput("450"),
      cfgOpenAiProxyUrl: createInput("http://127.0.0.1:7890"),
      cfgPrimaryWarmupEnabled: createCheckbox(false),
      cfgPrimaryWarmupTimeoutMs: createInput("9000"),
      cfgPrimaryWarmupCooldownMs: createInput("65000"),
      cfgOpenAiSystemPrompt: createInput("follow house rules"),
      cfgAgentTimeoutMs: createInput("150000"),
      cfgAgentProtocol: createInput("anthropic"),
      cfgVideoFileApiUrl: createInput("https://api.moonshot.cn/v1"),
      cfgVideoFileApiKey: createInput("video-api-secret"),
      cfgTtsOpenAIBaseUrl: createInput("https://tts.example.com/v1"),
      cfgTtsOpenAIApiKey: createInput("tts-openai-key"),
      cfgDashScopeApiKey: createInput("aliyun-unified-key"),
      cfgAssistantModeEnabled: createCheckbox(true),
      cfgAssistantModePreset: createInput("custom"),
      cfgExternalOutboundRequireConfirmation: createCheckbox(true),
      cfgAssistantExternalDeliveryPreference: createInput(" community,discord "),
      cfgHeartbeat: createInput(" 15m "),
      cfgHeartbeatEnabled: createCheckbox(true),
      cfgHeartbeatActiveHours: createInput(" 09:00-18:00 "),
      cfgBrowserRelayEnabled: createCheckbox(true),
      cfgRelayPort: createInput("28892"),
      cfgMcpEnabled: createCheckbox(true),
      cfgBrowserAllowedDomains: createInput(" github.com,developer.mozilla.org "),
      cfgBrowserDeniedDomains: createInput(" mail.google.com "),
      cfgAgentBridgeEnabled: createCheckbox(true),
      cfgToolGroups: createInput(" browser,system "),
      cfgMaxInputTokens: createInput("20000"),
      cfgMaxOutputTokens: createInput("8192"),
      cfgMemoryEnabled: createCheckbox(false),
      cfgWorkflowMaxConcurrent: createInput("6"),
      cfgWorkflowMaxQueueSize: createInput("20"),
      cfgWorkflowTimeoutMs: createInput("600000"),
      cfgWorkflowAgentTimeoutMs: createInput("300000"),
      cfgWorkflowMaxAgentCalls: createInput("50"),
      cfgWorkflowMaxDepth: createInput("2"),
      cfgEmbeddingEnabled: createCheckbox(true),
      cfgEmbeddingProvider: createInput("local"),
      cfgEmbeddingBaseUrl: createInput("https://embedding.example.com/v1"),
      cfgEmbeddingModel: createInput("text-embedding-3-small"),
      cfgLocalEmbeddingModel: createInput("BAAI/bge-m3"),
      cfgEmbeddingBatchSize: createInput("4"),
      cfgContextInjectionEnabled: createCheckbox(false),
      cfgContextInjectionLimit: createInput("7"),
      cfgContextInjectionIncludeSession: createCheckbox(true),
      cfgContextInjectionTaskLimit: createInput("4"),
      cfgContextInjectionAllowedCategories: createInput(" preference,fact,experience "),
      cfgCarryoverContextEnabled: createCheckbox(false),
      cfgAutoRecallEnabled: createCheckbox(true),
      cfgAutoRecallLimit: createInput("5"),
      cfgAutoRecallMinScore: createInput("0.42"),
      cfgToolResultTranscriptCharLimit: createInput("9000"),
      cfgMindProfileRuntimeEnabled: createCheckbox(false),
      cfgMindProfileRuntimeMaxLines: createInput("6"),
      cfgMindProfileRuntimeMaxLineLength: createInput("140"),
      cfgMindProfileRuntimeMaxChars: createInput("480"),
      cfgMindProfileRuntimeMinSignalCount: createInput("3"),
      cfgMemorySummaryEnabled: createCheckbox(true),
      cfgMemorySummaryModel: createInput("qwen-plus"),
      cfgMemorySummaryBaseUrl: createInput("https://memory-summary.example.com/v1"),
      cfgMemorySummaryApiKey: createInput("summary-dedicated-key"),
      cfgMemoryEvolutionEnabled: createCheckbox(true),
      cfgMemoryEvolutionMinMessages: createInput("8"),
      cfgMemoryEvolutionModel: createInput("qwen-max"),
      cfgMemoryEvolutionBaseUrl: createInput("https://memory-evolution.example.com/v1"),
      cfgMemoryEvolutionApiKey: createInput("evolution-dedicated-key"),
      cfgMemorySessionDigestMaxRuns: createInput("2"),
      cfgMemorySessionDigestWindowMs: createInput("1200000"),
      cfgMemoryDurableExtractionMaxRuns: createInput("3"),
      cfgMemoryDurableExtractionWindowMs: createInput("3600000"),
      cfgMemoryDurableExtractionMinPendingMessages: createInput("6"),
      cfgMemoryDurableExtractionMinMessageDelta: createInput("4"),
      cfgMemoryDurableExtractionSuccessCooldownMs: createInput("300000"),
      cfgMemoryDurableExtractionFailureBackoffMs: createInput("5000"),
      cfgMemoryDurableExtractionFailureBackoffMaxMs: createInput("600000"),
      cfgTeamSharedMemoryEnabled: createCheckbox(true),
      cfgSharedReviewClaimTimeoutMs: createInput("5400000"),
      cfgTaskMemoryEnabled: createCheckbox(true),
      cfgTaskStatsWhenMemoryDisabled: createCheckbox(true),
      cfgTaskSummaryEnabled: createCheckbox(true),
      cfgTaskSummaryModel: createInput("moonshot-v1-32k"),
      cfgTaskSummaryBaseUrl: createInput("https://task-summary.example.com/v1"),
      cfgTaskSummaryApiKey: createInput("task-summary-dedicated-key"),
      cfgTaskSummaryMinDurationMs: createInput("30000"),
      cfgTaskSummaryMinToolCalls: createInput("3"),
      cfgTaskSummaryMinTokenTotal: createInput("4000"),
      cfgExperienceAutoPromotionEnabled: createCheckbox(false),
      cfgExperienceAutoMethodEnabled: createCheckbox(false),
      cfgExperienceAutoSkillEnabled: createCheckbox(true),
      cfgMethodGenerationConfirmRequired: createCheckbox(true),
      cfgSkillGenerationConfirmRequired: createCheckbox(false),
      cfgMethodPublishConfirmRequired: createCheckbox(true),
      cfgSkillPublishConfirmRequired: createCheckbox(true),
      cfgExperienceSynthesisMaxSimilarSources: createInput("8"),
      cfgExperienceSynthesisMaxSourceContentChars: createInput("1600"),
      cfgExperienceSynthesisTotalSourceContentCharBudget: createInput("10000"),
      cfgMemoryDeepRetrievalEnabled: createCheckbox(true),
      cfgMemoryNodeAssistedRetrievalEnabled: createCheckbox(true),
      cfgEmbeddingQueryPrefix: createInput(" query: "),
      cfgEmbeddingPassagePrefix: createInput(" passage: "),
      cfgRerankerMinScore: createInput("0.2"),
      cfgRerankerLengthNormAnchor: createInput("500"),
      cfgMemoryIndexerVerboseWatch: createCheckbox(true),
      cfgTaskDedupGuardEnabled: createCheckbox(false),
      cfgTaskDedupWindowMinutes: createInput("30"),
      cfgTaskDedupMode: createInput("strict"),
      cfgTaskDedupPolicy: createInput(" run_command:off,file_write:hard-block "),
      cfgCronEnabled: createCheckbox(true),
      cfgEmailOutboundRequireConfirmation: createCheckbox(true),
      cfgEmailDefaultProvider: createInput(" smtp "),
      cfgEmailSmtpEnabled: createCheckbox(true),
      cfgEmailSmtpAccountId: createInput(" default "),
      cfgEmailSmtpHost: createInput(" smtp.example.com "),
      cfgEmailSmtpPort: createInput("587"),
      cfgEmailSmtpSecure: createCheckbox(false),
      cfgEmailSmtpUser: createInput(" mailer@example.com "),
      cfgEmailSmtpPass: createInput("smtp-app-pass"),
      cfgEmailSmtpFromAddress: createInput(" mailer@example.com "),
      cfgEmailSmtpFromName: createInput(" Belldandy "),
      cfgEmailInboundAgentId: createInput(" researcher "),
      cfgEmailImapEnabled: createCheckbox(false),
      cfgEmailImapAccountId: createInput(" mailbox-1 "),
      cfgEmailImapHost: createInput(" imap.example.com "),
      cfgEmailImapPort: createInput("993"),
      cfgEmailImapSecure: createCheckbox(true),
      cfgEmailImapUser: createInput(" reader@example.com "),
      cfgEmailImapPass: createInput("imap-app-pass"),
      cfgEmailImapMailbox: createInput(" INBOX "),
      cfgEmailImapPollIntervalMs: createInput("60000"),
      cfgEmailImapConnectTimeoutMs: createInput("10000"),
      cfgEmailImapSocketTimeoutMs: createInput("20000"),
      cfgEmailImapBootstrapMode: createInput(" latest "),
      cfgEmailImapRecentWindowLimit: createInput("50"),
      cfgChannelRouterEnabled: createCheckbox(true),
      cfgChannelRouterConfigPath: createInput(" ~/.star_sanctuary/channels-routing.json "),
      cfgChannelRouterDefaultAgentId: createInput(" default "),
      cfgCommunityApiEnabled: createCheckbox(false),
      cfgCommunityApiToken: createInput("community-token"),
      cfgFeishuAppId: createInput("cli_test_app"),
      cfgFeishuAppSecret: createInput("feishu-secret"),
      cfgFeishuAgentId: createInput("researcher"),
      cfgQqAppId: createInput("qq-app-id"),
      cfgQqAppSecret: createInput("qq-secret"),
      cfgQqAgentId: createInput("researcher"),
      cfgQqSandbox: createCheckbox(false),
      cfgQqEventSampleCaptureEnabled: createCheckbox(true),
      cfgQqEventSampleCaptureDir: createInput(" H:\\.star_sanctuary\\storage\\qq-event-samples "),
      cfgDiscordEnabled: createCheckbox(true),
      cfgDiscordBotToken: createInput("discord-secret"),
      cfgDiscordDefaultChannelId: createInput(" 123456789012345678 "),
      cfgWebhookPreauthMaxBytes: createInput("65536"),
      cfgWebhookPreauthTimeoutMs: createInput("5000"),
      cfgWebhookRateLimitWindowMs: createInput("60000"),
      cfgWebhookRateLimitMaxRequests: createInput("120"),
      cfgWebhookRateLimitMaxTrackedKeys: createInput("4096"),
      cfgWebhookMaxInFlightPerKey: createInput("8"),
      cfgWebhookMaxInFlightTrackedKeys: createInput("4096"),
      cfgTokenUsageUploadEnabled: createCheckbox(true),
      cfgTokenUsageUploadUrl: createInput(" http://127.0.0.1:3001/api/internal/token-usage "),
      cfgTokenUsageUploadApiKey: createInput("gro_token_key"),
      cfgTokenUsageUploadTimeoutMs: createInput("3000"),
      cfgTokenUsageStrictUuid: createCheckbox(true),
      cfgWebchatCostBudgetUsd: createInput(" 0.05 "),
      cfgWebchatCostBudgetWarnFraction: createInput(" 0.8 "),
      cfgAutoTaskTimeEnabled: createCheckbox(true),
      cfgAutoTaskTokenEnabled: createCheckbox(false),
      cfgWebhookConfigPath: createInput(" ~/.star_sanctuary/webhooks.json "),
      cfgWebhookIdempotencyWindowMs: createInput("600000"),
      cfgStateDir: createInput(" ~/.star_sanctuary "),
      cfgStateDirWindows: createInput(" C:/Users/admin/.star_sanctuary "),
      cfgStateDirWsl: createInput(" ~/.star_sanctuary "),
      cfgWorkspaceDir: createInput(" ./workspace "),
      cfgExtraWorkspaceRoots: createInput(" E:/tools,D:/projects "),
      cfgWebRoot: createInput(" apps/web/public "),
      cfgPromptFocusEnabled: createCheckbox(false),
      cfgPromptFocusSemanticEnabled: createCheckbox(true),
      cfgPromptFocusSemanticMinScore: createInput(" 0.35 "),
      cfgLogLevel: createInput(" info "),
      cfgLogConsole: createCheckbox(true),
      cfgLogFile: createCheckbox(true),
      cfgLogDir: createInput(" ~/.star_sanctuary/logs "),
      cfgLogMaxSize: createInput(" 10MB "),
      cfgLogRetentionDays: createInput("7"),
      cfgDreamAutoHeartbeatEnabled: createCheckbox(true),
      cfgDreamAutoCronEnabled: createCheckbox(false),
      cfgDreamOpenAIThinking: createInput(" disabled "),
      cfgDreamOpenAIReasoningEffort: createInput(" "),
      cfgDreamOpenAITimeoutMs: createInput(" 120000 "),
      cfgDreamOpenAIMaxTokens: createInput(" 1000 "),
      cfgDreamObsidianEnabled: createCheckbox(true),
      cfgDreamObsidianVaultPath: createInput(" C:/Vault "),
      cfgDreamObsidianRootDir: createInput(" Dream "),
      cfgCommonsObsidianEnabled: createCheckbox(true),
      cfgCommonsObsidianVaultPath: createInput(" C:/Vault "),
      cfgCommonsObsidianRootDir: createInput(" Commons "),
      cfgCameraNativeHelperCommand: createInput(" node "),
      cfgCameraNativeHelperArgsJson: createInput(' ["helper.js"] '),
      cfgCameraNativeHelperCwd: createInput(" E:/project/star-sanctuary "),
      cfgCameraNativeHelperStartupTimeoutMs: createInput("10000"),
      cfgCameraNativeHelperRequestTimeoutMs: createInput("15000"),
      cfgCameraNativeHelperIdleShutdownMs: createInput("2000"),
      cfgCameraNativeHelperEnvJson: createInput(' {"FOO":"bar"} '),
      cfgCameraNativeHelperPowershellCommand: createInput(" powershell.exe "),
      cfgCameraNativeHelperPowershellArgsJson: createInput(" [] "),
      cfgCameraNativeHelperFfmpegCommand: createInput(" C:/ffmpeg/bin/ffmpeg.exe "),
      cfgCameraNativeHelperFfmpegArgsJson: createInput(' ["-hide_banner"] '),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: { restartRequired: true } };
        case "channel.security.get":
          return { ok: true, payload: { path: "channel-security.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "channel-reply-chunking.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({ refs, sendReq });

    await controller.saveConfig();
    vi.runAllTimers();

    const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    const restartCall = sendReq.mock.calls.find(([frame]) => frame.method === "system.restart");
    expect(updateCall?.[0]?.params?.updates).toMatchObject({
      BELLDANDY_HOST: "0.0.0.0",
      BELLDANDY_PORT: "29999",
      BELLDANDY_GATEWAY_PORT: "30000",
      BELLDANDY_UPDATE_CHECK: "false",
      BELLDANDY_UPDATE_CHECK_TIMEOUT_MS: "3500",
      BELLDANDY_UPDATE_CHECK_API_URL: "https://api.github.com/repos/example/project/releases/latest",
      BELLDANDY_DEV_RUNTIME_DIST_GUARD: "warn",
      BELLDANDY_AUTH_MODE: "token",
      BELLDANDY_AUTH_TOKEN: "setup-test-token",
      BELLDANDY_AUTH_PASSWORD: "super-secret-pass",
      BELLDANDY_ALLOWED_ORIGINS: "http://localhost:5173",
      BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "555",
      BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES: "777",
      BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT: "888",
      BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT: "999",
      BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT: "111",
      BELLDANDY_OPENAI_BASE_URL: "https://api.example.com/v1",
      BELLDANDY_OPENAI_MODEL: "gpt-test",
      BELLDANDY_AGENT_PROVIDER: "openai",
      BELLDANDY_OPENAI_STREAM: "false",
      BELLDANDY_OPENAI_WIRE_API: "responses",
      BELLDANDY_OPENAI_THINKING: "enabled",
      BELLDANDY_OPENAI_REASONING_EFFORT: "max",
      BELLDANDY_RESPONSES_SANITIZE_TOOL_SCHEMA: "true",
      BELLDANDY_OPENAI_MAX_RETRIES: "2",
      BELLDANDY_OPENAI_RETRY_BACKOFF_MS: "450",
      BELLDANDY_OPENAI_PROXY_URL: "http://127.0.0.1:7890",
      BELLDANDY_PRIMARY_WARMUP_ENABLED: "false",
      BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS: "9000",
      BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS: "65000",
      BELLDANDY_OPENAI_SYSTEM_PROMPT: "follow house rules",
      BELLDANDY_AGENT_TIMEOUT_MS: "150000",
      BELLDANDY_AGENT_PROTOCOL: "anthropic",
      BELLDANDY_VIDEO_FILE_API_URL: "https://api.moonshot.cn/v1",
      BELLDANDY_VIDEO_FILE_API_KEY: "video-api-secret",
      BELLDANDY_TTS_OPENAI_BASE_URL: "https://tts.example.com/v1",
      BELLDANDY_TTS_OPENAI_API_KEY: "tts-openai-key",
      DASHSCOPE_API_KEY: "aliyun-unified-key",
      BELLDANDY_COMPACTION_API_KEY: "aliyun-unified-key",
      BELLDANDY_MEMORY_EVOLUTION_API_KEY: "aliyun-unified-key",
      BELLDANDY_MEMORY_SUMMARY_API_KEY: "aliyun-unified-key",
      BELLDANDY_EMBEDDING_OPENAI_API_KEY: "aliyun-unified-key",
      BELLDANDY_TASK_SUMMARY_API_KEY: "aliyun-unified-key",
      BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY: "aliyun-unified-key",
      BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY: "aliyun-unified-key",
      BELLDANDY_ASSISTANT_MODE_ENABLED: "true",
      BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
      BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: "community,discord",
      BELLDANDY_HEARTBEAT_INTERVAL: "15m",
      BELLDANDY_HEARTBEAT_ENABLED: "true",
      BELLDANDY_HEARTBEAT_ACTIVE_HOURS: "09:00-18:00",
      BELLDANDY_BROWSER_RELAY_ENABLED: "true",
      BELLDANDY_RELAY_PORT: "28892",
      BELLDANDY_MCP_ENABLED: "true",
      BELLDANDY_BROWSER_ALLOWED_DOMAINS: "github.com,developer.mozilla.org",
      BELLDANDY_BROWSER_DENIED_DOMAINS: "mail.google.com",
      BELLDANDY_AGENT_BRIDGE_ENABLED: "true",
      BELLDANDY_TOOL_GROUPS: "browser,system",
      BELLDANDY_MAX_INPUT_TOKENS: "20000",
      BELLDANDY_MAX_OUTPUT_TOKENS: "8192",
      BELLDANDY_MEMORY_ENABLED: "false",
      BELLDANDY_EMBEDDING_ENABLED: "true",
      BELLDANDY_EMBEDDING_PROVIDER: "local",
      BELLDANDY_EMBEDDING_OPENAI_BASE_URL: "https://embedding.example.com/v1",
      BELLDANDY_EMBEDDING_MODEL: "text-embedding-3-small",
      BELLDANDY_LOCAL_EMBEDDING_MODEL: "BAAI/bge-m3",
      BELLDANDY_EMBEDDING_BATCH_SIZE: "4",
      BELLDANDY_CONTEXT_INJECTION: "false",
      BELLDANDY_CONTEXT_INJECTION_LIMIT: "7",
      BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "true",
      BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT: "4",
      BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES: "preference,fact,experience",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "false",
      BELLDANDY_AUTO_RECALL_ENABLED: "true",
      BELLDANDY_AUTO_RECALL_LIMIT: "5",
      BELLDANDY_AUTO_RECALL_MIN_SCORE: "0.42",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "9000",
      BELLDANDY_MIND_PROFILE_RUNTIME_ENABLED: "false",
      BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINES: "6",
      BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINE_LENGTH: "140",
      BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS: "480",
      BELLDANDY_MIND_PROFILE_RUNTIME_MIN_SIGNAL_COUNT: "3",
      BELLDANDY_MEMORY_SUMMARY_ENABLED: "true",
      BELLDANDY_MEMORY_SUMMARY_MODEL: "qwen-plus",
      BELLDANDY_MEMORY_SUMMARY_BASE_URL: "https://memory-summary.example.com/v1",
      BELLDANDY_MEMORY_SUMMARY_API_KEY: "summary-dedicated-key",
      BELLDANDY_MEMORY_EVOLUTION_ENABLED: "true",
      BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES: "8",
      BELLDANDY_MEMORY_EVOLUTION_MODEL: "qwen-max",
      BELLDANDY_MEMORY_EVOLUTION_BASE_URL: "https://memory-evolution.example.com/v1",
      BELLDANDY_MEMORY_EVOLUTION_API_KEY: "evolution-dedicated-key",
      BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "2",
      BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS: "1200000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS: "3",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS: "3600000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_PENDING_MESSAGES: "6",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_MESSAGE_DELTA: "4",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_SUCCESS_COOLDOWN_MS: "300000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MS: "5000",
      BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MAX_MS: "600000",
      BELLDANDY_TEAM_SHARED_MEMORY_ENABLED: "true",
      BELLDANDY_SHARED_REVIEW_CLAIM_TIMEOUT_MS: "5400000",
      BELLDANDY_TASK_MEMORY_ENABLED: "true",
      BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED: "true",
      BELLDANDY_TASK_SUMMARY_ENABLED: "true",
      BELLDANDY_TASK_SUMMARY_MODEL: "moonshot-v1-32k",
      BELLDANDY_TASK_SUMMARY_BASE_URL: "https://task-summary.example.com/v1",
      BELLDANDY_TASK_SUMMARY_API_KEY: "task-summary-dedicated-key",
      BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS: "30000",
      BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS: "3",
      BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL: "4000",
      BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED: "false",
      BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED: "false",
      BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED: "true",
      BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED: "true",
      BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED: "false",
      BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED: "true",
      BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED: "true",
      BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES: "8",
      BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS: "1600",
      BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET: "10000",
      BELLDANDY_MEMORY_DEEP_RETRIEVAL: "true",
      BELLDANDY_MEMORY_NODE_ASSISTED_RETRIEVAL: "true",
      BELLDANDY_EMBEDDING_QUERY_PREFIX: "query:",
      BELLDANDY_EMBEDDING_PASSAGE_PREFIX: "passage:",
      BELLDANDY_RERANKER_MIN_SCORE: "0.2",
      BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR: "500",
      BELLDANDY_MEMORY_INDEXER_VERBOSE_WATCH: "true",
      BELLDANDY_TASK_DEDUP_GUARD_ENABLED: "false",
      BELLDANDY_TASK_DEDUP_WINDOW_MINUTES: "30",
      BELLDANDY_TASK_DEDUP_MODE: "strict",
      BELLDANDY_TASK_DEDUP_POLICY: "run_command:off,file_write:hard-block",
      BELLDANDY_CRON_ENABLED: "true",
      BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
      BELLDANDY_EMAIL_DEFAULT_PROVIDER: "smtp",
      BELLDANDY_EMAIL_SMTP_ENABLED: "true",
      BELLDANDY_EMAIL_SMTP_ACCOUNT_ID: "default",
      BELLDANDY_EMAIL_SMTP_HOST: "smtp.example.com",
      BELLDANDY_EMAIL_SMTP_PORT: "587",
      BELLDANDY_EMAIL_SMTP_SECURE: "false",
      BELLDANDY_EMAIL_SMTP_USER: "mailer@example.com",
      BELLDANDY_EMAIL_SMTP_PASS: "smtp-app-pass",
      BELLDANDY_EMAIL_SMTP_FROM_ADDRESS: "mailer@example.com",
      BELLDANDY_EMAIL_SMTP_FROM_NAME: "Belldandy",
      BELLDANDY_EMAIL_INBOUND_AGENT_ID: "researcher",
      BELLDANDY_EMAIL_IMAP_ENABLED: "false",
      BELLDANDY_EMAIL_IMAP_ACCOUNT_ID: "mailbox-1",
      BELLDANDY_EMAIL_IMAP_HOST: "imap.example.com",
      BELLDANDY_EMAIL_IMAP_PORT: "993",
      BELLDANDY_EMAIL_IMAP_SECURE: "true",
      BELLDANDY_EMAIL_IMAP_USER: "reader@example.com",
      BELLDANDY_EMAIL_IMAP_PASS: "imap-app-pass",
      BELLDANDY_EMAIL_IMAP_MAILBOX: "INBOX",
      BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS: "60000",
      BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS: "10000",
      BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS: "20000",
      BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE: "latest",
      BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT: "50",
      BELLDANDY_CHANNEL_ROUTER_ENABLED: "true",
      BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH: "~/.star_sanctuary/channels-routing.json",
      BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID: "default",
      BELLDANDY_COMMUNITY_API_ENABLED: "false",
      BELLDANDY_COMMUNITY_API_TOKEN: "community-token",
      BELLDANDY_FEISHU_APP_ID: "cli_test_app",
      BELLDANDY_FEISHU_APP_SECRET: "feishu-secret",
      BELLDANDY_FEISHU_AGENT_ID: "researcher",
      BELLDANDY_QQ_APP_ID: "qq-app-id",
      BELLDANDY_QQ_APP_SECRET: "qq-secret",
      BELLDANDY_QQ_AGENT_ID: "researcher",
      BELLDANDY_QQ_SANDBOX: "false",
      BELLDANDY_DISCORD_ENABLED: "true",
      BELLDANDY_DISCORD_BOT_TOKEN: "discord-secret",
      BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID: "123456789012345678",
      BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "65536",
      BELLDANDY_WEBHOOK_PREAUTH_TIMEOUT_MS: "5000",
      BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS: "60000",
      BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "120",
      BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_TRACKED_KEYS: "4096",
      BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY: "8",
      BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_TRACKED_KEYS: "4096",
      BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED: "true",
      BELLDANDY_TOKEN_USAGE_UPLOAD_URL: "http://127.0.0.1:3001/api/internal/token-usage",
      BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY: "gro_token_key",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS: "3000",
      BELLDANDY_TOKEN_USAGE_STRICT_UUID: "true",
      BELLDANDY_AUTO_TASK_TIME_ENABLED: "true",
      BELLDANDY_AUTO_TASK_TOKEN_ENABLED: "false",
      BELLDANDY_WEBHOOK_CONFIG_PATH: "~/.star_sanctuary/webhooks.json",
      BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS: "600000",
      BELLDANDY_STATE_DIR: "~/.star_sanctuary",
      BELLDANDY_STATE_DIR_WINDOWS: "C:/Users/admin/.star_sanctuary",
      BELLDANDY_STATE_DIR_WSL: "~/.star_sanctuary",
      BELLDANDY_WORKSPACE_DIR: "./workspace",
      BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/tools,D:/projects",
      BELLDANDY_WEB_ROOT: "apps/web/public",
      BELLDANDY_PROMPT_FOCUS_ENABLED: "false",
      BELLDANDY_PROMPT_FOCUS_SEMANTIC_ENABLED: "true",
      BELLDANDY_PROMPT_FOCUS_SEMANTIC_MIN_SCORE: "0.35",
      BELLDANDY_LOG_LEVEL: "info",
      BELLDANDY_LOG_CONSOLE: "true",
      BELLDANDY_LOG_FILE: "true",
      BELLDANDY_LOG_DIR: "~/.star_sanctuary/logs",
      BELLDANDY_LOG_MAX_SIZE: "10MB",
      BELLDANDY_LOG_RETENTION_DAYS: "7",
      BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED: "true",
      BELLDANDY_DREAM_AUTO_CRON_ENABLED: "false",
      BELLDANDY_DREAM_OPENAI_THINKING: "disabled",
      BELLDANDY_DREAM_OPENAI_REASONING_EFFORT: "",
      BELLDANDY_DREAM_OPENAI_TIMEOUT_MS: "120000",
      BELLDANDY_DREAM_OPENAI_MAX_TOKENS: "1000",
      BELLDANDY_DREAM_OBSIDIAN_ENABLED: "true",
      BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH: "C:/Vault",
      BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR: "Dream",
      BELLDANDY_COMMONS_OBSIDIAN_ENABLED: "true",
      BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH: "C:/Vault",
      BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR: "Commons",
      BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND: "node",
      BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON: '["helper.js"]',
      BELLDANDY_CAMERA_NATIVE_HELPER_CWD: "E:/project/star-sanctuary",
      BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS: "10000",
      BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS: "15000",
      BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS: "2000",
      BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON: '{"FOO":"bar"}',
      BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_COMMAND: "powershell.exe",
      BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_ARGS_JSON: "[]",
      BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND: "C:/ffmpeg/bin/ffmpeg.exe",
      BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON: '["-hide_banner"]',
    });
    expect(restartCall?.[0]?.params).toMatchObject({
      reason: "settings updated",
    });
  });

  it("loads final cleanup prompt and multimedia settings", async () => {
    const loadServerConfig = vi.fn().mockResolvedValue({
      BELLDANDY_MAX_SYSTEM_PROMPT_CHARS: "70000",
      BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS: "methodology,context",
      BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES: "methodology:5,extra:150",
      BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS: "apply_patch,run_command",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "48",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "20",
      BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS: "10",
      BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS: "5",
      BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS: "7",
      BELLDANDY_COMPACTION_ENABLED: "true",
      BELLDANDY_COMPACTION_THRESHOLD: "20000",
      BELLDANDY_COMPACTION_KEEP_RECENT: "10",
      BELLDANDY_COMPACTION_TRIGGER_FRACTION: "0.75",
      BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD: "2000",
      BELLDANDY_COMPACTION_WARNING_THRESHOLD: "14000",
      BELLDANDY_COMPACTION_BLOCKING_THRESHOLD: "18000",
      BELLDANDY_COMPACTION_MAX_CONSECUTIVE_FAILURES: "3",
      BELLDANDY_COMPACTION_MAX_PTL_RETRIES: "2",
      BELLDANDY_COMPACTION_CONTEXT_WINDOW_FRACTION: "0.1",
      BELLDANDY_MODEL_CONTEXT_WINDOW: "256000",
      BELLDANDY_COMPRESSION_REFERENCE_STORE: "false",
      BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED: "true",
      BELLDANDY_PREFLIGHT_COMPRESSION_MODE: "attachments",
      BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS: "4000",
      BELLDANDY_PREFLIGHT_TARGET_RATIO: "0.5",
      BELLDANDY_PREFLIGHT_MIN_SAVINGS_RATIO: "0.2",
      BELLDANDY_PREFLIGHT_TIMEOUT_MS: "2500",
      BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE: "sidecar",
      BELLDANDY_PREFLIGHT_SIDECAR_RETENTION_MS: "604800000",
      BELLDANDY_PREFLIGHT_SIDECAR_MAX_ENTRIES: "512",
      BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_STORE: "true",
      BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_TTL_MS: "86400000",
      BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_MAX_ENTRIES: "64",
      BELLDANDY_BUDGET_PROTECT_MODE: "history_first",
      BELLDANDY_BUDGET_PROTECT_KEEP_RECENT_ROUNDS: "5",
      BELLDANDY_STABLE_PREFIX_SPLIT: "true",
      BELLDANDY_COMPACTION_MODEL_ROUTE: "compact-fallback",
      BELLDANDY_COMPACTION_MODEL: "gpt-4o-mini",
      BELLDANDY_COMPACTION_BASE_URL: "https://compaction.example.com/v1",
      BELLDANDY_COMPACTION_API_KEY: "[REDACTED]",
      BELLDANDY_TOOL_LOOP_ITERATION_BUDGET: "8",
      BELLDANDY_TOOL_LOOP_WARNING_FRACTION: "0.75",
      BELLDANDY_WEB_ALLOW_PRIVILEGED_SAFE_SCOPE: "true",
      BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS: "gateway,cli,web",
      BELLDANDY_DANGEROUS_TOOLS_ENABLED: "true",
      BELLDANDY_TOOLS_POLICY_FILE: "~/.star_sanctuary/tools-policy.json",
      BELLDANDY_SUB_AGENT_MAX_CONCURRENT: "3",
      BELLDANDY_SUB_AGENT_MAX_QUEUE_SIZE: "10",
      BELLDANDY_SUB_AGENT_TIMEOUT_MS: "120000",
      BELLDANDY_SUB_AGENT_MAX_DEPTH: "2",
      BELLDANDY_WORKFLOW_MAX_CONCURRENT: "6",
      BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE: "20",
      BELLDANDY_WORKFLOW_TIMEOUT_MS: "600000",
      BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS: "300000",
      BELLDANDY_WORKFLOW_MAX_AGENT_CALLS: "50",
      BELLDANDY_WORKFLOW_MAX_DEPTH: "2",
      BELLDANDY_IMAGE_ENABLED: "true",
      BELLDANDY_IMAGE_PROVIDER: "openai",
      BELLDANDY_IMAGE_OPENAI_API_KEY: "[REDACTED]",
      BELLDANDY_IMAGE_OPENAI_BASE_URL: "https://api.openai.com/v1",
      BELLDANDY_IMAGE_MODEL: "gpt-image-2",
      BELLDANDY_IMAGE_OUTPUT_FORMAT: "png",
      BELLDANDY_IMAGE_TIMEOUT_MS: "60000",
      BELLDANDY_IMAGE_UNDERSTAND_ENABLED: "true",
      BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY: "[REDACTED]",
      BELLDANDY_IMAGE_UNDERSTAND_PROVIDER: "openai",
      BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL: "https://vision.example.com/v1",
      BELLDANDY_IMAGE_UNDERSTAND_MODEL: "gpt-4.1-mini",
      BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS: "45000",
      BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB: "20",
      BELLDANDY_IMAGE_UNDERSTAND_PROMPT: "Describe the image precisely",
      BELLDANDY_IMAGE_UNDERSTAND_AUTO_ON_ATTACHMENT: "false",
      BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND: "false",
      BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND: "true",
      BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND: "false",
      BELLDANDY_VIDEO_UNDERSTAND_ENABLED: "true",
      BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY: "[REDACTED]",
      BELLDANDY_VIDEO_UNDERSTAND_PROVIDER: "openai",
      BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL: "https://video.example.com/v1",
      BELLDANDY_VIDEO_UNDERSTAND_MODEL: "kimi-k2.5",
      BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS: "90000",
      BELLDANDY_VIDEO_UNDERSTAND_TRANSPORT: "inline_data_url",
      BELLDANDY_VIDEO_UNDERSTAND_FPS: "3",
      BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB: "64",
      BELLDANDY_VIDEO_UNDERSTAND_PROMPT: "Summarize key events",
      BELLDANDY_VIDEO_UNDERSTAND_AUTO_ON_ATTACHMENT: "true",
      BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS: "7",
      BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT: "1200",
      BELLDANDY_STT_PROVIDER: "groq",
      BELLDANDY_STT_MODEL: "whisper-large-v3-turbo",
      BELLDANDY_STT_LANGUAGE: "zh",
      BELLDANDY_STT_OPENAI_API_KEY: "[REDACTED]",
      BELLDANDY_STT_OPENAI_BASE_URL: "https://audio.example.com/v1",
      BELLDANDY_STT_GROQ_API_KEY: "[REDACTED]",
      BELLDANDY_STT_GROQ_BASE_URL: "https://api.groq.com/openai/v1",
      BELLDANDY_QQ_STT_FALLBACK_PROVIDERS: "openai,dashscope",
      BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED: "true",
      BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR: "H:\\.star_sanctuary\\storage\\qq-event-samples",
      BELLDANDY_ROOM_INJECT_THRESHOLD: "10",
      BELLDANDY_ROOM_MEMBERS_CACHE_TTL: "300000",
    });
    const { controller, refs } = createController({ loadServerConfig });

    await controller.loadConfig();

    expect(refs.cfgMaxSystemPromptChars.value).toBe("70000");
    expect(refs.cfgPromptExperimentDisableSections.value).toBe("methodology,context");
    expect(refs.cfgPromptSnapshotRetentionDays.value).toBe("7");
    expect(refs.cfgCompactionEnabled.checked).toBe(true);
    expect(refs.cfgCompactionContextWindowFraction.value).toBe("0.1");
    expect(refs.cfgModelContextWindow.value).toBe("256000");
    expect(refs.cfgCompressionReferenceStore.checked).toBe(false);
    expect(refs.cfgPreflightCompressionEnabled.checked).toBe(true);
    expect(refs.cfgPreflightCompressionMode.value).toBe("attachments");
    expect(refs.cfgPreflightAttachmentThresholdChars.value).toBe("4000");
    expect(refs.cfgPreflightAttachmentReference.value).toBe("sidecar");
    expect(refs.cfgPreflightSidecarRetentionMs.value).toBe("604800000");
    expect(refs.cfgPreflightSidecarMaxEntries.value).toBe("512");
    expect(refs.cfgCompressionPersistentReferenceStore.checked).toBe(true);
    expect(refs.cfgCompressionPersistentReferenceTtlMs.value).toBe("86400000");
    expect(refs.cfgCompressionPersistentReferenceMaxEntries.value).toBe("64");
    expect(refs.cfgBudgetProtectMode.value).toBe("history_first");
    expect(refs.cfgBudgetProtectKeepRecentRounds.value).toBe("5");
    expect(refs.cfgStablePrefixSplit.checked).toBe(true);
    expect(refs.cfgCompactionModelRoute.value).toBe("compact-fallback");
    expect(refs.cfgCompactionBaseUrl.value).toBe("https://compaction.example.com/v1");
    expect(refs.cfgCompactionApiKey.value).toBe("[REDACTED]");
    expect(refs.cfgToolLoopIterationBudget.value).toBe("8");
    expect(refs.cfgToolLoopWarningFraction.value).toBe("0.75");
    expect(refs.cfgWebAllowPrivilegedSafeScope.checked).toBe(true);
    expect(refs.cfgPrivilegedWorkspaceWriteChannels.value).toBe("gateway,cli,web");
    expect(refs.cfgDangerousToolsEnabled.checked).toBe(true);
    expect(refs.cfgToolsPolicyFile.value).toBe("~/.star_sanctuary/tools-policy.json");
    expect(refs.cfgSubAgentMaxDepth.value).toBe("2");
    expect(refs.cfgWorkflowMaxConcurrent.value).toBe("6");
    expect(refs.cfgWorkflowMaxQueueSize.value).toBe("20");
    expect(refs.cfgWorkflowTimeoutMs.value).toBe("600000");
    expect(refs.cfgWorkflowAgentTimeoutMs.value).toBe("300000");
    expect(refs.cfgWorkflowMaxAgentCalls.value).toBe("50");
    expect(refs.cfgWorkflowMaxDepth.value).toBe("2");
    expect(refs.cfgImageEnabled.checked).toBe(true);
    expect(refs.cfgImageApiKey.value).toBe("[REDACTED]");
    expect(refs.cfgImageUnderstandEnabled.checked).toBe(true);
    expect(refs.cfgImageUnderstandApiKey.value).toBe("[REDACTED]");
    expect(refs.cfgImageUnderstandProvider.value).toBe("openai");
    expect(refs.cfgImageUnderstandBaseUrl.value).toBe("https://vision.example.com/v1");
    expect(refs.cfgImageUnderstandModel.value).toBe("gpt-4.1-mini");
    expect(refs.cfgImageUnderstandTimeoutMs.value).toBe("45000");
    expect(refs.cfgImageUnderstandMaxInputMb.value).toBe("20");
    expect(refs.cfgImageUnderstandPrompt.value).toBe("Describe the image precisely");
    expect(refs.cfgImageUnderstandAutoOnAttachment.checked).toBe(false);
    expect(refs.cfgBrowserScreenshotAutoUnderstand.checked).toBe(false);
    expect(refs.cfgCameraSnapAutoUnderstand.checked).toBe(true);
    expect(refs.cfgScreenCaptureAutoUnderstand.checked).toBe(false);
    expect(refs.cfgVideoUnderstandEnabled.checked).toBe(true);
    expect(refs.cfgVideoUnderstandApiKey.value).toBe("[REDACTED]");
    expect(refs.cfgVideoUnderstandProvider.value).toBe("openai");
    expect(refs.cfgVideoUnderstandBaseUrl.value).toBe("https://video.example.com/v1");
    expect(refs.cfgVideoUnderstandModel.value).toBe("kimi-k2.5");
    expect(refs.cfgVideoUnderstandTimeoutMs.value).toBe("90000");
    expect(refs.cfgVideoUnderstandTransport.value).toBe("inline_data_url");
    expect(refs.cfgVideoUnderstandFps.value).toBe("3");
    expect(refs.cfgVideoUnderstandMaxInputMb.value).toBe("64");
    expect(refs.cfgVideoUnderstandPrompt.value).toBe("Summarize key events");
    expect(refs.cfgVideoUnderstandAutoOnAttachment.checked).toBe(true);
    expect(refs.cfgVideoUnderstandAutoAttachmentMaxTimelineItems.value).toBe("7");
    expect(refs.cfgVideoUnderstandAutoAttachmentSummaryCharLimit.value).toBe("1200");
    expect(refs.cfgSttProvider.value).toBe("groq");
    expect(refs.cfgSttModel.value).toBe("whisper-large-v3-turbo");
    expect(refs.cfgSttOpenAiApiKey.value).toBe("[REDACTED]");
    expect(refs.cfgSttOpenAiBaseUrl.value).toBe("https://audio.example.com/v1");
    expect(refs.cfgSttGroqApiKey.value).toBe("[REDACTED]");
    expect(refs.cfgQqSttFallbackProviders.value).toBe("openai,dashscope");
    expect(refs.cfgQqEventSampleCaptureEnabled.checked).toBe(true);
    expect(refs.cfgQqEventSampleCaptureDir.value).toBe("H:\\.star_sanctuary\\storage\\qq-event-samples");
    expect(refs.cfgRoomInjectThreshold.value).toBe("10");
    expect(refs.cfgRoomMembersCacheTtl.value).toBe("300000");
  });

  it("updates runtime governance detail mode after saving system settings", async () => {
    const refs = createSettingsRefs({
      cfgGovernanceDetailMode: createInput("full"),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: {} };
        case "models.config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        case "system.restart":
          return { ok: true, payload: {} };
        default:
          return { ok: true, payload: {} };
      }
    });
    const eventSpy = vi.fn();
    const originalConfig = globalThis.BELLDANDY_WEB_CONFIG;
    const originalDispatchEvent = globalThis.dispatchEvent;
    const originalCustomEvent = globalThis.CustomEvent;
    globalThis.BELLDANDY_WEB_CONFIG = { governanceDetailMode: "compact" };
    globalThis.dispatchEvent = eventSpy;
    globalThis.CustomEvent = class CustomEventMock {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
    const { controller } = createController({
      refs,
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: "compact",
      }),
    });

    try {
      await controller.loadConfig();
      refs.cfgGovernanceDetailMode.value = "full";
      await controller.saveConfig();
      expect(globalThis.BELLDANDY_WEB_CONFIG.governanceDetailMode).toBe("full");
      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy.mock.calls[0]?.[0]?.type).toBe("belldandy:governance-detail-mode-changed");
      expect(eventSpy.mock.calls[0]?.[0]?.detail?.governanceDetailMode).toBe("full");
      const restartCall = sendReq.mock.calls.find(([frame]) => frame.method === "system.restart");
      expect(restartCall).toBeUndefined();
    } finally {
      globalThis.BELLDANDY_WEB_CONFIG = originalConfig;
      globalThis.dispatchEvent = originalDispatchEvent;
      globalThis.CustomEvent = originalCustomEvent;
    }
  });

  it("loads and saves commander governance defaults through system settings", async () => {
    const refs = createSettingsRefs({
      cfgCommanderMode: createInput("auto"),
      cfgCommanderAgentId: createInput(""),
      cfgGoalExecutionMode: createInput("auto"),
      cfgGoalGovernanceMode: createInput("auto"),
      cfgCommanderAutoReworkEnabled: createCheckbox(false),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: {} };
        case "models.config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        case "system.restart":
          return { ok: true, payload: {} };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({
      refs,
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_COMMANDER_MODE: "on",
        BELLDANDY_COMMANDER_AGENT_ID: "commander-main",
        BELLDANDY_GOAL_EXECUTION_MODE: "multi_agent_parallel",
        BELLDANDY_GOAL_GOVERNANCE_MODE: "commander",
        BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED: "true",
      }),
    });

    await controller.loadConfig();
    expect(refs.cfgCommanderMode.value).toBe("on");
    expect(refs.cfgCommanderAgentId.value).toBe("commander-main");
    expect(refs.cfgGoalExecutionMode.value).toBe("multi_agent_parallel");
    expect(refs.cfgGoalGovernanceMode.value).toBe("commander");
    expect(refs.cfgCommanderAutoReworkEnabled.checked).toBe(true);

    refs.cfgCommanderMode.value = "off";
    refs.cfgCommanderAgentId.value = "commander-2";
    refs.cfgGoalExecutionMode.value = "single_agent";
    refs.cfgGoalGovernanceMode.value = "direct";
    refs.cfgCommanderAutoReworkEnabled.checked = false;
    await controller.saveConfig();

    const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    expect(updateCall?.[0]?.params?.updates).toMatchObject({
      BELLDANDY_COMMANDER_MODE: "off",
      BELLDANDY_COMMANDER_AGENT_ID: "commander-2",
      BELLDANDY_GOAL_EXECUTION_MODE: "single_agent",
      BELLDANDY_GOAL_GOVERNANCE_MODE: "direct",
      BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED: "false",
    });
    const restartCall = sendReq.mock.calls.find(([frame]) => frame.method === "system.restart");
    expect(restartCall).toBeUndefined();
  });

  it("loads and updates runtime experience draft notice mode after saving system settings", async () => {
    const refs = createSettingsRefs({
      cfgExperienceDraftGenerateNoticeEnabled: createCheckbox(false),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: {} };
        case "models.config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        case "system.restart":
          return { ok: true, payload: {} };
        default:
          return { ok: true, payload: {} };
      }
    });
    const eventSpy = vi.fn();
    const originalConfig = globalThis.BELLDANDY_WEB_CONFIG;
    const originalDispatchEvent = globalThis.dispatchEvent;
    const originalCustomEvent = globalThis.CustomEvent;
    globalThis.BELLDANDY_WEB_CONFIG = { experienceDraftGenerateNoticeEnabled: false };
    globalThis.dispatchEvent = eventSpy;
    globalThis.CustomEvent = class CustomEventMock {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
    const { controller } = createController({
      refs,
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED: "false",
      }),
    });

    try {
      await controller.loadConfig();
      expect(refs.cfgExperienceDraftGenerateNoticeEnabled.checked).toBe(false);
      refs.cfgExperienceDraftGenerateNoticeEnabled.checked = true;
      await controller.saveConfig();
      expect(globalThis.BELLDANDY_WEB_CONFIG.experienceDraftGenerateNoticeEnabled).toBe(true);
      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy.mock.calls[0]?.[0]?.type).toBe("belldandy:experience-draft-notice-mode-changed");
      expect(eventSpy.mock.calls[0]?.[0]?.detail?.experienceDraftGenerateNoticeEnabled).toBe(true);
      const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
      expect(updateCall?.[0]?.params?.updates?.BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED).toBe("true");
      const restartCall = sendReq.mock.calls.find(([frame]) => frame.method === "system.restart");
      expect(restartCall).toBeUndefined();
    } finally {
      globalThis.BELLDANDY_WEB_CONFIG = originalConfig;
      globalThis.dispatchEvent = originalDispatchEvent;
      globalThis.CustomEvent = originalCustomEvent;
    }
  });

  it("still auto restarts after saving non-frontend-only settings", async () => {
    const refs = createSettingsRefs({
      cfgHost: createInput("0.0.0.0"),
      cfgGovernanceDetailMode: createInput("full"),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: { restartRequired: true } };
        case "models.config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        case "system.restart":
          return { ok: true, payload: {} };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({
      refs,
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: "compact",
      }),
    });

    await controller.loadConfig();
    refs.cfgHost.value = "0.0.0.0";
    refs.cfgGovernanceDetailMode.value = "full";
    await controller.saveConfig();

    const restartCall = sendReq.mock.calls.find(([frame]) => frame.method === "system.restart");
    expect(restartCall?.[0]?.params).toMatchObject({
      reason: "settings updated",
    });
  });

  it("skips auto restart after saving hot-reload multimedia and attachment settings", async () => {
    const refs = createSettingsRefs({
      cfgAttachmentMaxFileBytes: createInput("2048"),
      cfgTtsProvider: createInput("openai"),
      cfgImageEnabled: createCheckbox(true),
      cfgExternalOutboundRequireConfirmation: createCheckbox(false),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: {} };
        case "models.config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        case "system.restart":
          return { ok: true, payload: {} };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({
      refs,
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "1024",
        BELLDANDY_TTS_PROVIDER: "edge",
        BELLDANDY_IMAGE_ENABLED: "false",
        BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
      }),
    });

    await controller.loadConfig();
    refs.cfgAttachmentMaxFileBytes.value = "2048";
    refs.cfgTtsProvider.value = "openai";
    refs.cfgImageEnabled.checked = true;
    refs.cfgExternalOutboundRequireConfirmation.checked = false;
    await controller.saveConfig();

    const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    expect(updateCall?.[0]?.params?.updates).toMatchObject({
      BELLDANDY_ATTACHMENT_MAX_FILE_BYTES: "2048",
      BELLDANDY_TTS_PROVIDER: "openai",
      BELLDANDY_IMAGE_ENABLED: "true",
      BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "false",
    });
    const restartCall = sendReq.mock.calls.find(([frame]) => frame.method === "system.restart");
    expect(restartCall).toBeUndefined();
  });

  it("skips auto restart after saving community api and webhook guard settings", async () => {
    const refs = createSettingsRefs({
      cfgCommunityApiEnabled: createCheckbox(true),
      cfgCommunityApiToken: createInput("community-secret"),
      cfgWebhookPreauthMaxBytes: createInput("2048"),
      cfgWebhookRateLimitMaxRequests: createInput("5"),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: {} };
        case "models.config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        case "system.restart":
          return { ok: true, payload: {} };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({
      refs,
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_AUTH_MODE: "token",
        BELLDANDY_COMMUNITY_API_ENABLED: "false",
        BELLDANDY_COMMUNITY_API_TOKEN: "",
        BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "65536",
        BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "120",
      }),
    });

    await controller.loadConfig();
    refs.cfgCommunityApiEnabled.checked = true;
    refs.cfgCommunityApiToken.value = "community-secret";
    refs.cfgWebhookPreauthMaxBytes.value = "2048";
    refs.cfgWebhookRateLimitMaxRequests.value = "5";
    await controller.saveConfig();

    const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    expect(updateCall?.[0]?.params?.updates).toMatchObject({
      BELLDANDY_COMMUNITY_API_ENABLED: "true",
      BELLDANDY_COMMUNITY_API_TOKEN: "community-secret",
      BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "2048",
      BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "5",
    });
    const restartCall = sendReq.mock.calls.find(([frame]) => frame.method === "system.restart");
    expect(restartCall).toBeUndefined();
  });

  it("saves final cleanup prompt and multimedia settings", async () => {
    const refs = createSettingsRefs({
      cfgMaxSystemPromptChars: createInput(" 70000 "),
      cfgPromptExperimentDisableSections: createInput(" methodology,context "),
      cfgPromptExperimentSectionPriorityOverrides: createInput(" methodology:5,extra:150 "),
      cfgPromptExperimentDisableToolContracts: createInput(" apply_patch,run_command "),
      cfgPromptSnapshotMaxRuns: createInput("48"),
      cfgPromptSnapshotMaxPersistedRuns: createInput("20"),
      cfgPromptSnapshotEmailThreadMaxRuns: createInput("10"),
      cfgPromptSnapshotHeartbeatMaxRuns: createInput("5"),
      cfgPromptSnapshotRetentionDays: createInput("7"),
      cfgCompactionEnabled: createCheckbox(true),
      cfgCompactionThreshold: createInput("20000"),
      cfgCompactionKeepRecent: createInput("10"),
      cfgCompactionTriggerFraction: createInput("0.75"),
      cfgCompactionArchivalThreshold: createInput("2000"),
      cfgCompactionWarningThreshold: createInput("14000"),
      cfgCompactionBlockingThreshold: createInput("18000"),
      cfgCompactionMaxConsecutiveFailures: createInput("3"),
      cfgCompactionMaxPtlRetries: createInput("2"),
      cfgCompactionContextWindowFraction: createInput(" 0.1 "),
      cfgModelContextWindow: createInput(" 256000 "),
      cfgCompressionReferenceStore: createCheckbox(false),
      cfgPreflightCompressionEnabled: createCheckbox(true),
      cfgPreflightCompressionMode: createInput(" attachments "),
      cfgPreflightAttachmentThresholdChars: createInput(" 4000 "),
      cfgPreflightTargetRatio: createInput(" 0.5 "),
      cfgPreflightMinSavingsRatio: createInput(" 0.2 "),
      cfgPreflightTimeoutMs: createInput(" 2500 "),
      cfgPreflightAttachmentReference: createInput(" sidecar "),
      cfgPreflightSidecarRetentionMs: createInput(" 604800000 "),
      cfgPreflightSidecarMaxEntries: createInput(" 512 "),
      cfgCompressionPersistentReferenceStore: createCheckbox(true),
      cfgCompressionPersistentReferenceTtlMs: createInput(" 86400000 "),
      cfgCompressionPersistentReferenceMaxEntries: createInput(" 64 "),
      cfgBudgetProtectMode: createInput(" history_first "),
      cfgBudgetProtectKeepRecentRounds: createInput(" 5 "),
      cfgStablePrefixSplit: createCheckbox(true),
      cfgCompactionModelRoute: createInput(" compact-fallback "),
      cfgCompactionModel: createInput(" gpt-4o-mini "),
      cfgCompactionBaseUrl: createInput(" https://compaction.example.com/v1 "),
      cfgCompactionApiKey: createInput("compaction-secret"),
      cfgToolLoopIterationBudget: createInput(" 8 "),
      cfgToolLoopWarningFraction: createInput(" 0.75 "),
      cfgWebAllowPrivilegedSafeScope: createCheckbox(true),
      cfgPrivilegedWorkspaceWriteChannels: createInput(" gateway,cli,web "),
      cfgDangerousToolsEnabled: createCheckbox(true),
      cfgToolsPolicyFile: createInput(" ~/.star_sanctuary/tools-policy.json "),
      cfgSubAgentMaxConcurrent: createInput("3"),
      cfgSubAgentMaxQueueSize: createInput("10"),
      cfgSubAgentTimeoutMs: createInput("120000"),
      cfgSubAgentMaxDepth: createInput("2"),
      cfgWorkflowMaxConcurrent: createInput("6"),
      cfgWorkflowMaxQueueSize: createInput("20"),
      cfgWorkflowTimeoutMs: createInput("600000"),
      cfgWorkflowAgentTimeoutMs: createInput("300000"),
      cfgWorkflowMaxAgentCalls: createInput("50"),
      cfgWorkflowMaxDepth: createInput("2"),
      cfgImageEnabled: createCheckbox(true),
      cfgImageProvider: createInput(" openai "),
      cfgImageApiKey: createInput("image-secret"),
      cfgImageBaseUrl: createInput(" https://api.openai.com/v1 "),
      cfgImageModel: createInput(" gpt-image-2 "),
      cfgImageOutputFormat: createInput(" png "),
      cfgImageTimeoutMs: createInput("60000"),
      cfgImageUnderstandEnabled: createCheckbox(true),
      cfgImageUnderstandApiKey: createInput("vision-secret"),
      cfgImageUnderstandProvider: createInput(" openai "),
      cfgImageUnderstandBaseUrl: createInput(" https://vision.example.com/v1 "),
      cfgImageUnderstandModel: createInput(" gpt-4.1-mini "),
      cfgImageUnderstandTimeoutMs: createInput("45000"),
      cfgImageUnderstandMaxInputMb: createInput(" 20 "),
      cfgImageUnderstandPrompt: createInput(" Describe the image precisely "),
      cfgImageUnderstandAutoOnAttachment: createCheckbox(false),
      cfgBrowserScreenshotAutoUnderstand: createCheckbox(false),
      cfgCameraSnapAutoUnderstand: createCheckbox(true),
      cfgScreenCaptureAutoUnderstand: createCheckbox(false),
      cfgVideoUnderstandEnabled: createCheckbox(true),
      cfgVideoUnderstandApiKey: createInput("video-secret"),
      cfgVideoUnderstandProvider: createInput(" openai "),
      cfgVideoUnderstandBaseUrl: createInput(" https://video.example.com/v1 "),
      cfgVideoUnderstandModel: createInput(" kimi-k2.5 "),
      cfgVideoUnderstandTimeoutMs: createInput("90000"),
      cfgVideoUnderstandTransport: createInput(" inline_data_url "),
      cfgVideoUnderstandFps: createInput(" 3 "),
      cfgVideoUnderstandMaxInputMb: createInput(" 64 "),
      cfgVideoUnderstandPrompt: createInput(" Summarize key events "),
      cfgVideoUnderstandAutoOnAttachment: createCheckbox(true),
      cfgVideoUnderstandAutoAttachmentMaxTimelineItems: createInput(" 7 "),
      cfgVideoUnderstandAutoAttachmentSummaryCharLimit: createInput(" 1200 "),
      cfgSttProvider: createInput(" groq "),
      cfgSttModel: createInput(" whisper-large-v3-turbo "),
      cfgSttOpenAiApiKey: createInput("stt-openai-secret"),
      cfgSttOpenAiBaseUrl: createInput(" https://audio.example.com/v1 "),
      cfgSttLanguage: createInput(" zh "),
      cfgSttGroqApiKey: createInput("gsk-secret"),
      cfgSttGroqBaseUrl: createInput(" https://api.groq.com/openai/v1 "),
      cfgQqSttFallbackProviders: createInput(" openai,dashscope "),
      cfgQqEventSampleCaptureEnabled: createCheckbox(true),
      cfgQqEventSampleCaptureDir: createInput(" H:\\.star_sanctuary\\storage\\qq-event-samples "),
      cfgWebchatCostBudgetUsd: createInput(" 0.05 "),
      cfgWebchatCostBudgetWarnFraction: createInput(" 0.8 "),
      cfgRoomInjectThreshold: createInput("10"),
      cfgRoomMembersCacheTtl: createInput("300000"),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: { restartRequired: true } };
        case "channel.security.get":
          return { ok: true, payload: { path: "channel-security.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "channel-reply-chunking.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({ refs, sendReq });

    await controller.saveConfig();
    vi.runAllTimers();

    const configUpdateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    expect(configUpdateCall?.[0]?.params?.updates?.BELLDANDY_WEBCHAT_COST_BUDGET_USD).toBe("0.05");
    expect(configUpdateCall?.[0]?.params?.updates?.BELLDANDY_WEBCHAT_COST_BUDGET_WARN_FRACTION).toBe("0.8");

    const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    expect(updateCall?.[0]?.params?.updates).toMatchObject({
      BELLDANDY_MAX_SYSTEM_PROMPT_CHARS: "70000",
      BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS: "methodology,context",
      BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES: "methodology:5,extra:150",
      BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS: "apply_patch,run_command",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "48",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "20",
      BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS: "10",
      BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS: "5",
      BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS: "7",
      BELLDANDY_COMPACTION_ENABLED: "true",
      BELLDANDY_COMPACTION_THRESHOLD: "20000",
      BELLDANDY_COMPACTION_KEEP_RECENT: "10",
      BELLDANDY_COMPACTION_TRIGGER_FRACTION: "0.75",
      BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD: "2000",
      BELLDANDY_COMPACTION_WARNING_THRESHOLD: "14000",
      BELLDANDY_COMPACTION_BLOCKING_THRESHOLD: "18000",
      BELLDANDY_COMPACTION_MAX_CONSECUTIVE_FAILURES: "3",
      BELLDANDY_COMPACTION_MAX_PTL_RETRIES: "2",
      BELLDANDY_COMPACTION_CONTEXT_WINDOW_FRACTION: "0.1",
      BELLDANDY_MODEL_CONTEXT_WINDOW: "256000",
      BELLDANDY_COMPRESSION_REFERENCE_STORE: "false",
      BELLDANDY_PREFLIGHT_COMPRESSION_ENABLED: "true",
      BELLDANDY_PREFLIGHT_COMPRESSION_MODE: "attachments",
      BELLDANDY_PREFLIGHT_ATTACHMENT_THRESHOLD_CHARS: "4000",
      BELLDANDY_PREFLIGHT_TARGET_RATIO: "0.5",
      BELLDANDY_PREFLIGHT_MIN_SAVINGS_RATIO: "0.2",
      BELLDANDY_PREFLIGHT_TIMEOUT_MS: "2500",
      BELLDANDY_PREFLIGHT_ATTACHMENT_REFERENCE: "sidecar",
      BELLDANDY_PREFLIGHT_SIDECAR_RETENTION_MS: "604800000",
      BELLDANDY_PREFLIGHT_SIDECAR_MAX_ENTRIES: "512",
      BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_STORE: "true",
      BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_TTL_MS: "86400000",
      BELLDANDY_COMPRESSION_PERSISTENT_REFERENCE_MAX_ENTRIES: "64",
      BELLDANDY_BUDGET_PROTECT_MODE: "history_first",
      BELLDANDY_BUDGET_PROTECT_KEEP_RECENT_ROUNDS: "5",
      BELLDANDY_STABLE_PREFIX_SPLIT: "true",
      BELLDANDY_COMPACTION_MODEL_ROUTE: "compact-fallback",
      BELLDANDY_COMPACTION_MODEL: "gpt-4o-mini",
      BELLDANDY_COMPACTION_BASE_URL: "https://compaction.example.com/v1",
      BELLDANDY_COMPACTION_API_KEY: "compaction-secret",
      BELLDANDY_TOOL_LOOP_ITERATION_BUDGET: "8",
      BELLDANDY_TOOL_LOOP_WARNING_FRACTION: "0.75",
      BELLDANDY_WEB_ALLOW_PRIVILEGED_SAFE_SCOPE: "true",
      BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS: "gateway,cli,web",
      BELLDANDY_DANGEROUS_TOOLS_ENABLED: "true",
      BELLDANDY_TOOLS_POLICY_FILE: "~/.star_sanctuary/tools-policy.json",
      BELLDANDY_SUB_AGENT_MAX_CONCURRENT: "3",
      BELLDANDY_SUB_AGENT_MAX_QUEUE_SIZE: "10",
      BELLDANDY_SUB_AGENT_TIMEOUT_MS: "120000",
      BELLDANDY_SUB_AGENT_MAX_DEPTH: "2",
      BELLDANDY_WORKFLOW_MAX_CONCURRENT: "6",
      BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE: "20",
      BELLDANDY_WORKFLOW_TIMEOUT_MS: "600000",
      BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS: "300000",
      BELLDANDY_WORKFLOW_MAX_AGENT_CALLS: "50",
      BELLDANDY_WORKFLOW_MAX_DEPTH: "2",
      BELLDANDY_IMAGE_ENABLED: "true",
      BELLDANDY_IMAGE_PROVIDER: "openai",
      BELLDANDY_IMAGE_OPENAI_API_KEY: "image-secret",
      BELLDANDY_IMAGE_OPENAI_BASE_URL: "https://api.openai.com/v1",
      BELLDANDY_IMAGE_MODEL: "gpt-image-2",
      BELLDANDY_IMAGE_OUTPUT_FORMAT: "png",
      BELLDANDY_IMAGE_TIMEOUT_MS: "60000",
      BELLDANDY_IMAGE_UNDERSTAND_ENABLED: "true",
      BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY: "vision-secret",
      BELLDANDY_IMAGE_UNDERSTAND_PROVIDER: "openai",
      BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL: "https://vision.example.com/v1",
      BELLDANDY_IMAGE_UNDERSTAND_MODEL: "gpt-4.1-mini",
      BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS: "45000",
      BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB: "20",
      BELLDANDY_IMAGE_UNDERSTAND_PROMPT: "Describe the image precisely",
      BELLDANDY_IMAGE_UNDERSTAND_AUTO_ON_ATTACHMENT: "false",
      BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND: "false",
      BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND: "true",
      BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND: "false",
      BELLDANDY_VIDEO_UNDERSTAND_ENABLED: "true",
      BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY: "video-secret",
      BELLDANDY_VIDEO_UNDERSTAND_PROVIDER: "openai",
      BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL: "https://video.example.com/v1",
      BELLDANDY_VIDEO_UNDERSTAND_MODEL: "kimi-k2.5",
      BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS: "90000",
      BELLDANDY_VIDEO_UNDERSTAND_TRANSPORT: "inline_data_url",
      BELLDANDY_VIDEO_UNDERSTAND_FPS: "3",
      BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB: "64",
      BELLDANDY_VIDEO_UNDERSTAND_PROMPT: "Summarize key events",
      BELLDANDY_VIDEO_UNDERSTAND_AUTO_ON_ATTACHMENT: "true",
      BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS: "7",
      BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT: "1200",
      BELLDANDY_STT_PROVIDER: "groq",
      BELLDANDY_STT_MODEL: "whisper-large-v3-turbo",
      BELLDANDY_STT_OPENAI_API_KEY: "stt-openai-secret",
      BELLDANDY_STT_OPENAI_BASE_URL: "https://audio.example.com/v1",
      BELLDANDY_STT_LANGUAGE: "zh",
      BELLDANDY_STT_GROQ_API_KEY: "gsk-secret",
      BELLDANDY_STT_GROQ_BASE_URL: "https://api.groq.com/openai/v1",
      BELLDANDY_QQ_STT_FALLBACK_PROVIDERS: "openai,dashscope",
      BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED: "true",
      BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR: "H:\\.star_sanctuary\\storage\\qq-event-samples",
      BELLDANDY_ROOM_INJECT_THRESHOLD: "10",
      BELLDANDY_ROOM_MEMBERS_CACHE_TTL: "300000",
    });
  });

  it("applies assistant mode preset as a shortcut without persisting a separate mode field", () => {
    const refs = createSettingsRefs({
      cfgAssistantModePreset: createInput("custom"),
      cfgAssistantModeEnabled: createCheckbox(false),
      cfgExternalOutboundRequireConfirmation: createCheckbox(false),
      cfgAssistantExternalDeliveryPreference: createInput("qq,discord"),
      cfgHeartbeat: createInput("90m"),
      cfgHeartbeatEnabled: createCheckbox(false),
      cfgHeartbeatActiveHours: createInput("10:00-18:00"),
      cfgCronEnabled: createCheckbox(false),
    });
    createController({ refs });

    refs.cfgAssistantModePreset.value = "standard";
    refs.cfgAssistantModePreset.trigger("change");

    expect(refs.cfgAssistantModeEnabled.checked).toBe(true);
    expect(refs.cfgExternalOutboundRequireConfirmation.checked).toBe(true);
    expect(refs.cfgAssistantExternalDeliveryPreference.value).toBe("feishu,qq,community,discord");
    expect(refs.cfgHeartbeat.value).toBe("30m");
    expect(refs.cfgHeartbeatEnabled.checked).toBe(true);
    expect(refs.cfgHeartbeatActiveHours.value).toBe("");
    expect(refs.cfgCronEnabled.checked).toBe(true);
    expect(refs.cfgAssistantModePreset.value).toBe("standard");
  });

  it("marks assistant mode reads as pairing-blocked", () => {
    const { controller, refs } = createController();

    controller.markPairingRequired();

    expect(refs.assistantModeConfigHintEl.textContent).toContain("先完成当前 WebChat 会话的 Pairing");
  });

  it("turns off heartbeat and cron when assistant mode master switch is disabled before save", async () => {
    const refs = createSettingsRefs({
      cfgAssistantModeEnabled: createCheckbox(false),
      cfgHeartbeatEnabled: createCheckbox(true),
      cfgCronEnabled: createCheckbox(true),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({ refs, sendReq });

    await controller.saveConfig();

    const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    expect(updateCall?.[0]?.params?.updates).toMatchObject({
      BELLDANDY_ASSISTANT_MODE_ENABLED: "false",
      BELLDANDY_HEARTBEAT_ENABLED: "false",
      BELLDANDY_CRON_ENABLED: "false",
    });
  });

  it("persists starweaver active notify assistant-mode fields from settings form", async () => {
    const refs = createSettingsRefs({
      cfgAssistantModeEnabled: createCheckbox(true),
      cfgHeartbeatEnabled: createCheckbox(true),
      cfgCronEnabled: createCheckbox(true),
      cfgStarweaverActiveNotifyEnabled: createCheckbox(true),
      cfgStarweaverActiveNotifyPollIntervalMs: createInput("7000"),
    });
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "config.update":
          return { ok: true, payload: {} };
        case "channel.security.get":
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "ok.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({ refs, sendReq });

    await controller.saveConfig();

    const updateCall = sendReq.mock.calls.find(([frame]) => frame.method === "config.update");
    expect(updateCall?.[0]?.params?.updates).toMatchObject({
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED: "true",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS: "7000",
    });
  });

  it("loads doctor summary first and then fetches full detail cards asynchronously", async () => {
    const sendReq = vi.fn(async (frame) => {
      switch (frame.method) {
        case "models.config.get":
          return { ok: true, payload: { path: "models.json", content: '{\n  "fallbacks": []\n}\n' } };
        case "channel.security.get":
          return { ok: true, payload: { path: "channel-security.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.reply_chunking.get":
          return { ok: true, payload: { path: "channel-reply-chunking.json", content: '{\n  "version": 1,\n  "channels": {}\n}\n' } };
        case "channel.security.pending.list":
          return { ok: true, payload: { pending: [] } };
        case "system.doctor":
          if (frame.params?.surface === "summary") {
            return {
              ok: true,
              payload: {
                surface: "summary",
                performance: { totalMs: 12, stages: [{ name: "baseline", durationMs: 12 }] },
                checks: [{ name: "Node.js Environment", status: "pass", message: "vtest" }],
              },
            };
          }
          return {
            ok: true,
            payload: {
              surface: "full",
              performance: { totalMs: 40, stages: [{ name: "assistant_mode_runtime", durationMs: 20 }] },
              checks: [{ name: "Node.js Environment", status: "pass", message: "vtest" }],
              residentAgents: { summary: { headline: "resident ok" } },
            },
          };
        default:
          return { ok: true, payload: {} };
      }
    });
    const { controller } = createController({
      sendReq,
      loadServerConfig: vi.fn().mockResolvedValue({}),
    });

    await controller.toggle(true);
    await Promise.resolve();
    await Promise.resolve();

    const doctorCalls = sendReq.mock.calls
      .map(([frame]) => frame)
      .filter((frame) => frame.method === "system.doctor");
    expect(doctorCalls).toHaveLength(2);
    expect(doctorCalls[0].params).toMatchObject({ surface: "summary" });
    expect(doctorCalls[1].params).toMatchObject({ surface: "full" });
    expect(renderDoctorObservabilityCards).toHaveBeenCalledTimes(1);
    expect(renderDoctorObservabilityCards.mock.calls[0][1]).toMatchObject({
      surface: "full",
      residentAgents: { summary: { headline: "resident ok" } },
    });
  });
});
