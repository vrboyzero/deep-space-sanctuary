// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchControlsFeature } from "./experience-workbench-controls.js";

describe("experience workbench controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("refreshes the workbench until dispose", () => {
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

    feature.dispose();
    feature.dispose();
    document.getElementById("refresh").click();
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(loadExperienceWorkbench).toHaveBeenCalledTimes(1);
  });
});
