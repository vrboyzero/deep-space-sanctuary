// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { initPromptController } from "./prompt.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createFrameHarness() {
  let nextHandle = 1;
  const callbacks = new Map();
  return {
    cancel: vi.fn((handle) => callbacks.delete(handle)),
    callbacks,
    run(handle) {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.();
    },
    schedule: vi.fn((callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }),
  };
}

function createPrompt() {
  const promptEl = document.createElement("textarea");
  Object.defineProperty(promptEl, "scrollHeight", {
    configurable: true,
    get: () => 72,
  });
  document.body.appendChild(promptEl);
  return promptEl;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("prompt controller lifecycle", () => {
  it("coalesces keydown frames and releases listeners and the pending frame", () => {
    const frames = createFrameHarness();
    const promptEl = createPrompt();
    const onSubmit = vi.fn();
    const controller = initPromptController({
      promptEl,
      onSubmit,
      documentRef: {},
      requestAnimationFrameFn: frames.schedule,
      cancelAnimationFrameFn: frames.cancel,
    });

    promptEl.value = "hello";
    promptEl.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    promptEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(frames.schedule).toHaveBeenCalledTimes(1);
    expect(controller.getRuntimeSnapshot()).toEqual({
      listenerCount: 2,
      pendingFrameCount: 1,
      pendingFontReadyCount: 0,
      disposed: false,
    });

    const [frameHandle] = frames.callbacks.keys();
    controller.dispose();
    expect(frames.cancel).toHaveBeenCalledWith(frameHandle);
    expect(controller.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingFrameCount: 0,
      pendingFontReadyCount: 0,
      disposed: true,
    });

    promptEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    promptEl.dispatchEvent(new Event("input"));
    frames.run(frameHandle);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(frames.schedule).toHaveBeenCalledTimes(1);
  });

  it("ignores a late document fonts settlement after dispose", async () => {
    const fontReady = createDeferred();
    const frames = createFrameHarness();
    const promptEl = createPrompt();
    const getComputedStyleSpy = vi.spyOn(globalThis, "getComputedStyle");
    const controller = initPromptController({
      promptEl,
      documentRef: { fonts: { ready: fontReady.promise } },
      requestAnimationFrameFn: frames.schedule,
      cancelAnimationFrameFn: frames.cancel,
    });
    expect(getComputedStyleSpy).toHaveBeenCalledTimes(1);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingFontReadyCount: 1,
      disposed: false,
    });

    controller.dispose();
    fontReady.resolve();
    await flushPromises();
    expect(getComputedStyleSpy).toHaveBeenCalledTimes(1);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingFontReadyCount: 0,
      disposed: true,
    });
  });

  it("settles the coalesced frame and keeps normal height sync behavior", () => {
    const frames = createFrameHarness();
    const promptEl = createPrompt();
    const controller = initPromptController({
      promptEl,
      documentRef: {},
      requestAnimationFrameFn: frames.schedule,
      cancelAnimationFrameFn: frames.cancel,
    });

    promptEl.value = "hello";
    promptEl.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    const [frameHandle] = frames.callbacks.keys();
    frames.run(frameHandle);

    expect(promptEl.style.height).toBe("72px");
    expect(promptEl.style.overflowY).toBe("hidden");
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingFrameCount: 0,
      disposed: false,
    });
  });
});
