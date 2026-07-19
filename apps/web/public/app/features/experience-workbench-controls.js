import { createPanelTaskScope } from "./panel-task-scope.js";

export function createExperienceWorkbenchControlsFeature({
  refreshButton,
  loadExperienceWorkbench,
} = {}) {
  const taskScope = createPanelTaskScope();

  function activate() {
    if (!taskScope.activate()) return false;
    if (refreshButton) {
      taskScope.addEventListener(refreshButton, "click", () => {
        void loadExperienceWorkbench?.(true);
      });
    }
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
