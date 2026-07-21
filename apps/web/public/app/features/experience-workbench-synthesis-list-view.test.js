// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExperienceWorkbenchSynthesisListView } from "./experience-workbench-synthesis-list-view.js";

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
      if (value) throw new Error("Experience Workbench synthesis list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Experience Workbench synthesis source list DOM owner", () => {
  it("renders overwrite, source rows, and checkbox properties without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createExperienceWorkbenchSynthesisListView();
    const seedId = 'seed"><img src=x onerror=alert(1)>';
    const relatedId = 'related"><svg onload=alert(2)>';

    expect(() => view.render({
      container,
      overwriteCompare: {
        title: "<script>Compare</script>",
        summary: "<mark>Before overwrite</mark>",
        currentLabel: "<b>Current</b>",
        currentContent: "<iframe srcdoc=alert(3)></iframe>",
        nextLabel: "<i>Next</i>",
        nextContent: "<object data=javascript:alert(4)></object>",
      },
      rows: [{
        candidateId: seedId,
        synthesized: true,
        title: "<em>Seed draft</em>",
        meta: ["<u>method</u>", "<span>draft</span>", "<q>Task seed</q>"],
        summary: "<details open>seed summary</details>",
        checkbox: {
          candidateId: seedId,
          label: "<a href=javascript:alert(5)>Required</a>",
          checked: true,
          disabled: true,
          required: true,
        },
        badgeLabel: "<strong>Seed</strong>",
        badgeClassName: "memory-badge experience-synthesized-badge",
      }, {
        candidateId: relatedId,
        synthesized: false,
        title: "<em>Related draft</em>",
        meta: ["<u>draft</u>", "score <svg onload=alert(6)>1.00"],
        summary: "<details open>related summary</details>",
        checkbox: {
          candidateId: relatedId,
          label: "<a href=javascript:alert(7)>Include</a>",
          checked: false,
          disabled: false,
          required: false,
        },
        badgeLabel: "<iframe srcdoc=alert(8)>same family</iframe>",
        badgeClassName: "memory-badge",
      }],
    })).not.toThrow();

    const rows = container.querySelectorAll(".experience-synthesis-row");
    const seedRow = rows[0];
    const relatedRow = rows[1];
    const seedCheckbox = container.querySelector("[data-synthesis-source-id]");
    const relatedCheckbox = container.querySelectorAll("[data-synthesis-source-id]")[1];

    expect(container.querySelector(".memory-detail-card .goal-summary-title")?.textContent).toBe("<script>Compare</script>");
    expect(rows).toHaveLength(2);
    expect(seedRow.className).toBe("experience-synthesis-row experience-candidate-synthesized");
    expect(seedRow.getAttribute("data-synthesis-preview-candidate-id")).toBe(seedId);
    expect(relatedRow.getAttribute("data-synthesis-preview-candidate-id")).toBe(relatedId);
    expect(seedCheckbox?.checked).toBe(true);
    expect(seedCheckbox?.disabled).toBe(true);
    expect(seedCheckbox?.getAttribute("aria-label")).toBe("<a href=javascript:alert(5)>Required</a>");
    expect(seedCheckbox?.closest("label")?.className).toBe("experience-synthesis-source-select is-required");
    expect(relatedCheckbox?.checked).toBe(false);
    expect(relatedCheckbox?.disabled).toBe(false);
    expect(container.textContent).toContain("<iframe srcdoc=alert(3)></iframe>");
    expect(container.querySelector("img, script, mark, b, i, em, u, q, svg, iframe, object, details, a, strong, [onerror], [onload]")).toBeNull();
  });

  it("uses the list owner instead of string rendering in the synthesis modal", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/experience-workbench.js"),
      "utf8",
    );
    const modalStart = source.indexOf("function renderExperienceSynthesisModal()");
    const modalEnd = source.indexOf("function closeExperienceSynthesisModal(", modalStart);
    const modalSource = source.slice(modalStart, modalEnd);
    const renderIndex = modalSource.indexOf("synthesisListView.render({");
    const submitStateIndex = modalSource.indexOf("experienceSynthesisModalSubmitBtn.textContent");

    expect(source).toContain('import { createExperienceWorkbenchSynthesisListView }');
    expect(source).toContain("const synthesisListView = createExperienceWorkbenchSynthesisListView();");
    expect(modalSource).not.toContain("experienceSynthesisModalListEl.innerHTML");
    expect(modalSource).not.toContain("synthesisSourcesFeature.renderCheckbox");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(submitStateIndex).toBeGreaterThan(renderIndex);
  });
});
