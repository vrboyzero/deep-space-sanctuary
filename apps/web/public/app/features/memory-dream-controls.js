export function createMemoryDreamControlsFeature({ refs = {}, getMemoryViewerFeature } = {}) {
  const {
    memoryDreamRefreshBtn,
    memoryDreamRunBtn,
    memoryDreamHistoryToggleBtn,
    memoryDreamHistoryRefreshBtn,
  } = refs;
  const listenerEntries = [];
  let disposed = false;

  function addOwnedCommand(target, command) {
    if (!target) return;
    const handler = () => {
      if (disposed) return;
      command(getMemoryViewerFeature?.());
    };
    target.addEventListener("click", handler);
    listenerEntries.push({ target, handler });
  }

  addOwnedCommand(memoryDreamRefreshBtn, (feature) => {
    void feature?.loadDreamRuntimeStatus?.();
    void feature?.loadDreamCommonsStatus?.();
  });
  addOwnedCommand(memoryDreamRunBtn, (feature) => {
    void feature?.runDream?.();
  });
  addOwnedCommand(memoryDreamHistoryToggleBtn, (feature) => {
    feature?.toggleDreamHistory?.();
  });
  addOwnedCommand(memoryDreamHistoryRefreshBtn, (feature) => {
    void feature?.loadDreamHistory?.(false);
  });

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
