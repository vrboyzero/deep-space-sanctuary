import {
  ASSISTANT_MODE_PRESET_CONSERVATIVE,
  ASSISTANT_MODE_PRESET_CUSTOM,
  ASSISTANT_MODE_PRESET_PROACTIVE,
  ASSISTANT_MODE_PRESET_STANDARD,
  resolveAssistantModePreset,
} from "./assistant-mode-settings-config.js";

function tr(t, key, params, fallback) {
  return typeof t === "function" ? t(key, params ?? {}, fallback) : fallback;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function listEnabledDrivers(settings) {
  const drivers = [];
  if (settings?.heartbeatEnabled) drivers.push("heartbeat");
  if (settings?.cronEnabled) drivers.push("cron");
  return drivers;
}

function formatDeliveryPreference(settings, t) {
  const raw = normalizeString(settings?.externalDeliveryPreference);
  if (!raw) {
    return tr(t, "settings.assistantModeResidentOnly", {}, "resident only");
  }
  return `resident + ${raw.split(",").map((item) => item.trim()).filter(Boolean).join(" > ")}`;
}

function buildAssistantModeConfigHint(t, settings, pairingRequired) {
  if (pairingRequired) {
    return tr(
      t,
      "settings.assistantModePairingHint",
      {},
      "如果本区、模型 fallback、渠道安全或系统检查同时读取失败，先完成当前 WebChat 会话的 Pairing，再重新打开设置页。",
    );
  }
  if (!settings) {
    return tr(
      t,
      "settings.assistantModeConfigHint",
      {},
      "配置入口已收口在下方 Assistant Mode 配置；当前仍复用原有 heartbeat / cron / 外部确认 runtime。",
    );
  }

  const currentPreset = resolveAssistantModePreset(settings);
  const presetLabel = currentPreset === ASSISTANT_MODE_PRESET_CONSERVATIVE
    ? tr(t, "settings.assistantModePresetConservative", {}, "保守")
    : currentPreset === ASSISTANT_MODE_PRESET_STANDARD
      ? tr(t, "settings.assistantModePresetStandard", {}, "标准")
      : currentPreset === ASSISTANT_MODE_PRESET_PROACTIVE
        ? tr(t, "settings.assistantModePresetProactive", {}, "主动")
        : tr(t, "settings.assistantModePresetCustom", {}, "自定义");
  const enabledDrivers = listEnabledDrivers(settings);
  const modeSummary = settings.assistantModeEnabled
    ? tr(
      t,
      "settings.assistantModeConfigModeEnabled",
      { drivers: enabledDrivers.join(" + ") || "heartbeat + cron" },
      `assistant mode 已启用（主动驱动：${enabledDrivers.join(" + ") || "heartbeat + cron"}）`,
    )
    : tr(
      t,
      "settings.assistantModeConfigModeDisabled",
      {},
      "assistant mode 已关闭（heartbeat 与 cron 都不会主动运行）",
    );
  const sourceSummary = settings.assistantModeSource === "explicit"
    ? tr(
      t,
      "settings.assistantModeConfigSourceExplicit",
      {},
      "主开关已显式配置。",
    )
    : tr(
      t,
      "settings.assistantModeConfigSourceDerived",
      {},
      "当前主开关仍由 heartbeat / cron 自动推导。",
    );
  const heartbeatStatus = settings.heartbeatEnabled
    ? tr(t, "settings.assistantModeSettingEnabled", {}, "已启用")
    : tr(t, "settings.assistantModeSettingDisabled", {}, "已关闭");
  const cronStatus = settings.cronEnabled
    ? tr(t, "settings.assistantModeSettingEnabled", {}, "已启用")
    : tr(t, "settings.assistantModeSettingDisabled", {}, "已关闭");
  const confirmationMode = settings.confirmationRequired
    ? tr(t, "settings.assistantModeConfirmationRequired", {}, "需要确认")
    : tr(t, "settings.assistantModeConfirmationDisabled", {}, "无需确认");
  const deliveryMode = formatDeliveryPreference(settings, t);
  const heartbeatInterval = normalizeString(settings.heartbeatInterval) || "30m";
  const activeHours = normalizeString(settings.heartbeatActiveHours)
    || tr(t, "settings.assistantModeAllDay", {}, "全天");
  const heartbeatSummary = tr(
    t,
    "settings.assistantModeConfigHeartbeatSummary",
    {
      status: heartbeatStatus,
      interval: heartbeatInterval,
      activeHours,
    },
    `heartbeat ${heartbeatStatus}（${heartbeatInterval}，${activeHours}）`,
  );
  const cronSummary = tr(
    t,
    "settings.assistantModeConfigCronSummary",
    { status: cronStatus },
    `cron ${cronStatus}`,
  );
  const confirmationSummary = tr(
    t,
    "settings.assistantModeConfigConfirmationSummary",
    { mode: confirmationMode },
    `外发确认 ${confirmationMode}`,
  );
  const deliverySummary = tr(
    t,
    "settings.assistantModeConfigDeliverySummary",
    { summary: deliveryMode },
    `外发优先级 ${deliveryMode}`,
  );
  const presetSummary = tr(
    t,
    "settings.assistantModeConfigPresetSummary",
    { preset: presetLabel },
    `当前预设 ${presetLabel}`,
  );
  const mismatchSummary = settings.assistantModeMismatch
    ? tr(
      t,
      "settings.assistantModeConfigMismatch",
      {},
      "检测到主开关与当前 heartbeat / cron 组合不一致；保存时会按主开关语义重新收口。",
    )
    : "";

  return [modeSummary, sourceSummary, presetSummary, mismatchSummary, heartbeatSummary, cronSummary, confirmationSummary, deliverySummary]
    .filter(Boolean)
    .join("；");
}

export function buildAssistantModeSettingsViewModel(t, options = {}) {
  const presetOptions = [
    {
      value: ASSISTANT_MODE_PRESET_CUSTOM,
      label: tr(t, "settings.assistantModePresetCustom", {}, "自定义"),
    },
    {
      value: ASSISTANT_MODE_PRESET_CONSERVATIVE,
      label: tr(t, "settings.assistantModePresetConservative", {}, "保守"),
    },
    {
      value: ASSISTANT_MODE_PRESET_STANDARD,
      label: tr(t, "settings.assistantModePresetStandard", {}, "标准"),
    },
    {
      value: ASSISTANT_MODE_PRESET_PROACTIVE,
      label: tr(t, "settings.assistantModePresetProactive", {}, "主动"),
    },
  ];
  const currentPreset = options.currentPreset || resolveAssistantModePreset(options.settings);
  return {
    configTitle: tr(t, "settings.assistantModeConfigTitle", {}, "Assistant Mode 配置"),
    configHelp: tr(
      t,
      "settings.assistantModeConfigHelp",
      {},
      "统一收口主动工作相关配置，包括策略预设、通知确认、外发优先级、heartbeat 活跃时段和 cron 自动调度。底层仍复用现有 runtime。",
    ),
    configHint: tr(
      t,
      "settings.assistantModeConfigHint",
      {},
      buildAssistantModeConfigHint(t, options.settings, options.pairingRequired === true),
    ),
    presetOptions,
    currentPreset,
  };
}

export function applyAssistantModeSettingsViewModel(refs, t, options = {}) {
  const viewModel = buildAssistantModeSettingsViewModel(t, options);
  if (refs?.assistantModeConfigTitleEl) {
    refs.assistantModeConfigTitleEl.textContent = viewModel.configTitle;
  }
  if (refs?.assistantModeConfigHelpEl) {
    refs.assistantModeConfigHelpEl.textContent = viewModel.configHelp;
  }
  if (refs?.assistantModeConfigHintEl) {
    refs.assistantModeConfigHintEl.textContent = viewModel.configHint;
  }
  if (refs?.cfgAssistantModePreset) {
    refs.cfgAssistantModePreset.textContent = "";
    if (typeof refs.cfgAssistantModePreset.appendChild === "function" && typeof document !== "undefined" && document?.createElement) {
      for (const option of viewModel.presetOptions) {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        refs.cfgAssistantModePreset.appendChild(optionEl);
      }
    } else {
      refs.cfgAssistantModePreset.options = viewModel.presetOptions.map((item) => ({ ...item }));
    }
    refs.cfgAssistantModePreset.value = viewModel.currentPreset;
  }
  return viewModel;
}
