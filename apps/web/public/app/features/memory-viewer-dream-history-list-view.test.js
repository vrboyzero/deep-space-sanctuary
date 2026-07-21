// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerDreamHistoryListView } from "./memory-viewer-dream-history-list-view.js";

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
      if (value) throw new Error("Memory Viewer Dream history list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer Dream history list DOM owner", () => {
  it("renders ordered Dream history entries without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerDreamHistoryListView();
    const dreamId = 'dream"><img src=x onerror=alert(1)>';

    expect(() => view.render({
      container,
      emptyText: "No Dream history",
      entries: [
        {
          id: dreamId,
          isActive: true,
          title: "<script>alert(2)</script>Dream",
          meta: ["<svg onload=alert(3)>manual", "completed"],
          snippet: "<img src=x onerror=alert(4)>snippet",
        },
        {
          id: "dream-2",
          isActive: false,
          title: "Second Dream",
          meta: ["auto"],
          snippet: "second snippet",
        },
      ],
    })).not.toThrow();

    const items = [...container.querySelectorAll("[data-dream-history-id]")];
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.getAttribute("data-dream-history-id"))).toEqual([dreamId, "dream-2"]);
    expect(items[0]?.classList.contains("active")).toBe(true);
    expect(items[1]?.classList.contains("active")).toBe(false);
    expect(items[0]?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(2)</script>Dream");
    expect([...items[0]?.querySelectorAll(".memory-list-item-meta span") ?? []].map((item) => item.textContent)).toEqual([
      "<svg onload=alert(3)>manual",
      "completed",
    ]);
    expect(items[0]?.querySelector(".memory-list-item-snippet")?.textContent).toBe("<img src=x onerror=alert(4)>snippet");
    expect(container.querySelector("img, script, svg, [onerror], [onload]")).toBeNull();
  });

  it("renders the empty state, replaces prior entries, and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerDreamHistoryListView();
    view.render({
      container,
      emptyText: "Empty",
      entries: [{ id: "dream-1", isActive: false, title: "First", meta: [], snippet: "" }],
    });
    const previousItem = container.firstElementChild;

    view.render({ container, emptyText: "No entries", entries: [] });

    expect(previousItem?.isConnected).toBe(false);
    expect(container.querySelector(".memory-viewer-empty")?.textContent).toBe("No entries");
    expect(() => view.render({ container: null, emptyText: "ignored", entries: [] })).not.toThrow();
  });

  it("uses the Dream history list owner instead of writing the list root as HTML", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const panelStart = source.indexOf("function renderDreamHistoryPanel()");
    const panelEnd = source.indexOf("async function loadDreamHistoryDetailInternal", panelStart);
    const panelSource = source.slice(panelStart, panelEnd);

    expect(source).toContain('import { createMemoryViewerDreamHistoryListView }');
    expect(source).toContain("const dreamHistoryListView = createMemoryViewerDreamHistoryListView();");
    expect(panelSource).not.toContain("memoryDreamHistoryListEl.innerHTML");
    expect(panelSource).toContain("dreamHistoryListView.render({");
    expect(panelSource).not.toContain("memoryDreamHistoryDetailEl.innerHTML");
    expect(panelSource).toContain("dreamHistoryDetailEmptyView.render({");
    expect(panelSource).toContain("dreamHistoryDetailView.render({");
  });
});
