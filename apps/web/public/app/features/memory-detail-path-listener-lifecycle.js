import { createPanelTaskScope } from "./panel-task-scope.js";

export function createMemoryDetailPathListenerLifecycle({ openSourcePath } = {}) {
  const taskScope = createPanelTaskScope();
  let bindingScope = null;

  function clearListeners() {
    bindingScope?.dispose();
    bindingScope = null;
  }

  function bindMemoryPathLinks(container) {
    clearListeners();
    if (!taskScope.isActive() || !container?.querySelectorAll) return false;

    // 每次 DOM 重绘使用独立 scope，replacement 不会保留旧节点 listener。
    const currentBindingScope = createPanelTaskScope();
    currentBindingScope.activate();
    bindingScope = currentBindingScope;
    try {
      container.querySelectorAll("[data-open-source]").forEach((node) => {
        const listener = async () => {
          if (!taskScope.isActive()
            || bindingScope !== currentBindingScope
            || !currentBindingScope.isActive()) return;
          const sourcePath = node.getAttribute("data-open-source");
          const lineRaw = node.getAttribute("data-open-line");
          const startLine = lineRaw ? Number.parseInt(lineRaw, 10) : undefined;
          await openSourcePath?.(sourcePath, { startLine });
        };
        currentBindingScope.addEventListener(node, "click", listener);
      });
    } catch (error) {
      if (bindingScope === currentBindingScope) clearListeners();
      throw error;
    }
    if (currentBindingScope.getRuntimeSnapshot().listenerCount === 0) clearListeners();
    return true;
  }

  function activate() {
    if (!taskScope.activate()) return false;
    clearListeners();
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    clearListeners();
    return true;
  }

  function dispose() {
    if (!taskScope.dispose()) return false;
    clearListeners();
    return true;
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      disposed: snapshot.disposed,
      retainedMemoryPathListenerCount: bindingScope?.getRuntimeSnapshot().listenerCount ?? 0,
    };
  }

  activate();

  return {
    activate,
    bindMemoryPathLinks,
    deactivate,
    dispose,
    getRuntimeSnapshot,
  };
}
