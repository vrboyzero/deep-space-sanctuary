// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceRootsSaveFeature } from "./workspace-roots-save.js";

function createHarness(overrides = {}) {
  document.body.innerHTML = `
    <textarea id="roots"> E:\\workspace </textarea>
    <button id="save"></button>
  `;
  const input = document.getElementById("roots");
  const button = document.getElementById("save");
  const dependencies = {
    button,
    input,
    isConnected: () => true,
    persistWorkspaceRoots: vi.fn(),
    sendReq: vi.fn(async () => ({ ok: true })),
    makeId: () => "request-1",
    invalidateServerConfigCache: vi.fn(),
    alertUser: vi.fn(),
    t: (_key, _params, fallback) => fallback,
    ...overrides,
  };
  const feature = createWorkspaceRootsSaveFeature(dependencies);
  return { button, input, dependencies, feature };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("workspace roots save lifecycle", () => {
  it("owns the save listener and success feedback timer", async () => {
    vi.useFakeTimers();
    const { button, dependencies, feature } = createHarness();

    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(dependencies.persistWorkspaceRoots).toHaveBeenCalledTimes(1);
    expect(dependencies.sendReq).toHaveBeenCalledWith({
      type: "req",
      id: "request-1",
      method: "config.update",
      params: { updates: { BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:\\workspace" } },
    });
    expect(dependencies.invalidateServerConfigCache).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe("Saved");
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 1,
      pendingRequestCount: 0,
      listenerCount: 1,
      disposed: false,
    });

    await vi.advanceTimersByTimeAsync(1_500);
    expect(button.textContent).toBe("Save");
    expect(feature.getRuntimeSnapshot().activeTimerCount).toBe(0);
  });

  it("invalidates late request commits and unbinds the button on dispose", async () => {
    let resolveRequest;
    const sendReq = vi.fn(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { button, dependencies, feature } = createHarness({ sendReq });

    button.click();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingRequestCount: 1,
      listenerCount: 1,
    });
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      pendingRequestCount: 1,
      listenerCount: 0,
      disposed: true,
    });

    resolveRequest({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    button.click();

    expect(sendReq).toHaveBeenCalledTimes(1);
    expect(dependencies.invalidateServerConfigCache).not.toHaveBeenCalled();
    expect(dependencies.alertUser).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      pendingRequestCount: 0,
      disposed: true,
    });
  });
});
