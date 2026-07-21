// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerTaskStatsView } from "./memory-viewer-task-stats-view.js";

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
      if (value) throw new Error("Memory Viewer task stats must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer task stats DOM owner", () => {
  it("renders fixed task cards and an optional Goal card without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerTaskStatsView();
    const cards = Array.from({ length: 6 }, (_, index) => ({
      label: `<img src=x onerror=alert(${index})>Label ${index}`,
      value: `<script>alert(${index})</script>${index}`,
      compact: [1, 4, 5].includes(index),
      caption: [1, 5].includes(index) ? `<svg onload=alert(${index})>Caption ${index}` : "",
    }));

    expect(() => view.render({ container, cards })).not.toThrow();

    const renderedCards = [...container.querySelectorAll(".memory-stat-card")];
    expect(renderedCards).toHaveLength(6);
    expect(renderedCards.map((card) => card.querySelector(".memory-stat-label")?.textContent)).toEqual(cards.map((card) => card.label));
    expect(renderedCards.map((card) => card.querySelector(".memory-stat-value")?.textContent)).toEqual(cards.map((card) => card.value));
    expect(renderedCards.map((card) => card.querySelector(".memory-stat-value")?.classList.contains("memory-stat-value-compact"))).toEqual([
      false,
      true,
      false,
      false,
      true,
      true,
    ]);
    expect([...container.querySelectorAll(".memory-stat-caption")].map((caption) => caption.textContent)).toEqual([
      cards[1].caption,
      cards[5].caption,
    ]);
    expect(container.querySelector("img, script, svg, [onerror], [onload]")).toBeNull();
  });

  it("replaces prior cards and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerTaskStatsView();
    view.render({ container, cards: [{ label: "Old", value: "1", caption: "Old caption" }] });
    const previousCard = container.firstElementChild;

    view.render({ container, cards: [{ label: "Current", value: "2", compact: true }] });

    expect(previousCard?.isConnected).toBe(false);
    expect(container.querySelector(".memory-stat-label")?.textContent).toBe("Current");
    expect(container.querySelector(".memory-stat-value")?.classList.contains("memory-stat-value-compact")).toBe(true);
    expect(container.querySelector(".memory-stat-caption")).toBeNull();
    expect(() => view.render({ container: null, cards: [] })).not.toThrow();
  });
});
