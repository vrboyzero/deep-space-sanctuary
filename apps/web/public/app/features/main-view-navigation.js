export function createMainViewNavigationFeature({ refs = {}, actions = {} } = {}) {
  const {
    switchMemoryBtn,
    switchExperienceBtn,
    switchGoalsBtn,
    switchSubtasksBtn,
    openChannelSettingsBtn,
    switchCanvasBtn,
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

  addOwnedCommand(switchMemoryBtn, actions.openMemory);
  addOwnedCommand(switchExperienceBtn, actions.openExperience);
  addOwnedCommand(switchGoalsBtn, actions.openGoals);
  addOwnedCommand(switchSubtasksBtn, actions.openSubtasks);
  addOwnedCommand(openChannelSettingsBtn, actions.openChannels);
  addOwnedCommand(switchCanvasBtn, actions.openCanvas);

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
