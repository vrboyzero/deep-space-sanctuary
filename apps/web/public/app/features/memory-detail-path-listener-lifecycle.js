export function createMemoryDetailPathListenerLifecycle({ openSourcePath } = {}) {
  const listenerDisposers = new Set();
  let disposed = false;

  function clearListeners() {
    for (const disposeListener of listenerDisposers) disposeListener();
    listenerDisposers.clear();
  }

  function bindMemoryPathLinks(container) {
    clearListeners();
    if (disposed || !container?.querySelectorAll) return;
    container.querySelectorAll("[data-open-source]").forEach((node) => {
      const listener = async () => {
        const sourcePath = node.getAttribute("data-open-source");
        const lineRaw = node.getAttribute("data-open-line");
        const startLine = lineRaw ? Number.parseInt(lineRaw, 10) : undefined;
        await openSourcePath?.(sourcePath, { startLine });
      };
      node.addEventListener("click", listener);
      listenerDisposers.add(() => node.removeEventListener("click", listener));
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearListeners();
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      retainedMemoryPathListenerCount: listenerDisposers.size,
    };
  }

  return {
    bindMemoryPathLinks,
    dispose,
    getRuntimeSnapshot,
  };
}
