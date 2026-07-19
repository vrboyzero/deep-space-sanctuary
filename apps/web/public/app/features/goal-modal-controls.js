import { createPanelTaskScope } from "./panel-task-scope.js";

export function createGoalModalControlsFeature({ refs = {}, actions = {} } = {}) {
  const {
    goalCreateBtn,
    goalCreateCloseBtn,
    goalCreateCancelBtn,
    goalCreateSubmitBtn,
    goalCheckpointActionCloseBtn,
    goalCheckpointActionCancelBtn,
  } = refs;
  const taskScope = createPanelTaskScope();

  function addOwnedCommand(target, action) {
    if (!target) return;
    const handler = () => {
      void action?.();
    };
    taskScope.addEventListener(target, "click", handler);
  }

  function activate() {
    if (!taskScope.activate()) return false;
    addOwnedCommand(goalCreateBtn, actions.openGoalCreate);
    addOwnedCommand(goalCreateCloseBtn, actions.closeGoalCreate);
    addOwnedCommand(goalCreateCancelBtn, actions.closeGoalCreate);
    addOwnedCommand(goalCreateSubmitBtn, actions.submitGoalCreate);
    addOwnedCommand(goalCheckpointActionCloseBtn, actions.closeGoalCheckpointAction);
    addOwnedCommand(goalCheckpointActionCancelBtn, actions.closeGoalCheckpointAction);
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
      active: snapshot.active,
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
