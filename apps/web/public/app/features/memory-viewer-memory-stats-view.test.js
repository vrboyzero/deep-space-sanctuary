// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerMemoryStatsView } from "./memory-viewer-memory-stats-view.js";

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
      if (value) throw new Error("Memory Viewer memories stats must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer memories stats DOM owner", () => {
  it("renders cards and an active category distribution without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerMemoryStatsView();
    const cards = [
      {
        label: "<img src=x onerror=alert(1)>Current Results",
        value: "<script>alert(2)</script>2",
      },
      {
        label: "<svg onload=alert(3)>Current Query Strategy",
        value: "<iframe srcdoc='<script>alert(4)</script>'>private",
        compact: true,
        caption: "<math><mtext>Private resident memory</mtext></math>",
      },
    ];
    const distribution = {
      label: "<object data=x>Category Distribution",
      caption: "<img src=x onerror=alert(5)>Library 3",
      rows: [
        {
          key: "preference",
          label: "<script>alert(6)</script>Preference",
          count: "2",
          percent: "66.7%",
          widthPercent: 66.67,
          active: true,
        },
        {
          key: "unknown",
          label: "<svg onload=alert(7)>Uncategorized",
          count: "1",
          percent: "33.3%",
          widthPercent: 33.33,
          active: false,
        },
      ],
    };

    expect(() => view.render({ container, cards, distribution })).not.toThrow();

    const renderedCards = [...container.querySelectorAll(".memory-stat-card")];
    expect(renderedCards).toHaveLength(3);
    expect(renderedCards.slice(0, 2).map((card) => card.querySelector(".memory-stat-label")?.textContent))
      .toEqual(cards.map((card) => card.label));
    expect(renderedCards.slice(0, 2).map((card) => card.querySelector(".memory-stat-value")?.textContent))
      .toEqual(cards.map((card) => card.value));
    expect(renderedCards[1]?.querySelector(".memory-stat-value")?.className)
      .toBe("memory-stat-value memory-stat-value-compact");
    expect(renderedCards[1]?.querySelector(".memory-stat-caption")?.textContent).toBe(cards[1].caption);

    const distributionCard = renderedCards[2];
    expect(distributionCard?.className).toBe("memory-stat-card memory-stat-card-wide");
    expect(distributionCard?.querySelector(".memory-stat-label")?.textContent).toBe(distribution.label);
    expect(distributionCard?.querySelector(".memory-stat-caption")?.textContent).toBe(distribution.caption);
    const rows = [...distributionCard?.querySelectorAll(".memory-category-row") ?? []];
    expect(rows.map((row) => row.className)).toEqual([
      "memory-category-row active",
      "memory-category-row",
    ]);
    expect(rows.map((row) => row.querySelector(".memory-category-name")?.textContent))
      .toEqual(distribution.rows.map((row) => row.label));
    expect(rows.map((row) => row.querySelector(".memory-category-bar-fill")?.className)).toEqual([
      "memory-category-bar-fill memory-category-bar-preference",
      "memory-category-bar-fill memory-category-bar-uncategorized",
    ]);
    expect(rows.map((row) => row.querySelector(".memory-category-bar-fill")?.style.width))
      .toEqual(["66.67%", "33.33%"]);
    expect(rows.map((row) => row.querySelector(".memory-category-count")?.textContent)).toEqual(["2", "1"]);
    expect(rows.map((row) => row.querySelector(".memory-category-percent")?.textContent)).toEqual(["66.7%", "33.3%"]);
    expect(container.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]"))
      .toBeNull();
  });

  it("renders an empty distribution, replaces prior content, and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerMemoryStatsView();
    view.render({
      container,
      cards: [{ label: "Old", value: "1", caption: "Old caption" }],
      distribution: {
        label: "Old distribution",
        caption: "Library 1",
        rows: [{
          key: "fact",
          label: "Fact",
          count: "1",
          percent: "100%",
          widthPercent: 100,
          active: true,
        }],
      },
    });
    const previousCard = container.firstElementChild;

    view.render({
      container,
      cards: [{ label: "Current", value: "2", compact: true }],
      distribution: {
        label: "Category Distribution",
        caption: "No categorized samples",
        rows: [],
      },
    });

    expect(previousCard?.isConnected).toBe(false);
    expect(container.querySelectorAll(".memory-stat-card")).toHaveLength(2);
    expect(container.querySelector(".memory-stat-value")?.className)
      .toBe("memory-stat-value memory-stat-value-compact");
    expect(container.querySelector(".memory-stat-card-wide .memory-stat-caption")?.textContent)
      .toBe("No categorized samples");
    expect(container.querySelector(".memory-category-chart")).toBeNull();
    expect(() => view.render({ container: null, cards: [], distribution: null })).not.toThrow();
  });
});
