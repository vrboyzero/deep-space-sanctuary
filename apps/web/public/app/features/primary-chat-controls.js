export function createPrimaryChatControlsFeature({
  connectButton,
  sendButton,
  onConnect,
  onComposerPrimaryAction,
} = {}) {
  let disposed = false;
  const listenerEntries = [];

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  function handleConnectClick() {
    if (disposed) return;
    onConnect?.();
  }

  function handleSendClick() {
    if (disposed) return;
    onComposerPrimaryAction?.();
  }

  addOwnedListener(connectButton, "click", handleConnectClick);
  addOwnedListener(sendButton, "click", handleSendClick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, type, handler } of listenerEntries) {
      target.removeEventListener(type, handler);
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
