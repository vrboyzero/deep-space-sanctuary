// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerDedupSummaryView } from "./memory-viewer-dedup-summary-view.js";

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
      if (value) throw new Error("Memory Viewer dedup summary must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer dedup summary DOM owner", () => {
  it("renders fixed summary cards in order as text without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerDedupSummaryView();
    const cards = [
      { label: "<img src=x onerror=alert(1)>扫描范围", value: "<script>alert(2)</script>当前记忆筛选结果" },
      { label: "chunk 变化", value: "5 -> 4" },
      { label: "重复组", value: "<svg onload=alert(3)>1" },
      { label: "可移除 chunk", value: "1" },
      { label: "受影响 task links", value: "2" },
      { label: "page_count", value: "12" },
      { label: "freelist_count", value: "3" },
      { label: "来源风险", value: "<iframe srcdoc=alert(4)>1 个可索引源文件" },
    ];

    expect(() => view.render({ container, cards })).not.toThrow();

    const renderedCards = [...container.querySelectorAll(".memory-detail-card")];
    expect(renderedCards).toHaveLength(8);
    expect(renderedCards.map((card) => card.querySelector(".memory-detail-label")?.textContent)).toEqual(cards.map((card) => card.label));
    expect(renderedCards.map((card) => card.querySelector(".memory-detail-text")?.textContent)).toEqual(cards.map((card) => card.value));
    expect(container.querySelector("img, script, svg, iframe, [onerror], [onload]")).toBeNull();
  });

  it("replaces prior cards and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerDedupSummaryView();
    view.render({ container, cards: [{ label: "旧标签", value: "旧值" }] });
    const previousCard = container.firstElementChild;

    view.render({ container, cards: [{ label: "新标签", value: "新值" }] });

    expect(previousCard?.isConnected).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(container.querySelector(".memory-detail-label")?.textContent).toBe("新标签");
    expect(() => view.render({ container: null, cards: [{ label: "忽略", value: "忽略" }] })).not.toThrow();
  });

  it("uses the summary owner instead of writing the modal summary root as HTML", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const dedupStart = source.indexOf("function renderDedupModal()");
    const dedupEnd = source.indexOf("memoryDedupModalStatusEl.classList.toggle", dedupStart);
    const dedupSource = source.slice(dedupStart, dedupEnd);

    expect(source).toContain('import { createMemoryViewerDedupSummaryView }');
    expect(source).toContain("const dedupSummaryView = createMemoryViewerDedupSummaryView();");
    expect(dedupSource).not.toContain("memoryDedupModalSummaryEl.innerHTML");
    expect(dedupSource).toContain("dedupSummaryView.render({");
  });
});
