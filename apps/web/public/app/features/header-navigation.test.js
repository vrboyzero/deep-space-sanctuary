// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createHeaderNavigationFeature } from "./header-navigation.js";

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

  it("releases header listeners and rejects navigation after dispose", () => {
    const openWebChatTabLink = document.createElement("a");
    const goGoalsPageBtn = document.createElement("button");
    const goBridgePageBtn = document.createElement("button");
    const goChatPageBtn = document.createElement("button");
    const switchMode = vi.fn();
    const loadGoals = vi.fn();
    const loadBridgeSessions = vi.fn();
    const focusPrompt = vi.fn();
    const buildMultiPageUrl = vi.fn(() => "http://127.0.0.1:28889/?authHandoff=before-dispose");
    const feature = createHeaderNavigationFeature({
      refs: { openWebChatTabLink, goGoalsPageBtn, goBridgePageBtn, goChatPageBtn },
      switchMode,
      loadGoals,
      loadBridgeSessions,
      focusPrompt,
      buildMultiPageUrl,
    });
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 4, disposed: false });

    feature.dispose();
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });

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
  });
});
