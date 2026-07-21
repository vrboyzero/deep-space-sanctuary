// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerOutboundThreadStatsView } from "./memory-viewer-outbound-thread-stats-view.js";

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
      if (value) throw new Error("Memory Viewer outbound thread stats must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer outbound thread stats DOM owner", () => {
  it("renders the eight organizer cards without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerOutboundThreadStatsView();
    const cards = Array.from({ length: 8 }, (_, index) => ({
      label: `<img src=x onerror=alert(${index})>Label ${index}`,
      value: `<script>alert(${index})</script>${index}`,
    }));

    expect(() => view.render({ container, cards })).not.toThrow();

    const renderedCards = [...container.querySelectorAll(".memory-stat-card")];
    expect(renderedCards).toHaveLength(8);
    expect(renderedCards.map((card) => card.querySelector(".memory-stat-label")?.textContent)).toEqual(cards.map((card) => card.label));
    expect(renderedCards.map((card) => card.querySelector(".memory-stat-value")?.textContent)).toEqual(cards.map((card) => card.value));
    expect(container.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("replaces prior cards and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerOutboundThreadStatsView();
    view.render({ container, cards: [{ label: "Old", value: "1" }] });
    const previousCard = container.firstElementChild;

    view.render({ container, cards: [{ label: "Current", value: "2" }] });

    expect(previousCard?.isConnected).toBe(false);
    expect(container.querySelector(".memory-stat-label")?.textContent).toBe("Current");
    expect(container.querySelector(".memory-stat-value")?.textContent).toBe("2");
    expect(() => view.render({ container: null, cards: [] })).not.toThrow();
  });
});
