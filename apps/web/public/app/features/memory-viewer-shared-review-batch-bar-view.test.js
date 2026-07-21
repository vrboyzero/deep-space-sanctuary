// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryViewerSharedReviewBatchBarView } from "./memory-viewer-shared-review-batch-bar-view.js";

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
      if (value) throw new Error("Memory Viewer shared-review batch bar must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer shared-review batch bar DOM owner", () => {
  it("renders ordered batch controls without an HTML parser and forwards their callbacks", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const onSelect = vi.fn();
    const onAction = vi.fn();
    const view = createMemoryViewerSharedReviewBatchBarView();

    expect(() => view.render({
      container,
      summary: '<svg onload=alert(1)>Selected 1 / 2',
      selectionButtons: [
        { key: "all", label: "<script>alert(2)</script>Select Visible", disabled: false },
        { key: "actionable", label: "Select Actionable", disabled: true },
        { key: "clear", label: "Clear Selection", disabled: false },
      ],
      actionButtons: [
        { key: 'claim"><img src=x onerror=alert(3)>', label: "Claim (1)", disabled: false },
        { key: "release", label: "Release (0)", disabled: true },
      ],
      onSelect,
      onAction,
    })).not.toThrow();

    expect(container.querySelector(".memory-shared-review-batch-summary")?.textContent).toBe('<svg onload=alert(1)>Selected 1 / 2');
    expect([...container.querySelectorAll("[data-shared-review-batch-select]")].map((button) => ({
      key: button.getAttribute("data-shared-review-batch-select"),
      text: button.textContent,
      disabled: button.disabled,
    }))).toEqual([
      { key: "all", text: "<script>alert(2)</script>Select Visible", disabled: false },
      { key: "actionable", text: "Select Actionable", disabled: true },
      { key: "clear", text: "Clear Selection", disabled: false },
    ]);
    const actionButtons = [...container.querySelectorAll("[data-shared-review-batch-action]")];
    expect(actionButtons.map((button) => ({
      key: button.getAttribute("data-shared-review-batch-action"),
      text: button.textContent,
      disabled: button.disabled,
    }))).toEqual([
      { key: 'claim"><img src=x onerror=alert(3)>', text: "Claim (1)", disabled: false },
      { key: "release", text: "Release (0)", disabled: true },
    ]);
    expect(container.querySelector("img, script, svg, [onerror], [onload]")).toBeNull();

    container.querySelector('[data-shared-review-batch-select="all"]')?.click();
    actionButtons.find((button) => button.getAttribute("data-shared-review-batch-action") === "release")?.click();
    expect(onSelect).toHaveBeenCalledWith("all");
    expect(onAction).not.toHaveBeenCalled();
    actionButtons[0]?.click();
    expect(onAction).toHaveBeenCalledWith('claim"><img src=x onerror=alert(3)>');
  });

  it("replaces previous controls, clears the root, and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerSharedReviewBatchBarView();
    view.render({
      container,
      summary: "First",
      selectionButtons: [{ key: "all", label: "All", disabled: false }],
      actionButtons: [],
    });
    const previousButton = container.querySelector("button");

    view.render({
      container,
      summary: "Second",
      selectionButtons: [],
      actionButtons: [{ key: "claim", label: "Claim", disabled: false }],
    });

    expect(previousButton?.isConnected).toBe(false);
    expect(container.textContent).toContain("Second");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    view.clear({ container });
    expect(container.childElementCount).toBe(0);
    expect(() => {
      view.render({ container: null, summary: "ignored", selectionButtons: [], actionButtons: [] });
      view.clear({ container: null });
    }).not.toThrow();
  });

  it("uses the batch-bar owner instead of writing the root as HTML", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const batchStart = source.indexOf("function renderSharedReviewBatchBar()");
    const batchEnd = source.indexOf("function createMemoryViewerRequestContext", batchStart);
    const batchSource = source.slice(batchStart, batchEnd);

    expect(source).toContain('import { createMemoryViewerSharedReviewBatchBarView }');
    expect(source).toContain("const sharedReviewBatchBarView = createMemoryViewerSharedReviewBatchBarView();");
    expect(batchSource).not.toContain("memorySharedReviewBatchBarEl.innerHTML");
    expect(batchSource).toContain("sharedReviewBatchBarView.clear({");
    expect(batchSource).toContain("sharedReviewBatchBarView.render({");
  });
});
