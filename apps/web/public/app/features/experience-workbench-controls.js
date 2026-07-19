export function createExperienceWorkbenchControlsFeature({
  refreshButton,
  loadExperienceWorkbench,
} = {}) {
  const listenerEntries = [];
  let disposed = false;

  if (refreshButton) {
    const handleRefresh = () => {
      if (disposed) return;
      void loadExperienceWorkbench?.(true);
    };
    refreshButton.addEventListener("click", handleRefresh);
    listenerEntries.push({ target: refreshButton, handler: handleRefresh });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, handler } of listenerEntries) {
      target.removeEventListener("click", handler);
    }
    listenerEntries.length = 0;
  }

  function getRuntimeSnapshot() {
    return {
      listenerCount: listenerEntries.length,
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
  };
}
