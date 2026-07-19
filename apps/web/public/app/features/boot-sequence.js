const BOOT_LINES = [
  "Initializing Neural Interface...",
  "Loading Core Memories... OK",
  "Establishing Secure Link... OK",
  "Syncing with Star Sanctuary Gateway...",
  "User Identity Verified.",
  "System Online.",
];

export function createBootSequenceFeature(options = {}) {
  const documentRef = options.documentRef ?? globalThis.document;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const setTimer = typeof options.setTimeoutFn === "function" ? options.setTimeoutFn : globalThis.setTimeout;
  const clearTimer = typeof options.clearTimeoutFn === "function" ? options.clearTimeoutFn : globalThis.clearTimeout;
  const onReplacementSettlement = typeof options.onReplacementSettlement === "function"
    ? options.onReplacementSettlement
    : null;
  const onFeatureDispose = typeof options.onFeatureDispose === "function" ? options.onFeatureDispose : null;
  let generation = 0;
  let pendingTimer = null;
  let running = false;
  let disposed = false;

  function cancelPendingTimer() {
    const pending = pendingTimer;
    if (!pending) return;
    pendingTimer = null;
    clearTimer(pending.id);
    // 清理 timer 时同步结算 wait，避免旧 play Promise 永久悬挂。
    pending.resolve(false);
  }

  function notifyLifecycle(callback) {
    try {
      callback?.();
    } catch {
      // 诊断失败不能阻断启动动画或资源释放。
    }
  }

  function wait(delayMs, runGeneration) {
    if (disposed || runGeneration !== generation) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const pending = { id: null, resolve };
      try {
        pending.id = setTimer(() => {
          if (pendingTimer !== pending) return;
          pendingTimer = null;
          resolve(!disposed && runGeneration === generation);
        }, delayMs);
        pendingTimer = pending;
      } catch (error) {
        reject(error);
      }
    });
  }

  async function play() {
    if (disposed) return false;
    const replacingActiveRun = running || Boolean(pendingTimer);
    const runGeneration = ++generation;
    cancelPendingTimer();
    running = false;
    if (replacingActiveRun) notifyLifecycle(onReplacementSettlement);
    const overlay = documentRef?.getElementById?.("awakening");
    const logEl = documentRef?.getElementById?.("bootLog");
    if (!overlay || !logEl) return false;

    running = true;
    overlay.classList.remove("hidden");
    try {
      for (const line of BOOT_LINES) {
        if (disposed || runGeneration !== generation) return false;
        const item = documentRef.createElement("div");
        item.className = "boot-line";
        item.textContent = `> ${line}`;
        logEl.appendChild(item);
        if (!await wait(100 + random() * 300, runGeneration)) return false;
      }

      if (!await wait(800, runGeneration)) return false;
      overlay.classList.add("hidden");
      return true;
    } finally {
      if (runGeneration === generation) {
        cancelPendingTimer();
        running = false;
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    cancelPendingTimer();
    running = false;
    notifyLifecycle(onFeatureDispose);
  }

  function getRuntimeSnapshot() {
    return {
      activeTimerCount: pendingTimer ? 1 : 0,
      activeListenerCount: 0,
      running,
      disposed,
    };
  }

  return {
    play,
    dispose,
    getRuntimeSnapshot,
  };
}
