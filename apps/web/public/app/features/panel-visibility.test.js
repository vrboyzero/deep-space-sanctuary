// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPanelVisibilityFeature } from "./panel-visibility.js";

function createHarness(options = {}) {
  localStorage.clear();
  document.body.innerHTML = `
    <div id="tokenUsage">
      <span class="token-metric token-metric-in">
        <span class="token-label">IN</span>
        <span class="token-val" id="tuIn">28.9k</span>
      </span>
      <span class="token-metric token-metric-ret">
        <span class="token-label">RET</span>
        <span class="token-val" id="tuRet">18.4k</span>
      </span>
      <span class="token-metric token-metric-nxt">
        <span class="token-label">NXT</span>
        <span class="token-val" id="tuNxt">23.1k</span>
      </span>
      <span class="token-usage-observability"></span>
    </div>
    <aside id="sidebar"></aside>
    <button id="toggleContentPanelBtn" type="button">Content</button>
    <section id="controlPanel"></section>
    <button id="toggleControlPanelBtn" type="button">Controls</button>
    <aside id="agentRightPanel" class="hidden"></aside>
    <button id="toggleAgentPanelBtn" type="button">Agent Info</button>
  `;

  const refs = {
    tokenUsageEl: document.getElementById("tokenUsage"),
    sidebarEl: document.getElementById("sidebar"),
    toggleContentPanelBtn: document.getElementById("toggleContentPanelBtn"),
    controlPanelEl: document.getElementById("controlPanel"),
    toggleControlPanelBtn: document.getElementById("toggleControlPanelBtn"),
    agentRightPanelEl: document.getElementById("agentRightPanel"),
    toggleAgentPanelBtn: document.getElementById("toggleAgentPanelBtn"),
  };

  const feature = createPanelVisibilityFeature({
    refs,
    storageKeys: {
      tokenUsageCollapsedKey: "test.token.collapsed",
      contentPanelVisibleKey: "test.content.visible",
      controlPanelVisibleKey: "test.panel.visible",
      agentPanelVisibleKey: "test.agent.visible",
    },
    defaults: {
      tokenUsageCollapsed: true,
      contentPanelVisible: false,
      controlPanelVisible: false,
      agentPanelVisible: false,
    },
    t: (_key, _params, fallback) => fallback ?? "",
    ...options,
  });

  return { refs, feature };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("panel visibility feature", () => {
  it("starts with a lightweight default layout", () => {
    const { refs, feature } = createHarness();

    expect(feature.getState()).toMatchObject({
      tokenUsageCollapsed: true,
      contentPanelVisible: false,
      controlPanelVisible: false,
      agentPanelVisible: false,
      agentPanelHasContent: false,
    });
    expect(refs.tokenUsageEl.classList.contains("is-collapsed")).toBe(true);
    expect(refs.sidebarEl.classList.contains("hidden")).toBe(true);
    expect(refs.controlPanelEl.classList.contains("hidden")).toBe(true);
    expect(refs.agentRightPanelEl.classList.contains("hidden")).toBe(true);
    expect(document.body.classList.contains("control-panel-hidden")).toBe(true);
    expect(refs.tokenUsageEl.textContent).toContain("NXT");
  });

  it("toggles token usage and persists the collapsed state", () => {
    const { refs } = createHarness();

    refs.tokenUsageEl.click();

    expect(refs.tokenUsageEl.classList.contains("is-collapsed")).toBe(false);
    expect(localStorage.getItem("test.token.collapsed")).toBe("0");
  });

  it("shows the content panel after the header toggle is clicked", () => {
    const { refs } = createHarness();

    refs.toggleContentPanelBtn.click();

    expect(refs.sidebarEl.classList.contains("hidden")).toBe(false);
    expect(refs.toggleContentPanelBtn.classList.contains("is-active")).toBe(true);
    expect(localStorage.getItem("test.content.visible")).toBe("1");
  });

  it("shows the control panel after the header toggle is clicked", () => {
    const { refs } = createHarness();

    refs.toggleControlPanelBtn.click();

    expect(refs.controlPanelEl.classList.contains("hidden")).toBe(false);
    expect(refs.toggleControlPanelBtn.classList.contains("is-active")).toBe(true);
    expect(localStorage.getItem("test.panel.visible")).toBe("1");
    expect(document.body.classList.contains("control-panel-hidden")).toBe(false);
  });

  it("only reveals the agent panel when both content and user visibility are enabled", () => {
    const { refs, feature } = createHarness();

    refs.toggleAgentPanelBtn.click();
    expect(refs.agentRightPanelEl.classList.contains("hidden")).toBe(false);
    expect(refs.agentRightPanelEl.classList.contains("is-empty")).toBe(true);

    feature.setAgentPanelHasContent(true);

    expect(refs.agentRightPanelEl.classList.contains("hidden")).toBe(false);
    expect(refs.agentRightPanelEl.classList.contains("is-empty")).toBe(false);
    expect(refs.toggleAgentPanelBtn.classList.contains("is-active")).toBe(true);
    expect(localStorage.getItem("test.agent.visible")).toBe("1");
  });

  it("owns panel listeners and the observability frame across activation cycles", () => {
    let nextFrameHandle = 1;
    const frames = new Map();
    const requestAnimationFrame = vi.fn((callback) => {
      const handle = nextFrameHandle++;
      frames.set(handle, callback);
      return handle;
    });
    const cancelAnimationFrame = vi.fn((handle) => frames.delete(handle));
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const windowRef = new EventTarget();
    const onContentPanelVisibleChange = vi.fn();
    const { refs, feature } = createHarness({ windowRef, onContentPanelVisibleChange });

    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 6,
      pendingFrameCount: 1,
      disposed: false,
    });
    windowRef.dispatchEvent(new Event("resize"));
    expect(feature.getRuntimeSnapshot().pendingFrameCount).toBe(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);

    const stateBeforeDeactivate = feature.getState();
    expect(feature.deactivate()).toBe(true);
    expect(feature.deactivate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingFrameCount: 0,
      disposed: false,
    });
    expect(frames.size).toBe(0);

    refs.tokenUsageEl.classList.remove("is-collapsed");
    refs.sidebarEl.classList.remove("hidden");
    refs.controlPanelEl.classList.remove("hidden");
    refs.agentRightPanelEl.classList.remove("hidden");
    const inactiveKeydown = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    refs.tokenUsageEl.click();
    refs.tokenUsageEl.dispatchEvent(inactiveKeydown);
    refs.toggleContentPanelBtn.click();
    refs.toggleControlPanelBtn.click();
    refs.toggleAgentPanelBtn.click();
    windowRef.dispatchEvent(new Event("resize"));
    feature.setContentPanelVisible(true);
    feature.setAgentPanelHasContent(true);
    feature.refreshLocale();
    expect(inactiveKeydown.defaultPrevented).toBe(false);
    expect(feature.getState()).toEqual(stateBeforeDeactivate);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(onContentPanelVisibleChange).not.toHaveBeenCalled();
    expect(localStorage.getItem("test.content.visible")).toBeNull();
    expect(localStorage.getItem("test.agent.visible")).toBeNull();

    expect(feature.activate()).toBe(true);
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 6,
      pendingFrameCount: 1,
      disposed: false,
    });
    expect(refs.tokenUsageEl.classList.contains("is-collapsed")).toBe(true);
    expect(refs.sidebarEl.classList.contains("hidden")).toBe(true);
    expect(refs.controlPanelEl.classList.contains("hidden")).toBe(true);
    expect(refs.agentRightPanelEl.classList.contains("hidden")).toBe(true);

    refs.tokenUsageEl.click();
    const activeKeydown = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    refs.tokenUsageEl.dispatchEvent(activeKeydown);
    refs.toggleContentPanelBtn.click();
    refs.toggleControlPanelBtn.click();
    refs.toggleAgentPanelBtn.click();
    feature.setAgentPanelHasContent(true);
    windowRef.dispatchEvent(new Event("resize"));
    expect(activeKeydown.defaultPrevented).toBe(true);
    expect(feature.getState()).toEqual({
      tokenUsageCollapsed: true,
      contentPanelVisible: true,
      controlPanelVisible: true,
      agentPanelVisible: true,
      agentPanelHasContent: true,
    });
    expect(onContentPanelVisibleChange).toHaveBeenCalledOnce();

    const stateBeforeDispose = feature.getState();
    feature.dispose();
    feature.dispose();
    expect(feature.activate()).toBe(false);
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      pendingFrameCount: 0,
      disposed: true,
    });
    expect(frames.size).toBe(0);

    refs.tokenUsageEl.click();
    refs.tokenUsageEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    refs.toggleContentPanelBtn.click();
    refs.toggleControlPanelBtn.click();
    refs.toggleAgentPanelBtn.click();
    windowRef.dispatchEvent(new Event("resize"));
    feature.setContentPanelVisible(false);
    feature.setAgentPanelHasContent(false);
    feature.refreshLocale();
    expect(feature.getState()).toEqual(stateBeforeDispose);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(6);
  });
});
