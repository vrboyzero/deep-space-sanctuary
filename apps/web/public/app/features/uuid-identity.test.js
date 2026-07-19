// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createUuidIdentityFeature } from "./uuid-identity.js";

function createHarness(overrides = {}) {
  document.body.innerHTML = '<input id="uuid" value="user-1"><button id="save"></button>';
  const input = document.getElementById("uuid");
  const saveButton = document.getElementById("save");
  const dependencies = {
    input,
    saveButton,
    persistUuid: vi.fn(),
    isConnected: () => true,
    teardown: vi.fn(),
    connect: vi.fn(),
    debugLog: vi.fn(),
    ...overrides,
  };
  const feature = createUuidIdentityFeature(dependencies);
  return { input, saveButton, dependencies, feature };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("UUID identity reconnect lifecycle", () => {
  it("persists save and blur changes with one replaceable reconnect timer", async () => {
    vi.useFakeTimers();
    const { input, saveButton, dependencies, feature } = createHarness();

    input.dispatchEvent(new Event("blur"));
    saveButton.click();
    expect(dependencies.persistUuid).toHaveBeenCalledTimes(2);
    expect(dependencies.teardown).toHaveBeenCalledTimes(2);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 1,
      listenerCount: 2,
      disposed: false,
    });
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(dependencies.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dependencies.connect).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot().activeTimerCount).toBe(0);
  });

  it("owns reconnect and identity listeners across activation cycles", async () => {
    vi.useFakeTimers();
    const { input, saveButton, dependencies, feature } = createHarness();

    saveButton.click();
    expect(feature.deactivate()).toBe(true);
    expect(feature.deactivate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 0,
      disposed: false,
    });
    expect(vi.getTimerCount()).toBe(0);

    input.dispatchEvent(new Event("blur"));
    saveButton.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(dependencies.persistUuid).toHaveBeenCalledTimes(1);
    expect(dependencies.teardown).toHaveBeenCalledTimes(1);
    expect(dependencies.connect).not.toHaveBeenCalled();

    expect(feature.activate()).toBe(true);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 2,
      disposed: false,
    });
    input.dispatchEvent(new Event("blur"));
    saveButton.click();
    expect(dependencies.persistUuid).toHaveBeenCalledTimes(3);
    expect(dependencies.teardown).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(dependencies.connect).toHaveBeenCalledTimes(1);

    saveButton.click();
    feature.dispose();
    feature.dispose();
    expect(feature.activate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      listenerCount: 0,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    input.dispatchEvent(new Event("blur"));
    saveButton.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(dependencies.persistUuid).toHaveBeenCalledTimes(4);
    expect(dependencies.teardown).toHaveBeenCalledTimes(4);
    expect(dependencies.connect).toHaveBeenCalledTimes(1);
  });
});
