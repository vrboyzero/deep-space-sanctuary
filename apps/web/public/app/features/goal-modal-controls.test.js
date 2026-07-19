// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoalModalControlsFeature } from "./goal-modal-controls.js";

describe("goal modal controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards create and checkpoint modal commands until dispose", () => {
    document.body.innerHTML = `
      <button id="create-open"></button>
      <button id="create-close"></button>
      <button id="create-cancel"></button>
      <button id="create-submit"></button>
      <button id="checkpoint-close"></button>
      <button id="checkpoint-cancel"></button>
    `;
    const actions = {
      openGoalCreate: vi.fn(),
      closeGoalCreate: vi.fn(),
      submitGoalCreate: vi.fn(),
      closeGoalCheckpointAction: vi.fn(),
    };
    const feature = createGoalModalControlsFeature({
      refs: {
        goalCreateBtn: document.getElementById("create-open"),
        goalCreateCloseBtn: document.getElementById("create-close"),
        goalCreateCancelBtn: document.getElementById("create-cancel"),
        goalCreateSubmitBtn: document.getElementById("create-submit"),
        goalCheckpointActionCloseBtn: document.getElementById("checkpoint-close"),
        goalCheckpointActionCancelBtn: document.getElementById("checkpoint-cancel"),
      },
      actions,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 6, disposed: false });
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    expect(actions.openGoalCreate).toHaveBeenCalledTimes(1);
    expect(actions.closeGoalCreate).toHaveBeenCalledTimes(2);
    expect(actions.submitGoalCreate).toHaveBeenCalledTimes(1);
    expect(actions.closeGoalCheckpointAction).toHaveBeenCalledTimes(2);

    feature.dispose();
    feature.dispose();
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(actions.openGoalCreate).toHaveBeenCalledTimes(1);
    expect(actions.closeGoalCreate).toHaveBeenCalledTimes(2);
    expect(actions.submitGoalCreate).toHaveBeenCalledTimes(1);
    expect(actions.closeGoalCheckpointAction).toHaveBeenCalledTimes(2);
  });
});
