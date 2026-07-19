import { beforeEach, describe, expect, it, vi } from "vitest";

const createSettingsControllerMock = vi.fn(() => ({
  dispose: vi.fn(),
  toggle: vi.fn(),
  renderPairingPending: vi.fn(),
  refreshChannelSecurityPending: vi.fn(),
  openPairingPending: vi.fn(),
  openChannels: vi.fn(),
  openChannelSecurityPending: vi.fn(),
  markPairingRequired: vi.fn(),
}));
const createToolSettingsControllerMock = vi.fn(() => ({
  dispose: vi.fn(),
  disposeConfirmation: vi.fn(),
  refreshLocale: vi.fn(),
  handleConfirmRequired: vi.fn(),
  handleConfirmResolved: vi.fn(),
  handleToolsConfigUpdated: vi.fn(),
}));
const createExternalOutboundControllerMock = vi.fn(() => ({
  dispose: vi.fn(),
  handleConfirmRequired: vi.fn(),
  handleConfirmResolved: vi.fn(),
}));
const createEmailOutboundControllerMock = vi.fn(() => ({
  dispose: vi.fn(),
  handleConfirmRequired: vi.fn(),
  handleConfirmResolved: vi.fn(),
}));
const createControlPanelCommanderToggleControllerMock = vi.fn(() => ({
  dispose: vi.fn(),
  refreshLocale: vi.fn(),
  syncFromConfig: vi.fn(),
}));

vi.mock("./settings.js", () => ({
  createSettingsController: (...args) => createSettingsControllerMock(...args),
}));

vi.mock("./tool-settings.js", () => ({
  createToolSettingsController: (...args) => createToolSettingsControllerMock(...args),
}));

vi.mock("./external-outbound.js", () => ({
  createExternalOutboundController: (...args) => createExternalOutboundControllerMock(...args),
}));

vi.mock("./email-outbound.js", () => ({
  createEmailOutboundController: (...args) => createEmailOutboundControllerMock(...args),
}));

vi.mock("./control-panel-commander-toggle.js", () => ({
  createControlPanelCommanderToggleController: (...args) => createControlPanelCommanderToggleControllerMock(...args),
}));

import { createSettingsRuntimeFeature } from "./settings-runtime.js";

function createRefs() {
  return {
    settingsModal: {
      classList: {
        contains: vi.fn(() => true),
        remove: vi.fn(),
        add: vi.fn(),
      },
    },
    cfgAssistantModeEnabled: { id: "assistant-mode-master" },
    cfgOpenAiWireApi: { id: "openai-wire-api" },
    cfgOpenAiThinking: { id: "openai-thinking" },
    cfgOpenAiReasoningEffort: { id: "openai-reasoning-effort" },
    cfgHeartbeatEnabled: { id: "heartbeat-enabled" },
    cfgCronEnabled: { id: "cron-enabled" },
    pairingPendingList: { addEventListener: vi.fn() },
    channelSecurityPendingList: { addEventListener: vi.fn() },
  };
}

describe("settings runtime feature", () => {
  beforeEach(() => {
    createSettingsControllerMock.mockClear();
    createToolSettingsControllerMock.mockClear();
    createExternalOutboundControllerMock.mockClear();
    createEmailOutboundControllerMock.mockClear();
    createControlPanelCommanderToggleControllerMock.mockClear();
  });

  it("passes assistant mode master switch ref into settings controller", () => {
    const refs = createRefs();

    createSettingsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      setStatus: vi.fn(),
      loadServerConfig: vi.fn(),
      invalidateServerConfigCache: vi.fn(),
      syncAttachmentLimitsFromConfig: vi.fn(),
      localeController: { t: (_key, _params, fallback) => fallback ?? "" },
      getConnectionAuthMode: () => "token",
      clientId: "client-1",
      getSelectedAgentId: () => null,
      getActiveConversationId: () => null,
      getSelectedSubtaskId: () => null,
      isSubtasksViewActive: () => false,
      escapeHtml: (value) => String(value ?? ""),
      showNotice: vi.fn(),
    });

    expect(createSettingsControllerMock).toHaveBeenCalledTimes(1);
    expect(createSettingsControllerMock.mock.calls[0][0].refs.cfgAssistantModeEnabled).toBe(
      refs.cfgAssistantModeEnabled,
    );
  });

  it("passes newly added OpenAI reasoning refs into settings controller", () => {
    const refs = createRefs();

    createSettingsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      setStatus: vi.fn(),
      loadServerConfig: vi.fn(),
      invalidateServerConfigCache: vi.fn(),
      syncAttachmentLimitsFromConfig: vi.fn(),
      localeController: { t: (_key, _params, fallback) => fallback ?? "" },
      getConnectionAuthMode: () => "token",
      clientId: "client-1",
      getSelectedAgentId: () => null,
      getActiveConversationId: () => null,
      getSelectedSubtaskId: () => null,
      isSubtasksViewActive: () => false,
      escapeHtml: (value) => String(value ?? ""),
      showNotice: vi.fn(),
    });

    expect(createSettingsControllerMock).toHaveBeenCalledTimes(1);
    const passedRefs = createSettingsControllerMock.mock.calls[0][0].refs;
    expect(passedRefs.cfgOpenAiWireApi).toBe(refs.cfgOpenAiWireApi);
    expect(passedRefs.cfgOpenAiThinking).toBe(refs.cfgOpenAiThinking);
    expect(passedRefs.cfgOpenAiReasoningEffort).toBe(refs.cfgOpenAiReasoningEffort);
  });

  it("initializes the control panel commander toggle controller", () => {
    const refs = createRefs();

    createSettingsRuntimeFeature({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      setStatus: vi.fn(),
      loadServerConfig: vi.fn(),
      invalidateServerConfigCache: vi.fn(),
      syncAttachmentLimitsFromConfig: vi.fn(),
      localeController: { t: (_key, _params, fallback) => fallback ?? "" },
      getConnectionAuthMode: () => "token",
      clientId: "client-1",
      getSelectedAgentId: () => null,
      getActiveConversationId: () => null,
      getSelectedSubtaskId: () => null,
      isSubtasksViewActive: () => false,
      escapeHtml: (value) => String(value ?? ""),
      showNotice: vi.fn(),
    });

    expect(createControlPanelCommanderToggleControllerMock).toHaveBeenCalledTimes(1);
    expect(createControlPanelCommanderToggleControllerMock.mock.calls[0][0].refs).toBe(refs);
  });

  it("disposes the tool, external, and email outbound confirmation owners", () => {
    const feature = createSettingsRuntimeFeature({
      refs: createRefs(),
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      setStatus: vi.fn(),
      loadServerConfig: vi.fn(),
      invalidateServerConfigCache: vi.fn(),
      syncAttachmentLimitsFromConfig: vi.fn(),
      localeController: { t: (_key, _params, fallback) => fallback ?? "" },
      getConnectionAuthMode: () => "token",
      clientId: "client-1",
      getSelectedAgentId: () => null,
      getActiveConversationId: () => null,
      getSelectedSubtaskId: () => null,
      isSubtasksViewActive: () => false,
      escapeHtml: (value) => String(value ?? ""),
      showNotice: vi.fn(),
    });

    feature.dispose();

    expect(createSettingsControllerMock.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(createToolSettingsControllerMock.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(createExternalOutboundControllerMock.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(createEmailOutboundControllerMock.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(createControlPanelCommanderToggleControllerMock.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
  });
});
