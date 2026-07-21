// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerMemoryListView } from "./memory-viewer-memory-list-view.js";

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
      if (value) throw new Error("Memory Viewer memory list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer memory list DOM owner", () => {
  it("renders diagnostics, memory rows, and pagination without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerMemoryListView();
    const memoryId = 'mem"><img src=x onerror=alert(1)>';

    expect(() => view.render({
      container,
      diagnostics: {
        title: "<script>alert(2)</script>Diagnostics",
        badges: ["<svg onload=alert(3)>raw 5", "score 4", "rerank 3", "final 2"],
        lines: [
          "<img src=x onerror=alert(4)>mode=explicit",
          "source mix: curated:1",
          "top hits: mem-1",
        ],
      },
      rows: [
        {
          id: memoryId,
          isActive: true,
          title: "<iframe srcdoc='<script>alert(5)</script>'>Memory",
          meta: [
            { text: "note" },
            { text: "conversation" },
            { text: "private", kind: "private" },
            { text: "hybrid", kind: "hybrid" },
            { text: "<math><mtext>decision</mtext></math>", kind: "badge" },
            { text: "score <object data=x>0.9" },
          ],
          snippet: "<img src=x onerror=alert(6)>Summary",
        },
      ],
      pagination: {
        summary: "<img src=x onerror=alert(7)>Showing 1-20 / 21",
        previousLabel: "< Prev",
        nextLabel: "Next >",
        previousDisabled: true,
        nextDisabled: false,
      },
    })).not.toThrow();

    expect([...container.children].map((node) => node.className)).toEqual([
      "memory-detail-card",
      "memory-list-item active",
      "memory-list-pagination",
    ]);
    const diagnostics = container.querySelector(".memory-detail-card");
    expect(diagnostics?.querySelector(".memory-detail-title")?.textContent).toBe("<script>alert(2)</script>Diagnostics");
    expect([...diagnostics?.querySelectorAll(".memory-detail-badges .memory-badge") ?? []].map((node) => node.textContent))
      .toEqual(["<svg onload=alert(3)>raw 5", "score 4", "rerank 3", "final 2"]);
    expect([...diagnostics?.querySelectorAll(".memory-detail-text") ?? []].map((node) => node.textContent)).toEqual([
      "<img src=x onerror=alert(4)>mode=explicit",
      "source mix: curated:1",
      "top hits: mem-1",
    ]);

    const row = container.querySelector("[data-memory-id]");
    expect(row?.getAttribute("data-memory-id")).toBe(memoryId);
    expect(row?.querySelector(".memory-list-item-title")?.textContent)
      .toBe("<iframe srcdoc='<script>alert(5)</script>'>Memory");
    expect([...row?.querySelectorAll(".memory-list-item-meta span") ?? []].map((node) => ({
      text: node.textContent,
      className: node.className,
    }))).toEqual([
      { text: "note", className: "" },
      { text: "conversation", className: "" },
      { text: "private", className: "memory-badge memory-badge-private" },
      { text: "hybrid", className: "memory-badge memory-badge-hybrid" },
      { text: "<math><mtext>decision</mtext></math>", className: "memory-badge" },
      { text: "score <object data=x>0.9", className: "" },
    ]);
    expect(row?.querySelector(".memory-list-item-snippet")?.textContent).toBe("<img src=x onerror=alert(6)>Summary");

    const buttons = [...container.querySelectorAll("[data-memory-list-page-action]")];
    expect(buttons.map((button) => button.getAttribute("data-memory-list-page-action"))).toEqual(["prev", "next"]);
    expect(buttons.map((button) => ({ text: button.textContent, disabled: button.disabled }))).toEqual([
      { text: "< Prev", disabled: true },
      { text: "Next >", disabled: false },
    ]);
    expect(container.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]")).toBeNull();
  });

  it("omits optional sections, replaces prior content, and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerMemoryListView();
    view.render({
      container,
      diagnostics: { title: "Diagnostics", badges: [], lines: [] },
      rows: [{ id: "mem-1", isActive: false, title: "First", meta: [], snippet: "Summary" }],
      pagination: {
        summary: "Showing 1-20 / 21",
        previousLabel: "Prev",
        nextLabel: "Next",
        previousDisabled: true,
        nextDisabled: false,
      },
    });
    const previousRow = container.querySelector("[data-memory-id]");

    view.render({
      container,
      diagnostics: null,
      rows: [{ id: "mem-2", isActive: true, title: "Second", meta: [], snippet: "Updated" }],
      pagination: null,
    });

    expect(previousRow?.isConnected).toBe(false);
    expect(container.querySelector(".memory-detail-card")).toBeNull();
    expect(container.querySelector(".memory-list-pagination")).toBeNull();
    expect(container.querySelector("[data-memory-id]")?.getAttribute("data-memory-id")).toBe("mem-2");
    expect(() => view.render({ container: null, diagnostics: null, rows: [], pagination: null })).not.toThrow();
  });

  it("owns only the memory-list sink while the detail badge producer remains available", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const memoryListStart = source.indexOf("function renderMemoryList(items)");
    const memoryListEnd = source.indexOf("function renderSharedReviewList", memoryListStart);
    const memoryListSource = source.slice(memoryListStart, memoryListEnd);

    expect(source).toContain('import { createMemoryViewerMemoryListView }');
    expect(source).toContain("const memoryListView = createMemoryViewerMemoryListView();");
    expect(memoryListSource).not.toContain("memoryViewerListEl.innerHTML");
    expect(memoryListSource).toContain("memoryListView.render({");
    expect(source).not.toContain("function renderMemoryViewerPaginationFooter");
    expect(source).toContain("function renderSourceViewBadge(sourceView)");
    expect(source).toContain("${renderSourceViewBadge(sourceView)}");
  });
});
