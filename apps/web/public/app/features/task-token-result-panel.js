import { createPanelTaskScope } from "./panel-task-scope.js";

const DEFAULT_HIDE_DELAY_MS = 8_000;
const HIDE_TIMER_KEY = "task-token-result-hide";

export function createTaskTokenResultPanelFeature({
  enabled = false,
  panel,
  valueElements = {},
  formatTokenCount = (value) => String(value ?? "--"),
  hideDelayMs = DEFAULT_HIDE_DELAY_MS,
  recordResult,
} = {}) {
  const transientPanelEnabled = enabled === true;
  const taskScope = createPanelTaskScope();

  function clearHideTimer() {
    return taskScope.clearTimeout(HIDE_TIMER_KEY);
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
    if (!taskScope.isActive() || !payload) return;
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
    taskScope.replaceTimeout(HIDE_TIMER_KEY, hidePanel, hideDelayMs);
  }

  function activate() {
    if (!taskScope.activate()) return false;
    hidePanel();
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    hidePanel();
    return true;
  }

  function dispose() {
    if (!taskScope.dispose()) return false;
    hidePanel();
    return true;
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      enabled: transientPanelEnabled,
      pendingTimerCount: snapshot.activeTimerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
    showTaskTokenResult,
  };
}
