// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOVERNANCE_DETAIL_MODE_CHANGED_EVENT,
  createGovernanceDetailModeRefreshFeature,
} from "./governance-detail-mode.js";

describe("governance detail mode refresh lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("refreshes visible panels only while the global listener is active", () => {
    document.body.innerHTML = `
      <section id="memoryViewer"></section>
      <section id="experienceWorkbench" class="hidden"></section>
      <section id="goals"></section>
    `;
    const loadMemoryViewer = vi.fn();
    const loadExperienceWorkbench = vi.fn();
    const loadGoals = vi.fn();
    const feature = createGovernanceDetailModeRefreshFeature({
      eventTarget: window,
      sections: {
        memoryViewerSection: document.getElementById("memoryViewer"),
        experienceWorkbenchSection: document.getElementById("experienceWorkbench"),
        goalsSection: document.getElementById("goals"),
      },
      reloaders: {
        loadMemoryViewer,
        loadExperienceWorkbench,
        loadGoals,
      },
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 1, disposed: false });
    window.dispatchEvent(new CustomEvent(GOVERNANCE_DETAIL_MODE_CHANGED_EVENT));
    expect(loadMemoryViewer).toHaveBeenCalledWith(false);
    expect(loadExperienceWorkbench).not.toHaveBeenCalled();
    expect(loadGoals).toHaveBeenCalledWith(false);

    expect(feature.deactivate()).toBe(true);
    expect(feature.deactivate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: false });
    document.getElementById("memoryViewer").classList.add("hidden");
    document.getElementById("experienceWorkbench").classList.remove("hidden");
    window.dispatchEvent(new CustomEvent(GOVERNANCE_DETAIL_MODE_CHANGED_EVENT));
    expect(loadMemoryViewer).toHaveBeenCalledTimes(1);
    expect(loadExperienceWorkbench).not.toHaveBeenCalled();
    expect(loadGoals).toHaveBeenCalledTimes(1);

    expect(feature.activate()).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 1, disposed: false });
    window.dispatchEvent(new CustomEvent(GOVERNANCE_DETAIL_MODE_CHANGED_EVENT));
    expect(loadMemoryViewer).toHaveBeenCalledTimes(1);
    expect(loadExperienceWorkbench).toHaveBeenCalledWith(false);
    expect(loadGoals).toHaveBeenCalledTimes(2);

    feature.dispose();
    feature.dispose();
    expect(feature.activate()).toBe(false);
    window.dispatchEvent(new CustomEvent(GOVERNANCE_DETAIL_MODE_CHANGED_EVENT));

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(loadMemoryViewer).toHaveBeenCalledTimes(1);
    expect(loadExperienceWorkbench).toHaveBeenCalledTimes(1);
    expect(loadGoals).toHaveBeenCalledTimes(2);
  });
});
