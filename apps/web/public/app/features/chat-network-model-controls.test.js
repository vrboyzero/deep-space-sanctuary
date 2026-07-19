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

  it("owns controls and retained callbacks across activation cycles", () => {
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

    expect(controls.deactivate()).toBe(true);
    expect(controls.deactivate()).toBe(false);
    modelSelectEl.dispatch("change", { type: "inactive-change" });
    modelFilterEl.dispatch("input", { type: "inactive-input" });
    retainedChange({ type: "retained-inactive-change" });
    retainedInput({ type: "retained-inactive-input" });
    expect(onModelSelectChange).not.toHaveBeenCalled();
    expect(onModelFilterInput).not.toHaveBeenCalled();
    expect(modelSelectEl.getListenerCount()).toBe(0);
    expect(modelFilterEl.getListenerCount()).toBe(0);
    expect(controls.getRuntimeSnapshot()).toEqual({
      disposed: false,
      activeChatNetworkModelControlListenerCount: 0,
    });

    expect(controls.activate()).toBe(true);
    modelSelectEl.dispatch("change", { type: "reactivated-change" });
    modelFilterEl.dispatch("input", { type: "reactivated-input" });
    expect(onModelSelectChange).toHaveBeenCalledTimes(1);
    expect(onModelFilterInput).toHaveBeenCalledTimes(1);
    expect(controls.getRuntimeSnapshot()).toEqual({
      disposed: false,
      activeChatNetworkModelControlListenerCount: 2,
    });

    const reactivatedChange = modelSelectEl.getRetainedListener("change");
    const reactivatedInput = modelFilterEl.getRetainedListener("input");
    controls.dispose();
    controls.dispose();
    expect(controls.activate()).toBe(false);
    reactivatedChange({ type: "change" });
    reactivatedInput({ type: "input" });

    expect(onModelSelectChange).toHaveBeenCalledTimes(1);
    expect(onModelFilterInput).toHaveBeenCalledTimes(1);
    expect(modelSelectEl.getListenerCount()).toBe(0);
    expect(modelFilterEl.getListenerCount()).toBe(0);
    expect(controls.getRuntimeSnapshot()).toEqual({
      disposed: true,
      activeChatNetworkModelControlListenerCount: 0,
    });
  });
});
