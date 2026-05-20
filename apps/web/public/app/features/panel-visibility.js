import { scheduleTokenUsageObservabilityPopoverSync } from "./token-usage-observability.js";

function readStoredBoolean(storageKey, defaultValue) {
  if (!storageKey) return defaultValue;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null || raw === undefined || raw === "") {
      return defaultValue;
    }
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    // ignore storage failures
  }
  return defaultValue;
}

function writeStoredBoolean(storageKey, value) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, value ? "1" : "0");
  } catch {
    // ignore storage failures
  }
}

function bindKeyboardToggle(element, handler) {
  if (!element || typeof handler !== "function") return;
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handler();
  });
}

export function createPanelVisibilityFeature({
  refs,
  storageKeys,
  defaults = {},
  onContentPanelVisibleChange,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const {
    tokenUsageEl,
    sidebarEl,
    toggleContentPanelBtn,
    controlPanelEl,
    toggleControlPanelBtn,
    agentRightPanelEl,
    toggleAgentPanelBtn,
  } = refs ?? {};
  const {
    tokenUsageCollapsedKey,
    contentPanelVisibleKey,
    controlPanelVisibleKey,
    agentPanelVisibleKey,
  } = storageKeys ?? {};

  let tokenUsageCollapsed = readStoredBoolean(tokenUsageCollapsedKey, defaults.tokenUsageCollapsed ?? true);
  let contentPanelVisible = readStoredBoolean(contentPanelVisibleKey, defaults.contentPanelVisible ?? false);
  let controlPanelVisible = readStoredBoolean(controlPanelVisibleKey, defaults.controlPanelVisible ?? false);
  let agentPanelVisible = readStoredBoolean(agentPanelVisibleKey, defaults.agentPanelVisible ?? false);
  let agentPanelHasContent = false;

  function refreshTokenUsageState() {
    if (!tokenUsageEl) return;
    tokenUsageEl.classList.toggle("is-collapsed", tokenUsageCollapsed);
    tokenUsageEl.setAttribute("role", "button");
    tokenUsageEl.tabIndex = 0;
    tokenUsageEl.setAttribute("aria-expanded", String(!tokenUsageCollapsed));
    const title = tokenUsageCollapsed
      ? t("header.tokenUsageExpand", {}, "Expand token usage")
      : t("header.tokenUsageCollapse", {}, "Collapse token usage");
    tokenUsageEl.title = title;
    tokenUsageEl.setAttribute("aria-label", title);
    scheduleTokenUsageObservabilityPopoverSync(tokenUsageEl);
  }

  function refreshContentPanelState() {
    sidebarEl?.classList.toggle("hidden", !contentPanelVisible);
    if (!toggleContentPanelBtn) return;
    toggleContentPanelBtn.classList.toggle("is-active", contentPanelVisible);
    toggleContentPanelBtn.setAttribute("aria-pressed", String(contentPanelVisible));
    toggleContentPanelBtn.setAttribute("aria-expanded", String(contentPanelVisible));
    const title = contentPanelVisible
      ? t("header.hideContentPanel", {}, "Hide content manager")
      : t("header.showContentPanel", {}, "Show content manager");
    toggleContentPanelBtn.title = title;
    toggleContentPanelBtn.setAttribute("aria-label", title);
  }

  function refreshControlPanelState() {
    controlPanelEl?.classList.toggle("hidden", !controlPanelVisible);
    document.body.classList.toggle("control-panel-hidden", !controlPanelVisible);
    if (!toggleControlPanelBtn) return;
    toggleControlPanelBtn.classList.toggle("is-active", controlPanelVisible);
    toggleControlPanelBtn.setAttribute("aria-pressed", String(controlPanelVisible));
    toggleControlPanelBtn.setAttribute("aria-expanded", String(controlPanelVisible));
    const title = controlPanelVisible
      ? t("header.hideControlPanel", {}, "Hide control panel")
      : t("header.showControlPanel", {}, "Show control panel");
    toggleControlPanelBtn.title = title;
    toggleControlPanelBtn.setAttribute("aria-label", title);
  }

  function refreshAgentPanelState() {
    agentRightPanelEl?.classList.toggle("hidden", !agentPanelVisible);
    agentRightPanelEl?.classList.toggle("is-empty", !agentPanelHasContent);
    if (!toggleAgentPanelBtn) return;
    toggleAgentPanelBtn.classList.toggle("is-active", agentPanelVisible);
    toggleAgentPanelBtn.setAttribute("aria-pressed", String(agentPanelVisible));
    toggleAgentPanelBtn.setAttribute("aria-expanded", String(agentPanelVisible));
    const title = agentPanelVisible
      ? t("header.hideAgentPanel", {}, "Hide agent info")
      : t("header.showAgentPanel", {}, "Show agent info");
    toggleAgentPanelBtn.title = title;
    toggleAgentPanelBtn.setAttribute("aria-label", title);
  }

  function setTokenUsageCollapsed(nextValue) {
    tokenUsageCollapsed = Boolean(nextValue);
    writeStoredBoolean(tokenUsageCollapsedKey, tokenUsageCollapsed);
    refreshTokenUsageState();
  }

  function setContentPanelVisible(nextValue) {
    contentPanelVisible = Boolean(nextValue);
    writeStoredBoolean(contentPanelVisibleKey, contentPanelVisible);
    refreshContentPanelState();
    onContentPanelVisibleChange?.(contentPanelVisible);
  }

  function setControlPanelVisible(nextValue) {
    controlPanelVisible = Boolean(nextValue);
    writeStoredBoolean(controlPanelVisibleKey, controlPanelVisible);
    refreshControlPanelState();
  }

  function setAgentPanelVisible(nextValue) {
    agentPanelVisible = Boolean(nextValue);
    writeStoredBoolean(agentPanelVisibleKey, agentPanelVisible);
    refreshAgentPanelState();
  }

  tokenUsageEl?.addEventListener("click", () => {
    setTokenUsageCollapsed(!tokenUsageCollapsed);
  });
  bindKeyboardToggle(tokenUsageEl, () => {
    setTokenUsageCollapsed(!tokenUsageCollapsed);
  });

  if (typeof window !== "undefined") {
    window.addEventListener("resize", () => {
      scheduleTokenUsageObservabilityPopoverSync(tokenUsageEl);
    });
  }

  toggleContentPanelBtn?.addEventListener("click", () => {
    setContentPanelVisible(!contentPanelVisible);
  });

  toggleControlPanelBtn?.addEventListener("click", () => {
    setControlPanelVisible(!controlPanelVisible);
  });

  toggleAgentPanelBtn?.addEventListener("click", () => {
    setAgentPanelVisible(!agentPanelVisible);
  });

  refreshTokenUsageState();
  refreshContentPanelState();
  refreshControlPanelState();
  refreshAgentPanelState();

  return {
    getState() {
      return {
        tokenUsageCollapsed,
        contentPanelVisible,
        controlPanelVisible,
        agentPanelVisible,
        agentPanelHasContent,
      };
    },
    setAgentPanelHasContent(hasContent) {
      agentPanelHasContent = Boolean(hasContent);
      refreshAgentPanelState();
    },
    refreshLocale() {
      refreshTokenUsageState();
      refreshContentPanelState();
      refreshControlPanelState();
      refreshAgentPanelState();
    },
    setContentPanelVisible,
  };
}
