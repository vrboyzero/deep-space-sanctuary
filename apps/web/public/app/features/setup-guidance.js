import { createPanelTaskScope } from "./panel-task-scope.js";

export function createSetupGuidanceFeature({
  openGuidance,
  delayMs = 500,
} = {}) {
  const taskScope = createPanelTaskScope();
  const guidanceTimerKey = Symbol("setup-guidance");
  // 保留 hello replacement 诊断计数；timer 与 callback fence 统一由 task scope 持有。
  let generation = 0;

  function clear() {
    generation += 1;
    return taskScope.clearTimeout(guidanceTimerKey);
  }

  function schedule() {
    if (!taskScope.isActive()) return false;
    clear();
    taskScope.replaceTimeout(guidanceTimerKey, () => {
      openGuidance?.();
    }, delayMs);
    return true;
  }

  function activate() {
    return taskScope.activate();
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    generation += 1;
    return true;
  }

  function dispose() {
    if (!taskScope.dispose()) return false;
    generation += 1;
    return true;
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      activeTimerCount: snapshot.activeTimerCount,
      generation,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    clear,
    deactivate,
    dispose,
    getRuntimeSnapshot,
    schedule,
  };
}
