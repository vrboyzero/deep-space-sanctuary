// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBootSequenceFeature } from "./boot-sequence.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("boot sequence lifecycle", () => {
  it("runs the active boot sequence and releases every settled timer", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="awakening" class="hidden">
        <div id="bootLog"></div>
      </div>
    `;
    const feature = createBootSequenceFeature({ random: () => 0 });

    const play = feature.play();
    expect(document.getElementById("awakening").classList.contains("hidden")).toBe(false);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 1,
      running: true,
      disposed: false,
    });

    await vi.advanceTimersByTimeAsync(1_400);

    await expect(play).resolves.toBe(true);
    expect(document.querySelectorAll(".boot-line")).toHaveLength(6);
    expect(document.getElementById("awakening").classList.contains("hidden")).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({
      activeTimerCount: 0,
      activeListenerCount: 0,
      running: false,
      disposed: false,
    });
  });

  it("settles a pending play and releases its timer when disposed", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="awakening" class="hidden">
        <div id="bootLog"></div>
      </div>
    `;
    const feature = createBootSequenceFeature({ random: () => 0 });

    const play = feature.play();
    expect(document.querySelectorAll(".boot-line")).toHaveLength(1);

    feature.dispose();
    feature.dispose();
    await expect(play).resolves.toBe(false);
    await vi.runAllTimersAsync();

    expect(document.querySelectorAll(".boot-line")).toHaveLength(1);
    expect(feature.getRuntimeSnapshot()).toEqual({
      activeTimerCount: 0,
      activeListenerCount: 0,
      running: false,
      disposed: true,
    });
  });

  it("settles replacement when required boot nodes disappear", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="awakening" class="hidden">
        <div id="bootLog"></div>
      </div>
    `;
    const feature = createBootSequenceFeature({ random: () => 0 });
    const firstPlay = feature.play();

    document.body.replaceChildren();
    const replacementPlay = feature.play();

    await expect(firstPlay).resolves.toBe(false);
    await expect(replacementPlay).resolves.toBe(false);
    expect(feature.getRuntimeSnapshot()).toEqual({
      activeTimerCount: 0,
      activeListenerCount: 0,
      running: false,
      disposed: false,
    });
  });
});
