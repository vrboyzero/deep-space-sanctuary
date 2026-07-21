import { createPanelTaskScope } from "./panel-task-scope.js";
import { setRuntimeStyles } from "./runtime-style-registry.js";

function createNoopPromptController() {
  const taskScope = createPanelTaskScope();
  taskScope.activate();
  return {
    activate: taskScope.activate,
    deactivate: taskScope.deactivate,
    syncHeight() {},
    restoreText() {},
    dispose: taskScope.dispose,
    getRuntimeSnapshot() {
      const snapshot = taskScope.getRuntimeSnapshot();
      return {
        listenerCount: 0,
        pendingFrameCount: 0,
        pendingFontReadyCount: 0,
        disposed: snapshot.disposed,
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
  const taskScope = createPanelTaskScope();
  let frameScheduled = false;
  let scheduledFrameHandle = null;
  let fontReadyPending = false;
  let promptBaseHeightPx = 0;

  function measurePromptBaseHeight() {
    if (!taskScope.isActive()) return;
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
    if (!taskScope.isActive()) return;
    const baseHeight = promptBaseHeightPx || promptEl.scrollHeight;
    const hasText = Boolean(promptEl.value);
    if (!hasText) {
      setRuntimeStyles(promptEl, {
        height: `${baseHeight}px`,
        "overflow-y": "hidden",
      });
      return;
    }
    setRuntimeStyles(promptEl, { height: "auto", "overflow-y": "hidden" });
    const nextHeight = Math.min(promptEl.scrollHeight, maxHeightPx);
    setRuntimeStyles(promptEl, {
      height: `${Math.max(baseHeight, nextHeight)}px`,
      "overflow-y": promptEl.scrollHeight > maxHeightPx ? "auto" : "hidden",
    });
  }

  function initialize() {
    if (!taskScope.isActive()) return;
    measurePromptBaseHeight();
    syncHeight();
  }

  function restoreText(text) {
    if (!taskScope.isActive() || !text) return;
    promptEl.value = text;
    syncHeight();
  }

  function scheduleHeightSync() {
    if (!taskScope.isActive() || frameScheduled) return;
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
    if (!taskScope.isActive()) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit?.();
    }
    scheduleHeightSync();
  }

  function handleInput() {
    if (!taskScope.isActive()) return;
    syncHeight();
  }

  function cancelScheduledFrame() {
    if (!frameScheduled) return false;
    frameScheduled = false;
    if (scheduledFrameHandle !== null) cancelFrame(scheduledFrameHandle);
    scheduledFrameHandle = null;
    return true;
  }

  function activate() {
    cancelScheduledFrame();
    if (!taskScope.activate()) return false;
    taskScope.addEventListener(promptEl, "keydown", handleKeydown);
    taskScope.addEventListener(promptEl, "input", handleInput);
    initialize();
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    cancelScheduledFrame();
    return true;
  }

  function dispose() {
    if (taskScope.getRuntimeSnapshot().disposed) return false;
    cancelScheduledFrame();
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      listenerCount: snapshot.listenerCount,
      pendingFrameCount: frameScheduled ? 1 : 0,
      pendingFontReadyCount: fontReadyPending ? 1 : 0,
      disposed: snapshot.disposed,
    };
  }

  activate();
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
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
    syncHeight,
    restoreText,
  };
}
