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
      if (value) throw new Error("Experience Synthesis placeholder must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Synthesis placeholder DOM owner", () => {
  it("replaces loading and no-data states with plain text", () => {
    const listEl = document.createElement("div");
    document.body.append(listEl);
    blockNonEmptyInnerHtml(listEl);
    const feature = createExperienceWorkbenchEmptyStateFeature({
      refs: { experienceSynthesisModalListEl: listEl },
    });
    const loadingMessage = '<img src=x onerror="alert(1)">loading';
    const emptyMessage = "<script>no data</script>";

    expect(() => feature.renderSynthesisListEmpty(loadingMessage)).not.toThrow();
    expect(listEl.firstElementChild.className).toBe("memory-viewer-empty");
    expect(listEl.firstElementChild.textContent).toBe(loadingMessage);
    expect(() => feature.renderSynthesisListEmpty(emptyMessage)).not.toThrow();
    expect(listEl.children).toHaveLength(1);
    expect(listEl.firstElementChild.textContent).toBe(emptyMessage);
    expect(document.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("treats a missing synthesis list as no-op", () => {
    const feature = createExperienceWorkbenchEmptyStateFeature({
      refs: { experienceSynthesisModalListEl: null },
    });
    expect(() => feature.renderSynthesisListEmpty("loading")).not.toThrow();
  });
});
