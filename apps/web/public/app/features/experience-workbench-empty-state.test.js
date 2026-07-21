// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchEmptyStateFeature } from "./experience-workbench-empty-state.js";

afterEach(() => {
  document.body.replaceChildren();
});

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Experience Workbench empty state must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Workbench empty state DOM owner", () => {
  it("renders all top-level empty messages as text without using the HTML parser", () => {
    document.body.innerHTML = `
      <div id="list"></div>
      <div id="detail"></div>
      <div id="usage"></div>
      <div id="capability"></div>
    `;
    const refs = {
      experienceWorkbenchListEl: document.getElementById("list"),
      experienceWorkbenchDetailEl: document.getElementById("detail"),
      experienceWorkbenchUsageOverviewEl: document.getElementById("usage"),
      experienceWorkbenchCapabilityOverviewEl: document.getElementById("capability"),
    };
    Object.values(refs).forEach(blockNonEmptyInnerHtml);
    const feature = createExperienceWorkbenchEmptyStateFeature({ refs });
    const messages = {
      list: '<img src=x onerror="alert(1)">list',
      detail: "<script>detail</script>",
      usage: "<svg onload=alert(1)>usage</svg>",
      capability: "<a href=javascript:alert(1)>capability</a>",
    };

    expect(() => feature.renderListEmpty(messages.list)).not.toThrow();
    expect(() => feature.renderDetailEmpty(messages.detail)).not.toThrow();
    expect(() => feature.renderUsageOverviewEmpty(messages.usage)).not.toThrow();
    expect(() => feature.renderCapabilityOverviewEmpty(messages.capability)).not.toThrow();

    const expected = [
      [refs.experienceWorkbenchListEl, messages.list],
      [refs.experienceWorkbenchDetailEl, messages.detail],
      [refs.experienceWorkbenchUsageOverviewEl, messages.usage],
      [refs.experienceWorkbenchCapabilityOverviewEl, messages.capability],
    ];
    for (const [panel, message] of expected) {
      expect(panel.children).toHaveLength(1);
      expect(panel.firstElementChild.className).toBe("memory-viewer-empty");
      expect(panel.firstElementChild.textContent).toBe(message);
    }
    expect(document.querySelector("img, script, svg, a, [onerror], [onload]")).toBeNull();
  });

  it("treats missing top-level panels as no-op", () => {
    const feature = createExperienceWorkbenchEmptyStateFeature({
      refs: {
        experienceWorkbenchListEl: null,
        experienceWorkbenchDetailEl: null,
        experienceWorkbenchUsageOverviewEl: null,
        experienceWorkbenchCapabilityOverviewEl: null,
      },
    });

    expect(() => feature.renderListEmpty("list")).not.toThrow();
    expect(() => feature.renderDetailEmpty("detail")).not.toThrow();
    expect(() => feature.renderUsageOverviewEmpty("usage")).not.toThrow();
    expect(() => feature.renderCapabilityOverviewEmpty("capability")).not.toThrow();
  });
});
