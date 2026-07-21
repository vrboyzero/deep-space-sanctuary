// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerSharedReviewListView } from "./memory-viewer-shared-review-list-view.js";

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
      if (value) throw new Error("Memory Viewer shared-review list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer shared-review list DOM owner", () => {
  it("renders selected review rows and pagination without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerSharedReviewListView();
    const memoryId = 'mem"><img src=x onerror=alert(1)>';
    const targetAgentId = 'agent"><svg onload=alert(2)>';

    expect(() => view.render({
      container,
      rows: [{
        id: memoryId,
        targetAgentId,
        isActive: true,
        isSelected: true,
        title: "<script>alert(3)</script>Memory",
        meta: [
          { text: "<iframe srcdoc='<script>alert(4)</script>'>Target", kind: "badge" },
          { text: "pending", kind: "badge" },
          { text: "Review Claim: owner", kind: "shared" },
          { text: "Blocked", kind: "hybrid" },
          { text: "hybrid", kind: "hybrid" },
          { text: "<math><mtext>decision</mtext></math>", kind: "badge" },
          { text: "Expires <object data=x>soon" },
          { text: "<svg onload=alert(5)>2026-07-21" },
        ],
        snippet: "<img src=x onerror=alert(6)>Summary",
      }],
      pagination: {
        summary: "<img src=x onerror=alert(7)>Showing 1-25 / 26",
        previousLabel: "< Prev",
        nextLabel: "Next >",
        previousDisabled: true,
        nextDisabled: false,
      },
    })).not.toThrow();

    const row = container.querySelector("[data-shared-review-memory-id]");
    expect(row?.getAttribute("data-shared-review-memory-id")).toBe(memoryId);
    expect(row?.getAttribute("data-shared-review-target-agent-id")).toBe(targetAgentId);
    expect(row?.className).toBe("memory-list-item active");
    expect([...row?.children ?? []].map((node) => node.className)).toEqual([
      "memory-list-item-head",
      "memory-list-item-meta",
      "memory-list-item-snippet",
    ]);
    const checkbox = row?.querySelector("[data-shared-review-select]");
    expect(checkbox?.getAttribute("data-shared-review-select")).toBe(memoryId);
    expect(checkbox?.type).toBe("checkbox");
    expect(checkbox?.checked).toBe(true);
    expect(row?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(3)</script>Memory");
    expect([...row?.querySelectorAll(".memory-list-item-meta span") ?? []].map((node) => ({
      text: node.textContent,
      className: node.className,
    }))).toEqual([
      { text: "<iframe srcdoc='<script>alert(4)</script>'>Target", className: "memory-badge" },
      { text: "pending", className: "memory-badge" },
      { text: "Review Claim: owner", className: "memory-badge memory-badge-shared" },
      { text: "Blocked", className: "memory-badge memory-badge-hybrid" },
      { text: "hybrid", className: "memory-badge memory-badge-hybrid" },
      { text: "<math><mtext>decision</mtext></math>", className: "memory-badge" },
      { text: "Expires <object data=x>soon", className: "" },
      { text: "<svg onload=alert(5)>2026-07-21", className: "" },
    ]);
    expect(row?.querySelector(".memory-list-item-snippet")?.textContent).toBe("<img src=x onerror=alert(6)>Summary");

    const buttons = [...container.querySelectorAll("[data-memory-list-page-action]")];
    expect(buttons.map((button) => button.getAttribute("data-memory-list-page-action"))).toEqual(["prev", "next"]);
    expect(buttons.map((button) => ({ text: button.textContent, disabled: button.disabled }))).toEqual([
      { text: "< Prev", disabled: true },
      { text: "Next >", disabled: false },
    ]);
    expect(container.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]")).toBeNull();
  });

  it("omits optional metadata and pagination, replaces prior content, and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerSharedReviewListView();
    view.render({
      container,
      rows: [{
        id: "mem-1",
        targetAgentId: "agent-1",
        isActive: false,
        isSelected: true,
        title: "First",
        meta: [{ text: "pending", kind: "badge" }],
        snippet: "Summary",
      }],
      pagination: {
        summary: "Showing 1-25 / 26",
        previousLabel: "Prev",
        nextLabel: "Next",
        previousDisabled: true,
        nextDisabled: false,
      },
    });
    const previousRow = container.querySelector("[data-shared-review-memory-id]");

    view.render({
      container,
      rows: [{
        id: "mem-2",
        targetAgentId: "",
        isActive: true,
        isSelected: false,
        title: "Second",
        meta: [],
        snippet: "Updated",
      }],
      pagination: null,
    });

    expect(previousRow?.isConnected).toBe(false);
    expect(container.querySelectorAll("[data-shared-review-memory-id]")).toHaveLength(1);
    expect(container.querySelector("[data-shared-review-memory-id]")?.getAttribute("data-shared-review-memory-id")).toBe("mem-2");
    expect(container.querySelector("[data-shared-review-select]")?.checked).toBe(false);
    expect(container.querySelector(".memory-list-item-meta")?.childElementCount).toBe(0);
    expect(container.querySelector(".memory-list-pagination")).toBeNull();
    expect(() => view.render({ container: null, rows: [], pagination: null })).not.toThrow();
  });

  it("owns only the shared-review list sink and removes the unused pagination producer", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const sharedListStart = source.indexOf("function renderSharedReviewList(items)");
    const sharedListEnd = source.indexOf("function renderExternalOutboundAuditList", sharedListStart);
    const sharedListSource = source.slice(sharedListStart, sharedListEnd);

    expect(source).toContain('import { createMemoryViewerSharedReviewListView }');
    expect(source).toContain("const sharedReviewListView = createMemoryViewerSharedReviewListView();");
    expect(sharedListSource).not.toContain("memoryViewerListEl.innerHTML");
    expect(sharedListSource).toContain("sharedReviewListView.render({");
    expect(source).not.toContain("function renderMemoryViewerPaginationFooter");
    expect(source).toContain("function renderSourceViewBadge(sourceView)");
    expect(source.match(/\$\{renderSourceViewBadge\(sourceView\)\}/g)).toHaveLength(2);
  });
});
