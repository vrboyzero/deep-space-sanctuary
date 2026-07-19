export function createExperienceWorkbenchViewLifecycleFeature({
  closeSynthesisModal,
  getMemoryViewerState,
  getWorkbenchState,
  initialViewActive = true,
  invalidateActionGeneration,
  setPendingGenerateActionKey,
  syncGenerateControls,
} = {}) {
  let viewActive = initialViewActive === true;
  let disposed = false;

  function setViewActive(active) {
    if (disposed) return;
    const nextViewActive = active === true;
    if (viewActive === nextViewActive) return;
    viewActive = nextViewActive;
    if (viewActive) return;

    invalidateActionGeneration?.();
    setPendingGenerateActionKey?.("");
    const memoryViewerState = getMemoryViewerState?.();
    if (memoryViewerState) {
      memoryViewerState.pendingExperienceActionKey = null;
    }
    const state = getWorkbenchState?.();
    if (state) {
      state.requestToken = Number(state.requestToken || 0) + 1;
    }
    // 隐藏 panel 时释放合成正文和 busy owner，底层 Promise 仍由 action token 物理结算。
    closeSynthesisModal?.({ force: true });
    syncGenerateControls?.();
  }

  function isActive() {
    return viewActive && !disposed;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    viewActive = false;
  }

  function getRuntimeSnapshot() {
    return {
      viewActive: isActive(),
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    isActive,
    setViewActive,
  };
}
