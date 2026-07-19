export function createGoalModalControlsFeature({ refs = {}, actions = {} } = {}) {
  const {
    goalCreateBtn,
    goalCreateCloseBtn,
    goalCreateCancelBtn,
    goalCreateSubmitBtn,
    goalCheckpointActionCloseBtn,
    goalCheckpointActionCancelBtn,
  } = refs;
  const listenerEntries = [];
  let disposed = false;

  function addOwnedCommand(target, action) {
    if (!target) return;
    const handler = () => {
      if (disposed) return;
      void action?.();
    };
    target.addEventListener("click", handler);
    listenerEntries.push({ target, handler });
  }

  addOwnedCommand(goalCreateBtn, actions.openGoalCreate);
  addOwnedCommand(goalCreateCloseBtn, actions.closeGoalCreate);
  addOwnedCommand(goalCreateCancelBtn, actions.closeGoalCreate);
  addOwnedCommand(goalCreateSubmitBtn, actions.submitGoalCreate);
  addOwnedCommand(goalCheckpointActionCloseBtn, actions.closeGoalCheckpointAction);
  addOwnedCommand(goalCheckpointActionCancelBtn, actions.closeGoalCheckpointAction);

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
