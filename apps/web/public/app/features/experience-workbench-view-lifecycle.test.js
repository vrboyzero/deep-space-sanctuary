import { describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchViewLifecycleFeature } from "./experience-workbench-view-lifecycle.js";

function createFixture() {
  const state = { requestToken: 4 };
  const memoryViewerState = { pendingExperienceActionKey: "synthesize-preview:candidate-1" };
  const events = [];
  const feature = createExperienceWorkbenchViewLifecycleFeature({
    closeSynthesisModal: vi.fn((options) => {
      events.push(`close:${options?.force === true}`);
    }),
    getMemoryViewerState: () => memoryViewerState,
    getWorkbenchState: () => state,
    initialViewActive: true,
    invalidateActionGeneration: () => {
      events.push("invalidate");
    },
    setPendingGenerateActionKey: (value) => {
      events.push(`generate:${value || "none"}`);
    },
    syncGenerateControls: () => {
      events.push("sync");
    },
  });
  return { events, feature, memoryViewerState, state };
}

describe("experience workbench view lifecycle", () => {
  it("deactivates once and reactivates without starting implicit work", () => {
    const fixture = createFixture();

    fixture.feature.setViewActive(false);
    fixture.feature.setViewActive(false);

    expect(fixture.feature.getRuntimeSnapshot()).toEqual({ viewActive: false, disposed: false });
    expect(fixture.state.requestToken).toBe(5);
    expect(fixture.memoryViewerState.pendingExperienceActionKey).toBeNull();
    expect(fixture.events).toEqual([
      "invalidate",
      "generate:none",
      "close:true",
      "sync",
    ]);

    fixture.feature.setViewActive(true);
    expect(fixture.feature.isActive()).toBe(true);
    expect(fixture.events).toHaveLength(4);
  });

  it("stays inactive after dispose", () => {
    const fixture = createFixture();

    fixture.feature.dispose();
    fixture.feature.setViewActive(true);

    expect(fixture.feature.getRuntimeSnapshot()).toEqual({ viewActive: false, disposed: true });
    expect(fixture.state.requestToken).toBe(4);
    expect(fixture.events).toEqual([]);
  });
});
