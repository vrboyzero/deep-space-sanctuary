// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchStatsView } from "./experience-workbench-stats-view.js";

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
      if (value) throw new Error("Experience Workbench stats must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Workbench stats DOM owner", () => {
  it("renders six ordered cards with labels and values as text", () => {
    const statsEl = document.createElement("div");
    document.body.append(statsEl);
    blockNonEmptyInnerHtml(statsEl);
    const view = createExperienceWorkbenchStatsView({
      refs: { experienceWorkbenchStatsEl: statsEl },
      t: (key, _params, fallback) => `<img src=x onerror=alert(1)>${key || fallback}`,
    });
    const stats = {
      total: "<script>6</script>",
      methods: 2,
      skills: 1,
      draft: 3,
      accepted: 2,
      rejected: 1,
    };

    expect(() => view.render(stats)).not.toThrow();
    const cards = Array.from(statsEl.children);
    expect(cards).toHaveLength(6);
    expect(cards.every((card) => card.className === "memory-stat-card")).toBe(true);
    expect(cards.map((card) => card.querySelector(".memory-stat-label")?.textContent)).toEqual([
      "<img src=x onerror=alert(1)>experience.statTotal",
      "<img src=x onerror=alert(1)>experience.statMethods",
      "<img src=x onerror=alert(1)>experience.statSkills",
      "<img src=x onerror=alert(1)>experience.statDraft",
      "<img src=x onerror=alert(1)>experience.statAccepted",
      "<img src=x onerror=alert(1)>experience.statRejected",
    ]);
    expect(cards.map((card) => card.querySelector(".memory-stat-value")?.textContent)).toEqual([
      "<script>6</script>",
      "2",
      "1",
      "3",
      "2",
      "1",
    ]);
    expect(statsEl.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("uses six fallback values, replaces prior cards, and tolerates a missing panel", () => {
    const statsEl = document.createElement("div");
    const view = createExperienceWorkbenchStatsView({
      refs: { experienceWorkbenchStatsEl: statsEl },
      t: (_key, _params, fallback) => fallback,
    });

    view.render({ total: 1, methods: 1, skills: 0, draft: 0, accepted: 1, rejected: 0 });
    view.render(null);
    expect(Array.from(statsEl.querySelectorAll(".memory-stat-value"), (node) => node.textContent)).toEqual([
      "--",
      "--",
      "--",
      "--",
      "--",
      "--",
    ]);

    const missingView = createExperienceWorkbenchStatsView({
      refs: { experienceWorkbenchStatsEl: null },
      t: (_key, _params, fallback) => fallback,
    });
    expect(() => missingView.render(null)).not.toThrow();
  });
});
