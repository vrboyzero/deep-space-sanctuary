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
  const style = document.createElement("style");
  style.setAttribute("data-ui03-runtime-stylesheet", "true");
  document.head.append(style);
  const promptEl = document.createElement("textarea");
  Object.defineProperty(promptEl, "scrollHeight", {
    configurable: true,
    get: () => 72,
  });
  document.body.appendChild(promptEl);
  return promptEl;
}

function getRuntimeStyleValue(element, property) {
  const style = document.head.querySelector("style[data-ui03-runtime-stylesheet]");
  const className = [...element.classList].find((name) => name.startsWith("webchat-runtime-style-"));
  return [...(style?.sheet?.cssRules ?? [])]
    .find((rule) => rule.selectorText === `.${className}`)
    ?.style.getPropertyValue(property);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll("style[data-ui03-runtime-stylesheet]").forEach((element) => element.remove());
  document.body.replaceChildren();
});

describe("prompt controller lifecycle", () => {
  it("owns listeners and the pending frame across activation cycles", () => {
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
    expect(controller.deactivate()).toBe(true);
    expect(controller.deactivate()).toBe(false);
    expect(frames.cancel).toHaveBeenCalledWith(frameHandle);
    expect(controller.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingFrameCount: 0,
      pendingFontReadyCount: 0,
      disposed: false,
    });

    controller.restoreText("inactive");
    controller.syncHeight();
    promptEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    promptEl.dispatchEvent(new Event("input"));
    frames.run(frameHandle);
    expect(promptEl.value).toBe("hello");
    expect(getRuntimeStyleValue(promptEl, "height")).toBe("24px");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(frames.schedule).toHaveBeenCalledTimes(1);

    expect(controller.activate()).toBe(true);
    expect(getRuntimeStyleValue(promptEl, "height")).toBe("72px");
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 2,
      pendingFrameCount: 0,
      disposed: false,
    });
    controller.restoreText("restored");
    promptEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(promptEl.value).toBe("restored");
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(frames.schedule).toHaveBeenCalledTimes(2);

    const [reactivatedFrameHandle] = frames.callbacks.keys();
    controller.dispose();
    expect(controller.activate()).toBe(false);
    expect(frames.cancel).toHaveBeenCalledWith(reactivatedFrameHandle);
    expect(controller.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingFrameCount: 0,
      pendingFontReadyCount: 0,
      disposed: true,
    });
  });

  it("settles document fonts while inactive and remeasures only after reactivate", async () => {
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

    expect(controller.deactivate()).toBe(true);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 0,
      pendingFontReadyCount: 1,
      disposed: false,
    });
    fontReady.resolve();
    await flushPromises();
    expect(getComputedStyleSpy).toHaveBeenCalledTimes(1);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingFontReadyCount: 0,
      disposed: false,
    });

    expect(controller.activate()).toBe(true);
    expect(getComputedStyleSpy).toHaveBeenCalledTimes(2);
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 2,
      pendingFontReadyCount: 0,
      disposed: false,
    });
    controller.dispose();
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

    expect(getRuntimeStyleValue(promptEl, "height")).toBe("72px");
    expect(getRuntimeStyleValue(promptEl, "overflow-y")).toBe("hidden");
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      pendingFrameCount: 0,
      disposed: false,
    });
  });
});
