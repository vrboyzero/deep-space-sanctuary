export function createUuidIdentityFeature({
  input,
  saveButton,
  persistUuid,
  isConnected,
  teardown,
  connect,
  debugLog = () => {},
}) {
  let reconnectTimer = null;
  let disposed = false;

  function clearReconnectTimer() {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(message) {
    clearReconnectTimer();
    debugLog(message);
    teardown();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (disposed) return;
      void connect();
    }, 100);
  }

  function handleSaveClick() {
    if (disposed || !input) return;
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
    if (disposed || !input) return;
    persistUuid();
    if (isConnected()) {
      scheduleReconnect("[UUID] UUID changed (blur), reconnecting");
    }
  }

  if (input && saveButton) saveButton.addEventListener("click", handleSaveClick);
  input?.addEventListener("blur", handleInputBlur);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearReconnectTimer();
    if (input && saveButton) saveButton.removeEventListener("click", handleSaveClick);
    input?.removeEventListener("blur", handleInputBlur);
  }

  function getRuntimeSnapshot() {
    return {
      activeTimerCount: reconnectTimer === null ? 0 : 1,
      listenerCount: disposed
        ? 0
        : Number(Boolean(input)) + Number(Boolean(input && saveButton)),
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
  };
}
