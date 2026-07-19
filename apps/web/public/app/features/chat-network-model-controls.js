import { createPanelTaskScope } from "./panel-task-scope.js";

export function createChatNetworkModelControls({
  modelSelectEl,
  modelFilterEl,
  onModelSelectChange,
  onModelFilterInput,
} = {}) {
  const taskScope = createPanelTaskScope();

  function handleModelSelectChange(event) {
    // retained handler 仍可能已进入事件队列，active fence 同时覆盖 deactivate/dispose。
    if (!taskScope.isActive()) return;
    onModelSelectChange?.(event);
  }

  function handleModelFilterInput(event) {
    if (!taskScope.isActive()) return;
    onModelFilterInput?.(event);
  }

  function activate() {
    if (!taskScope.activate()) return false;
    if (typeof onModelSelectChange === "function") {
      taskScope.addEventListener(modelSelectEl, "change", handleModelSelectChange);
    }
    if (typeof onModelFilterInput === "function") {
      taskScope.addEventListener(modelFilterEl, "input", handleModelFilterInput);
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
      disposed: snapshot.disposed,
      activeChatNetworkModelControlListenerCount: snapshot.listenerCount,
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
