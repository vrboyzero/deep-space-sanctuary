import { describe, expect, it, vi } from "vitest";

import { createGoalsSpecialistPanelControlsFeature } from "./goals-specialist-panel-controls.js";

function createNode() {
  const listeners = new Map();
  const retained = [];
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
      retained.push(handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type = "click") {
      listeners.get(type)?.({ type });
    },
    getRetainedListener(index = 0) {
      return retained[index];
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function createPanel(entries = {}) {
  return {
    querySelectorAll(selector) {
      return entries[selector] || [];
    },
  };
}

describe("goals specialist panel controls", () => {
  it("replaces one panel group and blocks a retained listener from the old panel", () => {
    const controls = createGoalsSpecialistPanelControlsFeature();
    const oldNode = createNode();
    const newNode = createNode();
    const oldAction = vi.fn();
    const newAction = vi.fn();

    controls.replaceGroup("handoff", createPanel({ "[data-action]": [oldNode] }), [{
      selector: "[data-action]",
      onClick: oldAction,
    }]);
    const retainedOldListener = oldNode.getRetainedListener();
    controls.replaceGroup("handoff", createPanel({ "[data-action]": [newNode] }), [{
      selector: "[data-action]",
      onClick: newAction,
    }]);

    retainedOldListener({ type: "click" });
    newNode.dispatch();

    expect(oldAction).not.toHaveBeenCalled();
    expect(newAction).toHaveBeenCalledOnce();
    expect(oldNode.listenerCount).toBe(0);
    expect(controls.getRuntimeSnapshot()).toMatchObject({
      activeGroupCount: 1,
      activeListenerCount: 1,
      disposed: false,
    });
  });

  it("owns independent handoff and governance groups until dispose", () => {
    const controls = createGoalsSpecialistPanelControlsFeature();
    const handoffNodes = [createNode(), createNode()];
    const governanceNode = createNode();
    const handoffAction = vi.fn();
    const governanceAction = vi.fn();

    controls.replaceGroup("handoff", createPanel({ "[data-handoff]": handoffNodes }), [{
      selector: "[data-handoff]",
      onClick: handoffAction,
    }]);
    controls.replaceGroup("governance", createPanel({ "[data-governance]": [governanceNode] }), [{
      selector: "[data-governance]",
      onClick: governanceAction,
    }]);
    const retainedHandoffListener = handoffNodes[0].getRetainedListener();
    const retainedGovernanceListener = governanceNode.getRetainedListener();

    controls.dispose();
    retainedHandoffListener({ type: "click" });
    retainedGovernanceListener({ type: "click" });

    expect(handoffAction).not.toHaveBeenCalled();
    expect(governanceAction).not.toHaveBeenCalled();
    expect(handoffNodes.every((node) => node.listenerCount === 0)).toBe(true);
    expect(governanceNode.listenerCount).toBe(0);
    expect(controls.replaceGroup("handoff", createPanel(), [])).toBe(false);
    expect(controls.getRuntimeSnapshot()).toEqual({
      activeGroupCount: 0,
      activeListenerCount: 0,
      disposed: true,
    });
  });

  it("releases the previous group when its replacement panel is unavailable", () => {
    const controls = createGoalsSpecialistPanelControlsFeature();
    const oldNode = createNode();
    const action = vi.fn();

    controls.replaceGroup("handoff", createPanel({ "[data-action]": [oldNode] }), [{
      selector: "[data-action]",
      onClick: action,
    }]);
    const retainedListener = oldNode.getRetainedListener();
    controls.replaceGroup("handoff", createPanel(), []);
    retainedListener({ type: "click" });

    expect(action).not.toHaveBeenCalled();
    expect(oldNode.listenerCount).toBe(0);
    expect(controls.getRuntimeSnapshot()).toMatchObject({
      activeGroupCount: 0,
      activeListenerCount: 0,
    });
  });
});
