// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchControlsFeature } from "./experience-workbench-controls.js";

describe("experience workbench controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("refreshes the workbench only while the controls are active", () => {
    document.body.innerHTML = '<button id="refresh"></button>';
    const loadExperienceWorkbench = vi.fn();
    const feature = createExperienceWorkbenchControlsFeature({
      refreshButton: document.getElementById("refresh"),
      loadExperienceWorkbench,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 1, disposed: false });
    document.getElementById("refresh").click();
    expect(loadExperienceWorkbench).toHaveBeenCalledTimes(1);
    expect(loadExperienceWorkbench).toHaveBeenCalledWith(true);

    expect(feature.deactivate()).toBe(true);
    document.getElementById("refresh").click();
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: false });
    expect(loadExperienceWorkbench).toHaveBeenCalledTimes(1);

    expect(feature.activate()).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 1, disposed: false });
    document.getElementById("refresh").click();
    expect(loadExperienceWorkbench).toHaveBeenCalledTimes(2);
    expect(loadExperienceWorkbench).toHaveBeenLastCalledWith(true);

    feature.dispose();
    feature.dispose();
    expect(feature.activate()).toBe(false);
    document.getElementById("refresh").click();
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(loadExperienceWorkbench).toHaveBeenCalledTimes(2);
  });
});
