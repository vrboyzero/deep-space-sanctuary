import { describe, expect, it, vi } from "vitest";

import {
  HEADER_NAVIGATION_COMMANDS,
  createHeaderNavigationCommandOwner,
  createLegacyHeaderNavigationCommandAdapter,
} from "./header-navigation-commands.js";

describe("header navigation command owner", () => {
  it("maps the legacy callback bundle to the three fixed commands", async () => {
    const loadGoals = vi.fn().mockResolvedValue("goals");
    const loadBridgeSessions = vi.fn().mockResolvedValue("bridge");
    const focusPrompt = vi.fn(() => "focused");
    const adapter = createLegacyHeaderNavigationCommandAdapter({
      loadGoals,
      loadBridgeSessions,
      focusPrompt,
    });

    await expect(adapter.dispatch(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS)).resolves.toBe("goals");
    await expect(adapter.dispatch(HEADER_NAVIGATION_COMMANDS.LOAD_BRIDGE)).resolves.toBe("bridge");
    expect(adapter.dispatch(HEADER_NAVIGATION_COMMANDS.FOCUS_CHAT)).toBe("focused");
    expect(adapter.dispatch("header.navigation.unknown")).toBeUndefined();
    expect(loadGoals).toHaveBeenCalledWith(false);
    expect(loadBridgeSessions).toHaveBeenCalledWith(false);
    expect(focusPrompt).toHaveBeenCalledTimes(1);
  });

  it("dispatches registered commands in order and preserves active errors", async () => {
    const owner = createHeaderNavigationCommandOwner();
    const order = [];
    const activeError = new Error("goals failed");
    owner.register(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS, async () => {
      order.push("goals");
      return "loaded";
    });
    owner.register(HEADER_NAVIGATION_COMMANDS.LOAD_BRIDGE, async () => {
      order.push("bridge");
      throw activeError;
    });

    await expect(owner.dispatch(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS)).resolves.toEqual({
      handled: true,
      stale: false,
      value: "loaded",
    });
    await expect(owner.dispatch(HEADER_NAVIGATION_COMMANDS.LOAD_BRIDGE)).rejects.toBe(activeError);
    expect(order).toEqual(["goals", "bridge"]);
    expect(owner.getRuntimeSnapshot()).toEqual({
      registeredHeaderNavigationCommandCount: 2,
      pendingHeaderNavigationCommandCount: 0,
      headerNavigationCommandDisposed: false,
    });
  });

  it("suppresses replaced late results and releases handlers on dispose", async () => {
    const owner = createHeaderNavigationCommandOwner();
    let resolveFirst;
    const firstHandler = vi.fn(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const secondHandler = vi.fn().mockResolvedValue("second");
    const unregisterFirst = owner.register(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS, firstHandler);
    const firstDispatch = owner.dispatch(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS);

    owner.register(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS, secondHandler);
    expect(unregisterFirst()).toBe(false);
    resolveFirst("first");
    await expect(firstDispatch).resolves.toEqual({
      handled: false,
      stale: true,
      value: undefined,
    });
    await expect(owner.dispatch(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS)).resolves.toEqual({
      handled: true,
      stale: false,
      value: "second",
    });
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);

    expect(owner.dispose()).toBe(true);
    expect(owner.dispose()).toBe(false);
    expect(owner.register(HEADER_NAVIGATION_COMMANDS.FOCUS_CHAT, vi.fn())).toBeNull();
    await expect(owner.dispatch(HEADER_NAVIGATION_COMMANDS.LOAD_GOALS)).resolves.toEqual({
      handled: false,
      stale: true,
      value: undefined,
    });
    expect(owner.getRuntimeSnapshot()).toEqual({
      registeredHeaderNavigationCommandCount: 0,
      pendingHeaderNavigationCommandCount: 0,
      headerNavigationCommandDisposed: true,
    });
  });
});
