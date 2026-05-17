// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createPanelVisibilityFeature } from "./panel-visibility.js";

function createHarness() {
  localStorage.clear();
  document.body.innerHTML = `
    <div id="tokenUsage">
      <span class="token-metric token-metric-in">
        <span class="token-label">IN</span>
        <span class="token-val" id="tuIn">28.9k</span>
      </span>
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
  });

  return { refs, feature };
}

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
});
