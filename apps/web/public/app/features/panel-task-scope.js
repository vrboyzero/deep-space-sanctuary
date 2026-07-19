export function createPanelTaskScope() {
  let active = false;
  let disposed = false;
  let activationGeneration = 0;
  let latestTaskGeneration = 0;
  let pendingTaskCount = 0;
  let abortController = null;
  const listeners = new Set();
  const timers = new Map();

  function clearListeners() {
    for (const entry of listeners) {
      entry.target.removeEventListener(entry.type, entry.listener, entry.options);
    }
    listeners.clear();
  }

  function clearTimers() {
    for (const timerId of timers.values()) {
      globalThis.clearTimeout(timerId);
    }
    timers.clear();
  }

  function releaseActivation() {
    if (!active) return false;
    active = false;
    activationGeneration += 1;
    latestTaskGeneration += 1;
    abortController?.abort();
    abortController = null;
    clearTimers();
    clearListeners();
    return true;
  }

  function activate() {
    if (disposed) return false;
    releaseActivation();
    activationGeneration += 1;
    latestTaskGeneration += 1;
    abortController = new AbortController();
    active = true;
    return true;
  }

  function deactivate() {
    return releaseActivation();
  }

  function addEventListener(target, type, listener, options) {
    if (!active || disposed || !target || typeof target.addEventListener !== "function" || typeof listener !== "function") {
      return false;
    }
    const entry = { target, type, listener, options };
    target.addEventListener(type, listener, options);
    listeners.add(entry);
    return true;
  }

  function clearTimeout(timerKey) {
    if (!timers.has(timerKey)) return false;
    globalThis.clearTimeout(timers.get(timerKey));
    timers.delete(timerKey);
    return true;
  }

  function scheduleTimeout(timerKey, callback, delayMs) {
    if (!active || disposed || typeof callback !== "function") return null;
    clearTimeout(timerKey);
    const scheduledGeneration = activationGeneration;
    const timerId = globalThis.setTimeout(() => {
      timers.delete(timerKey);
      if (!active || disposed || scheduledGeneration !== activationGeneration) return;
      callback();
    }, delayMs);
    timers.set(timerKey, timerId);
    return timerKey;
  }

  function setTimeout(callback, delayMs) {
    return scheduleTimeout(Symbol("panel-task-scope-timer"), callback, delayMs);
  }

  function replaceTimeout(timerKey, callback, delayMs) {
    if (timerKey === null || timerKey === undefined) return null;
    return scheduleTimeout(timerKey, callback, delayMs);
  }

  function beginTask() {
    if (!active || disposed || !abortController) return null;
    const taskActivationGeneration = activationGeneration;
    const taskGeneration = ++latestTaskGeneration;
    const signal = abortController.signal;
    let settled = false;
    pendingTaskCount += 1;

    function isCurrent() {
      return active
        && !disposed
        && !signal.aborted
        && taskActivationGeneration === activationGeneration
        && taskGeneration === latestTaskGeneration;
    }

    return {
      signal,
      isCurrent,
      commit(callback) {
        if (!isCurrent() || typeof callback !== "function") return false;
        callback();
        return true;
      },
      settle() {
        if (settled) return false;
        settled = true;
        pendingTaskCount = Math.max(0, pendingTaskCount - 1);
        return true;
      },
    };
  }

  function invalidateTasks() {
    if (!active || disposed) return false;
    latestTaskGeneration += 1;
    return true;
  }

  function dispose() {
    if (disposed) return false;
    releaseActivation();
    disposed = true;
    latestTaskGeneration += 1;
    return true;
  }

  function getRuntimeSnapshot() {
    return {
      activeTimerCount: timers.size,
      listenerCount: listeners.size,
      pendingTaskCount,
      activationGeneration,
      active,
      disposed,
    };
  }

  return {
    activate,
    deactivate,
    dispose,
    isActive: () => active && !disposed,
    addEventListener,
    setTimeout,
    replaceTimeout,
    clearTimeout,
    beginTask,
    invalidateTasks,
    getRuntimeSnapshot,
  };
}
