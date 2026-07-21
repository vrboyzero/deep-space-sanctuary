// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerDreamHistoryDetailEmptyView } from "./memory-viewer-dream-history-detail-empty-view.js";

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
      if (value) throw new Error("Memory Viewer Dream history detail empty state must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer Dream history detail empty DOM owner", () => {
  it("renders and replaces the empty state without an HTML parser", () => {
    const container = document.createElement("div");
    const previous = document.createElement("div");
    previous.textContent = "Old full detail";
    container.append(previous);
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerDreamHistoryDetailEmptyView();

    expect(() => view.render({ container, text: "<img src=x onerror=alert(6)>Loading Dream" })).not.toThrow();

    expect(previous.isConnected).toBe(false);
    expect(container.querySelectorAll(".memory-viewer-empty")).toHaveLength(1);
    expect(container.querySelector(".memory-viewer-empty")?.textContent).toBe("<img src=x onerror=alert(6)>Loading Dream");
    expect(container.querySelector("img, [onerror]")).toBeNull();
    expect(() => view.render({ container: null, text: "Ignored" })).not.toThrow();
  });

  it("owns the empty branch alongside the separate full detail owner", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const panelStart = source.indexOf("function renderDreamHistoryPanel()");
    const panelEnd = source.indexOf("async function loadDreamHistoryDetailInternal", panelStart);
    const panelSource = source.slice(panelStart, panelEnd);

    expect(source).toContain('import { createMemoryViewerDreamHistoryDetailEmptyView }');
    expect(source).toContain("const dreamHistoryDetailEmptyView = createMemoryViewerDreamHistoryDetailEmptyView();");
    expect(panelSource).toContain("dreamHistoryDetailEmptyView.render({");
    expect(panelSource).not.toContain('memoryDreamHistoryDetailEl.innerHTML = `<div class="memory-viewer-empty">');
    expect(panelSource).not.toContain("memoryDreamHistoryDetailEl.innerHTML");
    expect(panelSource).toContain("dreamHistoryDetailView.render({");
  });
});
