import { describe, expect, it } from "vitest";

import { createDoctorCardRenderLifecycle } from "./doctor-card-render-lifecycle.js";

function createSchedulerHarness() {
  let nextHandle = 0;
  const scheduled = new Map();
  const retained = new Map();
  return {
    scheduler: {
      schedule(callback) {
        const handle = ++nextHandle;
        scheduled.set(handle, callback);
        retained.set(handle, callback);
        return handle;
      },
      cancel(handle) {
        scheduled.delete(handle);
      },
    },
    runNext() {
      const entry = scheduled.entries().next().value;
      if (!entry) return false;
      const [handle, callback] = entry;
      scheduled.delete(handle);
      callback();
      return true;
    },
    getRetained(handle) {
      return retained.get(handle);
    },
    get firstHandle() {
      return scheduled.keys().next().value;
    },
    get count() {
      return scheduled.size;
    },
  };
}

function createContainer() {
  return {
    children: [],
    appendChild(node) {
      this.children.push(node);
    },
  };
}

function createLifecycle(schedulerHarness) {
  return createDoctorCardRenderLifecycle({
    syncBatchSize: 2,
    asyncBatchSize: 2,
    createScheduler: () => schedulerHarness.scheduler,
  });
}

describe("doctor card render lifecycle", () => {
  it("renders one synchronous batch and releases retained items after async completion", () => {
    const schedulerHarness = createSchedulerHarness();
    const lifecycle = createLifecycle(schedulerHarness);
    const container = createContainer();

    lifecycle.render({
      container,
      items: [1, 2, 3, 4, 5],
      createNode: (item) => item,
    });

    expect(container.children).toEqual([1, 2]);
    expect(lifecycle.getRuntimeSnapshot(container)).toMatchObject({
      pendingDoctorCardRenderJobCount: 1,
      activeDoctorCardRenderFrameCount: 1,
      retainedDoctorCardItemCount: 3,
    });

    schedulerHarness.runNext();
    schedulerHarness.runNext();

    expect(container.children).toEqual([1, 2, 3, 4, 5]);
    expect(lifecycle.getRuntimeSnapshot(container)).toMatchObject({
      pendingDoctorCardRenderJobCount: 0,
      activeDoctorCardRenderFrameCount: 0,
      retainedDoctorCardItemCount: 0,
    });
  });

  it("replaces a container job and ignores the retained callback from the old job", () => {
    const schedulerHarness = createSchedulerHarness();
    const lifecycle = createLifecycle(schedulerHarness);
    const container = createContainer();

    lifecycle.render({ container, items: ["old-1", "old-2", "old-3"], createNode: (item) => item });
    const oldHandle = schedulerHarness.firstHandle;
    const retainedOldCallback = schedulerHarness.getRetained(oldHandle);

    lifecycle.render({ container, items: ["new-1", "new-2"], createNode: (item) => item });
    retainedOldCallback();
    schedulerHarness.runNext();

    expect(container.children).toEqual(["old-1", "old-2", "new-1", "new-2"]);
    expect(schedulerHarness.count).toBe(0);
    expect(lifecycle.getRuntimeSnapshot(container).retainedDoctorCardItemCount).toBe(0);
  });

  it("cancels a container job and prevents retained callbacks from committing", () => {
    const schedulerHarness = createSchedulerHarness();
    const lifecycle = createLifecycle(schedulerHarness);
    const container = createContainer();

    lifecycle.render({ container, items: [1, 2, 3, 4], createNode: (item) => item });
    const retainedCallback = schedulerHarness.getRetained(schedulerHarness.firstHandle);
    lifecycle.disposeContainer(container);
    retainedCallback();

    expect(container.children).toEqual([1, 2]);
    expect(schedulerHarness.count).toBe(0);
    expect(lifecycle.getRuntimeSnapshot(container)).toMatchObject({
      disposed: false,
      pendingDoctorCardRenderJobCount: 0,
      activeDoctorCardRenderFrameCount: 0,
      retainedDoctorCardItemCount: 0,
    });

    lifecycle.dispose();
    expect(lifecycle.render({ container, items: [5], createNode: (item) => item })).toBe(false);
    expect(lifecycle.getRuntimeSnapshot()).toMatchObject({ disposed: true });
  });
});
