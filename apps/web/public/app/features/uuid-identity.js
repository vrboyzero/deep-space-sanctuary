import { createPanelTaskScope } from "./panel-task-scope.js";

export function createUuidIdentityFeature({
  input,
  saveButton,
  persistUuid,
  isConnected,
  teardown,
  connect,
  debugLog = () => {},
}) {
  const taskScope = createPanelTaskScope();
  const reconnectTimerKey = Symbol("uuid-reconnect");

  function clearReconnectTimer() {
    taskScope.clearTimeout(reconnectTimerKey);
  }

  function scheduleReconnect(message) {
    clearReconnectTimer();
    debugLog(message);
    teardown();
    taskScope.replaceTimeout(reconnectTimerKey, () => {
      void connect();
    }, 100);
  }

  function handleSaveClick() {
    if (!taskScope.isActive() || !input) return;
    const uuid = input.value.trim();
    debugLog("[UUID] Saving UUID", { hasUuid: Boolean(uuid) });
    persistUuid();
    if (isConnected()) {
      scheduleReconnect("[UUID] UUID changed, reconnecting");
      return;
    }
    debugLog("[UUID] WebSocket not connected, will use UUID on next connect");
  }

  function handleInputBlur() {
    if (!taskScope.isActive() || !input) return;
    persistUuid();
    if (isConnected()) {
      scheduleReconnect("[UUID] UUID changed (blur), reconnecting");
    }
  }

  function activate() {
    if (!taskScope.activate()) return false;
    if (input && saveButton) taskScope.addEventListener(saveButton, "click", handleSaveClick);
    taskScope.addEventListener(input, "blur", handleInputBlur);
    return true;
  }

  function deactivate() {
    return taskScope.deactivate();
  }

  function dispose() {
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      activeTimerCount: snapshot.activeTimerCount,
      listenerCount: snapshot.listenerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
  };
}
