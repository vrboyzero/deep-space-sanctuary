import { createPanelTaskScope } from "./panel-task-scope.js";

export function createMainViewNavigationFeature({ refs = {}, actions = {} } = {}) {
  const {
    switchMemoryBtn,
    switchExperienceBtn,
    switchGoalsBtn,
    switchSubtasksBtn,
    openChannelSettingsBtn,
    switchCanvasBtn,
  } = refs;
  const taskScope = createPanelTaskScope();

  function addOwnedCommand(target, action) {
    if (!target) return;
    taskScope.addEventListener(target, "click", () => {
      void action?.();
    });
  }

  function activate() {
    if (!taskScope.activate()) return false;
    addOwnedCommand(switchMemoryBtn, actions.openMemory);
    addOwnedCommand(switchExperienceBtn, actions.openExperience);
    addOwnedCommand(switchGoalsBtn, actions.openGoals);
    addOwnedCommand(switchSubtasksBtn, actions.openSubtasks);
    addOwnedCommand(openChannelSettingsBtn, actions.openChannels);
    addOwnedCommand(switchCanvasBtn, actions.openCanvas);
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
