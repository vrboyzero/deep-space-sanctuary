const COMMANDER_RESTORE_STORAGE_KEY = "ss-webchat-commander-restore-v1";

const COMMANDER_PRESET = {
  BELLDANDY_COMMANDER_MODE: "on",
  BELLDANDY_GOAL_EXECUTION_MODE: "multi_agent_parallel",
  BELLDANDY_GOAL_GOVERNANCE_MODE: "commander",
};

const DEFAULT_RESTORE_CONFIG = {
  BELLDANDY_COMMANDER_MODE: "off",
  BELLDANDY_GOAL_EXECUTION_MODE: "auto",
  BELLDANDY_GOAL_GOVERNANCE_MODE: "auto",
};

function normalizeCommanderMode(value) {
  return value === "on" ? "on" : value === "off" ? "off" : "auto";
}

function normalizeGoalMode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "auto";
}

function buildCommanderConfigSnapshot(config = {}) {
  return {
    BELLDANDY_COMMANDER_MODE: normalizeCommanderMode(config.BELLDANDY_COMMANDER_MODE),
    BELLDANDY_GOAL_EXECUTION_MODE: normalizeGoalMode(config.BELLDANDY_GOAL_EXECUTION_MODE),
    BELLDANDY_GOAL_GOVERNANCE_MODE: normalizeGoalMode(config.BELLDANDY_GOAL_GOVERNANCE_MODE),
  };
}

function isCommanderPresetActive(config = {}) {
  const snapshot = buildCommanderConfigSnapshot(config);
  return snapshot.BELLDANDY_COMMANDER_MODE === COMMANDER_PRESET.BELLDANDY_COMMANDER_MODE
    && snapshot.BELLDANDY_GOAL_EXECUTION_MODE === COMMANDER_PRESET.BELLDANDY_GOAL_EXECUTION_MODE
    && snapshot.BELLDANDY_GOAL_GOVERNANCE_MODE === COMMANDER_PRESET.BELLDANDY_GOAL_GOVERNANCE_MODE;
}

function readRestoreSnapshot() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(COMMANDER_RESTORE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return buildCommanderConfigSnapshot(parsed);
  } catch {
    return null;
  }
}

function writeRestoreSnapshot(config = {}) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      COMMANDER_RESTORE_STORAGE_KEY,
      JSON.stringify(buildCommanderConfigSnapshot(config)),
    );
  } catch {
    // ignore storage failures
  }
}

function clearRestoreSnapshot() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(COMMANDER_RESTORE_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

function applyCommanderConfigToRefs(refs = {}, config = {}) {
  if (refs.cfgCommanderMode) {
    refs.cfgCommanderMode.value = normalizeCommanderMode(config.BELLDANDY_COMMANDER_MODE);
  }
  if (refs.cfgGoalExecutionMode) {
    refs.cfgGoalExecutionMode.value = normalizeGoalMode(config.BELLDANDY_GOAL_EXECUTION_MODE);
  }
  if (refs.cfgGoalGovernanceMode) {
    refs.cfgGoalGovernanceMode.value = normalizeGoalMode(config.BELLDANDY_GOAL_GOVERNANCE_MODE);
  }
}

export function createControlPanelCommanderToggleController({
  refs,
  isConnected,
  sendReq,
  makeId,
  loadServerConfig,
  invalidateServerConfigCache,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const commanderQuickToggleEl = refs?.commanderQuickToggleEl || null;
  const commanderQuickToggleStateEl = refs?.commanderQuickToggleStateEl || null;
  const commanderQuickToggleCardEl = commanderQuickToggleEl?.closest?.(".control-panel-commander-card") || null;

  let busy = false;
  let currentConfig = null;

  function render() {
    const enabled = isCommanderPresetActive(currentConfig || {});
    if (commanderQuickToggleEl) {
      commanderQuickToggleEl.checked = enabled;
      commanderQuickToggleEl.disabled = busy;
      commanderQuickToggleEl.setAttribute(
        "aria-label",
        t("panel.commanderQuickToggleLabel", {}, "Commander Mode"),
      );
      commanderQuickToggleEl.setAttribute("aria-checked", String(enabled));
    }
    if (commanderQuickToggleCardEl) {
      commanderQuickToggleCardEl.classList.toggle("is-busy", busy);
    }
    if (commanderQuickToggleStateEl) {
      commanderQuickToggleStateEl.textContent = busy
        ? t("panel.commanderQuickToggleStateSaving", {}, "Saving...")
        : enabled
          ? t("panel.commanderQuickToggleStateOn", {}, "On")
          : t("panel.commanderQuickToggleStateOff", {}, "Off");
    }
  }

  async function syncFromConfig(config = undefined) {
    const nextConfig = config ?? await loadServerConfig?.();
    if (!nextConfig) {
      render();
      return null;
    }
    currentConfig = { ...nextConfig };
    applyCommanderConfigToRefs(refs, currentConfig);
    render();
    return currentConfig;
  }

  async function handleToggleChange() {
    if (busy || !commanderQuickToggleEl) return;

    const shouldEnable = commanderQuickToggleEl.checked;
    if (!isConnected?.()) {
      commanderQuickToggleEl.checked = isCommanderPresetActive(currentConfig || {});
      showNotice?.(
        t("panel.commanderQuickToggleUnavailableTitle", {}, "Unable to change commander mode"),
        t("panel.commanderQuickToggleUnavailable", {}, "Connect to the server before changing commander mode."),
        "error",
        3200,
      );
      render();
      return;
    }

    busy = true;
    render();

    const loadedConfig = await loadServerConfig?.({ force: true });
    if (!loadedConfig) {
      busy = false;
      commanderQuickToggleEl.checked = isCommanderPresetActive(currentConfig || {});
      render();
      showNotice?.(
        t("panel.commanderQuickToggleLoadFailedTitle", {}, "Unable to load config"),
        t("panel.commanderQuickToggleLoadFailed", {}, "The current server configuration could not be read, so commander mode cannot be changed right now."),
        "error",
        3600,
      );
      return;
    }

    currentConfig = { ...loadedConfig };
    const restoreSnapshot = readRestoreSnapshot();
    const updates = shouldEnable
      ? COMMANDER_PRESET
      : restoreSnapshot || DEFAULT_RESTORE_CONFIG;

    if (shouldEnable && !isCommanderPresetActive(currentConfig)) {
      writeRestoreSnapshot(currentConfig);
    }

    try {
      const res = await sendReq?.({
        type: "req",
        id: makeId?.(),
        method: "config.update",
        params: { updates },
      });
      if (!res?.ok) {
        throw new Error(
          res?.error?.message
            || t("panel.commanderQuickToggleLoadFailed", {}, "The current server configuration could not be read, so commander mode cannot be changed right now."),
        );
      }

      invalidateServerConfigCache?.();
      currentConfig = {
        ...currentConfig,
        ...updates,
      };
      applyCommanderConfigToRefs(refs, currentConfig);
      if (!shouldEnable) {
        clearRestoreSnapshot();
      }
      showNotice?.(
        t("panel.commanderQuickToggleSavedTitle", {}, "Commander mode updated"),
        res.payload?.restartRequired === true
          ? t("panel.commanderQuickToggleRestartHint", {}, "The settings were saved, but the server reported that a restart is required. Restart from Settings before checking new task behavior.")
          : shouldEnable
            ? t("panel.commanderQuickToggleEnabled", {}, "Commander governance preset is enabled. Explicitly triggered chat / task / goal will use commander orchestration; normal conversations are unaffected. No restart is required.")
            : t("panel.commanderQuickToggleDisabled", {}, "Non-commander settings have been restored. This only affects future explicitly triggered chat / task / goal and does not require a restart."),
        res.payload?.restartRequired === true ? "info" : "success",
        4200,
      );
    } catch (error) {
      commanderQuickToggleEl.checked = isCommanderPresetActive(currentConfig || {});
      showNotice?.(
        t("panel.commanderQuickToggleUnavailableTitle", {}, "Unable to change commander mode"),
        error instanceof Error ? error.message : String(error),
        "error",
        4200,
      );
    } finally {
      busy = false;
      render();
    }
  }

  commanderQuickToggleEl?.addEventListener("change", () => {
    void handleToggleChange();
  });

  render();

  return {
    refreshLocale() {
      render();
    },
    syncFromConfig,
  };
}
