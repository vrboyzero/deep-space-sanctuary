function createNoopPromptController() {
  let disposed = false;
  return {
    syncHeight() {},
    restoreText() {},
    dispose() {
      disposed = true;
    },
    getRuntimeSnapshot() {
      return {
        listenerCount: 0,
        pendingFrameCount: 0,
        pendingFontReadyCount: 0,
        disposed,
      };
    },
  };
}

export function initPromptController({
  promptEl,
  maxHeightPx = 120,
  onSubmit,
  documentRef = globalThis.document,
  requestAnimationFrameFn = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelAnimationFrameFn = globalThis.cancelAnimationFrame?.bind(globalThis),
}) {
  if (!promptEl) return createNoopPromptController();

  const scheduleFrame = requestAnimationFrameFn ?? ((callback) => setTimeout(callback, 0));
  const cancelFrame = cancelAnimationFrameFn ?? ((handle) => clearTimeout(handle));
  let disposed = false;
  let listenerBound = true;
  let frameScheduled = false;
  let scheduledFrameHandle = null;
  let fontReadyPending = false;
  let promptBaseHeightPx = 0;

  function measurePromptBaseHeight() {
    if (disposed) return;
    const computed = globalThis.getComputedStyle(promptEl);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 24;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
    promptBaseHeightPx = Math.max(
      promptBaseHeightPx,
      Math.ceil(lineHeight + paddingTop + paddingBottom + borderTop + borderBottom),
    );
  }

  function syncHeight() {
    if (disposed) return;
    const baseHeight = promptBaseHeightPx || promptEl.scrollHeight;
    const hasText = Boolean(promptEl.value);
    if (!hasText) {
      promptEl.style.height = `${baseHeight}px`;
      promptEl.style.overflowY = "hidden";
      return;
    }
    promptEl.style.height = "auto";
    const nextHeight = Math.min(promptEl.scrollHeight, maxHeightPx);
    promptEl.style.height = `${Math.max(baseHeight, nextHeight)}px`;
    promptEl.style.overflowY = promptEl.scrollHeight > maxHeightPx ? "auto" : "hidden";
  }

  function initialize() {
    if (disposed) return;
    measurePromptBaseHeight();
    syncHeight();
  }

  function restoreText(text) {
    if (disposed || !text) return;
    promptEl.value = text;
    syncHeight();
  }

  function scheduleHeightSync() {
    if (disposed || frameScheduled) return;
    frameScheduled = true;
    const handle = scheduleFrame(() => {
      frameScheduled = false;
      scheduledFrameHandle = null;
      syncHeight();
    });
    // A test or polyfill may execute synchronously; do not retain an already-settled handle.
    if (frameScheduled) scheduledFrameHandle = handle;
  }

  function handleKeydown(event) {
    if (disposed) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit?.();
    }
    scheduleHeightSync();
  }

  function handleInput() {
    if (disposed) return;
    syncHeight();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frameScheduled) {
      frameScheduled = false;
      if (scheduledFrameHandle !== null) cancelFrame(scheduledFrameHandle);
      scheduledFrameHandle = null;
    }
    if (listenerBound) {
      promptEl.removeEventListener("keydown", handleKeydown);
      promptEl.removeEventListener("input", handleInput);
      listenerBound = false;
    }
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerBound ? 2 : 0,
      pendingFrameCount: frameScheduled ? 1 : 0,
      pendingFontReadyCount: fontReadyPending ? 1 : 0,
      disposed,
    };
  }

  promptEl.addEventListener("keydown", handleKeydown);
  promptEl.addEventListener("input", handleInput);

  initialize();
  if (documentRef?.fonts?.ready) {
    fontReadyPending = true;
    Promise.resolve(documentRef.fonts.ready).then(
      () => {
        fontReadyPending = false;
        initialize();
      },
      () => {
        fontReadyPending = false;
      },
    );
  }

  return {
    dispose,
    getRuntimeSnapshot,
    syncHeight,
    restoreText,
  };
}
