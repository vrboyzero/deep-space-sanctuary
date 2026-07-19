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

  it("refreshes visible panels and releases the global listener on dispose", () => {
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

    feature.dispose();
    feature.dispose();
    window.dispatchEvent(new CustomEvent(GOVERNANCE_DETAIL_MODE_CHANGED_EVENT));

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(loadMemoryViewer).toHaveBeenCalledTimes(1);
    expect(loadExperienceWorkbench).not.toHaveBeenCalled();
    expect(loadGoals).toHaveBeenCalledTimes(1);
  });
});
