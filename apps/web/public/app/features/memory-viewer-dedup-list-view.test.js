// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerDedupListView } from "./memory-viewer-dedup-list-view.js";

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
      if (value) throw new Error("Memory Viewer dedup list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer dedup list DOM owner", () => {
  it("renders normalized result and report rows without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerDedupListView();
    const rows = [
      {
        title: "<img src=x onerror=alert(1)>keeper chunk-a",
        meta: ["<script>alert(1)</script>删除 1", "迁移 links 2"],
        snippet: "<svg onload=alert(1)>chunk-b",
      },
      {
        title: "<iframe srcdoc=alert(1)>preview",
        meta: ["keeper", "chunk-a", "非默认索引源"],
        snippet: "chunk-b",
      },
    ];

    expect(() => view.render({ container, rows })).not.toThrow();

    const renderedRows = [...container.querySelectorAll(".experience-synthesis-row")];
    expect(renderedRows).toHaveLength(2);
    expect(renderedRows.map((row) => row.querySelector(".experience-synthesis-row-title")?.textContent)).toEqual(rows.map((row) => row.title));
    expect(renderedRows.map((row) => [...row.querySelectorAll(".experience-synthesis-row-meta span")].map((meta) => meta.textContent))).toEqual(rows.map((row) => row.meta));
    expect(renderedRows.map((row) => row.querySelector(".memory-list-item-snippet")?.textContent)).toEqual(rows.map((row) => row.snippet));
    expect(container.querySelectorAll(".experience-synthesis-row-main")).toHaveLength(2);
    expect(container.querySelector("img, script, svg, iframe, [onerror], [onload]")).toBeNull();
  });

  it("replaces rows with an empty state and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerDedupListView();
    view.render({ container, rows: [{ title: "Old", meta: ["Old meta"], snippet: "Old snippet" }] });
    const previousRow = container.firstElementChild;

    view.render({ container, rows: [], emptyText: "<img src=x onerror=alert(2)>Loading" });

    expect(previousRow?.isConnected).toBe(false);
    expect(container.querySelectorAll(".memory-viewer-empty")).toHaveLength(1);
    expect(container.querySelector(".memory-viewer-empty")?.textContent).toBe("<img src=x onerror=alert(2)>Loading");
    expect(container.querySelector("img, [onerror]")).toBeNull();
    expect(() => view.render({ container: null, rows: [] })).not.toThrow();
  });
});
