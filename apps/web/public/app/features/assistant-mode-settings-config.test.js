import { describe, expect, it } from "vitest";

import {
  ASSISTANT_MODE_PRESET_STANDARD,
  DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
  applyAssistantModePreset,
  applyAssistantModeSettingsConfig,
  collectAssistantModeSettingsUpdates,
  readAssistantModeSettingsFromRefs,
  readAssistantModeSettingsConfig,
  resolveAssistantModePreset,
} from "./assistant-mode-settings-config.js";

function createRefs() {
  return {
    cfgAssistantModeEnabled: { checked: false },
    cfgExternalOutboundRequireConfirmation: { checked: false },
    cfgAssistantExternalDeliveryPreference: { value: "" },
    cfgHeartbeat: { value: "" },
    cfgHeartbeatEnabled: { checked: false },
    cfgHeartbeatActiveHours: { value: "" },
    cfgCronEnabled: { checked: false },
    cfgStarweaverActiveNotifyEnabled: { checked: false },
    cfgStarweaverActiveNotifyPollIntervalMs: { value: "" },
  };
}

describe("assistant mode settings config", () => {
  it("reads assistant mode settings from gateway config", () => {
    expect(readAssistantModeSettingsConfig({
      BELLDANDY_ASSISTANT_MODE_ENABLED: "true",
      BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "false",
      BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: "qq,feishu",
      BELLDANDY_HEARTBEAT_INTERVAL: "45m",
      BELLDANDY_HEARTBEAT_ENABLED: "true",
      BELLDANDY_HEARTBEAT_ACTIVE_HOURS: "08:00-23:00",
      BELLDANDY_CRON_ENABLED: "true",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED: "true",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS: "7000",
    })).toEqual({
      assistantModeEnabled: true,
      assistantModeSource: "explicit",
      assistantModeMismatch: false,
      effectiveEnabled: true,
      confirmationRequired: false,
      externalDeliveryPreference: "qq,feishu",
      heartbeatInterval: "45m",
      heartbeatEnabled: true,
      heartbeatActiveHours: "08:00-23:00",
      cronEnabled: true,
      starweaverActiveNotifyEnabled: true,
      starweaverActiveNotifyPollIntervalMs: "7000",
    });
  });

  it("applies assistant mode settings to settings refs", () => {
    const refs = createRefs();

    const settings = applyAssistantModeSettingsConfig(refs, {
      BELLDANDY_ASSISTANT_MODE_ENABLED: "true",
      BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
      BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: "community,discord",
      BELLDANDY_HEARTBEAT_INTERVAL: "30m",
      BELLDANDY_HEARTBEAT_ENABLED: "true",
      BELLDANDY_HEARTBEAT_ACTIVE_HOURS: "09:00-18:00",
      BELLDANDY_CRON_ENABLED: "false",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED: "true",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS: "7000",
    });

    expect(settings).toEqual({
      assistantModeEnabled: true,
      assistantModeSource: "explicit",
      assistantModeMismatch: false,
      effectiveEnabled: true,
      confirmationRequired: true,
      externalDeliveryPreference: "community,discord",
      heartbeatInterval: "30m",
      heartbeatEnabled: true,
      heartbeatActiveHours: "09:00-18:00",
      cronEnabled: false,
      starweaverActiveNotifyEnabled: true,
      starweaverActiveNotifyPollIntervalMs: "7000",
    });
    expect(refs).toEqual({
      cfgAssistantModeEnabled: { checked: true },
      cfgExternalOutboundRequireConfirmation: { checked: true },
      cfgAssistantExternalDeliveryPreference: { value: "community,discord" },
      cfgHeartbeat: { value: "30m" },
      cfgHeartbeatEnabled: { checked: true },
      cfgHeartbeatActiveHours: { value: "09:00-18:00" },
      cfgCronEnabled: { checked: false },
      cfgStarweaverActiveNotifyEnabled: { checked: true },
      cfgStarweaverActiveNotifyPollIntervalMs: { value: "7000" },
    });
  });

  it("collects assistant mode updates from settings refs", () => {
    const refs = createRefs();
    refs.cfgAssistantModeEnabled.checked = true;
    refs.cfgExternalOutboundRequireConfirmation.checked = true;
    refs.cfgAssistantExternalDeliveryPreference.value = " discord , qq ";
    refs.cfgHeartbeat.value = " 15m ";
    refs.cfgHeartbeatEnabled.checked = true;
    refs.cfgHeartbeatActiveHours.value = " 08:00-22:00 ";
    refs.cfgCronEnabled.checked = true;
    refs.cfgStarweaverActiveNotifyEnabled.checked = true;
    refs.cfgStarweaverActiveNotifyPollIntervalMs.value = " 7000 ";

    expect(collectAssistantModeSettingsUpdates(refs)).toEqual({
      BELLDANDY_ASSISTANT_MODE_ENABLED: "true",
      BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: "true",
      BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: "discord,qq",
      BELLDANDY_HEARTBEAT_INTERVAL: "15m",
      BELLDANDY_HEARTBEAT_ENABLED: "true",
      BELLDANDY_HEARTBEAT_ACTIVE_HOURS: "08:00-22:00",
      BELLDANDY_CRON_ENABLED: "true",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED: "true",
      BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS: "7000",
    });
  });

  it("derives assistant mode state from drivers when explicit key is missing", () => {
    expect(readAssistantModeSettingsConfig({
      BELLDANDY_HEARTBEAT_ENABLED: "true",
      BELLDANDY_CRON_ENABLED: "false",
    })).toMatchObject({
      assistantModeEnabled: true,
      assistantModeSource: "derived",
      assistantModeMismatch: false,
      effectiveEnabled: true,
      externalDeliveryPreference: DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
    });
  });

  it("turns off proactive drivers when assistant mode master switch is off", () => {
    const refs = createRefs();
    refs.cfgHeartbeatEnabled.checked = true;
    refs.cfgCronEnabled.checked = true;

    expect(collectAssistantModeSettingsUpdates(refs)).toMatchObject({
      BELLDANDY_ASSISTANT_MODE_ENABLED: "false",
      BELLDANDY_HEARTBEAT_ENABLED: "false",
      BELLDANDY_CRON_ENABLED: "false",
    });
  });

  it("applies default proactive drivers when assistant mode is re-enabled from a fully disabled state", () => {
    const refs = createRefs();
    refs.cfgAssistantModeEnabled.checked = true;

    expect(collectAssistantModeSettingsUpdates(refs, {
      applyEnabledDefaults: true,
    })).toMatchObject({
      BELLDANDY_ASSISTANT_MODE_ENABLED: "true",
      BELLDANDY_HEARTBEAT_ENABLED: "true",
      BELLDANDY_CRON_ENABLED: "true",
    });
  });

  it("can read current assistant mode semantics from refs without forcing defaults", () => {
    const refs = createRefs();
    refs.cfgAssistantModeEnabled.checked = true;

    expect(readAssistantModeSettingsFromRefs(refs)).toMatchObject({
      assistantModeEnabled: true,
      assistantModeSource: "explicit",
      assistantModeMismatch: true,
      effectiveEnabled: false,
    });
  });

  it("resolves a preset from matching assistant mode settings", () => {
    expect(resolveAssistantModePreset({
      assistantModeEnabled: true,
      confirmationRequired: true,
      externalDeliveryPreference: "feishu,qq,community,discord",
      heartbeatInterval: "30m",
      heartbeatEnabled: true,
      heartbeatActiveHours: "",
      cronEnabled: true,
    })).toBe(ASSISTANT_MODE_PRESET_STANDARD);
  });

  it("applies a preset by filling the existing assistant mode fields", () => {
    const refs = createRefs();
    refs.cfgStarweaverActiveNotifyEnabled.checked = true;
    refs.cfgStarweaverActiveNotifyPollIntervalMs.value = "7000";

    const settings = applyAssistantModePreset(refs, ASSISTANT_MODE_PRESET_STANDARD);

    expect(settings).toMatchObject({
      assistantModeEnabled: true,
      confirmationRequired: true,
      externalDeliveryPreference: DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
      heartbeatInterval: "30m",
      heartbeatEnabled: true,
      heartbeatActiveHours: "",
      cronEnabled: true,
    });
    expect(refs.cfgAssistantModeEnabled.checked).toBe(true);
    expect(refs.cfgExternalOutboundRequireConfirmation.checked).toBe(true);
    expect(refs.cfgAssistantExternalDeliveryPreference.value).toBe(DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE);
    expect(refs.cfgHeartbeat.value).toBe("30m");
    expect(refs.cfgHeartbeatEnabled.checked).toBe(true);
    expect(refs.cfgHeartbeatActiveHours.value).toBe("");
    expect(refs.cfgCronEnabled.checked).toBe(true);
    expect(refs.cfgStarweaverActiveNotifyEnabled.checked).toBe(true);
    expect(refs.cfgStarweaverActiveNotifyPollIntervalMs.value).toBe("7000");
  });
});
