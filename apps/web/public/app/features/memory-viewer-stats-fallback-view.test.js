// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { createMemoryViewerStatsFallbackView } from "./memory-viewer-stats-fallback-view.js";

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
      if (value) throw new Error("Memory Viewer fallback stats must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer fallback stats DOM owner", () => {
  it("renders the four fallback cards without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerStatsFallbackView();
    const labels = [
      '<img src=x onerror=alert(1)>Files',
      "<script>alert(2)</script>Chunks",
      "<svg onload=alert(3)>Vector",
      "<button onclick=alert(4)>Summaries",
    ];

    expect(() => view.render({ container, labels })).not.toThrow();

    const cards = [...container.querySelectorAll(".memory-stat-card")];
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.querySelector(".memory-stat-label")?.textContent)).toEqual(labels);
    expect(cards.map((card) => card.querySelector(".memory-stat-value")?.textContent)).toEqual(["--", "--", "--", "--"]);
    expect(container.querySelector("img, script, svg, button, [onerror], [onload], [onclick]")).toBeNull();
  });

  it("replaces prior cards and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerStatsFallbackView();
    view.render({ container, labels: ["Files", "Chunks", "Vector", "Summaries"] });
    const previousCard = container.firstElementChild;

    view.render({ container, labels: ["F", "C", "V", "S"] });

    expect(previousCard?.isConnected).toBe(false);
    expect([...container.querySelectorAll(".memory-stat-label")].map((element) => element.textContent)).toEqual(["F", "C", "V", "S"]);
    expect(() => view.render({ container: null, labels: ["ignored"] })).not.toThrow();
  });

  it("uses the fallback owner instead of writing the fallback stats root as HTML", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const statsStart = source.indexOf("function renderMemoryViewerStats(stats)");
    const fallbackRender = source.indexOf("statsFallbackView.render({", statsStart);
    const outboundAuditBranch = source.indexOf('if (memoryViewerState.tab === "outboundAudit")', fallbackRender);
    const fallbackSource = source.slice(statsStart, outboundAuditBranch);

    expect(source).toContain('import { createMemoryViewerStatsFallbackView }');
    expect(source).toContain("const statsFallbackView = createMemoryViewerStatsFallbackView();");
    expect(fallbackSource).not.toContain("memoryViewerStatsEl.innerHTML");
    expect(fallbackSource).toContain("statsFallbackView.render({");
    expect(source.slice(outboundAuditBranch)).not.toContain("memoryViewerStatsEl.innerHTML");
    expect(source).toContain('import { createMemoryViewerMemoryStatsView }');
    expect(source).toContain("memoryStatsView.render({");
  });
});
