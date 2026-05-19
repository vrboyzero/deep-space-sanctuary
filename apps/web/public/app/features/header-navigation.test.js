// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createHeaderNavigationFeature } from "./header-navigation.js";

describe("header navigation feature", () => {
  it("opens goals and chat pages through the existing shell hooks", async () => {
    const openWebChatTabLink = document.createElement("a");
    const goGoalsPageBtn = document.createElement("button");
    const goChatPageBtn = document.createElement("button");
    const switchMode = vi.fn();
    const loadGoals = vi.fn(async () => {});
    const focusPrompt = vi.fn();

    createHeaderNavigationFeature({
      refs: {
        openWebChatTabLink,
        goGoalsPageBtn,
        goChatPageBtn,
      },
      switchMode,
      loadGoals,
      focusPrompt,
      buildMultiPageUrl: () => "http://127.0.0.1:28889/?authHandoff=test-token",
    });

    expect(openWebChatTabLink.href).toBe("http://127.0.0.1:28889/?authHandoff=test-token");

    await goGoalsPageBtn.click();
    expect(switchMode).toHaveBeenCalledWith("goals");
    expect(loadGoals).toHaveBeenCalledWith(false);

    goChatPageBtn.click();
    expect(switchMode).toHaveBeenCalledWith("chat");
    expect(focusPrompt).toHaveBeenCalled();
  });
});
