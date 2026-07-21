// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createHeaderNavigationFeature } from "./header-navigation.js";
import { HEADER_NAVIGATION_COMMANDS } from "./header-navigation-commands.js";
import {
  createDefaultWebChatRuntimeAdapter,
  createWebChatRuntimeContext,
} from "./webchat-runtime-context.js";

describe("header navigation feature", () => {
  it("opens goals, bridge, and chat pages through the existing shell hooks", async () => {
    const openWebChatTabLink = document.createElement("a");
    const goGoalsPageBtn = document.createElement("button");
    const goBridgePageBtn = document.createElement("button");
    const goChatPageBtn = document.createElement("button");
    const switchMode = vi.fn();
    const loadGoals = vi.fn(async () => {});
    const loadBridgeSessions = vi.fn(async () => {});
    const focusPrompt = vi.fn();

    createHeaderNavigationFeature({
      refs: {
        openWebChatTabLink,
        goGoalsPageBtn,
        goBridgePageBtn,
        goChatPageBtn,
      },
      switchMode,
      loadGoals,
      loadBridgeSessions,
      focusPrompt,
      buildMultiPageUrl: () => "http://127.0.0.1:28889/?authHandoff=test-token",
    });

    expect(openWebChatTabLink.href).toBe("http://127.0.0.1:28889/?authHandoff=test-token");

    await goGoalsPageBtn.click();
    expect(switchMode).toHaveBeenCalledWith("goals");
    expect(loadGoals).toHaveBeenCalledWith(false);

    await goBridgePageBtn.click();
    expect(switchMode).toHaveBeenCalledWith("bridge");
    expect(loadBridgeSessions).toHaveBeenCalledWith(false);

    goChatPageBtn.click();
    expect(switchMode).toHaveBeenCalledWith("chat");
    expect(focusPrompt).toHaveBeenCalled();
  });

  it("routes header commands only while active and rebuilds the link on reactivate", async () => {
    const openWebChatTabLink = document.createElement("a");
    const goGoalsPageBtn = document.createElement("button");
    const goBridgePageBtn = document.createElement("button");
    const goChatPageBtn = document.createElement("button");
    const switchMode = vi.fn();
    const loadGoals = vi.fn();
    const loadBridgeSessions = vi.fn();
    const focusPrompt = vi.fn();
    let nextUrl = "http://127.0.0.1:28889/?authHandoff=before-deactivate";
    const buildMultiPageUrl = vi.fn(() => nextUrl);
    const feature = createHeaderNavigationFeature({
      refs: { openWebChatTabLink, goGoalsPageBtn, goBridgePageBtn, goChatPageBtn },
      switchMode,
      loadGoals,
      loadBridgeSessions,
      focusPrompt,
      buildMultiPageUrl,
    });
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 4, disposed: false });
    expect(openWebChatTabLink.href).toBe(nextUrl);

    expect(feature.deactivate()).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: false });
    openWebChatTabLink.click();
    goGoalsPageBtn.click();
    goBridgePageBtn.click();
    goChatPageBtn.click();
    feature.refreshMultiPageLink();
    feature.openGoalsPage();
    feature.openBridgePage();
    feature.openChatPage();
    expect(buildMultiPageUrl).toHaveBeenCalledTimes(1);
    expect(switchMode).not.toHaveBeenCalled();
    expect(loadGoals).not.toHaveBeenCalled();
    expect(loadBridgeSessions).not.toHaveBeenCalled();
    expect(focusPrompt).not.toHaveBeenCalled();

    nextUrl = "http://127.0.0.1:28889/?authHandoff=after-reactivate";
    expect(feature.activate()).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 4, disposed: false });
    expect(openWebChatTabLink.href).toBe(nextUrl);
    expect(buildMultiPageUrl).toHaveBeenCalledTimes(2);
    openWebChatTabLink.click();
    goGoalsPageBtn.click();
    goBridgePageBtn.click();
    goChatPageBtn.click();
    await Promise.resolve();
    expect(buildMultiPageUrl).toHaveBeenCalledTimes(3);
    expect(switchMode.mock.calls).toEqual([["goals"], ["bridge"], ["chat"]]);
    expect(loadGoals).toHaveBeenCalledWith(false);
    expect(loadBridgeSessions).toHaveBeenCalledWith(false);
    expect(focusPrompt).toHaveBeenCalledTimes(1);

    feature.dispose();
    feature.dispose();
    expect(feature.activate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    openWebChatTabLink.click();
    goGoalsPageBtn.click();
    goBridgePageBtn.click();
    goChatPageBtn.click();
    feature.refreshMultiPageLink();
    feature.openGoalsPage();
    feature.openBridgePage();
    feature.openChatPage();
    await Promise.resolve();
    expect(buildMultiPageUrl).toHaveBeenCalledTimes(3);
    expect(switchMode).toHaveBeenCalledTimes(3);
    expect(loadGoals).toHaveBeenCalledTimes(1);
    expect(loadBridgeSessions).toHaveBeenCalledTimes(1);
    expect(focusPrompt).toHaveBeenCalledTimes(1);
  });

  it("routes cross-panel modes through the replaceable runtime context", async () => {
    const goGoalsPageBtn = document.createElement("button");
    const goBridgePageBtn = document.createElement("button");
    const goChatPageBtn = document.createElement("button");
    const addListenerSpy = vi.spyOn(goGoalsPageBtn, "addEventListener");
    const firstSwitchMode = vi.fn();
    const secondSwitchMode = vi.fn();
    const legacySwitchMode = vi.fn();
    const loadGoals = vi.fn();
    const loadBridgeSessions = vi.fn();
    const focusPrompt = vi.fn();
    const runtimeContext = createWebChatRuntimeContext({
      adapter: createDefaultWebChatRuntimeAdapter({ switchMode: firstSwitchMode }),
    });
    const feature = createHeaderNavigationFeature({
      refs: { goGoalsPageBtn, goBridgePageBtn, goChatPageBtn },
      runtimeContext,
      switchMode: legacySwitchMode,
      loadGoals,
      loadBridgeSessions,
      focusPrompt,
    });
    const retainedGoalsListener = addListenerSpy.mock.calls.find(([type]) => type === "click")?.[1];

    goGoalsPageBtn.click();
    await Promise.resolve();
    expect(firstSwitchMode).toHaveBeenCalledWith("goals");
    expect(loadGoals).toHaveBeenCalledWith(false);
    expect(legacySwitchMode).not.toHaveBeenCalled();

    expect(runtimeContext.replaceAdapter(
      createDefaultWebChatRuntimeAdapter({ switchMode: secondSwitchMode }),
    )).toBe(true);
    goBridgePageBtn.click();
    goChatPageBtn.click();
    await Promise.resolve();
    expect(firstSwitchMode).toHaveBeenCalledTimes(1);
    expect(secondSwitchMode.mock.calls).toEqual([["bridge"], ["chat"]]);
    expect(loadBridgeSessions).toHaveBeenCalledWith(false);
    expect(focusPrompt).toHaveBeenCalledTimes(1);

    expect(feature.deactivate()).toBe(true);
    goGoalsPageBtn.click();
    await retainedGoalsListener?.({ type: "click" });
    expect(secondSwitchMode).toHaveBeenCalledTimes(2);

    expect(feature.activate()).toBe(true);
    goGoalsPageBtn.click();
    await Promise.resolve();
    expect(secondSwitchMode).toHaveBeenLastCalledWith("goals");
    expect(feature.dispose()).toBe(true);
    expect(feature.dispose()).toBe(false);
    expect(feature.activate()).toBe(false);
    goGoalsPageBtn.click();
    await retainedGoalsListener?.({ type: "click" });
    expect(secondSwitchMode).toHaveBeenCalledTimes(3);
  });

  it("switches panel mode before dispatching each header command", async () => {
    const goGoalsPageBtn = document.createElement("button");
    const goBridgePageBtn = document.createElement("button");
    const goChatPageBtn = document.createElement("button");
    const order = [];
    const runtimeContext = createWebChatRuntimeContext({
      adapter: createDefaultWebChatRuntimeAdapter({
        switchMode: (mode) => order.push(`mode:${mode}`),
      }),
    });
    const commandDispatcher = {
      dispatch: vi.fn((command) => {
        order.push(`command:${command}`);
      }),
    };
    createHeaderNavigationFeature({
      refs: { goGoalsPageBtn, goBridgePageBtn, goChatPageBtn },
      runtimeContext,
      commandDispatcher,
    });

    goGoalsPageBtn.click();
    goBridgePageBtn.click();
    goChatPageBtn.click();
    await Promise.resolve();
    expect(order).toEqual([
      "mode:goals",
      `command:${HEADER_NAVIGATION_COMMANDS.LOAD_GOALS}`,
      "mode:bridge",
      `command:${HEADER_NAVIGATION_COMMANDS.LOAD_BRIDGE}`,
      "mode:chat",
      `command:${HEADER_NAVIGATION_COMMANDS.FOCUS_CHAT}`,
    ]);
  });
});
