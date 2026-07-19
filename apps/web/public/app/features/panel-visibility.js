import {
  cancelTokenUsageObservabilityPopoverSync,
  scheduleTokenUsageObservabilityPopoverSync,
} from "./token-usage-observability.js";

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

export function createPanelVisibilityFeature({
  refs,
  storageKeys,
  defaults = {},
  onContentPanelVisibleChange,
  t = (_key, _params, fallback) => fallback ?? "",
  windowRef = typeof window !== "undefined" ? window : null,
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
  let disposed = false;
  const listenerEntries = [];

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  function refreshTokenUsageState() {
    if (disposed || !tokenUsageEl) return;
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
    if (disposed) return;
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
    if (disposed) return;
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
    if (disposed) return;
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
    if (disposed) return;
    tokenUsageCollapsed = Boolean(nextValue);
    writeStoredBoolean(tokenUsageCollapsedKey, tokenUsageCollapsed);
    refreshTokenUsageState();
  }

  function setContentPanelVisible(nextValue) {
    if (disposed) return;
    contentPanelVisible = Boolean(nextValue);
    writeStoredBoolean(contentPanelVisibleKey, contentPanelVisible);
    refreshContentPanelState();
    onContentPanelVisibleChange?.(contentPanelVisible);
  }

  function setControlPanelVisible(nextValue) {
    if (disposed) return;
    controlPanelVisible = Boolean(nextValue);
    writeStoredBoolean(controlPanelVisibleKey, controlPanelVisible);
    refreshControlPanelState();
  }

  function setAgentPanelVisible(nextValue) {
    if (disposed) return;
    agentPanelVisible = Boolean(nextValue);
    writeStoredBoolean(agentPanelVisibleKey, agentPanelVisible);
    refreshAgentPanelState();
  }

  function handleTokenUsageClick() {
    setTokenUsageCollapsed(!tokenUsageCollapsed);
  }

  function handleTokenUsageKeydown(event) {
    if (disposed || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    setTokenUsageCollapsed(!tokenUsageCollapsed);
  }

  function handleWindowResize() {
    if (disposed) return;
    scheduleTokenUsageObservabilityPopoverSync(tokenUsageEl);
  }

  function handleContentPanelClick() {
    setContentPanelVisible(!contentPanelVisible);
  }

  function handleControlPanelClick() {
    setControlPanelVisible(!controlPanelVisible);
  }

  function handleAgentPanelClick() {
    setAgentPanelVisible(!agentPanelVisible);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, type, handler } of listenerEntries) {
      target.removeEventListener(type, handler);
    }
    listenerEntries.length = 0;
    cancelTokenUsageObservabilityPopoverSync(tokenUsageEl);
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerEntries.length,
      pendingFrameCount: tokenUsageEl?.__tokenUsageObservabilityFrame ? 1 : 0,
      disposed,
    };
  }

  addOwnedListener(tokenUsageEl, "click", handleTokenUsageClick);
  addOwnedListener(tokenUsageEl, "keydown", handleTokenUsageKeydown);
  addOwnedListener(windowRef, "resize", handleWindowResize);
  addOwnedListener(toggleContentPanelBtn, "click", handleContentPanelClick);
  addOwnedListener(toggleControlPanelBtn, "click", handleControlPanelClick);
  addOwnedListener(toggleAgentPanelBtn, "click", handleAgentPanelClick);

  refreshTokenUsageState();
  refreshContentPanelState();
  refreshControlPanelState();
  refreshAgentPanelState();

  return {
    dispose,
    getRuntimeSnapshot,
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
      if (disposed) return;
      agentPanelHasContent = Boolean(hasContent);
      refreshAgentPanelState();
    },
    refreshLocale() {
      if (disposed) return;
      refreshTokenUsageState();
      refreshContentPanelState();
      refreshControlPanelState();
      refreshAgentPanelState();
    },
    setContentPanelVisible,
  };
}
