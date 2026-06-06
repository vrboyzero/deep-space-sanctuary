function readString(config, key) {
  return typeof config?.[key] === "string" ? config[key] : "";
}

export const DEFAULT_ASSISTANT_MODE_HEARTBEAT_INTERVAL = "30m";
export const DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE = "feishu,qq,community,discord";
export const DEFAULT_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "5000";
export const ASSISTANT_MODE_PRESET_CUSTOM = "custom";
export const ASSISTANT_MODE_PRESET_CONSERVATIVE = "conservative";
export const ASSISTANT_MODE_PRESET_STANDARD = "standard";
export const ASSISTANT_MODE_PRESET_PROACTIVE = "proactive";

export const ASSISTANT_MODE_PRESETS = {
  [ASSISTANT_MODE_PRESET_CONSERVATIVE]: {
    assistantModeEnabled: true,
    confirmationRequired: true,
    externalDeliveryPreference: DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
    heartbeatInterval: "60m",
    heartbeatEnabled: true,
    heartbeatActiveHours: "09:00-21:00",
    cronEnabled: false,
  },
  [ASSISTANT_MODE_PRESET_STANDARD]: {
    assistantModeEnabled: true,
    confirmationRequired: true,
    externalDeliveryPreference: DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
    heartbeatInterval: DEFAULT_ASSISTANT_MODE_HEARTBEAT_INTERVAL,
    heartbeatEnabled: true,
    heartbeatActiveHours: "",
    cronEnabled: true,
  },
  [ASSISTANT_MODE_PRESET_PROACTIVE]: {
    assistantModeEnabled: true,
    confirmationRequired: true,
    externalDeliveryPreference: DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
    heartbeatInterval: "15m",
    heartbeatEnabled: true,
    heartbeatActiveHours: "",
    cronEnabled: true,
  },
};

function normalizeDeliveryPreference(value) {
  const allowed = new Set(["feishu", "qq", "community", "discord"]);
  const normalized = String(value || "")
    .split(/[>,]/g)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowed.has(item));
  return normalized.length > 0
    ? [...new Set(normalized)].join(",")
    : DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE;
}

function readBooleanString(config, key) {
  const value = readString(config, key).trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizePresetComparableSettings(settings = {}) {
  return {
    assistantModeEnabled: settings.assistantModeEnabled === true,
    confirmationRequired: settings.confirmationRequired !== false,
    externalDeliveryPreference: normalizeDeliveryPreference(settings.externalDeliveryPreference),
    heartbeatInterval: String(settings.heartbeatInterval || "").trim() || DEFAULT_ASSISTANT_MODE_HEARTBEAT_INTERVAL,
    heartbeatEnabled: settings.heartbeatEnabled === true,
    heartbeatActiveHours: String(settings.heartbeatActiveHours || "").trim(),
    cronEnabled: settings.cronEnabled === true,
    starweaverActiveNotifyEnabled: settings.starweaverActiveNotifyEnabled === true,
    starweaverActiveNotifyPollIntervalMs:
      String(settings.starweaverActiveNotifyPollIntervalMs || "").trim()
      || DEFAULT_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS,
  };
}

export function readAssistantModeSettingsConfig(config = {}) {
  const heartbeatEnabled = readString(config, "BELLDANDY_HEARTBEAT_ENABLED") === "true";
  const cronEnabled = readString(config, "BELLDANDY_CRON_ENABLED") === "true";
  const effectiveEnabled = heartbeatEnabled || cronEnabled;
  const explicitAssistantModeEnabled = readBooleanString(config, "BELLDANDY_ASSISTANT_MODE_ENABLED");
  const assistantModeSource = typeof explicitAssistantModeEnabled === "boolean" ? "explicit" : "derived";
  const assistantModeEnabled = assistantModeSource === "explicit"
    ? explicitAssistantModeEnabled
    : effectiveEnabled;
  return {
    assistantModeEnabled,
    assistantModeSource,
    assistantModeMismatch: assistantModeSource === "explicit" && assistantModeEnabled !== effectiveEnabled,
    effectiveEnabled,
    confirmationRequired: readString(config, "BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION") !== "false",
    externalDeliveryPreference: normalizeDeliveryPreference(
      readString(config, "BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE"),
    ),
    heartbeatInterval: readString(config, "BELLDANDY_HEARTBEAT_INTERVAL"),
    heartbeatEnabled,
    heartbeatActiveHours: readString(config, "BELLDANDY_HEARTBEAT_ACTIVE_HOURS"),
    cronEnabled,
    starweaverActiveNotifyEnabled:
      readString(config, "BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED") === "true",
    starweaverActiveNotifyPollIntervalMs:
      readString(config, "BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS")
      || DEFAULT_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS,
  };
}

export function applyAssistantModeSettingsConfig(refs, config = {}) {
  const settings = readAssistantModeSettingsConfig(config);
  if (refs?.cfgAssistantModeEnabled) {
    refs.cfgAssistantModeEnabled.checked = settings.assistantModeEnabled;
  }
  if (refs?.cfgExternalOutboundRequireConfirmation) {
    refs.cfgExternalOutboundRequireConfirmation.checked = settings.confirmationRequired;
  }
  if (refs?.cfgAssistantExternalDeliveryPreference) {
    refs.cfgAssistantExternalDeliveryPreference.value = settings.externalDeliveryPreference;
  }
  if (refs?.cfgHeartbeat) {
    refs.cfgHeartbeat.value = settings.heartbeatInterval;
  }
  if (refs?.cfgHeartbeatEnabled) {
    refs.cfgHeartbeatEnabled.checked = settings.heartbeatEnabled;
  }
  if (refs?.cfgHeartbeatActiveHours) {
    refs.cfgHeartbeatActiveHours.value = settings.heartbeatActiveHours;
  }
  if (refs?.cfgCronEnabled) {
    refs.cfgCronEnabled.checked = settings.cronEnabled;
  }
  if (refs?.cfgStarweaverActiveNotifyEnabled) {
    refs.cfgStarweaverActiveNotifyEnabled.checked = settings.starweaverActiveNotifyEnabled;
  }
  if (refs?.cfgStarweaverActiveNotifyPollIntervalMs) {
    refs.cfgStarweaverActiveNotifyPollIntervalMs.value =
      settings.starweaverActiveNotifyPollIntervalMs;
  }
  return settings;
}

export function collectAssistantModeSettingsUpdates(refs, options = {}) {
  let heartbeatEnabled = refs?.cfgHeartbeatEnabled?.checked === true;
  let cronEnabled = refs?.cfgCronEnabled?.checked === true;
  const effectiveEnabled = heartbeatEnabled || cronEnabled;
  const assistantModeEnabled = options.useDriverState === true
    ? effectiveEnabled
    : refs?.cfgAssistantModeEnabled?.checked ?? effectiveEnabled;

  if (!assistantModeEnabled) {
    heartbeatEnabled = false;
    cronEnabled = false;
  } else if (options.applyEnabledDefaults === true && !effectiveEnabled) {
    heartbeatEnabled = true;
    cronEnabled = true;
  }

  return {
    BELLDANDY_ASSISTANT_MODE_ENABLED: assistantModeEnabled ? "true" : "false",
    BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION: refs?.cfgExternalOutboundRequireConfirmation?.checked ? "true" : "false",
    BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE: normalizeDeliveryPreference(
      refs?.cfgAssistantExternalDeliveryPreference?.value?.trim() || "",
    ),
    BELLDANDY_HEARTBEAT_INTERVAL: refs?.cfgHeartbeat?.value?.trim() || "",
    BELLDANDY_HEARTBEAT_ENABLED: heartbeatEnabled ? "true" : "false",
    BELLDANDY_HEARTBEAT_ACTIVE_HOURS: refs?.cfgHeartbeatActiveHours?.value?.trim() || "",
    BELLDANDY_CRON_ENABLED: cronEnabled ? "true" : "false",
    BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED:
      refs?.cfgStarweaverActiveNotifyEnabled?.checked ? "true" : "false",
    BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS:
      refs?.cfgStarweaverActiveNotifyPollIntervalMs?.value?.trim()
      || DEFAULT_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS,
  };
}

export function readAssistantModeSettingsFromRefs(refs, options = {}) {
  return readAssistantModeSettingsConfig(collectAssistantModeSettingsUpdates(refs, {
    useDriverState: options.useDriverState === true,
    applyEnabledDefaults: false,
  }));
}

export function resolveAssistantModePreset(settings = {}) {
  const comparable = normalizePresetComparableSettings(settings);
  for (const [presetKey, preset] of Object.entries(ASSISTANT_MODE_PRESETS)) {
    const presetComparable = normalizePresetComparableSettings(preset);
    if (
      comparable.assistantModeEnabled === presetComparable.assistantModeEnabled
      && comparable.confirmationRequired === presetComparable.confirmationRequired
      && comparable.externalDeliveryPreference === presetComparable.externalDeliveryPreference
      && comparable.heartbeatInterval === presetComparable.heartbeatInterval
      && comparable.heartbeatEnabled === presetComparable.heartbeatEnabled
      && comparable.heartbeatActiveHours === presetComparable.heartbeatActiveHours
      && comparable.cronEnabled === presetComparable.cronEnabled
    ) {
      return presetKey;
    }
  }
  return ASSISTANT_MODE_PRESET_CUSTOM;
}

export function applyAssistantModePreset(refs, presetKey) {
  const preset = ASSISTANT_MODE_PRESETS[presetKey];
  if (!preset) return undefined;
  if (refs?.cfgAssistantModeEnabled) {
    refs.cfgAssistantModeEnabled.checked = preset.assistantModeEnabled;
  }
  if (refs?.cfgExternalOutboundRequireConfirmation) {
    refs.cfgExternalOutboundRequireConfirmation.checked = preset.confirmationRequired;
  }
  if (refs?.cfgAssistantExternalDeliveryPreference) {
    refs.cfgAssistantExternalDeliveryPreference.value = preset.externalDeliveryPreference;
  }
  if (refs?.cfgHeartbeat) {
    refs.cfgHeartbeat.value = preset.heartbeatInterval;
  }
  if (refs?.cfgHeartbeatEnabled) {
    refs.cfgHeartbeatEnabled.checked = preset.heartbeatEnabled;
  }
  if (refs?.cfgHeartbeatActiveHours) {
    refs.cfgHeartbeatActiveHours.value = preset.heartbeatActiveHours;
  }
  if (refs?.cfgCronEnabled) {
    refs.cfgCronEnabled.checked = preset.cronEnabled;
  }
  return readAssistantModeSettingsFromRefs(refs);
}
