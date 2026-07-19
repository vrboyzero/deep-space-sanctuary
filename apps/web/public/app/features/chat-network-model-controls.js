export function createChatNetworkModelControls({
  modelSelectEl,
  modelFilterEl,
  onModelSelectChange,
  onModelFilterInput,
} = {}) {
  const bindings = [];
  let disposed = false;

  function bind(target, type, callback) {
    if (!target || typeof callback !== "function") return;
    const listener = (event) => {
      // retained handler 仍可能已进入事件队列，dispose guard 负责阻断迟到副作用。
      if (disposed) return;
      callback(event);
    };
    target.addEventListener(type, listener);
    bindings.push({ target, type, listener });
  }

  bind(modelSelectEl, "change", onModelSelectChange);
  bind(modelFilterEl, "input", onModelFilterInput);

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, type, listener } of bindings.splice(0)) {
      target.removeEventListener(type, listener);
    }
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      activeChatNetworkModelControlListenerCount: bindings.length,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
  };
}
