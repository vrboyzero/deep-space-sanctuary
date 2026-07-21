// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerEmptyStateFeature } from "./memory-viewer-empty-state.js";

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
      if (value) throw new Error("Memory Viewer empty state must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer empty state DOM owner", () => {
  it("renders list and detail messages as text without using the HTML parser", () => {
    document.body.innerHTML = `
      <div id="memoryViewerList"></div>
      <div id="memoryViewerDetail"></div>
    `;
    const memoryViewerListEl = document.getElementById("memoryViewerList");
    const memoryViewerDetailEl = document.getElementById("memoryViewerDetail");
    blockNonEmptyInnerHtml(memoryViewerListEl);
    blockNonEmptyInnerHtml(memoryViewerDetailEl);
    const feature = createMemoryViewerEmptyStateFeature({
      refs: { memoryViewerListEl, memoryViewerDetailEl },
    });
    const listMessage = '<img src=x onerror="alert(1)">list message';
    const detailMessage = "<script>detail message</script>";

    expect(() => feature.renderListEmpty(listMessage)).not.toThrow();
    expect(() => feature.renderDetailEmpty(detailMessage)).not.toThrow();
    expect(memoryViewerListEl.children).toHaveLength(1);
    expect(memoryViewerListEl.firstElementChild.className).toBe("memory-viewer-empty");
    expect(memoryViewerListEl.firstElementChild.textContent).toBe(listMessage);
    expect(memoryViewerDetailEl.children).toHaveLength(1);
    expect(memoryViewerDetailEl.firstElementChild.className).toBe("memory-viewer-empty");
    expect(memoryViewerDetailEl.firstElementChild.textContent).toBe(detailMessage);
    expect(document.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("treats missing list and detail panels as no-op", () => {
    const feature = createMemoryViewerEmptyStateFeature({
      refs: { memoryViewerListEl: null, memoryViewerDetailEl: null },
    });

    expect(() => feature.renderListEmpty("list")).not.toThrow();
    expect(() => feature.renderDetailEmpty("detail")).not.toThrow();
  });
});
