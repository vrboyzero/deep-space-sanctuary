import { describe, expect, it, vi } from "vitest";

import { createChatNetworkModelControls } from "./chat-network-model-controls.js";

function createControl() {
  const listeners = new Map();
  const retainedListeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
      retainedListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
    getRetainedListener(type) {
      return retainedListeners.get(type);
    },
    getListenerCount() {
      return listeners.size;
    },
  };
}

describe("chat network model controls", () => {
  it("forwards model selection and filter input while active", () => {
    const modelSelectEl = createControl();
    const modelFilterEl = createControl();
    const onModelSelectChange = vi.fn();
    const onModelFilterInput = vi.fn();
    const controls = createChatNetworkModelControls({
      modelSelectEl,
      modelFilterEl,
      onModelSelectChange,
      onModelFilterInput,
    });
    const changeEvent = { type: "change" };
    const inputEvent = { type: "input" };

    modelSelectEl.dispatch("change", changeEvent);
    modelFilterEl.dispatch("input", inputEvent);

    expect(onModelSelectChange).toHaveBeenCalledWith(changeEvent);
    expect(onModelFilterInput).toHaveBeenCalledWith(inputEvent);
    expect(controls.getRuntimeSnapshot()).toEqual({
      disposed: false,
      activeChatNetworkModelControlListenerCount: 2,
    });
  });

  it("unbinds controls and ignores retained callbacks after dispose", () => {
    const modelSelectEl = createControl();
    const modelFilterEl = createControl();
    const onModelSelectChange = vi.fn();
    const onModelFilterInput = vi.fn();
    const controls = createChatNetworkModelControls({
      modelSelectEl,
      modelFilterEl,
      onModelSelectChange,
      onModelFilterInput,
    });
    const retainedChange = modelSelectEl.getRetainedListener("change");
    const retainedInput = modelFilterEl.getRetainedListener("input");

    controls.dispose();
    controls.dispose();
    retainedChange({ type: "change" });
    retainedInput({ type: "input" });

    expect(onModelSelectChange).not.toHaveBeenCalled();
    expect(onModelFilterInput).not.toHaveBeenCalled();
    expect(modelSelectEl.getListenerCount()).toBe(0);
    expect(modelFilterEl.getListenerCount()).toBe(0);
    expect(controls.getRuntimeSnapshot()).toEqual({
      disposed: true,
      activeChatNetworkModelControlListenerCount: 0,
    });
  });
});
