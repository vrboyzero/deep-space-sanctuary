export function createChatNetworkConnectionLifecycle({
  scheduleReconnect = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelReconnect = (handle) => clearTimeout(handle),
  reconnectDelayMs = 3000,
  maxReconnectDelayMs = 30_000,
  reconnectJitterRatio = 0.2,
  random = Math.random,
} = {}) {
  let activeConnection = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let disposed = false;
  const baseDelayMs = Number.isFinite(reconnectDelayMs) && reconnectDelayMs > 0
    ? reconnectDelayMs
    : 3_000;
  const maxDelayMs = Number.isFinite(maxReconnectDelayMs) && maxReconnectDelayMs >= baseDelayMs
    ? maxReconnectDelayMs
    : Math.max(baseDelayMs, 30_000);
  const jitterRatio = Number.isFinite(reconnectJitterRatio)
    ? Math.min(1, Math.max(0, reconnectJitterRatio))
    : 0.2;

  function cancelScheduledReconnect() {
    if (reconnectTimer === null) return;
    cancelReconnect(reconnectTimer);
    reconnectTimer = null;
  }

  function resetReconnectBackoff() {
    reconnectAttempt = 0;
  }

  function detachListeners(connection) {
    if (!connection?.listeners) return;
    for (const [type, listener] of Object.entries(connection.listeners)) {
      connection.socket.removeEventListener(type, listener);
    }
  }

  function releaseConnection(connection, { closeSocket = false } = {}) {
    if (!connection || connection.released) return false;
    connection.released = true;
    if (activeConnection === connection) activeConnection = null;
    detachListeners(connection);
    connection.onRelease?.({
      generation: connection.generation,
      socket: connection.socket,
    });
    if (closeSocket) {
      try {
        connection.socket.close();
      } catch {
        // teardown 必须继续完成，socket.close() 失败不应保留 listener 或 generation。
      }
    }
    return true;
  }

  function scheduleConnectionReconnect(connection) {
    cancelScheduledReconnect();
    const exponentialDelayMs = Math.min(
      maxDelayMs,
      baseDelayMs * (2 ** Math.min(reconnectAttempt, 30)),
    );
    const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
    const jitterMultiplier = 1 + ((randomValue * 2) - 1) * jitterRatio;
    const delayMs = Math.min(maxDelayMs, Math.max(0, Math.round(exponentialDelayMs * jitterMultiplier)));
    reconnectAttempt += 1;
    let handle = null;
    handle = scheduleReconnect(() => {
      if (reconnectTimer !== handle) return;
      reconnectTimer = null;
      if (disposed || activeConnection) return;
      connection.onReconnect?.();
    }, delayMs);
    reconnectTimer = handle;
    connection.onReconnectScheduled?.({ delayMs });
  }

  function replaceConnection({
    socket,
    generation,
    onOpen,
    onError,
    onClose,
    onMessage,
    onRelease,
    onReconnect,
    onReconnectScheduled,
  } = {}) {
    if (disposed || !socket || generation === undefined) return false;

    cancelScheduledReconnect();
    releaseConnection(activeConnection, { closeSocket: true });

    const connection = {
      socket,
      generation,
      closeHandled: false,
      released: false,
      listeners: null,
      onRelease,
      onReconnect,
      onReconnectScheduled,
    };
    const isCurrent = () => !disposed && activeConnection === connection && !connection.released;

    connection.listeners = {
      open: (event) => {
        if (!isCurrent()) return;
        onOpen?.(event);
      },
      error: (event) => {
        if (!isCurrent()) return;
        onError?.(event);
      },
      close: (event) => {
        if (!isCurrent() || connection.closeHandled) return;
        connection.closeHandled = true;
        releaseConnection(connection);
        const shouldReconnect = onClose?.(event) === true;
        if (!disposed && shouldReconnect) {
          scheduleConnectionReconnect(connection);
        }
      },
      message: (event) => {
        if (!isCurrent()) return;
        onMessage?.(event);
      },
    };

    activeConnection = connection;
    for (const [type, listener] of Object.entries(connection.listeners)) {
      socket.addEventListener(type, listener);
    }
    return true;
  }

  function teardown() {
    cancelScheduledReconnect();
    releaseConnection(activeConnection, { closeSocket: true });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    teardown();
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      activeChatNetworkConnectionCount: activeConnection ? 1 : 0,
      activeChatNetworkSocketListenerCount: activeConnection ? 4 : 0,
      activeChatNetworkReconnectTimerCount: reconnectTimer === null ? 0 : 1,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    isDisposed: () => disposed,
    replaceConnection,
    resetReconnectBackoff,
    teardown,
  };
}
