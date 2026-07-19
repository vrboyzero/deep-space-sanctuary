const DEFAULT_HIDE_DELAY_MS = 8_000;

export function createTaskTokenResultPanelFeature({
  enabled = false,
  panel,
  valueElements = {},
  formatTokenCount = (value) => String(value ?? "--"),
  hideDelayMs = DEFAULT_HIDE_DELAY_MS,
  recordResult,
} = {}) {
  const transientPanelEnabled = enabled === true;
  let hideTimer = null;
  let disposed = false;

  function clearHideTimer() {
    if (hideTimer === null) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  function hidePanel() {
    if (panel) panel.style.display = "none";
  }

  function setMetric(key, value) {
    const element = valueElements[key];
    if (!element) return;
    element.textContent = typeof value === "number"
      ? formatTokenCount(value)
      : String(value ?? "--");
  }

  function showTaskTokenResult(payload) {
    if (disposed || !payload) return;
    if (payload.conversationId) {
      recordResult?.(payload);
    }
    if (!transientPanelEnabled) {
      clearHideTimer();
      hidePanel();
      return;
    }
    if (!panel) return;

    setMetric("taskName", payload.name);
    setMetric("taskIn", payload.inputTokens);
    setMetric("taskOut", payload.outputTokens);
    setMetric("taskTotal", payload.totalTokens);
    panel.style.display = "flex";
    clearHideTimer();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!disposed) hidePanel();
    }, hideDelayMs);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearHideTimer();
    hidePanel();
  }

  function getRuntimeSnapshot() {
    return {
      enabled: transientPanelEnabled,
      pendingTimerCount: hideTimer === null ? 0 : 1,
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    showTaskTokenResult,
  };
}
