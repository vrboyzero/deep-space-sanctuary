// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchSynthesisSummaryView } from "./experience-workbench-synthesis-summary-view.js";

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
      if (value) throw new Error("Experience Synthesis summary must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Synthesis summary DOM owner", () => {
  it("renders fixed and optional cards through DOM text APIs without an HTML parser", () => {
    const summary = document.createElement("div");
    document.body.append(summary);
    blockNonEmptyInnerHtml(summary);
    const view = createExperienceWorkbenchSynthesisSummaryView({
      refs: { experienceSynthesisModalSummaryEl: summary },
    });
    const cards = [
      { label: "<img src=x onerror=alert(1)>候选总数", value: "<script>8</script>" },
      { label: "涉及任务数", value: "<svg onload=alert(2)>3</svg>" },
      { label: "种子草稿", value: "<b>Seed</b>" },
      { label: "同类命中", value: "2" },
      { label: "近似命中", value: "4" },
      { label: "本次参与", value: "5" },
      { label: "参与构成", value: "同类 2 · 近似 3" },
      { label: "模板", value: "<mark>templates/method.md</mark>" },
      { label: "新草稿", value: "<i>Created</i>" },
      { label: "覆盖目标", value: "<strong>state/methods/old.md</strong>" },
    ];

    expect(() => view.render({ cards })).not.toThrow();
    expect(summary.children).toHaveLength(10);
    expect([...summary.children].every((card) => card.className === "memory-detail-card")).toBe(true);
    expect(summary.querySelectorAll(".memory-detail-label")).toHaveLength(10);
    expect(summary.querySelectorAll(".memory-detail-text")).toHaveLength(10);
    expect(summary.children[0]?.textContent).toContain("<img src=x onerror=alert(1)>候选总数");
    expect(summary.children[0]?.textContent).toContain("<script>8</script>");
    expect(summary.children[9]?.textContent).toContain("<strong>state/methods/old.md</strong>");
    expect(summary.querySelector("img, script, svg, b, mark, i, strong, [onerror], [onload]")).toBeNull();

    const firstCard = summary.firstElementChild;
    view.render({ cards: [{ label: "候选总数", value: "1" }] });
    expect(firstCard?.isConnected).toBe(false);
    expect(summary.children).toHaveLength(1);
    expect(summary.firstElementChild?.textContent).toBe("候选总数1");
    expect(() => createExperienceWorkbenchSynthesisSummaryView({
      refs: { experienceSynthesisModalSummaryEl: null },
    }).render({ cards })).not.toThrow();
  });

  it("renders summary through the owner before existing modal status and source-list assembly", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/experience-workbench.js"),
      "utf8",
    );
    const modalStart = source.indexOf("function renderExperienceSynthesisModal()");
    const renderIndex = source.indexOf("synthesisSummaryView.render({", modalStart);
    const statusIndex = source.indexOf("experienceSynthesisModalStatusEl.classList.toggle", renderIndex);
    const listIndex = source.indexOf("experienceSynthesisModalListEl.innerHTML", renderIndex);

    expect(source).toContain('import { createExperienceWorkbenchSynthesisSummaryView }');
    expect(source).toContain("const synthesisSummaryView = createExperienceWorkbenchSynthesisSummaryView({");
    expect(source).not.toContain("experienceSynthesisModalSummaryEl.innerHTML");
    expect(renderIndex).toBeGreaterThan(modalStart);
    expect(statusIndex).toBeGreaterThan(renderIndex);
    expect(listIndex).toBeGreaterThan(renderIndex);
  });
});
