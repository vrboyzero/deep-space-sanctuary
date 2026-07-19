export function createChatNetworkRequestLifecycle({
  scheduleTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelTimeout = (handle) => clearTimeout(handle),
} = {}) {
  const pendingRequestsByGeneration = new Map();
  let disposed = false;

  function pruneGeneration(generation, pendingRequests) {
    if (pendingRequests.size === 0) {
      pendingRequestsByGeneration.delete(generation);
    }
  }

  function settleEntry(generation, pendingRequests, requestId, value) {
    const inflight = pendingRequests.get(requestId);
    if (!inflight) return false;
    pendingRequests.delete(requestId);
    pruneGeneration(generation, pendingRequests);
    cancelTimeout(inflight.timeoutHandle);
    inflight.resolve(value);
    return true;
  }

  function trackRequest({ generation, requestId, timeoutMs } = {}) {
    if (disposed || generation === undefined || !requestId) return Promise.resolve(null);
    const rawTimeoutMs = Number(timeoutMs);
    const effectiveTimeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
      ? rawTimeoutMs
      : 30_000;
    const pendingRequests = pendingRequestsByGeneration.get(generation) ?? new Map();
    pendingRequestsByGeneration.set(generation, pendingRequests);

    return new Promise((resolve) => {
      // requestId 理论上唯一；发生碰撞时先结算旧调用，避免遗留 resolver 与 deadline。
      settleEntry(generation, pendingRequests, requestId, null);
      pendingRequestsByGeneration.set(generation, pendingRequests);
      const timeoutHandle = scheduleTimeout(() => {
        const inflight = pendingRequests.get(requestId);
        if (inflight?.resolve !== resolve) return;
        settleEntry(generation, pendingRequests, requestId, null);
      }, effectiveTimeoutMs);
      pendingRequests.set(requestId, { resolve, timeoutHandle });
    });
  }

  function resolveResponse(generation, frame) {
    const requestId = typeof frame?.id === "string" ? frame.id : "";
    const pendingRequests = pendingRequestsByGeneration.get(generation);
    if (!requestId || !pendingRequests) return false;
    return settleEntry(generation, pendingRequests, requestId, frame);
  }

  function settleGeneration(generation) {
    const pendingRequests = pendingRequestsByGeneration.get(generation);
    if (!pendingRequests) return 0;
    const requestIds = [...pendingRequests.keys()];
    for (const requestId of requestIds) {
      settleEntry(generation, pendingRequests, requestId, null);
    }
    return requestIds.length;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const generation of [...pendingRequestsByGeneration.keys()]) {
      settleGeneration(generation);
    }
  }

  function getRuntimeSnapshot() {
    let pendingChatNetworkRequestCount = 0;
    for (const pendingRequests of pendingRequestsByGeneration.values()) {
      pendingChatNetworkRequestCount += pendingRequests.size;
    }
    return {
      disposed,
      pendingChatNetworkGenerationCount: pendingRequestsByGeneration.size,
      pendingChatNetworkRequestCount,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    resolveResponse,
    settleGeneration,
    trackRequest,
  };
}
