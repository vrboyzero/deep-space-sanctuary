// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerDreamHistoryDetailView } from "./memory-viewer-dream-history-detail-view.js";

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
      if (value) throw new Error("Memory Viewer Dream history full detail must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer Dream history full detail DOM owner", () => {
  it("renders the core detail shell, cards, and content without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerDreamHistoryDetailView();

    expect(() => view.render({
      container,
      detail: {
        title: "<img src=x onerror=alert(1)>Dream title",
        summary: "",
        cards: [{ label: "<svg onload=alert(2)>Status", value: "<script>alert(3)</script>Completed" }],
        actions: {},
        reason: "",
        content: "<details open>Dream content</details>",
        emptyText: "No content",
      },
      labels: {
        content: "<iframe srcdoc=alert(4)>Dream body",
      },
    })).not.toThrow();

    const shell = container.firstElementChild;
    const header = shell?.children[0];
    const grid = shell?.children[1];
    const contentCard = shell?.children[2];
    expect(shell?.className).toBe("memory-detail-shell");
    expect(header?.className).toBe("memory-detail-header");
    expect(header?.querySelector(".memory-detail-title")?.textContent).toBe("<img src=x onerror=alert(1)>Dream title");
    expect(grid?.className).toBe("memory-detail-grid");
    expect(grid?.querySelector(".memory-detail-label")?.textContent).toBe("<svg onload=alert(2)>Status");
    expect(grid?.querySelector(".memory-detail-text")?.textContent).toBe("<script>alert(3)</script>Completed");
    expect(contentCard?.className).toBe("memory-detail-card");
    expect(contentCard?.querySelector(".memory-detail-label")?.textContent).toBe("<iframe srcdoc=alert(4)>Dream body");
    expect(contentCard?.querySelector(".memory-detail-pre")?.textContent).toBe("<details open>Dream content</details>");
    expect(container.querySelector("img, script, svg, iframe, details, [onerror], [onload]")).toBeNull();
  });

  it("renders optional summary, actions, reason, and no-content text while replacing prior detail", () => {
    const container = document.createElement("div");
    const previous = document.createElement("div");
    previous.textContent = "Previous detail";
    container.append(previous);
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerDreamHistoryDetailView();

    expect(() => view.render({
      container,
      detail: {
        title: "Dream title",
        summary: "<img src=x onerror=alert(5)>Summary",
        cards: [],
        actions: { canApprove: true, canReject: true, canApply: true },
        reason: "<svg onload=alert(6)>Reason",
        content: "",
        emptyText: "<script>alert(7)</script>No content",
      },
      labels: {
        approve: "<b>Approve</b>",
        reject: "<i>Reject</i>",
        apply: "<u>Apply</u>",
        reason: "<object>Reason label</object>",
        content: "Dream body",
      },
    })).not.toThrow();

    const shell = container.firstElementChild;
    const actions = shell?.querySelector(".goal-detail-actions");
    const actionButtons = [...actions?.querySelectorAll("[data-dream-consolidation-action]") ?? []];
    const reasonCard = shell?.children[3];
    const contentCard = shell?.children[4];
    expect(previous.isConnected).toBe(false);
    expect(shell?.querySelector(".memory-detail-header .memory-detail-text")?.textContent).toBe("<img src=x onerror=alert(5)>Summary");
    expect(actionButtons.map((button) => button.getAttribute("data-dream-consolidation-action"))).toEqual([
      "approve",
      "reject",
      "apply",
    ]);
    expect(actionButtons.map((button) => button.textContent)).toEqual(["<b>Approve</b>", "<i>Reject</i>", "<u>Apply</u>"]);
    expect(reasonCard?.querySelector(".memory-detail-label")?.textContent).toBe("<object>Reason label</object>");
    expect(reasonCard?.querySelector(".memory-detail-text")?.textContent).toBe("<svg onload=alert(6)>Reason");
    expect(contentCard?.querySelector(".memory-detail-text")?.textContent).toBe("<script>alert(7)</script>No content");
    expect(contentCard?.querySelector("pre")).toBeNull();
    expect(container.querySelector("img, script, svg, b, i, u, object, [onerror], [onload]")).toBeNull();
    expect(() => view.render({ container: null, detail: {}, labels: {} })).not.toThrow();
  });

  it("owns the controller full branch while preserving the separate empty owner", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const panelStart = source.indexOf("function renderDreamHistoryPanel()");
    const panelEnd = source.indexOf("async function loadDreamHistoryDetailInternal", panelStart);
    const panelSource = source.slice(panelStart, panelEnd);

    expect(source).toContain('import { createMemoryViewerDreamHistoryDetailView }');
    expect(source).toContain("const dreamHistoryDetailView = createMemoryViewerDreamHistoryDetailView();");
    expect(panelSource).not.toContain("memoryDreamHistoryDetailEl.innerHTML");
    expect(panelSource).toContain("dreamHistoryDetailEmptyView.render({");
    expect(panelSource).toContain("dreamHistoryDetailView.render({");
    expect(panelSource.indexOf("dreamHistoryDetailView.render({")).toBeGreaterThan(panelSource.indexOf("} else {"));
  });
});
