// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerSharedReviewTargetFilterView } from "./memory-viewer-shared-review-target-filter-view.js";

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
      if (value) throw new Error("Memory Viewer target filter must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer shared-review target filter DOM owner", () => {
  it("renders ordered target options and selected value without an HTML parser", () => {
    const select = document.createElement("select");
    document.body.append(select);
    blockNonEmptyInnerHtml(select);
    const view = createMemoryViewerSharedReviewTargetFilterView();
    const targetId = 'target"><img src=x onerror=alert(1)>';

    expect(() => view.render({
      select,
      fallbackLabel: "-",
      selectedValue: targetId,
      options: [
        { value: "", label: "" },
        { value: "alpha", label: "<script>alert(2)</script>Alpha" },
        { value: targetId, label: "<svg onload=alert(3)>Target" },
      ],
    })).not.toThrow();

    expect([...select.options].map((option) => ({ value: option.value, label: option.textContent }))).toEqual([
      { value: "", label: "-" },
      { value: "alpha", label: "<script>alert(2)</script>Alpha" },
      { value: targetId, label: "<svg onload=alert(3)>Target" },
    ]);
    expect(select.value).toBe(targetId);
    expect(select.querySelector("img, script, svg, [onerror], [onload]")).toBeNull();
  });

  it("replaces prior options and treats a missing select as a no-op", () => {
    const select = document.createElement("select");
    const view = createMemoryViewerSharedReviewTargetFilterView();
    view.render({ select, fallbackLabel: "-", selectedValue: "first", options: [{ value: "first", label: "First" }] });
    const previousOption = select.options[0];

    view.render({ select, fallbackLabel: "-", selectedValue: "second", options: [{ value: "second", label: "Second" }] });

    expect(previousOption.isConnected).toBe(false);
    expect(select.options).toHaveLength(1);
    expect(select.value).toBe("second");
    expect(() => view.render({ select: null, fallbackLabel: "-", selectedValue: "ignored", options: [] })).not.toThrow();
  });

  it("uses the target filter owner instead of writing the select as HTML", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const filterStart = source.indexOf("function syncSharedReviewFilterUi()");
    const filterEnd = source.indexOf("function renderSharedReviewBatchBar()", filterStart);
    const filterSource = source.slice(filterStart, filterEnd);

    expect(source).toContain('import { createMemoryViewerSharedReviewTargetFilterView }');
    expect(source).toContain("const sharedReviewTargetFilterView = createMemoryViewerSharedReviewTargetFilterView();");
    expect(filterSource).not.toContain("memorySharedReviewTargetFilterEl.innerHTML");
    expect(filterSource).toContain("sharedReviewTargetFilterView.render({");
  });
});
