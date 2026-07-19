// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMainViewNavigationFeature } from "./main-view-navigation.js";

describe("main view navigation lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards every root navigation command until dispose", () => {
    document.body.innerHTML = `
      <button id="memory"></button>
      <button id="experience"></button>
      <button id="goals"></button>
      <button id="subtasks"></button>
      <button id="channels"></button>
      <button id="canvas"></button>
    `;
    const actions = {
      openMemory: vi.fn(),
      openExperience: vi.fn(),
      openGoals: vi.fn(),
      openSubtasks: vi.fn(),
      openChannels: vi.fn(),
      openCanvas: vi.fn(),
    };
    const feature = createMainViewNavigationFeature({
      refs: {
        switchMemoryBtn: document.getElementById("memory"),
        switchExperienceBtn: document.getElementById("experience"),
        switchGoalsBtn: document.getElementById("goals"),
        switchSubtasksBtn: document.getElementById("subtasks"),
        openChannelSettingsBtn: document.getElementById("channels"),
        switchCanvasBtn: document.getElementById("canvas"),
      },
      actions,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 6, disposed: false });
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    for (const action of Object.values(actions)) {
      expect(action).toHaveBeenCalledTimes(1);
    }

    feature.dispose();
    feature.dispose();
    for (const button of document.querySelectorAll("button")) {
      button.click();
    }
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    for (const action of Object.values(actions)) {
      expect(action).toHaveBeenCalledTimes(1);
    }
  });
});
