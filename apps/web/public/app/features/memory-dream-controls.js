import { createPanelTaskScope } from "./panel-task-scope.js";

export function createMemoryDreamControlsFeature({ refs = {}, getMemoryViewerFeature } = {}) {
  const {
    memoryDreamRefreshBtn,
    memoryDreamRunBtn,
    memoryDreamHistoryToggleBtn,
    memoryDreamHistoryRefreshBtn,
  } = refs;
  const taskScope = createPanelTaskScope();

  function addOwnedCommand(target, command) {
    if (!target) return;
    taskScope.addEventListener(target, "click", () => {
      command(getMemoryViewerFeature?.());
    });
  }

  function activate() {
    if (!taskScope.activate()) return false;
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
    return true;
  }

  function deactivate() {
    return taskScope.deactivate();
  }

  function dispose() {
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      listenerCount: snapshot.listenerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
  };
}
