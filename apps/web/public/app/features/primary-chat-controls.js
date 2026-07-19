import { createPanelTaskScope } from "./panel-task-scope.js";

export function createPrimaryChatControlsFeature({
  connectButton,
  sendButton,
  onConnect,
  onComposerPrimaryAction,
} = {}) {
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    taskScope.addEventListener(target, type, handler);
  }

  function handleConnectClick() {
    onConnect?.();
  }

  function handleSendClick() {
    onComposerPrimaryAction?.();
  }

  function activate() {
    if (!taskScope.activate()) return false;
    addOwnedListener(connectButton, "click", handleConnectClick);
    addOwnedListener(sendButton, "click", handleSendClick);
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
