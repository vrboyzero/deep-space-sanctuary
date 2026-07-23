import fs from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchLazyOwner } from "./experience-workbench-loader.js";

const appSource = fs.readFileSync(new URL("../../app.js", import.meta.url), "utf8");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFeature() {
  return {
    bindUi: vi.fn(),
    dispose: vi.fn(),
    getRuntimeSnapshot: vi.fn(() => ({ listenerCount: 3, disposed: false })),
    loadExperienceWorkbench: vi.fn(async () => "loaded"),
    openExperienceWorkbench: vi.fn(async () => "opened"),
    refreshExperienceWorkbenchForAgentSwitch: vi.fn(async () => "refreshed"),
    setViewActive: vi.fn(),
    syncExperienceWorkbenchHeaderTitle: vi.fn(),
  };
}

describe("Experience workbench lazy owner", () => {
  it("keeps the Experience implementation out of the static app startup graph", () => {
    const from = "from ";

    expect(appSource).toContain(
      `${from}"./app/features/experience-workbench-loader.js"`,
    );
    expect(appSource).not.toContain(
      `${from}"./app/features/experience-workbench.js"`,
    );
    expect(appSource).toContain(
      "experienceWorkbenchLazyOwner = createExperienceWorkbenchLazyOwner({",
    );
  });

  it("shares one import and creates one bound feature for concurrent first-use commands", async () => {
    const deferred = createDeferred();
    const feature = createFeature();
    const createExperienceWorkbenchFeature = vi.fn(() => feature);
    const loadModule = vi.fn(() => deferred.promise);
    const onFeatureCreated = vi.fn();
    const createOptions = { refs: { section: {} } };
    const owner = createExperienceWorkbenchLazyOwner({
      createOptions,
      loadModule,
      onFeatureCreated,
    });

    expect(owner.getRuntimeSnapshot()).toEqual({
      disposed: false,
      feature: null,
      loaded: false,
      loading: false,
    });

    const load = owner.loadExperienceWorkbench(true);
    const open = owner.openExperienceWorkbench({ candidateId: "candidate-1" });
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(owner.getRuntimeSnapshot()).toMatchObject({ loaded: false, loading: true });

    deferred.resolve({ createExperienceWorkbenchFeature });

    await expect(load).resolves.toBe("loaded");
    await expect(open).resolves.toBe("opened");
    expect(createExperienceWorkbenchFeature).toHaveBeenCalledTimes(1);
    expect(createExperienceWorkbenchFeature).toHaveBeenCalledWith(createOptions);
    expect(feature.bindUi).toHaveBeenCalledTimes(1);
    expect(feature.loadExperienceWorkbench).toHaveBeenCalledWith(true);
    expect(feature.openExperienceWorkbench).toHaveBeenCalledWith({ candidateId: "candidate-1" });
    expect(onFeatureCreated).toHaveBeenCalledWith(feature);
    expect(owner.getRuntimeSnapshot()).toEqual({
      disposed: false,
      feature: { listenerCount: 3, disposed: false },
      loaded: true,
      loading: false,
    });
  });

  it("allows retry after an import or factory failure", async () => {
    const feature = createFeature();
    const createExperienceWorkbenchFeature = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("factory unavailable");
      })
      .mockReturnValueOnce(feature);
    const loadModule = vi.fn()
      .mockRejectedValueOnce(new Error("asset unavailable"))
      .mockResolvedValue({ createExperienceWorkbenchFeature });
    const owner = createExperienceWorkbenchLazyOwner({ loadModule });

    await expect(owner.load()).rejects.toThrow("asset unavailable");
    await expect(owner.load()).rejects.toThrow("factory unavailable");
    await expect(owner.load()).resolves.toBe(feature);

    expect(loadModule).toHaveBeenCalledTimes(3);
    expect(createExperienceWorkbenchFeature).toHaveBeenCalledTimes(2);
    expect(feature.bindUi).toHaveBeenCalledTimes(1);
  });

  it("does not create a feature when disposed during a pending import", async () => {
    const deferred = createDeferred();
    const createExperienceWorkbenchFeature = vi.fn(() => createFeature());
    const loadModule = vi.fn(() => deferred.promise);
    const owner = createExperienceWorkbenchLazyOwner({ loadModule });

    const pending = owner.load();
    expect(owner.dispose()).toBe(true);
    deferred.resolve({ createExperienceWorkbenchFeature });

    await expect(pending).resolves.toBeUndefined();
    await expect(owner.load()).resolves.toBeUndefined();
    expect(createExperienceWorkbenchFeature).not.toHaveBeenCalled();
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(owner.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      loaded: false,
      loading: false,
    });
  });

  it("forwards active state only after load and disposes a loaded feature once", async () => {
    const feature = createFeature();
    const owner = createExperienceWorkbenchLazyOwner({
      loadModule: vi.fn(async () => ({
        createExperienceWorkbenchFeature: vi.fn(() => feature),
      })),
    });

    expect(owner.setViewActive(true)).toBe(false);
    expect(owner.syncExperienceWorkbenchHeaderTitle()).toBe(false);
    await expect(owner.refreshExperienceWorkbenchForAgentSwitch("agent-before-load"))
      .resolves.toBeUndefined();
    await owner.load();
    expect(owner.setViewActive(true)).toBe(true);
    expect(feature.setViewActive).toHaveBeenCalledWith(true);
    expect(owner.syncExperienceWorkbenchHeaderTitle()).toBe(true);
    expect(feature.syncExperienceWorkbenchHeaderTitle).toHaveBeenCalledTimes(1);
    await expect(owner.refreshExperienceWorkbenchForAgentSwitch("agent-1"))
      .resolves.toBe("refreshed");
    expect(feature.refreshExperienceWorkbenchForAgentSwitch).toHaveBeenCalledWith("agent-1");

    expect(owner.dispose()).toBe(true);
    expect(owner.dispose()).toBe(false);
    expect(feature.dispose).toHaveBeenCalledTimes(1);
  });
});
